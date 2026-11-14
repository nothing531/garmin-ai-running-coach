import { formatPace } from '../science/metrics.js';

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TYPE_STYLE = {
  E: { badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40', bar: 'border-t-sky-400', label: '有氧轻松跑 E' },
  M: { badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40', bar: 'border-t-blue-500', label: '马拉松配速 M' },
  T: { badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40', bar: 'border-t-amber-400', label: '乳酸阈值 T' },
  I: { badge: 'bg-violet-500/20 text-violet-300 border-violet-500/40', bar: 'border-t-violet-400', label: '最大摄氧 I' },
  R: { badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40', bar: 'border-t-rose-400', label: '神经速度 R' },
  LSD: { badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', bar: 'border-t-emerald-400', label: '渐进长距离 LSD' },
  STR: { badge: 'bg-teal-500/20 text-teal-300 border-teal-500/40', bar: 'border-t-teal-400', label: '力量交叉 STR' },
  REST: { badge: 'bg-slate-600/30 text-slate-300 border-slate-500/40', bar: 'border-t-slate-500', label: '恢复休息 REST' }
};

/**
 * 渲染单文件交互式 HTML 跑步教练看板 (Intervals.icu + Garmin Dark + TrainingPeaks 混合风格)
 */
export function renderDashboardHtml(payload) {
  const {
    generatedAt,
    dataSource,
    config,
    wellness,
    readiness,
    pmc,
    weeklyZones,
    lastKeyWorkoutAudit,
    envForecast,
    envToday,
    envAdjustmentToday,
    coachPlan
  } = payload;

  const lightStyles = {
    green: {
      bg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
      stroke: '#10B981',
      glow: 'shadow-emerald-500/20'
    },
    yellow: {
      bg: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
      stroke: '#F59E0B',
      glow: 'shadow-amber-500/20'
    },
    red: {
      bg: 'bg-rose-500/15 border-rose-500/40 text-rose-300',
      stroke: '#EF4444',
      glow: 'shadow-rose-500/20'
    }
  };
  const lStyle = lightStyles[readiness.light] || lightStyles.green;

  const dashDataJson = JSON.stringify({
    pmcSeries: pmc.series,
    weekly: weeklyZones.weekly,
    zonePercentages: weeklyZones.zonePercentages,
    fitSamples: lastKeyWorkoutAudit?.telemetrySamples || []
  }).replace(/</g, '\\u003c');

  const ltPaceStr = formatPace(config.physiology?.ltPaceSecPerKm || 265);
  const decoupling = lastKeyWorkoutAudit?.decoupling;
  const acwrVal = pmc.latest.acwr;
  const acwrColor =
    acwrVal > 1.5
      ? 'text-rose-400'
      : acwrVal > 1.3
        ? 'text-amber-400'
        : acwrVal >= 0.8
          ? 'text-emerald-400'
          : 'text-sky-400';

  const daysHtml = (coachPlan?.days || [])
    .map((day, idx) => {
      const style = TYPE_STYLE[day.type] || TYPE_STYLE.E;
      const isToday = idx === 0;
      return `
      <div class="group rounded-2xl bg-slate-900/75 border border-slate-800/90 border-t-4 ${style.bar} p-5 transition-all hover:border-slate-700 hover:bg-slate-900/95 ${isToday ? 'ring-1 ring-emerald-400/40 shadow-lg shadow-emerald-950/30' : ''}">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-mono text-slate-400">${escapeHtml(day.date)} · ${escapeHtml(day.weekday)}</span>
              ${isToday ? '<span class="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">TODAY 今日课表</span>' : ''}
              <span class="px-2 py-0.5 text-[11px] font-medium rounded-full border ${style.badge}">${escapeHtml(style.label)}</span>
            </div>
            <h3 class="mt-2 text-lg font-semibold text-white">${escapeHtml(day.title)}</h3>
          </div>
          <div class="text-right shrink-0">
            <div class="text-xl font-bold font-mono text-white">${day.plannedDistanceKm > 0 ? `${escapeHtml(day.plannedDistanceKm)} km` : 'REST'}</div>
            <div class="text-xs text-slate-400 font-mono">${escapeHtml(day.plannedDurationMin)} min · ~${escapeHtml(day.estimatedTss)} TSS</div>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span class="px-2.5 py-1 rounded-lg bg-slate-800/90 text-slate-200 font-mono">修正配速: <strong class="text-emerald-300">${escapeHtml(day.correctedPace)}</strong> (基准 ${escapeHtml(day.basePace)})</span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-800/90 text-slate-200 font-mono">心率: <strong class="text-amber-300">${escapeHtml(day.targetHr)}</strong></span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-800/90 text-slate-300 font-mono">步频: ${escapeHtml(day.targetCadence)}</span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-800/90 text-slate-300 font-mono">RPE: ${escapeHtml(day.rpe)}</span>
        </div>

        <div class="mt-3 rounded-xl bg-slate-950/60 border border-slate-800/80 px-3 py-2 text-xs text-slate-300 flex items-center gap-2">
          <i data-lucide="cloud-sun" class="w-4 h-4 text-sky-400 shrink-0"></i>
          <span>${escapeHtml(day.envAdjustmentNote)}</span>
        </div>

        <p class="mt-3 text-sm text-slate-200 leading-relaxed">${escapeHtml(day.mainSetSummary)}</p>

        <details class="mt-3 group/det" ${isToday ? 'open' : ''}>
          <summary class="cursor-pointer select-none text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5">
            <span>展开三段式完整处方、拉伸与跑后营养方案</span>
            <i data-lucide="chevron-down" class="w-3.5 h-3.5 transition-transform group-open/det:rotate-180"></i>
          </summary>
          <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs border-t border-slate-800/80 pt-3">
            <div class="rounded-xl bg-slate-950/70 p-3 border border-slate-800/70">
              <div class="text-sky-400 font-semibold mb-1">1. Warm-up 热身激活</div>
              <p class="text-slate-300 leading-relaxed">${escapeHtml(day.warmup)}</p>
            </div>
            <div class="rounded-xl bg-slate-950/70 p-3 border border-slate-800/70">
              <div class="text-amber-400 font-semibold mb-1">2. Main Set 结构化主课表</div>
              <p class="text-slate-300 leading-relaxed">${escapeHtml(day.mainSetDetail)}</p>
            </div>
            <div class="rounded-xl bg-slate-950/70 p-3 border border-slate-800/70">
              <div class="text-violet-400 font-semibold mb-1">3. Cool-down 冷身与拉伸</div>
              <p class="text-slate-300 leading-relaxed">${escapeHtml(day.cooldown)}</p>
            </div>
            <div class="rounded-xl bg-slate-950/70 p-3 border border-slate-800/70">
              <div class="text-emerald-400 font-semibold mb-1">4. 跑后 30min 黄金营养补给</div>
              <p class="text-slate-300 leading-relaxed">${escapeHtml(day.nutrition)}</p>
            </div>
          </div>
          ${
            day.coachTip
              ? `<div class="mt-2.5 text-xs text-slate-400 italic">教练叮嘱：${escapeHtml(day.coachTip)}</div>`
              : ''
          }
        </details>
      </div>`;
    })
    .join('\n');

  const stagesHtml = (coachPlan?.macroPhase?.stages || [])
    .map(
      (s) => `
      <div class="flex-1 rounded-xl p-3 border ${s.active ? 'bg-emerald-500/15 border-emerald-500/50 text-white' : 'bg-slate-900/60 border-slate-800 text-slate-400'}">
        <div class="flex items-center justify-between text-xs font-mono">
          <span>${escapeHtml(s.weeks)}</span>
          ${s.active ? '<span class="px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-300 text-[10px]">当前阶段</span>' : ''}
        </div>
        <div class="mt-1 font-semibold text-sm">${escapeHtml(s.label)}</div>
      </div>`
    )
    .join('\n');

  const circumference = 2 * Math.PI * 44;
  const dashOffset = circumference * (1 - Math.max(0, Math.min(100, readiness.score)) / 100);

  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Running Coach · Garmin 智能训练驾驶舱</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script>
  <style>
    body { background-color: #0B0F19; color: #E2E8F0; font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .glass { background: rgba(15, 23, 42, 0.72); backdrop-filter: blur(12px); }
    details summary::-webkit-details-marker { display: none; }
  </style>
</head>
<body class="min-h-screen antialiased selection:bg-emerald-500/30">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

    <!-- Top Navigation / Meta Bar -->
    <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800/80 pb-4">
      <div>
        <div class="flex items-center gap-2.5">
          <span class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
            <i data-lucide="activity" class="w-4 h-4"></i>
          </span>
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-white">AI Running Coach · 私人跑步科学驾驶舱</h1>
        </div>
        <p class="mt-1 text-xs text-slate-400 font-mono">
          目标：${escapeHtml(config.goal?.eventName || '科学跑步进阶')} (${escapeHtml(config.goal?.targetTime || '--')}) · 城市：${escapeHtml(envForecast?.location?.city || config.location?.cityDisplay || '')} · 数据源：${escapeHtml(dataSource)}
        </p>
      </div>
      <div class="flex items-center gap-2 text-xs font-mono text-slate-400">
        <span class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">更新于 ${escapeHtml(generatedAt)}</span>
      </div>
    </header>

    <!-- 1. Hero Readiness Cockpit -->
    <section class="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <div class="lg:col-span-5 glass rounded-3xl border border-slate-800 p-6 flex flex-col justify-between shadow-xl ${lStyle.glow}">
        <div class="flex items-center justify-between gap-4">
          <div class="space-y-2">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${lStyle.bg}">
              ${escapeHtml(readiness.lightLabel)}
            </span>
            <h2 class="text-lg font-semibold text-white">今日竞技准备度与总教练诊断</h2>
            <p class="text-xs text-slate-400 leading-relaxed">${escapeHtml(readiness.triggers.join('；'))}</p>
          </div>
          <div class="relative w-28 h-28 shrink-0 flex items-center justify-center">
            <svg class="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" stroke="#1E293B" stroke-width="8" fill="none" />
              <circle cx="50" cy="50" r="44" stroke="${lStyle.stroke}" stroke-width="8" fill="none"
                stroke-linecap="round" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}" />
            </svg>
            <div class="absolute text-center">
              <div class="text-2xl font-bold font-mono text-white">${escapeHtml(readiness.score)}</div>
              <div class="text-[10px] text-slate-400 uppercase tracking-wider">Readiness</div>
            </div>
          </div>
        </div>
        <div class="mt-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 p-4 text-xs sm:text-sm text-slate-200 leading-relaxed">
          ${escapeHtml(coachPlan?.coachSummary || '')}
        </div>
      </div>

      <!-- 6 Physiological & Weather Micro-Cards -->
      <div class="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div class="glass rounded-2xl border border-slate-800 p-4">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>昨夜 HRV</span>
            <i data-lucide="heart-pulse" class="w-4 h-4 text-emerald-400"></i>
          </div>
          <div class="mt-2 text-2xl font-bold font-mono text-white">${wellness?.hrvToday ?? '--'} <span class="text-xs font-normal text-slate-400">ms</span></div>
          <div class="mt-1 text-xs text-slate-400 font-mono">7日均值: ${wellness?.hrv7dAvg ?? '--'} ms (${escapeHtml(wellness?.hrvStatus || 'N/A')})</div>
        </div>

        <div class="glass rounded-2xl border border-slate-800 p-4">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>静息心率 RHR</span>
            <i data-lucide="heart" class="w-4 h-4 text-rose-400"></i>
          </div>
          <div class="mt-2 text-2xl font-bold font-mono text-white">${wellness?.rhrToday ?? '--'} <span class="text-xs font-normal text-slate-400">bpm</span></div>
          <div class="mt-1 text-xs font-mono ${readiness.rhrDelta >= 3 ? 'text-amber-400' : 'text-emerald-400'}">较7日基线 ${readiness.rhrDelta >= 0 ? `+${readiness.rhrDelta}` : readiness.rhrDelta} bpm</div>
        </div>

        <div class="glass rounded-2xl border border-slate-800 p-4">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>睡眠质量</span>
            <i data-lucide="moon" class="w-4 h-4 text-violet-400"></i>
          </div>
          <div class="mt-2 text-2xl font-bold font-mono text-white">${wellness?.sleepScore ?? '--'} <span class="text-xs font-normal text-slate-400">/100</span></div>
          <div class="mt-1 text-xs text-slate-400 font-mono">${wellness?.sleepHours ?? '--'}h · 深睡 ${wellness?.deepSleepMin ?? '--'}m · REM ${wellness?.remSleepMin ?? '--'}m</div>
        </div>

        <div class="glass rounded-2xl border border-slate-800 p-4">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>晨起身体电量</span>
            <i data-lucide="battery-charging" class="w-4 h-4 text-sky-400"></i>
          </div>
          <div class="mt-2 text-2xl font-bold font-mono text-white">${wellness?.bodyBatteryMorning ?? '--'} <span class="text-xs font-normal text-slate-400">%</span></div>
          <div class="mt-1 text-xs text-slate-400 font-mono">SpO2: ${wellness?.avgSpO2 ?? '--'}% · 体重 ${wellness?.weightKg ?? '--'}kg</div>
        </div>

        <div class="glass rounded-2xl border border-slate-800 p-4">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>乳酸阈值 & VO2</span>
            <i data-lucide="gauge" class="w-4 h-4 text-amber-400"></i>
          </div>
          <div class="mt-2 text-2xl font-bold font-mono text-white">${escapeHtml(ltPaceStr)} <span class="text-xs font-normal text-slate-400">/km</span></div>
          <div class="mt-1 text-xs text-slate-400 font-mono">LTHR ${wellness?.lthrFromDevice ?? config.physiology?.lthr ?? '--'} bpm · VO2Max ${wellness?.vo2Max ?? '--'}</div>
        </div>

        <div class="glass rounded-2xl border border-slate-800 p-4">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>今日跑步气象</span>
            <i data-lucide="wind" class="w-4 h-4 text-teal-400"></i>
          </div>
          <div class="mt-2 text-xl font-bold font-mono text-white">${envToday ? `${escapeHtml(envToday.weatherText)} ${escapeHtml(envToday.tempC)}°C` : '--'}</div>
          <div class="mt-1 text-xs text-slate-400 font-mono">露点 ${envToday?.dewPointC ?? '--'}°C · AQI ${envToday?.usAqi ?? '--'} · 修正 +${envAdjustmentToday?.slowdownPct ?? 0}%</div>
        </div>
      </div>
    </section>

    <!-- 2. Macro Periodization Roadmap -->
    <section class="glass rounded-3xl border border-slate-800 p-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <h2 class="text-base font-semibold text-white">宏观备赛周期路线图 · ${escapeHtml(coachPlan?.macroPhase?.stageDisplay || '')}</h2>
          <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(coachPlan?.macroPhase?.weekFocus || '')} | ${escapeHtml(coachPlan?.macroPhase?.nextDeloadInfo || '')}</p>
        </div>
      </div>
      <div class="flex flex-col sm:flex-row gap-3">
        ${stagesHtml}
      </div>
    </section>

    <!-- 3. PMC + ACWR & 80/20 Zone Charts -->
    <section class="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <div class="lg:col-span-7 glass rounded-3xl border border-slate-800 p-6">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 class="text-base font-semibold text-white">Intervals.icu 风格体能-疲劳负荷模型 (PMC)</h2>
            <p class="text-xs text-slate-400 font-mono mt-0.5">CTL (慢性体能) ${pmc.latest.ctl} · ATL (急性疲劳) ${pmc.latest.atl} · TSB (竞技状态) ${pmc.latest.tsb}</p>
          </div>
          <div class="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs font-mono">
            ACWR 负荷比: <strong class="${acwrColor}">${pmc.latest.acwr}</strong> <span class="text-slate-500">(甜蜜区 0.8-1.3)</span>
          </div>
        </div>
        <div class="h-64">
          <canvas id="pmcChart"></canvas>
        </div>
      </div>

      <div class="lg:col-span-5 glass rounded-3xl border border-slate-800 p-6 flex flex-col justify-between">
        <div>
          <h2 class="text-base font-semibold text-white">80/20 极化分布 & 近8周跑量</h2>
          <p class="text-xs text-slate-400 font-mono mt-0.5">低强度 Z1-Z2: ${weeklyZones.polarization.lowIntensityPct}% · 灰色 Z3: ${weeklyZones.polarization.grayZonePct}% · 高强度 Z4-Z5: ${weeklyZones.polarization.highIntensityPct}%</p>
        </div>
        <div class="h-40 mt-3">
          <canvas id="weeklyChart"></canvas>
        </div>
        <div class="h-24 mt-3">
          <canvas id="zoneChart"></canvas>
        </div>
      </div>
    </section>

    <!-- 4. Last Key Workout .FIT Telemetry Audit -->
    <section class="glass rounded-3xl border border-slate-800 p-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h2 class="text-base font-semibold text-white">最近重点课表 .FIT 级遥测深挖</h2>
          <p class="text-xs text-slate-400 font-mono mt-0.5">
            ${lastKeyWorkoutAudit?.activity ? `${escapeHtml(lastKeyWorkoutAudit.activity.date)} · ${escapeHtml(lastKeyWorkoutAudit.activity.name)} · ${escapeHtml(lastKeyWorkoutAudit.activity.distanceKm)} km · 均配速 ${escapeHtml(formatPace(lastKeyWorkoutAudit.activity.paceSecPerKm))}/km · 爬升 ${escapeHtml(lastKeyWorkoutAudit.activity.elevationGainM)}m` : '暂无可解析的 .FIT 记录'}
          </p>
        </div>
        <div class="flex flex-wrap gap-2 text-xs font-mono">
          <span class="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800">有氧解耦率 Pa:Hr: <strong class="${decoupling && decoupling.decouplingPct <= 5 ? 'text-emerald-400' : 'text-amber-400'}">${decoupling ? `${decoupling.decouplingPct}%` : '--'}</strong></span>
          <span class="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800">步频: <strong class="text-sky-300">${lastKeyWorkoutAudit?.activity?.cadence ?? '--'} spm</strong></span>
          <span class="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800">步幅: <strong class="text-violet-300">${lastKeyWorkoutAudit?.avgStrideM ?? '--'} m</strong></span>
        </div>
      </div>
      <div class="h-56">
        <canvas id="fitChart"></canvas>
      </div>
      <div class="mt-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 p-3.5 text-xs sm:text-sm text-slate-300">
        <strong class="text-emerald-400">教练遥测点评：</strong>${escapeHtml(coachPlan?.fitWorkoutCritique || '')}
      </div>
    </section>

    <!-- 5. 7-Day Environment-Aware Differentiated Training Plan -->
    <section class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold text-white">未来 7 天环境感知分化训练课表（TrainingPeaks 视图）</h2>
        <span class="text-xs text-slate-400">点击卡片底部可展开完整热身 / 主课 / 拉伸 / 营养方案</span>
      </div>
      <div class="grid grid-cols-1 gap-4">
        ${daysHtml}
      </div>
    </section>

    <footer class="text-center text-xs text-slate-500 pt-4 pb-8 font-mono">
      Powered by Garmin Connect API · Open-Meteo Weather & Elevation · Automated via GitHub Actions
    </footer>
  </div>

  <script>
    lucide.createIcons();
    const DASH_DATA = ${dashDataJson};

    Chart.defaults.color = '#94A3B8';
    Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.12)';
    Chart.defaults.font.family = 'ui-monospace, SFMono-Regular, Menlo, monospace';

    // 1. PMC Chart
    const pmcCtx = document.getElementById('pmcChart');
    if (pmcCtx && DASH_DATA.pmcSeries.length > 0) {
      new Chart(pmcCtx, {
        type: 'line',
        data: {
          labels: DASH_DATA.pmcSeries.map(d => d.date.slice(5)),
          datasets: [
            { label: 'CTL (体能)', data: DASH_DATA.pmcSeries.map(d => d.ctl), borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.12)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
            { label: 'ATL (疲劳)', data: DASH_DATA.pmcSeries.map(d => d.atl), borderColor: '#F59E0B', tension: 0.35, pointRadius: 0, borderWidth: 2 },
            { label: 'TSB (状态)', data: DASH_DATA.pmcSeries.map(d => d.tsb), borderColor: '#10B981', borderDash: [4, 4], tension: 0.35, pointRadius: 0, borderWidth: 1.8 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
          scales: { x: { ticks: { maxTicksLimit: 8 } } }
        }
      });
    }

    // 2. Weekly Mileage Bar Chart
    const weeklyCtx = document.getElementById('weeklyChart');
    if (weeklyCtx && DASH_DATA.weekly.length > 0) {
      new Chart(weeklyCtx, {
        type: 'bar',
        data: {
          labels: DASH_DATA.weekly.map(w => w.weekStart.slice(5)),
          datasets: [{
            label: '周跑量 (km)',
            data: DASH_DATA.weekly.map(w => w.distanceKm),
            backgroundColor: 'rgba(16, 185, 129, 0.65)',
            borderColor: '#10B981',
            borderWidth: 1,
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } }
        }
      });
    }

    // 3. 5-Zone Horizontal Stacked Distribution
    const zoneCtx = document.getElementById('zoneChart');
    if (zoneCtx) {
      const zp = DASH_DATA.zonePercentages || [0,0,0,0,0];
      new Chart(zoneCtx, {
        type: 'bar',
        data: {
          labels: ['区间占比'],
          datasets: [
            { label: 'Z1 恢复', data: [zp[0]], backgroundColor: '#64748B' },
            { label: 'Z2 有氧', data: [zp[1]], backgroundColor: '#3B82F6' },
            { label: 'Z3 节奏', data: [zp[2]], backgroundColor: '#10B981' },
            { label: 'Z4 阈值', data: [zp[3]], backgroundColor: '#F59E0B' },
            { label: 'Z5 无氧', data: [zp[4]], backgroundColor: '#EF4444' }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, font: { size: 10 } } } },
          scales: { x: { stacked: true, max: 100 }, y: { stacked: true, display: false } }
        }
      });
    }

    // 4. .FIT Pace vs Heart Rate Audit Chart
    const fitCtx = document.getElementById('fitChart');
    if (fitCtx && DASH_DATA.fitSamples.length > 0) {
      new Chart(fitCtx, {
        type: 'line',
        data: {
          labels: DASH_DATA.fitSamples.map(s => s.km + 'km'),
          datasets: [
            { label: '心率 (bpm)', data: DASH_DATA.fitSamples.map(s => s.hr), borderColor: '#EF4444', yAxisID: 'yHr', tension: 0.3, pointRadius: 0, borderWidth: 2 },
            { label: '配速 (s/km, 越低越快)', data: DASH_DATA.fitSamples.map(s => s.paceSec), borderColor: '#38BDF8', yAxisID: 'yPace', tension: 0.3, pointRadius: 0, borderWidth: 2 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            yHr: { type: 'linear', position: 'left', title: { display: true, text: 'HR (bpm)' } },
            yPace: { type: 'linear', position: 'right', reverse: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Pace (sec/km)' } }
          }
        }
      });
    }
  </script>
</body>
</html>`;
}
