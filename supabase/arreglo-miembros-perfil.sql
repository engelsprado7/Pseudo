-- 'miembros.usuario' pasa a apuntar a 'perfiles'.
--
-- Apuntaba a 'auth.users', y con eso PostgREST no puede traer el nombre de cada
-- miembro embebido (`perfiles:usuario(nombre)`): da "Could not find a
-- relationship between 'miembros' and 'usuario'". Es el mismo arreglo que ya se
-- hizo para 'programas.autor' y 'ejercicios.autor'.
--
-- Como 'perfiles.id' referencia a 'auth.users', la integridad no cambia.
--
-- Se puede correr más de una vez.

-- Un perfil para cada usuario que ya existe, por si alguien se registró antes
-- de que el trigger estuviera puesto. Sin esto la clave foránea no se puede
-- crear: habría miembros sin perfil al que apuntar.
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

alter table miembros drop constraint if exists miembros_usuario_fkey;
alter table miembros add constraint miembros_usuario_fkey
  foreign key (usuario) references perfiles (id) on delete cascade;

notify pgrst, 'reload schema';
