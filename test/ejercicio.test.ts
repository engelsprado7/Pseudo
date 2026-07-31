import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { verificar as verificarTipos } from "../src/verificador.ts";
import {
  comparar,
  escribirEjercicio,
  explicar,
  leerEjercicio,
  verificarSolucion,
  type Ejercicio,
} from "../src/ejercicio.ts";

const RAIZ = new URL("..", import.meta.url).pathname;

function compilar(fuente: string) {
  const { tokens, errores: lex } = tokenizar(fuente);
  const { programa, errores: sin } = parsear(tokens);
  const sem = verificarTipos(programa).filter((d) => d.severidad === "error");
  assert.deepEqual(
    [...lex, ...sin, ...sem].map((e) => `L${e.linea}: ${e.mensaje}`),
    [],
    "la solución de prueba no compila",
  );
  return programa;
}

function ejercicioDe(texto: string): Ejercicio {
  const leido = leerEjercicio(texto);
  if (!leido.ok) {
    assert.fail(`el ejercicio no se pudo leer: ${leido.errores.map((e) => e.mensaje).join(" | ")}`);
  }
  return leido.ejercicio;
}

const F = "```"; // para no cerrar los bloques de este archivo por accidente

// ====================================================================

describe("lectura del formato", () => {
  const basico = `# Sumar dos números

Leé dos enteros y escribí la suma.

## Caso: positivos

${F}entrada
2
3
${F}

${F}salida
5
${F}
`;

  test("título, enunciado y caso", () => {
    const e = ejercicioDe(basico);
    assert.equal(e.titulo, "Sumar dos números");
    assert.match(e.enunciado, /Leé dos enteros/);
    assert.equal(e.casos.length, 1);
    assert.deepEqual(e.casos[0]!.entrada, ["2", "3"]);
    assert.equal(e.casos[0]!.salidaEsperada, "5");
  });

  test("el modo predeterminado es normalizada", () => {
    assert.equal(ejercicioDe(basico).comparacion, "normalizada");
    assert.equal(ejercicioDe(basico).decimales, null);
  });

  test("acepta 'Comparación:' con y sin tilde", () => {
    for (const linea of ["Comparación: exacta", "Comparacion: exacta", "COMPARACIÓN: Exacta"]) {
      assert.equal(ejercicioDe(basico.replace("Leé dos enteros y escribí la suma.", linea)).comparacion, "exacta");
    }
  });

  test("acepta 'Decimales: N'", () => {
    const e = ejercicioDe(basico.replace("Leé dos enteros y escribí la suma.", "Decimales: 2"));
    assert.equal(e.decimales, 2);
  });

  test("'## Caso:' es opcional: '## nombre' alcanza", () => {
    const e = ejercicioDe(basico.replace("## Caso: positivos", "## positivos"));
    assert.equal(e.casos[0]!.nombre, "positivos");
  });

  test("varios casos en orden", () => {
    const e = ejercicioDe(`# T

## Caso: uno

${F}entrada
1
${F}

${F}salida
1
${F}

## Caso: dos

${F}entrada
2
${F}

${F}salida
2
${F}
`);
    assert.deepEqual(e.casos.map((c) => c.nombre), ["uno", "dos"]);
  });

  test("la entrada preserva el texto tal cual, incluidos espacios internos", () => {
    const e = ejercicioDe(`# T

## Caso: c

${F}entrada
hola mundo
${F}

${F}salida
hola mundo
${F}
`);
    assert.deepEqual(e.casos[0]!.entrada, ["hola mundo"]);
  });

  test("un bloque sin etiqueta en el enunciado se conserva como ejemplo", () => {
    const e = ejercicioDe(`# T

Formato:

${F}
n x 1 = n
${F}

## Caso: c

${F}entrada
1
${F}

${F}salida
1
${F}
`);
    assert.match(e.enunciado, /n x 1 = n/);
  });
});

describe("escritura del formato", () => {
  test("lo escrito se vuelve a leer igual", () => {
    const original = {
      titulo: "Área de un círculo",
      enunciado: "Leé el radio y escribí el área.\n\nUsá PI.",
      comparacion: "contiene" as const,
      decimales: 2,
      casos: [
        { nombre: "radio 1", entrada: ["1"], salidaEsperada: "El área es: 3.14" },
        { nombre: "radio 0", entrada: ["0"], salidaEsperada: "El área es: 0.00" },
      ],
    };

    const leido = leerEjercicio(escribirEjercicio(original));
    assert.ok(leido.ok, "el .md generado tiene que ser válido");
    assert.equal(leido.ejercicio.titulo, original.titulo);
    assert.equal(leido.ejercicio.enunciado, original.enunciado);
    assert.equal(leido.ejercicio.comparacion, "contiene");
    assert.equal(leido.ejercicio.decimales, 2);
    assert.deepEqual(leido.ejercicio.casos, original.casos);
  });

  test("un ejercicio de solo enunciado también da un .md válido", () => {
    const leido = leerEjercicio(
      escribirEjercicio({ titulo: "Problema abierto", enunciado: "Resolvelo.", casos: [] }),
    );
    assert.ok(leido.ok);
    assert.equal(leido.ejercicio.casos.length, 0);
  });

  test("un ``` en el texto no parte el archivo", () => {
    const leido = leerEjercicio(
      escribirEjercicio({
        titulo: "Con cercas",
        enunciado: "No escribas ``` acá.",
        casos: [{ nombre: "c", entrada: ["1"], salidaEsperada: "1" }],
      }),
    );
    assert.ok(leido.ok, "el ``` del texto no puede romper el formato");
    assert.equal(leido.ejercicio.casos.length, 1);
  });
});

describe("errores de formato del ejercicio", () => {
  function errores(texto: string): string[] {
    const leido = leerEjercicio(texto);
    assert.equal(leido.ok, false, "se esperaba que el formato fallara");
    if (leido.ok) throw new Error("inalcanzable");
    return leido.errores.map((e) => e.mensaje);
  }

  test("sin título", () => {
    assert.ok(errores(`## Caso: c\n\n${F}entrada\n1\n${F}\n\n${F}salida\n1\n${F}\n`).some((m) => /falta el título/.test(m)));
  });

  test("sin casos es válido: es un problema para resolver a mano", () => {
    const leido = leerEjercicio("# Solo título\n\nUn enunciado.\n");
    assert.ok(leido.ok);
    assert.equal(leido.ejercicio.casos.length, 0);
    assert.equal(leido.ejercicio.enunciado, "Un enunciado.");
  });

  test("caso sin bloque de salida", () => {
    assert.ok(
      errores(`# T\n\n## Caso: c\n\n${F}entrada\n1\n${F}\n`).some((m) => /le falta el bloque de salida/.test(m)),
    );
  });

  test("caso sin bloque de entrada", () => {
    assert.ok(
      errores(`# T\n\n## Caso: c\n\n${F}salida\n1\n${F}\n`).some((m) => /le falta el bloque de entrada/.test(m)),
    );
  });

  test("bloque de entrada fuera de todo caso", () => {
    assert.ok(
      errores(`# T\n\n${F}entrada\n1\n${F}\n`).some((m) => /fuera de todo caso/.test(m)),
    );
  });

  test("modo de comparación inválido, y lista los válidos", () => {
    const m = errores(`# T\n\nComparación: aproximada\n\n## Caso: c\n\n${F}entrada\n1\n${F}\n\n${F}salida\n1\n${F}\n`);
    assert.ok(m.some((x) => /no es un modo de comparación/.test(x)));
    assert.ok(m.some((x) => /exacta, normalizada, flexible, contiene/.test(x)));
  });

  test("decimales inválidos", () => {
    assert.ok(
      errores(`# T\n\nDecimales: dos\n\n## Caso: c\n\n${F}entrada\n1\n${F}\n\n${F}salida\n1\n${F}\n`).some(
        (m) => /entero entre 0 y 15/.test(m),
      ),
    );
  });

  test("bloque sin cerrar", () => {
    assert.ok(
      errores(`# T\n\n## Caso: c\n\n${F}entrada\n1\n`).some((m) => /nunca se cierra/.test(m)),
    );
  });

  test("dos títulos", () => {
    assert.ok(
      errores(`# Uno\n\n# Dos\n\n## Caso: c\n\n${F}entrada\n1\n${F}\n\n${F}salida\n1\n${F}\n`).some(
        (m) => /más de un título/.test(m),
      ),
    );
  });
});

describe("modos de comparación", () => {
  test("el salto de línea final no cuenta como línea vacía", () => {
    // Todo 'Escribir' termina en salto. Sin esto, el modo exacto sería inservible.
    assert.ok(comparar("9", "9\n", "exacta", null).coincide);
    assert.ok(comparar("9\n", "9\n", "exacta", null).coincide);
  });

  test("exacta no perdona espacios ni mayúsculas", () => {
    assert.ok(!comparar("9", "9 \n", "exacta", null).coincide);
    assert.ok(!comparar("Hola", "hola\n", "exacta", null).coincide);
  });

  test("normalizada perdona espacios al final y líneas vacías sobrantes", () => {
    assert.ok(comparar("9", "9   \n\n\n", "normalizada", null).coincide);
    assert.ok(!comparar("Hola", "hola\n", "normalizada", null).coincide);
    assert.ok(!comparar("a b", "a  b\n", "normalizada", null).coincide);
  });

  test("flexible perdona mayúsculas y espacios internos", () => {
    assert.ok(comparar("Hola Mundo", "hola   mundo\n", "flexible", null).coincide);
    assert.ok(!comparar("Hola", "chau\n", "flexible", null).coincide);
  });

  test("contiene ignora los mensajes que el alumno agregue", () => {
    const esperado = "El área es: 15.0";
    const obtenido = "Base: Altura: El área es: 15.0\n";
    assert.ok(comparar(esperado, obtenido, "contiene", null).coincide);
  });

  test("contiene exige el orden", () => {
    assert.ok(comparar("a\nb", "x a y\nz b w\n", "contiene", null).coincide);
    assert.ok(!comparar("a\nb", "z b w\nx a y\n", "contiene", null).coincide);
  });

  test("contiene falla si falta alguna línea", () => {
    const c = comparar("a\nb", "x a y\n", "contiene", null);
    assert.equal(c.coincide, false);
    assert.equal(c.primeraDiferencia, 1);
  });

  test("decimales tolera diferencias de redondeo", () => {
    assert.ok(comparar("8.67", "8.666666666\n", "normalizada", 2).coincide);
    assert.ok(!comparar("8.67", "8.6\n", "normalizada", 2).coincide);
    assert.ok(comparar("Promedio: 9.00", "Promedio: 9.0\n", "normalizada", 2).coincide);
  });

  test("decimales no toca los enteros", () => {
    assert.ok(comparar("15", "15\n", "normalizada", 2).coincide);
  });
});

describe("verificación de soluciones", () => {
  test("un ejercicio sin casos no se da por aprobado", () => {
    const sinCasos = ejercicioDe("# Problema abierto\n\nEscribí lo que quieras.\n");
    const resultado = verificarSolucion(compilar("Inicio\n    Escribir 1\nFin"), sinCasos);
    assert.equal(resultado.total, 0);
    assert.equal(resultado.aprobado, false, "0 de 0 no es aprobado: no se corrió nada");
  });

  const ejercicio = ejercicioDe(`# Suma

Comparación: exacta

## Caso: dos y tres

${F}entrada
2
3
${F}

${F}salida
5
${F}

## Caso: negativos

${F}entrada
-4
1
${F}

${F}salida
-3
${F}
`);

  const buena = `Inicio
    Definir a, b Como Entero
    Leer a
    Leer b
    Escribir a + b
Fin`;

  test("una solución correcta aprueba todos los casos", () => {
    const r = verificarSolucion(compilar(buena), ejercicio);
    assert.equal(r.aprobado, true);
    assert.equal(r.aprobados, 2);
    assert.ok(r.casos.every((c) => c.estado === "bien"));
  });

  test("una solución equivocada dice qué línea difiere", () => {
    const mala = buena.replace("a + b", "a - b");
    const r = verificarSolucion(compilar(mala), ejercicio);
    assert.equal(r.aprobado, false);
    assert.equal(r.aprobados, 0);
    assert.equal(r.casos[0]!.estado, "salida-distinta");
    assert.match(explicar(r.casos[0]!), /se esperaba «5» y tu programa escribió «-1»/);
  });

  test("los casos son independientes: uno puede pasar y otro no", () => {
    // Devuelve 5 fijo: pasa el primer caso, falla el segundo.
    const parcial = `Inicio
    Definir a, b Como Entero
    Leer a
    Leer b
    Escribir 5
Fin`;
    const r = verificarSolucion(compilar(parcial), ejercicio);
    assert.equal(r.aprobados, 1);
    assert.deepEqual(r.casos.map((c) => c.estado), ["bien", "salida-distinta"]);
  });

  test("si pide más valores de los que hay, lo dice", () => {
    const pideDemas = `Inicio
    Definir a, b, c Como Entero
    Leer a
    Leer b
    Leer c
    Escribir a + b + c
Fin`;
    const r = verificarSolucion(compilar(pideDemas), ejercicio);
    assert.equal(r.casos[0]!.estado, "sin-entrada");
    const m = explicar(r.casos[0]!);
    assert.match(m, /pidió 3 valores y este caso trae 2/);
    assert.match(m, /un 'Leer' de más/);
  });

  test("un error de ejecución se reporta con su línea", () => {
    const rompe = `Inicio
    Definir a, b Como Entero
    Leer a
    Leer b
    Escribir a DIV (b - b)
Fin`;
    const r = verificarSolucion(compilar(rompe), ejercicio);
    assert.equal(r.casos[0]!.estado, "error");
    assert.match(explicar(r.casos[0]!), /se detuvo en la línea 5.*división por cero/);
  });

  test("un bucle infinito no cuelga la verificación", () => {
    const cuelga = `Inicio
    Definir a, b Como Entero
    Leer a
    Leer b
    Mientras Verdadero Hacer
        a <- a + 1
    FinMientras
Fin`;
    const r = verificarSolucion(compilar(cuelga), ejercicio, { limitePasos: 5000 });
    assert.equal(r.casos[0]!.estado, "error");
    assert.match(explicar(r.casos[0]!), /bucle infinito/);
  });

  test("no escribir nada, faltar salida y sobrar salida se distinguen", () => {
    const muda = `Inicio
    Definir a, b Como Entero
    Leer a
    Leer b
Fin`;
    assert.match(
      explicar(verificarSolucion(compilar(muda), ejercicio).casos[0]!),
      /Tu programa no escribió nada/,
    );

    const corta = `Inicio
    Definir a, b Como Entero
    Leer a
    Leer b
    Escribir a + b
Fin`;
    const dosLineas = ejercicioDe(`# Suma

## Caso: dos y tres

${F}entrada
2
3
${F}

${F}salida
5
listo
${F}
`);
    assert.match(
      explicar(verificarSolucion(compilar(corta), dosLineas).casos[0]!),
      /Falta salida\. En la línea 2/,
    );

    const charlatana = `Inicio
    Definir a, b Como Entero
    Leer a
    Leer b
    Escribir a + b
    Escribir "listo"
Fin`;
    assert.match(
      explicar(verificarSolucion(compilar(charlatana), ejercicio).casos[0]!),
      /Sobra salida/,
    );
  });

  test("un ejercicio mal armado se distingue de una solución mala", () => {
    // El caso da un texto donde el programa lee un Entero: culpa del docente.
    const roto = ejercicioDe(`# Suma

## Caso: entrada inválida

${F}entrada
dos
${F}

${F}salida
2
${F}
`);
    const r = verificarSolucion(compilar(buena), roto);
    assert.equal(r.casos[0]!.estado, "entrada-rechazada");
    const m = explicar(r.casos[0]!);
    assert.match(m, /El ejercicio está mal armado/);
    assert.match(m, /Revisá el bloque de entrada/);
  });
});

describe("los ejercicios y soluciones del repositorio", () => {
  const archivos = readdirSync(join(RAIZ, "ejercicios")).filter((f) => f.endsWith(".md")).sort();

  test("hay ejercicios", () => {
    assert.ok(archivos.length >= 4, `solo hay ${archivos.length}`);
  });

  for (const archivo of archivos) {
    describe(archivo, () => {
      const texto = readFileSync(join(RAIZ, "ejercicios", archivo), "utf8");

      test("el formato es válido", () => {
        const leido = leerEjercicio(texto);
        if (!leido.ok) {
          assert.fail(leido.errores.map((e) => `línea ${e.linea}: ${e.mensaje}`).join("\n"));
        }
        assert.ok(leido.ejercicio.casos.length >= 2, "conviene tener al menos dos casos");
      });

      test("la solución de referencia aprueba todos los casos", () => {
        const ejercicio = ejercicioDe(texto);
        const rutaSolucion = join(RAIZ, "soluciones", archivo.replace(/\.md$/, ".psc"));
        const programa = compilar(readFileSync(rutaSolucion, "utf8"));
        const r = verificarSolucion(programa, ejercicio);
        assert.deepEqual(
          r.casos.filter((c) => c.estado !== "bien").map((c) => `${c.nombre}: ${explicar(c)}`),
          [],
        );
      });
    });
  }
});
