// src/token.ts
var PALABRAS_CLAVE = {
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
  mod: "MOD"
};
var CONTINUA_LINEA = /* @__PURE__ */ new Set([
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
  "MOD"
]);
function describir(t) {
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

// src/diagnostico.ts
function error(pos, longitud, mensaje, sugerencia) {
  return { ...pos, longitud, severidad: "error", mensaje, sugerencia };
}
function advertencia(pos, longitud, mensaje, sugerencia) {
  return { ...pos, longitud, severidad: "advertencia", mensaje, sugerencia };
}

// src/lexer.ts
var LETRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
var DIGITO = /[0-9]/;
var CONTINUACION_IDENT = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_]/;
function sinAcentos(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function tokenizar(fuente) {
  const tokens = [];
  const errores = [];
  let i = 0;
  let linea = 1;
  let columna = 1;
  let tokensEnLinea = 0;
  const fin = () => i >= fuente.length;
  const actual = () => fuente[i] ?? "";
  const siguiente = () => fuente[i + 1] ?? "";
  const pos = () => ({ linea, columna });
  function avanzar() {
    const c = fuente[i];
    i++;
    if (c === "\n") {
      linea++;
      columna = 1;
    } else {
      columna++;
    }
    return c;
  }
  function emitir(t) {
    tokens.push(t);
    tokensEnLinea++;
  }
  function ultimoToken() {
    return tokens[tokens.length - 1];
  }
  while (!fin()) {
    const inicio = pos();
    const c = actual();
    if (c === " " || c === "	" || c === "\r") {
      avanzar();
      continue;
    }
    if (c === "/" && siguiente() === "/") {
      while (!fin() && actual() !== "\n") avanzar();
      continue;
    }
    if (c === "\n") {
      avanzar();
      const ultimo = ultimoToken();
      const continua = ultimo !== void 0 && CONTINUA_LINEA.has(ultimo.tipo);
      if (tokensEnLinea > 0 && !continua) {
        tokens.push({ tipo: "FIN_LINEA", lexema: "\\n", ...inicio });
        tokensEnLinea = 0;
      }
      continue;
    }
    if (DIGITO.test(c)) {
      let lexema = "";
      while (!fin() && DIGITO.test(actual())) lexema += avanzar();
      let esEntero = true;
      if (actual() === ".") {
        if (!DIGITO.test(siguiente())) {
          const punto = pos();
          avanzar();
          errores.push(
            error(
              punto,
              1,
              `el número '${lexema}.' tiene un punto decimal sin dígitos después.`,
              `Escribe '${lexema}' o '${lexema}.0'.`
            )
          );
          emitir({
            tipo: "NUMERO",
            lexema,
            valor: Number(lexema),
            esEntero: true,
            ...inicio
          });
          continue;
        }
        esEntero = false;
        lexema += avanzar();
        while (!fin() && DIGITO.test(actual())) lexema += avanzar();
      }
      if (actual() === "e" || actual() === "E") {
        const desp = siguiente();
        const hayExponente = DIGITO.test(desp) || (desp === "+" || desp === "-") && DIGITO.test(fuente[i + 2] ?? "");
        if (hayExponente) {
          esEntero = false;
          lexema += avanzar();
          if (actual() === "+" || actual() === "-") lexema += avanzar();
          while (!fin() && DIGITO.test(actual())) lexema += avanzar();
        }
      }
      if (LETRA.test(actual())) {
        let cola = "";
        while (!fin() && CONTINUACION_IDENT.test(actual())) cola += avanzar();
        errores.push(
          error(
            inicio,
            lexema.length + cola.length,
            `'${lexema}${cola}' no es un número ni un nombre válido.`,
            "Un nombre de variable no puede empezar con un dígito."
          )
        );
        continue;
      }
      emitir({
        tipo: "NUMERO",
        lexema,
        valor: Number(lexema),
        esEntero,
        ...inicio
      });
      continue;
    }
    if (c === '"') {
      avanzar();
      let valor = "";
      let cerrado = false;
      while (!fin()) {
        const ch = actual();
        if (ch === "\n") break;
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
              'Las válidas son \\" para una comilla, \\\\ para una barra y \\n para un salto de línea.'
            )
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
            'Un texto tiene que abrir y cerrar con " en la misma línea.'
          )
        );
      }
      emitir({ tipo: "TEXTO", lexema: `"${valor}"`, valor, ...inicio });
      continue;
    }
    if (LETRA.test(c)) {
      let lexema = "";
      while (!fin() && CONTINUACION_IDENT.test(actual())) lexema += avanzar();
      const clave = sinAcentos(lexema).toLowerCase();
      const canonica = PALABRAS_CLAVE[clave];
      if (canonica !== void 0) {
        emitir({ tipo: canonica, lexema, ...inicio });
      } else {
        emitir({
          tipo: "IDENTIFICADOR",
          lexema,
          nombre: lexema.toLowerCase(),
          ...inicio
        });
      }
      continue;
    }
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
    const simples = {
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
      ":": ":"
    };
    const simple2 = simples[c];
    if (simple2 !== void 0) {
      avanzar();
      emitir({ tipo: simple2, lexema: c, ...inicio });
      continue;
    }
    avanzar();
    if (c === "≠") {
      errores.push(
        error(inicio, 1, "no reconozco el símbolo '≠'.", "Para 'distinto de' usa '<>'.")
      );
    } else if (c === "←") {
      errores.push(
        error(inicio, 1, "no reconozco el símbolo '←'.", "Para asignar usa '<-'.")
      );
    } else if (c === "“" || c === "”") {
      errores.push(
        error(
          inicio,
          1,
          `no reconozco el símbolo '${c}'.`,
          'Son comillas tipográficas. Usa comillas rectas: "'
        )
      );
    } else if (c === ";") {
      errores.push(
        error(
          inicio,
          1,
          "no reconozco el símbolo ';'.",
          "En este lenguaje las sentencias terminan con el salto de línea, no con punto y coma."
        )
      );
    } else if (c === "{" || c === "}") {
      errores.push(
        error(
          inicio,
          1,
          `no reconozco el símbolo '${c}'.`,
          "Los bloques se cierran con palabras como 'FinSi' o 'FinMientras'."
        )
      );
    } else {
      errores.push(error(inicio, 1, `no reconozco el símbolo '${c}'.`));
    }
  }
  if (tokensEnLinea > 0) {
    tokens.push({ tipo: "FIN_LINEA", lexema: "\\n", linea, columna });
  }
  tokens.push({ tipo: "EOF", lexema: "", linea, columna });
  errores.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
  return { tokens, errores };
}

// src/parser.ts
var ErrorSintactico = class extends Error {
};
var TIPOS_SIMPLES = /* @__PURE__ */ new Set([
  "Entero",
  "Real",
  "Texto",
  "Caracter",
  "Logico"
]);
var CIERRES = /* @__PURE__ */ new Set([
  "Fin",
  "FinSi",
  "FinMientras",
  "FinPara",
  "FinSegun",
  "FinFuncion",
  "FinProcedimiento"
]);
var RENOMBRES = {
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
  Con: "conjunto"
};
function parsear(tokens) {
  return new Parser(tokens).parsearPrograma();
}
var Parser = class {
  k = 0;
  errores = [];
  bloques = [];
  tokens;
  // Nota: Node ejecuta TypeScript borrando tipos, sin generar código, así que
  // no admite propiedades declaradas en los parámetros del constructor.
  constructor(tokens) {
    this.tokens = tokens;
  }
  // ------------------------------------------------------------------
  // Navegación
  // ------------------------------------------------------------------
  actual() {
    return this.tokens[this.k] ?? this.tokens[this.tokens.length - 1];
  }
  anterior() {
    return this.tokens[Math.max(0, this.k - 1)];
  }
  ver(...tipos) {
    return tipos.includes(this.actual().tipo);
  }
  enEOF() {
    return this.actual().tipo === "EOF";
  }
  avanzar() {
    const t = this.actual();
    if (!this.enEOF()) this.k++;
    return t;
  }
  aceptar(...tipos) {
    if (this.ver(...tipos)) return this.avanzar();
    return null;
  }
  pos() {
    const t = this.actual();
    return { linea: t.linea, columna: t.columna };
  }
  reportar(mensaje, sugerencia, token) {
    const t = token ?? this.actual();
    this.errores.push(
      error(
        { linea: t.linea, columna: t.columna },
        Math.max(1, t.lexema.length),
        mensaje,
        sugerencia
      )
    );
  }
  fallar(mensaje, sugerencia, token) {
    this.reportar(mensaje, sugerencia, token);
    throw new ErrorSintactico();
  }
  exigir(tipo, mensaje, sugerencia) {
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
  exigirBlando(tipo, mensaje, sugerencia) {
    if (this.aceptar(tipo) === null) this.reportar(mensaje, sugerencia);
  }
  /** Descarta saltos de línea. Se llama en los bordes de todo bloque. */
  saltarLineas() {
    while (this.aceptar("FIN_LINEA") !== null) {
    }
  }
  /** Exige el fin de la sentencia actual. */
  terminarSentencia() {
    if (this.enEOF()) return;
    if (this.aceptar("FIN_LINEA") !== null) return;
    if (this.ver("<-")) {
      this.fallar(
        "apareció una segunda asignación en la misma línea.",
        "Suele pasar cuando la línea anterior termina en un operador (+, -, *, Y, O) o en una coma: eso hace que continúe en la línea siguiente. Revisa el final de la línea de arriba."
      );
    }
    this.fallar(
      `no esperaba ${describir(this.actual())} acá.`,
      "Cada sentencia va en su propia línea."
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
  sincronizar() {
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
  exigirNombre(contexto) {
    const t = this.actual();
    if (t.tipo === "IDENTIFICADOR") {
      this.avanzar();
      return t;
    }
    const esPalabraClave = Object.values(PALABRAS_CLAVE).includes(
      t.tipo
    );
    if (esPalabraClave) {
      const sugerida = RENOMBRES[t.tipo];
      this.fallar(
        `'${t.lexema}' es una palabra reservada del lenguaje y no puede ser el nombre de ${contexto}.`,
        sugerida !== void 0 ? `Elige otro nombre, por ejemplo '${sugerida}'.` : "Elige otro nombre."
      );
    }
    this.fallar(`se esperaba el nombre de ${contexto}, pero encontré ${describir(t)}.`);
  }
  variableDesde(t) {
    return {
      clase: "Variable",
      nombre: t.nombre,
      lexema: t.lexema,
      linea: t.linea,
      columna: t.columna
    };
  }
  // ------------------------------------------------------------------
  // Bloques
  // ------------------------------------------------------------------
  abrirBloque(apertura, cierre) {
    this.bloques.push({ apertura, cierre });
  }
  /**
   * Cierra el bloque en el tope de la pila.
   *
   * Si aparece un cierre distinto del esperado, lo consume igual para poder
   * seguir analizando: el alumno escribió *algo* que cierra, solo se equivocó
   * de palabra.
   */
  cerrarBloque() {
    const bloque = this.bloques.pop();
    this.saltarLineas();
    if (this.aceptar(bloque.cierre) !== null) return;
    if (this.enEOF()) {
      this.reportar(
        `falta '${bloque.cierre}'. El '${bloque.apertura.lexema}' de la línea ${bloque.apertura.linea} quedó sin cerrar.`,
        `Agrega '${bloque.cierre}' al final del bloque.`
      );
      return;
    }
    if (CIERRES.has(this.actual().tipo) || this.ver("Hasta")) {
      const esDeUnBloqueExterno = this.bloques.some(
        (b) => b.cierre === this.actual().tipo
      );
      if (!esDeUnBloqueExterno) {
        const encontrado = this.avanzar();
        this.reportar(
          `encontré '${encontrado.lexema}' pero el bloque abierto es un '${bloque.apertura.lexema}' (línea ${bloque.apertura.linea}).`,
          `¿Querías escribir '${bloque.cierre}'?`,
          encontrado
        );
        return;
      }
    }
    this.reportar(
      `falta '${bloque.cierre}'. El '${bloque.apertura.lexema}' de la línea ${bloque.apertura.linea} quedó sin cerrar.`,
      `Agrega '${bloque.cierre}' antes de ${describir(this.actual())}.`
    );
  }
  /** Analiza sentencias hasta encontrar uno de los terminadores, o el EOF. */
  parsearBloque(...terminadores) {
    const cuerpo = [];
    this.saltarLineas();
    while (!this.enEOF() && !this.ver(...terminadores)) {
      if (CIERRES.has(this.actual().tipo)) break;
      const antes = this.k;
      const profundidad = this.bloques.length;
      try {
        cuerpo.push(this.parsearSentencia());
      } catch (e) {
        if (!(e instanceof ErrorSintactico)) throw e;
        this.bloques.length = profundidad;
        this.sincronizar();
      }
      if (this.k === antes) this.avanzar();
      this.saltarLineas();
    }
    return cuerpo;
  }
  // ------------------------------------------------------------------
  // Programa
  // ------------------------------------------------------------------
  parsearPrograma() {
    const subprogramas = [];
    let principal = [];
    let posInicio = null;
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
              void 0,
              inicio
            );
          }
          posInicio = { linea: inicio.linea, columna: inicio.columna };
          this.abrirBloque(inicio, "Fin");
          principal = this.parsearBloque("Fin");
          this.cerrarBloque();
        } else {
          this.fallar(
            `no esperaba ${describir(this.actual())} en el nivel principal del programa.`,
            "Fuera de 'Inicio ... Fin' solo pueden ir funciones y procedimientos."
          );
        }
      } catch (e) {
        if (!(e instanceof ErrorSintactico)) throw e;
        this.bloques.length = profundidad;
        this.sincronizar();
      }
      if (this.k === antes) this.avanzar();
      this.saltarLineas();
    }
    if (posInicio === null) {
      const ultimo = this.tokens[this.tokens.length - 1];
      this.reportar(
        "el programa no tiene bloque 'Inicio'.",
        "Todo programa empieza con 'Inicio' y termina con 'Fin'.",
        ultimo
      );
    }
    this.errores.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
    return {
      programa: { subprogramas, principal, posInicio },
      errores: this.errores
    };
  }
  // ------------------------------------------------------------------
  // Subprogramas
  // ------------------------------------------------------------------
  parsearSubprograma() {
    if (this.ver("Funcion")) {
      const apertura2 = this.avanzar();
      const retorno = this.exigirNombre("la variable de retorno");
      this.exigir(
        "<-",
        `se esperaba '<-' después de '${retorno.lexema}'.`,
        "Una función se declara así: Funcion resultado <- Nombre(parametros)"
      );
      const nombre3 = this.exigirNombre("la función");
      const parametros2 = this.parsearParametros();
      this.abrirBloque(apertura2, "FinFuncion");
      const cuerpo2 = this.parsearBloque("FinFuncion");
      this.cerrarBloque();
      return {
        clase: "Funcion",
        nombre: nombre3.nombre,
        lexema: nombre3.lexema,
        variableRetorno: {
          nombre: retorno.nombre,
          lexema: retorno.lexema,
          linea: retorno.linea,
          columna: retorno.columna
        },
        parametros: parametros2,
        cuerpo: cuerpo2,
        linea: apertura2.linea,
        columna: apertura2.columna
      };
    }
    const apertura = this.exigir("Procedimiento", "se esperaba 'Funcion' o 'Procedimiento'.");
    const nombre2 = this.exigirNombre("el procedimiento");
    const parametros = this.parsearParametros();
    this.abrirBloque(apertura, "FinProcedimiento");
    const cuerpo = this.parsearBloque("FinProcedimiento");
    this.cerrarBloque();
    return {
      clase: "Procedimiento",
      nombre: nombre2.nombre,
      lexema: nombre2.lexema,
      parametros,
      cuerpo,
      linea: apertura.linea,
      columna: apertura.columna
    };
  }
  parsearParametros() {
    this.exigir("(", "se esperaba '(' para la lista de parámetros.");
    const params = [];
    if (this.aceptar(")") !== null) return params;
    do {
      let porReferencia = false;
      if (this.aceptar("Por") !== null) {
        if (this.aceptar("Referencia") !== null) porReferencia = true;
        else if (this.aceptar("Valor") !== null) porReferencia = false;
        else
          this.fallar(
            "después de 'Por' se esperaba 'Referencia' o 'Valor'.",
            "Escribe 'Por Referencia' o 'Por Valor'."
          );
      }
      const nombre2 = this.exigirNombre("un parámetro");
      let tipo = null;
      if (this.aceptar("Como") !== null) tipo = this.parsearTipo();
      params.push({
        nombre: nombre2.nombre,
        lexema: nombre2.lexema,
        porReferencia,
        tipo,
        linea: nombre2.linea,
        columna: nombre2.columna
      });
    } while (this.aceptar(",") !== null);
    this.exigir(")", "se esperaba ')' o ',' en la lista de parámetros.");
    return params;
  }
  // ------------------------------------------------------------------
  // Tipos
  // ------------------------------------------------------------------
  parsearTipo() {
    if (this.aceptar("Arreglo") !== null) {
      this.exigir(
        "[",
        "se esperaba '[' con el tamaño del arreglo.",
        "Por ejemplo: Arreglo[30] De Real"
      );
      const dimensiones = [this.parsearExpr()];
      while (this.aceptar(",") !== null) dimensiones.push(this.parsearExpr());
      this.exigir("]", "se esperaba ']' después del tamaño del arreglo.");
      this.exigir(
        "De",
        "se esperaba 'De' seguido del tipo de los elementos.",
        "Por ejemplo: Arreglo[30] De Real"
      );
      return { clase: "TipoArreglo", base: this.parsearTipoSimple(), dimensiones };
    }
    return { clase: "TipoSimple", tipo: this.parsearTipoSimple() };
  }
  parsearTipoSimple() {
    const t = this.actual();
    if (TIPOS_SIMPLES.has(t.tipo)) {
      this.avanzar();
      return t.tipo;
    }
    this.fallar(
      `se esperaba un tipo, pero encontré ${describir(t)}.`,
      "Los tipos son Entero, Real, Texto, Caracter y Logico."
    );
  }
  // ------------------------------------------------------------------
  // Sentencias
  // ------------------------------------------------------------------
  parsearSentencia() {
    const sig = this.tokens[this.k + 1];
    if (this.actual().tipo !== "IDENTIFICADOR" && (sig?.tipo === "<-" || sig?.tipo === "[")) {
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
          "El bloque principal ya está abierto."
        );
      // falta el 'break' a propósito: fallar() nunca retorna
      default:
        this.fallar(
          `no esperaba ${describir(this.actual())} al comienzo de una sentencia.`
        );
    }
  }
  parsearDefinir() {
    const apertura = this.avanzar();
    const nombres = [];
    do {
      const n = this.exigirNombre("una variable");
      nombres.push({
        nombre: n.nombre,
        lexema: n.lexema,
        linea: n.linea,
        columna: n.columna
      });
    } while (this.aceptar(",") !== null);
    this.exigir(
      "Como",
      "se esperaba 'Como' seguido del tipo.",
      "Por ejemplo: Definir base Como Real"
    );
    const tipo = this.parsearTipo();
    this.terminarSentencia();
    return {
      clase: "Definir",
      nombres,
      tipo,
      linea: apertura.linea,
      columna: apertura.columna
    };
  }
  parsearLeer() {
    const apertura = this.avanzar();
    const destinos = [this.parsearDesignador()];
    while (this.aceptar(",") !== null) destinos.push(this.parsearDesignador());
    this.terminarSentencia();
    return {
      clase: "Leer",
      destinos,
      linea: apertura.linea,
      columna: apertura.columna
    };
  }
  parsearEscribir() {
    const apertura = this.avanzar();
    let sinSalto = false;
    if (this.aceptar("Sin") !== null) {
      this.exigir("Salto", "después de 'Sin' se esperaba 'Salto'.");
      sinSalto = true;
    }
    const partes = [this.parsearExpr()];
    while (this.aceptar(",") !== null) partes.push(this.parsearExpr());
    this.terminarSentencia();
    return {
      clase: "Escribir",
      partes,
      sinSalto,
      linea: apertura.linea,
      columna: apertura.columna
    };
  }
  parsearSi() {
    const apertura = this.avanzar();
    this.abrirBloque(apertura, "FinSi");
    const ramas = [];
    let sino = null;
    const condicion = this.parsearExpr();
    this.exigirBlando(
      "Entonces",
      "se esperaba 'Entonces' al final de la condición.",
      "Escribe: Si <condición> Entonces"
    );
    ramas.push({
      condicion,
      cuerpo: this.parsearBloque("SiNo", "FinSi"),
      pos: { linea: apertura.linea, columna: apertura.columna }
    });
    while (this.ver("SiNo")) {
      const sinoTok = this.avanzar();
      if (this.aceptar("Si") !== null) {
        const cond = this.parsearExpr();
        this.exigirBlando("Entonces", "se esperaba 'Entonces' al final de la condición.");
        ramas.push({
          condicion: cond,
          cuerpo: this.parsearBloque("SiNo", "FinSi"),
          pos: { linea: sinoTok.linea, columna: sinoTok.columna }
        });
      } else {
        sino = this.parsearBloque("FinSi", "SiNo");
        if (this.ver("SiNo")) {
          this.reportar(
            "este 'Si' ya tenía un 'SiNo'. Solo puede haber uno, y va al final."
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
      columna: apertura.columna
    };
  }
  parsearSegun() {
    const apertura = this.avanzar();
    this.abrirBloque(apertura, "FinSegun");
    const sujeto = this.parsearExpr();
    this.exigirBlando("Hacer", "se esperaba 'Hacer' después de la expresión de 'Segun'.");
    this.saltarLineas();
    const casos = [];
    let otroModo = null;
    while (!this.enEOF() && !this.ver("FinSegun") && !CIERRES.has(this.actual().tipo)) {
      if (this.ver("De")) {
        const deTok = this.avanzar();
        this.exigir("Otro", "se esperaba 'De Otro Modo:'.");
        this.exigir("Modo", "se esperaba 'De Otro Modo:'.");
        this.exigir(":", "se esperaba ':' después de 'De Otro Modo'.");
        otroModo = this.parsearBloque("FinSegun", "De");
        if (this.ver("De")) {
          this.reportar("solo puede haber un 'De Otro Modo', y va al final.", void 0, deTok);
        }
        break;
      }
      const pos = this.pos();
      const valores = [this.parsearLiteralDeCaso()];
      while (this.aceptar(",") !== null) valores.push(this.parsearLiteralDeCaso());
      this.exigir(":", "se esperaba ':' después de los valores del caso.");
      casos.push({
        valores,
        cuerpo: this.parsearBloque("FinSegun", "De", "NUMERO", "TEXTO", "-"),
        pos
      });
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
      columna: apertura.columna
    };
  }
  parsearLiteralDeCaso() {
    const negativo = this.aceptar("-");
    const t = this.actual();
    if (t.tipo === "NUMERO") {
      this.avanzar();
      return {
        clase: "LiteralNumero",
        valor: negativo !== null ? -t.valor : t.valor,
        esEntero: t.esEntero,
        linea: (negativo ?? t).linea,
        columna: (negativo ?? t).columna
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
        columna: t.columna
      };
    }
    this.fallar(
      `los casos de 'Segun' se comparan contra valores fijos, y ${describir(t)} no lo es.`,
      "Usa números o textos entre comillas, por ejemplo: 1, 2, 3:"
    );
  }
  parsearMientras() {
    const apertura = this.avanzar();
    this.abrirBloque(apertura, "FinMientras");
    const condicion = this.parsearExpr();
    this.exigirBlando(
      "Hacer",
      "se esperaba 'Hacer' al final de la condición.",
      "Escribe: Mientras <condición> Hacer"
    );
    const cuerpo = this.parsearBloque("FinMientras");
    this.cerrarBloque();
    return {
      clase: "Mientras",
      condicion,
      cuerpo,
      linea: apertura.linea,
      columna: apertura.columna
    };
  }
  parsearRepetir() {
    const apertura = this.avanzar();
    const cuerpo = this.parsearBloque("Hasta");
    this.saltarLineas();
    if (this.aceptar("Hasta") === null) {
      this.reportar(
        `falta 'Hasta Que'. El 'Repetir' de la línea ${apertura.linea} quedó sin cerrar.`,
        "Un 'Repetir' termina con 'Hasta Que <condición>'."
      );
      return {
        clase: "Repetir",
        cuerpo,
        condicion: {
          clase: "LiteralLogico",
          valor: true,
          linea: apertura.linea,
          columna: apertura.columna
        },
        linea: apertura.linea,
        columna: apertura.columna
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
      columna: apertura.columna
    };
  }
  parsearPara() {
    const apertura = this.avanzar();
    this.abrirBloque(apertura, "FinPara");
    if (this.aceptar("Cada") !== null) {
      const variable2 = this.variableDesde(this.exigirNombre("la variable de recorrido"));
      this.exigir(
        "En",
        "se esperaba 'En' seguido del nombre del arreglo.",
        "Escribe: Para Cada elemento En arreglo Hacer"
      );
      const arreglo = this.variableDesde(this.exigirNombre("el arreglo a recorrer"));
      this.exigirBlando("Hacer", "se esperaba 'Hacer' al final del encabezado.");
      const cuerpo2 = this.parsearBloque("FinPara");
      this.cerrarBloque();
      return {
        clase: "ParaCada",
        variable: variable2,
        arreglo,
        cuerpo: cuerpo2,
        linea: apertura.linea,
        columna: apertura.columna
      };
    }
    const variable = this.variableDesde(this.exigirNombre("la variable de control"));
    const igual = this.aceptar("=");
    if (igual !== null) {
      this.reportar(
        `escribiste 'Para ${variable.lexema} = ...'. El valor inicial se asigna con la flecha.`,
        `Escribe: Para ${variable.lexema} <- 0 Hasta 9 Hacer`,
        igual
      );
    } else {
      this.exigirBlando(
        "<-",
        `se esperaba '<-' después de '${variable.lexema}'.`,
        "Escribe: Para i <- 0 Hasta 9 Hacer"
      );
    }
    const desde = this.parsearExpr();
    this.exigir(
      "Hasta",
      "se esperaba 'Hasta' con el valor final.",
      "Escribe: Para i <- 0 Hasta 9 Hacer"
    );
    const hasta = this.parsearExpr();
    let paso = null;
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
      columna: apertura.columna
    };
  }
  parsearRetornar() {
    const apertura = this.avanzar();
    const valor = this.ver("FIN_LINEA", "EOF") ? null : this.parsearExpr();
    this.terminarSentencia();
    return {
      clase: "Retornar",
      valor,
      linea: apertura.linea,
      columna: apertura.columna
    };
  }
  parsearAsignacionOLlamada() {
    const nombre2 = this.exigirNombre("una variable");
    if (this.ver("(")) {
      this.avanzar();
      const args = [];
      if (this.aceptar(")") === null) {
        args.push(this.parsearExpr());
        while (this.aceptar(",") !== null) args.push(this.parsearExpr());
        this.exigir(")", "se esperaba ')' o ',' en la lista de argumentos.");
      }
      this.terminarSentencia();
      return {
        clase: "LlamarProcedimiento",
        nombre: nombre2.nombre,
        lexema: nombre2.lexema,
        args,
        linea: nombre2.linea,
        columna: nombre2.columna
      };
    }
    const destino = this.completarDesignador(nombre2);
    if (this.ver("=")) {
      const igual = this.actual();
      this.fallar(
        `escribiste '${destino.clase === "Indice" ? `${nombre2.lexema}[...]` : nombre2.lexema} = ...'. Para asignar un valor se usa la flecha.`,
        `Escribe '${nombre2.lexema} <- ...'. El '=' sirve para comparar, no para asignar.`,
        igual
      );
    }
    this.exigir(
      "<-",
      `se esperaba '<-' después de '${nombre2.lexema}'.`,
      "Para asignar un valor: variable <- expresión"
    );
    const valor = this.parsearExpr();
    this.terminarSentencia();
    return {
      clase: "Asignacion",
      destino,
      valor,
      linea: nombre2.linea,
      columna: nombre2.columna
    };
  }
  parsearDesignador() {
    return this.completarDesignador(this.exigirNombre("una variable"));
  }
  completarDesignador(nombre2) {
    const base = this.variableDesde(nombre2);
    if (this.aceptar("[") === null) return base;
    const indices = [this.parsearExpr()];
    while (this.aceptar(",") !== null) indices.push(this.parsearExpr());
    this.exigir("]", "se esperaba ']' después del índice.");
    return {
      clase: "Indice",
      base,
      indices,
      linea: nombre2.linea,
      columna: nombre2.columna
    };
  }
  // ------------------------------------------------------------------
  // Expresiones — un método por nivel de precedencia (especificación 10.1)
  // ------------------------------------------------------------------
  parsearExpr() {
    return this.parsearO();
  }
  binario(op, izq, der, tok) {
    return { clase: "Binario", op, izq, der, linea: tok.linea, columna: tok.columna };
  }
  parsearO() {
    let izq = this.parsearY();
    let t;
    while ((t = this.aceptar("O")) !== null) {
      izq = this.binario("O", izq, this.parsearY(), t);
    }
    return izq;
  }
  parsearY() {
    let izq = this.parsearNo();
    let t;
    while ((t = this.aceptar("Y")) !== null) {
      izq = this.binario("Y", izq, this.parsearNo(), t);
    }
    return izq;
  }
  parsearNo() {
    const t = this.aceptar("No");
    if (t !== null) {
      return {
        clase: "Unario",
        op: "No",
        operando: this.parsearNo(),
        linea: t.linea,
        columna: t.columna
      };
    }
    return this.parsearRelacional();
  }
  /** No asociativo: `a < b < c` no se puede escribir (especificación 10.1). */
  parsearRelacional() {
    const izq = this.parsearSuma();
    const t = this.aceptar("=", "<>", "<", ">", "<=", ">=");
    if (t === null) return izq;
    const der = this.parsearSuma();
    const resultado = this.binario(t.tipo, izq, der, t);
    const encadenado = this.actual();
    if (this.ver("=", "<>", "<", ">", "<=", ">=")) {
      this.reportar(
        "no se pueden encadenar comparaciones.",
        "Separa las dos comparaciones con 'Y'. Por ejemplo, en lugar de '1 < x < 10' escribe '1 < x Y x < 10'.",
        encadenado
      );
      this.avanzar();
      this.parsearSuma();
    }
    return resultado;
  }
  parsearSuma() {
    let izq = this.parsearMultiplicacion();
    let t;
    while ((t = this.aceptar("+", "-")) !== null) {
      izq = this.binario(t.tipo, izq, this.parsearMultiplicacion(), t);
    }
    return izq;
  }
  parsearMultiplicacion() {
    let izq = this.parsearUnario();
    let t;
    while ((t = this.aceptar("*", "/", "DIV", "MOD")) !== null) {
      izq = this.binario(t.tipo, izq, this.parsearUnario(), t);
    }
    return izq;
  }
  parsearUnario() {
    const t = this.aceptar("-");
    if (t !== null) {
      return {
        clase: "Unario",
        op: "-",
        operando: this.parsearUnario(),
        linea: t.linea,
        columna: t.columna
      };
    }
    return this.parsearPotencia();
  }
  /** Asociativo a la derecha, y admite exponente negativo: `2 ^ -1`. */
  parsearPotencia() {
    const base = this.parsearPrimaria();
    const t = this.aceptar("^");
    if (t === null) return base;
    return this.binario("^", base, this.parsearUnario(), t);
  }
  parsearPrimaria() {
    const t = this.actual();
    switch (t.tipo) {
      case "NUMERO":
        this.avanzar();
        return {
          clase: "LiteralNumero",
          valor: t.valor,
          esEntero: t.esEntero,
          linea: t.linea,
          columna: t.columna
        };
      case "TEXTO":
        this.avanzar();
        return {
          clase: "LiteralTexto",
          valor: t.valor,
          linea: t.linea,
          columna: t.columna
        };
      case "Verdadero":
      case "Falso":
        this.avanzar();
        return {
          clase: "LiteralLogico",
          valor: t.tipo === "Verdadero",
          linea: t.linea,
          columna: t.columna
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
          const args = [];
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
            columna: t.columna
          };
        }
        return this.completarDesignador(t);
      }
      case "<-":
        this.fallar(
          "'<-' no puede ir acá.",
          "La flecha asigna un valor a una variable; no se usa dentro de una expresión."
        );
      case "FIN_LINEA":
      case "EOF":
        this.fallar(
          "la expresión quedó incompleta.",
          `Falta el valor después de '${this.anterior().lexema}'.`
        );
      default:
        if (CIERRES.has(t.tipo) || this.ver("Hasta", "SiNo", "Entonces", "Hacer")) {
          this.fallar(
            "la expresión quedó incompleta.",
            `Falta el valor después de '${this.anterior().lexema}'.`
          );
        }
        this.fallar(`no esperaba ${describir(t)} dentro de una expresión.`);
    }
  }
};

// src/tipos.ts
var ENTERO = { clase: "Entero" };
var REAL = { clase: "Real" };
var TEXTO = { clase: "Texto" };
var CARACTER = { clase: "Caracter" };
var LOGICO = { clase: "Logico" };
var INDEFINIDO = { clase: "Indefinido" };
function simple(t) {
  return { clase: t };
}
function nombre(t) {
  if (t.clase === "Arreglo") {
    const dims = t.dimensiones.join(", ");
    return `Arreglo[${dims}] De ${t.base}`;
  }
  if (t.clase === "Indefinido") return "desconocido";
  return t.clase;
}
function art(t) {
  if (t.clase === "Indefinido") return "un valor de tipo desconocido";
  return `un ${nombre(t)}`;
}
function esIndefinido(t) {
  return t.clase === "Indefinido";
}
function esNumerico(t) {
  return t.clase === "Entero" || t.clase === "Real";
}
function esTextual(t) {
  return t.clase === "Texto" || t.clase === "Caracter";
}
function esArreglo(t) {
  return t.clase === "Arreglo";
}
function iguales(a, b) {
  if (a.clase === "Arreglo" && b.clase === "Arreglo") {
    return a.base === b.base && a.dimensiones.length === b.dimensiones.length && a.dimensiones.every((d, i) => d === b.dimensiones[i]);
  }
  return a.clase === b.clase;
}
function asignable(destino, origen) {
  if (esIndefinido(destino) || esIndefinido(origen)) return true;
  if (iguales(destino, origen)) return true;
  if (destino.clase === "Real" && origen.clase === "Entero") return true;
  if (destino.clase === "Texto" && origen.clase === "Caracter") return true;
  return false;
}
function comoConvertir(destino, origen) {
  if (destino.clase === "Entero" && origen.clase === "Real") {
    return "Para convertir un Real en Entero usa 'Trunc' o 'Redondear'.";
  }
  if (esNumerico(destino) && esTextual(origen)) {
    return "Para convertir un Texto en número usa 'ConvertirANumero'.";
  }
  if (esTextual(destino) && esNumerico(origen)) {
    return "Para convertir un número en Texto usa 'ConvertirATexto'.";
  }
  if (destino.clase === "Caracter" && origen.clase === "Texto") {
    return "Un Caracter guarda una sola letra. Usa 'Subcadena' para tomar una.";
  }
  return void 0;
}
function combinarNumericos(a, b) {
  if (a.clase === "Real" || b.clase === "Real") return REAL;
  return ENTERO;
}

// src/integradas.ts
function f(params, retorno) {
  return { params, retorno };
}
var INTEGRADAS = {
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
    aceptaArreglo: true
  },
  subcadena: {
    lexema: "Subcadena",
    firmas: [f(["textual", "Entero", "Entero"], "Texto")]
  },
  mayusculas: { lexema: "Mayusculas", firmas: [f(["textual"], "Texto")] },
  minusculas: { lexema: "Minusculas", firmas: [f(["textual"], "Texto")] },
  convertiranumero: {
    lexema: "ConvertirANumero",
    firmas: [f(["textual"], "Real")]
  },
  convertiratexto: { lexema: "ConvertirATexto", firmas: [f(["numero"], "Texto")] },
  concatenar: { lexema: "Concatenar", firmas: [f(["textual", "textual"], "Texto")] }
};
var CONSTANTES = {
  pi: { lexema: "PI", tipo: REAL }
};
var TIPO_DE_FAMILIA = {
  Entero: ENTERO,
  Real: REAL,
  Texto: TEXTO,
  Caracter: CARACTER,
  Logico: LOGICO
};
function coincideFamilia(familia, t) {
  if (t.clase === "Indefinido") return true;
  switch (familia) {
    case "numero":
      return t.clase === "Entero" || t.clase === "Real";
    case "textual":
      return t.clase === "Texto" || t.clase === "Caracter";
    case "Real":
      return t.clase === "Real" || t.clase === "Entero";
    case "Texto":
      return t.clase === "Texto" || t.clase === "Caracter";
    default:
      return t.clase === familia;
  }
}
function describirFamilia(familia) {
  if (familia === "numero") return "un número";
  if (familia === "textual") return "un Texto";
  return `un ${familia}`;
}
function tipoDeFamilia(familia) {
  return TIPO_DE_FAMILIA[familia] ?? REAL;
}

// src/verificador.ts
function verificar(programa) {
  return new Verificador(programa).ejecutar();
}
var Verificador = class {
  diagnosticos = [];
  subprogramas = /* @__PURE__ */ new Map();
  programa;
  /** Ámbito actual. No hay ámbitos anidados: uno por subprograma (§9.2). */
  ambito = /* @__PURE__ */ new Map();
  /** Función que se está verificando, para validar `Retornar`. */
  funcionActual = null;
  /** Variables de control de los `Para` que están abiertos ahora mismo. */
  controlesAbiertos = [];
  constructor(programa) {
    this.programa = programa;
  }
  // ------------------------------------------------------------------
  err(pos, longitud, mensaje, sugerencia) {
    this.diagnosticos.push(error(pos, longitud, mensaje, sugerencia));
  }
  avisar(pos, longitud, mensaje, sugerencia) {
    this.diagnosticos.push(advertencia(pos, longitud, mensaje, sugerencia));
  }
  ejecutar() {
    this.recolectarSubprogramas();
    for (const sp of this.programa.subprogramas) this.verificarSubprograma(sp);
    this.ambito = /* @__PURE__ */ new Map();
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
  recolectarSubprogramas() {
    for (const sp of this.programa.subprogramas) {
      const previo = this.subprogramas.get(sp.nombre);
      if (previo !== void 0) {
        this.err(
          sp,
          sp.lexema.length,
          `ya existe un subprograma llamado '${sp.lexema}' (línea ${previo.pos.linea}).`,
          "Cada función y procedimiento necesita un nombre distinto."
        );
        continue;
      }
      if (INTEGRADAS[sp.nombre] !== void 0 || CONSTANTES[sp.nombre] !== void 0) {
        this.err(
          sp,
          sp.lexema.length,
          `'${sp.lexema}' es el nombre de una función integrada del lenguaje.`,
          "Elige otro nombre para no ocultarla."
        );
        continue;
      }
      let tipoRetorno = INDEFINIDO;
      if (sp.clase === "Funcion") {
        const decl = this.buscarDeclaracion(sp.cuerpo, sp.variableRetorno.nombre);
        tipoRetorno = decl ?? INDEFINIDO;
      }
      this.subprogramas.set(sp.nombre, {
        clase: sp.clase,
        lexema: sp.lexema,
        parametros: sp.parametros,
        tipoRetorno,
        pos: { linea: sp.linea, columna: sp.columna }
      });
    }
  }
  /** Busca el `Definir` de un nombre dentro de un cuerpo, sin entrar en bloques. */
  buscarDeclaracion(cuerpo, objetivo) {
    for (const s of cuerpo) {
      if (s.clase !== "Definir") continue;
      if (s.nombres.some((n) => n.nombre === objetivo)) return this.resolverTipo(s.tipo);
    }
    return null;
  }
  // ------------------------------------------------------------------
  // Subprogramas
  // ------------------------------------------------------------------
  verificarSubprograma(sp) {
    this.ambito = /* @__PURE__ */ new Map();
    this.controlesAbiertos = [];
    this.funcionActual = sp.clase === "Funcion" ? sp : null;
    for (const p of sp.parametros) {
      if (p.tipo === null) {
        this.err(
          p,
          p.lexema.length,
          `el parámetro '${p.lexema}' no tiene tipo.`,
          `Escribe '${p.lexema} Como Real' (o el tipo que corresponda).`
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
        escrita: true
      });
    }
    if (sp.clase === "Funcion") {
      const ret = sp.variableRetorno;
      if (!this.ambito.has(ret.nombre) && this.buscarDeclaracion(sp.cuerpo, ret.nombre) === null) {
        this.err(
          ret,
          ret.lexema.length,
          `falta declarar la variable de retorno '${ret.lexema}'.`,
          `Agrega 'Definir ${ret.lexema} Como Real' (o el tipo que devuelva la función) dentro de la función.`
        );
      }
    }
    this.bloque(sp.cuerpo);
    if (sp.clase === "Funcion") {
      const simbolo = this.ambito.get(sp.variableRetorno.nombre);
      if (simbolo !== void 0) simbolo.leida = true;
      if (simbolo !== void 0 && !simbolo.escrita) {
        this.err(
          sp.variableRetorno,
          sp.variableRetorno.lexema.length,
          `la función '${sp.lexema}' nunca le asigna un valor a '${sp.variableRetorno.lexema}'.`,
          `Antes de 'FinFuncion' tiene que haber un '${sp.variableRetorno.lexema} <- ...'.`
        );
      }
    }
    this.revisarSinUsar();
  }
  declarar(s) {
    const previo = this.ambito.get(s.nombre);
    if (previo !== void 0) {
      this.err(
        s.pos,
        s.lexema.length,
        `'${s.lexema}' ya fue declarada como ${nombre(previo.tipo)} en la línea ${previo.pos.linea}.`,
        "Cada variable se declara una sola vez."
      );
      return;
    }
    if (INTEGRADAS[s.nombre] !== void 0) {
      this.err(
        s.pos,
        s.lexema.length,
        `'${s.lexema}' es el nombre de una función integrada del lenguaje.`,
        "Elige otro nombre para la variable."
      );
    }
    this.ambito.set(s.nombre, s);
  }
  revisarSinUsar() {
    for (const s of this.ambito.values()) {
      if (s.esParametro || s.leida) continue;
      this.avisar(
        s.pos,
        s.lexema.length,
        `declaraste '${s.lexema}' pero nunca la usas.`,
        s.escrita ? "Le asignas un valor pero después no la leés. ¿Sobra?" : "Si no la necesitas, puedes borrar la declaración."
      );
    }
  }
  /** Advierte si el programa usa `area` y `área` a la vez (especificación 2.2). */
  revisarAcentosAmbiguos() {
    const sinAcentos2 = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const porBase = /* @__PURE__ */ new Map();
    for (const s of this.ambito.values()) {
      const base = sinAcentos2(s.nombre);
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
          "Los acentos cuentan en los nombres de variable. Es fácil confundirlas."
        );
      }
    }
  }
  resolverTipo(t) {
    if (t.clase === "TipoSimple") return simple(t.tipo);
    const dimensiones = t.dimensiones.map((d) => {
      const constante = this.evaluarConstanteEntera(d);
      if (constante === null) {
        this.err(
          d,
          1,
          "el tamaño de un arreglo tiene que ser un número fijo.",
          "No puede depender de una variable: se necesita saberlo antes de ejecutar."
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
  evaluarConstanteEntera(e) {
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
  bloque(cuerpo) {
    for (const s of cuerpo) this.sentencia(s);
  }
  sentencia(s) {
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
            escrita: false
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
              "Usa un 'Para' y leé cada posición: Leer notas[i]"
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
              "Recorré el arreglo con 'Para Cada' y escribí cada elemento."
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
  encaja(destino, origen, expresion) {
    if (asignable(destino, origen)) return true;
    return destino.clase === "Caracter" && expresion.clase === "LiteralTexto" && [...expresion.valor].length === 1;
  }
  /** Mensaje extra cuando un literal de texto no cabe en un `Caracter`. */
  porqueNoEncaja(destino, expresion) {
    if (destino.clase !== "Caracter" || expresion.clase !== "LiteralTexto") return void 0;
    const largo = [...expresion.valor].length;
    return largo === 0 ? "Un Caracter guarda exactamente una letra, y este texto está vacío." : `Un Caracter guarda una sola letra, y "${expresion.valor}" tiene ${largo}.`;
  }
  verificarAsignacion(destino, valor) {
    const tipoDestino = this.tipoDeDesignador(destino, { escritura: true });
    const tipoValor = this.expr(valor);
    if (esArreglo(tipoDestino) && !esArreglo(tipoValor)) {
      this.err(
        destino,
        1,
        `'${destino.clase === "Variable" ? destino.lexema : destino.base.lexema}' es un arreglo completo y no puede recibir un solo valor.`,
        "Indica la posición: notas[0] <- 8.5"
      );
      return;
    }
    if (!this.encaja(tipoDestino, tipoValor, valor)) {
      const nombreDestino = destino.clase === "Variable" ? destino.lexema : `${destino.base.lexema}[...]`;
      this.err(
        valor,
        1,
        `'${nombreDestino}' es ${art(tipoDestino)} y no puede recibir ${art(tipoValor)}.`,
        this.porqueNoEncaja(tipoDestino, valor) ?? comoConvertir(tipoDestino, tipoValor)
      );
    }
    if (destino.clase === "Variable" && this.controlesAbiertos.includes(destino.nombre)) {
      this.avisar(
        destino,
        destino.lexema.length,
        `'${destino.lexema}' es la variable que controla el bucle.`,
        "Modificarla acá cambia cuántas veces se repite. Suele ser un error."
      );
    }
  }
  verificarSegun(s) {
    const tipoSujeto = this.expr(s.sujeto);
    const admitido = esIndefinido(tipoSujeto) || tipoSujeto.clase === "Entero" || esTextual(tipoSujeto);
    if (!admitido) {
      this.err(
        s.sujeto,
        1,
        `'Segun' compara contra valores fijos, y ${art(tipoSujeto)} no sirve para eso.`,
        "Solo puede ser Entero, Caracter o Texto. Para comparar reales o lógicos usa 'Si'."
      );
    }
    const vistos = /* @__PURE__ */ new Map();
    for (const caso of s.casos) {
      for (const v of caso.valores) {
        const tipoValor = this.expr(v);
        if (admitido && !esIndefinido(tipoSujeto) && !this.encaja(tipoSujeto, tipoValor, v)) {
          this.err(
            v,
            1,
            `este caso es ${art(tipoValor)} pero se compara contra ${art(tipoSujeto)}.`,
            "Todos los casos tienen que ser del mismo tipo que la expresión del 'Segun'."
          );
        }
        const clave = v.clase === "LiteralNumero" ? `n:${v.valor}` : `t:${v.valor}`;
        const previo = vistos.get(clave);
        if (previo !== void 0) {
          const texto = v.clase === "LiteralNumero" ? String(v.valor) : `"${v.valor}"`;
          this.err(
            v,
            1,
            `el caso ${texto} ya apareció en la línea ${previo.linea}.`,
            "Un mismo valor no puede estar en dos casos: el segundo nunca se ejecutaría."
          );
        } else {
          vistos.set(clave, { linea: v.linea, columna: v.columna });
        }
      }
      this.bloque(caso.cuerpo);
    }
    if (s.otroModo !== null) this.bloque(s.otroModo);
  }
  verificarPara(s) {
    const tipoVar = this.tipoDeDesignador(s.variable, { escritura: true });
    if (!esIndefinido(tipoVar) && tipoVar.clase !== "Entero") {
      this.err(
        s.variable,
        s.variable.lexema.length,
        `la variable de un 'Para' tiene que ser Entero, y '${s.variable.lexema}' es ${art(tipoVar)}.`,
        esNumerico(tipoVar) ? "Contar con decimales acumula errores de redondeo y el bucle puede no terminar. Usa un 'Mientras' si de verdad necesitas pasos decimales." : `Declara '${s.variable.lexema}' Como Entero.`
      );
    }
    for (const [expresion, cual] of [
      [s.desde, "el valor inicial"],
      [s.hasta, "el valor final"]
    ]) {
      const t = this.expr(expresion);
      if (!esIndefinido(t) && t.clase !== "Entero") {
        this.err(
          expresion,
          1,
          `${cual} de un 'Para' tiene que ser Entero, y es ${art(t)}.`,
          esNumerico(t) ? "Usa 'Trunc' o 'Redondear' si viene de un cálculo con decimales." : void 0
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
          "Con paso 0 la variable nunca cambia y el bucle no termina nunca."
        );
      }
    }
    const simbolo = this.ambito.get(s.variable.nombre);
    if (simbolo !== void 0) simbolo.leida = true;
    this.controlesAbiertos.push(s.variable.nombre);
    this.bloque(s.cuerpo);
    this.controlesAbiertos.pop();
  }
  verificarParaCada(s) {
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
        `'Para Cada' recorre arreglos, y '${s.arreglo.lexema}' es ${art(tipoArreglo)}.`
      );
      this.bloque(s.cuerpo);
      return;
    }
    if (tipoArreglo.dimensiones.length > 1) {
      this.err(
        s.arreglo,
        s.arreglo.lexema.length,
        `'Para Cada' solo recorre arreglos de una dimensión, y '${s.arreglo.lexema}' tiene ${tipoArreglo.dimensiones.length}.`,
        "Usa 'Para' anidados con índices."
      );
    }
    const base = simple(tipoArreglo.base);
    if (!esIndefinido(tipoVar) && !asignable(tipoVar, base)) {
      this.err(
        s.variable,
        s.variable.lexema.length,
        `'${s.variable.lexema}' es ${art(tipoVar)} pero '${s.arreglo.lexema}' contiene ${art(base)}.`,
        `Declara '${s.variable.lexema}' Como ${tipoArreglo.base}.`
      );
    }
    this.controlesAbiertos.push(s.variable.nombre);
    this.bloque(s.cuerpo);
    this.controlesAbiertos.pop();
  }
  verificarRetornar(s) {
    if (this.funcionActual === null) {
      if (s.valor !== null) {
        const t2 = this.expr(s.valor);
        void t2;
        this.err(
          s,
          8,
          "un procedimiento no devuelve valores, así que 'Retornar' va solo.",
          "Escribe 'Retornar' sin nada después."
        );
      }
      return;
    }
    const esperado = this.subprogramas.get(this.funcionActual.nombre)?.tipoRetorno ?? INDEFINIDO;
    if (s.valor === null) {
      this.err(
        s,
        8,
        `'${this.funcionActual.lexema}' es una función y tiene que devolver un valor.`,
        `Escribe 'Retornar <valor>', o asigna a '${this.funcionActual.variableRetorno.lexema}' y dejá que la función termine sola.`
      );
      return;
    }
    const t = this.expr(s.valor);
    if (!this.encaja(esperado, t, s.valor)) {
      this.err(
        s.valor,
        1,
        `'${this.funcionActual.lexema}' devuelve ${art(esperado)}, pero acá se retorna ${art(t)}.`,
        comoConvertir(esperado, t)
      );
    }
    const simbolo = this.ambito.get(this.funcionActual.variableRetorno.nombre);
    if (simbolo !== void 0) simbolo.escrita = true;
  }
  // ------------------------------------------------------------------
  // Expresiones
  // ------------------------------------------------------------------
  exigirLogico(e, contexto) {
    const t = this.expr(e);
    if (esIndefinido(t) || t.clase === "Logico") return;
    let sugerencia;
    if (esNumerico(t)) {
      const texto = e.clase === "Variable" ? e.lexema : "la expresión";
      sugerencia = `Un número no es Verdadero ni Falso. ¿Quisiste comparar? Por ejemplo '${texto} <> 0'.`;
    } else if (esTextual(t)) {
      sugerencia = `Un Texto no es Verdadero ni Falso. ¿Quisiste comparar? Por ejemplo '... <> ""'.`;
    }
    this.err(
      e,
      1,
      `${contexto} tiene que ser Verdadero o Falso, y acá es ${art(t)}.`,
      sugerencia
    );
  }
  tipoDeDesignador(d, opciones) {
    const variable = d.clase === "Variable" ? d : d.base;
    const simbolo = this.ambito.get(variable.nombre);
    if (simbolo === void 0) {
      this.reportarNoDeclarada(variable);
      return INDEFINIDO;
    }
    if (opciones.escritura) simbolo.escrita = true;
    else simbolo.leida = true;
    if (d.clase === "Variable") return simbolo.tipo;
    const tipoBase = simbolo.tipo;
    for (const indice of d.indices) {
      const t = this.expr(indice);
      if (!esIndefinido(t) && t.clase !== "Entero") {
        this.err(
          indice,
          1,
          `el índice de un arreglo tiene que ser Entero, y acá es ${art(t)}.`,
          esNumerico(t) ? "Usa 'Trunc' o 'Redondear' si viene de un cálculo con decimales." : void 0
        );
      }
    }
    if (esIndefinido(tipoBase)) return INDEFINIDO;
    if (!esArreglo(tipoBase)) {
      this.err(
        d,
        variable.lexema.length,
        `'${variable.lexema}' es ${art(tipoBase)}, no un arreglo, así que no se puede indexar.`,
        "Los corchetes solo se usan con arreglos."
      );
      return INDEFINIDO;
    }
    if (d.indices.length !== tipoBase.dimensiones.length) {
      const esperados = tipoBase.dimensiones.length;
      this.err(
        d,
        variable.lexema.length,
        `'${variable.lexema}' tiene ${esperados} ${esperados === 1 ? "dimensión" : "dimensiones"} y acá se usan ${d.indices.length} ${d.indices.length === 1 ? "índice" : "índices"}.`,
        esperados === 1 ? `Escribe '${variable.lexema}[i]'.` : `Escribe '${variable.lexema}[${Array.from({ length: esperados }, (_, i) => `i${i + 1}`).join(", ")}]'.`
      );
      return INDEFINIDO;
    }
    return simple(tipoBase.base);
  }
  reportarNoDeclarada(v) {
    const parecida = this.nombreParecido(v.nombre);
    this.err(
      v,
      v.lexema.length,
      `'${v.lexema}' no está declarada.`,
      parecida !== void 0 ? `¿Quisiste escribir '${parecida}'?` : `Agrega 'Definir ${v.lexema} Como Real' (o el tipo que corresponda) antes de usarla.`
    );
  }
  /** Busca un nombre en ámbito a distancia de edición 1 o 2, para sugerirlo. */
  nombreParecido(objetivo) {
    let mejor;
    for (const s of this.ambito.values()) {
      const d = distancia(objetivo, s.nombre);
      const umbral = objetivo.length <= 4 ? 1 : 2;
      if (d <= umbral && (mejor === void 0 || d < mejor.distancia)) {
        mejor = { lexema: s.lexema, distancia: d };
      }
    }
    return mejor?.lexema;
  }
  expr(e) {
    switch (e.clase) {
      case "LiteralNumero":
        return e.esEntero ? ENTERO : REAL;
      case "LiteralTexto":
        return TEXTO;
      case "LiteralLogico":
        return LOGICO;
      case "Variable": {
        const constante = CONSTANTES[e.nombre];
        if (constante !== void 0 && !this.ambito.has(e.nombre)) return constante.tipo;
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
  verificarUnario(e) {
    const t = this.expr(e.operando);
    if (esIndefinido(t)) return INDEFINIDO;
    if (e.op === "No") {
      if (t.clase !== "Logico") {
        this.err(
          e,
          2,
          `'No' se aplica a Verdadero o Falso, y acá se aplica a ${art(t)}.`
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
  verificarBinario(e) {
    const a = this.expr(e.izq);
    const b = this.expr(e.der);
    const desconocido = esIndefinido(a) || esIndefinido(b);
    const fallar = (mensaje, sugerencia) => {
      if (!desconocido) this.err(e, e.op.length, mensaje, sugerencia);
    };
    switch (e.op) {
      case "+": {
        if (esNumerico(a) && esNumerico(b)) return combinarNumericos(a, b);
        if (esTextual(a) && esTextual(b)) return TEXTO;
        if (desconocido) return INDEFINIDO;
        fallar(
          `no se puede sumar ${art(a)} y ${art(b)}.`,
          esTextual(a) || esTextual(b) ? `Para pegar un texto con un número, usa una coma en 'Escribir': Escribir "Total: ", 5` : void 0
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
          esNumerico(culpable) ? `Para dividir con decimales usa '/'. Para convertir a entero, 'Trunc' o 'Redondear'.` : void 0
        );
        return ENTERO;
      }
      case "=":
      case "<>": {
        if (desconocido) return LOGICO;
        const compatibles = esNumerico(a) && esNumerico(b) || esTextual(a) && esTextual(b) || a.clase === "Logico" && b.clase === "Logico";
        if (!compatibles) {
          fallar(
            `no se puede comparar ${art(a)} con ${art(b)}.`,
            "Solo se comparan valores del mismo tipo."
          );
        }
        if (esArreglo(a) || esArreglo(b)) {
          fallar(
            "no se pueden comparar arreglos completos.",
            "Compara posición por posición dentro de un bucle."
          );
        }
        return LOGICO;
      }
      case "<":
      case ">":
      case "<=":
      case ">=": {
        if (desconocido) return LOGICO;
        const ordenable = esNumerico(a) && esNumerico(b) || esTextual(a) && esTextual(b);
        if (!ordenable) {
          fallar(
            `no se puede usar '${e.op}' entre ${art(a)} y ${art(b)}.`,
            a.clase === "Logico" || b.clase === "Logico" ? "Verdadero y Falso no se ordenan. Usa '=' o '<>'." : "Solo se ordenan números entre sí, o textos entre sí."
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
            esNumerico(culpable) ? "¿Faltó una comparación? Por ejemplo '... > 0'." : void 0
          );
        }
        return LOGICO;
      }
    }
  }
  // ------------------------------------------------------------------
  // Llamadas
  // ------------------------------------------------------------------
  verificarLlamada(nombreLlamada, lexema, args, pos, uso) {
    const integrada = INTEGRADAS[nombreLlamada];
    if (integrada !== void 0) {
      if (uso === "sentencia") {
        this.err(
          pos,
          lexema.length,
          `'${integrada.lexema}' devuelve un valor, así que no puede usarse como una instrucción suelta.`,
          `Usa el resultado: por ejemplo 'x <- ${integrada.lexema}(...)'.`
        );
      }
      return this.verificarIntegrada(nombreLlamada, lexema, args, pos);
    }
    const sp = this.subprogramas.get(nombreLlamada);
    if (sp === void 0) {
      const parecida = this.subprogramaParecido(nombreLlamada);
      this.err(
        pos,
        lexema.length,
        `no existe ninguna función ni procedimiento llamado '${lexema}'.`,
        parecida !== void 0 ? `¿Quisiste escribir '${parecida}'?` : void 0
      );
      for (const a of args) this.expr(a);
      return INDEFINIDO;
    }
    if (uso === "expresion" && sp.clase === "Procedimiento") {
      this.err(
        pos,
        lexema.length,
        `'${sp.lexema}' es un procedimiento y no devuelve ningún valor, así que no puede usarse dentro de una expresión.`,
        "Si tiene que devolver algo, conviértelo en 'Funcion'."
      );
    }
    if (uso === "sentencia" && sp.clase === "Funcion") {
      this.err(
        pos,
        lexema.length,
        `'${sp.lexema}' es una función: devuelve un valor que acá se descarta.`,
        `Usa el resultado: por ejemplo 'x <- ${sp.lexema}(...)'.`
      );
    }
    this.verificarArgumentos(sp, lexema, args, pos);
    return sp.tipoRetorno;
  }
  verificarArgumentos(sp, lexema, args, pos) {
    if (args.length !== sp.parametros.length) {
      const esperados = sp.parametros.length;
      this.err(
        pos,
        lexema.length,
        `'${sp.lexema}' espera ${esperados} ${esperados === 1 ? "argumento" : "argumentos"} y recibió ${args.length}.`,
        esperados === 0 ? void 0 : `Los parámetros son: ${sp.parametros.map((p) => p.lexema).join(", ")}.`
      );
      for (const a of args) this.expr(a);
      return;
    }
    args.forEach((arg, i) => {
      const parametro = sp.parametros[i];
      const esperado = parametro.tipo === null ? INDEFINIDO : this.resolverTipo(parametro.tipo);
      if (parametro.porReferencia && arg.clase !== "Variable" && arg.clase !== "Indice") {
        this.err(
          arg,
          1,
          `'${parametro.lexema}' es 'Por Referencia', así que acá tiene que ir una variable, no un cálculo.`,
          "El subprograma necesita poder modificarla."
        );
        this.expr(arg);
        return;
      }
      const recibido = this.expr(arg);
      const compatible = parametro.porReferencia ? esIndefinido(esperado) || esIndefinido(recibido) || iguales(esperado, recibido) : this.encaja(esperado, recibido, arg);
      if (!compatible) {
        this.err(
          arg,
          1,
          `'${parametro.lexema}' es ${art(esperado)} y acá se le pasa ${art(recibido)}.`,
          parametro.porReferencia && asignable(esperado, recibido) ? "Al ser 'Por Referencia' el tipo tiene que ser exactamente el mismo, porque el subprograma escribe de vuelta en la variable." : comoConvertir(esperado, recibido)
        );
      }
      if (parametro.porReferencia && arg.clase === "Variable") {
        const simbolo = this.ambito.get(arg.nombre);
        if (simbolo !== void 0) simbolo.escrita = true;
      }
    });
  }
  verificarIntegrada(nombreLlamada, lexema, args, pos) {
    const integrada = INTEGRADAS[nombreLlamada];
    const tiposArgs = args.map((a) => this.expr(a));
    if (integrada.aceptaArreglo === true && tiposArgs.length === 1 && esArreglo(tiposArgs[0])) {
      return ENTERO;
    }
    const compatible = (firma) => firma.params.length === tiposArgs.length && firma.params.every((familia, i) => coincideFamilia(familia, tiposArgs[i]));
    const elegida = integrada.firmas.find(compatible);
    if (elegida !== void 0) {
      if (elegida.retorno === "mismoQueArg0") return tiposArgs[0] ?? INDEFINIDO;
      return tipoDeFamilia(elegida.retorno);
    }
    const primera = integrada.firmas[0];
    if (primera.params.length !== tiposArgs.length) {
      const n = primera.params.length;
      this.err(
        pos,
        lexema.length,
        `'${integrada.lexema}' espera ${n} ${n === 1 ? "argumento" : "argumentos"} y recibió ${tiposArgs.length}.`,
        `Se usa así: ${integrada.lexema}(${primera.params.map(describirFamilia).join(", ")}).`
      );
      return INDEFINIDO;
    }
    const indiceMalo = primera.params.findIndex(
      (familia, i) => !coincideFamilia(familia, tiposArgs[i])
    );
    if (indiceMalo >= 0) {
      this.err(
        args[indiceMalo] ?? pos,
        1,
        `'${integrada.lexema}' espera ${describirFamilia(primera.params[indiceMalo])} y acá recibe ${art(tiposArgs[indiceMalo])}.`,
        integrada.aceptaArreglo === true ? `'${integrada.lexema}' funciona con textos y con arreglos.` : void 0
      );
    }
    if (primera.retorno === "mismoQueArg0") return INDEFINIDO;
    return tipoDeFamilia(primera.retorno);
  }
  subprogramaParecido(objetivo) {
    let mejor;
    const candidatos = [
      ...[...this.subprogramas.values()].map((s) => ({ nombre: s.lexema.toLowerCase(), lexema: s.lexema })),
      ...Object.entries(INTEGRADAS).map(([n, i]) => ({ nombre: n, lexema: i.lexema }))
    ];
    for (const c of candidatos) {
      const d = distancia(objetivo, c.nombre);
      const umbral = objetivo.length <= 4 ? 1 : 2;
      if (d <= umbral && (mejor === void 0 || d < mejor.distancia)) {
        mejor = { lexema: c.lexema, distancia: d };
      }
    }
    return mejor?.lexema;
  }
};
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  const actual = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    actual[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(actual[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo);
    }
    for (let j = 0; j <= b.length; j++) previa[j] = actual[j];
  }
  return previa[b.length];
}

// web/formato.ts
var ANCHO_SANGRIA = 4;
var CIERRES2 = /* @__PURE__ */ new Set([
  "Fin",
  "FinSi",
  "FinMientras",
  "FinPara",
  "FinSegun",
  "FinFuncion",
  "FinProcedimiento"
]);
var ABREN_AL_FINAL = /* @__PURE__ */ new Set([
  "Inicio",
  "Entonces",
  "Hacer",
  "Repetir"
]);
function porLineaLogica(tokens) {
  const lineas = [];
  let actual = [];
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
function calcularNiveles(fuente) {
  const { tokens } = tokenizar(fuente);
  const pila = [];
  const salida = [];
  for (const linea of porLineaLogica(tokens)) {
    const primero = linea[0];
    const ultimo = linea[linea.length - 1];
    let nivel;
    const dentroDeSegun = pila.includes("segun");
    const esEtiquetaDeCaso = dentroDeSegun && (primero.tipo === "NUMERO" || primero.tipo === "TEXTO" || primero.tipo === "-") && linea.some((t) => t.tipo === ":");
    const esDeOtroModo = primero.tipo === "De" && linea[1]?.tipo === "Otro" && linea[2]?.tipo === "Modo";
    if (CIERRES2.has(primero.tipo)) {
      if (primero.tipo === "FinSegun") {
        while (pila.length > 0 && pila.pop() !== "segun") {
        }
      } else if (pila.length > 0) {
        pila.pop();
      }
      nivel = pila.length;
    } else if (primero.tipo === "Hasta") {
      if (pila.length > 0) pila.pop();
      nivel = pila.length;
    } else if (primero.tipo === "SiNo") {
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
    if (primero.tipo === "Funcion" || primero.tipo === "Procedimiento") {
      pila.push("bloque");
    } else if (primero.tipo === "SiNo") {
    } else if (ABREN_AL_FINAL.has(ultimo.tipo)) {
      pila.push(primero.tipo === "Segun" ? "segun" : "bloque");
    }
  }
  return salida;
}
function formatear(fuente) {
  const niveles = new Map(calcularNiveles(fuente).map((n) => [n.linea, n.nivel]));
  const lineas = fuente.split("\n");
  return lineas.map((texto, idx) => {
    const nivel = niveles.get(idx + 1);
    const cuerpo = texto.trim();
    if (cuerpo === "") return "";
    if (nivel === void 0) return texto;
    return " ".repeat(nivel * ANCHO_SANGRIA) + cuerpo;
  }).join("\n");
}
function diagnosticosDeSangria(fuente) {
  const lineas = fuente.split("\n");
  const salida = [];
  for (const { linea, nivel } of calcularNiveles(fuente)) {
    const texto = lineas[linea - 1];
    if (texto === void 0) continue;
    const sangriaReal = texto.length - texto.trimStart().length;
    const esperada = nivel * ANCHO_SANGRIA;
    if (sangriaReal === esperada) continue;
    salida.push(
      advertencia(
        { linea, columna: 1 },
        Math.max(1, sangriaReal),
        "la sangría no coincide con la estructura del programa.",
        `Esta línea va con ${esperada} espacios. Usa Formatear para corregir todo el archivo.`
      )
    );
  }
  return salida;
}

// web/analisis.ts
function analizar(fuente) {
  const { tokens, errores: lexicos } = tokenizar(fuente);
  const { programa, errores: sintacticos } = parsear(tokens);
  const semanticos = lexicos.length === 0 && sintacticos.length === 0 ? verificar(programa) : [];
  return [
    ...lexicos,
    ...sintacticos,
    ...semanticos,
    ...diagnosticosDeSangria(fuente)
  ].sort((a, b) => a.linea - b.linea || a.columna - b.columna);
}
function compilar(fuente) {
  const diagnosticos = analizar(fuente);
  const graves = diagnosticos.filter((d) => d.severidad === "error");
  if (graves.length > 0) return { ok: false, diagnosticos: graves };
  const { tokens } = tokenizar(fuente);
  const { programa } = parsear(tokens);
  return { ok: true, programa };
}
function resumir(diagnosticos) {
  const errores = diagnosticos.filter((d) => d.severidad === "error").length;
  return {
    errores,
    advertencias: diagnosticos.length - errores,
    valido: errores === 0
  };
}
export {
  ANCHO_SANGRIA,
  analizar,
  calcularNiveles,
  compilar,
  formatear,
  resumir
};
