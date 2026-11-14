/**
 * 运动生理学与训练科学计算引擎
 * - Banister PMC (CTL 42d / ATL 7d / TSB / ACWR)
 * - 有氧解耦率 (Aerobic Decoupling Pa:Hr)
 * - 心率区间分布 (80/20 Polarization)
 * - 晨间红绿灯自适应机制 (Traffic Light Readiness)
 * - 天气露点 / 海拔 / 风速 / AQI 环境配速修正
 */

export function formatPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '--:--';
  const rounded = Math.round(secPerKm);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * 解析配速（支持数字秒数或 "5:30" / "5:30/km" 字符串）为秒/公里
 */
export function parsePaceSecPerKm(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const mins = Number(match[1]);
  const secs = Number(match[2]);
  if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) return null;
  const total = mins * 60 + secs;
  return total > 0 ? total : null;
}

export function cToF(c) {
  return (c * 9) / 5 + 32;
}

/**
 * 估算单次跑步的相对训练负荷 (rTSS / hrTSS 近似模型)
 */
export function estimateSessionLoad(activity, physiology = {}) {
  const durationSec = Number(activity.durationSec || activity.movingDurationSec || 0);
  if (durationSec <= 0) return 0;

  const durationHours = durationSec / 3600;
  const maxHr = physiology.maxHr || 190;
  const rhr = physiology.restingHrBaseline || 50;
  const lthr = physiology.lthr || Math.round(rhr + (maxHr - rhr) * 0.85);
  const avgHr = Number(activity.averageHr || 0);

  // 优先基于心率储备与 LTHR 估算 hrTSS
  if (avgHr > rhr && lthr > rhr) {
    const hrr = Math.min(1.05, Math.max(0.25, (avgHr - rhr) / (maxHr - rhr)));
    const ltHrr = Math.max(0.5, (lthr - rhr) / (maxHr - rhr));
    const intensityFactor = hrr / ltHrr;
    const tss = durationHours * intensityFactor * intensityFactor * 100;
    return Math.round(tss * 10) / 10;
  }

  // 无心率数据时，基于速度与阈值配速估算 rTSS
  const distM = Number(activity.distanceMeters || 0);
  const ltPace = physiology.ltPaceSecPerKm || 270;
  if (distM > 0) {
    const paceSec = durationSec / (distM / 1000);
    const intensityFactor = Math.min(1.15, Math.max(0.45, ltPace / paceSec));
    return Math.round(durationHours * intensityFactor * intensityFactor * 100 * 10) / 10;
  }

  // 力量训练 / 交叉训练按中等强度系数估算
  return Math.round(durationHours * 45 * 10) / 10;
}

/**
 * 构建 Banister PMC 模型 (CTL 42天慢性负荷, ATL 7天急性负荷, TSB 状态平衡, ACWR)
 */
export function computePmcSeries(activities, physiology = {}, days = 56) {
  const dailyMap = new Map();

  for (const act of activities) {
    const date = String(act.date || '').slice(0, 10);
    if (!date) continue;
    const load = estimateSessionLoad(act, physiology);
    dailyMap.set(date, (dailyMap.get(date) || 0) + load);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayUtc = new Date(`${todayIso}T12:00:00Z`);
  const start = new Date(todayUtc);
  start.setUTCDate(todayUtc.getUTCDate() - (days - 1));

  // 从展示窗口前 180 天零基线自然递推 CTL/ATL，避免陈旧历史训练虚增当前体能
  const warmupDays = 180;
  const simStart = new Date(start);
  simStart.setUTCDate(start.getUTCDate() - warmupDays);

  const series = [];
  let ctl = 0;
  let atl = 0;

  const kCtl = 1 / 42;
  const kAtl = 1 / 7;
  const totalSimDays = warmupDays + days;

  for (let i = 0; i < totalSimDays; i++) {
    const d = new Date(simStart);
    d.setUTCDate(simStart.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const tss = Math.round((dailyMap.get(iso) || 0) * 10) / 10;

    ctl = ctl + (tss - ctl) * kCtl;
    atl = atl + (tss - atl) * kAtl;

    if (i < warmupDays) continue;

    const tsb = ctl - atl;
    const acwr = ctl > 1 ? atl / ctl : (atl > 0 ? 1 : 0);

    series.push({
      date: iso,
      tss,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      acwr: Math.round(acwr * 100) / 100
    });
  }

  const latest = series[series.length - 1] || {
    ctl: 0,
    atl: 0,
    tsb: 0,
    acwr: 0
  };

  return {
    series,
    latest
  };
}

/**
 * 基于 .FIT 逐秒记录流计算有氧解耦率 (Aerobic Decoupling Pa:Hr)
 * @param {Array<{speedMs: number, hr: number}>} records
 */
export function computeAerobicDecoupling(records) {
  if (!Array.isArray(records) || records.length < 40) return null;

  const valid = records.filter(
    (r) => Number.isFinite(r.speedMs) && r.speedMs > 1.0 && Number.isFinite(r.hr) && r.hr > 60
  );
  if (valid.length < 40) return null;

  // 跳过前 5 分钟（近似前 10% 热身段），避免热身期心率爬坡干扰
  const startIdx = Math.floor(valid.length * 0.1);
  const steady = valid.slice(startIdx);
  if (steady.length < 30) return null;

  const mid = Math.floor(steady.length / 2);
  const firstHalf = steady.slice(0, mid);
  const secondHalf = steady.slice(mid);

  const avgEf = (arr) => {
    const sumSpeed = arr.reduce((s, r) => s + r.speedMs, 0);
    const sumHr = arr.reduce((s, r) => s + r.hr, 0);
    return sumHr > 0 ? sumSpeed / sumHr : 0;
  };

  const ef1 = avgEf(firstHalf);
  const ef2 = avgEf(secondHalf);
  if (ef1 <= 0) return null;

  const decouplingPct = ((ef1 - ef2) / ef1) * 100;
  return {
    decouplingPct: Math.round(decouplingPct * 100) / 100,
    firstHalfEf: Math.round(ef1 * 10000) / 10000,
    secondHalfEf: Math.round(ef2 * 10000) / 10000,
    status: decouplingPct <= 5 ? 'solid' : decouplingPct <= 8 ? 'mild_drift' : 'high_drift'
  };
}

/**
 * 根据 3 区间占比计算 Treff (2019) 极化指数 Polarization Index (a.U.) 与分布类型
 * Eq.1 (Z2 > 0): PI = log10((Z1 / Z2) * Z3 * 100)
 * Eq.2 (Z2 == 0): PI = log10((Z1 / 0.01) * (Z3 - 0.01) * 100)
 */
export function computePolarizationStats(zoneSeconds) {
  const actualTotal = zoneSeconds.reduce((a, b) => a + b, 0);
  if (actualTotal <= 0) {
    return {
      zonePercentages: [0, 0, 0, 0, 0],
      lowIntensityPct: 0,
      grayZonePct: 0,
      highIntensityPct: 0,
      polarizationIndex: 0,
      distributionType: 'insufficient_data',
      isPolarized: false
    };
  }

  const zonePercentages = zoneSeconds.map((s) => Math.round((s / actualTotal) * 1000) / 10);
  const z1 = (zoneSeconds[0] + zoneSeconds[1]) / actualTotal;
  const z2 = zoneSeconds[2] / actualTotal;
  const z3 = (zoneSeconds[3] + zoneSeconds[4]) / actualTotal;

  const lowIntensityPct = Math.round(z1 * 1000) / 10;
  const grayZonePct = Math.round(z2 * 1000) / 10;
  const highIntensityPct = Math.round(z3 * 1000) / 10;

  let rawPi = 0;
  if (z1 > 0 && z3 > 0) {
    if (z2 === 0) {
      rawPi = z3 > 0.01 ? (z1 / 0.01) * (z3 - 0.01) * 100 : 0;
    } else {
      rawPi = (z1 / z2) * z3 * 100;
    }
  }
  const polarizationIndex = rawPi > 0 ? Math.round(Math.log10(rawPi) * 100) / 100 : 0;
  const isPolarized = z1 > z3 && z3 > z2 && polarizationIndex > 2.0;

  let distributionType = 'mixed';
  if (isPolarized) {
    distributionType = 'polarized';
  } else if (z1 > z2 && z2 >= z3) {
    distributionType = z3 === 0 ? 'low_intensity_base' : 'pyramidal';
  } else if (z2 >= z1 && z2 >= z3) {
    distributionType = 'threshold';
  }

  return {
    zonePercentages,
    lowIntensityPct,
    grayZonePct,
    highIntensityPct,
    polarizationIndex,
    distributionType,
    isPolarized
  };
}

/**
 * 统计近 8 个自然周按周跑量 & 80/20 心率区间分布
 */
export function computeWeeklyAndZones(activities, physiology = {}) {
  const maxHr = physiology.maxHr || 190;
  const rhr = physiology.restingHrBaseline || 50;
  const lthr = physiology.lthr || Math.round(rhr + (maxHr - rhr) * 0.85);

  // 5-Zone 基于 LTHR 模型 (Joe Friel / Garmin)
  const zBoundaries = [
    Math.round(lthr * 0.81), // Z1 上限
    Math.round(lthr * 0.89), // Z2 上限
    Math.round(lthr * 0.93), // Z3 上限
    Math.round(lthr * 0.99)  // Z4 上限 (以上为 Z5)
  ];

  const zoneSeconds = [0, 0, 0, 0, 0];
  const weekBuckets = new Map();

  // 严格锚定截至本周的最近 8 个自然周（按周一对齐），无记录周补 0
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayUtc = new Date(`${todayIso}T12:00:00Z`);
  const diffToCurrentMon = (todayUtc.getUTCDay() + 6) % 7;
  const currentMon = new Date(todayUtc);
  currentMon.setUTCDate(todayUtc.getUTCDate() - diffToCurrentMon);

  const recentWeekKeys = [];
  for (let w = 7; w >= 0; w--) {
    const mon = new Date(currentMon);
    mon.setUTCDate(currentMon.getUTCDate() - w * 7);
    const weekKey = mon.toISOString().slice(0, 10);
    recentWeekKeys.push(weekKey);
    weekBuckets.set(weekKey, {
      weekStart: weekKey,
      distanceKm: 0,
      durationMin: 0,
      elevationGainM: 0,
      sessions: 0
    });
  }

  for (const act of activities) {
    if (!act.isRun) continue;
    const dateStr = String(act.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    const d = new Date(`${dateStr}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    // 对齐到周一作为 weekKey
    const diffToMon = (d.getUTCDay() + 6) % 7;
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() - diffToMon);
    const weekKey = mon.toISOString().slice(0, 10);

    // 仅统计最近 8 个自然周内的训练（同时过滤跨年/过往历史）
    if (!weekBuckets.has(weekKey)) continue;

    const bucket = weekBuckets.get(weekKey);
    bucket.distanceKm += (act.distanceMeters || 0) / 1000;
    bucket.durationMin += (act.durationSec || 0) / 60;
    bucket.elevationGainM += act.elevationGainM || 0;
    bucket.sessions += 1;

    // 优先使用自带分Zone时长，否则按平均心率估算归类
    if (Array.isArray(act.hrZonesSec) && act.hrZonesSec.length === 5) {
      for (let i = 0; i < 5; i++) {
        zoneSeconds[i] += act.hrZonesSec[i] || 0;
      }
    } else if (act.averageHr && act.durationSec) {
      const hr = act.averageHr;
      let zIdx = 4;
      if (hr <= zBoundaries[0]) zIdx = 0;
      else if (hr <= zBoundaries[1]) zIdx = 1;
      else if (hr <= zBoundaries[2]) zIdx = 2;
      else if (hr <= zBoundaries[3]) zIdx = 3;
      zoneSeconds[zIdx] += act.durationSec;
    }
  }

  const polStats = computePolarizationStats(zoneSeconds);

  const weekly = recentWeekKeys.map((weekKey) => {
    const w = weekBuckets.get(weekKey);
    return {
      ...w,
      distanceKm: Math.round(w.distanceKm * 10) / 10,
      durationMin: Math.round(w.durationMin),
      elevationGainM: Math.round(w.elevationGainM)
    };
  });

  return {
    weekly,
    zoneBoundaries: zBoundaries,
    zonePercentages: polStats.zonePercentages,
    polarization: {
      lowIntensityPct: polStats.lowIntensityPct,
      grayZonePct: polStats.grayZonePct,
      highIntensityPct: polStats.highIntensityPct,
      polarizationIndex: polStats.polarizationIndex,
      distributionType: polStats.distributionType,
      isPolarized: polStats.isPolarized
    }
  };
}

/**
 * 计算当天环境的配速修正系数 (温度+露点, 海拔, 风速, AQI)
 */
export function computeEnvironmentalAdjustment(envDay) {
  if (!envDay) {
    return {
      slowdownPct: 0,
      heatIndexSumF: null,
      altitudePct: 0,
      windWarning: false,
      indoorRecommended: false,
      summary: '环境温和，按基准配速执行'
    };
  }

  const tempF = cToF(envDay.tempC ?? 18);
  const dewF = cToF(envDay.dewPointC ?? 10);
  const heatSum = Math.round(tempF + dewF);

  let heatPct = 0;
  if (heatSum > 140) heatPct = 5.0;
  else if (heatSum > 130) heatPct = 2.75;
  else if (heatSum > 120) heatPct = 1.5;
  else if (heatSum > 110) heatPct = 0.75;

  const elev = envDay.elevationMeters || 0;
  const altitudePct = elev > 1000 ? Math.round(((elev - 1000) / 1000) * 4.5 * 10) / 10 : 0;

  const windWarning = (envDay.windMs || 0) >= 5.0;
  const aqi = envDay.usAqi ?? 50;
  const weatherCode = envDay.weatherCode ?? 0;
  const indoorRecommended = aqi > 150 || weatherCode >= 95;

  const slowdownPct = Math.round((heatPct + altitudePct) * 10) / 10;

  const reasons = [];
  if (heatPct > 0) reasons.push(`热湿指数 ${heatSum}°F (配速放慢 ${heatPct}%)`);
  if (altitudePct > 0) reasons.push(`海拔 ${elev}m (配速放慢 ${altitudePct}%)`);
  if (windWarning) reasons.push(`风速 ${envDay.windMs}m/s，逆风段按心率控制`);
  if (aqi > 150) reasons.push(`AQI ${aqi} 空气污染预警，建议改室内跑步机`);
  if (weatherCode >= 95) reasons.push('雷暴天气预警，强制切换室内方案');

  return {
    slowdownPct,
    heatIndexSumF: heatSum,
    heatPct,
    altitudePct,
    windWarning,
    indoorRecommended,
    summary: reasons.length > 0 ? reasons.join('；') : '温湿度与空气质量极佳，适合按基准配速冲刺'
  };
}

/**
 * 晨间「红绿灯」生理准备度评分与自动调课判断
 */
export function evaluateReadiness(wellness, pmcLatest) {
  const hrvCurrent = wellness?.hrvToday ?? wellness?.hrv7dAvg ?? 55;
  const hrvBaseline = wellness?.hrv7dAvg ?? hrvCurrent;
  const hrvRatio = hrvBaseline > 0 ? hrvCurrent / hrvBaseline : 1;

  const sleepScore = wellness?.sleepScore ?? 78;
  const bodyBattery = wellness?.bodyBatteryMorning ?? 75;
  const rhrCurrent = wellness?.rhrToday ?? wellness?.rhr7dAvg ?? 50;
  const rhrBaseline = wellness?.rhr7dAvg ?? rhrCurrent;
  const rhrDelta = rhrCurrent - rhrBaseline;
  const acwr = pmcLatest?.acwr ?? 1.0;

  // 综合评分 (0-100)
  let score = 80;
  score += Math.max(-20, Math.min(12, (hrvRatio - 1) * 80));
  score += Math.max(-15, Math.min(10, (sleepScore - 75) * 0.5));
  score += Math.max(-15, Math.min(10, (bodyBattery - 70) * 0.4));
  if (rhrDelta > 0) score -= Math.min(20, rhrDelta * 3.5);
  if (acwr > 1.35) score -= Math.min(18, (acwr - 1.35) * 45);
  else if (acwr < 0.75) score += 2;
  score = Math.round(Math.max(15, Math.min(99, score)));

  // 红绿灯规则
  let light = 'green';
  const triggers = [];

  if (hrvRatio < 0.85 || rhrDelta >= 5 || bodyBattery < 50 || acwr > 1.35 || sleepScore < 60) {
    light = 'red';
    if (hrvRatio < 0.85) triggers.push(`HRV 跌破基线 (${hrvCurrent}ms vs ${hrvBaseline}ms)`);
    if (rhrDelta >= 5) triggers.push(`晨脉飙升 +${rhrDelta} bpm`);
    if (bodyBattery < 50) triggers.push(`晨起身体电量过低 (${bodyBattery})`);
    if (acwr > 1.35) triggers.push(`ACWR=${acwr} 进入高负荷伤病预警区`);
    if (sleepScore < 60) triggers.push(`睡眠评分过低 (${sleepScore})`);
  } else if (hrvRatio < 0.94 || rhrDelta >= 3 || bodyBattery < 65 || sleepScore < 75 || acwr > 1.25) {
    light = 'yellow';
    if (hrvRatio < 0.94) triggers.push('HRV 处于基线下沿');
    if (rhrDelta >= 3) triggers.push(`静息心率略偏高 (+${rhrDelta} bpm)`);
    if (bodyBattery < 65) triggers.push(`身体电量一般 (${bodyBattery})`);
    if (sleepScore < 75) triggers.push(`睡眠评分不足 (${sleepScore})`);
    if (acwr > 1.25) triggers.push(`ACWR=${acwr} 负荷偏高`);
  } else {
    triggers.push('HRV、晨脉、睡眠与负荷比均处于理想区间');
  }

  return {
    light,
    lightLabel: light === 'green' ? '绿灯 · 全力推进' : light === 'yellow' ? '黄灯 · 降量控强' : '红灯 · 强制恢复',
    score,
    hrvRatio: Math.round(hrvRatio * 100) / 100,
    rhrDelta: Math.round(rhrDelta * 10) / 10,
    triggers
  };
}
