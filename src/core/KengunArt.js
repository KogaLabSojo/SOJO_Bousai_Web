import * as THREE from 'three';
import { KENGUN } from '../content/kengun.js';
import { SIGNAL_LABELS } from './PicsBle.js';

const _v = new THREE.Vector3();

/**
 * 健軍交差点アートの立体演出。
 * - WaitPiece: 赤待ちの秒数＝作品の尺。トンネル状のリングと地域断片パネル。
 * - SyncPiece: 信号リングと市電リングの噛み合い。
 */
export class KengunArt {
  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.root.visible = false;
    stage.scene.add(this.root);

    this.wait = new WaitPiece();
    this.sync = new SyncPiece();
    this.root.add(this.wait.group, this.sync.group);

    this._signal = { state: 'Red', remaining: 20 };
    this._tramEta = 120;
    this._canCatch = null;
  }

  start() {
    this.root.visible = true;
    this.placeInFront(2.4);
    this.wait.reset();
  }

  stop() {
    this.root.visible = false;
    this.wait.reset();
  }

  dispose() {
    this.stop();
    this.root.removeFromParent();
    this.wait.dispose();
    this.sync.dispose();
  }

  /** カメラの正面に彫刻を置く */
  placeInFront(distance = 2.4) {
    const cam = this.stage.camera;
    cam.getWorldDirection(_v);
    _v.y = 0;
    if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
    _v.normalize();
    const pos = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(_v, distance);
    pos.y = Math.max(1.1, cam.position.y - 0.35);
    this.root.position.copy(pos);
    this.root.lookAt(cam.position.x, pos.y, cam.position.z);
  }

  /**
   * @param {{ state:string, remaining:number }} signal
   * @param {{ etaSec:number }|null} nextTram
   */
  update(dt, signal, nextTram) {
    if (!this.root.visible) return;
    this._signal = signal || this._signal;
    this._tramEta = nextTram?.etaSec ?? this._tramEta;

    const rem = Math.max(0, signal?.remaining ?? 0);
    const isWait = signal?.state === 'Red' || signal?.state === 'BlinkGreen';
    // 渡って電停に着くまで約25秒と仮定し、次発に間に合うか
    const walkSec = 25;
    const waitUntilGreen = signal?.state === 'Green' ? 0 : rem;
    this._canCatch = this._tramEta > waitUntilGreen + walkSec;

    // 赤のあいだ: 待ち尺でトンネルラジオ。青: 開花して収束
    this.wait.update(dt, {
      remaining: rem,
      state: signal?.state || 'Unknown',
      active: isWait || signal?.state === 'Green',
    });
    this.sync.update(dt, {
      signalRemaining: rem,
      signalState: signal?.state || 'Unknown',
      tramEta: this._tramEta,
      canCatch: this._canCatch,
    });

    // ゆっくりカメラ正面を追従（彫刻が常に眼前の空間にいる）
    this.placeInFront(2.35);
  }

  get poemLine() {
    if (this._signal.state === 'Red') return KENGUN.poem.radio;
    if (this._canCatch === true) return KENGUN.poem.catch;
    if (this._canCatch === false) return KENGUN.poem.miss;
    return KENGUN.poem.sync;
  }
}

/** 待ち時間＝尺のトンネル彫刻 */
class WaitPiece {
  constructor() {
    this.group = new THREE.Group();
    this.rings = [];
    this.panels = [];
    this._phase = 0;
    this._fragIndex = 0;
    this._fragAge = 0;

    for (let i = 0; i < 9; i++) {
      const r = 0.28 + i * 0.07;
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.9, r, 72),
        new THREE.MeshBasicMaterial({
          color: 0xff6b4a,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.position.z = -0.08 - i * 0.2;
      this.group.add(mesh);
      this.rings.push(mesh);
    }

    // トンネル軸の光筋
    this.spine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.018, 1.85, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffc46b,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.spine.rotation.x = Math.PI / 2;
    this.spine.position.z = -0.9;
    this.group.add(this.spine);

    // 手前の入口リム
    this.rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.012, 12, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffd28a,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.rim.position.z = 0.05;
    this.group.add(this.rim);

    // 地域断片パネル（キャンバステクスチャ）
    for (let i = 0; i < 3; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), mat);
      mesh.position.set((i - 1) * 0.15, 0.15, -0.4 - i * 0.35);
      this.group.add(mesh);
      this.panels.push({ mesh, canvas, tex, mat, life: 0, frag: null });
    }

    this.bloom = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0 }),
    );
    this.group.add(this.bloom);
  }

  reset() {
    this._phase = 0;
    this._fragIndex = 0;
    this._fragAge = 0;
    for (const p of this.panels) {
      p.life = 0;
      p.mat.opacity = 0;
    }
  }

  update(dt, { remaining, state, active }) {
    if (!active) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this._phase += dt;

    const waiting = state === 'Red' || state === 'BlinkGreen';
    const tPulse = 0.5 + 0.5 * Math.sin(this._phase * (waiting ? 2.2 : 5));

    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const breathe = 1 + 0.04 * Math.sin(this._phase * 1.5 + i * 0.4);
      ring.scale.setScalar(breathe);
      ring.rotation.z = this._phase * 0.15 * (i % 2 === 0 ? 1 : -1);
      const base = waiting ? 0xff6b4a : 0x3ddc84;
      ring.material.color.setHex(base);
      // 残秒が短いほど奥のリングが濃くなる
      const depthFade = remaining > 0 ? Math.min(1, remaining / 12) : 0.2;
      ring.material.opacity = (0.18 + 0.12 * tPulse) * (waiting ? depthFade + 0.35 : 0.5);
    }

    this.spine.material.opacity = waiting ? 0.35 + 0.2 * tPulse : 0.12;
    this.spine.material.color.setHex(waiting ? 0xffc46b : 0x9fd4ff);
    this.rim.material.opacity = waiting ? 0.4 + 0.25 * tPulse : 0.2;
    this.rim.material.color.setHex(waiting ? 0xffd28a : 0x7dffb0);
    this.rim.rotation.z = this._phase * 0.08;

    if (waiting) {
      this._fragAge += dt;
      // 残秒に応じた断片の切り替え速度（長い待ちほどゆっくり）
      const dwell = Math.max(3.5, Math.min(8, (remaining || 8) * 0.35));
      if (this._fragAge > dwell) {
        this._fragAge = 0;
        this._spawnFragment();
      }
      for (const p of this.panels) {
        if (p.life <= 0) {
          p.mat.opacity = 0;
          continue;
        }
        p.life -= dt;
        const u = 1 - p.life / p.maxLife;
        p.mesh.position.z = p.z0 - u * 1.2;
        p.mesh.position.y = p.y0 + Math.sin(u * Math.PI) * 0.12;
        p.mesh.rotation.y = (u - 0.5) * 0.35;
        p.mat.opacity = Math.sin(u * Math.PI) * 0.92;
      }
      this.bloom.material.opacity = 0;
    } else {
      // 青で開花
      const b = Math.min(1, this._phase * 0.8);
      this.bloom.scale.setScalar(1 + b * 6);
      this.bloom.material.opacity = Math.max(0, 0.7 - b * 0.7);
      for (const p of this.panels) p.mat.opacity *= 0.9;
    }
  }

  _spawnFragment() {
    const slot = this.panels.find((p) => p.life <= 0) || this.panels[0];
    const frag = KENGUN.radioFragments[this._fragIndex % KENGUN.radioFragments.length];
    this._fragIndex++;
    drawFragment(slot.canvas, frag);
    slot.tex.needsUpdate = true;
    slot.life = slot.maxLife = 5.5;
    slot.z0 = -0.25;
    slot.y0 = (Math.random() - 0.5) * 0.25;
    slot.mesh.position.set((Math.random() - 0.5) * 0.4, slot.y0, slot.z0);
  }

  dispose() {
    for (const r of this.rings) {
      r.geometry.dispose();
      r.material.dispose();
    }
    for (const p of this.panels) {
      p.mesh.geometry.dispose();
      p.mat.dispose();
      p.tex.dispose();
    }
    this.spine.geometry.dispose();
    this.spine.material.dispose();
    this.rim.geometry.dispose();
    this.rim.material.dispose();
    this.bloom.geometry.dispose();
    this.bloom.material.dispose();
  }
}

/** 信号×市電の二重リング */
class SyncPiece {
  constructor() {
    this.group = new THREE.Group();
    this.group.position.set(0, -0.55, -0.2);

    this.signalRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.028, 16, 64),
      new THREE.MeshBasicMaterial({ color: 0xff6b4a, transparent: true, opacity: 0.85 }),
    );
    this.tramRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.028, 16, 64),
      new THREE.MeshBasicMaterial({ color: 0x5eb0ff, transparent: true, opacity: 0.85 }),
    );
    this.tramRing.rotation.x = Math.PI / 2.6;
    this.signalRing.rotation.y = Math.PI / 5;

    this.beadS = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe0a0 }),
    );
    this.beadT = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xd4ecff }),
    );

    this.group.add(this.signalRing, this.tramRing, this.beadS, this.beadT);
    this._t = 0;
  }

  update(dt, { signalRemaining, signalState, tramEta, canCatch }) {
    this._t += dt;
    const sMax = Math.max(signalRemaining, 1);
    const tMax = Math.max(tramEta, 1);
    // ビーズがリング上を「残り時間」の割合で回る
    const aS = (signalRemaining / Math.max(sMax, 30)) * Math.PI * 2 + this._t * 0.2;
    const aT = (1 - Math.min(1, tramEta / 600)) * Math.PI * 2 + this._t * 0.12;

    this.beadS.position.set(Math.cos(aS) * 0.42, Math.sin(aS) * 0.42, 0);
    this.beadT.position.set(Math.cos(aT) * 0.42, 0, Math.sin(aT) * 0.42);

    const warm = signalState === 'Green' ? 0x3ddc84 : signalState === 'BlinkGreen' ? 0xffc46b : 0xff6b4a;
    this.signalRing.material.color.setHex(warm);

    // 噛み合う／離れる
    const mesh = canCatch ? 0.08 : 0.28;
    this.signalRing.rotation.x = THREE.MathUtils.lerp(this.signalRing.rotation.x, mesh, 0.05);
    this.tramRing.rotation.z = this._t * (canCatch ? 0.35 : 0.12);
    this.signalRing.material.opacity = canCatch ? 0.95 : 0.55;
    this.tramRing.material.opacity = canCatch ? 0.95 : 0.55;
  }

  dispose() {
    for (const o of [this.signalRing, this.tramRing, this.beadS, this.beadT]) {
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}

function drawFragment(canvas, frag) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, 'rgba(12, 18, 32, 0.92)');
  grd.addColorStop(1, 'rgba(40, 28, 20, 0.88)');
  roundRect(ctx, 8, 8, w - 16, h - 16, 28);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 180, 80, 0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#ffb020';
  ctx.font = '600 36px "Hiragino Sans", "Noto Sans JP", sans-serif';
  ctx.fillText(frag.title, 36, 64);

  ctx.fillStyle = '#f2f5fa';
  ctx.font = '28px "Hiragino Sans", "Noto Sans JP", sans-serif';
  wrapText(ctx, frag.body, 36, 110, w - 72, 38);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = ch;
      y += lineHeight;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

export { SIGNAL_LABELS };
