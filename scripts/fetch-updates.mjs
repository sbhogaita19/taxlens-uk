// TaxLens UK — official update fetcher
// Runs in GitHub Actions (Node 20+, no dependencies).
// Pulls updates ONLY from official sources (GOV.UK / HMRC / HM Treasury / legislation.gov.uk),
// classifies them by tax head, stores the official text, and (optionally) adds an AI summary
// that is grounded strictly in that official text.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'data');
const ITEMS_DIR = path.join(DATA, 'items');
const OUT = path.join(DATA, 'updates.json');

const MONTHS_BACK = Number(process.env.MONTHS_BACK || 18);
const MAX_BODY_FETCH = Number(process.env.MAX_BODY_FETCH || 400);
const DATA_VERSION = 2;
const MAX_AI = Number(process.env.MAX_AI || 30);
const SINCE = new Date(Date.now() - MONTHS_BACK * 30.5 * 864e5);
const UA = 'TaxLensUK/1.0 (+https://github.com/sbhogaita19/taxlens-uk)';

// ---------- Categories (tax heads) ----------
export const CATEGORIES = [
  { id: 'paye', label: 'PAYE & Payroll', re: /\b(PAYE|payroll|RTI|real time information|employer bulletin|P11D|P60|P45|benefits? in kind|salary sacrifice|statutory (sick|maternity|paternity)|national minimum wage|national living wage|student loan|off-payroll|IR35|expenses and benefits|payrolling benefits|employment allowance|tax code)\b/i },
  { id: 'nic', label: 'National Insurance', re: /\b(national insurance|NICs?|class [1234][AB]?)\b/i },
  { id: 'personal', label: 'Personal Tax & Self Assessment', re: /\b(self assessment|income tax|personal allowance|dividend|savings (allowance|income)|high income child benefit|marriage allowance|self assessment tax return|personal tax return|payments? on account|pension|ISA|remittance|non-dom|residence|landlord|property income)\b/i },
  { id: 'selfemployed', label: 'Self-employed & Partnerships', re: /\b(self[- ]employed|sole trader|partnership|basis period|trading allowance|cash basis|making tax digital for income tax|MTD for income tax|MTD ITSA)\b/i },
  { id: 'corptax', label: 'Corporation Tax', re: /\b(corporation tax|company tax return|CT600|marginal relief|capital allowances?|full expensing|annual investment allowance|R&D|research and development|loan to participator|s455|close compan|group relief|transfer pricing|creative (industries|sector) relief|patent box|pillar two|multinational top-up)\b/i },
  { id: 'cgt', label: 'Capital Gains Tax', re: /\b(capital gains|CGT|business asset disposal relief|BADR|entrepreneurs'? relief|investors'? relief|private residence relief|chargeable gains?|carried interest|EMI|share (scheme|option)|employee ownership trust)\b/i },
  { id: 'vat', label: 'VAT', re: /\b(VAT|value added tax|flat rate scheme|reverse charge|partial exemption|making tax digital for VAT|MTD for VAT|option to tax)\b/i },
  { id: 'iht', label: 'IHT & Business/Agricultural Relief', re: /\b(inheritance tax|IHT|business (property )?relief|agricultural (property )?relief|trusts?)\b/i },
  { id: 'mtd', label: 'Making Tax Digital', re: /\b(making tax digital|MTD)\b/i },
  { id: 'compliance', label: 'Penalties, Interest & Compliance', re: /\b(penalt(y|ies)|late payment interest|interest rates?|compliance|enquir(y|ies)|disclosure|tax avoidance|spotlight|promoters?|time to pay|debt)\b/i },
  { id: 'budget', label: 'Budget & Policy', re: /\b(budget|spring statement|autumn statement|finance (bill|act)|tax information and impact note|TIIN|consultation|policy paper|overview of tax legislation)\b/i },
  { id: 'reporting', label: 'Companies House & Reporting', re: /\b(companies house|identity verification|ECCTA|economic crime and corporate transparency|confirmation statement|filing (your )?accounts|annual accounts|micro-entit|small company|company size thresholds|FRS ?10[25]|UK GAAP|financial reporting|audit exemption|abridged accounts|persons with significant control|PSC|software filing|dormant compan)\b/i },
  { id: 'pensions', label: 'Pensions & Auto-enrolment', re: /\b(auto[- ]enrolment|workplace pension|pension scheme|re-enrolment|declaration of compliance|pensions regulator)\b/i },
  { id: 'agents', label: 'Agents & Practice', re: /\b(agent update|tax agents?|agent services account|authorising (your|an) agent|anti-money laundering|AML supervision)\b/i },
];

// Noise we never want (customs, excise, service status, statistics, internal manuals…)
const EXCLUDE = /(service availability|availability and issues|statistics|statistical|tariff|stop press|customs|excise|alcohol|tobacco|fuel duty|gambling|landfill|aggregates levy|intrastat|\bNES\b|CHIEF|\bCDS\b|\bborders?\b|\bimports?\b|\bexports?\b|binding tariff|oil and gas|plastic packaging|soft drinks|vaping|transparency data|pre-release access|freedom of information|\bFOI\b|job vacanc|board minutes|annual report and accounts|accounts direction|cymraeg|\bwelsh language\b|transit|market values?|business rates|\bscams?\b|phishing|text message|genuine HMRC contact|approved professional organisations|\bISA managers?\b|excise|climate change levy|carbon|tonnage)/i;

const DOC_TYPES = [
  'news_story', 'press_release', 'guidance', 'detailed_guide', 'policy_paper', 'open_consultation',
  'closed_consultation', 'consultation_outcome', 'statutory_guidance', 'notice', 'collection',
  'form', 'research', 'speech', 'written_statement', 'correspondence',
];

const QUERIES = [
  '', 'PAYE', 'employer bulletin', 'National Insurance', 'Self Assessment', 'Income Tax',
  'dividend tax', 'Corporation Tax', 'capital allowances', 'research and development tax relief',
  'Capital Gains Tax', 'Business Asset Disposal Relief', 'VAT', 'Making Tax Digital',
  'self-employed', 'agent update', 'Inheritance Tax business relief', 'off-payroll working',
  'benefits in kind', 'late payment interest rates', 'tax information and impact note', 'Budget',
];

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}
async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.8' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
const idFor = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
function htmlToText(html = '') {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|section)>/gi, '\n')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&pound;/g, '£')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}
export function classify(text) {
  const cats = CATEGORIES.filter((c) => c.re.test(text)).map((c) => c.id);
  return cats.length ? cats : ['general'];
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---------- GOV.UK ----------
async function fetchGovUk() {
  const found = new Map();
  const fields = ['title', 'link', 'public_timestamp', 'content_store_document_type', 'description', 'organisations'];
  const ORGS = {
    'hm-revenue-customs': { label: 'HMRC (GOV.UK)', queries: QUERIES },
    'hm-treasury': { label: 'HM Treasury (GOV.UK)', queries: QUERIES.filter(Boolean), needsCategory: true },
    'companies-house': { label: 'Companies House (GOV.UK)', queries: ['', 'identity verification', 'accounts', 'filing', 'confirmation statement', 'Economic Crime and Corporate Transparency Act'] },
    'the-pensions-regulator': { label: 'The Pensions Regulator (GOV.UK)', queries: ['automatic enrolment', 'employers', 'pension'], needsCategory: true },
  };
  for (const [org, cfg] of Object.entries(ORGS)) {
    for (const q of cfg.queries) {
      const p = new URLSearchParams({ order: '-public_timestamp', count: '60', filter_organisations: org });
      if (q) p.set('q', q);
      p.set('filter_public_timestamp', `from:${SINCE.toISOString().slice(0, 10)}`);
      fields.forEach((f) => p.append('fields', f));
      DOC_TYPES.forEach((t) => p.append('filter_content_store_document_type', t));
      const url = `https://www.gov.uk/api/search.json?${p}`;
      try {
        const j = await getJSON(url);
        for (const r of j.results || []) {
          if (!r.link || !r.public_timestamp) continue;
          const full = `${r.title} ${r.description || ''}`;
          if (EXCLUDE.test(full)) continue;
          const categories = classify(full);
          if (cfg.needsCategory && categories[0] === 'general') continue;
          const link = r.link.startsWith('http') ? r.link : `https://www.gov.uk${r.link}`;
          if (!found.has(link)) {
            found.set(link, {
              id: idFor(link), title: r.title, url: link, path: r.link, date: r.public_timestamp,
              type: r.content_store_document_type, source: cfg.label,
              description: r.description || '', categories,
            });
          }
        }
        await sleep(150);
      } catch (e) {
        console.warn(`GOV.UK search failed [${org} / ${q}]: ${e.message}`);
      }
    }
  }
  return [...found.values()];
}

async function enrichBody(item) {
  if (!item.path || item.path.startsWith('http')) return null;
  const j = await getJSON(`https://www.gov.uk/api/content${item.path}`);
  const d = j.details || {};
  let html = d.body || '';
  if (!html && Array.isArray(d.parts)) html = d.parts.map((p) => `<h2>${p.title}</h2>${p.body}`).join('\n');
  if (!html && d.introductory_paragraph) html = d.introductory_paragraph;
  if (!html && d.introduction) html = d.introduction;
  const docs = (j.links?.documents || []).map((x) => ({ title: x.title, url: `https://www.gov.uk${x.base_path}` }));
  const attach = (d.attachments || []).filter((a) => a.url).slice(0, 10).map((a) => ({ title: a.title, url: a.url.startsWith('http') ? a.url : `https://www.gov.uk${a.url}` }));
  const hist = d.change_history || [];
  const latest = hist.length ? hist[0] : null;
  return {
    text: htmlToText(html).slice(0, 12000),
    changeNote: latest?.note || j.change_note || '',
    firstPublished: j.first_published_at || null,
    updated: j.public_updated_at || null,
    attachments: [...attach, ...docs].slice(0, 12),
  };
}

// ---------- legislation.gov.uk (Atom) ----------
const LEG_FEEDS = [
  'https://www.legislation.gov.uk/uksi/data.feed?title=tax&sort=published',
  'https://www.legislation.gov.uk/uksi/data.feed?title=value%20added&sort=published',
  'https://www.legislation.gov.uk/uksi/data.feed?title=national%20insurance&sort=published',
  'https://www.legislation.gov.uk/uksi/data.feed?title=social%20security%20contributions&sort=published',
  'https://www.legislation.gov.uk/uksi/data.feed?title=finance%20act&sort=published',
  'https://www.legislation.gov.uk/ukpga/data.feed?title=finance&sort=published',
  'https://www.legislation.gov.uk/ukpga/data.feed?title=national%20insurance&sort=published',
];
function parseAtom(xml) {
  const entries = [];
  for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/g)) {
    const e = m[0];
    const tag = (t) => (e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1];
    const title = htmlToText((tag('title') || '').replace(/<!\[CDATA\[|\]\]>/g, ''));
    const id = tag('id') || '';
    const self = (e.match(/<link[^>]*rel="self"[^>]*href="([^"]+)"/) || e.match(/<link[^>]*href="([^"]+)"/) || [])[1];
    const published = tag('published') || tag('updated') || '';
    const summary = htmlToText((tag('summary') || '').replace(/<!\[CDATA\[|\]\]>/g, ''));
    entries.push({ title, id, url: (self || id).replace(/\/data\.feed$/, '').replace(/\/(data\.xml|contents)$/, ''), published, summary });
  }
  return entries;
}
async function fetchLegislation() {
  const out = new Map();
  for (const feed of LEG_FEEDS) {
    try {
      const xml = await getText(feed);
      const entries = parseAtom(xml);
      console.log(`legislation feed ${feed}: ${xml.length} bytes, ${entries.length} entries`);
      for (const e of entries) {
        if (!e.title || !e.published) continue;
        const d = new Date(e.published);
        if (isNaN(d) || d < SINCE) continue;
        if (EXCLUDE.test(e.title)) continue;
        const url = e.url.startsWith('http') ? e.url.replace(/^http:/, 'https:') : `https://www.legislation.gov.uk${e.url}`;
        const cats = classify(e.title);
        if (!out.has(url)) out.set(url, {
          id: idFor(url), title: e.title, url, date: d.toISOString(), type: 'legislation',
          source: 'legislation.gov.uk', description: e.summary.slice(0, 400), categories: [...new Set(['legislation', ...cats.filter((c) => c !== 'general')])],
        });
      }
      await sleep(300);
    } catch (err) {
      console.warn(`legislation feed failed ${feed}: ${err.message}`);
    }
  }
  return [...out.values()];
}

// ---------- Optional AI summary (grounded) ----------
function aiConfig() {
  if (process.env.GROQ_API_KEY) return { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b', name: 'Groq' };
  if (process.env.OPENROUTER_API_KEY) return { url: 'https://openrouter.ai/api/v1/chat/completions', key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b', name: 'OpenRouter' };
  return null;
}
const SYSTEM = `You are a UK tax technical reviewer supporting an ACCA accountant who runs a practice advising SMEs, owner-managed businesses and the self-employed.
You will be given the OFFICIAL text of a UK government publication. Use ONLY that text. Never add figures, dates, rates or legislation references that are not in the text.
If the text does not say something, write "Not stated in source".
Return strict JSON: {"summary": string (max 60 words, plain English), "whoAffected": string, "effectiveDate": string, "actions": string[] (max 4 practical steps for the practice), "legislationRefs": string[] (only references quoted in the text), "relevance": "high"|"medium"|"low" (relevance to SMEs/OMBs/self-employed)}.`;
async function aiSummarise(cfg, item, body) {
  const user = `Title: ${item.title}\nPublished/updated: ${item.date}\nSource URL: ${item.url}\nChange note: ${body?.changeNote || 'n/a'}\nDescription: ${item.description}\n\nOFFICIAL TEXT:\n${(body?.text || '').slice(0, 9000)}`;
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://sbhogaita19.github.io/taxlens-uk/', 'X-Title': 'TaxLens UK' },
    body: JSON.stringify({ model: cfg.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`${cfg.name} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const txt = j.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(txt.replace(/^```json|```$/g, '').trim());
  return { ...parsed, model: `${cfg.name}: ${cfg.model}`, generatedAt: new Date().toISOString() };
}

// ---------- main ----------
async function main() {
  await fs.mkdir(ITEMS_DIR, { recursive: true });
  let previous = { items: [] };
  try { previous = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}
  const prevById = new Map((previous.items || []).map((i) => [i.id, i]));

  const [gov, leg] = await Promise.all([fetchGovUk(), fetchLegislation()]);
  console.log(`GOV.UK items: ${gov.length}, legislation items: ${leg.length}`);
  if (gov.length + leg.length === 0 && prevById.size) {
    console.warn('No items fetched — keeping previous data unchanged.');
    return;
  }

  let items = [...gov, ...leg];
  // Fetch official body text for new/changed items
  const needBody = items.filter((i) => i.path && (previous.version !== DATA_VERSION || !prevById.has(i.id) || prevById.get(i.id).date !== i.date || !prevById.get(i.id).hasBody)).slice(0, MAX_BODY_FETCH);
  console.log(`Fetching official text for ${needBody.length} items…`);
  const bodies = new Map();
  await pool(needBody, 4, async (it) => {
    try {
      const b = await enrichBody(it);
      if (b) {
        bodies.set(it.id, b);
        await fs.writeFile(path.join(ITEMS_DIR, `${it.id}.json`), JSON.stringify({ id: it.id, url: it.url, title: it.title, fetchedAt: new Date().toISOString(), ...b }));
      }
    } catch (e) { console.warn(`content fetch failed ${it.url}: ${e.message}`); }
    await sleep(100);
  });

  items = items.map((it) => {
    const prev = prevById.get(it.id);
    const b = bodies.get(it.id);
    const merged = { ...it };
    if (b) {
      merged.hasBody = !!b.text; merged.changeNote = b.changeNote; merged.firstPublished = b.firstPublished;
      // re-classify using body too for better tagging
      const base = classify(`${it.title} ${it.description}`);
      merged.categories = base[0] === 'general' ? classify(`${it.title} ${it.description} ${b.text.slice(0, 600)}`) : base;
      if (it.type === 'legislation') merged.categories = ['legislation', ...merged.categories.filter((c) => c !== 'general')];
    } else if (prev) {
      merged.hasBody = prev.hasBody; merged.changeNote = prev.changeNote; merged.firstPublished = prev.firstPublished;
      merged.categories = it.categories[0] !== 'general' ? it.categories : (prev.categories || it.categories);
    }
    if (prev?.ai && prev.date === it.date) merged.ai = prev.ai;
    return merged;
  });

  // Keep previously known items that dropped out of search but are still within the window
  for (const [id, prev] of prevById) {
    if (!items.find((i) => i.id === id) && new Date(prev.date) >= SINCE && !EXCLUDE.test(`${prev.title} ${prev.description || ''}`)) items.push(prev);
  }
  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Optional AI summaries
  const cfg = aiConfig();
  if (cfg) {
    const todo = items.filter((i) => !i.ai && i.hasBody).slice(0, MAX_AI);
    console.log(`AI summarising ${todo.length} items with ${cfg.name}…`);
    for (const it of todo) {
      try {
        const body = JSON.parse(await fs.readFile(path.join(ITEMS_DIR, `${it.id}.json`), 'utf8'));
        it.ai = await aiSummarise(cfg, it, body);
      } catch (e) { console.warn(`AI failed for ${it.id}: ${e.message}`); }
      await sleep(1500);
    }
  } else {
    console.log('No GROQ_API_KEY / OPENROUTER_API_KEY secret set — skipping server-side AI summaries.');
  }

  const out = {
    version: DATA_VERSION,
    generatedAt: new Date().toISOString(),
    windowMonths: MONTHS_BACK,
    sources: ['GOV.UK Search & Content API (HMRC, HM Treasury, Companies House, The Pensions Regulator)', 'legislation.gov.uk Atom feeds'],
    categories: [...CATEGORIES.map(({ id, label }) => ({ id, label })), { id: 'legislation', label: 'New Legislation' }, { id: 'general', label: 'Other' }],
    count: items.length,
    items,
  };
  await fs.writeFile(OUT, JSON.stringify(out, null, 1));
  // Full-text search index (official text, lower-cased, trimmed) — loaded lazily by the app
  const index = [];
  for (const it of items) {
    let body = '';
    try { body = JSON.parse(await fs.readFile(path.join(ITEMS_DIR, `${it.id}.json`), 'utf8')).text || ''; } catch {}
    index.push([it.id, `${it.title} ${it.description || ''} ${it.changeNote || ''} ${body.slice(0, 4000)}`.toLowerCase().replace(/\s+/g, ' ')]);
  }
  await fs.writeFile(path.join(DATA, 'search-index.json'), JSON.stringify({ generatedAt: out.generatedAt, items: index }));
  // prune orphan item files
  const keep = new Set(items.map((i) => `${i.id}.json`));
  for (const f of await fs.readdir(ITEMS_DIR)) if (!keep.has(f) && f.endsWith('.json')) await fs.unlink(path.join(ITEMS_DIR, f));
  console.log(`Wrote ${items.length} items to data/updates.json`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
