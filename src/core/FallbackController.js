import * as THREE from 'three';

const DEG = Math.PI / 180;
// スマホ背面カメラの長辺方向の画角（機種差はあるが概ね 60〜70°）
const CAMERA_LONG_SIDE_FOV = 65;

/**
 * WebXR が使えない端末（iPhone Safari など）向けの簡易AR。
 * 背面カメラ映像の上に、ジャイロで向きを合わせた 3D を重ねる (3DoF)。
 * 床は「目の高さ eyeHeight だけ下」と仮定する。
 */
export class FallbackController {
  /** iOS 13+ はジャイロの許可が必要。ユーザー操作のハンドラ内で最初に呼ぶこと */
  static async requestOrientationPermission() {
    const request = async (Evt) => {
      if (!Evt || typeof Evt.requestPermission !== 'function') return true;
      try {
        return (await Evt.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    };
    // 2 つ目の要求もユーザー操作として扱われるよう、await せずに同時に出す
    const [orientation] = await Promise.all([
      request(window.DeviceOrientationEvent),
      request(window.DeviceMotionEvent),
    ]);
    return orientation;
  }

  constructor(stage, video) {
    this.stage = stage;
    this.video = video;
    this.eyeHeight = 1.5;
    this.stream = null;
    this.orientation = null;
    this.hasCamera = false;

    this.targetQuat = new THREE.Quaternion();
    this.yaw = 0;
    this.pitch = -0.25;
    this.dragging = false;
    this.shake = 0;

    this._onOrientation = (e) => {
      if (e.alpha == null && e.beta == null) return;
      this.orientation = e;
    };
    this._onPointerDown = (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    this._onPointerMove = (e) => {
      if (!this.dragging || this.orientation) return;
      this.yaw -= (e.clientX - this.lastX) * 0.004;
      this.pitch -= (e.clientY - this.lastY) * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.4, 1.4);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    this._onPointerUp = () => (this.dragging = false);
  }

  async start() {
    const cam = this.stage.camera;
    cam.position.set(0, this.eyeHeight, 0);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    window.addEventListener('deviceorientation', this._onOrientation);
    const canvas = this.stage.renderer.domElement;
    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.hasCamera = true;
      document.body.classList.add('camera-on');
    } catch (err) {
      console.warn('カメラを使用できません', err);
      this.hasCamera = false;
      document.body.classList.add('no-camera');
      this.stage.grid.visible = true;
    }
  }

  update(dt) {
    const cam = this.stage.camera;
    if (this.orientation) {
      this._quatFromOrientation(this.orientation, this.targetQuat);
      cam.quaternion.slerp(this.targetQuat, Math.min(1, dt * 20));
    } else {
      cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    }

    cam.position.set(0, this.eyeHeight, 0);
    if (this.shake > 0) {
      const s = this.shake;
      cam.position.x += (Math.random() - 0.5) * 0.04 * s;
      cam.position.y += (Math.random() - 0.5) * 0.03 * s;
    }
    this._updateFov();
  }

  stop() {
    window.removeEventListener('deviceorientation', this._onOrientation);
    const canvas = this.stage.renderer.domElement;
    canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.orientation = null;
    document.body.classList.remove('camera-on', 'no-camera');
    this.stage.grid.visible = false;
  }

  _quatFromOrientation(e, out) {
    const alpha = (e.alpha || 0) * DEG;
    const beta = (e.beta || 0) * DEG;
    const gamma = (e.gamma || 0) * DEG;
    const orient = (screen.orientation?.angle ?? window.orientation ?? 0) * DEG;
    const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ');
    out.setFromEuler(euler);
    out.multiply(new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2));
    out.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient));
    return out;
  }

  /** object-fit: cover で表示されたカメラ映像と 3D の画角を合わせる */
  _updateFov() {
    const cam = this.stage.camera;
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    let fov = 60;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (this.hasCamera && vw && vh) {
      const long = Math.tan((CAMERA_LONG_SIDE_FOV * DEG) / 2);
      const halfV = vh >= vw ? long : long * (vh / vw);
      const scale = Math.max(sw / vw, sh / vh);
      const visible = sh / (vh * scale);
      fov = (2 * Math.atan(halfV * visible)) / DEG;
    }
    if (Math.abs(cam.fov - fov) > 0.01 || Math.abs(cam.aspect - sw / sh) > 0.001) {
      cam.fov = fov;
      cam.aspect = sw / sh;
      cam.updateProjectionMatrix();
    }
  }
}
