import { runCoachPipeline } from '../src/index.js';
import { syncCoachWorkoutsToGarmin } from '../src/garmin/workoutSync.js';

// The SSH caller only needs status, not private dashboard data or service logs.
const report = console.log.bind(console);
console.log = console.warn = console.error = () => {};

process.env.LLM_API_KEY = '';
process.env.GARMIN_SYNC_WORKOUTS = 'false';

let dashboard;
try {
  dashboard = await runCoachPipeline({ skipNotify: true });
  report(JSON.stringify({
    dashboardUpdated: true,
    generatedAt: dashboard.generatedAt,
    weatherAvailable: dashboard.envForecast?.weatherAvailable,
    planValidated: dashboard.coachPlan?.validationReport?.passed === true,
    remoteModelUsed: dashboard.coachPlan?.llmUsed === true
  }));
} catch {
  report(JSON.stringify({ dashboardUpdated: false, garminSynced: false, failedAt: 'dashboard' }));
  process.exitCode = 1;
}

if (dashboard) {
  try {
    const result = await syncCoachWorkoutsToGarmin(dashboard.coachPlan, {
      days: 5,
      requireValidatedPlan: true,
      auth: {
        region: process.env.GARMIN_REGION || dashboard.config.region || 'cn',
        email: process.env.GARMIN_EMAIL,
        password: process.env.GARMIN_PASSWORD,
        sessionJson: process.env.GARMIN_SESSION_JSON
      }
    });
    report(JSON.stringify({ garminSynced: true, scheduled: result.synced.length, skipped: result.skipped.length }));
  } catch (error) {
    const status = error.response?.status ?? error.cause?.response?.status;
    const code = error.code ?? error.cause?.code;
    report(JSON.stringify({
      garminSynced: false,
      failedAt: 'garminConnect',
      ...(Number.isInteger(status) ? { httpStatus: status } : {}),
      ...(typeof code === 'string' && /^[A-Z0-9_]{3,30}$/.test(code) ? { code } : {})
    }));
    process.exitCode = 1;
  }
}
