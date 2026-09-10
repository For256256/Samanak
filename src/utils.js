import jalaali from 'jalaali-js';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** تبدیل ارقام فارسی/عربی به لاتین و حذف کاراکترهای اضافه */
export function toEnDigits(str = '') {
  return String(str)
    .replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d))
    .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));
}

/** نمایش عدد با ارقام فارسی */
export function fa(n) {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[d]);
}

/** اعتبارسنجی کد ملی ایران (الگوریتم رقم کنترل) */
export function isValidNationalId(input) {
  const id = toEnDigits(input).replace(/\D/g, '');
  if (id.length !== 10) return false;
  if (/^(\d)\1{9}$/.test(id)) return false; // 0000000000 و مشابه
  const check = Number(id[9]);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(id[i]) * (10 - i);
  const rem = sum % 11;
  return rem < 2 ? check === rem : check === 11 - rem;
}

export function normalizeNationalId(input) {
  return toEnDigits(input).replace(/\D/g, '').padStart(10, '0');
}

/** نام باید حداقل دو بخش حرفی باشد */
export function isValidName(input = '') {
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < 5 || name.length > 60) return false;
  if (!/^[\u0600-\u06FF\s\u200c]+$/.test(name)) return false;
  return name.split(' ').length >= 2;
}

export function normalizePhone(input = '') {
  let p = toEnDigits(input).replace(/[^\d+]/g, '');
  if (p.startsWith('0098')) p = '+98' + p.slice(4);
  else if (p.startsWith('98') && p.length === 12) p = '+' + p;
  else if (p.startsWith('0')) p = '+98' + p.slice(1);
  return p;
}

// ---------- تاریخ ----------

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** تاریخ میلادی امروز به صورت YYYY-MM-DD (UTC) */
export function todayISO() {
  const d = new Date();
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function isoFromParts(gy, gm, gd) {
  const p = (n) => String(n).padStart(2, '0');
  return `${gy}-${p(gm)}-${p(gd)}`;
}

export function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDaysISO(iso, days) {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function diffDays(isoA, isoB) {
  return Math.round((isoToDate(isoB) - isoToDate(isoA)) / 86400000);
}

/** YYYY-MM-DD میلادی -> {jy, jm, jd} */
export function isoToJalali(iso) {
  const [gy, gm, gd] = iso.split('-').map(Number);
  return jalaali.toJalaali(gy, gm, gd);
}

export function jalaliToISO(jy, jm, jd) {
  const g = jalaali.toGregorian(jy, jm, jd);
  return isoFromParts(g.gy, g.gm, g.gd);
}

/** نمایش فارسی مثل: ۱۲ مهر ۱۴۰۵ */
export function formatJalali(iso) {
  const { jy, jm, jd } = isoToJalali(iso);
  return `${fa(jd)} ${JALALI_MONTHS[jm - 1]} ${fa(jy)}`;
}

export function monthLength(jy, jm) {
  return jalaali.jalaaliMonthLength(jy, jm);
}

/** ستون روز در تقویم شمسی (۰ = شنبه) */
export function weekColumn(iso) {
  return (isoToDate(iso).getUTCDay() + 1) % 7;
}

/** کد رهگیری کوتاه و خوانا */
export function trackingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `BH-${s}`;
}
