// Finalyze — AI control surface. Wires the opt-in Phase 2 (categorization) and
// Phase 3 (insights + chat) features into a single modal opened from the sidebar.
// Self-contained; if the AI modules aren't present it simply does nothing.

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const AICat = F.AICat, AIChat = F.AIChat;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let overlay = null, tab = 'insights';
  const chatLog = []; // {role, content}

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
  function open(which) { shell(); tab = which || tab; overlay.classList.add('open'); document.body.classList.add('modal-open'); renderTab(); }
  function close() { if (overlay) overlay.classList.remove('open'); document.body.classList.remove('modal-open'); }

  function renderTab() {
    shell().querySelectorAll('.ai-tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const body = $('#aiBody');
    if (tab === 'insights') renderInsights(body);
    else if (tab === 'chat') renderChat(body);
    else if (tab === 'categorize') renderCategorize(body);
    else renderModels(body);
  }

  // ---- Insights ----
  function renderInsights(body) {
    const local = AIChat ? AIChat.localInsights() : ['AI module not loaded.'];
    body.innerHTML = `
      <div class="ai-head"><h3>Insights</h3>
        <button class="btn sm" id="aiGenInsights">${AIChat && AIChat.ready() ? 'Regenerate with AI' : 'Generate with AI'}</button>
      </div>
      <ul class="ai-insights">${local.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      <div class="ai-narrative" id="aiNarrative"></div>`;
    $('#aiGenInsights').onclick = async () => {
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
    const enabled = AIChat && AIChat.ready();
    body.innerHTML = `
      <div class="ai-chat-log" id="aiChatLog">${chatLog.map(msgHtml).join('') || '<div class="ai-empty">Ask anything about your spending — e.g. “how much did I spend on coffee?”, “what changed from last month?”, “can I afford a $60k car?”</div>'}</div>
      <form class="ai-chat-form" id="aiChatForm">
        <input id="aiChatInput" placeholder="${enabled ? 'Ask your data…' : 'Enable the chat model in Models →'}" ${enabled ? '' : 'disabled'} autocomplete="off" />
        <button class="btn primary" ${enabled ? '' : 'disabled'}>Send</button>
      </form>`;
    const log = $('#aiChatLog');
    log.scrollTop = log.scrollHeight;
    $('#aiChatForm').onsubmit = async (e) => {
      e.preventDefault();
      const inp = $('#aiChatInput'); const q = inp.value.trim(); if (!q) return;
      inp.value = ''; chatLog.push({ role: 'user', content: q });
      const aId = chatLog.push({ role: 'assistant', content: '…' }) - 1;
      renderChat(body);
      try { await AIChat.ask(q, (tok, full) => { chatLog[aId].content = full; const l = $('#aiChatLog'); if (l) { l.children[aId] && (l.children[aId].querySelector('.ai-msg-text').textContent = full); l.scrollTop = l.scrollHeight; } }); }
      catch (err) { chatLog[aId].content = 'Error: ' + err.message; renderChat(body); }
    };
  }
  function msgHtml(m) { return `<div class="ai-msg ${m.role}"><span class="ai-msg-text">${esc(m.content)}</span></div>`; }

  // ---- Auto-categorize ----
  function renderCategorize(body) {
    const work = AICat ? AICat.uncategorizedMerchants() : [];
    body.innerHTML = `
      <div class="ai-head"><h3>Auto-categorize</h3>
        <button class="btn sm" id="aiSuggest" ${work.length ? '' : 'disabled'}>Suggest with AI</button>
      </div>
      <p class="muted">${work.length ? work.length + ' uncategorized merchant(s) in “Other”. AI suggests a category from your past corrections and category meanings; review before applying.' : 'Nothing uncategorized — you’re all caught up.'}</p>
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
      $('#aiApplyAll').onclick = () => { out.querySelectorAll('tbody tr').forEach(applyRow); F.render && F.render(); F.toast && F.toast('Categories applied'); renderCategorize(body); };
    });
  }

  // ---- Models (opt-in downloads) ----
  function renderModels(body) {
    body.innerHTML = `
      <div class="ai-head"><h3>On-device AI models</h3></div>
      <p class="muted">Models download once and run entirely in your browser. Your transactions are never sent anywhere. Downloading requires a network connection; after that it works offline.</p>
      <div class="ai-model" id="aiModelCat">
        <div><strong>Categorization</strong> · ~30 MB<div class="muted">Suggests categories for uncategorized merchants.</div></div>
        <button class="btn" id="aiEnableCat">${AICat && AICat.ready() ? 'Enabled ✓' : 'Download & enable'}</button>
        <div class="ai-prog" id="aiProgCat"></div>
      </div>
      <div class="ai-model" id="aiModelChat">
        <div><strong>Insights &amp; chat</strong> · ~0.8–1.2 GB · needs WebGPU<div class="muted">Plain-English insights and ask-your-data chat.</div></div>
        <button class="btn" id="aiEnableChat" ${AIChat && AIChat.webgpu() ? '' : 'disabled'}>${AIChat && AIChat.ready() ? 'Enabled ✓' : (AIChat && AIChat.webgpu() ? 'Download & enable' : 'No WebGPU')}</button>
        <div class="ai-prog" id="aiProgChat"></div>
      </div>`;
    const cb = $('#aiEnableCat');
    cb && (cb.onclick = async () => {
      cb.disabled = true; const p = $('#aiProgCat');
      try { await AICat.enable((pr) => { p.textContent = pr && pr.status ? (pr.status + (pr.progress ? ' ' + Math.round(pr.progress * 100) + '%' : '')) : 'loading…'; }); p.textContent = 'Ready'; cb.textContent = 'Enabled ✓'; }
      catch (e) { p.textContent = 'Failed: ' + e.message; cb.disabled = false; }
    });
    const hb = $('#aiEnableChat');
    hb && !hb.disabled && (hb.onclick = async () => {
      hb.disabled = true; const p = $('#aiProgChat');
      try { await AIChat.enable((r) => { p.textContent = r && r.text ? r.text : ('loading ' + Math.round((r && r.progress || 0) * 100) + '%'); }); p.textContent = 'Ready'; hb.textContent = 'Enabled ✓'; }
      catch (e) { p.textContent = 'Failed: ' + e.message; hb.disabled = false; }
    });
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

  F.AIUI = { open, close };
  document.addEventListener('DOMContentLoaded', init);
})(window);
