#!/usr/bin/env node
/**
 * Verifica una solución contra un ejercicio.
 *
 *   node bin/verificar.ts ejercicios/01-area-rectangulo.md soluciones/area.psc
 *   node bin/verificar.ts ejercicios/ soluciones/          (lote por nombre)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { verificar as verificarTipos } from "../src/verificador.ts";
import { formatear } from "../src/diagnostico.ts";
import {
  explicar,
  leerEjercicio,
  verificarSolucion,
  type Ejercicio,
  type ResultadoEjercicio,
} from "../src/ejercicio.ts";

const V = "\x1b[32m";
const R = "\x1b[31m";
const A = "\x1b[33m";
const T = "\x1b[2m";
const N = "\x1b[0m";

const [rutaEjercicio, rutaSolucion] = process.argv.slice(2);

if (rutaEjercicio === undefined || rutaSolucion === undefined) {
  console.error("Uso: node bin/verificar.ts <ejercicio.md|carpeta> <solucion.psc|carpeta>");
  process.exit(1);
}

/** Analiza una solución. Devuelve el AST o imprime los errores y devuelve null. */
function compilar(ruta: string): ReturnType<typeof parsear>["programa"] | null {
  const fuente = readFileSync(ruta, "utf8");
  const { tokens, errores: lexicos } = tokenizar(fuente);
  const { programa, errores: sintacticos } = parsear(tokens);
  const semanticos =
    lexicos.length === 0 && sintacticos.length === 0 ? verificarTipos(programa) : [];

  const graves = [...lexicos, ...sintacticos, ...semanticos]
    .filter((d) => d.severidad === "error")
    .sort((a, b) => a.linea - b.linea || a.columna - b.columna);

  if (graves.length > 0) {
    console.log(`${R}No compila: ${graves.length} error(es).${N}\n`);
    for (const d of graves) console.log(formatear(d) + "\n");
    return null;
  }
  return programa;
}

function cargarEjercicio(ruta: string): Ejercicio | null {
  const leido = leerEjercicio(readFileSync(ruta, "utf8"));
  if (!leido.ok) {
    console.log(`${R}El ejercicio ${basename(ruta)} tiene problemas de formato:${N}\n`);
    for (const e of leido.errores) console.log(`  línea ${e.linea}: ${e.mensaje}`);
    return null;
  }
  return leido.ejercicio;
}

function informar(resultado: ResultadoEjercicio): void {
  const cabecera = resultado.aprobado ? `${V}✓${N}` : `${R}✗${N}`;
  console.log(
    `\n${cabecera} ${resultado.titulo}  ${T}${resultado.aprobados}/${resultado.total} casos${N}`,
  );

  for (const caso of resultado.casos) {
    if (caso.estado === "bien") {
      console.log(`  ${V}✓${N} ${caso.nombre} ${T}(${caso.pasos} pasos)${N}`);
      continue;
    }
    const color = caso.estado === "entrada-rechazada" ? A : R;
    console.log(`  ${color}✗${N} ${caso.nombre}`);
    console.log(`      ${explicar(caso)}`);

    if (caso.estado === "salida-distinta") {
      const linea =
        caso.comparacion.modo === "contiene" ? null : caso.comparacion.primeraDiferencia;
      console.log(`${T}      esperado:${N}`);
      for (const l of caso.comparacion.esperadoNormalizado) console.log(`        ${l}`);
      console.log(`${T}      obtenido:${N}`);
      const obtenido = caso.comparacion.obtenidoNormalizado;
      if (obtenido.length === 0) console.log(`        ${T}(nada)${N}`);
      obtenido.forEach((l, i) => {
        const marca = i === linea ? `${R}»${N}` : " ";
        console.log(`      ${marca} ${l}`);
      });
    }
  }
}

// ------------------------------------------------------------------

const enLote =
  existsSync(rutaEjercicio) &&
  statSync(rutaEjercicio).isDirectory() &&
  existsSync(rutaSolucion) &&
  statSync(rutaSolucion).isDirectory();

if (!enLote) {
  const ejercicio = cargarEjercicio(rutaEjercicio);
  if (ejercicio === null) process.exit(1);
  const programa = compilar(rutaSolucion);
  if (programa === null) process.exit(1);

  const resultado = verificarSolucion(programa, ejercicio);
  informar(resultado);
  process.exit(resultado.aprobado ? 0 : 1);
}

// --- Lote: empareja por el nombre del archivo sin extensión ---
const ejercicios = readdirSync(rutaEjercicio).filter((f) => f.endsWith(".md")).sort();
const soluciones = new Map(
  readdirSync(rutaSolucion)
    .filter((f) => f.endsWith(".psc"))
    .map((f) => [f.replace(/\.psc$/, ""), join(rutaSolucion, f)]),
);

let aprobados = 0;
let evaluados = 0;

for (const archivo of ejercicios) {
  const clave = archivo.replace(/\.md$/, "");
  const solucion = soluciones.get(clave);

  if (solucion === undefined) {
    console.log(`\n${A}—${N} ${clave}  ${T}sin solución (falta ${clave}.psc)${N}`);
    continue;
  }

  const ejercicio = cargarEjercicio(join(rutaEjercicio, archivo));
  if (ejercicio === null) continue;

  const programa = compilar(solucion);
  if (programa === null) {
    console.log(`${R}✗${N} ${ejercicio.titulo}  ${T}no compila${N}`);
    evaluados++;
    continue;
  }

  const resultado = verificarSolucion(programa, ejercicio);
  informar(resultado);
  evaluados++;
  if (resultado.aprobado) aprobados++;
}

console.log(`\n${T}${aprobados}/${evaluados} ejercicios aprobados.${N}`);
process.exit(aprobados === evaluados && evaluados > 0 ? 0 : 1);
