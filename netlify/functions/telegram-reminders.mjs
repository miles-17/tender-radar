// Every morning at 9 am in Dhaka: deadlines of tenders the team is bidding on or has taken.
import { sendReminders } from '../../src/notify.js';

export default async () => { await sendReminders(); };

export const config = { schedule: '0 3 * * *' };
