#!/usr/bin/env node
/**
 * Servidor estático para `sitio/`.
 *
 * Hace falta un servidor porque el editor es un módulo ES: abrir el
 * `index.html` con doble clic (`file://`) no funciona, el navegador bloquea los
 * módulos por seguridad.
 *
 * Está escrito con Node y sin dependencias en lugar de usar `python3 -m
 * http.server` para que funcione igual en Windows, macOS y Linux.
 *
 *   node bin/servir.ts            → http://localhost:8000
 *   node bin/servir.ts 3000       → otro puerto
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const RAIZ = resolve("sitio");
const puerto = Number(process.argv[2] ?? 8000);

if (!existsSync(RAIZ)) {
  console.error("Falta el directorio sitio/. Corré primero: npm run build");
  process.exit(1);
}

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const servidor = createServer((peticion, respuesta) => {
  const ruta = decodeURIComponent((peticion.url ?? "/").split("?")[0] ?? "/");
  const relativa = ruta === "/" ? "index.html" : ruta.slice(1);

  // Sin esto, una petición a /../../etc/passwd saldría del directorio.
  const destino = join(RAIZ, normalize(relativa));
  if (!destino.startsWith(RAIZ)) {
    respuesta.writeHead(403).end("Prohibido");
    return;
  }

  if (!existsSync(destino) || !statSync(destino).isFile()) {
    respuesta.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    respuesta.end(`No existe: ${relativa}`);
    return;
  }

  respuesta.writeHead(200, {
    "content-type": TIPOS[extname(destino)] ?? "application/octet-stream",
    // Sin caché: en clase, un cambio tiene que verse al recargar.
    "cache-control": "no-store",
  });
  createReadStream(destino).pipe(respuesta);
});

servidor.listen(puerto, () => {
  console.log(`\nEditor en \x1b[4mhttp://localhost:${puerto}\x1b[0m`);
  console.log("Ctrl+C para detener.\n");
});

servidor.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`El puerto ${puerto} está ocupado. Probá: node bin/servir.ts ${puerto + 1}`);
    process.exit(1);
  }
  throw e;
});
