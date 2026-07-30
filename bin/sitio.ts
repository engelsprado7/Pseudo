#!/usr/bin/env node
/**
 * Copia al directorio `sitio/` lo que no genera esbuild.
 *
 * Existe en lugar de un `cp` en el script de npm porque `cp` y `mkdir -p` no
 * existen en Windows. Un laboratorio escolar es justamente donde eso importa.
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SITIO = "sitio";
const SITIO_EJERCICIOS = join(SITIO, "ejercicios");
const SITIO_SOLUCIONES = join(SITIO, "soluciones");

mkdirSync(SITIO_EJERCICIOS, { recursive: true });
mkdirSync(SITIO_SOLUCIONES, { recursive: true });

copyFileSync(join("web", "index.html"), join(SITIO, "index.html"));

const aCopiar = readdirSync("ejercicios").filter(
  (f) => f.endsWith(".md") || f === "indice.json",
);
for (const archivo of aCopiar) {
  copyFileSync(join("ejercicios", archivo), join(SITIO_EJERCICIOS, archivo));
}

// Las soluciones de referencia también se sirven: el editor las carga cuando se
// elige un ejercicio. Quedan a la vista de quien mire la red, así que esto es un
// modo pensado para el docente, no para esconderle la respuesta al alumno.
const solucionesACopiar = readdirSync("soluciones").filter((f) => f.endsWith(".psc"));
for (const archivo of solucionesACopiar) {
  copyFileSync(join("soluciones", archivo), join(SITIO_SOLUCIONES, archivo));
}

console.log(
  `sitio/ listo: index.html + ${aCopiar.length} archivo(s) de ejercicios + ` +
    `${solucionesACopiar.length} solución(es)`,
);
