import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { buildDeterministicCoachPlan } from '../src/coach/planner.js';
import { computePmcSeries, computeWeeklyAndZones, evaluateReadiness } from '../src/science/metrics.js';
import { renderDashboardHtml } from '../src/render/dashboard.js';
import { loadCheckins, summarizeCheckinSignals, upsertCheckin } from '../src/storage/checkins.js';
import { createCoachServer } from '../src/server.js';
import { buildPublicDashboardPayload } from '../src/index.js';

test('subjective check-in guardrails protect pain, enforce rest, and never leak diary into public HTML', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-checkin-'));
  try {
    const file = path.join(tmpDir, 'checkins.json');
    const todayStr = new Date().toISOString().slice(0, 10);

    await upsertCheckin(
      { date: todayStr, status: 'completed', rpe: 7, painLevel: 3, painAreas: ['左膝外侧'], diary: '跑后左膝外侧有点扯着疼' },
      file
    );
    const list = await loadCheckins(file);
    assert.equal(list.length, 1);

    const signals = summarizeCheckinSignals(list, todayStr);
    assert.equal(signals.painAlert, true);
    assert.equal(signals.persistentInjuries.length, 1);

    const config = {
      goal: { eventName: '800m', targetTime: '00:02:01', raceDate: '2027-05-15' },
      physiology: { maxHr: 203, restingHrBaseline: 52, lthr: 183, ltPaceSecPerKm: 285, weightKg: 67 }
    };
    const pmc = computePmcSeries([], config.physiology, 14);
    const weeklyZones = computeWeeklyAndZones([], config.physiology);
    const readiness = evaluateReadiness({ hrvToday: 65, hrv7dAvg: 60, sleepScore: 88, bodyBatteryMorning: 90, rhrToday: 50, rhr7dAvg: 52 }, pmc.latest);
    const envToday = { date: todayStr, weatherText: '晴', tempC: 14, humidityPct: 45, dewPointC: 3, windMs: 2, usAqi: 35, elevationMeters: 1690 };

    const planPain = buildDeterministicCoachPlan(
      {
        readiness,
        pmc,
        weeklyZones,
        wellness: {},
        envForecast: { daily: [envToday] },
        lastKeyWorkoutAudit: null,
        customPlan: { days: { [todayStr]: { type: 'T', title: '阈值巡航', plannedDistanceKm: 10, allowReadinessOverride: false } } },
        checkins: list
      },
      config
    );
    assert.equal(planPain.days[0].type, 'REST');
    assert.equal(planPain.days[0].plannedDistanceKm, 0);
    assert.ok(planPain.days[0].title.includes('疼痛保护'));
    assert.ok(!planPain.days[0].mainSetDetail.includes('靠墙静蹲'));

    const { entries: restList } = await upsertCheckin(
      { date: todayStr, status: 'rest', rpe: 3, painLevel: 0, painAreas: ['无不适'], diary: '加班请假一天' },
      file
    );
    const planRest = buildDeterministicCoachPlan(
      {
        readiness,
        pmc,
        weeklyZones,
        wellness: {},
        envForecast: { daily: [envToday] },
        lastKeyWorkoutAudit: null,
        customPlan: { days: { [todayStr]: { type: 'E', title: '有氧跑 8km', plannedDistanceKm: 8 } } },
        checkins: restList
      },
      config
    );
    assert.equal(planRest.days[0].type, 'REST');
    assert.ok(planRest.days[0].title.includes('主动请假休息'));
    assert.ok(!planRest.days[0].title.includes('已顺延'));

    // 默认公开 HTML 与公开 JSON 严格不泄露私人日记与主观总结
    const payload = {
      generatedAt: '2026-11-15 21:20:00',
      dataSource: 'test',
      config,
      wellness: { hrvToday: 747, rhrToday: 599, sleepScore: 88 },
      readiness,
      pmc,
      weeklyZones,
      lastKeyWorkoutAudit: null,
      envForecast: { location: { city: '兰州' }, daily: [envToday] },
      envToday,
      envAdjustmentToday: { slowdownPct: 2 },
      coachPlan: planRest,
      checkins: restList
    };
    const publicHtml = renderDashboardHtml(payload);
    const publicJson = buildPublicDashboardPayload(payload);
    assert.ok(publicHtml.includes('auth-gate'));
    assert.ok(!publicHtml.includes('加班请假一天'));
    assert.ok(!publicHtml.includes('747'));
    assert.ok(!publicHtml.includes('599'));
    assert.ok(!publicHtml.includes('数据依据'));
    assert.equal(publicJson.checkins, undefined);
    assert.equal(publicJson.coachPlan, undefined);
    assert.equal(publicJson.wellness, undefined);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('coach HTTP server enforces auth on GET/POST checkins and private dashboard using temp workspace', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-srv-'));
  await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, 'config', 'runner.config.json'),
    JSON.stringify({
      runnerName: 'Test Runner',
      timezone: 'Asia/Shanghai',
      location: { city: 'Lanzhou', cityDisplay: '兰州', latitude: 35.94, longitude: 104.14, elevationMeters: 1690 },
      goal: { eventName: '800m', targetTime: '00:02:01', raceDate: '2027-05-15' },
      physiology: { maxHr: 203, restingHrBaseline: 52, lthr: 183, ltPaceSecPerKm: 285, weightKg: 67 }
    }),
    'utf8'
  );

  const checkinsPath = path.join(tmpDir, 'data', 'private', 'checkins.json');
  const privateDashboardPath = path.join(tmpDir, 'data', 'private', 'dashboard-payload.json');
  const server = createCoachServer({
    rootDir: tmpDir,
    checkinsPath,
    privateDashboardPath,
    adminToken: 'secret-pin-1234',
    isDemo: true
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.hasAdminToken, true);
    assert.equal(health.authenticated, false);

    // 未鉴权读取日记和私人看板必须返回 401
    const unauthGetCheckins = await fetch(`${baseUrl}/api/checkins`);
    assert.equal(unauthGetCheckins.status, 401);
    const unauthGetDash = await fetch(`${baseUrl}/api/private/dashboard`);
    assert.equal(unauthGetDash.status, 401);

    const unauthPost = await fetch(`${baseUrl}/api/checkins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Coach-Token': 'wrong-pin' },
      body: JSON.stringify({ status: 'completed', rpe: 6, diary: 'unauthorized test' })
    });
    assert.equal(unauthPost.status, 401);

    const todayStr = new Date().toISOString().slice(0, 10);
    const okRes = await fetch(`${baseUrl}/api/checkins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Coach-Token': 'secret-pin-1234' },
      body: JSON.stringify({
        date: todayStr,
        status: 'completed',
        rpe: 7,
        painLevel: 1,
        painAreas: ['小腿/比目鱼肌'],
        actualDistanceKm: 4.2,
        paceDropoffPct: 1.5,
        formStatus: 'stable',
        strengthExercise: '杠铃深蹲',
        strengthLoadKg: 50,
        strengthSetsReps: '3x8',
        strengthRir: 2.5,
        testPurpose: 'recovery_observation',
        diary: '测试场地节奏很顺'
      })
    });
    assert.equal(okRes.status, 200);
    const okData = await okRes.json();
    assert.equal(okData.ok, true);
    assert.equal(okData.checkin.diary, '测试场地节奏很顺');
    assert.equal(okData.checkin.strengthLoadKg, 50);
    assert.equal(okData.checkin.strengthRir, 2.5);
    assert.equal(okData.checkin.formStatus, 'stable');
    assert.equal(okData.checkin.testPurpose, 'recovery_observation');
    assert.ok(okData.dashboard.coachPlan.weeklyReview);
    assert.ok(okData.dashboard.coachPlan.upgradeGate);

    // 鉴权后可以读取日记和私人看板
    const authGetCheckins = await fetch(`${baseUrl}/api/checkins`, {
      headers: { 'X-Coach-Token': 'secret-pin-1234' }
    });
    assert.equal(authGetCheckins.status, 200);
    const getData = await authGetCheckins.json();
    assert.equal(getData.checkins.length, 1);
    assert.equal(getData.checkins[0].rpe, 7);

    const authGetDash = await fetch(`${baseUrl}/api/private/dashboard`, {
      headers: { 'X-Coach-Token': 'secret-pin-1234' }
    });
    assert.equal(authGetDash.status, 200);
    const dashJson = await authGetDash.json();
    assert.equal(dashJson.dashboard.checkins.length, 1);

    // 公开 /data/latest.json 绝不包含日记与私有健康数据
    const publicJsonRes = await fetch(`${baseUrl}/data/latest.json`);
    assert.equal(publicJsonRes.status, 200);
    const publicJson = await publicJsonRes.json();
    assert.equal(publicJson.publicMode, true);
    assert.equal(publicJson.checkins, undefined);
    assert.equal(publicJson.wellness, undefined);

    const publicHtmlRes = await fetch(`${baseUrl}/`);
    assert.equal(publicHtmlRes.status, 200);
    const publicHtmlText = await publicHtmlRes.text();
    assert.ok(!publicHtmlText.includes('测试场地节奏很顺'));

    // 支持登录换取 HttpOnly Cookie 会话
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'secret-pin-1234' })
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('coach_session='));
    const cookieHeader = setCookie.split(';')[0];

    const cookieCheckinsRes = await fetch(`${baseUrl}/api/checkins`, {
      headers: { Cookie: cookieHeader }
    });
    assert.equal(cookieCheckinsRes.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('coach HTTP server enforces HTTPS and sets Secure cookie + HSTS under proxy HTTPS in requireHttps mode', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-https-'));
  const server = createCoachServer({
    rootDir: tmpDir,
    adminToken: 'secret-https-pin',
    requireHttps: true,
    isDemo: true
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1) 未带 HTTPS / 明文 X-Forwarded-Proto: http 登录必须被拦截 403，且不签发 Cookie
    const httpLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'garmin.unilee.site',
        'X-Forwarded-Proto': 'http'
      },
      body: JSON.stringify({ token: 'secret-https-pin' })
    });
    assert.equal(httpLogin.status, 403);
    assert.equal(httpLogin.headers.get('set-cookie'), null);

    // 2) 非 HTTPS 访问根页面应返回 301 重定向到 https://（使用 node:http 实际发送 Host 头）
    const httpPage = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: '/',
          method: 'GET',
          headers: { Host: 'garmin.unilee.site', 'X-Forwarded-Proto': 'http' }
        },
        (res) => resolve({ status: res.statusCode, location: res.headers.location })
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(httpPage.status, 301);
    assert.equal(httpPage.location, 'https://garmin.unilee.site/');

    // 3) 代理携带 X-Forwarded-Proto: https 时登录成功，且 Cookie 强制带 Secure + HSTS
    const httpsLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'garmin.unilee.site',
        'X-Forwarded-Proto': 'https'
      },
      body: JSON.stringify({ token: 'secret-https-pin' })
    });
    assert.equal(httpsLogin.status, 200);
    const setCookie = httpsLogin.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=Strict'));
    assert.ok(/\bSecure\b/i.test(setCookie));
    assert.ok((httpsLogin.headers.get('strict-transport-security') || '').includes('max-age='));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('restored APEX UI preserves zero leak publicly and supports POST/recalculate/DELETE endpoints safely', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'garmin-apex-'));
  await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, 'config', 'runner.config.json'),
    JSON.stringify({
      runnerName: 'Apex Tester',
      timezone: 'Asia/Shanghai',
      location: { city: 'Lanzhou', cityDisplay: '兰州', latitude: 35.94, longitude: 104.14, elevationMeters: 1690 },
      goal: { eventName: '800m', targetTime: '00:02:01', raceDate: '2027-05-15' },
      physiology: { maxHr: 203, restingHrBaseline: 52, lthr: 183, ltPaceSecPerKm: 285, weightKg: 67 }
    }),
    'utf8'
  );
  const server = createCoachServer({
    rootDir: tmpDir,
    checkinsPath: path.join(tmpDir, 'data', 'private', 'checkins.json'),
    privateDashboardPath: path.join(tmpDir, 'data', 'private', 'dashboard-payload.json'),
    adminToken: 'apex-secret-pin',
    requireHttps: false,
    isDemo: true
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1) 未鉴权禁止调用 /api/recalculate 与 DELETE /api/checkins
    const unauthRecalc = await fetch(`${baseUrl}/api/recalculate`, { method: 'POST' });
    assert.equal(unauthRecalc.status, 401);
    const unauthDelete = await fetch(`${baseUrl}/api/checkins?date=2026-11-17`, { method: 'DELETE' });
    assert.equal(unauthDelete.status, 401);

    // 2) 登录后通过 HttpOnly Cookie 进行打卡、重算与删除闭环
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'apex-secret-pin' })
    });
    assert.equal(loginRes.status, 200);
    const cookieHeader = (loginRes.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookieHeader.includes('coach_session='));

    const postRes = await fetch(`${baseUrl}/api/checkins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        date: '2026-11-17',
        status: 'completed',
        rpe: 6,
        painLevel: 1,
        painAreas: ['小腿/比目鱼肌'],
        sleepQuality: 4,
        strengthExercise: '高脚杯深蹲',
        strengthLoadKg: 40,
        strengthSetsReps: '3x8',
        strengthRir: 2.5,
        diary: 'apex-cookie-crud-diary'
      })
    });
    assert.equal(postRes.status, 200);
    const postJson = await postRes.json();
    assert.equal(postJson.ok, true);
    assert.ok(postJson.checkins.some((c) => c.date === '2026-11-17' && c.diary === 'apex-cookie-crud-diary'));

    const recalcRes = await fetch(`${baseUrl}/api/recalculate`, {
      method: 'POST',
      headers: { Cookie: cookieHeader }
    });
    assert.equal(recalcRes.status, 200);
    const recalcJson = await recalcRes.json();
    assert.equal(recalcJson.ok, true);
    assert.ok(Array.isArray(recalcJson.dashboard?.coachPlan?.days) && recalcJson.dashboard.coachPlan.days.length > 0);
    assert.equal(recalcJson.dashboard.coachPlan.macroPhase.stages.length, 5);

    const delMissingRes = await fetch(`${baseUrl}/api/checkins?date=2099-01-01`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader }
    });
    assert.equal(delMissingRes.status, 404);

    const delRes = await fetch(`${baseUrl}/api/checkins?date=2026-11-17`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader }
    });
    assert.equal(delRes.status, 200);
    const delJson = await delRes.json();
    assert.equal(delJson.deleted, true);
    assert.ok(!delJson.checkins.some((c) => c.date === '2026-11-17'));

    // 3) 公开首页 HTML 包含完整 APEX 800m 工作台结构但严格零隐私泄露
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    for (const marker of [
      'AI Running Coach',
      'auth-gate',
      'readiness-ring-arc',
      'week-day-tab',
      'mobile-dock',
      '800m',
      '高原晴日',
      '夜训赛道',
      'fb-str-rir',
      'weekly-review-banner'
    ]) {
      assert.ok(html.includes(marker), `APEX UI 缺少标记: ${marker}`);
    }
    assert.ok(!html.includes('ITBS'));
    assert.ok(!html.includes('红灯熔断'));
    assert.ok(!html.includes('apex-cookie-crud-diary'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
