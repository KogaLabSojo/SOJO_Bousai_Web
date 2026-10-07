// noise.glsl を先頭に連結して使う
uniform float uCrack;      // 0..1 損傷度（Unity: CrackDamageController.crackStrength）
uniform vec2 uCenter;      // 陥没の中心（道路ローカル xz）
uniform float uCellScale;

varying vec3 vWorldPos;
varying vec2 vUv;
varying vec2 vLocal;
varying float vDrop;

void main() {
  vec2 p = position.xz - uCenter;
  float c = uCrack;
  float R = mix(0.15, 1.5, smoothstep(0.0, 1.0, c));

  // 舗装をボロノイ状の板に割り、板ごとに沈下・傾斜させる
  vec4 v = voronoi(p * uCellScale);
  vec2 cell = v.zw;
  float h = hash1(cell);
  vec2 cellCenter = (cell + hash2(cell)) / uCellScale;
  float rc = length(cellCenter);
  float inside = 1.0 - smoothstep(R * 0.55, R, rc + (h - 0.5) * 0.35);

  float drop = inside * (0.12 + 0.6 * h) * smoothstep(0.15, 0.9, c);
  vec2 toCenter = -normalize(cellCenter + 1e-4);
  drop += inside * dot(p - cellCenter, toCenter) * 0.7 * c;

  // 中心の空洞
  float pit = 1.0 - smoothstep(0.0, R * 0.8, length(p));
  drop += pit * pit * 1.6 * smoothstep(0.35, 1.0, c);

  // Unity 版と同じく頂点をランダムに揺らしてガタつきを出す
  drop += (hash1(position.xz * 37.0) - 0.5) * 0.012 * c * inside;
  drop = max(drop, 0.0);

  vec3 pos = position;
  pos.y -= drop;

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldPos = world.xyz;
  vUv = uv;
  vLocal = position.xz;
  vDrop = drop;
  gl_Position = projectionMatrix * viewMatrix * world;
}
