import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MAPS } from './config.js';
import { loadAssets } from './assets.js';
import { loadMap } from './maps.js';
import { Game } from './game.js';
import { LoadoutMenu } from './menu.js';
import { DeployScreen } from './deploy.js';

const app = document.getElementById('app');
const loadbar = document.querySelector('#loadbar > div');
const loadmsg = document.getElementById('loadmsg');
const loading = document.getElementById('loading');
const startScreen = document.getElementById('startScreen');
const lobby = document.getElementById('lobby');
const lbCards = document.getElementById('lbCards');
const lbStatus = document.getElementById('lbStatus');

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.classList.add('webgl');
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 550000);
scene.add(camera);

// PBR materials (character armor, weapons) need an environment map to not render black
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('error', (e) => { loadmsg.textContent = `Error: ${e.message}`; });
window.addEventListener('unhandledrejection', (e) => { loadmsg.textContent = `Rejection: ${e.reason && (e.reason.message || e.reason)}`; });

let assets = null;
let game = null;
let menu = null;
let deploy = null;
let launching = false;

async function boot() {
  try {
    loadmsg.textContent = 'Loading assets…';
    assets = await loadAssets((p, label) => {
      loadbar.style.width = `${Math.round(p * 100)}%`;
      loadmsg.textContent = `Loading ${label}…`;
    });
    loading.style.display = 'none';
    startScreen.style.display = 'block';
  } catch (err) {
    console.error(err);
    loadmsg.textContent = `Load failed: ${err.message || err}`;
  }
}

// ---- Start screen → lobby ----
document.getElementById('ssStart').onclick = () => {
  startScreen.style.display = 'none';
  buildLobby();
  lobby.style.display = 'block';
};
document.getElementById('lbBack').onclick = () => {
  if (launching) return;
  lobby.style.display = 'none';
  startScreen.style.display = 'block';
};

function buildLobby() {
  lbCards.innerHTML = '';
  lbStatus.textContent = '';
  for (const def of Object.values(MAPS)) {
    const card = document.createElement('div');
    card.className = 'lb-card';
    card.innerHTML = `
      <div class="lb-thumb"><span>${def.name.toUpperCase()}</span></div>
      <div class="lb-body">
        <div class="lb-name">${def.name.toUpperCase()} <span class="lb-tag">${def.tag}</span></div>
        <div class="lb-desc">${def.desc}</div>
        <div class="lb-progress"><div></div></div>
      </div>`;
    card.onclick = () => launchMap(def, card);
    lbCards.appendChild(card);
  }
}

async function launchMap(def, card) {
  if (launching) return;
  launching = true;
  card.classList.add('loading');
  const bar = card.querySelector('.lb-progress > div');
  try {
    let mapData = null;
    if (def.type === 'glb') {
      lbStatus.textContent = `LOADING ${def.name.toUpperCase()}…`;
      mapData = await loadMap(def, renderer, (p) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        lbStatus.textContent = `LOADING ${def.name.toUpperCase()}… ${Math.round(p * 100)}%`;
      });
    }
    bar.style.width = '100%';
    lbStatus.textContent = 'PREPARING BATTLEFIELD…';
    await new Promise((r) => setTimeout(r, 30)); // let the status paint

    game = new Game(scene, camera, assets, renderer.domElement, def, mapData);
    menu = new LoadoutMenu(game);
    deploy = new DeployScreen(game);
    game.armory = menu;
    game.deployScreen = deploy;
    menu.onDeploy = () => {
      menu.hide();
      deploy.refreshLoadout();
    };

    lobby.style.display = 'none';
    game.hud.show();
    game.hud.setMode('map');
    deploy.show('initial');
  } catch (err) {
    console.error(err);
    lbStatus.textContent = `FAILED TO LOAD: ${err.message || err}`;
    card.classList.remove('loading');
    launching = false;
  }
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (game) game.update(dt);
  if (deploy) deploy.update(dt);
  if (game) {
    if (deploy && deploy.visible) deploy.renderFrame(renderer);
    else renderer.render(scene, camera);
  }
  if (menu) menu.render(dt);
}

boot();
loop();

// Debug handle for tooling/console
window.FC = {
  get game() { return game; },
  get menu() { return menu; },
  get deploy() { return deploy; },
  launchMap: (id) => {
    if (!lbCards.children.length) buildLobby();
    const card = [...lbCards.children][Object.keys(MAPS).indexOf(id)];
    return launchMap(MAPS[id], card || lbCards.firstChild);
  },
  renderer, scene, camera,
};
