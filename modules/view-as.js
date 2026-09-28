/* ══════════════════════════════════════════════════════════════════
   แถบ "กำลังดูในมุมมองของ …" — ใส่ในทุกโมดูลที่อ่านตัวตนจาก fab_session

   แอดมินกดสลับมุมมองจากฮับ (เครื่องมือผู้ดูแลระบบ → ดูในมุมมองอื่น)
   ระบบจะเก็บตัวจริงไว้ที่ fab_view_as_real แล้วเขียน fab_session ของคนที่เลือกทับ
   ทุกระบบจึงเห็นเหมือนคนนั้นล็อกอินเข้ามาเอง โดยไม่ต้องออกจากระบบ

   ไฟล์นี้ทำหน้าที่เดียว: ถ้ากำลังสวมมุมมองอยู่ ให้ขึ้นแถบเตือนค้างไว้บนสุด
   พร้อมปุ่มกลับเป็นตัวเอง — กันลืมว่ากำลังดูในฐานะคนอื่นแล้วไปแก้ข้อมูลผิดคน
   ══════════════════════════════════════════════════════════════════ */
(function () {
  var FLAG = 'fab_view_as';        // ชื่อที่กำลังสวมอยู่ (ว่าง = ไม่ได้สวม)
  var REAL = 'fab_view_as_real';   // ตัวจริงที่เก็บไว้ก่อนสวม

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function exit() {
    var raw = get(REAL);
    try {
      if (raw) {
        var r = JSON.parse(raw);
        if (r.session) localStorage.setItem('fab_session', r.session);
        else localStorage.removeItem('fab_session');
        sessionStorage.setItem('fab_role', r.role || '');
        sessionStorage.setItem('fab_branch_pin', r.pin || '');
        sessionStorage.setItem('fab_branch_name', r.name || '');
      }
      localStorage.removeItem(FLAG);
      localStorage.removeItem(REAL);
    } catch (e) {}
    location.reload();
  }

  function paint() {
    var who = get(FLAG);
    if (!who || document.getElementById('fabViewAsBar')) return;
    var bar = document.createElement('div');
    bar.id = 'fabViewAsBar';
    bar.innerHTML =
      '<span class="va-ic">👁</span>' +
      '<span class="va-tx">กำลังดูในมุมมองของ <b></b> — ไม่ใช่บัญชีตัวเอง</span>' +
      '<button class="va-btn" type="button">กลับเป็นตัวเอง</button>';
    bar.querySelector('b').textContent = who;      // ชื่อคนมาจากข้อมูล ไม่ใส่เป็น HTML
    bar.querySelector('.va-btn').onclick = exit;
    var css = document.createElement('style');
    css.textContent =
      '#fabViewAsBar{position:fixed;left:0;right:0;top:0;z-index:99999;display:flex;align-items:center;gap:10px;' +
      'padding:7px 14px;background:#7c3aed;color:#fff;font-family:Sarabun,sans-serif;font-size:13px;font-weight:700;' +
      'box-shadow:0 2px 10px rgba(17,24,39,.25)}' +
      '#fabViewAsBar .va-ic{font-size:15px;line-height:1}' +
      '#fabViewAsBar .va-tx{flex:1;min-width:0;font-weight:600}' +
      '#fabViewAsBar .va-tx b{font-weight:800}' +
      '#fabViewAsBar .va-btn{flex:none;font:inherit;font-weight:800;font-size:12.5px;border:0;border-radius:8px;' +
      'padding:6px 13px;background:#fff;color:#6d28d9;cursor:pointer}' +
      '#fabViewAsBar .va-btn:hover{background:#f5f3ff}' +
      'body{padding-top:36px!important}' +
      '@media(max-width:560px){#fabViewAsBar{font-size:12px;padding:6px 10px}body{padding-top:44px!important}}';
    document.head.appendChild(css);
    document.body.appendChild(bar);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
  window.fabViewAsExit = exit;
})();
