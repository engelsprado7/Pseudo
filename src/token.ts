/**
 * Tipos de token del lenguaje.
 *
 * Las palabras clave se representan con su forma canónica como tipo
 * ("Si", "FinMientras", ...) para que el parser pueda compararlas
 * directamente y TypeScript estreche el tipo en cada rama.
 */

/**
 * Mapa de forma normalizada -> forma canónica.
 *
 * La clave está en minúsculas y sin acentos, porque las palabras clave son
 * insensibles a mayúsculas y a acentos (especificación 2.1). El valor es la
 * forma que se muestra en los mensajes de error.
 */
export const PALABRAS_CLAVE = {
  inicio: "Inicio",
  fin: "Fin",
  definir: "Definir",
  como: "Como",

  entero: "Entero",
  real: "Real",
  texto: "Texto",
  caracter: "Caracter",
  logico: "Logico",

  arreglo: "Arreglo",
  de: "De",

  leer: "Leer",
  escribir: "Escribir",
  sin: "Sin",
  salto: "Salto",

  si: "Si",
  entonces: "Entonces",
  sino: "SiNo",
  finsi: "FinSi",

  segun: "Segun",
  hacer: "Hacer",
  otro: "Otro",
  modo: "Modo",
  finsegun: "FinSegun",

  mientras: "Mientras",
  finmientras: "FinMientras",

  repetir: "Repetir",
  hasta: "Hasta",
  que: "Que",

  para: "Para",
  cada: "Cada",
  en: "En",
  con: "Con",
  paso: "Paso",
  finpara: "FinPara",

  funcion: "Funcion",
  finfuncion: "FinFuncion",
  procedimiento: "Procedimiento",
  finprocedimiento: "FinProcedimiento",

  retornar: "Retornar",
  por: "Por",
  referencia: "Referencia",
  valor: "Valor",

  verdadero: "Verdadero",
  falso: "Falso",

  y: "Y",
  o: "O",
  no: "No",

  div: "DIV",
  mod: "MOD",
} as const;

export type PalabraClave = (typeof PALABRAS_CLAVE)[keyof typeof PALABRAS_CLAVE];

/** Operadores. `<-` es asignación; el resto son binarios o unarios. */
export type Operador =
  | "<-"
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "="
  | "<>"
  | "<"
  | ">"
  | "<="
  | ">=";

export type Puntuacion = "(" | ")" | "[" | "]" | "," | ":";

/** Posición en el código fuente. Ambas coordenadas empiezan en 1. */
export interface Posicion {
  linea: number;
  columna: number;
}

export type Token =
  | ({
      tipo: "NUMERO";
      lexema: string;
      valor: number;
      /** `5` es Entero, `5.0` y `5e2` son Real (especificación 2.3). */
      esEntero: boolean;
    } & Posicion)
  | ({ tipo: "TEXTO"; lexema: string; valor: string } & Posicion)
  | ({
      tipo: "IDENTIFICADOR";
      lexema: string;
      /**
       * Nombre normalizado a minúsculas, sin quitar acentos: los
       * identificadores son insensibles a mayúsculas, pero `area` y `área`
       * son variables distintas (especificación 2.2).
       */
      nombre: string;
    } & Posicion)
  | ({ tipo: PalabraClave; lexema: string } & Posicion)
  | ({ tipo: Operador | Puntuacion; lexema: string } & Posicion)
  | ({ tipo: "FIN_LINEA"; lexema: string } & Posicion)
  | ({ tipo: "EOF"; lexema: string } & Posicion);

export type TipoToken = Token["tipo"];

/**
 * Tokens tras los cuales un salto de línea se descarta porque la expresión
 * continúa en la línea siguiente (especificación 2.5).
 */
export const CONTINUA_LINEA: ReadonlySet<TipoToken> = new Set<TipoToken>([
  "<-",
  "+",
  "-",
  "*",
  "/",
  "^",
  "=",
  "<>",
  "<",
  ">",
  "<=",
  ">=",
  ",",
  "Y",
  "O",
  "DIV",
  "MOD",
]);

/** Describe un token en castellano, para los mensajes de error. */
export function describir(t: Token): string {
  switch (t.tipo) {
    case "FIN_LINEA":
      return "el final de la línea";
    case "EOF":
      return "el final del archivo";
    case "NUMERO":
      return `el número ${t.lexema}`;
    case "TEXTO":
      return `el texto ${t.lexema}`;
    case "IDENTIFICADOR":
      return `'${t.lexema}'`;
    default:
      return `'${t.lexema}'`;
  }
}
