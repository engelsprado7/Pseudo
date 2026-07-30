/**
 * Árbol de sintaxis abstracta.
 *
 * Todo nodo lleva su posición, porque cada etapa posterior (chequeo de tipos,
 * intérprete, resaltado de la línea en ejecución) necesita poder señalar el
 * lugar exacto del código fuente.
 *
 * El discriminante se llama `clase` para no chocar con el campo `tipo` de los
 * tokens ni con los tipos de dato del lenguaje.
 */
import type { Posicion } from "./token.ts";

export type TipoSimple = "Entero" | "Real" | "Texto" | "Caracter" | "Logico";

export type TipoDecl =
  | { clase: "TipoSimple"; tipo: TipoSimple }
  | { clase: "TipoArreglo"; base: TipoSimple; dimensiones: Expr[] };

export type OpBinario =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "DIV"
  | "MOD"
  | "="
  | "<>"
  | "<"
  | ">"
  | "<="
  | ">="
  | "Y"
  | "O";

export type OpUnario = "-" | "No";

export type Expr =
  | ({ clase: "LiteralNumero"; valor: number; esEntero: boolean } & Posicion)
  | ({ clase: "LiteralTexto"; valor: string } & Posicion)
  | ({ clase: "LiteralLogico"; valor: boolean } & Posicion)
  /** `nombre` está normalizado a minúsculas; `lexema` conserva lo escrito. */
  | ({ clase: "Variable"; nombre: string; lexema: string } & Posicion)
  | ({ clase: "Indice"; base: Variable; indices: Expr[] } & Posicion)
  | ({ clase: "Unario"; op: OpUnario; operando: Expr } & Posicion)
  | ({ clase: "Binario"; op: OpBinario; izq: Expr; der: Expr } & Posicion)
  | ({ clase: "Llamada"; nombre: string; lexema: string; args: Expr[] } & Posicion);

export type Variable = Extract<Expr, { clase: "Variable" }>;
export type Indice = Extract<Expr, { clase: "Indice" }>;

/** Lo que puede aparecer a la izquierda de `<-` o como destino de `Leer`. */
export type Designador = Variable | Indice;

export interface RamaSi {
  condicion: Expr;
  cuerpo: Sentencia[];
  pos: Posicion;
}

export interface CasoSegun {
  /** Literales del caso; ya validados como Entero, Caracter o Texto. */
  valores: Array<Extract<Expr, { clase: "LiteralNumero" | "LiteralTexto" }>>;
  cuerpo: Sentencia[];
  pos: Posicion;
}

export type Sentencia =
  | ({
      clase: "Definir";
      nombres: Array<{ nombre: string; lexema: string } & Posicion>;
      tipo: TipoDecl;
    } & Posicion)
  | ({ clase: "Asignacion"; destino: Designador; valor: Expr } & Posicion)
  | ({ clase: "Leer"; destinos: Designador[] } & Posicion)
  | ({ clase: "Escribir"; partes: Expr[]; sinSalto: boolean } & Posicion)
  | ({ clase: "Si"; ramas: RamaSi[]; sino: Sentencia[] | null } & Posicion)
  | ({
      clase: "Segun";
      sujeto: Expr;
      casos: CasoSegun[];
      otroModo: Sentencia[] | null;
    } & Posicion)
  | ({ clase: "Mientras"; condicion: Expr; cuerpo: Sentencia[] } & Posicion)
  | ({ clase: "Repetir"; cuerpo: Sentencia[]; condicion: Expr } & Posicion)
  | ({
      clase: "Para";
      variable: Variable;
      desde: Expr;
      hasta: Expr;
      /** `null` significa paso 1 (especificación 8.1). */
      paso: Expr | null;
      cuerpo: Sentencia[];
    } & Posicion)
  | ({
      clase: "ParaCada";
      variable: Variable;
      arreglo: Variable;
      cuerpo: Sentencia[];
    } & Posicion)
  | ({
      clase: "LlamarProcedimiento";
      nombre: string;
      lexema: string;
      args: Expr[];
    } & Posicion)
  | ({ clase: "Retornar"; valor: Expr | null } & Posicion);

export interface Parametro extends Posicion {
  nombre: string;
  lexema: string;
  porReferencia: boolean;
  /** `null` cuando el parámetro se declaró sin `Como <tipo>`. */
  tipo: TipoDecl | null;
}

export type Subprograma =
  | ({
      clase: "Funcion";
      nombre: string;
      lexema: string;
      /** Variable a la que se asigna el resultado (especificación 9). */
      variableRetorno: { nombre: string; lexema: string } & Posicion;
      parametros: Parametro[];
      cuerpo: Sentencia[];
    } & Posicion)
  | ({
      clase: "Procedimiento";
      nombre: string;
      lexema: string;
      parametros: Parametro[];
      cuerpo: Sentencia[];
    } & Posicion);

export interface Programa {
  subprogramas: Subprograma[];
  principal: Sentencia[];
  /** Posición de `Inicio`, para reportar errores del bloque principal. */
  posInicio: Posicion | null;
}
