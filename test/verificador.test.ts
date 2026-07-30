import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { verificar } from "../src/verificador.ts";
import type { Diagnostico } from "../src/diagnostico.ts";

/** Verifica un programa completo y devuelve solo los diagnósticos semánticos. */
function revisar(fuente: string): Diagnostico[] {
  const { tokens, errores: lex } = tokenizar(fuente);
  const { programa, errores: sin } = parsear(tokens);
  assert.deepEqual(
    [...lex, ...sin].map((e) => `L${e.linea}: ${e.mensaje}`),
    [],
    "el programa de prueba tiene errores de sintaxis",
  );
  return verificar(programa);
}

function errores(fuente: string): Diagnostico[] {
  return revisar(fuente).filter((d) => d.severidad === "error");
}

function avisos(fuente: string): Diagnostico[] {
  return revisar(fuente).filter((d) => d.severidad === "advertencia");
}

/** Envuelve el cuerpo en Inicio/Fin. */
function prog(cuerpo: string): string {
  return `Inicio\n${cuerpo}\nFin`;
}

/** Exige un único error y devuelve su mensaje + sugerencia. */
function unicoError(fuente: string): string {
  const e = errores(fuente);
  assert.equal(e.length, 1, `se esperaba 1 error, hubo ${e.length}: ${e.map((x) => x.mensaje).join(" | ")}`);
  return `${e[0]!.mensaje} ${e[0]!.sugerencia ?? ""}`;
}

// ====================================================================

describe("declaraciones obligatorias", () => {
  test("usar una variable sin declarar es error", () => {
    assert.match(unicoError(prog("x <- 1")), /'x' no está declarada/);
  });

  test("leer una variable sin declarar es error", () => {
    assert.match(unicoError(prog("Escribir total")), /'total' no está declarada/);
  });

  test("sugiere el nombre parecido cuando hay un typo", () => {
    const m = unicoError(prog("Definir cantidad Como Entero\ncantidda <- 1"));
    assert.match(m, /¿Quisiste escribir 'cantidad'\?/);
  });

  test("sin nombre parecido, explica cómo declarar", () => {
    assert.match(unicoError(prog("zzz <- 1")), /Definir zzz Como Real/);
  });

  test("redeclarar en el mismo ámbito es error", () => {
    const m = unicoError(prog("Definir x Como Entero\nDefinir x Como Real\nx <- 1\nEscribir x"));
    assert.match(m, /'x' ya fue declarada como Entero en la línea 2/);
  });

  test("un programa correcto no produce errores", () => {
    assert.deepEqual(
      errores(prog(`Definir base, altura, area Como Real
Leer base
Leer altura
area <- base * altura
Escribir "El área es: ", area`)),
      [],
    );
  });
});

describe("compatibilidad de tipos", () => {
  test("Entero se ensancha a Real", () => {
    assert.deepEqual(errores(prog("Definir x Como Real\nx <- 5\nEscribir x")), []);
  });

  test("Real NO se estrecha a Entero, y sugiere la conversión", () => {
    const m = unicoError(prog("Definir n Como Entero\nn <- 2.5\nEscribir n"));
    assert.match(m, /'n' es un Entero y no puede recibir un Real/);
    assert.match(m, /'Trunc' o 'Redondear'/);
  });

  test("Texto a número sugiere ConvertirANumero", () => {
    const m = unicoError(prog('Definir n Como Real\nn <- "5"\nEscribir n'));
    assert.match(m, /ConvertirANumero/);
  });

  test("número a Texto sugiere ConvertirATexto", () => {
    const m = unicoError(prog("Definir t Como Texto\nt <- 5\nEscribir t"));
    assert.match(m, /ConvertirATexto/);
  });

  test("Caracter se ensancha a Texto pero no al revés", () => {
    assert.deepEqual(
      errores(prog("Definir c Como Caracter\nDefinir t Como Texto\nc <- \"a\"\nt <- c\nEscribir t")),
      [],
    );
    const m = unicoError(prog('Definir c Como Caracter\nDefinir t Como Texto\nt <- "ab"\nc <- t\nEscribir c'));
    assert.match(m, /Subcadena/);
  });

  test("Logico no convierte a nada", () => {
    assert.match(
      unicoError(prog("Definir b Como Logico\nDefinir n Como Entero\nb <- Verdadero\nn <- b\nEscribir n")),
      /'n' es un Entero y no puede recibir un Logico/,
    );
  });
});

describe("operadores", () => {
  test("sumar Texto con número explica la coma de Escribir", () => {
    const m = unicoError(prog('Definir t Como Texto\nt <- "Total: " + 5\nEscribir t'));
    assert.match(m, /no se puede sumar un Texto y un Entero/);
    assert.match(m, /usa una coma en 'Escribir'/);
  });

  test("concatenar dos textos sí funciona", () => {
    assert.deepEqual(
      errores(prog('Definir t Como Texto\nt <- "a" + "b"\nEscribir t')),
      [],
    );
  });

  test("'/' siempre da Real, así que asignarlo a Entero falla", () => {
    const m = unicoError(prog("Definir n Como Entero\nn <- 7 / 2\nEscribir n"));
    assert.match(m, /no puede recibir un Real/);
  });

  test("'DIV' entre enteros da Entero", () => {
    assert.deepEqual(errores(prog("Definir n Como Entero\nn <- 7 DIV 2\nEscribir n")), []);
  });

  test("'DIV' con un Real explica la diferencia con '/'", () => {
    const m = unicoError(prog("Definir n Como Entero\nDefinir r Como Real\nr <- 2.5\nn <- 7 DIV r\nEscribir n"));
    assert.match(m, /'DIV' funciona solo entre enteros/);
    assert.match(m, /Para dividir con decimales usa '\/'/);
  });

  test("'^' siempre da Real", () => {
    assert.match(
      unicoError(prog("Definir n Como Entero\nn <- 2 ^ 3\nEscribir n")),
      /no puede recibir un Real/,
    );
  });

  test("comparar tipos distintos es error", () => {
    assert.match(
      unicoError(prog('Definir n Como Entero\nn <- 1\nSi n = "1" Entonces\nEscribir n\nFinSi')),
      /no se puede comparar un Entero con un Texto/,
    );
  });

  test("ordenar lógicos es error y sugiere '=' o '<>'", () => {
    const m = unicoError(prog("Definir a, b Como Logico\na <- Verdadero\nb <- Falso\nSi a < b Entonces\nEscribir a\nFinSi"));
    assert.match(m, /Verdadero y Falso no se ordenan/);
  });

  test("'Y' con un número sugiere que falta la comparación", () => {
    const m = unicoError(prog("Definir n Como Entero\nn <- 1\nSi n Y Verdadero Entonces\nEscribir n\nFinSi"));
    assert.match(m, /'Y' une condiciones/);
    assert.match(m, /¿Faltó una comparación\?/);
  });

  test("'No' sobre un número es error", () => {
    assert.match(
      unicoError(prog("Definir n Como Entero\nn <- 1\nSi No n Entonces\nEscribir n\nFinSi")),
      /'No' se aplica a Verdadero o Falso/,
    );
  });

  test("un error de tipos no genera cascada", () => {
    // 'a' no existe: debe haber UN error, no uno por cada operación.
    assert.equal(errores(prog("Definir r Como Real\nr <- a * 2 + 3 - 4\nEscribir r")).length, 1);
  });
});

describe("condiciones deben ser Logico", () => {
  test("un Entero como condición sugiere la comparación concreta", () => {
    const m = unicoError(prog("Definir contador Como Entero\ncontador <- 1\nSi contador Entonces\nEscribir contador\nFinSi"));
    assert.match(m, /la condición de un 'Si' tiene que ser Verdadero o Falso/);
    assert.match(m, /'contador <> 0'/);
  });

  test("también en Mientras", () => {
    assert.match(
      unicoError(prog("Definir n Como Entero\nn <- 1\nMientras n Hacer\nn <- n - 1\nFinMientras")),
      /la condición de un 'Mientras'/,
    );
  });

  test("también en Hasta Que", () => {
    assert.match(
      unicoError(prog("Definir n Como Entero\nn <- 1\nRepetir\nn <- n - 1\nHasta Que n")),
      /la condición de un 'Hasta Que'/,
    );
  });
});

describe("arreglos", () => {
  const base = "Definir notas Como Arreglo[10] De Real\nDefinir i Como Entero\ni <- 0\n";

  test("índice Real es error", () => {
    const m = unicoError(prog(base + "Definir r Como Real\nr <- 1.5\nEscribir notas[r]"));
    assert.match(m, /el índice de un arreglo tiene que ser Entero/);
  });

  test("indexar algo que no es arreglo", () => {
    const m = unicoError(prog("Definir x Como Entero\nx <- 1\nEscribir x[0]"));
    assert.match(m, /'x' es un Entero, no un arreglo/);
  });

  test("cantidad de índices equivocada", () => {
    const m = unicoError(prog("Definir tablero Como Arreglo[3, 3] De Entero\nEscribir tablero[1]"));
    assert.match(m, /tiene 2 dimensiones y acá se usan 1 índice/);
    assert.match(m, /tablero\[i1, i2\]/);
  });

  test("tamaño no constante es error", () => {
    const m = unicoError(prog("Definir n Como Entero\nn <- 5\nDefinir a Como Arreglo[n] De Real\nEscribir a[0]"));
    assert.match(m, /tiene que ser un número fijo/);
  });

  test("tamaño constante calculado sí funciona", () => {
    assert.deepEqual(errores(prog("Definir a Como Arreglo[5 * 2] De Real\na[0] <- 1\nEscribir a[0]")), []);
  });

  test("asignar un valor suelto a un arreglo completo", () => {
    const m = unicoError(prog(base + "notas <- 5"));
    assert.match(m, /es un arreglo completo y no puede recibir un solo valor/);
    assert.match(m, /notas\[0\] <- 8\.5/);
  });

  test("'Leer' de un arreglo completo explica el bucle", () => {
    const m = unicoError(prog(base + "Leer notas"));
    assert.match(m, /no puede llenar un arreglo completo/);
    assert.match(m, /Leer notas\[i\]/);
  });

  test("'Escribir' de un arreglo completo sugiere Para Cada", () => {
    assert.match(unicoError(prog(base + "Escribir notas")), /Recorré el arreglo con 'Para Cada'/);
  });

  test("el recorrido canónico no produce errores", () => {
    assert.deepEqual(
      errores(prog(base + "Para i <- 0 Hasta Longitud(notas) - 1 Hacer\nEscribir notas[i]\nFinPara")),
      [],
    );
  });
});

describe("bucle Para", () => {
  test("la variable de control tiene que ser Entero", () => {
    const m = unicoError(prog("Definir x Como Real\nPara x <- 0 Hasta 9 Hacer\nEscribir x\nFinPara"));
    assert.match(m, /la variable de un 'Para' tiene que ser Entero/);
    assert.match(m, /errores de redondeo/);
  });

  test("paso 0 es error antes de ejecutar", () => {
    const m = unicoError(prog("Definir i Como Entero\nPara i <- 0 Hasta 9 Con Paso 0 Hacer\nEscribir i\nFinPara"));
    assert.match(m, /no puede ser 0/);
    assert.match(m, /no termina nunca/);
  });

  test("paso negativo es válido", () => {
    assert.deepEqual(
      errores(prog("Definir i Como Entero\nPara i <- 9 Hasta 0 Con Paso -1 Hacer\nEscribir i\nFinPara")),
      [],
    );
  });

  test("modificar la variable de control avisa, no falla", () => {
    const fuente = prog("Definir i Como Entero\nPara i <- 0 Hasta 9 Hacer\ni <- i + 5\nFinPara");
    assert.deepEqual(errores(fuente), []);
    const a = avisos(fuente);
    assert.ok(a.some((d) => /controla el bucle/.test(d.mensaje)));
  });

  test("un bucle que no usa el contador no genera advertencia de sin uso", () => {
    // El bucle lee 'i' en cada iteración para compararla con el límite.
    const a = avisos(prog('Definir i Como Entero\nPara i <- 0 Hasta 9 Hacer\nEscribir "hola"\nFinPara'));
    assert.deepEqual(a, []);
  });

  test("modificarla FUERA del bucle no avisa", () => {
    const a = avisos(prog("Definir i Como Entero\nPara i <- 0 Hasta 9 Hacer\nEscribir i\nFinPara\ni <- 0"));
    assert.deepEqual(a.filter((d) => /controla el bucle/.test(d.mensaje)), []);
  });
});

describe("Para Cada", () => {
  test("recorrido correcto", () => {
    assert.deepEqual(
      errores(prog(`Definir notas Como Arreglo[10] De Real
Definir nota Como Real
Para Cada nota En notas Hacer
    Escribir nota
FinPara`)),
      [],
    );
  });

  test("tipo de la variable distinto del tipo base", () => {
    const m = unicoError(prog(`Definir notas Como Arreglo[10] De Real
Definir nota Como Entero
Para Cada nota En notas Hacer
    Escribir nota
FinPara`));
    assert.match(m, /'nota' es un Entero pero 'notas' contiene un Real/);
    assert.match(m, /Declara 'nota' Como Real/);
  });

  test("no se puede recorrer algo que no es arreglo", () => {
    assert.match(
      unicoError(prog("Definir x, n Como Entero\nx <- 1\nPara Cada n En x Hacer\nEscribir n\nFinPara")),
      /'Para Cada' recorre arreglos/,
    );
  });

  test("no admite matrices", () => {
    const m = unicoError(prog(`Definir t Como Arreglo[3, 3] De Entero
Definir c Como Entero
Para Cada c En t Hacer
    Escribir c
FinPara`));
    assert.match(m, /solo recorre arreglos de una dimensión/);
    assert.match(m, /'Para' anidados/);
  });
});

describe("Segun", () => {
  test("casos correctos", () => {
    assert.deepEqual(
      errores(prog(`Definir dia Como Entero
dia <- 1
Segun dia Hacer
    1, 2, 3, 4, 5:
        Escribir "Laboral"
    6, 7:
        Escribir "Fin de semana"
    De Otro Modo:
        Escribir "Inválido"
FinSegun`)),
      [],
    );
  });

  test("un Real como sujeto es error", () => {
    const m = unicoError(prog(`Definir r Como Real
r <- 1.5
Segun r Hacer
    1: Escribir "uno"
FinSegun`));
    assert.match(m, /'Segun' compara contra valores fijos/);
    assert.match(m, /Entero, Caracter o Texto/);
  });

  test("un caso de otro tipo que el sujeto", () => {
    const m = unicoError(prog(`Definir d Como Entero
d <- 1
Segun d Hacer
    "a": Escribir "letra"
FinSegun`));
    assert.match(m, /este caso es un Texto pero se compara contra un Entero/);
  });

  test("caso duplicado es error, con la línea del primero", () => {
    const m = unicoError(prog(`Definir d Como Entero
d <- 1
Segun d Hacer
    1: Escribir "a"
    2, 1: Escribir "b"
FinSegun`));
    assert.match(m, /el caso 1 ya apareció en la línea 5/);
    assert.match(m, /nunca se ejecutaría/);
  });
});

describe("subprogramas", () => {
  const funcion = `Funcion doble <- Doble(x Como Entero)
    Definir doble Como Entero
    doble <- x * 2
FinFuncion
`;

  test("llamada correcta", () => {
    assert.deepEqual(
      errores(funcion + prog("Definir n Como Entero\nn <- Doble(5)\nEscribir n")),
      [],
    );
  });

  test("aridad equivocada, y lista los parámetros", () => {
    const m = unicoError(funcion + prog("Definir n Como Entero\nn <- Doble(1, 2)\nEscribir n"));
    assert.match(m, /'Doble' espera 1 argumento y recibió 2/);
    assert.match(m, /Los parámetros son: x/);
  });

  test("tipo de argumento equivocado", () => {
    const m = unicoError(funcion + prog('Definir n Como Entero\nn <- Doble("a")\nEscribir n'));
    assert.match(m, /'x' es un Entero y acá se le pasa un Texto/);
  });

  test("función usada como sentencia", () => {
    const m = unicoError(funcion + prog("Doble(5)"));
    assert.match(m, /es una función: devuelve un valor que acá se descarta/);
  });

  test("procedimiento usado como expresión", () => {
    const m = unicoError(`Procedimiento Saludar()
    Escribir "hola"
FinProcedimiento
` + prog("Definir n Como Entero\nn <- Saludar()\nEscribir n"));
    assert.match(m, /es un procedimiento y no devuelve ningún valor/);
  });

  test("subprograma inexistente, con sugerencia por parecido", () => {
    const m = unicoError(funcion + prog("Definir n Como Entero\nn <- Doblee(5)\nEscribir n"));
    assert.match(m, /no existe ninguna función ni procedimiento llamado 'Doblee'/);
    assert.match(m, /¿Quisiste escribir 'Doble'\?/);
  });

  test("dos subprogramas con el mismo nombre", () => {
    const m = unicoError(`Procedimiento P()
    Escribir 1
FinProcedimiento
Procedimiento P()
    Escribir 2
FinProcedimiento
` + prog("P()"));
    assert.match(m, /ya existe un subprograma llamado 'P'/);
  });

  test("la función que no asigna su variable de retorno es error", () => {
    const m = unicoError(`Funcion r <- F(x Como Entero)
    Definir r Como Entero
    Escribir x
FinFuncion
` + prog("Definir n Como Entero\nn <- F(1)\nEscribir n"));
    assert.match(m, /nunca le asigna un valor a 'r'/);
  });

  test("falta declarar la variable de retorno", () => {
    const m = unicoError(`Funcion r <- F(x Como Entero)
    Escribir x
FinFuncion
` + prog("Definir n Como Entero\nn <- F(1)\nEscribir n"));
    assert.match(m, /falta declarar la variable de retorno 'r'/);
  });

  test("un parámetro sin tipo es error", () => {
    const m = unicoError(`Procedimiento P(x)
    Escribir x
FinProcedimiento
` + prog("P(1)"));
    assert.match(m, /el parámetro 'x' no tiene tipo/);
    assert.match(m, /'x Como Real'/);
  });

  test("no hay variables globales: el subprograma no ve las del principal", () => {
    const m = unicoError(`Procedimiento P()
    Escribir global
FinProcedimiento
` + prog("Definir global Como Entero\nglobal <- 1\nP()"));
    assert.match(m, /'global' no está declarada/);
  });

  test("la recursión está permitida", () => {
    assert.deepEqual(
      errores(`Funcion r <- Factorial(n Como Entero)
    Definir r Como Entero
    Si n <= 1 Entonces
        r <- 1
    SiNo
        r <- n * Factorial(n - 1)
    FinSi
FinFuncion
` + prog("Definir x Como Entero\nx <- Factorial(5)\nEscribir x")),
      [],
    );
  });
});

describe("Por Referencia", () => {
  const proc = `Procedimiento Duplicar(Por Referencia x Como Entero)
    x <- x * 2
FinProcedimiento
`;

  test("pasar una variable funciona", () => {
    assert.deepEqual(errores(proc + prog("Definir n Como Entero\nn <- 5\nDuplicar(n)\nEscribir n")), []);
  });

  test("pasar un cálculo es error", () => {
    const m = unicoError(proc + prog("Definir n Como Entero\nn <- 5\nDuplicar(n + 1)\nEscribir n"));
    assert.match(m, /'Por Referencia', así que acá tiene que ir una variable, no un cálculo/);
  });

  test("pasar un literal es error", () => {
    assert.match(unicoError(proc + prog("Duplicar(5)")), /tiene que ir una variable/);
  });

  test("el tipo tiene que coincidir exacto, sin ensanchar", () => {
    const procReal = `Procedimiento P(Por Referencia x Como Real)
    x <- 1.0
FinProcedimiento
`;
    const m = unicoError(procReal + prog("Definir n Como Entero\nn <- 5\nP(n)\nEscribir n"));
    assert.match(m, /el tipo tiene que ser exactamente el mismo/);
  });

  test("una posición de arreglo sí se puede pasar", () => {
    assert.deepEqual(
      errores(proc + prog("Definir a Como Arreglo[3] De Entero\na[0] <- 1\nDuplicar(a[0])\nEscribir a[0]")),
      [],
    );
  });
});

describe("funciones integradas", () => {
  test("uso correcto", () => {
    assert.deepEqual(
      errores(prog('Definir r Como Real\nDefinir n Como Entero\nr <- Raiz(16)\nn <- Longitud("hola")\nEscribir r, n')),
      [],
    );
  });

  test("'Abs' conserva el tipo del argumento", () => {
    assert.deepEqual(errores(prog("Definir n Como Entero\nn <- Abs(-5)\nEscribir n")), []);
    assert.match(
      unicoError(prog("Definir n Como Entero\nDefinir r Como Real\nr <- -2.5\nn <- Abs(r)\nEscribir n")),
      /no puede recibir un Real/,
    );
  });

  test("'Longitud' también acepta arreglos", () => {
    assert.deepEqual(
      errores(prog("Definir a Como Arreglo[5] De Real\nDefinir n Como Entero\nn <- Longitud(a)\nEscribir n")),
      [],
    );
  });

  test("aridad equivocada muestra cómo se usa", () => {
    const m = unicoError(prog("Definir r Como Real\nr <- Raiz(1, 2)\nEscribir r"));
    assert.match(m, /'Raiz' espera 1 argumento y recibió 2/);
    assert.match(m, /Raiz\(un número\)/);
  });

  test("tipo de argumento equivocado", () => {
    const m = unicoError(prog('Definir r Como Real\nr <- Raiz("hola")\nEscribir r'));
    assert.match(m, /'Raiz' espera un número y acá recibe un Texto/);
  });

  test("'PI' es una constante Real", () => {
    assert.deepEqual(errores(prog("Definir r Como Real\nr <- PI * 2\nEscribir r")), []);
  });

  test("una integrada usada como sentencia es error", () => {
    assert.match(unicoError(prog("Raiz(16)")), /devuelve un valor, así que no puede usarse como una instrucción suelta/);
  });

  test("no se puede declarar una variable con el nombre de una integrada", () => {
    assert.match(
      unicoError(prog("Definir Raiz Como Real\nRaiz <- 1\nEscribir Raiz")),
      /'Raiz' es el nombre de una función integrada/,
    );
  });
});

describe("advertencias", () => {
  test("variable declarada y nunca usada", () => {
    const a = avisos(prog("Definir sobra Como Entero\nEscribir 1"));
    assert.equal(a.length, 1);
    assert.match(a[0]!.mensaje, /declaraste 'sobra' pero nunca la usas/);
    assert.match(a[0]!.sugerencia ?? "", /puedes borrar la declaración/);
  });

  test("variable escrita pero nunca leída", () => {
    const a = avisos(prog("Definir x Como Entero\nx <- 1"));
    assert.match(a[0]!.sugerencia ?? "", /después no la leés/);
  });

  test("los parámetros sin usar no se reportan", () => {
    const a = avisos(`Procedimiento P(x Como Entero)
    Escribir "hola"
FinProcedimiento
` + prog("P(1)"));
    assert.deepEqual(a, []);
  });

  test("'area' y 'área' a la vez avisa", () => {
    const a = avisos(prog("Definir area, área Como Real\narea <- 1\nárea <- 2\nEscribir area, área"));
    assert.equal(a.length, 1);
    assert.match(a[0]!.mensaje, /Son dos variables distintas/);
  });

  test("las advertencias no bloquean nada", () => {
    assert.deepEqual(errores(prog("Definir sobra Como Entero\nEscribir 1")), []);
  });
});

describe("el programa completo de la especificación", () => {
  const fuente = `// Promedio de notas de un grupo, con clasificación.

Funcion promedio <- CalcularPromedio(Por Referencia notas Como Arreglo[30] De Real, cantidad Como Entero)
    Definir suma Como Real
    Definir i Como Entero
    Definir promedio Como Real
    suma <- 0
    Para i <- 0 Hasta cantidad - 1 Hacer
        suma <- suma + notas[i]
    FinPara
    promedio <- suma / cantidad
FinFuncion

Procedimiento Clasificar(nota Como Real)
    Si nota >= 9 Entonces
        Escribir "Excelente"
    SiNo Si nota >= 7 Entonces
        Escribir "Aprobado"
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
        Leer cantidad
    FinMientras

    Para i <- 0 Hasta cantidad - 1 Hacer
        Escribir Sin Salto "Nota del alumno ", i + 1, ": "
        Leer notas[i]
    FinPara

    prom <- CalcularPromedio(notas, cantidad)
    Escribir "Promedio: ", prom
    Clasificar(prom)
Fin`;

  test("no produce ningún error ni advertencia", () => {
    assert.deepEqual(
      revisar(fuente).map((d) => `L${d.linea} ${d.severidad}: ${d.mensaje}`),
      [],
    );
  });
});

describe("Caracter: literales de longitud 1", () => {
  test("un literal de una letra sí cabe", () => {
    assert.deepEqual(errores(prog('Definir c Como Caracter\nc <- "a"\nEscribir c')), []);
  });

  test("un literal más largo no, y dice cuánto mide", () => {
    const m = unicoError(prog('Definir c Como Caracter\nc <- "ab"\nEscribir c'));
    assert.match(m, /Un Caracter guarda una sola letra, y "ab" tiene 2/);
  });

  test("un literal vacío tampoco", () => {
    assert.match(unicoError(prog('Definir c Como Caracter\nc <- ""\nEscribir c')), /está vacío/);
  });

  test("una tilde cuenta como una sola letra", () => {
    assert.deepEqual(errores(prog('Definir c Como Caracter\nc <- "ñ"\nEscribir c')), []);
  });

  test("una variable Texto no cabe: su longitud no se sabe hasta ejecutar", () => {
    const m = unicoError(prog('Definir c Como Caracter\nDefinir t Como Texto\nt <- "a"\nc <- t\nEscribir c'));
    assert.match(m, /Usa 'Subcadena' para tomar una/);
  });

  test("también funciona como argumento y en los casos de 'Segun'", () => {
    assert.deepEqual(
      errores(`Procedimiento P(c Como Caracter)
    Escribir c
FinProcedimiento
` + prog('P("x")')),
      [],
    );
    assert.deepEqual(
      errores(prog(`Definir letra Como Caracter
letra <- "a"
Segun letra Hacer
    "a": Escribir "vocal"
    "b": Escribir "consonante"
FinSegun`)),
      [],
    );
  });
})
