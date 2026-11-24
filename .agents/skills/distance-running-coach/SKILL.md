---
name: distance-running-coach
description: >-
  Use this skill when designing, analyzing, or adjusting 3K, 5K, 10K, Half
  Marathon (21.1km), or Full Marathon (42.2km) running plans, VDOT/Riegel
  training pace zones, lactate threshold (LT2) cruise intervals, aerobic
  durability/decoupling analysis, race-day fueling and gut training, pre-race
  taper schedules, strength economy sessions, or Garmin/FIT telemetry recovery
  gating.
---

# Distance Running Coach Skill (3K · 5K · 10K · Half & Full Marathon)

This workspace skill anchors long-distance coaching decisions (`3K` to `Full Marathon`) to the project's peer-reviewed distance knowledge base (`knowledge/`) and live watch telemetry pipeline while keeping strict separation between **measured telemetry**, **empirical model estimates (`VDOT`/`Riegel`)**, **personal tentative guardrails**, and **missing data**.

## Knowledge Base & Tools

- Distance physiology, durability, taper & fueling manual: [distance-training-bible.md](../../../knowledge/distance-training-bible.md)
- Standardized 3K–Marathon Decision Cards: [distance-session-catalog.md](../../../knowledge/distance-session-catalog.md)
- Polarized / Pyramidal TID guide: [polarized-training-bible.md](../../../knowledge/polarized-training-bible.md)
- Evidence registry & study limits (non-prompt): [evidence-notes.md](../../../knowledge/evidence-notes.md) & [knowledge/README.md](../../../knowledge/README.md)
- Distance pace, weather, fueling & taper CLI: [distance_pace_calc.mjs](./scripts/distance_pace_calc.mjs)
- Multi-day Garmin wellness range tool (shared): [fetch_wellness_range.mjs](../../800m-running-coach/scripts/fetch_wellness_range.mjs)

## Coaching Decision Workflow

1. **Telemetry Provenance, Readiness Gate & FIT Verification (`[程序规则 + 实测核查]`)**:
   - Inspect latest readiness (`data/private/dashboard-payload.json` or `dist/data/latest.json`) and verify whether HRV, resting HR, sleep, and Body Battery are `measured`, `stale_cache`, `config_baseline`, or `missing`. Never treat missing defaults as green readiness.
   - **FIT-Level Anomaly Verification**: For unexpected HR spikes, late-run decoupling, or pace/shoe discrepancies, inspect raw `.FIT` splits (`Pa:HR` decoupling on flat segments, running dynamics `cadence`/`GCT`/`VO`/`power`, and 1-second HR transitions) to distinguish optical PPG cadence-lock from true cardiac drift, dehydration, heat/dewpoint load, or fueling deficit.
   - Never schedule back-to-back quality sessions (`T` / `I` / `MP` long runs) or heavy lower-body strength days.
   - **ACWR (`[参考提示]`)**: Treat `ACWR > 1.35` (when `CTL >= 10`) strictly as a descriptive load-change cue to review alongside symptoms, weekly volume, and HRV/RHR — **never** an independent injury predictor or automatic stop rule.
   - **Pain & Injury Safety Boundary (`[安全边界]`)**: Never auto-diagnose unknown pain (e.g., blanket ITBS) or hand out generic rehab drills. Any pain `>= 3/10`, worsening during impact, localized bony tenderness (stress-reaction red flag), or pain altering gait stops impact running immediately until evaluated/resolved.

2. **Calibrate Current Fitness vs. Goal Pace (`[实证/估算区分]`)**:
   - Strictly separate **current proven race/time-trial fitness** from **future target race pace**. Prescribe `Easy (E)`, `Marathon (M)`, `Threshold (T / LT2)`, and `VO2max (I)` zones from current capability, not aspirational goal times.
   - Run [distance_pace_calc.mjs](./scripts/distance_pace_calc.mjs) only with a **recent maximal effort** (`3K`, `5K`, `10K`, `HM`, or `FM` within ~6–10 weeks). Pass `--submaximal true` for easy/observation runs so the CLI blocks race-time extrapolation.
   - **Riegel Durability Caveat**: Flag explicitly that Riegel (`exponent 1.06`) assumes distance-specific weekly volume. For runners with modest weekly mileage (e.g., `< 50–60 km/wk` targeting a marathon), surface the conservative marathon projection (`exponent ~1.10–1.12`) alongside the optimistic curve so they never blow up from an overly aggressive start pace.

3. **Periodize by Target Distance & Single-Variable Progression (`[周期与进阶]`)**:
   - Apply the unified 5-stage macrocycle (`Stage 0 Base → Stage 1 Build → Stage 2 Peak → Stage 3 PreComp → Stage 4 Taper`), upgrading stages only when **weekly volume/CTL + attendance consistency + injury clearance + next-day recovery** all pass.
   - Use **3-weeks-build / 1-week-absorb (`-20–30%` volume deload)** rhythm and adjust **at most one primary load variable** per week (total weekly mileage, long-run length, OR quality-session volume — never all three at once).
   - Keep **single long runs `<= 30–35%` of weekly volume** and cap novice/intermediate continuous long runs at `~2.5–3.0 hours` to protect musculoskeletal durability.
   - Enforce **distance-specific exponential Taper** (Bosquet et al., 2007): `3K/5K: 7–10 days`, `10K/HM: 10–14 days`, `Full Marathon: 14–21 days` — cut volume `40–60%` progressively while maintaining run frequency `>= 80%` and short race-pace sharpening (`DIST-TAPER-SHARP`).

4. **Select Sessions via Decision Cards (`[决策卡执行]`)**:
   - Pick workouts strictly from [distance-session-catalog.md](../../../knowledge/distance-session-catalog.md) matching target distance and stage:
     - **3K / 5K**: `DIST-THR-CRUISE` (`5–7×1K @ LT2`, `60s` rest) + `DIST-VO2-3K5K` (`5–6×1K` or `4–5×1200m @ 3K–5K`, `2–3 min` rest) + `DIST-STRIDES`.
     - **10K**: `DIST-THR-CRUISE` (`4–6×2K @ LT2`, `60–90s` rest) + `DIST-10K-SPECIFIC` (`5–6×1600m` or `4–5×2K @ 10K`, `90s–2 min` rest) + `14–18km` aerobic long run.
     - **Half Marathon**: `DIST-THR-TEMPO` (`2×15–20 min` or `25–35 min @ LT2/HM`) + `DIST-HM-SPECIFIC` (`3×4K` or `2×5–6K @ HM`) + `18–22km` progressive long run + `DIST-FUEL-GUT`.
     - **Full Marathon**: High aerobic base (`>= 80%` easy) + `DIST-THR-CRUISE` + alternating `DIST-LONG-PROG` & `DIST-MP-BLOCK` (`24–32km` w/ `2×6–8K` or `10–14K @ MP`, max once every 2 weeks) + mandatory `DIST-FUEL-GUT`.
   - **Norwegian Double-Threshold Guardrail**: Do NOT prescribe two threshold sessions in one day unless the runner sustains `>= 100+ km/wk` with verified lactate/HR control; standard single cruise-threshold sessions deliver the vast majority of benefit safely.
   - **Strength (`DIST-STR-ECONOMY`)**: Keep gym work concise (`1–2` lower compound lifts `3×5–6 @ RIR 2–3` + soleus/gastroc calf raises + optional low-volume plyometrics when pain-free, `1–2×/wk`, `>= 24–48h` away from key workouts; drop heavy lower-body lifting in the final `7–10` taper days).

5. **Enforce Fueling, Weather & Post-Race Recovery Protocols (`[营养与环境]`)**:
   - **Weather / Dewpoint Slowdown**: Always pass race/session temperature & humidity into `distance_pace_calc.mjs` (or `computeEnvironmentalAdjustment`) and actively adjust `E/M/T` paces upward when heat/dewpoint rises.
   - **Half & Full Marathon Fueling**:
     - Carb-loading (`36–48h` pre-race at `8–12 g CHO/kg/day`, low fiber/fat) for events `> 90 min`.
     - In-race carbs: `HM: 30–60 g/h`; `Full Marathon: 60–90 g/h` (use dual-source glucose:fructose blends when `> 60 g/h`).
     - Rehearse the exact gel brand, timing, and hydration across `>= 4–6` long runs (`DIST-FUEL-GUT`) before race day.
   - **Post-Marathon Protection**: Enforce `5–7` days of zero/minimal impact after a full marathon and `3–4` weeks of easy aerobic rebuilding before reintroducing quality intervals.

6. **Cross-Device Sync & Verification**:
   - Follow workspace rules in `AGENTS.md` (pull latest state from live server before advising, merge check-ins cleanly, re-render dashboard, sync Garmin Connect calendar via IPv4 flags when plans change, and run `npm test` after code/config edits).
