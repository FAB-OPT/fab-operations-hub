/* ═══════════════════════════════════════════════════════════════
   FAB Operations Hub — Apps Script Backend (Code.gs)
   Sheets: Certificates, Requests, Config, Employees, Exams, ExamResults
   OCR: Google Cloud Vision API (Script Property: VISION_API_KEY)

   อัปเดต: getConfig() คืน users + branches เพิ่ม → ซิงค์ข้ามอุปกรณ์
   อัปเดต: เพิ่มระบบสอบออนไลน์ (Exams / ExamResults)
   อัปเดต: เพิ่ม clear-certificates → ลบใบรับรองทั้งหมด (เก็บหัวตาราง)
   อัปเดต (ล่าสุด): tombstone การลบข้ามอุปกรณ์ (ชีต FqaDeleted) → ลบแล้วไม่เด้งกลับ
   วิธีใช้: ก๊อปทั้งไฟล์นี้ทับใน Apps Script editor → Save → Deploy (New version)
   ═══════════════════════════════════════════════════════════════ */

/* เวอร์ชันของ backend — ส่งกลับใน getConfig เพื่อให้หน้าเว็บรู้ว่า deploy ตัวไหนอยู่
   บัมพ์ทุกครั้งที่แก้ไฟล์นี้ · ถ้าหน้าเว็บเห็นเลขเก่ากว่าที่คาด จะเตือนให้ deploy ใหม่ */
// บัมพ์เลขนี้ทุกครั้งที่แก้ไฟล์นี้ แล้วเช็คหลัง deploy ด้วย ?action=counts
// (ถ้า counts คืนรายชื่อใบรับรองแทนตัวเลข = ยังเป็นตัวเก่าอยู่ ยังไม่ได้ deploy)
var BACKEND_VERSION = '2026-09-13';

var CACHE_SEC = 300;
// 'round' = รุ่นที่ ณ ตอนส่งรายชื่อ (snapshot) — กันตารางอบรมเปลี่ยนแล้วรายชื่อเก่าย้ายรุ่นตาม
var REQ_HEADERS = ['timestamp','name','empId','idCard','branch','position','course','trainDate','timeSlot','note','round'];
var EMP_HEADERS = ['name','empId','idCard','branch','position','sheet'];

/* ───────────────────────── ROUTER ───────────────────────── */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    var branch = (e && e.parameter && e.parameter.branch) || '';
    if (action === 'certificates') return jsonOut(getCertificates());
    if (action === 'employees')    return jsonOut(getEmployees());
    if (action === 'requests')     return jsonOut(getRequests(branch));
    if (action === 'config')       return jsonOut(getConfig());
    if (action === 'exams')        return jsonOut(getExams());
    if (action === 'exam-results') return jsonOut(getExamResults());
    if (action === 'exam-requests') return jsonOut(getExamRequests(e.parameter.branch, e.parameter.scope));
    if (action === 'fqa-records')  return jsonOut(getFqaRecords((e && e.parameter && e.parameter.brand) || '', (e && e.parameter && e.parameter.since) || ''));
    if (action === 'counts')       return jsonOut(getCounts());   // นับแถวอย่างเดียว ไม่ต้องโหลดข้อมูลทั้งก้อน
    if (action === 'clear-cache')  return jsonOut(clearAllCacheReturn());
    return jsonOut(getCertificates());
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.type === 'save-certificates')  return jsonOut(saveCertificates(data.records, data.confirmShrink));
    if (data.type === 'save-employees')     return jsonOut(saveEmployees(data.records, data.replaceAll));
    if (data.type === 'save-requests')      return jsonOut(saveRequests(data.records));
    if (data.type === 'request')            return jsonOut(saveRequests(data.records));  // alias กัน client เก่า
    if (data.type === 'delete-request')     return jsonOut(deleteRequest(data.key));
    if (data.type === 'update-request')     return jsonOut(updateRequest(data.key, data.record));
    // งานหมู่: อ่านชีตครั้งเดียว เขียนครั้งเดียว — เร็วกว่ายิงทีละแถวหลายสิบเท่า
    if (data.type === 'bulk-update-requests') return jsonOut(bulkUpdateRequests(data.updates));
    if (data.type === 'bulk-delete-requests') return jsonOut(bulkDeleteRequests(data.keys));
    if (data.type === 'dedup-employees')    return jsonOut(dedupEmployees());
    if (data.type === 'dedup-certificates') return jsonOut(dedupCertificates());
    if (data.type === 'clear-certificates') return jsonOut(clearCertificates());
    if (data.type === 'set-config')         return jsonOut(setConfig(data.key, data.value));
    if (data.type === 'upload-icon')        return jsonOut(uploadIcon(data.base64, data.filename));
    if (data.type === 'save-exam')          return jsonOut(saveExam(data.exam));
    if (data.type === 'delete-exam')        return jsonOut(deleteExam(data.id));
    if (data.type === 'submit-exam-result') return jsonOut(saveExamResult(data.result));
    if (data.type === 'request-exam')       return jsonOut(saveExamRequest(data.req));
    if (data.type === 'decide-exam-request')return jsonOut(decideExamRequest(data.id, data.decision, data.by, data.note));
    if (data.type === 'verify-exam-code')   return jsonOut(verifyExamCode(data.code, data.examId));
    if (data.type === 'use-exam-code')      return jsonOut(useExamCode(data.code));
    if (data.type === 'delete-exam-request')return jsonOut(deleteExamRequest(data.id));
    if (data.type === 'delete-exam-result') return jsonOut(deleteExamResult(data.submittedAt, data.empId, data.examId));
    if (data.type === 'save-fqa-record')    return jsonOut(saveFqaRecord(data.record));
    if (data.type === 'delete-fqa-record')  return jsonOut(deleteFqaRecord(data.id));
    if (data.type === 'upload-fqa-photo')   return jsonOut(uploadFqaPhoto(data.base64, data.filename));
    if (data.type === 'clear-cache')        return jsonOut(clearAllCacheReturn());
    if (data.type === 'ocr-image')          return ocrImage(data.imageBase64, data.filename, data.mimeType);
    return jsonOut({ ok: false, error: 'unknown type: ' + data.type });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ──────────────────── CERTIFICATES ──────────────────── */
function getCertificates() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('cert_v2');
  if (cached) return JSON.parse(cached);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Certificates');
  if (!sh) return { ok: true, records: [] };
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: true, records: [] };
  var headers = values[0].map(function(h){ return String(h).trim(); });
  var records = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[0] && !row[1]) continue;
    var rec = {};
    headers.forEach(function(h, j){ rec[h] = row[j]; });
    records.push(rec);
  }
  var out = { ok: true, records: records };
  try { cache.put('cert_v2', JSON.stringify(out), CACHE_SEC); } catch(e) {}
  return out;
}

function saveCertificates(records, confirmShrink) {
  if (!Array.isArray(records) || records.length === 0) return { ok: false, error: 'no records' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Certificates') || ss.insertSheet('Certificates');

    /* กันประวัติหายทั้งชีต — การบันทึกที่นี่เป็นแบบ "ล้างแล้วเขียนใหม่ทั้งหมด"
       เว็บจะโหลดของเดิมมารวมกับของใหม่ก่อนส่งเสมอ แต่ถ้ารอบนั้นโหลดของเดิมไม่สำเร็จ
       (เน็ตสะดุด / Google ส่งคำตอบไม่ถึง) แล้วผู้ใช้กดบันทึก ชีตจะเหลือเท่าที่เครื่องนั้นถืออยู่
       ลบทีละใบ (ห่างจากของเดิมไม่กี่แถว) ยังทำได้ตามปกติ
       แต่ถ้าจำนวนหายไปมากผิดปกติ ให้ปฏิเสธไว้ก่อน แล้วบอกให้โหลดใหม่
       จะล้างจริง ๆ ใช้ "ลบใบรับรองทั้งหมด" ซึ่งเป็นคำสั่งแยกที่ตั้งใจกดเอง */
    var had = Math.max(0, sh.getLastRow() - 1);
    var drop = had - records.length;
    var allow = Math.max(5, Math.floor(had * 0.1));
    if (!confirmShrink && drop > allow) {
      return { ok: false, error: 'ของเดิมมี ' + had + ' ใบ แต่ที่ส่งมามี ' + records.length +
        ' ใบ (หายไป ' + drop + ') — ไม่บันทึกทับไว้ก่อน กัน "โหลดของเดิมไม่ครบแล้วเขียนทับ" ' +
        '· กดรีเฟรชให้โหลดครบก่อนแล้วลองใหม่' };
    }

    /* คอลัมน์ตัวชี้ไปหาคนในทะเบียน — ชื่อ/สาขา/ตำแหน่ง เปลี่ยนได้ตลอด จึงเชื่อไม่ได้
       รหัสพนักงานคือสิ่งเดียวที่อยู่ทน · สาขาตอนอบรมเก็บแยกเป็นประวัติ ไม่ตามคนไป */
    var headers = ['ชื่อในใบรับรอง','หลักสูตร','วันอบรม','วันหมดอายุ','สถานะใบรับรอง','ชื่อในระบบ','สาขา','ตำแหน่ง','Sheet','สถานะจับคู่','รหัสพนักงาน','เลขบัตรประชาชน','สาขาตอนอบรม','จับคู่โดย'];
    sh.clear();
    sh.appendRow(headers);
    var rows = records.map(function(r){
      return [r.certName||'', r.course||'', r.trainDate||'', r.expireDate||'', r.expStatus||'',
              r.empName||'', r.branch||'', r.position||'', r.sheet||'', r.matchType||'',
              r.empId||'', r.idCard||'', r.branchAtTrain||'', r.matchBy||''];
    });
    if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
    CacheService.getScriptCache().remove('cert_v2');
    return { ok: true, saved: rows.length, replaced: had };
  } finally { lock.releaseLock(); }
}

function dedupCertificates() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Certificates');
    if (!sh) return { ok: false, error: 'sheet not found' };
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return { ok: true, kept: 0, removed: 0 };
    var header = values[0];
    var seen = {}; var kept = [header]; var removed = 0;
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      var key = String(row[0]||'').replace(/\s/g,'') + '|' + String(row[3]||'');
      if (!key.replace(/[|]/g,'')) continue;
      if (seen[key]) { removed++; continue; }
      seen[key] = true;
      kept.push(row);
    }
    sh.clear();
    sh.getRange(1, 1, kept.length, header.length).setValues(kept);
    CacheService.getScriptCache().remove('cert_v2');
    return { ok: true, kept: kept.length - 1, removed: removed };
  } finally { lock.releaseLock(); }
}

/* ลบใบรับรองทั้งหมด — ล้างทั้งชีตแล้วใส่หัวตารางกลับ (แบบเดียวกับ saveCertificates ที่ทำงานชัวร์)
   ⚠️ ต้องมี sh.clear() + sh.appendRow(headers) — ถ้าขาดจะ "ตอบสำเร็จแต่ไม่ลบจริง" */
function clearCertificates() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Certificates');
    if (!sh) return { ok: true, cleared: 0 };
    var last = sh.getLastRow();
    var headers = ['ชื่อในใบรับรอง','หลักสูตร','วันอบรม','วันหมดอายุ','สถานะใบรับรอง','ชื่อในระบบ','สาขา','ตำแหน่ง','Sheet','สถานะจับคู่'];
    sh.clear();
    sh.appendRow(headers);
    CacheService.getScriptCache().remove('cert_v2');
    return { ok: true, cleared: last > 1 ? last - 1 : 0 };
  } finally { lock.releaseLock(); }
}

/* ──────────────────── EMPLOYEES ──────────────────── */
function getEmployees() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('emp_v1');
  if (cached) return JSON.parse(cached);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Employees');
  if (!sh) return { ok: true, records: [] };
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: true, records: [] };
  var records = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue;
    var rec = {};
    EMP_HEADERS.forEach(function(h, j){ rec[h] = row[j] != null ? row[j] : ''; });
    records.push(rec);
  }
  var out = { ok: true, records: records };
  try { cache.put('emp_v1', JSON.stringify(out), CACHE_SEC); } catch(e) {}
  return out;
}

function saveEmployees(records, replaceAll) {
  if (!Array.isArray(records)) return { ok: false, error: 'no records' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Employees') || ss.insertSheet('Employees');
    if (replaceAll) { sh.clear(); sh.appendRow(EMP_HEADERS); }
    else if (sh.getLastRow() === 0) sh.appendRow(EMP_HEADERS);
    if (records.length > 0) {
      var rows = records.map(function(r){
        return EMP_HEADERS.map(function(h){ return r[h] != null ? r[h] : ''; });
      });
      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, rows.length, EMP_HEADERS.length).setValues(rows);
    }
    CacheService.getScriptCache().remove('emp_v1');
    return { ok: true, saved: records.length };
  } finally { lock.releaseLock(); }
}

function dedupEmployees() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Employees');
    if (!sh) return { ok: false, error: 'sheet not found' };
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return { ok: true, kept: 0, removed: 0 };
    var header = values[0];
    var seen = {}; var kept = [header]; var removed = 0;
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      var key = String(row[0]||'').replace(/\s/g,'') + '|' + String(row[3]||'');
      if (!key.replace(/[|]/g,'')) continue;
      if (seen[key]) { removed++; continue; }
      seen[key] = true;
      kept.push(row);
    }
    sh.clear();
    sh.getRange(1, 1, kept.length, header.length).setValues(kept);
    CacheService.getScriptCache().remove('emp_v1');
    return { ok: true, kept: kept.length - 1, removed: removed };
  } finally { lock.releaseLock(); }
}

/* ──────────────────── REQUESTS ──────────────────── */
function getRequests(branchFilter) {
  var cacheKey = branchFilter ? 'req_v2_' + branchFilter : 'req_v2';
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Requests');
  if (!sh) return { ok: true, records: [] };
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: true, records: [] };
  var records = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[1]) continue;
    // Filter by branch (column 4 = branch) — server-side opt
    if (branchFilter && String(row[4]||'') !== String(branchFilter)) continue;
    var rec = { _rowIndex: i + 1 };
    REQ_HEADERS.forEach(function(h, j){
      var v = row[j] != null ? row[j] : '';
      // เซลล์ที่เป็น Date ต้องแปลงเป็นข้อความก่อนส่งออก ไม่งั้น client ได้ ISO ดิบ (2569-01-31T17:00:00.000Z)
      if (v instanceof Date) {
        v = (h === 'round') ? roundToText_(v)
                            : Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
      }
      rec[h] = v;
    });
    records.push(rec);
  }
  var out = { ok: true, records: records };
  try { cache.put(cacheKey, JSON.stringify(out), CACHE_SEC); } catch(e) {}
  return out;
}

function clearReqCache_() {
  try { CacheService.getScriptCache().remove('req_v2'); } catch(e) {}
  // cache ราย branch จะ expire ตาม TTL 5 นาที
}

/* เติมหัวคอลัมน์ที่เพิ่มใหม่ (เช่น round) ให้ชีตเดิมที่สร้างไว้ก่อนหน้า */
function ensureReqHeaders_(sh) {
  try {
    var lastCol = sh.getLastColumn();
    if (lastCol < REQ_HEADERS.length) {
      var have = sh.getRange(1, 1, 1, lastCol).getValues()[0];
      for (var i = lastCol; i < REQ_HEADERS.length; i++) have.push(REQ_HEADERS[i]);
      sh.getRange(1, 1, 1, REQ_HEADERS.length).setValues([have]);
    }
  } catch (e) {}
  forceTextCols_(sh);
}

/* บังคับคอลัมน์ที่เป็น "ข้อความที่หน้าตาเหมือนวันที่" ให้เป็น plain text
   ไม่งั้น Sheets แปลง "2/2569" เป็นวันที่ 1 ก.พ. 2569 ให้เองตอน setValues
   ต้องตั้งรูปแบบ "ก่อน" เขียนค่าเสมอ ตั้งทีหลังไม่ช่วย ค่าถูกแปลงไปแล้ว */
function forceTextCols_(sh) {
  try {
    var rows = Math.max(sh.getMaxRows(), 2);
    ['round', 'trainDate', 'timeSlot', 'idCard', 'empId'].forEach(function(h){
      var col = REQ_HEADERS.indexOf(h) + 1;
      if (col > 0) sh.getRange(1, col, rows, 1).setNumberFormat('@');
    });
  } catch (e) {}
}

/* ค่าที่โดน Sheets แปลงเป็นวันที่ไปแล้ว → กู้กลับเป็น "เดือน/ปี" ตามที่พิมพ์มาตอนแรก */
function roundToText_(v) {
  if (!(v instanceof Date)) return v == null ? '' : v;
  try {
    return Number(Utilities.formatDate(v, 'Asia/Bangkok', 'M')) + '/' +
           Number(Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy'));
  } catch (e) { return String(v); }
}

function saveRequests(records) {
  if (!Array.isArray(records) || records.length === 0) return { ok: false, error: 'no records' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Requests') || ss.insertSheet('Requests');
    if (sh.getLastRow() === 0) { sh.appendRow(REQ_HEADERS); forceTextCols_(sh); }
    else ensureReqHeaders_(sh);   // เติมหัว round ให้ชีตเดิม + บังคับคอลัมน์เป็น text
    var ts = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
    var rows = records.map(function(r){
      return REQ_HEADERS.map(function(h){
        if (h === 'timestamp') return r.timestamp || ts;
        return r[h] != null ? r[h] : '';
      });
    });
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, REQ_HEADERS.length).setValues(rows);
    clearReqCache_();
    return { ok: true, saved: rows.length };
  } finally { lock.releaseLock(); }
}

function deleteRequest(key) {
  if (!key) return { ok: false, error: 'no key' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Requests');
    if (!sh) return { ok: false, error: 'sheet not found' };
    var values = sh.getDataRange().getValues();
    var rowToDelete = -1;

    // 1) rowIndex แต่ verify ว่า name ตรง (กัน rowIndex stale หลังมีการลบ/เพิ่ม)
    if (key.rowIndex && key.rowIndex >= 2 && key.rowIndex <= values.length) {
      var r = values[key.rowIndex - 1];
      if (String(r[1]||'') === String(key.name||'')) {
        rowToDelete = key.rowIndex;
      }
    }

    // 2) timestamp + name (combo เกือบ unique)
    if (rowToDelete < 2 && key.timestamp) {
      for (var i = 1; i < values.length; i++) {
        var tsCell = values[i][0];
        var ts = (tsCell instanceof Date)
          ? Utilities.formatDate(tsCell, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss')
          : String(tsCell);
        if (ts === String(key.timestamp) && String(values[i][1]||'') === String(key.name||'')) {
          rowToDelete = i + 1; break;
        }
      }
    }

    // 3) name + idCard (strip non-digits ทั้ง 2 ฝั่ง)
    if (rowToDelete < 2) {
      var keyIdStripped = String(key.idCard || '').replace(/\D/g, '');
      for (var i = 1; i < values.length; i++) {
        var rowIdStripped = String(values[i][3]||'').replace(/\D/g, '');
        if (String(values[i][1]||'') === String(key.name||'') && rowIdStripped && rowIdStripped === keyIdStripped) {
          rowToDelete = i + 1; break;
        }
      }
    }

    // 4) name อย่างเดียว (last resort — เผื่อ idCard เปลี่ยน)
    if (rowToDelete < 2) {
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][1]||'').trim() === String(key.name||'').trim()) {
          rowToDelete = i + 1; break;
        }
      }
    }

    if (rowToDelete < 2) return { ok: false, error: 'not found' };
    sh.deleteRow(rowToDelete);
    clearReqCache_();
    return { ok: true, deleted: rowToDelete };
  } finally { lock.releaseLock(); }
}

function updateRequest(key, record) {
  if (!key || !record) return { ok: false, error: 'no key/record' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Requests');
    if (!sh) return { ok: false, error: 'sheet not found' };
    var values = sh.getDataRange().getValues();
    var rowToUpdate = -1;

    // 1) rowIndex + verify name
    if (key.rowIndex && key.rowIndex >= 2 && key.rowIndex <= values.length) {
      var r = values[key.rowIndex - 1];
      if (String(r[1]||'') === String(key.name||'')) {
        rowToUpdate = key.rowIndex;
      }
    }

    // 2) timestamp + name
    if (rowToUpdate < 2 && key.timestamp) {
      for (var i = 1; i < values.length; i++) {
        var tsCell = values[i][0];
        var ts = (tsCell instanceof Date)
          ? Utilities.formatDate(tsCell, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss')
          : String(tsCell);
        if (ts === String(key.timestamp) && String(values[i][1]||'') === String(key.name||'')) {
          rowToUpdate = i + 1; break;
        }
      }
    }

    // 3) name + idCard
    if (rowToUpdate < 2) {
      var keyIdStripped = String(key.idCard || '').replace(/\D/g, '');
      for (var i = 1; i < values.length; i++) {
        var rowIdStripped = String(values[i][3]||'').replace(/\D/g, '');
        if (String(values[i][1]||'') === String(key.name||'') && rowIdStripped && rowIdStripped === keyIdStripped) {
          rowToUpdate = i + 1; break;
        }
      }
    }

    if (rowToUpdate < 2) return { ok: false, error: 'not found' };
    ensureReqHeaders_(sh);
    var existingTs = values[rowToUpdate - 1][0];
    var oldRow = values[rowToUpdate - 1];
    var newRow = REQ_HEADERS.map(function(h, j){
      if (h === 'timestamp') return existingTs;
      // ไม่ได้ส่ง field นี้มา → คงค่าเดิมไว้ (กัน client เก่าล้าง round/คอลัมน์ใหม่ทิ้ง)
      if (record[h] == null) return oldRow[j] != null ? oldRow[j] : '';
      return record[h];
    });
    sh.getRange(rowToUpdate, 1, 1, REQ_HEADERS.length).setValues([newRow]);
    clearReqCache_();
    return { ok: true, updated: rowToUpdate };
  } finally { lock.releaseLock(); }
}

/* ═══════════ งานหมู่ (bulk) — อ่านชีตครั้งเดียว เขียนครั้งเดียว ═══════════
   เดิมฝั่งหน้าเว็บวนยิง update/delete ทีละแถว แถวละ 1 HTTP + อ่านชีตทั้งใบ + จับ lock
   195 คน = 195 รอบ ≈ หลายนาที · ทำเป็นก้อนเดียวเหลือไม่กี่วินาที */

/* หา index ของแถว (0-based ใน values) จาก key — ไล่จาก rowIndex → timestamp+name → name+idCard → name */
function _findReqRow_(values, key, usedRows) {
  if (!key) return -1;
  function taken(i) { return usedRows && usedRows[i]; }
  // 1) rowIndex + verify name
  if (key.rowIndex && key.rowIndex >= 2 && key.rowIndex <= values.length) {
    var i0 = key.rowIndex - 1;
    if (!taken(i0) && String(values[i0][1] || '') === String(key.name || '')) return i0;
  }
  var i;
  // 2) timestamp + name
  if (key.timestamp) {
    for (i = 1; i < values.length; i++) {
      if (taken(i)) continue;
      var tsCell = values[i][0];
      var ts = (tsCell instanceof Date)
        ? Utilities.formatDate(tsCell, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss')
        : String(tsCell);
      if (ts === String(key.timestamp) && String(values[i][1] || '') === String(key.name || '')) return i;
    }
  }
  // 3) name + idCard
  var keyId = String(key.idCard || '').replace(/\D/g, '');
  if (keyId) {
    for (i = 1; i < values.length; i++) {
      if (taken(i)) continue;
      if (String(values[i][1] || '') === String(key.name || '')
          && String(values[i][3] || '').replace(/\D/g, '') === keyId) return i;
    }
  }
  // 4) name อย่างเดียว
  for (i = 1; i < values.length; i++) {
    if (taken(i)) continue;
    if (String(values[i][1] || '').trim() === String(key.name || '').trim()) return i;
  }
  return -1;
}

function bulkUpdateRequests(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return { ok: false, error: 'no updates' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Requests');
    if (!sh) return { ok: false, error: 'sheet not found' };
    ensureReqHeaders_(sh);
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return { ok: false, error: 'no data' };
    var cols = REQ_HEADERS.length;

    // ปรับทุกแถวให้กว้างเท่า REQ_HEADERS ก่อน แล้วค่อยแก้เฉพาะแถวที่ตรง key
    var out = values.map(function(row){
      return REQ_HEADERS.map(function(h, j){ return row[j] != null ? row[j] : ''; });
    });
    for (var j = 0; j < cols; j++) if (!out[0][j]) out[0][j] = REQ_HEADERS[j];

    var used = {}, updated = 0, notFound = 0;
    updates.forEach(function(u){
      if (!u || !u.record) { notFound++; return; }
      var idx = _findReqRow_(values, u.key, used);
      if (idx < 1) { notFound++; return; }
      used[idx] = true;
      var oldRow = out[idx];
      out[idx] = REQ_HEADERS.map(function(h, k){
        if (h === 'timestamp') return oldRow[0];                             // เวลาส่งเดิมห้ามเปลี่ยน
        if (u.record[h] == null) return oldRow[k] != null ? oldRow[k] : '';  // ไม่ได้ส่งมา = คงเดิม
        return u.record[h];
      });
      updated++;
    });

    sh.getRange(1, 1, out.length, cols).setValues(out);
    clearReqCache_();
    return { ok: true, updated: updated, notFound: notFound };
  } finally { lock.releaseLock(); }
}

function bulkDeleteRequests(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, error: 'no keys' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Requests');
    if (!sh) return { ok: false, error: 'sheet not found' };
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return { ok: true, deleted: 0, notFound: keys.length };
    var cols = Math.max(sh.getLastColumn(), REQ_HEADERS.length);

    var kill = {}, deleted = 0, notFound = 0;
    keys.forEach(function(k){
      var idx = _findReqRow_(values, k, kill);
      if (idx < 1) { notFound++; return; }
      kill[idx] = true; deleted++;
    });
    if (!deleted) return { ok: true, deleted: 0, notFound: notFound };

    var keep = values.filter(function(row, i){ return i === 0 || !kill[i]; })
                     .map(function(row){
                       var r = [];
                       for (var j2 = 0; j2 < cols; j2++) r.push(row[j2] != null ? row[j2] : '');
                       return r;
                     });
    forceTextCols_(sh);
    sh.getRange(1, 1, keep.length, cols).setValues(keep);
    var extra = values.length - keep.length;
    if (extra > 0) sh.deleteRows(keep.length + 1, extra);   // ตัดแถวท้ายที่เหลือทิ้งทีเดียว
    clearReqCache_();
    return { ok: true, deleted: deleted, notFound: notFound };
  } finally { lock.releaseLock(); }
}

/* นับจำนวนแถวของทุกชีต — ใช้ตอนเทียบข้อมูลกับ Supabase
   getLastRow() ไม่ต้องอ่านข้อมูลเลย เร็วกว่าดึงทั้งก้อนมานับหลายสิบเท่า
   (เดิมต้องโหลด ~1.2 MB มานับ 4 ตัวเลข) */
function getCounts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  function n(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return 0;
    var last = sh.getLastRow();
    return last > 1 ? last - 1 : 0;       // หักหัวตาราง
  }
  var cfg = 0;
  try {
    var c = ss.getSheetByName('Config');
    if (c) {
      var v = c.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) if (String(v[i][0] || '').trim()) cfg++;
    }
  } catch (e) {}
  return {
    ok: true, version: BACKEND_VERSION,
    counts: {
      config: cfg,
      requests: n('Requests'),
      certificates: n('Certificates'),
      employees: n('Employees'),
      fqaRecords: n('FqaRecords'),
      exams: n('Exams'),
      examResults: n('ExamResults'),
      examRequests: n('ExamRequests')
    }
  };
}

/* ──────────────────── CONFIG ──────────────────── */
function getConfig() {
  var cache = CacheService.getScriptCache();
  var sysCached = cache.get('cfg_systems_v2');
  var annCached = cache.get('cfg_announcements_v2');
  var usrCached = cache.get('cfg_users_v2');
  var brCached  = cache.get('cfg_branches_v2');
  var jdCached  = cache.get('cfg_jaedaengBranches_v2');
  var prmCached = cache.get('cfg_perms_v2');
  var brdCached = cache.get('cfg_brands_v2');
  var systems          = sysCached ? JSON.parse(sysCached) : readConfig_('systems', []);
  var announcements    = annCached ? JSON.parse(annCached) : readConfig_('announcements', []);
  var users            = usrCached ? JSON.parse(usrCached) : readConfig_('users', null);
  var branches         = brCached  ? JSON.parse(brCached)  : readConfig_('branches', null);
  var jaedaengBranches = jdCached  ? JSON.parse(jdCached)  : readConfig_('jaedaengBranches', null);
  // สิทธิ์ปุ่มของแต่ละระบบ — { checklist:{...}, foodhandler:{...}, training:{...} }
  // null = ยังไม่เคยตั้ง → ให้ client ใช้ค่า default ในโค้ดตัวเอง
  var perms            = prmCached ? JSON.parse(prmCached) : readConfig_('perms', null);
  /* ทะเบียนแบรนด์ (ชื่อ · สี · โลโก้ · รหัสนำหน้าสาขา)
     บั๊กเดิม: ฮับส่งขึ้นมาเก็บด้วย set-config key='brands' แต่ตรงนี้ไม่เคยอ่านกลับ
     แบรนด์ที่เพิ่มใหม่จึงอยู่แค่ในเบราว์เซอร์เครื่องที่สร้าง เครื่องอื่นไม่เห็นเลย
     null = ยังไม่เคยตั้ง → ให้ฮับใช้ค่าตั้งต้นในโค้ดตัวเอง (ซานตาเฟ่ + เจ๊แดง) */
  var brands           = brdCached ? JSON.parse(brdCached) : readConfig_('brands', null);
  if (!sysCached) try { cache.put('cfg_systems_v2', JSON.stringify(systems), CACHE_SEC); } catch(e) {}
  if (!annCached) try { cache.put('cfg_announcements_v2', JSON.stringify(announcements), CACHE_SEC); } catch(e) {}
  if (!usrCached) try { cache.put('cfg_users_v2', JSON.stringify(users), CACHE_SEC); } catch(e) {}
  if (!brCached)  try { cache.put('cfg_branches_v2', JSON.stringify(branches), CACHE_SEC); } catch(e) {}
  if (!jdCached)  try { cache.put('cfg_jaedaengBranches_v2', JSON.stringify(jaedaengBranches), CACHE_SEC); } catch(e) {}
  if (!prmCached) try { cache.put('cfg_perms_v2', JSON.stringify(perms), CACHE_SEC); } catch(e) {}
  if (!brdCached) try { cache.put('cfg_brands_v2', JSON.stringify(brands), CACHE_SEC); } catch(e) {}
  return { ok: true, version: BACKEND_VERSION, systems: systems, announcements: announcements, users: users, branches: branches, jaedaengBranches: jaedaengBranches, perms: perms, brands: brands };
}

// อ่าน config ทีละ key · dflt = ค่า default ถ้าไม่เจอ/parse ไม่ได้
// (systems/announcements ใช้ [] · users/branches ใช้ null เพื่อให้ client รู้ว่า "ยังไม่มีข้อมูล cloud")
function readConfig_(key, dflt) {
  if (dflt === undefined) dflt = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Config');
  if (!sh) return dflt;
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === key) {
      try { return JSON.parse(values[i][1]); } catch(e) { return dflt; }
    }
  }
  return dflt;
}

function setConfig(key, value) {
  if (!key) return { ok: false, error: 'no key' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Config') || ss.insertSheet('Config');
    if (sh.getLastRow() === 0) sh.appendRow(['key','value']);
    var values = sh.getDataRange().getValues();
    var rowToUpdate = -1;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === key) { rowToUpdate = i + 1; break; }
    }
    var json = JSON.stringify(value);
    if (rowToUpdate > 0) sh.getRange(rowToUpdate, 2).setValue(json);
    else sh.appendRow([key, json]);
    CacheService.getScriptCache().remove('cfg_' + key + '_v2');
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ──────────────────── ⭐ กดอนุญาต Drive (รัน 1 ครั้งก่อนใช้ upload-icon) ────────────────────
   วิธีใช้: ในแถบเครื่องมือ Apps Script เลือกฟังก์ชัน "authorizeDrive" → กด Run (▶)
   จะมีหน้าต่างขอสิทธิ์ → กด Review permissions → เลือกบัญชี → Advanced →
   Go to ... (unsafe) → Allow  ·  ทำครั้งเดียวพอ แล้วค่อย Deploy */
function authorizeDrive() {
  var folderName = 'FAB Hub Icons';
  var it = DriveApp.getFoldersByName(folderName);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  Logger.log('OK — โฟลเดอร์พร้อม: ' + folder.getName() + ' (id: ' + folder.getId() + ')');
  return folder.getId();
}

/* ──────────────────── UPLOAD ICON → Google Drive ────────────────────
   รับรูป base64 จาก Hub → เก็บใน Drive folder "FAB Hub Icons" → คืน public URL
   ทุกอุปกรณ์เห็นโลโก้เดียวกัน (ไม่ต้องเก็บ data URL ใน Config sheet) */
function uploadIcon(base64, filename) {
  try {
    if (!base64) return { ok: false, error: 'no image data' };
    // หา/สร้างโฟลเดอร์เก็บไอคอน
    var folderName = 'FAB Hub Icons';
    var it = DriveApp.getFoldersByName(folderName);
    var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
    // ตัด prefix "data:image/...;base64," ถ้ามี
    var b64 = String(base64).indexOf(',') >= 0 ? base64.split(',')[1] : base64;
    var bytes = Utilities.base64Decode(b64);
    var blob = Utilities.newBlob(bytes, 'image/png', filename || ('sys-icon-' + Date.now() + '.png'));
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w256';
    return { ok: true, url: url };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ──────────────────── CACHE ──────────────────── */
function clearAllCacheReturn() {
  CacheService.getScriptCache().removeAll(['cert_v2','emp_v1','req_v2','cfg_systems_v2','cfg_announcements_v2','cfg_users_v2','cfg_branches_v2','cfg_brands_v2','cfg_perms_v2','cfg_jaedaengBranches_v2']
    .concat(EXAM_CACHE_KEYS));
  _fqaCacheKill();   /* ของฟอร์มตรวจเก็บเป็นหลายท่อน ต้องล้างด้วยตัวของมันเอง */
  return { ok: true, cleared: true };
}

/* ──────────────────── OCR (Google Cloud Vision API) ──────────────────── */
function ocrImage(imageBase64, filename, mimeType) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
    if (!apiKey) return jsonOut({ ok: false, error: 'VISION_API_KEY ไม่ตั้งใน Script Properties' });

    var payload = {
      requests: [{
        image: { content: imageBase64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['th','en'] }
      }]
    };
    var res = UrlFetchApp.fetch(
      'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(apiKey),
      { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }
    );
    var body = JSON.parse(res.getContentText());
    if (body.error) return jsonOut({ ok: false, error: body.error.message || JSON.stringify(body.error) });
    var resp = body.responses && body.responses[0];
    if (resp && resp.error) return jsonOut({ ok: false, error: resp.error.message || JSON.stringify(resp.error) });
    var text = (resp && resp.fullTextAnnotation && resp.fullTextAnnotation.text) || '';
    return jsonOut({ ok: true, text: text });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ═══════════════════════════════════════════════════════════════
   ONLINE EXAM SYSTEM  (ระบบสอบออนไลน์)
   Sheets: Exams (ชุดข้อสอบ), ExamResults (ผลสอบ)
   - Exam ทั้งชุด (config + คำถาม) เก็บเป็น JSON ในคอลัมน์ 'json'
   ═══════════════════════════════════════════════════════════════ */
var EXAM_HEADERS = ['id','title','brand','active','startDate','endDate','questions','updatedAt','json'];
/* track / partsJson = ชุดที่แบ่งส่วน บริการ/ครัว: สอบส่วนไหน และผลรายส่วน (ต่อท้าย ไม่ย้ายคอลัมน์เดิม) */
var EXAMRESULT_HEADERS = ['submittedAt','examId','examTitle','name','empId','branch','brand','pct','correct','total','result','violations','finishReason','startedAt','answersJson','position','track','partsJson'];

/* ═══ แคชของระบบสอบ ═══
   วัดจริง: ยิง action=exams ใช้เวลา 3 - 36 วินาที และบางครั้งตอบกลับมาไม่ครบ
   เพราะทุกคำขอต้องเปิดสเปรดชีตทั้งไฟล์ (พนักงาน 1,461 · ใบรับรอง 652 · คำขอ 300 ...)
   ทั้งที่จะอ่านแค่ชีตเดียว · ทางที่ได้ผลคือถ้ามีในแคชให้ตอบเลย ไม่ต้องแตะ
   SpreadsheetApp เลยแม้แต่ครั้งเดียว — เหลือเวลาแค่ค่าตั้งต้นของ Apps Script
   ระบบอื่น (ใบรับรอง/พนักงาน/คำขออบรม) ทำแบบนี้อยู่แล้ว ระบบสอบตกหล่นไป */
/* 1 ชั่วโมง — ยืดจาก 5 นาทีได้เพราะทุกทางที่เขียนข้อมูลล้างแคชทันทีอยู่แล้ว
   ที่ไม่ยืดไปถึง 6 ชั่วโมง (ค่าสูงสุด) เพราะถ้ามีคนไปแก้ใน Google Sheet ตรง ๆ
   ระบบจะไม่รู้ ต้องรอแคชหมดอายุเอง 1 ชั่วโมงคือจุดที่ยังพอทน
   (หรือกดปุ่ม "ล้าง Cache" ในหน้าผู้สัมผัสอาหาร ซึ่งล้างของทุกระบบให้) */
var EXAM_CACHE_SEC = 3600;
var EXAM_CACHE_KEYS = ['exam_list_v1', 'exam_res_v1', 'exam_req_v1'];

function _oeCacheGet(key) {
  try { var v = CacheService.getScriptCache().get(key); return v ? JSON.parse(v) : null; }
  catch (e) { return null; }
}
/* ช่องละไม่เกิน 100KB — ใหญ่กว่านั้น put จะโยน error ปล่อยผ่านไป อ่านจากชีตตามเดิม
   ห้ามให้แคชพังแล้วลามไปทำให้อ่านข้อมูลไม่ได้ */
function _oeCachePut(key, obj) {
  try { CacheService.getScriptCache().put(key, JSON.stringify(obj), EXAM_CACHE_SEC); } catch (e) {}
}
function _examCacheKill() {
  try { CacheService.getScriptCache().removeAll(EXAM_CACHE_KEYS); } catch (e) {}
}

function _getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); return sh; }
  if (sh.getLastRow() === 0) { sh.appendRow(headers); return sh; }
  /* ชีตมีอยู่แล้ว — เติมเฉพาะคอลัมน์ที่ยังไม่มี ต่อท้ายแถวหัว
     ไม่ย้ายไม่เรียงคอลัมน์เดิม ข้อมูลเก่าจึงยังตรงช่องเหมือนเดิม */
  var have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var add = headers.filter(function (h) { return have.indexOf(h) < 0; });
  if (add.length) sh.getRange(1, have.length + 1, 1, add.length).setValues([add]);
  return sh;
}

/* ──────────────── EXAMS ──────────────── */
function getExams() {
  var hit = _oeCacheGet('exam_list_v1');
  if (hit) return hit;
  var sh = _getOrCreateSheet('Exams', EXAM_HEADERS);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: true, exams: [] };
  var headers = values[0].map(function(h){ return String(h).trim(); });
  var jsonCol = headers.indexOf('json');
  var exams = [];
  for (var i = 1; i < values.length; i++) {
    var raw = jsonCol >= 0 ? values[i][jsonCol] : '';
    if (!raw) continue;
    try { exams.push(JSON.parse(raw)); } catch (e) {}
  }
  var out = { ok: true, exams: exams };
  _oeCachePut('exam_list_v1', out);
  return out;
}

function saveExam(exam) {
  if (!exam || !exam.title) return { ok: false, error: 'invalid exam' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = _getOrCreateSheet('Exams', EXAM_HEADERS);
    if (!exam.id) exam.id = 'exam_' + Date.now() + '_' + Math.floor(Math.random()*1e5);
    exam.updatedAt = new Date().toISOString();
    var values = sh.getDataRange().getValues();
    var headers = values[0].map(function(h){ return String(h).trim(); });
    var idCol = headers.indexOf('id');
    var rowArr = _examToRow(exam, headers);
    // upsert
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) === String(exam.id)) {
        sh.getRange(i + 1, 1, 1, headers.length).setValues([rowArr]);
        _examCacheKill();
        return { ok: true, id: exam.id, updated: true };
      }
    }
    sh.appendRow(rowArr);
    _examCacheKill();
    return { ok: true, id: exam.id, updated: false };
  } finally { lock.releaseLock(); }
}

function _examToRow(exam, headers) {
  var map = {
    id: exam.id || '',
    title: exam.title || '',
    brand: exam.brand || '',
    active: exam.active !== false,
    startDate: exam.startDate || '',
    endDate: exam.endDate || '',
    questions: (exam.questions || []).length,
    updatedAt: exam.updatedAt || '',
    json: JSON.stringify(exam)
  };
  return headers.map(function(h){ return map.hasOwnProperty(h) ? map[h] : ''; });
}

function deleteExam(id) {
  if (!id) return { ok: false, error: 'no id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = _getOrCreateSheet('Exams', EXAM_HEADERS);
    var values = sh.getDataRange().getValues();
    var headers = values[0].map(function(h){ return String(h).trim(); });
    var idCol = headers.indexOf('id');
    for (var i = values.length - 1; i >= 1; i--) {
      if (String(values[i][idCol]) === String(id)) { sh.deleteRow(i + 1); _examCacheKill(); return { ok: true }; }
    }
    return { ok: false, error: 'not found' };
  } finally { lock.releaseLock(); }
}

/* ──────────────── EXAM RESULTS ──────────────── */
function saveExamResult(r) {
  if (!r || !r.name) return { ok: false, error: 'invalid result' };
  /* ปิดรหัสเข้าสอบทันทีที่ผลถูกบันทึก — ทำตรงนี้ด้วยเพราะเชื่อถือได้กว่ารอหน้าเว็บเรียก
     (ผู้ใช้อาจปิดจอทิ้งทันทีหลังส่ง) · ไม่มีรหัสมาก็ข้ามไป ไม่ทำให้บันทึกผลล้ม */
  if (r.accessCode) { try { useExamCode(r.accessCode); } catch (e) {} }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = _getOrCreateSheet('ExamResults', EXAMRESULT_HEADERS);

    /* กันบันทึกซ้ำ — ผลเดียวกันถูกยิงเข้ามาสองรอบได้หลายทาง
       (เน็ตสะดุดแล้วเบราว์เซอร์ส่งซ้ำ · กดส่งซ้อน · ปิดจอแล้วเปิดใหม่)
       ไล่อุดทีละทางไม่จบ กันที่ปลายทางทีเดียวพอ
       เทียบแค่ 40 แถวท้าย เพราะถ้าซ้ำจริงมันจะอยู่ติดกัน ไม่ต้องอ่านทั้งชีตให้ช้า */
    var last = sh.getLastRow();
    if (last > 1) {
      var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
        .map(function (h) { return String(h).trim(); });
      var cSub = hdr.indexOf('submittedAt'), cEx = hdr.indexOf('examId'),
          cEmp = hdr.indexOf('empId'), cName = hdr.indexOf('name');
      var from = Math.max(2, last - 39);
      var tail = sh.getRange(from, 1, last - from + 1, hdr.length).getValues();
      var key = function (sub, ex, emp, nm) {
        return [sub, ex, emp, nm].map(function (x) { return String(x || '').trim(); }).join('|');
      };
      var mine = key(r.submittedAt, r.examId, r.empId, r.name);
      for (var i = 0; i < tail.length; i++) {
        if (key(tail[i][cSub], tail[i][cEx], tail[i][cEmp], tail[i][cName]) === mine) {
          return { ok: true, saved: 0, duplicate: true };
        }
      }
    }

    var row = [
      r.submittedAt || new Date().toISOString(),
      r.examId || '', r.examTitle || '', r.name || '', r.empId || '',
      r.branch || '', r.brand || '', r.pct != null ? r.pct : '',
      r.correct != null ? r.correct : '', r.total != null ? r.total : '',
      r.result || '', r.violations != null ? r.violations : 0,
      r.finishReason || '', r.startedAt || '',
      r.answers ? JSON.stringify(r.answers) : '',
      r.position || '',
      r.track || '',
      r.parts ? JSON.stringify(r.parts) : ''
    ];
    sh.appendRow(row);
    _examCacheKill();
    return { ok: true, saved: 1 };
  } finally { lock.releaseLock(); }
}

/* ลบผลสอบหนึ่งรายการ
   ผลสอบไม่มี id ประจำตัว (เก็บเป็นแถวในชีต) จึงระบุด้วยเวลาที่ส่ง + รหัสพนักงาน
   + รหัสชุดข้อสอบรวมกัน คนเดียวกันสอบชุดเดียวกันซ้ำในวินาทีเดียวกันไม่ได้อยู่แล้ว

   เวลาที่ส่งเก็บเป็นข้อความ ISO แต่ Sheets อาจตีความเป็นวันที่แล้วคืนมาเป็น Date
   จึงเทียบด้วยค่าเวลา (มิลลิวินาที) ไม่ใช่เทียบข้อความตรง ๆ */
function deleteExamResult(submittedAt, empId, examId) {
  if (!submittedAt) return { ok: false, error: 'no submittedAt' };
  var want = new Date(submittedAt).getTime();
  if (isNaN(want)) return { ok: false, error: 'bad submittedAt' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = _getOrCreateSheet('ExamResults', EXAMRESULT_HEADERS);
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return { ok: false, error: 'not found' };
    var headers = values[0].map(function(h){ return String(h).trim(); });
    var cAt = headers.indexOf('submittedAt');
    var cEmp = headers.indexOf('empId');
    var cEx = headers.indexOf('examId');
    if (cAt < 0) return { ok: false, error: 'no submittedAt column' };
    for (var i = values.length - 1; i >= 1; i--) {
      var v = values[i][cAt];
      var t = (v instanceof Date) ? v.getTime() : new Date(String(v)).getTime();
      if (isNaN(t) || t !== want) continue;
      if (empId && cEmp >= 0 && String(values[i][cEmp]).trim() !== String(empId).trim()) continue;
      if (examId && cEx >= 0 && String(values[i][cEx]).trim() !== String(examId).trim()) continue;
      sh.deleteRow(i + 1);
      _examCacheKill();
      return { ok: true };
    }
    return { ok: false, error: 'not found' };
  } finally { lock.releaseLock(); }
}

function getExamResults() {
  var hit = _oeCacheGet('exam_res_v1');
  if (hit) return hit;
  var sh = _getOrCreateSheet('ExamResults', EXAMRESULT_HEADERS);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: true, results: [] };
  var headers = values[0].map(function(h){ return String(h).trim(); });
  var results = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[0] && !row[3]) continue;
    var rec = {};
    headers.forEach(function(h, j){ rec[h] = row[j]; });
    if (rec.answersJson) { try { rec.answers = JSON.parse(rec.answersJson); } catch (e) {} }
    if (rec.partsJson) { try { rec.parts = JSON.parse(rec.partsJson); } catch (e) {} }
    results.push(rec);
  }
  var out = { ok: true, results: results };
  _oeCachePut('exam_res_v1', out);
  return out;
}

/* ──────────────── FQA / FSQ / VISIT — รายการตรวจสาขา ────────────────
   ชีต FqaRecords: 1 แถว = 1 รายการตรวจ · เก็บ JSON ทั้งก้อนในคอลัมน์ json
   รูปภาพไม่เก็บที่นี่ — อัปโหลดขึ้น Drive แล้วเก็บเป็น URL ในตัว record
   (กัน JSON เกินลิมิต 50,000 ตัวอักษร/ช่องของ Google Sheets) */
var FQA_HEADERS = ['id','brand','type','date','branch','updatedAt','json'];

var FQA_DEL_HEADERS = ['id','deletedAt'];

/* ═══ แคชของฟอร์มตรวจสาขา ═══
   วัดจริง: ยิง action=fqa-records 5 รอบได้ 39 / 21 / 3.2 / 4.4 / 45 วินาที
   และ 2 รอบตอบกลับมาไม่ครบ (8,268 ตัวอักษรจาก 118,699) — อาการเดียวกับระบบสอบ
   เพราะต้องเปิดสเปรดชีตทั้งไฟล์ทุกครั้ง

   ต่างจากระบบสอบตรงที่ข้อมูลก้อนนี้ 118,699 ตัวอักษร เกินลิมิต 100,000
   ต่อช่องของ CacheService ใส่ตรง ๆ ไม่ได้ (put จะโยน error เงียบ ๆ แล้วไม่มีแคช
   ทั้งที่โค้ดดูเหมือนทำงาน) จึงหั่นเป็นท่อนละ 90,000 แล้วเก็บหลายช่อง
   พร้อมช่องบอกจำนวนท่อน · ถ้าท่อนไหนหายไป (หมดอายุไม่พร้อมกัน / ถูกไล่ที่)
   ถือว่าแคชใช้ไม่ได้ทั้งก้อน กลับไปอ่านชีตตามเดิม ดีกว่าได้ข้อมูลขาด ๆ */
var FQA_CACHE_SEC = 3600;   /* เหตุผลเดียวกับ EXAM_CACHE_SEC */
var FQA_CHUNK = 90000;      /* ต่ำกว่าลิมิต 100,000 เผื่อส่วนหัวของตัวเก็บ */
var FQA_MAX_CHUNKS = 20;    /* ใหญ่กว่านี้ไม่ต้องแคช ไม่คุ้มกับจำนวนช่องที่ใช้ */
var FQA_CACHE_KEY = 'fqa_all_v1';

function _fqaCachePut(obj) {
  try {
    var str = JSON.stringify(obj);
    var parts = Math.ceil(str.length / FQA_CHUNK);
    if (parts > FQA_MAX_CHUNKS) return;
    var map = {};
    for (var i = 0; i < parts; i++) map[FQA_CACHE_KEY + '_' + i] = str.substring(i * FQA_CHUNK, (i + 1) * FQA_CHUNK);
    /* เขียนท่อนให้ครบก่อน ค่อยเขียนช่องนับจำนวน — ถ้าล้มกลางคัน จะไม่มีช่องนับ
       แปลว่าแคชใช้ไม่ได้ ดีกว่ามีช่องนับแต่ท่อนไม่ครบ */
    CacheService.getScriptCache().putAll(map, FQA_CACHE_SEC);
    CacheService.getScriptCache().put(FQA_CACHE_KEY + '_n', String(parts), FQA_CACHE_SEC);
  } catch (e) {}
}

function _fqaCacheGet() {
  try {
    var c = CacheService.getScriptCache();
    var parts = parseInt(c.get(FQA_CACHE_KEY + '_n'), 10);
    if (!parts) return null;
    var keys = [];
    for (var i = 0; i < parts; i++) keys.push(FQA_CACHE_KEY + '_' + i);
    var got = c.getAll(keys) || {};
    var str = '';
    for (var j = 0; j < parts; j++) {
      var piece = got[FQA_CACHE_KEY + '_' + j];
      if (piece == null) return null;   /* ท่อนหาย = ทิ้งทั้งก้อน */
      str += piece;
    }
    return JSON.parse(str);
  } catch (e) { return null; }
}

function _fqaCacheKill() {
  try {
    var c = CacheService.getScriptCache();
    var parts = parseInt(c.get(FQA_CACHE_KEY + '_n'), 10) || 0;
    var keys = [FQA_CACHE_KEY + '_n'];
    /* ล้างเผื่อไว้เกินจำนวนที่นับได้ด้วย เผื่อรอบก่อนหั่นได้หลายท่อนกว่านี้
       แล้วช่องนับหมดอายุไปก่อน จะได้ไม่มีท่อนเก่าค้างปนกับท่อนใหม่ */
    var upto = Math.max(parts, FQA_MAX_CHUNKS);
    for (var i = 0; i < upto; i++) keys.push(FQA_CACHE_KEY + '_' + i);
    c.removeAll(keys);
  } catch (e) {}
}

/* รายการ id ที่ถูกลบ (tombstone) — ให้ทุกเครื่องลบตามแบบเด็ดขาด ไม่เด้งกลับ */
function _fqaDeletedIds() {
  var sh = _getOrCreateSheet('FqaDeleted', FQA_DEL_HEADERS);
  var values = sh.getDataRange().getValues();
  var ids = [];
  for (var i = 1; i < values.length; i++) { if (values[i][0]) ids.push(String(values[i][0])); }
  return ids;
}

function getFqaRecords(brand, since) {
  /* อ่านชีตครั้งเดียวเก็บทั้งก้อน (ทุกแบรนด์ ไม่กรอง) แล้วค่อยคัดตามที่ขอ
     ถ้าแยกแคชรายแบรนด์/ราย since จะกลายเป็นแคชนับไม่ถ้วนที่ต้องล้างพร้อมกัน */
  var all = _fqaCacheGet();
  if (!all) {
    var sh = _getOrCreateSheet('FqaRecords', FQA_HEADERS);
    var values = sh.getDataRange().getValues();
    var everything = [];
    if (values.length >= 2) {
      var headers = values[0].map(function(h){ return String(h).trim(); });
      var jsonCol = headers.indexOf('json');
      for (var i = 1; i < values.length; i++) {
        var raw = jsonCol >= 0 ? values[i][jsonCol] : '';
        if (!raw) continue;
        try { everything.push(JSON.parse(raw)); } catch (e) {}
      }
    }
    /* now = เวลาที่อ่านชีต ไม่ใช่เวลาที่ตอบกลับ · หน้าเว็บเอาค่านี้ไปเป็นหมุด
       ว่า "ซิงค์ถึงตรงนี้แล้ว" ถ้าให้เวลาปัจจุบันทั้งที่ข้อมูลมาจากแคชเก่า
       รายการที่ถูกบันทึกระหว่างนั้นจะถูกข้ามไปถาวร ไม่มีวันซิงค์ลงมา */
    all = { records: everything, deleted: _fqaDeletedIds(), now: new Date().toISOString() };
    _fqaCachePut(all);
  }
  var records = [];
  all.records.forEach(function (rec) {
    if (brand && String(rec.brand || '') !== String(brand)) return;
    /* ซิงค์แบบ incremental (ถ้าส่ง since มา) — ส่งเฉพาะที่เปลี่ยนหลัง since */
    if (since && rec.updatedAt && String(rec.updatedAt) <= String(since)) return;
    records.push(rec);
  });
  /* now = หมุดเวลาของข้อมูล (เวลาที่อ่านชีต) — มาจากแคชได้ จึงเก่าได้ถึง 1 ชม.
     serverNow = เวลาจริงของเซิร์ฟเวอร์ตอนนี้ คิดใหม่ทุกครั้งไม่ผ่านแคช
     สองค่านี้ใช้คนละงาน หน้าเว็บเอา now ไปเป็นหมุดซิงค์
     และเอา serverNow ไปเทียบว่านาฬิกาเครื่องตรงไหม
     ก่อนหน้านี้มีแต่ now แล้วเอาไปทำทั้งสองอย่าง เครื่องที่เจอแคชอายุ 55 นาที
     จึงถูกเตือนว่า "นาฬิกาคลาด 55 นาที" ทั้งที่เวลาเครื่องตรงเป๊ะ */
  return { ok: true, records: records, deleted: all.deleted, now: all.now,
           serverNow: new Date().toISOString() };
}

function _fqaToRow(rec, headers) {
  var map = {
    id: rec.id || '',
    brand: rec.brand || '',
    type: rec.type || '',
    date: rec.date || '',
    branch: rec.branch || '',
    updatedAt: rec.updatedAt || new Date().toISOString(),
    json: JSON.stringify(rec)
  };
  return headers.map(function(h){ return map.hasOwnProperty(h) ? map[h] : ''; });
}

/* กันเรคคอร์ดพัง (ด่านหลังบ้าน): ตัดรูป base64 ที่หลุดมา + กัน json เกินลิมิตเซลล์ Sheet (~50k) */
function _fqaSanitize(rec) {
  if (rec && rec.photos && rec.photos.length) {
    rec.photos = rec.photos.filter(function(p){
      return p && typeof p.data === 'string' && p.data.indexOf('data:') !== 0;  // เก็บเฉพาะรูปที่เป็น URL
    });
  }
  if (JSON.stringify(rec).length > 48000) rec.photos = [];   // ยังใหญ่ → ตัดรูปทั้งหมด คงข้อความไว้
  return rec;
}

function saveFqaRecord(rec) {
  if (!rec || !rec.id) return { ok: false, error: 'invalid record' };
  rec = _fqaSanitize(rec);
  if (JSON.stringify(rec).length > 49000) return { ok: false, error: 'record too large' };  // กันเขียนของที่จะถูกตัด
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = _getOrCreateSheet('FqaRecords', FQA_HEADERS);
    rec.updatedAt = rec.updatedAt || new Date().toISOString();
    var values = sh.getDataRange().getValues();
    var headers = values[0].map(function(h){ return String(h).trim(); });
    var idCol = headers.indexOf('id');
    var rowArr = _fqaToRow(rec, headers);
    _removeFqaTombstone(rec.id);   // บันทึกใหม่ด้วย id เดิม = ยกเลิกสถานะลบ (กันโดนลบซ้ำ)
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) === String(rec.id)) {
        sh.getRange(i + 1, 1, 1, headers.length).setValues([rowArr]);
        _fqaCacheKill();
        return { ok: true, id: rec.id, updated: true };
      }
    }
    sh.appendRow(rowArr);
    _fqaCacheKill();
    return { ok: true, id: rec.id, updated: false };
  } finally { lock.releaseLock(); }
}

function deleteFqaRecord(id) {
  if (!id) return { ok: false, error: 'no id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = _getOrCreateSheet('FqaRecords', FQA_HEADERS);
    var values = sh.getDataRange().getValues();
    var headers = values[0].map(function(h){ return String(h).trim(); });
    var idCol = headers.indexOf('id');
    for (var i = values.length - 1; i >= 1; i--) {
      if (String(values[i][idCol]) === String(id)) { sh.deleteRow(i + 1); }
    }
    _addFqaTombstone(id);   // จำ id ที่ลบไว้ ให้เครื่องอื่นลบตาม ไม่เด้งกลับ
    _fqaCacheKill();
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* บันทึก tombstone (กันซ้ำ) */
function _addFqaTombstone(id) {
  var ts = _getOrCreateSheet('FqaDeleted', FQA_DEL_HEADERS);
  var tv = ts.getDataRange().getValues();
  for (var j = 1; j < tv.length; j++) { if (String(tv[j][0]) === String(id)) return; }
  ts.appendRow([String(id), new Date().toISOString()]);
}

/* ลบ tombstone ออก (เมื่อมีการบันทึก id เดิมใหม่) */
function _removeFqaTombstone(id) {
  var ts = _getOrCreateSheet('FqaDeleted', FQA_DEL_HEADERS);
  var tv = ts.getDataRange().getValues();
  for (var j = tv.length - 1; j >= 1; j--) { if (String(tv[j][0]) === String(id)) ts.deleteRow(j + 1); }
}

/* รูปประกอบการตรวจ → เก็บใน Drive folder "FQA Photos" → คืน URL แบบดูได้สาธารณะ */
function uploadFqaPhoto(base64, filename) {
  try {
    if (!base64) return { ok: false, error: 'no image data' };
    var folderName = 'FQA Photos';
    var it = DriveApp.getFoldersByName(folderName);
    var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
    var raw = String(base64);
    var mime = 'image/jpeg';
    var mm = raw.match(/^data:([^;]+);base64,/);
    if (mm) mime = mm[1];
    var b64 = raw.indexOf(',') >= 0 ? raw.split(',')[1] : raw;
    var bytes = Utilities.base64Decode(b64);
    var ext = mime.indexOf('png') >= 0 ? '.png' : '.jpg';
    var blob = Utilities.newBlob(bytes, mime, filename || ('fqa-' + Date.now() + ext));
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200', id: file.getId() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* =======================================================================
   สำรองข้อมูลอัตโนมัติ (Auto-backup)
   · backupFqaDaily()   = ดัมพ์ข้อมูลตรวจทั้งหมดเป็นไฟล์ .json ลง Drive โฟลเดอร์ "FQA Backups"
   · setupDailyBackup() = ตั้งให้รันอัตโนมัติทุกวันตี 2 (รันครั้งเดียวจาก editor)
   เก็บย้อนหลัง 30 วัน (ไฟล์เก่ากว่านั้นลบทิ้ง)
   ======================================================================= */
/* SPREADSHEET_ID ของ "FAB Operations & Training Hub" — ใช้ openById ให้ backup อ่านชีตถูกตัวแน่นอน
   ทั้งตอน run เองและตอน trigger รัน (getActiveSpreadsheet() คืน null/ผิดตัวได้ตอน run นอก web app) */
var FQA_SPREADSHEET_ID = '1KESJdDqyXlFoR9pjDwCEZqJbB7YHZ_Fi_t3I5ZOrY1o';

function backupFqaDaily() {
  var ss = SpreadsheetApp.openById(FQA_SPREADSHEET_ID);
  var sh = ss.getSheetByName('FqaRecords');
  var records = [];
  if (sh) {
    var values = sh.getDataRange().getValues();
    if (values.length >= 2) {
      var jsonCol = values[0].map(function(h){ return String(h).trim(); }).indexOf('json');
      for (var i = 1; i < values.length; i++) {
        var raw = jsonCol >= 0 ? values[i][jsonCol] : '';
        if (raw) { try { records.push(JSON.parse(raw)); } catch (e) {} }
      }
    }
  }
  var folderName = 'FQA Backups';
  var it = DriveApp.getFoldersByName(folderName);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  var stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  var name = 'fqa-backup-' + stamp + '.json';
  var ex = folder.getFilesByName(name); while (ex.hasNext()) ex.next().setTrashed(true);   // กันซ้ำวันเดียวกัน
  folder.createFile(name, JSON.stringify({ exportedAt: new Date().toISOString(), count: records.length, records: records }), 'application/json');
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  var files = folder.getFiles();
  while (files.hasNext()) { var f = files.next(); if (f.getDateCreated() < cutoff) f.setTrashed(true); }
  return { ok: true, file: name, count: records.length };
}

/* =======================================================================
   อุ่นแคชไว้ล่วงหน้า (Cache warm-up)
   · warmCaches()        = เรียกข้อมูลทุกชุดหนึ่งรอบ ถ้าแคชหายไปจะสร้างใหม่ให้
   · setupCacheWarmup()  = ตั้งให้รันเองทุก 5 นาที (รันครั้งเดียวจาก editor)

   ทำไมต้องมี: แคชช่วยได้ตั้งแต่รอบที่สองเป็นต้นไป ส่วนรอบแรกยังต้องเปิด
   สเปรดชีตทั้งไฟล์ ซึ่งวัดได้ 17-45 วินาที และบางครั้งตอบกลับมาไม่ครบ
   ถ้าปล่อยไว้ คนแรกที่เปิดหลังมีคนบันทึกข้อมูลจะเป็นคนรับกรรมทุกครั้ง
   ให้ตัวตั้งเวลาไปรับกรรมแทนในเบื้องหลัง คนใช้งานจริงจะเจอแต่รอบที่เร็ว

   ต้นทุน: รอบที่แคชยังอยู่จะจบใน 1-2 วินาที (แค่อ่านแคช) จะหนักเฉพาะรอบ
   ที่ต้องสร้างใหม่จริง ๆ คือหลังมีคนบันทึกข้อมูลหรือหลังแคชหมดอายุเท่านั้น
   ======================================================================= */
function warmCaches() {
  var out = {};
  /* แยก try ทีละอัน — ชุดไหนพังต้องไม่ทำให้ชุดที่เหลือไม่ได้อุ่น */
  function step(name, fn) {
    var t0 = new Date().getTime();
    try { fn(); out[name] = (new Date().getTime() - t0) + 'ms'; }
    catch (e) { out[name] = 'error: ' + String(e); }
  }
  step('exams', function () { getExams(); });
  step('examResults', function () { getExamResults(); });
  step('examRequests', function () { getExamRequests('', 'all'); });
  step('fqaRecords', function () { getFqaRecords('', ''); });
  Logger.log(JSON.stringify(out));
  return out;
}

function setupCacheWarmup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'warmCaches') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('warmCaches').timeBased().everyMinutes(5).create();
  return 'ตั้งอุ่นแคชอัตโนมัติทุก 5 นาทีเรียบร้อย';
}

function setupDailyBackup() {
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction() === 'backupFqaDaily') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupFqaDaily').timeBased().everyDays(1).atHour(2).create();
  return 'ตั้งสำรองอัตโนมัติทุกวันตี 2 เรียบร้อย';
}

/* ═════════════════════════════════════════════════
   คำขอสอบ + รหัสเข้าสอบ  (ExamRequests)
   ขั้นตอน: พนักงานขอสิทธิ์ → แอดมินอนุมัติ → ระบบสุ่มรหัส →
            ใช้รหัสเข้าสอบ → ส่งข้อสอบเสร็จ รหัสถูกปิดทันที ใช้ซ้ำไม่ได้

   หมายเหตุเรื่องความปลอดภัย: เว็บแอปนี้เปิดสาธารณะเหมือนส่วนอื่นของระบบ
   รหัสจึงเป็น "ตัวคุมลำดับงาน" ไม่ใช่กำแพงกันคนตั้งใจโกง
   จึงส่งรหัสกลับเฉพาะแถวของสาขาที่ถาม (ต้องระบุ branch) เพื่อลดการเห็นรหัสคนอื่นโดยบังเอิญ
   ═════════════════════════════════════════════════ */
var EXAMREQ_HEADERS = ['id','createdAt','examId','examTitle','brand','branchCode','branchName',
                       'name','empId','status','code','approvedAt','approvedBy','usedAt','note',
                       'position','requestedBy','requestedByName','track'];   /* track = ส่วนที่ขอสอบ (ชุดที่แบ่งส่วน) */

function _reqSheet() { return _getOrCreateSheet('ExamRequests', EXAMREQ_HEADERS); }

function _reqRead() {
  var sh = _reqSheet();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { sh: sh, headers: EXAMREQ_HEADERS.slice(), rows: [] };
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    for (var c = 0; c < headers.length; c++) o[headers[c]] = values[i][c];
    rows.push(o);
  }
  return { sh: sh, headers: headers, rows: rows };
}

/* รหัส 6 ตัว ตัดอักษร/เลขที่อ่านสับสน (0/O, 1/I/L) ออก — อ่านผ่านโทรศัพท์แล้วไม่พิมพ์ผิด */
function _newExamCode(taken) {
  var AB = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  for (var t = 0; t < 200; t++) {
    var s = '';
    for (var i = 0; i < 6; i++) s += AB.charAt(Math.floor(Math.random() * AB.length));
    if (!taken[s]) return s;
  }
  return 'X' + String(Date.now()).slice(-5);
}

/* branch = ชื่อสาขา (ฝั่งสาขาเรียก) · scope=all = ทั้งหมด (ฝั่งแอดมิน) */
function getExamRequests(branch, scope) {
  /* แคชเก็บ "ทั้งหมด" ไว้ก้อนเดียว แล้วค่อยกรองตามสาขาตอนตอบ
     ถ้าแยกแคชรายสาขาจะกลายเป็นหลายสิบก้อนที่ต้องล้างพร้อมกัน พลาดง่าย */
  var rows = _oeCacheGet('exam_req_v1');
  if (!rows) {
    rows = _reqRead().rows;
    _oeCachePut('exam_req_v1', rows);
  }
  var all = String(scope || '') === 'all';
  var want = String(branch || '').trim();
  var out = [];
  rows.forEach(function (r) {
    if (!all) {
      if (!want) return;
      if (String(r.branchName || '').trim() !== want && String(r.branchCode || '').trim() !== want) return;
    }
    out.push({
      id: r.id, createdAt: r.createdAt, examId: r.examId, examTitle: r.examTitle, brand: r.brand,
      branchCode: r.branchCode, branchName: r.branchName, name: r.name, empId: r.empId,
      position: r.position || '',
      status: r.status || 'pending', code: r.code || '',
      approvedAt: r.approvedAt, approvedBy: r.approvedBy, usedAt: r.usedAt, note: r.note || '',
      requestedBy: r.requestedBy || '', requestedByName: r.requestedByName || '',
      track: r.track || ''
    });
  });
  return { ok: true, requests: out };
}

function saveExamRequest(req) {
  if (!req || !req.examId || !String(req.name || '').trim()) return { ok: false, error: 'invalid request' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = _reqRead();
    /* กันกดขอซ้ำ: คนเดิม ชุดเดิม ที่ยังรออนุมัติหรืออนุมัติแล้วแต่ยังไม่ได้ใช้
       ให้คืนคำขอเดิมกลับไป ไม่สร้างใหม่ ไม่งั้นแอดมินจะเห็นรายการซ้ำเต็มไปหมด */
    var key = function (r) {
      /* ส่วนที่ขอสอบต่างกัน = คนละคำขอ (ขอสอบบริการไว้แล้ว มาขอสอบครัวเพิ่มได้) */
      return String(r.examId) + '|' + String(r.name).trim() + '|' + String(r.empId || '').trim() + '|' + String(r.track || '').trim();
    };
    var mine = key(req);
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      var st = String(r.status || 'pending');
      if (key(r) === mine && (st === 'pending' || st === 'approved')) {
        return { ok: true, duplicate: true, id: r.id, status: st, code: r.code || '' };
      }
    }
    var id = 'req_' + Date.now() + '_' + Math.floor(Math.random() * 1e5);
    var map = {
      id: id, createdAt: new Date().toISOString(),
      examId: req.examId || '', examTitle: req.examTitle || '', brand: req.brand || '',
      branchCode: req.branchCode || '', branchName: req.branchName || '',
      name: String(req.name).trim(), empId: String(req.empId || '').trim(),
      position: String(req.position || '').trim(),
      /* คนกดขอ ไม่ใช่คนที่ถูกขอให้ไปสอบ — หัวหน้าขอแทนลูกน้องได้ ชื่อในคำขอจึงไม่ใช่ตัวเขา */
      requestedBy: String(req.requestedBy || '').trim(),
      requestedByName: String(req.requestedByName || '').trim(),
      track: String(req.track || '').trim(),
      status: 'pending', code: '', approvedAt: '', approvedBy: '', usedAt: '', note: ''
    };
    d.sh.appendRow(d.headers.map(function (h) { return map.hasOwnProperty(h) ? map[h] : ''; }));
    _examCacheKill();
    return { ok: true, id: id, status: 'pending' };
  } finally { lock.releaseLock(); }
}

/* อนุมัติ = สุ่มรหัสให้ · ถ้าเคยอนุมัติแล้วคืนรหัสเดิม ไม่สุ่มใหม่
   (กดซ้ำเพราะเน็ตค้างจะได้ไม่เปลี่ยนรหัสที่บอกพนักงานไปแล้ว) */
function decideExamRequest(id, decision, by, note) {
  if (!id) return { ok: false, error: 'no id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = _reqRead();
    var taken = {};
    d.rows.forEach(function (r) { if (r.code) taken[String(r.code)] = 1; });
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      if (String(r.id) !== String(id)) continue;
      if (String(r.status) === 'used') return { ok: false, error: 'ทำข้อสอบไปแล้ว' };
      var st = decision === 'reject' ? 'rejected' : 'approved';
      var code = st === 'approved' ? (r.code || _newExamCode(taken)) : '';
      var set = {
        status: st, code: code,
        approvedAt: new Date().toISOString(), approvedBy: by || '', note: note || r.note || ''
      };
      Object.keys(set).forEach(function (k) {
        var c = d.headers.indexOf(k);
        if (c >= 0) d.sh.getRange(r._row, c + 1).setValue(set[k]);
      });
      _examCacheKill();
      return { ok: true, id: id, status: st, code: code };
    }
    return { ok: false, error: 'not found' };
  } finally { lock.releaseLock(); }
}

/* ตรวจรหัสก่อนเริ่มสอบ — ต้องเป็นรหัสที่อนุมัติแล้ว ยังไม่ถูกใช้ และตรงชุดข้อสอบ */
function verifyExamCode(code, examId) {
  var want = String(code || '').trim().toUpperCase();
  if (!want) return { ok: false, error: 'no code' };
  /* ตั้งใจไม่ใช้แคชตรงนี้ — ต้องรู้สถานะล่าสุดจริง ๆ ว่ารหัสถูกใช้ไปหรือยัง
     ถ้าอ่านของเก่า รหัสที่เพิ่งใช้เสร็จจะยังเข้าสอบซ้ำได้อีกจนกว่าแคชจะหมดอายุ */
  var d = _reqRead();
  for (var i = 0; i < d.rows.length; i++) {
    var r = d.rows[i];
    if (String(r.code || '').trim().toUpperCase() !== want) continue;
    if (String(r.status) === 'used') return { ok: false, error: 'รหัสนี้ถูกใช้ไปแล้ว' };
    if (String(r.status) !== 'approved') return { ok: false, error: 'รหัสนี้ยังไม่ได้รับอนุมัติ' };
    if (examId && String(r.examId) !== String(examId)) return { ok: false, error: 'รหัสนี้ไม่ใช่ของชุดข้อสอบนี้' };
    return { ok: true, request: { id: r.id, examId: r.examId, name: r.name, empId: r.empId,
                                  position: r.position || '',
                                  branchName: r.branchName, branchCode: r.branchCode,
                                  track: r.track || '' } };
  }
  return { ok: false, error: 'ไม่พบรหัสนี้' };
}

/* ปิดรหัสทันทีที่ส่งข้อสอบ — เรียกจาก saveExamResult ด้วย จึงปิดแน่นอนแม้ผู้ใช้ปิดหน้าจอทิ้ง */
function useExamCode(code) {
  var want = String(code || '').trim().toUpperCase();
  if (!want) return { ok: false, error: 'no code' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = _reqRead();
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      if (String(r.code || '').trim().toUpperCase() !== want) continue;
      if (String(r.status) === 'used') return { ok: true, already: true };
      var sc = d.headers.indexOf('status'), uc = d.headers.indexOf('usedAt');
      if (sc >= 0) d.sh.getRange(r._row, sc + 1).setValue('used');
      if (uc >= 0) d.sh.getRange(r._row, uc + 1).setValue(new Date().toISOString());
      _examCacheKill();
      return { ok: true };
    }
    return { ok: false, error: 'not found' };
  } finally { lock.releaseLock(); }
}

function deleteExamRequest(id) {
  if (!id) return { ok: false, error: 'no id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = _reqRead();
    for (var i = d.rows.length - 1; i >= 0; i--) {
      if (String(d.rows[i].id) === String(id)) { d.sh.deleteRow(d.rows[i]._row); _examCacheKill(); return { ok: true }; }
    }
    return { ok: false, error: 'not found' };
  } finally { lock.releaseLock(); }
}

/* =======================================================================
   สำรองข้อมูลระบบเช็คลิสต์ (Checklist auto-backup)

   ทำไมต้องมี: backupFqaDaily() ข้างบนสำรองเฉพาะระบบ Visit สาขา ซึ่งเก็บในชีตนี้
   ส่วนผลตรวจเปิด-ปิดร้านของทุกสาขาอยู่ใน Firestore คนละที่ และไม่เคยมีการสำรองเลย
   วันที่เขียนโค้ดนี้มี 6,410 ใบ ย้อนหลังตั้งแต่ 26 มิ.ย. 2569 ถ้าหายคือหายถาวร

   . backupChecklistDay(date)  = สำรองผลตรวจของวันเดียว เป็นไฟล์ ck-daily-<วันที่>.json
   . backupChecklistSmall()    = สำรองคอลเลกชันเล็กทั้งก้อน (เจ๊แดง สรุปรายเดือน audits)
   . backupChecklistDaily()    = ตัวที่ตัวตั้งเวลาเรียกทุกคืน (เมื่อวาน + วันนี้ + ก้อนเล็ก)
   . backupChecklistBackfill() = ไล่สำรองย้อนหลัง รันซ้ำได้จนกว่าจะครบ
   . setupChecklistBackup()    = ตั้งตัวตั้งเวลา รันครั้งเดียวจาก editor

   ทำไมแบ่งเป็นวัน: ทั้งหมดรวมกันราว 83 MB ดึงรวดเดียวไม่ทัน 6 นาทีที่ Apps Script ให้
   วันละราว 1.5 MB (117 ใบ) ซึ่งจบใน 2-3 วินาที และแบ่งแล้วยังกู้เฉพาะวันที่ต้องการได้
   ไม่ต้องยกไฟล์ทั้งก้อนมาเปิด

   ทำไมแปลงเป็น JSON ธรรมดา: รูปแบบดิบของ Firestore ห่อค่าทุกตัวด้วยชนิดข้อมูล
   ซึ่งใหญ่กว่ากันสี่เท่า วัดจากของจริงแล้ว 2.6 MB เหลือ 656 KB
   และรูปแบบที่ได้ตรงกับที่แอปใช้ เอากลับเข้าระบบได้เลย
   ======================================================================= */
var CKB_PROJECT = 'checklist-a89e2';
/* คีย์นี้เป็นคีย์ฝั่งหน้าเว็บ อยู่ใน index.html ที่เปิดสาธารณะอยู่แล้ว ไม่ใช่ความลับ */
var CKB_KEY = 'AIzaSyB489GnLRlLL00a-5JhsGBn5y7W8STIGpI';
var CKB_BASE = 'https://firestore.googleapis.com/v1/projects/' + CKB_PROJECT + '/databases/(default)/documents';
var CKB_FOLDER = 'Checklist Backups';
var CKB_TZ = 'Asia/Bangkok';
/* เก็บย้อนหลังกี่วัน - ตั้งยาวกว่าที่ Firestore เก็บ (90 วัน) มาก
   เพราะจุดประสงค์คือกู้คืนตอนข้อมูลหาย ไม่ใช่แค่เก็บของใช้งานประจำ */
var CKB_KEEP_DAYS = 400;
/* เผื่อเวลาจาก 6 นาทีที่ Apps Script ให้ - หมดโควตาแล้วให้หยุดอย่างเรียบร้อยแล้วบอกให้รันซ้ำ
   ดีกว่าถูกตัดกลางคันจนได้ไฟล์ที่เขียนไม่จบ */
var CKB_BUDGET_MS = 4.5 * 60 * 1000;

/* ---------- สิทธิ์เข้า Firestore ----------

   เดิมยิงด้วย apiKey เปล่า ๆ ซึ่งใช้ได้ตอนกฎยังเปิดให้ทุกคน
   พอเปลี่ยนกฎเป็น "ต้องล็อกอินก่อน" คีย์เปล่าจะถูกปฏิเสธและการสำรองจะเงียบไปเฉย ๆ

   ทางแก้คือใช้ service account เดียวกับที่สคริปต์ Telegram ใช้อยู่แล้ว
   (Script properties: FB_CLIENT_EMAIL กับ FB_PRIVATE_KEY)
   สิทธิ์ระดับเซิร์ฟเวอร์แบบนี้ไม่ติดกฎความปลอดภัย จึงสำรองได้ครบทุกคอลเลกชัน

   ถ้ายังไม่ได้ตั้งค่านั้น จะถอยไปใช้ apiKey เหมือนเดิม — ยังทำงานได้จนกว่ากฎจะเปลี่ยน
   ตรวจได้ด้วย checkChecklistBackup() ซึ่งจะบอกว่าตอนนี้ใช้ทางไหนอยู่
   ---------------------------------------- */
function _ckbToken() {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('FB_CLIENT_EMAIL');
  var key = (props.getProperty('FB_PRIVATE_KEY') || '').replace(/[\\]n/g, String.fromCharCode(10));
  if (!email || !key) return '';           /* ยังไม่ได้ตั้ง = ถอยไปใช้ apiKey */

  var cache = CacheService.getScriptCache();       /* โทเคนอายุ 1 ชม. ขอใหม่ทุกครั้งเปลืองเวลา */
  var hit = cache.get('ckb_token');
  if (hit) return hit;

  var now = Math.floor(Date.now() / 1000);
  var enc = function (o) { return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, ''); };
  var toSign = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  });
  var jwt = toSign + '.' + Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(toSign, key)).replace(/=+$/, '');

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }
  });
  var data = JSON.parse(res.getContentText() || '{}');
  if (!data.access_token) throw new Error('ขอโทเคน service account ไม่สำเร็จ: ' + res.getContentText().slice(0, 200));
  cache.put('ckb_token', data.access_token, 3300);
  return data.access_token;
}
/* ต่อท้าย URL ด้วย apiKey เฉพาะตอนไม่มีโทเคน — มีโทเคนแล้วไม่ต้องใช้คีย์ */
function _ckbAuth(url) {
  var t = _ckbToken();
  if (t) return { url: url, headers: { Authorization: 'Bearer ' + t } };
  return { url: url + (url.indexOf('?') >= 0 ? '&' : '?') + 'key=' + CKB_KEY, headers: {} };
}
/* ---------- แปลงค่าจากรูปแบบของ Firestore เป็น JSON ธรรมดา ---------- */
function _ckbDecode(v) {
  if (v === null || v === undefined) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue'      in v) return null;
  if ('arrayValue'     in v) return ((v.arrayValue && v.arrayValue.values) || []).map(_ckbDecode);
  if ('mapValue'       in v) return _ckbFields((v.mapValue && v.mapValue.fields) || {});
  return null;
}
function _ckbFields(f) { var o = {}; for (var k in f) o[k] = _ckbDecode(f[k]); return o; }
function _ckbDocId(name) { var p = String(name || '').split('/'); return p[p.length - 1]; }

/* ---------- ดึงข้อมูล ---------- */
function _ckbQueryByDate(collection, dateStr) {
  var body = { structuredQuery: { from: [{ collectionId: collection }],
    where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL',
             value: { stringValue: dateStr } } } } };
  var a = _ckbAuth(CKB_BASE + ':runQuery');
  var res = UrlFetchApp.fetch(a.url, {
    method: 'post', contentType: 'application/json', headers: a.headers,
    payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Firestore ตอบ ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  var arr = JSON.parse(res.getContentText());
  if (!(arr instanceof Array)) throw new Error('รูปแบบผลลัพธ์ไม่ถูกต้อง');
  var out = [];
  arr.forEach(function (x) {
    if (!x.document) return;                       /* แถวที่มีแต่ readTime = ไม่พบข้อมูล */
    var o = _ckbFields(x.document.fields || {});
    if (!o.id) o.id = _ckbDocId(x.document.name);
    out.push(o);
  });
  return out;
}
function _ckbListAll(collection) {
  var out = [], token = '';
  for (var i = 0; i < 200; i++) {
    var u = CKB_BASE + '/' + collection + '?pageSize=300' +
            (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var a = _ckbAuth(u);
    var res = UrlFetchApp.fetch(a.url, { headers: a.headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error(collection + ' ตอบ ' + res.getResponseCode());
    var j = JSON.parse(res.getContentText());
    (j.documents || []).forEach(function (d) {
      var o = _ckbFields(d.fields || {});
      if (!o.id) o.id = _ckbDocId(d.name);
      out.push(o);
    });
    token = j.nextPageToken || '';
    if (!token) break;
  }
  return out;
}

/* ---------- เขียนไฟล์ ---------- */
function _ckbFolder() {
  var it = DriveApp.getFoldersByName(CKB_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CKB_FOLDER);
}
function _ckbHasFile(name) { return _ckbFolder().getFilesByName(name).hasNext(); }
function _ckbWrite(name, payload) {
  var folder = _ckbFolder();
  var ex = folder.getFilesByName(name);
  while (ex.hasNext()) ex.next().setTrashed(true);   /* เขียนทับของวันเดียวกัน */
  folder.createFile(name, JSON.stringify(payload), 'application/json');
}

/* ---------- งานหลัก ---------- */
function backupChecklistDay(dateStr) {
  var recs = _ckbQueryByDate('dailyChecklists', dateStr);
  /* วันที่ไม่มีใบเลย (ร้านปิด/ยังไม่ถึง) ไม่ต้องสร้างไฟล์เปล่า
     ไม่งั้นตัวไล่ย้อนหลังจะมองว่าทำแล้ว ทั้งที่ยังไม่มีอะไรให้ทำ */
  if (!recs.length) return { ok: true, date: dateStr, count: 0, skipped: true };
  _ckbWrite('ck-daily-' + dateStr + '.json',
    { exportedAt: new Date().toISOString(), collection: 'dailyChecklists',
      date: dateStr, count: recs.length, records: recs });
  return { ok: true, date: dateStr, count: recs.length };
}
function backupChecklistSmall() {
  var stamp = Utilities.formatDate(new Date(), CKB_TZ, 'yyyy-MM-dd');
  var out = { exportedAt: new Date().toISOString() };
  ['jaedaengAudits', 'dailySummary', 'audits'].forEach(function (c) {
    try { out[c] = _ckbListAll(c); }
    catch (e) { out[c] = { error: String(e && e.message || e) }; }
  });
  _ckbWrite('ck-small-' + stamp + '.json', out);
  return { ok: true, jaedaeng: (out.jaedaengAudits || []).length,
           summary: (out.dailySummary || []).length, audits: (out.audits || []).length };
}
/* ตัวที่ตัวตั้งเวลาเรียกทุกคืน - ทำเมื่อวานด้วย เพราะรอบปิดร้านบางสาขาส่งหลังเที่ยงคืน
   ถ้าทำแต่วันนี้จะตกหล่น */
function backupChecklistDaily() {
  var now = new Date();
  var y = new Date(now.getTime() - 86400000);
  var f = function (d) { return Utilities.formatDate(d, CKB_TZ, 'yyyy-MM-dd'); };
  var r1 = backupChecklistDay(f(y));
  var r2 = backupChecklistDay(f(now));
  var r3 = backupChecklistSmall();
  _ckbPurgeOld();
  return { yesterday: r1, today: r2, small: r3 };
}
/* ไล่สำรองย้อนหลัง - ข้ามวันที่มีไฟล์แล้ว หยุดเมื่อใกล้หมดเวลาหรือเจอวันว่างติดกันหลายวัน
   รันซ้ำได้เรื่อย ๆ จนกว่าจะขึ้นว่าครบ */
function backupChecklistBackfill() {
  var t0 = Date.now(), done = 0, empty = 0, cur = new Date();
  for (var i = 0; i < CKB_KEEP_DAYS; i++) {
    if (Date.now() - t0 > CKB_BUDGET_MS) {
      return { ok: true, done: done, stopped: 'หมดเวลารอบนี้ - รัน backupChecklistBackfill() อีกครั้งเพื่อทำต่อ' };
    }
    var d = Utilities.formatDate(cur, CKB_TZ, 'yyyy-MM-dd');
    cur = new Date(cur.getTime() - 86400000);
    if (_ckbHasFile('ck-daily-' + d + '.json')) { empty = 0; continue; }
    var r = backupChecklistDay(d);
    if (r.count) { done++; empty = 0; }
    else { empty++; if (empty >= 14) return { ok: true, done: done, stopped: 'ไม่พบข้อมูลติดกัน 14 วัน - น่าจะครบแล้ว' }; }
  }
  return { ok: true, done: done, stopped: 'ครบ ' + CKB_KEEP_DAYS + ' วันแล้ว' };
}
function _ckbPurgeOld() {
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - CKB_KEEP_DAYS);
  var files = _ckbFolder().getFiles(), n = 0;
  while (files.hasNext()) { var f = files.next(); if (f.getDateCreated() < cutoff) { f.setTrashed(true); n++; } }
  return n;
}
/* ตั้งตัวตั้งเวลา - ตี 3 คนละชั่วโมงกับ backupFqaDaily ที่ตี 2 จะได้ไม่ชนกัน */
function setupChecklistBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupChecklistDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupChecklistDaily').timeBased().atHour(3).everyDays(1).create();
  return { ok: true, msg: 'ตั้งให้สำรองข้อมูลเช็คลิสต์ทุกวันตอนตี 3 แล้ว' };
}

/* =======================================================================
   ตรวจผลการสำรองข้อมูลเช็คลิสต์

   ทำไมต้องมี: backupChecklistBackfill() คืนค่าเป็น object แต่บันทึกการดำเนินการ
   ของ Apps Script ไม่โชว์ค่าที่คืนกลับ เห็นแค่ว่า "ดำเนินการเสร็จแล้ว"
   ซึ่งบอกไม่ได้เลยว่าสำรองไปกี่วัน ครบหรือยัง

   . checkChecklistBackup() = สรุปว่าในโฟลเดอร์มีอะไรบ้าง และวันไหนยังขาด
   ======================================================================= */
function checkChecklistBackup() {
  var folder = _ckbFolder();
  var files = folder.getFiles();
  var days = [], small = [], bytes = 0;
  while (files.hasNext()) {
    var f = files.next(), n = f.getName();
    bytes += f.getSize();
    if (n.indexOf('ck-daily-') === 0) days.push(n.slice(9, 19));
    else if (n.indexOf('ck-small-') === 0) small.push(n.slice(9, 19));
  }
  days.sort(); small.sort();

  /* หาวันที่ยังขาดในช่วงที่สำรองไปแล้ว — วันที่ไม่มีใบตรวจเลยจะไม่มีไฟล์
     ซึ่งเป็นเรื่องปกติ (ร้านปิด/ยังไม่ถึงวัน) จึงบอกไว้เฉย ๆ ไม่ใช่ข้อผิดพลาด */
  var gaps = [];
  if (days.length > 1) {
    var cur = new Date(days[0] + 'T00:00:00Z');
    var last = new Date(days[days.length - 1] + 'T00:00:00Z');
    var have = {};
    days.forEach(function (d) { have[d] = 1; });
    while (cur <= last) {
      var s = Utilities.formatDate(cur, 'UTC', 'yyyy-MM-dd');
      if (!have[s]) gaps.push(s);
      cur = new Date(cur.getTime() + 86400000);
    }
  }

  var out = {
    โฟลเดอร์: CKB_FOLDER,
    ไฟล์รายวัน: days.length + ' วัน',
    ช่วงวันที่: days.length ? (days[0] + ' ถึง ' + days[days.length - 1]) : 'ยังไม่มี',
    ไฟล์ก้อนเล็ก: small.length ? small.join(', ') : 'ยังไม่มี',
    ขนาดรวม: (bytes / 1024 / 1024).toFixed(1) + ' MB',
    วันที่ไม่มีไฟล์: gaps.length ? (gaps.length + ' วัน: ' + gaps.join(', ')) : 'ไม่มี',
    ตัวตั้งเวลา: 'ยังไม่ได้ตั้ง',
    สิทธิ์ที่ใช้: (_ckbToken() ? 'service account (ผ่านกฎความปลอดภัยได้)' : 'apiKey (จะใช้ไม่ได้เมื่อล็อกกฎแล้ว)')
  };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupChecklistDaily') out['ตัวตั้งเวลา'] = 'ตั้งแล้ว (ทุกวัน)';
  });

  Logger.log(JSON.stringify(out, null, 1));
  return out;
}

/* เขียนผลลัพธ์ลงบันทึกการดำเนินการด้วย จะได้เห็นว่าทำอะไรไปบ้างโดยไม่ต้องเรียกตัวตรวจแยก */
function backupChecklistBackfillLogged() {
  var r = backupChecklistBackfill();
  Logger.log(JSON.stringify(r));
  return r;
}
function backupChecklistDailyLogged() {
  var r = backupChecklistDaily();
  Logger.log(JSON.stringify(r));
  return r;
}
