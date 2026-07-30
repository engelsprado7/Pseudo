#!/usr/bin/env node
/**
 * Inspecciona el flujo de tokens de un archivo.
 *
 *   node bin/tokens.ts ejemplos/area.psc
 */
import { readFileSync } from "node:fs";
import { tokenizar } from "../src/lexer.ts";
import { formatear } from "../src/diagnostico.ts";

const ruta = process.argv[2];
if (ruta === undefined) {
  console.error("Uso: node bin/tokens.ts <archivo.psc>");
  process.exit(1);
}

const fuente = readFileSync(ruta, "utf8");
const { tokens, errores } = tokenizar(fuente);

const lineas = fuente.split("\n");
let lineaActual = 0;

for (const t of tokens) {
  if (t.linea !== lineaActual && t.tipo !== "EOF") {
    lineaActual = t.linea;
    const texto = lineas[lineaActual - 1] ?? "";
    console.log(`\n\x1b[2m${String(lineaActual).padStart(3)} │ ${texto}\x1b[0m`);
  }

  if (t.tipo === "FIN_LINEA") {
    console.log("      ⏎");
    continue;
  }
  if (t.tipo === "EOF") {
    console.log("\n      ⏹ fin del archivo");
    continue;
  }

  const detalle =
    t.tipo === "NUMERO"
      ? `  → ${t.valor} (${t.esEntero ? "Entero" : "Real"})`
      : t.tipo === "IDENTIFICADOR"
        ? `  → ${t.nombre}`
        : t.tipo === "TEXTO"
          ? `  → ${JSON.stringify(t.valor)}`
          : "";

  console.log(
    `      c${String(t.columna).padStart(3)}  ${t.tipo.padEnd(18)} ${t.lexema}${detalle}`,
  );
}

if (errores.length > 0) {
  console.log(`\n\x1b[31m${errores.length} problema(s):\x1b[0m\n`);
  for (const e of errores) console.log(formatear(e) + "\n");
  process.exit(1);
}

console.log("\n\x1b[32mSin errores léxicos.\x1b[0m");
