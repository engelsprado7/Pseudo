-- Lo mínimo de Supabase para correr las migraciones en un Postgres común.
--
-- Solo para pruebas: imita a auth.users, auth.uid(), los roles de la API y la
-- publicación de realtime, que en Supabase ya vienen hechos. auth.uid() lee el
-- mismo ajuste que llena PostgREST con el token, así que una prueba "es" un
-- usuario con: set local request.jwt.claim.sub = '<uuid>'.

-- Los roles son de todo el servidor: si ya existen de otra base, se reusan.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'
);

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Supabase les da a los roles de la API acceso a todo lo que se cree en public;
-- lo que de verdad decide quién ve qué es RLS.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create publication supabase_realtime;
