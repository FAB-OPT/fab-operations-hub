
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
    /(นาย|นางสาว|นาง)\s*([฀-๿]{2,})((?:[ \t]+[฀-๿]+)+)/g
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
    if (nm.length >= 4 && nm.length < 60 && nm.split(' ').length >= 2) certNames.push(nm);
  }
  // Fallback A (ผสอ CRG): ชื่ออยู่บรรทัดก่อน "ผ่านการอบรม" (ไม่มีคำนำหน้า)
  if (certNames.length === 0) {
    var beforeTrainRe = /([฀-๿]+(?:[ \t]+[฀-๿]+){1,2})[ \t]*[\r\n]+[ \t]*ผ่านการอบรม/g;
    var bm; while ((bm = beforeTrainRe.exec(text)) !== null) { _pushCertName(bm[1]); if (certNames.length > 300) break; }
  }
  // Fallback B (ผปก CRG): ชื่ออยู่ต้น ก่อน "บริษัท เซ็นทรัล / CENTRAL RESTAURANTS" (ไม่มีคำนำหน้า)
  if (certNames.length === 0) {
    var beforeCoRe = /([฀-๿]{2,}(?:[ \t]+[฀-๿]{2,}){1,2})[ \t\r\n]*(?:บริษัท[ \t]*เซ็นทรัล|central\s*restaurant)/gi;
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
function _parseEmpWorkbook(wb) {
  var employees = [];
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
    if (nameCol<0) nameCol = 2;
    if (branchCol<0) branchCol = 9;
    if (posCol<0) posCol = 7;
    if (empIdCol<0) empIdCol = 1;
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var name = String(row[nameCol]||'').trim();
      if (!name || name==='-' || name.length < 2) continue;
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
    empData = merged;
    setProg('xlsx',100);
    var dupCut = all.length - merged.length;
    setStatus('xlsx','done','โหลดสำเร็จ — พบ ' + merged.length + ' คน จาก ' + files.length + ' ไฟล์' + (dupCut>0 ? (' (ตัดซ้ำ '+dupCut+')') : '') + ' · กำลังบันทึกลง Cloud...');
    var card = document.getElementById('xlsxCard'); if (card) card.classList.add('loaded');
    saveEmployeeRegistryToCloud(merged, true)
      .then(function(){ setStatus('xlsx','done','✓ บันทึกทะเบียน ' + merged.length + ' คนลง Cloud แล้ว (ครั้งต่อไปไม่ต้อง upload ซ้ำ)'); })
      .catch(function(err){ setStatus('xlsx','done','พบ ' + merged.length + ' คน · ⚠ บันทึก Cloud ไม่สำเร็จ: ' + (err.message||err)); });
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
        empData = employees;
        setProg('xlsx',100);
        setStatus('xlsx','done','โหลดสำเร็จ — พบ ' + employees.length + ' คน จาก ' + wb.SheetNames.length + ' Sheet · กำลังบันทึกลง Cloud...');
        document.getElementById('xlsxCard').classList.add('loaded');
        // Persist to cloud (replace all)
        saveEmployeeRegistryToCloud(employees, true)
          .then(function(res){
            setStatus('xlsx','done','✓ บันทึกทะเบียน ' + employees.length + ' คนลง Cloud แล้ว (ครั้งต่อไปไม่ต้อง upload ซ้ำ)');
          })
          .catch(function(err){
            console.warn('Save employees to cloud failed:', err);
            setStatus('xlsx','done','พบ ' + employees.length + ' คน · ⚠ บันทึก Cloud ไม่สำเร็จ: ' + (err.message||err));
          });
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

/* ─────────── MATCHING ENGINE ─────────── */
function normalizeName(n) {
  return String(n || '')
    // "ำ" (สระอำ e33) ที่ OCR แยกเป็น นฤคหิต(ํ e4d)+สระอา(า e32) — รองรับวรรณยุกต์คั่นกลางด้วย
    // เช่น "อ ํ ่ า" (ช้างอํ่า) → "อ ่ ำ" (ช้างอ่ำ) · เก็บวรรณยุกต์ไว้ ย้าย ำ ไปท้าย
    .replace(/ํ([่-๋]*)า/g, '$1ำ')   // ํ (+วรรณยุกต์) + า → (วรรณยุกต์)ำ
    .replace(/า([่-๋]*)ํ/g, '$1ำ')   // เผื่อสลับลำดับ า ... ํ
    // รวมช่องว่างที่ OCR แทรกหน้าอักขระประสม (สระบน/ล่าง/วรรณยุกต์) กลับ เช่น "ทองสพรั ่ง"→"ทองสพรั่ง"
    .replace(/\s+([ัิ-ฺ็-๎])/g, '$1')
    .replace(/\s+/g, ' ').trim();
}
/* ตัดข้อความเอกสาร/หลักสูตร ที่ OCR กวาดมาต่อท้ายนามสกุล (ไม่มีช่องว่างคั่น)
   เช่น "สมพงษ์ จันดำการสุขาภิบาลอาหาร" → "สมพงษ์ จันดำ" */
function _cleanCertName(nm){
  nm = String(nm||'').replace(/\s+/g,' ').trim();
  nm = nm.replace(/(การสุขาภิบาล|ผ่านการอบรม|ผ่านการฝึกอบรม|หลักสูตร|ตามกฎกระทรวง|สำหรับผู้|ผู้สัมผัสอาหาร|ผู้ประกอบกิจการ|ขอรับรองว่า|ได้ผ่าน|เลขที่|บริษัท|จำกัด|กรุ๊ป).*$/, '').trim();
  return nm;
}
/* คีย์รวมสาขาที่จริงคืออันเดียวกันแต่สะกดต่าง (ต่างแค่ช่องว่าง / ส↔ซ / วรรณยุกต์) */
function _branchKey(s){
  return String(s||'')
    .replace(/[\s\-–—_.,'"()\[\]/]+/g,'')   // ตัดช่องว่าง/ขีด/จุด/วงเล็บ → "S Oasis" = "S-Oasis"
    .replace(/ซ/g,'ส')                      // ซ↔ส สะกดสลับกันบ่อย
    .replace(/[็-๎]/g,'')                   // ตัดวรรณยุกต์/ไม้ไต่คู้
    .toLowerCase();
}
/* สาขาเดียวกันแต่สะกดคนละแบบจน normalize อัตโนมัติไม่ได้ (อังกฤษ/ไทย, คำหาย)
   → บังคับใช้ "ชื่อมาตรฐาน" ตามทะเบียน BRANCHES  ·  ยืนยันโดยผู้ใช้แล้ว
   เทียบด้วย "ชื่อเต็มรวมแบรนด์" เท่านั้น — กันไปชนสาขาแบรนด์อื่นที่ชื่อคล้ายกัน
   (เช่น 4007 "เจ๊แดง จุ่มนัวร์ ซีคอน ศรีนครินทร์" ต้องไม่ถูกรวมกับ 5002 ของ Santa Fe) */
var FH_BRANCH_ALIAS = [
  { from: 'Santa Fe Cosmo บาซาร์',       to: 'Santa Fe คอสโม บาร์ซา' },              // 5068
  { from: 'Santa Fe ซีคอนศรีนครินทร์',   to: 'Santa Fe ซีคอนสแควร์ ศรีนครินทร์' },   // 5002
  { from: 'Santa Fe พัทยากลาง',          to: 'Santa Fe บิ๊กซี พัทยากลาง' }           // 5014
];
var _FH_ALIAS_MAP = {};
try { FH_BRANCH_ALIAS.forEach(function(a){ _FH_ALIAS_MAP[_branchKey(a.from)] = a.to; }); } catch(e) {}

/* รวมชื่อสาขาที่สะกดต่างเล็กน้อยให้ใช้สะกดเดียว (เลือกสะกดที่พบบ่อยสุด) — กัน dropdown/ตัวกรองขึ้นซ้ำ
   เช่น "แฟชั่น ไอส์แลนด์" กับ "แฟชั่นไอซ์แลนด์" → ใช้อันเดียว */
function _canonicalizeBranches(list){
  if (!Array.isArray(list) || !list.length) return;
  // 1) alias ที่ยืนยันแล้ว — บังคับเป็นชื่อมาตรฐานก่อน (ไม่ปล่อยให้ "เสียงข้างมาก" ตัดสิน)
  list.forEach(function(d){
    if (!d || !d.branch || d.branch === '—') return;
    var t = _FH_ALIAS_MAP[_branchKey(d.branch)];
    if (t) d.branch = t;
  });
  // 2) ที่เหลือ รวมสะกดต่างเล็กน้อยด้วยเสียงข้างมาก
  var groups = {};   // key → { สะกด: จำนวน }
  list.forEach(function(d){
    var b = d && d.branch; if (!b || b === '—') return;
    var k = _branchKey(b);
    (groups[k] = groups[k] || {})[b] = (groups[k][b] || 0) + 1;
  });
  var canon = {};
  Object.keys(groups).forEach(function(k){
    var best = null, bestN = -1;
    Object.keys(groups[k]).forEach(function(sp){ if (groups[k][sp] > bestN) { bestN = groups[k][sp]; best = sp; } });
    canon[k] = best;
  });
  list.forEach(function(d){
    if (d && d.branch && d.branch !== '—') { var c = canon[_branchKey(d.branch)]; if (c) d.branch = c; }
  });
}

/* ชุดคำนำหน้า/ยศ ที่ต้องตัดทิ้งก่อนเทียบชื่อ (เก็บแบบตัดจุด/ช่องว่างออกแล้ว)
   เพราะทะเบียนมักมียศ (เช่น "ว่าที่ ร.ต. นันทฤทธิ์ ธรรมดา") แต่ใบรับรองมีแค่ "นันทฤทธิ์ ธรรมดา" */
var TH_TITLES = {
  'นาย':1,'นาง':1,'นางสาว':1,'นส':1,'น.ส':1,'น. ส':1,
  'ดช':1,'ดญ':1,'เด็กชาย':1,'เด็กหญิง':1,
  'ดร':1,'นพ':1,'พญ':1,'ทพ':1,'ทพญ':1,
  'ว่าที่':1,'วาที่':1,
  'ร้อยตรี':1,'ร้อยโท':1,'ร้อยเอก':1,'พันตรี':1,'พันโท':1,'พันเอก':1,
  'พลตรี':1,'พลโท':1,'พลเอก':1,'จ่าสิบเอก':1,'จ่าสิบโท':1,'จ่าสิบตรี':1,'สิบเอก':1,'สิบโท':1,'สิบตรี':1,
  'รต':1,'รท':1,'รอ':1,'พต':1,'พท':1,'พอ':1,'พลต':1,'พลท':1,'พลอ':1,
  'จสอ':1,'จสท':1,'จสต':1,'พตท':1,'พตอ':1,'พตต':1,
  'ร้อยตำรวจเอก':1,'ร้อยตำรวจโท':1,'ร้อยตำรวจตรี':1,'พันตำรวจเอก':1,'พันตำรวจโท':1,'พันตำรวจตรี':1
};
/* ตัดคำนำหน้า/ยศ นำหน้าออก (รองรับ "ว่าที่ ร.ต." หลายชั้น) → คืน tokens ของชื่อจริง */
function _stripTitleTokens(n) {
  var parts = n.split(/\s+/).filter(Boolean);
  while (parts.length > 1) {
    var key = parts[0].replace(/[.\s]/g, '');   // ตัดจุด/ช่องว่างในโทเคนก่อนเทียบ (ร.ต. → รต)
    if (TH_TITLES[key] || TH_TITLES[parts[0]]) parts.shift();
    else break;
  }
  return parts;
}
function getParts(name) {
  var n = normalizeName(name);
  // Normalize: ensure space after title (handle "นายอธิศ" → "นาย อธิศ")
  n = n.replace(/^(นางสาว|นาย|นาง)/, '$1 ').replace(/\s+/g, ' ').trim();
  var stripped = _stripTitleTokens(n);
  var prefix = n.slice(0, n.length - stripped.join(' ').length).trim();
  var parts = stripped.length ? stripped : n.split(/\s+/);
  // ชื่อเต็ม: รวมทุกคำ (ตัดช่องว่าง+วรรณยุกต์) — กันนามสกุลที่ OCR แยกคำ/เว้นวรรคต่าง
  var full = _thStrip(parts.join('')).replace(/\s/g,'');
  return { prefix:prefix, first:parts[0]||'', last:parts[parts.length-1]||'', full:full };
}
/* ตัดวรรณยุกต์/การันต์ (่ ้ ๊ ๋ ์ ็) ที่ OCR มักอ่านเพี้ยน/หาย — ใช้เทียบชื่อแบบยืดหยุ่น */
function _thStrip(s){ return String(s||'').replace(/[็-๎]/g, ''); }
/* ชื่อ cert ตรงกับชื่อในทะเบียนไหม (เทียบ first+last · exact หรือ ตัดวรรณยุกต์แล้วตรง) */
function _certEmpMatch(certParts, empNorm){
  var ep = getParts(empNorm);
  if (certParts.first && certParts.last) {
    if (certParts.first === ep.first && certParts.last === ep.last) return true;
    if (_thStrip(certParts.first) === _thStrip(ep.first) && _thStrip(certParts.last) === _thStrip(ep.last)) return true;
  }
  // เทียบชื่อเต็มแบบตัดช่องว่าง+วรรณยุกต์ (กันนามสกุล OCR แยกคำ/เว้นวรรค เช่น "เฉลิมขวัญ เขี ยว"↔"เฉลิมขวัญ เขียว")
  if (certParts.full && ep.full && certParts.full.length >= 6 && certParts.full === ep.full) return true;
  return false;
}

/* Parse a date string (Thai full, ISO, or DD/MM/YYYY) → Date object (Gregorian), or null */
function parseAnyDate(s) {
  if (!s) return null;
  if (s instanceof Date) {
    if (isNaN(s)) return null;
    // Normalize: if year is Buddhist, shift down to Gregorian — preserve time
    var yr = s.getFullYear();
    while (yr > 2400) yr -= 543;
    return new Date(yr, s.getMonth(), s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds());
  }
  s = String(s).trim();
  if (!s || s === '—') return null;
  // ISO: "2570-07-21T17:00:00.000Z" or "2026-07-21" or "2026-05-25 14:32:15"
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/);
  if (iso) {
    var y = parseInt(iso[1]);
    /* มี timezone (Z / +07:00) → Sheets เก็บวันที่ไทยแล้วส่งกลับเป็น UTC (เลื่อน -7 ชม.)
       ถ้าอ่านเลขวันจากสตริง UTC ตรงๆ จะเพี้ยนไป 1 วัน (6 พ.ย. ไทย = 5 พ.ย. 17:00Z)
       จึงต้องแปลงเป็น instant จริงแล้วอ่านวันที่ "ตามเวลาไทย" (UTC+7) แบบตายตัว
       — ไม่พึ่ง timezone ของเครื่องผู้ใช้ เพื่อให้ทุกเครื่องเห็นวันเดียวกัน */
    if (iso[7]) {
      var gy = y > 2500 ? y - 543 : y;
      var inst = new Date(s.replace(/^\d{4}/, String(gy)));
      if (!isNaN(inst)) {
        var bkk = new Date(inst.getTime() + 7 * 3600000);   // เลื่อนเป็นเวลาไทย แล้วอ่านส่วน UTC
        return new Date(
          bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(),
          bkk.getUTCHours(), bkk.getUTCMinutes(), bkk.getUTCSeconds()
        );
      }
    }
    if (y > 2500) y -= 543;
    return new Date(
      y, parseInt(iso[2]) - 1, parseInt(iso[3]),
      iso[4] ? parseInt(iso[4]) : 0,
      iso[5] ? parseInt(iso[5]) : 0,
      iso[6] ? parseInt(iso[6]) : 0
    );
  }
  // DD/MM/YYYY [HH:mm[:ss]]
  var dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    var dy = parseInt(dmy[3]);
    if (dy > 2500) dy -= 543;
    else if (dy < 100) dy += 2000;
    return new Date(
      dy, parseInt(dmy[2]) - 1, parseInt(dmy[1]),
      dmy[4] ? parseInt(dmy[4]) : 0,
      dmy[5] ? parseInt(dmy[5]) : 0,
      dmy[6] ? parseInt(dmy[6]) : 0
    );
  }
  // Thai full: "4 กรกฎาคม 2569"
  var thMonths = {'มกราคม':0,'กุมภาพันธ์':1,'มีนาคม':2,'เมษายน':3,'พฤษภาคม':4,'มิถุนายน':5,'กรกฎาคม':6,'สิงหาคม':7,'กันยายน':8,'ตุลาคม':9,'พฤศจิกายน':10,'ธันวาคม':11};
  // Thai short (with or without trailing dots): "4 ก.ค. 2569" / "4 กค 2569"
  var thShort = {'ม.ค.':0,'ก.พ.':1,'มี.ค.':2,'เม.ย.':3,'พ.ค.':4,'มิ.ย.':5,'ก.ค.':6,'ส.ค.':7,'ก.ย.':8,'ต.ค.':9,'พ.ย.':10,'ธ.ค.':11,
                 'มค':0,'กพ':1,'มีค':2,'เมย':3,'พค':4,'มิย':5,'กค':6,'สค':7,'กย':8,'ตค':9,'พย':10,'ธค':11};
  var th = s.match(/(\d+)\s+(\S+)\s+(\d+)/);
  if (th) {
    var monIdx = thMonths[th[2]];
    if (monIdx == null) monIdx = thShort[th[2]];
    if (monIdx != null) {
      var ty = parseInt(th[3]);
      if (ty > 2500) ty -= 543;
      return new Date(ty, monIdx, parseInt(th[1]));
    }
  }
  return null;
}

/* Format any date input → Thai short form: "21 ก.ค. 2570" */
function formatThaiDate(s) {
  if (s == null || s === '' || s === '—') return '—';
  var d = parseAnyDate(s);
  if (!d) return s; // unchanged if unparseable
  var thShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  var y = d.getFullYear();
  // Normalize down to Gregorian no matter how many times it was double-converted
  while (y > 2400) y -= 543;
  y += 543; // → Buddhist
  return d.getDate() + ' ' + thShort[d.getMonth()] + ' ' + y;
}

/* Same as formatThaiDate but includes time HH:MM */
function formatThaiDateTime(s) {
  if (s == null || s === '' || s === '—') return '—';
  var d = parseAnyDate(s);
  if (!d) return s;
  var thShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  var y = d.getFullYear();
  while (y > 2400) y -= 543;
  y += 543;
  var pad = function(n){ return n < 10 ? '0'+n : ''+n; };
  return d.getDate() + ' ' + thShort[d.getMonth()] + ' ' + y + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function getExpStatus(expDateStr) {
  var d = parseAnyDate(expDateStr);
  if (!d) return 'unknown';
  // "ใกล้หมดอายุ" = expires within 1 year 6 months (~547 days)
  var diffDays = (d - today) / 86400000;
  if (diffDays < 0) return 'expired';
  if (diffDays <= 547) return 'warning';
  return 'valid';
}

/* ─── Stepper state machine ─── */
function setStepState(scopeEl, stateMap) {
  // stateMap = { 1:'done', 2:'active', 3:null }
  if (!scopeEl) return;
  Object.keys(stateMap).forEach(function(n){
    var el = scopeEl.querySelector('.step-' + n);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (stateMap[n]) el.classList.add(stateMap[n]);
  });
}
function updateStepper() {
  // ฝั่งสาขาใช้เมนูข้าง (sidebar) แทน stepper แล้ว — เหลือเฉพาะ adminView
  // Admin view (2 steps — match/save are automatic)
  var av = document.getElementById('adminView');
  if (av && av.style.display !== 'none') {
    var statsEl = document.getElementById('statsRow');
    var matched = statsEl && statsEl.style.display === 'grid';
    if (matched) setStepState(av, {1:'done', 2:'active'});
    else setStepState(av, {1:'active', 2:null});
  }
}

function processMatch() {
  if (!pdfData) return;

  document.getElementById('processBtn').innerHTML = '<span class="spin"></span> กำลังจับคู่...';
  document.getElementById('processBtn').disabled = true;

  setTimeout(function() {
    var raw = [];
    var employees = empData || [];

    try {
      console.log('[DIAG NAMES] cert ตัวอย่าง:', JSON.stringify(pdfData.slice(0,3).map(function(c){ return c.name; })));
      console.log('[DIAG NAMES] ทะเบียน ตัวอย่าง:', JSON.stringify(employees.slice(0,3).map(function(e){ return e.norm || e.name; })));
      if (pdfData[0]) {
        var cp0 = getParts(pdfData[0].name);
        var hit = employees.filter(function(e){ var ep=getParts(e.norm||''); return ep.first===cp0.first && ep.last===cp0.last; });
        console.log('[DIAG NAMES] ชื่อแรก "' + pdfData[0].name + '" → first="' + cp0.first + '" last="' + cp0.last + '" · เจอในทะเบียน ' + hit.length + ' คน');
      }
    } catch(e) { console.warn('DIAG NAMES err', e); }

    pdfData.forEach(function(cert, idx) {
      var cp = getParts(cert.name);
      var found = null, matchType = 'notfound';

      if (employees.length > 0) {
        // 1) first+last (exact หรือ ตัดวรรณยุกต์/การันต์แล้วตรง) — เลือกตัวที่มีสาขาก่อน
        for (var i=0; i<employees.length; i++) {
          if (_certEmpMatch(cp, employees[i].norm)) {
            if (!found) { found = employees[i]; matchType = 'exact'; }
            if (employees[i].branch && String(employees[i].branch).trim()) { found = employees[i]; matchType = 'exact'; break; }
          }
        }
        // 2) Whitespace-stripped full-name compare (กัน zero-width/NBSP/อักขระเพี้ยน)
        if (!found) {
          var certStripped = String(cert.name).replace(/[\s ​-‏]/g,'');
          for (var i=0; i<employees.length; i++) {
            var empStripped = String(employees[i].norm).replace(/[\s ​-‏]/g,'');
            if (certStripped && certStripped === empStripped) {
              found = employees[i]; matchType = 'exact'; break;
            }
          }
        }
        // ❌ ตัด lastname-only fallback ออก — ต้องตรงทั้ง first+last เท่านั้น
      }

      var expStatus = getExpStatus(cert.expireDate);
      raw.push({
        no: idx+1,
        certName: cert.name,
        course: cert.course,
        trainDate: cert.trainDate,
        expireDate: cert.expireDate,
        expStatus: expStatus,
        empName: found ? found.norm : '',
        branch: found ? found.branch : '—',
        position: found ? found.position : '—',
        sheet: found ? found.sheet : '—',
        matchType: matchType
      });
    });

    // สะสม: รวมของเดิม (ที่โหลดมา) + ใบใหม่ แล้วตัดซ้ำ ชื่อ+วันหมดอายุ+หลักสูตร
    // (กันของเดิมหายตอน save ทับ · ใบใหม่ทับข้อมูลเดิมของคนเดิมได้ ถ้า key เดียวกัน)
    var totalPdf = raw.length;
    var _prev = Array.isArray(matchData) ? matchData : [];
    var _ck = function(d){ return normalizeName(d.certName||'').replace(/\s+/g,'') + '|' + (d.course||''); };
    var _mkey = function(d){ return _ck(d) + '|' + (d.expireDate||''); };
    var _hasExp = function(d){ return !!(d.expireDate && String(d.expireDate).trim()); };
    // ชื่อ+หลักสูตร ที่ "ใบใหม่" อ่านวันหมดอายุได้แล้ว → ใช้ทับใบเก่าที่วันว่าง
    // (กันซ้ำตอน re-upload เพื่อเติมวันหมดอายุ — เก่าวันว่าง+ใหม่มีวัน key ต่างกันเลยไม่ merge เอง)
    var _freshDated = {};
    raw.forEach(function(d){ if (_hasExp(d)) _freshDated[_ck(d)] = true; });
    var _mseen = {}, _merged = [];
    // เอาใบใหม่ก่อน (ให้ค่าจับคู่ล่าสุดชนะ) แล้วตามด้วยของเดิม
    raw.concat(_prev).forEach(function(d){
      if (!(d.certName && String(d.certName).trim())) return;
      // ข้ามใบวันว่าง ถ้ามีใบใหม่ (ชื่อ+หลักสูตรเดียวกัน) ที่อ่านวันหมดอายุได้แล้ว
      if (!_hasExp(d) && _freshDated[_ck(d)]) return;
      var k = _mkey(d);
      if (_mseen[k]) return;
      _mseen[k] = true; _merged.push(d);
    });
    matchData = _merged;
    _canonicalizeBranches(matchData);   // รวมชื่อสาขาที่สะกดต่างเล็กน้อยให้เป็นอันเดียว
    var nMatched = raw.filter(function(d){ return d.matchType !== 'notfound'; }).length;
    // Renumber
    matchData.forEach(function(d, i){ d.no = i + 1; });

    document.getElementById('processBtn').innerHTML = '&#9889; จับคู่ข้อมูล';
    document.getElementById('processBtn').disabled = false;
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('saveBtn').disabled = false;
    (document.getElementById('noteBar')||{classList:{add:function(){}}}).classList.add('show');
    updateStats();
    renderTable();
    if (typeof _refreshAdminReqCerts === 'function') _refreshAdminReqCerts();

    console.log('[DIAG MATCH] pdfData=' + (pdfData?pdfData.length:0) + ' empData=' + (empData?empData.length:0) + ' → matchData=' + matchData.length + ' (จับคู่ได้=' + nMatched + ')');
    document.getElementById('processInfo').textContent = 'นำเข้า ' + matchData.length + ' ใบ (จับคู่ทะเบียนได้ ' + nMatched + ' · ยังไม่เจอ ' + (totalPdf - nMatched) + ') — กำลังบันทึก Cloud...';
    document.getElementById('topStatus').textContent = 'Matched · ' + new Date().toLocaleTimeString('th-TH');
    // Auto-save to cloud
    setTimeout(function(){
      if (matchData.length > 0) saveToCloud();
      else window._fhImportBusy = false;   // ไม่มีอะไรบันทึก — จบ
    }, 400);
  }, 300);
}

/* ─────────── UI HELPERS ─────────── */
function setStatus(type, state, msg) {
  var dot = document.getElementById(type+'Dot');
  var txt = document.getElementById(type+'StatusText');
  dot.className = 'status-dot ' + state;
  txt.textContent = msg;
  txt.style.color = state==='done'?'var(--green)':state==='error'?'var(--red)':state==='loading'?'var(--orange)':'var(--text3)';
  if (typeof updateStepper === 'function') updateStepper();
}
function showProg(type) { document.getElementById(type+'Prog').style.display='block'; }
function setProg(type, pct) { document.getElementById(type+'Fill').style.width = pct+'%'; }
function checkReady() {
  var ready = pdfData !== null;
  console.log('[DIAG checkReady] pdfData=' + (pdfData?pdfData.length:'null') + ' empData=' + (empData?empData.length:'null'));
  var pb = document.getElementById('processBtn');
  if (pb) pb.disabled = !ready;
  if (!ready) return;
  // มีทะเบียนใน memory แล้ว → จับคู่เลย
  if (empData && empData.length > 0) {
    document.getElementById('processInfo').textContent = 'จับคู่อัตโนมัติ...';
    setTimeout(processMatch, 200);
    return;
  }
  // ยังไม่มีทะเบียน → ลองโหลดจาก cloud ก่อน แล้ว "จับคู่+แสดงเสมอ"
  // (ถ้าไม่มีทะเบียน ใบที่อัปก็ยังขึ้น — จับคู่ทีหลังได้เมื่อทะเบียนพร้อม)
  document.getElementById('processInfo').textContent = 'PDF โหลดแล้ว · กำลังเตรียมข้อมูล...';
  setStatus('pdf', 'loading', 'กำลังเตรียมข้อมูล...');
  function _matchAnyway() {
    setStatus('pdf', 'done', 'พร้อมแล้ว — กำลังแสดงข้อมูล...');
    setTimeout(processMatch, 200);
  }
  if (typeof loadEmployeeRegistryFromCloud === 'function') {
    loadEmployeeRegistryFromCloud().then(_matchAnyway).catch(_matchAnyway);
  } else {
    _matchAnyway();
  }
}

// Filter matchData by branch+course only (ไม่นับ expFilter) — ใช้คำนวณ 4 กล่องตามที่ผู้ใช้เลือก dropdown
function getFilteredForStats_() {
  var brf = (document.getElementById('branchFilter')||{value:'all'}).value;
  var cof = (document.getElementById('courseFilter')||{value:'all'}).value;
  return matchData.filter(function(d){
    if (brf !== 'all' && d.branch !== brf) return false;
    if (cof !== 'all' && d.course !== cof) return false;
    return true;
  });
}

function updateStats() {
  var dAll = matchData;
  // 4 กล่อง + chips: นับตามที่เลือก branch/course (ไม่นับ exp chip ตัวเอง)
  var d = getFilteredForStats_();
  document.getElementById('statsRow').style.display = dAll.length ? 'grid' : 'none';
  document.getElementById('sTotal').textContent = d.length;
  var nValid = d.filter(function(r){return r.expStatus==='valid';}).length;
  var nWarn  = d.filter(function(r){return r.expStatus==='warning';}).length;
  var nExp   = d.filter(function(r){return r.expStatus==='expired';}).length;
  document.getElementById('sValid').textContent = nValid;
  document.getElementById('sWarn').textContent  = nWarn;
  document.getElementById('sExp').textContent   = nExp;
  // % indicators (share of total)
  var pct = function(n) { return d.length > 0 ? Math.round(n / d.length * 1000) / 10 + '%' : ''; };
  var totEl = document.getElementById('sTotalPct'); if (totEl) totEl.textContent = '100%';
  var vEl = document.getElementById('sValidPct'); if (vEl) vEl.textContent = pct(nValid);
  var wEl = document.getElementById('sWarnPct');  if (wEl) wEl.textContent = pct(nWarn);
  var eEl = document.getElementById('sExpPct');   if (eEl) eEl.textContent = pct(nExp);
  // Hidden legacy match-type counts (kept for compat)
  document.getElementById('sExact').textContent = dAll.filter(function(r){return r.matchType==='exact';}).length;
  document.getElementById('sLast').textContent  = dAll.filter(function(r){return r.matchType==='lastname';}).length;
  document.getElementById('sNone').textContent  = dAll.filter(function(r){return r.matchType==='notfound';}).length;
  // Exp-status dropdown — ใส่จำนวนใน option (sync กับการ์ด)
  var chipsEl = document.getElementById('matchChips');
  if (chipsEl) {
    chipsEl.style.display = dAll.length ? 'flex' : 'none';
    var efSel = document.getElementById('expFilter');
    if (efSel && efSel.options.length >= 4) {
      efSel.options[0].text = '📋 ทั้งหมด (' + d.length + ')';
      efSel.options[1].text = '✓ ยังมีผล (' + nValid + ')';
      efSel.options[2].text = '⚠ ใกล้หมดอายุ (' + nWarn + ')';
      efSel.options[3].text = '✗ หมดอายุ (' + nExp + ')';
    }
  }
  // Populate branch + course filter dropdowns (ครั้งแรกหลังโหลดข้อมูล)
  populateFilterDropdowns_();
  if (typeof updateStepper === 'function') updateStepper();
}

function populateFilterDropdowns_() {
  var brSel = document.getElementById('branchFilter');
  var coSel = document.getElementById('courseFilter');
  var bdSel = document.getElementById('brandFilter');
  if (!brSel || !coSel) return;
  var brSet = {}, coSet = {}, bdSet = {};
  matchData.forEach(function(d){
    if (d.branch && d.branch !== '—') brSet[d.branch] = true;
    if (d.course) coSet[d.course] = true;
    var bd = _certBrand(d); if (bd && bd !== '—') bdSet[bd] = true;
  });
  var currBr = brSel.value, currCo = coSel.value;
  /* โชว์ "รหัส · ชื่อสาขา" และเรียงตามรหัส (สาขาที่ไม่มีรหัสในทะเบียนไปท้ายสุด)
     value ยังเป็น "ชื่อสาขา" เหมือนเดิม — ตัวกรอง (d.branch === brf) จึงทำงานปกติ */
  brSel.innerHTML = '<option value="all">🏢 ทุกสาขา</option>' + Object.keys(brSet).sort(function(a, b){
    var ca = _branchCodeOf(a), cb = _branchCodeOf(b);
    if (ca && cb) return ca === cb ? a.localeCompare(b) : (ca < cb ? -1 : 1);
    if (ca) return -1;
    if (cb) return 1;
    return a.localeCompare(b);
  }).map(function(b){
    var c = _branchCodeOf(b);
    return '<option value="'+escapeAttr(b)+'"'+(b===currBr?' selected':'')+'>'+escapeHtml(c ? (c + ' · ' + b) : b)+'</option>';
  }).join('');
  coSel.innerHTML = '<option value="all">📚 ทุกหลักสูตร</option>' + Object.keys(coSet).sort().map(function(c){
    return '<option value="'+escapeAttr(c)+'"'+(c===currCo?' selected':'')+'>'+escapeHtml(_courseShort(c))+'</option>';
  }).join('');
  if (bdSel) {
    var currBd = bdSel.value;
    bdSel.innerHTML = '<option value="all">🏷️ ทุกแบรนด์</option>' + Object.keys(bdSet).sort().map(function(b){
      return '<option value="'+escapeAttr(b)+'"'+(b===currBd?' selected':'')+'>'+escapeHtml(b)+'</option>';
    }).join('');
  }
}

function setExpFilter(val) {
  var sel = document.getElementById('expFilter');
  if (sel) sel.value = val;
  // Sync chip active state
  document.querySelectorAll('.exp-status-chip').forEach(function(el){
    if (el.getAttribute('data-ef') === val) el.classList.add('active');
    else el.classList.remove('active');
  });
  _tablePage = 1;
  renderTable();
}

function getFiltered() {
  var q = (document.getElementById('searchQ')||{value:''}).value.trim().toLowerCase();
  var mf = (document.getElementById('matchFilter')||{value:'all'}).value;
  var ef = (document.getElementById('expFilter')||{value:'all'}).value;
  var sf = (document.getElementById('sheetFilter')||{value:'all'}).value;
  var brf = (document.getElementById('branchFilter')||{value:'all'}).value;
  var cof = (document.getElementById('courseFilter')||{value:'all'}).value;
  var bdf = (document.getElementById('brandFilter')||{value:'all'}).value;
  return matchData.filter(function(d) {
    var ok = true;
    if (q) ok = ok && (d.certName+d.empName+d.branch+d.position).toLowerCase().indexOf(q)>=0;
    if (mf!=='all') ok = ok && d.matchType===mf;
    if (ef!=='all') ok = ok && d.expStatus===ef;
    if (sf!=='all') ok = ok && d.sheet===sf;
    if (brf!=='all') ok = ok && d.branch===brf;
    if (cof!=='all') ok = ok && d.course===cof;
    if (bdf!=='all') ok = ok && _certBrand(d)===bdf;
    return ok;
  });
}

function getExpBadge(s) {
  if (s==='expired') return '<span class="exp-badge exp-over"><span class="dot"></span>หมดอายุ</span>';
  if (s==='warning') return '<span class="exp-badge exp-warn"><span class="dot"></span>ใกล้หมดอายุ</span>';
  if (s==='valid') return '<span class="exp-badge exp-ok"><span class="dot"></span>ยังมีผล</span>';
  return '<span style="color:var(--text3)">—</span>';
}
function getMatchBadge(t) {
  if (t==='exact') return '<span class="mbadge mb-exact"><span class="dot"></span>ตรงสนิท</span>';
  if (t==='lastname') return '<span class="mbadge mb-last"><span class="dot"></span>&#9888; นามสกุลตรง</span>';
  if (t==='notfound') return '<span class="mbadge mb-none"><span class="dot"></span>ไม่พบ</span>';
  return '<span class="mbadge mb-notloaded">—</span>';
}
function getSheetTag(s) {
  if (!s||s==='—') return '<span style="color:var(--text3)">—</span>';
  return '<span class="sheet-tag st-'+s+'">'+s+'</span>';
}
/* แบรนด์ของแถวใบรับรอง — ดึงรหัสสาขาจากช่องสาขา แล้วแปลงเป็นชื่อแบรนด์ (fallback: Sheet) */
function _certBrand(d) {
  // ยึดชื่อแบรนด์จริงจากทะเบียน (sheet) ก่อน
  if (d && d.sheet && d.sheet !== '—' && String(d.sheet).trim()) return String(d.sheet).trim();
  // ไม่มี → เดาจากรหัสนำหน้าสาขา (50→Santa Fe ฯลฯ)
  var m = String((d && d.branch) || '').match(/(\d{3,})/);
  var b = getBranchPrefix(m ? m[1] : '');
  return b || '—';
}
function _certBrandTag(d) {
  var b = _certBrand(d);
  if (b === '—') return '<span style="color:var(--text3)">—</span>';
  return '<span style="font-size:12px;font-weight:700;color:var(--text2);white-space:nowrap;">' + escapeHtml(b) + '</span>';
}
/* ย่อชื่อหลักสูตร — ตัด "การสุขาภิบาลอาหาร สำหรับ" ออก (แสดงผลเท่านั้น ค่าจริงไม่เปลี่ยน) */
function _courseShort(c) {
  var s = String(c || '').replace(/^\s*การสุขาภิบาลอาหาร\s*/,'').replace(/^สำหรับ\s*/,'').trim();
  return s || String(c || '');
}

var _tablePage = 1;
function _TABLE_PER_PAGE() { return window.innerWidth <= 768 ? 10 : 20; }
function renderTable() {
  // อัปเดต 4 กล่อง + chips ก่อน render (เผื่อ user เพิ่งเปลี่ยน dropdown สาขา/หลักสูตร)
  if (typeof updateStats === 'function') updateStats();
  _fhResetSelIfFilterChanged('ad');   // เปลี่ยนตัวกรอง → ล้างที่ติ๊กไว้ก่อนวาดช่องติ๊ก
  var filtered = getFiltered();
  var tbody = document.getElementById('tableBody');
  var perPage = _TABLE_PER_PAGE();
  var totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (_tablePage > totalPages) _tablePage = totalPages;
  if (_tablePage < 1) _tablePage = 1;
  var start = (_tablePage - 1) * perPage;
  var pageRows = filtered.slice(start, start + perPage);

  document.getElementById('countLine').innerHTML = 'แสดง <em>'+pageRows.length+'</em> รายการ (จากทั้งหมด '+filtered.length+(filtered.length<matchData.length?'/'+matchData.length:'')+') · หน้า '+_tablePage+'/'+totalPages;

  if (filtered.length===0) {
    tbody.innerHTML='<tr><td colspan="9" class="empty">ไม่พบข้อมูลที่ค้นหา</td></tr>';
    renderTablePagination_(totalPages);
    fhUpdateSelBar('ad');
    if (typeof fhUpdateFilterBadge === 'function') fhUpdateFilterBadge();
    return;
  }
  tbody.innerHTML = pageRows.map(function(d){
    return '<tr data-st="'+escapeAttr(d.expStatus || 'unknown')+'">'
      +'<td class="td-chk" data-label="เลือก" data-icon="☑️">'+_fhChkHtml('ad', d.certName, d.course)+'</td>'
      +'<td class="no-txt" data-label="ลำดับ" data-icon="🔢">'+d.no+'</td>'
      +'<td data-label="แบรนด์" data-icon="🏷">'+_certBrandTag(d)+'</td>'
      +'<td data-label="หลักสูตร" data-icon="📚" style="color:var(--text3);font-size:11px;max-width:180px;">'+escapeHtml(_courseShort(d.course))+'</td>'
      +'<td data-label="สาขา" data-icon="🏢" class="branch-txt">'+d.branch+'</td>'
      +'<td class="cert-name" data-label="ชื่อ" data-icon="📜">'+d.certName+'</td>'
      +'<td data-label="วันหมดอายุ" data-icon="⏰" style="white-space:nowrap;font-size:12px;color:var(--text2);">'+formatThaiDate(d.expireDate)+'</td>'
      +'<td data-label="สถานะ" data-icon="🏷">'+getExpBadge(d.expStatus)+'</td>'
      +'<td data-label="จัดการ" data-icon="⚙️" class="td-row-actions">'
      +   '<button class="btn-row-view" onclick="openCertDetailModal('+d.no+')" title="ดูรายละเอียด">👁</button>'
      +   ((_fhCertUrl(d.certName, d.course)) ? '<a class="btn-row-view" href="'+_fhCertUrl(d.certName, d.course)+'" target="_blank" rel="noopener" title="ดาวน์โหลดใบเซอร์" style="text-decoration:none;">⬇️</a>' : '')
      +   '<button class="btn-del-row" onclick="deleteMatchRow('+d.no+')" title="ลบรายการนี้">🗑</button>'
      +'</td>'
      +'</tr>';
  }).join('');
  renderTablePagination_(totalPages);
  fhUpdateSelBar('ad');
  if (typeof fhUpdateFilterBadge === 'function') fhUpdateFilterBadge();
}
function renderTablePagination_(totalPages) {
  var pagEl = document.getElementById('tablePagination');
  if (!pagEl) return;
  if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
  var html = '';
  html += '<button class="pg-btn" '+(_tablePage<=1?'disabled':'')+' onclick="gotoTablePage(_tablePage-1)">‹</button>';
  // Page number buttons (windowed if many)
  var maxBtns = 7;
  var startP = Math.max(1, _tablePage - Math.floor(maxBtns/2));
  var endP = Math.min(totalPages, startP + maxBtns - 1);
  if (endP - startP < maxBtns - 1) startP = Math.max(1, endP - maxBtns + 1);
  if (startP > 1) html += '<button class="pg-btn" onclick="gotoTablePage(1)">1</button>' + (startP > 2 ? '<span class="pg-dots">…</span>' : '');
  for (var p = startP; p <= endP; p++) {
    html += '<button class="pg-btn'+(p===_tablePage?' active':'')+'" onclick="gotoTablePage('+p+')">'+p+'</button>';
  }
  if (endP < totalPages) html += (endP < totalPages-1 ? '<span class="pg-dots">…</span>' : '') + '<button class="pg-btn" onclick="gotoTablePage('+totalPages+')">'+totalPages+'</button>';
  html += '<button class="pg-btn" '+(_tablePage>=totalPages?'disabled':'')+' onclick="gotoTablePage(_tablePage+1)">›</button>';
  pagEl.innerHTML = html;
}
function gotoTablePage(p) {
  _tablePage = p;
  renderTable();
  // Scroll to table top
  var el = document.getElementById('mainTable');
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ═══════════ ติ๊กเลือกหลายใบ → ดาวน์โหลดรวมเป็น PDF ไฟล์เดียว ═══════════
   scope 'ad' = ตารางฝั่งแอดมิน (#mainTable) · 'br' = ตารางฝั่งสาขา (#branchCertTable)
   เก็บที่เลือกด้วย key(ชื่อ|หลักสูตร) → ติ๊กค้างข้ามหน้า/ข้ามการกรองได้ */
var _certSel = { ad: {}, br: {} };
var _selSig  = { ad: null, br: null };   // ลายเซ็นตัวกรองล่าสุด — เปลี่ยนกรอง = ล้างที่เลือก
var _brLastResults = [];   // ผลค้นหาล่าสุดฝั่งสาขา (ใช้ตอนกด "เลือกทั้งหมด")

function _fhSelStore(scope) { return _certSel[scope === 'br' ? 'br' : 'ad']; }
function _fhSelIds(scope) {
  return scope === 'br'
    ? { bar:'brSelBar', count:'brSelCount', btn:'brSelDlBtn', all:'brChkAll' }
    : { bar:'certSelBar', count:'certSelCount', btn:'certSelDlBtn', all:'certChkAll' };
}
/* checkbox 1 ช่อง — ไม่มีไฟล์ใบเซอร์ = ติ๊กไม่ได้ */
function _fhChkHtml(scope, name, course) {
  var url = _fhCertUrl(name, course);
  if (!url) return '<input type="checkbox" class="chk-cert" disabled title="ยังไม่มีไฟล์ใบเซอร์ในระบบ">';
  var k = _fhCertKey(name, course);
  return '<input type="checkbox" class="chk-cert"'
    + (_fhSelStore(scope)[k] ? ' checked' : '')
    + ' data-k="' + escapeAttr(k) + '"'
    + ' data-n="' + escapeAttr(name || '') + '"'
    + ' data-c="' + escapeAttr(course || '') + '"'
    + ' data-u="' + escapeAttr(url) + '"'
    + ' onclick="fhToggleSel(this,\'' + scope + '\')" title="เลือกเพื่อดาวน์โหลด">';
}
function fhToggleSel(el, scope) {
  var store = _fhSelStore(scope);
  var k = el.getAttribute('data-k');
  if (!k) return;
  if (el.checked) store[k] = { name: el.getAttribute('data-n'), course: el.getAttribute('data-c'), url: el.getAttribute('data-u') };
  else delete store[k];
  fhUpdateSelBar(scope);
}
/* เลือกทุกรายการที่กรองอยู่ (ทุกหน้า ไม่ใช่เฉพาะหน้าปัจจุบัน) */
function fhSelectAllCerts(scope, on) {
  var store = _fhSelStore(scope);
  var rows = scope === 'br'
    ? (_brLastResults || []).map(function(r){ return { name: r['ชื่อในใบรับรอง'], course: r['หลักสูตร'] }; })
    : getFiltered().map(function(d){ return { name: d.certName, course: d.course }; });
  rows.forEach(function(x){
    var url = _fhCertUrl(x.name, x.course);
    if (!url) return;
    var k = _fhCertKey(x.name, x.course);
    if (on) store[k] = { name: x.name, course: x.course, url: url };
    else delete store[k];
  });
  _fhSyncChkBoxes(scope);
  fhUpdateSelBar(scope);
}
function fhClearSel(scope) {
  _certSel[scope === 'br' ? 'br' : 'ad'] = {};
  _fhSyncChkBoxes(scope);
  fhUpdateSelBar(scope);
}
/* อัปเดตสถานะ checkbox ที่แสดงอยู่บนจอ (ไม่ต้อง re-render ตารางทั้งหมด) */
function _fhSyncChkBoxes(scope) {
  var store = _fhSelStore(scope);
  var tbl = document.getElementById(scope === 'br' ? 'branchCertTable' : 'mainTable');
  if (!tbl) return;
  var boxes = tbl.querySelectorAll('tbody input.chk-cert[data-k]');
  for (var i = 0; i < boxes.length; i++) boxes[i].checked = !!store[boxes[i].getAttribute('data-k')];
}
/* ลายเซ็นของตัวกรองปัจจุบัน — ใช้เช็กว่าผู้ใช้เปลี่ยนเงื่อนไขหรือยัง */
function _fhCurSig(scope) {
  var g = function(id){ return (document.getElementById(id) || { value:'' }).value; };
  if (scope === 'br') return 'br|' + g('branchSearchQ').trim().toLowerCase();
  return ['ad', g('searchQ').trim().toLowerCase(), g('matchFilter'), g('expFilter'),
          g('sheetFilter'), g('branchFilter'), g('courseFilter'), g('brandFilter')].join('|');
}
/* เปลี่ยนตัวกรอง/คำค้น = เริ่มเลือกใหม่ (กันของที่ติ๊กค้างจากชุดก่อนหน้ามานับรวม)
   เปลี่ยนหน้า (pagination) ลายเซ็นไม่เปลี่ยน → ที่ติ๊กไว้ยังอยู่ */
function _fhResetSelIfFilterChanged(scope) {
  var key = scope === 'br' ? 'br' : 'ad';
  var sig = _fhCurSig(scope);
  if (_selSig[key] !== null && _selSig[key] !== sig) _certSel[key] = {};
  _selSig[key] = sig;
}
function fhUpdateSelBar(scope) {
  _fhResetSelIfFilterChanged(scope);
  var ids = _fhSelIds(scope);
  var store = _fhSelStore(scope);
  var n = Object.keys(store).length;
  var bar = document.getElementById(ids.bar);
  var cnt = document.getElementById(ids.count);
  if (cnt) cnt.textContent = n;
  if (bar) bar.classList.toggle('show', n > 0);
  // หัวตาราง: ติ๊กครบทุกรายการที่มีไฟล์ = ติ๊กหัวด้วย
  var all = document.getElementById(ids.all);
  if (all) {
    var pool = scope === 'br'
      ? (_brLastResults || []).map(function(r){ return _fhCertUrl(r['ชื่อในใบรับรอง'], r['หลักสูตร']) ? _fhCertKey(r['ชื่อในใบรับรอง'], r['หลักสูตร']) : null; })
      : (typeof matchData !== 'undefined' && matchData.length ? getFiltered() : []).map(function(d){ return _fhCertUrl(d.certName, d.course) ? _fhCertKey(d.certName, d.course) : null; });
    pool = pool.filter(Boolean);
    var picked = pool.filter(function(k){ return !!store[k]; }).length;
    all.checked = pool.length > 0 && picked === pool.length;
    all.indeterminate = picked > 0 && picked < pool.length;
    all.disabled = pool.length === 0;
  }
}
function _fhStamp() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
/* ดาวน์โหลดที่เลือก — โหลดไฟล์ทีละใบแล้วรวมเป็น PDF เดียว (พิมพ์/ส่งต่อได้ทีเดียว)
   ถ้าโหลดตรงไม่ได้ (CORS/เน็ต) → ถอยไปเปิดทีละแท็บให้แทน */
function fhDownloadSelected(scope) {
  var store = _fhSelStore(scope);
  var items = Object.keys(store).map(function(k){ return store[k]; }).filter(function(x){ return x && x.url; });
  if (!items.length) { showInfo('ยังไม่ได้เลือก', 'ติ๊ก ☑️ หน้ารายการที่ต้องการก่อน แล้วกดดาวน์โหลดอีกครั้ง'); return; }
  items.sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''), 'th'); });
  // ไฟล์เดียวกันอาจผูกหลายคน (กรณีอัปทั้งไฟล์ไม่ได้ตัดหน้า) → ตัด URL ซ้ำออก
  var seen = {}, uniq = [];
  items.forEach(function(it){ if (seen[it.url]) return; seen[it.url] = 1; uniq.push(it); });

  var ids = _fhSelIds(scope);
  var btn = document.getElementById(ids.btn);
  var origHtml = btn ? btn.innerHTML : '';
  var setTxt = function(t){ if (btn) btn.innerHTML = t; };
  var restore = function(){ if (btn) { btn.disabled = false; btn.innerHTML = origHtml; } };
  if (btn) btn.disabled = true;

  if (typeof PDFLib === 'undefined') { restore(); _fhOpenEachTab(uniq); return; }

  var bufs = [], failed = [];
  var chain = Promise.resolve();
  uniq.forEach(function(it, i){
    chain = chain.then(function(){
      setTxt('⏳ กำลังโหลด ' + (i+1) + '/' + uniq.length + '...');
      return fetch(it.url, { cache: 'no-store' })
        .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then(function(buf){ bufs.push({ it: it, buf: buf }); })
        .catch(function(){ failed.push(it.name || it.url); });
    });
  });

  chain.then(function(){
    if (!bufs.length) throw new Error('NOFETCH');
    setTxt('⏳ กำลังรวมไฟล์...');
    return PDFLib.PDFDocument.create().then(function(out){
      var c2 = Promise.resolve();
      bufs.forEach(function(b){
        c2 = c2.then(function(){
          return PDFLib.PDFDocument.load(b.buf, { ignoreEncryption: true })
            .then(function(src){ return out.copyPages(src, src.getPageIndices()); })
            .then(function(pages){ pages.forEach(function(p){ out.addPage(p); }); })
            .catch(function(){ failed.push(b.it.name || ''); });
        });
      });
      return c2.then(function(){
        if (out.getPageCount() === 0) throw new Error('NOPAGE');
        return out.save();
      });
    });
  }).then(function(bytes){
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ใบรับรอง_' + (uniq.length - failed.length) + 'ใบ_' + _fhStamp() + '.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
    restore();
    showInfo('ดาวน์โหลดแล้ว',
      'รวม <b>' + (uniq.length - failed.length) + '</b> ใบเป็นไฟล์ PDF เดียว'
      + (failed.length ? '<div style="margin-top:8px;color:#b45309;font-size:13px;">⚠️ โหลดไม่สำเร็จ ' + failed.length + ' ใบ: ' + escapeHtml(failed.slice(0,5).join(', ')) + (failed.length > 5 ? ' ...' : '') + '</div>' : ''));
  }).catch(function(e){
    restore();
    if (e && (e.message === 'NOFETCH' || e.message === 'NOPAGE')) { _fhOpenEachTab(uniq); return; }
    showInfo('ดาวน์โหลดไม่สำเร็จ', escapeHtml((e && e.message) || String(e)));
  });
}
/* ถอยกรณีรวมไฟล์ไม่ได้ — เปิดใบเซอร์ทีละแท็บ (ต้องอนุญาต pop-up) */
function _fhOpenEachTab(list) {
  showInfo('รวมไฟล์ไม่ได้ — เปิดทีละใบแทน',
    'ระบบจะเปิดใบรับรอง ' + list.length + ' ใบในแท็บใหม่ (ถ้าเบราว์เซอร์บล็อกป๊อปอัป กรุณากด "อนุญาต")');
  list.forEach(function(it, i){ setTimeout(function(){ window.open(it.url, '_blank', 'noopener'); }, i * 350); });
}

function deleteMatchRow(no) {
  customConfirm({ icon:ICON_TRASH, title:'ลบรายการนี้?', desc:'จะลบออกจากตารางและ Cloud', okText:'ลบเลย' })
    .then(function(ok){ if (ok) doDeleteMatchRow(no); });
}
function doDeleteMatchRow(no) {
  var idx = matchData.findIndex(function(d){ return d.no === no; });
  if (idx < 0) return;
  matchData.splice(idx, 1);
  // Renumber
  matchData.forEach(function(d, i){ d.no = i + 1; });
  updateStats();
  renderTable();
  // Auto-save change to Cloud
  if (matchData.length > 0) {
    document.getElementById('processInfo').textContent = 'ลบรายการแล้ว · กำลังบันทึก Cloud...';
    setTimeout(saveToCloud, 200);
  } else {
    // ลบใบสุดท้าย → save-certificates ไม่รับ array ว่าง เลยต้องเรียก clear-certificates เพื่อล้าง Cloud จริง
    // (ไม่งั้นใบสุดท้ายยังค้างบน Cloud → รีเฟรชแล้วกลับมา)
    document.getElementById('processInfo').textContent = 'ลบรายการสุดท้ายแล้ว · กำลังล้าง Cloud...';
    _fhCacheSet('fh_cert_v1', []);
    if (SCRIPT_URL) {
      fetch(SCRIPT_URL, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'clear-certificates' })
      })
      .then(function(r){ return r.json(); })
      .then(function(){ document.getElementById('processInfo').textContent = 'ลบรายการสุดท้ายแล้ว · ไม่มีข้อมูลเหลือ'; })
      .catch(function(){ document.getElementById('processInfo').textContent = 'ลบแล้ว แต่ล้าง Cloud ไม่สำเร็จ — ลองกด "ลบใบรับรองทั้งหมด"'; });
    }
  }
}

/* ─────────── EMPLOYEE REGISTRY CLOUD ─────────── */
function saveEmployeeRegistryToCloud(employees, replaceAll) {
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

/* cache ในเครื่อง (localStorage) — แสดงทันทีตอนโหลด แล้วค่อยดึงของใหม่มาทับ */
function _fhCacheSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
function _fhCacheGet(k){ try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch(e){ return null; } }

function loadEmployeeRegistryFromCloud() {
  if (!SCRIPT_URL) return Promise.resolve();
  // แสดงทะเบียนจาก cache ทันที (ถ้ายังไม่มี) แล้วค่อยดึงของใหม่มาทับ
  if (!empData || !empData.length) {
    var _ec = _fhCacheGet('fh_emp_v1');
    if (_ec && _ec.length) { empData = _ec; if (document.getElementById('registryBody')) { try { renderRegistryTable(); } catch(e){} } }
  }
  setStatus('xlsx','loading','กำลังโหลดทะเบียนพนักงานจาก Cloud...');
  return fetch(SCRIPT_URL + '?action=employees&_=' + Date.now(), { method: 'GET', cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (!res || !res.ok) {
        setStatus('xlsx','wait','ยังไม่มีทะเบียนใน Cloud — กรุณา upload Excel');
        return;
      }
      var records = res.records || [];
      if (records.length === 0) {
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
    fetch(SCRIPT_URL, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'dedup-employees' })
    })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.ok) {
        showInfo('✓ ลบสำเร็จ', 'เหลือ <b>'+(res.kept||0)+'</b> รายชื่อ (ลบ '+(res.removed||0)+' รายการซ้ำ)');
        loadEmployeeRegistryFromCloud();
      } else {
        showInfo('✗ ลบไม่สำเร็จ', escapeHtml((res && res.error) || 'unknown'));
      }
    })
    .catch(function(err){ showInfo('🌐 เชื่อมต่อ Cloud ไม่ได้', escapeHtml(err.message||String(err))); });
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
    _fhBulkDelete(records, function(n, total){
      if (btn) btn.textContent = 'กำลังลบ... ' + n + '/' + total;
    }).then(function(r){
      showInfo('สรุปผลการลบ', '✓ ลบสำเร็จ <b>' + r.done + '</b> รายการ' + (r.failed ? ' · ✗ ล้มเหลว ' + r.failed + ' รายการ' : ''));
      closeAdminReqDupModal();
      _fhBustRequests();
      loadAdminRequests();
    });
  });
}

function dedupCertificateRegistry() {
  customConfirm({
    icon: ICON_TRASH,
    title: 'ลบใบรับรองที่ซ้ำกัน?',
    desc: 'เทียบจาก <b>ชื่อ + วันหมดอายุ</b> · ระบบจะเก็บไว้ 1 แถวต่อใบที่ซ้ำ',
    okText: 'ลบเลย',
    okIsPrimary: true
  }).then(function(ok){
    if (!ok) return;
    fetch(SCRIPT_URL, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'dedup-certificates' })
    })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.ok) {
        showInfo('✓ ลบสำเร็จ', 'เหลือ <b>'+(res.kept||0)+'</b> ใบ (ลบ '+(res.removed||0)+' ใบซ้ำ)');
        loadFromCloud();
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

  fetch(SCRIPT_URL, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'save-certificates', records: matchData })
  })
  .then(function(r){ return r.json(); })
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
  var btn = document.getElementById('loadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> กำลังโหลด...';
  document.getElementById('processInfo').textContent = 'กำลังโหลดข้อมูลจาก Cloud...';

  // กันเบราว์เซอร์แคช GET เก่า (ลบแล้วรีเฟรชข้อมูลกลับมา เพราะได้ response เก่าจาก cache)
  var _bust = (SCRIPT_URL.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
  fetch(SCRIPT_URL + _bust, { method: 'GET', cache: 'no-store' })
  .then(function(r){ return r.json(); })
  .then(function(res){
    btn.disabled = false;
    btn.innerHTML = '&#9729; โหลดจาก Cloud';
    if (!res.ok) {
      document.getElementById('processInfo').textContent = '✗ โหลดล้มเหลว: ' + (res.error || 'unknown');
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
      document.getElementById('processInfo').textContent = 'ยังไม่มีข้อมูลใน Cloud';
      return;
    }
    matchData = records.map(function(r) {
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
        certName: _cleanCertName(r['ชื่อในใบรับรอง'] || ''),   // ล้างชื่อเพี้ยนเก่า (นามสกุลติดคำหลักสูตร)
        course: r['หลักสูตร'] || '',
        trainDate: r['วันอบรม'] || r['วันที่อบรม'] || '',
        expireDate: expireDate,
        expStatus: expStatus,
        empName: r['ชื่อในระบบ'] || '',
        branch: r['สาขา'] || '—',
        position: r['ตำแหน่ง'] || '—',
        sheet: r['Sheet'] || '—',
        matchType: r['สถานะจับคู่'] || 'notfound'
      };
    })
    // เก็บทุกใบที่มีชื่อในใบรับรอง (รวม notfound ที่ยังไม่จับคู่ทะเบียน) — กันข้อมูลหายตอน reload
    .filter(function(d){ return !!(d.certName && String(d.certName).trim()); });
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
        var k = _ckey(d) + '|' + (d.expireDate||'');            // ตัดซ้ำ (รองรับ renewal คนละวัน)
        if (seen[k]) return; seen[k] = true; out.push(d);
      });
      matchData = out;
    })();
    console.log('[DIAG LOAD] หลัง map+filter+dedup → matchData = ' + matchData.length);
    _canonicalizeBranches(matchData);   // รวมชื่อสาขาที่สะกดต่างเล็กน้อยให้เป็นอันเดียว
    // Renumber
    matchData.forEach(function(d, i){ d.no = i + 1; });
    _fhCacheSet('fh_cert_v1', matchData);   // cache ไว้แสดงทันทีรอบหน้า
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('saveBtn').disabled = false;
    (document.getElementById('noteBar')||{classList:{add:function(){}}}).classList.add('show');
    updateStats();
    renderTable();
    if (typeof _refreshAdminReqCerts === 'function') _refreshAdminReqCerts();
    // NOTE: ตัดซ้ำเฉพาะ "ตอนแสดง" — ไม่เขียนกลับ Cloud อัตโนมัติ (กัน race ชนกับปุ่มลบ)
    // ถ้าอยากล้างของซ้ำบน Cloud จริง ให้กด "จับคู่ใบรับรองกับทะเบียน" หรือลบทั้งหมดแล้วอัปใหม่
    var _dupN = records.length - matchData.length;
    document.getElementById('processInfo').textContent = '✓ โหลด ' + matchData.length + ' รายการ' + (_dupN > 0 ? ' (ซ่อนใบซ้ำ/ไม่สมบูรณ์ ' + _dupN + ' ใบ)' : '') + ' · ' + new Date().toLocaleTimeString('th-TH');
    document.getElementById('topStatus').textContent = 'Loaded · ' + new Date().toLocaleTimeString('th-TH');
  })
  .catch(function(err){
    btn.disabled = false;
    btn.innerHTML = '&#9729; โหลดจาก Cloud';
    document.getElementById('processInfo').textContent = '✗ เชื่อมต่อ Cloud ไม่ได้: ' + err.message;
    // มีข้อมูลจากแคชอยู่แล้ว → ปล่อยให้ใช้ต่อได้ · ไม่มีเลย → บอกให้ชัดว่าโหลดไม่ผ่าน
    fhCertLoading(false, _hadData ? '' : ('เชื่อมต่อ Cloud ไม่ได้: ' + err.message));
  });
}

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
  var rows = q ? emps.filter(function(e){ return ((e.name||'')+(e.empId||'')+(e.idCard||'')+(e.branch||'')+(e.position||'')).toLowerCase().indexOf(q) >= 0; }) : emps;
  var cnt = document.getElementById('registryCount');
  if (cnt) cnt.textContent = 'ทั้งหมด ' + emps.length + ' คน' + (q ? (' · พบ ' + rows.length) : '');
  if (!emps.length) { body.innerHTML = '<tr><td colspan="6" class="empty">ยังไม่มีทะเบียน — อัปไฟล์ Excel ที่เมนู "นำเข้าข้อมูล → นำเข้ารายชื่อพนักงาน"</td></tr>'; return; }
  if (!rows.length) { body.innerHTML = '<tr><td colspan="6" class="empty">ไม่พบข้อมูลที่ค้นหา</td></tr>'; return; }
  var show = rows.slice(0, 500);
  var html = show.map(function(e, i){
    return '<tr><td>'+(i+1)+'</td><td>'+escapeHtml(e.name||'')+'</td><td>'+escapeHtml(e.empId||'')+'</td><td>'+escapeHtml(e.branch||'')+'</td><td>'+escapeHtml(e.position||'')+'</td><td>'+escapeHtml(e.sheet||'')+'</td></tr>';
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
      .then(function(){ empData = []; hideLoadingOverlay(); try { renderRegistryTable(); } catch(e) {} showInfo('ลบสำเร็จ', 'ลบทะเบียนรายชื่อทั้งหมดแล้ว'); })
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
      var matched = 0;
      md.forEach(function(d){
        var cp = getParts(d.certName || '');
        var found = null;
        for (var i=0;i<emps.length;i++){
          if(_certEmpMatch(cp, emps[i].norm||emps[i].name||'')){
            if(!found) found = emps[i];
            if(emps[i].branch && String(emps[i].branch).trim()){ found = emps[i]; break; }  // เลือกตัวที่มีสาขาก่อน
          }
        }
        if (found) {
          matched++;
          d.empName = found.norm || found.name || d.empName;
          if (found.branch) d.branch = found.branch;
          if (found.position) d.position = found.position;
          if (found.sheet) d.sheet = found.sheet;
          d.matchType = 'exact';
        }
      });
      try { renderTable(); } catch(e) {}
      hideLoadingOverlay();
      showInfo('จับคู่เสร็จ', 'จับคู่ได้ <b>'+matched+'</b>/'+md.length+' รายการ · กำลังบันทึก Cloud...');
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
  csv += 'ลำดับ,ชื่อในใบรับรอง,หลักสูตร,วันที่อบรม,วันหมดอายุ,สถานะใบรับรอง,ชื่อในระบบ,สาขา,ตำแหน่ง,Sheet,สถานะจับคู่\n';
  filtered.forEach(function(d){
    var es = d.expStatus==='expired'?'หมดอายุ':d.expStatus==='warning'?'ใกล้หมดอายุ':'ยังมีผล';
    var ms = d.matchType==='exact'?'ตรงสนิท':d.matchType==='lastname'?'นามสกุลตรง':'ไม่พบ';
    csv += [d.no,'"'+d.certName+'"','"'+d.course+'"','"'+d.trainDate+'"','"'+d.expireDate+'"','"'+es+'"','"'+(d.empName||'—')+'"','"'+d.branch+'"','"'+d.position+'"','"'+d.sheet+'"','"'+ms+'"'].join(',')+'\n';
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

/* ═════════════════════ LOGIN / AUTH ═════════════════════ */
var ADMIN_CODE = '601183';
var isAdminMode = false;
var BRANCHES = {
  '5001':'แฟชั่น ไอส์แลนด์','5002':'ซีคอนสแควร์ ศรีนครินทร์','5003':'เดอะมอลล์ ท่าพระ',
  '5004':'เซ็นทรัล รัตนาธิเบศร์','5005':'เดอะมอลล์ บางกะปิ','5007':'เซ็นทรัลพลาซา พระราม 2',
  '5010':'แพชชั่น ระยอง','5011':'เดอะมอลล์ งามวงศ์วาน','5012':'โลตัส บางพลี',
  '5014':'บิ๊กซี พัทยากลาง','5015':'แปซิฟิกพาร์ค ศรีราชา','5016':'อิมพีเรียลเวิลด์ สำโรง',
  '5017':'ซีคอน บางแค','5018':'เซ็นทรัล รามอินทรา','5019':'เทอร์มินัล 21 อโศก',
  '5021':'เซ็นทรัล ปิ่นเกล้า','5023':'บิ๊กซี พัทยาใต้','5024':'เดอะมอลล์ บางแค',
  '5026':'IT หลักสี่','5028':'โลตัส ปทุมธานี','5030':'เพลินนารี่ มอลล์',
  '5031':'เซ็นทรัล ศาลายา','5033':'โลตัส แจ้งวัฒนะ','5034':'โลตัส ศาลายา',
  '5035':'เซ็นทรัลพัทยา บีช','5036':'โลตัส บางปะกอก','5038':'เซ็นทรัล ระยอง',
  '5039':'เซ็นทรัล ชลบุรี','5040':'เซ็นทรัล Westgate','5042':'ฟิวเจอร์ปาร์ค รังสิต',
  '5045':'เดอะพรอมานาด','5046':'โลตัส บางกะปิ','5049':'โลตัส ชลบุรี',
  '5050':'บิ๊กซี บางพลี','5052':'โลตัส นวนคร','5054':'บิ๊กซี บางใหญ่',
  '5055':'โลตัส สุขาภิบาล 3','5057':'โลตัส รังสิต','5061':'บิ๊กซี สัตหีบ',
  '5062':'โรบินสัน ชลบุรี','5063':'โลตัส พนัสนิคม','5064':'เทอร์มินอล พัทยา',
  '5065':'เกตเวย์ เอกมัย','5066':'เกตเวย์ บางซื่อ','5068':'คอสโม บาร์ซา',
  '5069':'โลตัส พัฒนาการ','5070':'พันทิพย์ งามวงศ์วาน','5071':'โลตัส จรัญสนิทวงศ์',
  '5072':'โลตัส สุขาภิบาล 1','5073':'โลตัส ลาดพร้าว','5076':'บิ๊กซี ติวานนท์',
  '5077':'เทอมินัล โคราช','5080':'โลตัส แกลง ระยอง','5082':'มาเก็ตเพลส วงศ์สว่างเซ็นเตอร์',
  '5084':'เทอมินัล 21 พระราม 3','5085':'ICS ไอคอนสยาม','5087':'ศูนย์การประชุมแห่งชาติสิริกิติ์',
  '5088':'สยาม สแควร์','5090':'S Oasis','5091':'ปตท.เกษรนวมินทร์',
  '5504':'โลตัสวังหิน','5505':'โลตัสเลียบคลองสอง','5508':'รพ.วชิระพยาบาล',
  '5509':'โลตัส นครอินทร์',
  '4001':'แฟชั่น ไอซ์แลนด์','4005':'ซีคอน บางแค',
  '4007':'ซีคอน ศรีนครินทร์','4008':'เซ็นทรัล ศาลายา',
  '4015':'เดอะมอลล์ ท่าพระ','4018':'เทอมินัล 21 พระราม 3'
};

var FH_EXTRA_BRANDS = [];   // แบรนด์ที่ admin เพิ่มเอง: [{prefix,label}]
function getBranchPrefix(code) {
  if (!code) return '';
  code = String(code);
  for (var i = 0; i < FH_EXTRA_BRANDS.length; i++) {
    var b = FH_EXTRA_BRANDS[i];
    if (b && b.prefix && code.indexOf(String(b.prefix)) === 0) return b.label || '';
  }
  if (code.indexOf('55') === 0) return 'Santa Fe Easy';
  if (code.indexOf('50') === 0) return 'Santa Fe';
  if (code.indexOf('40') === 0) return 'เจ๊แดง จุ่มนัวร์';
  return '';
}
function getBranchFullName(code) {
  var prefix = getBranchPrefix(code);
  var name = BRANCHES[code] || '';
  return prefix ? (prefix + ' ' + name) : name;
}

/* ─── แสดงสาขาแบบเดียวกับใน PDF: "รหัส ชื่อ" (ตัด Santa Fe / Santa Fe Easy · เก็บเจ๊แดง) ─── */
var _brCodeByNameG = {};
var _brCodeByKeyG = {};   // key ที่ normalize แล้ว → รหัส (ทนสะกดต่าง เช่น S Oasis / S-Oasis)
function _rebuildBranchCodeMaps() {
  _brCodeByNameG = {}; _brCodeByKeyG = {};
  Object.keys(BRANCHES).forEach(function(c){
    var full = getBranchFullName(c);
    _brCodeByNameG[full] = c;
    _brCodeByKeyG[_branchKey(full)] = c;
  });
}
try { _rebuildBranchCodeMaps(); } catch(e) {}

/* หารหัสสาขาจากชื่อ — ชื่อตรง → normalize → ตัวเลขที่ติดมาในชื่อ (คืน '' ถ้าไม่รู้จัก) */
function _branchCodeOf(name) {
  if (!name || name === '—') return '';
  if (_brCodeByNameG[name]) return _brCodeByNameG[name];
  var k = _branchKey(name);
  if (_brCodeByKeyG[k]) return _brCodeByKeyG[k];
  var m = String(name).match(/(\d{3,})/);
  return (m && BRANCHES[m[1]]) ? m[1] : '';
}
function _brStripBrandG(s){ return String(s || '').replace(/^(Santa Fe Easy|Santa Fe)\s+/i, ''); }
function _brDispG(name){
  name = String(name || '');
  var c = _brCodeByNameG[name];
  return (c ? (c + ' ') : '') + _brStripBrandG(name);
}

/* ─── ประเภท/แบรนด์ของคำขออบรม: ซานตาเฟ่ / เจ๊แดง / Head Office ─── */
function _brandTypeFromCode(code) {
  code = String(code || '');
  if (code.indexOf('40') === 0) return _normBrandType(getBranchFullName(code)) || 'เจ๊แดง';
  if (code.indexOf('50') === 0 || code.indexOf('55') === 0) return 'ซานตาเฟ่';
  var p = getBranchPrefix(code); if (p) return p;   // แบรนด์ที่เพิ่มเอง → ใช้ label ของ prefix
  return '';
}
// ทำให้ค่า brand ที่เก็บ/นำเข้า เป็น 1 ใน 3 ประเภทมาตรฐาน
function _normBrandType(b) {
  b = String(b || '');
  if (/จุ่มนัวร์/i.test(b)) return 'เจ๊แดง จุ่มนัวร์';
  if (/เจ๊?\s*แดง|jaedaeng|^40/i.test(b)) return 'เจ๊แดง';
  if (/head\s*office|สำนักงานใหญ่|สนญ|ออฟฟิศ|\bho\b|\bhq\b/i.test(b)) return 'Head Office';
  if (/ซานตา|santa|เฟ่|^5[05]/i.test(b)) return 'ซานตาเฟ่';
  return b ? b : '';
}
// แบรนด์ ณ ตอนสาขา login (จากรหัส) — ใช้เก็บลง record ตอนส่ง
function _currentBrandType() {
  var code = branchPin || '';
  if (!code && currentBranchName) {
    for (var k in BRANCHES) { if (BRANCHES[k] === currentBranchName) { code = k; break; } }
  }
  return _brandTypeFromCode(code);
}
// รหัสสาขาจากชื่อ (reverse lookup, best-effort — ใช้กับ record เก่าที่ยังไม่มี brand)
function _codeFromBranchName(name) {
  name = String(name || '').trim();
  if (!name) return '';
  for (var k in BRANCHES) { if (BRANCHES[k] === name) return k; }
  return '';
}
// ประเภทของ request: ใช้ field brand ที่เก็บไว้ก่อน · ไม่มีค่อยเดาจากชื่อสาขา
function _reqBrandType(r) {
  var name = String(r.branch || r['สาขา'] || '');
  // resolve เป็นชื่อเต็ม (มี prefix แบรนด์) ก่อน เพราะชื่อที่เก็บเป็นชื่อสั้น
  var code = _codeFromBranchName(name);
  var full = code ? getBranchFullName(code) : name;
  // เจ๊แดง: แยกตามชื่อเต็ม — มี "จุ่มนัวร์" = เจ๊แดง จุ่มนัวร์, ที่เหลือ = เจ๊แดง
  if (/จุ่มนัวร์/i.test(full)) return 'เจ๊แดง จุ่มนัวร์';
  if (/เจ๊?\s*แดง|jaedaeng/i.test(full)) return 'เจ๊แดง';
  if (/สำนักงานใหญ่|head\s*office|สนญ|ออฟฟิศ|\bho\b|\bhq\b/i.test(full)) return 'Head Office';
  // ทางสำรอง: ใช้ field brand ที่เก็บไว้ แล้วค่อยเดาจากรหัส
  var stored = _normBrandType(r.brand || r['แบรนด์'] || r['ประเภท'] || '');
  if (stored) return stored;
  var t = _brandTypeFromCode(code);
  return t || 'ซานตาเฟ่';
}
var selectedRole = 'branch';
var branchPin = '';
var currentBranchName = '';
var allRecords = [];
var requestRows = [];

/* ─── Detail modal (popup ดูข้อมูลเต็ม รองรับทั้ง cert + request) ─── */
function closeDetailModal() {
  var m = document.getElementById('detailModal');
  if (m) m.classList.remove('show');
}
function _openDetailModal(opts) {
  document.getElementById('detailModalTitle').innerHTML = opts.title || '📄 รายละเอียด';
  document.getElementById('detailModalSubtitle').innerHTML = opts.subtitle || '';
  document.getElementById('detailModalContent').innerHTML = (opts.items || [])
    .map(function(it){
      if (it.section) return '<div class="detail-section-label">'+escapeHtml(it.section)+'</div>';
      return '<div class="detail-row">'
        + '<div class="detail-label">'+escapeHtml(it.label)+'</div>'
        + '<div class="detail-value">'+(it.html != null ? it.html : escapeHtml(it.value || '—'))+'</div>'
        + '</div>';
    }).join('');
  document.getElementById('detailModal').classList.add('show');
}
function openCertDetailModal(no) {
  if (typeof matchData === 'undefined') return;
  var d = matchData.find(function(r){ return r.no === no; });
  if (!d) return;
  _openDetailModal({
    title: '📜 รายละเอียดใบรับรอง',
    subtitle: 'ลำดับที่ ' + d.no + ' · จับคู่จาก PDF กับทะเบียนพนักงาน',
    items: [
      { section: 'ใบรับรอง' },
      { label: 'ชื่อในใบรับรอง', value: d.certName },
      { label: 'หลักสูตร',       value: d.course },
      { label: 'วันอบรม',         value: formatThaiDate(d.trainDate) },
      { label: 'วันหมดอายุ',      value: formatThaiDate(d.expireDate) },
      { label: 'สถานะใบรับรอง', html: getExpBadge(d.expStatus) },
      { section: 'พนักงาน' },
      { label: 'ชื่อในระบบ',      value: d.empName || '—' },
      { label: 'สาขา / หน่วยงาน', value: d.branch },
      { label: 'ตำแหน่ง',         value: d.position },
      { label: 'Sheet',           html: getSheetTag(d.sheet) },
      { label: 'สถานะจับคู่',     html: getMatchBadge(d.matchType) },
    ],
  });
}
function openReqDetailModal(keyDataStr) {
  var keyData;
  try { keyData = JSON.parse(decodeURIComponent(keyDataStr)); } catch(e) { return; }
  var rec = (_adminRowCache || []).find(function(r){
    return String(r._rowIndex || r.rowIndex || '') === String(keyData.rowIndex)
        && String(r.idCard || r['เลขบัตรประชาชน'] || r['เลขบัตร'] || '') === String(keyData.idCard);
  });
  if (!rec) return;
  var p = _prepReqFields(rec);
  _openDetailModal({
    title: '📋 รายละเอียดคำขออบรม',
    subtitle: '',
    items: [
      { section: 'พนักงาน' },
      { label: 'ชื่อ-นามสกุล',    value: p.name },
      { label: 'รหัสพนักงาน',     value: p.empId || '—' },
      { label: 'เลขบัตรประชาชน', value: p.idCard || '—' },
      { label: 'ตำแหน่ง',         value: p.pos },
      { label: 'สาขา',            value: p.branch },
      { section: 'อบรม' },
      { label: 'หลักสูตร',         value: p.course },
      { label: 'วันอบรม',          value: formatThaiDate(p.trainDate) || '—' },
      { label: 'รอบ',              value: p.slot || '—' },
      { label: 'ใบรับรอง',         html: certBadgeHtml(p.name, _adminCertIdx) },
      { section: 'การส่ง' },
      { label: 'วันที่ส่ง',         value: p.tsFmt },
      { label: 'หมายเหตุ',         value: p.note || '—' },
    ],
  });
}

/* ─── Sidebar collapsibles (นำเข้าข้อมูล / ออกรายงาน sub-menus) ─── */
function _admToggleCollapse(name) {
  var el = document.querySelector('.adm-side-collapsible[data-coll="'+name+'"]');
  if (el) el.classList.toggle('open');
}

/* ─── Mobile sidebar toggle ─── */
/* ═══════════ เมนูข้างฝั่งสาขา — กลไกเดียวกับ showAdmSection ═══════════
   ใช้ id ขึ้นต้น adm-sec- เพื่อให้ CSS ชุดเดียวกันคุมการซ่อน/แสดง (.active) */
var BR_SECTION_META = {
  'adm-sec-br-search':  { icon: '📜', title: 'ค้นหาใบรับรอง' },
  'adm-sec-br-submit':  { icon: '📋', title: 'ส่งรายชื่ออบรม' },
  'adm-sec-br-history': { icon: '📂', title: 'รายชื่อที่ส่งอบรม' }
};
function showBrSection(targetId) {
  if (!BR_SECTION_META[targetId]) targetId = 'adm-sec-br-search';
  document.querySelectorAll('#branchView .admin-main > [id^="adm-sec-br-"]').forEach(function(sec){
    sec.classList.toggle('active', sec.id === targetId);
  });
  document.querySelectorAll('#branchView .adm-side-link[data-target]').forEach(function(l){
    l.classList.toggle('active', l.getAttribute('data-target') === targetId);
  });
  var meta = BR_SECTION_META[targetId];
  var iEl = document.getElementById('admMobileSectionIcon');
  var tEl = document.getElementById('admMobileSectionText');
  if (iEl && meta) iEl.textContent = meta.icon;
  if (tEl && meta) tEl.textContent = meta.title;
  if (typeof _closeAdmMobileSidebar === 'function') _closeAdmMobileSidebar();
  window.scrollTo(0, 0);
}
var _brSidebarInited = false;
function _initBranchSidebar() {
  if (!_brSidebarInited) {
    document.querySelectorAll('#branchView .adm-side-link[data-target]').forEach(function(link){
      link.addEventListener('click', function(){ showBrSection(link.getAttribute('data-target')); });
    });
    _brSidebarInited = true;
  }
  // ชื่อสาขาในกล่องผู้ใช้ (มุมบนของ sidebar)
  // แบรนด์ขึ้นบรรทัดแรก · ชื่อสาขา + (สาขา) บรรทัดถัดไป
  // เดิมยัดบรรทัดเดียวแล้วตัดคำมั่ว เช่น "Santa Fe แฟชั่น / ไอส์ / แลนด์ (สาขา)"
  var nameEl = document.getElementById('brUserName');
  if (nameEl) {
    var full = String(currentBranchName || 'สาขา').trim();
    var brand = '';
    try { brand = getBranchPrefix(branchPin) || ''; } catch (e) {}
    var rest = (brand && full.indexOf(brand) === 0) ? full.slice(brand.length).trim() : full;
    if (!rest) { rest = brand; brand = ''; }   // มีแค่ชื่อเดียว → ไม่ต้องแยกบรรทัด
    nameEl.innerHTML =
      (brand ? '<span class="br-badge-brand">' + escapeHtml(brand) + '</span>' : '') +
      '<span class="br-badge-name">' + escapeHtml(rest) + '</span>';
  }
  showBrSection('adm-sec-br-search');
}

/* sidebar ของ view ที่กำลังแสดง — สาขาใช้ #branchSidebar, admin ใช้ #adminSidebar */
function _activeSidebar_() {
  var bv = document.getElementById('branchView');
  if (bv && bv.style.display !== 'none') return document.getElementById('branchSidebar');
  return document.getElementById('adminSidebar');
}
function _toggleAdmMobileSidebar() {
  var sb = _activeSidebar_();
  var bd = document.getElementById('admMobileBackdrop');
  if (!sb || !bd) return;
  var open = sb.classList.toggle('open');
  bd.classList.toggle('show', open);
  document.body.classList.toggle('adm-side-open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
function _closeAdmMobileSidebar() {
  var sb = _activeSidebar_();
  var bd = document.getElementById('admMobileBackdrop');
  if (sb) sb.classList.remove('open');
  if (bd) bd.classList.remove('show');
  document.body.classList.remove('adm-side-open');
  document.body.style.overflow = '';
}
/* Sync section title in mobile top bar + active state on bottom tabs */
var ADM_SECTION_META = {
  'adm-sec-cert':     { icon: '📜', title: 'ข้อมูลใบรับรอง' },
  'adm-sec-requests': { icon: '📋', title: 'คำขออบรม' },
  'adm-sec-import':   { icon: '📥', title: 'นำเข้าข้อมูล' }
};
function _updateMobileSectionLabel(targetId) {
  var meta = ADM_SECTION_META[targetId];
  if (!meta) return;
  var iEl = document.getElementById('admMobileSectionIcon');
  var tEl = document.getElementById('admMobileSectionText');
  if (iEl) iEl.textContent = meta.icon;
  if (tEl) tEl.textContent = meta.title;
  // Sync bottom tabs active state
  document.querySelectorAll('.adm-tab[data-target]').forEach(function(t){
    t.classList.toggle('active', t.getAttribute('data-target') === targetId);
  });
}

/* Auto-close sidebar when nav item clicked (on mobile) */
document.addEventListener('click', function(e){
  if (window.innerWidth > 700) return;
  if (e.target.closest('.adm-side-link[data-target]')) {
    setTimeout(_closeAdmMobileSidebar, 100);
  }
});

/* ─── Generic Import Modal — kind: 'cert' (PDF) | 'registry' (Excel employees) ─── */
var IMP_KIND_CONFIG = {
  cert: {
    title: '📄 นำเข้าข้อมูลใบรับรอง',
    subtitle: 'อัปโหลดไฟล์ <b>PDF ใบรับรอง</b>อบรม (ไม่จำกัดจำนวน) · ระบบจะอ่านข้อมูลและจับคู่กับทะเบียนพนักงาน',
    accept: '.pdf',
    multiple: true,
    hint: 'รองรับ: <b>PDF</b> เท่านั้น · ไม่จำกัดจำนวนไฟล์',
    iconLabel: '📄',
    typeLabel: 'ใบรับรอง'
  },
  registry: {
    title: '👥 นำเข้ารายชื่อพนักงาน',
    subtitle: 'อัปโหลด <b>Excel ทะเบียนพนักงาน</b> ได้หลายไฟล์ · รองรับหลาย Sheet (JD, ST, Easy, OP) · ระบบรวม+ตัดซ้ำให้อัตโนมัติ',
    accept: '.xlsx,.xls,.csv',
    multiple: true,
    hint: 'รองรับ: <b>.xlsx / .xls / .csv</b> · เลือกได้หลายไฟล์ (สูงสุด 20)',
    iconLabel: '📊',
    typeLabel: 'ทะเบียน'
  }
};
var _impKind = 'cert';
var _impQueue = [];

function openImportModal(kind) {
  var cfg = IMP_KIND_CONFIG[kind];
  if (!cfg) return;
  _impKind = kind;
  _impQueue = [];
  document.getElementById('impModalTitle').innerHTML = cfg.title;
  document.getElementById('impModalSubtitle').innerHTML = cfg.subtitle;
  document.getElementById('impHint').innerHTML = cfg.hint;
  var input = document.getElementById('impFilesInput');
  input.setAttribute('accept', cfg.accept);
  if (cfg.multiple) input.setAttribute('multiple', ''); else input.removeAttribute('multiple');
  input.value = '';
  document.getElementById('impFileList').innerHTML = '';
  var _impBtn = document.getElementById('impUploadBtn');
  _impBtn.disabled = true;
  _impBtn.innerHTML = '⬆ Upload';
  _impBtn.onclick = impDoUpload;  // reset onclick (อาจถูกเปลี่ยนเป็น closeImportComboModal ตอนเสร็จ)
  document.getElementById('importComboModal').classList.add('show');
}

/* Legacy entry point — keep for compatibility but route to new generic modal (PDF default) */
function openImportComboModal() { openImportModal('cert'); }

function closeImportComboModal() {
  document.getElementById('importComboModal').classList.remove('show');
  _impQueue = [];
}

function impDragOver(e) {
  e.preventDefault();
  document.getElementById('impDropZone').classList.add('drag');
}
function impDragLeave() {
  document.getElementById('impDropZone').classList.remove('drag');
}
function impDrop(e) {
  e.preventDefault();
  document.getElementById('impDropZone').classList.remove('drag');
  impStageFiles(e.dataTransfer.files);
}
function impHandleInput(input) {
  impStageFiles(input.files);
  input.value = '';
}

function impStageFiles(files) {
  if (!files || !files.length) return;
  var cfg = IMP_KIND_CONFIG[_impKind];
  var allowed = cfg.accept.split(',').map(function(s){ return s.trim().toLowerCase(); });
  Array.from(files).forEach(function(f){
    var ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (allowed.indexOf(ext) < 0) return; // skip wrong type silently
    if (!cfg.multiple) {
      // Single-file mode: replace any previous file
      _impQueue = [];
      document.getElementById('impFileList').innerHTML = '';
    }
    _impQueue.push(f);
    impAddFileItem(f);
  });
  document.getElementById('impUploadBtn').disabled = _impQueue.length === 0;
}

function _impKey(file) {
  return (file.name + '_' + file.size).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function impAddFileItem(file) {
  var list = document.getElementById('impFileList');
  if (!list) return;
  var cfg = IMP_KIND_CONFIG[_impKind];
  var sizeKB = file.size / 1024;
  var sizeStr = sizeKB >= 1024 ? (sizeKB/1024).toFixed(1)+' MB' : Math.round(sizeKB)+' KB';
  var key = _impKey(file);
  var item = document.createElement('div');
  item.className = 'imp-file-item';
  item.setAttribute('data-key', key);
  item.innerHTML = '<div class="imp-file-icon">'+cfg.iconLabel+'</div>'
    + '<div class="imp-file-info">'
    +   '<div class="imp-file-name">'+escapeHtml(file.name)+'</div>'
    +   '<div class="imp-file-meta">'+sizeStr+'</div>'
    + '</div>'
    + '<button class="imp-file-remove" onclick="impRemoveFile(\''+key+'\')" title="ลบไฟล์">✕</button>'
    + '<div class="imp-file-status pending">รอ Upload</div>';
  list.appendChild(item);
}

function impRemoveFile(key) {
  _impQueue = _impQueue.filter(function(f){ return _impKey(f) !== key; });
  var el = document.querySelector('#impFileList [data-key="'+key+'"]');
  if (el) el.remove();
  document.getElementById('impUploadBtn').disabled = _impQueue.length === 0;
}

function impUpdateFileStatus(files, status) {
  var list = document.getElementById('impFileList');
  if (!list) return;
  Array.from(files).forEach(function(f){
    var el = list.querySelector('[data-key="'+_impKey(f)+'"] .imp-file-status');
    if (!el) return;
    el.className = 'imp-file-status ' + status;
    el.textContent = status === 'processing' ? 'กำลังประมวลผล...' :
                     status === 'done'       ? '✓ Completed' :
                     status === 'error'      ? '✗ Failed' :
                                               'รอ Upload';
  });
  // Hide remove button when processing/done
  Array.from(files).forEach(function(f){
    var rm = list.querySelector('[data-key="'+_impKey(f)+'"] .imp-file-remove');
    if (rm && status !== 'pending') rm.style.display = 'none';
  });
}

function impDoUpload() {
  if (_impQueue.length === 0) return;
  var btn = document.getElementById('impUploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> กำลังประมวลผล...';
  impUpdateFileStatus(_impQueue, 'processing');
  try {
    if (_impKind === 'cert') {
      var dt = new DataTransfer();
      _impQueue.forEach(function(f){ dt.items.add(f); });
      processPDFFiles(dt.files);
      _impWatchStatus('pdfStatusText', _impQueue.slice());
    } else if (_impKind === 'registry') {
      processXLSXFiles(_impQueue.slice());
      _impWatchStatus('xlsxStatusText', _impQueue.slice());
    }
  } catch (e) {
    impUpdateFileStatus(_impQueue, 'error');
    btn.innerHTML = '⬆ Upload';
    btn.disabled = false;
  }
}

function _impWatchStatus(statusElId, files) {
  var statusEl = document.getElementById(statusElId);
  var btn = document.getElementById('impUploadBtn');
  if (!statusEl) {
    setTimeout(function(){
      impUpdateFileStatus(files, 'done');
      if (btn) { btn.innerHTML = '✓ เสร็จสิ้น'; btn.disabled = false; btn.onclick = closeImportComboModal; }
    }, 700);
    return;
  }
  var prevText = statusEl.textContent;
  var ticks = 0;
  var interval = setInterval(function(){
    ticks++;
    var txt = statusEl.textContent || '';
    var isDone = /สำเร็จ|พบ\s*\d|ทะเบียน|✓|ตัด|matched/i.test(txt);
    var isError = /error|ผิดพลาด|ล้มเหลว|fail|✗/i.test(txt);
    if (isError) {
      clearInterval(interval);
      impUpdateFileStatus(files, 'error');
      if (btn) { btn.innerHTML = '✗ ลองอีกครั้ง'; btn.disabled = false; }
    } else if (isDone || (txt !== prevText && ticks > 6)) {
      clearInterval(interval);
      impUpdateFileStatus(files, 'done');
      if (btn) { btn.innerHTML = '✓ เสร็จสิ้น'; btn.disabled = false; btn.onclick = closeImportComboModal; }
    } else if (ticks > 80) {
      clearInterval(interval);
      impUpdateFileStatus(files, 'done');
      if (btn) { btn.innerHTML = '✓ เสร็จสิ้น'; btn.disabled = false; btn.onclick = closeImportComboModal; }
    }
  }, 250);
}

/* ─── Admin sidebar: SPA-style section switcher ─── */
var _admSidebarInited = false;
var ADM_SEC_KEY = 'fab_admin_section';
var ADM_DEFAULT_SEC = 'adm-sec-cert';

function showAdmSection(targetId) {
  /* กันเข้าหน้าที่ไม่มีสิทธิ์ — ดักที่นี่จุดเดียวคุมได้ทุกทาง:
     กดเมนู · กู้หน้าที่ค้างไว้จาก sessionStorage · หรือคนที่ปลดซ่อนปุ่มเองผ่าน devtools
     สำคัญเป็นพิเศษกับ adm-sec-settings เพราะข้างในมีตัวแก้สิทธิ์อยู่ */
  try {
    if (typeof FH_SECTION_ACTION !== 'undefined' && FH_SECTION_ACTION[targetId]
        && typeof fhCan === 'function' && !fhCan(FH_SECTION_ACTION[targetId])) {
      targetId = _fhFirstAllowedSection() || '';   // เด้งไปหน้าแรกที่ "มีสิทธิ์จริง" ไม่ใช่ default ดื้อๆ
      if (!targetId) { _fhShowNoAccess(); return; }
    }
  } catch (e) {}
  var na = document.getElementById('fhNoAccess'); if (na) na.style.display = 'none';
  // Toggle section visibility
  var sections = document.querySelectorAll('.admin-main > [id^="adm-sec-"]');
  sections.forEach(function(s){
    s.classList.toggle('active', s.id === targetId);
  });
  // Toggle nav active state
  var links = document.querySelectorAll('.adm-side-link[data-target]');
  links.forEach(function(l){
    l.classList.toggle('active', l.getAttribute('data-target') === targetId);
  });
  // Sync mobile section label
  if (typeof _updateMobileSectionLabel === 'function') _updateMobileSectionLabel(targetId);
  // Sync ปุ่ม "ใบรับรอง" ในแถบล่างมือถือ
  if (typeof fhSyncTabbar === 'function') fhSyncTabbar();
  // เปิดหน้าทะเบียน → แสดงจาก cache ทันที แล้วดึงของใหม่เบื้องหลัง
  if (targetId === 'adm-sec-registry') {
    if (typeof empData !== 'undefined' && empData && empData.length) { try { renderRegistryTable(); } catch(e) {} }
    else {
      var _ec = _fhCacheGet('fh_emp_v1');
      if (_ec && _ec.length) { empData = _ec; try { renderRegistryTable(); } catch(e){} }
      try { _reloadRegistry(); } catch(e) {}
    }
  }
  // Persist + scroll to top
  try { sessionStorage.setItem(ADM_SEC_KEY, targetId); } catch(e) {}
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ═══════════ แถบล่างมือถือ: ปุ่มกลาง "ใบรับรอง" ═══════════
   แอดมิน → ฐานข้อมูลใบรับรอง (adm-sec-cert) · สาขา → ค้นหาใบรับรอง (adm-sec-br-search) */
function fhCertSectionId() {
  var isAdmin = document.body.classList.contains('is-admin');
  var first  = isAdmin ? 'adm-sec-cert' : 'adm-sec-br-search';
  var second = isAdmin ? 'adm-sec-br-search' : 'adm-sec-cert';
  var el = document.getElementById(first);
  // ต้องมีทั้ง section และปุ่มเมนูข้างที่ชี้ไปหน้านั้น (ฝั่งสาขาไม่มี adm-sec-cert)
  if (el && document.querySelector('.adm-side-link[data-target="' + first + '"]')) return first;
  return document.getElementById(second) ? second : first;
}
function fhGoCerts() {
  if (typeof _closeAdmMobileSidebar === 'function') _closeAdmMobileSidebar();
  if (typeof showAdmSection === 'function') showAdmSection(fhCertSectionId());
}
/* ไฮไลต์เมื่ออยู่หน้าใบรับรอง + ซ่อนปุ่มถ้าไม่มีสิทธิ์เข้าหน้านั้น */
function fhSyncTabbar() {
  var btn = document.getElementById('mtbCerts');
  if (!btn) return;
  var id = fhCertSectionId();
  var allowed = true;
  try {
    var act = (typeof FH_SECTION_ACTION !== 'undefined') ? FH_SECTION_ACTION[id] : null;
    if (act && typeof fhCan === 'function') allowed = fhCan(act);
  } catch (e) {}
  btn.style.display = allowed ? '' : 'none';
  var sec = document.getElementById(id);
  btn.classList.toggle('active', !!(sec && sec.classList.contains('active')));
}

function _initAdminSidebar() {
  if (_admSidebarInited) return;
  var links = document.querySelectorAll('.adm-side-link[data-target]');
  if (!links.length) return;
  links.forEach(function(link){
    link.addEventListener('click', function(){
      var targetId = link.getAttribute('data-target');
      if (targetId) showAdmSection(targetId);
    });
  });
  // Restore last viewed section — must have BOTH a section element AND a nav button
  var initial = (typeof _fhFirstAllowedSection === 'function' ? _fhFirstAllowedSection() : '') || ADM_DEFAULT_SEC;
  try {
    var saved = sessionStorage.getItem(ADM_SEC_KEY);
    if (saved
        && document.getElementById(saved)
        && document.querySelector('.adm-side-link[data-target="'+saved+'"]')) {
      initial = saved;   // showAdmSection จะกันเองถ้าไม่มีสิทธิ์กับหน้าที่ค้างไว้
    }
  } catch(e) {}
  showAdmSection(initial);
  _admSidebarInited = true;
}

// Toggle which topbar is visible based on which view is active (normal scrolling)
// NOTE: admin topbar is permanently hidden — the new sidebar replaces it (menu/logout in sidebar footer)
function _updateTopbarVisibility() {
  var aBar = document.getElementById('adminTopbar');
  var bBar = document.getElementById('branchTopbar');
  var aView = document.getElementById('adminView');
  var bView = document.getElementById('branchView');
  var bVisible = bView && getComputedStyle(bView).display !== 'none';
  // ทั้งสองฝั่งใช้ sidebar แทน topbar แล้ว → ซ่อนทั้งคู่
  if (aBar) aBar.style.display = 'none';
  if (bBar) bBar.style.display = 'none';
  void bVisible;
  void aView; // referenced for future re-enable if needed
}

/* ═══════════ สิทธิ์การใช้ปุ่ม (role เป็นค่าตั้งต้น + ยกเว้นรายคนได้) ═══════════ */

var FH_ROLE_LABEL = { admin:'Admin', coo:'COO', vp:'VP', bzm:'BZM', branch:'สาขา' };

/* ผู้ใช้ที่ล็อกอินอยู่ — อ่านจาก fab_session ที่ Hub เขียนไว้ (localStorage, TTL 8 ชม.) */
var FH_USER = { code:'', name:'', nick:'', role:'' };
function _loadFhUser() {
  try {
    var s = JSON.parse(localStorage.getItem('fab_session') || '{}');
    FH_USER = {
      code: String(s.code || ''),
      name: s.name || '',
      nick: s.nick || '',
      role: s.role || sessionStorage.getItem('fab_role') || ''
    };
  } catch (e) {
    FH_USER = { code:'', name:'', nick:'', role: sessionStorage.getItem('fab_role') || '' };
  }
  return FH_USER;
}

/* ปุ่มที่คุมสิทธิ์ได้ — id ต้องตรงกับ data-fh-action ใน HTML
   roles = ตำแหน่งที่เห็นปุ่มนี้เป็นค่าตั้งต้น (แก้ได้ในหน้าจัดการสิทธิ์) */
var FH_ACTION_GROUPS = [
  { id:'menu',   label:'เมนูหลัก · เข้าหน้าไหนได้บ้าง' },
  { id:'import',  label:'นำเข้า / จัดการข้อมูล' },
  { id:'export',  label:'ออกรายงาน' },
  { id:'danger',  label:'ลบข้อมูล — ทำแล้วกู้คืนไม่ได้' },
  { id:'branch',  label:'ฝั่งสาขา' }
];
var FH_ACTIONS = [
  // ── เมนูหลัก ──
  { id:'view-certs',      group:'menu',   label:'ข้อมูลใบรับรอง',        roles:['admin','coo','vp','bzm'], danger:false },
  { id:'view-requests',   group:'menu',   label:'คำขออบรม',              roles:['admin','coo','vp','bzm'], danger:false },
  { id:'view-registry',   group:'menu',   label:'ทะเบียนรายชื่อ',        roles:['admin','coo','vp','bzm'], danger:false },
  { id:'settings',        group:'menu',   label:'ตั้งค่า (รวมหน้าสิทธิ์นี้)', roles:['admin'],           danger:true  },
  // ── นำเข้า / จัดการข้อมูล ──
  { id:'upload-registry', group:'import', label:'อัปทะเบียนพนักงาน',     roles:['admin'],                  danger:false },
  { id:'upload-cert',     group:'import', label:'อัปโหลดใบรับรอง PDF',   roles:['admin'],                  danger:false },
  { id:'match-data',      group:'import', label:'จับคู่ข้อมูล',           roles:['admin'],                  danger:false },
  { id:'import-reqs',     group:'import', label:'นำเข้าคำขออบรม',        roles:['admin'],                  danger:false },
  // ── ออกรายงาน ──
  { id:'export-pdf',      group:'export', label:'รายงาน PDF',            roles:['admin','coo','vp'],       danger:false },
  { id:'export-excel',    group:'export', label:'Excel (แบบฟอร์มขออบรม)', roles:['admin','coo','vp'],      danger:false },
  { id:'export-csv',      group:'export', label:'CSV (สำรองทะเบียน)',    roles:['admin','coo','vp'],       danger:false },
  // ── ลบข้อมูล ──
  { id:'dedup-certs',     group:'danger', label:'ลบใบรับรองที่ซ้ำ',      roles:['admin'],                  danger:true  },
  { id:'clear-certs',     group:'danger', label:'ลบใบรับรองทั้งหมด',     roles:['admin'],                  danger:true  },
  { id:'clear-reqs',      group:'danger', label:'ลบคำขออบรมทั้งหมด',     roles:['admin'],                  danger:true  },
  // ── ฝั่งสาขา ──
  { id:'submit-request',  group:'branch', label:'ส่งรายชื่อขออบรม',      roles:['branch'],                 danger:false }
];

/* สิทธิ์: { actionId: { roles:[...], allow:[code...], deny:[code...] } }
   allow/deny = ยกเว้นรายคน (deny ชนะทุกอย่าง) */
var FH_PERMS = {};
var FH_PERMS_KEY = 'fh_perms_v1';

function _fhDefaultPerms() {
  var o = {};
  FH_ACTIONS.forEach(function(a){ o[a.id] = { roles: a.roles.slice(), allow: [], deny: [] }; });
  return o;
}
function _normalizeFhPerms(p) {
  var out = _fhDefaultPerms();
  if (p && typeof p === 'object') {
    FH_ACTIONS.forEach(function(a){
      var src = p[a.id];
      if (!src) return;
      out[a.id] = {
        roles: Array.isArray(src.roles) ? src.roles.slice() : a.roles.slice(),
        allow: Array.isArray(src.allow) ? src.allow.map(String) : [],
        deny:  Array.isArray(src.deny)  ? src.deny.map(String)  : []
      };
    });
  }
  return out;
}
function loadFhPermsLocal() {
  try { FH_PERMS = _normalizeFhPerms(JSON.parse(localStorage.getItem(FH_PERMS_KEY) || 'null')); }
  catch (e) { FH_PERMS = _fhDefaultPerms(); }
  return FH_PERMS;
}
function saveFhPermsLocal() {
  try { localStorage.setItem(FH_PERMS_KEY, JSON.stringify(FH_PERMS)); } catch (e) {}
}

/* เช็คสิทธิ์ของผู้ใช้ปัจจุบัน — ลำดับ: deny รายคน > allow รายคน > ตำแหน่ง */
function fhCan(actionId) {
  var p = FH_PERMS[actionId];
  if (!p) return true;                                   // ไม่ได้กำหนด = ไม่คุม
  var code = String(FH_USER.code || '');
  if (code && p.deny.indexOf(code) >= 0) return false;    // ห้ามรายคน ชนะเสมอ
  if (code && p.allow.indexOf(code) >= 0) return true;    // อนุญาตรายคน แม้ตำแหน่งไม่ผ่าน
  return p.roles.indexOf(FH_USER.role) >= 0;
}

/* ซ่อน/แสดงปุ่มตามสิทธิ์ — เรียกซ้ำได้ทุกครั้งที่เรนเดอร์ใหม่ */
/* ── สิทธิ์จากศูนย์กลาง (HUB ⚙️ → สิทธิ์ปุ่มแต่ละระบบ) ──
   HUB ชนะ Firestore เสมอ · ถ้า HUB ยังไม่เคยตั้ง → ใช้ของเดิมใน Firestore ต่อ (ไม่มีอะไรหาย) */
var FH_PERMS_FROM_HUB = false;
function loadFhPermsFromHub() {
  return fetch(SCRIPT_URL + '?action=config&_=' + Date.now())
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.ok && res.perms && res.perms.foodhandler) {
        FH_PERMS = _normalizeFhPerms(res.perms.foodhandler);
        FH_PERMS_FROM_HUB = true;
        saveFhPermsLocal();
        applyFhPerms();
        console.log('[perms] ใช้สิทธิ์จาก HUB');
      } else {
        console.log('[perms] HUB ยังไม่ตั้งสิทธิ์ผู้สัมผัสอาหาร — ใช้ค่าเดิมจาก Firestore');
      }
    })
    .catch(function(e){ console.warn('[perms] โหลดจาก HUB ไม่ได้ — ใช้ค่าเดิม', e); });
}

function applyFhPerms() {
  document.querySelectorAll('[data-fh-action]').forEach(function(el){
    var id = el.getAttribute('data-fh-action');
    el.style.display = fhCan(id) ? '' : 'none';
  });
  /* กลุ่มเมนูที่ลูกโดนซ่อนหมด → ซ่อนทั้งกลุ่ม (รวมหัวข้อ/เส้นคั่น)
     ไม่งั้นกดหัวข้อแล้วกางออกมาว่างเปล่า ผู้ใช้จะนึกว่า "ปุ่มกดไม่ได้" */
  document.querySelectorAll('.adm-side-collapsible, .adm-side-group').forEach(function(grp){
    var kids = grp.querySelectorAll('[data-fh-action]');
    if (!kids.length) return;   // กลุ่มที่ไม่ได้คุมสิทธิ์ ปล่อยไว้
    var anyVisible = Array.prototype.some.call(kids, function(k){ return k.style.display !== 'none'; });
    grp.style.display = anyVisible ? '' : 'none';
  });

  // ถ้ากำลังเปิดหน้าที่เพิ่งโดนตัดสิทธิ์อยู่ → เด้งกลับหน้าเริ่มต้น
  var cur = document.querySelector('.admin-main > [id^="adm-sec-"].active');
  if (cur && FH_SECTION_ACTION[cur.id] && !fhCan(FH_SECTION_ACTION[cur.id])) {
    if (typeof showAdmSection === 'function') showAdmSection(ADM_DEFAULT_SEC);
  }
}

/* หน้าที่ต้องมีสิทธิ์ถึงเข้าได้ — กันทั้งกดจากเมนู, กู้หน้าเดิมจาก session, และคนที่ปลดซ่อนปุ่มเอง */
var FH_SECTION_ACTION = {
  'adm-sec-cert':     'view-certs',
  'adm-sec-requests': 'view-requests',
  'adm-sec-registry': 'view-registry',
  'adm-sec-settings': 'settings'
};

/* หน้าแรกที่ผู้ใช้คนนี้เข้าได้จริง — ใช้แทน ADM_DEFAULT_SEC เวลาโดนตีกลับ
   สำคัญ: default คือ adm-sec-cert ซึ่งก็คุมสิทธิ์ด้วย ถ้าคนนั้นไม่มีสิทธิ์เห็น
   การเด้งไป default ดื้อๆ = พาเข้าหน้าที่ไม่ควรเห็น · คืน '' ถ้าไม่มีสิทธิ์เลยสักหน้า */
function _fhFirstAllowedSection() {
  var order = ['adm-sec-cert','adm-sec-requests','adm-sec-registry','adm-sec-settings'];
  for (var i = 0; i < order.length; i++) {
    var a = FH_SECTION_ACTION[order[i]];
    if (!a || fhCan(a)) return order[i];
  }
  return '';
}

/* ไม่มีสิทธิ์เข้าหน้าไหนเลย → บอกให้ชัด ดีกว่าปล่อยจอว่างแล้วผู้ใช้นึกว่าระบบพัง */
function _fhShowNoAccess() {
  document.querySelectorAll('.admin-main > [id^="adm-sec-"]').forEach(function(s){ s.classList.remove('active'); });
  document.querySelectorAll('.adm-side-link[data-target]').forEach(function(l){ l.classList.remove('active'); });
  var box = document.getElementById('fhNoAccess');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fhNoAccess';
    box.style.cssText = 'padding:48px 24px;text-align:center;color:var(--text3);';
    box.innerHTML = '<div style="font-size:40px;margin-bottom:12px;">🔒</div>' +
      '<div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:6px;">ยังไม่ได้รับสิทธิ์ใช้งานส่วนนี้</div>' +
      '<div style="font-size:13px;">กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์</div>';
    var main = document.querySelector('.admin-main');
    if (main) main.appendChild(box);
  }
  box.style.display = '';
}

/* ─────────── หน้าจัดการสิทธิ์ (admin) ─────────── */
var FH_PERM_ROLES = ['admin','coo','vp','bzm','branch'];

/* รายชื่อผู้ใช้ — Hub เขียนไว้ที่ localStorage.fab_users_v1 ตอนล็อกอิน */
var FH_USERS = [];
function loadFhUsers() {
  try {
    var a = JSON.parse(localStorage.getItem('fab_users_v1') || '[]');
    FH_USERS = Array.isArray(a) ? a : [];
  } catch (e) { FH_USERS = []; }
  return FH_USERS;
}
function _fhUserLabel(u) {
  return (u.nick ? u.nick + ' · ' : '') + (u.name || u.code) + ' (' + (FH_ROLE_LABEL[u.role] || u.role) + ')';
}

function renderFhPermsEditor() {
  var box = document.getElementById('fhPermsEditor');
  if (!box) return;
  loadFhUsers();
  var html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">' +
    '<thead><tr>' +
      '<th style="text-align:left;padding:8px 10px;border-bottom:2px solid var(--border);white-space:nowrap;">ปุ่ม</th>' +
      FH_PERM_ROLES.map(function(r){
        return '<th style="padding:8px 6px;border-bottom:2px solid var(--border);white-space:nowrap;">' + FH_ROLE_LABEL[r] + '</th>';
      }).join('') +
      '<th style="padding:8px 6px;border-bottom:2px solid var(--border);"></th>' +
    '</tr></thead><tbody>';

  var _lastGroup = null;
  FH_ACTIONS.forEach(function(a){
    // หัวข้อหมวด — คั่นให้เห็นว่าปุ่มไหนอยู่กลุ่มไหน
    if (a.group !== _lastGroup) {
      _lastGroup = a.group;
      var g = FH_ACTION_GROUPS.filter(function(x){ return x.id === a.group; })[0];
      var isDanger = a.group === 'danger';
      html += '<tr><td colspan="' + (FH_PERM_ROLES.length + 2) + '" ' +
        'style="padding:14px 10px 6px;font-size:11.5px;font-weight:800;letter-spacing:.4px;' +
        'color:' + (isDanger ? '#b91c1c' : 'var(--text3)') + ';text-transform:uppercase;">' +
        escapeHtml((g && g.label) || a.group) + '</td></tr>';
    }
    var p = FH_PERMS[a.id] || { roles:[], allow:[], deny:[] };
    var nEx = (p.allow.length + p.deny.length);
    html += '<tr>' +
      '<td style="padding:9px 10px 9px 22px;border-bottom:1px solid var(--border);font-weight:600;">' +
        escapeHtml(a.label) +
        // ป้ายเตือนเฉพาะของอันตรายที่อยู่นอกหมวด "ลบข้อมูล" (ในหมวดนั้นหัวข้อบอกอยู่แล้ว)
        ((a.danger && a.group !== 'danger')
          ? ' <span style="font-size:10px;font-weight:800;color:#b91c1c;background:rgba(220,38,38,0.10);padding:1px 6px;border-radius:6px;">ระวัง</span>' : '') +
      '</td>';
    FH_PERM_ROLES.forEach(function(r){
      var on = p.roles.indexOf(r) >= 0;
      html += '<td style="padding:9px 6px;border-bottom:1px solid var(--border);text-align:center;">' +
        '<input type="checkbox"' + (on ? ' checked' : '') +
        ' onchange="toggleFhPermRole(\'' + a.id + '\',\'' + r + '\',this.checked)" style="width:16px;height:16px;cursor:pointer;"></td>';
    });
    html += '<td style="padding:9px 6px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">' +
      '<button class="cleanup-btn" style="font-size:11.5px;padding:4px 9px;" onclick="toggleFhPermUsersRow(\'' + a.id + '\')">' +
      'ยกเว้นรายคน' + (nEx ? ' (' + nEx + ')' : '') + '</button></td></tr>';

    // แถวยกเว้นรายคน (ซ่อนไว้ก่อน)
    html += '<tr id="fhPermUsers-' + a.id + '" style="display:none;"><td colspan="' + (FH_PERM_ROLES.length + 2) + '" ' +
      'style="padding:10px 12px;background:var(--surface-2,#f8fafc);border-bottom:1px solid var(--border);">';
    if (!FH_USERS.length) {
      html += '<div style="font-size:12px;color:var(--text3);">ยังไม่มีรายชื่อผู้ใช้ในเครื่องนี้ — เข้าผ่านหน้า Hub หนึ่งครั้งเพื่อโหลดรายชื่อ</div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;">';
      FH_USERS.forEach(function(u){
        var code = String(u.code || '');
        var mode = p.deny.indexOf(code) >= 0 ? 'deny' : (p.allow.indexOf(code) >= 0 ? 'allow' : 'default');
        var byRole = p.roles.indexOf(u.role) >= 0;
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 8px;background:#fff;border:1px solid var(--border);border-radius:7px;">' +
          '<span style="font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(_fhUserLabel(u)) + '</span>' +
          '<span style="display:flex;gap:3px;flex-shrink:0;">' +
            _fhModeBtn(a.id, code, 'default', mode, byRole ? 'ตามตำแหน่ง: เห็น' : 'ตามตำแหน่ง: ไม่เห็น') +
            _fhModeBtn(a.id, code, 'allow', mode, 'อนุญาตเฉพาะคนนี้') +
            _fhModeBtn(a.id, code, 'deny', mode, 'ห้ามเฉพาะคนนี้') +
          '</span></div>';
      });
      html += '</div>';
    }
    html += '</td></tr>';
  });

  html += '</tbody></table></div>';
  box.innerHTML = html;
}

function _fhModeBtn(actionId, code, mode, current, title) {
  var on = current === mode;
  var txt = mode === 'default' ? 'ปกติ' : (mode === 'allow' ? 'อนุญาต' : 'ห้าม');
  var col = mode === 'allow' ? '#16a34a' : (mode === 'deny' ? '#dc2626' : '#64748b');
  return '<button title="' + escapeAttr(title) + '" onclick="setFhPermUser(\'' + actionId + '\',\'' + code + '\',\'' + mode + '\')" ' +
    'style="font-size:10.5px;font-weight:700;padding:3px 7px;border-radius:5px;cursor:pointer;' +
    (on ? 'background:' + col + ';color:#fff;border:1px solid ' + col + ';' : 'background:#fff;color:' + col + ';border:1px solid var(--border);') +
    '">' + txt + '</button>';
}

function toggleFhPermUsersRow(actionId) {
  var r = document.getElementById('fhPermUsers-' + actionId);
  if (r) r.style.display = (r.style.display === 'none' ? '' : 'none');
}
function toggleFhPermRole(actionId, role, on) {
  var p = FH_PERMS[actionId]; if (!p) return;
  var i = p.roles.indexOf(role);
  if (on && i < 0) p.roles.push(role);
  if (!on && i >= 0) p.roles.splice(i, 1);
}
function setFhPermUser(actionId, code, mode) {
  var p = FH_PERMS[actionId]; if (!p) return;
  p.allow = p.allow.filter(function(c){ return c !== code; });
  p.deny  = p.deny.filter(function(c){ return c !== code; });
  if (mode === 'allow') p.allow.push(code);
  if (mode === 'deny')  p.deny.push(code);
  renderFhPermsEditor();
  var r = document.getElementById('fhPermUsers-' + actionId);
  if (r) r.style.display = '';   // เปิดแถวเดิมค้างไว้หลังเรนเดอร์ใหม่
}
function resetFhPerms() {
  customConfirm({
    icon: (typeof ICON_TRASH !== 'undefined' ? ICON_TRASH : ''),
    title: 'คืนค่าสิทธิ์เริ่มต้น?',
    desc: 'สิทธิ์ทุกปุ่มจะกลับเป็นค่าตั้งต้น และการยกเว้นรายคนทั้งหมดจะถูกล้าง',
    okText: 'คืนค่า', okIsPrimary: true
  }).then(function(ok){
    if (!ok) return;
    FH_PERMS = _fhDefaultPerms();
    renderFhPermsEditor();
    saveFhPerms();
  });
}
function saveFhPerms() {
  var btn = document.getElementById('fhPermsSaveBtn');
  var old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> กำลังบันทึก...'; }
  saveFhPermsLocal();
  saveFhConfig({ perms: FH_PERMS })
    .then(function(){
      applyFhConfigUI();   // เรียกตัวนี้ (ไม่ใช่ applyFhPerms ตรงๆ) เพราะปุ่มฝั่งสาขาต้องคิดร่วมกับสวิตช์รับรายชื่อ
      showInfo('บันทึกสิทธิ์แล้ว', 'สิทธิ์ปุ่มถูกอัปเดตทุกเครื่องแล้ว');
    })
    .catch(function(e){
      showInfo('บันทึกไม่สำเร็จ', escapeHtml(e.message || String(e)) + ' — สิทธิ์ถูกเก็บไว้ในเครื่องนี้ชั่วคราว');
    })
    .then(function(){ if (btn) { btn.disabled = false; btn.innerHTML = old; } });
}

window.addEventListener('DOMContentLoaded', function() {
  // Session handoff from Hub (../index.html)
  var role = sessionStorage.getItem('fab_role');
  if (!role) { window.location.href = '../index.html'; return; }
  _loadFhUser();
  loadFhPermsLocal();
  /* startFhConfigSync ผูก DOMContentLoaded ไว้ก่อนตัวนี้ → applyFhConfigUI อาจรันตอนที่ยัง
     ไม่รู้ว่าใครล็อกอิน (FH_USER ว่าง) จึงต้องคำนวณ UI ใหม่ทันทีที่ได้ user/สิทธิ์แล้ว
     สำคัญกับฝั่งสาขา เพราะปุ่มส่งรายชื่อขึ้นกับสิทธิ์ */
  try { applyFhConfigUI(); } catch (e) {}
  branchPin = sessionStorage.getItem('fab_branch_pin') || '';
  currentBranchName = sessionStorage.getItem('fab_branch_name') || '';
  isAdminMode = (role === 'admin');
  if (isAdminMode) {
    document.getElementById('adminView').style.display = 'flex';
    document.getElementById('branchView').style.display = 'none';
    document.body.classList.add('is-admin');
    _initAdminSidebar();
    // Sync user info in sidebar footer — ใช้ชื่อคนที่ล็อกอินจริงจาก fab_session (เดิมฮาร์ดโค้ด "Kantapon")
    // ยึด "ชื่อจริง" ให้ตรงมาตรฐานเดียวกับป็อปอัพต้อนรับของ HUB (user.name + role)
    // เดิมใช้ nick ก่อน → ระบบนี้ขึ้น "พี่กาย" ขณะที่ HUB/Checklist/Training ขึ้น "กันตภณ ลาภมงคลนาวิน"
    var adminName = (FH_USER.name || FH_USER.nick || 'Admin');
    var roleLabel = FH_ROLE_LABEL[FH_USER.role] || FH_USER.role || 'Admin';
    var roleEl = document.getElementById('admUserRole');
    if (roleEl) roleEl.innerHTML = '&nbsp;(' + escapeHtml(roleLabel) + ')';   // เดิมฮาร์ดโค้ด "(Admin)" ให้ทุกคน
    var nameEl = document.getElementById('admUserName');
    var avEl = document.getElementById('admUserAvatar');
    var mUserEl = document.getElementById('admMobileUser');
    var sUserNameEl = document.getElementById('admSheetUserName');
    var sUserAvEl = document.getElementById('admSheetUserAvatar');
    if (nameEl) nameEl.textContent = adminName;
    if (avEl) avEl.textContent = adminName.charAt(0).toUpperCase();
    if (mUserEl) mUserEl.textContent = adminName.charAt(0).toUpperCase();
    if (sUserNameEl) sUserNameEl.textContent = adminName;
    if (sUserAvEl) sUserAvEl.textContent = adminName.charAt(0).toUpperCase();
    var adminTag = document.getElementById('adminTag');
    var adminTagHtml = '<span class="branch-chip"><span class="branch-chip-name" style="color:var(--red)">' +
      escapeHtml(adminName) + ' (' + escapeHtml(roleLabel) + ')</span></span>';
    if (adminTag) adminTag.innerHTML = adminTagHtml;
    var adminTagInline = document.getElementById('adminTagInline');
    if (adminTagInline) adminTagInline.innerHTML = adminTagHtml;
    var mtbLabel = document.getElementById('mtbBranchLabel');
    if (mtbLabel) mtbLabel.textContent = roleLabel;   // แถบบนมือถือ — เดิมขึ้น "Admin" ให้ทุกคน
    applyFhPerms();   // ซ่อนปุ่มตามสิทธิ์ที่ cache ไว้ทันที — startFhConfigSync จะ sync ค่าล่าสุดมาทับเอง
    // Auto-load existing records from cloud
    setTimeout(loadFromCloud, 100);
    setTimeout(loadAdminRequests, 200);
    setTimeout(loadEmployeeRegistryFromCloud, 300);
    startRequestsPolling();
  } else {
    document.getElementById('branchView').style.display = 'block';
    document.getElementById('adminView').style.display = 'none';
    var tag = document.getElementById('branchTag');
    var tagHtml = '<span class="branch-chip"><span class="branch-chip-name">' + currentBranchName + '</span></span>';
    if (tag) tag.innerHTML = tagHtml;
    var branchTagInline = document.getElementById('branchTagInline');
    if (branchTagInline) branchTagInline.innerHTML = tagHtml;
    var mtbLabel2 = document.getElementById('mtbBranchLabel');
    if (mtbLabel2) mtbLabel2.textContent = currentBranchName || 'สาขา';
    requestRows = [];
    // ฝั่งสาขาใช้โครงเดียวกับ admin (sidebar + main) — is-branch เปิดแถบบนตอนจอมือถือ
    document.body.classList.add('is-branch');
    _initBranchSidebar();
    loadRecordsForSearch();
    setTimeout(loadMyRequests, 200);
    setTimeout(loadEmployeeRegistryFromCloud, 300);  // โหลด Employees registry มาเป็น source ของ dropdown ชื่อ-นามสกุล
    startRequestsPolling();
  }
  setTimeout(function(){ if (typeof updateStepper === 'function') updateStepper(); }, 50);
  _updateTopbarVisibility();
});

function selectRole(role) {
  selectedRole = role;
  document.querySelectorAll('.role-tab').forEach(function(t){ t.classList.remove('active'); });
  var activeTab = document.querySelector('.role-tab[data-role="'+role+'"]');
  if (activeTab) activeTab.classList.add('active');
  renderPinBoxes();
  hideError();
}

function renderPinBoxes() {
  var count = selectedRole === 'admin' ? 6 : 4;
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<input class="pin-box" type="password" maxlength="1" inputmode="numeric" autocomplete="off" data-i="'+i+'">';
  }
  document.getElementById('pinBoxes').innerHTML = html;
  setupPinBoxes();
  setTimeout(function(){
    var first = document.querySelector('.pin-box');
    if (first) first.focus();
  }, 50);
}

function setupPinBoxes() {
  var boxes = document.querySelectorAll('.pin-box');
  boxes.forEach(function(box, i){
    box.addEventListener('input', function(e){
      var v = e.target.value.replace(/\D/g,'').slice(0,1);
      e.target.value = v;
      if (v) e.target.classList.add('filled'); else e.target.classList.remove('filled');
      if (v && i < boxes.length-1) boxes[i+1].focus();
      hideError();
      if (getPinValue().length === boxes.length) {
        // auto-submit when all filled
        setTimeout(doLogin, 100);
      }
    });
    box.addEventListener('keydown', function(e){
      if (e.key === 'Backspace' && !e.target.value && i > 0) {
        boxes[i-1].focus();
        boxes[i-1].value = '';
        boxes[i-1].classList.remove('filled');
        e.preventDefault();
      }
      if (e.key === 'Enter') doLogin();
    });
    box.addEventListener('paste', function(e){
      e.preventDefault();
      var data = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'');
      for (var j = 0; j < boxes.length; j++) {
        if (data[j]) {
          boxes[j].value = data[j];
          boxes[j].classList.add('filled');
        }
      }
      var lastFilled = Math.min(data.length, boxes.length);
      if (lastFilled > 0) boxes[Math.min(lastFilled, boxes.length-1)].focus();
    });
  });
}

function getPinValue() {
  return Array.from(document.querySelectorAll('.pin-box')).map(function(b){return b.value;}).join('');
}

function showError(msg) {
  var el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.opacity = '1';
}
function hideError() { document.getElementById('loginError').textContent = ''; }

function doLogin() {
  var pin = getPinValue();
  var required = selectedRole === 'admin' ? 6 : 4;
  if (pin.length < required) {
    showError('กรุณากรอกรหัสให้ครบ '+required+' หลัก');
    return;
  }
  if (selectedRole === 'admin') {
    if (pin !== ADMIN_CODE) {
      showError('รหัสผ่าน Admin ไม่ถูกต้อง');
      clearPin();
      return;
    }
    enterApp('admin');
  } else {
    if (!BRANCHES[pin]) {
      showError('ไม่พบรหัสสาขา ' + pin + ' ในระบบ');
      clearPin();
      return;
    }
    branchPin = pin;
    currentBranchName = BRANCHES[pin];
    enterApp('branch');
  }
}

function clearPin() {
  document.querySelectorAll('.pin-box').forEach(function(b){
    b.value = ''; b.classList.remove('filled');
  });
  var first = document.querySelector('.pin-box');
  if (first) first.focus();
}

function enterApp(role) {
  var loginCard = document.querySelector('#loginView .login-card');
  var loginView = document.getElementById('loginView');
  if (loginCard) loginCard.classList.add('exiting');
  if (loginView) loginView.classList.add('fading-out');
  setTimeout(function(){
    loginView.style.display = 'none';
    if (loginCard) loginCard.classList.remove('exiting');
    loginView.classList.remove('fading-out');
    isAdminMode = (role === 'admin');
    showMenuView();
    showWelcome(isAdminMode ? 'Admin · Team Management' : currentBranchName);
  }, 450);
}

function showMenuView() {
  var mv = document.getElementById('menuView');
  mv.style.display = 'block';
  mv.classList.add('view-active');
  setTimeout(function(){ mv.classList.remove('view-active'); }, 600);
  document.getElementById('adminView').style.display = 'none';
  document.getElementById('branchView').style.display = 'none';
  var tag = document.getElementById('menuBranchTag');
  if (tag) {
    if (isAdminMode) {
      tag.innerHTML = '<span class="admin-badge"><svg><use href="#i-shield"/></svg>ADMIN · TEAM MANAGEMENT</span>';
    } else {
      tag.innerHTML = '<span class="branch-chip"><span class="branch-chip-name">' + currentBranchName + '</span></span>';
    }
  }
  document.body.classList.toggle('is-admin', isAdminMode);
  renderMenuCards();
  // Refresh from cloud on view enter
  loadSystemsFromCloud().then(function(){ renderMenuCards(); });
  window.scrollTo(0,0);
}

function goToBranchApp() {
  if (isAdminMode) {
    // Admin clicks ระบบฐานข้อมูล → go to adminView (PDF/Excel processing)
    document.getElementById('menuView').style.display = 'none';
    var av = document.getElementById('adminView');
    av.style.display = 'block';
    av.classList.add('view-active');
    setTimeout(function(){ av.classList.remove('view-active'); }, 600);
    window.scrollTo(0,0);
    return;
  }
  // Branch user → branchView (search + request submit)
  document.getElementById('menuView').style.display = 'none';
  var bv = document.getElementById('branchView');
  bv.style.display = 'block';
  bv.classList.add('view-active');
  setTimeout(function(){ bv.classList.remove('view-active'); }, 600);
  var tag = document.getElementById('branchTag');
  if (tag) tag.innerHTML = '<span class="branch-chip"><span class="branch-chip-name">' + currentBranchName + '</span></span>';
  if (!allRecords.length) loadRecordsForSearch();
  if (requestRows.length === 0) addRequestRow();
  window.scrollTo(0,0);
}

function goToMenu() {
  window.location.href = '../index.html';
}

/* ═════════════════════ ADMIN MODALS (STUB) ═════════════════════ */
var EMOJI_LIST = [
  '📋','📊','📁','📄','📑','📈','📉','🗂️','📌','📎','🔖','📔','📓','📕','📗','📘','📙','📒',
  '🍱','🍔','🍕','🥗','🍝','🍜','🍣','☕','🍰','🍩','🥖','🥐','🍚','🍞','🥟','🍡',
  '👥','👤','🤝','💼','👨‍💼','👩‍💼','🧑‍🍳','👮','👷',
  '🏢','🏪','🏬','🏨','🏦','🏠','🏛️','🏗️',
  '🛒','💰','💳','💵','💎','📦','🚚','🛍️','💴',
  '⚙️','🔧','🔨','🛠️','📐','📏','🔬','🔭','🧰',
  '⏰','📅','🗓️','📆','⏳','⌛',
  '🔔','📢','📣','📞','📧','✉️','💬',
  '✅','❌','⚠️','ℹ️','❓','❗','⭐','🎯',
  '🎓','🏆','🎖️','🥇','🏅','🎁','🎉',
  '🔑','🗝️','🔒','🔓','🛡️','🔐',
  '📱','💻','🖥️','🖨️','💾','💿','📺','📷'
];
var currentEditingSystem = null;
var SYSTEMS = [];
var ANNOUNCEMENTS = [];
var currentEditingAnnouncement = null;
var DEFAULT_SYSTEMS = [{
  id: 'food-handler',
  emoji: '📋',
  name: 'ฐานข้อมูล ผู้สัมผัสและผู้ประกอบอาหาร',
  desc: 'ค้นหาข้อมูลใบรับรอง + ส่งรายชื่อขออบรม',
  url: '',
  visibleBranches: [],  // [] = visible to all
  startDate: '',
  endDate: '',
  builtIn: true
}];

function loadSystemsLocal() {
  try {
    var saved = localStorage.getItem('fab_systems_v1');
    if (saved) {
      SYSTEMS = JSON.parse(saved);
      if (!SYSTEMS.find(function(s){ return s.id === 'food-handler'; })) {
        SYSTEMS.unshift(DEFAULT_SYSTEMS[0]);
      }
    }
  } catch(e) {}
  if (!SYSTEMS || !SYSTEMS.length) SYSTEMS = DEFAULT_SYSTEMS.slice();
  SYSTEMS.forEach(normalizeSystem);
}
function saveSystemsLocal() {
  try { localStorage.setItem('fab_systems_v1', JSON.stringify(SYSTEMS)); } catch(e) {}
}

function loadSystemsFromCloud() {
  return fetch(SCRIPT_URL + '?action=systems', { method: 'GET' })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.ok && res.systems) {
        var localById = {};
        SYSTEMS.forEach(function(s){ localById[s.id] = s; });
        var hasBuiltIn = res.systems.some(function(s){ return s.id === 'food-handler'; });
        SYSTEMS = res.systems.map(function(s){
          // Preserve local icon if cloud version doesn't have one (handles old Apps Script without icon column)
          if (!s.icon && localById[s.id] && localById[s.id].icon) s.icon = localById[s.id].icon;
          return s;
        });
        if (!hasBuiltIn) SYSTEMS.unshift(DEFAULT_SYSTEMS[0]);
        SYSTEMS.sort(function(a,b){ return (b.builtIn?1:0) - (a.builtIn?1:0); });
        SYSTEMS.forEach(normalizeSystem);
        saveSystemsLocal();
      }
      return SYSTEMS;
    })
    .catch(function(err){
      console.warn('Cloud load systems failed, using local cache', err);
      return SYSTEMS;
    });
}

function saveSystemsToCloud() {
  return fetch(SCRIPT_URL, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'systems-save', systems: SYSTEMS })
  })
  .then(function(r){ return r.json(); })
  .then(function(res){
    if (!res.ok) throw new Error(res.error || 'save failed');
    return res;
  });
}

function normalizeAnnouncement(a) {
  a.startDate = toIsoString(a.startDate);
  a.endDate = toIsoString(a.endDate);
  if (!a.visibleBranches) a.visibleBranches = [];
  return a;
}
function loadAnnouncementsLocal() {
  try {
    var saved = localStorage.getItem('fab_announcements_v1');
    if (saved) ANNOUNCEMENTS = JSON.parse(saved);
  } catch(e) {}
  if (!ANNOUNCEMENTS) ANNOUNCEMENTS = [];
  ANNOUNCEMENTS.forEach(normalizeAnnouncement);
}
function saveAnnouncementsLocal() {
  try { localStorage.setItem('fab_announcements_v1', JSON.stringify(ANNOUNCEMENTS)); } catch(e) {}
}
function loadAnnouncementsFromCloud() {
  return fetch(SCRIPT_URL + '?action=announcements', { method: 'GET' })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.ok && res.announcements) {
        ANNOUNCEMENTS = res.announcements;
        ANNOUNCEMENTS.forEach(normalizeAnnouncement);
        saveAnnouncementsLocal();
      }
      return ANNOUNCEMENTS;
    })
    .catch(function(err){ console.warn('Cloud load announcements failed', err); return ANNOUNCEMENTS; });
}
function saveAnnouncementsToCloud() {
  return fetch(SCRIPT_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'announcements-save', announcements: ANNOUNCEMENTS })
  })
  .then(function(r){ return r.json(); })
  .then(function(res){ if (!res.ok) throw new Error(res.error || 'save failed'); return res; });
}
function getDismissedToday() {
  try { return JSON.parse(localStorage.getItem('fab_ann_dismissed') || '{}'); }
  catch(e) { return {}; }
}
function dismissAnnouncementToday(id) {
  var d = getDismissedToday();
  d[id] = todayIso();
  try { localStorage.setItem('fab_ann_dismissed', JSON.stringify(d)); } catch(e) {}
}
function getActiveAnnouncementsForBranch(branchCode) {
  var today = todayIso();
  var dismissed = getDismissedToday();
  return ANNOUNCEMENTS.filter(function(a){
    if (dismissed[a.id] === today) return false;
    if (a.visibleBranches && a.visibleBranches.length > 0 && a.visibleBranches.indexOf(branchCode) < 0) return false;
    if (a.startDate && today < a.startDate) return false;
    if (a.endDate && today > a.endDate) return false;
    return true;
  });
}

function setSyncStatus(text, color) {
  var el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = color || 'var(--text3)';
  if (text && color && /green/.test(color)) {
    setTimeout(function(){ if (el.textContent === text) el.textContent = ''; }, 4000);
  }
}

function todayIso() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function toIsoString(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return v.getFullYear() + '-' + String(v.getMonth()+1).padStart(2,'0') + '-' + String(v.getDate()).padStart(2,'0');
  }
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  return '';
}
/* (Duplicate definition kept for back-compat — delegates to the robust version above) */
function formatSystemDate(v) {
  var iso = toIsoString(v);
  if (!iso) return '';
  return formatThaiDate(iso);
}
function normalizeSystem(s) {
  s.startDate = toIsoString(s.startDate);
  s.endDate = toIsoString(s.endDate);
  if (!s.visibleBranches) s.visibleBranches = [];
  return s;
}

function isSystemVisibleToBranch(s, branchCode) {
  if (s.visibleBranches && s.visibleBranches.length > 0 && s.visibleBranches.indexOf(branchCode) < 0) return false;
  var today = todayIso();
  if (s.startDate && today < s.startDate) return false;
  if (s.endDate && today > s.endDate) return false;
  return true;
}

function renderMenuCards() {
  var grid = document.getElementById('menuGrid');
  if (!grid) return;
  var html = '';
  SYSTEMS.forEach(function(s){
    var visible = isAdminMode || isSystemVisibleToBranch(s, branchPin);
    if (!visible) return;
    var notStarted = s.startDate && todayIso() < s.startDate;
    var isComingSoon = !s.builtIn;  // admin-added systems = announcements only
    var iconHtml = s.icon
      ? '<div class="menu-card-icon"><img src="'+s.icon+'" alt=""></div>'
      : '<div class="menu-card-icon menu-card-icon-emoji">'+(s.emoji||'📋')+'</div>';
    var clickHandler = isComingSoon
      ? 'event.stopPropagation();showComingSoon(\''+s.id+'\')'
      : 'openSystem(\''+s.id+'\')';
    html += '<div class="menu-card'+(isComingSoon?' menu-card-preview':'')+'" role="button" tabindex="0" onclick="'+clickHandler+'">';
    html += '<div class="menu-card-top">';
    html += iconHtml;
    html += '<div class="menu-card-body">';
    html += '<div class="menu-card-title">'+escapeHtml(s.name)+'</div>';
    html += '<div class="menu-card-desc">'+escapeHtml(s.desc)+'</div>';
    html += '</div>';
    if (isAdminMode) {
      html += '<button class="menu-card-settings" onclick="event.stopPropagation();openEditSystemModal(\''+s.id+'\')" title="ตั้งค่าระบบนี้"><svg><use href="#i-settings"/></svg></button>';
    }
    html += '</div>';
    html += '<div class="menu-card-foot">';
    if (isComingSoon) {
      html += '<span class="coming-soon-badge">เร็วๆ นี้</span>';
    } else if (s.endDate) {
      html += '<span class="menu-card-expire"><svg><use href="#i-calendar"/></svg>หมดเวลา '+formatThaiDate(s.endDate)+'</span>';
    } else if (s.startDate && notStarted) {
      html += '<span class="menu-card-expire"><svg><use href="#i-calendar"/></svg>เริ่ม '+formatThaiDate(s.startDate)+'</span>';
    } else {
      html += '<span></span>';
    }
    html += '<span class="menu-card-arrow"><svg><use href="#'+(isComingSoon?'i-calendar':'i-arrow-right')+'"/></svg></span>';
    html += '</div>';
    html += '</div>';
  });
  if (isAdminMode) {
    html += '<div class="menu-card menu-card-add" role="button" tabindex="0" onclick="openAddSystemModal()">'
      + '<div class="menu-card-top">'
      + '<div class="menu-card-icon menu-card-icon-add"><svg><use href="#i-plus"/></svg></div>'
      + '<div class="menu-card-body">'
      + '<div class="menu-card-title">ประกาศระบบใหม่</div>'
      + '<div class="menu-card-desc">สร้างการ์ด "เร็วๆ นี้" ให้สาขาเห็นว่ามีระบบใหม่กำลังจะมา</div>'
      + '</div>'
      + '</div>'
      + '<div class="menu-card-foot"><span></span><span class="menu-card-arrow"><svg><use href="#i-plus"/></svg></span></div>'
      + '</div>';
  }
  if (!html) html = '<div class="empty-state" style="grid-column:1/-1;background:rgba(255,255,255,0.7);border-radius:18px;padding:60px 20px;">ยังไม่มีระบบที่ใช้งานได้สำหรับสาขานี้</div>';
  grid.innerHTML = html;
}

function showComingSoon(systemId) {
  var s = SYSTEMS.find(function(x){ return x.id === systemId; });
  if (!s) return;
  alert('"' + s.name + '"\nระบบนี้กำลังจะเปิดให้ใช้งานในเร็วๆ นี้ — โปรดติดตาม');
}

function openSystem(systemId) {
  var s = SYSTEMS.find(function(x){ return x.id === systemId; });
  if (!s) return;
  if (s.url) { window.open(s.url, '_blank'); return; }
  // Internal route
  if (systemId === 'food-handler') {
    goToBranchApp();
  }
}

function renderEmojiPicker() {
  var picker = document.getElementById('emojiPicker');
  if (!picker) return;
  picker.innerHTML = EMOJI_LIST.map(function(e){
    return '<button type="button" class="emoji-btn" onclick="selectEmoji(this,\''+e+'\')">'+e+'</button>';
  }).join('');
}
function selectEmoji(btn, e) {
  document.querySelectorAll('#emojiPicker .emoji-btn').forEach(function(b){ b.classList.remove('selected'); });
  btn.classList.add('selected');
  document.getElementById('sysEmojiPreview').textContent = e;
}

function openSystemModal(mode, systemId) {
  currentEditingSystem = systemId || null;
  var isEdit = mode === 'edit';
  document.getElementById('systemModalTitle').textContent = isEdit ? 'ตั้งค่าประกาศระบบ' : 'ประกาศระบบใหม่ (เร็วๆ นี้)';
  document.querySelectorAll('.adm-edit-only').forEach(function(el){ el.style.display = isEdit ? '' : 'none'; });

  var s = isEdit ? SYSTEMS.find(function(x){ return x.id === systemId; }) : null;
  if (s) {
    document.getElementById('sysName').value = s.name;
    document.getElementById('sysDesc').value = s.desc;
    document.getElementById('sysStartDate').value = s.startDate || '';
    document.getElementById('sysEndDate').value = s.endDate || '';
    if (s.icon) showIconPreview(s.icon); else removeIcon();
    populateBranchVisibility(s.visibleBranches || []);
    var delBtn = document.getElementById('deleteSystemBtn');
    if (delBtn) delBtn.style.display = s.builtIn ? 'none' : '';
  } else {
    document.getElementById('sysName').value = '';
    document.getElementById('sysDesc').value = '';
    document.getElementById('sysStartDate').value = '';
    document.getElementById('sysEndDate').value = '';
    removeIcon();
  }
  document.getElementById('systemModal').classList.add('show');
}

function handleIconUpload(file) {
  if (!file || !/^image\//.test(file.type)) { alert('กรุณาเลือกไฟล์รูปภาพ'); return; }
  if (file.size > 2 * 1024 * 1024) { alert('ไฟล์ใหญ่เกินไป (จำกัด 2 MB)'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var size = 128;
      canvas.width = size; canvas.height = size;
      var ctx = canvas.getContext('2d');
      var ratio = Math.min(size / img.width, size / img.height);
      var w = img.width * ratio, h = img.height * ratio;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      var dataUrl = canvas.toDataURL('image/png');
      showIconPreview(dataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function showIconPreview(dataUrl) {
  var p = document.getElementById('sysIconPreview');
  p.src = dataUrl; p.style.display = 'block';
  document.getElementById('sysIconPlaceholder').style.display = 'none';
  document.getElementById('sysIconRemove').style.display = 'inline-block';
}
function removeIcon() {
  var p = document.getElementById('sysIconPreview');
  if (p) { p.src = ''; p.style.display = 'none'; }
  var ph = document.getElementById('sysIconPlaceholder');
  if (ph) ph.style.display = '';
  var rm = document.getElementById('sysIconRemove');
  if (rm) rm.style.display = 'none';
  var f = document.getElementById('sysIconFile');
  if (f) f.value = '';
}

function populateBranchVisibility(selectedBranches) {
  selectedBranches = selectedBranches || [];
  var tbody = document.getElementById('settingsBranchTbody');
  if (!tbody) return;
  var allChecked = selectedBranches.length === 0;
  var html = '';
  Object.keys(BRANCHES).forEach(function(code){
    var checked = allChecked || selectedBranches.indexOf(code) >= 0;
    html += '<tr><td style="font-weight:700;color:var(--gold);font-size:12px;">'+code+'</td><td>'+BRANCHES[code]+'</td><td style="text-align:center;"><input type="checkbox" class="adm-checkbox branch-vis-chk" data-code="'+code+'"'+(checked?' checked':'')+'></td></tr>';
  });
  tbody.innerHTML = html;
}
function toggleAllBranches(checked) {
  document.querySelectorAll('.branch-vis-chk').forEach(function(c){ c.checked = checked; });
}

function openEditSystemModal(systemId) { openSystemModal('edit', systemId); }
function openAddSystemModal() { openSystemModal('add'); }
function closeSystemModal() { document.getElementById('systemModal').classList.remove('show'); }

function saveSystemConfig() {
  var name = document.getElementById('sysName').value.trim();
  var desc = document.getElementById('sysDesc').value.trim();
  var startDate = document.getElementById('sysStartDate').value;
  var endDate = document.getElementById('sysEndDate').value;
  var iconEl = document.getElementById('sysIconPreview');
  var icon = (iconEl && iconEl.style.display !== 'none' && iconEl.src) ? iconEl.src : '';

  if (!name) { alert('กรุณากรอกชื่อระบบ'); return; }
  if (startDate && endDate && startDate > endDate) { alert('วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด'); return; }

  var visibleBranches = [];
  var anyChecked = false, allChecked = true;
  var chks = document.querySelectorAll('.branch-vis-chk');
  chks.forEach(function(c){
    if (c.checked) { visibleBranches.push(c.getAttribute('data-code')); anyChecked = true; }
    else allChecked = false;
  });
  if (chks.length > 0 && allChecked) visibleBranches = [];  // [] = visible to all
  if (chks.length > 0 && !anyChecked && currentEditingSystem) {
    if (!confirm('ยังไม่ได้เลือกสาขาใดเลย จะไม่มีสาขาเห็นระบบนี้ ยืนยัน?')) return;
  }

  if (currentEditingSystem) {
    var idx = SYSTEMS.findIndex(function(s){ return s.id === currentEditingSystem; });
    if (idx >= 0) {
      var existing = SYSTEMS[idx];
      SYSTEMS[idx] = {
        id: existing.id,
        icon: icon,
        emoji: existing.emoji || '',
        name: name,
        desc: desc,
        visibleBranches: visibleBranches,
        startDate: startDate,
        endDate: endDate,
        builtIn: existing.builtIn || false
      };
    }
  } else {
    SYSTEMS.push({
      id: 'sys-' + Date.now(),
      icon: icon,
      emoji: '',
      name: name,
      desc: desc,
      visibleBranches: [],
      startDate: '',
      endDate: ''
    });
  }
  saveSystemsLocal();
  renderMenuCards();
  closeSystemModal();
  setSyncStatus('กำลังซิงค์ Cloud...', 'var(--text2)');
  saveSystemsToCloud()
    .then(function(){ setSyncStatus('✓ ซิงค์ Cloud สำเร็จ · ' + new Date().toLocaleTimeString('th-TH'), 'var(--green)'); })
    .catch(function(err){ setSyncStatus('✗ ซิงค์ Cloud ไม่ได้: ' + err.message + ' (บันทึกในเครื่องแล้ว)', 'var(--red)'); });
}

function deleteSystem() {
  if (!currentEditingSystem) return;
  var s = SYSTEMS.find(function(x){ return x.id === currentEditingSystem; });
  if (s && s.builtIn) { alert('ไม่สามารถลบระบบหลักของ Hub ได้'); return; }
  customConfirm({ icon:ICON_TRASH, title:'ลบระบบ?', desc:'ลบ <strong>"'+(s?escapeHtml(s.name):'')+'"</strong> — ไม่สามารถกู้คืน', okText:'ลบเลย' })
    .then(function(ok){ if (ok) doDeleteSystem(); });
}
function doDeleteSystem() {
  var s = SYSTEMS.find(function(x){ return x.id === currentEditingSystem; });
  SYSTEMS = SYSTEMS.filter(function(x){ return x.id !== currentEditingSystem; });
  saveSystemsLocal();
  renderMenuCards();
  closeSystemModal();
  setSyncStatus('กำลังซิงค์ Cloud...', 'var(--text2)');
  saveSystemsToCloud()
    .then(function(){ setSyncStatus('✓ ลบและซิงค์ Cloud สำเร็จ', 'var(--green)'); })
    .catch(function(err){ setSyncStatus('✗ ซิงค์ Cloud ไม่ได้: ' + err.message, 'var(--red)'); });
}

function showWelcome(name) {
  document.getElementById('welcomeBranch').textContent = name;
  document.getElementById('welcomeModal').classList.add('show');
}
function closeWelcome() {
  document.getElementById('welcomeModal').classList.remove('show');
  if (!isAdminMode) {
    setTimeout(function(){ showBranchAnnouncementsModal(); }, 200);
  }
}

function showBranchAnnouncementsModal() {
  var list = getActiveAnnouncementsForBranch(branchPin);
  if (list.length === 0) return false;
  var listEl = document.getElementById('branchAnnouncementsList');
  var html = list.map(function(a){
    var iconHtml = a.icon
      ? '<img class="ann-icon-img" src="'+a.icon+'" alt="">'
      : '<span class="ann-icon-emoji">'+escapeHtml(a.emoji||'📢')+'</span>';
    return '<div class="ann-item" data-id="'+a.id+'">'
      + '<div class="ann-head">'+iconHtml+'<div class="ann-title">'+escapeHtml(a.title)+'</div></div>'
      + '<div class="ann-msg">'+escapeHtml(a.message)+'</div>'
      + (a.endDate ? '<div class="ann-expire">⏰ ถึง '+formatThaiDate(a.endDate)+'</div>' : '')
      + '<button class="ann-dismiss" onclick="dismissAnnClick(\''+a.id+'\', this)">ไม่แสดงในวันนี้อีก</button>'
      + '</div>';
  }).join('');
  listEl.innerHTML = html;
  document.getElementById('branchAnnouncementsModal').classList.add('show');
  return true;
}
function closeBranchAnnouncementsModal() {
  document.getElementById('branchAnnouncementsModal').classList.remove('show');
}
function dismissAnnClick(id, btn) {
  dismissAnnouncementToday(id);
  var item = btn.closest('.ann-item');
  if (item) {
    item.style.transition = 'opacity 0.3s, max-height 0.3s, padding 0.3s, margin 0.3s';
    item.style.opacity = '0';
    item.style.maxHeight = '0';
    item.style.padding = '0 16px';
    item.style.margin = '0';
    item.style.overflow = 'hidden';
    setTimeout(function(){
      item.remove();
      if (document.querySelectorAll('#branchAnnouncementsList .ann-item').length === 0) {
        closeBranchAnnouncementsModal();
      }
    }, 320);
  }
}

/* Admin manager */
function openManageAnnouncementsModal() {
  renderAnnouncementsList();
  document.getElementById('manageAnnouncementsModal').classList.add('show');
}
function closeManageAnnouncementsModal() {
  document.getElementById('manageAnnouncementsModal').classList.remove('show');
}
function renderAnnouncementsList() {
  var listEl = document.getElementById('adminAnnouncementsList');
  if (!ANNOUNCEMENTS.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:36px 20px;color:var(--text3);">ยังไม่มีประกาศ — กด "+ เพิ่มประกาศใหม่" ด้านล่างเพื่อสร้าง</div>';
    return;
  }
  listEl.innerHTML = ANNOUNCEMENTS.map(function(a){
    var iconHtml = a.icon
      ? '<img src="'+a.icon+'" style="width:36px;height:36px;border-radius:8px;object-fit:contain;">'
      : '<span style="font-size:24px;">'+escapeHtml(a.emoji||'📢')+'</span>';
    var period = (a.startDate||a.endDate)
      ? (a.startDate?formatThaiDate(a.startDate):'-')+' → '+(a.endDate?formatThaiDate(a.endDate):'-')
      : 'แสดงตลอด';
    var branchCount = a.visibleBranches && a.visibleBranches.length > 0 ? a.visibleBranches.length+' สาขา' : 'ทุกสาขา';
    var preview = (a.message||'').replace(/\n/g,' ').slice(0,80) + (a.message && a.message.length>80?'...':'');
    return '<div class="ann-row">'
      + '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">'+iconHtml
      + '<div style="flex:1;min-width:0;"><div style="font-weight:700;color:var(--text);">'+escapeHtml(a.title)+'</div>'
      + '<div style="font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escapeHtml(preview)+'</div>'
      + '<div style="font-size:11px;color:var(--text3);margin-top:4px;">📅 '+period+' · 🏪 '+branchCount+'</div></div></div>'
      + '<button class="adm-btn-secondary" style="padding:7px 14px;font-size:12px;flex-shrink:0;" onclick="openAnnouncementEditor(\''+a.id+'\')">แก้ไข</button>'
      + '</div>';
  }).join('');
}

function openAnnouncementEditor(id) {
  currentEditingAnnouncement = id || null;
  var a = id ? ANNOUNCEMENTS.find(function(x){return x.id===id;}) : null;
  document.getElementById('annEditorTitle').textContent = a ? 'แก้ไขประกาศ' : 'เพิ่มประกาศใหม่';
  document.getElementById('annEmoji').value = a ? (a.emoji||'📢') : '📢';
  document.getElementById('annTitle').value = a ? a.title : '';
  document.getElementById('annMessage').value = a ? a.message : '';
  document.getElementById('annStartDate').value = a ? (a.startDate||'') : '';
  document.getElementById('annEndDate').value = a ? (a.endDate||'') : '';
  document.getElementById('annDeleteBtn').style.display = a ? '' : 'none';
  populateAnnBranchVisibility(a ? a.visibleBranches : []);
  document.getElementById('announcementEditorModal').classList.add('show');
}
function closeAnnouncementEditor() {
  document.getElementById('announcementEditorModal').classList.remove('show');
}
function populateAnnBranchVisibility(selected) {
  selected = selected || [];
  var tbody = document.getElementById('annBranchTbody');
  if (!tbody) return;
  var allChecked = selected.length === 0;
  tbody.innerHTML = Object.keys(BRANCHES).map(function(code){
    var checked = allChecked || selected.indexOf(code) >= 0;
    return '<tr><td style="font-weight:700;color:var(--gold);font-size:12px;">'+code+'</td><td>'+BRANCHES[code]+'</td><td style="text-align:center;"><input type="checkbox" class="ann-vis-chk" data-code="'+code+'"'+(checked?' checked':'')+'></td></tr>';
  }).join('');
}
function toggleAllAnnBranches(checked) {
  document.querySelectorAll('.ann-vis-chk').forEach(function(c){ c.checked = checked; });
}

function saveAnnouncement() {
  var emoji = document.getElementById('annEmoji').value.trim() || '📢';
  var title = document.getElementById('annTitle').value.trim();
  var message = document.getElementById('annMessage').value.trim();
  var startDate = document.getElementById('annStartDate').value;
  var endDate = document.getElementById('annEndDate').value;
  if (!title) { alert('กรุณากรอกหัวเรื่อง'); return; }
  if (!message) { alert('กรุณากรอกรายละเอียด'); return; }
  if (startDate && endDate && startDate > endDate) { alert('วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด'); return; }

  var visibleBranches = [];
  var allChecked = true;
  var chks = document.querySelectorAll('.ann-vis-chk');
  chks.forEach(function(c){
    if (c.checked) visibleBranches.push(c.getAttribute('data-code'));
    else allChecked = false;
  });
  if (chks.length > 0 && allChecked) visibleBranches = [];

  if (currentEditingAnnouncement) {
    var idx = ANNOUNCEMENTS.findIndex(function(x){return x.id===currentEditingAnnouncement;});
    if (idx >= 0) {
      ANNOUNCEMENTS[idx] = {
        id: ANNOUNCEMENTS[idx].id,
        emoji: emoji,
        icon: ANNOUNCEMENTS[idx].icon || '',
        title: title, message: message,
        startDate: startDate, endDate: endDate,
        visibleBranches: visibleBranches
      };
    }
  } else {
    ANNOUNCEMENTS.push({
      id: 'ann-'+Date.now(),
      emoji: emoji, icon: '',
      title: title, message: message,
      startDate: startDate, endDate: endDate,
      visibleBranches: visibleBranches
    });
  }
  saveAnnouncementsLocal();
  closeAnnouncementEditor();
  renderAnnouncementsList();
  setSyncStatus('กำลังซิงค์ Cloud...', 'var(--text2)');
  saveAnnouncementsToCloud()
    .then(function(){ setSyncStatus('✓ บันทึกประกาศและซิงค์สำเร็จ', 'var(--green)'); })
    .catch(function(err){ setSyncStatus('✗ Cloud ไม่ติด: '+err.message+' (บันทึกในเครื่อง)', 'var(--red)'); });
}

function deleteAnnouncement() {
  if (!currentEditingAnnouncement) return;
  var a = ANNOUNCEMENTS.find(function(x){return x.id===currentEditingAnnouncement;});
  customConfirm({ icon:ICON_TRASH, title:'ลบประกาศ?', desc:'ลบ <strong>"'+(a?escapeHtml(a.title):'')+'"</strong> — ไม่สามารถกู้คืน', okText:'ลบเลย' })
    .then(function(ok){ if (ok) doDeleteAnnouncement(); });
}
function doDeleteAnnouncement() {
  var a = ANNOUNCEMENTS.find(function(x){ return x.id === currentEditingAnnouncement; });
  ANNOUNCEMENTS = ANNOUNCEMENTS.filter(function(x){return x.id!==currentEditingAnnouncement;});
  saveAnnouncementsLocal();
  closeAnnouncementEditor();
  renderAnnouncementsList();
  setSyncStatus('กำลังซิงค์ Cloud...', 'var(--text2)');
  saveAnnouncementsToCloud()
    .then(function(){ setSyncStatus('✓ ลบและซิงค์สำเร็จ', 'var(--green)'); })
    .catch(function(err){ setSyncStatus('✗ Cloud ไม่ติด: '+err.message, 'var(--red)'); });
}

function logout() {
  sessionStorage.clear();
  window.location.href = '../index.html';
}

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
  if (subEl) {
    var total = (allRecords || []).length;
    subEl.textContent = !total ? 'ยังไม่มีใบรับรองในระบบ'
      : ('ทุกสาขา ' + total + ' ใบ'
         + (!isAdminMode && currentBranchName ? ' · ' + currentBranchName + ' ' + own.length + ' ใบ' : ''));
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

function branchSearch() {
  var q = (document.getElementById('branchSearchQ') || { value: '' }).value.trim().toLowerCase();
  var grid = document.getElementById('branchResults');
  if (!grid) return;
  _fhResetSelIfFilterChanged('br');   // เปลี่ยนคำค้น → ล้างที่ติ๊กไว้ก่อนวาดช่องติ๊ก
  // ไม่พิมพ์อะไร = โชว์ทุกสาขา (ตัดที่ MAX ด้านล่าง แล้วบอกให้พิมพ์กรองให้แคบลง)
  var results = !q ? (allRecords || []) : (allRecords || []).filter(function(r){
    var hay = ((r['ชื่อในใบรับรอง']||'') + ' ' + (r['ชื่อในระบบ']||'') + ' ' + (r['สาขา']||'') + ' ' + (r['ตำแหน่ง']||'') + ' ' + (r['หลักสูตร']||'')).toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  _brLastResults = results;   // ใช้ตอนกด "เลือกทั้งหมด" ที่หัวตาราง

  var info = document.getElementById('branchSearchInfo');
  if (info) {
    info.innerHTML = !q
      ? 'แสดงทั้งหมด <strong>' + results.length + '</strong> รายการ — พิมพ์เพื่อค้นหา'
      : 'พบ <strong>' + results.length + '</strong> รายการ จากทั้งหมด ' + (allRecords || []).length;
  }

  if (!results.length) {
    grid.innerHTML = '<div class="table-container tc-cards"><table><tbody><tr><td class="empty">' +
      '<div style="font-size:44px;margin-bottom:10px;">📂</div>' +
      '<div style="font-weight:700;color:var(--text2);margin-bottom:4px;">' + (q ? 'ไม่พบข้อมูลที่ค้นหา' : 'ยังไม่มีใบรับรองในระบบ') + '</div>' +
      '<div style="font-size:12px;color:var(--text3);">' + (q ? 'ลองพิมพ์คำอื่น' : 'กดปุ่มด้านล่างเพื่อส่งรายชื่อเข้าอบรม') + '</div>' +
      '</td></tr></tbody></table></div>';
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
  if (!hit) return '<span class="cert-badge cb-none" title="ไม่พบในระบบใบรับรอง">— ไม่พบ</span>';
  if (hit.status === 'valid')   return '<span class="cert-badge cb-valid" title="ใบรับรองยังมีผล' + (hit.expireDate ? ' · หมดอายุ ' + hit.expireDate : '') + '">✓ ยังมีผล</span>';
  if (hit.status === 'warning') return '<span class="cert-badge cb-warn" title="ใกล้หมดอายุ' + (hit.expireDate ? ' · ' + hit.expireDate : '') + '">⚠ ใกล้หมด</span>';
  if (hit.status === 'expired') return '<span class="cert-badge cb-exp" title="หมดอายุแล้ว' + (hit.expireDate ? ' · ' + hit.expireDate : '') + '">✗ หมดอายุ</span>';
  return '<span class="cert-badge cb-none">—</span>';
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
  var round = String(r['round'] || r['รุ่น'] || r['รุ่นที่'] || '').trim();
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
    tsRaw: r.timestamp || r['วันที่ส่ง'] || ''
  };
}

/* Render one admin request row. showCourseCol=false → omit หลักสูตร column (used in per-course tables). */
function _renderAdminReqRow(r, certIdx, showCourseCol) {
  var p = _prepReqFields(r);
  var keyData = encodeURIComponent(JSON.stringify({ rowIndex: p.rowIdx, timestamp: String(p.tsRaw), name: p.name, idCard: p.idCard }));
  var html = '<tr>'
    +'<td data-label="สาขา" data-icon="🏬">'+escapeHtml(_brDispG(p.branch))+'</td>'
    +'<td data-label="ชื่อ" data-icon="👤" class="cert-name">'+escapeHtml(p.name)+'</td>'
    +'<td data-label="รหัสพนง" data-icon="🆔">'+escapeHtml(p.empId)+'</td>'
    +'<td data-label="ตำแหน่ง" data-icon="💼">'+escapeHtml(p.pos)+'</td>';
  if (showCourseCol) {
    html += '<td data-label="หลักสูตร" data-icon="📚" style="font-size:12.5px;">'+escapeHtml(p.course)+'</td>';
  }
  var dateSlot = escapeHtml(formatThaiDate(p.trainDate));
  if (p.slot) dateSlot += ' <span style="color:var(--text3);font-weight:600;">(' + escapeHtml(p.slot) + ')</span>';
  dateSlot += p.round
    ? ' <span class="round-chip">รุ่น ' + escapeHtml(p.round) + '</span>'
    : ' <span class="round-chip round-chip-none" title="ยังไม่ระบุรุ่น — ใช้ปุ่ม 🏷️ กำหนดรุ่น">ไม่ระบุรุ่น</span>';
  html += '<td data-label="วันอบรม / รอบเวลา" data-icon="📅">'+dateSlot+'</td>'
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
  var html = '<div class="req-count-card rcc-gold'+(active==='all'?' active':'')+'" onclick="_setCourseFilter(\'all\')">'
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
    html += '<div class="req-count-card '+color+(isActive?' active':'')+'" onclick="_setCourseFilter(\''+enc+'\',true)" title="'+escapeAttr(c)+'">'
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
  return fetch(SCRIPT_URL + '?action=requests&_=' + Date.now(), { method: 'GET' })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (!res.ok) { if (!_cached) info.innerHTML = '<span style="color:var(--red)">โหลดไม่สำเร็จ: '+(res.error||'unknown')+'</span>'; return; }
      _fhCacheSet('fh_requests_v1', res.records || []);
      _process(res.records || []);
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
  var _payload = _addMode
    ? { type: 'save-requests', records: [record] }
    : { type: 'update-request', key: _editingKey, record: record };
  fetch(SCRIPT_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(_payload)
  })
    .then(function(r){ return r.json(); })
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
  fetch(SCRIPT_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'delete-request', key: keyData })
  })
    .then(function(r){ return r.json(); })
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
    var saved = String(r.round || r['รุ่น'] || r['รุ่นที่'] || '').trim();
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
    _fhBulkUpdate(payload, function(n, total){
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
function _fhPost(payload) {
  return fetch(SCRIPT_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function(r){ return r.json(); });
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
    _fhBulkDelete(records, function(n, total){
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
  var saved = String(r.round || r['รุ่น'] || r['รุ่นที่'] || '').trim();
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
      +     '<input value="'+escapeAttr(r.position)+'" placeholder="เช่น พนักงานครัว" oninput="updateReqRow('+i+',\'position\',this.value)">'
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
}

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
    fetch(SCRIPT_URL, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'save-requests', records: valid })
    })
    .then(function(r){ return r.json(); })
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

