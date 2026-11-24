import fs from 'node:fs/promises';
import path from 'node:path';
import { diffIsoDays, getLocalIsoDate } from '../science/metrics.js';

export const VALID_CHECKIN_STATUSES = ['completed', 'modified', 'rest', 'planned'];
export const VALID_INJURY_STATUSES = ['none', 'active', 'improving', 'resolved'];
export const VALID_INJURY_IMPACTS = ['none', 'mild_discomfort', 'altered_form', 'cannot_run'];
export const VALID_NEXT_DAY_REACTIONS = ['', 'fresh', 'normal_soreness', 'heavy_fatigue', 'pain_flare'];
export const VALID_FORM_STATUSES = ['', 'stable', 'degraded'];
export const VALID_TEST_PURPOSES = ['none', 'recovery_observation', 'capacity_calibration'];

function parseOptionalNumber(val, min, max) {
  if (val === '' || val === null || val === undefined) return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, Math.round(num * 100) / 100));
}

/**
 * 归一化单条打卡、伤病跟踪与训练后反馈记录
 */
export function normalizeCheckinEntry(input = {}, timezone = 'Asia/Shanghai') {
  const dateStr = String(input.date || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : getLocalIsoDate(0, timezone);

  const rawStatus = String(input.status || 'completed').trim().toLowerCase();
  const status = VALID_CHECKIN_STATUSES.includes(rawStatus) ? rawStatus : 'completed';

  const rpeNum = input.rpe === '' || input.rpe === null || input.rpe === undefined ? null : Number(input.rpe);
  const rpe = Number.isFinite(rpeNum) ? Math.min(10, Math.max(1, Math.round(rpeNum))) : null;

  const painNum = input.painLevel === '' || input.painLevel === null || input.painLevel === undefined ? 0 : Number(input.painLevel);
  const painLevel = Number.isFinite(painNum) ? Math.min(10, Math.max(0, Math.round(painNum))) : 0;

  const sleepNum = input.sleepQuality === '' || input.sleepQuality === null || input.sleepQuality === undefined ? null : Number(input.sleepQuality);
  const sleepQuality = Number.isFinite(sleepNum) ? Math.min(5, Math.max(1, Math.round(sleepNum))) : null;

  const rawAreas = Array.isArray(input.painAreas)
    ? input.painAreas
    : typeof input.painAreas === 'string' && input.painAreas.trim()
      ? input.painAreas.split(/[,，]/).map((s) => s.trim())
      : [];
  const painAreas = [...new Set(rawAreas.map((s) => String(s).trim()).filter(Boolean))].slice(0, 8);
  const normalizedAreas = painAreas.length > 0 ? painAreas : ['无不适'];

  const rawInjuryStatus = String(input.injuryStatus || '').trim().toLowerCase();
  const hasRealArea = normalizedAreas.some((a) => a !== '无不适');
  let injuryStatus = VALID_INJURY_STATUSES.includes(rawInjuryStatus) ? rawInjuryStatus : 'none';
  if (input.injuryResolved === true || injuryStatus === 'resolved') {
    injuryStatus = 'resolved';
  } else if (injuryStatus === 'none' && (painLevel >= 2 || (hasRealArea && painLevel >= 1))) {
    injuryStatus = 'active';
  }

  const rawImpact = String(input.injuryActionImpact || '').trim().toLowerCase();
  let injuryActionImpact = VALID_INJURY_IMPACTS.includes(rawImpact) ? rawImpact : 'none';
  if (injuryActionImpact === 'none' && painLevel > 0) {
    injuryActionImpact =
      painLevel >= 6 ? 'cannot_run' : painLevel >= 3 ? 'altered_form' : 'mild_discomfort';
  }

  const injuryResolved = injuryStatus === 'resolved' || Boolean(input.injuryResolved);

  // 训练后执行反馈（P2 反馈闭环 + 力量 RIR 与动作稳定性）
  const actualDistanceKm = parseOptionalNumber(input.actualDistanceKm, 0, 200);
  const actualDurationMin = parseOptionalNumber(input.actualDurationMin, 0, 600);
  const paceDropoffPct = parseOptionalNumber(input.paceDropoffPct, -20, 100);
  const keySplitsSummary = String(input.keySplitsSummary || '').trim().slice(0, 300);
  const rawReaction = String(input.nextDayReaction || '').trim().toLowerCase();
  const nextDayReaction = VALID_NEXT_DAY_REACTIONS.includes(rawReaction) ? rawReaction : '';

  const rawForm =
    input.formMaintained === false
      ? 'degraded'
      : input.formMaintained === true
        ? 'stable'
        : String(input.formStatus || '').trim().toLowerCase();
  const formStatus = VALID_FORM_STATUSES.includes(rawForm) ? rawForm : '';

  const rawTestPurpose = String(input.testPurpose || 'none').trim().toLowerCase();
  const testPurpose = VALID_TEST_PURPOSES.includes(rawTestPurpose) ? rawTestPurpose : 'none';

  const strengthExercise = String(input.strengthExercise || '').trim().slice(0, 100);
  const strengthLoadKg = parseOptionalNumber(input.strengthLoadKg, 0, 500);
  const strengthSetsReps = String(input.strengthSetsReps || '').trim().slice(0, 40);
  const strengthRir = parseOptionalNumber(input.strengthRir, 0, 10);

  const diary = String(input.diary || '').trim().slice(0, 2000);
  const updatedAt =
    String(input.updatedAt || '').trim() ||
    new Date().toLocaleString('zh-CN', { timeZone: timezone, hour12: false });

  return {
    date,
    status,
    rpe,
    painLevel,
    painAreas: normalizedAreas,
    sleepQuality,
    injuryStatus,
    injuryActionImpact,
    injuryResolved,
    actualDistanceKm,
    actualDurationMin,
    keySplitsSummary,
    paceDropoffPct,
    formStatus,
    nextDayReaction,
    testPurpose,
    strengthExercise,
    strengthLoadKg,
    strengthSetsReps,
    strengthRir,
    diary,
    updatedAt
  };
}

/**
 * 读取历史打卡记录（按日期降序）
 */
export async function loadCheckins(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
    return list
      .filter((item) => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')))
      .map((item) => normalizeCheckinEntry(item))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * 新增或更新指定日期的打卡与训练日记（原子写入）
 */
export async function upsertCheckin(entryInput, filePath, timezone = 'Asia/Shanghai') {
  const entry = normalizeCheckinEntry(entryInput, timezone);
  const existing = await loadCheckins(filePath);
  const map = new Map(existing.map((item) => [item.date, item]));
  map.set(entry.date, entry);

  const next = [...map.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 180);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify({ entries: next }, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);

  return { entry, entries: next };
}

/**
 * 删除指定日期的打卡与训练日记（原子写入）
 */
export async function deleteCheckin(dateStr, filePath) {
  const date = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const err = new Error('请提供有效日期（YYYY-MM-DD）');
    err.statusCode = 400;
    throw err;
  }

  const existing = await loadCheckins(filePath);
  const next = existing.filter((item) => item.date !== date);
  const deleted = next.length !== existing.length;

  if (deleted) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify({ entries: next }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await fs.rename(tmpPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  }

  return {
    deleted,
    date,
    entries: next
  };
}

/**
 * 按明确日期窗口与持久化伤病状态提取调课信号：
 * - 疲劳 / RPE 仅统计近 0~2 天（48-72h 窗口），陈旧历史不误触发今日疲劳
 * - 持续伤病独立追踪直至明确标记 resolved，不会因未连续打卡而自动消失
 */
export function summarizeCheckinSignals(checkins = [], todayStr) {
  const refDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || '')) ? todayStr : getLocalIsoDate(0);
  const upToToday = [...checkins]
    .filter((c) => c && /^\d{4}-\d{2}-\d{2}$/.test(String(c.date || '')) && c.date <= refDate)
    .sort((a, b) => b.date.localeCompare(a.date));

  const todayCheckin = upToToday.find((c) => c.date === refDate) || null;
  const forceRestToday = todayCheckin?.status === 'rest';

  const recentFatigueWindow = upToToday.filter((c) => {
    const daysAgo = diffIsoDays(refDate, c.date);
    return daysAgo !== null && daysAgo >= 0 && daysAgo <= 2;
  });

  const recent48hReaction = upToToday.find((c) => {
    const daysAgo = diffIsoDays(refDate, c.date);
    return daysAgo !== null && daysAgo >= 0 && daysAgo <= 1 && c.nextDayReaction;
  })?.nextDayReaction || '';

  const highRpeLoad =
    Number(todayCheckin?.rpe || 0) >= 9 ||
    recentFatigueWindow.filter((c) => Number(c.rpe || 0) >= 8).length >= 2 ||
    recent48hReaction === 'heavy_fatigue';

  const recentDropoffAlert = recentFatigueWindow.some(
    (c) => Number(c.paceDropoffPct || 0) > 3 || c.formStatus === 'degraded'
  );

  // 按时间正序维护持久化伤病状态表
  const chronological = [...upToToday].sort((a, b) => a.date.localeCompare(b.date));
  const injuryMap = new Map();

  for (const entry of chronological) {
    const realAreas = (entry.painAreas || []).filter((a) => a && a !== '无不适');
    const resolvedFlag = entry.injuryResolved || entry.injuryStatus === 'resolved';

    if (resolvedFlag) {
      if (realAreas.length > 0) {
        for (const area of realAreas) injuryMap.delete(area);
      } else {
        injuryMap.clear();
      }
      continue;
    }

    const pain = Number(entry.painLevel || 0);
    const hasPainSignal =
      entry.injuryStatus === 'active' ||
      entry.injuryStatus === 'improving' ||
      pain >= 2 ||
      entry.injuryActionImpact === 'altered_form' ||
      entry.injuryActionImpact === 'cannot_run';

    if (hasPainSignal) {
      const targets = realAreas.length > 0 ? realAreas : ['未指定部位'];
      for (const area of targets) {
        const prev = injuryMap.get(area);
        injuryMap.set(area, {
          area,
          status: entry.injuryStatus === 'improving' ? 'improving' : 'active',
          painLevel: pain,
          impact: entry.injuryActionImpact || (pain >= 3 ? 'altered_form' : 'mild_discomfort'),
          firstDate: prev?.firstDate || entry.date,
          lastDate: entry.date,
          daysSinceUpdate: diffIsoDays(refDate, entry.date)
        });
      }
    }
  }

  const persistentInjuries = [...injuryMap.values()];
  const todayPain = Number(todayCheckin?.painLevel || 0);

  const painAlert =
    todayPain >= 3 ||
    todayCheckin?.injuryActionImpact === 'altered_form' ||
    todayCheckin?.injuryActionImpact === 'cannot_run' ||
    recent48hReaction === 'pain_flare' ||
    persistentInjuries.some(
      (inj) =>
        inj.painLevel >= 3 ||
        inj.impact === 'altered_form' ||
        inj.impact === 'cannot_run'
    );

  const moderatePain =
    !painAlert &&
    (todayPain >= 2 ||
      persistentInjuries.length > 0);

  const latestCompletedFeedback =
    upToToday.find((c) => {
      const daysAgo = diffIsoDays(refDate, c.date);
      return (
        daysAgo !== null &&
        daysAgo >= 0 &&
        daysAgo <= 7 &&
        (c.actualDistanceKm != null ||
          c.keySplitsSummary ||
          c.paceDropoffPct != null ||
          c.formStatus ||
          c.strengthLoadKg != null ||
          c.strengthRir != null ||
          c.nextDayReaction)
      );
    }) || null;

  // 近 14 天周复盘与单变量进阶判断（取代按日历自动加量/提速/加重）
  const window14d = upToToday.filter((c) => {
    const daysAgo = diffIsoDays(refDate, c.date);
    return daysAgo !== null && daysAgo >= 0 && daysAgo <= 13;
  });
  const completedEntries14d = window14d.filter(
    (c) => c.status === 'completed' || c.status === 'modified'
  );
  const completedSessions14d = completedEntries14d.length;
  const fullCompleted14d = window14d.filter((c) => c.status === 'completed').length;
  const poorRecoveryCount14d = window14d.filter(
    (c) =>
      c.nextDayReaction === 'heavy_fatigue' ||
      c.nextDayReaction === 'pain_flare' ||
      Number(c.rpe || 0) >= 9
  ).length;
  const unstableSessions14d = window14d.filter(
    (c) => Number(c.paceDropoffPct || 0) > 3 || c.formStatus === 'degraded'
  ).length;

  const hasPositiveRecovery = (c) =>
    c.nextDayReaction === 'fresh' || c.nextDayReaction === 'normal_soreness';
  const hasExecutionMetrics = (c) =>
    c.actualDistanceKm != null ||
    c.actualDurationMin != null ||
    Boolean(c.keySplitsSummary) ||
    c.paceDropoffPct != null ||
    (c.strengthLoadKg != null && c.strengthRir != null);
  const hasStableFormSignal = (c) =>
    c.formStatus === 'stable' || (c.paceDropoffPct != null && Number(c.paceDropoffPct) <= 3);

  const recoveryConfirmedCount14d = completedEntries14d.filter(hasPositiveRecovery).length;
  const executionDetailCount14d = completedEntries14d.filter(hasExecutionMetrics).length;
  const stableFormConfirmedCount14d = completedEntries14d.filter(hasStableFormSignal).length;

  let verifiedRecoveryStatus = 'unknown';
  if (painAlert || recent48hReaction === 'pain_flare' || poorRecoveryCount14d > 0) {
    verifiedRecoveryStatus = 'poor';
  } else if (
    completedSessions14d >= 3 &&
    recoveryConfirmedCount14d >= 3 &&
    executionDetailCount14d >= 3 &&
    stableFormConfirmedCount14d >= 2 &&
    unstableSessions14d === 0
  ) {
    verifiedRecoveryStatus = 'confirmed_good';
  }

  const normalizeExercise = (name) =>
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');

  const strengthLogs14d = window14d.filter(
    (c) =>
      c.strengthLoadKg != null ||
      c.strengthRir != null ||
      Boolean(normalizeExercise(c.strengthExercise))
  );
  const latestStrengthLog = strengthLogs14d[0] || null;
  const latestExerciseKey = normalizeExercise(latestStrengthLog?.strengthExercise);
  const sameExerciseLogs = latestExerciseKey
    ? strengthLogs14d.filter((c) => normalizeExercise(c.strengthExercise) === latestExerciseKey)
    : [];
  const sameExercisePair = sameExerciseLogs.slice(0, 2);
  const sameExerciseAllValid =
    sameExercisePair.length >= 2 &&
    sameExercisePair.every(
      (log) =>
        (log.strengthLoadKg != null || Boolean(log.strengthSetsReps)) &&
        log.strengthRir != null &&
        Number(log.strengthRir) >= 2 &&
        hasPositiveRecovery(log)
    );
  const sameExerciseMissingRecovery =
    sameExercisePair.some((log) => !log.nextDayReaction);

  const latestObservationTest =
    window14d.find((c) => c.testPurpose === 'recovery_observation') || null;
  const latestCalibrationTest =
    window14d.find((c) => c.testPurpose === 'capacity_calibration') || null;

  let strengthProgressionStatus = 'hold';
  let strengthProgressionNote = '缺少同一动作连续 ≥2 次有效记录（含重量/组数、RIR ≥ 2 与明确次日恢复反应），维持当前基础负荷';
  if (painAlert || recent48hReaction === 'pain_flare') {
    strengthProgressionStatus = 'regress_or_pause';
    strengthProgressionNote = '存在疼痛/加重反应，暂停或回退下肢负重';
  } else if (moderatePain || persistentInjuries.length > 0) {
    strengthProgressionStatus = 'hold';
    strengthProgressionNote = '存在持续不适记录，力量训练维持观察不加重';
  } else if (
    sameExerciseAllValid &&
    recent48hReaction !== 'heavy_fatigue' &&
    poorRecoveryCount14d === 0
  ) {
    strengthProgressionStatus = 'ready_small_increment';
    strengthProgressionNote = `同一动作「${latestStrengthLog.strengthExercise}」连续 ${sameExercisePair.length} 次 RIR ≥ 2 且次日反应良好，可微调一次力量组数或极小重量（增重不等同 800m 必然提速）`;
  } else if (latestStrengthLog) {
    if (!latestExerciseKey) {
      strengthProgressionNote = '力量记录未写明动作名称，无法按同一动作核对连续表现，维持当前重量';
    } else if (sameExerciseLogs.length < 2) {
      strengthProgressionNote = `「${latestStrengthLog.strengthExercise}」近14天仅 ${sameExerciseLogs.length} 次记录（不同动作不合并计数），需同一动作连续 ≥2 次且恢复良好再微调`;
    } else if (sameExerciseMissingRecovery) {
      strengthProgressionNote = `「${latestStrengthLog.strengthExercise}」缺少明确的次日恢复反应反馈（状态未知），维持当前重量不加量`;
    } else if (sameExercisePair.some((log) => log.strengthRir == null || Number(log.strengthRir) < 2)) {
      strengthProgressionNote = `同一动作「${latestStrengthLog.strengthExercise}」近期存在 RIR < 2 或缺失余力，维持当前重量不加量`;
    } else {
      strengthProgressionNote = '继续累积无痛且次日恢复良好的连续力量反馈后再微调';
    }
  }

  const missingFeedbackParts = [];
  if (recoveryConfirmedCount14d < 3) missingFeedbackParts.push('次日恢复反应');
  if (executionDetailCount14d < 3) missingFeedbackParts.push('实际距离/时长/分段');
  if (stableFormConfirmedCount14d < 2) missingFeedbackParts.push('动作稳定性');

  let progressionRecommendation = 'hold';
  let progressionReason = '近14天连续完成反馈不足，保持当前周骨架与配速自然演化';
  if (painAlert || recent48hReaction === 'pain_flare' || poorRecoveryCount14d >= 2) {
    progressionRecommendation = 'regress';
    progressionReason = '存在疼痛信号或多次次日重度恢复滞后，建议回退或维持减量周';
  } else if (
    moderatePain ||
    persistentInjuries.length > 0 ||
    unstableSessions14d > 0 ||
    highRpeLoad ||
    poorRecoveryCount14d > 0 ||
    completedSessions14d < 3 ||
    verifiedRecoveryStatus !== 'confirmed_good'
  ) {
    progressionRecommendation = 'hold';
    progressionReason =
      moderatePain || persistentInjuries.length > 0
        ? '存在持续轻度不适记录，维持当前负荷观察'
        : unstableSessions14d > 0
          ? '近期出现分段掉速 >3% 或动作变形，本周维持不加量'
          : poorRecoveryCount14d > 0 || highRpeLoad
            ? '近期存在次日偏重疲劳或高 RPE 负荷，本周维持现有骨架'
            : completedSessions14d < 3
              ? `近14天完成 ${completedSessions14d} 次（需 ≥3 次且具备明确恢复反馈才允许进阶），维持当前负荷`
              : `近14天虽有 ${completedSessions14d} 次完成打卡，但缺少足够的${missingFeedbackParts.join('、') || '恢复'}反馈（状态未知），维持当前负荷`;
  } else {
    progressionRecommendation = 'eligible_single_variable';
    progressionReason = `近14天稳定完成 ${completedSessions14d} 次（全完成 ${fullCompleted14d} 次），无持续不适且分段/动作/次日反应明确良好，周末复盘可优先上调 1 个负荷变量`;
  }

  const weeklyReview = {
    completedSessions14d,
    fullCompleted14d,
    poorRecoveryCount14d,
    unstableSessions14d,
    recoveryConfirmedCount14d,
    executionDetailCount14d,
    stableFormConfirmedCount14d,
    verifiedRecoveryStatus,
    missingFeedbackParts,
    strengthLogsCount14d: strengthLogs14d.length,
    sameExerciseName: latestStrengthLog?.strengthExercise || null,
    sameExerciseStreakCount: sameExerciseLogs.length,
    strengthRecoveryConfirmed: sameExerciseAllValid,
    latestStrengthLog: latestStrengthLog
      ? {
          date: latestStrengthLog.date,
          exercise: latestStrengthLog.strengthExercise || '未命名力量动作',
          loadKg: latestStrengthLog.strengthLoadKg,
          setsReps: latestStrengthLog.strengthSetsReps,
          rir: latestStrengthLog.strengthRir,
          nextDayReaction: latestStrengthLog.nextDayReaction || ''
        }
      : null,
    strengthProgressionStatus,
    strengthProgressionNote,
    latestObservationTestDate: latestObservationTest?.date || null,
    latestCalibrationTestDate: latestCalibrationTest?.date || null,
    progressionRecommendation,
    progressionReason
  };

  const triggers = [];
  if (forceRestToday) {
    triggers.push('今日已主动打卡请假休息');
  }
  if (painAlert) {
    const desc =
      persistentInjuries.length > 0
        ? persistentInjuries
            .map((i) => `${i.area}(${i.painLevel}/10, ${i.impact}, 最近反馈 ${i.lastDate})`)
            .join('、')
        : `${(todayCheckin?.painAreas || []).join('、')}(${todayPain}/10)`;
    triggers.push(`存在动作受限或中重度疼痛风险（${desc}），触发运动限制保护`);
  } else if (moderatePain) {
    const desc =
      persistentInjuries.length > 0
        ? persistentInjuries.map((i) => `${i.area}(${i.painLevel}/10, ${i.lastDate})`).join('、')
        : `${(todayCheckin?.painAreas || []).join('、')}(${todayPain}/10)`;
    triggers.push(`存在持续轻度不适记录（${desc}），需降负荷观察并在明确恢复后解除`);
  }
  if (highRpeLoad) {
    triggers.push(`近 48–72h 主观疲劳较高（今日 RPE ${todayCheckin?.rpe ?? '-'}/10${recent48hReaction === 'heavy_fatigue' ? '，次日重度疲劳' : ''}）`);
  }
  if (recentDropoffAlert) {
    triggers.push('近期训练分段掉速超过 3% 或动作稳定性下降，本次控量保质');
  }

  return {
    todayCheckin,
    recentCheckins: upToToday.slice(0, 7),
    recentFatigueWindow,
    forceRestToday,
    painAlert,
    moderatePain,
    persistentInjuries,
    highRpeLoad,
    recentDropoffAlert,
    latestCompletedFeedback,
    weeklyReview,
    triggers
  };
}
