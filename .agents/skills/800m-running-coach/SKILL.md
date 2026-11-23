---
name: 800m-running-coach
description: >-
  Use this skill when designing, analyzing, or adjusting 800m track training,
  interval workouts, Anaerobic Speed Reserve (ASR/SRR) estimation, gym strength
  progression, or Garmin-telemetry recovery gating for the athlete targeting
  sub-2:01 in the 800m.
---

# 800m Specialist & Interval Coaching Skill

This workspace skill anchors coaching decisions to the athlete's 800m knowledge
base (`knowledge/`) and live Garmin telemetry pipeline while keeping strict
separation between **measured data**, **empirical estimates**, **personal
tentative rules**, and **missing data**.

## Knowledge Base & Tools

- Physiology & methodology reference: [800m-interval-bible.md](../../../knowledge/800m-interval-bible.md)
- Polarized TID & speed-purpose guide: [polarized-training-bible.md](../../../knowledge/polarized-training-bible.md)
- Periodized track & strength catalog: [interval-session-catalog.md](../../../knowledge/interval-session-catalog.md)
- Evidence registry & errata (non-prompt): [evidence-notes.md](../../../knowledge/evidence-notes.md) & [knowledge/README.md](../../../knowledge/README.md)
- Athlete telemetry & config: [runner.config.json](../../../config/runner.config.json) & [custom-plan.json](../../../config/custom-plan.json)
- ASR & split-pace estimator CLI: [asr_800m_calc.mjs](./scripts/asr_800m_calc.mjs)

## Coaching Decision Workflow

1. **Telemetry Provenance & Readiness Gate First (`[程序规则]`)**:
   - Inspect latest Garmin readiness (`data/private/dashboard-payload.json` or `dist/data/latest.json` public stub) — verify whether HRV, resting HR, sleep, and Body Battery are `measured`, `stale_cache`, `config_baseline`, or `missing`. Never treat missing defaults as good readiness.
   - **FIT-Level Anomaly Verification (`[实测核查]`)**: When the athlete reports unexpected high HR, pacing drift, or gear/shoe differences, inspect raw FIT telemetry (`device_infos`, pure-segment splits excluding strides/walks, running dynamics `cadence`/`GCT`/`VO`/`step_length`/`power`, and 1-second HR transitions) rather than whole-activity averages alone. Cross-check optical PPG lag/cadence interference (e.g., HR flat/dipping during a surge then spiking right after stopping to walk) against subjective breathlessness, manual pulse checks, fueling state (fasted vs. fed), and weather/altitude before attributing changes to shoes or fitness.
   - Never schedule back-to-back high-intensity track (`T`/`I`/`R`) or heavy lower-body strength days.
   - **ACWR (`[参考提示]`)**: `ACWR > 1.35` (when `CTL >= 10`) is an advisory load-change cue to review alongside symptoms, recent running volume, and HRV/RHR — **never** an independent injury predictor or standalone stop rule (especially during return-to-run when `CTL` is near zero).
   - **Pain & Rest Protection (`[安全边界]`)**: Do NOT auto-diagnose ITBS and do NOT prescribe isometric wall sits, eccentric heel drops, or foam rolling as a blanket fix for any pain. Any pain `>= 3/10` or altering running mechanics stops impact running until evaluated/resolved. Note only as personal history that the athlete's prior lateral-knee issue responded well to isometric wall sits when tolerated.
2. **Determine ASR & Separate Observation Runs vs Capacity Calibration (`[实证/估算区分]`)**:
   - Strictly separate **recovery/pace-HR observation tests** (such as Stage 0 submaximal progressive 3000m runs) from **maximal capacity calibration tests**. Never feed submaximal observation times into `MAS`/`ASR` time-trial formulas (`--submaximal true`), and note that different MAS test protocols yield different absolute values (Thron et al., 2024).
   - Run `asr_800m_calc.mjs` only with explicit maximal field-test results (`1500–3000m` TT and `20–50m` sprint). Without valid tests, retain **`亚型待定`**.
   - Clearly distinguish Bellenger `1500–2000m` formula from empirical `3000m -> MAS` or standing-start `MSS` multipliers (`[经验推算]`). Never apply elite Sandford `SRR` cutoffs as fixed personal talent labels, and always combine `MAS`, `MSS`, recent weekly volume, and completion feedback before choosing sessions.
   - Separate **current training capability pace** from **remote `2:01` goal pace** (`60.5s/400m`).
3. **Feedback-Gated Weekly Progression & Macro Stage Separation (`[周期与进阶]`)**:
   - Keep a **consistent weekly skeleton**; do **not** escalate weekly volume, easy pace, or gym weights merely by calendar week.
   - At weekly review, adjust **at most one primary load variable** per week, and only after stable completion, pain-free gait, and good next-day recovery; hold or regress if recovery lags. Let easy-run pace improve naturally under the same breath/HR cap.
   - Keep **strength sessions concise** (1–2 main lower compound lifts + 1 calf/posterior accessory); track load, sets×reps, **RIR** (reps in reserve), and next-day reaction before small increments — remembering strength gains improve running economy/stiffness, not an automatic 1:1 800m speed guarantee (Llanos-Lagos et al., 2024).
   - Split preparation into **5 distinct stages**: `Stage 0 Base` → `Stage 1 Build` → `Stage 2 Peak (VO2/specific prep)` → `Stage 3 PreComp (race-pace conversion)` → `Stage 4 Taper (~1–2 week individualized pre-race taper window, NOT 7 weeks)` (Haugen et al., 2021). Upgrade stages only when volume/CTL **and** attendance, injury clearance, next-day recovery, and key-session/test gates are satisfied.
4. **Prescribe Intervals by Decision Cards (`[实证/教练经验]`)**:
   - Use the **Decision Cards** in [interval-session-catalog.md](../../../knowledge/interval-session-catalog.md) (including purpose, stage, start gate, dosage range, progression gate, regression gate, and evidence limits) and match rest strictly to session purpose:
     * **`SPD-STRIDES` (`Stage 0b-4`)**: Submaximal `85–92%` `50–60m` strides at end of warm-up/easy run (`2x/week`) with **`90–120s` walk rest**.
     * **`SPD-ACCEL` (`Stage 1-3`)**: Standing-start `0–40/50m` acceleration with **`2.5–3 min` rep rest / `5–6 min` set rest**.
     * **`MSS` (`Stage 1-4`)**: Flying `20–30m` at `>= 95% MSS` with **`3–6 min` full CNS recovery** and `>= 48h` between maximal speed days.
     * **`SE` (`Stage 3 PreComp` / `Stage 4` only, `~3–6` weeks out)**: `500+300` / `600+200` / `3×300–400m` with `45s` split rest / `8–12 min` set rest, max `1x / 7–10 days`.
5. **Enforce Sensible Intensity Separation (`[个人暂定 + 实证]`)**:
   - **Easy (`E`/`LSD`)**: Cap at **`<= 152–154 bpm`** (`~83–84%` of device-estimated `LTHR=183`), explicitly treated as a **`[个人暂定上限]`** (not a lab-measured `LT1`) paired with talk-test breathing. Treat cadence and footstrike strictly as observational cues, not rigid fixed mandates.
   - **Polarization Index (`PI`)**: Treat `PI > 2.00` strictly as a descriptive summary metric of training intensity distribution (`Treff 2019`), **never** distorting sensible 800m periodized workouts just to chase a `PI` number.
6. **Enforce Stopping & Compliance Rules (`[教练经验]`)**:
   - Track sessions specify exact splits, rest, and a drop-off cutoff (`>3%` slower on 2 consecutive speed/RP reps, or pain altering gait -> stop session).
   - Output coaching explanations clearly covering: what data was used (including gaps), why adjusted, what changed, and what to monitor next — no forced jargon or unverified persona.
   - **Single-Source-of-Truth Cross-Device & Website Sync (`[多端与网站同步]`)**:
     * Treat `huawei-sg:/opt/garmin-coach` (live server + website) as the **single source of truth** shared across Windows, Mac, and mobile web check-ins.
     * **Pull First (Start of Session)**: Before giving coaching advice or editing plans/check-ins on any machine (Windows or Mac), first inspect/pull the latest `data/private/checkins.json`, `config/custom-plan.json`, `config/runner.config.json`, and `data/private/telemetry-cache.json` from `huawei-sg:/opt/garmin-coach` (never rely on stale local files from an older session on that device).
     * **Persist & Push Back (End of Every Feedback Session)**: Persist every daily subjective feedback, symptom/pain change, shoe/gear note, fueling note, strength load/RIR, and key coaching conclusion into `data/private/checkins.json` (180-day structured ledger read automatically by the planning engine and website). Always merge with remote `checkins.json` first (never overwrite phone/website-submitted entries), sync updated files (`checkins.json`, `custom-plan.json`, `runner.config.json`) to `huawei-sg:/opt/garmin-coach` (`chmod 600` on private files), and run `cd /opt/garmin-coach && node src/index.js --render-only` so both `data/private/dashboard-payload.json` and `PUBLISH_DIR` (`/var/www/garmin-coach`) reflect the latest state immediately for every device.
     * Whenever creating or adjusting training plans/targets (`config/custom-plan.json`, HR/pace zones, deloads, or rest swaps), always sync the updated structured workouts to the Garmin Connect calendar via `npm run sync-workouts -- --days 5` (or `--date YYYY-MM-DD` for targeted days) so stale `[AI] MM-DD` calendar entries are replaced cleanly.
   - Always run `npm test` after code/config edits.
