/**
 * Representación de tipos y reglas de compatibilidad (especificación 4.2 y 10.2).
 *
 * `Indefinido` es un tipo veneno: aparece cuando algo ya falló y es compatible
 * con todo. Sirve para que un solo error no genere diez mensajes en cascada —
 * si `a` no está declarada, `a * b + c` debe producir un error, no tres.
 */
import type { TipoSimple } from "./ast.ts";

export type Tipo =
  | { clase: TipoSimple }
  | { clase: "Arreglo"; base: TipoSimple; dimensiones: number[] }
  | { clase: "Indefinido" };

export const ENTERO: Tipo = { clase: "Entero" };
export const REAL: Tipo = { clase: "Real" };
export const TEXTO: Tipo = { clase: "Texto" };
export const CARACTER: Tipo = { clase: "Caracter" };
export const LOGICO: Tipo = { clase: "Logico" };
export const INDEFINIDO: Tipo = { clase: "Indefinido" };

export function simple(t: TipoSimple): Tipo {
  return { clase: t };
}

/** Nombre para los mensajes. */
export function nombre(t: Tipo): string {
  if (t.clase === "Arreglo") {
    const dims = t.dimensiones.join(", ");
    return `Arreglo[${dims}] De ${t.base}`;
  }
  if (t.clase === "Indefinido") return "desconocido";
  return t.clase;
}

/**
 * Nombre con artículo, para que los mensajes se lean bien en castellano:
 * "no puede recibir un Real", no "no puede recibir Real".
 *
 * Todos los nombres de tipo del lenguaje son masculinos, así que siempre es
 * "un". Si algún día se agrega uno femenino (una Matriz, por ejemplo), acá va
 * la excepción.
 */
export function art(t: Tipo): string {
  if (t.clase === "Indefinido") return "un valor de tipo desconocido";
  return `un ${nombre(t)}`;
}

export function esIndefinido(t: Tipo): boolean {
  return t.clase === "Indefinido";
}

export function esNumerico(t: Tipo): boolean {
  return t.clase === "Entero" || t.clase === "Real";
}

/** `Caracter` es un `Texto` de longitud 1, así que comparten familia. */
export function esTextual(t: Tipo): boolean {
  return t.clase === "Texto" || t.clase === "Caracter";
}

export function esArreglo(
  t: Tipo,
): t is { clase: "Arreglo"; base: TipoSimple; dimensiones: number[] } {
  return t.clase === "Arreglo";
}

export function iguales(a: Tipo, b: Tipo): boolean {
  if (a.clase === "Arreglo" && b.clase === "Arreglo") {
    return (
      a.base === b.base &&
      a.dimensiones.length === b.dimensiones.length &&
      a.dimensiones.every((d, i) => d === b.dimensiones[i])
    );
  }
  return a.clase === b.clase;
}

/**
 * ¿Un valor de tipo `origen` puede asignarse a un destino de tipo `destino`?
 *
 * Solo hay dos ensanchamientos automáticos, ambos sin pérdida:
 * `Entero` → `Real` y `Caracter` → `Texto`. Todo lo demás requiere una función
 * de conversión explícita, para que el alumno vea que está convirtiendo.
 */
export function asignable(destino: Tipo, origen: Tipo): boolean {
  if (esIndefinido(destino) || esIndefinido(origen)) return true;
  if (iguales(destino, origen)) return true;
  if (destino.clase === "Real" && origen.clase === "Entero") return true;
  if (destino.clase === "Texto" && origen.clase === "Caracter") return true;
  return false;
}

/** Sugerencia de conversión cuando la asignación no es válida. */
export function comoConvertir(destino: Tipo, origen: Tipo): string | undefined {
  if (destino.clase === "Entero" && origen.clase === "Real") {
    return "Para convertir un Real en Entero usa 'Trunc' o 'Redondear'.";
  }
  if (esNumerico(destino) && esTextual(origen)) {
    return "Para convertir un Texto en número usa 'ConvertirANumero'.";
  }
  if (esTextual(destino) && esNumerico(origen)) {
    return "Para convertir un número en Texto usa 'ConvertirATexto'.";
  }
  if (destino.clase === "Caracter" && origen.clase === "Texto") {
    return "Un Caracter guarda una sola letra. Usa 'Subcadena' para tomar una.";
  }
  return undefined;
}

/** Tipo resultante de una operación aritmética entre dos numéricos. */
export function combinarNumericos(a: Tipo, b: Tipo): Tipo {
  if (a.clase === "Real" || b.clase === "Real") return REAL;
  return ENTERO;
}
