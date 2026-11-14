import GarminConnectModule from '@likenttt/garmin-connect';
import { parsePaceSecPerKm } from '../science/metrics.js';

const GarminConnect =
  GarminConnectModule.GarminConnect ||
  GarminConnectModule.default?.GarminConnect ||
  GarminConnectModule.default ||
  GarminConnectModule;

const RUNNING_DAY_TYPES = new Set(['E', 'LSD', 'M', 'T', 'I', 'R']);

export function parseHrTargetRange(hrText) {
  if (!hrText) return null;
  const m = String(hrText).match(/(\d{2,3})\s*[-–~]\s*(\d{2,3})\s*bpm/i);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 70 || high > 230 || low >= high) {
    return null;
  }
  return { low, high };
}

export function parseIntervalSpec(text) {
  if (!text) return null;
  const m = String(text).match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(km|公里|m|米)/i);
  if (!m) return null;
  const count = Number(m[1]);
  const rawLen = Number(m[2]);
  const unit = m[3].toLowerCase();
  const meters = unit === 'km' || unit === '公里' ? Math.round(rawLen * 1000) : Math.round(rawLen);
  if (!Number.isFinite(count) || !Number.isFinite(meters) || count < 2 || meters < 30) {
    return null;
  }
  return { count, meters };
}

export function parseRestSeconds(text, fallbackSec = 90) {
  const s = String(text || '');
  const secMatch = s.match(/(?:全休|休|休息|走休|慢跑恢复|恢复)[^\d\n]{0,6}(\d{2,3})\s*(?:秒|s|sec)/i)
    || s.match(/(\d{2,3})\s*s\s*(?:全休|走休|恢复)/i);
  if (secMatch) {
    return Number(secMatch[1]);
  }
  const minMatch = s.match(/(?:全休|休|休息|走休|慢跑恢复|恢复)[^\d\n]{0,6}(\d+(?:\.\d+)?)\s*(?:分钟|分|min)/i);
  if (minMatch) {
    return Math.round(Number(minMatch[1]) * 60);
  }
  return fallbackSec;
}

export function buildPaceSpeedRange(paceStr, tolerancePct = 0.03) {
  const paceSec = parsePaceSecPerKm(paceStr);
  if (!paceSec || paceSec <= 90) return null;
  const fastMs = Math.round((1000 / (paceSec * (1 - tolerancePct))) * 10000) / 10000;
  const slowMs = Math.round((1000 / (paceSec * (1 + tolerancePct))) * 10000) / 10000;
  return { fastMs, slowMs };
}

function stepTypeMeta(stepTypeKey) {
  const map = {
    warmup: { stepTypeId: 1, stepTypeKey: 'warmup', displayOrder: 1 },
    cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown', displayOrder: 2 },
    interval: { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
    recovery: { stepTypeId: 4, stepTypeKey: 'recovery', displayOrder: 4 },
    rest: { stepTypeId: 5, stepTypeKey: 'rest', displayOrder: 5 },
    repeat: { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 }
  };
  return map[stepTypeKey] || map.interval;
}

function endConditionMeta(conditionTypeKey, unitKey = null) {
  const condMap = {
    'lap.button': { conditionTypeId: 1, conditionTypeKey: 'lap.button', displayOrder: 1, displayable: true },
    time: { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true },
    distance: { conditionTypeId: 3, conditionTypeKey: 'distance', displayOrder: 3, displayable: true }
  };
  const unitMap = {
    meter: { unitId: 1, unitKey: 'meter', factor: 100 },
    kilometer: { unitId: 2, unitKey: 'kilometer', factor: 100000 }
  };
  return {
    endCondition: condMap[conditionTypeKey] || condMap['lap.button'],
    preferredEndConditionUnit: unitKey ? unitMap[unitKey] || null : null
  };
}

function targetTypeMeta(targetTypeKey) {
  const map = {
    'no.target': { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target', displayOrder: 1 },
    'heart.rate.zone': { workoutTargetTypeId: 4, workoutTargetTypeKey: 'heart.rate.zone', displayOrder: 4 },
    'pace.zone': { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone', displayOrder: 6 }
  };
  return map[targetTypeKey] || map['no.target'];
}

function makeExecutableStep({
  stepOrder,
  stepTypeKey = 'interval',
  description = null,
  endConditionKey = 'lap.button',
  endConditionValue = null,
  unitKey = null,
  targetTypeKey = 'no.target',
  targetValueOne = null,
  targetValueTwo = null,
  childStepId = null
}) {
  const { endCondition, preferredEndConditionUnit } = endConditionMeta(endConditionKey, unitKey);
  return {
    type: 'ExecutableStepDTO',
    stepId: null,
    stepOrder,
    childStepId,
    description: description ? String(description).slice(0, 200) : null,
    stepType: stepTypeMeta(stepTypeKey),
    endCondition,
    preferredEndConditionUnit,
    endConditionValue: endConditionKey === 'lap.button' ? null : endConditionValue,
    endConditionCompare: null,
    endConditionZone: null,
    targetType: targetTypeMeta(targetTypeKey),
    targetValueOne: targetTypeKey === 'no.target' ? null : targetValueOne,
    targetValueTwo: targetTypeKey === 'no.target' ? null : targetValueTwo,
    zoneNumber: null
  };
}

function makeRepeatGroup({ stepOrder, iterations, childStepId = 1, steps }) {
  return {
    type: 'RepeatGroupDTO',
    stepId: null,
    stepOrder,
    childStepId,
    stepType: stepTypeMeta('repeat'),
    numberOfIterations: iterations,
    smartRepeat: false,
    workoutSteps: steps
  };
}

function formatCompactTitle(day, prefix) {
  const mmdd = String(day.date || '').slice(5, 10);
  const rawTitle = String(day.title || `${day.type} 训练`)
    .replace(/^W\d+\s*周[一二三四五六日天](?:（[^）]*）)?\s*·\s*/i, '')
    .trim();
  return `${prefix} ${mmdd} ${rawTitle}`.slice(0, 60);
}

/**
 * 将单日教练课表转换为 Garmin Connect 原生结构化跑步课表 DTO
 * 非跑步日（REST 或纯力量日）返回 null
 */
export function buildGarminWorkoutFromDay(day, options = {}) {
  const prefix = options.prefix || '[AI]';
  if (!day || !day.date) return null;

  const type = String(day.type || '').toUpperCase();
  const distanceKm = Number(day.plannedDistanceKm ?? day.distanceKm ?? 0);
  if (!RUNNING_DAY_TYPES.has(type) || distanceKm <= 0) {
    return null;
  }

  const hrRange = parseHrTargetRange(day.targetHr || day.hrRange);
  const paceRange = buildPaceSpeedRange(day.correctedPace || day.basePace, type === 'T' ? 0.025 : 0.035);
  const combinedText = `${day.title || ''} ${day.mainSetSummary || ''} ${day.mainSetDetail || ''}`;
  const intervalSpec = parseIntervalSpec(combinedText);
  const totalMeters = Math.round(distanceKm * 1000);

  const steps = [];
  let order = 1;

  if (type === 'E' || type === 'LSD') {
    const hasStrides =
      intervalSpec && intervalSpec.meters <= 150 && intervalSpec.count <= 12 &&
      /strides|加速|神经/i.test(combinedText);

    const stridesTotalM = hasStrides ? intervalSpec.count * intervalSpec.meters : 0;
    const warmupM = totalMeters >= 3500 ? 1000 : 600;
    const mainM = Math.max(500, totalMeters - warmupM - stridesTotalM);

    const warmupHr = hrRange
      ? {
          targetTypeKey: 'heart.rate.zone',
          targetValueOne: Math.max(95, hrRange.low - 10),
          targetValueTwo: Math.max(hrRange.low + 5, hrRange.high - 4)
        }
      : { targetTypeKey: 'no.target', targetValueOne: null, targetValueTwo: null };

    steps.push(
      makeExecutableStep({
        stepOrder: order++,
        stepTypeKey: 'warmup',
        description: day.warmup || '慢启动热身，控制心率平缓爬升',
        endConditionKey: 'distance',
        endConditionValue: warmupM,
        unitKey: 'meter',
        ...warmupHr
      })
    );

    const mainHr = hrRange
      ? {
          targetTypeKey: 'heart.rate.zone',
          targetValueOne: hrRange.low,
          targetValueTwo: hrRange.high
        }
      : { targetTypeKey: 'no.target', targetValueOne: null, targetValueTwo: null };

    steps.push(
      makeExecutableStep({
        stepOrder: order++,
        stepTypeKey: 'interval',
        description: day.mainSetSummary || '极化低强度有氧，严守 LT1 上限',
        endConditionKey: 'distance',
        endConditionValue: mainM,
        unitKey: 'meter',
        ...mainHr
      })
    );

    if (hasStrides) {
      const restSec = parseRestSeconds(combinedText, 90);
      const groupOrder = order++;
      const repStepOrder = order++;
      const recStepOrder = order++;
      steps.push(
        makeRepeatGroup({
          stepOrder: groupOrder,
          iterations: intervalSpec.count,
          steps: [
            makeExecutableStep({
              stepOrder: repStepOrder,
              childStepId: 1,
              stepTypeKey: 'interval',
              description: `流畅加速 ${intervalSpec.meters}m（不看心率，重步频与放松折叠）`,
              endConditionKey: 'distance',
              endConditionValue: intervalSpec.meters,
              unitKey: 'meter',
              targetTypeKey: 'no.target'
            }),
            makeExecutableStep({
              stepOrder: recStepOrder,
              childStepId: 1,
              stepTypeKey: 'recovery',
              description: `走回完全恢复 ${restSec} 秒`,
              endConditionKey: 'time',
              endConditionValue: restSec,
              targetTypeKey: 'no.target'
            })
          ]
        })
      );
    }

    steps.push(
      makeExecutableStep({
        stepOrder: order++,
        stepTypeKey: 'cooldown',
        description: day.cooldown || '慢走冷身 + 靠墙静蹲与拉伸',
        endConditionKey: 'lap.button',
        targetTypeKey: 'no.target'
      })
    );
  } else {
    // 质量课 / 间歇 / 阈值 / 测试日 (T / I / R / M)
    steps.push(
      makeExecutableStep({
        stepOrder: order++,
        stepTypeKey: 'warmup',
        description: day.warmup || '慢跑热身 + 动态技术 Drills，就位后按计圈键进入主课',
        endConditionKey: 'lap.button',
        targetTypeKey: 'no.target'
      })
    );

    if (intervalSpec) {
      const defaultRest = type === 'R' || intervalSpec.meters <= 200 ? 120 : type === 'I' ? 150 : 90;
      const restSec = parseRestSeconds(combinedText, defaultRest);
      const isShortSprint = type === 'R' || intervalSpec.meters <= 250;
      const repTarget = !isShortSprint && paceRange
        ? {
            targetTypeKey: 'pace.zone',
            targetValueOne: paceRange.fastMs,
            targetValueTwo: paceRange.slowMs
          }
        : !isShortSprint && hrRange
          ? {
              targetTypeKey: 'heart.rate.zone',
              targetValueOne: hrRange.low,
              targetValueTwo: hrRange.high
            }
          : { targetTypeKey: 'no.target', targetValueOne: null, targetValueTwo: null };

      const groupOrder = order++;
      const repStepOrder = order++;
      const recStepOrder = order++;
      steps.push(
        makeRepeatGroup({
          stepOrder: groupOrder,
          iterations: intervalSpec.count,
          steps: [
            makeExecutableStep({
              stepOrder: repStepOrder,
              childStepId: 1,
              stepTypeKey: 'interval',
              description: isShortSprint
                ? `高速分段 ${intervalSpec.meters}m（看秒表与跑姿质量，不追心率）`
                : day.mainSetSummary || `间歇 ${intervalSpec.meters}m`,
              endConditionKey: 'distance',
              endConditionValue: intervalSpec.meters,
              unitKey: 'meter',
              ...repTarget
            }),
            makeExecutableStep({
              stepOrder: recStepOrder,
              childStepId: 1,
              stepTypeKey: 'recovery',
              description: `恢复 ${restSec} 秒`,
              endConditionKey: 'time',
              endConditionValue: restSec,
              targetTypeKey: 'no.target'
            })
          ]
        })
      );
    } else {
      const explicitDistMatch = combinedText.match(/(\d{3,4})\s*m(?:评估|测试|计时|稳态)/i);
      const mainMeters = explicitDistMatch ? Number(explicitDistMatch[1]) : Math.max(800, totalMeters - 1500);
      const mainTarget = hrRange
        ? {
            targetTypeKey: 'heart.rate.zone',
            targetValueOne: hrRange.low,
            targetValueTwo: hrRange.high
          }
        : paceRange
          ? {
              targetTypeKey: 'pace.zone',
              targetValueOne: paceRange.fastMs,
              targetValueTwo: paceRange.slowMs
            }
          : { targetTypeKey: 'no.target', targetValueOne: null, targetValueTwo: null };

      steps.push(
        makeExecutableStep({
          stepOrder: order++,
          stepTypeKey: 'interval',
          description: day.mainSetSummary || day.title,
          endConditionKey: 'distance',
          endConditionValue: mainMeters,
          unitKey: 'meter',
          ...mainTarget
        })
      );
    }

    steps.push(
      makeExecutableStep({
        stepOrder: order++,
        stepTypeKey: 'cooldown',
        description: day.cooldown || '慢跑冷身 + 拉伸放松',
        endConditionKey: 'lap.button',
        targetTypeKey: 'no.target'
      })
    );
  }

  const noteParts = [day.mainSetSummary, day.coachTip].filter(Boolean).join(' ｜ ');

  return {
    workoutName: formatCompactTitle(day, prefix),
    description: noteParts.slice(0, 480) || 'Antigravity 800m Coach 周期化课表',
    sportType: { sportTypeId: 1, sportTypeKey: 'running', displayOrder: 1 },
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: { sportTypeId: 1, sportTypeKey: 'running', displayOrder: 1 },
        workoutSteps: steps
      }
    ]
  };
}

export async function createGarminWriteSession({ region = 'cn', email, password, sessionJson } = {}) {
  const domain = region === 'cn' ? 'garmin.cn' : 'garmin.com';
  const gc = new GarminConnect(
    email && password ? { username: email, password } : undefined,
    domain
  );

  if (sessionJson) {
    try {
      const tokens = typeof sessionJson === 'string' ? JSON.parse(sessionJson) : sessionJson;
      if (tokens?.oauth1 && tokens?.oauth2) {
        gc.loadToken(tokens.oauth1, tokens.oauth2);
        await gc.getWorkouts(0, 1);
        return { gc, tokens: gc.exportToken(), reusedSession: true };
      }
    } catch {
      // Session 过期或无效，回退到账密登录
    }
  }

  if (!email || !password) {
    throw new Error('缺少 Garmin 写入凭据：请配置 GARMIN_SESSION_JSON 或 GARMIN_EMAIL + GARMIN_PASSWORD');
  }

  await gc.login(email, password);
  return { gc, tokens: gc.exportToken(), reusedSession: false };
}

/**
 * 将未来 N 天内的跑步课表幂等写入 Garmin Connect 训练库并排期到训练日历
 */
export async function syncCoachWorkoutsToGarmin(coachPlan, options = {}) {
  const daysLimit = Math.max(1, Number(options.days || 5));
  const prefix = options.prefix || '[AI]';
  const dryRun = Boolean(options.dryRun);
  const allDays = Array.isArray(coachPlan?.days) ? coachPlan.days : [];
  const windowDays = options.date
    ? allDays.filter((d) => d.date === options.date)
    : allDays.slice(0, daysLimit);

  const built = windowDays.map((day) => ({
    day,
    mmdd: String(day.date || '').slice(5, 10),
    workout: buildGarminWorkoutFromDay(day, { prefix })
  }));

  if (dryRun) {
    return {
      dryRun: true,
      synced: built.filter((x) => x.workout).map((x) => ({
        date: x.day.date,
        workoutName: x.workout.workoutName,
        stepsCount: x.workout.workoutSegments[0].workoutSteps.length
      })),
      skipped: built.filter((x) => !x.workout).map((x) => ({ date: x.day.date, type: x.day.type }))
    };
  }

  const { gc, tokens, reusedSession } = await createGarminWriteSession(options.auth || {});
  const existing = (await gc.getWorkouts(0, 100)) || [];
  const targetMmdds = new Set(built.map((x) => x.mmdd).filter(Boolean));

  // 清理当前同步窗口内旧的同前缀课表（含当天因红灯熔断由跑步转为休息的日期）
  let deletedCount = 0;
  for (const w of existing) {
    const name = String(w?.workoutName || '');
    if (!name.startsWith(prefix)) continue;
    const tagMatch = name.slice(prefix.length).trim().match(/^(\d{2}-\d{2})\b/);
    if (tagMatch && targetMmdds.has(tagMatch[1])) {
      await gc.deleteWorkout({ workoutId: String(w.workoutId) });
      deletedCount += 1;
    }
  }

  const synced = [];
  const skipped = [];

  for (const item of built) {
    if (!item.workout) {
      skipped.push({ date: item.day.date, type: item.day.type });
      continue;
    }
    const created = await gc.addWorkout(item.workout);
    if (!created?.workoutId) {
      throw new Error(`创建课表失败：${item.workout.workoutName}`);
    }
    const scheduled = await gc.client.post(
      `${gc.url.GC_API}/workout-service/schedule/${created.workoutId}`,
      { date: item.day.date }
    );
    synced.push({
      date: item.day.date,
      workoutId: created.workoutId,
      workoutScheduleId: scheduled?.workoutScheduleId ?? null,
      workoutName: created.workoutName
    });
  }

  return {
    dryRun: false,
    reusedSession,
    deletedCount,
    synced,
    skipped,
    sessionTokens: tokens
  };
}
