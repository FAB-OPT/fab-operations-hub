/* =======================================================================
   feedback-import.js — แปลงไฟล์ดิบจากแพลตฟอร์มแบบสำรวจ (rawdata_*.xlsx ชีต "Raw Data")
   เป็นแถวคอมเมนต์ + CSAT/NPS รายเดือน สำหรับ "ชุดตรวจสอบ" (ยังไม่ลงระบบจนกว่าแอดมินอนุมัติ)

   1 ใบสำรวจ → ได้ถึง 3 แถว:  csat_pos → พอใจ · csat_neg → ไม่พอใจ · Suggestion → ข้อเสนอแนะ (ข้ามไว้ก่อน)
   หัวข้อ = หมวดแรกของใบนั้น (poscat1 / negcat1 / sugcat1) แปลงเป็นหัวข้อย่อย/หลักชุดเดียวกับแดชบอร์ด VOC
   CSAT = คะแนนเฉลี่ย x10 · NPS = %ผู้ให้ 9-10 − %ผู้ให้ 0-6   (รายเดือน ต่อ BZM; FS ต่อ Owner)
   ======================================================================= */
(function (global) {
  "use strict";

  var clean = function (s) { return s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); };
  var person = function (s) { return clean(s).replace(/\s*\(\s*/, ' (').replace(/\s*\)/, ')'); };

  var M_Q = 'หมวดคุณภาพ', M_S = 'หมวดพนักงานและการบริการ', M_O = 'หมวดอื่นๆ';
  /* ชื่อหมวดจากแพลตฟอร์ม → [หัวข้อย่อย, หัวข้อหลัก, หมวดใหม่?]
     ที่ใช้อยู่ในแดชบอร์ดเดิม (ชีต Google) = ใช้ชื่อเดิมทุกตัวอักษร · หมวดที่แดชบอร์ดไม่เคยมี = true (ติดธง "หมวดใหม่" ให้แอดมินตรวจ) */
  var CAT = {
    'Staff Attentiveness': ['Staff Attentiveness (ความเอาใจใส่ของพนักงาน)', M_S],
    'Staff Manner': ['Staff Manner (มารยาทของพนักงาน)', M_S],
    'Staff Service Quality': ['Staff Service Quality (คุณภาพการบริการ)', M_S],
    'Staff Knowledge and Competency': ['Staff Knowledge and Competency (ความเข้าใจในสินค้าและวัตถุดิบของพนักงาน)', M_S],
    'Staff Recommendation': ['Staff Benefit Suggestion (การแนะนำสินค้าและบริการ)', M_S],
    'Staff Speed': ['Convenience and Speed (ความรวดเร็วในการบริการ)', M_S],
    'Overall Service': ['Overall Service (การบริการโดยรวม)', M_S],
    'Staff Availability': ['Staff Availability (จำนวนพนักงานให้บริการ)', M_S, true],
    'Queue Time': ['Queue Time (เวลารอคิว)', M_S, true],
    'Ordering System': ['Ordering System (ระบบสั่งอาหาร)', M_S, true],
    'Food Taste': ['Food Taste (รสชาติอาหาร)', M_Q],
    'Cooked Food Quality': ['Cooked Food Quality (คุณภาพของอาหาร)', M_Q],
    'Food Waiting Time': ['Food Waiting Time (เวลารออาหาร)', M_Q],
    'Food Freshness': ['Food Freshness & Expiry Date (ความสดใหม่ของอาหาร)', M_Q],
    'Food Hygiene': ['Food Hygiene and Cleanliness  (สุขอนามัยของอาหาร)', M_Q],
    'Food Ingredient': ['Food Raw Material (วัตถุดิบ)', M_Q],
    'Food Portion': ['Food Portion (ส่วนประกอบของอาหาร)', M_Q],
    'Food Variety': ['Food Range Variety (ความหลากหลายของอาหาร)', M_Q],
    'Food Overall': ['Food Overall (อาหารโดยรวม)', M_Q, true],
    'Food Temperature': ['Food Temperature (อุณหภูมิอาหาร)', M_Q, true],
    'Food Presentation': ['Food Presentation (การจัดจานอาหาร)', M_Q, true],
    'Food Availability': ['Food Availability (อาหารหมด/ไม่มีเมนู)', M_Q, true],
    'Food Container and Cutlery': ['Food Container and Cutlery (ภาชนะและอุปกรณ์)', M_Q, true],
    'Cleanliness': ['Cleanliness (ความสะอาด)', M_O],
    'Dining Facility': ['Dining Facility (สิ่งอำนวยความสะดวก)', M_O],
    'Price': ['Price (ราคาอาหาร)', M_O],
    'Restaurant Policy': ['Restaurant Policy (นโยบายร้าน)', M_O],
    'Promotion': ['Other Promotion (โปรโมชั่นอื่นๆ)', M_O],
    'Atmosphere': ['Atmosphere (บรรยากาศ)', M_O, true],
    'Style and layout': ['Style and Layout (การตกแต่งและผังร้าน)', M_O, true],
    'Sound': ['Sound (เสียงในร้าน)', M_O, true],
    'Brightness': ['Brightness (แสงสว่าง)', M_O, true],
    'Temperature': ['Temperature (อุณหภูมิในร้าน)', M_O, true],
    'Location Access Convenience': ['Location Access Convenience (การเดินทาง/ที่ตั้ง)', M_O, true],
    'Branch Number': ['Branch Number (จำนวนสาขา)', M_O, true],
    'Payment': ['Payment (การชำระเงิน)', M_O, true],
    'Loyalty Program': ['Loyalty Program (สะสมแต้ม/สมาชิก)', M_O, true],
    'Giveaway': ['Giveaway (ของแถม)', M_O, true],
    'Special Deal': ['Special Deal (ดีลพิเศษ)', M_O, true],
    'Promotion Frequency': ['Promotion Frequency (ความถี่โปรโมชั่น)', M_O, true],
    'Discount': ['Discount (ส่วนลด)', M_O, true],
    'Advertising': ['Advertising (การโฆษณา)', M_O, true],
    'Signage': ['Signage (ป้ายร้าน)', M_O, true],
    'Miscellaneous': ['Miscellaneous (อื่นๆ)', M_O, true]
  };

  var KNOWN_SUB = {};
  Object.keys(CAT).forEach(function (k) { if (!CAT[k][2]) KNOWN_SUB[CAT[k][0]] = 1; });

  var NOISE = /^(?:[-.\s_/\\]*|ไม่มี(?:ค่ะ|ครับ|คะ|ครับผม|อะไร|ละ|แล้ว)?|ยังไม่มี|ไม่|ไม่ค่ะ|ไม่ครับ|no|none|n\/a|na|nil|ok|-+)$/i;
  var PHONE = /(?<![\d])(?:\+?66|0)\d{1,2}[-\s.]?\d{3}[-\s.]?\d{3,4}(?![\d])/g;
  var EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

  function isNoise(t) { var s = clean(t); return s.length < 2 || NOISE.test(s); }
  function maskPii(t) {
    var hit = false;
    var out = String(t).replace(EMAIL, function () { hit = true; return '[อีเมล]'; })
      .replace(PHONE, function () { hit = true; return '[เบอร์โทร]'; });
    return { text: out, masked: hit };
  }
  function hasPii(t) { PHONE.lastIndex = 0; EMAIL.lastIndex = 0; var r = PHONE.test(String(t)) || EMAIL.test(String(t)); PHONE.lastIndex = 0; EMAIL.lastIndex = 0; return r; }

  function pad(n) { return String(n).padStart(2, '0'); }
  function parseDT(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      var ms = Math.round((v - 25569) * 864e5), dt = new Date(ms);
      return { d: dt.toISOString().slice(0, 10), t: pad(dt.getUTCHours()) + ':' + pad(dt.getUTCMinutes()) };
    }
    var s = String(v).trim(), x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (x) return { d: x[1] + '-' + pad(x[2]) + '-' + pad(x[3]), t: x[4] ? pad(x[4]) + ':' + x[5] : '' };
    x = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (x) { var y = +x[3]; if (y > 2400) y -= 543; return { d: y + '-' + pad(x[2]) + '-' + pad(x[1]), t: x[4] ? pad(x[4]) + ':' + x[5] : '' }; }
    return null;
  }
  function brandOf(type, brand) {
    var u = (clean(type) + ' ' + clean(brand)).toUpperCase();
    if (/\bKT\b|-\s*KT\b/.test(u)) return 'KT';
    if (/\bFS\b|-\s*FS\b/.test(u)) return 'FS';
    if (/เจ๊แดง|JAEDAENG|\bJD\b/.test(u.replace(/\s/g, ' ')) || /เจ๊แดง/.test(clean(type))) return 'JD';
    return '';
  }
  function catOf(cats) {
    var list = cats.map(clean).filter(function (c) { return c && c.toLowerCase() !== 'none'; });
    if (!list.length) return { sub: '', main: '', newcat: false, more: [] };
    var hit = CAT[list[0]];
    if (hit) return { sub: hit[0], main: hit[1], newcat: !!hit[2], more: list.slice(1) };
    return { sub: list[0], main: M_O, newcat: true, more: list.slice(1) };
  }
  var r1 = function (x) { return Math.round(x * 10) / 10; };

  /* aoa = แถวของชีต Raw Data (แถวแรกเป็นหัวคอลัมน์) · opts.skipSrc = {src_id:1} ที่เคยนำเข้าแล้ว */
  function parseRaw(aoa, opts) {
    opts = opts || {};
    var hi = -1;
    for (var i = 0; i < Math.min(aoa.length, 10); i++) {
      var h = (aoa[i] || []).map(clean);
      if (h.indexOf('RD ID') >= 0 && h.indexOf('csat') >= 0) { hi = i; break; }
    }
    if (hi < 0) throw new Error('ไม่พบหัวคอลัมน์ RD ID / csat — ต้องเป็นชีต "Raw Data" จากไฟล์ rawdata');
    var H = aoa[hi].map(clean), ix = function (n) { return H.indexOf(n); };
    var C = {
      rd: ix('RD ID'), bid: ix('Branch ID'), bname: ix('Branch Name'), btype: ix('Branch Type'), brand: ix('Brand'), zone: ix('Branch Zone'),
      td: ix('Transaction Date'), cd: ix('Completed Date'), csat: ix('csat'), nps: ix('nps'),
      pos: ix('csat_pos'), neg: ix('csat_neg'), sug: ix('Suggestion')
    };
    ['rd', 'bid', 'btype', 'csat', 'pos', 'neg', 'sug'].forEach(function (k) { if (C[k] < 0) throw new Error('ไฟล์ขาดคอลัมน์ที่ต้องใช้: ' + k); });
    var cat = function (p) { var a = []; for (var k = 1; k <= 5; k++) { var j = ix(p + k); if (j >= 0) a.push(j); } return a; };
    var P = cat('poscat'), N = cat('negcat'), S = cat('sugcat');
    var skip = opts.skipSrc || {};

    var st = { responses: 0, noBrand: 0, noDate: 0, dupSrc: 0, sugEmpty: 0, noise: 0, dupText: 0, masked: 0, byBrand: { KT: 0, FS: 0, JD: 0 }, types: { 'พอใจ': 0, 'ไม่พอใจ': 0, 'ข้อเสนอแนะ': 0 }, newcat: {}, dmin: '9999', dmax: '0000' };
    var rows = [], seen = {}, agg = {};

    for (var r = hi + 1; r < aoa.length; r++) {
      var a = aoa[r]; if (!a) continue;
      var rd = clean(a[C.rd]); if (!rd) continue;
      st.responses++;
      var b = brandOf(a[C.btype], C.brand >= 0 ? a[C.brand] : '');
      if (!b) { st.noBrand++; continue; }
      var dt = parseDT(a[C.td]) || parseDT(C.cd >= 0 ? a[C.cd] : null);
      if (!dt) { st.noDate++; continue; }
      if (dt.d < st.dmin) st.dmin = dt.d; if (dt.d > st.dmax) st.dmax = dt.d;
      var code = clean(a[C.bid]), br = (code + ' ' + clean(C.bname >= 0 ? a[C.bname] : '')).trim();
      var zone = clean(C.zone >= 0 ? a[C.zone] : '');
      var z = b === 'FS' ? '' : person(zone), o = b === 'FS' ? zone : '';
      var score = a[C.csat] === '' || a[C.csat] == null || isNaN(+a[C.csat]) ? null : +a[C.csat];

      /* CSAT / NPS รายเดือน — นับทุกใบสำรวจ ไม่ว่าจะมีคอมเมนต์หรือไม่ */
      var k = b === 'FS' ? zone : person(zone);
      if (k && score != null) {
        var ak = b + '|' + k + '|' + dt.d.slice(0, 7), g = agg[ak] || (agg[ak] = { b: b, k: k, n: 0, sum: 0, nn: 0, pro: 0, det: 0, d1: dt.d, d2: dt.d });
        g.n++; g.sum += score;
        var np = a[C.nps] === '' || a[C.nps] == null || isNaN(+a[C.nps]) ? null : +a[C.nps];
        if (np != null) { g.nn++; if (np >= 9) g.pro++; else if (np <= 6) g.det++; }
        if (dt.d < g.d1) g.d1 = dt.d; if (dt.d > g.d2) g.d2 = dt.d;
      }

      var kinds = [['p', a[C.pos], P, 'พอใจ'], ['n', a[C.neg], N, 'ไม่พอใจ'], ['s', a[C.sug], S, 'ข้อเสนอแนะ']];
      kinds.forEach(function (kd) {
        var text = clean(kd[1]); if (!text) return;
        var isSug = kd[0] === 's', noise = isNoise(text);
        if (isSug && noise) { st.sugEmpty++; return; }                 // "ไม่มี" "-" ในช่องข้อเสนอแนะ = ไม่มีเนื้อหา ไม่สร้างแถว
        var src = rd + '|' + kd[0];
        if (skip[src]) { st.dupSrc++; return; }
        var m = maskPii(text); if (m.masked) st.masked++;
        var c = catOf(kd[2].map(function (j) { return a[j]; }));
        if (c.newcat) st.newcat[c.sub] = (st.newcat[c.sub] || 0) + 1;
        var key = b + '|' + dt.d + '|' + code + '|' + kd[0] + '|' + m.text.toLowerCase();
        var dup = !!seen[key]; seen[key] = 1; if (dup) st.dupText++;
        if (noise && !isSug) st.noise++;
        var state = (isSug || noise || dup) ? 'drop' : 'staging';
        var extra = {};
        if (m.masked) extra.masked = true; if (c.newcat) extra.newcat = true; if (dup) extra.dup = true; if (noise) extra.noise = true;
        if (c.more.length) extra.cats = c.more;
        rows.push({ src_id: src, state: state, b: b, d: dt.d, t: dt.t, ty: kd[3], br: br, z: z, o: o, s: score, c: m.text, sub: c.sub, main: c.main, extra: extra, edited: false });
        st.byBrand[b]++; st.types[kd[3]]++;
      });
    }

    var csat = Object.keys(agg).map(function (key) {
      var g = agg[key];
      return { state: 'staging', b: g.b, k: g.k, d_from: g.d1, d_to: g.d2, n: g.n, cs: r1(g.sum / g.n * 10), np: g.nn ? r1((g.pro - g.det) / g.nn * 100) : 0, edited: false };
    }).sort(function (x, y) { return (x.b + x.k + x.d_from).localeCompare(y.b + y.k + y.d_from, 'th'); });

    return { rows: rows, csat: csat, stats: st };
  }


  /* ───────── Facebook: ไฟล์ "สรุป_Complain_FB" (ชีต "รายละเอียด Complaint" + ชีต "สาขา") ─────────
     1 เคส = 1 แถว (ประเภท ไม่พอใจ = ข้อร้องเรียน) · หมวดตามช่องที่ทำเครื่องหมายในไฟล์ (คุณภาพ/บริการ/ความสะอาด/ความเร็ว/อื่นๆ)
     มีวันที่ปิดเคส = ปิดเรื่องแล้ว · สถานะ/ผู้รับผิดชอบ/ค่าใช้จ่าย/เลขที่เอกสาร เก็บใน extra */
  var FB_CATS = [['คุณภาพ', 'คุณภาพอาหาร'], ['บริการ', 'การบริการ'], ['ความสะอาด', 'ความสะอาด'], ['ความเร็ว', 'ความเร็ว'], ['อื่นๆ', 'อื่นๆ']];
  function hash(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function parseFb(aoa, branchAoa, opts) {
    opts = opts || {};
    var hi = -1;
    for (var i = 0; i < Math.min(aoa.length, 12); i++) {
      var h = (aoa[i] || []).map(clean);
      if (h.indexOf('complain') >= 0 && h.indexOf('รหัส') >= 0) { hi = i; break; }
    }
    if (hi < 0) throw new Error('ไม่พบหัวคอลัมน์ complain / รหัส — ต้องเป็นชีต "รายละเอียด Complaint" จากไฟล์สรุป Complain FB');
    var H = aoa[hi].map(clean), ix = function (n) { return H.indexOf(n); };
    var C = { brand: ix('แบรนด์'), d: ix('วันที่'), code: ix('รหัส'), br: ix('สาขา'), t: ix('complain'), cost: ix('ค่าใช้จ่าย'), doc: ix('เลขที่เอกสาร'), sev: ix('ระดับความรุนแรง'), closed: ix('วันที่ปิดเคส'), days: ix('จำนวนวันรวม'), note: ix('หมายเหตุ'), raw: ix('สเต๊กไม่สุก') };
    var cats = FB_CATS.map(function (c) { return [ix(c[0]), c[1]]; }).filter(function (c) { return c[0] >= 0; });
    var reg = {};
    (branchAoa || []).forEach(function (r, k) { if (k && r && /^\d{4}$/.test(clean(r[0]))) reg[clean(r[0])] = { name: clean(r[1]), bzm: clean(r[2]) }; });
    var skip = opts.skipSrc || {}, st = { cases: 0, dupSrc: 0, noBrand: 0, noDate: 0, dmin: '9999', dmax: '0000', byBrand: { KT: 0, FS: 0, JD: 0 }, closed: 0, nocat: 0 };
    var rows = [], seen = {};
    for (var r = hi + 1; r < aoa.length; r++) {
      var a = aoa[r]; if (!a) continue;
      var text = clean(a[C.t]); if (!text) continue;
      st.cases++;
      var code = clean(a[C.code]), b = brandOf(a[C.brand], '') || (/^8/.test(code) ? 'FS' : /^5/.test(code) ? 'KT' : '');
      if (!b) { st.noBrand++; continue; }
      var dt = parseDT(a[C.d]); if (!dt) { st.noDate++; continue; }
      if (dt.d < st.dmin) st.dmin = dt.d; if (dt.d > st.dmax) st.dmax = dt.d;
      var m = maskPii(text), c = [];
      cats.forEach(function (k) { var v = a[k[0]]; if (v != null && clean(v) !== '' && clean(v) !== '0') c.push(k[1]); });
      var raw = C.raw >= 0 && a[C.raw] != null && clean(a[C.raw]) !== '' && clean(a[C.raw]) !== '0';
      if (!c.length) st.nocat++;
      var info = reg[code] || {}, closed = C.closed >= 0 ? parseDT(a[C.closed]) : null;
      if (!closed && C.closed >= 0 && clean(a[C.closed])) closed = { d: clean(a[C.closed]) };
      var extra = { status: closed ? 'done' : 'new' };
      if (closed) { extra.closedAt = closed.d; st.closed++; }
      if (C.cost >= 0 && clean(a[C.cost])) extra.cost = clean(a[C.cost]);
      if (C.doc >= 0 && clean(a[C.doc])) extra.docNo = clean(a[C.doc]);
      if (C.sev >= 0 && clean(a[C.sev])) extra.severity = clean(a[C.sev]);
      if (C.days >= 0 && clean(a[C.days])) extra.days = clean(a[C.days]);
      if (C.note >= 0 && clean(a[C.note])) extra.note = clean(a[C.note]);
      if (raw) extra.undercooked = true;
      if (c.length > 1) extra.cats = c.slice(1);
      if (m.masked) extra.masked = true;
      var src = 'fb|' + dt.d + '|' + code + '|' + hash(m.text.toLowerCase()), n = (seen[src] = (seen[src] || 0) + 1);
      if (n > 1) src += '#' + n;
      if (skip[src]) { st.dupSrc++; continue; }
      var nm = info.name || clean(a[C.br]);
      rows.push({ src_id: src, state: 'staging', b: b, d: dt.d, t: '', ty: 'ไม่พอใจ', br: (code + ' ' + nm).trim(), z: info.bzm || '', o: '', s: null, c: m.text, sub: c[0] || '', main: '', extra: extra, edited: false });
      st.byBrand[b]++;
    }
    return { rows: rows, csat: [], stats: st };
  }

  /* ธงที่คำนวณสดจากเนื้อหาปัจจุบันของแถว (แก้แล้วธงหายเอง) */
  var FLAG_LABEL = {
    pii: 'อาจมีข้อมูลส่วนตัว', noise: 'ข้อความไม่มีเนื้อหา', nosub: 'ไม่มีหัวข้อ', nobranch: 'สาขาไม่อยู่ในทะเบียนฮับ',
    noz: 'ไม่มี BZM', newcat: 'หมวดใหม่', dup: 'ซ้ำ', sug: 'ข้อเสนอแนะ', badty: 'ประเภทไม่ถูกต้อง'
  };
  function flagsOf(r, hubCodes) {
    var f = [], ex = r.extra || {};
    if (hasPii(r.c)) f.push('pii');
    if (isNoise(r.c)) f.push('noise');
    if (!r.sub) f.push('nosub');
    if (r.b === 'KT' && hubCodes && hubCodes.size) { var m = String(r.br).match(/^(\d{4})/); if (!m || !hubCodes.has(m[1])) f.push('nobranch'); }
    if (!r.z && !r.o) f.push('noz');      /* FS: ไฟล์ดิบมีชื่อผู้ติดต่อของโซน (ใส่ช่อง Owner ให้แล้ว) แต่ไม่มี BZM */
    if (ex.newcat && r.sub && !KNOWN_SUB[r.sub]) f.push('newcat');
    if (ex.dup) f.push('dup');
    if (r.ty === 'ข้อเสนอแนะ') f.push('sug');
    else if (r.ty !== 'พอใจ' && r.ty !== 'ไม่พอใจ') f.push('badty');
    return f;
  }

  var api = { parseRaw: parseRaw, parseFb: parseFb, FB_CATS: FB_CATS, flagsOf: flagsOf, FLAG_LABEL: FLAG_LABEL, CAT: CAT, isNoise: isNoise, maskPii: maskPii, hasPii: hasPii, parseDT: parseDT, MAINS: [M_Q, M_S, M_O] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else global.FBImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
