import * as THREE from 'three';

/** Android Chrome などの WebXR (immersive-ar + hit-test) 用。床を検出して 6DoF で体験できる。 */
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
    this.onSelect = null;
    this.onSelectStart = null;
    this.onSelectEnd = null;
    this.onEnd = null;

    const ring = new THREE.RingGeometry(0.12, 0.16, 40).rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9 }),
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    stage.scene.add(this.reticle);
  }

  /** ユーザー操作のハンドラ内で最初に呼ぶこと（requestSession は user gesture が必要） */
  async start() {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor', 'camera-access'],
      domOverlay: { root: this.overlayRoot },
    });
    const renderer = this.stage.renderer;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    this.session = session;

    const viewerSpace = await session.requestReferenceSpace('viewer');
    this.hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

    session.addEventListener('select', () => this.onSelect?.());
    session.addEventListener('selectstart', () => this.onSelectStart?.());
    session.addEventListener('selectend', () => this.onSelectEnd?.());
    session.addEventListener('end', () => {
      this.hitTestSource = null;
      this.session = null;
      this.reticle.visible = false;
      this.onEnd?.();
    });
  }

  update(frame) {
    if (!frame || !this.hitTestSource) return;
    const refSpace = this.stage.renderer.xr.getReferenceSpace();
    const hits = frame.getHitTestResults(this.hitTestSource);
    if (hits.length > 0) {
      const pose = hits[0].getPose(refSpace);
      this.reticle.matrix.fromArray(pose.transform.matrix);
      this.hitPosition.setFromMatrixPosition(this.reticle.matrix);
      this.hasHit = true;
    } else {
      this.hasHit = false;
    }
    this.reticle.visible = this.searching && this.hasHit;
  }

  async stop() {
    if (this.session) await this.session.end();
  }
}
