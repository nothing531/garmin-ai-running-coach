import test from 'node:test';
import assert from 'node:assert/strict';
import GarminConnectModule from '@likenttt/garmin-connect';
import {
  buildGarminWorkoutFromDay,
  buildPaceSpeedRange,
  parseHrTargetRange,
  parseIntervalSpec,
  parseRestSeconds,
  syncCoachWorkoutsToGarmin
} from '../src/garmin/workoutSync.js';

test('parseHrTargetRange, parseIntervalSpec, parseRestSeconds 与配速转换准确', () => {
  assert.deepEqual(parseHrTargetRange('138-152 bpm (极化 Z1-Z2，<LT1)'), { low: 138, high: 152 });
  assert.equal(parseHrTargetRange('按分段秒表配速与完全恢复走休执行'), null);

  assert.deepEqual(parseIntervalSpec('4.0km 轻松跑 + 6×80m 流畅加速（90s 全休）'), { count: 6, meters: 80 });
  assert.deepEqual(parseIntervalSpec('5 × 1000m VO2max 间歇'), { count: 5, meters: 1000 });
  assert.equal(parseRestSeconds('全休走回 90 秒', 60), 90);
  assert.equal(parseRestSeconds('组间休 2.5 分钟', 60), 150);

  const pace = buildPaceSpeedRange('4:00/km', 0.03);
  assert.ok(pace.fastMs > 4.16 && pace.slowMs < 4.17);
});

test('buildGarminWorkoutFromDay 正确生成极化轻松跑（含 Strides 无心率追逐）与过滤非跑步日', () => {
  const restWorkout = buildGarminWorkoutFromDay({
    date: '2026-11-16',
    type: 'REST',
    plannedDistanceKm: 0,
    title: 'W1 周一 · 完全恢复日'
  });
  assert.equal(restWorkout, null);

  const gymWorkout = buildGarminWorkoutFromDay({
    date: '2026-11-15',
    type: 'STR',
    plannedDistanceKm: 0,
    title: 'W1 周日 · 健身房下肢力量'
  });
  assert.equal(gymWorkout, null);

  const stridesDay = {
    date: '2026-11-21',
    type: 'E',
    title: 'W1 周六 · 4.0km 操场慢跑 + 4×60m Strides',
    plannedDistanceKm: 4.2,
    targetHr: '138-152 bpm (极化 Z1-Z2，<LT1)',
    mainSetSummary: '4.0km 轻松跑 + 4×60m 流畅加速（全休90秒）',
    cooldown: '拉伸 + 靠墙静蹲'
  };

  const w = buildGarminWorkoutFromDay(stridesDay);
  assert.equal(w.workoutName, '[AI] 11-21 4.0km 操场慢跑 + 4×60m Strides');
  const steps = w.workoutSegments[0].workoutSteps;
  assert.equal(steps.length, 4); // warmup, main HR, RepeatGroup(4x60m), cooldown
  assert.equal(steps[1].targetType.workoutTargetTypeKey, 'heart.rate.zone');
  assert.equal(steps[1].targetValueOne, 138);
  assert.equal(steps[1].targetValueTwo, 152);
  assert.equal(steps[1].endConditionValue, 2960); // 4200 - 1000 - 240
  assert.equal(steps[2].type, 'RepeatGroupDTO');
  assert.equal(steps[2].numberOfIterations, 4);
  assert.equal(steps[2].workoutSteps[0].targetType.workoutTargetTypeKey, 'no.target');
  assert.equal(steps[2].workoutSteps[0].endConditionValue, 60);
  assert.equal(steps[2].workoutSteps[1].endConditionValue, 90);
});

test('syncCoachWorkoutsToGarmin dryRun 正确筛选未来窗口内跑步课表', async () => {
  const res = await syncCoachWorkoutsToGarmin(
    {
      days: [
        { date: '2026-11-14', type: 'E', plannedDistanceKm: 3.2, title: '3.2km 唤醒跑', targetHr: '135-152 bpm' },
        { date: '2026-11-15', type: 'STR', plannedDistanceKm: 0, title: '力量日' },
        { date: '2026-11-16', type: 'REST', plannedDistanceKm: 0, title: '休息日' },
        { date: '2026-11-17', type: 'E', plannedDistanceKm: 3.5, title: '3.5km 轻松跑', targetHr: '136-152 bpm' }
      ]
    },
    { days: 4, dryRun: true }
  );

  assert.equal(res.dryRun, true);
  assert.equal(res.synced.length, 2);
  assert.equal(res.skipped.length, 2);
  assert.equal(res.synced[0].workoutName, '[AI] 11-14 3.2km 唤醒跑');
});

test('buildGarminWorkoutFromDay 精确保留 20m 短冲、0 秒休息与纯时长轻松跑', async () => {
  assert.deepEqual(parseIntervalSpec('4×20m 飞行冲刺跑'), { count: 4, meters: 20 });
  assert.equal(parseRestSeconds('组休 0s', 90), 0);

  // 1) 20m 飞行跑 + 0s 休息不得变成 30m 或 90s/15s
  const flyingSprint = buildGarminWorkoutFromDay({
    date: '2026-11-18',
    type: 'R',
    title: '20m 飞行跑测试',
    plannedDistanceKm: 0.88,
    steps: [
      { kind: 'warmup', distanceKm: 0.8, durationMin: 5, description: '热身慢跑' },
      { kind: 'interval', reps: 4, distanceMeters: 20, restSec: 0, description: '20m 飞行冲刺' }
    ]
  });
  assert.ok(flyingSprint);
  const sprintSteps = flyingSprint.workoutSegments[0].workoutSteps;
  const repeatGroup = sprintSteps.find((s) => s.type === 'RepeatGroupDTO');
  assert.ok(repeatGroup);
  assert.equal(repeatGroup.numberOfIterations, 4);
  assert.equal(repeatGroup.workoutSteps[0].endConditionValue, 20);
  assert.equal(repeatGroup.workoutSteps.length, 1); // 0s rest -> 无多余 recovery 步骤

  // 2) 仅按时长安排的 30 分钟轻松跑不得被跳过，且转为 time 条件 1800s
  const timedEasyDay = {
    date: '2026-11-19',
    type: 'E',
    title: '30分钟轻松跑',
    plannedDistanceKm: 0,
    plannedDurationMin: 30,
    targetHr: '136-150 bpm',
    steps: [{ kind: 'steady', durationMin: 30, targetHr: '136-150 bpm', description: '30分钟有氧轻松跑' }]
  };
  const timedWorkout = buildGarminWorkoutFromDay(timedEasyDay);
  assert.ok(timedWorkout);
  const timedSteps = timedWorkout.workoutSegments[0].workoutSteps;
  assert.equal(timedSteps.length, 1);
  assert.equal(timedSteps[0].endCondition.conditionTypeKey, 'time');
  assert.equal(timedSteps[0].endConditionValue, 1800);

  const syncRes = await syncCoachWorkoutsToGarmin({ days: [timedEasyDay] }, { days: 1, dryRun: true });
  assert.equal(syncRes.synced.length, 1);
  assert.equal(syncRes.skipped.length, 0);
});

test('Garmin 排期失败时保留旧课，成功后仅替换日期窗口内的看板课表', async (t) => {
  const { prototype } = GarminConnectModule.GarminConnect;
  const operations = [];
  let scheduleFails = true;
  t.mock.method(prototype, 'loadToken', () => {});
  t.mock.method(prototype, 'exportToken', () => ({}));
  t.mock.method(prototype, 'getWorkouts', async function (_start, limit) {
    this.client.post = async (_url, { date }) => {
      operations.push(`schedule:${date}`);
      if (scheduleFails) throw new Error('network failure');
      return { workoutScheduleId: 42 };
    };
    return limit === 1 ? [] : [
      { workoutId: 1, workoutName: '[AI] 11-18 旧跑步课' },
      { workoutId: 2, workoutName: '[AI] 11-19 改为休息的旧课' },
      { workoutId: 3, workoutName: '11-18 自建跑步课' },
      { workoutId: 4, workoutName: '[AI] 11-24 窗口之外' }
    ];
  });
  t.mock.method(prototype, 'addWorkout', async ({ workoutName }) => {
    operations.push('create:5');
    return { workoutId: 5, workoutName };
  });
  t.mock.method(prototype, 'deleteWorkout', async ({ workoutId }) => {
    operations.push(`delete:${workoutId}`);
  });
  const plan = {
    validationReport: { passed: true },
    days: [
      { date: '2026-11-18', type: 'E', plannedDistanceKm: 3.2, title: '轻松跑' },
      { date: '2026-11-19', type: 'REST', plannedDistanceKm: 0, title: '休息' }
    ]
  };
  const options = { requireValidatedPlan: true, auth: { sessionJson: { oauth1: {}, oauth2: {} } } };

  await assert.rejects(() => syncCoachWorkoutsToGarmin(plan, options), /Garmin 排期失败/);
  assert.deepEqual(operations, ['create:5', 'schedule:2026-11-18', 'delete:5']);

  scheduleFails = false;
  operations.length = 0;
  const result = await syncCoachWorkoutsToGarmin(plan, options);
  assert.deepEqual(operations, ['create:5', 'schedule:2026-11-18', 'delete:1', 'delete:2']);
  assert.equal(result.synced[0].workoutScheduleId, 42);
  assert.equal(result.deletedCount, 2);
});
