-- Ejercicios personales: el taller privado de cada usuario.
--
-- 'sala' pasa a poder ser nula. Nula significa que el ejercicio es privado de su
-- autor: ahí viven los borradores que todavía no se publicaron y las copias que
-- alguien se lleva de una sala. Publicar es, literalmente, ponerle una sala.
--
-- Se puede correr más de una vez.

alter table ejercicios alter column sala drop not null;

-- Las políticas se rehacen para contemplar el caso privado. Sin esto, un
-- ejercicio sin sala no lo vería ni su propio autor: 'es_miembro(null)' es null,
-- y en RLS lo que no es verdadero, no pasa.

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

drop policy if exists "borrar ejercicio" on ejercicios;
create policy "borrar ejercicio" on ejercicios
  for delete to authenticated
  using (autor = auth.uid() or (sala is not null and es_docente(sala)));

notify pgrst, 'reload schema';
