-- Publicar deja de ser "crear otro" y pasa a ser "cambiarle el estado".
--
-- Un ejercicio es siempre el mismo registro: sin sala es un borrador, con sala
-- está publicado. Publicar es un UPDATE que le pone la sala, no un INSERT nuevo.
-- Así deja de haber forma de terminar con dos filas para la misma cosa.
--
-- De paso cierra un agujero: la política de edición solo miraba el autor, así
-- que alguien podía mover un ejercicio propio a una sala ajena con solo cambiar
-- el id. Ahora la sala de destino tiene que ser una a la que pertenece.
--
-- Se puede correr más de una vez.

drop policy if exists "editar mi ejercicio" on ejercicios;
create policy "editar mi ejercicio" on ejercicios
  for update to authenticated
  using (autor = auth.uid())
  with check (
    autor = auth.uid()
    and (sala is null or es_miembro(sala))
  );

notify pgrst, 'reload schema';
