import * as THREE from 'three';
import { Scenario } from './Scenario.js';
import { loadTexture } from '../core/assets.js';
import { Particles, Rain } from '../core/Effects.js';
import vertexShader from '../shaders/water.vert.glsl?raw';
import fragmentShader from '../shaders/water.frag.glsl?raw';

// Unity: FloodExperienceController の閾値
const ANKLE = 0.1;
const KNEE = 0.45;
const WAIST = 0.9;
const CHEST = 1.2;
const RADIUS = 30;
const RISE_SPEED = 0.25;

const PRESETS = [
  { id: 'ankle', label: '足首 10cm', depth: 0.1 },
  { id: 'knee', label: '膝 50cm', depth: 0.5 },
  { id: 'waist', label: '腰 90cm', depth: 0.9 },
  { id: 'chest', label: '胸 1.2m', depth: 1.2 },
  { id: 'over', label: '頭上 2m', depth: 2.0 },
];

const BANDS = {
  none: { label: 'なし', msg: '' },
  ankle: { label: '足首', msg: '足首〜：水の中は見えず、側溝やマンホールに落ちる危険。早めの避難を。' },
  knee: { label: '膝', msg: '膝〜：大人でも歩くのが困難。無理に移動せず、建物の上の階へ（垂直避難）。' },
  waist: { label: '腰', msg: '腰〜：流れがあると立っていられない。車は浮いて流される。' },
  chest: { label: '胸', msg: '胸〜：命に関わる深さ。屋外への避難は不可能。2階以上へ。' },
  over: { label: '頭上', msg: '頭上：1階は完全に水没。ためらわず早めに高い場所へ。' },
};

export class FloodScenario extends Scenario {
  static id = 'flood';
  static title = '洪水・浸水';
  static placeDistance = 0;
  static placeHint = '足もとの床にスマホを向けて、リングが出たらタップしてください（床の高さを基準にします）。';

  async load() {
    const [albedo, normal] = await Promise.all([
      loadTexture('textures/water_albedo.jpg'),
      loadTexture('textures/water_normal.jpg', { srgb: false }),
    ]);
    const sunDir = this.ctx.stage.sunOffset.clone().normalize();

    // Water.mat の値をそのまま使う
    this.uniforms = {
      uTime: { value: 0 },
      uWaveSpeed: { value: 1.7 },
      uWaveHeight: { value: 0.03 },
      uTexSpeed: { value: new THREE.Vector2(1, 2) },
      uTiling: { value: 0.6 },
      uAlbedo: { value: albedo },
      uNormal: { value: normal },
      uColor: { value: new THREE.Color(0.289, 0.212, 0.143) },
      uMetallic: { value: 0.672 },
      uSmoothness: { value: 0.841 },
      uRimColor: { value: new THREE.Color(0.127, 0.202, 0.283) },
      uRimPower: { value: 2.17 },
      uFade: { value: 0.6 },
      uLightDir: { value: sunDir },
      uLightColor: { value: new THREE.Color(0.85, 0.85, 0.82) },
      uAmbient: { value: new THREE.Color(0.42, 0.44, 0.48) },
      uSkyColor: { value: new THREE.Color(0.55, 0.62, 0.7) },
      uCenter: { value: new THREE.Vector2() },
      uRadius: { value: RADIUS },
      uRain: { value: 0 },
      uWake: { value: 0 },
      ...this.ctx.stage.env.uniforms,
    };

    const geo = new THREE.PlaneGeometry(RADIUS * 2, RADIUS * 2, 180, 180).rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.water.frustumCulled = false;
    this.water.renderOrder = 10;
    this.root.add(this.water);

    // 流れてくる木材・ゴミ
    this.debris = [];
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.9 });
    const trashMat = new THREE.MeshStandardMaterial({ color: 0x3d6fb3, roughness: 0.5 });
    for (let i = 0; i < 10; i++) {
      const isWood = i % 3 !== 0;
      const mesh = new THREE.Mesh(
        isWood ? new THREE.BoxGeometry(0.9, 0.05, 0.12) : new THREE.CylinderGeometry(0.04, 0.04, 0.22, 10).rotateZ(Math.PI / 2),
        isWood ? woodMat : trashMat,
      );
      mesh.castShadow = true;
      mesh.userData = {
        x: (Math.random() - 0.5) * 10,
        z: (Math.random() - 0.5) * 10,
        spin: (Math.random() - 0.5) * 0.4,
        phase: Math.random() * 10,
      };
      mesh.rotation.y = Math.random() * Math.PI;
      this.root.add(mesh);
      this.debris.push(mesh);
    }

    this.rain = new Rain();
    this.splash = new Particles({
      count: 400,
      color: 0xdfe6ee,
      gravity: 5,
      drag: 0.5,
      sizeStart: 0.035,
      sizeEnd: 0.012,
      opacity: 0.85,
    });
    this.root.add(this.rain.lines, this.splash.points);
    this.raining = false;
    this.prevCam = null;

    this.level = 0;
    this.target = 0;
    this.selected = null;
  }

  get hint() {
    const local = this._localPreset();
    if (this.selected === 'local' && local) {
      return `この場所の想定最大（${local.source}）は <b>${local.rankLabel}</b>。${BANDS[this.band ?? 'none'].msg}` +
        '<br><small>出典：ハザードマップポータルサイト</small>';
    }
    if (this.target === 0) {
      return local
        ? '「この場所」を選ぶと、ハザードマップの想定浸水深まで水位が上がります。'
        : '浸水の深さを選ぶと、水位が実寸で上がってきます。';
    }
    return BANDS[this.band ?? 'none'].msg || '水位が上がっています…';
  }

  get actions() {
    const local = this._localPreset();
    const presets = local ? [local, ...PRESETS] : PRESETS;
    return [
      ...presets.map((p) => ({ id: p.id, label: p.label, active: this.selected === p.id, primary: p.id === 'local' })),
      { id: 'rain', label: this.raining ? '☔ 雨を止める' : '☔ 大雨にする', active: this.raining },
    ];
  }

  /** メニューで調べた現在地のハザードマップ結果をプリセットにする */
  _localPreset() {
    const worst = this.ctx.hazard?.worst;
    if (!worst) return null;
    return {
      id: 'local',
      label: `📍 この場所 ${worst.rank.label}`,
      depth: worst.rank.depth,
      source: worst.label,
      rankLabel: worst.rank.label,
    };
  }

  get slider() {
    if (this.ctx.mode !== 'fallback') return null;
    return {
      label: '目の高さ',
      min: 1.0,
      max: 1.9,
      step: 0.05,
      value: this.ctx.getEyeHeight(),
      format: (v) => `${Math.round(v * 100)}cm`,
    };
  }

  onSlider(v) {
    this.ctx.setEyeHeight(v);
  }

  onAction(id) {
    if (id === 'rain') {
      this.raining = !this.raining;
      this.ctx.ui.refresh();
      return;
    }
    const preset = id === 'local' ? this._localPreset() : PRESETS.find((p) => p.id === id);
    if (!preset) return;
    this.selected = id;
    this.target = preset.depth;
    this.ctx.ui.refresh();
  }

  reset() {
    this.level = 0;
    this.target = 0;
    this.selected = null;
    this.raining = false;
    this.rain.intensity = 0;
    this.splash.reset();
    this.prevCam = null;
    this.ctx.ui.setUnderwater(false);
    this.ctx.audio.setLoop('water', 0);
    this.ctx.audio.setLoop('rain', 0);
  }

  update(dt, info) {
    this.elapsed += dt;
    this.uniforms.uTime.value = this.elapsed;

    const diff = this.target - this.level;
    this.level += Math.sign(diff) * Math.min(Math.abs(diff), RISE_SPEED * dt);

    // 水面は体験者の水平位置に追従（Unity 版と同じ）
    const cam = info.cameraLocal;
    this.water.visible = this.level > 0.005;
    this.water.position.set(cam.x, this.level, cam.z);
    const wp = this.water.getWorldPosition(new THREE.Vector3());
    this.uniforms.uCenter.value.set(wp.x, wp.z);

    for (const d of this.debris) {
      const u = d.userData;
      d.visible = this.level > 0.08;
      u.z += dt * 0.35;
      u.x += Math.sin(this.elapsed * 0.3 + u.phase) * dt * 0.1;
      if (u.z > 6) {
        u.z = -6;
        u.x = (Math.random() - 0.5) * 10;
      }
      d.position.set(
        cam.x + u.x,
        this.level + Math.sin(this.elapsed * 1.7 + u.phase) * 0.02 + 0.01,
        cam.z + u.z,
      );
      d.rotation.y += u.spin * dt;
      d.rotation.z = Math.sin(this.elapsed * 1.3 + u.phase) * 0.08;
    }

    const eye = info.eyeHeight;
    const band = this._resolveBand(this.level, eye);
    if (band !== this.band) {
      this.band = band;
      this.ctx.ui.refresh();
    }
    const under = this.level > eye - 0.02;
    this.ctx.ui.setUnderwater(under);
    this.ctx.audio.setLoop('water', this.level > 0.02 ? Math.min(0.35, 0.1 + this.level * 0.2) : 0);

    this._updateRainAndSplash(dt, cam, eye, under);
  }

  _updateRainAndSplash(dt, cam, eye, under) {
    const r = this.rain;
    r.intensity += ((this.raining ? 1 : 0) - r.intensity) * Math.min(1, dt * 1.5);
    this.uniforms.uRain.value = r.intensity;
    r.update(dt, cam, this.level > 0.005 ? this.level : 0);
    this.ctx.audio.setLoop('rain', r.intensity * 0.3, { type: 'highpass', freq: 2500, q: 0.3 });

    // 水が足首より上・目より下のときだけ足もとに白波
    const wading = this.level > ANKLE * 0.5 && !under;
    this.uniforms.uWake.value += ((wading ? 1 : 0) - this.uniforms.uWake.value) * Math.min(1, dt * 2);

    const surface = this.level > 0.005 ? this.level : 0;
    // 雨粒が水面（または地面）に当たって跳ねる
    const drops = r.intensity * 60 * dt;
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 0.3 + Math.random() * 3;
      this._splash(cam.x + Math.cos(a) * d, surface, cam.z + Math.sin(a) * d, 2, 0.7);
    }

    // 水の中を歩くと足もとで水しぶきが上がる
    if (this.prevCam && wading) {
      const speed = Math.hypot(cam.x - this.prevCam.x, cam.z - this.prevCam.z) / Math.max(dt, 1e-3);
      if (speed > 0.25 && Math.random() < dt * 20 * Math.min(1, speed)) {
        this._splash(cam.x + (Math.random() - 0.5) * 0.4, surface, cam.z + (Math.random() - 0.5) * 0.4, 8, 1.6);
      }
    }
    this.prevCam = (this.prevCam ?? new THREE.Vector3()).copy(cam);
    this.splash.update(dt);
  }

  _splash(x, y, z, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.2 + Math.random() * 0.5) * power;
      this.splash.emit({
        x, y: y + 0.01, z,
        vx: Math.cos(a) * s * 0.5,
        vy: s * 1.4,
        vz: Math.sin(a) * s * 0.5,
        life: 0.25 + Math.random() * 0.25 * power,
      });
    }
  }

  _resolveBand(depth, eye) {
    if (depth <= 0.001) return 'none';
    if (depth >= eye) return 'over';
    if (depth >= CHEST) return 'chest';
    if (depth >= WAIST) return 'waist';
    if (depth >= KNEE) return 'knee';
    if (depth >= ANKLE) return 'ankle';
    return 'none';
  }

  status(info) {
    const band = BANDS[this.band ?? 'none'];
    const clearance = info.eyeHeight - this.level;
    const cls = this.level >= KNEE ? 'danger' : this.level >= ANKLE ? '' : 'safe';
    return (
      `浸水深(地面基準): <b>${Math.round(this.level * 100)} cm</b> <span class="${cls}">[${band.label}]</span>\n` +
      `水面まで(目線): ${Math.round(clearance * 100)} cm`
    );
  }

  dispose() {
    this.ctx.ui.setUnderwater(false);
    this.ctx.audio.setLoop('water', 0);
    this.ctx.audio.setLoop('rain', 0);
    super.dispose();
  }
}
