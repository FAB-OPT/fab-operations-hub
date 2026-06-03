/* ═══════════════════════════════════════════════════════════════
   FAB Operations Hub — Apps Script Backend (Code.gs)
   Sheets: Certificates, Requests, Config, Employees
   OCR: Google Cloud Vision API (Script Property: VISION_API_KEY)

   อัปเดต: getConfig() คืน users + branches เพิ่ม → ซิงค์ข้ามอุปกรณ์
   วิธีใช้: ก๊อปทั้งไฟล์นี้ทับใน Apps Script editor → Save → Deploy (New version)
   ═══════════════════════════════════════════════════════════════ */

var CACHE_SEC = 300;
var REQ_HEADERS = ['timestamp','name','empId','idCard','branch','position','course','trainDate','timeSlot','note','brand'];
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
    if (data.type === 'dedup-employees')    return jsonOut(dedupEmployees());
    if (data.type === 'dedup-certificates') return jsonOut(dedupCertificates());
    if (data.type === 'set-config')         return jsonOut(setConfig(data.key, data.value));
    if (data.type === 'upload-icon')        return jsonOut(uploadIcon(data.base64, data.filename));
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
    if (sh.getLastRow() === 0) sh.appendRow(headers);
    var rows = records.map(function(r){
      return [r.certName||'', r.course||'', r.trainDate||'', r.expireDate||'', r.expStatus||'',
              r.empName||'', r.branch||'', r.position||'', r.sheet||'', r.matchType||''];
    });
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, headers.length).setValues(rows);
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
    REQ_HEADERS.forEach(function(h, j){ rec[h] = row[j] != null ? row[j] : ''; });
    if (rec.timestamp instanceof Date) {
      rec.timestamp = Utilities.formatDate(rec.timestamp, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
    }
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

function saveRequests(records) {
  if (!Array.isArray(records) || records.length === 0) return { ok: false, error: 'no records' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Requests') || ss.insertSheet('Requests');
    if (sh.getLastRow() === 0) sh.appendRow(REQ_HEADERS);
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
    var existingTs = values[rowToUpdate - 1][0];
    var newRow = REQ_HEADERS.map(function(h){
      if (h === 'timestamp') return existingTs;
      return record[h] != null ? record[h] : '';
    });
    sh.getRange(rowToUpdate, 1, 1, REQ_HEADERS.length).setValues([newRow]);
    clearReqCache_();
    return { ok: true, updated: rowToUpdate };
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
  var systems          = sysCached ? JSON.parse(sysCached) : readConfig_('systems', []);
  var announcements    = annCached ? JSON.parse(annCached) : readConfig_('announcements', []);
  var users            = usrCached ? JSON.parse(usrCached) : readConfig_('users', null);
  var branches         = brCached  ? JSON.parse(brCached)  : readConfig_('branches', null);
  var jaedaengBranches = jdCached  ? JSON.parse(jdCached)  : readConfig_('jaedaengBranches', null);
  if (!sysCached) try { cache.put('cfg_systems_v2', JSON.stringify(systems), CACHE_SEC); } catch(e) {}
  if (!annCached) try { cache.put('cfg_announcements_v2', JSON.stringify(announcements), CACHE_SEC); } catch(e) {}
  if (!usrCached) try { cache.put('cfg_users_v2', JSON.stringify(users), CACHE_SEC); } catch(e) {}
  if (!brCached)  try { cache.put('cfg_branches_v2', JSON.stringify(branches), CACHE_SEC); } catch(e) {}
  if (!jdCached)  try { cache.put('cfg_jaedaengBranches_v2', JSON.stringify(jaedaengBranches), CACHE_SEC); } catch(e) {}
  return { ok: true, systems: systems, announcements: announcements, users: users, branches: branches, jaedaengBranches: jaedaengBranches };
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
