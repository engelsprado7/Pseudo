#!/usr/bin/env node
/**
 * Copia al directorio `sitio/` lo que no genera esbuild.
 *
 * Existe en lugar de un `cp` en el script de npm porque `cp` y `mkdir -p` no
 * existen en Windows. Un laboratorio escolar es justamente donde eso importa.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SITIO = "sitio";
const SITIO_EJERCICIOS = join(SITIO, "ejercicios");
const SITIO_SOLUCIONES = join(SITIO, "soluciones");

mkdirSync(SITIO_EJERCICIOS, { recursive: true });
mkdirSync(SITIO_SOLUCIONES, { recursive: true });

// El bundle lleva el hash del contenido en el nombre, así que hay que apuntar
// el HTML al archivo que esbuild acaba de generar.
//
// Sin esto, GitHub Pages sigue sirviendo el 'editor.js' viejo de su caché
// después de desplegar, y uno depura durante media hora un error que ya estaba
// arreglado. Con el hash, un cambio es un archivo nuevo: no hay caché que valga.
const bundle = readdirSync(SITIO).find((f) => /^editor-[A-Z0-9]+\.js$/i.test(f));
if (bundle === undefined) {
  console.error("No encontré el bundle del editor en sitio/. ¿Corrió esbuild?");
  process.exit(1);
}

const html = readFileSync(join("web", "index.html"), "utf8").replace(
  './editor.js"',
  `./${bundle}"`,
);
writeFileSync(join(SITIO, "index.html"), html);

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

// La configuración de la nube es opcional: sin ella el editor funciona igual,
// solo que sin sesión ni salas. Por eso no se copia si no está, en vez de fallar.
const hayConfigNube = existsSync(join("web", "nube.json"));
if (hayConfigNube) {
  copyFileSync(join("web", "nube.json"), join(SITIO, "nube.json"));
}

console.log(
  `sitio/ listo: index.html + ${aCopiar.length} archivo(s) de ejercicios + ` +
    `${solucionesACopiar.length} solución(es)` +
    (hayConfigNube ? " + nube.json" : " (sin nube.json)"),
);
