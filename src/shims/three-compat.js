/**
 * mind-ar@1.2.5 が three の廃止定数 sRGBEncoding を import するため、
 * 現行 three に再エクスポートして足す。
 * （vite の alias で three → このファイル、になるので実体は three.module.js を直接指す）
 */
export * from '../../node_modules/three/build/three.module.js';
export { SRGBColorSpace as sRGBEncoding } from '../../node_modules/three/build/three.module.js';
