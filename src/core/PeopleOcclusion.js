import * as THREE from 'three';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const INPUT_WIDTH = 160;
const INTERVAL_MS = 33;
const SMOOTHING = 0.45;

/**
 * 人物（手・体）のオクルージョン。
 * カメラ映像を MediaPipe で人物セグメンテーションし、人物の部分だけ 3D 描画を透明に抜いて、
 * 下にあるカメラ映像（video / 8th Wall キャンバス / WebXR のパススルー）を見せる。
 * 奥行きは取れないため、人物は常に CG より手前にあるものとして扱う。
 */
export class PeopleOcclusion {
  constructor(stage) {
    this.stage = stage;
    this.enabled = true;
    this.segmenter = null;
    this.source = null;
    this._initPromise = null;
    this._lastRun = 0;
    this._width = 0;
    this._height = 0;

    this.input = document.createElement('canvas');
    this.inputCtx = this.input.getContext('2d', { willReadFrequently: true });

    this.texture = this._createTexture(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMask: { value: this.texture } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMask;
        varying vec2 vUv;
        void main() {
          float m = texture2D(uMask, vec2(vUv.x, 1.0 - vUv.y)).r;
          gl_FragColor = vec4(0.0, 0.0, 0.0, smoothstep(0.35, 0.75, m));
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // dst = dst * (1 - mask)：プリマルチプライドアルファのキャンバスを人物の形に抜く
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1e9;
    this.mesh.visible = false;
    stage.scene.add(this.mesh);

    // WebXR のカメラ画像を CPU に読み出すための作業用
    this.xrTarget = null;
    this.xrPixels = null;
    this.xrCopyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.xrCopyMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.xrCopyScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.xrCopyMaterial);
    quad.frustumCulled = false;
    this.xrCopyScene.add(quad);
  }

  get active() {
    return this.enabled && !!this.source && !!this.segmenter;
  }

  /**
   * source: { kind: 'video', el } … object-fit: cover で全画面表示している video
   *         { kind: 'canvas', el } … 全画面に描画済みのカメラ映像キャンバス
   *         { kind: 'xr' }         … WebXR camera-access
   *         null                   … 停止
   */
  setSource(source) {
    this.source = source;
    this._clearMask();
    this.mesh.visible = false;
    if (source) this.init().catch(() => {});
  }

  init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      try {
        this.segmenter = await ImageSegmenter.createFromOptions(fileset, options('GPU'));
      } catch (err) {
        console.warn('GPU でのセグメンテーションに失敗。CPU で再試行します', err);
        this.segmenter = await ImageSegmenter.createFromOptions(fileset, options('CPU'));
      }
    })().catch((err) => {
      console.warn('人物オクルージョンを初期化できませんでした', err);
      this._initPromise = null;
      throw err;
    });
    return this._initPromise;
  }

  /** 毎フレーム、描画の直前に呼ぶ。WebXR のときは frame を渡す */
  update(now, frame) {
    const on = this.active;
    this.mesh.visible = on;
    if (!on || now - this._lastRun < INTERVAL_MS) return;

    const ok = this.source.kind === 'xr' ? this._captureXR(frame) : this._captureDom();
    if (!ok) return;
    this._lastRun = now;

    try {
      this.segmenter.segmentForVideo(this.input, now, (result) => {
        const mask = result.confidenceMasks?.[0];
        if (mask) this._applyMask(mask.getAsFloat32Array(), mask.width, mask.height);
      });
    } catch (err) {
      console.warn(err);
    }
  }

  _inputSize() {
    const aspect = window.innerHeight / Math.max(1, window.innerWidth);
    const w = INPUT_WIDTH;
    const h = Math.max(1, Math.round(INPUT_WIDTH * aspect));
    if (this.input.width !== w || this.input.height !== h) {
      this.input.width = w;
      this.input.height = h;
    }
    return [w, h];
  }

  _captureDom() {
    const { kind, el } = this.source;
    const [w, h] = this._inputSize();
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
      this.inputCtx.drawImage(el, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      if (!el.width || !el.height) return false;
      this.inputCtx.drawImage(el, 0, 0, w, h);
    }
    return true;
  }

  _captureXR(frame) {
    const renderer = this.stage.renderer;
    const refSpace = renderer.xr.getReferenceSpace();
    const view = frame && refSpace ? frame.getViewerPose(refSpace)?.views[0] : null;
    const cameraTexture = view?.camera ? renderer.xr.getCameraTexture(view.camera) : null;
    if (!cameraTexture) return false;

    const [w, h] = this._inputSize();
    if (!this.xrTarget || this.xrTarget.width !== w || this.xrTarget.height !== h) {
      this.xrTarget?.dispose();
      this.xrTarget = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
      this.xrPixels = new Uint8Array(w * h * 4);
      this.xrImage = new ImageData(w, h);
    }
    this.xrCopyMaterial.map = cameraTexture;
    this.xrCopyMaterial.needsUpdate = true;

    // XR 中は render() がカメラを XR カメラに差し替えるので、一時的に無効にしてコピーする
    const prevTarget = renderer.getRenderTarget();
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.xrTarget);
    renderer.render(this.xrCopyScene, this.xrCopyCamera);
    renderer.readRenderTargetPixels(this.xrTarget, 0, 0, w, h, this.xrPixels);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = true;

    // readPixels は下の行から並ぶので上下を反転して canvas に書く
    const row = w * 4;
    const dst = this.xrImage.data;
    for (let y = 0; y < h; y++) {
      dst.set(this.xrPixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    this.inputCtx.putImageData(this.xrImage, 0, 0);
    return true;
  }

  _applyMask(values, width, height) {
    if (width !== this._width || height !== this._height) {
      this._width = width;
      this._height = height;
      this.texture.dispose();
      this.texture = this._createTexture(width, height);
      this.material.uniforms.uMask.value = this.texture;
    }
    const data = this.texture.image.data;
    for (let i = 0; i < data.length; i++) {
      const v = values[i] * 255;
      data[i] = data[i] * SMOOTHING + v * (1 - SMOOTHING);
    }
    this.texture.needsUpdate = true;
  }

  _clearMask() {
    this.texture.image.data.fill(0);
    this.texture.needsUpdate = true;
  }

  _createTexture(width, height) {
    const tex = new THREE.DataTexture(new Uint8Array(width * height), width, height, THREE.RedFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
}
