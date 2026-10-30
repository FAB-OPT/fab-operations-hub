-- ════════════════════════════════════════════════════════════════════
-- ไฟล์สรุป "Complain Voc" → โหมด "แทนที่คอมเมนต์ไม่พอใจ" (replace_complaints)
--
-- ต่างจากโหมด replace เดิมตรงที่ตอนอนุมัติ จะลบเฉพาะคอมเมนต์ "ไม่พอใจ"
-- ของแบรนด์และช่วงวันที่ในไฟล์ · คอมเมนต์ "พอใจ" และ CSAT/NPS ไม่ถูกแตะ
-- โหมด add และ replace เดิมทำงานเหมือนเดิมทุกอย่าง
--
-- วิธีใช้: Supabase → โปรเจกต์ FAB HUB (pzspcjqlxoqnbtvlfjsy) → SQL Editor
--          วางทั้งไฟล์นี้แล้วกด Run (รันซ้ำได้ ไม่พัง)
-- ════════════════════════════════════════════════════════════════════

alter table public.fb_batches drop constraint if exists fb_batches_mode_check;
alter table public.fb_batches add constraint fb_batches_mode_check
  check (mode in ('add', 'replace', 'replace_complaints'));

create or replace function public.fb_approve(p_batch uuid, p_by text default '')
returns jsonb language plpgsql as $$
declare
  v_rows int; v_csat int; v_replaced int := 0; v_removed int := 0; v_removed_csat int := 0;
  v_b public.fb_batches%rowtype; v_brands text[];
begin
  select * into v_b from public.fb_batches where id = p_batch and status = 'staging' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ชุดนี้อนุมัติแล้วหรือไม่พบ');
  end if;

  -- โหมดแทนที่ (เดิม): ลบข้อมูลที่ลงระบบแล้วของแบรนด์ในไฟล์ + ช่วงวันที่ของไฟล์ (จากชุดอื่น) ก่อน แล้วใช้ไฟล์นี้แทนทั้งชุด
  if v_b.mode = 'replace' then
    select array_agg(distinct b) into v_brands from public.fb_rows where batch_id = p_batch;
    delete from public.fb_rows
     where channel = v_b.channel and state = 'live' and batch_id <> p_batch
       and b = any(coalesce(v_brands, '{}')) and d between v_b.d_from and v_b.d_to;
    get diagnostics v_removed = row_count;
    delete from public.fb_csat
     where channel = v_b.channel and state = 'live' and batch_id <> p_batch
       and b = any(coalesce(v_brands, '{}')) and d_from <= v_b.d_to and d_to >= v_b.d_from;
    get diagnostics v_removed_csat = row_count;
  end if;

  -- โหมดแทนที่คอมเมนต์ไม่พอใจ (ไฟล์สรุป Complain Voc): ลบเฉพาะ "ไม่พอใจ" · ไม่แตะพอใจ และไม่แตะ CSAT/NPS
  if v_b.mode = 'replace_complaints' then
    select array_agg(distinct b) into v_brands from public.fb_rows where batch_id = p_batch;
    delete from public.fb_rows
     where channel = v_b.channel and state = 'live' and batch_id <> p_batch and ty = 'ไม่พอใจ'
       and b = any(coalesce(v_brands, '{}')) and d between v_b.d_from and v_b.d_to;
    get diagnostics v_removed = row_count;
  end if;

  -- CSAT/NPS เดือนเดียวกัน + BZM/Owner เดียวกัน ที่เคยอนุมัติไว้ → แทนที่ด้วยของชุดนี้
  delete from public.fb_csat o
   where o.state = 'live' and o.channel = 'voc'
     and exists (select 1 from public.fb_csat n
                  where n.batch_id = p_batch and n.state = 'staging'
                    and n.b = o.b and n.k = o.k and date_trunc('month', n.d_from) = date_trunc('month', o.d_from));
  get diagnostics v_replaced = row_count;

  update public.fb_csat set state = 'live', updated_at = now() where batch_id = p_batch and state = 'staging';
  get diagnostics v_csat = row_count;

  update public.fb_rows set state = 'live', updated_at = now()
   where batch_id = p_batch and state = 'staging'
     and ty in ('พอใจ', 'ไม่พอใจ') and btrim(c) <> '';
  get diagnostics v_rows = row_count;

  update public.fb_batches set status = 'approved', approved_by = left(coalesce(p_by, ''), 80), approved_at = now()
   where id = p_batch;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'csat', v_csat, 'csatReplaced', v_replaced,
                            'removedRows', v_removed, 'removedCsat', v_removed_csat);
end $$;
