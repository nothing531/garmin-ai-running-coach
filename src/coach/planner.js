import { computeEnvironmentalAdjustment, formatPace, parsePaceSecPerKm } from '../science/metrics.js';

const SYSTEM_PROMPT = `你是一位拥有运动生理学博士背景与世界级耐力教练经验的「私人 AI 跑步总教练」。
你的理论基石是 Jack Daniels VDOT 体系、80/20 极化训练法（结合挪威阈值理念）与 Banister PMC 负荷模型。
你必须严格依据输入 JSON 中的 Garmin 真实生理指标（HRV、静息心率、睡眠架构、身体电量）、近 6–12 周训练负荷（CTL/ATL/TSB/ACWR）、.FIT 有氧解耦率（Pa:Hr）以及未来 7 天训练时段真实天气/露点/海拔/空气质量数据，输出高度个性化的周期性、分化型跑步训练计划。

严格遵循以下原则：
1. 【红绿灯动态调课】：若今日 readiness.light 为 "red"，必须强制熔断今日强度课，改为 Zone 1 恢复慢跑或完全休息；若为 "yellow"，必须下调今日强度容量 20%–30% 或将 VO2max 间歇降级为分段阈值跑。
2. 【80/20 极化分化】：每周约 80% 跑量处于轻松有氧区（E/LSD Zone 1–2），不超过 20% 为高质量课表（T 阈值 / I 间歇 / R 速度 / M 马拉松配速），并穿插跑者专项力量与恢复日，避免落入 Zone 3 垃圾跑量区。
3. 【环境修正透明化】：每日课表必须同时给出「基准目标配速」与「考虑温度、露点、海拔、风速修正后的当日目标配速」，若 AQI > 150 或雷暴必须自动给出室内跑步机替代方案。
4. 【输出格式】：你必须且只能输出合法的 JSON 对象（不要使用 markdown 代码块包裹，也不要附加任何多余说明文字），严格匹配指定 Schema。`;

const OUTPUT_SCHEMA_HINT = `{
  "macroPhase": {
    "currentStage": "Base | Build | Peak | Taper",
    "stageDisplay": "例如：Build 专项强化期 (第 3 周 / 负荷递增周)",
    "weekFocus": "本周训练核心生理目标一句话总结",
    "nextDeloadInfo": "下一次减量恢复周安排说明",
    "stages": [
      { "key": "Base", "label": "基础有氧期", "weeks": "W1-W4", "active": false },
      { "key": "Build", "label": "专项强化期", "weeks": "W5-W9", "active": true },
      { "key": "Peak", "label": "巅峰转化期", "weeks": "W10-W12", "active": false },
      { "key": "Taper", "label": "赛前减量期", "weeks": "W13-W14", "active": false }
    ]
  },
  "coachSummary": "150字以内的总教练今日诊断与本周总体策略（直接点出 HRV/ACWR/环境对今日与本周的决定性影响）",
  "fitWorkoutCritique": "针对最近重点课表 .FIT 解耦率、心率漂移、步频稳定性与配速控制的80字以内技术点评",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "weekday": "周X",
      "type": "E | M | T | I | R | LSD | STR | REST",
      "title": "课表名称",
      "plannedDistanceKm": 10.0,
      "plannedDurationMin": 55,
      "estimatedTss": 62,
      "basePace": "4:25/km",
      "correctedPace": "4:31/km",
      "targetHr": "166-174 bpm (Z4)",
      "targetCadence": "182-186 spm",
      "rpe": "7/10",
      "envAdjustmentNote": "气温/露点/海拔/风速/AQI 修正说明",
      "warmup": "热身细节",
      "mainSetSummary": "一句话主课表摘要",
      "mainSetDetail": "完整结构化主课表组数、距离/时间与组间休息",
      "cooldown": "冷身与针对性拉伸肌群",
      "nutrition": "按跑者体重计算的跑后 30 分钟碳水(g)+蛋白质(g)+电解质补水方案",
      "coachTip": "教练针对当日状态的特别提示"
    }
  ]
}`;

export async function generateCoachPlan(context, config = {}) {
  const apiKey = (process.env.LLM_API_KEY || '').trim();
  if (!apiKey) {
    console.log('[Coach] LLM_API_KEY not set; using deterministic scientific plan engine.');
    const plan = buildDeterministicCoachPlan(context, config);
    return {
      llmUsed: false,
      model: plan.planSource === 'antigravity-custom-plan' ? 'antigravity-custom-plan' : 'deterministic-science-engine',
      ...plan
    };
  }

  const provider = (process.env.LLM_PROVIDER || config.llm?.provider || 'openai_compatible').toLowerCase();
  const baseUrl = (process.env.LLM_BASE_URL || config.llm?.baseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || config.llm?.model || 'deepseek-chat';
  const temperature = config.llm?.temperature ?? 0.3;

  const userPayload = buildLlmInputPayload(context, config);

  try {
    let rawText;
    if (provider === 'anthropic') {
      rawText = await callAnthropic({ apiKey, baseUrl, model, temperature, userPayload });
    } else {
      rawText = await callOpenAiCompatible({ apiKey, baseUrl, model, temperature, userPayload });
    }

    const parsed = parseJsonRobust(rawText);
    if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) {
      throw new Error('LLM returned invalid plan structure');
    }
    return {
      llmUsed: true,
      model,
      ...parsed
    };
  } catch (err) {
    console.warn(`[Coach] LLM call failed (${err.message}), falling back to deterministic plan engine.`);
    return {
      llmUsed: false,
      model: `fallback-after-error (${err.message})`,
      ...buildDeterministicCoachPlan(context, config)
    };
  }
}

function buildLlmInputPayload(context, config) {
  const { readiness, pmc, weeklyZones, wellness, envForecast, lastKeyWorkoutAudit } = context;
  const compactForecast = (envForecast?.daily || []).map((d) => ({
    ...d,
    adjustment: computeEnvironmentalAdjustment(d)
  }));

  return `请根据以下完整跑者数据，为我生成未来 7 天的科学训练计划，并严格按照 JSON Schema 输出。

### 跑者目标与基本画像
${JSON.stringify({
  goal: config.goal,
  schedule: config.schedule,
  physiology: {
    ...config.physiology,
    weightKg: wellness?.weightKg ?? config.physiology?.weightKg,
    lthr: wellness?.lthrFromDevice ?? config.physiology?.lthr,
    maxHr: wellness?.maxHrFromDevice ?? config.physiology?.maxHr,
    vo2Max: wellness?.vo2Max ?? null
  }
}, null, 2)}

### 今日生理准备度 & 晨间红绿灯
${JSON.stringify({ readiness, wellness }, null, 2)}

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

async function callOpenAiCompatible({ apiKey, baseUrl, model, temperature, userPayload }) {
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
        { role: 'system', content: SYSTEM_PROMPT },
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

async function callAnthropic({ apiKey, baseUrl, model, temperature, userPayload }) {
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
      system: SYSTEM_PROMPT,
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
 * 将 config/custom-plan.json 中某天的定制课表归一化为标准内部模板
 */
function normalizeCustomDayTemplate(entry, defaults) {
  const { paces, lthr, maxHr } = defaults;
  const type = String(entry?.type || 'E').toUpperCase();
  const typeDefaults = {
    REST: { baseSec: paces.easyPaceSec, hrRange: '静息恢复', cadence: '--', rpe: '1-2/10', carbFactor: 0.4 },
    STR: { baseSec: paces.easyPaceSec + 10, hrRange: `${Math.round(lthr * 0.72)}-${Math.round(lthr * 0.81)} bpm (Z1-Z2)`, cadence: '174-178 spm', rpe: '3/10', carbFactor: 0.6 },
    E: { baseSec: paces.easyPaceSec, hrRange: `${Math.round(lthr * 0.75)}-${Math.round(lthr * 0.85)} bpm (Z2)`, cadence: '174-180 spm', rpe: '4/10', carbFactor: 0.7 },
    LSD: { baseSec: paces.easyPaceSec - 8, hrRange: `${Math.round(lthr * 0.80)}-${Math.round(lthr * 0.90)} bpm (Z2-Z3下沿)`, cadence: '176-182 spm', rpe: '6/10', carbFactor: 1.2 },
    M: { baseSec: paces.marathonPaceSec, hrRange: `${Math.round(lthr * 0.89)}-${Math.round(lthr * 0.95)} bpm (Z3-Z4)`, cadence: '180-186 spm', rpe: '6.5/10', carbFactor: 1.0 },
    T: { baseSec: paces.thresholdPaceSec, hrRange: `${Math.round(lthr * 0.96)}-${Math.round(lthr * 1.01)} bpm (Z4)`, cadence: '182-186 spm', rpe: '7-8/10', carbFactor: 1.0 },
    I: { baseSec: paces.intervalPaceSec, hrRange: `${Math.round(maxHr * 0.91)}-${Math.round(maxHr * 0.96)} bpm (Z5)`, cadence: '186-192 spm', rpe: '8.5/10', carbFactor: 1.0 },
    R: { baseSec: paces.repPaceSec, hrRange: `${Math.round(maxHr * 0.92)}-${Math.round(maxHr * 0.98)} bpm (Z5)`, cadence: '190-196 spm', rpe: '9/10', carbFactor: 0.9 }
  };
  const fallback = typeDefaults[type] || typeDefaults.E;
  const distanceKm = Number(entry?.plannedDistanceKm ?? (type === 'REST' ? 0 : 8));
  const parsedPace = parsePaceSecPerKm(entry?.basePaceSecPerKm ?? entry?.basePace);
  const baseSec = parsedPace ?? fallback.baseSec;
  const durationMin = Number(
    entry?.plannedDurationMin ??
      (distanceKm > 0 ? Math.round((distanceKm * baseSec) / 60) : 25)
  );
  const estimatedTss = Number(
    entry?.estimatedTss ??
      Math.max(10, Math.round((durationMin / 60) * (type === 'I' || type === 'T' ? 78 : type === 'REST' ? 20 : 52)))
  );

  return {
    type,
    title: entry?.title || `定制课表 (${type})`,
    distanceKm,
    durationMin,
    tss: estimatedTss,
    baseSec,
    hrRange: entry?.targetHr || fallback.hrRange,
    cadence: entry?.targetCadence || fallback.cadence,
    rpe: entry?.rpe || fallback.rpe,
    warmup: entry?.warmup || (type === 'REST' ? '轻度关节活动' : '1.5–2km 轻松慢跑 + 动态激活'),
    mainSetSummary: entry?.mainSetSummary || entry?.title || '按定制周期计划执行',
    mainSetDetail: entry?.mainSetDetail || entry?.mainSetSummary || '按目标配速与心率区间稳步执行',
    cooldown: entry?.cooldown || '慢走放松与下肢静态拉伸 10 分钟',
    nutritionOverride: entry?.nutrition || null,
    carbFactor: Number(entry?.carbFactor ?? fallback.carbFactor),
    tip: entry?.coachTip || '来自 Antigravity 协同定制周期课表。',
    allowReadinessOverride: entry?.allowReadinessOverride !== false,
    isCustomPlan: true
  };
}

/**
 * 统一对当日课表（定制课表或科学模板）应用晨间红绿灯熔断与天气应急规则
 */
function applyDailyGuardrails(template, { isToday, readiness, adj, easyPaceSec, lthr }) {
  let result = { ...template };
  const canOverride = result.allowReadinessOverride !== false;

  if (isToday && canOverride && readiness.light === 'red' && result.type !== 'REST') {
    result = {
      ...result,
      type: 'REST',
      title: `🔴 红灯熔断 · 原定「${result.title}」已切换为主动恢复`,
      distanceKm: 0,
      durationMin: 30,
      tss: 15,
      baseSec: easyPaceSec + 25,
      hrRange: `< ${Math.round(lthr * 0.72)} bpm (Z1)`,
      cadence: '步行/拉伸',
      rpe: '2/10',
      warmup: '5 分钟温水浴或全身关节温和绕环',
      mainSetSummary: '强制取消今日跑步负荷，改为 25 分钟泡沫轴筋膜放松与呼吸恢复',
      mainSetDetail: '今日生理指标触发红灯预警，严禁硬顶训练。执行：小腿比目鱼肌、足底筋膜、髂胫束滚压 + 腹式呼吸 10 分钟；若体感尚可仅允许 20 分钟超慢步行。',
      cooldown: '23:00 前就寝保证 8 小时睡眠恢复',
      nutritionOverride: null,
      carbFactor: 0.4,
      tip: `触发原因：${readiness.triggers.join('；')}`
    };
  } else if (isToday && canOverride && readiness.light === 'yellow' && ['T', 'I', 'R', 'LSD'].includes(result.type)) {
    result = {
      ...result,
      title: `🟡 黄灯降级 · ${result.title} (减量 25%)`,
      distanceKm: Math.round(result.distanceKm * 0.75 * 10) / 10,
      durationMin: Math.round(result.durationMin * 0.75),
      tss: Math.round(result.tss * 0.72),
      rpe: '6/10',
      mainSetSummary: `${result.mainSetSummary}（黄灯自动下调容量 25%）`,
      tip: `黄灯提醒（${readiness.triggers.join('；')}）：严控心率上限，宁慢勿快`
    };
  }

  if (adj.indoorRecommended && result.type !== 'REST' && result.type !== 'STR') {
    result.mainSetDetail = `${result.mainSetDetail} 【天气熔断替代】当前预报空气质量/强对流不适宜户外，建议改至室内跑步机（设置 1.0% 坡度补偿风阻）完成等效时长训练。`;
  }

  return result;
}

/**
 * 确定性科学训练计划引擎（支持优先读取 config/custom-plan.json 定制周期，并保留每日生理/环境自适应护栏）
 */
export function buildDeterministicCoachPlan(context, config = {}) {
  const { readiness, pmc, weeklyZones, wellness, envForecast, lastKeyWorkoutAudit, customPlan } = context;
  const weightKg = wellness?.weightKg || config.physiology?.weightKg || 66;
  const ltPace = config.physiology?.ltPaceSecPerKm || 265;
  const lthr = wellness?.lthrFromDevice || config.physiology?.lthr || 172;
  const maxHr = wellness?.maxHrFromDevice || config.physiology?.maxHr || 190;

  // 基于当前 LT 配速推算各强度基准配速 (Jack Daniels 比例近似)
  const easyPaceSec = Math.round(ltPace * 1.24);
  const marathonPaceSec = Math.round(ltPace * 1.07);
  const thresholdPaceSec = ltPace;
  const intervalPaceSec = Math.round(ltPace * 0.91);
  const repPaceSec = Math.round(ltPace * 0.84);

  // 计算距目标赛事周数以确定宏观周期阶段
  let weeksToRace = 12;
  if (config.goal?.raceDate) {
    const diffMs = new Date(config.goal.raceDate).getTime() - Date.now();
    weeksToRace = Math.max(1, Math.ceil(diffMs / (7 * 86400_000)));
  }

  let currentStage = 'Build';
  let stageDisplay = `Build 专项强化期 · 距目标赛事约 ${weeksToRace} 周`;
  if (weeksToRace <= 2) {
    currentStage = 'Taper';
    stageDisplay = `Taper 赛前减量期 · 距赛事仅 ${weeksToRace} 周`;
  } else if (weeksToRace <= 5) {
    currentStage = 'Peak';
    stageDisplay = `Peak 巅峰转化期 · 距赛事 ${weeksToRace} 周`;
  } else if (weeksToRace > 12) {
    currentStage = 'Base';
    stageDisplay = `Base 基础有氧期 · 距赛事 ${weeksToRace} 周`;
  }

  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const forecastDays = envForecast?.daily || [];
  const customDaysMap = customPlan?.days && typeof customPlan.days === 'object' ? customPlan.days : {};
  const paces = { easyPaceSec, marathonPaceSec, thresholdPaceSec, intervalPaceSec, repPaceSec };
  const days = [];
  let customDayCount = 0;

  for (let i = 0; i < 7; i++) {
    const env = forecastDays[i] || null;
    const dateStr =
      env?.date ||
      new Date(Date.now() + i * 86400_000).toISOString().slice(0, 10);
    const dow = new Date(dateStr).getDay();
    const adj = computeEnvironmentalAdjustment(env);
    const scale = 1 + (adj.slowdownPct || 0) / 100;

    // 优先采用 Antigravity 协同定制计划中的对应日期；无定制时回退至周期科学模板
    const customEntry = customDaysMap[dateStr];
    const baseTemplate = customEntry
      ? normalizeCustomDayTemplate(customEntry, { paces, lthr, maxHr })
      : { ...getTemplateForWeekday(dow, currentStage), isCustomPlan: false };
    if (baseTemplate.isCustomPlan) {
      customDayCount += 1;
    }

    const template = applyDailyGuardrails(baseTemplate, {
      isToday: i === 0,
      readiness,
      adj,
      easyPaceSec,
      lthr
    });

    const basePaceStr = template.distanceKm > 0 ? `${formatPace(template.baseSec)}/km` : '--';
    const correctedSec = Math.round(template.baseSec * scale);
    const correctedPaceStr =
      template.distanceKm > 0 ? `${formatPace(correctedSec)}/km` : '--';

    const carbG = Math.round(weightKg * (template.carbFactor || 0.8));
    const proteinG = Math.round(weightKg * 0.3);

    days.push({
      date: dateStr,
      weekday: weekdayNames[dow],
      isCustomPlan: Boolean(template.isCustomPlan),
      type: template.type,
      title: template.title,
      plannedDistanceKm: template.distanceKm,
      plannedDurationMin: template.durationMin,
      estimatedTss: template.tss,
      basePace: basePaceStr,
      correctedPace: correctedPaceStr,
      targetHr: template.hrRange,
      targetCadence: template.cadence,
      rpe: template.rpe,
      envAdjustmentNote: env
        ? `${env.weatherText} ${env.tempC}°C · 湿度${env.humidityPct}% · 露点${env.dewPointC}°C · 风${env.windMs}m/s · 海拔${env.elevationMeters}m → ${adj.summary}`
        : '环境温和',
      warmup: template.warmup,
      mainSetSummary: template.mainSetSummary,
      mainSetDetail: template.mainSetDetail,
      cooldown: template.cooldown,
      nutrition:
        template.nutritionOverride ||
        (template.distanceKm > 0
          ? `跑后 30 分钟内补充碳水 ${carbG}g + 优质蛋白 ${proteinG}g，补水 ${Math.round(template.durationMin * 8)}ml（含电解质钠钾）`
          : '全天保持均衡高蛋白饮食与充分补水（≥ 2000ml），促进肌糖原与神经系统超量恢复'),
      coachTip: template.tip
    });
  }

  function getTemplateForWeekday(dow, stage) {
    if (dow === 1) {
      return {
        type: 'REST',
        title: '完全休息 / 主动恢复日',
        distanceKm: 0,
        durationMin: 25,
        tss: 10,
        baseSec: easyPaceSec,
        hrRange: '静息恢复',
        cadence: '--',
        rpe: '1-2/10',
        warmup: '轻度关节活动',
        mainSetSummary: '停止跑步，进行 20 分钟拉伸、泡沫轴放松与睡前泡脚',
        mainSetDetail: '给周末长距离后疲劳的比目鱼肌、跟腱与中枢神经系统充分修复窗口，重点放松小腿三头肌与足底筋膜。',
        cooldown: '早睡 30 分钟',
        carbFactor: 0.4,
        tip: '恢复本身就是训练的一部分，保证深睡占比。'
      };
    }
    if (dow === 2) {
      return {
        type: 'T',
        title: stage === 'Base' ? '有氧稳态节奏 + 6x100m 加速跑' : '挪威式分段乳酸阈值跑 (Cruise Intervals)',
        distanceKm: 12.0,
        durationMin: 58,
        tss: 78,
        baseSec: thresholdPaceSec,
        hrRange: `${Math.round(lthr * 0.96)}-${Math.round(lthr * 1.01)} bpm (Z4)`,
        cadence: '182-186 spm',
        rpe: '7-8/10',
        warmup: '2.5km 轻松慢跑 + 髋关节激活 + 4组 20 秒渐加速跑',
        mainSetSummary: '4 × 2000m 乳酸阈值配速跑（组间慢跑/站休 90 秒）',
        mainSetDetail: `4 组 × 2000m @ T配速，严格卡在乳酸阈值心率上下，不冲刺抢速度；组间恢复 90 秒慢步/慢跑，保持呼吸 2 步一吸 2 步一呼的节律。`,
        cooldown: '2km Z1 排酸慢跑 + 小腿腓肠肌/比目鱼肌/臀肌静态拉伸 10 分钟',
        carbFactor: 1.0,
        tip: '分段阈值能在极低乳酸堆积下最大化提升乳酸清除率。'
      };
    }
    if (dow === 3) {
      return {
        type: 'E',
        title: '轻松有氧恢复跑 + 跑者专项力量',
        distanceKm: 8.5,
        durationMin: 50,
        tss: 44,
        baseSec: easyPaceSec,
        hrRange: `${Math.round(lthr * 0.75)}-${Math.round(lthr * 0.85)} bpm (Z2)`,
        cadence: '174-180 spm',
        rpe: '4/10',
        warmup: '前 1km 极慢配速过渡，让心率自然爬升',
        mainSetSummary: '8.5km 轻松有氧跑（全程可完整对话）+ 20 分钟单腿稳定性力量',
        mainSetDetail: '全程严守 Zone 2 心率上限，上坡主动降速保心率。跑后完成：保加利亚分腿蹲 3×10/侧、提踵离心训练 3×15、臀桥抗旋 3×12、弹力带侧步走。',
        cooldown: '髋屈肌与腘绳肌拉伸 8 分钟',
        carbFactor: 0.7,
        tip: '切忌在轻松跑日跑进 Zone 3 灰色地带！'
      };
    }
    if (dow === 4) {
      return {
        type: stage === 'Peak' ? 'I' : 'M',
        title: stage === 'Peak' ? 'VO2max 高强度间歇跑 (5x1000m)' : '马拉松目标配速节奏跑 + R 步幅加速',
        distanceKm: 11.5,
        durationMin: 56,
        tss: 74,
        baseSec: stage === 'Peak' ? intervalPaceSec : marathonPaceSec,
        hrRange:
          stage === 'Peak'
            ? `${Math.round(maxHr * 0.91)}-${Math.round(maxHr * 0.96)} bpm (Z5)`
            : `${Math.round(lthr * 0.89)}-${Math.round(lthr * 0.95)} bpm (Z3-Z4)`,
        cadence: '184-190 spm',
        rpe: stage === 'Peak' ? '8.5/10' : '6.5/10',
        warmup: '2.5km E 跑 + 高抬腿/后踢腿/跨步跳等动态热身',
        mainSetSummary:
          stage === 'Peak'
            ? '5 × 1000m VO2max 间歇（组间 400m 慢跑恢复）'
            : '7km M 马拉松配速持续跑 + 4 × 150m R 神经加速跑',
        mainSetDetail:
          stage === 'Peak'
            ? '5 组 × 1000m @ I配速，前两组收着跑，后三组保持步频与摆臂紧凑，组间 2分30秒 慢跑恢复。'
            : `连续 7km 稳定巡航在目标赛事配速，重点感受脚踝弹性反冲与呼吸效率；结束后休息 3 分钟接 4 组 150m 轻快流畅加速跑（@${formatPace(repPaceSec)}/km）。`,
        cooldown: '2km 轻松冷身 + 股四头肌与髂胫束拉伸',
        carbFactor: 1.0,
        tip: '关注触地时间与送髋效率，避免后程垮髋。'
      };
    }
    if (dow === 5) {
      return {
        type: 'STR',
        title: '核心稳态力量 & 交叉恢复日',
        distanceKm: 5.0,
        durationMin: 40,
        tss: 28,
        baseSec: easyPaceSec + 10,
        hrRange: `${Math.round(lthr * 0.72)}-${Math.round(lthr * 0.81)} bpm (Z1-Z2)`,
        cadence: '174-178 spm',
        rpe: '3/10',
        warmup: '动态髋踝灵活度热身 8 分钟',
        mainSetSummary: '5km 极轻松慢跑（或 30 分钟功率车）+ 15 分钟核心稳定性训练',
        mainSetDetail: '今日为周末长距离蓄能。只跑 5km 放松排酸（若腿部酸胀可直接改为 30 分钟低阻力骑行或完全休息），加练平板支撑、死虫式与单腿平衡训练。',
        cooldown: '全身泡沫轴滚压',
        carbFactor: 0.6,
        tip: '保持身体轻盈，为周日长距离储存肌糖原。'
      };
    }
    if (dow === 6) {
      return {
        type: 'E',
        title: '有氧基础耐力跑 + 跑姿唤醒',
        distanceKm: 10.0,
        durationMin: 56,
        tss: 52,
        baseSec: easyPaceSec,
        hrRange: `${Math.round(lthr * 0.77)}-${Math.round(lthr * 0.86)} bpm (Z2)`,
        cadence: '176-182 spm',
        rpe: '4.5/10',
        warmup: '1km 慢跑唤醒',
        mainSetSummary: '9km 稳定有氧基础跑 + 4 × 80m 轻松大步幅加速（Strides）',
        mainSetDetail: '前 9km 保持 Zone 2 舒适有氧输出；最后 1km 插入 4 组 80m 神经肌肉加速跑（每组后走回完全恢复），为明日长距离唤醒快肌纤维。',
        cooldown: '小腿与臀中肌拉伸 10 分钟',
        carbFactor: 0.8,
        tip: '晚间可适当提高碳水比例（碳水加载），提前备好明日补给。'
      };
    }
    // 周日 LSD
    return {
      type: 'LSD',
      title: '周末渐进有氧长距离 (Progressive LSD)',
      distanceKm: stage === 'Taper' ? 14.0 : 20.0,
      durationMin: stage === 'Taper' ? 75 : 110,
      tss: stage === 'Taper' ? 82 : 122,
      baseSec: easyPaceSec - 8,
      hrRange: `${Math.round(lthr * 0.80)}-${Math.round(lthr * 0.90)} bpm (Z2-Z3下沿)`,
      cadence: '176-182 spm',
      rpe: '6/10',
      warmup: '前 3km 较轻松配速慢启动，保护关节滑液分泌',
      mainSetSummary:
        stage === 'Taper'
          ? '14km 轻松有氧长距离，末 3km 提至马拉松配速'
          : '15km 稳定 Z2 有氧巡航 + 最后 5km 渐进提速至 M 配速',
      mainSetDetail: `前 75% 距离保持轻松呼吸节律，每 35–40 分钟补给 1 支能量胶（约 25g 碳水）+ 150ml 含钠运动饮料；最后 5km 在心率不突破 ${Math.round(lthr * 0.94)} bpm 的前提下渐进提速，模拟比赛后半程抗疲劳能力。`,
      cooldown: '慢走 5 分钟 + 冰敷/冷水淋浴下肢 + 全面拉伸 15 分钟',
      carbFactor: 1.2,
      tip: '重点监控后半程有氧解耦率，若心率飘高超预期则主动回调配速。'
    };
  }

  const dec = lastKeyWorkoutAudit?.decoupling;
  const fitWorkoutCritique =
    customPlan?.fitWorkoutCritique?.trim() ||
    (dec
      ? `最近重点长距离 (${lastKeyWorkoutAudit.activity?.name}) 有氧解耦率为 ${dec.decouplingPct}%（${dec.status === 'solid' ? '低于5%，有氧底座扎实' : '略偏高，后半程存在轻微热/疲劳漂移'}），平均步频 ${lastKeyWorkoutAudit.activity?.cadence || '--'} spm，整体配速控制稳定。`
      : '当前样本暂无完整 .FIT 遥测记录，建议下次跑步保持心率带或手表紧贴佩戴，以采集更精确的步幅与解耦数据。');

  const liveMetricsSummary = `当前处于【${customPlan?.macroPhase?.stageDisplay || stageDisplay}】，今日生理准备度 ${readiness.score}/100（${readiness.lightLabel}）。ACWR=${pmc.latest.acwr}、TSB=${pmc.latest.tsb}，近 8 周有氧低强度占比 ${weeklyZones.polarization.lowIntensityPct}%。${readiness.triggers.join('；')}。`;
  const coachNotes = customPlan?.coachNotes?.trim();
  const coachSummary = coachNotes
    ? `${liveMetricsSummary} ｜ 【Antigravity 教练备忘 (${customPlan.updatedAt || '定制周期'})】${coachNotes}`
    : liveMetricsSummary;

  const defaultMacroPhase = {
    currentStage,
    stageDisplay,
    weekFocus:
      currentStage === 'Taper'
        ? '保留神经肌肉敏锐度，削减 35% 跑量以充分超量恢复'
        : '巩固 80/20 极化分布与有氧底座，稳步提升乳酸阈值速度',
    nextDeloadInfo: '每 3 周负荷递增后安排 1 周减量周（跑量下调 30%，ACWR 回落至 0.85–1.05）',
    stages: [
      { key: 'Base', label: '基础有氧期', weeks: 'W1-W4', active: currentStage === 'Base' },
      { key: 'Build', label: '专项强化期', weeks: 'W5-W9', active: currentStage === 'Build' },
      { key: 'Peak', label: '巅峰转化期', weeks: 'W10-W12', active: currentStage === 'Peak' },
      { key: 'Taper', label: '赛前减量期', weeks: 'W13-W14', active: currentStage === 'Taper' }
    ]
  };
  const customMacro = customPlan?.macroPhase && typeof customPlan.macroPhase === 'object' ? customPlan.macroPhase : null;
  const macroPhase = customMacro
    ? {
        ...defaultMacroPhase,
        ...customMacro,
        stages: Array.isArray(customMacro.stages) && customMacro.stages.length > 0 ? customMacro.stages : defaultMacroPhase.stages
      }
    : defaultMacroPhase;

  const hasCustomContent = customDayCount > 0 || Boolean(coachNotes) || Boolean(customMacro);

  return {
    planSource: hasCustomContent ? 'antigravity-custom-plan' : 'deterministic-science-engine',
    customPlanUpdatedAt: customPlan?.updatedAt || null,
    macroPhase,
    coachSummary,
    fitWorkoutCritique,
    days
  };
}
