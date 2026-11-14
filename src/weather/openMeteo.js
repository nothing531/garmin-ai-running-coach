/**
 * Open-Meteo 天气、露点、风速、海拔与空气质量客户端（完全免费，无需 API Key）
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * 如果用户未指定经纬度，根据城市名称查询经纬度与海拔
 */
export async function resolveLocation(locationConfig) {
  if (
    typeof locationConfig?.latitude === 'number' &&
    typeof locationConfig?.longitude === 'number'
  ) {
    return {
      city: locationConfig.cityDisplay || locationConfig.city || 'GPS 自动定位',
      latitude: locationConfig.latitude,
      longitude: locationConfig.longitude,
      elevationMeters: locationConfig.elevationMeters ?? null
    };
  }

  const query = encodeURIComponent(locationConfig?.city || 'Beijing');
  const url = `${GEOCODING_URL}?name=${query}&count=1&language=zh&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo geocoding failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  const hit = data?.results?.[0];
  if (!hit) {
    return {
      city: locationConfig?.cityDisplay || locationConfig?.city || '北京',
      latitude: 39.9042,
      longitude: 116.4074,
      elevationMeters: locationConfig?.elevationMeters ?? 45
    };
  }
  return {
    city: hit.name || locationConfig?.cityDisplay || locationConfig?.city,
    latitude: hit.latitude,
    longitude: hit.longitude,
    elevationMeters: locationConfig?.elevationMeters ?? hit.elevation ?? 0
  };
}

/**
 * 获取未来 7 天训练时段精细气象与空气质量数据
 */
export async function fetchEnvironmentForecast(locationConfig, options = {}) {
  const { preferredRunHour = 6, timezone = 'Asia/Shanghai', days = 7 } = options;
  const loc = await resolveLocation(locationConfig);

  const weatherParams = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    timezone,
    forecast_days: String(days),
    wind_speed_unit: 'ms',
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'dew_point_2m',
      'precipitation_probability',
      'wind_speed_10m',
      'wind_gusts_10m',
      'uv_index',
      'weather_code'
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'uv_index_max'
    ].join(',')
  });

  const aqiParams = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    timezone,
    forecast_days: String(Math.min(days, 5)),
    hourly: ['us_aqi', 'pm2_5', 'pm10'].join(',')
  });

  const [weatherRes, aqiRes] = await Promise.all([
    fetch(`${FORECAST_URL}?${weatherParams.toString()}`, { signal: AbortSignal.timeout(6000) }).catch(() => null),
    fetch(`${AIR_QUALITY_URL}?${aqiParams.toString()}`, { signal: AbortSignal.timeout(6000) }).catch(() => null)
  ]);

  if (!weatherRes || !weatherRes.ok) {
    return fetchWttrFallback(loc, { preferredRunHour, days });
  }
  const weather = await weatherRes.json();
  const aqi = aqiRes && aqiRes.ok ? await aqiRes.json() : null;

  const elevationMeters =
    loc.elevationMeters ?? (typeof weather.elevation === 'number' ? weather.elevation : 0);

  const dailyList = [];
  const dailyDates = weather?.daily?.time || [];
  const hourlyTimes = weather?.hourly?.time || [];
  const aqiTimes = aqi?.hourly?.time || [];

  const targetHourSuffix = `T${String(preferredRunHour).padStart(2, '0')}:00`;

  for (let i = 0; i < dailyDates.length; i++) {
    const date = dailyDates[i];
    const hourKey = `${date}${targetHourSuffix}`;
    const hIdx = hourlyTimes.indexOf(hourKey);
    const aIdx = aqiTimes.indexOf(hourKey);

    const tempC =
      hIdx >= 0 ? weather.hourly.temperature_2m[hIdx] : weather.daily.temperature_2m_min[i];
    const humidity = hIdx >= 0 ? weather.hourly.relative_humidity_2m[hIdx] : 60;
    const dewPointC = hIdx >= 0 ? weather.hourly.dew_point_2m[hIdx] : tempC - 6;
    const windMs =
      hIdx >= 0 ? weather.hourly.wind_speed_10m[hIdx] : weather.daily.wind_speed_10m_max[i];
    const gustsMs = hIdx >= 0 ? weather.hourly.wind_gusts_10m[hIdx] : windMs * 1.4;
    const precipProb =
      hIdx >= 0
        ? weather.hourly.precipitation_probability[hIdx]
        : weather.daily.precipitation_probability_max[i];
    const uvIndex = hIdx >= 0 ? weather.hourly.uv_index[hIdx] : weather.daily.uv_index_max[i];
    const weatherCode =
      hIdx >= 0 ? weather.hourly.weather_code[hIdx] : weather.daily.weather_code[i];

    const usAqi = aIdx >= 0 ? aqi.hourly.us_aqi[aIdx] : null;
    const pm25 = aIdx >= 0 ? aqi.hourly.pm2_5[aIdx] : null;

    dailyList.push({
      date,
      runWindow: `${String(preferredRunHour).padStart(2, '0')}:00`,
      weatherCode,
      weatherText: decodeWmoCode(weatherCode),
      tempC: round1(tempC),
      tempMaxC: round1(weather.daily.temperature_2m_max[i]),
      tempMinC: round1(weather.daily.temperature_2m_min[i]),
      humidityPct: Math.round(humidity ?? 60),
      dewPointC: round1(dewPointC),
      windMs: round1(windMs),
      gustsMs: round1(gustsMs),
      precipProbPct: Math.round(precipProb ?? 0),
      uvIndex: round1(uvIndex ?? 0),
      usAqi: usAqi != null ? Math.round(usAqi) : null,
      pm25: pm25 != null ? round1(pm25) : null,
      elevationMeters: Math.round(elevationMeters)
    });
  }

  return {
    location: {
      city: loc.city,
      latitude: loc.latitude,
      longitude: loc.longitude,
      elevationMeters: Math.round(elevationMeters)
    },
    today: dailyList[0] || null,
    daily: dailyList
  };
}

export function decodeWmoCode(code) {
  if (code == null) return '多云';
  if (code === 0) return '晴朗';
  if (code <= 2) return '晴间多云';
  if (code === 3) return '阴天';
  if (code === 45 || code === 48) return '大雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return '降雨';
  if (code >= 71 && code <= 77) return '降雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 85 && code <= 86) return '阵雪';
  if (code >= 95) return '雷暴';
  return '多云';
}

function round1(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

async function fetchWttrFallback(loc, { preferredRunHour = 6, days = 7 }) {
  const url = `https://wttr.in/${loc.latitude},${loc.longitude}?format=j1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`wttr.in fallback failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  const wttrDays = Array.isArray(data.weather) ? data.weather : [];
  const targetHourNum = preferredRunHour * 100;
  const dailyList = [];

  for (let i = 0; i < days; i++) {
    const baseDate = new Date(Date.now() + i * 86400_000).toISOString().slice(0, 10);
    const wDay = wttrDays[i] || wttrDays[wttrDays.length - 1];
    if (!wDay) break;

    const hourly = Array.isArray(wDay.hourly) ? wDay.hourly : [];
    const slot =
      hourly.reduce((best, cur) => {
        const diffCur = Math.abs(Number(cur.time || 0) - targetHourNum);
        const diffBest = best ? Math.abs(Number(best.time || 0) - targetHourNum) : Infinity;
        return diffCur < diffBest ? cur : best;
      }, null) || hourly[0] || {};

    const tempC = Number(slot.tempC ?? wDay.avgtempC ?? 14);
    const humidity = Number(slot.humidity ?? 55);
    const dewPointC = Number(slot.DewPointC ?? Math.round((tempC - (100 - humidity) / 5) * 10) / 10);
    const windMs = Math.round((Number(slot.windspeedKmph ?? 8) / 3.6) * 10) / 10;
    const gustsMs = Math.round((Number(slot.WindGustKmph ?? 14) / 3.6) * 10) / 10;

    dailyList.push({
      date: i < wttrDays.length && wDay.date ? wDay.date : baseDate,
      runWindow: `${String(preferredRunHour).padStart(2, '0')}:00`,
      weatherCode: Number(slot.weatherCode ?? 116),
      weatherText: slot.weatherDesc?.[0]?.value || '多云',
      tempC: round1(tempC),
      tempMaxC: round1(Number(wDay.maxtempC ?? tempC + 4)),
      tempMinC: round1(Number(wDay.mintempC ?? tempC - 4)),
      humidityPct: Math.round(humidity),
      dewPointC: round1(dewPointC),
      windMs,
      gustsMs,
      precipProbPct: Math.round(Number(slot.chanceofrain ?? 10)),
      uvIndex: round1(Number(slot.uvIndex ?? wDay.uvIndex ?? 2)),
      usAqi: null,
      pm25: null,
      elevationMeters: Math.round(loc.elevationMeters ?? 0)
    });
  }

    const wttrCity =
    data?.nearest_area?.[0]?.areaName?.[0]?.value || loc.city || 'GPS 自动定位';

  return {
    location: {
      city: loc.city && loc.city !== 'GPS 自动定位' ? loc.city : wttrCity,
      latitude: loc.latitude,
      longitude: loc.longitude,
      elevationMeters: Math.round(loc.elevationMeters ?? 0)
    },
    today: dailyList[0] || null,
    daily: dailyList
  };
}
