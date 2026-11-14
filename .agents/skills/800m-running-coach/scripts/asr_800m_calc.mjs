#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

/**
 * 解析 M:SS(.d) 或纯秒数字符串为秒
 */
export function parseTimeSec(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val || '').trim();
  if (!s) return NaN;
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(Number);
    if (!Number.isFinite(m) || !Number.isFinite(sec)) return NaN;
    return m * 60 + sec;
  }
  return Number(s);
}

/**
 * 格式化秒为 M:SS.d 或 SS.d
 */
export function formatTimeSec(totalSec, decimals = 1) {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return '—';
  if (totalSec < 60) return `${totalSec.toFixed(decimals)}s`;
  const mins = Math.floor(totalSec / 60);
  const rem = totalSec - mins * 60;
  const remStr = decimals > 0 ? rem.toFixed(decimals).padStart(decimals + 3, '0') : String(Math.round(rem)).padStart(2, '0');
  return `${mins}:${remStr}`;
}

/**
 * 格式化 m/s 为每公里配速 (M:SS/km)
 */
export function speedToPacePerKm(mps) {
  if (!Number.isFinite(mps) || mps <= 0) return '—';
  const secPerKm = 1000 / mps;
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm - mins * 60);
  if (secs === 60) return `${mins + 1}:00/km`;
  return `${mins}:${String(secs).padStart(2, '0')}/km`;
}

/**
 * 根据场地测验推算 MAS (m/s)
 * - 1200–2200m 使用 Bellenger et al. (2015) / Sandford (2019) 验证公式:
 *   MAS = v_avg * (0.766 + 0.117 * distance_km)
 * - 3000m 使用经验系数 ~1.06 * v_3000m (8–12 min 处于 ~93-95% vVO2max)
 */
export function estimateMas({ ttDistMeters = 2000, ttTimeSec, ltPaceSecPerKm } = {}) {
  if (Number.isFinite(ttTimeSec) && ttTimeSec > 0 && ttDistMeters > 0) {
    const vAvg = ttDistMeters / ttTimeSec;
    if (ttDistMeters >= 1200 && ttDistMeters <= 2200) {
      const distKm = ttDistMeters / 1000;
      return vAvg * (0.766 + 0.117 * distKm);
    }
    if (ttDistMeters >= 2800 && ttDistMeters <= 3200) {
      return vAvg * 1.055;
    }
    return vAvg;
  }
  if (Number.isFinite(ltPaceSecPerKm) && ltPaceSecPerKm > 0) {
    const vLt2 = 1000 / ltPaceSecPerKm;
    return vLt2 / 0.86;
  }
  throw new Error('Must provide either valid (ttDistMeters, ttTimeSec) or ltPaceSecPerKm');
}

/**
 * 由冲刺成绩估算 MSS (m/s)
 * @param {number} sprintDistM 冲刺距离（推荐 30m 行进间或 50m 站立起跑）
 * @param {number} sprintTimeSec 耗时（秒）
 * @param {boolean} isStandingStart 站立起跑包含加速阶段，最高瞬时极速约为平均速 * 1.11（50m）
 */
export function estimateMss({ sprintDistM = 50, sprintTimeSec, isStandingStart = true } = {}) {
  if (!Number.isFinite(sprintTimeSec) || sprintTimeSec <= 0 || sprintDistM <= 0) {
    throw new Error('Invalid sprint parameters');
  }
  const avgSpeed = sprintDistM / sprintTimeSec;
  if (!isStandingStart) return avgSpeed; // 行进间极速直接近似 MSS
  // 站立起跑 40-60m 包含约 10-15m 起步加速，峰值约高于全程均速 10-12%
  const factor = sprintDistM <= 35 ? 1.16 : sprintDistM <= 55 ? 1.11 : 1.08;
  return avgSpeed * factor;
}

/**
 * Sandford et al. (2019) SRR 800m 亚型分群
 */
export function classify800mSubgroup(srr) {
  if (!Number.isFinite(srr)) return { id: 'unknown', label: '待标定' };
  if (srr >= 1.58) {
    return {
      id: '400_800_speed',
      label: '400–800m 速度主导型 (SRR ≥ 1.58)',
      focus: '以短间歇（15–60s @ 105–120% MAS）与短组阈值（6×400m 休20s）稳步建有氧，保持高功率力量转化，避免盲目大跑量慢磨。'
    };
  }
  if (srr >= 1.48) {
    return {
      id: '800_specialist',
      label: '800m 均衡专项型 (SRR 1.48–1.57)',
      focus: '80/20 极化有氧与周年微剂量 MSS 协同推进，Build 期堆砌 VO2max 长间歇与节奏跑，赛前 6–8 周解锁拆分 800m 特耐。'
    };
  }
  return {
    id: '800_1500_endurance',
    label: '800–1500m 耐力主导型 (SRR < 1.48)',
    focus: '有氧能力占优但极速与爆发力可能是瓶颈：务必从第 1 周起每周穿插 2–3 次 40–60m 最大速度激活与大重量/超等长爆发训练以拓宽 ASR。'
  };
}

/**
 * 生成完整 ASR 档案与 800m 间歇配速表
 */
export function buildAsrProfile({
  masMps,
  mssMps,
  goal800Sec = 121.0
} = {}) {
  const asrMps = Math.max(0, mssMps - masMps);
  const srr = masMps > 0 ? mssMps / masMps : NaN;
  const goalSpeedMps = 800 / goal800Sec;
  const subgroup = classify800mSubgroup(srr);

  const zoneSpecs = [
    { key: 'easy', name: 'E 轻松有氧 (Z1-Z2)', speedMps: masMps * 0.72, splits: [1000] },
    { key: 'threshold', name: 'T 乳酸阈值 (vLT2 ~86% MAS)', speedMps: masMps * 0.86, splits: [400, 1000] },
    { key: 'vo2max', name: 'I 红区长间歇 (100% MAS)', speedMps: masMps * 1.00, splits: [400, 800, 1000] },
    { key: 'short_hiit', name: 'SI 短间歇 (+15% ASR)', speedMps: masMps + asrMps * 0.15, splits: [200, 300, 400] },
    { key: 'goal_rp', name: `目标 800m 配速 (${formatTimeSec(goal800Sec, 1)})`, speedMps: goalSpeedMps, splits: [200, 300, 400, 600] },
    { key: 'spec_end', name: '特种耐力/超速 (104% 目标 RP)', speedMps: goalSpeedMps * 1.04, splits: [150, 200, 300] },
    { key: 'mss', name: 'MSS 最大速度刺激 (~95-100% MSS)', speedMps: mssMps * 0.96, splits: [30, 50, 60] }
  ];

  const zones = zoneSpecs.map((z) => {
    const splitTimes = {};
    for (const dist of z.splits) {
      splitTimes[`${dist}m`] = formatTimeSec(dist / z.speedMps, 1);
    }
    return {
      key: z.key,
      name: z.name,
      speedMps: Math.round(z.speedMps * 100) / 100,
      pacePerKm: speedToPacePerKm(z.speedMps),
      splits: splitTimes
    };
  });

  return {
    masMps: Math.round(masMps * 100) / 100,
    masPacePerKm: speedToPacePerKm(masMps),
    mssMps: Math.round(mssMps * 100) / 100,
    asrMps: Math.round(asrMps * 100) / 100,
    srr: Math.round(srr * 100) / 100,
    subgroup,
    goal800Sec,
    goal800PacePerKm: speedToPacePerKm(goalSpeedMps),
    goalPctAsr: asrMps > 0 ? Math.round(((goalSpeedMps - masMps) / asrMps) * 1000) / 10 : null,
    zones
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[k] = v;
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const ttDist = args['tt-dist'] ? Number(args['tt-dist']) : 3000;
  const ttTimeSec = args['tt-time'] ? parseTimeSec(args['tt-time']) : undefined;
  const ltPace = args['lt-pace'] ? parseTimeSec(args['lt-pace']) : 285;
  const sprintDist = args['sprint-dist'] ? Number(args['sprint-dist']) : 50;
  const sprintTimeSec = args['sprint-time'] ? parseTimeSec(args['sprint-time']) : 6.7;
  const flying = args['flying'] === 'true';
  const goal800Sec = args['goal-800'] ? parseTimeSec(args['goal-800']) : 121;

  const masMps = estimateMas({ ttDistMeters: ttDist, ttTimeSec, ltPaceSecPerKm: ltPace });
  const mssMps = estimateMss({ sprintDistM: sprintDist, sprintTimeSec, isStandingStart: !flying });
  const profile = buildAsrProfile({ masMps, mssMps, goal800Sec });
  console.log(JSON.stringify(profile, null, 2));
}
