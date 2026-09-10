import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { addDaysISO } from './utils.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
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

CREATE INDEX IF NOT EXISTS idx_res_city   ON reservations(city, status);
CREATE INDEX IF NOT EXISTS idx_res_tg     ON reservations(tg_id);
CREATE INDEX IF NOT EXISTS idx_res_nid    ON reservations(national_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_res_track ON reservations(tracking)
  WHERE tracking IS NOT NULL;
`);

const now = () => new Date().toISOString();

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
  const cap = config.cities[city];
  const used = peakOccupancy(city, startISO, nights, excludeId);
  return {
    ok: used.men + men <= cap.men && used.women + women <= cap.women,
    freeMen: cap.men - used.men,
    freeWomen: cap.women - used.women,
  };
}
