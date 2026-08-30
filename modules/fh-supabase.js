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

/* ───────── เวลา: Supabase เก็บเป็น UTC · หน้าจอต้องเป็นเวลาไทย ─────────
   ts ที่ฐานประทับเองด้วย now() จะลงท้าย +00:00 ซึ่งช้ากว่าเวลาไทย 7 ชั่วโมง
   ของเดิมตัดสตริงตรง ๆ ("วันที่ส่ง" บนหน้าจอจึงเป็นเวลา UTC ไม่ใช่เวลาจริง)
   ไทยไม่มีเวลาออมแสง จึงบวก 7 ชั่วโมงคงที่ได้ทั้งปี */
function _fhTsToThai(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  // ไม่มีโซนเวลาต่อท้าย = ค่าที่เป็นเวลาไทยอยู่แล้ว (เช่นทางสำรอง Google Sheets) ไม่ต้องแปลง
  if (!/([zZ]|[+\-]\d{2}:?\d{2})$/.test(s)) return s.replace('T', ' ').slice(0, 19);
  var d = new Date(s);
  if (isNaN(d.getTime())) return s.replace('T', ' ').slice(0, 19);
  var t = new Date(d.getTime() + 7 * 3600000);
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate())
       + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds());
}

/* ขากลับ: สตริงเวลาไทยแบบไม่มีโซน ต้องติด +07:00 ไปด้วย
   ไม่งั้น Postgres จะอ่านเป็น UTC แล้วเวลาจะเลื่อนไป 7 ชั่วโมงทุกครั้งที่แก้ไขแถวนั้น */
function _fhThaiToIso(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return s;
  s = s.replace(' ', 'T');
  if (/([zZ]|[+\-]\d{2}:?\d{2})$/.test(s)) return s;
  return s + '+07:00';
}

/* ───────── แปลงชื่อคอลัมน์: Supabase (snake_case) ⇄ รูปแบบที่แอปใช้อยู่ ───────── */
function _sbReqOut(r) {   // Supabase → รูปแบบเดิมของแอป
  return {
    _sbId: r.id, _rowIndex: r.id,
    timestamp: _fhTsToThai(r.ts),
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
  if (r.timestamp) o.ts = _fhThaiToIso(r.timestamp);
  return o;
}
function _sbCertOut(r) {
  return {
    _sbId: r.id,
    'ชื่อในใบรับรอง': r.cert_name || '', 'หลักสูตร': r.course || '', 'วันอบรม': r.train_date || '',
    'วันหมดอายุ': r.expire_date || '', 'สถานะใบรับรอง': r.exp_status || '', 'ชื่อในระบบ': r.emp_name || '',
    'สาขา': r.branch || '', 'ตำแหน่ง': r.position || '', 'Sheet': r.sheet || '',
    /* 'manual' ที่ฝากไว้ในช่องสถานะ แปลงกลับเป็น "จับคู่แล้ว + คนเป็นคนตัดสิน" */
    'สถานะจับคู่': (r.match_type === 'manual' ? 'exact' : (r.match_type || '')),
    /* ตัวชี้ไปหาคนในทะเบียน — ถ้าตารางยังไม่มีคอลัมน์พวกนี้จะได้ค่าว่าง
       แล้วระบบจะผูกให้ใหม่เองจากชื่อ (ดู _fhRelinkCerts) ไม่พัง */
    'รหัสพนักงาน': r.emp_id || '', 'เลขบัตรประชาชน': r.id_card || '',
    'สาขาตอนอบรม': r.branch_at_train || '',
    'จับคู่โดย': r.match_by || (r.match_type === 'manual' ? 'manual' : '')
  };
}
/* คอลัมน์ชุดเดิม — ใช้ตอนตารางยังไม่ได้เพิ่มคอลัมน์ใหม่ */
/* ที่เก็บบางที่ยังไม่มีช่อง "จับคู่โดย" · ใบที่คนจับคู่เองจึงกลายเป็นใบธรรมดา
   แล้วรอบหน้าระบบจะจับไปผูกกับคนอื่นทับงานที่คนทำไว้
   ฝากไว้ในช่องสถานะจับคู่แทน — ช่องนั้นมีอยู่แล้วทุกที่ และค่า 'manual'
   ก็บอกความจริงของใบนั้นตรง ๆ อยู่แล้วว่า "คนเป็นคนตัดสิน" */
function _sbMatchType(c) {
  var by = c.matchBy || c['จับคู่โดย'] || '';
  if (by === 'manual') return 'manual';
  return c.matchType || c['สถานะจับคู่'] || '';
}
function _sbCertInBase(c) {
  return {
    cert_name: c.certName || c['ชื่อในใบรับรอง'] || '', course: c.course || c['หลักสูตร'] || '',
    train_date: String(c.trainDate || c['วันอบรม'] || ''), expire_date: String(c.expireDate || c['วันหมดอายุ'] || ''),
    exp_status: c.expStatus || c['สถานะใบรับรอง'] || '', emp_name: c.empName || c['ชื่อในระบบ'] || '',
    branch: c.branch || c['สาขา'] || '', position: c.position || c['ตำแหน่ง'] || '',
    sheet: c.sheet || c['Sheet'] || '', match_type: _sbMatchType(c)
  };
}
function _sbCertIn(c) {
  var o = _sbCertInBase(c);
  o.emp_id = String(c.empId || c['รหัสพนักงาน'] || '');
  o.id_card = String(c.idCard || c['เลขบัตรประชาชน'] || '');
  o.branch_at_train = c.branchAtTrain || c['สาขาตอนอบรม'] || '';
  o.match_by = c.matchBy || c['จับคู่โดย'] || '';
  return o;
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
  /* ตัดคำนำหน้าที่ปลายทางเดียว — คำขอเข้ามาได้หลายทาง (กรอกในฟอร์ม · นำเข้าจากไฟล์)
     ดักที่นี่ทางเดียวจึงครอบคลุมทุกทาง และทางที่เพิ่มมาทีหลังก็ได้ไปด้วยเอง */
  if (typeof fhStripTitle === 'function') {
    (records || []).forEach(function(r){ if (r && r.name) r.name = fhStripTitle(r.name) || r.name; });
  }
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

/* บันทึก/ลบ ทะเบียนรายชื่อพนักงาน
   บั๊กเดิม: หน้าเว็บ "อ่าน" ทะเบียนจาก Supabase แต่ "เขียน" ไป Apps Script อย่างเดียว
   กดลบทะเบียนจึงลบแค่ใน Google Sheet ส่วน Supabase ยังอยู่ครบ พอโหลดใหม่ก็กลับมาเหมือนเดิม
   (อาการเดียวกับปุ่มลบ/แก้ไขคำขออบรมที่แก้ไปแล้ว)
   replaceAll = ล้างของเดิมทั้งตารางก่อนใส่ชุดใหม่ */
function fhSaveEmployees(records, replaceAll) {
  var recs = records || [];
  if (!FH_SB.ready) return _sheetsPost({ type: 'save-employees', records: recs, replaceAll: !!replaceAll });

  var step = replaceAll
    ? FH_SB.client.from('fh_employees').delete().gte('id', 0).then(function(res){ if (res.error) throw res.error; })
    : Promise.resolve();

  return step
    .then(function(){
      if (!recs.length) return { count: 0 };
      // ยัดทีละ 500 แถว กัน payload ใหญ่เกินจนถูกตัด
      var CH = 500, rows = recs.map(_sbEmpIn);
      function chunk(i) {
        if (i >= rows.length) return { count: rows.length };
        return FH_SB.client.from('fh_employees').insert(rows.slice(i, i + CH))
          .then(function(res){ if (res.error) throw res.error; return chunk(i + CH); });
      }
      return chunk(0);
    })
    .then(function(r){
      _alsoSheets({ type: 'save-employees', records: recs, replaceAll: !!replaceAll });
      return { ok: true, saved: r.count };
    })
    .catch(function(e){
      console.warn('[FH] เขียนทะเบียนที่ Supabase ไม่ผ่าน → ใช้ Sheets แทน', e);
      return _sheetsPost({ type: 'save-employees', records: recs, replaceAll: !!replaceAll });
    });
}

/* ═══ บันทึกใบรับรอง ═══
   ของเดิมมีแต่ "อ่าน" จาก Supabase ส่วน "เขียน" ยิงไป Google Sheets อย่างเดียว
   ใบที่บันทึกหลังย้ายข้อมูลจึงไม่เคยขึ้นให้ใครเห็น — หน้าจอค้างอยู่ที่จำนวนตอนย้าย
   (ตรวจกับของจริง: Sheets 757 ใบ · Supabase 652 ใบ ซึ่งเป็นจำนวน ณ วันย้าย)
   ทะเบียนพนักงานมีตัวเขียนอยู่แล้ว (fhSaveEmployees) ใบรับรองตกหล่นไปตัวเดียว */
function fhSaveCertificates(records, opts) {
  var recs = records || [];
  var body = { type: 'save-certificates', records: recs };
  if (opts && opts.confirmShrink) body.confirmShrink = true;
  if (!FH_SB.ready) return _sheetsPost(body);

  function push(rows) {
    return FH_SB.client.from('fh_certificates').delete().gte('id', 0)
      .then(function(res){ if (res.error) throw res.error; })
      .then(function(){
        if (!rows.length) return { count: 0 };
        var CH = 500;                       // ยัดทีละ 500 แถว กัน payload ใหญ่เกินจนถูกตัด
        function chunk(i) {
          if (i >= rows.length) return { count: rows.length };
          return FH_SB.client.from('fh_certificates').insert(rows.slice(i, i + CH))
            .then(function(res){ if (res.error) throw res.error; return chunk(i + CH); });
        }
        return chunk(0);
      });
  }

  return push(recs.map(_sbCertIn))
    .catch(function(e){
      /* ตารางยังไม่มีคอลัมน์ใหม่ (ยังไม่ได้รัน supabase-fh-cert-link.sql)
         ส่งเฉพาะคอลัมน์เดิมไปก่อน ดีกว่าล้มทั้งการบันทึกแล้วของใหม่ไม่ขึ้นให้ใครเห็น */
      var msg = String((e && (e.message || e.hint || e.details)) || e);
      if (!/column|schema|does not exist|PGRST204/i.test(msg)) throw e;
      console.warn('[FH] ตาราง fh_certificates ยังไม่มีคอลัมน์ตัวชี้ — บันทึกเฉพาะคอลัมน์เดิมไปก่อน', e);
      return push(recs.map(_sbCertInBase));
    })
    .then(function(r){
      _alsoSheets(body);                    // เขียน Google Sheets ต่อไปด้วยเป็นสำเนาสำรอง
      return { ok: true, saved: r.count };
    })
    .catch(function(e){
      console.warn('[FH] เขียนใบรับรองที่ Supabase ไม่ผ่าน → ใช้ Sheets แทน', e);
      return _sheetsPost(body);
    });
}

/* แก้ไขคำขอทีละรายการ — อาการเดียวกับปุ่มลบ
   เดิมยิง update-request ไป Apps Script โดยส่ง rowIndex ที่จริงคือ id ของ Supabase
   Sheets หาแถวไม่เจอ → "not found" และต่อให้เจอ ข้อมูลจริงบน Supabase ก็ไม่ถูกแก้ */
function fhUpdateRequest(key, record) {
  var id = key && key.sbId;
  if (!FH_SB.ready || id === '' || id == null) {
    return _sheetsPost({ type: 'update-request', key: key, record: record });
  }
  return FH_SB.client.from('fh_requests').update(_sbReqIn(record)).eq('id', id).select('id')
    .then(function(res){
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) return { ok: false, error: 'ไม่พบรายการนี้แล้ว (อาจถูกลบไปก่อนหน้า)' };
      _alsoSheets({ type: 'update-request', key: key, record: record });
      return { ok: true };
    })
    .catch(function(e){
      console.warn('[FH] แก้ไขที่ Supabase ไม่ผ่าน → ลอง Sheets', e);
      return _sheetsPost({ type: 'update-request', key: key, record: record });
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

/* ลบคำขอทีละรายการ — ตัวจริงอยู่ที่ Supabase, Sheets เป็นสำเนาสำรอง
   คืนรูปแบบเดียวกับที่ Apps Script เคยคืน ({ok:true} / {ok:false,error}) ผู้เรียกจึงไม่ต้องแก้
   ถ้าไม่มี id ของ Supabase (ข้อมูลเก่าที่ยังไม่ได้ย้าย) ให้ถอยไปใช้ Sheets แบบเดิม */
function fhDeleteRequest(key) {
  var id = key && key.sbId;
  if (!FH_SB.ready || id === '' || id == null) return _sheetsPost({ type: 'delete-request', key: key });
  return FH_SB.client.from('fh_requests').delete().eq('id', id).select('id')
    .then(function(res){
      if (res.error) throw res.error;
      /* ไม่มีแถวถูกลบ = id นั้นไม่มีอยู่จริง ต้องบอกให้รู้ ไม่ใช่รายงานว่าสำเร็จ
         ไม่งั้นแถวจะหายจากจอแต่ข้อมูลยังอยู่ พอรีเฟรชก็กลับมา */
      if (!res.data || !res.data.length) return { ok: false, error: 'ไม่พบรายการนี้แล้ว (อาจถูกลบไปก่อนหน้า)' };
      _alsoSheets({ type: 'delete-request', key: key });   // สำเนาสำรอง ไม่รอผล
      return { ok: true };
    })
    .catch(function(e){
      console.warn('[FH] ลบที่ Supabase ไม่ผ่าน → ลอง Sheets', e);
      return _sheetsPost({ type: 'delete-request', key: key });
    });
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
var FH_BUILD = '2026-08-10 · 09:30';   // บัมพ์ทุกครั้งที่แก้ fh-*.js
