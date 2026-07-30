/**
 * Guardia contra la única sintaxis de TypeScript que Node no soporta.
 *
 * Node ejecuta los `.ts` borrando tipos, sin generar código, así que rechaza las
 * propiedades declaradas en los parámetros del constructor
 * (`constructor(private x: T) {}`) porque eso requiere emitir asignaciones.
 *
 * `tsc --noEmit` no lo detecta: es sintaxis de TypeScript perfectamente válida.
 * Sin esta prueba, el error solo aparece al importar el módulo, que es
 * exactamente lo que pasó dos veces durante el desarrollo.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function archivosTs(directorio: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...archivosTs(ruta));
    } else if (entrada.endsWith(".ts")) {
      salida.push(ruta);
    }
  }
  return salida;
}

describe("compatibilidad con el modo strip-only de Node", () => {
  const raiz = new URL("..", import.meta.url).pathname;
  const rutas = ["src", "web", "bin", "test"].flatMap((d) => archivosTs(join(raiz, d)));

  test("hay archivos que revisar", () => {
    assert.ok(rutas.length > 10, `solo se encontraron ${rutas.length} archivos`);
  });

  test("ningún constructor declara propiedades en sus parámetros", () => {
    const culpables: string[] = [];

    for (const ruta of rutas) {
      // Se quitan los comentarios antes de buscar: esta misma prueba menciona
      // la sintaxis prohibida en su documentación, y se detectaría a sí misma.
      const texto = readFileSync(ruta, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/\/\/[^\n]*/g, "");
      const lineas = texto.split("\n");

      lineas.forEach((linea, i) => {
        // Busca 'constructor(' seguido de un modificador de acceso.
        if (!/\bconstructor\s*\(/.test(linea) && !/^\s*(private|public|protected|readonly)\b/.test(linea)) {
          return;
        }
        // Reúne la firma completa, que puede ocupar varias líneas.
        const firma = lineas.slice(Math.max(0, i - 4), i + 5).join(" ");
        const m = /constructor\s*\(([^)]*)\)/.exec(firma);
        if (m === null) return;
        if (/\b(private|public|protected|readonly)\s+\w/.test(m[1] ?? "")) {
          const relativa = ruta.slice(raiz.length);
          const marca = `${relativa}:${i + 1}`;
          if (!culpables.some((c) => c.startsWith(relativa))) culpables.push(marca);
        }
      });
    }

    assert.deepEqual(
      culpables,
      [],
      "Node no soporta propiedades en parámetros del constructor. Declará el campo aparte y asignalo en el cuerpo.",
    );
  });
});
