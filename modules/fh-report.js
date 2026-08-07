/* ═══════════════════════════════════════════════════════════════
   ตัวออกรายงานใบรับรอง — เลือกช่วงข้อมูลและคอลัมน์เอง แล้วออกได้ทั้ง Excel/PDF
   เดิม: ปุ่มออกรายงานยึดตัวกรองบนหน้าจอเท่านั้น และคอลัมน์ตายตัว 10 ช่อง
   ใครอยากได้แค่สาขาเดียว หรือเอาแค่ 4 ช่อง ต้องไปลบเองใน Excel ทุกครั้ง
   ═══════════════════════════════════════════════════════════════ */

var _FH_RPT_ST = { expired: 'หมดอายุ', warning: 'ใกล้หมดอายุ' };
var _FH_RPT_MT = { exact: 'ตรงกับทะเบียน', lastname: 'นามสกุลตรง' };

/* นิยามคอลัมน์ไว้ที่เดียว — Excel กับ PDF ใช้ชุดเดียวกัน จะได้ไม่หลุดกันทีหลัง
   pdfW เป็น "น้ำหนัก" ไม่ใช่เปอร์เซ็นต์ตายตัว เพราะผู้ใช้เลือกคอลัมน์เองได้
   ถ้าตรึงเป็น % ไว้ พอเลือกแค่ 3 ช่อง ตารางจะกินแค่ครึ่งหน้าแล้วเหลือขาว ๆ
   จึงคิดสัดส่วนจากชุดที่เลือกจริงตอนสร้างรายงาน */
var FH_RPT_COLS = [
  { k: 'no',     label: 'ลำดับ',                    w: 7,  pdfW: 4,  get: function (d, i) { return i + 1; } },
  { k: 'cert',   label: 'ชื่อ-นามสกุล (ในใบเซอร์)', w: 30, pdfW: 17, get: function (d) { return d.certName; } },
  { k: 'emp',    label: 'ชื่อในทะเบียน',            w: 30, pdfW: 15, get: function (d) { return d.empName; } },
  { k: 'brand',  label: 'แบรนด์',                   w: 16, pdfW: 9,  get: function (d) { return _certBrand(d); } },
  { k: 'branch', label: 'สาขา',                     w: 32, pdfW: 16, get: function (d) { return d.branch; } },
  { k: 'pos',    label: 'ตำแหน่ง',                  w: 18, pdfW: 10, get: function (d) { return d.position; } },
  { k: 'course', label: 'หลักสูตร',                 w: 40, pdfW: 18, get: function (d) { return d.course; } },
  { k: 'train',  label: 'วันที่อบรม',               w: 14, pdfW: 9,  get: function (d) { return d.trainDate; } },
  { k: 'exp',    label: 'วันหมดอายุ',               w: 14, pdfW: 9,  get: function (d) { return d.expireDate; } },
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
  closeCertReport();
  if (kind === 'pdf') _crpPDF(rows, cols, scope);
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

/* PDF: สร้างหน้า HTML แล้วสั่งพิมพ์ → เลือก "Save as PDF"
   ได้ฟอนต์ไทยครบโดยไม่ต้องฝังฟอนต์ลง jsPDF (ไฟล์ใหญ่และยุ่ง) */
function _crpPDF(rows, cols, scope) {
  var esc = (typeof escapeHtml === 'function') ? escapeHtml : function (s) { return String(s == null ? '' : s); };
  var nValid = 0, nWarn = 0, nExp = 0;
  rows.forEach(function (d) {
    if (d.expStatus === 'expired') nExp++;
    else if (d.expStatus === 'warning') nWarn++;
    else nValid++;
  });
  var tw = cols.reduce(function (s2, c) { return s2 + (c.pdfW || 10); }, 0) || 1;
  var head = cols.map(function (c) {
    var pct = Math.round(((c.pdfW || 10) / tw) * 1000) / 10;
    return '<th style="width:' + pct + '%">' + esc(c.label) + '</th>';
  }).join('');
  var body = rows.map(function (d, i) {
    return '<tr>' + cols.map(function (c) {
      var v = c.k === 'no' ? (i + 1) : _crpDash(c.get(d, i));
      if (c.k === 'stat') {
        var cls = v === 'หมดอายุ' ? 'st-bad' : v === 'ใกล้หมดอายุ' ? 'st-warn' : 'st-ok';
        return '<td class="num"><span class="' + cls + '">' + esc(v) + '</span></td>';
      }
      var cls2 = (c.k === 'no' || c.k === 'train' || c.k === 'exp') ? ' class="num"'
               : (c.k === 'course' ? ' class="course"' : '');
      return '<td' + cls2 + '>' + esc(v) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  var css = '@page{size:A4 landscape;margin:11mm 10mm 13mm;}'
    + '*{box-sizing:border-box;margin:0;padding:0;}'
    + 'body{font-family:Sarabun,sans-serif;color:#0f172a;font-size:11px;padding:52px 0 0;}'
    + '.hd{display:flex;align-items:flex-end;gap:14px;border-bottom:2px solid #0f172a;padding-bottom:9px;}'
    + '.hd h1{font-size:17px;font-weight:800;letter-spacing:-.3px;}'
    + '.hd .sub{font-size:11px;color:#64748b;margin-top:3px;}'
    + '.hd .meta{margin-left:auto;text-align:right;font-size:10.5px;color:#64748b;line-height:1.6;}'
    + '.sum{display:flex;gap:7px;margin:10px 0 11px;}'
    + '.sum div{border:1px solid #e2e8f0;border-radius:7px;padding:6px 12px;min-width:96px;}'
    + '.sum .l{font-size:9.5px;color:#94a3b8;font-weight:700;}'
    + '.sum .n{font-size:16px;font-weight:800;margin-top:1px;}'
    + '.n-ok{color:#059669;}.n-warn{color:#b45309;}.n-bad{color:#dc2626;}'
    + 'table{width:100%;border-collapse:collapse;table-layout:fixed;}'
    + 'thead th{background:#f1f5f9;font-size:9.5px;font-weight:800;color:#475569;text-align:left;'
    +   'padding:6px 7px;border-bottom:1.5px solid #cbd5e1;}'
    + 'tbody td{padding:5px 7px;border-bottom:.7px solid #e8edf3;vertical-align:top;'
    +   'line-height:1.45;word-break:break-word;}'
    + 'tbody tr:nth-child(even) td{background:#fbfcfe;}'
    + 'td.num{white-space:nowrap;}td.course{font-size:10px;color:#475569;}'
    + '.st-ok{color:#059669;font-weight:700;}.st-warn{color:#b45309;font-weight:700;}'
    + '.st-bad{color:#dc2626;font-weight:800;}'
    /* หัวตารางซ้ำทุกหน้าเวลาพิมพ์ · ห้ามตัดแถวคาหน้า */
    + 'thead{display:table-header-group;}tr{page-break-inside:avoid;}'
    + '.bar{position:fixed;top:0;left:0;right:0;background:#0f172a;color:#fff;padding:9px 14px;'
    +   'display:flex;gap:9px;align-items:center;font-size:12.5px;z-index:9;}'
    + '.bar button{font-family:inherit;font-size:12.5px;font-weight:700;border:0;border-radius:8px;'
    +   'padding:7px 15px;cursor:pointer;background:#ea580c;color:#fff;}'
    + '.bar .gh{background:rgba(255,255,255,.16);}'
    + '@media print{.bar{display:none;}body{padding-top:0;}}';

  var html = '<!doctype html><html lang="th"><head><meta charset="utf-8">'
    + '<title>รายงานใบรับรอง ' + esc(_fhStamp()) + '</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet">'
    + '<style>' + css + '</style></head><body>'
    + '<div class="bar"><b>รายงานใบรับรอง</b>'
    +   '<span style="opacity:.75">กด "บันทึกเป็น PDF" แล้วเลือกปลายทางเป็น Save as PDF</span>'
    +   '<span style="margin-left:auto"></span>'
    +   '<button onclick="window.print()">บันทึกเป็น PDF</button>'
    +   '<button class="gh" onclick="window.close()">ปิด</button></div>'
    + '<div class="hd"><div><h1>รายงานใบรับรองผู้สัมผัสอาหาร</h1>'
    +   '<div class="sub">ช่วงข้อมูล: ' + esc(scope) + '</div></div>'
    +   '<div class="meta">พิมพ์เมื่อ ' + esc(_fhStamp()) + '<br>รวม ' + rows.length + ' รายการ</div></div>'
    + '<div class="sum">'
    +   '<div><div class="l">ยังมีผล</div><div class="n n-ok">' + nValid + '</div></div>'
    +   '<div><div class="l">ใกล้หมดอายุ</div><div class="n n-warn">' + nWarn + '</div></div>'
    +   '<div><div class="l">หมดอายุ</div><div class="n n-bad">' + nExp + '</div></div>'
    + '</div>'
    + '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>'
    + '</body></html>';

  var w = window.open('', '_blank');
  if (!w) { showInfo('เปิดหน้าต่างไม่ได้', 'เบราว์เซอร์บล็อกป๊อปอัป — อนุญาตป๊อปอัปของเว็บนี้แล้วลองใหม่'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
