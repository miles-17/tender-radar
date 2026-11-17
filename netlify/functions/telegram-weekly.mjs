// Sundays at 9 am in Dhaka (the start of the work week): the week's summary.
import { sendWeekly } from '../../src/notify.js';

export default async () => { await sendWeekly(); };

export const config = { schedule: '0 3 * * 0' };
