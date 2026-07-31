-- Agrega el código que acompaña a un ejercicio publicado.
--
-- Al publicar viaja el .md (enunciado y casos) y además el seudocódigo que hay
-- en el editor, para que abrir el ejercicio desde la sala cargue las dos cosas,
-- como hace el desplegable local con `soluciones/`.
--
-- Es nulo a propósito: los ejercicios publicados antes de este cambio siguen
-- siendo válidos, solo que abren el enunciado sin tocar el editor.
--
-- Se puede correr más de una vez.

alter table ejercicios add column if not exists codigo text;

notify pgrst, 'reload schema';
