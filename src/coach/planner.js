import {
  formatPace,
  getLocalIsoDate,
  getWeekdayIndexFromIso,
  parsePaceSecPerKm
} from '../science/metrics.js';
import { summarizeCheckinSignals } from '../storage/checkins.js';
import {
  assertCoachPlanPassed,
  build800mFallbackDay,
  determineEffective800mStage,
  resolveEasyHrCeiling,
  validateAndFinalizePlan
} from './planRules.js';

function resolveAuthoritativeMacroPhase(stageInfo, candidateMacro = null) {
  const { currentStage, stageDisplay, weekFocus, upgradeGate } = stageInfo;
  const defaultStages = [
    { key: 'Base', label: 'Stage 0 组织唤醒期', weeks: 'W1-W4', active: currentStage === 'Base' },
    { key: 'Build', label: 'Stage 1 有氧与基础速度', weeks: 'W5-W11', active: currentStage === 'Build' },
    { key: 'Peak', label: 'Stage 2 专项准备与VO2', weeks: 'W12-W18', active: currentStage === 'Peak' },
    { key: 'PreComp', label: 'Stage 3 比赛节奏转化', weeks: 'W19-W23', active: currentStage === 'PreComp' },
    { key: 'Taper', label: 'Stage 4 赛前独立减量', weeks: '最后~1-2周', active: currentStage === 'Taper' }
  ];
  const defaultMacroPhase = {
    currentStage,
    stageDisplay,
    weekFocus,
    nextDeloadInfo: '每周保留连续骨架并结合周末复盘决定是否仅微调单个负荷变量；亚极量观察跑不直接替代全力能力测试',
    stages: defaultStages
  };
  if (!candidateMacro || typeof candidateMacro !== 'object') {
    return defaultMacroPhase;
  }
  const candidateDiffers = Boolean(candidateMacro.currentStage && candidateMacro.currentStage !== currentStage);
  const hasBlockedReasons = Boolean(upgradeGate?.blockedReasons?.length > 0);
  const mergedStages =
    Array.isArray(candidateMacro.stages) && candidateMacro.stages.length >= 5
      ? candidateMacro.stages.map((s) => ({ ...s, active: s.key === currentStage }))
      : defaultStages;
  return {
    ...defaultMacroPhase,
    ...candidateMacro,
    currentStage,
    stageDisplay:
      candidateDiffers || hasBlockedReasons
        ? stageDisplay
        : candidateMacro.stageDisplay || stageDisplay,
    weekFocus:
      candidateDiffers || hasBlockedReasons
        ? weekFocus
        : candidateMacro.weekFocus || weekFocus,
    stages: mergedStages
  };
}

/**
 * 将 config/custom-plan.json 中某天的定制课表归一化为标准结构，交由统一校验器处理
 */
function normalizeCustomDayTemplate(entry, defaults) {
  const { paces, lthr, maxHr, config } = defaults;
  const type = String(entry?.type || 'E').toUpperCase();
  const easyCeiling = resolveEasyHrCeiling(config, lthr);
  const typeDefaults = {
    REST: { baseSec: paces.easyPaceSec, hrRange: '静息恢复', cadence: '--', rpe: '1-2/10', carbFactor: 0.4 },
    STR: { baseSec: paces.easyPaceSec + 10, hrRange: `125-${easyCeiling - 4} bpm (Z1-Z2)`, cadence: '174-178 spm', rpe: '4/10', carbFactor: 0.6 },
    E: { baseSec: paces.easyPaceSec, hrRange: `<= ${easyCeiling} bpm (个人暂定 Z1-Z2 上限)`, cadence: '174-180 spm', rpe: '4/10', carbFactor: 0.7 },
    LSD: { baseSec: paces.easyPaceSec - 5, hrRange: `<= ${easyCeiling + 2} bpm (个人暂定 Z1-Z2 上限)`, cadence: '176-182 spm', rpe: '5/10', carbFactor: 1.0 },
    M: { baseSec: paces.thresholdPaceSec + 15, hrRange: `${Math.round(lthr * 0.88)}-${Math.round(lthr * 0.94)} bpm`, cadence: '180-186 spm', rpe: '6.5/10', carbFactor: 0.9 },
    T: { baseSec: paces.thresholdPaceSec, hrRange: `${Math.round(lthr * 0.95)}-${Math.round(lthr * 1.01)} bpm (Z4)`, cadence: '182-186 spm', rpe: '7-8/10', carbFactor: 1.0 },
    I: { baseSec: paces.intervalPaceSec, hrRange: `${Math.round(maxHr * 0.91)}-${Math.round(maxHr * 0.96)} bpm (Z5)`, cadence: '186-192 spm', rpe: '8.5/10', carbFactor: 1.0 },
    R: { baseSec: paces.repPaceSec, hrRange: '按分段秒表配速与完全走休执行（短冲不追心率）', cadence: '190-196 spm', rpe: '8.5/10', carbFactor: 0.85 }
  };
  const fallback = typeDefaults[type] || typeDefaults.E;
  const distanceKm = Number(entry?.plannedDistanceKm ?? (type === 'REST' ? 0 : 4));
  const parsedPace = parsePaceSecPerKm(entry?.basePaceSecPerKm ?? entry?.basePace);
  const baseSec = parsedPace ?? fallback.baseSec;
  const durationMin = Number(
    entry?.plannedDurationMin ??
      (distanceKm > 0 ? Math.round((distanceKm * baseSec) / 60) : 25)
  );
  const estimatedTss = Number(
    entry?.estimatedTss ??
      Math.max(8, Math.round((durationMin / 60) * (type === 'I' || type === 'T' ? 75 : type === 'REST' ? 18 : 50)))
  );

  return {
    type,
    title: entry?.title || `定制课表 (${type})`,
    steps: Array.isArray(entry?.steps) ? entry.steps : undefined,
    plannedDistanceKm: distanceKm,
    plannedDurationMin: durationMin,
    estimatedTss,
    basePace: distanceKm > 0 ? `${formatPace(baseSec)}/km` : '--',
    baseSec,
    targetHr: entry?.targetHr || fallback.hrRange,
    targetCadence: entry?.targetCadence || fallback.cadence,
    rpe: entry?.rpe || fallback.rpe,
    warmup: entry?.warmup || (type === 'REST' ? '轻度关节活动' : '1.0km 轻松慢跑 + 动态激活'),
    mainSetSummary: entry?.mainSetSummary || entry?.title || '按定制周期计划执行',
    mainSetDetail: entry?.mainSetDetail || entry?.mainSetSummary || '按目标配速与心率区间稳步执行',
    cooldown: entry?.cooldown || '慢走放松与常规拉伸 8–10 分钟',
    nutrition: entry?.nutrition || null,
    coachTip: entry?.coachTip || '来自周期定制课表。',
    isCustomPlan: true
  };
}

/**
 * 确定性科学训练计划引擎（800m 专项周期 + 定制课表 + 统一最终检验网关）
 */
export function buildDeterministicCoachPlan(context, config = {}) {
  const { readiness, pmc, weeklyZones, wellness, envForecast, lastKeyWorkoutAudit, customPlan, checkins = [] } = context;
  const tz = config.timezone || 'Asia/Shanghai';
  const todayStr = context.todayStr || envForecast?.daily?.[0]?.date || getLocalIsoDate(0, tz);
  const checkinSignals = summarizeCheckinSignals(checkins, todayStr);
  const lthr = wellness?.lthrFromDevice || config.physiology?.lthr || 183;
  const maxHr = wellness?.maxHrFromDevice || config.physiology?.maxHr || 203;

  const stageInfo = determineEffective800mStage({
    config,
    pmcLatest: pmc?.latest,
    weeklyZones,
    checkinSignals
  });
  const { currentStage, stageDisplay, weekFocus, paces, upgradeGate } = stageInfo;

  const forecastDays = envForecast?.daily || [];
  const customDaysMap = customPlan?.days && typeof customPlan.days === 'object' ? customPlan.days : {};
  const rawDays = [];
  let customDayCount = 0;

  for (let i = 0; i < 7; i++) {
    const env = forecastDays[i] || null;
    const dateStr = env?.date || getLocalIsoDate(i, tz);
    const dow = getWeekdayIndexFromIso(dateStr);
    const customEntry = customDaysMap[dateStr];

    if (customEntry) {
      customDayCount += 1;
      rawDays.push({
        date: dateStr,
        ...normalizeCustomDayTemplate(customEntry, { paces, lthr, maxHr, config })
      });
    } else {
      rawDays.push({
        date: dateStr,
        isCustomPlan: false,
        ...build800mFallbackDay({
          dow,
          stageInfo,
          lthr,
          config,
          progressionRecommendation: checkinSignals.weeklyReview?.progressionRecommendation || 'hold'
        })
      });
    }
  }

  const validateFn = typeof context._validatePlanFn === 'function' ? context._validatePlanFn : validateAndFinalizePlan;
  let { days, validationReport } = validateFn(rawDays, {
    todayStr,
    readiness,
    checkinSignals,
    envForecast,
    stageInfo,
    config,
    wellness
  });

  // 若含定制课表的组合未能通过终检，放弃定制日并改用纯 800m 安全库重新生成并重跑终检
  if (validationReport?.passed !== true) {
    const pureFallbackRaw = [];
    for (let i = 0; i < 7; i++) {
      const env = forecastDays[i] || null;
      const dateStr = env?.date || getLocalIsoDate(i, tz);
      const dow = getWeekdayIndexFromIso(dateStr);
      pureFallbackRaw.push({
        date: dateStr,
        isCustomPlan: false,
        ...build800mFallbackDay({
          dow,
          stageInfo,
          lthr,
          config,
          progressionRecommendation: checkinSignals.weeklyReview?.progressionRecommendation || 'hold'
        })
      });
    }
    const rechecked = validateFn(pureFallbackRaw, {
      todayStr,
      readiness,
      checkinSignals,
      envForecast,
      stageInfo,
      config,
      wellness
    });
    assertCoachPlanPassed(rechecked, { action: '返回替代课表' });
    days = rechecked.days;
    validationReport = {
      ...rechecked.validationReport,
      inputValid: false,
      rejectedPlanErrors: validationReport.postErrors || [],
      repairs: [
        ...(validationReport.repairs || []),
        ...(rechecked.validationReport?.repairs || []),
        '原周期课表未通过终检，已整周切换为重新通过终检的 800m 安全替代课表'
      ]
    };
    validationReport.repairsCount = validationReport.repairs.length;
    customDayCount = 0;
  }

  const dec = lastKeyWorkoutAudit?.decoupling;
  const fitWorkoutCritique =
    customPlan?.fitWorkoutCritique?.trim() ||
    (dec
      ? `最近重点跑步 (${lastKeyWorkoutAudit.activity?.name}) 有氧解耦率 ${dec.decouplingPct}%（${dec.status === 'solid' ? '低于5%，有氧稳态良好' : '存在后半程漂移'}），平均步频 ${lastKeyWorkoutAudit.activity?.cadence || '--'} spm。`
      : '近期无新 .FIT 跑步遥测样本，待后续户外/操场课同步后校准配速-心率关系。');

  const dq = readiness?.dataQuality || {};
  const dataAuditParts = [
    wellness?.date ? `数据日期 ${wellness.date}` : '数据日期未标定',
    wellness?.hrvToday != null ? `HRV ${wellness.hrvToday}ms` : 'HRV缺失',
    wellness?.rhrToday != null ? `晨脉 ${wellness.rhrToday}bpm` : '晨脉缺失',
    wellness?.sleepScore != null ? `睡眠 ${wellness.sleepScore}分` : '睡眠缺失',
    `近期4周均跑量 ${stageInfo.recent4wAvgKm}km (CTL ${stageInfo.ctl})`
  ];
  if (dq.staleFields?.length) dataAuditParts.push(`跨日缓存: ${dq.staleFields.join('、')}`);
  if (dq.missingFields?.length) dataAuditParts.push(`缺失: ${dq.missingFields.join('、')}`);

  const todayPlan = days[0];
  const whyPart =
    validationReport.repairs.length > 0
      ? `因 ${[...(readiness?.triggers || []), ...(checkinSignals.triggers || [])].filter(Boolean).join('；')}，触发门控调整`
      : `准备度 ${readiness?.score ?? '--'}（${readiness?.lightLabel || '未知'}），维持当前节奏推进`;

  const whatPart = todayPlan
    ? `今日执行 [${todayPlan.type}] ${todayPlan.title}（${todayPlan.plannedDistanceKm}km / ${todayPlan.plannedDurationMin}min）`
    : '今日课表已校验';

  const watchPart =
    checkinSignals.persistentInjuries?.length > 0
      ? `后续重点观察「${checkinSignals.persistentInjuries.map((i) => i.area).join('、')}」在日常及恢复期是否疼痛消退，确认无痛后再恢复跑量`
      : '后续重点观察明早 HRV/晨脉趋势、入睡前移情况与课后次日腿感';

  const coachNotes = customPlan?.coachNotes?.trim();
  const weeklyReviewNote = checkinSignals.weeklyReview
    ? `【周进阶复盘】${checkinSignals.weeklyReview.progressionReason}；【力量反馈】${checkinSignals.weeklyReview.strengthProgressionNote}`
    : '';
  const gateNote =
    upgradeGate?.blockedReasons?.length > 0
      ? `；【阶段门控】${upgradeGate.blockedReasons.join('；')}`
      : '';
  const feedbackDigest = checkinSignals.todayCheckin
    ? ` ｜ 今日打卡：状态=${checkinSignals.todayCheckin.status}，RPE=${checkinSignals.todayCheckin.rpe ?? '--'}/10，痛感=${checkinSignals.todayCheckin.painLevel ?? 0}/10${checkinSignals.todayCheckin.diary ? `，笔记「${checkinSignals.todayCheckin.diary}」` : ''}`
    : '';

  const coachSummary = `【数据依据】${dataAuditParts.join(' · ')}。【调整原因】${whyPart}。【今日执行】${whatPart}。【后续观察】${watchPart}。${weeklyReviewNote}${gateNote}${coachNotes ? ` ｜ 周期备忘：${coachNotes}` : ''}${feedbackDigest}`;

  const customMacro = customPlan?.macroPhase && typeof customPlan.macroPhase === 'object' ? customPlan.macroPhase : null;
  const macroPhase = resolveAuthoritativeMacroPhase(stageInfo, customMacro);

  const hasCustomContent = customDayCount > 0 || Boolean(coachNotes) || Boolean(customMacro);

  return {
    planSource: hasCustomContent ? 'antigravity-custom-plan' : 'deterministic-science-engine',
    customPlanUpdatedAt: customPlan?.updatedAt || null,
    macroPhase,
    weeklyReview: checkinSignals.weeklyReview,
    upgradeGate,
    coachSummary,
    fitWorkoutCritique,
    validationReport,
    days
  };
}
