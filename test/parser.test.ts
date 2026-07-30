import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import type { Expr, Sentencia } from "../src/ast.ts";

function analizar(fuente: string) {
  const { tokens, errores: lex } = tokenizar(fuente);
  const { programa, errores: sin } = parsear(tokens);
  return { programa, errores: [...lex, ...sin] };
}

/** Envuelve el fragmento en Inicio/Fin y exige que no haya errores. */
function sentencias(cuerpo: string): Sentencia[] {
  const { programa, errores } = analizar(`Inicio\n${cuerpo}\nFin`);
  assert.deepEqual(
    errores.map((e) => `L${e.linea}: ${e.mensaje}`),
    [],
    "no se esperaban errores",
  );
  return programa.principal;
}

function unaSentencia(cuerpo: string): Sentencia {
  const s = sentencias(cuerpo);
  assert.equal(s.length, 1, "se esperaba exactamente una sentencia");
  return s[0]!;
}

/** Serializa una expresión con paréntesis explícitos, para ver la estructura. */
function forma(e: Expr): string {
  switch (e.clase) {
    case "LiteralNumero":
      return String(e.valor);
    case "LiteralTexto":
      return JSON.stringify(e.valor);
    case "LiteralLogico":
      return e.valor ? "Verdadero" : "Falso";
    case "Variable":
      return e.nombre;
    case "Indice":
      return `${e.base.nombre}[${e.indices.map(forma).join(",")}]`;
    case "Unario":
      return `(${e.op} ${forma(e.operando)})`;
    case "Binario":
      return `(${forma(e.izq)} ${e.op} ${forma(e.der)})`;
    case "Llamada":
      return `${e.nombre}(${e.args.map(forma).join(",")})`;
  }
}

/** Forma de la expresión asignada en `x <- ...`. */
function formaDe(expresion: string): string {
  const s = unaSentencia(`x <- ${expresion}`);
  assert.equal(s.clase, "Asignacion");
  return forma((s as Extract<Sentencia, { clase: "Asignacion" }>).valor);
}

function errores(fuente: string) {
  return analizar(fuente).errores;
}

// ====================================================================

describe("estructura del programa", () => {
  test("Inicio/Fin vacío es válido", () => {
    const { programa, errores } = analizar("Inicio\nFin");
    assert.deepEqual(errores, []);
    assert.deepEqual(programa.principal, []);
    assert.deepEqual(programa.posInicio, { linea: 1, columna: 1 });
  });

  test("sin 'Inicio' se reporta", () => {
    const e = errores("Escribir 1");
    assert.ok(e.some((d) => /no tiene bloque 'Inicio'/.test(d.mensaje)));
  });

  test("subprogramas antes y después del bloque principal", () => {
    const { programa, errores } = analizar(`
Procedimiento Antes()
    Escribir "a"
FinProcedimiento

Inicio
    Antes()
Fin

Funcion r <- Despues(x Como Entero)
    r <- x
FinFuncion`);
    assert.deepEqual(errores, []);
    assert.deepEqual(
      programa.subprogramas.map((s) => [s.clase, s.nombre]),
      [
        ["Procedimiento", "antes"],
        ["Funcion", "despues"],
      ],
    );
  });

  test("dos bloques 'Inicio' se reportan", () => {
    const e = errores("Inicio\nFin\nInicio\nFin");
    assert.ok(e.some((d) => /más de un bloque 'Inicio'/.test(d.mensaje)));
  });
});

describe("declaraciones", () => {
  test("varias variables de un tipo", () => {
    const s = unaSentencia("Definir base, altura, área Como Real");
    assert.equal(s.clase, "Definir");
    const d = s as Extract<Sentencia, { clase: "Definir" }>;
    assert.deepEqual(
      d.nombres.map((n) => n.nombre),
      ["base", "altura", "área"],
    );
    assert.deepEqual(d.tipo, { clase: "TipoSimple", tipo: "Real" });
  });

  test("arreglo de una dimensión", () => {
    const d = unaSentencia("Definir notas Como Arreglo[30] De Real") as Extract<
      Sentencia,
      { clase: "Definir" }
    >;
    assert.equal(d.tipo.clase, "TipoArreglo");
    assert.equal(d.tipo.clase === "TipoArreglo" && d.tipo.base, "Real");
  });

  test("arreglo de dos dimensiones", () => {
    const d = unaSentencia("Definir tablero Como Arreglo[3, 3] De Entero") as Extract<
      Sentencia,
      { clase: "Definir" }
    >;
    assert.equal(d.tipo.clase === "TipoArreglo" && d.tipo.dimensiones.length, 2);
  });

  test("falta 'Como'", () => {
    const e = errores("Inicio\nDefinir x Real\nFin");
    assert.match(e[0]!.mensaje, /se esperaba 'Como'/);
    assert.match(e[0]!.sugerencia ?? "", /Definir base Como Real/);
  });

  test("tipo inválido lista los tipos válidos", () => {
    const e = errores("Inicio\nDefinir x Como Numero\nFin");
    assert.match(e[0]!.sugerencia ?? "", /Entero, Real, Texto, Caracter y Logico/);
  });
});

describe("palabras reservadas como nombre", () => {
  test("'Definir x, y Como Real' explica el motivo y sugiere coordY", () => {
    const e = errores("Inicio\nDefinir x, y Como Real\nFin");
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /'y' es una palabra reservada/);
    assert.match(e[0]!.sugerencia ?? "", /coordY/);
    assert.equal(e[0]!.linea, 2);
    assert.equal(e[0]!.columna, 12);
  });

  test("'Leer y' lo explica igual", () => {
    const e = errores("Inicio\nLeer y\nFin");
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /'y' es una palabra reservada/);
  });

  test("'y <- 2' lo explica igual", () => {
    const e = errores("Inicio\ny <- 2\nFin");
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /'y' es una palabra reservada/);
  });

  test("'coordX' y 'coordY' funcionan sin problema", () => {
    sentencias("Definir coordX, coordY Como Real\ncoordX <- 1\ncoordY <- 2");
  });

  test("el operador lógico sigue intacto", () => {
    assert.equal(formaDe("a > 1 Y b < 2"), "((a > 1) Y (b < 2))");
  });
});

describe("precedencia de operadores", () => {
  const casos: Array<[string, string]> = [
    ["1 + 2 * 3", "(1 + (2 * 3))"],
    ["1 * 2 + 3", "((1 * 2) + 3)"],
    ["(1 + 2) * 3", "((1 + 2) * 3)"],
    ["1 - 2 - 3", "((1 - 2) - 3)"], // suma asocia a la izquierda
    ["2 ^ 3 ^ 2", "(2 ^ (3 ^ 2))"], // potencia asocia a la derecha
    ["-2 ^ 2", "(- (2 ^ 2))"], // ^ liga más que el menos unario
    ["2 ^ -1", "(2 ^ (- 1))"], // exponente negativo
    ["7 DIV 2 MOD 3", "((7 DIV 2) MOD 3)"],
    ["1 + 2 = 3", "((1 + 2) = 3)"], // aritmética liga más que comparación
    ["a Y b O c", "((a Y b) O c)"], // Y liga más que O
    ["No a Y b", "((No a) Y b)"], // No liga más que Y
    ["No a = b", "(No (a = b))"], // No liga MENOS que la comparación
    ["a O b Y c", "(a O (b Y c))"],
  ];

  for (const [entrada, esperado] of casos) {
    test(`${entrada}  ⇒  ${esperado}`, () => {
      assert.equal(formaDe(entrada), esperado);
    });
  }
});

describe("comparaciones no encadenables", () => {
  test("'1 < x < 10' se rechaza con la corrección concreta", () => {
    const e = errores("Inicio\nSi 1 < x < 10 Entonces\nFinSi\nFin");
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /no se pueden encadenar comparaciones/);
    assert.match(e[0]!.sugerencia ?? "", /1 < x Y x < 10/);
  });

  test("la versión con 'Y' sí se acepta", () => {
    sentencias("Si 1 < x Y x < 10 Entonces\nEscribir 1\nFinSi");
  });

  test("un solo error, no una cascada", () => {
    const e = errores("Inicio\nSi a < b < c < d Entonces\nFinSi\nFin");
    assert.equal(e.filter((d) => /encadenar/.test(d.mensaje)).length, 1);
  });
});

describe("expresiones", () => {
  test("indexado y llamadas anidadas", () => {
    assert.equal(formaDe("notas[i + 1]"), "notas[(i + 1)]");
    assert.equal(formaDe("Raiz(Abs(x))"), "raiz(abs(x))");
    assert.equal(formaDe("Longitud(notas) - 1"), "(longitud(notas) - 1)");
  });

  test("llamada sin argumentos", () => {
    assert.equal(formaDe("Aleatorio()"), "aleatorio()");
  });

  test("literales lógicos", () => {
    assert.equal(formaDe("Verdadero"), "Verdadero");
    assert.equal(formaDe("No Falso"), "(No Falso)");
  });

  test("expresión incompleta al final de la línea", () => {
    const e = errores("Inicio\nx <- 1 +\nFin");
    assert.match(e[0]!.mensaje, /expresión quedó incompleta/);
  });

  test("paréntesis sin cerrar", () => {
    const e = errores("Inicio\nx <- (1 + 2\nFin");
    assert.match(e[0]!.mensaje, /falta el paréntesis de cierre/);
  });
});

describe("'=' en lugar de '<-'", () => {
  test("da el mensaje específico, no un error de sintaxis genérico", () => {
    const e = errores("Inicio\nbase = 5\nFin");
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /Para asignar un valor se usa la flecha/);
    assert.match(e[0]!.sugerencia ?? "", /'base <- \.\.\.'/);
    assert.match(e[0]!.sugerencia ?? "", /comparar, no para asignar/);
  });
});

describe("condicionales", () => {
  test("Si / SiNo Si / SiNo", () => {
    const s = unaSentencia(`Si nota >= 9 Entonces
    Escribir "Excelente"
SiNo Si nota >= 7 Entonces
    Escribir "Aprobado"
SiNo
    Escribir "Reprobado"
FinSi`) as Extract<Sentencia, { clase: "Si" }>;

    assert.equal(s.clase, "Si");
    assert.equal(s.ramas.length, 2);
    assert.equal(forma(s.ramas[0]!.condicion), "(nota >= 9)");
    assert.equal(forma(s.ramas[1]!.condicion), "(nota >= 7)");
    assert.equal(s.sino?.length, 1);
  });

  test("Si sin SiNo", () => {
    const s = unaSentencia("Si x > 0 Entonces\nEscribir x\nFinSi") as Extract<
      Sentencia,
      { clase: "Si" }
    >;
    assert.equal(s.ramas.length, 1);
    assert.equal(s.sino, null);
  });

  test("falta 'Entonces'", () => {
    const e = errores("Inicio\nSi x > 0\nEscribir x\nFinSi\nFin");
    assert.match(e[0]!.mensaje, /se esperaba 'Entonces'/);
    assert.match(e[0]!.sugerencia ?? "", /Si <condición> Entonces/);
  });

  test("Si anidados", () => {
    const s = unaSentencia(`Si a Entonces
    Si b Entonces
        Escribir 1
    FinSi
FinSi`) as Extract<Sentencia, { clase: "Si" }>;
    assert.equal(s.ramas[0]!.cuerpo.length, 1);
    assert.equal(s.ramas[0]!.cuerpo[0]!.clase, "Si");
  });
});

describe("Segun", () => {
  test("casos con varios valores y De Otro Modo", () => {
    const s = unaSentencia(`Segun dia Hacer
    1, 2, 3, 4, 5:
        Escribir "Laboral"
    6, 7:
        Escribir "Fin de semana"
    De Otro Modo:
        Escribir "Inválido"
FinSegun`) as Extract<Sentencia, { clase: "Segun" }>;

    assert.equal(s.clase, "Segun");
    assert.equal(s.casos.length, 2);
    assert.deepEqual(
      s.casos[0]!.valores.map((v) => v.clase === "LiteralNumero" && v.valor),
      [1, 2, 3, 4, 5],
    );
    assert.equal(s.casos[1]!.valores.length, 2);
    assert.equal(s.otroModo?.length, 1);
  });

  test("casos de texto y negativos", () => {
    const s = unaSentencia(`Segun letra Hacer
    "a": Escribir 1
    -1: Escribir 2
FinSegun`) as Extract<Sentencia, { clase: "Segun" }>;
    assert.equal(s.casos.length, 2);
    const v = s.casos[1]!.valores[0]!;
    assert.equal(v.clase === "LiteralNumero" && v.valor, -1);
  });

  test("una variable como valor de caso se rechaza", () => {
    const e = errores("Inicio\nSegun x Hacer\n    n: Escribir 1\nFinSegun\nFin");
    assert.match(e[0]!.mensaje, /se comparan contra valores fijos/);
  });
});

describe("bucles", () => {
  test("Mientras", () => {
    const s = unaSentencia("Mientras x > 0 Hacer\nx <- x - 1\nFinMientras") as Extract<
      Sentencia,
      { clase: "Mientras" }
    >;
    assert.equal(forma(s.condicion), "(x > 0)");
    assert.equal(s.cuerpo.length, 1);
  });

  test("Repetir / Hasta Que", () => {
    const s = unaSentencia("Repetir\nx <- x + 1\nHasta Que x >= 10") as Extract<
      Sentencia,
      { clase: "Repetir" }
    >;
    assert.equal(s.clase, "Repetir");
    assert.equal(forma(s.condicion), "(x >= 10)");
  });

  test("Para con paso implícito", () => {
    const s = unaSentencia("Para i <- 0 Hasta 9 Hacer\nEscribir i\nFinPara") as Extract<
      Sentencia,
      { clase: "Para" }
    >;
    assert.equal(s.variable.nombre, "i");
    assert.equal(forma(s.desde), "0");
    assert.equal(forma(s.hasta), "9");
    assert.equal(s.paso, null);
  });

  test("Para con paso negativo", () => {
    const s = unaSentencia(
      "Para i <- 10 Hasta 1 Con Paso -1 Hacer\nEscribir i\nFinPara",
    ) as Extract<Sentencia, { clase: "Para" }>;
    assert.equal(forma(s.paso!), "(- 1)");
  });

  test("el recorrido canónico de un arreglo", () => {
    const s = unaSentencia(
      "Para i <- 0 Hasta Longitud(notas) - 1 Hacer\nEscribir notas[i]\nFinPara",
    ) as Extract<Sentencia, { clase: "Para" }>;
    assert.equal(forma(s.hasta), "(longitud(notas) - 1)");
  });

  test("Para Cada", () => {
    const s = unaSentencia("Para Cada nota En notas Hacer\nEscribir nota\nFinPara") as Extract<
      Sentencia,
      { clase: "ParaCada" }
    >;
    assert.equal(s.clase, "ParaCada");
    assert.equal(s.variable.nombre, "nota");
    assert.equal(s.arreglo.nombre, "notas");
  });

  test("'Para i = 0' explica la flecha y no genera cascada", () => {
    const e = errores("Inicio\nPara i = 0 Hasta 9 Hacer\nEscribir i\nFinPara\nFin");
    // Un solo error: el encabezado se recupera, así que el 'FinPara' no queda
    // huérfano y el cuerpo se sigue analizando.
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /El valor inicial se asigna con la flecha/);
    assert.match(e[0]!.sugerencia ?? "", /Para i <- 0 Hasta 9 Hacer/);
  });

  test("falta 'Hacer': se reporta pero el bloque sobrevive", () => {
    const { programa, errores: e } = analizar(
      "Inicio\nMientras x > 0\nEscribir x\nFinMientras\nFin",
    );
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /se esperaba 'Hacer'/);
    // El cuerpo se analizó igual.
    const m = programa.principal[0] as Extract<Sentencia, { clase: "Mientras" }>;
    assert.equal(m.clase, "Mientras");
    assert.equal(m.cuerpo.length, 1);
  });
});

describe("pila de bloques abiertos", () => {
  test("cierre equivocado nombra el bloque real y su línea", () => {
    const e = errores(`Inicio
    Para i <- 0 Hasta 9 Hacer
        Escribir i
    FinMientras
Fin`);
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /encontré 'FinMientras'/);
    assert.match(e[0]!.mensaje, /el bloque abierto es un 'Para' \(línea 2\)/);
    assert.match(e[0]!.sugerencia ?? "", /¿Querías escribir 'FinPara'\?/);
  });

  test("bloque sin cerrar al final del archivo", () => {
    const e = errores(`Inicio
    Si x > 0 Entonces
        Escribir x
Fin`);
    assert.ok(e.some((d) => /falta 'FinSi'/.test(d.mensaje)));
    assert.ok(e.some((d) => /'Si' de la línea 2 quedó sin cerrar/.test(d.mensaje)));
  });

  test("anidamiento profundo: se señala el bloque interno, sin cascada", () => {
    const e = errores(`Inicio
    Mientras a Hacer
        Si b Entonces
            Para i <- 0 Hasta 1 Hacer
                Escribir i
            FinSi
        FinPara
    FinMientras
Fin`);
    // 'FinSi' pertenece al 'Si' abierto, así que no se consume como cierre
    // equivocado del 'Para': se reporta que al 'Para' le falta su cierre.
    assert.match(e[0]!.mensaje, /falta 'FinPara'/);
    assert.match(e[0]!.mensaje, /'Para' de la línea 4 quedó sin cerrar/);
  });

  test("un cierre ajeno no se consume, así que el bloque externo sigue sano", () => {
    const e = errores(`Inicio
    Si x Entonces
        Escribir 1
Fin`);
    // Un solo error: falta FinSi. El 'Fin' de Inicio queda intacto.
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /falta 'FinSi'/);
  });

  test("Repetir sin 'Hasta Que'", () => {
    const e = errores("Inicio\nRepetir\nEscribir 1\nFin");
    assert.ok(e.some((d) => /falta 'Hasta Que'/.test(d.mensaje)));
  });
});

describe("recuperación de errores", () => {
  test("un error en una línea no impide analizar las siguientes", () => {
    const { programa, errores } = analizar(`Inicio
    Definir x Como Entero
    x <- (1
    x <- 2
    Escribir x
Fin`);
    assert.equal(errores.length, 1);
    // Se conservan Definir, la asignación válida y el Escribir.
    assert.deepEqual(
      programa.principal.map((s) => s.clase),
      ["Definir", "Asignacion", "Escribir"],
    );
  });

  test("una línea que termina en operador se une con la siguiente", () => {
    // Consecuencia directa de la continuación de línea (especificación 2.5):
    // el '+' absorbe el salto y arrastra la línea de abajo.
    const e = errores(`Inicio
    x <- 1 +
    x <- 2
Fin`);
    assert.equal(e.length, 1);
    assert.match(e[0]!.mensaje, /segunda asignación en la misma línea/);
    assert.match(e[0]!.sugerencia ?? "", /termina en un operador/);
  });

  test("varios errores independientes se reportan todos", () => {
    const e = errores(`Inicio
    Definir a Real
    b = 2
    Si c > 1
    FinSi
Fin`);
    assert.ok(e.length >= 3, `se esperaban 3 o más errores, hubo ${e.length}`);
  });

  test("los errores salen ordenados por posición", () => {
    const e = errores(`Inicio
    Definir z Real
    w = 2
    Definir q Como Nada
Fin`);
    const lineas = e.map((d) => d.linea);
    assert.deepEqual(lineas, [...lineas].sort((a, b) => a - b));
  });

  test("no entra en bucle infinito con basura", () => {
    const e = errores("Inicio\n) ] , : ^ *\nFin");
    assert.ok(e.length > 0);
  });
});

describe("la indentación no cambia el AST", () => {
  test("mismo programa con y sin sangría", () => {
    const conSangria = `Inicio
    Si x > 0 Entonces
        Mientras contador > 0 Hacer
            Escribir contador
        FinMientras
    FinSi
Fin`;
    const sinSangria = `Inicio
Si x > 0 Entonces
Mientras contador > 0 Hacer
Escribir contador
FinMientras
FinSi
Fin`;
    const a = analizar(conSangria);
    const b = analizar(sinSangria);
    assert.deepEqual(a.errores, []);
    assert.deepEqual(b.errores, []);
    // Las posiciones difieren en columna, así que se compara la forma.
    const clases = (p: typeof a.programa) => JSON.stringify(p.principal, (k, v) =>
      k === "columna" || k === "linea" ? undefined : v,
    );
    assert.equal(clases(a.programa), clases(b.programa));
  });
});

describe("continuación de línea", () => {
  test("expresión partida tras un operador", () => {
    const s = unaSentencia("total <- precio * cantidad +\n         impuesto");
    assert.equal(s.clase, "Asignacion");
  });

  test("Escribir partido tras una coma", () => {
    const s = unaSentencia('Escribir "a",\n         "b"') as Extract<
      Sentencia,
      { clase: "Escribir" }
    >;
    assert.equal(s.partes.length, 2);
  });
});

describe("el programa completo de la especificación", () => {
  const fuente = `// Calcula el promedio de las notas de un grupo y clasifica el resultado.

Funcion promedio <- CalcularPromedio(Por Referencia notas, cantidad Como Entero)
    Definir suma Como Real
    Definir i Como Entero
    suma <- 0
    Para i <- 0 Hasta cantidad - 1 Hacer
        suma <- suma + notas[i]
    FinPara
    promedio <- suma / cantidad
FinFuncion

Funcion mayor <- NotaMaxima(Por Referencia notas, cantidad Como Entero)
    Definir i Como Entero
    mayor <- notas[0]
    Para i <- 1 Hasta cantidad - 1 Hacer
        Si notas[i] > mayor Entonces
            mayor <- notas[i]
        FinSi
    FinPara
FinFuncion

Procedimiento Clasificar(nota Como Real)
    Si nota >= 9 Entonces
        Escribir "Excelente"
    SiNo Si nota >= 7 Entonces
        Escribir "Aprobado"
    SiNo Si nota >= 5 Entonces
        Escribir "Recuperación"
    SiNo
        Escribir "Reprobado"
    FinSi
FinProcedimiento

Inicio
    Definir notas Como Arreglo[30] De Real
    Definir cantidad, i Como Entero
    Definir prom Como Real

    Escribir Sin Salto "¿Cuántos alumnos? "
    Leer cantidad

    Mientras cantidad < 1 O cantidad > 30 Hacer
        Escribir "Debe estar entre 1 y 30."
        Escribir Sin Salto "¿Cuántos alumnos? "
        Leer cantidad
    FinMientras

    Para i <- 0 Hasta cantidad - 1 Hacer
        Escribir Sin Salto "Nota del alumno ", i + 1, ": "
        Leer notas[i]
    FinPara

    prom <- CalcularPromedio(notas, cantidad)
    Escribir "Promedio del grupo: ", Redondear(prom * 100) / 100
    Escribir "Nota más alta: ", NotaMaxima(notas, cantidad)
    Clasificar(prom)
Fin`;

  test("analiza sin un solo error", () => {
    const { errores } = analizar(fuente);
    assert.deepEqual(
      errores.map((e) => `L${e.linea}:${e.columna} ${e.mensaje}`),
      [],
    );
  });

  test("el AST tiene la forma esperada", () => {
    const { programa } = analizar(fuente);
    assert.deepEqual(
      programa.subprogramas.map((s) => [s.clase, s.nombre, s.parametros.length]),
      [
        ["Funcion", "calcularpromedio", 2],
        ["Funcion", "notamaxima", 2],
        ["Procedimiento", "clasificar", 1],
      ],
    );
    assert.deepEqual(
      programa.principal.map((s) => s.clase),
      [
        "Definir",
        "Definir",
        "Definir",
        "Escribir",
        "Leer",
        "Mientras",
        "Para",
        "Asignacion",
        "Escribir",
        "Escribir",
        "LlamarProcedimiento",
      ],
    );
  });

  test("'Por Referencia' se registra en el parámetro correcto", () => {
    const { programa } = analizar(fuente);
    const f = programa.subprogramas[0]!;
    assert.deepEqual(
      f.parametros.map((p) => [p.nombre, p.porReferencia]),
      [
        ["notas", true],
        ["cantidad", false],
      ],
    );
  });
});
