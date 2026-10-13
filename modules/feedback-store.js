/* =======================================================================
   feedback-store.js — ที่เก็บกลางของ Customer Feedback Collection (Supabase FAB HUB)
   · ตาราง fb_batches / fb_rows / fb_csat + ฟังก์ชัน fb_* (supabase/feedback.sql)
   · ใช้ล็อกอิน/ไคลเอนต์ของ hub-docstore.js (HubMod.SB) — ต้องโหลดสองไฟล์นั้นก่อน
   · FBStore.ready() → {ok, why}  why = 'nosql' (ยังไม่ได้รัน SQL) | 'offline' (ต่อไม่ได้)
   ======================================================================= */
(function (global) {
  "use strict";
  var PAGE = 1000;

  function sb() { return global.HubMod.SB.client(); }
  function fail(e) { return new Error((e && e.message) || String(e)); }
  function ok(r) { if (r.error) throw fail(r.error); return r.data; }
  function chunk(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
  function isMissing(e) {
    var m = String((e && (e.message || e.code)) || '');
    return /PGRST205|PGRST202|42P01|schema cache|does not exist|Could not find/i.test(m) || (e && (e.code === 'PGRST205' || e.code === '42P01'));
  }

  var state = { p: null };
  var FBStore = {
    /* ต่อฐานข้อมูลได้ + ตารางมีแล้ว */
    ready: function () {
      if (state.p) return state.p;
      state.p = global.HubMod.SB.ready().then(function (up) {
        if (!up) return { ok: false, why: 'offline', err: global.HubMod.SB.err };
        return sb().from('fb_batches').select('id', { head: true, count: 'exact' }).then(function (r) {
          if (r.error) return { ok: false, why: isMissing(r.error) ? 'nosql' : 'offline', err: r.error.message };
          return { ok: true };
        });
      }).catch(function (e) { return { ok: false, why: 'offline', err: e && e.message }; });
      return state.p;
    },
    retry: function () { state.p = null; return this.ready(); },

    batches: function (channel) {
      return sb().from('fb_batches').select('*').eq('channel', channel || 'voc').order('created_at', { ascending: false }).then(ok);
    },

    /* ดึงทีละหน้า (PostgREST ตอบสูงสุด 1,000 แถวต่อครั้ง) แล้วรวม */
    _all: function (build, onProgress) {
      return build(0, 0, true).then(function (cnt) {
        var total = cnt || 0, pages = Math.ceil(total / PAGE), out = new Array(pages), done = 0;
        if (!total) return [];
        var idx = []; for (var i = 0; i < pages; i++) idx.push(i);
        var lanes = 4, next = 0;
        function lane() {
          if (next >= pages) return Promise.resolve();
          var p = next++;
          return build(p * PAGE, p * PAGE + PAGE - 1, false).then(function (rows) {
            out[p] = rows; done++; if (onProgress) onProgress(done, pages);
            return lane();
          });
        }
        var ls = []; for (var l = 0; l < Math.min(lanes, pages); l++) ls.push(lane());
        return Promise.all(ls).then(function () { return [].concat.apply([], out); });
      });
    },

    /* แถวที่ลงระบบแล้วของช่องทางนั้น — สำหรับแดชบอร์ด */
    liveRows: function (channel, onProgress) {
      var cols = 'b,d,t,ty,br,z,o,s,c,sub,main';
      return this._all(function (from, to, countOnly) {
        var q = sb().from('fb_rows');
        if (countOnly) return q.select('id', { head: true, count: 'exact' }).eq('channel', channel).eq('state', 'live').then(function (r) { if (r.error) throw fail(r.error); return r.count; });
        return q.select(cols).eq('channel', channel).eq('state', 'live').order('id').range(from, to).then(ok);
      }, onProgress);
    },
    liveCsat: function (channel) {
      return sb().from('fb_csat').select('b,k,d_from,d_to,n,cs,np').eq('channel', channel).eq('state', 'live').then(ok);
    },
    /* ตัวระบุความเปลี่ยนแปลง — ใช้ตัดสินว่าต้องโหลดใหม่ไหม */
    liveStamp: function (channel) {
      return sb().from('fb_batches').select('id,approved_at').eq('channel', channel).eq('status', 'approved').then(ok).then(function (a) {
        return a.map(function (x) { return x.id + '@' + x.approved_at; }).sort().join(',');
      });
    },

    batchRows: function (batchId, onProgress) {
      return this._all(function (from, to, countOnly) {
        var q = sb().from('fb_rows');
        if (countOnly) return q.select('id', { head: true, count: 'exact' }).eq('batch_id', batchId).then(function (r) { if (r.error) throw fail(r.error); return r.count; });
        return q.select('id,state,src_id,b,d,t,ty,br,z,o,s,c,sub,main,extra,edited').eq('batch_id', batchId).order('id').range(from, to).then(ok);
      }, onProgress);
    },
    batchCsat: function (batchId) {
      return sb().from('fb_csat').select('*').eq('batch_id', batchId).order('b').order('k').order('d_from').then(ok);
    },

    /* src_id ที่เคยนำเข้าแล้ว (ช่วงวันที่ที่ไฟล์ครอบคลุม) */
    existingSrc: function (channel, from, to) {
      return this._all(function (a, b, countOnly) {
        var q = sb().from('fb_rows');
        if (countOnly) return q.select('id', { head: true, count: 'exact' }).eq('channel', channel).gte('d', from).lte('d', to).then(function (r) { if (r.error) throw fail(r.error); return r.count; });
        return q.select('src_id').eq('channel', channel).gte('d', from).lte('d', to).order('id').range(a, b).then(ok);
      }).then(function (rows) { var s = {}; rows.forEach(function (r) { s[r.src_id] = 1; }); return s; });
    },

    /* สร้างชุดตรวจสอบ + ใส่แถว (ทีละ 500) — พังกลางทางแล้วลบชุดทิ้ง */
    createBatch: function (meta, rows, csat, onProgress) {
      var bid = null, total = rows.length + csat.length, done = 0;
      return sb().from('fb_batches').insert({
        channel: meta.channel || 'voc', file_name: meta.file_name || '', d_from: meta.d_from || null, d_to: meta.d_to || null,
        n_rows: rows.length, n_csat: csat.length, note: meta.note || '', created_by: meta.by || ''
      }).select('id').single().then(ok).then(function (b) {
        bid = b.id;
        var jobs = chunk(rows, 500).map(function (c) { return { t: 'fb_rows', rows: c }; })
          .concat(chunk(csat, 500).map(function (c) { return { t: 'fb_csat', rows: c }; }));
        return jobs.reduce(function (p, j) {
          return p.then(function () {
            var body = j.rows.map(function (r) { var o = Object.assign({}, r); o.batch_id = bid; o.channel = meta.channel || 'voc'; return o; });
            return sb().from(j.t).insert(body).then(function (r) {
              if (r.error) throw fail(r.error);
              done += j.rows.length; if (onProgress) onProgress(done, total);
            });
          });
        }, Promise.resolve());
      }).then(function () { return bid; }, function (e) {
        if (bid) { sb().from('fb_batches').delete().eq('id', bid).then(function () {}); }
        throw e;
      });
    },

    setRows: function (batchId, ids, patch) {
      return Promise.all(chunk(ids, 2000).map(function (c) {
        return sb().rpc('fb_rows_set', { p_batch: batchId, p_ids: c, p_patch: patch }).then(ok).then(function (r) { if (!r.ok) throw new Error(r.error); return r.n; });
      })).then(function (a) { return a.reduce(function (x, y) { return x + y; }, 0); });
    },
    setCsat: function (batchId, ids, patch) {
      return sb().rpc('fb_csat_set', { p_batch: batchId, p_ids: ids, p_patch: patch }).then(ok).then(function (r) { if (!r.ok) throw new Error(r.error); return r.n; });
    },
    approve: function (batchId, by) {
      return sb().rpc('fb_approve', { p_batch: batchId, p_by: by || '' }).then(ok).then(function (r) { if (!r.ok) throw new Error(r.error); return r; });
    },
    revoke: function (batchId) {
      return sb().rpc('fb_revoke', { p_batch: batchId }).then(ok).then(function (r) { if (!r.ok) throw new Error(r.error); return r; });
    },
    removeBatch: function (batchId) {
      return sb().from('fb_batches').delete().eq('id', batchId).eq('status', 'staging').then(ok);
    }
  };
  global.FBStore = FBStore;
})(window);
