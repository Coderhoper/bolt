create table if not exists public.owner_comm_channels (
  channel text primary key check (channel in ('email','sms','whatsapp')),
  provider text not null,
  sender_name text,
  sender_address text,
  reply_to text,
  is_enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.owner_comm_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email','sms','whatsapp')),
  category text not null check (category in ('transactional','notification','system')),
  recipient_hash text not null,
  provider text not null,
  provider_message_id text,
  status text not null check (status in ('queued','accepted','failed')),
  error_code text,
  idempotency_key text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists owner_comm_messages_recent_idx
  on public.owner_comm_messages(created_at desc);

alter table public.owner_comm_channels enable row level security;
alter table public.owner_comm_messages enable row level security;
create policy "mfa owner staff read communication channels" on public.owner_comm_channels
  for select to authenticated using (public.owner_can_read());
create policy "mfa owner staff read communication logs" on public.owner_comm_messages
  for select to authenticated using (public.owner_can_read());
revoke all on public.owner_comm_channels, public.owner_comm_messages from anon, authenticated;
grant select on public.owner_comm_channels, public.owner_comm_messages to authenticated;

create or replace function public.owner_set_comm_channel(
  p_channel text, p_provider text, p_sender_name text,
  p_sender_address text, p_reply_to text, p_is_enabled boolean
) returns void language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.owner_can_provision() then raise exception 'Platform administrator and MFA are required'; end if;
  if p_channel not in ('email','sms','whatsapp') then raise exception 'Unsupported channel'; end if;
  if p_provider not in ('postmark','twilio','meta_cloud') then raise exception 'Unsupported provider'; end if;
  if (p_channel = 'email' and p_provider <> 'postmark')
    or (p_channel = 'sms' and p_provider <> 'twilio')
    or (p_channel = 'whatsapp' and p_provider <> 'meta_cloud') then
    raise exception 'Provider does not match communication channel';
  end if;
  insert into public.owner_comm_channels(channel,provider,sender_name,sender_address,reply_to,is_enabled,updated_by,updated_at)
  values (p_channel,p_provider,nullif(trim(p_sender_name),''),nullif(trim(p_sender_address),''),nullif(trim(p_reply_to),''),p_is_enabled,auth.uid(),now())
  on conflict (channel) do update set provider=excluded.provider,sender_name=excluded.sender_name,
    sender_address=excluded.sender_address,reply_to=excluded.reply_to,is_enabled=excluded.is_enabled,
    updated_by=excluded.updated_by,updated_at=now();
  perform public.append_owner_audit('communications.channel_updated','communication_channel',p_channel,
    jsonb_build_object('provider',p_provider,'enabled',p_is_enabled));
end $$;
revoke all on function public.owner_set_comm_channel(text,text,text,text,text,boolean) from public, anon;
grant execute on function public.owner_set_comm_channel(text,text,text,text,text,boolean) to authenticated;

create or replace function public.owner_comm_reserve_message(
  p_channel text, p_recipient_hash text, p_provider text, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public, auth
as $$
declare message_key uuid;
begin
  if not public.owner_can_provision() then raise exception 'Owner role and verified MFA are required'; end if;
  if p_channel not in ('email','sms','whatsapp') or length(p_recipient_hash) <> 64
     or length(p_idempotency_key) not between 1 and 100 then raise exception 'Invalid message request'; end if;
  insert into public.owner_comm_messages(channel,category,recipient_hash,provider,status,idempotency_key,created_by)
  values (p_channel,'notification',p_recipient_hash,p_provider,'queued',p_idempotency_key,auth.uid())
  returning id into message_key;
  return message_key;
end $$;

create or replace function public.owner_comm_complete_message(
  p_idempotency_key text, p_provider_message_id text, p_status text, p_error_code text
) returns void language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.owner_can_provision() then raise exception 'Owner role and verified MFA are required'; end if;
  if p_status not in ('accepted','failed') then raise exception 'Invalid message result'; end if;
  update public.owner_comm_messages set status=p_status,
    provider_message_id=nullif(p_provider_message_id,''), error_code=nullif(p_error_code,'')
  where idempotency_key=p_idempotency_key and created_by=auth.uid() and status='queued';
  if not found then raise exception 'Message reservation was not found'; end if;
end $$;

revoke all on function public.owner_comm_reserve_message(text,text,text,text) from public, anon;
revoke all on function public.owner_comm_complete_message(text,text,text,text) from public, anon;
grant execute on function public.owner_comm_reserve_message(text,text,text,text) to authenticated;
grant execute on function public.owner_comm_complete_message(text,text,text,text) to authenticated;

create or replace function public.audit_owner_comm_message()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.append_owner_audit(
    case when tg_op = 'INSERT' then 'communications.message_queued' else 'communications.message_' || new.status end,
    'communication_message', new.id::text,
    jsonb_build_object('channel',new.channel,'category',new.category,'status',new.status,'recipient_hash',new.recipient_hash,'provider',new.provider,'error_code',new.error_code)
  );
  return new;
end $$;
create trigger owner_comm_message_audit after insert or update of status on public.owner_comm_messages
  for each row execute function public.audit_owner_comm_message();

comment on table public.owner_comm_messages is 'Owner-plane delivery metadata only: message bodies and recipient addresses are never retained.';
