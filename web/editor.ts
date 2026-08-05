/**
 * Punto de entrada del editor web.
 *
 * Une las piezas que ya existen: el lexer y el parser producen diagnósticos, y
 * acá se convierten en subrayados de CodeMirror. Nada de esto necesita
 * servidor: son funciones puras sobre una cadena de texto.
 */
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, crosshairCursor, Decoration, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { linter, lintGutter, type Diagnostic as DiagnosticoCM } from "@codemirror/lint";

import { analizar, compilar, formatear, ANCHO_SANGRIA, type Diagnostico } from "./analisis.ts";
import { lenguajeSeudocodigo } from "./lenguaje.ts";
import { iniciar, visualizar, type Consola, type Controlador, type ControladorPasos } from "./ejecucion.ts";
import type { Instantanea } from "../src/interprete.ts";
import { formatear as formatearDiagnostico } from "../src/diagnostico.ts";
import { cargarEjercicio, cargarIndice, cargarSolucion } from "./ejercicios.ts";
import {
  EXTENSION,
  abrirArchivo,
  conExtension,
  guardar as guardarArchivo,
  guardarComo as guardarArchivoComo,
  leerArchivoSoltado,
  soportaGuardadoDirecto,
  type ArchivoAbierto,
  type ManejadorArchivo,
} from "./archivos.ts";
import {
  correrCaso,
  explicar,
  leerEjercicio,
  verificarSolucion,
  type Ejercicio,
  type ResultadoCaso,
  type ResultadoEjercicio,
} from "../src/ejercicio.ts";
import { iniciarNubeUI, type ControlesNube } from "./nube-ui.ts";
import { icono } from "./iconos.ts";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { diagramasDe } from "../src/diagrama.ts";

/** Punto de partida de un programa en blanco. El cursor va en la línea de adentro. */
const ESQUELETO = "Inicio\n    \nFin\n";

const EJEMPLO = `// Promedio de notas de un grupo, con clasificación.

Funcion promedio <- CalcularPromedio(Por Referencia notas, cantidad Como Entero)
    Definir suma Como Real
    Definir i Como Entero
    suma <- 0
    Para i <- 0 Hasta cantidad - 1 Hacer
        suma <- suma + notas[i]
    FinPara
    promedio <- suma / cantidad
FinFuncion

Procedimiento Clasificar(nota Como Real)
    Si nota >= 9 Entonces
        Escribir "Excelente"
    SiNo Si nota >= 7 Entonces
        Escribir "Aprobado"
    SiNo
        Escribir "Reprobado"
    FinSi
FinProcedimiento

Inicio
    Definir notas Como Arreglo[30] De Real
    Definir cantidad, i Como Entero
    Definir prom Como Real

    Escribir Sin Salto "¿Cuántos alumnos? "
    Leer cantidad

    Mientras cantidad < 1 O cantidad > 30 Hacer
        Escribir "Debe estar entre 1 y 30."
        Leer cantidad
    FinMientras

    Para i <- 0 Hasta cantidad - 1 Hacer
        Escribir Sin Salto "Nota del alumno ", i + 1, ": "
        Leer notas[i]
    FinPara

    prom <- CalcularPromedio(notas, cantidad)
    Escribir "Promedio: ", prom
    Clasificar(prom)
Fin
`;

/** Traduce un diagnóstico nuestro a uno de CodeMirror. */
function aCodeMirror(d: Diagnostico, estado: EditorState): DiagnosticoCM | null {
  const totalLineas = estado.doc.lines;
  if (d.linea < 1 || d.linea > totalLineas) return null;

  const linea = estado.doc.line(d.linea);
  const desde = Math.min(linea.from + Math.max(0, d.columna - 1), linea.to);
  const hasta = Math.min(desde + Math.max(1, d.longitud), linea.to);

  return {
    from: desde,
    to: hasta > desde ? hasta : Math.min(desde + 1, estado.doc.length),
    severity: d.severidad === "error" ? "error" : "warning",
    message: d.sugerencia ? `${d.mensaje}\n${d.sugerencia}` : d.mensaje,
  };
}

const revisor = linter((vista) => {
  const fuente = vista.state.doc.toString();
  return analizar(fuente)
    .map((d) => aCodeMirror(d, vista.state))
    .filter((d): d is DiagnosticoCM => d !== null);
});

/** Comando Formatear: reescribe la sangría conservando la posición del cursor. */
function comandoFormatear(vista: EditorView): boolean {
  const original = vista.state.doc.toString();
  const formateado = formatear(original);
  if (formateado === original) return false;

  const cursor = vista.state.selection.main.head;
  const lineaDelCursor = vista.state.doc.lineAt(cursor).number;
  const columnaRelativa = cursor - vista.state.doc.lineAt(cursor).from;

  vista.dispatch({
    changes: { from: 0, to: original.length, insert: formateado },
  });

  // Reubica el cursor en la misma línea, respetando la sangría nueva.
  const nuevaLinea = vista.state.doc.line(
    Math.min(lineaDelCursor, vista.state.doc.lines),
  );
  const sangria = nuevaLinea.text.length - nuevaLinea.text.trimStart().length;
  vista.dispatch({
    selection: {
      anchor: Math.min(
        nuevaLinea.from + Math.max(sangria, columnaRelativa),
        nuevaLinea.to,
      ),
    },
  });
  return true;
}

// ------------------------------------------------------------------
// Montaje
// ------------------------------------------------------------------

const contenedor = document.querySelector<HTMLElement>("#editor")!;
const panelEstado = document.querySelector<HTMLElement>("#estado")!;
const salida = document.querySelector<HTMLElement>("#salida")!;

function actualizarEstado(fuente: string): void {
  const diags = analizar(fuente);
  const errores = diags.filter((d) => d.severidad === "error");
  const avisos = diags.filter((d) => d.severidad === "advertencia");

  if (errores.length === 0 && avisos.length === 0) {
    panelEstado.className = "estado ok";
    panelEstado.textContent = "Sin errores";
  } else if (errores.length === 0) {
    panelEstado.className = "estado aviso";
    panelEstado.textContent = `${avisos.length} advertencia${avisos.length === 1 ? "" : "s"} de sangría`;
  } else {
    panelEstado.className = "estado error";
    const s = errores.length === 1 ? "" : "es";
    panelEstado.textContent = `${errores.length} error${s}`;
  }

  salida.innerHTML = "";
  if (diags.length === 0) {
    // Sin errores, el panel muestra la corrección de la última verificación si
    // la hay. Es lo que el alumno vino a buscar después de apretar Verificar.
    if (ultimaVerificacion !== null) {
      pintarVerificacion(salida, ultimaVerificacion);
      return;
    }
    const vacio = document.createElement("p");
    vacio.className = "vacio";
    // El texto tiene que nombrar el botón que corresponde: con un ejercicio de
    // casos abierto, mandar a Ejecutar es mandar al lugar equivocado.
    vacio.textContent =
      ejercicioActual !== null && ejercicioActual.casos.length > 0
        ? "Sin problemas. Presioná Verificar para corregir tu solución."
        : "Sin problemas. Presioná Ejecutar.";
    salida.appendChild(vacio);
    return;
  }

  for (const d of diags) {
    const item = document.createElement("div");
    item.className = `diag ${d.severidad}`;
    const cabecera = document.createElement("div");
    cabecera.className = "diag-cabecera";
    cabecera.textContent = `Línea ${d.linea}: ${d.mensaje}`;
    item.appendChild(cabecera);
    if (d.sugerencia !== undefined) {
      const sug = document.createElement("div");
      sug.className = "diag-sugerencia";
      sug.textContent = d.sugerencia;
      item.appendChild(sug);
    }
    item.addEventListener("click", () => {
      const linea = vista.state.doc.line(Math.min(d.linea, vista.state.doc.lines));
      vista.dispatch({
        selection: { anchor: linea.from + Math.max(0, d.columna - 1) },
        scrollIntoView: true,
      });
      vista.focus();
    });
    salida.appendChild(item);
  }
}

// ------------------------------------------------------------------
// Estado del archivo
// ------------------------------------------------------------------

const CLAVE_SESION = "pseudo:sesion";

interface Sesion {
  nombre: string;
  contenido: string;
  /** Contenido en el último guardado, para saber si hay cambios. */
  referencia: string;
}

const elNombre = document.querySelector<HTMLElement>("#nombre-archivo")!;
const marcaSucio = document.querySelector<HTMLElement>("#marca-sucio")!;
const notaGuardado = document.querySelector<HTMLElement>("#nota-guardado")!;

let nombreArchivo = `programa${EXTENSION}`;
let manejadorArchivo: ManejadorArchivo | undefined;
/** Contenido tal como quedó en el último guardado (o al abrir). */
let referenciaGuardada = "";

function hayCambiosSinGuardar(): boolean {
  return vista.state.doc.toString() !== referenciaGuardada;
}

function refrescarCabeceraArchivo(): void {
  elNombre.textContent = nombreArchivo;
  marcaSucio.hidden = !hayCambiosSinGuardar();
}

/**
 * Guarda la sesión en el navegador.
 *
 * No reemplaza al archivo en disco: es una red de seguridad para que recargar
 * la página, o que se corte la luz en el laboratorio, no borre el trabajo. Se
 * guarda también la referencia, así al volver la marca de cambios sin guardar
 * sigue siendo correcta.
 */
/**
 * Clave del ejercicio abierto, para recordar el trabajo de cada uno por separado.
 *
 * El editor tiene un solo documento, así que pasar de un ejercicio a otro pisa
 * lo que había. Avisar antes no alcanza: aunque confirmes, el trabajo se pierde
 * igual y no hay dónde recuperarlo. Guardando por ejercicio, mirar otro y
 * volver deja todo como estaba, que es lo que cualquiera espera.
 *
 * Los de la sala se identifican por su id y los locales por su archivo; ambos
 * son estables entre sesiones.
 */
let claveDelEjercicio: string | null = null;

/**
 * Ranura del programa suelto, el que no pertenece a ningún ejercicio.
 *
 * Sin esto era el único contexto que sí se perdía al cambiar de ejercicio, y
 * era la única razón que le quedaba al aviso de descarte. Dándole su lugar, el
 * modelo queda parejo: cada contexto —cada ejercicio y el programa libre—
 * guarda lo suyo, y no hay nada de qué avisar.
 */
const RANURA_LIBRE = "__libre__";

function claveTrabajo(id: string): string {
  return `pseudo:trabajo:${id}`;
}

function guardarTrabajo(): void {
  try {
    localStorage.setItem(
      claveTrabajo(claveDelEjercicio ?? RANURA_LIBRE),
      vista.state.doc.toString(),
    );
  } catch {
    // Almacenamiento lleno: se pierde el borrador, no el editor.
  }
}

/** Lo que el alumno tenía escrito en ese ejercicio, si alguna vez lo tocó. */
function trabajoGuardado(id: string): string | null {
  try {
    return localStorage.getItem(claveTrabajo(id));
  } catch {
    return null;
  }
}

function recordarSesion(): void {
  guardarTrabajo();
  const sesion: Sesion = {
    nombre: nombreArchivo,
    contenido: vista.state.doc.toString(),
    referencia: referenciaGuardada,
  };
  try {
    localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  } catch {
    // Almacenamiento lleno o deshabilitado: no es motivo para romper el editor.
  }
}

function leerSesion(): Sesion | null {
  try {
    const crudo = localStorage.getItem(CLAVE_SESION);
    if (crudo === null) return null;
    const datos: unknown = JSON.parse(crudo);
    if (
      typeof datos !== "object" ||
      datos === null ||
      typeof (datos as Sesion).contenido !== "string"
    ) {
      return null;
    }
    const sesion = datos as Sesion;
    return {
      nombre: sesion.nombre || `programa${EXTENSION}`,
      contenido: sesion.contenido,
      referencia: typeof sesion.referencia === "string" ? sesion.referencia : sesion.contenido,
    };
  } catch {
    return null;
  }
}

const sesionPrevia = leerSesion();

// --- Resaltado de la línea que el visualizador está por ejecutar ---
const efectoLineaPaso = StateEffect.define<number | null>();

const campoLineaPaso = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const efecto of tr.effects) {
      if (!efecto.is(efectoLineaPaso)) continue;
      if (efecto.value === null) {
        deco = Decoration.none;
      } else {
        const n = Math.max(1, Math.min(efecto.value, tr.state.doc.lines));
        const linea = tr.state.doc.line(n);
        deco = Decoration.set([Decoration.line({ class: "cm-linea-paso" }).range(linea.from)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Resalta la línea `linea` (1-based) y la trae a la vista; `null` la limpia. */
function resaltarLineaPaso(linea: number | null): void {
  const efectos: StateEffect<unknown>[] = [efectoLineaPaso.of(linea)];
  if (linea !== null) {
    const n = Math.max(1, Math.min(linea, vista.state.doc.lines));
    efectos.push(EditorView.scrollIntoView(vista.state.doc.line(n).from, { y: "center" }));
  }
  vista.dispatch({ effects: efectos });
}

const vista = new EditorView({
  parent: contenedor,
  state: EditorState.create({
    doc: sesionPrevia?.contenido ?? EJEMPLO,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      rectangularSelection(),
      crosshairCursor(),
      bracketMatching(),
      history(),
      indentUnit.of(" ".repeat(ANCHO_SANGRIA)),
      lenguajeSeudocodigo(),
      lintGutter(),
      revisor,
      campoLineaPaso,
      keymap.of([
        { key: "Shift-Alt-f", run: comandoFormatear },
        {
          key: "Mod-Enter",
          run: () => {
            void ejecutarPrograma();
            return true;
          },
        },
        {
          key: "Mod-Shift-Enter",
          run: () => {
            verificar();
            return true;
          },
        },
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            void accionGuardar(false);
            return true;
          },
        },
        {
          key: "Mod-o",
          preventDefault: true,
          run: () => {
            void accionAbrir();
            return true;
          },
        },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        const fuente = u.state.doc.toString();
        // La corrección era de otro código: mostrarla ahora sería mentir.
        ultimaVerificacion = null;
        actualizarEstado(fuente);
        ajustarPanelInferior();
        refrescarCabeceraArchivo();
        recordarSesion();
        // Si se edita mientras corre, lo que corre ya no es este programa.
        if (corriendo !== null) {
          corriendo.detener();
          resolverEntrada?.(undefined);
          resolverEntrada = null;
        }
        if (visualizador !== null) detenerVisualizacion();
      }),
      EditorView.theme({
        "&": { fontSize: "14px", height: "100%" },
        ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
        ".cm-content": { padding: "12px 0" },
        ".cm-gutters": {
          background: "transparent",
          border: "none",
          color: "var(--tenue)",
        },
        ".cm-activeLineGutter": { background: "transparent", color: "var(--texto)" },
        ".cm-activeLine": { background: "var(--linea-activa)" },
        ".cm-linea-paso": { backgroundColor: "var(--paso-resaltado)" },
      }),
    ],
  }),
});

// ------------------------------------------------------------------
// Ejecución
// ------------------------------------------------------------------

const consola = document.querySelector<HTMLElement>("#consola")!;
const filaEntrada = document.querySelector<HTMLElement>("#fila-entrada")!;
const campoEntrada = document.querySelector<HTMLInputElement>("#campo-entrada")!;
const etiquetaEntrada = document.querySelector<HTMLElement>("#etiqueta-entrada")!;
const btnEjecutar = document.querySelector<HTMLButtonElement>("#btn-ejecutar")!;
const btnDetener = document.querySelector<HTMLButtonElement>("#btn-detener")!;
const btnEnviar = document.querySelector<HTMLButtonElement>("#btn-enviar")!;
const btnPaso = document.querySelector<HTMLButtonElement>("#btn-paso")!;
const barraPaso = document.querySelector<HTMLElement>("#barra-paso")!;
const btnPasoSiguiente = document.querySelector<HTMLButtonElement>("#btn-paso-siguiente")!;
const btnPasoPlay = document.querySelector<HTMLButtonElement>("#btn-paso-play")!;
const pasoVelocidad = document.querySelector<HTMLInputElement>("#paso-velocidad")!;
const panelVariables = document.querySelector<HTMLElement>("#variables")!;

let corriendo: Controlador | null = null;
let resolverEntrada: ((valor: string | undefined) => void) | null = null;
let visualizador: ControladorPasos | null = null;
let visualizando = false;
let intervaloPlay: number | null = null;

function anexar(texto: string, clase?: string): void {
  const nodo = document.createElement("span");
  if (clase !== undefined) nodo.className = clase;
  nodo.textContent = texto;
  consola.appendChild(nodo);
  consola.scrollTop = consola.scrollHeight;
}

function mostrarEntrada(visible: boolean, etiqueta = "Valor:"): void {
  filaEntrada.hidden = !visible;
  etiquetaEntrada.textContent = etiqueta;
  if (visible) {
    campoEntrada.value = "";
    campoEntrada.focus();
  }
}

function enviarEntrada(): void {
  if (resolverEntrada === null) return;
  const valor = campoEntrada.value;
  anexar(valor + "\n", "eco");
  const resolver = resolverEntrada;
  resolverEntrada = null;
  mostrarEntrada(false);
  resolver(valor);
}

btnEnviar.addEventListener("click", enviarEntrada);
campoEntrada.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    enviarEntrada();
  }
});

const consolaDelPrograma: Consola = {
  escribir(texto, sinSalto) {
    anexar(texto + (sinSalto ? "" : "\n"));
  },
  pedir(peticion) {
    if (peticion.reintento !== undefined) anexar(peticion.reintento + "\n", "aviso");
    mostrarEntrada(true, `${peticion.nombreVariable} (${peticion.tipoEsperado}):`);
    return new Promise((resolver) => {
      resolverEntrada = resolver;
    });
  },
  paso(evento) {
    renderVariables(evento.variables);
    resaltarLineaPaso(evento.pos.linea);
  },
};

function terminarEjecucion(): void {
  corriendo = null;
  resolverEntrada = null;
  mostrarEntrada(false);
  btnEjecutar.hidden = false;
  btnPaso.hidden = false;
  btnDetener.hidden = true;
}

async function ejecutarPrograma(): Promise<void> {
  if (corriendo !== null || visualizador !== null) return;

  const fuente = vista.state.doc.toString();
  const compilado = compilar(fuente);

  consola.textContent = "";

  if (!compilado.ok) {
    const n = compilado.diagnosticos.length;
    anexar(
      `No se puede ejecutar: ${n} ${n === 1 ? "error" : "errores"}. Están en el panel de abajo.\n`,
      "roto",
    );
    const primero = compilado.diagnosticos[0]!;
    const linea = vista.state.doc.line(Math.min(primero.linea, vista.state.doc.lines));
    vista.dispatch({
      selection: { anchor: linea.from + Math.max(0, primero.columna - 1) },
      scrollIntoView: true,
    });
    vista.focus();
    return;
  }

  btnEjecutar.hidden = true;
  btnPaso.hidden = true;
  btnDetener.hidden = false;

  corriendo = iniciar(compilado.programa, consolaDelPrograma);
  const resultado = await corriendo.terminada;
  terminarEjecucion();

  if (resultado === null) {
    anexar("\n— detenido —\n", "fin");
  } else if (resultado.clase === "error") {
    anexar("\n" + formatearDiagnostico(resultado.diagnostico) + "\n", "roto");
    const linea = vista.state.doc.line(
      Math.min(resultado.diagnostico.linea, vista.state.doc.lines),
    );
    vista.dispatch({
      selection: { anchor: linea.from + Math.max(0, resultado.diagnostico.columna - 1) },
      scrollIntoView: true,
    });
  } else {
    anexar(`\n— terminó (${resultado.pasos.toLocaleString("es")} pasos) —\n`, "fin");
  }
}

btnEjecutar.addEventListener("click", () => void ejecutarPrograma());
btnDetener.addEventListener("click", () => {
  corriendo?.detener();
  visualizador?.detener();
  // Si estaba esperando entrada, hay que despertar la promesa.
  resolverEntrada?.(undefined);
  resolverEntrada = null;
});

// ------------------------------------------------------------------
// Paso a paso
// ------------------------------------------------------------------

/** Dibuja el estado de las variables: simples como valor, arreglos en celdas. */
function renderVariables(variables: Instantanea[]): void {
  panelVariables.textContent = "";

  if (variables.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "vacio";
    vacio.textContent = "Todavía no hay variables en este alcance.";
    panelVariables.appendChild(vacio);
    return;
  }

  for (const v of variables) {
    const bloque = document.createElement("div");
    bloque.className = "var";

    const cabecera = document.createElement("div");
    cabecera.className = "var-cabecera";
    const nombre = document.createElement("span");
    nombre.className = "var-nombre";
    nombre.textContent = v.nombre;
    const tipo = document.createElement("span");
    tipo.className = "var-tipo";
    tipo.textContent = v.tipo;
    cabecera.append(nombre, tipo);
    bloque.appendChild(cabecera);

    if (v.celdas !== undefined) {
      const arreglo = document.createElement("div");
      arreglo.className = "arreglo";
      v.celdas.forEach((celda, i) => {
        const caja = document.createElement("div");
        caja.className = "celda";
        const idx = document.createElement("span");
        idx.className = "idx";
        idx.textContent = String(i);
        const val = document.createElement("span");
        val.className = celda === null ? "val vacia" : "val";
        val.textContent = celda ?? "—";
        caja.append(idx, val);
        arreglo.appendChild(caja);
      });
      bloque.appendChild(arreglo);
    } else {
      const valor = document.createElement("div");
      valor.className = v.valor === null ? "var-valor sinvalor" : "var-valor";
      valor.textContent = v.valor ?? "sin valor";
      bloque.appendChild(valor);
    }

    panelVariables.appendChild(bloque);
  }
}

function detenerPlay(): void {
  if (intervaloPlay !== null) {
    clearInterval(intervaloPlay);
    intervaloPlay = null;
  }
  btnPasoPlay.textContent = "Reproducir";
}

/** Alterna la reproducción automática. El slider (1..10) fija la demora. */
function alternarPlay(): void {
  if (visualizador === null) return;
  if (intervaloPlay !== null) {
    detenerPlay();
    return;
  }
  const nivel = Number(pasoVelocidad.value);
  const demora = 1100 - nivel * 100; // 1000 ms (lento) .. 100 ms (rápido)
  btnPasoPlay.textContent = "Pausar";
  intervaloPlay = window.setInterval(() => visualizador?.siguiente(), demora);
}

/** Restablece la interfaz cuando la visualización termina o se corta. */
function limpiarVisualizacion(): void {
  detenerPlay();
  visualizando = false;
  visualizador = null;
  resaltarLineaPaso(null);
  barraPaso.hidden = true;
  btnDetener.hidden = true;
  btnEjecutar.hidden = false;
  btnPaso.hidden = false;
  mostrarEntrada(false);
  resolverEntrada = null;
  ajustarPanelInferior();
}

/** Corta la visualización en curso (botón Detener o edición del código). */
function detenerVisualizacion(): void {
  visualizador?.detener();
  resolverEntrada?.(undefined);
  resolverEntrada = null;
}

async function iniciarVisualizacion(): Promise<void> {
  if (corriendo !== null || visualizador !== null) return;

  const compilado = compilar(vista.state.doc.toString());
  consola.textContent = "";

  if (!compilado.ok) {
    const n = compilado.diagnosticos.length;
    anexar(
      `No se puede ejecutar: ${n} ${n === 1 ? "error" : "errores"}. Están en el panel de abajo.\n`,
      "roto",
    );
    return;
  }

  visualizando = true;
  btnEjecutar.hidden = true;
  btnPaso.hidden = true;
  btnDetener.hidden = false;
  barraPaso.hidden = false;
  btnPasoPlay.textContent = "Reproducir";
  panelVariables.textContent = "";
  ajustarPanelInferior();
  anexar("Paso a paso: usá «Siguiente» o «Reproducir». La línea actual va resaltada.\n", "fin");

  visualizador = visualizar(compilado.programa, consolaDelPrograma);
  const resultado = await visualizador.terminada;
  limpiarVisualizacion();

  if (resultado === null) {
    anexar("\n— detenido —\n", "fin");
  } else if (resultado.clase === "error") {
    anexar("\n" + formatearDiagnostico(resultado.diagnostico) + "\n", "roto");
  } else {
    anexar(`\n— terminó (${resultado.pasos.toLocaleString("es")} pasos) —\n`, "fin");
  }
}

btnPaso.addEventListener("click", () => void iniciarVisualizacion());
btnPasoSiguiente.addEventListener("click", () => {
  detenerPlay(); // un paso a mano pausa la reproducción
  visualizador?.siguiente();
});
btnPasoPlay.addEventListener("click", alternarPlay);

// ------------------------------------------------------------------
// Ejercicios
// ------------------------------------------------------------------

const selector = document.querySelector<HTMLSelectElement>("#selector-ejercicio")!;
const btnVerificar = document.querySelector<HTMLButtonElement>("#btn-verificar")!;
const panelEnunciado = document.querySelector<HTMLElement>("#enunciado")!;
const tituloPanelInferior = document.querySelector<HTMLElement>("#titulo-panel-inferior")!;
const pestanas = document.querySelector<HTMLElement>("#pestanas-panel")!;
const pestanaEjercicio = document.querySelector<HTMLButtonElement>("#pestana-ejercicio")!;
const pestanaProblemas = document.querySelector<HTMLButtonElement>("#pestana-problemas")!;

pestanaEjercicio.addEventListener("click", () => mirarPestana("enunciado"));
pestanaProblemas.addEventListener("click", () => mirarPestana("problemas"));

let ejercicioActual: Ejercicio | null = null;

/** Renderiza el enunciado. Solo se interpretan bloques ``` y párrafos. */
function mostrarEnunciado(ejercicio: Ejercicio): void {
  // Abrir un ejercicio es pedir leerlo: la pestaña vuelve al enunciado aunque
  // el alumno estuviera mirando los problemas del ejercicio anterior.
  pestanaPanel = "enunciado";
  panelEnunciado.innerHTML = "";

  const titulo = document.createElement("h3");
  titulo.textContent = ejercicio.titulo;
  panelEnunciado.appendChild(titulo);

  for (const trozo of ejercicio.enunciado.split(/```/)) {
    const limpio = trozo.replace(/^\w*\n/, "").trim();
    if (limpio === "") continue;
    const esBloque = /^\w*\n/.test(trozo) || trozo.startsWith("\n");
    const nodo = document.createElement(esBloque ? "pre" : "p");
    nodo.textContent = limpio;
    panelEnunciado.appendChild(nodo);
  }

  const nota = document.createElement("p");
  nota.style.color = "var(--tenue)";
  const n = ejercicio.casos.length;
  nota.textContent =
    n === 0
      ? "Sin casos de prueba: resolvelo y probalo con Ejecutar."
      : `${n} ${n === 1 ? "caso" : "casos"} de prueba · comparación ${ejercicio.comparacion}`;
  panelEnunciado.appendChild(nota);
}

/** Con un ejercicio abierto, qué pestaña del panel inferior se está mirando. */
let pestanaPanel: "enunciado" | "problemas" = "enunciado";

/**
 * Decide qué muestra el panel inferior.
 *
 * Antes los errores tapaban el enunciado, y resultó ser justo al revés de lo
 * que hace falta: el alumno casi siempre tiene errores *mientras* resuelve, que
 * es exactamente cuando necesita leer la consigna. Ahora, con un ejercicio
 * abierto, el panel tiene dos pestañas y manda el alumno; los errores no
 * desaparecen (siguen subrayados en el editor y contados en la pestaña).
 */
function ajustarPanelInferior(): void {
  // Mientras se visualiza, el panel muestra las variables por encima de todo.
  if (visualizando) {
    panelVariables.hidden = false;
    salida.hidden = true;
    panelEnunciado.hidden = true;
    pestanas.hidden = true;
    tituloPanelInferior.hidden = false;
    tituloPanelInferior.textContent = "Variables";
    return;
  }
  panelVariables.hidden = true;

  const errores = analizar(vista.state.doc.toString()).filter(
    (d) => d.severidad === "error",
  ).length;

  // Sin ejercicio abierto no hay nada que elegir: el panel son los problemas.
  if (ejercicioActual === null) {
    pestanas.hidden = true;
    tituloPanelInferior.hidden = false;
    tituloPanelInferior.textContent = "Problemas";
    panelEnunciado.hidden = true;
    salida.hidden = false;
    return;
  }

  pestanas.hidden = false;
  tituloPanelInferior.hidden = true;

  const enEnunciado = pestanaPanel === "enunciado";
  panelEnunciado.hidden = !enEnunciado;
  salida.hidden = enEnunciado;
  pestanaEjercicio.setAttribute("aria-selected", String(enEnunciado));
  pestanaProblemas.setAttribute("aria-selected", String(!enEnunciado));

  // El contador es lo que evita que esconder la lista se sienta como perderla.
  pestanaProblemas.textContent = "Problemas";
  if (errores > 0) {
    const cuenta = document.createElement("span");
    cuenta.className = "cuenta";
    cuenta.textContent = ` ${errores}`;
    pestanaProblemas.appendChild(cuenta);
  }
}

function mirarPestana(cual: "enunciado" | "problemas"): void {
  pestanaPanel = cual;
  ajustarPanelInferior();
}

function claseDeCaso(caso: ResultadoCaso): string {
  if (caso.estado === "bien") return "bien";
  return caso.estado === "entrada-rechazada" ? "duda" : "mal";
}

function verificar(): void {
  if (ejercicioActual === null || visualizador !== null || corriendo !== null) return;

  const compilado = compilar(vista.state.doc.toString());

  if (!compilado.ok) {
    // Los errores ya están listados en la pestaña Problemas; llevarlo ahí dice
    // más que un mensaje contando cuántos son.
    ultimaVerificacion = null;
    pestanaPanel = "problemas";
    ajustarPanelInferior();
    return;
  }

  const resultado = verificarSolucion(compilado.programa, ejercicioActual, {
    limitePasos: 500_000,
  });

  // El resultado se guarda y se dibuja en la pestaña Problemas, que es donde el
  // alumno está mirando: leyó la consigna, escribió, y ahora quiere saber qué
  // falló. Mandarlo al panel de salida de arriba lo obligaba a buscarlo en otro
  // lado, justo en el momento de mayor frustración.
  ultimaVerificacion = resultado;
  if (idEjercicioRemoto !== null) {
    controlesNube.registrarResultado(
      idEjercicioRemoto,
      resultado.aprobados,
      resultado.total,
      resultado.casos.filter((c) => c.estado !== "bien").map((c) => c.nombre),
    );
  }
  pestanaPanel = "problemas";
  actualizarEstado(vista.state.doc.toString());
  ajustarPanelInferior();
}

/** Id del ejercicio de la sala que está abierto, para poder reportar el progreso. */
let idEjercicioRemoto: string | null = null;
let controlesNube: ControlesNube = { registrarResultado: () => {} };

/** Resultado de la última verificación, mientras el código no cambie. */
let ultimaVerificacion: ResultadoEjercicio | null = null;

function pintarVerificacion(destino: HTMLElement, resultado: ResultadoEjercicio): void {
  const resumen = document.createElement("div");
  resumen.className = `resumen ${resultado.aprobado ? "bien" : "mal"}`;
  resumen.textContent = resultado.aprobado
    ? `Aprobado: ${resultado.aprobados} de ${resultado.total} casos.`
    : `${resultado.aprobados} de ${resultado.total} casos.`;
  destino.appendChild(resumen);

  for (const caso of resultado.casos) {
    const tarjeta = document.createElement("div");
    tarjeta.className = `caso ${claseDeCaso(caso)}`;

    const nombre = document.createElement("div");
    nombre.className = "caso-nombre";
    nombre.textContent = `${caso.estado === "bien" ? "✓" : "✗"} ${caso.nombre}`;
    tarjeta.appendChild(nombre);

    if (caso.estado !== "bien") {
      const detalle = document.createElement("div");
      detalle.className = "caso-detalle";
      detalle.textContent = explicar(caso);
      tarjeta.appendChild(detalle);

      if (caso.estado === "salida-distinta") {
        const dl = document.createElement("dl");
        dl.className = "caso-diff";
        const agregar = (etiqueta: string, lineas: string[], marcar: number | null): void => {
          const dt = document.createElement("dt");
          dt.textContent = etiqueta;
          const dd = document.createElement("dd");
          dd.textContent =
            lineas.length === 0
              ? "(nada)"
              : lineas.map((l, i) => (i === marcar ? `» ${l}` : `  ${l}`)).join("\n");
          dl.append(dt, dd);
        };
        agregar("esperado", caso.comparacion.esperadoNormalizado, null);
        agregar(
          "obtenido",
          caso.comparacion.obtenidoNormalizado,
          // En modo 'contiene' el índice se refiere a la salida esperada, no a
          // la obtenida: marcar con él señalaría una línea al azar.
          caso.comparacion.modo === "contiene" ? null : caso.comparacion.primeraDiferencia,
        );
        tarjeta.appendChild(dl);
      }

      if (caso.diagnostico !== undefined) {
        const irA = document.createElement("button");
        irA.textContent = `Ir a la línea ${caso.diagnostico.linea}`;
        irA.style.marginTop = "6px";
        const destino = caso.diagnostico;
        irA.addEventListener("click", () => {
          const linea = vista.state.doc.line(Math.min(destino.linea, vista.state.doc.lines));
          vista.dispatch({ selection: { anchor: linea.from }, scrollIntoView: true });
          vista.focus();
        });
        tarjeta.appendChild(irA);
      }
    }

    destino.appendChild(tarjeta);
  }
}

/** Ejercicio elegido en el selector, para poder revertirlo si se cancela. */
let ejercicioSeleccionado = "";

/**
 * Carga y muestra el enunciado de un ejercicio, sin tocar el editor.
 *
 * Es la parte común entre elegir un ejercicio y restaurarlo al recargar la
 * página: en la restauración no hay que pisar el código que el alumno tenía.
 */
async function mostrarEjercicio(archivo: string): Promise<boolean> {
  const cargado = await cargarEjercicio(archivo);
  if (!cargado.ok) {
    ejercicioActual = null;
    btnVerificar.hidden = true;
    ajustarPanelInferior();
    anexar(cargado.mensaje + "\n", "roto");
    return false;
  }
  idEjercicioRemoto = null;
  ejercicioActual = cargado.ejercicio;
  // Sin casos no hay nada que corregir: ofrecer Verificar sería prometer algo
  // que el ejercicio no puede cumplir.
  btnVerificar.hidden = cargado.ejercicio.casos.length === 0;
  mostrarEnunciado(cargado.ejercicio);
  ajustarPanelInferior();
  return true;
}

/** Vuelve al estado "sin ejercicio": limpia el selector, el enunciado y Verificar. */
function deseleccionarEjercicio(): void {
  // Se guarda antes de soltar la clave: cerrar un ejercicio no puede perder lo
  // que había escrito en él.
  guardarTrabajo();
  claveDelEjercicio = null;
  idEjercicioRemoto = null;
  selector.value = "";
  ejercicioActual = null;
  ejercicioSeleccionado = "";
  btnVerificar.hidden = true;
  ajustarPanelInferior();
  localStorage.removeItem("pseudo:ejercicio");
}

selector.addEventListener("change", () => {
  const archivo = selector.value;

  if (archivo === "") {
    // Volver a "Sin ejercicio" devuelve el programa suelto en el que estabas,
    // igual que abrir un ejercicio devuelve el suyo.
    guardarTrabajo();
    deseleccionarEjercicio();
    const libre = trabajoGuardado(RANURA_LIBRE);
    if (libre !== null && libre !== vista.state.doc.toString()) {
      nombreArchivo = conExtension("programa");
      manejadorArchivo = undefined;
      reemplazarContenido(libre);
      referenciaGuardada = libre;
      refrescarCabeceraArchivo();
      anexar("Volviste a tu programa.\n", "fin");
    }
    return;
  }

  // Elegir un ejercicio carga su solución de referencia en el editor y pisa lo
  // que hubiera. Se avisa antes para no perder trabajo sin guardar; si se
  // cancela, el selector vuelve a lo que estaba y no cambia nada.
  if (!confirmarDescarte("Cargar este ejercicio")) {
    selector.value = ejercicioSeleccionado;
    return;
  }

  void (async () => {
    consola.textContent = "";
    if (!(await mostrarEjercicio(archivo))) {
      selector.value = "";
      ejercicioSeleccionado = "";
      localStorage.removeItem("pseudo:ejercicio");
      return;
    }

    const solucion = await cargarSolucion(archivo);
    if (solucion.ok) {
      // Lo tuyo gana sobre la solución de referencia: si ya trabajaste en este
      // ejercicio, volver no puede borrarte lo escrito.
      const previo = trabajoGuardado(archivo);
      const contenido = previo ?? solucion.codigo;

      guardarTrabajo();
      // El contenido cargado pasa a ser la base: se desliga de cualquier
      // archivo abierto y recién cuenta como "sin guardar" al editarlo.
      nombreArchivo = archivo.replace(/\.md$/i, ".psc");
      manejadorArchivo = undefined;
      claveDelEjercicio = archivo;
      referenciaGuardada = contenido;
      reemplazarContenido(contenido);
      if (previo !== null) anexar("Se recuperó lo que tenías escrito acá.\n", "fin");
    } else {
      anexar(solucion.mensaje + "\n", "roto");
    }

    ajustarPanelInferior();
    ejercicioSeleccionado = archivo;
    localStorage.setItem("pseudo:ejercicio", archivo);
    recordarSesion();
    vista.focus();
  })();
});

btnVerificar.addEventListener("click", verificar);

void (async () => {
  const indice = await cargarIndice();
  for (const entrada of indice) {
    const opcion = document.createElement("option");
    opcion.value = entrada.archivo;
    opcion.textContent = entrada.titulo;
    selector.appendChild(opcion);
  }
  const guardado = localStorage.getItem("pseudo:ejercicio");
  if (guardado !== null && indice.some((e) => e.archivo === guardado)) {
    // Al recargar solo se restaura el enunciado: el editor conserva la sesión
    // del alumno. Volver a cargar la solución acá pisaría lo que estaba.
    selector.value = guardado;
    ejercicioSeleccionado = guardado;
    await mostrarEjercicio(guardado);
  }
})();

// ------------------------------------------------------------------
// Abrir y guardar
// ------------------------------------------------------------------

const btnAbrir = document.querySelector<HTMLButtonElement>("#btn-abrir")!;
const btnGuardar = document.querySelector<HTMLButtonElement>("#btn-guardar")!;
const btnGuardarComo = document.querySelector<HTMLButtonElement>("#btn-guardar-como")!;

notaGuardado.textContent = soportaGuardadoDirecto()
  ? "Guardar sobrescribe el archivo abierto"
  : "en este navegador, Guardar descarga una copia";

/** Pide confirmación si hay cambios sin guardar. `true` = seguir adelante. */
/**
 * Pide confirmación solo cuando de verdad se va a perder algo.
 *
 * Con un ejercicio abierto, lo escrito queda guardado bajo su propia clave y
 * vuelve al reabrirlo, así que preguntar "se van a perder" sería mentira —y una
 * mentira que enseña a ignorar los avisos, que es lo peor que puede pasarle a
 * un aviso—. Se pregunta cuando hay un archivo de disco abierto, porque ahí lo
 * que quedó viejo es el archivo y guardarlo sigue siendo decisión de quien
 * escribe.
 */
function confirmarDescarte(accion: string): boolean {
  if (!hayCambiosSinGuardar()) return true;

  // Todo contexto guarda lo suyo, así que cambiar de uno a otro no pierde nada.
  // Lo único que queda viejo es el archivo abierto en disco, y guardarlo sigue
  // siendo decisión de quien escribe.
  if (manejadorArchivo === undefined) {
    guardarTrabajo();
    return true;
  }

  return confirm(
    `Hay cambios sin guardar en '${nombreArchivo}'.\n\n¿${accion} de todos modos? Se van a perder.`,
  );
}

function reemplazarContenido(texto: string): void {
  vista.dispatch({
    changes: { from: 0, to: vista.state.doc.length, insert: texto },
    selection: { anchor: 0 },
  });
}

function adoptarArchivo(archivo: ArchivoAbierto): void {
  nombreArchivo = archivo.nombre;
  manejadorArchivo = archivo.manejador;
  reemplazarContenido(archivo.contenido);
  referenciaGuardada = archivo.contenido;
  refrescarCabeceraArchivo();
  recordarSesion();
  consola.textContent = "";
  anexar(`Se abrió ${archivo.nombre}.\n`, "fin");
  vista.focus();
}

async function accionAbrir(): Promise<void> {
  if (!confirmarDescarte("Abrir otro archivo")) return;
  const archivo = await abrirArchivo();
  if (archivo === null) return;
  adoptarArchivo(archivo);
}

async function accionGuardar(comoNuevo = false): Promise<void> {
  const contenido = vista.state.doc.toString();
  const resultado = comoNuevo
    ? await guardarArchivoComo(contenido, nombreArchivo)
    : await guardarArchivo(contenido, nombreArchivo, manejadorArchivo);

  if (resultado.estado === "cancelado") return;

  nombreArchivo = resultado.nombre;
  if (resultado.estado === "guardado") {
    manejadorArchivo = resultado.manejador;
  }
  // La descarga es un guardado real desde el punto de vista del alumno: el
  // archivo quedó en su carpeta de descargas.
  referenciaGuardada = contenido;
  refrescarCabeceraArchivo();
  recordarSesion();

  anexar(
    resultado.estado === "descargado"
      ? `Se descargó ${resultado.nombre}. Buscalo en tu carpeta de descargas.\n`
      : `Se guardó ${resultado.nombre}.\n`,
    "fin",
  );
}

btnAbrir.addEventListener("click", () => void accionAbrir());
btnGuardar.addEventListener("click", () => void accionGuardar(false));
btnGuardarComo.addEventListener("click", () => void accionGuardar(true));

// --- Soltar un archivo sobre el editor ---
const envoltorio = document.querySelector<HTMLElement>("#envoltorio-editor")!;
const zonaSoltar = document.querySelector<HTMLElement>("#zona-soltar")!;
let profundidadArrastre = 0;

function traeArchivos(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

envoltorio.addEventListener("dragenter", (e) => {
  if (!traeArchivos(e)) return;
  e.preventDefault();
  profundidadArrastre++;
  zonaSoltar.classList.add("visible");
});
envoltorio.addEventListener("dragover", (e) => {
  if (traeArchivos(e)) e.preventDefault();
});
envoltorio.addEventListener("dragleave", () => {
  // 'dragleave' también salta al pasar de un hijo a otro: se cuenta la anidación.
  profundidadArrastre = Math.max(0, profundidadArrastre - 1);
  if (profundidadArrastre === 0) zonaSoltar.classList.remove("visible");
});
envoltorio.addEventListener("drop", (e) => {
  if (!traeArchivos(e)) return;
  e.preventDefault();
  profundidadArrastre = 0;
  zonaSoltar.classList.remove("visible");

  const archivo = e.dataTransfer?.files?.[0];
  if (archivo === undefined) return;
  if (!confirmarDescarte("Abrir el archivo soltado")) return;

  void leerArchivoSoltado(archivo).then(adoptarArchivo);
});

// --- Aviso al cerrar la pestaña con cambios sin guardar ---
window.addEventListener("beforeunload", (e) => {
  if (!hayCambiosSinGuardar()) return;
  e.preventDefault();
  // Los navegadores muestran su propio texto; lo que importa es cancelar.
  e.returnValue = "";
});

document.querySelector("#btn-formatear")!.addEventListener("click", () => {
  comandoFormatear(vista);
  vista.focus();
});

document.querySelector("#btn-ejemplo")!.addEventListener("click", () => {
  if (!confirmarDescarte("Cargar el ejemplo")) return;
  reemplazarContenido(EJEMPLO);
  vista.focus();
});

document.querySelector("#btn-limpiar")!.addEventListener("click", () => {
  if (!confirmarDescarte("Empezar un programa nuevo")) return;
  nombreArchivo = conExtension("programa");
  manejadorArchivo = undefined;
  vista.dispatch({
    changes: { from: 0, to: vista.state.doc.length, insert: ESQUELETO },
    selection: { anchor: 11 },
  });
  referenciaGuardada = "";
  // Empezar un programa nuevo también sale del ejercicio: el selector, el
  // enunciado y el resultado de la última verificación ya no vienen al caso.
  deseleccionarEjercicio();
  consola.textContent = "";
  refrescarCabeceraArchivo();
  recordarSesion();
  vista.focus();
});

if (sesionPrevia !== null) {
  nombreArchivo = sesionPrevia.nombre;
  referenciaGuardada = sesionPrevia.referencia;
} else {
  // Primera visita: el ejemplo no cuenta como trabajo sin guardar.
  referenciaGuardada = EJEMPLO;
}
refrescarCabeceraArchivo();
actualizarEstado(vista.state.doc.toString());

// ------------------------------------------------------------------
// Diagrama de flujo
// ------------------------------------------------------------------

const dialogoDiagrama = document.querySelector<HTMLDialogElement>("#dialogo-diagrama")!;
const cuerpoDiagrama = document.querySelector<HTMLElement>("#diagrama-cuerpo")!;

/**
 * Dibuja el diagrama del programa que hay en el editor.
 *
 * Necesita el árbol, así que exige que la sintaxis esté bien: no se puede
 * diagramar lo que no se entiende. Los errores de tipos, en cambio, no
 * molestan —un diagrama de un programa con una variable sin declarar sigue
 * siendo un diagrama correcto—, y por eso se parte del parser y no de
 * `compilar`, que además exige el chequeo semántico.
 */
function mostrarDiagrama(): void {
  const fuente = vista.state.doc.toString();
  const { tokens, errores: lexicos } = tokenizar(fuente);
  const { programa, errores: sintacticos } = parsear(tokens);
  const rotos = [...lexicos, ...sintacticos];

  cuerpoDiagrama.textContent = "";

  if (rotos.length > 0) {
    const aviso = document.createElement("p");
    aviso.className = "vacio";
    aviso.textContent =
      `No puedo dibujar el diagrama todavía: hay ${rotos.length} ` +
      `${rotos.length === 1 ? "error de sintaxis" : "errores de sintaxis"}. ` +
      `Corregilos y volvé a intentar.`;
    cuerpoDiagrama.appendChild(aviso);
    dialogoDiagrama.showModal();
    return;
  }

  for (const d of diagramasDe(programa)) {
    const caja = document.createElement("div");
    // El SVG viene de nuestro propio generador y escapa el texto del usuario;
    // aun así se inserta en un contenedor propio para no tocar el resto.
    caja.innerHTML = d.svg;
    cuerpoDiagrama.appendChild(caja);
  }
  dialogoDiagrama.showModal();
}

function descargarDiagrama(): void {
  const svg = cuerpoDiagrama.querySelector("svg");
  if (svg === null) return;
  const blob = new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo.replace(/\.psc$/i, "") + "-diagrama.svg";
  a.click();
  URL.revokeObjectURL(url);
}

document.querySelector<HTMLButtonElement>("#btn-diagrama")!.addEventListener("click", mostrarDiagrama);
document
  .querySelector<HTMLButtonElement>("#btn-cerrar-diagrama")!
  .addEventListener("click", () => dialogoDiagrama.close());
document
  .querySelector<HTMLButtonElement>("#btn-bajar-diagrama")!
  .addEventListener("click", descargarDiagrama);

// ------------------------------------------------------------------
// Barra de herramientas
// ------------------------------------------------------------------

/**
 * Pone el icono y envuelve el texto de cada botón en un `<span>`.
 *
 * El `<span>` es lo que permite esconder solo el texto en pantallas angostas y
 * dejar el icono: sin él habría que duplicar el rótulo en un atributo. Se hace
 * desde acá y no en el HTML para que exista un solo juego de iconos.
 */
for (const [selector, nombre] of [
  ["#btn-abrir", "abrir"],
  ["#btn-guardar", "guardar"],
  ["#btn-guardar-como", "guardar"],
  ["#btn-formatear", "formatear"],
  ["#btn-ejemplo", "ejemplo"],
  ["#btn-limpiar", "nuevo"],
  ["#btn-ejecutar", "ejecutar"],
  ["#btn-detener", "detener"],
  ["#btn-paso", "pasos"],
  ["#btn-verificar", "verificar"],
  ["#btn-diagrama", "diagrama"],
  ["#btn-cerrar-diagrama", "cerrar"],
  ["#btn-bajar-diagrama", "bajar"],
  ["#menu-archivo > summary", "opciones"],
] as const) {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) continue;
  const rotulo = el.textContent?.trim() ?? "";
  el.textContent = "";
  el.appendChild(icono(nombre, 14));
  if (rotulo !== "") {
    const span = document.createElement("span");
    span.textContent = rotulo;
    el.appendChild(span);
  }
}

// El <details> abre y cierra solo, pero no se entera de los clics de afuera, y
// un menú que queda abierto tapando la pantalla se siente roto.
const menuArchivo = document.querySelector<HTMLDetailsElement>("#menu-archivo")!;
document.addEventListener("click", (e) => {
  if (menuArchivo.open && !menuArchivo.contains(e.target as Node)) menuArchivo.open = false;
});
menuArchivo.addEventListener("click", (e) => {
  // Elegir una opción cierra el menú; el clic en el propio '⋯' no.
  if ((e.target as HTMLElement).closest(".menu-panel") !== null) menuArchivo.open = false;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menuArchivo.open) menuArchivo.open = false;
});

// ------------------------------------------------------------------
// Sala de clase (opcional)
// ------------------------------------------------------------------

// Si no hay `nube.json`, `iniciarNubeUI` no hace nada y el botón queda oculto:
// el editor funciona igual sin internet ni cuenta, que es la idea.
void iniciarNubeUI({
  codigoActual: () => vista.state.doc.toString(),
  nombreActual: () => nombreArchivo,

  cargarCodigo(texto, titulo) {
    if (!confirmarDescarte(`Cargar "${titulo}"`)) return false;
    nombreArchivo = conExtension(titulo.replace(/\.psc$/i, ""));
    manejadorArchivo = undefined;
    reemplazarContenido(texto);
    referenciaGuardada = texto;
    // Un programa es código suelto, sin consigna ni casos. Si no se cerrara el
    // ejercicio anterior, el panel seguiría mostrando su enunciado y el botón
    // Verificar corregiría el programa recién cargado contra los casos de otro
    // ejercicio: mentiría dos veces.
    deseleccionarEjercicio();
    consola.textContent = "";
    refrescarCabeceraArchivo();
    recordarSesion();
    anexar(`Se cargó "${titulo}" desde la sala.\n`, "fin");
    return true;
  },

  cargarEjercicioMd(markdown, titulo, codigo, idRemoto) {
    const leido = leerEjercicio(markdown);
    if (!leido.ok) {
      const detalle = leido.errores.map((e) => `línea ${e.linea}: ${e.mensaje}`).join("\n");
      anexar(`El ejercicio "${titulo}" tiene problemas de formato:\n${detalle}\n`, "roto");
      return false;
    }
    if (!confirmarDescarte(`Abrir "${leido.ejercicio.titulo}"`)) return false;

    // Viene de la sala, no de `ejercicios/`: el selector local no lo tiene, así
    // que se deja en "Sin ejercicio" para no mentir sobre qué está abierto.
    selector.value = "";
    ejercicioSeleccionado = "";
    localStorage.removeItem("pseudo:ejercicio");

    // Abrir un ejercicio siempre cambia el editor, traiga código o no.
    //
    // Antes, sin código, el editor quedaba tal cual: el panel mostraba un
    // ejercicio y la barra el nombre de otro archivo, con el programa anterior
    // adentro. Parecía que abrir no había hecho nada. Sin código lo que
    // corresponde es una hoja limpia para resolverlo, no la solución de un
    // ejercicio distinto.
    // Si ya trabajaste en este ejercicio, se recupera tu versión; si es la
    // primera vez, el código que trae (o una hoja limpia).
    const clave = idRemoto ?? `md:${titulo}`;
    const previo = trabajoGuardado(clave);
    const contenido = previo ?? codigo ?? ESQUELETO;

    // Antes de pisar el editor, se guarda lo del ejercicio que estaba abierto.
    guardarTrabajo();

    nombreArchivo = conExtension(titulo);
    manejadorArchivo = undefined;
    claveDelEjercicio = clave;
    reemplazarContenido(contenido);
    referenciaGuardada = contenido;
    refrescarCabeceraArchivo();
    recordarSesion();

    idEjercicioRemoto = idRemoto;
    ejercicioActual = leido.ejercicio;
    btnVerificar.hidden = leido.ejercicio.casos.length === 0;
    mostrarEnunciado(leido.ejercicio);
    ajustarPanelInferior();
    consola.textContent = "";
    anexar(
      previo !== null
        ? `Se abrió "${leido.ejercicio.titulo}" con lo que tenías escrito.\n`
        : codigo === null
          ? `Se abrió "${leido.ejercicio.titulo}". Escribí tu solución acá.\n`
          : `Se abrió "${leido.ejercicio.titulo}" con el código que trae.\n`,
      "fin",
    );
    return true;
  },

  async ejercicioAbierto() {
    // Se publica el `.md` crudo, no el ejercicio ya parseado: así lo que viaja
    // es exactamente el archivo que el docente escribió. El código va aparte,
    // tal como está en el editor en este momento.
    const archivo = selector.value;
    if (archivo === "") return null;
    try {
      const respuesta = await fetch(`./ejercicios/${archivo}`, { cache: "no-cache" });
      if (!respuesta.ok) return null;
      const contenido = await respuesta.text();
      // El título sale del propio .md, no de `ejercicioActual`: si el selector
      // cambió y la carga no terminó (o se canceló), usar el estado del editor
      // publicaría el título de un ejercicio con el contenido de otro.
      const leido = leerEjercicio(contenido);
      return {
        titulo: leido.ok ? leido.ejercicio.titulo : archivo,
        contenido,
        codigo: vista.state.doc.toString(),
      };
    } catch {
      return null;
    }
  },

  ejercicioDeLaSala: () => idEjercicioRemoto,

  probarConEntrada(entrada) {
    const compilado = compilar(vista.state.doc.toString());
    if (!compilado.ok) {
      const n = compilado.diagnosticos.length;
      return {
        ok: false,
        mensaje: `Tu código tiene ${n} ${n === 1 ? "error" : "errores"}: corregilos y volvé a calcular.`,
      };
    }
    // Se reusa el mismo motor que corrige, así lo que se guarda como salida
    // esperada es exactamente lo que la verificación va a comparar. Calcularlo
    // de otra forma sería volver a abrir la puerta a que no coincidan.
    const r = correrCaso(
      compilado.programa,
      { nombre: "prueba", entrada, salidaEsperada: "" },
      { comparacion: "normalizada", decimales: null },
      { limitePasos: 500_000 },
    );
    if (r.estado === "sin-entrada") {
      return {
        ok: false,
        mensaje: `Tu programa pidió ${r.entradasPedidas} valores y esta entrada trae ${r.entradasDisponibles}.`,
      };
    }
    if (r.estado === "error") {
      return { ok: false, mensaje: r.diagnostico === undefined ? "El programa se detuvo con un error." : formatearDiagnostico(r.diagnostico) };
    }
    return { ok: true, salida: r.obtenido };
  },

  avisar: (mensaje, clase) => anexar(mensaje, clase),
}).then((c) => {
  controlesNube = c;
});
