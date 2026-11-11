# Tender Radar

Scrapes tender / RFP / RFQ notices from 16 Bangladeshi bank websites, scores each one for
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

Sites behind a captcha (Southeast Bank, Shahjalal Islami Bank, IFIC Bank at the time of writing)
are reported as "Blocked" on the dashboard and are not bypassed. Check those manually.

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
