import './style.css';
import * as THREE from 'three';
import { Stage } from './core/Stage.js';
import { XRController } from './core/XRController.js';
import { FallbackController } from './core/FallbackController.js';
import { AudioFX } from './core/AudioFX.js';
import { BlockWallScenario } from './scenarios/BlockWallScenario.js';
import { FloodScenario } from './scenarios/FloodScenario.js';
import { RoadCollapseScenario } from './scenarios/RoadCollapseScenario.js';
import { PoleFallScenario } from './scenarios/PoleFallScenario.js';

const SCENARIOS = {
  block: BlockWallScenario,
  flood: FloodScenario,
  road: RoadCollapseScenario,
  pole: PoleFallScenario,
};

const $ = (sel) => document.querySelector(sel);
const el = {
  menu: $('#menu'),
  hud: $('#hud'),
  badge: $('#mode-badge'),
  title: $('#hud-title'),
  status: $('#hud-status'),
  hint: $('#hud-hint'),
  actions: $('#hud-actions'),
  slider: $('#hud-slider'),
  tip: $('#tip'),
  tipBody: $('#tip .tip-body'),
  loading: $('#loading'),
  toast: $('#toast'),
  underwater: $('#underwater'),
};

const stage = new Stage($('#scene'));
const audio = new AudioFX();
const xr = new XRController(stage, $('#overlay'));
const fallback = new FallbackController(stage, $('#camera-feed'));

let xrSupported = false;
let mode = null; // 'xr' | 'fallback'
let scenario = null;
let placed = false;
let busy = false;
let exiting = false;
let pendingPlaceSince = 0;

const ctx = {
  stage,
  audio,
  mode: null,
  quake: 0,
  getEyeHeight: () => fallback.eyeHeight,
  setEyeHeight: (v) => (fallback.eyeHeight = v),
  ui: {
    refresh: renderHud,
    showTips,
    setUnderwater: (on) => el.underwater.classList.toggle('on', on),
    toast,
  },
};

if (import.meta.env.DEV) {
  window.__debug = { stage, THREE, fallback, get scenario() { return scenario; } };
}

// ---------- 起動 ----------
(async () => {
  xrSupported = await XRController.isSupported();
  if (xrSupported) {
    el.badge.textContent = 'WebXR AR 対応：床を検出して歩き回れます';
    el.badge.classList.add('xr');
  } else {
    el.badge.textContent = '簡易ARモード：カメラ映像＋ジャイロで体験します';
  }
})();

document.querySelectorAll('[data-scenario]').forEach((btn) => {
  btn.addEventListener('click', () => startScenario(btn.dataset.scenario));
});
$('#btn-back').addEventListener('click', () => exitScenario());
$('#tip-close').addEventListener('click', () => (el.tip.hidden = true));

// DOM オーバーレイ上のボタン操作が AR の「タップ（select）」として扱われないようにする
for (const node of [el.hud.querySelector('.hud-top'), el.hud.querySelector('.hud-bottom'), el.tip]) {
  node.addEventListener('beforexrselect', (e) => e.preventDefault());
}

el.slider.querySelector('input').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  scenario?.onSlider(v);
  const s = scenario?.slider;
  if (s) el.slider.querySelector('output').textContent = s.format ? s.format(v) : v;
});

// ---------- シナリオ開始・終了 ----------
async function startScenario(id) {
  if (busy) return;
  busy = true;
  audio.unlock();
  const Cls = SCENARIOS[id];

  // 権限要求は user gesture 内で最初に行う必要がある
  mode = xrSupported ? 'xr' : 'fallback';
  try {
    if (mode === 'xr') {
      await xr.start();
    } else {
      const granted = await FallbackController.requestOrientationPermission();
      if (!granted) toast('ジャイロが許可されませんでした。\nドラッグで見回せます。');
      await fallback.start();
      if (!fallback.hasCamera) toast('カメラを使用できません。\n3D表示のみで体験します。');
    }
  } catch (err) {
    console.error(err);
    if (mode === 'xr') {
      mode = 'fallback';
      await fallback.start();
    }
  }
  ctx.mode = mode;

  el.menu.hidden = true;
  el.hud.hidden = false;
  el.tip.hidden = true;
  el.title.textContent = Cls.title;
  el.status.innerHTML = '';
  setLoading(true);

  try {
    scenario = new Cls(ctx);
    await scenario.load();
  } catch (err) {
    console.error(err);
    setLoading(false);
    toast('読み込みに失敗しました');
    busy = false;
    await exitScenario();
    return;
  }
  stage.anchor.add(scenario.root);
  setLoading(false);

  placed = false;
  if (mode === 'xr') {
    xr.searching = true;
    stage.anchor.visible = false;
  } else {
    pendingPlaceSince = performance.now();
  }
  renderHud();
  busy = false;
}

async function exitScenario() {
  if (exiting) return;
  exiting = true;
  scenario?.dispose();
  scenario = null;
  placed = false;
  ctx.quake = 0;
  audio.stopAll();
  el.underwater.classList.remove('on');

  if (mode === 'xr') await xr.stop();
  else if (mode === 'fallback') fallback.stop();
  mode = null;
  ctx.mode = null;

  stage.anchor.visible = true;
  stage.anchor.position.set(0, 0, 0);
  stage.anchor.rotation.set(0, 0, 0);
  el.hud.hidden = true;
  el.menu.hidden = false;
  exiting = false;
}

xr.onEnd = () => {
  if (mode === 'xr') exitScenario();
};

// ---------- 配置 ----------
function placeHere() {
  const Cls = scenario.constructor;
  const cam = stage.camera.getWorldPosition(new THREE.Vector3());
  const floorY = xr.hitPosition.y;
  // 体験者の正面（レティクルの方向）に、シナリオごとの安全な距離をとって置く
  const dir = new THREE.Vector3(xr.hitPosition.x - cam.x, 0, xr.hitPosition.z - cam.z);
  if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
  dir.normalize();
  const feet = new THREE.Vector3(cam.x, floorY, cam.z);
  const pos = feet.clone().addScaledVector(dir, Cls.placeDistance);
  const face = Cls.placeDistance > 0.01 ? feet : feet.clone().sub(dir);
  stage.placeAnchor(pos, face);
  stage.anchor.visible = true;
  xr.searching = false;
  placed = true;
  renderHud();
}

xr.onSelect = () => {
  if (scenario && !placed && xr.hasHit) placeHere();
};
xr.onSelectStart = () => placed && scenario?.onPressStart();
xr.onSelectEnd = () => placed && scenario?.onPressEnd();

const canvas = stage.renderer.domElement;
canvas.addEventListener('pointerdown', () => mode === 'fallback' && placed && scenario?.onPressStart());
window.addEventListener('pointerup', () => mode === 'fallback' && scenario?.onPressEnd());
window.addEventListener('pointercancel', () => scenario?.onPressEnd());

function replace() {
  scenario.reset();
  el.tip.hidden = true;
  if (mode === 'xr') {
    placed = false;
    xr.searching = true;
    stage.anchor.visible = false;
  } else {
    fallback.placeInFront(scenario.constructor.placeDistance);
  }
  renderHud();
}

// ---------- HUD ----------
function renderHud() {
  if (!scenario) return;
  el.hint.innerHTML = placed ? scenario.hint : scenario.constructor.placeHint;
  el.actions.innerHTML = '';

  const buttons = placed
    ? [
        ...scenario.actions,
        { id: '__replace', label: mode === 'xr' ? '置き直す' : '正面に置き直す' },
        { id: '__reset', label: 'リセット' },
      ]
    : [];
  for (const a of buttons) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.primary) b.classList.add('primary');
    if (a.active) b.classList.add('active');
    b.addEventListener('click', () => {
      audio.unlock();
      if (a.id === '__replace') replace();
      else if (a.id === '__reset') {
        scenario.reset();
        el.tip.hidden = true;
        renderHud();
      } else scenario.onAction(a.id);
    });
    el.actions.appendChild(b);
  }

  const s = placed ? scenario.slider : null;
  el.slider.hidden = !s;
  if (s) {
    const input = el.slider.querySelector('input');
    el.slider.querySelector('.slider-label').textContent = s.label;
    Object.assign(input, { min: s.min, max: s.max, step: s.step, value: s.value });
    el.slider.querySelector('output').textContent = s.format ? s.format(s.value) : s.value;
  }
}

function showTips() {
  if (!scenario) return;
  el.tipBody.innerHTML = `<ul>${scenario.tips.map((t) => `<li>${t}</li>`).join('')}</ul>`;
  el.tip.hidden = false;
}

function setLoading(on) {
  el.loading.hidden = !on;
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

// ---------- ループ ----------
let last = performance.now();
let lastStatus = 0;
const camWorld = new THREE.Vector3();

stage.renderer.setAnimationLoop((_time, frame) => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!mode) return;

  if (mode === 'xr') {
    xr.update(frame);
  } else {
    fallback.shake = ctx.quake;
    fallback.update(dt);
    // ジャイロの初回値が来てから正面に置く
    if (scenario && !placed && pendingPlaceSince && (fallback.orientation || now - pendingPlaceSince > 800)) {
      fallback.placeInFront(scenario.constructor.placeDistance);
      pendingPlaceSince = 0;
      placed = true;
      renderHud();
    }
  }

  if (scenario && placed) {
    stage.camera.getWorldPosition(camWorld);
    const cameraLocal = scenario.root.worldToLocal(camWorld.clone());
    const info = {
      cameraLocal,
      eyeHeight: mode === 'xr' ? Math.max(0.5, cameraLocal.y) : fallback.eyeHeight,
    };
    scenario.update(dt, info);
    if (now - lastStatus > 200) {
      el.status.innerHTML = scenario.status(info);
      lastStatus = now;
    }
  }

  stage.renderer.render(stage.scene, stage.camera);
});
