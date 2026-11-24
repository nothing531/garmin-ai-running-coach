import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchGarminData, generateDemoTelemetry } from './garmin/client.js';
import { fetchEnvironmentForecast } from './weather/openMeteo.js';
import {
  computeEnvironmentalAdjustment,
  computePmcSeries,
  computeWeeklyAndZones,
  evaluateReadiness,
  getLocalIsoDate
} from './science/metrics.js';
import { buildDeterministicCoachPlan } from './coach/planner.js';
import { assertCoachPlanPassed } from './coach/planRules.js';
import { renderDashboardHtml } from './render/dashboard.js';
import { sendNotifications } from './notify/push.js';
import { syncCoachWorkoutsToGarmin } from './garmin/workoutSync.js';
import { loadCheckins } from './storage/checkins.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..');

export function getCheckinsFilePath(rootDir = DEFAULT_ROOT_DIR) {
  return process.env.CHECKIN_FILE
    ? path.resolve(rootDir, process.env.CHECKIN_FILE)
    : path.join(rootDir, 'data', 'private', 'checkins.json');
}

export function getPrivateDashboardPath(rootDir = DEFAULT_ROOT_DIR) {
  return path.join(rootDir, 'data', 'private', 'dashboard-payload.json');
}

function getTelemetryCachePath(rootDir = DEFAULT_ROOT_DIR) {
  return path.join(rootDir, 'data', 'private', 'telemetry-cache.json');
}

/**
 * 公开输出严格白名单：
 * 绝不向公开 HTML 或 dist/data/latest.json 写入日记、疼痛、身体指标、GPS 或含个人隐私的教练总结
 */
export function buildPublicDashboardPayload(privatePayload = {}) {
  const envToday = privatePayload.envToday || privatePayload.envForecast?.today || null;
  return {
    publicMode: true,
    authRequired: true,
    generatedAt: privatePayload.generatedAt || null,
    appTitle: 'AI Running Coach',
    locationCity: privatePayload.envForecast?.location?.city || null,
    weatherSummary: envToday && !envToday.weatherUnavailable
      ? {
          date: envToday.date,
          weatherText: envToday.weatherText,
          tempC: envToday.tempC,
          humidityPct: envToday.humidityPct,
          windMs: envToday.windMs
        }
      : null,
    message: '私人训练与健康数据已受访问保护，请登录后通过受保护接口读取。'
  };
}

async function savePrivateJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmpPath, filePath);
  await fs.chmod(filePath, 0o600).catch(() => {});
}

export async function loadDotEnv(rootDir = DEFAULT_ROOT_DIR) {
  const envPath = path.join(rootDir, '.env');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
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
    // .env 不存在时忽略（例如在 GitHub Actions 中直接读取 Secrets）
  }
}

async function loadCustomPlan(rootDir = DEFAULT_ROOT_DIR) {
  const customPlanPath = path.join(rootDir, 'config', 'custom-plan.json');
  try {
    const raw = await fs.readFile(customPlanPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.warn(`[Coach] Failed to load config/custom-plan.json (${err.message}); falling back to template plan.`);
    }
    return null;
  }
}

async function loadTelemetryCache(cachePath) {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.garmin && parsed.envForecast) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveTelemetryCache(cachePath, garmin, envForecast) {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(
      tmpPath,
      JSON.stringify({ cachedAt: new Date().toISOString(), garmin, envForecast }),
      'utf8'
    );
    await fs.rename(tmpPath, cachePath);
  } catch (err) {
    console.warn(`[Cache] Failed to save telemetry cache: ${err.message}`);
  }
}

async function syncDistToPublishDir(distDir, publishDir) {
  if (!publishDir) return;
  const targetDataDir = path.join(publishDir, 'data');
  await fs.mkdir(targetDataDir, { recursive: true });
  await fs.copyFile(path.join(distDir, 'index.html'), path.join(publishDir, 'index.html'));
  await fs.copyFile(path.join(distDir, 'data', 'latest.json'), path.join(targetDataDir, 'latest.json'));
}

export function reanchorEnvForecastToToday(
  envForecast,
  tz = 'Asia/Shanghai',
  now = new Date(),
  locFallback = null,
  preferredRunHour = 6
) {
  const dailyMap = new Map();
  for (const item of envForecast?.daily || []) {
    if (item?.date) dailyMap.set(String(item.date).slice(0, 10), item);
  }
  const loc = envForecast?.location || locFallback || {};
  const elev = loc?.elevationMeters ?? null;
  const runWin = `${String(preferredRunHour).padStart(2, '0')}:00`;
  const daily = [];
  for (let i = 0; i < 7; i++) {
    const dateIso = getLocalIsoDate(i, tz, now);
    const hit = dailyMap.get(dateIso);
    if (hit) {
      daily.push(hit);
    } else {
      daily.push({
        date: dateIso,
        runWindow: runWin,
        weatherCode: null,
        weatherText: '气象数据暂不可用',
        weatherUnavailable: true,
        tempC: null,
        tempMaxC: null,
        tempMinC: null,
        humidityPct: null,
        dewPointC: null,
        windMs: null,
        gustsMs: null,
        precipProbPct: null,
        uvIndex: null,
        usAqi: null,
        pm25: null,
        elevationMeters: elev
      });
    }
  }
  const hasAnyAvailable = daily.some((d) => !d.weatherUnavailable && typeof d.tempC === 'number');
  return {
    location: {
      city: loc?.cityDisplay || loc?.city || '未知城市',
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
      elevationMeters: elev
    },
    weatherAvailable: hasAnyAvailable,
    weatherUnavailable: !hasAnyAvailable,
    today: daily[0],
    daily
  };
}

export async function runCoachPipeline(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT_DIR;
  await loadDotEnv(rootDir);

  const isDemo = Boolean(options.isDemo);
  const skipNetworkFetch = Boolean(options.skipNetworkFetch || options.renderOnly);
  const skipNotify = Boolean(options.skipNotify || options.renderOnly);
  const shouldSyncWorkouts = Boolean(options.syncWorkouts);
  const publishDir = options.publishDir ?? process.env.PUBLISH_DIR ?? '';
  const checkinsPath = options.checkinsPath || getCheckinsFilePath(rootDir);
  const privateDashboardPath = options.privateDashboardPath || getPrivateDashboardPath(rootDir);
  const now = options.now instanceof Date ? options.now : new Date();

  const configPath = path.join(rootDir, 'config', 'runner.config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const tz = config.timezone || 'Asia/Shanghai';
  const trueTodayIso = getLocalIsoDate(0, tz, now);
  const customPlan = await loadCustomPlan(rootDir);
  const checkins = await loadCheckins(checkinsPath);

  const cachePath = getTelemetryCachePath(rootDir);
  const cached = skipNetworkFetch && !isDemo ? await loadTelemetryCache(cachePath) : null;

  let garmin;
  let envForecast;

  if (cached) {
    console.log('[1/5] Using cached Garmin & Open-Meteo telemetry for rapid diary recalculation...');
    garmin = cached.garmin;
    envForecast = cached.envForecast;
  } else {
    console.log(`[1/5] Loading Garmin telemetry (${isDemo ? 'DEMO mode' : config.region})...`);
    garmin = isDemo ? generateDemoTelemetry(config) : await fetchGarminData(config);

    // 若配置未固定经纬度，则自动从 Garmin 最近一条带 GPS 的活动提取真实坐标、城市名与海拔
    const latestGeoRun = garmin.activities.find(
      (a) => typeof a.startLatitude === 'number' && typeof a.startLongitude === 'number'
    );
    const fitElevSample = garmin.lastKeyWorkoutAudit?.telemetrySamples?.find(
      (s) => typeof s.altitude === 'number' && s.altitude > 0
    )?.altitude;
    const inferredCity = latestGeoRun?.name
      ? String(latestGeoRun.name).split(/\s+/)[0]
      : null;

    const locationQuery =
      config.location?.latitude != null && config.location?.longitude != null
        ? config.location
        : latestGeoRun
          ? {
              ...config.location,
              cityDisplay: config.location?.cityDisplay || inferredCity,
              latitude: latestGeoRun.startLatitude,
              longitude: latestGeoRun.startLongitude,
              elevationMeters:
                config.location?.elevationMeters ??
                (fitElevSample != null ? Math.round(fitElevSample) : null)
            }
          : config.location;

    console.log('[2/5] Fetching weather, dew point, elevation & air quality from Open-Meteo...');
    const preferredRunHour = config.schedule?.preferredRunHour ?? 6;
    try {
      envForecast = await fetchEnvironmentForecast(locationQuery, {
        preferredRunHour,
        timezone: config.timezone || 'Asia/Shanghai',
        days: 7
      });
    } catch (err) {
      console.warn(`[Weather] Open-Meteo unavailable (${err.message}), marking weather as unavailable.`);
      envForecast = buildOfflineWeatherFallback(locationQuery, tz, now, preferredRunHour);
    }

    if (!isDemo) {
      await saveTelemetryCache(cachePath, garmin, envForecast);
    }
  }

  console.log('[3/5] Computing Banister PMC, ACWR, 80/20 zones & readiness...');
  const physiology = {
    ...config.physiology,
    timeZone: tz,
    lthr: garmin.wellness?.lthrFromDevice ?? config.physiology?.lthr,
    maxHr: garmin.wellness?.maxHrFromDevice ?? config.physiology?.maxHr,
    weightKg: garmin.wellness?.weightKg ?? config.physiology?.weightKg
  };

  // 以真实当前日期重锚定气象与准备度检查，杜绝旧缓存日期自洽骗过新鲜度校验
  envForecast = reanchorEnvForecastToToday(
    envForecast,
    tz,
    now,
    config.location,
    config.schedule?.preferredRunHour ?? 6
  );

  const pmc = computePmcSeries(garmin.activities, physiology, 56, now);
  const weeklyZones = computeWeeklyAndZones(garmin.activities, physiology, now);
  const envToday = envForecast.today;
  const readiness = evaluateReadiness(garmin.wellness, pmc.latest, { expectedDate: trueTodayIso });
  const envAdjustmentToday = computeEnvironmentalAdjustment(envToday);

  console.log(
    `      Readiness: ${readiness.score ?? '--'}/100 (${readiness.lightLabel}) | CTL=${pmc.latest.ctl}, ATL=${pmc.latest.atl}, ACWR=${pmc.latest.acwr}`
  );

  console.log('[4/5] Generating periodized differentiated running plan...');
  const generatePlanFn = typeof options._generateCoachPlanFn === 'function'
    ? options._generateCoachPlanFn
    : buildDeterministicCoachPlan;
  const coachPlan = await generatePlanFn(
    {
      todayStr: trueTodayIso,
      readiness,
      pmc,
      weeklyZones,
      wellness: garmin.wellness,
      envForecast,
      lastKeyWorkoutAudit: garmin.lastKeyWorkoutAudit,
      customPlan,
      checkins
    },
    config
  );

  assertCoachPlanPassed(coachPlan, {
    requireReport: true,
    action: '保存私有数据、发布页面、通知与 Garmin 同步'
  });

  const generatedAt = new Date().toLocaleString('zh-CN', {
    timeZone: config.timezone || 'Asia/Shanghai',
    hour12: false
  });

  const payload = {
    generatedAt,
    dataSource: garmin.source,
    config,
    wellness: garmin.wellness,
    readiness,
    pmc,
    weeklyZones,
    lastKeyWorkoutAudit: garmin.lastKeyWorkoutAudit,
    envForecast,
    envToday,
    envAdjustmentToday,
    coachPlan,
    checkins: checkins.slice(0, 30)
  };

  console.log('[5/5] Writing private payload and sanitized public dashboard to dist/...');
  await savePrivateJson(privateDashboardPath, payload);

  const publicPayload = buildPublicDashboardPayload(payload);
  const distDir = path.join(rootDir, 'dist');
  const dataDir = path.join(distDir, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  const html = renderDashboardHtml(payload, { includePrivate: false });
  await fs.writeFile(path.join(distDir, 'index.html'), html, 'utf8');
  await fs.writeFile(path.join(dataDir, 'latest.json'), JSON.stringify(publicPayload, null, 2), 'utf8');
  await syncDistToPublishDir(distDir, publishDir);

  if (!isDemo && !skipNotify) {
    const pushResults = await sendNotifications(payload, process.env.DASHBOARD_URL || '');
    if (pushResults.length > 0) {
      console.log('[Notify] Push results:', JSON.stringify(pushResults));
    }
  }

  const doSyncWorkouts =
    !isDemo &&
    (shouldSyncWorkouts ||
      process.argv.includes('--sync-workouts') ||
      String(process.env.GARMIN_SYNC_WORKOUTS || '').toLowerCase() === 'true');

  if (doSyncWorkouts) {
    try {
      const syncResult = await syncCoachWorkoutsToGarmin(coachPlan, {
        days: Number(process.env.GARMIN_SYNC_DAYS || 5),
        requireValidatedPlan: true,
        auth: {
          region: config.region || 'cn',
          email: process.env.GARMIN_EMAIL,
          password: process.env.GARMIN_PASSWORD,
          sessionJson: process.env.GARMIN_SESSION_JSON
        }
      });
      console.log(
        `[GarminSync] Synced ${syncResult.synced.length} workout(s), deleted ${syncResult.deletedCount} stale.`
      );
    } catch (err) {
      console.warn(`[GarminSync] Workout sync skipped/failed: ${err.message}`);
    }
  }

  console.log(`Done! Dashboard saved at: ${path.join(distDir, 'index.html')}`);
  return payload;
}

export function buildOfflineWeatherFallback(
  loc,
  tz = 'Asia/Shanghai',
  now = new Date(),
  preferredRunHour = 6
) {
  const daily = [];
  const elev = loc?.elevationMeters ?? null;
  const runWin = `${String(preferredRunHour).padStart(2, '0')}:00`;
  for (let i = 0; i < 7; i++) {
    const d = getLocalIsoDate(i, tz, now);
    daily.push({
      date: d,
      runWindow: runWin,
      weatherCode: null,
      weatherText: '气象接口暂不可用',
      weatherUnavailable: true,
      tempC: null,
      tempMaxC: null,
      tempMinC: null,
      humidityPct: null,
      dewPointC: null,
      windMs: null,
      gustsMs: null,
      precipProbPct: null,
      uvIndex: null,
      usAqi: null,
      pm25: null,
      elevationMeters: elev
    });
  }
  return {
    location: {
      city: loc?.cityDisplay || loc?.city || '未知城市',
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
      elevationMeters: elev
    },
    weatherAvailable: false,
    weatherUnavailable: true,
    today: daily[0],
    daily
  };
}

const isCliEntry = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCliEntry) {
  runCoachPipeline({
    isDemo: process.argv.includes('--demo'),
    renderOnly: process.argv.includes('--render-only'),
    syncWorkouts: process.argv.includes('--sync-workouts')
  }).catch((err) => {
    console.error('[Fatal]', err);
    process.exit(1);
  });
}
