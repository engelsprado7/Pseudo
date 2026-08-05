/**
 * Pruebas de cómo se abre cada cosa de la sala.
 *
 * Cada bloque de acá corresponde a un error que de verdad ocurrió. Están
 * escritas como el síntoma que se vio, no como la implementación, para que si
 * alguna vuelve a romperse el nombre de la prueba diga qué se rompió.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  claseDeApertura,
  comoAbrir,
  contenidoAlAbrir,
  seGuardaElAvance,
  type ClaseDeApertura,
} from "../src/apertura.ts";

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

describe("qué texto termina en el editor", () => {
  const ESQ = "Inicio\n    \nFin\n";
  const abrir = (ranura: string | null, codigo: string | null, guardado: string | null) =>
    contenidoAlAbrir({ ranura, codigo, guardado, esqueleto: ESQ });

  test("sin ranura se ve lo que llegó, aunque haya algo guardado", () => {
    // Este es el bug exacto: el docente abría la entrega del alumno y veía su
    // propia copia anterior, así que los cambios parecían no llegar nunca.
    assert.equal(abrir(null, "codigo del alumno", "mi copia vieja"), "codigo del alumno");
  });

  test("con ranura, lo guardado gana: es tu trabajo en curso", () => {
    assert.equal(abrir("ej1", "codigo original", "mi avance"), "mi avance");
  });

  test("con ranura y sin nada guardado, se usa el código que trae", () => {
    assert.equal(abrir("ej1", "codigo original", null), "codigo original");
  });

  test("sin código ni guardado, una hoja limpia", () => {
    assert.equal(abrir("ej1", null, null), ESQ);
    assert.equal(abrir(null, null, "algo"), ESQ, "sin ranura tampoco se cuela lo guardado");
  });

  test("un ejercicio sin código adjunto no arrastra el programa anterior", () => {
    assert.equal(abrir("ej9", null, null), ESQ);
  });

  test("solo se recuerda el avance de lo propio", () => {
    assert.equal(seGuardaElAvance("ej1"), true);
    assert.equal(seGuardaElAvance(null), false, "guardar lo ajeno pisaría una ranura que no es");
  });
});

describe("la decisión y lo que se abre van juntas", () => {
  // Estas atan las dos mitades: que `comoAbrir` decida bien no sirve si quien
  // abre no le hace caso, y eso fue lo que pasó.
  const ESQ = "Inicio\n    \nFin\n";

  test("la entrega de otro se ve tal cual, aunque uno tenga trabajo guardado", () => {
    const como = comoAbrir({ clase: "entrega-ajena", id: "p9", ejercicio: "ej1" });
    const visto = contenidoAlAbrir({
      ranura: como.ranura,
      codigo: "lo que entregó el alumno",
      guardado: "lo que yo tenía escrito",
      esqueleto: ESQ,
    });
    assert.equal(visto, "lo que entregó el alumno");
    assert.equal(seGuardaElAvance(como.ranura), false);
  });

  test("un ejercicio asignado devuelve el avance propio", () => {
    const como = comoAbrir({ clase: "ejercicio-asignado", id: "ej1" });
    const visto = contenidoAlAbrir({
      ranura: como.ranura,
      codigo: "andamiaje del docente",
      guardado: "mi solución a medias",
      esqueleto: ESQ,
    });
    assert.equal(visto, "mi solución a medias");
    assert.equal(seGuardaElAvance(como.ranura), true);
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
