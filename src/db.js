import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { addDaysISO, todayISO } from './utils.js';

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

export const db = new Database(env.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  tg_id      INTEGER PRIMARY KEY,
  step       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id        INTEGER NOT NULL,
  username     TEXT,
  full_name    TEXT NOT NULL,
  national_id  TEXT NOT NULL,
  city         TEXT NOT NULL,
  men          INTEGER NOT NULL DEFAULT 0,
  women        INTEGER NOT NULL DEFAULT 0,
  start_date   TEXT NOT NULL,
  nights       INTEGER NOT NULL,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  tracking     TEXT,
  admin_note   TEXT,
  decided_by   INTEGER,
  decided_at   TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cities (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  key    TEXT NOT NULL UNIQUE,
  title  TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lodgings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id   INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  cap_men   INTEGER NOT NULL DEFAULT 0,
  cap_women INTEGER NOT NULL DEFAULT 0,
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS admins (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id   INTEGER NOT NULL,
  name    TEXT,
  role    TEXT NOT NULL,               -- 'super' یا 'city'
  city_id INTEGER REFERENCES cities(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_uniq
  ON admins(tg_id, role, IFNULL(city_id, 0));

-- بازه‌های ویژه: در این تاریخ‌ها سقف شب اقامت متفاوت است (مثلاً دهه محرم = ۱ شب)
CREATE TABLE IF NOT EXISTS periods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  max_nights INTEGER NOT NULL,
  city_id    INTEGER REFERENCES cities(id) ON DELETE CASCADE,  -- NULL = همه شهرها
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_period_range ON periods(start_date, end_date);

-- سابقه پیام‌های همگانی
CREATE TABLE IF NOT EXISTS broadcasts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  body       TEXT NOT NULL,
  audience   TEXT NOT NULL,
  sent       INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

-- کاربرانی که راهنمای تصویری را دیده‌اند (تا بار دوم تکرار نشود)
CREATE TABLE IF NOT EXISTS bot_users (
  tg_id      INTEGER PRIMARY KEY,
  guide_seen TEXT,
  first_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
  tg_id          INTEGER NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'id',
  file_id        TEXT NOT NULL,
  file_path      TEXT,
  mime           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_res ON documents(reservation_id);

CREATE INDEX IF NOT EXISTS idx_res_city   ON reservations(city, status);
CREATE INDEX IF NOT EXISTS idx_res_tg     ON reservations(tg_id);
CREATE INDEX IF NOT EXISTS idx_res_nid    ON reservations(national_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_res_track ON reservations(tracking)
  WHERE tracking IS NOT NULL;
`);

// ---------- مهاجرت: ستون‌های ثبت ورود (برای دیتابیس‌های از قبل ساخته‌شده) ----------
{
  const cols = new Set(db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
  if (!cols.has('checked_in_at')) db.exec('ALTER TABLE reservations ADD COLUMN checked_in_at TEXT');
  if (!cols.has('checked_in_by')) db.exec('ALTER TABLE reservations ADD COLUMN checked_in_by INTEGER');
  if (!cols.has('lodging_id')) db.exec('ALTER TABLE reservations ADD COLUMN lodging_id INTEGER');
  // اسکان به تفکیک جنسیت + توضیحات ادمین
  if (!cols.has('lodging_men_id')) db.exec('ALTER TABLE reservations ADD COLUMN lodging_men_id INTEGER');
  if (!cols.has('lodging_women_id')) db.exec('ALTER TABLE reservations ADD COLUMN lodging_women_id INTEGER');
  if (!cols.has('stay_note')) db.exec('ALTER TABLE reservations ADD COLUMN stay_note TEXT');
  // یادآوری پایان اقامت (تا دوبار ارسال نشود)
  if (!cols.has('checkout_notified_at'))
    db.exec('ALTER TABLE reservations ADD COLUMN checkout_notified_at TEXT');

  const lc = new Set(db.prepare('PRAGMA table_info(lodgings)').all().map((c) => c.name));
  if (!lc.has('address')) db.exec('ALTER TABLE lodgings ADD COLUMN address TEXT');
  if (!lc.has('lat')) db.exec('ALTER TABLE lodgings ADD COLUMN lat REAL');
  if (!lc.has('lon')) db.exec('ALTER TABLE lodgings ADD COLUMN lon REAL');
  if (!lc.has('note')) db.exec('ALTER TABLE lodgings ADD COLUMN note TEXT');
}

const now = () => new Date().toISOString();

// ---------- تنظیمات (کلید/مقدار) ----------

export const getSetting = (key, dflt = null) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : dflt;
};

export const getSettingNum = (key, dflt) => {
  const v = getSetting(key);
  const n = Number(v);
  return v === null || v === '' || !Number.isFinite(n) ? dflt : n;
};

export const setSetting = (key, value) =>
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));

export const allSettings = () =>
  Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));

// ---------- شهرها ----------

export const listCities = (onlyActive = false) =>
  db.prepare(
    `SELECT * FROM cities ${onlyActive ? 'WHERE active = 1' : ''} ORDER BY sort, id`
  ).all();

export const getCity = (id) => db.prepare('SELECT * FROM cities WHERE id = ?').get(id);
export const getCityByKey = (key) => db.prepare('SELECT * FROM cities WHERE key = ?').get(key);

export function addCity({ key, title, sort = 0 }) {
  const info = db.prepare('INSERT INTO cities (key, title, sort) VALUES (?, ?, ?)')
    .run(key, title, sort);
  return info.lastInsertRowid;
}

export const updateCity = (id, { title, active, sort }) =>
  db.prepare('UPDATE cities SET title = ?, active = ?, sort = ? WHERE id = ?')
    .run(title, active ? 1 : 0, sort, id);

export const deleteCity = (id) => db.prepare('DELETE FROM cities WHERE id = ?').run(id);

/** آیا شهر رزرو دارد؟ (برای جلوگیری از حذف شهرِ دارای رزرو) */
export const cityReservationCount = (key) =>
  db.prepare('SELECT COUNT(*) n FROM reservations WHERE city = ?').get(key).n;

// ---------- اقامتگاه‌ها ----------

export const listLodgings = (cityId = null, onlyActive = false) => {
  const where = [];
  const args = [];
  if (cityId !== null) { where.push('city_id = ?'); args.push(cityId); }
  if (onlyActive) where.push('active = 1');
  return db.prepare(
    `SELECT * FROM lodgings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`
  ).all(...args);
};

export const getLodging = (id) => db.prepare('SELECT * FROM lodgings WHERE id = ?').get(id);

export function addLodging({ city_id, name, cap_men = 0, cap_women = 0,
  address = null, lat = null, lon = null, note = null }) {
  const info = db.prepare(
    `INSERT INTO lodgings (city_id, name, cap_men, cap_women, address, lat, lon, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(city_id, name, cap_men, cap_women, address, lat, lon, note);
  return info.lastInsertRowid;
}

export const updateLodging = (id, { name, cap_men, cap_women, active, address, lat, lon, note }) =>
  db.prepare(
    `UPDATE lodgings SET name = ?, cap_men = ?, cap_women = ?, active = ?,
     address = ?, lat = ?, lon = ?, note = ? WHERE id = ?`
  ).run(name, cap_men, cap_women, active ? 1 : 0, address, lat, lon, note, id);

export const deleteLodging = (id) => db.prepare('DELETE FROM lodgings WHERE id = ?').run(id);

/** ظرفیت کل یک شهر = مجموع اقامتگاه‌های فعالش */
export function cityCapacity(cityKey) {
  const row = db.prepare(
    `SELECT IFNULL(SUM(l.cap_men), 0) men, IFNULL(SUM(l.cap_women), 0) women
     FROM lodgings l JOIN cities c ON c.id = l.city_id
     WHERE c.key = ? AND l.active = 1`
  ).get(cityKey);
  return { men: row.men, women: row.women };
}

// ---------- کاربرانی که راهنما را دیده‌اند ----------

export const userSeenGuide = (tgId) =>
  !!db.prepare('SELECT guide_seen FROM bot_users WHERE tg_id = ?').get(tgId)?.guide_seen;

export const markGuideSeen = (tgId) =>
  db.prepare(
    `INSERT INTO bot_users (tg_id, guide_seen, first_seen) VALUES (?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET guide_seen = excluded.guide_seen`
  ).run(tgId, now(), now());

/** همه کاربرانی که ربات را استارت کرده‌اند — مخاطب پیام همگانی */
export const allBotUsers = () =>
  db.prepare('SELECT tg_id FROM bot_users').all().map((r) => r.tg_id);

// ---------- بازه‌های ویژه (سقف شب متفاوت) ----------

export const listPeriods = () =>
  db.prepare(
    `SELECT p.*, c.title city_title, c.key city_key
     FROM periods p LEFT JOIN cities c ON c.id = p.city_id
     ORDER BY p.start_date DESC, p.id DESC`
  ).all();

export function addPeriod({ title, start_date, end_date, max_nights, city_id = null }) {
  return db.prepare(
    `INSERT INTO periods (title, start_date, end_date, max_nights, city_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(title, start_date, end_date, max_nights, city_id).lastInsertRowid;
}

export const updatePeriod = (id, { title, start_date, end_date, max_nights, city_id, active }) =>
  db.prepare(
    `UPDATE periods SET title = ?, start_date = ?, end_date = ?, max_nights = ?,
     city_id = ?, active = ? WHERE id = ?`
  ).run(title, start_date, end_date, max_nights, city_id, active ? 1 : 0, id);

export const deletePeriod = (id) => db.prepare('DELETE FROM periods WHERE id = ?').run(id);

/**
 * سقف شب برای یک تاریخ ورود و شهر.
 * اگر تاریخ در چند بازه بیفتد، سخت‌گیرانه‌ترین (کمترین) سقف اعمال می‌شود.
 * خروجی: { nights, period } — period اگر بازه‌ای فعال بود.
 */
export function nightLimitFor(cityKey, startISO) {
  const dflt = getSettingNum('MAX_NIGHTS', 7);
  const city = cityKey ? getCityByKey(cityKey) : null;
  const rows = db.prepare(
    `SELECT * FROM periods
     WHERE active = 1 AND start_date <= ? AND end_date >= ?
       AND (city_id IS NULL OR city_id = ?)`
  ).all(startISO, startISO, city ? city.id : -1);

  let best = { nights: dflt, period: null };
  for (const p of rows)
    if (p.max_nights < best.nights) best = { nights: p.max_nights, period: p };
  return best;
}

/** بازه‌هایی که با کل مدت اقامت هم‌پوشانی دارند — برای اعتبارسنجی نهایی */
export function strictestLimitOver(cityKey, startISO, nights) {
  let best = { nights: getSettingNum('MAX_NIGHTS', 7), period: null };
  for (let i = 0; i < nights; i++) {
    const day = addDaysISO(startISO, i);
    const lim = nightLimitFor(cityKey, day);
    if (lim.nights < best.nights) best = lim;
  }
  return best;
}

// ---------- پیام همگانی ----------

/** آی‌دی کاربران هدف پیام همگانی */
export function broadcastTargets(audience, cityKey = null) {
  // «همه» = هر کسی که ربات را استارت کرده، حتی بدون رزرو
  if (audience === 'all') {
    const set = new Set(allBotUsers());
    for (const r of db.prepare('SELECT DISTINCT tg_id FROM reservations').all()) set.add(r.tg_id);
    return [...set];
  }
  const q = {
    approved: "SELECT DISTINCT tg_id FROM reservations WHERE status = 'approved'",
    pending: "SELECT DISTINCT tg_id FROM reservations WHERE status = 'pending'",
    upcoming: "SELECT DISTINCT tg_id FROM reservations WHERE status = 'approved' AND start_date >= ?",
    city: 'SELECT DISTINCT tg_id FROM reservations WHERE city = ?',
  }[audience];
  if (!q) return [];
  if (audience === 'upcoming') return db.prepare(q).all(todayISO()).map((r) => r.tg_id);
  if (audience === 'city') return db.prepare(q).all(cityKey).map((r) => r.tg_id);
  return db.prepare(q).all().map((r) => r.tg_id);
}

export const logBroadcast = ({ body, audience, sent, failed, created_by }) =>
  db.prepare(
    `INSERT INTO broadcasts (body, audience, sent, failed, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(body, audience, sent, failed, created_by, now()).lastInsertRowid;

export const recentBroadcasts = (limit = 20) =>
  db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT ?').all(limit);

// ---------- یادآوری پایان اقامت ----------

/** رزروهای تاییدشده‌ای که امروز آخرین شبشان است و یادآوری نگرفته‌اند */
export const checkoutDueOn = (iso) =>
  db.prepare(
    `SELECT * FROM reservations
     WHERE status = 'approved' AND checkout_notified_at IS NULL
       AND date(start_date, '+' || (nights - 1) || ' day') = ?`
  ).all(iso);

export const markCheckoutNotified = (id) =>
  db.prepare('UPDATE reservations SET checkout_notified_at = ? WHERE id = ?').run(now(), id);

// ---------- ادمین‌ها ----------

export const listAdmins = () =>
  db.prepare(
    `SELECT a.*, c.key city_key, c.title city_title
     FROM admins a LEFT JOIN cities c ON c.id = a.city_id
     ORDER BY a.role DESC, a.id`
  ).all();

export function addAdmin({ tg_id, name = null, role, city_id = null }) {
  return db.prepare(
    `INSERT INTO admins (tg_id, name, role, city_id) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).run(tg_id, name, role, role === 'super' ? null : city_id);
}

export const deleteAdmin = (id) => db.prepare('DELETE FROM admins WHERE id = ?').run(id);

export const superAdminIds = () =>
  db.prepare("SELECT DISTINCT tg_id FROM admins WHERE role = 'super'").all().map((r) => r.tg_id);

export const cityAdminIds = (cityKey) =>
  db.prepare(
    `SELECT DISTINCT a.tg_id FROM admins a JOIN cities c ON c.id = a.city_id
     WHERE a.role = 'city' AND c.key = ?`
  ).all(cityKey).map((r) => r.tg_id);

// ---------- مدارک شناسایی ----------

export function addDocument({ reservation_id, tg_id, kind = 'id', file_id, file_path = null, mime = null }) {
  const info = db.prepare(
    `INSERT INTO documents (reservation_id, tg_id, kind, file_id, file_path, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(reservation_id, tg_id, kind, file_id, file_path, mime, now());
  return info.lastInsertRowid;
}

export const documentsFor = (reservationId) =>
  db.prepare('SELECT * FROM documents WHERE reservation_id = ? ORDER BY id').all(reservationId);

export const getDocument = (id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);

export const attachDocuments = (reservationId, tgId) =>
  db.prepare(
    'UPDATE documents SET reservation_id = ? WHERE reservation_id IS NULL AND tg_id = ?'
  ).run(reservationId, tgId);

export const orphanDocuments = (tgId) =>
  db.prepare('SELECT * FROM documents WHERE reservation_id IS NULL AND tg_id = ?').all(tgId);

export const clearOrphanDocuments = (tgId) =>
  db.prepare('DELETE FROM documents WHERE reservation_id IS NULL AND tg_id = ?').run(tgId);

// ---------- مقداردهی اولیه از .env (فقط اولین اجرا) ----------

export function seedFromEnv() {
  const seeded = getSetting('_seeded');
  if (seeded) return false;

  const s = env.seed;
  const tx = db.transaction(() => {
    // تنظیمات عمومی
    setSetting('MAX_NIGHTS', s.maxNights);
    setSetting('MAX_DAYS_AHEAD', s.maxDaysAhead);
    setSetting('MAX_PER_BOOKING', s.maxPerBooking);
    setSetting('REQUIRE_DOCUMENT', 'optional');   // off | optional | required
    setSetting('WELCOME_EXTRA', '');

    // شهرها و اقامتگاه پیش‌فرض هر شهر
    const cities = [
      ['najaf', 'نجف', s.capNajafMen, s.capNajafWomen, s.chatNajaf, s.najafIds],
      ['karbala', 'کربلا', s.capKarbalaMen, s.capKarbalaWomen, s.chatKarbala, s.karbalaIds],
    ];
    let sort = 0;
    for (const [key, title, capM, capW, chat, adminIds] of cities) {
      let city = getCityByKey(key);
      const cityId = city ? city.id : addCity({ key, title, sort: sort++ });
      if (!listLodgings(cityId).length)
        addLodging({ city_id: cityId, name: `اقامتگاه ${title}`, cap_men: capM, cap_women: capW });
      if (chat) setSetting(`ADMIN_CHAT_${key}`, chat);
      for (const tg of adminIds) addAdmin({ tg_id: tg, role: 'city', city_id: cityId });
    }
    for (const tg of s.superIds) addAdmin({ tg_id: tg, role: 'super' });

    setSetting('_seeded', now());
  });
  tx();
  return true;
}



// ---------- نشست گفتگو ----------

export function getSession(tgId) {
  const row = db.prepare('SELECT step, data FROM sessions WHERE tg_id = ?').get(tgId);
  if (!row) return { step: 'idle', data: {} };
  return { step: row.step, data: JSON.parse(row.data) };
}

export function setSession(tgId, step, data = {}) {
  db.prepare(
    `INSERT INTO sessions (tg_id, step, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET step = excluded.step,
       data = excluded.data, updated_at = excluded.updated_at`
  ).run(tgId, step, JSON.stringify(data), now());
}

export function clearSession(tgId) {
  db.prepare('DELETE FROM sessions WHERE tg_id = ?').run(tgId);
}

// ---------- رزرو ----------

export function createReservation(r) {
  const info = db
    .prepare(
      `INSERT INTO reservations
       (tg_id, username, full_name, national_id, city, men, women,
        start_date, nights, phone, status, created_at)
       VALUES (@tg_id, @username, @full_name, @national_id, @city, @men, @women,
        @start_date, @nights, @phone, 'pending', @created_at)`
    )
    .run({ ...r, created_at: now() });
  return info.lastInsertRowid;
}

export const getReservation = (id) =>
  db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

export const getByTracking = (code) =>
  db.prepare('SELECT * FROM reservations WHERE tracking = ?').get(code);

export function decide(id, status, adminId, tracking = null, note = null) {
  db.prepare(
    `UPDATE reservations SET status = ?, tracking = ?, admin_note = ?,
     decided_by = ?, decided_at = ? WHERE id = ?`
  ).run(status, tracking, note, adminId, now(), id);
}

/**
 * ثبت ورود مهمان با کد رهگیری.
 * فقط رزرو تاییدشده و فقط یک‌بار. خروجی: { ok, reason, reservation }
 */
export function checkIn(trackingCode, adminId) {
  const r = getByTracking(trackingCode);
  if (!r) return { ok: false, reason: 'not_found', reservation: null };
  if (r.status !== 'approved') return { ok: false, reason: 'not_approved', reservation: r };
  if (r.checked_in_at) return { ok: false, reason: 'already', reservation: r };
  db.prepare('UPDATE reservations SET checked_in_at = ?, checked_in_by = ? WHERE id = ?')
    .run(now(), adminId, r.id);
  return { ok: true, reason: null, reservation: getReservation(r.id) };
}

/** بازگرداندن ثبت ورود (اگر اشتباه ثبت شده باشد) */
export const undoCheckIn = (id) =>
  db.prepare('UPDATE reservations SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ?').run(id);

/** ثبت محل اسکان و توضیحات هنگام تایید */
export const assignStay = (id, { lodging_men_id = null, lodging_women_id = null, stay_note = null }) =>
  db.prepare(
    'UPDATE reservations SET lodging_men_id = ?, lodging_women_id = ?, stay_note = ? WHERE id = ?'
  ).run(lodging_men_id, lodging_women_id, stay_note, id);

/** اقامتگاه‌های اختصاص‌داده‌شده به یک رزرو، بدون تکرار */
export function stayLodgings(r) {
  const out = [];
  const seen = new Set();
  for (const [key, label] of [['lodging_men_id', 'آقایان'], ['lodging_women_id', 'خانم‌ها']]) {
    const id = r[key];
    if (!id) continue;
    const l = getLodging(id);
    if (!l) continue;
    const hit = out.find((o) => o.lodging.id === id);
    if (hit) { hit.labels.push(label); continue; }
    out.push({ lodging: l, labels: [label] });
    seen.add(id);
  }
  return out;
}

export const deleteReservation = (id) => {
  db.prepare('DELETE FROM documents WHERE reservation_id = ?').run(id);
  return db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
};

export const userReservations = (tgId) =>
  db
    .prepare(
      `SELECT * FROM reservations WHERE tg_id = ?
       ORDER BY id DESC LIMIT 10`
    )
    .all(tgId);

/**
 * رزرو بازِ همان کد ملی که با بازه خواسته‌شده هم‌پوشانی دارد.
 * شهر مهم نیست: نجف و کربلا در تاریخ مشترک مجاز نیست.
 */
export function overlappingReservation(nationalId, startISO, nights, excludeId = null) {
  const rows = db
    .prepare(
      `SELECT * FROM reservations
       WHERE national_id = ? AND status IN ('pending','approved')`
    )
    .all(nationalId);
  const endISO = addDaysISO(startISO, nights - 1);
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    const rEnd = addDaysISO(r.start_date, r.nights - 1);
    if (startISO <= rEnd && r.start_date <= endISO) return r;
  }
  return null;
}

export const pendingCount = (cities) =>
  db
    .prepare(
      `SELECT COUNT(*) c FROM reservations
       WHERE status = 'pending' AND city IN (${cities.map(() => '?').join(',')})`
    )
    .get(...cities).c;

export const pendingList = (cities, limit = 20) =>
  db
    .prepare(
      `SELECT * FROM reservations
       WHERE status = 'pending' AND city IN (${cities.map(() => '?').join(',')})
       ORDER BY id ASC LIMIT ?`
    )
    .all(...cities, limit);

// ---------- گزارش ----------

export const statsByCity = () =>
  db
    .prepare(
      `SELECT city, status, COUNT(*) n,
              SUM(men) men, SUM(women) women
       FROM reservations GROUP BY city, status`
    )
    .all();

export const arrivalsOn = (iso, cities) =>
  db
    .prepare(
      `SELECT * FROM reservations
       WHERE status = 'approved' AND start_date = ?
         AND city IN (${cities.map(() => '?').join(',')})
       ORDER BY city, id`
    )
    .all(iso, ...cities);

/** اشغال یک شب مشخص */
export function occupancyOn(city, iso) {
  const rows = db
    .prepare(
      `SELECT men, women, start_date, nights FROM reservations
       WHERE city = ? AND status = 'approved' AND start_date <= ?`
    )
    .all(city, iso);
  let men = 0;
  let women = 0;
  for (const r of rows) {
    if (iso <= addDaysISO(r.start_date, r.nights - 1)) {
      men += r.men;
      women += r.women;
    }
  }
  return { men, women };
}

export const allReservations = (cities) =>
  db
    .prepare(
      `SELECT * FROM reservations
       WHERE city IN (${cities.map(() => '?').join(',')})
       ORDER BY id ASC`
    )
    .all(...cities);

/**
 * بیشترین اشغال شبانه در بازه خواسته‌شده.
 * فقط رزروهای تاییدشده حساب می‌شوند.
 */
export function peakOccupancy(city, startISO, nights, excludeId = null) {
  const rows = db
    .prepare(
      `SELECT id, men, women, start_date, nights FROM reservations
       WHERE city = ? AND status = 'approved'`
    )
    .all(city);

  let men = 0;
  let women = 0;
  for (let i = 0; i < nights; i++) {
    const night = addDaysISO(startISO, i);
    let m = 0;
    let w = 0;
    for (const r of rows) {
      if (excludeId && r.id === excludeId) continue;
      const end = addDaysISO(r.start_date, r.nights - 1);
      if (night >= r.start_date && night <= end) {
        m += r.men;
        w += r.women;
      }
    }
    men = Math.max(men, m);
    women = Math.max(women, w);
  }
  return { men, women };
}

/** آیا با اضافه شدن این رزرو ظرفیت پر می‌شود؟ */
export function capacityCheck(city, startISO, nights, men, women, excludeId = null) {
  const cap = cityCapacity(city);
  const used = peakOccupancy(city, startISO, nights, excludeId);
  return {
    ok: used.men + men <= cap.men && used.women + women <= cap.women,
    freeMen: cap.men - used.men,
    freeWomen: cap.women - used.women,
  };
}
