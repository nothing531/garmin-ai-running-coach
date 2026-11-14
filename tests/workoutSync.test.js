import test from 'node:test';
import assert from 'node:assert/strict';
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
