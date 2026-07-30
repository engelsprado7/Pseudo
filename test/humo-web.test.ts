/**
 * Prueba de humo de los bundles que se despliegan.
 *
 * Un bundle que compila puede igual estar roto. Acá se importa el archivo real
 * de `sitio/`, el mismo que se sube al hosting, y se comprueba su comportamiento.
 *
 * El bundle del análisis (`analisis.js`) es puro, así que se puede ejercitar de
 * verdad. El del editor (`editor.js`) necesita un navegador, así que de ese se
 * verifica que el empaquetado quedó bien; su superficie de API la valida
 * `npm run tipos`, que comprueba cada llamada a CodeMirror contra sus tipos.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const EDITOR = new URL("../sitio/editor.js", import.meta.url);
const ANALISIS = new URL("../sitio/analisis.js", import.meta.url);

describe("bundle del análisis", () => {
  test("existe", () => {
    assert.ok(
      existsSync(ANALISIS),
      "falta sitio/analisis.js. 'npm test' lo genera solo; si corrés este archivo directo, hacé 'npm run build' antes.",
    );
  });

  test("analiza un programa correcto sin diagnósticos", async () => {
    const { analizar, resumir } = await import(ANALISIS.href);
    const fuente = `Inicio
    Definir base, altura, area Como Real
    Leer base
    Leer altura
    area <- base * altura
    Escribir "El área es: ", area
Fin`;
    const d = analizar(fuente);
    assert.deepEqual(d, []);
    assert.deepEqual(resumir(d), { errores: 0, advertencias: 0, valido: true });
  });

  test("detecta los errores clásicos con sus sugerencias", async () => {
    const { analizar } = await import(ANALISIS.href);
    const fuente = `Inicio
    Definir x, y Como Real
    base = 5
    Si 1 < x < 10 Entonces
        Escribir "rango"
    FinMientras
Fin`;
    const d = analizar(fuente).filter((x: { severidad: string }) => x.severidad === "error");
    assert.equal(d.length, 4);
    assert.match(d[0].sugerencia, /coordY/);
    assert.match(d[1].mensaje, /se usa la flecha/);
    assert.match(d[2].mensaje, /encadenar comparaciones/);
    assert.match(d[3].sugerencia, /FinSi/);
  });

  test("el chequeo de tipos llega al bundle", async () => {
    const { analizar } = await import(ANALISIS.href);
    const d = analizar(`Inicio
    Definir cantidad Como Entero
    cantidad <- 7 / 2
    Si cantidad Entonces
        Escribir cantidad
    FinSi
Fin`).filter((x: { severidad: string }) => x.severidad === "error");
    assert.equal(d.length, 2);
    assert.match(d[0].sugerencia, /'Trunc' o 'Redondear'/);
    assert.match(d[1].sugerencia, /cantidad <> 0/);
  });

  test("no verifica tipos si la sintaxis está rota", async () => {
    const { analizar } = await import(ANALISIS.href);
    // Falta 'Entonces'. No debe agregar errores fantasma de tipos.
    const d = analizar("Inicio\n    Si x > 0\n        Escribir x\n    FinSi\nFin").filter(
      (x: { severidad: string }) => x.severidad === "error",
    );
    assert.equal(d.length, 1);
    assert.match(d[0].mensaje, /se esperaba 'Hacer'|se esperaba 'Entonces'/);
  });

  test("compilar rechaza un programa con errores y acepta uno bueno", async () => {
    const { compilar } = await import(ANALISIS.href);
    const malo = compilar("Inicio\n    x <- 1\nFin");
    assert.equal(malo.ok, false);
    assert.match(malo.diagnosticos[0].mensaje, /no está declarada/);

    const bueno = compilar("Inicio\n    Definir x Como Entero\n    x <- 1\n    Escribir x\nFin");
    assert.equal(bueno.ok, true);
    assert.ok(bueno.programa.principal.length > 0);
  });

  test("las advertencias no impiden compilar", async () => {
    const { compilar } = await import(ANALISIS.href);
    // Sangría incorrecta y variable sin usar: ambas son advertencias.
    const r = compilar("Inicio\nDefinir sobra Como Entero\nEscribir 1\nFin");
    assert.equal(r.ok, true);
  });

  test("formatea a través del bundle", async () => {
    const { formatear } = await import(ANALISIS.href);
    assert.equal(
      formatear("Inicio\n   Si a Entonces\nEscribir 1\n  FinSi\nFin"),
      "Inicio\n    Si a Entonces\n        Escribir 1\n    FinSi\nFin",
    );
  });

  test("la sangría incorrecta es advertencia, no error", async () => {
    const { analizar, resumir } = await import(ANALISIS.href);
    const r = resumir(analizar("Inicio\nEscribir 1\nFin"));
    assert.equal(r.errores, 0);
    assert.ok(r.advertencias > 0);
    assert.equal(r.valido, true);
  });
});

describe("bundle del editor", () => {
  test("existe", () => {
    assert.ok(
      existsSync(EDITOR),
      "falta sitio/editor.js. 'npm test' lo genera solo; si corrés este archivo directo, hacé 'npm run build' antes.",
    );
  });

  test("no quedaron imports ni requires sin resolver", () => {
    const js = readFileSync(EDITOR, "utf8");
    assert.doesNotMatch(js, /from\s*["']\.\.?\//, "quedó un import relativo sin empaquetar");
    assert.doesNotMatch(js, /from\s*["']@codemirror/, "quedó un import de CodeMirror sin empaquetar");
    assert.doesNotMatch(js, /\brequire\(/, "quedó un require de CommonJS");
  });

  test("los mensajes en castellano llegaron al bundle", () => {
    const js = readFileSync(EDITOR, "utf8");
    for (const marca of [
      "palabra reservada",
      "encadenar comparaciones",
      "quedó sin cerrar",
      "coordY",
      "la sangría no coincide",
      "se usa la flecha",
      "no está declarada",
      "Trunc",
      "Verdadero o Falso",
      "división por cero",
      "bucle infinito",
      "se usa antes de recibir un valor",
      "El ejercicio está mal armado",
      "de prueba · comparación",
      "cambios sin guardar",
      "carpeta de descargas",
    ]) {
      assert.ok(js.includes(marca), `falta en el bundle: ${marca}`);
    }
  });

  test("los ejercicios se copiaron al sitio y el índice cuadra", () => {
    const indice = JSON.parse(
      readFileSync(new URL("../sitio/ejercicios/indice.json", import.meta.url), "utf8"),
    ) as Array<{ archivo: string; titulo: string }>;
    assert.ok(indice.length >= 4, `el índice tiene ${indice.length} ejercicios`);
    for (const entrada of indice) {
      const ruta = new URL(`../sitio/ejercicios/${entrada.archivo}`, import.meta.url);
      assert.ok(existsSync(ruta), `falta ${entrada.archivo} en sitio/ejercicios/`);
      const texto = readFileSync(ruta, "utf8");
      assert.ok(
        texto.includes(entrada.titulo),
        `el título del índice no coincide con el de ${entrada.archivo}`,
      );
    }
  });

  test("el HTML referencia el bundle y trae los controles", () => {
    const html = readFileSync(new URL("../sitio/index.html", import.meta.url), "utf8");
    assert.match(html, /src="\.\/editor\.js"/);
    for (const id of [
      "editor",
      "estado",
      "salida",
      "consola",
      "campo-entrada",
      "btn-formatear",
      "btn-ejemplo",
      "btn-limpiar",
      "btn-ejecutar",
      "btn-detener",
      "btn-enviar",
      "btn-verificar",
      "selector-ejercicio",
      "enunciado",
      "btn-abrir",
      "btn-guardar",
      "btn-guardar-como",
      "nombre-archivo",
      "marca-sucio",
      "zona-soltar",
    ]) {
      assert.ok(html.includes(`id="${id}"`), `falta el elemento #${id}`);
    }
    // El texto de la zona de soltar vive en el markup, no en el bundle.
    assert.match(html, /Soltá el archivo/);
  });
});
