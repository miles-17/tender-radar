// Every 12 hours (00:00 and 12:00 UTC = 6 am / 6 pm in Dhaka): start a full scrape.
import { allGroups } from '../../src/groups.js';
import { triggerScrape } from '../../src/trigger.js';

export default async () => {
  const started = await triggerScrape(await allGroups());
  console.log('started:', started.join(', ') || 'nothing (already running)');
};

export const config = { schedule: '0 0,12 * * *' };
