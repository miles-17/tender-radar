// Point the bot at the site's webhook and fill its command menu. Run once, and
// again if the site's address or SCRAPE_KEY changes:
//   TELEGRAM_BOT_TOKEN=... SCRAPE_KEY=... URL=https://your-site.netlify.app node scripts/setup-telegram.mjs
import { call, webhookSecret } from '../src/telegram.js';

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.SCRAPE_KEY || !process.env.URL) {
  throw new Error('TELEGRAM_BOT_TOKEN, SCRAPE_KEY and URL must be set');
}
await call('setWebhook', {
  url: new URL('/.netlify/functions/telegram-background', process.env.URL).href,
  secret_token: webhookSecret(),
  allowed_updates: ['message', 'callback_query'],
});
await call('setMyCommands', {
  commands: [
    ['latest', 'The 10 newest software tenders, banks first'],
    ['search', 'Find tenders by meaning: /search core banking'],
    ['bank', "An institution's recent tenders: /bank City"],
    ['watch', 'Post matching tenders right away: /watch payment gateway'],
    ['unwatch', 'Stop watching a phrase'],
    ['watches', 'Phrases being watched'],
    ['scrape', 'Scrape every site now'],
    ['help', 'What Scrappy can do'],
  ].map(([command, description]) => ({ command, description })),
});
console.log('webhook and commands set:', (await call('getWebhookInfo', {})).url);
