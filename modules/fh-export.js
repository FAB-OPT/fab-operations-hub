/* fh-export.js — ออกใบทะเบียน PDF · นำเข้า/ส่งออก Excel
   แยกมาจาก food-handler.js (บรรทัดเดิม 5160-6417)
   ⚠️ ไฟล์ชุดนี้ต้องโหลดตามลำดับใน food-handler.html — อย่าสลับ */
/* ─── Export training form PDF (printable HTML view) ─── */
/* ─────────── PDF EXPORT PREVIEW MODAL ─────────── */
var _exportPDFCache = []; // last loaded requests for filter modal
var _expBranchType = {};  // branchName -> ประเภท (ใช้กรองสาขาตามประเภทที่เลือก)
function openExportPDFModal() {
  // โหลด requests มาก่อน แล้วสร้าง filter chips
  fetch(SCRIPT_URL + '?action=requests')
    .then(function(r){ return r.json(); })
    .then(function(res){
      var reqs = (res && res.records) || [];
      if (reqs.length === 0) {
        showInfo('ยังไม่มีรายชื่อ', 'ยังไม่มีคำขออบรมในระบบให้ออกรายงาน');
        return;
      }
      _exportPDFCache = reqs;
      // เก็บรายชื่อ branches/courses/slots/types ที่ไม่ซ้ำ
      var brSet={}, coSet={}, slSet={}, tySet={};
      _expBranchType = {};
      reqs.forEach(function(r){
        var b = r.branch || r['สาขา'] || ''; if (b) brSet[b]=true;
        var c = r.course || r['หลักสูตร'] || ''; if (c) coSet[c]=true;
        var s = _normSlot(r.timeSlot || r['รอบ'] || ''); if (s) slSet[s]=true;
        var t = _reqBrandType(r); if (t) tySet[t]=true;
        if (b) _expBranchType[b] = t;   // จำประเภทของแต่ละสาขา
      });
      var branches = Object.keys(brSet).sort();
      var courses = Object.keys(coSet).sort();
      var slots = Object.keys(slSet).sort();
      // ถ้ามีเจ๊แดงตระกูลใดในข้อมูล → ให้เลือกแยก "เจ๊แดง" / "เจ๊แดง จุ่มนัวร์" ได้ทั้งคู่
      if (tySet['เจ๊แดง'] || tySet['เจ๊แดง จุ่มนัวร์']) { tySet['เจ๊แดง'] = true; tySet['เจ๊แดง จุ่มนัวร์'] = true; }
      // ประเภท: เรียงตามลำดับมาตรฐาน
      var TYPE_ORDER = ['ซานตาเฟ่','เจ๊แดง','เจ๊แดง จุ่มนัวร์','Head Office'];
      var types = Object.keys(tySet).sort(function(a,b){
        var ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
        return (ia<0?99:ia) - (ib<0?99:ib);
      });
      var TYPE_ICON = { 'ซานตาเฟ่':'🟠', 'เจ๊แดง':'🔴', 'เจ๊แดง จุ่มนัวร์':'🔴', 'Head Office':'🏢' };
      document.getElementById('expFilterTypes').innerHTML = types.map(function(t){
        return '<label class="exp-chip"><input type="checkbox" data-kind="type" value="'+escapeAttr(t)+'" onchange="updateExportPDFCount()"> <span>'+(TYPE_ICON[t]||'🏷️')+' '+escapeHtml(t)+' <b class="exp-ct"></b></span></label>';
      }).join('') || '<span style="color:var(--text3);font-size:12px;">— ไม่มีข้อมูล —</span>';
      // Render chips — ไม่ active โดย default (ผู้ใช้เลือกเองตามต้องการ · ไม่เลือก = ทุกตัว)
      document.getElementById('expFilterBranches').innerHTML = branches.map(function(b){
        return '<label class="exp-chip"><input type="checkbox" data-kind="branch" value="'+escapeAttr(b)+'" onchange="updateExportPDFCount()"> <span>'+escapeHtml(b)+' <b class="exp-ct"></b></span></label>';
      }).join('');
      document.getElementById('expFilterCourses').innerHTML = courses.map(function(c){
        return '<label class="exp-chip"><input type="checkbox" data-kind="course" value="'+escapeAttr(c)+'" onchange="updateExportPDFCount()"> <span>'+escapeHtml(c)+' <b class="exp-ct"></b></span></label>';
      }).join('');
      document.getElementById('expFilterSlots').innerHTML = slots.map(function(s){
        return '<label class="exp-chip"><input type="checkbox" data-kind="slot" value="'+escapeAttr(s)+'" onchange="updateExportPDFCount()"> <span>'+escapeHtml(s)+' น. <b class="exp-ct"></b></span></label>';
      }).join('');
      updateExportPDFCount();
      document.getElementById('exportPDFModal').classList.add('show');
    })
    .catch(function(err){ showInfo('🌐 โหลดข้อมูลไม่สำเร็จ', escapeHtml(err.message||String(err))); });
}
function closeExportPDFModal() {
  document.getElementById('exportPDFModal').classList.remove('show');
}
function toggleAllExportBranches(val) {
  document.querySelectorAll('#expFilterBranches input[type="checkbox"]').forEach(function(cb){ cb.checked = val; });
  updateExportPDFCount();
}

/* Branch dropdown — toggle open/close + filter by search */
function _toggleExpBranchDropdown() {
  var dd = document.getElementById('expBranchDropdown');
  if (dd) dd.classList.toggle('open');
}
function _filterExpBranches(q) {
  q = (q || '').toLowerCase().trim();
  document.querySelectorAll('#expFilterBranches .exp-chip').forEach(function(chip){
    var text = (chip.textContent || '').toLowerCase();
    chip.classList.toggle('hidden-by-search', q && text.indexOf(q) < 0);
  });
}
/* Close dropdown when clicking outside */
document.addEventListener('click', function(e){
  var dd = document.getElementById('expBranchDropdown');
  if (!dd || !dd.classList.contains('open')) return;
  if (!dd.contains(e.target)) dd.classList.remove('open');
});
function getExportPDFFiltered() {
  /* Returns null when no checkbox in that category is ticked — meaning "no filter for this kind (allow all)" */
  var picks = function(kind){
    var arr = document.querySelectorAll('#exportPDFModal input[data-kind="'+kind+'"]:checked');
    if (arr.length === 0) return null;
    var s = {};
    arr.forEach(function(cb){ s[cb.value]=true; });
    return s;
  };
  var br = picks('branch'), co = picks('course'), sl = picks('slot'), ty = picks('type');
  return _exportPDFCache.filter(function(r){
    var b = r.branch || r['สาขา'] || '';
    var c = r.course || r['หลักสูตร'] || '';
    var s = _normSlot(r.timeSlot || r['รอบ'] || '');
    if (ty && !ty[_reqBrandType(r)]) return false;
    if (br && b && !br[b]) return false;
    if (co && c && !co[c]) return false;
    if (sl && s && !sl[s]) return false;
    return true;
  });
}
// ── Faceted filter: นับจำนวนต่อค่า ตาม filter ของหมวดอื่นที่เลือกไว้ + ซ่อนค่าที่ไม่มีข้อมูล ──
function _expValOf(kind, r) {
  if (kind === 'course') return r.course || r['หลักสูตร'] || '';
  if (kind === 'slot')   return _normSlot(r.timeSlot || r['รอบ'] || '');
  if (kind === 'type')   return _reqBrandType(r);
  return r.branch || r['สาขา'] || '';
}
function _expPicks(kind) {
  var arr = document.querySelectorAll('#exportPDFModal input[data-kind="'+kind+'"]:checked');
  if (arr.length === 0) return null;
  var s = {}; arr.forEach(function(cb){ s[cb.value] = true; }); return s;
}
// นับ record ต่อค่าในหมวด kind โดยผ่าน filter ของ "ทุกหมวดที่ไม่ใช่ตัวเอง" (faceted)
function _expCountsFor(kind) {
  var others = {};
  ['course','slot','type','branch'].forEach(function(k){ if (k !== kind) others[k] = _expPicks(k); });
  var counts = {};
  _exportPDFCache.forEach(function(r){
    for (var k in others) { var p = others[k]; if (p) { var v = _expValOf(k, r); if (v && !p[v]) return; } }
    var val = _expValOf(kind, r); if (val) counts[val] = (counts[val] || 0) + 1;
  });
  return counts;
}
var _EXP_FACET_EL = { course:'expFilterCourses', slot:'expFilterSlots', type:'expFilterTypes', branch:'expFilterBranches' };
function _refreshExpFacets() {
  ['course','slot','type','branch'].forEach(function(kind){
    var counts = _expCountsFor(kind);
    var box = document.getElementById(_EXP_FACET_EL[kind]); if (!box) return;
    box.querySelectorAll('.exp-chip').forEach(function(chip){
      var cb = chip.querySelector('input[type="checkbox"]'); if (!cb) return;
      var n = counts[cb.value] || 0;
      var ct = chip.querySelector('.exp-ct'); if (ct) ct.textContent = n;
      // หลักสูตร = ตัวขับ โชว์เสมอ · หมวดอื่นซ่อนเมื่อไม่มีข้อมูล (โชว์เฉพาะที่มี)
      var hide = (kind !== 'course') && n === 0;
      chip.classList.toggle('hidden-by-facet', hide);
      if (hide && cb.checked) cb.checked = false;
    });
  });
}
function updateExportPDFCount() {
  _refreshExpFacets();   // นับจำนวน + ซ่อนค่าที่ไม่มีข้อมูล (faceted: หลักสูตร→รอบ/แบรนด์/สาขา)
  var n = getExportPDFFiltered().length;
  document.getElementById('exportPDFCount').innerHTML = 'จะออก PDF ทั้งหมด <b style="color:var(--gold);font-size:18px;">'+n+'</b> รายการ';
  // Sync branch dropdown label + count + has-selection state
  var dd = document.getElementById('expBranchDropdown');
  if (dd) {
    var sel = document.querySelectorAll('#expFilterBranches input[type="checkbox"]:checked').length;
    var total = document.querySelectorAll('#expFilterBranches .exp-chip:not(.hidden-by-facet) input[type="checkbox"]').length;
    var label = document.getElementById('expBranchLabel');
    var cnt = document.getElementById('expBranchCount');
    if (cnt) cnt.textContent = sel;
    if (label) {
      label.textContent = sel === 0
        ? 'ทุกสาขา (' + total + ')'
        : (sel === total ? 'ทุกสาขา (' + total + ')' : 'เลือก ' + sel + ' จาก ' + total + ' สาขา');
    }
    dd.classList.toggle('has-selection', sel > 0 && sel < total);
  }
}
function confirmExportPDF() {
  var filtered = getExportPDFFiltered();
  if (filtered.length === 0) {
    showInfo('ไม่มีรายการตรงเงื่อนไข', 'กรุณาเลือก filter อย่างน้อย 1 อย่างที่มีข้อมูล');
    return;
  }
  var hideIdCard = !!(document.getElementById('expHideIdCard') && document.getElementById('expHideIdCard').checked);
  var sortOrder = (document.getElementById('expSortOrder') || {}).value || 'default';
  closeExportPDFModal();
  exportTrainingPDF(filtered, { hideIdCard: hideIdCard, sortOrder: sortOrder });
}

function exportTrainingPDF(preloadedReqs, opts) {
  opts = opts || {};
  var hideIdCard = !!opts.hideIdCard;
  var run = function(reqs){
      if (!reqs || reqs.length === 0) { showInfo('ยังไม่มีรายชื่อ', 'ยังไม่มีคำขออบรมในระบบ'); return; }
      var groups = {};
      reqs.forEach(function(r){
        var cRaw = r.course || r['หลักสูตร'] || '';
        var sRaw = r.timeSlot || r['รอบ'] || '';
        // Normalize: ใช้ schedule key เป็น canonical course (กัน record course ไม่ตรงกันเล็กน้อย)
        var schForGroup = _findCourseSchedule_(cRaw);
        var canonicalCourse = cRaw;
        if (schForGroup) {
          // หา key ที่ตรงกับ sch — ไม่มี method ลัด ก็ loop หา
          var sKeys = Object.keys(COURSE_SCHEDULES);
          for (var ki = 0; ki < sKeys.length; ki++) {
            if (COURSE_SCHEDULES[sKeys[ki]] === schForGroup) { canonicalCourse = sKeys[ki]; break; }
          }
        }
        // Normalize slot: ลบ whitespace + normalize dash → 9.00-13.00
        var canonicalSlot = String(sRaw).replace(/\s+/g, '').replace(/[–—~]/g, '-');
        // วัน+รุ่น อยู่ใน key ด้วย — คนละรอบอบรม (คนละวัน/คนละรุ่น) ห้ามรวมหน้าเดียวกันแม้เวลาซ้ำ
        // วันที่ต้อง normalize ก่อน ไม่งั้น "12 มิถุนายน 2569" กับ "12 มิ.ย. 2569" กลายเป็นคนละใบ
        var gDate = r.trainDate || r['วันอบรม'] || '';
        var gRound = _recRound_(r);
        var k = canonicalCourse + '|' + canonicalSlot + '|' + _normDateKey_(gDate) + '|' + gRound;
        if (!groups[k]) groups[k] = { course: canonicalCourse, slot: canonicalSlot, trainDate: gDate, round: gRound, rows: [] };
        groups[k].rows.push(r);
      });

      // คอลัมน์ ตำแหน่ง/สาขา ปรับกว้างตามตำแหน่งที่ยาวสุด — ตำแหน่งสั้น = ช่องแคบ คืนที่ให้สาขา (ตำแหน่ง+สาขา = คงที่)
      var _maxPosLen = 0;
      reqs.forEach(function(r){ var _l = String(r.position || r['ตำแหน่ง'] || '').length; if (_l > _maxPosLen) _maxPosLen = _l; });
      var _posW = Math.max(90, Math.min(188, Math.round(_maxPosLen * 4.7 + 14)));  // ตำแหน่งกว้างพอดีเนื้อหา
      var _brW  = 318 - _posW;  // ที่เหลือยกให้สาขา (รวม ตำแหน่ง+สาขา = 318)
      // ฟอนต์ตำแหน่งเดียวทั้งรายงาน — พอดีตัวที่ยาวสุด (สูงสุด 11px) ให้ทุกแถวขนาดเท่ากัน
      var _posFont = Math.max(8, Math.min(11, Math.round((_posW / 674 * 688) / (Math.max(_maxPosLen, 1) * 0.55))));
      // เติมรหัสสาขานำหน้าชื่อ (เช่น "4018 เจ๊แดง จุ่มนัวร์ เทอมินัล 21 พระราม 3") — แมพ ชื่อเต็ม -> รหัส จาก BRANCHES
      var _brCodeByName = {};
      try { Object.keys(BRANCHES).forEach(function(c){ _brCodeByName[getBranchFullName(c)] = c; }); } catch(e) {}
      // แสดง "รหัส + ชื่อสาขา" — ตัดเฉพาะ Santa Fe/Santa Fe Easy นำหน้า (เจ๊แดงคงชื่อเต็มไว้)
      function _brStripBrand(s){ return String(s || '').replace(/^(Santa Fe Easy|Santa Fe)\s+/i, ''); }
      function _brDisp(name){
        name = String(name || '');
        var c = _brCodeByName[name];
        return (c ? (c + ' ') : '') + _brStripBrand(name);
      }

      // สาขาก็อยู่บรรทัดเดียว (กันตัดบรรทัด ดันแถวสูง) — ฟอนต์เดียวพอดีสาขาที่ยาวสุด (รวมรหัสนำหน้าแล้ว)
      var _maxBrLen = 0;
      reqs.forEach(function(r){ var _l = _brDisp(r.branch || r['สาขา'] || '').length; if (_l > _maxBrLen) _maxBrLen = _l; });
      var _brFont = Math.max(8, Math.min(11, Math.round((_brW / 674 * 688) / (Math.max(_maxBrLen, 1) * 0.62))));

      // Build printable HTML
      var html = '<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ทะเบียนรายชื่อผู้เข้าอบรม</title>';
      html += '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
      html += '<style>'
        + '@page { size: A4; margin: 0; }'
        + '* { box-sizing: border-box; }'
        + 'body { font-family: "Sarabun", "Tahoma", sans-serif; color:#111; margin:0; font-size: 13.5px; }'
        + '.form-page { padding-top: 9mm; padding-bottom: 5mm; padding-left: 14mm; padding-right: 14mm; }'
        + '.form-page + .form-page { page-break-before: always; }'
        + '.form-head { text-align:center; margin: 0 0 6px; position: relative; padding-top: 0; padding-right: 0; padding-left: 0; }'
        + '.form-logo { width: 90px; position: absolute; left: 0; top: 4px; mix-blend-mode: multiply; }'
        + '.form-title-co { font-size: 16px; font-weight: 800; margin: 0 0 5px; padding: 0; line-height: 1.25; text-align: center; }'
        + '.form-title-sub { font-size: 13.5px; font-weight: 700; margin: 0; line-height: 1.25; text-align: center; }'
        + '.form-meta-row {'
        +   ' display: flex; align-items: baseline; justify-content: center; gap: 16px;'
        +   ' font-size: 12.5px; line-height: 1.25; margin: 0 0 5px;'
        +   ' flex-wrap: wrap; padding-right: 0; padding-left: 0;'
        + ' }'
        + '.form-meta-row:last-of-type { margin-bottom: 12px; }'
        + '.form-meta-row .lbl { font-weight: 800; }'
        + '.form-meta-row .val {'
        +   ' display: inline-block; min-width: 110px;'
        +   ' border-bottom: 1px dotted #444; padding: 0 6px; font-weight: 500;'
        +   ' text-align: center;'
        + ' }'
        + 'table { width: 100%; max-width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0 0; table-layout: fixed; }'
        + 'th, td { border: 1px solid #555; padding: 5px 4px; text-align: center; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }'
        + 'td.branch-cell { white-space: nowrap !important; overflow: hidden; text-overflow: clip; padding-left: 3px; padding-right: 3px; font-size: ' + _brFont + 'px; }'
        + 'td.pos-cell { white-space: nowrap !important; overflow: hidden; text-overflow: clip; padding-left: 4px; padding-right: 4px; font-size: ' + _posFont + 'px; }'
        + 'th { background: #d9d9d9; font-weight: 800; text-align: center; font-size: 11.5px; padding: 5px 3px; white-space: normal; line-height: 1.15; }'
        + 'td.num { text-align: center; color: #1d4ed8; width: 48px; font-weight: 700; vertical-align: middle; line-height: 1.1; padding: 5px 2px; }'
        + 'td.empid { text-align: center; }'
        + 'td.idcard { text-align: center; }'
        + 'td.empty { height: 17px; }'
        + '.print-bar { position:fixed; top: 10px; right: 10px; z-index:9999; }'
        + '.print-bar button {'
        +   ' padding: 9px 18px; font-size: 14px; font-weight: 700; cursor: pointer;'
        +   ' border-radius: 10px; border: 1px solid #ccc;'
        +   ' background: linear-gradient(135deg, #ef4444, #f87171); color: #fff;'
        +   ' box-shadow: 0 4px 12px rgba(239,68,68,0.3);'
        + ' }'
        + '@media print { .print-bar { display: none; } body { font-family: "Sarabun","Tahoma",sans-serif; } }'
        + '</style></head><body>';
      html += '<div class="print-bar"><button onclick="window.print()">🖨 พิมพ์ / Save PDF</button></div>';

      // Logo absolute URL
      var logoUrl = new URL('../logo.png', location.href).href;

      var ROWS_PER_PAGE = 35;
      // Sort groups + rows according to opts.sortOrder
      var sortKey = opts.sortOrder || 'default';
      var groupKeys = Object.keys(groups);
      groupKeys.sort(function(a, b){
        var ga = groups[a], gb = groups[b];
        if (sortKey === 'count_desc') return gb.rows.length - ga.rows.length;
        if (sortKey === 'count_asc')  return ga.rows.length - gb.rows.length;
        if (sortKey === 'name_asc' || sortKey === 'branch_asc')  return a < b ? -1 : a > b ? 1 : 0;
        if (sortKey === 'name_desc') return a < b ? 1 : a > b ? -1 : 0;
        return 0; // default order
      });
      // Sort rows within each group when row-level sort is selected
      if (sortKey === 'name_asc' || sortKey === 'name_desc' || sortKey === 'branch_asc') {
        groupKeys.forEach(function(k){
          groups[k].rows.sort(function(a, b){
            var pickName = function(r){ return r.name || r['ชื่อ-นามสกุล'] || r['ชื่อ'] || ''; };
            var pickBranch = function(r){ return _brDisp(r.branch || r['สาขา'] || ''); };  // เรียงตามชื่อที่มีรหัสนำหน้า = เรียงตามรหัส
            var va, vb;
            if (sortKey === 'branch_asc') { va = pickBranch(a); vb = pickBranch(b); }
            else { va = pickName(a); vb = pickName(b); }
            var cmp = va.localeCompare(vb, 'th');
            return sortKey === 'name_desc' ? -cmp : cmp;
          });
        });
      }
      groupKeys.forEach(function(key){
        var g = groups[key];
        var sch = _findCourseSchedule_(g.course);
        // ยึดค่าที่ติดมากับรายชื่อ — ไม่ดึงจากตารางอบรมปัจจุบัน (ตารางเปลี่ยนแล้วของเก่าต้องไม่เปลี่ยนตาม)
        // ไม่รู้รุ่นจริง → เว้นว่างให้เขียนมือ ดีกว่าพิมพ์รุ่นปัจจุบันทับของเก่า
        var roundNum = g.round || '';
        var fullDate = _formDate_(g.trainDate, sch);

        var totalPages = Math.ceil(g.rows.length / ROWS_PER_PAGE) || 1;
        for (var p = 0; p < totalPages; p++) {
          var chunkRows = g.rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
          var pageLabel = totalPages > 1 ? ' (หน้า ' + (p + 1) + '/' + totalPages + ')' : '';

          html += '<div class="form-page">'
            + '<div class="form-head">'
            +   '<img class="form-logo" src="' + logoUrl + '" onerror="this.style.display=\'none\'">'
            +   '<div class="form-title-co">บริษัท เอฟเอบี ฟู้ดโฮลดิ้ง จำกัด</div>'
            +   '<div class="form-title-sub">ทะเบียนรายชื่อผู้เข้าอบรม' + pageLabel + '</div>'
            + '</div>'
            + '<div class="form-meta-row">'
            +   '<span><span class="lbl">หลักสูตร :</span> <span class="val">' + escapeHtml(g.course) + '</span></span>'
            +   '<span><span class="lbl">รุ่นที่ :</span> <span class="val" style="min-width:80px;">' + escapeHtml(roundNum) + '</span></span>'
            + '</div>'
            + '<div class="form-meta-row">'
            +   '<span><span class="lbl">ระหว่างวันที่ :</span> <span class="val">' + escapeHtml(fullDate) + '</span></span>'
            +   '<span><span class="lbl">ถึงวันที่ :</span> <span class="val">' + escapeHtml(fullDate) + '</span></span>'
            + '</div>'
            + '<div class="form-meta-row">'
            +   '<span><span class="lbl">ตั้งแต่เวลา :</span> <span class="val" style="min-width:140px;">' + escapeHtml(g.slot) + ' น.</span></span>'
            + '</div>'
            + '<table>'
            + '<thead><tr>'
            +   '<th style="width:48px;">ลำดับ</th>'
            +   '<th style="width:58px;">รหัสพนักงาน</th>'
            +   '<th style="width:145px;">ชื่อ - นามสกุล</th>'
            +   '<th style="width:' + _posW + 'px;">ตำแหน่ง</th>'
            +   (hideIdCard ? '' : '<th style="width:105px;">เลขบัตรประจำตัวประชาชน</th>')
            +   '<th style="width:' + _brW + 'px;">สาขา/หน่วยงาน</th>'
            + '</tr></thead><tbody>';
          // แสดงเฉพาะจำนวนคนจริงในหน้านี้ (ไม่เติมแถวว่าง) — มี 30 คนก็ 30 ลำดับ
          for (var i = 0; i < chunkRows.length; i++) {
            var r = chunkRows[i];
            var globalIdx = p * ROWS_PER_PAGE + i + 1;
            html += '<tr>'
              + '<td class="num">' + globalIdx + '</td>'
              + '<td class="empid">' + escapeHtml(r.empId || r['รหัสพนักงาน'] || '') + '</td>'
              + '<td>' + escapeHtml(r.name || '') + '</td>'
              + '<td class="pos-cell">' + escapeHtml(r.position || '') + '</td>'
              + (hideIdCard ? '' : '<td class="idcard">' + escapeHtml(r.idCard || '') + '</td>')
              + '<td class="branch-cell">' + escapeHtml(_brDisp(r.branch || '')) + '</td>'
              + '</tr>';
          }
          html += '</tbody></table></div>';
        }
      });
      html += '</body></html>';

      var w = window.open('', '_blank');
      if (!w) { showInfo('Popup ถูกบล็อก', 'อนุญาตให้เปิด popup เพื่อ export PDF'); return; }
      w.document.open();
      w.document.write(html);
      w.document.close();
      // Auto-trigger print after load
      setTimeout(function(){ try { w.focus(); w.print(); } catch(e){} }, 600);
  };
  // ถ้ามี preloaded จาก modal → ใช้เลย, ไม่งั้น fetch
  if (preloadedReqs && preloadedReqs.length) { run(preloadedReqs); return; }
  fetch(SCRIPT_URL + '?action=requests')
    .then(function(r){ return r.json(); })
    .then(function(res){ run((res && res.records) || []); })
    .catch(function(err){ showInfo('PDF export ผิดพลาด', escapeHtml(err.message||String(err))); });
}

/* ─────────── เทมเพลตนำเข้ารายชื่ออบรม ───────────
   หัวคอลัมน์ในเทมเพลตต้องเป็นคำที่ตัวอ่านไฟล์จับได้จริง — ดูเงื่อนไขที่
   handleImportRequestsXLSX() · มีจุดที่พลาดง่ายคือคอลัมน์ "รอบ" ตัวอ่านจะข้าม
   ถ้าหัวคอลัมน์มีคำว่า "อบรม" ปนอยู่ (กันสับสนกับ "วันอบรม") จึงต้องเป็น "รอบ"
   เฉย ๆ ห้ามเขียนว่า "รอบอบรม" */
var REQ_TEMPLATE_HEADERS = [
  'ชื่อ-นามสกุล', 'รหัสพนักงาน', 'เลขบัตรประชาชน', 'สาขา', 'ตำแหน่ง',
  'หลักสูตร', 'วันอบรม', 'รอบ', 'รุ่น', 'หมายเหตุ'
];

function downloadRequestTemplate() {
  if (typeof XLSX === 'undefined') {
    showInfo('ยังโหลดไม่เสร็จ', 'ตัวสร้างไฟล์ Excel ยังโหลดไม่เสร็จ รอสัก 2-3 วินาทีแล้วกดใหม่');
    return;
  }
  /* ตัวอย่างอิงตารางอบรมจริงที่ตั้งไว้ในระบบ ถ้ามี — คนกรอกจะได้เห็นรูปแบบ
     วันที่และรอบที่ระบบอ่านออก ไม่ต้องเดาเอง */
  var courses = (typeof COURSE_SCHEDULES !== 'undefined') ? Object.keys(COURSE_SCHEDULES) : [];
  var c1 = courses[0] || 'การสุขาภิบาลอาหาร สำหรับผู้สัมผัสอาหาร';
  var s1 = (courses[0] && COURSE_SCHEDULES[c1]) || {};
  var slot1 = (s1.slots && s1.slots[0]) || '9.00-13.00';
  var round1 = (s1.rounds && s1.rounds[slot1]) || '';

  var rows = [
    REQ_TEMPLATE_HEADERS,
    ['สมชาย ใจดี', '100234', '1234567890123', 'สามย่าน', 'พนักงานครัว', c1, s1.date || '', slot1, round1, ''],
    ['สมหญิง ดีใจ', '100567', '9876543210987', 'ทองหล่อ', 'พนักงานเสิร์ฟ', c1, s1.date || '', slot1, round1, 'แทนคนลาออก']
  ];

  var ws = XLSX.utils.aoa_to_sheet(rows);
  /* กว้างพอให้อ่านหัวคอลัมน์ออกโดยไม่ต้องลากขยายเอง */
  ws['!cols'] = [
    { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 16 },
    { wch: 38 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 22 }
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'รายชื่ออบรม');
  XLSX.writeFile(wb, 'เทมเพลตนำเข้ารายชื่ออบรม.xlsx');
  showInfo('ดาวน์โหลดเทมเพลตแล้ว',
    'ไฟล์มีตัวอย่างการกรอกไว้ 2 แถว — <b>ลบแถวตัวอย่างออกก่อน</b> แล้วใส่รายชื่อจริงแทน<br>' +
    'ลำดับคอลัมน์สลับได้ ขอแค่ชื่อหัวคอลัมน์ตรงกับที่ให้มา');
}

/* ─────────── IMPORT REQUESTS XLSX (admin) ─────────── */
var _importReqParsed = []; // staged records before save
function openImportRequestsModal() {
  _importReqParsed = [];
  document.getElementById('importReqStage1').style.display = 'block';
  document.getElementById('importReqStage2').style.display = 'none';
  document.getElementById('importReqConfirmBtn').style.display = 'none';
  document.getElementById('importReqXlsxInput').value = '';
  document.getElementById('importReqModal').classList.add('show');
}
function closeImportRequestsModal() {
  document.getElementById('importReqModal').classList.remove('show');
}
/* Drag & drop on the importRequests drop zone */
function impReqDragOver(e) {
  e.preventDefault();
  document.getElementById('impReqDropZone').classList.add('drag');
}
function impReqDragLeave() {
  document.getElementById('impReqDropZone').classList.remove('drag');
}
function impReqDrop(e) {
  e.preventDefault();
  document.getElementById('impReqDropZone').classList.remove('drag');
  var input = document.getElementById('importReqXlsxInput');
  if (!input || !e.dataTransfer || !e.dataTransfer.files.length) return;
  var f = e.dataTransfer.files[0];
  if (!/\.(xlsx|xls)$/i.test(f.name)) return;
  try {
    var dt = new DataTransfer();
    dt.items.add(f);
    input.files = dt.files;
  } catch (err) {
    // older browsers — fall back: trigger onchange manually with the file
  }
  handleImportRequestsXLSX(input);
}
function handleImportRequestsXLSX(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e){
    try {
      var wb = XLSX.read(new Uint8Array(e.target.result), { type:'array' });
      var records = [];
      wb.SheetNames.forEach(function(sn){
        var ws = wb.Sheets[sn];
        var rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
        if (rows.length < 2) return;

        // หา header row โดยสแกน 15 แถวแรก — หา row ที่มี 'ลำดับ' หรือ 'ชื่อ'+'นามสกุล'
        var headerRowIdx = 0;
        for (var hi = 0; hi < Math.min(15, rows.length); hi++) {
          var rowText = rows[hi].map(function(c){ return String(c).toLowerCase(); }).join('|');
          var hasName = rowText.indexOf('ชื่อ') >= 0 && rowText.indexOf('นามสกุล') >= 0;
          var hasLamdab = rowText.indexOf('ลำดับ') >= 0;
          var hasFullname = rowText.indexOf('fullname') >= 0;
          if (hasName || hasLamdab || hasFullname) { headerRowIdx = hi; break; }
        }
        var header = rows[headerRowIdx];

        // Column detection
        var col = { name:-1, empId:-1, idCard:-1, branch:-1, position:-1, course:-1, trainDate:-1, timeSlot:-1, note:-1, round:-1 };
        header.forEach(function(h,i){
          var s = String(h).toLowerCase();
          if (col.name<0 && (s.indexOf('fullname')>=0 || (s.indexOf('ชื่อ')>=0 && s.indexOf('เล่น')<0 && s.indexOf('nick')<0))) col.name = i;
          if (col.empId<0 && (s.indexOf('empcode')>=0 || s.indexOf('empid')>=0 || s.indexOf('รหัสพนักงาน')>=0 || s.indexOf('รหัสพนง')>=0)) col.empId = i;
          if (col.idCard<0 && (s.indexOf('identity')>=0 || s.indexOf('idcard')>=0 || s.indexOf('เลขบัตร')>=0 || s.indexOf('บัตรประชาชน')>=0)) col.idCard = i;
          if (col.branch<0 && (s.indexOf('orgunit')>=0 || s.indexOf('สาขา')>=0 || s.indexOf('หน่วย')>=0)) col.branch = i;
          if (col.position<0 && ((s.indexOf('position')>=0 && s.indexOf('eng')<0) || s.indexOf('ตำแหน่ง')>=0)) col.position = i;
          if (col.course<0 && (s.indexOf('course')>=0 || s.indexOf('หลักสูตร')>=0)) col.course = i;
          if (col.trainDate<0 && (s.indexOf('traindate')>=0 || s.indexOf('วันอบรม')>=0)) col.trainDate = i;
          if (col.timeSlot<0 && (s.indexOf('timeslot')>=0 || (s.indexOf('รอบ')>=0 && s.indexOf('อบรม')<0))) col.timeSlot = i;
          if (col.note<0 && (s.indexOf('note')>=0 || s.indexOf('หมายเหตุ')>=0)) col.note = i;
          if (col.round<0 && (s.indexOf('round')>=0 || s.indexOf('รุ่น')>=0)) col.round = i;
        });

        // หาก headerRowIdx อยู่ก่อน row 3 บางทีมี course/round บอกใน row 2 (title)
        // ลอง extract default course + รุ่นที่ จาก row บน
        var fileCourse = '', fileRound = '';
        for (var ti = 0; ti < headerRowIdx; ti++) {
          var t = rows[ti].map(function(c){ return String(c); }).join(' ');
          var rm = t.match(/รุ่นที่\s*[:：]?\s*([0-9]+\s*\/\s*[0-9]{2,4})/);
          if (rm && !fileRound) fileRound = rm[1].replace(/\s+/g, '');
          var cm = t.match(/หลักสูตร\s*[:：]?\s*(.+)/);
          if (cm && !fileCourse) fileCourse = cm[1].trim();
        }

        for (var i = headerRowIdx + 1; i < rows.length; i++) {
          var r = rows[i];
          var name = col.name>=0 ? String(r[col.name]||'').trim() : '';
          // Skip empty + 'ตัวอย่าง'
          if (!name || name.length < 2 || name === 'ตัวอย่าง' || /ตัวอย่าง/i.test(name)) continue;

          var courseRaw = col.course>=0 ? String(r[col.course]||'').trim() : '';
          var trainDateRaw = col.trainDate>=0 ? String(r[col.trainDate]||'').trim() : '';
          var timeSlotRaw  = col.timeSlot>=0 ? String(r[col.timeSlot]||'').trim() : '';

          // ถ้าเซลล์ 'หลักสูตร' รวม date+time → แยกออก
          if (courseRaw) {
            // วันที่: regex รับทั้ง 'วันที่ 10 มิถุนายน 2569' และ '10 มิ.ย. 2569'
            var dm = courseRaw.match(/วันที่\s*(\d{1,2}\s+\S+\s+\d{4})/);
            if (!dm) dm = courseRaw.match(/(\d{1,2}\s+(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?)\s+\d{4})/);
            if (dm && !trainDateRaw) trainDateRaw = dm[1];
            var tm = courseRaw.match(/เวลา\s*(\d{1,2}[.:]\d{2}\s*[-–~]\s*\d{1,2}[.:]\d{2})/);
            if (!tm) tm = courseRaw.match(/(\d{1,2}[.:]\d{2}\s*[-–~]\s*\d{1,2}[.:]\d{2})/);
            if (tm && !timeSlotRaw) timeSlotRaw = tm[1];
          }

          // Normalize course → match COURSE_SCHEDULES (เอาแค่ชื่อหลักสูตร ตัด date/time/ชื่อสาขาทิ้ง)
          // ลำดับ: ถ้า courseRaw มี keyword ของหลักสูตร → ใช้ key เต็มจาก SCHEDULES
          // (substring match) — fallback ใช้ raw ถ้าไม่ match
          var cleanCourse = '';
          var courseKeys = (typeof COURSE_SCHEDULES !== 'undefined') ? Object.keys(COURSE_SCHEDULES) : [];
          var courseText = (courseRaw || fileCourse).toLowerCase();
          // sort longest first → match the most specific
          courseKeys.sort(function(a,b){ return b.length - a.length; });
          for (var ck = 0; ck < courseKeys.length; ck++) {
            var key = courseKeys[ck];
            // partial match (substring) — ผู้สัมผัส / ผู้ประกอบ
            var keyLow = key.toLowerCase();
            var keyMid = keyLow.replace(/^การสุขาภิบาลอาหาร\s*สำหรับ/, '').trim();  // 'ผู้สัมผัสอาหาร' / 'ผู้ประกอบกิจการ'
            if (courseText.indexOf(keyLow) >= 0 || (keyMid && courseText.indexOf(keyMid) >= 0)) {
              cleanCourse = key; break;
            }
          }
          if (!cleanCourse) cleanCourse = courseRaw || fileCourse;
          // ถ้า match SCHEDULES และ trainDate/timeSlot ยังว่าง → ใช้ค่าจาก schedule
          var schMatch = (typeof COURSE_SCHEDULES !== 'undefined') ? COURSE_SCHEDULES[cleanCourse] : null;
          if (schMatch) {
            if (!trainDateRaw) trainDateRaw = schMatch.date || '';
            if (!timeSlotRaw && schMatch.slots && schMatch.slots.length === 1) timeSlotRaw = schMatch.slots[0];
          }
          // รุ่น: จากคอลัมน์ → หัวไฟล์ → ตารางปัจจุบัน (เก็บติดเรคคอร์ดไว้ ไม่ต้องเดาใหม่ทุกครั้ง)
          var roundRaw = col.round>=0 ? String(r[col.round]||'').trim() : '';
          if (!roundRaw) roundRaw = fileRound || _findRoundForSlot_(schMatch, timeSlotRaw) || '';

          records.push({
            name: name,
            empId:    col.empId>=0    ? String(r[col.empId]||'').trim()    : '',
            idCard:   col.idCard>=0   ? String(r[col.idCard]||'').replace(/\D/g,'').slice(0,13) : '',
            branch:   col.branch>=0   ? String(r[col.branch]||'').trim()   : '',
            position: col.position>=0 ? String(r[col.position]||'').trim() : '',
            course:   cleanCourse,
            trainDate: trainDateRaw,
            timeSlot:  timeSlotRaw,
            round:     roundRaw,
            note:     col.note>=0     ? String(r[col.note]||'').trim()     : ''
          });
        }
      });
      if (records.length === 0) {
        showInfo('ไม่พบรายชื่อ', 'ไม่พบ row ที่มีคอลัมน์ "ชื่อ"/FullnameThai ที่กรอกข้อมูล');
        return;
      }
      _importReqParsed = records;
      // Show preview
      document.getElementById('importReqStage1').style.display = 'none';
      document.getElementById('importReqStage2').style.display = 'block';
      document.getElementById('importReqSummary').innerHTML = '✓ พบ <b style="color:var(--green);">'+records.length+'</b> รายการ — ตรวจสอบก่อนบันทึก';
      var preview = document.getElementById('importReqPreview');
      preview.innerHTML = records.slice(0, 200).map(function(r){
        return '<tr>'
          + '<td style="padding:6px 8px;border-bottom:1px solid var(--border);">'+escapeHtml(r.name)+'</td>'
          + '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text2);">'+escapeHtml(r.branch||'—')+'</td>'
          + '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text2);">'+escapeHtml(r.position||'—')+'</td>'
          + '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text2);font-size:11px;">'+escapeHtml(r.course||'—')+'</td>'
          + '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text2);">'+escapeHtml(r.timeSlot||'—')+'</td>'
          + '</tr>';
      }).join('') + (records.length > 200 ? '<tr><td colspan="5" style="padding:8px;text-align:center;color:var(--text3);font-size:11px;">แสดง 200 จาก '+records.length+' (ทุก row จะถูกบันทึก)</td></tr>' : '');
      var btn = document.getElementById('importReqConfirmBtn');
      btn.style.display = 'inline-flex';
      btn.innerHTML = '✓ บันทึก '+records.length+' รายการ';
    } catch(err) {
      showInfo('อ่านไฟล์ไม่ได้', escapeHtml(err.message||String(err)));
    }
  };
  reader.onerror = function(){ showInfo('อ่านไฟล์ไม่ได้', 'FileReader error'); };
  reader.readAsArrayBuffer(file);
}
function confirmImportRequests() {
  if (!_importReqParsed.length) return;
  var btn = document.getElementById('importReqConfirmBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> กำลังบันทึก...';
  fetch(SCRIPT_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'save-requests', records: _importReqParsed })
  })
  .then(function(r){ return r.json(); })
  .then(function(res){
    btn.disabled = false;
    if (res && res.ok) {
      closeImportRequestsModal();
      showInfo('✓ นำเข้าสำเร็จ', 'บันทึก <b>'+res.saved+'</b> รายการลง Cloud แล้ว');
      _fhBustRequests();
      loadAdminRequests();
    } else {
      btn.innerHTML = '✓ บันทึก '+_importReqParsed.length+' รายการ';
      showInfo('✗ บันทึกไม่สำเร็จ', escapeHtml((res && res.error) || 'unknown'));
    }
  })
  .catch(function(err){
    btn.disabled = false;
    btn.innerHTML = '✓ บันทึก '+_importReqParsed.length+' รายการ';
    showInfo('🌐 เชื่อมต่อ Cloud ไม่ได้', escapeHtml(err.message||String(err)));
  });
}

/* ─── Export training form: fill ฟอร์ม.xlsx with grouped requests ─── */
function exportTrainingForm() {
  if (typeof ExcelJS === 'undefined') {
    customConfirm({
      icon:ICON_WARN, title:'ExcelJS ยังโหลดไม่เสร็จ',
      desc:'รอ 2-3 วินาทีแล้วลองอีกครั้ง — หรือ refresh หน้านี้',
      okText:'ปิด', okIsPrimary:true, hideCancel:true
    });
    return;
  }
  var btn = event && event.target ? event.target : null;
  if (btn) { btn.disabled = true; btn.dataset.orig = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> กำลังเตรียม...'; }
  // Safety timeout — re-enable button if stuck >60s
  var safetyTimer = setTimeout(function(){
    if (btn && btn.disabled) {
      btn.disabled = false;
      if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
      customConfirm({
        icon:'⏱', title:'ใช้เวลานานเกินไป',
        desc:'การสร้างไฟล์ Excel ใช้เวลานานเกิน 60 วินาที — อาจเป็นปัญหาเครือข่ายหรือ Apps Script ตอบช้า ลองอีกครั้ง',
        okText:'ปิด', okIsPrimary:true, hideCancel:true
      });
    }
  }, 60000);
  // Patch onwards: clear safetyTimer in all done/error paths
  window._exportSafetyTimer = safetyTimer;

  function fetchTemplate() {
    /* form.xlsx template is embedded as base64 (see FORM_XLSX_B64 script tag) — works on file:// too */
    if (typeof FORM_XLSX_B64 === 'string' && FORM_XLSX_B64.length > 0) {
      try {
        var binary = atob(FORM_XLSX_B64);
        var len = binary.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return Promise.resolve(bytes.buffer);
      } catch (e) {
        return Promise.reject(new Error('decode embedded template failed: ' + e.message));
      }
    }
    /* Fallback: fetch from disk (legacy path, requires http server) */
    var tplCandidates = [
      new URL('../form.xlsx', location.href).href,
      new URL('../' + encodeURIComponent('ฟอร์ม.xlsx'), location.href).href,
    ];
    return tplCandidates.reduce(function(p, url){
      return p.catch(function(){
        return fetch(url).then(function(r){ if (!r.ok) throw new Error(r.status+' @ '+url); return r.arrayBuffer(); });
      });
    }, Promise.reject(new Error('init')));
  }

  Promise.all([
    fetchTemplate().catch(function(err){
      var hint = location.protocol === 'file:' ? ' · ลองเปิดผ่าน Hub (index.html) แทนการ double-click ไฟล์ HTML' : '';
      throw new Error('โหลด template form.xlsx ไม่ได้: ' + err.message + hint);
    }),
    fetch(SCRIPT_URL + '?action=requests').then(function(r){ return r.json(); }).catch(function(err){ throw new Error('โหลดรายชื่อจาก Cloud ไม่ได้: ' + err.message); })
  ])
  .then(function(results){
    var ab = results[0];
    var reqs = (results[1] && results[1].records) || [];
    if (reqs.length === 0) throw new Error('ยังไม่มีรายชื่อให้ส่งออก');

    // Group by course + timeSlot — normalize เป็น canonical (เหมือนใน PDF export)
    var groups = {};
    reqs.forEach(function(r){
      var cRaw = r.course || r['หลักสูตร'] || '';
      var sRaw = r.timeSlot || r['รอบ'] || '';
      var trainDate = r.trainDate || r['วันอบรม'] || '';
      // canonical course
      var schForG = _findCourseSchedule_(cRaw);
      var course = cRaw;
      if (schForG) {
        var sKeys = Object.keys(COURSE_SCHEDULES);
        for (var ki = 0; ki < sKeys.length; ki++) {
          if (COURSE_SCHEDULES[sKeys[ki]] === schForG) { course = sKeys[ki]; break; }
        }
      }
      var slot = String(sRaw).replace(/\s+/g, '').replace(/[–—~]/g, '-');
      var round = _recRound_(r);
      // คนละวัน/คนละรุ่น = คนละใบ แม้เวลาจะซ้ำกัน · วันที่ normalize ก่อน กันเขียนเต็ม/ย่อแล้วแตกใบ
      var key = course + '|' + slot + '|' + _normDateKey_(trainDate) + '|' + round;
      if (!groups[key]) groups[key] = { course: course, slot: slot, trainDate: trainDate, round: round, rows: [] };
      groups[key].rows.push(r);
    });

    var ROWS_PER_PAGE = 25;
    var DATA_START_ROW = 9; // template data rows: 9..33

    // Fill a single worksheet with header + 25 rows
    function fillWorksheet(ws, g, roundNum, fullDate, chunkRows) {
      // Replace dot-placeholders with values (no padding — keeps text length natural)
      function fillDots(addr, values) {
        var cell = ws.getCell(addr);
        if (!cell || cell.value == null) return;
        var i = 0;
        var v = (typeof cell.value === 'object' && cell.value.richText)
          ? cell.value.richText.map(function(rt){ return rt.text; }).join('')
          : String(cell.value);
        cell.value = v.replace(/\.{4,}/g, function(){
          var val = (values[i++] || '');
          return ' ' + String(val) + ' ';
        });
      }
      fillDots('A4', [g.course, roundNum]);
      fillDots('A5', [fullDate, fullDate]);
      // Remove "วิทยากร" segment (entire " วิทยากร :  ..." part)
      var a5 = ws.getCell('A5');
      if (a5 && typeof a5.value === 'string') {
        a5.value = a5.value.replace(/\s*วิทยากร\s*:\s*$/, '').trim();
      }
      fillDots('A6', [g.slot + ' น.']);

      // Adjust column widths (wider header area)
      try {
        ws.getColumn(1).width = 7;   // ลำดับ
        ws.getColumn(2).width = 13;  // รหัสพนักงาน
        ws.getColumn(3).width = 25;  // ชื่อ-นามสกุล
        ws.getColumn(4).width = 38;  // ตำแหน่ง (กว้างพอสำหรับชื่อตำแหน่งภาษาอังกฤษยาว)
        ws.getColumn(5).width = 15;  // เลขบัตร (13 หลัก)
        ws.getColumn(6).width = 22;  // สาขา
      } catch(e) {}
      // (logo size: แก้ที่ template โดยตรง — ExcelJS image resize ไม่เสถียร)

      // Fill ALL 25 ลำดับ rows (column A) — keep template style, just ensure value is set + centered
      for (var i = 0; i < ROWS_PER_PAGE; i++) {
        var rn = DATA_START_ROW + i;
        var aCell = ws.getCell('A' + rn);
        aCell.value = i + 1;
        try {
          aCell.alignment = Object.assign({}, aCell.alignment || {}, { horizontal: 'center', vertical: 'middle', wrapText: false });
        } catch(e) {}
      }

      // Fill data rows
      chunkRows.forEach(function(r, idx){
        var rowNum = DATA_START_ROW + idx;
        if (rowNum > DATA_START_ROW + ROWS_PER_PAGE - 1) return;
        var name = r.name || r['ชื่อ-นามสกุล'] || r['ชื่อ'] || '';
        var pos = r.position || r['ตำแหน่ง'] || '';
        var idCard = r.idCard || r['เลขบัตรประชาชน'] || r['เลขบัตร'] || '';
        var branch = r.branch || r['สาขา'] || '';
        var empId = r.empId || r['รหัสพนักงาน'] || '';
        ws.getCell('B' + rowNum).value = String(empId);
        ws.getCell('C' + rowNum).value = name;
        ws.getCell('D' + rowNum).value = pos;
        ws.getCell('E' + rowNum).value = String(idCard);
        ws.getCell('F' + rowNum).value = branch;
        // ตัวหนังสือทุกเซลล์ขนาดเท่ากัน (UNIFORM_FONT) — ไม่ย่อตามความยาวข้อความ
        var UNIFORM_FONT = 11;
        ['B','C','D','E','F'].forEach(function(col){
          try {
            var cell = ws.getCell(col + rowNum);
            cell.font = Object.assign({}, cell.font || {}, { size: UNIFORM_FONT });
            cell.alignment = Object.assign({}, cell.alignment || {}, { vertical: 'middle', wrapText: false, shrinkToFit: false });
          } catch(e) {}
        });
      });
    }

    // Build ONE Excel file with multiple sheets (one sheet per session-page)
    var keys = Object.keys(groups);
    var outWb = new ExcelJS.Workbook();
    var firstLoad = true;

    function copyTemplateSheetInto(targetWb, sheetName) {
      // Load template fresh into a temp workbook, then copy the only sheet into targetWb
      var tmpWb = new ExcelJS.Workbook();
      return tmpWb.xlsx.load(ab).then(function(){
        var src = tmpWb.worksheets[0];
        var dst = targetWb.addWorksheet(sheetName, {
          properties: src.properties,
          pageSetup: src.pageSetup
        });
        // Columns
        if (src.columns) src.columns.forEach(function(col, ci){
          if (col && col.width) dst.getColumn(ci+1).width = col.width;
        });
        // Rows + cells with styles
        src.eachRow({ includeEmpty: true }, function(row, rn){
          var dr = dst.getRow(rn);
          if (row.height) dr.height = row.height;
          row.eachCell({ includeEmpty: true }, function(cell, cn){
            var dc = dr.getCell(cn);
            dc.value = cell.value;
            if (cell.style) dc.style = JSON.parse(JSON.stringify(cell.style));
          });
        });
        // Merges
        if (src.model && src.model.merges) {
          src.model.merges.forEach(function(rng){
            try { dst.mergeCells(rng); } catch(e){}
          });
        }
        // Images (logo) — safer: catch individual image errors
        try {
          var imgs = src.getImages();
          imgs.forEach(function(img){
            try {
              var imgData = tmpWb.getImage(img.imageId);
              if (imgData && img.range) {
                var newImgId = targetWb.addImage({ buffer: imgData.buffer, extension: imgData.extension });
                // Use string range if possible (more reliable)
                var rng = img.range;
                if (typeof rng === 'object' && rng.tl && rng.br) {
                  // Convert {tl, br} to {tl, br} format ExcelJS expects (col/row 0-based)
                  dst.addImage(newImgId, { tl: rng.tl, br: rng.br });
                } else {
                  dst.addImage(newImgId, rng);
                }
              }
            } catch(imgErr) { console.warn('Skip image:', imgErr); }
          });
        } catch(e){ console.warn('Images copy failed:', e); }
        return dst;
      });
    }

    var _usedSheetNames = {};
    function safeSheetName(s){
      var base = String(s).replace(/[\\\/:\*\?\[\]]/g, '').slice(0, 31) || 'Sheet';
      // คนละวัน/คนละรุ่นอาจได้ชื่อชนกัน — ExcelJS ห้ามชื่อซ้ำ ต่อท้ายเลขให้
      var name = base, n = 2;
      while (_usedSheetNames[name]) {
        var suf = ' (' + n + ')';
        name = base.slice(0, 31 - suf.length) + suf;
        n++;
      }
      _usedSheetNames[name] = true;
      return name;
    }

    function processSheet(idx) {
      // idx points to a flat list of (group, page) tuples
      var tuples = [];
      keys.forEach(function(k){
        var g = groups[k];
        var pages = Math.ceil(g.rows.length / ROWS_PER_PAGE) || 1;
        for (var p = 0; p < pages; p++) tuples.push({ g: g, page: p, pages: pages });
      });
      if (idx >= tuples.length) {
        // All sheets added — write file
        outWb.xlsx.writeBuffer().then(function(buf){
          if (window._exportSafetyTimer) { clearTimeout(window._exportSafetyTimer); window._exportSafetyTimer = null; }
          var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          var _dnow = new Date();
          var _pad2 = function(n){ return String(n).padStart(2,'0'); };
          var filename = 'ฟอร์มอบรม_' + _dnow.toISOString().slice(0,10)
            + '_' + _pad2(_dnow.getHours()) + _pad2(_dnow.getMinutes()) + _pad2(_dnow.getSeconds()) + '.xlsx';
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '✓ ส่งออกสำเร็จ';
            setTimeout(function(){ if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig; }, 2500);
          }
        }).catch(function(err){
          if (window._exportSafetyTimer) { clearTimeout(window._exportSafetyTimer); window._exportSafetyTimer = null; }
          if (btn) { btn.disabled = false; if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig; }
          customConfirm({ icon:ICON_WARN, title:'เขียนไฟล์ Excel ไม่สำเร็จ', desc:escapeHtml(String(err.message||err)), okText:'ปิด', okIsPrimary:true, hideCancel:true });
        });
        return;
      }
      var t = tuples[idx];
      var g = t.g;
      var sch = _findCourseSchedule_(g.course);
      // Use group index for round
      // ยึดรุ่น/วันที่ที่ติดมากับรายชื่อ — ไม่ดึงจากตารางอบรมปัจจุบัน · ไม่รู้รุ่นจริงก็เว้นว่างไว้
      var roundNum = g.round || '';
      var fullDate = _formDate_(g.trainDate, sch);
      var chunk = g.rows.slice(t.page * ROWS_PER_PAGE, (t.page + 1) * ROWS_PER_PAGE);

      var courseShort = (g.course.indexOf('ผู้สัมผัส') >= 0) ? 'ผู้สัมผัส'
                      : (g.course.indexOf('ผู้ประกอบ') >= 0) ? 'ผู้ประกอบ'
                      : g.course.slice(0, 10);
      var roundTag = String(roundNum || '').replace(/\//g, '-');
      var sheetName = safeSheetName(courseShort + ' ' + g.slot + (roundTag ? ' ร.' + roundTag : '') + (t.pages > 1 ? ' หน้า' + (t.page + 1) : ''));

      copyTemplateSheetInto(outWb, sheetName).then(function(ws){
        fillWorksheet(ws, g, roundNum, fullDate, chunk);
        processSheet(idx + 1);
      }).catch(function(err){
        if (window._exportSafetyTimer) { clearTimeout(window._exportSafetyTimer); window._exportSafetyTimer = null; }
        if (btn) { btn.disabled = false; if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig; }
        customConfirm({ icon:ICON_WARN, title:'สร้าง sheet ไม่สำเร็จ', desc:escapeHtml(String(err.message||err)), okText:'ปิด', okIsPrimary:true, hideCancel:true });
      });
    }

    processSheet(0);
  })
  .catch(function(err){
    if (window._exportSafetyTimer) { clearTimeout(window._exportSafetyTimer); window._exportSafetyTimer = null; }
    if (btn) { btn.disabled = false; if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig; }
    customConfirm({ icon:ICON_WARN, title:'Export ผิดพลาด', desc:escapeHtml(String(err.message||err)), okText:'ปิด', okIsPrimary:true, hideCancel:true });
  });
}

/* Reveal step 2 (form) — called when user clicks the CTA in step 1 */
/* Back to step 1 from step 2 */
function backToStep1() {
  showBrSection('adm-sec-br-search');
  // Swap topbar back buttons
  var tm = document.getElementById('topMenuBtn'); if (tm) tm.style.display = '';
  var tb = document.getElementById('topBackToStep1Btn'); if (tb) tb.style.display = 'none';
  var mtbBack = document.getElementById('mtbBack'); if (mtbBack) mtbBack.style.display = '';
  var mtbStep1 = document.getElementById('mtbBackStep1'); if (mtbStep1) mtbStep1.style.display = 'none';
  setTimeout(function(){ window.scrollTo({ top: 0, behavior: 'smooth' }); }, 40);
  if (typeof updateStepper === 'function') updateStepper();
}

/* Helper: หา schedule จาก course (รองรับ substring + unique-part match) */
function _findCourseSchedule_(course) {
  if (!course || typeof COURSE_SCHEDULES === 'undefined') return null;
  var keys = Object.keys(COURSE_SCHEDULES);
  keys.sort(function(a,b){ return b.length - a.length; });
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (course === key || String(course).indexOf(key) >= 0) return COURSE_SCHEDULES[key];
    var uniq = key.replace(/^การสุขาภิบาลอาหาร\s*สำหรับ\s*/, '').trim();
    if (uniq && String(course).indexOf(uniq) >= 0) return COURSE_SCHEDULES[key];
  }
  return null;
}
/* Helper: หา roundNum จาก slot (normalize ช่องว่าง/dash) */
function _findRoundForSlot_(sch, slot) {
  if (!sch || !sch.rounds || !slot) return '';
  // Try exact first
  if (sch.rounds[slot]) return sch.rounds[slot];
  // Normalize: strip whitespace, normalize dashes
  var norm = function(s){ return String(s).replace(/\s+/g, '').replace(/[–—~]/g, '-'); };
  var slotN = norm(slot);
  var keys = Object.keys(sch.rounds);
  for (var i = 0; i < keys.length; i++) {
    if (norm(keys[i]) === slotN) return sch.rounds[keys[i]];
  }
  return '';
}
/* รุ่น/วันอบรม "ณ ตอนนี้" จากตารางอบรมปัจจุบัน — ใช้ตอนบันทึกเรคคอร์ดใหม่เท่านั้น (snapshot) */
function _roundNowFor_(course, slot) {
  return _findRoundForSlot_(_findCourseSchedule_(course), slot) || '';
}
function _dateNowFor_(course) {
  var sch = _findCourseSchedule_(course);
  return (sch && sch.date) || '';
}
/* รุ่นของเรคคอร์ด: ยึดค่าที่บันทึกไว้ตอนส่งเป็นหลัก
   เรคคอร์ดเก่า (ก่อนมีคอลัมน์ round) — เดาจากตารางปัจจุบันได้เฉพาะตอน "วันอบรมยังตรงกับตารางปัจจุบัน"
   ถ้าวันไม่ตรงแล้ว = คนละรอบอบรม → คืนค่าว่าง ดีกว่าไปหยิบรุ่นใหม่มาแปะทับของเก่า */
function _recRound_(r) {
  if (!r) return '';
  var saved = _fhRoundText_(r.round || r['รุ่น'] || r['รุ่นที่'] || '');
  if (saved) return saved;
  var sch = _findCourseSchedule_(r.course || r['หลักสูตร'] || '');
  return _roundIfSameDay_(sch, r.trainDate || r['วันอบรม'] || '', r.timeSlot || r['รอบ'] || '');
}
function _roundIfSameDay_(sch, trainDate, slot) {
  if (!sch) return '';
  var recD = String(trainDate == null ? '' : trainDate).trim();
  var schD = String(sch.date || '').trim();
  if (recD && schD && recD !== schD) return '';
  return _findRoundForSlot_(sch, slot) || '';
}
/* วันอบรมสำหรับใบทะเบียน: ใช้วันที่ติดมากับรายชื่อ (เป็นข้อความไทยเต็มอยู่แล้ว) — ว่างค่อยถอยไปใช้ตารางปัจจุบัน */
function _formDate_(trainDate, sch) {
  var d = String(trainDate == null ? '' : trainDate).trim();
  if (!d || d === '—') return (sch && sch.date) || '';
  if (/[ก-๙]/.test(d)) return d;                        // ไทยอยู่แล้ว → ใช้ตามนั้น
  var f = formatThaiDate(d);
  return (f && f !== '—') ? f : ((sch && sch.date) || '');
}

/* Course schedules — date + time slots + รุ่นที่ tied to each session */
var COURSE_SCHEDULES = {
  'การสุขาภิบาลอาหาร สำหรับผู้สัมผัสอาหาร': {
    date: '10 มิถุนายน 2569',
    dateShort: '10 มิ.ย. 2569',
    slots: ['9.00-13.00', '13.00-17.00'],
    rounds: { '9.00-13.00': '2/2569', '13.00-17.00': '3/2569' }
  },
  'การสุขาภิบาลอาหาร สำหรับผู้ประกอบกิจการ': {
    date: '12 มิถุนายน 2569',
    dateShort: '12 มิ.ย. 2569',
    slots: ['12.30-17.30'],
    rounds: { '12.30-17.30': '2/2569' }
  }
};
var COURSE_OPTIONS = Object.keys(COURSE_SCHEDULES);

// ── Admin: ตัวแก้ตารางอบรม (บันทึกลง fhConfig → sync ทุกสาขา) ──
function _fhEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fhSetTab(name){
  var wrap = document.getElementById('adm-sec-settings'); if(!wrap) return;
  wrap.querySelectorAll('.fh-tab').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-tab')===name); });
  wrap.querySelectorAll('.fh-tabpanel').forEach(function(p){ p.classList.toggle('active', p.id==='fhTab-'+name); });
}
// วันที่ไทย: ISO (ค.ศ.) ⇄ ข้อความไทย (พ.ศ.)
var FH_TH_MON = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
var FH_TH_MON_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function _fhIsoToThai(iso, short){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso).trim());
  if (!m) return '';
  var mi = parseInt(m[2], 10) - 1;
  if (!(mi >= 0 && mi <= 11)) return '';
  return parseInt(m[3], 10) + ' ' + (short ? FH_TH_MON_SHORT[mi] : FH_TH_MON[mi]) + ' ' + (parseInt(m[1], 10) + 543);
}
function _fhToIso(s){
  var d = null;
  try { d = (typeof parseAnyDate === 'function') ? parseAnyDate(s) : null; } catch (e) {}
  if (!d || isNaN(d.getTime())) return '';
  var p = function(n){ return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function renderFhScheduleEditor() {
  var box = document.getElementById('fhScheduleEditor'); if (!box) return;
  var sch = (typeof COURSE_SCHEDULES !== 'undefined') ? COURSE_SCHEDULES : {};
  var courses = Object.keys(sch);
  var html = courses.map(function(cname){
    var c = sch[cname] || {};
    var slots = Array.isArray(c.slots) ? c.slots : [];
    var rounds = c.rounds || {};
    var iso = _fhToIso(c.dateISO || '') || _fhToIso(c.date || '');
    var slotRows = slots.map(function(s, i){
      return _fhSlotRowHtml(s, rounds[s] || '', i + 1);
    }).join('') || _fhSlotEmptyHtml();
    return '<div class="section-card fh-course-block" data-cname="'+_fhEsc(cname)+'"'
      + ' data-olddate="'+_fhEsc(c.date||'')+'" data-oldshort="'+_fhEsc(c.dateShort||'')+'"'
      + ' style="padding:18px 20px;margin:0;">'
      + '<div class="fh-card-h"><span class="cico">📚</span><span style="min-width:0;">'+_fhEsc(cname)+'</span>'
      +   '<span class="fh-chip">'+(slots.length ? slots.length + ' รอบ' : 'ยังไม่มีรอบ')+'</span></div>'
      + '<label>วันที่อบรม</label>'
      + '<input type="date" class="form-input fh-date" value="'+_fhEsc(iso)+'" onchange="_fhOnDateChange(this)" oninput="_fhOnDateChange(this)">'
      + '<div class="fh-date-prev">'+_fhDatePrevHtml(iso)+'</div>'
      + '<div class="fh-sec-label"><span>รอบเวลา + รุ่น</span></div>'
      + '<div class="fh-slots">'+slotRows+'</div>'
      + '<button type="button" class="btn-add" onclick="_fhAddSlot(this)"><svg class="ico"><use href="#i-plus"/></svg> เพิ่มรอบเวลา</button>'
      + '</div>';
  }).join('');
  box.innerHTML = '<div class="fh-grid2">' + html + '</div>'
    + '<div class="fh-save-row">'
    +   '<div class="fh-save-hint">ตารางนี้ใช้ร่วมกันทุกสาขา — กดบันทึกแล้วมีผลทันที</div>'
    +   '<button type="button" class="btn-submit" onclick="saveFhSchedules()"><svg class="ico"><use href="#i-send"/></svg> บันทึกตารางอบรม</button>'
    + '</div>';
}
function _fhDatePrevHtml(iso){
  var full = _fhIsoToThai(iso, false);
  if (!full) return '<span class="muted">ยังไม่ได้เลือกวันที่อบรม</span>';
  return '<span>📅 '+_fhEsc(full)+'</span><span>ย่อ: '+_fhEsc(_fhIsoToThai(iso, true))+'</span>';
}
function _fhOnDateChange(inp){
  var block = inp.closest('.fh-course-block'); if (!block) return;
  var prev = block.querySelector('.fh-date-prev');
  if (prev) prev.innerHTML = _fhDatePrevHtml(inp.value || '');
}
function _fhSlotEmptyHtml(){
  return '<div class="fh-slot-empty">ยังไม่มีรอบเวลา — กด “เพิ่มรอบเวลา” ด้านล่าง</div>';
}
function _fhSlotRowHtml(time, round, n){
  return '<div class="fh-slot-row">'
    + '<span class="fh-slot-n">'+(n || 1)+'</span>'
    + '<input class="form-input fh-slot-time" value="'+_fhEsc(time)+'" placeholder="เวลา เช่น 09.00-12.00">'
    + '<input class="form-input fh-slot-round" value="'+_fhEsc(round)+'" placeholder="รุ่น เช่น 2/2569">'
    + '<button type="button" class="fh-slot-del" onclick="_fhDelSlot(this)" title="ลบรอบนี้">✕</button>'
    + '</div>';
}
// เรียงเลขรอบใหม่ + อัปเดตป้ายจำนวน/ข้อความว่าง
function _fhRefreshSlots(block){
  if (!block) return;
  var wrap = block.querySelector('.fh-slots'); if (!wrap) return;
  var rows = wrap.querySelectorAll('.fh-slot-row');
  rows.forEach(function(r, i){ var n = r.querySelector('.fh-slot-n'); if (n) n.textContent = i + 1; });
  var empty = wrap.querySelector('.fh-slot-empty');
  if (rows.length && empty) empty.remove();
  if (!rows.length && !empty) wrap.insertAdjacentHTML('beforeend', _fhSlotEmptyHtml());
  var chip = block.querySelector('.fh-chip');
  if (chip) chip.textContent = rows.length ? rows.length + ' รอบ' : 'ยังไม่มีรอบ';
}
function _fhAddSlot(btn){
  var block = btn.closest('.fh-course-block'); if (!block) return;
  var wrap = block.querySelector('.fh-slots'); if (!wrap) return;
  var empty = wrap.querySelector('.fh-slot-empty'); if (empty) empty.remove();
  wrap.insertAdjacentHTML('beforeend', _fhSlotRowHtml('', '', wrap.querySelectorAll('.fh-slot-row').length + 1));
  _fhRefreshSlots(block);
  var last = wrap.querySelectorAll('.fh-slot-row .fh-slot-time');
  if (last.length) last[last.length - 1].focus();
}
function _fhDelSlot(btn){
  var block = btn.closest('.fh-course-block');
  var row = btn.closest('.fh-slot-row'); if (row) row.remove();
  _fhRefreshSlots(block);
}
function saveFhSchedules(){
  var blocks = document.querySelectorAll('#fhScheduleEditor .fh-course-block');
  var out = {}, missingDate = [];
  blocks.forEach(function(b){
    var cname = b.getAttribute('data-cname'); if (!cname) return;
    var iso = ((b.querySelector('.fh-date')||{}).value || '').trim();
    // เลือกจากปฏิทิน → สร้างข้อความไทยให้เอง · ไม่ได้เลือก → คงค่าเดิมไว้
    var date = iso ? _fhIsoToThai(iso, false) : (b.getAttribute('data-olddate') || '');
    var dateShort = iso ? _fhIsoToThai(iso, true) : (b.getAttribute('data-oldshort') || '');
    var slots = [], rounds = {};
    b.querySelectorAll('.fh-slot-row').forEach(function(r){
      var t = ((r.querySelector('.fh-slot-time')||{}).value || '').trim();
      var rd = ((r.querySelector('.fh-slot-round')||{}).value || '').trim();
      if (!t) return;
      slots.push(t); if (rd) rounds[t] = rd;
    });
    if (slots.length && !date) missingDate.push(cname);
    out[cname] = { date: date.trim(), dateShort: dateShort.trim(), dateISO: iso, slots: slots, rounds: rounds };
  });
  if (missingDate.length) {
    showInfo('⚠️ ยังไม่ได้เลือกวันที่', 'หลักสูตรนี้มีรอบเวลาแล้วแต่ยังไม่ได้เลือกวันที่อบรม<br><b>' + missingDate.map(escapeHtml).join('<br>') + '</b>');
    return;
  }
  saveFhConfig({ schedules: out })
    .then(function(){ showInfo('✓ บันทึกแล้ว', 'บันทึกตารางอบรมแล้ว — สาขาจะเห็นตารางใหม่ทันที'); })
    .catch(function(e){ showInfo('✗ บันทึกไม่สำเร็จ', escapeHtml(e && e.message ? e.message : String(e))); });
}

// ── Admin: เพิ่มแบรนด์/สาขา (บันทึกลง fhConfig) ──
function _fhBrandRowHtml(prefix, label){
  return '<div class="fh-brand-row" style="display:flex;gap:8px;margin-top:8px;align-items:center;">'
    + '<input class="form-input fh-brand-prefix" value="'+_fhEsc(prefix)+'" placeholder="รหัสนำหน้า เช่น 60" style="width:150px;margin:0;">'
    + '<input class="form-input fh-brand-label" value="'+_fhEsc(label)+'" placeholder="ชื่อแบรนด์ เช่น แบรนด์ใหม่" style="flex:1;margin:0;">'
    + '<button type="button" onclick="this.closest(\'.fh-brand-row\').remove()" title="ลบ" style="flex:none;width:34px;height:34px;border:1px solid #FCA5A5;background:#FEF2F2;color:#dc2626;border-radius:8px;cursor:pointer;font-weight:800;">✕</button>'
    + '</div>';
}
function _fhBranchRowHtml(code, name){
  return '<div class="fh-branch-row" style="display:flex;gap:8px;margin-top:8px;align-items:center;">'
    + '<input class="form-input fh-branch-code" value="'+_fhEsc(code)+'" placeholder="รหัสสาขา เช่น 6001" style="width:150px;margin:0;">'
    + '<input class="form-input fh-branch-name" value="'+_fhEsc(name)+'" placeholder="ชื่อสาขา" style="flex:1;margin:0;">'
    + '<button type="button" onclick="this.closest(\'.fh-branch-row\').remove()" title="ลบ" style="flex:none;width:34px;height:34px;border:1px solid #FCA5A5;background:#FEF2F2;color:#dc2626;border-radius:8px;cursor:pointer;font-weight:800;">✕</button>'
    + '</div>';
}
function renderFhBrandBranchEditor(){
  var box = document.getElementById('fhBrandBranchEditor'); if (!box) return;
  var brands = Array.isArray(FH_CONFIG.brands) ? FH_CONFIG.brands : [];
  var branches = Array.isArray(FH_CONFIG.branches) ? FH_CONFIG.branches : [];
  var brandRows = brands.map(function(b){ return _fhBrandRowHtml((b&&b.prefix)||'', (b&&b.label)||''); }).join('');
  var branchRows = branches.map(function(b){ return _fhBranchRowHtml((b&&b.code)||'', (b&&b.name)||''); }).join('');
  box.innerHTML =
    '<div class="fh-grid2">'
    + '<div class="section-card" style="padding:18px 20px;margin:0;">'
    +   '<div class="fh-card-h"><span class="cico">🏷️</span><span>แบรนด์</span></div>'
    +   '<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px;line-height:1.5;">รหัสนำหน้า = ตัวเลขต้นรหัสสาขา (เช่น 60 → สาขา 60xx เป็นแบรนด์นี้)</div>'
    +   '<div id="fhBrandRows">' + brandRows + '</div>'
    +   '<button type="button" class="btn-add" onclick="_fhAddBrandRow()" style="margin-top:10px;"><svg class="ico"><use href="#i-plus"/></svg> เพิ่มแบรนด์</button>'
    + '</div>'
    + '<div class="section-card" style="padding:18px 20px;margin:0;">'
    +   '<div class="fh-card-h"><span class="cico">🏪</span><span>สาขา</span></div>'
    +   '<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px;line-height:1.5;">แบรนด์ของสาขาดูจากรหัสนำหน้าอัตโนมัติ</div>'
    +   '<div id="fhBranchRows">' + branchRows + '</div>'
    +   '<button type="button" class="btn-add" onclick="_fhAddBranchRow()" style="margin-top:10px;"><svg class="ico"><use href="#i-plus"/></svg> เพิ่มสาขา</button>'
    + '</div>'
    + '</div>'
    + '<div class="fh-save-row"><button type="button" class="btn-submit" onclick="saveFhBrandBranch()"><svg class="ico"><use href="#i-send"/></svg> บันทึกแบรนด์/สาขา</button></div>';
}
function _fhAddBrandRow(){ var c=document.getElementById('fhBrandRows'); if(c) c.insertAdjacentHTML('beforeend', _fhBrandRowHtml('','')); }
function _fhAddBranchRow(){ var c=document.getElementById('fhBranchRows'); if(c) c.insertAdjacentHTML('beforeend', _fhBranchRowHtml('','')); }
function saveFhBrandBranch(){
  var brands = [];
  document.querySelectorAll('#fhBrandRows .fh-brand-row').forEach(function(r){
    var p = ((r.querySelector('.fh-brand-prefix')||{}).value||'').trim();
    var l = ((r.querySelector('.fh-brand-label')||{}).value||'').trim();
    if (p && l) brands.push({ prefix: p, label: l });
  });
  var branches = [];
  document.querySelectorAll('#fhBranchRows .fh-branch-row').forEach(function(r){
    var code = ((r.querySelector('.fh-branch-code')||{}).value||'').trim();
    var name = ((r.querySelector('.fh-branch-name')||{}).value||'').trim();
    if (code && name) branches.push({ code: code, name: name });
  });
  saveFhConfig({ brands: brands, branches: branches })
    .then(function(){ showInfo('✓ บันทึกแล้ว', 'บันทึกแบรนด์/สาขาแล้ว — สาขาใหม่ใช้ได้ทันที'); })
    .catch(function(e){ showInfo('✗ บันทึกไม่สำเร็จ', escapeHtml(e && e.message ? e.message : String(e))); });
}

function rerenderRequestList() {
  var list = document.getElementById('requestList');
  list.innerHTML = requestRows.map(function(r, i){
    // Custom dropdowns: course + slot
    var sch = COURSE_SCHEDULES[r.course] || null;
    var courseDdHtml = '<div class="dd-wrap" id="ddCourse-'+i+'">'
      + '<button type="button" class="dd-trigger" onclick="toggleDd(\'ddCourse-'+i+'\', event)">'
      + '<span class="dd-value">'+(r.course ? escapeHtml(r.course) : '<span class="dd-placeholder">เลือกหลักสูตร...</span>')+'</span>'
      + '<span class="dd-caret">▾</span>'
      + '</button>'
      + '<div class="dd-list">'
      + COURSE_OPTIONS.map(function(c){
          var sel = c === r.course;
          return '<div class="dd-item'+(sel?' selected':'')+'" onmousedown="pickCourse('+i+',\''+escapeAttr(c)+'\')">'
            + '<div class="dd-item-title">'+escapeHtml(c)+'</div>'
            + '</div>';
        }).join('')
      + '</div></div>';

    var slotDdHtml = '';
    if (sch) {
      slotDdHtml = '<div class="dd-wrap" id="ddSlot-'+i+'">'
        + '<button type="button" class="dd-trigger" onclick="toggleDd(\'ddSlot-'+i+'\', event)">'
        + '<span class="dd-value">'+(r.timeSlot ? '🕐 '+r.timeSlot+' น.' : '<span class="dd-placeholder">เลือกรอบ...</span>')+'</span>'
        + '<span class="dd-caret">▾</span>'
        + '</button>'
        + '<div class="dd-list">'
        + sch.slots.map(function(t){
            var sel = t === r.timeSlot;
            return '<div class="dd-item'+(sel?' selected':'')+'" onmousedown="pickSlot('+i+',\''+t+'\')">'
              + '<div class="dd-item-title">🕐 '+t+' น.</div>'
              + '</div>';
          }).join('')
        + '</div></div>';
    } else {
      slotDdHtml = '<div class="picker-date-box" style="color:var(--text3);font-weight:500;">เลือกหลักสูตรก่อน</div>';
    }

    var dateBoxHtml = sch
      ? '<div class="picker-date-box">📅 '+escapeHtml(sch.dateShort)+'</div>'
      : '<div class="picker-date-box" style="color:var(--text3);font-weight:500;">เลือกหลักสูตรก่อน</div>';
    return '<div class="req-card">'
      + '<div class="req-card-head">'
      +   '<span class="req-card-num">พนักงานคนที่ '+(i+1)+'</span>'
      +   (requestRows.length > 1 ? '<button class="btn-rm-card" onclick="removeReqRow('+i+')">🗑 ลบรายการนี้</button>' : '')
      + '</div>'
      + '<div class="req-grid">'
      +   '<div class="req-field">'
      +     '<label>ชื่อ-นามสกุล <span class="req-mark">*</span></label>'
      +     '<div class="combo-wrap" id="combo-'+i+'">'
      +       '<input class="combo-input" type="text" autocomplete="off" value="'+escapeAttr(r.name)+'" placeholder="คลิกเพื่อเลือก หรือพิมพ์ชื่อใหม่" '
      +         'oninput="onComboInput(event,'+i+')" '
      +         'onfocus="openCombo('+i+')" '
      +         'onkeydown="onComboKey(event,'+i+')">'
      +       '<button type="button" class="combo-toggle" onclick="toggleCombo('+i+', this)">▾</button>'
      +       '<div class="combo-list" id="comboList-'+i+'" style="display:none"></div>'
      +     '</div>'
      +     '<div class="req-hint neutral" id="reqHint-'+i+'"></div>'
      +   '</div>'
      +   '<div class="req-field">'
      +     '<label>รหัสพนักงาน <span class="req-mark">*</span></label>'
      +     '<input type="text" value="'+escapeAttr(r.empId||'')+'" placeholder="ใส่รหัสพนักงาน" oninput="updateReqRow('+i+',\'empId\',this.value)">'
      +   '</div>'
      +   '<div class="req-field">'
      +     '<label>เลขบัตรประชาชน <span class="req-mark">*</span></label>'
      +     '<input type="text" maxlength="13" inputmode="numeric" value="'+escapeAttr(r.idCard||'')+'" placeholder="13 หลัก" oninput="updateIdCard(this,'+i+')">'
      +     '<div class="req-hint neutral" id="reqIdHint-'+i+'"></div>'
      +   '</div>'
      +   '<div class="req-field">'
      +     '<label>ตำแหน่ง <span class="req-mark">*</span></label>'
      /* เลือกจากรายการตำแหน่งมาตรฐาน แทนการพิมพ์เอง
         พิมพ์เองแล้วสะกดไม่ตรงกัน จะทำให้รายงานแยกตำแหน่งเดียวกันเป็นหลายอัน
         (ปัญหาเดียวกับชื่อสาขาที่เคยเจอในทะเบียน)
         คนที่อยู่ในทะเบียนจะถูกเติมตำแหน่งให้อัตโนมัติตอนเลือกชื่อ */
      +     _fhPosSelectHtml(i, r.position)
      +   '</div>'
      +   '<div class="req-field">'
      +     '<label>หลักสูตร <span class="req-mark">*</span></label>'
      +     courseDdHtml
      +   '</div>'
      +   '<div class="req-field">'
      +     '<label>วันอบรม</label>'
      +     dateBoxHtml
      +   '</div>'
      +   '<div class="req-field">'
      +     '<label>รอบอบรม <span class="req-mark">*</span></label>'
      +     slotDdHtml
      +   '</div>'
      +   '<div class="req-field">'
      +     '<label>หมายเหตุ</label>'
      +     '<input value="'+escapeAttr(r.note)+'" placeholder="(ถ้ามี)" oninput="updateReqRow('+i+',\'note\',this.value)">'
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join('');
  // Re-run cert check for existing rows on render
  requestRows.forEach(function(r, i){ if (r.name) onReqNameChange(i); });
  if (typeof updateStepper === 'function') updateStepper();
  try { _fhSyncSubmitBtn(); } catch (e) {}
}
