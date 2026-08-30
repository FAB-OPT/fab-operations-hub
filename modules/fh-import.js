/* fh-import.js — config · state · ลากวางไฟล์ · อ่าน PDF/OCR · อ่าน Excel
   แยกมาจาก food-handler.js (บรรทัดเดิม 1-507)
   ⚠️ ไฟล์ชุดนี้ต้องโหลดตามลำดับใน food-handler.html — อย่าสลับ */

/* ─────────── CONFIG ─────────── */
var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyjGvhSuDrnnOkWdwoq4CsR5jM3__lp58ZWe_BjcrxDIoOtnlFaiEdKUXX10EANUFCRXA/exec';

/* ─────────── STATE ─────────── */
var pdfData = null;   // [{name, course, trainDate, expireDate}]
var empData = null;   // [{name, branch, position, sheet}]
var matchData = [];   // final joined data
var today = new Date();

/* ─────────── DRAG & DROP ─────────── */
function dragOver(e, id) {
  e.preventDefault();
  document.getElementById(id).classList.add('dragging');
}
function dragLeave(id) {
  document.getElementById(id).classList.remove('dragging');
}
function dropFile(e, type) {
  e.preventDefault();
  var id = type==='pdf' ? 'pdfCard' : 'xlsxCard';
  document.getElementById(id).classList.remove('dragging');
  var files = e.dataTransfer.files;
  if (!files || !files.length) return;
  if (type==='pdf') processPDFFiles(files);
  else processXLSXFile(files[0]);
}

/* ─────────── PDF HANDLER (multi-file up to 20) ─────────── */
function handlePDF(input) {
  if (input.files && input.files.length) processPDFFiles(input.files);
}

/* กันปิดแท็บ/รีเฟรชระหว่างนำเข้า+บันทึกยังไม่เสร็จ (OCR/ตัดหน้า ทำในเบราว์เซอร์) */
window._fhImportBusy = false;
window.addEventListener('beforeunload', function(e){
  if (window._fhImportBusy) { e.preventDefault(); e.returnValue = 'กำลังบันทึกใบรับรอง ยังไม่เสร็จ — ปิดตอนนี้ข้อมูลที่ยังไม่บันทึกจะหาย'; return e.returnValue; }
});
function processPDFFiles(fileList) {
  var files = Array.from(fileList).filter(function(f){ return /\.pdf$/i.test(f.name); });
  if (files.length === 0) { setStatus('pdf','error','ไม่พบไฟล์ .pdf'); return; }
  if (typeof pdfjsLib === 'undefined') {
    setStatus('pdf','error','PDF.js ยังโหลดไม่เสร็จ — รอ 2-3 วินาทีแล้วลองใหม่');
    return;
  }
  window._fhImportBusy = true;   // ⛔ ห้ามปิดแท็บจนกว่าจะบันทึกเสร็จ
  setStatus('pdf','loading','กำลังอ่าน 0/'+files.length+' ไฟล์...');
  showProg('pdf'); setProg('pdf', 5);
  var allExtracted = [];
  var done = 0, failed = 0;

  function finish() {
    var seen = {};
    var uniq = [];
    allExtracted.forEach(function(item){
      var k = item.name + '|' + item.expireDate + '|' + (item.course||'');
      if (!seen[k]) { seen[k] = true; uniq.push(item); }
    });
    console.log('[DIAG FINISH] allExtracted(ก่อน dedup)=' + allExtracted.length + ' → pdfData(หลัง dedup)=' + uniq.length);
    pdfData = uniq;
    setProg('pdf', 100);
    var msg = 'โหลดสำเร็จ — ' + files.length + ' ไฟล์, พบ ' + uniq.length + ' ใบรับรอง';
    if (failed > 0) msg += ' (อ่านไม่ได้ ' + failed + ')';
    setStatus('pdf','done', msg);
    document.getElementById('pdfCard').classList.add('loaded');
    document.getElementById('pdfCard').classList.remove('dragging');
    checkReady();
  }

  function processOne(idx) {
    if (idx >= files.length) { finish(); return; }
    var file = files[idx];
    var reader = new FileReader();
    reader.onload = function(e) {
      var ab = e.target.result;
      // Clone for PDF.js (it detaches the original buffer) — keep `ab` for OCR fallback
      var abForPdfJs = ab.slice(0);
      pdfjsLib.getDocument({ data: abForPdfJs, disableFontFace: true, useSystemFonts: false }).promise
        .then(function(pdf){
          var allPageCerts = [];
          function processPage(p) {
            if (p > pdf.numPages) return Promise.resolve(allPageCerts);
            return pdf.getPage(p).then(function(page){
              return page.getTextContent().then(function(content){
                var pageText = content.items.map(function(it){ return it.str; }).join('');
                var pageTextSpace = content.items.map(function(it){ return it.str; }).join(' ');
                pageText = pageText + '\n' + pageTextSpace;
                var pageCerts = extractFromPDFText(pageText);
                pageCerts.forEach(function(c){ c._page = p; });   // ติดเลขหน้าไว้ตัดแยกรายคน
                allPageCerts = allPageCerts.concat(pageCerts);
                return processPage(p + 1);
              });
            });
          }
          return processPage(1);
        })
        .then(function(certs){
          if (certs.length > 0) {
            _fhSplitStoreCerts(ab, file, certs);   // ตัดหน้า→อัปแยก→ผูก URL รายคน
            allExtracted = allExtracted.concat(certs);
            done++;
            setStatus('pdf','loading','กำลังอ่าน '+done+'/'+files.length+' ไฟล์...');
            setProg('pdf', 5 + Math.floor((done / files.length) * 90));
            processOne(idx + 1);
          } else {
            // Fallback: OCR via Apps Script (Vision API)
            setStatus('pdf','loading','OCR ผ่าน Cloud — กำลังอ่าน '+(done+1)+'/'+files.length+' (ใบเป็นรูป ใช้เวลาสักครู่)...');
            ocrPdfViaAppsScript(ab, file.name)
              .then(function(ocrCerts){
                if (ocrCerts && ocrCerts.length > 0) {
                  _fhSplitStoreCerts(ab, file, ocrCerts);   // ตัดหน้า→อัปแยก→ผูก URL รายคน
                  allExtracted = allExtracted.concat(ocrCerts);
                  console.log('[OCR] ✓', file.name, '→', ocrCerts.length, 'certs');
                } else {
                  failed++;
                  console.warn('[OCR] ✗', file.name, '— 0 names found even after OCR');
                }
              })
              .catch(function(err){
                console.warn('OCR fallback failed', file.name, err.message || err);
                failed++;
              })
              .then(function(){
                done++;
                setStatus('pdf','loading','กำลังอ่าน '+done+'/'+files.length+' ไฟล์...');
                setProg('pdf', 5 + Math.floor((done / files.length) * 90));
                processOne(idx + 1);
              });
          }
        })
        .catch(function(err){
          console.warn('PDF parse error', file.name, err);
          failed++; done++;
          setStatus('pdf','loading','กำลังอ่าน '+done+'/'+files.length+' ไฟล์...');
          setProg('pdf', 5 + Math.floor((done / files.length) * 90));
          processOne(idx + 1);
        });
    };
    reader.onerror = function(){ failed++; done++; processOne(idx + 1); };
    reader.readAsArrayBuffer(file);
  }
  processOne(0);
}

// Render PDF pages → PNG → send each to Apps Script Vision API OCR
function ocrPdfViaAppsScript(arrayBuffer, filename) {
  if (!SCRIPT_URL) return Promise.reject(new Error('SCRIPT_URL ไม่ตั้งค่า'));
  var abForRender = arrayBuffer.slice(0);
  return pdfjsLib.getDocument({ data: abForRender, disableFontFace: true, useSystemFonts: false }).promise
    .then(function(pdf){
      console.log('[OCR] Rendering', pdf.numPages, 'pages of', filename);
      var pages = [];
      var chain = Promise.resolve();
      for (var p = 1; p <= pdf.numPages; p++) {
        (function(pageNum){
          chain = chain.then(function(){
            return pdf.getPage(pageNum).then(function(page){
              var viewport = page.getViewport({ scale: 2.0 });
              var canvas = document.createElement('canvas');
              canvas.width = viewport.width; canvas.height = viewport.height;
              var ctx = canvas.getContext('2d');
              return page.render({ canvasContext: ctx, viewport: viewport }).promise
                .then(function(){
                  return new Promise(function(resolve){
                    canvas.toBlob(function(blob){
                      var fr = new FileReader();
                      fr.onload = function(){
                        pages.push({ pageNum: pageNum, b64: String(fr.result).split(',')[1] });
                        resolve();
                      };
                      fr.readAsDataURL(blob);
                    }, 'image/png');
                  });
                });
            });
          });
        })(p);
      }
      return chain.then(function(){ return pages; });
    })
    .then(function(pages){
      // Send pages in parallel (max 4 concurrent) — สกัด cert "รายหน้า" + ติดเลขหน้า (ตัดแยกรายคน)
      var allCerts = [];
      var idx = 0;
      var active = 0;
      var MAX_PARALLEL = 4;
      return new Promise(function(resolve){
        function pumpNext() {
          while (active < MAX_PARALLEL && idx < pages.length) {
            var page = pages[idx++];
            active++;
            fetch(SCRIPT_URL, {
              method: 'POST', mode: 'cors',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({
                type: 'ocr-image',
                filename: filename + '_p' + page.pageNum + '.png',
                imageBase64: page.b64,
                mimeType: 'image/png'
              })
            })
            .then(function(r){ return r.json(); })
            .then(function(res){
              if (res && res.ok) {
                var pageCerts = extractFromPDFText(res.text || '');
                pageCerts.forEach(function(c){ c._page = page.pageNum; });   // ติดเลขหน้า
                allCerts = allCerts.concat(pageCerts);
                console.log('[OCR] ✓ page', page.pageNum, '→', (res.text||'').length, 'chars ·', pageCerts.length, 'ใบ');
              } else {
                console.warn('[OCR] ✗ page', page.pageNum, '— Apps Script returned:', res);
              }
            })
            .catch(function(err){ console.warn('[OCR] ✗ page', page.pageNum, '— fetch error:', err); })
            .then(function(){
              active--;
              if (idx >= pages.length && active === 0) resolve(allCerts);
              else pumpNext();
            });
          }
        }
        if (pages.length === 0) resolve([]);
        else pumpNext();
      });
    })
    .then(function(certs){
      console.log('[OCR]', filename, 'total certs:', certs.length);
      return certs;
    });
}

// Backwards-compat single-file (kept for safety)
function processPDFFile(file) { processPDFFiles([file]); }

/* ซ่อมข้อความไทยที่ pdf.js อ่านเพี้ยนเพราะฟอนต์ใบรับรองมี ToUnicode map ผิด
   เคสจริง (ใบ BISMAN): ไม้เอก "่" (U+0E48) ถูก map เป็น comma → "ชื,นบาน" ทำให้ regex ตัดชื่อเหลือ "ชื"
   ฟอนต์เดียวกันใช้ glyph คนละตัวเมื่อวรรณยุกต์อยู่คนละระดับ จึงเพี้ยนเป็นตัวอื่นได้อีก
   (เคสจริง: "ลิ่มสกุล" ขาดเหลือ "ลิ" — ตัวหลัง "ลิ" ไม่ใช่ comma)
   → ซ่อม 2 ชั้น:
     A. comma ที่ตามหลังสระบน (ั ิ ี ึ ื) — กฎเดิม ยอมให้มีช่องว่างคั่นได้
     B. อักขระอะไรก็ตามที่ "ไม่ใช่อักษรไทยและไม่ใช่ช่องว่าง" ติดอยู่ระหว่างสระบนกับอักษรไทยตัวถัดไป
        ตำแหน่งนี้เป็นที่ของวรรณยุกต์พอดี จึงแทนด้วยไม้เอก (ตัวที่พบบ่อยสุด) แล้ว log ไว้
   กฎ B บังคับว่า "ห้ามมีช่องว่างคั่น" — กัน false positive อย่าง "3 ปี : หมดอายุ" บนใบจริง */
var _FH_TONE_FIX_LOG = {};
function _fhRepairThaiPdfText(t) {
  if (!t) return t;
  t = t.replace(/([ัิ-ื])[ \t]*,/g, '$1่');
  t = t.replace(/([ัิ-ื])([^฀-๿\s])(?=[฀-๿])/g, function(m, v, bad){
    var cp = 'U+' + ('000' + bad.charCodeAt(0).toString(16).toUpperCase()).slice(-4);
    if (!_FH_TONE_FIX_LOG[cp]) {
      _FH_TONE_FIX_LOG[cp] = 0;
      console.warn('[PDF-THAI] ฟอนต์ map เพี้ยน: ' + cp + ' (' + JSON.stringify(bad) + ') หลังสระ "' + v + '" → ซ่อมเป็นไม้เอก "่" · ถ้าชื่อยังผิดให้ส่งบรรทัดนี้มาเพื่อทำตารางแปลงให้ตรงตัว');
    }
    _FH_TONE_FIX_LOG[cp]++;
    return v + '่';
  });
  return t;
}

function extractFromPDFText(text) {
  var results = [];
  if (!text || text.length < 20) return results;
  text = _fhRepairThaiPdfText(text);   // ซ่อมวรรณยุกต์ที่ฟอนต์ map เพี้ยน ก่อนแยกชื่อ/วันที่

  // Detect course type (default = generic)
  var course = 'การสุขาภิบาลอาหาร';
  if (/ผู้ประกอบ/.test(text)) {
    course = 'การสุขาภิบาลอาหาร สำหรับผู้ประกอบกิจการอาหาร';
  } else if (/ผู้สัมผัส/.test(text)) {
    course = 'การสุขาภิบาลอาหาร สำหรับผู้สัมผัสอาหาร';
  }

  // แปลงเลขไทย ๐-๙ → 0-9 ก่อนจับวันที่ (บางใบพิมพ์วันที่เป็นเลขไทย \d เลยจับไม่ติด → วันหมดอายุหาย)
  var dtext = text.replace(/[๐-๙]/g, function(c){ return String(c.charCodeAt(0) - 0x0E50); });

  // Date patterns — lenient
  var months = '(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)';
  // เดือนแบบย่อ (มี/ไม่มีจุด) → map เป็นชื่อเต็ม เพื่อให้ parseAnyDate/formatThaiDate อ่านได้ตรง · key = ตัดจุดแล้ว
  var monShort = {'มค':'มกราคม','กพ':'กุมภาพันธ์','มีค':'มีนาคม','เมย':'เมษายน','พค':'พฤษภาคม','มิย':'มิถุนายน','กค':'กรกฎาคม','สค':'สิงหาคม','กย':'กันยายน','ตค':'ตุลาคม','พย':'พฤศจิกายน','ธค':'ธันวาคม'};
  // อนุญาต "พ.ศ." / "พศ" คั่นระหว่างเดือนกับปี (ใบจริงเขียน "10 มิถุนายน พ.ศ. 2569" ทำให้ regex เดิมจับไม่ติด → วันหมดอายุหาย)
  var _be = '(?:พ\\.?\\s*ศ\\.?\\s*)?';
  var anyDateRe = new RegExp('(\\d{1,2})\\s*' + months + '\\s*' + _be + '(\\d{4})', 'g');
  var shortDateRe = /(\d{1,2})\s*(ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?)\s*(?:พ\.?\s*ศ\.?\s*)?(\d{4})/g;
  var numDateRe = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/g;   // 04/07/2569
  // Expire keyword followed by date within ~50 chars
  var expRe = new RegExp('(หมดอายุ|สิ้นสุด|ถึง(?:วันที่)?|สิ้นอายุ|expire)[^]{0,50}?(\\d{1,2})\\s*' + months + '\\s*' + _be + '(\\d{4})', 'i');

  var trainDate = '', expDate = '';
  // เก็บทุกวันที่ในเอกสาร → วันหมดอายุ = ปีมากสุด · วันอบรม = ปีน้อยสุด
  // (ทนทานกว่าจับ keyword เพราะบางใบ OCR สลับ/ปน — เช่น ให้ไว้ 2569 หมดอายุ 2572)
  var _allD = [], dm;
  anyDateRe.lastIndex = 0;
  while ((dm = anyDateRe.exec(dtext)) !== null) {
    _allD.push({ str: dm[1] + ' ' + dm[2] + ' ' + dm[3], y: parseInt(dm[3], 10) || 0 });
  }
  // เดือนย่อ → normalize เป็นชื่อเต็ม
  shortDateRe.lastIndex = 0;
  while ((dm = shortDateRe.exec(dtext)) !== null) {
    var _sm = monShort[dm[2].replace(/\./g,'')];
    if (_sm) _allD.push({ str: dm[1] + ' ' + _sm + ' ' + dm[3], y: parseInt(dm[3],10) || 0 });
  }
  // วันที่แบบตัวเลขล้วน dd/mm/yyyy (yyyy เป็น พ.ศ. เท่านั้น กันปนเลขอื่น)
  numDateRe.lastIndex = 0;
  while ((dm = numDateRe.exec(dtext)) !== null) {
    var _ny = parseInt(dm[3],10) || 0;
    if (_ny >= 2500 && _ny <= 2700) _allD.push({ str: dm[1] + '/' + dm[2] + '/' + dm[3], y: _ny });
  }
  if (_allD.length) {
    var _mx = _allD[0], _mn = _allD[0];
    _allD.forEach(function(x){ if (x.y > _mx.y) _mx = x; if (x.y < _mn.y) _mn = x; });
    expDate = _mx.str;
    trainDate = (_mn.str !== _mx.str) ? _mn.str : '';
  }
  // เผื่อ keyword "หมดอายุ" ชัดเจน + ปีตรงกับ max (กันเลือกผิดกรณีมีหลายวันปีเดียวกัน)
  var em = dtext.match(expRe);
  if (em) { var _ek = em[2] + ' ' + em[3] + ' ' + em[4]; if (parseInt(em[4],10) >= (_allD.length ? Math.max.apply(null,_allD.map(function(x){return x.y;})) : 0)) expDate = _ek; }

  // Name patterns — try multiple in order, stop when one finds something
  var certNames = [];
  var nameRegexes = [
    // title + first + คำไทยที่เหลือในบรรทัดเดียวกัน — จับหลายคำแล้วค่อยตัดคำเอกสารทีหลัง
    // (กันนามสกุลที่ OCR เว้นวรรคผิด เช่น "เขี ยว" · และกันคำหลักสูตรที่ติดนามสกุล)
    /* บาง PDF แยก "นางสาว" ออกเป็นสองคำ ต้องยอมให้มีช่องว่างคั่น และต้องเทียบก่อน "นาง"
       ไม่งั้นจะตัดได้แค่ "นาง" แล้วเหลือ "สาว" มาเป็นชื่อคน */
    /(นาย|นาง\s*สาว|นาง)\s*([฀-๿]{2,})((?:[ \t]+[฀-๿]+)+)/g
  ];
  for (var ri = 0; ri < nameRegexes.length && certNames.length === 0; ri++) {
    var re = nameRegexes[ri];
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      var fullname = (m[1] + ' ' + m[2].trim() + ' ' + m[3].trim()).replace(/\s+/g, ' ').trim();
      fullname = _cleanCertName(fullname);   // ตัดคำหลักสูตร/เอกสารที่ OCR กวาดมาต่อท้ายนามสกุล
      fullname = fullname.replace(/\s+([ัิ-ฺ็-๎])/g, '$1');   // รวมช่องว่างหน้าอักขระประสม เช่น "ทองสพรั ่ง"→"ทองสพรั่ง"
      if (fullname.length > 5 && fullname.length < 80 && fullname.split(' ').length >= 3) certNames.push(fullname);
      if (certNames.length > 200) break;
    }
  }
  var _badName = /บริษัท|จำกัด|กรุ๊ป|กรุป|หลักสูตร|สุขาภิบาล|กระทรวง|ขอรับรอง|รับรอง|อบรม|central|group|limited|company|restaurant/i;
  function _pushCertName(nm){
    nm = String(nm||'').replace(/\s+/g, ' ').trim();
    if (_badName.test(nm)) return;
    if (nm.length >= 60) return;
    /* เดิมบังคับว่าต้องมีอย่างน้อยสองคำ = ต้องมีนามสกุล
       พนักงานที่ไม่มีนามสกุล (ชาวเขา/แรงงานต่างด้าว) ชื่อบนใบเป็นคำเดียว
       ใบพวกนั้นถูกทิ้งตั้งแต่ตอนอ่านไฟล์ อัปกี่รอบก็ไม่เข้าระบบ
       ยอมรับคำเดียวได้ แต่ต้องยาวพอ และผ่านตัวกรองคำที่ไม่ใช่ชื่อคนมาแล้ว */
    var words = nm.split(' ').length;
    if (words >= 2) { if (nm.length >= 4) certNames.push(nm); return; }
    if (nm.length >= 3) certNames.push(nm);
  }
  // Fallback A (ผสอ CRG): ชื่ออยู่บรรทัดก่อน "ผ่านการอบรม" (ไม่มีคำนำหน้า)
  if (certNames.length === 0) {
    /* {0,2} = ยอมให้ชื่อเป็นคำเดียวได้ (พนักงานที่ไม่มีนามสกุล)
       เดิมเป็น {1,2} คือบังคับว่าต้องมีอย่างน้อยสองคำ ใบของคนไม่มีนามสกุลจึงหลุดหมด */
    var beforeTrainRe = /([฀-๿]+(?:[ \t]+[฀-๿]+){0,2})[ \t]*[\r\n]+[ \t]*ผ่านการอบรม/g;
    var bm; while ((bm = beforeTrainRe.exec(text)) !== null) { _pushCertName(bm[1]); if (certNames.length > 300) break; }
  }
  // Fallback B (ผปก CRG): ชื่ออยู่ต้น ก่อน "บริษัท เซ็นทรัล / CENTRAL RESTAURANTS" (ไม่มีคำนำหน้า)
  if (certNames.length === 0) {
    var beforeCoRe = /([฀-๿]{2,}(?:[ \t]+[฀-๿]{2,}){0,2})[ \t\r\n]*(?:บริษัท[ \t]*เซ็นทรัล|central\s*restaurant)/gi;
    var cm; while ((cm = beforeCoRe.exec(text)) !== null) { _pushCertName(cm[1]); if (certNames.length > 300) break; }
  }
  var seen = {};
  certNames = certNames.filter(function(n) {
    var k = n.replace(/\s/g, '');
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });

  // Always log when no names found, to help diagnose tricky PDFs
  if (certNames.length === 0) {
    console.log('[PDF DEBUG] No names found. Course:', course, '| trainDate:', trainDate, '| expDate:', expDate);
    console.log('[PDF DEBUG] Text length:', text.length, '| First 800 chars:', text.slice(0, 800));
  }

  certNames.forEach(function(name) {
    results.push({ name: name, course: course, trainDate: trainDate, expireDate: expDate });
  });
  return results;
}

function getDemoPDFData() {
  var names = ["นายจิระศักดิ์ วรรณกูล","นายธนพนธ์ ศิลาวรรณ","นางสาวเพ็ญพักตร์ พร้อมสันเทียะ","นางสาวชลริชา เพชรดี","นายวรากร ปรางจันทร์","นางสาวนฤมล โสมสิริรักษ์","นายกิตติธัช กัลปากรณ์ชัย","นายทวีศักดิ์ เครือสังข์","นางสาวอภิรติ รักอนุสรณ์","นางสาวมณี จันทร์คีรีรุ่ง","นางสาวสุภานัน กันเพ็ชร","นายกิตติธร อักโขพันธ์","นางสาวลลิตา ฮ้อวงศ์กร","นางสาวรัชดากรณ์ พันนาโนน","นางสาวอาทิตยา มูลกระโทก","นายเอกชัย แซ่มช้อย","นางสาวสุภาพร มะหะมาน","นายสุริยา ทองรอด","นายนนทพัทธ์ แว่นสุวรรณ์","นางสาวสายรุ่ง อาญาเมือง","นายภัทรพล ไยแก้ว","นางสาวปุยฝ้าย กุลจันทร์","นางสาวปารินันท์ วรวรรณ์","นางสาวสุวรรณา ศรีวิเศษ","นางสาววราลักษณ์ ปานเทศ","นางสาววิชุตา ธนูชิต","นายธนดล ปั่นศรี","นางสาวธัญญา การะเกษ","นายปรเมศ ปรีวิลัย","นายชวกร ปิ่นเกต","นางสาวหยกฟ้า แซ่ม้า","นางสาวณฤดี เอี่ยมเจริญ","นางสาวศิริพร ซีมดอน","นายศรัณย์ หาญกล้า","นายธนทัต แซ่สง","นางสาวมัทรีย์ เข็มทอง","นางสาวจิตติมา สวงโท","นางสาวปภาวี บุญถนอม","นางสาวอำพร เพ็งมูล","นายอิธิพล ปัญญาวุฒิ","นายชนกชนม์ ปานทอง","นางสาวพิมพ์วิภา สีทอง","นางสาวเพื่องลดา มนต์ชาตรี","นางสาวจิราวรรณ ชมภู","นางสาวชนนิกานต์ สอนน้อย","นางสาวอรปรียา สีมาเลาเต่า","นางสาวเมรินฎา มิ่งมิตร","นางสาวชญานิน สิริกานดา","นางสาวสุพิชญา สิงหพ์","นางสาวอธิพันธ์ อินทร์จับ","นางสาวอาภัสรา พรมศรี","นางสาวสุวิมล สมพงษ์","นายนิรภัทร สอนน้อย","นางสาวพรพรรณ สุวรรณประทีป","นางสาวศิริรัตน์ มีวิทย์ดี","นายวินัย จันทจร","นายประดิษฐ์ ผุดพ่อง","นางสาวสุภาวดี ดีรัศมี","นางสาวศสิมา สีสมุทร","นายจักรภัทร สุทธหลวง","นางสาวชนากานต์ จวงตะคู","นางสาวเบญจพร คำเพชร"];
  return names.map(function(n){return{name:n,course:'การสุขาภิบาลอาหาร สำหรับผู้สัมผัสอาหาร',trainDate:'5 กรกฎาคม 2566',expireDate:'4 กรกฎาคม 2569'};});
}

/* ─────────── XLSX HANDLER ─────────── */
function handleXLSX(input) {
  if (input.files[0]) processXLSXFile(input.files[0]);
}

/* แยก parser ทะเบียนพนักงานออกมา — ใช้ทั้งไฟล์เดียว/หลายไฟล์ */
var _fhSkipSheets = [];     // Sheet ที่อ่านหัวตารางไม่ออก — เอาไว้บอกผู้ใช้ว่าข้ามอะไรไป
function _parseEmpWorkbook(wb) {
  var employees = [];
  _fhSkipSheets = [];
  wb.SheetNames.forEach(function(sheetName) {
    var ws = wb.Sheets[sheetName];
    var rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    if (rows.length < 2) return;
    var header = rows[0];
    var nameCol = -1, branchCol = -1, posCol = -1, empIdCol = -1, idCardCol = -1, brandCol = -1;
    header.forEach(function(h,i){
      var s = String(h).toLowerCase();
      if (s.indexOf('fullname') >= 0 || (s.indexOf('ชื่อ') >= 0 && s.indexOf('เล่น') < 0 && s.indexOf('nick') < 0)) nameCol = i;
      if (s.indexOf('orgunit') >= 0 || s.indexOf('สาขา') >= 0 || s.indexOf('หน่วย') >= 0) branchCol = i;
      if ((s.indexOf('position') >= 0 && s.indexOf('eng') < 0) || s.indexOf('ตำแหน่ง') >= 0) posCol = i;
      if (s.indexOf('empcode') >= 0 || s.indexOf('empid') >= 0 || s.indexOf('รหัสพนักงาน') >= 0 || s.indexOf('รหัสพนง') >= 0) empIdCol = i;
      if (s.indexOf('identity') >= 0 || s.indexOf('idcard') >= 0 || s.indexOf('เลขบัตร') >= 0 || s.indexOf('บัตรประชาชน') >= 0) idCardCol = i;
      if (s.indexOf('แบรนด์') >= 0 || s.indexOf('แบนด์') >= 0 || s.indexOf('brand') >= 0 || s === 'sheet') brandCol = i;
    });
    /* ต้นเหตุของทะเบียนที่พังทั้งชุด: เดิมถ้าหาหัวคอลัมน์ไม่เจอ จะเดาว่าอยู่ตำแหน่งที่ 2/9/7/1
       ไฟล์ที่ไม่ใช่ทะเบียน (เช่นไฟล์ใบรับรอง) จึงถูกอ่านเป็นทะเบียนได้เสมอ
       ได้ชื่อคนเป็นชื่อหลักสูตร รหัสพนักงานเป็นคำว่า "ผ่าน" แล้วเขียนทับของจริงทิ้ง
       ชื่อคือคอลัมน์ที่ทั้งระบบพึ่งพา หาไม่เจอ = ไม่ใช่ทะเบียน ข้ามทั้ง Sheet ดีกว่าเดา */
    if (nameCol < 0) { _fhSkipSheets.push(sheetName); return; }
    if (branchCol<0) branchCol = 9;
    if (posCol<0) posCol = 7;
    if (empIdCol<0) empIdCol = 1;
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var name = String(row[nameCol]||'').trim();
      if (!name || name==='-' || name.length < 2) continue;
      /* ทะเบียนบางไฟล์ใส่คำนำหน้ามาด้วย บางไฟล์ไม่ใส่ · ตัดให้เหมือนกันหมดตั้งแต่ต้นทาง
         ไม่งั้นคนเดียวกันจากสองไฟล์จะกลายเป็นสองแถว และเทียบกับใบรับรองก็ไม่ตรง */
      name = fhStripTitle(name) || name;
      employees.push({
        name: name,
        norm: normalizeName(name),
        empId: String(row[empIdCol]||'').trim(),
        idCard: idCardCol >= 0 ? String(row[idCardCol]||'').trim() : '',
        branch: String(row[branchCol]||'').trim(),
        position: String(row[posCol]||'').trim(),
        sheet: (brandCol >= 0 && String(row[brandCol]||'').trim()) ? String(row[brandCol]).trim() : sheetName
      });
    }
  });
  return employees;
}

/* นำเข้าทะเบียนพนักงานหลายไฟล์ — อ่านทุกไฟล์ → รวม → ตัดซ้ำ → บันทึกทีเดียว (replace-all) */
function processXLSXFiles(files) {
  files = Array.prototype.slice.call(files || []);
  if (!files.length) return;
  if (files.length === 1) { processXLSXFile(files[0]); return; }
  setStatus('xlsx','loading','กำลังอ่าน ' + files.length + ' ไฟล์ Excel...');
  showProg('xlsx'); setProg('xlsx',15);
  var all = [];
  var chain = Promise.resolve();
  files.forEach(function(file, idx){
    chain = chain.then(function(){
      return new Promise(function(resolve){
        var reader = new FileReader();
        reader.onload = function(e){
          try {
            var wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
            all = all.concat(_parseEmpWorkbook(wb));
          } catch(err) { console.warn('parse fail', file.name, err); }
          setProg('xlsx', 15 + Math.round((idx+1)/files.length*60));
          resolve();
        };
        reader.onerror = function(){ resolve(); };
        reader.readAsArrayBuffer(file);
      });
    });
  });
  chain.then(function(){
    // ตัดซ้ำจาก ชื่อ(normalized) + เลขบัตร/รหัสพนักงาน
    var seen = {}, merged = [];
    all.forEach(function(emp){
      var key = (emp.norm||'') + '|' + (emp.idCard || emp.empId || '');
      if (seen[key]) return;
      seen[key] = true; merged.push(emp);
    });
    if (!merged.length) { setStatus('xlsx','error','ไม่พบข้อมูลในไฟล์'); return; }
    setProg('xlsx',100);
    var dupCut = all.length - merged.length;
    var card = document.getElementById('xlsxCard'); if (card) card.classList.add('loaded');
    /* ไม่ทับทะเบียนเดิมทันทีอีกแล้ว — ผ่านด่านตรวจไฟล์ + รวมกับของเดิม + ให้ยืนยันก่อน */
    fhApplyRegistryUpload(merged, files.length + ' ไฟล์' + (dupCut>0 ? (' · ตัดซ้ำ '+dupCut) : ''),
      function(kind, msg){ setStatus('xlsx', kind, msg); });
  });
}

function processXLSXFile(file) {
  setStatus('xlsx','loading','กำลังอ่านไฟล์ Excel...');
  showProg('xlsx');
  setProg('xlsx',20);

  var reader = new FileReader();
  reader.onload = function(e) {
    setProg('xlsx',50);
    try {
      var data = new Uint8Array(e.target.result);
      var wb = XLSX.read(data, {type:'array'});
      setProg('xlsx',75);

      var employees = _parseEmpWorkbook(wb);

      if (employees.length > 0) {
        setProg('xlsx',100);
        document.getElementById('xlsxCard').classList.add('loaded');
        /* ไม่ทับทะเบียนเดิมทันทีอีกแล้ว — ผ่านด่านตรวจไฟล์ + รวมกับของเดิม + ให้ยืนยันก่อน */
        fhApplyRegistryUpload(employees, wb.SheetNames.length + ' Sheet',
          function(kind, msg){ setStatus('xlsx', kind, msg); });
      } else {
        setStatus('xlsx','error','ไม่พบข้อมูลในไฟล์');
      }
    } catch(err) {
      setStatus('xlsx','error','ไม่สามารถอ่านไฟล์: ' + err.message);
    }
    checkReady();
  };
  reader.readAsArrayBuffer(file);
}
