import './style.css';
import * as THREE from 'three';
import { Stage } from './core/Stage.js';
import { XRController } from './core/XRController.js';
import { FallbackController } from './core/FallbackController.js';
import { SlamController } from './core/SlamController.js';
import { PeopleOcclusion } from './core/PeopleOcclusion.js';
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
  loading: $('#loading'),
  toast: $('#toast'),
  underwater: $('#underwater'),
};

const stage = new Stage($('#scene'));
const audio = new AudioFX();
const xr = new XRController(stage, $('#overlay'));
const fallback = new FallbackController(stage, $('#camera-feed'));
const slam = new SlamController(stage, $('#slam-feed'));
const occlusion = new PeopleOcclusion(stage);

// ?ar=8thwall で Android でも 8th Wall を、?ar=gyro で簡易モードを強制できる
const forcedMode = new URLSearchParams(location.search).get('ar');

let xrSupported = false;
let slamCandidate = false;
let mode = null; // 'xr' | 'slam' | 'fallback'
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
    setUnderwater: (on) => el.underwater.classList.toggle('on', on),
    toast,
  },
};

if (import.meta.env.DEV) {
  window.__debug = { stage, THREE, fallback, slam, occlusion, get scenario() { return scenario; } };
}

// ---------- 起動 ----------
const detectPromise = (async () => {
  xrSupported = forcedMode ? false : await XRController.isSupported();
  if (xrSupported) {
    el.badge.textContent = 'WebXR AR 対応：床を検出して歩き回れます';
    el.badge.classList.add('xr');
    return;
  }
  slamCandidate = forcedMode !== 'gyro' && (forcedMode === '8thwall' || SlamController.isCandidate());
  if (slamCandidate) {
    el.badge.textContent = '6DoF AR を準備中…';
    slamCandidate = await SlamController.preload();
  }
  if (slamCandidate) {
    el.badge.textContent = '6DoF AR 対応：歩き回って体験できます';
    el.badge.classList.add('xr');
  } else {
    el.badge.textContent = '簡易ARモード：カメラ映像＋ジャイロで体験します';
  }
})();

document.querySelectorAll('[data-scenario]').forEach((btn) => {
  btn.addEventListener('click', () => startScenario(btn.dataset.scenario));
});
$('#btn-back').addEventListener('click', () => exitScenario());
// DOM オーバーレイ上のボタン操作が AR の「タップ（select）」として扱われないようにする
for (const node of [el.hud.querySelector('.hud-top'), el.hud.querySelector('.hud-bottom')]) {
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
  try {
    if (xrSupported) {
      mode = 'xr';
      await xr.start();
    } else {
      const granted = await FallbackController.requestOrientationPermission();
      setLoading(true);
      await detectPromise;
      mode = 'fallback';
      if (slamCandidate && granted) {
        try {
          await slam.start();
          mode = 'slam';
        } catch (err) {
          console.error(err);
          toast('6DoF AR を開始できませんでした。\n簡易モードで体験します。');
        }
      }
      if (mode === 'fallback') {
        if (!granted) toast('ジャイロが許可されませんでした。\nドラッグで見回せます。');
        await fallback.start();
        if (!fallback.hasCamera) toast('カメラを使用できません。\n3D表示のみで体験します。');
      }
    }
  } catch (err) {
    console.error(err);
    if (mode === 'xr') {
      mode = 'fallback';
      await fallback.start();
    }
  }
  ctx.mode = mode;
  occlusion.setSource(occlusionSource());

  el.menu.hidden = true;
  el.hud.hidden = false;
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
  occlusion.setSource(null);

  if (mode === 'xr') await xr.stop();
  else if (mode === 'slam') slam.stop();
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

function occlusionSource() {
  if (mode === 'xr') {
    const features = stage.renderer.xr.getSession()?.enabledFeatures;
    return features?.includes('camera-access') ? { kind: 'xr' } : null;
  }
  if (mode === 'slam') return { kind: 'canvas', el: $('#slam-feed') };
  if (mode === 'fallback' && fallback.hasCamera) return { kind: 'video', el: $('#camera-feed') };
  return null;
}

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
canvas.addEventListener('pointerdown', () => mode && mode !== 'xr' && placed && scenario?.onPressStart());
window.addEventListener('pointerup', () => mode && mode !== 'xr' && scenario?.onPressEnd());
window.addEventListener('pointercancel', () => scenario?.onPressEnd());

function replace() {
  scenario.reset();
  if (mode === 'xr') {
    placed = false;
    xr.searching = true;
    stage.anchor.visible = false;
  } else {
    stage.placeInFrontOfCamera(scenario.constructor.placeDistance);
  }
  renderHud();
}

// ---------- HUD ----------
function renderHud() {
  if (!scenario) return;
  el.hint.innerHTML = placed
    ? scenario.hint
    : mode === 'slam'
      ? 'スマホをゆっくり左右に動かして、周りの空間を認識させてください'
      : scenario.constructor.placeHint;
  el.actions.innerHTML = '';

  const buttons = placed
    ? [
        ...scenario.actions,
        { id: '__replace', label: mode === 'xr' ? '置き直す' : '正面に置き直す' },
        { id: '__reset', label: 'リセット' },
        ...(occlusion.source
          ? [{ id: '__occlusion', label: `人物の遮蔽: ${occlusion.enabled ? 'ON' : 'OFF'}`, active: occlusion.enabled }]
          : []),
      ]
    : [];
  for (const a of buttons) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.primary) b.classList.add('primary');
    if (a.active) b.classList.add('active');
    b.addEventListener('click', () => {
      audio.unlock();
      if (a.id === '__occlusion') {
        occlusion.enabled = !occlusion.enabled;
        renderHud();
      } else if (a.id === '__replace') replace();
      else if (a.id === '__reset') {
        scenario.reset();
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
  } else if (mode === 'slam') {
    slam.shake = ctx.quake;
    slam.update();
    // トラッキングが安定してから（または一定時間後に）正面に置く
    if (scenario && !placed && pendingPlaceSince && (slam.tracking || now - pendingPlaceSince > 2500)) {
      stage.placeInFrontOfCamera(scenario.constructor.placeDistance);
      pendingPlaceSince = 0;
      placed = true;
      renderHud();
    }
  } else {
    fallback.shake = ctx.quake;
    fallback.update(dt);
    // ジャイロの初回値が来てから正面に置く
    if (scenario && !placed && pendingPlaceSince && (fallback.orientation || now - pendingPlaceSince > 800)) {
      stage.placeInFrontOfCamera(scenario.constructor.placeDistance);
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
      eyeHeight: mode === 'fallback' ? fallback.eyeHeight : Math.max(0.5, cameraLocal.y),
    };
    scenario.update(dt, info);
    if (now - lastStatus > 200) {
      el.status.innerHTML = scenario.status(info);
      lastStatus = now;
    }
  }

  occlusion.update(now, frame);
  stage.renderer.render(stage.scene, stage.camera);
});
