// These functions are embedded in the generated single-file dashboard.
export function initOverviewLayout(notify) {
  const grid = document.getElementById('overview-grid');
  const open = document.getElementById('btn-edit-overview');
  const toolbar = document.getElementById('overview-layout-toolbar');
  const save = document.getElementById('btn-save-overview');
  const cancel = document.getElementById('btn-cancel-overview');
  const reset = document.getElementById('btn-reset-overview');
  const status = document.getElementById('overview-layout-status');
  const error = document.getElementById('overview-layout-error');
  const storageKey = 'garmin_coach_overview_order';
  const cards = new Map(Array.from(grid.children, (card) => [card.dataset.card, card]));
  const defaultOrder = [...cards.keys()];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const settling = new Map();
  let savedOrder = null;
  let draftOrder = null;
  let drag = null;

  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(stored) && stored.length === cards.size &&
        new Set(stored).size === cards.size && stored.every((id) => cards.has(id))) {
      savedOrder = stored;
    }
  } catch {}

  function stopSettling() {
    settling.forEach((animation) => animation.cancel());
    settling.clear();
  }

  function applyOrder(order) {
    stopSettling();
    grid.toggleAttribute('data-custom-order', Boolean(order));
    // Only move elements that are out of place so focused controls stay in the DOM.
    (order || defaultOrder).forEach((id, index) => {
      const card = cards.get(id);
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index]);
    });
  }

  function visualOrder() {
    if (draftOrder) return draftOrder;
    return defaultOrder.slice().sort((a, b) => {
      const first = cards.get(a);
      const second = cards.get(b);
      return first.offsetTop - second.offsetTop || first.offsetLeft - second.offsetLeft;
    });
  }

  function updateMoveButtons() {
    const order = visualOrder();
    order.forEach((id, index) => {
      const card = cards.get(id);
      card.querySelector('[data-move="-1"]').disabled = index === 0;
      card.querySelector('[data-move="1"]').disabled = index === order.length - 1;
    });
  }

  function moveCard(id, index) {
    const order = [...visualOrder()];
    const before = order.indexOf(id);
    if (before === index || index < 0 || index >= order.length) return;
    order.splice(before, 1);
    order.splice(index, 0, id);
    draftOrder = order;

    const card = cards.get(id);
    const focused = card.contains(document.activeElement) ? document.activeElement : null;
    applyOrder(order);
    updateMoveButtons();
    if (focused) {
      const nextFocus = focused.disabled ? card.querySelector('[data-card-grip]') : focused;
      nextFocus.focus({ preventScroll: true });
    }
    status.textContent = card.querySelector('h2').textContent + '已移至第 ' + (index + 1) + ' 张';
  }

  function cardPositions(excluded) {
    if (reducedMotion.matches || typeof Element.prototype.animate !== 'function') return [];
    return Array.from(cards.values()).filter((card) => card !== excluded)
      .map((card) => [card, card.getBoundingClientRect()]);
  }

  function animateFrom(positions, duration) {
    const moves = positions.map(([item, before]) => {
      const after = item.getBoundingClientRect();
      return { item, x: before.left - after.left, y: before.top - after.top };
    });
    for (const { item, x, y } of moves) {
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const animation = item.animate(
        [{ transform: 'translate(' + x + 'px,' + y + 'px)' }, { transform: 'translate(0,0)' }],
        { duration, easing: 'cubic-bezier(.22,.68,.24,1)' }
      );
      settling.set(item, animation);
      animation.onfinish = () => {
        if (settling.get(item) === animation) settling.delete(item);
      };
    }
  }

  function pointerIsOverGrid(x, y) {
    return grid.contains(document.elementFromPoint(x, y));
  }

  function positionDropSlot() {
    const { card } = drag;
    grid.style.setProperty('--drop-x', card.offsetLeft + 'px');
    grid.style.setProperty('--drop-y', card.offsetTop + 'px');
    grid.style.setProperty('--drop-width', card.offsetWidth + 'px');
    grid.style.setProperty('--drop-height', card.offsetHeight + 'px');
  }

  function previewOrderAt(x, y) {
    if (!pointerIsOverGrid(x, y)) return;
    const pageX = x + window.scrollX;
    const pageY = y + window.scrollY;
    // Ignore tiny movements while a newly parked card is sliding out of the way.
    if (drag.previewPoint && Math.hypot(pageX - drag.previewPoint.x, pageY - drag.previewPoint.y) < 18) return;
    const bounds = grid.getBoundingClientRect();
    const localX = x - bounds.left;
    const localY = y - bounds.top;
    const target = drag.order.findIndex((id) => {
      const card = cards.get(id);
      return localX >= card.offsetLeft + 8 && localX <= card.offsetLeft + card.offsetWidth - 8 &&
        localY >= card.offsetTop + 12 && localY <= card.offsetTop + card.offsetHeight - 12;
    });
    const from = drag.order.indexOf(drag.card.dataset.card);
    if (target < 0 || target === from) return;

    const positions = cardPositions(drag.card);
    const previousLeft = drag.card.offsetLeft;
    const previousTop = drag.card.offsetTop;
    stopSettling();
    const [id] = drag.order.splice(from, 1);
    drag.order.splice(target, 0, id);
    drag.previewPoint = { x: pageX, y: pageY };
    // CSS order previews the move without detaching the captured pointer handle.
    grid.setAttribute('data-custom-order', '');
    drag.order.forEach((key, index) => { cards.get(key).style.order = index; });
    const dx = drag.card.offsetLeft - previousLeft;
    const dy = drag.card.offsetTop - previousTop;
    drag.originLeft += dx;
    drag.originTop += dy;
    drag.offsetX -= dx;
    drag.offsetY -= dy;
    drag.card.style.translate = drag.offsetX + 'px ' + drag.offsetY + 'px';
    positionDropSlot();
    animateFrom(positions, 240);
  }

  function endDrag(commit) {
    if (!drag) return;
    const { card, handle, order, initialOrder, pointerId } = drag;
    const positions = cardPositions();
    const changed = commit && order.some((id, index) => id !== initialOrder[index]);
    const focused = card.contains(document.activeElement) ? document.activeElement : null;
    cancelAnimationFrame(drag.frame);
    drag = null;
    grid.removeAttribute('data-live-drag');
    card.removeAttribute('data-dragging');
    card.style.removeProperty('translate');
    cards.forEach((item) => item.style.removeProperty('order'));
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (changed) draftOrder = order;
    applyOrder(draftOrder);
    updateMoveButtons();
    if (focused) focused.focus({ preventScroll: true });
    if (changed) {
      status.textContent = card.querySelector('h2').textContent + '已移至第 ' + (order.indexOf(card.dataset.card) + 1) + ' 张';
    }
    animateFrom(positions, 320);
  }

  function renderDragFrame(now) {
    if (!drag) return;
    drag.frame = 0;
    const edge = drag.y < 70 ? -1 : drag.y > window.innerHeight - 100 ? 1 : 0;
    const elapsed = Math.min(32, Math.max(0, now - drag.lastFrame));
    drag.lastFrame = now;
    const start = window.scrollY;
    if (edge) window.scrollBy({ top: edge * elapsed * 0.8, behavior: 'instant' });
    if (start !== window.scrollY) previewOrderAt(drag.x, drag.y);
    const maxLeft = Math.max(0, document.documentElement.clientWidth - drag.card.offsetWidth);
    const left = Math.max(0, Math.min(maxLeft, drag.x - drag.grabX));
    const x = left + window.scrollX - drag.originLeft;
    const y = drag.y - drag.grabY + window.scrollY - drag.originTop;
    const response = reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed / 42);
    drag.offsetX += (x - drag.offsetX) * response;
    drag.offsetY += (y - drag.offsetY) * response;
    const moving = Math.abs(x - drag.offsetX) > 0.5 || Math.abs(y - drag.offsetY) > 0.5;
    if (!moving) {
      drag.offsetX = x;
      drag.offsetY = y;
    }
    drag.card.style.translate = drag.offsetX + 'px ' + drag.offsetY + 'px';
    if (moving || start !== window.scrollY) drag.frame = requestAnimationFrame(renderDragFrame);
  }

  for (const [id, card] of cards) {
    const title = card.querySelector('h2').textContent;
    card.insertAdjacentHTML('afterbegin',
      '<div class="card-layout-controls">' +
        '<button type="button" data-card-grip class="card-grip"><i data-lucide="grip" aria-hidden="true"></i></button>' +
        '<button type="button" data-move="-1"><i data-lucide="chevron-up" aria-hidden="true"></i></button>' +
        '<button type="button" data-move="1"><i data-lucide="chevron-down" aria-hidden="true"></i></button>' +
      '</div>');
    const handle = card.querySelector('[data-card-grip]');
    handle.setAttribute('aria-label', '拖动' + title + '，或按方向键移动');
    for (const button of card.querySelectorAll('[data-move]')) {
      const delta = Number(button.dataset.move);
      button.setAttribute('aria-label', (delta < 0 ? '前移' : '后移') + title);
      button.addEventListener('click', () => moveCard(id, visualOrder().indexOf(id) + delta));
    }
    handle.addEventListener('keydown', (event) => {
      const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
      if (!delta || drag) return;
      event.preventDefault();
      moveCard(id, visualOrder().indexOf(id) + delta);
    });
    handle.addEventListener('pointerdown', (event) => {
      if (drag || !event.isPrimary || event.button !== 0) return;
      const visible = card.getBoundingClientRect();
      settling.get(card)?.cancel();
      settling.delete(card);
      const slot = card.getBoundingClientRect();
      const initialOrder = visualOrder().slice();
      handle.setPointerCapture(event.pointerId);
      drag = {
        card, handle, pointerId: event.pointerId, order: initialOrder.slice(), initialOrder, frame: 0,
        grabX: event.clientX - visible.left, grabY: event.clientY - visible.top,
        originLeft: slot.left + window.scrollX, originTop: slot.top + window.scrollY,
        offsetX: visible.left - slot.left, offsetY: visible.top - slot.top
      };
      card.style.translate = drag.offsetX + 'px ' + drag.offsetY + 'px';
      card.setAttribute('data-dragging', '');
      positionDropSlot();
      grid.setAttribute('data-live-drag', '');
    });
    handle.addEventListener('pointermove', (event) => {
      if (drag?.pointerId !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      previewOrderAt(drag.x, drag.y);
      if (!drag.frame) {
        drag.lastFrame = performance.now();
        drag.frame = requestAnimationFrame(renderDragFrame);
      }
    });
    handle.addEventListener('pointerup', (event) => {
      if (drag?.pointerId !== event.pointerId) return;
      const inside = pointerIsOverGrid(event.clientX, event.clientY);
      if (inside) previewOrderAt(event.clientX, event.clientY);
      endDrag(inside);
    });
    handle.addEventListener('lostpointercapture', () => {
      if (drag?.handle === handle) endDrag(false);
    });
  }
  window.lucide?.createIcons();
  applyOrder(savedOrder);

  function finishEditing(message) {
    endDrag(false);
    stopSettling();
    grid.removeAttribute('data-editing');
    toolbar.hidden = true;
    error.hidden = true;
    open.hidden = false;
    open.focus({ preventScroll: true });
    status.textContent = message;
  }

  open.addEventListener('click', () => {
    draftOrder = savedOrder;
    grid.setAttribute('data-editing', '');
    toolbar.hidden = false;
    open.hidden = true;
    error.hidden = true;
    updateMoveButtons();
    save.focus({ preventScroll: true });
  });
  reset.addEventListener('click', () => {
    endDrag(false);
    draftOrder = null;
    applyOrder(null);
    updateMoveButtons();
    status.textContent = '已预览默认排布';
  });
  cancel.addEventListener('click', () => {
    endDrag(false);
    applyOrder(savedOrder);
    finishEditing('已取消编辑');
  });
  save.addEventListener('click', () => {
    endDrag(false);
    try {
      if (draftOrder) localStorage.setItem(storageKey, JSON.stringify(draftOrder));
      else localStorage.removeItem(storageKey);
    } catch {
      error.hidden = false;
      return;
    }
    savedOrder = draftOrder;
    finishEditing('已保存卡片排布');
    notify('已保存卡片排布', 'ok');
  });
  window.addEventListener('resize', () => {
    endDrag(false);
    if (!toolbar.hidden) updateMoveButtons();
  });
}

export function initChartReveals() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pageSweepDuration = 2200;
  const filterSweepDuration = 1650;
  const hideDuration = 300;
  const damping = 4.2;
  const dampedEnd = 1 - (1 + damping) * Math.exp(-damping);
  const lines = new Map();
  let overviewStops = [];
  let activeView = '';

  function whenVisible(element, run) {
    let pending = true;
    const stop = () => {
      pending = false;
      observer.disconnect();
    };
    const observer = new IntersectionObserver((entries) => {
      if (!pending || !entries.some((entry) => entry.intersectionRatio >= 0.12)) return;
      stop();
      run();
    }, { threshold: 0.12 });
    observer.observe(element);
    return stop;
  }

  function overview() {
    overviewStops.forEach((stop) => stop());
    overviewStops = [];
    const targets = Array.from(document.querySelectorAll('.ring-sweep'), (ring) => [ring, 'ring']);
    const volume = document.getElementById('overview-volume-chart');
    if (volume.children.length) targets.push([volume, 'volume']);
    for (const [element, prefix] of targets) {
      const waiting = prefix + '-waiting';
      const revealing = prefix + '-revealing';
      element.classList.remove(waiting, revealing);
      if (reducedMotion.matches || !window.IntersectionObserver) continue;
      element.classList.add(waiting);
      overviewStops.push(whenVisible(element, () => {
        element.classList.remove(waiting);
        element.classList.add(revealing);
      }));
    }
  }

  function stopLine(state) {
    state.stopWaiting?.();
    state.stopWaiting = null;
    cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.startedAt = null;
    state.progress = 1;
    let visibilityChanged = false;
    for (const [index, effect] of state.effects) {
      if (effect.kind === 'hide') {
        state.chart.setDatasetVisibility(index, false);
        visibilityChanged = true;
      }
    }
    state.effects.clear();
    if (visibilityChanged) state.chart.update('none');
  }

  function progressAt(now, start, duration) {
    if (reducedMotion.matches) return 1;
    return Math.min(Math.max(0, (now - start) / duration), 1);
  }

  function sweepProgress(time) {
    const phase = damping * time;
    return time === 1 ? 1 : (1 - (1 + phase) * Math.exp(-phase)) / dampedEnd;
  }

  function queueFrame(state) {
    if (state.frame) return;
    state.frame = requestAnimationFrame((now) => {
      state.frame = 0;
      if (state.startedAt !== null) {
        const time = progressAt(now, state.startedAt, pageSweepDuration);
        state.progress = sweepProgress(time);
        if (time === 1) state.startedAt = null;
      }
      let visibilityChanged = false;
      for (const [index, effect] of state.effects) {
        const time = progressAt(now, effect.start, effect.kind === 'hide' ? hideDuration : filterSweepDuration);
        if (effect.kind === 'hide') effect.opacity = (1 - time) ** 2;
        else effect.progress = sweepProgress(time);
        if (time < 1) continue;
        state.effects.delete(index);
        if (effect.kind === 'hide') {
          state.chart.setDatasetVisibility(index, false);
          visibilityChanged = true;
        }
      }

      if (visibilityChanged) state.chart.update('none');
      else state.chart.draw();
      if (state.startedAt !== null || state.effects.size) queueFrame(state);
    });
  }

  function startWhenVisible(state) {
    if (reducedMotion.matches || !window.IntersectionObserver) return;
    state.progress = 0;
    state.stopWaiting = whenVisible(state.chart.canvas, () => {
      state.stopWaiting = null;
      state.startedAt = performance.now();
      queueFrame(state);
    });
    if (state.chart.chartArea) state.chart.draw();
  }

  function activate(view) {
    if (view === activeView) return;
    activeView = view;
    if (view === 'today') overview();
    lines.forEach((state) => {
      if (view === 'telemetry') startWhenVisible(state);
      else stopLine(state);
    });
  }

  function toggleSeries(_event, item, legend) {
    const chart = legend.chart;
    const state = lines.get(chart);
    const index = item.datasetIndex;
    if (!state || index == null) return;
    const previous = state.effects.get(index);
    const show = previous?.kind === 'hide' || !chart.isDatasetVisible(index);
    if (reducedMotion.matches) {
      state.effects.delete(index);
      chart.setDatasetVisibility(index, show);
      chart.update('none');
      return;
    }
    const start = performance.now();
    if (show) {
      state.effects.set(index, { kind: 'show', start, progress: 0, opacity: 1 });
      chart.setDatasetVisibility(index, true);
      chart.update('none');
    } else {
      state.effects.set(index, { kind: 'hide', start, progress: previous?.progress ?? 1, opacity: 1 });
    }
    queueFrame(state);
  }

  function clipDatasets(chart, progress, opacity = 1) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return false;
    ctx.save();
    ctx.globalAlpha *= opacity;
    if (progress < 1) {
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.width * progress, chartArea.height);
      ctx.clip();
    }
    return true;
  }

  const linePlugin = {
    id: 'dashboardLineSweep',
    afterInit(chart) {
      const state = { chart, progress: 1, startedAt: null, frame: 0, effects: new Map(), clipped: false };
      lines.set(chart, state);
      if (activeView === 'telemetry') startWhenVisible(state);
    },
    beforeDatasetsDraw(chart) {
      const state = lines.get(chart);
      if (!state || state.progress >= 1 || reducedMotion.matches) return;
      state.pageClipped = clipDatasets(chart, state.progress);
    },
    beforeDatasetDraw(chart, { index }) {
      const state = lines.get(chart);
      if (!state || reducedMotion.matches) return;
      const effect = state.effects.get(index);
      if (effect) state.clipped = clipDatasets(chart, effect.progress, effect.opacity);
    },
    afterDatasetDraw(chart) {
      const state = lines.get(chart);
      if (!state?.clipped) return;
      chart.ctx.restore();
      state.clipped = false;
    },
    afterDatasetsDraw(chart) {
      const state = lines.get(chart);
      if (!state?.pageClipped) return;
      chart.ctx.restore();
      state.pageClipped = false;
    },
    beforeDestroy(chart) {
      const state = lines.get(chart);
      if (!state) return;
      state.stopWaiting?.();
      cancelAnimationFrame(state.frame);
      lines.delete(chart);
    }
  };

  return { activate, overview, linePlugin, toggleSeries };
}
