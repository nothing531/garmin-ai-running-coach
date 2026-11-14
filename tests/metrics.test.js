import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAerobicDecoupling,
  computeEnvironmentalAdjustment,
  computePmcSeries,
  computeWeeklyAndZones,
  evaluateReadiness
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
