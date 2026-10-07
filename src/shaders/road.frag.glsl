// noise.glsl を先頭に連結して使う
uniform sampler2D uMap;
uniform vec2 uRepeat;
uniform float uCrack;
uniform vec2 uCenter;
uniform float uCellScale;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec2 uHalfSize;
uniform samplerCube uEnvMap;  // カメラ映像から作った環境キューブマップ
uniform float uEnvMix;
uniform float uEnvGain;

varying vec3 vWorldPos;
varying vec2 vUv;
varying vec2 vLocal;
varying float vDrop;

void main() {
  vec3 base = texture2D(uMap, vUv * uRepeat).rgb;
  vec2 p = vLocal - uCenter;
  float c = uCrack;
  float r = length(p);
  float jag = valueNoise(p * 9.0) - 0.5;

  // 太いひび（板の境界）
  vec4 v = voronoi(p * uCellScale);
  float crackR = mix(0.2, 3.4, smoothstep(0.0, 0.8, c));
  float reach = 1.0 - smoothstep(crackR * 0.6, crackR, r + (hash1(v.zw) - 0.5) * 0.8);
  float width = mix(0.01, 0.05, c) * reach;
  float crackMain = (1.0 - smoothstep(width * 0.4, width, v.y + jag * 0.02)) * step(0.002, width);

  // 細かいひび
  vec4 v2 = voronoi(p * uCellScale * 2.7 + 3.1);
  float reach2 = 1.0 - smoothstep(crackR * 0.35, crackR * 0.8, r);
  float mask = step(0.45, valueNoise(p * 2.5 + 7.0));
  float width2 = 0.035 * c * reach2 * mask;
  float crackFine = (1.0 - smoothstep(width2 * 0.3, width2, v2.y + jag * 0.015)) * step(0.002, width2);

  // 変位後の形状から法線を再計算（板の側面＝断面を出す）
  vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  if (dot(N, cameraPosition - vWorldPos) < 0.0) N = -N;
  float steep = 1.0 - clamp(N.y, 0.0, 1.0);

  vec3 soil = vec3(0.15, 0.105, 0.065) * (0.7 + 0.6 * valueNoise(vWorldPos.xz * 14.0 + vWorldPos.y * 9.0));
  vec3 col = base;
  col = mix(col, vec3(0.02), max(crackMain, crackFine * 0.85));
  col = mix(col, soil, smoothstep(0.3, 0.65, steep));
  col *= mix(0.06, 1.0, exp(-vDrop * 2.6));

  float diff = max(dot(N, normalize(uLightDir)), 0.0);
  // 環境光：キューブマップの低解像度ミップを拡散光の近似として使う
  vec3 envDiffuse = textureCube(uEnvMap, N, 6.0).rgb * uEnvGain;
  vec3 ambient = mix(uAmbient, envDiffuse, uEnvMix);
  vec3 lit = col * (ambient + uLightColor * diff);

  // 道路の端はディザでフェードして現実の床になじませる
  vec2 edge = uHalfSize - abs(vLocal);
  float fade = smoothstep(0.0, 0.35, min(edge.x, edge.y));
  if (fade < hash1(gl_FragCoord.xy)) discard;

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
