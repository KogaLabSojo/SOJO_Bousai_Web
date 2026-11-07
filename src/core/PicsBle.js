/**
 * 高度化PICS（BLE manufacturer 0x01CE）の受信とデモ発生。
 * 解析仕様は ble-pics-viewer (yumu19) に合わせる。
 */
import { KENGUN } from '../content/kengun.js';

export const MANUFACTURER_ID = 0x01ce;

const SIGNAL_STATES = ['NoSignal', 'Red', 'BlinkGreen', 'Green', 'None'];
export const SIGNAL_LABELS = {
  NoSignal: '信号なし',
  Red: '赤',
  BlinkGreen: '青点滅',
  Green: '青',
  None: '対象なし',
  Unknown: '不明',
};

export function processPics(data) {
  const bytes = toBytes(data);
  if (bytes.length < 10) throw new RangeError('PICSヘッダーが短すぎます');
  const type = bytes[2];
  const minimumLength = { 0: 24, 1: 18, 2: 11 }[type] ?? 10;
  if (bytes.length < minimumLength) throw new RangeError(`Type ${type} が短すぎます`);
  const info = {
    messageType: type,
    messageId: bytes[3],
    intersectionId: hexDump(bytes.subarray(6, 10)).replaceAll(' ', ''),
  };
  if (type === 0) {
    info.identifier = new TextDecoder()
      .decode(bytes.subarray(10, 24))
      .replaceAll('\uFFFD', '')
      .replace(/^\0+|\0+$/g, '');
  } else if (type === 1) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    info.latitude = view.getInt32(10, false) / 1_000_000;
    info.longitude = view.getInt32(14, false) / 1_000_000;
  } else if (type === 2) {
    info.signals = Array.from(bytes.subarray(10, Math.min(16, bytes.length)), (byte) => ({
      remaining: (byte >> 4) >= 8 ? -1 : (byte >> 4) + 1,
      state: SIGNAL_STATES[byte & 0x0f] ?? 'Unknown',
    }));
  }
  return info;
}

function toBytes(data) {
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('ArrayBuffer required');
}

function hexDump(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/**
 * 歩行者信号の代表値を1本にまとめる（東西・南北の先頭有効灯）。
 * remaining は PICS の符号化値（秒と断定しない）だが、デモ／表示では秒として扱う。
 */
export function pickPrimarySignal(signals = []) {
  const preferred = signals.find((s) => s.state === 'Red' || s.state === 'Green' || s.state === 'BlinkGreen');
  return preferred || signals[0] || { state: 'Unknown', remaining: -1 };
}

export class PicsSource {
  constructor() {
    this.mode = 'idle'; // 'demo' | 'ble' | 'idle'
    this.listeners = new Set();
    this._demoTimer = 0;
    this._demoT0 = 0;
    this._scan = null;
    this._abort = null;
    this.last = null;
    this.status = '';
  }

  onUpdate(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(payload) {
    this.last = payload;
    for (const fn of this.listeners) fn(payload);
  }

  /** 典型サイクルで灯色と残秒をシミュレート */
  startDemo() {
    this.stop();
    this.mode = 'demo';
    this.status = 'デモ（合成信号）';
    this._demoT0 = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - this._demoT0) / 1000;
      const cycle = KENGUN.demoCycle;
      let t = elapsed % cycle.reduce((a, p) => a + p.remaining, 0);
      let phase = cycle[0];
      for (const p of cycle) {
        if (t < p.remaining) {
          phase = p;
          break;
        }
        t -= p.remaining;
      }
      const remaining = Math.max(1, Math.ceil(phase.remaining - t));
      this._emit({
        source: 'demo',
        intersectionName: KENGUN.intersectionName,
        state: phase.state,
        remaining,
        remainingNote: 'demo',
        signals: [
          { state: phase.state, remaining },
          { state: phase.state === 'Red' ? 'Green' : 'Red', remaining },
        ],
        updatedAt: Date.now(),
      });
    };
    tick();
    this._demoTimer = setInterval(tick, 200);
  }

  static bleAvailable() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth?.requestLEScan;
  }

  static watchAvailable() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth?.requestDevice;
  }

  async startBleScan() {
    if (!PicsSource.bleAvailable()) throw new Error('この端末では BLE 全体スキャンに対応していません');
    this.stop();
    this.mode = 'ble';
    this.status = 'PICS を受信中…';
    this._abort = new AbortController();
    this._scan = await navigator.bluetooth.requestLEScan({
      acceptAllAdvertisements: true,
      keepRepeatedDevices: true,
    });
    const onAdv = (event) => {
      try {
        const md = event.manufacturerData?.get(MANUFACTURER_ID);
        if (!md) return;
        const info = processPics(md);
        if (info.messageType !== 2 || !info.signals) return;
        const primary = pickPrimarySignal(info.signals);
        this._emit({
          source: 'ble',
          intersectionId: info.intersectionId,
          intersectionName: KENGUN.intersectionName,
          state: primary.state,
          remaining: primary.remaining,
          remainingNote: primary.remaining < 0 ? 'unknown' : 'pics',
          signals: info.signals,
          rssi: event.rssi,
          updatedAt: Date.now(),
        });
      } catch (_) {
        /* ignore bad packets */
      }
    };
    navigator.bluetooth.addEventListener('advertisementreceived', onAdv);
    this._onAdv = onAdv;
    this.status = 'PICS スキャン中（0x01CE）';
  }

  /** デバイス選択 → watchAdvertisements（全体スキャンが使えないとき） */
  async startBleWatch() {
    if (!navigator.bluetooth?.requestDevice) throw new Error('Web Bluetooth 非対応');
    this.stop();
    this.mode = 'ble';
    this.status = 'デバイスを選択…';
    this._abort = new AbortController();
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ manufacturerData: [{ companyIdentifier: MANUFACTURER_ID }] }],
      optionalManufacturerData: [MANUFACTURER_ID],
    });
    if (!device.watchAdvertisements) throw new Error('watchAdvertisements 非対応');
    await device.watchAdvertisements({ signal: this._abort.signal });
    const onAdv = (event) => {
      try {
        const md = event.manufacturerData?.get(MANUFACTURER_ID);
        if (!md) return;
        const info = processPics(md);
        if (info.messageType !== 2 || !info.signals) return;
        const primary = pickPrimarySignal(info.signals);
        this._emit({
          source: 'ble',
          intersectionId: info.intersectionId,
          intersectionName: KENGUN.intersectionName,
          state: primary.state,
          remaining: primary.remaining,
          remainingNote: primary.remaining < 0 ? 'unknown' : 'pics',
          signals: info.signals,
          updatedAt: Date.now(),
        });
      } catch (_) {
        /* ignore */
      }
    };
    device.addEventListener('advertisementreceived', onAdv);
    this._watchDevice = device;
    this._onAdv = onAdv;
    this.status = `監視中: ${device.name || 'PICS'}`;
  }

  stop() {
    clearInterval(this._demoTimer);
    this._demoTimer = 0;
    try {
      this._scan?.stop?.();
    } catch (_) {
      /* ignore */
    }
    this._scan = null;
    try {
      this._abort?.abort();
    } catch (_) {
      /* ignore */
    }
    this._abort = null;
    if (this._onAdv && navigator.bluetooth) {
      navigator.bluetooth.removeEventListener('advertisementreceived', this._onAdv);
    }
    if (this._watchDevice && this._onAdv) {
      this._watchDevice.removeEventListener('advertisementreceived', this._onAdv);
    }
    this._watchDevice = null;
    this._onAdv = null;
    this.mode = 'idle';
    this.status = '';
  }
}
