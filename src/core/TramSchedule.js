/**
 * 健軍町の次発を、静的 GTFS 由来の JSON から求める。
 */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export class TramSchedule {
  constructor(data) {
    this.data = data;
  }

  static async load(url = './data/tram-kengunmachi.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`時刻表の読み込みに失敗: ${res.status}`);
    return new TramSchedule(await res.json());
  }

  /** @returns {{ time:string, minutes:number, route:string, headsign:string, etaSec:number }[]} */
  nextDepartures(now = new Date(), count = 3) {
    const ymd = formatYmd(now);
    const dow = DAY_KEYS[now.getDay()];
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const active = new Set();

    for (const [id, svc] of Object.entries(this.data.services || {})) {
      if (ymd < svc.start || ymd > svc.end) continue;
      if (svc[dow]) active.add(id);
    }
    for (const [id, dates] of Object.entries(this.data.exceptions || {})) {
      const ex = dates[ymd];
      if (ex === 1) active.add(id);
      if (ex === 2) active.delete(id);
    }

    const list = (this.data.departures || [])
      .filter((d) => active.has(d.serviceId) && d.minutes + 0.01 >= nowMin)
      .slice(0, count)
      .map((d) => ({
        time: d.time,
        minutes: d.minutes,
        route: d.route,
        headsign: d.headsign,
        etaSec: Math.max(0, Math.round((d.minutes - nowMin) * 60)),
      }));

    // 終電後は翌日の先頭を仮表示（service は明日の曜日で再計算しない簡易版）
    if (!list.length) {
      const tomorrow = (this.data.departures || []).filter((d) => active.has(d.serviceId)).slice(0, count);
      return tomorrow.map((d) => ({
        time: d.time,
        minutes: d.minutes,
        route: d.route,
        headsign: d.headsign,
        etaSec: Math.round((d.minutes + 24 * 60 - nowMin) * 60),
      }));
    }
    return list;
  }
}

function formatYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
