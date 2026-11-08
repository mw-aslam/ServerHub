-- ServerHub: миграция для функции «Добавить проект».
-- Выполните этот файл в SQL Editor, если schema.sql уже был запущен раньше.
-- Для новой базы он не нужен: всё это уже входит в schema.sql.
-- Повторный запуск безопасен, данные не удаляются.

alter table public.commands add column if not exists payload jsonb;
alter table public.commands add column if not exists secret_env text;

alter table public.commands drop constraint if exists commands_action_check;
alter table public.commands add constraint commands_action_check
  check (action in ('start', 'stop', 'restart', 'update', 'logs', 'add_project'));

create or replace function public.expire_stale_commands()
returns void
language sql
as $$
  update public.commands
     set status = 'expired',
         finished_at = now(),
         output = 'Команда не была получена агентом за 60 секунд.',
         secret_env = null
   where status = 'pending'
     and created_at < now() - interval '60 seconds';

  update public.commands
     set status = 'error',
         finished_at = now(),
         output = 'Агент не вернул результат за 20 минут.'
   where status = 'running'
     and started_at < now() - interval '20 minutes';
$$;

create or replace function public.agent_sync(
  p_server_id uuid,
  p_key_hash text,
  p_snapshot jsonb,
  p_limit integer default 5
)
returns jsonb
language plpgsql
as $$
declare
  v_commands jsonb;
  v_ram_total numeric := nullif((p_snapshot #>> '{ram,totalMb}')::numeric, 0);
  v_ram_used numeric := (p_snapshot #>> '{ram,usedMb}')::numeric;
begin
  update public.servers
     set last_seen = now()
   where id = p_server_id
     and agent_key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('authorized', false);
  end if;

  insert into public.server_state (server_id, snapshot)
  values (p_server_id, p_snapshot)
  on conflict (server_id) do update
    set snapshot = excluded.snapshot;

  insert into public.metrics (
    server_id, cpu_percent, ram_percent, ram_used_mb,
    battery_percent, battery_temp, latency_ms, backend_ms
  )
  values (
    p_server_id,
    (p_snapshot #>> '{cpu,percent}')::real,
    round(v_ram_used / v_ram_total * 100, 1)::real,
    round(v_ram_used)::integer,
    (p_snapshot #>> '{battery,percent}')::real,
    (p_snapshot #>> '{battery,temperature}')::real,
    (p_snapshot #>> '{network,latencyMs}')::real,
    (p_snapshot #>> '{network,backendMs}')::real
  );

  perform public.expire_stale_commands();

  with next_commands as (
    select c.id, c.secret_env
      from public.commands c
     where c.server_id = p_server_id
       and c.status = 'pending'
     order by c.created_at
     limit greatest(p_limit, 1)
       for update skip locked
  ),
  claimed as (
    update public.commands c
       set status = 'running',
           started_at = now(),
           secret_env = null
      from next_commands n
     where c.id = n.id
    returning c.id, c.action, c.project, c.created_at, c.payload, n.secret_env
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', cl.id,
               'action', cl.action,
               'project', cl.project,
               'ageMs', floor(extract(epoch from now() - cl.created_at) * 1000)::bigint,
               'payload', cl.payload,
               'secret_env', cl.secret_env
             )
             order by cl.created_at
           ),
           '[]'::jsonb
         )
    into v_commands
    from claimed cl;

  return jsonb_build_object('authorized', true, 'commands', v_commands);
end;
$$;

create or replace function public.enqueue_add_project(
  p_server_id uuid,
  p_project text,
  p_payload jsonb,
  p_secret_env text
)
returns jsonb
language plpgsql
as $$
declare
  v_snapshot jsonb;
  v_last_seen timestamptz;
  v_id uuid;
begin
  perform public.expire_stale_commands();

  select st.snapshot, s.last_seen
    into v_snapshot, v_last_seen
    from public.servers s
    left join public.server_state st on st.server_id = s.id
   where s.id = p_server_id;

  if v_snapshot is null then
    return jsonb_build_object('ok', false, 'error', 'no_data');
  end if;

  if v_last_seen < now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'error', 'offline');
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_snapshot -> 'processes') as p(value)
     where p.value ->> 'name' = p_project
  ) then
    return jsonb_build_object('ok', false, 'error', 'project_exists');
  end if;

  insert into public.commands (server_id, action, project, payload, secret_env)
  values (p_server_id, 'add_project', p_project, p_payload, p_secret_env)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
end;
$$;

create or replace function public.get_command(p_id uuid)
returns jsonb
language sql
stable
as $$
  select to_jsonb(c) - 'secret_env'
    from public.commands c
   where c.id = p_id;
$$;

revoke all on function public.enqueue_add_project(uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_add_project(uuid, text, jsonb, text)
  to service_role;
