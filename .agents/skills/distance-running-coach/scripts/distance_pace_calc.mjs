#!/usr/bin/env node
/**
 * 3K - Full Marathon Training Pace, Equivalent Race, Weather & Fueling CLI
 * Usage examples:
 *   node .agents/skills/distance-running-coach/scripts/distance_pace_calc.mjs --race-km 10 --time 41:30 --target-km 42.195 --weekly-km 55 --weight-kg 65 --temp-c 22 --humidity 68
 *   node .agents/skills/distance-running-coach/scripts/distance_pace_calc.mjs --race-km 5 --time 18:45 --target-km 21.0975
 *   node .agents/skills/distance-running-coach/scripts/distance_pace_calc.mjs --race-km 10 --time 48:00 --submaximal true
 */

import { fileURLToPath } from 'node:url';

export function parseTimeToSeconds(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function formatTime(totalSec) {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return '--:--';
  const rounded = Math.round(totalSec);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '--:--/km';
  const rounded = Math.round(secPerKm);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

/**
 * Daniels & Gilbert (1979) Oxygen Cost & %VO2max empirical VDOT approximation
 * Strictly labeled as [程序估算 / 经验模型], never lab-measured VO2max.
 */
export function estimateVdot(distanceKm, timeSec) {
  const distM = distanceKm * 1000;
  const timeMin = timeSec / 60;
  const v = distM / timeMin; // m/min
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pctMax =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * timeMin) +
    0.2989558 * Math.exp(-0.1932605 * timeMin);
  return vo2 / pctMax;
}

/**
 * Invert Daniels oxygen cost equation for target VO2 (ml/kg/min) -> velocity (m/min)
 */
function velocityForVo2(targetVo2) {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - targetVo2;
  const disc = b * b - 4 * a * c;
  return (-b + Math.sqrt(Math.max(0, disc))) / (2 * a);
}

/**
 * Riegel power-law equivalent time: T2 = T1 * (D2 / D1)^exponent
 */
export function riegelPredictSec(baseKm, baseSec, targetKm, exponent = 1.06) {
  return baseSec * Math.pow(targetKm / baseKm, exponent);
}

/**
 * Heat + Dewpoint pace slowdown approximation (empirical coaching heuristic)
 */
export function estimateHeatSlowdownPct(tempC, humidityPct) {
  if (!Number.isFinite(tempC)) return { slowdownPct: 0, dewPointC: null, note: 'No weather input' };
  const hum = Number.isFinite(humidityPct) ? Math.max(10, Math.min(100, humidityPct)) : 50;
  const dewPointC = tempC - (100 - hum) / 5;
  const tempF = (tempC * 9) / 5 + 32;
  const dewF = (dewPointC * 9) / 5 + 32;
  const sumF = tempF + dewF;
  let slowdownPct = 0;
  if (sumF > 100) {
    if (sumF <= 110) slowdownPct = 0.5;
    else if (sumF <= 120) slowdownPct = 1.2;
    else if (sumF <= 130) slowdownPct = 2.2;
    else if (sumF <= 140) slowdownPct = 3.8;
    else if (sumF <= 150) slowdownPct = 5.5;
    else slowdownPct = 7.5;
  }
  return {
    slowdownPct,
    dewPointC: Number(dewPointC.toFixed(1)),
    heatIndexSumF: Math.round(sumF),
    note:
      slowdownPct === 0
        ? 'Cool/optimal conditions — no weather pace adjustment required'
        : `Temp+Dewpoint sum ${Math.round(sumF)}°F — slow aerobic/MP/T paces by ~${slowdownPct}% and monitor HR/effort`,
  };
}

export function buildFuelingPlan(targetKm, predictedTimeSec, weightKg = 65) {
  const durationMin = predictedTimeSec / 60;
  const durationHr = durationMin / 60;
  if (targetKm <= 10.5 || durationMin < 65) {
    return {
      needsCarbLoad: false,
      inRaceChoGramsPerHr: '0–15 g/h (water or carb mouth-rinse only)',
      suggestedGels: 0,
      note: 'Events <= 60 min are rarely glycogen-limited; normal balanced meals + pre-race light snack suffice.',
    };
  }
  const isMarathon = targetKm >= 35;
  const choMin = isMarathon ? 60 : 30;
  const choMax = isMarathon ? 90 : 60;
  const targetMid = isMarathon ? 70 : 45;
  const gelGrams = 25;
  const estGels = Math.max(2, Math.round((targetMid * durationHr) / gelGrams));
  return {
    needsCarbLoad: true,
    carbLoadWindow: '36–48h pre-race (low fiber / low fat)',
    carbLoadGramsPerDay: `${Math.round(weightKg * 8)}–${Math.round(weightKg * 12)} g/day (${weightKg} kg × 8–12 g/kg)`,
    inRaceChoGramsPerHr: `${choMin}–${choMax} g/h${isMarathon ? ' (use glucose:fructose dual-source gels above 60 g/h)' : ''}`,
    suggestedGels: estGels,
    gelTiming: isMarathon ? 'Every 25–30 min starting at ~25–30 min' : '15 min pre-start + ~35–40 min (and ~70 min if >95 min)',
    hydrationMlPerHr: '400–800 ml/h (adjust to sweat rate & weather; avoid over-drinking plain water)',
    sodiumMgPerHr: '300–700 mg/h',
    gutTrainingRule: 'Rehearse this exact gel brand & schedule across >= 4–6 long runs before race day.',
  };
}

export function buildTaperPlan(targetKm) {
  if (targetKm <= 6) {
    return {
      windowDays: '7–10 days',
      volumeCutPct: '35–45% in race week',
      frequencyRule: 'Maintain >= 80% of normal run days',
      keySharpener: '4–6 × 400m @ 5K pace (2 min walk/jog rest) at 4–5 days out',
      strengthRule: 'Stop heavy lower-body lifting 7 days out',
    };
  }
  if (targetKm <= 22) {
    return {
      windowDays: '10–14 days',
      volumeCutPct: 'Week -2: -20–25% · Race Week: -45–55%',
      frequencyRule: 'Maintain >= 80% of normal run days',
      keySharpener: '4 × 1000m @ race pace (2 min jog rest) at 5–6 days out',
      strengthRule: 'Drop heavy lower-body lifting 7–10 days out',
    };
  }
  return {
    windowDays: '14–21 days (Bosquet et al. 2007 exponential taper)',
    volumeCutPct: 'Week -3: -20% · Week -2: -40% · Race Week: -60%',
    frequencyRule: 'Keep >= 80% of normal run frequency with short easy runs + strides',
    keySharpener: '3–4 × 1600m @ Marathon Pace (2 min jog rest) at 6–7 days out',
    strengthRule: 'Stop heavy lower-body lifting 10 days out',
  };
}

export function calculateDistanceProfile(opts) {
  const raceKm = Number(opts.raceKm);
  const timeSec = parseTimeToSeconds(opts.time);
  const targetKm = Number(opts.targetKm || raceKm);
  const weeklyKm = Number.isFinite(Number(opts.weeklyKm)) ? Number(opts.weeklyKm) : null;
  const weightKg = Number.isFinite(Number(opts.weightKg)) ? Number(opts.weightKg) : 65;
  const submaximal = opts.submaximal === true || opts.submaximal === 'true';

  if (!Number.isFinite(raceKm) || raceKm < 1.5 || raceKm > 50) {
    throw new Error('raceKm must be between 1.5 and 50 km (use asr_800m_calc.mjs for 800m).');
  }
  if (!Number.isFinite(timeSec) || timeSec <= 0) {
    throw new Error('Provide a valid --time (e.g. 19:30, 41:20, or 1:32:00).');
  }

  if (submaximal) {
    return {
      status: 'OBSERVATION_ONLY',
      warning:
        'Submaximal / observation runs CANNOT be fed into VDOT or Riegel race-prediction formulas. Use this run only to track HR-pace drift and recovery; calibrate zones after a fresh maximal 3K–10K effort.',
      input: { raceKm, time: formatTime(timeSec), avgPace: formatPace(timeSec / raceKm) },
    };
  }

  const vdot = estimateVdot(raceKm, timeSec);
  const weather = estimateHeatSlowdownPct(
    opts.tempC !== undefined ? Number(opts.tempC) : NaN,
    opts.humidity !== undefined ? Number(opts.humidity) : NaN
  );
  const weatherFactor = 1 + weather.slowdownPct / 100;

  // Empirical Daniels-aligned %VO2max training intensities [程序估算]
  const paceAtPct = (pct) => (1000 / velocityForVo2(vdot * pct)) * 60;
  const easyFast = paceAtPct(0.74);
  const easySlow = paceAtPct(0.65);
  const marathonSec = paceAtPct(0.825);
  const thresholdSec = paceAtPct(0.88);
  const intervalSec = paceAtPct(0.975);
  const repSec = paceAtPct(1.05);

  // Riegel standard (1.06) vs durability-conservative (1.10 when weekly volume is modest for HM/FM)
  const lowVolumeForTarget =
    (targetKm >= 35 && (weeklyKm === null || weeklyKm < 65)) ||
    (targetKm >= 20 && targetKm < 35 && weeklyKm !== null && weeklyKm < 40);
  const conservativeExp = targetKm >= 35 ? 1.11 : 1.08;

  const distances = [
    { label: '3K', km: 3 },
    { label: '5K', km: 5 },
    { label: '10K', km: 10 },
    { label: 'Half Marathon', km: 21.0975 },
    { label: 'Full Marathon', km: 42.195 },
  ];

  const equivalents = distances.map((d) => {
    const stdSec = riegelPredictSec(raceKm, timeSec, d.km, 1.06);
    const consSec = d.km > raceKm ? riegelPredictSec(raceKm, timeSec, d.km, d.km >= 35 ? 1.11 : 1.08) : stdSec;
    return {
      distance: d.label,
      standardTime: formatTime(stdSec),
      standardPace: formatPace(stdSec / d.km),
      conservativeTime: formatTime(consSec),
      conservativePace: formatPace(consSec / d.km),
    };
  });

  const targetPredStdSec = riegelPredictSec(raceKm, timeSec, targetKm, 1.06);
  const targetPredConsSec =
    targetKm > raceKm ? riegelPredictSec(raceKm, timeSec, targetKm, conservativeExp) : targetPredStdSec;

  return {
    status: 'CALIBRATED_ESTIMATE',
    evidenceTag: '[程序估算 / VDOT + Riegel 经验模型 — 非实验室血乳酸/代谢车实测]',
    input: {
      raceKm,
      time: formatTime(timeSec),
      avgPace: formatPace(timeSec / raceKm),
      targetKm,
      weeklyKm,
      weightKg,
    },
    estimatedVdot: Number(vdot.toFixed(1)),
    trainingPaces: {
      easy: {
        base: `${formatPace(easyFast)} – ${formatPace(easySlow)}`,
        weatherAdjusted: `${formatPace(easyFast * weatherFactor)} – ${formatPace(easySlow * weatherFactor)}`,
        purpose: 'Aerobic base & recovery (pair with talk-test + personal HR cap)',
      },
      marathon: {
        base: formatPace(marathonSec),
        weatherAdjusted: formatPace(marathonSec * weatherFactor),
        purpose: 'Aerobic durability & MP-block long runs',
      },
      thresholdLT2: {
        base: formatPace(thresholdSec),
        weatherAdjusted: formatPace(thresholdSec * weatherFactor),
        purpose: 'LT2 cruise intervals (1K–3K, 60–90s rest) & 20–30 min tempo',
      },
      intervalVO2max: {
        base: formatPace(intervalSec),
        weatherAdjusted: formatPace(intervalSec * weatherFactor),
        purpose: 'tVO2max long intervals (800m–1200m, 2–3 min jog/walk rest)',
      },
      repetition: {
        base: formatPace(repSec),
        weatherAdjusted: formatPace(repSec),
        purpose: 'Short neuromuscular economy / strides (full recovery)',
      },
    },
    equivalents,
    targetRaceProjection: {
      targetKm,
      optimisticRiegel106: {
        time: formatTime(targetPredStdSec),
        pace: formatPace(targetPredStdSec / targetKm),
      },
      durabilityConservative: {
        exponent: targetKm > raceKm ? conservativeExp : 1.06,
        time: formatTime(targetPredConsSec),
        pace: formatPace(targetPredConsSec / targetKm),
      },
      durabilityWarning: lowVolumeForTarget
        ? 'Weekly mileage is modest or unspecified for this target distance; start closer to the conservative pace unless proven by 24–32km MP blocks with <5% HR decoupling.'
        : 'Projected pacing assumes consistent race-specific long runs and completed gut-training rehearsals.',
    },
    weather,
    fueling: buildFuelingPlan(targetKm, lowVolumeForTarget ? targetPredConsSec : targetPredStdSec, weightKg),
    taper: buildTaperPlan(targetKm),
  };
}

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const opts = parseCliArgs(process.argv.slice(2));
    const result = calculateDistanceProfile(opts);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error(
      'Usage: node distance_pace_calc.mjs --race-km <3|5|10|21.0975|42.195> --time <MM:SS|H:MM:SS> [--target-km <km>] [--weekly-km <km>] [--weight-kg <kg>] [--temp-c <C>] [--humidity <%>] [--submaximal true]'
    );
    process.exit(1);
  }
}
