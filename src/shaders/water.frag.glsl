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

varying vec3 vWorldPos;

vec3 unpackNormal(vec2 uv) {
  return texture2D(uNormal, uv).rgb * 2.0 - 1.0;
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

  vec3 col = albedo * (1.0 - uMetallic * 0.5) * (uAmbient + uLightColor * diff);
  col += uLightColor * specColor * spec;
  col += uSkyColor * mix(specColor, vec3(1.0), fresnel) * 0.6;
  col += uRimColor * rim;

  float alpha = clamp(uFade + fresnel * 0.35 + spec * 0.15, 0.0, 0.96);
  // 水面の端は遠方でなじませる
  alpha *= 1.0 - smoothstep(uRadius * 0.55, uRadius, length(vWorldPos.xz - uCenter));

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
