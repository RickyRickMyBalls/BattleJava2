import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadAssets } from './assets.js';
import { Game } from './game.js';
import { LoadoutMenu } from './menu.js';
import { DeployScreen } from './deploy.js';

const app = document.getElementById('app');
const loadbar = document.querySelector('#loadbar > div');
const loadmsg = document.getElementById('loadmsg');
const loading = document.getElementById('loading');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.classList.add('webgl');
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 1400);
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

let game = null;
let menu = null;
let deploy = null;

window.addEventListener('error', (e) => { loadmsg.textContent = `Error: ${e.message}`; });
window.addEventListener('unhandledrejection', (e) => { loadmsg.textContent = `Rejection: ${e.reason && (e.reason.message || e.reason)}`; });

async function boot() {
  try {
    loadmsg.textContent = 'Loading assets…';
    const assets = await loadAssets((p, label) => {
      loadbar.style.width = `${Math.round(p * 100)}%`;
      loadmsg.textContent = `Loading ${label}…`;
    });
    loadmsg.textContent = 'Battlefield ready.';
    game = new Game(scene, camera, assets, renderer.domElement);
    menu = new LoadoutMenu(game);
    deploy = new DeployScreen(game);
    game.armory = menu;
    game.deployScreen = deploy;
    menu.onDeploy = () => {
      // "APPLY" from the armory: back to the map; loadout lands on next spawn
      menu.hide();
      deploy.refreshLoadout();
    };
    loading.style.display = 'none';
    game.hud.show();
    game.hud.setMode('map');
    deploy.show('initial');
  } catch (err) {
    console.error(err);
    loadmsg.textContent = `Load failed: ${err.message || err}`;
  }
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (game) game.update(dt);
  if (deploy) deploy.update(dt);
  renderer.render(scene, deploy && deploy.visible ? deploy.camera : camera);
  if (menu) menu.render(dt);
}

boot();
loop();

// Debug handle for tooling/console
window.FC = { get game() { return game; }, get menu() { return menu; }, get deploy() { return deploy; }, renderer, scene, camera };
