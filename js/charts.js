// Chart.js render helpers, themed from CSS variables so they track light/dark mode.

(function (global) {
  const F = global.Finalyze;
  const registry = {};
  let last = {}; // remember last data per chart so setTheme() can re-render
  let censored = false; // hide numeric values (axes, tooltips, legends)

  const PALETTE = [
    '#5b5bf0', '#0fae6f', '#f5a524', '#ef4655', '#7c4dff', '#06b6d4',
    '#ec4899', '#0ea5e9', '#14b8a6', '#8b5cf6', '#f97316', '#94a3b8',
  ];

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function theme() {
    return {
      ink: css('--ink') || '#0b1020',
      muted: css('--muted') || '#8a93a8',
      grid: css('--line') || '#e7eaf3',
      surface: css('--surface') || '#fff',
      accent: css('--accent') || '#5b5bf0',
      green: css('--green') || '#0fae6f',
    };
  }

  function applyDefaults() {
    const t = theme();
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.color = t.muted;
    Chart.defaults.borderColor = t.grid;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = t.ink;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { weight: '700' };
    Chart.defaults.plugins.tooltip.boxPadding = 5;
    // Censor mode: hide legends and mask value tooltips across every chart.
    Chart.defaults.plugins.legend.display = !censored;
    Chart.defaults.plugins.tooltip.callbacks = censored
      ? { label: (ctx) => (ctx.dataset && ctx.dataset.label ? ctx.dataset.label + ': ' : '') + '•••' }
      : {};
  }

  function gridScale(beginZero) {
    const t = theme();
    const ticks = { color: t.muted, padding: 8 };
    // The value axis (beginZero) carries $ amounts - mask it when censored.
    if (beginZero && censored) ticks.callback = () => '•';
    return {
      grid: { color: t.grid, drawTicks: false },
      border: { display: false },
      ticks,
      beginAtZero: !!beginZero,
    };
  }

  function draw(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) {
      if (registry[id]) { registry[id].destroy(); delete registry[id]; }
      return;
    }
    if (registry[id]) registry[id].destroy();
    registry[id] = new Chart(canvas.getContext('2d'), config);
  }

  function release(id) {
    const canvas = document.getElementById(id);
    if (canvas) {
      delete canvas.dataset.catClickBound;
      delete canvas.dataset.cmClickBound;
    }
    if (registry[id]) { registry[id].destroy(); delete registry[id]; }
  }

  let onCategoryClick = null;
  let suppressCategoryClickUntil = 0;
  let suppressCardmemberClickUntil = 0;

  function suppressCategoryClick(ms = 120) {
    suppressCategoryClickUntil = performance.now() + ms;
  }
  function suppressCardmemberClick(ms = 120) {
    suppressCardmemberClickUntil = performance.now() + ms;
  }

  function categoryPieSliceAt(els) {
    const rows = last.categoryPie;
    if (!els.length || !rows) return null;
    const idx = els[0].index;
    if (idx < 0 || idx >= rows.length) return null;
    return rows[idx].category;
  }

  function bindCategoryCanvasClick(canvas) {
    if (canvas.dataset.catClickBound) return;
    canvas.dataset.catClickBound = '1';
    canvas.addEventListener('click', (ev) => {
      if (performance.now() < suppressCategoryClickUntil) return;
      const inst = registry['chartCategory'] || (Chart.getChart && Chart.getChart(canvas));
      if (!inst || !onCategoryClick) return;
      const els = inst.getElementsAtEventForMode(ev, 'nearest', { intersect: true }, true);
      const cat = categoryPieSliceAt(els);
      if (cat) onCategoryClick(cat);
    });
  }

  function categoryPie(byCategory, activeCategory) {
    last.categoryPie = byCategory;
    last.categoryActive = activeCategory;
    const canvas = document.getElementById('chartCategory');
    if (!canvas) { release('chartCategory'); return; }

    const t = theme();
    const colors = byCategory.map((c) => c.color || F.categoryColor(c.category));
    const selected = (c) => activeCategory && c.category === activeCategory;
    const bg = byCategory.map((c, i) => (activeCategory && !selected(c)) ? colors[i] + '55' : colors[i]);
    const offset = byCategory.map((c) => (selected(c) ? 14 : 0));
    const borderW = byCategory.map((c) => (selected(c) ? 4 : 2));
    const labels = byCategory.map((c) => c.category);
    const values = byCategory.map((c) => c.spend);

    const inst = registry['chartCategory'];
    if (inst) {
      try {
        inst.data.labels = labels;
        const ds = inst.data.datasets[0];
        ds.data = values;
        ds.backgroundColor = bg;
        ds.offset = offset;
        ds.borderWidth = borderW;
        ds.borderColor = t.surface;
        inst.update('none');
        bindCategoryCanvasClick(canvas);
        return;
      } catch (e) {
        release('chartCategory');
      }
    }

    draw('chartCategory', {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: bg,
          offset,
          borderWidth: borderW,
          borderColor: t.surface,
          hoverOffset: 6,
        }],
      },
      options: {
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right',
            onClick: () => {},
          },
        },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      },
    });
    bindCategoryCanvasClick(canvas);
  }
  function setCategoryClickHandler(fn) { onCategoryClick = fn; }

  function spendLine(series) {
    last.spendLine = series;
    const t = theme();
    draw('chartTrend', {
      type: 'line',
      data: {
        labels: series.map((p) => p.date),
        datasets: [{
          label: 'Daily spend', data: series.map((p) => p.spend),
          borderColor: t.accent, borderWidth: 2,
          backgroundColor: (ctx) => {
            const { ctx: c, chartArea } = ctx.chart;
            if (!chartArea) return 'transparent';
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, t.accent + '44');
            g.addColorStop(1, t.accent + '00');
            return g;
          },
          fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: t.accent,
        }],
      },
      options: { plugins: { legend: { display: false } }, scales: { x: gridScale(), y: gridScale(true) }, interaction: { mode: 'index', intersect: false } },
    });
    last.trendMerchants = null;
    last.trendCategories = null;
  }

  // Alternate view for the Trend widget: spend over time, one line per top
  // merchant. `data` = { labels:[dates], series:[{merchant, data:[…]}] }.
  function trendMerchants(data) {
    last.trendMerchants = data;
    last.spendLine = null;
    last.trendCategories = null;
    const datasets = data.series.map((s, i) => {
      const color = PALETTE[i % PALETTE.length];
      return {
        label: censored ? 'Merchant ' + (i + 1) : s.merchant,
        data: s.data, borderColor: color, backgroundColor: color + '22',
        borderWidth: 2, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, fill: false,
      };
    });
    draw('chartTrend', {
      type: 'line',
      data: { labels: data.labels, datasets },
      options: {
        plugins: { legend: { display: !censored, position: 'bottom' } },
        scales: { x: gridScale(), y: gridScale(true) },
        interaction: { mode: 'index', intersect: false },
      },
    });
  }

  // Top categories over time - same shape as trendMerchants but per category.
  function trendCategories(data) {
    last.trendCategories = data;
    last.spendLine = null;
    last.trendMerchants = null;
    const datasets = data.series.map((s, i) => {
      const color = (F.categoryColor && F.categoryColor(s.category)) || PALETTE[i % PALETTE.length];
      return {
        label: censored ? 'Category ' + (i + 1) : s.category,
        data: s.data, borderColor: color, backgroundColor: color + '22',
        borderWidth: 2, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, fill: false,
      };
    });
    draw('chartTrend', {
      type: 'line',
      data: { labels: data.labels, datasets },
      options: {
        plugins: { legend: { display: !censored, position: 'bottom' } },
        scales: { x: gridScale(), y: gridScale(true) },
        interaction: { mode: 'index', intersect: false },
      },
    });
  }

  // Export with opaque panel background (Chart.js canvas is transparent by default).
  function downloadPng(canvasId, filename, onDone) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      if (onDone) onDone(false);
      return false;
    }
    const inst = Chart.getChart && Chart.getChart(canvas);
    const src = (inst && inst.toBase64Image)
      ? inst.toBase64Image('image/png', 1)
      : canvas.toDataURL('image/png');
    const w = inst ? inst.width : canvas.width;
    const h = inst ? inst.height : canvas.height;
    const bg = css('--surface') || theme().surface || '#ffffff';
    const img = new Image();
    img.onload = () => {
      try {
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const ctx = out.getContext('2d');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const a = document.createElement('a');
        a.href = out.toDataURL('image/png');
        a.download = filename || 'chart.png';
        a.click();
        if (onDone) onDone(true);
      } catch (e) {
        if (onDone) onDone(false);
      }
    };
    img.onerror = () => { if (onDone) onDone(false); };
    img.src = src;
    return true;
  }

  let onMerchantClick = null;
  function merchantBar(byMerchant) {
    last.merchantBar = byMerchant;
    // Censor mode hides WHERE money goes: replace merchant names with placeholders.
    const labels = censored ? byMerchant.map((_, i) => 'Merchant ' + (i + 1)) : byMerchant.map((m) => m.merchant);
    draw('chartMerchant', {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Spend', data: byMerchant.map((m) => m.spend), backgroundColor: theme().accent, borderRadius: 6, maxBarThickness: 18 }],
      },
      options: {
        indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: gridScale(true), y: gridScale() },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        onClick: (e, els) => { if (!els.length || !onMerchantClick) return; onMerchantClick(byMerchant[els[0].index].merchant); },
      },
    });
  }
  function setMerchantClickHandler(fn) { onMerchantClick = fn; }

  // Mini monthly-spend chart for the merchant drill-down modal (draws into a passed canvas).
  function merchantTrend(monthly, canvas) {
    if (!canvas) return;
    const t = theme();
    const existing = Chart.getChart && Chart.getChart(canvas);
    if (existing) existing.destroy();
    new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: monthly.map((m) => m.month),
        datasets: [{ label: 'Spend', data: monthly.map((m) => m.spend), backgroundColor: t.accent, borderRadius: 6, maxBarThickness: 40 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { x: gridScale(), y: gridScale(true) } },
    });
  }

  let onCardmemberClick = null;

  function cardmemberAt(els) {
    const rows = last.cardmemberBar;
    if (!els.length || !rows) return null;
    const idx = els[0].index;
    if (idx < 0 || idx >= rows.length) return null;
    return rows[idx].cardmember;
  }

  function bindCardmemberCanvasClick(canvas) {
    if (canvas.dataset.cmClickBound) return;
    canvas.dataset.cmClickBound = '1';
    canvas.addEventListener('click', (ev) => {
      if (performance.now() < suppressCardmemberClickUntil) return;
      const inst = registry['chartCardmember'] || (Chart.getChart && Chart.getChart(canvas));
      if (!inst || !onCardmemberClick) return;
      const els = inst.getElementsAtEventForMode(ev, 'nearest', { intersect: true }, true);
      const cm = cardmemberAt(els);
      if (cm) onCardmemberClick(cm);
    });
  }

  function cardmemberBar(byCardmember, active) {
    last.cardmemberBar = byCardmember;
    last.cardmemberActive = active;
    const canvas = document.getElementById('chartCardmember');
    if (!canvas) { release('chartCardmember'); return; }

    const colors = byCardmember.map((_, i) => PALETTE[i % PALETTE.length]);
    const bg = byCardmember.map((c, i) => (active && c.cardmember !== active) ? colors[i] + '55' : colors[i]);
    const labels = byCardmember.map((c) => c.cardmember);
    const values = byCardmember.map((c) => c.spend);

    const inst = registry['chartCardmember'];
    if (inst) {
      try {
        inst.data.labels = labels;
        const ds = inst.data.datasets[0];
        ds.data = values;
        ds.backgroundColor = bg;
        inst.update('none');
        bindCardmemberCanvasClick(canvas);
        return;
      } catch (e) {
        release('chartCardmember');
      }
    }

    draw('chartCardmember', {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Spend', data: values, backgroundColor: bg, borderRadius: 8, maxBarThickness: 70 }],
      },
      options: {
        plugins: { legend: { display: false } }, scales: { x: gridScale(), y: gridScale(true) },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      },
    });
    bindCardmemberCanvasClick(canvas);
  }
  function setCardmemberClickHandler(fn) { onCardmemberClick = fn; }

  function momBar(mom) {
    last.momBar = mom;
    const t = theme();
    draw('chartMoM', {
      type: 'bar',
      data: {
        labels: mom.map((m) => m.month),
        datasets: [
          { label: 'Spend', data: mom.map((m) => m.spend), backgroundColor: t.accent, borderRadius: 6, maxBarThickness: 46 },
          { label: 'Refunds', data: mom.map((m) => m.refunds), backgroundColor: t.green, borderRadius: 6, maxBarThickness: 46 },
          { label: 'Payments', data: mom.map((m) => m.payments), backgroundColor: '#0ea5e9', borderRadius: 6, maxBarThickness: 46 },
        ],
      },
      options: { scales: { x: gridScale(), y: gridScale(true) } },
    });
  }

  function budgetActual(rows) {
    last.budgetActual = rows;
    const t = theme();
    draw('chartBudgetActual', {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.cat),
        datasets: [
          { label: 'Actual', data: rows.map((r) => r.spent), backgroundColor: t.accent, borderRadius: 6, maxBarThickness: 28 },
          { label: 'Budget', data: rows.map((r) => r.budget), backgroundColor: t.muted + '66', borderRadius: 6, maxBarThickness: 28 },
        ],
      },
      options: {
        indexAxis: 'y',
        scales: { x: gridScale(true), y: gridScale() },
      },
    });
  }

  // Re-apply defaults and redraw every chart with its last data (called on theme toggle).
  function spendingPatterns(dow, wom) {
    last.spendingPatterns = { dow, wom };
    const t = theme();
    draw('chartDow', {
      type: 'bar',
      data: {
        labels: dow.map((d) => d.label),
        datasets: [{ label: 'Spend', data: dow.map((d) => d.spend), backgroundColor: t.accent, borderRadius: 6, maxBarThickness: 36 }],
      },
      options: {
        plugins: { legend: { display: false }, title: { display: true, text: 'By day of week', color: t.muted, font: { size: 12, weight: '600' } } },
        scales: { x: gridScale(), y: gridScale(true) },
      },
    });
    draw('chartWom', {
      type: 'bar',
      data: {
        labels: wom.map((w) => w.label),
        datasets: [{ label: 'Spend', data: wom.map((w) => w.spend), backgroundColor: t.green, borderRadius: 6, maxBarThickness: 36 }],
      },
      options: {
        plugins: { legend: { display: false }, title: { display: true, text: 'By week of month', color: t.muted, font: { size: 12, weight: '600' } } },
        scales: { x: gridScale(), y: gridScale(true) },
      },
    });
  }

  function setTheme() {
    applyDefaults();
    if (last.categoryPie) categoryPie(last.categoryPie, last.categoryActive);
    if (last.spendLine) spendLine(last.spendLine);
    if (last.trendMerchants) trendMerchants(last.trendMerchants);
    if (last.trendCategories) trendCategories(last.trendCategories);
    if (last.merchantBar) merchantBar(last.merchantBar);
    if (last.cardmemberBar) cardmemberBar(last.cardmemberBar, last.cardmemberActive);
    if (last.momBar) momBar(last.momBar);
    if (last.budgetActual) budgetActual(last.budgetActual);
    if (last.spendingPatterns) spendingPatterns(last.spendingPatterns.dow, last.spendingPatterns.wom);
  }
  // Toggle censor mode; re-applies defaults and redraws all charts.
  function setCensor(on) { censored = !!on; setTheme(); }

  applyDefaults();

  global.Finalyze = global.Finalyze || {};
  global.Finalyze.charts = {
    categoryPie, spendLine, trendMerchants, trendCategories, downloadPng,
    merchantBar, cardmemberBar, momBar, budgetActual, spendingPatterns, merchantTrend,
    setTheme, setCensor, setCategoryClickHandler, setCardmemberClickHandler, setMerchantClickHandler,
    suppressCategoryClick, suppressCardmemberClick, release, PALETTE,
  };
})(window);
