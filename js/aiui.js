// Finalyze - AI control surface. Wires the opt-in Phase 2 (categorization) and
// Phase 3 (insights + chat) features into a single modal opened from the sidebar.
// Self-contained; if the AI modules aren't present it simply does nothing.

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const AICat = F.AICat, AIChat = F.AIChat;
  const esc = (s) => F.escapeHtml(s);
  const $ = (s, r = document) => r.querySelector(s);

  let overlay = null, tab = 'insights';
  const chatLog = []; // {role, content}
  let autoRestoreDone = false;

  function shell() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'ai-modal';
    overlay.innerHTML = `
      <div class="ai-backdrop"></div>
      <div class="ai-panel" role="dialog" aria-modal="true">
        <div class="ai-tabs">
          <div class="ai-brand">Finalyze AI</div>
          <button data-tab="insights">Insights</button>
          <button data-tab="chat">Chat</button>
          <button data-tab="categorize">Auto-categorize</button>
          <button data-tab="models">Models</button>
          <button class="ai-close" title="Close">×</button>
        </div>
        <div class="ai-body" id="aiBody"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.ai-backdrop').onclick = close;
    overlay.querySelector('.ai-close').onclick = close;
    overlay.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; renderTab(); });
    return overlay;
  }
  function open(which) {
    shell();
    tab = which || tab;
    overlay.classList.add('open');
    document.body.classList.add('modal-open');
    renderTab();
    autoRestoreModels(true);
  }
  function close() { if (overlay) overlay.classList.remove('open'); document.body.classList.remove('modal-open'); }

  function renderTab() {
    shell().querySelectorAll('.ai-tabs [data-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
      const proTab = b.dataset.tab === 'chat' || b.dataset.tab === 'categorize';
      b.classList.toggle('pro-tab', proTab && F.isPro && !F.isPro());
    });
    const body = $('#aiBody');
    body.classList.toggle('ai-chat-pane', tab === 'chat');
    if (tab === 'insights') renderInsights(body);
    else if (tab === 'chat') renderChat(body);
    else if (tab === 'categorize') renderCategorize(body);
    else renderModels(body);
  }

  function scrollChatToBottom() {
    requestAnimationFrame(() => {
      const log = $('#aiChatLog');
      if (!log) return;
      log.scrollTop = log.scrollHeight;
    });
  }

  function focusChatInput() {
    requestAnimationFrame(() => {
      const inp = $('#aiChatInput');
      if (inp && !inp.disabled) inp.focus();
    });
  }

  // ---- Insights ----
  function renderInsights(body) {
    const local = AIChat ? AIChat.localInsights() : ['AI module not loaded.'];
    const pro = !F.isPro || F.isPro();
    body.innerHTML = `
      <div class="ai-head"><h3>Insights</h3>
        <button class="btn sm" id="aiGenInsights">${pro && AIChat && AIChat.ready() ? 'Regenerate with AI' : 'Generate with AI'}</button>
      </div>
      <ul class="ai-insights">${local.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      <div class="ai-narrative" id="aiNarrative">${pro ? '' : '<p class="muted">Upgrade to Pro for AI-generated narrative insights.</p>'}</div>`;
    const genBtn = $('#aiGenInsights');
    if (!pro) {
      if (genBtn) genBtn.onclick = () => F.requirePro && F.requirePro('AI insights');
      return;
    }
    genBtn.onclick = async () => {
      const out = $('#aiNarrative');
      if (!AIChat || !AIChat.ready()) { tab = 'models'; renderTab(); F.toast && F.toast('Enable the chat model first'); return; }
      out.textContent = '…'; out.classList.add('streaming');
      try { await AIChat.insights((tok, full) => { out.textContent = full; }); }
      catch (e) { out.textContent = 'Could not generate: ' + e.message; }
      out.classList.remove('streaming');
    };
  }

  // ---- Chat ----
  function renderChat(body) {
    if (F.isPro && !F.isPro()) {
      body.innerHTML = `<div class="ai-head"><h3>Chat</h3></div><div class="ai-empty">Ask about your recorded spending - e.g. “how much did I spend on coffee?” or “what changed from last month?”</div>`;
      F.applyProLock && F.applyProLock(body, 'AI chat');
      return;
    }
    const ready = AIChat && AIChat.ready();
    const hasData = !!(F.enriched && F.enriched().length);
    const canType = ready || hasData; // deterministic answers work without a model
    body.innerHTML = `
      <div class="ai-head"><h3>Chat</h3>
        <button class="btn sm" id="aiClear" ${chatLog.length ? '' : 'disabled'}>Clear chat</button>
      </div>
      <div class="ai-chat-log" id="aiChatLog">${chatLog.map((m, i) => msgHtml(m, i)).join('') || '<div class="ai-empty">Ask about your recorded spending - e.g. “how much did I spend on coffee?”, “what changed from last month?”, “which subscriptions cost the most?”, “what are my top merchants?”' + (ready ? '' : '<br><span class="muted">Common questions answer instantly; enable a model under Models for free-form chat.</span>') + '</div>'}</div>
      <form class="ai-chat-form" id="aiChatForm">
        <input id="aiChatInput" placeholder="${canType ? 'Ask your data…' : 'Import data or enable a model →'}" ${canType ? '' : 'disabled'} autocomplete="off" />
        <button class="btn primary" ${canType ? '' : 'disabled'}>Send</button>
      </form>`;
    const clr = $('#aiClear');
    if (clr) clr.onclick = () => { chatLog.length = 0; renderChat(body); };
    scrollChatToBottom();
    $('#aiChatForm').onsubmit = async (e) => {
      e.preventDefault();
      const inp = $('#aiChatInput'); const q = inp.value.trim(); if (!q) return;
      inp.value = ''; chatLog.push({ role: 'user', content: q });
      const aId = chatLog.push({ role: 'assistant', content: '…' }) - 1;
      renderChat(body);
      scrollChatToBottom();

      // Deterministic query layer answers the common questions instantly and
      // reliably (no refusal), with or without a model loaded.
      let local = null;
      try { local = AIChat.localAnswer ? AIChat.localAnswer(q) : null; } catch (e) { /* fall through */ }
      if (local) {
        chatLog[aId].content = local;
        renderChat(body);
        scrollChatToBottom();
        focusChatInput();
        return;
      }
      if (!AIChat.ready()) {
        chatLog[aId].content = 'I can answer about a specific category or merchant, your subscriptions, top merchants, cardmember split, or what changed month-to-month. For open-ended questions, enable a chat model under Models.';
        renderChat(body);
        focusChatInput();
        return;
      }
      try {
        await AIChat.ask(q, (tok, full) => {
          chatLog[aId].content = full;
          const log = $('#aiChatLog');
          const el = log && log.querySelector(`[data-msg-idx="${aId}"] .ai-msg-text`);
          if (el) el.textContent = full;
          scrollChatToBottom();
        });
        renderChat(body); // re-render to apply light formatting to the final answer
        scrollChatToBottom();
        focusChatInput();
      } catch (err) {
        chatLog[aId].content = 'Error: ' + err.message;
        renderChat(body);
        focusChatInput();
      }
    };
  }
  // Light structure for assistant answers: bold currency amounts and break a
  // numbered list (e.g. top merchants "1. … ; 2. …") onto separate lines.
  function formatMsg(content, role) {
    let html = esc(content);
    if (role !== 'user') {
      html = html.replace(/(-?\b[A-Z]{2,3}\s?\$?\d[\d,]*(?:\.\d+)?|-?\$\d[\d,]*(?:\.\d+)?)/g, '<b>$1</b>');
      html = html.replace(/;\s*(?=\d+\.\s)/g, '<br>');
    }
    return html;
  }
  function msgHtml(m, i) {
    return `<div class="ai-msg ${m.role}" data-msg-idx="${i}"><span class="ai-msg-text">${formatMsg(m.content, m.role)}</span></div>`;
  }

  // ---- Auto-categorize ----
  function renderCategorize(body) {
    if (F.isPro && !F.isPro()) {
      body.innerHTML = `<div class="ai-head"><h3>Auto-categorize</h3></div><p class="muted">Use AI to suggest categories for uncategorized merchants based on your spending patterns.</p>`;
      F.applyProLock && F.applyProLock(body, 'AI auto-categorize');
      return;
    }
    const work = AICat ? AICat.uncategorizedMerchants() : [];
    body.innerHTML = `
      <div class="ai-head"><h3>Auto-categorize</h3>
        <button class="btn sm" id="aiSuggest" ${work.length ? '' : 'disabled'}>Suggest with AI</button>
      </div>
      <p class="muted">${work.length ? work.length + ' uncategorized merchant(s) in “Other”. AI suggests a category from your past corrections and category meanings; review before applying.' : 'Nothing uncategorized - you’re all caught up.'}</p>
      <div id="aiSuggestOut"></div>`;
    const out = $('#aiSuggestOut');
    $('#aiSuggest') && ($('#aiSuggest').onclick = async () => {
      if (!AICat.ready()) { tab = 'models'; renderTab(); F.toast && F.toast('Enable the categorization model first'); return; }
      out.innerHTML = '<p class="muted">Thinking…</p>';
      let sugg;
      try { sugg = await AICat.suggestUncategorized(); }
      catch (e) { out.innerHTML = '<p class="ai-err">' + esc(e.message) + '</p>'; return; }
      if (!sugg.length) { out.innerHTML = '<p class="muted">No suggestions.</p>'; return; }
      const cats = F.getCategories();
      out.innerHTML = `
        <div class="ai-sugg-head"><button class="btn sm primary" id="aiApplyAll">Apply all</button></div>
        <div class="table-wrap"><table class="ai-sugg-table"><thead><tr><th>Merchant</th><th>Suggested</th><th class="num">Spend</th><th>Confidence</th><th></th></tr></thead><tbody>${
          sugg.map((s, i) => `<tr data-key="${esc(encodeURIComponent(s.key))}" data-i="${i}">
            <td>${esc(s.name)}</td>
            <td><select class="ai-cat">${cats.map((c) => `<option${c === s.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
            <td class="num">${F.Store.currency()} ${Math.round(s.spend)}</td>
            <td><span class="ai-conf" style="--c:${Math.round(s.score * 100)}%">${Math.round(s.score * 100)}%</span></td>
            <td><button class="btn sm ai-apply">Apply</button></td></tr>`).join('')
        }</tbody></table></div>`;
      const applyRow = (tr) => {
        const key = decodeURIComponent(tr.dataset.key);
        const cat = tr.querySelector('.ai-cat').value;
        F.Store.setOverride(key, cat); tr.remove();
      };
      out.querySelectorAll('.ai-apply').forEach((b) => b.onclick = () => { applyRow(b.closest('tr')); F.render && F.render(); });
      $('#aiApplyAll').onclick = () => { out.querySelectorAll('tbody tr').forEach(applyRow); F.render && F.render(); F.toast && F.toast('Categories applied', { check: true }); renderCategorize(body); };
    });
  }

  // ---- Models (opt-in downloads) ----
  function chatModelChoices() {
    if (!AIChat || !AIChat.models) return '';
    const selected = AIChat.selectedModelKey();
    const active = AIChat.activeModelKey();
    const loaded = AIChat.ready();
    const pendingSpec = AIChat.models()[selected];
    return Object.values(AIChat.models()).map((m) => {
      const on = selected === m.id;
      const isLoaded = loaded && active === m.id;
      return `<label class="ai-chat-tier${on ? ' on' : ''}${isLoaded ? ' loaded' : ''}">
        <input type="radio" name="aiChatTier" value="${m.id}" ${on ? 'checked' : ''} />
        <span class="ai-chat-tier-body">
          <strong>${esc(m.label)}</strong> · ${esc(m.size)}
          <span class="muted">${esc(m.desc)}</span>
          ${isLoaded ? '<span class="ai-chat-tier-badge">Loaded</span>' : ''}
        </span>
      </label>`;
    }).join('');
  }

  function renderModels(body) {
    const catReady = AICat && AICat.ready();
    const chatReady = AIChat && AIChat.ready();
    const chatActive = AIChat && AIChat.activeModelKey();
    const chatSpec = chatActive && AIChat.models()[chatActive];
    const selected = AIChat ? AIChat.selectedModelKey() : 'standard';
    const pendingSpec = AIChat && AIChat.models()[selected];
    body.innerHTML = `
      <div class="ai-head"><h3>On-device AI models</h3></div>
      <p class="muted">Models download once and run entirely in your browser. Your transactions are never sent anywhere. Chat uses one tier at a time (Standard or Enhanced); categorization can run at the same time.</p>
      <div class="ai-model" id="aiModelCat">
        <div><strong>Categorization</strong> · ~30 MB<div class="muted">Suggests categories for uncategorized merchants.</div></div>
        <div class="ai-model-actions">
          <button class="btn" id="aiEnableCat">${catReady ? 'Enabled ✓' : 'Download & enable'}</button>
          ${catReady ? '<button class="btn ghost sm" id="aiUnloadCat">Unload</button>' : ''}
        </div>
        <div class="ai-prog" id="aiProgCat"></div>
      </div>
      <div class="ai-model ai-model-chat" id="aiModelChat">
        <div><strong>Insights &amp; chat</strong> · WebGPU required<div class="muted">Plain-English insights and ask-your-data chat with a detailed local spending summary.</div></div>
        <div class="ai-chat-tiers">${chatModelChoices()}</div>
        <div class="ai-model-actions">
          <button class="btn" id="aiEnableChat" ${AIChat && AIChat.webgpu() ? '' : 'disabled'}>${chatReady ? 'Enabled ✓' : (AIChat && AIChat.webgpu() ? 'Download & enable' : 'No WebGPU')}</button>
          ${chatReady && selected !== chatActive && pendingSpec ? `<button class="btn sm" id="aiSwitchChat">Switch to ${esc(pendingSpec.label)}</button>` : ''}
          ${chatReady ? '<button class="btn ghost sm" id="aiUnloadChat">Unload</button>' : ''}
        </div>
        <div class="ai-prog" id="aiProgChat">${chatReady && chatSpec ? esc(chatSpec.label + ' model ready') : ''}</div>
      </div>`;

    body.querySelectorAll('input[name="aiChatTier"]').forEach((inp) => {
      inp.onchange = () => {
        if (!inp.checked) return;
        AIChat.setSelectedModelKey(inp.value);
        renderModels(body);
      };
    });

    const cb = $('#aiEnableCat');
    cb && (cb.onclick = async () => {
      if (catReady) return;
      cb.disabled = true; const p = $('#aiProgCat');
      try {
        await AICat.enable((pr) => { p.textContent = pr && pr.status ? (pr.status + (pr.progress ? ' ' + Math.round(pr.progress * 100) + '%' : '')) : 'loading…'; });
        p.textContent = 'Ready'; renderModels(body);
      } catch (e) { p.textContent = 'Failed: ' + e.message; cb.disabled = false; }
    });
    const uc = $('#aiUnloadCat');
    uc && (uc.onclick = async () => {
      await AICat.unload();
      F.toast && F.toast('Categorization model unloaded');
      renderModels(body);
    });

    const hb = $('#aiEnableChat');
    hb && !hb.disabled && (hb.onclick = async () => {
      if (chatReady) return;
      hb.disabled = true; const p = $('#aiProgChat');
      try {
        await AIChat.enable((r) => { p.textContent = r && r.text ? r.text : ('loading ' + Math.round((r && r.progress || 0) * 100) + '%'); });
        const spec = AIChat.models()[AIChat.activeModelKey()];
        p.textContent = spec ? spec.label + ' model ready' : 'Ready';
        renderModels(body);
      } catch (e) { p.textContent = 'Failed: ' + e.message; hb.disabled = false; }
    });
    const uchat = $('#aiUnloadChat');
    uchat && (uchat.onclick = async () => {
      await AIChat.unload();
      F.toast && F.toast('Chat model unloaded');
      renderModels(body);
    });
    const sw = $('#aiSwitchChat');
    sw && (sw.onclick = async () => {
      sw.disabled = true; const p = $('#aiProgChat');
      p.textContent = 'Switching model…';
      try {
        await AIChat.enable((r) => { p.textContent = r && r.text ? r.text : ('loading ' + Math.round((r && r.progress || 0) * 100) + '%'); });
        const spec = AIChat.models()[AIChat.activeModelKey()];
        p.textContent = spec ? spec.label + ' model ready' : 'Ready';
        F.toast && F.toast('Chat model switched');
        renderModels(body);
      } catch (e) { p.textContent = 'Failed: ' + e.message; sw.disabled = false; }
    });
  }

  function resetAutoRestore() { autoRestoreDone = false; }

  async function autoRestoreModels(fromOpen) {
    if (F.isPro && !F.isPro()) return;
    if (autoRestoreDone && !fromOpen) return;

    const needCat = AICat?.wantsAutoEnable?.() && !AICat.ready();
    const needChat = AIChat?.wantsAutoEnable?.() && AIChat.webgpu?.() && !AIChat.ready();
    if (!needCat && !needChat) {
      if (!fromOpen) autoRestoreDone = true;
      return;
    }

    try {
      if (needCat) await AICat.enable();
      if (needChat) await AIChat.enable();
      autoRestoreDone = true;
      if (overlay && overlay.classList.contains('open')) {
        const body = $('#aiBody');
        if (body && tab === 'models') renderModels(body);
        else if (body && tab === 'chat') renderChat(body);
      }
    } catch (e) {
      console.warn('[Finalyze AI] auto-restore failed:', e);
      if (!fromOpen) autoRestoreDone = false;
    }
  }

  function init() {
    const slot = $('#aiSlot');
    if (!slot) return;
    slot.innerHTML = `<button class="btn ghost" id="aiBtn" title="Finalyze AI" style="width:100%">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z"/><path d="M19 14l.7 1.8L21.5 16l-1.8.7L19 18l-.7-1.3L16.5 16l1.8-.2L19 14z"/></svg>
      Finalyze AI</button>`;
    $('#aiBtn').onclick = () => open('insights');
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  F.AIUI = { open, close, autoRestoreModels, resetAutoRestore };
  document.addEventListener('DOMContentLoaded', init);
})(window);
