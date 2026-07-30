/**
 * Chequeo estático de tipos y ámbitos.
 *
 * Es una pasada independiente sobre el AST, deliberadamente separada del
 * intérprete: el editor la usa para subrayar errores mientras el alumno escribe,
 * sin ejecutar nada y sin llegar a la línea que falla.
 *
 * Como declarar es obligatorio (especificación 4.1), acá se atrapa casi todo lo
 * que en otros lenguajes explota en tiempo de ejecución: variables no
 * declaradas, tipos incompatibles, condiciones que no son `Logico`, aridad de
 * llamadas, índices no enteros.
 *
 * Lo que NO se comprueba acá, por decisión de la especificación:
 *   - usar una variable antes de asignarle valor (§4.2) → error de ejecución
 *   - índice fuera de rango (§4.3) → error de ejecución
 *   - división por cero (§10.2) → error de ejecución
 */
import type {
  Designador,
  Expr,
  Parametro,
  Programa,
  Sentencia,
  Subprograma,
  TipoDecl,
  TipoSimple,
  Variable,
} from "./ast.ts";
import type { Posicion } from "./token.ts";
import { advertencia, error, type Diagnostico } from "./diagnostico.ts";
import {
  CONSTANTES,
  INTEGRADAS,
  coincideFamilia,
  describirFamilia,
  tipoDeFamilia,
  type Firma,
} from "./integradas.ts";
import {
  ENTERO,
  INDEFINIDO,
  LOGICO,
  REAL,
  TEXTO,
  asignable,
  combinarNumericos,
  comoConvertir,
  esArreglo,
  esIndefinido,
  esNumerico,
  esTextual,
  iguales,
  art,
  nombre as nombreTipo,
  simple,
  type Tipo,
} from "./tipos.ts";

interface Simbolo {
  nombre: string;
  lexema: string;
  tipo: Tipo;
  pos: Posicion;
  esParametro: boolean;
  /** Se usa para advertir si se modifica dentro del bucle que la controla. */
  esVariableDeControl: boolean;
  leida: boolean;
  escrita: boolean;
}

interface FirmaSubprograma {
  clase: "Funcion" | "Procedimiento";
  lexema: string;
  parametros: Parametro[];
  tipoRetorno: Tipo;
  pos: Posicion;
}

export function verificar(programa: Programa): Diagnostico[] {
  return new Verificador(programa).ejecutar();
}

class Verificador {
  private readonly diagnosticos: Diagnostico[] = [];
  private readonly subprogramas = new Map<string, FirmaSubprograma>();
  private readonly programa: Programa;

  /** Ámbito actual. No hay ámbitos anidados: uno por subprograma (§9.2). */
  private ambito = new Map<string, Simbolo>();
  /** Función que se está verificando, para validar `Retornar`. */
  private funcionActual: Extract<Subprograma, { clase: "Funcion" }> | null = null;
  /** Variables de control de los `Para` que están abiertos ahora mismo. */
  private controlesAbiertos: string[] = [];

  constructor(programa: Programa) {
    this.programa = programa;
  }

  // ------------------------------------------------------------------

  private err(pos: Posicion, longitud: number, mensaje: string, sugerencia?: string): void {
    this.diagnosticos.push(error(pos, longitud, mensaje, sugerencia));
  }

  private avisar(
    pos: Posicion,
    longitud: number,
    mensaje: string,
    sugerencia?: string,
  ): void {
    this.diagnosticos.push(advertencia(pos, longitud, mensaje, sugerencia));
  }

  ejecutar(): Diagnostico[] {
    this.recolectarSubprogramas();

    for (const sp of this.programa.subprogramas) this.verificarSubprograma(sp);

    this.ambito = new Map();
    this.funcionActual = null;
    this.bloque(this.programa.principal);
    this.revisarSinUsar();
    this.revisarAcentosAmbiguos();

    this.diagnosticos.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
    return this.diagnosticos;
  }

  // ------------------------------------------------------------------
  // Firmas de subprogramas (primera pasada: el orden no importa)
  // ------------------------------------------------------------------

  private recolectarSubprogramas(): void {
    for (const sp of this.programa.subprogramas) {
      const previo = this.subprogramas.get(sp.nombre);
      if (previo !== undefined) {
        this.err(
          sp,
          sp.lexema.length,
          `ya existe un subprograma llamado '${sp.lexema}' (línea ${previo.pos.linea}).`,
          "Cada función y procedimiento necesita un nombre distinto.",
        );
        continue;
      }

      if (INTEGRADAS[sp.nombre] !== undefined || CONSTANTES[sp.nombre] !== undefined) {
        this.err(
          sp,
          sp.lexema.length,
          `'${sp.lexema}' es el nombre de una función integrada del lenguaje.`,
          "Elige otro nombre para no ocultarla.",
        );
        continue;
      }

      let tipoRetorno: Tipo = INDEFINIDO;
      if (sp.clase === "Funcion") {
        // El tipo de retorno se deduce del `Definir` de la variable de retorno.
        const decl = this.buscarDeclaracion(sp.cuerpo, sp.variableRetorno.nombre);
        tipoRetorno = decl ?? INDEFINIDO;
      }

      this.subprogramas.set(sp.nombre, {
        clase: sp.clase,
        lexema: sp.lexema,
        parametros: sp.parametros,
        tipoRetorno,
        pos: { linea: sp.linea, columna: sp.columna },
      });
    }
  }

  /** Busca el `Definir` de un nombre dentro de un cuerpo, sin entrar en bloques. */
  private buscarDeclaracion(cuerpo: Sentencia[], objetivo: string): Tipo | null {
    for (const s of cuerpo) {
      if (s.clase !== "Definir") continue;
      if (s.nombres.some((n) => n.nombre === objetivo)) return this.resolverTipo(s.tipo);
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Subprogramas
  // ------------------------------------------------------------------

  private verificarSubprograma(sp: Subprograma): void {
    this.ambito = new Map();
    this.controlesAbiertos = [];
    this.funcionActual = sp.clase === "Funcion" ? sp : null;

    for (const p of sp.parametros) {
      if (p.tipo === null) {
        this.err(
          p,
          p.lexema.length,
          `el parámetro '${p.lexema}' no tiene tipo.`,
          `Escribe '${p.lexema} Como Real' (o el tipo que corresponda).`,
        );
      }
      this.declarar({
        nombre: p.nombre,
        lexema: p.lexema,
        tipo: p.tipo === null ? INDEFINIDO : this.resolverTipo(p.tipo),
        pos: { linea: p.linea, columna: p.columna },
        esParametro: true,
        esVariableDeControl: false,
        // Un parámetro llega con valor; contarlo como escrito evita avisos falsos.
        leida: false,
        escrita: true,
      });
    }

    if (sp.clase === "Funcion") {
      const ret = sp.variableRetorno;
      if (!this.ambito.has(ret.nombre) && this.buscarDeclaracion(sp.cuerpo, ret.nombre) === null) {
        this.err(
          ret,
          ret.lexema.length,
          `falta declarar la variable de retorno '${ret.lexema}'.`,
          `Agrega 'Definir ${ret.lexema} Como Real' (o el tipo que devuelva la función) dentro de la función.`,
        );
      }
    }

    this.bloque(sp.cuerpo);

    if (sp.clase === "Funcion") {
      const simbolo = this.ambito.get(sp.variableRetorno.nombre);
      // La variable de retorno la lee quien llama a la función, así que no
      // corresponde advertir que "nunca se usa".
      if (simbolo !== undefined) simbolo.leida = true;
      if (simbolo !== undefined && !simbolo.escrita) {
        this.err(
          sp.variableRetorno,
          sp.variableRetorno.lexema.length,
          `la función '${sp.lexema}' nunca le asigna un valor a '${sp.variableRetorno.lexema}'.`,
          `Antes de 'FinFuncion' tiene que haber un '${sp.variableRetorno.lexema} <- ...'.`,
        );
      }
    }

    this.revisarSinUsar();
  }

  private declarar(s: Simbolo): void {
    const previo = this.ambito.get(s.nombre);
    if (previo !== undefined) {
      this.err(
        s.pos,
        s.lexema.length,
        `'${s.lexema}' ya fue declarada como ${nombreTipo(previo.tipo)} en la línea ${previo.pos.linea}.`,
        "Cada variable se declara una sola vez.",
      );
      return;
    }
    if (INTEGRADAS[s.nombre] !== undefined) {
      this.err(
        s.pos,
        s.lexema.length,
        `'${s.lexema}' es el nombre de una función integrada del lenguaje.`,
        "Elige otro nombre para la variable.",
      );
    }
    this.ambito.set(s.nombre, s);
  }

  private revisarSinUsar(): void {
    for (const s of this.ambito.values()) {
      if (s.esParametro || s.leida) continue;
      this.avisar(
        s.pos,
        s.lexema.length,
        `declaraste '${s.lexema}' pero nunca la usas.`,
        s.escrita
          ? "Le asignas un valor pero después no la leés. ¿Sobra?"
          : "Si no la necesitas, puedes borrar la declaración.",
      );
    }
  }

  /** Advierte si el programa usa `area` y `área` a la vez (especificación 2.2). */
  private revisarAcentosAmbiguos(): void {
    const sinAcentos = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const porBase = new Map<string, Simbolo[]>();
    for (const s of this.ambito.values()) {
      const base = sinAcentos(s.nombre);
      const lista = porBase.get(base) ?? [];
      lista.push(s);
      porBase.set(base, lista);
    }
    for (const lista of porBase.values()) {
      if (lista.length < 2) continue;
      const nombres = lista.map((s) => `'${s.lexema}'`).join(" y ");
      for (const s of lista.slice(1)) {
        this.avisar(
          s.pos,
          s.lexema.length,
          `el programa usa ${nombres}. Son dos variables distintas.`,
          "Los acentos cuentan en los nombres de variable. Es fácil confundirlas.",
        );
      }
    }
  }

  private resolverTipo(t: TipoDecl): Tipo {
    if (t.clase === "TipoSimple") return simple(t.tipo);

    const dimensiones = t.dimensiones.map((d) => {
      const constante = this.evaluarConstanteEntera(d);
      if (constante === null) {
        this.err(
          d,
          1,
          "el tamaño de un arreglo tiene que ser un número fijo.",
          "No puede depender de una variable: se necesita saberlo antes de ejecutar.",
        );
        return 0;
      }
      if (constante <= 0) {
        this.err(d, 1, `el tamaño de un arreglo tiene que ser mayor que cero, no ${constante}.`);
        return 0;
      }
      return constante;
    });

    return { clase: "Arreglo", base: t.base, dimensiones };
  }

  /** Evalúa expresiones constantes enteras simples, para tamaños de arreglo. */
  private evaluarConstanteEntera(e: Expr): number | null {
    switch (e.clase) {
      case "LiteralNumero":
        return e.esEntero ? e.valor : null;
      case "Unario":
        if (e.op !== "-") return null;
        const v = this.evaluarConstanteEntera(e.operando);
        return v === null ? null : -v;
      case "Binario": {
        const a = this.evaluarConstanteEntera(e.izq);
        const b = this.evaluarConstanteEntera(e.der);
        if (a === null || b === null) return null;
        switch (e.op) {
          case "+":
            return a + b;
          case "-":
            return a - b;
          case "*":
            return a * b;
          case "DIV":
            return b === 0 ? null : Math.trunc(a / b);
          default:
            return null;
        }
      }
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------
  // Sentencias
  // ------------------------------------------------------------------

  private bloque(cuerpo: Sentencia[]): void {
    for (const s of cuerpo) this.sentencia(s);
  }

  private sentencia(s: Sentencia): void {
    switch (s.clase) {
      case "Definir":
        for (const n of s.nombres) {
          this.declarar({
            nombre: n.nombre,
            lexema: n.lexema,
            tipo: this.resolverTipo(s.tipo),
            pos: { linea: n.linea, columna: n.columna },
            esParametro: false,
            esVariableDeControl: false,
            leida: false,
            escrita: false,
          });
        }
        break;

      case "Asignacion":
        this.verificarAsignacion(s.destino, s.valor);
        break;

      case "Leer":
        for (const d of s.destinos) {
          const t = this.tipoDeDesignador(d, { escritura: true });
          if (esArreglo(t)) {
            this.err(
              d,
              1,
              "'Leer' no puede llenar un arreglo completo de una vez.",
              "Usa un 'Para' y leé cada posición: Leer notas[i]",
            );
          }
        }
        break;

      case "Escribir":
        for (const p of s.partes) {
          const t = this.expr(p);
          if (esArreglo(t)) {
            this.err(
              p,
              1,
              "'Escribir' no puede mostrar un arreglo completo.",
              "Recorré el arreglo con 'Para Cada' y escribí cada elemento.",
            );
          }
        }
        break;

      case "Si":
        for (const rama of s.ramas) {
          this.exigirLogico(rama.condicion, "la condición de un 'Si'");
          this.bloque(rama.cuerpo);
        }
        if (s.sino !== null) this.bloque(s.sino);
        break;

      case "Segun":
        this.verificarSegun(s);
        break;

      case "Mientras":
        this.exigirLogico(s.condicion, "la condición de un 'Mientras'");
        this.bloque(s.cuerpo);
        break;

      case "Repetir":
        this.bloque(s.cuerpo);
        this.exigirLogico(s.condicion, "la condición de un 'Hasta Que'");
        break;

      case "Para":
        this.verificarPara(s);
        break;

      case "ParaCada":
        this.verificarParaCada(s);
        break;

      case "LlamarProcedimiento":
        this.verificarLlamada(s.nombre, s.lexema, s.args, s, "sentencia");
        break;

      case "Retornar":
        this.verificarRetornar(s);
        break;
    }
  }

  /**
   * Como `asignable`, pero mirando la expresión y no solo su tipo.
   *
   * Existe por los `Caracter`: la especificación dice que un `Caracter` es un
   * `Texto` de longitud 1, pero no hay literal de carácter aparte. Sin esta
   * regla, `c <- "a"` sería un error y un `Caracter` no se podría inicializar
   * nunca. Un literal de longitud 1 sí encaja; `"ab"` no, y una variable de
   * tipo `Texto` tampoco, porque su longitud no se conoce hasta ejecutar.
   */
  private encaja(destino: Tipo, origen: Tipo, expresion: Expr): boolean {
    if (asignable(destino, origen)) return true;
    return (
      destino.clase === "Caracter" &&
      expresion.clase === "LiteralTexto" &&
      [...expresion.valor].length === 1
    );
  }

  /** Mensaje extra cuando un literal de texto no cabe en un `Caracter`. */
  private porqueNoEncaja(destino: Tipo, expresion: Expr): string | undefined {
    if (destino.clase !== "Caracter" || expresion.clase !== "LiteralTexto") return undefined;
    const largo = [...expresion.valor].length;
    return largo === 0
      ? "Un Caracter guarda exactamente una letra, y este texto está vacío."
      : `Un Caracter guarda una sola letra, y "${expresion.valor}" tiene ${largo}.`;
  }

  private verificarAsignacion(destino: Designador, valor: Expr): void {
    const tipoDestino = this.tipoDeDesignador(destino, { escritura: true });
    const tipoValor = this.expr(valor);

    if (esArreglo(tipoDestino) && !esArreglo(tipoValor)) {
      this.err(
        destino,
        1,
        `'${destino.clase === "Variable" ? destino.lexema : destino.base.lexema}' es un arreglo completo y no puede recibir un solo valor.`,
        "Indica la posición: notas[0] <- 8.5",
      );
      return;
    }

    if (!this.encaja(tipoDestino, tipoValor, valor)) {
      const nombreDestino =
        destino.clase === "Variable" ? destino.lexema : `${destino.base.lexema}[...]`;
      this.err(
        valor,
        1,
        `'${nombreDestino}' es ${art(tipoDestino)} y no puede recibir ${art(tipoValor)}.`,
        this.porqueNoEncaja(tipoDestino, valor) ?? comoConvertir(tipoDestino, tipoValor),
      );
    }

    // Advertencia: modificar la variable de control dentro de su propio bucle.
    if (destino.clase === "Variable" && this.controlesAbiertos.includes(destino.nombre)) {
      this.avisar(
        destino,
        destino.lexema.length,
        `'${destino.lexema}' es la variable que controla el bucle.`,
        "Modificarla acá cambia cuántas veces se repite. Suele ser un error.",
      );
    }
  }

  private verificarSegun(s: Extract<Sentencia, { clase: "Segun" }>): void {
    const tipoSujeto = this.expr(s.sujeto);

    const admitido =
      esIndefinido(tipoSujeto) ||
      tipoSujeto.clase === "Entero" ||
      esTextual(tipoSujeto);
    if (!admitido) {
      this.err(
        s.sujeto,
        1,
        `'Segun' compara contra valores fijos, y ${art(tipoSujeto)} no sirve para eso.`,
        "Solo puede ser Entero, Caracter o Texto. Para comparar reales o lógicos usa 'Si'.",
      );
    }

    const vistos = new Map<string, Posicion>();
    for (const caso of s.casos) {
      for (const v of caso.valores) {
        const tipoValor = this.expr(v);
        if (admitido && !esIndefinido(tipoSujeto) && !this.encaja(tipoSujeto, tipoValor, v)) {
          this.err(
            v,
            1,
            `este caso es ${art(tipoValor)} pero se compara contra ${art(tipoSujeto)}.`,
            "Todos los casos tienen que ser del mismo tipo que la expresión del 'Segun'.",
          );
        }

        const clave =
          v.clase === "LiteralNumero" ? `n:${v.valor}` : `t:${v.valor}`;
        const previo = vistos.get(clave);
        if (previo !== undefined) {
          const texto = v.clase === "LiteralNumero" ? String(v.valor) : `"${v.valor}"`;
          this.err(
            v,
            1,
            `el caso ${texto} ya apareció en la línea ${previo.linea}.`,
            "Un mismo valor no puede estar en dos casos: el segundo nunca se ejecutaría.",
          );
        } else {
          vistos.set(clave, { linea: v.linea, columna: v.columna });
        }
      }
      this.bloque(caso.cuerpo);
    }

    if (s.otroModo !== null) this.bloque(s.otroModo);
  }

  private verificarPara(s: Extract<Sentencia, { clase: "Para" }>): void {
    const tipoVar = this.tipoDeDesignador(s.variable, { escritura: true });

    if (!esIndefinido(tipoVar) && tipoVar.clase !== "Entero") {
      this.err(
        s.variable,
        s.variable.lexema.length,
        `la variable de un 'Para' tiene que ser Entero, y '${s.variable.lexema}' es ${art(tipoVar)}.`,
        esNumerico(tipoVar)
          ? "Contar con decimales acumula errores de redondeo y el bucle puede no terminar. Usa un 'Mientras' si de verdad necesitas pasos decimales."
          : `Declara '${s.variable.lexema}' Como Entero.`,
      );
    }

    for (const [expresion, cual] of [
      [s.desde, "el valor inicial"],
      [s.hasta, "el valor final"],
    ] as const) {
      const t = this.expr(expresion);
      if (!esIndefinido(t) && t.clase !== "Entero") {
        this.err(
          expresion,
          1,
          `${cual} de un 'Para' tiene que ser Entero, y es ${art(t)}.`,
          esNumerico(t) ? "Usa 'Trunc' o 'Redondear' si viene de un cálculo con decimales." : undefined,
        );
      }
    }

    if (s.paso !== null) {
      const t = this.expr(s.paso);
      if (!esIndefinido(t) && t.clase !== "Entero") {
        this.err(s.paso, 1, `el paso de un 'Para' tiene que ser Entero, y es ${art(t)}.`);
      }
      const constante = this.evaluarConstanteEntera(s.paso);
      if (constante === 0) {
        this.err(
          s.paso,
          1,
          "el paso de un 'Para' no puede ser 0.",
          "Con paso 0 la variable nunca cambia y el bucle no termina nunca.",
        );
      }
    }

    // El bucle en sí lee la variable de control en cada iteración (la compara
    // con el límite), así que 'Para i <- 0 Hasta 9' repitiendo algo que no usa
    // 'i' es un patrón legítimo y no debe generar la advertencia de sin uso.
    const simbolo = this.ambito.get(s.variable.nombre);
    if (simbolo !== undefined) simbolo.leida = true;

    this.controlesAbiertos.push(s.variable.nombre);
    this.bloque(s.cuerpo);
    this.controlesAbiertos.pop();
  }

  private verificarParaCada(s: Extract<Sentencia, { clase: "ParaCada" }>): void {
    const tipoVar = this.tipoDeDesignador(s.variable, { escritura: true });
    const tipoArreglo = this.tipoDeDesignador(s.arreglo, { escritura: false });

    if (esIndefinido(tipoArreglo)) {
      this.bloque(s.cuerpo);
      return;
    }

    if (!esArreglo(tipoArreglo)) {
      this.err(
        s.arreglo,
        s.arreglo.lexema.length,
        `'Para Cada' recorre arreglos, y '${s.arreglo.lexema}' es ${art(tipoArreglo)}.`,
      );
      this.bloque(s.cuerpo);
      return;
    }

    if (tipoArreglo.dimensiones.length > 1) {
      this.err(
        s.arreglo,
        s.arreglo.lexema.length,
        `'Para Cada' solo recorre arreglos de una dimensión, y '${s.arreglo.lexema}' tiene ${tipoArreglo.dimensiones.length}.`,
        "Usa 'Para' anidados con índices.",
      );
    }

    const base = simple(tipoArreglo.base);
    if (!esIndefinido(tipoVar) && !asignable(tipoVar, base)) {
      this.err(
        s.variable,
        s.variable.lexema.length,
        `'${s.variable.lexema}' es ${art(tipoVar)} pero '${s.arreglo.lexema}' contiene ${art(base)}.`,
        `Declara '${s.variable.lexema}' Como ${tipoArreglo.base}.`,
      );
    }

    // La variable recibe una copia (especificación 8.3): asignarle no sirve.
    this.controlesAbiertos.push(s.variable.nombre);
    this.bloque(s.cuerpo);
    this.controlesAbiertos.pop();
  }

  private verificarRetornar(s: Extract<Sentencia, { clase: "Retornar" }>): void {
    if (this.funcionActual === null) {
      if (s.valor !== null) {
        const t = this.expr(s.valor);
        void t;
        this.err(
          s,
          8,
          "un procedimiento no devuelve valores, así que 'Retornar' va solo.",
          "Escribe 'Retornar' sin nada después.",
        );
      }
      return;
    }

    const esperado =
      this.subprogramas.get(this.funcionActual.nombre)?.tipoRetorno ?? INDEFINIDO;

    if (s.valor === null) {
      this.err(
        s,
        8,
        `'${this.funcionActual.lexema}' es una función y tiene que devolver un valor.`,
        `Escribe 'Retornar <valor>', o asigna a '${this.funcionActual.variableRetorno.lexema}' y dejá que la función termine sola.`,
      );
      return;
    }

    const t = this.expr(s.valor);
    if (!this.encaja(esperado, t, s.valor)) {
      this.err(
        s.valor,
        1,
        `'${this.funcionActual.lexema}' devuelve ${art(esperado)}, pero acá se retorna ${art(t)}.`,
        comoConvertir(esperado, t),
      );
    }
    // Retornar cuenta como asignación de la variable de retorno.
    const simbolo = this.ambito.get(this.funcionActual.variableRetorno.nombre);
    if (simbolo !== undefined) simbolo.escrita = true;
  }

  // ------------------------------------------------------------------
  // Expresiones
  // ------------------------------------------------------------------

  private exigirLogico(e: Expr, contexto: string): void {
    const t = this.expr(e);
    if (esIndefinido(t) || t.clase === "Logico") return;

    let sugerencia: string | undefined;
    if (esNumerico(t)) {
      const texto = e.clase === "Variable" ? e.lexema : "la expresión";
      sugerencia = `Un número no es Verdadero ni Falso. ¿Quisiste comparar? Por ejemplo '${texto} <> 0'.`;
    } else if (esTextual(t)) {
      sugerencia = 'Un Texto no es Verdadero ni Falso. ¿Quisiste comparar? Por ejemplo \'... <> ""\'.';
    }

    this.err(
      e,
      1,
      `${contexto} tiene que ser Verdadero o Falso, y acá es ${art(t)}.`,
      sugerencia,
    );
  }

  private tipoDeDesignador(d: Designador, opciones: { escritura: boolean }): Tipo {
    const variable = d.clase === "Variable" ? d : d.base;
    const simbolo = this.ambito.get(variable.nombre);

    if (simbolo === undefined) {
      this.reportarNoDeclarada(variable);
      return INDEFINIDO;
    }

    if (opciones.escritura) simbolo.escrita = true;
    else simbolo.leida = true;

    if (d.clase === "Variable") return simbolo.tipo;

    // Acceso indexado.
    const tipoBase = simbolo.tipo;
    for (const indice of d.indices) {
      const t = this.expr(indice);
      if (!esIndefinido(t) && t.clase !== "Entero") {
        this.err(
          indice,
          1,
          `el índice de un arreglo tiene que ser Entero, y acá es ${art(t)}.`,
          esNumerico(t) ? "Usa 'Trunc' o 'Redondear' si viene de un cálculo con decimales." : undefined,
        );
      }
    }

    if (esIndefinido(tipoBase)) return INDEFINIDO;

    if (!esArreglo(tipoBase)) {
      this.err(
        d,
        variable.lexema.length,
        `'${variable.lexema}' es ${art(tipoBase)}, no un arreglo, así que no se puede indexar.`,
        "Los corchetes solo se usan con arreglos.",
      );
      return INDEFINIDO;
    }

    if (d.indices.length !== tipoBase.dimensiones.length) {
      const esperados = tipoBase.dimensiones.length;
      this.err(
        d,
        variable.lexema.length,
        `'${variable.lexema}' tiene ${esperados} ${esperados === 1 ? "dimensión" : "dimensiones"} y acá se usan ${d.indices.length} ${d.indices.length === 1 ? "índice" : "índices"}.`,
        esperados === 1
          ? `Escribe '${variable.lexema}[i]'.`
          : `Escribe '${variable.lexema}[${Array.from({ length: esperados }, (_, i) => `i${i + 1}`).join(", ")}]'.`,
      );
      return INDEFINIDO;
    }

    return simple(tipoBase.base);
  }

  private reportarNoDeclarada(v: Variable): void {
    const parecida = this.nombreParecido(v.nombre);
    this.err(
      v,
      v.lexema.length,
      `'${v.lexema}' no está declarada.`,
      parecida !== undefined
        ? `¿Quisiste escribir '${parecida}'?`
        : `Agrega 'Definir ${v.lexema} Como Real' (o el tipo que corresponda) antes de usarla.`,
    );
  }

  /** Busca un nombre en ámbito a distancia de edición 1 o 2, para sugerirlo. */
  private nombreParecido(objetivo: string): string | undefined {
    let mejor: { lexema: string; distancia: number } | undefined;
    for (const s of this.ambito.values()) {
      const d = distancia(objetivo, s.nombre);
      const umbral = objetivo.length <= 4 ? 1 : 2;
      if (d <= umbral && (mejor === undefined || d < mejor.distancia)) {
        mejor = { lexema: s.lexema, distancia: d };
      }
    }
    return mejor?.lexema;
  }

  private expr(e: Expr): Tipo {
    switch (e.clase) {
      case "LiteralNumero":
        return e.esEntero ? ENTERO : REAL;
      case "LiteralTexto":
        return TEXTO;
      case "LiteralLogico":
        return LOGICO;

      case "Variable": {
        const constante = CONSTANTES[e.nombre];
        if (constante !== undefined && !this.ambito.has(e.nombre)) return constante.tipo;
        return this.tipoDeDesignador(e, { escritura: false });
      }

      case "Indice":
        return this.tipoDeDesignador(e, { escritura: false });

      case "Unario":
        return this.verificarUnario(e);

      case "Binario":
        return this.verificarBinario(e);

      case "Llamada":
        return this.verificarLlamada(e.nombre, e.lexema, e.args, e, "expresion");
    }
  }

  private verificarUnario(e: Extract<Expr, { clase: "Unario" }>): Tipo {
    const t = this.expr(e.operando);
    if (esIndefinido(t)) return INDEFINIDO;

    if (e.op === "No") {
      if (t.clase !== "Logico") {
        this.err(
          e,
          2,
          `'No' se aplica a Verdadero o Falso, y acá se aplica a ${art(t)}.`,
        );
        return LOGICO;
      }
      return LOGICO;
    }

    if (!esNumerico(t)) {
      this.err(e, 1, `no se puede poner un signo menos delante de ${art(t)}.`);
      return INDEFINIDO;
    }
    return t;
  }

  private verificarBinario(e: Extract<Expr, { clase: "Binario" }>): Tipo {
    const a = this.expr(e.izq);
    const b = this.expr(e.der);
    const desconocido = esIndefinido(a) || esIndefinido(b);

    const fallar = (mensaje: string, sugerencia?: string): void => {
      if (!desconocido) this.err(e, e.op.length, mensaje, sugerencia);
    };

    switch (e.op) {
      case "+": {
        if (esNumerico(a) && esNumerico(b)) return combinarNumericos(a, b);
        if (esTextual(a) && esTextual(b)) return TEXTO;
        if (desconocido) return INDEFINIDO;
        // El caso clásico: pegar un texto con un número.
        fallar(
          `no se puede sumar ${art(a)} y ${art(b)}.`,
          esTextual(a) || esTextual(b)
            ? "Para pegar un texto con un número, usa una coma en 'Escribir': Escribir \"Total: \", 5"
            : undefined,
        );
        return INDEFINIDO;
      }

      case "-":
      case "*": {
        if (esNumerico(a) && esNumerico(b)) return combinarNumericos(a, b);
        if (desconocido) return INDEFINIDO;
        fallar(`no se puede usar '${e.op}' entre ${art(a)} y ${art(b)}.`);
        return INDEFINIDO;
      }

      case "/": {
        if (esNumerico(a) && esNumerico(b)) return REAL;
        if (desconocido) return INDEFINIDO;
        fallar(`no se puede dividir ${art(a)} entre ${art(b)}.`);
        return INDEFINIDO;
      }

      case "^": {
        if (esNumerico(a) && esNumerico(b)) return REAL;
        if (desconocido) return INDEFINIDO;
        fallar(`no se puede elevar ${art(a)} a ${art(b)}.`);
        return INDEFINIDO;
      }

      case "DIV":
      case "MOD": {
        if (a.clase === "Entero" && b.clase === "Entero") return ENTERO;
        if (desconocido) return INDEFINIDO;
        const culpable = a.clase !== "Entero" ? a : b;
        fallar(
          `'${e.op}' funciona solo entre enteros, y acá hay ${art(culpable)}.`,
          esNumerico(culpable)
            ? `Para dividir con decimales usa '/'. Para convertir a entero, 'Trunc' o 'Redondear'.`
            : undefined,
        );
        return ENTERO;
      }

      case "=":
      case "<>": {
        if (desconocido) return LOGICO;
        const compatibles =
          (esNumerico(a) && esNumerico(b)) ||
          (esTextual(a) && esTextual(b)) ||
          (a.clase === "Logico" && b.clase === "Logico");
        if (!compatibles) {
          fallar(
            `no se puede comparar ${art(a)} con ${art(b)}.`,
            "Solo se comparan valores del mismo tipo.",
          );
        }
        if (esArreglo(a) || esArreglo(b)) {
          fallar(
            "no se pueden comparar arreglos completos.",
            "Compara posición por posición dentro de un bucle.",
          );
        }
        return LOGICO;
      }

      case "<":
      case ">":
      case "<=":
      case ">=": {
        if (desconocido) return LOGICO;
        const ordenable =
          (esNumerico(a) && esNumerico(b)) || (esTextual(a) && esTextual(b));
        if (!ordenable) {
          fallar(
            `no se puede usar '${e.op}' entre ${art(a)} y ${art(b)}.`,
            a.clase === "Logico" || b.clase === "Logico"
              ? "Verdadero y Falso no se ordenan. Usa '=' o '<>'."
              : "Solo se ordenan números entre sí, o textos entre sí.",
          );
        }
        return LOGICO;
      }

      case "Y":
      case "O": {
        if (desconocido) return LOGICO;
        if (a.clase !== "Logico" || b.clase !== "Logico") {
          const culpable = a.clase !== "Logico" ? a : b;
          fallar(
            `'${e.op}' une condiciones, y acá hay ${art(culpable)}.`,
            esNumerico(culpable)
              ? "¿Faltó una comparación? Por ejemplo '... > 0'."
              : undefined,
          );
        }
        return LOGICO;
      }
    }
  }

  // ------------------------------------------------------------------
  // Llamadas
  // ------------------------------------------------------------------

  private verificarLlamada(
    nombreLlamada: string,
    lexema: string,
    args: Expr[],
    pos: Posicion,
    uso: "expresion" | "sentencia",
  ): Tipo {
    const integrada = INTEGRADAS[nombreLlamada];
    if (integrada !== undefined) {
      if (uso === "sentencia") {
        this.err(
          pos,
          lexema.length,
          `'${integrada.lexema}' devuelve un valor, así que no puede usarse como una instrucción suelta.`,
          `Usa el resultado: por ejemplo 'x <- ${integrada.lexema}(...)'.`,
        );
      }
      return this.verificarIntegrada(nombreLlamada, lexema, args, pos);
    }

    const sp = this.subprogramas.get(nombreLlamada);
    if (sp === undefined) {
      const parecida = this.subprogramaParecido(nombreLlamada);
      this.err(
        pos,
        lexema.length,
        `no existe ninguna función ni procedimiento llamado '${lexema}'.`,
        parecida !== undefined ? `¿Quisiste escribir '${parecida}'?` : undefined,
      );
      for (const a of args) this.expr(a);
      return INDEFINIDO;
    }

    if (uso === "expresion" && sp.clase === "Procedimiento") {
      this.err(
        pos,
        lexema.length,
        `'${sp.lexema}' es un procedimiento y no devuelve ningún valor, así que no puede usarse dentro de una expresión.`,
        "Si tiene que devolver algo, conviértelo en 'Funcion'.",
      );
    }
    if (uso === "sentencia" && sp.clase === "Funcion") {
      this.err(
        pos,
        lexema.length,
        `'${sp.lexema}' es una función: devuelve un valor que acá se descarta.`,
        `Usa el resultado: por ejemplo 'x <- ${sp.lexema}(...)'.`,
      );
    }

    this.verificarArgumentos(sp, lexema, args, pos);
    return sp.tipoRetorno;
  }

  private verificarArgumentos(
    sp: FirmaSubprograma,
    lexema: string,
    args: Expr[],
    pos: Posicion,
  ): void {
    if (args.length !== sp.parametros.length) {
      const esperados = sp.parametros.length;
      this.err(
        pos,
        lexema.length,
        `'${sp.lexema}' espera ${esperados} ${esperados === 1 ? "argumento" : "argumentos"} y recibió ${args.length}.`,
        esperados === 0
          ? undefined
          : `Los parámetros son: ${sp.parametros.map((p) => p.lexema).join(", ")}.`,
      );
      for (const a of args) this.expr(a);
      return;
    }

    args.forEach((arg, i) => {
      const parametro = sp.parametros[i]!;
      const esperado = parametro.tipo === null ? INDEFINIDO : this.resolverTipo(parametro.tipo);

      // 'Por Referencia' necesita una variable, no una expresión: hay que poder
      // escribir de vuelta en ella.
      if (parametro.porReferencia && arg.clase !== "Variable" && arg.clase !== "Indice") {
        this.err(
          arg,
          1,
          `'${parametro.lexema}' es 'Por Referencia', así que acá tiene que ir una variable, no un cálculo.`,
          "El subprograma necesita poder modificarla.",
        );
        this.expr(arg);
        return;
      }

      const recibido = this.expr(arg);

      // Por referencia el tipo tiene que coincidir exacto: ensanchar
      // Entero → Real crearía una copia y las modificaciones se perderían.
      const compatible = parametro.porReferencia
        ? esIndefinido(esperado) || esIndefinido(recibido) || iguales(esperado, recibido)
        : this.encaja(esperado, recibido, arg);

      if (!compatible) {
        this.err(
          arg,
          1,
          `'${parametro.lexema}' es ${art(esperado)} y acá se le pasa ${art(recibido)}.`,
          parametro.porReferencia && asignable(esperado, recibido)
            ? "Al ser 'Por Referencia' el tipo tiene que ser exactamente el mismo, porque el subprograma escribe de vuelta en la variable."
            : comoConvertir(esperado, recibido),
        );
      }

      if (parametro.porReferencia && arg.clase === "Variable") {
        const simbolo = this.ambito.get(arg.nombre);
        if (simbolo !== undefined) simbolo.escrita = true;
      }
    });
  }

  private verificarIntegrada(
    nombreLlamada: string,
    lexema: string,
    args: Expr[],
    pos: Posicion,
  ): Tipo {
    const integrada = INTEGRADAS[nombreLlamada]!;
    const tiposArgs = args.map((a) => this.expr(a));

    // `Longitud` es la única que además acepta un arreglo.
    if (integrada.aceptaArreglo === true && tiposArgs.length === 1 && esArreglo(tiposArgs[0]!)) {
      return ENTERO;
    }

    const compatible = (firma: Firma): boolean =>
      firma.params.length === tiposArgs.length &&
      firma.params.every((familia, i) => coincideFamilia(familia, tiposArgs[i]!));

    const elegida = integrada.firmas.find(compatible);
    if (elegida !== undefined) {
      if (elegida.retorno === "mismoQueArg0") return tiposArgs[0] ?? INDEFINIDO;
      return tipoDeFamilia(elegida.retorno);
    }

    const primera = integrada.firmas[0]!;

    if (primera.params.length !== tiposArgs.length) {
      const n = primera.params.length;
      this.err(
        pos,
        lexema.length,
        `'${integrada.lexema}' espera ${n} ${n === 1 ? "argumento" : "argumentos"} y recibió ${tiposArgs.length}.`,
        `Se usa así: ${integrada.lexema}(${primera.params.map(describirFamilia).join(", ")}).`,
      );
      return INDEFINIDO;
    }

    // La aridad está bien: el problema es un tipo. Se señala el primero que falla.
    const indiceMalo = primera.params.findIndex(
      (familia, i) => !coincideFamilia(familia, tiposArgs[i]!),
    );
    if (indiceMalo >= 0) {
      this.err(
        args[indiceMalo] ?? pos,
        1,
        `'${integrada.lexema}' espera ${describirFamilia(primera.params[indiceMalo]!)} y acá recibe ${art(tiposArgs[indiceMalo]!)}.`,
        integrada.aceptaArreglo === true
          ? `'${integrada.lexema}' funciona con textos y con arreglos.`
          : undefined,
      );
    }

    if (primera.retorno === "mismoQueArg0") return INDEFINIDO;
    return tipoDeFamilia(primera.retorno);
  }

  private subprogramaParecido(objetivo: string): string | undefined {
    let mejor: { lexema: string; distancia: number } | undefined;
    const candidatos = [
      ...[...this.subprogramas.values()].map((s) => ({ nombre: s.lexema.toLowerCase(), lexema: s.lexema })),
      ...Object.entries(INTEGRADAS).map(([n, i]) => ({ nombre: n, lexema: i.lexema })),
    ];
    for (const c of candidatos) {
      const d = distancia(objetivo, c.nombre);
      const umbral = objetivo.length <= 4 ? 1 : 2;
      if (d <= umbral && (mejor === undefined || d < mejor.distancia)) {
        mejor = { lexema: c.lexema, distancia: d };
      }
    }
    return mejor?.lexema;
  }
}

/** Distancia de edición, acotada: solo se usa para sugerir nombres parecidos. */
function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  const actual = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    actual[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(actual[j - 1]! + 1, previa[j]! + 1, previa[j - 1]! + costo);
    }
    for (let j = 0; j <= b.length; j++) previa[j] = actual[j]!;
  }
  return previa[b.length]!;
}
