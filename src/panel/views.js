import { fa, formatJalali } from '../utils.js';

export const esc = (s = '') =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#1c2230;--muted:#6b7280;--line:#e5e7eb;
--accent:#0f766e;--accent-ink:#fff;--warn:#b45309;--bad:#b91c1c;--good:#15803d;}
@media (prefers-color-scheme:dark){:root{--bg:#11151c;--card:#171d26;--ink:#e7ebf0;
--muted:#9aa4b2;--line:#28303c;--accent:#2dd4bf;--accent-ink:#06231f;}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 Vazirmatn,Tahoma,system-ui,sans-serif}
a{color:var(--accent);text-decoration:none}
header{background:var(--card);border-bottom:1px solid var(--line);padding:12px 16px;
position:sticky;top:0;z-index:5;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
header .brand{font-weight:700;margin-inline-end:auto}
header nav{display:flex;gap:6px;flex-wrap:wrap}
header nav a{padding:6px 12px;border-radius:8px}
header nav a.on{background:var(--accent);color:var(--accent-ink)}
main{max-width:1100px;margin:0 auto;padding:20px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 16px}h2{font-size:16px;margin:0 0 12px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.stat b{display:block;font-size:24px;line-height:1.3}
.stat span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}
.scroll{overflow-x:auto}
th,td{padding:9px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
.tag{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;border:1px solid var(--line)}
.tag.pending{color:var(--warn);border-color:var(--warn)}
.tag.approved{color:var(--good);border-color:var(--good)}
.tag.rejected{color:var(--bad);border-color:var(--bad)}
input,select,textarea{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:9px;
background:var(--bg);color:var(--ink);width:100%}
label{display:block;margin-bottom:12px}
label span{display:block;font-size:13px;color:var(--muted);margin-bottom:5px}
button,.btn{font:inherit;cursor:pointer;padding:9px 16px;border-radius:9px;border:1px solid var(--line);
background:var(--accent);color:var(--accent-ink);font-weight:600}
button.ghost,.btn.ghost{background:transparent;color:var(--ink)}
button.danger{background:transparent;color:var(--bad);border-color:var(--bad);padding:5px 11px;font-size:13px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.row>*{flex:1 1 160px}
.msg{padding:11px 14px;border-radius:9px;margin-bottom:16px;border:1px solid}
.msg.ok{color:var(--good);border-color:var(--good)}
.msg.err{color:var(--bad);border-color:var(--bad)}
.docs{display:flex;gap:12px;flex-wrap:wrap}
.docs a{display:block;border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center}
.docs img{max-width:220px;border-radius:6px;display:block}
.muted{color:var(--muted)}
.login{max-width:340px;margin:12vh auto}
.sub{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:8px}
.stay{border-inline-start:3px solid var(--accent);padding-inline-start:12px;margin:10px 0}
@media(max-width:600px){th,td{padding:8px 6px}}
`;

const NAV = [
  ['/', 'خلاصه'],
  ['/reservations', 'رزروها'],
  ['/cities', 'شهر و اقامتگاه'],
  ['/admins', 'ادمین‌ها'],
  ['/settings', 'تنظیمات ربات'],
];

export function layout({ title, body, active = '', msg = null, bare = false }) {
  const nav = bare ? '' : `<header>
  <div class="brand">🕌 داشبورد بیت‌الحسین</div>
  <nav>${NAV.map(([h, t]) =>
    `<a href="${h}" class="${h === active ? 'on' : ''}">${t}</a>`).join('')}</nav>
  <form method="post" action="/logout" style="margin:0"><button class="ghost">خروج</button></form>
</header>`;
  const flash = msg ? `<div class="msg ${msg.type}">${esc(msg.text)}</div>` : '';
  return `<!doctype html><html lang="fa" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body>
${nav}<main>${flash}${body}</main></body></html>`;
}

export const loginPage = (error, csrf) => layout({
  title: 'ورود به داشبورد', bare: true,
  body: `<div class="login"><div class="card">
    <h1>ورود مدیر</h1>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="post" action="/login">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <label><span>نام کاربری</span><input name="username" autocomplete="username" required autofocus></label>
      <label><span>گذرواژه</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button style="width:100%">ورود</button>
    </form></div></div>`,
});

const statusTag = (s) => {
  const t = { pending: 'در انتظار', approved: 'تاییدشده', rejected: 'رد شده' }[s] || s;
  return `<span class="tag ${esc(s)}">${t}</span>`;
};

export function overviewPage({ stats, cities, today, arrivals }) {
  const tiles = `<div class="grid">
    <div class="stat"><b>${fa(stats.total)}</b><span>کل درخواست‌ها</span></div>
    <div class="stat"><b>${fa(stats.pending)}</b><span>در انتظار تایید</span></div>
    <div class="stat"><b>${fa(stats.approved)}</b><span>تاییدشده</span></div>
    <div class="stat"><b>${fa(stats.guests)}</b><span>مهمان تاییدشده</span></div>
  </div>`;

  const occ = cities.map((c) => `<tr>
    <td>${esc(c.title)}</td>
    <td>${fa(c.occ.men)} / ${fa(c.cap.men)}</td>
    <td>${fa(c.occ.women)} / ${fa(c.cap.women)}</td>
    <td>${fa(c.lodgings)}</td></tr>`).join('');

  const arr = arrivals.length
    ? `<div class="scroll"><table><tr><th>نام</th><th>شهر</th><th>نفرات</th><th>کد رهگیری</th></tr>
       ${arrivals.map((r) => `<tr><td><a href="/reservations/${r.id}">${esc(r.full_name)}</a></td>
       <td>${esc(r.city_title)}</td><td>${fa(r.men + r.women)}</td>
       <td>${esc(r.tracking || '—')}</td></tr>`).join('')}</table></div>`
    : '<p class="muted">امروز ورودی ثبت نشده است.</p>';

  return layout({ title: 'خلاصه', active: '/', body: `
    <h1>خلاصه وضعیت — ${formatJalali(today)}</h1>
    ${tiles}
    <div class="card"><h2>اشغال امشب</h2><div class="scroll"><table>
      <tr><th>شهر</th><th>آقا</th><th>خانم</th><th>اقامتگاه فعال</th></tr>${occ}</table></div></div>
    <div class="card"><h2>ورود امروز</h2>${arr}</div>` });
}

export function reservationsPage({ rows, cities, q }) {
  const opts = (sel) => cities.map((c) =>
    `<option value="${esc(c.key)}"${c.key === sel ? ' selected' : ''}>${esc(c.title)}</option>`).join('');
  const statusOpts = ['', 'pending', 'approved', 'rejected'].map((s) =>
    `<option value="${s}"${s === q.status ? ' selected' : ''}>${
      s ? { pending: 'در انتظار', approved: 'تاییدشده', rejected: 'رد شده' }[s] : 'همه'}</option>`).join('');

  const body = rows.length ? rows.map((r) => `<tr>
    <td><a href="/reservations/${r.id}">#${fa(r.id)}</a></td>
    <td>${esc(r.full_name)}</td>
    <td>${esc(r.city_title)}</td>
    <td>${fa(r.men)}آ/${fa(r.women)}خ</td>
    <td>${formatJalali(r.start_date)}</td>
    <td>${fa(r.nights)}</td>
    <td>${statusTag(r.status)}</td>
    <td>${esc(r.stay_short || '—')}</td>
    <td>${r.doc_count ? '🪪 ' + fa(r.doc_count) : '—'}</td>
    <td>${r.checked_in_at ? '🚪' : '—'}</td></tr>`).join('')
    : '<tr><td colspan="10" class="muted">موردی یافت نشد.</td></tr>';

  return layout({ title: 'رزروها', active: '/reservations', body: `
    <h1>رزروها</h1>
    <div class="card"><form method="get" class="row">
      <label><span>شهر</span><select name="city"><option value="">همه</option>${opts(q.city)}</select></label>
      <label><span>وضعیت</span><select name="status">${statusOpts}</select></label>
      <label><span>جستجو (نام، کد ملی، کد رهگیری)</span><input name="q" value="${esc(q.q || '')}"></label>
      <label><span>&nbsp;</span><button>اعمال</button></label>
      <label><span>&nbsp;</span><a class="btn ghost" href="/export.csv">📥 خروجی CSV</a></label>
    </form></div>
    <div class="card"><div class="scroll"><table>
      <tr><th>#</th><th>نام</th><th>شهر</th><th>نفرات</th><th>ورود</th><th>شب</th>
          <th>وضعیت</th><th>اسکان</th><th>مدرک</th><th>ثبت ورود</th></tr>
      ${body}</table></div></div>` });
}

export function reservationPage({ r, docs, csrf, lodgings = [] }) {
  const rows = [
    ['شهر', esc(r.city_title)],
    ['نام و نام خانوادگی', esc(r.full_name)],
    ['کد ملی', fa(r.national_id)],
    ['تلفن', esc(r.phone || '—')],
    ['نفرات', `${fa(r.men)} آقا / ${fa(r.women)} خانم`],
    ['تاریخ ورود', formatJalali(r.start_date)],
    ['مدت', `${fa(r.nights)} شب`],
    ['وضعیت', statusTag(r.status)],
    ['کد رهگیری', r.tracking ? `<code>${esc(r.tracking)}</code>` : '—'],
    ['ثبت ورود', r.checked_in_at ? formatJalali(r.checked_in_at.slice(0, 10)) : '—'],
    ['محل اسکان', r.stay || '—'],
    ['توضیحات اسکان', esc(r.stay_note || '—')],
    ['کاربر تلگرام', r.username ? '@' + esc(r.username) : String(r.tg_id)],
    ['ثبت درخواست', formatJalali(r.created_at.slice(0, 10))],
  ].map(([k, v]) => `<tr><th style="width:180px">${k}</th><td>${v}</td></tr>`).join('');

  const docHtml = docs.length
    ? `<div class="docs">${docs.map((d) => (d.mime || '').includes('pdf')
      ? `<a href="/doc/${d.id}" target="_blank">📄 مدرک PDF #${fa(d.id)}</a>`
      : `<a href="/doc/${d.id}" target="_blank"><img src="/doc/${d.id}" alt="مدرک شناسایی" loading="lazy"></a>`
    ).join('')}</div>`
    : '<p class="muted">مدرکی ارسال نشده است.</p>';

  const pick = (nameAttr, label, count) => count > 0 ? `
    <label><span>${label} (${fa(count)} نفر)</span><select name="${nameAttr}">
      <option value="">— انتخاب نشده —</option>
      ${lodgings.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}
    </select></label>` : '';

  const actions = r.status === 'pending'
    ? `<form method="post" action="/reservations/${r.id}/decide" style="margin-top:16px">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <h2>تعیین محل اسکان</h2>
        ${lodgings.length ? `<div class="row">
          ${pick('lodging_men_id', '🏠 اسکان آقایان', r.men)}
          ${pick('lodging_women_id', '🏠 اسکان خانم‌ها', r.women)}
        </div>
        <label><span>توضیحات اسکان (در بلیت مهمان نمایش داده می‌شود)</span>
          <input name="stay_note" placeholder="مثلاً ساعت تحویل اتاق ۱۴، تماس مسئول ۰۹۱۲..."></label>`
        : '<p class="msg err">برای این شهر اقامتگاه فعالی ثبت نشده — ابتدا در «شهر و اقامتگاه» اضافه کنید.</p>'}
        <div class="row">
          <label style="flex:0 0 auto"><button name="action" value="approve">✅ تایید و ارسال بلیت</button></label>
          <label style="flex:0 0 auto"><button name="action" value="reject" class="danger">❌ رد درخواست</button></label>
        </div>
      </form>` : '';

  return layout({ title: `رزرو #${r.id}`, active: '/reservations', body: `
    <h1>رزرو #${fa(r.id)}</h1>
    <div class="card"><div class="scroll"><table>${rows}</table></div>${actions}</div>
    <div class="card"><h2>🪪 مدارک شناسایی</h2>${docHtml}</div>
    <div class="card"><h2>حذف رزرو</h2>
      <p class="muted">حذف رزرو برگشت‌ناپذیر است و مدارک شناسایی آن هم پاک می‌شود.</p>
      <form method="post" action="/reservations/${r.id}/delete"
        onsubmit="return confirm('رزرو #${r.id} برای همیشه حذف شود؟')">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <button class="danger">حذف این رزرو</button></form></div>
    <p><a href="/reservations">« بازگشت به فهرست</a></p>` });
}

export function citiesPage({ cities, csrf }) {
  const blocks = cities.map((c) => {
    const lodgings = c.lodgings.map((l) => `
      <form method="post" action="/lodgings/${l.id}/update" class="sub">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <div class="row">
          <label><span>نام اقامتگاه</span><input name="name" value="${esc(l.name)}" required></label>
          <label><span>ظرفیت آقا</span><input name="cap_men" type="number" min="0" value="${l.cap_men}" required></label>
          <label><span>ظرفیت خانم</span><input name="cap_women" type="number" min="0" value="${l.cap_women}" required></label>
          <label><span>وضعیت</span><select name="active">
            <option value="1"${l.active ? ' selected' : ''}>فعال</option>
            <option value="0"${l.active ? '' : ' selected'}>غیرفعال</option></select></label>
        </div>
        <div class="row">
          <label style="flex:2 1 260px"><span>آدرس (در بلیت مهمان نمایش داده می‌شود)</span>
            <input name="address" value="${esc(l.address || '')}" placeholder="مثلاً کربلا، خیابان الحسین، کوچه ۳"></label>
          <label><span>عرض جغرافیایی (lat)</span>
            <input name="lat" value="${l.lat ?? ''}" placeholder="32.6160"></label>
          <label><span>طول جغرافیایی (lon)</span>
            <input name="lon" value="${l.lon ?? ''}" placeholder="44.0249"></label>
        </div>
        <label><span>توضیحات ثابت این اقامتگاه (اختیاری)</span>
          <input name="note" value="${esc(l.note || '')}" placeholder="مثلاً ورودی از درب شمالی، طبقه دوم"></label>
        <div class="row">
          <label style="flex:0 0 auto"><button>ذخیره تغییرات</button></label>
          <label style="flex:0 0 auto"></label>
        </div>
      </form>
      <form method="post" action="/lodgings/${l.id}/delete" style="margin:-6px 0 18px"
        onsubmit="return confirm('حذف اقامتگاه «${esc(l.name)}»؟')">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <button class="danger">حذف این اقامتگاه</button></form>`).join('')
      || '<p class="muted">اقامتگاهی ثبت نشده — ظرفیت این شهر صفر است.</p>';

    return `<div class="card">
      <h2>${esc(c.title)} <span class="muted">(${esc(c.key)})</span>
        ${c.active ? '' : '<span class="tag">غیرفعال</span>'}</h2>
      <form method="post" action="/cities/${c.id}/update" class="row">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <label><span>نام نمایشی</span><input name="title" value="${esc(c.title)}" required></label>
        <label><span>وضعیت</span><select name="active">
          <option value="1"${c.active ? ' selected' : ''}>فعال</option>
          <option value="0"${c.active ? '' : ' selected'}>غیرفعال</option></select></label>
        <label><span>ترتیب</span><input name="sort" type="number" value="${c.sort}"></label>
        <label><span>گروه ادمین (اختیاری)</span><input name="chat" value="${esc(c.chat)}"
          placeholder="مثلاً -1001234567890"></label>
        <label><span>&nbsp;</span><button>ذخیره</button></label>
      </form>
      <h3 style="font-size:14px;color:var(--muted);margin:18px 0 10px">اقامتگاه‌ها</h3>
      ${lodgings}
      <form method="post" action="/lodgings/add" class="row" style="margin-top:12px">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <input type="hidden" name="city_id" value="${c.id}">
        <label><span>افزودن اقامتگاه</span><input name="name" placeholder="نام اقامتگاه" required></label>
        <label><span>ظرفیت آقا</span><input name="cap_men" type="number" min="0" value="0" required></label>
        <label><span>ظرفیت خانم</span><input name="cap_women" type="number" min="0" value="0" required></label>
        <label><span>&nbsp;</span><button>افزودن</button></label>
      </form>
      ${c.reservations ? `<p class="muted">${fa(c.reservations)} رزرو در این شهر ثبت شده است.</p>`
        : `<form method="post" action="/cities/${c.id}/delete" style="margin-top:10px"
             onsubmit="return confirm('حذف شهر «${esc(c.title)}»؟')">
             <input type="hidden" name="_csrf" value="${esc(csrf)}">
             <button class="danger">حذف این شهر</button></form>`}
    </div>`;
  }).join('');

  return layout({ title: 'شهر و اقامتگاه', active: '/cities', body: `
    <h1>شهرها و اقامتگاه‌ها</h1>
    <div class="card"><h2>افزودن شهر</h2>
      <form method="post" action="/cities/add" class="row">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <label><span>شناسه انگلیسی</span><input name="key" pattern="[a-z0-9_-]{2,20}"
          placeholder="مثلاً kadhimiya" required></label>
        <label><span>نام فارسی</span><input name="title" placeholder="مثلاً کاظمین" required></label>
        <label><span>&nbsp;</span><button>افزودن شهر</button></label>
      </form>
      <p class="muted">شناسه انگلیسی بعداً قابل تغییر نیست چون رزروها به آن وصل می‌شوند.</p>
    </div>
    ${blocks}` });
}

export function adminsPage({ admins, cities, csrf }) {
  const rows = admins.map((a) => `<tr>
    <td><code>${esc(a.tg_id)}</code></td>
    <td>${esc(a.name || '—')}</td>
    <td>${a.role === 'super' ? 'ادمین کل' : 'ادمین ' + esc(a.city_title || '—')}</td>
    <td><form method="post" action="/admins/${a.id}/delete" style="margin:0"
      onsubmit="return confirm('حذف این ادمین؟')">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <button class="danger">حذف</button></form></td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">ادمینی ثبت نشده.</td></tr>';

  return layout({ title: 'ادمین‌ها', active: '/admins', body: `
    <h1>ادمین‌ها</h1>
    <div class="card"><h2>افزودن ادمین</h2>
      <form method="post" action="/admins/add" class="row">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <label><span>آی‌دی عددی تلگرام</span><input name="tg_id" inputmode="numeric"
          pattern="[0-9]{3,15}" placeholder="از @userinfobot" required></label>
        <label><span>نام (اختیاری)</span><input name="name"></label>
        <label><span>نقش</span><select name="role" id="role">
          <option value="super">ادمین کل — تایید همه شهرها و گزارش</option>
          <option value="city">ادمین یک شهر</option></select></label>
        <label><span>شهر (برای ادمین شهر)</span><select name="city_id">
          ${cities.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}
        </select></label>
        <label><span>&nbsp;</span><button>افزودن</button></label>
      </form>
      <p class="muted">پس از افزودن یا حذف ادمین، ربات را ری‌استارت کنید تا منوی دستورهای او به‌روز شود.</p>
    </div>
    <div class="card"><div class="scroll"><table>
      <tr><th>آی‌دی</th><th>نام</th><th>نقش</th><th></th></tr>${rows}</table></div></div>` });
}

export function settingsPage({ s, csrf }) {
  const docOpts = [['off', 'غیرفعال — مدرک پرسیده نشود'],
    ['optional', 'اختیاری — کاربر می‌تواند رد کند'],
    ['required', 'الزامی — بدون مدرک رزرو ثبت نشود']]
    .map(([v, t]) => `<option value="${v}"${s.REQUIRE_DOCUMENT === v ? ' selected' : ''}>${t}</option>`).join('');

  return layout({ title: 'تنظیمات ربات', active: '/settings', body: `
    <h1>تنظیمات ربات</h1>
    <div class="card"><form method="post" action="/settings">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <div class="row">
        <label><span>حداکثر شب اقامت</span>
          <input name="MAX_NIGHTS" type="number" min="1" max="60" value="${esc(s.MAX_NIGHTS)}" required></label>
        <label><span>حداکثر روز رزرو جلوتر</span>
          <input name="MAX_DAYS_AHEAD" type="number" min="1" max="730" value="${esc(s.MAX_DAYS_AHEAD)}" required></label>
        <label><span>حداکثر نفرات هر رزرو</span>
          <input name="MAX_PER_BOOKING" type="number" min="1" max="100" value="${esc(s.MAX_PER_BOOKING)}" required></label>
      </div>
      <label><span>مدرک شناسایی (پاسپورت / کارت ملی)</span>
        <select name="REQUIRE_DOCUMENT">${docOpts}</select></label>
      <label><span>پیام اضافه در خوش‌آمدگویی (اختیاری)</span>
        <textarea name="WELCOME_EXTRA" rows="3">${esc(s.WELCOME_EXTRA || '')}</textarea></label>
      <button>ذخیره تنظیمات</button>
    </form>
    <p class="muted">تغییرات بلافاصله اثر می‌کند و نیازی به ری‌استارت ربات نیست.
    ظرفیت اقامتگاه‌ها در بخش «شهر و اقامتگاه» تنظیم می‌شود.</p></div>` });
}
