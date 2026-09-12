import { InlineKeyboard, Keyboard } from 'grammy';
import { config, isAnyAdmin, isSuperAdmin } from './config.js';
import {
  JALALI_MONTHS, fa, isoToJalali, jalaliToISO, monthLength,
  weekColumn, addDaysISO, todayISO,
} from './utils.js';

export const mainMenu = (userId = null) => {
  const kb = new InlineKeyboard()
    .text('🕌 رزرو جدید', 'menu:new')
    .row()
    .text('📋 رزروهای من', 'menu:mine')
    .row()
    .text('📖 راهنمای رزرو', 'menu:guide');
  // دکمه پنل فقط برای ادمین‌ها دیده می‌شود
  if (userId !== null && isAnyAdmin(userId)) kb.row().text('🛠 پنل ادمین', 'menu:admin');
  return kb;
};

/** پنل ادمین — گزینه‌ها بر اساس نقش کاربر */
export const adminPanelKeyboard = (userId) => {
  const kb = new InlineKeyboard()
    .text('⏳ درخواست‌های در انتظار', 'adm:pending')
    .row()
    .text('📷 اسکن بلیت QR', 'adm:scan')
    .row()
    .text('🔎 جستجو با کد رهگیری', 'adm:find');
  if (isSuperAdmin(userId)) {
    kb.row()
      .text('📊 گزارش سامانه', 'adm:report')
      .row()
      .text('📥 خروجی اکسل (CSV)', 'adm:export');
  }
  return kb.row().text('« بازگشت', 'menu:home');
};

/** انتخاب اقامتگاه هنگام تایید — برای آقایان یا خانم‌ها */
export const lodgingPickKeyboard = (resId, who, lodgings) => {
  const kb = new InlineKeyboard();
  for (const l of lodgings)
    kb.text(`${l.name} (${l.free} جا)`, `stay:${who}:${resId}:${l.id}`).row();
  return kb.text('انصراف', `stay:abort:${resId}:0`);
};

/** پس از انتخاب اقامتگاه: افزودن توضیحات یا تایید نهایی */
export const stayConfirmKeyboard = (resId) =>
  new InlineKeyboard()
    .text('📝 افزودن توضیحات اسکان', `stay:note:${resId}:0`)
    .row()
    .text('✅ تایید نهایی و ارسال بلیت', `stay:done:${resId}:0`)
    .row()
    .text('انصراف', `stay:abort:${resId}:0`);

/** انتخاب مخاطبان پیام همگانی */
export const audienceKeyboard = () => {
  const kb = new InlineKeyboard()
    .text('همه کاربران ربات', 'bc:all:').row()
    .text('دارندگان رزرو تاییدشده', 'bc:approved:').row()
    .text('رزروهای آینده', 'bc:upcoming:').row()
    .text('در انتظار تایید', 'bc:pending:').row();
  for (const c of Object.values(config.cities))
    kb.text(`کاربران ${c.title}`, `bc:city:${c.key}`).row();
  return kb.text('انصراف', 'flow:cancel');
};

/** انتخاب اقامتگاه هنگام ثبت ورود — خادم محل اسکان را تعیین/تغییر می‌دهد */
export const arrivalPickKeyboard = (resId, who, lodgings) => {
  const kb = new InlineKeyboard();
  for (const l of lodgings)
    kb.text(l.name, `arr:${who}:${resId}:${l.id}`).row();
  return kb.text('« بازگشت', `arr:back:${resId}:0`);
};

/** دکمه ثبت ورود روی کارت رزروِ اسکن‌شده */
export const checkinKeyboard = (trackingCode) =>
  new InlineKeyboard().text('🚪 ثبت ورود مهمان', `adm:in:${trackingCode}`);

export const cityKeyboard = () => {
  const kb = new InlineKeyboard();
  for (const c of Object.values(config.cities)) kb.text(c.title, `city:${c.key}`).row();
  return kb.text('انصراف', 'flow:cancel');
};

export const counterKeyboard = (men, women) =>
  new InlineKeyboard()
    .text('➖', 'cnt:m:-').text(`آقا: ${fa(men)}`, 'noop').text('➕', 'cnt:m:+')
    .row()
    .text('➖', 'cnt:w:-').text(`خانم: ${fa(women)}`, 'noop').text('➕', 'cnt:w:+')
    .row()
    .text('✅ تایید تعداد', 'cnt:ok')
    .row()
    .text('انصراف', 'flow:cancel');

const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

/** تقویم شمسی درون‌خطی برای ماه (jy, jm) */
export function calendarKeyboard(jy, jm) {
  const minISO = todayISO();
  const maxISO = addDaysISO(minISO, config.maxDaysAhead);
  const kb = new InlineKeyboard();

  kb.text(`${JALALI_MONTHS[jm - 1]} ${fa(jy)}`, 'noop').row();
  for (const w of WEEKDAYS) kb.text(w, 'noop');
  kb.row();

  const days = monthLength(jy, jm);
  const firstISO = jalaliToISO(jy, jm, 1);
  let col = weekColumn(firstISO);
  for (let i = 0; i < col; i++) kb.text(' ', 'noop');

  for (let d = 1; d <= days; d++) {
    const iso = jalaliToISO(jy, jm, d);
    const enabled = iso >= minISO && iso <= maxISO;
    kb.text(enabled ? fa(d) : '·', enabled ? `cal:d:${iso}` : 'noop');
    col++;
    if (col === 7) {
      kb.row();
      col = 0;
    }
  }
  if (col !== 0) {
    for (let i = col; i < 7; i++) kb.text(' ', 'noop');
    kb.row();
  }

  // ناوبری ماه (در تلگرام دکمه اول سمت راست دیده می‌شود)
  const prev = jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
  const next = jm === 12 ? { jy: jy + 1, jm: 1 } : { jy, jm: jm + 1 };
  const prevEnd = jalaliToISO(prev.jy, prev.jm, monthLength(prev.jy, prev.jm));
  const nextStart = jalaliToISO(next.jy, next.jm, 1);

  kb.text(prevEnd >= minISO ? '» ماه قبل' : ' ',
    prevEnd >= minISO ? `cal:m:${prev.jy}:${prev.jm}` : 'noop');
  kb.text(nextStart <= maxISO ? 'ماه بعد «' : ' ',
    nextStart <= maxISO ? `cal:m:${next.jy}:${next.jm}` : 'noop');
  kb.row().text('انصراف', 'flow:cancel');
  return kb;
}

export const calendarForToday = () => {
  const { jy, jm } = isoToJalali(todayISO());
  return calendarKeyboard(jy, jm);
};

export function nightsKeyboard(maxNights = config.maxNights) {
  const kb = new InlineKeyboard();
  for (let n = 1; n <= maxNights; n++) {
    kb.text(`${fa(n)} شب`, `n:${n}`);
    if (n % 4 === 0) kb.row();
  }
  return kb.row().text('انصراف', 'flow:cancel');
}

export const phoneKeyboard = () =>
  new Keyboard().requestContact('📱 ارسال شماره تماس من').resized().oneTime();

export const reviewKeyboard = (hasDoc = false) => {
  const kb = new InlineKeyboard().text('✅ ثبت و ارسال برای تایید', 'rev:ok').row();
  if (hasDoc) kb.text('🪪 ارسال مدرک دیگر', 'doc:more').row();
  return kb.text('✏️ اصلاح از ابتدا', 'rev:redo').text('انصراف', 'flow:cancel');
};

/** مرحله مدرک شناسایی؛ دکمه رد شدن فقط وقتی اختیاری است */
export const documentKeyboard = (skippable) => {
  const kb = new InlineKeyboard();
  if (skippable) kb.text('بدون مدرک ادامه بده', 'doc:skip').row();
  return kb.text('انصراف', 'flow:cancel');
};

export const adminKeyboard = (id) =>
  new InlineKeyboard()
    .text('✅ تایید', `adm:ok:${id}`)
    .text('❌ رد', `adm:no:${id}`);
