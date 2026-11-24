import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildPublicDashboardPayload,
  DEFAULT_ROOT_DIR,
  getCheckinsFilePath,
  getPrivateDashboardPath,
  loadDotEnv,
  runCoachPipeline
} from './index.js';
import { deleteCheckin, loadCheckins, upsertCheckin } from './storage/checkins.js';

const SESSION_COOKIE_NAME = 'coach_session';
const SESSION_TTL_SEC = 30 * 24 * 3600;

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON payload'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const map = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) map[key] = decodeURIComponent(val);
  }
  return map;
}

function signSession(expMs, secret) {
  const payload = String(expMs);
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySessionCookie(cookieVal, secret) {
  if (!cookieVal || !secret) return false;
  const parts = String(cookieVal).split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expMs = Number(payload);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return false;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyAdminToken(provided, expected) {
  if (!expected) return { ok: false, statusCode: 503, error: '服务器尚未配置 COACH_ADMIN_TOKEN 操作口令' };
  const a = crypto.createHash('sha256').update(String(provided || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  if (!provided || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, statusCode: 401, error: '未授权或操作口令错误，请验证后重试' };
  }
  return { ok: true };
}

function verifyRequestAuth(req, expected, bodyToken = '') {
  if (!expected) {
    return { ok: false, statusCode: 503, error: '服务器尚未配置 COACH_ADMIN_TOKEN 操作口令' };
  }
  const cookies = parseCookies(req);
  if (verifySessionCookie(cookies[SESSION_COOKIE_NAME], expected)) {
    return { ok: true };
  }
  const authHeader = String(req.headers.authorization || '');
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const provided = req.headers['x-coach-token'] || bearerToken || bodyToken || '';
  return verifyAdminToken(provided, expected);
}

function isRequestHttps(req) {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const forwardedSsl = String(req.headers['x-forwarded-ssl'] || '').trim().toLowerCase();
  return protoHeader === 'https' || forwardedSsl === 'on' || Boolean(req.socket?.encrypted);
}

function isLoopbackHostAndRemote(req) {
  const remote = String(req.socket?.remoteAddress || '');
  const isLoopbackRemote = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const host = String(req.headers.host || '').split(':')[0].trim().toLowerCase();
  const isLoopbackHost = !host || host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  return isLoopbackRemote && isLoopbackHost;
}

function sanitizeHostForRedirect(hostHeader) {
  const h = String(hostHeader || '').trim().replace(/[\r\n]/g, '');
  if (!h || !/^[a-zA-Z0-9.\-:[\]]+$/.test(h)) return null;
  return h;
}

function buildCookieHeader(req, value, maxAgeSec, forceSecure = false) {
  const isHttps = forceSecure || isRequestHttps(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function stripDashboardSecrets(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const copy = structuredClone(payload);
  // Previously saved dashboards may still carry the retired provider configuration.
  if (copy.config?.llm) delete copy.config.llm;
  return copy;
}

export function createCoachServer(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT_DIR;
  const checkinsPath = options.checkinsPath || getCheckinsFilePath(rootDir);
  const privateDashboardPath = options.privateDashboardPath || getPrivateDashboardPath(rootDir);
  const publishDir = options.publishDir ?? process.env.PUBLISH_DIR ?? '';
  const isDemo = Boolean(options.isDemo);
  const requireHttps =
    options.requireHttps ??
    (process.env.FORCE_HTTPS === 'true' ||
      (process.env.FORCE_HTTPS !== 'false' && process.env.NODE_ENV === 'production'));
  const getExpectedToken = () => (options.adminToken ?? process.env.COACH_ADMIN_TOKEN ?? '').trim();

  let writeQueue = Promise.resolve();
  function enqueueWrite(fn) {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
  }

  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = reqUrl.pathname;

    try {
      const https = isRequestHttps(req);
      if (https) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }

      if (requireHttps && !https) {
        const allowLocalHealth =
          req.method === 'GET' &&
          pathname === '/api/health' &&
          isLoopbackHostAndRemote(req) &&
          !req.headers['x-forwarded-proto'];
        if (!allowLocalHealth) {
          if (req.method === 'GET' && !pathname.startsWith('/api/')) {
            const safeHost = sanitizeHostForRedirect(
              String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0]
            );
            if (safeHost) {
              res.writeHead(301, {
                Location: `https://${safeHost}${reqUrl.pathname}${reqUrl.search}`,
                'Cache-Control': 'no-store'
              });
              res.end();
              return;
            }
          }
          return sendJson(res, 403, {
            ok: false,
            error: '必须通过 HTTPS 访问（请确保反代已配置 HTTPS 与 X-Forwarded-Proto）'
          });
        }
      }

      if (req.method === 'GET' && pathname === '/api/health') {
        const expected = getExpectedToken();
        const auth = expected ? verifyRequestAuth(req, expected) : { ok: false };
        return sendJson(res, 200, {
          ok: true,
          time: new Date().toISOString(),
          hasAdminToken: Boolean(expected),
          authenticated: Boolean(auth.ok),
          https,
          requireHttps
        });
      }

      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJsonBody(req);
        const token = req.headers['x-coach-token'] || body.token || '';
        const expected = getExpectedToken();
        const auth = verifyAdminToken(token, expected);
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { ok: false, error: auth.error });
        }
        const sessionVal = signSession(Date.now() + SESSION_TTL_SEC * 1000, expected);
        return sendJson(
          res,
          200,
          { ok: true, authenticated: true },
          { 'Set-Cookie': buildCookieHeader(req, sessionVal, SESSION_TTL_SEC, requireHttps) }
        );
      }

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        return sendJson(
          res,
          200,
          { ok: true, authenticated: false },
          { 'Set-Cookie': buildCookieHeader(req, '', 0, requireHttps) }
        );
      }

      if (req.method === 'GET' && pathname === '/api/checkins') {
        const auth = verifyRequestAuth(req, getExpectedToken());
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { ok: false, error: auth.error });
        }
        const entries = await loadCheckins(checkinsPath);
        return sendJson(res, 200, { ok: true, checkins: entries });
      }

      if (req.method === 'GET' && pathname === '/api/private/dashboard') {
        const auth = verifyRequestAuth(req, getExpectedToken());
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { ok: false, error: auth.error });
        }
        let dashboard;
        try {
          const raw = await fs.readFile(privateDashboardPath, 'utf8');
          dashboard = JSON.parse(raw);
        } catch {
          dashboard = await runCoachPipeline({
            rootDir,
            checkinsPath,
            privateDashboardPath,
            isDemo,
            skipNetworkFetch: true,
            skipNotify: true,
            publishDir
          });
        }
        return sendJson(res, 200, { ok: true, dashboard: stripDashboardSecrets(dashboard) });
      }

      if (req.method === 'POST' && pathname === '/api/checkins') {
        const body = await readJsonBody(req);
        const auth = verifyRequestAuth(req, getExpectedToken(), body.token);
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { ok: false, error: auth.error });
        }

        const result = await enqueueWrite(async () => {
          const { entry, entries } = await upsertCheckin(body, checkinsPath);
          const payload = await runCoachPipeline({
            rootDir,
            checkinsPath,
            privateDashboardPath,
            isDemo,
            skipNetworkFetch: true,
            skipNotify: true,
            publishDir
          });
          return {
            ok: true,
            checkin: entry,
            checkins: entries.slice(0, 30),
            generatedAt: payload.generatedAt,
            coachSummary: payload.coachPlan?.coachSummary || '',
            dashboard: stripDashboardSecrets(payload)
          };
        });
        return sendJson(res, 200, result);
      }

      if (req.method === 'DELETE' && pathname === '/api/checkins') {
        const body = await readJsonBody(req);
        const auth = verifyRequestAuth(req, getExpectedToken(), body.token);
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { ok: false, error: auth.error });
        }

        const targetDate = reqUrl.searchParams.get('date') || body.date || '';
        const result = await enqueueWrite(async () => {
          const { deleted, date, entries } = await deleteCheckin(targetDate, checkinsPath);
          if (!deleted) {
            return { statusCode: 404, body: { ok: false, error: `未找到 ${date} 的打卡记录` } };
          }
          const payload = await runCoachPipeline({
            rootDir,
            checkinsPath,
            privateDashboardPath,
            isDemo,
            skipNetworkFetch: true,
            skipNotify: true,
            publishDir
          });
          return {
            statusCode: 200,
            body: {
              ok: true,
              deleted: true,
              date,
              checkins: entries.slice(0, 30),
              generatedAt: payload.generatedAt,
              coachSummary: payload.coachPlan?.coachSummary || '',
              dashboard: stripDashboardSecrets(payload)
            }
          };
        });
        return sendJson(res, result.statusCode, result.body);
      }

      if (req.method === 'POST' && pathname === '/api/recalculate') {
        const body = await readJsonBody(req);
        const auth = verifyRequestAuth(req, getExpectedToken(), body.token);
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { ok: false, error: auth.error });
        }

        const result = await enqueueWrite(async () => {
          const payload = await runCoachPipeline({
            rootDir,
            checkinsPath,
            privateDashboardPath,
            isDemo,
            skipNetworkFetch: true,
            skipNotify: true,
            publishDir
          });
          return {
            ok: true,
            generatedAt: payload.generatedAt,
            readiness: payload.readiness,
            coachSummary: payload.coachPlan?.coachSummary || '',
            dashboard: stripDashboardSecrets(payload)
          };
        });
        return sendJson(res, 200, result);
      }

      if (req.method === 'POST' && pathname === '/api/refresh') {
        const body = await readJsonBody(req);
        const auth = verifyRequestAuth(req, getExpectedToken(), body.token);
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { ok: false, error: auth.error });
        }

        const result = await enqueueWrite(async () => {
          const payload = await runCoachPipeline({
            rootDir,
            checkinsPath,
            privateDashboardPath,
            isDemo,
            skipNetworkFetch: false,
            skipNotify: true,
            publishDir
          });
          return {
            ok: true,
            generatedAt: payload.generatedAt,
            readiness: payload.readiness,
            coachSummary: payload.coachPlan?.coachSummary || '',
            dashboard: stripDashboardSecrets(payload)
          };
        });
        return sendJson(res, 200, result);
      }

      // 本地开发兜底静态托管 dist/（严格仅提供公开白名单内容）
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/data/latest.json')) {
        const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const filePath = path.join(rootDir, 'dist', rel);
        try {
          const content = await fs.readFile(filePath, 'utf8');
          if (rel.endsWith('.json')) {
            const parsed = JSON.parse(content);
            const safePublic = parsed?.publicMode ? parsed : buildPublicDashboardPayload(parsed);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(JSON.stringify(safePublic, null, 2));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          res.end(content);
          return;
        } catch {
          return sendJson(res, 404, { ok: false, error: 'Dashboard not generated yet' });
        }
      }

      return sendJson(res, 404, { ok: false, error: 'Not Found' });
    } catch (err) {
      const code = err?.statusCode || 500;
      console.error('[ServerError]', err);
      return sendJson(res, code, { ok: false, error: err?.message || 'Internal Server Error' });
    }
  });
}

const isCliEntry = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCliEntry) {
  const rootDir = DEFAULT_ROOT_DIR;
  await loadDotEnv(rootDir);
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3001);
  const server = createCoachServer({
    rootDir,
    isDemo: process.argv.includes('--demo')
  });
  server.listen(port, host, () => {
    console.log(`[CoachAPI] Listening on http://${host}:${port}`);
  });
}
