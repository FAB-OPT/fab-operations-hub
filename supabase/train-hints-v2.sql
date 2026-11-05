-- ============================================================================
-- ภาคต่อของ train-hints.sql · ภาพรวมข้อร้องเรียน→การสอนงาน สำหรับแอดมิน / VP / COO / BZM
--  1) fb_train_dismiss  เก็บ "การลบ" (ทั้งเคสหรือรายหัวข้อ) พร้อมสาเหตุ — ใช้ร่วมกันทุกเครื่อง
--  2) train_dismiss / train_dismiss_restore  บันทึก/กู้คืนการลบ
--  3) train_hints_for_branch  (แก้) ส่งรายการที่ถูกลบมาด้วย
--  4) train_hints_overview    ข้อร้องเรียนของสาขาที่ระบุ (ฝั่งเว็บส่งเฉพาะสาขาที่ผู้ใช้มีสิทธิ์เห็น)
-- รันซ้ำได้ ไม่ทำข้อมูลเดิมเสีย
-- ============================================================================

create table if not exists public.fb_train_dismiss (
  id bigint generated always as identity primary key,
  row_id bigint not null references public.fb_rows(id) on delete cascade,
  module_id text,                                   -- null = ลบทั้งเคส · ไม่ null = ลบเฉพาะหัวข้อ (Module) นั้น
  subs jsonb,
  reason text not null check (length(trim(reason)) > 0),
  by_name text not null default '',
  created_at timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists fb_train_dismiss_row_idx on public.fb_train_dismiss (row_id) where restored_at is null;
alter table public.fb_train_dismiss enable row level security;   -- ไม่เปิดสิทธิ์ตรง · เข้าผ่าน RPC ด้านล่างเท่านั้น

create or replace function public.train_dismiss(p_row bigint, p_module text, p_reason text, p_by text default '', p_subs jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.fb_train_dismiss (row_id, module_id, subs, reason, by_name)
  select p_row, nullif(p_module, ''), p_subs, left(trim(p_reason), 200), left(coalesce(p_by, ''), 80)
  where length(trim(coalesce(p_reason, ''))) > 0 and exists (select 1 from public.fb_rows where id = p_row);
$$;

create or replace function public.train_dismiss_restore(p_row bigint)
returns void language sql security definer set search_path = public as $$
  update public.fb_train_dismiss set restored_at = now() where row_id = p_row and module_id is null and restored_at is null;
$$;

create or replace function public.train_hints_for_branch(p_code text, p_days integer default 30)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.d desc, x.id desc), '[]'::jsonb)
  from (
    select r.id, r.channel, r.d, r.s, r.br, r.sub, r.main, r.c,
           h.modules, h.reason, h.method,
           coalesce((select jsonb_agg(jsonb_build_object('module', d.module_id, 'reason', d.reason, 'by', d.by_name, 'at', d.created_at))
                     from public.fb_train_dismiss d where d.row_id = r.id and d.restored_at is null), '[]'::jsonb) as dismissed
    from public.fb_rows r
    left join public.fb_train_hints h on h.row_id = r.id
    where r.state = 'live'
      and r.d >= current_date - greatest(1, least(coalesce(p_days, 30), 120))
      and length(regexp_replace(coalesce(p_code, ''), '\D', '', 'g')) = 4
      and r.br like (regexp_replace(coalesce(p_code, ''), '\D', '', 'g') || ' %')
      and ((r.channel = 'voc' and r.s <= 6) or r.channel = 'facebook')
      and coalesce(trim(r.c), '') <> ''
    order by r.d desc, r.id desc
    limit 60
  ) x;
$$;

create or replace function public.train_hints_overview(p_codes text[], p_days integer default 30)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.d desc, x.id desc), '[]'::jsonb)
  from (
    select r.id, r.channel, r.d, r.s, r.br, r.z, r.c,
           h.modules, h.reason, h.method,
           coalesce((select jsonb_agg(jsonb_build_object('module', d.module_id, 'reason', d.reason, 'by', d.by_name, 'at', d.created_at))
                     from public.fb_train_dismiss d where d.row_id = r.id and d.restored_at is null), '[]'::jsonb) as dismissed
    from public.fb_rows r
    left join public.fb_train_hints h on h.row_id = r.id
    where r.state = 'live'
      and r.d >= current_date - greatest(1, least(coalesce(p_days, 30), 120))
      and r.br ~ '^[0-9]{4} '
      and left(r.br, 4) = any (p_codes)
      and ((r.channel = 'voc' and r.s <= 6) or r.channel = 'facebook')
      and coalesce(trim(r.c), '') <> ''
    order by r.d desc, r.id desc
    limit 1500
  ) x;
$$;

revoke all on function public.train_dismiss(bigint, text, text, text, jsonb) from public, anon;
revoke all on function public.train_dismiss_restore(bigint) from public, anon;
revoke all on function public.train_hints_for_branch(text, integer) from public, anon;
revoke all on function public.train_hints_overview(text[], integer) from public, anon;
grant execute on function public.train_dismiss(bigint, text, text, text, jsonb) to authenticated;
grant execute on function public.train_dismiss_restore(bigint) to authenticated;
grant execute on function public.train_hints_for_branch(text, integer) to authenticated;
grant execute on function public.train_hints_overview(text[], integer) to authenticated;
