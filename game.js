import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const SUPABASE_URL = "https://vlwfntwxbzmeodutbrxd.supabase.co";
const SUPABASE_KEY = "sb_publishable_JKRwt7biD2Y9wCQpQC9iQA_-EDPL17V";

const ROOM_NAME = "ciudad-publica-v1";
const MAX_HEALTH = 100;
const REVIVE_HEALTH = 50;
const DOWNED_SECONDS = 30;
const REVIVE_SECONDS = 4;
const MAX_NPCS = 12;
const MEDKIT_HEAL = 35;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* =========================================================
   ELEMENTOS DE INTERFAZ
========================================================= */

const $ = (id) => document.getElementById(id);

const menu = $("menu");
const gameUI = $("game");
const usernameInput = $("username");
const playButton = $("playButton");
const menuMessage = $("menuMessage");

const healthText = $("healthText");
const healthBar = $("healthBar");
const killsText = $("killsText");
const playersText = $("playersText");
const leaderRows = $("leaderRows");
const crosshair = $("crosshair");
const notice = $("notice");
const pickupHint = $("pickupHint");
const downedPanel = $("downedPanel");
const downTimer = $("downTimer");
const deadPanel = $("deadPanel");
const respawnButton = $("respawnButton");
const settings = $("settings");

let noticeTimeout;
let noticeText = "";

function showNotice(text, duration = 1800) {
  noticeText = text;
  notice.textContent = text;
  notice.classList.add("visible");

  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => {
    notice.classList.remove("visible");
  }, duration);
}

/* =========================================================
   ESTADO DEL JUGADOR Y MULTIJUGADOR
========================================================= */

const clientId = crypto.randomUUID();

let username = "";
let channel = null;
let joined = false;
let playerHealth = MAX_HEALTH;
let playerKills = 0;
let playerDowned = false;
let playerDead = false;
let downedUntil = 0;
let lastStateBroadcast = 0;
let lastLeaderboardBroadcast = 0;
let lastShootTime = 0;
let lastDamageTime = 0;
let reviveTargetId = null;
let reviveStartTime = 0;
let currentReviveTarget = null;
let isAiming = false;
let isCrouching = false;
let isSprinting = false;
let gameStarted = false;

const remotePlayers = new Map();
const leaderboardPlayers = new Map();
const keys = new Set();

let mouseSensitivity = 0.002;
let cameraFov = 80;
let graphicsQuality = "medium";

/* =========================================================
   THREE.JS: ESCENA Y CÁMARA
========================================================= */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cb9cc);
scene.fog = new THREE.Fog(0x9cb9cc, 50, 240);

const camera = new THREE.PerspectiveCamera(
  cameraFov,
  window.innerWidth / window.innerHeight,
  0.1,
  600
);

camera.rotation.order = "YXZ";
camera.position.set(0, 1.7, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance"
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x62605a, 2.0);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
sun.position.set(60, 100, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

/* =========================================================
   MATERIALES Y CIUDAD
========================================================= */

const materials = {
  ground: new THREE.MeshStandardMaterial({ color: 0x59665d }),
  road: new THREE.MeshStandardMaterial({ color: 0x30373d }),
  sidewalk: new THREE.MeshStandardMaterial({ color: 0x999b95 }),
  building: [
    new THREE.MeshStandardMaterial({ color: 0x929da5 }),
    new THREE.MeshStandardMaterial({ color: 0xb6a795 }),
    new THREE.MeshStandardMaterial({ color: 0x727e8a }),
    new THREE.MeshStandardMaterial({ color: 0xc0c4bd }),
    new THREE.MeshStandardMaterial({ color: 0x8b9690 })
  ],
  window: new THREE.MeshStandardMaterial({
    color: 0x7fc4db,
    emissive: 0x1b5367,
    emissiveIntensity: 0.3
  }),
  npc: new THREE.MeshStandardMaterial({ color: 0xb73e34 }),
  npcHead: new THREE.MeshStandardMaterial({ color: 0xd5a17f }),
  medkit: new THREE.MeshStandardMaterial({
    color: 0x31e77d,
    emissive: 0x0d7734,
    emissiveIntensity: 0.6
  })
};

function addBox(parent, w, h, d, material, x, y, z, castShadow = true) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material
  );

  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const ground = addBox(
  scene, 500, 1, 500, materials.ground,
  0, -0.55, 0, false
);

function createCity() {
  // Calles principales
  addBox(scene, 16, 0.08, 420, materials.road, 0, 0, 0, false);
  addBox(scene, 420, 0.08, 16, materials.road, 0, 0, 0, false);

  // Calles secundarias
  for (let p = -180; p <= 180; p += 60) {
    addBox(scene, 10, 0.08, 420, materials.road, p, 0, 0, false);
    addBox(scene, 420, 0.08, 10, materials.road, 0, 0, p, false);
  }

  // Líneas de las calles
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe7d58c });

  for (let z = -200; z <= 200; z += 10) {
    addBox(scene, 0.18, 0.02, 4, lineMat, 0, 0.06, z, false);
  }

  for (let x = -200; x <= 200; x += 10) {
    addBox(scene, 4, 0.02, 0.18, lineMat, x, 0.06, 0, false);
  }

  // Edificios distribuidos en manzanas
  for (let x = -180; x <= 180; x += 30) {
    for (let z = -180; z <= 180; z += 30) {
      if (Math.abs(x) < 16 || Math.abs(z) < 16) continue;

      if (Math.random() < 0.12) continue;

      const w = 12 + Math.random() * 8;
      const d = 12 + Math.random() * 8;
      const h = 9 + Math.random() * 35;
      const mat = materials.building[
        Math.floor(Math.random() * materials.building.length)
      ];

      const bx = x + (Math.random() - 0.5) * 5;
      const bz = z + (Math.random() - 0.5) * 5;

      addBox(scene, w, h, d, mat, bx, h / 2, bz);

      // Ventanas en las fachadas
      const floors = Math.max(2, Math.floor(h / 4));

      for (let floor = 1; floor < floors; floor++) {
        for (let side = -1; side <= 1; side += 2) {
          addBox(
            scene, 1.5, 1.2, 0.12,
            materials.window,
            bx + side * (w / 2 + 0.07),
            floor * 4,
            bz
          );

          addBox(
            scene, 0.12, 1.2, 1.5,
            materials.window,
            bx,
            floor * 4,
            bz + side * (d / 2 + 0.07)
          );
        }
      }
    }
  }

  // Farolas
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x353b3f });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffedbb,
    emissive: 0xffd27b,
    emissiveIntensity: 0.7
  });

  for (let p = -180; p <= 180; p += 30) {
    for (const side of [-1, 1]) {
      const x = side * 10;
      const z = p;

      addBox(scene, 0.2, 5, 0.2, poleMat, x, 2.5, z);
      addBox(scene, 1.1, 0.25, 0.6, lampMat, x, 5.1, z, false);
    }
  }
}

createCity();

/* =========================================================
   ARMA Y MANOS VISIBLES
========================================================= */

const weaponGroup = new THREE.Group();
camera.add(weaponGroup);
scene.add(camera);

const skinMat = new THREE.MeshStandardMaterial({ color: 0xb98463 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x273e4b });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x20252a });
const gunAccentMat = new THREE.MeshStandardMaterial({ color: 0x525d65 });

function createWeapon() {
  weaponGroup.clear();

  // Brazo
  addBox(weaponGroup, 0.17, 0.18, 0.48, sleeveMat, -0.28, -0.3, -0.45);
  addBox(weaponGroup, 0.14, 0.13, 0.23, skinMat, -0.28, -0.26, -0.68);

  // Mano de apoyo
  addBox(weaponGroup, 0.14, 0.13, 0.28, skinMat, 0.08, -0.33, -0.58);

  // Cuerpo del arma
  addBox(weaponGroup, 0.22, 0.17, 0.48, gunMat, 0, -0.22, -0.58);

  // Cañón
  addBox(weaponGroup, 0.09, 0.09, 0.48, gunAccentMat, 0, -0.19, -1.0);

  // Empuñadura
  addBox(weaponGroup, 0.12, 0.23, 0.13, gunMat, 0, -0.39, -0.48);

  // Mira
  addBox(weaponGroup, 0.05, 0.04, 0.12, gunAccentMat, 0, -0.12, -0.75);

  weaponGroup.position.set(0.32, -0.31, -0.45);
}

createWeapon();

/* =========================================================
   NPC Y BOTIQUINES
========================================================= */

const npcs = [];
const medkits = [];
let npcIdCounter = 0;

function createNPC() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.15, 0.45),
    materials.npc
  );
  body.position.y = 0.9;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 10),
    materials.npcHead
  );
  head.position.y = 1.65;
  head.castShadow = true;
  group.add(head);

  const legMat = new THREE.MeshStandardMaterial({ color: 0x303c48 });

  const legL = addBox(group, 0.22, 0.65, 0.25, legMat, -0.18, 0.32, 0);
  const legR = addBox(group, 0.22, 0.65, 0.25, legMat, 0.18, 0.32, 0);

  let x, z;

  do {
    x = (Math.random() - 0.5) * 330;
    z = (Math.random() - 0.5) * 330;
  } while (Math.abs(x) < 18 && Math.abs(z) < 18);

  group.position.set(x, 0, z);
  scene.add(group);

  const npc = {
    id: `npc-${++npcIdCounter}`,
    group,
    hp: 100,
    alive: true,
    nextMove: 0,
    moveTarget: new THREE.Vector3(x, 0, z),
    speed: 1.5 + Math.random() * 1.2,
    head,
    body,
    legL,
    legR
  };

  npcs.push(npc);
  return npc;
}

function spawnNPCs() {
  while (npcs.filter(n => n.alive).length < MAX_NPCS) {
    createNPC();
  }
}

function createMedkit(position) {
  const group = new THREE.Group();

  const boxMat = new THREE.MeshStandardMaterial({
    color: 0xf0f0f0,
    emissive: 0x222222
  });

  addBox(group, 0.65, 0.45, 0.55, boxMat, 0, 0.25, 0, false);
  addBox(group, 0.14, 0.48, 0.08, materials.medkit, 0, 0.25, -0.29, false);
  addBox(group, 0.42, 0.14, 0.08, materials.medkit, 0, 0.25, -0.29, false);

  group.position.copy(position);
  group.position.y = 0.05;
  scene.add(group);

  medkits.push({
    group,
    createdAt: performance.now(),
    expiresAt: performance.now() + 90000
  });
}

function killNPC(npc, killerId) {
  if (!npc || !npc.alive) return;

  npc.alive = false;
  scene.remove(npc.group);

  // El botiquín es visible para los jugadores de esta instancia.
  // La sincronización de los botiquines entre clientes se puede añadir
  // como evento de servidor si se necesita un mundo totalmente autoritativo.
  if (Math.random() < 0.8) {
    createMedkit(npc.group.position.clone());
  }

  if (killerId === clientId) {
    showNotice("NPC eliminado");
  }

  setTimeout(() => {
    const index = npcs.indexOf(npc);
    if (index !== -1) npcs.splice(index, 1);
    createNPC();
  }, 8000);
}

spawnNPCs();

/* =========================================================
   JUGADOR LOCAL Y MOVIMIENTO
========================================================= */

const playerPosition = new THREE.Vector3(0, 1.7, 0);
const velocity = new THREE.Vector3();

let yaw = 0;
let pitch = 0;
const raycaster = new THREE.Raycaster();
raycaster.far = 150;

function resetPlayerPosition() {
  playerPosition.set(
    (Math.random() - 0.5) * 12,
    1.7,
    (Math.random() - 0.5) * 12
  );

  yaw = 0;
  pitch = 0;
  camera.position.copy(playerPosition);
  camera.rotation.set(pitch, yaw, 0, "YXZ");
}

resetPlayerPosition();

function getHorizontalForward() {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

function getHorizontalRight() {
  return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
}

function updateMovement(delta) {
  if (playerDowned || playerDead || settings.classList.contains("hidden") === false) {
    return;
  }

  const forward = getHorizontalForward();
  const right = getHorizontalRight();
  const direction = new THREE.Vector3();

  if (keys.has("KeyW")) direction.add(forward);
  if (keys.has("KeyS")) direction.sub(forward);
  if (keys.has("KeyD")) direction.add(right);
  if (keys.has("KeyA")) direction.sub(right);

  if (direction.lengthSq() > 0) direction.normalize();

  isSprinting = keys.has("ShiftLeft") || keys.has("ShiftRight");

  const speed = isCrouching ? 2.2 : (isSprinting ? 10 : 6);

  playerPosition.addScaledVector(direction, speed * delta);

  // Límites del mapa
  playerPosition.x = THREE.MathUtils.clamp(playerPosition.x, -230, 230);
  playerPosition.z = THREE.MathUtils.clamp(playerPosition.z, -230, 230);

  // Cámara más baja al agacharse
  const targetY = isCrouching ? 1.0 : 1.7;
  playerPosition.y = THREE.MathUtils.lerp(playerPosition.y, targetY, delta * 10);

  camera.position.copy(playerPosition);
  camera.rotation.set(pitch, yaw, 0, "YXZ");

  // Balanceo del arma
  const moving = direction.lengthSq() > 0;
  const bob = moving ? Math.sin(performance.now() * 0.012) * 0.015 : 0;

  weaponGroup.position.y = (isAiming ? -0.25 : -0.31) + bob;
  weaponGroup.position.x = isAiming ? 0.05 : 0.32;
  weaponGroup.scale.setScalar(isAiming ? 0.78 : 1);
}

/* =========================================================
   JUGADORES REMOTOS
========================================================= */

function createRemoteAvatar(id, name) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3578bc });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xd2a07c });

  const body = addBox(group, 0.7, 1.15, 0.45, bodyMat, 0, 0.9, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), headMat);
  head.position.y = 1.65;
  group.add(head);

  addBox(group, 0.22, 0.65, 0.25, bodyMat, -0.18, 0.32, 0);
  addBox(group, 0.22, 0.65, 0.25, bodyMat, 0.18, 0.32, 0);

  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 96;

  const ctx = labelCanvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = "white";
  ctx.font = "bold 36px Arial";
  ctx.textAlign = "center";
  ctx.fillText(name.slice(0, 18), 256, 62);

  const texture = new THREE.CanvasTexture(labelCanvas);
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );

  label.scale.set(3, 0.56, 1);
  label.position.y = 2.35;
  group.add(label);

  scene.add(group);

  return {
    id,
    name,
    group,
    body,
    hp: MAX_HEALTH,
    kills: 0,
    downed: false,
    dead: false,
    deadline: 0,
    targetPosition: new THREE.Vector3(),
    targetYaw: 0,
    lastSeen: performance.now()
  };
}

function removeRemotePlayer(id) {
  const remote = remotePlayers.get(id);
  if (remote) {
    scene.remove(remote.group);
    remotePlayers.delete(id);
  }

  leaderboardPlayers.delete(id);
  updateLeaderboard();
}

function updateRemotePlayers(delta) {
  for (const remote of remotePlayers.values()) {
    if (remote.dead) {
      remote.group.visible = false;
      continue;
    }

    remote.group.visible = true;

    remote.group.position.lerp(remote.targetPosition, Math.min(1, delta * 12));
    remote.group.rotation.y = THREE.MathUtils.lerp(
      remote.group.rotation.y,
      remote.targetYaw,
      Math.min(1, delta * 10)
    );

    if (remote.downed) {
      remote.group.rotation.z = THREE.MathUtils.lerp(
        remote.group.rotation.z, -Math.PI / 2, delta * 6
      );
    } else {
      remote.group.rotation.z = THREE.MathUtils.lerp(
        remote.group.rotation.z, 0, delta * 6
      );
    }
  }
}

/* =========================================================
   HUD Y TABLA TOP 3
========================================================= */

function updateHUD() {
  healthText.textContent = Math.max(0, Math.round(playerHealth));
  healthBar.style.width = `${THREE.MathUtils.clamp(playerHealth, 0, 100)}%`;
  killsText.textContent = playerKills;
  playersText.textContent = remotePlayers.size + 1;
}

function collectLeaderboard() {
  const all = [{
    id: clientId,
    name: username,
    kills: playerKills
  }];

  for (const remote of remotePlayers.values()) {
    if (!remote.dead) {
      all.push({
        id: remote.id,
        name: remote.name,
        kills: Math.max(0, remote.kills || 0)
      });
    }
  }

  all.sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills;
    return a.name.localeCompare(b.name);
  });

  return all.slice(0, 3);
}

function updateLeaderboard() {
  const top = collectLeaderboard();
  const medals = ["🥇", "🥈", "🥉"];

  leaderRows.replaceChildren();

  top.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "leader-row";

    const rank = document.createElement("span");
    rank.className = "leader-rank";
    rank.textContent = medals[index];

    const name = document.createElement("span");
    name.className = "leader-name";
    name.textContent = player.name + (player.id === clientId ? " (Tú)" : "");

    const kills = document.createElement("span");
    kills.className = "leader-kills";
    kills.textContent = `${player.kills} K`;

    row.append(rank, name, kills);
    leaderRows.appendChild(row);
  });
}

/* =========================================================
   SUPABASE: EVENTOS EN TIEMPO REAL
========================================================= */

function sendEvent(type, payload = {}) {
  if (!channel || !joined) return;

  channel.send({
    type: "broadcast",
    event: type,
    payload: {
      sender: clientId,
      ...payload
    }
  });
}

function sendPlayerState() {
  if (!joined || !channel || playerDead) return;

  sendEvent("state", {
    name: username,
    x: playerPosition.x,
    y: playerPosition.y,
    z: playerPosition.z,
    yaw,
    health: playerHealth,
    kills: playerKills,
    downed: playerDowned,
    dead: playerDead,
    deadline: downedUntil
  });
}

function publishScoreboard() {
  sendEvent("scoreboard", {
    name: username,
    kills: playerKills,
    dead: playerDead
  });
}

function updateRemoteScore(id, name, kills, dead = false) {
  if (id === clientId) return;

  leaderboardPlayers.set(id, {
    id,
    name,
    kills: Math.max(0, Number(kills) || 0),
    dead
  });

  const remote = remotePlayers.get(id);
  if (remote) {
    remote.name = name || remote.name;
    remote.kills = Math.max(0, Number(kills) || 0);
    remote.dead = !!dead;
  }

  updateLeaderboard();
}

function handleState(payload) {
  if (!payload || payload.sender === clientId) return;

  let remote = remotePlayers.get(payload.sender);

  if (!remote) {
    remote = createRemoteAvatar(payload.sender, payload.name || "Jugador");
    remotePlayers.set(payload.sender, remote);
  }

  remote.name = payload.name || remote.name;
  remote.targetPosition.set(
    Number(payload.x) || 0,
    0,
    Number(payload.z) || 0
  );

  remote.targetYaw = Number(payload.yaw) || 0;
  remote.hp = Number.isFinite(payload.health) ? payload.health : remote.hp;
  remote.kills = Math.max(0, Number(payload.kills) || 0);
  remote.downed = !!payload.downed;
  remote.dead = !!payload.dead;
  remote.deadline = Number(payload.deadline) || 0;
  remote.lastSeen = performance.now();

  updateRemoteScore(
    payload.sender,
    remote.name,
    remote.kills,
    remote.dead
  );
}

function handleRemoteHit(payload) {
  if (!payload || payload.target !== clientId) return;

  if (playerDowned) {
    eliminatePlayer("Te remataron");
    return;
  }

  if (playerDead) return;

  damagePlayer(Number(payload.damage) || 20, payload.sender);
}

function handleRevive(payload) {
  if (!payload || payload.target !== clientId) return;

  // Solo el jugador derribado cambia su propio estado de vida.
  if (playerDead || !playerDowned) return;

  playerDowned = false;
  playerHealth = REVIVE_HEALTH;
  downedUntil = 0;
  reviveTargetId = null;
  currentReviveTarget = null;
  reviveStartTime = 0;

  downedPanel.classList.add("hidden");
  camera.position.y = 1.7;
  camera.rotation.z = 0;

  showNotice(`${username}: ¡Has sido reanimado!`);
  updateHUD();
  sendPlayerState();
  publishScoreboard();
}

function handleDowned(payload) {
  if (!payload || payload.sender === clientId) return;

  const remote = remotePlayers.get(payload.sender);
  if (!remote) return;

  remote.downed = true;
  remote.deadline = Number(payload.deadline) || 0;
}

function handleEliminated(payload) {
  if (!payload || payload.sender === clientId) return;

  const remote = remotePlayers.get(payload.sender);
  if (remote) {
    remote.dead = true;
    remote.downed = false;
    remote.group.visible = false;
    remote.kills = 0;
    updateRemoteScore(remote.id, remote.name, 0, true);
  }
}

function setupChannel() {
  channel = supabase.channel(ROOM_NAME, {
    config: {
      broadcast: { self: false },
      presence: { key: clientId }
    }
  });

  channel
    .on("broadcast", { event: "state" }, ({ payload }) => handleState(payload))
    .on("broadcast", { event: "scoreboard" }, ({ payload }) => {
      if (payload?.sender === clientId) return;
      updateRemoteScore(
        payload.sender,
        payload.name || "Jugador",
        payload.kills,
        payload.dead
      );
    })
    .on("broadcast", { event: "hit" }, ({ payload }) => handleRemoteHit(payload))
    .on("broadcast", { event: "downed" }, ({ payload }) => handleDowned(payload))
    .on("broadcast", { event: "revive" }, ({ payload }) => handleRevive(payload))
    .on("broadcast", { event: "eliminated" }, ({ payload }) => handleEliminated(payload))
    .on("broadcast", { event: "respawn" }, ({ payload }) => {
      if (payload?.sender === clientId) return;
      const remote = remotePlayers.get(payload.sender);
      if (remote) {
        remote.dead = false;
        remote.downed = false;
        remote.hp = MAX_HEALTH;
        remote.kills = 0;
        remote.group.visible = true;
      }
    })
    .on("broadcast", { event: "npcKill" }, ({ payload }) => {
      // Evento informativo: la autoridad del daño a NPC es local en esta versión.
      if (payload?.sender !== clientId) {
        // Evita duplicar NPC entre clientes por IDs locales.
      }
    })
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const ids = new Set();

      for (const [key, entries] of Object.entries(state)) {
        if (key === clientId) continue;

        const entry = entries?.[0];
        if (!entry) continue;

        const id = entry.id || key;
        ids.add(id);

        if (!remotePlayers.has(id)) {
          const remote = createRemoteAvatar(id, entry.name || "Jugador");
          remotePlayers.set(id, remote);
          remote.targetPosition.set(0, 0, 0);
        }

        updateRemoteScore(
          id,
          entry.name || "Jugador",
          entry.kills || 0,
          false
        );
      }

      for (const id of remotePlayers.keys()) {
        if (!ids.has(id)) removeRemotePlayer(id);
      }

      playersText.textContent = remotePlayers.size + 1;
      updateLeaderboard();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        joined = true;

        await channel.track({
          id: clientId,
          name: username,
          kills: playerKills,
          online: true
        });

        sendPlayerState();
        publishScoreboard();
        showNotice("Conectado a la partida");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        showNotice("Error de conexión con la partida", 3000);
      }
    });
}

/* =========================================================
   REGISTRO: NOMBRE ÚNICO EN LA SESIÓN
========================================================= */

function normalizeName(name) {
  return name.trim().normalize("NFKC").toLocaleLowerCase("es");
}

async function checkNameAvailable(name) {
  // La presencia permite detectar nombres ocupados en la sesión actual.
  // Esta comprobación cliente no es una garantía contra carreras o trampas.
  if (!channel) {
    channel = supabase.channel(ROOM_NAME, {
      config: { presence: { key: clientId } }
    });
  }

  const clean = normalizeName(name);
  const state = channel.presenceState();

  for (const [key, entries] of Object.entries(state)) {
    if (key === clientId) continue;

    for (const entry of entries || []) {
      if (normalizeName(entry.name || "") === clean) {
        return false;
      }
    }
  }

  return true;
}

async function startGame() {
  if (gameStarted) return;

  const enteredName = usernameInput.value.trim();

  if (enteredName.length < 3) {
    menuMessage.textContent = "Tu nombre debe tener al menos 3 caracteres.";
    return;
  }

  if (!/^[\p{L}\p{N}_ -]+$/u.test(enteredName)) {
    menuMessage.textContent = "Usa letras, números, espacios, guion o guion bajo.";
    return;
  }

  playButton.disabled = true;
  menuMessage.textContent = "Conectando...";

  try {
    username = enteredName;

    // Se conecta al canal antes de verificar para poder consultar presencia.
    setupChannel();

    await new Promise(resolve => setTimeout(resolve, 1200));

    const available = await checkNameAvailable(username);

    if (!available) {
      if (channel) {
        await supabase.removeChannel(channel);
        channel = null;
      }

      joined = false;
      menuMessage.textContent = "Ese nombre ya está en uso. Elige otro.";
      playButton.disabled = false;
      return;
    }

    gameStarted = true;
    menu.classList.add("hidden");
    gameUI.classList.remove("hidden");

    resetPlayerPosition();
    updateHUD();
    updateLeaderboard();

    renderer.domElement.requestPointerLock?.();
  } catch (error) {
    console.error(error);
    menuMessage.textContent = "No se pudo conectar. Intenta de nuevo.";
    playButton.disabled = false;
  }
}

playButton.addEventListener("click", startGame);

usernameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") startGame();
});

/* =========================================================
   DISPAROS, RAYCAST Y DAÑO
========================================================= */

function shoot() {
  if (!gameStarted || playerDead || playerDowned) return;

  const now = performance.now();
  if (now - lastShootTime < 180) return;
  lastShootTime = now;

  weaponGroup.position.z = -0.4;
  setTimeout(() => {
    weaponGroup.position.z = -0.45;
  }, 70);

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  const npcMeshes = [];

  for (const npc of npcs) {
    if (!npc.alive) continue;
    npcMeshes.push(npc.head, npc.body);
  }

  const remoteMeshes = [];

  for (const remote of remotePlayers.values()) {
    if (remote.dead) continue;
    remote.group.traverse(obj => {
      if (obj.isMesh) {
        obj.userData.remoteId = remote.id;
        remoteMeshes.push(obj);
      }
    });
  }

  const hits = raycaster.intersectObjects([...npcMeshes, ...remoteMeshes], false);

  if (!hits.length) return;

  const hit = hits[0];
  const obj = hit.object;

  if (obj.userData.remoteId) {
    const targetId = obj.userData.remoteId;
    const remote = remotePlayers.get(targetId);

    if (remote && !remote.dead) {
      // El daño se comunica al cliente objetivo.
      sendEvent("hit", {
        target: targetId,
        damage: 34
      });

      // Las kills de otros jugadores se registran cuando llega el evento
      // de eliminación del objetivo. El cliente no puede garantizarlo por sí solo.
      showNotice(`Impacto a ${remote.name}`);
    }

    return;
  }

  const npc = npcs.find(n => n.alive && (n.head === obj || n.body === obj));

  if (npc) {
    const headshot = obj === npc.head;
    npc.hp -= headshot ? 100 : 34;

    if (npc.hp <= 0) {
      killNPC(npc, clientId);
      sendEvent("npcKill", { npcId: npc.id });
    } else {
      showNotice(headshot ? "Impacto en cabeza" : "Impacto");
    }
  }
}

function damagePlayer(damage, attackerId = null) {
  if (playerDead || playerDowned) return;

  playerHealth = Math.max(0, playerHealth - damage);
  lastDamageTime = performance.now();
  updateHUD();

  if (playerHealth <= 0) {
    playerDowned = true;
    playerHealth = 0;
    downedUntil = Date.now() + DOWNED_SECONDS * 1000;
    downedPanel.classList.remove("hidden");

    sendEvent("downed", {
      deadline: downedUntil,
      attacker: attackerId
    });

    sendPlayerState();
    showNotice("Estás derribado");
  }
}

function eliminatePlayer(reason = "Has sido eliminado") {
  if (playerDead) return;

  playerDead = true;
  playerDowned = false;
  playerHealth = 0;
  playerKills = 0;
  downedUntil = 0;

  downedPanel.classList.add("hidden");
  deadPanel.classList.remove("hidden");

  reviveTargetId = null;
  currentReviveTarget = null;
  reviveStartTime = 0;

  sendEvent("eliminated", {
    name: username,
    kills: 0
  });

  publishScoreboard();
  showNotice(reason);
  updateHUD();
  updateLeaderboard();
}

function respawnPlayer() {
  playerDead = false;
  playerDowned = false;
  playerHealth = MAX_HEALTH;
  playerKills = 0;
  downedUntil = 0;

  deadPanel.classList.add("hidden");
  downedPanel.classList.add("hidden");

  resetPlayerPosition();
  sendEvent("respawn", {
    name: username,
    kills: 0,
    health: MAX_HEALTH
  });

  sendPlayerState();
  publishScoreboard();
  updateHUD();
  updateLeaderboard();
  showNotice("Has reaparecido");
}

respawnButton.addEventListener("click", respawnPlayer);

/* =========================================================
   REANIMACIÓN Y CUENTA REGRESIVA
========================================================= */

function findReviveTarget() {
  let closest = null;
  let closestDistance = 3.2;

  for (const remote of remotePlayers.values()) {
    if (remote.dead || !remote.downed) continue;

    const distance = camera.position.distanceTo(remote.group.position);

    if (distance < closestDistance) {
      closest = remote;
      closestDistance = distance;
    }
  }

  return closest;
}

function updateRevive() {
  if (playerDead || playerDowned) {
    pickupHint.textContent = "";
    return;
  }

  const target = findReviveTarget();

  if (target) {
    pickupHint.textContent = `Mantén E para reanimar a ${target.name}`;

    if (keys.has("KeyE")) {
      if (currentReviveTarget !== target.id) {
        currentReviveTarget = target.id;
        reviveStartTime = performance.now();
      }

      const elapsed = (performance.now() - reviveStartTime) / 1000;
      const remaining = Math.max(0, REVIVE_SECONDS - elapsed);

      pickupHint.textContent =
        `Reanimando a ${target.name}... ${remaining.toFixed(1)} s`;

      if (elapsed >= REVIVE_SECONDS) {
        sendEvent("revive", {
          target: target.id,
          health: REVIVE_HEALTH
        });

        target.downed = false;
        target.hp = REVIVE_HEALTH;
        target.deadline = 0;

        currentReviveTarget = null;
        reviveStartTime = 0;
        pickupHint.textContent = "";

        showNotice(`Reanimaste a ${target.name}`);
      }
    } else {
      currentReviveTarget = null;
      reviveStartTime = 0;
    }

    return;
  }

  currentReviveTarget = null;
  reviveStartTime = 0;

  // Mostrar opción de recoger botiquín
  const medkit = findNearestMedkit();

  if (medkit && playerHealth < MAX_HEALTH) {
    pickupHint.textContent = "Presiona E para recoger el botiquín";
  } else {
    pickupHint.textContent = "";
  }
}

function updateDownedTimer() {
  if (playerDowned && !playerDead) {
    const remaining = Math.max(0, Math.ceil((downedUntil - Date.now()) / 1000));
    downTimer.textContent = remaining;

    if (remaining <= 0) {
      eliminatePlayer("Se acabó el tiempo para reanimarte");
    }
  }
}

/* =========================================================
   RECOGER BOTIQUINES
========================================================= */

function findNearestMedkit() {
  let closest = null;
  let closestDistance = 2.8;

  for (const medkit of medkits) {
    const distance = camera.position.distanceTo(medkit.group.position);

    if (distance < closestDistance) {
      closest = medkit;
      closestDistance = distance;
    }
  }

  return closest;
}

function pickupMedkit() {
  if (playerDead || playerDowned) return;

  const medkit = findNearestMedkit();
  if (!medkit) return;

  if (playerHealth >= MAX_HEALTH) {
    showNotice("Ya tienes la vida completa");
    return;
  }

  playerHealth = Math.min(MAX_HEALTH, playerHealth + MEDKIT_HEAL);

  scene.remove(medkit.group);

  const index = medkits.indexOf(medkit);
  if (index !== -1) medkits.splice(index, 1);

  updateHUD();
  showNotice(`Botiquín recogido: +${MEDKIT_HEAL} de vida`);
}

/* =========================================================
   NPC: MOVIMIENTO Y BOTIQUINES
========================================================= */

function updateNPCs(delta) {
  const now = performance.now();

  for (const npc of npcs) {
    if (!npc.alive) continue;

    if (now > npc.nextMove) {
      npc.nextMove = now + 1500 + Math.random() * 2500;

      npc.moveTarget.set(
        npc.group.position.x + (Math.random() - 0.5) * 15,
        0,
        npc.group.position.z + (Math.random() - 0.5) * 15
      );
    }

    const current = npc.group.position;
    const direction = new THREE.Vector3()
      .subVectors(npc.moveTarget, current);

    direction.y = 0;

    if (direction.length() > 0.5) {
      direction.normalize();
      current.addScaledVector(direction, npc.speed * delta);
      npc.group.rotation.y = Math.atan2(direction.x, direction.z);
    }

    // NPC se acerca al jugador y causa daño al contacto.
    if (!playerDead && !playerDowned) {
      const distance = current.distanceTo(
        new THREE.Vector3(playerPosition.x, 0, playerPosition.z)
      );

      if (distance < 1.5 && now - lastDamageTime > 1000) {
        damagePlayer(5);
      }
    }

    npc.legL.rotation.x = Math.sin(now * 0.008 + npc.id.length) * 0.25;
    npc.legR.rotation.x = -npc.legL.rotation.x;
  }

  // Rotación y expiración de botiquines
  for (let i = medkits.length - 1; i >= 0; i--) {
    const medkit = medkits[i];

    medkit.group.rotation.y += delta;
    medkit.group.position.y = 0.05 + Math.sin(now * 0.003 + i) * 0.08;

    if (now > medkit.expiresAt) {
      scene.remove(medkit.group);
      medkits.splice(i, 1);
    }
  }
}

/* =========================================================
   CONTROLES: RATÓN, TECLADO Y AJUSTES
========================================================= */

renderer.domElement.addEventListener("click", () => {
  if (!gameStarted || playerDead || playerDowned) return;

  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock?.();
  } else {
    shoot();
  }
});

document.addEventListener("mousemove", event => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (settings.classList.contains("hidden") === false) return;
  if (playerDead || playerDowned) return;

  yaw -= event.movementX * mouseSensitivity;
  pitch -= event.movementY * mouseSensitivity;

  pitch = THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  camera.rotation.set(pitch, yaw, 0, "YXZ");
});

document.addEventListener("mousedown", event => {
  if (event.button === 2 && gameStarted && !playerDead && !playerDowned) {
    isAiming = true;
  }
});

document.addEventListener("mouseup", event => {
  if (event.button === 2) isAiming = false;
});

document.addEventListener("contextmenu", event => event.preventDefault());

document.addEventListener("keydown", event => {
  keys.add(event.code);

  if (event.code === "Tab") {
    event.preventDefault();

    if (!gameStarted) return;

    settings.classList.toggle("hidden");

    if (settings.classList.contains("hidden")) {
      renderer.domElement.requestPointerLock?.();
    } else if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  if (event.code === "KeyC" && !event.repeat) {
    isCrouching = !isCrouching;
  }

  if (event.code === "KeyE" && !event.repeat) {
    const medkit = findNearestMedkit();

    if (medkit && !findReviveTarget()) {
      pickupMedkit();
    }
  }

  if (event.code === "Escape") {
    isAiming = false;
  }
});

document.addEventListener("keyup", event => {
  keys.delete(event.code);
});

$("sensitivity").addEventListener("input", event => {
  mouseSensitivity = Number(event.target.value);
});

$("fov").addEventListener("input", event => {
  cameraFov = Number(event.target.value);
  camera.fov = cameraFov;
  camera.updateProjectionMatrix();
});

$("quality").addEventListener("change", event => {
  graphicsQuality = event.target.value;

  if (graphicsQuality === "high") {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
  } else if (graphicsQuality === "medium") {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
  } else {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
});

$("showCrosshair").addEventListener("change", event => {
  crosshair.style.display = event.target.checked ? "block" : "none";
});

/* =========================================================
   BUCLE PRINCIPAL
========================================================= */

let previousFrame = performance.now();

function animate(now) {
  requestAnimationFrame(animate);

  const delta = Math.min((now - previousFrame) / 1000, 0.05);
  previousFrame = now;

  if (gameStarted) {
    updateMovement(delta);
    updateNPCs(delta);
    updateRemotePlayers(delta);
    updateRevive();
    updateDownedTimer();

    // El TOP se actualiza localmente durante toda la partida.
    updateLeaderboard();
    updateHUD();

    if (joined && now - lastStateBroadcast > 100) {
      lastStateBroadcast = now;
      sendPlayerState();
    }

    if (joined && now - lastLeaderboardBroadcast > 700) {
      lastLeaderboardBroadcast = now;
      publishScoreboard();
    }
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

/* =========================================================
   REAJUSTE DE VENTANA
========================================================= */

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* =========================================================
   LIMPIEZA DE CONEXIÓN
========================================================= */

window.addEventListener("beforeunload", () => {
  if (channel) {
    supabase.removeChannel(channel);
  }
});
