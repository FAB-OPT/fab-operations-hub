/* fh-perms.js — สิทธิ์ปุ่มตาม role · โมดัลฝั่งแอดมิน
   แยกมาจาก food-handler.js (บรรทัดเดิม 2591-3787)
   ⚠️ ไฟล์ชุดนี้ต้องโหลดตามลำดับใน food-handler.html — อย่าสลับ */
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
/* เหตุผลที่ส่งรายชื่อไม่ได้ ('' = ส่งได้) — ใช้แสดงให้ผู้ใช้รู้ว่าเมนูหายเพราะอะไร */
var FH_SUBMIT_WHY = '';

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
/* ── สิทธิ์จากศูนย์กลาง — แหล่งเดียวคือ Supabase (fh_config.perms.foodhandler) ──
   เดิม: อ้อมผ่าน Apps Script (~2 วิ) แล้วยังมี Firestore เก็บอีกชุดคอยแข่งกันทับ
         Firestore มาก่อน (~0.3 วิ) → ปุ่มหาย → HUB มาทีหลังทับให้กลับมา = ปุ่มวูบ
         ถ้า Apps Script ล้ม (เคยล้ม 3 ใน 4 ตอนคนใช้พร้อมกัน) Firestore ชนะถาวร
   ตอนนี้: อ่าน Supabase ตรง ๆ (~0.3 วิ) · Firestore ไม่เก็บสิทธิ์แล้ว · อ่านไม่ได้ = คงค่าเดิม */
var FH_PERMS_FROM_HUB = false;
function loadFhPermsFromHub() {
  return fhLoadPerms()
    .then(function(p){
      if (p) {
        FH_PERMS = _normalizeFhPerms(p);
        FH_PERMS_FROM_HUB = true;
        saveFhPermsLocal();
        console.log('[perms] ใช้สิทธิ์จากศูนย์กลาง');
      } else {
        console.warn('[perms] อ่านสิทธิ์ไม่ได้ — ใช้ค่าล่าสุดที่จำไว้ในเครื่องต่อ');
      }
      /* เรียก applyFhConfigUI ไม่ใช่ applyFhPerms ตรง ๆ เพราะปุ่มฝั่งสาขา
         ต้องคิดร่วมกับสวิตช์เปิด-ปิดรับรายชื่อด้วย */
      try { applyFhConfigUI(); } catch (e) { try { applyFhPerms(); } catch (e2) {} }
    })
    .catch(function(e){ console.warn('[perms] โหลดสิทธิ์ไม่สำเร็จ — ใช้ค่าเดิม', e); });
}
/* กลับมาที่แท็บนี้แล้วดึงสิทธิ์ใหม่ — แทน realtime ที่เคยได้จาก Firestore
   กันเคส: แอดมินแก้สิทธิ์ที่ HUB แล้วเครื่องที่เปิดหน้านี้ค้างไว้ยังใช้ของเก่า */
var _fhPermsLastAt = 0;
window.addEventListener('focus', function(){
  if (Date.now() - _fhPermsLastAt < 30000) return;
  _fhPermsLastAt = Date.now();
  loadFhPermsFromHub();
});

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

  /* ทางเข้าหน้าส่งรายชื่อมี 2 ที่: เมนูข้าง (จอคอม) กับแท็บล่าง (มือถือ)
     ต้องซ่อน/โผล่พร้อมกันเสมอ ไม่งั้นคนเดียวกันเปิดคนละเครื่องเห็นไม่เหมือนกัน

     สำคัญเรื่องลำดับ: applyFhPerms ถูกเรียกท้ายสุดของ applyFhConfigUI
     จึงเป็น "คำตัดสินสุดท้าย" — ต้องคิดสวิตช์เปิด-ปิดรับรายชื่อตรงนี้ด้วย
     เดิมคิดแค่สิทธิ์ ทำให้ตอนแอดมินปิดรับ เมนูข้างที่เพิ่งซ่อนไปโดนเปิดกลับมา */
  var _submitOpen = true;
  try { _submitOpen = (typeof FH_CONFIG === 'undefined') || FH_CONFIG.submitOpen !== false; } catch (e) {}
  var _canSub = fhCan('submit-request');
  var _allowSubmit = _canSub && _submitOpen;
  [document.getElementById('brNavSubmit'), document.getElementById('mtbSubmit')].forEach(function(el){
    if (el) el.style.display = _allowSubmit ? '' : 'none';
  });
  /* เก็บเหตุผลไว้ให้เห็นด้วย — เมนูหายเฉย ๆ ผู้ใช้ไม่รู้ว่าเพราะอะไร
     คิดว่าระบบพัง แล้วมาถามซ้ำ ๆ ซึ่งเสียเวลาทั้งสองฝ่าย */
  FH_SUBMIT_WHY = _allowSubmit ? ''
    : (!_submitOpen ? 'ปิดรับรายชื่อชั่วคราว'
       : 'บทบาท ' + ((FH_ROLE_LABEL[FH_USER.role] || FH_USER.role || 'ไม่ทราบ')) + ' ไม่มีสิทธิ์ส่งรายชื่อ');
  try { if (typeof _fhRenderSubmitWhy === 'function') _fhRenderSubmitWhy(); } catch (e) {}

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
  /* เขียนลงที่เดียว = Supabase (ที่เดียวกับที่ HUB ใช้) — เดิมเขียนลง Firestore
     ทำให้เกิดสิทธิ์ 2 ชุดที่ไม่ตรงกัน แล้วแข่งกันว่าใครโหลดทีหลัง */
  fhSavePerms(FH_PERMS)
    .then(function(){
      applyFhConfigUI();   // เรียกตัวนี้ (ไม่ใช่ applyFhPerms ตรงๆ) เพราะปุ่มฝั่งสาขาต้องคิดร่วมกับสวิตช์รับรายชื่อ
      showInfo('บันทึกสิทธิ์แล้ว', 'สิทธิ์ปุ่มถูกอัปเดตแล้ว — เครื่องอื่นจะเห็นเมื่อกลับมาที่หน้านี้');
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

/* กดแท็บส่งรายชื่อ — ไม่มีสิทธิ์ก็บอกไปตรง ๆ ว่าเพราะอะไร
   เดิมแท็บหายไปเฉย ๆ ผู้ใช้ไม่รู้ว่าหายเพราะอะไร นึกว่าระบบพัง */
function fhSubmitTabGuard() {
  if (!fhCan('submit-request')) {
    var role = (typeof FH_ROLE_LABEL !== 'undefined' && FH_ROLE_LABEL[FH_USER.role]) || FH_USER.role || 'บทบาทนี้';
    showInfo('ส่งรายชื่อไม่ได้',
      'บทบาท <b>' + escapeHtml(role) + '</b> ยังไม่ได้รับสิทธิ์ส่งรายชื่ออบรม<br><br>' +
      'ให้ผู้ดูแลระบบเปิดสิทธิ์ที่ HUB → ⚙️ ตั้งค่า → สิทธิ์ปุ่ม → ผู้สัมผัสอาหาร → "ส่งรายชื่อขออบรม"');
    return;
  }
  showBrSection('adm-sec-br-submit');
}
