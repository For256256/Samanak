import assert from 'node:assert';
import { isValidNationalId, isValidName, formatJalali, jalaliToISO, isoToJalali, addDaysISO, normalizePhone } from '../src/utils.js';
import { calendarKeyboard, counterKeyboard } from '../src/keyboards.js';
import * as db from '../src/db.js';
import * as cfg from '../src/config.js';
import { parseVoucherPayload, decodeQrFromJpeg } from '../src/qr.js';

assert.equal(isValidNationalId('0499370899'), true);
assert.equal(isValidNationalId('0684159414'), true);
assert.equal(isValidNationalId('1234567891'), true);
assert.equal(isValidNationalId('1111111111'), false);
assert.equal(isValidNationalId('0499370898'), false);
assert.equal(isValidNationalId('۰۴۹۹۳۷۰۸۹۹'), true);

assert.equal(isValidName('علی رضایی'), true);
assert.equal(isValidName('علی'), false);
assert.equal(normalizePhone('09121234567'), '+989121234567');

assert.equal(jalaliToISO(1405, 6, 19), '2026-09-10');
assert.deepEqual(isoToJalali('2026-09-10'), { jy: 1405, jm: 6, jd: 19 });
assert.equal(formatJalali('2026-09-10'), '۱۹ شهریور ۱۴۰۵');
assert.equal(addDaysISO('2026-09-10', 3), '2026-09-13');

const cal = calendarKeyboard(1405, 6).inline_keyboard;
assert.ok(cal.length > 5);
assert.ok(cal.every((row) => row.length <= 8));
assert.ok(JSON.stringify(cal).includes('cal:d:'));
assert.ok(counterKeyboard(2, 3).inline_keyboard.length === 4);

// ظرفیت
const id = db.createReservation({
  tg_id: 1, username: 'test', full_name: 'علی رضایی', national_id: '0499370899',
  city: 'najaf', men: 2, women: 3, start_date: '2026-10-01', nights: 3, phone: '+989121234567',
});
db.decide(id, 'approved', 1, 'BH-TEST1');
const cap = db.capacityCheck('najaf', '2026-10-02', 2, 1, 1);
assert.equal(cap.freeMen, 38);
assert.equal(cap.freeWomen, 37);
assert.equal(db.capacityCheck('najaf', '2026-11-01', 2, 1, 1).freeMen, 40);
// قانون: نجف و کربلا در تاریخ مشترک ممنوع
assert.ok(db.overlappingReservation('0499370899', '2026-10-02', 2), 'باید تداخل بدهد');
assert.ok(db.overlappingReservation('0499370899', '2026-09-30', 2), 'هم‌پوشانی لبه‌ای');
assert.equal(db.overlappingReservation('0499370899', '2026-10-04', 2), null, 'بدون تداخل باید مجاز باشد');
assert.equal(db.overlappingReservation('0684159414', '2026-10-01', 3), null, 'کد ملی دیگر');
// نقش ادمین‌ها
assert.equal(cfg.isSuperAdmin(111), true);
assert.deepEqual(cfg.adminCities(111), ['najaf', 'karbala']);
assert.deepEqual(cfg.adminCities(222), ['najaf']);
assert.equal(cfg.canApprove(222, 'karbala'), false);
assert.equal(cfg.canApprove(333, 'karbala'), true);
assert.equal(cfg.isAnyAdmin(999), false);
assert.equal(db.pendingCount(['najaf', 'karbala']), 0);
assert.ok(db.statsByCity().length >= 1);
assert.equal(db.occupancyOn('najaf', '2026-10-02').men, 2);
assert.equal(db.occupancyOn('najaf', '2026-10-09').men, 0);
assert.ok(db.allReservations(['najaf']).length >= 1);
// ---------- خواندن کد رهگیری از بلیت QR ----------
assert.equal(parseVoucherPayload('https://t.me/BhBot?start=v_ABC12345'), 'ABC12345', 'لینک عمیق');
assert.equal(parseVoucherPayload('{"c":"OLD99999","n":"علی"}'), 'OLD99999', 'بلیت قدیمی JSON');
assert.equal(parseVoucherPayload('abc12345'), 'ABC12345', 'کد خام با حروف کوچک');
assert.equal(parseVoucherPayload('v_ABC12345'), 'ABC12345', 'کد با پیشوند');
assert.equal(parseVoucherPayload('سلام'), null, 'متن نامربوط باید رد شود');
assert.equal(parseVoucherPayload(''), null, 'ورودی خالی');
assert.equal(decodeQrFromJpeg(Buffer.from('not-an-image')), null, 'عکس خراب نباید خطا بدهد');

// ---------- ثبت ورود مهمان ----------
const track = 'TESTTRACK1';
db.decide(id, 'approved', 111, track);
assert.equal(db.getByTracking(track).id, id, 'یافتن رزرو با کد رهگیری');

const first = db.checkIn(track, 111);
assert.equal(first.ok, true, 'ثبت ورود باید موفق باشد');
assert.ok(first.reservation.checked_in_at, 'زمان ورود باید ثبت شود');
assert.equal(first.reservation.checked_in_by, 111, 'ادمین ثبت‌کننده');

const second = db.checkIn(track, 111);
assert.equal(second.ok, false, 'ورود تکراری باید رد شود');
assert.equal(second.reason, 'already');

assert.equal(db.checkIn('NOSUCHCODE', 111).reason, 'not_found', 'کد ناموجود');

// رزرو رد شده نباید قابل ثبت ورود باشد
const id2 = db.createReservation({
  tg_id: 2, username: 'x', full_name: 'رضا محمدی', national_id: '0684159414',
  city: 'karbala', men: 1, women: 0, start_date: '2026-12-01', nights: 2, phone: null,
});
db.decide(id2, 'rejected', 111, 'TESTTRACK2');
assert.equal(db.checkIn('TESTTRACK2', 111).reason, 'not_approved', 'رزرو رد شده');

db.db.prepare('DELETE FROM reservations WHERE id IN (?, ?)').run(id, id2);

console.log('✅ همه تست‌ها با موفقیت اجرا شد');
