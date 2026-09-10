import 'dotenv/config';

/**
 * مقادیر خام .env — فقط چیزهایی که در داشبورد قابل ویرایش نیستند
 * (توکن، مسیر دیتابیس، تنظیمات وب) و مقادیر اولیه برای اولین اجرا.
 * بقیه تنظیمات در دیتابیس نگهداری می‌شوند تا از داشبورد قابل تغییر باشند.
 */
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const ids = (v) =>
  (v || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);

export const env = {
  token: process.env.BOT_TOKEN || '',
  apiRoot: process.env.TELEGRAM_API_ROOT || '',
  dbPath: process.env.DB_PATH || './data/bot.db',
  docsDir: process.env.DOCS_DIR || '',

  // داشبورد وب
  panelPort: num(process.env.PANEL_PORT, 8080),
  panelHost: process.env.PANEL_HOST || '0.0.0.0',
  panelUser: process.env.PANEL_USER || 'admin',
  panelPassword: process.env.PANEL_PASSWORD || '',
  panelSecret: process.env.PANEL_SECRET || '',

  // مقادیر اولیه — فقط در اولین اجرا داخل دیتابیس ریخته می‌شوند
  seed: {
    superIds: ids(process.env.SUPER_ADMIN_IDS),
    najafIds: ids(process.env.ADMIN_NAJAF_IDS),
    karbalaIds: ids(process.env.ADMIN_KARBALA_IDS),
    chatNajaf: process.env.ADMIN_CHAT_NAJAF || '',
    chatKarbala: process.env.ADMIN_CHAT_KARBALA || '',
    maxNights: num(process.env.MAX_NIGHTS, 7),
    maxDaysAhead: num(process.env.MAX_DAYS_AHEAD, 120),
    maxPerBooking: num(process.env.MAX_PER_BOOKING, 10),
    capNajafMen: num(process.env.CAP_NAJAF_MEN, 40),
    capNajafWomen: num(process.env.CAP_NAJAF_WOMEN, 40),
    capKarbalaMen: num(process.env.CAP_KARBALA_MEN, 40),
    capKarbalaWomen: num(process.env.CAP_KARBALA_WOMEN, 40),
  },
};
