import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const base = import.meta.env.BASE_URL;
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
const gltfCache = new Map();
const textureCache = new Map();

export function loadGLTF(path) {
  if (!gltfCache.has(path)) gltfCache.set(path, gltfLoader.loadAsync(base + path));
  return gltfCache.get(path);
}

export function loadTexture(path, { srgb = true, repeat = true } = {}) {
  const key = `${path}|${srgb}|${repeat}`;
  if (!textureCache.has(key)) {
    textureCache.set(
      key,
      textureLoader.loadAsync(base + path).then((tex) => {
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        return tex;
      }),
    );
  }
  return textureCache.get(key);
}
