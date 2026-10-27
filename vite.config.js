import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const root = path.dirname(fileURLToPath(import.meta.url));
// WebXR / カメラ / ジャイロはすべて HTTPS 必須なので、開発サーバーも自己署名証明書で起動する。
// トンネル (ngrok 等) で HTTPS 化する場合は HTTPS=0 で HTTP 起動できる。
const useHttps = process.env.HTTPS !== '0';

export default defineConfig({
  base: './',
  plugins: useHttps ? [basicSsl()] : [],
  server: { host: true },
  preview: { host: true },
  resolve: {
    // mind-ar が廃止された sRGBEncoding を要求するため、互換シム経由にする
    // three/addons/* は壊さないよう、パッケージ名そのものだけ差し替える
    alias: [
      {
        find: /^three$/,
        replacement: path.resolve(root, 'src/shims/three-compat.js'),
      },
    ],
  },
  optimizeDeps: {
    include: ['mind-ar/dist/mindar-image-three.prod.js'],
    exclude: [],
  },
  build: {
    chunkSizeWarningLimit: 1500,
    commonjsOptions: { transformMixedEsModules: true },
  },
});
