import * as THREE from 'three';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
import { WAREHOUSE } from '../content/warehouse.js';

/**
 * MindAR で防災倉庫マーカーを認識し、説明パネルを出す。
 * 既存の WebXR / 8th Wall シーンとは独立して動かす。
 */
export class WarehouseScan {
  constructor({ container, panel, hint }) {
    this.container = container;
    this.panel = panel;
    this.hint = hint;
    this.mindar = null;
    this.running = false;
    this.found = false;
    this._anchor = null;
  }

  async start() {
    if (this.running) return;
    this.found = false;
    this.panel.hidden = true;
    this.panel.classList.remove('open');
    this.hint.hidden = false;
    this.hint.textContent = '防災倉庫の「防」マークにカメラを向けてください';

    this.mindar = new MindARThree({
      container: this.container,
      imageTargetSrc: new URL(WAREHOUSE.targetSrc, document.baseURI).href,
      maxTrack: 1,
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
    });

    const { renderer, scene, camera } = this.mindar;
    const anchor = this.mindar.addAnchor(0);
    this._anchor = anchor;

    // 認識中の目印（半透明の枠）
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffb020,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
      }),
    );
    frame.position.z = 0.01;
    anchor.group.add(frame);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.position.z = 0.02;
    anchor.group.add(ring);

    const onFound = () => {
      if (this.found) return;
      this.found = true;
      this.hint.hidden = true;
      this.openPanel();
    };
    const onLost = () => {
      this.found = false;
      if (!this.panel.classList.contains('open')) this.hint.hidden = false;
    };
    anchor.onTargetFound = onFound;
    anchor.onTargetLost = onLost;

    this.container.hidden = false;
    await this.mindar.start();
    this.running = true;
    renderer.setAnimationLoop(() => {
      // コールバックが取れない環境向けの保険
      if (anchor.visible) onFound();
      else if (this.found && !this.panel.classList.contains('open')) onLost();
      renderer.render(scene, camera);
    });
  }

  openPanel() {
    this.panel.hidden = false;
    this.panel.removeAttribute('hidden');
    // 次フレームで transition を効かせる
    requestAnimationFrame(() => {
      this.panel.classList.add('open');
      // さらに1フレーム待って確実に表示
      requestAnimationFrame(() => this.panel.classList.add('open'));
    });
  }

  closePanel() {
    this.panel.classList.remove('open');
    this.panel.hidden = true;
    this.hint.hidden = false;
    this.hint.textContent = this.found
      ? 'マーカーを認識しています'
      : '防災倉庫の「防」マークにカメラを向けてください';
  }

  stop() {
    if (this.mindar) {
      try {
        this.mindar.renderer?.setAnimationLoop(null);
        this.mindar.stop();
      } catch (_) {
        /* ignore */
      }
      // MindAR が container に足した video / canvas を片付ける
      this.container.replaceChildren();
      this.mindar = null;
    }
    this._anchor = null;
    this.running = false;
    this.found = false;
    this.container.hidden = true;
    this.panel.classList.remove('open');
    this.panel.hidden = true;
    this.hint.hidden = true;
  }
}

export { WAREHOUSE };
