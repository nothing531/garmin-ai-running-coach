import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDistanceProfile,
  estimateVdot,
  parseTimeToSeconds,
} from '../.agents/skills/distance-running-coach/scripts/distance_pace_calc.mjs';

test('parseTimeToSeconds handles MM:SS and H:MM:SS cleanly', () => {
  assert.equal(parseTimeToSeconds('19:30'), 1170);
  assert.equal(parseTimeToSeconds('1:30:15'), 5415);
  assert.equal(parseTimeToSeconds('bad'), null);
});

test('submaximal observation runs are blocked from race extrapolation', () => {
  const res = calculateDistanceProfile({
    raceKm: 10,
    time: '48:00',
    submaximal: true,
  });
  assert.equal(res.status, 'OBSERVATION_ONLY');
  assert.match(res.warning, /CANNOT be fed into VDOT or Riegel/i);
});

test('5K 20:00 produces sensible VDOT (~49.8), training zones, and conservative marathon projection', () => {
  const vdot = estimateVdot(5, 1200);
  assert.ok(vdot > 48 && vdot < 52, `Unexpected VDOT: ${vdot}`);

  const res = calculateDistanceProfile({
    raceKm: 5,
    time: '20:00',
    targetKm: 42.195,
    weeklyKm: 45,
    weightKg: 65,
    tempC: 24,
    humidity: 70,
  });

  assert.equal(res.status, 'CALIBRATED_ESTIMATE');
  assert.equal(res.fueling.needsCarbLoad, true);
  assert.match(res.fueling.inRaceChoGramsPerHr, /60–90 g\/h/);
  assert.ok(res.weather.slowdownPct > 0, 'Warm & humid conditions should produce positive slowdown');
  assert.match(res.taper.windowDays, /14–21 days/);
  assert.match(res.targetRaceProjection.durabilityWarning, /modest/i);
});

test('5K target distance does not prescribe marathon carb-loading', () => {
  const res = calculateDistanceProfile({
    raceKm: 5,
    time: '18:30',
    targetKm: 5,
  });
  assert.equal(res.fueling.needsCarbLoad, false);
  assert.match(res.taper.windowDays, /7–10 days/);
});
