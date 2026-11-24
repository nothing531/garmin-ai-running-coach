import { dashboardLayoutCss } from './dashboardLayout.js';
import { initChartReveals, initOverviewLayout } from './dashboardInteractions.js';
import { dashboardLocalDate, resolveTodayWorkflow } from './todayWorkflow.js';

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 渲染单文件交互式 APEX 800m Sub-2:01 训练工作台
 * 默认采用严格隐私白名单模式 (includePrivate=false)：
 * 静态 HTML 中不包含任何个人生理指标、日记、疼痛记录或私人教练总结，需后端鉴权后动态加载渲染。
 */
export function renderDashboardHtml(payload, options = {}) {
  const includePrivate = Boolean(options.includePrivate);
  const {
    generatedAt = '',
    envToday = null,
    envForecast = null
  } = payload || {};

  const locationCity = envForecast?.location?.city || '';
  const todayWeather = envToday || envForecast?.today || null;
  const hasRealWeather = Boolean(
    todayWeather &&
      !todayWeather.weatherUnavailable &&
      todayWeather.tempC !== null &&
      todayWeather.tempC !== undefined
  );
  const publicBootstrap = {
    publicMode: !includePrivate,
    authRequired: !includePrivate,
    generatedAt,
    locationCity,
    weatherSummary: hasRealWeather
      ? {
          date: todayWeather.date,
          weatherText: todayWeather.weatherText,
          tempC: todayWeather.tempC,
          humidityPct: todayWeather.humidityPct,
          windMs: todayWeather.windMs
        }
      : null,
    privatePayload: includePrivate ? payload : null
  };

  const bootstrapJson = JSON.stringify(publicBootstrap).replace(/</g, '\\u003c');
  const publicWeatherText = hasRealWeather
    ? [locationCity, todayWeather.weatherText, `${todayWeather.tempC} °C`].filter(Boolean).join(' · ')
    : '';
  const brandMark = '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="4" y="8" width="24" height="16" rx="8" stroke="currentColor" stroke-width="2"/><rect x="8" y="12" width="16" height="8" rx="4" stroke="currentColor" stroke-width="1.5"/></svg></span>';
  const faviconSvg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#156046"/><rect x="10" y="18" width="44" height="28" rx="14" fill="none" stroke="#fff" stroke-width="4"/><rect x="17" y="25" width="30" height="14" rx="7" fill="none" stroke="#fff" stroke-width="3"/></svg>'
  );
  const views = [
    { key: 'today', label: '训练概览', short: '概览', icon: 'layout-dashboard' },
    { key: 'week', label: '7 日课表', short: '课表', icon: 'calendar-days' },
    { key: 'telemetry', label: '生理遥测', short: '遥测', icon: 'activity' },
    { key: 'diary', label: '打卡日记', short: '日记', icon: 'notebook-pen' }
  ];
  const viewButtons = (mobile) => views.map(({ key, icon, label, short }) =>
    `<button type="button" class="${mobile ? 'mobile-tab' : 'view-tab'}" data-view="${key}" aria-label="${label}"${key === 'today' ? ' aria-current="page"' : ''}><i data-lucide="${icon}" aria-hidden="true"></i><span>${mobile ? short : label}</span></button>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="day">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta id="meta-theme-color" name="theme-color" content="#F1F3EE" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${faviconSvg}" />
  <title>AI Running Coach · APEX 800m Sub-2:01 训练工作台</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config = { darkMode: 'class' };</script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script>
  <style>
    :root, html[data-theme="day"] {
      color-scheme: light;
      --bg-page: #F1F3EE;
      --bg-surface: #FDFEF9;
      --bg-muted: #EDF1EB;
      --border-hairline: #DDE5DC;
      --border-strong: #A8B9AE;
      --text-heading: #142820;
      --text-body: #30453C;
      --text-muted: #52665D;
      --input-bg: #FAFCF8;
      --input-border: #A8B9AE;
      --step-bg: #E4EEE6;
      --step-text: #245840;
      --accent: #156046;
      --accent-hover: #0F4C37;
      --on-accent: #FFFFFF;
      --accent-soft: #E0F0E6;
      --link: #165A43;
      --focus: #287757;
      --chart-track: #E6EBE5;
      --chart-volume: #4D9A78;
      --sleep-deep: #6257A8;
      --sleep-light: #22898E;
      --sleep-rem: #B95F83;
    }

    html[data-theme="night"] {
      color-scheme: dark;
      --bg-page: #111A16;
      --bg-surface: #18251F;
      --bg-muted: #203028;
      --border-hairline: #304238;
      --border-strong: #506959;
      --text-heading: #EDF4EA;
      --text-body: #D1DED4;
      --text-muted: #A5BCAF;
      --input-bg: #15211B;
      --input-border: #567262;
      --step-bg: #283F32;
      --step-text: #B4DDC4;
      --accent: #90C5A7;
      --accent-hover: #B2DDC2;
      --on-accent: #132A20;
      --accent-soft: #284035;
      --link: #A8DDBF;
      --focus: #9ED9B9;
      --chart-track: #293C32;
      --chart-volume: #66B891;
      --sleep-deep: #B3A0FF;
      --sleep-light: #66CDCF;
      --sleep-rem: #E996B6;
    }

    body {
      background-color: var(--bg-page);
      color: var(--text-body);
      font-family: "Segoe UI Variable Text", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      -webkit-tap-highlight-color: transparent;
      transition: background-color 0.3s ease, color 0.2s ease;
    }

    .surface-card {
      background-color: var(--bg-surface);
      border: 1px solid var(--border-hairline);
    }

    .surface-muted {
      background-color: var(--bg-muted);
      border: 1px solid var(--border-hairline);
      transition: background-color 0.2s ease, border-color 0.2s ease;
    }

    .border-hairline { border-color: var(--border-hairline); }
    .divide-hairline > :not([hidden]) ~ :not([hidden]) { border-color: var(--border-hairline); }
    .text-heading { color: var(--text-heading); }
    .text-body { color: var(--text-body); }
    .text-muted { color: var(--text-muted); }

    .step-badge { background: var(--step-bg); color: var(--step-text); }

    .pill-emerald { background: rgba(16, 185, 129, 0.12); color: #047857; border: 1px solid rgba(16, 185, 129, 0.30); }
    .pill-amber   { background: rgba(245, 158, 11, 0.12); color: #B45309; border: 1px solid rgba(245, 158, 11, 0.32); }
    .pill-rose    { background: rgba(244, 63, 94, 0.12);  color: #BE123C; border: 1px solid rgba(244, 63, 94, 0.32); }
    .pill-sky     { background: rgba(14, 165, 233, 0.12); color: #0369A1; border: 1px solid rgba(14, 165, 233, 0.30); }
    .pill-teal    { background: rgba(20, 184, 166, 0.12); color: #0F766E; border: 1px solid rgba(20, 184, 166, 0.30); }
    .pill-indigo  { background: rgba(99, 102, 241, 0.12); color: #4338CA; border: 1px solid rgba(99, 102, 241, 0.30); }
    .pill-violet  { background: rgba(139, 92, 246, 0.12); color: #6D28D9; border: 1px solid rgba(139, 92, 246, 0.30); }
    .pill-slate   { background: rgba(100, 116, 139, 0.10); color: #475569; border: 1px solid rgba(100, 116, 139, 0.25); }

    html[data-theme="night"] .pill-emerald { color: #6EE7B7; }
    html[data-theme="night"] .pill-amber   { color: #FCD34D; }
    html[data-theme="night"] .pill-rose    { color: #FDA4AF; }
    html[data-theme="night"] .pill-sky     { color: #7DD3FC; }
    html[data-theme="night"] .pill-teal    { color: #5EEAD4; }
    html[data-theme="night"] .pill-indigo  { color: #A5B4FC; }
    html[data-theme="night"] .pill-violet  { color: #C4B5FD; }
    html[data-theme="night"] .pill-slate   { color: #CBD5E1; }

    .sky-input {
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--text-heading);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .sky-input:focus {
      border-color: var(--focus);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .pro-slider {
      -webkit-appearance: none;
      appearance: none;
      height: 6px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.26);
      outline: none;
      touch-action: pan-y;
    }
    .pro-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #10B981;
      border: 2.5px solid var(--bg-surface);
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25), 0 2px 6px rgba(0,0,0,0.2);
      cursor: pointer;
      transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .pro-slider::-webkit-slider-thumb:hover { transform: scale(1.16); }
    .pro-slider-rose::-webkit-slider-thumb {
      background: #F43F5E;
      box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.25), 0 2px 6px rgba(0,0,0,0.2);
    }

    @keyframes cardRise {
      from { opacity: .72; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .motion-enter {
      animation: cardRise .19s cubic-bezier(.2,.8,.3,1) both;
      animation-delay: var(--stagger, 0ms);
    }

    @keyframes toastIn {
      from { opacity: 0; transform: translate3d(0, -10px, 0) scale(0.96); }
      to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
    }
    .toast-item {
      animation: toastIn 0.26s cubic-bezier(0.22, 1, 0.36, 1) both;
    }

    @keyframes barSlide {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }
    .loading-bar-runner {
      width: 35%;
      animation: barSlide 1.15s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }

    @media (prefers-reduced-motion: reduce) {
      .motion-enter, .toast-item { animation: none !important; }
      * { transition-duration: 0.01ms !important; }
    }

    ${dashboardLayoutCss}

    details summary::-webkit-details-marker { display: none; }
    .tab-hidden { display: none !important; }
    html:not(.apex-unlocked) .auth-only { display: none !important; }
    html.apex-unlocked #auth-gate { display: none !important; }
  </style>
</head>
<body class="min-h-screen antialiased">

  <!-- Global Top Loading Bar -->
  <div id="global-loading-bar" class="fixed top-0 left-0 right-0 h-0.5 z-50 overflow-hidden pointer-events-none hidden">
    <div class="loading-bar-runner h-full bg-gradient-to-r from-emerald-400 via-sky-500 to-emerald-400"></div>
  </div>

  <!-- Floating Toast Stack -->
  <div id="toast-container" class="fixed top-16 right-4 z-50 flex flex-col gap-2 max-w-xs w-full pointer-events-none"></div>

  <aside class="app-sidebar auth-only">
    <div class="sidebar-brand">
      ${brandMark}
      <span class="brand-name">AI Running Coach</span>
    </div>
    <nav class="sidebar-nav" aria-label="训练工作台">${viewButtons(false)}</nav>
    <div class="sidebar-footer">
      <span>比赛目标</span>
      <strong id="header-goal-pill"></strong>
      <span id="header-race-pill" hidden></span>
    </div>
  </aside>

  <div class="app-main">
    <header class="app-header">
      <div class="header-brand">${brandMark}<span class="brand-name">AI Running Coach</span></div>
      <div class="header-context auth-only" aria-hidden="true">
        <span>训练工作台</span><i data-lucide="chevron-right"></i><strong id="header-current-view">训练概览</strong>
      </div>
      <div class="header-actions">
        <button id="btn-theme-toggle" type="button" class="control-button icon-button" aria-label="切换主题" title="切换主题">
          <span id="theme-icon-wrap"><i data-lucide="sun" aria-hidden="true"></i></span>
        </button>
        <button id="btn-lock-logout" type="button" class="auth-only control-button icon-button" aria-label="锁定并退出" title="锁定并退出">
          <i data-lucide="lock" aria-hidden="true"></i>
        </button>
        <button id="btn-sync-garmin" type="button" class="auth-only control-button" aria-label="同步 Garmin" title="同步 Garmin">
          <i id="sync-icon" data-lucide="refresh-cw" aria-hidden="true"></i><span id="sync-label">同步</span>
        </button>
        <button id="btn-open-checkin" type="button" class="auth-only primary-button" data-today-checkin>
          <i data-lucide="plus" aria-hidden="true"></i><span data-today-checkin-label>今日打卡</span>
        </button>
      </div>
    </header>

    <main class="dashboard-content">
      <section id="auth-gate" class="auth-card">
        <span class="card-icon"><i data-lucide="lock-keyhole" aria-hidden="true"></i></span>
        <h1>解锁训练工作台</h1>
        <p>输入操作口令，查看课表、Garmin 恢复数据和打卡日记。</p>
        <form id="auth-unlock-form">
          <label for="gate-token-input">操作口令</label>
          <input id="gate-token-input" type="password" autocomplete="current-password" required
            placeholder="请输入操作口令" class="sky-input w-full px-3.5 py-2.5 rounded-lg text-sm" aria-describedby="gate-error" />
          <button id="btn-gate-unlock" type="submit" class="primary-button">解锁工作台</button>
        </form>
        <div id="gate-error" role="alert" class="hidden text-xs rounded-lg px-3 py-2 pill-rose"></div>
        ${publicWeatherText ? `<div class="auth-weather"><i data-lucide="cloud-sun" aria-hidden="true"></i>${escapeHtml(publicWeatherText)}</div>` : ''}
      </section>

      <div id="private-shell" class="auth-only">
        <div class="page-heading">
          <div class="page-heading-row">
            <h1 id="page-title" tabindex="-1">训练概览</h1>
            <button id="btn-edit-overview" type="button" class="control-button" aria-controls="overview-layout-toolbar">
              <i data-lucide="layout-grid" aria-hidden="true"></i>编辑排布
            </button>
          </div>
          <div class="page-meta">
            <time id="dashboard-date"></time>
            <span id="header-subtitle"></span>
            <span id="header-stage-display"></span>
            <span id="demo-source" class="demo-source" hidden>演示数据</span>
          </div>
        </div>

        <section data-section="today" aria-labelledby="page-title">
          <section id="today-focus" class="today-focus" aria-labelledby="today-focus-title">
            <div class="today-focus-main">
              <span class="today-focus-icon"><i data-lucide="activity" aria-hidden="true"></i></span>
              <div>
                <h2 id="today-focus-title"></h2>
                <p id="today-focus-detail" hidden></p>
              </div>
            </div>
            <div class="today-focus-actions">
              <button id="today-focus-secondary" class="control-button" type="button" data-workflow-action hidden></button>
              <button id="today-focus-primary" class="primary-button" type="button" data-workflow-action></button>
            </div>
          </section>
          <div id="overview-layout-toolbar" class="overview-layout-toolbar" hidden>
            <p>拖动卡片手柄，或用方向按钮调整顺序。</p>
            <div class="overview-layout-actions">
              <button id="btn-reset-overview" type="button" class="control-button">恢复默认</button>
              <button id="btn-cancel-overview" type="button" class="control-button">取消</button>
              <button id="btn-save-overview" type="button" class="primary-button">保存排布</button>
            </div>
            <p id="overview-layout-error" role="alert" class="pill-rose" hidden>浏览器无法保存排布，请检查此站点的存储设置。</p>
          </div>
          <div id="overview-layout-status" class="sr-only" role="status"></div>
          <div id="overview-grid" class="overview-grid">
            <article class="overview-card overview-workout" data-card="workout">
              <div class="overview-card-head">
                <h2>今日训练</h2>
                <span class="card-icon"><i data-lucide="timer" aria-hidden="true"></i></span>
              </div>
              <p id="overview-workout-name" class="workout-name"></p>
              <div id="overview-pace"></div>
              <dl id="overview-workout-metrics" class="metric-list"></dl>
              <div class="overview-footer">
                <a class="card-link" href="#today-workout-card">查看训练细节 <i data-lucide="arrow-down" aria-hidden="true"></i></a>
              </div>
            </article>

            <article id="readiness-band" class="overview-card" data-card="readiness">
              <div class="overview-card-head">
                <h2 id="readiness-title">训练准备度</h2>
                <span class="card-icon"><i data-lucide="heart-pulse" aria-hidden="true"></i></span>
              </div>
              <div class="readiness-main">
                <div class="readiness-ring ring-sweep">
                  <svg viewBox="0 0 96 96" aria-hidden="true">
                    <g transform="rotate(-90 48 48)">
                      <circle class="ring-track" cx="48" cy="48" r="36" stroke-width="7" fill="none" />
                      <circle id="readiness-ring-arc" class="ring-sweep-path" cx="48" cy="48" r="36" stroke-width="7" fill="none" stroke-linecap="round" pathLength="100" stroke-dasharray="100 100" style="--ring-offset:100" />
                    </g>
                  </svg>
                  <div class="ring-center">
                    <div id="readiness-score-num" class="card-value">—</div>
                    <div class="card-caption">满分 100</div>
                  </div>
                </div>
                <div id="readiness-meta"></div>
              </div>
              <div id="readiness-advisory-bar" class="hidden text-xs"></div>
            </article>

            <article class="overview-card overview-volume" data-card="volume">
              <div class="overview-card-head">
                <h2>近 8 周跑量</h2>
                <button type="button" class="card-link" data-view="telemetry">生理遥测 <i data-lucide="arrow-up-right" aria-hidden="true"></i></button>
              </div>
              <div class="volume-summary"><span id="overview-volume-total" class="card-value">—</span><span class="card-caption">累计跑量</span></div>
              <ol id="overview-volume-chart" class="volume-chart" aria-label="每周跑量"></ol>
              <p id="overview-volume-note" class="card-caption volume-note"></p>
            </article>

            <article class="overview-card overview-sleep" data-card="sleep">
              <div class="overview-card-head">
                <h2>夜间睡眠</h2>
                <span id="overview-sleep-date" class="card-caption"></span>
              </div>
              <div class="sleep-main">
                <div class="sleep-ring ring-sweep">
                  <svg viewBox="0 0 96 96" aria-hidden="true">
                    <defs>
                      <mask id="sleep-sweep-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="96" height="96">
                        <circle class="ring-sweep-path" cx="48" cy="48" r="39" fill="none" stroke="white" stroke-width="12"
                          pathLength="100" stroke-dasharray="100 100" transform="rotate(-90 48 48)" />
                      </mask>
                    </defs>
                    <circle class="ring-track" cx="48" cy="48" r="39" stroke-width="8" fill="none" />
                    <g mask="url(#sleep-sweep-mask)">
                      <g id="overview-sleep-arcs" transform="rotate(-90 48 48)"></g>
                    </g>
                  </svg>
                  <div class="ring-center">
                    <div id="overview-sleep-score" class="card-value">—</div>
                    <div class="card-caption">睡眠评分</div>
                  </div>
                </div>
                <div>
                  <div id="overview-sleep-hours" class="card-value">—</div>
                  <span class="card-caption">睡眠总时长</span>
                </div>
              </div>
              <dl id="overview-sleep-stages" class="metric-list"></dl>
            </article>

            <article class="overview-card overview-vitals" data-card="vitals">
              <div class="overview-card-head">
                <h2>晨间身体指标</h2>
                <span class="card-icon"><i data-lucide="activity" aria-hidden="true"></i></span>
              </div>
              <dl id="vitals-strip-4" class="metric-list"></dl>
            </article>

            <article class="overview-card overview-weather" data-card="weather">
              <div class="overview-card-head">
                <h2>训练环境</h2>
                <span class="card-icon"><i data-lucide="cloud-sun" aria-hidden="true"></i></span>
              </div>
              <div id="overview-weather"></div>
            </article>
          </div>

          <div class="workspace-grid today-details">
            <article class="workspace-panel workspace-main">
              <div class="panel-head"><h2>训练详情</h2></div>
              <div id="today-workout-card" tabindex="-1" class="space-y-5"></div>
            </article>
            <aside id="today-sidebar" class="workspace-panel"></aside>
          </div>
        </section>

        <section data-section="week" class="workspace-stack tab-hidden" aria-labelledby="page-title">
          <article class="workspace-panel motion-card">
            <div class="panel-head"><h2>训练日历</h2><span id="week-range" class="card-caption"></span></div>
            <div id="week-selector-grid" class="week-calendar" role="group" aria-label="选择训练日期"></div>
          </article>

          <div class="workspace-grid">
            <div id="week-pane-host" class="workspace-main"></div>
            <aside class="workspace-panel motion-card">
              <div class="panel-head"><h2>7 日计划总览</h2><i data-lucide="list-checks" aria-hidden="true"></i></div>
              <dl id="week-totals-row" class="week-totals"></dl>
              <div class="panel-subsection">
                <h3>训练阶段</h3>
                <ol id="stages-bar" class="stage-list"></ol>
              </div>
              <details id="weekly-review-banner" class="panel-subsection disclosure" hidden>
                <summary>周复盘和进阶说明 <i data-lucide="chevron-down" aria-hidden="true"></i></summary>
                <div id="weekly-review-text" class="review-copy"></div>
              </details>
            </aside>
          </div>
        </section>

        <section data-section="telemetry" class="workspace-stack tab-hidden" aria-labelledby="page-title">
          <article class="workspace-panel motion-card">
            <div class="panel-head"><h2>当前训练负荷</h2><span id="load-date" class="card-caption"></span></div>
            <dl class="load-metrics">
              <div><dt><span class="load-dot load-ctl"></span>长期体能 CTL</dt><dd id="load-ctl">—</dd><dd class="load-detail">42 天训练负荷</dd></div>
              <div><dt><span class="load-dot load-atl"></span>近期疲劳 ATL</dt><dd id="load-atl">—</dd><dd class="load-detail">7 天训练负荷</dd></div>
              <div><dt><span class="load-dot load-tsb"></span>状态平衡 TSB</dt><dd id="load-tsb">—</dd><dd class="load-detail">体能与疲劳差值</dd></div>
              <div><dt>急慢负荷比 ACWR</dt><dd id="load-acwr">—</dd><dd class="load-detail">描述性参考</dd></div>
            </dl>
          </article>

          <div class="workspace-grid charts-grid">
            <article class="workspace-panel workspace-main motion-card">
              <div class="panel-head">
                <h2 id="pmc-title">体能与疲劳趋势</h2>
                <span id="pmc-range" class="card-caption"></span>
              </div>
              <div class="chart-slot chart-slot-main"><canvas id="pmcChart" role="img" aria-label="长期体能、近期疲劳与状态平衡趋势"></canvas><p id="pmc-empty-hint" class="chart-empty hidden">暂无训练负荷趋势</p></div>
            </article>
            <article class="workspace-panel motion-card">
              <div class="panel-head"><h2 id="weekly-title">近 8 周跑量</h2><i data-lucide="chart-no-axes-column" aria-hidden="true"></i></div>
              <div class="chart-slot chart-slot-compact"><canvas id="weeklyChart" role="img" aria-label="近八周每周跑量"></canvas><p id="weekly-empty-hint" class="chart-empty hidden">近 8 周暂无跑步里程</p></div>
              <div class="panel-subsection">
                <div class="panel-head panel-head-small"><h3>心率区间时间占比</h3><span id="pi-badge" class="card-caption"></span></div>
                <div class="chart-slot chart-slot-zone"><canvas id="zoneChart" role="img" aria-label="五个心率区间的训练时长占比"></canvas><p id="zone-empty-hint" class="chart-empty hidden">暂无区间数据</p></div>
                <div id="zone-labels-strip" class="zone-legend"></div>
              </div>
            </article>
          </div>

          <div class="workspace-grid charts-grid">
            <article class="workspace-panel workspace-main motion-card">
              <div class="panel-head"><h2>重点训练遥测</h2><span class="card-caption">Garmin FIT</span></div>
              <p id="fit-title" class="fit-activity"></p>
              <div id="fit-metrics" class="fit-metrics"></div>
              <div class="chart-slot chart-slot-main"><canvas id="fitChart" role="img" aria-label="本次训练心率和配速趋势"></canvas><p id="fit-empty-hint" class="chart-empty hidden">暂无活动采样</p></div>
              <p id="fit-critique" class="fit-note" hidden></p>
            </article>
            <aside class="workspace-panel motion-card">
              <div id="split-track-panel" class="space-y-3"></div>
              <div class="panel-subsection">
                <h3>训练安全提醒</h3>
                <ul class="training-hints">
                  <li>慢跑结合心率、呼吸与体感，避免长时间停留在中等强度。</li>
                  <li>力量练习记录负荷、余力 RIR 和次日下肢反应。</li>
                  <li>局部痛感 ≥2/10、步态改变或掉速 &gt;3% 时及时减量。</li>
                </ul>
              </div>
            </aside>
          </div>
        </section>

        <section id="checkin-section" data-section="diary" class="workspace-grid diary-grid tab-hidden" aria-labelledby="page-title">
          <article class="workspace-panel workspace-main">
            <div class="panel-head">
              <h2>打卡记录</h2>
              <label class="diary-date"><span>日期</span><input id="checkin-date" type="date" class="sky-input rounded-lg" /></label>
            </div>

            <div id="editing-mode-banner" class="hidden rounded-xl px-3.5 py-2 text-xs pill-sky flex flex-wrap items-center justify-between gap-2">
              <span id="editing-mode-text" class="font-medium"></span>
              <div class="flex items-center gap-2 shrink-0">
                <button id="btn-back-today" type="button" class="px-2 py-0.5 rounded surface-muted text-[11px] text-heading hover:opacity-80 active:scale-95 transition cursor-pointer">切回今日</button>
                <button id="btn-delete-active" type="button" class="px-2 py-0.5 rounded pill-rose text-[11px] font-medium hover:opacity-90 active:scale-95 transition cursor-pointer">删除此记录</button>
              </div>
            </div>

            <div id="checkin-planned-context" class="surface-muted rounded-xl px-3.5 py-2.5 text-xs text-body flex items-center justify-between gap-2">
              <span>当日计划加载中...</span>
            </div>

            <div class="diary-group">
              <h3 id="diary-status-label">完成情况</h3>
              <div class="diary-status" id="status-buttons" role="group" aria-labelledby="diary-status-label">
              <button type="button" data-status="completed" class="status-btn px-3 py-2 rounded-xl border text-xs font-semibold active:scale-95 transition cursor-pointer pill-emerald">按计划完成</button>
              <button type="button" data-status="modified" class="status-btn px-3 py-2 rounded-xl border text-xs font-medium active:scale-95 transition cursor-pointer surface-muted border-hairline text-body">减量微调</button>
              <button type="button" data-status="rest" class="status-btn px-3 py-2 rounded-xl border text-xs font-medium active:scale-95 transition cursor-pointer surface-muted border-hairline text-body">请假休息</button>
              <button type="button" data-status="planned" class="status-btn px-3 py-2 rounded-xl border text-xs font-medium active:scale-95 transition cursor-pointer surface-muted border-hairline text-body">晨间体感</button>
              </div>
            </div>

            <div class="diary-group">
              <h3>体感与恢复</h3>
              <div class="diary-sliders">
              <div class="diary-slider">
                <div class="flex items-center justify-between text-xs">
                  <label for="checkin-rpe" class="text-body font-medium">主观疲劳 RPE</label>
                  <span id="rpe-label" class="font-mono font-semibold tabular-nums text-emerald-500">5 / 10</span>
                </div>
                <input id="checkin-rpe" type="range" min="1" max="10" value="5" class="pro-slider w-full" />
              </div>

              <div class="diary-slider">
                <div class="flex items-center justify-between text-xs">
                  <label for="checkin-pain" class="text-body font-medium">部位痛感</label>
                  <span id="pain-label" class="font-mono font-semibold tabular-nums text-muted">0 / 10</span>
                </div>
                <input id="checkin-pain" type="range" min="0" max="10" value="0" class="pro-slider pro-slider-rose w-full" />
              </div>
            </div>

            <div class="diary-sleep">
              <span id="diary-sleep-label" class="text-body font-medium">睡眠主观体感 <span class="text-muted font-normal">（选填）</span></span>
              <div id="sleep-quality-chips" class="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="diary-sleep-label">
                <button type="button" data-sq="1" class="sq-chip px-2.5 py-1 rounded-lg border border-hairline text-body active:scale-95 cursor-pointer transition">1 极差</button>
                <button type="button" data-sq="2" class="sq-chip px-2.5 py-1 rounded-lg border border-hairline text-body active:scale-95 cursor-pointer transition">2 偏困</button>
                <button type="button" data-sq="3" class="sq-chip px-2.5 py-1 rounded-lg border border-hairline text-body active:scale-95 cursor-pointer transition">3 一般</button>
                <button type="button" data-sq="4" class="sq-chip px-2.5 py-1 rounded-lg border border-hairline text-body active:scale-95 cursor-pointer transition">4 良好</button>
                <button type="button" data-sq="5" class="sq-chip px-2.5 py-1 rounded-lg border border-hairline text-body active:scale-95 cursor-pointer transition">5 满血</button>
              </div>
            </div>

            </div>

            <div class="diary-group">
              <h3 id="diary-pain-label">不适与伤病</h3>
              <div id="pain-area-chips" class="flex flex-wrap gap-1.5" role="group" aria-labelledby="diary-pain-label">
              <button type="button" data-area="无不适" class="area-chip px-2.5 py-1 rounded-lg border text-xs active:scale-95 transition cursor-pointer pill-emerald font-medium">无不适</button>
              <button type="button" data-area="膝外侧" class="area-chip px-2.5 py-1 rounded-lg border text-xs active:scale-95 transition cursor-pointer surface-muted border-hairline text-body">膝外侧</button>
              <button type="button" data-area="小腿/比目鱼肌" class="area-chip px-2.5 py-1 rounded-lg border text-xs active:scale-95 transition cursor-pointer surface-muted border-hairline text-body">小腿/比目鱼肌</button>
              <button type="button" data-area="跟腱/足底" class="area-chip px-2.5 py-1 rounded-lg border text-xs active:scale-95 transition cursor-pointer surface-muted border-hairline text-body">跟腱/足底</button>
              <button type="button" data-area="腘绳肌" class="area-chip px-2.5 py-1 rounded-lg border text-xs active:scale-95 transition cursor-pointer surface-muted border-hairline text-body">腘绳肌</button>
              <button type="button" data-area="髋/臀中肌" class="area-chip px-2.5 py-1 rounded-lg border text-xs active:scale-95 transition cursor-pointer surface-muted border-hairline text-body">髋/臀中肌</button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div>
                <label for="injury-status-select" class="block text-muted mb-1">持续伤病状态</label>
                <select id="injury-status-select" class="sky-input w-full rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500">
                  <option value="none">无新伤病记录变动</option>
                  <option value="active">仍存在（继续保护）</option>
                  <option value="improving">好转中（观察负荷）</option>
                  <option value="resolved">已明确恢复（解除限制）</option>
                </select>
              </div>
              <div>
                <label for="injury-impact-select" class="block text-muted mb-1">对跑步动作影响</label>
                <select id="injury-impact-select" class="sky-input w-full rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500">
                  <option value="none">无影响</option>
                  <option value="mild_discomfort">轻微不适但动作正常</option>
                  <option value="altered_form">影响步态或发力动作</option>
                  <option value="cannot_run">无法正常跑步</option>
                </select>
              </div>
            </div>

            <div id="itbs-pain-hint" class="hidden rounded-xl px-3.5 py-2.5 text-xs pill-rose">
              检测到局部痛感或中等以上不适：系统将优先触发安全降载；保存后如需立即刷新页面课表，也可点击下方“重算课表”。
            </div>

            </div>

            <div class="diary-group">
              <h3><label for="checkin-diary">训练记录</label></h3>
              <textarea id="checkin-diary" rows="3" placeholder="记录配速手感、心率漂移、力量完成度或入睡时间" class="sky-input w-full rounded-lg px-3.5 py-2.5 text-base sm:text-sm"></textarea>
              <details id="post-feedback-details" class="diary-feedback disclosure">
                <summary><span>课后实测 <small>选填</small></span><i data-lucide="chevron-down" aria-hidden="true"></i></summary>
              <div class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <input id="fb-dist" aria-label="实际距离（千米）" type="number" step="0.1" min="0" placeholder="实际距离 km" class="sky-input rounded-lg px-2.5 py-1.5 text-xs" />
                <input id="fb-dur" aria-label="实际时长（分钟）" type="number" min="0" placeholder="实际时长 min" class="sky-input rounded-lg px-2.5 py-1.5 text-xs" />
                <input id="fb-dropoff" aria-label="后程掉速百分比" type="number" step="0.1" placeholder="后程掉速 %" class="sky-input rounded-lg px-2.5 py-1.5 text-xs" />
              </div>
              <div class="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input id="fb-splits" aria-label="有效分组成绩" type="text" placeholder="有效分组成绩 如 4x400: 74/74/75/76" class="sky-input rounded-lg px-2.5 py-1.5 text-xs" />
                <select id="fb-form" aria-label="动作稳定性" class="sky-input rounded-lg px-2.5 py-1.5 text-xs">
                  <option value="">动作稳定性（可选）</option>
                  <option value="stable">动作保持稳定</option>
                  <option value="degraded">后程变形/僵硬</option>
                </select>
                <select id="fb-reaction" aria-label="次日反应" class="sky-input rounded-lg px-2.5 py-1.5 text-xs">
                  <option value="">次日反应（可选）</option>
                  <option value="fresh">轻快饱满</option>
                  <option value="normal_soreness">正常微酸</option>
                  <option value="heavy_fatigue">明显沉重疲劳</option>
                  <option value="pain_flare">痛感加重</option>
                </select>
              </div>
              <div class="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <input id="fb-str-ex" aria-label="力量主动作" type="text" placeholder="力量主动作（如深蹲）" class="sky-input rounded-lg px-2.5 py-1.5 text-xs" />
                <input id="fb-str-kg" aria-label="训练重量（千克）" type="number" step="0.5" min="0" placeholder="重量 kg" class="sky-input rounded-lg px-2.5 py-1.5 text-xs" />
                <input id="fb-str-sets" aria-label="组数和次数" type="text" placeholder="组数×次数 如3x8" class="sky-input rounded-lg px-2.5 py-1.5 text-xs" />
                <input id="fb-str-rir" aria-label="每组余力 RIR" type="number" step="0.5" min="0" max="10" placeholder="余力 RIR (如2)" class="sky-input rounded-lg px-2.5 py-1.5 text-xs" />
              </div>
              <div class="mt-2.5">
                <select id="fb-test-purpose" aria-label="测试类型" class="sky-input w-full rounded-lg px-2.5 py-1.5 text-xs">
                  <option value="none">常规训练课（非测试）</option>
                  <option value="recovery_observation">恢复与配速-心率对应观察跑（亚极量，不直接套能力公式）</option>
                  <option value="capacity_calibration">场地全力能力标定测验（如1500–2000m/直线冲刺）</option>
                </select>
              </div>
            </details>

            </div>

            <div class="diary-actions">
              <div class="diary-save">
                <time id="diary-save-date" class="diary-save-date"></time>
                <div id="checkin-feedback" class="diary-save-status hidden" role="status"></div>
                <button id="btn-submit-checkin" type="button" class="primary-button">保存打卡</button>
              </div>
              <button id="btn-recalculate-plan" type="button" class="control-button" title="结合最新打卡/伤病反馈与缓存遥测数据，重新生成课表">
                <i id="recalc-icon" data-lucide="sparkles" class="w-3.5 h-3.5"></i>
                <span id="recalc-label">重算课表</span>
              </button>
            </div>
          </article>

          <aside class="workspace-panel motion-card">
            <div class="panel-head">
              <h2>训练与恢复日记</h2>
              <span id="diary-count" class="card-caption"></span>
            </div>
            <div id="diary-timeline" class="diary-timeline" tabindex="0" role="region" aria-label="历史打卡记录"></div>
          </aside>
        </section>

      </div>
    </main>
  </div>

  <nav id="mobile-bottom-dock" class="auth-only mobile-dock" aria-label="训练工作台">${viewButtons(true)}</nav>

  <script>
    if (window.lucide) lucide.createIcons();
    var BOOTSTRAP = ${bootstrapJson};
    var TOKEN_KEY = 'garmin_coach_admin_token';
    var THEME_KEY = 'garmin_coach_theme';
    var CIRCLED_NUMS = '①②③④⑤⑥⑦⑧⑨⑩';
    var dashboardLocalDate = (${dashboardLocalDate.toString()});
    var resolveTodayWorkflow = (${resolveTodayWorkflow.toString()});
    (${initOverviewLayout.toString()})(showToast);
    var chartReveals = (${initChartReveals.toString()})();
    var chartInstances = [];
    var currentTheme = 'day';
    var activeDashboard = null;
    var checkinEntries = [];

    var TYPE_STYLE = {
      E: { dot: 'bg-sky-500', pill: 'pill-sky', label: '轻松跑 E' },
      M: { dot: 'bg-indigo-500', pill: 'pill-indigo', label: '稳态 M' },
      T: { dot: 'bg-amber-500', pill: 'pill-amber', label: '阈值跑 T' },
      I: { dot: 'bg-violet-500', pill: 'pill-violet', label: '间歇跑 I' },
      R: { dot: 'bg-rose-500', pill: 'pill-rose', label: '速度跑 R' },
      LSD: { dot: 'bg-emerald-500', pill: 'pill-emerald', label: '长距离 LSD' },
      STR: { dot: 'bg-teal-500', pill: 'pill-teal', label: '力量交叉' },
      REST: { dot: 'bg-slate-400', pill: 'pill-slate', label: '休息恢复' }
    };

    var CHECKIN_STATUS_META = {
      completed: { label: '按计划完成', cls: 'pill-emerald' },
      modified: { label: '减量微调', cls: 'pill-amber' },
      rest: { label: '请假休息', cls: 'pill-sky' },
      planned: { label: '晨间体感', cls: 'pill-slate' }
    };

    var LIGHT_STYLES = {
      green: { dot: '#10B981', pill: 'pill-emerald' },
      yellow: { dot: '#F59E0B', pill: 'pill-amber' },
      red: { dot: '#F43F5E', pill: 'pill-rose' },
      insufficient_data: { dot: '#94A3B8', pill: 'pill-slate' }
    };

    function esc(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatPaceClient(secPerKm) {
      if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '--:--';
      var r = Math.round(secPerKm);
      return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0');
    }

    function formatPaceAxisClient(value) {
      var pace = formatPaceClient(value);
      return pace === '--:--' ? '—' : pace + '/km';
    }

    function workoutPaceClient(day) {
      if (!day || day.type === 'REST') return null;
      var base = String(day.basePace || '').trim();
      var corrected = String(day.correctedPace || '').trim();
      var emptyPace = /^(?:—|--(?::--)?)$/;
      if (emptyPace.test(base)) base = '';
      if (emptyPace.test(corrected)) corrected = '';
      var target = corrected || base;
      if (!target) return null;
      return { target: target, original: base && corrected && base !== corrected ? base : '' };
    }

    function renderWorkoutPaceClient(pace) {
      if (!pace) return '';
      var formatted = pace.target.endsWith('/km')
        ? esc(pace.target.slice(0, -3)) + '<small>/km</small>' : esc(pace.target);
      return '<div class="workout-pace">' +
        '<span class="workout-pace-label">' + (pace.original ? '气象修正后配速' : '执行参考配速') + '</span>' +
        '<strong class="workout-pace-value">' + formatted + '</strong>' +
        (pace.original ? '<span class="workout-pace-base">原计划 ' + esc(pace.original) + '</span>' : '') +
        '</div>';
    }

    function parseGoalSecondsClient(targetTimeStr) {
      var raw = String(targetTimeStr || '').trim();
      if (!raw) return null;
      var parts = raw.split(':').map(function (p) { return Number(p); });
      if (parts.some(function (n) { return !Number.isFinite(n); })) return null;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return null;
    }

    function formatSecToClockClient(sec) {
      var n = Number(sec);
      if (!Number.isFinite(n) || n <= 0) return '--';
      var mins = Math.floor(n / 60);
      var rem = (n - mins * 60).toFixed(1).replace(/\\.0$/, '');
      if (mins <= 0) return rem + 's';
      return mins + ':' + (Number(rem) < 10 ? '0' : '') + rem;
    }

    function computeDaysToRaceClient(raceDateStr, baseDateStr) {
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(raceDateStr || ''))) return null;
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(baseDateStr || ''))) return null;
      var raceMs = Date.parse(raceDateStr + 'T00:00:00Z');
      var baseMs = Date.parse(baseDateStr + 'T00:00:00Z');
      if (!Number.isFinite(raceMs) || !Number.isFinite(baseMs)) return null;
      return Math.max(0, Math.round((raceMs - baseMs) / 86400000));
    }

    function getAqiInfoClient(aqi) {
      var n = Number(aqi);
      if (!Number.isFinite(n) || n <= 0) return { label: 'AQI --', cls: 'pill-slate' };
      if (n <= 50) return { label: 'AQI ' + n + ' 优', cls: 'pill-emerald' };
      if (n <= 100) return { label: 'AQI ' + n + ' 良', cls: 'pill-amber' };
      if (n <= 150) return { label: 'AQI ' + n + ' 轻度', cls: 'pill-amber' };
      return { label: 'AQI ' + n + ' 偏高', cls: 'pill-rose' };
    }

    function splitTopLevelStepsClient(rawText) {
      var text = String(rawText == null ? '' : rawText).replace(/\\r\\n/g, '\\n').trim();
      if (!text) return [];
      var items = [];
      var current = '';
      var depth = 0;
      for (var i = 0; i < text.length; i += 1) {
        var ch = text[i];
        if (ch === '(' || ch === '（') {
          if (depth === 0 && current.trim().endsWith('。')) {
            items.push(current.trim());
            current = ch;
            depth += 1;
            continue;
          }
          depth += 1;
          current += ch;
          continue;
        }
        if (ch === ')' || ch === '）') {
          depth = Math.max(0, depth - 1);
          current += ch;
          continue;
        }
        if (ch === '\\n') {
          if (current.trim()) items.push(current.trim());
          current = '';
          continue;
        }
        if (depth === 0 && (ch === '；' || ch === ';')) {
          if (current.trim()) items.push(current.trim());
          current = '';
          continue;
        }
        if (depth === 0 && CIRCLED_NUMS.indexOf(ch) !== -1 && current.trim().length > 0) {
          items.push(current.trim());
          current = ch;
          continue;
        }
        if (depth === 0 && ch === '。' && i < text.length - 1) {
          var rest = text.slice(i + 1).trim();
          if (rest) {
            items.push((current + ch).trim());
            current = '';
            continue;
          }
        }
        current += ch;
      }
      if (current.trim()) items.push(current.trim());
      return items;
    }

    function formatDetailBlocksClient(rawText, extraNote) {
      var parts = splitTopLevelStepsClient(rawText);
      var noteTrimmed = String(extraNote == null ? '' : extraNote).trim();
      if (parts.length === 0 && !noteTrimmed) return '<p class="text-xs text-muted">--</p>';
      var rows = parts.map(function (item) {
        var badge = '';
        var body = item;
        var circledIdx = CIRCLED_NUMS.indexOf(item[0]);
        if (circledIdx !== -1) {
          badge = String(circledIdx + 1);
          body = item.slice(1).trim();
        } else {
          var numMatch = item.match(/^(?:[（(](\\d{1,2})[)）]|(\\d{1,2})[、.)）])\\s*(.+)$/);
          if (numMatch) {
            badge = numMatch[1] || numMatch[2];
            body = numMatch[3].trim();
          }
        }
        return { badge: badge, body: body };
      });

      var listHtml = rows.length === 1 && !rows[0].badge
        ? '<p class="text-[13px] text-body leading-relaxed">' + esc(rows[0].body) + '</p>'
        : '<ul class="space-y-1.5">' + rows.map(function (row) {
            return row.badge
              ? '<li class="flex items-start gap-2 text-[13px] text-body leading-relaxed"><span class="step-badge inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded text-[10px] font-mono font-semibold shrink-0 mt-0.5">' + esc(row.badge) + '</span><span class="min-w-0">' + esc(row.body) + '</span></li>'
              : '<li class="flex items-start gap-2 text-[13px] text-body leading-relaxed"><span class="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0 mt-2"></span><span class="min-w-0">' + esc(row.body) + '</span></li>';
          }).join('') + '</ul>';

      if (!noteTrimmed) return listHtml;
      return listHtml + '<div class="mt-2 pt-2 border-t border-hairline text-xs text-muted leading-relaxed flex items-start gap-1.5"><span class="text-sky-500 font-medium shrink-0">气象修正</span><span>' + esc(noteTrimmed) + '</span></div>';
    }

    function formatStructuredStepsClient(day) {
      if (Array.isArray(day.steps) && day.steps.length > 0) {
        return '<ul class="space-y-1.5">' + day.steps.map(function (s, idx) {
          var label = '';
          if (s.kind === 'interval' || s.kind === 'strides') {
            label = s.reps + '×' + s.distanceMeters + 'm' + (s.pace ? ' @ ' + s.pace : '') + (s.restSec != null ? '（休 ' + s.restSec + 's）' : '');
          } else if (s.kind === 'steady') {
            label = (s.distanceKm ? s.distanceKm + 'km' : (s.durationMin ? s.durationMin + 'min' : '')) + (s.pace ? ' @ ' + s.pace : '') + (s.description ? ' · ' + s.description : '');
          } else {
            label = (s.description || s.kind || '主课步骤') + (s.distanceKm ? ' ' + s.distanceKm + 'km' : '') + (s.durationMin ? ' ' + s.durationMin + 'min' : '');
          }
          return '<li class="flex items-start gap-2 text-[13px] text-body leading-relaxed"><span class="step-badge inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded text-[10px] font-mono font-semibold shrink-0 mt-0.5">' + (idx + 1) + '</span><span class="min-w-0">' + esc(label) + '</span></li>';
        }).join('') + '</ul>';
      }
      return formatDetailBlocksClient(day.mainSetDetail);
    }

    function renderWorkflowStepsClient(day, pace) {
      var steps = [
        { num: '01', title: '热身与激活', accent: 'text-sky-500', dot: 'bg-sky-500', html: formatDetailBlocksClient(day.warmup) },
        { num: '02', title: pace?.original ? '主课原计划' : '主课', accent: 'text-emerald-500', dot: 'bg-emerald-500', html: formatStructuredStepsClient(day) },
        { num: '03', title: '冷身与防伤', accent: 'text-teal-500', dot: 'bg-teal-500', html: formatDetailBlocksClient(day.cooldown) },
        { num: '04', title: '营养与气象', accent: 'text-amber-500', dot: 'bg-amber-500', html: formatDetailBlocksClient(day.nutrition, day.envAdjustmentNote) }
      ];
      return '<div class="divide-y divide-hairline">' + steps.map(function (s) {
        return '<div class="py-3.5 first:pt-1 last:pb-1 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 items-start">' +
          '<div class="sm:col-span-3 flex items-center gap-2 pt-0.5">' +
            '<span class="w-1.5 h-1.5 rounded-full ' + s.dot + ' shrink-0"></span>' +
            '<span class="font-mono text-[11px] font-bold ' + s.accent + '">' + s.num + '</span>' +
            '<span class="text-xs font-semibold text-heading">' + s.title + '</span>' +
          '</div>' +
          '<div class="sm:col-span-9 min-w-0">' + s.html + '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    function classifyCoachClauseClient(text, explicitTag) {
      if (explicitTag) {
        if (/打卡|日记/.test(explicitTag)) return { label: '打卡联动', cls: 'pill-emerald' };
        if (/备忘|教练/.test(explicitTag)) return { label: '教练备忘', cls: 'pill-sky' };
        return { label: explicitTag.slice(0, 6), cls: 'pill-slate' };
      }
      if (/红灯|黄灯|熔断|睡眠|中枢|修复|HRV|RHR|基线|数据不足/.test(text)) return { label: '恢复门禁', cls: 'pill-rose' };
      if (/ACWR|CTL|ATL|TSB|重启|跑量|台阶|抢快|基座|极化|进阶|复盘/.test(text)) return { label: '负荷节奏', cls: 'pill-sky' };
      if (/海拔|AQI|气温|露点|湿度|跑步机|室内|风|气象/.test(text)) return { label: '环境修正', cls: 'pill-amber' };
      if (/痛感|伤病|防线|护栏|膝|跟腱|小腿|动作/.test(text)) return { label: '护栏提醒', cls: 'pill-teal' };
      return { label: '要点', cls: 'pill-emerald' };
    }

    function formatCoachSummaryClient(rawText, day, readiness) {
      var text = String(rawText == null ? '' : rawText).trim();
      var sections = text.split(/(?=【[^】]+】)|[｜|]/).filter(Boolean);
      var rows = [];
      sections.forEach(function (sec) {
        var explicitTag = '';
        var content = sec.trim();
        var tagMatch = content.match(/^【([^】]+)】\\s*(.+)$/);
        if (tagMatch) {
          explicitTag = tagMatch[1].trim();
          content = tagMatch[2].trim();
        }
        splitTopLevelStepsClient(content).forEach(function (clause) {
          var cleaned = clause.replace(/[；;]+$/, '').trim();
          if (cleaned) rows.push({ tag: classifyCoachClauseClient(cleaned, explicitTag), body: cleaned });
        });
      });
      var lowered = Boolean(day?.reductionMeta?.applied || day?.reductionApplied);
      var decision = '暂无今日课表';
      if (day) {
        if (day.type === 'REST') decision = '今日休息恢复';
        else {
          decision = lowered ? '今日减量' : '今日按课表执行';
          if (day.title) decision += ' · ' + day.title;
        }
      }
      var explanation = rows.find(function (row) {
        return row.tag.label === '调整原因' && !/^因[\\s，,]*触发门控调整/.test(row.body);
      });
      var reason = day?.reductionMeta?.reason ||
        (day?.type === 'REST' ? day.mainSetSummary : '') ||
        explanation?.body || readiness.triggers?.[0] || '';
      var lead = '<div class="coach-decision"><strong>' + esc(decision) + '</strong>' +
        (reason ? '<p class="coach-reason">' + esc(splitTopLevelStepsClient(reason)[0] || reason) + '</p>' : '') + '</div>';
      if (!rows.length) return lead;

      function renderRows(items) {
        return '<div class="coach-rows">' + items.map(function (row) {
          return '<div class="coach-row">' +
            '<span class="coach-tag ' + row.tag.cls + '">' + esc(row.tag.label) + '</span>' +
            '<p>' + esc(row.body) + '</p>' +
          '</div>';
        }).join('') + '</div>';
      }

      return lead + '<details class="coach-brief disclosure">' +
          '<summary><span class="coach-brief-show">展开完整简报</span><span class="coach-brief-hide">收起简报</span><i data-lucide="chevron-down" aria-hidden="true"></i></summary>' +
          '<div class="coach-brief-body" tabindex="0" role="region" aria-label="完整教练简报">' + renderRows(rows) + '</div>' +
        '</details>';
    }

    function renderProvenanceTagClient(prov, field) {
      var info = prov && prov[field];
      if (!info) return '';
      if (info.source === 'stale_cache') return ' <span class="provenance-label text-muted">(缓存 ' + esc(info.date || '') + ')</span>';
      if (info.source === 'missing') return ' <span class="provenance-label text-muted">(缺失)</span>';
      if (info.source === 'config_baseline') return ' <span class="provenance-label text-muted">(配置估算)</span>';
      return info.date ? ' <span class="provenance-label text-muted">(' + esc(info.date.slice(5)) + ')</span>' : '';
    }

    function showToast(message, tone) {
      var host = document.getElementById('toast-container');
      if (!host) return;
      var el = document.createElement('div');
      var cls = tone === 'error' ? 'pill-rose' : tone === 'info' ? 'pill-sky' : 'pill-emerald';
      el.className = 'toast-item pointer-events-auto rounded-xl px-3.5 py-2.5 text-xs font-medium shadow-lg backdrop-blur-md ' + cls;
      el.textContent = message;
      host.appendChild(el);
      setTimeout(function () {
        el.style.opacity = '0';
        el.style.transform = 'translate3d(0, -6px, 0)';
        el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        setTimeout(function () { el.remove(); }, 220);
      }, 2800);
    }

    function setGlobalLoading(active) {
      var bar = document.getElementById('global-loading-bar');
      if (!bar) return;
      bar.classList.toggle('hidden', !active);
    }

    function getSavedToken() {
      try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    }
    function setSavedToken(tok) {
      try { if (tok) localStorage.setItem(TOKEN_KEY, tok); else localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    }

    function authHeaders(extra) {
      var h = Object.assign({}, extra || {});
      var tok = getSavedToken();
      if (tok) h['X-Coach-Token'] = tok;
      return h;
    }

    function getChartPalette(theme) {
      if (theme === 'night') {
        return { text: '#94A3B8', grid: 'rgba(255, 255, 255, 0.06)', border: 'rgba(255, 255, 255, 0.08)', tooltipBg: '#0B101B', tooltipBorder: 'rgba(255, 255, 255, 0.14)' };
      }
      return { text: '#475569', grid: 'rgba(15, 23, 42, 0.07)', border: 'rgba(15, 23, 42, 0.10)', tooltipBg: 'rgba(15, 23, 42, 0.94)', tooltipBorder: 'rgba(15, 23, 42, 0.16)' };
    }

    (function initThemeSwitcher() {
      try {
        var s = localStorage.getItem(THEME_KEY);
        if (s === 'night' || s === 'obsidian') currentTheme = 'night';
        else currentTheme = 'day';
      } catch (e) {}
      var btn = document.getElementById('btn-theme-toggle');
      var iconWrap = document.getElementById('theme-icon-wrap');
      var metaTheme = document.getElementById('meta-theme-color');

      function applyTheme(theme, notify) {
        currentTheme = theme === 'night' ? 'night' : 'day';
        document.documentElement.setAttribute('data-theme', currentTheme);
        document.documentElement.classList.toggle('dark', currentTheme === 'night');
        if (metaTheme) metaTheme.setAttribute('content', currentTheme === 'night' ? '#111A16' : '#F1F3EE');
        if (btn) btn.setAttribute('aria-pressed', String(currentTheme === 'night'));
        if (iconWrap) {
          iconWrap.innerHTML = currentTheme === 'night'
            ? '<i data-lucide="moon" aria-hidden="true"></i>'
            : '<i data-lucide="sun" aria-hidden="true"></i>';
          if (window.lucide) lucide.createIcons();
        }
        try { localStorage.setItem(THEME_KEY, currentTheme); } catch (e) {}
        var pal = getChartPalette(currentTheme);
        if (window.Chart) {
          Chart.defaults.color = pal.text;
          Chart.defaults.borderColor = pal.border;
          chartInstances.forEach(function (chart) {
            if (!chart || !chart.options) return;
            if (chart.options.plugins) {
              if (chart.options.plugins.legend && chart.options.plugins.legend.labels) chart.options.plugins.legend.labels.color = pal.text;
              if (chart.options.plugins.tooltip) {
                chart.options.plugins.tooltip.backgroundColor = pal.tooltipBg;
                chart.options.plugins.tooltip.borderColor = pal.tooltipBorder;
              }
            }
            if (chart.options.scales) {
              Object.keys(chart.options.scales).forEach(function (k) {
                var axis = chart.options.scales[k];
                if (!axis) return;
                if (!axis.ticks) axis.ticks = {};
                axis.ticks.color = pal.text;
                if (axis.grid && axis.grid.color) axis.grid.color = pal.grid;
              });
            }
            chart.update('none');
          });
        }
        if (notify) showToast('已切换至「' + (currentTheme === 'night' ? '夜训赛道' : '高原晴日') + '」模式', 'info');
      }
      applyTheme(currentTheme, false);
      if (btn) btn.addEventListener('click', function () { applyTheme(currentTheme === 'day' ? 'night' : 'day', true); });
    })();

    function triggerSectionMotion(sectionEl) {
      if (!sectionEl) return;
      sectionEl.querySelectorAll('.motion-card').forEach(function (card, idx) {
        card.classList.remove('motion-enter');
        card.style.setProperty('--stagger', (idx * 20) + 'ms');
        void card.offsetWidth;
        card.classList.add('motion-enter');
      });
    }

    var setActiveView = (function initViewTabs() {
      var navigation = document.querySelectorAll('.view-tab, .mobile-tab');
      var sections = document.querySelectorAll('[data-section]');
      var labels = ${JSON.stringify(Object.fromEntries(views.map(({ key, label }) => [key, label])))};
      var pageTitle = document.getElementById('page-title');
      var headerView = document.getElementById('header-current-view');

      function switchTo(view, interactive) {
        navigation.forEach(function (button) {
          if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
          else button.removeAttribute('aria-current');
        });
        sections.forEach(function (section) {
          var active = section.dataset.section === view;
          section.classList.toggle('tab-hidden', !active);
          if (interactive && active) triggerSectionMotion(section);
        });
        document.documentElement.dataset.activeView = view;
        chartReveals.activate(view);
        pageTitle.textContent = labels[view];
        headerView.textContent = labels[view];
        if (interactive) {
          window.scrollTo(0, 0);
          pageTitle.focus({ preventScroll: true });
        }
        try { localStorage.setItem('garmin_coach_active_tab', view); } catch (e) {}
      }

      document.querySelectorAll('button[data-view]').forEach(function (button) {
        button.addEventListener('click', function () { switchTo(button.dataset.view, true); });
      });
      var initial = 'today';
      try {
        var saved = localStorage.getItem('garmin_coach_active_tab');
        if (Object.hasOwn(labels, saved)) initial = saved;
      } catch (e) {}
      switchTo(initial, false);
      return function (view) { switchTo(view, true); };
    })();

    function renderOverviewClient(payload, todayDay, pace, wellness, readiness, weather, runWindow, envAdjustment) {
      function node(id) { return document.getElementById(id); }

      function number(value) {
        if (value == null || value === '') return null;
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }

      function measure(value, unit) {
        return value == null || value === '' ? '—' : esc(value) + (unit ? ' ' + unit : '');
      }

      function row(label, value) {
        return '<div class="metric-row"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
      }

      function duration(minutes) {
        if (minutes == null) return '—';
        var rounded = Math.round(minutes);
        var hours = Math.floor(rounded / 60);
        var remainder = rounded % 60;
        return (hours ? hours + ' 小时 ' : '') + remainder + ' 分钟';
      }

      var prov = wellness.provenance || {};
      node('overview-workout-name').textContent = todayDay?.title || '暂无今日课表';
      node('overview-pace').innerHTML = renderWorkoutPaceClient(pace);
      node('overview-workout-metrics').innerHTML = todayDay
        ? row('训练类型', esc(TYPE_STYLE[todayDay.type]?.label || todayDay.type || '—')) +
          row('计划距离', measure(todayDay.plannedDistanceKm, 'km')) +
          row('计划用时', measure(todayDay.plannedDurationMin, '分钟'))
        : '';

      var weeks = Array.isArray(payload.weeklyZones?.weekly) ? payload.weeklyZones.weekly.slice(-8) : [];
      var distances = weeks.map(function (week) { return number(week.distanceKm); });
      var total = distances.reduce(function (sum, value) { return sum + (value ?? 0); }, 0);
      var largest = Math.max(0, ...distances);
      var distanceFmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
      node('overview-volume-total').innerHTML = distances.some(function (km) { return km !== null; })
        ? distanceFmt.format(total) + ' <small>km</small>' : '—';
      node('overview-volume-chart').innerHTML = weeks.map(function (week, index) {
        var km = distances[index];
        var distance = km === null ? '—' : distanceFmt.format(km);
        var date = esc(week.weekStart || '');
        var fill = km > 0 && largest > 0 ? 100 * km / largest : 0;
        return '<li style="--bar-distance-from-right:' + (weeks.length - 1 - index) + '" title="' + date + ' 起始周，' + distance + ' km">' +
          '<span class="volume-number">' + distance + '</span>' +
          '<span class="volume-track" aria-hidden="true"><span class="volume-fill" style="height:' + fill + '%"></span></span>' +
          '<time class="volume-date" datetime="' + date + '">' + date.slice(5).replace(/^0/, '').replace('-', '/') + '</time></li>';
      }).join('');
      node('overview-volume-note').textContent = !weeks.length ? '暂无跑量记录'
        : total > 0 ? '周一为起点 · 含本周截至目前' : '近 8 周暂无跑步里程';

      var sleepDate = prov.sleep?.date || wellness.date || '';
      var sleepHours = number(wellness.sleepHours);
      var sleepScore = number(wellness.sleepScore);
      var sleepStages = [
        { label: '深睡', color: 'deep', minutes: number(wellness.deepSleepMin) },
        { label: '浅睡', color: 'light', minutes: number(wellness.lightSleepMin) },
        { label: '快速眼动', color: 'rem', minutes: number(wellness.remSleepMin) }
      ];
      var totalStages = sleepStages.reduce(function (sum, stage) { return sum + Math.max(0, stage.minutes ?? 0); }, 0);
      var occupied = 0;
      node('overview-sleep-arcs').innerHTML = sleepStages.map(function (stage) {
        if (!(stage.minutes > 0)) return '';
        var share = 100 * stage.minutes / totalStages;
        var gap = share < 100 ? Math.min(2, share / 2) : 0;
        var length = share - gap;
        var offset = -occupied - gap / 2;
        occupied += share;
        return '<circle class="sleep-' + stage.color + '" cx="48" cy="48" r="39" fill="none" stroke="currentColor" ' +
          'stroke-width="8" pathLength="100" stroke-dasharray="' + length + ' ' + (100 - length) + '" stroke-dashoffset="' + offset + '" />';
      }).join('');
      node('overview-sleep-date').textContent = sleepHours === null && sleepScore === null && !totalStages
        ? '暂无记录' : sleepDate + (prov.sleep?.source === 'stale_cache' ? ' · 缓存' : '');
      node('overview-sleep-score').textContent = sleepScore ?? '—';
      node('overview-sleep-hours').innerHTML = sleepHours === null
        ? '—' : sleepHours.toFixed(1) + ' <small>小时</small>';
      node('overview-sleep-stages').innerHTML = sleepStages.map(function (stage) {
        return row('<span class="sleep-swatch sleep-' + stage.color + '" aria-hidden="true"></span>' + stage.label, duration(stage.minutes));
      }).join('');

      var readinessScore = number(readiness.score);
      var readinessStyle = LIGHT_STYLES[readiness.light] || LIGHT_STYLES.insufficient_data;
      var arc = node('readiness-ring-arc');
      arc.setAttribute('stroke', readinessStyle.dot);
      arc.style.visibility = readinessScore > 0 ? '' : 'hidden';
      arc.style.setProperty('--ring-offset', readinessScore === null ? 100 : 100 - Math.min(100, Math.max(0, readinessScore)));
      node('readiness-score-num').textContent = readinessScore === null ? '—' : Math.round(readinessScore);
      var quality = readiness.dataQuality || {};
      node('readiness-meta').innerHTML =
        '<span class="justify-self-start px-2 py-0.5 rounded-md text-xs font-semibold ' + readinessStyle.pill + '">' +
          esc(readiness.lightLabel || '数据不足') + '</span>' +
        '<p class="card-caption">' + esc(quality.dataDate || wellness.date || '日期未知') +
          ' · 可用 ' + esc(quality.availableSignals ?? '—') + '/4 项</p>' +
        '<p class="text-xs leading-relaxed">' + esc((readiness.triggers || []).join(' · ') || (readinessScore === null ? '等待数据同步' : '')) + '</p>';
      var advisories = Array.isArray(readiness.advisories) ? readiness.advisories : [];
      node('readiness-advisory-bar').classList.toggle('hidden', advisories.length === 0);
      node('readiness-advisory-bar').innerHTML = advisories.length
        ? '<p class="rounded-lg px-2.5 py-2 pill-amber">' + esc(advisories.join('；')) + '</p>' : '';

      var hrvRange = [wellness.hrvBaselineLow, wellness.hrvBaselineHigh].every(function (value) { return number(value) !== null; });
      node('vitals-strip-4').innerHTML =
        row('心率变异性' + renderProvenanceTagClient(prov, 'hrv'), measure(wellness.hrvToday, 'ms')) +
        row('HRV 7 日均值', measure(wellness.hrv7dAvg, 'ms')) +
        (hrvRange ? row('HRV 基线', esc(wellness.hrvBaselineLow) + '–' + esc(wellness.hrvBaselineHigh) + ' ms') : '') +
        row('静息心率' + renderProvenanceTagClient(prov, 'rhr'), measure(wellness.rhrToday, 'bpm') +
          (number(wellness.rhr7dAvg) === null ? '' : ' <span class="metric-context">7 日均 ' + esc(wellness.rhr7dAvg) + '</span>')) +
        row('晨间身体电量' + renderProvenanceTagClient(prov, 'bodyBattery'), measure(wellness.bodyBatteryMorning, '%')) +
        row('今日步数', measure(wellness.stepsToday, '步'));

      var hasWeather = weather && !weather.weatherUnavailable && number(weather.tempC) !== null;
      var aqi = hasWeather ? getAqiInfoClient(weather.usAqi) : null;
      node('overview-weather').innerHTML = hasWeather
        ? '<div class="weather-summary"><div class="card-value">' + esc(weather.tempC) + ' <small>°C</small></div>' +
          '<span class="card-caption">' + esc([runWindow, weather.weatherText].filter(Boolean).join(' · ')) + '</span></div>' +
          '<dl class="metric-list">' + row('空气质量', '<span class="px-1.5 py-0.5 rounded ' + aqi.cls + '">' + esc(aqi.label) + '</span>') +
          row('风速', measure(weather.windMs, 'm/s')) +
          (number(weather.elevationMeters) === null ? '' : row('海拔', measure(weather.elevationMeters, 'm'))) +
          row('配速用时修正', '+' + esc(envAdjustment.slowdownPct ?? 0) + '%') + '</dl>'
        : '<div class="weather-summary"><span class="workout-name">气象暂不可用</span>' +
          '<p class="card-caption">计划时段 ' + esc(runWindow) + ' · 暂停气象修正</p></div>';
    }

    function bindWeekMasterDetail() {
      var buttons = document.querySelectorAll('.week-day-tab');
      var panes = document.querySelectorAll('.week-day-pane');
      buttons.forEach(function (button) {
        button.addEventListener('click', function () {
          var idx = button.dataset.weekIdx;
          buttons.forEach(function (item) {
            item.setAttribute('aria-pressed', String(item === button));
          });
          panes.forEach(function (pane) {
            pane.hidden = pane.dataset.weekPane !== idx;
          });
        });
      });
    }

    function openCheckinForDate(date, intent) {
      setActiveView('diary');
      var field = document.getElementById('checkin-date');
      field.value = date;
      field.dispatchEvent(new Event('change'));
      if (intent) document.querySelector('.status-btn[data-status="' + intent + '"]')?.click();
    }

    function bindJumpCheckinButtons(todayDateStr) {
      document.querySelectorAll('[data-jump-checkin]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openCheckinForDate(btn.dataset.jumpCheckin || todayDateStr);
        });
      });
    }

    function renderCharts(payload) {
      var pmc = payload.pmc || { series: [], latest: {} };
      var weeklyZones = payload.weeklyZones || { weekly: [], zonePercentages: [0,0,0,0,0], zoneBoundaries: [], polarization: {} };
      var fitAudit = payload.lastKeyWorkoutAudit || null;
      var coachPlan = payload.coachPlan || {};
      var hasPmc = Boolean(pmc.series?.length);
      var hasRecentVolume = (weeklyZones.weekly || []).some(function (week) { return Number(week.distanceKm) > 0; });
      var zonePercentages = weeklyZones.zonePercentages || [];
      var hasZones = zonePercentages.some(function (percentage) { return percentage > 0; });
      var hasFitSamples = Boolean(fitAudit?.telemetrySamples?.length);
      var latest = pmc.latest || {};
      document.getElementById('load-date').textContent = latest.date || '';
      ['ctl', 'atl', 'tsb', 'acwr'].forEach(function (metric) {
        document.getElementById('load-' + metric).textContent = latest[metric] ?? '—';
      });
      document.getElementById('pmc-range').textContent = hasPmc
        ? pmc.series[0].date.slice(5) + ' 至 ' + pmc.series[pmc.series.length - 1].date.slice(5) : '';
      document.getElementById('pi-badge').textContent = hasZones && weeklyZones.polarization?.polarizationIndex != null
        ? 'PI ' + weeklyZones.polarization.polarizationIndex : '';
      document.getElementById('pmc-empty-hint').classList.toggle('hidden', hasPmc);
      document.getElementById('weekly-empty-hint').classList.toggle('hidden', hasRecentVolume);
      document.getElementById('zone-empty-hint').classList.toggle('hidden', hasZones);
      document.getElementById('fit-empty-hint').classList.toggle('hidden', hasFitSamples);

      var zBounds = Array.isArray(weeklyZones.zoneBoundaries) ? weeklyZones.zoneBoundaries : [];
      var zoneLabelsText = zBounds.length === 4
        ? ['Z1 <' + zBounds[0], 'Z2 ' + zBounds[0] + '–' + zBounds[1], 'Z3 ' + zBounds[1] + '–' + zBounds[2], 'Z4 ' + zBounds[2] + '–' + zBounds[3], 'Z5 >' + zBounds[3]]
        : ['Z1 恢复', 'Z2 有氧', 'Z3 灰区', 'Z4 阈值', 'Z5 无氧'];
      var zStrip = document.getElementById('zone-labels-strip');
      if (zStrip) {
        var colors = ['#64748B', '#0EA5E9', '#10B981', '#F59E0B', '#F43F5E'];
        zStrip.innerHTML = hasZones ? zoneLabelsText.map(function (label, index) {
          return '<span><i style="background:' + colors[index] + '" aria-hidden="true"></i>' +
            esc(label) + ' <strong>' + esc(zonePercentages[index]) + '%</strong></span>';
        }).join('') : '';
      }

      var fitTitle = document.getElementById('fit-title');
      if (fitTitle) {
        fitTitle.textContent = fitAudit?.activity
          ? (fitAudit.activity.date + ' · ' + fitAudit.activity.name + ' (' + fitAudit.activity.distanceKm + ' km)')
          : '暂无重点训练活动';
      }
      var fitMetrics = document.getElementById('fit-metrics');
      if (fitMetrics) {
        var dec = fitAudit?.decoupling;
        var decCls = dec && dec.decouplingPct <= 5 ? 'text-emerald-500' : 'text-amber-500';
        fitMetrics.innerHTML = !fitAudit?.activity ? '' :
          '<span>解耦 <strong class="' + decCls + '">' + (dec ? esc(dec.decouplingPct + '%') : '--') + '</strong></span>' +
          '<span>步频 ' + esc(fitAudit?.activity?.cadence ?? '--') + ' spm</span>' +
          (fitAudit?.avgStrideM ? '<span>步幅 ' + esc(fitAudit.avgStrideM) + 'm</span>' : '') +
          (fitAudit?.activity?.avgPower ? '<span>功率 ' + esc(fitAudit.activity.avgPower) + 'W</span>' : '');
      }
      var fitCrit = document.getElementById('fit-critique');
      if (fitCrit) {
        fitCrit.textContent = coachPlan.fitWorkoutCritique || '';
        fitCrit.hidden = !fitCrit.textContent;
      }

      if (!window.Chart) return;
      chartInstances.forEach(function (chart) { chart.destroy(); });
      chartInstances = [];
      var pal = getChartPalette(currentTheme);
      Chart.defaults.color = pal.text;
      Chart.defaults.borderColor = pal.border;
      Chart.defaults.font.family = 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif';
      Chart.defaults.font.size = 12;
      var tooltipTheme = { backgroundColor: pal.tooltipBg, borderColor: pal.tooltipBorder, borderWidth: 1, padding: 10 };

      var pmcCtx = document.getElementById('pmcChart');
      if (pmcCtx && hasPmc) {
        var g = pmcCtx.getContext('2d').createLinearGradient(0, 0, 0, 220);
        g.addColorStop(0, 'rgba(14, 165, 233, 0.24)');
        g.addColorStop(1, 'rgba(14, 165, 233, 0.0)');
        chartInstances.push(new Chart(pmcCtx, {
          type: 'line',
          plugins: [chartReveals.linePlugin],
          data: {
            labels: pmc.series.map(function (d) { return d.date.slice(5); }),
            datasets: [
              { label: '长期体能 (CTL)', data: pmc.series.map(function (d) { return d.ctl; }), borderColor: '#0EA5E9', backgroundColor: g, fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
              { label: '近期疲劳 (ATL)', data: pmc.series.map(function (d) { return d.atl; }), borderColor: '#F59E0B', tension: 0.35, pointRadius: 0, borderWidth: 2 },
              { label: '状态平衡 (TSB)', data: pmc.series.map(function (d) { return d.tsb; }), borderColor: '#10B981', borderDash: [4, 4], tension: 0.35, pointRadius: 0, borderWidth: 1.5 }
            ]
          },
          options: {
            animation: false,
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { boxWidth: 8, usePointStyle: true }, onClick: chartReveals.toggleSeries }, tooltip: tooltipTheme },
            scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: pal.grid } } }
          }
        }));
      }

      var weeklyCtx = document.getElementById('weeklyChart');
      if (weeklyCtx && hasRecentVolume) {
        chartInstances.push(new Chart(weeklyCtx, {
          type: 'bar',
          data: {
            labels: weeklyZones.weekly.map(function (w) { return w.weekStart.slice(5); }),
            datasets: [{ label: 'km', data: weeklyZones.weekly.map(function (w) { return w.distanceKm; }), backgroundColor: weeklyZones.weekly.map(function (_, index) { return index === weeklyZones.weekly.length - 1 ? '#3760E3' : '#11A99D'; }), borderRadius: 5 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: tooltipTheme },
            scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: pal.grid } } }
          }
        }));
      }

      var zoneCtx = document.getElementById('zoneChart');
      if (zoneCtx && hasZones) {
        var zp = zonePercentages;
        chartInstances.push(new Chart(zoneCtx, {
          type: 'bar',
          data: {
            labels: ['区间'],
            datasets: [
              { label: 'Z1', data: [zp[0]], backgroundColor: '#64748B' },
              { label: 'Z2', data: [zp[1]], backgroundColor: '#0EA5E9' },
              { label: 'Z3', data: [zp[2]], backgroundColor: '#10B981' },
              { label: 'Z4', data: [zp[3]], backgroundColor: '#F59E0B' },
              { label: 'Z5', data: [zp[4]], backgroundColor: '#F43F5E' }
            ]
          },
          options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: tooltipTheme },
            scales: { x: { stacked: true, max: 100, display: false }, y: { stacked: true, display: false } }
          }
        }));
      }

      var fitCtx = document.getElementById('fitChart');
      if (fitCtx && hasFitSamples) {
        chartInstances.push(new Chart(fitCtx, {
          type: 'line',
          plugins: [chartReveals.linePlugin],
          data: {
            labels: fitAudit.telemetrySamples.map(function (s) { return s.km + 'km'; }),
            datasets: [
              { label: '心率', data: fitAudit.telemetrySamples.map(function (s) { return s.hr; }), borderColor: '#F43F5E', yAxisID: 'yHr', tension: 0.3, pointRadius: 0, borderWidth: 2 },
              { label: '配速', data: fitAudit.telemetrySamples.map(function (s) { return s.paceSec; }), borderColor: '#0EA5E9', yAxisID: 'yPace', tension: 0.3, pointRadius: 0, borderWidth: 2 }
            ]
          },
          options: {
            animation: false,
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              tooltip: Object.assign({}, tooltipTheme, {
                callbacks: {
                  label: function (item) {
                    var y = item.parsed.y;
                    return item.dataset.yAxisID === 'yPace'
                      ? '配速 ' + formatPaceAxisClient(y)
                      : '心率 ' + (y == null ? '—' : y + ' bpm');
                  }
                }
              }),
              legend: { labels: { usePointStyle: true }, onClick: chartReveals.toggleSeries }
            },
            scales: {
              x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
              yHr: { type: 'linear', position: 'left', grid: { color: pal.grid } },
              yPace: {
                type: 'linear', position: 'right', reverse: true, grid: { drawOnChartArea: false },
                ticks: { maxTicksLimit: 6, callback: formatPaceAxisClient }
              }
            }
          }
        }));
      }
    }

    function hydrateDashboard(payload) {
      activeDashboard = payload;
      document.documentElement.classList.add('apex-unlocked');
      var gate = document.getElementById('auth-gate');
      var shell = document.getElementById('private-shell');
      if (gate) gate.classList.add('hidden');
      if (shell) shell.classList.remove('hidden');

      var config = payload.config || {};
      var wellness = payload.wellness || {};
      var readiness = payload.readiness || { light: 'insufficient_data', lightLabel: '数据不足', score: null, triggers: [] };
      var pmc = payload.pmc || { series: [], latest: {} };
      var envForecast = payload.envForecast || { location: {}, daily: [] };
      var envToday = payload.envToday || envForecast.today || null;
      var envAdj = payload.envAdjustmentToday || { slowdownPct: 0 };
      var coachPlan = payload.coachPlan || { macroPhase: { stages: [] }, days: [] };
      var planDays = Array.isArray(coachPlan.days) ? coachPlan.days : [];
      var todayDateStr = dashboardLocalDate(config.timezone);
      var firstPlanDay = planDays[0] || null;
      var todayDay = firstPlanDay?.date === todayDateStr ? firstPlanDay : null;

      if (Array.isArray(payload.checkins)) checkinEntries = payload.checkins;
      var checkinMap = new Map(checkinEntries.map(function (c) { return [c.date, c]; }));
      var todayCheckin = checkinMap.get(todayDateStr) || null;
      var todayCheckinMeta = todayCheckin ? (CHECKIN_STATUS_META[todayCheckin.status] || CHECKIN_STATUS_META.completed) : null;
      var envDailyMap = new Map((envForecast.daily || []).map(function (d) { return [d.date, d]; }));

      var daysToRace = computeDaysToRaceClient(config.goal?.raceDate, todayDateStr);
      var targetGoalSec = parseGoalSecondsClient(config.goal?.targetTime);
      var target400Str = targetGoalSec ? (targetGoalSec / 2).toFixed(1) + 's' : '60.5s';
      var target200Str = targetGoalSec ? (targetGoalSec / 4).toFixed(1) + 's' : '30.2s';
      var target600Str = targetGoalSec ? formatSecToClockClient((targetGoalSec * 3) / 4) : '1:30.8';
      var target800Display = targetGoalSec ? formatSecToClockClient(targetGoalSec) : (config.goal?.targetTime || '2:01');

      var cityDisplay = config.location?.cityDisplay || envForecast.location?.city || config.location?.city || '';
      var runWindow = envToday?.runWindow || (String(config.schedule?.preferredRunHour ?? 16).padStart(2, '0') + ':00');
      var ltPaceStr = formatPaceClient(config.physiology?.ltPaceSecPerKm || 285);
      var maxHrVal = wellness.maxHrFromDevice ?? config.physiology?.maxHr ?? 203;
      var lthrVal = wellness.lthrFromDevice ?? config.physiology?.lthr ?? 183;
      var easyHrCap = config.physiology?.easyHrCeiling ?? config.physiologyMeta?.easyHrCeiling?.value ?? Math.round(lthrVal * 0.83);

      // Header metadata
      document.getElementById('header-goal-pill').textContent = '800 m < ' + target800Display;
      var racePill = document.getElementById('header-race-pill');
      racePill.hidden = daysToRace === null;
      racePill.textContent = daysToRace === null ? '' : '距目标赛 ' + daysToRace + ' 天';
      var dashboardDate = document.getElementById('dashboard-date');
      dashboardDate.dateTime = todayDateStr;
      dashboardDate.textContent = [todayDateStr, todayDay?.weekday].filter(Boolean).join(' · ');
      document.getElementById('header-subtitle').textContent = [cityDisplay, payload.generatedAt ? '更新 ' + payload.generatedAt : ''].filter(Boolean).join(' · ');
      document.getElementById('header-stage-display').textContent = coachPlan.macroPhase?.stageDisplay || '';
      document.getElementById('demo-source').hidden = payload.dataSource !== 'demo_simulation';
      document.querySelectorAll('[data-today-checkin-label]').forEach(function (label) {
        label.textContent = todayCheckin?.status === 'planned' ? '继续打卡' : todayCheckin ? '查看打卡' : '今日打卡';
      });
      var workflow = resolveTodayWorkflow({ date: todayDateStr, firstPlanDay: firstPlanDay, checkin: todayCheckin });
      document.getElementById('today-focus').dataset.tone = workflow.tone;
      document.getElementById('today-focus-title').textContent = workflow.title;
      var workflowDetail = document.getElementById('today-focus-detail');
      workflowDetail.hidden = !workflow.detail;
      workflowDetail.textContent = workflow.detail;
      ['primary', 'secondary'].forEach(function (slot) {
        var action = workflow[slot];
        var control = document.getElementById('today-focus-' + slot);
        control.hidden = !action;
        if (action) {
          control.dataset.workflowAction = action.action;
          control.textContent = action.label;
          control.disabled = action.action === 'sync' && document.getElementById('btn-sync-garmin').disabled;
        }
      });
      var readinessDate = readiness.dataQuality?.dataDate || wellness.date || '';
      document.getElementById('readiness-title').textContent =
        readinessDate && readinessDate !== todayDateStr ? '上次训练准备度' : '训练准备度';

      var todayWeather = envToday?.date === todayDateStr ? envToday : null;
      var hasRealWeather = Boolean(todayWeather && !todayWeather.weatherUnavailable && todayWeather.tempC != null);
      var todayPace = workoutPaceClient(todayDay);
      renderOverviewClient(payload, todayDay, todayPace, wellness, readiness, todayWeather, runWindow, envAdj);
      chartReveals.overview();

      // Band 2 Left: Main Workout Sheet
      var twCard = document.getElementById('today-workout-card');
      if (twCard) {
        if (!todayDay) {
          twCard.innerHTML = '<div class="text-sm text-muted">暂无今日课表</div>';
        } else {
          var tStyle = TYPE_STYLE[todayDay.type] || TYPE_STYLE.E;
          var weatherFooter = hasRealWeather
            ? '环境修正 +' + esc(envAdj.slowdownPct ?? 0) + '%'
            : '气象不可用(未做配速折扣)';
          twCard.innerHTML =
            '<div class="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-hairline">' +
              '<div class="space-y-1.5 min-w-0">' +
                '<div class="flex flex-wrap items-center gap-2 text-xs font-mono text-muted">' +
                  '<span>' + esc(todayDay.date) + ' · ' + esc(todayDay.weekday) + '</span>' +
                  '<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold ' + tStyle.pill + '">' + esc(tStyle.label) + '</span>' +
                  (todayCheckinMeta ? '<span class="px-2 py-0.5 rounded-md text-[11px] ' + todayCheckinMeta.cls + '">已打卡 · ' + esc(todayCheckinMeta.label) + '</span>' : '') +
                  (todayDay.reductionMeta?.applied || todayDay.reductionApplied ? '<span class="px-2 py-0.5 rounded-md text-[11px] pill-amber">已同步减量</span>' : '') +
                '</div>' +
                '<h3 class="workout-heading">' + esc(todayDay.title) + '</h3>' +
              '</div>' +
              '<div class="text-right shrink-0">' +
                '<div class="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-heading">' + (todayDay.plannedDistanceKm > 0 ? esc(todayDay.plannedDistanceKm) + ' km' : esc(tStyle.label)) + '</div>' +
                '<div class="text-xs font-mono text-muted">' + esc(todayDay.plannedDurationMin) + ' min · ' + esc(todayDay.estimatedTss) + ' TSS</div>' +
              '</div>' +
            '</div>' +
            renderWorkoutPaceClient(todayPace) +
            '<div class="grid grid-cols-2 sm:grid-cols-3 gap-4 py-1 text-xs">' +
              '<div><div class="card-caption">心率区间</div><div class="mt-0.5 text-sm font-semibold text-heading">' + esc(todayDay.targetHr) + '</div></div>' +
              '<div><div class="card-caption">参考步频</div><div class="mt-0.5 text-sm font-semibold text-heading">' + esc(todayDay.targetCadence || '--') + '</div></div>' +
              '<div><div class="card-caption">主观强度</div><div class="mt-0.5 text-sm font-semibold text-heading">RPE ' + esc(todayDay.rpe || '--') + '</div></div>' +
            '</div>' +
            '<div class="surface-muted rounded-xl p-4 space-y-2.5">' +
              '<div class="card-caption font-semibold">' + (todayPace?.original ? '主课原计划' : '主课安排') + '</div>' +
              '<p class="text-sm font-medium text-heading leading-relaxed">' + esc(todayDay.mainSetSummary) + '</p>' +
              (todayDay.coachTip
                ? '<div class="pt-2 border-t border-hairline text-xs text-body leading-relaxed flex items-start gap-2">' +
                    '<i data-lucide="shield-alert" class="w-4 h-4 text-amber-500 shrink-0 mt-0.5"></i>' +
                    '<span><strong class="text-heading">教练叮嘱：</strong>' + esc(todayDay.coachTip) + '</span>' +
                  '</div>'
                : '') +
            '</div>' +
            '<div>' +
              '<div class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">四段式执行流程</div>' +
              renderWorkflowStepsClient(todayDay, todayPace) +
            '</div>' +
            '<div class="pt-3 border-t border-hairline flex flex-wrap items-center justify-between gap-3 text-xs">' +
              '<span class="text-muted font-mono">慢跑护栏：结合呼吸体感 &le; ' + easyHrCap + ' bpm · ' + weatherFooter + '</span>' +
              '<button type="button" data-jump-checkin="' + esc(todayDateStr) + '" class="primary-button">' +
                '<i data-lucide="clipboard-check" class="w-3.5 h-3.5"></i>' +
                '<span>' + (todayCheckin ? '修改今日打卡 / 日记' : '完成训练去打卡') + '</span>' +
              '</button>' +
            '</div>';
        }
      }

      var sidebarEl = document.getElementById('today-sidebar');
      var stage = coachPlan.macroPhase || {};
      var gateReasons = Array.isArray(coachPlan.upgradeGate?.blockedReasons) ? coachPlan.upgradeGate.blockedReasons : [];
      sidebarEl.innerHTML =
        '<div class="panel-head"><h2>训练决策简报</h2><i data-lucide="sparkles" aria-hidden="true"></i></div>' +
        formatCoachSummaryClient(todayDay ? coachPlan.coachSummary : '', todayDay, todayDay ? readiness : {}) +
        '<div class="panel-subsection stage-focus">' +
          '<h3>阶段重心与 800m 锚点</h3>' +
          (stage.weekFocus ? '<p class="review-copy">' + esc(stage.weekFocus) + '</p>' : '') +
          '<dl class="metric-list">' +
            '<div class="metric-row"><dt>目标每圈配速</dt><dd>' + esc(target400Str) + '</dd></div>' +
            '<div class="metric-row"><dt>200 m 参考</dt><dd>' + esc(target200Str) + '</dd></div>' +
            '<div class="metric-row"><dt>急慢负荷比 ACWR</dt><dd>' + esc(pmc.latest?.acwr ?? '—') + '</dd></div>' +
          '</dl>' +
          (stage.nextDeloadInfo ? '<p class="review-copy"><strong>下次校准</strong> ' + esc(stage.nextDeloadInfo) + '</p>' : '') +
          (gateReasons.length ? '<p class="stage-warning">' + esc(gateReasons.join('；')) + '</p>' : '') +
        '</div>';

      var review = coachPlan.weeklyReview || {};
      var reviewNotes = [review.progressionReason, review.strengthProgressionNote, gateReasons.join('；')].filter(Boolean);
      document.getElementById('weekly-review-banner').hidden = reviewNotes.length === 0;
      document.getElementById('weekly-review-text').innerHTML = reviewNotes.map(function (note) {
        return '<p>' + esc(note) + '</p>';
      }).join('');

      var stages = Array.isArray(stage.stages) ? stage.stages : [];
      document.getElementById('stages-bar').innerHTML = stages.length ? stages.map(function (item) {
        return '<li' + (item.active ? ' aria-current="step"' : '') + '><span class="stage-marker" aria-hidden="true"></span>' +
          '<span>' + esc(item.label) + '</span><small>' + esc(item.weeks) + '</small></li>';
      }).join('') : '<li class="card-caption">暂无阶段安排</li>';

      var weekTotalKm = planDays.reduce(function (sum, day) { return sum + Number(day.plannedDistanceKm || 0); }, 0);
      var weekTotalMin = planDays.reduce(function (sum, day) { return sum + Number(day.plannedDurationMin || 0); }, 0);
      var weekTotalTss = planDays.reduce(function (sum, day) { return sum + Number(day.estimatedTss || 0); }, 0);
      var weekRunCount = planDays.filter(function (day) { return !['REST', 'STR'].includes(day.type); }).length;
      var weekStrCount = planDays.filter(function (day) { return day.type === 'STR'; }).length;
      var weekRestCount = planDays.filter(function (day) { return day.type === 'REST'; }).length;

      document.getElementById('week-range').textContent = planDays.length
        ? planDays[0].date + ' 至 ' + planDays[planDays.length - 1].date : '';
      document.getElementById('week-totals-row').innerHTML = planDays.length
        ? '<div><dt>计划跑量</dt><dd>' + weekTotalKm.toFixed(1) + ' <small>km</small></dd></div>' +
          '<div><dt>计划时长</dt><dd>' + weekTotalMin + ' <small>分钟</small></dd></div>' +
          '<div><dt>训练负荷</dt><dd>' + weekTotalTss + ' <small>TSS</small></dd></div>' +
          '<div><dt>跑步 / 力量 / 休息</dt><dd>' + weekRunCount + ' / ' + weekStrCount + ' / ' + weekRestCount + '</dd></div>'
        : '<div><dt>暂无训练计划</dt><dd>—</dd></div>';

      var selectorGrid = document.getElementById('week-selector-grid');
      var selectedDate = selectorGrid.querySelector('[aria-pressed="true"]')?.dataset.date;
      var selectedIndex = Math.max(0, planDays.findIndex(function (day) { return day.date === selectedDate; }));
      selectorGrid.innerHTML = planDays.length ? planDays.map(function (day, index) {
        var style = TYPE_STYLE[day.type] || TYPE_STYLE.E;
        var logged = checkinMap.has(day.date);
        var dayEnv = envDailyMap.get(day.date);
        var hasDayWeather = Boolean(dayEnv && !dayEnv.weatherUnavailable && dayEnv.tempC != null);
        var dayLabel = [day.date, day.weekday, style.label, logged ? '已打卡' : ''].filter(Boolean).join('，');
        return '<button type="button" data-week-idx="' + index + '" data-date="' + esc(day.date) + '" class="week-day-tab" aria-label="' + esc(dayLabel) + '" aria-controls="week-pane-' + index + '" aria-pressed="' + (index === selectedIndex) + '">' +
          '<span class="week-day-date"><span>' + esc(day.weekday || '') + '</span><time datetime="' + esc(day.date) + '">' +
            '<span class="week-date-desktop">' + esc(day.date.slice(5).replace('-', '/')) + '</span>' +
            '<span class="week-date-mobile">' + esc(day.date.slice(-2)) + '</span></time></span>' +
          '<span class="week-day-kind"><i class="' + style.dot + '" aria-hidden="true"></i><span>' + esc(style.label) + '</span></span>' +
          '<span class="week-day-caption">' + (day.plannedDistanceKm > 0 ? esc(day.plannedDistanceKm) + ' km'
            : day.plannedDurationMin > 0 ? esc(day.plannedDurationMin) + ' 分钟' : esc(day.estimatedTss ?? 0) + ' TSS') +
          (hasDayWeather ? ' · ' + esc(dayEnv.tempC) + '°' : '') +
          (logged ? '<i data-lucide="check" role="img" aria-label="已打卡"></i>' : '') + '</span></button>';
      }).join('') : '<p class="card-caption">暂无可选训练日期</p>';

      var paneHost = document.getElementById('week-pane-host');
      if (paneHost) {
        paneHost.innerHTML = planDays.map(function (day, idx) {
          var style = TYPE_STYLE[day.type] || TYPE_STYLE.E;
          var dayEnv = envDailyMap.get(day.date);
          var hasDayWeather = Boolean(dayEnv && !dayEnv.weatherUnavailable && dayEnv.tempC !== null && dayEnv.tempC !== undefined);
          var dayAqi = hasDayWeather ? getAqiInfoClient(dayEnv.usAqi) : null;
          var pace = workoutPaceClient(day);
          var dayCheckin = checkinMap.get(day.date);
          var dayCheckinMeta = dayCheckin ? (CHECKIN_STATUS_META[dayCheckin.status] || CHECKIN_STATUS_META.completed) : null;
          return '<article id="week-pane-' + idx + '" data-week-pane="' + idx + '" class="week-day-pane workspace-panel space-y-5"' + (idx === selectedIndex ? '' : ' hidden') + '>' +
            '<div class="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-hairline">' +
              '<div class="space-y-1.5 min-w-0">' +
                '<div class="flex flex-wrap items-center gap-2 text-xs font-mono text-muted">' +
                  '<span>' + esc(day.date) + ' · ' + esc(day.weekday) + '</span>' +
                  '<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold ' + style.pill + '">' + esc(style.label) + '</span>' +
                  (dayCheckinMeta ? '<span class="px-2 py-0.5 rounded-md text-[11px] ' + dayCheckinMeta.cls + '">已打卡 · ' + esc(dayCheckinMeta.label) + '</span>' : '') +
                  (hasDayWeather ? '<span class="px-2 py-0.5 rounded-md text-[11px] ' + dayAqi.cls + '">' + esc(dayEnv.tempC) + '°C ' + esc(dayEnv.weatherText || '') + ' · ' + esc(dayAqi.label) + '</span>' : '') +
                '</div>' +
                '<h2 class="workout-heading">' + esc(day.title) + '</h2>' +
              '</div>' +
              '<div class="text-right shrink-0">' +
                '<div class="card-value">' + (day.plannedDistanceKm > 0 ? esc(day.plannedDistanceKm) + ' <small>km</small>' : esc(style.label)) + '</div>' +
                '<div class="text-xs font-mono text-muted">' + esc(day.plannedDurationMin) + ' min · ' + esc(day.estimatedTss) + ' TSS</div>' +
              '</div>' +
            '</div>' +
            renderWorkoutPaceClient(pace) +
            '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">' +
              '<div><div class="card-caption">目标心率</div><div class="mt-0.5 text-sm font-semibold text-heading">' + esc(day.targetHr) + '</div></div>' +
              '<div><div class="card-caption">参考步频</div><div class="mt-0.5 text-sm font-semibold text-heading">' + esc(day.targetCadence || '--') + '</div></div>' +
              '<div><div class="card-caption">主观强度</div><div class="mt-0.5 text-sm font-semibold text-heading">RPE ' + esc(day.rpe || '--') + '</div></div>' +
            '</div>' +
            '<div class="surface-muted rounded-xl px-4 py-3 text-[13px] text-body leading-relaxed">' +
              '<p class="card-caption font-semibold mb-1">' + (pace?.original ? '主课原计划' : '主课安排') + '</p>' +
              esc(day.mainSetSummary) + '</div>' +
            (day.coachTip
              ? '<div class="rounded-xl px-4 py-2.5 border border-amber-500/25 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200 leading-relaxed flex items-start gap-2">' +
                  '<i data-lucide="shield-alert" class="w-4 h-4 text-amber-500 shrink-0 mt-0.5"></i>' +
                  '<div><strong class="font-semibold">执行要点：</strong>' + esc(day.coachTip) + '</div>' +
                '</div>'
              : '') +
            renderWorkflowStepsClient(day, pace) +
            '<div class="pt-3 border-t border-hairline flex items-center justify-between gap-3 text-xs">' +
              '<span class="text-muted font-mono">第 ' + (idx + 1) + ' / ' + planDays.length + ' 天</span>' +
              '<button type="button" data-jump-checkin="' + esc(day.date) + '" class="control-button">' +
                '<i data-lucide="clipboard-check" class="w-3.5 h-3.5"></i>' +
                '<span>' + (dayCheckin ? '查看打卡' : '填写打卡') + '</span>' +
              '</button>' +
            '</div>' +
          '</article>';
        }).join('') || '<p class="workspace-panel card-caption">暂无训练详情</p>';
      }

      bindWeekMasterDetail();
      bindJumpCheckinButtons(todayDateStr);

      // VIEW 3: 800m Split Track + Charts
      var splitPanel = document.getElementById('split-track-panel');
      if (splitPanel) {
        splitPanel.innerHTML =
          '<div class="panel-head">' +
            '<h2>800m 竞赛分段</h2>' +
            '<span class="card-caption">目标 ' + esc(target800Display) + '</span>' +
          '</div>' +
          '<div class="relative pt-2 pb-1">' +
            '<div class="absolute top-4 left-4 right-4 h-0.5 bg-gradient-to-r from-sky-500 via-emerald-500 to-rose-500 opacity-50"></div>' +
            '<div class="relative grid grid-cols-4 gap-1 text-center font-mono">' +
              '<div><span class="mx-auto w-3 h-3 rounded-full bg-sky-500 ring-4 ring-sky-500/15 block"></span><div class="mt-2 text-[10px] text-muted">200m</div><div class="text-xs font-bold text-heading">' + esc(target200Str) + '</div></div>' +
              '<div><span class="mx-auto w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15 block"></span><div class="mt-2 text-[10px] text-muted">400m</div><div class="text-xs font-bold text-heading">' + esc(target400Str) + '</div></div>' +
              '<div><span class="mx-auto w-3 h-3 rounded-full bg-amber-500 ring-4 ring-amber-500/15 block"></span><div class="mt-2 text-[10px] text-muted">600m</div><div class="text-xs font-bold text-heading">' + esc(target600Str) + '</div></div>' +
              '<div><span class="mx-auto w-3 h-3 rounded-full bg-rose-500 ring-4 ring-rose-500/15 block"></span><div class="mt-2 text-[10px] text-muted">800m</div><div class="text-xs font-bold text-rose-500">' + esc(target800Display) + '</div></div>' +
            '</div>' +
          '</div>' +
          '<div class="text-[11px] font-mono text-muted flex flex-wrap justify-between gap-2 pt-1 border-t border-hairline">' +
            '<span>暂定 LT ' + esc(ltPaceStr) + '</span>' +
            '<span>LTHR ' + esc(lthrVal) + '</span>' +
            '<span>MaxHR ' + esc(maxHrVal) + '</span>' +
            '<span class="text-sky-500">E &le;' + esc(easyHrCap) + '</span>' +
          '</div>';
      }

      renderCharts(payload);

      // VIEW 4 sync
      if (window.__syncDiaryAfterHydrate) window.__syncDiaryAfterHydrate(todayDateStr);
      if (window.lucide) lucide.createIcons();
    }

    (function initCheckinWidget() {
      var STATUS_LABELS = { completed: '按计划完成', modified: '减量微调', rest: '请假休息', planned: '晨间体感' };
      var state = { status: 'completed', areas: ['无不适'], sleepQuality: null };
      var dateEl = document.getElementById('checkin-date');
      var rpeEl = document.getElementById('checkin-rpe');
      var rpeLabelEl = document.getElementById('rpe-label');
      var painEl = document.getElementById('checkin-pain');
      var painLabelEl = document.getElementById('pain-label');
      var injuryStatusEl = document.getElementById('injury-status-select');
      var injuryImpactEl = document.getElementById('injury-impact-select');
      var fbDistEl = document.getElementById('fb-dist');
      var fbDurEl = document.getElementById('fb-dur');
      var fbDropEl = document.getElementById('fb-dropoff');
      var fbSplitsEl = document.getElementById('fb-splits');
      var fbFormEl = document.getElementById('fb-form');
      var fbReactEl = document.getElementById('fb-reaction');
      var fbStrExEl = document.getElementById('fb-str-ex');
      var fbStrKgEl = document.getElementById('fb-str-kg');
      var fbStrSetsEl = document.getElementById('fb-str-sets');
      var fbStrRirEl = document.getElementById('fb-str-rir');
      var fbTestPurposeEl = document.getElementById('fb-test-purpose');
      var fbDetailsEl = document.getElementById('post-feedback-details');
      var diaryEl = document.getElementById('checkin-diary');
      var feedbackEl = document.getElementById('checkin-feedback');
      var saveDate = document.getElementById('diary-save-date');
      var timelineEl = document.getElementById('diary-timeline');
      var countEl = document.getElementById('diary-count');
      var contextEl = document.getElementById('checkin-planned-context');
      var editBannerEl = document.getElementById('editing-mode-banner');
      var editBannerTextEl = document.getElementById('editing-mode-text');
      var backTodayBtn = document.getElementById('btn-back-today');
      var deleteActiveBtn = document.getElementById('btn-delete-active');
      var painHintEl = document.getElementById('itbs-pain-hint');
      var submitBtn = document.getElementById('btn-submit-checkin');
      var recalcBtn = document.getElementById('btn-recalculate-plan');
      var recalcIconEl = document.getElementById('recalc-icon');
      var recalcLabelEl = document.getElementById('recalc-label');
      var checkinSectionEl = document.getElementById('checkin-section');
      var pendingDeleteDate = null;
      var pendingDeleteTimer = null;

      function getActiveTodayDate() {
        return dashboardLocalDate(activeDashboard?.config?.timezone);
      }

      function showMsg(msg, ok) {
        if (feedbackEl) {
          feedbackEl.className = 'diary-save-status ' + (ok ? 'pill-emerald' : 'pill-rose');
          feedbackEl.textContent = msg;
          feedbackEl.classList.remove('hidden');
        }
        if (!window.matchMedia('(max-width: 639px)').matches) showToast(msg, ok ? 'ok' : 'error');
      }

      function updatePlannedContext(dateStr) {
        if (!contextEl) return;
        var days = activeDashboard?.coachPlan?.days || [];
        var match = days.find(function (d) { return d.date === dateStr; });
        if (!match) {
          contextEl.innerHTML = '<span class="text-muted">当日计划：自由记录（非本周期 7 日窗口）</span>';
          return;
        }
        var dist = match.plannedDistanceKm > 0 ? (match.plannedDistanceKm + ' km') : match.type;
        contextEl.innerHTML = '<span class="truncate"><strong class="text-heading">当日计划：</strong>' + esc(match.title) + '</span><span class="font-mono text-muted shrink-0">' + esc(dist) + '</span>';
      }

      function updatePainHint() {
        if (!painHintEl) return;
        var p = painEl ? Number(painEl.value) : 0;
        var hasArea = state.areas.some(function (a) { return a && a !== '无不适'; });
        painHintEl.classList.toggle('hidden', !((hasArea && p >= 2) || p >= 4));
      }

      function paintStatus() {
        document.querySelectorAll('.status-btn').forEach(function (btn) {
          var active = btn.getAttribute('data-status') === state.status;
          btn.setAttribute('aria-pressed', String(active));
          btn.className = active
            ? 'status-btn px-3 py-2 rounded-xl border text-xs font-semibold active:scale-95 transition cursor-pointer pill-emerald'
            : 'status-btn px-3 py-2 rounded-xl border text-xs font-medium active:scale-95 transition cursor-pointer surface-muted border-hairline text-body';
        });
      }

      function paintAreas() {
        document.querySelectorAll('.area-chip').forEach(function (chip) {
          var active = state.areas.indexOf(chip.getAttribute('data-area')) !== -1;
          chip.setAttribute('aria-pressed', String(active));
          chip.className = active
            ? 'area-chip px-2.5 py-1 rounded-lg border text-xs active:scale-95 transition cursor-pointer pill-emerald font-medium'
            : 'area-chip px-2.5 py-1 rounded-lg border text-xs active:scale-95 transition cursor-pointer surface-muted border-hairline text-body';
        });
        updatePainHint();
      }

      function paintSleepQuality() {
        document.querySelectorAll('.sq-chip').forEach(function (chip) {
          var active = state.sleepQuality === Number(chip.getAttribute('data-sq'));
          chip.setAttribute('aria-pressed', String(active));
          chip.className = active
            ? 'sq-chip px-2.5 py-1 rounded-lg border text-xs active:scale-95 transition cursor-pointer pill-sky font-semibold'
            : 'sq-chip px-2.5 py-1 rounded-lg border border-hairline text-body active:scale-95 cursor-pointer transition';
        });
      }

      function updateSliders() {
        if (rpeLabelEl && rpeEl) {
          var r = Number(rpeEl.value);
          rpeLabelEl.textContent = r + ' / 10';
          rpeLabelEl.className = 'font-mono font-semibold tabular-nums ' + (r >= 8 ? 'text-rose-500' : r >= 6 ? 'text-amber-500' : 'text-emerald-500');
        }
        if (painLabelEl && painEl) {
          var p = Number(painEl.value);
          painLabelEl.textContent = p + ' / 10';
          painLabelEl.className = 'font-mono font-semibold tabular-nums ' + (p >= 4 ? 'text-rose-500' : p >= 2 ? 'text-amber-500' : 'text-muted');
        }
        updatePainHint();
      }

      function updateEditingBanner(dateStr, found) {
        if (submitBtn) submitBtn.textContent = found ? ('保存修改 (' + String(dateStr).slice(5) + ')') : '保存打卡';
        if (!editBannerEl || !editBannerTextEl) return;
        if (found) {
          var stLabel = STATUS_LABELS[found.status] || found.status;
          editBannerTextEl.textContent = '正在编辑 ' + dateStr + ' 记录（' + stLabel + ' · RPE ' + (found.rpe == null ? '--' : found.rpe) + '）';
          editBannerEl.classList.remove('hidden');
          if (backTodayBtn) backTodayBtn.classList.toggle('hidden', dateStr === getActiveTodayDate());
          if (deleteActiveBtn) deleteActiveBtn.textContent = pendingDeleteDate === dateStr ? '确认删除?' : '删除此记录';
        } else {
          editBannerEl.classList.add('hidden');
        }
      }

      function loadEntryIntoForm(dateStr, opts) {
        var today = getActiveTodayDate();
        var targetDate = dateStr || today;
        if (dateEl) dateEl.value = targetDate;
        saveDate.dateTime = targetDate;
        saveDate.textContent = targetDate === today ? '今日记录' : targetDate.slice(5) + ' 记录';
        if (feedbackEl) feedbackEl.classList.add('hidden');
        updatePlannedContext(targetDate);
        var found = checkinEntries.find(function (e) { return e.date === targetDate; });
        if (found) {
          state.status = found.status || 'completed';
          if (rpeEl) rpeEl.value = String(found.rpe != null ? found.rpe : 5);
          if (painEl) painEl.value = String(found.painLevel != null ? found.painLevel : 0);
          state.areas = Array.isArray(found.painAreas) && found.painAreas.length ? found.painAreas.slice() : ['无不适'];
          state.sleepQuality = found.sleepQuality != null ? Number(found.sleepQuality) : null;
          if (injuryStatusEl) injuryStatusEl.value = found.injuryStatus || 'none';
          if (injuryImpactEl) injuryImpactEl.value = found.injuryActionImpact || 'none';
          if (fbDistEl) fbDistEl.value = found.actualDistanceKm != null ? String(found.actualDistanceKm) : '';
          if (fbDurEl) fbDurEl.value = found.actualDurationMin != null ? String(found.actualDurationMin) : '';
          if (fbDropEl) fbDropEl.value = found.paceDropoffPct != null ? String(found.paceDropoffPct) : '';
          if (fbSplitsEl) fbSplitsEl.value = found.keySplitsSummary || '';
          if (fbFormEl) fbFormEl.value = found.formStatus || '';
          if (fbReactEl) fbReactEl.value = found.nextDayReaction || '';
          if (fbStrExEl) fbStrExEl.value = found.strengthExercise || '';
          if (fbStrKgEl) fbStrKgEl.value = found.strengthLoadKg != null ? String(found.strengthLoadKg) : '';
          if (fbStrSetsEl) fbStrSetsEl.value = found.strengthSetsReps || '';
          if (fbStrRirEl) fbStrRirEl.value = found.strengthRir != null ? String(found.strengthRir) : '';
          if (fbTestPurposeEl) fbTestPurposeEl.value = found.testPurpose || 'none';
          if (diaryEl) diaryEl.value = found.diary || '';
          if (fbDetailsEl && (found.actualDistanceKm != null || found.keySplitsSummary || found.strengthExercise || (found.testPurpose && found.testPurpose !== 'none'))) {
            fbDetailsEl.open = true;
          }
        } else {
          state.status = 'completed';
          if (rpeEl) rpeEl.value = '5';
          if (painEl) painEl.value = '0';
          state.areas = ['无不适'];
          state.sleepQuality = null;
          if (injuryStatusEl) injuryStatusEl.value = 'none';
          if (injuryImpactEl) injuryImpactEl.value = 'none';
          [fbDistEl, fbDurEl, fbDropEl, fbSplitsEl, fbFormEl, fbReactEl, fbStrExEl, fbStrKgEl, fbStrSetsEl, fbStrRirEl, diaryEl].forEach(function (el) {
            if (el) el.value = '';
          });
          if (fbTestPurposeEl) fbTestPurposeEl.value = 'none';
        }
        updateSliders();
        paintStatus();
        paintAreas();
        paintSleepQuality();
        updateEditingBanner(targetDate, found);
        renderTimeline();

        if (opts && opts.fromTimeline) {
          if (checkinSectionEl && checkinSectionEl.scrollIntoView) checkinSectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (diaryEl) diaryEl.focus();
          showMsg('已载入 ' + targetDate + ' 记录，可直接修改后保存', true);
        }
      }

      async function deleteEntryByDate(dateStr) {
        pendingDeleteDate = null;
        if (pendingDeleteTimer) { clearTimeout(pendingDeleteTimer); pendingDeleteTimer = null; }
        setGlobalLoading(true);
        try {
          var res = await fetch('/api/checkins?date=' + encodeURIComponent(dateStr), {
            method: 'DELETE',
            headers: authHeaders()
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
          checkinEntries = data.checkins || checkinEntries.filter(function (e) { return e.date !== dateStr; });
          if (data.dashboard) hydrateDashboard(data.dashboard);
          else loadEntryIntoForm(dateEl ? dateEl.value : getActiveTodayDate());
          showMsg('已删除 ' + dateStr + ' 记录并完成课表重算', true);
        } catch (err) {
          showMsg('删除失败：' + (err.message || '请求错误'), false);
          renderTimeline();
        } finally {
          setGlobalLoading(false);
        }
      }

      function renderTimeline() {
        if (!timelineEl) return;
        if (countEl) countEl.textContent = checkinEntries.length + ' 条';
        if (!checkinEntries.length) {
          timelineEl.innerHTML = '<div class="surface-muted rounded-xl p-4 text-xs text-muted">暂无打卡记录</div>';
          return;
        }
        var activeDate = dateEl ? dateEl.value : getActiveTodayDate();
        timelineEl.innerHTML = checkinEntries.slice(0, 20).map(function (item) {
          var stMeta = CHECKIN_STATUS_META[item.status] || CHECKIN_STATUS_META.completed;
          var painTxt = item.painLevel > 0 ? ('痛感 ' + item.painLevel + '/10 · ' + (item.painAreas || []).join('、')) : '无痛感';
          var sqTxt = item.sleepQuality != null ? (' · 睡眠体感 ' + item.sleepQuality + '/5') : '';
          var injTxt = item.injuryStatus && item.injuryStatus !== 'none' ? (' · 伤病:' + item.injuryStatus) : '';
          var fbBits = [];
          if (item.actualDistanceKm != null) fbBits.push('实跑 ' + item.actualDistanceKm + 'km');
          if (item.paceDropoffPct != null) fbBits.push('掉速 ' + item.paceDropoffPct + '%');
          if (item.formStatus === 'stable') fbBits.push('动作稳定');
          else if (item.formStatus === 'degraded') fbBits.push('动作变形');
          if (item.keySplitsSummary) fbBits.push(item.keySplitsSummary);
          if (item.strengthExercise || item.strengthLoadKg != null || item.strengthRir != null) {
            fbBits.push(
              '力量 ' + (item.strengthExercise || '主动作') +
              (item.strengthLoadKg != null ? (' ' + item.strengthLoadKg + 'kg') : '') +
              (item.strengthSetsReps ? (' ' + item.strengthSetsReps) : '') +
              (item.strengthRir != null ? (' RIR ' + item.strengthRir) : '')
            );
          }
          if (item.testPurpose === 'recovery_observation') fbBits.push('观察测试(亚极量)');
          else if (item.testPurpose === 'capacity_calibration') fbBits.push('能力标定测试');

          var isEditing = item.date === activeDate;
          var isConfirmDel = pendingDeleteDate === item.date;
          return '<div class="diary-log space-y-2' + (isEditing ? ' diary-log-active' : '') + '">' +
            '<div class="flex flex-wrap items-start justify-between gap-2 text-xs">' +
              '<div class="flex items-center gap-1.5 flex-wrap">' +
                '<span class="font-mono font-semibold text-heading">' + esc(item.date) + '</span>' +
                '<span class="px-2 py-0.5 rounded-md text-[11px] ' + stMeta.cls + '">' + esc(stMeta.label) + '</span>' +
                '<span class="font-mono text-muted">RPE ' + esc(item.rpe == null ? '--' : item.rpe) + '</span>' +
                (isEditing ? '<span class="px-1.5 py-0.5 rounded text-[10px] pill-sky font-medium">编辑中</span>' : '') +
              '</div>' +
              '<div class="flex items-center gap-2 shrink-0">' +
                '<button type="button" data-edit-date="' + esc(item.date) + '" class="edit-diary-btn card-link">编辑</button>' +
                '<button type="button" data-delete-date="' + esc(item.date) + '" class="delete-diary-btn text-[11px] ' + (isConfirmDel ? 'font-semibold text-rose-500 underline' : 'text-muted hover:text-rose-500') + ' cursor-pointer">' + (isConfirmDel ? '确认删除?' : '删除') + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="text-[11px] font-mono ' + (item.painLevel >= 2 ? 'text-rose-500' : 'text-muted') + '">' + esc(painTxt + sqTxt + injTxt) + '</div>' +
            (fbBits.length ? '<div class="text-[11px] font-mono text-sky-500">' + esc(fbBits.join(' | ')) + '</div>' : '') +
            (item.diary ? '<p class="text-xs text-body leading-relaxed whitespace-pre-wrap">' + esc(item.diary) + '</p>' : '') +
          '</div>';
        }).join('');

        timelineEl.querySelectorAll('.edit-diary-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            pendingDeleteDate = null;
            loadEntryIntoForm(btn.getAttribute('data-edit-date'), { fromTimeline: true });
          });
        });
        timelineEl.querySelectorAll('.delete-diary-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var dt = btn.getAttribute('data-delete-date');
            if (!dt) return;
            if (pendingDeleteDate === dt) { deleteEntryByDate(dt); return; }
            pendingDeleteDate = dt;
            if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
            pendingDeleteTimer = setTimeout(function () {
              pendingDeleteDate = null;
              renderTimeline();
              var curDate = dateEl ? dateEl.value : getActiveTodayDate();
              updateEditingBanner(curDate, checkinEntries.find(function (e) { return e.date === curDate; }));
            }, 3500);
            renderTimeline();
            var curDate = dateEl ? dateEl.value : getActiveTodayDate();
            updateEditingBanner(curDate, checkinEntries.find(function (e) { return e.date === curDate; }));
          });
        });
      }

      window.__syncDiaryAfterHydrate = function (todayDateStr) {
        if (dateEl && !dateEl.value) {
          loadEntryIntoForm(todayDateStr);
          return;
        }
        var target = dateEl?.value || todayDateStr;
        updatePlannedContext(target);
        updateEditingBanner(target, checkinEntries.find(function (e) { return e.date === target; }));
        renderTimeline();
      };

      document.querySelectorAll('.status-btn').forEach(function (b) {
        b.addEventListener('click', function () { state.status = b.getAttribute('data-status') || 'completed'; paintStatus(); });
      });
      document.querySelectorAll('.area-chip').forEach(function (c) {
        c.addEventListener('click', function () {
          var area = c.getAttribute('data-area');
          if (!area) return;
          if (area === '无不适') state.areas = ['无不适'];
          else {
            state.areas = state.areas.filter(function (a) { return a !== '无不适'; });
            var idx = state.areas.indexOf(area);
            if (idx === -1) state.areas.push(area); else state.areas.splice(idx, 1);
            if (!state.areas.length) state.areas = ['无不适'];
          }
          paintAreas();
        });
      });
      document.querySelectorAll('.sq-chip').forEach(function (c) {
        c.addEventListener('click', function () {
          var v = Number(c.getAttribute('data-sq'));
          state.sleepQuality = state.sleepQuality === v ? null : v;
          paintSleepQuality();
        });
      });
      if (rpeEl) rpeEl.addEventListener('input', updateSliders);
      if (painEl) painEl.addEventListener('input', updateSliders);
      if (dateEl) dateEl.addEventListener('change', function () { pendingDeleteDate = null; loadEntryIntoForm(dateEl.value); });
      if (backTodayBtn) backTodayBtn.addEventListener('click', function () { pendingDeleteDate = null; loadEntryIntoForm(getActiveTodayDate()); });
      if (deleteActiveBtn) {
        deleteActiveBtn.addEventListener('click', function () {
          var dt = dateEl ? dateEl.value : getActiveTodayDate();
          if (!dt) return;
          if (pendingDeleteDate === dt) { deleteEntryByDate(dt); return; }
          pendingDeleteDate = dt;
          if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
          pendingDeleteTimer = setTimeout(function () {
            pendingDeleteDate = null;
            updateEditingBanner(dt, checkinEntries.find(function (e) { return e.date === dt; }));
            renderTimeline();
          }, 3500);
          updateEditingBanner(dt, checkinEntries.find(function (e) { return e.date === dt; }));
          renderTimeline();
        });
      }

      if (submitBtn) {
        submitBtn.addEventListener('click', async function () {
          var targetDate = dateEl ? dateEl.value : getActiveTodayDate();
          submitBtn.disabled = true;
          submitBtn.textContent = '保存中…';
          if (feedbackEl) feedbackEl.classList.add('hidden');
          setGlobalLoading(true);
          try {
            var res = await fetch('/api/checkins', {
              method: 'POST',
              headers: authHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                date: targetDate,
                status: state.status,
                rpe: rpeEl ? Number(rpeEl.value) : 5,
                painLevel: painEl ? Number(painEl.value) : 0,
                painAreas: state.areas,
                sleepQuality: state.sleepQuality,
                injuryStatus: injuryStatusEl ? injuryStatusEl.value : 'none',
                injuryActionImpact: injuryImpactEl ? injuryImpactEl.value : 'none',
                actualDistanceKm: fbDistEl && fbDistEl.value ? Number(fbDistEl.value) : null,
                actualDurationMin: fbDurEl && fbDurEl.value ? Number(fbDurEl.value) : null,
                paceDropoffPct: fbDropEl && fbDropEl.value ? Number(fbDropEl.value) : null,
                keySplitsSummary: fbSplitsEl ? fbSplitsEl.value : '',
                formStatus: fbFormEl ? fbFormEl.value : '',
                nextDayReaction: fbReactEl ? fbReactEl.value : '',
                strengthExercise: fbStrExEl ? fbStrExEl.value : '',
                strengthLoadKg: fbStrKgEl && fbStrKgEl.value ? Number(fbStrKgEl.value) : null,
                strengthSetsReps: fbStrSetsEl ? fbStrSetsEl.value : '',
                strengthRir: fbStrRirEl && fbStrRirEl.value ? Number(fbStrRirEl.value) : null,
                testPurpose: fbTestPurposeEl ? fbTestPurposeEl.value : 'none',
                diary: diaryEl ? diaryEl.value : ''
              })
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
            checkinEntries = data.checkins || checkinEntries;
            if (data.dashboard) hydrateDashboard(data.dashboard);
            loadEntryIntoForm(targetDate);
            showMsg('已保存 ' + targetDate.slice(5) + ' · 课表已更新', true);
          } catch (err) {
            showMsg('保存失败：' + (err.message || '请确认已解锁会话'), false);
          } finally {
            submitBtn.disabled = false;
            setGlobalLoading(false);
            updateEditingBanner(targetDate, checkinEntries.find(function (e) { return e.date === targetDate; }));
          }
        });
      }

      if (recalcBtn) {
        recalcBtn.addEventListener('click', async function () {
          recalcBtn.disabled = true;
          setGlobalLoading(true);
          if (recalcLabelEl) recalcLabelEl.textContent = '重算中...';
          if (recalcIconEl) recalcIconEl.classList.add('animate-spin');
          try {
            var res = await fetch('/api/recalculate', { method: 'POST', headers: authHeaders() });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
            if (data.dashboard) hydrateDashboard(data.dashboard);
            showMsg('已按最新打卡与科学门控重新生成 7 日课表', true);
          } catch (err) {
            showMsg('重算失败：' + (err.message || '请先解锁会话'), false);
          } finally {
            recalcBtn.disabled = false;
            setGlobalLoading(false);
            if (recalcLabelEl) recalcLabelEl.textContent = '重算课表';
            if (recalcIconEl) recalcIconEl.classList.remove('animate-spin');
          }
        });
      }

      updateSliders();
      paintStatus();
      paintAreas();
      paintSleepQuality();
    })();

    (async function initAuthAndBootstrap() {
      var gateForm = document.getElementById('auth-unlock-form');
      var gateInput = document.getElementById('gate-token-input');
      var gateError = document.getElementById('gate-error');
      var syncBtn = document.getElementById('btn-sync-garmin');
      var syncIconEl = document.getElementById('sync-icon');
      var syncLabelEl = document.getElementById('sync-label');
      var logoutBtn = document.getElementById('btn-lock-logout');

      document.querySelectorAll('[data-today-checkin]').forEach(function (button) {
        button.addEventListener('click', function () {
          openCheckinForDate(document.getElementById('dashboard-date').dateTime);
        });
      });
      var workflowPrimary = document.getElementById('today-focus-primary');
      document.querySelectorAll('[data-workflow-action]').forEach(function (button) {
        button.addEventListener('click', function () {
          var action = button.dataset.workflowAction;
          if (action === 'sync') {
            syncBtn.click();
            return;
          }
          var intent = ['planned', 'completed', 'rest'].includes(action) ? action : '';
          openCheckinForDate(document.getElementById('dashboard-date').dateTime, intent);
        });
      });

      if (syncBtn) {
        syncBtn.addEventListener('click', async function () {
          syncBtn.disabled = true;
          if (workflowPrimary.dataset.workflowAction === 'sync') {
            workflowPrimary.disabled = true;
            workflowPrimary.textContent = '同步中…';
          }
          setGlobalLoading(true);
          if (syncLabelEl) syncLabelEl.textContent = '同步中...';
          if (syncIconEl) syncIconEl.classList.add('animate-spin');
          try {
            var res = await fetch('/api/refresh', { method: 'POST', headers: authHeaders() });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
            if (data.dashboard) hydrateDashboard(data.dashboard);
            showToast('Garmin 与气象数据同步完成', 'ok');
          } catch (err) {
            showToast('同步失败：' + (err.message || '未授权'), 'error');
          } finally {
            syncBtn.disabled = false;
            if (workflowPrimary.dataset.workflowAction === 'sync') {
              workflowPrimary.disabled = false;
              workflowPrimary.textContent = '同步 Garmin';
            }
            setGlobalLoading(false);
            if (syncLabelEl) syncLabelEl.textContent = '同步';
            if (syncIconEl) syncIconEl.classList.remove('animate-spin');
          }
        });
      }

      if (logoutBtn) {
        logoutBtn.addEventListener('click', async function () {
          setSavedToken('');
          document.documentElement.classList.remove('apex-unlocked');
          await fetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
          window.location.reload();
        });
      }

      async function tryFetchPrivate() {
        var dashRes = await fetch('/api/private/dashboard', { headers: authHeaders() });
        if (!dashRes.ok) return false;
        var dashJson = await dashRes.json().catch(function () { return null; });
        if (!dashJson || !dashJson.dashboard) return false;
        var chkRes = await fetch('/api/checkins', { headers: authHeaders() });
        if (chkRes.ok) {
          var chkJson = await chkRes.json().catch(function () { return {}; });
          if (Array.isArray(chkJson.checkins)) dashJson.dashboard.checkins = chkJson.checkins;
        }
        hydrateDashboard(dashJson.dashboard);
        return true;
      }

      if (BOOTSTRAP.privatePayload) {
        hydrateDashboard(BOOTSTRAP.privatePayload);
        return;
      }

      var ok = await tryFetchPrivate().catch(function () { return false; });
      if (!ok && gateForm) {
        gateForm.addEventListener('submit', async function (e) {
          e.preventDefault();
          var tok = gateInput ? gateInput.value.trim() : '';
          if (!tok) return;
          if (gateError) gateError.classList.add('hidden');
          setGlobalLoading(true);
          try {
            var loginRes = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: tok })
            });
            var loginData = await loginRes.json().catch(function () { return {}; });
            if (!loginRes.ok) throw new Error(loginData.error || ('HTTP ' + loginRes.status));
            // Cookie HttpOnly session 已由服务端签发；无需在前端长期滞留明文口令
            setSavedToken('');
            var unlocked = await tryFetchPrivate();
            if (!unlocked) throw new Error('解锁后拉取私人数据失败');
            if (gateInput) gateInput.value = '';
            showToast('私人训练工作台已解锁', 'ok');
          } catch (err) {
            setSavedToken('');
            if (gateError) {
              gateError.textContent = err.message || '口令验证失败';
              gateError.classList.remove('hidden');
            }
          } finally {
            setGlobalLoading(false);
          }
        });
      }
    })();
  </script>
</body>
</html>`;
}
