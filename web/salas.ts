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
  /** Id del autor, para saber si se puede editar sin que RLS tenga que negarlo. */
  autorId: string;
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
// Miembros
// ------------------------------------------------------------------

export interface Miembro {
  id: string;
  nombre: string;
  rol: "docente" | "alumno";
}

export async function listarMiembros(sala: string): Promise<Resultado<Miembro[]>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("miembros")
    .select("usuario, rol, perfiles:usuario ( nombre )")
    .eq("sala", sala);

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };

  const filas = data as unknown as Array<{
    usuario: string;
    rol: "docente" | "alumno";
    perfiles: { nombre: string | null } | null;
  }>;
  return {
    ok: true,
    // Docentes primero, y dentro de cada grupo por nombre: la lista se lee
    // buscando quién manda antes que buscando a alguien en particular.
    dato: filas
      .map((f) => ({ id: f.usuario, nombre: f.perfiles?.nombre ?? "Alguien", rol: f.rol }))
      .sort((a, b) =>
        a.rol === b.rol ? a.nombre.localeCompare(b.nombre) : a.rol === "docente" ? -1 : 1,
      ),
  };
}

export async function cambiarRol(
  sala: string,
  usuario: string,
  rol: "docente" | "alumno",
): Promise<Resultado<null>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { error } = await c.rpc("cambiar_rol", {
    p_sala: sala,
    p_usuario: usuario,
    p_rol: rol,
  });
  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: null };
}

export async function quitarMiembro(sala: string, usuario: string): Promise<Resultado<null>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { error } = await c.rpc("quitar_miembro", { p_sala: sala, p_usuario: usuario });
  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: null };
}

// ------------------------------------------------------------------
// Progreso de la clase
// ------------------------------------------------------------------

export interface FilaProgreso {
  ejercicio: string;
  alumno: string;
  aprobados: number;
  total: number;
  fallados: string[];
  intentos: number;
}

/** Resumen por ejercicio, que es como el docente lo mira. */
export interface ResumenEjercicio {
  ejercicio: string;
  titulo: string;
  aprobaron: number;
  intentaron: number;
  /** Casos que más gente falla, del peor al mejor. */
  casosDificiles: Array<{ nombre: string; cuantos: number }>;
}

/** Registra cómo le fue al alumno. Silencioso: no debe estorbar al verificar. */
export async function registrarProgreso(
  sala: string,
  ejercicio: string,
  aprobados: number,
  total: number,
  fallados: string[],
): Promise<void> {
  const c = await cliente();
  if (c === null) return;
  await c.rpc("registrar_progreso", {
    p_sala: sala,
    p_ejercicio: ejercicio,
    p_aprobados: aprobados,
    p_total: total,
    p_fallados: fallados,
  });
}

export async function listarProgreso(sala: string): Promise<Resultado<FilaProgreso[]>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("progreso")
    .select("ejercicio, alumno, aprobados, total, fallados, intentos")
    .eq("sala", sala);

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: data as unknown as FilaProgreso[] };
}

/**
 * Agrupa las filas por ejercicio.
 *
 * Se hace en el cliente y no en SQL porque la clase entra en una consulta y la
 * cuenta es trivial: una vista o una función serían más piezas que mantener
 * para ahorrar milisegundos que nadie va a notar.
 */
export function resumirProgreso(
  filas: FilaProgreso[],
  titulos: Map<string, string>,
): ResumenEjercicio[] {
  const porEjercicio = new Map<string, FilaProgreso[]>();
  for (const f of filas) {
    const lista = porEjercicio.get(f.ejercicio) ?? [];
    lista.push(f);
    porEjercicio.set(f.ejercicio, lista);
  }

  const resumen: ResumenEjercicio[] = [];
  for (const [ejercicio, lista] of porEjercicio) {
    const cuenta = new Map<string, number>();
    for (const f of lista) {
      for (const caso of f.fallados) cuenta.set(caso, (cuenta.get(caso) ?? 0) + 1);
    }
    resumen.push({
      ejercicio,
      titulo: titulos.get(ejercicio) ?? "Ejercicio",
      aprobaron: lista.filter((f) => f.total > 0 && f.aprobados === f.total).length,
      intentaron: lista.length,
      casosDificiles: [...cuenta.entries()]
        .map(([nombre, cuantos]) => ({ nombre, cuantos }))
        .sort((a, b) => b.cuantos - a.cuantos)
        .slice(0, 3),
    });
  }
  return resumen.sort((a, b) => a.titulo.localeCompare(b.titulo));
}

// ------------------------------------------------------------------
// Publicaciones
// ------------------------------------------------------------------

/** Filas crudas con el perfil embebido, como las devuelve PostgREST. */
interface FilaPublicacion {
  id: string;
  titulo: string | null;
  autor: string;
  creado: string;
  perfiles: { nombre: string | null } | null;
}

const CAMPOS = "id, titulo, autor, creado, perfiles:autor ( nombre )";

function aPublicaciones(filas: FilaPublicacion[], porDefecto: string): Publicacion[] {
  return filas.map((f) => ({
    id: f.id,
    titulo: f.titulo ?? porDefecto,
    autor: f.perfiles?.nombre ?? "Alguien",
    autorId: f.autor,
    creado: f.creado,
  }));
}

export async function listarEjercicios(sala: string): Promise<Resultado<Publicacion[]>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("ejercicios")
    .select(CAMPOS)
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
    .select(CAMPOS)
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
    .select(CAMPOS)
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

/**
 * Comparte el código del editor como solución.
 *
 * Reemplaza la anterior del mismo autor para el mismo ejercicio en vez de
 * agregar otra: quien comparte, corrige y vuelve a compartir dejaba varias
 * versiones suyas y el docente no sabía cuál mirar.
 */
export async function compartirPrograma(
  sala: string,
  titulo: string,
  codigo: string,
  ejercicio: string | null = null,
): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c.rpc("compartir_solucion", {
    p_sala: sala,
    p_ejercicio: ejercicio,
    p_titulo: titulo,
    p_codigo: codigo,
  });
  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: data as string };
}

export interface EjercicioPublicado {
  titulo: string;
  /** El `.md`, tal como lo lee `leerEjercicio()`. */
  contenido: string;
  /** Seudocódigo que lo acompaña, o `null` si se publicó sin código. */
  codigo: string | null;
}

/**
 * Cambia un ejercicio existente. Solo su autor puede: lo impone RLS.
 *
 * No toca la sala, así que editar un ejercicio publicado no lo despublica ni
 * uno privado se publica sin querer.
 */
export async function actualizarEjercicio(
  id: string,
  titulo: string,
  contenido: string,
  codigo: string | null,
): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { error } = await c
    .from("ejercicios")
    .update({ titulo, contenido, codigo })
    .eq("id", id);

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: id };
}

/**
 * Publica un borrador: le pone la sala.
 *
 * Es un cambio de estado, no una copia. El ejercicio sale de los borradores y
 * aparece en la sala siendo la misma fila, así que no hay manera de terminar
 * con dos versiones de la misma cosa —que es exactamente lo que pasaba cuando
 * publicar creaba un registro nuevo.
 */
export async function publicarBorrador(id: string, sala: string): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { error } = await c.from("ejercicios").update({ sala }).eq("id", id);
  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: id };
}

/** Lo saca de la sala y lo devuelve a borradores. Tampoco copia nada. */
export async function despublicarEjercicio(id: string): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { error } = await c.from("ejercicios").update({ sala: null }).eq("id", id);
  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: id };
}

/** Borra un ejercicio propio (o cualquiera de la sala, si sos docente). */
export async function borrarEjercicio(id: string): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { error } = await c.from("ejercicios").delete().eq("id", id);
  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: id };
}

/** Borra un programa compartido. */
export async function borrarPrograma(id: string): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { error } = await c.from("programas").delete().eq("id", id);
  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  return { ok: true, dato: id };
}

/**
 * Copia un ejercicio de la sala al taller privado de quien lo pide.
 *
 * Es una copia de verdad, no un enlace: si el original cambia o se borra, la
 * copia sigue igual. Un alumno que se lleva un ejercicio se lo lleva de verdad.
 */
export async function copiarEjercicio(id: string): Promise<Resultado<string>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const original = await traerEjercicio(id);
  if (!original.ok) return original;

  return guardarEjercicioPersonal(
    original.dato.titulo,
    original.dato.contenido,
    original.dato.codigo,
  );
}

export async function traerEjercicio(id: string): Promise<Resultado<EjercicioPublicado>> {
  const c = await cliente();
  if (c === null) return { ok: false, mensaje: SIN_NUBE };

  const { data, error } = await c
    .from("ejercicios")
    .select("titulo, contenido, codigo")
    .eq("id", id)
    .single();

  if (error !== null) return { ok: false, mensaje: explicarError(error.message) };
  const fila = data as { titulo: string; contenido: string; codigo: string | null };
  return {
    ok: true,
    dato: { titulo: fila.titulo, contenido: fila.contenido, codigo: fila.codigo },
  };
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
    )
    // El progreso es lo que más cambia durante una clase: es justo lo que el
    // docente quiere ver moverse sin recargar.
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "progreso", filter: `sala=eq.${sala}` },
      alCambiar,
    );

  canal.subscribe();
  return () => void c.removeChannel(canal);
}
