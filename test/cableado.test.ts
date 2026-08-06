/**
 * Que la interfaz use de verdad las reglas del núcleo.
 *
 * Las reglas puras (permisos, apertura, planilla) están probadas por su lado,
 * pero probar una regla no garantiza que alguien la obedezca. Eso falló: el
 * editor recibía la ranura decidida y seguía calculando la suya por su cuenta,
 * con todas las pruebas en verde, porque ninguna miraba al consumidor.
 *
 * Estas pruebas leen el código de la capa web y comprueban que las decisiones
 * se deleguen en vez de reescribirse. No sustituyen a una prueba de
 * comportamiento —para eso haría falta un navegador— pero atrapan la clase de
 * error que ya ocurrió: una regla que queda escrita dos veces y se desincroniza.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RAIZ = new URL("..", import.meta.url).pathname;
const leer = (ruta: string): string => readFileSync(RAIZ + ruta, "utf8");

describe("el editor delega en las reglas de apertura", () => {
  const editor = leer("web/editor.ts");

  test("usa la función probada para decidir qué texto carga", () => {
    assert.match(
      editor,
      /contenidoAlAbrir\(/,
      "si el editor arma el contenido por su cuenta, las pruebas de apertura no lo cubren",
    );
  });

  test("no vuelve a deducir la ranura del título", () => {
    // Ese cálculo era el bug: al abrir la entrega de otro caía en la clave del
    // título y restauraba la copia local de quien corregía.
    assert.doesNotMatch(
      editor,
      /`md:\$\{titulo\}`/,
      "la ranura la decide comoAbrir; deducirla acá vuelve a desincronizar las dos",
    );
  });

  test("consulta si corresponde guardar en vez de decidirlo suelto", () => {
    assert.match(editor, /seGuardaElAvance\(/);
  });
});

describe("la sala delega en las reglas de permisos", () => {
  const ui = leer("web/nube-ui.ts");

  test("las acciones de cada ítem salen de accionesDeItem", () => {
    assert.match(ui, /accionesDeItem\(/);
  });

  test("las de miembros salen de accionesDeMiembro", () => {
    assert.match(ui, /accionesDeMiembro\(/);
  });

  test("las secciones visibles salen de seccionesVisibles", () => {
    // Esta ya falló una vez: la importación quedó sin usar y la condición vieja
    // seguía en su lugar. Lo detectó el compilador, no una prueba.
    assert.match(ui, /seccionesVisibles\(/);
  });

  test("la clase de apertura no se decide a mano", () => {
    assert.match(ui, /claseDeApertura\(/);
    assert.doesNotMatch(
      ui,
      /tipo === "programa" \? "entrega/,
      "esa distinción vive en src/apertura.ts",
    );
  });
});

describe("cada regla tiene un solo dueño", () => {
  const web = ["web/editor.ts", "web/nube-ui.ts", "web/clase.ts"].map(leer).join("\n");

  test("'soy docente' se calcula en un solo lugar", () => {
    // Estaba en dos: el contexto de permisos y, aparte, lo que se le pasaba al
    // panel de la clase. Dos fuentes de verdad para el rol ya causaron que un
    // alumno viera los botones del docente.
    const veces = (web.match(/\?\.rol === "docente"/g) ?? []).length;
    assert.equal(veces, 1, "el rol debe salir siempre del mismo contexto");
  });

  test("importa las reglas desde el núcleo, no las copia", () => {
    assert.match(web, /from "\.\.\/src\/permisos\.ts"/);
    assert.match(web, /from "\.\.\/src\/apertura\.ts"/);
  });
});

describe("toda acción de la sala responde algo", () => {
  const ui = leer("web/nube-ui.ts");

  test("no queda ninguna acción avisando solo a la consola", () => {
    // La consola del editor está detrás del diálogo desde el cual se disparan
    // estas acciones, así que un mensaje que solo va ahí no lo lee nadie. El
    // único uso legítimo de `enlace.avisar` es el helper que manda a las dos.
    const directas = (ui.match(/enlace\.avisar\(/g) ?? []).length;
    assert.equal(
      directas,
      1,
      "cada acción debe pasar por `avisar`, que muestra el aviso flotante además de registrar",
    );
  });

  test("el helper manda al aviso flotante y a la consola", () => {
    assert.match(ui, /function avisar\([\s\S]*?notificar\(/);
    assert.match(ui, /function avisar\([\s\S]*?enlace\.avisar\(/);
  });

  test("los mensajes no traen saltos de línea propios", () => {
    // El salto lo agrega el helper para la consola; en el aviso flotante sobra
    // y deja una línea vacía.
    const conSalto = ui.match(/\bavisar\((?!mensaje)[^;]*?\\n/g) ?? [];
    assert.deepEqual(conSalto, [], "el salto lo pone el helper, no cada mensaje");
  });

  test("cada rama de un resultado avisa: la buena y la mala", () => {
    // Un error silencioso es peor que uno ruidoso: el usuario cree que
    // funcionó y sigue adelante.
    for (const fn of ["publicarItem", "despublicarItem", "borrarItem", "copiarItem"]) {
      const i = ui.indexOf(`async function ${fn}`);
      assert.notEqual(i, -1, `no encontré ${fn}`);
      const cuerpo = ui.slice(i, ui.indexOf("\n  }", i));
      assert.match(cuerpo, /avisar\(/, `${fn} no responde nada`);
    }
  });
});
