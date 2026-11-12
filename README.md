# Tender Radar

Scrapes tender / RFP / RFQ notices from 36 Bangladeshi bank websites, scores each one for
software-development relevance with a local embedding model, stores them in SQLite, and shows
them on a dashboard.

Dashboard: http://127.0.0.1:8642

## How it works

| Part | File |
|---|---|
| Bank list and extractor per site | `src/sites.js` |
| HTML / embedded-JSON extraction | `src/extract.js` |
| Fetching via curl, captcha detection, Rupali Bank's POST endpoint | `src/fetch.js` |
| Relevance model (`Xenova/bge-small-en-v1.5`, runs on CPU, offline after first download) | `src/classify.js` |
| SQLite database (`data/tenders.db`) | `src/db.js` |
| Scrape loop + web server + API | `src/main.js`, `src/scraper.js` |
| Dashboard | `public/index.html` |

Each tender is labelled `software`, `it` (hardware / networking) or `other`, with a 0–100 %
software score. The search box ranks results by meaning using the same model.

Only new tenders are kept, from the start date in the `settings` table (`since`, set on the first
run) onwards:

- a tender whose page date is before the start date is skipped;
- an undated tender that was already listed at a site's first successful scrape is treated as old.

Skipped notices are recorded in the `ignored` table, so later scrapes don't re-add them.

Sites behind a captcha or bot check (Southeast Bank, Shahjalal Islami Bank, IFIC Bank, and at times
Bengal Commercial Bank, at the time of writing) are reported as "Blocked" on the dashboard and are
not bypassed. Check those manually.

Not covered: Bangladesh Commerce Bank (its tender list is behind a firewall that rejects scripts),
Dhaka Bank, Mutual Trust Bank and Standard Chartered (no tender page on their sites).

Some banks (NCC, National Bank) serve an incomplete SSL certificate chain. Like a browser, the
scraper downloads the missing intermediate certificate named in the site's certificate and still
verifies the full chain (`data/ca-bundle.pem`).

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

## Running

It runs as a systemd user service, scraping every 3 hours. It starts at boot and restarts if it crashes.

```bash
systemctl --user status tender-scraper      # is it running?
journalctl --user -u tender-scraper -f      # live log
systemctl --user restart tender-scraper     # after editing code
systemctl --user stop tender-scraper        # stop
systemctl --user disable --now tender-scraper  # stop and don't start at boot
```

Settings live in `~/.config/systemd/user/tender-scraper.service` (`PORT`, `HOST`, `SCRAPE_HOURS`).
Run `systemctl --user daemon-reload && systemctl --user restart tender-scraper` after changing it.
Set `HOST=0.0.0.0` to open the dashboard from other devices on your network. It has no login,
so only do that on a network you trust.

One-off scrape without the server: `npm run scrape-once`.

## Adding or removing a site

On the dashboard, open **Sources**, paste the tender page link and click **Add site**. It is
scraped straight away, and then on every scheduled run. **Remove** on a source deletes that
site and its scraped tenders.

The site list lives in the database (`sites` table). `src/sites.js` only seeds it the first time
the app runs on an empty database.
