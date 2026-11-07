/**
 * 熊本市電 GTFS から「健軍町」発車時刻を抽出して public/data/tram-kengunmachi.json を作る。
 * 実行: node tools/extract_tram_kengun.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'data');
const tmpDir = path.join(root, '.tmp-gtfs');
const zipPath = path.join(tmpDir, 'feed.zip');
const GTFS_URL =
  'https://api.gtfs-data.jp/v2/organizations/kumamoto-shiden/feeds/kumamotoshiden/files/feed.zip';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', reject);
  });
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === ',' && !q) {
        cols.push(cur);
        cur = '';
      } else cur += c;
    }
    cols.push(cur);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? '').replace(/^"|"$/g, '').trim();
    });
    return row;
  });
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

console.log('Downloading GTFS…');
await download(GTFS_URL, zipPath);

const extractDir = path.join(tmpDir, 'feed');
fs.rmSync(extractDir, { recursive: true, force: true });
fs.mkdirSync(extractDir, { recursive: true });
// Windows PowerShell Expand-Archive
execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force"`, {
  stdio: 'inherit',
});

const stops = parseCsv(fs.readFileSync(path.join(extractDir, 'stops.txt'), 'utf8'));
const stopTimes = parseCsv(fs.readFileSync(path.join(extractDir, 'stop_times.txt'), 'utf8'));
const trips = parseCsv(fs.readFileSync(path.join(extractDir, 'trips.txt'), 'utf8'));
const routes = parseCsv(fs.readFileSync(path.join(extractDir, 'routes.txt'), 'utf8'));
const calendar = fs.existsSync(path.join(extractDir, 'calendar.txt'))
  ? parseCsv(fs.readFileSync(path.join(extractDir, 'calendar.txt'), 'utf8'))
  : [];
const calendarDates = fs.existsSync(path.join(extractDir, 'calendar_dates.txt'))
  ? parseCsv(fs.readFileSync(path.join(extractDir, 'calendar_dates.txt'), 'utf8'))
  : [];

const kengunStops = stops.filter((s) => /健軍町/.test(s.stop_name));
console.log(
  'stops:',
  kengunStops.map((s) => `${s.stop_id}:${s.stop_name}`).join(', '),
);
const stopIds = new Set(kengunStops.map((s) => s.stop_id));

const tripById = Object.fromEntries(trips.map((t) => [t.trip_id, t]));
const routeById = Object.fromEntries(routes.map((r) => [r.route_id, r]));

/** 起点付近の発車＝健軍町で departure がある便 */
const departures = [];
for (const st of stopTimes) {
  if (!stopIds.has(st.stop_id)) continue;
  const trip = tripById[st.trip_id];
  if (!trip) continue;
  const route = routeById[trip.route_id];
  const dep = st.departure_time || st.arrival_time;
  if (!dep) continue;
  // 終点での降車のみ（到着＝発車）のレコードは、次の停留所が無い場合がある。
  // stop_sequence が最大なら終点着＝折り返し前の「到着」。発車は乗車ホーム側の別 stop_id にあることが多い。
  departures.push({
    time: dep.slice(0, 5),
    minutes: timeToMin(dep),
    tripId: st.trip_id,
    serviceId: trip.service_id,
    routeId: trip.route_id,
    routeShort: route?.route_short_name || route?.route_long_name || '',
    headsign: trip.trip_headsign || route?.route_long_name || '',
    stopId: st.stop_id,
    stopSequence: Number(st.stop_sequence),
  });
}

// 同じ trip で健軍町の最大 sequence＝終点着、最小＝発車側とみなす
const byTrip = new Map();
for (const d of departures) {
  if (!byTrip.has(d.tripId)) byTrip.set(d.tripId, []);
  byTrip.get(d.tripId).push(d);
}

const departOnly = [];
for (const list of byTrip.values()) {
  list.sort((a, b) => a.stopSequence - b.stopSequence);
  // 起点発車: sequence が最小のもの（健軍町始発）
  const first = list[0];
  // 終点のみの trip（健軍町に着くだけ）は除外し、始発側だけ残す
  // stop_times 上、健軍町始発は sequence=1 が多い
  if (list.length === 1 && first.stopSequence > 1) continue;
  departOnly.push(first);
}

const services = {};
for (const c of calendar) {
  services[c.service_id] = {
    mon: c.monday === '1',
    tue: c.tuesday === '1',
    wed: c.wednesday === '1',
    thu: c.thursday === '1',
    fri: c.friday === '1',
    sat: c.saturday === '1',
    sun: c.sunday === '1',
    start: c.start_date,
    end: c.end_date,
  };
}

const exceptions = {};
for (const d of calendarDates) {
  if (!exceptions[d.service_id]) exceptions[d.service_id] = {};
  exceptions[d.service_id][d.date] = Number(d.exception_type); // 1 add, 2 remove
}

departOnly.sort((a, b) => a.minutes - b.minutes);

const payload = {
  stopName: '健軍町',
  stopIds: [...stopIds],
  source: '熊本市交通局 GTFS（CC BY 2.1 JP）',
  sourceUrl: GTFS_URL,
  generatedAt: new Date().toISOString(),
  services,
  exceptions,
  departures: departOnly.map(({ time, minutes, serviceId, routeShort, headsign }) => ({
    time,
    minutes,
    serviceId,
    route: routeShort,
    headsign,
  })),
};

fs.writeFileSync(path.join(outDir, 'tram-kengunmachi.json'), JSON.stringify(payload, null, 2), 'utf8');
console.log(`wrote ${departOnly.length} departures → public/data/tram-kengunmachi.json`);
