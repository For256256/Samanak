import * as db from './db.js';
import { config, cityTitle } from './config.js';
import { fa, formatJalali, addDaysISO, todayISO } from './utils.js';

const esc = (s = '') =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** تاریخ امروز به وقت منطقه تنظیم‌شده (پیش‌فرض تهران) */
export function localNow() {
  const tz = db.getSetting('TIMEZONE', 'Asia/Tehran');
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    tz,
  };
}

/**
 * ارسال پیام به فهرستی از کاربران با فاصله، تا محدودیت نرخ تلگرام رد نشود.
 * خروجی: { sent, failed }
 */
export async function sendToMany(bot, ids, text, { parse_mode = 'HTML', gap = 60 } = {}) {
  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await bot.api.sendMessage(id, text, { parse_mode });
      sent += 1;
    } catch (err) {
      failed += 1;
      // کاربری که ربات را بلاک کرده یا چت را حذف کرده، خطای دائمی می‌دهد
      if (!/blocked|deactivated|chat not found/i.test(err.description || err.message || ''))
        console.error('broadcast failed for', id, err.description || err.message);
    }
    if (gap) await new Promise((r) => setTimeout(r, gap));
  }
  return { sent, failed };
}

const AUDIENCE_LABEL = {
  all: 'همه کاربران',
  approved: 'دارندگان رزرو تاییدشده',
  pending: 'رزروهای در انتظار تایید',
  upcoming: 'رزروهای آیندهٔ تاییدشده',
};

export const audienceLabel = (a, cityKey) =>
  a === 'city' ? `کاربران ${cityTitle(cityKey)}` : AUDIENCE_LABEL[a] || a;

/** پیام همگانی به مخاطبان انتخاب‌شده */
export async function broadcast(bot, { body, audience, cityKey = null, adminId = null }) {
  const ids = db.broadcastTargets(audience, cityKey);
  const text = `📢 <b>اطلاع‌رسانی</b>\n\n${body}`;
  const res = await sendToMany(bot, ids, text);
  db.logBroadcast({
    body, audience: audience === 'city' ? `city:${cityKey}` : audience,
    sent: res.sent, failed: res.failed, created_by: adminId,
  });
  return { ...res, total: ids.length };
}

/** پیام به یک کاربر مشخص */
export async function messageUser(bot, tgId, body) {
  try {
    await bot.api.sendMessage(tgId, `✉️ <b>پیام از مدیریت</b>\n\n${body}`, { parse_mode: 'HTML' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.description || err.message };
  }
}

function checkoutText(r) {
  const end = addDaysISO(r.start_date, r.nights - 1);
  return (
    '⏰ <b>پایان مدت اقامت</b>\n\n' +
    `${esc(r.full_name)} عزیز، امروز <b>${formatJalali(end)}</b> آخرین روز اقامت شما ` +
    `در <b>${cityTitle(r.city)}</b> است.\n\n` +
    `کد رهگیری: <code>${r.tracking || '—'}</code>\n\n` +
    'لطفاً برای تخلیه و تحویل اتاق با خادم اقامتگاه هماهنگ کنید.\n' +
    'برای تمدید، درخواست جدیدی ثبت کنید — تمدید خودکار انجام نمی‌شود.'
  );
}

/**
 * یادآوری پایان اقامت: در ساعت تنظیم‌شده (پیش‌فرض ۸ صبح) روز آخر رزرو.
 * هر رزرو فقط یک‌بار یادآوری می‌گیرد.
 */
export async function runCheckoutReminders(bot, { force = false } = {}) {
  if (db.getSetting('CHECKOUT_NOTIFY', 'on') !== 'on') return { sent: 0, skipped: 'disabled' };

  const { iso, hour } = localNow();
  const target = db.getSettingNum('CHECKOUT_HOUR', 8);
  if (!force && hour !== target) return { sent: 0, skipped: 'not_hour' };

  const due = db.checkoutDueOn(iso);
  let sent = 0;
  for (const r of due) {
    try {
      await bot.api.sendMessage(r.tg_id, checkoutText(r), { parse_mode: 'HTML' });
      db.markCheckoutNotified(r.id);
      sent += 1;
    } catch (err) {
      // بلاک‌کردن ربات نباید باعث تلاش بی‌پایان شود
      db.markCheckoutNotified(r.id);
      console.error('checkout reminder failed for', r.tg_id, err.description || err.message);
    }
    await new Promise((res) => setTimeout(res, 60));
  }
  return { sent, due: due.length };
}

/** بررسی هر ۱۰ دقیقه؛ ارسال فقط در ساعت هدف */
export function startCheckoutScheduler(bot) {
  const tick = () => runCheckoutReminders(bot).catch((e) =>
    console.error('checkout scheduler', e.message));
  tick();
  const timer = setInterval(tick, 10 * 60 * 1000);
  timer.unref?.();
  return timer;
}
