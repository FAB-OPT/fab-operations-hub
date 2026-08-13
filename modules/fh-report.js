/* ═══════════════════════════════════════════════════════════════
   ตัวออกรายงานใบรับรอง — เลือกช่วงข้อมูลและคอลัมน์เอง แล้วออกได้ทั้ง Excel/PDF
   เดิม: ปุ่มออกรายงานยึดตัวกรองบนหน้าจอเท่านั้น และคอลัมน์ตายตัว 10 ช่อง
   ใครอยากได้แค่สาขาเดียว หรือเอาแค่ 4 ช่อง ต้องไปลบเองใน Excel ทุกครั้ง
   ═══════════════════════════════════════════════════════════════ */

/* วันที่ในฐานข้อมูลเก็บเป็นค่าดิบแบบ ISO ("2569-06-11T17:00:00.000Z")
   ถ้าเอามาลงรายงานตรง ๆ จะได้ข้อความยาว 24 ตัวอักษร ล้นออกนอกช่องไปทับคอลัมน์ข้าง ๆ
   ใช้ตัวจัดรูปแบบตัวเดียวกับที่หน้าจอใช้ ตัวเลขในรายงานจะได้ตรงกับที่เห็นบนเว็บ */
function _crpDate(v) {
  if (!v) return '';
  try { if (typeof formatThaiDate === 'function') return formatThaiDate(v); } catch (e) {}
  return String(v).slice(0, 10);
}

var _FH_RPT_ST = { expired: 'หมดอายุ', warning: 'ใกล้หมดอายุ' };
var _FH_RPT_MT = { exact: 'ตรงกับทะเบียน', lastname: 'นามสกุลตรง' };

/* นิยามคอลัมน์ไว้ที่เดียว — Excel กับ PDF ใช้ชุดเดียวกัน จะได้ไม่หลุดกันทีหลัง
   pdfW เป็น "น้ำหนัก" ไม่ใช่เปอร์เซ็นต์ตายตัว เพราะผู้ใช้เลือกคอลัมน์เองได้
   ถ้าตรึงเป็น % ไว้ พอเลือกแค่ 3 ช่อง ตารางจะกินแค่ครึ่งหน้าแล้วเหลือขาว ๆ
   จึงคิดสัดส่วนจากชุดที่เลือกจริงตอนสร้างรายงาน */
var FH_RPT_COLS = [
  { k: 'no',     label: 'ลำดับ',                    w: 7,  pdfW: 4,  get: function (d, i) { return i + 1; } },
  { k: 'cert',   label: 'ชื่อ-นามสกุล (ในใบรับรอง)', w: 30, pdfW: 17, get: function (d) { return d.certName; } },
  { k: 'emp',    label: 'ชื่อในทะเบียน',            w: 30, pdfW: 15, get: function (d) { return d.empName; } },
  { k: 'brand',  label: 'แบรนด์',                   w: 16, pdfW: 9,  get: function (d) { return _certBrand(d); } },
  { k: 'branch', label: 'สาขา',                     w: 32, pdfW: 16, get: function (d) { return d.branch; } },
  { k: 'pos',    label: 'ตำแหน่ง',                  w: 18, pdfW: 10, get: function (d) { return d.position; } },
  { k: 'course', label: 'หลักสูตร',                 w: 40, pdfW: 18, get: function (d) { return d.course; } },
  { k: 'train',  label: 'วันที่อบรม',               w: 14, pdfW: 9,  get: function (d) { return _crpDate(d.trainDate); } },
  { k: 'exp',    label: 'วันหมดอายุ',               w: 14, pdfW: 9,  get: function (d) { return _crpDate(d.expireDate); } },
  { k: 'stat',   label: 'สถานะ',                    w: 14, pdfW: 8,  get: function (d) { return _FH_RPT_ST[d.expStatus] || 'ยังมีผล'; } },
  { k: 'match',  label: 'ผลจับคู่',                 w: 16, pdfW: 10, get: function (d) { return _FH_RPT_MT[d.matchType] || 'ยังไม่พบในทะเบียน'; } }
];
/* ค่าตั้งต้น = ช่องที่ใช้จริงเกือบทุกครั้ง · ที่เหลือติ๊กเพิ่มเอง */
var _FH_RPT_DEFAULT = ['no', 'cert', 'brand', 'branch', 'pos', 'course', 'train', 'exp', 'stat'];

function _crpRows() {
  return (typeof matchData !== 'undefined' && matchData) ? matchData : [];
}
function _crpVal(id) { var el = document.getElementById(id); return el ? el.value : 'all'; }

/* กรองตามที่เลือกในกล่องนี้เท่านั้น ไม่ผูกกับตัวกรองบนหน้าจอ
   จะได้ออกรายงานสาขาอื่นโดยไม่ต้องไปเปลี่ยนสิ่งที่กำลังดูอยู่ */
function _crpFiltered() {
  var brand = _crpVal('crpBrand'), branch = _crpVal('crpBranch');
  var course = _crpVal('crpCourse'), stat = _crpVal('crpStatus');
  return _crpRows().filter(function (d) {
    if (brand !== 'all' && _certBrand(d) !== brand) return false;
    if (branch !== 'all' && String(d.branch || '') !== branch) return false;
    if (course !== 'all' && String(d.course || '') !== course) return false;
    if (stat !== 'all') {
      var st = d.expStatus === 'expired' ? 'expired' : d.expStatus === 'warning' ? 'warning' : 'valid';
      if (st !== stat) return false;
    }
    return true;
  });
}
function _crpChosenCols() {
  var out = [];
  FH_RPT_COLS.forEach(function (c) {
    var el = document.getElementById('crpcol-' + c.k);
    if (el && el.checked) out.push(c);
  });
  return out;
}
function _crpUniq(rows, fn) {
  var seen = {}, out = [];
  rows.forEach(function (d) {
    var v = String(fn(d) || '').trim();
    if (!v || v === '—' || seen[v]) return;
    seen[v] = 1; out.push(v);
  });
  return out.sort(function (a, b) { return a.localeCompare(b, 'th'); });
}
function _crpFillSelect(id, values, allLabel) {
  var el = document.getElementById(id);
  if (!el) return;
  var cur = el.value;
  var opts = ['<option value="all">' + allLabel + ' (' + values.length + ')</option>'];
  values.forEach(function (v) {
    opts.push('<option value="' + escapeAttr(v) + '">' + escapeHtml(v) + '</option>');
  });
  el.innerHTML = opts.join('');
  if (cur && values.indexOf(cur) >= 0) el.value = cur;
}
/* เลือกแบรนด์แล้ว รายการสาขาต้องเหลือเฉพาะของแบรนด์นั้น
   ไม่งั้นจะเลือกสาขาที่ไม่มีในแบรนด์ แล้วได้รายงานเปล่าโดยไม่รู้สาเหตุ */
function _crpOnBrandChange() {
  var brand = _crpVal('crpBrand');
  var pool = brand === 'all' ? _crpRows() : _crpRows().filter(function (d) { return _certBrand(d) === brand; });
  var el = document.getElementById('crpBranch');
  var cur = el ? el.value : 'all';
  var list = _crpUniq(pool, function (d) { return d.branch; });
  _crpFillSelect('crpBranch', list, 'ทุกสาขา');
  if (el && cur !== 'all' && list.indexOf(cur) < 0) el.value = 'all';
  _crpPreview();
}
function _crpPreview() {
  var n = _crpFiltered().length, cols = _crpChosenCols().length;
  var el = document.getElementById('crpCount');
  if (!el) return;
  if (!cols) { el.innerHTML = '<span class="crp-zero">ยังไม่ได้เลือกคอลัมน์ — ติ๊กอย่างน้อย 1 ช่อง</span>'; return; }
  el.innerHTML = n
    ? 'จะได้ <b>' + n + '</b> รายการ · <b>' + cols + '</b> คอลัมน์'
    : '<span class="crp-zero">ไม่มีรายการตามที่เลือก — ลองขยายช่วงข้อมูล</span>';
}
function _crpAllCols(on) {
  FH_RPT_COLS.forEach(function (c) {
    var el = document.getElementById('crpcol-' + c.k);
    if (el) el.checked = !!on;
  });
  _crpPreview();
}

/* want = รูปแบบที่กดเข้ามา ('pdf' / 'excel') — ใช้เน้นปุ่มให้ตรงกับที่ตั้งใจ
   ยังกดอีกปุ่มได้อยู่ เผื่อเปลี่ยนใจตอนเลือกเสร็จแล้ว ไม่ต้องปิดแล้วเปิดใหม่ */
function openCertReport(want) {
  if (!_crpRows().length) { showInfo('ไม่มีข้อมูล', 'ยังไม่มีใบรับรองให้ออกรายงาน'); return; }
  var bx = document.getElementById('crpBtnExcel'), bp = document.getElementById('crpBtnPdf');
  if (bx && bp) {
    var pdfFirst = (want === 'pdf');
    bx.classList.toggle('crp-main', !pdfFirst);
    bp.classList.toggle('crp-main', pdfFirst);
  }
  var box = document.getElementById('crpCols');
  if (box) {
    box.innerHTML = FH_RPT_COLS.map(function (c) {
      var on = _FH_RPT_DEFAULT.indexOf(c.k) >= 0 ? ' checked' : '';
      return '<label class="crp-col"><input type="checkbox" id="crpcol-' + c.k + '"' + on
           + ' onchange="_crpPreview()"><span>' + escapeHtml(c.label) + '</span></label>';
    }).join('');
  }
  _crpFillSelect('crpBrand',  _crpUniq(_crpRows(), function (d) { return _certBrand(d); }), 'ทุกแบรนด์');
  _crpFillSelect('crpCourse', _crpUniq(_crpRows(), function (d) { return d.course; }),      'ทุกหลักสูตร');
  _crpOnBrandChange();
  var m = document.getElementById('certReportModal');
  if (m) m.classList.add('show');
}
function closeCertReport() {
  var m = document.getElementById('certReportModal');
  if (m) m.classList.remove('show');
}

/* บอกให้ชัดว่ารายงานใบนี้เป็นของชุดไหน ไม่งั้นพิมพ์ออกมาแล้วไม่รู้ว่ากรองอะไรไว้ */
function _crpScopeText() {
  var out = [];
  ['crpBrand', 'crpBranch', 'crpCourse', 'crpStatus'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el && el.value && el.value !== 'all') out.push(el.options[el.selectedIndex].text);
  });
  return out.length ? out.join(' · ') : 'ทั้งหมด';
}

function crpExport(kind) {
  var rows = _crpFiltered(), cols = _crpChosenCols();
  if (!rows.length) { showInfo('ไม่มีข้อมูล', 'ไม่มีรายการตามที่เลือก — ลองขยายช่วงข้อมูล'); return; }
  if (!cols.length) { showInfo('ยังไม่ได้เลือกคอลัมน์', 'ติ๊กอย่างน้อย 1 คอลัมน์ก่อนออกรายงาน'); return; }
  var scope = _crpScopeText();
  var grpEl = document.getElementById('crpGroup');
  var opts = {
    groupByBranch: !!(grpEl && grpEl.checked),
    /* ใส่ชื่อคนออกรายงานไว้บนหัวกระดาษ — เอกสารที่ส่งต่อกันควรรู้ว่าใครออก */
    issuedBy: (function () {
      try { return (FH_USER && (FH_USER.name || FH_USER.nick)) || ''; } catch (e) { return ''; }
    })()
  };
  closeCertReport();
  if (kind === 'pdf') _crpPDF(rows, cols, scope, opts);
  else                _crpExcel(rows, cols, scope);
}

function _crpDash(v) { var s = String(v == null ? '' : v).trim(); return (!s || s === '—') ? '' : s; }

function _crpExcel(rows, cols, scope) {
  if (typeof ExcelJS === 'undefined') {
    showInfo('ออกรายงานไม่ได้', 'โหลดตัวสร้าง Excel ไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง'); return;
  }
  var wb = new ExcelJS.Workbook();
  var ws = wb.addWorksheet('ใบรับรอง');
  ws.columns = cols.map(function (c) { return { header: c.label, key: c.k, width: c.w }; });
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  rows.forEach(function (d, i) {
    var o = {};
    cols.forEach(function (c) { o[c.k] = c.k === 'no' ? (i + 1) : _crpDash(c.get(d, i)); });
    var r = ws.addRow(o);
    if (o.stat === 'หมดอายุ')          r.getCell('stat').font = { color: { argb: 'FFB91C1C' }, bold: true };
    else if (o.stat === 'ใกล้หมดอายุ') r.getCell('stat').font = { color: { argb: 'FFB45309' }, bold: true };
  });
  if (cols.length <= 26) {
    ws.autoFilter = { from: 'A1', to: String.fromCharCode(64 + cols.length) + '1' };
  }
  wb.xlsx.writeBuffer().then(function (buf) {
    var url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    _fhTriggerDownload(url, 'รายงานใบรับรอง_' + rows.length + 'รายการ_' + _fhStamp() + '.xlsx');
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    showInfo('ออกรายงานแล้ว', 'ไฟล์ Excel <b>' + rows.length + '</b> รายการ'
      + '<div style="margin-top:6px;font-size:12.5px;color:#64748b;">ช่วงข้อมูล: ' + escapeHtml(scope) + '</div>');
  }).catch(function (e) {
    showInfo('ออกรายงานไม่สำเร็จ', escapeHtml((e && e.message) || String(e)));
  });
}

/* ───────── รายงานใบรับรอง (PDF) ─────────
   สร้างหน้า HTML แล้วสั่งพิมพ์ → "Save as PDF"
   ได้ฟอนต์ไทยครบโดยไม่ต้องฝังฟอนต์ลง jsPDF (ไฟล์ใหญ่และสระลอย)

   จัดหน้าแบบเอกสารรายงาน ไม่ใช่ตารางดิบ:
   · หัวรายงานบอกให้ครบว่า "รายงานอะไร ของชุดไหน ออกเมื่อไร ใครออก"
   · แถบสรุปมีสัดส่วนให้เห็นภาพก่อนอ่านตัวเลข
   · สถานะเป็นป้าย อ่านเร็วกว่าตัวหนังสือสีตอนกวาดสายตาบนกระดาษ
   · แถวที่หมดอายุมีแถบสีซ้าย หาเจอทันทีโดยไม่ต้องไล่อ่าน
   · ใส่เลขหน้า และหัวตารางซ้ำทุกหน้า เพราะรายงานจริงมีหลายสิบหน้า */
function _crpPDF(rows, cols, scope, opts) {
  opts = opts || {};
  var esc = (typeof escapeHtml === 'function') ? escapeHtml : function (s) { return String(s == null ? '' : s); };

  var nValid = 0, nWarn = 0, nExp = 0;
  rows.forEach(function (d) {
    if (d.expStatus === 'expired') nExp++;
    else if (d.expStatus === 'warning') nWarn++;
    else nValid++;
  });
  var total = rows.length || 1;
  var pctOf = function (n) { return Math.round(n / total * 1000) / 10; };

  /* จัดกลุ่มตามสาขา — ช่วยมากเวลารายงานยาวหลายร้อยแถว
     ทำได้เฉพาะตอนเลือกคอลัมน์สาขาไว้ ไม่งั้นหัวกลุ่มจะลอยไม่มีที่มา */
  var hasBranch = cols.some(function (c) { return c.k === 'branch'; });
  var grouped = !!opts.groupByBranch && hasBranch;
  var list = rows.slice();
  if (grouped) {
    list.sort(function (a, b) {
      var A = String(a.branch || 'ไม่ระบุสาขา'), B = String(b.branch || 'ไม่ระบุสาขา');
      if (A !== B) return A.localeCompare(B, 'th');
      return String(a.expireDate || '').localeCompare(String(b.expireDate || ''));
    });
  }

  var tw = cols.reduce(function (s2, c) { return s2 + (c.pdfW || 10); }, 0) || 1;
  var head = cols.map(function (c) {
    var pct = Math.round(((c.pdfW || 10) / tw) * 1000) / 10;
    var al = (c.k === 'no') ? ' class="c"' : '';
    return '<th style="width:' + pct + '%"' + al + '>' + esc(c.label) + '</th>';
  }).join('');

  var CHIP = { 'หมดอายุ': 'bad', 'ใกล้หมดอายุ': 'warn' };
  var lastBranch = null, body = '';
  list.forEach(function (d, i) {
    if (grouped) {
      var br = String(d.branch || 'ไม่ระบุสาขา');
      if (br !== lastBranch) {
        lastBranch = br;
        var n = list.filter(function (x) { return String(x.branch || 'ไม่ระบุสาขา') === br; }).length;
        body += '<tr class="grp"><td colspan="' + cols.length + '">'
             +  '<span class="grp-n">' + esc(br) + '</span>'
             +  '<span class="grp-c">' + n + ' รายการ</span></td></tr>';
      }
    }
    var st = _FH_RPT_ST[d.expStatus] || 'ยังมีผล';
    var rowCls = d.expStatus === 'expired' ? ' class="r-bad"' : (d.expStatus === 'warning' ? ' class="r-warn"' : '');
    body += '<tr' + rowCls + '>' + cols.map(function (c) {
      var v = c.k === 'no' ? (i + 1) : _crpDash(c.get(d, i));
      if (c.k === 'stat') {
        return '<td class="nw"><span class="chip ' + (CHIP[v] || 'ok') + '">' + esc(v) + '</span></td>';
      }
      if (c.k === 'no')   return '<td class="c dim">' + esc(v) + '</td>';
      if (c.k === 'cert' || c.k === 'emp') return '<td class="nm">' + esc(v) + '</td>';
      if (c.k === 'train' || c.k === 'exp') return '<td class="nw num">' + esc(v) + '</td>';
      if (c.k === 'course') return '<td class="dim sm">' + esc(v) + '</td>';
      if (c.k === 'match')  return '<td class="dim sm">' + esc(v) + '</td>';
      return '<td>' + esc(v) + '</td>';
    }).join('') + '</tr>';
  });

  var bar = function (n, cls) {
    var w = total ? (n / total * 100) : 0;
    return w > 0 ? '<span class="seg ' + cls + '" style="width:' + w + '%"></span>' : '';
  };
  var fig = function (label, n, cls) {
    return '<div class="fig ' + cls + '"><div class="fig-l">' + label + '</div>'
      + '<div class="fig-n">' + n + '<small>' + pctOf(n) + '%</small></div></div>';
  };

  var css = [
    '@page{size:A4 landscape;margin:12mm 11mm 14mm;}',
    '@page{@bottom-right{content:"หน้า " counter(page) " / " counter(pages);}}',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    'body{font-family:Sarabun,"Noto Sans Thai",sans-serif;color:#111827;font-size:10.5px;',
    '  line-height:1.5;padding:56px 0 0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',

    /* ── หัวรายงาน ── */
    '.mast{display:flex;align-items:flex-start;gap:16px;padding-bottom:10px;',
    '  border-bottom:2.5px solid #111827;}',
    '.mast-bar{width:4px;align-self:stretch;background:#ea580c;border-radius:2px;flex:none;}',
    '.mast h1{font-size:18px;font-weight:800;letter-spacing:-.4px;line-height:1.2;}',
    '.mast .org{font-size:9.5px;font-weight:700;letter-spacing:.12em;color:#ea580c;',
    '  text-transform:uppercase;margin-bottom:3px;}',
    '.mast .scope{font-size:10.5px;color:#4b5563;margin-top:5px;}',
    '.mast .scope b{color:#111827;font-weight:600;}',
    '.mast-meta{margin-left:auto;text-align:right;font-size:9.5px;color:#6b7280;line-height:1.7;',
    '  white-space:nowrap;}',
    '.mast-meta b{color:#111827;font-weight:700;font-size:11px;}',

    /* ── แถบสรุป ── */
    '.sum{margin:12px 0 13px;}',
    '.sumbar{display:flex;height:9px;border-radius:5px;overflow:hidden;background:#eef1f5;}',
    '.seg{display:block;height:100%;}',
    '.seg.ok{background:#059669;}.seg.warn{background:#d97706;}.seg.bad{background:#dc2626;}',
    '.figs{display:flex;gap:26px;margin-top:9px;}',
    '.fig{position:relative;padding-left:11px;}',
    '.fig::before{content:"";position:absolute;left:0;top:3px;bottom:3px;width:3px;border-radius:2px;}',
    '.fig.all::before{background:#111827;}.fig.ok::before{background:#059669;}',
    '.fig.warn::before{background:#d97706;}.fig.bad::before{background:#dc2626;}',
    '.fig-l{font-size:9px;font-weight:700;letter-spacing:.06em;color:#6b7280;}',
    '.fig-n{font-size:17px;font-weight:800;letter-spacing:-.4px;font-variant-numeric:tabular-nums;}',
    '.fig-n small{font-size:9.5px;font-weight:600;color:#9ca3af;margin-left:5px;}',

    /* ── ตาราง ── */
    'table{width:100%;border-collapse:collapse;table-layout:fixed;}',
    'thead th{background:#111827;color:#fff;font-size:9px;font-weight:700;letter-spacing:.05em;',
    '  text-align:left;padding:7px 8px;}',
    'thead th:first-child{border-radius:4px 0 0 0;}thead th:last-child{border-radius:0 4px 0 0;}',
    'thead th.c{text-align:center;}',
    'tbody td{padding:6px 8px;border-bottom:.6px solid #e8ebef;vertical-align:top;',
    '  word-break:break-word;}',
    /* กันข้อความยาวเกินช่องแล้วล้นไปทับคอลัมน์ข้าง ๆ (table-layout:fixed ไม่กันให้)
       ตัดด้วย … ดีกว่าปล่อยทับกันจนอ่านไม่ออกทั้งสองคอลัมน์ */
    'tbody td.c{text-align:center;}',
    'tbody td.nw{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    'tbody td.num{font-variant-numeric:tabular-nums;white-space:nowrap;}',
    'tbody td.nm{font-weight:600;}',
    'tbody td.dim{color:#6b7280;}tbody td.sm{font-size:9.5px;}',
    /* แถวที่ต้องลงมือ — แถบสีซ้ายหาเจอเร็วกว่าอ่านคอลัมน์สถานะ */
    'tr.r-bad td:first-child{box-shadow:inset 3px 0 0 #dc2626;}',
    'tr.r-warn td:first-child{box-shadow:inset 3px 0 0 #d97706;}',
    'tr.r-bad td{background:#fef5f4;}',

    /* ── ป้ายสถานะ ── */
    '.chip{display:inline-block;padding:1.5px 8px;border-radius:999px;font-size:9px;',
    '  font-weight:700;white-space:nowrap;}',
    '.chip.ok{background:#e7f5ee;color:#047857;}',
    '.chip.warn{background:#fdf2e2;color:#b45309;}',
    '.chip.bad{background:#fdeceb;color:#b91c1c;}',

    /* ── หัวกลุ่มสาขา ── */
    'tr.grp td{background:#f4f6f9;border-bottom:1px solid #dfe4ea;border-top:1px solid #dfe4ea;',
    '  padding:6px 8px;}',
    '.grp-n{font-weight:800;font-size:10.5px;}',
    '.grp-c{float:right;font-size:9px;font-weight:600;color:#6b7280;}',

    /* ── การพิมพ์ ── */
    'thead{display:table-header-group;}tr{page-break-inside:avoid;}',
    'tr.grp{page-break-after:avoid;}',
    '.foot{margin-top:12px;padding-top:8px;border-top:.8px solid #e8ebef;',
    '  font-size:8.5px;color:#9ca3af;display:flex;gap:14px;}',
    '.foot .sp{margin-left:auto;}',

    /* ── แถบเครื่องมือ (ไม่ติดไปกับ PDF) ── */
    '.bar{position:fixed;top:0;left:0;right:0;background:#111827;color:#fff;padding:9px 14px;',
    '  display:flex;gap:9px;align-items:center;font-size:12.5px;z-index:9;}',
    '.bar button{font-family:inherit;font-size:12.5px;font-weight:700;border:0;border-radius:8px;',
    '  padding:7px 15px;cursor:pointer;background:#ea580c;color:#fff;}',
    '.bar .gh{background:rgba(255,255,255,.16);}',
    '@media print{.bar{display:none;}body{padding-top:0;}}',
  ].join('');

  var html = '<!doctype html><html lang="th"><head><meta charset="utf-8">'
    + '<title>รายงานใบรับรอง ' + esc(_fhStamp()) + '</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet">'
    + '<style>' + css + '</style></head><body>'

    + '<div class="bar"><b>รายงานใบรับรอง</b>'
    +   '<span style="opacity:.75">กด "บันทึกเป็น PDF" แล้วเลือกปลายทางเป็น Save as PDF</span>'
    +   '<span style="margin-left:auto"></span>'
    +   '<button onclick="window.print()">บันทึกเป็น PDF</button>'
    +   '<button class="gh" onclick="window.close()">ปิด</button></div>'

    + '<div class="mast"><div class="mast-bar"></div><div>'
    +   '<div class="org">FAB Food Holding · ความปลอดภัยด้านอาหาร</div>'
    +   '<h1>รายงานใบรับรองผู้สัมผัสอาหารและผู้ประกอบอาหาร</h1>'
    +   '<div class="scope">ช่วงข้อมูล <b>' + esc(scope) + '</b></div>'
    + '</div><div class="mast-meta">'
    +   'รวมทั้งสิ้น <b>' + rows.length.toLocaleString() + '</b> รายการ<br>'
    +   'ออกรายงาน ' + esc(_fhStamp()) + '<br>'
    +   'โดย ' + esc(opts.issuedBy || '—')
    + '</div></div>'

    + '<div class="sum"><div class="sumbar">'
    +   bar(nValid, 'ok') + bar(nWarn, 'warn') + bar(nExp, 'bad')
    + '</div><div class="figs">'
    +   fig('ทั้งหมด', rows.length.toLocaleString(), 'all')
    +   fig('ยังมีผล', nValid, 'ok')
    +   fig('ใกล้หมดอายุ', nWarn, 'warn')
    +   fig('หมดอายุแล้ว', nExp, 'bad')
    + '</div></div>'

    + '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>'

    + '<div class="foot"><span>ข้อมูล ณ วันที่ออกรายงาน — สถานะใบรับรองคำนวณจากวันหมดอายุ</span>'
    +   '<span class="sp">ระบบฐานข้อมูลผู้สัมผัสอาหารและผู้ประกอบอาหาร</span></div>'

    + '</body></html>';

  var w = window.open('', '_blank');
  if (!w) { showInfo('เปิดหน้าต่างไม่ได้', 'เบราว์เซอร์บล็อกป๊อปอัป — อนุญาตป๊อปอัปของเว็บนี้แล้วลองใหม่'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
