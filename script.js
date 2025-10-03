// Mini Voxel World — browser edition
// Simple, original Minecraft-like experience (not using any copyrighted assets)

// ---------- Settings ----------
const WORLD_SIZE = 32;           // width/depth grid
const WORLD_HEIGHT = 12;        // vertical build height
const BLOCK_SIZE = 1;           // world units per block
const AUTO_SAVE_KEY = "mini_voxel_save_v1";

// ---------- Simple state ----------
const state = {
  blocks: {},                   // key "x,y,z" -> blockType
  player: { x: WORLD_SIZE/2, y: WORLD_HEIGHT+2, z: WORLD_SIZE/2, velocityY:0, onGround:false },
  clickPower: 1,
  autoClickers: 0,
  selectedBlock: 1,             // index in BLOCK_TYPES
  rebirths: 0
};

// ---------- Block palette ----------
const BLOCK_TYPES = [
  { id:0, name:"Air", color:0x000000, solid:false },
  { id:1, name:"Grass", color:0x5caf5c, solid:true },
  { id:2, name:"Dirt", color:0x7b5a3c, solid:true },
  { id:3, name:"Stone", color:0x888888, solid:true },
  { id:4, name:"Sand", color:0xeadfa8, solid:true },
  { id:5, name:"Wood", color:0x8b5a2b, solid:true }
];

// ---------- THREE.js setup ----------
let scene, camera, renderer, controls, raycaster;
let blockGroup;

init();
animate();

function init(){
  // renderer & scene
  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setPixelRatio(window.devicePixelRatio); renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x87CEEB); // sky blue
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  // camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(state.player.x, state.player.y, state.player.z);

  // lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(100,200,100); scene.add(dir);

  // groups
  blockGroup = new THREE.Group(); scene.add(blockGroup);

  // raycaster for placing/removing
  raycaster = new THREE.Raycaster();

  // controls: pointer lock
  controls = new THREE.PointerLockControls(camera, document.body);
  const instructions = document.getElementById('instructions');
  instructions.addEventListener('click', ()=> controls.lock() );
  controls.addEventListener('lock', ()=> instructions.style.display='none');
  controls.addEventListener('unlock', ()=> instructions.style.display='block');

  // WASD movement
  setupMovement();

  // HUD hotbar
  setupHotbar();

  // build a flat terrain
  if(!loadFromStorage()) generateTerrain();

  // events
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('contextmenu', e=> e.preventDefault()); // block context menu

  document.getElementById('saveBtn').addEventListener('click', saveToStorage);
  document.getElementById('loadBtn').addEventListener('click', ()=>{loadFromStorage(); renderWorld();});
  document.getElementById('resetBtn').addEventListener('click', resetWorld);

  // keyboard for hotbar quick select
  window.addEventListener('keydown', e=>{
    if(e.key>='1' && e.key<=String(BLOCK_TYPES.length-1)){
      const idx = Number(e.key);
      setSelected(idx);
    }
  });

  // crosshair
  const ch = document.createElement('div'); ch.className='crosshair'; document.body.appendChild(ch);

  // initial render world
  renderWorld();

  // start autosave
  setInterval(saveToStorage, 5000);
  // auto clicker: if any, tick fast
  setInterval(()=> {
    if(state.autoClickers>0){
      // auto mining/building could be implemented; simple: give clicks
      state.player_collected = (state.player_collected||0) + state.autoClickers;
      updateInfo();
    }
  }, 100); // 100ms for autos (cheap)
}

// ---------- terrain & world helpers ----------
function keyFrom(x,y,z){ return `${x},${y},${z}`; }
function setBlock(x,y,z,type,skipRender=false){
  if(x<0||x>=WORLD_SIZE||z<0||z>=WORLD_SIZE||y<0||y>WORLD_HEIGHT) return;
  const k = keyFrom(x,y,z);
  if(type===0) delete state.blocks[k];
  else state.blocks[k]=type;
  if(!skipRender) renderWorld();
}
function getBlock(x,y,z){ const t = state.blocks[keyFrom(x,y,z)]; return t===undefined?0:t; }

function generateTerrain(){
  state.blocks = {};
  for(let x=0;x<WORLD_SIZE;x++){
    for(let z=0;z<WORLD_SIZE;z++){
      const height = 2 + Math.floor(2*Math.sin(x/4)+2*Math.cos(z/4));
      for(let y=0;y<=height;y++){
        const type = (y===height)?1:2; // grass top, dirt below
        setBlock(x,y,z,type,true);
      }
      // small stone patch
      if(Math.random()>0.92){
        setBlock(x, Math.floor(Math.random()*4)+3, z, 3, true);
      }
    }
  }
}

// ---------- render the blocks (brute force for simplicity) ----------
const cubeGeo = new THREE.BoxGeometry(BLOCK_SIZE,BLOCK_SIZE,BLOCK_SIZE);
function renderWorld(){
  // clear group
  while(blockGroup.children.length) blockGroup.remove(blockGroup.children[0]);

  // for each block, create mesh
  const keys = Object.keys(state.blocks);
  keys.forEach(k=>{
    const [x,y,z] = k.split(',').map(Number);
    const type = state.blocks[k];
    const color = BLOCK_TYPES[type].color || 0xffffff;
    const mat = new THREE.MeshLambertMaterial({ color });
    const m = new THREE.Mesh(cubeGeo, mat);
    m.position.set((x - WORLD_SIZE/2)*BLOCK_SIZE + BLOCK_SIZE/2, y*BLOCK_SIZE + BLOCK_SIZE/2, (z - WORLD_SIZE/2)*BLOCK_SIZE + BLOCK_SIZE/2);
    m.userData = { x,y,z, type };
    blockGroup.add(m);
  });
  updateInfo();
}

// ---------- pointer interactions (place/remove) ----------
function onPointerDown(e){
  if(!controls.isLocked) return;
  // compute normalized device coords
  const rect = renderer.domElement.getBoundingClientRect();
  const mx = ( (window.innerWidth/2) / rect.width ) * 2 - 1;
  const my = - ( (window.innerHeight/2) / rect.height ) * 2 + 1;
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const intersects = raycaster.intersectObjects(blockGroup.children);
  if(intersects.length){
    const hit = intersects[0];
    const { x,y,z } = hit.object.userData;
    if(e.button===0){
      // left click -> remove block
      setBlock(x,y,z,0);
    } else if(e.button===2){
      // right click -> place block adjacent (face normal)
      const normal = hit.face.normal;
      const placeX = x + normal.x;
      const placeY = y + normal.y;
      const placeZ = z + normal.z;
      setBlock(placeX, placeY, placeZ, state.selectedBlock);
    }
  } else {
    // if empty, on right click we can place at a ray point near camera
    if(e.button===2){
      // cast to ground plane y=0
      const planeY = 0;
      const origin = camera.position.clone();
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
      const t = (planeY - origin.y) / dir.y;
      if(t>0 && t<20){
        const pt = origin.add(dir.multiplyScalar(t));
        // convert to grid
        const gx = Math.floor((pt.x + (WORLD_SIZE/2)*BLOCK_SIZE) / BLOCK_SIZE);
        const gz = Math.floor((pt.z + (WORLD_SIZE/2)*BLOCK_SIZE) / BLOCK_SIZE);
        setBlock(gx, 1, gz, state.selectedBlock);
      }
    }
  }
}

// ---------- basic movement ----------
let move = { forward:false, back:false, left:false, right:false, jump:false };
function setupMovement(){
  const velocity = new THREE.Vector3();
  const speed = 6;
  const gravity = -30;
  const jumpSpeed = 10;

  const onKey = (e, down) => {
    if(e.code==='KeyW') move.forward = down;
    if(e.code==='KeyS') move.back = down;
    if(e.code==='KeyA') move.left = down;
    if(e.code==='KeyD') move.right = down;
    if(e.code==='Space') { if(down && state.player.onGround) { state.player.velocityY = jumpSpeed; state.player.onGround = false; } }
  };
  window.addEventListener('keydown', e=> onKey(e, true));
  window.addEventListener('keyup', e=> onKey(e, false));

  // main update loop handles physics in animate()
  state._velocity = velocity;
}

// ---------- animation loop ----------
let lastTime = performance.now();
function animate(){
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime)/1000);
  lastTime = now;

  // movement physics
  const dir = new THREE.Vector3();
  if(move.forward) dir.z -= 1;
  if(move.back) dir.z += 1;
  if(move.left) dir.x -= 1;
  if(move.right) dir.x += 1;
  dir.normalize();

  const speed = 6;
  const forward = new THREE.Vector3();
  controls.getDirection(forward); // camera forward
  const right = new THREE.Vector3().crossVectors(camera.up, forward).normalize();

  const moveVec = new THREE.Vector3();
  moveVec.copy(forward).multiplyScalar(-dir.z).add(right.multiplyScalar(dir.x));
  moveVec.y = 0;
  moveVec.normalize();

  // apply horizontal
  camera.position.add( moveVec.multiplyScalar(speed*dt) );

  // gravity
  state.player.velocityY += -30 * dt;
  camera.position.y += state.player.velocityY * dt;

  // ground collision
  if(camera.position.y <= 2){
    camera.position.y = 2; state.player.velocityY = 0; state.player.onGround = true;
  }

  // keep camera pos in state
  state.player.x = (camera.position.x + (WORLD_SIZE/2)*BLOCK_SIZE)/BLOCK_SIZE;
  state.player.y = camera.position.y / BLOCK_SIZE;
  state.player.z = (camera.position.z + (WORLD_SIZE/2)*BLOCK_SIZE)/BLOCK_SIZE;

  renderer.render(scene, camera);
}

// ---------- HUD / Hotbar ----------
function setupHotbar(){
  const hotbar = document.getElementById('hotbar');
  for(let i=1;i<BLOCK_TYPES.length;i++){
    const slot = document.createElement('div');
    slot.className='hot-slot';
    slot.dataset.block = i;
    slot.innerHTML = BLOCK_TYPES[i].name;
    slot.onclick = ()=> setSelected(Number(slot.dataset.block));
    hotbar.appendChild(slot);
  }
  setSelected(state.selectedBlock);
  updateInfo();
}

function setSelected(idx){
  state.selectedBlock = idx;
  const slots = document.querySelectorAll('.hot-slot');
  slots.forEach(s=>{
    s.classList.toggle('active', Number(s.dataset.block)===idx);
  });
}

// ---------- info update ----------
function updateInfo(){
  document.getElementById('blockCount').textContent = Object.keys(state.blocks).length;
}

// ---------- save/load/reset ----------
function saveToStorage(){
  try{
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(state));
    console.log('Saved');
  }catch(e){ console.warn('Save failed', e); }
}

function loadFromStorage(){
  try{
    const raw = localStorage.getItem(AUTO_SAVE_KEY);
    if(!raw) return false;
    const s = JSON.parse(raw);
    // basic merge
    Object.assign(state, s);
    // ensure keys/arrays valid
    if(!state.blocks) state.blocks = {};
    if(!state.upgrades) state.upgrades = Array(100).fill(0);
    // reposition camera
    camera.position.set(state.player.x, Math.max(2,state.player.y), state.player.z);
    recalcWorldAfterLoad();
    return true;
  }catch(e){ console.warn('Load failed', e); return false; }
}

function recalcWorldAfterLoad(){ renderWorld(); updateInfo(); setSelected(state.selectedBlock); }

function resetWorld(){
  if(!confirm('Reset world?')) return;
  state.blocks = {};
  state.selectedBlock = 1;
  state.autoClickers = 0;
  state.clickPower = 1;
  state.rebirths = 0;
  generateTerrain();
  saveToStorage();
  renderWorld();
}

// ---------- utility on resize ----------
function onWindowResize(){
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
