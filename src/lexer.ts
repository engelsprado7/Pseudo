import {
  CONTINUA_LINEA,
  PALABRAS_CLAVE,
  type Operador,
  type PalabraClave,
  type Posicion,
  type Puntuacion,
  type Token,
} from "./token.ts";
import { error, type Diagnostico } from "./diagnostico.ts";

const LETRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
const DIGITO = /[0-9]/;
const CONTINUACION_IDENT = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_]/;

/** Quita los diacríticos. Solo se usa para reconocer palabras clave. */
function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export interface ResultadoLexico {
  tokens: Token[];
  errores: Diagnostico[];
}

/**
 * Convierte el código fuente en una lista de tokens.
 *
 * No lanza excepciones: acumula los errores y sigue avanzando, para que el
 * editor pueda subrayar todos los problemas de una pasada en lugar de
 * detenerse en el primero.
 */
export function tokenizar(fuente: string): ResultadoLexico {
  const tokens: Token[] = [];
  const errores: Diagnostico[] = [];

  let i = 0;
  let linea = 1;
  let columna = 1;

  /** Cantidad de tokens emitidos en la línea lógica actual. */
  let tokensEnLinea = 0;

  const fin = () => i >= fuente.length;
  const actual = () => fuente[i] ?? "";
  const siguiente = () => fuente[i + 1] ?? "";
  const pos = (): Posicion => ({ linea, columna });

  function avanzar(): string {
    const c = fuente[i]!;
    i++;
    if (c === "\n") {
      linea++;
      columna = 1;
    } else {
      columna++;
    }
    return c;
  }

  function emitir(t: Token): void {
    tokens.push(t);
    tokensEnLinea++;
  }

  function ultimoToken(): Token | undefined {
    return tokens[tokens.length - 1];
  }

  while (!fin()) {
    const inicio = pos();
    const c = actual();

    // --- espacios en blanco (el salto de línea se trata aparte) ---
    if (c === " " || c === "\t" || c === "\r") {
      avanzar();
      continue;
    }

    // --- comentario de línea ---
    if (c === "/" && siguiente() === "/") {
      while (!fin() && actual() !== "\n") avanzar();
      continue;
    }

    // --- comentario de bloque ---
    //
    // No anidan, como en casi todos los lenguajes: el primer `*/` cierra. Si
    // anidaran, comentar un fragmento que ya tuviera un comentario adentro
    // funcionaría a veces sí y a veces no, según dónde cayera el cierre.
    if (c === "/" && siguiente() === "*") {
      const apertura = inicio;
      avanzar();
      avanzar();
      let cerrado = false;
      while (!fin()) {
        if (actual() === "*" && siguiente() === "/") {
          avanzar();
          avanzar();
          cerrado = true;
          break;
        }
        // `avanzar` lleva la cuenta de líneas y columnas, así que un comentario
        // de varias líneas no descoloca las posiciones que se reportan después.
        avanzar();
      }
      if (!cerrado) {
        errores.push(
          error(apertura, 2, "este comentario nunca se cierra.", "Agregá '*/' donde termine."),
        );
      }
      continue;
    }

    // --- salto de línea ---
    if (c === "\n") {
      avanzar();
      const ultimo = ultimoToken();
      const continua = ultimo !== undefined && CONTINUA_LINEA.has(ultimo.tipo);
      // Una línea vacía o solo con comentario no produce token; tampoco lo
      // produce una línea que termina en operador binario o coma.
      if (tokensEnLinea > 0 && !continua) {
        tokens.push({ tipo: "FIN_LINEA", lexema: "\\n", ...inicio });
        tokensEnLinea = 0;
      }
      continue;
    }

    // --- número ---
    if (DIGITO.test(c)) {
      let lexema = "";
      while (!fin() && DIGITO.test(actual())) lexema += avanzar();

      let esEntero = true;

      if (actual() === "." ) {
        if (!DIGITO.test(siguiente())) {
          const punto = pos();
          avanzar();
          errores.push(
            error(
              punto,
              1,
              `el número '${lexema}.' tiene un punto decimal sin dígitos después.`,
              `Escribe '${lexema}' o '${lexema}.0'.`,
            ),
          );
          emitir({
            tipo: "NUMERO",
            lexema,
            valor: Number(lexema),
            esEntero: true,
            ...inicio,
          });
          continue;
        }
        esEntero = false;
        lexema += avanzar(); // el punto
        while (!fin() && DIGITO.test(actual())) lexema += avanzar();
      }

      if (actual() === "e" || actual() === "E") {
        // Solo es exponente si viene seguido de dígitos, con signo opcional.
        const desp = siguiente();
        const hayExponente =
          DIGITO.test(desp) ||
          ((desp === "+" || desp === "-") && DIGITO.test(fuente[i + 2] ?? ""));
        if (hayExponente) {
          esEntero = false;
          lexema += avanzar(); // e / E
          if (actual() === "+" || actual() === "-") lexema += avanzar();
          while (!fin() && DIGITO.test(actual())) lexema += avanzar();
        }
      }

      // '12abc' es un error claro; sin esto quedaría como 12 seguido de 'abc'.
      if (LETRA.test(actual())) {
        let cola = "";
        while (!fin() && CONTINUACION_IDENT.test(actual())) cola += avanzar();
        errores.push(
          error(
            inicio,
            lexema.length + cola.length,
            `'${lexema}${cola}' no es un número ni un nombre válido.`,
            "Un nombre de variable no puede empezar con un dígito.",
          ),
        );
        continue;
      }

      emitir({
        tipo: "NUMERO",
        lexema,
        valor: Number(lexema),
        esEntero,
        ...inicio,
      });
      continue;
    }

    // --- texto entre comillas ---
    if (c === '"') {
      avanzar(); // comilla de apertura
      let valor = "";
      let cerrado = false;

      while (!fin()) {
        const ch = actual();

        if (ch === "\n") break; // sin cerrar: se reporta abajo

        if (ch === "\\") {
          const escape = siguiente();
          if (escape === '"' || escape === "\\" || escape === "n") {
            avanzar();
            avanzar();
            valor += escape === "n" ? "\n" : escape;
            continue;
          }
          const posEscape = pos();
          avanzar();
          errores.push(
            error(
              posEscape,
              2,
              `'\\${escape}' no es una secuencia de escape válida.`,
              'Las válidas son \\" para una comilla, \\\\ para una barra y \\n para un salto de línea.',
            ),
          );
          continue;
        }

        if (ch === '"') {
          avanzar();
          cerrado = true;
          break;
        }

        valor += avanzar();
      }

      if (!cerrado) {
        errores.push(
          error(
            inicio,
            1,
            "falta la comilla de cierre de este texto.",
            'Un texto tiene que abrir y cerrar con " en la misma línea.',
          ),
        );
      }

      emitir({ tipo: "TEXTO", lexema: `"${valor}"`, valor, ...inicio });
      continue;
    }

    // --- identificador o palabra clave ---
    if (LETRA.test(c)) {
      let lexema = "";
      while (!fin() && CONTINUACION_IDENT.test(actual())) lexema += avanzar();

      const clave = sinAcentos(lexema).toLowerCase();
      const canonica = (PALABRAS_CLAVE as Record<string, PalabraClave>)[clave];

      if (canonica !== undefined) {
        emitir({ tipo: canonica, lexema, ...inicio });
      } else {
        emitir({
          tipo: "IDENTIFICADOR",
          lexema,
          nombre: lexema.toLowerCase(),
          ...inicio,
        });
      }
      continue;
    }

    // --- operadores de dos caracteres ---
    if (c === "<" && siguiente() === "-") {
      avanzar();
      avanzar();
      emitir({ tipo: "<-", lexema: "<-", ...inicio });
      continue;
    }
    if (c === "<" && siguiente() === "=") {
      avanzar();
      avanzar();
      emitir({ tipo: "<=", lexema: "<=", ...inicio });
      continue;
    }
    if (c === "<" && siguiente() === ">") {
      avanzar();
      avanzar();
      emitir({ tipo: "<>", lexema: "<>", ...inicio });
      continue;
    }
    if (c === ">" && siguiente() === "=") {
      avanzar();
      avanzar();
      emitir({ tipo: ">=", lexema: ">=", ...inicio });
      continue;
    }

    // --- operadores y puntuación de un carácter ---
    const simples: Record<string, Operador | Puntuacion> = {
      "+": "+",
      "-": "-",
      "*": "*",
      "/": "/",
      "^": "^",
      "=": "=",
      "<": "<",
      ">": ">",
      "(": "(",
      ")": ")",
      "[": "[",
      "]": "]",
      ",": ",",
      ":": ":",
    };
    const simple = simples[c];
    if (simple !== undefined) {
      avanzar();
      emitir({ tipo: simple, lexema: c, ...inicio });
      continue;
    }

    // --- carácter desconocido ---
    avanzar();
    if (c === "≠") {
      errores.push(
        error(inicio, 1, "no reconozco el símbolo '≠'.", "Para 'distinto de' usa '<>'."),
      );
    } else if (c === "←") {
      errores.push(
        error(inicio, 1, "no reconozco el símbolo '←'.", "Para asignar usa '<-'."),
      );
    } else if (c === "“" || c === "”") {
      errores.push(
        error(
          inicio,
          1,
          `no reconozco el símbolo '${c}'.`,
          'Son comillas tipográficas. Usa comillas rectas: "',
        ),
      );
    } else if (c === ";") {
      errores.push(
        error(
          inicio,
          1,
          "no reconozco el símbolo ';'.",
          "En este lenguaje las sentencias terminan con el salto de línea, no con punto y coma.",
        ),
      );
    } else if (c === "{" || c === "}") {
      errores.push(
        error(
          inicio,
          1,
          `no reconozco el símbolo '${c}'.`,
          "Los bloques se cierran con palabras como 'FinSi' o 'FinMientras'.",
        ),
      );
    } else {
      errores.push(error(inicio, 1, `no reconozco el símbolo '${c}'.`));
    }
  }

  // Cierre implícito de la última línea, si quedó contenido sin terminar.
  if (tokensEnLinea > 0) {
    tokens.push({ tipo: "FIN_LINEA", lexema: "\\n", linea, columna });
  }
  tokens.push({ tipo: "EOF", lexema: "", linea, columna });

  errores.sort((a, b) => a.linea - b.linea || a.columna - b.columna);

  return { tokens, errores };
}
