import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { verificar } from "../src/verificador.ts";
import { ejecutar, ejecutarConEntradas, type Evento, type Opciones } from "../src/interprete.ts";

/** Analiza y exige que el programa esté impecable antes de ejecutarlo. */
function compilar(fuente: string) {
  const { tokens, errores: lex } = tokenizar(fuente);
  const { programa, errores: sin } = parsear(tokens);
  assert.deepEqual(
    [...lex, ...sin].map((e) => `L${e.linea}: ${e.mensaje}`),
    [],
    "el programa de prueba tiene errores de sintaxis",
  );
  const sem = verificar(programa).filter((d) => d.severidad === "error");
  assert.deepEqual(
    sem.map((e) => `L${e.linea}: ${e.mensaje}`),
    [],
    "el programa de prueba tiene errores de tipos",
  );
  return programa;
}

/** Ejecuta y devuelve la salida. Falla si el programa aborta. */
function correr(fuente: string, entradas: string[] = [], opciones: Opciones = {}): string {
  const { salida, resultado } = ejecutarConEntradas(compilar(fuente), entradas, opciones);
  if (resultado.clase === "error") {
    assert.fail(`el programa falló: L${resultado.diagnostico.linea} ${resultado.diagnostico.mensaje}`);
  }
  return salida;
}

/** Ejecuta esperando un error de ejecución, y devuelve mensaje + sugerencia. */
function fallo(fuente: string, entradas: string[] = [], opciones: Opciones = {}): string {
  const { resultado } = ejecutarConEntradas(compilar(fuente), entradas, opciones);
  assert.equal(resultado.clase, "error", "se esperaba un error de ejecución");
  if (resultado.clase !== "error") throw new Error("inalcanzable");
  return `L${resultado.diagnostico.linea}: ${resultado.diagnostico.mensaje} ${resultado.diagnostico.sugerencia ?? ""}`;
}

function prog(cuerpo: string): string {
  return `Inicio\n${cuerpo}\nFin`;
}

// ====================================================================

describe("salida y formato", () => {
  test("Entero sin decimales", () => {
    assert.equal(correr(prog("Escribir 42")), "42\n");
  });

  test("Real siempre con al menos un decimal", () => {
    assert.equal(correr(prog("Escribir 4.0")), "4.0\n");
    assert.equal(correr(prog("Escribir 3.5")), "3.5\n");
  });

  test("Logico se escribe Verdadero o Falso", () => {
    assert.equal(correr(prog("Escribir Verdadero, \" \", Falso")), "Verdadero Falso\n");
  });

  test("los textos salen sin comillas", () => {
    assert.equal(correr(prog('Escribir "hola"')), "hola\n");
  });

  test("'Sin Salto' no agrega el fin de línea", () => {
    assert.equal(correr(prog('Escribir Sin Salto "a"\nEscribir "b"')), "ab\n");
  });

  test("las partes se concatenan sin separador", () => {
    assert.equal(
      correr(prog('Definir a Como Real\na <- 15\nEscribir "El área es: ", a')),
      "El área es: 15.0\n",
    );
  });

  test("el ruido del punto flotante no se muestra", () => {
    // 0.1 + 0.2 da 0.30000000000000004 en binario. Mostrar eso enseña IEEE 754,
    // no programación.
    assert.equal(correr(prog("Escribir 0.1 + 0.2")), "0.3\n");
  });

  test("los escapes funcionan", () => {
    assert.equal(correr(prog('Escribir "a\\nb"')), "a\nb\n");
    assert.equal(correr(prog('Escribir "di \\"hola\\""')), 'di "hola"\n');
  });
});

describe("aritmética", () => {
  test("'/' siempre da Real", () => {
    assert.equal(correr(prog("Escribir 7 / 2")), "3.5\n");
    assert.equal(correr(prog("Escribir 4 / 2")), "2.0\n");
  });

  test("'DIV' trunca hacia cero", () => {
    assert.equal(correr(prog("Escribir 7 DIV 2")), "3\n");
    assert.equal(correr(prog("Escribir -7 DIV 2")), "-3\n");
  });

  test("'MOD' toma el signo del dividendo", () => {
    assert.equal(correr(prog("Escribir 7 MOD 3")), "1\n");
    assert.equal(correr(prog("Escribir -7 MOD 3")), "-1\n");
  });

  test("'^' siempre da Real y asocia a la derecha", () => {
    assert.equal(correr(prog("Escribir 2 ^ 3")), "8.0\n");
    assert.equal(correr(prog("Escribir 2 ^ 3 ^ 2")), "512.0\n");
    assert.equal(correr(prog("Escribir 2 ^ -1")), "0.5\n");
  });

  test("Entero + Entero sigue siendo Entero", () => {
    assert.equal(correr(prog("Escribir 2 + 3")), "5\n");
  });

  test("mezclar Entero y Real da Real", () => {
    assert.equal(correr(prog("Escribir 2 + 3.0")), "5.0\n");
  });

  test("concatenación de textos con '+'", () => {
    assert.equal(correr(prog('Escribir "a" + "b"')), "ab\n");
  });

  test("precedencia respetada en ejecución", () => {
    assert.equal(correr(prog("Escribir 1 + 2 * 3")), "7\n");
    assert.equal(correr(prog("Escribir (1 + 2) * 3")), "9\n");
    assert.equal(correr(prog("Escribir -2 ^ 2")), "-4.0\n");
  });
});

describe("errores de ejecución", () => {
  test("división por cero en '/'", () => {
    const m = fallo(prog("Definir d Como Entero\nd <- 0\nEscribir 1 / d"));
    assert.match(m, /L4: división por cero/);
    assert.match(m, /comprobá que el divisor no sea 0/i);
  });

  test("división por cero en 'DIV' y 'MOD'", () => {
    assert.match(fallo(prog("Definir d Como Entero\nd <- 0\nEscribir 1 DIV d")), /'DIV'/);
    assert.match(fallo(prog("Definir d Como Entero\nd <- 0\nEscribir 1 MOD d")), /'MOD'/);
  });

  test("usar una variable sin valor", () => {
    const m = fallo(prog("Definir x Como Entero\nEscribir x"));
    assert.match(m, /L3: 'x' se usa antes de recibir un valor/);
    assert.match(m, /no pone ceros por defecto a propósito/);
  });

  test("raíz de un número negativo", () => {
    assert.match(fallo(prog("Escribir Raiz(-4)")), /número negativo/);
  });

  test("desborde de entero", () => {
    const m = fallo(prog("Definir n Como Entero\nn <- 9000000000000000\nEscribir n * 100"));
    assert.match(m, /demasiado grande/);
  });

  test("el resultado incluye la cuenta de pasos", () => {
    const { resultado } = ejecutarConEntradas(compilar(prog("Escribir 1\nEscribir 2")));
    assert.equal(resultado.clase, "terminado");
    assert.ok(resultado.pasos >= 2);
  });
});

describe("condicionales", () => {
  test("Si / SiNo Si / SiNo elige una sola rama", () => {
    const fuente = (n: string) =>
      prog(`Definir nota Como Real
nota <- ${n}
Si nota >= 9 Entonces
    Escribir "Excelente"
SiNo Si nota >= 7 Entonces
    Escribir "Aprobado"
SiNo
    Escribir "Reprobado"
FinSi`);
    assert.equal(correr(fuente("9.5")), "Excelente\n");
    assert.equal(correr(fuente("7.0")), "Aprobado\n");
    assert.equal(correr(fuente("3.0")), "Reprobado\n");
  });

  test("Segun no cae de un caso al siguiente", () => {
    const fuente = prog(`Definir d Como Entero
d <- 1
Segun d Hacer
    1: Escribir "uno"
    2: Escribir "dos"
    De Otro Modo: Escribir "otro"
FinSegun`);
    assert.equal(correr(fuente), "uno\n");
  });

  test("Segun con varios valores por caso", () => {
    const fuente = (d: string) =>
      prog(`Definir dia Como Entero
dia <- ${d}
Segun dia Hacer
    1, 2, 3, 4, 5: Escribir "Laboral"
    6, 7: Escribir "Fin de semana"
FinSegun`);
    assert.equal(correr(fuente("3")), "Laboral\n");
    assert.equal(correr(fuente("7")), "Fin de semana\n");
  });

  test("Segun cae en 'De Otro Modo' si no coincide nada", () => {
    assert.equal(
      correr(prog(`Definir d Como Entero
d <- 99
Segun d Hacer
    1: Escribir "uno"
    De Otro Modo: Escribir "otro"
FinSegun`)),
      "otro\n",
    );
  });

  test("Segun sin 'De Otro Modo' y sin coincidencia no hace nada", () => {
    assert.equal(
      correr(prog(`Definir d Como Entero
d <- 99
Segun d Hacer
    1: Escribir "uno"
FinSegun
Escribir "fin"`)),
      "fin\n",
    );
  });
});

describe("corto circuito", () => {
  test("'Y' no evalúa el segundo operando si el primero es Falso", () => {
    // Sin corto circuito, notas[5] saldría de rango y el programa fallaría.
    assert.equal(
      correr(prog(`Definir notas Como Arreglo[3] De Entero
Definir i Como Entero
i <- 5
Si i <= 2 Y notas[i] > 0 Entonces
    Escribir "adentro"
SiNo
    Escribir "afuera"
FinSi`)),
      "afuera\n",
    );
  });

  test("'O' no evalúa el segundo si el primero es Verdadero", () => {
    assert.equal(
      correr(prog(`Definir d Como Entero
d <- 0
Si Verdadero O 1 / d > 0 Entonces
    Escribir "ok"
FinSi`)),
      "ok\n",
    );
  });

  test("la búsqueda lineal compacta de la especificación funciona", () => {
    assert.equal(
      correr(prog(`Definir notas Como Arreglo[3] De Entero
Definir i Como Entero
notas[0] <- 5
notas[1] <- 7
notas[2] <- 9
i <- 0
Mientras i <= Longitud(notas) - 1 Y notas[i] <> 7 Hacer
    i <- i + 1
FinMientras
Escribir "encontrado en ", i`)),
      "encontrado en 1\n",
    );
  });
});

describe("bucles", () => {
  test("Mientras con cero iteraciones", () => {
    assert.equal(
      correr(prog('Mientras Falso Hacer\nEscribir "nunca"\nFinMientras\nEscribir "fin"')),
      "fin\n",
    );
  });

  test("Repetir siempre ejecuta al menos una vez", () => {
    assert.equal(
      correr(prog('Repetir\nEscribir "una vez"\nHasta Que Verdadero')),
      "una vez\n",
    );
  });

  test("Para cuenta hacia arriba", () => {
    assert.equal(
      correr(prog('Definir i Como Entero\nPara i <- 0 Hasta 3 Hacer\nEscribir Sin Salto i, " "\nFinPara\nEscribir ""')),
      "0 1 2 3 \n",
    );
  });

  test("Para con paso y con paso negativo", () => {
    assert.equal(
      correr(prog('Definir i Como Entero\nPara i <- 1 Hasta 10 Con Paso 2 Hacer\nEscribir Sin Salto i, " "\nFinPara\nEscribir ""')),
      "1 3 5 7 9 \n",
    );
    assert.equal(
      correr(prog('Definir i Como Entero\nPara i <- 3 Hasta 1 Con Paso -1 Hacer\nEscribir Sin Salto i, " "\nFinPara\nEscribir ""')),
      "3 2 1 \n",
    );
  });

  test("el límite se evalúa UNA sola vez (§8.1)", () => {
    // 'tope' baja a 1 en la primera vuelta, pero el bucle igual da 4 vueltas.
    assert.equal(
      correr(prog(`Definir i, tope, cuenta Como Entero
tope <- 3
cuenta <- 0
Para i <- 0 Hasta tope Hacer
    tope <- 1
    cuenta <- cuenta + 1
FinPara
Escribir cuenta`)),
      "4\n",
    );
  });

  test("la variable de control queda con el último valor tras el bucle", () => {
    assert.equal(
      correr(prog("Definir i Como Entero\nPara i <- 0 Hasta 2 Hacer\nFinPara\nEscribir i")),
      "3\n",
    );
  });

  test("modificar la variable de control dentro del cuerpo sí afecta al bucle", () => {
    assert.equal(
      correr(prog(`Definir i, cuenta Como Entero
cuenta <- 0
Para i <- 0 Hasta 9 Hacer
    cuenta <- cuenta + 1
    i <- i + 4
FinPara
Escribir cuenta`)),
      "2\n",
    );
  });

  test("Para Cada recorre en orden", () => {
    assert.equal(
      correr(prog(`Definir a Como Arreglo[3] De Entero
Definir x Como Entero
a[0] <- 10
a[1] <- 20
a[2] <- 30
Para Cada x En a Hacer
    Escribir Sin Salto x, " "
FinPara
Escribir ""`)),
      "10 20 30 \n",
    );
  });

  test("Para Cada da una copia: modificarla no toca el arreglo (§8.3)", () => {
    assert.equal(
      correr(prog(`Definir a Como Arreglo[2] De Entero
Definir x Como Entero
a[0] <- 1
a[1] <- 2
Para Cada x En a Hacer
    x <- 99
FinPara
Escribir a[0], " ", a[1]`)),
      "1 2\n",
    );
  });

  test("Para Cada sobre un arreglo sin llenar avisa cuál falta", () => {
    assert.match(
      fallo(prog(`Definir a Como Arreglo[2] De Entero
Definir x Como Entero
a[0] <- 1
Para Cada x En a Hacer
    Escribir x
FinPara`)),
      /'a\[1\]' no tiene valor todavía/,
    );
  });
});

describe("arreglos", () => {
  test("los índices van de 0 a n-1", () => {
    assert.equal(
      correr(prog(`Definir a Como Arreglo[3] De Entero
a[0] <- 1
a[2] <- 3
Escribir a[0], " ", a[2]`)),
      "1 3\n",
    );
  });

  test("índice fuera de rango explica el rango real", () => {
    const m = fallo(prog("Definir a Como Arreglo[3] De Entero\na[3] <- 1"));
    assert.match(m, /el índice 3 está fuera del rango 0\.\.2 de 'a'/);
    assert.match(m, /El último es 'a\[2\]'/);
  });

  test("índice negativo también", () => {
    assert.match(
      fallo(prog("Definir a Como Arreglo[3] De Entero\na[-1] <- 1")),
      /el índice -1 está fuera del rango 0\.\.2/,
    );
  });

  test("celda sin asignar es error, no cero", () => {
    assert.match(
      fallo(prog("Definir a Como Arreglo[3] De Entero\nEscribir a[0]")),
      /'a\[0\]' se usa antes de recibir un valor/,
    );
  });

  test("matriz de dos dimensiones", () => {
    assert.equal(
      correr(prog(`Definir m Como Arreglo[2, 3] De Entero
Definir f, c Como Entero
Para f <- 0 Hasta 1 Hacer
    Para c <- 0 Hasta 2 Hacer
        m[f, c] <- f * 10 + c
    FinPara
FinPara
Escribir m[0, 0], " ", m[1, 2]`)),
      "0 12\n",
    );
  });

  test("fuera de rango en una matriz dice qué dimensión", () => {
    assert.match(
      fallo(prog("Definir m Como Arreglo[2, 3] De Entero\nm[0, 5] <- 1")),
      /en la dimensión 2/,
    );
  });

  test("'Longitud' de un arreglo", () => {
    assert.equal(
      correr(prog("Definir a Como Arreglo[7] De Real\nEscribir Longitud(a)")),
      "7\n",
    );
  });
});

describe("entrada", () => {
  test("Leer un Entero", () => {
    assert.equal(
      correr(prog("Definir n Como Entero\nLeer n\nEscribir n * 2"), ["21"]),
      "42\n",
    );
  });

  test("Leer un Real acepta punto y coma decimal", () => {
    assert.equal(correr(prog("Definir r Como Real\nLeer r\nEscribir r"), ["3.5"]), "3.5\n");
    assert.equal(correr(prog("Definir r Como Real\nLeer r\nEscribir r"), ["3,5"]), "3.5\n");
  });

  test("Leer un Texto toma la línea completa", () => {
    assert.equal(
      correr(prog("Definir t Como Texto\nLeer t\nEscribir t"), ["hola mundo"]),
      "hola mundo\n",
    );
  });

  test("Leer un Logico acepta varias formas", () => {
    for (const entrada of ["Verdadero", "verdadero", "V", "si", "1"]) {
      assert.equal(
        correr(prog("Definir b Como Logico\nLeer b\nEscribir b"), [entrada]),
        "Verdadero\n",
        `falló con ${entrada}`,
      );
    }
    for (const entrada of ["Falso", "F", "no", "0"]) {
      assert.equal(
        correr(prog("Definir b Como Logico\nLeer b\nEscribir b"), [entrada]),
        "Falso\n",
        `falló con ${entrada}`,
      );
    }
  });

  test("Leer varias variables en una línea", () => {
    assert.equal(
      correr(prog("Definir a, b Como Entero\nLeer a, b\nEscribir a + b"), ["3", "4"]),
      "7\n",
    );
  });

  test("una entrada inválida se vuelve a pedir, no aborta (§6.2)", () => {
    const { salida, resultado, pedidos } = ejecutarConEntradas(
      compilar(prog("Definir n Como Entero\nLeer n\nEscribir n")),
      ["veinte", "no", "20"],
    );
    assert.equal(resultado.clase, "terminado");
    assert.equal(salida, "20\n");
    assert.equal(pedidos, 3);
  });

  test("el reintento explica el problema", () => {
    const gen = ejecutar(compilar(prog("Definir n Como Entero\nLeer n\nEscribir n")));
    let paso = gen.next();
    assert.equal(paso.value && (paso.value as Evento).clase, "entrada");
    paso = gen.next("veinte");
    const evento = paso.value as Evento;
    assert.equal(evento.clase, "entrada");
    if (evento.clase !== "entrada") throw new Error("inalcanzable");
    assert.match(evento.reintento ?? "", /'n' es Entero, pero se ingresó "veinte"/);
    assert.match(evento.reintento ?? "", /Intentá de nuevo/);
  });

  test("si se agota la entrada, el error lo dice", () => {
    assert.match(
      fallo(prog("Definir n Como Entero\nLeer n\nEscribir n"), []),
      /se terminó la entrada/,
    );
  });

  test("Leer una posición de arreglo", () => {
    assert.equal(
      correr(prog("Definir a Como Arreglo[2] De Entero\nLeer a[0]\nEscribir a[0]"), ["5"]),
      "5\n",
    );
  });
});

describe("subprogramas", () => {
  const doble = `Funcion r <- Doble(x Como Entero)
    Definir r Como Entero
    r <- x * 2
FinFuncion
`;

  test("función con valor de retorno", () => {
    assert.equal(correr(doble + prog("Escribir Doble(21)")), "42\n");
  });

  test("procedimiento", () => {
    assert.equal(
      correr(`Procedimiento Saludar(n Como Texto)
    Escribir "Hola, ", n
FinProcedimiento
` + prog('Saludar("Ana")')),
      "Hola, Ana\n",
    );
  });

  test("los parámetros van por valor: el original no cambia", () => {
    assert.equal(
      correr(`Procedimiento Cambiar(x Como Entero)
    x <- 99
FinProcedimiento
` + prog("Definir n Como Entero\nn <- 1\nCambiar(n)\nEscribir n")),
      "1\n",
    );
  });

  test("'Por Referencia' sí modifica el original", () => {
    assert.equal(
      correr(`Procedimiento Duplicar(Por Referencia x Como Entero)
    x <- x * 2
FinProcedimiento
` + prog("Definir n Como Entero\nn <- 21\nDuplicar(n)\nEscribir n")),
      "42\n",
    );
  });

  test("el intercambio clásico por referencia", () => {
    assert.equal(
      correr(`Procedimiento Intercambiar(Por Referencia a Como Entero, Por Referencia b Como Entero)
    Definir temporal Como Entero
    temporal <- a
    a <- b
    b <- temporal
FinProcedimiento
` + prog("Definir x, y2 Como Entero\nx <- 1\ny2 <- 2\nIntercambiar(x, y2)\nEscribir x, \" \", y2")),
      "2 1\n",
    );
  });

  test("una posición de arreglo por referencia se escribe de vuelta", () => {
    assert.equal(
      correr(`Procedimiento Duplicar(Por Referencia x Como Entero)
    x <- x * 2
FinProcedimiento
` + prog("Definir a Como Arreglo[2] De Entero\na[1] <- 21\nDuplicar(a[1])\nEscribir a[1]")),
      "42\n",
    );
  });

  test("los arreglos van por valor: se copian (§9.1)", () => {
    assert.equal(
      correr(`Procedimiento Ensuciar(a Como Arreglo[2] De Entero)
    a[0] <- 99
FinProcedimiento
` + prog("Definir b Como Arreglo[2] De Entero\nb[0] <- 1\nb[1] <- 2\nEnsuciar(b)\nEscribir b[0]")),
      "1\n",
    );
  });

  test("un arreglo 'Por Referencia' sí se modifica", () => {
    assert.equal(
      correr(`Procedimiento Llenar(Por Referencia a Como Arreglo[2] De Entero)
    a[0] <- 7
FinProcedimiento
` + prog("Definir b Como Arreglo[2] De Entero\nLlenar(b)\nEscribir b[0]")),
      "7\n",
    );
  });

  test("no hay variables globales: cada llamada tiene su propio ámbito", () => {
    assert.equal(
      correr(`Procedimiento P()
    Definir x Como Entero
    x <- 99
FinProcedimiento
` + prog("Definir x Como Entero\nx <- 1\nP()\nEscribir x")),
      "1\n",
    );
  });

  test("recursión: factorial", () => {
    assert.equal(
      correr(`Funcion r <- Factorial(n Como Entero)
    Definir r Como Entero
    Si n <= 1 Entonces
        r <- 1
    SiNo
        r <- n * Factorial(n - 1)
    FinSi
FinFuncion
` + prog("Escribir Factorial(6)")),
      "720\n",
    );
  });

  test("recursión: Fibonacci", () => {
    assert.equal(
      correr(`Funcion r <- Fib(n Como Entero)
    Definir r Como Entero
    Si n < 2 Entonces
        r <- n
    SiNo
        r <- Fib(n - 1) + Fib(n - 2)
    FinSi
FinFuncion
` + prog("Escribir Fib(12)")),
      "144\n",
    );
  });

  test("recursión sin caso base: el error nombra la función", () => {
    const m = fallo(`Funcion r <- Infinita(n Como Entero)
    Definir r Como Entero
    r <- Infinita(n + 1)
FinFuncion
` + prog("Escribir Infinita(1)"));
    assert.match(m, /demasiadas llamadas anidadas/);
    assert.match(m, /'Infinita' se llama a sí misma sin un caso base/);
  });

  test("'Retornar' con valor sale antes", () => {
    assert.equal(
      correr(`Funcion r <- Signo(n Como Entero)
    Definir r Como Entero
    Si n < 0 Entonces
        Retornar -1
    FinSi
    r <- 1
FinFuncion
` + prog("Escribir Signo(-5), \" \", Signo(5)")),
      "-1 1\n",
    );
  });

  test("'Retornar' en un procedimiento sale antes", () => {
    assert.equal(
      correr(`Procedimiento P(n Como Entero)
    Si n = 0 Entonces
        Retornar
    FinSi
    Escribir "sigue"
FinProcedimiento
` + prog("P(0)\nEscribir \"fin\"")),
      "fin\n",
    );
  });

  test("una llamada dentro de otra llamada", () => {
    assert.equal(correr(doble + prog("Escribir Doble(Doble(3))")), "12\n");
  });

  test("'Leer' dentro de una función llamada dentro de una expresión", () => {
    // Esta es la razón por la que TODO el evaluador es generador.
    assert.equal(
      correr(`Funcion r <- Pedir()
    Definir r Como Entero
    Leer r
FinFuncion
` + prog("Escribir Pedir() + Pedir()"), ["10", "32"]),
      "42\n",
    );
  });
});

describe("bucles infinitos", () => {
  test("se detiene y culpa al bucle correcto", () => {
    const m = fallo(
      prog('Definir i Como Entero\ni <- 0\nMientras Verdadero Hacer\ni <- i + 1\nFinMientras'),
      [],
      { limitePasos: 5000 },
    );
    assert.match(m, /L4: el programa lleva 5000 pasos sin terminar/);
    assert.match(m, /Probablemente hay un bucle infinito/);
    assert.match(m, /El 'Mientras' de la línea 4 se repitió/);
  });

  test("con bucles anidados culpa al que más se repitió", () => {
    const m = fallo(
      prog(`Definir i, j Como Entero
Para i <- 0 Hasta 2 Hacer
    j <- 0
    Mientras Verdadero Hacer
        j <- j + 1
    FinMientras
FinPara`),
      [],
      { limitePasos: 5000 },
    );
    assert.match(m, /El 'Mientras' de la línea 5/);
  });

  test("un programa normal no lo dispara", () => {
    assert.equal(
      correr(prog("Definir i, s Como Entero\ns <- 0\nPara i <- 0 Hasta 99 Hacer\ns <- s + i\nFinPara\nEscribir s"), [], { limitePasos: 5000 }),
      "4950\n",
    );
  });
});

describe("funciones integradas", () => {
  const casos: Array<[string, string]> = [
    ["Raiz(16)", "4.0"],
    ["Abs(-5)", "5"],
    ["Abs(-2.5)", "2.5"],
    ["Trunc(3.9)", "3"],
    ["Trunc(-3.9)", "-3"],
    ["Redondear(3.5)", "4"],
    ["Redondear(3.4)", "3"],
    ["Techo(3.1)", "4"],
    ["Piso(3.9)", "3"],
    ["Potencia(2, 10)", "1024.0"],
    ['Longitud("hola")', "4"],
    ['Longitud("añó")', "3"],
    ['Subcadena("hola", 0, 1)', "ho"],
    ['Subcadena("hola", 3, 3)', "a"],
    ['Mayusculas("añó")', "AÑÓ"],
    ['Minusculas("AÑÓ")', "añó"],
    ['ConvertirANumero("3.5")', "3.5"],
    ['ConvertirANumero("3,5")', "3.5"],
    ["ConvertirATexto(42)", "42"],
    ['Concatenar("a", "b")', "ab"],
    ["ln(1)", "0.0"],
    ["exp(0)", "1.0"],
  ];

  for (const [expresion, esperado] of casos) {
    test(`${expresion} → ${esperado}`, () => {
      assert.equal(correr(prog(`Escribir ${expresion}`)), esperado + "\n");
    });
  }

  test("'PI' es la constante", () => {
    assert.equal(correr(prog("Escribir Redondear(PI * 100)")), "314\n");
  });

  test("'Aleatorio' cae dentro del rango, inclusive", () => {
    const salida = correr(prog(`Definir i, v Como Entero
Para i <- 0 Hasta 199 Hacer
    v <- Aleatorio(1, 3)
    Si v < 1 O v > 3 Entonces
        Escribir "FUERA"
    FinSi
FinPara
Escribir "ok"`));
    assert.equal(salida, "ok\n");
  });

  test("'Aleatorio' con el rango invertido avisa", () => {
    assert.match(fallo(prog("Escribir Aleatorio(5, 1)")), /Escribe 'Aleatorio\(1, 5\)'/);
  });

  test("'Subcadena' fuera del texto", () => {
    assert.match(fallo(prog('Escribir Subcadena("hola", 0, 9)')), /posición final 9 no es válida/);
  });

  test("'ConvertirANumero' con basura", () => {
    assert.match(fallo(prog('Escribir ConvertirANumero("hola")')), /no se puede convertir a número/);
  });

  test("'ln' de cero o negativo", () => {
    assert.match(fallo(prog("Escribir ln(0)")), /solo existe para números mayores que 0/);
  });
});

describe("comparación de textos", () => {
  test("se ordenan según el alfabeto castellano, no por código", () => {
    // Por código de carácter, "á" (U+00E1) sería mayor que "b".
    assert.equal(correr(prog('Escribir "álamo" < "banco"')), "Verdadero\n");
    assert.equal(correr(prog('Escribir "ñandú" < "orca"')), "Verdadero\n");
  });

  test("igualdad de textos", () => {
    assert.equal(correr(prog('Escribir "a" = "a", " ", "a" = "b"')), "Verdadero Falso\n");
  });
});

describe("ejecución paso a paso", () => {
  test("emite un evento por sentencia con las variables", () => {
    const gen = ejecutar(compilar(prog("Definir x Como Entero\nx <- 5\nEscribir x")), {
      pasoAPaso: true,
    });
    const pasos: Array<{ linea: number; variables: unknown }> = [];
    let r = gen.next();
    while (!r.done) {
      const e = r.value;
      if (e.clase === "paso") pasos.push({ linea: e.pos.linea, variables: e.variables });
      r = gen.next(undefined);
    }
    assert.deepEqual(pasos.map((p) => p.linea), [2, 3, 4]);
  });

  test("la instantánea muestra las variables sin valor como null", () => {
    const gen = ejecutar(compilar(prog("Definir x Como Entero\nx <- 5")), { pasoAPaso: true });
    let r = gen.next();
    const vistos: Array<Array<{ nombre: string; valor: string | null }>> = [];
    while (!r.done) {
      if (r.value.clase === "paso") vistos.push(r.value.variables);
      r = gen.next(undefined);
    }
    // Antes de la asignación (segundo paso) 'x' existe pero está sin valor.
    assert.deepEqual(vistos[1], [{ nombre: "x", tipo: "Entero", valor: null }]);
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

  test("corre de punta a punta", () => {
    const salida = correr(fuente, ["3", "8", "9", "10"]);
    assert.match(salida, /¿Cuántos alumnos\? /);
    assert.match(salida, /Nota del alumno 1: /);
    assert.match(salida, /Nota del alumno 3: /);
    assert.match(salida, /Promedio: 9\.0/);
    assert.match(salida, /Excelente/);
  });

  test("valida la entrada y vuelve a pedir", () => {
    const salida = correr(fuente, ["99", "0", "1", "5"]);
    assert.equal(salida.match(/Debe estar entre 1 y 30\./g)?.length, 2);
    assert.match(salida, /Promedio: 5\.0/);
    assert.match(salida, /Reprobado/);
  });
});
