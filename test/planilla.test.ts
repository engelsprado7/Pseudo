/**
 * Pruebas de la planilla.
 *
 * Lo que más se prueba acá es el **orden**: decide a quién ve primero el
 * docente, y equivocarse ahí manda a ayudar a la persona que no lo necesita.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  armarPlanilla,
  resumenDeEjercicio,
  type EjercicioDeClase,
  type MiembroDeClase,
  type ProgresoDeAlumno,
} from "../src/planilla.ts";

const EJERCICIOS: EjercicioDeClase[] = [
  { id: "e1", titulo: "El mayor de tres" },
  { id: "e2", titulo: "Tabla de multiplicar" },
];

const CLASE: MiembroDeClase[] = [
  { id: "d", nombre: "Profe", rol: "docente" },
  { id: "a", nombre: "Ana", rol: "alumno" },
  { id: "b", nombre: "Bruno", rol: "alumno" },
  { id: "c", nombre: "Clara", rol: "alumno" },
];

function progreso(
  alumno: string,
  ejercicio: string,
  aprobados: number,
  total: number,
  intentos = 1,
): ProgresoDeAlumno {
  return { alumno, ejercicio, aprobados, total, intentos };
}

describe("quién aparece en la planilla", () => {
  test("están todos los alumnos, incluso los que nunca verificaron", () => {
    const p = armarPlanilla(CLASE, [progreso("a", "e1", 2, 2)], EJERCICIOS);
    assert.deepEqual(p.filas.map((f) => f.nombre).sort(), ["Ana", "Bruno", "Clara"]);
  });

  test("el docente no es una fila de la clase", () => {
    const p = armarPlanilla(CLASE, [], EJERCICIOS);
    assert.ok(!p.filas.some((f) => f.nombre === "Profe"), "el docente no es un alumno trabado");
  });

  test("sin haber verificado, todas las celdas quedan sin empezar", () => {
    const p = armarPlanilla(CLASE, [], EJERCICIOS);
    assert.ok(p.filas.every((f) => f.celdas.every((c) => c.estado === "sin-empezar")));
    assert.equal(p.sinEmpezar, 3);
    assert.equal(p.necesitanAyuda, 0, "no empezar no es lo mismo que estar trabado");
  });
});

describe("estado de cada celda", () => {
  test("distingue aprobado, parcial y fallado", () => {
    const p = armarPlanilla(
      CLASE,
      [
        progreso("a", "e1", 3, 3),
        progreso("b", "e1", 1, 3),
        progreso("c", "e1", 0, 3),
      ],
      EJERCICIOS,
    );
    const de = (n: string) => p.filas.find((f) => f.nombre === n)!.celdas[0]!;
    assert.equal(de("Ana").estado, "aprobado");
    assert.equal(de("Bruno").estado, "parcial");
    assert.equal(de("Clara").estado, "fallado");
  });

  test("un ejercicio sin casos no cuenta como aprobado", () => {
    const p = armarPlanilla(CLASE, [progreso("a", "e1", 0, 0)], EJERCICIOS);
    assert.equal(p.filas.find((f) => f.nombre === "Ana")!.celdas[0]!.estado, "fallado");
  });
});

describe("el orden pone arriba a quien más conviene mirar", () => {
  test("quien está trabado va antes que quien no empezó", () => {
    const p = armarPlanilla(
      CLASE,
      [progreso("c", "e1", 0, 3, 5)], // Clara pelea; Ana y Bruno no arrancaron
      EJERCICIOS,
    );
    assert.equal(p.filas[0]!.nombre, "Clara");
  });

  test("quien no empezó va antes que quien ya aprobó todo", () => {
    const p = armarPlanilla(
      CLASE,
      [progreso("a", "e1", 3, 3), progreso("a", "e2", 2, 2)], // Ana terminó
      EJERCICIOS,
    );
    assert.equal(p.filas[p.filas.length - 1]!.nombre, "Ana", "quien terminó no necesita atención");
  });

  test("a igual situación, más intentos pesa más", () => {
    const p = armarPlanilla(
      CLASE,
      [progreso("a", "e1", 0, 3, 9), progreso("b", "e1", 0, 3, 1)],
      EJERCICIOS,
    );
    assert.equal(p.filas[0]!.nombre, "Ana", "nueve intentos fallidos es frustración");
    assert.equal(p.filas[1]!.nombre, "Bruno");
  });

  test("el orden es estable entre actualizaciones", () => {
    // Con la misma situación, dos alumnos tienen que quedar siempre igual: una
    // lista que baila sola es imposible de seguir mientras se da clase.
    const filas = [progreso("b", "e1", 0, 3, 2), progreso("c", "e1", 0, 3, 2)];
    const a = armarPlanilla(CLASE, filas, EJERCICIOS).filas.map((f) => f.nombre);
    const b = armarPlanilla(CLASE, [...filas].reverse(), EJERCICIOS).filas.map((f) => f.nombre);
    assert.deepEqual(a, b);
  });
});

describe("resúmenes", () => {
  test("cuenta cuántos necesitan ayuda y cuántos no empezaron", () => {
    const p = armarPlanilla(
      CLASE,
      [progreso("a", "e1", 3, 3), progreso("b", "e1", 1, 3)],
      EJERCICIOS,
    );
    assert.equal(p.necesitanAyuda, 1, "solo Bruno está a medias");
    assert.equal(p.sinEmpezar, 1, "solo Clara no arrancó");
  });

  test("la columna dice cuántos aprobaron sobre el total de la clase", () => {
    const p = armarPlanilla(
      CLASE,
      [progreso("a", "e1", 3, 3), progreso("b", "e1", 3, 3), progreso("c", "e1", 0, 3)],
      EJERCICIOS,
    );
    assert.deepEqual(resumenDeEjercicio(p, 0), { aprobaron: 2, total: 3 });
    assert.deepEqual(resumenDeEjercicio(p, 1), { aprobaron: 0, total: 3 });
  });

  test("una fila cuenta sus ejercicios aprobados", () => {
    const p = armarPlanilla(
      CLASE,
      [progreso("a", "e1", 3, 3), progreso("a", "e2", 2, 2)],
      EJERCICIOS,
    );
    assert.equal(p.filas.find((f) => f.nombre === "Ana")!.aprobados, 2);
  });
});

describe("casos límite", () => {
  test("sin ejercicios asignados no hay columnas ni nadie trabado", () => {
    const p = armarPlanilla(CLASE, [], []);
    assert.equal(p.ejercicios.length, 0);
    assert.equal(p.necesitanAyuda, 0);
    assert.ok(p.filas.every((f) => f.celdas.length === 0));
  });

  test("una sala sin alumnos no rompe", () => {
    const p = armarPlanilla([{ id: "d", nombre: "Profe", rol: "docente" }], [], EJERCICIOS);
    assert.deepEqual(p.filas, []);
    assert.equal(p.sinEmpezar, 0);
  });

  test("progreso de alguien que ya no está en la sala se ignora", () => {
    const p = armarPlanilla(CLASE, [progreso("fantasma", "e1", 0, 3)], EJERCICIOS);
    assert.equal(p.filas.length, 3);
    assert.ok(p.filas.every((f) => f.celdas.every((c) => c.estado === "sin-empezar")));
  });
});
