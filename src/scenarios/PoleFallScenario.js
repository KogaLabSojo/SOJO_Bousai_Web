import * as THREE from 'three';
import { Scenario } from './Scenario.js';
import { loadGLTF } from '../core/assets.js';

const G = 9.81;
const SPACING = 7;
const SHAKE_TIME = 2.5;
// Unity: PoleFallController.fallDelay
const FALL_DELAY = 0.5;
const WIRE_SEGMENTS = 24;

export class PoleFallScenario extends Scenario {
  static id = 'pole';
  static title = '電柱の倒壊';
  static placeDistance = 6.5;

  async load() {
    const gltf = await loadGLTF('models/pole.glb');
    const src = gltf.scene;
    src.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });

    const bbox = new THREE.Box3().setFromObject(src);
    this.poleHeight = bbox.max.y - bbox.min.y;
    const attach = this._findCrossarmEnds(src, bbox);

    this.shaker = new THREE.Group();
    this.root.add(this.shaker);

    // 倒れる順番: 中央 → 左右
    const xs = [-SPACING, 0, SPACING];
    const order = [1, 0, 2];
    this.poles = xs.map((x, i) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, 0);
      const model = src.clone(true);
      pivot.add(model);
      this.shaker.add(pivot);
      return {
        pivot,
        model,
        twistSign: i % 2 === 0 ? 1 : -1,
        delay: order.indexOf(i) * FALL_DELAY,
        theta: 0,
        omega: 0,
        falling: false,
        landed: false,
        side: (Math.random() - 0.5) * 0.25,
      };
    });

    // 電線: 腕金の両端どうしを結ぶ。両端は画面外の電柱へ伸びている想定で固定点にする
    this.attachLocal = attach;
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x111111 });
    this.wires = [];
    const spans = [
      [null, 0],
      [0, 1],
      [1, 2],
      [2, null],
    ];
    for (const [a, b] of spans) {
      for (const p of attach) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((WIRE_SEGMENTS + 1) * 3), 3));
        const line = new THREE.Line(geo, this.wireMat);
        line.frustumCulled = false;
        this.shaker.add(line);
        const wire = { line, a, b, local: p, restLength: 0 };
        this.wires.push(wire);
      }
    }

    this.dust = this._createDust();
    this.root.add(this.dust.points);

    this.reset();
    for (const w of this.wires) {
      const [pa, pb] = this._wireEnds(w);
      const d = pa.distanceTo(pb);
      w.restLength = d + (8 * 0.35 * 0.35) / (3 * d);
    }
  }

  /** 腕金（横木）の両端付近の頂点から、電線の取り付け位置を求める */
  _findCrossarmEnds(src, bbox) {
    const halfW = Math.max(-bbox.min.z, bbox.max.z);
    const pts = { neg: [], pos: [] };
    const v = new THREE.Vector3();
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.z < -halfW * 0.85) pts.neg.push(v.y);
        else if (v.z > halfW * 0.85) pts.pos.push(v.y);
      }
    });
    const avg = (a, fallback) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : fallback);
    const top = this.poleHeight - 0.4;
    const yNeg = avg(pts.neg, top);
    const yPos = avg(pts.pos, top);
    return [
      new THREE.Vector3(0, yNeg, -halfW * 0.85),
      new THREE.Vector3(0, yPos, halfW * 0.85),
      new THREE.Vector3(0, (yNeg + yPos) / 2 - 0.6, -halfW * 0.4),
      new THREE.Vector3(0, (yNeg + yPos) / 2 - 0.6, halfW * 0.4),
    ];
  }

  get hint() {
    if (this.state === 'idle') return '「地震発生」で揺れが始まります。電柱の高さ（約8m）と自分の位置関係に注目。';
    if (this.state === 'done') return '倒れた電柱の先端がどこまで届いたか確認してみましょう。';
    return '揺れています…！';
  }

  get actions() {
    return this.state === 'idle' ? [{ id: 'quake', label: '地震発生', primary: true }] : [];
  }

  onAction(id) {
    if (id === 'quake' && this.state === 'idle') {
      this.state = 'shaking';
      this.elapsed = 0;
      this.ctx.audio.rumble(SHAKE_TIME + 4, 1);
      navigator.vibrate?.([500, 100, 800]);
      this.ctx.ui.refresh();
    }
  }

  reset() {
    this.state = 'idle';
    this.elapsed = 0;
    this.shaker.position.set(0, 0, 0);
    for (const p of this.poles) {
      p.theta = 0;
      p.omega = 0;
      p.falling = false;
      p.landed = false;
      p.pivot.rotation.set(0, 0, 0);
      p.model.rotation.set(0, 0, 0);
    }
    this.dust.reset();
    this.ctx.quake = 0;
  }

  update(dt) {
    this.elapsed += dt;
    const t = this.elapsed;

    if (this.state === 'shaking' || this.state === 'falling') {
      const amp = this.state === 'shaking' ? Math.min(1, t / 1.0) : Math.max(0, 1 - t / 3);
      this.ctx.quake = amp;
      this.shaker.position.x = Math.sin(t * 2 * Math.PI * 1.9) * 0.06 * amp;
      this.shaker.position.z = Math.sin(t * 2 * Math.PI * 1.3 + 0.7) * 0.04 * amp;
    }

    if (this.state === 'shaking') {
      for (const p of this.poles) {
        p.pivot.rotation.x = Math.sin(t * 2 * Math.PI * 1.9 + p.delay) * 0.02 * Math.min(1, t);
      }
      if (t >= SHAKE_TIME) {
        this.state = 'falling';
        this.elapsed = 0;
        this.ctx.audio.crack(1);
      }
    } else if (this.state === 'falling') {
      let allLanded = true;
      for (const p of this.poles) {
        if (!p.falling && t >= p.delay) {
          p.falling = true;
          p.theta = p.pivot.rotation.x;
          p.omega = 0.3;
          this.ctx.audio.crack(0.8);
        }
        if (p.falling && !p.landed) this._stepPole(p, dt);
        if (!p.landed) allLanded = false;
      }
      if (allLanded && t > 3.5) {
        this.state = 'done';
        this.ctx.quake = 0;
        this.shaker.position.set(0, 0, 0);
        this.ctx.ui.refresh();
      }
    }

    this._updateWires();
    this.dust.update(dt);
  }

  _stepPole(p, dt) {
    // 根元を支点に倒れる棒: θ'' = (3g / 2L) sinθ
    const rest = Math.PI / 2 - 0.03;
    const sub = 4;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      p.omega += ((3 * G) / (2 * this.poleHeight)) * Math.sin(p.theta) * h;
      p.theta += p.omega * h;
      if (p.theta >= rest) {
        p.theta = rest;
        if (Math.abs(p.omega) > 0.6) {
          const strength = Math.min(1, p.omega / 3);
          this.ctx.audio.impact(1.2 * strength + 0.3, 0.6);
          this.ctx.quake = Math.max(this.ctx.quake, 1);
          navigator.vibrate?.(250);
          this._spawnDust(p);
          p.omega = -p.omega * 0.18;
        } else {
          p.omega = 0;
          p.landed = true;
        }
      }
    }
    p.pivot.rotation.set(p.theta, 0, p.side * Math.min(1, p.theta));
    // 腕金が地面に刺さらないよう、倒れながら軸回りにねじれて横向きで着地する
    const k = THREE.MathUtils.smoothstep(p.theta / rest, 0.2, 0.9);
    p.model.rotation.y = k * (Math.PI / 2) * p.twistSign;
  }

  _wireEnds(w) {
    const end = (index, sign) => {
      if (index === null) {
        const x = sign * SPACING * 1.6;
        return new THREE.Vector3(x, w.local.y, w.local.z);
      }
      const { pivot, model } = this.poles[index];
      return w.local.clone().applyEuler(model.rotation).applyEuler(pivot.rotation).add(pivot.position);
    };
    return [end(w.a, -1), end(w.b, 1)];
  }

  _updateWires() {
    const tmp = new THREE.Vector3();
    for (const w of this.wires) {
      const [pa, pb] = this._wireEnds(w);
      const d = pa.distanceTo(pb);
      // 放物線近似: 弦長 d と線長 S から垂れ下がり量を求める
      const slack = Math.max(0, w.restLength - d);
      const sag = Math.sqrt((3 * d * slack) / 8);
      const pos = w.line.geometry.attributes.position;
      for (let i = 0; i <= WIRE_SEGMENTS; i++) {
        const s = i / WIRE_SEGMENTS;
        tmp.lerpVectors(pa, pb, s);
        tmp.y -= 4 * sag * s * (1 - s);
        tmp.y = Math.max(0.02, tmp.y);
        pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
      }
      pos.needsUpdate = true;
    }
  }

  _createDust() {
    const COUNT = 400;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const velocities = new Float32Array(COUNT * 3);
    const life = new Float32Array(COUNT);
    const mat = new THREE.PointsMaterial({
      color: 0xb8a990,
      size: 0.25,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    let cursor = 0;
    return {
      points,
      spawn: (origin, dir, length) => {
        for (let i = 0; i < 130; i++) {
          const k = cursor++ % COUNT;
          const s = Math.random() * length;
          positions[k * 3] = origin.x + dir.x * s + (Math.random() - 0.5) * 0.4;
          positions[k * 3 + 1] = 0.05;
          positions[k * 3 + 2] = origin.z + dir.z * s + (Math.random() - 0.5) * 0.4;
          velocities[k * 3] = (Math.random() - 0.5) * 1.2;
          velocities[k * 3 + 1] = Math.random() * 0.8 + 0.2;
          velocities[k * 3 + 2] = (Math.random() - 0.5) * 1.2;
          life[k] = 1.5 + Math.random();
        }
      },
      update: (dt) => {
        let alive = 0;
        for (let k = 0; k < COUNT; k++) {
          if (life[k] <= 0) {
            positions[k * 3 + 1] = -100;
            continue;
          }
          alive++;
          life[k] -= dt;
          positions[k * 3] += velocities[k * 3] * dt;
          positions[k * 3 + 1] += velocities[k * 3 + 1] * dt;
          positions[k * 3 + 2] += velocities[k * 3 + 2] * dt;
          velocities[k * 3] *= 0.97;
          velocities[k * 3 + 1] *= 0.95;
          velocities[k * 3 + 2] *= 0.97;
        }
        mat.opacity = alive ? 0.5 : 0;
        geo.attributes.position.needsUpdate = true;
      },
      reset: () => {
        life.fill(0);
      },
    };
  }

  _spawnDust(p) {
    const origin = p.pivot.position.clone().add(this.shaker.position);
    const dir = new THREE.Vector3(0, 0, 1);
    this.dust.spawn(origin, dir, this.poleHeight);
  }

  status(info) {
    // 倒れた後も含め、電柱本体（根元〜先端の線分）までの水平距離
    const c = new THREE.Vector2(info.cameraLocal.x, info.cameraLocal.z);
    const a = new THREE.Vector2();
    const ab = new THREE.Vector2();
    const tip = new THREE.Vector3();
    let nearest = Infinity;
    for (const p of this.poles) {
      tip.set(0, this.poleHeight, 0).applyEuler(p.pivot.rotation).add(p.pivot.position);
      a.set(p.pivot.position.x, p.pivot.position.z);
      ab.set(tip.x - a.x, tip.z - a.y);
      const len2 = ab.lengthSq();
      const t = len2 > 1e-6 ? THREE.MathUtils.clamp(c.clone().sub(a).dot(ab) / len2, 0, 1) : 0;
      nearest = Math.min(nearest, c.distanceTo(a.clone().addScaledVector(ab, t)));
    }
    const danger = nearest < this.poleHeight;
    const cls = danger ? 'danger' : 'safe';
    const msg = danger ? '危険範囲：電柱の高さより近い' : '電柱の高さ以上離れている';
    return `最も近い電柱まで: <b>${nearest.toFixed(1)} m</b>（高さ 約${this.poleHeight.toFixed(0)} m）\n<span class="${cls}">${msg}</span>`;
  }
}
