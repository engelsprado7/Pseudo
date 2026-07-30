import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  calcularNiveles,
  diagnosticosDeSangria,
  empiezaConCierre,
  formatear,
  nivelSiguiente,
} from "../web/formato.ts";
import { tokenizar } from "../src/lexer.ts";

/** Formatea y devuelve los niveles como cadena, para comparar de un vistazo. */
function niveles(fuente: string): string {
  return calcularNiveles(fuente)
    .map((n) => n.nivel)
    .join("");
}

describe("niveles de sangría", () => {
  test("bloque principal plano", () => {
    assert.equal(niveles("Inicio\nEscribir 1\nEscribir 2\nFin"), "0110");
  });

  test("Si / SiNo / FinSi", () => {
    assert.equal(
      niveles("Inicio\nSi a Entonces\nEscribir 1\nSiNo\nEscribir 2\nFinSi\nFin"),
      "0121210",
    );
  });

  test("SiNo Si en cadena", () => {
    assert.equal(
      niveles(`Inicio
Si a Entonces
Escribir 1
SiNo Si b Entonces
Escribir 2
SiNo
Escribir 3
FinSi
Fin`),
      "012121210",
    );
  });

  test("anidamiento de bucles", () => {
    assert.equal(
      niveles(`Inicio
Mientras a Hacer
Para i <- 0 Hasta 9 Hacer
Escribir i
FinPara
FinMientras
Fin`),
      "0123210",
    );
  });

  test("Repetir / Hasta Que", () => {
    assert.equal(niveles("Inicio\nRepetir\nEscribir 1\nHasta Que a\nFin"), "01210");
  });

  test("Segun con casos y De Otro Modo", () => {
    assert.equal(
      niveles(`Inicio
Segun d Hacer
1, 2:
Escribir "a"
3:
Escribir "b"
De Otro Modo:
Escribir "c"
FinSegun
Fin`),
      "0123232310",
    );
  });

  test("subprogramas empiezan en nivel 0", () => {
    assert.equal(
      niveles(`Funcion r <- F(x)
r <- x
FinFuncion
Inicio
Fin`),
      "01000",
    );
  });

  test("un texto que dice 'FinSi' no cierra nada", () => {
    // La razón de usar el lexer y no expresiones regulares.
    assert.equal(
      niveles('Inicio\nSi a Entonces\nEscribir "FinSi"\nFinSi\nFin'),
      "01210",
    );
  });

  test("un comentario que dice 'Fin' no cierra nada", () => {
    // La línea de comentario no aporta nivel; se comprueba que 'Fin' cierre y
    // que 'Escribir 1' siga adentro.
    assert.equal(niveles("Inicio\nEscribir 1\n// Fin\nFin"), "010");
  });
});

describe("formatear", () => {
  test("corrige sangría caótica sin tocar el contenido", () => {
    const desordenado = `Inicio
        Si a Entonces
Escribir 1
                        SiNo
    Escribir 2
  FinSi
Fin`;
    assert.equal(
      formatear(desordenado),
      `Inicio
    Si a Entonces
        Escribir 1
    SiNo
        Escribir 2
    FinSi
Fin`,
    );
  });

  test("es idempotente", () => {
    const fuente = `Inicio
    Mientras a Hacer
        Para i <- 0 Hasta 9 Hacer
            Escribir i
        FinPara
    FinMientras
Fin`;
    assert.equal(formatear(fuente), fuente);
    assert.equal(formatear(formatear(fuente)), fuente);
  });

  test("convierte tabulaciones en espacios", () => {
    assert.equal(formatear("Inicio\n\t\tEscribir 1\nFin"), "Inicio\n    Escribir 1\nFin");
  });

  test("las líneas vacías quedan vacías, sin espacios sobrantes", () => {
    assert.equal(formatear("Inicio\n   \nEscribir 1\nFin"), "Inicio\n\n    Escribir 1\nFin");
  });

  test("no altera el código, solo el margen", () => {
    const fuente = 'Inicio\n  Escribir "  hola  ", 1 + 2\nFin';
    const sinEspacios = (s: string) => s.replace(/^[ \t]+/gm, "");
    assert.equal(sinEspacios(formatear(fuente)), sinEspacios(fuente));
  });
});

describe("advertencias de sangría", () => {
  test("un archivo bien formateado no produce ninguna", () => {
    const fuente = `Inicio
    Si a Entonces
        Escribir 1
    FinSi
Fin`;
    assert.deepEqual(diagnosticosDeSangria(fuente), []);
  });

  test("son advertencias, nunca errores", () => {
    const d = diagnosticosDeSangria("Inicio\nEscribir 1\nFin");
    assert.ok(d.length > 0);
    assert.ok(d.every((x) => x.severidad === "advertencia"));
  });

  test("el mensaje dice cuántos espacios corresponden", () => {
    const d = diagnosticosDeSangria("Inicio\nSi a Entonces\nEscribir 1\nFinSi\nFin");
    const dosNiveles = d.find((x) => x.linea === 3);
    assert.match(dosNiveles?.sugerencia ?? "", /8 espacios/);
  });
});

describe("empiezaConCierre", () => {
  const casos: Array<[string, boolean]> = [
    ["FinSi", true],
    ["  FinMientras", true],
    ["SiNo", true],
    ["Hasta Que a", true],
    ["Fin", true],
    ["Escribir 1", false],
    ['Escribir "FinSi"', false],
    ["// FinSi", false],
  ];
  for (const [texto, esperado] of casos) {
    test(`${JSON.stringify(texto)} → ${esperado}`, () => {
      assert.equal(empiezaConCierre(texto), esperado);
    });
  }
});

describe("nivelSiguiente: lo que el editor usa en cada Enter", () => {
  const casos: Array<[string, number]> = [
    ["Inicio", 1],
    ["Inicio\n    Si a Entonces", 2],
    ["Inicio\n    Si a Entonces\n        Escribir 1", 2],
    ["Inicio\n    Si a Entonces\n        Escribir 1\n    FinSi", 1],
    ["Inicio\n    Mientras a Hacer", 2],
    ["Inicio\n    Repetir", 2],
    ["Funcion r <- F(x Como Entero)", 1],
    ["Inicio\n    Segun d Hacer", 2],
    ["", 0],
  ];

  for (const [fuente, esperado] of casos) {
    test(`${JSON.stringify(fuente.split("\n").at(-1))} → nivel ${esperado}`, () => {
      assert.equal(nivelSiguiente(fuente), esperado);
    });
  }

  test("el centinela interno no genera errores léxicos", () => {
    // Se agrega una sentencia postiza para calcular el nivel. Si no tokenizara
    // limpio, cada Enter produciría un error espurio y la sangría dependería
    // de que el lexer siga recuperándose igual.
    const { errores } = tokenizar("Inicio\n    Escribir 0");
    assert.deepEqual(errores, []);
    // Y de paso: un identificador no puede empezar con guion bajo.
    assert.ok(tokenizar("_x <- 1").errores.length > 0);
  });
});
