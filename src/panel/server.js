import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../env.js';
import * as db from '../db.js';
import { config, cityKeys, cityTitle } from '../config.js';
import { buildCsv } from '../flow.js';
import { todayISO, addDaysISO } from '../utils.js';
import * as V from './views.js';

const DOCS_DIR = env.docsDir || path.join(path.dirname(env.dbPath), 'docs');
const SESSION_TTL = 8 * 60 * 60 * 1000;

// ---------- احراز هویت ----------

/** گذرواژه با scrypt هش می‌شود؛ مقایسه زمان‌ثابت است */
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

function passwordOk(input) {
  if (!env.panelPassword) return false;
  const salt = env.panelSecret || 'bh-bot';
  const a = Buffer.from(hash(input, salt));
  const b = Buffer.from(hash(env.panelPassword, salt));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sessions = new Map();   // token → { user, exp, csrf }
const attempts = new Map();   // ip → { n, until }

function newSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, exp: Date.now() + SESSION_TTL, csrf: crypto.randomBytes(16).toString('hex') });
  return token;
}

function getSession(req) {
  const raw = (req.headers.cookie || '').split(';')
    .map((c) => c.trim().split('=')).find(([k]) => k === 'bh_sess');
  if (!raw) return null;
  const s = sessions.get(raw[1]);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(raw[1]); return null; }
  return { ...s, token: raw[1] };
}

function rateLimited(ip) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) return true;
  if (a && a.until <= Date.now()) attempts.delete(ip);
  return false;
}

function noteFailure(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= 5) { a.until = Date.now() + 10 * 60 * 1000; a.n = 0; }
  attempts.set(ip, a);
}

// ---------- کمکی‌های HTTP ----------

const send = (res, code, body, type = 'text/html; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin', ...extra });
  res.end(body);
};
const redirect = (res, to, extra = {}) => { res.writeHead(302, { location: to, ...extra }); res.end(); };

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const parseForm = (s) => Object.fromEntries(new URLSearchParams(s));

// ---------- داده ----------

function cityRows() {
  return db.listCities().map((c) => ({
    ...c,
    chat: db.getSetting(`ADMIN_CHAT_${c.key}`, '') || '',
    lodgings: db.listLodgings(c.id),
    reservations: db.cityReservationCount(c.key),
  }));
}

function overviewData() {
  const today = todayISO();
  const stats = db.statsByCity();
  const sum = (f) => stats.reduce((a, r) => a + (f(r) || 0), 0);
  const byStatus = (st) => stats.filter((r) => r.status === st).reduce((a, r) => a + r.n, 0);
  const approved = stats.filter((r) => r.status === 'approved');

  const cities = db.listCities(true).map((c) => ({
    title: c.title,
    cap: db.cityCapacity(c.key),
    occ: db.occupancyOn(c.key, today),
    lodgings: db.listLodgings(c.id, true).length,
  }));

  const arrivals = db.arrivalsOn(today, cityKeys())
    .map((r) => ({ ...r, city_title: cityTitle(r.city) }));

  return {
    today, cities, arrivals,
    stats: {
      total: sum((r) => r.n),
      pending: byStatus('pending'),
      approved: byStatus('approved'),
      guests: approved.reduce((a, r) => a + r.men + r.women, 0),
    },
  };
}

function reservationRows(q) {
  const where = [];
  const args = [];
  if (q.city) { where.push('r.city = ?'); args.push(q.city); }
  if (q.status) { where.push('r.status = ?'); args.push(q.status); }
  if (q.q) {
    where.push('(r.full_name LIKE ? OR r.national_id LIKE ? OR IFNULL(r.tracking,\'\') LIKE ?)');
    const like = `%${q.q}%`;
    args.push(like, like, like);
  }
  return db.db.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM documents d WHERE d.reservation_id = r.id) doc_count
     FROM reservations r ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.id DESC LIMIT 500`
  ).all(...args).map((r) => ({
    ...r, city_title: cityTitle(r.city),
    stay_short: db.stayLodgings(r).map((x) => x.lodging.name).join('، '),
  }));
}

// ---------- سرور ----------

export function startPanel({ onAdminsChanged, onReservationApproved } = {}) {
  if (!env.panelPassword) {
    console.error('⚠️ PANEL_PASSWORD تنظیم نشده — داشبورد وب اجرا نشد.');
    return null;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    const ip = req.socket.remoteAddress || '?';
    const sess = getSession(req);

    try {
      // ---- ورود ----
      if (p === '/login' && req.method === 'GET') {
        if (sess) return redirect(res, '/');
        const tmp = newSession('__pending__');
        return send(res, 200, V.loginPage(null, sessions.get(tmp).csrf),
          'text/html; charset=utf-8',
          { 'set-cookie': `bh_csrf=${tmp}; HttpOnly; SameSite=Strict; Path=/; Max-Age=600` });
      }

      if (p === '/login' && req.method === 'POST') {
        if (rateLimited(ip))
          return send(res, 429, V.loginPage('تلاش‌های ناموفق زیاد. ۱۰ دقیقه صبر کنید.', ''));
        const form = parseForm(await readBody(req));
        if (form.username === env.panelUser && passwordOk(form.password || '')) {
          attempts.delete(ip);
          const token = newSession(form.username);
          return redirect(res, '/', {
            'set-cookie': `bh_sess=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`,
          });
        }
        noteFailure(ip);
        return send(res, 401, V.loginPage('نام کاربری یا گذرواژه نادرست است.', ''));
      }

      if (p === '/logout') {
        if (sess) sessions.delete(sess.token);
        return redirect(res, '/login', { 'set-cookie': 'bh_sess=; Path=/; Max-Age=0' });
      }

      // ---- از این پس نیاز به ورود ----
      if (!sess || sess.user === '__pending__') return redirect(res, '/login');

      if (req.method === 'POST') {
        const form = parseForm(await readBody(req));
        if (form._csrf !== sess.csrf) return send(res, 403, 'درخواست نامعتبر (CSRF).');
        req.form = form;
      }

      // ---- صفحات ----
      if (p === '/' && req.method === 'GET')
        return send(res, 200, V.overviewPage(overviewData()));

      if (p === '/reservations' && req.method === 'GET') {
        const q = { city: url.searchParams.get('city') || '', status: url.searchParams.get('status') || '',
          q: url.searchParams.get('q') || '' };
        return send(res, 200, V.reservationsPage({
          rows: reservationRows(q), cities: db.listCities(), q }));
      }

      let m;
      if ((m = p.match(/^\/reservations\/(\d+)$/)) && req.method === 'GET') {
        const r = db.getReservation(Number(m[1]));
        if (!r) return send(res, 404, V.layout({ title: '۴۰۴', body: '<h1>رزرو پیدا نشد</h1>' }));
        const stays = db.stayLodgings(r);
        const stayHtml = stays.length
          ? stays.map(({ lodging, labels }) => `<div class="stay"><b>${V.esc(lodging.name)}</b>
              — ${labels.join(' و ')}${lodging.address ? '<br>📍 ' + V.esc(lodging.address) : ''}
              ${lodging.lat != null && lodging.lon != null
                ? `<br><a href="https://www.google.com/maps?q=${lodging.lat},${lodging.lon}"
                     target="_blank" rel="noopener">مشاهده روی نقشه</a>` : ''}</div>`).join('')
          : '—';
        return send(res, 200, V.reservationPage({
          r: { ...r, city_title: cityTitle(r.city), stay: stayHtml },
          docs: db.documentsFor(r.id),
          lodgings: db.listLodgings(db.getCityByKey(r.city)?.id ?? -1, true),
          csrf: sess.csrf }));
      }

      if ((m = p.match(/^\/reservations\/(\d+)\/decide$/)) && req.method === 'POST') {
        const id = Number(m[1]);
        const r = db.getReservation(id);
        if (r && r.status === 'pending') {
          if (req.form.action === 'approve') {
            const code = crypto.randomBytes(4).toString('hex').toUpperCase();
            db.decide(id, 'approved', 0, code);
            db.assignStay(id, {
              lodging_men_id: Number(req.form.lodging_men_id) || null,
              lodging_women_id: Number(req.form.lodging_women_id) || null,
              stay_note: (req.form.stay_note || '').trim() || null,
            });
            onReservationApproved?.(id);
          } else db.decide(id, 'rejected', 0);
        }
        return redirect(res, `/reservations/${id}`);
      }

      if ((m = p.match(/^\/reservations\/(\d+)\/delete$/)) && req.method === 'POST') {
        const id = Number(m[1]);
        // فایل مدارک روی دیسک هم پاک شود
        for (const d of db.documentsFor(id)) {
          if (!d.file_path) continue;
          try { fs.unlinkSync(path.join(DOCS_DIR, path.basename(d.file_path))); } catch { /* قبلاً نبوده */ }
        }
        db.deleteReservation(id);
        return redirect(res, '/reservations');
      }

      // ---- مدارک ----
      if ((m = p.match(/^\/doc\/(\d+)$/)) && req.method === 'GET') {
        const d = db.getDocument(Number(m[1]));
        if (!d || !d.file_path) return send(res, 404, 'یافت نشد');
        const file = path.join(DOCS_DIR, path.basename(d.file_path));
        if (!fs.existsSync(file)) return send(res, 404, 'فایل روی دیسک نیست');
        return send(res, 200, fs.readFileSync(file), d.mime || 'image/jpeg',
          { 'cache-control': 'private, no-store' });
      }

      // ---- شهرها ----
      if (p === '/cities' && req.method === 'GET')
        return send(res, 200, V.citiesPage({ cities: cityRows(), csrf: sess.csrf }));

      if (p === '/cities/add' && req.method === 'POST') {
        const key = (req.form.key || '').trim().toLowerCase();
        if (/^[a-z0-9_-]{2,20}$/.test(key) && !db.getCityByKey(key))
          db.addCity({ key, title: (req.form.title || key).trim(), sort: db.listCities().length });
        return redirect(res, '/cities');
      }

      if ((m = p.match(/^\/cities\/(\d+)\/update$/)) && req.method === 'POST') {
        const c = db.getCity(Number(m[1]));
        if (c) {
          db.updateCity(c.id, { title: (req.form.title || c.title).trim(),
            active: req.form.active === '1', sort: Number(req.form.sort) || 0 });
          db.setSetting(`ADMIN_CHAT_${c.key}`, (req.form.chat || '').trim());
        }
        return redirect(res, '/cities');
      }

      if ((m = p.match(/^\/cities\/(\d+)\/delete$/)) && req.method === 'POST') {
        const c = db.getCity(Number(m[1]));
        if (c && db.cityReservationCount(c.key) === 0) db.deleteCity(c.id);
        return redirect(res, '/cities');
      }

      // ---- اقامتگاه‌ها ----
      if (p === '/lodgings/add' && req.method === 'POST') {
        const cityId = Number(req.form.city_id);
        if (db.getCity(cityId) && (req.form.name || '').trim())
          db.addLodging({ city_id: cityId, name: req.form.name.trim(),
            cap_men: Math.max(0, Number(req.form.cap_men) || 0),
            cap_women: Math.max(0, Number(req.form.cap_women) || 0) });
        return redirect(res, '/cities');
      }

      if ((m = p.match(/^\/lodgings\/(\d+)\/update$/)) && req.method === 'POST') {
        const l = db.getLodging(Number(m[1]));
        if (l) {
          const coord = (v, max) => {
            const n = Number(String(v ?? '').trim());
            return String(v ?? '').trim() === '' || !Number.isFinite(n) || Math.abs(n) > max ? null : n;
          };
          db.updateLodging(l.id, {
            name: (req.form.name || l.name).trim(),
            cap_men: Math.max(0, Number(req.form.cap_men) || 0),
            cap_women: Math.max(0, Number(req.form.cap_women) || 0),
            active: req.form.active === '1',
            address: (req.form.address || '').trim() || null,
            lat: coord(req.form.lat, 90),
            lon: coord(req.form.lon, 180),
            note: (req.form.note || '').trim() || null,
          });
        }
        return redirect(res, '/cities');
      }

      if ((m = p.match(/^\/lodgings\/(\d+)\/delete$/)) && req.method === 'POST') {
        db.deleteLodging(Number(m[1]));
        return redirect(res, '/cities');
      }

      // ---- ادمین‌ها ----
      if (p === '/admins' && req.method === 'GET')
        return send(res, 200, V.adminsPage({
          admins: db.listAdmins(), cities: db.listCities(), csrf: sess.csrf }));

      if (p === '/admins/add' && req.method === 'POST') {
        const tg = Number(req.form.tg_id);
        const role = req.form.role === 'city' ? 'city' : 'super';
        if (Number.isFinite(tg) && tg > 0) {
          db.addAdmin({ tg_id: tg, name: (req.form.name || '').trim() || null,
            role, city_id: role === 'city' ? Number(req.form.city_id) : null });
          onAdminsChanged?.();
        }
        return redirect(res, '/admins');
      }

      if ((m = p.match(/^\/admins\/(\d+)\/delete$/)) && req.method === 'POST') {
        db.deleteAdmin(Number(m[1]));
        onAdminsChanged?.();
        return redirect(res, '/admins');
      }

      // ---- تنظیمات ----
      if (p === '/settings' && req.method === 'GET')
        return send(res, 200, V.settingsPage({ s: db.allSettings(), csrf: sess.csrf }));

      if (p === '/settings' && req.method === 'POST') {
        const nums = { MAX_NIGHTS: [1, 60], MAX_DAYS_AHEAD: [1, 730], MAX_PER_BOOKING: [1, 100] };
        for (const [k, [lo, hi]] of Object.entries(nums)) {
          const v = Number(req.form[k]);
          if (Number.isInteger(v) && v >= lo && v <= hi) db.setSetting(k, v);
        }
        if (['off', 'optional', 'required'].includes(req.form.REQUIRE_DOCUMENT))
          db.setSetting('REQUIRE_DOCUMENT', req.form.REQUIRE_DOCUMENT);
        db.setSetting('WELCOME_EXTRA', (req.form.WELCOME_EXTRA || '').slice(0, 500));
        return redirect(res, '/settings');
      }

      if (p === '/export.csv' && req.method === 'GET')
        return send(res, 200, buildCsv(cityKeys()), 'text/csv; charset=utf-8',
          { 'content-disposition': `attachment; filename="reservations-${todayISO()}.csv"` });

      return send(res, 404, V.layout({ title: '۴۰۴', body: '<h1>صفحه پیدا نشد</h1><p><a href="/">خانه</a></p>' }));
    } catch (err) {
      console.error('panel error', err);
      return send(res, 500, V.layout({ title: 'خطا', body: '<h1>خطای داخلی سرور</h1>' }));
    }
  });

  server.listen(env.panelPort, env.panelHost, () => {
    console.log(`داشبورد ادمین روی http://${env.panelHost}:${env.panelPort} در حال اجراست`);
  });
  return server;
}
