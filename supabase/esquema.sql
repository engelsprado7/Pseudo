-- Esquema de la capa en la nube (salas por clase).
--
-- Pegar entero en el SQL Editor de Supabase y ejecutar. Es idempotente en lo
-- que importa: se puede volver a correr sin romper nada.
--
-- La regla que sostiene todo: la clave publishable es pública, así que la
-- seguridad vive acá, en RLS. Toda tabla tiene RLS activo y políticas
-- explícitas; sin eso, cualquiera con la clave del navegador leería todo.

-- ------------------------------------------------------------------
-- Perfiles
-- ------------------------------------------------------------------

-- Copia de los datos públicos del proveedor OAuth, para poder mostrar quién
-- compartió cada cosa sin exponer la tabla auth.users.
create table if not exists perfiles (
  id uuid primary key references auth.users on delete cascade,
  nombre text,
  avatar_url text
);

-- El perfil se crea solo al primer inicio de sesión.
create or replace function crear_perfil()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function crear_perfil();

-- ------------------------------------------------------------------
-- Salas (un workspace por clase)
-- ------------------------------------------------------------------

create table if not exists salas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  nombre text not null,
  docente uuid not null references auth.users on delete cascade,
  creada timestamptz not null default now()
);

create table if not exists miembros (
  sala uuid not null references salas on delete cascade,
  usuario uuid not null references auth.users on delete cascade,
  rol text not null default 'alumno' check (rol in ('docente', 'alumno')),
  primary key (sala, usuario)
);

-- ------------------------------------------------------------------
-- Contenido compartido
-- ------------------------------------------------------------------

-- Id corto y legible para los enlaces (#s=a1b2c3). Sin caracteres ambiguos:
-- nada de 0/O ni 1/l, que se dictan mal en voz alta en clase.
create or replace function id_corto(largo int default 6)
returns text
language sql volatile as $$
  select string_agg(
    substr('23456789abcdefghijkmnpqrstuvwxyz', floor(random() * 32)::int + 1, 1),
    ''
  )
  from generate_series(1, largo)
$$;

-- 'autor' apunta a 'perfiles' y no a 'auth.users' a propósito: PostgREST solo
-- puede traer el nombre del autor junto con la fila (`perfiles:autor(nombre)`)
-- si existe esa clave foránea. Como 'perfiles.id' referencia a 'auth.users', la
-- integridad es la misma; lo que se gana es poder mostrar quién publicó cada
-- cosa sin una segunda consulta.
create table if not exists programas (
  id text primary key default id_corto(),
  sala uuid not null references salas on delete cascade,
  autor uuid not null references perfiles on delete cascade,
  titulo text,
  codigo text not null,
  creado timestamptz not null default now()
);

-- 'contenido' guarda el .md del ejercicio tal cual: el mismo formato que
-- leerEjercicio() ya sabe leer. Publicar no inventa un formato nuevo.
-- 'contenido' es el .md (enunciado y casos). 'codigo' es el seudocódigo que
-- acompaña al ejercicio: la solución de referencia, o el andamiaje desde el que
-- se arranca. Va aparte y puede ser nulo porque un ejercicio se sostiene solo
-- con su enunciado; el código es opcional, igual que en `soluciones/`.
-- 'sala' nula significa que el ejercicio es personal: está en el taller privado
-- de quien lo escribió y nadie más lo ve. Es donde se guardan los borradores y
-- las copias que un alumno se lleva de la sala. Publicar es, literalmente,
-- ponerle una sala.
create table if not exists ejercicios (
  id text primary key default id_corto(),
  sala uuid references salas on delete cascade,
  autor uuid not null references perfiles on delete cascade,
  titulo text not null,
  contenido text not null,
  codigo text,
  creado timestamptz not null default now()
);

create index if not exists programas_por_sala on programas (sala, creado desc);
create index if not exists ejercicios_por_sala on ejercicios (sala, creado desc);

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------

-- SECURITY DEFINER a propósito: si esta consulta pasara por RLS, la política de
-- 'miembros' se llamaría a sí misma y Postgres cortaría por recursión infinita.
create or replace function es_miembro(s uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from miembros where sala = s and usuario = auth.uid()
  )
$$;

create or replace function es_docente(s uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from miembros
    where sala = s and usuario = auth.uid() and rol = 'docente'
  )
$$;

alter table perfiles enable row level security;
alter table salas enable row level security;
alter table miembros enable row level security;
alter table programas enable row level security;
alter table ejercicios enable row level security;

-- Perfiles: visibles para cualquiera que haya iniciado sesión (hay que poder
-- mostrar el nombre del autor), editables solo por su dueño.
drop policy if exists "perfiles visibles" on perfiles;
create policy "perfiles visibles" on perfiles
  for select to authenticated using (true);

drop policy if exists "editar mi perfil" on perfiles;
create policy "editar mi perfil" on perfiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Salas: solo se ven las propias. Para entrar a una nueva se usa unirse_a_sala,
-- así el código de sala no sirve para listar las salas de los demás.
drop policy if exists "ver mis salas" on salas;
create policy "ver mis salas" on salas
  for select to authenticated using (es_miembro(id));

drop policy if exists "crear sala" on salas;
create policy "crear sala" on salas
  for insert to authenticated with check (docente = auth.uid());

drop policy if exists "el docente edita su sala" on salas;
create policy "el docente edita su sala" on salas
  for update to authenticated using (docente = auth.uid()) with check (docente = auth.uid());

drop policy if exists "el docente borra su sala" on salas;
create policy "el docente borra su sala" on salas
  for delete to authenticated using (docente = auth.uid());

-- Miembros: cada quien ve la lista de sus salas y puede irse; el docente manda.
drop policy if exists "ver miembros de mis salas" on miembros;
create policy "ver miembros de mis salas" on miembros
  for select to authenticated using (es_miembro(sala));

drop policy if exists "salir de la sala" on miembros;
create policy "salir de la sala" on miembros
  for delete to authenticated using (usuario = auth.uid() or es_docente(sala));

-- Programas y ejercicios: se leen si sos miembro; se escriben solo en tu propia
-- sala y a tu propio nombre. Borra el autor o el docente de la sala.
drop policy if exists "leer programas de mis salas" on programas;
create policy "leer programas de mis salas" on programas
  for select to authenticated using (es_miembro(sala));

drop policy if exists "compartir programa" on programas;
create policy "compartir programa" on programas
  for insert to authenticated with check (es_miembro(sala) and autor = auth.uid());

drop policy if exists "editar mi programa" on programas;
create policy "editar mi programa" on programas
  for update to authenticated using (autor = auth.uid()) with check (autor = auth.uid());

drop policy if exists "borrar programa" on programas;
create policy "borrar programa" on programas
  for delete to authenticated using (autor = auth.uid() or es_docente(sala));

-- Se ve un ejercicio si está publicado en una sala tuya, o si es tuyo y privado.
drop policy if exists "leer ejercicios de mis salas" on ejercicios;
create policy "leer ejercicios de mis salas" on ejercicios
  for select to authenticated
  using (
    (sala is not null and es_miembro(sala))
    or (sala is null and autor = auth.uid())
  );

drop policy if exists "publicar ejercicio" on ejercicios;
create policy "publicar ejercicio" on ejercicios
  for insert to authenticated
  with check (
    autor = auth.uid()
    and (sala is null or es_miembro(sala))
  );

-- El `with check` mira la fila *después* del cambio: sin la condición de la
-- sala, alguien podría mover un ejercicio propio a una sala a la que no
-- pertenece con solo cambiar el id.
drop policy if exists "editar mi ejercicio" on ejercicios;
create policy "editar mi ejercicio" on ejercicios
  for update to authenticated
  using (autor = auth.uid())
  with check (
    autor = auth.uid()
    and (sala is null or es_miembro(sala))
  );

drop policy if exists "borrar ejercicio" on ejercicios;
create policy "borrar ejercicio" on ejercicios
  for delete to authenticated
  using (autor = auth.uid() or (sala is not null and es_docente(sala)));

-- ------------------------------------------------------------------
-- Operaciones que no se pueden expresar como política
-- ------------------------------------------------------------------

-- Crear una sala y quedar como docente en un solo paso: si fueran dos
-- llamadas y la segunda fallara, quedaría una sala sin dueño adentro.
create or replace function crear_sala(p_nombre text)
returns table (id uuid, codigo text)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_codigo text;
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión para crear una sala.';
  end if;

  -- Reintentar ante el choque (improbable) de dos códigos iguales.
  for intento in 1..10 loop
    v_codigo := upper(id_corto(6));
    begin
      insert into salas (codigo, nombre, docente)
      values (v_codigo, p_nombre, auth.uid())
      returning salas.id into v_id;
      exit;
    exception when unique_violation then
      v_codigo := null;
    end;
  end loop;

  if v_id is null then
    raise exception 'No se pudo generar un código de sala. Probá de nuevo.';
  end if;

  insert into miembros (sala, usuario, rol) values (v_id, auth.uid(), 'docente');
  return query select v_id, v_codigo;
end $$;

-- Unirse por código. Es SECURITY DEFINER para poder encontrar la sala sin que
-- la política de SELECT (que exige ser miembro) lo impida: el huevo y la gallina.
create or replace function unirse_a_sala(p_codigo text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sala uuid;
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión para entrar a una sala.';
  end if;

  select id into v_sala from salas where codigo = upper(trim(p_codigo));
  if v_sala is null then
    raise exception 'No existe una sala con ese código.';
  end if;

  insert into miembros (sala, usuario) values (v_sala, auth.uid())
  on conflict (sala, usuario) do nothing;

  return v_sala;
end $$;

-- ------------------------------------------------------------------
-- Una sala nunca se queda sin docente
-- ------------------------------------------------------------------

-- Va en un trigger y no dentro de las funciones de abajo porque las políticas
-- RLS ya permiten borrar y actualizar miembros directamente por la API. Una
-- regla que solo viven en la función se saltea llamando al endpoint a mano; en
-- el trigger se cumple siempre, venga de donde venga.
create or replace function proteger_ultimo_docente()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sala uuid := coalesce(old.sala, new.sala);
begin
  -- Si la sala misma se está borrando, sus miembros se van con ella y no hay
  -- nada que proteger.
  if not exists (select 1 from salas where id = v_sala) then
    return null;
  end if;

  if not exists (select 1 from miembros where sala = v_sala and rol = 'docente') then
    raise exception 'La sala se quedaría sin ningún docente.';
  end if;
  return null;
end $$;

drop trigger if exists sala_con_docente on miembros;
create constraint trigger sala_con_docente
  after update or delete on miembros
  deferrable initially immediate
  for each row execute function proteger_ultimo_docente();

-- ------------------------------------------------------------------
-- Operaciones
-- ------------------------------------------------------------------

create or replace function cambiar_rol(p_sala uuid, p_usuario uuid, p_rol text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_docente(p_sala) then
    raise exception 'Solo un docente de la sala puede cambiar roles.';
  end if;
  if p_rol not in ('docente', 'alumno') then
    raise exception 'El rol tiene que ser docente o alumno.';
  end if;

  update miembros set rol = p_rol where sala = p_sala and usuario = p_usuario;
  if not found then
    raise exception 'Esa persona no está en la sala.';
  end if;
end $$;

create or replace function quitar_miembro(p_sala uuid, p_usuario uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Cada quien puede irse de una sala; sacar a otro es cosa del docente.
  if p_usuario <> auth.uid() and not es_docente(p_sala) then
    raise exception 'Solo un docente de la sala puede sacar a alguien.';
  end if;

  delete from miembros where sala = p_sala and usuario = p_usuario;
  if not found then
    raise exception 'Esa persona no está en la sala.';
  end if;
end $$;

-- ------------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------------

-- Los eventos respetan RLS: nadie recibe novedades de una sala ajena.
--
-- 'alter publication ... add table' falla si la tabla ya está, y este archivo
-- tiene que poder correrse dos veces sin romperse: al reejecutarlo después de
-- un corte, ese error abortaría todo lo demás.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'programas'
  ) then
    alter publication supabase_realtime add table programas;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ejercicios'
  ) then
    alter publication supabase_realtime add table ejercicios;
  end if;
end $$;

-- ------------------------------------------------------------------
-- Refrescar la API
-- ------------------------------------------------------------------

-- PostgREST guarda en caché qué funciones existen. Sin este aviso, las tablas
-- nuevas aparecen pero las funciones no, y llamarlas da "Could not find the
-- function public.X in the schema cache" (PGRST202) aunque estén creadas.
notify pgrst, 'reload schema';
