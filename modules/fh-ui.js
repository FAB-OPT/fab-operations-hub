/* fh-ui.js — combobox · dropdown · confirm · overlay · bottom sheet
   แยกมาจาก food-handler.js (บรรทัดเดิม 6418-6990)
   ⚠️ ไฟล์ชุดนี้ต้องโหลดตามลำดับใน food-handler.html — อย่าสลับ */
/* ─── Custom combobox for name ───
   Source priority: Employees registry (empData) > Certificates (allRecords)
   ใช้ Employees เป็นหลัก เพราะเป็น master list ที่ clean กว่า + ครอบคลุมพนักงานทุกคน
   Branch filter: สาขา view เห็นเฉพาะพนักงานสาขาตัวเอง · admin เห็นทุกคน */
function matchesCurrentBranch_(empBranch) {
  if (isAdminMode) return true;  // admin เห็นหมด
  if (!empBranch) return false;
  var s = String(empBranch).toLowerCase();
  var pin = String(branchPin || '');
  var branchShortName = (BRANCHES[branchPin] || '').toLowerCase();
  if (pin && s.indexOf(pin) >= 0) return true;
  if (branchShortName && s.indexOf(branchShortName) >= 0) return true;
  return false;
}
// Aggressive dedup key — strip whitespace, zero-width, NBSP, BOM, hyphen (use \u escapes to avoid invisible-char regex issues)
function _empKey_(n) {
  return String(n||'')
    .replace(/[\u0009-\u000D\u0020\u00A0\u200B-\u200F\u2028\u2029\uFEFF\u002D]/g, '')
    .toLowerCase();
}
function getEmpNamesList() {
  var seen = {};
  var arr = [];
  // 1) จาก Employees registry (preferred) — filter ตามสาขาตัวเอง
  (empData || []).forEach(function(e){
    if (!matchesCurrentBranch_(e.branch)) return;
    var n = (e.name || e.norm || '').trim();
    var key = _empKey_(n);
    if (n && key && !seen[key]) {
      seen[key] = true;
      arr.push({ name: n, position: e.position||'', branch: e.branch||'', empId: e.empId||'', idCard: e.idCard||'' });
    }
  });
  // 2) Fallback: จาก Certificates (เผื่อมีคนที่อยู่ใน cert แต่ไม่อยู่ใน Employees) — filter เหมือนกัน
  (allRecords || []).forEach(function(r){
    if (!matchesCurrentBranch_(r['สาขา'])) return;
    var n = (r['ชื่อในระบบ'] || r['ชื่อในใบรับรอง'] || '').trim();
    var key = _empKey_(n);
    if (n && key && !seen[key]) {
      seen[key] = true;
      arr.push({ name: n, position: r['ตำแหน่ง']||'', branch: r['สาขา']||'', empId: r['รหัสพนักงาน']||'', idCard: r['เลขบัตรประชาชน']||'' });
    }
  });
  return arr;
}
function renderComboList(i, query) {
  var listEl = document.getElementById('comboList-'+i);
  if (!listEl) return;
  var emps = getEmpNamesList();
  var q = (query || '').trim().toLowerCase();
  var filtered = q ? emps.filter(function(e){ return e.name.toLowerCase().indexOf(q) >= 0 || (e.position||'').toLowerCase().indexOf(q) >= 0; }) : emps;
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="combo-empty">ไม่พบในระบบ — พิมพ์ต่อเพื่อเพิ่มชื่อใหม่</div>';
    return;
  }
  listEl.innerHTML = filtered.slice(0, 50).map(function(e){
    return '<div class="combo-item" onmousedown="selectComboItem('+i+',\''+escapeAttr(e.name)+'\',\''+escapeAttr(e.position||'')+'\',\''+escapeAttr(e.empId||'')+'\',\''+escapeAttr(e.idCard||'')+'\')">'
      + '<div class="ci-name">'+escapeHtml(e.name)+'</div>'
      + (e.position ? '<div class="ci-meta">'+escapeHtml(e.position)+(e.branch?' · '+escapeHtml(e.branch):'')+'</div>' : '')
      + '</div>';
  }).join('') + (filtered.length > 50 ? '<div class="combo-empty">แสดง 50 จาก '+filtered.length+' (พิมพ์เพื่อแคบลง)</div>' : '');
}
function openCombo(i) {
  // close others
  document.querySelectorAll('.combo-list').forEach(function(el){ if (el.id !== 'comboList-'+i) el.style.display = 'none'; });
  var listEl = document.getElementById('comboList-'+i);
  if (!listEl) return;
  renderComboList(i, (requestRows[i]||{}).name || '');
  listEl.style.display = 'block';
}
function closeCombo(i) {
  var listEl = document.getElementById('comboList-'+i);
  if (listEl) listEl.style.display = 'none';
}
function toggleCombo(i, btnEl) {
  var listEl = document.getElementById('comboList-'+i);
  if (!listEl) return;
  if (listEl.style.display === 'block') closeCombo(i);
  else {
    openCombo(i);
    var input = btnEl.parentElement.querySelector('.combo-input');
    if (input) input.focus();
  }
}
function onComboInput(ev, i) {
  var val = ev.target.value;
  updateReqRow(i, 'name', val);
  renderComboList(i, val);
  var listEl = document.getElementById('comboList-'+i);
  if (listEl) listEl.style.display = 'block';
  onReqNameChange(i);
}
function onComboKey(ev, i) {
  if (ev.key === 'Escape') { closeCombo(i); }
  else if (ev.key === 'Enter') { closeCombo(i); ev.preventDefault(); }
}
function selectComboItem(i, name, position, empId, idCard) {
  if (!requestRows[i]) return;
  requestRows[i].name = name;
  if (position && !requestRows[i].position) requestRows[i].position = position;
  if (empId   && !requestRows[i].empId)    requestRows[i].empId    = empId;
  // Strip ทุกอักขระที่ไม่ใช่ตัวเลข (-, space, etc.) ก่อนเก็บ
  if (idCard  && !requestRows[i].idCard)   requestRows[i].idCard   = String(idCard).replace(/\D/g, '').slice(0, 13);
  closeCombo(i);
  rerenderRequestList();
  onReqNameChange(i);
  if (typeof updateStepper === 'function') updateStepper();
}
// Close combo when clicking outside
document.addEventListener('mousedown', function(ev){
  if (ev.target.closest && (ev.target.closest('.combo-wrap'))) return;
  document.querySelectorAll('.combo-list').forEach(function(el){ el.style.display = 'none'; });
});

/* ─── Dropdown handlers ─── */
function toggleDd(ddId, ev) {
  if (ev) ev.stopPropagation();
  // Close other dropdowns
  document.querySelectorAll('.dd-wrap').forEach(function(el){
    if (el.id !== ddId) el.classList.remove('open');
  });
  var el = document.getElementById(ddId);
  if (el) el.classList.toggle('open');
}
function pickCourse(i, course) {
  if (!requestRows[i]) return;
  var sch = COURSE_SCHEDULES[course];
  requestRows[i].course = course;
  requestRows[i].trainDate = sch ? sch.date : '';
  if (sch && sch.slots.length === 1) requestRows[i].timeSlot = sch.slots[0];
  else if (sch && requestRows[i].timeSlot && sch.slots.indexOf(requestRows[i].timeSlot) < 0) requestRows[i].timeSlot = '';
  rerenderRequestList();
  if (typeof updateStepper === 'function') updateStepper();
}
function pickSlot(i, slot) {
  if (!requestRows[i]) return;
  requestRows[i].timeSlot = slot;
  rerenderRequestList();
  if (typeof updateStepper === 'function') updateStepper();
}
// Close dropdowns on outside click
document.addEventListener('mousedown', function(ev){
  if (!ev.target.closest || !ev.target.closest('.dd-wrap')) {
    document.querySelectorAll('.dd-wrap.open').forEach(function(el){ el.classList.remove('open'); });
  }
});

/* Combined picker — clicking a slot inside a card sets both course + slot at once */
function pickSchedule(i, course, slot) {
  if (!requestRows[i]) return;
  var sch = COURSE_SCHEDULES[course];
  requestRows[i].course = course;
  requestRows[i].trainDate = sch ? sch.date : '';
  requestRows[i].timeSlot = slot;
  rerenderRequestList();
  if (typeof updateStepper === 'function') updateStepper();
}

function selectCourse(i, course) {
  if (!requestRows[i]) return;
  requestRows[i].course = course;
  var sch = COURSE_SCHEDULES[course];
  requestRows[i].trainDate = sch ? sch.date : '';
  // Auto-pick slot if only one option
  if (sch && sch.slots.length === 1) requestRows[i].timeSlot = sch.slots[0];
  else if (sch && requestRows[i].timeSlot && sch.slots.indexOf(requestRows[i].timeSlot) < 0) requestRows[i].timeSlot = '';
  rerenderRequestList();
  if (typeof updateStepper === 'function') updateStepper();
}

function selectSlot(i, slot) {
  if (!requestRows[i]) return;
  requestRows[i].timeSlot = slot;
  rerenderRequestList();
  if (typeof updateStepper === 'function') updateStepper();
}

function buildEmpDatalist() {
  var seen = {};
  var html = '';
  (allRecords || []).forEach(function(r){
    var n = (r['ชื่อในระบบ'] || r['ชื่อในใบรับรอง'] || '').trim();
    if (n && !seen[n]) { seen[n] = true; html += '<option value="'+escapeAttr(n)+'">'; }
  });
  return html;
}

function updateIdCard(input, i) {
  var v = input.value.replace(/\D/g, '').slice(0, 13);
  input.value = v;
  requestRows[i].idCard = v;
  var hintEl = document.getElementById('reqIdHint-'+i);
  if (hintEl) {
    if (!v) { hintEl.className = 'req-hint neutral'; hintEl.textContent = ''; }
    else if (v.length < 13) { hintEl.className = 'req-hint warn'; hintEl.textContent = 'ยังไม่ครบ 13 หลัก'; }
    else { hintEl.className = 'req-hint ok'; hintEl.textContent = '✓ ครบ 13 หลัก'; }
  }
  if (typeof updateStepper === 'function') updateStepper();
}

function onReqNameChange(i) {
  var name = (requestRows[i].name || '').trim();
  var hintEl = document.getElementById('reqHint-'+i);
  if (!hintEl) return;
  if (!name) { hintEl.className = 'req-hint neutral'; hintEl.textContent = ''; return; }
  var found = (allRecords || []).find(function(r){
    return (r['ชื่อในระบบ'] || r['ชื่อในใบรับรอง']) === name;
  });
  if (!found) {
    hintEl.className = 'req-hint neutral';
    hintEl.innerHTML = '◯ ไม่พบในระบบ — กรอกข้อมูลด้วยตนเอง';
    return;
  }
  // Autofill position if empty
  if (!requestRows[i].position && found['ตำแหน่ง'] && found['ตำแหน่ง'] !== '—') {
    requestRows[i].position = found['ตำแหน่ง'];
    var posInput = document.querySelectorAll('.req-card')[i].querySelectorAll('input')[2];
    if (posInput) posInput.value = found['ตำแหน่ง'];
  }
  var status = found['สถานะใบรับรอง'];
  if (status === 'valid' || status === 'ยังมีผล') {
    hintEl.className = 'req-hint warn';
    hintEl.innerHTML = '⚠️ มีใบรับรองที่ยังไม่หมดอายุ (ถึง ' + formatThaiDate(found['วันหมดอายุ']) + ')';
  } else if (status === 'warning' || status === 'ใกล้หมดอายุ') {
    hintEl.className = 'req-hint warn';
    hintEl.innerHTML = '⏳ ใบรับรองใกล้หมดอายุ';
  } else if (status === 'expired' || status === 'หมดอายุ') {
    hintEl.className = 'req-hint err';
    hintEl.innerHTML = '❌ ใบรับรองหมดอายุแล้ว — ต้องอบรมใหม่';
  } else {
    hintEl.className = 'req-hint ok';
    hintEl.innerHTML = '✓ พบในระบบ';
  }
}

function updateReqRow(i, key, val) {
  if (requestRows[i]) requestRows[i][key] = val;
  if (typeof updateStepper === 'function') updateStepper();
  _fhSyncSubmitBtn();
}

/* ปุ่ม "ส่งรายชื่อทั้งหมด" จะโผล่ก็ต่อเมื่อมีรายชื่อที่กรอกชื่อแล้วอย่างน้อย 1 คน
   ฟอร์มเปิดมามีแถวเปล่า 1 แถวเสมอ ถ้านับแค่จำนวนแถวก็จะโผล่ตลอด ไม่ตรงกับที่ต้องการ
   จึงนับ "แถวที่มีชื่อ" แทน — พ่วงกันกดส่งฟอร์มเปล่าไปด้วย */
function _fhSyncSubmitBtn() {
  var btn = document.getElementById('submitReqBtn');
  if (!btn) return;
  var n = 0;
  try {
    n = (requestRows || []).filter(function(r){ return r && String(r.name || '').trim(); }).length;
  } catch (e) {}
  btn.style.display = n > 0 ? '' : 'none';
}

function removeReqRow(i) {
  requestRows.splice(i, 1);
  if (requestRows.length === 0) requestRows.push({name:'',idCard:'',branch: currentBranchName || '',position:'',course:'',trainDate:'',timeSlot:'',note:''});
  rerenderRequestList();
}

function escapeHtml(s) {
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(s) {
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

/* ─── Custom confirm dialog (Promise-based, replaces window.confirm) ─── */
var _confirmResolve = null;
/* Reusable styled icons for confirm dialogs (use via icon: option) */
var ICON_TRASH  = '<span class="confirm-icon-circle danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></span>';
var ICON_WARN   = '<span class="confirm-icon-circle warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>';
var ICON_OK     = '<span class="confirm-icon-circle success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>';
var ICON_INFO   = '<span class="confirm-icon-circle info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></span>';
function customConfirm(opts) {
  opts = opts || {};
  var ov = document.getElementById('confirmModal');
  if (!ov) return Promise.resolve(false);
  document.getElementById('confirmIcon').innerHTML = opts.icon || '⚠️';
  document.getElementById('confirmTitle').textContent = opts.title || 'ยืนยัน?';
  document.getElementById('confirmDesc').innerHTML = opts.desc || '';
  document.getElementById('confirmBtnOk').textContent = opts.okText || 'ยืนยัน';
  // Hide cancel button for info-only dialogs
  var cancelBtn = ov.querySelector('.confirm-btn-cancel');
  if (cancelBtn) cancelBtn.style.display = opts.hideCancel ? 'none' : '';
  ov.classList.toggle('success', !!opts.okIsPrimary);
  ov.classList.add('show');
  return new Promise(function(resolve){ _confirmResolve = resolve; });
}
function resolveConfirm(val) {
  var ov = document.getElementById('confirmModal');
  if (ov) ov.classList.remove('show');
  if (_confirmResolve) { _confirmResolve(val); _confirmResolve = null; }
}

/* ─── Loading overlay helpers ─── */
function showLoadingOverlay(title, desc, success) {
  var ov = document.getElementById('loadingOverlay');
  if (!ov) return;
  ov.classList.toggle('success', !!success);
  var t = document.getElementById('loadingTitle');
  var d = document.getElementById('loadingDesc');
  if (t) t.textContent = title || 'กำลังส่งข้อมูล...';
  if (d) d.textContent = desc || 'กรุณารอสักครู่';
  ov.classList.add('show');
}
function hideLoadingOverlay() {
  var ov = document.getElementById('loadingOverlay');
  if (ov) { ov.classList.remove('show'); ov.classList.remove('success'); }
}

/* Show summary modal before actual submit */
function showSubmitSummary() {
  if (typeof FH_CONFIG !== 'undefined' && FH_CONFIG.submitOpen === false) { alert('ขณะนี้ปิดรับการส่งรายชื่อชั่วคราว — กรุณาติดต่อผู้ดูแลระบบ'); return; }
  // Validate first (re-use logic)
  var errors = [];
  var rows = [];
  requestRows.forEach(function(r, i){
    var name = (r.name || '').trim();
    var empId = (r.empId || '').trim();
    // Strip non-digits (e.g. 1-1003-00226-47-8 → 1100300226478)
    var idCard = String(r.idCard || '').replace(/\D/g, '');
    var position = (r.position || '').trim();
    var course = (r.course || '').trim();
    var timeSlot = (r.timeSlot || '').trim();
    if (!name && !empId && !idCard && !position && !course) return;
    if (!name) { errors.push('แถวที่ '+(i+1)+': ไม่ได้กรอกชื่อ'); return; }
    if (!empId) { errors.push('แถว <b>'+name+'</b>: ไม่ได้กรอกรหัสพนักงาน'); return; }
    if (!idCard) { errors.push('แถว <b>'+name+'</b>: ไม่ได้กรอกเลขบัตรประชาชน'); return; }
    if (idCard.length !== 13) { errors.push('แถว <b>'+name+'</b>: เลขบัตรประชาชนไม่ครบ 13 หลัก'); return; }
    if (!position) { errors.push('แถว <b>'+name+'</b>: ไม่ได้กรอกตำแหน่ง'); return; }
    if (!course) { errors.push('แถว <b>'+name+'</b>: ไม่ได้เลือกหลักสูตร'); return; }
    if (!timeSlot) { errors.push('แถว <b>'+name+'</b>: ไม่ได้เลือกรอบอบรม'); return; }
    rows.push({ name: name, empId: empId, idCard: idCard, position: position, course: course, trainDate: r.trainDate || '', timeSlot: timeSlot, note: r.note || '' });
  });

  if (errors.length) {
    if (typeof showInfo === 'function') showInfo('⚠️ กรุณาตรวจสอบข้อมูล', errors.join('<br>'));
    else alert(errors.join('\n').replace(/<[^>]*>/g, ''));
    return;
  }
  if (rows.length === 0) {
    alert('ยังไม่มีข้อมูลกรอกครบ');
    return;
  }

  // Build summary HTML
  var html = '<div class="summary-intro">คุณกำลังจะส่งรายชื่อ <strong>'+rows.length+' คน</strong> เพื่อเข้าอบรม กรุณาตรวจสอบความถูกต้องก่อนยืนยัน</div>';
  rows.forEach(function(r, idx){
    html += '<div class="summary-row">'
      + '<div class="summary-row-num">#'+(idx+1)+'</div>'
      + '<div class="summary-row-body">'
      +   '<div class="summary-name">'+escapeHtml(r.name)+'</div>'
      +   '<div class="summary-meta"><strong>รหัสพนง:</strong> '+escapeHtml(r.empId||'-')+'</div>'
      +   '<div class="summary-meta"><strong>เลขบัตร:</strong> '+escapeHtml(r.idCard)+'</div>'
      +   '<div class="summary-meta"><strong>ตำแหน่ง:</strong> '+escapeHtml(r.position)+'</div>'
      +   '<div class="summary-meta"><strong>หลักสูตร:</strong> '+escapeHtml(r.course)+'</div>'
      +   '<div class="summary-meta"><strong>📅 วันอบรม:</strong> '+escapeHtml(formatThaiDate(r.trainDate))+'</div>'
      +   '<div class="summary-meta"><strong>🕐 รอบ:</strong> '+escapeHtml(r.timeSlot)+' น.</div>'
      +   (r.note ? '<div class="summary-meta"><strong>หมายเหตุ:</strong> '+escapeHtml(r.note)+'</div>' : '')
      + '</div></div>';
  });
  document.getElementById('summaryBody').innerHTML = html;
  document.getElementById('summaryModal').classList.add('show');
}
function closeSubmitSummary() {
  document.getElementById('summaryModal').classList.remove('show');
}
function confirmSubmit() {
  closeSubmitSummary();
  submitRequests();
}

function submitRequests() {
  var statusEl = document.getElementById('reqStatus');
  var errors = [];
  var warnings = [];
  var valid = [];
  requestRows.forEach(function(r, i){
    var name = (r.name || '').trim();
    var empId = (r.empId || '').trim();
    // Strip non-digits จากเลขบัตร (เช่น 1-1003-00226-47-8 → 1100300226478)
    var idCard = String(r.idCard || '').replace(/\D/g, '');
    var position = (r.position || '').trim();
    var course = (r.course || '').trim();
    var trainDate = (r.trainDate || '').trim();
    var timeSlot = (r.timeSlot || '').trim();
    if (!name && !empId && !idCard && !position && !course) return; // skip empty
    if (!name) { errors.push('แถวที่ '+(i+1)+': ไม่ได้กรอกชื่อ'); return; }
    if (!empId) { errors.push('แถว <b>'+name+'</b>: ไม่ได้กรอกรหัสพนักงาน'); return; }
    if (!idCard) { errors.push('แถว <b>'+name+'</b>: ไม่ได้กรอกเลขบัตรประชาชน'); return; }
    if (idCard.length !== 13) { errors.push('แถว <b>'+name+'</b>: เลขบัตรประชาชนไม่ครบ 13 หลัก'); return; }
    if (!position) { errors.push('แถว <b>'+name+'</b>: ไม่ได้กรอกตำแหน่ง'); return; }
    if (!course) { errors.push('แถว <b>'+name+'</b>: ไม่ได้เลือกหลักสูตร'); return; }
    if (!timeSlot) { errors.push('แถว <b>'+name+'</b>: ไม่ได้เลือกรอบอบรม'); return; }
    valid.push({
      name: name,
      empId: empId,
      idCard: idCard,
      // บังคับใช้ currentBranchName ของสาขาที่ login (กัน mismatch กับ employee.branch จาก dropdown)
      branch: currentBranchName || r.branch || '',
      position: position,
      course: course,
      trainDate: trainDate || _dateNowFor_(course),
      timeSlot: timeSlot,
      // snapshot รุ่น ณ ตอนส่ง — แอดมินเปลี่ยนตารางทีหลัง รายชื่อชุดนี้ยังอยู่รุ่นเดิม
      round: _roundNowFor_(course, timeSlot),
      note: r.note || '',
      brand: _currentBrandType()   // ประเภท/แบรนด์ จากรหัสสาขาที่ล็อกอิน (แม่นยำ)
    });
    // Check if has valid cert (normalize name compare + recompute status from date)
    var _stripKey = function(str){
      return String(str||'').replace(/[\u0009-\u000D\u0020\u00A0\u200B-\u200F\u2028\u2029\uFEFF\u002D]/g, '').toLowerCase();
    };
    var nameKey = _stripKey(name);
    var found = (allRecords || []).find(function(x){
      return _stripKey(x['ชื่อในระบบ'] || x['ชื่อในใบรับรอง'] || '') === nameKey;
    });
    if (found) {
      // ตรวจสถานะจาก field สถานะใบรับรอง + คำนวณจากวันหมดอายุ (กันค่าใน field ว่าง/เก่า)
      var rawStatus = String(found['สถานะใบรับรอง'] || '').toLowerCase();
      var computedStatus = '';
      if (typeof getExpStatus === 'function' && found['วันหมดอายุ']) {
        computedStatus = getExpStatus(found['วันหมดอายุ']);
      }
      // ขึ้น popup เฉพาะ 'ยังมีผล' (valid) เท่านั้น — ไม่รวม 'ใกล้หมดอายุ' / 'หมดอายุ' / ไม่มีใบ
      var isValid = (rawStatus === 'valid' || rawStatus === 'ยังมีผล' || computedStatus === 'valid');
      if (isValid) {
        warnings.push('<b>'+name+'</b> มีใบรับรองที่ยังไม่หมดอายุ (ถึง '+formatThaiDate(found['วันหมดอายุ'])+')');
      }
    }
  });

  if (errors.length) {
    if (typeof showInfo === 'function') {
      showInfo('⚠️ กรุณาตรวจสอบข้อมูล', errors.join('<br>'));
    } else {
      statusEl.innerHTML = '<span style="color:var(--red)">' + errors.join(' · ') + '</span>';
    }
    return;
  }
  if (valid.length === 0) {
    statusEl.innerHTML = '<span style="color:var(--red)">✗ ยังไม่มีข้อมูลกรอกครบ</span>';
    return;
  }

  function doSubmit() {
    var btn = document.getElementById('submitReqBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> กำลังส่ง...';
    statusEl.innerHTML = '';
    showLoadingOverlay('กำลังส่งข้อมูล...', 'กำลังส่งรายชื่อ '+valid.length+' รายการ — กรุณารอสักครู่');
    // fhSaveRequests: Supabase (+ สำรองลง Sheets) ถ้าตั้งค่าไว้ · ไม่งั้น → Sheets เหมือนเดิม
    fhSaveRequests(valid)
    .then(function(res){
      btn.disabled = false; btn.innerHTML = '&#128228; ส่งรายชื่อทั้งหมด';
      if (res.ok) {
        showLoadingOverlay('✓ ส่งรายชื่อสำเร็จ', 'บันทึก '+res.saved+' รายการเรียบร้อยแล้ว', true);
        statusEl.innerHTML = '<span style="color:var(--green)">✓ ส่งรายชื่อ '+res.saved+' รายการเรียบร้อย</span>';
        requestRows = [];
        rerenderRequestList();
        _fhBustRequests();
        setTimeout(loadMyRequests, 600);
        setTimeout(function(){ hideLoadingOverlay(); backToStep1(); }, 1500);
      } else {
        hideLoadingOverlay();
        statusEl.innerHTML = '<span style="color:var(--red)">✗ ส่งไม่สำเร็จ: '+(res.error||'unknown')+'</span>';
      }
    })
    .catch(function(err){
      hideLoadingOverlay();
      btn.disabled = false; btn.innerHTML = '&#128228; ส่งรายชื่อทั้งหมด';
      var msg = err && err.message ? err.message : String(err);
      // Common errors: "Failed to fetch" / "Load failed" → network/CORS issue
      if (msg.indexOf('fetch') >= 0 || msg.indexOf('Load failed') >= 0 || msg.indexOf('Network') >= 0) {
        msg = 'เชื่อมต่อ Cloud ไม่ได้ — ตรวจสอบอินเทอร์เน็ตหรือ Apps Script (URL: ' + SCRIPT_URL.slice(0,50) + '...)';
      }
      statusEl.innerHTML = '<span style="color:var(--red);font-weight:700;">✗ ส่งไม่สำเร็จ: '+msg+'</span>';
      alert('ส่งไม่สำเร็จ: ' + msg + '\n\nลองอีกครั้ง หรือเช็คว่า Apps Script ถูก deploy แล้ว');
    });
  }

  if (warnings.length) {
    var msg = '<div style="text-align:left;padding:6px 0;">'
      + '<div style="color:var(--orange);font-weight:700;margin-bottom:10px;">⚠️ พบรายชื่อที่มีใบรับรองยังไม่หมดอายุ:</div>'
      + '<ul style="margin-left:18px;color:var(--text2);font-size:13px;line-height:1.8;">'
      + warnings.map(function(w){ return '<li>'+w+'</li>'; }).join('')
      + '</ul>'
      + '<div style="margin-top:12px;color:var(--text2);font-size:13px;">ต้องการส่งรายชื่อต่อไปหรือไม่?</div>'
      + '</div>';
    showConfirm('แจ้งเตือน', msg, 'ยังคงส่ง', 'ยกเลิก', doSubmit);
  } else {
    doSubmit();
  }
}

function showInfo(title, htmlMessage) {
  if (!document.getElementById('infoModal')) buildInfoModal();
  document.getElementById('infoModalTitle').innerHTML = title;
  document.getElementById('infoModalBody').innerHTML = htmlMessage;
  document.getElementById('infoModalFooter').innerHTML = '<button class="adm-btn-primary" onclick="closeInfoModal()" style="min-width:120px;">ตกลง</button>';
  document.getElementById('infoModal').classList.add('show');
}
function showConfirm(title, htmlMessage, okText, cancelText, onOk) {
  if (!document.getElementById('infoModal')) buildInfoModal();
  document.getElementById('infoModalTitle').innerHTML = title;
  document.getElementById('infoModalBody').innerHTML = htmlMessage;
  document.getElementById('infoModalFooter').innerHTML =
    '<button class="adm-btn-secondary" onclick="closeInfoModal()">'+(cancelText||'ยกเลิก')+'</button>'
    + '<button class="adm-btn-primary" id="infoModalOk" style="min-width:120px;">'+(okText||'ตกลง')+'</button>';
  document.getElementById('infoModalOk').onclick = function(){ closeInfoModal(); if (onOk) onOk(); };
  document.getElementById('infoModal').classList.add('show');
}
function closeInfoModal() {
  var m = document.getElementById('infoModal');
  if (m) m.classList.remove('show');
}
function buildInfoModal() {
  var html = '<div class="adm-modal" id="infoModal">'
    + '<div class="adm-modal-box" style="max-width:440px;">'
    + '<div class="adm-modal-header"><div class="adm-modal-title" id="infoModalTitle">แจ้งเตือน</div>'
    + '<button class="adm-modal-close" onclick="closeInfoModal()"><svg class="ico"><use href="#i-x"/></svg></button></div>'
    + '<div class="adm-modal-body" id="infoModalBody"></div>'
    + '<div class="adm-modal-footer" style="justify-content:center;gap:10px;" id="infoModalFooter"></div>'
    + '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

/* ═══════════ มือถือ: bottom sheet ตัวกรองใบรับรอง ═══════════
   ย้าย #fhFilterMovable (หลักสูตร/แบรนด์/สาขา/สถานะ + ล้างข้อมูลซ้ำ) เข้า-ออกจากชีต
   — ย้ายทั้งก้อน ไม่ได้ clone → id/onchange เดิมใช้ได้ทั้งหมด */
var _FB_SELS = ['courseFilter','brandFilter','branchFilter','expFilter'];
function fhFilterSheetOpen_() {
  var sh = document.getElementById('fbSheet');
  return !!(sh && sh.classList.contains('show'));
}
function fhOpenFilterSheet() {
  var mv = document.getElementById('fhFilterMovable');
  var body = document.getElementById('fbSheetBody');
  if (mv && body && mv.parentNode !== body) body.appendChild(mv);
  var sh = document.getElementById('fbSheet'), bd = document.getElementById('fbSheetBackdrop');
  if (sh) sh.classList.add('show');
  if (bd) bd.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function fhCloseFilterSheet() {
  var sh = document.getElementById('fbSheet'), bd = document.getElementById('fbSheetBackdrop');
  if (sh) sh.classList.remove('show');
  if (bd) bd.classList.remove('show');
  document.body.style.overflow = '';
  // คืนกลุ่มตัวกรองกลับแถบเดิม (desktop ใช้ตำแหน่งนี้)
  var mv = document.getElementById('fhFilterMovable');
  var inline = document.getElementById('fhFilterInline');
  if (mv && inline && mv.parentNode !== inline) inline.appendChild(mv);
  fhUpdateFilterBadge();
}
function fhResetFilters() {
  _FB_SELS.forEach(function(id){ var el = document.getElementById(id); if (el) el.value = 'all'; });
  var q = document.getElementById('searchQ'); if (q) q.value = '';
  if (typeof setExpFilter === 'function') setExpFilter('all');
  else if (typeof renderTable === 'function') { _tablePage = 1; renderTable(); }
  fhUpdateFilterBadge();
}
/* ตัวเลขบนปุ่ม "ตัวกรอง" = จำนวนตัวกรองที่ไม่ใช่ "ทั้งหมด" */
function fhUpdateFilterBadge() {
  var n = 0;
  _FB_SELS.forEach(function(id){
    var el = document.getElementById(id);
    if (el && el.value && el.value !== 'all') n++;
  });
  var b = document.getElementById('fbBadge');
  if (b) { b.textContent = n; b.hidden = (n === 0); }
  var btn = document.querySelector('.fb-filter-btn');
  if (btn) btn.classList.toggle('has-active', n > 0);
  return n;
}
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' && fhFilterSheetOpen_()) fhCloseFilterSheet();
});
window.addEventListener('resize', function(){
  if (window.innerWidth > 768 && fhFilterSheetOpen_()) fhCloseFilterSheet();
});

