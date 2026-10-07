import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { XREstimatedLight } from 'three/addons/webxr/XREstimatedLight.js';

const CUBE_SIZE = 128;
const FEED_WIDTH = 256;
const CAPTURE_MS = 100;
const PMREM_MS = 400;
const BLEND = 0.35;
const ENV_GAIN = 2.2;

const DEFAULT_HEMI = 1.1;
const DEFAULT_ENV_INTENSITY = 0.6;

/**
 * カメラ映像からの IBL（イメージベースドライティング）。
 * スマホを向けた方向の映像をその向きのまま球面に投影してキューブマップに蓄積し、
 * PMREM にかけて scene.environment にする。見回すほど周囲の環境が埋まっていく。
 * Android WebXR で light-estimation が使えるときは ARCore の HDR 環境マップと主光源を優先する。
 * 水面・路面の ShaderMaterial は uniforms（uEnvMap / uEnvMix）でキューブマップを直接参照する。
 */
export class EnvironmentLighting {
  constructor(stage) {
    this.stage = stage;
    const { renderer, scene } = stage;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.defaultEnv = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.defaultEnv;
    scene.environmentIntensity = DEFAULT_ENV_INTENSITY;

    this.source = null;
    this.captured = 0;
    this.envTarget = null;
    this._lastCapture = 0;
    this._lastPmrem = 0;
    this._dirty = false;

    this.cubeTarget = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.cubeCamera = new THREE.CubeCamera(0.1, 50, this.cubeTarget);

    this.uniforms = {
      uEnvMap: { value: this.cubeTarget.texture },
      uEnvMix: { value: 0 },
      // カメラ映像は自動露出で中間調に寄るため、照明として使うときに持ち上げる
      uEnvGain: { value: ENV_GAIN },
    };

    this.feedCanvas = document.createElement('canvas');
    this.feedCtx = this.feedCanvas.getContext('2d');
    this.feedTexture = new THREE.CanvasTexture(this.feedCanvas);
    this.feedTexture.colorSpace = THREE.SRGBColorSpace;

    // 見ていない方向を埋める地平線グラデーション
    this.baseScene = new THREE.Scene();
    this.baseScene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(10, 32, 16),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          depthWrite: false,
          vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
              vDir = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
              float y = normalize(vDir).y;
              gl_FragColor = vec4(mix(vec3(0.08, 0.075, 0.07), vec3(0.32, 0.34, 0.37), smoothstep(-0.2, 0.4, y)), 1.0);
            }
          `,
        }),
      ),
    );

    // カメラ映像を、撮影時のカメラの向きで球面に投影する
    this.projectorUniforms = {
      uFeed: { value: this.feedTexture },
      uViewProj: { value: new THREE.Matrix4() },
      uBlend: { value: BLEND },
      uLinearize: { value: 0 },
    };
    this.captureScene = new THREE.Scene();
    this.captureScene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(10, 48, 24),
        new THREE.ShaderMaterial({
          uniforms: this.projectorUniforms,
          side: THREE.BackSide,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
              vDir = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            uniform sampler2D uFeed;
            uniform mat4 uViewProj;
            uniform float uBlend;
            uniform float uLinearize;
            varying vec3 vDir;
            void main() {
              vec4 clip = uViewProj * vec4(normalize(vDir), 1.0);
              if (clip.w <= 0.0) discard;
              vec2 ndc = clip.xy / clip.w;
              float edge = max(abs(ndc.x), abs(ndc.y));
              if (edge > 1.0) discard;
              vec3 c = texture2D(uFeed, ndc * 0.5 + 0.5).rgb;
              c = mix(c, pow(c, vec3(2.2)), uLinearize);
              gl_FragColor = vec4(c, uBlend * (1.0 - smoothstep(0.75, 1.0, edge)));
            }
          `,
        }),
      ),
    );

    this._viewRot = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._dir = new THREE.Vector3();

    // Android WebXR の光源推定（セッション開始前に作っておく必要がある）
    this.xrLight = new XREstimatedLight(renderer);
    this.xrLight.directionalLight.visible = false;
    this.xrEstimating = false;
    this.xrLight.addEventListener('estimationstart', () => {
      this.xrEstimating = true;
      scene.add(this.xrLight);
      if (this.xrLight.environment) {
        scene.environment = this.xrLight.environment;
        scene.environmentIntensity = 1.0;
      }
    });
    this.xrLight.addEventListener('estimationend', () => {
      this.xrEstimating = false;
      scene.remove(this.xrLight);
      const { sun, sunOffset } = this.stage;
      sun.color.set(0xffffff);
      sun.intensity = stage.sunIntensity;
      sun.position.copy(sun.target.position).add(sunOffset);
      this._applyEnvironment();
    });

    this._clearCube();
  }

  /** source は PeopleOcclusion と同じ形式（video / canvas / xr / null） */
  setSource(source) {
    this.source = source;
    this.captured = 0;
    this._dirty = false;
    this.uniforms.uEnvMix.value = 0;
    this._clearCube();
    this._applyEnvironment();
  }

  /** 毎フレーム、描画の直前に呼ぶ */
  update(now, frame) {
    if (this.xrEstimating) this._syncEstimatedSun();

    if (this.source && now - this._lastCapture >= CAPTURE_MS && this._prepareFeed(frame)) {
      this._lastCapture = now;
      this._capture();
      this.captured++;
      this._dirty = true;
      this.uniforms.uEnvMix.value = Math.min(1, this.captured / 6);
    }

    if (this._dirty && now - this._lastPmrem >= PMREM_MS) {
      this._lastPmrem = now;
      this._dirty = false;
      this._withoutXR(() => {
        this.envTarget = this.pmrem.fromCubemap(this.cubeTarget.texture, this.envTarget);
      });
      this._applyEnvironment();
    }
  }

  _applyEnvironment() {
    const { scene, hemi } = this.stage;
    if (this.xrEstimating && this.xrLight.environment) return;
    if (this.source && this.captured > 0 && this.envTarget) {
      scene.environment = this.envTarget.texture;
      scene.environmentIntensity = ENV_GAIN;
      hemi.intensity = 0.35;
    } else {
      scene.environment = this.defaultEnv;
      scene.environmentIntensity = DEFAULT_ENV_INTENSITY;
      hemi.intensity = DEFAULT_HEMI;
    }
  }

  _syncEstimatedSun() {
    const { sun, hemi } = this.stage;
    const dl = this.xrLight.directionalLight;
    hemi.intensity = 0.2;
    if (dl.intensity <= 0) return;
    sun.color.copy(dl.color);
    sun.intensity = Math.min(3, dl.intensity * 1.5);
    this._dir.copy(dl.position).normalize();
    if (this._dir.y < 0.2) this._dir.y = 0.2;
    sun.position.copy(sun.target.position).addScaledVector(this._dir.normalize(), 12);
  }

  _prepareFeed(frame) {
    const { kind, el } = this.source;
    if (kind === 'xr') {
      const renderer = this.stage.renderer;
      const refSpace = renderer.xr.getReferenceSpace();
      const view = frame && refSpace ? frame.getViewerPose(refSpace)?.views[0] : null;
      const tex = view?.camera ? renderer.xr.getCameraTexture(view.camera) : null;
      if (!tex) return false;
      this.projectorUniforms.uFeed.value = tex;
      this.projectorUniforms.uLinearize.value = 1;
      return true;
    }

    const w = FEED_WIDTH;
    const h = Math.max(1, Math.round((FEED_WIDTH * window.innerHeight) / Math.max(1, window.innerWidth)));
    if (this.feedCanvas.width !== w || this.feedCanvas.height !== h) {
      this.feedCanvas.width = w;
      this.feedCanvas.height = h;
      this.feedTexture.dispose();
    }
    if (kind === 'video') {
      const vw = el.videoWidth;
      const vh = el.videoHeight;
      if (!vw || !vh || el.readyState < 2) return false;
      const target = w / h;
      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;
      if (vw / vh > target) {
        sw = vh * target;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / target;
        sy = (vh - sh) / 2;
      }
      this.feedCtx.drawImage(el, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      if (!el.width || !el.height) return false;
      this.feedCtx.drawImage(el, 0, 0, w, h);
    }
    this.feedTexture.needsUpdate = true;
    this.projectorUniforms.uFeed.value = this.feedTexture;
    this.projectorUniforms.uLinearize.value = 0;
    return true;
  }

  _capture() {
    const cam = this.stage.camera;
    cam.updateMatrixWorld();
    cam.matrixWorld.decompose(this._dir, this._quat, new THREE.Vector3());
    // 環境は無限遠とみなし、カメラの回転だけで投影する
    this._viewRot.makeRotationFromQuaternion(this._quat).invert();
    this.projectorUniforms.uViewProj.value.multiplyMatrices(cam.projectionMatrix, this._viewRot);
    this._renderCube(this.captureScene, false);
  }

  _clearCube() {
    this._renderCube(this.baseScene, true);
  }

  _renderCube(scene, clear) {
    const renderer = this.stage.renderer;
    const autoClear = renderer.autoClear;
    const shadows = renderer.shadowMap.enabled;
    renderer.autoClear = clear;
    renderer.shadowMap.enabled = false;
    this._withoutXR(() => this.cubeCamera.update(renderer, scene));
    renderer.shadowMap.enabled = shadows;
    renderer.autoClear = autoClear;
  }

  /** XR 中は render() が XR カメラに差し替えるため、オフスクリーン描画のあいだ無効にする */
  _withoutXR(fn) {
    const xr = this.stage.renderer.xr;
    const enabled = xr.enabled;
    xr.enabled = false;
    try {
      fn();
    } finally {
      xr.enabled = enabled;
    }
  }
}
