---
name: 800m-running-coach
description: >-
  Use this skill when designing, analyzing, or adjusting 800m track training,
  interval workouts, Anaerobic Speed Reserve (ASR/SRR) profiling, gym strength
  progression, or Garmin-telemetry recovery gating for the athlete targeting
  sub-2:01 in the 800m.
---

# 800m Specialist & Interval Coaching Skill

This workspace skill anchors Antigravity's coaching decisions to the athlete's
scientific 800m knowledge base (`knowledge/`) and live Garmin telemetry pipeline.

## Knowledge Base & Tools

- Primary physiology & methodology bible:
  [800m-interval-bible.md](../../../knowledge/800m-interval-bible.md)
- Periodized track & strength interval session library:
  [interval-session-catalog.md](../../../knowledge/interval-session-catalog.md)
- Source archive index (Sandford 2018 PhD thesis + 11 Open-Access PMC papers):
  [knowledge/README.md](../../../knowledge/README.md)
- Athlete live telemetry & config:
  [runner.config.json](../../../config/runner.config.json) and
  [custom-plan.json](../../../config/custom-plan.json)
- ASR & split-pace calculator CLI:
  [asr_800m_calc.mjs](./scripts/asr_800m_calc.mjs)

## Coaching Decision Workflow

1. **Telemetry & Readiness Gate First**:
   - Inspect latest Garmin readiness (`dist/data/latest.json` or run `npm run coach` after edits) — sleep duration/score, HRV trend, resting HR delta, `CTL/ATL/TSB/ACWR`, and acute pain/ITBS feedback.
   - Never schedule back-to-back high-intensity track or heavy squat days.
   - When passive sleep/HRV metrics show 2+ stacked fatigue signals OR `ACWR > 1.35`, downgrade track intervals to Z1 elliptical/bike or mobility + isometric wall sits.
2. **Determine Athlete ASR Profile When Field Tests Are Available**:
   - Run the calculator with the latest 1500m–3000m time trial and 30m flying / 50m standing sprint:
     ```bash
     node .agents/skills/800m-running-coach/scripts/asr_800m_calc.mjs --tt-dist 3000 --tt-time 11:30 --sprint-dist 50 --sprint-time 6.7 --goal-800 2:01.0
     ```
   - Classify the athlete via Sandford `SRR = MSS / MAS` (`>=1.58` 400-800 speed, `1.48-1.57` 800 specialist, `<1.48` 800-1500 endurance) and address the limiting side of `ASR`.
3. **Prescribe Intervals by Stage & Physiological Target**:
   - Consult [interval-session-catalog.md](../../../knowledge/interval-session-catalog.md) before writing `custom-plan.json` sessions or ad-hoc track workouts:
     * **Aerobic Support (`Stage 0-2`)**: Z1-Z2 volume (with cross-training early on), short cruise intervals (`THR-CRUISE`), and variable-intensity / primed long intervals (`VO2-LONG`) once base tolerance is rebuilt.
     * **Year-Round Micro-Dosed MSS (`Stage 0b-4`)**: `SPD-STRIDES` (`2-4 x 50-60m` with full `90-120s` walk rest) at end of warm-ups (`2x/week`) to prevent spring hamstring strains ("fear of MSS").
     * **Lactic Tolerance (`Stage 3-4` ONLY, max 6-8 weeks)**: `SE-SPLIT-800` (`500+300` / `600+200`) and `SE-HART-TOL` at most once per `7-10` days with full `48-72h` recovery afterwards.
4. **Integrate Strength & ITBS Firewall**:
   - Combine heavy lower-body strength (`>=80% 1RM` in Build/Peak, progressive toward `70-85 kg` squat) with low-volume plyometrics/explosive jumps (`PMC11258194`).
   - Always include `3 x 45-60s` isometric wall sits + glute medius activation as ITBS protection.
5. **Enforce Stopping & Compliance Rules**:
   - Every track interval session must specify exact split targets, rest durations, and a **drop-off cutoff**: stop the session early if pace slips `>3%` on speed/RP reps for 2 consecutive reps or if lateral knee pain exceeds `2/10` / alters gait.
   - Do not modify `config/runner.config.json` or `config/custom-plan.json` without running `npm test` and verifying `npm run coach`.
