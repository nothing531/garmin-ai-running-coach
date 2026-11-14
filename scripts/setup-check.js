import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GarminPersonalApiClient } from '@likenttt/connect-personal-api-ts';
import GarminConnectModule from '@likenttt/garmin-connect';

const GarminConnect = GarminConnectModule.default || GarminConnectModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

async function loadDotEnv() {
  try {
    const raw = await fs.readFile(path.join(ROOT_DIR, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // ignore
  }
}

async function run() {
  await loadDotEnv();
  const region = (process.env.GARMIN_REGION || 'cn').toLowerCase() === 'cn' ? 'cn' : 'global';
  const apiKey = (process.env.GARMIN_PERSONAL_API_KEY || '').trim();

  console.log(`=== Garmin 连通性诊断 (Region: ${region}) ===`);

  if (apiKey) {
    console.log('\n[1] 正在测试官方 Personal API Key...');
    try {
      const client = new GarminPersonalApiClient({
        apiKey,
        region,
        ...(process.env.GARMIN_BASE_URL ? { baseUrl: process.env.GARMIN_BASE_URL } : {})
      });
      const acts = await client.searchActivities({ start: 0, limit: 3 });
      console.log(`✅ 官方 Personal API 连通成功！最近读取到 ${acts?.length ?? 0} 条运动记录。`);
      if (acts?.[0]) {
        console.log(`   最新运动: ${acts[0].startTimeLocal} · ${acts[0].activityName}`);
      }
      return;
    } catch (err) {
      console.error(`❌ 官方 Personal API 失败: ${err.message} (code=${err.code || 'N/A'}, status=${err.status || 'N/A'})`);
      if (region === 'cn' && err.status === 526) {
        console.log('   👉 确认命中佳明中国区 .cn 服务端已知 HTTP 526 故障，建议下方使用 Session 兜底导出 Token。');
      }
    }
  } else {
    console.log('\n[1] 未设置 GARMIN_PERSONAL_API_KEY，跳过官方 Personal API 测试。');
  }

  if (process.env.GARMIN_EMAIL && process.env.GARMIN_PASSWORD) {
    console.log('\n[2] 正在测试 Garmin Connect 会话登录并导出 GARMIN_SESSION_JSON...');
    const domain = region === 'cn' ? 'garmin.cn' : 'garmin.com';
    const gc = new GarminConnect(
      { username: process.env.GARMIN_EMAIL, password: process.env.GARMIN_PASSWORD },
      domain
    );
    await gc.login();
    const tokens = gc.exportToken();
    const acts = await gc.getActivities(0, 2);
    console.log(`✅ 会话登录成功！读取到 ${acts?.length ?? 0} 条最新记录。`);
    console.log('\n请将以下整行 JSON 复制到 GitHub Secrets 的 GARMIN_SESSION_JSON 中（可避免云端触发二次验证）：\n');
    console.log(JSON.stringify(tokens));
  } else {
    console.log('\n[2] 若需使用会话兜底，请在 .env 中填写 GARMIN_EMAIL 与 GARMIN_PASSWORD 后重试 npm run check。');
  }
}

run().catch((err) => {
  console.error('诊断失败:', err);
  process.exit(1);
});
