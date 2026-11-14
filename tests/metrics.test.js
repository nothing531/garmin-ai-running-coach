import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAerobicDecoupling,
  computeEnvironmentalAdjustment,
  computePmcSeries,
  computeWeeklyAndZones,
  evaluateReadiness,
  parsePaceSecPerKm
} from '../src/science/metrics.js';
import { buildDeterministicCoachPlan } from '../src/coach/planner.js';
import { renderDashboardHtml } from '../src/render/dashboard.js';

test('computePmcSeries calculates CTL/ATL/TSB/ACWR consistently', () => {
  const today = new Date().toISOString().slice(0, 10);
  const activities = [
    { date: today, durationSec: 3600, averageHr: 172, distanceMeters: 12000, isRun: true }
  ];
  const pmc = computePmcSeries(activities, { maxHr: 190, restingHrBaseline: 50, lthr: 172 }, 14);
  assert.equal(pmc.series.length, 14);
  assert.ok(pmc.latest.ctl > 0);
  assert.ok(pmc.latest.atl > 0);
  assert.ok(pmc.latest.acwr > 0);
});

test('computeAerobicDecoupling detects positive drift when HR climbs at constant speed', () => {
  const records = [];
  for (let i = 0; i < 100; i++) {
    records.push({
      speedMs: 3.3,
      hr: i < 55 ? 145 : 162
    });
  }
  const result = computeAerobicDecoupling(records);
  assert.ok(result);
  assert.ok(result.decouplingPct > 5);
  assert.equal(result.status, 'high_drift');
});

test('evaluateReadiness triggers red light when HRV drops sharply and RHR spikes', () => {
  const red = evaluateReadiness(
    { hrvToday: 38, hrv7dAvg: 60, sleepScore: 58, bodyBatteryMorning: 42, rhrToday: 56, rhr7dAvg: 50 },
    { acwr: 1.42 }
  );
  assert.equal(red.light, 'red');
  assert.ok(red.score < 60);

  const green = evaluateReadiness(
    { hrvToday: 65, hrv7dAvg: 60, sleepScore: 86, bodyBatteryMorning: 88, rhrToday: 49, rhr7dAvg: 50 },
    { acwr: 1.05 }
  );
  assert.equal(green.light, 'green');
  assert.ok(green.score >= 80);
});

test('computeEnvironmentalAdjustment accounts for heat/dew point, altitude and AQI', () => {
  const adj = computeEnvironmentalAdjustment({
    tempC: 30,
    dewPointC: 23,
    windMs: 6.2,
    elevationMeters: 2000,
    usAqi: 175,
    weatherCode: 1
  });
  assert.ok(adj.slowdownPct > 6);
  assert.equal(adj.windWarning, true);
  assert.equal(adj.indoorRecommended, true);
});

test('deterministic coach plan and HTML dashboard render safely', () => {
  const config = {
    region: 'cn',
    goal: { eventName: '半马PB', targetTime: '01:35:00', raceDate: '2027-03-21' },
    physiology: { maxHr: 190, restingHrBaseline: 50, lthr: 172, ltPaceSecPerKm: 265, weightKg: 66 }
  };
  const wellness = { hrvToday: 40, hrv7dAvg: 60, sleepScore: 55, bodyBatteryMorning: 40, rhrToday: 57, rhr7dAvg: 50 };
  const pmc = computePmcSeries([], config.physiology, 14);
  const weeklyZones = computeWeeklyAndZones([], config.physiology);
  const readiness = evaluateReadiness(wellness, pmc.latest);
  const envToday = {
    date: new Date().toISOString().slice(0, 10),
    weatherText: '晴朗',
    tempC: 15,
    humidityPct: 50,
    dewPointC: 5,
    windMs: 2,
    usAqi: 40,
    elevationMeters: 45
  };

  const coachPlan = buildDeterministicCoachPlan(
    {
      readiness,
      pmc,
      weeklyZones,
      wellness,
      envForecast: { daily: [envToday] },
      lastKeyWorkoutAudit: null
    },
    config
  );

  assert.equal(coachPlan.days.length, 7);
  assert.equal(coachPlan.days[0].type, 'REST'); // 红灯强制熔断今日训练

  const html = renderDashboardHtml({
    generatedAt: '2026-11-14 16:20:00',
    dataSource: 'unit_test',
    config,
    wellness,
    readiness,
    pmc,
    weeklyZones,
    lastKeyWorkoutAudit: null,
    envForecast: { location: { city: '北京' }, daily: [envToday] },
    envToday,
    envAdjustmentToday: computeEnvironmentalAdjustment(envToday),
    coachPlan
  });

  assert.ok(html.includes('AI Running Coach'));
  assert.ok(html.includes('pmcChart'));
  assert.ok(html.includes('红灯'));
});

test('parsePaceSecPerKm parses pace strings and numbers cleanly', () => {
  assert.equal(parsePaceSecPerKm('5:30/km'), 330);
  assert.equal(parsePaceSecPerKm('4:05'), 245);
  assert.equal(parsePaceSecPerKm(265), 265);
  assert.equal(parsePaceSecPerKm('--:--'), null);
});

test('customPlan applies Antigravity cycle schedule while retaining readiness and weather guardrails', () => {
  const config = {
    region: 'cn',
    goal: { eventName: '半马PB', targetTime: '01:35:00', raceDate: '2027-03-21' },
    physiology: { maxHr: 190, restingHrBaseline: 50, lthr: 172, ltPaceSecPerKm: 265, weightKg: 66 }
  };
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowStr = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const customPlan = {
    updatedAt: todayStr,
    coachNotes: '本周左小腿紧绷，周中阈值减量观察',
    days: {
      [todayStr]: {
        type: 'T',
        title: '定制阈值巡航 3x2km',
        plannedDistanceKm: 10,
        basePace: '4:30/km',
        mainSetSummary: '3 x 2000m @ 4:30'
      },
      [tomorrowStr]: {
        type: 'E',
        title: '定制轻松有氧恢复 8km',
        plannedDistanceKm: 8,
        basePace: '5:30/km',
        mainSetSummary: '8km 纯 Zone 2 对话跑'
      }
    }
  };

  const greenWellness = { hrvToday: 65, hrv7dAvg: 60, sleepScore: 86, bodyBatteryMorning: 88, rhrToday: 49, rhr7dAvg: 50 };
  const redWellness = { hrvToday: 38, hrv7dAvg: 60, sleepScore: 55, bodyBatteryMorning: 40, rhrToday: 57, rhr7dAvg: 50 };
  const pmc = computePmcSeries([], config.physiology, 14);
  const weeklyZones = computeWeeklyAndZones([], config.physiology);
  const envDays = [
    { date: todayStr, weatherText: '晴朗', tempC: 15, humidityPct: 50, dewPointC: 5, windMs: 2, usAqi: 40, elevationMeters: 45 },
    { date: tomorrowStr, weatherText: '高温微风', tempC: 28, humidityPct: 60, dewPointC: 20, windMs: 2, usAqi: 40, elevationMeters: 1800 }
  ];

  // 绿灯时：保留今天定制课表 + 明天高温海拔环境降速修正
  const greenPlan = buildDeterministicCoachPlan(
    {
      readiness: evaluateReadiness(greenWellness, pmc.latest),
      pmc,
      weeklyZones,
      wellness: greenWellness,
      envForecast: { daily: envDays },
      lastKeyWorkoutAudit: null,
      customPlan
    },
    config
  );

  assert.equal(greenPlan.planSource, 'antigravity-custom-plan');
  assert.ok(greenPlan.coachSummary.includes('本周左小腿紧绷'));
  assert.equal(greenPlan.days[0].isCustomPlan, true);
  assert.equal(greenPlan.days[0].title, '定制阈值巡航 3x2km');
  assert.equal(greenPlan.days[0].basePace, '4:30/km');
  assert.equal(greenPlan.days[1].isCustomPlan, true);
  assert.equal(greenPlan.days[1].basePace, '5:30/km');
  assert.notEqual(greenPlan.days[1].correctedPace, '5:30/km'); // 海拔+高温自动慢修

  // 红灯时：即使有定制阈值课表，仍安全熔断保护
  const redPlan = buildDeterministicCoachPlan(
    {
      readiness: evaluateReadiness(redWellness, pmc.latest),
      pmc,
      weeklyZones,
      wellness: redWellness,
      envForecast: { daily: envDays },
      lastKeyWorkoutAudit: null,
      customPlan
    },
    config
  );
  assert.equal(redPlan.days[0].type, 'REST');
  assert.ok(redPlan.days[0].title.includes('红灯熔断'));
});
