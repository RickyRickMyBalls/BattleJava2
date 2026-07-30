import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MAPS } from './config.js';
import { loadAssets } from './assets.js';
import { loadMap } from './maps.js';
import { Game } from './game.js';
import { LoadoutMenu } from './menu.js';
import { DeployScreen } from './deploy.js';
import { Lobby, TeamSelect } from './lobby.js';

const app = document.getElementById('app');
const loadbar = document.querySelector('#loadbar > div');
const loadmsg = document.getElementById('loadmsg');
const loading = document.getElementById('loading');
const startScreen = document.getElementById('startScreen');

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.shadowMap.enabled = true; // only lights with castShadow pay for it (lobby spotlight)
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.classList.add('webgl');
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 550000);
scene.add(camera);

// PBR materials (character armor, weapons) need an environment map to not render black
const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTexture;
scene.environmentIntensity = 0.55;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('error', (e) => { loadmsg.textContent = `Error: ${e.message}`; });
window.addEventListener('unhandledrejection', (e) => { loadmsg.textContent = `Rejection: ${e.reason && (e.reason.message || e.reason)}`; });

// The session outlives screens: it owns the loadout (customized in the lobby,
// carried into the game) and the shared menu-open flag.
const session = {
  assets: null,
  playerLoadout: { cls: 'assault', primary: 'ar', secondary: 'smg' },
  gameType: 'conquest',
  mapId: 'demo',
  menuOpen: false,
  deployScreen: null,
  armory: null,
  lobby: null,
};

let game = null;
let menu = null;
let deploy = null;
let lobby = null;
let teamSelect = null;
let launching = false;

async function boot() {
  try {
    loadmsg.textContent = 'Loading assets…';
    session.assets = await loadAssets((p, label) => {
      loadbar.style.width = `${Math.round(p * 100)}%`;
      loadmsg.textContent = `Loading ${label}…`;
    });

    menu = new LoadoutMenu(session);
    session.armory = menu;
    lobby = new Lobby(session, renderer, envTexture, startGame);
    session.lobby = lobby;
    teamSelect = new TeamSelect();
    menu.onDeploy = () => {
      menu.hide();
      if (deploy) deploy.refreshLoadout();
    };

    // Compile/upload for the two surfaces the player reaches before a match
    // exists. Their scenes (and, for the armory, its whole second GL context)
    // are not covered by the match-time prewarm, so without this the lobby's
    // first frame and the armory's first frame each stall visibly.
    loadmsg.textContent = 'Warming up…';
    await lobby.prewarm();
    await menu.prewarm();

    loading.style.display = 'none';
    startScreen.style.display = 'block';
  } catch (err) {
    console.error(err);
    loadmsg.textContent = `Load failed: ${err.message || err}`;
  }
}

// ---- Title → lobby ----
document.getElementById('ssStart').onclick = () => {
  startScreen.style.display = 'none';
  lobby.show();
};
document.getElementById('lbBack').onclick = () => {
  if (launching) return;
  lobby.hide();
  startScreen.style.display = 'block';
};

// ---- START GAME: load map, build sim, pick team, deploy ----
async function startGame() {
  if (launching) return;
  launching = true;
  lobby.setLaunching(true);
  const def = MAPS[session.mapId];
  try {
    let mapData = null;
    if (def.type === 'glb') {
      lobby.setStatus(`LOADING ${def.name.toUpperCase()}…`);
      mapData = await loadMap(def, renderer, (p) => {
        lobby.setStatus(`LOADING ${def.name.toUpperCase()}… ${Math.round(p * 100)}%`, p);
      });
    }
    lobby.setStatus('PREPARING BATTLEFIELD…');
    await new Promise((r) => setTimeout(r, 30)); // let the status paint

    game = new Game(scene, camera, session.assets, renderer.domElement, def, mapData, session);
    deploy = new DeployScreen(game);
    game.armory = menu;
    game.deployScreen = deploy;
    session.deployScreen = deploy;
    // Last, deliberately: the deploy screen touches the scene, and three keys
    // its program cache on light counts, so warming before it means warming a
    // cache the first real frame throws away.
    await game.prewarm(renderer);

    // Keep the character preview running behind the team select
    lobby.hidePanels();
    teamSelect.show((team) => {
      if (team === 1) game.setPlayerTeam(1);
      lobby.hide();
      game.hud.show();
      game.hud.setMode('map');
      deploy.show('initial');
    });
  } catch (err) {
    console.error(err);
    lobby.setStatus(`FAILED TO LOAD: ${err.message || err}`);
    lobby.setLaunching(false);
    launching = false;
  }
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (game) game.update(dt);
  if (deploy) deploy.update(dt);
  if (lobby && lobby.active) {
    lobby.update(dt); // renders the character preview
  } else if (game) {
    if (deploy && deploy.visible) deploy.renderFrame(renderer);
    else {
      game.renderScopes(renderer); // scope screens: off-screen pass, must precede the main one
      renderer.render(scene, camera);
    }
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
  get lobby() { return lobby; },
  get session() { return session; },
  launchMap: async (id) => {
    session.mapId = id;
    if (startScreen.style.display !== 'none') { startScreen.style.display = 'none'; lobby.show(); }
    await startGame();
    // auto-pick UNSC so scripted tests land on the deploy screen like before
    if (teamSelect.el.style.display !== 'none') teamSelect._pick(0);
    return true;
  },
  renderer, scene, camera,
};
