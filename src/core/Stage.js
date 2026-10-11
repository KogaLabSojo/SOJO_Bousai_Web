import * as THREE from 'three';
import { EnvironmentLighting } from './EnvironmentLighting.js';

export class Stage {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 200);
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xeef4ff, 0x5a5448, 1.1);
    this.scene.add(this.hemi);

    this.sunIntensity = 2.2;
    const sun = new THREE.DirectionalLight(0xffffff, this.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 40;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    this.sunOffset = new THREE.Vector3(4, 10, 6);

    this.env = new EnvironmentLighting(this);

    // 災害コンテンツを置く基準点（床の上、+Z が体験者の方向）
    this.anchor = new THREE.Group();
    this.scene.add(this.anchor);

    // 現実の床に影だけを落とす透明な面
    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = 0.002;
    shadowCatcher.receiveShadow = true;
    this.anchor.add(shadowCatcher);

    this.grid = new THREE.GridHelper(40, 40, 0xffffff, 0xffffff);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.15;
    this.grid.visible = false;
    this.anchor.add(this.grid);

    // 配置位置を示すリング（床はオレンジ、壁は水色）
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.16, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.reticle.renderOrder = 999;
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    window.addEventListener('resize', () => this.resize());
  }

  setReticle(matrix, onWall = false) {
    this.reticle.matrix.copy(matrix);
    this.reticle.material.color.set(onWall ? 0x3ad1ff : 0xffb020);
  }

  /** 基準点を水平回転・前後移動する（微調整用）。forward は体験者から離れる向きが正 */
  nudgeAnchor(yaw, forward) {
    const a = this.anchor;
    a.rotation.y += yaw;
    // +Z が体験者側なので、離れる向きは -Z
    a.position.add(new THREE.Vector3(0, 0, -forward).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.rotation.y));
    a.updateMatrixWorld(true);
    this.sun.target.position.copy(a.position);
    this.sun.position.copy(a.position).add(this.sunOffset);
  }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** 体験者の位置を見て、+Z が体験者を向くように基準点を置く */
  placeAnchor(position, faceToward) {
    this.anchor.position.copy(position);
    const dx = faceToward.x - position.x;
    const dz = faceToward.z - position.z;
    this.anchor.rotation.set(0, Math.atan2(dx, dz), 0);
    this.anchor.updateMatrixWorld(true);
    this.sun.target.position.copy(position);
    this.sun.position.copy(position).add(this.sunOffset);
  }

  /** カメラが見ている方向の床 (y = 0) 上、distance 先に基準点を置く */
  placeInFrontOfCamera(distance) {
    const cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const feet = new THREE.Vector3(cam.position.x, 0, cam.position.z);
    const pos = feet.clone().addScaledVector(fwd, distance);
    if (distance < 0.01) feet.sub(fwd);
    this.placeAnchor(pos, feet);
  }
}
