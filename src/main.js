import './style.css';
import * as THREE from 'three';
import { Stage } from './core/Stage.js';
import { XRController } from './core/XRController.js';
import { FallbackController } from './core/FallbackController.js';
import { SlamController } from './core/SlamController.js';
import { PeopleOcclusion } from './core/PeopleOcclusion.js';
import { getCurrentPosition, lookupInundation } from './core/HazardMap.js';
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
  adjust: $('#hud-adjust'),
  loading: $('#loading'),
  toast: $('#toast'),
  underwater: $('#underwater'),
  warehouseHud: $('#warehouse-hud'),
  warehouseScan: $('#warehouse-scan'),
  warehousePanel: $('#warehouse-panel'),
  warehouseHint: $('#warehouse-hint'),
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
let mode = null; // 'xr' | 'slam' | 'fallback' | 'warehouse'
let scenario = null;
let placed = false;
let busy = false;
let exiting = false;
let pendingPlaceSince = 0;
let warehouseScan = null;

const ctx = {
  stage,
  audio,
  mode: null,
  quake: 0,
  hazard: null,
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
$('#btn-hazard').addEventListener('click', () => checkHazard());
$('#btn-warehouse').addEventListener('click', () => startWarehouse());
$('#btn-warehouse-back').addEventListener('click', () => exitWarehouse());
$('#btn-warehouse-close').addEventListener('click', () => warehouseScan?.closePanel());

async function startWarehouse() {
  if (busy) return;
  busy = true;
  audio.unlock();
  el.menu.hidden = true;
  el.hud.hidden = true;
  el.warehouseHud.hidden = false;
  document.body.classList.add('warehouse-on');
  mode = 'warehouse';
  ctx.mode = mode;
  setLoading(true);
  try {
    const { WarehouseScan, WAREHOUSE } = await import('./core/WarehouseScan.js');
    $('#warehouse-panel-title').textContent = WAREHOUSE.title;
    $('#warehouse-panel-place').textContent = WAREHOUSE.place;
    $('#warehouse-panel-body').innerHTML =
      WAREHOUSE.introHtml +
      '<hr>' +
      `<h3>収納品一覧（${WAREHOUSE.place}）</h3>` +
      WAREHOUSE.inventoryHtml;
    warehouseScan ??= new WarehouseScan({
      container: el.warehouseScan,
      panel: el.warehousePanel,
      hint: el.warehouseHint,
    });
    await warehouseScan.start();
  } catch (err) {
    console.error(err);
    toast('カメラを開始できませんでした。\nHTTPS とカメラ権限を確認してください。');
    await exitWarehouse();
    busy = false;
    return;
  } finally {
    setLoading(false);
  }
  busy = false;
}

async function exitWarehouse() {
  warehouseScan?.stop();
  document.body.classList.remove('warehouse-on');
  el.warehouseHud.hidden = true;
  el.menu.hidden = false;
  mode = null;
  ctx.mode = null;
}

// 配置の微調整（実際の壁や道路の向きに合わせる）
const NUDGE = { 'rot-l': [Math.PI / 24, 0], 'rot-r': [-Math.PI / 24, 0], near: [0, -0.25], far: [0, 0.25] };
el.adjust.querySelectorAll('[data-nudge]').forEach((b) => {
  b.addEventListener('click', () => {
    const [yaw, forward] = NUDGE[b.dataset.nudge];
    stage.nudgeAnchor(yaw, forward);
  });
});

// ---------- ハザードマップ ----------
async function checkHazard() {
  const btn = $('#btn-hazard');
  const out = $('#hazard-result');
  btn.disabled = true;
  out.hidden = false;
  out.textContent = '現在地を取得しています…';
  try {
    const { lat, lon } = await getCurrentPosition();
    out.textContent = 'ハザードマップを確認しています…';
    const hazard = await lookupInundation(lat, lon);
    ctx.hazard = hazard;
    const lines = hazard.results.map((r) => `${r.label}：${r.rank ? `<b>${r.rank.label}</b>` : '想定区域外'}`);
    out.innerHTML = hazard.worst
      ? `この場所の想定最大浸水深<br>${lines.join('　')}<br>「洪水・浸水」で <b>${hazard.worst.rank.label}</b> の水位を体験できます。`
      : `この場所は洪水・高潮・津波の浸水想定区域外です。<br><small>想定外の浸水が起きないわけではありません。</small>`;
    out.innerHTML += '<br><small>出典：ハザードマップポータルサイト（国土地理院）</small>';
  } catch (err) {
    console.warn(err);
    ctx.hazard = null;
    out.textContent = err?.code === 1
      ? '位置情報が許可されませんでした。'
      : 'ハザードマップを取得できませんでした。時間をおいて試してください。';
  } finally {
    btn.disabled = false;
  }
}
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
  const source = cameraSource();
  occlusion.setSource(source);
  stage.env.setSource(source);

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
  if (mode === 'fallback') {
    pendingPlaceSince = performance.now();
  } else {
    xr.searching = true;
    stage.anchor.visible = false;
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
  setUiHidden(false);
  ctx.quake = 0;
  audio.stopAll();
  el.underwater.classList.remove('on');
  occlusion.setSource(null);
  stage.env.setSource(null);

  if (mode === 'xr') await xr.stop();
  else if (mode === 'slam') slam.stop();
  else if (mode === 'fallback') fallback.stop();
  mode = null;
  ctx.mode = null;

  stage.anchor.visible = true;
  stage.anchor.position.set(0, 0, 0);
  stage.anchor.rotation.set(0, 0, 0);
  stage.reticle.visible = false;
  el.hud.hidden = true;
  el.menu.hidden = false;
  exiting = false;
}

xr.onEnd = () => {
  if (mode === 'xr') exitScenario();
};

/** オクルージョンと IBL に使うカメラ映像 */
function cameraSource() {
  if (mode === 'xr') {
    const features = stage.renderer.xr.getSession()?.enabledFeatures;
    return features?.includes('camera-access') ? { kind: 'xr' } : null;
  }
  if (mode === 'slam') return { kind: 'canvas', el: $('#slam-feed') };
  if (mode === 'fallback' && fallback.hasCamera) return { kind: 'video', el: $('#camera-feed') };
  return null;
}

// ---------- 配置 ----------
/**
 * リングの位置に置く。
 * 床：体験者からリングの方向へ、シナリオごとの安全な距離をとって置く
 * 壁：壁に沿わせて置く（placeOnWall のシナリオのみ）
 */
function placeAt(hit, { kind = 'floor', normal = null, floorY = hit.y } = {}) {
  const Cls = scenario.constructor;
  const cam = stage.camera.getWorldPosition(new THREE.Vector3());

  if (kind === 'wall' && Cls.placeOnWall) {
    const n = new THREE.Vector3(normal.x, 0, normal.z).normalize();
    if (n.dot(new THREE.Vector3(cam.x - hit.x, 0, cam.z - hit.z)) < 0) n.negate();
    const pos = new THREE.Vector3(hit.x, floorY, hit.z).addScaledVector(n, Cls.wallOffset);
    stage.placeAnchor(pos, pos.clone().add(n));
  } else if (kind === 'floor') {
    const dir = new THREE.Vector3(hit.x - cam.x, 0, hit.z - cam.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const feet = new THREE.Vector3(cam.x, hit.y, cam.z);
    const pos = feet.clone().addScaledVector(dir, Cls.placeDistance);
    const face = Cls.placeDistance > 0.01 ? feet : feet.clone().sub(dir);
    stage.placeAnchor(pos, face);
  } else {
    toast(Cls.placeOnWall ? '床か壁にリングを合わせてください' : '床にリングを合わせてタップしてください');
    return;
  }
  stage.anchor.visible = true;
  stage.reticle.visible = false;
  xr.searching = false;
  placed = true;
  renderHud();
}

xr.onSelect = () => {
  if (!scenario || placed || !xr.hasHit) return;
  placeAt(xr.hitPosition, { kind: xr.hitKind, normal: xr.hitNormal, floorY: xr.floorHeight });
};
xr.onSelectStart = () => {
  beginTap(null);
  if (placed) scenario?.onPressStart();
};
xr.onSelectEnd = () => {
  if (placed) scenario?.onPressEnd();
  endTap(null);
};

// ---------- 画面タップで UI の表示・非表示 ----------
// 配置後の短いタップだけを切り替えに使う（長押し・ドラッグ・配置のタップは除く）
const TAP_MS = 300;
const TAP_MOVE = 12;
let tap = null;
let uiHintShown = false;

function beginTap(e) {
  tap = placed ? { t: performance.now(), x: e?.clientX ?? 0, y: e?.clientY ?? 0 } : null;
}

function endTap(e) {
  if (!tap || !scenario || !placed) return;
  const moved = e ? Math.hypot(e.clientX - tap.x, e.clientY - tap.y) : 0;
  if (performance.now() - tap.t < TAP_MS && moved < TAP_MOVE) setUiHidden(!el.hud.classList.contains('ui-hidden'));
  tap = null;
}

function setUiHidden(hidden) {
  el.hud.classList.toggle('ui-hidden', hidden);
  if (hidden && !uiHintShown) {
    uiHintShown = true;
    toast('もう一度タップすると表示します');
  }
}

// 8th Wall では床が y = 0 なので、画面中央からの光線と床の交点にリングを出す
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const centerRay = new THREE.Raycaster();
const slamHit = new THREE.Vector3();
const reticleMatrix = new THREE.Matrix4();
let slamHasHit = false;

function updateSlamReticle() {
  centerRay.setFromCamera({ x: 0, y: 0 }, stage.camera);
  slamHasHit =
    !!centerRay.ray.intersectPlane(groundPlane, slamHit) && slamHit.distanceTo(centerRay.ray.origin) < 15;
  if (slamHasHit) stage.setReticle(reticleMatrix.makeTranslation(slamHit.x, 0.002, slamHit.z));
  stage.reticle.visible = !placed && slamHasHit && !!slam.reality;
}

const canvas = stage.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (!scenario || !mode || mode === 'xr') return;
  beginTap(e);
  if (placed) scenario.onPressStart();
  else if (mode === 'slam' && slamHasHit) placeAt(slamHit.clone());
});
window.addEventListener('pointerup', (e) => {
  if (!mode || mode === 'xr') return;
  scenario?.onPressEnd();
  endTap(e);
});
window.addEventListener('pointercancel', () => scenario?.onPressEnd());

function replace() {
  scenario.reset();
  if (mode === 'fallback') {
    stage.placeInFrontOfCamera(scenario.constructor.placeDistance);
  } else {
    placed = false;
    xr.searching = true;
    stage.anchor.visible = false;
    setUiHidden(false);
  }
  renderHud();
}

// ---------- HUD ----------
function renderHud() {
  if (!scenario) return;
  el.hint.innerHTML = placed
    ? scenario.hint
    : mode === 'slam'
      ? 'スマホをゆっくり左右に動かしてから、床に映るリングをタップして配置します。'
      : scenario.constructor.placeHint;
  el.adjust.hidden = !placed;
  el.actions.innerHTML = '';

  const buttons = placed
    ? [
        ...scenario.actions,
        { id: '__replace', label: mode === 'fallback' ? '正面に置き直す' : '置き直す' },
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
  if (!mode || mode === 'warehouse') return;

  if (mode === 'xr') {
    xr.update(frame);
  } else if (mode === 'slam') {
    slam.shake = ctx.quake;
    slam.update();
    if (scenario) updateSlamReticle();
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

  stage.env.update(now, frame);
  occlusion.update(now, frame);
  stage.renderer.render(stage.scene, stage.camera);
});
