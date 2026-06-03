// Export the current dashboard view to a multi-page PDF (client-side only).
// Widgets are captured individually and stacked onto pages (flowing layout, never split).

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});

  const HTML2CANVAS = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  const JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
  const WIDGET_GAP = 12;

  let libsReady = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function ensureLibs() {
    if (!libsReady) {
      libsReady = loadScript(HTML2CANVAS)
        .then(() => loadScript(JSPDF))
        .then(() => {
          if (!global.html2canvas || !global.jspdf) throw new Error('PDF libraries unavailable');
        });
    }
    return libsReady;
  }

  function pageBackground() {
    return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
  }

  function hexToRgb(hex) {
    let h = String(hex || '#ffffff').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return { r: 255, g: 255, b: 255 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function fillPdfPage(pdf, rgb) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    pdf.setFillColor(rgb.r, rgb.g, rgb.b);
    pdf.rect(0, 0, pageW, pageH, 'F');
  }

  function sortedWidgetItems(container) {
    return [...container.querySelectorAll('.grid-stack-item')].sort((a, b) => {
      const dy = (+a.getAttribute('gs-y') || 0) - (+b.getAttribute('gs-y') || 0);
      if (dy !== 0) return dy;
      return (+a.getAttribute('gs-x') || 0) - (+b.getAttribute('gs-x') || 0);
    });
  }

  function resolveExportItems(widgets, opts) {
    opts = opts || {};
    const ids = opts.widgetIds;
    if (Array.isArray(ids) && ids.length) {
      return ids
        .map((id) => widgets.querySelector(`.grid-stack-item[gs-id="${CSS.escape(String(id))}"]`))
        .filter(Boolean);
    }
    return sortedWidgetItems(widgets);
  }

  function stripChrome(root) {
    root.querySelectorAll(
      '.widget-dl, .widget-hide, .drag-handle, .ui-resizable-handle, .grid-stack-item-resize-handle'
    ).forEach((el) => el.remove());
  }

  function prepareWidgetItem(item) {
    item.style.position = 'relative';
    item.style.inset = 'auto';
    item.style.transform = 'none';
    item.style.left = '0';
    item.style.top = 'auto';
    item.style.width = '100%';
    item.style.margin = '0';
    item.style.height = 'auto';
    const content = item.querySelector('.grid-stack-item-content');
    if (content) {
      content.style.height = 'auto';
      content.style.overflow = 'visible';
    }
  }

  function expandContent(root) {
    root.querySelectorAll('.widget-body, .table-wrap, .canvas-wrap, .patterns-grid, #heatmapGrid').forEach((el) => {
      el.style.overflow = 'visible';
      el.style.height = 'auto';
      el.style.maxHeight = 'none';
      el.style.flex = 'none';
    });
    // The live summary grid carries an inline column count sized to the on-screen
    // window; reset it so it reflows to the (narrower) capture width instead.
    root.querySelectorAll('.cards').forEach((el) => {
      el.style.gridTemplateColumns = 'repeat(auto-fit, minmax(190px, 1fr))';
    });
    // html2canvas renders soft box-shadows as hard squares behind rounded corners,
    // leaving ugly notches on every card; drop all shadows for a clean capture.
    root.querySelectorAll('*').forEach((el) => {
      if (el.style) el.style.boxShadow = 'none';
    });
    root.querySelectorAll('.grid-stack-item').forEach((item) => {
      const inner = item.querySelector('.widget');
      if (!inner) return;
      item.style.height = 'auto';
      const h = inner.offsetHeight + 8;
      if (h > 40) item.style.minHeight = h + 'px';
    });
  }

  function injectChartImages(source, clone) {
    if (!global.Chart) return Promise.resolve();
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff';
    const jobs = [];
    source.querySelectorAll('.grid-stack-item').forEach((item) => {
      const gsId = item.getAttribute('gs-id');
      if (!gsId) return;
      const cloneItem = clone.querySelector(`.grid-stack-item[gs-id="${CSS.escape(gsId)}"]`);
      if (!cloneItem) return;
      const origCanvases = item.querySelectorAll('canvas');
      const cloneCanvases = cloneItem.querySelectorAll('canvas');
      origCanvases.forEach((orig, i) => {
        const target = cloneCanvases[i];
        if (!target) return;
        const inst = Chart.getChart(orig);
        if (!inst) return;
        jobs.push(new Promise((resolve) => {
          const w = orig.clientWidth || orig.width;
          const h = orig.clientHeight || orig.height;
          const img = new Image();
          img.onload = () => {
            const out = document.createElement('canvas');
            out.width = w;
            out.height = h;
            const ctx = out.getContext('2d');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const imgEl = document.createElement('img');
            imgEl.src = out.toDataURL('image/png');
            imgEl.style.width = '100%';
            imgEl.style.height = 'auto';
            imgEl.style.display = 'block';
            imgEl.alt = '';
            target.replaceWith(imgEl);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = inst.toBase64Image('image/png', 1);
        }));
      });
    });
    return Promise.all(jobs);
  }

  function makeCaptureRoot(width, bg) {
    const root = document.createElement('div');
    root.className = 'pdf-export-root';
    root.style.cssText =
      `position:fixed;left:-12000px;top:0;width:${width}px;background:${bg};` +
      'padding:0;box-sizing:border-box;color:var(--ink,#111);';
    return root;
  }

  function applyPdfTheme(root, bg) {
    root.style.background = bg;
    root.style.setProperty('--bg', bg);
  }

  async function captureNode(node, scale, bg) {
    return global.html2canvas(node, {
      scale,
      backgroundColor: bg,
      logging: false,
      useCORS: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: node.scrollWidth,
      windowHeight: node.scrollHeight,
    });
  }

  function canvasToJpeg(canvas) {
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  function createComposer(pdf, margin, bgHex) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const contentW = pageW - margin * 2;
    const contentH = pageH - margin * 2;
    const pageBg = hexToRgb(bgHex);
    let y = margin;

    fillPdfPage(pdf, pageBg);

    function startNewPage() {
      pdf.addPage();
      fillPdfPage(pdf, pageBg);
      y = margin;
    }

    function addCanvas(canvas, gapAfter) {
      const gap = gapAfter == null ? WIDGET_GAP : gapAfter;
      const imgData = canvasToJpeg(canvas);
      const aspect = canvas.height / canvas.width;
      let drawW = contentW;
      let drawH = drawW * aspect;

      if (drawH > contentH) {
        if (y > margin + 4) startNewPage();
        else y = margin;
        drawH = contentH;
        drawW = drawH / aspect;
        const x = margin + (contentW - drawW) / 2;
        pdf.addImage(imgData, 'JPEG', x, y, drawW, drawH);
        y = margin + contentH + gap;
        return;
      }

      if (y + drawH > margin + contentH) startNewPage();

      pdf.addImage(imgData, 'JPEG', margin, y, drawW, drawH);
      y += drawH + gap;
    }

    return { addCanvas, margin, contentW };
  }

  async function exportDashboardPdf(opts) {
    opts = opts || {};
    const dashboard = document.getElementById('dashboard');
    const widgets = document.getElementById('widgets');
    if (!dashboard || dashboard.hidden || !widgets || !widgets.children.length) {
      F.toast && F.toast('Open the dashboard with data to export');
      return;
    }

    const items = resolveExportItems(widgets, opts);
    if (!items.length) {
      F.toast && F.toast('Select at least one section to export');
      return;
    }

    const btn = document.getElementById('exportPdfBtn');
    const prevLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }

    const roots = [];
    try {
      await ensureLibs();
      const bg = pageBackground();
      const scale = Math.min(2, global.devicePixelRatio || 1.5);
      const width = Math.min(widgets.offsetWidth, 920);
      const titleEl = document.querySelector('.page-head h1');
      const subEl = document.getElementById('rangeSub');
      const title = titleEl ? titleEl.textContent : 'Spending overview';
      const meta = subEl ? subEl.textContent : '';

      const headRoot = makeCaptureRoot(width, bg);
      applyPdfTheme(headRoot, bg);
      headRoot.style.padding = '28px 24px 18px';
      const head = document.createElement('div');
      head.className = 'pdf-export-head';
      head.innerHTML =
        `<div class="pdf-export-title">${F.escapeHtml ? F.escapeHtml(title) : title}</div>` +
        (meta ? `<div class="pdf-export-meta">${F.escapeHtml ? F.escapeHtml(meta) : meta}</div>` : '') +
        `<div class="pdf-export-meta">Generated ${new Date().toLocaleString()}</div>`;
      headRoot.appendChild(head);
      document.body.appendChild(headRoot);
      roots.push(headRoot);

      const { jsPDF } = global.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const composer = createComposer(pdf, 36, bg);

      const headCanvas = await captureNode(headRoot, scale, bg);
      composer.addCanvas(headCanvas, 16);

      for (const item of items) {
        const root = makeCaptureRoot(width, bg);
        applyPdfTheme(root, bg);
        root.style.padding = '0 24px';
        const clone = item.cloneNode(true);
        prepareWidgetItem(clone);
        stripChrome(clone);
        root.appendChild(clone);
        document.body.appendChild(root);
        roots.push(root);

        await injectChartImages(widgets, root);
        expandContent(root);

        const canvas = await captureNode(root, scale, bg);
        composer.addCanvas(canvas);
      }

      pdf.save(`finalyze-dashboard-${new Date().toISOString().slice(0, 10)}.pdf`);
      F.toast && F.toast('Dashboard PDF downloaded', { check: true });
    } catch (e) {
      F.toast && F.toast('Could not export PDF: ' + (e.message || 'unknown error'));
    } finally {
      roots.forEach((r) => { if (r.parentNode) r.parentNode.removeChild(r); });
      if (btn) { btn.disabled = false; btn.textContent = prevLabel || 'Export PDF'; }
    }
  }

  F.exportDashboardPdf = exportDashboardPdf;
})(window);
