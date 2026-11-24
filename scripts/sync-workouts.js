import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncCoachWorkoutsToGarmin } from '../src/garmin/workoutSync.js';
import { assertCoachPlanPassed } from '../src/coach/planRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

async function loadDotEnv(rootDir = ROOT_DIR) {
  const envPath = path.join(rootDir, '.env');
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

async function upsertEnvSessionJson(tokens, rootDir = ROOT_DIR) {
  const envPath = path.join(rootDir, '.env');
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

export function parseCliArgs(argv) {
  const opts = { days: 5, dryRun: false, date: null, saveSession: true, input: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-save-session') opts.saveSession = false;
    else if (arg === '--days' && argv[i + 1]) {
      opts.days = Math.max(1, Number(argv[++i]) || 5);
    } else if (arg === '--date' && argv[i + 1]) {
      opts.date = argv[++i];
    } else if (arg === '--input' && argv[i + 1]) {
      opts.input = argv[++i];
    }
  }
  return opts;
}

/**
 * 从私有完整负载（默认 data/private/dashboard-payload.json）加载已校验的 coachPlan 并执行 Garmin 同步
 */
export async function runWorkoutSyncCli(opts = {}, rootDir = ROOT_DIR) {
  const payloadPath = opts.input
    ? path.resolve(rootDir, opts.input)
    : path.join(rootDir, 'data', 'private', 'dashboard-payload.json');

  let payload;
  try {
    payload = JSON.parse(await fs.readFile(payloadPath, 'utf8'));
  } catch {
    throw new Error(
      `未找到私有完整课表文件 ${path.relative(rootDir, payloadPath)}，请先运行 npm run coach 生成最新课表。`
    );
  }

  if (payload?.publicMode && !payload?.coachPlan) {
    throw new Error(
      `${path.relative(rootDir, payloadPath)} 是公开脱敏存根（不含个人课表），请改用 data/private/dashboard-payload.json。`
    );
  }

  if (!Array.isArray(payload?.coachPlan?.days) || payload.coachPlan.days.length === 0) {
    throw new Error(`${path.relative(rootDir, payloadPath)} 缺少有效 coachPlan.days，拒绝空同步。`);
  }
  assertCoachPlanPassed(payload?.coachPlan, {
    requireReport: true,
    action: '执行命令行 Garmin 同步'
  });

  const region = process.env.GARMIN_REGION || payload?.config?.region || 'cn';
  const result = await syncCoachWorkoutsToGarmin(payload.coachPlan, {
    days: opts.days ?? 5,
    date: opts.date ?? null,
    dryRun: Boolean(opts.dryRun),
    requireValidatedPlan: true,
    auth: {
      region,
      email: process.env.GARMIN_EMAIL,
      password: process.env.GARMIN_PASSWORD,
      sessionJson: process.env.GARMIN_SESSION_JSON
    }
  });

  if (!result.dryRun && opts.saveSession !== false && result.sessionTokens) {
    await upsertEnvSessionJson(result.sessionTokens, rootDir);
  }

  return result;
}

async function main() {
  await loadDotEnv(ROOT_DIR);
  const opts = parseCliArgs(process.argv.slice(2));
  const result = await runWorkoutSyncCli(opts, ROOT_DIR);

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

const isCliEntry = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCliEntry) {
  main().catch((err) => {
    console.error('[WorkoutSync Error]', err.message);
    process.exit(1);
  });
}
