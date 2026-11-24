import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimeSec,
  estimateMas,
  estimateMasWithMeta,
  estimateMss,
  estimateMssWithMeta,
  classify800mSubgroup,
  buildAsrProfile
} from '../.agents/skills/800m-running-coach/scripts/asr_800m_calc.mjs';

test('parseTimeSec parses M:SS and decimal seconds', () => {
  assert.equal(parseTimeSec('2:01.0'), 121);
  assert.equal(parseTimeSec('10:30'), 630);
  assert.equal(parseTimeSec('6.65'), 6.65);
});

test('estimateMasWithMeta distinguishes empirical formulas vs heuristic estimates', () => {
  const meta2k = estimateMasWithMeta({ ttDistMeters: 2000, ttTimeSec: 400 });
  assert.ok(Math.abs(meta2k.masMps - 5.0) < 0.01);
  assert.equal(meta2k.confidence, 'empirical_formula');

  const meta3k = estimateMasWithMeta({ ttDistMeters: 3000, ttTimeSec: 600 });
  assert.ok(meta3k.masMps > 5.2 && meta3k.masMps < 5.35);
  assert.equal(meta3k.confidence, 'heuristic_estimate');
  assert.ok(meta3k.assumption.includes('3000m'));

  const metaLt = estimateMasWithMeta({ ltPaceSecPerKm: 285 });
  assert.equal(metaLt.sourceType, 'lt_heuristic_fallback');
  assert.equal(estimateMas({ ltPaceSecPerKm: 285 }) > 4.0, true);
});

test('estimateMssWithMeta marks standing sprint scaling as heuristic assumption', () => {
  const standing = estimateMssWithMeta({ sprintDistM: 50, sprintTimeSec: 6.7, isStandingStart: true });
  assert.equal(standing.confidence, 'heuristic_estimate');
  assert.ok(standing.assumption.includes('1.11'));

  const flying = estimateMssWithMeta({ sprintDistM: 30, sprintTimeSec: 3.6, isStandingStart: false });
  assert.equal(flying.confidence, 'field_measured');
  assert.ok(Math.abs(estimateMss({ sprintDistM: 30, sprintTimeSec: 3.6, isStandingStart: false }) - 8.333) < 0.01);
});

test('classify800mSubgroup preserves pending when tests are invalid and labels SRR as reference cohort', () => {
  assert.equal(classify800mSubgroup(1.62, { hasValidFieldTests: false }).id, 'pending');
  assert.equal(classify800mSubgroup(1.62).id, '400_800_speed');
  assert.equal(classify800mSubgroup(1.52).id, '800_specialist');
  assert.equal(classify800mSubgroup(1.42).id, '800_1500_endurance');
});

test('buildAsrProfile avoids fake calibration without field tests and outputs provenance when tested', () => {
  const pending = buildAsrProfile({
    masMps: null,
    mssMps: null,
    masMeta: estimateMasWithMeta({}),
    mssMeta: estimateMssWithMeta({})
  });
  assert.equal(pending.calibrated, false);
  assert.equal(pending.subgroup.id, 'pending');
  assert.equal(pending.zones.length, 0);

  const mssMeta = estimateMssWithMeta({ sprintDistM: 30, sprintTimeSec: 3.6, isStandingStart: false });
  const masMeta = estimateMasWithMeta({ ttDistMeters: 2000, ttTimeSec: 400 });
  const profile = buildAsrProfile({
    masMps: masMeta.masMps,
    mssMps: mssMeta.mssMps,
    masMeta,
    mssMeta,
    goal800Sec: 121,
    weeklyKm: 14,
    stage: 'Base'
  });

  assert.equal(profile.calibrated, true);
  assert.equal(profile.masMps, 5.0);
  assert.equal(profile.mssMps, 8.33);
  assert.equal(profile.asrMps, 3.33);
  assert.equal(profile.srr, 1.67);
  assert.ok(profile.trainingContext.advisories.length > 0);

  const rpZone = profile.zones.find((z) => z.key === 'goal_rp');
  assert.equal(rpZone.splits['200m'], '30.3s');
  assert.equal(rpZone.splits['400m'], '1:00.5');
});

test('亚极量恢复观察测试绝不能当作全力计时套用 MAS/ASR 标定', () => {
  const obsMas = estimateMasWithMeta({ ttDistMeters: 3000, ttTimeSec: 840, isSubmaximal: true });
  assert.equal(obsMas.masMps, null);
  assert.equal(obsMas.sourceType, 'submaximal_observation_only');
  assert.equal(obsMas.confidence, 'observation_only');
  assert.ok(obsMas.assumption.includes('Thron'));

  const mssMeta = estimateMssWithMeta({ sprintDistM: 30, sprintTimeSec: 3.6, isStandingStart: false });
  const uncalibrated = buildAsrProfile({
    masMps: obsMas.masMps,
    mssMps: mssMeta.mssMps,
    masMeta: obsMas,
    mssMeta
  });
  assert.equal(uncalibrated.calibrated, false);
  assert.equal(uncalibrated.calibrationStatus, 'pending_field_tests');
  assert.equal(uncalibrated.subgroup.id, 'pending');
  assert.equal(uncalibrated.zones.length, 0);
});
