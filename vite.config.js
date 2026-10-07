import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// WebXR / カメラ / ジャイロはすべて HTTPS 必須なので、開発サーバーも自己署名証明書で起動する。
// トンネル (ngrok 等) で HTTPS 化する場合は HTTPS=0 で HTTP 起動できる。
const useHttps = process.env.HTTPS !== '0';

export default defineConfig({
  base: './',
  plugins: useHttps ? [basicSsl()] : [],
  server: { host: true },
  preview: { host: true },
  build: { chunkSizeWarningLimit: 1500 },
});
