import type { Posicion } from "./token.ts";

export type Severidad = "error" | "advertencia";

/**
 * Un diagnóstico es todo lo que el entorno le muestra al alumno: errores que
 * detienen la ejecución y advertencias que no.
 *
 * `sugerencia` es la corrección concreta cuando se puede inferir. Es la
 * diferencia entre un mensaje que enseña y uno que solo señala.
 */
export interface Diagnostico extends Posicion {
  severidad: Severidad;
  mensaje: string;
  sugerencia?: string;
  /** Largo en caracteres, para subrayar en el editor. */
  longitud: number;
}

export function error(
  pos: Posicion,
  longitud: number,
  mensaje: string,
  sugerencia?: string,
): Diagnostico {
  return { ...pos, longitud, severidad: "error", mensaje, sugerencia };
}

export function advertencia(
  pos: Posicion,
  longitud: number,
  mensaje: string,
  sugerencia?: string,
): Diagnostico {
  return { ...pos, longitud, severidad: "advertencia", mensaje, sugerencia };
}

/** Formatea un diagnóstico como lo vería el alumno en la consola. */
export function formatear(d: Diagnostico): string {
  const prefijo = d.severidad === "error" ? "ERROR" : "Advertencia";
  const base = `${prefijo} línea ${d.linea}: ${d.mensaje}`;
  return d.sugerencia ? `${base}\n  ${d.sugerencia}` : base;
}
