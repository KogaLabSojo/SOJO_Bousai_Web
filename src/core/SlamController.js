import * as THREE from 'three';

const ENGINE_URL = 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js';
const NEAR = 0.05;
const FAR = 200;

let enginePromise = null;

function loadEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise((resolve, reject) => {
    if (window.XR8) return resolve(window.XR8);
    window.addEventListener('xrloaded', () => resolve(window.XR8), { once: true });
    const script = document.createElement('script');
    script.src = ENGINE_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('8th Wall Engine の読み込みに失敗しました'));
    document.head.appendChild(script);
  })
    .then(async (XR8) => {
      await XR8.loadChunk('slam');
      return XR8;
    })
    .catch((err) => {
      enginePromise = null;
      throw err;
    });
  return enginePromise;
}

/**
 * WebXR が使えないスマホ（iPhone Safari など）向けの 6DoF AR。
 * 8th Wall Engine の SLAM でカメラの位置・向きを推定し、three.js のカメラに反映する。
 * カメラ映像は 8th Wall が feedCanvas に描画し、その上に透明な 3D キャンバスを重ねる。
 * スケールは「開始時の端末の高さ = eyeHeight」として決まり、床は y = 0。
 */
export class SlamController {
  /** スマホ（タッチ主体の端末）なら 8th Wall を試す価値がある */
  static isCandidate() {
    return window.matchMedia?.('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  }

  /** メニュー表示中に先読みしておくと、開始時の待ち時間が減る */
  static preload() {
    return loadEngine().then(
      (XR8) => XR8.XrDevice.isDeviceBrowserCompatible({ allowedDevices: XR8.XrConfig.device().MOBILE }),
      () => false,
    );
  }

  constructor(stage, feedCanvas) {
    this.stage = stage;
    this.canvas = feedCanvas;
    this.eyeHeight = 1.5;
    this.running = false;
    this.tracking = false;
    this.shake = 0;
    this.reality = null;
    this._shakeOffset = new THREE.Vector3();
    this._onResize = () => this._resizeCanvas();
  }

  async start() {
    const XR8 = await loadEngine();
    if (!XR8.XrDevice.isDeviceBrowserCompatible({ allowedDevices: XR8.XrConfig.device().MOBILE })) {
      throw new Error('この端末・ブラウザは 8th Wall のワールドトラッキングに非対応です');
    }

    this.reality = null;
    this.tracking = false;
    this._resizeCanvas();
    window.addEventListener('resize', this._onResize);
    document.body.classList.add('slam-on');

    XR8.XrController.configure({ scale: 'responsive', disableWorldTracking: false });

    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        err ? reject(err) : resolve();
      };
      XR8.clearCameraPipelineModules();
      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.XrController.pipelineModule(),
        {
          name: 'bousai-slam',
          onStart: ({ canvasWidth, canvasHeight }) => {
            this._configureCamera(canvasWidth, canvasHeight);
            done();
          },
          onCanvasSizeChange: ({ canvasWidth, canvasHeight }) => {
            this._configureCamera(canvasWidth, canvasHeight, false);
          },
          onUpdate: ({ processCpuResult }) => {
            const r = processCpuResult?.reality;
            if (!r) return;
            this.reality = r;
            if (r.trackingStatus === 'NORMAL') this.tracking = true;
          },
          onCameraStatusChange: ({ status }) => {
            if (status === 'failed') done(new Error('カメラを使用できません'));
          },
          onException: (err) => {
            console.error('[8th Wall]', err);
            done(err instanceof Error ? err : new Error(String(err)));
          },
        },
      ]);
      XR8.run({
        canvas: this.canvas,
        // 人物オクルージョンでこのキャンバスを読み出すため
        glContextConfig: { preserveDrawingBuffer: true },
        allowedDevices: XR8.XrConfig.device().MOBILE,
        cameraConfig: { direction: XR8.XrConfig.camera().BACK },
      });
    }).catch((err) => {
      this.stop();
      throw err;
    });

    this.running = true;
  }

  get trackingStatus() {
    return this.reality?.trackingStatus ?? 'UNSPECIFIED';
  }

  update() {
    const r = this.reality;
    if (!r) return;
    const cam = this.stage.camera;
    if (r.intrinsics) {
      cam.projectionMatrix.fromArray(r.intrinsics);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    }
    if (r.rotation) cam.quaternion.set(r.rotation.x, r.rotation.y, r.rotation.z, r.rotation.w);
    if (r.position) cam.position.set(r.position.x, r.position.y, r.position.z);
    if (this.shake > 0) {
      const s = this.shake;
      this._shakeOffset.set((Math.random() - 0.5) * 0.04 * s, (Math.random() - 0.5) * 0.03 * s, 0);
      cam.position.add(this._shakeOffset);
    }
    cam.updateMatrixWorld();
  }

  stop() {
    window.removeEventListener('resize', this._onResize);
    document.body.classList.remove('slam-on');
    const XR8 = window.XR8;
    if (XR8) {
      try {
        XR8.stop();
        XR8.clearCameraPipelineModules();
      } catch (err) {
        console.warn(err);
      }
    }
    this.running = false;
    this.tracking = false;
    this.reality = null;
  }

  _configureCamera(width, height, recenter = true) {
    const XR8 = window.XR8;
    XR8.XrController.updateCameraProjectionMatrix({
      cam: { pixelRectWidth: width, pixelRectHeight: height, nearClipPlane: NEAR, farClipPlane: FAR },
      origin: { x: 0, y: this.eyeHeight, z: 0 },
      facing: { w: 1, x: 0, y: 0, z: 0 },
    });
    if (recenter) XR8.XrController.recenter();
  }

  _resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }
}
