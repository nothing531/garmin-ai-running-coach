import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateReadiness,
  computePmcSeries,
  computeWeeklyAndZones,
  computeEnvironmentalAdjustment
} from '../src/science/metrics.js';
import { summarizeCheckinSignals, normalizeCheckinEntry } from '../src/storage/checkins.js';
import { buildDeterministicCoachPlan } from '../src/coach/planner.js';
import {
  classifyWorkoutLoad,
  compileStepsToMetrics,
  reduceWorkoutConsistent,
  validateAndFinalizePlan,
  validateStepsSchema,
  determineEffective800mStage
} from '../src/coach/planRules.js';
import { buildGarminWorkoutFromDay, syncCoachWorkoutsToGarmin } from '../src/garmin/workoutSync.js';
import { buildOfflineWeatherFallback, runCoachPipeline } from '../src/index.js';
import { renderDashboardHtml } from '../src/render/dashboard.js';
import { runWorkoutSyncCli } from '../scripts/sync-workouts.js';

test('验收1：数据全部缺失、部分缺失或过期时，不出现虚假健康判断', () => {
  const empty = evaluateReadiness({}, {});
  assert.equal(empty.light, 'insufficient_data');
  assert.equal(empty.score, null);
  assert.ok(empty.lightLabel.includes('数据不足'));
  assert.ok(!empty.triggers.some((t) => t.includes('理想区间')));

  const partialBaselineOnly = evaluateReadiness(
    {
      date: '2026-11-17',
      hrvToday: 60,
      hrv7dAvg: 60,
      rhrToday: 52,
      rhr7dAvg: 52,
      provenance: {
        hrv: { source: 'missing', date: null },
        rhr: { source: 'config_baseline', date: null },
        sleep: { source: 'measured', date: '2026-11-17' },
        bodyBattery: { source: 'missing', date: null }
      },
      sleepScore: 88
    },
    { acwr: 1.0, ctl: 20 }
  );
  assert.equal(partialBaselineOnly.light, 'insufficient_data');
  assert.equal(partialBaselineOnly.score, null);
  assert.equal(partialBaselineOnly.dataQuality.availableSignals, 1);

  const expired = evaluateReadiness(
    {
      date: '2026-11-17',
      hrvToday: 62,
      hrv7dAvg: 60,
      rhrToday: 50,
      rhr7dAvg: 51,
      sleepScore: 86,
      bodyBatteryMorning: 88,
      provenance: {
        hrv: { source: 'measured', date: '2026-11-14' },
        rhr: { source: 'measured', date: '2026-11-14' },
        sleep: { source: 'measured', date: '2026-11-14' },
        bodyBattery: { source: 'measured', date: '2026-11-14' }
      }
    },
    { acwr: 1.0, ctl: 20 },
    { expectedDate: '2026-11-17' }
  );
  assert.equal(expired.light, 'insufficient_data');
  assert.equal(expired.score, null);
  assert.equal(expired.dataQuality.expiredFields.length, 4);

  // ACWR > 1.35 不应单独触发红灯停课（尤其 CTL < 10 时不误报）
  const acwrOnlyLowCtl = evaluateReadiness(
    { hrvToday: 62, hrv7dAvg: 60, rhrToday: 50, rhr7dAvg: 51, sleepScore: 86, bodyBatteryMorning: 85 },
    { acwr: 1.6, ctl: 2.0 }
  );
  assert.equal(acwrOnlyLowCtl.light, 'green');
  assert.ok(acwrOnlyLowCtl.advisories.some((a) => a.includes('CTL')));
});

test('验收2：课表与休息/疼痛限制冲突或连续高强度课程时，最终检查能拦截修复', () => {
  const todayStr = '2026-11-17';
  const envForecast = {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 8,
      humidityPct: 40,
      dewPointC: -2,
      windMs: 2,
      usAqi: 40,
      elevationMeters: 1690
    }))
  };
  const aiDays = envForecast.daily.map((d, idx) => ({
    date: d.date,
    type: idx === 0 ? 'I' : idx === 1 ? 'T' : idx === 2 ? 'I' : 'E',
    title: idx === 0 ? '4×800m VO2max 间歇' : idx === 1 ? '连日阈值 T 跑' : '轻松跑',
    plannedDistanceKm: 6.2,
    plannedDurationMin: 36,
    basePace: '3:50/km',
    steps: idx === 0
      ? [
          { kind: 'warmup', distanceKm: 1.5, durationMin: 9 },
          { kind: 'interval', reps: 4, distanceMeters: 800, pace: '3:50/km', restSec: 150 },
          { kind: 'cooldown', distanceKm: 1.5, durationMin: 9 }
        ]
      : undefined
  }));

  const signalsPain = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({
        date: todayStr,
        status: 'completed',
        rpe: 6,
        painLevel: 4,
        painAreas: ['跟腱/足底'],
        injuryActionImpact: 'altered_form'
      })
    ],
    todayStr
  );

  // 1) 疼痛限制 + Base 阶段拦截：Day 0 强制 REST 0km，Day 1 不允许留存 T 阈值课，且不自动诊断 ITBS 或开靠墙静蹲
  const baseStageInfo = determineEffective800mStage({ config: { physiology: { ltPaceSecPerKm: 285 } }, pmcLatest: { ctl: 18 }, weeklyZones: { weekly: [] }, checkinSignals: signalsPain });
  const checkedPain = validateAndFinalizePlan(aiDays, {
    todayStr,
    readiness: { light: 'green', score: 85, triggers: [] },
    checkinSignals: signalsPain,
    envForecast,
    stageInfo: baseStageInfo,
    config: { physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });

  assert.equal(checkedPain.days[0].type, 'REST');
  assert.equal(checkedPain.days[0].plannedDistanceKm, 0);
  assert.ok(!checkedPain.days[0].mainSetDetail.includes('ITBS'));
  assert.ok(!checkedPain.days[0].mainSetDetail.includes('靠墙静蹲'));
  assert.notEqual(checkedPain.days[1].type, 'T');

  // 2) 健康 Peak 阶段 + 单变量进阶允许条件下，Day 1 (T) 与 Day 2 (I) 连续高强度冲突仍被自动修复
  const verifiedSignals = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-10', status: 'completed', rpe: 5, paceDropoffPct: 1.0, formStatus: 'stable', nextDayReaction: 'fresh' }),
      normalizeCheckinEntry({ date: '2026-11-12', status: 'completed', rpe: 6, actualDistanceKm: 5.0, formStatus: 'stable', nextDayReaction: 'normal_soreness' }),
      normalizeCheckinEntry({ date: '2026-11-15', status: 'completed', rpe: 6, actualDistanceKm: 6.0, paceDropoffPct: 1.5, nextDayReaction: 'fresh' })
    ],
    todayStr
  );
  const peakRaceDate = new Date(Date.parse(`${todayStr}T00:00:00Z`) + 56 * 86400_000).toISOString().slice(0, 10);
  const peakStageInfo = determineEffective800mStage({
    config: { goal: { raceDate: peakRaceDate }, physiology: { ltPaceSecPerKm: 285 } },
    pmcLatest: { ctl: 18 },
    weeklyZones: { weekly: [{ distanceKm: 22 }, { distanceKm: 23 }, { distanceKm: 24 }, { distanceKm: 24 }] },
    checkinSignals: verifiedSignals
  });
  assert.equal(peakStageInfo.currentStage, 'Peak');
  const healthyConflictInput = aiDays.map((d, idx) =>
    idx === 0 ? { date: d.date, type: 'REST', title: '赛前周中纯休息日', plannedDistanceKm: 0 } : d
  );
  const checkedHealthyConflict = validateAndFinalizePlan(healthyConflictInput, {
    todayStr,
    readiness: { light: 'green', score: 85, triggers: [] },
    checkinSignals: verifiedSignals,
    envForecast,
    stageInfo: peakStageInfo,
    config: { physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });
  assert.equal(checkedHealthyConflict.days[1].type, 'T');
  assert.equal(checkedHealthyConflict.days[2].type, 'E');
  assert.ok(checkedHealthyConflict.validationReport.repairsCount >= 1);
});

test('验收3：减量后课程步骤、摘要、总距离、时长及 Garmin 同步组数完全一致', () => {
  const original = {
    date: '2026-11-18',
    type: 'I',
    title: 'VO2-LONG 800m 长间歇',
    plannedDistanceKm: 5.7,
    plannedDurationMin: 35,
    estimatedTss: 60,
    basePace: '3:55/km',
    correctedPace: '4:02/km',
    targetHr: '175-188 bpm',
    steps: [
      { kind: 'warmup', distanceKm: 1.5, durationMin: 9, description: '轻松跑热身' },
      { kind: 'interval', reps: 4, distanceMeters: 800, pace: '3:55/km', restSec: 150, restType: 'walk', description: '800m 长间歇' },
      { kind: 'cooldown', distanceKm: 1.0, durationMin: 6, description: '慢跑冷身' }
    ]
  };

  const reduced = reduceWorkoutConsistent(original, {
    factor: 0.75,
    reason: '黄灯 HRV 处于基线下沿',
    easyPaceSec: 360,
    lthr: 183
  });

  assert.equal(reduced.steps[1].reps, 3);
  assert.equal(reduced.plannedDistanceKm, 4.9); // 1.5 + 3*0.8 + 1.0 = 4.9km
  assert.ok(reduced.mainSetSummary.includes('3×800m'));
  assert.ok(!reduced.mainSetSummary.includes('4×800m'));
  assert.ok(reduced.mainSetDetail.includes('3×800m'));
  assert.ok(!reduced.mainSetDetail.includes('4×800m'));
  assert.ok(reduced.reductionMeta.actualReductionPct > 0);

  const garminWorkout = buildGarminWorkoutFromDay(reduced);
  const repeatGroup = garminWorkout.workoutSegments[0].workoutSteps.find((s) => s.type === 'RepeatGroupDTO');
  assert.equal(repeatGroup.numberOfIterations, 3);

  // 无法拆分的复合文本课程在降量时应被干净替换为可验证替代课
  const legacyComplex = {
    date: '2026-11-18',
    type: 'T',
    title: '复杂文本力量与间歇混合课',
    plannedDistanceKm: 8.0,
    plannedDurationMin: 60,
    mainSetSummary: '深蹲 4x8 + 跑 5km',
    mainSetDetail: '1) 杠铃深蹲 50kg × 4×8；2) 间歇跑若干组'
  };
  const safeReplaced = reduceWorkoutConsistent(legacyComplex, { factor: 0.75, reason: '黄灯' });
  assert.equal(safeReplaced.reductionMeta.replacedWithVerifiableFallback, true);
  assert.ok(!safeReplaced.mainSetDetail.includes('杠铃深蹲'));
  assert.equal(safeReplaced.plannedDistanceKm, 3.5);
});

test('验收4：陈旧疲劳记录不触发今日疲劳，持续伤病未明确恢复前不无依据消失', () => {
  const todayStr = '2026-11-17';
  const entries = [
    // 12 天前高疲劳 + 持续伤病
    normalizeCheckinEntry({
      date: '2026-11-05',
      status: 'completed',
      rpe: 9,
      painLevel: 4,
      painAreas: ['跟腱/足底'],
      injuryStatus: 'active',
      injuryActionImpact: 'altered_form',
      diary: '11-05 跟腱痛'
    }),
    // 10 天前又一次高 RPE
    normalizeCheckinEntry({
      date: '2026-11-07',
      status: 'completed',
      rpe: 8,
      painLevel: 0,
      diary: '11-07 很累但休息了'
    })
  ];

  const signals = summarizeCheckinSignals(entries, todayStr);
  // 陈旧 RPE 9 / RPE 8 已经超过 48-72h 窗口，不能再触发今日疲劳
  assert.equal(signals.highRpeLoad, false);
  // 但 11-05 未标记 resolved 的跟腱伤病必须仍然保留保护！
  assert.equal(signals.persistentInjuries.length, 1);
  assert.equal(signals.persistentInjuries[0].area, '跟腱/足底');
  assert.equal(signals.painAlert, true);

  // 仅当用户明确标记 injuryStatus='resolved' 才解除
  const resolvedSignals = summarizeCheckinSignals(
    [
      ...entries,
      normalizeCheckinEntry({
        date: '2026-11-17',
        status: 'completed',
        rpe: 4,
        painLevel: 0,
        painAreas: ['跟腱/足底'],
        injuryStatus: 'resolved'
      })
    ],
    todayStr
  );
  assert.equal(resolvedSignals.persistentInjuries.length, 0);
  assert.equal(resolvedSignals.painAlert, false);
});

test('验收5：缺少定制课表时，备用课程严格符合当前 800m 阶段（不再出现 20km LSD / 4x2000m）', () => {
  const config = {
    timezone: 'Asia/Shanghai',
    goal: { eventName: '800m Sub-2:01', targetTime: '00:02:01', raceDate: '2027-01-05' },
    physiology: { maxHr: 203, restingHrBaseline: 52, lthr: 183, ltPaceSecPerKm: 285, weightKg: 67 }
  };
  const pmc = computePmcSeries([], config.physiology, 14); // CTL = 0
  const weeklyZones = computeWeeklyAndZones([], config.physiology);
  const wellness = { date: '2026-11-17', hrvToday: 62, hrv7dAvg: 60, rhrToday: 51, rhr7dAvg: 52, sleepScore: 86, bodyBatteryMorning: 88 };
  const readiness = evaluateReadiness(wellness, pmc.latest);
  const envForecast = {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 6,
      humidityPct: 40,
      dewPointC: -4,
      windMs: 2,
      usAqi: 50,
      elevationMeters: 1690
    }))
  };

  const plan = buildDeterministicCoachPlan(
    { readiness, pmc, weeklyZones, wellness, envForecast, lastKeyWorkoutAudit: null, customPlan: null, checkins: [] },
    config
  );

  assert.equal(plan.planSource, 'deterministic-science-engine');
  assert.equal(plan.macroPhase.currentStage, 'Base');
  assert.ok(plan.days.every((d) => d.plannedDistanceKm <= 6.5));
  assert.ok(plan.days.every((d) => !d.mainSetSummary.includes('2000m') && !d.title.includes('马拉松')));
});

test('回归1：疼痛 5/10 时，标为 STR 的「5km 跑步＋力量」仍必须按实际负荷被拦截', () => {
  const todayStr = '2026-11-17';
  const envForecast = {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 8,
      humidityPct: 40,
      dewPointC: -2,
      windMs: 2,
      usAqi: 40,
      elevationMeters: 1690
    }))
  };
  const signalsPain5 = summarizeCheckinSignals(
    [normalizeCheckinEntry({ date: todayStr, status: 'completed', rpe: 6, painLevel: 5, painAreas: ['左膝'] })],
    todayStr
  );
  const disguisedDays = envForecast.daily.map((d, idx) => ({
    date: d.date,
    type: idx === 0 ? 'STR' : 'REST',
    title: idx === 0 ? '5km 跑步＋力量' : '休息',
    plannedDistanceKm: idx === 0 ? 5 : 0,
    plannedDurationMin: 45,
    mainSetSummary: idx === 0 ? '5km 跑步＋杠铃深蹲 4×8' : '休息',
    steps: idx === 0
      ? [
          { kind: 'steady', distanceKm: 5.0, pace: '5:30/km', description: '5km 跑步' },
          { kind: 'strength', durationMin: 15, description: '杠铃深蹲 4×8' }
        ]
      : undefined
  }));

  const stageInfo = determineEffective800mStage({ config: {}, pmcLatest: { ctl: 12 }, weeklyZones: { weekly: [] } });
  const res = validateAndFinalizePlan(disguisedDays, {
    todayStr,
    readiness: { light: 'green', score: 90, triggers: [] },
    checkinSignals: signalsPain5,
    envForecast,
    stageInfo,
    config: { physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });

  assert.equal(res.days[0].type, 'REST');
  assert.equal(res.days[0].plannedDistanceKm, 0);
  assert.ok(res.days[0].title.includes('疼痛保护'));
  assert.ok(res.validationReport.repairsCount >= 1);
});

test('回归2：旧缓存 (11-14) 在真实当前日期 (11-17) 运行时，不得判绿灯且课表必须从 11-17 开始', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-stale-cache-'));
  try {
    await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'data', 'private'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'config', 'runner.config.json'),
      JSON.stringify({
        runnerName: 'Stale Cache Test',
        timezone: 'Asia/Shanghai',
        location: { city: 'Lanzhou', cityDisplay: '兰州', latitude: 35.94, longitude: 104.14, elevationMeters: 1690 },
        goal: { eventName: '800m', targetTime: '00:02:01', raceDate: '2027-05-15' },
        physiology: { maxHr: 203, restingHrBaseline: 52, lthr: 183, ltPaceSecPerKm: 285, weightKg: 67 }
      }),
      'utf8'
    );
    await fs.writeFile(
      path.join(tmpDir, 'data', 'private', 'telemetry-cache.json'),
      JSON.stringify({
        cachedAt: '2026-11-14T04:00:00.000Z',
        garmin: {
          source: 'garmin_personal_api',
          activities: [],
          lastKeyWorkoutAudit: null,
          wellness: {
            date: '2026-11-14',
            hrvToday: 72,
            hrv7dAvg: 60,
            rhrToday: 49,
            rhr7dAvg: 52,
            sleepScore: 95,
            bodyBatteryMorning: 100,
            provenance: {
              hrv: { source: 'measured', date: '2026-11-14' },
              rhr: { source: 'measured', date: '2026-11-14' },
              sleep: { source: 'measured', date: '2026-11-14' },
              bodyBattery: { source: 'measured', date: '2026-11-14' }
            }
          }
        },
        envForecast: {
          location: { city: '兰州', elevationMeters: 1690 },
          today: { date: '2026-11-14', weatherText: '晴', tempC: 10, humidityPct: 40, dewPointC: 0, windMs: 2, usAqi: 40, elevationMeters: 1690 },
          daily: Array.from({ length: 7 }, (_, i) => ({
            date: `2026-11-${14 + i}`,
            weatherText: '晴',
            tempC: 10,
            humidityPct: 40,
            dewPointC: 0,
            windMs: 2,
            usAqi: 40,
            elevationMeters: 1690
          }))
        }
      }),
      'utf8'
    );

    const payload = await runCoachPipeline({
      rootDir: tmpDir,
      skipNetworkFetch: true,
      skipNotify: true,
      now: new Date('2026-11-17T08:00:00Z')
    });

    assert.equal(payload.readiness.light, 'insufficient_data');
    assert.equal(payload.readiness.score, null);
    assert.equal(payload.readiness.dataQuality.expiredFields.length, 4);
    assert.equal(payload.coachPlan.days[0].date, '2026-11-17');
    assert.equal(payload.coachPlan.days[6].date, '2026-11-23');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('回归3：数据不足将高强度间歇降级为 E 时，绝不保留 3x800m / 3:30/km / 180-190bpm', () => {
  const todayStr = '2026-11-17';
  const envForecast = {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 8,
      humidityPct: 40,
      dewPointC: -2,
      windMs: 2,
      usAqi: 40,
      elevationMeters: 1690
    }))
  };
  const aiDays = envForecast.daily.map((d, idx) => ({
    date: d.date,
    type: idx === 0 ? 'I' : 'E',
    title: idx === 0 ? '4×800m @ 3:30/km' : '轻松跑',
    basePace: idx === 0 ? '3:30/km' : '6:00/km',
    targetHr: idx === 0 ? '180-190 bpm' : '<= 150 bpm',
    steps: idx === 0
      ? [
          { kind: 'warmup', distanceKm: 1.5, durationMin: 9 },
          { kind: 'interval', reps: 4, distanceMeters: 800, pace: '3:30/km', restSec: 150 },
          { kind: 'cooldown', distanceKm: 1.0, durationMin: 6 }
        ]
      : [{ kind: 'steady', distanceKm: 3.5, pace: '6:00/km' }]
  }));

  const stageInfo = determineEffective800mStage({ config: { physiology: { ltPaceSecPerKm: 285 } }, pmcLatest: { ctl: 18 }, weeklyZones: { weekly: [] } });
  const res = validateAndFinalizePlan(aiDays, {
    todayStr,
    readiness: { light: 'insufficient_data', score: null, triggers: ['数据不足'] },
    checkinSignals: summarizeCheckinSignals([], todayStr),
    envForecast,
    stageInfo,
    config: { physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });

  const d0 = res.days[0];
  assert.equal(d0.type, 'E');
  assert.ok(!d0.mainSetSummary.includes('800m'));
  assert.ok(!d0.mainSetDetail.includes('800m'));
  assert.ok(!d0.basePace.includes('3:30'));
  assert.ok(!d0.targetHr.includes('180-190'));
  assert.ok(d0.steps.every((s) => s.kind !== 'interval'));
});

test('回归4：结构化步骤存在负距离等非法输入时被明确拦截，绝不输出 -8km 且标出输入非法', () => {
  const badSteps = [{ kind: 'steady', distanceKm: -8 }];
  assert.equal(validateStepsSchema(badSteps).valid, false);
  assert.equal(compileStepsToMetrics(badSteps), null);

  const todayStr = '2026-11-17';
  const envForecast = {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 8,
      humidityPct: 40,
      dewPointC: -2,
      windMs: 2,
      usAqi: 40,
      elevationMeters: 1690
    }))
  };
  const aiDays = envForecast.daily.map((d, idx) => ({
    date: d.date,
    type: 'E',
    title: idx === 0 ? '非法负距离测试' : '轻松跑',
    plannedDistanceKm: idx === 0 ? -8 : 3.5,
    steps: idx === 0 ? badSteps : [{ kind: 'steady', distanceKm: 3.5, pace: '6:00/km' }]
  }));

  const stageInfo = determineEffective800mStage({ config: {}, pmcLatest: { ctl: 0 }, weeklyZones: { weekly: [] } });
  const res = validateAndFinalizePlan(aiDays, {
    todayStr,
    readiness: { light: 'green', score: 86, triggers: [] },
    checkinSignals: summarizeCheckinSignals([], todayStr),
    envForecast,
    stageInfo,
    config: { physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });

  assert.ok(res.days[0].plannedDistanceKm >= 0);
  assert.equal(res.validationReport.inputValid, false);
  assert.ok(res.validationReport.inputErrorsCount >= 1);
  assert.ok(res.validationReport.repairs.some((r) => r.includes('结构化步骤非法')));
});

test('回归5：steps 为 4×800m 但摘要和详单写 9×800m 时，终检按已校验 steps 重写且不放行矛盾文案', () => {
  const todayStr = '2026-11-17';
  const envForecast = {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 8,
      humidityPct: 40,
      dewPointC: -2,
      windMs: 2,
      usAqi: 40,
      elevationMeters: 1690
    }))
  };
  const aiDays = envForecast.daily.map((d, idx) => ({
    date: d.date,
    type: idx === 0 ? 'I' : 'E',
    title: '间歇课',
    plannedDistanceKm: 9.2,
    mainSetSummary: idx === 0 ? '9×800m @ 3:50/km' : '轻松跑',
    mainSetDetail: idx === 0 ? '1) 主间歇: 9×800m @ 3:50/km' : '轻松跑',
    steps: idx === 0
      ? [
          { kind: 'warmup', distanceKm: 1.2, durationMin: 7 },
          { kind: 'interval', reps: 4, distanceMeters: 800, pace: '3:50/km', restSec: 150 },
          { kind: 'cooldown', distanceKm: 0.8, durationMin: 5 }
        ]
      : [{ kind: 'steady', distanceKm: 3.5, pace: '6:00/km' }]
  }));

  const verifiedPeakSignals = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-10', status: 'completed', rpe: 5, paceDropoffPct: 1.0, formStatus: 'stable', nextDayReaction: 'fresh' }),
      normalizeCheckinEntry({ date: '2026-11-12', status: 'completed', rpe: 6, actualDistanceKm: 5.0, formStatus: 'stable', nextDayReaction: 'normal_soreness' }),
      normalizeCheckinEntry({ date: '2026-11-15', status: 'completed', rpe: 6, actualDistanceKm: 6.0, paceDropoffPct: 1.2, nextDayReaction: 'fresh' })
    ],
    todayStr
  );
  const peakRaceDate = new Date(Date.parse(`${todayStr}T00:00:00Z`) + 56 * 86400_000).toISOString().slice(0, 10);
  const stageInfo = determineEffective800mStage({
    config: { goal: { raceDate: peakRaceDate }, physiology: { ltPaceSecPerKm: 285 } },
    pmcLatest: { ctl: 18 },
    weeklyZones: { weekly: [{ distanceKm: 22 }, { distanceKm: 23 }, { distanceKm: 24 }, { distanceKm: 24 }] },
    checkinSignals: verifiedPeakSignals
  });
  const res = validateAndFinalizePlan(aiDays, {
    todayStr,
    readiness: { light: 'green', score: 86, triggers: [] },
    checkinSignals: verifiedPeakSignals,
    envForecast,
    stageInfo,
    config: { physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });

  assert.equal(res.days[0].plannedDistanceKm, 5.2); // 1.2 + 3.2 + 0.8
  assert.ok(res.days[0].mainSetSummary.includes('4×800m'));
  assert.ok(!res.days[0].mainSetSummary.includes('9×800m'));
  assert.ok(!res.days[0].mainSetDetail.includes('9×800m'));
  assert.ok(res.validationReport.repairsCount >= 1);
});

test('回归6：连续训练保护覆盖重深蹲，拦截「间歇 → 重深蹲 → 间歇」连续下肢大负荷', () => {
  const todayStr = '2026-11-17';
  const envForecast = {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 8,
      humidityPct: 40,
      dewPointC: -2,
      windMs: 2,
      usAqi: 40,
      elevationMeters: 1690
    }))
  };
  const aiDays = envForecast.daily.map((d, idx) => {
    if (idx === 0 || idx === 2) {
      return {
        date: d.date,
        type: 'I',
        title: '间歇跑 4×800m',
        steps: [
          { kind: 'warmup', distanceKm: 1.0, durationMin: 6 },
          { kind: 'interval', reps: 4, distanceMeters: 800, pace: '3:50/km', restSec: 150 },
          { kind: 'cooldown', distanceKm: 1.0, durationMin: 6 }
        ]
      };
    }
    if (idx === 1) {
      return {
        date: d.date,
        type: 'STR',
        title: '健身房重深蹲日',
        plannedDistanceKm: 0,
        plannedDurationMin: 55,
        mainSetSummary: '杠铃全蹲 80% 1RM 4×5 + RDL',
        steps: [{ kind: 'strength', durationMin: 50, description: '杠铃深蹲 80% 1RM 4×5 + RDL' }]
      };
    }
    return { date: d.date, type: 'REST', title: '休息', plannedDistanceKm: 0 };
  });

  const verifiedPeakSignals = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-10', status: 'completed', rpe: 5, paceDropoffPct: 1.0, formStatus: 'stable', nextDayReaction: 'fresh' }),
      normalizeCheckinEntry({ date: '2026-11-12', status: 'completed', rpe: 6, actualDistanceKm: 5.0, formStatus: 'stable', nextDayReaction: 'normal_soreness' }),
      normalizeCheckinEntry({ date: '2026-11-15', status: 'completed', rpe: 6, actualDistanceKm: 6.0, paceDropoffPct: 1.2, nextDayReaction: 'fresh' })
    ],
    todayStr
  );
  const peakRaceDate = new Date(Date.parse(`${todayStr}T00:00:00Z`) + 56 * 86400_000).toISOString().slice(0, 10);
  const stageInfo = determineEffective800mStage({
    config: { goal: { raceDate: peakRaceDate }, physiology: { ltPaceSecPerKm: 285 } },
    pmcLatest: { ctl: 18 },
    weeklyZones: { weekly: [{ distanceKm: 22 }, { distanceKm: 23 }, { distanceKm: 24 }, { distanceKm: 24 }] },
    checkinSignals: verifiedPeakSignals
  });
  const res = validateAndFinalizePlan(aiDays, {
    todayStr,
    readiness: { light: 'green', score: 88, triggers: [] },
    checkinSignals: verifiedPeakSignals,
    envForecast,
    stageInfo,
    config: { physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });

  // Day 1 重深蹲在 Day 0 间歇之后，必须被降级为无重下肢负荷的恢复日
  assert.equal(res.days[0].type, 'I');
  assert.equal(res.days[1].type, 'REST');
  assert.equal(res.days[2].type, 'I');
  assert.ok(res.validationReport.repairs.some((r) => r.includes('重下肢力量冲突')));
});

test('回归7：命令行同步脚本从私有负载读取已校验课表并拒绝脱敏存根空同步', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-sync-cli-'));
  try {
    await fs.mkdir(path.join(tmpDir, 'data', 'private'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'dist', 'data'), { recursive: true });

    // 1) 若误把脱敏公开存根传入，必须显式报错而不是 0 条静默成功
    await fs.writeFile(
      path.join(tmpDir, 'dist', 'data', 'latest.json'),
      JSON.stringify({ publicMode: true, authRequired: true, message: 'stub' }),
      'utf8'
    );
    await assert.rejects(
      () => runWorkoutSyncCli({ dryRun: true, input: 'dist/data/latest.json' }, tmpDir),
      /公开脱敏存根/
    );
    await assert.rejects(() => syncCoachWorkoutsToGarmin({}, { dryRun: true }), /coachPlan\.days 缺失/);

    // 2) 默认读取 data/private/dashboard-payload.json 可正常同步已校验课表
    await fs.writeFile(
      path.join(tmpDir, 'data', 'private', 'dashboard-payload.json'),
      JSON.stringify({
        config: { region: 'cn' },
        coachPlan: {
          validationReport: { passed: true, postErrors: [] },
          days: [
            {
              date: '2026-11-17',
              type: 'E',
              title: '轻松跑',
              plannedDistanceKm: 4.0,
              steps: [{ kind: 'steady', distanceKm: 4.0, pace: '6:00/km', targetHr: '<= 152 bpm' }]
            },
            { date: '2026-11-18', type: 'REST', title: '休息', plannedDistanceKm: 0 }
          ]
        }
      }),
      'utf8'
    );

    const syncRes = await runWorkoutSyncCli({ dryRun: true, days: 2 }, tmpDir);
    assert.equal(syncRes.dryRun, true);
    assert.equal(syncRes.synced.length, 1);
    assert.equal(syncRes.skipped.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('回归8：疼痛 5/10 ＋ 红灯时，标为 REST 但 steps 含重深蹲或跑步的步骤必须被拦截且 REST 不含负荷', () => {
  const todayStr = '2026-11-17';
  const envForecast = {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 8,
      humidityPct: 40,
      dewPointC: -2,
      windMs: 2,
      usAqi: 40,
      elevationMeters: 1690
    }))
  };

  const disguisedDay = {
    date: todayStr,
    type: 'REST',
    title: '表面休息日',
    plannedDistanceKm: 0,
    plannedDurationMin: 45,
    mainSetSummary: '休息',
    steps: [{ kind: 'strength', durationMin: 45, description: '杠铃重深蹲 5×5 + 保加利亚分腿蹲' }]
  };
  const preLoad = classifyWorkoutLoad(disguisedDay);
  assert.equal(preLoad.isHeavyLowerStrength, true);
  assert.equal(preLoad.hasNonRestStep, true);

  const aiDays = envForecast.daily.map((d, idx) => {
    if (idx === 0) return disguisedDay;
    if (idx === 2) {
      return {
        date: d.date,
        type: 'REST',
        title: '周四隐藏跑量休息',
        plannedDistanceKm: 0,
        plannedDurationMin: 30,
        steps: [{ kind: 'steady', durationMin: 30, description: '轻松慢跑' }]
      };
    }
    return { date: d.date, type: 'REST', title: '休息', plannedDistanceKm: 0 };
  });

  const stageInfo = determineEffective800mStage({ config: {}, pmcLatest: { ctl: 10 }, weeklyZones: { weekly: [] } });
  const res = validateAndFinalizePlan(aiDays, {
    todayStr,
    readiness: { light: 'red', score: 38, triggers: ['HRV偏低红灯'] },
    checkinSignals: summarizeCheckinSignals(
      [{ date: todayStr, status: 'pain', painLevel: 5, painAreas: ['右膝前侧'], diary: '痛感明显' }],
      todayStr
    ),
    envForecast,
    stageInfo,
    config: { physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });

  assert.equal(res.validationReport.passed, true);
  assert.equal(res.days[0].type, 'REST');
  assert.equal(res.days[0].plannedDistanceKm, 0);
  assert.ok(res.days[0].steps.every((s) => s.kind === 'rest'));
  assert.ok(!JSON.stringify(res.days[0].steps).includes('深蹲'));
  assert.ok(res.validationReport.repairs.some((r) => r.includes('疼痛/动作受限保护')));

  // Day 2 即使标为 REST 且无疼痛触发，也绝不允许保留 steady 跑步步骤
  assert.equal(res.days[2].type, 'REST');
  assert.ok(res.days[2].steps.every((s) => s.kind === 'rest'));
  assert.ok(res.validationReport.repairs.some((r) => r.includes('隐藏训练负荷')));
});

test('回归9：步骤编译与 Garmin 同步保留 20m 飞行跑、0s 休息及 30 分钟纯时长轻松跑', () => {
  const sprintSteps = [
    { kind: 'warmup', distanceKm: 0.8, durationMin: 5, description: '热身慢跑' },
    { kind: 'interval', reps: 4, distanceMeters: 20, restSec: 0, description: '20m 飞行冲刺' }
  ];
  const compiledSprint = compileStepsToMetrics(sprintSteps, 360);
  assert.ok(compiledSprint);
  assert.ok(compiledSprint.mainSetSummary.includes('4×20m'));
  assert.ok(compiledSprint.mainSetSummary.includes('组休 0s'));
  assert.ok(!compiledSprint.mainSetSummary.includes('90s'));
  assert.ok(!compiledSprint.mainSetSummary.includes('1.5min'));

  const sprintWorkout = buildGarminWorkoutFromDay({
    date: '2026-11-18',
    type: 'R',
    title: '20m 飞行冲刺课',
    plannedDistanceKm: compiledSprint.plannedDistanceKm,
    plannedDurationMin: compiledSprint.plannedDurationMin,
    steps: sprintSteps
  });
  const repeat = sprintWorkout.workoutSegments[0].workoutSteps.find((s) => s.type === 'RepeatGroupDTO');
  assert.equal(repeat.workoutSteps[0].endConditionValue, 20);
  assert.equal(repeat.workoutSteps.length, 1);

  const timedSteps = [
    { kind: 'steady', durationMin: 30, targetHr: '138-150 bpm', description: '30分钟轻松跑' }
  ];
  const compiledTimed = compileStepsToMetrics(timedSteps, 360);
  assert.equal(compiledTimed.plannedDistanceKm, 0);
  assert.equal(compiledTimed.plannedDurationMin, 30);
  assert.ok(compiledTimed.mainSetSummary.includes('30min'));
  assert.ok(!compiledTimed.mainSetSummary.includes('0km'));

  const timedWorkout = buildGarminWorkoutFromDay({
    date: '2026-11-19',
    type: 'E',
    title: '30分钟轻松跑',
    plannedDistanceKm: compiledTimed.plannedDistanceKm,
    plannedDurationMin: compiledTimed.plannedDurationMin,
    steps: timedSteps
  });
  assert.ok(timedWorkout);
  assert.equal(timedWorkout.workoutSegments[0].workoutSteps[0].endCondition.conditionTypeKey, 'time');
  assert.equal(timedWorkout.workoutSegments[0].workoutSteps[0].endConditionValue, 1800);
});

test('回归10：天气接口全部失败时标记不可用并暂停天气判断，不返回晴间多云/12°C/AQI42/极佳', async () => {
  const offlineEnv = buildOfflineWeatherFallback({ cityDisplay: '兰州', elevationMeters: 1690 });
  assert.equal(offlineEnv.weatherAvailable, false);
  assert.equal(offlineEnv.weatherUnavailable, true);
  assert.equal(offlineEnv.today.weatherUnavailable, true);
  assert.equal(offlineEnv.today.tempC, null);
  assert.equal(offlineEnv.today.usAqi, null);

  const adjOffline = computeEnvironmentalAdjustment(offlineEnv.today);
  assert.equal(adjOffline.weatherAvailable, false);
  assert.equal(adjOffline.weatherUnavailable, true);
  assert.equal(adjOffline.slowdownPct, 0);
  assert.ok(!adjOffline.summary.includes('极佳'));
  assert.ok(!adjOffline.summary.includes('环境温和'));

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-weather-outage-'));
  const origFetch = globalThis.fetch;
  try {
    await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'config', 'runner.config.json'),
      JSON.stringify({
        runnerName: 'Weather Outage Test',
        timezone: 'Asia/Shanghai',
        location: { city: 'Lanzhou', cityDisplay: '兰州', latitude: 35.94, longitude: 104.14, elevationMeters: 1690 },
        goal: { eventName: '800m Sub-2:01', targetTime: '00:02:01', raceDate: '2027-05-15' },
        physiology: { maxHr: 203, restingHrBaseline: 52, lthr: 183, ltPaceSecPerKm: 285, weightKg: 67 }
      }),
      'utf8'
    );

    globalThis.fetch = async () => {
      throw new Error('Simulated weather API outage');
    };

    const payload = await runCoachPipeline({
      rootDir: tmpDir,
      isDemo: true,
      skipNotify: true,
      now: new Date('2026-11-17T08:00:00Z')
    });

    assert.equal(payload.envToday.weatherUnavailable, true);
    assert.equal(payload.envToday.tempC, null);
    assert.equal(payload.envToday.usAqi, null);
    assert.equal(payload.envAdjustmentToday.weatherUnavailable, true);
    assert.ok(!payload.envAdjustmentToday.summary.includes('极佳'));
    assert.ok(!payload.coachPlan.days[0].envAdjustmentNote.includes('环境温和'));
    assert.ok(!payload.coachPlan.days[0].envAdjustmentNote.includes('null°C'));

    const publicHtml = renderDashboardHtml(payload, { includePrivate: false });
    assert.ok(!publicHtml.includes('晴间多云'));
    assert.ok(!publicHtml.includes('12°C'));
    assert.ok(publicHtml.includes('天气待同步') || publicHtml.includes('气象不可用'));
  } finally {
    globalThis.fetch = origFetch;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('回归11：定制课表已清理旧绝对化表达、取消日历强制提速加量，并隔离 12-12 观察测试', async () => {
  const customRaw = await fs.readFile(path.resolve('config/custom-plan.json'), 'utf8');
  const custom = JSON.parse(customRaw);

  assert.ok(!customRaw.includes('最佳线粒体激活区'));
  assert.ok(!customRaw.includes('若膝外侧紧绷，跑后立即补一组靠墙静蹲'));
  assert.ok(!customRaw.includes('据此精确校准') && !customRaw.includes('精确校准你的'));
  assert.ok(!customRaw.includes('前中足自然落地'));
  assert.ok(!customRaw.includes('176+ spm'));
  assert.ok(!customRaw.includes('下周正式切入 Stage 1'));
  assert.ok(!customRaw.includes('W20-W26'));

  // 5阶段拆分包含独立减量窗口且 12-12 明确标为观察跑而非能力标定
  assert.equal(custom.macroPhase.stages.length, 5);
  assert.ok(custom.macroPhase.stages.some((s) => s.key === 'PreComp'));
  const obsDay = custom.days['2026-12-12'];
  assert.ok(obsDay.title.includes('观察跑') && obsDay.title.includes('非能力标定'));

  // W2-W4 轻松跑不按日历周机械提速，力量日保持精简
  assert.equal(custom.days['2026-11-26'].basePace, '6:00/km');
  assert.equal(custom.days['2026-12-03'].basePace, '6:00/km');
  assert.ok(!custom.days['2026-12-02'].mainSetDetail.includes('腿屈伸'));
});

test('回归12：周复盘单变量进阶、力量 RIR 门控与五阶段升级条件正确生效', () => {
  const todayStr = '2026-11-29';

  // 1) 仅有日历经过但无完成打卡 / 有不稳定反馈时，维持周骨架（hold）
  const emptyReview = summarizeCheckinSignals([], todayStr).weeklyReview;
  assert.equal(emptyReview.progressionRecommendation, 'hold');
  assert.equal(emptyReview.strengthProgressionStatus, 'hold');

  const degradedSignals = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-22', status: 'completed', rpe: 5, paceDropoffPct: 1, formStatus: 'stable', nextDayReaction: 'fresh' }),
      normalizeCheckinEntry({ date: '2026-11-24', status: 'completed', rpe: 6, paceDropoffPct: 1.5, formStatus: 'stable', nextDayReaction: 'normal_soreness' }),
      normalizeCheckinEntry({ date: '2026-11-27', status: 'completed', rpe: 7, paceDropoffPct: 4.2, formStatus: 'degraded', nextDayReaction: 'heavy_fatigue' })
    ],
    todayStr
  );
  assert.equal(degradedSignals.weeklyReview.progressionRecommendation, 'hold');

  // 2) 连续 >=3 次稳定完成、次日恢复良好、且力量 RIR >= 2 时解锁单变量微调与小幅力量递增
  const goodSignals = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-20', status: 'completed', rpe: 5, paceDropoffPct: 1, formStatus: 'stable', nextDayReaction: 'fresh' }),
      normalizeCheckinEntry({ date: '2026-11-22', status: 'completed', rpe: 5, strengthExercise: '深蹲', strengthLoadKg: 50, strengthSetsReps: '3x8', strengthRir: 2.5, nextDayReaction: 'normal_soreness' }),
      normalizeCheckinEntry({ date: '2026-11-25', status: 'completed', rpe: 5, strengthExercise: '深蹲', strengthLoadKg: 50, strengthSetsReps: '3x8', strengthRir: 2.5, nextDayReaction: 'fresh' }),
      normalizeCheckinEntry({ date: '2026-11-28', status: 'completed', rpe: 6, paceDropoffPct: 1.2, formStatus: 'stable', nextDayReaction: 'fresh' })
    ],
    todayStr
  );
  assert.equal(goodSignals.weeklyReview.progressionRecommendation, 'eligible_single_variable');
  assert.equal(goodSignals.weeklyReview.strengthProgressionStatus, 'ready_small_increment');

  // 3) 阶段升级门控：近4周跑量与 CTL 达标但存在伤病时锁回 Base；缺有效能力测试时暂缓进入 PreComp；赛前 2 周独立为 Taper
  const raceIn4Weeks = new Date(Date.now() + 26 * 86400_000).toISOString().slice(0, 10);
  const raceIn10Days = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
  const weeklyMock = { weekly: [{ distanceKm: 26 }, { distanceKm: 27 }, { distanceKm: 28 }, { distanceKm: 26 }] };

  const painBlocked = determineEffective800mStage({
    config: { goal: { raceDate: raceIn4Weeks }, physiology: { ltPaceSecPerKm: 285 } },
    pmcLatest: { ctl: 22 },
    weeklyZones: weeklyMock,
    checkinSignals: summarizeCheckinSignals([normalizeCheckinEntry({ date: todayStr, status: 'completed', painLevel: 3, painAreas: ['跟腱/足底'] })], todayStr)
  });
  assert.equal(painBlocked.currentStage, 'Base');
  assert.ok(painBlocked.upgradeGate.blockedReasons.length > 0);

  const missingTestHeld = determineEffective800mStage({
    config: { goal: { raceDate: raceIn4Weeks }, physiology: { ltPaceSecPerKm: 285 }, physiologyMeta: { capacityTests: { latestMasTest: null } } },
    pmcLatest: { ctl: 22 },
    weeklyZones: weeklyMock,
    checkinSignals: goodSignals
  });
  assert.equal(missingTestHeld.currentStage, 'Peak');
  assert.ok(missingTestHeld.upgradeGate.blockedReasons.some((r) => r.includes('PreComp')));

  const preCompReady = determineEffective800mStage({
    config: {
      goal: { raceDate: raceIn4Weeks },
      physiology: { ltPaceSecPerKm: 285 },
      physiologyMeta: { capacityTests: { latestMasTest: { validForCalibration: true, testPurpose: 'capacity_calibration' } } }
    },
    pmcLatest: { ctl: 22 },
    weeklyZones: weeklyMock,
    checkinSignals: goodSignals
  });
  assert.equal(preCompReady.currentStage, 'PreComp');

  const taperStage = determineEffective800mStage({
    config: { goal: { raceDate: raceIn10Days }, physiology: { ltPaceSecPerKm: 285 } },
    pmcLatest: { ctl: 22 },
    weeklyZones: weeklyMock,
    checkinSignals: goodSignals
  });
  assert.equal(taperStage.currentStage, 'Taper');
});

test('回归13：知识库与证据档案包含决策卡要素及核心文献边界', async () => {
  const catalog = await fs.readFile(path.resolve('knowledge/interval-session-catalog.md'), 'utf8');
  assert.ok(catalog.includes('训练目的'));
  assert.ok(catalog.includes('启动条件'));
  assert.ok(catalog.includes('进阶条件'));
  assert.ok(catalog.includes('回退条件'));
  assert.ok(catalog.includes('证据限制'));
  assert.ok(catalog.includes('OBS-SUBMAX'));

  const evidenceRaw = await fs.readFile(path.resolve('knowledge/evidence-notes.md'), 'utf8');
  assert.ok(evidenceRaw.includes('0296866'));
  assert.ok(evidenceRaw.includes('01481-2'));
  assert.ok(evidenceRaw.includes('02018-z'));
});

test('回归14：定制课表写入 PreComp + 10×800m @ 3:00/km 及超量负荷时，被 Base/维持门控与终检严格拦截改造', () => {
  const todayStr = '2026-11-17';
  const envForecast = {
    location: { city: '兰州', elevationMeters: 1690 },
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 8,
      humidityPct: 40,
      dewPointC: -2,
      windMs: 2,
      usAqi: 40,
      elevationMeters: 1690
    }))
  };

  const customCandidate = {
    macroPhase: {
      currentStage: 'PreComp',
      stageDisplay: 'Stage 3 比赛节奏转化期 (阶段越级)',
      weekFocus: 'PreComp 专项冲刺',
      stages: [
        { key: 'Base', label: 'Stage 0 组织唤醒期', weeks: 'W1-W4', active: false },
        { key: 'Build', label: 'Stage 1 有氧与基础速度', weeks: 'W5-W11', active: false },
        { key: 'Peak', label: 'Stage 2 专项准备与VO2', weeks: 'W12-W18', active: false },
        { key: 'PreComp', label: 'Stage 3 比赛节奏转化', weeks: 'W19-W23', active: true },
        { key: 'Taper', label: 'Stage 4 赛前独立减量', weeks: '最后~1-2周', active: false }
      ]
    },
    days: envForecast.daily.map((d, idx) =>
      idx === 0
        ? {
            date: d.date,
            type: 'I',
            title: 'PreComp 10×800m @ 3:00/km',
            plannedDistanceKm: 10.0,
            plannedDurationMin: 42,
            basePace: '3:00/km',
            mainSetSummary: '10×800m @ 3:00/km，组休 90s',
            mainSetDetail: 'PreComp 10×800m @ 3:00/km',
            steps: [
              { kind: 'warmup', distanceKm: 1.0, durationMin: 6 },
              { kind: 'interval', reps: 10, distanceMeters: 800, pace: '3:00/km', restSec: 90 },
              { kind: 'cooldown', distanceKm: 1.0, durationMin: 6 }
            ]
          }
        : {
            date: d.date,
            type: 'E',
            title: '超量有氧 8km',
            plannedDistanceKm: 8.0,
            plannedDurationMin: 45,
            basePace: '4:40/km',
            steps: [{ kind: 'steady', distanceKm: 8.0, pace: '4:40/km', description: '超量长慢跑' }]
          }
    )
  };

  const config = {
    timezone: 'Asia/Shanghai',
    goal: { eventName: '800m Sub-2:01', targetTime: '00:02:01', raceDate: '2027-05-15' },
    physiology: { maxHr: 203, restingHrBaseline: 52, lthr: 183, ltPaceSecPerKm: 285, weightKg: 67 },
    physiologyMeta: { capacityTests: { latestMasTest: null } }
  };
  const plan = buildDeterministicCoachPlan(
    {
      todayStr,
      readiness: { light: 'green', score: 90, triggers: [] },
      pmc: { latest: { ctl: 6, atl: 4, tsb: 2, acwr: 0.7 } },
      weeklyZones: { weekly: [{ distanceKm: 10 }, { distanceKm: 11 }, { distanceKm: 10 }, { distanceKm: 11 }], zonePercentages: [85, 10, 5, 0, 0], polarization: {} },
      wellness: { date: todayStr, hrvToday: 62, rhrToday: 51, sleepScore: 86, bodyBatteryMorning: 85 },
      envForecast,
      customPlan: {
        macroPhase: customCandidate.macroPhase,
        days: Object.fromEntries(customCandidate.days.map(day => [day.date, day]))
      },
      checkins: []
    },
    config
  );

  // 定制课表不能覆盖程序按实测门槛确定的阶段。
  assert.equal(plan.macroPhase.currentStage, 'Base');
  assert.ok(plan.macroPhase.stages.find((s) => s.key === 'Base')?.active);
  assert.ok(!plan.macroPhase.stages.find((s) => s.key === 'PreComp')?.active);

  // 超量课表须留下拦截记录，修正后通过终检。
  assert.equal(plan.validationReport.inputValid, false);
  assert.equal(plan.validationReport.passed, true);
  assert.ok(plan.validationReport.inputErrorsCount >= 1);
  assert.ok(plan.validationReport.repairsCount >= 1);
  assert.ok(plan.days.every((d) => !['T', 'I', 'R', 'LSD'].includes(d.type)));
  assert.ok(plan.days.every((d) => !JSON.stringify(d).includes('10×800') && !JSON.stringify(d).includes('3:00/km')));
  const totalWeeklyKm = plan.days.reduce((sum, d) => sum + Number(d.plannedDistanceKm || 0), 0);
  assert.ok(totalWeeklyKm <= 16.6, `Base 维持期周跑量应被控住，实际 ${totalWeeklyKm}km`);

  // Build 维持期限制高强课次数和周总跑量。
  const buildHoldSignals = summarizeCheckinSignals(
    [{ date: todayStr, status: 'completed' }],
    todayStr
  );
  const buildHoldStage = determineEffective800mStage({
    config: { goal: { raceDate: '2027-02-15' }, physiology: { ltPaceSecPerKm: 285 } },
    pmcLatest: { ctl: 18 },
    weeklyZones: { weekly: [{ distanceKm: 20 }, { distanceKm: 20 }, { distanceKm: 20 }, { distanceKm: 20 }] },
    checkinSignals: buildHoldSignals
  });
  assert.equal(buildHoldStage.currentStage, 'Build');
  const heavyHoldInput = envForecast.daily.map((d, idx) => ({
    date: d.date,
    type: idx === 1 || idx === 3 ? 'T' : 'E',
    title: idx === 1 || idx === 3 ? '阈值课' : '超量有氧',
    plannedDistanceKm: 6.0,
    basePace: idx === 1 || idx === 3 ? '4:45/km' : '5:50/km',
    steps: [{ kind: 'steady', distanceKm: 6.0, pace: idx === 1 || idx === 3 ? '4:45/km' : '5:50/km', description: '模拟超量输入' }]
  }));
  const checkedHold = validateAndFinalizePlan(heavyHoldInput, {
    todayStr,
    readiness: { light: 'green', score: 88, triggers: [] },
    checkinSignals: buildHoldSignals,
    envForecast,
    stageInfo: buildHoldStage,
    config: { goal: { eventName: '800m' }, physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });
  const hardCountHold = checkedHold.days.filter((d) => ['T', 'I', 'R'].includes(d.type)).length;
  const holdWeeklyKm = checkedHold.days.reduce((s, d) => s + Number(d.plannedDistanceKm || 0), 0);
  assert.ok(hardCountHold <= 1, `Build 维持期高强课最多 1 堂，实际 ${hardCountHold}`);
  assert.ok(holdWeeklyKm <= 21.4, `Build 维持期周总跑量应压在 ~20.8km 内，实际 ${holdWeeklyKm}`);
  assert.equal(checkedHold.validationReport.inputValid, false);
  assert.equal(checkedHold.validationReport.passed, true);
});

test('回归15：仅提交 3 次完成打卡但缺少动作稳定性/实测/次日反应时，判为未知并维持负荷', () => {
  const todayStr = '2026-11-29';

  // 1) 只填 status: completed，其余反馈全空
  const bareReview = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-22', status: 'completed' }),
      normalizeCheckinEntry({ date: '2026-11-25', status: 'completed' }),
      normalizeCheckinEntry({ date: '2026-11-28', status: 'completed' })
    ],
    todayStr
  ).weeklyReview;
  assert.equal(bareReview.verifiedRecoveryStatus, 'unknown');
  assert.equal(bareReview.progressionRecommendation, 'hold');
  assert.ok(bareReview.missingFeedbackParts.includes('次日恢复反应'));

  // 2) 只填距离+动作稳定但缺失次日恢复反应 -> 仍未知+维持
  const missingReactionReview = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-22', status: 'completed', actualDistanceKm: 4.0, formStatus: 'stable' }),
      normalizeCheckinEntry({ date: '2026-11-25', status: 'completed', actualDistanceKm: 4.5, formStatus: 'stable' }),
      normalizeCheckinEntry({ date: '2026-11-28', status: 'completed', actualDistanceKm: 5.0, formStatus: 'stable' })
    ],
    todayStr
  ).weeklyReview;
  assert.equal(missingReactionReview.verifiedRecoveryStatus, 'unknown');
  assert.equal(missingReactionReview.progressionRecommendation, 'hold');

  // 3) 只填次日反应但缺失实测数据与动作稳定性 -> 仍未知+维持
  const missingExecReview = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-22', status: 'completed', nextDayReaction: 'fresh' }),
      normalizeCheckinEntry({ date: '2026-11-25', status: 'completed', nextDayReaction: 'normal_soreness' }),
      normalizeCheckinEntry({ date: '2026-11-28', status: 'completed', nextDayReaction: 'fresh' })
    ],
    todayStr
  ).weeklyReview;
  assert.equal(missingExecReview.verifiedRecoveryStatus, 'unknown');
  assert.equal(missingExecReview.progressionRecommendation, 'hold');
});

test('回归16：力量进阶严格核对同一动作连续记录、RIR>=2 与明确次日恢复反馈', () => {
  const todayStr = '2026-11-29';

  // 1) 不同动作（卧推 + 深蹲）且均未填次日反应，不得触发增重建议
  const mixedNoReaction = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-24', status: 'completed', strengthExercise: '卧推', strengthLoadKg: 60, strengthRir: 1 }),
      normalizeCheckinEntry({ date: '2026-11-27', status: 'completed', strengthExercise: '深蹲', strengthLoadKg: 50, strengthRir: 3 })
    ],
    todayStr
  ).weeklyReview;
  assert.equal(mixedNoReaction.strengthProgressionStatus, 'hold');
  assert.equal(mixedNoReaction.sameExerciseStreakCount, 1);
  assert.equal(mixedNoReaction.strengthRecoveryConfirmed, false);

  // 2) 两次同一动作深蹲均满足 RIR>=2，但缺失次日反应 -> 仍 hold
  const sameNoReaction = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-24', status: 'completed', strengthExercise: '深蹲', strengthLoadKg: 50, strengthRir: 2.5 }),
      normalizeCheckinEntry({ date: '2026-11-27', status: 'completed', strengthExercise: '深蹲', strengthLoadKg: 50, strengthRir: 3 })
    ],
    todayStr
  ).weeklyReview;
  assert.equal(sameNoReaction.strengthProgressionStatus, 'hold');
  assert.equal(sameNoReaction.strengthRecoveryConfirmed, false);

  // 3) 两次深蹲均有次日良好反应，但旧一次 RIR < 2 -> 仍 hold
  const lowPrevRir = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-24', status: 'completed', strengthExercise: '深蹲', strengthLoadKg: 55, strengthRir: 1, nextDayReaction: 'normal_soreness' }),
      normalizeCheckinEntry({ date: '2026-11-27', status: 'completed', strengthExercise: '深蹲', strengthLoadKg: 55, strengthRir: 2.5, nextDayReaction: 'fresh' })
    ],
    todayStr
  ).weeklyReview;
  assert.equal(lowPrevRir.strengthProgressionStatus, 'hold');
  assert.equal(lowPrevRir.strengthRecoveryConfirmed, false);

  // 4) 同一动作连续 2 次 RIR>=2 且次日反应明确良好 -> ready_small_increment
  const verifiedSquat = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-24', status: 'completed', strengthExercise: '深蹲', strengthLoadKg: 50, strengthRir: 2.5, nextDayReaction: 'normal_soreness' }),
      normalizeCheckinEntry({ date: '2026-11-27', status: 'completed', strengthExercise: '深蹲', strengthLoadKg: 50, strengthRir: 2.5, nextDayReaction: 'fresh' })
    ],
    todayStr
  ).weeklyReview;
  assert.equal(verifiedSquat.strengthProgressionStatus, 'ready_small_increment');
  assert.equal(verifiedSquat.strengthRecoveryConfirmed, true);
});

test('回归17：零打卡即使跑量、CTL 与能力测试均满足，也保留未知状态并阻断进入 Peak / PreComp', () => {
  const raceIn4Weeks = new Date(Date.now() + 26 * 86400_000).toISOString().slice(0, 10);
  const weeklyMock = { weekly: [{ distanceKm: 26 }, { distanceKm: 27 }, { distanceKm: 28 }, { distanceKm: 26 }] };
  const emptyCheckins = summarizeCheckinSignals([], new Date().toISOString().slice(0, 10));

  const zeroCheckinStage = determineEffective800mStage({
    config: {
      goal: { raceDate: raceIn4Weeks },
      physiology: { ltPaceSecPerKm: 285 },
      physiologyMeta: { capacityTests: { latestMasTest: { validForCalibration: true, testPurpose: 'capacity_calibration' } } }
    },
    pmcLatest: { ctl: 24 },
    weeklyZones: weeklyMock,
    checkinSignals: emptyCheckins
  });

  assert.equal(zeroCheckinStage.upgradeGate.stableCompletionStatus, 'unknown');
  assert.equal(zeroCheckinStage.upgradeGate.stableCompletionOk, false);
  assert.equal(zeroCheckinStage.upgradeGate.recoveryStatus, 'unknown');
  assert.equal(zeroCheckinStage.upgradeGate.recoveryOk, false);
  assert.notEqual(zeroCheckinStage.currentStage, 'PreComp');
  assert.notEqual(zeroCheckinStage.currentStage, 'Peak');
  assert.equal(zeroCheckinStage.currentStage, 'Build');
  assert.ok(zeroCheckinStage.upgradeGate.blockedReasons.some((r) => r.includes('未知')));
});

test('回归18：伪装为 E 的 3 堂 6×400m 按实际步骤统计被拦截，且 7 天×2km=14km 在 11.2km 回退上限下成功压回合规并 passed=true', () => {
  const todayStr = '2026-11-17';
  const envForecast = {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${17 + i}`,
      weatherText: '晴',
      tempC: 8,
      humidityPct: 40,
      dewPointC: -2,
      windMs: 2,
      usAqi: 40,
      elevationMeters: 1690
    }))
  };

  // 1) 三堂间隔安排的 6×400m 全标为 E：Build + hold 最多 1 堂质量课 -> 必须按实际步骤只保留 <=1 堂，其余 2 堂消除 interval 步骤
  const holdSignals = summarizeCheckinSignals([{ date: todayStr, status: 'completed' }], todayStr);
  const buildHoldStage = determineEffective800mStage({
    config: { goal: { raceDate: '2027-02-15' }, physiology: { ltPaceSecPerKm: 285 } },
    pmcLatest: { ctl: 18 },
    weeklyZones: { weekly: [{ distanceKm: 20 }, { distanceKm: 20 }, { distanceKm: 20 }, { distanceKm: 20 }] },
    checkinSignals: holdSignals
  });
  assert.equal(buildHoldStage.currentStage, 'Build');

  const disguisedDays = envForecast.daily.map((d, idx) =>
    idx === 0 || idx === 2 || idx === 4
      ? {
          date: d.date,
          type: 'E',
          title: '伪装轻松跑实为 6×400m',
          basePace: '4:45/km',
          steps: [
            { kind: 'warmup', distanceKm: 1.0, durationMin: 6 },
            { kind: 'interval', reps: 6, distanceMeters: 400, pace: '4:45/km', restSec: 45 },
            { kind: 'cooldown', distanceKm: 0.6, durationMin: 4 }
          ]
        }
      : { date: d.date, type: 'REST', title: '休息', plannedDistanceKm: 0 }
  );

  const resDisguised = validateAndFinalizePlan(disguisedDays, {
    todayStr,
    readiness: { light: 'green', score: 90, triggers: [] },
    checkinSignals: holdSignals,
    envForecast,
    stageInfo: buildHoldStage,
    config: { goal: { eventName: '800m' }, physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });
  const actualHardCount = resDisguised.days.filter((d) => classifyWorkoutLoad(d).isHardTrack).length;
  assert.ok(actualHardCount <= 1, `Build+hold 按实际步骤统计质量课应 <= 1，实际 ${actualHardCount}`);
  assert.equal(resDisguised.validationReport.inputValid, false);
  assert.equal(resDisguised.validationReport.passed, true);

  // 2) 回退周 (regress)：近4周均跑量 14km -> 上限 11.2km；7 天各 2km 共 14km 必须被减量/转休压回 <= 11.2km 且 passed=true
  const regressSignals = summarizeCheckinSignals(
    [
      normalizeCheckinEntry({ date: '2026-11-12', status: 'completed', rpe: 9, nextDayReaction: 'heavy_fatigue' }),
      normalizeCheckinEntry({ date: '2026-11-16', status: 'completed', rpe: 9, nextDayReaction: 'heavy_fatigue' })
    ],
    todayStr
  );
  assert.equal(regressSignals.weeklyReview.progressionRecommendation, 'regress');

  const regressBuildStage = determineEffective800mStage({
    config: { goal: { raceDate: '2027-02-15' }, physiology: { ltPaceSecPerKm: 285 } },
    pmcLatest: { ctl: 14 },
    weeklyZones: { weekly: [{ distanceKm: 14 }, { distanceKm: 14 }, { distanceKm: 14 }, { distanceKm: 14 }] },
    checkinSignals: regressSignals
  });

  const sevenByTwoKm = envForecast.daily.map((d) => ({
    date: d.date,
    type: 'E',
    title: '每天2km轻跑',
    plannedDistanceKm: 2.0,
    basePace: '5:50/km',
    steps: [{ kind: 'steady', distanceKm: 2.0, pace: '5:50/km', description: '2km 有氧跑' }]
  }));

  const resRegress = validateAndFinalizePlan(sevenByTwoKm, {
    todayStr,
    readiness: { light: 'green', score: 85, triggers: [] },
    checkinSignals: regressSignals,
    envForecast,
    stageInfo: regressBuildStage,
    config: { goal: { eventName: '800m' }, physiology: { lthr: 183, weightKg: 67 } },
    wellness: {}
  });
  const totalRegressKm = resRegress.days.reduce((s, d) => s + Number(d.plannedDistanceKm || 0), 0);
  assert.ok(totalRegressKm <= 11.2, `回退周总跑量应压回 <= 11.2km，实际 ${totalRegressKm}km`);
  assert.equal(resRegress.validationReport.passed, true);
});

test('回归19：终检未通过的课表禁止返回不合规结果、禁止发布公开页且禁止 Garmin 同步', async () => {
  // 1) Garmin 同步网关（workoutSync 与 sync-workouts CLI）必须阻断 validationReport.passed=false 的课表
  const failedPlan = {
    validationReport: { passed: false, postErrors: ['周总跑量 14km 仍超过上限 11.2km'] },
    days: [
      {
        date: '2026-11-17',
        type: 'E',
        title: '未通过终检的课表',
        plannedDistanceKm: 2.0,
        steps: [{ kind: 'steady', distanceKm: 2.0, pace: '6:00/km' }]
      }
    ]
  };
  await assert.rejects(
    () => syncCoachWorkoutsToGarmin(failedPlan, { dryRun: true }),
    /终检未通过/
  );

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-gate-block-'));
  try {
    await fs.mkdir(path.join(tmpDir, 'data', 'private'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'data', 'private', 'dashboard-payload.json'),
      JSON.stringify({ config: { region: 'cn' }, coachPlan: failedPlan }),
      'utf8'
    );
    await assert.rejects(
      () => runWorkoutSyncCli({ dryRun: true }, tmpDir),
      /终检未通过/
    );

    // 定制课表与备用课表均未通过终检时，规划器直接阻断。
    assert.throws(
      () => buildDeterministicCoachPlan({
        todayStr: '2026-11-17',
        _validatePlanFn: () => ({ days: failedPlan.days, validationReport: failedPlan.validationReport })
      }),
      /ValidationGate/
    );

    // runCoachPipeline 若拿到 passed=false 课表，必须阻断写出 dashboard-payload.json、dist/index.html 与 latest.json
    const blockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-pipe-block-'));
    try {
      await fs.mkdir(path.join(blockDir, 'config'), { recursive: true });
      await fs.writeFile(
        path.join(blockDir, 'config', 'runner.config.json'),
        JSON.stringify({
          runnerName: 'Block Test',
          timezone: 'Asia/Shanghai',
          location: { city: 'Lanzhou', cityDisplay: '兰州', latitude: 35.94, longitude: 104.14, elevationMeters: 1690 },
          goal: { eventName: '800m', targetTime: '00:02:01', raceDate: '2027-02-15' },
          physiology: { maxHr: 203, restingHrBaseline: 52, lthr: 183, ltPaceSecPerKm: 285, weightKg: 67 }
        }),
        'utf8'
      );
      await assert.rejects(
        () =>
          runCoachPipeline({
            rootDir: blockDir,
            isDemo: true,
            skipNotify: true,
            skipNetworkFetch: true,
            _generateCoachPlanFn: async () => ({
              macroPhase: { currentStage: 'Base', stages: [] },
              validationReport: { passed: false, postErrors: ['模拟终检失败'] },
              days: [{ date: '2026-11-17', type: 'E', plannedDistanceKm: 2.0 }]
            })
          }),
        /ValidationGate/
      );
      await assert.rejects(() => fs.access(path.join(blockDir, 'dist', 'index.html')));
      await assert.rejects(() => fs.access(path.join(blockDir, 'dist', 'data', 'latest.json')));
      await assert.rejects(() => fs.access(path.join(blockDir, 'data', 'private', 'dashboard-payload.json')));
    } finally {
      await fs.rm(blockDir, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
