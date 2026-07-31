-- Compartir una solución reemplaza la anterior en vez de duplicarla.
--
-- Antes cada clic en "Compartir mi solución" insertaba una fila nueva: un
-- alumno que compartía, corregía y volvía a compartir dejaba tres entradas
-- suyas del mismo ejercicio, y el docente no sabía cuál mirar.
--
-- Ahora una persona tiene una sola solución por ejercicio en cada sala.
-- Compartir de nuevo la actualiza.
--
-- Se puede correr más de una vez.

-- A qué ejercicio responde la solución. Nula para código suelto, que no
-- responde a ninguno; ahí la unicidad es por sala y autor.
alter table programas add column if not exists ejercicio text references ejercicios on delete set null;

create or replace function compartir_solucion(
  p_sala uuid,
  p_ejercicio text,
  p_titulo text,
  p_codigo text
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  if not es_miembro(p_sala) then
    raise exception 'No sos miembro de esa sala.';
  end if;

  -- 'coalesce' porque en SQL NULL nunca es igual a NULL: sin esto, el código
  -- suelto (sin ejercicio) no encontraría nunca su propia fila y duplicaría.
  update programas
     set titulo = p_titulo,
         codigo = p_codigo,
         creado = now()
   where sala = p_sala
     and autor = auth.uid()
     and coalesce(ejercicio, '') = coalesce(p_ejercicio, '')
  returning id into v_id;

  if v_id is null then
    insert into programas (sala, autor, ejercicio, titulo, codigo)
    values (p_sala, auth.uid(), p_ejercicio, p_titulo, p_codigo)
    returning id into v_id;
  end if;

  return v_id;
end $$;

notify pgrst, 'reload schema';
