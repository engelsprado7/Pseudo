/**
 * Intérprete: recorre el AST y ejecuta.
 *
 * Está escrito como generador (`function*`) de arriba abajo. Eso resuelve tres
 * problemas de una sola vez:
 *
 *   1. **`Leer` sin bloquear.** JavaScript no puede detener la ejecución a
 *      esperar al usuario. El intérprete hace `yield` pidiendo un valor y quien
 *      lo llama lo reanuda cuando lo tiene. Como `Leer` puede aparecer dentro de
 *      una función llamada dentro de una expresión, *todo* el evaluador tiene
 *      que ser generador, no solo las sentencias.
 *   2. **Ejecución paso a paso.** El mismo mecanismo permite pausar en cada
 *      sentencia y mirar las variables, sin ninguna maquinaria aparte.
 *   3. **No congelar la página.** Quien lo llama controla cuántos pasos avanza
 *      antes de devolver el control al navegador.
 *
 * Da por sentado que el programa ya pasó por `verificar()`: acá no se revisan
 * tipos. Lo que sí se controla es lo que la especificación deja para tiempo de
 * ejecución: usar una variable sin valor (§4.2), índice fuera de rango (§4.3),
 * división por cero (§10.2), bucles infinitos (§8.4) y recursión sin fondo (§9.1).
 */
import type {
  Designador,
  Expr,
  Programa,
  Sentencia,
  Subprograma,
  TipoDecl,
  TipoSimple,
} from "./ast.ts";
import type { Posicion } from "./token.ts";
import { error, type Diagnostico } from "./diagnostico.ts";
import {
  arregloVacio,
  copiar,
  entero,
  esCadena,
  esNumero,
  logico,
  mostrar,
  nombreTipoDe,
  real,
  texto,
  totalCeldas,
  type Valor,
} from "./valores.ts";

// ------------------------------------------------------------------
// Protocolo con quien ejecuta
// ------------------------------------------------------------------

export type Evento =
  | { clase: "salida"; texto: string; sinSalto: boolean }
  | {
      clase: "entrada";
      pos: Posicion;
      tipoEsperado: TipoSimple;
      nombreVariable: string;
      /** Presente cuando la entrada anterior no era válida y se vuelve a pedir. */
      reintento?: string;
    }
  | { clase: "paso"; pos: Posicion; variables: Instantanea[] };

export interface Instantanea {
  nombre: string;
  tipo: string;
  /** `null` cuando la variable todavía no tiene valor. */
  valor: string | null;
}

export type Resultado =
  | { clase: "terminado"; pasos: number }
  | { clase: "error"; diagnostico: Diagnostico; pasos: number };

export interface Opciones {
  /** Emite un evento `paso` antes de cada sentencia. Apagado por defecto. */
  pasoAPaso?: boolean;
  /** Tope de pasos antes de asumir bucle infinito (§8.4). */
  limitePasos?: number;
  /** Profundidad máxima de llamadas anidadas (§9.1). */
  limitePila?: number;
}

const LIMITE_PASOS = 5_000_000;
const LIMITE_PILA = 500;

export type Ejecucion = Generator<Evento, Resultado, string | undefined>;

export function ejecutar(programa: Programa, opciones: Opciones = {}): Ejecucion {
  return new Interprete(programa, opciones).correr();
}

// ------------------------------------------------------------------
// Internos
// ------------------------------------------------------------------

/** Señal de control, no un error del alumno. */
class SenalRetorno {
  readonly valor: Valor | undefined;
  constructor(valor: Valor | undefined) {
    this.valor = valor;
  }
}

class ErrorEjecucion extends Error {
  readonly diagnostico: Diagnostico;
  constructor(diagnostico: Diagnostico) {
    super(diagnostico.mensaje);
    this.diagnostico = diagnostico;
  }
}

/**
 * Acceso indirecto a una posición de memoria.
 *
 * Unifica "una variable" y "una celda de un arreglo" bajo la misma interfaz, que
 * es lo que hace que `Por Referencia` funcione igual con `Duplicar(n)` y con
 * `Duplicar(notas[0])`.
 */
interface Referencia {
  leer(): Valor | undefined;
  escribir(v: Valor): void;
  descripcion: string;
}

interface Celda {
  valor: Valor | undefined;
  tipo: TipoDecl;
}

/** Contador de iteraciones de un bucle, para culpar al correcto (§8.4). */
interface RegistroBucle {
  clase: string;
  linea: number;
  iteraciones: number;
}

class Interprete {
  private readonly programa: Programa;
  private readonly opciones: Opciones;
  private readonly subprogramas = new Map<string, Subprograma>();

  private ambito = new Map<string, Celda>();
  private pasos = 0;
  private profundidad = 0;
  private readonly bucles: RegistroBucle[] = [];
  private readonly limitePasos: number;
  private readonly limitePila: number;

  constructor(programa: Programa, opciones: Opciones) {
    this.programa = programa;
    this.opciones = opciones;
    this.limitePasos = opciones.limitePasos ?? LIMITE_PASOS;
    this.limitePila = opciones.limitePila ?? LIMITE_PILA;
  }

  // ----------------------------------------------------------------

  private fallar(pos: Posicion, mensaje: string, sugerencia?: string): never {
    throw new ErrorEjecucion(error(pos, 1, mensaje, sugerencia));
  }

  *correr(): Ejecucion {
    for (const sp of this.programa.subprogramas) this.subprogramas.set(sp.nombre, sp);

    try {
      yield* this.bloque(this.programa.principal);
      return { clase: "terminado", pasos: this.pasos };
    } catch (e) {
      if (e instanceof ErrorEjecucion) {
        return { clase: "error", diagnostico: e.diagnostico, pasos: this.pasos };
      }
      if (e instanceof SenalRetorno) {
        // 'Retornar' en el bloque principal: termina el programa.
        return { clase: "terminado", pasos: this.pasos };
      }
      throw e;
    }
  }

  private contarPaso(pos: Posicion): void {
    this.pasos++;
    if (this.pasos <= this.limitePasos) return;

    const peor = this.bucles.reduce<RegistroBucle | null>(
      (a, b) => (a === null || b.iteraciones > a.iteraciones ? b : a),
      null,
    );

    const cifra = this.limitePasos.toLocaleString("es");
    if (peor === null) {
      this.fallar(pos, `el programa lleva ${cifra} pasos sin terminar.`);
    }
    this.fallar(
      { linea: peor.linea, columna: 1 },
      `el programa lleva ${cifra} pasos sin terminar. Probablemente hay un bucle infinito.`,
      `El '${peor.clase}' de la línea ${peor.linea} se repitió ${peor.iteraciones.toLocaleString("es")} veces. Revisá que su condición llegue a cumplirse.`,
    );
  }

  private instantanea(): Instantanea[] {
    return [...this.ambito.entries()].map(([nombre, celda]) => ({
      nombre,
      tipo:
        celda.tipo.clase === "TipoSimple"
          ? celda.tipo.tipo
          : `Arreglo De ${celda.tipo.base}`,
      valor: celda.valor === undefined ? null : mostrar(celda.valor),
    }));
  }

  // ----------------------------------------------------------------
  // Sentencias
  // ----------------------------------------------------------------

  private *bloque(cuerpo: Sentencia[]): Generator<Evento, void, string | undefined> {
    for (const s of cuerpo) yield* this.sentencia(s);
  }

  private *sentencia(s: Sentencia): Generator<Evento, void, string | undefined> {
    this.contarPaso(s);
    if (this.opciones.pasoAPaso === true) {
      yield { clase: "paso", pos: { linea: s.linea, columna: s.columna }, variables: this.instantanea() };
    }

    switch (s.clase) {
      case "Definir":
        for (const n of s.nombres) {
          this.ambito.set(n.nombre, {
            valor:
              s.tipo.clase === "TipoArreglo"
                ? arregloVacio(s.tipo.base, yield* this.dimensiones(s.tipo))
                : undefined,
            tipo: s.tipo,
          });
        }
        break;

      case "Asignacion": {
        const ref = yield* this.referencia(s.destino);
        const valor = yield* this.expr(s.valor);
        ref.escribir(this.adaptar(valor, this.tipoDe(s.destino), s.valor));
        break;
      }

      case "Leer":
        for (const d of s.destinos) {
          const ref = yield* this.referencia(d);
          const tipo = this.tipoDe(d);
          const esperado: TipoSimple = tipo ?? "Texto";
          ref.escribir(yield* this.pedirEntrada(d, esperado, ref.descripcion));
        }
        break;

      case "Escribir": {
        let texto = "";
        for (const parte of s.partes) texto += mostrar(yield* this.expr(parte));
        yield { clase: "salida", texto, sinSalto: s.sinSalto };
        break;
      }

      case "Si": {
        for (const rama of s.ramas) {
          if (yield* this.condicion(rama.condicion)) {
            yield* this.bloque(rama.cuerpo);
            return;
          }
        }
        if (s.sino !== null) yield* this.bloque(s.sino);
        break;
      }

      case "Segun": {
        const sujeto = yield* this.expr(s.sujeto);
        for (const caso of s.casos) {
          for (const literal of caso.valores) {
            const v = yield* this.expr(literal);
            if (this.mismoValor(sujeto, v)) {
              // Sin caída entre casos (§7.1): al terminar, salta a FinSegun.
              yield* this.bloque(caso.cuerpo);
              return;
            }
          }
        }
        if (s.otroModo !== null) yield* this.bloque(s.otroModo);
        break;
      }

      case "Mientras": {
        const registro: RegistroBucle = { clase: "Mientras", linea: s.linea, iteraciones: 0 };
        this.bucles.push(registro);
        try {
          while (yield* this.condicion(s.condicion)) {
            registro.iteraciones++;
            this.contarPaso(s);
            yield* this.bloque(s.cuerpo);
          }
        } finally {
          this.bucles.pop();
        }
        break;
      }

      case "Repetir": {
        const registro: RegistroBucle = { clase: "Repetir", linea: s.linea, iteraciones: 0 };
        this.bucles.push(registro);
        try {
          do {
            registro.iteraciones++;
            this.contarPaso(s);
            yield* this.bloque(s.cuerpo);
          } while (!(yield* this.condicion(s.condicion)));
        } finally {
          this.bucles.pop();
        }
        break;
      }

      case "Para":
        yield* this.ejecutarPara(s);
        break;

      case "ParaCada":
        yield* this.ejecutarParaCada(s);
        break;

      case "LlamarProcedimiento":
        yield* this.invocar(s.nombre, s.lexema, s.args, s);
        break;

      case "Retornar": {
        const valor = s.valor === null ? undefined : yield* this.expr(s.valor);
        throw new SenalRetorno(valor);
      }
    }
  }

  private *ejecutarPara(
    s: Extract<Sentencia, { clase: "Para" }>,
  ): Generator<Evento, void, string | undefined> {
    // Inicial, límite y paso se evalúan UNA sola vez (§8.1).
    const desde = this.comoEntero(yield* this.expr(s.desde), s.desde);
    const hasta = this.comoEntero(yield* this.expr(s.hasta), s.hasta);
    const paso = s.paso === null ? 1 : this.comoEntero(yield* this.expr(s.paso), s.paso);

    if (paso === 0) {
      this.fallar(
        s.paso ?? s,
        "el paso de un 'Para' no puede ser 0.",
        "Con paso 0 la variable nunca cambia y el bucle no termina nunca.",
      );
    }

    const ref = yield* this.referencia(s.variable);
    const registro: RegistroBucle = { clase: "Para", linea: s.linea, iteraciones: 0 };
    this.bucles.push(registro);

    try {
      ref.escribir(entero(desde));
      while (true) {
        const actual = ref.leer();
        if (actual === undefined || actual.clase !== "Entero") break;
        if (paso > 0 ? actual.n > hasta : actual.n < hasta) break;

        registro.iteraciones++;
        this.contarPaso(s);
        yield* this.bloque(s.cuerpo);

        // Se relee: el cuerpo pudo haber modificado la variable, y la
        // especificación 8.1 dice que eso afecta al bucle.
        const despues = ref.leer();
        if (despues === undefined || despues.clase !== "Entero") break;
        ref.escribir(entero(despues.n + paso));
      }
    } finally {
      this.bucles.pop();
    }
  }

  private *ejecutarParaCada(
    s: Extract<Sentencia, { clase: "ParaCada" }>,
  ): Generator<Evento, void, string | undefined> {
    const arreglo = yield* this.leerVariable(s.arreglo);
    if (arreglo.clase !== "Arreglo") {
      this.fallar(s.arreglo, `'${s.arreglo.lexema}' no es un arreglo.`);
    }

    const ref = yield* this.referencia(s.variable);
    const registro: RegistroBucle = { clase: "Para Cada", linea: s.linea, iteraciones: 0 };
    this.bucles.push(registro);

    try {
      for (let i = 0; i < arreglo.celdas.length; i++) {
        const celda = arreglo.celdas[i];
        if (celda === undefined) {
          this.fallar(
            s.arreglo,
            `'${s.arreglo.lexema}[${i}]' no tiene valor todavía.`,
            "Hay que llenar el arreglo antes de recorrerlo.",
          );
        }
        registro.iteraciones++;
        this.contarPaso(s);
        // La variable recibe una copia (§8.3): modificarla no toca el arreglo.
        ref.escribir(copiar(celda));
        yield* this.bloque(s.cuerpo);
      }
    } finally {
      this.bucles.pop();
    }
  }

  // ----------------------------------------------------------------
  // Entrada
  // ----------------------------------------------------------------

  private *pedirEntrada(
    pos: Posicion,
    esperado: TipoSimple,
    nombreVariable: string,
  ): Generator<Evento, Valor, string | undefined> {
    let reintento: string | undefined;

    while (true) {
      const crudo: string | undefined = yield {
        clase: "entrada",
        pos: { linea: pos.linea, columna: pos.columna },
        tipoEsperado: esperado,
        nombreVariable,
        ...(reintento === undefined ? {} : { reintento }),
      };

      if (crudo === undefined) {
        this.fallar(pos, "se terminó la entrada y el programa todavía espera un valor.");
      }

      const convertido = this.convertirEntrada(crudo.trim(), esperado);
      if (convertido !== null) return convertido;

      // Error recuperable (§6.2): es culpa de quien tipea, no del programa.
      reintento = this.explicarEntrada(crudo.trim(), esperado, nombreVariable);
    }
  }

  private convertirEntrada(crudo: string, esperado: TipoSimple): Valor | null {
    switch (esperado) {
      case "Entero": {
        if (!/^[+-]?\d+$/.test(crudo)) return null;
        const n = Number(crudo);
        return Number.isSafeInteger(n) ? entero(n) : null;
      }
      case "Real": {
        // Se acepta la coma decimal: es como se escribe en castellano.
        const normalizado = crudo.replace(",", ".");
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalizado)) return null;
        return real(Number(normalizado));
      }
      case "Texto":
        return texto(crudo);
      case "Caracter":
        return [...crudo].length === 1 ? { clase: "Caracter", s: crudo } : null;
      case "Logico": {
        const sin = crudo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (["verdadero", "v", "si", "s", "1"].includes(sin)) return logico(true);
        if (["falso", "f", "no", "n", "0"].includes(sin)) return logico(false);
        return null;
      }
    }
  }

  private explicarEntrada(crudo: string, esperado: TipoSimple, nombre: string): string {
    const mostrado = crudo === "" ? "(nada)" : `"${crudo}"`;
    switch (esperado) {
      case "Entero":
        return `'${nombre}' es Entero, pero se ingresó ${mostrado}, que no es un número entero. Intentá de nuevo.`;
      case "Real":
        return `'${nombre}' es Real, pero se ingresó ${mostrado}, que no es un número. Intentá de nuevo.`;
      case "Caracter":
        return `'${nombre}' es Caracter y guarda una sola letra, pero se ingresó ${mostrado}. Intentá de nuevo.`;
      case "Logico":
        return `'${nombre}' es Logico: escribí Verdadero o Falso (o V / F, o si / no).`;
      case "Texto":
        return `'${nombre}' espera un texto.`;
    }
  }

  // ----------------------------------------------------------------
  // Designadores y referencias
  // ----------------------------------------------------------------

  private tipoDe(d: Designador): TipoSimple | null {
    const variable = d.clase === "Variable" ? d : d.base;
    const celda = this.ambito.get(variable.nombre);
    if (celda === undefined) return null;
    if (celda.tipo.clase === "TipoSimple") return celda.tipo.tipo;
    return d.clase === "Indice" ? celda.tipo.base : null;
  }

  private *dimensiones(
    t: Extract<TipoDecl, { clase: "TipoArreglo" }>,
  ): Generator<Evento, number[], string | undefined> {
    const salida: number[] = [];
    for (const d of t.dimensiones) {
      const v = yield* this.expr(d);
      salida.push(this.comoEntero(v, d));
    }
    return salida;
  }

  private *referencia(d: Designador): Generator<Evento, Referencia, string | undefined> {
    const variable = d.clase === "Variable" ? d : d.base;
    const celda = this.ambito.get(variable.nombre);

    if (celda === undefined) {
      this.fallar(variable, `'${variable.lexema}' no está declarada.`);
    }

    if (d.clase === "Variable") {
      return {
        leer: () => celda.valor,
        escribir: (v) => {
          celda.valor = v;
        },
        descripcion: variable.lexema,
      };
    }

    const contenedor = celda.valor;
    if (contenedor === undefined || contenedor.clase !== "Arreglo") {
      this.fallar(variable, `'${variable.lexema}' no es un arreglo.`);
    }

    const indices: number[] = [];
    for (const e of d.indices) indices.push(this.comoEntero(yield* this.expr(e), e));

    const plano = this.indicePlano(contenedor, indices, d, variable.lexema);
    return {
      leer: () => contenedor.celdas[plano],
      escribir: (v) => {
        contenedor.celdas[plano] = v;
      },
      descripcion: `${variable.lexema}[${indices.join(", ")}]`,
    };
  }

  /** Índice lineal, con control de rango base 0 (§4.3). */
  private indicePlano(
    arreglo: Extract<Valor, { clase: "Arreglo" }>,
    indices: number[],
    pos: Posicion,
    lexema: string,
  ): number {
    let plano = 0;
    for (let k = 0; k < arreglo.dimensiones.length; k++) {
      const tope = arreglo.dimensiones[k]!;
      const i = indices[k]!;
      if (i < 0 || i >= tope) {
        const cual =
          arreglo.dimensiones.length === 1
            ? ""
            : ` en la dimensión ${k + 1}`;
        this.fallar(
          pos,
          `el índice ${i} está fuera del rango 0..${tope - 1} de '${lexema}'${cual}.`,
          i === tope
            ? `Un arreglo de ${tope} elementos va de 0 a ${tope - 1}. El último es '${lexema}[${tope - 1}]'.`
            : undefined,
        );
      }
      plano = plano * tope + i;
    }
    return plano;
  }

  private *leerVariable(d: Designador): Generator<Evento, Valor, string | undefined> {
    const ref = yield* this.referencia(d);
    const v = ref.leer();
    if (v === undefined) {
      this.fallar(
        d,
        `'${ref.descripcion}' se usa antes de recibir un valor.`,
        "Hay que asignarle algo antes de leerla. Este lenguaje no pone ceros por defecto a propósito.",
      );
    }
    return v;
  }

  // ----------------------------------------------------------------
  // Expresiones
  // ----------------------------------------------------------------

  private *condicion(e: Expr): Generator<Evento, boolean, string | undefined> {
    const v = yield* this.expr(e);
    if (v.clase !== "Logico") {
      this.fallar(e, `la condición tiene que ser Verdadero o Falso, y es ${nombreTipoDe(v)}.`);
    }
    return v.b;
  }

  private *expr(e: Expr): Generator<Evento, Valor, string | undefined> {
    switch (e.clase) {
      case "LiteralNumero":
        return e.esEntero ? entero(e.valor) : real(e.valor);
      case "LiteralTexto":
        return texto(e.valor);
      case "LiteralLogico":
        return logico(e.valor);

      case "Variable":
        if (e.nombre === "pi" && !this.ambito.has("pi")) return real(Math.PI);
        return yield* this.leerVariable(e);

      case "Indice":
        return yield* this.leerVariable(e);

      case "Unario": {
        const v = yield* this.expr(e.operando);
        if (e.op === "No") {
          if (v.clase !== "Logico") {
            this.fallar(e, `'No' se aplica a Verdadero o Falso, no a ${nombreTipoDe(v)}.`);
          }
          return logico(!v.b);
        }
        if (!esNumero(v)) {
          this.fallar(e, `no se puede poner un signo menos delante de ${nombreTipoDe(v)}.`);
        }
        return v.clase === "Entero" ? entero(-v.n) : real(-v.n);
      }

      case "Binario":
        return yield* this.binario(e);

      case "Llamada": {
        const integrada = yield* this.integrada(e);
        if (integrada !== null) return integrada;
        const v = yield* this.invocar(e.nombre, e.lexema, e.args, e);
        if (v === undefined) {
          this.fallar(e, `'${e.lexema}' no devolvió ningún valor.`);
        }
        return v;
      }
    }
  }

  private *binario(
    e: Extract<Expr, { clase: "Binario" }>,
  ): Generator<Evento, Valor, string | undefined> {
    // Corto circuito (§10.2): el segundo operando no se evalúa si el primero
    // ya decide. Es lo que permite 'i <= n Y notas[i] > 5' sin salir del rango.
    if (e.op === "Y" || e.op === "O") {
      const a = yield* this.condicion(e.izq);
      if (e.op === "Y" && !a) return logico(false);
      if (e.op === "O" && a) return logico(true);
      return logico(yield* this.condicion(e.der));
    }

    const a = yield* this.expr(e.izq);
    const b = yield* this.expr(e.der);

    switch (e.op) {
      case "+":
        if (esNumero(a) && esNumero(b)) return this.aritmetica(a, b, a.n + b.n, e);
        if (esCadena(a) && esCadena(b)) return texto(a.s + b.s);
        return this.fallar(e, `no se puede sumar ${nombreTipoDe(a)} y ${nombreTipoDe(b)}.`);

      case "-":
        this.exigirNumeros(a, b, e, "restar");
        return this.aritmetica(a, b, (a as { n: number }).n - (b as { n: number }).n, e);

      case "*":
        this.exigirNumeros(a, b, e, "multiplicar");
        return this.aritmetica(a, b, (a as { n: number }).n * (b as { n: number }).n, e);

      case "/": {
        this.exigirNumeros(a, b, e, "dividir");
        const divisor = (b as { n: number }).n;
        if (divisor === 0) {
          this.fallar(
            e,
            "división por cero.",
            "Antes de dividir, comprobá que el divisor no sea 0.",
          );
        }
        return real((a as { n: number }).n / divisor);
      }

      case "DIV": {
        this.exigirNumeros(a, b, e, "dividir");
        const divisor = (b as { n: number }).n;
        if (divisor === 0) {
          this.fallar(e, "división por cero en 'DIV'.", "Comprobá que el divisor no sea 0.");
        }
        return entero(Math.trunc((a as { n: number }).n / divisor));
      }

      case "MOD": {
        this.exigirNumeros(a, b, e, "usar 'MOD' entre");
        const divisor = (b as { n: number }).n;
        if (divisor === 0) {
          this.fallar(e, "división por cero en 'MOD'.", "Comprobá que el divisor no sea 0.");
        }
        // El signo del resto sigue al dividendo, como dice §10.2.
        return entero((a as { n: number }).n % divisor);
      }

      case "^":
        this.exigirNumeros(a, b, e, "elevar");
        return real(Math.pow((a as { n: number }).n, (b as { n: number }).n));

      case "=":
        return logico(this.mismoValor(a, b));
      case "<>":
        return logico(!this.mismoValor(a, b));

      case "<":
      case ">":
      case "<=":
      case ">=": {
        const orden = this.comparar(a, b, e);
        switch (e.op) {
          case "<":
            return logico(orden < 0);
          case ">":
            return logico(orden > 0);
          case "<=":
            return logico(orden <= 0);
          default:
            return logico(orden >= 0);
        }
      }
    }
  }

  private exigirNumeros(a: Valor, b: Valor, pos: Posicion, verbo: string): void {
    if (esNumero(a) && esNumero(b)) return;
    const culpable = esNumero(a) ? b : a;
    this.fallar(pos, `no se puede ${verbo} ${nombreTipoDe(culpable)}.`);
  }

  /** Resultado entero si ambos operandos lo son, con control de desborde. */
  private aritmetica(a: Valor, b: Valor, resultado: number, pos: Posicion): Valor {
    if (a.clase === "Entero" && b.clase === "Entero") {
      if (!Number.isSafeInteger(resultado)) {
        this.fallar(
          pos,
          "el resultado es un número entero demasiado grande para representarlo con exactitud.",
          "Los enteros llegan hasta unos 9 mil billones. Si necesitas más, usá Real y acepta el redondeo.",
        );
      }
      return entero(resultado);
    }
    return real(resultado);
  }

  private mismoValor(a: Valor, b: Valor): boolean {
    if (esNumero(a) && esNumero(b)) return a.n === b.n;
    if (esCadena(a) && esCadena(b)) return a.s === b.s;
    if (a.clase === "Logico" && b.clase === "Logico") return a.b === b.b;
    return false;
  }

  /**
   * Orden entre dos valores. Los textos se comparan con `localeCompare` en
   * castellano, así que "álamo" < "banco" como esperaría cualquiera. Comparar
   * por código de carácter pondría todas las palabras acentuadas al final.
   */
  private comparar(a: Valor, b: Valor, pos: Posicion): number {
    if (esNumero(a) && esNumero(b)) return a.n - b.n;
    if (esCadena(a) && esCadena(b)) return a.s.localeCompare(b.s, "es");
    return this.fallar(
      pos,
      `no se puede ordenar ${nombreTipoDe(a)} con ${nombreTipoDe(b)}.`,
    );
  }

  private comoEntero(v: Valor, pos: Posicion): number {
    if (v.clase === "Entero") return v.n;
    if (v.clase === "Real" && Number.isInteger(v.n)) return v.n;
    this.fallar(pos, `se esperaba un Entero acá, y hay ${nombreTipoDe(v)}.`);
  }

  /** Ensancha un valor al tipo del destino, igual que `asignable` en el verificador. */
  private adaptar(v: Valor, destino: TipoSimple | null, pos: Posicion): Valor {
    if (destino === null) return v;
    if (destino === "Real" && v.clase === "Entero") return real(v.n);
    if (destino === "Texto" && v.clase === "Caracter") return texto(v.s);
    if (destino === "Caracter" && v.clase === "Texto") {
      if ([...v.s].length !== 1) {
        this.fallar(
          pos,
          `un Caracter guarda una sola letra, y "${v.s}" tiene ${[...v.s].length}.`,
        );
      }
      return { clase: "Caracter", s: v.s };
    }
    return v;
  }

  // ----------------------------------------------------------------
  // Llamadas
  // ----------------------------------------------------------------

  private *invocar(
    nombre: string,
    lexema: string,
    args: Expr[],
    pos: Posicion,
  ): Generator<Evento, Valor | undefined, string | undefined> {
    const sp = this.subprogramas.get(nombre);
    if (sp === undefined) {
      this.fallar(pos, `no existe ninguna función ni procedimiento llamado '${lexema}'.`);
    }

    if (this.profundidad >= this.limitePila) {
      this.fallar(
        pos,
        `demasiadas llamadas anidadas (${this.limitePila}).`,
        `Probablemente '${sp.lexema}' se llama a sí misma sin un caso base que la detenga.`,
      );
    }

    // Los argumentos se evalúan en el ámbito de quien llama.
    const enlaces = new Map<string, Celda>();
    /**
     * Celdas que hay que copiar de vuelta al terminar.
     *
     * Una variable pasada `Por Referencia` comparte su celda directamente, así
     * que no necesita nada. Una *posición de arreglo* no puede compartirla,
     * porque la celda vive dentro del arreglo: se copia al entrar y se escribe
     * al salir. El efecto visible es el mismo.
     */
    const escriturasDeVuelta: Array<{ celda: Celda; destino: Referencia }> = [];

    for (let i = 0; i < sp.parametros.length; i++) {
      const parametro = sp.parametros[i]!;
      const arg = args[i];
      if (arg === undefined) {
        this.fallar(pos, `faltan argumentos en la llamada a '${sp.lexema}'.`);
      }

      const tipo: TipoDecl = parametro.tipo ?? { clase: "TipoSimple", tipo: "Real" };

      if (parametro.porReferencia && arg.clase === "Variable") {
        const original = this.ambito.get(arg.nombre);
        if (original === undefined) {
          this.fallar(arg, `'${arg.lexema}' no está declarada.`);
        }
        enlaces.set(parametro.nombre, original);
        continue;
      }

      if (parametro.porReferencia && arg.clase === "Indice") {
        const destino = yield* this.referencia(arg);
        const celda: Celda = { valor: destino.leer(), tipo };
        enlaces.set(parametro.nombre, celda);
        escriturasDeVuelta.push({ celda, destino });
        continue;
      }

      // Por valor: copia profunda, así los arreglos no se comparten (§9.1).
      const valor = yield* this.expr(arg);
      enlaces.set(parametro.nombre, {
        valor: this.adaptar(
          copiar(valor),
          tipo.clase === "TipoSimple" ? tipo.tipo : null,
          arg,
        ),
        tipo,
      });
    }

    const ambitoPrevio = this.ambito;
    this.ambito = enlaces;

    // La variable de retorno nace sin valor: si la función no le asigna nada,
    // eso es un error, no un cero silencioso (§9).
    if (sp.clase === "Funcion") {
      this.ambito.set(sp.variableRetorno.nombre, { valor: undefined, tipo: { clase: "TipoSimple", tipo: "Real" } });
    }

    this.profundidad++;
    let retornado: Valor | undefined;

    try {
      yield* this.bloque(sp.cuerpo);
      if (sp.clase === "Funcion") {
        retornado = this.ambito.get(sp.variableRetorno.nombre)?.valor;
      }
    } catch (e) {
      if (!(e instanceof SenalRetorno)) throw e;
      retornado =
        e.valor ??
        (sp.clase === "Funcion"
          ? this.ambito.get(sp.variableRetorno.nombre)?.valor
          : undefined);
    } finally {
      this.profundidad--;
      this.ambito = ambitoPrevio;
    }

    for (const { celda, destino } of escriturasDeVuelta) {
      if (celda.valor !== undefined) destino.escribir(celda.valor);
    }

    if (sp.clase === "Funcion" && retornado === undefined) {
      this.fallar(
        pos,
        `'${sp.lexema}' terminó sin asignarle un valor a '${sp.variableRetorno.lexema}'.`,
        `Antes de 'FinFuncion' tiene que haber un '${sp.variableRetorno.lexema} <- ...'.`,
      );
    }

    return retornado;
  }

  // ----------------------------------------------------------------
  // Funciones integradas (§11)
  // ----------------------------------------------------------------

  private *integrada(
    e: Extract<Expr, { clase: "Llamada" }>,
  ): Generator<Evento, Valor | null, string | undefined> {
    const args: Valor[] = [];
    const necesitaArgs = TABLA_INTEGRADAS[e.nombre] !== undefined;
    if (!necesitaArgs) return null;

    for (const a of e.args) args.push(yield* this.expr(a));

    const num = (i: number): number => {
      const v = args[i];
      if (v === undefined || !esNumero(v)) {
        this.fallar(e, `'${e.lexema}' espera un número en el argumento ${i + 1}.`);
      }
      return v.n;
    };
    const cad = (i: number): string => {
      const v = args[i];
      if (v === undefined || !esCadena(v)) {
        this.fallar(e, `'${e.lexema}' espera un texto en el argumento ${i + 1}.`);
      }
      return v.s;
    };
    const ent = (i: number): number => {
      const v = args[i];
      if (v === undefined) this.fallar(e, `falta el argumento ${i + 1}.`);
      return this.comoEntero(v, e);
    };

    switch (e.nombre) {
      case "raiz": {
        const x = num(0);
        if (x < 0) {
          this.fallar(
            e,
            `no existe la raíz cuadrada de ${x}, que es un número negativo.`,
            "Comprobá el signo antes de llamar a 'Raiz'.",
          );
        }
        return real(Math.sqrt(x));
      }
      case "abs": {
        const v = args[0]!;
        return v.clase === "Entero" ? entero(Math.abs(v.n)) : real(Math.abs(num(0)));
      }
      case "trunc":
        return entero(Math.trunc(num(0)));
      case "redondear":
        return entero(Math.round(num(0)));
      case "techo":
        return entero(Math.ceil(num(0)));
      case "piso":
        return entero(Math.floor(num(0)));
      case "potencia":
        return real(Math.pow(num(0), num(1)));
      case "aleatorio": {
        const a = ent(0);
        const b = ent(1);
        if (a > b) {
          this.fallar(
            e,
            `'Aleatorio(${a}, ${b})' tiene el mínimo más grande que el máximo.`,
            `Escribe 'Aleatorio(${b}, ${a})'.`,
          );
        }
        return entero(a + Math.floor(Math.random() * (b - a + 1)));
      }
      case "sen":
        return real(Math.sin(num(0)));
      case "cos":
        return real(Math.cos(num(0)));
      case "tan":
        return real(Math.tan(num(0)));
      case "ln": {
        const x = num(0);
        if (x <= 0) {
          this.fallar(e, `el logaritmo natural solo existe para números mayores que 0, y acá es ${x}.`);
        }
        return real(Math.log(x));
      }
      case "exp":
        return real(Math.exp(num(0)));

      case "longitud": {
        const v = args[0]!;
        if (v.clase === "Arreglo") return entero(v.celdas.length);
        return entero([...cad(0)].length);
      }
      case "subcadena": {
        const s = [...cad(0)];
        const desde = ent(1);
        const hasta = ent(2);
        if (desde < 0 || desde >= s.length) {
          this.fallar(
            e,
            `la posición ${desde} está fuera del texto, que va de 0 a ${s.length - 1}.`,
          );
        }
        if (hasta < desde || hasta >= s.length) {
          this.fallar(
            e,
            `la posición final ${hasta} no es válida: tiene que estar entre ${desde} y ${s.length - 1}.`,
          );
        }
        return texto(s.slice(desde, hasta + 1).join(""));
      }
      case "mayusculas":
        return texto(cad(0).toLocaleUpperCase("es"));
      case "minusculas":
        return texto(cad(0).toLocaleLowerCase("es"));
      case "convertiranumero": {
        const s = cad(0).trim().replace(",", ".");
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) {
          this.fallar(
            e,
            `"${cad(0)}" no se puede convertir a número.`,
            "Solo se puede convertir un texto que contenga únicamente un número.",
          );
        }
        return real(Number(s));
      }
      case "convertiratexto":
        return texto(mostrar(args[0]!));
      case "concatenar":
        return texto(cad(0) + cad(1));

      default:
        return null;
    }
  }
}

/** Nombres de las integradas, para saber si una llamada es a una de ellas. */
const TABLA_INTEGRADAS: Record<string, true> = {
  raiz: true,
  abs: true,
  trunc: true,
  redondear: true,
  techo: true,
  piso: true,
  potencia: true,
  aleatorio: true,
  sen: true,
  cos: true,
  tan: true,
  ln: true,
  exp: true,
  longitud: true,
  subcadena: true,
  mayusculas: true,
  minusculas: true,
  convertiranumero: true,
  convertiratexto: true,
  concatenar: true,
};

/**
 * Ejecuta hasta el final juntando la salida, con la entrada dada por adelantado.
 * Es la forma cómoda de probar el intérprete y de usarlo desde la línea de
 * comandos; el editor usa el generador directamente.
 */
export function ejecutarConEntradas(
  programa: Programa,
  entradas: string[] = [],
  opciones: Opciones = {},
): { salida: string; resultado: Resultado; pedidos: number } {
  const gen = ejecutar(programa, opciones);
  let salida = "";
  let pedidos = 0;
  let siguiente: string | undefined;
  let paso = gen.next();

  while (!paso.done) {
    const evento = paso.value;
    if (evento.clase === "salida") {
      salida += evento.texto + (evento.sinSalto ? "" : "\n");
      siguiente = undefined;
    } else if (evento.clase === "entrada") {
      siguiente = entradas[pedidos];
      pedidos++;
    } else {
      siguiente = undefined;
    }
    paso = gen.next(siguiente);
  }

  return { salida, resultado: paso.value, pedidos };
}
