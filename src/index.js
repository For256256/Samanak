import { Bot, GrammyError, HttpError } from 'grammy';
import { config, cityKeys, cityTitle } from './config.js';
import { registerFlow, setBotUsername, sendVoucherFor } from './flow.js';
import { startPanel } from './panel/server.js';
import { broadcast, messageUser, startCheckoutScheduler } from './notify.js';

if (!config.token) {
  console.error('BOT_TOKEN تنظیم نشده است. فایل .env را بررسی کنید.');
  process.exit(1);
}
if (!config.admins.super.length) {
  console.error('SUPER_ADMIN_IDS تنظیم نشده است. فایل .env را بررسی کنید.');
  process.exit(1);
}

const bot = new Bot(config.token,
  config.apiRoot ? { client: { apiRoot: config.apiRoot } } : undefined);
registerFlow(bot);

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error('خطای تلگرام:', e.description);
  else if (e instanceof HttpError) console.error('خطای شبکه:', e);
  else console.error('خطای ناشناخته:', e);
});

const PUBLIC_COMMANDS = [
  { command: 'start', description: 'شروع و منوی اصلی' },
  { command: 'mine', description: 'رزروهای من' },
  { command: 'cancel', description: 'لغو عملیات جاری' },
  { command: 'help', description: '📖 راهنمای رزرو' },
];

// دستورات ادمین شهر: رسیدگی، اسکن بلیت و جستجو
const ADMIN_COMMANDS = [
  ...PUBLIC_COMMANDS,
  { command: 'panel', description: '🛠 پنل ادمین' },
  { command: 'pending', description: '⏳ درخواست‌های در انتظار' },
  { command: 'scan', description: '📷 اسکن بلیت QR' },
  { command: 'find', description: '🔎 جستجو با کد رهگیری' },
  { command: 'guideimage', description: '🖼 گرفتن شناسه تصویر راهنما' },
];

// ادمین کل علاوه بر موارد بالا، گزارش و خروجی هم دارد
const SUPER_COMMANDS = [
  ...ADMIN_COMMANDS,
  { command: 'report', description: '📊 گزارش سامانه' },
  { command: 'export', description: '📥 خروجی اکسل' },
  { command: 'broadcast', description: '📢 پیام همگانی' },
];

await bot.api.setMyCommands(PUBLIC_COMMANDS);

// منوی دستورها برای هر ادمین جداگانه ثبت می‌شود تا کاربر عادی آن را نبیند
async function registerAdminCommands() {
  const admins = config.admins;
  const supers = new Set(admins.super);
  const cityAdmins = new Set();
  for (const key of cityKeys()) for (const id of admins[key] || []) cityAdmins.add(id);
  for (const id of cityAdmins) if (supers.has(id)) cityAdmins.delete(id);

  const targets = [
    ...[...supers].map((id) => [id, SUPER_COMMANDS]),
    ...[...cityAdmins].map((id) => [id, ADMIN_COMMANDS]),
  ];
  for (const [id, commands] of targets) {
    try {
      await bot.api.setMyCommands(commands, { scope: { type: 'chat', chat_id: id } });
    } catch (err) {
      // ادمینی که هنوز ربات را استارت نکرده، چت ندارد؛ نباید جلوی بالا آمدن ربات را بگیرد
      console.error(`ثبت دستورهای ادمین ${id} ناموفق بود:`, err.description || err.message);
    }
  }
}

await registerAdminCommands();

const me = await bot.api.getMe();
setBotUsername(me.username);

// داشبورد وب — تغییر ادمین‌ها منوی دستورهای تلگرام را دوباره ثبت می‌کند
const panel = startPanel({
  onAdminsChanged: () => { registerAdminCommands().catch(() => {}); },
  // تایید از داشبورد هم بلیت و لوکیشن را برای مهمان می‌فرستد
  onReservationApproved: (id) => { sendVoucherFor(bot, id).catch((e) => console.error('voucher', e.message)); },
  // ارسال همگانی در پس‌زمینه انجام می‌شود تا درخواست وب منتظر نماند
  onBroadcast: ({ body, audience, cityKey, imagePath }) => {
    broadcast(bot, { body, audience, cityKey, imagePath })
      .then((r) => console.log(`پیام همگانی: ${r.sent} ارسال، ${r.failed} ناموفق از ${r.total}`))
      .catch((e) => console.error('broadcast', e.message));
  },
  onSingleMessage: (tgId, body, imagePath) => messageUser(bot, tgId, body, imagePath),
});

// یادآوری پایان اقامت در ساعت تنظیم‌شده روز آخر رزرو
const checkoutTimer = startCheckoutScheduler(bot);

const stop = () => { clearInterval(checkoutTimer); panel?.close(); bot.stop(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

{
  const a = config.admins;
  const parts = cityKeys().map((k) => `${cityTitle(k)}: ${(a[k] || []).join(',') || '-'}`);
  console.log('ربات در حال اجراست | ادمین کل:', a.super.join(',') || '-', '|', parts.join(' | '));
}
await bot.start({ drop_pending_updates: true });
