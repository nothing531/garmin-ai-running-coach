import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  GarminPersonalApiClient,
  PersonalApiError
} from '@likenttt/connect-personal-api-ts';
import GarminConnectModule from '@likenttt/garmin-connect';
import { parseGarminFitZip } from './fitDecoder.js';
import { getLocalIsoDate, getWeekdayIndexFromIso } from '../science/metrics.js';

const GarminConnect =
  GarminConnectModule.GarminConnect ||
  GarminConnectModule.default?.GarminConnect ||
  GarminConnectModule.default ||
  GarminConnectModule;

function isoDateOffset(daysAgo = 0) {
  return getLocalIsoDate(-daysAgo);
}

function isRunningActivity(typeKey = '') {
  const k = String(typeKey).toLowerCase();
  return k.includes('run') || k.includes('treadmill') || k.includes('trail') || k.includes('track');
}

function normalizePersonalActivity(a) {
  const typeKey = a?.activityType?.typeKey || 'unknown';
  const durationSec = Number(a?.duration || a?.elapsedDuration || 0);
  const distanceMeters = Number(a?.distance || 0);
  const speed = Number(a?.averageSpeed || (durationSec > 0 ? distanceMeters / durationSec : 0));
  const cad = Number(a?.averageRunningCadenceInStepsPerMinute || 0);
  return {
    activityId: a.activityId,
    name: a.activityName || typeKey,
    date: String(a.startTimeLocal || a.startTimeGMT || '').slice(0, 10),
    startTimeLocal: a.startTimeLocal || '',
    typeKey,
    isRun: isRunningActivity(typeKey),
    distanceMeters,
    distanceKm: Math.round((distanceMeters / 1000) * 100) / 100,
    durationSec: Math.round(durationSec),
    movingDurationSec: Math.round(Number(a?.movingDuration || durationSec)),
    elevationGainM: Math.round(Number(a?.elevationGain || 0)),
    elevationLossM: Math.round(Number(a?.elevationLoss || 0)),
    averageSpeedMs: speed,
    paceSecPerKm: speed > 0.5 ? Math.round(1000 / speed) : null,
    averageHr: a?.averageHR ? Math.round(a.averageHR) : null,
    maxHr: a?.maxHR ? Math.round(a.maxHR) : null,
    cadence: cad > 0 && cad < 130 ? Math.round(cad * 2) : Math.round(cad) || null,
    avgPower: a?.avgPower ? Math.round(a.avgPower) : null,
    aerobicTe: a?.aerobicTrainingEffect ?? null,
    anaerobicTe: a?.anaerobicTrainingEffect ?? null,
    startLatitude: a?.startLatitude ?? null,
    startLongitude: a?.startLongitude ?? null
  };
}

function extractBodyBatteryLatest(reports) {
  if (!Array.isArray(reports) || reports.length === 0) return null;
  const latest = reports[reports.length - 1];
  const rows = latest?.bodyBatteryValuesArray;
  const desc = latest?.bodyBatteryValueDescriptorDTOList;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  let levelIdx = 1;
  if (Array.isArray(desc)) {
    const found = desc.find((d) => d.bodyBatteryValueDescriptorKey === 'bodyBatteryLevel');
    if (found && typeof found.bodyBatteryValueDescriptorIndex === 'number') {
      levelIdx = found.bodyBatteryValueDescriptorIndex;
    }
  }

  let maxMorning = null;
  let lastVal = null;
  for (const row of rows) {
    const v = Number(row?.[levelIdx]);
    if (Number.isFinite(v) && v >= 0 && v <= 100) {
      lastVal = v;
      if (maxMorning === null || v > maxMorning) maxMorning = v;
    }
  }
  return maxMorning ?? lastVal;
}

/**
 * 优先使用 Garmin 官方 Personal API 拉取全量数据；
 * 若在 .cn 遇到已知 HTTP 526 故障且配置了会话凭证，则无缝降级到 connect_session。
 */
export async function fetchGarminData(config = {}) {
  const region = (process.env.GARMIN_REGION || config.region || 'cn').toLowerCase() === 'cn' ? 'cn' : 'global';
  const authMode = (process.env.GARMIN_AUTH_MODE || 'auto').toLowerCase();
  const apiKey = (process.env.GARMIN_PERSONAL_API_KEY || '').trim();
  const baseUrl = (process.env.GARMIN_BASE_URL || '').trim() || undefined;

  if ((authMode === 'auto' || authMode === 'personal_api') && apiKey) {
    try {
      const data = await fetchViaPersonalApi({
        apiKey,
        region,
        baseUrl,
        physiology: config.physiology || {}
      });
      return { source: 'garmin_personal_api', region, ...data };
    } catch (err) {
      const isCn526 =
        err instanceof PersonalApiError &&
        (err.status === 526 || err.code === 'TOKEN_EXCHANGE_FAILED');
      const hasSessionCreds = Boolean(
        process.env.GARMIN_SESSION_JSON ||
          (process.env.GARMIN_EMAIL && process.env.GARMIN_PASSWORD)
      );

      if (authMode === 'auto' && hasSessionCreds) {
        console.warn(
          `[Garmin] Official Personal API unavailable (${isCn526 ? 'HTTP 526 on .cn' : err.message}), falling back to Garmin Connect session.`
        );
      } else {
        throw err;
      }
    }
  }

  if (authMode === 'personal_api') {
    throw new Error('GARMIN_AUTH_MODE=personal_api requires GARMIN_PERSONAL_API_KEY');
  }

  const sessionData = await fetchViaConnectSession({
    region,
    physiology: config.physiology || {}
  });
  return { source: 'garmin_connect_session', region, ...sessionData };
}

async function fetchViaPersonalApi({ apiKey, region, baseUrl, physiology }) {
  const client = new GarminPersonalApiClient({
    apiKey,
    region,
    ...(baseUrl ? { baseUrl } : {}),
    timeoutMs: 30_000
  });

  const today = isoDateOffset(0);
  const yesterday = isoDateOffset(1);
  const start7d = isoDateOffset(7);
  const start14d = isoDateOffset(14);
  const start56d = isoDateOffset(56);

  // Garmin Personal API 单页 limit 上限通常为 20~50，分页拉取最近 40 条全量历史活动
  const page1 = (await client.searchActivities({ start: 0, limit: 20 })) || [];
  let page2 = [];
  if (page1.length === 20) {
    page2 = (await client.searchActivities({ start: 20, limit: 20 }).catch(() => [])) || [];
  }
  const rawActivities = [...page1, ...page2];

  const activities = rawActivities.map(normalizePersonalActivity);

  const [
    sleepToday,
    sleepYesterday,
    hrvRange,
    summaryToday,
    hrToday,
    hrWeek,
    bbReports,
    weightRange,
    hrZones
  ] = await Promise.all([
    client.getDailySleep(today).catch(() => null),
    client.getDailySleep(yesterday).catch(() => null),
    client.getDailyHrvSummaries(start14d, today).catch(() => null),
    client.getDailySummary(today).catch(() => null),
    client.getDailyHeartRate(today).catch(() => null),
    client.getDailyHeartRate(yesterday).catch(() => null),
    client.getDailyBodyBattery(yesterday, today).catch(() => null),
    client.getWeightMeasurements(start56d, today).catch(() => null),
    client.getHeartRateZones().catch(() => null)
  ]);

  const sleep = sleepToday?.sleepTimeSeconds ? sleepToday : sleepYesterday;
  const hrvList = hrvRange?.hrvSummaries || [];
  const latestHrv = hrvList[hrvList.length - 1] || null;
  const hrvValues = hrvList.map((h) => h.lastNightAvg).filter((v) => typeof v === 'number');
  const hrv7dAvg =
    latestHrv?.weeklyAvg ||
    (hrvValues.length > 0
      ? Math.round(hrvValues.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, hrvValues.length))
      : null);

  const rhrToday =
    hrToday?.restingHeartRate ??
    summaryToday?.restingHeartRate ??
    hrWeek?.restingHeartRate ??
    physiology.restingHrBaseline ??
    50;
  const rhr7dAvg =
    hrToday?.lastSevenDaysAvgRestingHeartRate ??
    hrWeek?.lastSevenDaysAvgRestingHeartRate ??
    rhrToday;

  const sleepScore =
    sleep?.sleepScores?.overall?.value ??
    sleep?.sleepScores?.total?.value ??
    null;

  const latestWeightG = weightRange?.totalAverage?.weight ?? weightRange?.previousDateWeight?.weight;
  const weightKg = latestWeightG ? Math.round((latestWeightG / 1000) * 10) / 10 : physiology.weightKg;

  // 提取 LTHR（若 Garmin 心率区间中存在）
  const runZoneConfig = Array.isArray(hrZones)
    ? hrZones.find((z) => String(z.sport || '').toUpperCase() === 'RUNNING') || hrZones[0]
    : null;

  // 拉取最近 3 次代表性跑步的 .FIT 文件做解耦率和遥测分析
  const keyRuns = selectKeyRunsForFit(activities);
  let lastKeyWorkoutAudit = null;

  for (const run of keyRuns) {
    try {
      const zipBytes = await client.downloadActivity(run.activityId);
      const fitAnalysis = await parseGarminFitZip(zipBytes, physiology);
      run.hrZonesSec = fitAnalysis.hrZonesSec;
      run.decoupling = fitAnalysis.decoupling;
      if (!lastKeyWorkoutAudit) {
        lastKeyWorkoutAudit = {
          activity: run,
          ...fitAnalysis
        };
      }
    } catch (e) {
      console.warn(`[FIT] Failed to parse activity ${run.activityId}: ${e.message}`);
    }
  }

  return {
    activities,
    lastKeyWorkoutAudit,
    wellness: {
      date: today,
      hrvToday: latestHrv?.lastNightAvg ?? null,
      hrv7dAvg,
      hrvStatus: latestHrv?.status ?? null,
      hrvBaselineLow: latestHrv?.baseline?.balancedLow ?? null,
      hrvBaselineHigh: latestHrv?.baseline?.balancedUpper ?? null,
      rhrToday,
      rhr7dAvg,
      sleepScore,
      sleepHours: sleep?.sleepTimeSeconds ? Math.round((sleep.sleepTimeSeconds / 3600) * 10) / 10 : null,
      deepSleepMin: sleep?.deepSleepSeconds ? Math.round(sleep.deepSleepSeconds / 60) : null,
      remSleepMin: sleep?.remSleepSeconds ? Math.round(sleep.remSleepSeconds / 60) : null,
      lightSleepMin: sleep?.lightSleepSeconds ? Math.round(sleep.lightSleepSeconds / 60) : null,
      avgSpO2: sleep?.averageSpO2Value ?? null,
      avgRespiration: sleep?.averageRespirationValue ?? null,
      bodyBatteryMorning: extractBodyBatteryLatest(bbReports),
      stepsToday: summaryToday?.totalSteps ?? null,
      weightKg,
      lthrFromDevice: runZoneConfig?.lactateThresholdHeartRate ?? physiology.lthr,
      maxHrFromDevice: runZoneConfig?.maxHeartRateUsed ?? physiology.maxHr,
      vo2Max: null
    }
  };
}

async function fetchViaConnectSession({ region, physiology }) {
  const domain = region === 'cn' ? 'garmin.cn' : 'garmin.com';
  const gc = new GarminConnect(
    process.env.GARMIN_EMAIL && process.env.GARMIN_PASSWORD
      ? { username: process.env.GARMIN_EMAIL, password: process.env.GARMIN_PASSWORD }
      : undefined,
    domain
  );

  if (process.env.GARMIN_SESSION_JSON) {
    const tokens = JSON.parse(process.env.GARMIN_SESSION_JSON);
    gc.loadToken(tokens.oauth1, tokens.oauth2);
  } else if (process.env.GARMIN_EMAIL && process.env.GARMIN_PASSWORD) {
    await gc.login();
  } else {
    throw new Error('Missing Garmin credentials: set GARMIN_PERSONAL_API_KEY or GARMIN_SESSION_JSON / GARMIN_EMAIL + GARMIN_PASSWORD');
  }

  const today = isoDateOffset(0);
  const start14d = isoDateOffset(14);
  const todayDateObj = new Date();
  const yesterdayDateObj = new Date(Date.now() - 86400_000);

  const rawActivities = (await gc.getActivities(0, 60)) || [];
  const activities = rawActivities.map((a) =>
    normalizePersonalActivity({
      ...a,
      activityType: a.activityType || { typeKey: a.activityType?.typeKey }
    })
  );

  const [sleepToday, sleepYesterday, hrvData, hrvSummaries, hrToday, bbReports, maxMetrics] =
    await Promise.all([
      gc.getSleepData(todayDateObj).catch(() => null),
      gc.getSleepData(yesterdayDateObj).catch(() => null),
      gc.getHrvData(todayDateObj).catch(() => null),
      gc.getHrvSummaries(new Date(start14d), todayDateObj).catch(() => null),
      gc.getHeartRate(todayDateObj).catch(() => null),
      gc.getBodyBattery(yesterdayDateObj, todayDateObj).catch(() => null),
      gc.getMaxMetrics(todayDateObj).catch(() => null)
    ]);

  const sleepDto = sleepToday?.dailySleepDTO?.sleepTimeSeconds
    ? sleepToday.dailySleepDTO
    : sleepYesterday?.dailySleepDTO || sleepToday || sleepYesterday;

  const hrvSummary = hrvData?.hrvSummary || hrvSummaries?.hrvSummaries?.slice(-1)?.[0] || null;
  const keyRuns = selectKeyRunsForFit(activities);
  let lastKeyWorkoutAudit = null;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-fit-'));
  try {
    for (const run of keyRuns) {
      try {
        await gc.downloadOriginalActivityData({ activityId: run.activityId }, tmpDir, 'zip');
        const files = await fs.readdir(tmpDir);
        const zipFile = files.find((f) => String(f).includes(String(run.activityId)) && f.endsWith('.zip'))
          || files.find((f) => f.endsWith('.zip'));
        if (zipFile) {
          const zipBytes = await fs.readFile(path.join(tmpDir, zipFile));
          const fitAnalysis = await parseGarminFitZip(zipBytes, physiology);
          run.hrZonesSec = fitAnalysis.hrZonesSec;
          run.decoupling = fitAnalysis.decoupling;
          if (!lastKeyWorkoutAudit) {
            lastKeyWorkoutAudit = { activity: run, ...fitAnalysis };
          }
          await fs.rm(path.join(tmpDir, zipFile), { force: true });
        }
      } catch (e) {
        console.warn(`[FIT] Session download failed for ${run.activityId}: ${e.message}`);
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  return {
    activities,
    lastKeyWorkoutAudit,
    wellness: {
      date: today,
      hrvToday: hrvSummary?.lastNightAvg ?? null,
      hrv7dAvg: hrvSummary?.weeklyAvg ?? null,
      hrvStatus: hrvSummary?.status ?? null,
      hrvBaselineLow: hrvSummary?.baseline?.balancedLow ?? null,
      hrvBaselineHigh: hrvSummary?.baseline?.balancedUpper ?? null,
      rhrToday: hrToday?.restingHeartRate ?? physiology.restingHrBaseline,
      rhr7dAvg: hrToday?.lastSevenDaysAvgRestingHeartRate ?? physiology.restingHrBaseline,
      sleepScore: sleepDto?.sleepScores?.overall?.value ?? null,
      sleepHours: sleepDto?.sleepTimeSeconds ? Math.round((sleepDto.sleepTimeSeconds / 3600) * 10) / 10 : null,
      deepSleepMin: sleepDto?.deepSleepSeconds ? Math.round(sleepDto.deepSleepSeconds / 60) : null,
      remSleepMin: sleepDto?.remSleepSeconds ? Math.round(sleepDto.remSleepSeconds / 60) : null,
      lightSleepMin: sleepDto?.lightSleepSeconds ? Math.round(sleepDto.lightSleepSeconds / 60) : null,
      avgSpO2: sleepDto?.averageSpO2Value ?? null,
      avgRespiration: sleepDto?.averageRespirationValue ?? null,
      bodyBatteryMorning: extractBodyBatteryLatest(bbReports),
      stepsToday: null,
      weightKg: physiology.weightKg,
      lthrFromDevice: physiology.lthr,
      maxHrFromDevice: physiology.maxHr,
      vo2Max: maxMetrics?.[0]?.generic?.vo2MaxValue ?? null
    }
  };
}

function selectKeyRunsForFit(activities) {
  const runs = activities.filter((a) => a.isRun);
  const picked = [];
  const seen = new Set();

  // 1. 最新一次跑步
  if (runs[0]) {
    picked.push(runs[0]);
    seen.add(runs[0].activityId);
  }
  // 2. 最近一次长距离 (>= 14km)
  const lsd = runs.find((r) => !seen.has(r.activityId) && r.distanceKm >= 14);
  if (lsd) {
    picked.push(lsd);
    seen.add(lsd.activityId);
  }
  // 3. 最近一次高心率强度课
  const quality = runs.find((r) => !seen.has(r.activityId) && (r.averageHr || 0) >= 160);
  if (quality) {
    picked.push(quality);
    seen.add(quality.activityId);
  }
  return picked.slice(0, 3);
}

/**
 * 离线 Demo 数据生成器，用于本地快速预览 HTML 看板与完整科学引擎链路
 */
export function generateDemoTelemetry(config = {}) {
  const physiology = config.physiology || {
    maxHr: 190,
    restingHrBaseline: 50,
    lthr: 172,
    ltPaceSecPerKm: 265,
    weightKg: 66
  };
  const activities = [];
  const now = new Date();

  for (let i = 55; i >= 1; i--) {
    const iso = isoDateOffset(i);
    const dow = getWeekdayIndexFromIso(iso); // 0=Sun

    if (dow === 1 || dow === 5) continue; // 周一、周五休息

    let distanceKm = 8.5;
    let avgHr = 144;
    let paceSec = 335;
    let name = '有氧基础轻松跑';
    let elev = 32;

    if (dow === 0) {
      distanceKm = 18 + ((56 - i) % 4) * 2;
      avgHr = 152;
      paceSec = 318;
      name = '周末渐进有氧长距离 LSD';
      elev = 115;
    } else if (dow === 2) {
      distanceKm = 11.5;
      avgHr = 169;
      paceSec = 266;
      name = '乳酸阈值分段节奏跑 (3x10min T)';
      elev = 45;
    } else if (dow === 4) {
      distanceKm = 10.2;
      avgHr = 166;
      paceSec = 278;
      name = 'VO2max 间歇跑 (5x1000m)';
      elev = 28;
    }

    const durationSec = Math.round(distanceKm * paceSec);
    activities.push({
      activityId: 900000 + i,
      name,
      date: iso,
      startTimeLocal: `${iso} 06:15:00`,
      typeKey: 'running',
      isRun: true,
      distanceMeters: Math.round(distanceKm * 1000),
      distanceKm,
      durationSec,
      movingDurationSec: durationSec - 20,
      elevationGainM: elev,
      elevationLossM: elev - 4,
      averageSpeedMs: 1000 / paceSec,
      paceSecPerKm: paceSec,
      averageHr: avgHr,
      maxHr: Math.min(physiology.maxHr, avgHr + 15),
      cadence: dow === 2 || dow === 4 ? 184 : 176,
      avgPower: dow === 2 || dow === 4 ? 320 : 255,
      aerobicTe: dow === 0 || dow === 2 ? 3.8 : 2.7,
      anaerobicTe: dow === 4 ? 2.4 : 0.4,
      startLatitude: config.location?.latitude ?? 39.9042,
      startLongitude: config.location?.longitude ?? 116.4074
    });
  }

  // 生成最新重点长距离课表的 .FIT 采样流（用于图表 & 解耦率展示）
  const sampleRun = activities.find((a) => a.distanceKm >= 16) || activities[activities.length - 1];
  const telemetrySamples = [];
  for (let km = 0.5; km <= sampleRun.distanceKm; km += 0.5) {
    const drift = km > sampleRun.distanceKm / 2 ? (km - sampleRun.distanceKm / 2) * 0.9 : 0;
    const hr = Math.round(145 + drift + Math.sin(km) * 2);
    const paceSec = Math.round(322 - km * 0.6 + (km > 12 ? 3 : 0));
    telemetrySamples.push({
      km: Math.round(km * 10) / 10,
      min: Math.round((km * paceSec) / 60),
      hr,
      paceSec,
      paceFormatted: `${Math.floor(paceSec / 60)}:${String(paceSec % 60).padStart(2, '0')}`,
      cadence: 177 + (km > 12 ? 2 : 0),
      altitude: Math.round(45 + Math.sin(km * 0.7) * 18)
    });
  }

  return {
    source: 'demo_simulation',
    region: config.region || 'cn',
    activities,
    lastKeyWorkoutAudit: {
      activity: sampleRun,
      decoupling: {
        decouplingPct: 3.42,
        firstHalfEf: 0.0215,
        secondHalfEf: 0.0208,
        status: 'solid'
      },
      avgStrideM: 1.07,
      telemetrySamples,
      laps: [
        { lapIndex: 1, distanceKm: 5.0, durationSec: 1620, paceFormatted: '5:24', avgHr: 145, cadence: 176 },
        { lapIndex: 2, distanceKm: 5.0, durationSec: 1595, paceFormatted: '5:19', avgHr: 150, cadence: 177 },
        { lapIndex: 3, distanceKm: 5.0, durationSec: 1575, paceFormatted: '5:15', avgHr: 154, cadence: 178 },
        { lapIndex: 4, distanceKm: 3.0, durationSec: 930, paceFormatted: '5:10', avgHr: 158, cadence: 180 }
      ]
    },
    wellness: {
      date: isoDateOffset(0),
      hrvToday: 64,
      hrv7dAvg: 61,
      hrvStatus: 'BALANCED',
      hrvBaselineLow: 52,
      hrvBaselineHigh: 72,
      rhrToday: 49,
      rhr7dAvg: 50,
      sleepScore: 84,
      sleepHours: 7.6,
      deepSleepMin: 98,
      remSleepMin: 112,
      lightSleepMin: 246,
      avgSpO2: 97,
      avgRespiration: 14.2,
      bodyBatteryMorning: 86,
      stepsToday: 2450,
      weightKg: physiology.weightKg,
      lthrFromDevice: physiology.lthr,
      maxHrFromDevice: physiology.maxHr,
      vo2Max: 54
    }
  };
}
