import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tokenizar } from "../src/lexer.ts";
import type { TipoToken } from "../src/token.ts";

/** Tipos de token, sin el EOF final, para comparar de forma compacta. */
function tipos(fuente: string): TipoToken[] {
  const { tokens } = tokenizar(fuente);
  return tokens.slice(0, -1).map((t) => t.tipo);
}

function sinErrores(fuente: string) {
  const r = tokenizar(fuente);
  assert.deepEqual(
    r.errores.map((e) => `L${e.linea}: ${e.mensaje}`),
    [],
    "no se esperaban errores",
  );
  return r;
}

describe("palabras clave", () => {
  test("insensibles a mayúsculas", () => {
    assert.deepEqual(tipos("Inicio inicio INICIO iNiCiO"), [
      "Inicio",
      "Inicio",
      "Inicio",
      "Inicio",
      "FIN_LINEA",
    ]);
  });

  test("insensibles a acentos", () => {
    assert.deepEqual(tipos("Segun Según SEGÚN según"), [
      "Segun",
      "Segun",
      "Segun",
      "Segun",
      "FIN_LINEA",
    ]);
    assert.deepEqual(tipos("Funcion Función"), ["Funcion", "Funcion", "FIN_LINEA"]);
  });

  test("conservan el lexema original para los mensajes de error", () => {
    const { tokens } = tokenizar("SEGÚN");
    assert.equal(tokens[0]!.tipo, "Segun");
    assert.equal(tokens[0]!.lexema, "SEGÚN");
  });

  test("'SiNo' es una palabra; 'Si No' son dos", () => {
    assert.deepEqual(tipos("SiNo"), ["SiNo", "FIN_LINEA"]);
    assert.deepEqual(tipos("Si No"), ["Si", "No", "FIN_LINEA"]);
  });

  test("DIV y MOD son palabras clave, no identificadores", () => {
    assert.deepEqual(tipos("7 DIV 2 MOD 3"), [
      "NUMERO",
      "DIV",
      "NUMERO",
      "MOD",
      "NUMERO",
      "FIN_LINEA",
    ]);
  });

  test("Para Cada ... En se tokeniza pieza por pieza", () => {
    assert.deepEqual(tipos("Para Cada nota En notas Hacer"), [
      "Para",
      "Cada",
      "IDENTIFICADOR",
      "En",
      "IDENTIFICADOR",
      "Hacer",
      "FIN_LINEA",
    ]);
  });
});

describe("identificadores", () => {
  test("insensibles a mayúsculas: mismo nombre normalizado", () => {
    const { tokens } = sinErrores("base Base BASE");
    const nombres = tokens
      .filter((t) => t.tipo === "IDENTIFICADOR")
      .map((t) => (t as { nombre: string }).nombre);
    assert.deepEqual(nombres, ["base", "base", "base"]);
  });

  test("los acentos SÍ distinguen: 'area' y 'área' son distintas", () => {
    const { tokens } = sinErrores("area área");
    const nombres = tokens
      .filter((t) => t.tipo === "IDENTIFICADOR")
      .map((t) => (t as { nombre: string }).nombre);
    assert.deepEqual(nombres, ["area", "área"]);
  });

  test("admiten ñ y dígitos y guion bajo", () => {
    const { tokens } = sinErrores("año nota_1 númeroDeAlumnos");
    assert.deepEqual(
      tokens.filter((t) => t.tipo === "IDENTIFICADOR").map((t) => t.lexema),
      ["año", "nota_1", "númeroDeAlumnos"],
    );
  });

  test("no pueden empezar con dígito", () => {
    const { errores } = tokenizar("2ndaNota <- 5");
    assert.equal(errores.length, 1);
    assert.match(errores[0]!.mensaje, /no es un número ni un nombre válido/);
  });
});

describe("números", () => {
  test("distingue Entero de Real", () => {
    const { tokens } = sinErrores("5 5.0 5.25 2e3 1.5e-2");
    const nums = tokens.filter((t) => t.tipo === "NUMERO") as Array<{
      valor: number;
      esEntero: boolean;
    }>;
    assert.deepEqual(
      nums.map((n) => [n.valor, n.esEntero]),
      [
        [5, true],
        [5, false],
        [5.25, false],
        [2000, false],
        [0.015, false],
      ],
    );
  });

  test("punto sin decimales es error con sugerencia", () => {
    const { errores } = tokenizar("x <- 5.");
    assert.equal(errores.length, 1);
    assert.match(errores[0]!.mensaje, /punto decimal sin dígitos/);
    assert.equal(errores[0]!.sugerencia, "Escribe '5' o '5.0'.");
  });

  test("'e' sin dígitos no se toma como exponente", () => {
    // 'ejemplo' es un identificador, no el exponente de 2.
    assert.deepEqual(tipos("2 ejemplo"), ["NUMERO", "IDENTIFICADOR", "FIN_LINEA"]);
  });
});

describe("textos", () => {
  test("acentos y escapes", () => {
    const { tokens } = sinErrores('"El área es: "');
    assert.equal((tokens[0] as { valor: string }).valor, "El área es: ");
  });

  test("escapes válidos", () => {
    const { tokens } = sinErrores('"dijo \\"hola\\"" "a\\\\b" "l1\\nl2"');
    const valores = tokens
      .filter((t) => t.tipo === "TEXTO")
      .map((t) => (t as { valor: string }).valor);
    assert.deepEqual(valores, ['dijo "hola"', "a\\b", "l1\nl2"]);
  });

  test("escape inválido es error pero el texto sigue tokenizando", () => {
    const { tokens, errores } = tokenizar('"a\\qb"');
    assert.equal(errores.length, 1);
    assert.match(errores[0]!.mensaje, /no es una secuencia de escape válida/);
    assert.equal(tokens[0]!.tipo, "TEXTO");
  });

  test("texto sin cerrar no se come la línea siguiente", () => {
    const { tokens, errores } = tokenizar('Escribir "hola\nEscribir "chau"');
    assert.equal(errores.length, 1);
    assert.match(errores[0]!.mensaje, /falta la comilla de cierre/);
    assert.equal(errores[0]!.linea, 1);
    // La línea 2 se sigue tokenizando con normalidad.
    assert.ok(tokens.some((t) => t.tipo === "Escribir" && t.linea === 2));
  });
});

describe("operadores", () => {
  test("los de dos caracteres ganan sobre los de uno", () => {
    assert.deepEqual(tipos("<- <= >= <> < > ="), [
      "<-",
      "<=",
      ">=",
      "<>",
      "<",
      ">",
      "=",
      "FIN_LINEA",
    ]);
  });

  test("asignación frente a comparación", () => {
    assert.deepEqual(tipos("area <- base = altura"), [
      "IDENTIFICADOR",
      "<-",
      "IDENTIFICADOR",
      "=",
      "IDENTIFICADOR",
      "FIN_LINEA",
    ]);
  });

  test("indexado y llamadas", () => {
    assert.deepEqual(tipos("notas[i + 1] <- Raiz(x)"), [
      "IDENTIFICADOR",
      "[",
      "IDENTIFICADOR",
      "+",
      "NUMERO",
      "]",
      "<-",
      "IDENTIFICADOR",
      "(",
      "IDENTIFICADOR",
      ")",
      "FIN_LINEA",
    ]);
  });
});

describe("líneas y comentarios", () => {
  test("el comentario no genera tokens", () => {
    assert.deepEqual(tipos("x <- 1 // esto se ignora"), [
      "IDENTIFICADOR",
      "<-",
      "NUMERO",
      "FIN_LINEA",
    ]);
  });

  test("líneas vacías y de solo comentario no generan FIN_LINEA", () => {
    assert.deepEqual(tipos("x <- 1\n\n\n// nada\n\ntotal <- 2"), [
      "IDENTIFICADOR",
      "<-",
      "NUMERO",
      "FIN_LINEA",
      "IDENTIFICADOR",
      "<-",
      "NUMERO",
      "FIN_LINEA",
    ]);
  });

  test("la última línea cierra aunque no haya salto final", () => {
    assert.deepEqual(tipos("Fin"), ["Fin", "FIN_LINEA"]);
  });

  test("continuación tras operador binario", () => {
    assert.deepEqual(tipos("total <- precio * cantidad +\n       impuesto"), [
      "IDENTIFICADOR",
      "<-",
      "IDENTIFICADOR",
      "*",
      "IDENTIFICADOR",
      "+",
      "IDENTIFICADOR",
      "FIN_LINEA",
    ]);
  });

  test("continuación tras coma", () => {
    assert.deepEqual(tipos('Escribir "a",\n        "b"'), [
      "Escribir",
      "TEXTO",
      ",",
      "TEXTO",
      "FIN_LINEA",
    ]);
  });

  test("continuación tras Y y O", () => {
    assert.deepEqual(tipos("Si a = 1 Y\n   b = 2 Entonces"), [
      "Si",
      "IDENTIFICADOR",
      "=",
      "NUMERO",
      "Y",
      "IDENTIFICADOR",
      "=",
      "NUMERO",
      "Entonces",
      "FIN_LINEA",
    ]);
  });

  test("sin continuación, cada línea cierra", () => {
    assert.deepEqual(tipos("Leer base\nLeer altura"), [
      "Leer",
      "IDENTIFICADOR",
      "FIN_LINEA",
      "Leer",
      "IDENTIFICADOR",
      "FIN_LINEA",
    ]);
  });
});

describe("posiciones", () => {
  test("línea y columna en 1 y correctas tras un salto", () => {
    const { tokens } = sinErrores("Leer base\n    Leer altura");
    assert.deepEqual(
      tokens
        .filter((t) => t.tipo === "IDENTIFICADOR")
        .map((t) => [t.lexema, t.linea, t.columna]),
      [
        ["base", 1, 6],
        ["altura", 2, 10],
      ],
    );
  });

  test("la indentación no afecta a nada salvo la columna", () => {
    const plano = tipos("Si x > 1 Entonces\nEscribir x\nFinSi");
    const sangrado = tipos("Si x > 1 Entonces\n        Escribir x\nFinSi");
    assert.deepEqual(plano, sangrado);
  });

  test("las tabulaciones se descartan igual que los espacios", () => {
    assert.deepEqual(tipos("\tx\t<-\t1"), [
      "IDENTIFICADOR",
      "<-",
      "NUMERO",
      "FIN_LINEA",
    ]);
  });
});

describe("símbolos desconocidos con sugerencia", () => {
  const casos: Array<[string, RegExp]> = [
    ["x ← 1", /Para asignar usa '<-'/],
    ["Si a ≠ b Entonces", /Para 'distinto de' usa '<>'/],
    ["x <- 1;", /no con punto y coma/],
    ["Si a Entonces {", /'FinSi' o 'FinMientras'/],
    ['Escribir “hola”', /comillas rectas/],
  ];

  for (const [fuente, esperado] of casos) {
    test(fuente, () => {
      const { errores } = tokenizar(fuente);
      assert.ok(errores.length >= 1, "se esperaba al menos un error");
      assert.match(errores[0]!.sugerencia ?? "", esperado);
    });
  }

  test("tras un símbolo desconocido sigue tokenizando", () => {
    const { tokens, errores } = tokenizar("x <- 1 @ total <- 2");
    assert.equal(errores.length, 1);
    assert.ok(tokens.some((t) => t.tipo === "<-" && t.columna > 8));
  });
});

describe("colisión entre 'y'/'o' y los operadores lógicos", () => {
  test("'y' se lexea como el operador Y, no como identificador", () => {
    assert.deepEqual(tipos("y"), ["Y", "FIN_LINEA"]);
    assert.deepEqual(tipos("o"), ["O", "FIN_LINEA"]);
  });

  test("'coordY' y 'posY' sí son identificadores válidos", () => {
    const { tokens } = sinErrores("coordY <- 2\nposY <- 3");
    assert.deepEqual(
      tokens.filter((t) => t.tipo === "IDENTIFICADOR").map((t) => t.lexema),
      ["coordY", "posY"],
    );
  });

  test("el operador lógico sigue funcionando con normalidad", () => {
    sinErrores("Si a > 1 Y b < 2 O No c Entonces");
  });
});

describe("programa completo", () => {
  const fuente = `// Calcula el área de un rectángulo.
Inicio
    Definir base, altura, área Como Real

    Escribir Sin Salto "Base: "
    Leer base
    Escribir Sin Salto "Altura: "
    Leer altura

    área <- base * altura
    Escribir "El área es: ", área
Fin`;

  test("no produce errores léxicos", () => {
    sinErrores(fuente);
  });

  test("termina en FIN_LINEA y EOF", () => {
    const { tokens } = tokenizar(fuente);
    assert.equal(tokens.at(-2)!.tipo, "FIN_LINEA");
    assert.equal(tokens.at(-1)!.tipo, "EOF");
  });

  test("'área' se reconoce como identificador, no como palabra clave", () => {
    const { tokens } = tokenizar(fuente);
    const areas = tokens.filter(
      (t) => t.tipo === "IDENTIFICADOR" && (t as { nombre: string }).nombre === "área",
    );
    assert.equal(areas.length, 3);
  });

  test("cada sentencia produce exactamente un FIN_LINEA", () => {
    const { tokens } = tokenizar(fuente);
    assert.equal(tokens.filter((t) => t.tipo === "FIN_LINEA").length, 9);
  });
});

describe("comentarios de bloque", () => {
  test("abarcan varias líneas y no dejan tokens", () => {
    const { tokens, errores } = tokenizar("/* una\n   dos\n   tres */\nInicio\nFin\n");
    assert.deepEqual(errores, []);
    assert.deepEqual(
      tokens.filter((t) => t.tipo !== "FIN_LINEA" && t.tipo !== "EOF").map((t) => t.lexema),
      ["Inicio", "Fin"],
    );
  });

  test("las líneas que ocupa se siguen contando", () => {
    // Si no se contaran, todo error posterior apuntaría a la línea equivocada,
    // que es peor que no tener el comentario.
    const { tokens } = tokenizar("/* uno\ndos\ntres */\nInicio\n");
    const inicio = tokens.find((t) => t.lexema === "Inicio");
    assert.equal(inicio?.linea, 4);
  });

  test("puede ir en medio de una línea", () => {
    const { tokens, errores } = tokenizar("Definir a /* medida */ Como Entero\n");
    assert.deepEqual(errores, []);
    assert.deepEqual(
      tokens.filter((t) => t.tipo !== "FIN_LINEA" && t.tipo !== "EOF").map((t) => t.lexema),
      ["Definir", "a", "Como", "Entero"],
    );
  });

  test("sin cerrar avisa dónde empezó", () => {
    const { errores } = tokenizar("Inicio\n    /* me olvidé\n    Escribir 1\nFin\n");
    assert.equal(errores.length, 1);
    assert.equal(errores[0]!.linea, 2, "señala la apertura, no el final del archivo");
    assert.match(errores[0]!.mensaje, /nunca se cierra/);
  });

  test("no se interpreta dentro de un texto", () => {
    const { tokens, errores } = tokenizar('Escribir "no /* es */ comentario"\n');
    assert.deepEqual(errores, []);
    assert.equal(tokens[1]!.lexema, '"no /* es */ comentario"');
  });

  test("no anidan: cierra el primer */", () => {
    // El '*/' del medio cierra, así que 'Inicio' queda fuera del comentario.
    const { tokens, errores } = tokenizar("/* a /* b */ Inicio\nFin\n");
    assert.deepEqual(errores, []);
    assert.equal(tokens[0]!.lexema, "Inicio");
  });

  test("una división no se confunde con una apertura", () => {
    const { errores } = tokenizar("a <- b / c\n");
    assert.deepEqual(errores, []);
  });
});
