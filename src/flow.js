import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { InputFile, InlineKeyboard } from 'grammy';
import QRCode from 'qrcode';
import {
  config, cityKeys, cityTitle, isSuperAdmin, isAnyAdmin, adminCities,
  canApprove, roleLabel,
} from './config.js';
import * as db from './db.js';
import {
  mainMenu, cityKeyboard, counterKeyboard, calendarKeyboard, calendarForToday,
  nightsKeyboard, phoneKeyboard, reviewKeyboard, adminKeyboard,
  adminPanelKeyboard, checkinKeyboard, documentKeyboard,
  lodgingPickKeyboard, stayConfirmKeyboard, arrivalPickKeyboard, audienceKeyboard,
} from './keyboards.js';
import { decodeQrFromJpeg, parseVoucherPayload } from './qr.js';
import { env } from './env.js';
import { broadcast, audienceLabel } from './notify.js';
import {
  fa, formatJalali, isValidName, isValidNationalId, normalizeNationalId,
  normalizePhone, addDaysISO, todayISO, trackingCode,
} from './utils.js';

/** تصویر راهنمای رزرو — کنار سورس پروژه */
const GUIDE_IMAGE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'assets', 'guide.png');

/** پوشه مدارک شناسایی — کنار دیتابیس، با دسترسی محدود */
const DOCS_DIR = env.docsDir || path.join(path.dirname(env.dbPath), 'docs');

/** تصاویر آپلودشده ادمین از داشبورد */
const UPLOAD_DIR = path.join(path.dirname(env.dbPath), 'uploads');

const DOC_PROMPT = {
  required:
    '🪪 <b>مدرک شناسایی</b>\n\nتصویر <b>پاسپورت</b> یا کارت ملی سرپرست را ارسال کنید.\n' +
    'می‌توانید عکس بگیرید یا فایل بفرستید. برای چند نفر، چند تصویر بفرستید.',
  optional:
    '🪪 <b>مدرک شناسایی (اختیاری)</b>\n\nاگر تصویر <b>پاسپورت</b> یا کارت ملی دارید ارسال کنید.\n' +
    'در غیر این صورت دکمه «بدون مدرک» را بزنید.',
};

const WELCOME =
  '🕌 <b>سامانه رزرو اقامتگاه رایگان بیت‌الحسین</b>\n' +
  'اقامت رایگان در نجف و کربلا.\n\n' +
  'برای شروع یکی از گزینه‌ها را انتخاب کنید:';

/** نام کاربری ربات؛ در registerFlow پر می‌شود */
let BOT_USERNAME = '';
export const setBotUsername = (u) => { BOT_USERNAME = u || ''; };

/** لینک عمیق بلیت: اسکن با دوربین گوشی ربات را باز می‌کند */
const voucherLink = (code) =>
  BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=v_${code}` : String(code);

const SCAN_HELP =
  '📷 <b>اسکن بلیت</b>\n\n' +
  'یکی از این سه راه:\n' +
  '۱. با <b>دوربین گوشی</b> QR بلیت مهمان را اسکن کنید — ربات خودش باز می‌شود.\n' +
  '۲. از بلیت <b>عکس بگیرید</b> و همین‌جا بفرستید.\n' +
  '۳. <b>کد رهگیری</b> را تایپ کنید.';

/** پیش‌نمایش پیام همگانی با شمارش مخاطبان هر گروه */
function broadcastPreview(body) {
  return '📢 <b>پیش‌نمایش پیام همگانی</b>\n\n' + esc(body) +
    '\n\nمخاطبان را انتخاب کنید:';
}

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function summary(d) {
  const end = addDaysISO(d.start_date, d.nights - 1);
  return (
    `🕌 <b>خلاصه رزرو</b>\n\n` +
    `شهر: <b>${cityTitle(d.city)}</b>\n` +
    `نام: <b>${esc(d.full_name)}</b>\n` +
    `کد ملی: <code>${fa(d.national_id)}</code>\n` +
    `تعداد: <b>${fa(d.men)}</b> آقا، <b>${fa(d.women)}</b> خانم\n` +
    `از: <b>${formatJalali(d.start_date)}</b>\n` +
    `تا: <b>${formatJalali(end)}</b> (${fa(d.nights)} شب)\n` +
    (d.phone ? `تماس: <code>${d.phone}</code>\n` : '')
  );
}

/** پیام هشدار هم‌پوشانی تاریخ بین دو شهر */
const overlapMessage = (r) =>
  `⛔️ برای این کد ملی، رزرو <b>#${fa(r.id)}</b> در <b>${cityTitle(r.city)}</b> ` +
  `از ${formatJalali(r.start_date)} به مدت ${fa(r.nights)} شب ثبت شده است.\n\n` +
  'اقامت هم‌زمان در نجف و کربلا ممکن نیست. تاریخ بدون تداخل انتخاب کنید.';

/** مقصدهای اطلاع‌رسانی یک شهر: گروه شهر یا پی‌وی ادمین شهر + ادمین کل */
function adminTargets(city) {
  const set = new Set();
  if (config.adminChats[city]) set.add(config.adminChats[city]);
  else for (const id of config.admins[city] || []) set.add(id);
  for (const id of config.admins.super) set.add(id);
  return [...set];
}

async function notifyAdmins(bot, id) {
  const r = db.getReservation(id);
  const cap = db.capacityCheck(r.city, r.start_date, r.nights, r.men, r.women);
  const text =
    `🔔 <b>درخواست رزرو جدید #${fa(r.id)}</b> — ${cityTitle(r.city)}\n\n` +
    summary(r) +
    `\nکاربر: ${r.username ? '@' + esc(r.username) : '<code>' + r.tg_id + '</code>'}\n` +
    (cap.ok
      ? `ظرفیت آزاد: ${fa(cap.freeMen)} آقا / ${fa(cap.freeWomen)} خانم`
      : `⚠️ <b>ظرفیت کافی نیست</b> (آزاد: ${fa(cap.freeMen)} آقا / ${fa(cap.freeWomen)} خانم)`);

  for (const chatId of adminTargets(r.city)) {
    try {
      await bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: adminKeyboard(r.id),
      });
    } catch (err) {
      console.error('notifyAdmins failed for', chatId, err.message);
    }
  }
}

/** متن محل اسکان: اقامتگاه هر گروه، آدرس و توضیحات ادمین */
export function stayText(r) {
  const stays = db.stayLodgings(r);
  if (!stays.length) return '';
  let t = '\n🏠 <b>محل اسکان</b>\n';
  for (const { lodging, labels } of stays) {
    t += `\n<b>${esc(lodging.name)}</b> — ${labels.join(' و ')}\n`;
    if (lodging.address) t += `📍 ${esc(lodging.address)}\n`;
    if (lodging.note) t += `${esc(lodging.note)}\n`;
  }
  if (r.stay_note) t += `\n📝 <b>توضیحات:</b> ${esc(r.stay_note)}\n`;
  return t;
}

/** ارسال بلیت برای رزروی که از داشبورد تایید شده است */
export async function sendVoucherFor(bot, id) {
  const r = db.getReservation(id);
  if (r && r.status === 'approved') await sendVoucher(bot, r);
}

async function sendVoucher(bot, r) {
  // بلیت فقط کد رهگیری را حمل می‌کند (نه کد ملی و نام). با دوربین گوشی که
  // اسکن شود، ربات برای ادمین باز می‌شود و کارت رزرو را نشان می‌دهد.
  const payload = voucherLink(r.tracking);
  const png = await QRCode.toBuffer(payload, { width: 600, margin: 2 });
  await bot.api.sendPhoto(r.tg_id, new InputFile(png, 'voucher.png'), {
    caption:
      `✅ <b>رزرو شما تایید شد</b>\n\n` + summary(r) +
      `\nکد رهگیری: <code>${r.tracking}</code>\n` + stayText(r) +
      '\nاین تصویر را هنگام ورود به اقامتگاه ارائه دهید.',
    parse_mode: 'HTML',
  });

  // لوکیشن هر اقامتگاه به‌صورت جداگانه تا روی نقشه گوشی باز شود
  for (const { lodging, labels } of db.stayLodgings(r)) {
    if (lodging.lat == null || lodging.lon == null) continue;
    try {
      await bot.api.sendVenue(
        r.tg_id, lodging.lat, lodging.lon,
        `${lodging.name} — ${labels.join(' و ')}`,
        lodging.address || cityTitle(r.city)
      );
    } catch (err) {
      console.error('sendVenue failed', err.message);
      // اگر ونیو نشد، دست‌کم لوکیشن ساده بفرست
      await bot.api.sendLocation(r.tg_id, lodging.lat, lodging.lon).catch(() => {});
    }
  }
}

// ---------- گزارش ----------

export function buildReport(cities) {
  const stats = db.statsByCity();
  const today = todayISO();
  const label = { pending: 'در انتظار', approved: 'تاییدشده', rejected: 'رد شده' };
  let out = `📊 <b>گزارش سامانه</b> — ${formatJalali(today)}\n`;
  let grand = 0;

  for (const city of cities) {
    const cap = config.cities[city];
    const rows = stats.filter((s) => s.city === city);
    out += `\n<b>${cap.title}</b>\n`;
    for (const st of ['pending', 'approved', 'rejected']) {
      const row = rows.find((r) => r.status === st);
      const n = row?.n || 0;
      grand += n;
      out += `• ${label[st]}: ${fa(n)} درخواست` +
        (n ? ` (${fa(row.men)} آقا / ${fa(row.women)} خانم)` : '') + '\n';
    }
    const occ = db.occupancyOn(city, today);
    out += `• اشغال امشب: ${fa(occ.men)}/${fa(cap.men)} آقا — ` +
      `${fa(occ.women)}/${fa(cap.women)} خانم\n`;

    const week = [];
    for (let i = 1; i <= 7; i++) {
      const d = addDaysISO(today, i);
      const o = db.occupancyOn(city, d);
      if (o.men || o.women) week.push(`  ${formatJalali(d)}: ${fa(o.men)}آ/${fa(o.women)}خ`);
    }
    if (week.length) out += `• هفته آینده:\n${week.join('\n')}\n`;
  }

  const arr = db.arrivalsOn(today, cities);
  const tomorrow = db.arrivalsOn(addDaysISO(today, 1), cities);
  out += `\n<b>ورود امروز:</b> ${arr.length ? '' : 'ندارد'}\n`;
  for (const r of arr)
    out += `• ${esc(r.full_name)} — ${cityTitle(r.city)} — ${fa(r.men + r.women)} نفر — <code>${r.tracking}</code>\n`;
  out += `<b>ورود فردا:</b> ${tomorrow.length ? '' : 'ندارد'}\n`;
  for (const r of tomorrow)
    out += `• ${esc(r.full_name)} — ${cityTitle(r.city)} — ${fa(r.men + r.women)} نفر\n`;

  out += `\nمجموع درخواست‌ها: <b>${fa(grand)}</b>`;
  return out;
}

export function buildCsv(cities) {
  const head = 'id,city,full_name,national_id,phone,men,women,start_jalali,start_iso,nights,status,tracking,created_at';
  const lines = db.allReservations(cities).map((r) =>
    [
      r.id, cityTitle(r.city), `"${(r.full_name || '').replace(/"/g, '""')}"`,
      `="${r.national_id}"`, `="${r.phone || ''}"`, r.men, r.women,
      formatJalali(r.start_date), r.start_date, r.nights, r.status,
      r.tracking || '', r.created_at,
    ].join(',')
  );
  return '\uFEFF' + [head, ...lines].join('\n');
}

/**
 * ارسال راهنمای تصویری. اگر ادمین تصویر دلخواه آپلود کرده باشد همان،
 * وگرنه تصویر پیش‌فرض پروژه فرستاده می‌شود.
 */
export async function sendGuide(ctx) {
  const caption = db.getSetting('GUIDE_TEXT', '') ||
    '📖 <b>راهنمای کامل رزرو</b>\n\nمراحل را در تصویر بالا ببینید. ' +
    'برای شروع /start را بزنید و «🕌 رزرو جدید» را انتخاب کنید.';
  // ۱) تصویری که ادمین در داشبورد آپلود کرده
  const uploaded = db.getSetting('GUIDE_IMAGE', '');
  if (uploaded) {
    const file = path.join(UPLOAD_DIR, path.basename(uploaded));
    if (fs.existsSync(file)) {
      try {
        return await ctx.replyWithPhoto(new InputFile(file, 'guide.png'),
          { caption, parse_mode: 'HTML' });
      } catch (err) {
        console.error('uploaded guide failed, falling back', err.message);
      }
    }
  }

  // ۲) شناسه فایل تلگرام (روش قبلی، برای سازگاری)
  const custom = db.getSetting('GUIDE_FILE_ID', '');
  if (custom) {
    try {
      return await ctx.replyWithPhoto(custom, { caption, parse_mode: 'HTML' });
    } catch (err) {
      console.error('custom guide failed, falling back', err.message);
    }
  }
  if (fs.existsSync(GUIDE_IMAGE))
    return ctx.replyWithPhoto(new InputFile(GUIDE_IMAGE, 'guide.png'),
      { caption, parse_mode: 'HTML' });
  return ctx.reply(caption, { parse_mode: 'HTML' });
}

export function registerFlow(bot) {
  // ---------- کارهای ادمین (مشترک بین دستور و دکمه پنل) ----------

  /** دکمه‌های کارت رزرو: ثبت ورود و مشاهده مدارک */
  function voucherCardKeyboard(r, docCount) {
    const kb = new InlineKeyboard();
    if (r.status === 'approved' && !r.checked_in_at)
      kb.text('🚪 ثبت ورود مهمان', `adm:in:${r.tracking}`).row();
    // خادم حسینیه می‌تواند محل اسکان را هنگام حضور زائر تعیین یا عوض کند
    if (r.status === 'approved') {
      if (r.men > 0) kb.text('🏠 تغییر اسکان آقایان', `arr:pick_men:${r.id}:0`).row();
      if (r.women > 0) kb.text('🏠 تغییر اسکان خانم‌ها', `arr:pick_women:${r.id}:0`).row();
    }
    if (docCount) kb.text(`🪪 مشاهده مدارک (${fa(docCount)})`, `adm:docs:${r.id}`);
    return kb.inline_keyboard.flat().length ? kb : undefined;
  }

  /** کارت رزرو برای ادمین، همراه دکمه ثبت ورود در صورت نیاز */
  function voucherCard(r) {
    const label = { pending: '⏳ در انتظار تایید', approved: '✅ تاییدشده', rejected: '❌ رد شده' };
    let text = `🎫 <b>رزرو #${fa(r.id)}</b> — ${cityTitle(r.city)}\n\n` + summary(r);
    text += `\nوضعیت: <b>${label[r.status] || r.status}</b>`;
    if (r.tracking) text += `\nکد رهگیری: <code>${r.tracking}</code>`;
    if (r.checked_in_at)
      text += `\n🚪 <b>ورود ثبت شده</b> — ${formatJalali(r.checked_in_at.slice(0, 10))}`;
    const docs = db.documentsFor(r.id);
    if (docs.length) text += `\n🪪 مدرک شناسایی: ${fa(docs.length)} تصویر`;
    text += stayText(r);
    const kb = voucherCardKeyboard(r, docs.length);
    return { text, kb };
  }

  async function sendPending(ctx) {
    const cities = adminCities(ctx.from.id);
    if (!cities.length) return ctx.reply('شما دسترسی ادمین ندارید.');
    const rows = db.pendingList(cities);
    if (!rows.length) return ctx.reply('درخواست در انتظاری وجود ندارد.');
    for (const r of rows) {
      await ctx.reply(
        `⏳ <b>درخواست #${fa(r.id)}</b> — ${cityTitle(r.city)}\n\n` + summary(r),
        { parse_mode: 'HTML', reply_markup: adminKeyboard(r.id) }
      );
    }
  }

  async function sendReport(ctx) {
    if (!isSuperAdmin(ctx.from.id))
      return ctx.reply('این گزارش فقط برای ادمین کل در دسترس است.');
    await ctx.reply(buildReport(cityKeys()), { parse_mode: 'HTML' });
  }

  async function sendExport(ctx) {
    if (!isSuperAdmin(ctx.from.id))
      return ctx.reply('این خروجی فقط برای ادمین کل در دسترس است.');
    const csv = Buffer.from(buildCsv(cityKeys()), 'utf8');
    await ctx.replyWithDocument(
      new InputFile(csv, `reservations-${todayISO()}.csv`),
      { caption: 'خروجی کامل رزروها (قابل باز شدن در اکسل)' }
    );
  }

  /** نمایش رزرو از روی کد رهگیری (اسکن QR، لینک عمیق یا جستجوی دستی) */
  async function showByTracking(ctx, code) {
    const cities = adminCities(ctx.from.id);
    if (!cities.length) return ctx.reply('شما دسترسی ادمین ندارید.');
    if (!code) return ctx.reply('کد رهگیری خوانده نشد.');
    const r = db.getByTracking(code);
    if (!r) return ctx.reply(`رزروی با کد <code>${esc(code)}</code> پیدا نشد.`, { parse_mode: 'HTML' });
    if (!cities.includes(r.city))
      return ctx.reply(`این رزرو مربوط به ${cityTitle(r.city)} است و در دسترس شما نیست.`);
    const { text, kb } = voucherCard(r);
    return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  // ---------- دستورات عمومی ----------

  bot.command('start', async (ctx) => {
    db.clearSession(ctx.from.id);

    // اسکن بلیت با دوربین گوشی → /start v_CODE
    const payload = (ctx.match || '').trim();
    if (payload.startsWith('v_')) {
      if (!isAnyAdmin(ctx.from.id))
        return ctx.reply('این بلیت فقط توسط ادمین اقامتگاه قابل بررسی است.', {
          reply_markup: mainMenu(ctx.from.id),
        });
      return showByTracking(ctx, parseVoucherPayload(payload));
    }

    const role = isAnyAdmin(ctx.from.id) ? `\n\nنقش شما: <b>${roleLabel(ctx.from.id)}</b>` : '';
    const extra = config.welcomeExtra ? `\n\n${esc(config.welcomeExtra)}` : '';
    await ctx.reply(WELCOME + extra + role, {
      parse_mode: 'HTML', reply_markup: mainMenu(ctx.from.id),
    });

    // راهنمای تصویری فقط بار اول برای هر کاربر
    if (!db.userSeenGuide(ctx.from.id)) {
      db.markGuideSeen(ctx.from.id);
      await sendGuide(ctx).catch((e) => console.error('guide', e.message));
    }
  });

  bot.command('help', (ctx) => sendGuide(ctx));

  bot.command('cancel', async (ctx) => {
    db.clearSession(ctx.from.id);
    await ctx.reply('عملیات لغو شد.', { reply_markup: mainMenu(ctx.from.id) });
  });

  bot.command('mine', (ctx) => showMine(ctx));

  // ---------- دستورات ادمین ----------

  bot.command('panel', async (ctx) => {
    if (!isAnyAdmin(ctx.from.id)) return ctx.reply('شما دسترسی ادمین ندارید.');
    await ctx.reply(`🛠 <b>پنل ادمین</b>\nنقش شما: <b>${roleLabel(ctx.from.id)}</b>`, {
      parse_mode: 'HTML',
      reply_markup: adminPanelKeyboard(ctx.from.id),
    });
  });

  bot.command('pending', (ctx) => sendPending(ctx));
  bot.command('report', (ctx) => sendReport(ctx));
  bot.command('export', (ctx) => sendExport(ctx));

  bot.command('scan', async (ctx) => {
    if (!isAnyAdmin(ctx.from.id)) return ctx.reply('شما دسترسی ادمین ندارید.');
    db.setSession(ctx.from.id, 'adm_scan', {});
    await ctx.reply(SCAN_HELP, { parse_mode: 'HTML' });
  });

  // پیام همگانی از تلگرام — فقط ادمین کل
  bot.command('broadcast', async (ctx) => {
    if (!isSuperAdmin(ctx.from.id))
      return ctx.reply('پیام همگانی فقط برای ادمین کل در دسترس است.');
    const body = (ctx.match || '').trim();
    if (!body) {
      db.setSession(ctx.from.id, 'bc_text', {});
      return ctx.reply(
        '📢 <b>پیام همگانی</b>\n\nمتن پیام را بنویسید. پس از آن مخاطبان را انتخاب می‌کنید.\n' +
        'برای لغو /cancel را بزنید.', { parse_mode: 'HTML' });
    }
    db.setSession(ctx.from.id, 'bc_aud', { body });
    return ctx.reply(broadcastPreview(body), {
      parse_mode: 'HTML', reply_markup: audienceKeyboard(),
    });
  });

  // شناسه فایل تصویر، برای گذاشتن راهنمای دلخواه در داشبورد
  bot.command('guideimage', async (ctx) => {
    if (!isAnyAdmin(ctx.from.id)) return ctx.reply('شما دسترسی ادمین ندارید.');
    db.setSession(ctx.from.id, 'guide_img', {});
    return ctx.reply(
      '🖼 تصویر راهنمای دلخواه را بفرستید تا شناسه فایل آن را بگیرید،\n' +
      'سپس آن را در داشبورد → پیام‌ها → راهنمای تصویری وارد کنید.');
  });

  bot.command('find', async (ctx) => {
    if (!isAnyAdmin(ctx.from.id)) return ctx.reply('شما دسترسی ادمین ندارید.');
    const code = parseVoucherPayload((ctx.match || '').trim());
    if (!code) {
      db.setSession(ctx.from.id, 'adm_find', {});
      return ctx.reply('کد رهگیری را بفرستید:');
    }
    await showByTracking(ctx, code);
  });

  // ---------- منو ----------

  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

  // ---------- پنل ادمین ----------

  bot.callbackQuery('menu:home', async (ctx) => {
    await ctx.answerCallbackQuery();
    db.clearSession(ctx.from.id);
    await ctx.editMessageText(WELCOME, {
      parse_mode: 'HTML',
      reply_markup: mainMenu(ctx.from.id),
    });
  });

  bot.callbackQuery('menu:admin', async (ctx) => {
    if (!isAnyAdmin(ctx.from.id))
      return ctx.answerCallbackQuery({ text: 'دسترسی ندارید.', show_alert: true });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `🛠 <b>پنل ادمین</b>\nنقش شما: <b>${roleLabel(ctx.from.id)}</b>`,
      { parse_mode: 'HTML', reply_markup: adminPanelKeyboard(ctx.from.id) }
    );
  });

  bot.callbackQuery('adm:pending', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendPending(ctx);
  });

  bot.callbackQuery('adm:report', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendReport(ctx);
  });

  bot.callbackQuery('adm:export', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendExport(ctx);
  });

  bot.callbackQuery('adm:scan', async (ctx) => {
    if (!isAnyAdmin(ctx.from.id))
      return ctx.answerCallbackQuery({ text: 'دسترسی ندارید.', show_alert: true });
    await ctx.answerCallbackQuery();
    db.setSession(ctx.from.id, 'adm_scan', {});
    await ctx.reply(SCAN_HELP, { parse_mode: 'HTML' });
  });

  bot.callbackQuery('adm:find', async (ctx) => {
    if (!isAnyAdmin(ctx.from.id))
      return ctx.answerCallbackQuery({ text: 'دسترسی ندارید.', show_alert: true });
    await ctx.answerCallbackQuery();
    db.setSession(ctx.from.id, 'adm_find', {});
    await ctx.reply('کد رهگیری را بفرستید:');
  });

  bot.callbackQuery(/^adm:docs:(\d+)$/, async (ctx) => {
    const r = db.getReservation(Number(ctx.match[1]));
    if (!r) return ctx.answerCallbackQuery({ text: 'رزرو پیدا نشد.', show_alert: true });
    if (!canApprove(ctx.from.id, r.city))
      return ctx.answerCallbackQuery({ text: 'دسترسی ندارید.', show_alert: true });

    const docs = db.documentsFor(r.id);
    if (!docs.length) return ctx.answerCallbackQuery({ text: 'مدرکی ثبت نشده.', show_alert: true });
    await ctx.answerCallbackQuery();
    for (const d of docs) {
      const cap = `🪪 مدرک رزرو #${fa(r.id)} — ${esc(r.full_name)}`;
      try {
        if ((d.mime || '').includes('pdf')) await ctx.replyWithDocument(d.file_id, { caption: cap });
        else await ctx.replyWithPhoto(d.file_id, { caption: cap });
      } catch (err) {
        console.error('send document failed', err.message);
        await ctx.reply(`ارسال مدرک #${d.id} ناموفق بود.`);
      }
    }
  });

  // ---------- تعیین اسکان هنگام حضور زائر (خادم حسینیه) ----------

  bot.callbackQuery(/^arr:(pick_men|pick_women|men|women|back):(\d+):(\d+)$/, async (ctx) => {
    const [, action, resIdRaw, lodgingRaw] = ctx.match;
    const r = db.getReservation(Number(resIdRaw));
    if (!r) return ctx.answerCallbackQuery({ text: 'رزرو پیدا نشد.', show_alert: true });
    if (!canApprove(ctx.from.id, r.city))
      return ctx.answerCallbackQuery({ text: 'دسترسی ندارید.', show_alert: true });

    if (action === 'back') {
      await ctx.answerCallbackQuery();
      const { text, kb } = voucherCard(db.getReservation(r.id));
      return ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    }

    if (action === 'pick_men' || action === 'pick_women') {
      const who = action === 'pick_men' ? 'men' : 'women';
      const city = db.getCityByKey(r.city);
      const lodgings = db.listLodgings(city.id, true);
      if (!lodgings.length)
        return ctx.answerCallbackQuery({ text: 'اقامتگاه فعالی ثبت نشده.', show_alert: true });
      await ctx.answerCallbackQuery();
      return ctx.editMessageText(
        `🏠 <b>${who === 'men' ? 'آقایان' : 'خانم‌ها'}</b> در کدام حسینیه اسکان یابند؟ — رزرو #${fa(r.id)}`,
        { parse_mode: 'HTML', reply_markup: arrivalPickKeyboard(r.id, who, lodgings) }
      );
    }

    // ثبت انتخاب
    const lodging = db.getLodging(Number(lodgingRaw));
    if (!lodging) return ctx.answerCallbackQuery({ text: 'اقامتگاه پیدا نشد.', show_alert: true });
    db.assignStay(r.id, {
      lodging_men_id: action === 'men' ? lodging.id : r.lodging_men_id,
      lodging_women_id: action === 'women' ? lodging.id : r.lodging_women_id,
      stay_note: r.stay_note,
    });
    const updated = db.getReservation(r.id);
    await ctx.answerCallbackQuery('اسکان ثبت شد');
    const { text, kb } = voucherCard(updated);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });

    // مهمان از محل اسکان جدید باخبر شود
    try {
      await bot.api.sendMessage(updated.tg_id,
        `🏠 <b>محل اسکان شما مشخص شد</b>\n` + stayText(updated), { parse_mode: 'HTML' });
      for (const { lodging: l, labels } of db.stayLodgings(updated)) {
        if (l.lat == null || l.lon == null) continue;
        await bot.api.sendVenue(updated.tg_id, l.lat, l.lon,
          `${l.name} — ${labels.join(' و ')}`, l.address || cityTitle(updated.city)).catch(() => {});
      }
    } catch (err) {
      console.error('notify stay change failed', err.message);
    }
  });

  // ---------- پیام همگانی: انتخاب مخاطب ----------

  bot.callbackQuery(/^bc:(all|approved|upcoming|pending|city):(\w*)$/, async (ctx) => {
    if (!isSuperAdmin(ctx.from.id))
      return ctx.answerCallbackQuery({ text: 'دسترسی ندارید.', show_alert: true });
    const s2 = db.getSession(ctx.from.id);
    if (s2.step !== 'bc_aud')
      return ctx.answerCallbackQuery({ text: 'این مرحله منقضی شده.', show_alert: true });

    const audience = ctx.match[1];
    const cityKey = audience === 'city' ? ctx.match[2] : null;
    const ids = db.broadcastTargets(audience, cityKey);
    db.clearSession(ctx.from.id);
    await ctx.answerCallbackQuery();

    if (!ids.length)
      return ctx.editMessageText('مخاطبی برای این گروه پیدا نشد.');

    await ctx.editMessageText(
      `📤 در حال ارسال به <b>${fa(ids.length)}</b> مخاطب (${audienceLabel(audience, cityKey)})…`,
      { parse_mode: 'HTML' });
    const r = await broadcast(bot, {
      body: s2.data.body, audience, cityKey, adminId: ctx.from.id,
    });
    await ctx.reply(
      `✅ <b>پایان ارسال</b>\nارسال‌شده: ${fa(r.sent)}\n` +
      (r.failed ? `ناموفق: ${fa(r.failed)} (ربات بلاک یا چت حذف شده)` : 'بدون خطا'),
      { parse_mode: 'HTML' });
  });

  // ---------- ثبت ورود مهمان ----------

  bot.callbackQuery(/^adm:in:([A-Za-z0-9-]{4,32})$/, async (ctx) => {
    const code = ctx.match[1].toUpperCase();
    const r = db.getByTracking(code);
    if (!r) return ctx.answerCallbackQuery({ text: 'رزرو پیدا نشد.', show_alert: true });
    if (!canApprove(ctx.from.id, r.city))
      return ctx.answerCallbackQuery({
        text: `شما اجازه رسیدگی به رزروهای ${cityTitle(r.city)} را ندارید.`,
        show_alert: true,
      });

    const res = db.checkIn(code, ctx.from.id);
    if (!res.ok) {
      const msg = {
        not_found: 'رزرو پیدا نشد.',
        not_approved: 'این رزرو تاییدشده نیست.',
        already: 'ورود این مهمان قبلاً ثبت شده است.',
      }[res.reason];
      return ctx.answerCallbackQuery({ text: msg, show_alert: true });
    }

    await ctx.answerCallbackQuery('ورود ثبت شد');
    const { text } = voucherCard(res.reservation);
    await ctx.editMessageText(text, { parse_mode: 'HTML' });
  });

  bot.callbackQuery('menu:new', async (ctx) => {
    await ctx.answerCallbackQuery();
    db.setSession(ctx.from.id, 'city', {});
    await ctx.editMessageText('در کدام شهر قصد اقامت دارید؟', {
      reply_markup: cityKeyboard(),
    });
  });

  bot.callbackQuery('menu:guide', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendGuide(ctx);
  });

  bot.callbackQuery('menu:mine', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMine(ctx);
  });

  bot.callbackQuery('flow:cancel', async (ctx) => {
    db.clearOrphanDocuments(ctx.from.id);
    await ctx.answerCallbackQuery();
    db.clearSession(ctx.from.id);
    await ctx.editMessageText('درخواست لغو شد.', { reply_markup: mainMenu(ctx.from.id) });
  });

  // ---------- انتخاب شهر ----------

  bot.callbackQuery(/^city:(\w+)$/, async (ctx) => {
    const city = ctx.match[1];
    if (!config.cities[city]) return ctx.answerCallbackQuery('شهر نامعتبر');
    await ctx.answerCallbackQuery();
    db.setSession(ctx.from.id, 'name', { city });
    await ctx.editMessageText(
      `شهر: <b>${cityTitle(city)}</b>\n\n` +
        'لطفاً <b>نام و نام خانوادگی</b> سرپرست گروه را بنویسید:',
      { parse_mode: 'HTML' }
    );
  });

  // ---------- شمارنده نفرات ----------

  bot.callbackQuery(/^cnt:(m|w|ok):?([+-])?$/, async (ctx) => {
    const s = db.getSession(ctx.from.id);
    if (s.step !== 'count') return ctx.answerCallbackQuery('این مرحله منقضی شده. /start');
    const [, target, sign] = ctx.match;
    const d = s.data;

    if (target === 'ok') {
      if (d.men + d.women < 1) return ctx.answerCallbackQuery('حداقل یک نفر لازم است');
      await ctx.answerCallbackQuery();
      db.setSession(ctx.from.id, 'date', d);
      return ctx.editMessageText('تاریخ <b>ورود</b> را انتخاب کنید:', {
        parse_mode: 'HTML',
        reply_markup: calendarForToday(),
      });
    }

    const key = target === 'm' ? 'men' : 'women';
    const delta = sign === '+' ? 1 : -1;
    if (d[key] + delta < 0) return ctx.answerCallbackQuery();
    if (d.men + d.women + delta > config.maxPerBooking)
      return ctx.answerCallbackQuery(`حداکثر ${config.maxPerBooking} نفر در هر رزرو`);

    d[key] += delta;
    db.setSession(ctx.from.id, 'count', d);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: counterKeyboard(d.men, d.women) });
  });

  // ---------- تقویم ----------

  bot.callbackQuery(/^cal:m:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: calendarKeyboard(Number(ctx.match[1]), Number(ctx.match[2])),
    });
  });

  bot.callbackQuery(/^cal:d:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const s = db.getSession(ctx.from.id);
    if (s.step !== 'date') return ctx.answerCallbackQuery('این مرحله منقضی شده. /start');
    await ctx.answerCallbackQuery();
    const d = { ...s.data, start_date: ctx.match[1] };
    db.setSession(ctx.from.id, 'nights', d);

    // در بازه‌های ویژه (مثلاً دهه محرم) سقف شب کمتر است
    const lim = db.nightLimitFor(d.city, d.start_date);
    const note = lim.period
      ? `\n\n⚠️ <b>${esc(lim.period.title)}</b> — در این بازه حداکثر ` +
        `<b>${fa(lim.nights)} شب</b> اقامت ممکن است.`
      : '';

    await ctx.editMessageText(
      `تاریخ ورود: <b>${formatJalali(d.start_date)}</b>${note}\n\nچند شب اقامت دارید؟`,
      { parse_mode: 'HTML', reply_markup: nightsKeyboard(lim.nights) }
    );
  });

  bot.callbackQuery(/^n:(\d+)$/, async (ctx) => {
    const s = db.getSession(ctx.from.id);
    if (s.step !== 'nights') return ctx.answerCallbackQuery('این مرحله منقضی شده. /start');
    await ctx.answerCallbackQuery();
    const d = { ...s.data, nights: Number(ctx.match[1]) };

    // ۰) سقف شب بازه — دکمه قدیمی نباید سقف را دور بزند
    const lim = db.strictestLimitOver(d.city, d.start_date, d.nights);
    if (d.nights > lim.nights) {
      db.setSession(ctx.from.id, 'nights', d);
      return ctx.editMessageText(
        (lim.period ? `⚠️ <b>${esc(lim.period.title)}</b>\n` : '') +
        `در این بازه حداکثر <b>${fa(lim.nights)} شب</b> اقامت ممکن است.\n\nتعداد شب را انتخاب کنید:`,
        { parse_mode: 'HTML', reply_markup: nightsKeyboard(lim.nights) }
      );
    }

    // ۱) تداخل تاریخ با رزرو دیگر همان کد ملی (در هر شهر)
    const clash = db.overlappingReservation(d.national_id, d.start_date, d.nights);
    if (clash) {
      db.clearSession(ctx.from.id);
      return ctx.editMessageText(overlapMessage(clash), {
        parse_mode: 'HTML',
        reply_markup: mainMenu(ctx.from.id),
      });
    }

    // ۲) ظرفیت شهر
    const cap = db.capacityCheck(d.city, d.start_date, d.nights, d.men, d.women);
    if (!cap.ok) {
      db.clearSession(ctx.from.id);
      return ctx.editMessageText(
        `متاسفانه ظرفیت ${cityTitle(d.city)} در این بازه تکمیل است.\n` +
          `ظرفیت آزاد: ${fa(Math.max(0, cap.freeMen))} آقا / ` +
          `${fa(Math.max(0, cap.freeWomen))} خانم\n\nتاریخ دیگری را امتحان کنید.`,
        { reply_markup: mainMenu(ctx.from.id) }
      );
    }

    db.setSession(ctx.from.id, 'phone', d);
    await ctx.editMessageText(summary(d), { parse_mode: 'HTML' });
    await ctx.reply('برای مرحله آخر، شماره تماس خود را با دکمه زیر ارسال کنید:', {
      reply_markup: phoneKeyboard(),
    });
  });

  // ---------- شماره تماس ----------

  bot.on('message:contact', async (ctx) => {
    const s = db.getSession(ctx.from.id);
    if (s.step !== 'phone') return;
    if (ctx.message.contact.user_id !== ctx.from.id)
      return ctx.reply('لطفاً شماره خودتان را ارسال کنید، نه شماره مخاطب دیگر.');

    const d = { ...s.data, phone: normalizePhone(ctx.message.contact.phone_number) };
    await ctx.reply('شماره ثبت شد.', { reply_markup: { remove_keyboard: true } });
    await askDocumentOrReview(ctx, d);
  });

  // ---------- مدرک شناسایی ----------

  /** بسته به تنظیمات، مدرک می‌خواهد یا مستقیم به بازبینی می‌رود */
  async function askDocumentOrReview(ctx, d) {
    const mode = config.requireDocument;
    if (mode === 'off') {
      db.setSession(ctx.from.id, 'review', d);
      return ctx.reply(summary(d) + '\nآیا اطلاعات بالا درست است؟', {
        parse_mode: 'HTML',
        reply_markup: reviewKeyboard(),
      });
    }
    db.clearOrphanDocuments(ctx.from.id);
    db.setSession(ctx.from.id, 'doc', d);
    return ctx.reply(DOC_PROMPT[mode], {
      parse_mode: 'HTML',
      reply_markup: documentKeyboard(mode === 'optional'),
    });
  }

  /** ذخیره عکس/فایل مدرک روی دیسک و در دیتابیس */
  async function saveDocument(ctx, fileId, mime) {
    const file = await ctx.api.getFile(fileId);
    const root = config.apiRoot || 'https://api.telegram.org';
    const res = await fetch(`${root}/file/bot${config.token}/${file.file_path}`);
    if (!res.ok) throw new Error(`دانلود فایل ناموفق: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const ext = (file.file_path.match(/\.([A-Za-z0-9]{1,5})$/) || [, 'jpg'])[1].toLowerCase();
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    fs.mkdirSync(DOCS_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(DOCS_DIR, name), buf, { mode: 0o600 });

    return db.addDocument({
      reservation_id: null, tg_id: ctx.from.id, kind: 'id',
      file_id: fileId, file_path: name, mime: mime || null,
    });
  }

  async function handleIncomingDocument(ctx, fileId, mime) {
    const s = db.getSession(ctx.from.id);
    if (s.step !== 'doc') return false;
    await ctx.replyWithChatAction('typing');
    try {
      await saveDocument(ctx, fileId, mime);
    } catch (err) {
      console.error('saveDocument failed', err.message);
      await ctx.reply('ذخیره مدرک ناموفق بود. دوباره ارسال کنید.');
      return true;
    }
    const n = db.orphanDocuments(ctx.from.id).length;
    db.setSession(ctx.from.id, 'review', s.data);
    await ctx.reply(
      `✅ مدرک دریافت شد (${fa(n)} تصویر).\n\n` + summary(s.data) + '\nآیا اطلاعات بالا درست است؟',
      { parse_mode: 'HTML', reply_markup: reviewKeyboard(true) }
    );
    return true;
  }

  bot.callbackQuery('doc:skip', async (ctx) => {
    const s = db.getSession(ctx.from.id);
    if (s.step !== 'doc') return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    db.setSession(ctx.from.id, 'review', s.data);
    await ctx.editMessageText(summary(s.data) + '\nآیا اطلاعات بالا درست است؟', {
      parse_mode: 'HTML',
      reply_markup: reviewKeyboard(),
    });
  });

  // ---------- تایید نهایی کاربر ----------

  bot.callbackQuery('rev:redo', async (ctx) => {
    await ctx.answerCallbackQuery();
    db.setSession(ctx.from.id, 'city', {});
    await ctx.editMessageText('در کدام شهر قصد اقامت دارید؟', {
      reply_markup: cityKeyboard(),
    });
  });

  bot.callbackQuery('rev:ok', async (ctx) => {
    const s = db.getSession(ctx.from.id);
    if (s.step !== 'review') return ctx.answerCallbackQuery('این مرحله منقضی شده. /start');
    await ctx.answerCallbackQuery();
    const d = s.data;

    // مدرک الزامی است ولی چیزی ارسال نشده
    if (config.requireDocument === 'required' && !db.orphanDocuments(ctx.from.id).length) {
      db.setSession(ctx.from.id, 'doc', d);
      return ctx.editMessageText(DOC_PROMPT.required, {
        parse_mode: 'HTML',
        reply_markup: documentKeyboard(false),
      });
    }

    const finalLim = db.strictestLimitOver(d.city, d.start_date, d.nights);
    if (d.nights > finalLim.nights) {
      db.clearSession(ctx.from.id);
      db.clearOrphanDocuments(ctx.from.id);
      return ctx.editMessageText(
        (finalLim.period ? `⚠️ <b>${esc(finalLim.period.title)}</b>\n` : '') +
        `در این بازه حداکثر ${fa(finalLim.nights)} شب اقامت ممکن است.\n\nدوباره تلاش کنید.`,
        { parse_mode: 'HTML', reply_markup: mainMenu(ctx.from.id) }
      );
    }

    const clash = db.overlappingReservation(d.national_id, d.start_date, d.nights);
    if (clash) {
      db.clearSession(ctx.from.id);
      db.clearOrphanDocuments(ctx.from.id);
      return ctx.editMessageText(overlapMessage(clash), {
        parse_mode: 'HTML',
        reply_markup: mainMenu(ctx.from.id),
      });
    }

    const id = db.createReservation({
      tg_id: ctx.from.id,
      username: ctx.from.username || null,
      full_name: d.full_name,
      national_id: d.national_id,
      city: d.city,
      men: d.men,
      women: d.women,
      start_date: d.start_date,
      nights: d.nights,
      phone: d.phone,
    });
    // مدارکی که پیش از ثبت آپلود شده‌اند به همین رزرو وصل می‌شوند
    db.attachDocuments(id, ctx.from.id);
    db.clearSession(ctx.from.id);

    await ctx.editMessageText(
      `✅ درخواست شما با شماره <b>#${fa(id)}</b> ثبت شد.\n` +
        `پس از بررسی ادمین ${cityTitle(d.city)}، کد رهگیری و بلیت QR ارسال می‌شود.`,
      { parse_mode: 'HTML', reply_markup: mainMenu(ctx.from.id) }
    );
    await notifyAdmins(bot, id);
  });

  // ---------- تصمیم ادمین ----------

  bot.callbackQuery(/^adm:(ok|no):(\d+)$/, async (ctx) => {
    const action = ctx.match[1];
    const id = Number(ctx.match[2]);
    const r = db.getReservation(id);
    if (!r) return ctx.answerCallbackQuery('رزرو پیدا نشد');

    if (!canApprove(ctx.from.id, r.city))
      return ctx.answerCallbackQuery({
        text: `شما اجازه رسیدگی به رزروهای ${cityTitle(r.city)} را ندارید.`,
        show_alert: true,
      });
    if (r.status !== 'pending')
      return ctx.answerCallbackQuery(`قبلاً رسیدگی شده (${r.status})`);

    const who = `${roleLabel(ctx.from.id)}`;

    if (action === 'no') {
      db.decide(id, 'rejected', ctx.from.id);
      await ctx.answerCallbackQuery('رد شد');
      await ctx.editMessageText(
        `❌ <b>رد شد</b> توسط ${who} — درخواست #${fa(id)}\n\n` + summary(r),
        { parse_mode: 'HTML' }
      );
      await bot.api
        .sendMessage(r.tg_id, `متاسفانه درخواست رزرو #${fa(id)} شما تایید نشد.`)
        .catch(() => {});
      return;
    }

    const clash = db.overlappingReservation(r.national_id, r.start_date, r.nights, id);
    if (clash)
      return ctx.answerCallbackQuery({
        text: `تداخل تاریخ با رزرو #${clash.id} در ${cityTitle(clash.city)}`,
        show_alert: true,
      });

    const cap = db.capacityCheck(r.city, r.start_date, r.nights, r.men, r.women, id);
    if (!cap.ok)
      return ctx.answerCallbackQuery({
        text: `ظرفیت کافی نیست: ${cap.freeMen} آقا / ${cap.freeWomen} خانم آزاد`,
        show_alert: true,
      });

    // پیش از تایید، محل اسکان مشخص می‌شود
    await ctx.answerCallbackQuery();
    db.setSession(ctx.from.id, 'stay', { resId: id, men: null, women: null, note: null });
    await askStay(ctx, id);
  });

  // ---------- تعیین محل اسکان هنگام تایید ----------

  /** اقامتگاه‌های فعال شهر با ظرفیت آزاد در بازه همان رزرو */
  function lodgingChoices(r) {
    const city = db.getCityByKey(r.city);
    return db.listLodgings(city.id, true).map((l) => ({
      ...l,
      free: `${fa(l.cap_men)}آ/${fa(l.cap_women)}خ`,
    }));
  }

  /** مرحله بعدی را می‌پرسد: آقایان → خانم‌ها → تایید نهایی */
  async function askStay(ctx, resId) {
    const s = db.getSession(ctx.from.id);
    const st = s.data;
    const r = db.getReservation(resId);
    if (!r) return ctx.reply('رزرو پیدا نشد.');

    const choices = lodgingChoices(r);
    if (!choices.length) {
      db.clearSession(ctx.from.id);
      return ctx.reply(
        `برای ${cityTitle(r.city)} هیچ اقامتگاه فعالی ثبت نشده است.\n` +
        'ابتدا در داشبورد یک اقامتگاه اضافه کنید، سپس دوباره تایید کنید.'
      );
    }

    if (r.men > 0 && !st.men)
      return ctx.reply(
        `🏠 <b>محل اسکان آقایان</b> (${fa(r.men)} نفر) — رزرو #${fa(resId)}`,
        { parse_mode: 'HTML', reply_markup: lodgingPickKeyboard(resId, 'men', choices) }
      );

    if (r.women > 0 && !st.women)
      return ctx.reply(
        `🏠 <b>محل اسکان خانم‌ها</b> (${fa(r.women)} نفر) — رزرو #${fa(resId)}`,
        { parse_mode: 'HTML', reply_markup: lodgingPickKeyboard(resId, 'women', choices) }
      );

    return ctx.reply(staySummary(r, st), {
      parse_mode: 'HTML',
      reply_markup: stayConfirmKeyboard(resId),
    });
  }

  function staySummary(r, st) {
    const nameOf = (id) => (id ? db.getLodging(id)?.name || '—' : '—');
    let t = `🏠 <b>اسکان رزرو #${fa(r.id)}</b> — ${cityTitle(r.city)}\n\n`;
    if (r.men > 0) t += `آقایان (${fa(r.men)} نفر): <b>${esc(nameOf(st.men))}</b>\n`;
    if (r.women > 0) t += `خانم‌ها (${fa(r.women)} نفر): <b>${esc(nameOf(st.women))}</b>\n`;
    t += st.note ? `\nتوضیحات: ${esc(st.note)}\n` : '\nتوضیحات: —\n';
    return t + '\nبا تایید نهایی، بلیت QR به‌همراه لوکیشن و آدرس برای مهمان ارسال می‌شود.';
  }

  bot.callbackQuery(/^stay:(men|women|note|done|abort):(\d+):(\d+)$/, async (ctx) => {
    const [, action, resIdRaw, lodgingRaw] = ctx.match;
    const resId = Number(resIdRaw);
    const r = db.getReservation(resId);
    if (!r) return ctx.answerCallbackQuery({ text: 'رزرو پیدا نشد.', show_alert: true });
    if (!canApprove(ctx.from.id, r.city))
      return ctx.answerCallbackQuery({ text: 'دسترسی ندارید.', show_alert: true });

    const s = db.getSession(ctx.from.id);
    if (s.step !== 'stay' || s.data.resId !== resId)
      return ctx.answerCallbackQuery({ text: 'این مرحله منقضی شده. دوباره تایید بزنید.', show_alert: true });
    const st = s.data;

    if (action === 'abort') {
      db.clearSession(ctx.from.id);
      await ctx.answerCallbackQuery('لغو شد');
      return ctx.editMessageText('تعیین اسکان لغو شد. رزرو همچنان در انتظار است.');
    }

    if (action === 'men' || action === 'women') {
      st[action] = Number(lodgingRaw);
      db.setSession(ctx.from.id, 'stay', st);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `${action === 'men' ? 'آقایان' : 'خانم‌ها'} → <b>${esc(db.getLodging(st[action])?.name || '—')}</b>`,
        { parse_mode: 'HTML' }
      );
      return askStay(ctx, resId);
    }

    if (action === 'note') {
      db.setSession(ctx.from.id, 'stay_note', st);
      await ctx.answerCallbackQuery();
      return ctx.reply('توضیحات اسکان را بنویسید (مثلاً ساعت تحویل اتاق، طبقه، شماره تماس مسئول):');
    }

    // action === 'done'
    if (r.status !== 'pending')
      return ctx.answerCallbackQuery({ text: `قبلاً رسیدگی شده (${r.status})`, show_alert: true });

    const code = trackingCode();
    db.decide(resId, 'approved', ctx.from.id, code);
    db.assignStay(resId, {
      lodging_men_id: st.men, lodging_women_id: st.women, stay_note: st.note,
    });
    db.clearSession(ctx.from.id);
    const updated = db.getReservation(resId);

    await ctx.answerCallbackQuery('تایید شد');
    await ctx.editMessageText(
      `✅ <b>تایید شد</b> توسط ${roleLabel(ctx.from.id)} — رزرو #${fa(resId)}\n` +
        `کد رهگیری: <code>${code}</code>\n\n` + stayText(updated),
      { parse_mode: 'HTML' }
    );
    try {
      await sendVoucher(bot, updated);
    } catch (err) {
      console.error('sendVoucher failed', err.message);
      await ctx.reply(`ارسال بلیت به کاربر ناموفق بود: ${err.message}`);
    }
  });

  // ---------- اسکن بلیت از روی عکس ----------

  bot.on('message:photo', async (ctx) => {
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1].file_id;

    // ادمین شناسه تصویر راهنما را می‌خواهد
    if (db.getSession(ctx.from.id).step === 'guide_img' && isAnyAdmin(ctx.from.id)) {
      db.clearSession(ctx.from.id);
      return ctx.reply(
        `🖼 شناسه این تصویر:\n<code>${esc(largest)}</code>\n\n` +
        'آن را در داشبورد → پیام‌ها → «شناسه فایل تصویر دلخواه» وارد کنید.',
        { parse_mode: 'HTML' });
    }

    // اگر کاربر در مرحله ارسال مدرک است، عکس مدرک است نه بلیت
    if (await handleIncomingDocument(ctx, largest, 'image/jpeg')) return;
    if (!isAnyAdmin(ctx.from.id)) return;
    await ctx.replyWithChatAction('typing');
    try {
      const file = await ctx.api.getFile(largest);
      const root = config.apiRoot || 'https://api.telegram.org';
      const url = `${root}/file/bot${config.token}/${file.file_path}`;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const code = parseVoucherPayload(decodeQrFromJpeg(buf));
      if (!code)
        return ctx.reply(
          'کد QR خوانده نشد. عکس واضح‌تر و نزدیک‌تر بگیرید، یا کد رهگیری را تایپ کنید.'
        );
      db.clearSession(ctx.from.id);
      await showByTracking(ctx, code);
    } catch (err) {
      console.error('QR scan failed', err.message);
      await ctx.reply('خواندن عکس ناموفق بود. دوباره تلاش کنید یا کد رهگیری را تایپ کنید.');
    }
  });

  // مدرک به‌صورت فایل (بدون فشرده‌سازی) — کیفیت بهتر برای پاسپورت
  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const okMime = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(doc.mime_type || '');
    const s2 = db.getSession(ctx.from.id);
    if (s2.step !== 'doc') return;
    if (!okMime)
      return ctx.reply('فقط تصویر (JPG/PNG) یا PDF پذیرفته می‌شود.');
    if (doc.file_size > 10 * 1024 * 1024)
      return ctx.reply('حجم فایل بیش از ۱۰ مگابایت است. تصویر کوچک‌تری بفرستید.');
    await handleIncomingDocument(ctx, doc.file_id, doc.mime_type);
  });

  bot.callbackQuery('doc:more', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s3 = db.getSession(ctx.from.id);
    db.setSession(ctx.from.id, 'doc', s3.data);
    await ctx.reply('تصویر بعدی را ارسال کنید:', {
      reply_markup: documentKeyboard(config.requireDocument === 'optional'),
    });
  });

  // ---------- ورودی متنی ----------

  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const s = db.getSession(ctx.from.id);
    const d = s.data;

    // ادمین کل متن پیام همگانی را می‌نویسد
    if (s.step === 'bc_text' && isSuperAdmin(ctx.from.id)) {
      const body = ctx.message.text.trim().slice(0, 3500);
      db.setSession(ctx.from.id, 'bc_aud', { body });
      return ctx.reply(broadcastPreview(body), {
        parse_mode: 'HTML', reply_markup: audienceKeyboard(),
      });
    }

    // ادمین توضیحات اسکان را می‌نویسد
    if (s.step === 'stay_note' && isAnyAdmin(ctx.from.id)) {
      const st = { ...d, note: ctx.message.text.trim().slice(0, 400) };
      db.setSession(ctx.from.id, 'stay', st);
      const r = db.getReservation(st.resId);
      if (!r) { db.clearSession(ctx.from.id); return ctx.reply('رزرو پیدا نشد.'); }
      return ctx.reply(staySummary(r, st), {
        parse_mode: 'HTML', reply_markup: stayConfirmKeyboard(st.resId),
      });
    }

    // ادمین در حالت اسکن یا جستجو کد رهگیری را تایپ کرده است
    if ((s.step === 'adm_scan' || s.step === 'adm_find') && isAnyAdmin(ctx.from.id)) {
      const code = parseVoucherPayload(ctx.message.text);
      if (!code) return ctx.reply('کد رهگیری معتبر نیست. دوباره بفرستید یا /cancel بزنید.');
      db.clearSession(ctx.from.id);
      return showByTracking(ctx, code);
    }

    if (s.step === 'name') {
      const name = ctx.message.text.trim().replace(/\s+/g, ' ');
      if (!isValidName(name))
        return ctx.reply('لطفاً نام و نام خانوادگی را کامل و به فارسی بنویسید.');
      d.full_name = name;
      db.setSession(ctx.from.id, 'nid', d);
      return ctx.reply('کد ملی ۱۰ رقمی سرپرست را وارد کنید:');
    }

    if (s.step === 'nid') {
      if (!isValidNationalId(ctx.message.text))
        return ctx.reply('کد ملی معتبر نیست. لطفاً دوباره وارد کنید.');
      d.national_id = normalizeNationalId(ctx.message.text);
      d.men = 0;
      d.women = 0;
      db.setSession(ctx.from.id, 'count', d);
      return ctx.reply('تعداد نفرات را مشخص کنید:', {
        reply_markup: counterKeyboard(0, 0),
      });
    }

    if (s.step === 'phone')
      return ctx.reply('لطفاً از دکمه «ارسال شماره تماس من» استفاده کنید.', {
        reply_markup: phoneKeyboard(),
      });

    return ctx.reply(WELCOME, { parse_mode: 'HTML', reply_markup: mainMenu(ctx.from.id) });
  });

  // ---------- رزروهای کاربر ----------

  async function showMine(ctx) {
    const rows = db.userReservations(ctx.from.id);
    if (!rows.length)
      return ctx.reply('هنوز رزروی ثبت نکرده‌اید.', { reply_markup: mainMenu(ctx.from.id) });

    const label = { pending: '⏳ در انتظار تایید', approved: '✅ تاییدشده', rejected: '❌ رد شده' };
    const text = rows
      .map(
        (r) =>
          `#${fa(r.id)} — ${cityTitle(r.city)} — ${formatJalali(r.start_date)} — ` +
          `${fa(r.nights)} شب\n${label[r.status] || r.status}` +
          (r.tracking ? ` — <code>${r.tracking}</code>` : '')
      )
      .join('\n\n');
    return ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenu(ctx.from.id) });
  }
}
