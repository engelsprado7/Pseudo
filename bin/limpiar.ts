#!/usr/bin/env node
/**
 * Borra `sitio/` antes de reconstruirlo.
 *
 * Hace falta porque los trozos que genera esbuild llevan el hash en el nombre
 * (`trozo-CCPHNS6P.js`): al cambiar una dependencia aparece un archivo nuevo y
 * el anterior queda para siempre. Sin esta limpieza, `sitio/` acumula versiones
 * viejas que se publican junto con las buenas.
 *
 * Está en Node y no como `rm -rf` en el script de npm por el mismo motivo que
 * `bin/sitio.ts`: en Windows no existe.
 */
import { rmSync } from "node:fs";

rmSync("sitio", { recursive: true, force: true });
