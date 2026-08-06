-- Las entregas dejan de ser públicas dentro de la sala.
--
-- La política pedía solo `es_miembro`, así que cualquier alumno podía leer el
-- código de todos sus compañeros. Mientras un ejercicio está abierto eso es una
-- invitación a copiar, y peor: silenciosa, porque nadie se entera.
--
-- Ahora, por defecto, cada quien ve la suya y el docente ve todas. El docente
-- puede abrirlas para la clase cuando quiera —terminado el ejercicio, comparar
-- soluciones es una buena actividad— con un interruptor por sala.
--
-- El valor por defecto es el seguro: si alguien se olvida de configurarlo, se
-- olvida hacia el lado que no hace daño.
--
-- Se puede correr más de una vez.

alter table salas add column if not exists entregas_visibles boolean not null default false;

-- SECURITY DEFINER por lo mismo que `es_miembro`: si esta consulta pasara por
-- RLS, leer 'salas' desde una política de 'programas' encadenaría comprobaciones
-- innecesarias en cada fila.
create or replace function entregas_a_la_vista(s uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select entregas_visibles from salas where id = s), false)
$$;

drop policy if exists "leer programas de mis salas" on programas;
create policy "leer programas de mis salas" on programas
  for select to authenticated
  using (
    autor = auth.uid()
    or es_docente(sala)
    or (es_miembro(sala) and entregas_a_la_vista(sala))
  );

-- Solo el docente abre y cierra la vista de la clase.
create or replace function ver_entregas(p_sala uuid, p_visibles boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_docente(p_sala) then
    raise exception 'Solo un docente de la sala puede cambiar esto.';
  end if;
  update salas set entregas_visibles = p_visibles where id = p_sala;
end $$;

notify pgrst, 'reload schema';
