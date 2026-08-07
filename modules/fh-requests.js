/* fh-requests.js — คำขออบรม · ตัวกรอง · มุมมองรุ่น · กำหนดรุ่น · งานหมู่
   แยกมาจาก food-handler.js (บรรทัดเดิม 3788-5159)
   ⚠️ ไฟล์ชุดนี้ต้องโหลดตามลำดับใน food-handler.html — อย่าสลับ */
/* ─── จำกัดข้อมูลให้เห็นเฉพาะสาขาที่ล็อกอิน (ใช้เฉพาะ branchView = ฝั่งสาขา) ───
   ใช้ matchesCurrentBranch_ ตัวเดียวกับช่องเลือกชื่อในฟอร์มขออบรม → ตรรกะตรงกันทั้งระบบ
   (matchesCurrentBranch_ คืน true เมื่อ isAdminMode → admin/BZM เห็นทั้งหมดอยู่แล้ว)
   ถ้าไม่รู้ว่าสาขาไหน (ไม่มี pin/ชื่อ) จะไม่กรอง เพื่อกันเผลอซ่อนหมด */
/* เดิมกรองให้สาขาเห็นเฉพาะใบรับรองของตัวเอง — ตอนนี้ทุกสาขาเห็นข้อมูลทั้งหมด
   (คงฟังก์ชันไว้เพราะมีที่เรียกหลายจุด และเผื่อกลับมาจำกัดขอบเขตทีหลัง) */
function _fhScopeRecordsToBranch(records) {
  if (!Array.isArray(records)) return [];
  return records;
}
/* นับเฉพาะใบของสาขาที่ล็อกอินอยู่ — ใช้กับกล่องเตือน "ต้องลงมือ" ให้ยังตรงกับสาขาตัวเอง */
function _fhOwnBranchRecords(records) {
  if (!Array.isArray(records)) return [];
  if (isAdminMode) return records;
  if (!String(branchPin || '').trim() && !String(currentBranchName || '').trim()) return records;
  return records.filter(function(r){
    return matchesCurrentBranch_((r && (r['สาขา'] || r.branch)) || '');
  });
}

function loadRecordsForSearch() {
  var info = document.getElementById('branchSearchInfo');
  function _renderCerts() {
    updateBranchStats();
    branchSearch();   // แสดงรายการทั้งหมดทันที (branchSearch ตั้งข้อความสรุปเอง)
  }
  // 1) โชว์จากแคชทันที (cache เก็บชุดเต็ม → กรองตอนใช้เท่านั้น)
  var _c = _fhCacheGet('fh_certs_v1');
  if (_c && _c.length) { allRecords = _fhScopeRecordsToBranch(_c); _renderCerts(); }
  else {
    // ไม่มีแคช → โครงโหลด (การดึงใบรับรองจาก Cloud ใช้เวลานาน จอว่างจะดูเหมือนไม่มีข้อมูล)
    if (info) info.textContent = 'กำลังโหลดข้อมูลจาก Cloud...';
    var _g = document.getElementById('branchResults');
    if (_g && typeof certSkelHtml === 'function') _g.innerHTML = certSkelHtml(3);
  }
  function _failCerts(msg) {
    if (_c && _c.length) return;   // มีแคชอยู่แล้ว ใช้ต่อได้ ไม่ต้องทับด้วยข้อความ error
    if (info) info.innerHTML = '<span style="color:var(--red)">' + escapeHtml(msg) + '</span>';
    var g = document.getElementById('branchResults');
    if (g) g.innerHTML = certFailHtml(msg, 'loadRecordsForSearch()');
  }
  // 2) ดึงสดเบื้องหลัง + อัปเดตแคช (เก็บชุดเต็ม แล้วค่อยกรองเข้า allRecords)
  fetch(SCRIPT_URL, { method:'GET' })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.ok) {
        var _raw = res.records || [];
        _fhCacheSet('fh_certs_v1', _raw);
        allRecords = _fhScopeRecordsToBranch(_raw);
        _renderCerts();
        if (_adminRowCache && _adminRowCache.length) { _adminCertIdx = buildCertIndex(); if (typeof _applyAdminReqFilters === 'function') _applyAdminReqFilters(); }
      } else {
        _failCerts('โหลดข้อมูลไม่ได้: ' + (res.error || 'unknown'));
      }
    })
    .catch(function(err){ _failCerts('เชื่อมต่อ Cloud ไม่ได้: ' + err.message); });
}

/* สรุปสั้นในหัวข้อ + เตือนเฉพาะใบที่ต้องลงมือ (ใกล้หมด/หมดอายุ)
   เดิมเป็นการ์ด 4 ใบ ซึ่ง "ทั้งหมด/ยังมีผล" ไม่ได้ทำให้สาขาต้องทำอะไร */
function updateBranchStats() {
  var subEl = document.getElementById('branchHeroSub');
  var alertEl = document.getElementById('branchAlert');
  // รายการแสดงทุกสาขา แต่กล่องเตือน "ต้องลงมือ" นับเฉพาะสาขาตัวเอง — ไม่งั้นตัวเลขของสาขาอื่นจะทำให้เข้าใจผิด
  var own = _fhOwnBranchRecords(allRecords || []);
  var warn = 0, exp = 0;
  own.forEach(function(r){
    var st = r['สถานะใบรับรอง'];
    if (st === 'warning' || st === 'ใกล้หมดอายุ') warn++;
    else if (st === 'expired' || st === 'หมดอายุ') exp++;
  });
  /* หัวข้อต้องตรงกับสิ่งที่ตารางแสดงจริง
     ค่าเริ่มต้นตอนนี้คือ "ของสาขาตัวเอง" ไม่ใช่ทุกสาขา ถ้าหัวข้อยังเขียนว่าทุกสาขา
     ผู้ใช้จะนึกว่าเห็นครบแล้ว ทั้งที่กรองอยู่ */
  var titleEl = document.getElementById('branchHeroTitle');
  var scopeAll = (typeof _brSearchAll !== 'undefined' && _brSearchAll);
  if (titleEl) {
    titleEl.textContent = (!isAdminMode && currentBranchName && !scopeAll)
      ? 'ใบรับรองของสาขา' : 'ฐานข้อมูลใบรับรอง · ทุกสาขา';
  }
  if (subEl) {
    var total = (allRecords || []).length;
    if (!total) subEl.textContent = 'ยังไม่มีใบรับรองในระบบ';
    else if (!isAdminMode && currentBranchName && !scopeAll)
      subEl.textContent = currentBranchName + ' · ' + own.length + ' ใบ (ทั้งระบบ ' + total + ' ใบ)';
    else subEl.textContent = 'ทุกสาขา ' + total + ' ใบ'
      + (!isAdminMode && currentBranchName ? ' · ' + currentBranchName + ' ' + own.length + ' ใบ' : '');
  }
  if (!alertEl) return;
  if (!warn && !exp) { alertEl.style.display = 'none'; alertEl.innerHTML = ''; return; }
  var chip = function(txt, color, bg){
    return '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;'
      + 'background:' + bg + ';color:' + color + ';font-size:12.5px;font-weight:800;white-space:nowrap;">' + txt + '</span>';
  };
  alertEl.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + (exp  ? chip('❌ หมดอายุ ' + exp + ' ใบ', '#B91C1C', 'rgba(239,68,68,0.10)') : '')
    + (warn ? chip('⏳ ใกล้หมดอายุ ' + warn + ' ใบ', '#B45309', 'rgba(245,158,11,0.14)') : '')
    + '</div>';
  alertEl.style.display = 'block';
}

/* เทียบชื่อสาขาแบบหลวม — ทะเบียนสะกดสาขาไม่ตรงกันบ่อย (ICS/ไอซีเอส, เว้นวรรคไม่เท่ากัน)
   ถ้าเทียบตรงตัวจะกลายเป็น "สาขาตัวเองไม่มีใบเซอร์สักใบ" ทั้งที่มี */
function _brSameBranch(a, b) {
  var k = function(x){ return String(x || '').replace(/[\s\-()]/g, '').toLowerCase(); };
  var ka = k(a), kb = k(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.indexOf(kb) >= 0 || kb.indexOf(ka) >= 0;
}
/* ค่าเริ่มต้น = โชว์เฉพาะสาขาตัวเอง · กดปุ่มค้นหาเพิ่มเติมถึงจะเห็นทุกสาขา */
var _brSearchAll = false;
function brSearchAllBranches() {
  _brSearchAll = true;
  branchSearch();
  try { updateBranchStats(); } catch (e) {}
  var q = document.getElementById('branchSearchQ');
  if (q) q.focus();
}
function brSearchMyBranchOnly() {
  _brSearchAll = false;
  var q = document.getElementById('branchSearchQ');
  if (q) q.value = '';
  branchSearch();
  try { updateBranchStats(); } catch (e) {}
}

function branchSearch() {
  var q = (document.getElementById('branchSearchQ') || { value: '' }).value.trim().toLowerCase();
  var grid = document.getElementById('branchResults');
  if (!grid) return;
  _fhResetSelIfFilterChanged('br');   // เปลี่ยนคำค้น → ล้างที่ติ๊กไว้ก่อนวาดช่องติ๊ก

  var all = allRecords || [];
  var myBranch = (typeof currentBranchName !== 'undefined') ? currentBranchName : '';
  /* ขอบเขต: พิมพ์ค้นหา หรือกดค้นหาเพิ่มเติมแล้ว = ทุกสาขา · ไม่งั้นเฉพาะสาขาตัวเอง
     สาขาส่วนใหญ่เข้ามาหาใบเซอร์ของลูกน้องตัวเอง ไม่ใช่ของทั้งบริษัท
     เดิมเปิดมาเจอ 652 ใบของทุกสาขา ต้องพิมพ์กรองเองทุกครั้ง */
  var scopeAll = _brSearchAll || !!q;
  var base = (scopeAll || !myBranch) ? all : all.filter(function(r){ return _brSameBranch(r['สาขา'], myBranch); });

  var results = !q ? base : base.filter(function(r){
    var hay = ((r['ชื่อในใบรับรอง']||'') + ' ' + (r['ชื่อในระบบ']||'') + ' ' + (r['สาขา']||'') + ' ' + (r['ตำแหน่ง']||'') + ' ' + (r['หลักสูตร']||'')).toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  _brLastResults = results;   // ใช้ตอนกด "เลือกทั้งหมด" ที่หัวตาราง

  var btnAll = '<button type="button" class="br-scope-btn" onclick="brSearchAllBranches()">🔍 ค้นหาเพิ่มเติมทุกสาขา</button>';
  var btnMine = '<button type="button" class="br-scope-btn" onclick="brSearchMyBranchOnly()">↩ กลับมาดูเฉพาะสาขาตัวเอง</button>';

  var info = document.getElementById('branchSearchInfo');
  if (info) {
    if (q) {
      info.innerHTML = 'พบ <strong>' + results.length + '</strong> รายการ (ค้นหาทุกสาขา)'
        + (myBranch ? ' <span class="br-scope-sp"></span>' + btnMine : '');
    } else if (scopeAll) {
      info.innerHTML = 'แสดงทุกสาขา <strong>' + results.length + '</strong> รายการ — พิมพ์ชื่อเพื่อค้นหา'
        + (myBranch ? ' <span class="br-scope-sp"></span>' + btnMine : '');
    } else {
      info.innerHTML = 'ใบรับรองของ <strong>' + escapeHtml(myBranch || 'สาขา') + '</strong> · <strong>' + results.length + '</strong> รายการ'
        + ' <span class="br-scope-sp"></span>' + btnAll;
    }
  }

  if (!results.length) {
    var head, sub, act;
    if (q) { head = 'ไม่พบชื่อนี้ในระบบ'; sub = 'ลองพิมพ์เฉพาะชื่อหรือนามสกุล'; act = myBranch ? btnMine : ''; }
    else if (!scopeAll && myBranch) { head = 'สาขายังไม่มีใบรับรองในระบบ'; sub = 'กดค้นหาเพิ่มเติมเพื่อดูของสาขาอื่น หรือส่งรายชื่อเข้าอบรม'; act = btnAll; }
    else { head = 'ยังไม่มีใบรับรองในระบบ'; sub = 'กดเมนูส่งรายชื่อเพื่อส่งพนักงานเข้าอบรม'; act = ''; }
    grid.innerHTML = '<div class="table-container tc-cards"><table><tbody><tr><td class="empty">' +
      '<div style="font-size:44px;margin-bottom:10px;">📂</div>' +
      '<div style="font-weight:700;color:var(--text2);margin-bottom:4px;">' + head + '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-bottom:12px;">' + sub + '</div>' +
      act + '</td></tr></tbody></table></div>';
    fhUpdateSelBar('br');
    return;
  }

  var MAX = 300;
  _brLastResults = results.slice(0, MAX);   // "เลือกทั้งหมด" = เฉพาะที่แสดงจริง
  var rows = results.slice(0, MAX).map(function(r, i){
    var status = r['สถานะใบรับรอง'] || 'unknown';
    var url = _fhCertUrl(r['ชื่อในใบรับรอง'], r['หลักสูตร']);
    return '<tr data-st="' + escapeAttr(status) + '">'
      + '<td class="td-chk" data-label="เลือก" data-icon="☑️">' + _fhChkHtml('br', r['ชื่อในใบรับรอง'], r['หลักสูตร']) + '</td>'
      + '<td class="no-txt" data-label="ลำดับ" data-icon="🔢">' + (i + 1) + '</td>'
      + '<td class="cert-name" data-label="ชื่อ" data-icon="📜">' + escapeHtml(r['ชื่อในใบรับรอง'] || '—') + '</td>'
      + '<td data-label="สาขา" data-icon="🏢" class="branch-txt">' + escapeHtml(r['สาขา'] || '—') + '</td>'
      + '<td data-label="หลักสูตร" data-icon="📚" style="color:var(--text3);font-size:11px;max-width:180px;">' + escapeHtml(_courseShort(r['หลักสูตร'] || '')) + '</td>'
      + '<td data-label="วันหมดอายุ" data-icon="⏰" style="white-space:nowrap;font-size:12px;color:var(--text2);">' + escapeHtml(formatThaiDate(r['วันหมดอายุ'])) + '</td>'
      + '<td data-label="สถานะ" data-icon="🏷">' + getExpBadge(status) + '</td>'
      + '<td data-label="ใบเซอร์" data-icon="⚙️" class="td-row-actions">'
      +   (url ? '<a class="btn-row-view" href="' + url + '" target="_blank" rel="noopener" title="ดาวน์โหลดใบเซอร์" style="text-decoration:none;">⬇️</a>' : '<span style="color:var(--text3)">—</span>')
      + '</td>'
      + '</tr>';
  }).join('');

  grid.innerHTML = '<div class="table-container tc-cards">'
    + '<table id="branchCertTable"><thead><tr>'
    +   '<th class="th-chk"><input type="checkbox" class="chk-cert" id="brChkAll" onclick="fhSelectAllCerts(\'br\', this.checked)" title="เลือกทุกรายการที่แสดงอยู่"></th>'
    +   '<th>ลำดับ</th><th>ชื่อ</th><th>สาขา</th><th>หลักสูตร</th><th>วันหมดอายุ</th><th>สถานะ</th><th class="th-actions">ใบเซอร์</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + (results.length > MAX ? '<div class="count-line">แสดง ' + MAX + ' รายการแรกจาก ' + results.length + ' · พิมพ์เพื่อกรองให้แคบลง</div>' : '')
    + '</div>';
  fhUpdateSelBar('br');
}

function addRequestRow() {
  requestRows.push({name:'', empId:'', idCard:'', branch: currentBranchName || '', position:'', course:'', trainDate:'', timeSlot:'', note:''});
  rerenderRequestList();
}

/* ─── Load submitted requests (history) ─── */
/* Build index: normalized name → best cert status (valid > warning > expired)
   Used to render the "ใบรับรอง" column in admin requests tables. */
function buildCertIndex() {
  var idx = {};
  if (typeof matchData === 'undefined' || !matchData || !matchData.length) return idx;
  var rank = { valid: 3, warning: 2, expired: 1 };
  matchData.forEach(function(d){
    var key = String(d.certName||'').replace(/\s+/g,'').toLowerCase();
    if (!key) return;
    var st = d.expStatus || 'unknown';
    var r = rank[st] || 0;
    if (!idx[key] || r > idx[key].rank) {
      idx[key] = { status: st, rank: r, expireDate: d.expireDate || '', course: d.course || '' };
    }
  });
  return idx;
}
function certBadgeHtml(name, certIdx) {
  var key = String(name||'').replace(/\s+/g,'').toLowerCase();
  var hit = certIdx[key];
  if (!hit) {
    // ใบรับรองยังโหลดไม่เสร็จ ≠ ไม่มีใบ — บอกให้ตรงความจริง
    if (!certIdx || !Object.keys(certIdx).length) {
      return '<span class="cert-badge cb-load" title="กำลังโหลดฐานใบรับรอง…">⋯ กำลังตรวจ</span>';
    }
    return '<span class="cert-badge cb-none" title="ยังไม่มีใบรับรองในระบบ — คนนี้ควรได้เข้าอบรม">— ยังไม่มีใบ</span>';
  }
  var exp = hit.expireDate ? formatThaiDate(hit.expireDate) : '';
  var lbl = hit.status === 'valid'   ? { cls:'cb-valid', txt:'✓ ยังมีผล', tip:'ใบรับรองยังมีผล' }
          : hit.status === 'warning' ? { cls:'cb-warn',  txt:'⚠ ใกล้หมด', tip:'ใกล้หมดอายุ' }
          : hit.status === 'expired' ? { cls:'cb-exp',   txt:'✗ หมดอายุ', tip:'หมดอายุแล้ว' }
          : { cls:'cb-none', txt:'—', tip:'' };
  // มีไฟล์ PDF บนคลาวด์ไหม — มีก็กดเปิดได้เลยจากตรงนี้
  var url = '';
  try { if (typeof _fhCertUrl === 'function') url = _fhCertUrl(name, hit.course || ''); } catch (e) {}
  var tip = lbl.tip + (exp ? ' · หมดอายุ ' + exp : '') + (url ? ' · กดเพื่อเปิดไฟล์ PDF' : ' · ยังไม่มีไฟล์ PDF ในระบบ');
  var badge = '<span class="cert-badge ' + lbl.cls + '">' + lbl.txt + '</span>';
  var pdf = url
    ? '<a class="cert-pdf-link" href="' + escapeAttr(url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="เปิดใบรับรอง PDF">📄</a>'
    : '';
  return '<span class="cert-cell" title="' + escapeAttr(tip) + '">' + badge + pdf + '</span>';
}

/* หน้าคำขออบรมต้องรู้ว่าใครมีใบรับรองแล้ว — แต่ฐานใบรับรองโหลดเฉพาะตอนเปิดหน้าใบรับรอง
   จึงดึงให้เองเบื้องหลังครั้งเดียว แล้วรีเฟรชเฉพาะคอลัมน์ใบรับรอง (ไม่กระทบตัวกรอง/หน้าที่เปิดอยู่) */
var _fhCertAutoLoaded = false;
function _fhEnsureCertsForRequests() {
  if (typeof matchData !== 'undefined' && matchData && matchData.length) return;
  var cached = _fhCacheGet('fh_cert_v1');          // แคชในเครื่อง → ขึ้นทันที
  if (cached && cached.length) {
    matchData = cached;
    try { _refreshAdminReqCerts(); } catch (e) {}
  }
  if (_fhCertAutoLoaded) return;
  _fhCertAutoLoaded = true;
  fhLoadCertificates()                              // แล้วค่อยดึงของสดมาทับ
    .then(function(records){
      if (!records || !records.length) return;
      matchData = _fhMapCerts(records);
      _fhCacheSet('fh_cert_v1', matchData);
      try { _refreshAdminReqCerts(); } catch (e) {}
    })
    .catch(function(e){ console.warn('[FH] โหลดใบรับรองเบื้องหลังไม่สำเร็จ', e); });
}
function certSummaryHtml(rows, certIdx) {
  var c = { valid:0, warning:0, expired:0, none:0 };
  rows.forEach(function(r){
    var nm = r['name'] || r['ชื่อ-นามสกุล'] || r['ชื่อ'] || '';
    var key = String(nm).replace(/\s+/g,'').toLowerCase();
    var hit = certIdx[key];
    if (!hit) c.none++;
    else if (hit.status === 'valid') c.valid++;
    else if (hit.status === 'warning') c.warning++;
    else if (hit.status === 'expired') c.expired++;
    else c.none++;
  });
  var parts = [];
  if (c.valid)   parts.push('<span class="cert-badge cb-valid">✓ '+c.valid+'</span>');
  if (c.warning) parts.push('<span class="cert-badge cb-warn">⚠ '+c.warning+'</span>');
  if (c.expired) parts.push('<span class="cert-badge cb-exp">✗ '+c.expired+'</span>');
  if (c.none)    parts.push('<span class="cert-badge cb-none">— '+c.none+'</span>');
  return parts.join('');
}

/* Normalize raw request record → derived fields (apply COURSE_SCHEDULES override + regex fallback) */
function _prepReqFields(r) {
  var ts = r['timestamp'] || r['วันที่ส่ง'] || '';
  var name = r['name'] || r['ชื่อ-นามสกุล'] || r['ชื่อ'] || '—';
  var idCard = r['idCard'] || r['เลขบัตรประชาชน'] || r['เลขบัตร'] || '';
  var branch = r['branch'] || r['สาขา'] || '—';
  var pos = r['position'] || r['ตำแหน่ง'] || '—';
  var course = r['course'] || r['หลักสูตร'] || '—';
  var trainDate = r['trainDate'] || r['วันอบรม'] || '';
  var slot = r['timeSlot'] || r['รอบ'] || '';
  var note = r['note'] || r['หมายเหตุ'] || '';
  var round = _fhRoundText_(r['round'] || r['รุ่น'] || r['รุ่นที่'] || '');
  if (course && course !== '—' && typeof COURSE_SCHEDULES !== 'undefined') {
    var sch = null;
    var keys = Object.keys(COURSE_SCHEDULES);
    keys.sort(function(a,b){ return b.length - a.length; });
    for (var ck = 0; ck < keys.length; ck++) {
      var key = keys[ck];
      if (course === key || String(course).indexOf(key) >= 0) { sch = COURSE_SCHEDULES[key]; break; }
      var uniq = key.replace(/^การสุขาภิบาลอาหาร\s*สำหรับ\s*/, '').trim();
      if (uniq && String(course).indexOf(uniq) >= 0) { sch = COURSE_SCHEDULES[key]; break; }
    }
    if (sch) {
      // เติมเฉพาะตอนเรคคอร์ดไม่มีค่าของตัวเอง — ห้ามทับ! ไม่งั้นแก้ตารางอบรมทีเดียว รายชื่อเก่าย้ายวัน/ย้ายรุ่นตามทั้งหมด
      if (!trainDate) trainDate = sch.date || '';
      if (!slot && sch.slots && sch.slots.length === 1) slot = sch.slots[0];
      if (!round) round = _roundIfSameDay_(sch, trainDate, slot);
    }
  }
  if ((!trainDate || !slot) && course && course !== '—') {
    if (!trainDate) {
      var dm = String(course).match(/วันที่\s*(\d{1,2}\s+\S+\s+\d{4})/);
      if (!dm) dm = String(course).match(/(\d{1,2}\s+(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?)\s+\d{4})/);
      if (dm) trainDate = dm[1];
    }
    if (!slot) {
      var tm = String(course).match(/เวลา\s*(\d{1,2}[.:]\d{2}\s*[-–~]\s*\d{1,2}[.:]\d{2})/);
      if (!tm) tm = String(course).match(/(\d{1,2}[.:]\d{2}\s*[-–~]\s*\d{1,2}[.:]\d{2})/);
      if (tm) slot = tm[1];
    }
  }
  return {
    ts: ts, name: name, idCard: idCard, branch: branch, pos: pos, course: course,
    trainDate: trainDate, slot: slot, note: note, round: round,
    tsFmt: ts ? formatThaiDateTime(ts) : '—',
    empId: r.empId || r['รหัสพนักงาน'] || '',
    rowIdx: r._rowIndex || r.rowIndex || '',
    sbId: (r._sbId != null ? r._sbId : ''),   // id จริงบน Supabase — ใช้ลบ/แก้ให้ตรงแถว
    tsRaw: r.timestamp || r['วันที่ส่ง'] || ''
  };
}

/* Render one admin request row. showCourseCol=false → omit หลักสูตร column (used in per-course tables). */
function _renderAdminReqRow(r, certIdx, showCourseCol) {
  var p = _prepReqFields(r);
  var keyData = encodeURIComponent(JSON.stringify({ sbId: p.sbId, rowIndex: p.rowIdx, timestamp: String(p.tsRaw), name: p.name, idCard: p.idCard }));
  var html = '<tr>'
    +'<td data-label="สาขา" data-icon="🏬">'+escapeHtml(_brDispG(p.branch))+'</td>'
    +'<td data-label="ชื่อ" data-icon="👤" class="cert-name">'+escapeHtml(p.name)+'</td>'
    +'<td data-label="รหัสพนง" data-icon="🆔">'+escapeHtml(p.empId)+'</td>'
    +'<td data-label="ตำแหน่ง" data-icon="💼">'+escapeHtml(p.pos)+'</td>';
  if (showCourseCol) {
    // ย่อชื่อหลักสูตรกันตัดบรรทัด — ชื่อเต็มอยู่ใน tooltip
    html += '<td data-label="หลักสูตร" data-icon="📚" class="td-course" title="'+escapeAttr(p.course)+'">'
         +    '<span class="course-pill">'+escapeHtml(_courseShort(p.course))+'</span>'
         + '</td>';
  }
  // วัน · เวลา · รุ่น — บรรทัดละอย่าง ไม่ตัดคำ ไม่ทับกัน
  var dateSlot = '<div class="ds-cell">'
    +   '<span class="ds-date">'+escapeHtml(formatThaiDate(p.trainDate))+'</span>'
    +   (p.slot ? '<span class="ds-slot">'+escapeHtml(p.slot)+' น.</span>' : '')
    +   (p.round
          ? '<span class="round-chip">รุ่น '+escapeHtml(p.round)+'</span>'
          : '<span class="round-chip round-chip-none" title="ยังไม่ระบุรุ่น — ใช้ปุ่ม 🏷️ กำหนดรุ่น">ไม่ระบุรุ่น</span>')
    + '</div>';
  html += '<td data-label="วันอบรม / รอบเวลา" data-icon="📅" class="td-dateslot">'+dateSlot+'</td>'
    +'<td data-label="ใบรับรอง" data-icon="📜">'+certBadgeHtml(p.name, certIdx)+'</td>'
    +'<td data-label="วันที่ส่ง" data-icon="📤">'+escapeHtml(p.tsFmt)+'</td>'
    +'<td data-label="จัดการ" data-icon="⚙️" class="td-actions">'
    +   '<button class="btn-view-req" onclick="openReqDetailModal(\''+keyData+'\')" title="ดูรายละเอียด">👁</button>'
    +   '<button class="btn-edit-req" onclick="openEditRequest(\''+keyData+'\', '+p.rowIdx+')" title="แก้ไข">✏️</button>'
    +   '<button class="btn-del-req" onclick="deleteRequest(\''+keyData+'\')" title="ลบ">🗑</button>'
    +'</td>'
    +'</tr>';
  return html;
}

/* Render one branch-view request row (no ใบรับรอง column — visible to branch users)
   Row is clickable on mobile to open detail modal. */
var _myReqRowCache = [];
function _renderMyReqRow(r) {
  var p = _prepReqFields(r);
  var idx = _myReqRowCache.push(p) - 1;
  var dateSlot = escapeHtml(formatThaiDate(p.trainDate));
  if (p.slot) dateSlot += ' <span style="color:var(--text3);font-weight:600;">(' + escapeHtml(p.slot) + ')</span>';
  return '<tr data-myreq-idx="'+idx+'" class="myreq-row">'
    +'<td data-label="ชื่อ" data-icon="👤" class="cert-name" onclick="_openMyReqDetail('+idx+')">'+escapeHtml(p.name)+'</td>'
    +'<td data-label="รหัสพนง" data-icon="🆔" onclick="_openMyReqDetail('+idx+')">'+escapeHtml(p.empId)+'</td>'
    +'<td data-label="ตำแหน่ง" data-icon="💼" onclick="_openMyReqDetail('+idx+')">'+escapeHtml(p.pos)+'</td>'
    +'<td data-label="หลักสูตร" data-icon="📚" style="font-size:12.5px;" onclick="_openMyReqDetail('+idx+')">'+escapeHtml(p.course)+'</td>'
    +'<td data-label="วันอบรม / รอบเวลา" data-icon="📅" onclick="_openMyReqDetail('+idx+')">'+dateSlot+'</td>'
    +'<td data-label="วันที่ส่ง" data-icon="📤" onclick="_openMyReqDetail('+idx+')">'+escapeHtml(p.tsFmt)+'</td>'
    +'<td data-label="จัดการ" class="td-actions td-myreq-view">'
    +   '<button class="btn-view-req" onclick="_openMyReqDetail('+idx+')" title="ดูรายละเอียด">ดูข้อมูล</button>'
    +'</td>'
    +'</tr>';
}
function _openMyReqDetail(idx) {
  var p = _myReqRowCache[idx];
  if (!p) return;
  if (typeof _openDetailModal !== 'function') return;
  _openDetailModal({
    title: '📋 รายละเอียดคำขออบรม',
    subtitle: '',
    items: [
      { section: 'พนักงาน' },
      { label: 'ชื่อ-นามสกุล',     value: p.name },
      { label: 'รหัสพนักงาน',      value: p.empId || '—' },
      { label: 'เลขบัตรประชาชน',  value: p.idCard || '—' },
      { label: 'ตำแหน่ง',          value: p.pos },
      { label: 'สาขา',             value: p.branch },
      { section: 'อบรม' },
      { label: 'หลักสูตร',          value: p.course },
      { label: 'วันอบรม',           value: formatThaiDate(p.trainDate) || '—' },
      { label: 'รอบ',               value: p.slot || '—' },
      { label: 'รุ่นที่',            value: p.round || '—' },
      { section: 'การส่ง' },
      { label: 'วันที่ส่ง',          value: p.tsFmt },
      { label: 'หมายเหตุ',          value: p.note || '—' },
    ],
  });
}

/* ═══ Admin request count chips + filter bar ═══ */
var _adminCertIdx = {};
var _adminReqFilters = { course: 'all', zone: 'all', branch: 'all', trainDate: 'all', slot: 'all', search: '', sort: 'date_desc' };

function _getRowCourse(r) {
  return _normCourseName_(r.course || r['หลักสูตร'] || '') || '— ไม่ระบุ';
}
function _getRowBranch(r) {
  return String(r.branch || r['สาขา'] || '').trim() || '— ไม่ระบุ';
}
function _getRowTrainDate(r) {
  // normalize ก่อน — ไม่งั้น "12 มิถุนายน 2569" กับ "12 มิ.ย. 2569" โผล่เป็น 2 ตัวเลือกในดรอปดาวน์
  return _normDateKey_(_prepReqFields(r).trainDate) || '— ไม่ระบุ';
}
// รวมรอบเวลาที่เขียนต่างกันให้เป็นรูปแบบเดียว (เว้นวรรค/ชนิดขีดต่างกัน = รอบเดียวกัน)
function _normSlot(s) {
  s = String(s || '').trim();
  if (!s) return '';
  return s.replace(/[–—~]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}
function _getRowSlot(r) {
  return _normSlot(_prepReqFields(r).slot) || '— ไม่ระบุ';
}
/* ═══ คีย์จัดกลุ่ม "1 รุ่น" ═══
   ข้อมูลจริงเขียนไม่เหมือนกัน (เวลาเว้นวรรคไม่เท่ากัน · วันเขียนเต็ม/ย่อ · ชื่อหลักสูตรมีช่องว่างเกิน)
   ถ้าเอาข้อความดิบมาเทียบตรง ๆ รอบเดียวกันจะโดนแตกเป็นหลายรุ่น — ต้อง normalize ก่อนเสมอ */
function _normCourseName_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
/* กู้ค่ารุ่นที่ถูก Google Sheets แปลงเป็นวันที่
   พิมพ์ "2/2569" → Sheets เดาว่าเป็น เดือน/ปี → เก็บเป็น 1 ก.พ. 2569
   → ส่งกลับมาเป็น "2569-01-31T17:00:00.000Z" (UTC) → แปลงกลับเป็นเวลาไทยแล้วอ่านเดือน/ปี */
function _fhRoundText_(v) {
  var s = String(v == null ? '' : v).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}/.exec(s);
  if (!m) return s;
  var d = new Date(s);
  if (isNaN(d.getTime())) return s;
  var bkk = new Date(d.getTime() + 7 * 3600000);   // ISO ที่ได้เป็น UTC → เลื่อนเป็นเวลาไทย
  return (bkk.getUTCMonth() + 1) + '/' + bkk.getUTCFullYear();
}
function _normDateKey_(s) {
  var raw = String(s == null ? '' : s).trim();
  if (!raw || raw === '—') return '';
  var d = null;
  try { d = parseAnyDate(raw); } catch (e) {}
  if (!d || isNaN(d.getTime())) return raw.replace(/\s+/g, ' ');   // อ่านไม่ออกก็ใช้ข้อความที่บีบช่องว่างแล้ว
  var p = function(n){ return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function _reqGroupOf_(r) {
  var p = _prepReqFields(r);
  var course = _normCourseName_(p.course);
  var dateKey = _normDateKey_(p.trainDate);
  var slot = _normSlot(p.slot);
  return { p: p, course: course, dateKey: dateKey, slot: slot, key: course + '|' + dateKey + '|' + slot };
}
/* Zone derivation — keyword-based mapping from branch name (BZM = Branch Zone Map).
   Edit the BRANCH_ZONE_RULES list to adjust grouping for your business. */
var BRANCH_ZONE_RULES = [
  { zone: 'ภาคตะวันออก', keywords: ['พัทยา','ระยอง','ชลบุรี','ศรีราชา','สัตหีบ','พนัสนิคม','สัตหีบ'] },
  { zone: 'ปริมณฑล', keywords: ['รังสิต','Westgate','เวสต์เกต','บางใหญ่','ปทุมธานี','นวนคร','ศาลายา','สำโรง','บางพลี','รัตนาธิเบศร์','งามวงศ์วาน','สมุทรปราการ'] },
  { zone: 'กทม. - ตะวันออก', keywords: ['บางกะปิ','รามอินทรา','แฟชั่น','เพลินนารี่'] },
  { zone: 'กทม. - ฝั่งธน', keywords: ['บางแค','ท่าพระ','ปิ่นเกล้า','บางปะกอก'] },
  { zone: 'กทม. - ใต้', keywords: ['พระราม 2','พระราม2','ศรีนครินทร์'] },
  { zone: 'กทม. - เหนือ', keywords: ['หลักสี่','แจ้งวัฒนะ','Promenade','พรอมานาด'] },
  { zone: 'กทม. - กลาง', keywords: ['อโศก','สุขาภิบาล','สามย่าน','ราชเทวี'] },
];
function _getRowZone(r) {
  var b = _getRowBranch(r);
  for (var i = 0; i < BRANCH_ZONE_RULES.length; i++) {
    var rule = BRANCH_ZONE_RULES[i];
    for (var k = 0; k < rule.keywords.length; k++) {
      if (b.indexOf(rule.keywords[k]) >= 0) return rule.zone;
    }
  }
  return '— ต่างจังหวัด';
}

/* Render stat-card style boxes: รวม + per-course (sorted by count desc). Click = filter. */
function _renderAdminReqCountBar(rows) {
  var bar = document.getElementById('adminReqCountBar');
  if (!bar) return;
  var groups = {};
  rows.forEach(function(r){
    var c = _getRowCourse(r);
    groups[c] = (groups[c] || 0) + 1;
  });
  var keys = Object.keys(groups).sort(function(a,b){
    if (a.indexOf('ไม่ระบุ') >= 0) return 1;
    if (b.indexOf('ไม่ระบุ') >= 0) return -1;
    return groups[b] - groups[a];
  });
  var palette = ['rcc-blue', 'rcc-green', 'rcc-orange', 'rcc-purple', 'rcc-teal', 'rcc-pink'];
  var active = _adminReqFilters.course;
  var total = rows.length;
  var pct = function(n) { return total > 0 ? (Math.round(n / total * 1000) / 10) + '%' : ''; };
  /* การ์ดสรุปยอด = แสดงผลอย่างเดียว ไม่ให้กดแล้ว
     เดิมกดเพื่อกรองหลักสูตรได้ ซึ่งซ้ำกับดรอปดาวน์หลักสูตร และกดโดนโดยไม่ตั้งใจบ่อย
     ยังคงไฮไลต์ .active ไว้ เพื่อบอกว่าตอนนี้กำลังกรองหลักสูตรไหนอยู่ */
  var html = '<div class="req-count-card rcc-gold'+(active==='all'?' active':'')+'">'
    + '<div class="req-count-card-label">📋 รวมทั้งหมด</div>'
    + '<div class="req-count-card-num-row">'
    +   '<div class="req-count-card-num">'+total+'</div>'
    +   '<div class="req-count-card-pct">100%</div>'
    + '</div>'
    + '</div>';
  keys.forEach(function(c, i){
    var color = palette[i % palette.length];
    var isActive = (c === active);
    var enc = encodeURIComponent(c);
    html += '<div class="req-count-card '+color+(isActive?' active':'')+'" title="'+escapeAttr(c)+'">'
      + '<div class="req-count-card-label">📚 '+escapeHtml(c)+'</div>'
      + '<div class="req-count-card-num-row">'
      +   '<div class="req-count-card-num">'+groups[c]+'</div>'
      +   '<div class="req-count-card-pct">'+pct(groups[c])+'</div>'
      + '</div>'
      + '</div>';
  });
  bar.innerHTML = html;
}

/* Click handler for sortable column headers — toggles desc ↔ asc for the clicked field */
function _toggleHeaderSort(field) {
  var cur = _adminReqFilters.sort;
  if (cur === field+'_desc') _adminReqFilters.sort = field+'_asc';
  else _adminReqFilters.sort = field+'_desc';
  _applyAdminReqFilters();
}

/* Update visual indicator (▲/▼) on sortable column headers */
function _updateSortIndicators() {
  var sort = _adminReqFilters.sort;
  var ths = document.querySelectorAll('#adminReqTable th.sortable');
  ths.forEach(function(th){
    var f = th.getAttribute('data-sort-key');
    var ind = th.querySelector('.sort-ind');
    if (!ind) return;
    if (sort === f+'_desc')      { ind.textContent = '▼'; th.classList.add('sort-active'); }
    else if (sort === f+'_asc')  { ind.textContent = '▲'; th.classList.add('sort-active'); }
    else                          { ind.textContent = '';  th.classList.remove('sort-active'); }
  });
}

/* Populate filter dropdowns — faceted: ตัวเลขแต่ละช่องอิงตัวกรอง "อื่น" ที่เลือกอยู่
   (เลือกหลักสูตรแล้ว รอบ/วันจะเหลือเฉพาะที่มีจริง · กันเลือกชนกันได้ 0) */
function _populateAdminReqFilterOptions(allRows) {
  var courseSel = document.getElementById('adminReqCourseFilter');
  var branchSel = document.getElementById('adminReqBranchFilter');
  if (!courseSel || !branchSel) return;
  var zoneSel = document.getElementById('adminReqZoneFilter');
  var dateSel = document.getElementById('adminReqDateFilter');
  var slotSel = document.getElementById('adminReqSlotFilter');
  allRows = allRows || [];
  var F = _adminReqFilters;
  var q = String(F.search || '').trim().toLowerCase();

  // ผ่านตัวกรองทุกตัว "ยกเว้น" มิติที่กำลังนับ
  function passExcept(r, except) {
    if (except !== 'course'    && F.course    !== 'all' && _getRowCourse(r)    !== F.course)    return false;
    if (except !== 'zone'      && F.zone      !== 'all' && _getRowZone(r)      !== F.zone)      return false;
    if (except !== 'branch'    && F.branch    !== 'all' && _getRowBranch(r)    !== F.branch)    return false;
    if (except !== 'trainDate' && F.trainDate !== 'all' && _getRowTrainDate(r) !== F.trainDate) return false;
    if (except !== 'slot'      && F.slot      !== 'all' && _getRowSlot(r)      !== F.slot)      return false;
    if (except !== 'search'    && q) {
      var p = _prepReqFields(r);
      if ([p.name,p.empId,p.idCard,p.branch,p.pos,p.course,p.note].join(' ').toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }
  function build(sel, except, getter, allLabel, cur, label, tailKey) {
    if (!sel) return;
    var m = {}, total = 0;
    allRows.forEach(function(r){ if (passExcept(r, except)) { var k = getter(r); m[k] = (m[k]||0)+1; total++; } });
    if (cur && cur !== 'all' && m[cur] === undefined) m[cur] = 0; // คงค่าที่เลือกไว้ให้เห็น (แม้ 0)
    var keys = Object.keys(m).sort(function(a,b){
      if (tailKey) { if (a.indexOf(tailKey)>=0) return 1; if (b.indexOf(tailKey)>=0) return -1; }
      return m[b] - m[a];
    });
    sel.innerHTML = '<option value="all">'+allLabel+' ('+total+')</option>'
      + keys.map(function(k){
          var lbl = label ? label(k) : k;
          return '<option value="'+escapeAttr(k)+'"'+(k===cur?' selected':'')+'>'+escapeHtml(lbl)+' ('+m[k]+')</option>';
        }).join('');
  }
  build(courseSel, 'course',    _getRowCourse,    '📚 ทุกหลักสูตร', F.course,    null, null);
  build(zoneSel,   'zone',      _getRowZone,      '📍 ทุกโซน',      F.zone,      null, 'ต่างจังหวัด');
  build(branchSel, 'branch',    _getRowBranch,    '🏬 ทุกสาขา',     F.branch,    _brDispG, null);
  build(dateSel,   'trainDate', _getRowTrainDate, '📅 ทุกวันอบรม',  F.trainDate, function(d){ return d.indexOf('ไม่ระบุ')>=0 ? d : (formatThaiDate(d)||d); }, 'ไม่ระบุ');
  build(slotSel,   'slot',      _getRowSlot,      '🕐 ทุกรอบเวลา',  F.slot,      null, 'ไม่ระบุ');
  try { _updateReqCascade(); } catch (e) { console.warn('cascade', e); }
}


/* ── ตัวกรองแบบไล่ลำดับ ──────────────────────────────────────────
   โชว์ทีละช่อง: เลือกหลักสูตร → โผล่สาขา → โผล่วันอบรม → โผล่รอบเวลา
   ที่เลือกไปแล้วกลายเป็นชิป กดชิปเพื่อย้อนกลับไปแก้ระดับนั้น (ล้างระดับที่ลึกกว่าให้ด้วย)
   ทำที่ชั้นแสดงผลล้วน ๆ — select ทั้ง 4 ตัวยังอยู่ครบ ตรรกะกรอง/นับจึงไม่ต้องแก้
   ถ้าสคริปต์ตรงนี้พังด้วยเหตุใด ทุกช่องจะโผล่หมดเหมือนเดิม ไม่ใช่หายไปทั้งแถบ */
var _REQ_STEPS = ['adminReqCourseFilter', 'adminReqBranchFilter', 'adminReqDateFilter', 'adminReqSlotFilter'];
function _reqStepEls() {
  return _REQ_STEPS.map(function(id){ return document.getElementById(id); }).filter(Boolean);
}
function _updateReqCascade() {
  var els = _reqStepEls();
  if (els.length !== _REQ_STEPS.length) return;
  var chipBox = document.getElementById('reqCascadeChips');
  var chips = [];
  var openIdx = els.length;   // ช่องที่ให้เลือกต่อ = ตัวแรกที่ยังเป็น "ทั้งหมด"
  for (var i = 0; i < els.length; i++) {
    if (String(els[i].value || 'all') === 'all') { openIdx = i; break; }
  }
  for (var j = 0; j < els.length; j++) {
    if (j < openIdx) {
      els[j].classList.add('rc-hidden');
      var opt = els[j].options[els[j].selectedIndex];
      chips.push({ i: j,
        label: els[j].getAttribute('data-step-label') || '',
        text: opt ? opt.textContent : els[j].value });
    } else if (j === openIdx) {
      els[j].classList.remove('rc-hidden');
    } else {
      els[j].classList.add('rc-hidden');   // ยังไม่ถึงคิว
    }
  }
  if (chipBox) {
    chipBox.innerHTML = chips.map(function(c){
      var v = String(c.text).replace(/\s*\(\d+\)\s*$/, '');   // ตัดจำนวนในวงเล็บท้ายออก
      return '<button type="button" class="rc-chip" onclick="_reqCascadeBack(' + c.i + ')"'
        + ' title="แก้' + escapeAttr(c.label) + '">'
        + '<span class="rc-chip-k">' + escapeHtml(c.label) + '</span>'
        + '<span class="rc-chip-v">' + escapeHtml(v) + '</span>'
        + '<span class="rc-chip-x">✕</span></button>';
    }).join('');
  }
}
/* กดชิป = ย้อนกลับไปเลือกระดับนั้นใหม่ · ระดับที่ลึกกว่าต้องล้างด้วย
   ไม่งั้นจะเหลือค่าค้างของระดับลึกที่ไม่เข้ากับระดับบนที่เพิ่งเปลี่ยน */
function _reqCascadeBack(idx) {
  var els = _reqStepEls();
  for (var i = idx; i < els.length; i++) els[i].value = 'all';
  _applyAdminReqFilters();
}

/* Filter + sort + render to main table body */
function _applyAdminReqFilters() {
  var courseSel = document.getElementById('adminReqCourseFilter');
  var branchSel = document.getElementById('adminReqBranchFilter');
  var zoneSel = document.getElementById('adminReqZoneFilter');
  var dateSel = document.getElementById('adminReqDateFilter');
  var slotSel = document.getElementById('adminReqSlotFilter');
  var searchEl = document.getElementById('adminReqSearch');
  if (courseSel) _adminReqFilters.course = courseSel.value;
  if (branchSel) _adminReqFilters.branch = branchSel.value;
  if (zoneSel)   _adminReqFilters.zone   = zoneSel.value;
  if (dateSel)   _adminReqFilters.trainDate = dateSel.value;
  if (slotSel)   _adminReqFilters.slot   = slotSel.value;
  if (searchEl)  _adminReqFilters.search = searchEl.value;
  var body = document.getElementById('adminReqBody');
  var info = document.getElementById('adminReqInfo');
  if (!body) return;
  var rows = (_adminRowCache || []).slice();
  // Apply filters
  if (_adminReqFilters.course !== 'all') {
    rows = rows.filter(function(r){ return _getRowCourse(r) === _adminReqFilters.course; });
  }
  if (_adminReqFilters.zone !== 'all') {
    rows = rows.filter(function(r){ return _getRowZone(r) === _adminReqFilters.zone; });
  }
  if (_adminReqFilters.branch !== 'all') {
    rows = rows.filter(function(r){ return _getRowBranch(r) === _adminReqFilters.branch; });
  }
  if (_adminReqFilters.trainDate !== 'all') {
    rows = rows.filter(function(r){ return _getRowTrainDate(r) === _adminReqFilters.trainDate; });
  }
  if (_adminReqFilters.slot !== 'all') {
    rows = rows.filter(function(r){ return _getRowSlot(r) === _adminReqFilters.slot; });
  }
  var _q = String(_adminReqFilters.search || '').trim().toLowerCase();
  if (_q) {
    rows = rows.filter(function(r){
      var p = _prepReqFields(r);
      var hay = [p.name, p.empId, p.idCard, p.branch, p.pos, p.course, p.note].join(' ').toLowerCase();
      return hay.indexOf(_q) >= 0;
    });
  }
  // Re-populate dropdowns แบบ faceted — ตัวเลขแต่ละช่องอิงตัวกรองอื่นที่เลือกอยู่
  if (_adminRowCache) _populateAdminReqFilterOptions(_adminRowCache);
  // Apply sort
  var s = _adminReqFilters.sort;
  if (s === 'date_desc' || s === 'date_asc') {
    rows.sort(function(a,b){
      var ta = a['timestamp'] || a['วันที่ส่ง'] || '';
      var tb = b['timestamp'] || b['วันที่ส่ง'] || '';
      var cmp = tb > ta ? 1 : tb < ta ? -1 : 0;
      return s === 'date_asc' ? -cmp : cmp;
    });
  } else if (s === 'course_desc' || s === 'course_asc') {
    var cCount = {};
    rows.forEach(function(r){ var k = _getRowCourse(r); cCount[k] = (cCount[k]||0)+1; });
    rows.sort(function(a,b){
      var ka = _getRowCourse(a), kb = _getRowCourse(b);
      var d = cCount[kb] - cCount[ka];
      if (d !== 0) return s === 'course_asc' ? -d : d;
      // tiebreak: course name, then newest first
      if (ka !== kb) return ka < kb ? -1 : 1;
      var ta = a['timestamp']||'', tb = b['timestamp']||'';
      return tb > ta ? 1 : tb < ta ? -1 : 0;
    });
  } else if (s === 'branch_desc' || s === 'branch_asc') {
    var bCount = {};
    rows.forEach(function(r){ var k = _getRowBranch(r); bCount[k] = (bCount[k]||0)+1; });
    rows.sort(function(a,b){
      var ka = _getRowBranch(a), kb = _getRowBranch(b);
      var d = bCount[kb] - bCount[ka];
      if (d !== 0) return s === 'branch_asc' ? -d : d;
      if (ka !== kb) return ka < kb ? -1 : 1;
      var ta = a['timestamp']||'', tb = b['timestamp']||'';
      return tb > ta ? 1 : tb < ta ? -1 : 0;
    });
  }
  // มุมมองรุ่น: ยังไม่ได้เลือกรุ่น → โชว์การ์ดรุ่นแทนตาราง · เลือกแล้ว → กรองเหลือรุ่นนั้น
  var batches = _buildReqBatches(rows);
  if (_reqBatchKey) {
    var cur = batches.filter(function(b){ return b.key === _reqBatchKey; })[0];
    if (!cur) { _reqBatchKey = null; }        // รุ่นที่เปิดอยู่หายไปจากตัวกรอง → เด้งกลับหน้ารุ่น
    else rows = cur.rows;
  }
  _renderReqBatchView(batches, rows);

  // Render
  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="9" class="empty" style="padding:30px;color:var(--text3);text-align:center;">ไม่พบรายการตามตัวกรอง</td></tr>';
  } else {
    body.innerHTML = rows.map(function(r){ return _renderAdminReqRow(r, _adminCertIdx, true); }).join('');
  }
  if (info) {
    var totalAll = (_adminRowCache || []).length;
    if (!_reqBatchKey) {
      // หน้ารายการรุ่น — info อยู่ในกล่องตารางที่ถูกซ่อน แต่คงข้อความให้ตรงไว้
      info.innerHTML = 'พบ <strong>'+batches.length+'</strong> รุ่น · รวม <strong>'+rows.length+'</strong> รายชื่อ';
    } else if (rows.length === totalAll) {
      info.innerHTML = 'พบ <strong>'+rows.length+'</strong> รายการ';
    } else {
      info.innerHTML = 'แสดง <strong>'+rows.length+'</strong> จาก '+totalAll+' รายการ';
    }
  }
  // Update active state on count cards + sort indicators
  _renderAdminReqCountBar(_adminRowCache || []);
  _updateSortIndicators();
}

/* ═══ มุมมอง "รุ่น" — 1 รุ่น = หลักสูตร + วันอบรม + รอบเวลา (ตรงกับ 1 ใบทะเบียน) ═══ */
var _reqBatchKey = null;   // null = อยู่หน้ารายการรุ่น · มีค่า = เปิดรุ่นนั้นอยู่

function _buildReqBatches(rows) {
  var map = {}, out = [];
  (rows || []).forEach(function(r){
    var g = _reqGroupOf_(r), p = g.p;
    var key = g.key;
    if (!map[key]) {
      map[key] = { key: key, course: g.course, trainDate: p.trainDate, slot: g.slot, round: p.round || '', branches: {}, rows: [] };
      out.push(map[key]);
    }
    if (!map[key].round && p.round) map[key].round = p.round;
    map[key].branches[p.branch] = 1;
    map[key].rows.push(r);
  });
  out.forEach(function(b){ b.branchCount = Object.keys(b.branches).length; });
  // วันอบรมใหม่ก่อน → หลักสูตร → รอบเวลา
  out.sort(function(a, b){
    var da = parseAnyDate(a.trainDate), db = parseAnyDate(b.trainDate);
    if (da && db && da.getTime() !== db.getTime()) return db - da;
    if (!da && db) return 1;
    if (da && !db) return -1;
    if (a.course !== b.course) return a.course < b.course ? -1 : 1;
    return a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0;
  });
  return out;
}

function _renderReqBatchView(batches, rows) {
  var grid = document.getElementById('adminReqBatchWrap');
  var back = document.getElementById('adminReqBackBar');
  var tableWrap = document.getElementById('adminReqTableWrap');
  var bInfo = document.getElementById('adminReqBatchInfo');
  if (!grid || !back || !tableWrap) return;

  if (_reqBatchKey) {
    // อยู่ในรุ่นแล้ว → ซ่อนการ์ด โชว์ตาราง + แถบกลับ
    var b = batches.filter(function(x){ return x.key === _reqBatchKey; })[0] || {};
    grid.style.display = 'none';
    if (bInfo) bInfo.style.display = 'none';
    tableWrap.style.display = '';
    back.style.display = '';
    back.innerHTML = '<button class="rbatch-back-btn" onclick="_closeReqBatch()">← ทุกรุ่น</button>'
      + '<div class="rbatch-back-info">'
      +   (b.round ? '<span class="round-chip">รุ่น ' + escapeHtml(b.round) + '</span> ' : '<span class="round-chip round-chip-none">ยังไม่ระบุรุ่น</span> ')
      +   '<b>' + escapeHtml(b.course || '') + '</b><br>'
      +   '📅 ' + escapeHtml(formatThaiDate(b.trainDate) || '— ไม่ระบุวัน')
      +   ' · 🕐 ' + escapeHtml(b.slot || '— ไม่ระบุรอบ')
      +   ' · 👥 <b>' + ((b.rows && b.rows.length) || 0) + '</b> คน จาก ' + (b.branchCount || 0) + ' สาขา'
      +   '<br><span style="font-size:12px;">📜 ' + certSummaryHtml(b.rows || [], _adminCertIdx) + '</span>'
      + '</div>'
      + '<button class="rbatch-back-btn" onclick="openAdminReqRoundTool()" title="กำหนดรุ่นให้กลุ่มนี้">🏷️ กำหนดรุ่น</button>';
    return;
  }

  // หน้ารายการรุ่น → ซ่อนตาราง โชว์การ์ด
  back.style.display = 'none';
  tableWrap.style.display = 'none';
  grid.style.display = '';
  var noRound = batches.filter(function(x){ return !x.round; }).length;
  if (bInfo) {
    bInfo.style.display = '';
    bInfo.innerHTML = 'พบ <strong>' + batches.length + '</strong> รุ่น · รวม <strong>' + (rows || []).length + '</strong> รายชื่อ'
      + (noRound ? ' · <span style="color:#b45309;font-weight:700;">' + noRound + ' รุ่นยังไม่ระบุเลขรุ่น</span>' : '');
  }
  if (!batches.length) {
    grid.innerHTML = '<div class="rbatch-empty">ไม่พบรายการตามตัวกรอง</div>';
    return;
  }
  grid.innerHTML = batches.map(function(b){
    return '<div class="rbatch' + (b.round ? '' : ' rb-none') + '" onclick="_openReqBatch(\'' + escapeAttr(encodeURIComponent(b.key)) + '\')">'
      + '<div class="rbatch-top">'
      +   '<div class="rbatch-round">' + (b.round ? 'รุ่น ' + escapeHtml(b.round) : 'ยังไม่ระบุรุ่น') + '</div>'
      +   '<div class="rbatch-n">' + b.rows.length + '<span>คน</span></div>'
      + '</div>'
      + '<div class="rbatch-course">📚 ' + escapeHtml(b.course || '— ไม่ระบุหลักสูตร') + '</div>'
      + '<div class="rbatch-meta">'
      +   '<span>📅 <b>' + escapeHtml(formatThaiDate(b.trainDate) || '— ไม่ระบุวัน') + '</b></span>'
      +   '<span>🕐 <b>' + escapeHtml(b.slot || '— ไม่ระบุรอบ') + '</b></span>'
      + '</div>'
      + '<div class="rbatch-foot"><span>🏬 ' + b.branchCount + ' สาขา</span><span class="rbatch-go">ดูรายชื่อ →</span></div>'
      + '</div>';
  }).join('');
}

function _openReqBatch(encKey) {
  try { _reqBatchKey = decodeURIComponent(encKey); } catch (e) { _reqBatchKey = encKey; }
  _applyAdminReqFilters();
  var el = document.getElementById('adminReqBackBar');
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function _closeReqBatch() {
  _reqBatchKey = null;
  _applyAdminReqFilters();
  var el = document.getElementById('adminReqBatchWrap');
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _setCourseFilter(course, encoded) {
  if (encoded && course !== 'all') {
    try { course = decodeURIComponent(course); } catch(e) {}
  }
  // Toggle: คลิก chip ที่ active อยู่ → ยกเลิก (กลับเป็น all)
  if (_adminReqFilters.course === course) course = 'all';
  _adminReqFilters.course = course;
  _reqBatchKey = null;   // เปลี่ยนหลักสูตร → กลับไปหน้ารายการรุ่น
  var sel = document.getElementById('adminReqCourseFilter');
  if (sel) sel.value = course;
  _applyAdminReqFilters();
}
function _clearAdminReqFilters() {
  _adminReqFilters = { course: 'all', zone: 'all', branch: 'all', trainDate: 'all', slot: 'all', search: '', sort: 'date_desc' };
  _reqBatchKey = null;
  var c = document.getElementById('adminReqCourseFilter'); if (c) c.value = 'all';
  var z = document.getElementById('adminReqZoneFilter');   if (z) z.value = 'all';
  var b = document.getElementById('adminReqBranchFilter'); if (b) b.value = 'all';
  var d = document.getElementById('adminReqDateFilter');   if (d) d.value = 'all';
  var sl = document.getElementById('adminReqSlotFilter');  if (sl) sl.value = 'all';
  var sr = document.getElementById('adminReqSearch');      if (sr) sr.value = '';
  _applyAdminReqFilters();
}

// localStorage cache (stale-while-revalidate) — โชว์ของเดิมทันที แล้วรีเฟรชเบื้องหลัง
function _fhCacheSet(key, data){ try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {} }
function _fhCacheGet(key){ try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) { return null; } }
function _fhBustRequests(){ try { localStorage.removeItem('fh_requests_v1'); } catch(e) {} }  // ล้างแคชหลังแก้ข้อมูล

function loadRequests(branchFilter, infoElId, bodyElId, isAdmin) {
  var info = document.getElementById(infoElId);
  var body = document.getElementById(bodyElId);
  var inlineInfo = !isAdmin ? document.getElementById('myRequestsInfoInline') : null;
  if (!info || !body) return;

  function _process(records) {
    var rows = (records || []).slice();
    if (branchFilter) {
      rows = rows.filter(function(r){ return String(r.branch || r['สาขา'] || '') === String(branchFilter); });
    }
    if (rows.length === 0) {
      info.textContent = 'ยังไม่มีรายชื่อที่ส่ง';
      if (inlineInfo) inlineInfo.textContent = '· ยังไม่มี';
      if (isAdmin) {
        _adminRowCache = [];
        var bar = document.getElementById('adminReqCountBar'); if (bar) bar.innerHTML = '';
        _populateAdminReqFilterOptions([]);
        _reqBatchKey = null;
        _renderReqBatchView([], []);   // ล้างการ์ดรุ่นค้าง
      }
      body.innerHTML = '<tr><td colspan="'+(isAdmin?9:6)+'" class="empty" style="padding:30px;color:var(--text3);text-align:center;">ยังไม่มีข้อมูล</td></tr>';
      return;
    }
    if (inlineInfo) inlineInfo.innerHTML = '· พบ <strong>'+rows.length+'</strong> รายการ';
    if (isAdmin) {
      _adminRowCache = rows;
      _fhEnsureCertsForRequests();   // ยังไม่มีฐานใบรับรอง → ดึงเบื้องหลังแล้วรีเฟรชคอลัมน์ให้เอง
      _adminCertIdx = buildCertIndex();
      _renderAdminReqCountBar(rows);
      _populateAdminReqFilterOptions(rows);
      _applyAdminReqFilters();
    } else {
      rows.sort(function(a,b){
        var ta = a['timestamp'] || a['วันที่ส่ง'] || '';
        var tb = b['timestamp'] || b['วันที่ส่ง'] || '';
        return tb > ta ? 1 : tb < ta ? -1 : 0;
      });
      info.innerHTML = 'พบ <strong>'+rows.length+'</strong> รายการ';
      _myReqRowCache = [];
      body.innerHTML = rows.map(function(r){ return _renderMyReqRow(r); }).join('');
    }
  }

  // 1) โชว์จากแคชทันที (ถ้ามี) — ไม่ต้องรอเน็ต
  var _cached = _fhCacheGet('fh_requests_v1');
  if (_cached && _cached.length) { _process(_cached); }
  else { info.textContent = 'กำลังโหลด...'; if (inlineInfo) inlineInfo.textContent = '· กำลังโหลด...'; }

  // 2) ดึงสดเบื้องหลัง + อัปเดตแคช + re-render (คืน promise ไว้ให้คนที่ต้องรอผลสด)
  //    fhLoadRequests: Supabase ถ้าตั้งค่าไว้ · ไม่งั้น/พัง → Apps Script เหมือนเดิม
  return fhLoadRequests()
    .then(function(records){
      _fhCacheSet('fh_requests_v1', records || []);
      _process(records || []);
    })
    .catch(function(err){ if (!_cached) info.innerHTML = '<span style="color:var(--red)">เชื่อมต่อไม่ได้: '+err.message+'</span>'; });
}

function loadMyRequests() {
  loadRequests(currentBranchName, 'myRequestsInfo', 'myRequestsBody', false);
}
function loadAdminRequests() {
  return loadRequests('', 'adminReqInfo', 'adminReqBody', true);
}
/* Re-render admin requests with current matchData (no re-fetch).
   Called after PDF match / Cloud load so ใบรับรอง column reflects fresh cert data. */
function _refreshAdminReqCerts() {
  if (!_adminRowCache || !_adminRowCache.length) return;
  _adminCertIdx = buildCertIndex();
  _applyAdminReqFilters();
}

/* ─── Edit request (admin only) ─── */
var _editingKey = null;
var _editingOrig = null;   // ค่าเดิมของเรคคอร์ดที่กำลังแก้ (course/timeSlot/trainDate/round)
var _addMode = false;
var _adminRowCache = []; // last loaded admin requests for lookup

// เติมค่าในฟอร์ม + dropdown หลักสูตร/รอบ (ใช้ร่วมทั้งแก้ไขและเพิ่ม)
function _fillRequestForm(rec) {
  rec = rec || {};
  // โหลดทะเบียนพนักงานไว้ล่วงหน้า (ถ้ายังไม่มี) เพื่อให้ช่องชื่อค้นได้
  try { if ((!empData || !empData.length) && typeof loadEmployeeRegistryFromCloud === 'function') loadEmployeeRegistryFromCloud(); } catch(e) {}
  var _cb = document.getElementById('edtNameCombo'); if (_cb) _cb.style.display = 'none';
  document.getElementById('edt-name').value = rec.name || '';
  document.getElementById('edt-empId').value = rec.empId || '';
  document.getElementById('edt-idCard').value = rec.idCard || '';
  document.getElementById('edt-position').value = rec.position || '';
  document.getElementById('edt-branch').value = rec.branch || '';
  document.getElementById('edt-note').value = rec.note || '';
  var courseSel = document.getElementById('edt-course');
  courseSel.innerHTML = '<option value="">-- เลือก --</option>' + COURSE_OPTIONS.map(function(c){
    return '<option value="'+escapeAttr(c)+'"'+(c === rec.course ? ' selected':'')+'>'+escapeHtml(c)+'</option>';
  }).join('');
  // จำค่าเดิมของเรคคอร์ดไว้ — ไม่แตะหลักสูตร/รอบ = วันอบรม+รุ่นเดิมต้องอยู่เหมือนเดิม
  _editingOrig = { course: rec.course || '', timeSlot: rec.timeSlot || '', trainDate: rec.trainDate || '', round: rec.round || '' };
  function updateSlots() {
    var sel = courseSel.value;
    var sch = COURSE_SCHEDULES[sel];
    var slotSel = document.getElementById('edt-timeSlot');
    var keepOld = sel === _editingOrig.course && _editingOrig.trainDate;
    document.getElementById('edt-trainDate').value = keepOld ? _editingOrig.trainDate : ((sch && sch.date) || rec.trainDate || '');
    if (sch) {
      // รอบเดิมของเรคคอร์ดอาจไม่มีในตารางปัจจุบันแล้ว → ใส่กลับเข้าลิสต์ ไม่งั้นค่าหาย
      var opts = sch.slots.slice();
      if (rec.timeSlot && opts.indexOf(rec.timeSlot) < 0 && sel === _editingOrig.course) opts.push(rec.timeSlot);
      slotSel.innerHTML = '<option value="">-- เลือก --</option>' + opts.map(function(t){
        return '<option value="'+t+'"'+(t === rec.timeSlot ? ' selected':'')+'>'+t+' น.</option>';
      }).join('');
    } else {
      slotSel.innerHTML = '<option value="">เลือกหลักสูตรก่อน</option>';
    }
  }
  courseSel.onchange = function(){ rec.timeSlot = ''; updateSlots(); };
  updateSlots();
}

function openEditRequest(keyDataStr, rowIdx) {
  var keyData;
  try { keyData = JSON.parse(decodeURIComponent(keyDataStr)); } catch(e) { return; }
  _editingKey = keyData;
  _addMode = false;
  // Find full row from cache
  var rec = _adminRowCache.find(function(r){
    return (r._rowIndex == rowIdx) || (
      String(r.name) === String(keyData.name) &&
      String(r.idCard) === String(keyData.idCard)
    );
  }) || {};
  var merged = Object.assign({}, rec, {
    name: rec.name || keyData.name || '',
    idCard: rec.idCard || keyData.idCard || ''
  });
  var t = document.getElementById('editModalTitle'); if (t) t.textContent = '✏️ แก้ไขรายการ';
  _fillRequestForm(merged);
  document.getElementById('editRequestModal').classList.add('show');
}

// เพิ่มผู้เข้าอบรมด้วยตนเอง (ฟอร์มว่าง)
function openAddRequest() {
  _editingKey = null;
  _addMode = true;
  var t = document.getElementById('editModalTitle'); if (t) t.textContent = '➕ เพิ่มผู้เข้าอบรม';
  _fillRequestForm({});
  document.getElementById('editRequestModal').classList.add('show');
}

function closeEditRequest() {
  document.getElementById('editRequestModal').classList.remove('show');
  var _cb = document.getElementById('edtNameCombo'); if (_cb) _cb.style.display = 'none';
  _editingKey = null;
  _editingOrig = null;
  _addMode = false;
}

// Autocomplete ช่องชื่อในฟอร์มเพิ่ม/แก้ไข — ดึงจากทะเบียนพนักงาน (getEmpNamesList)
function _reqEmpCombo(query) {
  var listEl = document.getElementById('edtNameCombo');
  if (!listEl) return;
  var emps = (typeof getEmpNamesList === 'function') ? getEmpNamesList() : [];
  if (!emps.length) {
    listEl.innerHTML = '<div class="combo-empty">กำลังโหลดทะเบียนพนักงาน...</div>';
    listEl.style.display = 'block';
    return;
  }
  var q = (query || '').trim().toLowerCase();
  var filtered = q ? emps.filter(function(e){
    return e.name.toLowerCase().indexOf(q) >= 0
      || String(e.empId||'').toLowerCase().indexOf(q) >= 0
      || String(e.position||'').toLowerCase().indexOf(q) >= 0;
  }) : emps;
  if (!filtered.length) {
    listEl.innerHTML = '<div class="combo-empty">ไม่พบในทะเบียน — พิมพ์เพื่อกรอกเอง</div>';
    listEl.style.display = 'block';
    return;
  }
  listEl.innerHTML = filtered.slice(0, 50).map(function(e){
    var meta = [e.empId, e.position, e.branch].filter(Boolean).map(escapeHtml).join(' · ');
    return '<div class="combo-item" onmousedown="_reqEmpPick(\''
      + escapeAttr(e.name)+'\',\''+escapeAttr(e.empId||'')+'\',\''+escapeAttr(e.idCard||'')+'\',\''+escapeAttr(e.position||'')+'\',\''+escapeAttr(e.branch||'')+'\')">'
      + '<div class="ci-name">'+escapeHtml(e.name)+'</div>'
      + (meta ? '<div class="ci-meta">'+meta+'</div>' : '')
      + '</div>';
  }).join('') + (filtered.length > 50 ? '<div class="combo-empty">แสดง 50 จาก '+filtered.length+' (พิมพ์เพื่อแคบลง)</div>' : '');
  listEl.style.display = 'block';
}
function _reqEmpPick(name, empId, idCard, position, branch) {
  var g = function(id){ return document.getElementById(id); };
  if (g('edt-name')) g('edt-name').value = name || '';
  if (g('edt-empId')) g('edt-empId').value = empId || '';
  if (g('edt-idCard')) g('edt-idCard').value = String(idCard || '').replace(/\D/g, '');
  if (g('edt-position')) g('edt-position').value = position || '';
  if (branch && g('edt-branch')) g('edt-branch').value = branch;
  var listEl = document.getElementById('edtNameCombo'); if (listEl) listEl.style.display = 'none';
}
function saveEditRequest() {
  if (!_addMode && !_editingKey) return;
  var record = {
    name: document.getElementById('edt-name').value.trim(),
    empId: document.getElementById('edt-empId').value.trim(),
    // Strip non-digits from idCard
    idCard: document.getElementById('edt-idCard').value.replace(/\D/g, ''),
    position: document.getElementById('edt-position').value.trim(),
    branch: document.getElementById('edt-branch').value.trim(),
    course: document.getElementById('edt-course').value,
    timeSlot: document.getElementById('edt-timeSlot').value,
    note: document.getElementById('edt-note').value.trim()
  };
  // หลักสูตร+รอบไม่เปลี่ยน → คงวันอบรม/รุ่นเดิมของเรคคอร์ดไว้ · เปลี่ยนแล้วค่อยดึงจากตารางปัจจุบัน
  var o = _editingOrig || {};
  var sameSession = !_addMode && record.course === o.course && record.timeSlot === o.timeSlot;
  record.trainDate = sameSession ? (o.trainDate || _dateNowFor_(record.course)) : _dateNowFor_(record.course);
  record.round = sameSession ? (o.round || _roundNowFor_(record.course, record.timeSlot)) : _roundNowFor_(record.course, record.timeSlot);
  // โหมดเพิ่ม: เก็บแบรนด์ (เดาจากชื่อสาขา) เพื่อให้ตัวกรองประเภทใน PDF ใช้ได้
  if (_addMode) { try { record.brand = _normBrandType(record.branch) || ''; } catch(e) {} }

  // บังคับกรอกทุกช่อง ยกเว้น 'หมายเหตุ'
  var missing = [];
  if (!record.name)     missing.push('ชื่อ-นามสกุล');
  if (!record.empId)    missing.push('รหัสพนักงาน');
  if (!record.idCard)   missing.push('เลขบัตรประชาชน');
  else if (record.idCard.length !== 13) missing.push('เลขบัตรประชาชน (ต้อง 13 หลัก)');
  if (!record.position) missing.push('ตำแหน่ง');
  if (!record.branch)   missing.push('สาขา');
  if (!record.course)   missing.push('หลักสูตร');
  if (!record.timeSlot) missing.push('รอบอบรม');
  if (missing.length) {
    customConfirm({
      icon:ICON_WARN, title:'ข้อมูลไม่ครบ',
      desc:'กรุณากรอก:<br>• ' + missing.join('<br>• '),
      okText:'ปิด', okIsPrimary:true, hideCancel:true
    });
    return;
  }
  showLoadingOverlay(_addMode ? 'กำลังเพิ่มรายชื่อ...' : 'กำลังบันทึก...', '');
  /* ผ่านชั้นข้อมูล (Supabase ตัวจริง + สำเนา Sheets) เหมือนปุ่มลบ
     เดิมยิง Apps Script ตรง ๆ ทำให้แก้ไขไม่ติดและเพิ่มรายชื่อแล้วไม่โผล่ในตาราง
     เพราะตารางอ่านจาก Supabase แต่เขียนลง Sheets */
  var _p = _addMode ? fhSaveRequests([record]) : fhUpdateRequest(_editingKey, record);
  _p
    .then(function(res){
      hideLoadingOverlay();
      if (res.ok) {
        closeEditRequest();
        _fhBustRequests();
        loadAdminRequests();
      } else {
        customConfirm({ icon:ICON_WARN, title:'บันทึกไม่สำเร็จ', desc:escapeHtml(res.error || 'unknown')+'<br><br>อาจเป็นเพราะ Apps Script ยังไม่ได้ deploy เวอร์ชั่นใหม่', okText:'ปิด', okIsPrimary:true, hideCancel:true });
      }
    })
    .catch(function(err){
      hideLoadingOverlay();
      customConfirm({ icon:'🌐', title:'เชื่อมต่อ Cloud ไม่ได้', desc:escapeHtml(err.message||String(err)), okText:'ปิด', okIsPrimary:true, hideCancel:true });
    });
}

/* Delete a single request (admin only) — row hides immediately on success */
function deleteRequest(keyDataStr) {
  var keyData;
  try { keyData = JSON.parse(decodeURIComponent(keyDataStr)); } catch(e) { return; }
  var btn = event && event.target;
  var tr = btn && btn.closest ? btn.closest('tr') : null;
  customConfirm({
    icon: ICON_TRASH,
    title: 'ลบรายการนี้?',
    desc: 'จะลบข้อมูลของ <strong>'+escapeHtml(keyData.name||'')+'</strong> ออกจากระบบถาวร — ไม่สามารถกู้คืนได้',
    okText: 'ลบเลย'
  }).then(function(ok){
    if (!ok) return;
    doDeleteRequest(keyData, btn, tr);
  });
}
function doDeleteRequest(keyData, btn, tr) {
  if (btn) btn.disabled = true;
  /* ต้องลบที่ Supabase ก่อน เพราะเป็นตัวจริงที่หน้าจอนี้อ่านมาแสดง
     เดิมยิงไป Apps Script อย่างเดียว → Sheets หาแถวไม่เจอ ขึ้น "not found"
     (rowIndex ที่ส่งไปคือ id ของ Supabase ไม่ใช่เลขแถวใน Sheets)
     และต่อให้ Sheets ลบผ่าน ข้อมูลบน Supabase ก็ยังอยู่ → รีเฟรชแล้วแถวกลับมา */
  fhDeleteRequest(keyData)
    .then(function(res){
      if (res.ok) {
        if (tr) {
          tr.style.transition = 'opacity 0.25s, transform 0.25s';
          tr.style.opacity = '0';
          tr.style.transform = 'translateX(-20px)';
          setTimeout(function(){ if (tr.parentNode) tr.parentNode.removeChild(tr); }, 250);
        }
        _fhBustRequests();
        setTimeout(loadAdminRequests, 600);
      } else {
        if (btn) btn.disabled = false;
        customConfirm({
          icon: ICON_WARN,
          title: 'ลบไม่สำเร็จ',
          desc: '<strong>'+escapeHtml(res.error || 'unknown')+'</strong><br><br>อาจเป็นเพราะ Apps Script ยังไม่ได้ deploy เวอร์ชั่นใหม่ — ลองอัปเดต Code.gs แล้ว Deploy → New version',
          okText: 'รับทราบ',
          okIsPrimary: true,
          hideCancel: true
        });
      }
    })
    .catch(function(err){
      if (btn) btn.disabled = false;
      customConfirm({
        icon: '🌐',
        title: 'เชื่อมต่อ Cloud ไม่ได้',
        desc: escapeHtml(err.message || String(err)),
        okText: 'ปิด',
        okIsPrimary: true,
        hideCancel: true
      });
    });
}

/* ═══ Admin: กำหนด "รุ่นที่" ทีละกลุ่ม (เติมย้อนหลังให้รายชื่อเก่าที่ยังไม่มีรุ่น) ═══
   จัดกลุ่มตาม หลักสูตร + วันอบรม + รอบเวลา — 1 กลุ่ม = 1 ใบทะเบียน = 1 รุ่น */
var _reqRoundGroups = [];

function _reqRoundGroupsFrom(rows) {
  var map = {}, out = [];
  (rows || []).forEach(function(r){
    var g = _reqGroupOf_(r), p = g.p;
    var key = g.key;
    if (!map[key]) {
      map[key] = { key: key, course: g.course, trainDate: p.trainDate, slot: g.slot, round: '', rows: [] };
      out.push(map[key]);
    }
    // รุ่นของกลุ่ม = ค่าที่บันทึกไว้จริงตัวแรกที่เจอ (ไม่เอาค่าที่เดาจากตาราง)
    var saved = _fhRoundText_(r.round || r['รุ่น'] || r['รุ่นที่'] || '');
    if (saved && !map[key].round) map[key].round = saved;
    map[key].rows.push(r);
  });
  // เรียง: วันอบรมใหม่ก่อน แล้วตามรอบเวลา
  out.sort(function(a, b){
    var da = parseAnyDate(a.trainDate), db = parseAnyDate(b.trainDate);
    if (da && db && da.getTime() !== db.getTime()) return db - da;
    if (a.course !== b.course) return a.course < b.course ? -1 : 1;
    return a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0;
  });
  return out;
}

function openAdminReqRoundTool() {
  var rows = Array.isArray(_adminRowCache) ? _adminRowCache : [];
  if (!rows.length) { showInfo('ไม่มีข้อมูล', 'ยังไม่มีคำขออบรมในระบบ — กดรีเฟรชก่อน'); return; }
  _reqRoundGroups = _reqRoundGroupsFrom(rows);
  var box = document.getElementById('adminReqRoundBody');
  box.innerHTML = _reqRoundGroups.map(function(g, i){
    var sch = _findCourseSchedule_(g.course);
    var suggest = _findRoundForSlot_(sch, g.slot) || '';   // รุ่นจากตารางปัจจุบัน — ไว้กดใส่เร็ว ๆ
    var hint = (!g.round && suggest && String(sch && sch.date || '').trim() === String(g.trainDate).trim())
      ? ' <span style="color:#6d28d9;">· ตารางปัจจุบันคือรุ่น ' + escapeHtml(suggest) + '</span>' : '';
    return '<div class="rgrp">'
      + '<div class="rgrp-main">'
      +   '<div class="rgrp-course">📚 ' + escapeHtml(g.course) + '</div>'
      +   '<div class="rgrp-meta">'
      +     '<span>📅 <b>' + escapeHtml(formatThaiDate(g.trainDate) || '— ไม่ระบุวัน') + '</b></span>'
      +     '<span>🕐 <b>' + escapeHtml(g.slot || '— ไม่ระบุรอบ') + '</b></span>'
      +     '<span>' + (g.round ? 'รุ่นปัจจุบัน: <b>' + escapeHtml(g.round) + '</b>' : '<b style="color:#b45309;">ยังไม่มีรุ่น</b>' + hint) + '</span>'
      +   '</div>'
      + '</div>'
      + '<div class="rgrp-n">' + g.rows.length + ' คน</div>'
      + '<input class="rgrp-in" data-rgrp="' + i + '" value="' + escapeAttr(g.round) + '" placeholder="' + (suggest ? escapeAttr(suggest) : 'เช่น 2/2569') + '" oninput="_onRoundInput(this)">'
      + '</div>';
  }).join('');
  document.getElementById('adminReqRoundModal').classList.add('show');
}
function _onRoundInput(inp) {
  var g = _reqRoundGroups[parseInt(inp.getAttribute('data-rgrp'), 10)];
  inp.classList.toggle('changed', !!g && inp.value.trim() !== String(g.round || '').trim());
}
function closeAdminReqRoundTool() {
  document.getElementById('adminReqRoundModal').classList.remove('show');
}

function saveAdminReqRounds() {
  var changed = [];
  document.querySelectorAll('#adminReqRoundBody .rgrp-in').forEach(function(inp){
    var g = _reqRoundGroups[parseInt(inp.getAttribute('data-rgrp'), 10)];
    if (!g) return;
    var v = inp.value.trim();
    if (v !== String(g.round || '').trim()) changed.push({ g: g, round: v });
  });
  if (!changed.length) { showInfo('ไม่มีอะไรเปลี่ยน', 'ยังไม่ได้แก้รุ่นของกลุ่มไหนเลย'); return; }
  var totalRows = changed.reduce(function(n, c){ return n + c.g.rows.length; }, 0);
  customConfirm({
    icon: ICON_WARN,
    title: 'บันทึกรุ่นที่?',
    desc: 'จะเขียนรุ่นใหม่ลง <strong>' + changed.length + '</strong> กลุ่ม รวม <strong>' + totalRows + '</strong> รายชื่อ',
    okText: 'บันทึก', okIsPrimary: true
  }).then(function(ok){
    if (!ok) return;
    closeAdminReqRoundTool();
    // ส่ง record เต็มทุก field — backend รุ่นเก่าที่ยังไม่มีคอลัมน์ round จะได้ไม่ล้างข้อมูลอื่นทิ้ง
    var jobs = [];
    changed.forEach(function(c){
      // เขียนรอบเวลาแบบ normalize กลับไปด้วย — ล้างของที่พิมพ์เว้นวรรคไม่เท่ากันให้ตรงกันทั้งกลุ่ม
      c.g.rows.forEach(function(rec){ jobs.push({ rec: rec, round: c.round, slot: c.g.slot }); });
    });
    // ส่ง record เต็มทุก field — backend รุ่นเก่าที่ยังไม่มีคอลัมน์ round จะได้ไม่ล้างข้อมูลอื่นทิ้ง
    var payload = jobs.map(function(j){
      var rec = j.rec;
      return { rec: rec, record: {
        name: rec.name || '', empId: rec.empId || '', idCard: rec.idCard || '',
        branch: rec.branch || '', position: rec.position || '', course: rec.course || '',
        trainDate: rec.trainDate || '', timeSlot: j.slot || rec.timeSlot || '', note: rec.note || '',
        round: j.round
      } };
    });
    var done = 0, failed = 0;
    showLoadingOverlay('กำลังบันทึกรุ่นที่...', '0/' + payload.length);
    fhBulkUpdateRequests(payload, function(n, total){
      showLoadingOverlay('กำลังบันทึกรุ่นที่...', n + '/' + total);
    }).then(function(r){
      done = r.done; failed = r.failed;
      hideLoadingOverlay();
      _fhBustRequests();
      return loadAdminRequests();
    }).then(function(){
      // เช็คว่า backend เก็บ round ให้จริงไหม — ยังไม่ได้ deploy Apps Script ใหม่ = ค่าจะหายเงียบ ๆ
      var saved = (Array.isArray(_adminRowCache) ? _adminRowCache : []).some(function(r){
        return String(r.round || '').trim();
      });
      if (!saved && done) {
        showInfo('⚠️ บันทึกแล้วแต่รุ่นไม่ติด',
          'ส่งขึ้น Cloud สำเร็จ <b>' + done + '</b> รายการ แต่ยังอ่านรุ่นกลับมาไม่ได้<br><br>'
          + 'แปลว่า <b>Apps Script ยังไม่ได้ deploy เวอร์ชันใหม่</b> (ชีต Requests ยังไม่มีคอลัมน์ round)<br>'
          + 'ก๊อป <b>apps-script/Code.gs</b> ทับ → Save → Deploy → New version แล้วกำหนดรุ่นอีกครั้งครับ');
        return;
      }
      showInfo('สรุปผลการบันทึก', '✓ บันทึกสำเร็จ <b>' + done + '</b> รายการ' + (failed ? ' · ✗ ล้มเหลว ' + failed + ' รายการ' : ''));
    });
  });
}

/* ═══ งานหมู่: ยิงก้อนเดียว ไม่วนทีละแถว ═══
   เดิม 195 คน = 195 HTTP request ต่อคิวกัน แต่ละอัน Apps Script อ่านชีตทั้งใบ + จับ lock ≈ หลายนาที
   ตอนนี้ส่งทั้งก้อนไปครั้งเดียว · backend ที่ยังไม่ได้ deploy จะตอบ unknown type → ถอยไปใช้วิธีเดิมอัตโนมัติ */
/* Apps Script บางครั้งตอบหน้า HTML แทน JSON (ขัดข้องชั่วคราวฝั่ง Google)
   r.json() จะพังเป็น "Unexpected token '<'" → อ่านเป็นข้อความก่อน ไม่ใช่ JSON ก็รอแล้วลองใหม่ */
function _fhPost(payload, tries) {
  tries = (tries == null) ? 3 : tries;
  return fetch(SCRIPT_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.text(); })
  .then(function(t){
    var s = String(t == null ? '' : t).trim();
    if (s.charAt(0) === '{' || s.charAt(0) === '[') {
      try { return JSON.parse(s); } catch (e) {}
    }
    if (tries > 1) {
      return new Promise(function(ok){ setTimeout(ok, 1500); })
        .then(function(){ return _fhPost(payload, tries - 1); });
    }
    throw new Error('เซิร์ฟเวอร์ตอบกลับมาไม่ใช่ข้อมูล (Apps Script ขัดข้องชั่วคราว) — ลองอีกครั้งใน 1-2 นาที');
  });
}
function _fhReqKey(rec) {
  return { rowIndex: rec._rowIndex, name: rec.name, idCard: rec.idCard, timestamp: rec.timestamp };
}
function _fhIsUnknownType(res) {
  return !!(res && !res.ok && String(res.error || '').indexOf('unknown type') >= 0);
}
/* ยิงทีละอัน (ของเดิม) — ใช้เป็นทางถอยเมื่อ backend ยังไม่รองรับ bulk
   onProgress(done, total) ถูกเรียกทุกครั้งที่จบ 1 รายการ */
function _fhSeqPost(items, buildPayload, onProgress) {
  var done = 0, failed = 0, total = items.length;
  var seq = Promise.resolve();
  items.forEach(function(it){
    seq = seq.then(function(){
      return _fhPost(buildPayload(it))
        .then(function(res){ if (res && res.ok) done++; else failed++; })
        .catch(function(){ failed++; })
        .then(function(){ if (onProgress) onProgress(done + failed, total); });
    });
  });
  return seq.then(function(){ return { done: done, failed: failed }; });
}
/* ลบหลายรายการ → คืน {done, failed} */
function _fhBulkDelete(records, onProgress) {
  if (!records.length) return Promise.resolve({ done: 0, failed: 0 });
  if (onProgress) onProgress(0, records.length);
  return _fhPost({ type: 'bulk-delete-requests', keys: records.map(_fhReqKey) })
    .then(function(res){
      if (_fhIsUnknownType(res)) {
        return _fhSeqPost(records, function(rec){ return { type: 'delete-request', key: _fhReqKey(rec) }; }, onProgress);
      }
      if (!res || !res.ok) throw new Error((res && res.error) || 'bulk delete failed');
      if (onProgress) onProgress(records.length, records.length);
      return { done: res.deleted || 0, failed: res.notFound || 0 };
    })
    .catch(function(){
      // เน็ตหลุด/ตอบไม่เป็น JSON → ถอยไปวิธีเดิม ดีกว่าล้มทั้งงาน
      return _fhSeqPost(records, function(rec){ return { type: 'delete-request', key: _fhReqKey(rec) }; }, onProgress);
    });
}
/* แก้หลายรายการ · jobs = [{rec, record}] → คืน {done, failed} */
function _fhBulkUpdate(jobs, onProgress) {
  if (!jobs.length) return Promise.resolve({ done: 0, failed: 0 });
  if (onProgress) onProgress(0, jobs.length);
  var seqFallback = function(){
    return _fhSeqPost(jobs, function(j){
      return { type: 'update-request', key: _fhReqKey(j.rec), record: j.record };
    }, onProgress);
  };
  return _fhPost({
    type: 'bulk-update-requests',
    updates: jobs.map(function(j){ return { key: _fhReqKey(j.rec), record: j.record }; })
  })
    .then(function(res){
      if (_fhIsUnknownType(res)) return seqFallback();
      if (!res || !res.ok) throw new Error((res && res.error) || 'bulk update failed');
      if (onProgress) onProgress(jobs.length, jobs.length);
      return { done: res.updated || 0, failed: res.notFound || 0 };
    })
    .catch(seqFallback);
}

/* Admin: ลบคำขออบรมทั้งหมด (ส่งก้อนเดียว) */
function clearAllRequests() {
  var records = (Array.isArray(_adminRowCache) ? _adminRowCache.slice() : [])
    .sort(function(a,b){ return (b._rowIndex||0) - (a._rowIndex||0); });
  if (!records.length) { showInfo('ไม่มีข้อมูล', 'ยังไม่มีคำขออบรมให้ลบ'); return; }
  customConfirm({
    icon: ICON_TRASH,
    title: 'ลบคำขออบรมทั้งหมด?',
    desc: 'จะลบทั้งหมด <strong>'+records.length+'</strong> รายการออกจาก Cloud ถาวร — ไม่สามารถกู้คืนได้',
    okText: 'ลบทั้งหมด', okIsPrimary: true
  }).then(function(ok){
    if (!ok) return;
    showLoadingOverlay('กำลังลบคำขออบรม...', '0/' + records.length);
    fhBulkDeleteRequests(records, function(n, total){
      showLoadingOverlay('กำลังลบคำขออบรม...', n + '/' + total);
    }).then(function(r){
      hideLoadingOverlay();
      _fhBustRequests();
      loadAdminRequests();
      showInfo('สรุปผลการลบ', '✓ ลบสำเร็จ <b>'+r.done+'</b> รายการ' + (r.failed ? ' · ✗ ล้มเหลว '+r.failed+' รายการ' : ''));
    });
  });
}

/* Admin: ลบใบรับรองทั้งหมด (save-certificates แบบ replace-all ด้วย records ว่าง) */
function clearAllCerts() {
  var n = (typeof matchData !== 'undefined' && matchData) ? matchData.length : 0;
  if (!n) { showInfo('ไม่มีข้อมูล', 'ยังไม่มีใบรับรองให้ลบ'); return; }
  customConfirm({
    icon: ICON_TRASH,
    title: 'ลบใบรับรองทั้งหมด?',
    desc: 'จะลบทั้งหมด <strong>'+n+'</strong> รายการออกจาก Cloud ถาวร — ไม่สามารถกู้คืนได้',
    okText: 'ลบทั้งหมด', okIsPrimary: true
  }).then(function(ok){
    if (!ok) return;
    showLoadingOverlay('กำลังลบใบรับรองทั้งหมด...', '');
    fetch(SCRIPT_URL, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'clear-certificates' })
    })
    .then(function(r){ return r.json(); })
    .then(function(res){
      hideLoadingOverlay();
      if (res && res.ok) {
        matchData = [];
        _fhCacheSet('fh_cert_v1', []);   // ล้าง cache ในเครื่องด้วย ไม่งั้นรีเฟรชแล้วข้อมูลเก่ากลับมา
        try { updateStats(); } catch(e) {}
        try { renderTable(); } catch(e) {}
        showInfo('ลบสำเร็จ', 'ลบใบรับรองทั้งหมดออกจาก Cloud แล้ว');
      } else {
        showInfo('ลบไม่สำเร็จ', escapeHtml((res && res.error) || 'unknown'));
      }
    })
    .catch(function(err){ hideLoadingOverlay(); showInfo('🌐 เชื่อมต่อ Cloud ไม่ได้', escapeHtml(err.message || String(err))); });
  });
}

/* Admin: force clear server-side cache */
function clearServerCache() {
  customConfirm({
    icon: ICON_TRASH,
    title: 'ล้าง Cache?',
    desc: 'จะ clear cache ของ Apps Script — ดึงข้อมูลใหม่จาก Sheet ทันที',
    okText: 'ล้างเลย',
    okIsPrimary: true
  }).then(function(ok){
    if (!ok) return;
    showLoadingOverlay('กำลังล้าง cache...', '');
    fetch(SCRIPT_URL, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'clear-cache' })
    })
      .then(function(r){ return r.json(); })
      .then(function(){
        hideLoadingOverlay();
        loadAdminRequests();
        loadFromCloud();
      })
      .catch(function(err){ hideLoadingOverlay(); alert('ล้างไม่สำเร็จ: ' + err.message); });
  });
}

/* ─── Realtime auto-refresh
   Admin: 5s (sees all branches real-time)
   Saha:  30s (only own data — saves Apps Script quota for 25 branches)
   Tab hidden → pause | Tab focus → fetch immediately
   ─── */
var requestsPollTimer = null;
function startRequestsPolling() {
  stopRequestsPolling();
  var adminView = document.getElementById('adminView');
  var branchView = document.getElementById('branchView');
  var isAdminPolling = adminView && adminView.style.display !== 'none';
  var interval = isAdminPolling ? 5000 : 30000;
  // Stagger start (0-3s random offset) to avoid 25 branches hitting at the same second
  var stagger = Math.floor(Math.random() * 3000);
  setTimeout(function(){
    requestsPollTimer = setInterval(function(){
      if (document.hidden) return;
      var av = document.getElementById('adminView');
      var bv = document.getElementById('branchView');
      if (av && av.style.display !== 'none') loadAdminRequests();
      else if (bv && bv.style.display !== 'none') loadMyRequests();
    }, interval);
  }, stagger);
}
function stopRequestsPolling() {
  if (requestsPollTimer) { clearInterval(requestsPollTimer); requestsPollTimer = null; }
}
// Pause when tab loses focus, resume when back
document.addEventListener('visibilitychange', function(){
  if (!document.hidden) {
    // Tab back in focus — fetch immediately
    var adminView = document.getElementById('adminView');
    var branchView = document.getElementById('branchView');
    if (adminView && adminView.style.display !== 'none') loadAdminRequests();
    else if (branchView && branchView.style.display !== 'none') loadMyRequests();
  }
});
