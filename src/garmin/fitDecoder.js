import AdmZip from 'adm-zip';
import FitParser from 'fit-file-parser';
import { computeAerobicDecoupling, formatPace } from '../science/metrics.js';

/**
 * 解压 Garmin 返回的 ZIP 字节流并解析其中的 .FIT 文件
 * @param {Uint8Array|Buffer} zipBytes
 * @param {object} physiology
 */
export async function parseGarminFitZip(zipBytes, physiology = {}) {
  const buf = Buffer.isBuffer(zipBytes) ? zipBytes : Buffer.from(zipBytes);
  const zip = new AdmZip(buf);
  const fitEntry = zip
    .getEntries()
    .find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.fit'));

  if (!fitEntry) {
    throw new Error('Activity archive does not contain a .fit file');
  }

  const fitBuffer = fitEntry.getData();
  const parser = new FitParser({
    force: true,
    speedUnit: 'm/s',
    lengthUnit: 'm',
    temperatureUnit: 'celsius',
    elapsedRecordField: true,
    mode: 'list'
  });

  const parsed = await parser.parseAsync(fitBuffer);
  const rawRecords = Array.isArray(parsed.records) ? parsed.records : [];
  const rawLaps = Array.isArray(parsed.laps) ? parsed.laps : [];
  const session = Array.isArray(parsed.sessions) ? parsed.sessions[0] : null;

  const records = rawRecords.map((r, idx) => {
    const speedMs = Number(r.enhanced_speed ?? r.speed ?? 0);
    const hr = Number(r.heart_rate ?? 0);
    const cadence = Number(r.cadence ?? 0);
    // Garmin FIT 步频有时存单脚 spm (如 90)，需折算双脚 (180 spm)
    const normalizedCadence = cadence > 0 && cadence < 130 ? cadence * 2 : cadence;
    const altitude = Number(r.enhanced_altitude ?? r.altitude ?? 0);
    const distanceM = Number(r.distance ?? 0);
    const elapsedSec = Number(r.elapsed_time ?? idx);
    const power = Number(r.power ?? 0);
    return {
      elapsedSec,
      distanceM,
      speedMs,
      hr,
      cadence: normalizedCadence,
      altitude,
      power
    };
  });

  const decoupling = computeAerobicDecoupling(records);

  // 计算 5 个心率区间停留秒数
  const maxHr = physiology.maxHr || 190;
  const rhr = physiology.restingHrBaseline || 50;
  const lthr = physiology.lthr || Math.round(rhr + (maxHr - rhr) * 0.85);
  const zB = [
    Math.round(lthr * 0.81),
    Math.round(lthr * 0.89),
    Math.round(lthr * 0.93),
    Math.round(lthr * 0.99)
  ];
  const hrZonesSec = [0, 0, 0, 0, 0];

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r.hr || r.hr <= 40) continue;
    const dt =
      i > 0
        ? Math.min(10, Math.max(1, records[i].elapsedSec - records[i - 1].elapsedSec))
        : 1;
    let z = 4;
    if (r.hr <= zB[0]) z = 0;
    else if (r.hr <= zB[1]) z = 1;
    else if (r.hr <= zB[2]) z = 2;
    else if (r.hr <= zB[3]) z = 3;
    hrZonesSec[z] += dt;
  }

  // 抽样最多 60 个点用于前端 Chart.js 渲染配速 vs 心率曲线
  const sampleStep = Math.max(1, Math.floor(records.length / 60));
  const telemetrySamples = [];
  for (let i = 0; i < records.length; i += sampleStep) {
    const r = records[i];
    if (r.speedMs <= 0.5 && r.hr <= 40) continue;
    const paceSec = r.speedMs > 0.5 ? Math.min(600, Math.max(150, 1000 / r.speedMs)) : null;
    telemetrySamples.push({
      km: Math.round((r.distanceM / 1000) * 100) / 100,
      min: Math.round((r.elapsedSec / 60) * 10) / 10,
      hr: r.hr || null,
      paceSec: paceSec ? Math.round(paceSec) : null,
      paceFormatted: paceSec ? formatPace(paceSec) : null,
      cadence: r.cadence || null,
      altitude: Math.round(r.altitude * 10) / 10
    });
  }

  const laps = rawLaps.map((lap, idx) => {
    const dist = Number(lap.total_distance ?? 0);
    const dur = Number(lap.total_timer_time ?? lap.total_elapsed_time ?? 0);
    const speed = dist > 0 && dur > 0 ? dist / dur : Number(lap.avg_speed ?? 0);
    const paceSec = speed > 0.5 ? 1000 / speed : null;
    const cad = Number(lap.avg_running_cadence ?? lap.avg_cadence ?? 0);
    return {
      lapIndex: idx + 1,
      distanceKm: Math.round((dist / 1000) * 100) / 100,
      durationSec: Math.round(dur),
      paceFormatted: paceSec ? formatPace(paceSec) : '--:--',
      avgHr: Math.round(Number(lap.avg_heart_rate ?? 0)) || null,
      cadence: cad > 0 && cad < 130 ? Math.round(cad * 2) : Math.round(cad) || null
    };
  });

  const avgStrideM =
    session?.avg_step_length != null
      ? Math.round((Number(session.avg_step_length) / 1000) * 100) / 100
      : null;

  return {
    decoupling,
    hrZonesSec,
    telemetrySamples,
    laps,
    avgStrideM
  };
}
