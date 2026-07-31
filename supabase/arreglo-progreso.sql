-- Progreso de la clase: cómo va cada alumno en cada ejercicio.
--
-- Una fila por (sala, ejercicio, alumno), que se pisa en cada verificación. No
-- se guarda el historial de intentos: al docente le sirve saber cómo está la
-- clase *ahora* para decidir si sigue o si para a explicar algo. Guardar cada
-- intento haría crecer la tabla sin darle nada mejor.
--
-- Tampoco se guarda el código del alumno. El panel dice quién está trabado y
-- en qué caso; leerle el programa por encima del hombro es otra cosa, y no
-- hace falta para enseñar.
--
-- Se puede correr más de una vez.

create table if not exists progreso (
  sala uuid not null references salas on delete cascade,
  ejercicio text not null references ejercicios on delete cascade,
  alumno uuid not null references perfiles on delete cascade,
  aprobados int not null,
  total int not null,
  -- Nombres de los casos que fallaron. Es lo que permite ver que media clase
  -- se traba en el mismo, que es la información que cambia lo que hacés.
  fallados text[] not null default '{}',
  intentos int not null default 1,
  actualizado timestamptz not null default now(),
  primary key (sala, ejercicio, alumno)
);

create index if not exists progreso_por_sala on progreso (sala, actualizado desc);

alter table progreso enable row level security;

-- El docente ve toda su sala; el alumno, solo lo suyo. Que un alumno pueda ver
-- en qué falla el de al lado no aporta nada y sí puede incomodar.
drop policy if exists "ver progreso" on progreso;
create policy "ver progreso" on progreso
  for select to authenticated
  using (alumno = auth.uid() or es_docente(sala));

drop policy if exists "registrar mi progreso" on progreso;
create policy "registrar mi progreso" on progreso
  for insert to authenticated
  with check (alumno = auth.uid() and es_miembro(sala));

drop policy if exists "actualizar mi progreso" on progreso;
create policy "actualizar mi progreso" on progreso
  for update to authenticated
  using (alumno = auth.uid())
  with check (alumno = auth.uid() and es_miembro(sala));

-- El docente puede limpiar el progreso de su sala (al empezar una clase nueva).
drop policy if exists "borrar progreso" on progreso;
create policy "borrar progreso" on progreso
  for delete to authenticated
  using (alumno = auth.uid() or es_docente(sala));

-- Cuenta los intentos sin que el cliente tenga que leer antes para incrementar:
-- dos alumnos verificando a la vez se pisarían el contador.
create or replace function registrar_progreso(
  p_sala uuid,
  p_ejercicio text,
  p_aprobados int,
  p_total int,
  p_fallados text[]
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_miembro(p_sala) then
    raise exception 'No sos miembro de esa sala.';
  end if;

  insert into progreso (sala, ejercicio, alumno, aprobados, total, fallados)
  values (p_sala, p_ejercicio, auth.uid(), p_aprobados, p_total, p_fallados)
  on conflict (sala, ejercicio, alumno) do update
    set aprobados = excluded.aprobados,
        total = excluded.total,
        fallados = excluded.fallados,
        intentos = progreso.intentos + 1,
        actualizado = now();
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'progreso'
  ) then
    alter publication supabase_realtime add table progreso;
  end if;
end $$;

notify pgrst, 'reload schema';
