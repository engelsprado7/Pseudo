/**
 * Funciones y constantes integradas (especificación 11).
 *
 * Las firmas se declaran con "familias" en vez de tipos exactos, porque casi
 * todas aceptan `Entero` o `Real` indistintamente. `mismoQueArg0` cubre los
 * casos como `Abs`, donde el tipo del resultado depende del argumento.
 */
import { CARACTER, ENTERO, LOGICO, REAL, TEXTO, type Tipo } from "./tipos.ts";

export type Familia =
  | "Entero"
  | "Real"
  | "Texto"
  | "Caracter"
  | "Logico"
  | "numero"
  | "textual";

export interface Firma {
  params: Familia[];
  retorno: Familia | "mismoQueArg0";
}

export interface Integrada {
  /** Forma canónica, para los mensajes. */
  lexema: string;
  firmas: Firma[];
  /** `Longitud` es la única que además acepta un arreglo. */
  aceptaArreglo?: boolean;
}

function f(params: Familia[], retorno: Firma["retorno"]): Firma {
  return { params, retorno };
}

export const INTEGRADAS: Record<string, Integrada> = {
  // --- numéricas ---
  raiz: { lexema: "Raiz", firmas: [f(["numero"], "Real")] },
  abs: { lexema: "Abs", firmas: [f(["numero"], "mismoQueArg0")] },
  trunc: { lexema: "Trunc", firmas: [f(["numero"], "Entero")] },
  redondear: { lexema: "Redondear", firmas: [f(["numero"], "Entero")] },
  techo: { lexema: "Techo", firmas: [f(["numero"], "Entero")] },
  piso: { lexema: "Piso", firmas: [f(["numero"], "Entero")] },
  potencia: { lexema: "Potencia", firmas: [f(["numero", "numero"], "Real")] },
  aleatorio: { lexema: "Aleatorio", firmas: [f(["Entero", "Entero"], "Entero")] },
  sen: { lexema: "sen", firmas: [f(["numero"], "Real")] },
  cos: { lexema: "cos", firmas: [f(["numero"], "Real")] },
  tan: { lexema: "tan", firmas: [f(["numero"], "Real")] },
  ln: { lexema: "ln", firmas: [f(["numero"], "Real")] },
  exp: { lexema: "exp", firmas: [f(["numero"], "Real")] },

  // --- de texto ---
  longitud: {
    lexema: "Longitud",
    firmas: [f(["textual"], "Entero")],
    aceptaArreglo: true,
  },
  subcadena: {
    lexema: "Subcadena",
    firmas: [f(["textual", "Entero", "Entero"], "Texto")],
  },
  mayusculas: { lexema: "Mayusculas", firmas: [f(["textual"], "Texto")] },
  minusculas: { lexema: "Minusculas", firmas: [f(["textual"], "Texto")] },
  convertiranumero: {
    lexema: "ConvertirANumero",
    firmas: [f(["textual"], "Real")],
  },
  convertiratexto: { lexema: "ConvertirATexto", firmas: [f(["numero"], "Texto")] },
  concatenar: { lexema: "Concatenar", firmas: [f(["textual", "textual"], "Texto")] },
};

export const CONSTANTES: Record<string, { lexema: string; tipo: Tipo }> = {
  pi: { lexema: "PI", tipo: REAL },
};

const TIPO_DE_FAMILIA: Partial<Record<Familia, Tipo>> = {
  Entero: ENTERO,
  Real: REAL,
  Texto: TEXTO,
  Caracter: CARACTER,
  Logico: LOGICO,
};

/** ¿Un tipo concreto pertenece a la familia pedida? */
export function coincideFamilia(familia: Familia, t: Tipo): boolean {
  if (t.clase === "Indefinido") return true;
  switch (familia) {
    case "numero":
      return t.clase === "Entero" || t.clase === "Real";
    case "textual":
      return t.clase === "Texto" || t.clase === "Caracter";
    case "Real":
      // Un Entero se ensancha a Real sin pérdida.
      return t.clase === "Real" || t.clase === "Entero";
    case "Texto":
      return t.clase === "Texto" || t.clase === "Caracter";
    default:
      return t.clase === familia;
  }
}

export function describirFamilia(familia: Familia): string {
  if (familia === "numero") return "un número";
  if (familia === "textual") return "un Texto";
  return `un ${familia}`;
}

export function tipoDeFamilia(familia: Familia): Tipo {
  return TIPO_DE_FAMILIA[familia] ?? REAL;
}
