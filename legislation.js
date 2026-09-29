/* TaxLens UK — Legislation tab
   Live, official statute text from legislation.gov.uk (revised, with outstanding-changes warnings),
   section-heading search across key tax Acts, point-in-time lookup, related HMRC updates
   and a grounded AI "apply to clients / accounts" review. */
(() => {
  'use strict';
  const LEG = 'https://www.legislation.gov.uk/';
  const $ = (s, r = document) => r.querySelector(s);
  let TL = null;
  let index = null; // { acts: [...] }
  let loading = null;

  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND = { section: 's', regulation: 'reg', schedule: 'Sch', article: 'art', rule: 'r' };
  const label = (rel) => { const [k, n] = rel.split('/'); return `${KIND[k] || k} ${n}`; };

  // ---------- index ----------
  function loadIndex() {
    if (index || loading) return loading;
    loading = TL.loadJSON('data/legislation-index.json').then((j) => {
      index = j;
      const sel = $('#legAct');
      sel.innerHTML = '<option value="">All key Acts</option>' + j.acts.map((a) => `<option value="${esc(a.path)}">${esc(a.short)} — ${esc(a.title)}</option>`).join('');
      renderKeyActs();
    }).catch(() => {
      index = { acts: [] };
      $('#legKeyActs').innerHTML = '<div class="card small muted">The legislation index is built by the daily GitHub job — it will appear after the next refresh. Citation look-ups (e.g. <b>CTA 2010 s455</b>) still work.</div>';
    });
    return loading;
  }
  const actByPath = (p) => index?.acts.find((a) => a.path === p);

  // Fallback aliases so citations work even before the index exists
  const FALLBACK = [
    ['ittoia', 'ukpga/2005/5', 'ITTOIA 2005'], ['itepa', 'ukpga/2003/1', 'ITEPA 2003'], ['ita 2007', 'ukpga/2007/3', 'ITA 2007'],
    ['cta 2009', 'ukpga/2009/4', 'CTA 2009'], ['cta 2010', 'ukpga/2010/4', 'CTA 2010'], ['tcga', 'ukpga/1992/12', 'TCGA 1992'],
    ['caa', 'ukpga/2001/2', 'CAA 2001'], ['vata', 'ukpga/1994/23', 'VATA 1994'], ['ihta', 'ukpga/1984/51', 'IHTA 1984'],
    ['tma', 'ukpga/1970/9', 'TMA 1970'], ['sscba', 'ukpga/1992/4', 'SSCBA 1992'], ['tiopa', 'ukpga/2010/8', 'TIOPA 2010'],
    ['companies act', 'ukpga/2006/46', 'CA 2006'], ['ca 2006', 'ukpga/2006/46', 'CA 2006'],
    ['paye reg', 'uksi/2003/2682', 'PAYE Regs 2003'], ['vat reg', 'uksi/1995/2518', 'VAT Regs 1995'],
  ];

  // ---------- citation parser ----------
  function parseCitation(q) {
    const ql = ` ${q.toLowerCase().replace(/\s+/g, ' ')} `;
    let act = null;
    const cands = [];
    for (const a of index?.acts || []) for (const al of [a.short.toLowerCase(), ...(a.aliases || [])]) cands.push([al, a.path, a.short]);
    cands.push(...FALLBACK);
    cands.sort((x, y) => y[0].length - x[0].length);
    for (const [al, path, short] of cands) {
      const re = new RegExp(`(^|[^a-z])${al.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
      if (re.test(ql)) { act = { path, short }; break; }
    }
    // bare "cta" defaults to CTA 2010, "ita" to ITA 2007
    if (!act && /(^|[^a-z])cta([^a-z]|$)/.test(ql)) act = { path: 'ukpga/2010/4', short: 'CTA 2010' };
    if (!act && /(^|[^a-z])ita([^a-z]|$)/.test(ql)) act = { path: 'ukpga/2007/3', short: 'ITA 2007' };
    if (!act && $('#legAct').value) { const a = actByPath($('#legAct').value); if (a) act = { path: a.path, short: a.short }; }
    const pm = q.match(/(?:^|[\s,(])(ss?\.?|sec(?:tion)?s?\.?|reg(?:ulation)?s?\.?|sch(?:edule)?\.?|para(?:graph)?\.?|art(?:icle)?\.?)\s*([0-9]+[a-z]*)/i);
    if (!act || !pm) return null;
    const t = pm[1].toLowerCase();
    const kind = t.startsWith('reg') ? 'regulation' : t.startsWith('sch') ? 'schedule' : t.startsWith('art') ? 'article' : 'section';
    return { ...act, rel: `${kind}/${pm[2].toUpperCase()}` };
  }

  // ---------- search ----------
  async function search() {
    await loadIndex();
    const q = $('#legQ').value.trim();
    const out = $('#legResults');
    if (!q) { out.innerHTML = ''; renderKeyActs(); return; }
    $('#legKeyActs').innerHTML = '';
    const cite = parseCitation(q);
    if (cite) { openProvision(cite.path, cite.rel); }
    const actWords = new Set();
    for (const a of index?.acts || []) for (const al of [a.short, ...(a.aliases || [])]) al.toLowerCase().split(/\s+/).forEach((w) => actWords.add(w));
    FALLBACK.forEach(([al]) => al.split(' ').forEach((w) => actWords.add(w)));
    const terms = q.toLowerCase().replace(/\b(s|ss|sec|section|reg|regulation|sch|schedule|para|art)\.?\s*\d+[a-z]*/g, ' ').split(/[^a-z0-9£-]+/)
      .filter((w) => w.length > 2 && !/^\d{4}$/.test(w) && !/^(the|and|for|act|tax|cta|ita)$/.test(w) && !actWords.has(w));
    const limit = $('#legAct').value;
    const hits = [];
    if (terms.length) {
      for (const a of index?.acts || []) {
        if (limit && a.path !== limit) continue;
        for (const [num, title, rel] of a.items) {
          const t = title.toLowerCase();
          if (terms.every((w) => t.includes(w))) hits.push({ a, num, title, rel, score: terms.reduce((s, w) => s + (t.startsWith(w) ? 2 : 1), 0) });
        }
      }
    }
    hits.sort((x, y) => y.score - x.score);
    let html = '';
    if (cite) html += `<div class="card small">Opening <b>${esc(cite.short)} ${esc(label(cite.rel))}</b>…</div>`;
    if (terms.length) {
      html += `<h2 class="h2">Sections in key tax Acts <span class="muted small">(${hits.length} match${hits.length === 1 ? '' : 'es'} in headings)</span></h2>`;
      html += hits.length ? `<div class="list">${hits.slice(0, 60).map((h) => row(h.a, h.rel, h.title)).join('')}</div>` : '<div class="card small muted">No matching section headings. Try fewer words, or the wider search below.</div>';
      html += `<h2 class="h2">Other legislation on legislation.gov.uk</h2><div id="legLive" class="list"><div class="card small"><span class="spinner"></span> Searching legislation.gov.uk…</div></div>`;
    }
    out.innerHTML = html;
    bindRows(out);
    if (terms.length) liveSearch(terms.join(' '));
  }
  const row = (a, rel, title) => `<div class="item leg-row" data-path="${esc(a.path)}" data-rel="${esc(rel)}" tabindex="0"><div class="meta"><span class="tag src">${esc(a.short)}</span><b>${esc(label(rel))}</b></div><h3 style="margin:2px 0 0">${esc(title || label(rel))}</h3></div>`;
  function bindRows(root) {
    root.querySelectorAll('.leg-row').forEach((el) => {
      const go = () => openProvision(el.dataset.path, el.dataset.rel);
      el.addEventListener('click', go); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  }

  async function liveSearch(text) {
    const box = $('#legLive');
    try {
      const r = await fetch(`${LEG}all/data.feed?text=${encodeURIComponent(text)}`);
      const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
      const entries = [...doc.getElementsByTagName('entry')].slice(0, 12).map((e) => {
        const id = e.getElementsByTagName('id')[0]?.textContent || '';
        const path = (id.match(/\/id\/(.+)$/) || [])[1] || '';
        return { title: e.getElementsByTagName('title')[0]?.textContent || path, path, summary: e.getElementsByTagName('summary')[0]?.textContent || '', year: (e.getElementsByTagName('published')[0]?.textContent || '').slice(0, 4) };
      });
      box.innerHTML = entries.length ? entries.map((e) => {
        const inIndex = actByPath(e.path);
        return `<div class="item" style="cursor:default"><div class="meta"><span class="tag">${esc(e.path.split('/')[0].toUpperCase())}</span><span>${esc(e.year)}</span></div>
          <h3 style="margin:2px 0">${esc(e.title)}</h3>${e.summary ? `<p>${esc(e.summary.slice(0, 220))}</p>` : ''}
          <div class="row"><a class="btn ghost" href="${LEG}${esc(e.path)}/contents" target="_blank" rel="noopener">Contents ↗</a>${inIndex ? `<button class="btn ghost" type="button" data-browse="${esc(e.path)}">Browse sections here</button>` : ''}</div></div>`;
      }).join('') : '<div class="card small muted">No results.</div>';
      box.querySelectorAll('[data-browse]').forEach((b) => b.addEventListener('click', () => browse(b.dataset.browse)));
    } catch (e) { box.innerHTML = `<div class="card small warn">legislation.gov.uk search unavailable (${esc(e.message)}).</div>`; }
  }

  // ---------- key Acts & browse ----------
  function renderKeyActs() {
    if (!index?.acts?.length || $('#legQ').value.trim()) return;
    $('#legKeyActs').innerHTML = `<h2 class="h2">Key legislation for SMEs, OMBs &amp; the self-employed</h2>
      <p class="small muted">Section headings indexed ${TL.fmtDate(index.generatedAt)}. Text always loads live from legislation.gov.uk.</p>
      <div class="leg-grid">${index.acts.map((a) => `<div class="card leg-act" data-browse="${esc(a.path)}" tabindex="0">
        <div class="meta"><span class="tag src">${esc(a.short)}</span>${a.status === 'revised' ? '<span class="tag ok">Revised</span>' : ''}</div>
        <h3 style="margin:6px 0 2px;font-size:15px">${esc(a.title)}</h3>
        <p class="small muted" style="margin:0">${esc(a.area || '')} · ${a.items.length} provisions</p></div>`).join('')}</div>`;
    $('#legKeyActs').querySelectorAll('[data-browse]').forEach((el) => {
      el.addEventListener('click', () => browse(el.dataset.browse));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') browse(el.dataset.browse); });
    });
  }
  function browse(path) {
    const a = actByPath(path); if (!a) return;
    $('#legAct').value = path; $('#legQ').value = '';
    $('#legKeyActs').innerHTML = '';
    const draw = (f) => {
      const fl = f.toLowerCase();
      const items = a.items.filter(([n, t]) => !fl || t.toLowerCase().includes(fl) || n.toLowerCase() === fl);
      $('#browseList').innerHTML = items.slice(0, 400).map(([, t, rel]) => row(a, rel, t)).join('') + (items.length > 400 ? `<p class="small muted">Showing 400 of ${items.length} — type to filter.</p>` : '');
      bindRows($('#browseList'));
    };
    $('#legResults').innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;margin:0"><div><span class="tag src">${esc(a.short)}</span> <b>${esc(a.title)}</b></div><button class="btn ghost" type="button" id="browseBack">All Acts</button></div>
      <input id="browseFilter" type="search" placeholder="Filter headings or type a section number…" style="width:100%;margin-top:10px"></div><div id="browseList" class="list"></div>`;
    $('#browseFilter').addEventListener('input', (e) => draw(e.target.value.trim()));
    $('#browseBack').addEventListener('click', () => { $('#legAct').value = ''; $('#legResults').innerHTML = ''; renderKeyActs(); });
    draw('');
  }

  // ---------- provision viewer ----------
  function renderXml(node, parent) {
    if (node.nodeType === 3) return esc(node.nodeValue);
    if (node.nodeType !== 1) return '';
    const n = node.localName;
    const kids = (skip) => [...node.childNodes].filter((c) => c !== skip).map((c) => renderXml(c, n)).join('');
    switch (n) {
      case 'CommentaryRef': case 'Commentaries': case 'Commentary': case 'Metadata': case 'Contents': case 'Footnote': case 'FootnoteRef': return '';
      case 'Title': return parent === 'P1group' || parent === 'Pblock' || parent === 'Part' || parent === 'Chapter' || parent === 'Schedule' ? `<h4>${kids()}</h4>` : `<b>${kids()}</b>`;
      case 'Number': return `<div class="small muted" style="margin-top:8px">${kids()}</div>`;
      case 'P1': case 'P2': case 'P3': case 'P4': case 'P5': case 'P6': {
        const pn = [...node.children].find((c) => c.localName === 'Pnumber');
        const num = pn ? pn.textContent.trim() : '';
        const shown = !num ? '' : n === 'P1' ? num : `(${num})`;
        return `<div class="lv"><span class="pn">${esc(shown)}</span><div class="lb">${kids(pn)}</div></div>`;
      }
      case 'Pnumber': return `<b>${kids()}</b> `;
      case 'Text': return `<p>${kids()}</p>`;
      case 'Substitution': case 'Addition': return `<span class="amend" title="Amended text">[${kids()}]</span>`;
      case 'Emphasis': return `<i>${kids()}</i>`;
      case 'Strong': return `<b>${kids()}</b>`;
      case 'BlockAmendment': return `<blockquote>${kids()}</blockquote>`;
      case 'UnorderedList': case 'OrderedList': return `<ul>${kids()}</ul>`;
      case 'ListItem': return `<li>${kids()}</li>`;
      case 'table': case 'tbody': case 'thead': case 'tr': case 'td': case 'th': return `<${n}>${kids()}</${n}>`;
      default: return kids();
    }
  }
  const plainText = (el) => {
    const d = document.createElement('div'); d.innerHTML = renderXml(el, '');
    d.querySelectorAll('.pn').forEach((p) => { p.textContent = p.textContent + ' '; });
    d.querySelectorAll('p,h4,div.lv,li').forEach((p) => p.append('\n'));
    return d.textContent.replace(/\n\s*\n+/g, '\n').trim();
  };

  async function openProvision(path, rel) {
    const a = actByPath(path);
    const date = $('#legDate').value;
    const base = `${path}/${rel}${date ? `/${date}` : ''}`;
    const humanUrl = `${LEG}${base}`;
    const title = a?.items.find((i) => i[2].toLowerCase() === rel.toLowerCase())?.[1] || '';
    const d = $('#drawer'), body = $('#drawerBody');
    d.classList.remove('hidden'); document.body.style.overflow = 'hidden';
    body.innerHTML = `<div class="meta"><span class="tag src">legislation.gov.uk</span><span class="tag">${esc(a?.short || path)}</span></div>
      <h2 style="margin-top:6px">${esc(a?.short || path)} ${esc(label(rel))}${title ? ` — ${esc(title)}` : ''}</h2>
      <div id="legStatus"><span class="spinner"></span> Loading official text…</div>`;
    let xml;
    try {
      const r = await fetch(`${LEG}${base}/data.xml`);
      if (!r.ok) throw new Error(r.status === 404 ? 'Provision not found — check the number (e.g. s455, reg 67B, Sch 8)' : `HTTP ${r.status}`);
      xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
    } catch (e) {
      $('#legStatus').innerHTML = `<div class="notice">${esc(e.message)}. <a href="${esc(humanUrl)}" target="_blank" rel="noopener">Open on legislation.gov.uk ↗</a></div>`;
      return;
    }
    const get = (tag) => xml.getElementsByTagNameNS('*', tag)[0];
    const actTitle = get('title')?.textContent || a?.title || path;
    const valid = get('valid')?.textContent || '';
    const modified = get('modified')?.textContent || '';
    const docStatus = get('DocumentStatus')?.getAttribute('Value') || '';
    const content = get('Body') || get('Schedules') || get('Primary') || get('Secondary');
    const num = rel.split('/')[1];
    const prefix = { section: 's\\.', regulation: 'reg\\.', schedule: 'Sch\\.', article: 'art\\.', rule: 'r\\.' }[rel.split('/')[0]] || 's\\.';
    const provRe = new RegExp(`(^|[^0-9A-Za-z])${prefix}\\s*${num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9A-Za-z])`, 'i');
    const effects = [...xml.getElementsByTagNameNS('*', 'UnappliedEffect')].map((e) => ({
      type: e.getAttribute('Type') || 'changed',
      affected: e.getElementsByTagNameNS('*', 'AffectedProvisions')[0]?.textContent.trim() || e.getAttribute('AffectedProvisions') || '',
      by: e.getElementsByTagNameNS('*', 'AffectingTitle')[0]?.textContent.trim() || '',
      byProv: e.getElementsByTagNameNS('*', 'AffectingProvisions')[0]?.textContent.trim() || '',
      byUri: e.getAttribute('AffectingURI') || '',
      inForce: [...e.getElementsByTagNameNS('*', 'InForce')].map((f) => f.getAttribute('Date') || f.getAttribute('Qualification') || '').filter(Boolean).join(', '),
    }));
    const mine = effects.filter((e) => provRe.test(e.affected));
    const prospective = !!xml.querySelector('[Status="Prospective"]');

    let status = '';
    if (docStatus === 'revised') {
      status = mine.length
        ? `<div class="notice"><b>⚠ ${mine.length} change${mine.length > 1 ? 's' : ''} not yet incorporated into this text.</b> Read the amending legislation alongside it:<ul>${mine.map((e) => `<li>${esc(e.affected)} <b>${esc(e.type)}</b> by ${e.byUri ? `<a href="${esc(e.byUri.replace(/^http:/, 'https:'))}" target="_blank" rel="noopener">${esc(e.by)} ${esc(e.byProv)}</a>` : `${esc(e.by)} ${esc(e.byProv)}`}${e.inForce ? ` <span class="muted">(in force: ${esc(e.inForce)})</span>` : ''}</li>`).join('')}</ul></div>`
        : `<div class="leg-ok">✓ Revised text${date ? ` as at <b>${esc(TL.fmtDate(date))}</b>` : ''}. No outstanding changes recorded against this provision by legislation.gov.uk${valid ? ` (text valid from ${esc(TL.fmtDate(valid))})` : ''}.</div>`;
    } else {
      status = `<div class="notice"><b>Original (as made) text.</b> legislation.gov.uk has not produced a revised version, so later amendments may not be shown. Check for amending legislation before relying on it.</div>`;
    }
    if (prospective) status += '<div class="notice">Contains <b>prospective</b> provisions (not yet in force).</div>';
    if (effects.length > mine.length) status += `<p class="small muted">The ${esc(actTitle)} has ${effects.length - mine.length} other outstanding change(s) recorded against other provisions.</p>`;
    status += `<p class="small muted">Source: legislation.gov.uk${modified ? ` · last updated ${esc(TL.fmtDate(modified))}` : ''}. Crown copyright, Open Government Licence.</p>`;

    const html = content ? renderXml(content, '') : '<p>No text returned.</p>';
    const text = content ? plainText(content) : '';
    const idx = a ? a.items.findIndex((i) => i[2].toLowerCase() === rel.toLowerCase()) : -1;
    const prev = idx > 0 ? a.items[idx - 1] : null, next = idx >= 0 && idx < a.items.length - 1 ? a.items[idx + 1] : null;
    const related = TL.retrieve(`${title} ${a?.short || ''} ${label(rel)}`, 6);

    $('#legStatus').outerHTML = `${status}
      <div class="row">
        <a class="btn" href="${esc(humanUrl)}" target="_blank" rel="noopener">Open on legislation.gov.uk ↗</a>
        ${prev ? `<button class="btn ghost" type="button" data-nav="${esc(prev[2])}">← ${esc(label(prev[2]))}</button>` : ''}
        ${next ? `<button class="btn ghost" type="button" data-nav="${esc(next[2])}">${esc(label(next[2]))} →</button>` : ''}
      </div>
      <div class="card" style="margin-top:14px">
        <h2>Apply it (AI, grounded in this text)</h2>
        <p class="muted small">The AI sees only this official text, its status above, related HMRC updates held in the app and the verified rates table.</p>
        <div class="row"><button class="btn" type="button" id="legApply">Explain &amp; apply to clients</button><button class="btn ghost" type="button" id="legAccounts">Accounts &amp; tax computation treatment</button><span id="legAIStatus" class="small muted"></span></div>
        <div id="legAI" class="answer"></div>
      </div>
      <h2 class="h2">Official text${date ? ` (as at ${esc(TL.fmtDate(date))})` : ''}</h2>
      <div class="official leg-text">${html}</div>
      ${related.length ? `<h2 class="h2">Related HMRC / GOV.UK updates</h2><div class="list">${related.map((it) => `<div class="item" data-upd="${it.id}"><div class="meta"><span>${TL.fmtDate(it.date)}</span><span class="tag src">${esc(it.source)}</span></div><h3 style="margin:2px 0">${esc(it.title)}</h3></div>`).join('')}</div>` : ''}`;

    body.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => openProvision(path, b.dataset.nav)));
    body.querySelectorAll('[data-upd]').forEach((el) => el.addEventListener('click', () => TL.openItem(el.dataset.upd)));
    const ctx = { actTitle, short: a?.short || actTitle, rel, title, url: humanUrl, text, date, docStatus, mine, related };
    $('#legApply').addEventListener('click', () => applyAI(ctx, 'clients'));
    $('#legAccounts').addEventListener('click', () => applyAI(ctx, 'accounts'));
  }

  async function applyAI(c, mode) {
    const out = $('#legAI'), st = $('#legAIStatus');
    st.innerHTML = '<span class="spinner"></span> Preparing…'; out.innerHTML = '';
    try {
      const sources = [{ title: `${c.actTitle} ${label(c.rel)}${c.title ? ` — ${c.title}` : ''}`, url: c.url }];
      let ctx = `[1] ${sources[0].title}\nURL: ${c.url}\nStatus: ${c.docStatus === 'revised' ? 'revised text' : 'original as-made text (may not include later amendments)'}${c.date ? `; point-in-time version as at ${c.date}` : ''}\n${c.mine.length ? `OUTSTANDING CHANGES NOT YET IN THIS TEXT: ${c.mine.map((e) => `${e.affected} ${e.type} by ${e.by} ${e.byProv}${e.inForce ? ` (in force ${e.inForce})` : ''}`).join('; ')}` : 'No outstanding changes recorded against this provision.'}\n\nOFFICIAL TEXT:\n${c.text.slice(0, 12000)}`;
      const rates = TL.state.rates;
      if (rates) {
        sources.push({ title: `TaxLens verified rates ${rates.taxYear} (checked ${rates.lastVerified})`, url: 'https://www.gov.uk/government/collections/rates-and-allowances-hm-revenue-and-customs' });
        ctx += `\n\n---\n\n[2] ${sources[1].title}\n` + rates.sections.map((s) => `${s.title} (source: ${s.source})\n` + s.rows.map((r) => `- ${r[0]}: ${r[1]}`).join('\n')).join('\n');
      }
      for (const it of c.related.slice(0, 4)) {
        const b = await TL.getBody(it.id);
        sources.push({ title: it.title, url: it.url });
        ctx += `\n\n---\n\n[${sources.length}] ${it.title} (${it.date.slice(0, 10)})\nURL: ${it.url}\n${it.description || ''}\n${(b?.text || '').slice(0, 2500)}`;
      }
      const task = mode === 'accounts'
        ? `Explain how [1] affects preparing accounts and tax computations for SME / owner-managed business clients. Headings: ### What the provision does (plain English, cite subsections) · ### Tax computation treatment (step by step; use figures only from the sources) · ### Accounts & disclosure points (only where the sources support it; otherwise say "check FRS 102 / Companies Act guidance") · ### Year-end checklist · ### Common pitfalls · ### Verify.`
        : `Explain [1] for a practitioner advising SME / owner-managed business / self-employed clients. Headings: ### In plain English · ### When it applies (conditions, cite subsections) · ### Which clients to flag · ### Worked example (only if figures in the sources allow; otherwise say what figures are needed) · ### Planning points & risks · ### Recent HMRC updates on this (from the numbered sources, if any) · ### Verify.`;
      st.innerHTML = '<span class="spinner"></span> Asking AI…';
      const ans = await TL.callAI([
        { role: 'system', content: `${TL.GROUNDING}\n7. If the provision has outstanding changes not yet incorporated, state this prominently at the start and explain the practical effect only as far as the sources allow.${c.date ? `\n8. Apply the law as it stood on ${c.date}.` : ''}` },
        { role: 'user', content: `${task}\n\nNUMBERED OFFICIAL SOURCES:\n\n${ctx}` },
      ]);
      out.innerHTML = TL.md(ans, sources) + `<p class="small muted">AI-generated from the official sources above (${esc(TL.state.settings.provider)} · ${esc(TL.state.settings.model)}). Confirm against <a href="${esc(c.url)}" target="_blank" rel="noopener">the legislation</a> before advising.</p>`;
      const b = document.createElement('button'); b.className = 'btn ghost'; b.type = 'button'; b.textContent = 'Copy';
      b.onclick = () => navigator.clipboard?.writeText(ans).then(() => (b.textContent = 'Copied ✓'));
      out.appendChild(b);
      st.textContent = '';
    } catch (e) { st.innerHTML = `<span class="warn">${esc(e.message)}</span>`; }
  }

  // ---------- wiring ----------
  function init() {
    TL = window.TL;
    $('#legGo').addEventListener('click', search);
    $('#legQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    $('#legQ').addEventListener('input', (e) => { if (!e.target.value.trim()) { $('#legResults').innerHTML = ''; renderKeyActs(); } });
    $('#legAct').addEventListener('change', () => { const p = $('#legAct').value; if (p && !$('#legQ').value.trim()) browse(p); else if ($('#legQ').value.trim()) search(); });
    document.addEventListener('tl:view', (e) => { if (e.detail === 'legislation') loadIndex(); });
    if (location.hash === '#legislation') loadIndex();
    window.TLLeg = { openProvision, parseCitation };
  }
  if (window.TL) init(); else document.addEventListener('tl:ready', init, { once: true });
})();
