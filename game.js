
import * as THREE from
  "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

import { createClient } from
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/*
  CONFIGURACIÓN:
  Sustituye estos dos valores por los de tu proyecto Supabase.
  No uses claves secretas ni service_role en el navegador.
*/
const SUPABASE_URL = "https://vlwfntwxbzmeodutbrxd.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "sb_publishable_JKRwt7biD2Y9wCQpQC9iQA_-EDPL17V";

const $ = (id) => document.getElementById(id);
const MAX_PLAYERS = 10;
const MOVE_SPEED = 7;

const menu = $("menu");
const game = $("game");
const joinForm = $("joinForm");
const joinButton = $("joinButton");
const newRoomButton = $("newRoomButton");
const menuStatus = $("menuStatus");

let supabase = null;
let channel = null;
let scene = null;
let camera = null;
let renderer = null;
let player = null;

let joined = false;
let playerName = "";
let roomCode = "";
let yaw = 0;
let pitch = 0.25;
let lastFrame = 0;
let lastBroadcast = 0;

const playerId = crypto.randomUUID();
const keys = new Set();
const remotes = new Map();

const state = {
  x: 0,
  z: 0,
  rotation: 0
};

function setStatus(message) {
  menuStatus.textContent = message;
}

function randomRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function isConfigured() {
  return (
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("TU_URL") &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.includes("TU_CLAVE")
  );
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startGame(false);
});

newRoomButton.addEventListener("click", () => {
  startGame(true);
});

async function startGame(createRoom) {
  if (joined) return;

  playerName = $("playerName").value.trim().slice(0, 18);
  roomCode = $("roomCode").value.trim().toUpperCase();

  if (!playerName) {
    setStatus("Escribe tu nombre antes de entrar.");
    $("playerName").focus();
    return;
  }

  if (createRoom || !roomCode) {
    roomCode = randomRoomCode();
  }

  if (!/^[A-Z0-9_-]{3,20}$/.test(roomCode)) {
    setStatus("Usa un código de sala de 3 a 20 letras o números.");
    return;
  }

  if (!isConfigured()) {
    setStatus(
      "Falta configurar Supabase. Edita SUPABASE_URL y SUPABASE_ANON_KEY en game.js."
    );
    return;
  }

  joinButton.disabled = true;
  newRoomButton.disabled = true;
  setStatus("Conectando con la sala...");

  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    channel = supabase.channel("ciudad-" + roomCode, {
      config: {
        broadcast: { self: false },
        presence: { key: playerId }
      }
    });

    channel.on("broadcast", { event: "position" }, ({ payload }) => {
      receivePosition(payload);
    });

    channel.on("presence", { event: "sync" }, syncPlayers);

    await subscribeToRoom();

    createWorld();

    joined = true;
    menu.hidden = true;
    game.hidden = false;
    $("currentRoom").textContent = roomCode;
    $("notice").textContent =
      "Conectado. Haz clic en la ciudad para controlar la cámara.";

    const inviteUrl = new URL(location.href);
    inviteUrl.searchParams.set("room", roomCode);
    history.replaceState(null, "", inviteUrl);

    requestAnimationFrame(animate);
  } catch (error) {
    console.error("Error de conexión:", error);
    setStatus("No se pudo iniciar: " + (error.message || "Error desconocido"));

    if (channel) {
      try {
        await channel.unsubscribe();
      } catch {}
    }
    channel = null;
  } finally {
    joinButton.disabled = false;
    newRoomButton.disabled = false;
  }
}

function subscribeToRoom() {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error("La conexión tardó demasiado. Comprueba Supabase."));
    }, 15000);

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED" && !finished) {
        try {
          const entries = flattenPresence(channel.presenceState());

          if (entries.length >= MAX_PLAYERS) {
            finished = true;
            clearTimeout(timeout);
            await channel.unsubscribe();
            reject(new Error("La sala está llena (10 jugadores)."));
            return;
          }

          await channel.track({
            id: playerId,
            name: playerName,
            x: state.x,
            z: state.z,
            rotation: state.rotation
          });

          finished = true;
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          reject(error);
        }
      }

      if (
        (status === "CHANNEL_ERROR" || status === "TIMED_OUT") &&
        !finished
      ) {
        finished = true;
        clearTimeout(timeout);
        reject(new Error("Supabase no pudo conectar con la sala."));
      }
    });
  });
}

function flattenPresence(presenceState) {
  return Object.values(presenceState).flat();
}

function syncPlayers() {
  if (!channel || !scene) return;

  const entries = flattenPresence(channel.presenceState());
  const active = new Set();

  for (const data of entries) {
    if (!data.id || data.id === playerId) continue;
    active.add(data.id);

    if (!remotes.has(data.id)) {
      addRemote({
        id: data.id,
        name: data.name || "Jugador",
        x: Number(data.x) || 0,
        z: Number(data.z) || 0,
        rotation: Number(data.rotation) || 0
      });
    }
  }

  for (const [id, remote] of remotes) {
    if (!active.has(id)) {
      scene.remove(remote.group);
      disposeGroup(remote.group);
      remotes.delete(id);
    }
  }

  $("playerCount").textContent = String(
    Math.min(MAX_PLAYERS, new Set(entries.map(p => p.id)).size)
  );
}

function receivePosition(data) {
  if (!data || data.id === playerId) return;
  if (!Number.isFinite(data.x) || !Number.isFinite(data.z)) return;

  let remote = remotes.get(data.id);

  if (!remote) {
    addRemote(data);
    remote = remotes.get(data.id);
  }

  if (!remote) return;

  remote.targetX = THREE.MathUtils.clamp(data.x, -120, 120);
  remote.targetZ = THREE.MathUtils.clamp(data.z, -120, 120);
  remote.targetRotation = Number(data.rotation) || 0;
}

function createWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8bc7ed);
  scene.fog = new THREE.Fog(0x8bc7ed, 90, 260);

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  game.insertBefore(renderer.domElement, $("hud"));

  scene.add(new THREE.HemisphereLight(0xffffff, 0x607060, 2));

  const sunlight = new THREE.DirectionalLight(0xffffff, 2);
  sunlight.position.set(40, 70, 30);
  sunlight.castShadow = true;
  scene.add(sunlight);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    new THREE.MeshStandardMaterial({ color: 0x4d844b })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  createRoads();
  createBuildings();

  player = createCharacter(0x1fc8a0, playerName);
  player.position.set(state.x, 0, state.z);
  scene.add(player);

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  renderer.domElement.addEventListener("click", () => {
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock?.();
    }
  });

  document.addEventListener("mousemove", onMouseMove);
}

function createRoads() {
  for (let n = -100; n <= 100; n += 40) {
    addBox(12, 0.08, 260, 0x343a40, n, 0.06, 0);
    addBox(260, 0.08, 12, 0x343a40, 0, 0.06, n);

    addBox(0.08, 0.02, 260, 0xe8dfb4, n, 0.11, 0);
    addBox(260, 0.02, 0.08, 0xe8dfb4, 0, 0.11, n);
  }
}

function createBuildings() {
  for (let x = -90; x <= 90; x += 20) {
    for (let z = -90; z <= 90; z += 20) {
      if (Math.abs(x % 40) < 8 || Math.abs(z % 40) < 8) continue;

      const width = 7 + Math.random() * 4;
      const depth = 7 + Math.random() * 4;
      const height = 5 + Math.random() * 24;

      const color = new THREE.Color().setHSL(
        0.55 + Math.random() * 0.08,
        0.12 + Math.random() * 0.18,
        0.35 + Math.random() * 0.25
      );

      const building = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({ color })
      );

      building.position.set(
        x + (Math.random() - 0.5) * 5,
        height / 2,
        z + (Math.random() - 0.5) * 5
      );

      building.castShadow = true;
      building.receiveShadow = true;
      scene.add(building);
    }
  }
}

function addBox(sx, sy, sz, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function createCharacter(color, name) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.3, 0.45),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 1.15;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xe8bd94 })
  );
  head.position.y = 2.05;
  head.castShadow = true;
  group.add(head);

  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 128;

  const ctx = labelCanvas.getContext("2d");
  ctx.font = "bold 44px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 6;
  ctx.strokeText(String(name).slice(0, 18), 256, 78);
  ctx.fillText(String(name).slice(0, 18), 256, 78);

  const texture = new THREE.CanvasTexture(labelCanvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );

  sprite.position.y = 2.75;
  sprite.scale.set(2.6, 0.65, 1);
  group.add(sprite);

  return group;
}

function addRemote(data) {
  if (!scene || !data.id || data.id === playerId) return;

  const group = createCharacter(0xf0a33b, data.name || "Jugador");
  group.position.set(data.x || 0, 0, data.z || 0);
  scene.add(group);

  remotes.set(data.id, {
    group,
    targetX: data.x || 0,
    targetZ: data.z || 0,
    targetRotation: data.rotation || 0
  });
}

function disposeGroup(group) {
  group.traverse((object) => {
    if (!object.isMesh && !object.isSprite) return;

    object.geometry?.dispose();

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    for (const material of materials) {
      if (material.map) material.map.dispose();
      material.dispose();
    }
  });
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();

  if (
    ["w", "a", "s", "d", "arrowup", "arrowdown",
     "arrowleft", "arrowright", " "].includes(key)
  ) {
    event.preventDefault();
  }

  keys.add(key);
}

function onKeyUp(event) {
  keys.delete(event.key.toLowerCase());
}

function onMouseMove(event) {
  if (document.pointerLockElement !== renderer?.domElement) return;

  yaw -= event.movementX * 0.0025;
  pitch = THREE.MathUtils.clamp(
    pitch + event.movementY * 0.0015,
    -0.05,
    0.8
  );
}

function resize() {
  if (!camera || !renderer) return;

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(now = 0) {
  if (!joined) return;

  requestAnimationFrame(animate);

  const delta = Math.min((now - lastFrame) / 1000 || 0, 0.05);
  lastFrame = now;

  const runMultiplier = keys.has("shift") ? 1.7 : 1;
  const velocity = MOVE_SPEED * runMultiplier * delta;

  let forward = 0;
  let sideways = 0;

  if (keys.has("w") || keys.has("arrowup")) forward++;
  if (keys.has("s") || keys.has("arrowdown")) forward--;
  if (keys.has("a") || keys.has("arrowleft")) sideways--;
  if (keys.has("d") || keys.has("arrowright")) sideways++;

  const length = Math.hypot(forward, sideways) || 1;
  forward /= length;
  sideways /= length;

  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);

  state.x += (sideways * cos + forward * sin) * velocity;
  state.z += (sideways * sin - forward * cos) * velocity;

  state.x = THREE.MathUtils.clamp(state.x, -120, 120);
  state.z = THREE.MathUtils.clamp(state.z, -120, 120);
  state.rotation = yaw;

  player.position.set(state.x, 0, state.z);
  player.rotation.y = yaw;

  const distance = 7;
  const target = new THREE.Vector3(
    state.x - Math.sin(yaw) * distance,
    4 + pitch * 2,
    state.z + Math.cos(yaw) * distance
  );

  camera.position.lerp(target, 0.12);
  camera.lookAt(state.x, 1.4, state.z);

  for (const remote of remotes.values()) {
    remote.group.position.x = THREE.MathUtils.lerp(
      remote.group.position.x,
      remote.targetX,
      0.2
    );

    remote.group.position.z = THREE.MathUtils.lerp(
      remote.group.position.z,
      remote.targetZ,
      0.2
    );

    remote.group.rotation.y = remote.targetRotation;
  }

  if (now - lastBroadcast > 100 && channel) {
    lastBroadcast = now;

    channel.send({
      type: "broadcast",
      event: "position",
      payload: {
        id: playerId,
        name: playerName,
        x: state.x,
        z: state.z,
        rotation: yaw
      }
    }).catch((error) => console.error("Error de sincronización:", error));
  }

  renderer.render(scene, camera);
}

$("copyRoomButton").addEventListener("click", async () => {
  const invite = new URL(location.href);
  invite.searchParams.set("room", roomCode);

  try {
    await navigator.clipboard.writeText(invite.toString());
    $("notice").textContent = "¡Enlace copiado! Envíalo a tus amigos.";
  } catch {
    $("notice").textContent = "Comparte este enlace: " + invite.toString();
  }
});

$("leaveButton").addEventListener("click", leaveGame);

async function leaveGame() {
  joined = false;
  keys.clear();

  document.exitPointerLock?.();
  window.removeEventListener("resize", resize);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  document.removeEventListener("mousemove", onMouseMove);

  if (channel) {
    try {
      await channel.unsubscribe();
    } catch (error) {
      console.warn(error);
    }
  }

  channel = null;

  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
    renderer = null;
  }

  if (scene) {
    scene.traverse((object) => {
      if (object.isMesh || object.isSprite) {
        object.geometry?.dispose();

        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];

        materials.forEach(material => material?.dispose());
      }
    });
  }

  scene = null;
  camera = null;
  player = null;
  remotes.clear();

  game.hidden = true;
  menu.hidden = false;
  $("playerCount").textContent = "1";
  setStatus("Saliste de la sala. Puedes entrar nuevamente.");
}

const roomFromUrl = new URLSearchParams(location.search).get("room");

if (roomFromUrl && /^[A-Z0-9_-]{3,20}$/i.test(roomFromUrl)) {
  $("roomCode").value = roomFromUrl.toUpperCase();
}
