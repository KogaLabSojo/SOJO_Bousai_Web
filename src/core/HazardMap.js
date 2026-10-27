/**
 * 国土地理院「重ねるハザードマップ」の浸水深タイル（オープンデータ）から、
 * 指定地点の想定浸水深ランクを調べる。タイルは凡例色で塗られた PNG なので、ピクセルの色をランクに戻す。
 * 出典表記: ハザードマップポータルサイト https://disaportal.gsi.go.jp/
 */

const BASE = 'https://disaportaldata.gsi.go.jp/raster';
const ZOOM = 17;

const LAYERS = [
  { id: 'flood', label: '洪水', path: '01_flood_l2_shinsuishin_data' },
  { id: 'hightide', label: '高潮', path: '03_hightide_l2_shinsuishin_data' },
  { id: 'tsunami', label: '津波', path: '04_tsunami_newlegend_data' },
];

// 洪水浸水想定区域図作成マニュアル（第4版）の標準配色。6 ランクと、細分した 8 ランクの両方に対応する
// depth は AR で見せる水位（各ランクの上限。5m 以上は 2 階が水没する 5m で代表）
const RANKS = [
  { rgb: [255, 255, 179], label: '0.3m未満', depth: 0.3 },
  { rgb: [247, 245, 169], label: '0.5m未満', depth: 0.5 },
  { rgb: [248, 225, 166], label: '0.5〜1m', depth: 1.0 },
  { rgb: [255, 216, 192], label: '0.5〜3m', depth: 3.0 },
  { rgb: [255, 183, 183], label: '3〜5m', depth: 5.0 },
  { rgb: [255, 145, 145], label: '5〜10m', depth: 5.0 },
  { rgb: [242, 133, 201], label: '10〜20m', depth: 5.0 },
  { rgb: [220, 122, 220], label: '20m以上', depth: 5.0 },
];

/** 位置情報を取得する（ユーザー操作のハンドラ内で呼ぶ） */
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('位置情報に対応していません'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

/**
 * 指定地点の想定浸水深を調べる。
 * 戻り値: { results: [{ id, label, rank }], worst: { label, rank } | null }
 * rank は RANKS の要素（区域外なら null）
 */
export async function lookupInundation(lat, lon) {
  const { x, y, px, py } = toTilePixel(lat, lon, ZOOM);
  const results = await Promise.all(
    LAYERS.map(async (layer) => {
      const rgba = await samplePixel(`${BASE}/${layer.path}/${ZOOM}/${x}/${y}.png`, px, py);
      return { id: layer.id, label: layer.label, rank: rgba ? matchRank(rgba) : null };
    }),
  );
  let worst = null;
  for (const r of results) {
    if (r.rank && (!worst || RANKS.indexOf(r.rank) > RANKS.indexOf(worst.rank))) worst = r;
  }
  return { results, worst };
}

function toTilePixel(lat, lon, z) {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return { x, y, px: Math.min(255, Math.floor((fx - x) * 256)), py: Math.min(255, Math.floor((fy - y) * 256)) };
}

/** タイルの 1 ピクセルを読む。タイルが無い（＝区域外）ときは null */
async function samplePixel(url, px, py) {
  const res = await fetch(url, { mode: 'cors' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ハザードマップの取得に失敗しました (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, px, py, 1, 1, 0, 0, 1, 1);
  bitmap.close?.();
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return d[3] < 128 ? null : [d[0], d[1], d[2]];
}

function matchRank([r, g, b]) {
  let best = null;
  let bestDist = Infinity;
  for (const rank of RANKS) {
    const dist = (rank.rgb[0] - r) ** 2 + (rank.rgb[1] - g) ** 2 + (rank.rgb[2] - b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = rank;
    }
  }
  return bestDist < 30 ** 2 ? best : null;
}
