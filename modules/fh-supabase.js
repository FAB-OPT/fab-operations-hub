/* fh-supabase.js — ชั้นข้อมูล Supabase (โหลดก่อน fh-*.js ตัวอื่นทั้งหมด)
   ═══════════════════════════════════════════════════════════════
   หลักการ: "เปิดใช้เมื่อพร้อมเท่านั้น"
     - ยังไม่ได้ใส่ URL/KEY  → FH_SB.ready = false → ทุกอย่างวิ่ง Apps Script เหมือนเดิมเป๊ะ
     - ใส่แล้ว               → อ่านจาก Supabase · เขียนลงทั้ง 2 ที่ (dual-write)
     - Supabase ล่ม/ตอบพัง   → ถอยไป Apps Script อัตโนมัติ ไม่ค้าง

   dual-write มีไว้ให้ย้อนกลับได้: ช่วงเปลี่ยนผ่าน Sheets ยังมีข้อมูลครบ
   ถ้าอยากเลิก แค่ล้าง FH_SB.url/key แล้วรีเฟรช ระบบกลับไปใช้ Sheets ทันที
   ═══════════════════════════════════════════════════════════════ */

var FH_SB = {
  // ใช้ฐานเดียวกับ HUB และ Training Record · ตารางของเราขึ้นต้น fh_ กันชื่อชน
  url: 'https://cyjfgperenakjeazsfgf.supabase.co',
  key: 'sb_publishable_xAtQvH3Bdaqt7PVJGbkxWw_KVhfBszo',
  on: true,          // false = กลับไปใช้ Google Sheets ทันที
  // เขียนลง Google Sheets ต่อไปด้วยไหม (แนะนำให้เปิดไว้ช่วงแรก ~1-2 เดือน)
  // ยิงเบื้องหลัง ไม่หน่วงผู้ใช้
  dualWrite: true,
  ready: false,
  client: null
};

(function initSb() {
  try {
    var saved = JSON.parse(localStorage.getItem('fh_sb_cfg') || 'null');   // override จากหน้าตั้งค่า
    if (saved && saved.url && saved.key) { FH_SB.url = saved.url; FH_SB.key = saved.key; }
    if (saved && typeof saved.dualWrite === 'boolean') FH_SB.dualWrite = saved.dualWrite;
    if (saved && typeof saved.on === 'boolean') FH_SB.on = saved.on;
  } catch (e) {}
  if (FH_SB.on && FH_SB.url && FH_SB.key && window.supabase && window.supabase.createClient) {
    try {
      FH_SB.client = window.supabase.createClient(FH_SB.url, FH_SB.key);
      FH_SB.ready = true;
      console.log('[FH] Supabase พร้อมใช้งาน');
    } catch (e) { console.warn('[FH] ต่อ Supabase ไม่ได้ — ใช้ Google Sheets ต่อ', e); }
  }
})();

/* เผื่อต้องชี้ไปฐานอื่นในอนาคต — เรียกจาก console ได้: fhSbSaveConfig(url, key) แล้วรีเฟรช */
function fhSbSaveConfig(url, key, dualWrite) {
  localStorage.setItem('fh_sb_cfg', JSON.stringify({ url: url, key: key, on: true, dualWrite: dualWrite !== false }));
}

/* ───────── แปลงชื่อคอลัมน์: Supabase (snake_case) ⇄ รูปแบบที่แอปใช้อยู่ ───────── */
function _sbReqOut(r) {   // Supabase → รูปแบบเดิมของแอป
  return {
    _sbId: r.id, _rowIndex: r.id,
    timestamp: r.ts ? String(r.ts).replace('T', ' ').slice(0, 19) : '',
    name: r.name || '', empId: r.emp_id || '', idCard: r.id_card || '',
    branch: r.branch || '', position: r.position || '', course: r.course || '',
    trainDate: r.train_date || '', timeSlot: r.time_slot || '',
    note: r.note || '', round: r.round || '', brand: r.brand || ''
  };
}
function _sbReqIn(r) {    // รูปแบบเดิมของแอป → Supabase
  var o = {
    name: r.name || '', emp_id: String(r.empId || ''), id_card: String(r.idCard || ''),
    branch: r.branch || '', position: r.position || '', course: r.course || '',
    train_date: String(r.trainDate || ''), time_slot: r.timeSlot || '',
    note: r.note || '', round: r.round || '', brand: r.brand || ''
  };
  if (r.timestamp) o.ts = String(r.timestamp).replace(' ', 'T');
  return o;
}
function _sbCertOut(r) {
  return {
    _sbId: r.id,
    'ชื่อในใบรับรอง': r.cert_name || '', 'หลักสูตร': r.course || '', 'วันอบรม': r.train_date || '',
    'วันหมดอายุ': r.expire_date || '', 'สถานะใบรับรอง': r.exp_status || '', 'ชื่อในระบบ': r.emp_name || '',
    'สาขา': r.branch || '', 'ตำแหน่ง': r.position || '', 'Sheet': r.sheet || '', 'สถานะจับคู่': r.match_type || ''
  };
}
function _sbCertIn(c) {
  return {
    cert_name: c.certName || c['ชื่อในใบรับรอง'] || '', course: c.course || c['หลักสูตร'] || '',
    train_date: String(c.trainDate || c['วันอบรม'] || ''), expire_date: String(c.expireDate || c['วันหมดอายุ'] || ''),
    exp_status: c.expStatus || c['สถานะใบรับรอง'] || '', emp_name: c.empName || c['ชื่อในระบบ'] || '',
    branch: c.branch || c['สาขา'] || '', position: c.position || c['ตำแหน่ง'] || '',
    sheet: c.sheet || c['Sheet'] || '', match_type: c.matchType || c['สถานะจับคู่'] || ''
  };
}
function _sbEmpOut(r) {
  return { _sbId: r.id, name: r.name || '', empId: r.emp_id || '', idCard: r.id_card || '',
           branch: r.branch || '', position: r.position || '', sheet: r.sheet || '' };
}
function _sbEmpIn(e) {
  return { name: e.name || '', emp_id: String(e.empId || ''), id_card: String(e.idCard || ''),
           branch: e.branch || '', position: e.position || '', sheet: e.sheet || '' };
}

/* ───────── อ่าน: Supabase ก่อน ถอยไป Apps Script ถ้าไม่พร้อม/พัง ─────────
   Supabase คืนทีละ 1,000 แถวเป็นค่า default → วนดึงจนครบ */
function _sbSelectAll(table, mapOut) {
  var PAGE = 1000, all = [];
  function page(from) {
    return FH_SB.client.from(table).select('*').order('id', { ascending: true }).range(from, from + PAGE - 1)
      .then(function(res){
        if (res.error) throw res.error;
        var rows = res.data || [];
        all = all.concat(rows.map(mapOut));
        return rows.length < PAGE ? all : page(from + PAGE);
      });
  }
  return page(0);
}
function _sbFallback(action, why) {
  if (why) console.warn('[FH] Supabase อ่านไม่ได้ (' + action + ') → ใช้ Google Sheets แทน', why);
  return fetch(SCRIPT_URL + '?action=' + action + '&_=' + Date.now(), { method: 'GET' })
    .then(function(r){ return r.json(); })
    .then(function(j){ return j.records || []; });
}
function fhLoadRequests()     { return FH_SB.ready ? _sbSelectAll('fh_requests', _sbReqOut).catch(function(e){ return _sbFallback('requests', e); })         : _sbFallback('requests'); }
function fhLoadCertificates() { return FH_SB.ready ? _sbSelectAll('fh_certificates', _sbCertOut).catch(function(e){ return _sbFallback('certificates', e); }) : _sbFallback('certificates'); }
function fhLoadEmployees()    { return FH_SB.ready ? _sbSelectAll('fh_employees', _sbEmpOut).catch(function(e){ return _sbFallback('employees', e); })       : _sbFallback('employees'); }

/* ───────── เขียน: Supabase + Sheets (dual-write) ─────────
   Sheets ถือเป็นตัวสำรอง — ถ้าเขียน Sheets ไม่ผ่านไม่ทำให้งานล้ม แค่ log ไว้ */
function _sheetsPost(payload) {
  return fetch(SCRIPT_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function(r){ return r.json(); });
}
/* ยิงเบื้องหลัง ไม่ให้ผู้ใช้รอ — Supabase คือตัวจริงแล้ว Sheets เป็นแค่สำเนาสำรอง
   ถ้ารอด้วยจะช้าเพิ่มอีก 2-8 วินาทีต่อการกดบันทึก 1 ครั้ง โดยไม่ได้อะไรเพิ่ม */
function _alsoSheets(payload) {
  if (FH_SB.dualWrite) {
    _sheetsPost(payload).catch(function(e){
      console.warn('[FH] เขียนสำเนาสำรองลง Sheets ไม่ผ่าน (ข้อมูลจริงบันทึกแล้ว)', e);
    });
  }
  return Promise.resolve(null);   // ไม่รอผล
}

/* ───────── สิทธิ์ปุ่ม — แหล่งเดียวคือ fh_config.perms บน Supabase ─────────
   เดิมสิทธิ์ถูกเก็บ 3 ที่: Supabase (HUB เขียน) · Sheets (สำเนา) · Firestore (หน้านี้เขียน)
   แล้วแข่งกันโหลด ใครมาทีหลังชนะ → เคยต่างกันจริง 7 จาก 15 ปุ่ม
   ตอนนี้: อ่าน/เขียนที่ Supabase ที่เดียว · Sheets เหลือเป็นสำเนาสำรอง · Firestore เลิกใช้

   สำคัญ: อ่านไม่ได้ต้องคืน null (ไม่ใช่ {}) เพราะ {} จะถูกตีความว่า "ไม่มีใครมีสิทธิ์อะไรเลย"
   ผู้เรียกจะได้รู้ว่าให้ใช้ค่าเดิมที่จำไว้ในเครื่องต่อ แทนที่จะซ่อนปุ่มทิ้งหมด */
function _fhPermsFromSheets() {
  return fetch(SCRIPT_URL + '?action=config&_=' + Date.now())
    .then(function(r){ return r.text(); })
    .then(function(t){
      var j = JSON.parse(t);   // Apps Script คืนหน้า HTML ตอนพัง → ให้ throw ลง catch
      return (j && j.perms && j.perms.foodhandler) || null;
    })
    .catch(function(e){ console.warn('[FH] อ่านสิทธิ์จาก Sheets ไม่ได้ → ใช้ค่าเดิมในเครื่อง', e); return null; });
}
function fhLoadPerms() {
  if (!FH_SB.ready) return _fhPermsFromSheets();
  return FH_SB.client.from('fh_config').select('value').eq('key', 'perms').limit(1)
    .then(function(res){
      if (res.error) throw res.error;
      var row = (res.data || [])[0];
      var all = row && row.value;
      return (all && all.foodhandler) ? all.foodhandler : null;
    })
    .catch(function(e){ console.warn('[FH] อ่านสิทธิ์จาก Supabase ไม่ได้ → ลอง Sheets', e); return _fhPermsFromSheets(); });
}
/* เขียนกลับ: อ่านก้อนรวมของทุกระบบมาก่อน แล้วแก้เฉพาะ foodhandler
   ห้ามเขียนทับทั้งก้อน ไม่งั้นสิทธิ์ของ Checklist/FQA/ข้อสอบ จะหายไปด้วย */
function fhSavePerms(fhPerms) {
  if (!FH_SB.ready) return _sheetsPost({ type: 'set-config', key: 'perms', value: { foodhandler: fhPerms } });
  return FH_SB.client.from('fh_config').select('value').eq('key', 'perms').limit(1)
    .then(function(res){
      if (res.error) throw res.error;
      var row = (res.data || [])[0];
      var all = (row && row.value && typeof row.value === 'object') ? row.value : {};
      all.foodhandler = fhPerms;
      return FH_SB.client.from('fh_config')
        .upsert({ key: 'perms', value: all, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .then(function(r2){
          if (r2.error) throw r2.error;
          _alsoSheets({ type: 'set-config', key: 'perms', value: all });   // สำเนาสำรอง ไม่รอผล
          return true;
        });
    });
}

function fhSaveRequests(records) {
  if (!FH_SB.ready) return _sheetsPost({ type: 'save-requests', records: records });
  return FH_SB.client.from('fh_requests').insert(records.map(_sbReqIn)).select('id')
    .then(function(res){
      if (res.error) throw res.error;
      return _alsoSheets({ type: 'save-requests', records: records })
        .then(function(){ return { ok: true, saved: (res.data || []).length }; });
    })
    .catch(function(e){
      console.warn('[FH] Supabase เขียนไม่ผ่าน → ใช้ Sheets แทน', e);
      return _sheetsPost({ type: 'save-requests', records: records });
    });
}

/* jobs = [{rec, record}] — rec ต้องมี _sbId ถึงจะอัปเดตผ่าน Supabase ได้
   onProgress(done, total) — Supabase จบทีเดียว จึงยิงแค่ 0/total แล้ว total/total */
function fhBulkUpdateRequests(jobs, onProgress) {
  if (!FH_SB.ready || jobs.some(function(j){ return !j.rec || j.rec._sbId == null; })) {
    return _fhBulkUpdate(jobs, onProgress);   // ของเดิม (Apps Script bulk + fallback ทีละแถว)
  }
  if (onProgress) onProgress(0, jobs.length);
  var ups = jobs.map(function(j){ var o = _sbReqIn(j.record); o.id = j.rec._sbId; delete o.ts; return o; });
  return FH_SB.client.from('fh_requests').upsert(ups, { onConflict: 'id' })
    .then(function(res){
      if (res.error) throw res.error;
      return _alsoSheets({ type: 'bulk-update-requests', updates: jobs.map(function(j){
        return { key: _fhReqKey(j.rec), record: j.record };
      }) }).then(function(){
        if (onProgress) onProgress(jobs.length, jobs.length);
        return { done: jobs.length, failed: 0 };
      });
    })
    .catch(function(e){ console.warn('[FH] Supabase อัปเดตไม่ผ่าน → ใช้ Sheets แทน', e); return _fhBulkUpdate(jobs, onProgress); });
}

function fhBulkDeleteRequests(records, onProgress) {
  if (!FH_SB.ready || records.some(function(r){ return r._sbId == null; })) {
    return _fhBulkDelete(records, onProgress);
  }
  if (onProgress) onProgress(0, records.length);
  var ids = records.map(function(r){ return r._sbId; });
  return FH_SB.client.from('fh_requests').delete().in('id', ids)
    .then(function(res){
      if (res.error) throw res.error;
      return _alsoSheets({ type: 'bulk-delete-requests', keys: records.map(_fhReqKey) })
        .then(function(){
          if (onProgress) onProgress(records.length, records.length);
          return { done: ids.length, failed: 0 };
        });
    })
    .catch(function(e){ console.warn('[FH] Supabase ลบไม่ผ่าน → ใช้ Sheets แทน', e); return _fhBulkDelete(records, onProgress); });
}

/* ───────── ย้ายข้อมูลครั้งแรก: Sheets → Supabase ─────────
   ปลอดภัย: อ่านจาก Sheets อย่างเดียว ไม่แตะข้อมูลต้นทาง
   กันซ้ำ: ถ้าตารางปลายทางมีข้อมูลอยู่แล้ว จะไม่ยัดซ้ำเว้นแต่สั่ง force */
function fhSbMigrate(opts) {
  opts = opts || {};
  if (!FH_SB.ready) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า Supabase'));
  var jobs = [
    { action: 'requests',     table: 'fh_requests',     map: _sbReqIn  },
    { action: 'certificates', table: 'fh_certificates', map: _sbCertIn },
    { action: 'employees',    table: 'fh_employees',    map: _sbEmpIn  }
  ];
  var report = [];
  var seq = Promise.resolve();
  jobs.forEach(function(j){
    seq = seq.then(function(){
      return FH_SB.client.from(j.table).select('id', { count: 'exact', head: true })
        .then(function(res){
          var have = res.count || 0;
          if (have > 0 && !opts.force) { report.push({ table: j.table, skipped: true, have: have }); return; }
          if (opts.onStep) opts.onStep('กำลังอ่าน ' + j.action + ' จาก Google Sheets...');
          return fetch(SCRIPT_URL + '?action=' + j.action + '&_=' + Date.now())
            .then(function(r){ return r.json(); })
            .then(function(g){
              var rows = (g.records || []).map(j.map);
              if (!rows.length) { report.push({ table: j.table, inserted: 0 }); return; }
              // ยัดทีละ 500 แถว กัน payload ใหญ่เกิน
              var CH = 500, done = 0;
              function chunk(i) {
                if (i >= rows.length) { report.push({ table: j.table, inserted: done }); return; }
                if (opts.onStep) opts.onStep(j.action + ': ' + i + '/' + rows.length);
                return FH_SB.client.from(j.table).insert(rows.slice(i, i + CH))
                  .then(function(res2){
                    if (res2.error) throw res2.error;
                    done += Math.min(CH, rows.length - i);
                    return chunk(i + CH);
                  });
              }
              return chunk(0);
            });
        });
    });
  });
  return seq.then(function(){ return report; });
}

/* เทียบจำนวนแถว 2 ฝั่ง — ใช้ตรวจหลังย้ายว่าครบไหม */
function fhSbCompare() {
  if (!FH_SB.ready) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า Supabase'));
  var pairs = [['requests','fh_requests'], ['certificates','fh_certificates'], ['employees','fh_employees']];
  return Promise.all(pairs.map(function(p){
    return Promise.all([
      fetch(SCRIPT_URL + '?action=' + p[0] + '&_=' + Date.now()).then(function(r){ return r.json(); }).then(function(j){ return (j.records || []).length; }),
      FH_SB.client.from(p[1]).select('id', { count: 'exact', head: true }).then(function(r){ return r.count || 0; })
    ]).then(function(n){ return { name: p[0], sheets: n[0], supabase: n[1], same: n[0] === n[1] }; });
  }));
}

/* หน้าตั้งค่าที่เก็บข้อมูลย้ายไปรวมที่ HUB แล้ว (⚙️ เครื่องมือผู้ดูแลระบบ → 🗄️ ที่เก็บข้อมูล)
   ฟังก์ชัน UI เดิม (sbRenderStatus/sbRunMigrate/sbRunCompare/sbClearCfg) ถูกลบออก
   ส่วน fhSbMigrate/fhSbCompare ที่เหลือไว้ เผื่อเรียกจาก console ตอนแก้ปัญหาเฉพาะหน้า */
var FH_BUILD = '2026-08-07 · 19:10';   // บัมพ์ทุกครั้งที่แก้ fh-*.js
