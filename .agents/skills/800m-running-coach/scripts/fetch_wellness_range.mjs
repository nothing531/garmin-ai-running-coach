#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../../..');

async function loadDotEnv(rootDir = ROOT_DIR) {
  try {
    const raw = await fs.readFile(path.join(rootDir, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env absent; rely on process.env
  }
}

function parseDaysArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days' && argv[i + 1]) {
      return Math.min(14, Math.max(1, Number(argv[i + 1]) || 4));
    }
    if (/^\d+$/.test(argv[i])) {
      return Math.min(14, Math.max(1, Number(argv[i]) || 4));
    }
  }
  return 4;
}

function isoDateInTz(offsetDays = 0, timeZone = 'Asia/Shanghai') {
  const dt = new Date(Date.now() + offsetDays * 86400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function formatWallClock(gmtMs, timeZone = 'Asia/Shanghai') {
  if (!Number.isFinite(Number(gmtMs))) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(Number(gmtMs)));
}

await loadDotEnv(ROOT_DIR);

const days = parseDaysArg(process.argv.slice(2));
const timeZone = 'Asia/Shanghai';
const dates = [];
for (let offset = -(days - 1); offset <= 0; offset++) {
  dates.push(isoDateInTz(offset, timeZone));
}
const hrvStart = isoDateInTz(-Math.max(10, days + 3), timeZone);
const today = dates[dates.length - 1];

const sdkUrl = pathToFileURL(
  path.join(ROOT_DIR, 'node_modules/@likenttt/connect-personal-api-ts/dist/index.js')
).href;
const { GarminPersonalApiClient } = await import(sdkUrl);

const apiKey = (process.env.GARMIN_PERSONAL_API_KEY || '').trim();
if (!apiKey) {
  console.error('Missing GARMIN_PERSONAL_API_KEY in .env or environment.');
  process.exit(1);
}

const client = new GarminPersonalApiClient({
  apiKey,
  region: (process.env.GARMIN_REGION || 'cn').toLowerCase() === 'cn' ? 'cn' : 'global',
  ...((process.env.GARMIN_BASE_URL || '').trim() ? { baseUrl: process.env.GARMIN_BASE_URL.trim() } : {}),
  timeoutMs: 30_000
});

const [sleeps, hrs, summaries, hrvRange, bbReports] = await Promise.all([
  Promise.all(dates.map((d) => client.getDailySleep(d).catch((e) => ({ _error: e.message })))),
  Promise.all(dates.map((d) => client.getDailyHeartRate(d).catch((e) => ({ _error: e.message })))),
  Promise.all(dates.map((d) => client.getDailySummary(d).catch((e) => ({ _error: e.message })))),
  client.getDailyHrvSummaries(hrvStart, today).catch((e) => ({ _error: e.message })),
  client.getDailyBodyBattery(dates[0], today).catch((e) => ({ _error: e.message }))
]);

const hrvByDate = new Map(
  (hrvRange?.hrvSummaries || []).map((h) => [String(h.calendarDate || '').slice(0, 10), h])
);
const bbByDate = new Map(
  (Array.isArray(bbReports) ? bbReports : []).map((b) => [String(b.date || '').slice(0, 10), b])
);

const report = dates.map((date, idx) => {
  const s = sleeps[idx];
  const h = hrs[idx];
  const d = summaries[idx];
  const hrv = hrvByDate.get(date) || null;
  const bb = bbByDate.get(date) || null;

  return {
    date,
    sleep: s && !s._error
      ? {
          bedTimeLocal: formatWallClock(s.sleepStartTimestampGMT, timeZone),
          wakeTimeLocal: formatWallClock(s.sleepEndTimestampGMT, timeZone),
          sleepHours: s.sleepTimeSeconds ? +(s.sleepTimeSeconds / 3600).toFixed(2) : null,
          score: s.sleepScores?.overall?.value ?? null,
          scoreQualifier: s.sleepScores?.overall?.qualifierKey ?? null,
          deepMin: s.deepSleepSeconds ? Math.round(s.deepSleepSeconds / 60) : null,
          deepPct: s.sleepScores?.deepPercentage?.value ?? null,
          remMin: s.remSleepSeconds ? Math.round(s.remSleepSeconds / 60) : null,
          remPct: s.sleepScores?.remPercentage?.value ?? null,
          lightMin: s.lightSleepSeconds ? Math.round(s.lightSleepSeconds / 60) : null,
          lightPct: s.sleepScores?.lightPercentage?.value ?? null,
          awakeMin: s.awakeSleepSeconds ? Math.round(s.awakeSleepSeconds / 60) : null,
          awakeCount: s.awakeCount ?? null,
          avgSleepStress: s.avgSleepStress ?? null,
          avgHeartRate: s.avgHeartRate ?? null,
          avgRespiration: s.averageRespirationValue ?? null,
          avgSpO2: s.averageSpO2Value ?? null
        }
      : { error: s?._error || 'missing' },
    heartRate: h && !h._error
      ? {
          rhr: h.restingHeartRate ?? null,
          rhr7dAvg: h.lastSevenDaysAvgRestingHeartRate ?? null,
          minHr: h.minHeartRate ?? null,
          maxHr: h.maxHeartRate ?? null
        }
      : { error: h?._error || 'missing' },
    hrv: hrv
      ? {
          lastNightAvg: hrv.lastNightAvg ?? null,
          lastNight5MinHigh: hrv.lastNight5MinHigh ?? null,
          weeklyAvg: hrv.weeklyAvg ?? null,
          status: hrv.status ?? null,
          baselineLow: hrv.baseline?.balancedLow ?? null,
          baselineHigh: hrv.baseline?.balancedUpper ?? null
        }
      : null,
    daily: d && !d._error
      ? {
          steps: d.totalSteps ?? null,
          avgStress: d.averageStressLevel ?? null,
          bodyBatteryAtWake: d.bodyBatteryAtWakeTime ?? null,
          bodyBatteryHighest: d.bodyBatteryHighestValue ?? null,
          bodyBatteryLowest: d.bodyBatteryLowestValue ?? null,
          bodyBatteryCharged: bb?.charged ?? d.bodyBatteryChargedValue ?? null,
          bodyBatteryDrained: bb?.drained ?? d.bodyBatteryDrainedValue ?? null
        }
      : { error: d?._error || 'missing' }
  };
});

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), days: report }, null, 2));
