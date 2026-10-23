
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// CONFIGURA ESTOS DOS VALORES CON LOS DE TU PROYECTO SUPABASE
const SUPABASE_URL = "https://vlwfntwxbzmeodutbrxd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JKRwt7biD2Y9wCQpQC9iQA_-EDPL17V";

const $ = id => document.getElementById(id);
const MAX_PLAYERS = 10;
const MAX_HEALTH = 100;

const weapons = {
  1: { name: "Pistola", damage: 25, capacity: 12, rate: 350, reload: 1200, range: 70 },
  2: { name: "Rifle", damage: 12, capacity: 30, rate: 110, reload: 1700, range: 100 }
};

const id = crypto.randomUUID();
const keys = new Set();
const remotes = new Map();
const tracers = [];

let db, channel, scene, camera, renderer, player;
let name = "", room = "", started = false;
let yaw = 0, pitch = 0.15;
let x = 0, z = 0;
let health = MAX_HEALTH;
let weapon = 1;
let ammo = { 1: 12, 2: 30 };
let lastShot = 0, lastSync = 0, lastFrame = 0;
let reloading = false, reloadEnd = 0, respawnAt = 0;

const menu = $("menu");
const game = $("game");
const status = $("menuStatus");

function message(text) {
  $("notice").textContent = text;
}

function updateHealth() {
  $("healthText").textContent = `${health} / ${MAX_HEALTH}`;
  $("healthFill").style.width = `${health}%`;
  $("healthFill").style.background =
    health <= 30 ? "#e53935" : health <= 60 ? "#f0a32b" : "#20bd78";
}

function updateWeapon() {
  $("weaponText").textContent =
    `${weapons[weapon].name}: ${ammo[weapon]} / ${weapons[weapon].capacity}` +
    (reloading ? " · Recargando" : "");
}

function randomRoom() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

$("roomCode").value =
  new URLSearchParams(location.search).get("room")?.toUpperCase() || "";

$("joinButton").addEventListener("click", () => start(false));
$("createButton").addEventListener("click", () => start(true));

async function start(createNew) {
  if (started) return;

  name = $("playerName").value.trim().slice(0, 18);
  room = $("roomCode").value.trim().toUpperCase();

  if (!name) {
    status.textContent = "Escribe tu nombre.";
    return;
  }

  if (createNew || !room) room = randomRoom();

  if (!/^[A-Z0-9_-]{3,20}$/.test(room)) {
    status.textContent = "El código debe tener entre 3 y 20 letras o números.";
    return;
  }

  if (!SUPABASE_URL.startsWith("https://") ||
      SUPABASE_URL.includes("PEGA_AQUI") ||
      SUPABASE_ANON_KEY.includes("PEGA_AQUI") ||
      SUPABASE_ANON_KEY.length < 20) {
    status.textContent = "Primero configura la URL y la clave pública de Supabase en game.js.";
    return;
  }

  $("joinButton").disabled = true;
  $("createButton").disabled = true;
  status.textContent = "Conectando con Supabase...";

  try {
    db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    channel = db.channel("ciudad-" + room, {
      config: {
        broadcast: { self: false },
        presence: { key: id }
      }
    });

    channel.on("broadcast", { event: "position" }, ({ payload }) => {
      if (!payload || payload.id === id) return;
      let other = remotes.get(payload.id);
      if (!other) other = addRemote(payload);

      other.targetX = Number(payload.x) || 0;
      other.targetZ = Number(payload.z) || 0;
      other.targetYaw = Number(payload.yaw) || 0;

      if (Number.isFinite(payload.health)) other.health = payload.health;
      other.dead = Boolean(payload.dead);
      other.group.visible = !other.dead;
      colorRemote(other);
    });

    channel.on("broadcast", { event: "shot" }, ({ payload }) => {
      if (!payload || payload.id === id) return;
      drawTracer(
        new THREE.Vector3(payload.x, payload.y, payload.z),
        new THREE.Vector3(payload.dx, payload.dy, payload.dz),
        10,
        0xffd166
      );
    });

    channel.on("broadcast", { event: "damage" }, ({ payload }) => {
      if (!payload || payload.target !== id || payload.shooter === id) return;
      if (health <= 0) return;

      health = Math.max(0, health - Math.max(0, Number(payload.amount) || 0));
      updateHealth();

      if (health === 0) {
        respawnAt = performance.now() + 4000;
        message("Te eliminaron. Reaparecerás en 4 segundos.");
      } else {
        message(`${payload.shooterName || "Un jugador"} te disparó. Vida: ${health}`);
      }

      syncHealth();
    });

    channel.on("presence", { event: "sync" }, syncPlayers);

    await new Promise((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error("Tiempo agotado. Revisa la URL, la clave y Realtime."));
        }
      }, 15000);

      channel.subscribe(async result => {
        if (result === "SUBSCRIBED" && !done) {
          try {
            const current = Object.values(channel.presenceState()).flat();
            if (current.length >= MAX_PLAYERS) {
              done = true;
              clearTimeout(timeout);
              reject(new Error("La sala ya tiene 10 jugadores."));
              return;
            }

            await channel.track({
              id, name, x, z, yaw, health, dead: false
            });

            done = true;
            clearTimeout(timeout);
            resolve();
          } catch (err) {
            done = true;
            clearTimeout(timeout);
            reject(err);
          }
        }

        if ((result === "CHANNEL_ERROR" || result === "TIMED_OUT") && !done) {
          done = true;
          clearTimeout(timeout);
          reject(new Error("Supabase no pudo conectar con la sala."));
        }
      });
    });

    createWorld();
    started = true;
    menu.hidden = true;
    game.hidden = false;
    $("currentRoom").textContent = room;
    updateHealth();
    updateWeapon();

    const url = new URL(location.href);
    url.searchParams.set("room", room);
    history.replaceState(null, "", url);
    message("Conectado. Haz clic en la ciudad para jugar.");
    requestAnimationFrame(animate);

  } catch (err) {
    console.error(err);
    status.textContent = "Error: " + (err.message || "No se pudo conectar.");
    try { await channel?.unsubscribe(); } catch {}
    channel = null;
  } finally {
    $("joinButton").disabled = false;
    $("createButton").disabled = false;
  }
}

function syncPlayers() {
  if (!channel || !scene) return;

  const entries = Object.values(channel.presenceState()).flat();
  const activeIds = new Set();

  for (const data of entries) {
    if (!data.id || data.id === id) continue;
    activeIds.add(data.id);
    if (!remotes.has(data.id)) addRemote(data);
  }

  for (const [remoteId, other] of remotes) {
    if (!activeIds.has(remoteId)) {
      scene.remove(other.group);
      remotes.delete(remoteId);
    }
  }

  $("playerCount").textContent =
    String(Math.min(MAX_PLAYERS, new Set(entries.map(p => p.id)).size));
}

function createWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8bc7ed);
  scene.fog = new THREE.Fog(0x8bc7ed, 90, 250);

  camera = new THREE.PerspectiveCamera(
    70, window.innerWidth / window.innerHeight, 0.1, 500
  );

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  game.insertBefore(renderer.domElement, $("hud"));

  scene.add(new THREE.HemisphereLight(0xffffff, 0x53634b, 2));

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(40, 70, 30);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    new THREE.MeshStandardMaterial({ color: 0x4d844b })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Calles
  for (let n = -100; n <= 100; n += 40) {
    addBox(12, 0.08, 260, 0x343a40, n, 0.06, 0);
    addBox(260, 0.08, 12, 0x343a40, 0, 0.06, n);
    addBox(0.08, 0.02, 260, 0xe8dfb4, n, 0.11, 0);
    addBox(260, 0.02, 0.08, 0xe8dfb4, 0, 0.11, n);
  }

  // Edificios
  for (let bx = -90; bx <= 90; bx += 20) {
    for (let bz = -90; bz <= 90; bz += 20) {
      if (Math.abs(bx % 40) < 8 || Math.abs(bz % 40) < 8) continue;

      const w = 7 + Math.random() * 4;
      const d = 7 + Math.random() * 4;
      const h = 5 + Math.random() * 24;
      const color = new THREE.Color().setHSL(
        0.55 + Math.random() * 0.08,
        0.12 + Math.random() * 0.18,
        0.35 + Math.random() * 0.25
      );

      const building = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color })
      );
      building.position.set(
        bx + (Math.random() - 0.5) * 5,
        h / 2,
        bz + (Math.random() - 0.5) * 5
      );
      building.castShadow = true;
      building.receiveShadow = true;
      scene.add(building);
    }
  }

  player = createCharacter(0x20bd78, name);
  player.position.set(x, 0, z);
  scene.add(player);

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  document.addEventListener("mousemove", mouseMove);
  renderer.domElement.addEventListener("click", canvasClick);
  document.addEventListener("contextmenu", e => e.preventDefault());
}

function addBox(w, h, d, color, px, py, pz) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(px, py, pz);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function createCharacter(color, label) {
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
  group.add(head);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 42px Arial";
  ctx.textAlign = "center";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#111827";
  ctx.fillStyle = "white";
  ctx.strokeText(String(label).slice(0, 18), 256, 78);
  ctx.fillText(String(label).slice(0, 18), 256, 78);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );
  sprite.position.y = 2.7;
  sprite.scale.set(2.6, 0.65, 1);
  group.add(sprite);

  return group;
}

function addRemote(data) {
  if (!scene || !data.id || data.id === id) return null;

  const group = createCharacter(0xf0a33b, data.name || "Jugador");
  group.position.set(Number(data.x) || 0, 0, Number(data.z) || 0);
  scene.add(group);

  const other = {
    id: data.id,
    group,
    targetX: Number(data.x) || 0,
    targetZ: Number(data.z) || 0,
    targetYaw: Number(data.yaw) || 0,
    health: Number.isFinite(data.health) ? data.health : MAX_HEALTH,
    dead: Boolean(data.dead)
  };

  remotes.set(data.id, other);
  colorRemote(other);
  group.visible = !other.dead;
  return other;
}

function colorRemote(other) {
  const color = other.dead ? 0x555555 :
    other.health <= 30 ? 0xd92d20 : 0xf0a33b;

  other.group.children.forEach(obj => {
    if (obj.isMesh && obj.geometry.type === "BoxGeometry") {
      obj.material.color.set(color);
    }
  });
}

function canvasClick(event) {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock?.();
    return;
  }

  if (event.button === 0) shoot();
}

function keyDown(event) {
  const key = event.key.toLowerCase();

  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
    event.preventDefault();
  }

  if (!keys.has(key)) {
    if (key === "r") reload();
    if (key === "1" || key === "2") {
      weapon = Number(key);
      updateWeapon();
    }
  }

  keys.add(key);
}

function keyUp(event) {
  keys.delete(event.key.toLowerCase());
}

function mouseMove(event) {
  if (document.pointerLockElement !== renderer?.domElement) return;

  // Giro corregido: el ratón hacia la derecha mira hacia la derecha.
  yaw += event.movementX * 0.0025;
  pitch = THREE.MathUtils.clamp(
    pitch - event.movementY * 0.0015, -0.4, 0.7
  );
}

function reload() {
  if (!started || health <= 0 || reloading) return;

  if (ammo[weapon] >= weapons[weapon].capacity) {
    message("El cargador está lleno.");
    return;
  }

  reloading = true;
  reloadEnd = performance.now() + weapons[weapon].reload;
  updateWeapon();
  message("Recargando...");
}

function shoot() {
  if (!started || health <= 0 || reloading) return;

  const now = performance.now();
  const w = weapons[weapon];

  if (now - lastShot < w.rate) return;

  if (ammo[weapon] <= 0) {
    message("Sin munición. Pulsa R para recargar.");
    return;
  }

  lastShot = now;
  ammo[weapon]--;
  updateWeapon();

  const direction = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  ).normalize();

  const origin = camera.position.clone();
  const ray = new THREE.Raycaster(origin, direction, 0, w.range);
  const targets = [];

  for (const other of remotes.values()) {
    if (other.dead || !other.group.visible || other.health <= 0) continue;

    other.group.traverse(obj => {
      if (obj.isMesh) {
        obj.userData.targetPlayerId = other.id;
        targets.push(obj);
      }
    });
  }

  const hits = ray.intersectObjects(targets, false);
  let targetId = null;

  if (hits.length) {
    targetId = hits[0].object.userData.targetPlayerId;
  }

  if (targetId) {
    channel?.send({
      type: "broadcast",
      event: "damage",
      payload: {
        shooter: id,
        shooterName: name,
        target: targetId,
        amount: w.damage
      }
    });
    message("¡Disparo realizado!");
  }

  channel?.send({
    type: "broadcast",
    event: "shot",
    payload: {
      id,
      x: origin.x,
      y: origin.y,
      z: origin.z,
      dx: direction.x,
      dy: direction.y,
      dz: direction.z
    }
  });

  drawTracer(origin, direction, targetId ? 12 : 7, 0xfff3a3);
}

function drawTracer(origin, direction, length, color = 0xffd166) {
  if (!scene) return;

  const end = origin.clone().add(direction.clone().multiplyScalar(length));
  const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
  );

  scene.add(line);
  tracers.push({ line, expires: performance.now() + 100 });
}

function syncHealth() {
  channel?.send({
    type: "broadcast",
    event: "position",
    payload: {
      id, name, x, z, yaw, health, dead: health <= 0
    }
  });
}

function resize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(now = 0) {
  if (!started) return;
  requestAnimationFrame(animate);

  const delta = Math.min((now - lastFrame) / 1000 || 0, 0.05);
  lastFrame = now;

  if (reloading && now >= reloadEnd) {
    ammo[weapon] = weapons[weapon].capacity;
    reloading = false;
    updateWeapon();
    message("Cargador listo.");
  }

  if (health <= 0 && respawnAt && now >= respawnAt) {
    health = MAX_HEALTH;
    x = (Math.random() - 0.5) * 20;
    z = (Math.random() - 0.5) * 20;
    respawnAt = 0;
    updateHealth();
    message("Has reaparecido.");
    syncHealth();
  }

  if (health > 0) {
    let forward = 0, side = 0;

    if (keys.has("w") || keys.has("arrowup")) forward++;
    if (keys.has("s") || keys.has("arrowdown")) forward--;
    if (keys.has("d") || keys.has("arrowright")) side++;
    if (keys.has("a") || keys.has("arrowleft")) side--;

    const len = Math.hypot(forward, side) || 1;
    forward /= len;
    side /= len;

    const speed = 7 * (keys.has("shift") ? 1.7 : 1) * delta;

    x += (side * Math.cos(yaw) + forward * Math.sin(yaw)) * speed;
    z += (side * Math.sin(yaw) - forward * Math.cos(yaw)) * speed;

    x = THREE.MathUtils.clamp(x, -120, 120);
    z = THREE.MathUtils.clamp(z, -120, 120);
  }

  player.position.set(x, 0, z);
  player.rotation.y = yaw;

  const cameraTarget = new THREE.Vector3(
    x - Math.sin(yaw) * 7,
    4 + pitch * 2,
    z + Math.cos(yaw) * 7
  );

  camera.position.lerp(cameraTarget, 0.15);
  camera.lookAt(x, 1.4 + pitch * 2, z);

  for (const other of remotes.values()) {
    other.group.position.x = THREE.MathUtils.lerp(
      other.group.position.x, other.targetX, 0.2
    );
    other.group.position.z = THREE.MathUtils.lerp(
      other.group.position.z, other.targetZ, 0.2
    );
    other.group.rotation.y = other.targetYaw;
  }

  for (let i = tracers.length - 1; i >= 0; i--) {
    if (now >= tracers[i].expires) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers[i].line.material.dispose();
      tracers.splice(i, 1);
    }
  }

  if (now - lastSync > 100) {
    lastSync = now;

    channel?.send({
      type: "broadcast",
      event: "position",
      payload: {
        id, name, x, z, yaw, health, dead: health <= 0
      }
    });
  }

  renderer.render(scene, camera);
}

$("inviteButton").addEventListener("click", async () => {
  const url = new URL(location.href);
  url.searchParams.set("room", room);

  try {
    await navigator.clipboard.writeText(url.toString());
    message("Enlace de invitación copiado.");
  } catch {
    message("Comparte este enlace: " + url.toString());
  }
});

$("leaveButton").addEventListener("click", async () => {
  started = false;
  document.exitPointerLock?.();

  window.removeEventListener("resize", resize);
  window.removeEventListener("keydown", keyDown);
  window.removeEventListener("keyup", keyUp);
  document.removeEventListener("mousemove", mouseMove);

  try {
    await channel?.unsubscribe();
  } catch (err) {
    console.warn(err);
  }

  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
  }

  scene = null;
  camera = null;
  renderer = null;
  player = null;
  channel = null;
  remotes.clear();
  tracers.length = 0;
  keys.clear();

  health = MAX_HEALTH;
  ammo = { 1: 12, 2: 30 };
  weapon = 1;
  reloading = false;
  respawnAt = 0;
  x = 0;
  z = 0;
  yaw = 0;
  pitch = 0.15;

  game.hidden = true;
  menu.hidden = false;
  $("playerCount").textContent = "1";
  status.textContent = "Saliste de la sala. Puedes entrar otra vez.";
});
