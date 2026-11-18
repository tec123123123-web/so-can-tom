/* Sổ Cân Tôm — ứng dụng (giao diện + lưu trữ). Chạy offline, dữ liệu nằm trong máy. */
(function () {
'use strict';
const C = window.Calc;
const APP_VERSION = '1.0.1';

/* ================= Tiện ích ================= */
const $ = (sel, el) => (el || document).querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const ddmm = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
const nowStr = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + C.fmtDate(todayISO()); };
const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);

const IC = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  receipt: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  bs: '<svg viewBox="0 0 24 24"><path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-6 6M11 9l6 6"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>'
};

/* ================= Lưu trữ (IndexedDB, dự phòng localStorage) ================= */
const DB = {
  db: null, mode: 'idb',
  open() {
    return new Promise((res) => {
      try {
        const rq = indexedDB.open('so-can-tom', 1);
        rq.onupgradeneeded = () => {
          const d = rq.result;
          if (!d.objectStoreNames.contains('sheets')) d.createObjectStore('sheets', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        };
        rq.onsuccess = () => { this.db = rq.result; res(); };
        rq.onerror = () => { this.mode = 'ls'; res(); };
      } catch (e) { this.mode = 'ls'; res(); }
    });
  },
  tx(store, mode) { return this.db.transaction(store, mode).objectStore(store); },
  allSheets() {
    if (this.mode === 'ls') { try { return Promise.resolve(JSON.parse(localStorage.getItem('sct_sheets') || '[]')); } catch (e) { return Promise.resolve([]); } }
    return new Promise((res) => { const r = this.tx('sheets', 'readonly').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
  },
  putSheet(s) {
    if (this.mode === 'ls') { try { localStorage.setItem('sct_sheets', JSON.stringify(S.sheets)); } catch (e) {} return Promise.resolve(); }
    return new Promise((res) => { const r = this.tx('sheets', 'readwrite').put(JSON.parse(JSON.stringify(s))); r.onsuccess = res; r.onerror = () => { toast('Không lưu được! Bộ nhớ máy có thể đã đầy.'); res(); }; });
  },
  delSheet(id) {
    if (this.mode === 'ls') { try { localStorage.setItem('sct_sheets', JSON.stringify(S.sheets)); } catch (e) {} return Promise.resolve(); }
    return new Promise((res) => { const r = this.tx('sheets', 'readwrite').delete(id); r.onsuccess = res; r.onerror = res; });
  },
  getMeta() {
    if (this.mode === 'ls') { try { return Promise.resolve(JSON.parse(localStorage.getItem('sct_meta') || 'null')); } catch (e) { return Promise.resolve(null); } }
    return new Promise((res) => { const r = this.tx('meta', 'readonly').get('meta'); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
  },
  putMeta(m) {
    if (this.mode === 'ls') { try { localStorage.setItem('sct_meta', JSON.stringify(m)); } catch (e) {} return Promise.resolve(); }
    return new Promise((res) => { const r = this.tx('meta', 'readwrite').put(JSON.parse(JSON.stringify(m)), 'meta'); r.onsuccess = res; r.onerror = res; });
  }
};

/* ================= Trạng thái ================= */
const DEFAULT_META = {
  farm: '', ponds: [], buyers: [], bank: { bin: '', acc: '', owner: '' },
  defaults: { mode: 'quick', decimals: 1, maxKg: 100, perCol: 10, tare: 0 },
  speak: false, wake: true, bigText: false, lastBackup: null, askedPersist: false
};
const S = { meta: null, sheets: [], view: 'home', cur: null, filter: 'all', search: '' };
const W = { input: '', prompt: null, hint: null, hide: false };

function curSheet() { return S.sheets.find(s => s.id === S.cur); }
function saveMeta() { return DB.putMeta(S.meta); }
function saveSheet(s) { s.updatedAt = Date.now(); return DB.putSheet(s); }
function logAct(s, a, d) { (s.log = s.log || []).push(Object.assign({ ts: Date.now(), a }, d || {})); }
function dispName(s) {
  if (s.name) return s.name;
  const base = s.kind === 'ban' ? 'Bảng cân' : 'Sang tôm';
  return base + (s.pond ? ' ' + s.pond : '') + ' · ' + ddmm(s.date);
}
function dec(s) { return (s.entry && s.entry.decimals) || 1; }

function newSheet(kind) {
  const d = S.meta.defaults;
  return {
    id: uid(), kind, name: '', date: todayISO(), pond: '', toPond: '', buyerName: '', buyerPhone: '',
    size: '', price: null, tare: kind === 'ban' ? (d.tare || 0) : 0, deductPct: 0, deposit: 0, payments: [],
    entry: { mode: d.mode, decimals: d.decimals, maxKg: d.maxKg }, perCol: d.perCol || 10,
    baskets: [], log: [], locked: false, note: '', createdAt: Date.now(), updatedAt: Date.now()
  };
}

/* ================= Hộp thoại, thông báo ================= */
let toastTimer = null;
function toast(msg, actLabel, actFn, ms) {
  let t = $('#toast'); if (t) t.remove();
  t = document.createElement('div'); t.id = 'toast';
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (actLabel ? '<button>' + esc(actLabel) + '</button>' : '');
  document.body.appendChild(t);
  if (actLabel) t.querySelector('button').onclick = () => { t.remove(); actFn && actFn(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), ms || (actLabel ? 5000 : 2200));
}
function overlay(html, center) {
  const o = document.createElement('div'); o.className = 'overlay' + (center ? ' center' : '');
  o.innerHTML = html; document.body.appendChild(o); return o;
}
function dlg(opts) {
  // opts: {title, text, html, input:{value, mode, placeholder}, actions:[{label, val, cls}]}
  return new Promise((res) => {
    const acts = opts.actions || [{ label: 'Đóng', val: null, cls: 'gray' }];
    const o = overlay('<div class="dlg"><h3>' + esc(opts.title || '') + '</h3>' + (opts.text ? '<p>' + esc(opts.text) + '</p>' : '') + (opts.html || '') +
      (opts.input ? '<input id="dlgIn" inputmode="' + (opts.input.mode || 'text') + '" value="' + esc(opts.input.value || '') + '" placeholder="' + esc(opts.input.placeholder || '') + '">' : '') +
      '<div class="acts">' + acts.map((a, i) => '<button class="btn ' + (a.cls || '') + '" data-i="' + i + '">' + esc(a.label) + '</button>').join('') + '</div></div>', true);
    const inp = $('#dlgIn', o);
    if (inp) { setTimeout(() => { inp.focus(); inp.select(); }, 60); }
    const done = (v) => { o.remove(); res(v); };
    o.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) { const a = acts[+b.dataset.i]; done(a.val === '__input' ? (inp ? inp.value : '') : a.val); }
      else if (e.target === o && !opts.modal) done(null);
    });
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = acts.find(x => x.val === '__input'); if (a) done(inp.value); } });
  });
}
const confirmDlg = (title, text, okLabel, danger) => dlg({ title, text, actions: [{ label: 'Hủy', val: false, cls: 'gray' }, { label: okLabel || 'Đồng ý', val: true, cls: danger ? 'red' : '' }] });

/* ================= Loa & màn hình ================= */
function speak(txt) {
  if (!S.meta.speak || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(txt); u.lang = 'vi-VN'; u.rate = 1.1; speechSynthesis.speak(u); } catch (e) {}
}
let wakeLock = null;
async function setWake(on) {
  try {
    if (on && S.meta.wake && 'wakeLock' in navigator) { if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.view === 'weigh') setWake(true); });

/* ================= Điều hướng ================= */
function go(view, id) {
  S.view = view; if (id !== undefined) S.cur = id;
  W.input = ''; W.prompt = null; W.hint = null;
  const tt = $('#toast'); if (tt) tt.remove();
  setWake(view === 'weigh');
  render();
}
function render() {
  document.body.classList.toggle('big', !!S.meta.bigText);
  const app = $('#app');
  if (S.view === 'weigh' && curSheet()) app.innerHTML = '<div class="view" id="weigh"></div>', renderWeigh();
  else if (S.view === 'settings') app.innerHTML = '<div class="view" id="settings"></div>', renderSettings();
  else { S.view = 'home'; app.innerHTML = '<div class="view" id="home"></div>'; renderHome(); }
}
function tabbar(active) {
  return '<nav class="tabbar">' +
    '<button class="tab ' + (active === 'home' ? 'on' : '') + '" data-go="home">' + IC.doc + 'Bảng cân</button>' +
    '<button class="fab" id="fab" aria-label="Tạo bảng mới">' + IC.plus + '</button>' +
    '<button class="tab ' + (active === 'settings' ? 'on' : '') + '" data-go="settings">' + IC.gear + 'Cài đặt</button></nav>';
}
function bindTabbar(root) {
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  $('#fab', root).onclick = chooseNew;
}
async function chooseNew() {
  const v = await dlg({ title: 'Tạo bảng mới', text: 'Chọn loại bảng:', actions: [
    { label: 'Hủy', val: null, cls: 'gray' }, { label: 'Sang tôm', val: 'sang', cls: 'sec' }, { label: 'Cân bán tôm', val: 'ban' }] });
  if (!v) return;
  const s = newSheet(v);
  S.sheets.push(s); await saveSheet(s);
  go('weigh', s.id);
  openSheetSettings(s, true);
}

/* ================= Màn hình: Danh sách bảng ================= */
function renderHome() {
  const root = $('#home');
  const all = S.sheets.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  const q = S.search.trim().toLowerCase();
  const list = all.filter(s => (S.filter === 'all' || s.kind === S.filter) &&
    (!q || [dispName(s), s.pond, s.toPond, s.buyerName, s.size].join(' ').toLowerCase().includes(q)));
  const today = todayISO();
  let tb = 0, ts = 0, tr = 0;
  S.sheets.filter(s => s.date === today).forEach(s => { const t = C.totals(s); tr += t.count; if (s.kind === 'ban') tb += t.grossC; else ts += t.grossC; });
  const needBackup = S.sheets.some(s => s.baskets.length) && (!S.meta.lastBackup || Date.now() - S.meta.lastBackup > 7 * 864e5);

  let h = '<header class="top"><span class="ibtn ghost"></span><h1>Sổ Cân Tôm' + (S.meta.farm ? '<small>' + esc(S.meta.farm) + '</small>' : '') + '</h1><span class="ibtn ghost"></span></header>';
  h += '<div class="scroll"><div class="wrap">';
  if (!S.sheets.length) {
    h += '<div class="card empty"><img class="logo" src="icon-192.png" alt=""><h2>Chưa có bảng cân nào</h2>' +
      '<p>Mỗi rổ lên cân bấm một lần, app tự cộng ký, tự tính tiền.</p><p>Sổ lưu ngay trong máy — không cần mạng.</p>' +
      '<div class="row" style="margin-top:16px"><button class="btn" data-new="ban">Cân bán tôm</button><button class="btn sec" data-new="sang">Sang tôm</button></div></div>';
    if (!isStandalone()) h += installCard();
  } else {
    h += '<div class="daysum"><div class="card"><b>' + C.fmtKgC(tb) + '</b><span>kg bán hôm nay</span></div><div class="card"><b>' + C.fmtKgC(ts) + '</b><span>kg sang hôm nay</span></div><div class="card"><b>' + tr + '</b><span>rổ hôm nay</span></div></div>';
    if (needBackup) h += '<div class="hint warn" style="margin:0 0 12px"><span class="tx">Đã lâu chưa sao lưu sổ. Mất máy là mất số.</span><button class="btn" id="qBackup">Sao lưu</button></div>';
    h += '<div class="seg">' + [['all', 'Tất cả'], ['ban', 'Cân bán'], ['sang', 'Sang tôm']].map(([k, l]) => '<button data-f="' + k + '" class="' + (S.filter === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    if (S.sheets.length > 5) h += '<input class="search" id="search" placeholder="Tìm theo ao, thương lái, tên bảng…" value="' + esc(S.search) + '">';
    if (!list.length) h += '<p class="note" style="text-align:center">Không có bảng nào khớp.</p>';
    list.forEach(s => {
      const t = C.totals(s);
      let money = '';
      if (s.kind === 'ban') {
        if (!t.priced) money = '<span class="badge warn">Chưa chốt giá</span>';
        else if (t.remain > 0 && t.paid > 0) money = '<span class="money">Còn nợ ' + C.fmtMoney(t.remain) + 'đ</span>';
        else money = '<span class="money">' + C.fmtMoney(t.money) + 'đ</span>';
      }
      const sub = s.kind === 'ban'
        ? [C.fmtDate(s.date), s.pond && 'Ao ' + s.pond, s.buyerName, s.size && 'Cỡ ' + s.size].filter(Boolean).join(' · ')
        : [C.fmtDate(s.date), (s.pond || '?') + ' → ' + (s.toPond || '?'), s.size && 'Cỡ ' + s.size].filter(Boolean).join(' · ');
      h += '<button class="card sheetcard" data-open="' + s.id + '"><div class="r1"><span class="nm">' + esc(dispName(s)) + '</span>' +
        (s.locked ? '<span class="badge lock">Đã kết sổ</span>' : '') +
        '<span class="badge ' + (s.kind === 'sang' ? 'sang' : '') + '">' + (s.kind === 'ban' ? 'Bán' : 'Sang') + '</span></div>' +
        '<div class="r2">' + esc(sub) + '</div>' +
        '<div class="r3"><span class="kg">' + C.fmtKgC(t.grossC, dec(s)) + ' <small>kg · ' + t.count + ' rổ</small></span>' + money + '</div></button>';
    });
  }
  h += '</div></div>' + tabbar('home');
  root.innerHTML = h;
  bindTabbar(root);
  root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => go('weigh', b.dataset.open));
  root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.filter = b.dataset.f; renderHome(); });
  root.querySelectorAll('[data-new]').forEach(b => b.onclick = async () => { const s = newSheet(b.dataset.new); S.sheets.push(s); await saveSheet(s); go('weigh', s.id); openSheetSettings(s, true); });
  const se = $('#search', root); if (se) se.oninput = () => { S.search = se.value; const pos = se.selectionStart; renderHome(); const n = $('#search'); n.focus(); n.setSelectionRange(pos, pos); };
  const qb = $('#qBackup', root); if (qb) qb.onclick = exportBackup;
}
function installCard() {
  return '<div class="card"><b>Cài Sổ Cân Tôm lên màn hình chính</b><p class="note" style="padding:6px 0 0">Trên iPhone/iPad: mở trang này bằng <b>Safari</b> → bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên lên) → chọn <b>Thêm vào MH chính</b>. Sau đó mở app từ biểu tượng — chạy cả khi không có mạng.</p></div>';
}

/* ================= Màn hình: Cân ================= */
function renderWeigh() {
  const s = curSheet(); const root = $('#weigh');
  root.innerHTML =
    '<header class="top"><button class="ibtn" id="wBack" aria-label="Quay lại">' + IC.back + '</button>' +
    '<h1 id="wTitle"></h1>' +
    '<button class="ibtn" id="wRcpt" aria-label="Phiếu cân">' + IC.receipt + '</button>' +
    '<button class="ibtn" id="wSet" aria-label="Cài đặt bảng">' + IC.gear + '</button></header>' +
    '<div class="stat" id="wStat"></div>' +
    '<div class="wmain"><div class="wleft"><div class="gridwrap" id="gw"><div class="grid" id="grid"></div></div><div id="wMsg"></div></div><div id="wPad"></div></div>';
  $('#wBack').onclick = () => go('home');
  $('#wRcpt').onclick = () => openReceipt(s);
  $('#wSet').onclick = () => openSheetSettings(s, false);
  $('#grid').onclick = (e) => { const c = e.target.closest('[data-b]'); if (c) basketMenu(s, c.dataset.b); };
  updWeigh(true);
}
function updWeigh(scrollEnd) {
  const s = curSheet(); if (!s || S.view !== 'weigh') return;
  const t = C.totals(s), d = dec(s);
  const sub = s.kind === 'ban'
    ? (t.priced ? C.fmtMoney(s.price) + 'đ/kg' : 'Chưa chốt giá') + (s.buyerName ? ' · ' + s.buyerName : '') + (s.name ? ' · ' + ddmm(s.date) : '')
    : 'Sang ' + (s.pond || '?') + ' → ' + (s.toPond || '?') + (s.name ? ' · ' + ddmm(s.date) : '');
  $('#wTitle').innerHTML = esc(dispName(s)) + '<small>' + esc(sub) + '</small>';
  let st = '<span class="tk">' + C.fmtKgC(t.grossC, d) + '</span><span class="u">kg</span><span>· ' + t.count + ' rổ</span><span class="pc">' + (s.perCol || 10) + '/cột</span>';
  if (s.kind === 'ban') st += t.priced ? '<span class="pr">= ' + C.fmtMoney(t.money) + 'đ</span>' : '<span class="np">· chưa chốt giá</span>';
  $('#wStat').innerHTML = st;
  updGrid(scrollEnd); updMsg(); updPad();
}
function updGrid(scrollEnd) {
  const s = curSheet(), d = dec(s), per = s.perCol || 10;
  const cols = C.columns(s);
  const act = C.activeBaskets(s);
  const lastId = act.length ? act[act.length - 1].id : null;
  const showCur = !s.locked;
  // Cột cần hiển thị: các cột có rổ + cột chứa ô đang nhập
  const nextIdx = act.length; // vị trí rổ kế tiếp
  const nCols = Math.max(cols.length, showCur ? Math.floor(nextIdx / per) + 1 : 1, 1);
  let cum = 0, h = '';
  for (let ci = 0; ci < nCols; ci++) {
    const col = cols[ci] || { items: [], totalC: 0 };
    cum += col.totalC;
    h += '<div class="col"><div class="ch">' + String(ci + 1).padStart(2, '0') + '</div><div class="cells">';
    for (let r = 0; r < per; r++) {
      const idx = ci * per + r; const b = col.items[r];
      const sep = (per === 10 && r === 4) ? ' sep' : '';
      if (b) h += '<div class="cell' + sep + (b.id === lastId && !W.input ? ' last' : '') + (b.ed ? ' edited' : '') + '" data-b="' + b.id + '">' + C.fmtKgC(b.c, d) + '</div>';
      else if (showCur && idx === nextIdx) h += '<div class="cell cur' + sep + (W.prompt ? ' warn' : '') + (W.input ? '' : ' blink') + '" id="curCell">' + esc(W.input) + '</div>';
      else h += '<div class="cell e' + sep + '"></div>';
    }
    h += '</div><div class="ct">' + (col.items.length ? C.fmtKgC(col.totalC, d) : '·') + '</div>' +
      (ci > 0 && col.items.length ? '<div class="cum">Σ <b>' + C.fmtKgC(cum, d) + '</b></div>' : '') + '</div>';
  }
  $('#grid').innerHTML = h;
  if (scrollEnd) { const gw = $('#gw'); requestAnimationFrame(() => { gw.scrollLeft = gw.scrollWidth; const cc = $('#curCell'); if (cc) cc.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }); }
}
function updMsg() {
  const s = curSheet(), d = dec(s), el = $('#wMsg'); let h = '';
  if (W.prompt) {
    const p = W.prompt;
    const typ = C.fmtKgC(p.an.typical, d);
    h = '<div class="prompt"><b>⚠ ' + C.fmtKgC(p.c, d) + ' kg? Rổ thường ~' + typ + ' kg</b>' +
      (p.an.suggest ? '<p>Có phải anh định gõ ' + C.fmtKgC(p.an.suggest, d) + '?</p><div class="row"><button class="btn" id="pA">Ghi ' + C.fmtKgC(p.an.suggest, d) + ' kg</button><button class="btn gray" id="pB">Vẫn ghi ' + C.fmtKgC(p.c, d) + '</button></div>'
        : '<p>Số này lớn bất thường. Kiểm tra lại số trên cân.</p><div class="row"><button class="btn gray" id="pC">Gõ lại</button><button class="btn" id="pB">Vẫn ghi ' + C.fmtKgC(p.c, d) + '</button></div>') + '</div>';
  } else if (W.hint) {
    h = '<div class="hint warn"><span class="tx">Đã ghi ' + C.fmtKgC(W.hint.c, d) + ' kg · rổ cuối lưới?</span><button class="btn" id="hFix">Sửa thành ' + C.fmtKgC(W.hint.suggest, d) + '</button></div>';
  } else if (!s.locked && !s.baskets.length && !W.input) {
    h = '<div class="hint info"><span class="tx">' + (s.entry.mode === 'quick'
      ? 'Nhập nhanh: cân hiện 21,8 kg → bấm <b>218</b>, rổ tự ghi. Cân hiện 2,1 kg → bấm <b>021</b>, hoặc <b>21</b> rồi Ghi.'
      : 'Rổ đầu tiên: gõ đúng số trên cân, ví dụ <b>21,8</b>, rồi bấm <b>Ghi</b>.') + '</span></div>';
  }
  el.innerHTML = h;
  const pA = $('#pA'), pB = $('#pB'), pC = $('#pC'), hf = $('#hFix');
  if (pA) pA.onclick = () => { const v = W.prompt.an.suggest; W.prompt = null; addBasket(v); };
  if (pB) pB.onclick = () => { const v = W.prompt.c; W.prompt = null; addBasket(v); };
  if (pC) pC.onclick = () => { W.prompt = null; W.input = ''; updWeigh(); };
  if (hf) hf.onclick = () => {
    const b = s.baskets.find(x => x.id === W.hint.id);
    if (b) { logAct(s, 'edit', { id: b.id, from: b.c, to: W.hint.suggest }); b.c = W.hint.suggest; b.ed = true; saveSheet(s); speak(C.fmtKgC(b.c, d)); }
    W.hint = null; updWeigh();
  };
}
function updPad() {
  const s = curSheet(), el = $('#wPad');
  if (s.locked) {
    el.className = 'lockbar';
    el.innerHTML = '<span class="tx">Bảng đã kết sổ, không ghi thêm rổ.</span><button class="btn sec" id="unlock">Mở lại</button><button class="btn" id="lkR">Phiếu</button>';
    $('#unlock').onclick = async () => { if (await confirmDlg('Mở lại bảng?', 'Mở lại để ghi thêm hoặc sửa rổ. Lần mở sẽ được ghi vào lịch sử.', 'Mở lại')) { s.locked = false; logAct(s, 'unlock'); await saveSheet(s); updWeigh(); } };
    $('#lkR').onclick = () => openReceipt(s);
    return;
  }
  if (W.hide) {
    el.className = 'padmini';
    el.innerHTML = '<button class="btn sec" id="showPad">' + IC.down.replace('M6 9l6 6 6-6', 'M6 15l6-6 6 6') + ' Hiện bàn phím</button>';
    $('#showPad').onclick = () => { W.hide = false; updPad(); };
    return;
  }
  el.className = 'pad';
  const quick = s.entry.mode === 'quick', d = dec(s);
  const parsed = quick ? C.parseQuick(W.input, d, s.entry.maxKg) : C.parseDirect(W.input, d);
  const blocked = !!W.prompt;
  const goLbl = parsed ? 'Ghi<small>' + C.fmtKgC(parsed.c, d) + ' kg</small>' : (quick ? 'Tự ghi' : 'Ghi');
  const k = (n) => '<button class="k" data-k="' + n + '"' + (blocked ? ' disabled' : '') + '>' + n + '</button>';
  const modeLbl = quick ? (s.entry.maxKg >= 1000 ? '2185 → 218,5' : s.entry.maxKg >= 100 ? (d === 2 ? '2185 → 21,85' : '218 → 21,8') : (d === 2 ? '218 → 2,18' : '21 → 2,1')) : '21,8 rồi Ghi';
  el.innerHTML = '<div class="keys">' +
    k(1) + k(2) + k(3) + '<button class="k fn ' + (s.baskets.length || W.input ? 'hot' : '') + '" data-k="undo">' + IC.undo + (W.input ? 'Xóa số' : 'Hoàn tác rổ') + '</button>' +
    k(4) + k(5) + k(6) + '<button class="k fn" data-k="hide">' + IC.down + 'Ẩn phím</button>' +
    k(7) + k(8) + k(9) + '<button class="k fn" data-k="mode">Cách nhập<small>' + modeLbl + '</small></button>' +
    '<button class="k" data-k=","' + (quick || blocked ? ' disabled' : '') + '>,</button>' + k(0) +
    '<button class="k" data-k="bs" aria-label="Xóa">' + IC.bs + '</button>' +
    '<button class="k go" data-k="go"' + (parsed && !blocked ? '' : ' disabled') + '>' + goLbl + '</button></div>';
  el.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b && !b.disabled) key(b.dataset.k); };
}
function key(k) {
  const s = curSheet(); const quick = s.entry.mode === 'quick', d = dec(s), mk = s.entry.maxKg;
  if (W.hint && k !== 'go') W.hint = null;
  if (/^\d$/.test(k)) {
    if (quick) {
      const maxLen = C.intDigitsFor(mk) + d;
      if (W.input.length >= maxLen) return;
      W.input += k;
      const p = C.parseQuick(W.input, d, mk);
      if (p && p.auto) { tryCommit(p.c); return; }
    } else {
      const [ip, fp] = W.input.split(',');
      if (fp !== undefined) { if (fp.length >= d) return; W.input += k; }
      else { if (ip === '0') W.input = k; else if (ip.length >= C.intDigitsFor(mk)) return; else W.input += k; }
    }
  } else if (k === ',') { if (!W.input.includes(',')) W.input = (W.input || '0') + ','; }
  else if (k === 'bs') { W.input = W.input.slice(0, -1); }
  else if (k === 'go') {
    const p = quick ? C.parseQuick(W.input, d, mk) : C.parseDirect(W.input, d);
    if (p) { tryCommit(p.c); return; }
  } else if (k === 'undo') { if (W.input) W.input = ''; else undoLast(s); return updWeigh(); }
  else if (k === 'hide') { W.hide = true; return updPad(); }
  else if (k === 'mode') { return openEntrySettings(s); }
  updGrid(false); updMsg(); updPad();
  const cc = $('#curCell'); if (cc) cc.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function tryCommit(c) {
  const s = curSheet(), d = dec(s), mk = s.entry.maxKg;
  if (c <= 0) { toast('Số ký phải lớn hơn 0'); W.input = ''; return updWeigh(); }
  if (c >= mk * 100) { toast('Mỗi rổ tối đa ' + C.fmtKgC(mk * 100 - (d === 2 ? 1 : 10), d) + ' kg. Đổi ở "Cách nhập".'); W.input = ''; return updWeigh(); }
  const recent = C.activeBaskets(s).map(b => b.c);
  const an = C.checkAnomaly(c, recent, mk);
  if (an && an.type === 'big') { W.prompt = { c, an }; updGrid(false); updMsg(); updPad(); speak('Kiểm tra lại'); return; }
  addBasket(c);
  if (an && an.type === 'small') { W.hint = { id: s.baskets[s.baskets.length - 1].id, c, suggest: an.suggest }; updMsg(); }
}
function addBasket(c) {
  const s = curSheet();
  const b = { id: uid(), c, t: Date.now() };
  s.baskets.push(b); logAct(s, 'add', { id: b.id, to: c });
  W.input = ''; saveSheet(s);
  speak(C.fmtKgC(c, dec(s)));
  if (!S.meta.askedPersist && navigator.storage && navigator.storage.persist) { S.meta.askedPersist = true; saveMeta(); navigator.storage.persist().catch(() => {}); }
  updWeigh(true);
}
function undoLast(s) {
  const act = C.activeBaskets(s); if (!act.length) return;
  const b = act[act.length - 1]; const i = s.baskets.indexOf(b); const n = act.length;
  s.baskets.splice(i, 1); logAct(s, 'undo', { id: b.id, from: b.c }); saveSheet(s);
  toast('Đã bỏ rổ ' + n + ' · ' + C.fmtKgC(b.c, dec(s)) + ' kg', 'Lấy lại', () => { s.baskets.splice(i, 0, b); logAct(s, 'redo', { id: b.id, to: b.c }); saveSheet(s); updWeigh(); });
}
async function basketMenu(s, id) {
  const act = C.activeBaskets(s); const b = s.baskets.find(x => x.id === id); if (!b) return;
  const n = act.indexOf(b) + 1, d = dec(s);
  if (s.locked) { toast('Bảng đã kết sổ. Mở lại để sửa.'); return; }
  const v = await dlg({ title: 'Rổ ' + n + ' · ' + C.fmtKgC(b.c, d) + ' kg', text: b.ed ? 'Rổ này đã từng được sửa số.' : 'Ghi lúc ' + new Date(b.t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    actions: [{ label: 'Đóng', val: null, cls: 'gray' }, { label: 'Gạch rổ', val: 'strike', cls: 'red' }, { label: 'Sửa số ký', val: 'edit' }] });
  if (v === 'edit') {
    const r = await dlg({ title: 'Sửa rổ ' + n, text: 'Gõ đúng số ký trên cân (có dấu phẩy):', input: { value: C.fmtKgC(b.c, d).replace(/\./g, ''), mode: 'decimal' },
      actions: [{ label: 'Hủy', val: null, cls: 'gray' }, { label: 'Lưu', val: '__input' }] });
    if (r === null) return;
    const p = C.parseDirect(r.trim(), d);
    if (!p || p.c <= 0 || p.c >= s.entry.maxKg * 100) { toast('Số ký không hợp lệ'); return; }
    if (p.c === b.c) return;
    logAct(s, 'edit', { id: b.id, from: b.c, to: p.c }); b.c = p.c; b.ed = true; await saveSheet(s); updWeigh();
    toast('Đã sửa rổ ' + n + ' thành ' + C.fmtKgC(p.c, d) + ' kg');
  } else if (v === 'strike') {
    b.struck = true; logAct(s, 'strike', { id: b.id, from: b.c }); await saveSheet(s); updWeigh();
    toast('Đã gạch rổ ' + n + ' · ' + C.fmtKgC(b.c, d) + ' kg', 'Hoàn tác', () => { b.struck = false; logAct(s, 'unstrike', { id: b.id, to: b.c }); saveSheet(s); updWeigh(); });
  }
}

/* ================= Bảng trượt: cách nhập số ================= */
function opts(name, cur, list) {
  return '<div class="opts" data-opt="' + name + '">' + list.map(([v, l, sm]) => '<button data-v="' + v + '" class="' + (String(cur) === String(v) ? 'on' : '') + '">' + l + (sm ? '<small>' + sm + '</small>' : '') + '</button>').join('') + '</div>';
}
function bindOpts(root, fn) {
  root.querySelectorAll('[data-opt]').forEach(g => g.onclick = (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    if (fn(g.dataset.opt, b.dataset.v) === false) return;
    g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
}
async function openEntrySettings(s) {
  if (W.input) {
    const ok = await dlg({ title: 'Bỏ số đang nhập?', text: 'Số ' + W.input + ' chưa được ghi. Đổi cách nhập sẽ bỏ số này.', actions: [{ label: 'Hủy', val: false, cls: 'gray' }, { label: 'Bỏ số và đổi', val: true }] });
    if (!ok) return; W.input = ''; updWeigh();
  }
  const o = overlay('<div class="sheet"><div class="sh"><h2>Cách nhập số</h2><button class="ibtn x" id="x">' + IC.x + '</button></div><div class="sb">' + entryForm(s.entry) + '<button class="btn block" id="done" style="margin-top:16px">Xong</button></div></div>');
  bindEntryForm(o, s.entry, s);
  const close = () => { o.remove(); saveSheet(s); updWeigh(); };
  $('#x', o).onclick = close; $('#done', o).onclick = close;
  o.addEventListener('click', e => { if (e.target === o) close(); });
}
function entryForm(e) {
  return '<div class="grp">Cách nhập</div>' + opts('mode', e.mode, [['quick', 'Nhập nhanh', 'không gõ dấu phẩy'], ['direct', 'Nhập trực tiếp', 'gõ 21,8 rồi Ghi']]) +
    '<div class="grp">Mỗi rổ nặng</div>' + opts('maxKg', e.maxKg, [[10, 'Dưới 10 kg'], [100, 'Dưới 100 kg', 'phổ biến'], [1000, 'Dưới 1.000 kg']]) +
    '<div class="grp">Số sau dấu phẩy</div>' + opts('decimals', e.decimals, [[1, '0,1 kg'], [2, '0,01 kg']]) +
    '<div class="hint info" style="margin:14px 0 0" id="entryEx"></div>';
}
function bindEntryForm(root, e, s) {
  const ex = () => {
    const el = $('#entryEx', root); if (!el) return;
    if (e.mode === 'direct') { el.innerHTML = '<span class="tx">Gõ đúng số trên cân, có dấu phẩy, rồi bấm Ghi. Ví dụ: 21,8 → Ghi.</span>'; return; }
    const n = C.intDigitsFor(e.maxKg) + e.decimals;
    const sample = e.maxKg >= 1000 ? 218.5 : e.maxKg >= 100 ? 21.8 : 2.1;
    const v = e.decimals === 2 ? sample + 0.05 : sample;
    const digits = String(Math.round(v * Math.pow(10, e.decimals))).padStart(n, '0');
    el.innerHTML = '<span class="tx">Đủ ' + n + ' số là rổ tự ghi, số ngắn hơn thì bấm Ghi.<br>Cân hiện ' + C.fmtKgC(C.toC(v), e.decimals) + ' kg → bấm <b>' + digits + '</b>.</span>';
  };
  ex();
  bindOpts(root, (k, v) => {
    if (k === 'decimals' && s && +v === 1 && s.baskets.some(b => b.c % 10)) { toast('Bảng đã có rổ 2 số lẻ, không đổi về 1 số lẻ được.'); return false; }
    e[k] = k === 'mode' ? v : +v; ex();
  });
}

/* ================= Bảng trượt: cài đặt bảng cân ================= */
function fr(label, inner, cls) { return '<div class="fr ' + (cls || '') + '"><label>' + label + '</label><div class="v">' + inner + '</div></div>'; }
function openSheetSettings(s, isNew) {
  const pondsDL = '<datalist id="dlPonds">' + S.meta.ponds.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist>';
  const buyDL = '<datalist id="dlBuyers">' + S.meta.buyers.map(b => '<option value="' + esc(b.name) + '">').join('') + '</datalist>';
  const ban = s.kind === 'ban';
  let h = '<div class="sheet"><div class="sh"><h2>' + (isNew ? (ban ? 'Bảng cân bán mới' : 'Bảng sang tôm mới') : 'Cài đặt bảng') + '</h2><button class="ibtn x" id="x">' + IC.x + '</button></div><div class="sb">' + pondsDL + buyDL;
  h += '<div class="grp">Thông tin bảng</div><div class="form">' +
    fr('Ngày cân', '<input type="date" data-f="date" value="' + esc(s.date) + '">') +
    fr(ban ? 'Ao' : 'Từ ao', '<input data-f="pond" list="dlPonds" placeholder="VD: E1" value="' + esc(s.pond) + '">') +
    (ban ? '' : fr('Sang ao', '<input data-f="toPond" list="dlPonds" placeholder="VD: E5" value="' + esc(s.toPond) + '">')) +
    fr('Cỡ tôm', '<input data-f="size" placeholder="VD: 40 con/kg" value="' + esc(s.size) + '">') +
    fr('Tên bảng', '<input data-f="name" placeholder="' + esc(dispName(Object.assign({}, s, { name: '' }))) + '" value="' + esc(s.name) + '">') + '</div>';
  if (ban) {
    h += '<div class="grp">Thương lái & giá</div><div class="form">' +
      fr('Thương lái', '<input data-f="buyerName" list="dlBuyers" placeholder="Chọn hoặc gõ tên" value="' + esc(s.buyerName) + '">') +
      fr('Số điện thoại', '<input data-f="buyerPhone" inputmode="tel" placeholder="Không bắt buộc" value="' + esc(s.buyerPhone) + '">') +
      fr('Đơn giá (đ/kg)', '<input data-f="price" inputmode="numeric" placeholder="Chưa chốt giá" value="' + (s.price != null ? C.fmtMoney(s.price) : '') + '">') + '</div>' +
      '<div class="note">Để trống đơn giá = chưa chốt giá. Phiếu sẽ ghi rõ “chưa chốt giá”, không ghi số 0.</div>' +
      '<div class="grp">Trừ khối lượng</div><div class="form">' +
      fr('Trừ bì mỗi rổ (kg)', '<input data-f="tare" inputmode="decimal" placeholder="0" value="' + (s.tare ? C.fmtKgC(C.toC(s.tare)) : '') + '">') +
      fr('Trừ nước/đá (%)', '<input data-f="deductPct" inputmode="decimal" placeholder="0" value="' + (s.deductPct ? String(s.deductPct).replace('.', ',') : '') + '">') + '</div>' +
      '<div class="note">Số trên cân giữ nguyên trong sổ. Phép trừ được in rõ trên phiếu.</div>' +
      '<div class="grp">Tiền cọc & các lần trả</div><div class="form">' +
      fr('Tiền cọc (đ)', '<input data-f="deposit" inputmode="numeric" placeholder="0" value="' + (s.deposit ? C.fmtMoney(s.deposit) : '') + '">') +
      '<div id="pays"></div><div class="fr"><button class="btn sec block" id="addPay">+ Thêm lần trả</button></div></div>';
  }
  h += '<div class="grp">Cách cân</div><div class="form" style="padding:12px">' + entryForm(s.entry) + '</div>' +
    '<div class="grp">Rổ mỗi cột</div>' + opts('perCol', s.perCol || 10, [[5, '5 rổ'], [10, '10 rổ', 'như sổ giấy']]) +
    '<div class="grp">Ghi chú</div><div class="form"><div class="fr col2"><textarea data-f="note" placeholder="Ghi chú thêm (không bắt buộc)">' + esc(s.note) + '</textarea></div></div>';
  const struck = s.baskets.filter(b => b.struck);
  if (struck.length) {
    h += '<div class="grp">Rổ đã gạch (' + struck.length + ')</div><div class="form">' + struck.map(b =>
      '<div class="listrow"><span class="t" style="text-decoration:line-through">' + C.fmtKgC(b.c, dec(s)) + ' kg</span><button class="btn sec" data-unstrike="' + b.id + '" style="min-height:36px;padding:6px 12px">Bỏ gạch</button></div>').join('') + '</div>';
  }
  const edits = (s.log || []).filter(l => l.a !== 'add');
  if (edits.length) h += '<div class="grp">Lịch sử sửa (' + edits.length + ')</div><div class="form" style="padding:8px 14px"><div class="loglist">' + edits.slice(-30).reverse().map(logLine.bind(null, s)).join('') + '</div></div>';
  if (!isNew) {
    h += '<div class="grp">Bảng cân này</div><div class="form">' +
      '<div class="fr"><button class="btn ' + (s.locked ? 'sec' : '') + ' block" id="lock">' + (s.locked ? 'Mở lại bảng cân' : '✓ Kết sổ bảng cân') + '</button></div>' +
      '<div class="fr"><button class="btn red block" id="del">Xóa bảng cân</button></div></div>';
  }
  h += '<button class="btn block" id="done" style="margin-top:18px">' + (isNew ? 'Bắt đầu cân' : 'Xong') + '</button></div></div>';
  const o = overlay(h);
  const close = () => { commitBuyer(s); o.remove(); saveSheet(s); updWeigh(true); };
  $('#x', o).onclick = close; $('#done', o).onclick = close;
  o.addEventListener('click', e => { if (e.target === o) close(); });
  bindEntryForm(o, s.entry, s);
  bindOpts(o, (k, v) => { if (k === 'perCol') s.perCol = +v; else s.entry[k] = k === 'mode' ? v : +v; });
  o.querySelectorAll('[data-f]').forEach(inp => {
    const f = inp.dataset.f;
    inp.addEventListener('change', () => {
      const v = inp.value;
      if (f === 'price') { const n = C.parseMoney(v); s.price = n === null ? null : n; inp.value = n === null ? '' : C.fmtMoney(n); }
      else if (f === 'deposit') { s.deposit = C.parseMoney(v) || 0; inp.value = s.deposit ? C.fmtMoney(s.deposit) : ''; }
      else if (f === 'tare') { const n = parseFloat(v.replace(',', '.')); s.tare = isNaN(n) || n < 0 ? 0 : Math.round(n * 100) / 100; }
      else if (f === 'deductPct') { const n = parseFloat(v.replace(',', '.')); s.deductPct = isNaN(n) || n < 0 || n >= 100 ? 0 : n; }
      else if (f === 'buyerName') { s.buyerName = v.trim(); const b = S.meta.buyers.find(x => x.name.toLowerCase() === s.buyerName.toLowerCase()); if (b && b.phone) { s.buyerPhone = b.phone; const ph = o.querySelector('[data-f="buyerPhone"]'); if (ph) ph.value = b.phone; } }
      else s[f] = typeof v === 'string' ? v.trim() : v;
      if (f === 'pond' || f === 'toPond') addPond(s[f]);
      if (['price', 'deposit', 'tare', 'deductPct'].includes(f)) logAct(s, 'set', { f, to: s[f] });
      saveSheet(s);
    });
  });
  if (ban) renderPays(o, s);
  const ap = $('#addPay', o); if (ap) ap.onclick = () => { s.payments.push({ id: uid(), amount: 0, date: todayISO() }); renderPays(o, s); const ins = o.querySelectorAll('#pays .amt'); ins[ins.length - 1].focus(); };
  o.querySelectorAll('[data-unstrike]').forEach(b => b.onclick = () => { const x = s.baskets.find(y => y.id === b.dataset.unstrike); if (x) { x.struck = false; logAct(s, 'unstrike', { id: x.id, to: x.c }); saveSheet(s); b.closest('.listrow').remove(); toast('Đã bỏ gạch rổ ' + C.fmtKgC(x.c, dec(s)) + ' kg'); } });
  const lk = $('#lock', o); if (lk) lk.onclick = async () => {
    if (!s.locked) { if (!await confirmDlg('Kết sổ bảng cân?', 'Kết sổ để khóa bảng, không ghi thêm rổ. Có thể mở lại khi cần.', 'Kết sổ')) return; s.locked = true; logAct(s, 'lock'); }
    else { s.locked = false; logAct(s, 'unlock'); }
    close();
  };
  const dl = $('#del', o); if (dl) dl.onclick = async () => {
    const t = C.totals(s);
    if (!await confirmDlg('Xóa bảng cân?', 'Xóa “' + dispName(s) + '” (' + t.count + ' rổ, ' + C.fmtKgC(t.grossC) + ' kg). Không lấy lại được trừ khi có file sao lưu.', 'Xóa', true)) return;
    S.sheets = S.sheets.filter(x => x.id !== s.id); await DB.delSheet(s.id); o.remove(); go('home'); toast('Đã xóa bảng cân');
  };
}
function renderPays(o, s) {
  const el = $('#pays', o); if (!el) return;
  el.innerHTML = s.payments.map((p, i) => '<div class="pay"><input class="dt" type="date" data-pi="' + i + '" data-pf="date" value="' + esc(p.date) + '"><input class="amt" inputmode="numeric" placeholder="Số tiền" data-pi="' + i + '" data-pf="amount" value="' + (p.amount ? C.fmtMoney(p.amount) : '') + '"><button class="ibtn" data-prm="' + i + '" aria-label="Xóa">' + IC.x + '</button></div>').join('');
  el.querySelectorAll('[data-pf]').forEach(inp => inp.onchange = () => {
    const p = s.payments[+inp.dataset.pi];
    if (inp.dataset.pf === 'amount') { p.amount = C.parseMoney(inp.value) || 0; inp.value = p.amount ? C.fmtMoney(p.amount) : ''; logAct(s, 'pay', { to: p.amount }); }
    else p.date = inp.value;
    saveSheet(s);
  });
  el.querySelectorAll('[data-prm]').forEach(b => b.onclick = () => { const p = s.payments.splice(+b.dataset.prm, 1)[0]; logAct(s, 'unpay', { from: p.amount }); saveSheet(s); renderPays(o, s); });
}
function logLine(s, l) {
  const d = dec(s), tm = new Date(l.ts).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  const k = (c) => C.fmtKgC(c, d) + ' kg';
  const m = { undo: 'Bỏ rổ ' + k(l.from), redo: 'Lấy lại rổ ' + k(l.to), edit: 'Sửa rổ ' + (l.from != null ? k(l.from) : '') + ' → ' + k(l.to), strike: 'Gạch rổ ' + k(l.from), unstrike: 'Bỏ gạch rổ ' + k(l.to),
    lock: 'Kết sổ', unlock: 'Mở lại bảng', pay: 'Ghi lần trả ' + C.fmtMoney(l.to) + 'đ', unpay: 'Xóa lần trả ' + C.fmtMoney(l.from) + 'đ',
    set: ({ price: 'Đơn giá', deposit: 'Tiền cọc', tare: 'Trừ bì/rổ', deductPct: 'Trừ %' }[l.f] || l.f) + ' = ' + (l.to == null ? 'chưa chốt' : (l.f === 'price' || l.f === 'deposit' ? C.fmtMoney(l.to) : String(l.to).replace('.', ','))) }[l.a] || l.a;
  return '<div>' + tm + ' · ' + esc(m) + '</div>';
}
function addPond(p) { if (p && !S.meta.ponds.some(x => x.toLowerCase() === p.toLowerCase())) { S.meta.ponds.push(p); saveMeta(); } }
function commitBuyer(s) {
  if (s.kind !== 'ban' || !s.buyerName) return;
  const b = S.meta.buyers.find(x => x.name.toLowerCase() === s.buyerName.toLowerCase());
  if (!b) { S.meta.buyers.push({ id: uid(), name: s.buyerName, phone: s.buyerPhone || '' }); saveMeta(); }
  else if (s.buyerPhone && !b.phone) { b.phone = s.buyerPhone; saveMeta(); }
}

/* ================= Phiếu cân ================= */
function qrDataURL(text, cell) {
  if (!text || typeof qrcode === 'undefined') return null;
  try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createDataURL(cell || 4, 2); } catch (e) { return null; }
}
function receiptQR(s) {
  const t = C.totals(s), bk = S.meta.bank;
  if (s.kind !== 'ban' || !bk.bin || !bk.acc || !t.priced || !(t.remain > 0)) return null;
  const note = 'TT tom ' + (s.pond ? 'ao ' + s.pond + ' ' : '') + ddmm(s.date);
  return { payload: C.vietQR(bk.bin, bk.acc, t.remain, note), amount: t.remain, note };
}
function receiptHTML(s) {
  const t = C.totals(s), d = dec(s), ban = s.kind === 'ban';
  const row = (a, b) => b ? '<tr><td>' + a + '</td><td>' + esc(b) + '</td></tr>' : '';
  let h = '<div class="rcpt"><h2>' + (ban ? 'PHIẾU CÂN TÔM' : 'PHIẾU SANG TÔM') + '</h2><div class="sub">' + esc(dispName(s)) + ' · ' + C.fmtDate(s.date) + '</div><table class="meta">' +
    row('Trại', S.meta.farm) + (ban ? row('Ao', s.pond) + row('Thương lái', s.buyerName) + row('Điện thoại', s.buyerPhone) : row('Từ ao', s.pond || '—') + row('Sang ao', s.toPond || '—')) + row('Cỡ tôm', s.size) + '</table>';
  h += '<div class="bk">' + C.columns(s).map((c, i) => '<div class="c"><div class="h">Cột ' + String(i + 1).padStart(2, '0') + '</div>' + c.items.map(b => '<div>' + C.fmtKgC(b.c, d) + '</div>').join('') + '<div class="t">' + C.fmtKgC(c.totalC, d) + '</div></div>').join('') + '</div>';
  h += '<table class="sum">' + '<tr><td>Số rổ</td><td>' + t.count + '</td></tr>' + '<tr class="' + (ban && (t.tareC || t.deductC || t.priced) ? '' : 'big') + '"><td>Tổng cân</td><td>' + C.fmtKgC(t.grossC, d) + ' kg</td></tr>';
  if (ban) {
    if (t.tareC) h += '<tr><td>Trừ bì: ' + t.count + ' rổ × ' + C.fmtKgC(t.tarePerC) + ' kg</td><td>− ' + C.fmtKgC(t.tareC) + ' kg</td></tr>';
    if (t.deductC) h += '<tr><td>Trừ nước/đá ' + String(t.pct).replace('.', ',') + '%</td><td>− ' + C.fmtKgC(t.deductC) + ' kg</td></tr>';
    if (t.tareC || t.deductC) h += '<tr><td><b>Khối lượng tính tiền</b></td><td>' + C.fmtKgC(t.netC) + ' kg</td></tr>';
    if (t.priced) {
      h += '<tr><td>Đơn giá</td><td>' + C.fmtMoney(s.price) + ' đ/kg</td></tr><tr class="big"><td>THÀNH TIỀN</td><td>' + C.fmtMoney(t.money) + ' đ</td></tr>';
      if (t.deposit) h += '<tr><td>Đã cọc</td><td>− ' + C.fmtMoney(t.deposit) + ' đ</td></tr>';
      s.payments.filter(p => p.amount).forEach(p => h += '<tr><td>Đã trả ' + C.fmtDate(p.date) + '</td><td>− ' + C.fmtMoney(p.amount) + ' đ</td></tr>');
      if (t.paid) h += '<tr class="big"><td>CÒN LẠI</td><td>' + C.fmtMoney(t.remain) + ' đ</td></tr>';
    } else {
      h += '<tr class="big"><td>Giá</td><td style="color:#b45309">CHƯA CHỐT GIÁ</td></tr>';
      if (t.deposit) h += '<tr><td>Đã cọc</td><td>' + C.fmtMoney(t.deposit) + ' đ</td></tr>';
    }
  }
  h += '</table>';
  const notes = [];
  if (t.struckCount) notes.push('Đã gạch ' + t.struckCount + ' rổ (' + C.fmtKgC(t.struckC, d) + ' kg), không tính.');
  const ne = (s.log || []).filter(l => l.a === 'edit').length; if (ne) notes.push('Bảng có ' + ne + ' lần sửa số ký.');
  if (s.note) notes.push('Ghi chú: ' + s.note);
  if (notes.length) h += '<p class="note">' + notes.map(esc).join('<br>') + '</p>';
  const qr = receiptQR(s);
  if (qr) { const img = qrDataURL(qr.payload, 4); if (img) h += '<div class="qr"><img src="' + img + '" alt="Mã VietQR"><div><b>Quét để chuyển khoản</b><br>' + C.fmtMoney(qr.amount) + ' đ<br><span class="note" style="padding:0">' + esc(bankName(S.meta.bank.bin)) + ' · ' + esc(S.meta.bank.acc) + '<br>' + esc(S.meta.bank.owner) + '</span></div></div>'; }
  h += '<div class="sign"><div>' + (ban ? 'Bên bán' : 'Người cân') + '<span></span></div><div>' + (ban ? 'Bên mua' : 'Người nhận') + '<span></span></div></div>';
  h += '<div class="foot">Sổ Cân Tôm · lập lúc ' + nowStr() + '</div></div>';
  return h;
}
function bankName(bin) { const b = C.BANKS.find(x => x[0] === bin); return b ? b[1] : ''; }
function receiptTextFull(s) {
  let txt = C.receiptText(s, { farm: S.meta.farm, name: dispName(s) });
  const qr = receiptQR(s);
  if (qr) txt += '\n------------------------------\nChuyển khoản: ' + bankName(S.meta.bank.bin) + ' · ' + S.meta.bank.acc + (S.meta.bank.owner ? ' · ' + S.meta.bank.owner : '');
  return txt;
}
function openReceipt(s) {
  if (s.kind === 'ban') commitBuyer(s);
  const o = overlay('<div class="sheet"><div class="sh"><h2>Phiếu ' + (s.kind === 'ban' ? 'cân' : 'sang tôm') + '</h2><button class="ibtn x" id="x">' + IC.x + '</button></div><div class="sb">' +
    receiptHTML(s) + '<div class="shareacts"><button class="btn" id="shTxt">Gửi phiếu chữ (Zalo)</button><button class="btn" id="shImg">Gửi phiếu ảnh</button><button class="btn sec" id="shPrint">In / Lưu PDF</button><button class="btn sec" id="shCopy">Sao chép chữ</button></div></div></div>');
  const close = () => o.remove();
  $('#x', o).onclick = close; o.addEventListener('click', e => { if (e.target === o) close(); });
  $('#shTxt', o).onclick = async () => { const txt = receiptTextFull(s); if (navigator.share) { try { await navigator.share({ text: txt }); return; } catch (e) { if (e && e.name === 'AbortError') return; } } copyText(txt); };
  $('#shCopy', o).onclick = () => copyText(receiptTextFull(s));
  $('#shPrint', o).onclick = () => { const pa = $('#printArea'); pa.innerHTML = receiptHTML(s); pa.classList.remove('hidden'); setTimeout(() => { try { window.print(); } catch (e) { toast('Máy này không in được từ đây.'); } setTimeout(() => pa.classList.add('hidden'), 500); }, 50); };
  $('#shImg', o).onclick = () => shareImage(s);
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast('Đã chép phiếu. Dán vào Zalo để gửi.'); }
  catch (e) { dlg({ title: 'Sao chép phiếu', html: '<textarea style="width:100%;height:240px;border:1px solid #e2e8f0;border-radius:10px;padding:8px;font-size:13px">' + esc(txt) + '</textarea>', actions: [{ label: 'Đóng', val: null, cls: 'gray' }] }); }
}
function drawReceipt(s) {
  const W0 = 760, P = 28, t = C.totals(s), d = dec(s), ban = s.kind === 'ban';
  const cv = document.createElement('canvas'); cv.width = W0; cv.height = 6000;
  const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W0, 6000);
  const F = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
  let y = P;
  const text = (str, px, opt) => { opt = opt || {}; x.font = (opt.b ? '700 ' : '400 ') + px + 'px ' + F; x.fillStyle = opt.c || '#0f172a'; x.textAlign = opt.a || 'left'; x.fillText(str, opt.x != null ? opt.x : (opt.a === 'center' ? W0 / 2 : opt.a === 'right' ? W0 - P : P), y); };
  const line = (dash) => { x.strokeStyle = '#94a3b8'; x.setLineDash(dash ? [5, 4] : []); x.beginPath(); x.moveTo(P, y); x.lineTo(W0 - P, y); x.stroke(); x.setLineDash([]); };
  y += 30; text(ban ? 'PHIẾU CÂN TÔM' : 'PHIẾU SANG TÔM', 32, { b: 1, a: 'center' });
  y += 30; text(dispName(s) + ' · ' + C.fmtDate(s.date), 20, { a: 'center', c: '#475569' });
  y += 14;
  const meta = [['Trại', S.meta.farm]].concat(ban ? [['Ao', s.pond], ['Thương lái', s.buyerName], ['Điện thoại', s.buyerPhone]] : [['Từ ao', s.pond || '—'], ['Sang ao', s.toPond || '—']]).concat([['Cỡ tôm', s.size]]).filter(r => r[1]);
  meta.forEach(([a, b]) => { y += 30; text(a, 21); text(b, 21, { b: 1, a: 'right' }); });
  y += 18; line(); y += 12;
  // Các cột rổ
  const cols = C.columns(s), per = s.perCol || 10, cw = 84, gap = 8, perRow = Math.floor((W0 - 2 * P + gap) / (cw + gap));
  for (let r0 = 0; r0 < cols.length; r0 += perRow) {
    const row = cols.slice(r0, r0 + perRow); const top = y; const lh = 25;
    row.forEach((c, j) => {
      const cx = P + j * (cw + gap); let yy = top;
      x.strokeStyle = '#cbd5e1'; x.lineWidth = 1; x.strokeRect(cx, top, cw, 34 + per * lh + 36);
      x.font = '700 16px ' + F; x.fillStyle = '#4b6878'; x.textAlign = 'center'; x.fillText('Cột ' + String(r0 + j + 1).padStart(2, '0'), cx + cw / 2, yy + 24);
      yy += 34;
      c.items.forEach((b, k) => { x.font = '600 19px ' + F; x.fillStyle = '#0f172a'; x.fillText(C.fmtKgC(b.c, d), cx + cw / 2, yy + (k + 1) * lh - 6); });
      yy += per * lh; x.strokeStyle = '#0f172a'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx + 6, yy + 4); x.lineTo(cx + cw - 6, yy + 4); x.stroke(); x.lineWidth = 1;
      x.font = '800 19px ' + F; x.fillStyle = '#0f172a'; x.fillText(C.fmtKgC(c.totalC, d), cx + cw / 2, yy + 28);
    });
    y = top + 34 + per * lh + 36 + 12;
  }
  line(); y += 6;
  const sum = (a, b, big) => { y += big ? 38 : 32; text(a, big ? 24 : 21, { b: big }); text(b, big ? 26 : 21, { b: 1, a: 'right' }); };
  sum('Số rổ', String(t.count)); sum('Tổng cân', C.fmtKgC(t.grossC, d) + ' kg', !ban);
  if (ban) {
    if (t.tareC) sum('Trừ bì: ' + t.count + ' rổ × ' + C.fmtKgC(t.tarePerC) + ' kg', '− ' + C.fmtKgC(t.tareC) + ' kg');
    if (t.deductC) sum('Trừ nước/đá ' + String(t.pct).replace('.', ',') + '%', '− ' + C.fmtKgC(t.deductC) + ' kg');
    if (t.tareC || t.deductC) sum('Khối lượng tính tiền', C.fmtKgC(t.netC) + ' kg');
    if (t.priced) {
      sum('Đơn giá', C.fmtMoney(s.price) + ' đ/kg'); sum('THÀNH TIỀN', C.fmtMoney(t.money) + ' đ', 1);
      if (t.deposit) sum('Đã cọc', '− ' + C.fmtMoney(t.deposit) + ' đ');
      s.payments.filter(p => p.amount).forEach(p => sum('Đã trả ' + C.fmtDate(p.date), '− ' + C.fmtMoney(p.amount) + ' đ'));
      if (t.paid) sum('CÒN LẠI', C.fmtMoney(t.remain) + ' đ', 1);
    } else { sum('Giá', 'CHƯA CHỐT GIÁ', 1); if (t.deposit) sum('Đã cọc', C.fmtMoney(t.deposit) + ' đ'); }
  }
  y += 14; line(true);
  const notes = [];
  if (t.struckCount) notes.push('Đã gạch ' + t.struckCount + ' rổ (' + C.fmtKgC(t.struckC, d) + ' kg), không tính.');
  const ne = (s.log || []).filter(l => l.a === 'edit').length; if (ne) notes.push('Bảng có ' + ne + ' lần sửa số ký.');
  if (s.note) notes.push('Ghi chú: ' + s.note);
  notes.forEach(n => { y += 28; text(n, 18, { c: '#475569' }); });
  const qr = receiptQR(s);
  if (qr && typeof qrcode !== 'undefined') {
    try {
      const q = qrcode(0, 'M'); q.addData(qr.payload); q.make();
      const n = q.getModuleCount(), cell = Math.floor(200 / n), size = n * cell; y += 24; const top = y;
      x.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) x.fillRect(P + c * cell, top + r * cell, cell, cell);
      const tx = P + size + 20; y = top + 34; text('Quét để chuyển khoản', 22, { b: 1, x: tx });
      y += 32; text(C.fmtMoney(qr.amount) + ' đ', 26, { b: 1, x: tx, c: '#4b6878' });
      y += 30; text(bankName(S.meta.bank.bin) + ' · ' + S.meta.bank.acc, 19, { x: tx });
      if (S.meta.bank.owner) { y += 26; text(S.meta.bank.owner, 19, { x: tx }); }
      y = top + size;
    } catch (e) {}
  }
  y += 50; text(ban ? 'Bên bán' : 'Người cân', 21, { b: 1, a: 'center', x: W0 * 0.27 }); text(ban ? 'Bên mua' : 'Người nhận', 21, { b: 1, a: 'center', x: W0 * 0.73 });
  y += 90; text('Sổ Cân Tôm · lập lúc ' + nowStr(), 16, { a: 'center', c: '#94a3b8' });
  y += P;
  const out = document.createElement('canvas'); out.width = W0; out.height = y;
  out.getContext('2d').drawImage(cv, 0, 0); return out;
}
function shareImage(s) {
  const cv = drawReceipt(s);
  const fname = 'phieu-' + C.stripVN(dispName(s)).replace(/\s+/g, '-').toLowerCase() + '.png';
  cv.toBlob(async (blob) => {
    try {
      const file = new File([blob], fname, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const url = cv.toDataURL('image/png');
    dlg({ title: 'Phiếu ảnh', text: 'Nhấn giữ vào ảnh để lưu hoặc chia sẻ.', html: '<img src="' + url + '" style="width:100%;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:12px">', actions: [{ label: 'Đóng', val: null, cls: 'gray' }] });
  }, 'image/png');
}

/* ================= Màn hình: Cài đặt chung ================= */
function renderSettings() {
  const m = S.meta, root = $('#settings');
  const sw = (id, on) => '<button class="sw ' + (on ? 'on' : '') + '" id="' + id + '" aria-label="bật tắt"></button>';
  let h = '<header class="top"><span class="ibtn ghost"></span><h1>Cài đặt</h1><span class="ibtn ghost"></span></header><div class="scroll"><div class="wrap">';
  h += '<div class="grp">Trại</div><div class="form">' + fr('Tên trại (in trên phiếu)', '<input id="farm" placeholder="VD: Trại tôm Bé" value="' + esc(m.farm) + '">') +
    '<div class="fr col2"><label>Danh sách ao</label><div class="chips" id="ponds">' + m.ponds.map((p, i) => '<span class="chip">' + esc(p) + '<button data-rmp="' + i + '">×</button></span>').join('') + '</div>' +
    '<div class="row" style="margin-top:8px"><input id="newPond" placeholder="Tên ao, VD: E1" style="border:1px solid var(--line);border-radius:10px;padding:10px;flex:2"><button class="btn sec" id="addPond">Thêm</button></div></div></div>';
  h += '<div class="grp">Thương lái</div><div class="form">' + (m.buyers.length ? m.buyers.map((b, i) => '<div class="listrow"><span class="t">' + esc(b.name) + '<small>' + esc(b.phone || 'Chưa có số') + '</small></span><button class="btn sec" data-eb="' + i + '" style="min-height:36px;padding:6px 12px">Sửa</button><button class="ibtn" data-rmb="' + i + '">' + IC.x + '</button></div>').join('') : '<div class="listrow"><span class="t note">Chưa có thương lái. Gõ tên khi tạo bảng cân, app tự lưu lại.</span></div>') +
    '<div class="fr"><button class="btn sec block" id="addBuyer">+ Thêm thương lái</button></div></div>';
  h += '<div class="grp">Tài khoản nhận tiền (mã QR trên phiếu)</div><div class="form">' +
    fr('Ngân hàng', '<select id="bin"><option value="">— Chọn —</option>' + C.BANKS.map(b => '<option value="' + b[0] + '"' + (m.bank.bin === b[0] ? ' selected' : '') + '>' + b[1] + '</option>').join('') + '</select>') +
    fr('Số tài khoản', '<input id="acc" inputmode="numeric" value="' + esc(m.bank.acc) + '">') +
    fr('Tên chủ tài khoản', '<input id="owner" value="' + esc(m.bank.owner) + '" placeholder="VD: NGUYEN VAN BE">') + '</div>' +
    '<div class="note">Phiếu cân có giá sẽ kèm mã VietQR đúng số tiền còn lại — bên mua quét bằng app ngân hàng là trả. Tạo mã không cần mạng.</div>';
  h += '<div class="grp">Mặc định cho bảng mới</div><div class="form" style="padding:12px">' + entryForm(m.defaults) +
    '<div class="grp">Rổ mỗi cột</div>' + opts('perCol', m.defaults.perCol, [[5, '5 rổ'], [10, '10 rổ']]) + '</div>' +
    '<div class="form" style="margin-top:10px">' + fr('Trừ bì mặc định (kg/rổ)', '<input id="dTare" inputmode="decimal" placeholder="0" value="' + (m.defaults.tare ? C.fmtKgC(C.toC(m.defaults.tare)) : '') + '">') + '</div>';
  h += '<div class="grp">Khi cân</div><div class="form">' +
    fr('Đọc số ký ra loa', '<div style="display:flex;gap:10px;justify-content:flex-end;align-items:center"><button class="btn sec" id="tSpeak" style="min-height:34px;padding:4px 10px">Thử</button>' + sw('swSpeak', m.speak) + '</div>') +
    fr('Giữ màn hình luôn sáng', '<div style="display:flex;justify-content:flex-end">' + sw('swWake', m.wake) + '</div>') +
    fr('Chữ to', '<div style="display:flex;justify-content:flex-end">' + sw('swBig', m.bigText) + '</div>') + '</div>';
  const nS = S.sheets.length, nB = S.sheets.reduce((a, s) => a + s.baskets.length, 0);
  h += '<div class="grp">Sao lưu & khôi phục</div><div class="card"><p style="margin:0 0 8px">Sổ hiện có <b>' + nS + '</b> bảng, <b>' + nB + '</b> rổ. ' +
    (m.lastBackup ? 'Sao lưu gần nhất: <b>' + new Date(m.lastBackup).toLocaleString('vi-VN') + '</b>.' : '<span style="color:var(--red)">Chưa sao lưu lần nào.</span>') + '</p>' +
    '<p class="note" style="padding:0 0 10px">Sổ chỉ nằm trong máy này. Nên sao lưu sau mỗi đợt cân: lưu file vào <b>Tệp → iCloud Drive</b> hoặc gửi Zalo cho chính mình. Đổi máy thì mở app → Khôi phục từ file.</p>' +
    '<div class="row"><button class="btn" id="bk">Xuất file sao lưu</button><button class="btn sec" id="rs">Khôi phục từ file</button></div><input type="file" id="rsFile" accept=".json,application/json" class="hidden"></div>';
  if (!isStandalone()) h += installCard();
  h += '<p class="note" style="text-align:center;margin-top:10px">Sổ Cân Tôm ' + APP_VERSION + ' · dữ liệu lưu trong máy' + (DB.mode === 'ls' ? ' (chế độ dự phòng)' : '') + '<br>Không cần mạng · Không quảng cáo · Không tài khoản</p>';
  h += '</div></div>' + tabbar('settings');
  root.innerHTML = h; bindTabbar(root);

  $('#farm').onchange = (e) => { m.farm = e.target.value.trim(); saveMeta(); };
  const addP = () => { const v = $('#newPond').value.trim(); if (v) { addPond(v); renderSettings(); } };
  $('#addPond').onclick = addP; $('#newPond').onkeydown = (e) => { if (e.key === 'Enter') addP(); };
  root.querySelectorAll('[data-rmp]').forEach(b => b.onclick = () => { m.ponds.splice(+b.dataset.rmp, 1); saveMeta(); renderSettings(); });
  root.querySelectorAll('[data-rmb]').forEach(b => b.onclick = async () => { const x = m.buyers[+b.dataset.rmb]; if (await confirmDlg('Xóa thương lái?', 'Xóa “' + x.name + '” khỏi danh bạ. Các bảng cân cũ vẫn giữ tên.', 'Xóa', true)) { m.buyers.splice(+b.dataset.rmb, 1); saveMeta(); renderSettings(); } });
  const editBuyer = async (i) => {
    const b = i == null ? { id: uid(), name: '', phone: '' } : m.buyers[i];
    const name = await dlg({ title: i == null ? 'Thêm thương lái' : 'Sửa thương lái', text: 'Tên thương lái:', input: { value: b.name }, actions: [{ label: 'Hủy', val: null, cls: 'gray' }, { label: 'Tiếp', val: '__input' }] });
    if (!name || !name.trim()) return;
    const phone = await dlg({ title: name.trim(), text: 'Số điện thoại (không bắt buộc):', input: { value: b.phone, mode: 'tel' }, actions: [{ label: 'Bỏ qua', val: '', cls: 'gray' }, { label: 'Lưu', val: '__input' }] });
    b.name = name.trim(); b.phone = (phone || '').trim(); if (i == null) m.buyers.push(b); saveMeta(); renderSettings();
  };
  $('#addBuyer').onclick = () => editBuyer(null);
  root.querySelectorAll('[data-eb]').forEach(b => b.onclick = () => editBuyer(+b.dataset.eb));
  $('#bin').onchange = (e) => { m.bank.bin = e.target.value; saveMeta(); };
  $('#acc').onchange = (e) => { m.bank.acc = e.target.value.replace(/\s/g, ''); saveMeta(); };
  $('#owner').onchange = (e) => { m.bank.owner = C.stripVN(e.target.value).toUpperCase(); e.target.value = m.bank.owner; saveMeta(); };
  bindEntryForm(root, m.defaults, null);
  bindOpts(root, (k, v) => { if (k === 'perCol') m.defaults.perCol = +v; else m.defaults[k] = k === 'mode' ? v : +v; saveMeta(); });
  $('#dTare').onchange = (e) => { const n = parseFloat(e.target.value.replace(',', '.')); m.defaults.tare = isNaN(n) || n < 0 ? 0 : n; saveMeta(); };
  const tog = (id, k, after) => { $('#' + id).onclick = (e) => { m[k] = !m[k]; e.currentTarget.classList.toggle('on', m[k]); saveMeta(); after && after(); }; };
  tog('swSpeak', 'speak', () => { if (m.speak) speak('21,8'); }); tog('swWake', 'wake'); tog('swBig', 'bigText', () => document.body.classList.toggle('big', m.bigText));
  $('#tSpeak').onclick = () => { const o = m.speak; m.speak = true; speak('Hai mươi mốt phẩy tám'); m.speak = o; };
  $('#bk').onclick = exportBackup;
  $('#rs').onclick = () => $('#rsFile').click();
  $('#rsFile').onchange = (e) => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };
}

/* ================= Sao lưu ================= */
async function exportBackup() {
  const data = { app: 'so-can-tom', v: 1, exportedAt: new Date().toISOString(), meta: S.meta, sheets: S.sheets };
  const json = JSON.stringify(data);
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const fname = 'so-can-tom-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  const blob = new Blob([json], { type: 'application/json' });
  const mark = () => { S.meta.lastBackup = Date.now(); saveMeta(); if (S.view === 'settings') renderSettings(); else if (S.view === 'home') renderHome(); };
  try {
    const file = new File([blob], fname, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); mark(); toast('Đã xuất file sao lưu'); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    mark(); toast('Đã tải file ' + fname);
  } catch (e) { copyText(json); }
}
function importBackup(file) {
  const rd = new FileReader();
  rd.onload = async () => {
    let data; try { data = JSON.parse(rd.result); } catch (e) { toast('File không đúng định dạng sao lưu'); return; }
    if (!data || data.app !== 'so-can-tom' || !Array.isArray(data.sheets)) { toast('Đây không phải file sao lưu Sổ Cân Tôm'); return; }
    const nb = data.sheets.reduce((a, s) => a + (s.baskets || []).length, 0);
    if (!await confirmDlg('Khôi phục sổ?', 'File có ' + data.sheets.length + ' bảng, ' + nb + ' rổ (sao lưu lúc ' + new Date(data.exportedAt).toLocaleString('vi-VN') + '). Bảng trùng sẽ giữ bản mới hơn, bảng khác giữ nguyên.', 'Khôi phục')) return;
    let add = 0, upd = 0;
    for (const s of data.sheets) {
      const cur = S.sheets.find(x => x.id === s.id);
      if (!cur) { S.sheets.push(s); add++; await DB.putSheet(s); }
      else if ((s.updatedAt || 0) > (cur.updatedAt || 0)) { Object.assign(cur, s); upd++; await DB.putSheet(cur); }
    }
    const m = data.meta || {};
    (m.ponds || []).forEach(addPond);
    (m.buyers || []).forEach(b => { if (!S.meta.buyers.some(x => x.name.toLowerCase() === b.name.toLowerCase())) S.meta.buyers.push(b); });
    if (!S.meta.farm && m.farm) S.meta.farm = m.farm;
    if (!S.meta.bank.acc && m.bank && m.bank.acc) S.meta.bank = m.bank;
    await saveMeta(); render();
    toast('Đã khôi phục: thêm ' + add + ' bảng, cập nhật ' + upd + ' bảng');
  };
  rd.readAsText(file);
}

/* ================= Khởi động ================= */
async function boot() {
  await DB.open();
  const m = await DB.getMeta();
  S.meta = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_META)), m || {});
  S.meta.defaults = Object.assign({}, DEFAULT_META.defaults, S.meta.defaults || {});
  S.meta.bank = Object.assign({}, DEFAULT_META.bank, S.meta.bank || {});
  S.sheets = (await DB.allSheets()).map(s => Object.assign({ payments: [], log: [], baskets: [], entry: { mode: 'quick', decimals: 1, maxKg: 100 } }, s));
  if (!m) await saveMeta();
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
// Bàn phím thật (iPad có bàn phím rời / máy tính)
document.addEventListener('keydown', (e) => {
  if (S.view !== 'weigh' || document.querySelector('.overlay') || e.target.matches('input,textarea,select')) return;
  const s = curSheet(); if (!s || s.locked) return;
  if (/^\d$/.test(e.key)) key(e.key);
  else if (e.key === ',' || e.key === '.') key(',');
  else if (e.key === 'Backspace') key('bs');
  else if (e.key === 'Enter') { if (W.prompt && W.prompt.an.suggest) { const v = W.prompt.an.suggest; W.prompt = null; addBasket(v); } else key('go'); }
  else return;
  e.preventDefault();
});
window.SCT = { S, W, key, go, DB }; // để kiểm thử
boot();
})();
