/**
 * Carga de ejercicios en el navegador.
 *
 * Se leen con `fetch` desde `sitio/ejercicios/`, no se empaquetan en el bundle.
 * Así un docente agrega un ejercicio copiando un `.md` y una línea al índice,
 * sin instalar Node ni recompilar nada. Es la diferencia entre que el sistema lo
 * pueda usar cualquiera y que dependa de quien armó el proyecto.
 */
import { leerEjercicio, type Ejercicio } from "../src/ejercicio.ts";

export interface EntradaDeIndice {
  archivo: string;
  titulo: string;
}

/** Lee `ejercicios/indice.json`. Un índice ausente no es un error: no hay ejercicios. */
export async function cargarIndice(): Promise<EntradaDeIndice[]> {
  try {
    const respuesta = await fetch("./ejercicios/indice.json", { cache: "no-cache" });
    if (!respuesta.ok) return [];
    const datos: unknown = await respuesta.json();
    if (!Array.isArray(datos)) return [];
    return datos.filter(
      (e): e is EntradaDeIndice =>
        typeof e === "object" && e !== null && typeof (e as EntradaDeIndice).archivo === "string",
    );
  } catch {
    return [];
  }
}

export type ResultadoDeSolucion =
  | { ok: true; codigo: string }
  | { ok: false; mensaje: string };

/**
 * Lee la solución de referencia de un ejercicio (`soluciones/<archivo>.psc`).
 *
 * El nombre se deriva del `.md` del ejercicio cambiándole la extensión, así el
 * índice no necesita una entrada aparte para la solución.
 */
export async function cargarSolucion(archivo: string): Promise<ResultadoDeSolucion> {
  const nombre = archivo.replace(/\.md$/i, ".psc");
  try {
    const respuesta = await fetch(`./soluciones/${nombre}`, { cache: "no-cache" });
    if (!respuesta.ok) {
      return { ok: false, mensaje: `No se pudo abrir la solución '${nombre}' (${respuesta.status}).` };
    }
    return { ok: true, codigo: await respuesta.text() };
  } catch {
    return { ok: false, mensaje: `No se pudo abrir la solución '${nombre}'.` };
  }
}

export type ResultadoDeCarga =
  | { ok: true; ejercicio: Ejercicio }
  | { ok: false; mensaje: string };

export async function cargarEjercicio(archivo: string): Promise<ResultadoDeCarga> {
  let texto: string;
  try {
    const respuesta = await fetch(`./ejercicios/${archivo}`, { cache: "no-cache" });
    if (!respuesta.ok) {
      return { ok: false, mensaje: `No se pudo abrir '${archivo}' (${respuesta.status}).` };
    }
    texto = await respuesta.text();
  } catch {
    return { ok: false, mensaje: `No se pudo abrir '${archivo}'.` };
  }

  const leido = leerEjercicio(texto);
  if (!leido.ok) {
    const detalle = leido.errores.map((e) => `línea ${e.linea}: ${e.mensaje}`).join("\n");
    return { ok: false, mensaje: `El ejercicio '${archivo}' tiene problemas de formato:\n${detalle}` };
  }
  return { ok: true, ejercicio: leido.ejercicio };
}
