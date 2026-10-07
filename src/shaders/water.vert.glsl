// Unity: MRGTWaterSystem(Ploto)/GraphicsToolsStandardProgramCustomWater.hlsl の頂点処理を移植
uniform float uTime;
uniform float uWaveSpeed;
uniform float uWaveHeight;

varying vec3 vWorldPos;

float waveHeight(vec2 xz) {
  // Unity: sin((v.vertex.x + _Time.y * _WaveSpeed) * 2.0) * _WaveHeight
  float w = sin((xz.x + uTime * uWaveSpeed) * 2.0) * uWaveHeight;
  // 単調にならないよう斜め方向の波を少し足す
  w += sin((xz.y * 1.3 - uTime * uWaveSpeed * 0.8) * 1.7) * uWaveHeight * 0.6;
  return w;
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.y += waveHeight(world.xz);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
