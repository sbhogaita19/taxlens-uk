// TaxLens UK — builds a section-heading index of the key UK tax Acts/SIs from legislation.gov.uk
// so the app can search sections instantly. Runs in GitHub Actions (weekly refresh is enough;
// the section TEXT is always fetched live from legislation.gov.uk when opened in the app).

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'data', 'legislation-index.json');
const MAX_AGE_DAYS = Number(process.env.LEG_INDEX_MAX_AGE_DAYS || 7);
const UA = 'TaxLensUK/1.0 (+https://github.com/sbhogaita19/taxlens-uk)';

// short = abbreviation practitioners use; aliases help the citation parser in the app
export const KEY_LEGISLATION = [
  { short: 'ITTOIA 2005', path: 'ukpga/2005/5', aliases: ['ittoia'], area: 'Income tax — trading, property, savings & dividends' },
  { short: 'ITEPA 2003', path: 'ukpga/2003/1', aliases: ['itepa'], area: 'Employment income & benefits' },
  { short: 'ITA 2007', path: 'ukpga/2007/3', aliases: ['ita', 'ita 2007'], area: 'Income tax — reliefs, losses, anti-avoidance' },
  { short: 'CTA 2009', path: 'ukpga/2009/4', aliases: ['cta 2009', 'cta09'], area: 'Corporation tax — profits, R&D, loan relationships, IFAs' },
  { short: 'CTA 2010', path: 'ukpga/2010/4', aliases: ['cta 2010', 'cta10'], area: 'Corporation tax — rates, losses, groups, close companies' },
  { short: 'TCGA 1992', path: 'ukpga/1992/12', aliases: ['tcga'], area: 'Capital gains tax' },
  { short: 'CAA 2001', path: 'ukpga/2001/2', aliases: ['caa'], area: 'Capital allowances' },
  { short: 'VATA 1994', path: 'ukpga/1994/23', aliases: ['vata'], area: 'VAT' },
  { short: 'VAT Regs 1995', path: 'uksi/1995/2518', aliases: ['vat regulations', 'vat regs', 'vatr'], area: 'VAT administration' },
  { short: 'PAYE Regs 2003', path: 'uksi/2003/2682', aliases: ['paye regulations', 'paye regs'], area: 'PAYE' },
  { short: 'SSCBA 1992', path: 'ukpga/1992/4', aliases: ['sscba'], area: 'National Insurance' },
  { short: 'NMW Regs 2015', path: 'uksi/2015/621', aliases: ['nmw regulations', 'nmw regs'], area: 'Minimum wage' },
  { short: 'IHTA 1984', path: 'ukpga/1984/51', aliases: ['ihta'], area: 'Inheritance tax, BPR & APR' },
  { short: 'TMA 1970', path: 'ukpga/1970/9', aliases: ['tma'], area: 'Returns, enquiries, assessments' },
  { short: 'TIOPA 2010', path: 'ukpga/2010/8', aliases: ['tiopa'], area: 'International, transfer pricing' },
  { short: 'CA 2006', path: 'ukpga/2006/46', aliases: ['ca 2006', 'companies act', 'companies act 2006'], area: 'Companies Act — accounts, audit, filing' },
];

const decode = (s = '') => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
async function getText(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) { if (i === 2) throw e; await new Promise((res) => setTimeout(res, 1500 * (i + 1))); }
  }
}

async function latestFinanceActs() {
  try {
    const xml = await getText('https://www.legislation.gov.uk/ukpga/data.feed?title=finance%20act');
    const acts = [];
    for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/g)) {
      const title = decode((m[0].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
      const id = (m[0].match(/<id>([^<]+)<\/id>/) || [])[1] || '';
      const p = (id.match(/(ukpga\/\d{4}\/\d+)/) || [])[1];
      if (p && /^Finance (\(No\. ?\d\) )?Act \d{4}$/.test(title)) acts.push({ title, path: p, year: Number(p.split('/')[1]) });
    }
    const thisYear = new Date().getFullYear();
    return acts.filter((a) => a.year >= thisYear - 2).sort((a, b) => b.year - a.year || b.path.localeCompare(a.path))
      .map((a) => ({ short: a.title.replace('Finance ', 'FA ').replace(' Act', ''), path: a.path, aliases: [a.title.toLowerCase(), `fa ${a.year}`], area: 'Recent Finance Act' }));
  } catch (e) { console.warn('Finance Act feed failed:', e.message); return []; }
}

async function indexAct(act) {
  const xml = await getText(`https://www.legislation.gov.uk/${act.path}/contents/data.xml`);
  const title = decode((xml.match(/<dc:title>([\s\S]*?)<\/dc:title>/) || [])[1]) || act.short;
  const valid = (xml.match(/<dct:valid>([^<]+)<\/dct:valid>/) || [])[1] || null;
  const status = (xml.match(/<ukm:DocumentStatus Value="([^"]+)"/) || [])[1] || null;
  const items = [];
  const re = /<(ContentsItem|ContentsSchedule)\s[^>]*DocumentURI="https?:\/\/www\.legislation\.gov\.uk\/([^"]+)"[^>]*>\s*(?:<ContentsNumber>([\s\S]*?)<\/ContentsNumber>)?\s*(?:<ContentsTitle>([\s\S]*?)<\/ContentsTitle>)?/g;
  for (const m of xml.matchAll(re)) {
    const rel = m[2].replace(`${act.path}/`, '');
    if (!/^(section|regulation|schedule|article|rule)\//.test(rel) || /\/paragraph\//.test(rel)) continue;
    items.push([decode(m[3] || ''), decode(m[4] || ''), rel]);
  }
  return { ...act, title, valid, status, items };
}

async function main() {
  try {
    const prev = JSON.parse(await fs.readFile(OUT, 'utf8'));
    const age = (Date.now() - new Date(prev.generatedAt)) / 864e5;
    if (age < MAX_AGE_DAYS && !process.env.FORCE_LEG_INDEX) { console.log(`Legislation index is ${age.toFixed(1)} days old — skipping rebuild.`); return; }
  } catch {}
  const list = [...(await latestFinanceActs()), ...KEY_LEGISLATION];
  const acts = [];
  for (const act of list) {
    try {
      const a = await indexAct(act);
      console.log(`${a.short}: ${a.items.length} provisions (revised to ${a.valid || 'n/a'})`);
      if (a.items.length) acts.push(a);
    } catch (e) { console.warn(`index failed ${act.short}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!acts.length) { console.warn('No legislation indexed — keeping previous file.'); return; }
  await fs.writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'legislation.gov.uk', acts }));
  console.log(`Wrote legislation index: ${acts.length} Acts/SIs`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
