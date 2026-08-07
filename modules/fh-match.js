/* fh-match.js — จับคู่ชื่อกับใบรับรอง · stepper · ตัวช่วย UI · ดาวน์โหลดใบเซอร์
   แยกมาจาก food-handler.js (บรรทัดเดิม 508-1335)
   ⚠️ ไฟล์ชุดนี้ต้องโหลดตามลำดับใน food-handler.html — อย่าสลับ */
/* ─────────── MATCHING ENGINE ─────────── */
function normalizeName(n) {
  return String(n || '')
    // "ำ" (สระอำ e33) ที่ OCR แยกเป็น นฤคหิต(ํ e4d)+สระอา(า e32) — รองรับวรรณยุกต์คั่นกลางด้วย
    // เช่น "อ ํ ่ า" (ช้างอํ่า) → "อ ่ ำ" (ช้างอ่ำ) · เก็บวรรณยุกต์ไว้ ย้าย ำ ไปท้าย
    .replace(/ํ([่-๋]*)า/g, '$1ำ')   // ํ (+วรรณยุกต์) + า → (วรรณยุกต์)ำ
    .replace(/า([่-๋]*)ํ/g, '$1ำ')   // เผื่อสลับลำดับ า ... ํ
    // รวมช่องว่างที่ OCR แทรกหน้าอักขระประสม (สระบน/ล่าง/วรรณยุกต์) กลับ เช่น "ทองสพรั ่ง"→"ทองสพรั่ง"
    .replace(/\s+([ัิ-ฺ็-๎])/g, '$1')
    .replace(/\s+/g, ' ').trim();
}
/* ตัดข้อความเอกสาร/หลักสูตร ที่ OCR กวาดมาต่อท้ายนามสกุล (ไม่มีช่องว่างคั่น)
   เช่น "สมพงษ์ จันดำการสุขาภิบาลอาหาร" → "สมพงษ์ จันดำ" */
function _cleanCertName(nm){
  nm = String(nm||'').replace(/\s+/g,' ').trim();
  nm = nm.replace(/(การสุขาภิบาล|ผ่านการอบรม|ผ่านการฝึกอบรม|หลักสูตร|ตามกฎกระทรวง|สำหรับผู้|ผู้สัมผัสอาหาร|ผู้ประกอบกิจการ|ขอรับรองว่า|ได้ผ่าน|เลขที่|บริษัท|จำกัด|กรุ๊ป).*$/, '').trim();
  return nm;
}
/* คีย์รวมสาขาที่จริงคืออันเดียวกันแต่สะกดต่าง (ต่างแค่ช่องว่าง / ส↔ซ / วรรณยุกต์) */
function _branchKey(s){
  return String(s||'')
    .replace(/[\s\-–—_.,'"()\[\]/]+/g,'')   // ตัดช่องว่าง/ขีด/จุด/วงเล็บ → "S Oasis" = "S-Oasis"
    .replace(/ซ/g,'ส')                      // ซ↔ส สะกดสลับกันบ่อย
    .replace(/[็-๎]/g,'')                   // ตัดวรรณยุกต์/ไม้ไต่คู้
    .toLowerCase();
}
/* สาขาเดียวกันแต่สะกดคนละแบบจน normalize อัตโนมัติไม่ได้ (อังกฤษ/ไทย, คำหาย)
   → บังคับใช้ "ชื่อมาตรฐาน" ตามทะเบียน BRANCHES  ·  ยืนยันโดยผู้ใช้แล้ว
   เทียบด้วย "ชื่อเต็มรวมแบรนด์" เท่านั้น — กันไปชนสาขาแบรนด์อื่นที่ชื่อคล้ายกัน
   (เช่น 4007 "เจ๊แดง จุ่มนัวร์ ซีคอน ศรีนครินทร์" ต้องไม่ถูกรวมกับ 5002 ของ Santa Fe) */
var FH_BRANCH_ALIAS = [
  { from: 'Santa Fe Cosmo บาซาร์',       to: 'Santa Fe คอสโม บาร์ซา' },              // 5068
  { from: 'Santa Fe ซีคอนศรีนครินทร์',   to: 'Santa Fe ซีคอนสแควร์ ศรีนครินทร์' },   // 5002
  { from: 'Santa Fe พัทยากลาง',          to: 'Santa Fe บิ๊กซี พัทยากลาง' }           // 5014
];
var _FH_ALIAS_MAP = {};
try { FH_BRANCH_ALIAS.forEach(function(a){ _FH_ALIAS_MAP[_branchKey(a.from)] = a.to; }); } catch(e) {}

/* รวมชื่อสาขาที่สะกดต่างเล็กน้อยให้ใช้สะกดเดียว (เลือกสะกดที่พบบ่อยสุด) — กัน dropdown/ตัวกรองขึ้นซ้ำ
   เช่น "แฟชั่น ไอส์แลนด์" กับ "แฟชั่นไอซ์แลนด์" → ใช้อันเดียว */
/* นับว่าชื่อสาขาแต่ละแบบมีพนักงานกี่คนในทะเบียน
   ใช้ตอนคนเดียวกันมีหลายแถวและสาขาสะกดต่างกัน → เลือกแบบที่คนใช้เยอะที่สุด = แบบมาตรฐาน */
var _FH_BRANCH_FREQ = {};
function _fhBuildBranchFreq(employees){
  _FH_BRANCH_FREQ = {};
  (employees || []).forEach(function(e){
    var b = String((e && e.branch) || '').trim();
    if (b) _FH_BRANCH_FREQ[b] = (_FH_BRANCH_FREQ[b] || 0) + 1;
  });
}
function _canonicalizeBranches(list){
  if (!Array.isArray(list) || !list.length) return;
  // 1) alias ที่ยืนยันแล้ว — บังคับเป็นชื่อมาตรฐานก่อน (ไม่ปล่อยให้ "เสียงข้างมาก" ตัดสิน)
  list.forEach(function(d){
    if (!d || !d.branch || d.branch === '—') return;
    var t = _FH_ALIAS_MAP[_branchKey(d.branch)];
    if (t) d.branch = t;
  });
  // 2) ที่เหลือ รวมสะกดต่างเล็กน้อยด้วยเสียงข้างมาก
  var groups = {};   // key → { สะกด: จำนวน }
  list.forEach(function(d){
    var b = d && d.branch; if (!b || b === '—') return;
    var k = _branchKey(b);
    (groups[k] = groups[k] || {})[b] = (groups[k][b] || 0) + 1;
  });
  var canon = {};
  Object.keys(groups).forEach(function(k){
    var best = null, bestN = -1;
    Object.keys(groups[k]).forEach(function(sp){ if (groups[k][sp] > bestN) { bestN = groups[k][sp]; best = sp; } });
    canon[k] = best;
  });
  list.forEach(function(d){
    if (d && d.branch && d.branch !== '—') { var c = canon[_branchKey(d.branch)]; if (c) d.branch = c; }
  });
}

/* ชุดคำนำหน้า/ยศ ที่ต้องตัดทิ้งก่อนเทียบชื่อ (เก็บแบบตัดจุด/ช่องว่างออกแล้ว)
   เพราะทะเบียนมักมียศ (เช่น "ว่าที่ ร.ต. นันทฤทธิ์ ธรรมดา") แต่ใบรับรองมีแค่ "นันทฤทธิ์ ธรรมดา" */
var TH_TITLES = {
  'นาย':1,'นาง':1,'นางสาว':1,'นส':1,'น.ส':1,'น. ส':1,
  'ดช':1,'ดญ':1,'เด็กชาย':1,'เด็กหญิง':1,
  'ดร':1,'นพ':1,'พญ':1,'ทพ':1,'ทพญ':1,
  'ว่าที่':1,'วาที่':1,
  'ร้อยตรี':1,'ร้อยโท':1,'ร้อยเอก':1,'พันตรี':1,'พันโท':1,'พันเอก':1,
  'พลตรี':1,'พลโท':1,'พลเอก':1,'จ่าสิบเอก':1,'จ่าสิบโท':1,'จ่าสิบตรี':1,'สิบเอก':1,'สิบโท':1,'สิบตรี':1,
  'รต':1,'รท':1,'รอ':1,'พต':1,'พท':1,'พอ':1,'พลต':1,'พลท':1,'พลอ':1,
  'จสอ':1,'จสท':1,'จสต':1,'พตท':1,'พตอ':1,'พตต':1,
  'ร้อยตำรวจเอก':1,'ร้อยตำรวจโท':1,'ร้อยตำรวจตรี':1,'พันตำรวจเอก':1,'พันตำรวจโท':1,'พันตำรวจตรี':1
};
/* ตัดคำนำหน้า/ยศ นำหน้าออก (รองรับ "ว่าที่ ร.ต." หลายชั้น) → คืน tokens ของชื่อจริง */
function _stripTitleTokens(n) {
  var parts = n.split(/\s+/).filter(Boolean);
  while (parts.length > 1) {
    var key = parts[0].replace(/[.\s]/g, '');   // ตัดจุด/ช่องว่างในโทเคนก่อนเทียบ (ร.ต. → รต)
    if (TH_TITLES[key] || TH_TITLES[parts[0]]) parts.shift();
    else break;
  }
  return parts;
}
function getParts(name) {
  var n = normalizeName(name);
  // Normalize: ensure space after title (handle "นายอธิศ" → "นาย อธิศ")
  n = n.replace(/^(นางสาว|นาย|นาง)/, '$1 ').replace(/\s+/g, ' ').trim();
  var stripped = _stripTitleTokens(n);
  var prefix = n.slice(0, n.length - stripped.join(' ').length).trim();
  var parts = stripped.length ? stripped : n.split(/\s+/);
  // ชื่อเต็ม: รวมทุกคำ (ตัดช่องว่าง+วรรณยุกต์) — กันนามสกุลที่ OCR แยกคำ/เว้นวรรคต่าง
  var full = _thStrip(parts.join('')).replace(/\s/g,'');
  return { prefix:prefix, first:parts[0]||'', last:parts[parts.length-1]||'', full:full };
}
/* ตัดวรรณยุกต์/การันต์ (่ ้ ๊ ๋ ์ ็) ที่ OCR มักอ่านเพี้ยน/หาย — ใช้เทียบชื่อแบบยืดหยุ่น */
function _thStrip(s){ return String(s||'').replace(/[็-๎]/g, ''); }
/* ชื่อ cert ตรงกับชื่อในทะเบียนไหม (เทียบ first+last · exact หรือ ตัดวรรณยุกต์แล้วตรง) */
function _certEmpMatch(certParts, empNorm){
  var ep = getParts(empNorm);
  if (certParts.first && certParts.last) {
    if (certParts.first === ep.first && certParts.last === ep.last) return true;
    if (_thStrip(certParts.first) === _thStrip(ep.first) && _thStrip(certParts.last) === _thStrip(ep.last)) return true;
  }
  // เทียบชื่อเต็มแบบตัดช่องว่าง+วรรณยุกต์ (กันนามสกุล OCR แยกคำ/เว้นวรรค เช่น "เฉลิมขวัญ เขี ยว"↔"เฉลิมขวัญ เขียว")
  if (certParts.full && ep.full && certParts.full.length >= 6 && certParts.full === ep.full) return true;
  return false;
}

/* Parse a date string (Thai full, ISO, or DD/MM/YYYY) → Date object (Gregorian), or null */
function parseAnyDate(s) {
  if (!s) return null;
  if (s instanceof Date) {
    if (isNaN(s)) return null;
    // Normalize: if year is Buddhist, shift down to Gregorian — preserve time
    var yr = s.getFullYear();
    while (yr > 2400) yr -= 543;
    return new Date(yr, s.getMonth(), s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds());
  }
  s = String(s).trim();
  if (!s || s === '—') return null;
  // ISO: "2570-07-21T17:00:00.000Z" or "2026-07-21" or "2026-05-25 14:32:15"
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/);
  if (iso) {
    var y = parseInt(iso[1]);
    /* มี timezone (Z / +07:00) → Sheets เก็บวันที่ไทยแล้วส่งกลับเป็น UTC (เลื่อน -7 ชม.)
       ถ้าอ่านเลขวันจากสตริง UTC ตรงๆ จะเพี้ยนไป 1 วัน (6 พ.ย. ไทย = 5 พ.ย. 17:00Z)
       จึงต้องแปลงเป็น instant จริงแล้วอ่านวันที่ "ตามเวลาไทย" (UTC+7) แบบตายตัว
       — ไม่พึ่ง timezone ของเครื่องผู้ใช้ เพื่อให้ทุกเครื่องเห็นวันเดียวกัน */
    if (iso[7]) {
      var gy = y > 2500 ? y - 543 : y;
      var inst = new Date(s.replace(/^\d{4}/, String(gy)));
      if (!isNaN(inst)) {
        var bkk = new Date(inst.getTime() + 7 * 3600000);   // เลื่อนเป็นเวลาไทย แล้วอ่านส่วน UTC
        return new Date(
          bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(),
          bkk.getUTCHours(), bkk.getUTCMinutes(), bkk.getUTCSeconds()
        );
      }
    }
    if (y > 2500) y -= 543;
    return new Date(
      y, parseInt(iso[2]) - 1, parseInt(iso[3]),
      iso[4] ? parseInt(iso[4]) : 0,
      iso[5] ? parseInt(iso[5]) : 0,
      iso[6] ? parseInt(iso[6]) : 0
    );
  }
  // DD/MM/YYYY [HH:mm[:ss]]
  var dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    var dy = parseInt(dmy[3]);
    if (dy > 2500) dy -= 543;
    else if (dy < 100) dy += 2000;
    return new Date(
      dy, parseInt(dmy[2]) - 1, parseInt(dmy[1]),
      dmy[4] ? parseInt(dmy[4]) : 0,
      dmy[5] ? parseInt(dmy[5]) : 0,
      dmy[6] ? parseInt(dmy[6]) : 0
    );
  }
  // Thai full: "4 กรกฎาคม 2569"
  var thMonths = {'มกราคม':0,'กุมภาพันธ์':1,'มีนาคม':2,'เมษายน':3,'พฤษภาคม':4,'มิถุนายน':5,'กรกฎาคม':6,'สิงหาคม':7,'กันยายน':8,'ตุลาคม':9,'พฤศจิกายน':10,'ธันวาคม':11};
  // Thai short (with or without trailing dots): "4 ก.ค. 2569" / "4 กค 2569"
  var thShort = {'ม.ค.':0,'ก.พ.':1,'มี.ค.':2,'เม.ย.':3,'พ.ค.':4,'มิ.ย.':5,'ก.ค.':6,'ส.ค.':7,'ก.ย.':8,'ต.ค.':9,'พ.ย.':10,'ธ.ค.':11,
                 'มค':0,'กพ':1,'มีค':2,'เมย':3,'พค':4,'มิย':5,'กค':6,'สค':7,'กย':8,'ตค':9,'พย':10,'ธค':11};
  var th = s.match(/(\d+)\s+(\S+)\s+(\d+)/);
  if (th) {
    var monIdx = thMonths[th[2]];
    if (monIdx == null) monIdx = thShort[th[2]];
    if (monIdx != null) {
      var ty = parseInt(th[3]);
      if (ty > 2500) ty -= 543;
      return new Date(ty, monIdx, parseInt(th[1]));
    }
  }
  return null;
}

/* Format any date input → Thai short form: "21 ก.ค. 2570" */
function formatThaiDate(s) {
  if (s == null || s === '' || s === '—') return '—';
  var d = parseAnyDate(s);
  if (!d) return s; // unchanged if unparseable
  var thShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  var y = d.getFullYear();
  // Normalize down to Gregorian no matter how many times it was double-converted
  while (y > 2400) y -= 543;
  y += 543; // → Buddhist
  return d.getDate() + ' ' + thShort[d.getMonth()] + ' ' + y;
}

/* Same as formatThaiDate but includes time HH:MM */
function formatThaiDateTime(s) {
  if (s == null || s === '' || s === '—') return '—';
  var d = parseAnyDate(s);
  if (!d) return s;
  var thShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  var y = d.getFullYear();
  while (y > 2400) y -= 543;
  y += 543;
  var pad = function(n){ return n < 10 ? '0'+n : ''+n; };
  return d.getDate() + ' ' + thShort[d.getMonth()] + ' ' + y + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function getExpStatus(expDateStr) {
  var d = parseAnyDate(expDateStr);
  if (!d) return 'unknown';
  // "ใกล้หมดอายุ" = expires within 1 year 6 months (~547 days)
  var diffDays = (d - today) / 86400000;
  if (diffDays < 0) return 'expired';
  if (diffDays <= 547) return 'warning';
  return 'valid';
}

/* ─── Stepper state machine ─── */
function setStepState(scopeEl, stateMap) {
  // stateMap = { 1:'done', 2:'active', 3:null }
  if (!scopeEl) return;
  Object.keys(stateMap).forEach(function(n){
    var el = scopeEl.querySelector('.step-' + n);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (stateMap[n]) el.classList.add(stateMap[n]);
  });
}
function updateStepper() {
  // ฝั่งสาขาใช้เมนูข้าง (sidebar) แทน stepper แล้ว — เหลือเฉพาะ adminView
  // Admin view (2 steps — match/save are automatic)
  var av = document.getElementById('adminView');
  if (av && av.style.display !== 'none') {
    var statsEl = document.getElementById('statsRow');
    var matched = statsEl && statsEl.style.display === 'grid';
    if (matched) setStepState(av, {1:'done', 2:'active'});
    else setStepState(av, {1:'active', 2:null});
  }
}

function processMatch() {
  if (!pdfData) return;

  document.getElementById('processBtn').innerHTML = '<span class="spin"></span> กำลังจับคู่...';
  document.getElementById('processBtn').disabled = true;

  setTimeout(function() {
    var raw = [];
    var employees = empData || [];
    _fhBuildBranchFreq(employees);   // ใช้ตัดสินว่าชื่อสาขาแบบไหนคือแบบมาตรฐาน

    try {
      console.log('[DIAG NAMES] cert ตัวอย่าง:', JSON.stringify(pdfData.slice(0,3).map(function(c){ return c.name; })));
      console.log('[DIAG NAMES] ทะเบียน ตัวอย่าง:', JSON.stringify(employees.slice(0,3).map(function(e){ return e.norm || e.name; })));
      if (pdfData[0]) {
        var cp0 = getParts(pdfData[0].name);
        var hit = employees.filter(function(e){ var ep=getParts(e.norm||''); return ep.first===cp0.first && ep.last===cp0.last; });
        console.log('[DIAG NAMES] ชื่อแรก "' + pdfData[0].name + '" → first="' + cp0.first + '" last="' + cp0.last + '" · เจอในทะเบียน ' + hit.length + ' คน');
      }
    } catch(e) { console.warn('DIAG NAMES err', e); }

    pdfData.forEach(function(cert, idx) {
      var cp = getParts(cert.name);
      var found = null, matchType = 'notfound';

      if (employees.length > 0) {
        /* 1) เทียบ "ชื่อ-นามสกุล" กับทะเบียนเท่านั้น (ตัดคำนำหน้าออกหมด · เว้นวรรคไม่ตรงก็ยังเจอ)
              ไม่ใช้รหัสพนักงานและไม่ใช้สาขาในการตัดสิน — ตรงชื่อแล้วค่อยไปหยิบสาขาจากทะเบียน

              คนเดียวกันมักมีหลายแถว เพราะทะเบียนถูกนำเข้าซ้ำแล้วสาขาสะกดคนละแบบ
              (เช่น "ICS ไอคอนสยาม" กับ "ไอซีเอส ไอคอนสยาม" · "เทอมินัล 21" กับ "เทอร์มินอล 21")
              เดิมหยุดที่แถวแรกที่มีสาขา = ได้ชื่อสาขาแบบไหนขึ้นกับลำดับในไฟล์ ไม่แน่นอน
              ตอนนี้เลือก "สาขาที่ทะเบียนใช้บ่อยที่สุด" = ได้ชื่อมาตรฐานเสมอ
              (ตรวจกับข้อมูลจริงแล้ว ฝั่งที่มีพนักงานมากกว่าคือชื่อมาตรฐานทุกกรณี) */
        var bestFreq = -1;
        for (var i=0; i<employees.length; i++) {
          if (!_certEmpMatch(cp, employees[i].norm)) continue;
          matchType = 'exact';
          if (!found) found = employees[i];
          var eb = String(employees[i].branch || '').trim();
          if (!eb) continue;
          var f = _FH_BRANCH_FREQ[eb] || 0;
          if (f > bestFreq) { bestFreq = f; found = employees[i]; }
        }
        // 2) Whitespace-stripped full-name compare (กัน zero-width/NBSP/อักขระเพี้ยน)
        if (!found) {
          var certStripped = String(cert.name).replace(/[\s ​-‏]/g,'');
          for (var i=0; i<employees.length; i++) {
            var empStripped = String(employees[i].norm).replace(/[\s ​-‏]/g,'');
            if (certStripped && certStripped === empStripped) {
              found = employees[i]; matchType = 'exact'; break;
            }
          }
        }
        // ❌ ตัด lastname-only fallback ออก — ต้องตรงทั้ง first+last เท่านั้น
      }

      var expStatus = getExpStatus(cert.expireDate);
      raw.push({
        no: idx+1,
        certName: cert.name,
        course: cert.course,
        trainDate: cert.trainDate,
        expireDate: cert.expireDate,
        expStatus: expStatus,
        /* หาไม่เจอ หรือเจอแต่ทะเบียนไม่ได้ระบุสาขา → เว้นว่างไว้ ('—' = ช่องว่างในตาราง)
           แต่ใบรับรองยังถูกเก็บและแสดงในระบบตามปกติ ไม่ถูกทิ้ง */
        empName: found ? found.norm : '',
        branch: (found && String(found.branch || '').trim()) ? found.branch : '—',
        position: (found && String(found.position || '').trim()) ? found.position : '—',
        sheet: (found && String(found.sheet || '').trim()) ? found.sheet : '—',
        matchType: matchType
      });
    });

    // สะสม: รวมของเดิม (ที่โหลดมา) + ใบใหม่ แล้วตัดซ้ำ ชื่อ+วันหมดอายุ+หลักสูตร
    // (กันของเดิมหายตอน save ทับ · ใบใหม่ทับข้อมูลเดิมของคนเดิมได้ ถ้า key เดียวกัน)
    var totalPdf = raw.length;
    var _prev = Array.isArray(matchData) ? matchData : [];
    var _ck = function(d){ return normalizeName(d.certName||'').replace(/\s+/g,'') + '|' + (d.course||''); };
    var _mkey = function(d){ return _ck(d) + '|' + (d.expireDate||''); };
    var _hasExp = function(d){ return !!(d.expireDate && String(d.expireDate).trim()); };
    // ชื่อ+หลักสูตร ที่ "ใบใหม่" อ่านวันหมดอายุได้แล้ว → ใช้ทับใบเก่าที่วันว่าง
    // (กันซ้ำตอน re-upload เพื่อเติมวันหมดอายุ — เก่าวันว่าง+ใหม่มีวัน key ต่างกันเลยไม่ merge เอง)
    var _freshDated = {};
    raw.forEach(function(d){ if (_hasExp(d)) _freshDated[_ck(d)] = true; });
    var _mseen = {}, _merged = [];
    // เอาใบใหม่ก่อน (ให้ค่าจับคู่ล่าสุดชนะ) แล้วตามด้วยของเดิม
    raw.concat(_prev).forEach(function(d){
      if (!(d.certName && String(d.certName).trim())) return;
      // ข้ามใบวันว่าง ถ้ามีใบใหม่ (ชื่อ+หลักสูตรเดียวกัน) ที่อ่านวันหมดอายุได้แล้ว
      if (!_hasExp(d) && _freshDated[_ck(d)]) return;
      var k = _mkey(d);
      if (_mseen[k]) return;
      _mseen[k] = true; _merged.push(d);
    });
    matchData = _merged;
    _canonicalizeBranches(matchData);   // รวมชื่อสาขาที่สะกดต่างเล็กน้อยให้เป็นอันเดียว
    var nMatched = raw.filter(function(d){ return d.matchType !== 'notfound'; }).length;
    // Renumber
    matchData.forEach(function(d, i){ d.no = i + 1; });

    document.getElementById('processBtn').innerHTML = '&#9889; จับคู่ข้อมูล';
    document.getElementById('processBtn').disabled = false;
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('saveBtn').disabled = false;
    (document.getElementById('noteBar')||{classList:{add:function(){}}}).classList.add('show');
    updateStats();
    renderTable();
    if (typeof _refreshAdminReqCerts === 'function') _refreshAdminReqCerts();

    console.log('[DIAG MATCH] pdfData=' + (pdfData?pdfData.length:0) + ' empData=' + (empData?empData.length:0) + ' → matchData=' + matchData.length + ' (จับคู่ได้=' + nMatched + ')');
    document.getElementById('processInfo').textContent = 'นำเข้า ' + matchData.length + ' ใบ (จับคู่ทะเบียนได้ ' + nMatched + ' · ยังไม่เจอ ' + (totalPdf - nMatched) + ') — กำลังบันทึก Cloud...';
    document.getElementById('topStatus').textContent = 'Matched · ' + new Date().toLocaleTimeString('th-TH');
    // Auto-save to cloud
    setTimeout(function(){
      if (matchData.length > 0) saveToCloud();
      else window._fhImportBusy = false;   // ไม่มีอะไรบันทึก — จบ
    }, 400);
  }, 300);
}

/* ─────────── UI HELPERS ─────────── */
function setStatus(type, state, msg) {
  var dot = document.getElementById(type+'Dot');
  var txt = document.getElementById(type+'StatusText');
  dot.className = 'status-dot ' + state;
  txt.textContent = msg;
  txt.style.color = state==='done'?'var(--green)':state==='error'?'var(--red)':state==='loading'?'var(--orange)':'var(--text3)';
  if (typeof updateStepper === 'function') updateStepper();
}
function showProg(type) { document.getElementById(type+'Prog').style.display='block'; }
function setProg(type, pct) { document.getElementById(type+'Fill').style.width = pct+'%'; }
function checkReady() {
  var ready = pdfData !== null;
  console.log('[DIAG checkReady] pdfData=' + (pdfData?pdfData.length:'null') + ' empData=' + (empData?empData.length:'null'));
  var pb = document.getElementById('processBtn');
  if (pb) pb.disabled = !ready;
  if (!ready) return;
  // มีทะเบียนใน memory แล้ว → จับคู่เลย
  if (empData && empData.length > 0) {
    document.getElementById('processInfo').textContent = 'จับคู่อัตโนมัติ...';
    setTimeout(processMatch, 200);
    return;
  }
  // ยังไม่มีทะเบียน → ลองโหลดจาก cloud ก่อน แล้ว "จับคู่+แสดงเสมอ"
  // (ถ้าไม่มีทะเบียน ใบที่อัปก็ยังขึ้น — จับคู่ทีหลังได้เมื่อทะเบียนพร้อม)
  document.getElementById('processInfo').textContent = 'PDF โหลดแล้ว · กำลังเตรียมข้อมูล...';
  setStatus('pdf', 'loading', 'กำลังเตรียมข้อมูล...');
  function _matchAnyway() {
    setStatus('pdf', 'done', 'พร้อมแล้ว — กำลังแสดงข้อมูล...');
    setTimeout(processMatch, 200);
  }
  if (typeof loadEmployeeRegistryFromCloud === 'function') {
    loadEmployeeRegistryFromCloud().then(_matchAnyway).catch(_matchAnyway);
  } else {
    _matchAnyway();
  }
}

// Filter matchData by branch+course only (ไม่นับ expFilter) — ใช้คำนวณ 4 กล่องตามที่ผู้ใช้เลือก dropdown
function getFilteredForStats_() {
  var brf = (document.getElementById('branchFilter')||{value:'all'}).value;
  var cof = (document.getElementById('courseFilter')||{value:'all'}).value;
  return matchData.filter(function(d){
    if (brf !== 'all' && d.branch !== brf) return false;
    if (cof !== 'all' && d.course !== cof) return false;
    return true;
  });
}

function updateStats() {
  var dAll = matchData;
  // 4 กล่อง + chips: นับตามที่เลือก branch/course (ไม่นับ exp chip ตัวเอง)
  var d = getFilteredForStats_();
  document.getElementById('statsRow').style.display = dAll.length ? 'grid' : 'none';
  document.getElementById('sTotal').textContent = d.length;
  var nValid = d.filter(function(r){return r.expStatus==='valid';}).length;
  var nWarn  = d.filter(function(r){return r.expStatus==='warning';}).length;
  var nExp   = d.filter(function(r){return r.expStatus==='expired';}).length;
  document.getElementById('sValid').textContent = nValid;
  document.getElementById('sWarn').textContent  = nWarn;
  document.getElementById('sExp').textContent   = nExp;
  // % indicators (share of total)
  var pct = function(n) { return d.length > 0 ? Math.round(n / d.length * 1000) / 10 + '%' : ''; };
  var totEl = document.getElementById('sTotalPct'); if (totEl) totEl.textContent = '100%';
  var vEl = document.getElementById('sValidPct'); if (vEl) vEl.textContent = pct(nValid);
  var wEl = document.getElementById('sWarnPct');  if (wEl) wEl.textContent = pct(nWarn);
  var eEl = document.getElementById('sExpPct');   if (eEl) eEl.textContent = pct(nExp);
  // Hidden legacy match-type counts (kept for compat)
  document.getElementById('sExact').textContent = dAll.filter(function(r){return r.matchType==='exact';}).length;
  document.getElementById('sLast').textContent  = dAll.filter(function(r){return r.matchType==='lastname';}).length;
  document.getElementById('sNone').textContent  = dAll.filter(function(r){return r.matchType==='notfound';}).length;
  // Exp-status dropdown — ใส่จำนวนใน option (sync กับการ์ด)
  var chipsEl = document.getElementById('matchChips');
  if (chipsEl) {
    chipsEl.style.display = dAll.length ? 'flex' : 'none';
    var efSel = document.getElementById('expFilter');
    if (efSel && efSel.options.length >= 4) {
      efSel.options[0].text = '📋 ทั้งหมด (' + d.length + ')';
      efSel.options[1].text = '✓ ยังมีผล (' + nValid + ')';
      efSel.options[2].text = '⚠ ใกล้หมดอายุ (' + nWarn + ')';
      efSel.options[3].text = '✗ หมดอายุ (' + nExp + ')';
    }
  }
  // Populate branch + course filter dropdowns (ครั้งแรกหลังโหลดข้อมูล)
  populateFilterDropdowns_();
  if (typeof updateStepper === 'function') updateStepper();
}

function populateFilterDropdowns_() {
  var brSel = document.getElementById('branchFilter');
  var coSel = document.getElementById('courseFilter');
  var bdSel = document.getElementById('brandFilter');
  if (!brSel || !coSel) return;
  var brSet = {}, coSet = {}, bdSet = {};
  matchData.forEach(function(d){
    if (d.branch && d.branch !== '—') brSet[d.branch] = true;
    if (d.course) coSet[d.course] = true;
    var bd = _certBrand(d); if (bd && bd !== '—') bdSet[bd] = true;
  });
  var currBr = brSel.value, currCo = coSel.value;
  /* โชว์ "รหัส · ชื่อสาขา" และเรียงตามรหัส (สาขาที่ไม่มีรหัสในทะเบียนไปท้ายสุด)
     value ยังเป็น "ชื่อสาขา" เหมือนเดิม — ตัวกรอง (d.branch === brf) จึงทำงานปกติ */
  brSel.innerHTML = '<option value="all">🏢 ทุกสาขา</option>' + Object.keys(brSet).sort(function(a, b){
    var ca = _branchCodeOf(a), cb = _branchCodeOf(b);
    if (ca && cb) return ca === cb ? a.localeCompare(b) : (ca < cb ? -1 : 1);
    if (ca) return -1;
    if (cb) return 1;
    return a.localeCompare(b);
  }).map(function(b){
    var c = _branchCodeOf(b);
    return '<option value="'+escapeAttr(b)+'"'+(b===currBr?' selected':'')+'>'+escapeHtml(c ? (c + ' · ' + b) : b)+'</option>';
  }).join('');
  coSel.innerHTML = '<option value="all">📚 ทุกหลักสูตร</option>' + Object.keys(coSet).sort().map(function(c){
    return '<option value="'+escapeAttr(c)+'"'+(c===currCo?' selected':'')+'>'+escapeHtml(_courseShort(c))+'</option>';
  }).join('');
  if (bdSel) {
    var currBd = bdSel.value;
    bdSel.innerHTML = '<option value="all">🏷️ ทุกแบรนด์</option>' + Object.keys(bdSet).sort().map(function(b){
      return '<option value="'+escapeAttr(b)+'"'+(b===currBd?' selected':'')+'>'+escapeHtml(b)+'</option>';
    }).join('');
  }
}

function setExpFilter(val) {
  var sel = document.getElementById('expFilter');
  if (sel) sel.value = val;
  // Sync chip active state
  document.querySelectorAll('.exp-status-chip').forEach(function(el){
    if (el.getAttribute('data-ef') === val) el.classList.add('active');
    else el.classList.remove('active');
  });
  _tablePage = 1;
  renderTable();
}

function getFiltered() {
  var q = (document.getElementById('searchQ')||{value:''}).value.trim().toLowerCase();
  var mf = (document.getElementById('matchFilter')||{value:'all'}).value;
  var ef = (document.getElementById('expFilter')||{value:'all'}).value;
  var sf = (document.getElementById('sheetFilter')||{value:'all'}).value;
  var brf = (document.getElementById('branchFilter')||{value:'all'}).value;
  var cof = (document.getElementById('courseFilter')||{value:'all'}).value;
  var bdf = (document.getElementById('brandFilter')||{value:'all'}).value;
  return matchData.filter(function(d) {
    var ok = true;
    if (q) ok = ok && (d.certName+d.empName+d.branch+d.position).toLowerCase().indexOf(q)>=0;
    if (mf!=='all') ok = ok && d.matchType===mf;
    if (ef!=='all') ok = ok && d.expStatus===ef;
    if (sf!=='all') ok = ok && d.sheet===sf;
    if (brf!=='all') ok = ok && d.branch===brf;
    if (cof!=='all') ok = ok && d.course===cof;
    if (bdf!=='all') ok = ok && _certBrand(d)===bdf;
    return ok;
  });
}

function getExpBadge(s) {
  if (s==='expired') return '<span class="exp-badge exp-over"><span class="dot"></span>หมดอายุ</span>';
  if (s==='warning') return '<span class="exp-badge exp-warn"><span class="dot"></span>ใกล้หมดอายุ</span>';
  if (s==='valid') return '<span class="exp-badge exp-ok"><span class="dot"></span>ยังมีผล</span>';
  return '<span style="color:var(--text3)">—</span>';
}
function getMatchBadge(t) {
  if (t==='exact') return '<span class="mbadge mb-exact"><span class="dot"></span>ตรงสนิท</span>';
  if (t==='lastname') return '<span class="mbadge mb-last"><span class="dot"></span>&#9888; นามสกุลตรง</span>';
  if (t==='notfound') return '<span class="mbadge mb-none"><span class="dot"></span>ไม่พบ</span>';
  return '<span class="mbadge mb-notloaded">—</span>';
}
function getSheetTag(s) {
  if (!s||s==='—') return '<span style="color:var(--text3)">—</span>';
  return '<span class="sheet-tag st-'+s+'">'+s+'</span>';
}
/* แบรนด์ของแถวใบรับรอง — ดึงรหัสสาขาจากช่องสาขา แล้วแปลงเป็นชื่อแบรนด์ (fallback: Sheet) */
function _certBrand(d) {
  // ยึดชื่อแบรนด์จริงจากทะเบียน (sheet) ก่อน
  if (d && d.sheet && d.sheet !== '—' && String(d.sheet).trim()) return String(d.sheet).trim();
  // ไม่มี → เดาจากรหัสนำหน้าสาขา (50→Santa Fe ฯลฯ)
  var m = String((d && d.branch) || '').match(/(\d{3,})/);
  var b = getBranchPrefix(m ? m[1] : '');
  return b || '—';
}
function _certBrandTag(d) {
  var b = _certBrand(d);
  if (b === '—') return '<span style="color:var(--text3)">—</span>';
  return '<span style="font-size:12px;font-weight:700;color:var(--text2);white-space:nowrap;">' + escapeHtml(b) + '</span>';
}
/* ย่อชื่อหลักสูตร — ตัด "การสุขาภิบาลอาหาร สำหรับ" ออก (แสดงผลเท่านั้น ค่าจริงไม่เปลี่ยน) */
function _courseShort(c) {
  var s = String(c || '').replace(/^\s*การสุขาภิบาลอาหาร\s*/,'').replace(/^สำหรับ\s*/,'').trim();
  return s || String(c || '');
}

var _tablePage = 1;
function _TABLE_PER_PAGE() { return window.innerWidth <= 768 ? 10 : 20; }
function renderTable() {
  // อัปเดต 4 กล่อง + chips ก่อน render (เผื่อ user เพิ่งเปลี่ยน dropdown สาขา/หลักสูตร)
  if (typeof updateStats === 'function') updateStats();
  _fhResetSelIfFilterChanged('ad');   // เปลี่ยนตัวกรอง → ล้างที่ติ๊กไว้ก่อนวาดช่องติ๊ก
  var filtered = getFiltered();
  var tbody = document.getElementById('tableBody');
  var perPage = _TABLE_PER_PAGE();
  var totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (_tablePage > totalPages) _tablePage = totalPages;
  if (_tablePage < 1) _tablePage = 1;
  var start = (_tablePage - 1) * perPage;
  var pageRows = filtered.slice(start, start + perPage);

  document.getElementById('countLine').innerHTML = 'แสดง <em>'+pageRows.length+'</em> รายการ (จากทั้งหมด '+filtered.length+(filtered.length<matchData.length?'/'+matchData.length:'')+') · หน้า '+_tablePage+'/'+totalPages;

  if (filtered.length===0) {
    tbody.innerHTML='<tr><td colspan="9" class="empty">ไม่พบข้อมูลที่ค้นหา</td></tr>';
    renderTablePagination_(totalPages);
    fhUpdateSelBar('ad');
    if (typeof fhUpdateFilterBadge === 'function') fhUpdateFilterBadge();
    return;
  }
  tbody.innerHTML = pageRows.map(function(d){
    return '<tr data-st="'+escapeAttr(d.expStatus || 'unknown')+'">'
      +'<td class="td-chk" data-label="เลือก" data-icon="☑️">'+_fhChkHtml('ad', d.certName, d.course)+'</td>'
      +'<td class="no-txt" data-label="ลำดับ" data-icon="🔢">'+d.no+'</td>'
      +'<td data-label="แบรนด์" data-icon="🏷">'+_certBrandTag(d)+'</td>'
      +'<td data-label="หลักสูตร" data-icon="📚" style="color:var(--text3);font-size:11px;max-width:180px;">'+escapeHtml(_courseShort(d.course))+'</td>'
      +'<td data-label="สาขา" data-icon="🏢" class="branch-txt">'+d.branch+'</td>'
      +'<td class="cert-name" data-label="ชื่อ" data-icon="📜">'+d.certName+'</td>'
      +'<td data-label="วันหมดอายุ" data-icon="⏰" style="white-space:nowrap;font-size:12px;color:var(--text2);">'+formatThaiDate(d.expireDate)+'</td>'
      +'<td data-label="สถานะ" data-icon="🏷">'+getExpBadge(d.expStatus)+'</td>'
      +'<td data-label="จัดการ" data-icon="⚙️" class="td-row-actions">'
      +   '<button class="btn-row-view" onclick="openCertDetailModal('+d.no+')" title="ดูรายละเอียด">👁</button>'
      +   ((_fhCertUrl(d.certName, d.course)) ? '<a class="btn-row-view" href="'+_fhCertUrl(d.certName, d.course)+'" onclick="return fhDownloadOneCert(event, this.href, '+d.no+')" title="ดาวน์โหลดใบเซอร์ (ตั้งชื่อไฟล์ตามชื่อบนใบ)" style="text-decoration:none;">⬇️</a>' : '')
      +   '<button class="btn-del-row" onclick="deleteMatchRow('+d.no+')" title="ลบรายการนี้">🗑</button>'
      +'</td>'
      +'</tr>';
  }).join('');
  renderTablePagination_(totalPages);
  fhUpdateSelBar('ad');
  if (typeof fhUpdateFilterBadge === 'function') fhUpdateFilterBadge();
}
function renderTablePagination_(totalPages) {
  var pagEl = document.getElementById('tablePagination');
  if (!pagEl) return;
  if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
  var html = '';
  html += '<button class="pg-btn" '+(_tablePage<=1?'disabled':'')+' onclick="gotoTablePage(_tablePage-1)">‹</button>';
  // Page number buttons (windowed if many)
  var maxBtns = 7;
  var startP = Math.max(1, _tablePage - Math.floor(maxBtns/2));
  var endP = Math.min(totalPages, startP + maxBtns - 1);
  if (endP - startP < maxBtns - 1) startP = Math.max(1, endP - maxBtns + 1);
  if (startP > 1) html += '<button class="pg-btn" onclick="gotoTablePage(1)">1</button>' + (startP > 2 ? '<span class="pg-dots">…</span>' : '');
  for (var p = startP; p <= endP; p++) {
    html += '<button class="pg-btn'+(p===_tablePage?' active':'')+'" onclick="gotoTablePage('+p+')">'+p+'</button>';
  }
  if (endP < totalPages) html += (endP < totalPages-1 ? '<span class="pg-dots">…</span>' : '') + '<button class="pg-btn" onclick="gotoTablePage('+totalPages+')">'+totalPages+'</button>';
  html += '<button class="pg-btn" '+(_tablePage>=totalPages?'disabled':'')+' onclick="gotoTablePage(_tablePage+1)">›</button>';
  pagEl.innerHTML = html;
}
function gotoTablePage(p) {
  _tablePage = p;
  renderTable();
  // Scroll to table top
  var el = document.getElementById('mainTable');
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ═══════════ ติ๊กเลือกหลายใบ → ดาวน์โหลดรวมเป็น PDF ไฟล์เดียว ═══════════
   scope 'ad' = ตารางฝั่งแอดมิน (#mainTable) · 'br' = ตารางฝั่งสาขา (#branchCertTable)
   เก็บที่เลือกด้วย key(ชื่อ|หลักสูตร) → ติ๊กค้างข้ามหน้า/ข้ามการกรองได้ */
var _certSel = { ad: {}, br: {} };
var _selSig  = { ad: null, br: null };   // ลายเซ็นตัวกรองล่าสุด — เปลี่ยนกรอง = ล้างที่เลือก
var _brLastResults = [];   // ผลค้นหาล่าสุดฝั่งสาขา (ใช้ตอนกด "เลือกทั้งหมด")

function _fhSelStore(scope) { return _certSel[scope === 'br' ? 'br' : 'ad']; }
function _fhSelIds(scope) {
  return scope === 'br'
    ? { bar:'brSelBar', count:'brSelCount', btn:'brSelDlBtn', btnEach:'brSelDlEachBtn', all:'brChkAll' }
    : { bar:'certSelBar', count:'certSelCount', btn:'certSelDlBtn', btnEach:'certSelDlEachBtn', all:'certChkAll' };
}
/* checkbox 1 ช่อง — ไม่มีไฟล์ใบเซอร์ = ติ๊กไม่ได้ */
function _fhChkHtml(scope, name, course) {
  var url = _fhCertUrl(name, course);
  if (!url) return '<input type="checkbox" class="chk-cert" disabled title="ยังไม่มีไฟล์ใบเซอร์ในระบบ">';
  var k = _fhCertKey(name, course);
  return '<input type="checkbox" class="chk-cert"'
    + (_fhSelStore(scope)[k] ? ' checked' : '')
    + ' data-k="' + escapeAttr(k) + '"'
    + ' data-n="' + escapeAttr(name || '') + '"'
    + ' data-c="' + escapeAttr(course || '') + '"'
    + ' data-u="' + escapeAttr(url) + '"'
    + ' onclick="fhToggleSel(this,\'' + scope + '\')" title="เลือกเพื่อดาวน์โหลด">';
}
function fhToggleSel(el, scope) {
  var store = _fhSelStore(scope);
  var k = el.getAttribute('data-k');
  if (!k) return;
  if (el.checked) store[k] = { name: el.getAttribute('data-n'), course: el.getAttribute('data-c'), url: el.getAttribute('data-u') };
  else delete store[k];
  fhUpdateSelBar(scope);
}
/* เลือกทุกรายการที่กรองอยู่ (ทุกหน้า ไม่ใช่เฉพาะหน้าปัจจุบัน) */
function fhSelectAllCerts(scope, on) {
  var store = _fhSelStore(scope);
  var rows = scope === 'br'
    ? (_brLastResults || []).map(function(r){ return { name: r['ชื่อในใบรับรอง'], course: r['หลักสูตร'] }; })
    : getFiltered().map(function(d){ return { name: d.certName, course: d.course }; });
  rows.forEach(function(x){
    var url = _fhCertUrl(x.name, x.course);
    if (!url) return;
    var k = _fhCertKey(x.name, x.course);
    if (on) store[k] = { name: x.name, course: x.course, url: url };
    else delete store[k];
  });
  _fhSyncChkBoxes(scope);
  fhUpdateSelBar(scope);
}
function fhClearSel(scope) {
  _certSel[scope === 'br' ? 'br' : 'ad'] = {};
  _fhSyncChkBoxes(scope);
  fhUpdateSelBar(scope);
}
/* อัปเดตสถานะ checkbox ที่แสดงอยู่บนจอ (ไม่ต้อง re-render ตารางทั้งหมด) */
function _fhSyncChkBoxes(scope) {
  var store = _fhSelStore(scope);
  var tbl = document.getElementById(scope === 'br' ? 'branchCertTable' : 'mainTable');
  if (!tbl) return;
  var boxes = tbl.querySelectorAll('tbody input.chk-cert[data-k]');
  for (var i = 0; i < boxes.length; i++) boxes[i].checked = !!store[boxes[i].getAttribute('data-k')];
}
/* ลายเซ็นของตัวกรองปัจจุบัน — ใช้เช็กว่าผู้ใช้เปลี่ยนเงื่อนไขหรือยัง */
function _fhCurSig(scope) {
  var g = function(id){ return (document.getElementById(id) || { value:'' }).value; };
  if (scope === 'br') return 'br|' + g('branchSearchQ').trim().toLowerCase();
  return ['ad', g('searchQ').trim().toLowerCase(), g('matchFilter'), g('expFilter'),
          g('sheetFilter'), g('branchFilter'), g('courseFilter'), g('brandFilter')].join('|');
}
/* เปลี่ยนตัวกรอง/คำค้น = เริ่มเลือกใหม่ (กันของที่ติ๊กค้างจากชุดก่อนหน้ามานับรวม)
   เปลี่ยนหน้า (pagination) ลายเซ็นไม่เปลี่ยน → ที่ติ๊กไว้ยังอยู่ */
function _fhResetSelIfFilterChanged(scope) {
  var key = scope === 'br' ? 'br' : 'ad';
  var sig = _fhCurSig(scope);
  if (_selSig[key] !== null && _selSig[key] !== sig) _certSel[key] = {};
  _selSig[key] = sig;
}
function fhUpdateSelBar(scope) {
  _fhResetSelIfFilterChanged(scope);
  var ids = _fhSelIds(scope);
  var store = _fhSelStore(scope);
  var n = Object.keys(store).length;
  var bar = document.getElementById(ids.bar);
  var cnt = document.getElementById(ids.count);
  if (cnt) cnt.textContent = n;
  if (bar) bar.classList.toggle('show', n > 0);
  // หัวตาราง: ติ๊กครบทุกรายการที่มีไฟล์ = ติ๊กหัวด้วย
  var all = document.getElementById(ids.all);
  if (all) {
    var pool = scope === 'br'
      ? (_brLastResults || []).map(function(r){ return _fhCertUrl(r['ชื่อในใบรับรอง'], r['หลักสูตร']) ? _fhCertKey(r['ชื่อในใบรับรอง'], r['หลักสูตร']) : null; })
      : (typeof matchData !== 'undefined' && matchData.length ? getFiltered() : []).map(function(d){ return _fhCertUrl(d.certName, d.course) ? _fhCertKey(d.certName, d.course) : null; });
    pool = pool.filter(Boolean);
    var picked = pool.filter(function(k){ return !!store[k]; }).length;
    all.checked = pool.length > 0 && picked === pool.length;
    all.indeterminate = picked > 0 && picked < pool.length;
    all.disabled = pool.length === 0;
  }
}
function _fhStamp() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
/* ชื่อไฟล์ = ชื่อ-นามสกุลบนใบเซอร์ (ตัดคำนำหน้า + อักขระที่ตั้งชื่อไฟล์ไม่ได้)
   Windows ห้าม \ / : * ? " < > | และห้ามลงท้ายด้วยจุด/ช่องว่าง */
function _fhFileName(name) {
  var parts = (typeof _stripTitleTokens === 'function')
    ? _stripTitleTokens(normalizeName(name || ''))
    : String(name || '').split(/\s+/);
  var s = parts.join(' ').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (s.length > 80) s = s.slice(0, 80).trim();
  return s || 'ใบรับรอง';
}
/* กันชื่อไฟล์ชนกัน — คนชื่อเดียวกัน/ใบหลายหลักสูตร ต่อท้าย (2) (3) */
function _fhUniqueName(used, base) {
  var n = base, i = 1;
  while (used[n]) { i++; n = base + ' (' + i + ')'; }
  used[n] = 1;
  return n;
}
function _fhTriggerDownload(blobUrl, filename) {
  var a = document.createElement('a');
  a.href = blobUrl; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
/* ดาวน์โหลดใบเดียว โดยตั้งชื่อไฟล์ตามชื่อบนใบรับรอง
   ของเดิมเป็นแค่ <a href> ธรรมดา ไฟล์อยู่คนละโดเมน เบราว์เซอร์จึงไม่สนใจ
   แอตทริบิวต์ download แล้วเซฟด้วยชื่อไฟล์ดิบใน storage (เป็นรหัสยาว ๆ)
   ต้องดึงไฟล์มาเป็น blob ในโดเมนเราก่อน ถึงจะตั้งชื่อได้จริง
   ถ้าดึงไม่ได้ (เน็ต/CORS) → ถอยไปเปิดแท็บใหม่แบบเดิม ดีกว่าไม่ได้อะไรเลย */
function fhDownloadOneCert(ev, url, noOrName) {
  if (ev && ev.preventDefault) { ev.preventDefault(); ev.stopPropagation(); }
  if (!url) return false;
  /* รับเป็นเลขลำดับแล้วไปหาชื่อเอง ปลอดภัยกว่ายัดชื่อคนลงใน onclick
     (ชื่อไทยมีเครื่องหมายคำพูด/อัญประกาศปนได้ ทำให้ HTML แตก)
     ฝั่งสาขาไม่มีเลขลำดับกลาง จึงส่งชื่อมาทาง data-attribute แทน รับได้ทั้งสองแบบ */
  var name = '';
  if (typeof noOrName === 'number') {
    try {
      var hit = (matchData || []).filter(function(x){ return x.no === noOrName; })[0];
      name = hit ? (hit.certName || hit.empName || '') : '';
    } catch (e) {}
  } else {
    name = String(noOrName || '');
  }
  var a = (ev && ev.currentTarget) ? ev.currentTarget : null;
  var orig = a ? a.innerHTML : '';
  if (a) { a.innerHTML = '⏳'; a.style.pointerEvents = 'none'; }
  var done = function(){ if (a) { a.innerHTML = orig; a.style.pointerEvents = ''; } };

  fetch(url, { cache: 'no-store' })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
    .then(function(blob){
      var ext = /\.(jpe?g|png)(\?|$)/i.test(url) ? (RegExp.$1.toLowerCase() === 'png' ? '.png' : '.jpg') : '.pdf';
      var burl = URL.createObjectURL(blob);
      _fhTriggerDownload(burl, _fhFileName(name) + ext);
      setTimeout(function(){ URL.revokeObjectURL(burl); }, 8000);
      done();
    })
    .catch(function(){
      done();
      window.open(url, '_blank', 'noopener');   // ถอยไปเปิดแท็บ ชื่อไฟล์จะเป็นของเดิม
    });
  return false;
}

/* ดาวน์โหลดที่เลือก — โหลดไฟล์ทีละใบแล้วรวมเป็น PDF เดียว (พิมพ์/ส่งต่อได้ทีเดียว)
   ถ้าโหลดตรงไม่ได้ (CORS/เน็ต) → ถอยไปเปิดทีละแท็บให้แทน */
function fhDownloadSelected(scope) {
  var store = _fhSelStore(scope);
  var items = Object.keys(store).map(function(k){ return store[k]; }).filter(function(x){ return x && x.url; });
  if (!items.length) { showInfo('ยังไม่ได้เลือก', 'ติ๊ก ☑️ หน้ารายการที่ต้องการก่อน แล้วกดดาวน์โหลดอีกครั้ง'); return; }
  items.sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''), 'th'); });
  // ไฟล์เดียวกันอาจผูกหลายคน (กรณีอัปทั้งไฟล์ไม่ได้ตัดหน้า) → ตัด URL ซ้ำออก
  var seen = {}, uniq = [];
  items.forEach(function(it){ if (seen[it.url]) return; seen[it.url] = 1; uniq.push(it); });

  var ids = _fhSelIds(scope);
  var btn = document.getElementById(ids.btn);
  var origHtml = btn ? btn.innerHTML : '';
  var setTxt = function(t){ if (btn) btn.innerHTML = t; };
  var restore = function(){ if (btn) { btn.disabled = false; btn.innerHTML = origHtml; } };
  if (btn) btn.disabled = true;

  if (typeof PDFLib === 'undefined') { restore(); _fhOpenEachTab(uniq); return; }

  var bufs = [], failed = [];
  var chain = Promise.resolve();
  uniq.forEach(function(it, i){
    chain = chain.then(function(){
      setTxt('⏳ กำลังโหลด ' + (i+1) + '/' + uniq.length + '...');
      return fetch(it.url, { cache: 'no-store' })
        .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then(function(buf){ bufs.push({ it: it, buf: buf }); })
        .catch(function(){ failed.push(it.name || it.url); });
    });
  });

  chain.then(function(){
    if (!bufs.length) throw new Error('NOFETCH');
    setTxt('⏳ กำลังรวมไฟล์...');
    return PDFLib.PDFDocument.create().then(function(out){
      var c2 = Promise.resolve();
      bufs.forEach(function(b){
        c2 = c2.then(function(){
          return PDFLib.PDFDocument.load(b.buf, { ignoreEncryption: true })
            .then(function(src){ return out.copyPages(src, src.getPageIndices()); })
            .then(function(pages){ pages.forEach(function(p){ out.addPage(p); }); })
            .catch(function(){ failed.push(b.it.name || ''); });
        });
      });
      return c2.then(function(){
        if (out.getPageCount() === 0) throw new Error('NOPAGE');
        return out.save();
      });
    });
  }).then(function(bytes){
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    /* เลือกใบเดียว → ตั้งชื่อไฟล์เป็นชื่อ-นามสกุลบนใบเซอร์เลย จะได้หาไฟล์เจอ
       เลือกหลายใบ → รวมเป็นไฟล์เดียว ตั้งชื่อตามจำนวน (อยากได้แยกไฟล์ตามชื่อ ใช้ปุ่ม "แยกไฟล์") */
    var fname = (uniq.length === 1)
      ? _fhFileName(uniq[0].name) + '.pdf'
      : 'ใบรับรอง_' + (uniq.length - failed.length) + 'ใบ_' + _fhStamp() + '.pdf';
    _fhTriggerDownload(url, fname);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
    restore();
    showInfo('ดาวน์โหลดแล้ว',
      'รวม <b>' + (uniq.length - failed.length) + '</b> ใบเป็นไฟล์ PDF เดียว'
      + (failed.length ? '<div style="margin-top:8px;color:#b45309;font-size:13px;">⚠️ โหลดไม่สำเร็จ ' + failed.length + ' ใบ: ' + escapeHtml(failed.slice(0,5).join(', ')) + (failed.length > 5 ? ' ...' : '') + '</div>' : ''));
  }).catch(function(e){
    restore();
    if (e && (e.message === 'NOFETCH' || e.message === 'NOPAGE')) { _fhOpenEachTab(uniq); return; }
    showInfo('ดาวน์โหลดไม่สำเร็จ', escapeHtml((e && e.message) || String(e)));
  });
}
/* ดาวน์โหลดที่เลือก แบบ "แยกไฟล์" — ได้ไฟล์ละคน ตั้งชื่อตามชื่อ-นามสกุลบนใบเซอร์
   ใช้ตอนต้องส่งใบเซอร์รายคน (แนบเมล/อัปเข้าแฟ้มพนักงาน) ซึ่งไฟล์รวมใช้ไม่ได้
   เบราว์เซอร์จะถามอนุญาต "ดาวน์โหลดหลายไฟล์" ครั้งเดียว ต้องกดอนุญาต */
function fhDownloadSelectedEach(scope) {
  var store = _fhSelStore(scope);
  var items = Object.keys(store).map(function(k){ return store[k]; }).filter(function(x){ return x && x.url; });
  if (!items.length) { showInfo('ยังไม่ได้เลือก', 'ติ๊ก ☑️ หน้ารายการที่ต้องการก่อน แล้วกดอีกครั้ง'); return; }
  items.sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''), 'th'); });

  var ids = _fhSelIds(scope);
  var btn = document.getElementById(ids.btnEach);
  var origHtml = btn ? btn.innerHTML : '';
  var restore = function(){ if (btn) { btn.disabled = false; btn.innerHTML = origHtml; } };
  if (btn) btn.disabled = true;

  var used = {}, okN = 0, failed = [];
  var chain = Promise.resolve();
  items.forEach(function(it, i){
    chain = chain.then(function(){
      if (btn) btn.innerHTML = '⏳ ' + (i+1) + '/' + items.length;
      return fetch(it.url, { cache: 'no-store' })
        .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then(function(blob){
          var ext = /\.(jpe?g|png)(\?|$)/i.test(it.url) ? (RegExp.$1.toLowerCase() === 'png' ? '.png' : '.jpg') : '.pdf';
          var url = URL.createObjectURL(blob);
          _fhTriggerDownload(url, _fhUniqueName(used, _fhFileName(it.name)) + ext);
          setTimeout(function(){ URL.revokeObjectURL(url); }, 8000);
          okN++;
          /* เว้นจังหวะ ไม่งั้นเบราว์เซอร์กันว่ายิงดาวน์โหลดรัวเกินไปแล้วดรอปทิ้ง */
          return new Promise(function(res){ setTimeout(res, 250); });
        })
        .catch(function(){ failed.push(it.name || it.url); });
    });
  });
  chain.then(function(){
    restore();
    showInfo('ดาวน์โหลดแล้ว',
      'แยกเป็น <b>' + okN + '</b> ไฟล์ ตั้งชื่อตามชื่อ-นามสกุลบนใบเซอร์'
      + (failed.length ? '<div style="margin-top:8px;color:#b45309;font-size:13px;">⚠️ ไม่สำเร็จ ' + failed.length + ' ใบ: '
          + escapeHtml(failed.slice(0,5).join(', ')) + (failed.length > 5 ? ' ...' : '') + '</div>' : ''));
  });
}

/* รายงานใบรับรองย้ายไปอยู่ fh-report.js แล้ว (เลือกช่วงข้อมูลและคอลัมน์เองได้)
   ของเดิมสองฟังก์ชันนี้ยึดตัวกรองบนหน้าจอและคอลัมน์ตายตัว ไม่มีใครเรียกแล้ว จึงลบทิ้ง */


/* ถอยกรณีรวมไฟล์ไม่ได้ — เปิดใบเซอร์ทีละแท็บ (ต้องอนุญาต pop-up) */
function _fhOpenEachTab(list) {
  showInfo('รวมไฟล์ไม่ได้ — เปิดทีละใบแทน',
    'ระบบจะเปิดใบรับรอง ' + list.length + ' ใบในแท็บใหม่ (ถ้าเบราว์เซอร์บล็อกป๊อปอัป กรุณากด "อนุญาต")');
  list.forEach(function(it, i){ setTimeout(function(){ window.open(it.url, '_blank', 'noopener'); }, i * 350); });
}

function deleteMatchRow(no) {
  customConfirm({ icon:ICON_TRASH, title:'ลบรายการนี้?', desc:'จะลบออกจากตารางและ Cloud', okText:'ลบเลย' })
    .then(function(ok){ if (ok) doDeleteMatchRow(no); });
}
function doDeleteMatchRow(no) {
  var idx = matchData.findIndex(function(d){ return d.no === no; });
  if (idx < 0) return;
  matchData.splice(idx, 1);
  // Renumber
  matchData.forEach(function(d, i){ d.no = i + 1; });
  updateStats();
  renderTable();
  // Auto-save change to Cloud
  if (matchData.length > 0) {
    document.getElementById('processInfo').textContent = 'ลบรายการแล้ว · กำลังบันทึก Cloud...';
    setTimeout(saveToCloud, 200);
  } else {
    // ลบใบสุดท้าย → save-certificates ไม่รับ array ว่าง เลยต้องเรียก clear-certificates เพื่อล้าง Cloud จริง
    // (ไม่งั้นใบสุดท้ายยังค้างบน Cloud → รีเฟรชแล้วกลับมา)
    document.getElementById('processInfo').textContent = 'ลบรายการสุดท้ายแล้ว · กำลังล้าง Cloud...';
    _fhCacheSet('fh_cert_v1', []);
    if (SCRIPT_URL) {
      fetch(SCRIPT_URL, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'clear-certificates' })
      })
      .then(function(r){ return r.json(); })
      .then(function(){ document.getElementById('processInfo').textContent = 'ลบรายการสุดท้ายแล้ว · ไม่มีข้อมูลเหลือ'; })
      .catch(function(){ document.getElementById('processInfo').textContent = 'ลบแล้ว แต่ล้าง Cloud ไม่สำเร็จ — ลองกด "ลบใบรับรองทั้งหมด"'; });
    }
  }
}
