import {
  computeEnvironmentalAdjustment,
  formatPace,
  getLocalIsoDate,
  getWeekdayIndexFromIso,
  parsePaceSecPerKm
} from '../science/metrics.js';
import { summarizeCheckinSignals } from '../storage/checkins.js';
import { loadCoachKnowledgeBundle } from './knowledgeLoader.js';
import {
  assertCoachPlanPassed,
  build800mFallbackDay,
  determineEffective800mStage,
  validateAndFinalizePlan
} from './planRules.js';

const BASE_SYSTEM_PROMPT = `你是一位严谨务实、注重证据分级的「800m 中距离跑步与力量协同私人教练」。
你的核心参考是下方注入的【800m 专项教练 Skill 与科学手册】。生成建议时必须明确区分「实测数据」「经验估算」「个人暂定规则」与「缺失数据」，严禁把缺失默认值或经验推算写成“已精确标定”。

严格遵循以下原则：
1. 【定制周骨架与按反馈进阶】：若输入中包含 activeCustomPlan（周骨架），维持周结构连续，不得按日历自动加量、强制提速或硬加杠铃重量；每次优先至多调整一个主要负荷变量，恢复滞后就维持或回退；轻松跑允许随恢复自然变快，配速参考个人暂定上限与可完整对话呼吸感，不把固定步频或前中足着地写成普适硬要求。定制选项绝不能绕过主动请假或疼痛保护。
2. 【主客观双门控与疼痛安全边界】：
   - 若今日主动请假休息（forceRestToday），今日必须改为 REST（0 km），且不得声称“后续课表已顺延”（除非明确重排了后续日期）。
   - 若存在动作受限或中重度疼痛风险（painAlert），必须拦截地面跑跳与下肢负重；禁止自动诊断为 ITBS，也禁止把靠墙静蹲、离心提踵或滚压当作所有疼痛的通用处方。
   - ACWR > 1.35 仅作结合症状、近期跑量增量与 HRV/晨脉复核的参考提示，不得单独作为停课依据。
   - 若准备度为 insufficient_data（数据不足），不得假定身体状态良好，高强度课须保守降级或提示补充主观体感。
3. 【测试分层、能力分离与五阶段拆分】：
   - 严禁把“恢复与配速-心率对应观察测试（如 3000m 亚极量渐进跑）”当成全力能力标定套公式；不同 MAS 测试协议结果不可直接混用。
   - 目标 Sub-2:01 配速 ≠ 当前能力配速；阶段升级必须叠加完成稳定度、无持续不适、次日反应与有效测试门控；大周期拆分为 Base → Build → Peak → PreComp（比赛节奏转化）→ Taper（仅赛前 ~1–2 周独立减量窗口，依个体恢复调整）。
   - 力量保持精简（1–2 主动作 + 1 辅助），依据重量/组数/RIR 与次日反应决定进阶，不把力量增重直接等同于 800m 必然提速。
4. 【结构化步骤、决策卡与减量一致性】：依据课表决策卡带入启动/进阶/回退条件；跑步与间歇课必须给出 steps（热身/主间歇/冷身），并保证摘要、详单组数、总距离和预计时长完全一致。
5. 【点评风格要求】：coachSummary 必须用平实清晰的语言依次讲明：① 采用了哪些数据（含缺失/过期情况）；② 为什么调整或维持（含周复盘进阶决策）；③ 具体调整了什么；④ 后续观察什么指标、动作或次日反应。不要刻意堆砌 ASR、SRR、PI 等术语，仅在确实有测试依据且有助于决策时简明使用。
6. 【输出格式】：你必须且只能输出合法的 JSON 对象（不要使用 markdown 代码块包裹，也不要附加任何多余说明文字），严格匹配指定 Schema。`;

function buildSystemPrompt(knowledgeBundle) {
  if (!knowledgeBundle?.systemKnowledgeText) {
    return BASE_SYSTEM_PROMPT;
  }
  return `${BASE_SYSTEM_PROMPT}

================================================================
以下为本项目专属 800m Skill 与科学文献知识库（决策与点评必须严格据此引用与推理）：
================================================================

${knowledgeBundle.systemKnowledgeText}`;
}

const OUTPUT_SCHEMA_HINT = `{
  "macroPhase": {
    "currentStage": "Base | Build | Peak | PreComp | Taper",
    "stageDisplay": "例如：Build 有氧扩容与基础速度期 (门控解锁)",
    "weekFocus": "本周训练核心生理目标与单变量进阶重点一句话总结",
    "nextDeloadInfo": "卸荷/观察跑与恢复安排说明",
    "stages": [
      { "key": "Base", "label": "Stage 0 组织唤醒期", "weeks": "W1-W4", "active": true },
      { "key": "Build", "label": "Stage 1 有氧与基础速度", "weeks": "W5-W11", "active": false },
      { "key": "Peak", "label": "Stage 2 专项准备与VO2", "weeks": "W12-W18", "active": false },
      { "key": "PreComp", "label": "Stage 3 比赛节奏转化", "weeks": "W19-W23", "active": false },
      { "key": "Taper", "label": "Stage 4 赛前独立减量", "weeks": "最后约1-2周", "active": false }
    ]
  },
  "coachSummary": "200字以内的清晰诊断：必须说明用了什么数据（含缺失/过期情况）、为什么调整或维持、具体调整了什么、后续观察什么指标",
  "fitWorkoutCritique": "针对最近重点课表 .FIT 遥测与完成反馈的80字以内技术点评",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "weekday": "周X",
      "type": "E | M | T | I | R | LSD | STR | REST",
      "title": "课表名称",
      "plannedDistanceKm": 6.0,
      "plannedDurationMin": 38,
      "estimatedTss": 42,
      "basePace": "5:50/km",
      "correctedPace": "6:01/km",
      "targetHr": "<= 152 bpm (个人暂定 Z1-Z2 上限)",
      "targetCadence": "176-182 spm",
      "rpe": "4/10",
      "steps": [
        { "kind": "warmup", "distanceKm": 1.0, "durationMin": 6, "description": "慢跑热身与动态激活" },
        { "kind": "steady", "distanceKm": 4.5, "pace": "5:50/km", "description": "稳态轻松跑" },
        { "kind": "cooldown", "distanceKm": 0.5, "durationMin": 4, "description": "慢走冷身" }
      ],
      "envAdjustmentNote": "气温/露点/海拔/风速/AQI 修正说明",
      "warmup": "结构化分步热身（用 ① ② ③ 分点，分号分隔，例如：① 慢跑10min；② 关节激活2×10）",
      "mainSetSummary": "一句话主课表摘要",
      "mainSetDetail": "完整结构化主课表（用 ① ② ③ 分点写清组数/距离/配速/间歇，分号分隔；注意句末补充单独一行短句）",
      "cooldown": "冷身与针对性拉伸肌群（多项目用；分点）",
      "nutrition": "按体重计算的碳水(g)+蛋白质(g)；补水电解质(L/g)（用；分点）",
      "coachTip": "教练针对当日状态的特别提示"
    }
  ]
}`;

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

export async function generateCoachPlan(context, config = {}) {
  const knowledgeBundle = await loadCoachKnowledgeBundle(context.rootDir);
  const tz = config.timezone || 'Asia/Shanghai';
  const todayStr = context.todayStr || context.envForecast?.daily?.[0]?.date || getLocalIsoDate(0, tz);
  const checkinSignals = summarizeCheckinSignals(context.checkins || [], todayStr);
  const stageInfo = determineEffective800mStage({
    config,
    pmcLatest: context.pmc?.latest,
    weeklyZones: context.weeklyZones,
    checkinSignals
  });

  const apiKey = (process.env.LLM_API_KEY || '').trim();
  if (!apiKey) {
    console.log('[Coach] LLM_API_KEY not set; using deterministic scientific plan engine.');
    const plan = buildDeterministicCoachPlan(context, config);
    return {
      llmUsed: false,
      knowledgeFilesUsed: knowledgeBundle.loadedFiles,
      model: plan.planSource === 'antigravity-custom-plan' ? 'antigravity-custom-plan' : 'deterministic-science-engine',
      ...plan
    };
  }

  const provider = (process.env.LLM_PROVIDER || config.llm?.provider || 'openai_compatible').toLowerCase();
  const baseUrl = (process.env.LLM_BASE_URL || config.llm?.baseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || config.llm?.model || 'deepseek-chat';
  const temperature = config.llm?.temperature ?? 0.3;

  const systemPrompt = buildSystemPrompt(knowledgeBundle);
  const userPayload = buildLlmInputPayload(context, config);

  try {
    let rawText;
    if (provider === 'anthropic') {
      rawText = await callAnthropic({ apiKey, baseUrl, model, temperature, systemPrompt, userPayload });
    } else {
      rawText = await callOpenAiCompatible({ apiKey, baseUrl, model, temperature, systemPrompt, userPayload });
    }

    const parsed = parseJsonRobust(rawText);
    if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) {
      throw new Error('LLM returned invalid plan structure');
    }

    // 所有来源（含 LLM AI 返回）必须经过统一的最终检查网关
    const validateFn = typeof context._validatePlanFn === 'function' ? context._validatePlanFn : validateAndFinalizePlan;
    const validated = validateFn(parsed.days, {
      todayStr,
      readiness: context.readiness,
      checkinSignals,
      envForecast: context.envForecast,
      stageInfo,
      config,
      wellness: context.wellness
    });

    const aiStage = parsed.macroPhase?.currentStage || null;
    const stageOverridden = Boolean(aiStage && aiStage !== stageInfo.currentStage);
    const authoritativeMacro = resolveAuthoritativeMacroPhase(stageInfo, parsed.macroPhase);
    const finalReport = { ...validated.validationReport };
    if (stageOverridden) {
      const stageMsg = `阶段门控校正：AI 尝试输出 ${aiStage}，程序按实测门槛强制锁定为 ${stageInfo.currentStage}`;
      finalReport.inputErrors = [...(finalReport.inputErrors || []), stageMsg];
      finalReport.inputErrorsCount = finalReport.inputErrors.length;
      finalReport.repairs = [stageMsg, ...(finalReport.repairs || [])];
      finalReport.repairsCount = finalReport.repairs.length;
      finalReport.inputValid = false;
    }

    const baseSummary = String(parsed.coachSummary || '').trim();
    const progRec = checkinSignals.weeklyReview?.progressionRecommendation || 'hold';
    const overrideBanner =
      stageOverridden || finalReport.repairsCount > 0
        ? `【程序终检门控】已确认有效阶段=${stageInfo.currentStage}（周复盘=${progRec}），已拦截修正 ${finalReport.repairsCount} 处越级或超纲内容。`
        : '';
    const coachSummary = overrideBanner ? `${overrideBanner} ${baseSummary}`.trim() : baseSummary;

    if (finalReport.passed !== true) {
      console.warn(
        `[Coach] AI plan failed post-validation gate (${(finalReport.postErrors || []).join('；')}); replacing with verified deterministic plan.`
      );
      const fallbackPlan = buildDeterministicCoachPlan(context, config);
      assertCoachPlanPassed(fallbackPlan, { action: '返回替代课表' });
      const mergedRepairs = [
        ...(finalReport.repairs || []),
        ...(fallbackPlan.validationReport?.repairs || []),
        'AI 返回课表未通过终检，已整周切换为通过终检的替代课表'
      ];
      return {
        ...fallbackPlan,
        llmUsed: false,
        planSource: 'deterministic-fallback-after-validation-fail',
        knowledgeFilesUsed: knowledgeBundle.loadedFiles,
        model: `verified-fallback (${model})`,
        coachSummary: `【终检失败替代】原 AI 课表未通过终检（${(finalReport.postErrors || []).join('；')}），已切换为通过终检的安全替代课表。${fallbackPlan.coachSummary}`,
        validationReport: {
          ...fallbackPlan.validationReport,
          passed: true,
          inputValid: false,
          rejectedPlanErrors: finalReport.postErrors || [],
          repairs: mergedRepairs,
          repairsCount: mergedRepairs.length
        }
      };
    }

    return {
      llmUsed: true,
      planSource: 'llm-800m-knowledge-coach',
      knowledgeFilesUsed: knowledgeBundle.loadedFiles,
      model,
      ...parsed,
      macroPhase: authoritativeMacro,
      coachSummary,
      weeklyReview: checkinSignals.weeklyReview,
      upgradeGate: stageInfo.upgradeGate,
      days: validated.days,
      validationReport: finalReport
    };
  } catch (err) {
    if (err?.isValidationGateError) throw err;
    console.warn(`[Coach] LLM call failed (${err.message}), falling back to deterministic plan engine.`);
    const fallbackPlan = buildDeterministicCoachPlan(context, config);
    assertCoachPlanPassed(fallbackPlan, { action: '返回回退课表' });
    return {
      llmUsed: false,
      knowledgeFilesUsed: knowledgeBundle.loadedFiles,
      model: `fallback-after-error (${err.message})`,
      ...fallbackPlan
    };
  }
}

function buildLlmInputPayload(context, config) {
  const { readiness, pmc, weeklyZones, wellness, envForecast, lastKeyWorkoutAudit, customPlan, checkins = [] } = context;
  const tz = config.timezone || 'Asia/Shanghai';
  const todayStr = context.todayStr || envForecast?.daily?.[0]?.date || getLocalIsoDate(0, tz);
  const checkinSignals = summarizeCheckinSignals(checkins, todayStr);
  const stageInfo = determineEffective800mStage({
    config,
    pmcLatest: pmc?.latest,
    weeklyZones,
    checkinSignals
  });
  const compactForecast = (envForecast?.daily || []).map((d) => ({
    ...d,
    adjustment: computeEnvironmentalAdjustment(d)
  }));

  const forecastDates = compactForecast.map((d) => d.date);
  const activeCustomDays = {};
  if (customPlan?.days && typeof customPlan.days === 'object') {
    for (const d of forecastDates) {
      if (customPlan.days[d]) activeCustomDays[d] = customPlan.days[d];
    }
  }

  const signalsPayload = {
    forceRestToday: checkinSignals.forceRestToday,
    painAlert: checkinSignals.painAlert,
    moderatePain: checkinSignals.moderatePain,
    persistentInjuries: checkinSignals.persistentInjuries,
    highRpeLoad: checkinSignals.highRpeLoad,
    recentDropoffAlert: checkinSignals.recentDropoffAlert,
    latestCompletedFeedback: checkinSignals.latestCompletedFeedback,
    weeklyReview: checkinSignals.weeklyReview,
    triggers: checkinSignals.triggers
  };
  return `请结合注入的 800m 专项知识库与 Skill，根据以下完整跑者数据与训练日记，为我生成未来 7 天的科学训练计划与清晰教练点评，并严格按照 JSON Schema 输出。

### 跑者目标、有效阶段与参数来源
${JSON.stringify({
  goal: config.goal,
  schedule: config.schedule,
  effectiveStage: stageInfo,
  physiologyMeta: config.physiologyMeta || null,
  physiology: {
    ...config.physiology,
    weightKg: wellness?.weightKg ?? config.physiology?.weightKg,
    lthr: wellness?.lthrFromDevice ?? config.physiology?.lthr,
    maxHr: wellness?.maxHrFromDevice ?? config.physiology?.maxHr,
    vo2Max: wellness?.vo2Max ?? null
  }
}, null, 2)}

### 今日生理准备度、数据完整性与时效性
${JSON.stringify({ readiness, wellness }, null, 2)}

### 跑者近期主观打卡、持续伤病状态、周复盘进阶结论与训练后反馈
${JSON.stringify({
  todayStr,
  signals: signalsPayload,
  recentEntries: checkinSignals.recentCheckins
}, null, 2)}

### 正在执行的 Antigravity 定制周期课表 (如存在则必须作为 7 天课表锚点)
${JSON.stringify(
  customPlan
    ? {
        updatedAt: customPlan.updatedAt || null,
        macroPhase: customPlan.macroPhase || null,
        coachNotes: customPlan.coachNotes || null,
        days: activeCustomDays
      }
    : null,
  null,
  2
)}

### 负荷趋势 (Banister PMC) & 80/20 区间分布
${JSON.stringify({
  pmcLatest: pmc.latest,
  recentWeekly: weeklyZones.weekly.slice(-6),
  polarization: weeklyZones.polarization,
  zonePercentages: weeklyZones.zonePercentages
}, null, 2)}

### 最近重点课表 .FIT 遥测审计
${JSON.stringify(
  lastKeyWorkoutAudit
    ? {
        activityName: lastKeyWorkoutAudit.activity?.name,
        date: lastKeyWorkoutAudit.activity?.date,
        distanceKm: lastKeyWorkoutAudit.activity?.distanceKm,
        pace: formatPace(lastKeyWorkoutAudit.activity?.paceSecPerKm),
        avgHr: lastKeyWorkoutAudit.activity?.averageHr,
        cadence: lastKeyWorkoutAudit.activity?.cadence,
        elevationGainM: lastKeyWorkoutAudit.activity?.elevationGainM,
        decoupling: lastKeyWorkoutAudit.decoupling,
        avgStrideM: lastKeyWorkoutAudit.avgStrideM
      }
    : null,
  null,
  2
)}

### 未来 7 天训练时段气象、海拔与空气质量预报
${JSON.stringify(compactForecast, null, 2)}

### 必须严格遵循的输出 JSON Schema
${OUTPUT_SCHEMA_HINT}`;
}

async function callOpenAiCompatible({ apiKey, baseUrl, model, temperature, systemPrompt, userPayload }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload }
      ]
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${errText.slice(0, 180)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function callAnthropic({ apiKey, baseUrl, model, temperature, systemPrompt, userPayload }) {
  const endpoint = baseUrl.includes('/v1') ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPayload }]
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${errText.slice(0, 180)}`);
  }
  const data = await res.json();
  return data?.content?.[0]?.text || '';
}

function parseJsonRobust(rawText) {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * 将 config/custom-plan.json 中某天的定制课表归一化为标准结构，交由统一校验器处理
 */
function normalizeCustomDayTemplate(entry, defaults) {
  const { paces, lthr, maxHr } = defaults;
  const type = String(entry?.type || 'E').toUpperCase();
  const easyCeiling = Math.round(lthr * 0.83);
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
        ...normalizeCustomDayTemplate(customEntry, { paces, lthr, maxHr })
      });
    } else {
      rawDays.push({
        date: dateStr,
        isCustomPlan: false,
        ...build800mFallbackDay({
          dow,
          stageInfo,
          lthr,
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

export { buildSystemPrompt, buildLlmInputPayload };
