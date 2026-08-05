-- Asignar un ejercicio a la clase es cosa del docente.
--
-- Las políticas pedían solo `es_miembro`, así que cualquier alumno podía poner
-- un ejercicio en la sala —directamente o por la API— y aparecerle a todo el
-- curso como tarea. Escribir ejercicios propios sigue permitido: lo que pasa a
-- estar reservado es darlos a la clase.
--
-- Va en la base y no solo en la interfaz porque esconder un botón no es una
-- regla: quien hable directo con la API se lo saltea.
--
-- Se puede correr más de una vez.

-- Crear con sala (publicar de una) exige ser docente de esa sala. Sin sala
-- —un borrador privado— lo puede crear cualquiera.
drop policy if exists "publicar ejercicio" on ejercicios;
create policy "publicar ejercicio" on ejercicios
  for insert to authenticated
  with check (
    autor = auth.uid()
    and (sala is null or es_docente(sala))
  );

-- Y ponerle sala después —el botón Asignar— es el mismo permiso.
drop policy if exists "editar mi ejercicio" on ejercicios;
create policy "editar mi ejercicio" on ejercicios
  for update to authenticated
  using (autor = auth.uid())
  with check (
    autor = auth.uid()
    and (sala is null or es_docente(sala))
  );

notify pgrst, 'reload schema';
