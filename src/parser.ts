/**
 * Parser por descenso recursivo.
 *
 * Dos cosas gobiernan el diseño:
 *
 * 1. **Pila de bloques abiertos.** Cada construcción que abre un bloque
 *    registra su token de apertura. Cuando aparece un cierre equivocado o el
 *    archivo termina sin cerrar, el mensaje puede decir *qué* quedó abierto y
 *    *en qué línea*. Es el error más frecuente del principiante y el más
 *    desconcertante sin esa información.
 *
 * 2. **Recuperación por líneas.** Un error no aborta el análisis: se descarta
 *    la línea y se sigue con la siguiente. El editor necesita ver todos los
 *    problemas de una pasada.
 */
import {
  PALABRAS_CLAVE,
  describir,
  type PalabraClave,
  type Posicion,
  type TipoToken,
  type Token,
} from "./token.ts";
import { error, type Diagnostico } from "./diagnostico.ts";
import type {
  CasoSegun,
  Designador,
  Expr,
  OpBinario,
  Parametro,
  Programa,
  RamaSi,
  Sentencia,
  Subprograma,
  TipoDecl,
  TipoSimple,
  Variable,
} from "./ast.ts";

/** Se lanza para abortar la sentencia actual y recuperarse en la siguiente. */
class ErrorSintactico extends Error {}

const TIPOS_SIMPLES: ReadonlySet<string> = new Set([
  "Entero",
  "Real",
  "Texto",
  "Caracter",
  "Logico",
]);

/** Cierres de bloque, para reconocer cuándo el alumno cerró con la palabra equivocada. */
const CIERRES: ReadonlySet<TipoToken> = new Set<TipoToken>([
  "Fin",
  "FinSi",
  "FinMientras",
  "FinPara",
  "FinSegun",
  "FinFuncion",
  "FinProcedimiento",
]);

/**
 * Sugerencias de renombrado para las palabras reservadas que un alumno intenta
 * usar como nombre de variable.
 *
 * `y` y `o` son los casos que de verdad importan: son los operadores lógicos
 * del lenguaje y a la vez nombres naturalísimos para coordenadas. La decisión
 * fue mantenerlos reservados y enseñar `coordX`/`coordY` desde el principio,
 * así que el mensaje tiene que llevar al alumno ahí sin fricción.
 */
const RENOMBRES: Partial<Record<string, string>> = {
  Y: "coordY",
  O: "coordX",
  No: "cantidad",
  De: "desde",
  En: "entrada",
  Valor: "valorIngresado",
  Real: "numeroReal",
  Texto: "cadena",
  Entero: "numero",
  Paso: "incremento",
  Modo: "modalidad",
  Salto: "salto1",
  Que: "cual",
  Con: "conjunto",
};

interface BloqueAbierto {
  apertura: Token;
  cierre: PalabraClave;
}

export interface ResultadoSintactico {
  programa: Programa;
  errores: Diagnostico[];
}

export function parsear(tokens: Token[]): ResultadoSintactico {
  return new Parser(tokens).parsearPrograma();
}

class Parser {
  private k = 0;
  private readonly errores: Diagnostico[] = [];
  private readonly bloques: BloqueAbierto[] = [];
  private readonly tokens: Token[];

  // Nota: Node ejecuta TypeScript borrando tipos, sin generar código, así que
  // no admite propiedades declaradas en los parámetros del constructor.
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ------------------------------------------------------------------
  // Navegación
  // ------------------------------------------------------------------

  private actual(): Token {
    return this.tokens[this.k] ?? this.tokens[this.tokens.length - 1]!;
  }

  private anterior(): Token {
    return this.tokens[Math.max(0, this.k - 1)]!;
  }

  private ver(...tipos: TipoToken[]): boolean {
    return tipos.includes(this.actual().tipo);
  }

  private enEOF(): boolean {
    return this.actual().tipo === "EOF";
  }

  private avanzar(): Token {
    const t = this.actual();
    if (!this.enEOF()) this.k++;
    return t;
  }

  private aceptar(...tipos: TipoToken[]): Token | null {
    if (this.ver(...tipos)) return this.avanzar();
    return null;
  }

  private pos(): Posicion {
    const t = this.actual();
    return { linea: t.linea, columna: t.columna };
  }

  private reportar(mensaje: string, sugerencia?: string, token?: Token): void {
    const t = token ?? this.actual();
    this.errores.push(
      error(
        { linea: t.linea, columna: t.columna },
        Math.max(1, t.lexema.length),
        mensaje,
        sugerencia,
      ),
    );
  }

  private fallar(mensaje: string, sugerencia?: string, token?: Token): never {
    this.reportar(mensaje, sugerencia, token);
    throw new ErrorSintactico();
  }

  private exigir(tipo: TipoToken, mensaje: string, sugerencia?: string): Token {
    const t = this.aceptar(tipo);
    if (t !== null) return t;
    this.fallar(mensaje, sugerencia);
  }

  /**
   * Como `exigir`, pero no aborta la sentencia.
   *
   * Se usa en los encabezados de las construcciones que abren bloque. Si un
   * `Entonces` o un `Hacer` faltan, abortar dejaría el bloque huérfano y su
   * cierre (`FinSi`, `FinPara`) generaría una cascada de errores ajenos al
   * problema real. Reportar y seguir conserva la estructura.
   */
  private exigirBlando(tipo: TipoToken, mensaje: string, sugerencia?: string): void {
    if (this.aceptar(tipo) === null) this.reportar(mensaje, sugerencia);
  }

  /** Descarta saltos de línea. Se llama en los bordes de todo bloque. */
  private saltarLineas(): void {
    while (this.aceptar("FIN_LINEA") !== null) {
      /* vacío */
    }
  }

  /** Exige el fin de la sentencia actual. */
  private terminarSentencia(): void {
    if (this.enEOF()) return;
    if (this.aceptar("FIN_LINEA") !== null) return;

    // Caso clásico: la línea anterior terminó en un operador, el lexer unió las
    // dos líneas (especificación 2.5) y ahora aparece la flecha de la segunda.
    if (this.ver("<-")) {
      this.fallar(
        "apareció una segunda asignación en la misma línea.",
        "Suele pasar cuando la línea anterior termina en un operador (+, -, *, Y, O) o en una coma: eso hace que continúe en la línea siguiente. Revisa el final de la línea de arriba.",
      );
    }

    this.fallar(
      `no esperaba ${describir(this.actual())} acá.`,
      "Cada sentencia va en su propia línea.",
    );
  }

  /**
   * Recuperación: descarta hasta el próximo comienzo de línea.
   *
   * Se detiene también ante un cierre de bloque, aunque esté en la misma línea
   * lógica. Hace falta porque la continuación de línea (especificación 2.5)
   * puede unir dos líneas físicas: `Leer y` termina en el operador `Y`, que
   * absorbe el salto y arrastra el `Fin` de la línea siguiente. Sin esta
   * parada, la recuperación se comería el cierre y el error se duplicaría.
   */
  private sincronizar(): void {
    while (!this.enEOF() && this.actual().tipo !== "FIN_LINEA") {
      if (CIERRES.has(this.actual().tipo)) return;
      this.avanzar();
    }
    this.saltarLineas();
  }

  // ------------------------------------------------------------------
  // Nombres y palabras reservadas
  // ------------------------------------------------------------------

  /**
   * Consume un identificador. Si en su lugar hay una palabra reservada,
   * produce el mensaje que explica el motivo en lugar de un error de sintaxis
   * genérico.
   */
  private exigirNombre(contexto: string): Token & { nombre: string } {
    const t = this.actual();
    if (t.tipo === "IDENTIFICADOR") {
      this.avanzar();
      return t;
    }

    const esPalabraClave = Object.values(PALABRAS_CLAVE).includes(
      t.tipo as PalabraClave,
    );
    if (esPalabraClave) {
      const sugerida = RENOMBRES[t.tipo];
      this.fallar(
        `'${t.lexema}' es una palabra reservada del lenguaje y no puede ser el nombre de ${contexto}.`,
        sugerida !== undefined
          ? `Elige otro nombre, por ejemplo '${sugerida}'.`
          : "Elige otro nombre.",
      );
    }

    this.fallar(`se esperaba el nombre de ${contexto}, pero encontré ${describir(t)}.`);
  }

  private variableDesde(t: Token & { nombre: string }): Variable {
    return {
      clase: "Variable",
      nombre: t.nombre,
      lexema: t.lexema,
      linea: t.linea,
      columna: t.columna,
    };
  }

  // ------------------------------------------------------------------
  // Bloques
  // ------------------------------------------------------------------

  private abrirBloque(apertura: Token, cierre: PalabraClave): void {
    this.bloques.push({ apertura, cierre });
  }

  /**
   * Cierra el bloque en el tope de la pila.
   *
   * Si aparece un cierre distinto del esperado, lo consume igual para poder
   * seguir analizando: el alumno escribió *algo* que cierra, solo se equivocó
   * de palabra.
   */
  private cerrarBloque(): void {
    const bloque = this.bloques.pop()!;
    this.saltarLineas();

    if (this.aceptar(bloque.cierre) !== null) return;

    if (this.enEOF()) {
      this.reportar(
        `falta '${bloque.cierre}'. El '${bloque.apertura.lexema}' de la línea ${bloque.apertura.linea} quedó sin cerrar.`,
        `Agrega '${bloque.cierre}' al final del bloque.`,
      );
      return;
    }

    if (CIERRES.has(this.actual().tipo) || this.ver("Hasta")) {
      // Si el cierre que aparece pertenece a un bloque de más afuera, no se
      // consume: es el nuestro el que falta. Consumirlo dejaría al bloque
      // externo sin cerrar y produciría un segundo error en cascada.
      const esDeUnBloqueExterno = this.bloques.some(
        (b) => b.cierre === this.actual().tipo,
      );
      if (!esDeUnBloqueExterno) {
        const encontrado = this.avanzar();
        this.reportar(
          `encontré '${encontrado.lexema}' pero el bloque abierto es un '${bloque.apertura.lexema}' (línea ${bloque.apertura.linea}).`,
          `¿Querías escribir '${bloque.cierre}'?`,
          encontrado,
        );
        return;
      }
    }

    this.reportar(
      `falta '${bloque.cierre}'. El '${bloque.apertura.lexema}' de la línea ${bloque.apertura.linea} quedó sin cerrar.`,
      `Agrega '${bloque.cierre}' antes de ${describir(this.actual())}.`,
    );
  }

  /** Analiza sentencias hasta encontrar uno de los terminadores, o el EOF. */
  private parsearBloque(...terminadores: TipoToken[]): Sentencia[] {
    const cuerpo: Sentencia[] = [];
    this.saltarLineas();

    while (!this.enEOF() && !this.ver(...terminadores)) {
      // Un cierre ajeno significa que el bloque de arriba terminó sin cerrar
      // el nuestro; se devuelve el control para que cerrarBloque lo explique.
      if (CIERRES.has(this.actual().tipo)) break;

      const antes = this.k;
      const profundidad = this.bloques.length;
      try {
        cuerpo.push(this.parsearSentencia());
      } catch (e) {
        if (!(e instanceof ErrorSintactico)) throw e;
        // Si la sentencia abrió un bloque y falló antes de cerrarlo, hay que
        // descartarlo: si no, su cierre se atribuiría al bloque de afuera.
        this.bloques.length = profundidad;
        this.sincronizar();
      }
      // Red de seguridad: si una iteración no consumió nada, forzar avance.
      if (this.k === antes) this.avanzar();
      this.saltarLineas();
    }

    return cuerpo;
  }

  // ------------------------------------------------------------------
  // Programa
  // ------------------------------------------------------------------

  parsearPrograma(): ResultadoSintactico {
    const subprogramas: Subprograma[] = [];
    let principal: Sentencia[] = [];
    let posInicio: Posicion | null = null;

    this.saltarLineas();

    while (!this.enEOF()) {
      const antes = this.k;
      const profundidad = this.bloques.length;
      try {
        if (this.ver("Funcion", "Procedimiento")) {
          subprogramas.push(this.parsearSubprograma());
        } else if (this.ver("Inicio")) {
          const inicio = this.avanzar();
          if (posInicio !== null) {
            this.reportar(
              "hay más de un bloque 'Inicio'. El programa solo puede tener uno.",
              undefined,
              inicio,
            );
          }
          posInicio = { linea: inicio.linea, columna: inicio.columna };
          this.abrirBloque(inicio, "Fin");
          principal = this.parsearBloque("Fin");
          this.cerrarBloque();
        } else {
          this.fallar(
            `no esperaba ${describir(this.actual())} en el nivel principal del programa.`,
            "Fuera de 'Inicio ... Fin' solo pueden ir funciones y procedimientos.",
          );
        }
      } catch (e) {
        if (!(e instanceof ErrorSintactico)) throw e;
        this.bloques.length = profundidad;
        this.sincronizar();
      }
      // sincronizar() puede detenerse sin consumir nada (ante un cierre de
      // bloque). Sin esta garantía de avance, el bucle no terminaría.
      if (this.k === antes) this.avanzar();
      this.saltarLineas();
    }

    if (posInicio === null) {
      const ultimo = this.tokens[this.tokens.length - 1]!;
      this.reportar(
        "el programa no tiene bloque 'Inicio'.",
        "Todo programa empieza con 'Inicio' y termina con 'Fin'.",
        ultimo,
      );
    }

    this.errores.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
    return {
      programa: { subprogramas, principal, posInicio },
      errores: this.errores,
    };
  }

  // ------------------------------------------------------------------
  // Subprogramas
  // ------------------------------------------------------------------

  private parsearSubprograma(): Subprograma {
    if (this.ver("Funcion")) {
      const apertura = this.avanzar();
      const retorno = this.exigirNombre("la variable de retorno");
      this.exigir(
        "<-",
        `se esperaba '<-' después de '${retorno.lexema}'.`,
        "Una función se declara así: Funcion resultado <- Nombre(parametros)",
      );
      const nombre = this.exigirNombre("la función");
      const parametros = this.parsearParametros();
      this.abrirBloque(apertura, "FinFuncion");
      const cuerpo = this.parsearBloque("FinFuncion");
      this.cerrarBloque();

      return {
        clase: "Funcion",
        nombre: nombre.nombre,
        lexema: nombre.lexema,
        variableRetorno: {
          nombre: retorno.nombre,
          lexema: retorno.lexema,
          linea: retorno.linea,
          columna: retorno.columna,
        },
        parametros,
        cuerpo,
        linea: apertura.linea,
        columna: apertura.columna,
      };
    }

    const apertura = this.exigir("Procedimiento", "se esperaba 'Funcion' o 'Procedimiento'.");
    const nombre = this.exigirNombre("el procedimiento");
    const parametros = this.parsearParametros();
    this.abrirBloque(apertura, "FinProcedimiento");
    const cuerpo = this.parsearBloque("FinProcedimiento");
    this.cerrarBloque();

    return {
      clase: "Procedimiento",
      nombre: nombre.nombre,
      lexema: nombre.lexema,
      parametros,
      cuerpo,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearParametros(): Parametro[] {
    this.exigir("(", "se esperaba '(' para la lista de parámetros.");
    const params: Parametro[] = [];

    if (this.aceptar(")") !== null) return params;

    do {
      let porReferencia = false;
      if (this.aceptar("Por") !== null) {
        if (this.aceptar("Referencia") !== null) porReferencia = true;
        else if (this.aceptar("Valor") !== null) porReferencia = false;
        else
          this.fallar(
            "después de 'Por' se esperaba 'Referencia' o 'Valor'.",
            "Escribe 'Por Referencia' o 'Por Valor'.",
          );
      }

      const nombre = this.exigirNombre("un parámetro");
      let tipo: TipoDecl | null = null;
      if (this.aceptar("Como") !== null) tipo = this.parsearTipo();

      params.push({
        nombre: nombre.nombre,
        lexema: nombre.lexema,
        porReferencia,
        tipo,
        linea: nombre.linea,
        columna: nombre.columna,
      });
    } while (this.aceptar(",") !== null);

    this.exigir(")", "se esperaba ')' o ',' en la lista de parámetros.");
    return params;
  }

  // ------------------------------------------------------------------
  // Tipos
  // ------------------------------------------------------------------

  private parsearTipo(): TipoDecl {
    if (this.aceptar("Arreglo") !== null) {
      this.exigir(
        "[",
        "se esperaba '[' con el tamaño del arreglo.",
        "Por ejemplo: Arreglo[30] De Real",
      );
      const dimensiones: Expr[] = [this.parsearExpr()];
      while (this.aceptar(",") !== null) dimensiones.push(this.parsearExpr());
      this.exigir("]", "se esperaba ']' después del tamaño del arreglo.");
      this.exigir(
        "De",
        "se esperaba 'De' seguido del tipo de los elementos.",
        "Por ejemplo: Arreglo[30] De Real",
      );
      return { clase: "TipoArreglo", base: this.parsearTipoSimple(), dimensiones };
    }
    return { clase: "TipoSimple", tipo: this.parsearTipoSimple() };
  }

  private parsearTipoSimple(): TipoSimple {
    const t = this.actual();
    if (TIPOS_SIMPLES.has(t.tipo)) {
      this.avanzar();
      return t.tipo as TipoSimple;
    }
    this.fallar(
      `se esperaba un tipo, pero encontré ${describir(t)}.`,
      "Los tipos son Entero, Real, Texto, Caracter y Logico.",
    );
  }

  // ------------------------------------------------------------------
  // Sentencias
  // ------------------------------------------------------------------

  private parsearSentencia(): Sentencia {
    // Una palabra reservada seguida de '<-' o '[' es siempre un intento de
    // usarla como variable. Se atiende antes del switch para dar el mensaje
    // que explica el motivo en lugar de un "no esperaba 'y'" inútil.
    const sig = this.tokens[this.k + 1];
    if (
      this.actual().tipo !== "IDENTIFICADOR" &&
      (sig?.tipo === "<-" || sig?.tipo === "[")
    ) {
      this.exigirNombre("una variable");
    }

    switch (this.actual().tipo) {
      case "Definir":
        return this.parsearDefinir();
      case "Leer":
        return this.parsearLeer();
      case "Escribir":
        return this.parsearEscribir();
      case "Si":
        return this.parsearSi();
      case "Segun":
        return this.parsearSegun();
      case "Mientras":
        return this.parsearMientras();
      case "Repetir":
        return this.parsearRepetir();
      case "Para":
        return this.parsearPara();
      case "Retornar":
        return this.parsearRetornar();
      case "IDENTIFICADOR":
        return this.parsearAsignacionOLlamada();
      case "Inicio":
        this.fallar(
          "'Inicio' no puede ir acá.",
          "El bloque principal ya está abierto.",
        );
      // falta el 'break' a propósito: fallar() nunca retorna
      default:
        this.fallar(
          `no esperaba ${describir(this.actual())} al comienzo de una sentencia.`,
        );
    }
  }

  private parsearDefinir(): Sentencia {
    const apertura = this.avanzar();
    const nombres: Array<{ nombre: string; lexema: string } & Posicion> = [];

    do {
      const n = this.exigirNombre("una variable");
      nombres.push({
        nombre: n.nombre,
        lexema: n.lexema,
        linea: n.linea,
        columna: n.columna,
      });
    } while (this.aceptar(",") !== null);

    this.exigir(
      "Como",
      "se esperaba 'Como' seguido del tipo.",
      "Por ejemplo: Definir base Como Real",
    );
    const tipo = this.parsearTipo();
    this.terminarSentencia();

    return {
      clase: "Definir",
      nombres,
      tipo,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearLeer(): Sentencia {
    const apertura = this.avanzar();
    const destinos: Designador[] = [this.parsearDesignador()];
    while (this.aceptar(",") !== null) destinos.push(this.parsearDesignador());
    this.terminarSentencia();
    return {
      clase: "Leer",
      destinos,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearEscribir(): Sentencia {
    const apertura = this.avanzar();
    let sinSalto = false;
    if (this.aceptar("Sin") !== null) {
      this.exigir("Salto", "después de 'Sin' se esperaba 'Salto'.");
      sinSalto = true;
    }
    const partes: Expr[] = [this.parsearExpr()];
    while (this.aceptar(",") !== null) partes.push(this.parsearExpr());
    this.terminarSentencia();
    return {
      clase: "Escribir",
      partes,
      sinSalto,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearSi(): Sentencia {
    const apertura = this.avanzar();
    this.abrirBloque(apertura, "FinSi");

    const ramas: RamaSi[] = [];
    let sino: Sentencia[] | null = null;

    const condicion = this.parsearExpr();
    this.exigirBlando(
      "Entonces",
      "se esperaba 'Entonces' al final de la condición.",
      "Escribe: Si <condición> Entonces",
    );
    ramas.push({
      condicion,
      cuerpo: this.parsearBloque("SiNo", "FinSi"),
      pos: { linea: apertura.linea, columna: apertura.columna },
    });

    while (this.ver("SiNo")) {
      const sinoTok = this.avanzar();
      if (this.aceptar("Si") !== null) {
        const cond = this.parsearExpr();
        this.exigirBlando("Entonces", "se esperaba 'Entonces' al final de la condición.");
        ramas.push({
          condicion: cond,
          cuerpo: this.parsearBloque("SiNo", "FinSi"),
          pos: { linea: sinoTok.linea, columna: sinoTok.columna },
        });
      } else {
        sino = this.parsearBloque("FinSi", "SiNo");
        if (this.ver("SiNo")) {
          this.reportar(
            "este 'Si' ya tenía un 'SiNo'. Solo puede haber uno, y va al final.",
          );
        }
        break;
      }
    }

    this.cerrarBloque();
    return {
      clase: "Si",
      ramas,
      sino,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearSegun(): Sentencia {
    const apertura = this.avanzar();
    this.abrirBloque(apertura, "FinSegun");

    const sujeto = this.parsearExpr();
    this.exigirBlando("Hacer", "se esperaba 'Hacer' después de la expresión de 'Segun'.");
    this.saltarLineas();

    const casos: CasoSegun[] = [];
    let otroModo: Sentencia[] | null = null;

    while (!this.enEOF() && !this.ver("FinSegun") && !CIERRES.has(this.actual().tipo)) {
      if (this.ver("De")) {
        const deTok = this.avanzar();
        this.exigir("Otro", "se esperaba 'De Otro Modo:'.");
        this.exigir("Modo", "se esperaba 'De Otro Modo:'.");
        this.exigir(":", "se esperaba ':' después de 'De Otro Modo'.");
        otroModo = this.parsearBloque("FinSegun", "De");
        if (this.ver("De")) {
          this.reportar("solo puede haber un 'De Otro Modo', y va al final.", undefined, deTok);
        }
        break;
      }

      const pos = this.pos();
      const valores: CasoSegun["valores"] = [this.parsearLiteralDeCaso()];
      while (this.aceptar(",") !== null) valores.push(this.parsearLiteralDeCaso());
      this.exigir(":", "se esperaba ':' después de los valores del caso.");
      // Ninguna sentencia puede empezar con un número, un texto o '-', así que
      // encontrar uno significa que empieza el caso siguiente.
      casos.push({
        valores,
        cuerpo: this.parsearBloque("FinSegun", "De", "NUMERO", "TEXTO", "-"),
        pos,
      });

      // Un caso nuevo empieza con un literal; si no, el bucle debe cortar.
      this.saltarLineas();
      if (!this.ver("NUMERO", "TEXTO", "-", "De", "FinSegun")) break;
    }

    this.cerrarBloque();
    return {
      clase: "Segun",
      sujeto,
      casos,
      otroModo,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearLiteralDeCaso(): CasoSegun["valores"][number] {
    const negativo = this.aceptar("-");
    const t = this.actual();

    if (t.tipo === "NUMERO") {
      this.avanzar();
      return {
        clase: "LiteralNumero",
        valor: negativo !== null ? -t.valor : t.valor,
        esEntero: t.esEntero,
        linea: (negativo ?? t).linea,
        columna: (negativo ?? t).columna,
      };
    }

    if (t.tipo === "TEXTO") {
      if (negativo !== null) {
        this.fallar("no se puede poner '-' delante de un texto.");
      }
      this.avanzar();
      return {
        clase: "LiteralTexto",
        valor: t.valor,
        linea: t.linea,
        columna: t.columna,
      };
    }

    this.fallar(
      `los casos de 'Segun' se comparan contra valores fijos, y ${describir(t)} no lo es.`,
      "Usa números o textos entre comillas, por ejemplo: 1, 2, 3:",
    );
  }

  private parsearMientras(): Sentencia {
    const apertura = this.avanzar();
    this.abrirBloque(apertura, "FinMientras");
    const condicion = this.parsearExpr();
    this.exigirBlando(
      "Hacer",
      "se esperaba 'Hacer' al final de la condición.",
      "Escribe: Mientras <condición> Hacer",
    );
    const cuerpo = this.parsearBloque("FinMientras");
    this.cerrarBloque();
    return {
      clase: "Mientras",
      condicion,
      cuerpo,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearRepetir(): Sentencia {
    const apertura = this.avanzar();
    const cuerpo = this.parsearBloque("Hasta");
    this.saltarLineas();

    if (this.aceptar("Hasta") === null) {
      this.reportar(
        `falta 'Hasta Que'. El 'Repetir' de la línea ${apertura.linea} quedó sin cerrar.`,
        "Un 'Repetir' termina con 'Hasta Que <condición>'.",
      );
      return {
        clase: "Repetir",
        cuerpo,
        condicion: {
          clase: "LiteralLogico",
          valor: true,
          linea: apertura.linea,
          columna: apertura.columna,
        },
        linea: apertura.linea,
        columna: apertura.columna,
      };
    }

    this.exigir("Que", "después de 'Hasta' se esperaba 'Que'.", "Escribe 'Hasta Que'.");
    const condicion = this.parsearExpr();
    this.terminarSentencia();
    return {
      clase: "Repetir",
      cuerpo,
      condicion,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearPara(): Sentencia {
    const apertura = this.avanzar();
    this.abrirBloque(apertura, "FinPara");

    // Para Cada <var> En <arreglo> Hacer
    if (this.aceptar("Cada") !== null) {
      const variable = this.variableDesde(this.exigirNombre("la variable de recorrido"));
      this.exigir(
        "En",
        "se esperaba 'En' seguido del nombre del arreglo.",
        "Escribe: Para Cada elemento En arreglo Hacer",
      );
      const arreglo = this.variableDesde(this.exigirNombre("el arreglo a recorrer"));
      this.exigirBlando("Hacer", "se esperaba 'Hacer' al final del encabezado.");
      const cuerpo = this.parsearBloque("FinPara");
      this.cerrarBloque();
      return {
        clase: "ParaCada",
        variable,
        arreglo,
        cuerpo,
        linea: apertura.linea,
        columna: apertura.columna,
      };
    }

    // Para <var> <- <desde> Hasta <hasta> [Con Paso <paso>] Hacer
    const variable = this.variableDesde(this.exigirNombre("la variable de control"));
    const igual = this.aceptar("=");
    if (igual !== null) {
      // Error frecuentísimo. Se consume el '=' para que el encabezado siga
      // analizándose y el 'FinPara' no quede huérfano.
      this.reportar(
        `escribiste 'Para ${variable.lexema} = ...'. El valor inicial se asigna con la flecha.`,
        `Escribe: Para ${variable.lexema} <- 0 Hasta 9 Hacer`,
        igual,
      );
    } else {
      this.exigirBlando(
        "<-",
        `se esperaba '<-' después de '${variable.lexema}'.`,
        "Escribe: Para i <- 0 Hasta 9 Hacer",
      );
    }
    const desde = this.parsearExpr();
    this.exigir(
      "Hasta",
      "se esperaba 'Hasta' con el valor final.",
      "Escribe: Para i <- 0 Hasta 9 Hacer",
    );
    const hasta = this.parsearExpr();

    let paso: Expr | null = null;
    if (this.aceptar("Con") !== null) {
      this.exigir("Paso", "después de 'Con' se esperaba 'Paso'.");
      paso = this.parsearExpr();
    }

    this.exigirBlando("Hacer", "se esperaba 'Hacer' al final del encabezado del 'Para'.");
    const cuerpo = this.parsearBloque("FinPara");
    this.cerrarBloque();

    return {
      clase: "Para",
      variable,
      desde,
      hasta,
      paso,
      cuerpo,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearRetornar(): Sentencia {
    const apertura = this.avanzar();
    const valor = this.ver("FIN_LINEA", "EOF") ? null : this.parsearExpr();
    this.terminarSentencia();
    return {
      clase: "Retornar",
      valor,
      linea: apertura.linea,
      columna: apertura.columna,
    };
  }

  private parsearAsignacionOLlamada(): Sentencia {
    const nombre = this.exigirNombre("una variable");

    // Llamada a procedimiento.
    if (this.ver("(")) {
      this.avanzar();
      const args: Expr[] = [];
      if (this.aceptar(")") === null) {
        args.push(this.parsearExpr());
        while (this.aceptar(",") !== null) args.push(this.parsearExpr());
        this.exigir(")", "se esperaba ')' o ',' en la lista de argumentos.");
      }
      this.terminarSentencia();
      return {
        clase: "LlamarProcedimiento",
        nombre: nombre.nombre,
        lexema: nombre.lexema,
        args,
        linea: nombre.linea,
        columna: nombre.columna,
      };
    }

    const destino = this.completarDesignador(nombre);

    if (this.ver("=")) {
      const igual = this.actual();
      this.fallar(
        `escribiste '${
          destino.clase === "Indice" ? `${nombre.lexema}[...]` : nombre.lexema
        } = ...'. Para asignar un valor se usa la flecha.`,
        `Escribe '${nombre.lexema} <- ...'. El '=' sirve para comparar, no para asignar.`,
        igual,
      );
    }

    this.exigir(
      "<-",
      `se esperaba '<-' después de '${nombre.lexema}'.`,
      "Para asignar un valor: variable <- expresión",
    );
    const valor = this.parsearExpr();
    this.terminarSentencia();

    return {
      clase: "Asignacion",
      destino,
      valor,
      linea: nombre.linea,
      columna: nombre.columna,
    };
  }

  private parsearDesignador(): Designador {
    return this.completarDesignador(this.exigirNombre("una variable"));
  }

  private completarDesignador(nombre: Token & { nombre: string }): Designador {
    const base = this.variableDesde(nombre);
    if (this.aceptar("[") === null) return base;

    const indices: Expr[] = [this.parsearExpr()];
    while (this.aceptar(",") !== null) indices.push(this.parsearExpr());
    this.exigir("]", "se esperaba ']' después del índice.");

    return {
      clase: "Indice",
      base,
      indices,
      linea: nombre.linea,
      columna: nombre.columna,
    };
  }

  // ------------------------------------------------------------------
  // Expresiones — un método por nivel de precedencia (especificación 10.1)
  // ------------------------------------------------------------------

  private parsearExpr(): Expr {
    return this.parsearO();
  }

  private binario(op: OpBinario, izq: Expr, der: Expr, tok: Token): Expr {
    return { clase: "Binario", op, izq, der, linea: tok.linea, columna: tok.columna };
  }

  private parsearO(): Expr {
    let izq = this.parsearY();
    let t: Token | null;
    while ((t = this.aceptar("O")) !== null) {
      izq = this.binario("O", izq, this.parsearY(), t);
    }
    return izq;
  }

  private parsearY(): Expr {
    let izq = this.parsearNo();
    let t: Token | null;
    while ((t = this.aceptar("Y")) !== null) {
      izq = this.binario("Y", izq, this.parsearNo(), t);
    }
    return izq;
  }

  private parsearNo(): Expr {
    const t = this.aceptar("No");
    if (t !== null) {
      return {
        clase: "Unario",
        op: "No",
        operando: this.parsearNo(),
        linea: t.linea,
        columna: t.columna,
      };
    }
    return this.parsearRelacional();
  }

  /** No asociativo: `a < b < c` no se puede escribir (especificación 10.1). */
  private parsearRelacional(): Expr {
    const izq = this.parsearSuma();
    const t = this.aceptar("=", "<>", "<", ">", "<=", ">=");
    if (t === null) return izq;

    const der = this.parsearSuma();
    const resultado = this.binario(t.tipo as OpBinario, izq, der, t);

    const encadenado = this.actual();
    if (this.ver("=", "<>", "<", ">", "<=", ">=")) {
      this.reportar(
        "no se pueden encadenar comparaciones.",
        "Separa las dos comparaciones con 'Y'. Por ejemplo, en lugar de '1 < x < 10' escribe '1 < x Y x < 10'.",
        encadenado,
      );
      // Se consume la segunda comparación para no repetir el error en cascada.
      this.avanzar();
      this.parsearSuma();
    }

    return resultado;
  }

  private parsearSuma(): Expr {
    let izq = this.parsearMultiplicacion();
    let t: Token | null;
    while ((t = this.aceptar("+", "-")) !== null) {
      izq = this.binario(t.tipo as OpBinario, izq, this.parsearMultiplicacion(), t);
    }
    return izq;
  }

  private parsearMultiplicacion(): Expr {
    let izq = this.parsearUnario();
    let t: Token | null;
    while ((t = this.aceptar("*", "/", "DIV", "MOD")) !== null) {
      izq = this.binario(t.tipo as OpBinario, izq, this.parsearUnario(), t);
    }
    return izq;
  }

  private parsearUnario(): Expr {
    const t = this.aceptar("-");
    if (t !== null) {
      return {
        clase: "Unario",
        op: "-",
        operando: this.parsearUnario(),
        linea: t.linea,
        columna: t.columna,
      };
    }
    return this.parsearPotencia();
  }

  /** Asociativo a la derecha, y admite exponente negativo: `2 ^ -1`. */
  private parsearPotencia(): Expr {
    const base = this.parsearPrimaria();
    const t = this.aceptar("^");
    if (t === null) return base;
    return this.binario("^", base, this.parsearUnario(), t);
  }

  private parsearPrimaria(): Expr {
    const t = this.actual();

    switch (t.tipo) {
      case "NUMERO":
        this.avanzar();
        return {
          clase: "LiteralNumero",
          valor: t.valor,
          esEntero: t.esEntero,
          linea: t.linea,
          columna: t.columna,
        };

      case "TEXTO":
        this.avanzar();
        return {
          clase: "LiteralTexto",
          valor: t.valor,
          linea: t.linea,
          columna: t.columna,
        };

      case "Verdadero":
      case "Falso":
        this.avanzar();
        return {
          clase: "LiteralLogico",
          valor: t.tipo === "Verdadero",
          linea: t.linea,
          columna: t.columna,
        };

      case "(": {
        this.avanzar();
        const dentro = this.parsearExpr();
        this.exigir(")", "falta el paréntesis de cierre.");
        return dentro;
      }

      case "IDENTIFICADOR": {
        this.avanzar();
        if (this.aceptar("(") !== null) {
          const args: Expr[] = [];
          if (this.aceptar(")") === null) {
            args.push(this.parsearExpr());
            while (this.aceptar(",") !== null) args.push(this.parsearExpr());
            this.exigir(")", "se esperaba ')' o ',' en la lista de argumentos.");
          }
          return {
            clase: "Llamada",
            nombre: t.nombre,
            lexema: t.lexema,
            args,
            linea: t.linea,
            columna: t.columna,
          };
        }
        return this.completarDesignador(t);
      }

      case "<-":
        this.fallar(
          "'<-' no puede ir acá.",
          "La flecha asigna un valor a una variable; no se usa dentro de una expresión.",
        );

      case "FIN_LINEA":
      case "EOF":
        this.fallar(
          "la expresión quedó incompleta.",
          `Falta el valor después de '${this.anterior().lexema}'.`,
        );

      default:
        // La continuación de línea puede haber traído hasta acá el cierre de
        // un bloque, así que este caso también es una expresión incompleta.
        if (CIERRES.has(t.tipo) || this.ver("Hasta", "SiNo", "Entonces", "Hacer")) {
          this.fallar(
            "la expresión quedó incompleta.",
            `Falta el valor después de '${this.anterior().lexema}'.`,
          );
        }
        this.fallar(`no esperaba ${describir(t)} dentro de una expresión.`);
    }
  }
}
