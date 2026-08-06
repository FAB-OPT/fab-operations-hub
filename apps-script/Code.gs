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
    if (action === 'fqa-records')  return jsonOut(getFqaRecords((e && e.parameter && e.parameter.brand) || '', (e && e.parameter && e.parameter.since) || ''));
    if (action === 'clear-cache')  return jsonOut(clearAllCacheReturn());
    return jsonOut(getCertificates());
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.type === 'save-certificates')  return jsonOut(saveCertificates(data.records));
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

function saveCertificates(records) {
  if (!Array.isArray(records) || records.length === 0) return { ok: false, error: 'no records' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Certificates') || ss.insertSheet('Certificates');
    var headers = ['ชื่อในใบรับรอง','หลักสูตร','วันอบรม','วันหมดอายุ','สถานะใบรับรอง','ชื่อในระบบ','สาขา','ตำแหน่ง','Sheet','สถานะจับคู่'];
    sh.clear();                 // replace: ล้างก่อนเขียน (เว็บส่งชุดเต็มทุกครั้ง — กันซ้ำ/ของเดิมตกค้าง)
    sh.appendRow(headers);
    var rows = records.map(function(r){
      return [r.certName||'', r.course||'', r.trainDate||'', r.expireDate||'', r.expStatus||'',
              r.empName||'', r.branch||'', r.position||'', r.sheet||'', r.matchType||''];
    });
    if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
    CacheService.getScriptCache().remove('cert_v2');
    return { ok: true, saved: rows.length };
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

/* ──────────────────── CONFIG ──────────────────── */
function getConfig() {
  var cache = CacheService.getScriptCache();
  var sysCached = cache.get('cfg_systems_v2');
  var annCached = cache.get('cfg_announcements_v2');
  var usrCached = cache.get('cfg_users_v2');
  var brCached  = cache.get('cfg_branches_v2');
  var jdCached  = cache.get('cfg_jaedaengBranches_v2');
  var prmCached = cache.get('cfg_perms_v2');
  var systems          = sysCached ? JSON.parse(sysCached) : readConfig_('systems', []);
  var announcements    = annCached ? JSON.parse(annCached) : readConfig_('announcements', []);
  var users            = usrCached ? JSON.parse(usrCached) : readConfig_('users', null);
  var branches         = brCached  ? JSON.parse(brCached)  : readConfig_('branches', null);
  var jaedaengBranches = jdCached  ? JSON.parse(jdCached)  : readConfig_('jaedaengBranches', null);
  // สิทธิ์ปุ่มของแต่ละระบบ — { checklist:{...}, foodhandler:{...}, training:{...} }
  // null = ยังไม่เคยตั้ง → ให้ client ใช้ค่า default ในโค้ดตัวเอง
  var perms            = prmCached ? JSON.parse(prmCached) : readConfig_('perms', null);
  if (!sysCached) try { cache.put('cfg_systems_v2', JSON.stringify(systems), CACHE_SEC); } catch(e) {}
  if (!annCached) try { cache.put('cfg_announcements_v2', JSON.stringify(announcements), CACHE_SEC); } catch(e) {}
  if (!usrCached) try { cache.put('cfg_users_v2', JSON.stringify(users), CACHE_SEC); } catch(e) {}
  if (!brCached)  try { cache.put('cfg_branches_v2', JSON.stringify(branches), CACHE_SEC); } catch(e) {}
  if (!jdCached)  try { cache.put('cfg_jaedaengBranches_v2', JSON.stringify(jaedaengBranches), CACHE_SEC); } catch(e) {}
  if (!prmCached) try { cache.put('cfg_perms_v2', JSON.stringify(perms), CACHE_SEC); } catch(e) {}
  return { ok: true, systems: systems, announcements: announcements, users: users, branches: branches, jaedaengBranches: jaedaengBranches, perms: perms };
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
  CacheService.getScriptCache().removeAll(['cert_v2','emp_v1','req_v2','cfg_systems_v2','cfg_announcements_v2','cfg_users_v2','cfg_branches_v2']);
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
var EXAMRESULT_HEADERS = ['submittedAt','examId','examTitle','name','empId','branch','brand','pct','correct','total','result','violations','finishReason','startedAt','answersJson'];

function _getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); }
  else if (sh.getLastRow() === 0) { sh.appendRow(headers); }
  return sh;
}

/* ──────────────── EXAMS ──────────────── */
function getExams() {
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
  return { ok: true, exams: exams };
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
        return { ok: true, id: exam.id, updated: true };
      }
    }
    sh.appendRow(rowArr);
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
      if (String(values[i][idCol]) === String(id)) { sh.deleteRow(i + 1); return { ok: true }; }
    }
    return { ok: false, error: 'not found' };
  } finally { lock.releaseLock(); }
}

/* ──────────────── EXAM RESULTS ──────────────── */
function saveExamResult(r) {
  if (!r || !r.name) return { ok: false, error: 'invalid result' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = _getOrCreateSheet('ExamResults', EXAMRESULT_HEADERS);
    var row = [
      r.submittedAt || new Date().toISOString(),
      r.examId || '', r.examTitle || '', r.name || '', r.empId || '',
      r.branch || '', r.brand || '', r.pct != null ? r.pct : '',
      r.correct != null ? r.correct : '', r.total != null ? r.total : '',
      r.result || '', r.violations != null ? r.violations : 0,
      r.finishReason || '', r.startedAt || '',
      r.answers ? JSON.stringify(r.answers) : ''
    ];
    sh.appendRow(row);
    return { ok: true, saved: 1 };
  } finally { lock.releaseLock(); }
}

function getExamResults() {
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
    results.push(rec);
  }
  return { ok: true, results: results };
}

/* ──────────────── FQA / FSQ / VISIT — รายการตรวจสาขา ────────────────
   ชีต FqaRecords: 1 แถว = 1 รายการตรวจ · เก็บ JSON ทั้งก้อนในคอลัมน์ json
   รูปภาพไม่เก็บที่นี่ — อัปโหลดขึ้น Drive แล้วเก็บเป็น URL ในตัว record
   (กัน JSON เกินลิมิต 50,000 ตัวอักษร/ช่องของ Google Sheets) */
var FQA_HEADERS = ['id','brand','type','date','branch','updatedAt','json'];

var FQA_DEL_HEADERS = ['id','deletedAt'];

/* รายการ id ที่ถูกลบ (tombstone) — ให้ทุกเครื่องลบตามแบบเด็ดขาด ไม่เด้งกลับ */
function _fqaDeletedIds() {
  var sh = _getOrCreateSheet('FqaDeleted', FQA_DEL_HEADERS);
  var values = sh.getDataRange().getValues();
  var ids = [];
  for (var i = 1; i < values.length; i++) { if (values[i][0]) ids.push(String(values[i][0])); }
  return ids;
}

function getFqaRecords(brand, since) {
  var sh = _getOrCreateSheet('FqaRecords', FQA_HEADERS);
  var values = sh.getDataRange().getValues();
  var deleted = _fqaDeletedIds();
  var now = new Date().toISOString();
  if (values.length < 2) return { ok: true, records: [], deleted: deleted, now: now };
  var headers = values[0].map(function(h){ return String(h).trim(); });
  var brandCol = headers.indexOf('brand'), jsonCol = headers.indexOf('json');
  var records = [];
  for (var i = 1; i < values.length; i++) {
    if (brand && String(values[i][brandCol]) !== String(brand)) continue;
    var raw = jsonCol >= 0 ? values[i][jsonCol] : '';
    if (!raw) continue;
    try {
      var rec = JSON.parse(raw);
      /* ซิงค์แบบ incremental (ถ้าส่ง since มา) — ส่งเฉพาะที่เปลี่ยนหลัง since */
      if (since && rec && rec.updatedAt && String(rec.updatedAt) <= String(since)) continue;
      records.push(rec);
    } catch (e) {}
  }
  return { ok: true, records: records, deleted: deleted, now: now };
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
        return { ok: true, id: rec.id, updated: true };
      }
    }
    sh.appendRow(rowArr);
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

function setupDailyBackup() {
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction() === 'backupFqaDaily') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupFqaDaily').timeBased().everyDays(1).atHour(2).create();
  return 'ตั้งสำรองอัตโนมัติทุกวันตี 2 เรียบร้อย';
}
