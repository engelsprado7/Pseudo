/**
 * Pruebas de la capa de archivos.
 *
 * Casi todo lo de `web/archivos.ts` necesita un navegador de verdad (diálogos
 * de archivo, blobs, descargas). Lo que sí se puede probar acá es la lógica
 * pura, y se prueba: el nombre de archivo es lo que el alumno ve y lo que
 * decide si su trabajo se puede volver a abrir.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXTENSION, conExtension } from "../web/archivos.ts";

describe("conExtension", () => {
  const casos: Array<[string, string]> = [
    ["mi-programa", "mi-programa.psc"],
    ["mi-programa.psc", "mi-programa.psc"],
    ["notas.txt", "notas.txt"],
    ["  espacios  ", "espacios.psc"],
    ["", "programa.psc"],
    ["   ", "programa.psc"],
    ["tarea.1", "tarea.1.psc"],
    ["MAYUS.PSC", "MAYUS.PSC"],
    ["acentuado-áé", "acentuado-áé.psc"],
  ];

  for (const [entrada, esperado] of casos) {
    test(`${JSON.stringify(entrada)} → ${esperado}`, () => {
      assert.equal(conExtension(entrada), esperado);
    });
  }

  test("es idempotente", () => {
    assert.equal(conExtension(conExtension("x")), "x.psc");
  });

  test("la extensión es la que espera el resto del proyecto", () => {
    assert.equal(EXTENSION, ".psc");
  });
});

describe("el módulo no toca el DOM al importarse", () => {
  test("se pudo importar sin navegador", () => {
    // Si `archivos.ts` ejecutara código de DOM en el nivel superior, este
    // archivo no habría podido importarse y la prueba no llegaría acá.
    assert.equal(typeof conExtension, "function");
  });
});

describe("los controles de archivo están en el HTML", () => {
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

  for (const id of [
    "btn-abrir",
    "btn-guardar",
    "btn-guardar-como",
    "nombre-archivo",
    "marca-sucio",
    "zona-soltar",
    "envoltorio-editor",
    "nota-guardado",
  ]) {
    test(`#${id}`, () => {
      assert.ok(html.includes(`id="${id}"`), `falta el elemento #${id}`);
    });
  }
});
