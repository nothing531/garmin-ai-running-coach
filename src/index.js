import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchGarminData, generateDemoTelemetry } from './garmin/client.js';
import { fetchEnvironmentForecast } from './weather/openMeteo.js';
import {
  computeEnvironmentalAdjustment,
  computePmcSeries,
  computeWeeklyAndZones,
  evaluateReadiness
} from './science/metrics.js';
import { generateCoachPlan } from './coach/planner.js';
import { renderDashboardHtml } from './render/dashboard.js';
import { sendNotifications } from './notify/push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

async function loadDotEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
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

async function main() {
  await loadDotEnv();
  const isDemo = process.argv.includes('--demo');

  const configPath = path.join(ROOT_DIR, 'config', 'runner.config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));

  console.log(`[1/5] Loading Garmin telemetry (${isDemo ? 'DEMO mode' : config.region})...`);
  const garmin = isDemo ? generateDemoTelemetry(config) : await fetchGarminData(config);

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
  let envForecast;
  try {
    envForecast = await fetchEnvironmentForecast(locationQuery, {
      preferredRunHour: config.schedule?.preferredRunHour ?? 6,
      timezone: config.timezone || 'Asia/Shanghai',
      days: 7
    });
  } catch (err) {
    console.warn(`[Weather] Open-Meteo unavailable (${err.message}), using neutral fallback weather.`);
    envForecast = buildOfflineWeatherFallback(locationQuery);
  }

  console.log('[3/5] Computing Banister PMC, ACWR, 80/20 zones & readiness...');
  const physiology = {
    ...config.physiology,
    lthr: garmin.wellness?.lthrFromDevice ?? config.physiology?.lthr,
    maxHr: garmin.wellness?.maxHrFromDevice ?? config.physiology?.maxHr,
    weightKg: garmin.wellness?.weightKg ?? config.physiology?.weightKg
  };

  const pmc = computePmcSeries(garmin.activities, physiology, 56);
  const weeklyZones = computeWeeklyAndZones(garmin.activities, physiology);
  const readiness = evaluateReadiness(garmin.wellness, pmc.latest);
  const envToday = envForecast.today;
  const envAdjustmentToday = computeEnvironmentalAdjustment(envToday);

  console.log(
    `      Readiness: ${readiness.score}/100 (${readiness.lightLabel}) | CTL=${pmc.latest.ctl}, ATL=${pmc.latest.atl}, ACWR=${pmc.latest.acwr}`
  );

  console.log('[4/5] Generating periodized differentiated running plan...');
  const coachPlan = await generateCoachPlan(
    {
      readiness,
      pmc,
      weeklyZones,
      wellness: garmin.wellness,
      envForecast,
      lastKeyWorkoutAudit: garmin.lastKeyWorkoutAudit
    },
    config
  );

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
    coachPlan
  };

  console.log('[5/5] Rendering interactive HTML dashboard to dist/index.html...');
  const distDir = path.join(ROOT_DIR, 'dist');
  const dataDir = path.join(distDir, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  const html = renderDashboardHtml(payload);
  await fs.writeFile(path.join(distDir, 'index.html'), html, 'utf8');
  await fs.writeFile(path.join(dataDir, 'latest.json'), JSON.stringify(payload, null, 2), 'utf8');

  if (!isDemo) {
    const pushResults = await sendNotifications(payload, process.env.DASHBOARD_URL || '');
    if (pushResults.length > 0) {
      console.log('[Notify] Push results:', JSON.stringify(pushResults));
    }
  }

  console.log(`Done! Dashboard saved at: ${path.join(distDir, 'index.html')}`);
}

function buildOfflineWeatherFallback(loc) {
  const daily = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 86400_000).toISOString().slice(0, 10);
    daily.push({
      date: d,
      runWindow: '06:00',
      weatherCode: 1,
      weatherText: '晴间多云',
      tempC: 12,
      tempMaxC: 18,
      tempMinC: 8,
      humidityPct: 55,
      dewPointC: 4,
      windMs: 2.3,
      gustsMs: 4.1,
      precipProbPct: 10,
      uvIndex: 3,
      usAqi: 42,
      pm25: 11,
      elevationMeters: loc?.elevationMeters ?? 45
    });
  }
  return {
    location: {
      city: loc?.cityDisplay || loc?.city || '北京',
      latitude: loc?.latitude ?? 39.9042,
      longitude: loc?.longitude ?? 116.4074,
      elevationMeters: loc?.elevationMeters ?? 45
    },
    today: daily[0],
    daily
  };
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
