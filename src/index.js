import { Bot, GrammyError, HttpError } from 'grammy';
import { config } from './config.js';
import { registerFlow } from './flow.js';

if (!config.token) {
  console.error('BOT_TOKEN تنظیم نشده است. فایل .env را بررسی کنید.');
  process.exit(1);
}
if (!config.admins.super.length) {
  console.error('SUPER_ADMIN_IDS تنظیم نشده است. فایل .env را بررسی کنید.');
  process.exit(1);
}

const bot = new Bot(config.token);
registerFlow(bot);

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error('خطای تلگرام:', e.description);
  else if (e instanceof HttpError) console.error('خطای شبکه:', e);
  else console.error('خطای ناشناخته:', e);
});

await bot.api.setMyCommands([
  { command: 'start', description: 'شروع و منوی اصلی' },
  { command: 'mine', description: 'رزروهای من' },
  { command: 'cancel', description: 'لغو عملیات جاری' },
]);

const stop = () => bot.stop();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.log(
  'ربات در حال اجراست | ادمین کل:', config.admins.super.join(','),
  '| نجف:', config.admins.najaf.join(',') || '-',
  '| کربلا:', config.admins.karbala.join(',') || '-'
);
await bot.start({ drop_pending_updates: true });
