# Tender Radar

Scrapes tender / RFP / RFQ notices from 36 Bangladeshi bank websites and the national
government sources, scores each one for software-development relevance with an embedding
model, stores them in Postgres (Supabase), and shows them on a password-protected dashboard
hosted on Netlify.

## How it works

| Part | File |
|---|---|
| Bank list and extractor per site | `src/sites.js` |
| HTML / embedded-JSON extraction | `src/extract.js` |
| Fetching, captcha detection, Rupali Bank's POST endpoint | `src/fetch.js` |
| Relevance model (`Xenova/bge-small-en-v1.5`, runs on CPU) | `src/classify.js` |
| Database access (Postgres + pgvector) | `src/db.js`, schema in `db/schema.sql` |
| Scrape groups and scrape run | `src/groups.js`, `src/scraper.js` |
| Dashboard API (`/api/*`) | `netlify/functions/api.mjs` |
| Scrape every 12 hours | `netlify/functions/scrape-scheduled.mjs` |
| Telegram bot: messages it posts (digest, alerts, reminders, weekly) | `src/notify.js`, `src/telegram.js` |
| Telegram bot: commands and buttons (webhook) | `netlify/functions/telegram-background.mjs` |
| Deadline reminders (daily) and weekly summary (Sundays) | `netlify/functions/telegram-reminders.mjs`, `telegram-weekly.mjs` |
| Scrape one group (background function, up to 15 minutes) | `netlify/functions/scrape-background.mjs` |
| Password gate | `netlify/edge-functions/gate.js` |
| Dashboard | `public/index.html` |

A scrape is split into groups so each fits in one 15-minute background function: all bank
pages (fetched 6 at a time), e-GP, and BPPA. A site added on the dashboard is scraped on its
own straight away (its group is its id). The dashboard shows "Scraping now…" while any group is running.

Search by meaning runs the same model in the browser: the first search downloads it (~34 MB,
then cached by the browser). If it can't load, the search matches words in titles instead.

Each tender is labelled `software`, `it` (hardware / networking) or `other`, with a 0–100 %
software score. The search box ranks results by meaning using the same model.

Only new tenders are kept, from the start date in the `settings` table (`since`, set on the first
run) onwards:

- a tender whose page date is before the start date is skipped;
- an undated tender that was already listed at a site's first successful scrape is treated as old.

Skipped notices are recorded in the `ignored` table, so later scrapes don't re-add them.

Sites behind a captcha or bot check (Southeast Bank, Shahjalal Islami Bank, IFIC Bank, Rupali Bank,
Uttara Bank, and at times Bengal Commercial Bank, at the time of writing) are reported as "Blocked" on the dashboard and are
not bypassed. Check those manually.

Not covered: Bangladesh Commerce Bank (its tender list is behind a firewall that rejects scripts),
Dhaka Bank, Mutual Trust Bank and Standard Chartered (no tender page on their sites).

Some banks (NCC, National Bank) serve an incomplete SSL certificate chain. Like a browser, the
scraper downloads the missing intermediate certificate named in the site's certificate and still
verifies the full chain.

## Ministries & Departments

The dashboard's **Ministries & Departments** section holds government tenders from two
national sources, each tagged with its ministry, division and organisation:

| Source | What | How |
|---|---|---|
| e-GP (eprocure.gov.bd) | All ministries' live e-tenders | Public "Advanced Search" list, tenders published since yesterday, 100 per page |
| BPPA (bppa.gov.bd) | Newspaper advertisements: goods, works, services, physical services | Each ministry's filtered list, newest page (~200 requests, about 6 minutes) |

The ministry dropdown is built from the tenders held, so a ministry appears once it has
published something since the start date. Embassies, international organisations and
associations are not covered: they don't publish through e-GP or BPPA.

## Hosting

Netlify (site, functions, password gate) and Supabase (database). Netlify environment variables:

| Variable | What |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** connection string (port 6543) |
| `SITE_PASSWORD` | The shared dashboard password. Changing it signs everyone out. |
| `SCRAPE_KEY` | Long random string; lets the API and schedule start background scrapes |
| `TELEGRAM_BOT_TOKEN` | The bot's token from @BotFather (optional: no Telegram bot without it) |
| `TELEGRAM_CHAT_ID` | The Telegram group the bot serves (a negative number) |

Scrapes run at 00:00 and 12:00 UTC (6 am and 6 pm in Dhaka). That keeps the site within the
Netlify Free plan's monthly credits; scraping more often needs a paid plan. Function logs are
under **Logs → Functions** in the Netlify dashboard.

## Telegram bot

The bot serves one group (`TELEGRAM_CHAT_ID`) and ignores every other chat. It posts:

- **Digest**, when a scrape finishes: software tenders first seen since the last digest,
  grouped by institution (the bank, or the ministry for government tenders), each linking to
  its notice. Nothing when there are none.
- **Watch alerts**, when a scrape finds a tender matching a `/watch` phrase (by meaning, the
  same measure as the dashboard search, at a stricter 0.7).
- **Site problems**, when a site fails 3 scrapes in a row, and when it works again.
- **Deadlines**, every day at 9 am in Dhaka: tenders marked "We'll bid" or taken that close
  today, tomorrow or in 3 days. Deadlines come from e-GP and BPPA lists, and from "date of
  submission" text in bank notices; tenders without one get no reminder.
- **Weekly summary**, Sundays at 9 am in Dhaka.

Every tender it lists has three buttons: **We'll bid**, **Not relevant** and **Take it**
(pressing one again clears it). The dashboard shows these marks, and lists "Not relevant"
tenders last. Marked tenders also teach the classifier: a new tender much like one marked
"Not relevant" is scored as not software, and one like a "We'll bid" tender as software.

Commands: `/latest`, `/search words`, `/bank name`, `/watch phrase`, `/unwatch phrase`,
`/watches`, `/scrape`, `/help`.

Set up (once): add the bot to the group, set the two variables above, deploy, then point the
bot at the site and fill its command menu:

```bash
TELEGRAM_BOT_TOKEN=... SCRAPE_KEY=... URL=https://your-site.netlify.app node scripts/setup-telegram.mjs
```

The webhook only accepts calls carrying a secret derived from `SCRAPE_KEY`, so run the script
again after changing `SCRAPE_KEY`.

Set up an empty database (creates the tables, seeds the bank list, start date = today; safe to
re-run, it keeps existing settings and sites):

```bash
DATABASE_URL=... npm run setup-db
```

## Adding or removing a site

On the dashboard, open **Sources**, paste the tender page link and click **Add site**. It is
scraped straight away, and then on every scheduled run. **Remove** on a source deletes that
site and its scraped tenders.

The site list lives in the database (`sites` table). `src/sites.js` only seeds it when `npm run setup-db`
sets up an empty database.
