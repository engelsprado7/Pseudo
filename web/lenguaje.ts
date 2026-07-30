/**
 * Soporte de CodeMirror para el lenguaje: resaltado y sangría.
 *
 * El tokenizador de resaltado es independiente del lexer de `src/` a propósito.
 * CodeMirror necesita tokenizar de forma incremental y reentrante, carácter por
 * carácter, sin ver el archivo completo; el lexer real necesita lo contrario.
 * Lo que sí comparten es la tabla `PALABRAS_CLAVE`, que es la única parte que
 * de verdad tiene que mantenerse sincronizada.
 */
import { StreamLanguage, LanguageSupport, HighlightStyle, syntaxHighlighting, indentService } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { PALABRAS_CLAVE } from "../src/token.ts";
import { ANCHO_SANGRIA, nivelSiguiente } from "./formato.ts";

const LETRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
const IDENT = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_]/;

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Palabras clave que controlan el flujo, para resaltarlas distinto de los tipos. */
const TIPOS = new Set(["Entero", "Real", "Texto", "Caracter", "Logico", "Arreglo"]);
const LOGICOS = new Set(["Verdadero", "Falso"]);
const OPERADORES_PALABRA = new Set(["Y", "O", "No", "DIV", "MOD"]);

const seudocodigo = StreamLanguage.define({
  name: "seudocodigo",

  token(stream) {
    if (stream.eatSpace()) return null;

    // Comentario
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }

    // Texto entre comillas
    if (stream.peek() === '"') {
      stream.next();
      let escapado = false;
      while (!stream.eol()) {
        const c = stream.next()!;
        if (escapado) {
          escapado = false;
          continue;
        }
        if (c === "\\") escapado = true;
        else if (c === '"') return "string";
      }
      return "string2"; // sin cerrar
    }

    // Número
    if (/[0-9]/.test(stream.peek() ?? "")) {
      stream.eatWhile(/[0-9]/);
      if (stream.peek() === ".") {
        const guardado = stream.pos;
        stream.next();
        if (/[0-9]/.test(stream.peek() ?? "")) stream.eatWhile(/[0-9]/);
        else stream.pos = guardado;
      }
      if (/[eE]/.test(stream.peek() ?? "")) {
        const guardado = stream.pos;
        stream.next();
        if (/[+-]/.test(stream.peek() ?? "")) stream.next();
        if (/[0-9]/.test(stream.peek() ?? "")) stream.eatWhile(/[0-9]/);
        else stream.pos = guardado;
      }
      return "number";
    }

    // Identificador o palabra clave
    if (LETRA.test(stream.peek() ?? "")) {
      let palabra = "";
      while (!stream.eol() && IDENT.test(stream.peek() ?? "")) palabra += stream.next();

      const canonica = (PALABRAS_CLAVE as Record<string, string>)[
        sinAcentos(palabra).toLowerCase()
      ];
      if (canonica === undefined) {
        // Un identificador seguido de '(' se resalta como función.
        const resto = stream.string.slice(stream.pos);
        return /^\s*\(/.test(resto) ? "variableName.function" : "variableName";
      }
      if (TIPOS.has(canonica)) return "typeName";
      if (LOGICOS.has(canonica)) return "bool";
      if (OPERADORES_PALABRA.has(canonica)) return "operatorKeyword";
      return "keyword";
    }

    // Operadores de dos caracteres
    if (stream.match("<-") || stream.match("<=") || stream.match(">=") || stream.match("<>")) {
      return "operator";
    }

    const c = stream.next()!;
    if ("+-*/^=<>".includes(c)) return "operator";
    if ("()[]".includes(c)) return "bracket";
    if (",:".includes(c)) return "punctuation";
    return "invalid";
  },

  languageData: {
    commentTokens: { line: "//" },
    indentOnInput: /^\s*(Fin|FinSi|FinMientras|FinPara|FinSegun|FinFuncion|FinProcedimiento|SiNo|Hasta)\b/i,
  },
});

/**
 * Sangría automática.
 *
 * `nivelSiguiente` reanaliza el texto anterior al cursor con el lexer real, así
 * que la sangría que ofrece siempre coincide con la estructura verdadera del
 * programa, no con lo que haya escrito el alumno más arriba.
 */
const sangriaAutomatica = indentService.of((contexto, posicion) => {
  const doc = contexto.state.doc;
  const linea = doc.lineAt(posicion);
  const anterior = doc.sliceString(0, Math.max(0, linea.from - 1));
  const textoDeLaLinea = linea.text.trim();

  // Si la línea que se está escribiendo empieza con un cierre, se desangra.
  const esCierre =
    /^(Fin|FinSi|FinMientras|FinPara|FinSegun|FinFuncion|FinProcedimiento|SiNo|Hasta)\b/i.test(
      textoDeLaLinea,
    );

  const nivel = nivelSiguiente(anterior);
  return Math.max(0, esCierre ? nivel - 1 : nivel) * ANCHO_SANGRIA;
});

/** Paleta. Se define con variables CSS para que siga al tema claro/oscuro. */
export const estiloResaltado = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--sx-clave)", fontWeight: "500" },
  { tag: tags.typeName, color: "var(--sx-tipo)" },
  { tag: tags.operatorKeyword, color: "var(--sx-oplogico)", fontWeight: "500" },
  { tag: tags.string, color: "var(--sx-texto)" },
  { tag: tags.special(tags.string), color: "var(--sx-error)", textDecoration: "underline wavy" },
  { tag: tags.number, color: "var(--sx-numero)" },
  { tag: tags.bool, color: "var(--sx-numero)" },
  { tag: tags.comment, color: "var(--sx-comentario)", fontStyle: "italic" },
  { tag: tags.operator, color: "var(--sx-operador)" },
  { tag: tags.variableName, color: "var(--sx-variable)" },
  { tag: tags.function(tags.variableName), color: "var(--sx-funcion)" },
  { tag: tags.bracket, color: "var(--sx-operador)" },
  { tag: tags.punctuation, color: "var(--sx-operador)" },
  { tag: tags.invalid, color: "var(--sx-error)" },
]);

export function lenguajeSeudocodigo(): LanguageSupport {
  return new LanguageSupport(seudocodigo, [
    sangriaAutomatica,
    syntaxHighlighting(estiloResaltado),
  ]);
}
