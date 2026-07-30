/**
 * Motor de sangría (especificación 15).
 *
 * El parser ignora la sangría, así que el editor es responsable de que siempre
 * esté bien. Esto solo es posible porque los bloques se cierran con palabras
 * clave explícitas: el nivel correcto de cada línea se puede calcular sin
 * ambigüedad a partir del flujo de tokens. En Python no se podría, porque la
 * sangría *es* la estructura y reindentar cambiaría el significado.
 *
 * Se apoya en el lexer, no en expresiones regulares, así que los comentarios y
 * los textos entre comillas no pueden confundirlo:
 *
 *     Escribir "FinSi"   // no cuenta como cierre de bloque
 */
import { tokenizar } from "../src/lexer.ts";
import type { TipoToken, Token } from "../src/token.ts";
import { advertencia, type Diagnostico } from "../src/diagnostico.ts";

export const ANCHO_SANGRIA = 4;

/** Cierres que desangran su propia línea. */
const CIERRES: ReadonlySet<TipoToken> = new Set<TipoToken>([
  "Fin",
  "FinSi",
  "FinMientras",
  "FinPara",
  "FinSegun",
  "FinFuncion",
  "FinProcedimiento",
]);

/** Palabras que, al final de una línea, abren un bloque. */
const ABREN_AL_FINAL: ReadonlySet<TipoToken> = new Set<TipoToken>([
  "Inicio",
  "Entonces",
  "Hacer",
  "Repetir",
]);

type Marco = "bloque" | "segun" | "caso";

/** Tokens de una línea lógica, sin el FIN_LINEA. */
function porLineaLogica(tokens: Token[]): Token[][] {
  const lineas: Token[][] = [];
  let actual: Token[] = [];
  for (const t of tokens) {
    if (t.tipo === "EOF") break;
    if (t.tipo === "FIN_LINEA") {
      if (actual.length > 0) lineas.push(actual);
      actual = [];
      continue;
    }
    actual.push(t);
  }
  if (actual.length > 0) lineas.push(actual);
  return lineas;
}

export interface NivelDeLinea {
  /** Línea física del código fuente, empezando en 1. */
  linea: number;
  nivel: number;
}

/**
 * Calcula el nivel de sangría de cada línea que contiene código.
 *
 * Las líneas vacías y las de solo comentario no aparecen: mantienen la sangría
 * que tengan, porque reindentarlas movería el cursor sin motivo.
 */
export function calcularNiveles(fuente: string): NivelDeLinea[] {
  const { tokens } = tokenizar(fuente);
  const pila: Marco[] = [];
  const salida: NivelDeLinea[] = [];

  for (const linea of porLineaLogica(tokens)) {
    const primero = linea[0]!;
    const ultimo = linea[linea.length - 1]!;
    let nivel: number;

    const dentroDeSegun = pila.includes("segun");
    const esEtiquetaDeCaso =
      dentroDeSegun &&
      (primero.tipo === "NUMERO" || primero.tipo === "TEXTO" || primero.tipo === "-") &&
      linea.some((t) => t.tipo === ":");
    const esDeOtroModo =
      primero.tipo === "De" && linea[1]?.tipo === "Otro" && linea[2]?.tipo === "Modo";

    if (CIERRES.has(primero.tipo)) {
      if (primero.tipo === "FinSegun") {
        while (pila.length > 0 && pila.pop() !== "segun") {
          /* descarta los marcos de caso */
        }
      } else if (pila.length > 0) {
        pila.pop();
      }
      nivel = pila.length;
    } else if (primero.tipo === "Hasta") {
      // 'Hasta Que' cierra el 'Repetir'.
      if (pila.length > 0) pila.pop();
      nivel = pila.length;
    } else if (primero.tipo === "SiNo") {
      // Desangra su propia línea, pero el marco del 'Si' sigue abierto.
      nivel = Math.max(0, pila.length - 1);
    } else if (esEtiquetaDeCaso || esDeOtroModo) {
      if (pila[pila.length - 1] === "caso") pila.pop();
      nivel = pila.length;
      pila.push("caso");
      salida.push({ linea: primero.linea, nivel });
      continue;
    } else {
      nivel = pila.length;
    }

    salida.push({ linea: primero.linea, nivel });

    // ¿Esta línea abre un bloque?
    if (primero.tipo === "Funcion" || primero.tipo === "Procedimiento") {
      pila.push("bloque");
    } else if (primero.tipo === "SiNo") {
      // 'SiNo Si b Entonces' termina en 'Entonces', pero NO abre un bloque
      // nuevo: continúa el 'Si' que sigue abierto en la pila.
    } else if (ABREN_AL_FINAL.has(ultimo.tipo)) {
      pila.push(primero.tipo === "Segun" ? "segun" : "bloque");
    }
  }

  return salida;
}

/** Reescribe la sangría de todo el archivo. Nunca cambia el contenido. */
export function formatear(fuente: string): string {
  const niveles = new Map(calcularNiveles(fuente).map((n) => [n.linea, n.nivel]));
  const lineas = fuente.split("\n");

  return lineas
    .map((texto, idx) => {
      const nivel = niveles.get(idx + 1);
      const cuerpo = texto.trim();
      if (cuerpo === "") return "";
      // Línea de solo comentario: se alinea con el bloque que la sigue.
      if (nivel === undefined) return texto;
      return " ".repeat(nivel * ANCHO_SANGRIA) + cuerpo;
    })
    .join("\n");
}

/**
 * Nivel sugerido para una línea nueva escrita al final de `fuenteHastaElCursor`.
 * Es lo que necesita el editor al presionar Enter.
 */
export function nivelSiguiente(fuenteHastaElCursor: string): number {
  // Se agrega una sentencia postiza para preguntar en qué nivel caería. Tiene
  // que tokenizar sin errores: un centinela con caracteres raros generaría un
  // error léxico en cada pulsación de Enter.
  const niveles = calcularNiveles(fuenteHastaElCursor + "\nEscribir 0");
  const ultimo = niveles[niveles.length - 1];
  return ultimo?.nivel ?? 0;
}

/**
 * Advertencias de sangría incorrecta (especificación 15.3).
 *
 * Nunca son errores: el programa funciona igual. Enseñan el hábito sin
 * castigar, que es exactamente lo que permite haber elegido cierres explícitos.
 */
export function diagnosticosDeSangria(fuente: string): Diagnostico[] {
  const lineas = fuente.split("\n");
  const salida: Diagnostico[] = [];

  for (const { linea, nivel } of calcularNiveles(fuente)) {
    const texto = lineas[linea - 1];
    if (texto === undefined) continue;

    const sangriaReal = texto.length - texto.trimStart().length;
    const esperada = nivel * ANCHO_SANGRIA;
    if (sangriaReal === esperada) continue;

    salida.push(
      advertencia(
        { linea, columna: 1 },
        Math.max(1, sangriaReal),
        "la sangría no coincide con la estructura del programa.",
        `Esta línea va con ${esperada} espacios. Usa Formatear para corregir todo el archivo.`,
      ),
    );
  }

  return salida;
}

/** ¿La línea empieza con una palabra que cierra bloque? Para desangrar al escribir. */
export function empiezaConCierre(textoDeLinea: string): boolean {
  const { tokens } = tokenizar(textoDeLinea);
  const primero = tokens[0];
  if (primero === undefined) return false;
  return (
    CIERRES.has(primero.tipo) || primero.tipo === "SiNo" || primero.tipo === "Hasta"
  );
}
