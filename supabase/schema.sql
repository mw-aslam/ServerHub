-- ServerHub: схема базы данных для Supabase (Postgres).
-- Запускается целиком в SQL Editor. Повторный запуск безопасен.

-- =============================================================
-- Таблицы
-- =============================================================

-- Серверы. Ключ агента хранится только в виде SHA-256.
create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  agent_key_hash text not null check (agent_key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen timestamptz
);
create unique index if not exists servers_name_idx on public.servers (lower(name));

-- Последний снимок состояния каждого сервера.
create table if not exists public.server_state (
  server_id uuid primary key references public.servers (id) on delete cascade,
  snapshot jsonb not null
);

-- История метрик для графиков (хранится 7 дней).
create table if not exists public.metrics (
  id bigint generated always as identity primary key,
  server_id uuid not null references public.servers (id) on delete cascade,
  created_at timestamptz not null default now(),
  cpu_percent real,
  ram_percent real,
  ram_used_mb integer,
  battery_percent real,
  battery_temp real,
  latency_ms real,
  backend_ms real
);
create index if not exists metrics_server_created_idx on public.metrics (server_id, created_at);
create index if not exists metrics_created_at_idx on public.metrics (created_at);

-- Очередь и история команд.
create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  action text not null
    check (action in ('start', 'stop', 'restart', 'update', 'logs', 'add_project')),
  project text not null check (char_length(project) between 1 and 200),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'success', 'error', 'expired')),
  output text,
  -- Параметры add_project без секретов.
  payload jsonb,
  -- Шифротекст .env проекта. Стирается, как только агент забрал команду.
  secret_env text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists commands_server_created_idx
  on public.commands (server_id, created_at desc);
create index if not exists commands_created_at_idx on public.commands (created_at);
create index if not exists commands_active_idx on public.commands (server_id, status, created_at)
  where status in ('pending', 'running');
-- Не даёт поставить одну и ту же команду дважды, пока первая не завершилась.
create unique index if not exists commands_one_active_idx
  on public.commands (server_id, project, action)
  where status in ('pending', 'running');

-- Счётчики попыток входа. key — хэш IP-адреса, сам адрес не хранится.
create table if not exists public.login_attempts (
  key text primary key,
  attempts integer not null default 0,
  window_started timestamptz not null default now(),
  blocked_until timestamptz
);

-- =============================================================
-- Доступ: только сервер с секретным ключом
-- =============================================================

alter table public.servers enable row level security;
alter table public.server_state enable row level security;
alter table public.metrics enable row level security;
alter table public.commands enable row level security;
alter table public.login_attempts enable row level security;
-- Политик намеренно нет: для anon и authenticated таблицы закрыты полностью.

-- =============================================================
-- Функции
-- =============================================================

-- Закрывает команды, которые не были выполнены вовремя.
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

-- Создаёт сервер. Сам ключ сюда не передаётся, только его хэш.
create or replace function public.create_server(p_name text, p_key_hash text)
returns jsonb
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.servers (name, agent_key_hash)
  values (p_name, p_key_hash)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
end;
$$;

-- Один вызов агента: проверяет ключ, сохраняет метрики и забирает очередь команд.
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

-- Сохраняет результат команды. Агент может завершить только команды своего сервера.
-- Возвращает null, если ключ неверный.
create or replace function public.agent_finish_command(
  p_server_id uuid,
  p_key_hash text,
  p_id uuid,
  p_status text,
  p_output text
)
returns boolean
language plpgsql
as $$
begin
  perform 1
     from public.servers s
    where s.id = p_server_id
      and s.agent_key_hash = p_key_hash;

  if not found then
    return null;
  end if;

  update public.commands
     set status = p_status,
         output = left(p_output, 70000),
         finished_at = now()
   where id = p_id
     and server_id = p_server_id
     and status = 'running';

  return found;
end;
$$;

-- Ставит команду из интерфейса в очередь указанного сервера.
create or replace function public.enqueue_command(
  p_server_id uuid,
  p_action text,
  p_project text
)
returns jsonb
language plpgsql
as $$
declare
  v_snapshot jsonb;
  v_last_seen timestamptz;
  v_process jsonb;
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

  select p.value
    into v_process
    from jsonb_array_elements(v_snapshot -> 'processes') as p(value)
   where p.value ->> 'name' = p_project
   limit 1;

  if v_process is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_project');
  end if;

  if p_action = 'stop' and coalesce((v_process ->> 'isAgent')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'protected');
  end if;

  insert into public.commands (server_id, action, project)
  values (p_server_id, p_action, p_project)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
end;
$$;

-- Ставит в очередь добавление нового проекта.
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

-- Список серверов и данные выбранного сервера для дашборда.
-- Если запрошенного сервера нет, возвращается самый ранний.
create or replace function public.get_dashboard(
  p_server_id uuid default null,
  p_commands_limit integer default 20
)
returns jsonb
language plpgsql
as $$
declare
  v_id uuid;
  v_servers jsonb;
  v_snapshot jsonb;
  v_age double precision;
  v_commands jsonb;
begin
  perform public.expire_stale_commands();

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'age_sec', extract(epoch from now() - s.last_seen)::double precision
             )
             order by s.created_at
           ),
           '[]'::jsonb
         )
    into v_servers
    from public.servers s;

  select s.id into v_id from public.servers s where s.id = p_server_id;
  if v_id is null then
    select s.id into v_id from public.servers s order by s.created_at limit 1;
  end if;

  if v_id is null then
    return jsonb_build_object(
      'servers', v_servers,
      'server_id', null,
      'snapshot', null,
      'age_sec', null,
      'commands', '[]'::jsonb
    );
  end if;

  select st.snapshot, extract(epoch from now() - s.last_seen)::double precision
    into v_snapshot, v_age
    from public.servers s
    left join public.server_state st on st.server_id = s.id
   where s.id = v_id;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
    into v_commands
    from (
      select id, action, project, status,
             left(output, 500) as output_preview,
             created_at, started_at, finished_at
        from public.commands
       where server_id = v_id
       order by created_at desc
       limit p_commands_limit
    ) c;

  return jsonb_build_object(
    'servers', v_servers,
    'server_id', v_id,
    'snapshot', v_snapshot,
    'age_sec', v_age,
    'commands', v_commands
  );
end;
$$;

-- Полный вывод одной команды (например, логи).
create or replace function public.get_command(p_id uuid)
returns jsonb
language sql
stable
as $$
  select to_jsonb(c) - 'secret_env'
    from public.commands c
   where c.id = p_id;
$$;

-- История метрик сервера, усреднённая по интервалам.
create or replace function public.get_metrics_history(
  p_server_id uuid,
  p_range_seconds integer,
  p_bucket_seconds integer
)
returns table (
  t timestamptz,
  cpu real,
  ram real,
  battery real,
  temperature real,
  latency real
)
language sql
stable
as $$
  select to_timestamp(
           floor(extract(epoch from m.created_at) / greatest(p_bucket_seconds, 1))
           * greatest(p_bucket_seconds, 1)
         ) as t,
         round(avg(m.cpu_percent)::numeric, 1)::real,
         round(avg(m.ram_percent)::numeric, 1)::real,
         round(avg(m.battery_percent)::numeric, 1)::real,
         round(avg(m.battery_temp)::numeric, 1)::real,
         round(avg(m.latency_ms)::numeric, 0)::real
    from public.metrics m
   where m.server_id = p_server_id
     and m.created_at >= now() - make_interval(secs => p_range_seconds)
   group by 1
   order by 1;
$$;

-- Атомарно учитывает попытку входа ещё до проверки пароля.
-- Возвращает, сколько секунд ждать; 0 означает, что попытка разрешена.
create or replace function public.consume_login_attempt(
  p_key text,
  p_max_attempts integer default 5,
  p_window_seconds integer default 900,
  p_block_seconds integer default 900
)
returns integer
language plpgsql
as $$
declare
  v_row public.login_attempts;
begin
  insert into public.login_attempts as a (key, attempts, window_started)
  values (p_key, 1, now())
  on conflict (key) do update
    set attempts = case
          when a.window_started < now() - make_interval(secs => p_window_seconds)
           and (a.blocked_until is null or a.blocked_until <= now())
          then 1
          else a.attempts + 1
        end,
        window_started = case
          when a.window_started < now() - make_interval(secs => p_window_seconds)
           and (a.blocked_until is null or a.blocked_until <= now())
          then now()
          else a.window_started
        end,
        blocked_until = case
          when a.blocked_until > now() then a.blocked_until
          when a.window_started < now() - make_interval(secs => p_window_seconds) then null
          when a.attempts + 1 > p_max_attempts then now() + make_interval(secs => p_block_seconds)
          else null
        end
  returning a.* into v_row;

  if v_row.blocked_until is not null and v_row.blocked_until > now() then
    return ceil(extract(epoch from v_row.blocked_until - now()))::integer;
  end if;

  return 0;
end;
$$;

-- Сбрасывает счётчик после успешного входа.
create or replace function public.reset_login_attempts(p_key text)
returns void
language sql
as $$
  delete from public.login_attempts where key = p_key;
$$;

-- Удаляет данные старше 7 дней.
create or replace function public.cleanup_old_data()
returns void
language sql
as $$
  delete from public.metrics where created_at < now() - interval '7 days';
  delete from public.commands where created_at < now() - interval '7 days';
  delete from public.login_attempts where window_started < now() - interval '1 day';
$$;

-- =============================================================
-- Права
-- =============================================================

revoke all on
  public.servers, public.server_state, public.metrics, public.commands, public.login_attempts
  from anon, authenticated;
grant all on
  public.servers, public.server_state, public.metrics, public.commands, public.login_attempts
  to service_role;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.expire_stale_commands()',
    'public.create_server(text, text)',
    'public.agent_sync(uuid, text, jsonb, integer)',
    'public.agent_finish_command(uuid, text, uuid, text, text)',
    'public.enqueue_command(uuid, text, text)',
    'public.enqueue_add_project(uuid, text, jsonb, text)',
    'public.get_dashboard(uuid, integer)',
    'public.get_command(uuid)',
    'public.get_metrics_history(uuid, integer, integer)',
    'public.consume_login_attempt(text, integer, integer, integer)',
    'public.reset_login_attempts(text)',
    'public.cleanup_old_data()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- =============================================================
-- Автоочистка раз в час
-- =============================================================

-- Если pg_cron недоступен, скрипт не падает: API сайта тоже
-- периодически вызывает cleanup_old_data().
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'serverhub-cleanup',
    '17 * * * *',
    'select public.cleanup_old_data()'
  );
exception
  when others then
    raise notice 'pg_cron недоступен, очистку будет выполнять API: %', sqlerrm;
end;
$$;
