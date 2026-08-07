/* fh-auth.js — ล็อกอิน · สาขา/แบรนด์ · โมดัลรายละเอียด · เมนูข้าง
   แยกมาจาก food-handler.js (บรรทัดเดิม 1974-2590)
   ⚠️ ไฟล์ชุดนี้ต้องโหลดตามลำดับใน food-handler.html — อย่าสลับ */
/* ═════════════════════ LOGIN / AUTH ═════════════════════ */
var ADMIN_CODE = '601183';
var isAdminMode = false;
var BRANCHES = {
  '5001':'แฟชั่น ไอส์แลนด์','5002':'ซีคอนสแควร์ ศรีนครินทร์','5003':'เดอะมอลล์ ท่าพระ',
  '5004':'เซ็นทรัล รัตนาธิเบศร์','5005':'เดอะมอลล์ บางกะปิ','5007':'เซ็นทรัลพลาซา พระราม 2',
  '5010':'แพชชั่น ระยอง','5011':'เดอะมอลล์ งามวงศ์วาน','5012':'โลตัส บางพลี',
  '5014':'บิ๊กซี พัทยากลาง','5015':'แปซิฟิกพาร์ค ศรีราชา','5016':'อิมพีเรียลเวิลด์ สำโรง',
  '5017':'ซีคอน บางแค','5018':'เซ็นทรัล รามอินทรา','5019':'เทอร์มินัล 21 อโศก',
  '5021':'เซ็นทรัล ปิ่นเกล้า','5023':'บิ๊กซี พัทยาใต้','5024':'เดอะมอลล์ บางแค',
  '5026':'IT หลักสี่','5028':'โลตัส ปทุมธานี','5030':'เพลินนารี่ มอลล์',
  '5031':'เซ็นทรัล ศาลายา','5033':'โลตัส แจ้งวัฒนะ','5034':'โลตัส ศาลายา',
  '5035':'เซ็นทรัลพัทยา บีช','5036':'โลตัส บางปะกอก','5038':'เซ็นทรัล ระยอง',
  '5039':'เซ็นทรัล ชลบุรี','5040':'เซ็นทรัล Westgate','5042':'ฟิวเจอร์ปาร์ค รังสิต',
  '5045':'เดอะพรอมานาด','5046':'โลตัส บางกะปิ','5049':'โลตัส ชลบุรี',
  '5050':'บิ๊กซี บางพลี','5052':'โลตัส นวนคร','5054':'บิ๊กซี บางใหญ่',
  '5055':'โลตัส สุขาภิบาล 3','5057':'โลตัส รังสิต','5061':'บิ๊กซี สัตหีบ',
  '5062':'โรบินสัน ชลบุรี','5063':'โลตัส พนัสนิคม','5064':'เทอร์มินอล พัทยา',
  '5065':'เกตเวย์ เอกมัย','5066':'เกตเวย์ บางซื่อ','5068':'คอสโม บาร์ซา',
  '5069':'โลตัส พัฒนาการ','5070':'พันทิพย์ งามวงศ์วาน','5071':'โลตัส จรัญสนิทวงศ์',
  '5072':'โลตัส สุขาภิบาล 1','5073':'โลตัส ลาดพร้าว','5076':'บิ๊กซี ติวานนท์',
  '5077':'เทอมินัล โคราช','5080':'โลตัส แกลง ระยอง','5082':'มาเก็ตเพลส วงศ์สว่างเซ็นเตอร์',
  '5084':'เทอมินัล 21 พระราม 3','5085':'ICS ไอคอนสยาม','5087':'ศูนย์การประชุมแห่งชาติสิริกิติ์',
  '5088':'สยาม สแควร์','5090':'S Oasis','5091':'ปตท.เกษรนวมินทร์',
  '5504':'โลตัสวังหิน','5505':'โลตัสเลียบคลองสอง','5508':'รพ.วชิระพยาบาล',
  '5509':'โลตัส นครอินทร์',
  '4001':'แฟชั่น ไอซ์แลนด์','4005':'ซีคอน บางแค',
  '4007':'ซีคอน ศรีนครินทร์','4008':'เซ็นทรัล ศาลายา',
  '4015':'เดอะมอลล์ ท่าพระ','4018':'เทอมินัล 21 พระราม 3'
};

var FH_EXTRA_BRANDS = [];   // แบรนด์ที่ admin เพิ่มเอง: [{prefix,label}]
function getBranchPrefix(code) {
  if (!code) return '';
  code = String(code);
  for (var i = 0; i < FH_EXTRA_BRANDS.length; i++) {
    var b = FH_EXTRA_BRANDS[i];
    if (b && b.prefix && code.indexOf(String(b.prefix)) === 0) return b.label || '';
  }
  if (code.indexOf('55') === 0) return 'Santa Fe Easy';
  if (code.indexOf('50') === 0) return 'Santa Fe';
  if (code.indexOf('40') === 0) return 'เจ๊แดง จุ่มนัวร์';
  return '';
}
function getBranchFullName(code) {
  var prefix = getBranchPrefix(code);
  var name = BRANCHES[code] || '';
  return prefix ? (prefix + ' ' + name) : name;
}

/* ─── แสดงสาขาแบบเดียวกับใน PDF: "รหัส ชื่อ" (ตัด Santa Fe / Santa Fe Easy · เก็บเจ๊แดง) ─── */
var _brCodeByNameG = {};
var _brCodeByKeyG = {};   // key ที่ normalize แล้ว → รหัส (ทนสะกดต่าง เช่น S Oasis / S-Oasis)
function _rebuildBranchCodeMaps() {
  _brCodeByNameG = {}; _brCodeByKeyG = {};
  Object.keys(BRANCHES).forEach(function(c){
    var full = getBranchFullName(c);
    _brCodeByNameG[full] = c;
    _brCodeByKeyG[_branchKey(full)] = c;
  });
}
try { _rebuildBranchCodeMaps(); } catch(e) {}

/* หารหัสสาขาจากชื่อ — ชื่อตรง → normalize → ตัวเลขที่ติดมาในชื่อ (คืน '' ถ้าไม่รู้จัก) */
function _branchCodeOf(name) {
  if (!name || name === '—') return '';
  if (_brCodeByNameG[name]) return _brCodeByNameG[name];
  var k = _branchKey(name);
  if (_brCodeByKeyG[k]) return _brCodeByKeyG[k];
  var m = String(name).match(/(\d{3,})/);
  return (m && BRANCHES[m[1]]) ? m[1] : '';
}
function _brStripBrandG(s){ return String(s || '').replace(/^(Santa Fe Easy|Santa Fe)\s+/i, ''); }
function _brDispG(name){
  name = String(name || '');
  var c = _brCodeByNameG[name];
  return (c ? (c + ' ') : '') + _brStripBrandG(name);
}

/* ─── ประเภท/แบรนด์ของคำขออบรม: ซานตาเฟ่ / เจ๊แดง / Head Office ─── */
function _brandTypeFromCode(code) {
  code = String(code || '');
  if (code.indexOf('40') === 0) return _normBrandType(getBranchFullName(code)) || 'เจ๊แดง';
  if (code.indexOf('50') === 0 || code.indexOf('55') === 0) return 'ซานตาเฟ่';
  var p = getBranchPrefix(code); if (p) return p;   // แบรนด์ที่เพิ่มเอง → ใช้ label ของ prefix
  return '';
}
// ทำให้ค่า brand ที่เก็บ/นำเข้า เป็น 1 ใน 3 ประเภทมาตรฐาน
function _normBrandType(b) {
  b = String(b || '');
  if (/จุ่มนัวร์/i.test(b)) return 'เจ๊แดง จุ่มนัวร์';
  if (/เจ๊?\s*แดง|jaedaeng|^40/i.test(b)) return 'เจ๊แดง';
  if (/head\s*office|สำนักงานใหญ่|สนญ|ออฟฟิศ|\bho\b|\bhq\b/i.test(b)) return 'Head Office';
  if (/ซานตา|santa|เฟ่|^5[05]/i.test(b)) return 'ซานตาเฟ่';
  return b ? b : '';
}
// แบรนด์ ณ ตอนสาขา login (จากรหัส) — ใช้เก็บลง record ตอนส่ง
function _currentBrandType() {
  var code = branchPin || '';
  if (!code && currentBranchName) {
    for (var k in BRANCHES) { if (BRANCHES[k] === currentBranchName) { code = k; break; } }
  }
  return _brandTypeFromCode(code);
}
// รหัสสาขาจากชื่อ (reverse lookup, best-effort — ใช้กับ record เก่าที่ยังไม่มี brand)
function _codeFromBranchName(name) {
  name = String(name || '').trim();
  if (!name) return '';
  for (var k in BRANCHES) { if (BRANCHES[k] === name) return k; }
  return '';
}
// ประเภทของ request: ใช้ field brand ที่เก็บไว้ก่อน · ไม่มีค่อยเดาจากชื่อสาขา
function _reqBrandType(r) {
  var name = String(r.branch || r['สาขา'] || '');
  // resolve เป็นชื่อเต็ม (มี prefix แบรนด์) ก่อน เพราะชื่อที่เก็บเป็นชื่อสั้น
  var code = _codeFromBranchName(name);
  var full = code ? getBranchFullName(code) : name;
  // เจ๊แดง: แยกตามชื่อเต็ม — มี "จุ่มนัวร์" = เจ๊แดง จุ่มนัวร์, ที่เหลือ = เจ๊แดง
  if (/จุ่มนัวร์/i.test(full)) return 'เจ๊แดง จุ่มนัวร์';
  if (/เจ๊?\s*แดง|jaedaeng/i.test(full)) return 'เจ๊แดง';
  if (/สำนักงานใหญ่|head\s*office|สนญ|ออฟฟิศ|\bho\b|\bhq\b/i.test(full)) return 'Head Office';
  // ทางสำรอง: ใช้ field brand ที่เก็บไว้ แล้วค่อยเดาจากรหัส
  var stored = _normBrandType(r.brand || r['แบรนด์'] || r['ประเภท'] || '');
  if (stored) return stored;
  var t = _brandTypeFromCode(code);
  return t || 'ซานตาเฟ่';
}
var selectedRole = 'branch';
var branchPin = '';
var currentBranchName = '';
var allRecords = [];
var requestRows = [];

/* ─── Detail modal (popup ดูข้อมูลเต็ม รองรับทั้ง cert + request) ─── */
function closeDetailModal() {
  var m = document.getElementById('detailModal');
  if (m) m.classList.remove('show');
}
function _openDetailModal(opts) {
  document.getElementById('detailModalTitle').innerHTML = opts.title || '📄 รายละเอียด';
  document.getElementById('detailModalSubtitle').innerHTML = opts.subtitle || '';
  document.getElementById('detailModalContent').innerHTML = (opts.items || [])
    .map(function(it){
      if (it.section) return '<div class="detail-section-label">'+escapeHtml(it.section)+'</div>';
      return '<div class="detail-row">'
        + '<div class="detail-label">'+escapeHtml(it.label)+'</div>'
        + '<div class="detail-value">'+(it.html != null ? it.html : escapeHtml(it.value || '—'))+'</div>'
        + '</div>';
    }).join('');
  document.getElementById('detailModal').classList.add('show');
}
function openCertDetailModal(no) {
  if (typeof matchData === 'undefined') return;
  var d = matchData.find(function(r){ return r.no === no; });
  if (!d) return;
  _openDetailModal({
    title: '📜 รายละเอียดใบรับรอง',
    subtitle: 'ลำดับที่ ' + d.no + ' · จับคู่จาก PDF กับทะเบียนพนักงาน',
    items: [
      { section: 'ใบรับรอง' },
      { label: 'ชื่อในใบรับรอง', value: d.certName },
      { label: 'หลักสูตร',       value: d.course },
      { label: 'วันอบรม',         value: formatThaiDate(d.trainDate) },
      { label: 'วันหมดอายุ',      value: formatThaiDate(d.expireDate) },
      { label: 'สถานะใบรับรอง', html: getExpBadge(d.expStatus) },
      { section: 'พนักงาน' },
      { label: 'ชื่อในระบบ',      value: d.empName || '—' },
      { label: 'สาขา / หน่วยงาน', value: d.branch },
      { label: 'ตำแหน่ง',         value: d.position },
      { label: 'Sheet',           html: getSheetTag(d.sheet) },
      { label: 'สถานะจับคู่',     html: getMatchBadge(d.matchType) },
    ],
  });
}
function openReqDetailModal(keyDataStr) {
  var keyData;
  try { keyData = JSON.parse(decodeURIComponent(keyDataStr)); } catch(e) { return; }
  var rec = (_adminRowCache || []).find(function(r){
    return String(r._rowIndex || r.rowIndex || '') === String(keyData.rowIndex)
        && String(r.idCard || r['เลขบัตรประชาชน'] || r['เลขบัตร'] || '') === String(keyData.idCard);
  });
  if (!rec) return;
  var p = _prepReqFields(rec);
  _openDetailModal({
    title: '📋 รายละเอียดคำขออบรม',
    subtitle: '',
    items: [
      { section: 'พนักงาน' },
      { label: 'ชื่อ-นามสกุล',    value: p.name },
      { label: 'รหัสพนักงาน',     value: p.empId || '—' },
      { label: 'เลขบัตรประชาชน', value: p.idCard || '—' },
      { label: 'ตำแหน่ง',         value: p.pos },
      { label: 'สาขา',            value: p.branch },
      { section: 'อบรม' },
      { label: 'หลักสูตร',         value: p.course },
      { label: 'วันอบรม',          value: formatThaiDate(p.trainDate) || '—' },
      { label: 'รอบ',              value: p.slot || '—' },
      { label: 'ใบรับรอง',         html: certBadgeHtml(p.name, _adminCertIdx) },
      { section: 'การส่ง' },
      { label: 'วันที่ส่ง',         value: p.tsFmt },
      { label: 'หมายเหตุ',         value: p.note || '—' },
    ],
  });
}

/* ─── Sidebar collapsibles (นำเข้าข้อมูล / ออกรายงาน sub-menus) ─── */
function _admToggleCollapse(name) {
  var el = document.querySelector('.adm-side-collapsible[data-coll="'+name+'"]');
  if (el) el.classList.toggle('open');
}

/* ─── Mobile sidebar toggle ─── */
/* ═══════════ เมนูข้างฝั่งสาขา — กลไกเดียวกับ showAdmSection ═══════════
   ใช้ id ขึ้นต้น adm-sec- เพื่อให้ CSS ชุดเดียวกันคุมการซ่อน/แสดง (.active) */
var BR_SECTION_META = {
  'adm-sec-br-search':  { icon: '📜', title: 'ค้นหาใบรับรอง' },
  'adm-sec-br-submit':  { icon: '📋', title: 'ส่งรายชื่ออบรม' },
  'adm-sec-br-history': { icon: '📂', title: 'รายชื่อที่ส่งอบรม' }
};
function showBrSection(targetId) {
  if (!BR_SECTION_META[targetId]) targetId = 'adm-sec-br-search';
  document.querySelectorAll('#branchView .admin-main > [id^="adm-sec-br-"]').forEach(function(sec){
    sec.classList.toggle('active', sec.id === targetId);
  });
  document.querySelectorAll('#branchView .adm-side-link[data-target]').forEach(function(l){
    l.classList.toggle('active', l.getAttribute('data-target') === targetId);
  });
  /* แถบแท็บล่าง (มือถือ) — ไฮไลต์ให้ตรงกับหน้าที่เปิดอยู่
     หน้า "รายชื่อที่ส่งอบรม" ไม่มีแท็บของตัวเอง เพราะไปอยู่เป็นกรอบล่างของหน้าส่งรายชื่อแล้ว
     จึงให้แท็บส่งรายชื่อสว่างแทน ไม่งั้นจะไม่มีแท็บไหนสว่างเลย = ผู้ใช้ไม่รู้ว่าอยู่ไหน */
  var tabFor = (targetId === 'adm-sec-br-history') ? 'adm-sec-br-submit' : targetId;
  document.querySelectorAll('#brTabBar .br-tab-page').forEach(function(t){
    t.classList.toggle('active', t.getAttribute('data-target') === tabFor);
  });
  var meta = BR_SECTION_META[targetId];
  var iEl = document.getElementById('admMobileSectionIcon');
  var tEl = document.getElementById('admMobileSectionText');
  /* แถบหัวมือถือฝั่งสาขา = ชื่อสาขา ไม่ใช่ชื่อหน้า
     หน้าไหนกำลังเปิดอยู่ ดูจากแท็บที่สว่างด้านล่างได้แล้ว ไม่ต้องบอกซ้ำ
     จอคอมยังใช้ชื่อหน้าเหมือนเดิม เพราะไม่มีแถบแท็บ */
  var isMobile = false;
  try { isMobile = window.matchMedia('(max-width: 820px)').matches; } catch (e) {}
  if (isMobile && currentBranchName) {
    /* แถบหัวมือถือ = ชื่อสาขาล้วน ๆ ไม่มีไอคอน ไม่มีเลขรุ่น ไม่มีข้อความสถานะ
       (เลขรุ่น/สถานะเคยใส่ไว้ตอนไล่บั๊กแถบแท็บ ตอนนี้เจอต้นเหตุแล้วจึงเอาออก) */
    if (iEl) iEl.textContent = '';
    if (tEl) tEl.textContent = currentBranchName;
  } else {
    if (iEl && meta) iEl.textContent = meta.icon;
    if (tEl && meta) tEl.textContent = meta.title;
  }
  if (typeof _closeAdmMobileSidebar === 'function') _closeAdmMobileSidebar();
  /* ซิงก์แถบแท็บล่าง (มือถือ) ให้ไฮไลต์เฉพาะปุ่มของหน้าที่เปิดอยู่
     เดิมเรียกเฉพาะใน showAdmSection (ฝั่งแอดมิน) ฝั่งสาขาจึงไม่เคยซิงก์
     ผลคือกดไปหน้าส่งรายชื่อแล้ว ปุ่ม "ใบรับรอง" ยังติดไฮไลต์ค้างอยู่ */
  try { if (typeof fhSyncTabbar === 'function') fhSyncTabbar(); } catch (e) {}
  /* ทวนสิทธิ์อีกรอบหลังสลับหน้า — กันกรณีมีโค้ดอื่นมาซ่อน/โชว์ทีหลังจนสองจอไม่ตรงกัน */
  try { if (typeof applyFhPerms === 'function') applyFhPerms(); } catch (e) {}
  window.scrollTo(0, 0);
}
var _brSidebarInited = false;
function _initBranchSidebar() {
  if (!_brSidebarInited) {
    document.querySelectorAll('#branchView .adm-side-link[data-target]').forEach(function(link){
      link.addEventListener('click', function(){ showBrSection(link.getAttribute('data-target')); });
    });
    _brSidebarInited = true;
  }
  // ชื่อสาขาในกล่องผู้ใช้ (มุมบนของ sidebar)
  // แบรนด์ขึ้นบรรทัดแรก · ชื่อสาขา + (สาขา) บรรทัดถัดไป
  // เดิมยัดบรรทัดเดียวแล้วตัดคำมั่ว เช่น "Santa Fe แฟชั่น / ไอส์ / แลนด์ (สาขา)"
  var nameEl = document.getElementById('brUserName');
  if (nameEl) {
    var full = String(currentBranchName || 'สาขา').trim();
    var brand = '';
    try { brand = getBranchPrefix(branchPin) || ''; } catch (e) {}
    var rest = (brand && full.indexOf(brand) === 0) ? full.slice(brand.length).trim() : full;
    if (!rest) { rest = brand; brand = ''; }   // มีแค่ชื่อเดียว → ไม่ต้องแยกบรรทัด
    nameEl.innerHTML =
      (brand ? '<span class="br-badge-brand">' + escapeHtml(brand) + '</span>' : '') +
      '<span class="br-badge-name">' + escapeHtml(rest) + '</span>';
  }
  try { document.body.classList.add('fh-branch-mode'); } catch (e) {}
  showBrSection('adm-sec-br-search');
}

/* sidebar ของ view ที่กำลังแสดง — สาขาใช้ #branchSidebar, admin ใช้ #adminSidebar */
function _activeSidebar_() {
  var bv = document.getElementById('branchView');
  if (bv && bv.style.display !== 'none') return document.getElementById('branchSidebar');
  return document.getElementById('adminSidebar');
}
function _toggleAdmMobileSidebar() {
  var sb = _activeSidebar_();
  var bd = document.getElementById('admMobileBackdrop');
  if (!sb || !bd) return;
  var open = sb.classList.toggle('open');
  bd.classList.toggle('show', open);
  document.body.classList.toggle('adm-side-open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
function _closeAdmMobileSidebar() {
  var sb = _activeSidebar_();
  var bd = document.getElementById('admMobileBackdrop');
  if (sb) sb.classList.remove('open');
  if (bd) bd.classList.remove('show');
  document.body.classList.remove('adm-side-open');
  document.body.style.overflow = '';
}
/* Sync section title in mobile top bar + active state on bottom tabs */
var ADM_SECTION_META = {
  'adm-sec-cert':     { icon: '📜', title: 'ข้อมูลใบรับรอง' },
  'adm-sec-requests': { icon: '📋', title: 'คำขออบรม' },
  'adm-sec-import':   { icon: '📥', title: 'นำเข้าข้อมูล' }
};
function _updateMobileSectionLabel(targetId) {
  var meta = ADM_SECTION_META[targetId];
  if (!meta) return;
  var iEl = document.getElementById('admMobileSectionIcon');
  var tEl = document.getElementById('admMobileSectionText');
  if (iEl) iEl.textContent = meta.icon;
  if (tEl) tEl.textContent = meta.title;
  // Sync bottom tabs active state
  document.querySelectorAll('.adm-tab[data-target]').forEach(function(t){
    t.classList.toggle('active', t.getAttribute('data-target') === targetId);
  });
}

/* Auto-close sidebar when nav item clicked (on mobile) */
document.addEventListener('click', function(e){
  if (window.innerWidth > 700) return;
  if (e.target.closest('.adm-side-link[data-target]')) {
    setTimeout(_closeAdmMobileSidebar, 100);
  }
});

/* ─── Generic Import Modal — kind: 'cert' (PDF) | 'registry' (Excel employees) ─── */
var IMP_KIND_CONFIG = {
  cert: {
    title: '📄 นำเข้าข้อมูลใบรับรอง',
    subtitle: 'อัปโหลดไฟล์ <b>PDF ใบรับรอง</b>อบรม (ไม่จำกัดจำนวน) · ระบบจะอ่านข้อมูลและจับคู่กับทะเบียนพนักงาน',
    accept: '.pdf',
    multiple: true,
    hint: 'รองรับ: <b>PDF</b> เท่านั้น · ไม่จำกัดจำนวนไฟล์',
    iconLabel: '📄',
    typeLabel: 'ใบรับรอง'
  },
  registry: {
    title: '👥 นำเข้ารายชื่อพนักงาน',
    subtitle: 'อัปโหลด <b>Excel ทะเบียนพนักงาน</b> ได้หลายไฟล์ · รองรับหลาย Sheet (JD, ST, Easy, OP) · ระบบรวม+ตัดซ้ำให้อัตโนมัติ',
    accept: '.xlsx,.xls,.csv',
    multiple: true,
    hint: 'รองรับ: <b>.xlsx / .xls / .csv</b> · เลือกได้หลายไฟล์ (สูงสุด 20)',
    iconLabel: '📊',
    typeLabel: 'ทะเบียน'
  }
};
var _impKind = 'cert';
var _impQueue = [];

function openImportModal(kind) {
  var cfg = IMP_KIND_CONFIG[kind];
  if (!cfg) return;
  _impKind = kind;
  _impQueue = [];
  document.getElementById('impModalTitle').innerHTML = cfg.title;
  document.getElementById('impModalSubtitle').innerHTML = cfg.subtitle;
  document.getElementById('impHint').innerHTML = cfg.hint;
  var input = document.getElementById('impFilesInput');
  input.setAttribute('accept', cfg.accept);
  if (cfg.multiple) input.setAttribute('multiple', ''); else input.removeAttribute('multiple');
  input.value = '';
  document.getElementById('impFileList').innerHTML = '';
  var _impBtn = document.getElementById('impUploadBtn');
  _impBtn.disabled = true;
  _impBtn.innerHTML = '⬆ Upload';
  _impBtn.onclick = impDoUpload;  // reset onclick (อาจถูกเปลี่ยนเป็น closeImportComboModal ตอนเสร็จ)
  document.getElementById('importComboModal').classList.add('show');
}

/* Legacy entry point — keep for compatibility but route to new generic modal (PDF default) */
function openImportComboModal() { openImportModal('cert'); }

function closeImportComboModal() {
  document.getElementById('importComboModal').classList.remove('show');
  _impQueue = [];
}

function impDragOver(e) {
  e.preventDefault();
  document.getElementById('impDropZone').classList.add('drag');
}
function impDragLeave() {
  document.getElementById('impDropZone').classList.remove('drag');
}
function impDrop(e) {
  e.preventDefault();
  document.getElementById('impDropZone').classList.remove('drag');
  impStageFiles(e.dataTransfer.files);
}
function impHandleInput(input) {
  impStageFiles(input.files);
  input.value = '';
}

function impStageFiles(files) {
  if (!files || !files.length) return;
  var cfg = IMP_KIND_CONFIG[_impKind];
  var allowed = cfg.accept.split(',').map(function(s){ return s.trim().toLowerCase(); });
  Array.from(files).forEach(function(f){
    var ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (allowed.indexOf(ext) < 0) return; // skip wrong type silently
    if (!cfg.multiple) {
      // Single-file mode: replace any previous file
      _impQueue = [];
      document.getElementById('impFileList').innerHTML = '';
    }
    _impQueue.push(f);
    impAddFileItem(f);
  });
  document.getElementById('impUploadBtn').disabled = _impQueue.length === 0;
}

function _impKey(file) {
  return (file.name + '_' + file.size).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function impAddFileItem(file) {
  var list = document.getElementById('impFileList');
  if (!list) return;
  var cfg = IMP_KIND_CONFIG[_impKind];
  var sizeKB = file.size / 1024;
  var sizeStr = sizeKB >= 1024 ? (sizeKB/1024).toFixed(1)+' MB' : Math.round(sizeKB)+' KB';
  var key = _impKey(file);
  var item = document.createElement('div');
  item.className = 'imp-file-item';
  item.setAttribute('data-key', key);
  item.innerHTML = '<div class="imp-file-icon">'+cfg.iconLabel+'</div>'
    + '<div class="imp-file-info">'
    +   '<div class="imp-file-name">'+escapeHtml(file.name)+'</div>'
    +   '<div class="imp-file-meta">'+sizeStr+'</div>'
    + '</div>'
    + '<button class="imp-file-remove" onclick="impRemoveFile(\''+key+'\')" title="ลบไฟล์">✕</button>'
    + '<div class="imp-file-status pending">รอ Upload</div>';
  list.appendChild(item);
}

function impRemoveFile(key) {
  _impQueue = _impQueue.filter(function(f){ return _impKey(f) !== key; });
  var el = document.querySelector('#impFileList [data-key="'+key+'"]');
  if (el) el.remove();
  document.getElementById('impUploadBtn').disabled = _impQueue.length === 0;
}

function impUpdateFileStatus(files, status) {
  var list = document.getElementById('impFileList');
  if (!list) return;
  Array.from(files).forEach(function(f){
    var el = list.querySelector('[data-key="'+_impKey(f)+'"] .imp-file-status');
    if (!el) return;
    el.className = 'imp-file-status ' + status;
    el.textContent = status === 'processing' ? 'กำลังประมวลผล...' :
                     status === 'done'       ? '✓ Completed' :
                     status === 'error'      ? '✗ Failed' :
                                               'รอ Upload';
  });
  // Hide remove button when processing/done
  Array.from(files).forEach(function(f){
    var rm = list.querySelector('[data-key="'+_impKey(f)+'"] .imp-file-remove');
    if (rm && status !== 'pending') rm.style.display = 'none';
  });
}

function impDoUpload() {
  if (_impQueue.length === 0) return;
  var btn = document.getElementById('impUploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> กำลังประมวลผล...';
  impUpdateFileStatus(_impQueue, 'processing');
  try {
    if (_impKind === 'cert') {
      var dt = new DataTransfer();
      _impQueue.forEach(function(f){ dt.items.add(f); });
      processPDFFiles(dt.files);
      _impWatchStatus('pdfStatusText', _impQueue.slice());
    } else if (_impKind === 'registry') {
      processXLSXFiles(_impQueue.slice());
      _impWatchStatus('xlsxStatusText', _impQueue.slice());
    }
  } catch (e) {
    impUpdateFileStatus(_impQueue, 'error');
    btn.innerHTML = '⬆ Upload';
    btn.disabled = false;
  }
}

function _impWatchStatus(statusElId, files) {
  var statusEl = document.getElementById(statusElId);
  var btn = document.getElementById('impUploadBtn');
  if (!statusEl) {
    setTimeout(function(){
      impUpdateFileStatus(files, 'done');
      if (btn) { btn.innerHTML = '✓ เสร็จสิ้น'; btn.disabled = false; btn.onclick = closeImportComboModal; }
    }, 700);
    return;
  }
  var prevText = statusEl.textContent;
  var ticks = 0;
  var interval = setInterval(function(){
    ticks++;
    var txt = statusEl.textContent || '';
    var isDone = /สำเร็จ|พบ\s*\d|ทะเบียน|✓|ตัด|matched/i.test(txt);
    var isError = /error|ผิดพลาด|ล้มเหลว|fail|✗/i.test(txt);
    if (isError) {
      clearInterval(interval);
      impUpdateFileStatus(files, 'error');
      if (btn) { btn.innerHTML = '✗ ลองอีกครั้ง'; btn.disabled = false; }
    } else if (isDone || (txt !== prevText && ticks > 6)) {
      clearInterval(interval);
      impUpdateFileStatus(files, 'done');
      if (btn) { btn.innerHTML = '✓ เสร็จสิ้น'; btn.disabled = false; btn.onclick = closeImportComboModal; }
    } else if (ticks > 80) {
      clearInterval(interval);
      impUpdateFileStatus(files, 'done');
      if (btn) { btn.innerHTML = '✓ เสร็จสิ้น'; btn.disabled = false; btn.onclick = closeImportComboModal; }
    }
  }, 250);
}

/* ─── Admin sidebar: SPA-style section switcher ─── */
var _admSidebarInited = false;
var ADM_SEC_KEY = 'fab_admin_section';
var ADM_DEFAULT_SEC = 'adm-sec-cert';

function showAdmSection(targetId) {
  /* ฝั่งสาขามีตัวสลับหน้าของตัวเอง (showBrSection) และไม่มีสิทธิ์หน้าฝั่งแอดมินอยู่แล้ว
     ถ้าปล่อยให้วิ่งต่อ จะไปเจอด่านตรวจสิทธิ์ข้างล่างแล้วถูกตีกลับเป็น "ไม่มีสิทธิ์"
     ซึ่งถอด .active ออกจากทุกหน้า → สาขาเห็นจอว่างสนิท
     เกิดได้จริงตอนกดแท็บ "ใบรับรอง" ล่างจอ หรือกู้หน้าที่ค้างไว้จากรอบก่อน */
  try {
    var _brView = document.getElementById('branchView');
    var _inBranch = !!(_brView && _brView.style && _brView.style.display !== 'none')
                 || document.body.classList.contains('is-branch');
    if (_inBranch && typeof showBrSection === 'function') {
      showBrSection(String(targetId || '').indexOf('adm-sec-br-') === 0 ? targetId : 'adm-sec-br-search');
      return;
    }
  } catch (e) {}

  /* กันเข้าหน้าที่ไม่มีสิทธิ์ — ดักที่นี่จุดเดียวคุมได้ทุกทาง:
     กดเมนู · กู้หน้าที่ค้างไว้จาก sessionStorage · หรือคนที่ปลดซ่อนปุ่มเองผ่าน devtools
     สำคัญเป็นพิเศษกับ adm-sec-settings เพราะข้างในมีตัวแก้สิทธิ์อยู่ */
  try {
    if (typeof FH_SECTION_ACTION !== 'undefined' && FH_SECTION_ACTION[targetId]
        && typeof fhCan === 'function' && !fhCan(FH_SECTION_ACTION[targetId])) {
      targetId = _fhFirstAllowedSection() || '';   // เด้งไปหน้าแรกที่ "มีสิทธิ์จริง" ไม่ใช่ default ดื้อๆ
      if (!targetId) { _fhShowNoAccess(); return; }
    }
  } catch (e) {}
  var na = document.getElementById('fhNoAccess'); if (na) na.style.display = 'none';
  // Toggle section visibility
  var sections = document.querySelectorAll('.admin-main > [id^="adm-sec-"]');
  sections.forEach(function(s){
    s.classList.toggle('active', s.id === targetId);
  });
  // Toggle nav active state
  var links = document.querySelectorAll('.adm-side-link[data-target]');
  links.forEach(function(l){
    l.classList.toggle('active', l.getAttribute('data-target') === targetId);
  });
  // Sync mobile section label
  if (typeof _updateMobileSectionLabel === 'function') _updateMobileSectionLabel(targetId);
  // Sync ปุ่ม "ใบรับรอง" ในแถบล่างมือถือ
  if (typeof fhSyncTabbar === 'function') fhSyncTabbar();
  // เปิดหน้าทะเบียน → แสดงจาก cache ทันที แล้วดึงของใหม่เบื้องหลัง
  if (targetId === 'adm-sec-registry') {
    if (typeof empData !== 'undefined' && empData && empData.length) { try { renderRegistryTable(); } catch(e) {} }
    else {
      var _ec = _fhCacheGet('fh_emp_v1');
      if (_ec && _ec.length) { empData = _ec; try { renderRegistryTable(); } catch(e){} }
      try { _reloadRegistry(); } catch(e) {}
    }
  }
  // Persist + scroll to top
  try { sessionStorage.setItem(ADM_SEC_KEY, targetId); } catch(e) {}
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ═══════════ แถบล่างมือถือ: ปุ่มกลาง "ใบรับรอง" ═══════════
   แอดมิน → ฐานข้อมูลใบรับรอง (adm-sec-cert) · สาขา → ค้นหาใบรับรอง (adm-sec-br-search) */
function fhCertSectionId() {
  var isAdmin = document.body.classList.contains('is-admin');
  var first  = isAdmin ? 'adm-sec-cert' : 'adm-sec-br-search';
  var second = isAdmin ? 'adm-sec-br-search' : 'adm-sec-cert';
  var el = document.getElementById(first);
  // ต้องมีทั้ง section และปุ่มเมนูข้างที่ชี้ไปหน้านั้น (ฝั่งสาขาไม่มี adm-sec-cert)
  if (el && document.querySelector('.adm-side-link[data-target="' + first + '"]')) return first;
  return document.getElementById(second) ? second : first;
}
function fhGoCerts() {
  if (typeof _closeAdmMobileSidebar === 'function') _closeAdmMobileSidebar();
  if (typeof showAdmSection === 'function') showAdmSection(fhCertSectionId());
}
/* ไปหน้าส่งรายชื่อ (ปุ่มบนแถบแท็บล่าง ฝั่งสาขา) */
function fhGoSubmit() {
  if (typeof _closeAdmMobileSidebar === 'function') _closeAdmMobileSidebar();
  if (typeof showBrSection === 'function') showBrSection('adm-sec-br-submit');
}
/* ไฮไลต์เมื่ออยู่หน้าใบรับรอง + ซ่อนปุ่มถ้าไม่มีสิทธิ์เข้าหน้านั้น */
function fhSyncTabbar() {
  /* ไฮไลต์ได้ทีละปุ่มเท่านั้น — ปุ่มไหนไม่ใช่หน้าปัจจุบันต้องถอดไฮไลต์ออกเสมอ
     (หน้ารายชื่อที่ส่งแล้วนับเป็นหน้าเดียวกับส่งรายชื่อ เพราะรวมเป็นหน้าเดียว) */
  var sub = document.getElementById('mtbSubmit');
  if (sub) {
    var ss = document.getElementById('adm-sec-br-submit');
    var sh = document.getElementById('adm-sec-br-history');
    var onSubmit = !!(ss && ss.classList.contains('active')) || !!(sh && sh.classList.contains('active'));
    sub.classList.toggle('active', onSubmit);
  }
  var btn = document.getElementById('mtbCerts');
  if (!btn) return;
  var id = fhCertSectionId();
  var allowed = true;
  try {
    var act = (typeof FH_SECTION_ACTION !== 'undefined') ? FH_SECTION_ACTION[id] : null;
    if (act && typeof fhCan === 'function') allowed = fhCan(act);
  } catch (e) {}
  btn.style.display = allowed ? '' : 'none';
  var sec = document.getElementById(id);
  btn.classList.toggle('active', !!(sec && sec.classList.contains('active')));
}

function _initAdminSidebar() {
  if (_admSidebarInited) return;
  var links = document.querySelectorAll('.adm-side-link[data-target]');
  if (!links.length) return;
  links.forEach(function(link){
    link.addEventListener('click', function(){
      var targetId = link.getAttribute('data-target');
      if (targetId) showAdmSection(targetId);
    });
  });
  // Restore last viewed section — must have BOTH a section element AND a nav button
  var initial = (typeof _fhFirstAllowedSection === 'function' ? _fhFirstAllowedSection() : '') || ADM_DEFAULT_SEC;
  try {
    var saved = sessionStorage.getItem(ADM_SEC_KEY);
    /* หน้าที่ค้างไว้ต้องเป็นของฝั่งเดียวกันเท่านั้น
       สลับบัญชีในแท็บเดิม (แอดมิน → สาขา) แล้วกู้หน้าฝั่งแอดมินมาให้สาขา
       จะโดนตีกลับเป็น "ไม่มีสิทธิ์" แล้วจอว่าง */
    var _isBrSec = String(saved || '').indexOf('adm-sec-br-') === 0;
    var _nowBranch = document.body.classList.contains('is-branch');
    if (saved
        && _isBrSec === _nowBranch
        && document.getElementById(saved)
        && document.querySelector('.adm-side-link[data-target="'+saved+'"]')) {
      initial = saved;   // showAdmSection จะกันเองถ้าไม่มีสิทธิ์กับหน้าที่ค้างไว้
    }
  } catch(e) {}
  showAdmSection(initial);
  _admSidebarInited = true;
}

// Toggle which topbar is visible based on which view is active (normal scrolling)
// NOTE: admin topbar is permanently hidden — the new sidebar replaces it (menu/logout in sidebar footer)
function _updateTopbarVisibility() {
  var aBar = document.getElementById('adminTopbar');
  var bBar = document.getElementById('branchTopbar');
  var aView = document.getElementById('adminView');
  var bView = document.getElementById('branchView');
  var bVisible = bView && getComputedStyle(bView).display !== 'none';
  // ทั้งสองฝั่งใช้ sidebar แทน topbar แล้ว → ซ่อนทั้งคู่
  if (aBar) aBar.style.display = 'none';
  if (bBar) bBar.style.display = 'none';
  void bVisible;
  void aView; // referenced for future re-enable if needed
}



