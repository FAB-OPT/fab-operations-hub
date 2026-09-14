/* =======================================================================
   hub-docstore.js — ของใช้ร่วมของโมดูลเล็กในฮับ (เบิกเงินประชุมร้าน · อุปกรณ์ออกบูธ)
   · HubMod.Hub      = ตัวตนจาก fab_session ที่ฮับส่งต่อมา (สาขา / ทีมบริหาร)
   · HubMod.Cfg      = ทะเบียนสาขา · สิทธิ์ปุ่ม · แบรนด์ จาก ?action=config ของฮับ
   · HubMod.Branches = รายชื่อสาขาที่ยังเปิด แยกแบรนด์ (ฮับเป็นเจ้าของ ห้ามพิมพ์รายชื่อเอง)
   · HubMod.can      = ตัดสินสิทธิ์: ห้ามรายคน > อนุญาตรายคน > ตำแหน่ง (เหมือนโมดูลอื่นของฮับ)
   · HubMod.Store    = อ่าน/เขียนเอกสารผ่าน Apps Script (ชีตละระบบ) + รูปขึ้น Drive
   ======================================================================= */
(function (global) {
  "use strict";

  var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyjGvhSuDrnnOkWdwoq4CsR5jM3__lp58ZWe_BjcrxDIoOtnlFaiEdKUXX10EANUFCRXA/exec';
  /* หลังบ้านรุ่นก่อนหน้านี้ไม่รู้จัก action=mod-docs แล้วจะตอบรายชื่อใบรับรองทั้งก้อนกลับมาแทน
     เช็คเลขรุ่นจาก counts (ก้อนเล็ก) ก่อน จะได้บอกผู้ใช้ตรง ๆ ว่ารออัปเดตหลังบ้าน */
  var MIN_BACKEND = '2026-09-14';

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ───────── ตัวตน ───────── */
  var Hub = {
    session: function () { return lsGet('fab_session'); },
    role: function () { try { return sessionStorage.getItem('fab_role') || ''; } catch (e) { return ''; } },
    /* ไม่มี session ของฮับ = เปิดไฟล์นี้ตรง ๆ → ส่งกลับไปล็อกอินที่ฮับ */
    guard: function () {
      if (this.role() && this.session()) return true;
      location.href = '../index.html';
      return false;
    },
    isBranch: function () { var s = this.session(); return !!(s && s.role === 'branch'); },
    userRole: function () { var s = this.session(); return (s && s.role) || ''; },
    userCode: function () { var s = this.session(); return String((s && s.code) || ''); },
    branchCode: function () { var s = this.session(); return String((s && (s.branchCode || s.code)) || ''); },
    branchName: function () {
      var s = this.session();
      return (s && (s.branchName || s.name)) || (function () { try { return sessionStorage.getItem('fab_branch_name') || ''; } catch (e) { return ''; } })();
    },
    /* ชื่อ-นามสกุลตามโปรไฟล์ฮับ — ใช้บันทึกว่าใครทำรายการ (อ่านย้อนหลังแล้วรู้ตัวคนจริง) */
    fullName: function () {
      var s = this.session();
      if (!s) return '';
      if (s.role === 'branch') return String(s.branchCode || s.code || '') + ' ' + String(s.branchName || s.name || '');
      return String(s.name || s.nick || '').trim();
    },
    back: function () { location.href = '../index.html'; }
  };

  /* ───────── config ของฮับ ───────── */
  var CFG_KEY = 'hubmod_config_v1';
  var Cfg = {
    data: lsGet(CFG_KEY),
    load: function () {
      var self = this;
      return fetch(SCRIPT_URL + '?action=config&_=' + Date.now())
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) {
            /* เก็บเฉพาะที่ใช้ ไม่เก็บทะเบียนผู้ใช้ — localStorage ของโดเมนนี้ใช้ร่วมกันทุกระบบ */
            self.data = { branches: res.branches || null, perms: res.perms || null, brands: res.brands || null };
            lsSet(CFG_KEY, self.data);
          }
          return self.data;
        })
        .catch(function () { return self.data; });
    }
  };

  /* ───────── สาขา ───────── */
  var BRAND_TH = { santafe: 'ซานตาเฟ่', jaedaeng: 'เจ๊แดง', yamachan: 'ยามะจัง' };
  var FALLBACK_PREFIX = { '40': 'jaedaeng', '50': 'santafe', '55': 'santafe', '60': 'yamachan' };
  var Branches = {
    raw: function () { return (Cfg.data && Cfg.data.branches) || lsGet('fab_branches_v1') || null; },
    brandOf: function (code) {
      code = String(code || '');
      var raw = this.raw() || {}, brands = (Cfg.data && Cfg.data.brands) || [];
      var over = raw.brandMap && raw.brandMap[code];
      var pre = over || code.slice(0, 2);
      for (var i = 0; i < brands.length; i++) {
        if (brands[i].key === pre) return pre;
        if ((brands[i].prefixes || []).indexOf(pre) >= 0) return brands[i].key;
      }
      return FALLBACK_PREFIX[pre] || BRAND_TH[pre] && pre || '';
    },
    brandName: function (key) { return BRAND_TH[key] || key || 'อื่น ๆ'; },
    /* สาขาที่ยังเปิดอยู่ · closed ไม่ถูกลบจากทะเบียน (รายงานเก่ายังต้องแปลงรหัสเป็นชื่อ) */
    list: function (includeClosed) {
      var raw = this.raw();
      if (!raw || !raw.branches) return [];
      var st = raw.statusMap || {}, self = this;
      return Object.keys(raw.branches)
        .filter(function (c) { return includeClosed || st[c] !== 'closed'; })
        .sort()
        .map(function (c) {
          var b = self.brandOf(c);
          return { code: c, name: String(raw.branches[c] || '').trim(), brand: b, brandName: self.brandName(b), closed: st[c] === 'closed' };
        });
    },
    nameOf: function (code) {
      var raw = this.raw();
      return (raw && raw.branches && raw.branches[code]) ? String(raw.branches[code]).trim() : '';
    },
    label: function (code, fallback) {
      var n = this.nameOf(code) || fallback || '';
      return (String(code || '') + ' ' + n).trim();
    },
    brands: function () {
      var seen = {}, out = [];
      this.list().forEach(function (b) { if (b.brand && !seen[b.brand]) { seen[b.brand] = 1; out.push(b.brand); } });
      return out;
    }
  };

  /* ───────── สิทธิ์ ─────────
     ฮับยังไม่เคยบันทึกหน้าสิทธิ์ของระบบนี้ = ใช้ค่าตั้งต้นที่โมดูลส่งมา (ตรงกับ PERM_SYSTEMS ในฮับ)
     ไม่ใช้ "ไม่ตั้ง = ใครก็ทำได้" เพราะระบบนี้มีปุ่มอนุมัติเงิน */
  function can(sysKey, actionId, defaults) {
    var all = Cfg.data && Cfg.data.perms && Cfg.data.perms[sysKey];
    var p = all && all[actionId];
    if (!p) p = { roles: (defaults && defaults[actionId]) || [] };
    var code = Hub.userCode(), role = Hub.userRole();
    if (code && (p.deny || []).indexOf(code) >= 0) return false;
    if (code && (p.allow || []).indexOf(code) >= 0) return true;
    return (p.roles || []).indexOf(role) >= 0;
  }

  /* ───────── ที่เก็บเอกสาร ───────── */
  function Store(app) {
    this.app = app;
    this.key = 'hubmod_docs_' + app + '_v1';
    this.docs = {};          // { col: { id: data } }
    this.sig = '';
    this.listeners = [];
    this.loadedAt = null;
    var cached = lsGet(this.key);
    if (cached && cached.docs) { this.docs = cached.docs; this.loadedAt = cached.at || null; }
  }
  Store.prototype.onChange = function (fn) { this.listeners.push(fn); };
  Store.prototype._emit = function () {
    var s = JSON.stringify(this.docs);
    if (s === this.sig) return;
    this.sig = s;
    lsSet(this.key, { docs: this.docs, at: this.loadedAt });
    this.listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
  };
  Store.prototype.hasCache = function () { return !!this.loadedAt; };
  Store.prototype.checkBackend = function () {
    return fetch(SCRIPT_URL + '?action=counts&_=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (res) { return !!(res && res.version && String(res.version) >= MIN_BACKEND); });
  };
  Store.prototype.refresh = function () {
    var self = this;
    return fetch(SCRIPT_URL + '?action=mod-docs&app=' + encodeURIComponent(this.app) + '&_=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok || !Array.isArray(res.docs)) throw new Error((res && res.error) || 'โหลดข้อมูลไม่สำเร็จ');
        var next = {};
        res.docs.forEach(function (d) { (next[d.col] = next[d.col] || {})[d.id] = d.data; });
        self.docs = next;
        self.loadedAt = new Date().toISOString();
        self._emit();
        return true;
      });
  };
  Store.prototype.all = function (col) {
    var m = this.docs[col] || {};
    return Object.keys(m).map(function (id) { var o = {}, d = m[id]; for (var k in d) o[k] = d[k]; o.id = id; return o; });
  };
  Store.prototype.get = function (col, id) {
    var d = this.docs[col] && this.docs[col][id];
    if (!d) return null;
    var o = {}; for (var k in d) o[k] = d[k]; o.id = id; return o;
  };
  Store.prototype._post = function (body) {
    body.app = this.app;
    body.by = Hub.fullName();
    return fetch(SCRIPT_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  };
  Store.prototype._write = function (type, col, id, data, expect) {
    var self = this;
    return this._post({ type: type, col: col, id: id, data: data, expect: expect || null }).then(function (res) {
      if (!res || !res.ok) {
        var e = new Error(res && res.error === 'conflict' ? 'รายการนี้ถูกแก้จากอีกเครื่องไปแล้ว — โหลดข้อมูลใหม่ให้แล้ว' : 'บันทึกไม่สำเร็จ' + (res && res.error ? ' (' + res.error + ')' : ''));
        e.code = res && res.error;
        if (e.code === 'conflict') self.refresh().catch(function () {});
        throw e;
      }
      if (type === 'mod-delete') { if (self.docs[col]) delete self.docs[col][id]; }
      else if (res.doc) { (self.docs[col] = self.docs[col] || {})[id] = res.doc.data; }
      self._emit();
      return res;
    });
  };
  Store.prototype.set = function (col, id, data, expect) { return this._write('mod-save', col, id, data, expect); };
  Store.prototype.update = function (col, id, patch, expect) { return this._write('mod-update', col, id, patch, expect); };
  Store.prototype.remove = function (col, id, expect) { return this._write('mod-delete', col, id, null, expect); };
  Store.prototype.uploadPhoto = function (dataUrl) {
    var name = this.app + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.jpg';
    return this._post({ type: 'upload-mod-photo', base64: dataUrl, filename: name }).then(function (res) {
      if (!res || !res.ok || !res.url) throw new Error('อัปโหลดรูปไม่สำเร็จ' + (res && res.error ? ' (' + res.error + ')' : ''));
      return res.url;
    });
  };
  /* ดึงใหม่เป็นระยะเฉพาะตอนเปิดหน้าอยู่ + ทันทีที่กลับมาที่แท็บ — แทน onSnapshot ของเดิม */
  Store.prototype.startPolling = function (ms) {
    var self = this;
    setInterval(function () { if (document.visibilityState === 'visible') self.refresh().catch(function () {}); }, ms || 45000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') self.refresh().catch(function () {});
    });
  };

  /* ───────── รูป ───────── */
  function compressImage(file, max, limit) {
    max = max || 1100; limit = limit || 170000;
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error('อ่านไฟล์ไม่ได้')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { rej(new Error('ไฟล์ไม่ใช่รูปภาพ')); };
        img.onload = function () {
          var sc = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var q = 0.72, o = c.toDataURL('image/jpeg', q);
          while (o.length > limit && q > 0.28) { q -= 0.1; o = c.toDataURL('image/jpeg', q); }
          res(o);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* วันที่ตามเวลาเครื่อง (ไทย) — toISOString เป็นเวลา UTC ช่วงตี 0–7 จะได้วันของเมื่อวาน */
  function localDate(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDMY(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? (m[3] + '/' + m[2] + '/' + (Number(m[1]) + 543)) : String(v || '');
  }

  global.HubMod = {
    SCRIPT_URL: SCRIPT_URL, MIN_BACKEND: MIN_BACKEND,
    Hub: Hub, Cfg: Cfg, Branches: Branches, can: can, Store: Store,
    compressImage: compressImage, localDate: localDate, fmtDMY: fmtDMY
  };
})(window);
