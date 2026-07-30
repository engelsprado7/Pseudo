#!/usr/bin/env node
/**
 * Regenera `ejercicios/indice.json` a partir de los archivos que hay.
 *
 * El índice existe porque el navegador no puede listar un directorio. Se genera
 * en lugar de mantenerse a mano para que no se desincronice: agregar un
 * ejercicio es copiar el `.md` y correr esto (o `npm run build`, que lo llama).
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CARPETA = "ejercicios";

const entradas = readdirSync(CARPETA)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((archivo) => {
    const texto = readFileSync(join(CARPETA, archivo), "utf8");
    const titulo = /^#\s+(.*)$/m.exec(texto)?.[1]?.trim();
    if (titulo === undefined) {
      console.error(`\x1b[33mAviso: '${archivo}' no tiene título (# ...).\x1b[0m`);
    }
    return { archivo, titulo: titulo ?? archivo };
  });

writeFileSync(join(CARPETA, "indice.json"), JSON.stringify(entradas, null, 2) + "\n", "utf8");
console.log(`${entradas.length} ejercicio(s) en ${CARPETA}/indice.json`);
