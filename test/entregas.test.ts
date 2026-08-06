/**
 * Pruebas de la agrupación de entregas y de las fechas.
 *
 * Las fechas se prueban con un "ahora" fijo. Si dependieran del reloj real, la
 * prueba pasaría de día y fallaría sola a medianoche, que es la peor forma de
 * enterarse de que algo anda mal.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  agruparPorAlumno,
  contarEntregas,
  fechaRelativa,
  type EntregaDeAlumno,
} from "../src/entregas.ts";

function entrega(
  id: string,
  autorId: string,
  autor: string,
  titulo: string,
  creado: string,
): EntregaDeAlumno {
  return { id, autorId, autor, titulo, creado };
}

describe("agrupar por alumno", () => {
  const lista = [
    entrega("1", "a", "Miriam", "Segun.psc", "2026-03-10T14:00:00Z"),
    entrega("2", "b", "Josue Sandoval", "Segun.psc", "2026-03-10T13:00:00Z"),
    entrega("3", "b", "Josue Sandoval", "Mayor.psc", "2026-03-10T15:00:00Z"),
    entrega("4", "c", "Ana", "Area.psc", "2026-03-09T10:00:00Z"),
  ];

  test("una fila por alumno, no una por entrega", () => {
    const grupos = agruparPorAlumno(lista);
    assert.equal(grupos.length, 3, "cuatro entregas de tres personas");
  });

  test("cada grupo dice cuántas entregó", () => {
    const grupos = agruparPorAlumno(lista);
    const josue = grupos.find((g) => g.nombre === "Josue Sandoval")!;
    assert.equal(josue.entregas.length, 2);
    assert.equal(grupos.find((g) => g.nombre === "Ana")!.entregas.length, 1);
  });

  test("el orden es alfabético, para poder buscar a alguien", () => {
    // Si dependiera de quién entregó último, la lista se reordenaría sola
    // durante la clase y habría que releerla entera cada vez.
    assert.deepEqual(
      agruparPorAlumno(lista).map((g) => g.nombre),
      ["Ana", "Josue Sandoval", "Miriam"],
    );
  });

  test("dentro de cada alumno, lo último primero", () => {
    const josue = agruparPorAlumno(lista).find((g) => g.nombre === "Josue Sandoval")!;
    assert.deepEqual(josue.entregas.map((e) => e.titulo), ["Mayor.psc", "Segun.psc"]);
    assert.equal(josue.ultima, "2026-03-10T15:00:00Z");
  });

  test("sin entregas no hay grupos", () => {
    assert.deepEqual(agruparPorAlumno([]), []);
  });

  test("dos personas con el mismo nombre no se mezclan", () => {
    // Pasa de verdad: dos alumnos que se llaman igual. Agrupar por nombre en vez
    // de por identidad los fundiría en uno y falsearía la cuenta.
    const homonimos = [
      entrega("1", "a", "Juan", "x.psc", "2026-03-10T10:00:00Z"),
      entrega("2", "b", "Juan", "y.psc", "2026-03-10T11:00:00Z"),
    ];
    assert.equal(agruparPorAlumno(homonimos).length, 2);
  });
});

describe("fechas en palabras", () => {
  const ahora = new Date("2026-03-10T15:00:00");
  const hace = (ms: number): string =>
    fechaRelativa(new Date(ahora.getTime() - ms).toISOString(), ahora);

  test("lo de recién", () => {
    assert.equal(hace(10_000), "recién");
    assert.equal(hace(3 * 60_000), "hace 3 min");
  });

  test("hoy muestra la hora", () => {
    const texto = hace(4 * 3_600_000);
    assert.match(texto, /^\d{1,2}:\d{2}$/, `esperaba una hora, fue "${texto}"`);
  });

  test("ayer se dice ayer", () => {
    assert.match(fechaRelativa("2026-03-09T20:00:00", ahora), /^ayer /);
  });

  test("cruzar la medianoche cuenta como ayer, no como hace una hora", () => {
    // A las 00:30, lo de las 23:00 es "ayer" aunque hayan pasado 90 minutos:
    // el docente piensa en días de clase, no en ventanas de 24 horas.
    const medianoche = new Date("2026-03-10T00:30:00");
    assert.match(fechaRelativa("2026-03-09T23:00:00", medianoche), /^ayer /);
  });

  test("esta semana, en días; más viejo, con fecha", () => {
    assert.equal(fechaRelativa("2026-03-07T12:00:00", ahora), "hace 3 días");
    assert.match(fechaRelativa("2026-01-15T12:00:00", ahora), /15/);
  });

  test("una fecha inválida no rompe la lista", () => {
    assert.equal(fechaRelativa("no es una fecha", ahora), "");
  });
});

describe("el plural", () => {
  test("una entrega, varias entregas", () => {
    assert.equal(contarEntregas(1), "1 entrega");
    assert.equal(contarEntregas(3), "3 entregas");
    assert.equal(contarEntregas(0), "0 entregas");
  });
});
