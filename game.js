
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* CONFIGURACIÓN DE SUPABASE */
const SUPABASE_URL = "https://vlwfntwxbzmeodutbrxd.supabase.co";
const SUPABASE_KEY = "sb_publishable_JKRwt7biD2Y9wCQpQC9iQA_-EDPL17V";

const MAX_PLAYERS = 10;
const ROOM_NAME = "ciudad-publica-v1";
const MOVE_SPEED = 7;
const RUN_MULTIPLIER = 1.65;
const PLAYER_RADIUS = 0.55;

const $ = (id) => document.getElementById(id);

const menu = $("menu");
const game = $("game");
const joinForm = $("joinForm");
const playButton = $("playButton");
const playerNameInput = $("playerName");
const menuStatus = $("menuStatus");
const notice = $("notice");

let supabase = null;
let channel = null;
let scene = null;
let camera = null;
let renderer = null;
let player = null;
let weapon = null;
let animationId = 0;

let joined = false;
let connecting = false;
let playerName = "";
let yaw = 0;
let pitch = 0;
let lastFrame = 0;
let lastPositionBroadcast = 0;
let lastShot = 0;
let health = 100;
let score = 0;
let verticalVelocity = 0;
let onGround = true;
let isDead = false;
let respawnAt = 0;

const playerId = crypto.randomUUID();
const keys = new Set();
const remotes = new Map();
const buildingBoxes = [];

const state = {
  x: 0,
  z: 0,
  rotation: 0
};

function setMenuStatus(message) {
  menuStatus.textContent = message;
}

function setNotice(message) {
  notice.textContent = message;
}

function updateHUD() {
  $("health").textContent = String(health);
  $("score").textContent = String(score);
}

function flattenPresence(presence) {
  return Object.values(presence || {}).flat();
}

function getPlayerCount() {
  if (!channel) return 1;

  const entries = flattenPresence(channel.presenceState());
  const ids = new Set(entries.map((item) => item.id).filter(Boolean));

  ids.add(playerId);
  return Math.min(ids.size, MAX_PLAYERS);
}

function setPlayerCount() {
  $("playerCount").textContent = String(getPlayerCount());
}

function isSupabaseConfigured() {
  return SUPABASE_URL.startsWith("https://")
    && SUPABASE_KEY.startsWith("sb_publishable_");
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await startGame();
});

$("leaveButton").addEventListener("click", leaveGame);

async function startGame() {
  if (connecting || joined) return;

  playerName = playerNameInput.value.trim().slice(0, 18);

  if (!playerName) {
    setMenuStatus("Escribe tu nombre antes de entrar.");
    playerNameInput.focus();
    return;
  }

  if (!isSupabaseConfigured()) {
    setMenuStatus("Revisa la configuración de Supabase en game.js.");
    return;
  }

  connecting = true;
  playButton.disabled = true;
  setMenuStatus("Conectando con la sala pública...");

  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      realtime: {
        params: { eventsPerSecond: 20 }
      }
    });

    channel = supabase.channel(ROOM_NAME, {
      config: {
        broadcast: { self: false },
        presence: { key: playerId }
      }
    });

    channel.on("broadcast", { event: "position" }, ({ payload }) => {
      receivePosition(payload);
    });

    channel.on("broadcast", { event: "shot" }, ({ payload }) => {
      receiveShot(payload);
    });

    channel.on("broadcast", { event: "respawn" }, ({ payload }) => {
      receiveRespawn(payload);
    });

    channel.on("presence", { event: "sync" }, syncPlayers);

    await subscribeToRoom();

    createWorld();

    joined = true;
    menu.hidden = true;
    game.hidden = false;

    setNotice("Conectado. Haz clic en la ciudad para jugar.");
    setPlayerCount();
    updateHUD();

    $("lockMessage").hidden = false;

    renderer.domElement.addEventListener("click", onCanvasClick);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", resize);

    animationId = requestAnimationFrame(animate);
  } catch (error) {
    console.error("Error al iniciar:", error);
    setMenuStatus(error.message || "No se pudo conectar con la sala.");

    if (channel) {
      try {
        await channel.unsubscribe();
      } catch (unsubscribeError) {
        console.warn(unsubscribeError);
      }
    }

    channel = null;
    supabase = null;
    disposeWorld();
  } finally {
    connecting = false;
    playButton.disabled = false;
  }
}

function subscribeToRoom() {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error("La conexión tardó demasiado. Revisa Supabase y tu internet."));
    }, 10000);

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);

      if (error) reject(error);
      else resolve();
    }

    channel.subscribe(async (status) => {
      if (finished) return;

      if (status === "SUBSCRIBED") {
        try {
          const currentPlayers = new Set(
            flattenPresence(channel.presenceState())
              .map((item) => item.id)
              .filter(Boolean)
          );

          if (currentPlayers.size >= MAX_PLAYERS && !currentPlayers.has(playerId)) {
            await channel.unsubscribe();
            finish(new Error("La sala está llena. Intenta entrar más tarde."));
            return;
          }

          await channel.track({
            id: playerId,
            name: playerName,
            x: state.x,
            z: state.z,
            rotation: state.rotation,
            onlineAt: Date.now()
          });

          finish();
        } catch (error) {
          finish(error);
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        finish(new Error("Supabase no pudo conectar con la sala. Revisa la configuración de Realtime."));
      } else if (status === "CLOSED") {
        finish(new Error("La conexión con la sala se cerró."));
      }
    });
  });
}

function syncPlayers() {
  if (!channel || !scene || !joined) return;

  const entries = flattenPresence(channel.presenceState());
  const activeIds = new Set();

  for (const data of entries) {
    if (!data.id || data.id === playerId) continue;

    activeIds.add(data.id);

    if (!remotes.has(data.id)) {
      addRemote(data);
    } else {
      const remote = remotes.get(data.id);
      remote.name = data.name || remote.name;
    }

    const remote = remotes.get(data.id);
    if (remote) {
      remote.targetX = Number(data.x) || 0;
      remote.targetZ = Number(data.z) || 0;
      remote.targetRotation = Number(data.rotation) || 0;
    }
  }

  for (const [id, remote] of remotes) {
    if (!activeIds.has(id)) {
      scene.remove(remote.group);
      disposeObject(remote.group);
      remotes.delete(id);
    }
  }

  setPlayerCount();
}

function receivePosition(data) {
  if (!data || !data.id || data.id === playerId || !scene) return;
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

function addRemote(data) {
  if (!scene || !data.id || data.id === playerId) return;

  const group = createCharacter(0xf2a541, data.name || "Jugador");
  group.position.set(
    THREE.MathUtils.clamp(Number(data.x) || 0, -120, 120),
    0,
    THREE.MathUtils.clamp(Number(data.z) || 0, -120, 120)
  );
  group.rotation.y = Number(data.rotation) || 0;
  scene.add(group);

  remotes.set(data.id, {
    id: data.id,
    name: data.name || "Jugador",
    group,
    targetX: group.position.x,
    targetZ: group.position.z,
    targetRotation: group.rotation.y
  });
}

function createWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8bc7ed);
  scene.fog = new THREE.Fog(0x8bc7ed, 100, 250);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    400
  );

  renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance"
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  game.insertBefore(renderer.domElement, $("hud"));

  scene.add(new THREE.HemisphereLight(0xffffff, 0x66715e, 2));

  const sunlight = new THREE.DirectionalLight(0xffffff, 1.5);
  sunlight.position.set(50, 80, 30);
  scene.add(sunlight);

  createGround();
  createRoads();
  createBuildings();
  createTrees();

  player = createCharacter(0x27d7a0, playerName);
  player.position.set(state.x, 0, state.z);
  scene.add(player);

  createWeapon();
  updateCamera();
}

function createGround() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 280),
    new THREE.MeshLambertMaterial({ color: 0x60945a })
  );

  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);
}

function addBox(width, height, depth, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshLambertMaterial({ color })
  );

  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function createRoads() {
  for (let n = -120; n <= 120; n += 40) {
    addBox(12, 0.04, 280, 0x333a43, n, 0.01, 0);
    addBox(280, 0.04, 12, 0x333a43, 0, 0.01, n);

    addBox(0.12, 0.02, 280, 0xe4d8a8, n, 0.04, 0);
    addBox(280, 0.02, 0.12, 0xe4d8a8, 0, 0.04, n);
  }

  for (let n = -100; n <= 100; n += 40) {
    for (let offset = -4; offset <= 4; offset += 8) {
      addBox(0.25, 0.025, 2.5, 0xf3f0d7, n + offset, 0.05, 0);
      addBox(2.5, 0.025, 0.25, 0xf3f0d7, 0, 0.05, n + offset);
    }
  }
}

function createBuildings() {
  const colors = [
    0x778b9b, 0x9a9c9e, 0x727f8a,
    0xb5a895, 0x657987, 0xc1b7a2
  ];

  for (let x = -100; x <= 100; x += 20) {
    for (let z = -100; z <= 100; z += 20) {
      if (Math.abs(x % 40) < 8 || Math.abs(z % 40) < 8) continue;

      const width = 7 + Math.random() * 3;
      const depth = 7 + Math.random() * 3;
      const height = 5 + Math.random() * 20;
      const bx = x + (Math.random() - 0.5) * 3;
      const bz = z + (Math.random() - 0.5) * 3;

      const building = addBox(
        width, height, depth,
        colors[Math.floor(Math.random() * colors.length)],
        bx, height / 2, bz
      );

      buildingBoxes.push({
        minX: bx - width / 2 - PLAYER_RADIUS,
        maxX: bx + width / 2 + PLAYER_RADIUS,
        minZ: bz - depth / 2 - PLAYER_RADIUS,
        maxZ: bz + depth / 2 + PLAYER_RADIUS
      });

      // Ventanas agrupadas en una sola malla por edificio.
      const positions = [];
      const windowWidth = 0.7;
      const windowHeight = 0.9;
      const frontZ = bz + depth / 2 + 0.012;

      for (let wy = 1.4; wy < height - 1; wy += 2.8) {
        for (let wx = -width / 2 + 1; wx < width / 2 - 0.5; wx += 1.8) {
          positions.push(bx + wx, wy, frontZ);
        }
      }

      if (positions.length) {
        const windowGeometry = new THREE.BoxGeometry(
          windowWidth, windowHeight, 0.025
        );
        const windowMaterial = new THREE.MeshBasicMaterial({
          color: 0x9fd5e9
        });

        const windows = new THREE.InstancedMesh(
          windowGeometry,
          windowMaterial,
          positions.length / 3
        );

        const matrix = new THREE.Matrix4();

        for (let i = 0; i < positions.length; i += 3) {
          matrix.makeTranslation(
            positions[i],
            positions[i + 1],
            positions[i + 2]
          );
          windows.setMatrixAt(i / 3, matrix);
        }

        scene.add(windows);
      }
    }
  }
}

function createTrees() {
  const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.25, 1.5, 5);
  const leafGeometry = new THREE.ConeGeometry(1.1, 2.4, 6);
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x765037 });
  const leafMaterial = new THREE.MeshLambertMaterial({ color: 0x2e7142 });

  for (let i = 0; i < 65; i++) {
    const x = (Math.random() - 0.5) * 230;
    const z = (Math.random() - 0.5) * 230;

    if (Math.abs(x % 40) < 9 || Math.abs(z % 40) < 9) continue;

    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.set(x, 0.75, z);
    scene.add(trunk);

    const leaves = new THREE.Mesh(leafGeometry, leafMaterial);
    leaves.position.set(x, 2.6, z);
    scene.add(leaves);
  }
}

function createCharacter(color, name) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.2, 0.45),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 1.1;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xe9bd97 })
  );
  head.position.y = 1.95;
  group.add(head);

  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 128;

  const ctx = labelCanvas.getContext("2d");
  ctx.font = "bold 42px Arial";
  ctx.textAlign = "center";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#101820";
  ctx.fillStyle = "#ffffff";
  ctx.strokeText(String(name).slice(0, 18), 256, 78);
  ctx.fillText(String(name).slice(0, 18), 256, 78);

  const texture = new THREE.CanvasTexture(labelCanvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );

  sprite.position.y = 2.55;
  sprite.scale.set(2.5, 0.62, 1);
  group.add(sprite);

  return group;
}

function createWeapon() {
  weapon = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.15, 0.65),
    new THREE.MeshLambertMaterial({ color: 0x252a32 })
  );

  body.position.set(0.28, -0.25, -0.55);
  weapon.add(body);

  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.07, 0.42),
    new THREE.MeshLambertMaterial({ color: 0x626b75 })
  );

  barrel.position.set(0.28, -0.21, -1.05);
  weapon.add(barrel);

  camera.add(weapon);
  scene.add(camera);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh && !child.isSprite) return;

    child.geometry?.dispose();

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  });
}

function collides(x, z) {
  if (Math.abs(x) > 132 || Math.abs(z) > 132) return true;

  for (const box of buildingBoxes) {
    if (
      x > box.minX && x < box.maxX &&
      z > box.minZ && z < box.maxZ
    ) {
      return true;
    }
  }

  return false;
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();

  if (["w", "a", "s", "d", "arrowup", "arrowdown",
       "arrowleft", "arrowright", " "].includes(key)) {
    event.preventDefault();
  }

  keys.add(key);

  if (key === " " && onGround && !isDead) {
    verticalVelocity = 7;
    onGround = false;
  }
}

function onKeyUp(event) {
  keys.delete(event.key.toLowerCase());
}

function onCanvasClick() {
  if (!joined || !renderer) return;

  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock?.();
  } else {
    shoot();
  }
}

function onPointerLockChange() {
  $("lockMessage").hidden =
    document.pointerLockElement === renderer?.domElement;

  if (document.pointerLockElement !== renderer?.domElement) {
    keys.clear();
  }
}

function onMouseMove(event) {
  if (document.pointerLockElement !== renderer?.domElement) return;

  yaw -= event.movementX * 0.0022;
  pitch -= event.movementY * 0.0018;
  pitch = THREE.MathUtils.clamp(pitch, -1.1, 1.1);
}

function updateCamera() {
  if (!camera || !player) return;

  camera.position.set(
    state.x,
    player.position.y + 1.65,
    state.z
  );

  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  camera.rotation.z = 0;
}

function movePlayer(delta) {
  if (isDead) return;

  let forward = 0;
  let sideways = 0;

  if (keys.has("w") || keys.has("arrowup")) forward += 1;
  if (keys.has("s") || keys.has("arrowdown")) forward -= 1;
  if (keys.has("d") || keys.has("arrowright")) sideways += 1;
  if (keys.has("a") || keys.has("arrowleft")) sideways -= 1;

  const length = Math.hypot(forward, sideways);

  if (length > 0) {
    forward /= length;
    sideways /= length;
  }

  const speed = MOVE_SPEED * (keys.has("shift") ? RUN_MULTIPLIER : 1);

  const dx = (
    -Math.sin(yaw) * forward +
    Math.cos(yaw) * sideways
  ) * speed * delta;

  const dz = (
    -Math.cos(yaw) * forward -
    Math.sin(yaw) * sideways
  ) * speed * delta;

  const nextX = state.x + dx;
  const nextZ = state.z + dz;

  if (!collides(nextX, state.z)) state.x = nextX;
  if (!collides(state.x, nextZ)) state.z = nextZ;

  verticalVelocity -= 18 * delta;
  player.position.y += verticalVelocity * delta;

  if (player.position.y <= 0) {
    player.position.y = 0;
    verticalVelocity = 0;
    onGround = true;
  }

  player.position.x = state.x;
  player.position.z = state.z;
  player.rotation.y = yaw;

  state.rotation = yaw;
  updateCamera();
}

function shoot() {
  if (!joined || isDead || !channel) return;

  const now = performance.now();
  if (now - lastShot < 300) return;
  lastShot = now;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  const raycaster = new THREE.Raycaster(
    camera.position.clone(),
    direction,
    0,
    80
  );

  const targets = [];

  for (const remote of remotes.values()) {
    if (remote.group.visible) {
      remote.group.traverse((child) => {
        if (child.isMesh) targets.push(child);
      });
    }
  }

  const hits = raycaster.intersectObjects(targets, false);
  let targetId = null;

  if (hits.length > 0) {
    let object = hits[0].object;

    while (object.parent && !remotesHasGroup(object)) {
      object = object.parent;
    }

    for (const [id, remote] of remotes) {
      if (object === remote.group || remote.group === hits[0].object.parent) {
        targetId = id;
        break;
      }

      let parent = hits[0].object;
      while (parent) {
        if (parent === remote.group) {
          targetId = id;
          break;
        }
        parent = parent.parent;
      }

      if (targetId) break;
    }
  }

  channel.send({
    type: "broadcast",
    event: "shot",
    payload: {
      shooterId: playerId,
      targetId,
      shotId: crypto.randomUUID(),
      time: Date.now()
    }
  }).catch((error) => console.warn("No se pudo enviar el disparo:", error));

  setNotice(targetId ? "¡Impacto!" : "Disparo realizado.");
}

function remotesHasGroup(object) {
  for (const remote of remotes.values()) {
    if (remote.group === object) return true;
  }
  return false;
}

function receiveShot(data) {
  if (!data || !joined || data.shooterId === playerId) return;
  if (data.targetId !== playerId || isDead) return;

  health = Math.max(0, health - 25);
  updateHUD();

  if (health <= 0) {
    isDead = true;
    respawnAt = performance.now() + 2500;
    setNotice("Te eliminaron. Regresarás en unos segundos.");

    channel?.send({
      type: "broadcast",
      event: "respawn",
      payload: {
        playerId,
        killerId: data.shooterId,
        dead: true
      }
    }).catch((error) => console.warn(error));
  } else {
    setNotice("Te dispararon. Vida restante: " + health);
  }
}

function receiveRespawn(data) {
  if (!data || !joined) return;

  if (data.dead && data.killerId === playerId) {
    score += 1;
    updateHUD();
    setNotice("¡Eliminación conseguida! +1 baja");
  }

  if (data.playerId === playerId && !data.dead) {
    health = 100;
    isDead = false;
    state.x = (Math.random() - 0.5) * 12;
    state.z = (Math.random() - 0.5) * 12;
    player.position.set(state.x, 0, state.z);
    updateCamera();
    updateHUD();
    setNotice("Has regresado a la ciudad.");
    broadcastPosition();
    return;
  }

  if (data.dead && data.playerId !== playerId) {
    const remote = remotes.get(data.playerId);
    if (remote) {
      remote.group.visible = false;
      remote.respawnAt = performance.now() + 2500;
    }
  }
}

function broadcastPosition() {
  if (!channel || !joined) return;

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
  }).catch((error) => console.warn("Error al enviar posición:", error));
}

function animate(now = 0) {
  if (!joined) return;

  animationId = requestAnimationFrame(animate);

  const delta = Math.min((now - lastFrame) / 1000 || 0, 0.05);
  lastFrame = now;

  if (isDead && now >= respawnAt) {
    channel?.send({
      type: "broadcast",
      event: "respawn",
      payload: { playerId, dead: false }
    }).catch((error) => console.warn(error));
  }

  if (!isDead) movePlayer(delta);

  for (const remote of remotes.values()) {
    if (remote.respawnAt && now >= remote.respawnAt) {
      remote.group.visible = true;
      remote.group.position.set(
        (Math.random() - 0.5) * 12,
        0,
        (Math.random() - 0.5) * 12
      );
      remote.targetX = remote.group.position.x;
      remote.targetZ = remote.group.position.z;
      remote.respawnAt = 0;
    }

    remote.group.position.x = THREE.MathUtils.lerp(
      remote.group.position.x, remote.targetX, 0.18
    );

    remote.group.position.z = THREE.MathUtils.lerp(
      remote.group.position.z, remote.targetZ, 0.18
    );

    remote.group.rotation.y = remote.targetRotation;
  }

  if (now - lastPositionBroadcast > 80) {
    lastPositionBroadcast = now;
    broadcastPosition();
  }

  renderer.render(scene, camera);
}

function resize() {
  if (!camera || !renderer) return;

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function disposeWorld() {
  if (renderer) {
    renderer.domElement.removeEventListener("click", onCanvasClick);
    renderer.dispose();
    renderer.domElement.remove();
  }

  if (scene) {
    scene.traverse((object) => {
      if (!object.isMesh && !object.isSprite && !object.isInstancedMesh) return;

      object.geometry?.dispose();

      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    });
  }

  remotes.clear();
  buildingBoxes.length = 0;
  scene = null;
  camera = null;
  renderer = null;
  player = null;
  weapon = null;
}

async function leaveGame() {
  joined = false;
  connecting = false;
  cancelAnimationFrame(animationId);
  keys.clear();

  document.removeEventListener("pointerlockchange", onPointerLockChange);
  document.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("resize", resize);

  if (document.pointerLockElement) {
    document.exitPointerLock?.();
  }

  if (channel) {
    try {
      await channel.untrack();
      await channel.unsubscribe();
    } catch (error) {
      console.warn("Error al salir de la sala:", error);
    }
  }

  channel = null;
  supabase = null;

  disposeWorld();

  game.hidden = true;
  menu.hidden = false;
  playButton.disabled = false;

  health = 100;
  score = 0;
  isDead = false;
  state.x = 0;
  state.z = 0;
  yaw = 0;
  pitch = 0;

  updateHUD();
  setMenuStatus("Escribe tu nombre para volver a jugar.");
}
