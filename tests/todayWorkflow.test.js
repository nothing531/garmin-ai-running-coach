import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardLocalDate, resolveTodayWorkflow } from '../src/render/todayWorkflow.js';

const date = '2026-11-18';
const firstPlanDay = { date, type: 'E' };

test('dashboard uses the training timezone at the UTC date boundary', () => {
  const instant = new Date('2026-11-17T16:05:00Z');
  assert.equal(dashboardLocalDate('Asia/Shanghai', instant), date);
  assert.equal(dashboardLocalDate('UTC', instant), '2026-11-17');
  assert.equal(dashboardLocalDate('invalid', instant), date);
});

test('training results are still due after recording morning feedback', () => {
  const pending = resolveTodayWorkflow({ date, firstPlanDay });
  assert.equal(pending.secondary.action, 'planned');
  assert.equal(pending.primary.action, 'completed');

  const morning = resolveTodayWorkflow({ date, firstPlanDay, checkin: { date, status: 'planned' } });
  assert.equal(morning.title, '晨间体感已保存');
  assert.equal(morning.primary.action, 'completed');
  assert.equal(morning.secondary, null);
});

test('a rest day can be recorded and saved entries can be reviewed', () => {
  const restDay = { date, type: 'REST' };
  const pending = resolveTodayWorkflow({ date, firstPlanDay: restDay });
  assert.equal(pending.primary.action, 'rest');

  for (const status of ['completed', 'modified', 'rest']) {
    const saved = resolveTodayWorkflow({ date, firstPlanDay: restDay, checkin: { date, status } });
    assert.equal(saved.tone, 'recorded');
    assert.equal(saved.primary.action, 'review');
  }
});

test('a stale plan prompts sync while same-day records remain accessible', () => {
  const yesterday = '2026-11-17';
  const stalePlan = { date: yesterday, type: 'E' };
  const stale = resolveTodayWorkflow({ date, firstPlanDay: stalePlan, checkin: { date: yesterday, status: 'completed' } });
  assert.equal(stale.primary.action, 'sync');
  assert.equal(stale.secondary, null);

  const saved = resolveTodayWorkflow({ date, firstPlanDay: stalePlan, checkin: { date, status: 'completed' } });
  assert.equal(saved.primary.action, 'sync');
  assert.equal(saved.secondary.action, 'review');
});
