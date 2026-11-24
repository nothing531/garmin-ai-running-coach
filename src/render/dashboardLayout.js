export const dashboardLayoutCss = `
  html {
    --dock-inset: max(6px, env(safe-area-inset-bottom, 0px));
    --dock-height: calc(55px + var(--dock-inset));
    scroll-padding-top: 20px;
  }
  body { margin: 0; min-width: 0; }
  button, input, select, textarea { accent-color: var(--accent); }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
  ::selection { background: var(--accent-soft); color: var(--text-heading); }
  .app-sidebar { display: none; }
  .app-main { min-width: 0; }
  .app-header {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    min-height: 66px; padding: 12px 24px;
    background: var(--bg-surface); border-bottom: 1px solid var(--border-hairline);
  }
  .header-brand, .sidebar-brand { display: flex; align-items: center; gap: 10px; }
  .brand-mark {
    display: grid; place-items: center; flex: 0 0 36px; width: 36px; height: 36px;
    border-radius: 10px; color: var(--on-accent); background: var(--accent);
  }
  .brand-mark svg { width: 24px; height: 24px; }
  .brand-name { color: var(--text-heading); font-size: 15px; font-weight: 740; letter-spacing: -.025em; }
  .header-context { display: none; font-size: 13px; color: var(--text-muted); }
  .header-context strong { color: var(--text-heading); font-weight: 650; }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  .header-actions svg, .sidebar-nav svg, .mobile-dock svg { width: 17px; height: 17px; flex-shrink: 0; }
  .control-button, .primary-button {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    min-height: 38px; padding: 7px 11px; border: 1px solid var(--border-hairline);
    border-radius: 9px; background: var(--bg-surface); color: var(--text-heading);
    font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer;
    transition: background-color .15s, border-color .15s;
  }
  .control-button:hover { background: var(--bg-muted); border-color: var(--border-strong); }
  .primary-button { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .primary-button:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .control-button:not(:disabled):active, .primary-button:not(:disabled):active { transform: translateY(1px); }
  .control-button:disabled, .primary-button:disabled { cursor: wait; opacity: .65; }
  .icon-button { width: 38px; padding: 0; }
  .dashboard-content { width: 100%; max-width: 1440px; margin-inline: auto; padding: 24px; }
  .page-heading { margin-bottom: 18px; }
  .page-heading-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .page-heading h1 {
    margin: 0; color: var(--text-heading); font-size: 34px;
    font-weight: 760; line-height: 1.18; letter-spacing: -.03em;
  }
  .page-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px 12px; margin-top: 8px; font-size: 13px; color: var(--text-muted); }
  .page-meta time { color: var(--text-body); font-weight: 610; }
  html[data-active-view="today"] #btn-open-checkin { display: none; }

  .today-focus {
    display: flex; align-items: center; justify-content: space-between; gap: 12px 22px;
    margin-bottom: 16px; padding: 16px 19px; border-radius: 15px;
    background: #15382B; color: #F3F9F0;
  }
  .today-focus-main, .today-focus-actions { display: flex; align-items: center; min-width: 0; gap: 10px; }
  .today-focus-main h2 { font-size: 20px; font-weight: 730; line-height: 1.3; letter-spacing: -.024em; }
  .today-focus-main p { margin-top: 4px; color: #C6D8CD; font-size: 13px; line-height: 1.5; }
  .today-focus-icon {
    display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 36px;
    border: 1px solid #557465; border-radius: 9px; color: #DCF1C5;
  }
  .today-focus-icon svg { width: 17px; height: 17px; }
  .today-focus[data-tone="waiting"] .today-focus-icon { color: #F4D696; }
  .today-focus[data-tone="recovery"] .today-focus-icon { color: #DDD3FC; }
  .today-focus-actions { flex-shrink: 0; gap: 8px; }
  .today-focus-actions .primary-button {
    color: #172A20; background: #D6EE9B; border-color: #D6EE9B;
  }
  .today-focus-actions .primary-button:hover { background: #E6F7BB; border-color: #E6F7BB; }
  .today-focus-actions .control-button { color: #EDF6EB; background: transparent; border-color: #618274; }
  .today-focus-actions .control-button:hover { background: #294E40; border-color: #AAC4B5; }
  .today-focus-actions button[hidden], .today-focus-main p[hidden] { display: none; }
  .today-focus-actions button:focus-visible { outline-color: #D6EE9B; }
  #btn-edit-overview svg { width: 15px; height: 15px; }
  html:not([data-active-view="today"]) #btn-edit-overview,
  #btn-edit-overview[hidden] { display: none; }
  .overview-layout-toolbar {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
    gap: 8px 14px; padding: 10px 13px; margin-bottom: 14px;
    border: 1px solid var(--border-hairline); border-radius: 10px; background: var(--bg-surface);
  }
  .overview-layout-toolbar[hidden] { display: none; }
  .overview-layout-toolbar p { color: var(--text-body); font-size: 13px; }
  .overview-layout-toolbar .pill-rose { flex-basis: 100%; padding: 6px 8px; border-radius: 6px; }
  .overview-layout-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .overview-grid {
    position: relative; display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; margin-bottom: 24px;
  }
  #overview-grid[data-custom-order] { grid-template-areas: none; }
  #overview-grid[data-custom-order] > .overview-card { grid-area: auto; }
  .overview-card {
    display: flex; flex-direction: column; min-width: 0; padding: 17px;
    border: 1px solid var(--border-hairline); border-radius: 15px; background: var(--bg-surface);
  }
  .card-layout-controls { display: none; }
  .overview-grid[data-editing] .card-layout-controls {
    display: flex; align-items: stretch; gap: 4px; padding-bottom: 8px; margin-bottom: 9px;
    border-bottom: 1px solid var(--border-hairline);
  }
  .card-layout-controls button {
    display: grid; place-items: center; min-width: 38px; min-height: 35px; border-radius: 7px;
    color: var(--link); background: var(--accent-soft); cursor: pointer;
  }
  .card-layout-controls button:hover { background: var(--bg-muted); }
  .card-layout-controls button:disabled { opacity: .42; cursor: default; }
  .card-layout-controls .card-grip { flex: 1; justify-items: start; padding-left: 10px; cursor: grab; touch-action: none; }
  .card-layout-controls .card-grip:active { cursor: grabbing; }
  .card-layout-controls svg { width: 17px; height: 17px; }
  .overview-grid[data-editing] .overview-card { transition: box-shadow .2s, border-color .18s; }
  .overview-grid:has([data-dragging]) { cursor: grabbing; user-select: none; }
  .overview-card[data-dragging] {
    position: relative; z-index: 32; pointer-events: none; will-change: translate;
    border-color: var(--focus); box-shadow: 0 14px 32px rgba(12, 23, 45, .25);
  }
  .overview-grid[data-live-drag]::before {
    content: ""; position: absolute; pointer-events: none;
    left: var(--drop-x); top: var(--drop-y); width: var(--drop-width); height: var(--drop-height);
    border: 1px dashed var(--focus); border-radius: 15px; background: var(--accent-soft);
  }
  .overview-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 30px; margin-bottom: 14px; }
  .overview-card h2 { margin: 0; color: var(--text-heading); font-size: 14px; font-weight: 700; }
  .card-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--bg-muted); color: var(--text-muted); flex: 0 0 auto; }
  .card-icon svg { width: 16px; height: 16px; }
  .card-link { color: var(--link); font-size: 12px; font-weight: 650; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  .card-link:hover { text-decoration: underline; text-underline-offset: 3px; }
  .card-link svg { width: 13px; height: 13px; }
  .card-caption { font-size: 13px; color: var(--text-muted); }
  .card-value, .workout-name { color: var(--text-heading); font-weight: 740; letter-spacing: -.025em; }
  .card-value { font-size: 29px; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .card-value small { font-size: 14px; font-weight: 570; color: var(--text-muted); }
  .workout-name { margin: 0 0 12px; font-size: 20px; line-height: 1.4; overflow-wrap: anywhere; }
  .overview-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 12px; }
  .overview-workout { grid-area: workout; }
  #readiness-band { grid-area: readiness; }
  .overview-volume { grid-area: volume; }
  .overview-sleep { grid-area: sleep; }
  .overview-vitals { grid-area: vitals; }
  .overview-weather { grid-area: weather; }
  .overview-grid { grid-template-areas: "workout" "readiness" "volume" "sleep" "vitals" "weather"; }
  .workout-pace {
    display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px;
    padding: 9px 11px; border-radius: 8px; background: var(--accent-soft); color: var(--text-heading);
    font-variant-numeric: tabular-nums;
  }
  .workout-pace-label { color: var(--link); font-size: 13px; font-weight: 650; }
  .workout-pace-value { font-size: 23px; font-weight: 740; letter-spacing: -.02em; }
  .workout-pace-value small { color: var(--text-muted); font-size: 13px; font-weight: 600; }
  .workout-pace-base { color: var(--text-body); font-size: 12px; }
  #overview-workout-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
  #overview-workout-metrics .metric-row { display: block; border-bottom: 0; padding-block: 3px; }
  #overview-workout-metrics .metric-row dd { margin-top: 2px; text-align: left; }
  .metric-list { display: grid; margin: 0; }
  .metric-row {
    display: flex; min-width: 0; justify-content: space-between; align-items: baseline;
    padding: 7px 0; gap: 8px; border-bottom: 1px solid var(--border-hairline); font-size: 13px;
  }
  .metric-row:last-child { border-bottom: 0; }
  .metric-row dt { color: var(--text-muted); }
  .metric-row dd { margin: 0; color: var(--text-heading); font-weight: 650; text-align: right; font-variant-numeric: tabular-nums; }
  .metric-context { margin-left: 4px; color: var(--text-muted); font-size: 11px; font-weight: 500; white-space: nowrap; }
  .provenance-label { font-size: 11px; font-weight: 540; }
  .volume-summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 9px; margin-bottom: 14px; }
  .volume-chart {
    --bar-rise-duration: 650ms;
    --bar-duration-step: 15ms;
    direction: ltr;
    display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 5px;
    margin: auto 0 0; padding: 0; list-style: none; text-align: center; font-variant-numeric: tabular-nums;
  }
  .volume-chart li { display: grid; grid-template-rows: 16px 92px 16px; gap: 4px; min-width: 0; }
  .volume-track { position: relative; overflow: hidden; border-radius: 12px; }
  .volume-track::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--chart-track); }
  .volume-fill { position: absolute; inset: auto 0 0; border-radius: inherit; background: var(--chart-volume); }
  .volume-chart li:last-child .volume-fill { background: var(--accent); }
  .volume-track::before, .volume-fill { transform-origin: bottom; }
  .volume-waiting .volume-track::before, .volume-waiting .volume-fill { transform: scaleY(0); }
  .volume-revealing .volume-track::before, .volume-revealing .volume-fill {
    animation: volume-rise calc(var(--bar-rise-duration) + var(--bar-distance-from-right, 0) * var(--bar-duration-step))
      cubic-bezier(.25,.46,.38,1) both;
  }
  @keyframes volume-rise { from { transform: scaleY(0); } to { transform: scaleY(1); } }
  .volume-number { color: var(--text-body); font-size: 12px; font-weight: 600; }
  .volume-date { color: var(--text-muted); font-size: 11px; }
  .volume-note { margin-top: 9px; }
  .sleep-main { display: flex; align-items: center; justify-content: center; gap: 15px; margin: 2px 0 12px; }
  .sleep-ring, .readiness-ring {
    position: relative; display: grid; place-items: center; flex-shrink: 0; width: 106px; height: 106px;
  }
  .sleep-ring svg, .readiness-ring svg { width: 100%; height: 100%; position: absolute; inset: 0; }
  .ring-center { z-index: 1; text-align: center; }
  .ring-center .card-value { font-size: 25px; }
  .ring-center .card-caption { font-size: 11px; }
  .sleep-swatch { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; vertical-align: 1px; }
  .sleep-deep { color: var(--sleep-deep); }
  .sleep-light { color: var(--sleep-light); }
  .sleep-rem { color: var(--sleep-rem); }
  .sleep-swatch { background: currentColor; }
  .ring-track { stroke: var(--chart-track); }
  .readiness-main { display: flex; align-items: center; gap: 12px; min-height: 112px; }
  .ring-sweep-path { stroke-dashoffset: var(--ring-offset, 0); }
  .ring-waiting .ring-sweep-path { stroke-dashoffset: 100; }
  .ring-revealing .ring-sweep-path { animation: ring-sweep 1.16s cubic-bezier(.42,.03,.22,1); }
  @keyframes ring-sweep {
    from { stroke-dashoffset: 100; }
    to { stroke-dashoffset: var(--ring-offset, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .overview-grid[data-editing] .overview-card { transition: none; }
    .volume-waiting .volume-track::before, .volume-waiting .volume-fill { transform: none; }
    .volume-revealing .volume-track::before, .volume-revealing .volume-fill { animation: none; }
    .ring-waiting .ring-sweep-path { stroke-dashoffset: var(--ring-offset, 0); }
    .ring-revealing .ring-sweep-path { animation: none; }
  }
  #readiness-meta { min-width: 0; display: grid; gap: 5px; }
  #readiness-advisory-bar { margin-top: 12px; }
  .weather-summary { display: grid; gap: 4px; margin: 4px 0 10px; }
  .workspace-stack, .workspace-grid { display: grid; gap: 14px; }
  .workspace-grid > * { min-width: 0; }
  .workspace-panel {
    min-width: 0; padding: 17px; border: 1px solid var(--border-hairline);
    border-radius: 15px; background: var(--bg-surface); overflow-wrap: anywhere;
  }
  .panel-head {
    display: flex; min-height: 30px; justify-content: space-between; align-items: center;
    flex-wrap: wrap; gap: 4px 8px; margin-bottom: 14px;
  }
  .panel-head h2, .panel-head h3, .panel-subsection h3, .diary-group h3 {
    color: var(--text-heading); font-size: 15px; font-weight: 700;
  }
  .panel-head > svg { width: 17px; height: 17px; color: var(--text-muted); flex: 0 0 auto; }
  .panel-subsection { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border-hairline); }
  .panel-subsection h3, .diary-group h3 { font-size: 13px; }
  .panel-head-small { min-height: 0; margin-bottom: 8px; }
  .workout-heading { color: var(--text-heading); font-size: clamp(19px, 1.6vw, 23px); font-weight: 740; letter-spacing: -.025em; }
  #today-workout-card { scroll-margin-top: 18px; }

  .coach-rows { display: grid; }
  .coach-row + .coach-row { border-top: 1px solid var(--border-hairline); }
  .coach-row { display: grid; justify-items: start; gap: 5px; padding: 9px 0; }
  .coach-row p, .review-copy, .review-copy p, .training-hints {
    color: var(--text-body); font-size: 12px; line-height: 1.65;
  }
  .coach-tag { border-radius: 5px; padding: 2px 6px; font-size: 11px; font-weight: 620; }
  .coach-decision { display: grid; gap: 5px; margin-bottom: 6px; }
  .coach-decision strong { color: var(--text-heading); font-size: 16px; line-height: 1.45; }
  .coach-reason { color: var(--text-body); font-size: 13px; line-height: 1.55; }
  .disclosure > summary {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    min-height: 34px; list-style: none; color: var(--link); cursor: pointer; font-size: 12px; font-weight: 650;
  }
  .disclosure > summary::marker { content: ''; }
  .disclosure > summary > svg { width: 15px; height: 15px; flex-shrink: 0; }
  .disclosure[open] > summary > svg { rotate: 180deg; }
  .coach-brief-hide, .coach-brief[open] .coach-brief-show { display: none; }
  .coach-brief[open] .coach-brief-hide { display: inline; }
  .coach-brief-body, #weekly-review-text {
    max-block-size: 228px; overflow-y: auto; overscroll-behavior: contain;
    padding-inline-end: 8px; scrollbar-color: var(--border-strong) transparent;
  }
  .stage-focus, .review-copy { display: grid; gap: 8px; }
  .stage-warning { padding: 8px; border-radius: 7px; color: var(--text-body); background: var(--bg-muted); font-size: 12px; }

  .week-calendar { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
  .week-day-tab {
    display: grid; min-height: 88px; gap: 6px; padding: 9px 10px; text-align: left; cursor: pointer;
    border: 1px solid var(--border-hairline); border-radius: 10px; color: var(--text-heading); background: var(--bg-muted);
  }
  .week-day-tab:hover { border-color: var(--border-strong); }
  .week-day-tab[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
  .week-day-date, .week-day-kind, .week-day-caption { display: flex; align-items: center; gap: 5px; }
  .week-day-date { justify-content: space-between; color: var(--text-muted); font-size: 12px; }
  .week-day-date time { font-variant-numeric: tabular-nums; }
  .week-date-mobile { display: none; }
  .week-day-kind { font-weight: 700; font-size: 13px; }
  .week-day-kind i, .stage-marker { flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; }
  .week-day-caption { font-size: 12px; color: var(--text-muted); }
  .week-day-caption svg { width: 13px; height: 13px; color: var(--link); margin-inline-start: auto; }
  .week-totals { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .week-totals > div { background: var(--bg-muted); padding: 9px 10px; border-radius: 8px; }
  .week-totals dt { color: var(--text-muted); font-size: 11px; }
  .week-totals dd { margin-top: 3px; color: var(--text-heading); font-size: 20px; font-weight: 710; font-variant-numeric: tabular-nums; }
  .week-totals small { color: var(--text-muted); font-size: 11px; font-weight: 550; }
  .stage-list { display: grid; gap: 3px; margin: 9px 0 0; padding: 0; list-style: none; }
  .stage-list li { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 7px; color: var(--text-body); font-size: 12px; }
  .stage-marker { background: var(--border-strong); }
  .stage-list li[aria-current="step"] { color: var(--link); background: var(--accent-soft); font-weight: 680; }
  .stage-list li[aria-current="step"] .stage-marker { background: var(--accent); }
  .stage-list small { margin-left: auto; flex-shrink: 0; color: var(--text-muted); font-size: 11px; }

  .load-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .load-metrics > div { padding: 10px; border-radius: 8px; background: var(--bg-muted); }
  .load-metrics dt { display: flex; align-items: center; gap: 5px; color: var(--text-body); font-size: 12px; font-weight: 600; }
  .load-metrics dd { color: var(--text-heading); font-size: 25px; font-weight: 740; font-variant-numeric: tabular-nums; }
  .load-metrics .load-detail { color: var(--text-muted); font-size: 11px; font-weight: 500; }
  .load-dot, .zone-legend i { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .load-ctl { background: #0EA5E9; }
  .load-atl { background: #F59E0B; }
  .load-tsb { background: #10B981; }
  .chart-slot { position: relative; min-width: 0; }
  .chart-slot canvas { max-inline-size: 100%; max-block-size: 100%; }
  .chart-slot-main { height: 225px; }
  .chart-slot-compact { height: 134px; }
  .chart-slot-zone { height: 27px; }
  .chart-empty {
    position: absolute; inset: 0; display: grid; place-items: center; background: var(--bg-muted);
    color: var(--text-muted); font-size: 12px; text-align: center; border-radius: 8px;
  }
  .chart-empty.hidden { display: none; }
  .zone-legend { display: flex; flex-wrap: wrap; gap: 5px 11px; padding-top: 7px; color: var(--text-muted); font-size: 12px; }
  .zone-legend span { display: inline-flex; align-items: center; gap: 4px; }
  .zone-legend strong { color: var(--text-body); }
  .fit-activity { margin-bottom: 7px; color: var(--text-heading); font-size: 13px; font-weight: 670; }
  .fit-metrics { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-bottom: 8px; color: var(--text-muted); font-size: 12px; }
  .fit-note { margin-top: 12px; padding: 11px; border-radius: 8px; background: var(--bg-muted); font-size: 12px; line-height: 1.6; }
  .training-hints { display: grid; gap: 8px; padding-left: 1.15em; margin-top: 9px; list-style: disc; }

  .diary-grid { align-items: start; }
  .diary-date { display: flex; align-items: center; gap: 7px; color: var(--text-muted); font-size: 12px; }
  .diary-date input { min-width: 0; min-height: 36px; padding: 4px 7px; color: var(--text-heading); font-size: 13px; }
  .diary-group { display: grid; gap: 10px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border-hairline); }
  .diary-status, .diary-sliders { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .diary-slider { display: grid; gap: 12px; padding: 12px 10px 16px; background: var(--bg-muted); border-radius: 8px; }
  .diary-sleep { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding-block: 3px; font-size: 12px; }
  #checkin-planned-context { margin-top: 12px; flex-wrap: wrap; }
  #status-buttons button, .area-chip, .sq-chip { min-height: 34px; border-radius: 8px; }
  #status-buttons button[aria-pressed="true"], .area-chip[aria-pressed="true"], .sq-chip[aria-pressed="true"] {
    border-color: var(--accent); color: var(--link); background: var(--accent-soft);
  }
  .diary-feedback { padding: 4px 10px 8px; border: 1px solid var(--border-hairline); border-radius: 8px; }
  .diary-feedback small { margin-left: 5px; color: var(--text-muted); }
  .diary-feedback .sky-input { min-width: 0; min-height: 36px; }
  .diary-actions { display: grid; grid-template-columns: max-content 1fr; justify-items: start; gap: 8px; margin-top: 16px; }
  .diary-save { display: contents; }
  .diary-save-date { display: none; }
  #btn-submit-checkin { grid-area: 1 / 1; }
  #btn-recalculate-plan { grid-area: 1 / 2; }
  .diary-save-status {
    grid-column: 1 / -1; padding: 7px 9px; border-radius: 8px;
    line-height: 1.45; font-size: 13px; overflow-wrap: anywhere;
  }
  .diary-timeline { display: grid; row-gap: 9px; }
  .diary-log {
    min-width: 0; margin: 0; padding: 11px; border: 1px solid var(--border-hairline);
    border-radius: 10px; background: var(--bg-muted); overflow-wrap: anywhere;
  }
  .diary-log-active { border-color: var(--accent); }
  .diary-log .text-heading { font-variant-numeric: tabular-nums; }

  .mobile-dock {
    position: fixed; z-index: 40; inset: auto 0 0; display: grid; grid-template-columns: repeat(4, 1fr);
    padding: 5px 8px var(--dock-inset);
    border-top: 1px solid var(--border-hairline); background: var(--bg-surface);
  }
  .mobile-tab {
    display: grid; place-items: center; align-content: center; gap: 4px; min-height: 49px;
    border-radius: 9px; color: var(--text-muted); cursor: pointer; font-size: 11px; font-weight: 590;
  }
  .mobile-tab[aria-current="page"] { background: var(--accent-soft); color: var(--link); font-weight: 700; }
  .auth-card {
    width: min(100%, 420px); margin: clamp(24px, 9vh, 96px) auto 0; padding: 28px;
    border: 1px solid var(--border-hairline); border-radius: 16px; background: var(--bg-surface);
  }
  .auth-card h1 { margin: 14px 0 7px; color: var(--text-heading); font-size: 24px; font-weight: 740; letter-spacing: -.03em; }
  .auth-card p { margin: 0 0 22px; color: var(--text-muted); font-size: 14px; line-height: 1.6; }
  .auth-card label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 640; }
  #auth-unlock-form .primary-button { width: 100%; min-height: 44px; margin-top: 12px; }
  #gate-error { margin-top: 12px; }
  .auth-weather {
    display: flex; align-items: center; gap: 7px; margin-top: 18px; padding-top: 13px;
    border-top: 1px solid var(--border-hairline); color: var(--text-muted); font-size: 12px;
  }
  .auth-weather svg { width: 16px; height: 16px; flex-shrink: 0; }
  .demo-source { padding: 3px 7px; border-radius: 5px; background: var(--accent-soft); color: var(--link); font-weight: 650; }
  @media (max-width: 639px) {
    .app-header { gap: 6px; padding: 10px 14px; }
    .header-brand { gap: 6px; }
    .header-brand .brand-mark { width: 29px; height: 29px; flex-basis: 29px; border-radius: 8px; }
    .header-brand .brand-mark svg { width: 20px; height: 20px; }
    .header-brand .brand-name { font-size: 13px; line-height: 1.1; }
    .header-actions { gap: 5px; }
    .header-actions .icon-button, #btn-sync-garmin { width: 33px; padding-inline: 0; }
    #sync-label { display: none; }
    #btn-open-checkin { padding-inline: 7px; font-size: 12px; }
    #btn-open-checkin svg { display: none; }
    html[data-active-view="today"] #header-stage-display { display: none; }
    .page-heading h1 { font-size: 27px; }
    .today-focus { align-items: stretch; flex-direction: column; gap: 9px; padding: 12px 14px; }
    .today-focus-main h2 { font-size: 17px; }
    .today-focus-icon { width: 30px; height: 30px; flex-basis: 30px; }
    .today-focus-actions { flex-wrap: wrap; }
    .today-focus-actions button { flex: 1; min-height: 41px; }
    .card-layout-controls button { min-width: 42px; min-height: 42px; }
    .overview-workout .overview-card-head, #readiness-band .overview-card-head { margin-bottom: 8px; }
    .overview-workout .workout-name { margin-bottom: 8px; }
    .readiness-main { min-height: 94px; }
    .readiness-ring { width: 88px; height: 88px; }
    .dashboard-content { padding: 18px 14px; }
    html.apex-unlocked .dashboard-content { padding-bottom: calc(80px + env(safe-area-inset-bottom)); }
    html.apex-unlocked[data-active-view="diary"] { scroll-padding-bottom: calc(var(--dock-height) + 76px); }
    html.apex-unlocked[data-active-view="diary"] .dashboard-content { padding-bottom: calc(var(--dock-height) + 88px); }
    .diary-actions { grid-template-columns: 1fr; }
    #btn-recalculate-plan { grid-area: auto; }
    .diary-save {
      position: fixed; z-index: 39; inset: auto 0 var(--dock-height);
      display: flex; align-items: center; justify-content: space-between; gap: 9px; min-height: 58px;
      border-top: 1px solid var(--border-hairline); padding: 6px 14px; background: var(--bg-surface);
    }
    .diary-save-date { display: block; color: var(--text-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .diary-save:has(.diary-save-status:not(.hidden)) .diary-save-date { display: none; }
    .diary-save-status { padding: 5px 7px; max-block-size: 58px; min-width: 0; overflow-y: auto; }
    #btn-submit-checkin { margin-inline-start: auto; min-height: 44px; flex-shrink: 0; }
    .auth-card { padding: 22px; }
    .auth-card input { font-size: 16px; }
    .week-calendar { gap: 4px; }
    .week-day-tab { min-height: 66px; gap: 4px; padding: 5px 0; justify-items: center; text-align: center; }
    .week-day-date { display: grid; gap: 2px; font-size: 11px; }
    .week-date-desktop, .week-day-kind span, .week-day-tab .week-day-caption { display: none; }
    .week-date-mobile { display: block; color: var(--text-heading); font-size: 14px; font-weight: 700; }
    .diary-date input, .diary-feedback .sky-input, .diary-group select { font-size: 16px; }
    .diary-feedback .sky-input { min-height: 41px; }
  }
  @media (min-width: 640px) {
    .overview-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-areas: "workout readiness" "volume sleep" "vitals weather";
    }
    .week-calendar, .load-metrics, .diary-status { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    html.apex-unlocked .dashboard-content { padding-bottom: calc(84px + env(safe-area-inset-bottom)); }
  }
  @media (min-width: 840px) {
    .app-sidebar {
      --rail-text: #C8D9CE;
      --rail-ink: #F3F7EE;
      --rail-edge: #385447;
      --rail-active: #D6EE9B;
      --rail-active-ink: #172A20;
      position: fixed; inset: 0 auto 0 0; z-index: 25; display: flex; flex-direction: column;
      width: 218px; padding: 17px 13px; border-right: 1px solid var(--rail-edge); background: #192F26;
    }
    html[data-theme="night"] .app-sidebar { background: #111F18; }
    .app-sidebar :focus-visible { outline-color: var(--rail-active); }
    .sidebar-brand { padding: 3px 6px; }
    .sidebar-brand .brand-name { color: var(--rail-ink); font-size: 14px; }
    .sidebar-brand .brand-mark { color: var(--rail-active-ink); background: var(--rail-active); }
    .sidebar-nav { display: grid; gap: 4px; margin-top: 30px; }
    .view-tab {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 42px;
      padding: 0 11px; border-radius: 9px; color: var(--rail-text); text-align: left;
      font-size: 13px; font-weight: 620; cursor: pointer;
    }
    .view-tab:hover { background: #2B4839; color: var(--rail-ink); }
    .view-tab[aria-current="page"] { background: var(--rail-active); color: var(--rail-active-ink); }
    .sidebar-footer {
      display: grid; gap: 5px; margin-top: auto; padding: 13px 10px 0;
      border-top: 1px solid var(--rail-edge); color: var(--rail-text); font-size: 12px;
    }
    .sidebar-footer strong { color: var(--rail-ink); font-size: 13px; font-weight: 720; }
    html.apex-unlocked .app-main { margin-left: 218px; }
    html.apex-unlocked .header-brand { display: none; }
    html.apex-unlocked .header-context { display: flex; align-items: center; gap: 7px; }
    .header-context svg { width: 13px; height: 13px; }
    html.apex-unlocked .mobile-dock { display: none; }
    html.apex-unlocked .dashboard-content { padding-bottom: 32px; }
  }
  @media (min-width: 1080px) {
    .app-header { padding-inline: 28px; }
    .dashboard-content { padding-inline: 28px; }
    .overview-grid, .workspace-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .overview-grid { grid-template-areas: "workout volume sleep" "readiness vitals weather"; }
    .workspace-main { grid-column: span 2; }
    .week-calendar { grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .chart-slot-main { height: 254px; }
    .diary-timeline {
      max-height: min(70vh, 600px); overflow-y: auto; overscroll-behavior: contain;
      scrollbar-color: var(--border-strong) transparent;
    }
  }
`;
