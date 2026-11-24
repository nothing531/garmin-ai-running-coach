// Export standalone functions so the single-file dashboard can use the same rules.
export function dashboardLocalDate(timeZone, now = new Date()) {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en', { ...options, timeZone: timeZone || 'Asia/Shanghai' });
  } catch {
    formatter = new Intl.DateTimeFormat('en', { ...options, timeZone: 'Asia/Shanghai' });
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

export function resolveTodayWorkflow({ date, firstPlanDay, checkin }) {
  const recorded = checkin?.date === date ? checkin.status : null;
  const review = { label: '查看今日记录', action: 'review' };

  if (firstPlanDay?.date !== date) {
    return {
      tone: 'waiting',
      title: '今日课表待更新',
      detail: firstPlanDay?.date ? '当前课表起于 ' + firstPlanDay.date : '同步 Garmin 后查看今日安排。',
      primary: { label: '同步 Garmin', action: 'sync' },
      secondary: recorded ? review : null
    };
  }

  const titles = { completed: '今日训练已记录', modified: '今日训练调整已记录', rest: '今日休息已记录' };
  if (Object.hasOwn(titles, recorded)) {
    return {
      tone: 'recorded', title: titles[recorded], detail: '',
      primary: review, secondary: null
    };
  }

  if (firstPlanDay.type === 'REST') {
    return {
      tone: 'recovery', title: '今日安排休息',
      detail: recorded === 'planned' ? '晨间体感已保存。' : '可记录今天的恢复情况。',
      primary: { label: '记录休息', action: 'rest' },
      secondary: null
    };
  }

  return {
    tone: 'training',
    title: recorded === 'planned' ? '晨间体感已保存' : '今日训练待记录',
    detail: recorded === 'planned' ? '训练后可继续补记结果。' : '',
    primary: { label: '记录训练结果', action: 'completed' },
    secondary: recorded === 'planned' ? null : { label: '记录晨间体感', action: 'planned' }
  };
}
