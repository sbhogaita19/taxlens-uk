# TaxLens UK

**Official UK tax & accountancy updates for practices advising SMEs, owner-managed businesses and the self-employed** — PAYE, National Insurance, personal tax & Self Assessment, Corporation Tax, Capital Gains Tax, VAT, MTD, IHT/BPR, Companies House and auto-enrolment.

**Open the app:** https://sbhogaita19.github.io/taxlens-uk/

## What it does

| Feature | Details |
|---|---|
| **Daily official updates** | Pulled every morning (and weekday lunchtimes) from GOV.UK — HMRC, HM Treasury, Companies House, The Pensions Regulator — and new tax legislation on legislation.gov.uk. Customs/excise/service-status noise is filtered out. |
| **Tagged by tax head** | PAYE, NIC, Personal tax, Self-employed, Corporation Tax, CGT, VAT, MTD, IHT, Companies House, Pensions, Compliance, Budget, Agents. |
| **Official text stored** | The full official wording and change note is saved with every item, plus a direct link to the source. |
| **Practitioner review (AI)** | One tap produces an accountant's review of an update: clients affected, effective date, exact figures, practice impact, action checklist — generated **only** from the official text. |
| **Practice briefing (AI)** | Turns the updates on screen (e.g. last 7 days) into a partner-level briefing with numbered citations to GOV.UK. |
| **Ask AI** | Questions answered only from the stored official updates and the verified rates table, with citations. |
| **Draft client note** | Plain-English client email from an official update. |
| **Rates 2026/27** | Key rates and thresholds, each linked to the GOV.UK page it was checked against. |
| **Deadlines** | Upcoming SA, PAYE, P11D, MTD dates + company CT/CT600/Companies House/VAT date calculator. |

## Install it like an app

- **Mac (Chrome/Edge):** open the link → click **Install app** (or the install icon in the address bar).
- **Mac (Safari, macOS Sonoma+):** File → **Add to Dock**.
- **iPhone/iPad:** Safari → Share → **Add to Home Screen**.
- **Android / Windows:** browser menu → **Install app**.

## Set up AI (Groq or OpenRouter)

1. Get a key: [console.groq.com/keys](https://console.groq.com/keys) or [openrouter.ai/keys](https://openrouter.ai/keys).
2. In the app → **Settings** → choose provider, paste key, **Test connection**.
   The key stays in that browser only.

**Optional — AI summaries for everyone, automatically:** in this repo go to
*Settings → Secrets and variables → Actions → New repository secret* and add `GROQ_API_KEY` (or `OPENROUTER_API_KEY`).
The daily job will then add a short grounded summary + relevance rating to each new update.

## How accuracy is protected

1. **Sources are official only** — GOV.UK Content/Search APIs and legislation.gov.uk. No blogs or news sites.
2. **AI is grounded** — it receives only the official text and is told not to add figures, dates or references that aren't in it, to say "not covered" otherwise, and to cite every point.
3. **Everything links back** — every summary, review and answer has a link to the official page to verify.
4. **AI output is always labelled** as AI-generated.

> AI can still misread a source. Treat AI output as a first-pass review and confirm against the linked official text before advising a client. This tool supports professional judgement; it is not tax advice.

## How it works

```
GitHub Actions (daily) ──► scripts/fetch-updates.mjs ──► data/updates.json + data/items/*.json
                                       │                         │
                   GOV.UK / legislation.gov.uk          GitHub Pages (static app, installable PWA)
                                                                  │
                                                  Browser ──► Groq / OpenRouter (your key)
```

- Run a refresh now: **Actions → Update official data & deploy → Run workflow**.
- Update the rates table: edit `data/rates.json` (keep the `source` links and `lastVerified` date).
- No servers, no database, no cost beyond optional AI usage.
