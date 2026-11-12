/* Booth & Catering Desk — ตัวเชื่อมกับฮับ (แทน supabase-shim.js เดิม)
   แอปเขียนไว้กับ API แบบเอกสาร: claude.use("db"|"user"|"assets"|"downloads")
   ไฟล์นี้ทำให้ API เดิมทำงานบนฐานข้อมูลของฮับ (โปรเจกต์ FAB HUB):
     · ตัวตน/สิทธิ์  = จากฮับ (fab_session + หน้าสิทธิ์ของฮับ ผ่าน "ประตูฮับ" ใน index.html → window.BC_ACCESS) ไม่มีหน้าล็อกอินของแอปอีกต่อไป
     · ข้อมูล        = ตาราง bc_docs (col, id, data jsonb) ผ่านฟังก์ชัน bc_set / bc_update / bc_delete  (supabase/bc-docs.sql)
     · ไฟล์สลิป      = Storage bucket bc-slips
   ซิงก์: ถามฐานซ้ำทุก 10 วินาทีเมื่อหน้าเปิดอยู่ + ทันทีหลังเขียนเอง (ไม่ใช้ realtime) */
(function () {
  "use strict";
  var H = window.HubMod;
  var BUCKET = "bc-slips", TABLE = "bc_docs", POLL_MS = 10000;
  var sb = null, acc = null;
  var resolveReady, rejectReady;
  var ready = new Promise(function (ok, no) { resolveReady = ok; rejectReady = no; });
  ready.catch(function () {});

  /* ───────── แจ้งปัญหาเชื่อมต่อให้เห็นบนจอ ───────── */
  function fail(msg) {
    try {
      var el = document.getElementById("bcFail");
      if (!el) {
        el = document.createElement("div"); el.id = "bcFail";
        el.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;background:#7A1F10;color:#fff;padding:12px 16px;border-radius:12px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3)";
        document.body.appendChild(el);
      }
      el.textContent = msg;
    } catch (_) {}
  }

  function err(e) {
    var m = String((e && e.message) || e || ""), c = e && e.code;
    var x = new Error(m);
    if (c === "P0001" || /งานนี้ปิดแล้ว/.test(m)) x.code = "locked";
    else if (c === "P0002" || /bc_not_found/.test(m)) x.code = "invalid_argument";
    else if (c === "PGRST202" || c === "PGRST205" || c === "42P01" || c === "42883") { x.code = "setup"; x.message = "ฐานข้อมูลของฮับยังไม่มีตาราง/ฟังก์ชันของระบบนี้ — ต้องรัน supabase/bc-docs.sql ใน SQL Editor ของโปรเจกต์ FAB HUB ก่อน"; }
    else x.code = "unavailable";
    return x;
  }

  /* ───────── ตัวตน + สิทธิ์ (ได้มาจากประตูฮับ) ───────── */
  var PEOPLE_COL = "people";
  function me() { return acc ? { id: acc.uid, name: acc.name || acc.uid, role: acc.role } : null; }
  function membersDoc() {
    var o = {}; if (acc) o[acc.uid] = { brands: (acc.brands || ["jaedang", "tsc"]).slice(), role: acc.role, department: "" };
    return o;
  }

  /* ───────── อ่าน/เขียนเอกสาร ───────── */
  function split(path) { var s = String(path).split("/").filter(Boolean); return { col: s.slice(0, -1).join("/"), id: s[s.length - 1] }; }
  function clean(o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2); }

  async function fetchCol(col) {
    var all = [], from = 0;
    for (;;) {
      var r = await sb.from(TABLE).select("id,data,updated_at").eq("col", col).eq("deleted", false).order("id").range(from, from + 999);
      if (r.error) throw err(r.error);
      all = all.concat(r.data || []);
      if (!r.data || r.data.length < 1000) break;
      from += 1000;
    }
    return all;
  }
  async function fetchOne(col, id) {
    var r = await sb.from(TABLE).select("data").eq("col", col).eq("id", id).eq("deleted", false).maybeSingle();
    if (r.error) throw err(r.error);
    return r.data ? r.data.data : null;
  }

  /* ผู้ชม: คอลเลกชันที่มีคนฟังอยู่จะถูกถามซ้ำเป็นระยะ · ส่งให้ผู้ฟังเมื่อมีอะไรเปลี่ยนเท่านั้น */
  var watchers = {};   // col -> { fns:[...], sig:"", rows:[] , busy:false }
  async function refresh(col, force) {
    var w = watchers[col]; if (!w || w.busy) return; w.busy = true;
    try {
      var rows = await fetchCol(col);
      var sig = rows.length + "|" + rows.map(function (r) { return r.id + ":" + r.updated_at; }).join(",");
      if (force || sig !== w.sig || !w.loaded) { w.sig = sig; w.rows = rows; w.loaded = true; w.fns.slice().forEach(function (f) { try { f.ok(rows); } catch (e) { console.error(e); } }); }
    } catch (e) { w.fns.slice().forEach(function (f) { try { if (f.bad) f.bad(e); } catch (_) {} }); }
    finally { w.busy = false; }
  }
  function watch(col, ok, bad) {
    var w = watchers[col] || (watchers[col] = { fns: [], sig: "", rows: [], loaded: false, busy: false });
    var f = { ok: ok, bad: bad }; w.fns.push(f);
    if (w.loaded) { try { ok(w.rows); } catch (e) { console.error(e); } } else refresh(col, true);
    return function () { w.fns = w.fns.filter(function (x) { return x !== f; }); };
  }
  function touch(col) { if (watchers[col]) refresh(col, true); }
  setInterval(function () { if (document.hidden) return; Object.keys(watchers).forEach(function (c) { if (watchers[c].fns.length) refresh(c, false); }); }, POLL_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) Object.keys(watchers).forEach(function (c) { refresh(c, false); }); });

  function snapDoc(id, data) { return { id: id, exists: !!data, data: function () { return data || undefined; }, metadata: { fromCache: false, hasPendingWrites: false } }; }
  var by = function () { return acc ? acc.uid : ""; };

  function docRef(path) {
    var p = split(path), isMembers = path === "access/members";
    var api = {
      id: p.id, path: path,
      get: async function () {
        if (isMembers) return snapDoc("members", { members: membersDoc() });
        return snapDoc(p.id, await fetchOne(p.col, p.id));
      },
      set: async function (body) {
        if (isMembers) return;                     // สิทธิ์ผู้ใช้จัดที่หน้าสิทธิ์ของฮับ
        var r = await sb.rpc("bc_set", { p_col: p.col, p_id: p.id, p_data: clean(body), p_by: by() });
        if (r.error) throw err(r.error);
        touch(p.col);
      },
      update: async function (body) {
        if (isMembers) return;
        var r = await sb.rpc("bc_update", { p_col: p.col, p_id: p.id, p_data: clean(body), p_by: by() });
        if (r.error) throw err(r.error);
        touch(p.col);
      },
      delete: async function () {
        if (isMembers) return;
        var r = await sb.rpc("bc_delete", { p_col: p.col, p_id: p.id, p_by: by() });
        if (r.error) throw err(r.error);
        touch(p.col);
      },
      onSnapshot: function (next, onErr) {
        if (isMembers) { var dead = false; Promise.resolve().then(function () { if (!dead) next(snapDoc("members", { members: membersDoc() })); }); return function () { dead = true; }; }
        return watch(p.col, function (rows) {
          var hit = null; for (var i = 0; i < rows.length; i++) if (rows[i].id === p.id) { hit = rows[i].data; break; }
          next(snapDoc(p.id, hit));
        }, onErr);
      },
      collection: function (sub) { return collRef(path + "/" + sub); }
    };
    return api;
  }

  function collRef(path, opts) {
    opts = opts || {};
    var col = String(path).split("/").filter(Boolean).join("/");
    function shape(rows) {
      var list = rows.map(function (r) { return { id: r.id, data: r.data }; });
      if (opts.order) {
        var f = opts.order.field, desc = opts.order.dir === "desc";
        list.sort(function (a, b) { var x = a.data && a.data[f], y = b.data && b.data[f]; x = x == null ? "" : x; y = y == null ? "" : y; return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); });
      }
      if (opts.limit) list = list.slice(0, opts.limit);
      var docs = list.map(function (r) { return snapDoc(r.id, r.data); });
      return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
    }
    var api = {
      path: path,
      doc: function (id) { return docRef(path + "/" + (id || uuid())); },
      add: async function (data) { var d = api.doc(); await d.set(data); return d; },
      where: function () { return api; },
      orderBy: function (field, dir) { return collRef(path, Object.assign({}, opts, { order: { field: field, dir: dir } })); },
      limit: function (n) { return collRef(path, Object.assign({}, opts, { limit: n })); },
      get: async function () { return shape(await fetchCol(col)); },
      onSnapshot: function (next, onErr) { return watch(col, function (rows) { next(shape(rows)); }, onErr); }
    };
    return api;
  }
  var db = { doc: docRef, collection: collRef };

  /* ───────── user ───────── */
  var user = {
    isOwner: async function () { return false; },
    canEdit: async function () { return true; },     // สิทธิ์จริงคุมด้วยบทบาทที่ฮับกำหนด (S.isAdmin / S.canSales ในแอป)
    can: async function () { return null; },
    id: async function () { return acc ? acc.uid : null; },
    me: async function () { var m = me() || {}; return { id: m.id || null, name: m.name || "", email: null, avatarUrl: "", color: "#888", isOwner: false, canEdit: true }; },
    name: async function () { return (me() || {}).name || ""; },
    profiles: async function (ids) {
      var list = [].concat(ids || []).filter(Boolean), out = {};
      var names = {};
      if (list.length) {
        try { var r = await sb.from(TABLE).select("id,data").eq("col", PEOPLE_COL).eq("deleted", false).in("id", list); (r.data || []).forEach(function (x) { names[x.id] = (x.data && x.data.name) || ""; }); } catch (_) {}
      }
      list.forEach(function (id) { out[id] = { id: id, name: names[id] || (acc && id === acc.uid ? acc.name : "") || "", email: null, avatarUrl: "", color: "#888", isMe: !!(acc && id === acc.uid), guest: false }; });
      return out;
    },
    search: async function () { return []; }        // เพิ่มผู้ใช้ทำที่หน้าสิทธิ์ของฮับ
  };

  /* ───────── assets (สลิป) ───────── */
  var urlCache = {}, pending = {};
  var PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="84" height="110"><rect width="84" height="110" fill="#eee"/></svg>');
  window.slipSrc = function (path) {
    if (!path || !sb) return PLACEHOLDER;
    var hit = urlCache[path];
    if (hit && hit.exp > Date.now()) return hit.url;
    if (!pending[path]) {
      pending[path] = sb.storage.from(BUCKET).createSignedUrl(path, 3600).then(function (r) {
        if (r && r.data && r.data.signedUrl) { urlCache[path] = { url: r.data.signedUrl, exp: Date.now() + 50 * 60 * 1000 }; window.dispatchEvent(new Event("bc-rerender")); }
      }).then(function () { setTimeout(function () { delete pending[path]; }, 1000); }, function () { setTimeout(function () { delete pending[path]; }, 1000); });
    }
    return PLACEHOLDER;
  };
  var assets = {
    upload: async function (blob, opts) {
      opts = opts || {};
      var type = opts.type || blob.type || "image/jpeg";
      var ext = opts.ext ? (String(opts.ext).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin") : type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      var brand = "jaedang"; try { brand = localStorage.getItem("bc.brand") || brand; } catch (_) {}
      var path = brand + "/" + (opts.folder ? String(opts.folder).replace(/[^a-z0-9_-]/gi, "") + "/" : "") + uuid() + "." + ext;
      var r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
      if (r.error) { var x = new Error(r.error.message); x.code = /size/i.test(r.error.message) ? "too_large" : /mime|type/i.test(r.error.message) ? "unsupported_type" : "upstream_error"; throw x; }
      return { id: path, url: window.slipSrc(path), sizeBytes: blob.size, contentType: type };
    },
    delete: async function (path) { await sb.storage.from(BUCKET).remove([path]); return { deleted: true }; },
    list: async function () { return { assets: [], usage: {} }; }
  };

  var downloads = {
    save: async function (o) {
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data]);
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = o.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return { status: "saved" };
    }
  };

  /* ───────── เริ่มต้น: รอประตูฮับ → ต่อฐานของฮับ → ลงชื่อตัวเองในทะเบียนชื่อ ───────── */
  async function init() {
    acc = await window.BC_GATE;                    // ประตูฮับตัดสินแล้วว่ามีสิทธิ์ (ไม่มีสิทธิ์ = ไม่ resolve)
    if (!H || !H.SB) throw new Error("โหลดตัวเชื่อมฐานข้อมูลของฮับไม่ได้");
    var ok = await H.SB.ready();
    if (!ok) throw new Error("ต่อฐานข้อมูลของฮับไม่ได้ ลองรีเฟรชหน้า");
    sb = H.SB.client();
    var probe = await sb.from(TABLE).select("id").limit(1);
    if (probe.error) throw err(probe.error);
    sb.rpc("bc_set", { p_col: PEOPLE_COL, p_id: acc.uid, p_data: { name: acc.name, code: acc.code || "" }, p_by: acc.uid }).then(function () {}, function () {});
    resolveReady(true);
  }
  init().catch(function (e) { fail((e && e.message) || "เชื่อมต่อไม่สำเร็จ"); rejectReady(e); });

  /* ออกจากระบบ = กลับฮับ */
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("#logoutBtn").forEach(function (b) { if (/ออกจากระบบ/.test(b.textContent)) b.textContent = "กลับฮับ"; });
  });
  document.addEventListener("click", function (ev) {
    if (ev.target.closest && ev.target.closest("#logoutBtn")) { ev.preventDefault(); location.href = "../../index.html"; }
  }, true);

  window.claude = {
    use: async function (name) {
      await ready;
      return { db: db, user: user, assets: assets, downloads: downloads }[name] || null;
    }
  };
  window.__bcHub = { watchers: watchers, refresh: refresh };   // ไว้ตรวจ/ทดสอบ
})();
