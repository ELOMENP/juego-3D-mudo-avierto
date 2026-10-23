import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* =========================================
   CONFIGURACIÓN
========================================= */

const SUPABASE_URL = "https://vlwfntwxbzmeodutbrxd.supabase.co";
const SUPABASE_KEY = "sb_publishable_JKRwt7biD2Y9wCQpQC9iQA_-EDPL17V";

const ROOM_NAME = "ciudad-publica-v1";
const MAX_PLAYERS = 10;
const DOWN_TIME = 30;
const REVIVE_TIME = 4;
const PLAYER_MAX_HEALTH = 100;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const myId = crypto.randomUUID();

const $ = (id) => document.getElementById(id);

const menu = $("menu");
const playButton = $("playButton");
const playerNameInput = $("playerName");
const menuError = $("menuError");
const hud = $("hud");
const healthFill = $("healthFill");
const healthText = $("healthText");
const playerCountText = $("playerCount");
const killCountText = $("killCount");
const statusText = $("statusText");
const crosshair = $("crosshair");
const hitMarker = $("hitMarker");
const notice = $("notice");
const downScreen = $("downScreen");
const downTimer = $("downTimer");
const downTimerFill = $("downTimerFill");
const reviveStatus = $("reviveStatus");
const eliminatedScreen = $("eliminatedScreen");
const settingsMenu = $("settingsMenu");

let playerName = "Jugador";
let channel = null;
let connected = false;
let gameStarted = false;
let settingsOpen = false;

let mouseSensitivity = 0.0022;
let normalFov = 75;
let graphicsQuality = "medium";
let showCrosshair = true;

let lastBroadcast = 0;
let lastShot = 0;
let lastNoticeTimer = null;
let hitMarkerTimer = null;

const keys = Object.create(null);
let leftMouse = false;
let rightMouse = false;

const player = {
  position: new THREE.Vector3(0, 1.7, 6),
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  health: PLAYER_MAX_HEALTH,
  kills: 0,
  alive: true,
  downed: false,
  eliminated: false,
  downDeadline: 0,
  crouched: false,
  sliding: false,
  aiming: false,
  grounded: true,
  slideTimer: 0,
  reviveTargetId: null,
  reviveProgress: 0,
  revivedById: null
};

/* =========================================
   ESCENA
========================================= */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91c8e5);
scene.fog = new THREE.Fog(0x91c8e5, 80, 250);

const camera = new THREE.PerspectiveCamera(
  normalFov,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

camera.rotation.order = "YXZ";
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

renderer.domElement.style.position = "fixed";
renderer.domElement.style.inset = "0";
renderer.domElement.style.zIndex = "0";
document.body.prepend(renderer.domElement);

/* =========================================
   ILUMINACIÓN
========================================= */

scene.add(new THREE.HemisphereLight(0xdaf0ff, 0x52634d, 2));

const sunlight = new THREE.DirectionalLight(0xffffff, 2);
sunlight.position.set(-45, 85, 35);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(1024, 1024);
sunlight.shadow.camera.left = -100;
sunlight.shadow.camera.right = 100;
sunlight.shadow.camera.top = 100;
sunlight.shadow.camera.bottom = -100;
scene.add(sunlight);

/* =========================================
   MATERIALES Y CIUDAD
========================================= */

const mat = {
  ground: new THREE.MeshStandardMaterial({ color: 0x667765 }),
  road: new THREE.MeshStandardMaterial({ color: 0x343b43 }),
  sidewalk: new THREE.MeshStandardMaterial({ color: 0xa0a3a1 }),
  building: [
    new THREE.MeshStandardMaterial({ color: 0x9aa7ad }),
    new THREE.MeshStandardMaterial({ color: 0xc1b5a1 }),
    new THREE.MeshStandardMaterial({ color: 0x777e88 })
  ],
  window: new THREE.MeshStandardMaterial({
    color: 0x6db6d6,
    emissive: 0x183849,
    roughness: 0.3
  }),
  line: new THREE.MeshStandardMaterial({ color: 0xf1f1e8 })
};

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  mat.ground
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const buildings = [];

function box(parent, w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createBuilding(x, z, w, d, h, material) {
  const mesh = box(scene, w, h, d, x, h / 2, z, material);

  buildings.push({
    x,
    z,
    halfX: w / 2,
    halfZ: d / 2
  });

  const floors = Math.floor(h / 3.2);

  for (let floor = 0; floor < floors; floor++) {
    const y = 1.8 + floor * 3.2;
    if (y > h - 0.6) continue;

    for (let i = 0; i < Math.floor(w / 2.6); i++) {
      const wx = x - w / 2 + 1.3 + i * 2.6;

      box(scene, 0.9, 1.1, 0.06, wx, y, z + d / 2 + 0.04, mat.window);
      box(scene, 0.9, 1.1, 0.06, wx, y, z - d / 2 - 0.04, mat.window);
    }

    for (let i = 0; i < Math.floor(d / 2.6); i++) {
      const wz = z - d / 2 + 1.3 + i * 2.6;

      box(scene, 0.06, 1.1, 0.9, x + w / 2 + 0.04, y, wz, mat.window);
      box(scene, 0.06, 1.1, 0.9, x - w / 2 - 0.04, y, wz, mat.window);
    }
  }

  return mesh;
}

function road(x, z, w, d) {
  box(scene, w, 0.08, d, x, 0.02, z, mat.road);
}

function createCity() {
  road(0, 0, 260, 16);
  road(0, 0, 16, 260);
  road(0, 42, 260, 12);
  road(0, -42, 260, 12);
  road(42, 0, 12, 260);
  road(-42, 0, 12, 260);
  road(0, 82, 260, 10);
  road(0, -82, 260, 10);
  road(82, 0, 10, 260);
  road(-82, 0, 10, 260);

  for (let x = -110; x <= 110; x += 28) {
    for (let z = -110; z <= 110; z += 28) {
      if (Math.abs(x) < 13 || Math.abs(z) < 13) continue;
      if (Math.abs(Math.abs(x) - 42) < 7) continue;
      if (Math.abs(Math.abs(z) - 42) < 7) continue;

      const w = 10 + Math.random() * 5;
      const d = 10 + Math.random() * 5;
      const h = 8 + Math.random() * 23;
      const material = mat.building[
        Math.floor(Math.random() * mat.building.length)
      ];

      createBuilding(
        x + (Math.random() - 0.5) * 4,
        z + (Math.random() - 0.5) * 4,
        w, d, h, material
      );
    }
  }

  for (let i = -120; i <= 120; i += 8) {
    box(scene, 0.15, 0.025, 3, i, 0.075, 0, mat.line);
  }
}

createCity();

function blocked(x, z, radius = 0.5) {
  return buildings.some((b) =>
    Math.abs(x - b.x) < b.halfX + radius &&
    Math.abs(z - b.z) < b.halfZ + radius
  );
}

/* =========================================
   ARMA Y MANOS EN PRIMERA PERSONA
========================================= */

const weapon = new THREE.Group();
camera.add(weapon);

const skin = new THREE.MeshStandardMaterial({ color: 0xb97e59 });
const sleeve = new THREE.MeshStandardMaterial({ color: 0x273b4a });
const glove = new THREE.MeshStandardMaterial({ color: 0x252b30 });
const gun = new THREE.MeshStandardMaterial({
  color: 0x303943,
  metalness: 0.7,
  roughness: 0.3
});
const gunDark = new THREE.MeshStandardMaterial({
  color: 0x12171c,
  metalness: 0.4,
  roughness: 0.4
});
const gunBlue = new THREE.MeshStandardMaterial({
  color: 0x40bde0,
  metalness: 0.4
});

function wbox(w, h, d, x, y, z, material, rz = 0) {
  const mesh = box(weapon, w, h, d, x, y, z, material);
  mesh.rotation.z = rz;
  mesh.castShadow = false;
  return mesh;
}

function wcylinder(radius, length, x, y, z, material) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 12),
    material
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  weapon.add(mesh);
  return mesh;
}

wbox(0.22, 0.24, 0.72, -0.34, -0.48, -0.36, sleeve, -0.18);
wbox(0.22, 0.24, 0.72, 0.34, -0.43, -0.40, sleeve, 0.18);

wbox(0.19, 0.15, 0.24, -0.24, -0.37, -0.69, skin);
wbox(0.19, 0.15, 0.24, 0.25, -0.32, -0.70, skin);

wbox(0.20, 0.12, 0.20, -0.24, -0.39, -0.77, glove);
wbox(0.20, 0.12, 0.20, 0.25, -0.34, -0.78, glove);

wbox(0.16, 0.18, 0.65, 0.16, -0.28, -0.91, gun);
wcylinder(0.035, 0.55, 0.16, -0.25, -1.43, gunDark);
wcylinder(0.045, 0.08, 0.16, -0.25, -1.72, gun);

wbox(0.12, 0.16, 0.35, 0.16, -0.29, -0.43, gunDark);
wbox(0.11, 0.25, 0.13, 0.16, -0.46, -0.72, gunDark, -0.15);
wbox(0.11, 0.27, 0.16, 0.16, -0.49, -0.99, gunDark, -0.06);
wbox(0.08, 0.09, 0.13, 0.16, -0.15, -0.83, gunDark);
wbox(0.055, 0.025, 0.06, 0.16, -0.095, -0.84, gunBlue);
wbox(0.19, 0.14, 0.28, 0.16, -0.27, -1.15, gunDark);

weapon.position.set(0.02, -0.03, 0);

let weaponTime = 0;
let recoil = 0;

function animateWeapon(delta) {
  weaponTime += delta;

  const moving = keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD;
  const running = keys.ShiftLeft || keys.ShiftRight;
  const bob = moving ? (running ? 0.035 : 0.018) : 0.003;

  const xBob = Math.sin(weaponTime * 8) * bob;
  const yBob = Math.abs(Math.cos(weaponTime * 8)) * bob;

  const targetX = player.aiming ? -0.16 : 0.02;
  const targetY = player.aiming ? -0.13 : -0.03;
  const targetZ = player.aiming ? -0.06 : 0;

  weapon.position.x = THREE.MathUtils.lerp(weapon.position.x, targetX + xBob, 0.15);
  weapon.position.y = THREE.MathUtils.lerp(weapon.position.y, targetY + yBob + recoil, 0.18);
  weapon.position.z = THREE.MathUtils.lerp(weapon.position.z, targetZ, 0.15);

  weapon.rotation.z = THREE.MathUtils.lerp(
    weapon.rotation.z,
    player.sliding ? -0.12 : 0,
    0.15
  );

  recoil = THREE.MathUtils.lerp(recoil, 0, Math.min(1, delta * 12));
}

/* =========================================
   MODELOS DE PERSONAJES
========================================= */

const remotePlayers = new Map();
const npcs = [];

function createCharacter(name, color, isNPC = false) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe0b28e });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.38), bodyMat);
  body.position.y = 1.05;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 12), skinMat);
  head.position.y = 1.68;
  group.add(head);

  const legs = [];

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.65, 0.28), bodyMat);
    leg.position.set(side * 0.19, 0.33, 0);
    group.add(leg);
    legs.push(leg);
  }

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(10, 8, 236, 48);
  ctx.font = "bold 25px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = "white";
  ctx.fillText(name.slice(0, 16), 128, 40);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false
    })
  );

  sprite.position.y = 2.35;
  sprite.scale.set(2.4, 0.6, 1);
  group.add(sprite);

  group.userData = {
    name,
    isNPC,
    body,
    head,
    legs,
    health: 100,
    alive: true,
    downed: false,
    eliminated: false,
    downDeadline: 0,
    reviveProgress: 0,
    reviveTargetId: null,
    lastAttack: 0
  };

  return group;
}

/* =========================================
   NPC
========================================= */

function spawnNPC(i) {
  const colors = [0xc64e3d, 0x3f78b5, 0x5d9a66, 0xb2a04d];
  const npc = createCharacter("NPC " + (i + 1), colors[i % colors.length], true);

  let x = 0;
  let z = 0;
  let tries = 0;

  do {
    x = (Math.random() - 0.5) * 180;
    z = (Math.random() - 0.5) * 180;
    tries++;
  } while ((blocked(x, z) || Math.hypot(x, z) < 18) && tries < 100);

  npc.position.set(x, 0, z);
  npc.userData.direction = Math.random() * Math.PI * 2;
  npc.userData.moveTimer = 1 + Math.random() * 3;
  npc.userData.spawnX = x;
  npc.userData.spawnZ = z;

  scene.add(npc);
  npcs.push(npc);
}

for (let i = 0; i < 12; i++) spawnNPC(i);

/* =========================================
   AVISOS Y HUD
========================================= */

function showNotice(message) {
  notice.textContent = message;
  notice.style.opacity = "1";
  clearTimeout(lastNoticeTimer);

  lastNoticeTimer = setTimeout(() => {
    notice.style.opacity = "0";
  }, 1800);
}

function showHit() {
  hitMarker.style.display = "block";
  clearTimeout(hitMarkerTimer);

  hitMarkerTimer = setTimeout(() => {
    hitMarker.style.display = "none";
  }, 120);
}

function updateHUD() {
  const hp = Math.ceil(Math.max(0, player.health));

  healthText.textContent = `${hp} / ${PLAYER_MAX_HEALTH}`;
  healthFill.style.width = `${hp}%`;

  healthFill.style.background =
    hp > 60 ? "#48e58c" :
    hp > 30 ? "#ffd04a" : "#ff4545";

  killCountText.textContent = `Bajas: ${player.kills}`;

  if (player.eliminated) statusText.textContent = "ELIMINADO";
  else if (player.downed) statusText.textContent = "DERRIBADO";
  else if (player.sliding) statusText.textContent = "DESLIZÁNDOTE";
  else if (player.crouched) statusText.textContent = "AGACHADO";
  else if (player.aiming) statusText.textContent = "APUNTANDO";
  else statusText.textContent = "LISTO PARA COMBATIR";
}

function updatePlayerCount() {
  playerCountText.textContent =
    `Jugadores: ${Math.min(MAX_PLAYERS, remotePlayers.size + 1)}/${MAX_PLAYERS}`;
}

/* =========================================
   MENSAJES MULTIJUGADOR
========================================= */

function send(event, payload = {}) {
  if (!channel || !connected) return;

  channel.send({
    type: "broadcast",
    event,
    payload: {
      id: myId,
      name: playerName,
      ...payload
    }
  }).catch((error) => console.warn("Error de red:", error));
}

function createRemote(data) {
  if (remotePlayers.has(data.id)) return remotePlayers.get(data.id);
  if (remotePlayers.size >= MAX_PLAYERS - 1) return null;

  const avatar = createCharacter(data.name || "Jugador", 0x3d9bdb);
  avatar.userData.remoteId = data.id;
  avatar.userData.lastUpdate = performance.now();

  scene.add(avatar);

  const remote = {
    id: data.id,
    name: data.name || "Jugador",
    avatar,
    health: 100,
    alive: true,
    downed: false,
    eliminated: false,
    downDeadline: 0,
    lastUpdate: performance.now(),
    reviveProgress: 0,
    reviveTargetId: null
  };

  remotePlayers.set(data.id, remote);
  updatePlayerCount();
  return remote;
}

function setRemoteDowned(remote, deadline) {
  remote.downed = true;
  remote.alive = false;
  remote.eliminated = false;
  remote.downDeadline = deadline || Date.now() + DOWN_TIME * 1000;
  remote.health = 0;
  remote.avatar.visible = true;
  remote.avatar.rotation.z = -Math.PI / 2;
  remote.avatar.position.y = 0.35;
}

function setRemoteEliminated(remote) {
  remote.downed = false;
  remote.alive = false;
  remote.eliminated = true;
  remote.health = 0;
  remote.avatar.visible = false;
  remote.reviveTargetId = null;
}

function setRemoteRevived(remote, payload) {
  remote.downed = false;
  remote.alive = true;
  remote.eliminated = false;
  remote.health = PLAYER_MAX_HEALTH;
  remote.reviveTargetId = null;
  remote.avatar.rotation.z = 0;
  remote.avatar.position.y = 0;
  remote.avatar.visible = true;

  if (Number.isFinite(payload.x) && Number.isFinite(payload.z)) {
    remote.avatar.position.set(payload.x, 0, payload.z);
  }
}

function handleMessage(event, p) {
  if (!p || !p.id || p.id === myId) return;

  if (event === "position") {
    let r = remotePlayers.get(p.id);
    if (!r) r = createRemote(p);
    if (!r) return;

    r.name = p.name || r.name;
    r.lastUpdate = performance.now();

    if (Number.isFinite(p.x) && Number.isFinite(p.z) && !r.downed && !r.eliminated) {
      r.avatar.position.set(p.x, 0, p.z);
      r.avatar.rotation.y = Number.isFinite(p.yaw) ? p.yaw : 0;
    }

    if (typeof p.crouched === "boolean" && !r.downed) {
      r.avatar.scale.y = p.crouched ? 0.75 : 1;
    }

    if (p.health !== undefined && Number.isFinite(p.health)) {
      r.health = THREE.MathUtils.clamp(p.health, 0, 100);
    }
  }

  if (event === "downed") {
    const r = remotePlayers.get(p.targetId);
    if (r) setRemoteDowned(r, p.deadline);
  }

  if (event === "finish") {
    const r = remotePlayers.get(p.targetId);
    if (r) setRemoteEliminated(r);
  }

  if (event === "revived") {
    const r = remotePlayers.get(p.targetId);
    if (r) setRemoteRevived(r, p);
  }

  if (event === "respawn") {
    const r = remotePlayers.get(p.id);
    if (r) {
      setRemoteRevived(r, p);
      r.health = 100;
    }
  }

  if (event === "hit") {
    if (p.targetId === myId) {
      receiveDamage(
        Number(p.damage) || 0,
        p.attackerName || "Jugador",
        !!p.headshot,
        !!p.finish
      );
    }
  }

  if (event === "reviveProgress") {
    const r = remotePlayers.get(p.targetId);
    if (r) r.reviveTargetId = p.reviverId || null;
  }

  if (event === "shot") {
    if ([p.sx, p.sy, p.sz, p.ex, p.ey, p.ez].every(Number.isFinite)) {
      createTracer(
        new THREE.Vector3(p.sx, p.sy, p.sz),
        new THREE.Vector3(p.ex, p.ey, p.ez),
        0xffd36a
      );
    }
  }
}

async function connectMultiplayer() {
  channel = supabase.channel(ROOM_NAME, {
    config: {
      broadcast: { self: false },
      presence: { key: myId }
    }
  });

  for (const event of [
    "position", "downed", "finish", "revived",
    "respawn", "hit", "reviveProgress", "shot"
  ]) {
    channel.on("broadcast", { event }, ({ payload }) => {
      handleMessage(event, payload);
    });
  }

  channel.on("presence", { event: "sync" }, () => {
    const count = Object.keys(channel.presenceState()).length;

    if (count > MAX_PLAYERS) {
      showNotice("La sala puede superar el límite: hace falta control del servidor.");
    }
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Tiempo agotado al conectar con Supabase.")),
      12000
    );

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        connected = true;

        try {
          await channel.track({ id: myId, name: playerName });
        } catch (e) {
          console.warn("Presence:", e);
        }

        resolve();
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error("No se pudo conectar con Supabase Realtime."));
      }
    });
  });
}

/* =========================================
   DISPAROS Y PROYECTILES
========================================= */

const raycaster = new THREE.Raycaster();
raycaster.far = 120;

const tracers = [];

function createTracer(start, end, color = 0xffd36a) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95
  });

  const line = new THREE.Line(geometry, material);
  line.userData.life = 0.1;
  scene.add(line);
  tracers.push(line);
}

function updateTracers(delta) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const line = tracers[i];
    line.userData.life -= delta;

    if (line.userData.life <= 0) {
      scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
      tracers.splice(i, 1);
    }
  }
}

function targetParts() {
  const list = [];

  for (const npc of npcs) {
    if (npc.userData.alive || npc.userData.downed) {
      list.push(npc.userData.head, npc.userData.body);
    }
  }

  for (const r of remotePlayers.values()) {
    if (r.avatar.visible && !r.eliminated) {
      list.push(r.avatar.userData.head, r.avatar.userData.body);
    }
  }

  return list;
}

function getOwner(object) {
  for (const npc of npcs) {
    if (object === npc.userData.head || object === npc.userData.body) {
      return { type: "npc", target: npc };
    }
  }

  for (const r of remotePlayers.values()) {
    if (object === r.avatar.userData.head || object === r.avatar.userData.body) {
      return { type: "remote", target: r };
    }
  }

  return null;
}

function shoot() {
  if (
    !gameStarted || settingsOpen ||
    !player.alive || player.downed || player.eliminated ||
    document.pointerLockElement !== renderer.domElement
  ) return;

  const now = performance.now();
  if (now - lastShot < 160) return;
  lastShot = now;
  recoil = 0.09;

  camera.updateMatrixWorld(true);

  const start = camera.position.clone();
  const direction = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(camera.quaternion)
    .normalize();

  raycaster.set(start, direction);

  const hits = raycaster.intersectObjects(targetParts(), false);
  const end = hits.length
    ? hits[0].point.clone()
    : start.clone().add(direction.multiplyScalar(100));

  createTracer(start, end);

  send("shot", {
    sx: start.x, sy: start.y, sz: start.z,
    ex: end.x, ey: end.y, ez: end.z
  });

  if (!hits.length) return;

  const hit = hits[0];
  const owner = getOwner(hit.object);
  if (!owner) return;

  const headshot = hit.object === owner.target.userData.head;
  showHit();

  if (owner.type === "npc") {
    damageNPC(owner.target, headshot ? 100 : 34, headshot);
    return;
  }

  const target = owner.target;

  if (target.downed) {
    // Un segundo impacto contra un jugador derribado lo remata.
    send("hit", {
      targetId: target.id,
      damage: 100,
      finish: true,
      headshot,
      attackerName: playerName
    });

    target.downed = false;
    target.eliminated = true;
    target.alive = false;
    target.avatar.visible = false;

    showNotice("¡REMATE!");
    player.kills++;
    updateHUD();

    send("finish", { targetId: target.id, attackerId: myId });
    return;
  }

  if (!target.alive || target.eliminated) return;

  const damage = headshot ? 100 : 34;

  send("hit", {
    targetId: target.id,
    damage,
    headshot,
    attackerName: playerName,
    finish: false
  });

  // Predicción visual del cliente atacante; el servidor debería validar el resultado.
  target.health = Math.max(0, target.health - damage);

  if (target.health <= 0) {
    target.downed = true;
    target.alive = false;
    target.downDeadline = Date.now() + DOWN_TIME * 1000;
    setRemoteDowned(target, target.downDeadline);

    send("downed", {
      targetId: target.id,
      deadline: target.downDeadline,
      attackerId: myId
    });

    showNotice("JUGADOR DERRIBADO");
  } else {
    showNotice(headshot ? "IMPACTO EN LA CABEZA" : "IMPACTO");
  }
}

function damageNPC(npc, damage, headshot) {
  if (!npc.userData.alive) return;

  npc.userData.health -= damage;

  if (headshot) showNotice("¡DISPARO A LA CABEZA!");

  if (npc.userData.health <= 0) {
    npc.userData.health = 0;
    npc.userData.alive = false;
    npc.visible = false;

    player.kills++;
    updateHUD();
    showNotice("NPC ELIMINADO");

    setTimeout(() => {
      let x = 0, z = 0, attempts = 0;

      do {
        x = (Math.random() - 0.5) * 180;
        z = (Math.random() - 0.5) * 180;
        attempts++;
      } while ((blocked(x, z) || Math.hypot(x, z) < 18) && attempts < 100);

      npc.position.set(x, 0, z);
      npc.userData.health = 100;
      npc.userData.alive = true;
      npc.visible = true;
    }, 5000);
  }
}

/* =========================================
   DERRIBO, REMATE Y REANIMACIÓN
========================================= */

function becomeDowned(attackerName) {
  if (player.downed || player.eliminated) return;

  player.health = 0;
  player.alive = false;
  player.downed = true;
  player.eliminated = false;
  player.downDeadline = Date.now() + DOWN_TIME * 1000;
  player.velocity.set(0, 0, 0);
  player.reviveProgress = 0;
  player.reviveTargetId = null;

  downScreen.classList.remove("hidden");
  eliminatedScreen.classList.add("hidden");

  if (document.pointerLockElement) document.exitPointerLock();

  send("downed", {
    targetId: myId,
    deadline: player.downDeadline
  });

  updateHUD();
  showNotice(`${attackerName} te derribó`);
}

function finishPlayer(attackerName) {
  if (player.eliminated) return;

  player.downed = false;
  player.alive = false;
  player.eliminated = true;
  player.health = 0;
  player.reviveTargetId = null;

  downScreen.classList.add("hidden");
  eliminatedScreen.classList.remove("hidden");

  send("finish", {
    targetId: myId,
    attackerName
  });

  updateHUD();
  showNotice("HAS SIDO REMATADO");
}

function receiveDamage(amount, attackerName, headshot = false, finish = false) {
  if (finish && player.downed) {
    finishPlayer(attackerName);
    return;
  }

  if (player.eliminated) return;

  if (player.downed) {
    finishPlayer(attackerName);
    return;
  }

  if (!player.alive) return;

  player.health = Math.max(0, player.health - amount);
  updateHUD();

  if (player.health <= 0) {
    becomeDowned(attackerName);
  } else {
    showNotice(headshot ? "TE DIERON EN LA CABEZA" : "RECIBISTE DAÑO");
  }
}

function revivePlayer(reviverId) {
  if (!player.downed || player.eliminated) return;

  player.downed = false;
  player.eliminated = false;
  player.alive = true;
  player.health = 50;
  player.downDeadline = 0;
  player.reviveProgress = 0;
  player.reviveTargetId = null;
  player.velocity.set(0, 0, 0);

  downScreen.classList.add("hidden");
  eliminatedScreen.classList.add("hidden");

  send("revived", {
    targetId: myId,
    reviverId,
    x: player.position.x,
    z: player.position.z,
    health: player.health
  });

  updateHUD();
  showNotice("¡TE HAN REANIMADO!");
}

function respawnPlayer() {
  player.position.set(0, 1.7, 6);
  player.velocity.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
  player.health = PLAYER_MAX_HEALTH;
  player.alive = true;
  player.downed = false;
  player.eliminated = false;
  player.crouched = false;
  player.sliding = false;
  player.aiming = false;
  player.downDeadline = 0;
  player.reviveProgress = 0;
  player.reviveTargetId = null;

  downScreen.classList.add("hidden");
  eliminatedScreen.classList.add("hidden");

  send("respawn", {
    x: player.position.x,
    z: player.position.z,
    health: player.health
  });

  updateHUD();
  showNotice("HAS REAPARECIDO");
}

function updateDowned(delta) {
  if (!player.downed) return;

  const remaining = Math.max(0, (player.downDeadline - Date.now()) / 1000);

  downTimer.textContent = String(Math.ceil(remaining));
  downTimerFill.style.width = `${(remaining / DOWN_TIME) * 100}%`;

  if (remaining <= 0) {
    finishPlayer("Tiempo agotado");
  }
}

function findNearbyDowned() {
  let nearest = null;
  let nearestDistance = Infinity;

  for (const r of remotePlayers.values()) {
    if (!r.downed || r.eliminated) continue;

    const distance = Math.hypot(
      player.position.x - r.avatar.position.x,
      player.position.z - r.avatar.position.z
    );

    if (distance < 3 && distance < nearestDistance) {
      nearest = r;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function updateRevive(delta) {
  if (!player.alive || player.downed || player.eliminated || settingsOpen) {
    player.reviveTargetId = null;
    player.reviveProgress = 0;
    return;
  }

  const target = findNearbyDowned();

  if (!target || !keys.KeyE) {
    if (player.reviveTargetId) {
      send("reviveProgress", {
        targetId: player.reviveTargetId,
        reviverId: myId,
        progress: 0
      });
    }

    player.reviveTargetId = null;
    player.reviveProgress = 0;
    reviveStatus.textContent = "Espera a un compañero";
    return;
  }

  if (player.reviveTargetId !== target.id) {
    player.reviveTargetId = target.id;
    player.reviveProgress = 0;
  }

  player.reviveProgress += delta;
  const progress = Math.min(1, player.reviveProgress / REVIVE_TIME);

  send("reviveProgress", {
    targetId: target.id,
    reviverId: myId,
    progress
  });

  showNotice(`REANIMANDO: ${Math.ceil(REVIVE_TIME - player.reviveProgress)} s`);

  if (player.reviveProgress >= REVIVE_TIME) {
    send("revived", {
      targetId: target.id,
      reviverId: myId,
      x: target.avatar.position.x,
      z: target.avatar.position.z,
      health: 50
    });

    setRemoteRevived(target, {
      x: target.avatar.position.x,
      z: target.avatar.position.z
    });

    player.reviveTargetId = null;
    player.reviveProgress = 0;
    showNotice(`${target.name} ha sido reanimado`);
  }
}

/* =========================================
   MOVIMIENTO
========================================= */

const PLAYER_HEIGHT = 1.7;
const GRAVITY = 22;
const JUMP_FORCE = 7.5;

function startCrouchOrSlide() {
  if (!player.alive || player.downed || player.eliminated) return;

  if (player.sliding) {
    player.sliding = false;
    player.crouched = false;
    player.slideTimer = 0;
    showNotice("DESLIZAMIENTO CANCELADO");
    return;
  }

  const moving = keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD;

  if ((keys.ShiftLeft || keys.ShiftRight) && moving && !player.crouched) {
    player.sliding = true;
    player.crouched = true;
    player.slideTimer = 0.75;
    showNotice("DESLIZAMIENTO");
  } else {
    player.crouched = !player.crouched;
    player.sliding = false;
  }
}

function movePlayer(dx, dz) {
  const nextX = player.position.x + dx;
  const nextZ = player.position.z + dz;

  if (!blocked(nextX, player.position.z, 0.45)) {
    player.position.x = nextX;
  }

  if (!blocked(player.position.x, nextZ, 0.45)) {
    player.position.z = nextZ;
  }

  player.position.x = THREE.MathUtils.clamp(player.position.x, -125, 125);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -125, 125);
}

function updateMovement(delta) {
  if (!player.alive || player.downed || player.eliminated || settingsOpen) return;

  if (player.sliding) {
    player.slideTimer -= delta;

    if (player.slideTimer <= 0) {
      player.sliding = false;
      player.crouched = true;
    }
  }

  const forward = new THREE.Vector3(
    -Math.sin(player.yaw), 0, -Math.cos(player.yaw)
  );

  const right = new THREE.Vector3(
    Math.cos(player.yaw), 0, -Math.sin(player.yaw)
  );

  const move = new THREE.Vector3();

  if (keys.KeyW) move.add(forward);
  if (keys.KeyS) move.sub(forward);
  if (keys.KeyD) move.add(right);
  if (keys.KeyA) move.sub(right);

  if (move.lengthSq() > 0) move.normalize();

  let speed = 7;

  if (player.sliding) speed = 15;
  else if (player.crouched) speed = 3.5;
  else if (keys.ShiftLeft || keys.ShiftRight) speed = 11;

  if (player.aiming) speed *= 0.65;

  movePlayer(move.x * speed * delta, move.z * speed * delta);

  if (player.grounded && keys.Space && !player.crouched) {
    player.velocity.y = JUMP_FORCE;
    player.grounded = false;
  }

  player.velocity.y -= GRAVITY * delta;
  player.position.y += player.velocity.y * delta;

  if (player.position.y <= PLAYER_HEIGHT) {
    player.position.y = PLAYER_HEIGHT;
    player.velocity.y = 0;
    player.grounded = true;
  }

  camera.position.copy(player.position);

  if (player.sliding) camera.position.y -= 1.05;
  else if (player.crouched) camera.position.y -= 0.65;

  camera.rotation.order = "YXZ";
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.rotation.z = player.sliding ? 0.035 : 0;
}

function updateAiming() {
  player.aiming = rightMouse && !settingsOpen && player.alive && !player.downed;

  const targetFov = player.aiming ? Math.min(48, normalFov) : normalFov;

  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.2);
  camera.updateProjectionMatrix();

  crosshair.style.opacity = player.aiming ? "0.45" : "1";
  crosshair.style.display = showCrosshair ? "block" : "none";
}

/* =========================================
   NPC: MOVIMIENTO Y ATAQUES
========================================= */

function updateNPCs(delta) {
  for (const npc of npcs) {
    if (!npc.userData.alive) continue;

    const distance = Math.hypot(
      npc.position.x - player.position.x,
      npc.position.z - player.position.z
    );

    if (distance < 13 && player.alive && !player.downed) {
      npc.lookAt(player.position.x, 0, player.position.z);

      if (distance < 8 && performance.now() - npc.userData.lastAttack > 1400) {
        npc.userData.lastAttack = performance.now();
        if (Math.random() < 0.3) receiveDamage(5, npc.userData.name);
      }
    } else {
      npc.userData.moveTimer -= delta;

      if (npc.userData.moveTimer <= 0) {
        npc.userData.moveTimer = 1 + Math.random() * 3;
        npc.userData.direction += (Math.random() - 0.5) * 2.4;
      }

      const dx = Math.sin(npc.userData.direction) * delta;
      const dz = Math.cos(npc.userData.direction) * delta;

      if (!blocked(npc.position.x + dx, npc.position.z + dz)) {
        npc.position.x += dx;
        npc.position.z += dz;
      } else {
        npc.userData.direction += Math.PI / 2;
      }

      npc.rotation.y = npc.userData.direction;
    }
  }
}

/* =========================================
   SINCRONIZACIÓN
========================================= */

function updateNetwork() {
  if (!connected || performance.now() - lastBroadcast < 100) return;
  lastBroadcast = performance.now();

  send("position", {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    yaw: player.yaw,
    health: player.health,
    alive: player.alive,
    downed: player.downed,
    eliminated: player.eliminated,
    crouched: player.crouched,
    sliding: player.sliding
  });
}

setInterval(() => {
  const now = performance.now();

  for (const [id, r] of remotePlayers) {
    if (now - r.lastUpdate > 15000) {
      scene.remove(r.avatar);
      remotePlayers.delete(id);
    }
  }

  updatePlayerCount();
}, 3000);

/* =========================================
   CONTROLES DEL TECLADO
========================================= */

window.addEventListener("keydown", (event) => {
  if (event.code === "Tab" && gameStarted) {
    event.preventDefault();
    toggleSettings();
    return;
  }

  keys[event.code] = true;

  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
  }

  if (!gameStarted || event.repeat) return;

  if (event.code === "KeyC") startCrouchOrSlide();

  if (event.code === "KeyE" && player.eliminated) respawnPlayer();
});

window.addEventListener("keyup", (event) => {
  keys[event.code] = false;
});

renderer.domElement.addEventListener("click", () => {
  if (gameStarted && !settingsOpen && !player.downed && !player.eliminated) {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== renderer.domElement) {
    leftMouse = false;
    rightMouse = false;
  }
});

document.addEventListener("mousemove", (event) => {
  if (
    !gameStarted || settingsOpen ||
    document.pointerLockElement !== renderer.domElement ||
    !player.alive || player.downed || player.eliminated
  ) return;

  const sensitivity = mouseSensitivity * (player.aiming ? 0.64 : 1);

  player.yaw -= event.movementX * sensitivity;
  player.pitch -= event.movementY * sensitivity;

  player.pitch = THREE.MathUtils.clamp(
    player.pitch,
    -Math.PI / 2 + 0.05,
    Math.PI / 2 - 0.05
  );
});

document.addEventListener("mousedown", (event) => {
  if (!gameStarted || settingsOpen) return;

  if (event.button === 0) {
    leftMouse = true;
    shoot();
  }

  if (event.button === 2) rightMouse = true;
});

document.addEventListener("mouseup", (event) => {
  if (event.button === 0) leftMouse = false;
  if (event.button === 2) rightMouse = false;
});

document.addEventListener("contextmenu", (event) => {
  if (gameStarted) event.preventDefault();
});

/* =========================================
   AJUSTES CON TAB
========================================= */

const sensitivityInput = $("sensitivity");
const sensitivityValue = $("sensitivityValue");
const fovInput = $("fovSetting");
const fovValue = $("fovValue");
const graphicsSelect = $("graphicsSetting");
const crosshairInput = $("crosshairSetting");

function openSettings() {
  if (!gameStarted || settingsOpen) return;

  settingsOpen = true;
  leftMouse = false;
  rightMouse = false;
  settingsMenu.classList.remove("hidden");

  if (document.pointerLockElement) document.exitPointerLock();
}

function closeSettings() {
  if (!settingsOpen) return;

  settingsOpen = false;
  settingsMenu.classList.add("hidden");

  if (gameStarted && player.alive && !player.downed && !player.eliminated) {
    renderer.domElement.requestPointerLock();
  }
}

function toggleSettings() {
  if (settingsOpen) closeSettings();
  else openSettings();
}

$("resumeButton").addEventListener("click", closeSettings);

sensitivityInput.addEventListener("input", () => {
  const value = Number(sensitivityInput.value);
  mouseSensitivity = value / 1000;
  sensitivityValue.textContent = value.toFixed(1);
});

fovInput.addEventListener("input", () => {
  normalFov = Number(fovInput.value);
  fovValue.textContent = String(normalFov);

  if (!player.aiming) {
    camera.fov = normalFov;
    camera.updateProjectionMatrix();
  }
});

graphicsSelect.addEventListener("change", () => {
  graphicsQuality = graphicsSelect.value;

  if (graphicsQuality === "low") {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
  } else if (graphicsQuality === "medium") {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
});

crosshairInput.addEventListener("change", () => {
  showCrosshair = crosshairInput.checked;
  crosshair.style.display = showCrosshair ? "block" : "none";
});

$("resetSettingsButton").addEventListener("click", () => {
  sensitivityInput.value = "2.2";
  fovInput.value = "75";
  graphicsSelect.value = "medium";
  crosshairInput.checked = true;

  mouseSensitivity = 0.0022;
  normalFov = 75;
  graphicsQuality = "medium";
  showCrosshair = true;

  sensitivityValue.textContent = "2.2";
  fovValue.textContent = "75";
  crosshair.style.display = "block";

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.fov = normalFov;
  camera.updateProjectionMatrix();

  showNotice("AJUSTES RESTABLECIDOS");
});

/* =========================================
   INICIO
========================================= */

playButton.addEventListener("click", async () => {
  if (gameStarted) return;

  playerName = playerNameInput.value.trim().slice(0, 16) || "Jugador";
  playButton.disabled = true;
  menuError.textContent = "Conectando con la ciudad...";

  try {
    await connectMultiplayer();

    gameStarted = true;
    menu.classList.add("hidden");
    hud.classList.remove("hidden");

    player.position.set(0, PLAYER_HEIGHT, 6);
    camera.position.copy(player.position);

    updateHUD();
    updatePlayerCount();

    renderer.domElement.requestPointerLock();
    showNotice("¡BIENVENIDO A LA CIUDAD!");
  } catch (error) {
    console.error(error);
    menuError.textContent = error.message || "Error al conectar.";
    playButton.disabled = false;
  }
});

/* =========================================
   BUCLE PRINCIPAL
========================================= */

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  if (gameStarted) {
    if (!settingsOpen) {
      updateMovement(delta);
      updateAiming();
      animateWeapon(delta);
      updateRevive(delta);
    }

    updateDowned(delta);
    updateNPCs(delta);
    updateTracers(delta);
    updateNetwork();

    if (player.downed) {
      reviveStatus.textContent =
        player.reviveTargetId ? "Un compañero está intentando reanimarte" :
        "Espera a que un compañero se acerque y mantenga E";
    }
  } else {
    updateTracers(delta);
  }

  renderer.render(scene, camera);
}

animate();

/* =========================================
   VENTANA Y SALIDA
========================================= */

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(
    graphicsQuality === "low" ? 1 :
    graphicsQuality === "high" ? Math.min(window.devicePixelRatio, 2) :
    Math.min(window.devicePixelRatio, 1.5)
  );
});

window.addEventListener("beforeunload", () => {
  if (channel) supabase.removeChannel(channel);
});
