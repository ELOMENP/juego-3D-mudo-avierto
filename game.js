
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
import { PointerLockControls } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/PointerLockControls.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 50, 220);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.object);
controls.object.position.set(0, 1.7, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(30, 60, 20);
scene.add(sun);

// Suelo y ciudad
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.MeshStandardMaterial({ color: 0x477447 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

for (let i = -100; i <= 100; i += 25) {
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 220),
    new THREE.MeshStandardMaterial({ color: 0x34383d })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(i, 0.02, 0);
  scene.add(road);

  const crossRoad = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 12),
    new THREE.MeshStandardMaterial({ color: 0x34383d })
  );
  crossRoad.rotation.x = -Math.PI / 2;
  crossRoad.position.set(0, 0.03, i);
  scene.add(crossRoad);
}

for (let x = -90; x <= 90; x += 25) {
  for (let z = -90; z <= 90; z += 25) {
    if (Math.abs(x) < 18 || Math.abs(z) < 18) continue;

    const h = 5 + Math.random() * 18;
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(10, h, 10),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.58, 0.13, 0.36 + Math.random() * 0.2)
      })
    );
    building.position.set(x, h / 2, z);
    scene.add(building);
  }
}

// Armas y manos en primera persona
const weaponGroup = new THREE.Group();
camera.add(weaponGroup);
weaponGroup.position.set(0.35, -0.3, -0.65);

const metal = new THREE.MeshStandardMaterial({
  color: 0x30343b,
  metalness: 0.7,
  roughness: 0.3
});
const dark = new THREE.MeshStandardMaterial({ color: 0x17191c });
const skin = new THREE.MeshStandardMaterial({ color: 0xc58c66 });

function makeBox(parent, material, size, position) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    material
  );
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function makeCylinder(parent, material, radiusTop, radiusBottom, length, position, rotation) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 12),
    material
  );
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

// Dos manos visibles sujetando el arma
const leftHand = makeBox(weaponGroup, skin, [0.12, 0.12, 0.22], [-0.16, -0.10, -0.12]);
leftHand.rotation.x = -0.2;

const rightHand = makeBox(weaponGroup, skin, [0.13, 0.13, 0.20], [0.04, -0.10, 0.04]);
rightHand.rotation.x = -0.2;

// Pistola
const pistol = new THREE.Group();
weaponGroup.add(pistol);
makeBox(pistol, metal, [0.12, 0.12, 0.32], [0, 0, -0.12]);
makeBox(pistol, dark, [0.09, 0.19, 0.10], [0, -0.13, -0.01]);
makeCylinder(pistol, dark, 0.035, 0.035, 0.22, [0, 0.01, -0.37], [Math.PI / 2, 0, 0]);
makeBox(pistol, metal, [0.07, 0.025, 0.08], [0, 0.08, -0.14]);

// Rifle
const rifle = new THREE.Group();
weaponGroup.add(rifle);
makeBox(rifle, metal, [0.14, 0.15, 0.48], [0, 0, -0.12]);
makeBox(rifle, dark, [0.11, 0.22, 0.13], [0, -0.17, -0.02]);
makeBox(rifle, dark, [0.08, 0.18, 0.09], [0, -0.10, 0.13]);
makeCylinder(rifle, metal, 0.025, 0.025, 0.48, [0, 0.02, -0.55], [Math.PI / 2, 0, 0]);
makeBox(rifle, dark, [0.05, 0.12, 0.08], [0, 0.12, -0.12]);

let currentWeapon = 1;
rifle.visible = false;

// Controles y estado
const keys = {};
let playing = false;
let grounded = true;
let verticalVelocity = 0;
let health = 100;
let ammo = 12;
let aiming = false;
let lastShot = 0;

const playerHeight = 1.7;
const raycaster = new THREE.Raycaster();
raycaster.far = 150;

const menu = document.getElementById("menu");
const hud = document.getElementById("hud");
const statusText = document.getElementById("status");

function updateHUD() {
  document.getElementById("health").textContent = `Vida: ${health}`;
  document.getElementById("weapon").textContent =
    `Arma: ${currentWeapon === 1 ? "Pistola" : "Rifle"}`;
  document.getElementById("ammo").textContent = `Munición: ${ammo}`;
}

document.getElementById("joinBtn").addEventListener("click", () => {
  const name = document.getElementById("playerName").value.trim();
  const room = document.getElementById("roomCode").value.trim();

  if (!name || !room) {
    statusText.textContent = "Escribe tu nombre y el código de sala.";
    return;
  }

  playing = true;
  menu.style.display = "none";
  hud.style.display = "block";
  updateHUD();
  controls.lock();
});

document.getElementById("releaseBtn").addEventListener("click", () => controls.unlock());

document.getElementById("leaveBtn").addEventListener("click", () => {
  playing = false;
  controls.unlock();
  hud.style.display = "none";
  menu.style.display = "flex";
  statusText.textContent = "Saliste de la ciudad.";
});

controls.addEventListener("unlock", () => {
  if (playing) statusText.textContent = "Ratón liberado. Haz clic en el juego para volver.";
});

controls.addEventListener("lock", () => {
  if (playing) statusText.textContent = "Jugando";
});

// Liberar ratón con º
document.addEventListener("keydown", (event) => {
  if (
    event.key === "º" ||
    event.key === "ª" ||
    event.code === "Backquote"
  ) {
    controls.unlock();
    return;
  }

  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
  }

  keys[event.code] = true;
  if (!playing) return;

  if (event.code === "Space" && grounded) {
    verticalVelocity = 8;
    grounded = false;
  }

  if (event.code === "Digit1") {
    currentWeapon = 1;
    pistol.visible = true;
    rifle.visible = false;
    ammo = 12;
    updateHUD();
  }

  if (event.code === "Digit2") {
    currentWeapon = 2;
    pistol.visible = false;
    rifle.visible = true;
    ammo = 30;
    updateHUD();
  }

  if (event.code === "KeyR") {
    ammo = currentWeapon === 1 ? 12 : 30;
    updateHUD();
  }
});

document.addEventListener("keyup", (event) => {
  keys[event.code] = false;
});

// Apuntar con botón derecho
document.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("mousedown", (event) => {
  if (!playing || !controls.isLocked) return;

  if (event.button === 2) {
    aiming = true;
    camera.fov = 48;
    camera.updateProjectionMatrix();
    weaponGroup.position.set(0.15, -0.22, -0.48);
    return;
  }

  if (event.button !== 0) return;

  const now = performance.now();
  const cooldown = currentWeapon === 1 ? 300 : 100;
  if (now - lastShot < cooldown) return;
  lastShot = now;

  if (ammo <= 0) return;

  ammo--;
  updateHUD();
  shootStraight();
});

document.addEventListener("mouseup", (event) => {
  if (event.button === 2) {
    aiming = false;
    camera.fov = 75;
    camera.updateProjectionMatrix();
    weaponGroup.position.set(0.35, -0.3, -0.65);
  }
});

// Disparo recto hacia el centro de la pantalla
function shootStraight() {
  camera.updateMatrixWorld(true);

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, direction);

  // Comprueba impactos contra edificios y suelo.
  const targets = scene.children.filter((obj) =>
    obj.isMesh && obj !== ground &&
    obj.parent !== weaponGroup &&
    !obj.userData.isTracer
  );

  const hits = raycaster.intersectObjects(targets, false);
  const end = hits.length
    ? hits[0].point.clone()
    : origin.clone().add(direction.multiplyScalar(100));

  // Efecto visual de la bala en línea recta
  const points = [origin.clone(), end.clone()];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: 0xffe38a });
  const tracer = new THREE.Line(geometry, material);
  tracer.userData.isTracer = true;
  scene.add(tracer);

  setTimeout(() => {
    scene.remove(tracer);
    geometry.dispose();
    material.dispose();
  }, 70);

  // Pequeño retroceso del arma
  weaponGroup.position.z += 0.045;
  setTimeout(() => {
    weaponGroup.position.z = aiming ? -0.48 : -0.65;
  }, 70);
});

// Movimiento y salto
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (playing && controls.isLocked) {
    const speed = keys["ShiftLeft"] || keys["ShiftRight"] ? 12 : 6;

    if (keys["KeyW"]) controls.moveForward(speed * delta);
    if (keys["KeyS"]) controls.moveForward(-speed * delta);
    if (keys["KeyA"]) controls.moveRight(-speed * delta);
    if (keys["KeyD"]) controls.moveRight(speed * delta);

    verticalVelocity -= 20 * delta;
    controls.object.position.y += verticalVelocity * delta;

    if (controls.object.position.y <= playerHeight) {
      controls.object.position.y = playerHeight;
      verticalVelocity = 0;
      grounded = true;
    }
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
