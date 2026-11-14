import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimeSec,
  estimateMas,
  estimateMss,
  classify800mSubgroup,
  buildAsrProfile
} from '../.agents/skills/800m-running-coach/scripts/asr_800m_calc.mjs';

test('parseTimeSec parses M:SS and decimal seconds', () => {
  assert.equal(parseTimeSec('2:01.0'), 121);
  assert.equal(parseTimeSec('10:30'), 630);
  assert.equal(parseTimeSec('6.65'), 6.65);
});

test('estimateMas uses Bellenger equation for 1500-2000m and scales 3000m / LT correctly', () => {
  // 2000m in 6:40 (400s => 5.0 m/s): 5.0 * (0.766 + 0.117 * 2) = 5.0 m/s exactly
  const mas2k = estimateMas({ ttDistMeters: 2000, ttTimeSec: 400 });
  assert.ok(Math.abs(mas2k - 5.0) < 0.01);

  // 3000m in 10:00 (600s => 5.0 m/s): ~5.28 m/s
  const mas3k = estimateMas({ ttDistMeters: 3000, ttTimeSec: 600 });
  assert.ok(mas3k > 5.2 && mas3k < 5.35);

  // LT pace 4:45/km (285s/km => 3.51 m/s): ~4.08 m/s
  const masLt = estimateMas({ ltPaceSecPerKm: 285 });
  assert.ok(masLt > 4.0 && masLt < 4.15);
});

test('classify800mSubgroup aligns with Sandford (2019) SRR cutoffs', () => {
  assert.equal(classify800mSubgroup(1.62).id, '400_800_speed');
  assert.equal(classify800mSubgroup(1.52).id, '800_specialist');
  assert.equal(classify800mSubgroup(1.42).id, '800_1500_endurance');
});

test('buildAsrProfile generates accurate sub-2:01 splits and ASR domain', () => {
  const mssMps = estimateMss({ sprintDistM: 30, sprintTimeSec: 3.6, isStandingStart: false }); // ~8.33 m/s
  const masMps = estimateMas({ ttDistMeters: 2000, ttTimeSec: 400 }); // 5.0 m/s
  const profile = buildAsrProfile({ masMps, mssMps, goal800Sec: 121 });

  assert.equal(profile.masMps, 5.0);
  assert.equal(profile.mssMps, 8.33);
  assert.equal(profile.asrMps, 3.33);
  assert.equal(profile.srr, 1.67);
  assert.equal(profile.subgroup.id, '400_800_speed');

  const rpZone = profile.zones.find((z) => z.key === 'goal_rp');
  assert.equal(rpZone.splits['200m'], '30.3s');
  assert.equal(rpZone.splits['400m'], '1:00.5');
});
