/* fh-registry.js — ทะเบียนพนักงาน · ตรวจซ้ำ · ซิงค์คลาวด์ · ตารางใบรับรอง
   แยกมาจาก food-handler.js (บรรทัดเดิม 1336-1973)
   ⚠️ ไฟล์ชุดนี้ต้องโหลดตามลำดับใน food-handler.html — อย่าสลับ */
/* ─────────── EMPLOYEE REGISTRY CLOUD ─────────── */
/* ทะเบียนรายชื่อถูกอ่านจาก Supabase (fhLoadEmployees) แต่เดิมเขียนกลับไป Apps Script
   อย่างเดียว ลบ/นำเข้าจึงไม่มีผลกับข้อมูลที่หน้าจอใช้จริง — ต้องเขียนที่เดียวกับที่อ่าน */
function saveEmployeeRegistryToCloud(employees, replaceAll) {
  if (typeof fhSaveEmployees === 'function') {
    return fhSaveEmployees(employees, replaceAll).then(function(res){
      if (res && res.ok === false) throw new Error(res.error || 'บันทึกทะเบียนไม่สำเร็จ');
      return res;
    });
  }
  if (!SCRIPT_URL) return Promise.reject(new Error('SCRIPT_URL ไม่ตั้งค่า'));
  return fetch(SCRIPT_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'save-employees', records: employees, replaceAll: !!replaceAll })
  })
  .then(function(r){ return r.json(); })
  .then(function(res){
    if (!res || !res.ok) throw new Error((res && res.error) || 'save-employees failed');
    return res;
  });
}


/* ═══════════════════════════════════════════════════════════════
   อัปทะเบียนพนักงาน — รวมกับของเดิม ไม่ใช่ล้างทิ้งแล้วเขียนใหม่
   ของเดิมล้างทั้งชีตทุกครั้งที่อัป · อัปไฟล์ผิดช่องครั้งเดียว ทะเบียนทั้งหมดหายทันที
   (เกิดขึ้นจริง: มีคนอัปไฟล์ใบรับรองเข้าช่องทะเบียน เหลือ 142 แถวที่อ่านคอลัมน์ผิด
    ชื่อคนกลายเป็นชื่อหลักสูตร รหัสพนักงานกลายเป็นคำว่า "ผ่าน")
   และการอัปแยกไฟล์คนละครั้งก็ทับกันเองด้วย ต้องอัปพร้อมกันทีเดียวเท่านั้น
   ═══════════════════════════════════════════════════════════════ */
/* กุญแจระบุตัวคน — ไล่จากตัวที่อยู่ทนที่สุดลงมา
   รหัสพนักงานเปลี่ยนยากสุด · เลขบัตรไม่เปลี่ยนเลยแต่บางไฟล์ไม่มี · ชื่อเป็นทางสุดท้าย */
function _fhEmpKey(e) {
  var id = String((e && e.empId) || '').trim();
  if (id) return 'id:' + id;
  var ic = String((e && e.idCard) || '').replace(/\D/g, '');
  if (ic) return 'ic:' + ic;
  return 'nm:' + String((e && (e.norm || e.name)) || '').replace(/\s+/g, '');
}
var _FH_EMP_FIELDS = ['name','norm','empId','idCard','branch','position','sheet'];

/* ด่านที่ 1 — ไฟล์นี้หน้าตาเป็นทะเบียนพนักงานจริงไหม
   คืนข้อความบอกเหตุถ้าดูแล้วไม่ใช่ · null = ผ่าน
   ตรวจจากรูปแบบข้อมูล ไม่ใช่ชื่อไฟล์ เพราะคนตั้งชื่อไฟล์ยังไงก็ได้ */
function fhRegistryFileLooksWrong(rows) {
  if (!rows || !rows.length) return 'ไม่พบข้อมูลในไฟล์';
  var n = rows.length;
  var course = rows.filter(function(e){ return /หลักสูตร|สุขาภิบาล/.test(String(e.name || '')); }).length;
  if (course > n * 0.3)
    return 'ช่อง "ชื่อ-นามสกุล" เป็นชื่อหลักสูตร ไม่ใช่ชื่อคน (' + course + ' จาก ' + n + ' แถว)<br>' +
           'ไฟล์นี้น่าจะเป็น<b>รายชื่อใบรับรอง</b> ไม่ใช่ทะเบียนพนักงาน';
  var ids = {}, nId = 0;
  rows.forEach(function(e){ var v = String(e.empId || '').trim(); if (v) { ids[v] = 1; nId++; } });
  var uniq = Object.keys(ids).length;
  if (n >= 20 && nId > n * 0.5 && uniq <= 2)
    return 'ช่อง "รหัสพนักงาน" มีค่าซ้ำกันเกือบทั้งไฟล์ (เหลือ ' + uniq + ' ค่า จาก ' + n + ' แถว)<br>' +
           'น่าจะอ่านคอลัมน์ผิดตำแหน่ง';
  if (n >= 20 && !rows.some(function(e){ return String(e.branch || '').trim(); }))
    return 'ทุกแถวไม่มีสาขาเลย (' + n + ' แถว)<br>น่าจะอ่านคอลัมน์ผิดตำแหน่ง หรือเป็นไฟล์คนละแบบ';
  return null;
}

/* รวมของใหม่เข้ากับของเดิม — คืนรายชื่อชุดใหม่พร้อมตัวเลขสรุป
   คนที่ไม่อยู่ในไฟล์ใหม่ "ไม่ลบ" แต่ทำเครื่องหมายไว้
   เพราะใบรับรองของเขายังอยู่ ลบคนออกเมื่อไร ใบนั้นกลายเป็นใบลอยทันที
   ถ้าเขากลับเข้ามาทำงานใหม่ อัปทะเบียนรอบหน้าจะปลดเครื่องหมายให้เอง */
function fhMergeRegistry(incoming) {
  var base = (typeof empData !== 'undefined' && empData) ? empData.slice() : [];
  var today = new Date().toISOString().slice(0, 10);
  var byKey = {}, byName = {}, out = [];
  base.forEach(function(e){
    var k = _fhEmpKey(e);
    if (byKey[k]) return;
    byKey[k] = e; out.push(e);
    /* ดัชนีสำรองด้วยชื่อ — ใช้เฉพาะแถวที่ยังไม่มีรหัสหรือเลขบัตร
       ทะเบียนที่กู้มาจากใบรับรองจะไม่มีรหัส พอไฟล์จริงที่มีรหัสเข้ามาทีหลัง
       กุญแจจะคนละตัวกัน คนเดียวกันเลยกลายเป็นสองแถว · ให้จับด้วยชื่อเป็นทางสำรอง */
    if (k.indexOf('nm:') === 0 && !byName[k]) byName[k] = e;
  });
  var added = 0, updated = 0, inNew = {};
  (incoming || []).forEach(function(e){
    var k = _fhEmpKey(e);
    inNew[k] = 1;
    var cur = byKey[k];
    if (!cur) {
      var nk = 'nm:' + String((e && (e.norm || e.name)) || '').replace(/\s+/g, '');
      if (byName[nk]) { cur = byName[nk]; inNew[_fhEmpKey(cur)] = 1; delete byName[nk]; }
    }
    if (cur) {
      /* ทับเฉพาะช่องที่ไฟล์ใหม่มีค่า — บางไฟล์ไม่มีบางคอลัมน์
         ทับทั้งดุ้นจะทำให้ข้อมูลที่เคยมีหายไปเพราะไฟล์รอบนี้ไม่มีคอลัมน์นั้น */
      _FH_EMP_FIELDS.forEach(function(f){
        if (e[f] != null && String(e[f]).trim() !== '') cur[f] = e[f];
      });
      cur.active = true; cur.seenAt = today; delete cur.goneAt;
      updated++;
    } else {
      e.active = true; e.seenAt = today;
      byKey[k] = e; out.push(e); added++;
    }
  });
  var gone = 0;
  out.forEach(function(e){
    if (inNew[_fhEmpKey(e)]) return;
    if (e.active === false) { gone++; return; }        // เคยหายไปตั้งแต่รอบก่อน
    e.active = false; e.goneAt = today; gone++;
  });
  return { list: out, added: added, updated: updated, gone: gone, kept: out.length };
}

/* ทางเข้าเดียวของการอัปทะเบียน — ทั้งอัปไฟล์เดียวและอัปหลายไฟล์เรียกตัวนี้
   เดิมสองทางเขียนแยกกัน แล้วแก้ทางเดียวลืมอีกทางได้ง่าย */
function fhApplyRegistryUpload(incoming, srcLabel, setStatusFn) {
  var say = setStatusFn || function(){};
  /* อ่านหัวตารางไม่ออกทั้งไฟล์ = ไม่ใช่ทะเบียนแน่ ๆ บอกให้ตรงจุดว่าต้องมีหัวอะไรบ้าง */
  if ((!incoming || !incoming.length) && typeof _fhSkipSheets !== 'undefined' && _fhSkipSheets.length) {
    say('error', 'อ่านหัวตารางไม่ออก — ไม่ได้บันทึก');
    showInfo('ไม่ได้บันทึกทะเบียน',
      'หาคอลัมน์ "ชื่อ-นามสกุล" ไม่เจอใน Sheet: <b>' + escapeHtml(_fhSkipSheets.join(' · ')) + '</b>' +
      '<br><br>ไฟล์ทะเบียนต้องมีหัวคอลัมน์อย่างน้อย <b>ชื่อ-นามสกุล</b> ' +
      '(หรือ FullnameThai) · แนะนำให้กด <b>"ดาวน์โหลดฟอร์มตั้งต้น"</b> ไปกรอกแทน' +
      '<br><br>ทะเบียนเดิมยังอยู่ครบ ไม่ได้ถูกแตะ');
    return Promise.resolve(null);
  }
  var bad = fhRegistryFileLooksWrong(incoming);
  if (bad) {
    say('error', 'ไฟล์ไม่ใช่ทะเบียนพนักงาน — ไม่ได้บันทึก');
    showInfo('ไม่ได้บันทึกทะเบียน',
      bad + '<br><br>ทะเบียนเดิม <b>' +
      ((typeof empData !== 'undefined' && empData) ? empData.length : 0) +
      ' คน ยังอยู่ครบ ไม่ได้ถูกแตะ<br><br>' +
      'ถ้าจะอัป<b>ใบรับรอง</b> ให้ใช้เมนู <b>"ขั้น 2 · อัปใบรับรอง (PDF)"</b> แทน');
    return Promise.resolve(null);
  }
  var m = fhMergeRegistry(incoming);
  var shrink = m.gone > Math.max(5, Math.floor((m.kept - m.added) * 0.2));
  var desc =
    '<div style="text-align:left;line-height:2">' +
    'ไฟล์ที่อัป: <b>' + incoming.length + '</b> คน' + (srcLabel ? (' (' + srcLabel + ')') : '') + '<br>' +
    '• เพิ่มใหม่ <b>' + m.added + '</b> คน<br>' +
    '• อัปเดตของเดิม <b>' + m.updated + '</b> คน<br>' +
    '• ไม่อยู่ในไฟล์ใหม่ <b>' + m.gone + '</b> คน — <span style="color:#b45309">เก็บไว้ในทะเบียน ' +
    'แต่ทำเครื่องหมายว่าไม่อยู่ในทะเบียนล่าสุด (ใบรับรองของเขาจะไม่กลายเป็นใบลอย)</span><br>' +
    '<br>รวมทะเบียนหลังบันทึก <b>' + m.kept + '</b> คน' +
    (shrink ? '<br><br><span style="color:#b91c1c;font-weight:800">⚠ มีคนหลุดจากไฟล์ใหม่เยอะผิดปกติ ' +
              'ตรวจก่อนว่าอัปไฟล์ครบทุกแบรนด์แล้วหรือยัง</span>' : '') +
    '</div>';
  return customConfirm({ icon:'📊', title:'บันทึกทะเบียนตามนี้?', desc:desc,
                         okText:'บันทึก', okIsPrimary:!shrink, danger:shrink })
    .then(function(ok){
      if (!ok) { say('done', 'ยกเลิก — ทะเบียนเดิมยังอยู่ครบ'); return null; }
      empData = m.list;
      _fhCacheSet('fh_emp_v1', empData);
      say('done', 'กำลังบันทึกทะเบียน ' + m.kept + ' คนลง Cloud...');
      return saveEmployeeRegistryToCloud(m.list, true).then(function(){
        say('done', '✓ บันทึกแล้ว ' + m.kept + ' คน (เพิ่ม ' + m.added + ' · อัปเดต ' + m.updated +
                    (m.gone ? (' · ไม่อยู่ในไฟล์ใหม่ ' + m.gone) : '') + ')');
        try { renderRegistryTable(); } catch (e) {}
        _fhRefreshBranchCertsAfterRegistry();      // ทะเบียนเปลี่ยน → ผูกใบรับรองใหม่ทันที
        return m;
      }).catch(function(err){
        say('done', 'รวมข้อมูลแล้ว ' + m.kept + ' คน · ⚠ บันทึก Cloud ไม่สำเร็จ: ' + (err.message || err));
        return m;
      });
    });
}

/* แปลงข้อมูลใบรับรองจาก Cloud → รูปแบบที่หน้าเว็บใช้ (matchData)
   แยกออกมาเป็นฟังก์ชันเพราะหน้าคำขออบรมก็ต้องใช้ ตอนตรวจว่าใครมีใบรับรองแล้ว */
function _fhMapCerts(records) {
  return (records || []).map(function(r) {
    var expireDate = r['วันหมดอายุ'] || '';
    // คำนวณสถานะใหม่จากวันหมดอายุ (source of truth) — กัน Cloud คืนค่าเป็นไทย/ว่าง แล้ว badge หาย
    var expStatus = expireDate ? getExpStatus(expireDate) : 'unknown';
    // ถ้าคำนวณไม่ได้ ลอง normalize จากค่าที่ sheet เก็บไว้ (รองรับทั้งไทย/อังกฤษ)
    if (expStatus === 'unknown') {
      var s = r['สถานะใบรับรอง'];
      if (s === 'valid' || s === 'ยังมีผล') expStatus = 'valid';
      else if (s === 'warning' || s === 'ใกล้หมดอายุ') expStatus = 'warning';
      else if (s === 'expired' || s === 'หมดอายุ') expStatus = 'expired';
    }
    return {
      /* ตัดคำนำหน้าตั้งแต่ตอนอ่านเข้ามา — ของเก่าที่บันทึกไว้ก่อนหน้ายังมีคำนำหน้าติดอยู่
         ตัดตรงนี้ทีเดียว ทั้งการแสดงผล การค้นหา และการจับคู่จึงตรงกันหมด */
      certName: fhStripTitle(_cleanCertName(r['ชื่อในใบรับรอง'] || '')),
      course: r['หลักสูตร'] || '',
      trainDate: r['วันอบรม'] || r['วันที่อบรม'] || '',
      expireDate: expireDate,
      expStatus: expStatus,
      empName: r['ชื่อในระบบ'] || '',
      branch: r['สาขา'] || '—',
      position: r['ตำแหน่ง'] || '—',
      sheet: r['Sheet'] || '—',
      /* ตัวชี้ไปยังคนในทะเบียน — ของเก่าที่บันทึกไว้ก่อนมีคอลัมน์นี้จะว่าง
         แล้วระบบจะผูกให้เองรอบถัดไปจากชื่อบนใบ (ดู _fhRelinkCerts) */
      empId: String(r['รหัสพนักงาน'] || '').trim(),
      idCard: String(r['เลขบัตรประชาชน'] || '').trim(),
      branchAtTrain: r['สาขาตอนอบรม'] || '',
      matchBy: r['จับคู่โดย'] || '',
      matchType: r['สถานะจับคู่'] || 'notfound'
    };
  })
  // เก็บทุกใบที่มีชื่อในใบรับรอง (รวม notfound ที่ยังไม่จับคู่ทะเบียน) — กันข้อมูลหายตอน reload
  .filter(function(d){ return !!(d.certName && String(d.certName).trim()); });
}

/* cache ในเครื่อง (localStorage) — แสดงทันทีตอนโหลด แล้วค่อยดึงของใหม่มาทับ */
/* _fhCacheGet/_fhCacheSet ย้ายไปอยู่ fh-store.js แล้ว (เก็บลง IndexedDB)
   ของเดิมประกาศซ้ำกันสองไฟล์ ใครโหลดทีหลังก็ทับกัน ซึ่งอันตรายกว่าที่คิด */

/* ทะเบียนรายชื่อมาถึงทีหลังรายการใบรับรอง ต้องวาดหน้าสาขาใหม่
   หน้าสาขาใช้ทะเบียนช่วยตัดสินว่าใบไหนเป็นของสาขา (ชื่อสาขาบนใบสะกดไม่นิ่ง)
   ถ้าไม่วาดใหม่ ใครมาถึงก่อนก็ได้ผลต่างกัน — คอมเห็น 5 ใบ มือถือเห็น 2 ใบ */
function _fhRefreshBranchCertsAfterRegistry() {
  try {
    if (typeof _FH_EMP_BR_IDX !== 'undefined') _FH_EMP_BR_IDX = null;   // บังคับสร้างดัชนีใหม่
    /* ทะเบียนเพิ่งเปลี่ยน — ใบรับรองที่ผูกไว้ต้องตามข้อมูลคนไปด้วยทันที
       (ย้ายสาขา เปลี่ยนนามสกุล เลื่อนตำแหน่ง) และใบที่เคยจับคู่ไม่ได้เพราะคนยังไม่เข้า
       ทะเบียน ก็ได้โอกาสผูกใหม่ตรงนี้ · ทำในเครื่องก่อน ยังไม่เขียนขึ้น Cloud
       เพราะการโหลดทะเบียนเกิดทุกครั้งที่เปิดหน้า ไม่ควรกลายเป็นการเขียนทุกครั้ง */
    if (typeof _fhRelinkCerts === 'function') {
      var _rl = _fhRelinkCerts();
      if (_rl.linked || _rl.updated) {
        try { renderTable(); } catch (e2) {}
        var _pi = document.getElementById('processInfo');
        if (_pi) _pi.textContent = 'ทะเบียนอัปเดตแล้ว — ผูกใบรับรองเพิ่ม ' + _rl.linked +
          ' ใบ · ข้อมูลคนเปลี่ยน ' + _rl.updated + ' ใบ' +
          (_rl.lost ? ' · หาคนในทะเบียนไม่เจอ ' + _rl.lost + ' ใบ' : '') +
          ' · กด "บันทึกขึ้น Cloud" เพื่อเก็บถาวร';
      }
    }
    if (document.getElementById('branchResults') && typeof branchSearch === 'function') branchSearch();
    if (typeof updateBranchStats === 'function') updateBranchStats();
  } catch (e) {}
}

function loadEmployeeRegistryFromCloud() {
  if (!SCRIPT_URL) return Promise.resolve();
  // แสดงทะเบียนจาก cache ทันที (ถ้ายังไม่มี) แล้วค่อยดึงของใหม่มาทับ
  if (!empData || !empData.length) {
    var _ec = _fhCacheGet('fh_emp_v1');
    if (_ec && _ec.length) {
      empData = _ec;
      if (document.getElementById('registryBody')) { try { renderRegistryTable(); } catch(e){} }
      _fhRefreshBranchCertsAfterRegistry();
    }
  }
  setStatus('xlsx','loading','กำลังโหลดทะเบียนพนักงานจาก Cloud...');
  return fhLoadEmployees()
    .then(function(res){
      var records = res || [];
      if (records.length === 0) {
        /* Cloud ว่างจริง (เช่น เพิ่งกดลบทะเบียนทั้งหมด) → ต้องล้างของในเครื่องด้วย
           ไม่งั้นข้อมูลเก่าใน localStorage จะถูกหยิบกลับมาแสดงตอนโหลดใหม่
           = "ลบแล้วกดโหลดใหม่ ข้อมูลเดิมเด้งกลับมา"
           ฝั่งใบรับรองเจอปัญหานี้แล้วแก้ไปนานแล้ว ฝั่งทะเบียนเพิ่งตามมาแก้ */
        empData = [];
        _fhCacheSet('fh_emp_v1', []);
        if (document.getElementById('registryBody')) { try { renderRegistryTable(); } catch(e) {} }
        _fhRefreshBranchCertsAfterRegistry();
        setStatus('xlsx','wait','ยังไม่มีทะเบียนใน Cloud — กรุณา upload Excel');
        return;
      }
      // Re-build empData with proper structure
      empData = records.map(function(r){
        return {
          name: r.name || '',
          norm: normalizeName(r.name || ''),
          empId: r.empId || '',
          idCard: r.idCard || '',
          branch: r.branch || '',
          position: r.position || '',
          sheet: r.sheet || ''
        };
      });
      _fhCacheSet('fh_emp_v1', empData);   // cache ไว้แสดงทันทีรอบหน้า
      setStatus('xlsx','done','✓ ใช้ทะเบียนในระบบ — ' + empData.length + ' คน (อัพโหลด Excel ใหม่เพื่ออัพเดต)');
      var _xc = document.getElementById('xlsxCard'); if (_xc) _xc.classList.add('loaded');
      if (document.getElementById('registryBody')) { try { renderRegistryTable(); } catch(e) {} }
      _fhRefreshBranchCertsAfterRegistry();
      checkReady();
    })
    .catch(function(err){
      console.warn('Load employees from cloud failed:', err);
      setStatus('xlsx','wait','โหลดทะเบียนไม่ได้ — กรุณา upload Excel');
    });
}

function dedupEmployeeRegistry() {
  customConfirm({
    icon: ICON_TRASH,
    title: 'ลบรายชื่อพนักงานที่ซ้ำกัน?',
    desc: 'เทียบจาก <b>ชื่อ + สาขา</b> · ระบบจะเก็บไว้ 1 แถวต่อชื่อที่ซ้ำ',
    okText: 'ลบเลย',
    okIsPrimary: true
  }).then(function(ok){
    if (!ok) return;
    /* ตัดซ้ำในเครื่องด้วยกุญแจเดียวกับตอนรวมทะเบียน (รหัส → เลขบัตร → ชื่อ)
       ของเดิมให้ Google Sheets ตัดโดยเทียบ ชื่อ+สาขา ซึ่งคนเดียวกันที่ย้ายสาขา
       จะไม่ถูกมองว่าซ้ำ และหน้าเว็บก็ไม่ได้อ่านจากที่นั่นอยู่ดี */
    var emps = (typeof empData !== 'undefined' && empData) ? empData : [];
    var seen2 = {}, keep2 = [], removed2 = 0;
    emps.forEach(function(e){
      var k = _fhEmpKey(e);
      if (seen2[k]) { removed2++; return; }
      seen2[k] = 1; keep2.push(e);
    });
    if (!removed2) { showInfo('ไม่มีรายชื่อซ้ำ', 'ตรวจ ' + emps.length + ' รายชื่อแล้ว ไม่พบที่ซ้ำกัน'); return; }
    showLoadingOverlay('กำลังลบรายชื่อซ้ำ...', '');
    empData = keep2;
    _fhCacheSet('fh_emp_v1', empData);
    try { renderRegistryTable(); } catch (e) {}
    saveEmployeeRegistryToCloud(keep2, true)
    .then(function(){
      hideLoadingOverlay();
      showInfo('✓ ลบสำเร็จ', 'เหลือ <b>' + keep2.length + '</b> รายชื่อ (ลบ ' + removed2 + ' รายการซ้ำ)');
      _fhRefreshBranchCertsAfterRegistry();
    })
    .catch(function(err){
      hideLoadingOverlay();
      showInfo('✗ ลบไม่สำเร็จ', escapeHtml((err && err.message) || String(err)));
    });
  });
}

/* ─────────── ADMIN: ตรวจรายชื่อซ้ำในคำขออบรม ─────────── */
function _stripIdDigits(s) { return String(s||'').replace(/\D/g, ''); }
function _normName(s) { return String(s||'').replace(/\s+/g, ' ').trim().toLowerCase(); }

function _findAdminReqDuplicates(rows, criteria) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  var groups = {};
  rows.forEach(function(r, idx){
    var key;
    if (criteria === 'name-course') {
      key = _normName(r.name) + '|' + _normName(r.course);
    } else if (criteria === 'name-only') {
      key = _normName(r.name);
    } else {
      // default: name-idcard
      var id = _stripIdDigits(r.idCard);
      if (!_normName(r.name) || !id) return;  // ข้ามถ้าข้อมูลไม่ครบ
      key = _normName(r.name) + '|' + id;
    }
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(Object.assign({}, r, { _idx: idx }));
  });
  // เฉพาะ key ที่มี > 1 → ซ้ำ
  return Object.keys(groups)
    .filter(function(k){ return groups[k].length > 1; })
    .map(function(k){ return { key: k, items: groups[k] }; })
    .sort(function(a,b){ return b.items.length - a.items.length; });
}

function openAdminReqDupCheck() {
  if (!_adminRowCache || _adminRowCache.length === 0) {
    showInfo('ยังไม่มีข้อมูล', 'กรุณาโหลดรายการคำขออบรมก่อน');
    return;
  }
  document.getElementById('adminReqDupModal').classList.add('show');
  renderAdminReqDupList();
}
function closeAdminReqDupModal() {
  document.getElementById('adminReqDupModal').classList.remove('show');
}

function renderAdminReqDupList() {
  var criteria = document.getElementById('adminReqDupCriteria').value;
  var dupGroups = _findAdminReqDuplicates(_adminRowCache || [], criteria);
  var body = document.getElementById('adminReqDupBody');
  var summary = document.getElementById('adminReqDupSummary');

  if (dupGroups.length === 0) {
    summary.innerHTML = '<span style="color:var(--green);font-weight:700;">✓ ไม่พบรายชื่อซ้ำ</span>';
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3);">🎉 ไม่มีรายชื่อที่ซ้ำกันตามเกณฑ์นี้</div>';
    _updateAdminReqDupSelCount();
    return;
  }

  var totalDups = dupGroups.reduce(function(s,g){ return s + g.items.length; }, 0);
  var totalExtra = dupGroups.reduce(function(s,g){ return s + (g.items.length - 1); }, 0);
  summary.innerHTML = 'พบ <b style="color:var(--red);">' + dupGroups.length + '</b> กลุ่มที่ซ้ำ · รวม ' + totalDups + ' รายการ (เก็บไว้ 1 อัน → ลบส่วนเกิน ' + totalExtra + ' รายการ)';

  var html = '';
  dupGroups.forEach(function(g, gi){
    var first = g.items[0];
    // มาสก์เลขบัตรให้เห็นเฉพาะ 4 หลักท้าย
    var idMasked = '';
    if (first.idCard) {
      var idStr = String(first.idCard).replace(/\D/g, '');
      idMasked = idStr.length >= 4 ? ('•••• •••• ' + idStr.slice(-4)) : idStr;
    }
    html += '<div class="dup-group">' +
      '<div class="dup-group-hdr">' +
        '<div class="dup-group-avatar">👤</div>' +
        '<div class="dup-group-info">' +
          '<div class="dup-group-name">' + escapeHtml(first.name||'-') + '</div>' +
          (idMasked ? '<div class="dup-group-id">บัตร: ' + escapeHtml(idMasked) + '</div>' : '') +
        '</div>' +
        '<div class="dup-group-badge">ซ้ำ ' + g.items.length + ' รายการ</div>' +
      '</div>' +
      '<div class="dup-items">';
    g.items.forEach(function(it){
      var trainDateThai = formatThaiDate(it.trainDate) || '—';
      var submittedThai = formatThaiDateTime(it.timestamp) || '—';
      html += '<label class="dup-item">' +
        '<input type="checkbox" class="adm-req-dup-chk" data-idx="' + it._idx + '" onchange="_updateAdminReqDupSelCount()">' +
        '<div class="dup-item-body">' +
          '<div class="dup-item-title">' + escapeHtml(it.course || '-') + '</div>' +
          '<div class="dup-item-chips">' +
            '<span class="dup-chip">🏢 ' + escapeHtml(it.branch || '-') + '</span>' +
            (it.position ? '<span class="dup-chip">💼 ' + escapeHtml(it.position) + '</span>' : '') +
          '</div>' +
          '<div class="dup-item-dates">' +
            '<span><span class="dup-date-lbl">📅 อบรม</span><b>' + escapeHtml(trainDateThai) + '</b>' + (it.timeSlot ? ' · ' + escapeHtml(it.timeSlot) : '') + '</span>' +
            '<span><span class="dup-date-lbl">📤 ส่งเมื่อ</span>' + escapeHtml(submittedThai) + '</span>' +
          '</div>' +
        '</div>' +
      '</label>';
    });
    html += '</div></div>';
  });
  body.innerHTML = html;
  _updateAdminReqDupSelCount();
}

function _updateAdminReqDupSelCount() {
  var n = document.querySelectorAll('.adm-req-dup-chk:checked').length;
  var el = document.getElementById('adminReqDupSelCount');
  if (el) el.textContent = n;
  var btn = document.getElementById('adminReqDupDeleteBtn');
  if (btn) btn.disabled = (n === 0);
}

function adminReqDupAutoSelect(mode) {
  // mode: 'keep-oldest' → ติ๊กทุกอันยกเว้นอันแรกของแต่ละกลุ่ม (เก็บอันแรกไว้)
  document.querySelectorAll('.adm-req-dup-chk').forEach(function(c){ c.checked = false; });
  var groups = document.querySelectorAll('#adminReqDupBody > div');
  groups.forEach(function(g){
    var chks = g.querySelectorAll('.adm-req-dup-chk');
    chks.forEach(function(c, i){
      if (mode === 'keep-oldest' && i > 0) c.checked = true;  // ติ๊กตั้งแต่ตัวที่ 2 เป็นต้นไป
    });
  });
  _updateAdminReqDupSelCount();
}

function adminReqDupDeleteSelected() {
  var checked = Array.from(document.querySelectorAll('.adm-req-dup-chk:checked'));
  if (checked.length === 0) return;
  var indices = checked.map(function(c){ return parseInt(c.getAttribute('data-idx'), 10); });
  var records = indices.map(function(i){ return _adminRowCache[i]; }).filter(Boolean);
  customConfirm({
    icon: ICON_TRASH,
    title: 'ลบ ' + records.length + ' รายการที่เลือก?',
    desc: 'ระบบจะลบรายการที่ติ๊กไว้ออกจาก Cloud — ไม่สามารถกู้คืนได้',
    okText: 'ลบเลย',
    okIsPrimary: true
  }).then(function(ok){
    if (!ok) return;
    var btn = document.getElementById('adminReqDupDeleteBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังลบ... 0/' + records.length; }
    fhBulkDeleteRequests(records, function(n, total){
      if (btn) btn.textContent = 'กำลังลบ... ' + n + '/' + total;
    }).then(function(r){
      showInfo('สรุปผลการลบ', '✓ ลบสำเร็จ <b>' + r.done + '</b> รายการ' + (r.failed ? ' · ✗ ล้มเหลว ' + r.failed + ' รายการ' : ''));
      closeAdminReqDupModal();
      _fhBustRequests();
      loadAdminRequests();
    });
  });
}

/* ═══ ใบที่ชื่อขาดคำหน้า ═══
   ตัวอ่านชื่อจาก PDF ถูกแก้ให้ดีขึ้นเรื่อย ๆ · ใบเดิมที่เคยอ่านได้ไม่ครบยังค้างอยู่ในระบบ
   พออัปไฟล์เดิมซ้ำ ใบที่อ่านถูกจะเข้ามาเป็นแถวใหม่ ส่วนแถวเก่าที่ชื่อขาดไม่ถูกตัดทิ้ง
   เพราะตัวตัดซ้ำเทียบที่ "ชื่อ" ซึ่งไม่ตรงกัน ("วงษ์สี่มณีกาญจน์" กับ "ชัยวัน วงษ์สี่มณีกาญจน์")

   กติกา: ในรุ่นเดียวกัน (หลักสูตร + วันหมดอายุตรงกัน) ถ้าชื่อของแถวหนึ่ง
   เป็น "ท้ายพอดี" ของอีกแถวที่ยาวกว่า = แถวสั้นคือเศษของแถวยาว ตัดทิ้งได้
   ที่ต้องบังคับว่าอยู่รุ่นเดียวกัน เพราะคนละรุ่นอาจเป็นคนละคนที่บังเอิญนามสกุลซ้ำชื่อคนอื่น */
function _fhDropNameFragments(list) {
  var g = {};
  list.forEach(function(d){
    var k = (d.course || '') + '|' + fhDayKey(d.expireDate);
    (g[k] = g[k] || []).push(d);
  });
  Object.keys(g).forEach(function(k){
    var rows = g[k].map(function(d){
      return { d: d, w: String(fhStripTitle(d.certName || '')).split(' ').filter(Boolean) };
    });
    rows.forEach(function(a){
      if (!a.w.length) return;
      for (var i = 0; i < rows.length; i++) {
        var b = rows[i];
        /* ยาวกว่าจริงเท่านั้น — ชื่อยาวเท่ากันคือใบซ้ำธรรมดา ให้ตัวตัดด้วยกุญแจจัดการไป */
        if (b === a || b.w.length <= a.w.length) continue;
        if (b.w.slice(b.w.length - a.w.length).join(' ') === a.w.join(' ')) { a.d._frag = true; break; }
      }
    });
  });
  var out = list.filter(function(d){ return !d._frag; });
  list.forEach(function(d){ delete d._frag; });
  return out;
}

function dedupCertificateRegistry() {
  customConfirm({
    icon: ICON_TRASH,
    title: 'ลบใบรับรองที่ซ้ำกัน?',
    desc: 'เทียบจาก <b>ชื่อ + หลักสูตร + วันหมดอายุ</b> · เก็บไว้ 1 แถวต่อใบ<br>และตัดใบเก่าที่<b>ชื่อขาดคำหน้า</b>ออก ถ้ามีใบของคนเดียวกันรุ่นเดียวกันที่ชื่อครบอยู่แล้ว',
    okText: 'ลบเลย',
    okIsPrimary: true
  }).then(function(ok){
    if (!ok) return;
    /* ตัดซ้ำในเครื่องด้วยกติกาเดียวกับตอนนำเข้า แล้วบันทึกชุดที่เหลือทับ
       ของเดิมสั่งให้ Google Sheets ตัดให้ ซึ่งหน้าเว็บไม่ได้อ่านจากที่นั่น กดแล้วจึงไม่มีอะไรเปลี่ยน
       และกติกาฝั่งนั้นเทียบแค่ ชื่อ+วันหมดอายุ ทำให้คนที่มีสองใบคนละหลักสูตรเหลือใบเดียว */
    var md = (typeof matchData !== 'undefined' && matchData) ? matchData : [];
    var seen = {}, keep = [], removed = 0;
    md.forEach(function(d){
      var k = normalizeName(d.certName || '').replace(/\s+/g, '') + '|' +
              (d.course || '') + '|' + fhDayKey(d.expireDate);
      if (seen[k]) { removed++; return; }
      seen[k] = 1; keep.push(d);
    });
    /* ตัดใบที่ชื่อขาดคำหน้าต่อ — ตัวตัดด้วยกุญแจข้างบนจับไม่ได้ เพราะชื่อไม่ตรงกัน */
    var beforeFrag = keep.length;
    keep = _fhDropNameFragments(keep);
    var frag = beforeFrag - keep.length;
    if (!removed && !frag) { showInfo('ไม่มีใบซ้ำ', 'ตรวจ ' + md.length + ' ใบแล้ว ไม่พบใบที่ซ้ำกัน'); return; }
    showLoadingOverlay('กำลังลบใบซ้ำ...', '');
    matchData = keep;
    matchData.forEach(function(d, i){ d.no = i + 1; });
    try { updateStats(); renderTable(); } catch (e) {}
    _fhCacheSet('fh_cert_v1', matchData);
    fhSaveCertificates(matchData, { confirmShrink: true })
    .then(function(res){
      hideLoadingOverlay();
      if (res && res.ok) {
        showInfo('✓ ลบสำเร็จ', 'เหลือ <b>' + keep.length + '</b> ใบ'
          + (removed ? '<br>ลบใบซ้ำ ' + removed + ' ใบ' : '')
          + (frag ? '<br>ลบใบที่ชื่อขาดคำหน้า ' + frag + ' ใบ' : ''));
      } else {
        showInfo('✗ ลบไม่สำเร็จ', escapeHtml((res && res.error) || 'unknown'));
      }
    })
    .catch(function(err){ showInfo('🌐 เชื่อมต่อ Cloud ไม่ได้', escapeHtml(err.message||String(err))); });
  });
}

/* ─────────── CLOUD SYNC ─────────── */
function saveToCloud() {
  if (!matchData.length) { alert('ยังไม่มีข้อมูลให้บันทึก กรุณาจับคู่ข้อมูลก่อน'); return; }
  var btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> กำลังบันทึก...';
  document.getElementById('processInfo').textContent = 'กำลังบันทึก ' + matchData.length + ' รายการขึ้น Google Sheet...';

  /* เขียนที่เดียวกับที่อ่าน — ของเดิมยิงเข้า Google Sheets ตรง ๆ แต่หน้าเว็บอ่านจาก Supabase
     ใบที่บันทึกจึงไม่เคยขึ้นให้ใครเห็น · fhSaveCertificates เขียน Supabase แล้วสำเนาลง Sheets ให้ด้วย */
  fhSaveCertificates(matchData)
  .then(function(res){
    btn.disabled = false;
    btn.innerHTML = '&#128190; บันทึกขึ้น Cloud';
    console.log('[DIAG SAVE] ok=' + res.ok + ' saved=' + res.saved + ' err=' + (res.error||'-'));
    window._fhImportBusy = false;   // ✅ บันทึกฝั่ง server เสร็จแล้ว — ปิดแท็บได้
    if (res.ok) {
      document.getElementById('processInfo').textContent = '✓ บันทึก ' + res.saved + ' รายการลง Cloud สำเร็จ · กำลังโหลดข้อมูลรวม...';
      // โหลดข้อมูลทั้งหมดจาก Cloud มาแสดงรวมกัน (กันข้อมูลก่อนหน้าหาย)
      setTimeout(loadFromCloud, 300);
      return;
    } else {
      document.getElementById('processInfo').textContent = '✗ บันทึกล้มเหลว: ' + (res.error || 'unknown');
      /* หลังบ้านกันไว้เพราะของที่ส่งไปน้อยกว่าของเดิมมาก (มักเกิดตอนโหลดของเดิมมาไม่ครบ)
         โหลดใหม่ให้เลย ผู้ใช้จะได้เห็นของครบแล้วค่อยตัดสินใจว่าจะบันทึกอีกทีไหม */
      if (String(res.error || '').indexOf('ไม่บันทึกทับ') >= 0) setTimeout(loadFromCloud, 400);
    }
  })
  .catch(function(err){
    btn.disabled = false;
    btn.innerHTML = '&#128190; บันทึกขึ้น Cloud';
    window._fhImportBusy = false;
    document.getElementById('processInfo').textContent = '✗ เชื่อมต่อ Cloud ไม่ได้: ' + err.message;
  });
}

/* ═══════════ โครงโหลดรายการใบรับรอง ═══════════
   ?action=certificates ใช้เวลาหลายสิบวินาที — ถ้าปล่อยให้จอว่างหรือขึ้น "ยังไม่มีข้อมูล"
   ผู้ใช้จะเข้าใจผิดว่าไม่มีใบรับรองในระบบ */
function certSkelHtml(n, note) {
  var one = '<div class="cert-skel">'
    +   '<div class="skel-line t"></div>'
    +   '<div class="skel-line w70"></div>'
    +   '<div class="skel-line w58"></div>'
    +   '<div class="skel-line w42"></div>'
    + '</div>';
  var h = '';
  for (var i = 0; i < (n || 3); i++) h += one;
  return '<div class="cert-skel-wrap">' + h
    + '<div class="cert-load-note">' + (note || 'กำลังโหลดใบรับรองจาก Cloud…<br>ครั้งแรกอาจใช้เวลาสักครู่ ครั้งต่อไปจะขึ้นทันทีจากเครื่อง') + '</div>'
    + '</div>';
}
/* กล่อง "โหลดไม่สำเร็จ" + ปุ่มลองใหม่ (retryCall = โค้ดที่จะเรียกเมื่อกด) */
function certFailHtml(msg, retryCall) {
  return '<div class="cert-load-fail">✗ ' + escapeHtml(msg)
    + '<span>ตรวจสอบอินเทอร์เน็ตแล้วกดลองใหม่</span>'
    + '<button type="button" class="cert-retry-btn" onclick="' + retryCall + '">🔄 ลองใหม่</button>'
    + '</div>';
}
/* on=true → แทนตารางด้วยโครงโหลด · on=false → คืนตาราง · failMsg → แสดงกล่องข้อผิดพลาดแทน */
function fhCertLoading(on, failMsg) {
  var box = document.getElementById('certLoading');
  var tbl = document.getElementById('mainTable');
  var cnt = document.getElementById('countLine');
  var pag = document.getElementById('tablePagination');
  if (!box) return;
  var hide = !!(on || failMsg);
  box.innerHTML = failMsg ? certFailHtml(failMsg, 'loadFromCloud()')
    : (on ? certSkelHtml(4) : '');
  box.style.display = hide ? '' : 'none';
  if (tbl) tbl.style.display = hide ? 'none' : '';
  if (cnt) cnt.style.display = hide ? 'none' : '';
  if (pag) pag.style.display = hide ? 'none' : '';
}

function loadFromCloud() {
  // แสดงจาก cache ทันที (ถ้ายังไม่มีข้อมูลในหน้า) แล้วค่อยดึงของใหม่มาทับ
  if (!matchData || !matchData.length) {
    var _cc = _fhCacheGet('fh_cert_v1');
    if (_cc && _cc.length) { matchData = _cc; try { updateStats(); renderTable(); } catch(e){} }
  }
  // ไม่มีทั้งข้อมูลบนจอและในแคช → โชว์โครงโหลดไว้ก่อน
  var _hadData = !!(matchData && matchData.length);
  if (!_hadData) fhCertLoading(true);
  /* ปุ่ม/ป้ายสถานะสองตัวนี้เป็นแค่ตัวบอกความคืบหน้า ไม่ใช่สาระของการโหลด
     ของเดิมเรียกตรง ๆ ถ้าวันไหนมันไม่อยู่ในหน้า (ถูกย้าย/ถูกตัดออก)
     บรรทัดนี้จะพังก่อนถึงคำสั่งดึงข้อมูล → ใบรับรองไม่โหลดเลยทั้งหน้า โดยไม่มีข้อความบอก */
  var btn = document.getElementById('loadBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> กำลังโหลด...';
  }
  var _pi = document.getElementById('processInfo');
  if (_pi) _pi.textContent = 'กำลังโหลดข้อมูลจาก Cloud...';

  // fhLoadCertificates: Supabase ถ้าตั้งค่าไว้ · ไม่งั้น/พัง → Apps Script (doGet ไม่ระบุ action = certificates)
  fhLoadCertificates()
  .then(function(records){ return { ok: true, records: records }; })
  .then(function(res){
    if (btn) { btn.disabled = false; btn.innerHTML = '&#9729; โหลดจาก Cloud'; }
    if (!res.ok) {
      if (_pi) _pi.textContent = '✗ โหลดล้มเหลว: ' + (res.error || 'unknown');
      fhCertLoading(false, _hadData ? '' : ('โหลดใบรับรองไม่สำเร็จ: ' + (res.error || 'unknown')));
      return;
    }
    fhCertLoading(false);
    var records = res.records || [];
    console.log('[DIAG LOAD] records จาก Cloud = ' + records.length);
    if (records.length === 0) {
      // Cloud ว่างจริง (เช่น เพิ่งลบทั้งหมด) → ล้าง matchData + cache ในเครื่องด้วย
      // ไม่งั้นข้อมูลเก่าจาก localStorage cache จะค้างบนจอ ("ลบแล้วรีเฟรชกลับมาเหมือนเดิม")
      matchData = [];
      _fhCacheSet('fh_cert_v1', []);
      try { updateStats(); renderTable(); } catch(e){}
      if (_pi) _pi.textContent = 'ยังไม่มีข้อมูลใน Cloud';
      return;
    }
    matchData = _fhMapCerts(records);
    // ตัดซ้ำ + ทิ้งใบ "วันว่าง" ถ้ามีใบ "มีวันหมดอายุ" ของคน+หลักสูตรเดียวกัน
    // (ใช้ชื่อ normalize แล้ว กัน OCR อ่านช่องว่าง/อักขระต่างกันเล็กน้อยแล้วนับเป็นคนละใบ)
    (function(){
      var _ckey = function(d){ return normalizeName(d.certName||'').replace(/\s+/g,'') + '|' + (d.course||''); };
      var _hasExp = function(d){ return !!(d.expireDate && String(d.expireDate).trim()); };
      var datedGroups = {};
      matchData.forEach(function(d){ if (_hasExp(d)) datedGroups[_ckey(d)] = true; });
      var seen = {}, out = [];
      matchData.forEach(function(d){
        if (!_hasExp(d) && datedGroups[_ckey(d)]) return;      // ใบวันว่าง แต่มีใบมีวันแล้ว → ทิ้ง
        var k = _ckey(d) + '|' + fhDayKey(d.expireDate);        // ตัดซ้ำ (รองรับ renewal คนละวัน)
        if (seen[k]) return; seen[k] = true; out.push(d);
      });
      matchData = out;
    })();
    console.log('[DIAG LOAD] หลัง map+filter+dedup → matchData = ' + matchData.length);
    _canonicalizeBranches(matchData);   // รวมชื่อสาขาที่สะกดต่างเล็กน้อยให้เป็นอันเดียว
    // Renumber
    matchData.forEach(function(d, i){ d.no = i + 1; });
    _fhCacheSet('fh_cert_v1', matchData);   // cache ไว้แสดงทันทีรอบหน้า
    /* วาดตารางก่อน แล้วค่อยไปยุ่งกับปุ่ม/ป้ายสถานะ
       ของเดิมสั่งเปิดปุ่มก่อน ถ้าปุ่มตัวใดตัวหนึ่งไม่อยู่ในหน้า บรรทัดนั้นจะพัง
       แล้วกระโดดไป catch — ข้อมูลโหลดมาครบแต่ไม่เคยถูกวาด หน้าจึงว่างเปล่า
       ซ้ำร้ายข้อความ error ไปโผล่ใน processInfo ซึ่งถูกซ่อนไว้ เลยไม่มีใครเห็นสาเหตุ */
    updateStats();
    renderTable();
    var _eb = document.getElementById('exportBtn'); if (_eb) _eb.disabled = false;
    var _sb = document.getElementById('saveBtn');   if (_sb) _sb.disabled = false;
    var _nb = document.getElementById('noteBar');   if (_nb) _nb.classList.add('show');
    if (typeof _refreshAdminReqCerts === 'function') _refreshAdminReqCerts();
    // NOTE: ตัดซ้ำเฉพาะ "ตอนแสดง" — ไม่เขียนกลับ Cloud อัตโนมัติ (กัน race ชนกับปุ่มลบ)
    // ถ้าอยากล้างของซ้ำบน Cloud จริง ให้กด "จับคู่ใบรับรองกับทะเบียน" หรือลบทั้งหมดแล้วอัปใหม่
    var _dupN = records.length - matchData.length;
    if (_pi) _pi.textContent = '✓ โหลด ' + matchData.length + ' รายการ' + (_dupN > 0 ? ' (ซ่อนใบซ้ำ/ไม่สมบูรณ์ ' + _dupN + ' ใบ)' : '') + ' · ' + new Date().toLocaleTimeString('th-TH');
    var _ts = document.getElementById('topStatus');
    if (_ts) _ts.textContent = 'Loaded · ' + new Date().toLocaleTimeString('th-TH');
    /* เทียบกับที่เก็บสำรองว่ามีของตกค้างไหม — ถามทีหลัง ไม่หน่วงการแสดงผล */
    setTimeout(function(){ try { fhCheckCertGap(); } catch (e) {} }, 1200);
  })
  .catch(function(err){
    if (btn) { btn.disabled = false; btn.innerHTML = '&#9729; โหลดจาก Cloud'; }
    if (_pi) _pi.textContent = '✗ โหลดไม่สำเร็จ: ' + err.message;
    console.error('[FH] โหลดใบรับรองไม่สำเร็จ', err);
    /* processInfo ถูกซ่อนไว้ ข้อความในนั้นจึงไม่มีใครเห็น
       ต้องขึ้นกล่องบอกเหตุผลบนหน้าจริง ๆ ไม่งั้นผู้ใช้เห็นแค่หน้าว่างแล้วไม่รู้ว่าเกิดอะไร */
    fhCertLoading(false, _hadData ? '' : ('โหลดใบรับรองไม่สำเร็จ: ' + (err && err.message ? err.message : String(err))));
  });
}


/* ═══════════════════════════════════════════════════════════════
   ของตกค้างฝั่ง Google Sheets
   ช่วงเปลี่ยนผ่านมาใช้ Supabase มีจังหวะที่เขียนลง Sheets อย่างเดียว
   ใบพวกนั้นจะไม่มีวันขึ้นให้ใครเห็น เพราะหน้าเว็บอ่านจาก Supabase อย่างเดียว
   (เกิดขึ้นจริง: Sheets 757 ใบ · Supabase 652 ใบ · ต่างกัน 105 ใบ)
   ตรวจด้วย action=counts ซึ่งนับอย่างเดียว ไม่ต้องโหลดข้อมูลทั้งก้อน จึงเร็วพอ
   จะเรียกทุกครั้งที่โหลดหน้า
   ═══════════════════════════════════════════════════════════════ */
function fhCheckCertGap() {
  if (!SCRIPT_URL || typeof FH_SB === 'undefined' || !FH_SB.ready) return Promise.resolve(null);
  var here = (matchData || []).length;
  /* ไม่มีสักใบอยู่เลย = จังหวะที่ต้องถาม ไม่ใช่เหตุที่จะเงียบ
     ของเดิมเงียบตอน here = 0 ทำให้ตัวกู้ปิดตัวเองตอนที่ต้องการมันที่สุด */
  return fetch(SCRIPT_URL + '?action=counts&_=' + Date.now())
    .then(function(r){ return r.json(); })
    .then(function(j){
      var sheets = (j && j.counts && j.counts.certificates) || 0;
      if (sheets <= here) return null;
      var gap = sheets - here;
      console.warn('[FH] Google Sheets มี ' + sheets + ' ใบ แต่ที่แสดงอยู่ ' + here + ' ใบ');
      return customConfirm({
        icon: '🔄', danger: false, okText: 'ดึงมารวมเลย', cancelText: 'ไว้ก่อน',
        title: 'มีใบรับรองตกค้างอยู่อีก ' + gap + ' ใบ',
        desc: 'ที่เก็บสำรอง (Google Sheets) มี <b>' + sheets + '</b> ใบ แต่ที่แสดงอยู่ตอนนี้มี <b>' +
              here + '</b> ใบ<br><br>เป็นของที่บันทึกไว้ช่วงที่ระบบเขียนลงคนละที่กับที่อ่าน<br>' +
              'ดึงมารวมกับของที่มีอยู่ แล้วบันทึกขึ้นที่เก็บหลักให้ครบทั้งหมด'
      }).then(function(ok){ return ok ? fhSyncFromSheets() : null; });
    })
    .catch(function(e){ console.warn('[FH] เทียบจำนวนใบรับรองไม่สำเร็จ', e); return null; });
}

/* ดึงใบรับรองจาก Google Sheets มารวมกับของที่มีอยู่ แล้วบันทึกขึ้นที่เก็บหลัก
   รวมแบบเดียวกับตอนอัปไฟล์ซ้ำ — ใบเดียวกันไม่กลายเป็นสองแถว
   และการจับคู่ที่คนทำไว้เองต้องไม่หาย */
function fhSyncFromSheets() {
  showLoadingOverlay('กำลังดึงของตกค้างมารวม...', 'อาจใช้เวลาสักครู่');
  return fetch(SCRIPT_URL + '?action=certificates&_=' + Date.now())
    .then(function(r){ return r.json(); })
    .then(function(j){
      var incoming = _fhMapCerts(j.records || []);
      var key = function(d){
        return normalizeName(d.certName || '').replace(/\s+/g, '') + '|' + (d.course || '') + '|' + fhDayKey(d.expireDate);
      };
      var byKey = {}, out = [];
      /* ของที่แสดงอยู่มาก่อน — เป็นตัวที่ผ่านการจับคู่ล่าสุดแล้ว */
      (matchData || []).forEach(function(d){ var k = key(d); if (!byKey[k]) { byKey[k] = d; out.push(d); } });
      var added = 0;
      incoming.forEach(function(d){
        var k = key(d), cur = byKey[k];
        if (cur) {
          /* ใบเดียวกัน — เก็บตัวชี้ที่ฝั่งไหนมีก่อน อย่าให้หายเพราะอีกฝั่งไม่มี */
          if (!cur.empId && d.empId) { cur.empId = d.empId; cur.idCard = cur.idCard || d.idCard || ''; }
          if (!cur.branchAtTrain && d.branchAtTrain) cur.branchAtTrain = d.branchAtTrain;
          if (d.matchBy === 'manual' && cur.matchBy !== 'manual') {
            cur.matchBy = 'manual'; cur.empName = d.empName || cur.empName;
            if (d.empId) cur.empId = d.empId;
          }
          return;
        }
        byKey[k] = d; out.push(d); added++;
      });
      matchData = out;
      matchData.forEach(function(d, i){ d.no = i + 1; });
      var rl = (typeof _fhRelinkCerts === 'function') ? _fhRelinkCerts() : { linked: 0 };
      try { updateStats(); renderTable(); } catch (e) {}
      _fhCacheSet('fh_cert_v1', matchData);
      hideLoadingOverlay();
      showInfo('รวมข้อมูลแล้ว',
        'ดึงของตกค้างมาเพิ่ม <b>' + added + '</b> ใบ · รวมทั้งหมด <b>' + matchData.length + '</b> ใบ' +
        (rl.linked ? '<br>ผูกกับทะเบียนเพิ่มได้ ' + rl.linked + ' ใบ' : '') +
        '<br><br>กำลังบันทึกขึ้นที่เก็บหลัก...');
      return fhSaveCertificates(matchData).then(function(res){
        if (res && res.ok) showInfo('บันทึกแล้ว', 'บันทึก <b>' + matchData.length + '</b> ใบขึ้นที่เก็บหลักเรียบร้อย');
        else showInfo('บันทึกไม่สำเร็จ', (res && res.error) || 'ไม่ทราบสาเหตุ — ข้อมูลที่รวมแล้วยังอยู่บนหน้าจอ');
        return res;
      });
    })
    .catch(function(e){
      hideLoadingOverlay();
      showInfo('ดึงข้อมูลไม่สำเร็จ', escapeHtml((e && e.message) || String(e)));
    });
}

/* ใบไหนมีไฟล์ PDF ในระบบบ้าง — เรียก fhDiagFiles() ในคอนโซล
   ใช้ตอบคำถาม "ทำไมใบนี้ไม่มีปุ่มดาวน์โหลด" ให้ได้ว่าเป็นเพราะหาไฟล์ไม่เจอ
   หรือเพราะไม่เคยมีไฟล์ของใบนั้นเลย (บางใบนำเข้าจาก Excel ไม่ได้มาจาก PDF) */
window.fhDiagFiles = function(q) {
  var NL2 = '\n  ';
  var md = (typeof matchData !== 'undefined' && matchData) ? matchData : [];
  var rows = q ? md.filter(function(d){ return String(d.certName || '').indexOf(q) >= 0; }) : md;
  var has = 0, no = [];
  rows.forEach(function(d){
    if (_fhCertUrl(d.certName, d.course)) has++;
    else no.push(d.certName + ' · ' + String(d.course || '').slice(0, 30));
  });
  console.log('ตรวจ ' + rows.length + ' ใบ · มีไฟล์ ' + has + ' · ไม่มีไฟล์ ' + no.length);
  console.log('ไฟล์ทั้งหมดในระบบ ' + Object.keys(FH_CERT_FILES).length + ' ไฟล์');
  if (no.length) console.log('ใบที่ไม่มีไฟล์:' + NL2 + no.slice(0, 40).join(NL2));
  return { checked: rows.length, hasFile: has, noFile: no.length };
};

/* วินิจฉัยการจับคู่ชื่อ — เรียก fhDiagNames() ในคอนโซลได้เลย (ใช้ข้อมูลที่โหลดอยู่ ไม่ต้องอัปใหม่) */
window.fhDiagNames = function() {
  var emp = empData || [];
  var md = matchData || [];
  console.log('%c[fhDiag] cert=' + md.length + ' · ทะเบียน=' + emp.length, 'color:#ea580c;font-weight:bold');
  console.log('[fhDiag] ชื่อ cert (5 ตัวอย่าง):', JSON.stringify(md.slice(0,5).map(function(d){ return d.certName; })));
  console.log('[fhDiag] ชื่อทะเบียน (5 ตัวอย่าง):', JSON.stringify(emp.slice(0,5).map(function(e){ return e.norm || e.name; })));
  var hit = 0, samples = [];
  md.forEach(function(d){
    var c = getParts(d.certName || '');
    var ok = emp.some(function(e){ return _certEmpMatch(c, e.norm || e.name || ''); });
    if (ok) hit++; else if (samples.length < 5) samples.push(d.certName + ' (first=' + c.first + ' last=' + c.last + ')');
  });
  console.log('%c[fhDiag] จับคู่ได้ ' + hit + '/' + md.length, 'color:#16a34a;font-weight:bold');
  if (samples.length) console.log('[fhDiag] ตัวอย่างที่จับคู่ไม่ได้:', JSON.stringify(samples));
  return hit + '/' + md.length;
};

/* ดูแถวจริงในตารางใบรับรอง + เช็ก match ของ certName จริง — fhRow('รณชัย') */
window.fhRow = function(q){
  var hex = function(s){ return [].map.call(String(s||''), function(c){ return c.charCodeAt(0).toString(16); }).join(' '); };
  var emp = (typeof empData !== 'undefined' && empData) ? empData : [];
  var r = (typeof matchData !== 'undefined' && matchData ? matchData : []).filter(function(d){ return (d.certName||'').indexOf(q) >= 0; });
  console.log('%c[fhRow] เจอ ' + r.length + ' แถว:', 'color:#ea580c;font-weight:bold');
  r.forEach(function(d){
    var cp = getParts(d.certName||'');
    var m = emp.some(function(e){ return _certEmpMatch(cp, e.norm||e.name||''); });
    console.log('  certName="'+d.certName+'" (len='+String(d.certName||'').length+') hex=['+hex(d.certName)+']');
    console.log('    first="'+cp.first+'"('+hex(cp.first)+') last="'+cp.last+'"('+hex(cp.last)+') · matchในทะเบียน='+m+' · สาขา="'+(d.branch||'')+'" แบรนด์="'+(d.sheet||'')+'"');
  });
  return r.length + ' แถว';
};

/* เทียบรหัสตัวอักษร ชื่อ cert vs ทะเบียน (หาสาเหตุจับคู่ไม่ติด) — fhWhy('ชื่อ สกุล') */
window.fhWhy = function(certName){
  var hex = function(s){ return [].map.call(String(s||''), function(c){ return c.charCodeAt(0).toString(16); }).join(' '); };
  var cp = getParts(certName);
  var emp = (typeof empData !== 'undefined' && empData) ? empData : [];
  console.log('%c[fhWhy] cert="'+certName+'" first="'+cp.first+'" last="'+cp.last+'"', 'color:#ea580c;font-weight:bold');
  console.log('[fhWhy] cert first codes:', hex(cp.first), '· last codes:', hex(cp.last));
  var cands = emp.filter(function(e){ var ep=getParts(e.norm||e.name||''); return _thStrip(ep.first)===_thStrip(cp.first) || _thStrip(ep.last)===_thStrip(cp.last); });
  console.log('[fhWhy] ผู้ที่ชื่อ/สกุลใกล้เคียงในทะเบียน:', cands.length);
  cands.slice(0,6).forEach(function(e){
    var ep=getParts(e.norm||e.name||'');
    console.log('  ทะเบียน="'+(e.name)+'" match='+_certEmpMatch(cp, e.norm||e.name||'')+' · สาขา="'+(e.branch||'')+'" แบรนด์="'+(e.sheet||'')+'"');
  });
  return cands.length + ' คนใกล้เคียง';
};

/* วินิจฉัยไฟล์ใบรับรอง (ปุ่มดาวน์โหลด) — เรียก fhDiagFiles() ในคอนโซล */
window.fhDiagFiles = function() {
  var keys = Object.keys(FH_CERT_FILES || {});
  console.log('%c[fhDiagFiles] ไฟล์ที่ผูก URL = ' + keys.length, 'color:#ea580c;font-weight:bold');
  var fbOk = (typeof fhDb !== 'undefined' && fhDb);
  console.log('%c[fhDiagFiles] Firebase (fhDb) = ' + (fbOk ? 'OK ✓' : 'NULL ✗ — ไม่ทำงาน!'), fbOk ? 'color:#16a34a' : 'color:#dc2626;font-weight:bold');
  var md = matchData || [];
  if (md[0]) {
    var d = md[0], k = _fhCertKey(d.certName, d.course);
    console.log('[fhDiagFiles] แถวแรก "' + d.certName + '" | expire="' + d.expireDate + '" | key="' + k + '" → ' + (FH_CERT_FILES[k] ? 'มีไฟล์ ✓ ' + FH_CERT_FILES[k] : 'ไม่มีไฟล์ ✗'));
  }
  console.log('[fhDiagFiles] key ที่ผูกไว้ (3 ตัวอย่าง):', JSON.stringify(keys.slice(0,3)));
  return keys.length + ' ไฟล์ · Firebase ' + (fbOk ? 'OK' : 'NULL');
};

/* ─── ทะเบียนรายชื่อ (registry page) ─── */
function renderRegistryTable() {
  var body = document.getElementById('registryBody'); if (!body) return;
  var emps = (typeof empData !== 'undefined' && empData) ? empData : [];
  var q = ((document.getElementById('registrySearch')||{}).value || '').trim().toLowerCase();
  /* คนที่ไม่อยู่ในทะเบียนล่าสุด (ลาออก/ไม่ได้อยู่ในไฟล์รอบนี้) ซ่อนเป็นค่าตั้งต้น
     เอามาปนกันเมื่อไร ตัวเลขจำนวนคนต่อสาขาจะเกินจริงโดยไม่มีใครรู้ว่าเกินเพราะอะไร
     แต่ยังต้องดูได้ จึงมีสวิตช์ให้เปิด */
  var showGone = !!(document.getElementById('registryShowGone') || {}).checked;
  var live = showGone ? emps : emps.filter(function(e){ return e.active !== false; });
  var nGone = emps.length - emps.filter(function(e){ return e.active !== false; }).length;
  var rows = q ? live.filter(function(e){ return ((e.name||'')+(e.empId||'')+(e.idCard||'')+(e.branch||'')+(e.position||'')).toLowerCase().indexOf(q) >= 0; }) : live;
  var cnt = document.getElementById('registryCount');
  if (cnt) cnt.textContent = 'ทั้งหมด ' + (emps.length - nGone) + ' คน'
    + (nGone ? (' · ไม่อยู่ในทะเบียนล่าสุดอีก ' + nGone) : '')
    + (q ? (' · พบ ' + rows.length) : '');
  if (!emps.length) { body.innerHTML = '<tr><td colspan="6" class="empty">ยังไม่มีทะเบียน — อัปไฟล์ Excel ที่เมนู "นำเข้าข้อมูล → นำเข้ารายชื่อพนักงาน"</td></tr>'; return; }
  if (!rows.length) { body.innerHTML = '<tr><td colspan="6" class="empty">ไม่พบข้อมูลที่ค้นหา</td></tr>'; return; }
  var show = rows.slice(0, 500);
  var html = show.map(function(e, i){
    var off = (e.active === false);
    return '<tr' + (off ? ' style="opacity:.55"' : '') + '><td>'+(i+1)+'</td><td>'+escapeHtml(e.name||'')
      + (off ? ' <span style="font-size:11px;font-weight:800;color:#b45309;white-space:nowrap">· ไม่อยู่ในทะเบียนล่าสุด'
               + (e.goneAt ? (' ' + escapeHtml(e.goneAt)) : '') + '</span>' : '')
      +'</td><td>'+escapeHtml(e.empId||'')+'</td><td>'+escapeHtml(e.branch||'')+'</td><td>'+escapeHtml(e.position||'')+'</td><td>'+escapeHtml(e.sheet||'')+'</td></tr>';
  }).join('');
  if (rows.length > 500) html += '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:12px;">แสดง 500 แรกจาก '+rows.length+' · พิมพ์ค้นหาเพื่อกรอง</td></tr>';
  body.innerHTML = html;
}
/* popup ลำดับการอัปโหลด (กดจากเมนู sidebar) — โชว์คำอธิบาย + ปุ่มทำงาน */
function fhStepPopup(n) {
  var steps = {
    1: { icon:'📊', title:'ขั้น 1 · อัปทะเบียนพนักงาน (Excel)',
         desc:'อัปได้หลายไฟล์ · ระบบรวม+ตัดซ้ำอัตโนมัติ<br>ถ้ายังไม่มีไฟล์ → <a href="javascript:void(0)" onclick="downloadRegistryTemplate()" style="color:#EA580C;font-weight:800;text-decoration:none;">⬇️ ดาวน์โหลดฟอร์มตั้งต้น</a> ไปกรอกก่อน',
         okText:'📊 เลือกไฟล์ Excel', action:function(){ openImportModal('registry'); } },
    2: { icon:'📄', title:'ขั้น 2 · อัปใบรับรอง (PDF)',
         desc:'1 ไฟล์มีหลายคนได้ · ระบบตัดหน้าแยกรายคนอัตโนมัติ (ดาวน์โหลดใบเฉพาะคนได้)',
         okText:'📄 เลือกไฟล์ PDF', action:function(){ openImportModal('cert'); } },
    3: { icon:'🔗', title:'ขั้น 3 · จับคู่ข้อมูล',
         desc:'เติมสาขา/แบรนด์ให้ใบรับรอง โดยจับคู่ชื่อกับทะเบียนพนักงาน<br>(ใช้หลังอัปทะเบียน + ใบรับรองครบแล้ว)',
         okText:'🔗 จับคู่เลย', action:function(){ reMatchCerts(); } }
  };
  var s = steps[n]; if (!s) return;
  customConfirm({ icon:s.icon, title:s.title, desc:s.desc, okText:s.okText, okIsPrimary:true })
    .then(function(ok){ if (ok) s.action(); });
}

/* ดาวน์โหลดฟอร์มตั้งต้น (Excel) ทะเบียนพนักงาน — หัวคอลัมน์ตรงกับที่ระบบอ่าน */
function downloadRegistryTemplate() {
  if (typeof XLSX === 'undefined') { showInfo('ยังโหลดไม่เสร็จ', 'รอสักครู่แล้วลองใหม่ครับ'); return; }
  var headers = ['รหัสพนักงาน','ชื่อ-นามสกุล','เลขบัตรประชาชน','ตำแหน่ง','สาขา','แบรนด์'];
  var ex1 = ['5001','นายตัวอย่าง ทดสอบ','1234567890123','พนักงานบริการ','5001 สาขาตัวอย่าง','Santa Fe'];
  var ex2 = ['4008','นางสาวสมมติ นามสกุล','1100501234567','ผู้จัดการ','4008 เจ๊แดงสาขาตัวอย่าง','เจ๊แดง จุ่มนัวร์'];
  var ws = XLSX.utils.aoa_to_sheet([headers, ex1, ex2]);
  ws['!cols'] = [{wch:14},{wch:28},{wch:20},{wch:22},{wch:26},{wch:18}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ทะเบียนพนักงาน');
  try { XLSX.writeFile(wb, 'ฟอร์มตั้งต้น-ทะเบียนพนักงาน.xlsx'); }
  catch(e) { showInfo('ดาวน์โหลดไม่สำเร็จ', escapeHtml(e.message || String(e))); }
}
/* ลบทะเบียนรายชื่อทั้งหมด (server รองรับผ่าน save-employees replaceAll ด้วย records ว่าง) */
function clearRegistry() {
  var n = (typeof empData !== 'undefined' && empData) ? empData.length : 0;
  if (!n) { showInfo('ไม่มีข้อมูล', 'ยังไม่มีทะเบียนรายชื่อให้ลบ'); return; }
  customConfirm({ icon: ICON_TRASH, title: 'ลบทะเบียนรายชื่อทั้งหมด?', desc: 'จะลบทั้งหมด <strong>'+n+'</strong> คน ออกจาก Cloud ถาวร — ไม่สามารถกู้คืนได้', okText: 'ลบทั้งหมด', okIsPrimary: true })
  .then(function(ok){
    if (!ok) return;
    showLoadingOverlay('กำลังลบทะเบียน...', '');
    saveEmployeeRegistryToCloud([], true)
      .then(function(){
        empData = [];
        _fhCacheSet('fh_emp_v1', []);   // ล้างแคชในเครื่องด้วย ไม่งั้นกดโหลดใหม่แล้วของเก่าเด้งกลับมา
        hideLoadingOverlay();
        try { renderRegistryTable(); } catch(e) {}
        _fhRefreshBranchCertsAfterRegistry();
        showInfo('ลบสำเร็จ', 'ลบทะเบียนรายชื่อทั้งหมดแล้ว');
      })
      .catch(function(err){ hideLoadingOverlay(); showInfo('ลบไม่สำเร็จ', escapeHtml(err.message || String(err))); });
  });
}
function _reloadRegistry() {
  var body = document.getElementById('registryBody'); if (body) body.innerHTML = '<tr><td colspan="6" class="empty">กำลังโหลด...</td></tr>';
  if (typeof loadEmployeeRegistryFromCloud === 'function') {
    loadEmployeeRegistryFromCloud().then(renderRegistryTable).catch(renderRegistryTable);
  } else { renderRegistryTable(); }
}
function reMatchCerts() {
  var md = (typeof matchData !== 'undefined' && matchData) ? matchData : [];
  var emps = (typeof empData !== 'undefined' && empData) ? empData : [];
  if (!md.length) { showInfo('ไม่มีใบรับรอง', 'ยังไม่มีใบรับรองให้จับคู่ — อัปใบรับรองก่อน'); return; }
  if (!emps.length) { showInfo('ไม่มีทะเบียน', 'ยังไม่มีทะเบียนพนักงาน — อัปทะเบียน Excel ก่อน'); return; }
  customConfirm({ icon:'🔗', title:'จับคู่ใบรับรองกับทะเบียน?', desc:'จะเติมสาขา/แบรนด์ให้ใบรับรอง <b>'+md.length+'</b> รายการ จากทะเบียน <b>'+emps.length+'</b> คน แล้วบันทึก', okText:'จับคู่เลย', okIsPrimary:true })
  .then(function(ok){
    if (!ok) return;
    showLoadingOverlay('กำลังจับคู่...', '');
    setTimeout(function(){
      /* ใช้ตัวเดียวกับที่ทำงานอัตโนมัติตอนทะเบียนเปลี่ยน — กติกาจะได้ไม่แตกเป็นสองชุด
         เดิมตรงนี้เขียนวนหาชื่อไว้เองอีกชุด แล้วมันไม่เก็บรหัสพนักงาน
         พอทะเบียนเปลี่ยนรอบหน้าก็ต้องกลับมาเดาจากชื่อใหม่ทุกครั้ง */
      var rl = _fhRelinkCerts({ near: true });   // กดปุ่มเอง = ยอมรอ ให้จับชื่อที่สะกดต่างนิดเดียวด้วย
      var linkedTotal = md.filter(function(d){ return !!d.empId; }).length;
      try { renderTable(); } catch(e) {}
      try { updateStats(); } catch(e) {}
      hideLoadingOverlay();
      showInfo('จับคู่เสร็จ',
        'ผูกกับทะเบียนแล้ว <b>' + linkedTotal + '</b>/' + md.length + ' ใบ' +
        (rl.linked ? ' (เพิ่งผูกได้ ' + rl.linked + ' ใบ)' : '') +
        (rl.near ? ' · ชื่อสะกดต่างนิดเดียว ' + rl.near + ' ใบ — ขึ้นป้าย "ใกล้เคียง" ไว้ให้ตรวจซ้ำ' : '') +
        (rl.updated ? ' · ข้อมูลคนเปลี่ยน ' + rl.updated + ' ใบ' : '') +
        (rl.lost ? ' · หาคนในทะเบียนไม่เจอ ' + rl.lost + ' ใบ' : '') +
        ' · กำลังบันทึก Cloud...');
      try { window._fhImportBusy = true; saveToCloud(); } catch(e) {}
    }, 120);
  });
}

/* all=true \u2192 \u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01 "\u0E17\u0E38\u0E01\u0E41\u0E16\u0E27" \u0E44\u0E21\u0E48\u0E2A\u0E19\u0E15\u0E31\u0E27\u0E01\u0E23\u0E2D\u0E07 (\u0E43\u0E0A\u0E49\u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E48\u0E2D\u0E19\u0E25\u0E1A)
   all=false/undefined \u2192 \u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E17\u0E35\u0E48\u0E01\u0E23\u0E2D\u0E07\u0E2D\u0E22\u0E39\u0E48 (\u0E1E\u0E24\u0E15\u0E34\u0E01\u0E23\u0E23\u0E21\u0E40\u0E14\u0E34\u0E21) */
function exportCSV(all) {
  if (!matchData.length) { showInfo('\u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25', '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E43\u0E1A\u0E23\u0E31\u0E1A\u0E23\u0E2D\u0E07\u0E43\u0E2B\u0E49\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01'); return; }
  var filtered = all ? matchData.slice() : getFiltered();
  var csv = '\uFEFF';
  /* ไฟล์สำรองต้องมีตัวชี้ไปหาคนด้วย ไม่งั้นกู้กลับมาแล้วการจับคู่ที่ทำไว้หายหมด */
  csv += 'ลำดับ,ชื่อในใบรับรอง,หลักสูตร,วันที่อบรม,วันหมดอายุ,สถานะใบรับรอง,ชื่อในระบบ,สาขา,ตำแหน่ง,Sheet,สถานะจับคู่,รหัสพนักงาน,สาขาตอนอบรม,จับคู่โดย\n';
  filtered.forEach(function(d){
    var es = d.expStatus==='expired'?'หมดอายุ':d.expStatus==='warning'?'ใกล้หมดอายุ':'ยังมีผล';
    var ms = d.matchType==='exact'?'ตรงสนิท':d.matchType==='lastname'?'นามสกุลตรง':'ไม่พบ';
    csv += [d.no,'"'+d.certName+'"','"'+d.course+'"','"'+d.trainDate+'"','"'+d.expireDate+'"','"'+es+'"','"'+(d.empName||'—')+'"','"'+d.branch+'"','"'+d.position+'"','"'+d.sheet+'"','"'+ms+'"','"'+(d.empId||'')+'"','"'+(d.branchAtTrain||'')+'"','"'+(d.matchBy||'')+'"'].join(',')+'\n';
  });
  var blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var d0 = new Date();
  var stamp = d0.getFullYear() + '-' + String(d0.getMonth()+1).padStart(2,'0') + '-' + String(d0.getDate()).padStart(2,'0');
  var a = document.createElement('a'); a.href=url;
  a.download = (all ? 'backup_ใบรับรองทั้งหมด_' : 'training_report_') + stamp + '.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  if (all) showInfo('สำรองข้อมูลแล้ว', 'ดาวน์โหลด ' + filtered.length + ' รายการเป็นไฟล์ CSV — เก็บไฟล์นี้ไว้ก่อนลบข้อมูล');
}
