import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/PointerLockControls.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// PEGA aquí los datos de Supabase. Usa la URL del proyecto y la clave PUBLICABLE/anon, nunca service_role.
const SUPABASE_URL = 'PEGA_AQUI_TU_URL';
const SUPABASE_KEY = 'PEGA_AQUI_TU_CLAVE_PUBLICA';

const $ = (id) => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), statusText = $('status'), joinBtn = $('joinBtn'), createLobbyBtn = $('createLobbyBtn');
let supabase = null, channel = null, roomCode = '', playerId = crypto.randomUUID();
let playerName = 'Jugador', playing = false, dead = false;
let health = 100, kills = 0, weaponMode = 1, ammo = { 1: 12, 2: 30 }, maxAmmo = { 1: 12, 2: 30 };
let verticalVelocity = 0, grounded = true, crouching = false, aiming = false;
const standingHeight = 1.7, crouchHeight = 1.0;
const keys = {}, remotePlayers = new Map(), playerScores = new Map();
const buildings = [], collidableBoxes = [];
let lastStateSend = 0, lastShot = 0, reloading = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bc8e8);
scene.fog = new THREE.Fog(0x9bc8e8, 70, 230);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());
scene.add(new THREE.HemisphereLight(0xe4f4ff, 0x5c654f, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(40, 80, 25); sun.castShadow = true; scene.add(sun);

function makeBox(w, h, d, color, x, y, z, materialOptions = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, ...materialOptions }));
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
}

// Suelo y calles: las calles están centradas en las líneas de la cuadrícula.
makeBox(220, 1, 220, 0x47764a, 0, -0.55, 0);
for (let p = -100; p <= 100; p += 25) {
  makeBox(12, 0.04, 220, 0x333940, p, -0.025, 0);
  makeBox(220, 0.04, 12, 0x333940, 0, -0.02, p);
  // Líneas discontinuas sencillas en las calles.
  for (let s = -100; s <= 100; s += 12) {
    makeBox(0.18, 0.05, 4, 0xd9d7a5, p, 0.005, s);
    makeBox(4, 0.05, 0.18, 0xd9d7a5, s, 0.01, p);
  }
}

// Edificios colocados en las manzanas, separados del ancho de las calles.
for (let x = -87.5; x <= 87.5; x += 25) {
  for (let z = -87.5; z <= 87.5; z += 25) {
    const h = 5 + Math.random() * 18;
    const w = 8 + Math.random() * 2, d = 8 + Math.random() * 2;
    const color = new THREE.Color().setHSL(0.56 + Math.random() * 0.04, 0.12, 0.34 + Math.random() * 0.18);
    const building = makeBox(w, h, d, color, x, h / 2, z);
    building.userData.isBuilding = true;
    buildings.push(building);
    collidableBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    // Ventanas decorativas en la fachada frontal.
    for (let wy = 1.5; wy < h - 1; wy += 3) {
      for (let wx = -w / 2 + 1.4; wx < w / 2 - 0.5; wx += 2.2) {
        const win = makeBox(0.9, 1.15, 0.06, 0x83c9e6, x + wx, wy, z - d / 2 - 0.04, { emissive: 0x163444, roughness: 0.4 });
        win.castShadow = false;
      }
    }
  }
}

// Arma visible sencilla en primera persona.
const weaponGroup = new THREE.Group(); camera.add(weaponGroup);
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.48), new THREE.MeshStandardMaterial({ color: 0x242a30, metalness: 0.65, roughness: 0.35 }));
gunBody.position.set(0.28, -0.23, -0.55); weaponGroup.add(gunBody);
const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.13), new THREE.MeshStandardMaterial({ color: 0x17191c })); gunGrip.position.set(0.28, -0.36, -0.42); weaponGroup.add(gunGrip);

function setWeapon(mode) {
  weaponMode = mode;
  $('weapon').textContent = mode === 1 ? 'Pistola' : 'Rifle';
  gunBody.scale.set(mode === 1 ? 1 : 1.25, mode === 1 ? 1 : 1.15, mode === 1 ? 1 : 1.7);
  gunBody.position.z = mode === 1 ? -0.55 : -0.7;
  updateAmmo();
}
function updateAmmo() { $('ammo').textContent = `${ammo[weaponMode]} / ${maxAmmo[weaponMode]}`; }
function setHealth(value) { health = Math.max(0, Math.min(100, value)); $('health').textContent = health; }

function collidesAt(x, z) {
  const r = 0.48;
  if (Math.abs(x) > 105 || Math.abs(z) > 105) return true;
  return collidableBoxes.some(b => x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ);
}
function moveWithCollision(dx, dz) {
  const p = controls.getObject();
  const nextX = p.position.x + dx;
  if (!collidesAt(nextX, p.position.z)) p.position.x = nextX;
  const nextZ = p.position.z + dz;
  if (!collidesAt(p.position.x, nextZ)) p.position.z = nextZ;
}

function createRemote(id, name) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.38), new THREE.MeshStandardMaterial({ color: 0x2e91bd })); body.position.y = 0.9; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd6a77f })); head.position.y = 1.65; group.add(head);
  scene.add(group);
  const remote = { id, name, group, body, head, lastSeen: performance.now(), health: 100 };
  remotePlayers.set(id, remote); return remote;
}
function removeRemote(id) { const r = remotePlayers.get(id); if (r) { scene.remove(r.group); remotePlayers.delete(id); } }
function renderScoreboard() {
  const all = [...playerScores.values()].sort((a, b) => b.kills - a.kills || a.name.localeCompare(b.name));
  $('scoreRows').innerHTML = '';
  for (const p of all.slice(0, 8)) {
    const row = document.createElement('div'); row.className = 'score-row';
    const name = document.createElement('span'); name.textContent = p.id === playerId ? `${p.name} (Tú)` : p.name;
    const score = document.createElement('span'); score.textContent = String(p.kills);
    row.append(name, score); $('scoreRows').appendChild(row);
  }
  $('players').textContent = String(Math.max(1, remotePlayers.size + 1));
}
function upsertScore(id, name, score) {
  const existing = playerScores.get(id);
  playerScores.set(id, { id, name: name || existing?.name || 'Jugador', kills: Number.isFinite(score) ? score : existing?.kills || 0 });
  renderScoreboard();
}
function broadcast(event, payload) { if (channel) channel.send({ type: 'broadcast', event, payload }).catch(() => {}); }

async function connectRoom() {
  if (!SUPABASE_URL.startsWith('https://') || SUPABASE_KEY.includes('PEGA_AQUI')) {
    statusText.textContent = 'Falta configurar SUPABASE_URL y SUPABASE_KEY en game.js. El juego local puede iniciar, pero el multijugador no.';
    return false;
  }
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    channel = supabase.channel(`ciudad-abierta-${roomCode}`, { config: { broadcast: { self: false } } });
    channel.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (!payload || payload.id === playerId) return;
      const r = remotePlayers.get(payload.id) || createRemote(payload.id, payload.name);
      r.name = payload.name || r.name; r.lastSeen = performance.now();
      r.group.position.set(payload.x || 0, 0, payload.z || 0);
      r.group.rotation.y = payload.rotation || 0;
      upsertScore(payload.id, r.name, payload.kills || 0);
    });
    channel.on('broadcast', { event: 'hello' }, ({ payload }) => {
      if (payload?.id && payload.id !== playerId) broadcast('score', { id: playerId, name: playerName, kills });
    });
    channel.on('broadcast', { event: 'score' }, ({ payload }) => {
      if (payload?.id && payload.id !== playerId) upsertScore(payload.id, payload.name, payload.kills || 0);
    });
    channel.on('broadcast', { event: 'shot' }, ({ payload }) => {
      if (!payload || payload.targetId !== playerId || dead) return;
      setHealth(health - (payload.damage || 20));
      if (health <= 0) {
        dead = true; statusText.textContent = 'Te eliminaron. Reaparecerás en 3 segundos.';
        setTimeout(() => { dead = false; setHealth(100); controls.getObject().position.set(0, standingHeight, 0); }, 3000);
      }
    });
    channel.on('broadcast', { event: 'kill' }, ({ payload }) => {
      if (!payload || payload.killerId !== playerId) return;
      kills++; upsertScore(playerId, playerName, kills); broadcast('score', { id: playerId, name: playerName, kills });
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tiempo de espera agotado al entrar a la sala. Revisa la URL, la clave y Realtime.')), 9000);
      channel.subscribe((state) => {
        if (state === 'SUBSCRIBED') { clearTimeout(timeout); resolve(); }
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') { clearTimeout(timeout); reject(new Error(`Estado de Supabase: ${state}`)); }
      });
    });
    broadcast('hello', { id: playerId, name: playerName });
    broadcast('score', { id: playerId, name: playerName, kills });
    statusText.textContent = `Conectado a la sala ${roomCode}.`;
    return true;
  } catch (err) {
    console.error(err);
    statusText.textContent = `No se pudo conectar a Supabase: ${err.message || err}. Puedes jugar localmente.`;
    if (channel) { try { await supabase.removeChannel(channel); } catch {} }
    channel = null;
    return false;
  }
}

async function enterLobby(isCreating = false) {
  playerName = $('playerName').value.trim().slice(0, 18) || 'Jugador';
  if (isCreating) {
    // Código corto y fácil de compartir con amigos.
    roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    $('roomCode').value = roomCode;
  } else {
    roomCode = $('roomCode').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
    if (!roomCode) {
      statusText.textContent = 'Escribe el código de la sala o pulsa “Crear lobby”.';
      return;
    }
  }

  joinBtn.disabled = true;
  createLobbyBtn.disabled = true;
  statusText.textContent = isCreating ? `Creando lobby ${roomCode}…` : `Buscando lobby ${roomCode}…`;
  const connected = await connectRoom();
  if (!connected) {
    joinBtn.disabled = false;
    createLobbyBtn.disabled = false;
    return;
  }

  statusText.textContent = isCreating
    ? `Lobby creado. Comparte este código: ${roomCode}`
    : `Conectado al lobby ${roomCode}.`;
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  playing = true;
  controls.getObject().position.set(0, standingHeight, 0);
  upsertScore(playerId, playerName, kills);
  controls.lock();
  joinBtn.disabled = false;
  createLobbyBtn.disabled = false;
}

createLobbyBtn.addEventListener('click', () => enterLobby(true));
joinBtn.addEventListener('click', () => enterLobby(false));
$('leaveBtn').addEventListener('click', async () => {
  playing = false; controls.unlock(); menu.classList.remove('hidden'); hud.classList.add('hidden');
  if (channel && supabase) { await supabase.removeChannel(channel); channel = null; }
  for (const id of [...remotePlayers.keys()]) removeRemote(id);
  playerScores.clear();
});

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); if (grounded && playing && controls.isLocked && !dead) { verticalVelocity = 7.5; grounded = false; } }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
    if (!crouching && grounded) controls.getObject().position.y = crouchHeight;
    crouching = true;
  }
  if (e.code === 'Digit1') setWeapon(1);
  if (e.code === 'Digit2') setWeapon(2);
  if (e.code === 'KeyR') reloadWeapon();
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
    crouching = false;
    if (grounded) controls.getObject().position.y = standingHeight;
  }
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousedown', (e) => {
  if (!playing || !controls.isLocked || dead) return;
  if (e.button === 2) { aiming = true; camera.fov = 58; camera.updateProjectionMatrix(); }
  if (e.button === 0) shoot();
});
addEventListener('mouseup', (e) => { if (e.button === 2) { aiming = false; camera.fov = 75; camera.updateProjectionMatrix(); } });

function reloadWeapon() {
  if (reloading || ammo[weaponMode] === maxAmmo[weaponMode]) return;
  reloading = true; setTimeout(() => { ammo[weaponMode] = maxAmmo[weaponMode]; updateAmmo(); reloading = false; }, 900);
}
function shoot() {
  const now = performance.now();
  const cooldown = weaponMode === 1 ? 380 : 110;
  if (now - lastShot < cooldown || ammo[weaponMode] <= 0 || reloading) return;
  lastShot = now; ammo[weaponMode]--; updateAmmo();
  const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const targets = [...remotePlayers.values()].map(r => r.body);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (hit) {
    const target = [...remotePlayers.values()].find(r => r.body === hit.object);
    if (target && channel) {
      broadcast('shot', { targetId: target.id, damage: weaponMode === 1 ? 34 : 12, shooterId: playerId });
      // Aviso visual/prototipo: la lógica de daño del multijugador es cliente a cliente, no antitrampas.
      if (target.health === undefined) target.health = 100;
      target.health -= weaponMode === 1 ? 34 : 12;
      if (target.health <= 0) {
        broadcast('kill', { killerId: playerId, targetId: target.id });
        target.health = 100; target.group.position.set(0, 0, 0);
      }
    }
  }
  gunBody.position.z = -0.48; setTimeout(() => { gunBody.position.z = weaponMode === 1 ? -0.55 : -0.7; }, 70);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  if (playing && !dead && controls.isLocked) {
    const p = controls.getObject();
    const speed = (keys.ShiftLeft || keys.ShiftRight) ? 11 : (crouching ? 2.5 : 6);
    const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const right = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    if (forward || right) {
      const length = Math.hypot(forward, right) || 1;
      const f = forward / length * speed * delta;
      const r = right / length * speed * delta;
      const direction = new THREE.Vector3(); camera.getWorldDirection(direction); direction.y = 0; direction.normalize();
      const rightVec = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).negate();
      moveWithCollision(direction.x * f + rightVec.x * r, direction.z * f + rightVec.z * r);
    }
    const floorHeight = crouching ? crouchHeight : standingHeight;
    p.position.y += verticalVelocity * delta;
    verticalVelocity -= 20 * delta;
    if (p.position.y <= floorHeight) { p.position.y = floorHeight; verticalVelocity = 0; grounded = true; }
    else grounded = false;
    if (channel && performance.now() - lastStateSend > 100) {
      lastStateSend = performance.now();
      broadcast('state', { id: playerId, name: playerName, x: p.position.x, z: p.position.z, rotation: p.rotation.y, kills });
    }
  }
  // Quita jugadores que dejaron de enviar estados durante un rato.
  const now = performance.now();
  for (const [id, r] of remotePlayers) if (now - r.lastSeen > 15000) removeRemote(id);
  $('players').textContent = String(remotePlayers.size + 1);
  renderer.render(scene, camera);
}
const clock = new THREE.Clock();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
setWeapon(1); setHealth(100); upsertScore(playerId, playerName, kills); animate();
