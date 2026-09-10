import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const ids = (v) =>
  (v || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);

export const config = {
  token: process.env.BOT_TOKEN || '',
  dbPath: process.env.DB_PATH || './data/bot.db',
  maxNights: num(process.env.MAX_NIGHTS, 7),
  maxDaysAhead: num(process.env.MAX_DAYS_AHEAD, 120),
  maxPerBooking: num(process.env.MAX_PER_BOOKING, 10),

  // سه نقش ادمین
  admins: {
    super: ids(process.env.SUPER_ADMIN_IDS),
    najaf: ids(process.env.ADMIN_NAJAF_IDS),
    karbala: ids(process.env.ADMIN_KARBALA_IDS),
  },

  // اختیاری: گروه اختصاصی هر شهر
  adminChats: {
    najaf: process.env.ADMIN_CHAT_NAJAF ? Number(process.env.ADMIN_CHAT_NAJAF) : null,
    karbala: process.env.ADMIN_CHAT_KARBALA ? Number(process.env.ADMIN_CHAT_KARBALA) : null,
  },

  cities: {
    najaf: {
      key: 'najaf',
      title: 'نجف',
      men: num(process.env.CAP_NAJAF_MEN, 40),
      women: num(process.env.CAP_NAJAF_WOMEN, 40),
    },
    karbala: {
      key: 'karbala',
      title: 'کربلا',
      men: num(process.env.CAP_KARBALA_MEN, 40),
      women: num(process.env.CAP_KARBALA_WOMEN, 40),
    },
  },
};

export const CITY_KEYS = Object.keys(config.cities);

export const cityTitle = (key) => config.cities[key]?.title || key;

export const isSuperAdmin = (id) => config.admins.super.includes(Number(id));

/** شهرهایی که این کاربر اجازه تایید آنها را دارد */
export function adminCities(id) {
  if (isSuperAdmin(id)) return [...CITY_KEYS];
  return CITY_KEYS.filter((c) => (config.admins[c] || []).includes(Number(id)));
}

export const isAnyAdmin = (id) => adminCities(id).length > 0;

export const canApprove = (id, city) => adminCities(id).includes(city);

/** نقش خوانا برای نمایش */
export function roleLabel(id) {
  if (isSuperAdmin(id)) return 'ادمین کل';
  const c = adminCities(id);
  return c.length ? `ادمین ${c.map(cityTitle).join(' و ')}` : 'کاربر';
}
