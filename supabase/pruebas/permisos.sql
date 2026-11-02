-- Pruebas de permisos: lo que cada quien NO tiene que poder ver ni hacer.
--
-- Los datos son de alumnos, muchos menores, y la seguridad vive entera en RLS
-- y en las funciones: la clave del navegador es pública. Ya hubo dos agujeros
-- (entregas legibles por toda la sala, alumnos que asignaban tarea) que solo se
-- vieron usando la app. Esto los prueba como los probaría alguien hablando
-- directo con la API: cada bloque corre con el rol y el usuario de esa persona.
--
-- Corre sobre una base recién armada con supabase-simulado.sql y las
-- migraciones; lo hace correr.sh. Ante el primer fallo se detiene con el motivo.

create schema pruebas;
grant usage on schema pruebas to anon, authenticated;

-- Cuántas filas devuelve (o toca, con 'returning') una sentencia.
create function pruebas.cuenta(sentencia text, esperado bigint, que text) returns void
language plpgsql as $$
declare n bigint;
begin
  execute 'with r as (' || sentencia || ') select count(*) from r' into n;
  if n <> esperado then
    raise exception 'FALLÓ: % (esperaba %, hubo %)', que, esperado, n;
  end if;
end $$;

-- La sentencia tiene que ser rechazada, por RLS o por la función.
create function pruebas.falla(sentencia text, que text) returns void
language plpgsql as $$
begin
  begin
    execute sentencia;
  exception when others then
    return;
  end;
  raise exception 'FALLÓ: % (debía rechazarse y pasó)', que;
end $$;

grant execute on all functions in schema pruebas to anon, authenticated;

\set docente '00000000-0000-0000-0000-00000000000d'
\set alumna '00000000-0000-0000-0000-0000000000a1'
\set alumno '00000000-0000-0000-0000-0000000000a2'
\set ajeno '00000000-0000-0000-0000-0000000000e0'

insert into auth.users (id, email) values
  (:'docente', 'docente@prueba'),
  (:'alumna', 'alumna@prueba'),
  (:'alumno', 'alumno@prueba'),
  (:'ajeno', 'ajeno@prueba');

-- ------------------------------------------------------------------
-- La clase: el docente crea la sala y publica un ejercicio; la alumna
-- entrega y verifica; el alumno solo entra. 'ajeno' es de otra escuela.
-- ------------------------------------------------------------------

set role authenticated;

set request.jwt.claim.sub = :'docente';
select id as sala, codigo from crear_sala('Prueba') \gset
insert into ejercicios (id, sala, autor, titulo, contenido)
values ('ej1', :'sala', :'docente', 'Sumar', 'Sumá dos números.');

set request.jwt.claim.sub = :'alumna';
select unirse_a_sala(:'codigo');
select compartir_solucion(:'sala', 'ej1', 'Mi suma', 'Inicio Fin');
select registrar_progreso(:'sala', 'ej1', 1, 2, '{caso 2}');

set request.jwt.claim.sub = :'alumno';
select unirse_a_sala(:'codigo');

-- ------------------------------------------------------------------
-- Un alumno, con las entregas cerradas (el valor por defecto)
-- ------------------------------------------------------------------

select pruebas.cuenta('select * from programas', 0,
  'un alumno no ve la entrega de una compañera');
select pruebas.cuenta('select * from progreso', 0,
  'un alumno no ve el progreso de una compañera');
select pruebas.cuenta('update programas set codigo = ''x'' returning 1', 0,
  'un alumno no puede editar la entrega de otra');
select pruebas.cuenta('delete from programas returning 1', 0,
  'un alumno no puede borrar la entrega de otra');
select pruebas.falla(format('select ver_entregas(%L, true)', :'sala'),
  'un alumno no puede abrir las entregas de la clase');
select pruebas.falla(format(
  'insert into ejercicios (sala, autor, titulo, contenido) values (%L, %L, ''x'', ''y'')',
  :'sala', :'alumno'),
  'un alumno no puede asignar tarea a la clase');
select pruebas.falla(format('select cambiar_rol(%L, %L, ''docente'')', :'sala', :'alumno'),
  'un alumno no se puede hacer docente');
select pruebas.cuenta(format(
  'update miembros set rol = ''docente'' where usuario = %L returning 1', :'alumno'), 0,
  'un alumno no se puede hacer docente editando la tabla directo');
select pruebas.falla(format('select quitar_miembro(%L, %L)', :'sala', :'alumna'),
  'un alumno no puede sacar a otra de la sala');
select pruebas.cuenta(format(
  'delete from miembros where usuario = %L returning 1', :'alumna'), 0,
  'un alumno no puede sacar a otra borrando la fila directo');
select pruebas.falla(format(
  'insert into programas (sala, autor, codigo) values (%L, %L, ''x'')', :'sala', :'alumna'),
  'un alumno no puede entregar a nombre de otra');

-- ------------------------------------------------------------------
-- Alguien que no es de la sala
-- ------------------------------------------------------------------

set request.jwt.claim.sub = :'ajeno';

select pruebas.cuenta('select * from salas', 0, 'quien no es de la sala no la ve');
select pruebas.cuenta('select * from miembros', 0, 'ni ve quiénes están');
select pruebas.cuenta('select * from ejercicios', 0, 'ni sus ejercicios');
select pruebas.cuenta('select * from programas', 0, 'ni sus entregas');
select pruebas.cuenta('select * from progreso', 0, 'ni el progreso');
select pruebas.falla(format(
  'insert into programas (sala, autor, codigo) values (%L, %L, ''x'')', :'sala', :'ajeno'),
  'quien no es de la sala no puede escribir en ella');
select pruebas.falla(format('select compartir_solucion(%L, null, ''t'', ''c'')', :'sala'),
  'quien no es de la sala no puede entregar');
select pruebas.falla(format('select registrar_progreso(%L, ''ej1'', 1, 1, ''{}'')', :'sala'),
  'quien no es de la sala no puede registrar progreso');
select pruebas.falla(format('select ver_entregas(%L, true)', :'sala'),
  'quien no es de la sala no puede abrir sus entregas');

-- ------------------------------------------------------------------
-- El docente
-- ------------------------------------------------------------------

set request.jwt.claim.sub = :'docente';

select pruebas.cuenta('select * from programas', 1, 'el docente ve las entregas');
select pruebas.cuenta('select * from progreso', 1, 'el docente ve el progreso');
select pruebas.falla(format('select quitar_miembro(%L, %L)', :'sala', :'docente'),
  'la sala no se puede quedar sin docente');

select ver_entregas(:'sala', true);

-- Abiertas las entregas, la clase las ve; alguien de afuera sigue sin verlas.
set request.jwt.claim.sub = :'alumno';
select pruebas.cuenta('select * from programas', 1,
  'con las entregas abiertas, la clase las ve');
select pruebas.cuenta('select * from progreso', 0,
  'abrir las entregas no abre el progreso');
set request.jwt.claim.sub = :'ajeno';
select pruebas.cuenta('select * from programas', 0,
  'abrir las entregas no las abre fuera de la sala');

-- ------------------------------------------------------------------
-- Sin iniciar sesión (la clave publishable sola)
-- ------------------------------------------------------------------

reset request.jwt.claim.sub;
set role anon;

select pruebas.cuenta('select * from perfiles', 0, 'sin sesión no se ven perfiles');
select pruebas.cuenta('select * from salas', 0, 'sin sesión no se ven salas');
select pruebas.cuenta('select * from programas', 0, 'sin sesión no se ven entregas');
select pruebas.falla('select crear_sala(''x'')', 'sin sesión no se crean salas');
select pruebas.falla(format('select unirse_a_sala(%L)', :'codigo'),
  'sin sesión no se entra a una sala');

reset role;
