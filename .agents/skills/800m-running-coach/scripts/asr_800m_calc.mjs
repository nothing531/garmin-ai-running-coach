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
 * 根据场地测验或配速推算 MAS (m/s)，并返回估算方法与假设标签
 * 明确区分「恢复观察测试 (submaximal)」与「能力标定测试 (maximal field TT)」：
 * 亚极量观察跑不直接套用全力计时公式（Thron et al., 2024: 不同协议测得的 MAS 本身存在差异）
 */
export function estimateMasWithMeta({ ttDistMeters, ttTimeSec, ltPaceSecPerKm, isSubmaximal = false } = {}) {
  if (isSubmaximal) {
    return {
      masMps: null,
      sourceType: 'submaximal_observation_only',
      confidence: 'observation_only',
      assumption:
        '亚极量渐进跑仅用于观察配速-心率-体感关系与恢复耐受，严禁当作全力计时套公式标定 MAS/ASR；且不同测试协议测得的 MAS 本身存在绝对值差异（Thron et al., 2024）。'
    };
  }
  if (Number.isFinite(ttTimeSec) && ttTimeSec > 0 && Number.isFinite(ttDistMeters) && ttDistMeters > 0) {
    const vAvg = ttDistMeters / ttTimeSec;
    if (ttDistMeters >= 1200 && ttDistMeters <= 2200) {
      const distKm = ttDistMeters / 1000;
      const masMps = vAvg * (0.766 + 0.117 * distKm);
      return {
        masMps,
        sourceType: 'field_test_formula',
        confidence: 'empirical_formula',
        assumption: `Bellenger (2015) 全力场地线性修正公式（${ttDistMeters}m 计时），非实验室跑台实测 vVO2max；不同协议 MAS 不可直接跨方法混用（Thron et al., 2024）`
      };
    }
    if (ttDistMeters >= 2800 && ttDistMeters <= 3200) {
      return {
        masMps: vAvg * 1.055,
        sourceType: 'field_test_heuristic',
        confidence: 'heuristic_estimate',
        assumption: `全力 3000m 均速乘以经验修正系数 1.055（假设 3000m 全力均速约在 93–96% vVO2max），含较强个体与协议误差；仅限全力测验，亚极量不可套用`
      };
    }
    return {
      masMps: vAvg,
      sourceType: 'field_test_uncalibrated',
      confidence: 'heuristic_estimate',
      assumption: `${ttDistMeters}m 非标准 1500–2000m 测距，直接以均速近似`
    };
  }
  if (Number.isFinite(ltPaceSecPerKm) && ltPaceSecPerKm > 0) {
    const vLt2 = 1000 / ltPaceSecPerKm;
    return {
      masMps: vLt2 / 0.86,
      sourceType: 'lt_heuristic_fallback',
      confidence: 'heuristic_estimate',
      assumption: '由配置/暂定 LT 配速除以经验比例 0.86 反推，并非有效场地 MAS 实测'
    };
  }
  return {
    masMps: null,
    sourceType: 'missing',
    confidence: 'missing',
    assumption: '缺少有效 1500–3000m 全力场地能力测验或 LT 配速输入'
  };
}

export function estimateMas(opts = {}) {
  const res = estimateMasWithMeta(opts);
  if (!Number.isFinite(res.masMps)) {
    throw new Error('Must provide either valid (ttDistMeters, ttTimeSec) or ltPaceSecPerKm');
  }
  return res.masMps;
}

/**
 * 由直线冲刺成绩估算 MSS (m/s)，返回方法与修正假设说明
 */
export function estimateMssWithMeta({ sprintDistM, sprintTimeSec, isStandingStart = true } = {}) {
  if (!Number.isFinite(sprintTimeSec) || sprintTimeSec <= 0 || !Number.isFinite(sprintDistM) || sprintDistM <= 0) {
    return {
      mssMps: null,
      sourceType: 'missing',
      confidence: 'missing',
      assumption: '缺少有效 20–50m 直线冲刺计时输入'
    };
  }
  const avgSpeed = sprintDistM / sprintTimeSec;
  if (!isStandingStart) {
    return {
      mssMps: avgSpeed,
      sourceType: 'flying_sprint_field_test',
      confidence: 'field_measured',
      assumption: `行进间 ${sprintDistM}m 均速近似峰值速度 MSS（取决于人工/视频计时精度）`
    };
  }
  const factor = sprintDistM <= 35 ? 1.16 : sprintDistM <= 55 ? 1.11 : 1.08;
  return {
    mssMps: avgSpeed * factor,
    sourceType: 'standing_sprint_heuristic',
    confidence: 'heuristic_estimate',
    assumption: `站立起跑 ${sprintDistM}m 均速乘以经验加速修正系数 ${factor}（假设起跑加速损耗比例固定，属经验估算而非行进间实测峰值）`
  };
}

export function estimateMss(opts = {}) {
  const res = estimateMssWithMeta(opts);
  if (!Number.isFinite(res.mssMps)) {
    throw new Error('Invalid sprint parameters');
  }
  return res.mssMps;
}

/**
 * Sandford et al. (2018/2019) 精英队列 SRR 描述性区间（不作为个人天赋固定标签）
 */
export function classify800mSubgroup(srr, options = {}) {
  const hasValidFieldTests = options.hasValidFieldTests !== false;
  if (!Number.isFinite(srr) || !hasValidFieldTests) {
    return {
      id: 'pending',
      label: '亚型待定（缺少有效耐力+冲刺双向场地实测）',
      focus: '当前无有效场地测验标定，暂以阶段有氧恢复、技术节奏与基础力量建立为主；待完成 1500–3000m 与直线冲刺后再参考。'
    };
  }
  if (srr >= 1.58) {
    return {
      id: '400_800_speed',
      label: '速度储备相对偏高区间（对照 Sandford 精英样本 SRR >= 1.58）',
      focus: '参考方向：以短间歇与短组阈值稳步抬高有氧与 MAS，同时保持低剂量神经速度刺激；具体剂量仍需结合近期跑量耐受与完成情况。'
    };
  }
  if (srr >= 1.48) {
    return {
      id: '800_specialist',
      label: '均衡储备参考区间（对照 Sandford 精英样本 SRR 1.48–1.57）',
      focus: '参考方向：有氧支撑、VO2max 功率与比赛节奏平衡推进，训练配置仍取决于当前实际 MAS/MSS 短板与恢复反应。'
    };
  }
  return {
    id: '800_1500_endurance',
    label: '耐力相对偏高区间（对照 Sandford 精英样本 SRR < 1.48）',
    focus: '参考方向：有氧底座相对较强时，需重视渐加速步幅、基础力量与神经速度维持；禁止在未建立组织耐受前猛冲极限跑。'
  };
}

/**
 * 生成 ASR 估算档案与分档参考（清晰区隔实测与估算，结合训练历史和周跑量）
 */
export function buildAsrProfile({
  masMps,
  mssMps,
  masMeta = null,
  mssMeta = null,
  goal800Sec = 121.0,
  weeklyKm = null,
  stage = 'Base',
  completionRatePct = null
} = {}) {
  const hasMas = Number.isFinite(masMps) && masMps > 0;
  const hasMss = Number.isFinite(mssMps) && mssMps > 0;
  const hasValidFieldTests =
    hasMas &&
    hasMss &&
    (!masMeta || masMeta.sourceType !== 'lt_heuristic_fallback') &&
    (!mssMeta || mssMeta.sourceType !== 'missing');

  if (!hasMas || !hasMss) {
    return {
      calibrated: false,
      calibrationStatus: 'pending_field_tests',
      masMps: hasMas ? Math.round(masMps * 100) / 100 : null,
      masPacePerKm: hasMas ? speedToPacePerKm(masMps) : '待标定',
      mssMps: hasMss ? Math.round(mssMps * 100) / 100 : null,
      asrMps: null,
      srr: null,
      subgroup: classify800mSubgroup(NaN, { hasValidFieldTests: false }),
      goal800Sec,
      goal800PacePerKm: speedToPacePerKm(800 / goal800Sec),
      goalPctAsr: null,
      assumptions: [
        masMeta?.assumption || '缺少 MAS 有效测试',
        mssMeta?.assumption || '缺少 MSS 有效测试',
        '无有效场地测验时不输出精确 ASR 配速区间，请先完成阶段基础测试。'
      ],
      trainingContext: { weeklyKm, stage, completionRatePct },
      zones: []
    };
  }

  const asrMps = Math.max(0, mssMps - masMps);
  const srr = mssMps / masMps;
  const goalSpeedMps = 800 / goal800Sec;
  const subgroup = classify800mSubgroup(srr, { hasValidFieldTests });
  const isHeuristicOnly =
    masMeta?.confidence === 'heuristic_estimate' || mssMeta?.confidence === 'heuristic_estimate';

  const zoneSpecs = [
    { key: 'easy', name: 'E 轻松有氧参考', speedMps: masMps * 0.72, splits: [1000] },
    { key: 'threshold', name: 'T 阈值参考 (~86% 估算MAS)', speedMps: masMps * 0.86, splits: [400, 1000] },
    { key: 'vo2max', name: 'I 红区长间歇 (100% 估算MAS)', speedMps: masMps * 1.00, splits: [400, 800, 1000] },
    { key: 'short_hiit', name: 'SI 短间歇 (+15% 估算ASR)', speedMps: masMps + asrMps * 0.15, splits: [200, 300, 400] },
    { key: 'goal_rp', name: `远期目标 800m 配速参考 (${formatTimeSec(goal800Sec, 1)})`, speedMps: goalSpeedMps, splits: [200, 300, 400, 600] },
    { key: 'spec_end', name: '远期超速参考 (104% 目标RP)', speedMps: goalSpeedMps * 1.04, splits: [150, 200, 300] },
    { key: 'mss', name: 'MSS 极速参考 (~96% 估算MSS)', speedMps: mssMps * 0.96, splits: [30, 50, 60] }
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

  const contextAdvisories = [];
  if (Number.isFinite(weeklyKm) && weeklyKm < 18) {
    contextAdvisories.push(`当前周跑量 (${weeklyKm}km) 仍属复训早期，严禁直接按远期目标配速或高容量间歇执行`);
  }
  if (Number.isFinite(completionRatePct) && completionRatePct < 80) {
    contextAdvisories.push(`近期课表完成度 (${completionRatePct}%) 偏低，优先巩固出勤与耐受后再考虑加量`);
  }

  return {
    calibrated: hasValidFieldTests && !isHeuristicOnly,
    calibrationStatus: !hasValidFieldTests
      ? 'heuristic_uncalibrated'
      : isHeuristicOnly
        ? 'estimated_from_indirect_field_test'
        : 'field_test_calibrated',
    masMps: Math.round(masMps * 100) / 100,
    masPacePerKm: speedToPacePerKm(masMps),
    mssMps: Math.round(mssMps * 100) / 100,
    asrMps: Math.round(asrMps * 100) / 100,
    srr: Math.round(srr * 100) / 100,
    subgroup,
    goal800Sec,
    goal800PacePerKm: speedToPacePerKm(goalSpeedMps),
    goalPctAsr: asrMps > 0 ? Math.round(((goalSpeedMps - masMps) / asrMps) * 1000) / 10 : null,
    provenance: {
      mas: masMeta || { sourceType: 'direct_input', confidence: 'external' },
      mss: mssMeta || { sourceType: 'direct_input', confidence: 'external' }
    },
    assumptions: [
      masMeta?.assumption,
      mssMeta?.assumption,
      '不同 MAS 测试协议（场地计时、跑台 CPET、30-15 IFT）存在绝对值差异（Thron et al., 2024），跨周期仅宜与同协议结果纵向对照',
      'Sandford (2018/2019) SRR 区间来源于精英 800m 样本（1:43–1:49），仅作特征参考而非个人能力固定标签'
    ].filter(Boolean),
    trainingContext: { weeklyKm, stage, completionRatePct, advisories: contextAdvisories },
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
  const ttDist = args['tt-dist'] ? Number(args['tt-dist']) : undefined;
  const ttTimeSec = args['tt-time'] ? parseTimeSec(args['tt-time']) : undefined;
  const isSubmaximal = args['submaximal'] === 'true';
  const ltPace = args['lt-pace'] ? parseTimeSec(args['lt-pace']) : undefined;
  const sprintDist = args['sprint-dist'] ? Number(args['sprint-dist']) : undefined;
  const sprintTimeSec = args['sprint-time'] ? parseTimeSec(args['sprint-time']) : undefined;
  const flying = args['flying'] === 'true';
  const goal800Sec = args['goal-800'] ? parseTimeSec(args['goal-800']) : 121;
  const weeklyKm = args['weekly-km'] ? Number(args['weekly-km']) : null;
  const stage = args['stage'] || 'Base';
  const completionRatePct = args['completion-pct'] ? Number(args['completion-pct']) : null;

  const masMeta = estimateMasWithMeta({ ttDistMeters: ttDist, ttTimeSec, ltPaceSecPerKm: ltPace, isSubmaximal });
  const mssMeta = estimateMssWithMeta({ sprintDistM: sprintDist, sprintTimeSec, isStandingStart: !flying });
  const profile = buildAsrProfile({
    masMps: masMeta.masMps,
    mssMps: mssMeta.mssMps,
    masMeta,
    mssMeta,
    goal800Sec,
    weeklyKm,
    stage,
    completionRatePct
  });
  console.log(JSON.stringify(profile, null, 2));
}
