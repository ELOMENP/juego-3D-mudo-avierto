
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://vlwfntwxbzmeodutbrxd.supabase.co";
const SUPABASE_KEY = "sb_publishable_JKRwt7biD2Y9wCQpQC9iQA_-EDPL17V";

const ROOM = "ciudad-publica-v1";
const MAX_PLAYERS = 10;
const PLAYER_SPEED = 7;
const PLAYER_ID = crypto.randomUUID();

const $ = (id) => document.getElementById(id);

let supabase = null;
let channel = null;
let scene = null;
let camera = null;
let renderer = null;
let player = null;
let weapon = null;

let joined = false;
let connecting = false;
let playerName = "";
let yaw = 0;
let pitch = 0;
let health = 100;
let score = 0;
let isDown = false;
let respawnTimer = 0;
let lastFrame = 0;
let lastPosition = 0;
let lastShot = 0;
let slideTimer = 0;
let sliding = false;
let crouching = false;
let reviveTarget = null;
let reviveProgress = 0;
let monsterTimer = 0;
let animationId = 0;

const keys = new Set();
const remotes = new Map();
const monsters = new Map();
const colliders = [];
const tracers = [];

const position = { x: 0, z: 0 };

function status(text) {
  $("menuStatus").textContent = text;
}

function notify(text) {
  $("notice").textContent = text;
}

function updateHUD() {
  $("health").textContent = health;
  $("score").textContent = score;
}

function broadcast(event, payload) {
  if (!channel || !joined) return;

  channel.send({ type: "broadcast", event, payload })
    .catch((error) => console.warn("Realtime:", error));
}

function presenceList() {
  if (!channel) return [];

  return Object.values(channel.presenceState()).flat();
}

function updatePlayerCount() {
  const ids = new Set(
    presenceList().map((p) => p.id).filter(Boolean)
  );

  if (joined) ids.add(PLAYER_ID);
  $("playerCount").textContent = Math.min(ids.size, MAX_PLAYERS);
}

$("joinForm").addEventListener("submit", startGame);
$("leaveButton").addEventListener("click", leaveGame);

async function startGame(event) {
  event.preventDefault();
  if (connecting || joined) return;

  playerName = $("playerName").value.trim().slice(0, 18);

  if (!playerName) {
    status("Escribe tu nombre.");
    return;
  }

  connecting = true;
  $("playButton").disabled = true;
  status("Conectando...");

  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    channel = supabase.channel(ROOM, {
      config: {
        broadcast: { self: false },
        presence: { key: PLAYER_ID }
      }
    });

    channel
      .on("presence", { event: "sync" }, syncPlayers)
      .on("broadcast", { event: "position" }, ({ payload }) => {
        receivePosition(payload);
      })
      .on("broadcast", { event: "shot" }, ({ payload }) => {
        receiveShot(payload);
      })
      .on("broadcast", { event: "down" }, ({ payload }) => {
        if (payload?.id !== PLAYER_ID) {
          const remote = remotes.get(payload?.id);
          if (remote) remote.downed = true;
        }
      })
      .on("broadcast", { event: "revive" }, ({ payload }) => {
        if (payload?.id === PLAYER_ID) {
          isDown = false;
          health = 50;
          position.x = 0;
          position.z = 0;
          player.position.set(0, 0, 0);
          updateHUD();
          notify("¡Te han revivido!");
        } else {
          const remote = remotes.get(payload?.id);
          if (remote) remote.downed = false;
        }
      });

    await subscribeRoom();
    createWorld();

    joined = true;
    $("menu").hidden = true;
    $("game").hidden = false;

    renderer.domElement.addEventListener("click", canvasClick);
    document.addEventListener("pointerlockchange", lockChanged);
    document.addEventListener("mousemove", mouseMove);
    document.addEventListener("keydown", keyDown);
    document.addEventListener("keyup", keyUp);
    window.addEventListener("resize", resize);

    syncPlayers();
    updateHUD();
    updatePlayerCount();
    notify("Haz clic en la ciudad para jugar.");
    animationId = requestAnimationFrame(animate);
  } catch (error) {
    console.error(error);
    status(error.message || "No se pudo iniciar el juego.");

    if (channel) await channel.unsubscribe().catch(() => {});
    channel = null;
    supabase = null;
    disposeWorld();
  } finally {
    connecting = false;
    $("playButton").disabled = false;
  }
}

function subscribeRoom() {
  return new Promise((resolve, reject) => {
    let done = false;

    const timeout = setTimeout(() => finish(
      new Error("Tiempo de conexión agotado. Revisa Supabase Realtime.")
    ), 10000);

    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      error ? reject(error) : resolve();
    }

    channel.subscribe(async (state) => {
      if (done) return;

      if (state === "SUBSCRIBED") {
        try {
          const ids = new Set(
            presenceList().map((p) => p.id).filter(Boolean)
          );

          if (ids.size >= MAX_PLAYERS && !ids.has(PLAYER_ID)) {
            await channel.unsubscribe();
            finish(new Error("La sala está llena."));
            return;
          }

          await channel.track({
            id: PLAYER_ID,
            name: playerName,
            x: 0,
            z: 0,
            rotation: 0,
            downed: false
          });

          finish();
        } catch (error) {
          finish(error);
        }
      }

      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        finish(new Error("Error de Supabase. Verifica la URL, la clave y Realtime."));
      }
    });
  });
}

function createWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8bc7ed);
  scene.fog = new THREE.Fog(0x8bc7ed, 100, 250);

  camera = new THREE.PerspectiveCamera(
    75, innerWidth / innerHeight, 0.1, 400
  );

  renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance"
  });

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $("game").insertBefore(renderer.domElement, $("hud"));

  scene.add(new THREE.HemisphereLight(0xffffff, 0x66715e, 2));

  const light = new THREE.DirectionalLight(0xffffff, 1.5);
  light.position.set(50, 80, 30);
  scene.add(light);

  addBox(280, 0.1, 280, 0x60945a, 0, -0.1, 0);

  for (let n = -120; n <= 120; n += 40) {
    addBox(12, 0.06, 280, 0x333a43, n, 0, 0);
    addBox(280, 0.06, 12, 0x333a43, 0, 0, n);
  }

  createBuildings();

  player = createCharacter(0x27d7a0, playerName, false);
  scene.add(player);

  camera.add(createWeapon());
  scene.add(camera);

  for (let i = 0; i < 5; i++) spawnMonster();

  updateCamera();
}

function addBox(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color })
  );

  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function createBuildings() {
  const colors = [
    0x778b9b, 0x9a9c9e, 0x727f8a,
    0xb5a895, 0x657987, 0xc1b7a2
  ];

  for (let x = -100; x <= 100; x += 20) {
    for (let z = -100; z <= 100; z += 20) {
      if (Math.abs(x % 40) < 8 || Math.abs(z % 40) < 8) continue;

      const w = 7 + Math.random() * 3;
      const d = 7 + Math.random() * 3;
      const h = 5 + Math.random() * 18;
      const bx = x + (Math.random() - 0.5) * 3;
      const bz = z + (Math.random() - 0.5) * 3;

      addBox(
        w, h, d,
        colors[Math.floor(Math.random() * colors.length)],
        bx, h / 2, bz
      );

      colliders.push({
        minX: bx - w / 2 - 0.55,
        maxX: bx + w / 2 + 0.55,
        minZ: bz - d / 2 - 0.55,
        maxZ: bz + d / 2 + 0.55
      });
    }
  }
}

function createCharacter(color, name, withLabel = true) {
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

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 48;

  const texture = new THREE.CanvasTexture(canvas);
  const bar = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    depthTest: false
  }));

  bar.position.y = 2.55;
  bar.scale.set(1.5, 0.28, 1);
  group.add(bar);

  group.userData.barCanvas = canvas;
  group.userData.barTexture = texture;
  group.userData.health = 100;
  drawHealth(group, 100);

  if (withLabel) {
    const nameCanvas = document.createElement("canvas");
    nameCanvas.width = 512;
    nameCanvas.height = 96;
    const ctx = nameCanvas.getContext("2d");

    ctx.font = "bold 36px Arial";
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#101820";
    ctx.fillStyle = "#fff";
    ctx.strokeText(name.slice(0, 18), 256, 60);
    ctx.fillText(name.slice(0, 18), 256, 60);

    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(nameCanvas),
      transparent: true
    }));

    label.position.y = 2.9;
    label.scale.set(2.5, 0.48, 1);
    group.add(label);
  }

  return group;
}

function drawHealth(character, value) {
  const canvas = character.userData.barCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const ratio = THREE.MathUtils.clamp(value / 100, 0, 1);

  ctx.clearRect(0, 0, 256, 48);
  ctx.fillStyle = "#151515";
  ctx.fillRect(0, 0, 256, 48);
  ctx.fillStyle = ratio > 0.5 ? "#36e6a0" :
    ratio > 0.25 ? "#ffd166" : "#ff4757";
  ctx.fillRect(4, 4, 248 * ratio, 40);

  character.userData.barTexture.needsUpdate = true;
}

function createWeapon() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.15, 0.65),
    new THREE.MeshLambertMaterial({ color: 0x252a32 })
  );

  body.position.set(0.28, -0.25, -0.55);
  group.add(body);

  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.07, 0.42),
    new THREE.MeshLambertMaterial({ color: 0x626b75 })
  );

  barrel.position.set(0.28, -0.21, -1);
  group.add(barrel);

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe08a })
  );

  flash.position.set(0.28, -0.21, -1.25);
  flash.visible = false;
  group.add(flash);
  group.userData.flash = flash;

  weapon = group;
  return group;
}

function spawnMonster() {
  if (!scene || monsters.size >= 8) return;

  let x, z;
  let attempts = 0;

  do {
    x = (Math.random() - 0.5) * 180;
    z = (Math.random() - 0.5) * 180;
    attempts++;
  } while (
    attempts < 30 &&
    (collides(x, z) || Math.hypot(x - position.x, z - position.z) < 18)
  );

  if (collides(x, z)) return;

  const mesh = createCharacter(0x8e44ad, "MONSTRUO", false);
  mesh.scale.set(1.15, 1.1, 1.15);
  mesh.position.set(x, 0, z);
  scene.add(mesh);

  monsters.set(crypto.randomUUID(), {
    mesh,
    health: 100,
    speed: 2
  });
}

function collides(x, z) {
  if (Math.abs(x) > 132 || Math.abs(z) > 132) return true;

  return colliders.some((b) =>
    x > b.minX && x < b.maxX &&
    z > b.minZ && z < b.maxZ
  );
}

function syncPlayers() {
  if (!scene || !channel) return;

  const entries = presenceList();
  const active = new Set();

  for (const data of entries) {
    if (!data.id || data.id === PLAYER_ID) continue;
    active.add(data.id);

    let remote = remotes.get(data.id);

    if (!remote) {
      const group = createCharacter(0xf2a541, data.name || "Jugador");
      group.position.set(Number(data.x) || 0, 0, Number(data.z) || 0);
      scene.add(group);

      remote = {
        group,
        name: data.name || "Jugador",
        targetX: group.position.x,
        targetZ: group.position.z,
        rotation: 0,
        downed: Boolean(data.downed)
      };

      remotes.set(data.id, remote);
    }
  }

  for (const [id, remote] of remotes) {
    if (!active.has(id)) {
      scene.remove(remote.group);
      disposeObject(remote.group);
      remotes.delete(id);
    }
  }

  updatePlayerCount();
}

function receivePosition(data) {
  if (!data?.id || data.id === PLAYER_ID) return;
  if (!Number.isFinite(data.x) || !Number.isFinite(data.z)) return;

  const remote = remotes.get(data.id);
  if (!remote) return;

  remote.targetX = THREE.MathUtils.clamp(data.x, -130, 130);
  remote.targetZ = THREE.MathUtils.clamp(data.z, -130, 130);
  remote.rotation = Number(data.rotation) || 0;
  remote.downed = Boolean(data.downed);
}

function canvasClick() {
  if (joined && renderer &&
      document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
    return;
  }

  shoot();
}

function lockChanged() {
  $("lockMessage").hidden =
    document.pointerLockElement === renderer?.domElement;

  if (document.pointerLockElement !== renderer?.domElement) keys.clear();
}

function mouseMove(event) {
  if (document.pointerLockElement !== renderer?.domElement) return;

  yaw -= event.movementX * 0.0022;
  pitch -= event.movementY * 0.0018;
  pitch = THREE.MathUtils.clamp(pitch, -1.1, 1.1);
}

function keyDown(event) {
  const key = event.key.toLowerCase();

  if (["w", "a", "s", "d", " ", "arrowup", "arrowdown",
       "arrowleft", "arrowright"].includes(key)) {
    event.preventDefault();
  }

  keys.add(key);

  if (key === "c" && keys.has("shift") && !sliding && !isDown) {
    sliding = true;
    crouching = true;
    slideTimer = 0.8;
  }

  if (key === "control") crouching = true;
  if (key === " " && player && player.position.y <= 0.01 && !isDown) {
    player.userData.jumpVelocity = 7;
  }
}

function keyUp(event) {
  const key = event.key.toLowerCase();
  keys.delete(key);

  if (key === "control") crouching = false;
}

function updateCamera() {
  if (!camera || !player) return;

  camera.position.set(
    position.x,
    player.position.y + (crouching ? 0.9 : 1.65),
    position.z
  );

  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function movePlayer(delta) {
  if (isDown) return;

  let forward = 0;
  let sideways = 0;

  if (keys.has("w") || keys.has("arrowup")) forward++;
  if (keys.has("s") || keys.has("arrowdown")) forward--;
  if (keys.has("d") || keys.has("arrowright")) sideways++;
  if (keys.has("a") || keys.has("arrowleft")) sideways--;

  const length = Math.hypot(forward, sideways) || 1;
  forward /= length;
  sideways /= length;

  let speed = PLAYER_SPEED;

  if (keys.has("shift")) speed *= 1.65;
  if (crouching) speed *= 0.5;

  if (sliding) {
    speed = PLAYER_SPEED * 2;
    slideTimer -= delta;

    if (slideTimer <= 0) {
      sliding = false;
      crouching = keys.has("control");
    }
  }

  const dx = (
    -Math.sin(yaw) * forward + Math.cos(yaw) * sideways
  ) * speed * delta;

  const dz = (
    -Math.cos(yaw) * forward - Math.sin(yaw) * sideways
  ) * speed * delta;

  if (!collides(position.x + dx, position.z)) position.x += dx;
  if (!collides(position.x, position.z + dz)) position.z += dz;

  player.position.x = position.x;
  player.position.z = position.z;
  player.rotation.y = yaw;

  player.userData.jumpVelocity ??= 0;
  player.userData.jumpVelocity -= 18 * delta;
  player.position.y += player.userData.jumpVelocity * delta;

  if (player.position.y < 0) {
    player.position.y = 0;
    player.userData.jumpVelocity = 0;
  }

  updateCamera();
}

function shoot() {
  if (!joined || isDown || !camera || !channel) return;

  const now = performance.now();
  if (now - lastShot < 300) return;
  lastShot = now;

  weapon.userData.flash.visible = true;
  weapon.position.z = -0.12;

  setTimeout(() => {
    if (weapon) {
      weapon.userData.flash.visible = false;
      weapon.position.z = 0;
    }
  }, 75);

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  const origin = camera.position.clone();
  const raycaster = new THREE.Raycaster(origin, direction, 0, 80);
  const targets = [];

  for (const [id, monster] of monsters) {
    monster.mesh.traverse((obj) => {
      if (obj.isMesh) {
        obj.userData.monsterId = id;
        targets.push(obj);
      }
    });
  }

  for (const [id, remote] of remotes) {
    if (!remote.downed) {
      remote.group.traverse((obj) => {
        if (obj.isMesh) {
          obj.userData.playerId = id;
          targets.push(obj);
        }
      });
    }
  }

  const hits = raycaster.intersectObjects(targets, false);
  let end = origin.clone().add(direction.clone().multiplyScalar(45));

  if (hits.length) {
    end = hits[0].point.clone();

    let obj = hits[0].object;
    let monsterId = null;
    let targetPlayerId = null;

    while (obj) {
      monsterId ||= obj.userData.monsterId;
      targetPlayerId ||= obj.userData.playerId;
      obj = obj.parent;
    }

    if (monsterId && monsters.has(monsterId)) {
      const monster = monsters.get(monsterId);
      monster.health = Math.max(0, monster.health - 34);
      drawHealth(monster.mesh, monster.health);

      if (monster.health === 0) {
        scene.remove(monster.mesh);
        disposeObject(monster.mesh);
        monsters.delete(monsterId);
        score++;
        updateHUD();
        notify("¡Monstruo eliminado!");
      } else {
        notify("Vida del monstruo: " + monster.health);
      }
    }

    if (targetPlayerId) {
      broadcast("shot", {
        shooter: PLAYER_ID,
        target: targetPlayerId,
        damage: 25
      });
    }
  }

  const tracer = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([origin, end]),
    new THREE.LineBasicMaterial({ color: 0xffe08a })
  );

  scene.add(tracer);
  tracers.push({ object: tracer, expires: now + 90 });
}

function receiveShot(data) {
  if (!data || data.target !== PLAYER_ID || isDown) return;

  health = Math.max(0, health - Math.min(100, data.damage || 25));
  updateHUD();

  if (health === 0) {
    isDown = true;
    respawnTimer = performance.now() + 15000;
    broadcast("down", { id: PLAYER_ID });
    notify("Estás derribado. Un compañero puede acercarse y mantener E para revivirte.");
  } else {
    notify("Te dispararon. Vida: " + health);
  }
}

function updateMonsters(delta, now) {
  monsterTimer += delta;

  if (monsterTimer >= 7 && monsters.size < 8) {
    monsterTimer = 0;
    spawnMonster();
  }

  if (isDown) return;

  for (const monster of monsters.values()) {
    const mesh = monster.mesh;
    const dx = position.x - mesh.position.x;
    const dz = position.z - mesh.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance > 1.5 && distance < 100) {
      const step = monster.speed * delta;
      const nx = mesh.position.x + dx / distance * step;
      const nz = mesh.position.z + dz / distance * step;

      if (!collides(nx, mesh.position.z)) mesh.position.x = nx;
      if (!collides(mesh.position.x, nz)) mesh.position.z = nz;

      mesh.rotation.y = Math.atan2(dx, dz);
    }

    monster.attackCooldown ??= 0;

    if (distance < 1.7 && now > monster.attackCooldown) {
      monster.attackCooldown = now + 1000;
      health = Math.max(0, health - 10);
      updateHUD();

      if (health === 0) {
        isDown = true;
        respawnTimer = now + 15000;
        broadcast("down", { id: PLAYER_ID });
        notify("Un monstruo te derribó. Mantén E para intentar revivir a un compañero cuando esté cerca.");
      } else {
        notify("¡Te ataca un monstruo! Vida: " + health);
      }
    }
  }
}

function updateRevive(delta) {
  if (!joined || isDown || !keys.has("e")) {
    reviveTarget = null;
    reviveProgress = 0;
    return;
  }

  let closestId = null;
  let closestDistance = 3;

  for (const [id, remote] of remotes) {
    if (!remote.downed) continue;

    const distance = Math.hypot(
      remote.group.position.x - position.x,
      remote.group.position.z - position.z
    );

    if (distance < closestDistance) {
      closestDistance = distance;
      closestId = id;
    }
  }

  if (!closestId) {
    reviveTarget = null;
    reviveProgress = 0;
    return;
  }

  if (reviveTarget !== closestId) {
    reviveTarget = closestId;
    reviveProgress = 0;
  }

  reviveProgress += delta;
  notify("Reanimando: " + Math.floor(reviveProgress / 3 * 100) + "%");

  if (reviveProgress >= 3) {
    broadcast("revive", { id: closestId });
    const remote = remotes.get(closestId);
    if (remote) remote.downed = false;

    reviveTarget = null;
    reviveProgress = 0;
    notify("¡Compañero reanimado!");
  }
}

function animate(now = 0) {
  if (!joined) return;

  animationId = requestAnimationFrame(animate);
  const delta = Math.min((now - lastFrame) / 1000 || 0, 0.05);
  lastFrame = now;

  if (isDown && now >= respawnTimer) {
    isDown = false;
    health = 50;
    position.x = 0;
    position.z = 0;
    player.position.set(0, 0, 0);
    updateHUD();
    notify("Has reaparecido.");
  }

  movePlayer(delta);
  updateMonsters(delta, now);
  updateRevive(delta);

  for (const remote of remotes.values()) {
    remote.group.position.x = THREE.MathUtils.lerp(
      remote.group.position.x, remote.targetX, 0.2
    );

    remote.group.position.z = THREE.MathUtils.lerp(
      remote.group.position.z, remote.targetZ, 0.2
    );

    remote.group.rotation.y = remote.rotation;
  }

  if (now - lastPosition > 100) {
    lastPosition = now;
    broadcast("position", {
      id: PLAYER_ID,
      name: playerName,
      x: position.x,
      z: position.z,
      rotation: yaw,
      downed: isDown
    });
  }

  for (let i = tracers.length - 1; i >= 0; i--) {
    if (now >= tracers[i].expires) {
      scene.remove(tracers[i].object);
      tracers[i].object.geometry.dispose();
      tracers[i].object.material.dispose();
      tracers.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
}

function resize() {
  if (!camera || !renderer) return;

  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh && !child.isSprite) return;

    child.geometry?.dispose();

    const materials = Array.isArray(child.material)
      ? child.material : [child.material];

    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  });
}

function disposeWorld() {
  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
  }

  if (scene) {
    scene.traverse((obj) => {
      if (!obj.isMesh && !obj.isSprite && !obj.isLine) return;

      obj.geometry?.dispose();

      const materials = Array.isArray(obj.material)
        ? obj.material : [obj.material];

      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    });
  }

  scene = null;
  camera = null;
  renderer = null;
  player = null;
  weapon = null;

  remotes.clear();
  monsters.clear();
  colliders.length = 0;
  tracers.length = 0;
}

async function leaveGame() {
  joined = false;
  cancelAnimationFrame(animationId);
  keys.clear();

  document.removeEventListener("pointerlockchange", lockChanged);
  document.removeEventListener("mousemove", mouseMove);
  document.removeEventListener("keydown", keyDown);
  document.removeEventListener("keyup", keyUp);
  window.removeEventListener("resize", resize);

  if (document.pointerLockElement) document.exitPointerLock();

  if (channel) {
    try {
      await channel.untrack();
      await channel.unsubscribe();
    } catch (error) {
      console.warn(error);
    }
  }

  channel = null;
  supabase = null;
  disposeWorld();

  $("game").hidden = true;
  $("menu").hidden = false;
  $("playButton").disabled = false;

  health = 100;
  score = 0;
  isDown = false;
  position.x = 0;
  position.z = 0;
  yaw = 0;
  pitch = 0;
  updateHUD();
  status("Escribe tu nombre para volver a jugar.");
}
