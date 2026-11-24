# Garmin AI Running Coach — Workspace Rules

## 1. Single Source of Truth (Windows ↔ Mac ↔ Server/Website)
- Treat `huawei-sg:/opt/garmin-coach` (live API + website) as the **single source of truth** for athlete state: `data/private/checkins.json`, `config/custom-plan.json`, `config/runner.config.json`, and `data/private/telemetry-cache.json`.
- **Pull First (Every Session)**: Before giving training advice, analyzing a run, or editing plans/check-ins on any computer (Windows or Mac), inspect or pull the latest files from `huawei-sg:/opt/garmin-coach` first. Never base coaching advice on stale local files from an older session on another machine.
- **Persist & Push Back (Every Feedback Turn)**: Whenever the user reports subjective feel, symptoms/pain changes, shoe/gear swaps, fueling/nutrition, strength loads/RIR, or key session takeaways:
  1. Merge into `data/private/checkins.json` without overwriting phone/web-submitted entries.
  2. Sync updated state files (`checkins.json`, and `custom-plan.json` / `runner.config.json` when changed) to `huawei-sg:/opt/garmin-coach` with `chmod 600` on private files.
  3. Run `cd /opt/garmin-coach && node src/index.js --render-only` on `huawei-sg` (and locally if needed) so `dashboard-payload.json` and the live website update immediately.
- **Workout Calendar Sync**: Whenever `config/custom-plan.json` changes future running targets or swaps training days, also sync structured workouts to Garmin Connect — preferably on `huawei-sg` with IPv4 flags to avoid mainland China `thegarth.s3.amazonaws.com` failures and Node Happy Eyeballs cross-border `ETIMEDOUT`/`ENETUNREACH`: `ssh huawei-sg 'cd /opt/garmin-coach && node --no-network-family-autoselection --dns-result-order=ipv4first scripts/sync-workouts.js --days 5'` (or `--date YYYY-MM-DD` for targeted days).

## 2. Coaching Skill Activation
- For any **800m** training analysis, interval prescription, ASR/SRR estimation, or track recovery gating, load and follow `.agents/skills/800m-running-coach/SKILL.md`.
- For any **3K / 5K / 10K / Half Marathon / Full Marathon** training plan, VDOT/Riegel pace calibration, threshold/marathon-pace progression, aerobic durability, fueling/gut-training, or pre-race taper guidance, load and follow `.agents/skills/distance-running-coach/SKILL.md`.
