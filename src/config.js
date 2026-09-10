import { env } from './env.js';
import * as db from './db.js';

// در اولین اجرا تنظیمات از .env به دیتابیس منتقل می‌شود
db.seedFromEnv();

/**
 * تنظیمات زنده: همه از دیتابیس خوانده می‌شوند تا تغییرات داشبورد
 * بدون ری‌استارت ربات اثر کند. فقط توکن و مسیرها از .env می‌آیند.
 */
export const config = {
  token: env.token,
  apiRoot: env.apiRoot,
  dbPath: env.dbPath,

  get maxNights() { return db.getSettingNum('MAX_NIGHTS', 7); },
  get maxDaysAhead() { return db.getSettingNum('MAX_DAYS_AHEAD', 120); },
  get maxPerBooking() { return db.getSettingNum('MAX_PER_BOOKING', 10); },

  /** off | optional | required */
  get requireDocument() { return db.getSetting('REQUIRE_DOCUMENT', 'optional'); },
  get welcomeExtra() { return db.getSetting('WELCOME_EXTRA', ''); },

  get admins() {
    const out = { super: db.superAdminIds() };
    for (const c of db.listCities()) out[c.key] = db.cityAdminIds(c.key);
    return out;
  },

  get adminChats() {
    const out = {};
    for (const c of db.listCities()) {
      const v = db.getSetting(`ADMIN_CHAT_${c.key}`, '');
      out[c.key] = v ? Number(v) : null;
    }
    return out;
  },

  /** شهرهای فعال به شکل { key: { key, title, men, women } } */
  get cities() {
    const out = {};
    for (const c of db.listCities(true)) {
      const cap = db.cityCapacity(c.key);
      out[c.key] = { key: c.key, title: c.title, id: c.id, men: cap.men, women: cap.women };
    }
    return out;
  },
};

/** کلید همه شهرها (شامل غیرفعال‌ها) */
export const cityKeysAll = () => db.listCities().map((c) => c.key);

/** کلید شهرهای فعال — برای گزارش‌ها و منوی رزرو */
export const cityKeys = () => db.listCities(true).map((c) => c.key);

export const cityTitle = (key) => {
  const c = db.getCityByKey(key);
  return c ? c.title : key;
};

export const isSuperAdmin = (id) => db.superAdminIds().includes(Number(id));

/** شهرهایی که این کاربر اجازه تایید آنها را دارد */
export function adminCities(id) {
  const keys = Object.keys(config.cities);
  if (isSuperAdmin(id)) return keys;
  return keys.filter((c) => db.cityAdminIds(c).includes(Number(id)));
}

export const isAnyAdmin = (id) => adminCities(id).length > 0;

export const canApprove = (id, city) => adminCities(id).includes(city);

/** نقش خوانا برای نمایش */
export function roleLabel(id) {
  if (isSuperAdmin(id)) return 'ادمین کل';
  const c = adminCities(id);
  return c.length ? `ادمین ${c.map(cityTitle).join(' و ')}` : 'کاربر';
}
