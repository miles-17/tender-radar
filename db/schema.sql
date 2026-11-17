-- Tender Radar schema (Postgres + pgvector). Safe to re-run.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sites (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  url        text NOT NULL UNIQUE,
  kind       text NOT NULL DEFAULT 'auto',   -- html | json | rupali | egp | bppa | auto
  scope      text,
  added      text NOT NULL,
  baselined  boolean NOT NULL DEFAULT false, -- first successful scrape recorded what was already there
  section    text NOT NULL DEFAULT 'bank',   -- 'bank' or 'gov' (ministries & departments)
  pos        bigint GENERATED ALWAYS AS IDENTITY -- display order
);

CREATE TABLE IF NOT EXISTS tenders (
  id          text PRIMARY KEY,              -- sha1(site|url|title)
  site_id     text NOT NULL,
  title       text NOT NULL,
  url         text,
  published   text,                          -- YYYY-MM-DD when found on page
  context     text,
  org         text,                          -- "Ministry › Division › ..." for government tenders
  first_seen  text NOT NULL,
  last_seen   text NOT NULL,
  category    text,                          -- software | it | other
  score       real,                          -- software relevance, 0..1
  embedding   vector(384)                    -- bge-small-en-v1.5, normalized
);
-- Added with the Telegram bot; ADD COLUMN IF NOT EXISTS upgrades older databases.
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS closing   text;        -- YYYY-MM-DD submission deadline, when the source gives one
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS status    text;        -- team decision: 'bid' | 'not_relevant'
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS assignee  text;        -- who is handling it (Telegram name)
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS status_by text;        -- who set the status
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS marked_at timestamptz; -- when
CREATE INDEX IF NOT EXISTS tenders_site ON tenders (site_id);
CREATE INDEX IF NOT EXISTS tenders_cat ON tenders (category, score);

CREATE TABLE IF NOT EXISTS site_status (
  site_id    text PRIMARY KEY,
  last_run   text,
  ok         boolean,
  blocked    boolean,
  found      integer,
  new_items  integer,
  error      text
);
ALTER TABLE site_status ADD COLUMN IF NOT EXISTS fails integer NOT NULL DEFAULT 0; -- failed scrapes in a row

CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text);

-- Notices that were already on a site's page before the start date: never stored.
CREATE TABLE IF NOT EXISTS ignored (id text PRIMARY KEY, site_id text NOT NULL);

-- One row per scrape group ('banks', 'egp', 'bppa', 'site:<id>'); unfinished = running.
CREATE TABLE IF NOT EXISTS scrape_runs (
  grp       text PRIMARY KEY,
  started   timestamptz NOT NULL,
  finished  timestamptz
);

-- Telegram /watch phrases: new tenders that match one are posted right away.
CREATE TABLE IF NOT EXISTS watches (
  phrase     text PRIMARY KEY,               -- lower case
  embedding  vector(384) NOT NULL,
  added_by   text,
  added      timestamptz NOT NULL DEFAULT now()
);

-- Only the server (table owner) uses these tables. RLS with no policies keeps
-- Supabase's public REST API from reading or writing them.
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ignored ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE watches ENABLE ROW LEVEL SECURITY;
