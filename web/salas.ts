/**
 * Salas de clase: publicar ejercicios y programas, y verlos aparecer en vivo.
 *
 * Cada operación devuelve un `Resultado` en vez de lanzar. El motivo es el
 * mismo de siempre: un error de red o un permiso denegado tienen que poder
 * mostrarse como un mensaje en español, no romper el editor.
 *
 * El contenido de un ejercicio es el `.md` tal cual, el mismo formato de
 * `ejercicios/*.md`. Publicar no inventa un formato nuevo: lo que se guarda lo
 * lee `leerEjercicio()` sin tocar nada.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { cliente } from "./nube.ts";

export type Resultado<T> = { ok: true; dato: T } | { ok: false; mensaje: string };

export interface Sala {
  id: string;
  codigo: string;
  nombre: string;
  rol: "docente" | "alumno";
}

export interface Publicacion {
  id: string;
  titulo: string;
  autor: string;
  creado: string;
}

const SIN_NUBE = "No hay nube configurada en este sitio.";

/** Traduce el error de Postgres a algo que un docente pueda entender. */
function explicarError(mensaje: string): string {
  if (/row-level security|permission denied/i.test(mensaje)) {
    return "No tenés permiso para eso. ¿Seguís siendo miembro de la sala?";
  }
  if (/Failed to fetch|NetworkError/i.test(mensaje)) {
    return "No se pudo conectar. Revisá la conexión a internet.";
  }
  return mensaje;
}

// ------------------------------------------------------------------
// Salas
// ------------------------------------------------------------------

export async function misSalas(): Promise<Resultado<Sala[]>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("miembros")
    .select("rol, salas ( id, codigo, nombre )");

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };

  const salas: Sala[] = [];
  for (const fila of data as unknown as Array<{
    rol: "docente" | "alumno";
    salas: { id: string; codigo: string; nombre: string } | null;
  }>) {
    if (fila.salas === null) continue;
    salas.push({ ...fila.salas, rol: fila.rol });
  }
  return { ok: true, dato: salas };
}

export async function crearSala(nombre: string): Promise<Resultado<Sala>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c.rpc("crear_sala", { p_nombre: nombre }).single();
  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };

  const fila = data as { id: string; codigo: string };
  return { ok: true, dato: { id: fila.id, codigo: fila.codigo, nombre, rol: "docente" } };
}

export async function unirseASala(codigo: string): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c.rpc("unirse_a_sala", { p_codigo: codigo });
  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: data as string };
}

// ------------------------------------------------------------------
// Publicaciones
// ------------------------------------------------------------------

/** Filas crudas con el perfil embebido, como las devuelve PostgREST. */
interface FilaPublicacion {
  id: string;
  titulo: string | null;
  creado: string;
  perfiles: { nombre: string | null } | null;
}

function aPublicaciones(filas: FilaPublicacion[], porDefecto: string): Publicacion[] {
  return filas.map((f) => ({
    id: f.id,
    titulo: f.titulo ?? porDefecto,
    autor: f.perfiles?.nombre ?? "Alguien",
    creado: f.creado,
  }));
}

export async function listarEjercicios(sala: string): Promise<Resultado<Publicacion[]>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("ejercicios")
    .select("id, titulo, creado, perfiles:autor ( nombre )")
    .eq("sala", sala)
    .order("creado", { ascending: false })
    .limit(100);

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: aPublicaciones(data as unknown as FilaPublicacion[], "Sin título") };
}

export async function listarProgramas(sala: string): Promise<Resultado<Publicacion[]>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("programas")
    .select("id, titulo, creado, perfiles:autor ( nombre )")
    .eq("sala", sala)
    .order("creado", { ascending: false })
    .limit(100);

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: aPublicaciones(data as unknown as FilaPublicacion[], "Sin título") };
}

/**
 * Guarda un ejercicio sin sala: queda en el taller privado del autor.
 *
 * Es el mismo registro que uno publicado, solo que sin sala. Publicarlo después
 * es agregarle una, no copiarlo a otro lado.
 */
export async function guardarEjercicioPersonal(
  titulo: string,
  contenido: string,
  codigo: string | null,
): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data: sesion } = await c.auth.getUser();
  if (sesion.user === null) return { ok: false, mensaje: "Hay que iniciar sesión." };

  const { data, error } = await c
    .from("ejercicios")
    .insert({ sala: null, autor: sesion.user.id, titulo, contenido, codigo })
    .select("id")
    .single();

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: (data as { id: string }).id };
}

/** Ejercicios propios sin publicar. */
export async function misEjercicios(): Promise<Resultado<Publicacion[]>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("ejercicios")
    .select("id, titulo, creado, perfiles:autor ( nombre )")
    .is("sala", null)
    .order("creado", { ascending: false })
    .limit(100);

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: aPublicaciones(data as unknown as FilaPublicacion[], "Sin título") };
}

export async function publicarEjercicio(
  sala: string,
  titulo: string,
  contenido: string,
  codigo: string | null,
): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data: sesion } = await c.auth.getUser();
  if (sesion.user === null) return { ok: false, mensaje: "Hay que iniciar sesión." };

  const { data, error } = await c
    .from("ejercicios")
    .insert({ sala, autor: sesion.user.id, titulo, contenido, codigo })
    .select("id")
    .single();

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: (data as { id: string }).id };
}

export async function compartirPrograma(
  sala: string,
  titulo: string,
  codigo: string,
): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data: sesion } = await c.auth.getUser();
  if (sesion.user === null) return { ok: false, mensaje: "Hay que iniciar sesión." };

  const { data, error } = await c
    .from("programas")
    .insert({ sala, autor: sesion.user.id, titulo, codigo })
    .select("id")
    .single();

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: (data as { id: string }).id };
}

export interface EjercicioPublicado {
  /** El `.md`, tal como lo lee `leerEjercicio()`. */
  contenido: string;
  /** Seudocódigo que lo acompaña, o `null` si se publicó sin código. */
  codigo: string | null;
}

export async function traerEjercicio(id: string): Promise<Resultado<EjercicioPublicado>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("ejercicios")
    .select("contenido, codigo")
    .eq("id", id)
    .single();

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  const fila = data as { contenido: string; codigo: string | null };
  return { ok: true, dato: { contenido: fila.contenido, codigo: fila.codigo } };
}

/** Trae el código de un programa compartido (enlace corto `#s=...`). */
export async function traerPrograma(id: string): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("programas")
    .select("codigo")
    .eq("id", id)
    .single();

  if (error !== null) {
    if (/multiple|no rows/i.test(error.message)) {
      return {
        ok: false,
        mensaje: "Ese enlace no existe, o es de una sala a la que no perteneces.",
      };
    }
    return { ok: false, mensaje: explicarError(error.message) };
  }
  return { ok: true, dato: (data as { codigo: string }).codigo };
}

// ------------------------------------------------------------------
// Realtime
// ------------------------------------------------------------------

/**
 * Avisa cuando alguien publica algo en la sala.
 *
 * Al llegar un evento se vuelve a pedir la lista en vez de usar la fila del
 * evento. Es una consulta de más, pero la fila cruda no trae el nombre del
 * autor (el join no viaja en el evento) y en una clase la lista es corta. Vale
 * la simpleza.
 *
 * Los eventos respetan RLS: nadie recibe novedades de una sala ajena.
 */
export async function escucharSala(
  sala: string,
  alCambiar: () => void,
): Promise<(() => void) | null> {
  const c = await cliente();
  if (c === null) return null;

  const canal: RealtimeChannel = c
    .channel(`sala:${sala}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ejercicios", filter: `sala=eq.${sala}` },
      alCambiar,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "programas", filter: `sala=eq.${sala}` },
      alCambiar,
    );

  canal.subscribe();
  return () => void c.removeChannel(canal);
}
