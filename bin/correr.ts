#!/usr/bin/env node
/**
 * Ejecuta un programa de seudocódigo.
 *
 *   node bin/correr.ts ejemplos/promedio.psc
 *   node bin/correr.ts ejemplos/promedio.psc --paso
 *   echo "3\n8\n9\n10" | node bin/correr.ts ejemplos/promedio.psc
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { verificar } from "../src/verificador.ts";
import { ejecutar } from "../src/interprete.ts";
import { formatear } from "../src/diagnostico.ts";

const argumentos = process.argv.slice(2);
const ruta = argumentos.find((a) => !a.startsWith("--"));
const pasoAPaso = argumentos.includes("--paso");

if (ruta === undefined) {
  console.error("Uso: node bin/correr.ts <archivo.psc> [--paso]");
  process.exit(1);
}

const fuente = readFileSync(ruta, "utf8");

// --- Análisis: nada se ejecuta si hay errores ---
const { tokens, errores: lexicos } = tokenizar(fuente);
const { programa, errores: sintacticos } = parsear(tokens);
const semanticos =
  lexicos.length === 0 && sintacticos.length === 0 ? verificar(programa) : [];

const diagnosticos = [...lexicos, ...sintacticos, ...semanticos].sort(
  (a, b) => a.linea - b.linea || a.columna - b.columna,
);
const graves = diagnosticos.filter((d) => d.severidad === "error");

for (const d of diagnosticos.filter((x) => x.severidad === "advertencia")) {
  console.error(`\x1b[33m${formatear(d)}\x1b[0m\n`);
}

if (graves.length > 0) {
  console.error(`\x1b[31mNo se puede ejecutar: ${graves.length} error(es).\x1b[0m\n`);
  for (const d of graves) console.error(formatear(d) + "\n");
  process.exit(1);
}

// --- Ejecución ---
const lector = createInterface({ input: process.stdin, terminal: false });
const pendientes: string[] = [];
let entradaTerminada = false;
let despertar: (() => void) | null = null;

lector.on("line", (linea) => {
  pendientes.push(linea);
  despertar?.();
  despertar = null;
});
lector.on("close", () => {
  entradaTerminada = true;
  despertar?.();
  despertar = null;
});

function siguienteLinea(): Promise<string | undefined> {
  if (pendientes.length > 0) return Promise.resolve(pendientes.shift());
  if (entradaTerminada) return Promise.resolve(undefined);
  return new Promise((resolver) => {
    despertar = () => resolver(pendientes.shift());
  });
}

const generador = ejecutar(programa, { pasoAPaso });
let respuesta: string | undefined;
let paso = generador.next();

while (!paso.done) {
  const evento = paso.value;

  if (evento.clase === "salida") {
    process.stdout.write(evento.texto + (evento.sinSalto ? "" : "\n"));
    respuesta = undefined;
  } else if (evento.clase === "entrada") {
    if (evento.reintento !== undefined) {
      process.stdout.write(`\x1b[33m${evento.reintento}\x1b[0m\n`);
    }
    respuesta = await siguienteLinea();
  } else {
    const vars = evento.variables
      .map((v) => `${v.nombre}=${v.valor ?? "sin valor"}`)
      .join("  ");
    process.stderr.write(`\x1b[2m  L${evento.pos.linea}  ${vars}\x1b[0m\n`);
    respuesta = undefined;
  }

  paso = generador.next(respuesta);
}

lector.close();
const resultado = paso.value;

if (resultado.clase === "error") {
  console.error(`\n\x1b[31m${formatear(resultado.diagnostico)}\x1b[0m`);
  process.exit(1);
}

if (pasoAPaso) {
  console.error(`\n\x1b[2m${resultado.pasos} pasos ejecutados.\x1b[0m`);
}
