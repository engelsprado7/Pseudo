-- Dos reglas que dependían de que nadie hablara directo con la API.
--
-- 1. Quién manda en una sala lo decide 'miembros.rol', no 'salas.docente'.
--
--    'salas.docente' guarda quién la creó. Desde que los roles se pueden
--    cambiar, eso dejó de ser lo mismo que "quién manda": alguien bajado a
--    alumno seguía pudiendo borrar la sala entera, y un colega promovido a
--    docente no podía ni renombrarla. Eran dos fuentes de verdad para lo mismo.
--
--    La columna se conserva como dato histórico —sirve para saber quién la
--    creó— pero deja de decidir permisos.
--
-- 2. Una persona, una entrega por ejercicio.
--
--    La regla estaba solo dentro de 'compartir_solucion', y la política de
--    INSERT permitía duplicar llamando al endpoint a mano. Ahora es un índice
--    único: se cumpla o no la función, la base no acepta dos.
--
-- Se puede correr más de una vez.

-- ------------------------------------------------------------------
-- 1. Permisos de sala según el rol real
-- ------------------------------------------------------------------

drop policy if exists "el docente edita su sala" on salas;
create policy "el docente edita su sala" on salas
  for update to authenticated
  using (es_docente(id))
  with check (es_docente(id));

drop policy if exists "el docente borra su sala" on salas;
create policy "el docente borra su sala" on salas
  for delete to authenticated
  using (es_docente(id));

-- 'crear sala' se queda como está: al crearla todavía no hay fila en 'miembros'
-- contra la cual preguntar, y quien la crea solo puede ponerse a sí mismo.

-- ------------------------------------------------------------------
-- 2. Una entrega por persona y ejercicio
-- ------------------------------------------------------------------

-- Primero se limpian los duplicados que hayan quedado, conservando el más
-- reciente: es el que refleja en qué quedó esa persona.
delete from programas p
where exists (
  select 1 from programas q
  where q.sala = p.sala
    and q.autor = p.autor
    and coalesce(q.ejercicio, '') = coalesce(p.ejercicio, '')
    and (q.creado > p.creado or (q.creado = p.creado and q.id > p.id))
);

-- 'coalesce' porque en un índice único los NULL se consideran distintos entre
-- sí, y el código suelto (sin ejercicio) volvería a poder duplicarse.
create unique index if not exists programas_una_entrega
  on programas (sala, autor, coalesce(ejercicio, ''));

notify pgrst, 'reload schema';
