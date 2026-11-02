/**
 * Pruebas en un navegador de verdad, sobre el sitio que se despliega.
 *
 * El resto de las pruebas cubre el lenguaje; esta cubre la página: que los
 * botones hagan lo que dicen. Cada flujo es algo que un alumno hace en la
 * primera clase, y varios ya se rompieron alguna vez sin que lo notara ningún
 * test (el panel que se plegaba solo con cada tecla, por ejemplo).
 *
 * Necesita el sitio armado y Chromium:
 *   npm run build && npx playwright install chromium && npm run prueba-navegador
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright";

const PUERTO = 8765;
const URL_SITIO = `http://localhost:${PUERTO}/`;

let servidor: ChildProcess;
let navegador: Browser;

before(async () => {
  servidor = spawn(process.execPath, ["bin/servir.ts", String(PUERTO)], { stdio: "ignore" });
  // El servidor tarda unos milisegundos en escuchar.
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(URL_SITIO);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  navegador = await chromium.launch();
});

after(async () => {
  await navegador?.close();
  servidor?.kill();
});

/** Una pestaña nueva, sin nada guardado de pruebas anteriores. */
async function abrir(opciones: BrowserContextOptions = {}): Promise<Page> {
  const contexto = await navegador.newContext(opciones);
  const pagina = await contexto.newPage();
  await pagina.goto(URL_SITIO);
  await pagina.locator(".cm-content").waitFor();
  return pagina;
}

/** Reemplaza todo el programa, como si se pegara. */
async function escribir(pagina: Page, programa: string): Promise<void> {
  await pagina.locator(".cm-content").click();
  await pagina.keyboard.press("ControlOrMeta+a");
  await pagina.keyboard.insertText(programa);
}

function programa(pagina: Page): Promise<string> {
  return pagina.locator(".cm-content").innerText();
}

/** Espera a que el elemento contenga el texto; si no llega, falla con lo que hay. */
async function esperarTexto(pagina: Page, selector: string, texto: string | RegExp): Promise<void> {
  const el = pagina.locator(selector);
  try {
    await el.filter({ hasText: texto }).first().waitFor({ timeout: 5000 });
  } catch {
    const hay = (await el.count()) > 0 ? await el.first().innerText() : "(no existe)";
    assert.fail(`${selector} no llegó a decir ${texto}. Dice: ${hay}`);
  }
}

describe("en el navegador", () => {
  test("ejecutar muestra la salida", async () => {
    const p = await abrir();
    await escribir(p, 'Inicio\n    Escribir "hola, clase"\nFin');
    await p.click("#btn-ejecutar");
    await esperarTexto(p, "#consola", "hola, clase");
  });

  test("Leer pide el dato y el programa sigue con él", async () => {
    const p = await abrir();
    await escribir(
      p,
      "Inicio\n    Definir n Como Entero\n    Leer n\n    Escribir n * 2\nFin",
    );
    await p.click("#btn-ejecutar");
    await p.locator("#campo-entrada").waitFor();
    await p.fill("#campo-entrada", "21");
    await p.press("#campo-entrada", "Enter");
    await esperarTexto(p, "#consola", "42");
  });

  test("un programa al estilo PSeInt: un solo error y arreglo de un clic", async () => {
    const p = await abrir();
    await escribir(
      p,
      "Algoritmo suma\n    Definir a Como Entero\n    Leer a\n    Escribir a\nFinAlgoritmo",
    );
    await esperarTexto(p, ".diag", "es de PSeInt");
    // Un solo error, no uno por cada línea que quedó fuera de 'Inicio … Fin'.
    assert.equal(await p.locator(".diag.error").count(), 1);

    await p.click(".diag-arreglo");
    await esperarTexto(p, "#estado", /Sin errores|advertencia/);
    assert.match(await programa(p), /^Inicio\n[\s\S]*\nFin$/);
  });

  test("varios errores: el primero destacado y el resto plegado, que no se pliega solo", async () => {
    const p = await abrir();
    await escribir(p, "Inicio\n    Escribir a\n    Escribir b\n    Escribir c\nFin");
    await esperarTexto(p, ".diag.principal", "'a' no está declarada");
    await esperarTexto(p, "details.diag-resto > summary", "2 problemas más");
    await p.click("details.diag-resto > summary");
    await p.locator(".cm-content").click();
    await p.keyboard.press("ControlOrMeta+End");
    await p.keyboard.type(" ");
    await esperarTexto(p, "#estado", "error");
    assert.equal(await p.locator("details.diag-resto").getAttribute("open"), "");
  });

  test("verificar un ejercicio: la solución de referencia aprueba y una rota no", async () => {
    const p = await abrir();
    await p.selectOption("#selector-ejercicio", "01-area-rectangulo.md");
    await esperarTexto(p, ".cm-content", "area <- base * altura");
    await p.click("#btn-verificar");
    await esperarTexto(p, ".resumen", "Aprobado");

    const roto = (await programa(p)).replace("base * altura", "base + altura");
    await escribir(p, roto);
    await p.click("#btn-verificar");
    await esperarTexto(p, ".resumen.mal", "casos");
  });

  test("en el teléfono: barra de símbolos y sin la lista de atajos", async () => {
    const p = await abrir({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    assert.equal(await p.locator("footer").isVisible(), false);

    await escribir(p, "Inicio\n    Escribir \nFin");
    await p.locator(".cm-line").nth(1).click();
    await p.keyboard.press("End");
    // Tocar la barra no le saca el foco al editor ni por un instante: en un
    // teléfono, ese instante alcanza para que se cierre el teclado.
    await p.evaluate(() => {
      const w = window as unknown as { salidas: number };
      w.salidas = 0;
      document.querySelector(".cm-content")!.addEventListener("focusout", () => w.salidas++);
    });
    await p.tap('#barra-simbolos [data-insertar="()"]');
    await p.keyboard.insertText("1");
    assert.match(await programa(p), /Escribir \(1\)/);
    assert.equal(await p.evaluate(() => (window as unknown as { salidas: number }).salidas), 0);
  });
});
