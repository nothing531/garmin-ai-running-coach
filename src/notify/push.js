/**
 * 手机消息推送模块（零依赖 native fetch）
 * 支持: 飞书机器人 / 企业微信机器人 / 钉钉机器人 / Server酱 / iOS Bark
 */

export async function sendNotifications(planResult, dashboardUrl) {
  const { readiness, envToday, coachPlan } = planResult;
  const todayWorkout = coachPlan?.days?.[0];

  const lightEmoji =
    readiness.light === 'green'
      ? '🟢'
      : readiness.light === 'yellow'
        ? '🟡'
        : readiness.light === 'red'
          ? '🔴'
          : '⚪';

  const scorePart = readiness.score != null ? `准备度 ${readiness.score}/100` : '生理数据不足';
  const title = `${lightEmoji} AI 跑步教练晨报 | ${scorePart}`;
  const lines = [
    `状态：${readiness.lightLabel}`,
    `原因：${readiness.triggers.join('；')}`,
    envToday && !envToday.weatherUnavailable && typeof envToday.tempC === 'number'
      ? `环境：${envToday.weatherText} ${envToday.tempC}°C | 湿度 ${envToday.humidityPct}% | 露点 ${envToday.dewPointC}°C | 风 ${envToday.windMs}m/s | 海拔 ${envToday.elevationMeters}m`
      : '环境：气象接口暂不可用（暂停温度/风速/AQI配速修正）',
    todayWorkout
      ? `今日课表：[${todayWorkout.type}] ${todayWorkout.title}`
      : null,
    todayWorkout?.mainSetSummary
      ? `核心内容：${todayWorkout.mainSetSummary}`
      : null,
    todayWorkout?.correctedPace
      ? `目标配速：${todayWorkout.correctedPace}（基准 ${todayWorkout.basePace || '--'}） | 心率 ${todayWorkout.targetHr || '--'}`
      : null,
    dashboardUrl ? `详细交互看板：${dashboardUrl}` : null
  ].filter(Boolean);

  const markdownBody = lines.join('\n\n');
  const results = [];

  if (process.env.FEISHU_WEBHOOK) {
    results.push(await pushFeishu(process.env.FEISHU_WEBHOOK, title, lines, dashboardUrl));
  }
  if (process.env.WECOM_WEBHOOK) {
    results.push(await pushWecom(process.env.WECOM_WEBHOOK, `### ${title}\n${markdownBody}`));
  }
  if (process.env.DINGTALK_WEBHOOK) {
    results.push(await pushDingtalk(process.env.DINGTALK_WEBHOOK, title, `### ${title}\n\n${markdownBody}`));
  }
  if (process.env.SERVERCHAN_KEY) {
    results.push(await pushServerChan(process.env.SERVERCHAN_KEY, title, markdownBody));
  }
  if (process.env.BARK_URL) {
    results.push(await pushBark(process.env.BARK_URL, title, lines.slice(0, 4).join('\n'), dashboardUrl));
  }

  return results;
}

async function pushFeishu(webhook, title, lines, dashboardUrl) {
  try {
    const payload = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: title },
          template: title.startsWith('🟢') ? 'green' : title.startsWith('🟡') ? 'orange' : 'red'
        },
        elements: [
          {
            tag: 'markdown',
            content: lines.join('\n')
          },
          ...(dashboardUrl
            ? [
                {
                  tag: 'action',
                  actions: [
                    {
                      tag: 'button',
                      text: { tag: 'plain_text', content: '打开完整交互式训练看板' },
                      type: 'primary',
                      url: dashboardUrl
                    }
                  ]
                }
              ]
            : [])
        ]
      }
    };
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { channel: 'feishu', ok: res.ok, status: res.status };
  } catch (err) {
    return { channel: 'feishu', ok: false, error: err.message };
  }
}

async function pushWecom(webhook, content) {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } })
    });
    return { channel: 'wecom', ok: res.ok, status: res.status };
  } catch (err) {
    return { channel: 'wecom', ok: false, error: err.message };
  }
}

async function pushDingtalk(webhook, title, text) {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text } })
    });
    return { channel: 'dingtalk', ok: res.ok, status: res.status };
  } catch (err) {
    return { channel: 'dingtalk', ok: false, error: err.message };
  }
}

async function pushServerChan(sendKey, title, desp) {
  try {
    const url = `https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`;
    const body = new URLSearchParams({ title, desp });
    const res = await fetch(url, { method: 'POST', body });
    return { channel: 'serverchan', ok: res.ok, status: res.status };
  } catch (err) {
    return { channel: 'serverchan', ok: false, error: err.message };
  }
}

async function pushBark(barkUrl, title, body, url) {
  try {
    const base = barkUrl.replace(/\/$/, '');
    const payload = { title, body, ...(url ? { url } : {}) };
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { channel: 'bark', ok: res.ok, status: res.status };
  } catch (err) {
    return { channel: 'bark', ok: false, error: err.message };
  }
}
