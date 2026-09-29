/* TaxLens UK — client app (no build step) */
(() => {
  'use strict';

  // ---------- storage helpers (safe) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tl:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tl:' + k, JSON.stringify(v)); } catch {} },
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const TYPE_LABEL = {
    news_story: 'News', press_release: 'Press release', guidance: 'Guidance', detailed_guide: 'Guide', policy_paper: 'Policy paper',
    open_consultation: 'Open consultation', closed_consultation: 'Consultation', consultation_outcome: 'Consultation outcome',
    statutory_guidance: 'Statutory guidance', notice: 'Notice', collection: 'Collection', form: 'Form', legislation: 'Legislation',
    research: 'Research', speech: 'Speech', written_statement: 'Ministerial statement', correspondence: 'Correspondence',
  };

  const PROVIDERS = {
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct', 'openai/gpt-oss-20b'] },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-oss-120b', 'google/gemini-2.5-pro', 'openai/gpt-4.1', 'meta-llama/llama-3.3-70b-instruct'] },
  };

  const state = {
    data: { items: [], categories: [] },
    rates: null,
    cats: new Set(store.get('cats', [])),
    range: store.get('range', '30'),
    search: '',
    highOnly: store.get('highOnly', false),
    saved: store.get('saved', {}),
    lastVisit: store.get('lastVisit', null),
    settings: store.get('settings', { provider: 'groq', apiKey: '', model: PROVIDERS.groq.models[0] }),
    bodyCache: new Map(),
  };

  // ---------- data ----------
  async function loadJSON(url) {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }
  async function getBody(id) {
    if (state.bodyCache.has(id)) return state.bodyCache.get(id);
    try { const b = await loadJSON(`data/items/${id}.json`); state.bodyCache.set(id, b); return b; } catch { return null; }
  }

  async function init() {
    bindTabs(); bindUpdates(); bindSettings(); bindDeadlines(); bindAsk(); bindInstall();
    try {
      const [data, rates] = await Promise.all([loadJSON('data/updates.json'), loadJSON('data/rates.json')]);
      state.data = data; state.rates = rates;
    } catch (e) {
      $('#freshness').textContent = 'Could not load data (offline?)';
      console.error(e);
    }
    const gen = state.data.generatedAt;
    $('#freshness').textContent = gen ? `Official sources · refreshed ${new Date(gen).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · ${state.data.count} items` : 'Waiting for first data refresh (runs automatically)';
    renderChips(); renderList(); renderRates(); renderDeadlines(); renderSaved();
    // mark visit (after rendering so "NEW" badges show this session)
    store.set('lastVisit', new Date().toISOString());
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    const hash = location.hash.slice(1);
    if (hash) showView(hash);
  }

  // ---------- tabs ----------
  function showView(v) {
    if (!$('#view-' + v)) return;
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
    if (v === 'saved') renderSaved();
    history.replaceState(null, '', '#' + v);
  }
  function bindTabs() { $$('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view))); }

  // ---------- updates ----------
  function bindUpdates() {
    $('#range').value = state.range;
    $('#highOnly').checked = state.highOnly;
    $('#search').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); renderList(); });
    $('#range').addEventListener('change', (e) => { state.range = e.target.value; store.set('range', state.range); renderChips(); renderList(); });
    $('#highOnly').addEventListener('change', (e) => { state.highOnly = e.target.checked; store.set('highOnly', state.highOnly); renderList(); });
    $('#briefBtn').addEventListener('click', briefing);
    $('#closeDrawer').addEventListener('click', closeDrawer);
    $('#drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') closeDrawer(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  }
  const inRange = (it) => (Date.now() - new Date(it.date)) / 864e5 <= Number(state.range);
  const isRelevant = (it) => (it.ai?.relevance ? it.ai.relevance !== 'low' : !(it.categories || []).every((c) => c === 'general'));
  const catLabel = (id) => (state.data.categories || []).find((c) => c.id === id)?.label || id;

  function filtered() {
    const q = state.search;
    return (state.data.items || []).filter((it) => {
      if (!inRange(it)) return false;
      if (state.highOnly && !isRelevant(it)) return false;
      if (state.cats.size && !(it.categories || []).some((c) => state.cats.has(c))) return false;
      if (q) {
        const hay = `${it.title} ${it.description} ${it.changeNote || ''} ${it.ai?.summary || ''}`.toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }

  function renderChips() {
    const counts = {};
    (state.data.items || []).filter(inRange).forEach((it) => (it.categories || []).forEach((c) => (counts[c] = (counts[c] || 0) + 1)));
    const cats = (state.data.categories || []).filter((c) => counts[c.id]);
    $('#chips').innerHTML = `<button class="chip ${state.cats.size ? '' : 'on'}" data-cat="">All</button>` +
      cats.map((c) => `<button class="chip ${state.cats.has(c.id) ? 'on' : ''}" data-cat="${c.id}">${esc(c.label)}<span class="n">${counts[c.id]}</span></button>`).join('');
    $$('#chips .chip').forEach((b) => b.addEventListener('click', () => {
      const c = b.dataset.cat;
      if (!c) state.cats.clear(); else state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c);
      store.set('cats', [...state.cats]); renderChips(); renderList();
    }));
  }

  function itemCard(it) {
    const isNew = state.lastVisit && new Date(it.date) > new Date(state.lastVisit);
    const rel = it.ai?.relevance ? `<span class="rel-${esc(it.ai.relevance)}">● ${esc(it.ai.relevance)} relevance</span>` : '';
    return `<article class="item" data-id="${it.id}" tabindex="0">
      <div class="meta">
        ${isNew ? '<span class="tag new">NEW</span>' : ''}
        <span>${fmtDate(it.date)}</span>·<span class="tag src">${esc(it.source)}</span>
        <span class="tag">${esc(TYPE_LABEL[it.type] || it.type || '')}</span>
        ${(it.categories || []).filter((c) => c !== 'general').map((c) => `<span class="tag">${esc(catLabel(c))}</span>`).join('')}
        ${state.saved[it.id] ? '<span title="Saved">★</span>' : ''} ${rel}
      </div>
      <h3>${esc(it.title)}</h3>
      ${it.changeNote && it.changeNote !== 'First published.' ? `<p><b>Change:</b> ${esc(it.changeNote)}</p>` : it.description ? `<p>${esc(it.description)}</p>` : ''}
      ${it.ai?.summary ? `<div class="ai-box"><span class="ai-label">AI summary of official text</span><br>${esc(it.ai.summary)}</div>` : ''}
    </article>`;
  }

  function renderList() {
    const items = filtered();
    $('#list').innerHTML = items.length ? items.slice(0, 300).map(itemCard).join('') :
      `<div class="empty">${state.data.generatedAt ? 'No updates match these filters. Try a wider date range.' : 'The first data refresh has not run yet. It runs automatically on GitHub each morning (or when the repo is updated).'}</div>`;
    bindItemClicks('#list');
  }
  function bindItemClicks(sel) {
    $$(sel + ' .item').forEach((el) => {
      el.addEventListener('click', () => openItem(el.dataset.id));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openItem(el.dataset.id); });
    });
  }

  // ---------- detail drawer ----------
  const findItem = (id) => (state.data.items || []).find((i) => i.id === id) || state.saved[id];
  function legislationSearch(it) {
    const refs = it.ai?.legislationRefs?.length ? it.ai.legislationRefs[0] : it.title;
    return `https://www.legislation.gov.uk/search?text=${encodeURIComponent(refs.slice(0, 120))}`;
  }

  async function openItem(id) {
    const it = findItem(id); if (!it) return;
    $('#drawer').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const saved = !!state.saved[id];
    $('#drawerBody').innerHTML = `
      <div class="meta"><span>${fmtDate(it.date)}</span>·<span class="tag src">${esc(it.source)}</span><span class="tag">${esc(TYPE_LABEL[it.type] || it.type || '')}</span></div>
      <h2 style="margin-top:6px">${esc(it.title)}</h2>
      <div class="row">
        <a class="btn" href="${esc(it.url)}" target="_blank" rel="noopener">Open official source ↗</a>
        <a class="btn ghost" href="${legislationSearch(it)}" target="_blank" rel="noopener">Search legislation.gov.uk ↗</a>
        <button class="btn ghost" id="saveBtn" type="button">${saved ? '★ Saved' : '☆ Save'}</button>
      </div>
      ${it.description ? `<p>${esc(it.description)}</p>` : ''}
      ${it.changeNote ? `<p><b>Latest change note (official):</b> ${esc(it.changeNote)}</p>` : ''}
      ${it.ai ? aiBlock(it.ai) : ''}
      <div class="card" style="margin-top:14px">
        <h2>Accountant's review (AI, against the official text)</h2>
        <p class="muted small">Uses your ${esc(state.settings.provider === 'groq' ? 'Groq' : 'OpenRouter')} key. The AI only sees the official text below and is instructed not to add anything else.</p>
        <div class="row"><button class="btn" id="analyseBtn" type="button">Practitioner review</button><button class="btn ghost" id="clientNoteBtn" type="button">Draft client note</button><span id="anStatus" class="small muted"></span></div>
        <div id="analysis" class="answer"></div>
      </div>
      <h2 class="h2">Official text</h2>
      <div id="officialText" class="official"><span class="spinner"></span> Loading…</div>
      <div id="attachments"></div>
      <p class="small muted">Source: ${esc(it.url)}</p>`;
    $('#saveBtn').addEventListener('click', () => {
      if (state.saved[id]) delete state.saved[id]; else state.saved[id] = { ...it, savedAt: new Date().toISOString() };
      store.set('saved', state.saved);
      $('#saveBtn').textContent = state.saved[id] ? '★ Saved' : '☆ Save';
      renderList();
    });
    const body = await getBody(id);
    $('#officialText').textContent = body?.text || (it.type === 'legislation' ? 'Open the official source to read the legislation text.' : 'Official text not cached yet — open the official source.');
    if (body?.attachments?.length) {
      $('#attachments').innerHTML = `<h2 class="h2">Official documents</h2><ul>${body.attachments.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a></li>`).join('')}</ul>`;
    }
    $('#analyseBtn').addEventListener('click', () => analyse(it, body, 'analysis'));
    $('#clientNoteBtn').addEventListener('click', () => analyse(it, body, 'client'));
  }
  function aiBlock(ai) {
    const list = (a) => (Array.isArray(a) && a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    return `<div class="ai-box"><span class="ai-label">AI summary of official text · ${esc(ai.model || '')}</span>
      <p style="margin:6px 0">${esc(ai.summary || '')}</p>
      ${ai.whoAffected ? `<p style="margin:4px 0"><b>Who's affected:</b> ${esc(ai.whoAffected)}</p>` : ''}
      ${ai.effectiveDate ? `<p style="margin:4px 0"><b>Effective:</b> ${esc(ai.effectiveDate)}</p>` : ''}
      ${ai.actions?.length ? `<b>Actions:</b>${list(ai.actions)}` : ''}
      ${ai.legislationRefs?.length ? `<b>Legislation cited in source:</b>${list(ai.legislationRefs)}` : ''}
      <span class="small muted">Check against the official source before relying on this.</span></div>`;
  }
  function closeDrawer() { $('#drawer').classList.add('hidden'); document.body.style.overflow = ''; }

  // ---------- AI ----------
  async function callAI(messages, { json = false } = {}) {
    const s = state.settings;
    if (!s.apiKey) throw new Error('Add your Groq or OpenRouter API key in Settings first.');
    const p = PROVIDERS[s.provider];
    const headers = { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' };
    if (s.provider === 'openrouter') { headers['HTTP-Referer'] = location.origin + location.pathname; headers['X-Title'] = 'TaxLens UK'; }
    const body = { model: s.model || p.models[0], temperature: 0.1, messages };
    if (json) body.response_format = { type: 'json_object' };
    const r = await fetch(p.url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text(); throw new Error(`${s.provider} error ${r.status}: ${t.slice(0, 300)}`); }
    const j = await r.json();
    return j.choices?.[0]?.message?.content || '';
  }

  const GROUNDING = `You are a senior UK tax and accounts technical reviewer supporting an ACCA-qualified accountant who runs her own practice advising SMEs, owner-managed businesses (OMBs), company directors, landlords and the self-employed. Think like a practitioner: client impact, practice workload, deadlines, risk and compliance.
STRICT RULES:
1. Use ONLY the official source material supplied in the user message. Do not use outside knowledge for any rate, threshold, date, or legislative reference.
2. If the sources do not answer something, say "Not covered by the supplied official sources — check [suggested GOV.UK / legislation.gov.uk location]".
3. Quote figures exactly as they appear in the source. Never estimate or round.
4. Cite sources with bracketed numbers like [1] that match the numbered sources supplied.
5. Use UK spelling and terminology. Be concise and practical.
6. End with a short "Verify" line listing what the accountant should confirm in the official source.`;

  async function analyse(it, body, mode) {
    const out = $('#analysis'), st = $('#anStatus');
    const text = (body?.text || it.description || '').slice(0, 14000);
    const task = mode === 'client'
      ? 'Draft a short plain-English client email (max 200 words) explaining this update to an owner-managed business client, then a bullet list of information to request from the client. Keep all figures exactly as in source [1].'
      : 'Write a practitioner review with these headings: ### Summary (3 sentences) · ### Which clients are affected (SMEs, OMB directors/shareholders, sole traders, partnerships, landlords, employers — only those the source supports) · ### Effective date(s) · ### What changes (bullets, exact figures) · ### Practice impact (workload, software/process changes, engagement letters, fee opportunities, risk of penalties) · ### Action checklist for the practice · ### Legislation referenced in the source (only if stated) · ### Verify';
    out.innerHTML = ''; st.innerHTML = '<span class="spinner"></span> Analysing…';
    try {
      const ans = await callAI([
        { role: 'system', content: GROUNDING },
        { role: 'user', content: `${task}\n\n[1] ${it.title}\nURL: ${it.url}\nDate: ${it.date}\nChange note: ${it.changeNote || 'n/a'}\n\nOFFICIAL TEXT:\n${text}` },
      ]);
      out.innerHTML = md(ans, [{ url: it.url, title: it.title }]) + `<p class="small muted">AI-generated from the official text only (${esc(state.settings.provider)} · ${esc(state.settings.model)}). Confirm against <a href="${esc(it.url)}" target="_blank" rel="noopener">the official source</a>.</p>`;
      st.textContent = '';
      if (mode === 'client') {
        const b = document.createElement('button'); b.className = 'btn ghost'; b.textContent = 'Copy'; b.type = 'button';
        b.onclick = () => navigator.clipboard?.writeText(ans).then(() => (b.textContent = 'Copied ✓'));
        out.appendChild(b);
      }
    } catch (e) { st.innerHTML = `<span class="warn">${esc(e.message)}</span>`; }
  }

  // minimal, safe markdown -> HTML
  function md(src, sources = []) {
    const lines = esc(src).split('\n'); let html = '', inList = false;
    const inline = (s) => s
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>')
      .replace(/\[(\d+)\]/g, (m, n) => { const s = sources[Number(n) - 1]; return s ? `<a class="cite" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">[${n}]</a>` : m; });
    for (const raw of lines) {
      const l = raw.trimEnd();
      if (/^\s*[-*•]\s+/.test(l)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (/^#{1,6}\s/.test(l)) { html += `<h4>${inline(l.replace(/^#+\s*/, ''))}</h4>`; continue; }
      if (/^\s*\d+\.\s+/.test(l)) { html += `<p>${inline(l)}</p>`; continue; }
      if (l.trim()) html += `<p>${inline(l)}</p>`;
    }
    if (inList) html += '</ul>';
    return html;
  }

  // ---------- Practice briefing ----------
  async function briefing() {
    const out = $('#briefing');
    const items = filtered().slice(0, 40);
    if (!items.length) { out.innerHTML = '<div class="card">No updates in the current view to brief on.</div>'; return; }
    out.innerHTML = `<div class="card"><span class="spinner"></span> Preparing a practice briefing from ${items.length} official updates…</div>`;
    const sources = items.map((it) => ({ title: it.title, url: it.url, date: it.date }));
    const ctx = items.map((it, i) => `[${i + 1}] ${it.title} (${it.date.slice(0, 10)}, ${it.source}, ${TYPE_LABEL[it.type] || it.type})\nURL: ${it.url}\n${it.description || ''}${it.changeNote ? `\nChange note: ${it.changeNote}` : ''}${it.ai?.summary ? `\nSummary of official text: ${it.ai.summary}` : ''}`).join('\n\n');
    try {
      const ans = await callAI([
        { role: 'system', content: GROUNDING },
        { role: 'user', content: `Prepare a practice technical briefing for the partner of a small ACCA practice, based ONLY on these official updates. Headings: ### Headlines (the 3–5 most important for SME/OMB/self-employed clients) · ### By area (PAYE, personal tax, corporation tax, CGT, VAT, Companies House, MTD — skip areas with nothing) · ### Clients to contact (client types and why) · ### Practice to-do list · ### Items that are routine/low impact (one line). Ignore purely administrative service notices. Cite every point with [n].\n\nOFFICIAL UPDATES:\n\n${ctx}` },
      ]);
      out.innerHTML = `<div class="card answer"><div class="row" style="justify-content:space-between;margin:0"><span class="ai-label">AI practice briefing · ${esc(state.settings.provider)} · ${esc(state.settings.model)}</span><span><button class="btn ghost" id="copyBrief" type="button">Copy</button> <button class="btn ghost" id="closeBrief" type="button">Close</button></span></div>${md(ans, sources)}<p class="small muted">Generated from official GOV.UK / legislation.gov.uk updates only. Click any [n] to open the official source and verify.</p></div>`;
      $('#copyBrief').onclick = () => navigator.clipboard?.writeText(ans).then(() => ($('#copyBrief').textContent = 'Copied ✓'));
      $('#closeBrief').onclick = () => (out.innerHTML = '');
    } catch (e) { out.innerHTML = `<div class="card warn">${esc(e.message)}</div>`; }
  }

  // ---------- Ask ----------
  const STOP = new Set('the a an and or of to in for on is are was were be what how does do did with from by at as it its this that my our your can i we will about which who when there their any have has changed change changes new tax uk'.split(' '));
  function retrieve(q, n = 8) {
    const terms = q.toLowerCase().replace(/[^a-z0-9£%\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    if (!terms.length) return [];
    const scored = (state.data.items || []).map((it) => {
      const title = it.title.toLowerCase(), rest = `${it.description} ${it.changeNote || ''} ${it.ai?.summary || ''}`.toLowerCase();
      let s = 0;
      for (const t of terms) { if (title.includes(t)) s += 3; if (rest.includes(t)) s += 1; }
      if (s) s += Math.max(0, 2 - (Date.now() - new Date(it.date)) / 864e5 / 180); // mild recency boost
      return { it, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.slice(0, n).map((x) => x.it);
  }
  function bindAsk() {
    $('#askBtn').addEventListener('click', ask);
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); });
  }
  async function ask() {
    const q = $('#q').value.trim(); if (!q) return;
    const st = $('#askStatus'), out = $('#answer');
    st.innerHTML = '<span class="spinner"></span> Gathering official sources…'; out.innerHTML = '';
    try {
      const hits = retrieve(q);
      const sources = [];
      // [1] = verified rates table
      if (state.rates) {
        const rt = state.rates.sections.map((s) => `${s.title} (source: ${s.source})\n` + s.rows.map((r) => `- ${r[0]}: ${r[1]}`).join('\n')).join('\n\n');
        sources.push({ title: `TaxLens verified rates ${state.rates.taxYear} (checked ${state.rates.lastVerified})`, url: 'https://www.gov.uk/government/collections/rates-and-allowances-hm-revenue-and-customs', text: rt });
      }
      for (const it of hits) {
        const b = await getBody(it.id);
        sources.push({ title: it.title, url: it.url, date: it.date, text: `${it.description}\nChange note: ${it.changeNote || 'n/a'}\n${(b?.text || '').slice(0, 3500)}` });
      }
      st.innerHTML = `<span class="spinner"></span> Asking AI with ${sources.length} official sources…`;
      const ctx = sources.map((s, i) => `[${i + 1}] ${s.title}${s.date ? ` (${s.date.slice(0, 10)})` : ''}\nURL: ${s.url}\n${s.text}`).join('\n\n---\n\n');
      const ans = await callAI([
        { role: 'system', content: GROUNDING },
        { role: 'user', content: `Question from the accountant: ${q}\n\nNUMBERED OFFICIAL SOURCES:\n\n${ctx}` },
      ]);
      out.innerHTML = `<div class="card answer">${md(ans, sources)}</div>
        <div class="card"><h2>Sources supplied to the AI</h2><ol class="small">${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${s.date ? ` · ${fmtDate(s.date)}` : ''}</li>`).join('')}</ol>
        <p class="small muted">AI-generated (${esc(state.settings.provider)} · ${esc(state.settings.model)}) from the sources above only. Always confirm in the official source before advising.</p></div>`;
      st.textContent = '';
    } catch (e) { st.innerHTML = `<span class="warn">${esc(e.message)}</span>`; }
  }

  // ---------- Rates ----------
  function renderRates() {
    const r = state.rates; if (!r) return;
    $('#ratesNote').innerHTML = `<b>Tax year ${esc(r.taxYear)}.</b> Last verified against GOV.UK on ${fmtDate(r.lastVerified)}. ${esc(r.note)}`;
    $('#rates').innerHTML = r.sections.map((s) => `<div class="card"><h2>${esc(s.title)}</h2>
      <table>${s.rows.map((row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td></tr>`).join('')}</table>
      <p class="src-link">Source: <a href="${esc(s.source)}" target="_blank" rel="noopener">${esc(s.source.replace('https://www.', ''))}</a></p></div>`).join('');
  }

  // ---------- Deadlines ----------
  function addMonths(d, m) { const x = new Date(d); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + m); const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(day, last)); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function monthEnd(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  function ukDeadlines(from) {
    const out = []; const y0 = from.getFullYear();
    for (let y = y0 - 1; y <= y0 + 1; y++) {
      const ty = (a) => `${a}/${String((a + 1) % 100).padStart(2, '0')}`;
      out.push(
        { d: new Date(y, 0, 31), t: `Self Assessment online return ${ty(y - 2)} + balancing payment; 1st payment on account ${ty(y - 1)}`, c: 'personal' },
        { d: new Date(y, 1, 7), t: 'MTD Income Tax quarterly update (quarter to 5 Jan)', c: 'mtd' },
        { d: new Date(y, 3, 5), t: `End of tax year ${ty(y - 1)}`, c: 'personal' },
        { d: new Date(y, 3, 19), t: 'Final FPS/EPS for the tax year (by 19 April)', c: 'paye' },
        { d: new Date(y, 4, 7), t: 'MTD Income Tax quarterly update (quarter to 5 Apr)', c: 'mtd' },
        { d: new Date(y, 4, 31), t: 'Give P60s to employees', c: 'paye' },
        { d: new Date(y, 6, 6), t: 'P11D / P11D(b) deadline; employee copies', c: 'paye' },
        { d: new Date(y, 6, 22), t: 'Class 1A NIC payment (electronic; 19 July by cheque)', c: 'paye' },
        { d: new Date(y, 6, 31), t: `2nd payment on account ${ty(y - 1)}`, c: 'personal' },
        { d: new Date(y, 7, 7), t: 'MTD Income Tax quarterly update (quarter to 5 Jul)', c: 'mtd' },
        { d: new Date(y, 9, 5), t: `Register for Self Assessment (new sources in ${ty(y - 1)})`, c: 'personal' },
        { d: new Date(y, 9, 22), t: 'PAYE Settlement Agreement tax & NIC payment (electronic)', c: 'paye' },
        { d: new Date(y, 9, 31), t: `Paper Self Assessment return ${ty(y - 1)}`, c: 'personal' },
        { d: new Date(y, 10, 7), t: 'MTD Income Tax quarterly update (quarter to 5 Oct)', c: 'mtd' },
        { d: new Date(y, 11, 30), t: `Online SA return filed to collect < £3,000 via PAYE code (${ty(y - 1)})`, c: 'personal' },
      );
      for (let m = 0; m < 12; m++) out.push({ d: new Date(y, m, 22), t: 'PAYE/NIC/CIS payment to HMRC (electronic; 19th by cheque)', c: 'paye', monthly: true });
    }
    return out;
  }
  function renderDeadlines() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const horizon = addMonths(today, 12);
    const list = ukDeadlines(today).filter((x) => x.d >= today && x.d <= horizon).sort((a, b) => a.d - b.d);
    // only show next 3 monthly PAYE dates to reduce noise
    let payeShown = 0;
    const shown = list.filter((x) => !x.monthly || payeShown++ < 3);
    $('#deadlines').innerHTML = shown.map((x) => {
      const days = Math.round((x.d - today) / 864e5);
      return `<div class="item dl ${days <= 14 ? 'soon' : ''}" style="cursor:default"><div class="date"><b>${x.d.getDate()}</b><span>${x.d.toLocaleDateString('en-GB', { month: 'short' })} ${String(x.d.getFullYear()).slice(2)}</span></div>
      <div><h3 style="margin:0">${esc(x.t)}</h3><div class="meta">${days === 0 ? 'Today' : `in ${days} day${days === 1 ? '' : 's'}`} · ${esc(catLabel(x.c))}</div></div></div>`;
    }).join('') + '<p class="small muted">Dates falling on a weekend/bank holiday: HMRC generally requires cleared funds by the previous working day. Confirm at gov.uk.</p>';
  }
  function bindDeadlines() {
    const ype = $('#ype'), vqe = $('#vqe');
    const saved = store.get('calc', {}); if (saved.ype) ype.value = saved.ype; if (saved.vqe) vqe.value = saved.vqe;
    const run = () => {
      store.set('calc', { ype: ype.value, vqe: vqe.value });
      const cells = [];
      if (ype.value) {
        const e = new Date(ype.value);
        cells.push(['Corporation Tax payment', addDays(addMonths(e, 9), 1)]);
        cells.push(['CT600 filing', addMonths(e, 12)]);
        cells.push(['Companies House accounts (private co.)', monthEnd(addMonths(e, 9)).getDate() === addMonths(e, 9).getDate() && monthEnd(e).getDate() === e.getDate() ? monthEnd(addMonths(e, 9)) : addMonths(e, 9)]);
      }
      if (vqe.value) {
        const v = new Date(vqe.value);
        const isME = monthEnd(v).getDate() === v.getDate();
        cells.push(['VAT return & payment (MTD)', addDays(isME ? monthEnd(addMonths(new Date(v.getFullYear(), v.getMonth(), 1), 1)) : addMonths(v, 1), 7)]);
      }
      $('#calc').innerHTML = cells.map(([l, d]) => `<div>${esc(l)}<b>${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</b></div>`).join('');
    };
    ype.addEventListener('change', run); vqe.addEventListener('change', run); run();
  }

  // ---------- Saved ----------
  function renderSaved() {
    const items = Object.values(state.saved).sort((a, b) => new Date(b.date) - new Date(a.date));
    $('#savedList').innerHTML = items.length ? items.map(itemCard).join('') : '<div class="empty">Tap ☆ Save on any update to keep it here.</div>';
    bindItemClicks('#savedList');
  }

  // ---------- Settings ----------
  function fillModels() {
    const p = $('#provider').value;
    $('#models').innerHTML = PROVIDERS[p].models.map((m) => `<option value="${m}">`).join('');
  }
  function bindSettings() {
    const s = state.settings;
    $('#provider').value = s.provider; $('#apiKey').value = s.apiKey || ''; $('#model').value = s.model || PROVIDERS[s.provider].models[0];
    fillModels();
    $('#provider').addEventListener('change', () => { fillModels(); $('#model').value = PROVIDERS[$('#provider').value].models[0]; });
    $('#saveSettings').addEventListener('click', () => {
      state.settings = { provider: $('#provider').value, apiKey: $('#apiKey').value.trim(), model: $('#model').value.trim() || PROVIDERS[$('#provider').value].models[0] };
      store.set('settings', state.settings);
      $('#settingsStatus').textContent = 'Saved ✓';
    });
    $('#testAI').addEventListener('click', async () => {
      $('#saveSettings').click();
      $('#settingsStatus').innerHTML = '<span class="spinner"></span> Testing…';
      try { const a = await callAI([{ role: 'user', content: 'Reply with exactly: OK' }]); $('#settingsStatus').textContent = `Connected ✓ (${a.trim().slice(0, 20)})`; }
      catch (e) { $('#settingsStatus').innerHTML = `<span class="warn">${esc(e.message)}</span>`; }
    });
  }

  // ---------- Install ----------
  function bindInstall() {
    let deferred;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').classList.remove('hidden'); });
    $('#installBtn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').classList.add('hidden'); });
  }

  init();
})();
