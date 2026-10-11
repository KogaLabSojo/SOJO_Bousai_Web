import * as THREE from 'three';
import { Scenario } from './Scenario.js';
import { loadTexture } from '../core/assets.js';
import { Particles, Chips } from '../core/Effects.js';
import noise from '../shaders/noise.glsl?raw';
import roadVert from '../shaders/road.vert.glsl?raw';
import roadFrag from '../shaders/road.frag.glsl?raw';

const ROAD_W = 4;
const ROAD_L = 9;
// Unity: CrackDamageController.crackSpeed = 0.1 だと遅すぎるので少し速める
const CRACK_SPEED = 0.16;
const COLLAPSE_AT = 0.55;

export class RoadCollapseScenario extends Scenario {
  static id = 'road';
  static title = '路面の陥没・崩壊';
  static placeDistance = 2.2;

  async load() {
    const map = await loadTexture('textures/asphalt.jpg');
    const sunDir = this.ctx.stage.sunOffset.clone().normalize();

    this.uniforms = {
      uCrack: { value: 0 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uCellScale: { value: 2.4 },
      uMap: { value: map },
      // テクスチャ 1 枚 = 幅 4m × 長さ約 5.1m
      uRepeat: { value: new THREE.Vector2(1, ROAD_L / 5.1) },
      uLightDir: { value: sunDir },
      uLightColor: { value: new THREE.Color(0.85, 0.85, 0.82) },
      uAmbient: { value: new THREE.Color(0.42, 0.43, 0.46) },
      uHalfSize: { value: new THREE.Vector2(ROAD_W / 2, ROAD_L / 2) },
      ...this.ctx.stage.env.uniforms,
    };

    const geo = new THREE.PlaneGeometry(ROAD_W, ROAD_L, 200, 450).rotateX(-Math.PI / 2);
    this.road = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: noise + roadVert,
        fragmentShader: noise + roadFrag,
      }),
    );
    this.road.frustumCulled = false;
    this.road.position.y = 0.005;
    this.root.add(this.road);

    // 体験者が道路の上に立つように、道路は手前側に長く伸ばす
    this.road.position.z = 1.0;
    this.uniforms.uCenter.value.set(0, -1.0);
    this.holeZ = this.road.position.z + this.uniforms.uCenter.value.y;

    this.dust = new Particles({
      count: 700,
      color: 0x9d968a,
      sizeStart: 0.3,
      sizeEnd: 1.8,
      opacity: 0.5,
      drag: 1.0,
      gravity: -0.05,
    });
    this.chips = new Chips({ count: 160, color: 0x3c3c3e, size: 0.05 });
    this.root.add(this.dust.points, this.chips.mesh);

    this.reset();
  }

  get hint() {
    if (this.state === 'collapsed') return '路面が陥没しました。下には空洞が広がっていることがあります。';
    if (this.state === 'collapsing') return '崩落しています…！';
    return '画面を<b>長押し</b>すると、ひび割れが広がっていきます。「自動で進める」でも観察できます。';
  }

  get actions() {
    if (this.state !== 'intact') return [];
    return [{ id: 'auto', label: this.auto ? '一時停止' : '自動で進める', primary: !this.auto }];
  }

  onAction(id) {
    if (id === 'auto') {
      this.auto = !this.auto;
      this.ctx.ui.refresh();
    }
  }

  onPressStart() {
    this.pressing = true;
  }

  onPressEnd() {
    this.pressing = false;
  }

  reset() {
    this.state = 'intact';
    this.crack = 0;
    this.auto = false;
    this.pressing = false;
    this.nextCrackSound = 0;
    this.uniforms.uCrack.value = 0;
    this.dust?.reset();
    this.chips?.reset();
    this.ctx.quake = 0;
  }

  /** 陥没の中心から半径 r 付近のランダムな点 */
  _ringPoint(r) {
    const a = Math.random() * Math.PI * 2;
    return { x: Math.cos(a) * r, z: this.holeZ + Math.sin(a) * r, a };
  }

  update(dt) {
    this.elapsed += dt;

    if (this.state === 'intact') {
      if (this.pressing || this.auto) {
        this.crack = Math.min(COLLAPSE_AT, this.crack + CRACK_SPEED * dt);
        if (this.elapsed > this.nextCrackSound) {
          this.ctx.audio.crack(this.crack);
          this.nextCrackSound = this.elapsed + 0.08 + Math.random() * 0.3;
          // ひびが走るたびに割れ目から砂ぼこりと小石が跳ねる
          const p = this._ringPoint(Math.random() * 2.2 * this.crack + 0.1);
          for (let i = 0; i < 4; i++) {
            this.dust.emit({
              x: p.x, y: 0.03, z: p.z,
              vx: (Math.random() - 0.5) * 0.4, vy: 0.2 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4,
              life: 1 + Math.random(), scale: 0.35,
            });
          }
          this.chips.emit(p.x, 0.03, p.z, (Math.random() - 0.5) * 0.8, 0.8 + Math.random(), (Math.random() - 0.5) * 0.8, 0.5, 3);
        }
        this.ctx.quake = this.crack * 0.3;
        if (this.crack >= COLLAPSE_AT) {
          this.state = 'collapsing';
          this.elapsed = 0;
          this.ctx.audio.rumble(2.5, 0.9);
          navigator.vibrate?.([200, 50, 500]);
          this.ctx.ui.refresh();
        }
      } else {
        this.ctx.quake = 0;
      }
    } else if (this.state === 'collapsing') {
      // 一気に崩れ落ちる
      const t = Math.min(1, this.elapsed / 1.6);
      this.crack = COLLAPSE_AT + (1 - COLLAPSE_AT) * (1 - Math.pow(1 - t, 3));
      this.ctx.quake = 0.8 * (1 - t);
      if (Math.random() < 0.3) this.ctx.audio.impact(0.4 * (1 - t) + 0.1, 0.8);
      // 縁が崩れて穴へ落ちていく破片と、穴から立ちのぼる土煙
      const r = 1.5 * this.crack;
      for (let i = 0; i < 3 * (1 - t) + 1; i++) {
        const p = this._ringPoint(r * (0.85 + Math.random() * 0.25));
        this.chips.emit(p.x, 0.02, p.z, -Math.cos(p.a) * 0.6, 0.3 + Math.random() * 0.8, -Math.sin(p.a) * 0.6, 1.4, 5);
        const q = this._ringPoint(r * Math.random());
        this.dust.emit({
          x: q.x, y: -0.2, z: q.z,
          vx: Math.cos(q.a) * 0.6, vy: 0.6 + Math.random() * 1.2, vz: Math.sin(q.a) * 0.6,
          life: 2 + Math.random() * 1.5, scale: 1.2,
        });
      }
      if (t >= 1) {
        this.state = 'collapsed';
        this.ctx.quake = 0;
        this.ctx.ui.refresh();
      }
    }
    this.uniforms.uCrack.value = this.crack;
    this.chips.holes = this.state === 'intact' ? [] : [{ x: 0, z: this.holeZ, r: 1.3 * this.crack }];
    this.dust.update(dt);
    this.chips.update(dt);
  }

  status(info) {
    const pct = Math.round(this.crack * 100);
    const holeZ = this.road.position.z + this.uniforms.uCenter.value.y;
    const d = Math.max(0, Math.hypot(info.cameraLocal.x, info.cameraLocal.z - holeZ) - 1.5 * this.crack);
    return `路面の損傷: <b>${pct}%</b><div class="meter"><i style="width:${pct}%"></i></div>` +
      (this.crack > 0.1 ? `陥没部までの距離: 約 ${d.toFixed(1)} m` : '');
  }
}
