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
  miRolEn,
  misMembresias,
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

  test("el alumno no tiene acciones: un ejercicio asignado se abre y se resuelve", () => {
    // Copiar creaba un borrador privado cuyo progreso no le llega al docente:
    // el alumno creía estar haciendo la tarea y trabajaba en el vacío.
    assert.deepEqual(accionesDeItem(delDocente, comoAlumno), []);
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

  test("el docente tampoco edita el ajeno, pero sí puede reutilizarlo", () => {
    // Publicar no da autoría: quien lo escribió es quien lo corrige. Copiar
    // queda para el docente que quiere reutilizar el ejercicio de un colega.
    const deUnAlumno = { tipo: "ejercicio" as const, autorId: ALUMNO };
    assert.deepEqual(accionesDeItem(deUnAlumno, comoDocente), ["copiar"]);
  });
});

describe("un borrador propio", () => {
  const borrador = { tipo: "personal" as const, autorId: ALUMNO };

  test("el docente puede asignarlo a la clase", () => {
    const suyo = { tipo: "personal" as const, autorId: DOCENTE };
    assert.deepEqual(accionesDeItem(suyo, comoDocente), ["asignar", "editar", "borrar"]);
  });

  test("un alumno lo escribe y lo edita, pero no le pone tarea al curso", () => {
    assert.deepEqual(accionesDeItem(borrador, comoAlumno), ["editar", "borrar"]);
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
    assert.deepEqual(accionesDeItem({ tipo: "ejercicio", autorId: ALUMNO }, anonimo), []);
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

describe("mi rol sale de mi propia membresía", () => {
  // La base deja ver las filas de los demás integrantes de una sala propia, así
  // que "lo que puedo leer" no es "donde estoy". Confundirlas le dio a un alumno
  // los botones del docente.
  const filas = [
    { usuario: DOCENTE, sala: "s1", rol: "docente" as const },
    { usuario: ALUMNO, sala: "s1", rol: "alumno" as const },
    { usuario: OTRO, sala: "s1", rol: "alumno" as const },
  ];

  test("un alumno no hereda el rol del docente de su sala", () => {
    assert.equal(miRolEn(filas, ALUMNO, "s1"), "alumno");
  });

  test("el docente sí es docente", () => {
    assert.equal(miRolEn(filas, DOCENTE, "s1"), "docente");
  });

  test("las filas ajenas no cuentan como salas propias", () => {
    assert.deepEqual(misMembresias(filas, ALUMNO), [
      { usuario: ALUMNO, sala: "s1", rol: "alumno" },
    ]);
  });

  test("una sala con varios integrantes aparece una sola vez", () => {
    assert.equal(misMembresias(filas, ALUMNO).length, 1, "sin filtrar salían tres");
  });

  test("sin sesión no hay salas propias", () => {
    assert.deepEqual(misMembresias(filas, null), []);
    assert.equal(miRolEn(filas, null, "s1"), null);
  });

  test("una sala donde no estoy no da rol", () => {
    assert.equal(miRolEn(filas, ALUMNO, "s2"), null);
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
