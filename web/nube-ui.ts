/**
 * Interfaz de la sala de clase.
 *
 * Vive en un diálogo aparte a propósito: el editor es lo importante y su
 * disposición ya está resuelta, así que la nube no le come espacio a la salida
 * ni al panel de variables. Si no hay nube configurada, el botón ni aparece.
 *
 * Este módulo no conoce CodeMirror ni el estado del editor: recibe un `Enlace`
 * con las cuatro cosas que necesita. Así la nube se puede quitar sin tocar el
 * núcleo, que es la condición que se puso desde el principio.
 */
import { hayNube } from "./nube.ts";
import { alCambiarSesion, entrar, salir, usuarioActual, type Usuario } from "./auth.ts";
import {
  compartirPrograma,
  crearSala,
  escucharSala,
  listarEjercicios,
  listarProgramas,
  misSalas,
  publicarEjercicio,
  traerEjercicio,
  traerPrograma,
  unirseASala,
  type Publicacion,
  type Sala,
} from "./salas.ts";

export interface Enlace {
  /** Código que hay en el editor ahora. */
  codigoActual: () => string;
  /** Nombre del archivo abierto, para proponerlo como título. */
  nombreActual: () => string;
  /** Carga código en el editor. Devuelve `false` si el usuario canceló. */
  cargarCodigo: (texto: string, nombre: string) => boolean;
  /**
   * Carga un ejercicio publicado: el enunciado y, si trae, su código.
   * Devuelve `false` si el usuario canceló.
   */
  cargarEjercicioMd: (markdown: string, titulo: string, codigo: string | null) => boolean;
  /** El `.md` del ejercicio abierto más el código del editor, o `null`. */
  ejercicioAbierto: () => Promise<{
    titulo: string;
    contenido: string;
    codigo: string;
  } | null>;
  /** Escribe en la consola del editor. */
  avisar: (mensaje: string, clase?: string) => void;
}

const CLAVE_SALA = "pseudo:sala";

type ItemFeed = Publicacion & { tipo: "ejercicio" | "programa" };

export async function iniciarNubeUI(enlace: Enlace): Promise<void> {
  if (!(await hayNube())) return;

  const btnSala = document.querySelector<HTMLButtonElement>("#btn-sala")!;
  const dialogo = document.querySelector<HTMLDialogElement>("#dialogo-sala")!;
  const sinSesion = document.querySelector<HTMLElement>("#sala-sin-sesion")!;
  const conSesion = document.querySelector<HTMLElement>("#sala-con-sesion")!;
  const elUsuario = document.querySelector<HTMLElement>("#sala-usuario")!;
  const selector = document.querySelector<HTMLSelectElement>("#sala-selector")!;
  const elCodigo = document.querySelector<HTMLElement>("#sala-codigo")!;
  const feed = document.querySelector<HTMLElement>("#sala-feed")!;
  const queComparte = document.querySelector<HTMLElement>("#sala-que-comparte")!;

  const nombreNueva = document.querySelector<HTMLInputElement>("#sala-nombre-nueva")!;
  const codigoUnirse = document.querySelector<HTMLInputElement>("#sala-codigo-unirse")!;

  btnSala.hidden = false;

  let usuario: Usuario | null = null;
  let salas: Sala[] = [];
  let salaActual: string | null = localStorage.getItem(CLAVE_SALA);
  let dejarDeEscuchar: (() => void) | null = null;

  // --- Render ---

  function pintarSesion(): void {
    const dentro = usuario !== null;
    sinSesion.hidden = dentro;
    conSesion.hidden = !dentro;
    elUsuario.textContent = usuario === null ? "" : `Sesión de ${usuario.nombre}.`;
  }

  function pintarSalas(): void {
    selector.textContent = "";
    if (salas.length === 0) {
      const vacio = document.createElement("option");
      vacio.value = "";
      vacio.textContent = "Todavía no estás en ninguna sala";
      selector.appendChild(vacio);
      elCodigo.textContent = "";
      return;
    }
    for (const sala of salas) {
      const opcion = document.createElement("option");
      opcion.value = sala.id;
      opcion.textContent = `${sala.nombre}${sala.rol === "docente" ? " (docente)" : ""}`;
      selector.appendChild(opcion);
    }
    if (salaActual === null || !salas.some((s) => s.id === salaActual)) {
      salaActual = salas[0]!.id;
    }
    selector.value = salaActual;
    const actual = salas.find((s) => s.id === salaActual);
    elCodigo.textContent = actual === undefined ? "" : `código: ${actual.codigo}`;
  }

  function pintarFeed(items: ItemFeed[]): void {
    feed.textContent = "";
    if (items.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "vacio";
      vacio.textContent = "Todavía no hay nada publicado en esta sala.";
      feed.appendChild(vacio);
      return;
    }
    for (const item of items) {
      const boton = document.createElement("button");
      boton.className = `feed-item ${item.tipo}`;

      const titulo = document.createElement("span");
      titulo.className = "feed-titulo";
      titulo.textContent = item.titulo;

      // La etiqueta dice lo único que de verdad los diferencia: un ejercicio
      // trae casos de prueba, así que se puede corregir solo.
      const etiqueta = document.createElement("span");
      etiqueta.className = "sala-etiqueta";
      etiqueta.textContent = item.tipo === "ejercicio" ? "verificable" : "código";

      const autor = document.createElement("span");
      autor.className = "feed-autor";
      autor.textContent = item.autor;

      boton.append(titulo, etiqueta, autor);
      boton.addEventListener("click", () => void abrirItem(item));
      feed.appendChild(boton);
    }
  }

  // --- Datos ---

  async function refrescarFeed(): Promise<void> {
    if (salaActual === null) {
      pintarFeed([]);
      return;
    }
    const [ejercicios, programas] = await Promise.all([
      listarEjercicios(salaActual),
      listarProgramas(salaActual),
    ]);

    const items: ItemFeed[] = [];
    if (ejercicios.ok) items.push(...ejercicios.dato.map((p) => ({ ...p, tipo: "ejercicio" as const })));
    if (programas.ok) items.push(...programas.dato.map((p) => ({ ...p, tipo: "programa" as const })));
    items.sort((a, b) => b.creado.localeCompare(a.creado));
    pintarFeed(items);

    if (!ejercicios.ok) enlace.avisar(ejercicios.mensaje + "\n", "roto");
  }

  async function cambiarDeSala(id: string | null): Promise<void> {
    dejarDeEscuchar?.();
    dejarDeEscuchar = null;
    salaActual = id;
    if (id === null) {
      localStorage.removeItem(CLAVE_SALA);
    } else {
      localStorage.setItem(CLAVE_SALA, id);
      dejarDeEscuchar = await escucharSala(id, () => void refrescarFeed());
    }
    pintarSalas();
    await refrescarFeed();
  }

  async function recargarSalas(): Promise<void> {
    const resultado = await misSalas();
    if (!resultado.ok) {
      enlace.avisar(resultado.mensaje + "\n", "roto");
      return;
    }
    salas = resultado.dato;
    pintarSalas();
    await cambiarDeSala(salaActual);
  }

  async function abrirItem(item: ItemFeed): Promise<void> {
    if (item.tipo === "ejercicio") {
      const r = await traerEjercicio(item.id);
      if (!r.ok) {
        enlace.avisar(r.mensaje + "\n", "roto");
        return;
      }
      if (enlace.cargarEjercicioMd(r.dato.contenido, item.titulo, r.dato.codigo)) {
        dialogo.close();
      }
      return;
    }
    const r = await traerPrograma(item.id);
    if (!r.ok) {
      enlace.avisar(r.mensaje + "\n", "roto");
      return;
    }
    if (enlace.cargarCodigo(r.dato, item.titulo)) dialogo.close();
  }

  // --- Eventos ---

  /** Dice de antemano qué va a viajar, para que el botón no sorprenda. */
  async function pintarQueComparte(): Promise<void> {
    const abierto = await enlace.ejercicioAbierto();
    queComparte.textContent =
      abierto === null
        ? `Se compartirá tu programa «${enlace.nombreActual()}».`
        : `Se compartirá el ejercicio «${abierto.titulo}» con sus casos de prueba y tu código.`;
  }

  btnSala.addEventListener("click", () => {
    dialogo.showModal();
    void pintarQueComparte();
    if (usuario !== null) void recargarSalas();
  });
  document
    .querySelector<HTMLButtonElement>("#btn-cerrar-sala")!
    .addEventListener("click", () => dialogo.close());

  document
    .querySelector<HTMLButtonElement>("#btn-entrar-google")!
    .addEventListener("click", () => void entrar("google"));
  document
    .querySelector<HTMLButtonElement>("#btn-entrar-microsoft")!
    .addEventListener("click", () => void entrar("azure"));
  document
    .querySelector<HTMLButtonElement>("#btn-salir-sesion")!
    .addEventListener("click", () => void salir());

  selector.addEventListener("change", () => void cambiarDeSala(selector.value || null));

  document.querySelector<HTMLButtonElement>("#btn-crear-sala")!.addEventListener("click", () => {
    const nombre = nombreNueva.value.trim();
    if (nombre === "") return;
    void (async () => {
      const r = await crearSala(nombre);
      if (!r.ok) {
        enlace.avisar(r.mensaje + "\n", "roto");
        return;
      }
      nombreNueva.value = "";
      enlace.avisar(`Sala "${r.dato.nombre}" creada. Código: ${r.dato.codigo}\n`, "fin");
      salaActual = r.dato.id;
      await recargarSalas();
    })();
  });

  document.querySelector<HTMLButtonElement>("#btn-unirse-sala")!.addEventListener("click", () => {
    const codigo = codigoUnirse.value.trim();
    if (codigo === "") return;
    void (async () => {
      const r = await unirseASala(codigo);
      if (!r.ok) {
        enlace.avisar(r.mensaje + "\n", "roto");
        return;
      }
      codigoUnirse.value = "";
      salaActual = r.dato;
      await recargarSalas();
      enlace.avisar("Ya estás en la sala.\n", "fin");
    })();
  });

  /**
   * Un solo botón para compartir.
   *
   * Antes había dos y la diferencia no se entendía. Ahora decide la interfaz,
   * que es lo que corresponde: si hay un ejercicio abierto lo publica entero
   * —enunciado, casos y código—, y si no, comparte solo el programa. Nunca hay
   * que elegir entre dos cosas que suenan igual.
   */
  document.querySelector<HTMLButtonElement>("#btn-compartir")!.addEventListener("click", () => {
    void (async () => {
      if (salaActual === null) {
        enlace.avisar("Primero entrá a una sala.\n", "aviso");
        return;
      }

      const abierto = await enlace.ejercicioAbierto();
      if (abierto !== null) {
        const r = await publicarEjercicio(
          salaActual,
          abierto.titulo,
          abierto.contenido,
          abierto.codigo,
        );
        enlace.avisar(
          r.ok
            ? `Se publicó "${abierto.titulo}" con sus casos de prueba y el código.\n`
            : r.mensaje + "\n",
          r.ok ? "fin" : "roto",
        );
        return;
      }

      const r = await compartirPrograma(salaActual, enlace.nombreActual(), enlace.codigoActual());
      enlace.avisar(
        r.ok ? `Se compartió "${enlace.nombreActual()}" en la sala.\n` : r.mensaje + "\n",
        r.ok ? "fin" : "roto",
      );
    })();
  });

  // --- Arranque ---

  usuario = await usuarioActual();
  pintarSesion();
  if (usuario !== null) await recargarSalas();

  await alCambiarSesion((u) => {
    const cambio = u?.id !== usuario?.id;
    usuario = u;
    pintarSesion();
    if (u !== null && cambio) void recargarSalas();
    if (u === null) {
      dejarDeEscuchar?.();
      dejarDeEscuchar = null;
      salas = [];
      pintarFeed([]);
    }
  });
}
