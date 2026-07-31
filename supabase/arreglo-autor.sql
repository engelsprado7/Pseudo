-- Corrige a qué tabla apunta 'autor' en programas y ejercicios.
--
-- Apuntaban a 'auth.users', y con eso PostgREST no puede traer el nombre del
-- autor embebido (`perfiles:autor(nombre)`): da "Could not find a relationship
-- between 'ejercicios' and 'autor'". Pasan a apuntar a 'perfiles', que a su vez
-- referencia a 'auth.users', así que la integridad no cambia.
--
-- Solo hace falta en bases creadas con la versión anterior de `esquema.sql`.
-- Se puede correr más de una vez.

-- Primero, un perfil para cada usuario que ya existe. Sin esto, la nueva clave
-- foránea no podría crearse si alguien se registró antes de que el trigger
-- estuviera puesto.
insert into perfiles (id, nombre, avatar_url)
select
  u.id,
  coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    u.email
  ),
  u.raw_user_meta_data->>'avatar_url'
from auth.users u
on conflict (id) do nothing;

alter table programas drop constraint if exists programas_autor_fkey;
alter table programas add constraint programas_autor_fkey
  foreign key (autor) references perfiles (id) on delete cascade;

alter table ejercicios drop constraint if exists ejercicios_autor_fkey;
alter table ejercicios add constraint ejercicios_autor_fkey
  foreign key (autor) references perfiles (id) on delete cascade;

notify pgrst, 'reload schema';
