// Unity: Water.mat (Custom/WaterSurfaceWithOcclusion) の見た目を移植
uniform float uTime;
uniform float uWaveSpeed;
uniform float uWaveHeight;
uniform vec2 uTexSpeed;      // _WaveTexSpeed (x: v方向, y: u方向)
uniform float uTiling;       // 1m あたりのタイル数
uniform sampler2D uAlbedo;   // _MainTex
uniform sampler2D uNormal;   // _NormalMap
uniform vec3 uColor;         // _Color（泥水の色）
uniform float uMetallic;     // _Metallic
uniform float uSmoothness;   // _Smoothness
uniform vec3 uRimColor;      // _RimColor
uniform float uRimPower;     // _RimPower
uniform float uFade;         // _Fade（不透明度）
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uSkyColor;
uniform vec2 uCenter;
uniform float uRadius;
uniform samplerCube uEnvMap;  // カメラ映像から作った環境キューブマップ
uniform float uEnvMix;
uniform float uEnvGain;
uniform float uRain;          // 雨の強さ 0..1（雨粒の波紋）
uniform float uWake;          // 体験者の足もとの白波 0..1

varying vec3 vWorldPos;

vec3 unpackNormal(vec2 uv) {
  return texture2D(uNormal, uv).rgb * 2.0 - 1.0;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 雨粒の波紋による法線の傾き。セルごとにランダムな位置・タイミングで輪が広がる
vec2 rainRipples(vec2 p, float t) {
  vec2 q = p * 3.0;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  vec2 n = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      float h = hash12(c);
      vec2 d = vec2(float(i), float(j)) + vec2(hash12(c + 3.1), hash12(c + 7.7)) - f;
      float ph = fract(t * (0.8 + h * 0.6) + h);
      float r = length(d);
      float x = clamp((r - ph) * 28.0, -3.1416, 3.1416);
      float w = sin(x) * (1.0 - ph) * (1.0 - ph) * step(hash12(c + floor(t * (0.8 + h * 0.6) + h)), uRain);
      n += d / max(r, 1e-3) * w;
    }
  }
  return n;
}

void main() {
  vec2 uv = vWorldPos.xz * uTiling;
  // Unity: uv.y += _Time.y * _WaveSpeed * 0.1 * _WaveTexSpeed.x; uv.x += _Time.x * ... (_Time.x = t/20)
  vec2 flowA = uv + vec2(uTime / 20.0 * uWaveSpeed * 0.1 * uTexSpeed.y, uTime * uWaveSpeed * 0.1 * uTexSpeed.x);
  vec2 flowB = uv * 1.7 + vec2(-uTime * 0.045, uTime * 0.11);

  // 2枚の法線を whiteout ブレンド
  vec3 nA = unpackNormal(flowA);
  vec3 nB = unpackNormal(flowB);
  vec3 nT = normalize(vec3(nA.xy + nB.xy, nA.z * nB.z));

  // 頂点の sin 波の傾きを解析的に求めて法線へ
  float dx = cos((vWorldPos.x + uTime * uWaveSpeed) * 2.0) * 2.0 * uWaveHeight;
  float dz = cos((vWorldPos.z * 1.3 - uTime * uWaveSpeed * 0.8) * 1.7) * 1.7 * 1.3 * uWaveHeight * 0.6;
  vec3 N = normalize(vec3(-dx, 1.0, -dz) + vec3(nT.x, 0.0, nT.y) * 0.55);

  // 足もと: 水は +Z 方向へ流れるので、下流側に引き伸ばした波紋と泡を立てる
  vec2 bd = vWorldPos.xz - uCenter;
  bd.y *= bd.y > 0.0 ? 0.35 : 1.0;
  float bdist = length(bd);
  float wakeWave = sin(bdist * 30.0 - uTime * 7.0) * exp(-bdist * 3.0) * uWake;
  N = normalize(N + vec3(bd.x, 0.0, bd.y) / max(bdist, 1e-3) * wakeWave * 0.35);

  if (uRain > 0.001) {
    vec2 rn = rainRipples(vWorldPos.xz, uTime);
    N = normalize(N + vec3(rn.x, 0.0, rn.y) * 0.5);
  }

  vec3 V = normalize(cameraPosition - vWorldPos);
  if (!gl_FrontFacing) N = -N;
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  float NdotV = max(dot(N, V), 0.0);

  vec3 albedo = texture2D(uAlbedo, flowA).rgb * uColor;
  vec3 specColor = mix(vec3(0.04), albedo, uMetallic);

  float diff = max(dot(N, L), 0.0);
  float shininess = exp2(10.0 * uSmoothness + 1.0);
  float spec = pow(max(dot(N, H), 0.0), shininess) * (shininess + 8.0) / 25.0;
  float fresnel = pow(1.0 - NdotV, 5.0);
  float rim = pow(1.0 - NdotV, uRimPower);

  // 周囲の映り込みと環境光（環境マップがまだ無いときは固定色）
  vec3 R = reflect(-V, N);
  vec3 reflection = mix(uSkyColor, textureCube(uEnvMap, R, (1.0 - uSmoothness) * 6.0).rgb * uEnvGain, uEnvMix);
  vec3 ambient = mix(uAmbient, textureCube(uEnvMap, N, 6.0).rgb * uEnvGain, uEnvMix);

  vec3 col = albedo * (1.0 - uMetallic * 0.5) * (ambient + uLightColor * diff);
  col += uLightColor * specColor * spec;
  col += reflection * mix(specColor, vec3(1.0), fresnel) * 0.6;
  col += uRimColor * rim;

  float foamNoise = texture2D(uAlbedo, vWorldPos.xz * 2.3 + vec2(0.0, -uTime * 0.6)).r;
  float foam = smoothstep(0.5, 0.15, bdist) * smoothstep(0.25, 0.6, foamNoise + 0.25 * sin(bdist * 30.0 - uTime * 7.0)) * uWake;
  col = mix(col, ambient * 1.1 + uLightColor * diff * 0.6, foam * 0.8);

  float alpha = clamp(uFade + fresnel * 0.35 + spec * 0.15 + foam * 0.4, 0.0, 0.96);
  // 水面の端は遠方でなじませる
  alpha *= 1.0 - smoothstep(uRadius * 0.55, uRadius, length(vWorldPos.xz - uCenter));

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
