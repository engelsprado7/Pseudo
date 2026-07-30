/**
 * Valores en tiempo de ejecución y su formato de salida (especificación 6.1).
 */
import type { TipoSimple } from "./ast.ts";

export type Valor =
  | { clase: "Entero"; n: number }
  | { clase: "Real"; n: number }
  | { clase: "Texto"; s: string }
  | { clase: "Caracter"; s: string }
  | { clase: "Logico"; b: boolean }
  | {
      clase: "Arreglo";
      base: TipoSimple;
      dimensiones: number[];
      /**
       * `undefined` = celda sin valor todavía. La especificación 4.2 prohíbe
       * valores por defecto, y eso también vale para las celdas de un arreglo:
       * leer una que nunca se asignó es un error, no un 0 silencioso.
       */
      celdas: Array<Valor | undefined>;
    };

export const entero = (n: number): Valor => ({ clase: "Entero", n });
export const real = (n: number): Valor => ({ clase: "Real", n });
export const texto = (s: string): Valor => ({ clase: "Texto", s });
export const caracter = (s: string): Valor => ({ clase: "Caracter", s });
export const logico = (b: boolean): Valor => ({ clase: "Logico", b });

export function esNumero(v: Valor): v is { clase: "Entero" | "Real"; n: number } {
  return v.clase === "Entero" || v.clase === "Real";
}

export function esCadena(v: Valor): v is { clase: "Texto" | "Caracter"; s: string } {
  return v.clase === "Texto" || v.clase === "Caracter";
}

/** Cantidad total de celdas de un arreglo, para cualquier número de dimensiones. */
export function totalCeldas(dimensiones: number[]): number {
  return dimensiones.reduce((a, b) => a * b, 1);
}

export function arregloVacio(base: TipoSimple, dimensiones: number[]): Valor {
  return {
    clase: "Arreglo",
    base,
    dimensiones,
    celdas: new Array<Valor | undefined>(totalCeldas(dimensiones)).fill(undefined),
  };
}

/** Copia profunda. Los arreglos se pasan por valor salvo `Por Referencia` (§9.1). */
export function copiar(v: Valor): Valor {
  if (v.clase !== "Arreglo") return v;
  return {
    clase: "Arreglo",
    base: v.base,
    dimensiones: [...v.dimensiones],
    celdas: v.celdas.map((c) => (c === undefined ? undefined : copiar(c))),
  };
}

/**
 * Cuántos decimales se muestran de un Real.
 *
 * El punto flotante binario no puede representar 0.1 exactamente, así que
 * `0.1 + 0.2` da 0.30000000000000004. Mostrar eso a alguien que está aprendiendo
 * a programar no enseña nada sobre su algoritmo: enseña sobre IEEE 754, que es
 * otra clase. Se redondea la *presentación* a 10 decimales; el valor interno no
 * se toca, así que las comparaciones siguen siendo las reales.
 */
const DECIMALES_VISIBLES = 10;

export function formatearReal(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "infinito" : "-infinito";

  const redondeado = Number(n.toFixed(DECIMALES_VISIBLES));
  if (Number.isInteger(redondeado)) return `${redondeado}.0`;

  // toFixed y luego quitar ceros de sobra, pero dejando al menos un decimal.
  return String(redondeado);
}

/** Representación tal como la ve el alumno (§6.1). */
export function mostrar(v: Valor): string {
  switch (v.clase) {
    case "Entero":
      return String(v.n);
    case "Real":
      return formatearReal(v.n);
    case "Texto":
    case "Caracter":
      return v.s;
    case "Logico":
      return v.b ? "Verdadero" : "Falso";
    case "Arreglo":
      // El verificador impide llegar acá, pero por si acaso.
      return `[arreglo de ${v.celdas.length}]`;
  }
}

/** Nombre del tipo de un valor, para los mensajes de error. */
export function nombreTipoDe(v: Valor): string {
  return v.clase === "Arreglo" ? `Arreglo De ${v.base}` : v.clase;
}
