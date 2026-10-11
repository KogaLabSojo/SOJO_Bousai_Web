import * as THREE from 'three';

const _v = new THREE.Vector2();

/**
 * 柔らかい丸の粒子（粉じん・水しぶき・火花）。CPU で動かして Points で描く。
 * 粒子ごとに寿命に応じて大きさ・不透明度が変わる。
 */
export class Particles {
  constructor({
    count = 400,
    color = 0xffffff,
    additive = false,
    gravity = 0,
    drag = 1.5,
    sizeStart = 0.1,
    sizeEnd = 0.3,
    opacity = 0.6,
    floorY = -Infinity,
  } = {}) {
    this.count = count;
    this.gravity = gravity;
    this.drag = drag;
    this.sizeStart = sizeStart;
    this.sizeEnd = sizeEnd;
    this.floorY = floorY;
    this.cursor = 0;

    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.scale = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.col = new Float32Array(count * 3);
    this.baseColor = new THREE.Color(color);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, uOpacity: { value: opacity } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        uniform float uScale;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.05, -mv.z);
          vAlpha = aAlpha;
          vColor = aColor;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    // 画面の高さに合わせて点の大きさ（ワールド単位）を画素に換算する
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(_v);
      this.material.uniforms.uScale.value = _v.y * 0.5 * camera.projectionMatrix.elements[5];
    };
    this.reset();
  }

  /** p: { x, y, z, vx, vy, vz, life, scale?, color? } */
  emit(p) {
    const k = this.cursor++ % this.count;
    const i = k * 3;
    this.pos[i] = p.x;
    this.pos[i + 1] = p.y;
    this.pos[i + 2] = p.z;
    this.vel[i] = p.vx ?? 0;
    this.vel[i + 1] = p.vy ?? 0;
    this.vel[i + 2] = p.vz ?? 0;
    this.life[k] = this.maxLife[k] = p.life ?? 1;
    this.scale[k] = p.scale ?? 1;
    const c = p.color ?? this.baseColor;
    this.col[i] = c.r;
    this.col[i + 1] = c.g;
    this.col[i + 2] = c.b;
  }

  update(dt) {
    const damp = Math.exp(-this.drag * dt);
    for (let k = 0; k < this.count; k++) {
      const i = k * 3;
      if (this.life[k] <= 0) {
        this.alpha[k] = 0;
        this.size[k] = 0;
        continue;
      }
      this.life[k] -= dt;
      this.vel[i + 1] -= this.gravity * dt;
      this.vel[i] *= damp;
      this.vel[i + 1] *= damp;
      this.vel[i + 2] *= damp;
      this.pos[i] += this.vel[i] * dt;
      this.pos[i + 1] += this.vel[i + 1] * dt;
      this.pos[i + 2] += this.vel[i + 2] * dt;
      if (this.pos[i + 1] < this.floorY) {
        this.pos[i + 1] = this.floorY;
        this.vel[i + 1] *= -0.2;
      }
      const t = 1 - Math.max(0, this.life[k]) / this.maxLife[k];
      this.size[k] = (this.sizeStart + (this.sizeEnd - this.sizeStart) * Math.sqrt(t)) * this.scale[k];
      // ふわっと出て、ゆっくり消える
      this.alpha[k] = Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    const a = this.geometry.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = true;
  }

  reset() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * 小さな破片（コンクリート片・アスファルト片）。InstancedMesh で重力・跳ね返り・回転を計算する。
 * holes: 床が無い円形の範囲 [{ x, z, r }]（陥没穴など）。そこでは床で止まらず落ちていく。
 */
export class Chips {
  constructor({ count = 120, color = 0x8a8a86, size = 0.05, roughness = 0.9 } = {}) {
    this.count = count;
    this.cursor = 0;
    this.holes = [];
    const geo = new THREE.DodecahedronGeometry(size, 0);
    const mat = new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.items = Array.from({ length: count }, () => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      rot: new THREE.Euler(),
      spin: new THREE.Vector3(),
      scale: 1,
      life: 0,
    }));
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this.reset();
  }

  emit(x, y, z, vx, vy, vz, scale = 1, life = 4) {
    const it = this.items[this.cursor++ % this.count];
    it.pos.set(x, y, z);
    it.vel.set(vx, vy, vz);
    it.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    it.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    it.scale = scale * (0.5 + Math.random());
    it.life = life;
  }

  update(dt) {
    for (let k = 0; k < this.count; k++) {
      const it = this.items[k];
      if (it.life > 0) {
        it.life -= dt;
        it.vel.y -= 9.81 * dt;
        it.pos.addScaledVector(it.vel, dt);
        const overHole = this.holes.some((h) => (it.pos.x - h.x) ** 2 + (it.pos.z - h.z) ** 2 < h.r * h.r);
        const floor = overHole ? -3 : it.scale * 0.03;
        if (it.pos.y < floor) {
          it.pos.y = floor;
          if (it.vel.y < -0.5) {
            it.vel.y *= -0.3;
            it.vel.x *= 0.6;
            it.vel.z *= 0.6;
            it.spin.multiplyScalar(0.5);
          } else {
            it.vel.set(0, 0, 0);
            it.spin.set(0, 0, 0);
          }
        }
        it.rot.x += it.spin.x * dt;
        it.rot.y += it.spin.y * dt;
        it.rot.z += it.spin.z * dt;
      }
      const s = it.life > 0 ? it.scale * Math.min(1, it.life * 2) : 0;
      this._s.setScalar(s);
      this._m.compose(it.pos, this._q.setFromEuler(it.rot), this._s);
      this.mesh.setMatrixAt(k, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  reset() {
    for (const it of this.items) it.life = 0;
    this.update(0);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

/** 雨（体験者のまわりに降る線）。center はシナリオ root 座標の体験者位置 */
export class Rain {
  constructor({ count = 700, radius = 7, height = 6, speed = 9 } = {}) {
    this.count = count;
    this.radius = radius;
    this.height = height;
    this.speed = speed;
    this.intensity = 0;
    this.drops = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this._respawn(i, Math.random() * height);
    this.positions = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.LineBasicMaterial({ color: 0xcfd8e3, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 15;
  }

  _respawn(i, y) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * this.radius;
    this.drops[i * 3] = Math.cos(a) * r;
    this.drops[i * 3 + 1] = y;
    this.drops[i * 3 + 2] = Math.sin(a) * r;
  }

  /** floor: 雨粒が消える高さ（水面）。center: 体験者の位置 */
  update(dt, center, floor) {
    this.material.opacity = 0.45 * this.intensity;
    this.lines.visible = this.intensity > 0.01;
    if (!this.lines.visible) return;
    const len = 0.35;
    const wind = 0.12;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      this.drops[j + 1] -= this.speed * dt;
      if (this.drops[j + 1] < floor) this._respawn(i, floor + this.height * (0.8 + Math.random() * 0.2));
      const x = center.x + this.drops[j];
      const y = this.drops[j + 1];
      const z = center.z + this.drops[j + 2];
      const o = i * 6;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      this.positions[o + 3] = x + wind * len;
      this.positions[o + 4] = y + len;
      this.positions[o + 5] = z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}

/** 一瞬光る点光源（火花のフラッシュ） */
export class Flash {
  constructor(color = 0x9fd4ff) {
    this.light = new THREE.PointLight(color, 0, 6, 2);
    this.t = 0;
  }

  fire(position, strength = 1) {
    this.light.position.copy(position);
    this.t = 0.25 * strength;
    this.peak = 8 * strength;
  }

  update(dt) {
    this.t = Math.max(0, this.t - dt);
    // 不規則に瞬く
    this.light.intensity = this.t > 0 ? this.peak * (0.4 + Math.random() * 0.6) * (this.t / 0.25) : 0;
  }
}
