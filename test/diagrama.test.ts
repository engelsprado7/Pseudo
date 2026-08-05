/**
 * Pruebas del diagrama de flujo.
 *
 * El SVG es texto, así que se puede comprobar de verdad sin navegador: que
 * aparezcan las formas correctas, que las etiquetas digan lo que tienen que
 * decir, y —lo más importante— que nada quede fuera del lienzo ni encimado.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { diagramasDe, expresionATexto } from "../src/diagrama.ts";
import type { Expr } from "../src/ast.ts";

function programaDe(fuente: string) {
  const { tokens, errores: lex } = tokenizar(fuente);
  assert.deepEqual(lex, [], "el fuente de la prueba no debe tener errores léxicos");
  const { programa, errores } = parsear(tokens);
  assert.deepEqual(errores, [], "el fuente de la prueba no debe tener errores de sintaxis");
  return programa;
}

/** Primer diagrama (el principal) de un fuente. */
function svgDe(fuente: string): string {
  return diagramasDe(programaDe(fuente))[0]!.svg;
}

/** Extrae la expresión de la primera asignación, para probar el impresor. */
function primeraAsignacion(fuente: string): Expr {
  const p = programaDe(fuente);
  const s = p.principal.find((x) => x.clase === "Asignacion");
  assert.ok(s !== undefined && s.clase === "Asignacion");
  return s.valor;
}

describe("expresiones a texto", () => {
  const texto = (expr: string): string =>
    expresionATexto(primeraAsignacion(`Inicio\n    Definir a, b, c Como Entero\n    a <- ${expr}\nFin`));

  test("respeta la precedencia sin paréntesis de más", () => {
    assert.equal(texto("b + c * 2"), "b + c * 2");
    assert.equal(texto("b * c + 2"), "b * c + 2");
  });

  test("pone paréntesis solo donde hacen falta", () => {
    assert.equal(texto("(b + c) * 2"), "(b + c) * 2");
  });

  test("literales, llamadas e índices", () => {
    assert.equal(texto('Longitud("hola")'), 'Longitud("hola")');
    assert.equal(texto("Verdadero"), "Verdadero");
  });

  test("operadores lógicos y unarios en castellano", () => {
    assert.equal(texto("b > 1 Y c < 2"), "b > 1 Y c < 2");
    assert.equal(texto("No (b > 1)"), "No (b > 1)");
  });
});

describe("formas del diagrama", () => {
  test("un programa mínimo tiene inicio, fin y el proceso del medio", () => {
    const svg = svgDe("Inicio\n    Definir x Como Entero\n    x <- 1\nFin");
    assert.match(svg, /class="f-ovalo"/, "falta el óvalo");
    assert.match(svg, /class="f-proceso"/, "falta el rectángulo de proceso");
    assert.match(svg, /x ← 1/, "falta la asignación con su flecha");
    assert.ok(svg.includes("Inicio") && svg.includes("Fin"));
  });

  test("Leer y Escribir usan el romboide de entrada y salida", () => {
    const svg = svgDe('Inicio\n    Definir x Como Entero\n    Leer x\n    Escribir x\nFin');
    const romboides = svg.match(/class="f-es"/g) ?? [];
    assert.equal(romboides.length, 2, "Leer y Escribir son romboides");
    assert.match(svg, /Leer x/);
    assert.match(svg, /Escribir x/);
  });

  test("Si dibuja un rombo con sus dos salidas rotuladas", () => {
    const svg = svgDe(
      "Inicio\n    Definir x Como Entero\n    x <- 1\n    Si x > 0 Entonces\n        Escribir 1\n    SiNo\n        Escribir 2\n    FinSi\nFin",
    );
    assert.match(svg, /class="f-decision"/, "falta el rombo");
    assert.match(svg, /¿x &gt; 0\?/, "la condición va en el rombo, con el > escapado");
    assert.ok(svg.includes(">Sí<"), "falta la rama del sí");
    assert.ok(svg.includes(">No<"), "falta la rama del no");
  });

  test("Mientras dibuja el rombo y la flecha de retorno", () => {
    const svg = svgDe(
      "Inicio\n    Definir x Como Entero\n    x <- 3\n    Mientras x > 0 Hacer\n        x <- x - 1\n    FinMientras\nFin",
    );
    assert.match(svg, /class="f-decision"/);
    // El retorno del bucle es una línea sin punta que sube por el costado; la
    // punta la lleva la que vuelve a entrar al rombo.
    const lineas = svg.match(/class="fl"/g) ?? [];
    assert.ok(lineas.length >= 6, `un bucle necesita varias líneas, hay ${lineas.length}`);
  });

  test("Para muestra el rango en el rombo", () => {
    const svg = svgDe(
      "Inicio\n    Definir i Como Entero\n    Para i <- 1 Hasta 10 Hacer\n        Escribir i\n    FinPara\nFin",
    );
    assert.match(svg, /i de 1 a 10/);
  });

  test("llamar a un procedimiento usa la forma de subproceso", () => {
    const svg = svgDe(
      "Procedimiento Saludar()\n    Escribir \"hola\"\nFinProcedimiento\n\nInicio\n    Saludar()\nFin",
    );
    // Dos líneas verticales a los costados del rectángulo.
    assert.match(svg, /class="f-borde"/);
    assert.match(svg, /Saludar\(\)/);
  });
});

describe("un diagrama por bloque", () => {
  test("el principal y cada subprograma van por separado", () => {
    const d = diagramasDe(
      programaDe(
        `Funcion r <- Doble(n Como Entero)
    r <- n * 2
FinFuncion

Procedimiento Saludar()
    Escribir "hola"
FinProcedimiento

Inicio
    Escribir Doble(2)
Fin`,
      ),
    );
    assert.equal(d.length, 3);
    assert.equal(d[0]!.titulo, "Programa principal");
    assert.equal(d[1]!.titulo, "Doble(n)");
    assert.equal(d[2]!.titulo, "Saludar()");
    // Una función termina retornando su variable.
    assert.match(d[1]!.svg, /Retornar r/);
  });

  test("los parámetros por referencia se marcan", () => {
    const d = diagramasDe(
      programaDe(
        "Procedimiento P(Por Referencia a Como Entero)\n    a <- 1\nFinProcedimiento\n\nInicio\n    Definir x Como Entero\n    x <- 0\n    P(x)\nFin",
      ),
    );
    assert.equal(d[1]!.titulo, "P(ref a)");
  });
});

describe("el lienzo contiene el dibujo", () => {
  /** Toda coordenada dibujada tiene que caer dentro del viewBox. */
  function revisarLienzo(svg: string, nombre: string): void {
    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    assert.ok(vb !== null, `${nombre}: falta el viewBox`);
    const ancho = Number(vb[1]);

    const numeros: Array<{ x: number; y: number }> = [];
    for (const m of svg.matchAll(/<(?:line|rect|text)[^>]*?(?:x1|x)="(-?[\d.]+)"[^>]*?(?:y1|y)="(-?[\d.]+)"/g)) {
      numeros.push({ x: Number(m[1]), y: Number(m[2]) });
    }
    for (const m of svg.matchAll(/x2="(-?[\d.]+)" y2="(-?[\d.]+)"/g)) {
      numeros.push({ x: Number(m[1]), y: Number(m[2]) });
    }
    for (const m of svg.matchAll(/points="([^"]+)"/g)) {
      for (const par of m[1]!.trim().split(/\s+/)) {
        const [x, y] = par.split(",").map(Number);
        numeros.push({ x: x!, y: y! });
      }
    }

    assert.ok(numeros.length > 0, `${nombre}: no se dibujó nada`);
    for (const { x, y } of numeros) {
      assert.ok(x >= -1 && x <= ancho + 1, `${nombre}: x=${x} se sale del ancho ${ancho}`);
      // El grupo del dibujo está desplazado hacia abajo, así que las 'y' de las
      // figuras son relativas: solo se comprueba que no sean negativas.
      assert.ok(y >= -1, `${nombre}: y=${y} es negativa`);
    }
  }

  const casos: Record<string, string> = {
    "secuencia simple": "Inicio\n    Definir x Como Entero\n    Leer x\n    Escribir x\nFin",
    "si con ramas desiguales": `Inicio
    Definir x Como Entero
    Leer x
    Si x > 0 Entonces
        Escribir "positivo"
        Escribir "otra linea mas para desbalancear"
    SiNo
        Escribir "no"
    FinSi
Fin`,
    "si encadenado": `Inicio
    Definir n Como Entero
    Leer n
    Si n >= 9 Entonces
        Escribir "excelente"
    SiNo Si n >= 7 Entonces
        Escribir "aprobado"
    SiNo
        Escribir "reprobado"
    FinSi
Fin`,
    "bucles anidados": `Inicio
    Definir i, j Como Entero
    Para i <- 1 Hasta 3 Hacer
        Para j <- 1 Hasta 3 Hacer
            Escribir i * j
        FinPara
    FinPara
Fin`,
    "repetir": `Inicio
    Definir x Como Entero
    Repetir
        Leer x
    Hasta Que x > 0
Fin`,
    "si dentro de un bucle": `Inicio
    Definir i Como Entero
    Mientras i < 10 Hacer
        Si i MOD 2 = 0 Entonces
            Escribir "par"
        SiNo
            Escribir "impar"
        FinSi
        i <- i + 1
    FinMientras
Fin`,
  };

  for (const [nombre, fuente] of Object.entries(casos)) {
    test(nombre, () => {
      for (const d of diagramasDe(programaDe(fuente))) revisarLienzo(d.svg, nombre);
    });
  }

  test("el programa completo de la especificación también entra", () => {
    const fuente = `Funcion promedio <- CalcularPromedio(notas Como Arreglo[30] De Real, cantidad Como Entero)
    Definir suma Como Real
    Definir i Como Entero
    Definir promedio Como Real
    suma <- 0
    Para i <- 0 Hasta cantidad - 1 Hacer
        suma <- suma + notas[i]
    FinPara
    promedio <- suma / cantidad
FinFuncion

Inicio
    Definir notas Como Arreglo[30] De Real
    Definir cantidad, i Como Entero
    Definir prom Como Real
    Leer cantidad
    Mientras cantidad < 1 O cantidad > 30 Hacer
        Escribir "Debe estar entre 1 y 30."
        Leer cantidad
    FinMientras
    Para i <- 0 Hasta cantidad - 1 Hacer
        Leer notas[i]
    FinPara
    prom <- CalcularPromedio(notas, cantidad)
    Escribir "Promedio: ", prom
Fin`;
    const diagramas = diagramasDe(programaDe(fuente));
    assert.equal(diagramas.length, 2);
    for (const d of diagramas) revisarLienzo(d.svg, d.titulo);
  });
});

describe("el texto de las etiquetas es seguro", () => {
  test("los caracteres especiales van escapados", () => {
    const svg = svgDe('Inicio\n    Escribir "a < b & c > d"\nFin');
    assert.match(svg, /&lt;/);
    assert.match(svg, /&amp;/);
    assert.match(svg, /&gt;/);
    // Sin escapar, un '<' del texto abriría una etiqueta y rompería el SVG.
    assert.doesNotMatch(svg, /Escribir "a < b/);
  });

  test("un texto larguísimo se recorta en vez de deformar la figura", () => {
    const largo = "x".repeat(200);
    const svg = svgDe(`Inicio\n    Escribir "${largo}"\nFin`);
    assert.match(svg, /…/, "el texto largo se recorta con puntos suspensivos");
    const vb = /viewBox="0 0 (\d+)/.exec(svg);
    assert.ok(Number(vb![1]) < 600, "el diagrama no se estira sin límite");
  });
});
