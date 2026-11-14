import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncCoachWorkoutsToGarmin } from '../src/garmin/workoutSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

async function loadDotEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env 不存在时直接读环境变量
  }
}

async function upsertEnvSessionJson(tokens) {
  const envPath = path.join(ROOT_DIR, '.env');
  const serialized = JSON.stringify(tokens);
  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim().startsWith('GARMIN_SESSION_JSON='));
  const entry = `GARMIN_SESSION_JSON=${serialized}`;
  if (idx >= 0) {
    lines[idx] = entry;
  } else {
    lines.push(entry);
  }
  await fs.writeFile(envPath, `${lines.filter((l, i) => i < lines.length - 1 || l !== '').join('\n')}\n`, 'utf8');
}

function parseCliArgs(argv) {
  const opts = { days: 5, dryRun: false, date: null, saveSession: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-save-session') opts.saveSession = false;
    else if (arg === '--days' && argv[i + 1]) {
      opts.days = Math.max(1, Number(argv[++i]) || 5);
    } else if (arg === '--date' && argv[i + 1]) {
      opts.date = argv[++i];
    }
  }
  return opts;
}

async function main() {
  await loadDotEnv();
  const opts = parseCliArgs(process.argv.slice(2));

  const latestPath = path.join(ROOT_DIR, 'dist', 'data', 'latest.json');
  let latest;
  try {
    latest = JSON.parse(await fs.readFile(latestPath, 'utf8'));
  } catch {
    throw new Error('未找到 dist/data/latest.json，请先执行 npm run coach 生成当期课表。');
  }

  const region = process.env.GARMIN_REGION || latest?.config?.region || 'cn';
  const result = await syncCoachWorkoutsToGarmin(latest.coachPlan, {
    days: opts.days,
    date: opts.date,
    dryRun: opts.dryRun,
    auth: {
      region,
      email: process.env.GARMIN_EMAIL,
      password: process.env.GARMIN_PASSWORD,
      sessionJson: process.env.GARMIN_SESSION_JSON
    }
  });

  if (!result.dryRun && opts.saveSession && result.sessionTokens) {
    await upsertEnvSessionJson(result.sessionTokens);
  }

  console.log(
    JSON.stringify(
      {
        dryRun: result.dryRun,
        reusedSession: result.reusedSession ?? null,
        deletedCount: result.deletedCount ?? 0,
        synced: result.synced,
        skipped: result.skipped
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[WorkoutSync Error]', err.message);
  process.exit(1);
});
