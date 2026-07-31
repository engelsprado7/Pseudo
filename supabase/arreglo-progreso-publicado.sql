-- El progreso solo cuenta para ejercicios publicados en esa sala.
--
-- Antes se registraba cualquier ejercicio, incluidos los borradores privados:
-- abrir un borrador propio y verificarlo mandaba el resultado al panel del
-- docente. Además de ser información que no le corresponde —un borrador es
-- privado por definición—, aparecía sin título, porque la sala no lo conoce.
--
-- La comprobación va en la función y no en una restricción de la tabla porque
-- un ejercicio puede publicarse y despublicarse: lo que hay que exigir es que
-- esté publicado *en el momento de verificar*.
--
-- Se puede correr más de una vez.

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

  if not exists (
    select 1 from ejercicios where id = p_ejercicio and sala = p_sala
  ) then
    raise exception 'Ese ejercicio no está publicado en esta sala.';
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

-- Limpia lo que se haya registrado de borradores antes de este arreglo.
delete from progreso p
where not exists (
  select 1 from ejercicios e where e.id = p.ejercicio and e.sala = p.sala
);

notify pgrst, 'reload schema';
