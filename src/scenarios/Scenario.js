import * as THREE from 'three';

/**
 * 災害シナリオの基底クラス。
 * root は Stage.anchor の子になり、ローカル座標で y=0 が床、+Z が体験者の方向。
 */
export class Scenario {
  static id = '';
  static title = '';
  /** 基準点を体験者の何 m 先に置くか */
  static placeDistance = 2.5;
  static placeHint = '床にスマホを向けて、リングが出たらタップして配置します。';

  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.elapsed = 0;
  }

  async load() {}

  /** 体験中に表示する説明文 */
  get hint() {
    return '';
  }

  /** シナリオ固有のボタン [{ id, label, primary?, active? }] */
  get actions() {
    return [];
  }

  /** スライダー { label, min, max, step, value, format(v) } または null */
  get slider() {
    return null;
  }

  onAction(_id) {}
  onSlider(_value) {}
  onPressStart() {}
  onPressEnd() {}
  reset() {}

  /** info: { cameraLocal: Vector3 (root 座標系でのカメラ位置), eyeHeight } */
  update(_dt, _info) {}

  /** 上部に出すステータス (HTML) */
  status(_info) {
    return '';
  }

  dispose() {
    this.root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose();
      }
    });
    this.root.removeFromParent();
  }
}

export function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
