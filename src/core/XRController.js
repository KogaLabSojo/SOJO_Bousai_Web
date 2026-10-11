import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Android Chrome などの WebXR (immersive-ar + hit-test) 用。床・壁を検出して 6DoF で体験できる。
 * ヒットテストの姿勢の Y 軸は面の法線なので、その向きで床か壁かを判定する。
 */
export class XRController {
  static async isSupported() {
    if (!navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      return false;
    }
  }

  constructor(stage, overlayRoot) {
    this.stage = stage;
    this.overlayRoot = overlayRoot;
    this.session = null;
    this.hitTestSource = null;
    this.hasHit = false;
    this.searching = true;
    this.hitPosition = new THREE.Vector3();
    this.hitNormal = new THREE.Vector3(0, 1, 0);
    /** 'floor' | 'wall' | 'other' */
    this.hitKind = 'floor';
    /** これまでに見つかった床の高さ（見つかるまでは null） */
    this.floorY = null;
    this.onSelect = null;
    this.onSelectStart = null;
    this.onSelectEnd = null;
    this.onEnd = null;
    this._matrix = new THREE.Matrix4();
    this._camPos = new THREE.Vector3();
  }

  /** ユーザー操作のハンドラ内で最初に呼ぶこと（requestSession は user gesture が必要） */
  async start() {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor', 'camera-access', 'light-estimation'],
      domOverlay: { root: this.overlayRoot },
    });
    const renderer = this.stage.renderer;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    this.session = session;
    this.floorY = null;

    const viewerSpace = await session.requestReferenceSpace('viewer');
    this.hitTestSource = await session.requestHitTestSource({
      space: viewerSpace,
      entityTypes: ['plane', 'point'],
    });

    session.addEventListener('select', () => this.onSelect?.());
    session.addEventListener('selectstart', () => this.onSelectStart?.());
    session.addEventListener('selectend', () => this.onSelectEnd?.());
    session.addEventListener('end', () => {
      this.hitTestSource = null;
      this.session = null;
      this.stage.reticle.visible = false;
      this.onEnd?.();
    });
  }

  update(frame) {
    if (!frame || !this.hitTestSource) return;
    const refSpace = this.stage.renderer.xr.getReferenceSpace();
    const hits = frame.getHitTestResults(this.hitTestSource);
    this.hasHit = false;
    if (hits.length > 0) {
      const pose = hits[0].getPose(refSpace);
      if (pose) {
        this._matrix.fromArray(pose.transform.matrix);
        this.hitPosition.setFromMatrixPosition(this._matrix);
        this.hitNormal.setFromMatrixColumn(this._matrix, 1).normalize();
        const up = this.hitNormal.dot(UP);
        this.hitKind = up > 0.8 ? 'floor' : Math.abs(up) < 0.35 ? 'wall' : 'other';
        if (this.hitKind === 'floor') this._trackFloor(this.hitPosition.y);
        this.stage.setReticle(this._matrix, this.hitKind === 'wall');
        this.hasHit = true;
      }
    }
    this.stage.reticle.visible = this.searching && this.hasHit;
  }

  /** 目の高さより十分低い水平面のうち、最も低いものを床とみなす */
  _trackFloor(y) {
    this.stage.camera.getWorldPosition(this._camPos);
    if (y > this._camPos.y - 0.6) return;
    this.floorY = this.floorY === null ? y : Math.min(this.floorY, y);
  }

  /** 床の高さ（未検出ならカメラの 1.5 m 下と仮定） */
  get floorHeight() {
    if (this.floorY !== null) return this.floorY;
    this.stage.camera.getWorldPosition(this._camPos);
    return this._camPos.y - 1.5;
  }

  async stop() {
    if (this.session) await this.session.end();
  }
}
