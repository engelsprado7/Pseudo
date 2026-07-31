-- Gestión de miembros: cambiar roles y quitar gente de la sala.
--
-- El rol vive en la membresía, no en el usuario: alguien puede ser docente en
-- su curso y alumno en la sala de un colega. Google solo dice quién sos; quién
-- da la clase lo decide la clase.
--
-- Se puede correr más de una vez.

-- ------------------------------------------------------------------
-- Una sala nunca se queda sin docente
-- ------------------------------------------------------------------

-- Va en un trigger y no dentro de las funciones de abajo porque las políticas
-- RLS ya permiten borrar y actualizar miembros directamente por la API. Una
-- regla que solo viven en la función se saltea llamando al endpoint a mano; en
-- el trigger se cumple siempre, venga de donde venga.
create or replace function proteger_ultimo_docente()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sala uuid := coalesce(old.sala, new.sala);
begin
  -- Si la sala misma se está borrando, sus miembros se van con ella y no hay
  -- nada que proteger.
  if not exists (select 1 from salas where id = v_sala) then
    return null;
  end if;

  if not exists (select 1 from miembros where sala = v_sala and rol = 'docente') then
    raise exception 'La sala se quedaría sin ningún docente.';
  end if;
  return null;
end $$;

drop trigger if exists sala_con_docente on miembros;
create constraint trigger sala_con_docente
  after update or delete on miembros
  deferrable initially immediate
  for each row execute function proteger_ultimo_docente();

-- ------------------------------------------------------------------
-- Operaciones
-- ------------------------------------------------------------------

create or replace function cambiar_rol(p_sala uuid, p_usuario uuid, p_rol text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_docente(p_sala) then
    raise exception 'Solo un docente de la sala puede cambiar roles.';
  end if;
  if p_rol not in ('docente', 'alumno') then
    raise exception 'El rol tiene que ser docente o alumno.';
  end if;

  update miembros set rol = p_rol where sala = p_sala and usuario = p_usuario;
  if not found then
    raise exception 'Esa persona no está en la sala.';
  end if;
end $$;

create or replace function quitar_miembro(p_sala uuid, p_usuario uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Cada quien puede irse de una sala; sacar a otro es cosa del docente.
  if p_usuario <> auth.uid() and not es_docente(p_sala) then
    raise exception 'Solo un docente de la sala puede sacar a alguien.';
  end if;

  delete from miembros where sala = p_sala and usuario = p_usuario;
  if not found then
    raise exception 'Esa persona no está en la sala.';
  end if;
end $$;

notify pgrst, 'reload schema';
