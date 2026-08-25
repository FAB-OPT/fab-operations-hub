/* ═══════════════════════════════════════════════════════════════════════
   ที่เก็บแคชของระบบผู้สัมผัสอาหาร — ย้ายจาก localStorage ไป IndexedDB

   localStorage มีเพดานราว 5–10 MB ต่อ "ทั้งเว็บ" และทุกระบบในฮับใช้ก้อนเดียวกัน
   แคชของระบบนี้ (ทะเบียนพนักงาน + ใบรับรอง) รวมกันเกือบ 2 MB
   ซึ่งเคยมีส่วนทำให้ระบบอื่นบันทึกข้อมูลไม่ลงมาแล้ว

   ของพวกนี้เป็น "สำเนา" ทั้งหมด ตัวจริงอยู่บน Supabase ลบทิ้งก็โหลดใหม่ได้
   จึงย้ายไป IndexedDB ได้โดยไม่ต้องกังวลเรื่องข้อมูลหาย

   วิธีทำ: ยกทั้งก้อนขึ้นหน่วยความจำตอนเปิดแอปครั้งเดียว (fhHydrateCache)
   จากนั้น _fhCacheGet/_fhCacheSet ทำงานแบบไม่ต้องรอผลเหมือนเดิมทุกประการ
   โค้ดเดิมที่เรียกใช้อยู่จึงไม่ต้องแก้อะไรเลย
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var DB_NAME = 'fh_store_v1', STORE = 'kv';
  var _p = null, _mem = {}, _ready = false;

  function idb() {
    if (_p) return _p;
    _p = new Promise(function (res) {
      var req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { return res(null); }
      req.onupgradeneeded = function () { try { req.result.createObjectStore(STORE); } catch (e) {} };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { res(null); };
      setTimeout(function () { res(null); }, 3000);   /* เปิดไม่ขึ้นถือว่าใช้ไม่ได้ ดีกว่าค้างหน้าโหลด */
    });
    return _p;
  }
  function idbGet(k) {
    return idb().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          var r = db.transaction(STORE, 'readonly').objectStore(STORE).get(k);
          r.onsuccess = function () { res(r.result == null ? null : r.result); };
          r.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    }).catch(function () { return null; });
  }
  function idbSet(k, v) {
    return idb().then(function (db) {
      if (!db) return false;
      return new Promise(function (res) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(v, k);
          tx.oncomplete = function () { res(true); };
          tx.onerror = tx.onabort = function () { res(false); };
        } catch (e) { res(false); }
      });
    }).catch(function () { return false; });
  }

  /* คีย์ที่ระบบนี้เก็บเป็นแคช — ต้องอยู่ครบ ไม่งั้นตัวที่ตกหล่นจะยังกินที่เดิม */
  var KEYS = ['fh_emp_v1', 'fh_certs_v2', 'fh_requests_v1'];
  /* คีย์รุ่นเก่าที่เลิกใช้แล้วแต่ไม่เคยมีใครลบ — รวมกันเกือบ 0.8 MB
     ทิ้งได้เลยเพราะรุ่นใหม่อ่านคนละคีย์ และตัวจริงอยู่บนเซิร์ฟเวอร์ */
  var DEAD = ['fh_certs_v1', 'fh_cert_v1'];

  window.fhHydrateCache = function () {
    return Promise.all(KEYS.map(function (k) {
      return idbGet(k).then(function (v) {
        if (v !== null) { _mem[k] = v; return; }
        /* ยังไม่เคยย้าย — ยกของเดิมจาก localStorage ขึ้นมาแล้วเขียนลงที่ใหม่ */
        var old = null;
        try { var s = localStorage.getItem(k); if (s) old = JSON.parse(s); } catch (e) {}
        if (old === null) return;
        _mem[k] = old;
        return idbSet(k, old).then(function (ok) {
          if (ok) { try { localStorage.removeItem(k); } catch (e) {} }
        });
      });
    })).then(function () {
      DEAD.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      _ready = true;
      return true;
    }).catch(function () { _ready = true; return false; });
  };

  /* อ่าน/เขียนแบบไม่ต้องรอผล — หน่วยความจำเป็นตัวจริงระหว่างใช้งาน
     ยังไม่ยกขึ้น (เปิดแอปมาไว) ก็ถอยไปอ่าน localStorage ตามเดิม */
  window._fhCacheGet = function (k) {
    if (_ready || _mem[k] !== undefined) return _mem[k] === undefined ? null : _mem[k];
    try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  };
  window._fhCacheSet = function (k, v) {
    _mem[k] = v;
    idbSet(k, v).then(function (ok) {
      /* IndexedDB ใช้ไม่ได้ (โหมดไม่ระบุตัวตน/เบราว์เซอร์เก่า) → เขียนแบบเดิมไว้ก่อน */
      if (!ok) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
      else { try { localStorage.removeItem(k); } catch (e) {} }
    });
  };
})();
