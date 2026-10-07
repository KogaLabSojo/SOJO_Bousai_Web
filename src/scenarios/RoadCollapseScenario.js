import * as THREE from 'three';
import { Scenario } from './Scenario.js';
import { loadTexture } from '../core/assets.js';
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
    this.ctx.quake = 0;
  }

  update(dt) {
    this.elapsed += dt;

    if (this.state === 'intact') {
      if (this.pressing || this.auto) {
        this.crack = Math.min(COLLAPSE_AT, this.crack + CRACK_SPEED * dt);
        if (this.elapsed > this.nextCrackSound) {
          this.ctx.audio.crack(this.crack);
          this.nextCrackSound = this.elapsed + 0.08 + Math.random() * 0.3;
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
      if (t >= 1) {
        this.state = 'collapsed';
        this.ctx.quake = 0;
        this.ctx.ui.refresh();
        this.ctx.ui.showTips();
      }
    }
    this.uniforms.uCrack.value = this.crack;
  }

  status(info) {
    const pct = Math.round(this.crack * 100);
    const holeZ = this.road.position.z + this.uniforms.uCenter.value.y;
    const d = Math.max(0, Math.hypot(info.cameraLocal.x, info.cameraLocal.z - holeZ) - 1.5 * this.crack);
    return `路面の損傷: <b>${pct}%</b><div class="meter"><i style="width:${pct}%"></i></div>` +
      (this.crack > 0.1 ? `陥没部までの距離: 約 ${d.toFixed(1)} m` : '');
  }

  get tips() {
    return [
      '道路のひび割れ・段差・へこみは、下に<b>空洞</b>ができているサインのことがある。',
      '陥没の周囲は見た目以上に広く崩れる。<b>近づかず、のぞき込まない</b>。',
      '地震後や大雨の後は、路面の異常に注意して歩く・運転する。',
      '見つけたら警察(110)や道路緊急ダイヤル<b>#9910</b>へ通報する。',
    ];
  }
}
