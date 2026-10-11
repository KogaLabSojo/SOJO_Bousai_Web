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
- **iPhone (Safari) など WebXR 非対応のスマホ**: [8th Wall Engine](https://github.com/8thwall/engine) の SLAM で 6DoF。開始時の端末の高さを 1.5 m とみなしてスケールを決め、床に出るリングをタップして配置する。
- **8th Wall が使えない環境**: 背面カメラ映像にジャイロで向きを合わせた 3D を重ねる簡易AR（3DoF）。
- **PC**: カメラ映像（なければ背景色）＋ドラッグで見回し。動作確認用。

URL に `?ar=8thwall`（Android でも 8th Wall を使う）や `?ar=gyro`（簡易ARを使う）を付けると、モードを強制できます。

カメラ・ジャイロ・WebXR はいずれも **HTTPS が必須**です。

### 人物のオクルージョン

MediaPipe の人物セグメンテーション（selfie_segmenter）で、カメラに映った手や人を CG より手前に表示します。8th Wall・簡易AR・Android WebXR（`camera-access` が使える場合）で有効で、HUD の「人物の遮蔽」で ON/OFF できます。奥行きは推定していないため、人物は常に CG の手前として扱います。

### IBL（環境光・映り込み）

カメラ映像を撮影時の向きで球面に投影してキューブマップに蓄積し、PMREM にかけて `scene.environment` にしています。見回すほど周囲の環境が埋まり、ブロック・電柱などの PBR マテリアルと、水面・路面の GLSL シェーダーの環境光・映り込みに使われます。Android WebXR で `light-estimation` が使えるときは、ARCore の HDR 環境マップと主光源の向きを優先します。

### 配置（床・壁）

Android WebXR では床だけでなく壁も検出し、リングの色で区別します（床：オレンジ、壁：水色）。ブロック塀は壁をタップすると、その壁に沿って建ちます。配置後は HUD の「位置調整」で回転（15°ずつ）と前後移動（25 cm ずつ）ができます。

### ハザードマップ連携

メニューの「この場所の浸水想定を調べる」で現在地を取得し、[ハザードマップポータルサイト](https://disaportal.gsi.go.jp/) の重ねるハザードマップ（洪水・高潮・津波の想定浸水深タイル、ズーム 17）から、その地点の色を凡例と照合して想定浸水深を求めます。洪水シナリオに「📍 この場所」ボタンが追加され、想定の最大値まで水位が上がります（5 m 以上は 5 m で表示）。位置情報は端末内でタイルの座標計算に使うだけで、外部に送信するのは地図タイルの取得のみです。

### 演出

- ブロック塀：揺れの間に目地のモルタルが落ち、倒壊時に根元から粉じん、ブロックの着地点で粉じんと破片
- 電柱：根元のコンクリート片、倒れ始めと着地時に腕金で火花（点光源の閃光と放電音）、着地後もしばらく電線がショート
- 路面：ひびが走るたびに砂ぼこりと小石、陥没時は縁が崩れて穴に落ちる破片と立ちのぼる土煙
- 洪水：「大雨にする」で雨・雨音・水面の波紋・雨粒の跳ね返り。水が足首〜目線の間にあるときは足もとに下流側へ伸びる白波と、歩くと水しぶき

### 8th Wall Engine のライセンス

6DoF トラッキングには Niantic Spatial, Inc. の 8th Wall Engine（Distributed Engine Binary）を jsDelivr から読み込んで使っています。エンジンは © Niantic Spatial, Inc. の著作物で、[8th Wall Engine License Agreement](https://github.com/8thwall/engine/blob/main/LICENSE) に従います（無保証。改変・リバースエンジニアリング禁止）。

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
  core/EnvironmentLighting.js  カメラ映像・光源推定からの IBL
  core/XRController.js     WebXR (immersive-ar + hit-test)
  core/SlamController.js   8th Wall Engine の SLAM（WebXR 非対応スマホの 6DoF）
  core/FallbackController.js  カメラ映像 + ジャイロの簡易AR
  core/PeopleOcclusion.js  MediaPipe による人物オクルージョン
  core/HazardMap.js        ハザードマップの想定浸水深タイルの照会
  core/Effects.js          粉じん・破片・雨・火花の演出
  core/AudioFX.js          効果音（Web Audio で合成）
  scenarios/*.js           各災害シナリオ
  shaders/*.glsl           水面・路面のシェーダー
```
