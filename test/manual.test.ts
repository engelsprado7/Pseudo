/**
 * Los ejemplos del manual tienen que funcionar.
 *
 * Extrae cada bloque ```pseudo del README y lo compila y ejecuta de verdad. Una
 * documentación que no coincide con el programa es peor que no tener
 * documentación: el alumno copia lo que dice el manual, no anda, y deja de
 * confiar en las dos cosas.
 *
 * Esto además ata el manual al lenguaje: si algún día cambia una palabra clave
 * o el orden de un bloque, estas pruebas fallan y obligan a actualizar el texto.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { verificar } from "../src/verificador.ts";
import { ejecutar } from "../src/interprete.ts";
import { formatear } from "../src/diagnostico.ts";

const RAIZ = new URL("..", import.meta.url).pathname;

/** Cada bloque ```pseudo del README, con la línea donde empieza. */
function ejemplosDelManual(): Array<{ linea: number; fuente: string }> {
  const lineas = readFileSync(RAIZ + "README.md", "utf8").split("\n");
  const ejemplos: Array<{ linea: number; fuente: string }> = [];

  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i]!.trim() !== "```pseudo") continue;
    const cuerpo: string[] = [];
    let j = i + 1;
    for (; j < lineas.length && lineas[j]!.trim() !== "```"; j++) cuerpo.push(lineas[j]!);
    ejemplos.push({ linea: i + 1, fuente: cuerpo.join("\n") });
    i = j;
  }
  return ejemplos;
}

const EJEMPLOS = ejemplosDelManual();

describe("los ejemplos del manual", () => {
  test("el manual tiene ejemplos que revisar", () => {
    // Si alguien renombra la marca del bloque, esta prueba avisa en vez de
    // dejar que las demás pasen sin comprobar nada.
    assert.ok(EJEMPLOS.length >= 10, `solo se encontraron ${EJEMPLOS.length} ejemplos`);
  });

  for (const { linea, fuente } of EJEMPLOS) {
    const titulo = fuente.split("\n")[0]!.trim();

    test(`línea ${linea}: «${titulo}…» compila sin errores`, () => {
      const { tokens, errores: lexicos } = tokenizar(fuente);
      assert.deepEqual(
        lexicos.map(formatear),
        [],
        `el ejemplo del README (línea ${linea}) tiene errores léxicos`,
      );

      const { programa, errores: sintacticos } = parsear(tokens);
      assert.deepEqual(
        sintacticos.map(formatear),
        [],
        `el ejemplo del README (línea ${linea}) tiene errores de sintaxis`,
      );

      const deTipos = verificar(programa).filter((d) => d.severidad === "error");
      assert.deepEqual(
        deTipos.map(formatear),
        [],
        `el ejemplo del README (línea ${linea}) tiene errores de tipos`,
      );
    });

    test(`línea ${linea}: «${titulo}…» se ejecuta sin romperse`, () => {
      const { tokens } = tokenizar(fuente);
      const { programa } = parsear(tokens);

      // Los ejemplos que piden datos se alimentan con números: alcanza para
      // comprobar que corren, que es lo que importa acá.
      const generador = ejecutar(programa, { limitePasos: 200_000 });
      let paso = generador.next();
      let pedidos = 0;

      while (!paso.done) {
        if (paso.value.clase === "entrada") {
          pedidos++;
          assert.ok(pedidos < 20, `línea ${linea}: pide entrada sin fin`);
          paso = generador.next("7");
        } else {
          paso = generador.next(undefined);
        }
      }

      assert.equal(
        paso.value.clase,
        "terminado",
        paso.value.clase === "error"
          ? `línea ${linea}: ${formatear(paso.value.diagnostico)}`
          : "",
      );
    });
  }
});
