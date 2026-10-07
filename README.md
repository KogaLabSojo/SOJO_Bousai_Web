# 防災 WebAR

Unity 版（[KogaLabSojo/preparedness](https://github.com/KogaLabSojo/preparedness)）の災害AR体験を、アプリのインストールなしでブラウザから体験できるようにした WebAR 版です。

公開URL: <https://kogalabsojo.github.io/SOJO_Bousai_Web/>

| 体験 | 内容 | Unity 版の対応 |
| --- | --- | --- |
| ブロック塀の倒壊 | 地震で塀が根元から倒れ、ブロックが物理演算で崩れ散る | `Block.unity` / `b.fbx` |
| 洪水・浸水 | 足首〜頭上まで水位が実寸で上がる。泥水シェーダーを GLSL で移植 | `water.unity` / `FloodExperienceController` / `WaterSurfaceShader` |
| 路面の陥没・崩壊 | 長押しでひびが広がり、路面が陥没する（GLSL で変形） | `road.unity` / `CrackDamageController` |
| 電柱の倒壊 | 電柱が電線に引かれて連鎖的に倒れる | `dentyu broken.unity` / `Pole2.fbx` / `PoleFallController` |

## 対応端末

- **Android (Chrome)**: WebXR で床を検出し、タップした方向に配置。歩いて回り込める（6DoF）。
- **iPhone (Safari) など WebXR 非対応端末**: 背面カメラ映像にジャイロで向きを合わせた 3D を重ねる簡易AR（3DoF）。床は目の高さの下と仮定。
- **PC**: カメラ映像（なければ背景色）＋ドラッグで見回し。動作確認用。

カメラ・ジャイロ・WebXR はいずれも **HTTPS が必須**です。

## 開発

```bash
npm install
npm run dev
```

自己署名証明書つきの HTTPS で起動します。スマホからは同じ Wi-Fi で `https://<PCのIP>:5173/` を開き、証明書の警告を許可してください。

ngrok や Cloudflare Tunnel などで HTTPS 化する場合は、HTTP で起動できます。

```bash
HTTPS=0 npm run dev      # PowerShell: $env:HTTPS="0"; npm run dev
```

## 公開（GitHub Pages）

`main` ブランチに push すると、GitHub Actions（`.github/workflows/deploy.yml`）がビルドして GitHub Pages にデプロイします。

初回だけ、リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にしてください。Actions タブの「Deploy to GitHub Pages」から手動実行もできます。

GitHub Pages は HTTPS で配信されるので、スマホで上のURLを開けばそのまま体験できます（証明書の設定は不要）。ローカルで本番ビルドを確認する場合は次のとおりです。

```bash
npm run build
npm run preview
```

## アセットの再変換

モデルとテクスチャは Unity プロジェクトから Blender で変換しています（glb 化、テクスチャを 1024px に縮小）。Unity 版リポジトリ `preparedness` をこのリポジトリと同じ階層に置いて実行します（別の場所なら環境変数 `PREPAREDNESS_UNITY_ASSETS` に Assets フォルダのパスを指定）。

```bash
blender -b --factory-startup -P tools/convert_assets.py
```

出力先は `public/models/` と `public/textures/` です。

## 構成

```
src/
  main.js                  メニュー・AR開始・配置・HUD
  core/Stage.js            three.js の描画・ライト・影
  core/XRController.js     WebXR (immersive-ar + hit-test)
  core/FallbackController.js  カメラ映像 + ジャイロの簡易AR
  core/AudioFX.js          効果音（Web Audio で合成）
  scenarios/*.js           各災害シナリオ
  shaders/*.glsl           水面・路面のシェーダー
```
