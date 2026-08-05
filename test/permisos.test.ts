/**
 * Pruebas de qué se le ofrece a cada persona.
 *
 * Son las reglas que no se pueden verificar sin varias cuentas abiertas a la
 * vez, así que acá se fijan una por una: lo que ve un alumno, lo que ve el
 * docente, y lo que no tiene que ver ninguno.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  accionesDeItem,
  accionesDeMiembro,
  seccionesVisibles,
  type ContextoDeSala,
} from "../src/permisos.ts";

const DOCENTE = "u-docente";
const ALUMNO = "u-alumno";
const OTRO = "u-otro";

const comoDocente: ContextoDeSala = { usuarioId: DOCENTE, haySala: true, soyDocente: true };
const comoAlumno: ContextoDeSala = { usuarioId: ALUMNO, haySala: true, soyDocente: false };
const sinSala: ContextoDeSala = { usuarioId: ALUMNO, haySala: false, soyDocente: false };

describe("un ejercicio asignado a la clase", () => {
  const delDocente = { tipo: "ejercicio" as const, autorId: DOCENTE };

  test("el alumno solo puede llevarse una copia", () => {
    assert.deepEqual(accionesDeItem(delDocente, comoAlumno), ["copiar"]);
  });

  test("el alumno no puede editarlo ni retirarlo", () => {
    const acciones = accionesDeItem(delDocente, comoAlumno);
    assert.ok(!acciones.includes("editar"), "editar lo ajeno lo rechazaría RLS");
    assert.ok(!acciones.includes("retirar"));
    assert.ok(!acciones.includes("borrar"));
  });

  test("su autor lo edita o lo retira, y no se copia a sí mismo", () => {
    assert.deepEqual(accionesDeItem(delDocente, comoDocente), ["editar", "retirar"]);
  });

  test("el docente tampoco edita el ejercicio de un alumno", () => {
    // Publicar no da autoría: quien lo escribió es quien lo corrige.
    const deUnAlumno = { tipo: "ejercicio" as const, autorId: ALUMNO };
    assert.deepEqual(accionesDeItem(deUnAlumno, comoDocente), ["copiar"]);
  });
});

describe("un borrador propio", () => {
  const borrador = { tipo: "personal" as const, autorId: ALUMNO };

  test("con una sala se puede asignar, editar y borrar", () => {
    assert.deepEqual(accionesDeItem(borrador, comoAlumno), ["asignar", "editar", "borrar"]);
  });

  test("sin sala no se ofrece asignar: no hay a quién", () => {
    assert.deepEqual(accionesDeItem(borrador, sinSala), ["editar", "borrar"]);
  });
});

describe("una entrega", () => {
  test("cada quien retira la suya", () => {
    const mia = { tipo: "programa" as const, autorId: ALUMNO };
    assert.deepEqual(accionesDeItem(mia, comoAlumno), ["borrar"]);
  });

  test("un alumno no puede tocar la entrega de otro", () => {
    const ajena = { tipo: "programa" as const, autorId: OTRO };
    assert.deepEqual(accionesDeItem(ajena, comoAlumno), []);
  });

  test("el docente modera su sala y puede quitar cualquier entrega", () => {
    const deUnAlumno = { tipo: "programa" as const, autorId: ALUMNO };
    assert.deepEqual(accionesDeItem(deUnAlumno, comoDocente), ["borrar"]);
  });

  test("nadie edita una entrega: es la respuesta de otro, no un ejercicio", () => {
    for (const ctx of [comoAlumno, comoDocente]) {
      const acciones = accionesDeItem({ tipo: "programa", autorId: OTRO }, ctx);
      assert.ok(!acciones.includes("editar"));
      assert.ok(!acciones.includes("copiar"));
    }
  });
});

describe("sin sesión iniciada", () => {
  const anonimo: ContextoDeSala = { usuarioId: null, haySala: true, soyDocente: false };

  test("nada es propio, así que no se ofrece nada sobre lo ajeno", () => {
    assert.deepEqual(accionesDeItem({ tipo: "programa", autorId: ALUMNO }, anonimo), []);
    assert.deepEqual(accionesDeItem({ tipo: "ejercicio", autorId: ALUMNO }, anonimo), ["copiar"]);
  });
});

describe("administrar miembros", () => {
  test("un alumno no administra a nadie", () => {
    assert.deepEqual(accionesDeMiembro({ id: OTRO, rol: "alumno" }, comoAlumno), []);
    assert.deepEqual(accionesDeMiembro({ id: DOCENTE, rol: "docente" }, comoAlumno), []);
  });

  test("el docente promueve, baja y quita", () => {
    assert.deepEqual(accionesDeMiembro({ id: ALUMNO, rol: "alumno" }, comoDocente), [
      "hacer-docente",
      "quitar",
    ]);
    assert.deepEqual(accionesDeMiembro({ id: OTRO, rol: "docente" }, comoDocente), [
      "hacer-alumno",
      "quitar",
    ]);
  });

  test("nadie se quita a sí mismo desde la lista", () => {
    const acciones = accionesDeMiembro({ id: DOCENTE, rol: "docente" }, comoDocente);
    assert.ok(!acciones.includes("quitar"), "para irse está salir de la sala");
    assert.deepEqual(acciones, ["hacer-alumno"]);
  });
});

describe("secciones del feed", () => {
  test("sin sala solo se ven los borradores propios", () => {
    assert.deepEqual(seccionesVisibles(sinSala), ["personal"]);
  });

  test("con sala se ven las tres", () => {
    assert.deepEqual(seccionesVisibles(comoAlumno), ["personal", "ejercicio", "programa"]);
  });
});
