import assert from 'node:assert';
import { isValidNationalId, isValidName, formatJalali, jalaliToISO, isoToJalali, addDaysISO, normalizePhone } from '../src/utils.js';
import { calendarKeyboard, counterKeyboard } from '../src/keyboards.js';
import * as db from '../src/db.js';
import * as cfg from '../src/config.js';
import { parseVoucherPayload, decodeQrFromJpeg } from '../src/qr.js';
import { parseMultipart } from '../src/panel/server.js';

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

// ---------- شهر/اقامتگاه/ادمین/تنظیمات در دیتابیس ----------
assert.ok(db.listCities().length >= 2, 'شهرهای اولیه باید ساخته شده باشند');
assert.ok(db.getCityByKey('najaf'), 'شهر نجف');
assert.deepEqual(db.cityCapacity('najaf'), { men: 40, women: 40 }, 'ظرفیت از اقامتگاه‌ها');

const newCityId = db.addCity({ key: 'testcity', title: 'شهر تست' });
db.addLodging({ city_id: newCityId, name: 'اقامتگاه تست', cap_men: 12, cap_women: 8 });
assert.deepEqual(db.cityCapacity('testcity'), { men: 12, women: 8 }, 'ظرفیت شهر جدید');
assert.ok(cfg.config.cities.testcity, 'شهر جدید در تنظیمات ربات دیده می‌شود');

db.addAdmin({ tg_id: 4242, role: 'city', city_id: newCityId });
assert.deepEqual(cfg.adminCities(4242), ['testcity'], 'ادمین شهر جدید');
assert.equal(cfg.canApprove(4242, 'najaf'), false, 'ادمین شهر به شهر دیگر دسترسی ندارد');

db.setSetting('MAX_NIGHTS', 9);
assert.equal(cfg.config.maxNights, 9, 'تغییر تنظیمات بدون ری‌استارت اثر می‌کند');
db.setSetting('MAX_NIGHTS', 7);

// شهر دارای رزرو نباید حذف شود (کنترل در داشبورد)
assert.ok(db.cityReservationCount('najaf') > 0, 'شمارش رزروهای شهر');
assert.equal(db.cityReservationCount('testcity'), 0, 'شهر بدون رزرو');
db.deleteCity(newCityId);
assert.equal(db.getCityByKey('testcity'), undefined, 'حذف شهر');

// ---------- مدارک شناسایی ----------
const docId = db.addDocument({ reservation_id: null, tg_id: 909, file_id: 'F1', file_path: 'x.jpg', mime: 'image/jpeg' });
assert.equal(db.orphanDocuments(909).length, 1, 'مدرک بی‌صاحب پیش از ثبت رزرو');
db.attachDocuments(id, 909);
assert.equal(db.documentsFor(id).length, 1, 'مدرک به رزرو وصل شد');
assert.equal(db.orphanDocuments(909).length, 0, 'مدرک بی‌صاحب باقی نماند');
assert.equal(db.getDocument(docId).file_path, 'x.jpg');

// ---------- اسکان به تفکیک جنسیت ----------
const cityId = db.getCityByKey('karbala').id;
const lodA = db.addLodging({ city_id: cityId, name: 'بیت الزهرا', cap_men: 30, cap_women: 0,
  address: 'کربلا، خیابان الحسین', lat: 32.616, lon: 44.0249, note: 'درب شمالی' });
const lodB = db.addLodging({ city_id: cityId, name: 'بیت الرضا', cap_men: 0, cap_women: 25 });

db.assignStay(id2, { lodging_men_id: lodA, lodging_women_id: lodB, stay_note: 'ساعت ۱۴' });
const r2 = db.getReservation(id2);
assert.equal(r2.lodging_men_id, lodA, 'اسکان آقایان');
assert.equal(r2.lodging_women_id, lodB, 'اسکان خانم‌ها');

const stays = db.stayLodgings(r2);
assert.equal(stays.length, 2, 'دو اقامتگاه متفاوت');
assert.equal(stays[0].lodging.address, 'کربلا، خیابان الحسین', 'آدرس اقامتگاه');
assert.equal(stays[0].lodging.lat, 32.616, 'لوکیشن اقامتگاه');

// اقامتگاه یکسان برای هر دو گروه نباید دوبار لوکیشن بفرستد
db.assignStay(id2, { lodging_men_id: lodA, lodging_women_id: lodA, stay_note: null });
const same = db.stayLodgings(db.getReservation(id2));
assert.equal(same.length, 1, 'اقامتگاه تکراری یک‌بار');
assert.deepEqual(same[0].labels, ['آقایان', 'خانم‌ها'], 'هر دو گروه روی یک اقامتگاه');

// ویرایش ظرفیت اقامتگاه
db.updateLodging(lodA, { name: 'بیت الزهرا', cap_men: 55, cap_women: 5, active: 1,
  address: 'آدرس جدید', lat: null, lon: null, note: null });
assert.equal(db.getLodging(lodA).cap_men, 55, 'ویرایش ظرفیت');
assert.equal(db.getLodging(lodA).address, 'آدرس جدید', 'ویرایش آدرس');

// حذف رزرو، مدارکش را هم پاک می‌کند
const delId = db.createReservation({ tg_id: 5, username: null, full_name: 'حذف شونده',
  national_id: '1234567891', city: 'najaf', men: 1, women: 0,
  start_date: '2027-01-01', nights: 1, phone: null });
db.addDocument({ reservation_id: delId, tg_id: 5, file_id: 'F9', file_path: 'z.jpg' });
assert.equal(db.documentsFor(delId).length, 1);
db.deleteReservation(delId);
assert.equal(db.getReservation(delId), undefined, 'رزرو حذف شد');
assert.equal(db.documentsFor(delId).length, 0, 'مدارک رزرو حذف‌شده پاک شد');

// ---------- بازه‌های ویژه (سقف شب متفاوت) ----------
db.setSetting('MAX_NIGHTS', 7);
const perId = db.addPeriod({ title: 'دهه محرم', start_date: '2026-06-25',
  end_date: '2026-07-04', max_nights: 1 });
assert.equal(db.nightLimitFor('karbala', '2026-06-28').nights, 1, 'داخل بازه');
assert.equal(db.nightLimitFor('karbala', '2026-06-25').nights, 1, 'لبه شروع');
assert.equal(db.nightLimitFor('karbala', '2026-07-04').nights, 1, 'لبه پایان');
assert.equal(db.nightLimitFor('karbala', '2026-08-01').nights, 7, 'بیرون بازه');
assert.equal(db.strictestLimitOver('karbala', '2026-06-23', 5).nights, 1,
  'اقامتی که وارد بازه می‌شود محدود است');

// کمترین سقف بین بازه‌های هم‌پوشان برنده است
const per2 = db.addPeriod({ title: 'بازه ۳ شبه', start_date: '2026-06-27',
  end_date: '2026-06-29', max_nights: 3 });
assert.equal(db.nightLimitFor('karbala', '2026-06-28').nights, 1, 'کمترین سقف');

// بازه مخصوص یک شهر روی شهر دیگر اثر ندارد
const per3 = db.addPeriod({ title: 'فقط کربلا', start_date: '2026-10-01',
  end_date: '2026-10-05', max_nights: 2, city_id: db.getCityByKey('karbala').id });
assert.equal(db.nightLimitFor('karbala', '2026-10-02').nights, 2, 'بازه شهری');
assert.equal(db.nightLimitFor('najaf', '2026-10-02').nights, 7, 'شهر دیگر آزاد');

db.updatePeriod(perId, { title: 'دهه محرم', start_date: '2026-06-25',
  end_date: '2026-07-04', max_nights: 1, city_id: null, active: 0 });
assert.equal(db.nightLimitFor('karbala', '2026-06-26').nights, 7, 'بازه غیرفعال اثر ندارد');
for (const x of [perId, per2, per3]) db.deletePeriod(x);

// ---------- پیام همگانی و یادآوری ----------
db.markGuideSeen(987654);
assert.equal(db.userSeenGuide(987654), true, 'راهنما دیده شد');
assert.equal(db.userSeenGuide(111000), false, 'کاربر جدید راهنما را ندیده');
assert.ok(db.broadcastTargets('all').includes(987654), 'کاربر بدون رزرو در مخاطبان «همه»');
assert.ok(db.broadcastTargets('approved').length >= 1, 'مخاطبان تاییدشده');

const rem = db.createReservation({ tg_id: 42, username: null, full_name: 'یادآوری تست',
  national_id: '1234567891', city: 'najaf', men: 1, women: 0,
  start_date: '2026-05-10', nights: 3, phone: null });
db.decide(rem, 'approved', 111, 'TRKREM01');
assert.ok(db.checkoutDueOn('2026-05-12').some((r) => r.id === rem), 'روز آخر = شروع + شب - ۱');
assert.equal(db.checkoutDueOn('2026-05-13').some((r) => r.id === rem), false, 'روز بعد نه');
db.markCheckoutNotified(rem);
assert.equal(db.checkoutDueOn('2026-05-12').some((r) => r.id === rem), false,
  'پس از یادآوری دیگر در فهرست نیست');
db.deleteReservation(rem);

db.db.prepare('DELETE FROM lodgings WHERE id IN (?, ?)').run(lodA, lodB);
db.db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
db.db.prepare('DELETE FROM reservations WHERE id IN (?, ?)').run(id, id2);

// ---------- پارس multipart (آپلود فایل داشبورد) ----------
const bnd = '----test123';
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const mp = Buffer.concat([
  Buffer.from(`--${bnd}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\ntok\r\n`),
  Buffer.from(`--${bnd}\r\nContent-Disposition: form-data; name="GUIDE_TEXT"\r\n\r\nسلام دنیا\r\n`),
  Buffer.from(`--${bnd}\r\nContent-Disposition: form-data; name="img"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
  png, Buffer.from('\r\n'),
  Buffer.from(`--${bnd}--\r\n`),
]);
const parsed = parseMultipart(mp, bnd);
assert.equal(parsed.fields._csrf, 'tok', 'فیلد ساده');
assert.equal(parsed.fields.GUIDE_TEXT, 'سلام دنیا', 'فیلد فارسی (UTF-8)');
assert.equal(parsed.files.img.filename, 'a.png', 'نام فایل');
assert.equal(parsed.files.img.mime, 'image/png', 'نوع فایل');
assert.ok(parsed.files.img.data.equals(png), 'محتوای دودویی فایل دست‌نخورده');

// فایل خالی (کاربر چیزی انتخاب نکرده) نباید به‌عنوان فایل شمرده شود
const empty = Buffer.concat([
  Buffer.from(`--${bnd}\r\nContent-Disposition: form-data; name="img"; filename=""\r\nContent-Type: application/octet-stream\r\n\r\n\r\n`),
  Buffer.from(`--${bnd}--\r\n`),
]);
assert.deepEqual(parseMultipart(empty, bnd).files, {}, 'فایل خالی نادیده گرفته می‌شود');
assert.deepEqual(parseMultipart(Buffer.from('garbage'), bnd).files, {}, 'ورودی خراب خطا نمی‌دهد');

console.log('✅ همه تست‌ها با موفقیت اجرا شد');
