import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Scenario } from './Scenario.js';
import { loadGLTF, loadTexture } from '../core/assets.js';
import { Particles, Chips } from '../core/Effects.js';

const SHAKE_TIME = 3.2;
const FOOTING_HEIGHT = 0.12;
const RELEASE_ANGLE = 0.32;
const G = 9.81;

export class BlockWallScenario extends Scenario {
  static id = 'block';
  static title = 'ブロック塀の倒壊';
  static placeDistance = 2.2;
  static placeOnWall = true;
  /** 実際の壁面から基礎の中心までの距離（基礎の奥行き 0.32 m の半分＋すき間） */
  static wallOffset = 0.18;
  static placeHint =
    '床か壁にスマホを向けてタップします。壁（水色のリング）を選ぶと、その壁に沿って塀が建ちます。';

  async load() {
    const [gltf, concrete] = await Promise.all([
      loadGLTF('models/block_wall.glb'),
      loadTexture('textures/concrete.jpg'),
    ]);

    // 揺れ全体を受ける地盤 → 転倒の支点 → 塀
    this.shaker = new THREE.Group();
    this.root.add(this.shaker);

    const footingTex = concrete.clone();
    footingTex.repeat.set(3, 0.3);
    footingTex.needsUpdate = true;
    const footing = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, FOOTING_HEIGHT, 0.32),
      new THREE.MeshStandardMaterial({ map: footingTex, roughness: 0.9 }),
    );
    footing.position.y = FOOTING_HEIGHT / 2;
    footing.castShadow = footing.receiveShadow = true;
    this.shaker.add(footing);

    this.wall = gltf.scene.clone(true);
    this.blocks = [];
    const box = new THREE.Box3();
    this.wall.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox);
      const size = box.getSize(new THREE.Vector3()).multiply(o.scale);
      this.blocks.push({
        mesh: o,
        parent: o.parent,
        size,
        homePos: o.position.clone(),
        homeQuat: o.quaternion.clone(),
        body: null,
      });
    });
    const wallBox = new THREE.Box3().setFromObject(this.wall);
    this.wallHeight = wallBox.max.y - wallBox.min.y;
    this.wallThickness = wallBox.max.z - wallBox.min.z;

    // 体験者側（+Z）の根元を支点にする
    this.pivot = new THREE.Group();
    this.pivot.position.set(0, FOOTING_HEIGHT, this.wallThickness / 2);
    this.wall.position.set(0, 0, -this.wallThickness / 2);
    this.pivot.add(this.wall);
    this.shaker.add(this.pivot);

    // 物理演算で崩れた後のブロックの置き場（root 座標系）
    this.debris = new THREE.Group();
    this.root.add(this.debris);

    this.dust = new Particles({
      count: 600,
      color: 0xc4bcac,
      sizeStart: 0.25,
      sizeEnd: 1.3,
      opacity: 0.5,
      drag: 1.3,
      gravity: -0.03,
    });
    this.chips = new Chips({ count: 120, color: 0x8f8f8a, size: 0.035 });
    this.root.add(this.dust.points, this.chips.mesh);

    this.totalHeight = this.wallHeight + FOOTING_HEIGHT;
    this.reset();
  }

  get hint() {
    if (this.state === 'idle') return '「地震発生」で揺れが始まります。塀の高さ（約1.45m）と自分の距離に注目してください。';
    if (this.state === 'done') return '倒れたブロックの範囲を見てみましょう。塀の高さ以上の範囲に散らばることがあります。';
    return '揺れています…！';
  }

  get actions() {
    return this.state === 'idle' ? [{ id: 'quake', label: '地震発生', primary: true }] : [];
  }

  onAction(id) {
    if (id === 'quake' && this.state === 'idle') {
      this.state = 'shaking';
      this.elapsed = 0;
      this.ctx.audio.rumble(SHAKE_TIME + 2.5, 1);
      navigator.vibrate?.([400, 100, 600, 100, 800]);
      this.ctx.ui.refresh();
    }
  }

  reset() {
    this.state = 'idle';
    this.elapsed = 0;
    this.theta = 0;
    this.omega = 0;
    this.world = null;
    this.shaker.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
    for (const b of this.blocks) {
      b.parent.add(b.mesh);
      b.mesh.position.copy(b.homePos);
      b.mesh.quaternion.copy(b.homeQuat);
      b.body = null;
    }
    this.dust?.reset();
    this.chips?.reset();
    this.ctx.quake = 0;
  }

  _puff(x, z, n, spread = 0.3, scale = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.3 + Math.random() * 0.9;
      this.dust.emit({
        x: x + (Math.random() - 0.5) * spread,
        y: 0.05 + Math.random() * 0.1,
        z: z + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * s,
        vy: 0.15 + Math.random() * 0.5,
        vz: Math.sin(a) * s,
        life: 1.6 + Math.random() * 1.4,
        scale,
      });
    }
  }

  update(dt) {
    this.elapsed += dt;

    if (this.state === 'shaking') {
      const t = this.elapsed;
      const amp = Math.min(1, t / 1.2);
      this.ctx.quake = amp;
      this.shaker.position.x = Math.sin(t * 2 * Math.PI * 2.3) * 0.05 * amp + (Math.random() - 0.5) * 0.01 * amp;
      this.shaker.position.z = Math.sin(t * 2 * Math.PI * 1.7 + 1.0) * 0.03 * amp;
      // 揺れで塀がぐらつく（徐々に体験者側へ傾き始める）
      const lean = Math.max(0, (t - 1.5) / (SHAKE_TIME - 1.5));
      this.pivot.rotation.x = Math.sin(t * 2 * Math.PI * 2.3) * 0.025 * amp + lean * 0.05;
      // 目地のモルタルが崩れて上からパラパラ落ちる
      if (Math.random() < dt * 10 * amp) {
        const x = (Math.random() - 0.5) * 2.8 + this.shaker.position.x;
        this.chips.emit(x, this.totalHeight, 0.1, 0, 0, 0.3, 0.5, 3);
        this.dust.emit({ x, y: this.totalHeight, z: 0.1, vx: 0, vy: -0.4, vz: 0.15, life: 1.2, scale: 0.3 });
      }
      if (t >= SHAKE_TIME) {
        this.state = 'toppling';
        this.theta = this.pivot.rotation.x;
        this.omega = 0.35;
        this.ctx.audio.crack(1);
      }
    } else if (this.state === 'toppling') {
      // 根元を支点に剛体として倒れる: θ'' = (3g / 2h) sinθ
      this.ctx.quake = Math.max(0, this.ctx.quake - dt);
      this.shaker.position.multiplyScalar(0.9);
      this.omega += ((3 * G) / (2 * this.wallHeight)) * Math.sin(this.theta + 0.05) * dt;
      this.theta += this.omega * dt;
      this.pivot.rotation.x = this.theta;
      if (this.theta >= RELEASE_ANGLE) this._releaseBlocks();
    } else if (this.state === 'falling' || this.state === 'done') {
      this.ctx.quake = Math.max(0, this.ctx.quake - dt);
      this.world.step(1 / 60, dt, 4);
      for (const b of this.blocks) {
        b.mesh.position.copy(b.body.position);
        b.mesh.quaternion.copy(b.body.quaternion);
      }
      if (this.state === 'falling' && this.elapsed > 3.5) {
        this.state = 'done';
        this.ctx.ui.refresh();
      }
    }
    this.dust.update(dt);
    this.chips.update(dt);
  }

  _releaseBlocks() {
    this.state = 'falling';
    this.elapsed = 0;
    this.shaker.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -G, 0) });
    world.allowSleep = true;
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.defaultContactMaterial.friction = 0.6;
    world.defaultContactMaterial.restitution = 0.05;

    const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(ground);
    const footing = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(1.5, FOOTING_HEIGHT / 2, 0.16)),
      position: new CANNON.Vec3(0, FOOTING_HEIGHT / 2, 0),
    });
    world.addBody(footing);

    const pivotPos = this.pivot.position.clone();
    const invRoot = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    let lastImpact = 0;

    for (const b of this.blocks) {
      m.multiplyMatrices(invRoot, b.mesh.matrixWorld).decompose(pos, quat, scl);
      this.debris.add(b.mesh);
      b.mesh.position.copy(pos);
      b.mesh.quaternion.copy(quat);

      const body = new CANNON.Body({
        mass: 12,
        shape: new CANNON.Box(new CANNON.Vec3(b.size.x / 2 * 0.98, b.size.y / 2 * 0.98, b.size.z / 2 * 0.98)),
        position: new CANNON.Vec3(pos.x, pos.y, pos.z),
        quaternion: new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w),
        linearDamping: 0.05,
        angularDamping: 0.15,
        sleepSpeedLimit: 0.15,
      });
      // 剛体回転の速度 v = ω × r を引き継ぐ
      const r = pos.clone().sub(pivotPos);
      const w = this.omega;
      body.velocity.set((Math.random() - 0.5) * 0.3, -w * r.z, w * r.y);
      body.angularVelocity.set(w, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5);
      body.addEventListener('collide', (e) => {
        const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
        const now = performance.now();
        if (v > 1.5 && now - lastImpact > 45) {
          lastImpact = now;
          this.ctx.audio.impact(Math.min(1, v / 5), 1.4);
          const p = body.position;
          if (p.y < 0.4) this._puff(p.x, p.z, Math.min(14, Math.round(v * 3)), 0.25, 0.7);
          for (let i = 0; i < Math.min(5, v); i++) {
            this.chips.emit(p.x, Math.max(0.05, p.y), p.z,
              (Math.random() - 0.5) * v * 0.6, Math.random() * v * 0.5, (Math.random() - 0.3) * v * 0.6, 0.8, 5);
          }
        }
      });
      world.addBody(body);
      b.body = body;
    }
    this.world = world;
    // 根元が折れる瞬間に基礎まわりから粉じんが噴き出す
    for (let x = -1.4; x <= 1.4; x += 0.2) this._puff(x, pivotPos.z, 4, 0.2, 0.8);
    for (let i = 0; i < 25; i++) {
      this.chips.emit((Math.random() - 0.5) * 2.8, FOOTING_HEIGHT + 0.05, pivotPos.z,
        (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 1.5, 0.5 + Math.random() * 1.5, 1, 6);
    }
    this.ctx.quake = 0.6;
    navigator.vibrate?.(300);
  }

  status(info) {
    const d = Math.max(0, info.cameraLocal.z - this.wallThickness / 2);
    const danger = d < this.totalHeight;
    const cls = danger ? 'danger' : 'safe';
    const msg = danger ? '危険範囲：塀の高さより近い' : '塀の高さ以上離れている';
    return `塀までの距離: <b>${d.toFixed(1)} m</b>（塀の高さ ${this.totalHeight.toFixed(2)} m）\n<span class="${cls}">${msg}</span>`;
  }
}
