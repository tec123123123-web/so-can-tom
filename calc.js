/* Sổ Cân Tôm — lõi tính toán (không phụ thuộc giao diện).
   Mọi khối lượng lưu dạng số nguyên "centi-kg" (1 = 0,01 kg) để không sai số làm tròn. */
(function (root) {
  'use strict';

  const toC = (kg) => Math.round(Number(kg) * 100);          // kg -> centi
  const fromC = (c) => c / 100;                               // centi -> kg

  /* ---------- Định dạng ---------- */
  function fmtKgC(c, dec) {
    // dec: số lẻ cố định (1 hoặc 2). Nếu undefined: tối đa 2, bỏ số 0 thừa.
    const neg = c < 0; c = Math.abs(c);
    let s;
    if (dec === undefined) {
      s = (c / 100).toFixed(2).replace(/\.?0+$/, '');
    } else {
      s = (c / 100).toFixed(dec);
    }
    let [i, f] = s.split('.');
    i = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + i + (f ? ',' + f : '');
  }
  function fmtMoney(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    const neg = v < 0; v = Math.abs(Math.round(v));
    return (neg ? '-' : '') + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function parseMoney(str) {
    if (str === null || str === undefined) return null;
    const d = String(str).replace(/[^\d-]/g, '');
    if (d === '' || d === '-') return null;
    return parseInt(d, 10);
  }

  /* ---------- Nhập số ký ---------- */
  function intDigitsFor(maxKg) { return maxKg >= 1000 ? 3 : maxKg >= 100 ? 2 : 1; }

  // Nhập nhanh: chỉ gõ chữ số, không dấu phẩy. Đủ số -> tự ghi.
  // Trả về { c, auto } hoặc null nếu chưa có số.
  function parseQuick(digits, dec, maxKg) {
    if (!digits) return null;
    const n = parseInt(digits, 10);
    if (isNaN(n)) return null;
    const c = dec === 2 ? n : n * 10;
    const auto = digits.length >= intDigitsFor(maxKg) + dec;
    return { c, auto };
  }
  // Nhập trực tiếp: "21,8" / "21.8" / "7"
  function parseDirect(str, dec) {
    if (!str) return null;
    const s = String(str).replace(',', '.');
    if (!/^\d*\.?\d*$/.test(s) || s === '.') return null;
    const parts = s.split('.');
    if (parts[1] && parts[1].length > dec) return null;
    const v = parseFloat(s);
    if (isNaN(v)) return null;
    return { c: toC(v), auto: false };
  }

  /* ---------- Soát số bất thường ---------- */
  function median(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  }
  // recentC: khối lượng (centi) các rổ hợp lệ gần nhất.
  // Trả về null (ổn) | {type:'big', typical, suggest} (chặn hỏi lại) | {type:'small', typical, suggest} (nhắc nhẹ)
  function checkAnomaly(c, recentC, maxKg) {
    const r = recentC.slice(-10);
    if (r.length < 3) return null;
    const t = median(r);
    if (t <= 0) return null;
    if (c > t * 3) {
      const s = Math.round(c / 10);
      if (s >= t / 2 && s <= t * 2) return { type: 'big', typical: t, suggest: s };
      return { type: 'big', typical: t, suggest: null };
    }
    if (c * 3 < t) {
      const s = c * 10;
      if (s <= maxKg * 100 && s >= t / 2 && s <= t * 2) return { type: 'small', typical: t, suggest: s };
    }
    return null;
  }

  /* ---------- Tổng hợp bảng cân ---------- */
  function activeBaskets(sheet) { return sheet.baskets.filter(b => !b.struck); }

  function columns(sheet) {
    const per = sheet.perCol || 10;
    const act = activeBaskets(sheet);
    const cols = [];
    for (let i = 0; i < act.length; i += per) {
      const items = act.slice(i, i + per);
      cols.push({ items, totalC: items.reduce((s, b) => s + b.c, 0) });
    }
    return cols;
  }

  function totals(sheet) {
    const act = activeBaskets(sheet);
    const count = act.length;
    const grossC = act.reduce((s, b) => s + b.c, 0);
    const tarePerC = sheet.kind === 'ban' ? toC(sheet.tare || 0) : 0;
    const tareC = tarePerC * count;
    const afterTareC = grossC - tareC;
    const pct = sheet.kind === 'ban' ? Number(sheet.deductPct || 0) : 0;
    const deductC = Math.round(afterTareC * pct / 100);
    const netC = afterTareC - deductC;
    const priced = sheet.kind === 'ban' && sheet.price !== null && sheet.price !== undefined && sheet.price !== '';
    const money = priced ? Math.round(netC * Number(sheet.price) / 100) : null;
    const deposit = Number(sheet.deposit || 0);
    const paidSum = (sheet.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    const paid = deposit + paidSum;
    const remain = money === null ? null : money - paid;
    const struck = sheet.baskets.filter(b => b.struck);
    return { count, grossC, tarePerC, tareC, afterTareC, pct, deductC, netC, priced, money, deposit, paidSum, paid, remain,
             struckCount: struck.length, struckC: struck.reduce((s, b) => s + b.c, 0) };
  }

  /* ---------- Phiếu chữ (gửi Zalo) ---------- */
  function receiptText(sheet, opts) {
    opts = opts || {};
    const dec = sheet.entry && sheet.entry.decimals || 1;
    const t = totals(sheet);
    const L = [];
    const isBan = sheet.kind === 'ban';
    L.push(isBan ? 'PHIẾU CÂN TÔM' : 'PHIẾU SANG TÔM');
    L.push((opts.name || sheet.name || (isBan ? 'Bảng cân' : 'Sang tôm')) + ' — ' + fmtDate(sheet.date));
    if (opts.farm) L.push('Trại: ' + opts.farm);
    if (isBan) {
      if (sheet.pond) L.push('Ao: ' + sheet.pond);
      if (sheet.buyerName) L.push('Thương lái: ' + sheet.buyerName + (sheet.buyerPhone ? ' (' + sheet.buyerPhone + ')' : ''));
      if (sheet.size) L.push('Cỡ: ' + sheet.size);
    } else {
      L.push('Từ ao: ' + (sheet.pond || '—') + '  →  Sang ao: ' + (sheet.toPond || '—'));
      if (sheet.size) L.push('Cỡ: ' + sheet.size);
    }
    L.push('------------------------------');
    const cols = columns(sheet);
    cols.forEach((col, i) => {
      L.push('Cột ' + String(i + 1).padStart(2, '0') + ': ' + col.items.map(b => fmtKgC(b.c, dec)).join(' | ') + '  = ' + fmtKgC(col.totalC, dec));
    });
    L.push('------------------------------');
    L.push('Số rổ: ' + t.count);
    L.push('Tổng cân: ' + fmtKgC(t.grossC, dec) + ' kg');
    if (isBan) {
      if (t.tareC) L.push('Trừ bì: ' + t.count + ' rổ × ' + fmtKgC(t.tarePerC) + ' = ' + fmtKgC(t.tareC) + ' kg');
      if (t.deductC) L.push('Trừ ' + String(t.pct).replace('.', ',') + '%: ' + fmtKgC(t.deductC) + ' kg');
      if (t.tareC || t.deductC) L.push('Còn tính tiền: ' + fmtKgC(t.netC) + ' kg');
      if (t.priced) {
        L.push('Đơn giá: ' + fmtMoney(sheet.price) + ' đ/kg');
        L.push('THÀNH TIỀN: ' + fmtMoney(t.money) + ' đ');
        if (t.deposit) L.push('Đã cọc: ' + fmtMoney(t.deposit) + ' đ');
        (sheet.payments || []).forEach(p => L.push('Đã trả ' + fmtDate(p.date) + ': ' + fmtMoney(p.amount) + ' đ'));
        if (t.paid) L.push('CÒN LẠI: ' + fmtMoney(t.remain) + ' đ');
      } else {
        L.push('Giá: CHƯA CHỐT GIÁ');
        if (t.deposit) L.push('Đã cọc: ' + fmtMoney(t.deposit) + ' đ');
      }
    }
    if (t.struckCount) L.push('(Đã gạch ' + t.struckCount + ' rổ, ' + fmtKgC(t.struckC, dec) + ' kg — không tính)');
    if (sheet.note) L.push('Ghi chú: ' + sheet.note);
    return L.join('\n');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return d + '/' + m + '/' + y;
  }

  /* ---------- VietQR (chuẩn EMVCo / NAPAS 247) — tạo offline ---------- */
  const BANKS = [
    ['970436', 'Vietcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'], ['970405', 'Agribank'],
    ['970407', 'Techcombank'], ['970422', 'MB Bank'], ['970416', 'ACB'], ['970432', 'VPBank'],
    ['970403', 'Sacombank'], ['970423', 'TPBank'], ['970441', 'VIB'], ['970443', 'SHB'],
    ['970437', 'HDBank'], ['970448', 'OCB'], ['970426', 'MSB'], ['970440', 'SeABank'],
    ['970449', 'LPBank'], ['970431', 'Eximbank'], ['970428', 'Nam A Bank'], ['970409', 'Bac A Bank'],
    ['970452', 'KienlongBank'], ['970454', 'Viet Capital Bank'], ['970429', 'SCB'], ['970400', 'Saigonbank']
  ];
  function stripVN(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function tlv(id, v) { return id + String(v.length).padStart(2, '0') + v; }
  function crc16(s) {
    let crc = 0xFFFF;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function vietQR(bin, account, amount, note) {
    if (!bin || !account) return null;
    const acc = String(account).replace(/\s/g, '');
    const mai = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', acc)) + tlv('02', 'QRIBFTTA');
    let p = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('38', mai) + tlv('53', '704');
    if (amount) p += tlv('54', String(Math.round(amount)));
    p += tlv('58', 'VN');
    const n = stripVN(note).slice(0, 25);
    if (n) p += tlv('62', tlv('08', n));
    p += '6304';
    return p + crc16(p);
  }

  const api = { BANKS, stripVN, crc16, vietQR, toC, fromC, fmtKgC, fmtMoney, parseMoney, parseQuick, parseDirect, intDigitsFor, median,
                checkAnomaly, activeBaskets, columns, totals, receiptText, fmtDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
