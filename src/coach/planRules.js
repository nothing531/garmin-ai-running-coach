import {
  computeEnvironmentalAdjustment,
  formatPace,
  getLocalIsoDate,
  getWeekdayIndexFromIso,
  parsePaceSecPerKm
} from '../science/metrics.js';

export const VALID_WORKOUT_TYPES = new Set(['E', 'LSD', 'M', 'T', 'I', 'R', 'STR', 'REST']);
export const HIGH_INTENSITY_TYPES = new Set(['T', 'I', 'R']);
export const RUNNING_TYPES = new Set(['E', 'LSD', 'M', 'T', 'I', 'R']);
export const VALID_STEP_KINDS = new Set(['warmup', 'steady', 'interval', 'strides', 'cooldown', 'strength', 'cross', 'rest']);

function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * 校验结构化训练步骤合法性，杜绝负数、NaN、零组数或非法距离进入编译与输出
 */
export function validateStepsSchema(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { valid: false, errors: ['steps 必须为非空数组'] };
  }
  const errors = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || typeof s !== 'object') {
      errors.push(`step[${i}] 必须是对象`);
      continue;
    }
    const kind = String(s.kind || '').toLowerCase();
    if (!VALID_STEP_KINDS.has(kind)) {
      errors.push(`step[${i}].kind=${s.kind} 非法`);
      continue;
    }

    if (s.distanceKm !== undefined && s.distanceKm !== null) {
      const d = Number(s.distanceKm);
      if (!Number.isFinite(d) || d < 0 || d > 100) {
        errors.push(`step[${i}].distanceKm=${s.distanceKm} 非法（须在 0–100 km）`);
      }
    }
    if (s.durationMin !== undefined && s.durationMin !== null) {
      const m = Number(s.durationMin);
      if (!Number.isFinite(m) || m <= 0 || m > 600) {
        errors.push(`step[${i}].durationMin=${s.durationMin} 非法（须 > 0）`);
      }
    }
    if (s.distanceMeters !== undefined && s.distanceMeters !== null) {
      const dm = Number(s.distanceMeters);
      if (!Number.isFinite(dm) || dm < 20 || dm > 50000) {
        errors.push(`step[${i}].distanceMeters=${s.distanceMeters} 非法（须在 20–50000 m）`);
      }
    }
    if (s.reps !== undefined && s.reps !== null) {
      const r = Number(s.reps);
      if (!Number.isInteger(r) || r < 1 || r > 100) {
        errors.push(`step[${i}].reps=${s.reps} 非法（须为正整数）`);
      }
    }
    if (s.restSec !== undefined && s.restSec !== null) {
      const rs = Number(s.restSec);
      if (!Number.isFinite(rs) || rs < 0 || rs > 3600) {
        errors.push(`step[${i}].restSec=${s.restSec} 非法`);
      }
    }

    if (kind === 'interval' || kind === 'strides') {
      if (s.reps == null || s.distanceMeters == null) {
        errors.push(`step[${i}] (${kind}) 缺少有效的 reps 或 distanceMeters`);
      }
    } else if (kind === 'steady') {
      const hasDist = s.distanceKm != null && Number(s.distanceKm) > 0;
      const hasDur = s.durationMin != null && Number(s.durationMin) > 0;
      if (!hasDist && !hasDur) {
        errors.push(`step[${i}] (steady) 必须包含正数的 distanceKm 或 durationMin`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function stripNegatedLoadPhrases(str) {
  return String(str || '')
    .replace(
      /(?:脱离|停止|暂停|取消|杜绝|避开|避免|禁止|严禁|不得|无须|不含|非全力|并非|因前一日|因前一天)[^，。；\n）)]{0,24}/g,
      ' '
    );
}

/**
 * 基于实际 steps + 里程/时长 + 文案 + 类型识别真实生理与力学负荷（不被 type 标签或 REST 伪装绕过）
 */
export function classifyWorkoutLoad(day) {
  const type = String(day?.type || 'REST').toUpperCase();
  const steps = Array.isArray(day?.steps) ? day.steps : [];
  const stepDescriptions = steps
    .filter((s) => String(s?.kind || '').toLowerCase() !== 'rest')
    .map((s) => String(s?.description || ''))
    .join(' ');
  const positiveDocText = stripNegatedLoadPhrases(
    `${day?.title || ''} ${day?.mainSetSummary || ''} ${day?.mainSetDetail || ''}`
  );
  const text = `${positiveDocText} ${stepDescriptions}`.trim();

  const hasNonRestStep = steps.some((s) => String(s?.kind || '').toLowerCase() !== 'rest');
  const hasStrengthStep = steps.some((s) => String(s?.kind || '').toLowerCase() === 'strength');
  const hasCrossStep = steps.some((s) => String(s?.kind || '').toLowerCase() === 'cross');

  const hasRunningStep = steps.some((s) => {
    const k = String(s?.kind || '').toLowerCase();
    if (k === 'interval' || k === 'strides') return true;
    if (k === 'steady') {
      return Number(s?.distanceKm || 0) > 0 || Number(s?.durationMin || 0) > 0;
    }
    if (k === 'warmup' || k === 'cooldown') {
      return (
        Number(s?.distanceKm || 0) > 0 ||
        Number(s?.distanceMeters || 0) > 0 ||
        /(?:慢跑|跑步|jog|run)/i.test(String(s?.description || ''))
      );
    }
    return false;
  });
  const hasRunningText = /(?:跑步机|慢跑|轻松跑|有氧跑|长距离|间歇跑|冲刺跑|操场跑|\d+(?:\.\d+)?\s*(?:km|公里)\s*跑|\d+(?:\.\d+)?\s*(?:km|公里)\s*跑步|\d+\s*[×xX]\s*\d+\s*m)/i.test(
    text
  );
  const hasRunningLoad =
    (RUNNING_TYPES.has(type) &&
      (Number(day?.plannedDistanceKm ?? day?.distanceKm ?? 0) > 0 ||
        Number(day?.plannedDurationMin ?? day?.durationMin ?? 0) > 0 ||
        steps.length === 0)) ||
    Number(day?.plannedDistanceKm ?? day?.distanceKm ?? 0) > 0 ||
    hasRunningStep ||
    hasRunningText;

  const hasIntervalStep = steps.some((s) => String(s?.kind || '').toLowerCase() === 'interval');
  const paceSec = parsePaceSecPerKm(day?.basePace);
  const hasHighIntensityPace = paceSec !== null && paceSec <= 275;
  const hasHighIntensityHr = (() => {
    const m = String(day?.targetHr || day?.hrRange || '').match(/(\d{2,3})\s*[-–~]\s*(\d{2,3})/);
    return m ? Number(m[1]) >= 165 : false;
  })();
  const hasHighIntensityText =
    /(?:间歇|VO2max|阈值|冲刺|速度耐力|拆分\s*800|800m\s*RP)/i.test(text) ||
    /\d+\s*[×xX]\s*(?:[2-9]\d{2}|[1-9]\d{3,})\s*(?:m|米)/i.test(text);
  const isHardTrack =
    HIGH_INTENSITY_TYPES.has(type) ||
    hasIntervalStep ||
    (hasRunningLoad && (hasHighIntensityPace || hasHighIntensityHr || hasHighIntensityText));

  const hasHeavyLowerStrengthStep = steps.some((s) => {
    const k = String(s?.kind || '').toLowerCase();
    const desc = String(s?.description || '');
    return (
      k === 'strength' &&
      /(?:深蹲|硬拉|腿举|分腿蹲|弓箭步|纵跳|跨步跳|箱跳|超等长|重抗阻|保加利亚|squat|rdl|lunge|plyo|80%\s*1RM|大重量)/i.test(
        desc
      )
    );
  });
  const hasHeavyLowerStrengthText = /(?:深蹲|硬拉|腿举|保加利亚|分腿蹲|弓箭步|蹲跳|纵跳|箱跳|超等长|下肢重力量|下肢强化力量|80%\s*1RM|大重量.*蹲)/i.test(
    text
  );
  const isHeavyLowerStrength = hasHeavyLowerStrengthStep || hasHeavyLowerStrengthText;

  const hasLowerImpactStrengthStep = steps.some((s) => {
    const k = String(s?.kind || '').toLowerCase();
    const desc = String(s?.description || '');
    return k === 'strength' && !/(?:纯上肢|仅上肢|上肢推拉|胸背肩)/i.test(desc);
  });
  const hasLowerImpactOrJointText = /(?:提踵|腿弯举|腿屈伸|深蹲|硬拉|靠墙静蹲|下肢(?:力量|负重|强化|微练|冲击|训练)|跑跳|跳跃|冲刺|椭圆机|功率车|单车|台阶|跑步)/i.test(
    text
  );
  const isAnyLowerStrengthOrImpact =
    hasRunningLoad ||
    isHeavyLowerStrength ||
    hasLowerImpactStrengthStep ||
    hasCrossStep ||
    hasLowerImpactOrJointText ||
    (type === 'STR' && !/(?:纯上肢|仅上肢|上肢推拉|胸背肩)/i.test(text));

  return {
    hasNonRestStep,
    hasStrengthStep,
    hasCrossStep,
    hasRunningLoad,
    isHardTrack,
    isHeavyLowerStrength,
    isAnyLowerStrengthOrImpact,
    isHighStressLowerDay: isHardTrack || isHeavyLowerStrength
  };
}

/**
 * 依据近期实际跑量、CTL、距目标周数与完成度/伤病/恢复/测试门控综合判定 800m 当前有效训练阶段
 * 拆开 5 阶段：Base (组织唤醒) -> Build (有氧+基础速度) -> Peak (专项准备+VO2) -> PreComp (比赛节奏转化) -> Taper (~1-2周独立减量)
 */
export function determineEffective800mStage({
  config = {},
  pmcLatest = {},
  weeklyZones = {},
  checkinSignals = null
} = {}) {
  let weeksToRace = 20;
  if (config.goal?.raceDate) {
    const diffMs = new Date(config.goal.raceDate).getTime() - Date.now();
    if (Number.isFinite(diffMs)) {
      weeksToRace = Math.max(1, Math.ceil(diffMs / (7 * 86400_000)));
    }
  }

  const weekly = Array.isArray(weeklyZones?.weekly) ? weeklyZones.weekly : [];
  const last4 = weekly.slice(-4);
  const recent4wAvgKm =
    last4.length > 0
      ? round1(last4.reduce((s, w) => s + Number(w.distanceKm || 0), 0) / last4.length)
      : 0;
  const latestWeekKm = weekly.length > 0 ? Number(weekly[weekly.length - 1].distanceKm || 0) : 0;
  const ctl = Number(pmcLatest?.ctl || 0);

  const review = checkinSignals?.weeklyReview || null;
  const hasAnyCheckins = Boolean(
    checkinSignals &&
      ((review?.completedSessions14d || 0) > 0 || (checkinSignals.recentCheckins?.length || 0) > 0)
  );
  const injuryClear =
    !checkinSignals?.painAlert &&
    !checkinSignals?.moderatePain &&
    (checkinSignals?.persistentInjuries?.length || 0) === 0;

  let stableCompletionStatus = 'unknown';
  if (!checkinSignals || !hasAnyCheckins || (review?.completedSessions14d || 0) === 0) {
    stableCompletionStatus = 'unknown';
  } else if (
    (review?.completedSessions14d || 0) >= 3 &&
    review?.verifiedRecoveryStatus === 'confirmed_good'
  ) {
    stableCompletionStatus = 'verified';
  } else {
    stableCompletionStatus = 'insufficient';
  }

  let recoveryStatus = 'unknown';
  if (!checkinSignals || !hasAnyCheckins) {
    recoveryStatus = 'unknown';
  } else if (
    review?.verifiedRecoveryStatus === 'poor' ||
    checkinSignals?.highRpeLoad ||
    checkinSignals?.recentDropoffAlert ||
    (review?.poorRecoveryCount14d || 0) > 0 ||
    (review?.unstableSessions14d || 0) > 0
  ) {
    recoveryStatus = 'poor';
  } else if (review?.verifiedRecoveryStatus === 'confirmed_good') {
    recoveryStatus = 'confirmed_good';
  } else {
    recoveryStatus = 'unknown';
  }

  // 零打卡或缺少恢复反馈均不得默认当作“完成稳定 / 恢复良好”
  const stableCompletionOk = stableCompletionStatus === 'verified';
  const recoveryOk = recoveryStatus === 'confirmed_good';

  const masTestMeta = config.physiologyMeta?.capacityTests?.latestMasTest || null;
  const hasValidMasTest = Boolean(
    masTestMeta &&
      masTestMeta.validForCalibration &&
      masTestMeta.testPurpose !== 'recovery_observation' &&
      !masTestMeta.isSubmaximal
  );
  const mssTestMeta = config.physiologyMeta?.capacityTests?.latestMssTest || null;
  const hasValidMssTest = Boolean(mssTestMeta && mssTestMeta.validForCalibration);

  const blockedReasons = [];
  if (!injuryClear) blockedReasons.push('存在持续不适/痛感或动作受限记录，暂锁阶段升级');
  if (recoveryStatus === 'poor') {
    blockedReasons.push('近期次日反应偏重或关键分段掉速 >3%，暂缓升级阶段');
  } else if (recoveryStatus === 'unknown') {
    blockedReasons.push('缺少明确的打卡完成或次日恢复反馈（完成稳定度与恢复状态未知），暂缓升入 Peak / PreComp');
  }
  if (stableCompletionStatus === 'insufficient') {
    blockedReasons.push(
      `近14天已验证完成 ${review?.completedSessions14d || 0} 次且恢复证据不足（需 ≥3 次含次日反应、实测完成及动作稳定记录才可升阶）`
    );
  }

  let currentStage = 'Base';
  let stageDisplay = `Stage 0 · 组织适应与有氧唤醒期（距目标约 ${weeksToRace} 周）`;
  let weekFocus = '维持稳定隔天出勤与温和下肢耐受；每周至多微调一个负荷变量';

  if (weeksToRace <= 2 && recent4wAvgKm >= 18 && ctl >= 12 && injuryClear && recoveryStatus !== 'poor') {
    currentStage = 'Taper';
    stageDisplay = `Stage 4 · 赛前独立减量窗口（距目标 ${weeksToRace} 周 · 仅最后 ~1–2 周）`;
    weekFocus = '大幅削减跑量保留神经与步幅弹性，依个体每日疲劳状态灵活维持节奏感';
  } else if (ctl < 10 || recent4wAvgKm < 14 || !injuryClear) {
    currentStage = 'Base';
    stageDisplay = `Stage 0 · 组织适应与有氧唤醒期（近期4周均跑量 ${recent4wAvgKm}km，CTL ${round1(ctl)}）`;
    weekFocus = '低跑量循序唤醒与无冲击交叉有氧，禁止直接套用比赛配速或按日历自动提速';
  } else if (weeksToRace >= 3 && weeksToRace <= 6 && recent4wAvgKm >= 24 && ctl >= 18 && recoveryOk && stableCompletionOk) {
    if (hasValidMasTest) {
      currentStage = 'PreComp';
      stageDisplay = `Stage 3 · 比赛节奏与专项转化期（距目标 ${weeksToRace} 周）`;
      weekFocus = '以实测能力标定配速为核心执行 800m 节奏习惯化与极低频特种抗酸（PreComp，非减量期）';
    } else {
      currentStage = 'Peak';
      blockedReasons.push('缺少全力能力测试标定（亚极量观察跑不可直接替代），暂缓切入 PreComp 比赛节奏转化');
      stageDisplay = `Stage 2 · 专项准备与 VO2 强化期（暂缓进入 PreComp，待有效能力标定）`;
      weekFocus = '先以 VO2max 与稳态有氧巩固，待耐受稳固并完成适配能力测试后再转入比赛节奏期';
    }
  } else if (weeksToRace <= 10 && recent4wAvgKm >= 20 && ctl >= 16 && recoveryOk && stableCompletionOk) {
    currentStage = 'Peak';
    stageDisplay = `Stage 2 · 专项准备与 VO2 强化期（距目标 ${weeksToRace} 周）`;
    weekFocus = '有氧功率与短阈值/长间歇平稳推进，课后严守 48–72h 恢复观察';
  } else {
    currentStage = 'Build';
    stageDisplay = `Stage 1 · 有氧扩容与基础速度期（近期4周均跑量 ${recent4wAvgKm}km）`;
    weekFocus = '连续周骨架下极化有氧与短坡/基础速度激活，按完成情况单变量微调';
  }

  const ltPaceSec = Number(config.physiology?.ltPaceSecPerKm || 285);
  const ltSource = config.physiologyMeta?.ltPace?.confidence || 'heuristic_estimate';
  const easyPaceSec = currentStage === 'Base' ? Math.max(345, Math.round(ltPaceSec * 1.26)) : Math.round(ltPaceSec * 1.22);
  const currentThresholdPaceSec = currentStage === 'Base' ? Math.round(ltPaceSec * 1.05) : ltPaceSec;
  const currentIntervalPaceSec = Math.round(currentThresholdPaceSec * 0.91);
  const currentRepPaceSec = Math.round(currentThresholdPaceSec * 0.85);

  const goalTimeStr = config.goal?.targetTime || '00:02:01';
  const goal800Sec = parseGoalSeconds(goalTimeStr) || 121;
  const goalPaceSecPerKm = Math.round(goal800Sec / 0.8);

  return {
    weeksToRace,
    recent4wAvgKm,
    latestWeekKm,
    ctl: round1(ctl),
    currentStage,
    stageDisplay,
    weekFocus,
    upgradeGate: {
      injuryClear,
      recoveryOk,
      stableCompletionOk,
      recoveryStatus,
      stableCompletionStatus,
      hasValidMasTest,
      hasValidMssTest,
      completedSessions14d: review?.completedSessions14d ?? 0,
      blockedReasons
    },
    paces: {
      easyPaceSec,
      thresholdPaceSec: currentThresholdPaceSec,
      intervalPaceSec: currentIntervalPaceSec,
      repPaceSec: currentRepPaceSec,
      goalPaceSecPerKm,
      ltPaceConfidence: ltSource
    }
  };
}

/**
 * 计算当前阶段 + 周复盘进退状态所允许的课表硬边界
 */
export function getStagePolicy(stageInfo = {}, progRec = 'hold') {
  const currentStage = stageInfo?.currentStage || 'Base';
  const paces = stageInfo?.paces || {};
  const hasValidMasTest = Boolean(stageInfo?.upgradeGate?.hasValidMasTest);
  const easyPaceSec = Number(paces.easyPaceSec || 355);
  const repPaceSec = Number(paces.repPaceSec || 242);
  const conservativeFastCap = Math.max(205, Math.round(repPaceSec * 0.94));
  const calibratedFastCap = Math.max(150, Math.round(repPaceSec * 0.85));

  const table = {
    Base: {
      allowedTypes: new Set(['REST', 'STR', 'E']),
      maxIntervalWorkKm: 0,
      maxIntervalRepMeters: 0,
      maxStridesReps: 4,
      maxStridesMeters: 80,
      maxRunDayKm: 6.5,
      minPaceSec: Math.max(300, Math.round(easyPaceSec * 0.88)),
      maxHardPerWeek: 0,
      stageFloorKm: 16.5
    },
    Build: {
      allowedTypes: new Set(['REST', 'STR', 'E', 'LSD', 'T', 'R']),
      maxIntervalWorkKm: 3.2,
      maxIntervalRepMeters: 400,
      maxStridesReps: 6,
      maxStridesMeters: 100,
      maxRunDayKm: 12.0,
      minPaceSec: conservativeFastCap,
      maxHardPerWeek: progRec === 'eligible_single_variable' ? 2 : 1,
      stageFloorKm: 24.0
    },
    Peak: {
      allowedTypes: new Set(['REST', 'STR', 'E', 'LSD', 'M', 'T', 'I', 'R']),
      maxIntervalWorkKm: 4.0,
      maxIntervalRepMeters: 1200,
      maxStridesReps: 6,
      maxStridesMeters: 120,
      maxRunDayKm: 13.5,
      minPaceSec: hasValidMasTest ? calibratedFastCap : conservativeFastCap,
      maxHardPerWeek: progRec === 'eligible_single_variable' ? 2 : 1,
      stageFloorKm: 28.0
    },
    PreComp: {
      allowedTypes: new Set(['REST', 'STR', 'E', 'LSD', 'M', 'T', 'I', 'R']),
      maxIntervalWorkKm: 4.0,
      maxIntervalRepMeters: 1200,
      maxStridesReps: 6,
      maxStridesMeters: 120,
      maxRunDayKm: 13.5,
      minPaceSec: calibratedFastCap,
      maxHardPerWeek: progRec === 'eligible_single_variable' ? 2 : 1,
      stageFloorKm: 26.0
    },
    Taper: {
      allowedTypes: new Set(['REST', 'STR', 'E', 'LSD', 'R']),
      maxIntervalWorkKm: 1.2,
      maxIntervalRepMeters: 300,
      maxStridesReps: 4,
      maxStridesMeters: 100,
      maxRunDayKm: 7.0,
      minPaceSec: hasValidMasTest ? calibratedFastCap : conservativeFastCap,
      maxHardPerWeek: 1,
      stageFloorKm: 16.0
    }
  };

  const basePolicy = table[currentStage] || table.Base;
  if (progRec === 'regress') {
    return {
      ...basePolicy,
      currentStage,
      allowedTypes: new Set(['REST', 'STR', 'E', 'LSD'].filter((t) => basePolicy.allowedTypes.has(t))),
      maxIntervalWorkKm: 0,
      maxIntervalRepMeters: 0,
      maxHardPerWeek: 0,
      minPaceSec: Math.max(basePolicy.minPaceSec, Math.round(easyPaceSec * 0.90))
    };
  }
  return { ...basePolicy, currentStage };
}

/**
 * 检验单日课表是否越过当前阶段、能力测试门控或维持负荷边界
 */
export function evaluateDayStageCompliance(day, policy, stageInfo = {}) {
  const violations = [];
  const type = String(day?.type || 'REST').toUpperCase();
  if (!policy.allowedTypes.has(type)) {
    violations.push(`当前阶段 ${policy.currentStage} 不允许课程类型 ${type}`);
  }

  if (type === 'REST') {
    return { compliant: violations.length === 0, violations };
  }

  const steps = Array.isArray(day?.steps) ? day.steps : [];
  let intervalWorkKm = 0;
  for (const s of steps) {
    const k = String(s?.kind || '').toLowerCase();
    if (k === 'interval') {
      const reps = Number(s?.reps || 0);
      const distM = Number(s?.distanceMeters || 0);
      intervalWorkKm += (reps * distM) / 1000;
      if (policy.maxIntervalWorkKm === 0) {
        violations.push(`${policy.currentStage} 阶段禁止高强间歇步骤 (${reps}×${distM}m)`);
      } else if (policy.maxIntervalRepMeters > 0 && distM > policy.maxIntervalRepMeters) {
        violations.push(`${policy.currentStage} 阶段单组间歇距离 ${distM}m 超过上限 ${policy.maxIntervalRepMeters}m`);
      }
    } else if (k === 'strides') {
      const reps = Number(s?.reps || 0);
      const distM = Number(s?.distanceMeters || 0);
      if (reps > policy.maxStridesReps || distM > policy.maxStridesMeters) {
        violations.push(`${policy.currentStage} 阶段步幅激活超量 (${reps}×${distM}m)`);
      }
    }

    if (s?.pace && ['interval', 'steady', 'strides'].includes(k)) {
      const sec = parsePaceSecPerKm(s.pace);
      if (sec && sec < policy.minPaceSec) {
        violations.push(
          `步骤配速 ${s.pace} 快于当前阶段/${stageInfo?.upgradeGate?.hasValidMasTest ? '能力' : '未测试标定'}安全下限 ${formatPace(policy.minPaceSec)}/km`
        );
      }
    }
  }

  if (policy.maxIntervalWorkKm > 0 && intervalWorkKm > policy.maxIntervalWorkKm + 0.05) {
    violations.push(
      `单次间歇跑量 ${round1(intervalWorkKm)}km 超过阶段上限 ${policy.maxIntervalWorkKm}km`
    );
  }

  if (Number(day?.plannedDistanceKm || 0) > policy.maxRunDayKm + 0.05 && RUNNING_TYPES.has(type)) {
    violations.push(`单日跑量 ${day.plannedDistanceKm}km 超过 ${policy.currentStage} 上限 ${policy.maxRunDayKm}km`);
  }

  const baseSec = parsePaceSecPerKm(day?.basePace);
  if (RUNNING_TYPES.has(type) && baseSec && baseSec < policy.minPaceSec) {
    violations.push(
      `课表配速 ${day.basePace} 快于阶段安全下限 ${formatPace(policy.minPaceSec)}/km`
    );
  }

  const cleanedText = stripNegatedLoadPhrases(`${day?.title || ''} ${day?.mainSetSummary || ''}`);
  if (policy.currentStage !== 'PreComp' && /\bPreComp\b/i.test(cleanedText)) {
    violations.push(`文本包含越级标签 PreComp`);
  }
  const repMatch = cleanedText.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i);
  if (repMatch && policy.maxIntervalWorkKm === 0 && Number(repMatch[2]) > 100) {
    violations.push(`${policy.currentStage} 阶段禁止出现 ${repMatch[0]} 长距离高强间歇`);
  }

  return { compliant: violations.length === 0, violations };
}

function makeDowngradedEasyDay(day, { reason = '周负荷门控降级为轻松有氧', easyPaceSec = 360, lthr = 183, targetKm = 3.8 } = {}) {
  const easyCeiling = Math.round(lthr * 0.81);
  const paceStr = `${formatPace(easyPaceSec + 10)}/km`;
  const steps = [
    { kind: 'warmup', durationMin: 4, distanceKm: 0.5, description: '轻松慢启动热身' },
    { kind: 'steady', distanceKm: Math.max(2.0, round1(targetKm - 0.9)), pace: paceStr, targetHr: `<= ${easyCeiling} bpm`, description: '轻松对话有氧跑' },
    { kind: 'cooldown', durationMin: 3, distanceKm: 0.4, description: '慢走冷身' }
  ];
  const compiled = compileStepsToMetrics(steps, easyPaceSec + 10);
  return {
    ...day,
    type: 'E',
    steps,
    title: `🛡️ 负荷门控调整 · 轻松有氧 (${compiled.plannedDistanceKm}km)`,
    plannedDistanceKm: compiled.plannedDistanceKm,
    plannedDurationMin: compiled.plannedDurationMin,
    estimatedTss: Math.max(15, Math.round(compiled.plannedDurationMin * 0.75)),
    basePace: paceStr,
    targetHr: `<= ${easyCeiling} bpm (Z1-Z2)`,
    targetCadence: '自然舒适步频（观察记录）',
    rpe: '3.5/10',
    warmup: '0.5km 慢跑 + 关节动态激活',
    mainSetSummary: compiled.mainSetSummary,
    mainSetDetail: `${compiled.mainSetDetail}；原因：${reason}`,
    cooldown: '慢走 3 分钟与下肢放松',
    coachTip: reason
  };
}

function trimDayDistanceConsistent(day, trimKmNeeded, { easyPaceSec, lthr, reason }) {
  const curKm = Number(day.plannedDistanceKm || 0);
  if (curKm <= 2.2 || trimKmNeeded <= 0) return { changed: false, day };
  const targetRatio = Math.max(0.45, Math.min(0.85, (curKm - trimKmNeeded) / curKm));
  if (!day.reductionMeta?.applied) {
    const reduced = reduceWorkoutConsistent(day, { factor: targetRatio, reason, easyPaceSec, lthr });
    if (reduced.plannedDistanceKm < curKm - 0.1) {
      return { changed: true, day: reduced };
    }
  }
  if (Array.isArray(day.steps) && day.steps.length > 0) {
    const nextSteps = structuredClone(day.steps);
    const steadyStep = nextSteps.find((s) => s.kind === 'steady' && Number(s.distanceKm || 0) > 2.0);
    if (steadyStep) {
      const oldKm = Number(steadyStep.distanceKm);
      const cut = Math.min(oldKm - 1.5, trimKmNeeded);
      if (cut >= 0.3) {
        steadyStep.distanceKm = round1(oldKm - cut);
        if (steadyStep.durationMin) {
          steadyStep.durationMin = Math.max(
            10,
            Math.round(Number(steadyStep.durationMin) * (steadyStep.distanceKm / oldKm))
          );
        }
        const compiled = compileStepsToMetrics(nextSteps, easyPaceSec);
        if (compiled) {
          return {
            changed: true,
            day: {
              ...day,
              steps: nextSteps,
              plannedDistanceKm: compiled.plannedDistanceKm,
              plannedDurationMin: compiled.plannedDurationMin,
              mainSetSummary: `${compiled.mainSetSummary}（按周负荷上限同步缩减至 ${compiled.plannedDistanceKm}km）`,
              mainSetDetail: `${compiled.mainSetDetail}；${reason}`
            }
          };
        }
      }
    }
  }
  const targetKm = Math.max(2.5, round1(curKm - trimKmNeeded));
  if (targetKm < curKm - 0.2) {
    return {
      changed: true,
      day: makeDowngradedEasyDay(day, { reason, easyPaceSec, lthr, targetKm })
    };
  }
  return { changed: false, day };
}

function parseGoalSeconds(targetTime) {
  const parts = String(targetTime || '').trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

/**
 * 由结构化 steps 单一数据源计算距离、时长、主课摘要与详单文案
 */
export function compileStepsToMetrics(steps = [], fallbackPaceSec = 360) {
  const check = validateStepsSchema(steps);
  if (!check.valid) {
    return null;
  }

  let totalKm = 0;
  let totalMin = 0;
  const summaryParts = [];
  const detailLines = [];
  let primaryPaceSec = null;

  for (let idx = 0; idx < steps.length; idx++) {
    const s = steps[idx];
    const kind = String(s.kind || 'steady').toLowerCase();
    const numLabel = `${idx + 1})`;

    if (kind === 'warmup' || kind === 'cooldown') {
      const distKm = Number(s.distanceKm ?? 0);
      const paceSec = parsePaceSecPerKm(s.pace) || fallbackPaceSec + 20;
      const rawDur = s.durationMin !== undefined && s.durationMin !== null ? Number(s.durationMin) : null;
      const durMin = rawDur != null && Number.isFinite(rawDur)
        ? Math.max(1, Math.round(rawDur))
        : (distKm > 0 ? Math.max(1, Math.round((distKm * paceSec) / 60)) : 6);
      totalKm += distKm;
      totalMin += durMin;
      const desc = s.description || (kind === 'warmup' ? '轻松慢跑热身与动态激活' : '冷身慢走与拉伸');
      detailLines.push(`${numLabel} ${kind === 'warmup' ? '热身' : '冷身'}：${distKm > 0 ? `${round1(distKm)}km / ` : ''}${durMin}min${desc ? `（${desc}）` : ''}`);
      continue;
    }

    if (kind === 'interval' || kind === 'strides') {
      const reps = Math.max(1, Math.round(Number(s.reps ?? 1)));
      const distM = Math.max(20, Math.round(Number(s.distanceMeters ?? 200)));
      const stepKm = (reps * distM) / 1000;
      const paceSec = parsePaceSecPerKm(s.pace) || fallbackPaceSec;
      const repSec = s.splitTargetSec !== undefined && s.splitTargetSec !== null
        ? Number(s.splitTargetSec)
        : Math.round((distM / 1000) * paceSec);
      const rawRest = s.restSec !== undefined && s.restSec !== null ? Number(s.restSec) : 90;
      const restSec = Number.isFinite(rawRest) ? Math.max(0, Math.round(rawRest)) : 90;
      const restLabel = restSec >= 60 ? `${round1(restSec / 60)}min` : `${restSec}s`;
      const blockMin = Math.max(1, Math.round((reps * repSec + Math.max(0, reps - 1) * restSec) / 60));

      totalKm += stepKm;
      totalMin += blockMin;
      if (kind === 'interval' && !primaryPaceSec) primaryPaceSec = paceSec;

      const paceNote = s.pace ? ` @ ${s.pace}` : s.splitTargetSec ? `（约 ${s.splitTargetSec}s/组）` : '';
      const restText = restSec > 0
        ? `，组休 ${restLabel}${s.restType === 'jog' ? '慢跑' : '走休'}`
        : '，组休 0s';
      const spec = `${reps}×${distM}m${paceNote}${restText}`;
      summaryParts.push(spec);
      detailLines.push(`${numLabel} ${s.description || (kind === 'strides' ? '神经步幅加速' : '主间歇')}: ${spec}`);
      continue;
    }

    if (kind === 'steady') {
      const distKm = Math.max(0, Number(s.distanceKm ?? 0));
      const paceSec = parsePaceSecPerKm(s.pace) || fallbackPaceSec;
      const rawDur = s.durationMin !== undefined && s.durationMin !== null ? Number(s.durationMin) : null;
      const durMin = rawDur != null && Number.isFinite(rawDur)
        ? Math.max(1, Math.round(rawDur))
        : (distKm > 0 ? Math.max(1, Math.round((distKm * paceSec) / 60)) : 20);
      totalKm += distKm;
      totalMin += durMin;
      if (!primaryPaceSec && (distKm > 0 || s.pace)) primaryPaceSec = paceSec;
      const measure = distKm > 0 ? `${round1(distKm)}km` : `${durMin}min`;
      const spec = `${measure}${s.pace ? ` @ ${s.pace}` : ''}${s.targetHr ? ` (${s.targetHr})` : ''}`;
      summaryParts.push(spec);
      detailLines.push(
        `${numLabel} ${s.description || '稳态有氧'}: ${spec}${distKm > 0 ? `，约 ${durMin}min` : ''}`
      );
      continue;
    }

    // strength / cross / rest
    const rawAuxDur = s.durationMin !== undefined && s.durationMin !== null ? Number(s.durationMin) : 20;
    const durMin = Number.isFinite(rawAuxDur) ? Math.max(0, Math.round(rawAuxDur)) : 20;
    totalMin += durMin;
    const spec = `${s.description || '辅助训练'} (${durMin}min)`;
    summaryParts.push(spec);
    detailLines.push(`${numLabel} ${spec}`);
  }

  return {
    plannedDistanceKm: round1(totalKm),
    plannedDurationMin: Math.max(0, Math.round(totalMin)),
    primaryPaceSec,
    mainSetSummary: summaryParts.join(' + ') || '按步骤执行',
    mainSetDetail: detailLines.join('；')
  };
}

/**
 * 尝试把简单清晰的旧文本课表安全解析为 steps；结构复杂或不明确时返回 null（不猜测）
 */
export function parseUnambiguousRunningSteps(day) {
  if (!day) return null;
  const type = String(day.type || '').toUpperCase();
  if (!RUNNING_TYPES.has(type)) return null;

  const text = `${day.title || ''} ${day.mainSetSummary || ''} ${day.mainSetDetail || ''}`;
  // 若包含复合力量/稳定训练动作，不冒充可自动按步减量
  if (/深蹲|硬拉|腿举|提踵|卧推|引体|死虫|静蹲|臀桥|平板/.test(text)) {
    return null;
  }

  const intervalMatch = text.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(km|公里|m|米)/i);
  if (intervalMatch && ['T', 'I', 'R'].includes(type)) {
    const reps = Number(intervalMatch[1]);
    const rawLen = Number(intervalMatch[2]);
    const unit = intervalMatch[3].toLowerCase();
    const meters = unit === 'km' || unit === '公里' ? Math.round(rawLen * 1000) : Math.round(rawLen);
    if (reps >= 2 && meters >= 100) {
      const paceStr = day.basePace && day.basePace !== '--' ? day.basePace : null;
      const workKm = (reps * meters) / 1000;
      const plannedKm = Number(day.plannedDistanceKm || workKm);
      const extraKm = Math.max(0, plannedKm - workKm);
      const warmupKm = extraKm >= 1.5 ? round1(extraKm * 0.6) : round1(extraKm);
      const cooldownKm = round1(Math.max(0, extraKm - warmupKm));
      const restSecMatch = text.match(/(?:休|走休|恢复)\s*(\d+)\s*(秒|s|分|min)/i);
      const restSec = restSecMatch
        ? restSecMatch[2].startsWith('分') || restSecMatch[2] === 'min'
          ? Number(restSecMatch[1]) * 60
          : Number(restSecMatch[1])
        : 120;

      const steps = [];
      if (warmupKm > 0) steps.push({ kind: 'warmup', distanceKm: warmupKm, description: '轻松慢跑热身' });
      steps.push({
        kind: 'interval',
        reps,
        distanceMeters: meters,
        pace: paceStr,
        restSec,
        restType: 'walk',
        description: `${type} 间歇主课`
      });
      if (cooldownKm > 0) steps.push({ kind: 'cooldown', distanceKm: cooldownKm, description: '慢跑冷身与拉伸' });
      return steps;
    }
  }

  const steadyKm = Number(day.plannedDistanceKm || 0);
  if (['E', 'LSD', 'M'].includes(type) && steadyKm > 0 && !intervalMatch) {
    const paceStr = day.basePace && day.basePace !== '--' ? day.basePace : null;
    return [
      {
        kind: 'steady',
        distanceKm: steadyKm,
        pace: paceStr,
        targetHr: day.targetHr || null,
        description: day.title || '有氧稳态跑'
      }
    ];
  }

  return null;
}

/**
 * 对单日课表执行严格一致的减量调整：
 * - 有明确 steps 时直接调整组数或距离，并重新编译摘要、详单、总距离与时长
 * - 无法可靠调整的旧文本课表，直接替换为可验证的替代课，避免正文与摘要矛盾
 */
export function reduceWorkoutConsistent(day, { factor = 0.75, reason = '', easyPaceSec = 360, lthr = 183 } = {}) {
  const safeFactor = Math.min(0.85, Math.max(0.4, factor));
  const steps = Array.isArray(day.steps) && day.steps.length > 0 ? structuredClone(day.steps) : parseUnambiguousRunningSteps(day);

  if (steps) {
    let adjusted = false;
    let repChangeDesc = '';
    const beforeCompiled = compileStepsToMetrics(steps, easyPaceSec);
    const beforeKm = Number(day.plannedDistanceKm || 0) || beforeCompiled?.plannedDistanceKm || 0;
    const beforeMin = Number(day.plannedDurationMin || 0) || beforeCompiled?.plannedDurationMin || 0;

    for (const s of steps) {
      if ((s.kind === 'interval' || s.kind === 'strides') && Number(s.reps || 1) >= 2) {
        const oldReps = Number(s.reps);
        const newReps = Math.max(1, Math.min(oldReps - 1, Math.round(oldReps * safeFactor)));
        s.reps = newReps;
        adjusted = true;
        repChangeDesc = `由原 ${oldReps} 组减为 ${newReps} 组`;
      } else if (s.kind === 'steady' && Number(s.distanceKm || 0) > 1.5) {
        const oldKm = Number(s.distanceKm);
        const newKm = Math.max(1.5, round1(oldKm * safeFactor));
        s.distanceKm = newKm;
        if (s.durationMin) {
          s.durationMin = Math.max(10, Math.round(Number(s.durationMin) * (newKm / oldKm)));
        }
        adjusted = true;
        repChangeDesc = `${oldKm}km 减为 ${newKm}km`;
      } else if (s.kind === 'steady' && !s.distanceKm && Number(s.durationMin || 0) >= 20) {
        const oldMin = Number(s.durationMin);
        const newMin = Math.max(15, Math.round(oldMin * safeFactor));
        s.durationMin = newMin;
        adjusted = true;
        repChangeDesc = `${oldMin}min 减为 ${newMin}min`;
      }
    }

    if (adjusted) {
      const compiled = compileStepsToMetrics(steps, easyPaceSec);
      const actualPct = beforeKm > 0
        ? Math.max(5, Math.round(((beforeKm - compiled.plannedDistanceKm) / beforeKm) * 100))
        : beforeMin > 0
          ? Math.max(5, Math.round(((beforeMin - compiled.plannedDurationMin) / beforeMin) * 100))
          : Math.round((1 - safeFactor) * 100);

      const cleanTitle = String(day.title || '').replace(/^🟡\s*门控降级\s*·\s*/g, '').replace(/\s*\(减量.*?\)\s*$/g, '');
      return {
        ...day,
        steps,
        title: `🟡 门控降级 · ${cleanTitle}（实减 ${actualPct}%）`,
        plannedDistanceKm: compiled.plannedDistanceKm,
        plannedDurationMin: compiled.plannedDurationMin,
        estimatedTss: Math.max(8, Math.round(Number(day.estimatedTss || 30) * (1 - actualPct / 100))),
        mainSetSummary: `${compiled.mainSetSummary}（较原计划实减 ${actualPct}%：${repChangeDesc}）`,
        mainSetDetail: `${compiled.mainSetDetail}；降量原因：${reason || '恢复指标偏低，控量保质'}`,
        rpe: '5-6/10',
        reductionMeta: {
          applied: true,
          actualReductionPct: actualPct,
          reason
        }
      };
    }
  }

  // 无法安全按步拆解的旧文本/复合课：用可验证的轻量 800m 低冲击替代课替换，绝不保留矛盾原文
  const subSteps = [
    { kind: 'warmup', durationMin: 5, distanceKm: 0.6, description: '轻度动态热身' },
    { kind: 'steady', distanceKm: 2.5, durationMin: 16, pace: `${formatPace(easyPaceSec + 20)}/km`, targetHr: `<= ${Math.round(lthr * 0.80)} bpm`, description: '低强度有氧替代跑（或等价 25min 功率车）' },
    { kind: 'cooldown', durationMin: 5, distanceKm: 0.4, description: '慢走与柔韧放松' }
  ];
  const compiled = compileStepsToMetrics(subSteps, easyPaceSec + 20);
  return {
    ...day,
    type: 'E',
    steps: subSteps,
    title: `🟡 门控替换 · 低冲击有氧替代课（原复合/文本课无法安全拆分减量）`,
    plannedDistanceKm: compiled.plannedDistanceKm,
    plannedDurationMin: compiled.plannedDurationMin,
    estimatedTss: 18,
    basePace: `${formatPace(easyPaceSec + 20)}/km`,
    targetHr: `130-${Math.round(lthr * 0.80)} bpm (Z1-Z2 低强)`,
    rpe: '4/10',
    warmup: '5分钟关节动态激活与慢走过渡',
    mainSetSummary: `${compiled.mainSetSummary}（已替代原不可拆分课表，严控低负荷）`,
    mainSetDetail: `${compiled.mainSetDetail}；替换原因：${reason || '生理/疲劳门控触发'}（若下肢不适可全量换为 25min 功率车）。`,
    cooldown: '慢走 5 分钟与温和拉伸',
    reductionMeta: {
      applied: true,
      replacedWithVerifiableFallback: true,
      reason
    }
  };
}

/**
 * 解析个人暂定轻松跑心率上限：优先采用 runner.config 中校准的 easyHrCeiling，否则按 LTHR 83% 估算
 */
export function resolveEasyHrCeiling(config = {}, lthr = 183) {
  const configured = Number(
    config?.physiology?.easyHrCeiling ?? config?.physiologyMeta?.easyHrCeiling?.value
  );
  if (Number.isFinite(configured) && configured >= 110 && configured <= 210) {
    return Math.round(configured);
  }
  return Math.round((Number(lthr) || 183) * 0.83);
}

/**
 * 800m 专项周期备用课表库（替代原有半马/全马 20km LSD 与 4x2000m 阈值模板）
 */
export function build800mFallbackDay({ dow, stageInfo, lthr, config = {}, progressionRecommendation = 'hold' }) {
  const { currentStage, recent4wAvgKm, paces } = stageInfo;
  const easyCeiling = resolveEasyHrCeiling(config, lthr); // 个人暂定轻松跑心率上限
  const easyHrLabel = `<= ${easyCeiling} bpm（个人暂定 Z1-Z2 上限，配合呼吸可完整对话）`;
  const isHoldOrRegress = progressionRecommendation !== 'eligible_single_variable';
  const isRegress = progressionRecommendation === 'regress';

  // Stage 0：复训组织适应期（严格隔天、低跑量、无高酸间歇）
  if (currentStage === 'Base') {
    const scaleKm = recent4wAvgKm >= 10 ? 4.0 : 3.2;
    if (dow === 1) {
      return makeRestDay('W-Base 周一 · 下肢修复休息日', '停跑复训期保持跑休间隔，下肢脱离冲击。');
    }
    if (dow === 2) {
      const steps = [
        { kind: 'warmup', durationMin: 5, distanceKm: 0.6, description: '关节绕环与动态激活' },
        { kind: 'steady', distanceKm: scaleKm, pace: `${formatPace(paces.easyPaceSec)}/km`, targetHr: easyHrLabel, description: '温和有氧基础跑' },
        { kind: 'cooldown', durationMin: 5, distanceKm: 0.4, description: '慢走冷身与柔韧放松' }
      ];
      const compiled = compileStepsToMetrics(steps, paces.easyPaceSec);
      return {
        type: 'E',
        title: `Stage 0 有氧唤醒轻松跑 (${compiled.plannedDistanceKm}km)`,
        steps,
        ...compiled,
        estimatedTss: 22,
        baseSec: paces.easyPaceSec,
        hrRange: easyHrLabel,
        cadence: '自然舒适步频（观察记录）',
        rpe: '3.5/10',
        warmup: '5分钟关节动态激活 + 0.6km 慢启动',
        cooldown: '慢走冷身 5 分钟与常规下肢拉伸',
        carbFactor: 0.6,
        tip: '复训初期不追配速，参考暂定心率上限与轻松对话呼吸感执行。'
      };
    }
    if (dow === 3 || dow === 5) {
      const steps =
        dow === 3
          ? [
              { kind: 'strength', durationMin: 25, description: '精简下肢主力量：深蹲 3×8 + RDL 3×8 + 提踵 3×12（RIR 2–3）' },
              { kind: 'cross', durationMin: 20, description: '低阻单车/椭圆机轻松有氧排酸' }
            ]
          : [{ kind: 'cross', durationMin: 40, description: '低阻椭圆机/功率车纯有氧 + 上肢/核心力量（留 2-3 次余力）' }];
      const compiled = compileStepsToMetrics(steps, paces.easyPaceSec);
      return {
        type: 'STR',
        title: dow === 3 ? 'Stage 0 精简下肢主力量 + 低阻单车' : 'Stage 0 无冲击交叉有氧日',
        steps,
        ...compiled,
        estimatedTss: 24,
        baseSec: paces.easyPaceSec,
        hrRange: `<= ${easyCeiling - 4} bpm（Z1-Z2 低强）`,
        cadence: '--',
        rpe: '4/10',
        warmup: '5分钟低阻力热身与髋周激活',
        cooldown: '5分钟低阻冷身与温和拉伸',
        carbFactor: 0.5,
        tip:
          dow === 3
            ? '保留 2 个下肢复合主动作 + 1 个小腿辅助，记录重量/组数/RIR 与次日反应再决定微调。'
            : '用无冲击设备补充有氧时长，同时给肌腱 48 小时恢复窗口。'
      };
    }
    if (dow === 4) {
      const steps = [
        { kind: 'warmup', durationMin: 5, distanceKm: 0.5, description: '慢启动热身' },
        { kind: 'steady', distanceKm: round1(scaleKm + 0.3), pace: `${formatPace(paces.easyPaceSec)}/km`, targetHr: easyHrLabel, description: '稳态轻松跑' },
        { kind: 'strides', reps: 3, distanceMeters: 50, restSec: 90, restType: 'walk', description: 'SPD-STRIDES 渐加速步幅激活（85-90% 流畅加速，轻快可控）' },
        { kind: 'cooldown', durationMin: 5, distanceKm: 0.4, description: '慢走冷身' }
      ];
      const compiled = compileStepsToMetrics(steps, paces.easyPaceSec);
      return {
        type: 'E',
        title: `Stage 0 轻松有氧 + 3×50m 步幅激活 (SPD-STRIDES)`,
        steps,
        ...compiled,
        estimatedTss: 25,
        baseSec: paces.easyPaceSec,
        hrRange: `${easyHrLabel}；Strides 不看心率`,
        cadence: '自然舒适步频（观察记录）',
        rpe: '4/10',
        warmup: '0.5km 慢跑 + 动态髋踝激活',
        cooldown: '慢走冷身与下肢拉伸',
        carbFactor: 0.65,
        tip: '微剂量渐加速跑仅用于维持步幅弹性，每组走回 90 秒完全恢复。'
      };
    }
    if (dow === 6) {
      return makeRestDay('W-Base 周六 · 主动恢复与柔韧日', '周日主耐力跑前保持下肢新鲜。');
    }
    // 周日：Stage 0 最长跑仅 4.5-5.5km，绝非 20km LSD
    const longKm = recent4wAvgKm >= 10 ? 5.0 : 4.0;
    const steps = [
      { kind: 'warmup', durationMin: 6, distanceKm: 0.8, description: '前 800m 慢过渡' },
      { kind: 'steady', distanceKm: longKm, pace: `${formatPace(paces.easyPaceSec)}/km`, targetHr: easyHrLabel, description: 'Stage 0 周末稳态有氧' },
      { kind: 'cooldown', durationMin: 5, distanceKm: 0.4, description: '慢走冷身' }
    ];
    const compiled = compileStepsToMetrics(steps, paces.easyPaceSec);
    return {
      type: 'E',
      title: `Stage 0 周末有氧续航跑 (${compiled.plannedDistanceKm}km)`,
      steps,
      ...compiled,
      estimatedTss: 32,
      baseSec: paces.easyPaceSec,
      hrRange: easyHrLabel,
      cadence: '自然舒适步频（观察记录）',
      rpe: '4.5/10',
      warmup: '0.8km 慢启动',
      cooldown: '慢走 5 分钟与温和放松',
      carbFactor: 0.75,
      tip: '周跑量不按日历强涨，周末结合完成度与次日反应决定下周是否仅微调一个负荷变量。'
    };
  }

  // Stage 1 (Build) / Stage 2 (Peak) / Stage 3 (PreComp) / Stage 4 (Taper)：全面采用 800m 决策卡库
  if (dow === 1) {
    return makeRestDay('800m 周期周一 · 神经肌肉与组织修复日', '保证高质速度与间歇课前的完全恢复。');
  }
  if (dow === 2) {
    if (currentStage === 'Taper') {
      const steps = [
        { kind: 'warmup', durationMin: 12, distanceKm: 2.0, description: '轻松慢跑 + 动态拉伸' },
        { kind: 'interval', reps: 3, distanceMeters: 200, pace: `${formatPace(paces.repPaceSec)}/km`, restSec: 240, restType: 'walk', description: 'SE-TAPER-SHARP 赛前节奏唤醒' },
        { kind: 'cooldown', durationMin: 8, distanceKm: 1.0, description: '放松冷身慢跑' }
      ];
      const compiled = compileStepsToMetrics(steps, paces.repPaceSec);
      return {
        type: 'R',
        title: 'SE-TAPER-SHARP 赛前锐化节奏课 (3×200m)',
        steps,
        ...compiled,
        estimatedTss: 36,
        baseSec: paces.repPaceSec,
        hrRange: '按分段秒表配速与 4min 完全走休执行',
        cadence: '自然轻快高步频（观察记录）',
        rpe: '7/10',
        warmup: '2km 轻松跑 + 动作激活',
        cooldown: '1km 放松冷身',
        carbFactor: 0.85,
        tip: '赛前独立减量窗口以保持新鲜弹性为主，掉速超过 3% 立刻停表。'
      };
    }

    // Build / Peak / PreComp 周二：回退期降为轻松有氧；维持期/进阶期按当前阶段从决策卡库选 THR-CRUISE / VO2-LONG
    if (isRegress) {
      const steps = [
        { kind: 'warmup', durationMin: 6, distanceKm: 0.6, description: '轻松慢启动热身' },
        { kind: 'steady', distanceKm: 3.4, pace: `${formatPace(paces.easyPaceSec + 10)}/km`, targetHr: easyHrLabel, description: '回退观察期温和有氧跑' },
        { kind: 'cooldown', durationMin: 4, distanceKm: 0.4, description: '慢走冷身' }
      ];
      const compiled = compileStepsToMetrics(steps, paces.easyPaceSec + 10);
      return {
        type: 'E',
        title: `回退观察轻松跑 (${compiled.plannedDistanceKm}km)`,
        steps,
        ...compiled,
        estimatedTss: 22,
        baseSec: paces.easyPaceSec + 10,
        hrRange: easyHrLabel,
        cadence: '自然舒适步频',
        rpe: '3.5/10',
        warmup: '0.6km 慢跑 + 关节激活',
        cooldown: '慢走 4 分钟与放松拉伸',
        carbFactor: 0.65,
        tip: '周复盘要求回退减负，暂停高强质量课，待恢复良好再重建强度。'
      };
    }

    const isPeakOrPreComp = currentStage === 'Peak' || currentStage === 'PreComp';
    const steps = isPeakOrPreComp
      ? [
          { kind: 'warmup', durationMin: 12, distanceKm: 2.0, description: '轻松跑 + 2×100m 预激活' },
          { kind: 'interval', reps: 4, distanceMeters: 800, pace: `${formatPace(paces.intervalPaceSec)}/km`, restSec: 150, restType: 'walk', description: 'VO2-LONG 800m 红区长间歇（按当前能力配速）' },
          { kind: 'cooldown', durationMin: 8, distanceKm: 1.0, description: '慢跑冷身与拉伸' }
        ]
      : [
          { kind: 'warmup', durationMin: 10, distanceKm: 1.6, description: '轻松跑 + 动态激活' },
          { kind: 'interval', reps: 6, distanceMeters: 400, pace: `${formatPace(paces.thresholdPaceSec)}/km`, restSec: 30, restType: 'walk', description: 'THR-CRUISE 短组阈值巡航（按当前能力暂定配速）' },
          { kind: 'cooldown', durationMin: 8, distanceKm: 1.0, description: '慢跑冷身' }
        ];
    const primarySec = isPeakOrPreComp ? paces.intervalPaceSec : paces.thresholdPaceSec;
    const compiled = compileStepsToMetrics(steps, primarySec);
    return {
      type: isPeakOrPreComp ? 'I' : 'T',
      title: isPeakOrPreComp ? 'VO2-LONG 800m 长间歇 (4×800m)' : 'THR-CRUISE 800m 力学分段阈值 (6×400m)',
      steps,
      ...compiled,
      estimatedTss: isPeakOrPreComp ? 64 : 52,
      baseSec: primarySec,
      hrRange: isPeakOrPreComp ? `174-${Math.round(lthr * 1.06)} bpm (Z4-Z5)` : `164-${Math.round(lthr * 0.98)} bpm (Z3-Z4)`,
      cadence: '自然舒适步频（观察记录）',
      rpe: isPeakOrPreComp ? '8/10' : '7/10',
      warmup: `${steps[0].distanceKm}km 轻松跑 + 动态热身`,
      cooldown: '1.0km 轻松冷身与拉伸',
      carbFactor: 0.95,
      tip: '严格按当前能力配速执行，不盲套 2:01 竞赛配速；后程掉速 >3% 或动作变形立即止损。'
    };
  }

  if (dow === 3 || dow === 6) {
    const ratio = isRegress ? 0.15 : isHoldOrRegress ? 0.175 : 0.21;
    const distKm = currentStage === 'Taper' ? 3.5 : Math.min(6.8, Math.max(3.6, round1(recent4wAvgKm * ratio)));
    const steps = [
      { kind: 'steady', distanceKm: distKm, pace: `${formatPace(paces.easyPaceSec)}/km`, targetHr: easyHrLabel, description: '有氧轻松恢复跑' },
      ...(dow === 6 && currentStage !== 'Taper' && !isRegress
        ? [{ kind: 'strides', reps: 4, distanceMeters: 60, restSec: 90, restType: 'walk', description: 'SPD-STRIDES 60m 神经步幅激活' }]
        : [])
    ];
    const compiled = compileStepsToMetrics(steps, paces.easyPaceSec);
    return {
      type: 'E',
      title: dow === 6 && currentStage !== 'Taper' && !isRegress
        ? `轻松有氧 + 4×60m 神经步幅唤醒 (${compiled.plannedDistanceKm}km)`
        : `轻松有氧恢复跑 (${compiled.plannedDistanceKm}km)`,
      steps,
      ...compiled,
      estimatedTss: Math.round(compiled.plannedDurationMin * 0.8),
      baseSec: paces.easyPaceSec,
      hrRange: easyHrLabel,
      cadence: '自然舒适步频（观察记录）',
      rpe: '4/10',
      warmup: '前 800m 缓步启动',
      cooldown: '慢走 3 分钟与温和拉伸',
      carbFactor: 0.7,
      tip: '参考暂定心率上限与对话呼吸感控制轻松跑，配速允许随恢复自然改善。'
    };
  }

  if (dow === 4) {
    // 维持期 / 回退期每周保留至多 1 堂高质跑课（周二），周四转入有氧步幅唤醒；仅 verified 单变量进阶期保留第 2 堂质量速度课
    if (isHoldOrRegress) {
      const easyKm = currentStage === 'Taper' ? 3.0 : Math.min(5.0, Math.max(3.5, round1(recent4wAvgKm * (isRegress ? 0.14 : 0.165))));
      const steps = [
        { kind: 'warmup', durationMin: 5, distanceKm: 0.5, description: '慢跑激活热身' },
        { kind: 'steady', distanceKm: easyKm, pace: `${formatPace(paces.easyPaceSec)}/km`, targetHr: easyHrLabel, description: '维持期轻松有氧巩固' },
        ...(!isRegress ? [{ kind: 'strides', reps: 4, distanceMeters: 60, restSec: 90, restType: 'walk', description: 'SPD-STRIDES 60m 轻松步幅激活' }] : []),
        { kind: 'cooldown', durationMin: 4, distanceKm: 0.4, description: '慢走冷身' }
      ];
      const compiled = compileStepsToMetrics(steps, paces.easyPaceSec);
      return {
        type: 'E',
        title: isRegress
          ? `回退观察轻松跑 (${compiled.plannedDistanceKm}km)`
          : `维持期有氧 + 4×60m 神经步幅唤醒 (${compiled.plannedDistanceKm}km)`,
        steps,
        ...compiled,
        estimatedTss: Math.round(compiled.plannedDurationMin * 0.8),
        baseSec: paces.easyPaceSec,
        hrRange: easyHrLabel,
        cadence: '自然舒适步频（观察记录）',
        rpe: '4/10',
        warmup: '0.5km 慢跑 + 关节激活',
        cooldown: '慢走 4 分钟与拉伸',
        carbFactor: 0.7,
        tip: '周复盘维持负荷（仅保持单堂核心课），避免同时叠加第二堂速度间歇。'
      };
    }

    // 周四：速度/短间歇课（与周二间隔 48h），PreComp/Peak 用 RP-RHYTHM / VO2-SHORT，Build 用短距离经济性激活
    const isRacePrep = currentStage === 'Peak' || currentStage === 'PreComp';
    const steps = currentStage === 'PreComp'
      ? [
          { kind: 'warmup', durationMin: 12, distanceKm: 2.0, description: '慢跑 + 动态激活' },
          { kind: 'interval', reps: 6, distanceMeters: 200, pace: `${formatPace(paces.repPaceSec)}/km`, restSec: 120, restType: 'walk', description: 'RP-RHYTHM 200m 比赛节奏习惯化（按当前实际能力节奏）' },
          { kind: 'cooldown', durationMin: 8, distanceKm: 1.0, description: '慢跑冷身' }
        ]
      : isRacePrep
        ? [
            { kind: 'warmup', durationMin: 12, distanceKm: 2.0, description: '慢跑 + 轻激活' },
            { kind: 'interval', reps: 8, distanceMeters: 200, pace: `${formatPace(paces.intervalPaceSec)}/km`, restSec: 60, restType: 'jog', description: 'VO2-SHORT 200m 短间歇（保质不力竭）' },
            { kind: 'cooldown', durationMin: 8, distanceKm: 1.0, description: '慢跑冷身' }
          ]
        : [
            { kind: 'warmup', durationMin: 10, distanceKm: 1.5, description: '慢跑 + 髋踝弹性激活' },
            { kind: 'interval', reps: 6, distanceMeters: 150, pace: `${formatPace(paces.repPaceSec)}/km`, restSec: 120, restType: 'walk', description: '800m 神经流畅加速（可控轻快，不憋气）' },
            { kind: 'cooldown', durationMin: 8, distanceKm: 1.0, description: '冷身慢跑' }
          ];
    const compiled = compileStepsToMetrics(steps, paces.repPaceSec);
    return {
      type: currentStage === 'Peak' ? 'I' : 'R',
      title: currentStage === 'PreComp'
        ? 'RP-RHYTHM 6×200m 节奏习惯化'
        : isRacePrep
          ? 'VO2-SHORT 8×200m 有氧功率刺激'
          : '800m 神经经济性短间歇 (6×150m)',
      steps,
      ...compiled,
      estimatedTss: isRacePrep ? 50 : 42,
      baseSec: currentStage === 'Peak' ? paces.intervalPaceSec : paces.repPaceSec,
      hrRange: '短分段存在心率滞后，按秒表配速与完全走休控制',
      cadence: '自然舒适高步频（观察记录）',
      rpe: isRacePrep ? '7.5/10' : '6.5/10',
      warmup: '1.5–2km 轻松跑 + 动态激活',
      cooldown: '1.0km 放松慢跑与下肢拉伸',
      carbFactor: 0.85,
      tip: '关注放松跑姿，连续 2 组掉速 >3% 或动作变形立刻结束主课。'
    };
  }

  if (dow === 5) {
    const steps = [{ kind: 'cross', durationMin: 40, description: '低冲击单车 + 精简主力量（深蹲/RDL/提踵 留 RIR 2-3）' }];
    const compiled = compileStepsToMetrics(steps, paces.easyPaceSec);
    return {
      type: 'STR',
      title: '精简下肢力量维护 & 低冲击交叉恢复日',
      steps,
      ...compiled,
      estimatedTss: 26,
      baseSec: paces.easyPaceSec,
      hrRange: `<= ${easyCeiling - 4} bpm (Z1-Z2)`,
      cadence: '--',
      rpe: '4.5/10',
      warmup: '5分钟单车与动态激活',
      cooldown: '全身柔韧放松',
      carbFactor: 0.6,
      tip: '记录重量、组数与 RIR；次日反应正常才考虑微调，力量增重不直接等同 800m 提速。'
    };
  }

  // 周日：800m 专项有氧支撑长距离（维持期按近期均值保守缩放，不盲上 20km）
  const sundayRatio = isRegress ? 0.20 : isHoldOrRegress ? 0.24 : 0.30;
  const sundayKm = currentStage === 'Taper' ? 4.5 : Math.min(10.0, Math.max(5.5, round1(recent4wAvgKm * sundayRatio)));
  const steps = [
    { kind: 'warmup', durationMin: 8, distanceKm: 1.0, description: '前 1km 慢过渡' },
    { kind: 'steady', distanceKm: sundayKm, pace: `${formatPace(paces.easyPaceSec)}/km`, targetHr: easyHrLabel, description: '800m 有氧底座续航跑' },
    { kind: 'cooldown', durationMin: 5, distanceKm: 0.5, description: '慢走冷身' }
  ];
  const compiled = compileStepsToMetrics(steps, paces.easyPaceSec);
  return {
    type: 'LSD',
    title: `800m 有氧支撑续航跑 (${compiled.plannedDistanceKm}km)`,
    steps,
    ...compiled,
    estimatedTss: Math.round(compiled.plannedDurationMin * 0.9),
    baseSec: paces.easyPaceSec,
    hrRange: easyHrLabel,
    cadence: '自然舒适步频（观察记录）',
    rpe: '5/10',
    warmup: '1km 慢跑启动',
    cooldown: '慢走 5 分钟与全面拉伸',
    carbFactor: 0.9,
    tip: '守住个人暂定心率上限与可对话呼吸感，不滑入无目的中速疲劳区。'
  };
}

function makeRestDay(title, detail) {
  return {
    type: 'REST',
    title,
    steps: [{ kind: 'rest', durationMin: 20, description: detail }],
    distanceKm: 0,
    plannedDistanceKm: 0,
    durationMin: 20,
    plannedDurationMin: 20,
    tss: 8,
    estimatedTss: 8,
    baseSec: 380,
    hrRange: '静息恢复',
    cadence: '--',
    rpe: '1-2/10',
    warmup: '轻度关节活动',
    mainSetSummary: detail,
    mainSetDetail: detail,
    cooldown: '保证充足睡眠与补水',
    carbFactor: 0.4,
    tip: '恢复也是训练刺激转化为能力的关键环节。'
  };
}

/**
 * 定制课表和 800m 备用课表共用的最终校验与修复网关
 */
export function validateAndFinalizePlan(rawDays, context) {
  const {
    todayStr,
    readiness,
    checkinSignals,
    envForecast = {},
    stageInfo,
    config = {},
    wellness = {}
  } = context;

  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const lthr = wellness?.lthrFromDevice || config.physiology?.lthr || 183;
  const easyPaceSec = stageInfo?.paces?.easyPaceSec || 360;
  const weightKg = wellness?.weightKg || config.physiology?.weightKg || 67;
  const forecastDays = Array.isArray(envForecast?.daily) ? envForecast.daily : [];
  const progRec = checkinSignals?.weeklyReview?.progressionRecommendation || 'hold';
  const is800mPlan = !config.goal?.eventName || /800/i.test(String(config.goal.eventName));
  const policy = getStagePolicy(stageInfo, progRec);
  const repairs = [];
  const inputErrors = [];

  const finalized = [];
  for (let i = 0; i < 7; i++) {
    const env = forecastDays[i] || null;
    const expectedDate = env?.date || getLocalIsoDate(i, config.timezone || 'Asia/Shanghai', new Date(`${todayStr}T12:00:00Z`));
    const dow = getWeekdayIndexFromIso(expectedDate);
    const adj = computeEnvironmentalAdjustment(env);
    const scale = 1 + (adj.slowdownPct || 0) / 100;

    const src = Array.isArray(rawDays) ? (rawDays.find((d) => d?.date === expectedDate) || rawDays[i] || null) : null;
    let day = src
      ? { ...src }
      : build800mFallbackDay({ dow, stageInfo, lthr, progressionRecommendation: progRec });

    // 1) 日期、星期、类型规范化
    if (day.date !== expectedDate) {
      if (src?.date) repairs.push(`Day ${i}: 修正日期 ${src.date} -> ${expectedDate}`);
      day.date = expectedDate;
    }
    day.weekday = weekdayNames[dow];

    const rawType = String(day.type || 'E').toUpperCase();
    day.type = VALID_WORKOUT_TYPES.has(rawType) ? rawType : 'E';
    if (!VALID_WORKOUT_TYPES.has(rawType)) {
      repairs.push(`${expectedDate}: 非法课程类型 ${rawType} 已修正为 E`);
    }

    // 2) 结构化 steps 合法性前置校验（杜绝负距离/非法步数渗透）
    if (Array.isArray(day.steps) && day.steps.length > 0) {
      const stepsCheck = validateStepsSchema(day.steps);
      if (!stepsCheck.valid) {
        const msg = `${expectedDate}: 结构化步骤非法 (${stepsCheck.errors.join('；')})，已拦截并替换为同阶段安全课表`;
        inputErrors.push(msg);
        repairs.push(msg);
        day = {
          date: expectedDate,
          weekday: weekdayNames[dow],
          ...build800mFallbackDay({ dow, stageInfo, lthr, progressionRecommendation: progRec })
        };
      }
    }

    // 3) 非法负数 / 缺失字段检查与补全
    const rawDist = day.plannedDistanceKm ?? day.distanceKm;
    if (rawDist !== undefined && rawDist !== null && (!Number.isFinite(Number(rawDist)) || Number(rawDist) < 0)) {
      const msg = `${expectedDate}: 非法距离 plannedDistanceKm=${rawDist}，已拦截修正`;
      inputErrors.push(msg);
      repairs.push(msg);
    }
    const rawDur = day.plannedDurationMin ?? day.durationMin;
    if (rawDur !== undefined && rawDur !== null && (!Number.isFinite(Number(rawDur)) || Number(rawDur) < 0)) {
      const msg = `${expectedDate}: 非法时长 plannedDurationMin=${rawDur}，已拦截修正`;
      inputErrors.push(msg);
      repairs.push(msg);
    }

    day.plannedDistanceKm = Number.isFinite(Number(rawDist))
      ? Math.max(0, round1(Number(rawDist)))
      : 0;
    day.plannedDurationMin = Number.isFinite(Number(rawDur))
      ? Math.max(0, Math.round(Number(rawDur)))
      : (day.type === 'REST' ? 20 : 30);
    day.estimatedTss = Number.isFinite(Number(day.estimatedTss ?? day.tss))
      ? Math.max(0, Math.round(Number(day.estimatedTss ?? day.tss)))
      : (day.type === 'REST' ? 8 : 25);

    day.title = String(day.title || `${day.weekday} 训练课`).trim();
    day.warmup = String(day.warmup || (day.type === 'REST' ? '轻度关节活动' : '5-10分钟慢跑与动态热身')).trim();
    day.mainSetSummary = String(day.mainSetSummary || '').trim();
    day.mainSetDetail = String(day.mainSetDetail || '').trim();
    day.cooldown = String(day.cooldown || '慢走与常规拉伸放松').trim();
    day.targetHr = String(day.targetHr || day.hrRange || (day.type === 'REST' ? '静息恢复' : `<= ${resolveEasyHrCeiling(config, lthr)} bpm`)).trim();
    day.targetCadence = String(day.targetCadence || day.cadence || '--').trim();
    day.rpe = String(day.rpe || '4/10').trim();

    // 4) 以已校验 steps 作为单一事实来源，强制同步距离、时长、主课摘要、详单与配速
    if (Array.isArray(day.steps) && day.steps.length > 0 && day.type !== 'REST') {
      const compiled = compileStepsToMetrics(day.steps, easyPaceSec);
      if (compiled) {
        const distDiff = Math.abs(day.plannedDistanceKm - compiled.plannedDistanceKm) > 0.2;
        const durDiff = Math.abs(day.plannedDurationMin - compiled.plannedDurationMin) > 3;
        const incomingSpec = `${day.mainSetSummary} ${day.mainSetDetail}`.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(?:m|米|km|公里)/i);
        const compiledSpec = compiled.mainSetSummary.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(?:m|米|km|公里)/i);
        const specMismatch =
          (incomingSpec && (!compiledSpec || incomingSpec[1] !== compiledSpec[1] || incomingSpec[2] !== compiledSpec[2])) ||
          (day.mainSetSummary && day.mainSetSummary !== compiled.mainSetSummary);

        if (distDiff || durDiff || specMismatch) {
          repairs.push(`${expectedDate}: 摘要/详单/距离与已校验 steps 不一致，已按 steps 统一重构`);
        }
        day.plannedDistanceKm = compiled.plannedDistanceKm;
        day.plannedDurationMin = compiled.plannedDurationMin;
        day.mainSetSummary = compiled.mainSetSummary;
        day.mainSetDetail = compiled.mainSetDetail;
        if (compiled.primaryPaceSec) {
          day.basePace = `${formatPace(compiled.primaryPaceSec)}/km`;
        }
      }
    } else {
      day.mainSetSummary = day.mainSetSummary || day.title;
      day.mainSetDetail = day.mainSetDetail || day.mainSetSummary;
    }

    // 5) 今日（i === 0）按实际负荷（而非仅 type 标签）强制执行休息、疼痛保护与准备度门控
    const todayLoad = classifyWorkoutLoad(day);
    if (i === 0) {
      if (
        checkinSignals?.forceRestToday &&
        (day.type !== 'REST' || todayLoad.hasRunningLoad || todayLoad.isHeavyLowerStrength || todayLoad.hasNonRestStep)
      ) {
        repairs.push(`${expectedDate}: 落实今日主动请假休息，覆盖原定 ${day.type} 课表`);
        day = {
          ...day,
          type: 'REST',
          steps: [{ kind: 'rest', durationMin: 15, description: '主动请假纯休息恢复' }],
          title: `🛌 主动请假休息 · 已取消原定「${day.title}」`,
          plannedDistanceKm: 0,
          plannedDurationMin: 15,
          estimatedTss: 5,
          basePace: '--',
          correctedPace: '--',
          targetHr: '静息恢复',
          targetCadence: '--',
          rpe: '1/10',
          warmup: '温和日常活动即可',
          mainSetSummary: '今日已按打卡设为休息日，暂停跑步与负荷训练；后续周期课表维持原排期（暂未自动顺延）。',
          mainSetDetail: '今日完全休息恢复，补充水分与睡眠。说明：本系统仅取消今日负荷，未自动后移未来日期课表。',
          cooldown: '早睡保证恢复睡眠',
          coachTip: `已响应今日打卡状态：${checkinSignals.todayCheckin?.diary ? '已记录今日反馈' : '主动请假休息'}`
        };
      } else if (
        checkinSignals?.painAlert &&
        (todayLoad.hasRunningLoad ||
          todayLoad.isHeavyLowerStrength ||
          todayLoad.isAnyLowerStrengthOrImpact ||
          todayLoad.hasNonRestStep ||
          day.type !== 'REST')
      ) {
        // 疼痛保护依据实际步骤/文本/跑量生效，不可被 REST/STR 等标签绕过，也不擅自诊断 ITBS 或强制开静蹲
        const areaText = checkinSignals.persistentInjuries?.length > 0
          ? checkinSignals.persistentInjuries.map((inj) => `${inj.area}(${inj.painLevel}/10)`).join('、')
          : (checkinSignals.todayCheckin?.painAreas || ['不适部位']).join('、');
        repairs.push(`${expectedDate}: 落实疼痛/动作受限保护（${areaText}），拦截 ${day.type}（含跑跳/下肢/隐藏步骤负荷）`);
        day = {
          ...day,
          type: 'REST',
          steps: [{ kind: 'rest', durationMin: 20, description: `疼痛保护恢复（${areaText}）` }],
          title: `🛡️ 疼痛保护 · 已改为纯休息恢复日`,
          plannedDistanceKm: 0,
          plannedDurationMin: 20,
          estimatedTss: 8,
          basePace: '--',
          correctedPace: '--',
          targetHr: '静息恢复',
          targetCadence: '--',
          rpe: '1-2/10',
          warmup: '仅做无痛范围内的日常温和活动',
          mainSetSummary: `存在动作受限或中重度疼痛反馈（${areaText}），今日转为纯休息日（不含训练负荷）；持续 >48–72h 建议专业评估。`,
          mainSetDetail: `安全原则：禁止带痛硬练或自行套用单一恢复动作。今日为纯休息与睡眠恢复；仅在明确无痛且标记恢复后再重启训练。`,
          cooldown: '充分休息，避免按压或强拉痛点',
          coachTip: `疼痛限制不可绕过：${checkinSignals.triggers.join('；')}`
        };
      } else if (
        readiness?.light === 'red' &&
        (todayLoad.hasRunningLoad ||
          todayLoad.isHeavyLowerStrength ||
          todayLoad.isAnyLowerStrengthOrImpact ||
          todayLoad.hasNonRestStep ||
          day.type !== 'REST')
      ) {
        repairs.push(`${expectedDate}: 红灯准备度强制熔断 ${day.type} 课表`);
        day = {
          ...day,
          type: 'REST',
          steps: [{ kind: 'rest', durationMin: 20, description: '生理红灯主动恢复' }],
          title: `🔴 红灯熔断 · 已改为纯休息恢复日`,
          plannedDistanceKm: 0,
          plannedDurationMin: 20,
          estimatedTss: 8,
          basePace: '--',
          correctedPace: '--',
          targetHr: '静息恢复',
          targetCadence: '--',
          rpe: '1-2/10',
          warmup: '轻度活动或温水浴',
          mainSetSummary: `今日生理准备度触发红灯，转为纯休息恢复（不含训练负荷）。`,
          mainSetDetail: `触发依据：${(readiness.triggers || []).join('；')}。建议今晚提前入睡并补水。`,
          cooldown: '提前入睡保证连续睡眠',
          coachTip: `触发红灯：${(readiness.triggers || []).join('；')}`
        };
      } else if (readiness?.light === 'insufficient_data' && (todayLoad.isHardTrack || todayLoad.isHeavyLowerStrength)) {
        repairs.push(`${expectedDate}: 关键生理数据不足，将高强度 ${day.type} 真正替换为低强度轻松跑`);
        const easyCeiling = Math.round(lthr * 0.80);
        const conservativePace = `${formatPace(easyPaceSec + 15)}/km`;
        const conservativeSteps = [
          { kind: 'warmup', distanceKm: 0.6, durationMin: 4, description: '轻松慢启动热身' },
          { kind: 'steady', distanceKm: 3.0, pace: conservativePace, targetHr: `<= ${easyCeiling} bpm`, description: '数据不足保守轻松有氧（全程可完整对话）' },
          { kind: 'cooldown', distanceKm: 0.4, durationMin: 3, description: '慢走冷身与拉伸' }
        ];
        const compiledEasy = compileStepsToMetrics(conservativeSteps, easyPaceSec + 15);
        day = {
          ...day,
          type: 'E',
          steps: conservativeSteps,
          title: `⚪ 数据不足保守降级 · 轻松有氧跑 (${compiledEasy.plannedDistanceKm}km)`,
          plannedDistanceKm: compiledEasy.plannedDistanceKm,
          plannedDurationMin: compiledEasy.plannedDurationMin,
          estimatedTss: 20,
          basePace: conservativePace,
          targetHr: `<= ${easyCeiling} bpm (Z1-Z2 保守上限)`,
          targetCadence: '172-178 spm',
          rpe: '3.5/10',
          warmup: '0.6km 慢跑过渡 + 动态关节激活',
          mainSetSummary: compiledEasy.mainSetSummary,
          mainSetDetail: `${compiledEasy.mainSetDetail}；原因：关键生理数据不足或过期，已取消原高强度刺激改为纯轻松跑。`,
          cooldown: '慢走 3 分钟与温和拉伸',
          coachTip: '在恢复数据恢复完整前，以轻松说话跑为主，不跑高强度间歇或重深蹲。'
        };
      } else if (
        (readiness?.light === 'yellow' || checkinSignals?.highRpeLoad || checkinSignals?.moderatePain || checkinSignals?.recentDropoffAlert) &&
        (todayLoad.isHardTrack || todayLoad.isHeavyLowerStrength || day.type === 'LSD' || (day.type === 'E' && day.plannedDistanceKm > 4.5))
      ) {
        const alreadyReduced = Boolean(day.reductionMeta?.applied);
        if (!alreadyReduced) {
          const reason = [
            ...(readiness?.light === 'yellow' ? readiness.triggers || [] : []),
            ...(checkinSignals?.triggers || [])
          ].filter(Boolean).join('；');
          day = reduceWorkoutConsistent(day, {
            factor: 0.75,
            reason,
            easyPaceSec,
            lthr
          });
          repairs.push(`${expectedDate}: 已按黄灯/疲劳信号同步缩减结构化步骤、距离与时长`);
        }
      }
    }

    // 5b) 全周 7 天阶段边界、能力测试门控与回退期禁强约束（杜绝 AI 返回 PreComp / 10×800m @ 3:00/km 等越级课表）
    const enforceStageRules = is800mPlan || !day.isCustomPlan;
    if (enforceStageRules && day.type !== 'REST') {
      const stageCheck = evaluateDayStageCompliance(day, policy, stageInfo);
      if (!stageCheck.compliant) {
        const msg = `${expectedDate}: 越过阶段(${policy.currentStage})/测试门控/负荷边界 (${stageCheck.violations.join('；')})，已拦截并替换为 ${policy.currentStage} 合规课表`;
        inputErrors.push(msg);
        repairs.push(msg);
        day = {
          date: expectedDate,
          weekday: weekdayNames[dow],
          isCustomPlan: false,
          ...build800mFallbackDay({ dow, stageInfo, lthr, config, progressionRecommendation: progRec })
        };
        if (day.baseSec && !day.basePace) {
          day.basePace = `${formatPace(day.baseSec)}/km`;
        }
        day.targetHr = day.targetHr || day.hrRange || `<= ${resolveEasyHrCeiling(config, lthr)} bpm`;
        day.targetCadence = day.targetCadence || day.cadence || '--';
        day.coachTip = `${day.tip || day.coachTip || ''}（已拦截越级或未标定测试配速的课表）`.trim();
      }
    }

    // 6) 连续高负荷下肢刺激冲突检查（覆盖间歇 T/I/R 与重深蹲/下肢重力量/跳跃，防止 间歇->重深蹲->间歇 连轴转）
    const curLoad = classifyWorkoutLoad(day);
    if (i > 0) {
      const prevLoad = classifyWorkoutLoad(finalized[i - 1]);
      if (prevLoad.isHighStressLowerDay && curLoad.isHighStressLowerDay) {
        repairs.push(`${expectedDate}: 检测到与前一日(${finalized[i - 1].date} ${finalized[i - 1].type})连续高强度跑/重下肢力量冲突，已降级为恢复日`);
        if (curLoad.isHeavyLowerStrength && !curLoad.hasRunningLoad) {
          day = {
            ...day,
            type: 'REST',
            steps: [{ kind: 'rest', durationMin: 25, description: '避开连续下肢大负荷，改为休息或轻度上肢活动' }],
            title: `🛡️ 冲突修复 · 下肢修复休息日（避开紧邻高强度跑后重力量）`,
            plannedDistanceKm: 0,
            plannedDurationMin: 25,
            estimatedTss: 8,
            basePace: '--',
            correctedPace: '--',
            targetHr: '静息恢复',
            targetCadence: '--',
            rpe: '2/10',
            mainSetSummary: '前一日安排有高强度/重下肢负荷，今日改为纯恢复日（不含下肢负荷）。',
            mainSetDetail: '1) 休息：25min 轻度拉伸与泡沫轴放松（已暂停原定力量安排，为下一课预留 48h 恢复窗口）。'
          };
        } else {
          const easyCeiling = Math.round(lthr * 0.80);
          const recSteps = [
            { kind: 'steady', distanceKm: 3.5, durationMin: 22, pace: `${formatPace(easyPaceSec + 15)}/km`, targetHr: `<= ${easyCeiling} bpm`, description: '冲突拦截后的轻松恢复跑' }
          ];
          const compiledRec = compileStepsToMetrics(recSteps, easyPaceSec + 15);
          day = {
            ...day,
            type: 'E',
            steps: recSteps,
            title: `🛡️ 冲突修复 · 恢复轻松跑（避开连续高强度跑/重力量）`,
            plannedDistanceKm: compiledRec.plannedDistanceKm,
            plannedDurationMin: compiledRec.plannedDurationMin,
            estimatedTss: 20,
            basePace: `${formatPace(easyPaceSec + 15)}/km`,
            targetHr: `<= ${easyCeiling} bpm (Z1-Z2)`,
            targetCadence: '172-178 spm',
            rpe: '3.5/10',
            mainSetSummary: compiledRec.mainSetSummary,
            mainSetDetail: `${compiledRec.mainSetDetail}；因前一日存在负荷刺激，已自动调降为有氧轻松跑以留出 48h 恢复窗口。`
          };
        }
      }
    }

    // 6) REST 纯净度与非跑日字段一致性收尾 + 配速环境修正 + 营养
    if (day.type === 'REST') {
      const restLoad = classifyWorkoutLoad(day);
      if (
        restLoad.hasNonRestStep ||
        restLoad.hasRunningLoad ||
        restLoad.isHeavyLowerStrength ||
        restLoad.isAnyLowerStrengthOrImpact ||
        day.plannedDistanceKm > 0
      ) {
        repairs.push(`${expectedDate}: REST 休息日检测到隐藏训练负荷或非休息步骤，已清零并替换为空载纯休息`);
        const safeDur = Math.max(15, Math.min(30, Number(day.plannedDurationMin || 20)));
        day.steps = [{ kind: 'rest', durationMin: safeDur, description: '纯休息恢复，不含跑步或力量负荷' }];
        day.title = `🛌 纯休息恢复日（已清除隐藏负荷）`;
        day.plannedDistanceKm = 0;
        day.plannedDurationMin = safeDur;
        day.estimatedTss = 5;
        day.mainSetSummary = '今日已清除异常步骤并强制设为纯休息恢复（不含任何训练负荷）。';
        day.mainSetDetail = '纯休息与睡眠恢复，专注组织修复，不包含训练负荷。';
      } else if (!Array.isArray(day.steps) || day.steps.length === 0) {
        day.steps = [{ kind: 'rest', durationMin: Math.max(0, Number(day.plannedDurationMin || 20)), description: '纯休息恢复' }];
      }
      day.plannedDistanceKm = 0;
      day.basePace = '--';
      day.correctedPace = '--';
      day.targetHr = '静息恢复';
    } else if (day.plannedDistanceKm <= 0 && !parsePaceSecPerKm(day.basePace)) {
      day.basePace = '--';
      day.correctedPace = '--';
    } else {
      const baseSec = parsePaceSecPerKm(day.basePace) || day.baseSec || easyPaceSec;
      day.basePace = `${formatPace(baseSec)}/km`;
      day.correctedPace = `${formatPace(Math.round(baseSec * scale))}/km`;
    }

    if (!adj.weatherUnavailable && adj.indoorRecommended && day.type !== 'REST' && day.type !== 'STR' && !String(day.mainSetDetail).includes('天气熔断替代')) {
      day.mainSetDetail = `${day.mainSetDetail} 【天气提示】当前空气/天气条件较差，建议优先改在室内跑步机或无冲击室内设备执行。`;
    }

    const hasRealEnv = Boolean(env && !env.weatherUnavailable && typeof env.tempC === 'number');
    day.envAdjustmentNote =
      day.envAdjustmentNote ||
      (hasRealEnv
        ? `${env.weatherText} ${env.tempC}°C · 湿度${env.humidityPct ?? '--'}% · 露点${env.dewPointC ?? '--'}°C · 风${env.windMs ?? '--'}m/s · 海拔${env.elevationMeters ?? '--'}m → ${adj.summary}`
        : `气象数据暂不可用${env?.elevationMeters != null ? `（海拔 ${env.elevationMeters}m）` : ''} → ${adj.summary}`);

    if (!day.nutrition) {
      const carbG = Math.round(weightKg * (day.plannedDistanceKm > 0 ? 0.8 : 0.45));
      const proteinG = Math.round(weightKg * 0.3);
      day.nutrition =
        day.plannedDistanceKm > 0
          ? `跑后 30 分钟内补充碳水 ${carbG}g + 优质蛋白 ${proteinG}g，补水 ${Math.round(day.plannedDurationMin * 8)}ml`
          : '全天均衡蛋白摄入与充分补水（≥ 2000ml）';
    }

    day.coachTip = String(day.coachTip || '按步骤与体感稳步执行，关注次日晨间恢复反应。').trim();

    // 删除临时内部字段（保留 steps 与 reductionMeta 供展示和 Garmin 同步）
    delete day.distanceKm;
    delete day.durationMin;
    delete day.tss;
    delete day.baseSec;
    delete day.hrRange;
    delete day.cadence;
    delete day.carbFactor;

    finalized.push(day);
  }

  // 6b) 7 日周负荷与单变量进阶强制约束（按实际步骤/负荷统计高强课，维持期 hold 不增周跑量/不加第二堂高强；单变量进阶期禁止里程与强度双跳）
  const isQualityLoadDay = (d) =>
    Boolean(d) && d.type !== 'REST' && classifyWorkoutLoad(d).isHardTrack;

  const governedIndices = finalized
    .map((d, idx) => ({ d, idx }))
    .filter(({ d }) => is800mPlan || !d.isCustomPlan)
    .map(({ idx }) => idx);

  const hardIndices = governedIndices.filter((idx) => isQualityLoadDay(finalized[idx]));
  if (hardIndices.length > policy.maxHardPerWeek) {
    // 保留排在最前面的合规高质课，降级其余超额高强课（含伪装为 E/LSD 的间歇步骤）
    const toDowngrade = hardIndices.slice(policy.maxHardPerWeek);
    for (const idx of toDowngrade) {
      const oldDay = finalized[idx];
      const env = forecastDays[idx] || null;
      const adj = computeEnvironmentalAdjustment(env);
      const scale = 1 + (adj.slowdownPct || 0) / 100;
      const reason =
        progRec === 'regress'
          ? '周复盘要求回退观察，取消高强间歇改为轻松有氧'
          : `周复盘当前为「${progRec === 'hold' ? '维持期(hold)' : progRec}」，按实际步骤统计高强课上限 ${policy.maxHardPerWeek} 堂，超额高强课 (${oldDay.type}) 已降为轻松有氧`;
      const nextDay = makeDowngradedEasyDay(oldDay, { reason, easyPaceSec, lthr, targetKm: 3.8 });
      const baseSec = parsePaceSecPerKm(nextDay.basePace) || easyPaceSec;
      nextDay.basePace = `${formatPace(baseSec)}/km`;
      nextDay.correctedPace = `${formatPace(Math.round(baseSec * scale))}/km`;
      finalized[idx] = nextDay;
      inputErrors.push(`${oldDay.date}: ${reason}`);
      repairs.push(`${oldDay.date}: ${reason}`);
    }
  }

  const governedHardCount = governedIndices.filter((idx) => isQualityLoadDay(finalized[idx])).length;
  const rawAvg = Number(stageInfo?.recent4wAvgKm || 0);
  let weeklyCapKm;
  if (rawAvg > 0) {
    if (progRec === 'regress') {
      weeklyCapKm = Math.max(8.0, round1(rawAvg * 0.80));
    } else if (progRec === 'hold') {
      weeklyCapKm = rawAvg >= 12 ? round1(rawAvg * 1.04) : policy.stageFloorKm;
    } else {
      // eligible_single_variable：若已上调至 2 堂质量课，则周跑量锁在维持带内（单变量）；否则允许 +12% 温和增量
      weeklyCapKm =
        governedHardCount >= 2
          ? (rawAvg >= 12 ? round1(rawAvg * 1.05) : policy.stageFloorKm)
          : (rawAvg >= 12 ? round1(rawAvg * 1.12) : round1(policy.stageFloorKm * 1.12));
    }
  } else {
    weeklyCapKm =
      progRec === 'regress'
        ? round1(policy.stageFloorKm * 0.80)
        : progRec === 'eligible_single_variable'
          ? round1(policy.stageFloorKm * 1.12)
          : policy.stageFloorKm;
  }

  let governedWeeklyKm = round1(
    governedIndices.reduce((sum, idx) => sum + Number(finalized[idx].plannedDistanceKm || 0), 0)
  );
  if (governedWeeklyKm > weeklyCapKm + 0.05) {
    const beforeKm = governedWeeklyKm;
    const candidateOrder = [...governedIndices]
      .filter((idx) => finalized[idx].type !== 'REST' && Number(finalized[idx].plannedDistanceKm || 0) > 2.2)
      .sort((a, b) => {
        const score = (i) => {
          const d = finalized[i];
          return (i === 0 ? 1000 : 0) + (isQualityLoadDay(d) ? 100 : 0) - Number(d.plannedDistanceKm || 0);
        };
        return score(a) - score(b);
      });

    for (let pass = 0; pass < 2 && governedWeeklyKm > weeklyCapKm + 0.05; pass++) {
      for (const idx of candidateOrder) {
        if (governedWeeklyKm <= weeklyCapKm + 0.05) break;
        const needed = round1(governedWeeklyKm - weeklyCapKm);
        const trimRes = trimDayDistanceConsistent(finalized[idx], needed, {
          easyPaceSec,
          lthr,
          reason: `周总跑量不得突破 ${progRec} 上限 (${weeklyCapKm}km)`
        });
        if (trimRes.changed) {
          const env = forecastDays[idx] || null;
          const adj = computeEnvironmentalAdjustment(env);
          const scale = 1 + (adj.slowdownPct || 0) / 100;
          const baseSec = parsePaceSecPerKm(trimRes.day.basePace) || easyPaceSec;
          if (trimRes.day.plannedDistanceKm > 0) {
            trimRes.day.basePace = `${formatPace(baseSec)}/km`;
            trimRes.day.correctedPace = `${formatPace(Math.round(baseSec * scale))}/km`;
          }
          finalized[idx] = trimRes.day;
          governedWeeklyKm = round1(
            governedIndices.reduce((sum, j) => sum + Number(finalized[j].plannedDistanceKm || 0), 0)
          );
        }
      }
    }

    // Pass 3：若日均距离本就偏短（如每日 2km × 7 = 14km > 11.2km），将多余跑步日转为纯休息日 (0km) 以满足周上限与跑休间隔
    if (governedWeeklyKm > weeklyCapKm + 0.05) {
      const restOrder = [...governedIndices]
        .filter((idx) => finalized[idx].type !== 'REST' && Number(finalized[idx].plannedDistanceKm || 0) > 0)
        .sort((a, b) => {
          const rank = (i) => (i === 0 ? 1000 : (i % 2 === 1 ? 0 : 100) + i);
          return rank(a) - rank(b);
        });
      for (const idx of restOrder) {
        if (governedWeeklyKm <= weeklyCapKm + 0.05) break;
        const oldDay = finalized[idx];
        finalized[idx] = {
          ...oldDay,
          type: 'REST',
          steps: [{ kind: 'rest', durationMin: 20, description: `周跑量上限 (${weeklyCapKm}km) 触发主动休息恢复` }],
          title: `🛌 负荷控制 · 主动休息恢复日（控制周总跑量 <= ${weeklyCapKm}km）`,
          plannedDistanceKm: 0,
          plannedDurationMin: 20,
          estimatedTss: 6,
          basePace: '--',
          correctedPace: '--',
          targetHr: '静息恢复',
          targetCadence: '--',
          rpe: '1-2/10',
          warmup: '温和日常活动',
          mainSetSummary: `为落实 ${progRec} 周跑量上限（<= ${weeklyCapKm}km），今日转为纯休息恢复日（0 km）。`,
          mainSetDetail: `1) 休息：20min 主动恢复与睡眠补水；确保本周总跑量不超过 ${weeklyCapKm}km。`,
          cooldown: '早睡保证恢复',
          coachTip: `已将该日转为休息日以控制周总跑量不超过 ${weeklyCapKm}km。`
        };
        governedWeeklyKm = round1(
          governedIndices.reduce((sum, j) => sum + Number(finalized[j].plannedDistanceKm || 0), 0)
        );
      }
    }

    if (governedWeeklyKm < beforeKm) {
      const msg = `周总跑量 ${beforeKm}km 超过 ${progRec} 负荷上限 ${weeklyCapKm}km，已按步骤同比例/转休控制至 ${governedWeeklyKm}km`;
      inputErrors.push(msg);
      repairs.push(msg);
    }
  }

  // 7) 终检后置不变量自检
  const postErrors = [];
  for (let idx = 0; idx < finalized.length; idx++) {
    const d = finalized[idx];
    if (!Number.isFinite(d.plannedDistanceKm) || d.plannedDistanceKm < 0) {
      postErrors.push(`${d.date}: 输出距离非法 (${d.plannedDistanceKm})`);
    }
    if (!Number.isFinite(d.plannedDurationMin) || d.plannedDurationMin < 0) {
      postErrors.push(`${d.date}: 输出时长非法 (${d.plannedDurationMin})`);
    }
    if (Array.isArray(d.steps) && d.steps.length > 0 && !validateStepsSchema(d.steps).valid) {
      postErrors.push(`${d.date}: 输出 steps 校验失败`);
    }
    if (d.type === 'REST') {
      const postRestLoad = classifyWorkoutLoad(d);
      if (
        postRestLoad.hasNonRestStep ||
        postRestLoad.hasRunningLoad ||
        postRestLoad.isHeavyLowerStrength ||
        postRestLoad.isAnyLowerStrengthOrImpact ||
        d.plannedDistanceKm > 0
      ) {
        postErrors.push(`${d.date}: REST 休息日仍包含非休息步骤或训练负荷`);
      }
    }
    if ((is800mPlan || !d.isCustomPlan) && d.type !== 'REST') {
      const postStageCheck = evaluateDayStageCompliance(d, policy, stageInfo);
      if (!postStageCheck.compliant) {
        postErrors.push(`${d.date}: 终检仍存在越级或违例 (${postStageCheck.violations.join('；')})`);
      }
    }
    if (idx > 0 && classifyWorkoutLoad(finalized[idx - 1]).isHighStressLowerDay && classifyWorkoutLoad(d).isHighStressLowerDay) {
      postErrors.push(`${d.date}: 仍存在连续高负荷下肢冲突`);
    }
  }
  const postHardCount = governedIndices.filter((idx) => isQualityLoadDay(finalized[idx])).length;
  if (postHardCount > policy.maxHardPerWeek) {
    postErrors.push(`按实际步骤统计周高强课数 ${postHardCount} 仍超过上限 ${policy.maxHardPerWeek}`);
  }
  const postWeeklyKm = round1(
    governedIndices.reduce((sum, idx) => sum + Number(finalized[idx].plannedDistanceKm || 0), 0)
  );
  if (postWeeklyKm > weeklyCapKm + 0.1) {
    postErrors.push(`周总跑量 ${postWeeklyKm}km 仍超过上限 ${weeklyCapKm}km`);
  }

  return {
    days: finalized,
    validationReport: {
      passed: postErrors.length === 0,
      inputValid: inputErrors.length === 0 && repairs.length === 0,
      inputErrorsCount: inputErrors.length,
      inputErrors,
      postErrors,
      repairsCount: repairs.length,
      repairs
    }
  };
}

/**
 * 统一终检门禁断言：未通过终检（或缺少 passed=true 报告）时拒绝返回、保存、发布或同步
 */
export function assertCoachPlanPassed(
  coachPlan,
  { requireReport = true, action = '发布或同步课表' } = {}
) {
  const report = coachPlan?.validationReport;
  if (!report) {
    if (requireReport) {
      const err = new Error(`[ValidationGate] 课表缺少终检报告 (validationReport)，拒绝${action}`);
      err.isValidationGateError = true;
      throw err;
    }
    return;
  }
  if (report.passed !== true) {
    const details = Array.isArray(report.postErrors) && report.postErrors.length > 0
      ? `：${report.postErrors.join('；')}`
      : '';
    const err = new Error(
      `[ValidationGate] 课表终检未通过 (passed=${report.passed})，拒绝${action}${details}`
    );
    err.isValidationGateError = true;
    throw err;
  }
}
