import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* =========================================
   CONFIGURACIÓN
========================================= */

const SUPABASE_URL = "https://vlwfntwxbzmeodutbrxd.supabase.co";
const SUPABASE_KEY = "sb_publishable_JKRwt7biD2Y9wCQpQC9iQA_-EDPL17V";

const ROOM_NAME = "ciudad-publica-v1";
const MAX_PLAYERS = 10;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const menu = document.getElementById("menu");
const playButton = document.getElementById("playButton");
const playerNameInput = document.getElementById("playerName");
const menuError = document.getElementById("menuError");
const hud = document.getElementById("hud");
const healthFill = document.getElementById("healthFill");
const healthText = document.getElementById("healthText");
const playerCountText = document.getElementById("playerCount");
const killCountText = document.getElementById("killCount");
const statusText = document.getElementById("statusText");
const crosshair = document.getElementById("crosshair");
const hitMarker = document.getElementById("hitMarker");
const notice = document.getElementById("notice");
const downScreen = document.getElementById("downScreen");

const myId = crypto.randomUUID();

let playerName = "Jugador";
let channel = null;
let connected = false;
let gameStarted = false;
let lastPositionBroadcast = 0;
let lastShotTime = 0;
let noticeTimeout = null;
let hitMarkerTimeout = null;
let lastPlayerCount = 1;

/* =========================================
   ESCENA THREE.JS
========================================= */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91c8e5);
scene.fog = new THREE.Fog(0x91c8e5, 70, 240);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

const renderer = new THREE.WebGLRenderer({
  antialias: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

document.body.appendChild(renderer.domElement);

renderer.domElement.style.position = "fixed";
renderer.domElement.style.inset = "0";
renderer.domElement.style.zIndex = "0";

document.getElementById("menu").style.zIndex = "20";
document.getElementById("hud").style.zIndex = "10";

/* =========================================
   LUCES
========================================= */

const ambientLight = new THREE.HemisphereLight(
  0xdaf0ff,
  0x52634d,
  2.0
);

scene.add(ambientLight);

const sunlight = new THREE.DirectionalLight(0xffffff, 2.1);
sunlight.position.set(-45, 85, 35);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.camera.left = -100;
sunlight.shadow.camera.right = 100;
sunlight.shadow.camera.top = 100;
sunlight.shadow.camera.bottom = -100;
scene.add(sunlight);

/* =========================================
   MATERIALES
========================================= */

const materials = {
  ground: new THREE.MeshStandardMaterial({
    color: 0x667765,
    roughness: 1
  }),
  road: new THREE.MeshStandardMaterial({
    color: 0x343b43,
    roughness: 1
  }),
  sidewalk: new THREE.MeshStandardMaterial({
    color: 0xa0a3a1,
    roughness: 1
  }),
  building1: new THREE.MeshStandardMaterial({
    color: 0x9aa7ad,
    roughness: 0.9
  }),
  building2: new THREE.MeshStandardMaterial({
    color: 0xc1b5a1,
    roughness: 0.9
  }),
  building3: new THREE.MeshStandardMaterial({
    color: 0x777e88,
    roughness: 0.9
  }),
  window: new THREE.MeshStandardMaterial({
    color: 0x6db6d6,
    emissive: 0x183849,
    roughness: 0.3,
    metalness: 0.15
  }),
  white: new THREE.MeshStandardMaterial({
    color: 0xf1f1e8
  })
};

/* =========================================
   SUELO Y CIUDAD
========================================= */

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  materials.ground
);

ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const solidBuildings = [];
const collidableObjects = [ground];
const decorativeObjects = [];

function addBox(
  width,
  height,
  depth,
  x,
  y,
  z,
  material,
  options = {}
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    material
  );

  mesh.position.set(x, y, z);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = true;

  scene.add(mesh);

  if (options.solid) {
    solidBuildings.push({
      mesh,
      halfX: width / 2,
      halfZ: depth / 2
    });

    collidableObjects.push(mesh);
  }

  return mesh;
}

function createRoad(x, z, width, depth) {
  addBox(
    width,
    0.08,
    depth,
    x,
    0.02,
    z,
    materials.road,
    { castShadow: false }
  );
}

function createBuilding(x, z, width, depth, height, material) {
  addBox(
    width,
    height,
    depth,
    x,
    height / 2,
    z,
    material,
    { solid: true }
  );

  const floors = Math.max(1, Math.floor(height / 3.2));

  for (let floor = 0; floor < floors; floor++) {
    const y = 1.8 + floor * 3.2;

    if (y > height - 0.6) continue;

    for (let i = 0; i < Math.floor(width / 2.5); i++) {
      const wx = x - width / 2 + 1.3 + i * 2.5;

      addBox(
        0.9,
        1.15,
        0.07,
        wx,
        y,
        z + depth / 2 + 0.045,
        materials.window,
        { castShadow: false }
      );

      addBox(
        0.9,
        1.15,
        0.07,
        wx,
        y,
        z - depth / 2 - 0.045,
        materials.window,
        { castShadow: false }
      );
    }

    for (let i = 0; i < Math.floor(depth / 2.5); i++) {
      const wz = z - depth / 2 + 1.3 + i * 2.5;

      addBox(
        0.07,
        1.15,
        0.9,
        x + width / 2 + 0.045,
        y,
        wz,
        materials.window,
        { castShadow: false }
      );

      addBox(
        0.07,
        1.15,
        0.9,
        x - width / 2 - 0.045,
        y,
        wz,
        materials.window,
        { castShadow: false }
      );
    }
  }
}

function createCity() {
  createRoad(0, 0, 260, 16);
  createRoad(0, 0, 16, 260);
  createRoad(0, 42, 260, 12);
  createRoad(0, -42, 260, 12);
  createRoad(42, 0, 12, 260);
  createRoad(-42, 0, 12, 260);
  createRoad(0, 82, 260, 10);
  createRoad(0, -82, 260, 10);
  createRoad(82, 0, 10, 260);
  createRoad(-82, 0, 10, 260);

  for (let x = -110; x <= 110; x += 28) {
    for (let z = -110; z <= 110; z += 28) {
      if (Math.abs(x) < 13 || Math.abs(z) < 13) continue;
      if (Math.abs(Math.abs(x) - 42) < 7) continue;
      if (Math.abs(Math.abs(z) - 42) < 7) continue;

      const width = 10 + Math.random() * 5;
      const depth = 10 + Math.random() * 5;
      const height = 8 + Math.random() * 25;

      const palette = [
        materials.building1,
        materials.building2,
        materials.building3
      ];

      const material = palette[
        Math.floor(Math.random() * palette.length)
      ];

      createBuilding(
        x + (Math.random() - 0.5) * 5,
        z + (Math.random() - 0.5) * 5,
        width,
        depth,
        height,
        material
      );
    }
  }

  for (let i = -120; i <= 120; i += 8) {
    addBox(
      0.16,
      0.025,
      3,
      i,
      0.075,
      0,
      materials.white,
      { castShadow: false }
    );
  }
}

createCity();

/* =========================================
   JUGADOR
========================================= */

const player = {
  position: new THREE.Vector3(0, 1.7, 6),
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  health: 100,
  maxHealth: 100,
  kills: 0,
  alive: true,
  crouched: false,
  sliding: false,
  aiming: false,
  grounded: true,
  slideTimer: 0
};

camera.position.copy(player.position);
camera.rotation.order = "YXZ";

const keys = Object.create(null);
let mouseDown = false;

const PLAYER_HEIGHT = 1.7;
const CROUCH_HEIGHT = 1.05;
const SLIDE_HEIGHT = 0.55;

const MOVE_SPEED = 7;
const RUN_SPEED = 11;
const CROUCH_SPEED = 3.5;
const SLIDE_SPEED = 15;
const JUMP_FORCE = 7.5;
const GRAVITY = 22;

function updateCameraHeight() {
  if (player.sliding) {
    camera.position.y = player.position.y - PLAYER_HEIGHT + SLIDE_HEIGHT;
  } else if (player.crouched) {
    camera.position.y = player.position.y - PLAYER_HEIGHT + CROUCH_HEIGHT;
  } else {
    camera.position.y = player.position.y;
  }
}

/* =========================================
   PERSONAJES NPC
========================================= */

const npcs = [];
const npcMaterials = [
  new THREE.MeshStandardMaterial({ color: 0xc64e3d }),
  new THREE.MeshStandardMaterial({ color: 0x3f78b5 }),
  new THREE.MeshStandardMaterial({ color: 0x5d9a66 }),
  new THREE.MeshStandardMaterial({ color: 0xb2a04d })
];

function createCharacter(name, color, isNPC = false) {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85
  });

  const skinMaterial = new THREE.MeshStandardMaterial({
    color: 0xe0b28e,
    roughness: 0.9
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.85, 0.38),
    bodyMaterial
  );

  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 14, 12),
    skinMaterial
  );

  head.position.y = 1.68;
  head.castShadow = true;
  group.add(head);

  const legs = [];

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.65, 0.28),
      bodyMaterial
    );

    leg.position.set(side * 0.19, 0.33, 0);
    leg.castShadow = true;
    group.add(leg);
    legs.push(leg);
  }

  const nameCanvas = document.createElement("canvas");
  nameCanvas.width = 256;
  nameCanvas.height = 64;

  const ctx = nameCanvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(10, 8, 236, 48);
  ctx.font = "bold 25px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name.slice(0, 16), 128, 40);

  const texture = new THREE.CanvasTexture(nameCanvas);
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    })
  );

  label.position.y = 2.3;
  label.scale.set(2.4, 0.6, 1);
  group.add(label);

  group.userData = {
    name,
    isNPC,
    health: 100,
    alive: true,
    body,
    head,
    legs
  };

  return group;
}

function isBlocked(x, z, radius = 0.6) {
  for (const building of solidBuildings) {
    const dx = Math.abs(x - building.mesh.position.x);
    const dz = Math.abs(z - building.mesh.position.z);

    if (
      dx < building.halfX + radius &&
      dz < building.halfZ + radius
    ) {
      return true;
    }
  }

  return false;
}

function spawnNPC(index) {
  const npc = createCharacter(
    "NPC " + (index + 1),
    npcMaterials[index % npcMaterials.length].color.getHex(),
    true
  );

  let x = 0;
  let z = 0;
  let tries = 0;

  do {
    x = (Math.random() - 0.5) * 180;
    z = (Math.random() - 0.5) * 180;
    tries++;
  } while (
    (isBlocked(x, z) || Math.hypot(x, z) < 18) &&
    tries < 100
  );

  npc.position.set(x, 0, z);
  npc.userData.spawnX = x;
  npc.userData.spawnZ = z;
  npc.userData.moveTimer = Math.random() * 3;
  npc.userData.direction = Math.random() * Math.PI * 2;
  npc.userData.lastAttack = 0;

  scene.add(npc);
  npcs.push(npc);

  return npc;
}

for (let i = 0; i < 12; i++) {
  spawnNPC(i);
}

/* =========================================
   MULTIJUGADOR
========================================= */

const remotePlayers = new Map();

function updatePlayerCount() {
  const count = Math.min(MAX_PLAYERS, remotePlayers.size + 1);
  playerCountText.textContent = `Jugadores: ${count}/${MAX_PLAYERS}`;
}

function send(type, payload = {}) {
  if (!channel || !connected) return;

  channel.send({
    type: "broadcast",
    event: type,
    payload: {
      id: myId,
      name: playerName,
      ...payload
    }
  }).catch((error) => {
    console.warn("No se pudo enviar el mensaje:", error);
  });
}

function createRemotePlayer(data) {
  const avatar = createCharacter(
    data.name || "Jugador",
    0x3d9bdb,
    false
  );

  avatar.userData.remoteId = data.id;
  avatar.userData.isRemote = true;

  scene.add(avatar);

  remotePlayers.set(data.id, {
    avatar,
    name: data.name || "Jugador",
    lastUpdate: performance.now(),
    health: 100,
    alive: true
  });

  updatePlayerCount();
}

function removeRemotePlayer(id) {
  const remote = remotePlayers.get(id);
  if (!remote) return;

  scene.remove(remote.avatar);

  remote.avatar.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material.dispose();
      }
    }
  });

  remotePlayers.delete(id);
  updatePlayerCount();
}

function handleRemoteMessage(event, payload) {
  if (!payload || payload.id === myId) return;

  if (event === "position") {
    let remote = remotePlayers.get(payload.id);

    if (!remote) {
      if (remotePlayers.size >= MAX_PLAYERS - 1) return;
      createRemotePlayer(payload);
      remote = remotePlayers.get(payload.id);
    }

    if (!remote) return;

    remote.name = payload.name || remote.name;
    remote.lastUpdate = performance.now();

    if (Number.isFinite(payload.x) &&
        Number.isFinite(payload.y) &&
        Number.isFinite(payload.z)) {
      remote.avatar.position.set(payload.x, 0, payload.z);
      remote.avatar.rotation.y = Number.isFinite(payload.yaw)
        ? payload.yaw
        : 0;
    }

    if (typeof payload.health === "number") {
      remote.health = THREE.MathUtils.clamp(payload.health, 0, 100);
      remote.alive = remote.health > 0;
      remote.avatar.visible = remote.alive;
    }

    if (typeof payload.crouched === "boolean") {
      remote.avatar.scale.y = payload.crouched ? 0.75 : 1;
    }

    if (typeof payload.sliding === "boolean" && payload.sliding) {
      remote.avatar.scale.y = 0.45;
    }

    if (typeof payload.aiming === "boolean") {
      remote.avatar.userData.aiming = payload.aiming;
    }
  }

  if (event === "shot") {
    if (
      Number.isFinite(payload.sx) &&
      Number.isFinite(payload.sy) &&
      Number.isFinite(payload.sz) &&
      Number.isFinite(payload.ex) &&
      Number.isFinite(payload.ey) &&
      Number.isFinite(payload.ez)
    ) {
      createTracer(
        new THREE.Vector3(payload.sx, payload.sy, payload.sz),
        new THREE.Vector3(payload.ex, payload.ey, payload.ez),
        0xffe5a0
      );
    }
  }

  if (event === "death") {
    const remote = remotePlayers.get(payload.targetId);

    if (remote) {
      remote.health = 0;
      remote.alive = false;
      remote.avatar.visible = false;
    }
  }

  if (event === "respawn") {
    const remote = remotePlayers.get(payload.id);

    if (remote) {
      remote.health = 100;
      remote.alive = true;
      remote.avatar.visible = true;
      remote.avatar.position.set(
        Number(payload.x) || 0,
        0,
        Number(payload.z) || 0
      );
    }
  }

  if (event === "hit") {
    if (payload.targetId === myId && player.alive) {
      damagePlayer(
        Number(payload.damage) || 0,
        payload.attackerName || "Jugador"
      );
    }
  }
}

async function connectMultiplayer() {
  channel = supabase.channel(ROOM_NAME, {
    config: {
      broadcast: {
        self: false
      },
      presence: {
        key: myId
      }
    }
  });

  channel.on("broadcast", { event: "position" }, ({ payload }) =>
    handleRemoteMessage("position", payload)
  );

  channel.on("broadcast", { event: "shot" }, ({ payload }) =>
    handleRemoteMessage("shot", payload)
  );

  channel.on("broadcast", { event: "death" }, ({ payload }) =>
    handleRemoteMessage("death", payload)
  );

  channel.on("broadcast", { event: "respawn" }, ({ payload }) =>
    handleRemoteMessage("respawn", payload)
  );

  channel.on("broadcast", { event: "hit" }, ({ payload }) =>
    handleRemoteMessage("hit", payload)
  );

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState();
    const keysInRoom = Object.keys(state);

    if (keysInRoom.length > MAX_PLAYERS) {
      showNotice("La sala está llena. No se puede garantizar el límite desde el cliente.");
    }
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("La conexión tardó demasiado. Revisa Supabase."));
    }, 12000);

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        connected = true;

        try {
          await channel.track({
            id: myId,
            name: playerName,
            joinedAt: new Date().toISOString()
          });
        } catch (error) {
          console.warn("No se pudo registrar presencia:", error);
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
   AVISOS Y HUD
========================================= */

function showNotice(message) {
  notice.textContent = message;
  notice.style.opacity = "1";

  clearTimeout(noticeTimeout);

  noticeTimeout = setTimeout(() => {
    notice.style.opacity = "0";
  }, 1800);
}

function showHitMarker() {
  hitMarker.style.display = "block";
  clearTimeout(hitMarkerTimeout);

  hitMarkerTimeout = setTimeout(() => {
    hitMarker.style.display = "none";
  }, 120);
}

function updateHealthHUD() {
  const health = Math.max(0, Math.ceil(player.health));

  healthFill.style.width = `${health}%`;
  healthText.textContent = `${health} / ${player.maxHealth}`;

  if (health > 60) {
    healthFill.style.background = "#48e58c";
  } else if (health > 30) {
    healthFill.style.background = "#ffd04a";
  } else {
    healthFill.style.background = "#ff4545";
  }

  killCountText.textContent = `Bajas: ${player.kills}`;
}

function updateStatus() {
  if (!player.alive) {
    statusText.textContent = "DERRIBADO";
  } else if (player.sliding) {
    statusText.textContent = "DESLIZÁNDOTE";
  } else if (player.crouched) {
    statusText.textContent = "AGACHADO";
  } else if (player.aiming) {
    statusText.textContent = "APUNTANDO";
  } else {
    statusText.textContent = "LISTO PARA COMBATIR";
  }
}

/* =========================================
   DISPAROS Y PROYECTILES VISIBLES
========================================= */

const raycaster = new THREE.Raycaster();
raycaster.far = 120;

const tracerGroup = new THREE.Group();
scene.add(tracerGroup);

function createTracer(start, end, color = 0xffd36a) {
  const distance = start.distanceTo(end);

  if (distance < 0.05) return;

  const geometry = new THREE.BufferGeometry().setFromPoints([
    start,
    end
  ]);

  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95
  });

  const line = new THREE.Line(geometry, material);
  line.userData.life = 0.09;

  tracerGroup.add(line);
}

function updateTracers(delta) {
  for (let i = tracerGroup.children.length - 1; i >= 0; i--) {
    const line = tracerGroup.children[i];
    line.userData.life -= delta;

    if (line.userData.life <= 0) {
      tracerGroup.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
  }
}

function getAllTargets() {
  const targets = [];

  for (const npc of npcs) {
    if (npc.userData.alive) {
      targets.push(npc.userData.head, npc.userData.body);
    }
  }

  for (const [id, remote] of remotePlayers) {
    if (id !== myId && remote.alive && remote.avatar.visible) {
      targets.push(remote.avatar.userData.head, remote.avatar.userData.body);
    }
  }

  return targets;
}

function findTargetOwner(object) {
  for (const npc of npcs) {
    if (object === npc.userData.head || object === npc.userData.body) {
      return { type: "npc", target: npc };
    }
  }

  for (const [id, remote] of remotePlayers) {
    if (
      object === remote.avatar.userData.head ||
      object === remote.avatar.userData.body
    ) {
      return { type: "remote", id, target: remote };
    }
  }

  return null;
}

function shoot() {
  if (!gameStarted || !player.alive || document.pointerLockElement !== renderer.domElement) {
    return;
  }

  const now = performance.now();

  if (now - lastShotTime < 160) return;
  lastShotTime = now;

  camera.updateMatrixWorld(true);

  const origin = camera.position.clone();
  const direction = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(camera.quaternion)
    .normalize();

  raycaster.set(origin, direction);

  const targets = getAllTargets();
  const hits = raycaster.intersectObjects(targets, false);

  let end = origin.clone().add(direction.clone().multiplyScalar(100));

  if (hits.length > 0) {
    const hit = hits[0];
    end.copy(hit.point);

    const owner = findTargetOwner(hit.object);

    if (owner) {
      const isHeadshot = hit.object === owner.target.userData.head;
      const damage = isHeadshot ? 100 : 34;

      showHitMarker();

      if (owner.type === "npc") {
        damageNPC(owner.target, damage, isHeadshot);
      } else {
        /*
          IMPORTANTE:
          El cliente informa del impacto. Para un juego competitivo,
          el servidor debe comprobar el disparo y calcular el daño.
        */
        send("hit", {
          targetId: owner.id,
          damage,
          headshot: isHeadshot,
          attackerName: playerName
        });

        showNotice(isHeadshot ? "¡DISPARO A LA CABEZA!" : "IMPACTO");
      }
    }
  }

  createTracer(origin, end, 0xffd36a);

  send("shot", {
    sx: origin.x,
    sy: origin.y,
    sz: origin.z,
    ex: end.x,
    ey: end.y,
    ez: end.z
  });
}

function damageNPC(npc, damage, headshot) {
  if (!npc.userData.alive) return;

  npc.userData.health -= damage;

  if (headshot) {
    showNotice("¡DISPARO A LA CABEZA!");
  } else {
    showNotice("IMPACTO");
  }

  if (npc.userData.health <= 0) {
    npc.userData.health = 0;
    npc.userData.alive = false;
    npc.visible = false;

    player.kills++;
    updateHealthHUD();

    showNotice(headshot ? "BAJA CON DISPARO A LA CABEZA" : "NPC ELIMINADO");

    setTimeout(() => {
      npc.userData.health = 100;
      npc.userData.alive = true;
      npc.visible = true;

      let x;
      let z;
      let attempts = 0;

      do {
        x = (Math.random() - 0.5) * 180;
        z = (Math.random() - 0.5) * 180;
        attempts++;
      } while (
        (isBlocked(x, z) || Math.hypot(x - player.position.x, z - player.position.z) < 20) &&
        attempts < 100
      );

      npc.position.set(x, 0, z);
      npc.userData.spawnX = x;
      npc.userData.spawnZ = z;
    }, 5000);
  }
}

/* =========================================
   VIDA DEL JUGADOR
========================================= */

function damagePlayer(amount, attackerName = "Enemigo") {
  if (!player.alive || amount <= 0) return;

  player.health = Math.max(0, player.health - amount);
  updateHealthHUD();

  if (player.health <= 0) {
    player.alive = false;
    mouseDown = false;
    downScreen.classList.remove("hidden");
    statusText.textContent = "DERRIBADO";
    showNotice(`Te derribó ${attackerName}`);
  }
}

function respawnPlayer() {
  player.health = 100;
  player.alive = true;
  player.crouched = false;
  player.sliding = false;
  player.aiming = false;
  player.velocity.set(0, 0, 0);
  player.position.set(0, PLAYER_HEIGHT, 6);
  player.yaw = 0;
  player.pitch = 0;

  downScreen.classList.add("hidden");
  updateHealthHUD();
  updateCameraHeight();

  send("respawn", {
    x: player.position.x,
    z: player.position.z,
    health: player.health
  });

  showNotice("HAS REAPARECIDO");
}

/* =========================================
   MOVIMIENTO Y COLISIONES
========================================= */

function tryMove(dx, dz) {
  const nextX = player.position.x + dx;
  const nextZ = player.position.z + dz;

  if (!isBlocked(nextX, player.position.z, 0.45)) {
    player.position.x = nextX;
  }

  if (!isBlocked(player.position.x, nextZ, 0.45)) {
    player.position.z = nextZ;
  }

  player.position.x = THREE.MathUtils.clamp(player.position.x, -125, 125);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -125, 125);
}

function startSlide() {
  if (!player.alive) return;

  if (player.sliding) {
    player.sliding = false;
    player.crouched = false;
    player.slideTimer = 0;
    showNotice("DESLIZAMIENTO CANCELADO");
    updateStatus();
    return;
  }

  const moving =
    keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD;

  if (keys.ShiftLeft && moving && !player.crouched) {
    player.sliding = true;
    player.crouched = true;
    player.slideTimer = 0.75;
    showNotice("DESLIZAMIENTO");
  } else {
    player.crouched = !player.crouched;
    player.sliding = false;
  }

  updateStatus();
}

function updateMovement(delta) {
  if (!player.alive) return;

  if (player.sliding) {
    player.slideTimer -= delta;

    if (player.slideTimer <= 0) {
      player.sliding = false;
      player.crouched = true;
    }
  }

  const forward = new THREE.Vector3(
    -Math.sin(player.yaw),
    0,
    -Math.cos(player.yaw)
  );

  const right = new THREE.Vector3(
    Math.cos(player.yaw),
    0,
    -Math.sin(player.yaw)
  );

  const move = new THREE.Vector3();

  if (keys.KeyW) move.add(forward);
  if (keys.KeyS) move.sub(forward);
  if (keys.KeyD) move.add(right);
  if (keys.KeyA) move.sub(right);

  if (move.lengthSq() > 0) move.normalize();

  let speed = MOVE_SPEED;

  if (player.sliding) {
    speed = SLIDE_SPEED;
  } else if (player.crouched) {
    speed = CROUCH_SPEED;
  } else if (keys.ShiftLeft || keys.ShiftRight) {
    speed = RUN_SPEED;
  }

  if (player.aiming) {
    speed *= 0.65;
  }

  tryMove(
    move.x * speed * delta,
    move.z * speed * delta
  );

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

  camera.position.x = player.position.x;
  camera.position.z = player.position.z;

  updateCameraHeight();

  camera.rotation.order = "YXZ";
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  if (player.sliding) {
    camera.rotation.z = 0.035;
  } else {
    camera.rotation.z = 0;
  }

  updateStatus();
}

/* =========================================
   APUNTADO Y CONTROLES
========================================= */

function updateAiming() {
  player.aiming = mouseDown === false && keys.MouseRight === true;

  const targetFov = player.aiming ? 48 : 75;

  camera.fov = THREE.MathUtils.lerp(
    camera.fov,
    targetFov,
    0.2
  );

  camera.updateProjectionMatrix();

  crosshair.style.transform = "translate(-50%, -50%)";

  if (player.aiming) {
    crosshair.style.opacity = "0.45";
  } else {
    crosshair.style.opacity = "1";
  }

  updateStatus();
}

window.addEventListener("keydown", (event) => {
  keys[event.code] = true;

  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)
  ) {
    event.preventDefault();
  }

  if (!gameStarted) return;

  if (event.code === "KeyC" && !event.repeat) {
    startSlide();
  }

  if (event.code === "KeyE" && !event.repeat && !player.alive) {
    respawnPlayer();
  }

  if (event.code === "Space" && player.crouched && !player.sliding) {
    return;
  }
});

window.addEventListener("keyup", (event) => {
  keys[event.code] = false;
});

renderer.domElement.addEventListener("click", () => {
  if (gameStarted && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== renderer.domElement) {
    mouseDown = false;
    keys.MouseRight = false;
  }
});

document.addEventListener("mousemove", (event) => {
  if (
    !gameStarted ||
    document.pointerLockElement !== renderer.domElement ||
    !player.alive
  ) {
    return;
  }

  const sensitivity = player.aiming ? 0.0014 : 0.0022;

  player.yaw -= event.movementX * sensitivity;
  player.pitch -= event.movementY * sensitivity;

  player.pitch = THREE.MathUtils.clamp(
    player.pitch,
    -Math.PI / 2 + 0.05,
    Math.PI / 2 - 0.05
  );
});

document.addEventListener("mousedown", (event) => {
  if (event.button === 0) {
    mouseDown = true;
    shoot();
  }

  if (event.button === 2) {
    keys.MouseRight = true;
  }
});

document.addEventListener("mouseup", (event) => {
  if (event.button === 0) {
    mouseDown = false;
  }

  if (event.button === 2) {
    keys.MouseRight = false;
  }
});

document.addEventListener("contextmenu", (event) => {
  if (gameStarted) event.preventDefault();
});

/* =========================================
   IA SENCILLA DE LOS NPC
========================================= */

function updateNPCs(delta) {
  const now = performance.now();

  for (const npc of npcs) {
    if (!npc.userData.alive) continue;

    npc.userData.moveTimer -= delta;

    if (npc.userData.moveTimer <= 0) {
      npc.userData.moveTimer = 1 + Math.random() * 3;
      npc.userData.direction += (Math.random() - 0.5) * 2.4;
    }

    const distance = npc.position.distanceTo(
      new THREE.Vector3(
        player.position.x,
        0,
        player.position.z
      )
    );

    if (distance < 13 && player.alive) {
      npc.lookAt(player.position.x, 0, player.position.z);

      if (now - npc.userData.lastAttack > 1200) {
        npc.userData.lastAttack = now;

        if (distance < 9 && Math.random() < 0.3) {
          damagePlayer(5, npc.userData.name);
        }
      }
    } else {
      const dx = Math.sin(npc.userData.direction) * 1.2 * delta;
      const dz = Math.cos(npc.userData.direction) * 1.2 * delta;

      const nextX = npc.position.x + dx;
      const nextZ = npc.position.z + dz;

      if (!isBlocked(nextX, nextZ, 0.5)) {
        npc.position.x = nextX;
        npc.position.z = nextZ;
      } else {
        npc.userData.direction += Math.PI * (0.5 + Math.random());
      }

      npc.rotation.y = npc.userData.direction;
    }
  }
}

/* =========================================
   SINCRONIZACIÓN
========================================= */

function updateNetwork() {
  const now = performance.now();

  if (!connected || now - lastPositionBroadcast < 100) return;

  lastPositionBroadcast = now;

  send("position", {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    yaw: player.yaw,
    health: player.health,
    crouched: player.crouched,
    sliding: player.sliding,
    aiming: player.aiming
  });
}

/* =========================================
   INICIO DEL JUEGO
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
    updateHealthHUD();

    renderer.domElement.requestPointerLock();

    showNotice("¡BIENVENIDO A LA CIUDAD!");
  } catch (error) {
    console.error(error);

    menuError.textContent =
      error.message || "No se pudo conectar. Revisa la configuración.";

    playButton.disabled = false;
  }
});

/* =========================================
   LIMPIEZA DE JUGADORES DESCONECTADOS
========================================= */

setInterval(() => {
  const now = performance.now();

  for (const [id, remote] of remotePlayers) {
    if (now - remote.lastUpdate > 10000) {
      removeRemotePlayer(id);
    }
  }
}, 3000);

/* =========================================
   BUCLE PRINCIPAL
========================================= */

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  if (gameStarted) {
    updateMovement(delta);
    updateAiming();
    updateNPCs(delta);
    updateTracers(delta);
    updateNetwork();
  } else {
    updateTracers(delta);
  }

  renderer.render(scene, camera);
}

animate();

/* =========================================
   AJUSTE DE VENTANA
========================================= */

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

/* =========================================
   SALIDA
========================================= */

window.addEventListener("beforeunload", () => {
  if (channel) {
    supabase.removeChannel(channel);
  }
});
