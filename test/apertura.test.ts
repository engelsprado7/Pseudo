/**
 * Pruebas de cómo se abre cada cosa de la sala.
 *
 * Cada bloque de acá corresponde a un error que de verdad ocurrió. Están
 * escritas como el síntoma que se vio, no como la implementación, para que si
 * alguna vuelve a romperse el nombre de la prueba diga qué se rompió.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claseDeApertura, comoAbrir, type ClaseDeApertura } from "../src/apertura.ts";

const YO = "u-yo";
const OTRO = "u-otro";

describe("de qué se trata lo que se abre", () => {
  test("un ejercicio de la sala es para resolver", () => {
    assert.equal(claseDeApertura({ tipo: "ejercicio", autorId: OTRO }, YO), "ejercicio-asignado");
  });

  test("un borrador es siempre propio: nadie más lo ve", () => {
    assert.equal(claseDeApertura({ tipo: "personal", autorId: YO }, YO), "borrador-propio");
  });

  test("una entrega se distingue por quién la mandó", () => {
    assert.equal(claseDeApertura({ tipo: "programa", autorId: YO }, YO), "entrega-propia");
    assert.equal(claseDeApertura({ tipo: "programa", autorId: OTRO }, YO), "entrega-ajena");
  });

  test("sin sesión, ninguna entrega es propia", () => {
    assert.equal(claseDeApertura({ tipo: "programa", autorId: YO }, null), "entrega-ajena");
  });
});

describe("resolver un ejercicio asignado", () => {
  const a = comoAbrir({ clase: "ejercicio-asignado", id: "ej1" });

  test("recuerda el avance", () => {
    assert.equal(a.ranura, "ej1");
  });

  test("cuenta para la planilla del docente", () => {
    assert.equal(a.progreso, "ej1");
  });
});

describe("un borrador propio", () => {
  const a = comoAbrir({ clase: "borrador-propio", id: "b1" });

  test("recuerda el avance", () => {
    assert.equal(a.ranura, "b1");
  });

  test("no le informa nada al docente: es privado", () => {
    assert.equal(a.progreso, null);
  });
});

describe("mi propia entrega", () => {
  const a = comoAbrir({ clase: "entrega-propia", id: "p1", ejercicio: "ej1" });

  test("conserva el vínculo con el ejercicio", () => {
    // Perderlo hacía que volver a entregar insertara una segunda fila en vez
    // de reemplazar la anterior: aparecían duplicadas.
    assert.equal(a.ranura, "ej1");
    assert.equal(a.progreso, "ej1");
  });

  test("una entrega de código suelto no inventa un ejercicio", () => {
    const suelta = comoAbrir({ clase: "entrega-propia", id: "p2", ejercicio: null });
    assert.equal(suelta.progreso, null, "sin ejercicio no hay progreso que registrar");
    assert.equal(suelta.ranura, "p2", "pero sigue siendo trabajo propio");
  });
});

describe("la entrega de otra persona", () => {
  const a = comoAbrir({ clase: "entrega-ajena", id: "p9", ejercicio: "ej1" });

  test("se muestra tal cual llegó, sin restaurar copias locales", () => {
    // Restaurar acá hacía que quien corregía viera su versión anterior y los
    // cambios del alumno parecieran no llegar nunca.
    assert.equal(a.ranura, null);
  });

  test("corregirla no cuenta como progreso de quien corrige", () => {
    assert.equal(a.progreso, null, "falsearía la planilla");
  });
});

describe("invariantes que valen para todas", () => {
  const casos: Array<{ clase: ClaseDeApertura; id: string; ejercicio: string | null }> = [
    { clase: "ejercicio-asignado", id: "ej1", ejercicio: null },
    { clase: "borrador-propio", id: "b1", ejercicio: null },
    { clase: "entrega-propia", id: "p1", ejercicio: "ej1" },
    { clase: "entrega-ajena", id: "p9", ejercicio: "ej1" },
  ];

  test("solo lo propio se recuerda", () => {
    for (const c of casos) {
      const propio = c.clase !== "entrega-ajena";
      assert.equal(
        comoAbrir(c).ranura !== null,
        propio,
        `${c.clase}: lo ajeno no se guarda ni se restaura`,
      );
    }
  });

  test("registrar progreso implica siempre tener ranura", () => {
    // Al revés no: un borrador se recuerda y no informa nada. Pero informar sin
    // recordar sería anotar avance de algo que no se está resolviendo.
    for (const c of casos) {
      const a = comoAbrir(c);
      if (a.progreso !== null) {
        assert.notEqual(a.ranura, null, `${c.clase}: informa progreso sin ser trabajo propio`);
      }
    }
  });
});
