const errorBox = document.querySelector('#error');
const toast = document.querySelector('#toast');
const controlStatus = document.querySelector('#control-status');
const fpsLabel = document.querySelector('#fps');
let gameModuleReady = false;

// Si el navegador bloquea los módulos (por ejemplo, al abrir index.html con doble clic),
// el botón informa al usuario de cómo abrir el proyecto correctamente.
document.querySelector('#btn-start')?.addEventListener('click', () => {
  if (!gameModuleReady) {
    errorBox.hidden = false;
    errorBox.textContent = 'El juego todavía no se ha iniciado. No abras index.html con doble clic. Ejecuta INICIAR_JUEGO.bat desde esta carpeta y abre la dirección que aparece en la ventana. Si el mensaje continúa, revisa tu conexión a Internet.';
  }
});

// Importación dinámica: si falla el CDN, mostramos el error en pantalla
// e intentamos una segunda dirección en lugar de dejar la carga infinita.
loadThree()
  .then((THREE) => {
    try { startGame(THREE); } catch (err) { showError(err); }
  })
  .catch((err) => showError(err));

async function loadThree() {
  const urls = [
    'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    'https://unpkg.com/three@0.170.0/build/three.module.js'
  ];
  let lastError;
  for (const url of urls) {
    try {
      const mod = await import(url);
      return mod;
    } catch (err) {
      lastError = err;
      console.warn('No se pudo cargar Three.js desde:', url, err);
    }
  }
  throw new Error('No se pudo descargar Three.js desde ninguno de los servidores. Revisa tu conexión a Internet, VPN o bloqueo del navegador. Error: ' + (lastError?.message || lastError));
}

function showError(err) {
  console.error(err);
  errorBox.hidden = false;
  errorBox.textContent = 'No se pudo iniciar el juego. Comprueba tu conexión a Internet y abre el proyecto mediante un servidor local (consulta LEEME.txt).\\n\\nDetalle: ' + (err?.stack || err);
}

function startGame(THREE) {
  gameModuleReady = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9bc4d2);
  scene.fog = new THREE.Fog(0x9bc4d2, 75, 260);

  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'none';

  scene.add(new THREE.HemisphereLight(0xd8edff, 0x59614d, 2.0));
  const sun = new THREE.DirectionalLight(0xffe5bd, 3.2);
  sun.position.set(-45, 70, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.bias = -0.0003;
  scene.add(sun);

  const mat = (color, roughness=0.88, metalness=0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const groundMat = mat(0x657765);
  const roadMat = mat(0x292f32);
  const sidewalkMat = mat(0xa7a9a2);
  const whiteMat = mat(0xe8e5d7);
  const darkGlass = new THREE.MeshStandardMaterial({color:0x253e4a, roughness:0.3, metalness:0.2});
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(500,500), groundMat);
  grass.rotation.x = -Math.PI/2; grass.position.y = -0.12; grass.receiveShadow = true; scene.add(grass);

  function box(w,h,d,material,x,y,z,shadow=true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material);
    mesh.position.set(x,y,z); mesh.castShadow = shadow; mesh.receiveShadow = true; scene.add(mesh); return mesh;
  }
  // City blocks, wide roads and sidewalks.
  const roadWidth=13, block=34, spacing=47;
  for (let i=-4;i<=4;i++) {
    const p=i*spacing;
    const roadX = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth,430),roadMat);
    roadX.rotation.x=-Math.PI/2; roadX.position.set(p,0.005,0); scene.add(roadX);
    const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(430,roadWidth),roadMat);
    roadZ.rotation.x=-Math.PI/2; roadZ.position.set(0,0.006,p); scene.add(roadZ);
    for(let k=-4;k<=4;k++){
      const q=k*spacing;
      box(0.13,0.015,8,whiteMat,p,0.02,q+4,false);
      box(8,0.015,0.13,whiteMat,q+4,0.021,p,false);
      box(1.2,0.18,roadWidth+2,sidewalkMat,p+roadWidth/2+0.8,0.04,0,false);
      box(roadWidth+2,0.18,1.2,sidewalkMat,0,0.04,p+roadWidth/2+0.8,false);
    }
  }

  // Procedural buildings, leaving roads clear.
  const buildingMats=[0xb6b3a8,0x8c9a9c,0xc4b29b,0x687b83,0xd0c9b8,0x9eaaa2].map(c=>mat(c));
  const windowMats=[0x243c48,0x35535e,0x6f8587].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:.25,metalness:.15}));
  let seed=314159;
  function rand(){ seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }
  for(let gx=-4;gx<4;gx++) for(let gz=-4;gz<4;gz++){
    if(Math.abs(gx)<1 && Math.abs(gz)<1) continue;
    const cx=gx*spacing+spacing/2, cz=gz*spacing+spacing/2;
    for(let n=0;n<3;n++){
      const w=7+rand()*7, d=7+rand()*7, h=9+rand()*rand()*35;
      const x=cx+(rand()-.5)*15, z=cz+(rand()-.5)*15;
      const bm=buildingMats[Math.floor(rand()*buildingMats.length)];
      box(w,h,d,bm,x,h/2,z);
      // Ventanas simplificadas para que el escenario cargue rápido en PC.
      // Se usan pocas piezas por edificio en lugar de miles de objetos individuales.
      const floors=Math.min(3, Math.max(1, Math.floor(h/10)));
      const cols=Math.min(2, Math.max(1, Math.floor(w/5)));
      for(let f=1;f<floors;f++){
        for(let col=0;col<cols;col++){
          const wx=x-w/2+(col+1)*w/(cols+1);
          box(Math.min(1.15,w/(cols+1)*.55),.75,.06,
              windowMats[(col+f)%windowMats.length],wx,Math.min(h-1,f* h/floors),z+d/2+.035,false);
        }
      }
      box(w+0.25,.25,d+0.25,mat(0x555d5d),x,h+.12,z,false);
    }
  }

  // Park trees and street lamps.
  const trunkMat=mat(0x594536), leafMats=[mat(0x345b40),mat(0x426a43),mat(0x56764a)];
  function tree(x,z,s=1){
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22*s,.34*s,2.2*s,7),trunkMat);
    trunk.position.set(x,1.1*s,z); trunk.castShadow=true; scene.add(trunk);
    const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.35*s,1),leafMats[Math.floor(rand()*leafMats.length)]);
    crown.position.set(x,2.8*s,z); crown.scale.set(1,1.15,1); crown.castShadow=true; scene.add(crown);
  }
  for(let i=0;i<55;i++){
    const x=(rand()-.5)*370,z=(rand()-.5)*370;
    if(Math.abs(x%spacing)<9 || Math.abs(z%spacing)<9) continue;
    tree(x,z,.7+rand()*.65);
  }

  // Player model: simple third-person character built from meshes.
  const player=new THREE.Group(); scene.add(player);
  const skin=mat(0xd3a17b), shirt=mat(0x3f786f), pants=mat(0x28313b), shoe=mat(0x171b1d), hair=mat(0x34271f);
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.42,.68,4,8),shirt);
  torso.position.y=1.45; torso.castShadow=true; player.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.28,16,12),skin);
  head.position.y=2.18; head.castShadow=true; player.add(head);
  const hairCap=new THREE.Mesh(new THREE.SphereGeometry(.285,12,8,0,Math.PI*2,0,Math.PI*.55),hair);
  hairCap.position.y=2.24; player.add(hairCap);
  const legs=[];
  for(const side of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.16,.55,3,7),pants);
    leg.position.set(side*.2,.58,0); leg.castShadow=true; player.add(leg); legs.push(leg);
    const foot=new THREE.Mesh(new THREE.BoxGeometry(.25,.14,.4),shoe);
    foot.position.set(side*.2,.16,-.08); foot.castShadow=true; player.add(foot);
    const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.12,.52,3,7),shirt);
    arm.position.set(side*.49,1.5,0); arm.rotation.z=side*.12; arm.castShadow=true; player.add(arm);
  }
  player.position.set(0,0,4);

  // A few parked cars for scale and atmosphere.
  const carColors=[0x9d3e35,0x303b45,0xd0d0c5,0x526b84,0x77705d];
  for(let i=0;i<22;i++){
    const horizontal=rand()>.5;
    const road=Math.round((rand()*6-3))*spacing;
    const along=(rand()-.5)*300;
    const x=horizontal?along:road+(rand()>.5?4.5:-4.5);
    const z=horizontal?road+(rand()>.5?4.5:-4.5):along;
    const color=mat(carColors[Math.floor(rand()*carColors.length)],.45,.15);
    const car=new THREE.Group();
    const body=new THREE.Mesh(new THREE.BoxGeometry(2,0.7,4),color); body.position.y=.65; body.castShadow=true; car.add(body);
    const cabin=new THREE.Mesh(new THREE.BoxGeometry(1.55,.65,1.8),darkGlass); cabin.position.set(0,1.25,-.15); cabin.castShadow=true; car.add(cabin);
    for(const wx of [-.82,.82]) for(const wz of [-1.25,1.25]){
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.32,.32,.18,12),shoe);
      wheel.rotation.z=Math.PI/2; wheel.position.set(wx,.35,wz); car.add(wheel);
    }
    car.position.set(x,0,z); if(horizontal) car.rotation.y=Math.PI/2; scene.add(car);
  }

  // Third-person camera with mouse and gamepad support.
  let yaw=0, pitch=.22, distance=7, pointerLocked=false;
  const keys=new Set();
  const blocked=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space']);
  document.addEventListener('keydown',e=>{keys.add(e.code);if(blocked.has(e.code))e.preventDefault(); if(e.code==='KeyR'){player.position.set(0,0,4);player.velocity?.set(0,0,0);}});
  document.addEventListener('keyup',e=>keys.delete(e.code));
  renderer.domElement.addEventListener('click',()=>{renderer.domElement.requestPointerLock?.();});
  document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===renderer.domElement; toast.style.opacity=pointerLocked?'0':'1';});
  document.addEventListener('mousemove',e=>{if(pointerLocked){yaw-=e.movementX*.0022;pitch=Math.max(-.15,Math.min(.8,pitch+e.movementY*.0018));}});
  renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());

  let verticalVelocity=0, grounded=true, walkPhase=0, frameCount=0, lastFpsTime=performance.now();
  const clock=new THREE.Clock();
  const cameraTarget=new THREE.Vector3(), desiredCamera=new THREE.Vector3();
  const forward=new THREE.Vector3(), right=new THREE.Vector3(), move=new THREE.Vector3();
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function getGamepad(){
    const pads=navigator.getGamepads?.()||[];
    for(const p of pads) if(p && p.connected) return p;
    return null;
  }
  function axis(p,i){const v=p?.axes?.[i]||0;return Math.abs(v)<.16?0:v;}
  function update(dt){
    if (gamePaused) return;
    const pad=getGamepad();
    const kForward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
    const kRight=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
    let f=kForward, r=kRight;
    if(pad){r=axis(pad,0); f=-axis(pad,1); yaw-=axis(pad,2)*dt*2.4; pitch=clamp(pitch+axis(pad,3)*dt*1.5,-.15,.8);if((pad.buttons[0]?.pressed||pad.buttons[2]?.pressed)&&grounded){verticalVelocity=7.2;grounded=false;}}
    if(keys.has('Space')&&grounded){verticalVelocity=7.2;grounded=false;}
    move.set(0,0,0);
    forward.set(-Math.sin(yaw),0,-Math.cos(yaw));
    right.set(Math.cos(yaw),0,-Math.sin(yaw));
    move.addScaledVector(forward,f).addScaledVector(right,r);
    if(move.lengthSq()>1)move.normalize();
    const running=keys.has('ShiftLeft')||keys.has('ShiftRight')||(pad?.buttons[10]?.pressed??false);
    const speed=running?9.2:5.3;
    player.position.addScaledVector(move,speed*dt);
    player.position.x=clamp(player.position.x,-195,195);player.position.z=clamp(player.position.z,-195,195);
    if(move.lengthSq()>.001){
      player.rotation.y=Math.atan2(-move.x,-move.z);
      walkPhase+=dt*(running?12:8);
      legs[0].rotation.x=Math.sin(walkPhase)*.55;legs[1].rotation.x=-Math.sin(walkPhase)*.55;
    }else{legs[0].rotation.x*=.8;legs[1].rotation.x*=.8;}
    verticalVelocity-=19*dt;player.position.y+=verticalVelocity*dt;
    if(player.position.y<0){player.position.y=0;verticalVelocity=0;grounded=true;}
    cameraTarget.set(player.position.x,player.position.y+1.55,player.position.z);
    const horizontal=distance*Math.cos(pitch), vertical=distance*Math.sin(pitch)+2.1;
    desiredCamera.set(cameraTarget.x+Math.sin(yaw)*horizontal,cameraTarget.y+vertical,cameraTarget.z+Math.cos(yaw)*horizontal);
    camera.position.lerp(desiredCamera,1-Math.exp(-8*dt));
    camera.lookAt(cameraTarget);
    controlStatus.textContent=pad?'MANDO CONECTADO':'TECLADO';
  }
  function animate(){
    requestAnimationFrame(animate);
    const dt=Math.min(clock.getDelta(),.04);
    update(dt);renderer.render(scene,camera);
    frameCount++;
    const now=performance.now();
    if(now-lastFpsTime>700){fpsLabel.textContent=Math.round(frameCount*1000/(now-lastFpsTime))+' FPS';frameCount=0;lastFpsTime=now;}
  }
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
  addEventListener('gamepadconnected',()=>{toast.textContent='Mando conectado. Usa los sticks para moverte y mirar.';toast.style.opacity='1';setTimeout(()=>{if(!pointerLocked)toast.style.opacity='0';},3500);});
  addEventListener('gamepaddisconnected',()=>{toast.textContent='Mando desconectado';toast.style.opacity='1';});
  // No existe pantalla de carga: el menú principal permanece visible al iniciar.
  const mainMenu = document.querySelector('#main-menu');
  const hud = document.querySelector('#hud');
  const controlsPanel = document.querySelector('#controls-panel');
  const optionsPanel = document.querySelector('#options-panel');
  const qualityDescription = document.querySelector('#quality-description');
  let gamePaused = true;

  function openMenu() {
    gamePaused = true;
    if (mainMenu) mainMenu.hidden = false;
    renderer.domElement.style.display = 'none';
    if (hud) hud.classList.add('hud-hidden');
    if (controlsPanel) controlsPanel.hidden = true;
    if (optionsPanel) optionsPanel.hidden = true;
    document.exitPointerLock?.();
  }

  function startPlaying() {
    gamePaused = false;
    if (mainMenu) mainMenu.hidden = true;
    if (controlsPanel) controlsPanel.hidden = true;
    if (optionsPanel) optionsPanel.hidden = true;
    renderer.domElement.style.display = 'block';
    if (hud) hud.classList.remove('hud-hidden');
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    toast.textContent = 'Haz clic en el juego para activar la cámara';
    toast.style.opacity = '1';
  }

  document.querySelector('#btn-start')?.addEventListener('click', startPlaying);
  document.querySelector('#btn-controls')?.addEventListener('click', () => {
    if (controlsPanel) controlsPanel.hidden = false;
    if (optionsPanel) optionsPanel.hidden = true;
  });
  document.querySelector('#btn-options')?.addEventListener('click', () => {
    if (optionsPanel) optionsPanel.hidden = false;
    if (controlsPanel) controlsPanel.hidden = true;
  });
  document.querySelector('#btn-fullscreen')?.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (err) {
      toast.textContent = 'No se pudo activar pantalla completa';
      toast.style.opacity = '1';
    }
  });
  document.querySelectorAll('[data-close="controls"]').forEach(btn => btn.addEventListener('click', () => {
    if (controlsPanel) controlsPanel.hidden = true;
  }));
  document.querySelectorAll('[data-close="options"]').forEach(btn => btn.addEventListener('click', () => {
    if (optionsPanel) optionsPanel.hidden = true;
  }));
  document.querySelectorAll('[data-quality]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-quality]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const quality = btn.dataset.quality;
    if (quality === 'low') {
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = false;
      if (qualityDescription) qualityDescription.textContent = 'Rendimiento priorizado para computadoras menos potentes.';
    } else if (quality === 'high') {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      if (qualityDescription) qualityDescription.textContent = 'Mayor calidad visual; puede reducir los FPS.';
    } else {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
      renderer.shadowMap.enabled = true;
      if (qualityDescription) qualityDescription.textContent = 'Calidad equilibrada para la mayoría de computadoras.';
    }
    renderer.setSize(innerWidth, innerHeight);
  }));
  document.querySelector('#btn-pause')?.addEventListener('click', openMenu);

  // Escape muestra el menú; al volver a iniciar, se reanuda el mundo.
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && !gamePaused) {
      e.preventDefault();
      openMenu();
    }
  });

  animate();
}
