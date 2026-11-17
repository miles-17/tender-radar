// Run scrape groups from this computer, against DATABASE_URL (for testing):
//   node scripts/scrape.mjs            all groups
//   node scripts/scrape.mjs banks egp  just these
import { allGroups } from '../src/groups.js';
import { scrapeGroup } from '../src/scraper.js';
import { sql } from '../src/db.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const groups = process.argv.length > 2 ? process.argv.slice(2) : await allGroups();
for (const g of groups) await scrapeGroup(g, log);
await sql.end();
