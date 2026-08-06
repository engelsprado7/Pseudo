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
import { hayNube, leerConfig } from "./nube.ts";
import { icono } from "./iconos.ts";
import { notificar } from "./avisos.ts";
import { abrirEditorDeEjercicio, type EjercicioAEditar } from "./editor-ejercicio.ts";
import { crearPanelDeClase } from "./clase.ts";
import { claseDeApertura, comoAbrir } from "../src/apertura.ts";
import {
  accionesDeItem,
  accionesDeMiembro,
  seccionesVisibles,
  type AccionDeItem,
  type ContextoDeSala,
} from "../src/permisos.ts";
import { alCambiarSesion, entrar, salir, usuarioActual, type Usuario } from "./auth.ts";
import {
  actualizarEjercicio,
  borrarEjercicio,
  borrarPrograma,
  cambiarRol,
  compartirPrograma,
  copiarEjercicio,
  crearSala,
  despublicarEjercicio,
  escucharSala,
  guardarEjercicioPersonal,
  listarEjercicios,
  listarMiembros,
  listarProgramas,
  misEjercicios,
  misSalas,
  publicarBorrador,
  publicarEjercicio,
  registrarProgreso,
  quitarMiembro,
  traerEjercicio,
  traerPrograma,
  unirseASala,
  type Miembro,
  type Publicacion,
  type Sala,
} from "./salas.ts";

/** Todo lo que hace falta para abrir un ejercicio en el editor. */
export interface EjercicioParaAbrir {
  markdown: string;
  titulo: string;
  /** Código que trae: el adjunto del ejercicio, o el que alguien entregó. */
  codigo: string | null;
  /** Id en la sala, o `null` si su progreso no debe registrarse. */
  idRemoto: string | null;
  /**
   * Clave con la que se recuerda el trabajo en curso.
   *
   * `null` significa que no hay trabajo que recordar ni restaurar: es lo que
   * corresponde al abrir la entrega de otra persona, donde siempre hay que ver
   * lo que esa persona mandó y nunca una copia local.
   */
  ranura: string | null;
}

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
  cargarEjercicioMd: (ejercicio: EjercicioParaAbrir) => boolean;
  /** El `.md` del ejercicio abierto más el código del editor, o `null`. */
  ejercicioAbierto: () => Promise<{
    titulo: string;
    contenido: string;
    codigo: string;
  } | null>;
  /** Id del ejercicio de la sala que está abierto, o `null`. */
  ejercicioDeLaSala: () => string | null;
  /** Corre el código del editor con una entrada y devuelve lo que escribió. */
  probarConEntrada: (
    entrada: string[],
  ) => { ok: true; salida: string } | { ok: false; mensaje: string };
  /** Escribe en la consola del editor. */
  avisar: (mensaje: string, clase?: string) => void;
}

const CLAVE_SALA = "pseudo:sala";

/** Lo que la nube le devuelve al editor para que pueda avisarle cosas. */
export interface ControlesNube {
  /** Registra el resultado de una verificación del ejercicio de la sala. */
  registrarResultado(
    idEjercicio: string,
    aprobados: number,
    total: number,
    fallados: string[],
  ): void;
}

/** Sin nube, todo lo que el editor pida no hace nada. */
const SIN_CONTROLES: ControlesNube = { registrarResultado: () => {} };

type ItemFeed = Publicacion & { tipo: "ejercicio" | "programa" | "personal" };

/**
 * Cierra un diálogo al hacer clic fuera de su recuadro.
 *
 * `<dialog>` no lo hace solo: el fondo oscuro es parte del propio diálogo, así
 * que un clic ahí llega con el diálogo como blanco. Se compara contra el
 * rectángulo porque es la única forma de distinguir el fondo del contenido.
 *
 * Vale la pena porque intentar cerrar clicando afuera es lo primero que hace
 * todo el mundo, y cuando no pasa nada la sensación es que la aplicación se
 * colgó. Escape ya funciona de fábrica.
 */
function cerrarConClicAfuera(dialogo: HTMLDialogElement): void {
  dialogo.addEventListener("click", (e) => {
    if (e.target !== dialogo) return;
    const r = dialogo.getBoundingClientRect();
    const afuera =
      e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (afuera) dialogo.close();
  });
}

export async function iniciarNubeUI(enlace: Enlace): Promise<ControlesNube> {
  if (!(await hayNube())) return SIN_CONTROLES;

  const btnSala = document.querySelector<HTMLButtonElement>("#btn-sala")!;
  const btnEntregar = document.querySelector<HTMLButtonElement>("#btn-entregar")!;
  const dialogo = document.querySelector<HTMLDialogElement>("#dialogo-sala")!;
  const sinSesion = document.querySelector<HTMLElement>("#sala-sin-sesion")!;
  const conSesion = document.querySelector<HTMLElement>("#sala-con-sesion")!;
  const elUsuario = document.querySelector<HTMLElement>("#sala-usuario")!;
  const selector = document.querySelector<HTMLSelectElement>("#sala-selector")!;
  const elCodigo = document.querySelector<HTMLElement>("#sala-codigo")!;
  const secciones = document.querySelector<HTMLElement>("#sala-secciones")!;
  const panelMiembros = document.querySelector<HTMLElement>("#sala-miembros")!;
  const listaMiembros = document.querySelector<HTMLElement>("#lista-miembros")!;

  const nombreNueva = document.querySelector<HTMLInputElement>("#sala-nombre-nueva")!;
  const codigoUnirse = document.querySelector<HTMLInputElement>("#sala-codigo-unirse")!;

  btnSala.hidden = false;

  let usuario: Usuario | null = null;
  let salas: Sala[] = [];
  let salaActual: string | null = localStorage.getItem(CLAVE_SALA);
  let dejarDeEscuchar: (() => void) | null = null;
  /** Ejercicios publicados en la sala actual, para titular el progreso. */
  let listaEjercicios: Publicacion[] = [];

  /**
   * Responde a una acción de la sala.
   *
   * Va a las dos partes a propósito: el aviso flotante es lo que el usuario ve
   * —incluso con un diálogo abierto encima—, y la consola guarda el registro de
   * lo que fue pasando, que sirve para reconstruir qué se hizo.
   */
  function avisar(mensaje: string, tipo: "ok" | "error" = "ok"): void {
    notificar(mensaje, tipo);
    enlace.avisar(mensaje + "\n", tipo === "error" ? "roto" : "fin");
  }

  /** Quién soy en la sala de ahora. Es lo que consultan las reglas de permisos. */
  function contexto(): ContextoDeSala {
    return {
      usuarioId: usuario?.id ?? null,
      haySala: salaActual !== null,
      soyDocente: salas.find((s) => s.id === salaActual)?.rol === "docente",
    };
  }
  const panelClase = crearPanelDeClase();

  // --- Render ---

  function pintarSesion(): void {
    const dentro = usuario !== null;
    sinSesion.hidden = dentro;
    conSesion.hidden = !dentro;
    elUsuario.textContent = usuario === null ? "" : `Sesión de ${usuario.nombre}.`;
  }

  function pintarSalas(): void {
    // Entregar vive en la barra, no acá: es la última acción del alumno
    // —resolver, Verificar, Entregar— y estaba a dos clics detrás de un modal.
    // Solo aparece cuando hay a quién entregarle.
    btnEntregar.hidden = usuario === null || salaActual === null;

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

  /** Crea un botón de acción para una fila del feed. */
  function accion(
    texto: string,
    ayuda: string,
    alHacerClic: () => void,
    nombreIcono: string,
    clase = "",
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `feed-accion ${clase}`.trim();
    b.append(icono(nombreIcono), document.createTextNode(texto));
    b.title = ayuda;
    b.addEventListener("click", alHacerClic);
    return b;
  }

  function filaDeItem(item: ItemFeed): HTMLElement {
    const fila = document.createElement("div");
    fila.className = `feed-fila ${item.tipo}`;

    const boton = document.createElement("button");
    boton.className = "feed-item";

    const titulo = document.createElement("span");
    titulo.className = "feed-titulo";
    titulo.textContent = item.titulo;

    const autor = document.createElement("span");
    autor.className = "feed-autor";
    autor.textContent = item.autor;

    boton.append(titulo, autor);
    boton.addEventListener("click", () => void abrirItem(item));
    fila.appendChild(boton);

    // Las acciones van fuera del botón que abre: un botón dentro de otro no es
    // HTML válido y el clic se dispararía dos veces.
    const acciones = document.createElement("div");
    acciones.className = "feed-acciones";
    // La regla de qué corresponde vive en src/permisos.ts, probada aparte. Acá
    // solo se dibuja lo que esa regla devuelve: si mañana cambia un permiso, se
    // cambia en un lugar y las pruebas lo respaldan.
    const dibujo: Record<AccionDeItem, () => HTMLButtonElement> = {
      asignar: () =>
        accion("Asignar", "Darlo a la clase para que lo resuelvan", () => void publicarItem(item), "publicar", "destacada"),
      editar: () =>
        accion("Editar", "Cambiar el enunciado o los casos", () => void editarItem(item), "editar"),
      retirar: () =>
        accion("Retirar", "Sacarlo de la clase y volverlo borrador", () => void despublicarItem(item), "bajar"),
      copiar: () =>
        accion("Copiar", "Guardar una copia en mis borradores", () => void copiarItem(item), "copiar"),
      borrar: () =>
        accion(
          "Borrar",
          item.tipo === "programa" ? "Retirar esta entrega" : "Eliminar este ejercicio",
          () => void borrarItem(item),
          "borrar",
          "peligro",
        ),
    };

    for (const nombre of accionesDeItem({ tipo: item.tipo, autorId: item.autorId }, contexto())) {
      const armar = dibujo[nombre];
      if (armar !== undefined) acciones.appendChild(armar());
    }

    if (acciones.childElementCount > 0) fila.appendChild(acciones);
    return fila;
  }

  /**
   * Dibuja el feed en tres secciones con título.
   *
   * Antes era una sola lista con borradores, ejercicios de la sala y código
   * mezclados: dos cosas parecidas se veían idénticas y no había forma de saber
   * qué era cada una. Agrupar es lo que hace evidente que un borrador y un
   * ejercicio publicado son estados distintos de lo mismo.
   */
  function pintarFeed(items: ItemFeed[]): void {
    secciones.textContent = "";

    const grupos: Array<{ tipo: ItemFeed["tipo"]; titulo: string; vacio: string }> = [
      { tipo: "personal", titulo: "Mis borradores", vacio: "Todavía no escribiste ninguno." },
      { tipo: "ejercicio", titulo: "Ejercicios asignados", vacio: "Todavía no hay ejercicios para resolver." },
      { tipo: "programa", titulo: "Entregas de la clase", vacio: "Todavía nadie entregó una solución." },
    ];

    // Qué secciones tienen sentido lo decide src/permisos.ts, con pruebas.
    const visibles = seccionesVisibles(contexto());
    for (const grupo of grupos) {
      if (!visibles.includes(grupo.tipo)) continue;
      const propios = items.filter((i) => i.tipo === grupo.tipo);

      const seccion = document.createElement("section");
      seccion.className = "seccion-feed";

      const titulo = document.createElement("h3");
      titulo.textContent = grupo.titulo;
      seccion.appendChild(titulo);

      if (propios.length === 0) {
        const vacio = document.createElement("p");
        vacio.className = "vacio";
        vacio.textContent = grupo.vacio;
        seccion.appendChild(vacio);
      } else {
        for (const item of propios) seccion.appendChild(filaDeItem(item));
      }

      secciones.appendChild(seccion);
    }
  }

  /**
   * Dibuja quiénes están en la sala.
   *
   * La lista la ve cualquier miembro —saber con quién compartís la clase no es
   * información sensible— pero las acciones son solo del docente. Aun así, la
   * regla de verdad está en la base: `cambiar_rol` y `quitar_miembro` verifican
   * el rol por su cuenta, así que esconder los botones es comodidad, no
   * seguridad.
   */
  function pintarMiembros(miembros: Miembro[]): void {
    listaMiembros.textContent = "";

    for (const m of miembros) {
      const fila = document.createElement("div");
      fila.className = "miembro";

      const nombre = document.createElement("span");
      nombre.className = "miembro-nombre";
      nombre.textContent = m.nombre;
      fila.appendChild(nombre);

      if (m.id === usuario?.id) {
        const yo = document.createElement("span");
        yo.className = "miembro-yo";
        yo.textContent = "(vos)";
        fila.appendChild(yo);
      }

      const rol = document.createElement("span");
      rol.className = `miembro-rol ${m.rol}`;
      rol.textContent = m.rol;
      fila.appendChild(rol);

      // Quién puede administrar a quién lo decide src/permisos.ts. Aun así, la
      // regla de verdad está en la base: `cambiar_rol` y `quitar_miembro`
      // verifican el rol por su cuenta, así que esconder los botones es
      // comodidad, no seguridad.
      for (const nombre of accionesDeMiembro({ id: m.id, rol: m.rol }, contexto())) {
        if (nombre === "quitar") {
          fila.appendChild(
            accion("Quitar", "Sacar de la sala", () => void quitarDeLaSala(m), "borrar", "peligro"),
          );
        } else {
          const rol = nombre === "hacer-docente" ? "docente" : "alumno";
          fila.appendChild(
            accion(
              rol === "docente" ? "Hacer docente" : "Hacer alumno",
              `Pasar a ${rol}`,
              () => void cambiarRolDe(m, rol),
              rol === "docente" ? "publicar" : "bajar",
            ),
          );
        }
      }

      listaMiembros.appendChild(fila);
    }
  }

  async function cambiarRolDe(m: Miembro, rol: "docente" | "alumno"): Promise<void> {
    if (salaActual === null) return;
    const r = await cambiarRol(salaActual, m.id, rol);
    avisar(r.ok ? `${m.nombre} ahora es ${rol} de la sala.` : r.mensaje, r.ok ? "ok" : "error");
    // El propio rol puede haber cambiado: hay que rehacer salas y acciones.
    if (r.ok) await recargarSalas();
  }

  async function quitarDeLaSala(m: Miembro): Promise<void> {
    if (salaActual === null) return;
    if (!confirm(`¿Sacar a ${m.nombre} de la sala?`)) return;
    const r = await quitarMiembro(salaActual, m.id);
    avisar(r.ok ? `${m.nombre} ya no está en la sala.` : r.mensaje, r.ok ? "ok" : "error");
    if (r.ok) await refrescarMiembros();
  }

  async function refrescarMiembros(): Promise<void> {
    if (salaActual === null) {
      panelMiembros.hidden = true;
      return;
    }
    const r = await listarMiembros(salaActual);
    if (!r.ok) {
      panelMiembros.hidden = true;
      return;
    }
    panelMiembros.hidden = false;
    pintarMiembros(r.dato);
  }

  // --- Datos ---

  async function refrescarFeed(): Promise<void> {
    const items: ItemFeed[] = [];

    // Los propios sin publicar se ven siempre, incluso sin estar en una sala:
    // son el taller de uno y no dependen de la clase.
    const propios = await misEjercicios();
    if (propios.ok) {
      items.push(...propios.dato.map((p) => ({ ...p, tipo: "personal" as const })));
    }

    if (salaActual !== null) {
      const [ejercicios, programas] = await Promise.all([
        listarEjercicios(salaActual),
        listarProgramas(salaActual),
      ]);
      if (ejercicios.ok) {
        listaEjercicios = ejercicios.dato;
        items.push(...ejercicios.dato.map((p) => ({ ...p, tipo: "ejercicio" as const })));
      }
      if (programas.ok) {
        items.push(...programas.dato.map((p) => ({ ...p, tipo: "programa" as const })));
      }
      if (!ejercicios.ok) avisar(ejercicios.mensaje, "error");
    }

    items.sort((a, b) => b.creado.localeCompare(a.creado));
    pintarFeed(items);
  }

  async function cambiarDeSala(id: string | null): Promise<void> {
    dejarDeEscuchar?.();
    dejarDeEscuchar = null;
    salaActual = id;
    if (id === null) {
      localStorage.removeItem(CLAVE_SALA);
    } else {
      localStorage.setItem(CLAVE_SALA, id);
      dejarDeEscuchar = await escucharSala(id, () => {
        void refrescarFeed();
        void panelClase.refrescar();
      });
    }
    pintarSalas();
    await refrescarFeed();
    await refrescarMiembros();
    // La planilla vive fuera del modal, pero se entera de los mismos cambios.
    // El rol sale del mismo contexto que todo lo demás: calcularlo aparte era
    // una segunda fuente de verdad, y ya sabemos cómo termina eso.
    panelClase.cambiarSala(id, contexto().soyDocente, listaEjercicios);
  }

  async function recargarSalas(): Promise<void> {
    const resultado = await misSalas();
    if (!resultado.ok) {
      avisar(resultado.mensaje, "error");
      return;
    }
    salas = resultado.dato;
    pintarSalas();
    await cambiarDeSala(salaActual);
  }

  /** Abre el formulario con un ejercicio propio cargado. */
  async function editarItem(item: ItemFeed): Promise<void> {
    const r = await traerEjercicio(item.id);
    if (!r.ok) {
      avisar(r.mensaje, "error");
      return;
    }
    abrirFormulario({ id: item.id, contenido: r.dato.contenido, codigo: r.dato.codigo });
  }

  /** Publica un borrador: le pone la sala actual. No lo copia. */
  async function publicarItem(item: ItemFeed): Promise<void> {
    if (salaActual === null) return;
    const r = await publicarBorrador(item.id, salaActual);
    avisar(r.ok ? `"${item.titulo}" ya está asignado a la clase.` : r.mensaje, r.ok ? "ok" : "error");
    if (r.ok) await refrescarFeed();
  }

  async function despublicarItem(item: ItemFeed): Promise<void> {
    const r = await despublicarEjercicio(item.id);
    avisar(r.ok ? `"${item.titulo}" volvió a tus borradores.` : r.mensaje, r.ok ? "ok" : "error");
    if (r.ok) await refrescarFeed();
  }

  async function borrarItem(item: ItemFeed): Promise<void> {
    // Borrar no se deshace: se pregunta siempre, aunque sea un clic más.
    if (!confirm(`¿Borrar "${item.titulo}"? No se puede deshacer.`)) return;
    const r =
      item.tipo === "programa"
        ? await borrarPrograma(item.id)
        : await borrarEjercicio(item.id);
    avisar(r.ok ? `Se borró "${item.titulo}".` : r.mensaje, r.ok ? "ok" : "error");
    if (r.ok) await refrescarFeed();
  }

  /** Se lleva una copia propia de un ejercicio ajeno. */
  async function copiarItem(item: ItemFeed): Promise<void> {
    const r = await copiarEjercicio(item.id);
    avisar(r.ok ? `Se guardó una copia de "${item.titulo}" en tus ejercicios.` : r.mensaje, r.ok ? "ok" : "error");
    if (r.ok) await refrescarFeed();
  }

  /**
   * Abre algo del feed en el editor.
   *
   * Qué se recupera, dónde se guarda el avance y si el resultado cuenta como
   * progreso lo decide `comoAbrir`, en el núcleo y con pruebas. Acá solo se
   * traen los datos y se pasan: las cuatro variantes de "abrir" vivían en
   * condicionales repartidos por esta función y cada una produjo su propio bug.
   */
  async function abrirItem(item: ItemFeed): Promise<void> {
    const clase = claseDeApertura(
      { tipo: item.tipo, autorId: item.autorId },
      usuario?.id ?? null,
    );

    if (clase === "ejercicio-asignado" || clase === "borrador-propio") {
      const r = await traerEjercicio(item.id);
      if (!r.ok) {
        avisar(r.mensaje, "error");
        return;
      }
      const como = comoAbrir({ clase, id: item.id });
      if (
        enlace.cargarEjercicioMd({
          markdown: r.dato.contenido,
          titulo: item.titulo,
          codigo: r.dato.codigo,
          idRemoto: como.progreso,
          ranura: como.ranura,
        })
      ) {
        dialogo.close();
      }
      return;
    }

    const r = await traerPrograma(item.id);
    if (!r.ok) {
      avisar(r.mensaje, "error");
      return;
    }
    const como = comoAbrir({ clase, id: item.id, ejercicio: r.dato.ejercicio });

    // Con su ejercicio detrás, la entrega se abre con enunciado y casos, así se
    // corrige con Verificar en vez de leerla a ojo.
    if (r.dato.ejercicio !== null) {
      const ej = await traerEjercicio(r.dato.ejercicio);
      if (ej.ok) {
        if (
          enlace.cargarEjercicioMd({
            markdown: ej.dato.contenido,
            titulo: item.titulo,
            codigo: r.dato.codigo,
            idRemoto: como.progreso,
            ranura: como.ranura,
          })
        ) {
          dialogo.close();
        }
        return;
      }
      // El ejercicio pudo haberse borrado; la entrega sigue valiendo como código.
      avisar("El ejercicio de esta entrega ya no está; se abre solo el código.", "error");
    }

    if (enlace.cargarCodigo(r.dato.codigo, item.titulo)) dialogo.close();
  }


  // --- Eventos ---

  // Iconos en los botones fijos del diálogo. Se ponen desde acá y no en el HTML
  // para que exista un solo juego de iconos y no dos formas de dibujarlos.
  for (const [selector, nombre] of [
    ["#btn-cerrar-sala", "cerrar"],
    ["#btn-cerrar-ejercicio", "cerrar"],
    ["#btn-crear-ejercicio", "mas"],
        ["#btn-gestionar-sala", "salas"],
    ["#btn-salir-sesion", "salir"],
  ] as const) {
    const b = document.querySelector<HTMLButtonElement>(selector);
    if (b === null) continue;
    // El de cerrar es solo el icono; el resto lo lleva delante del texto.
    if (selector.startsWith("#btn-cerrar")) b.textContent = "";
    b.prepend(icono(nombre, selector.startsWith("#btn-cerrar") ? 15 : 13));
  }

  btnSala.addEventListener("click", () => {
    dialogo.showModal();
    if (usuario !== null) void recargarSalas();
  });

  // Crear sala y unirse son cosas que se hacen una vez; no merecen ocupar
  // espacio permanente arriba de lo que se mira todos los días.
  const gestion = document.querySelector<HTMLElement>("#sala-gestion")!;
  document
    .querySelector<HTMLButtonElement>("#btn-gestionar-sala")!
    .addEventListener("click", () => {
      gestion.hidden = !gestion.hidden;
    });
  cerrarConClicAfuera(dialogo);
  document
    .querySelector<HTMLButtonElement>("#btn-cerrar-sala")!
    .addEventListener("click", () => dialogo.close());

  // Solo se ofrecen los proveedores que `nube.json` declara: un botón para un
  // proveedor sin registrar en Supabase falla con un error que no dice nada.
  const config = await leerConfig();
  const botonGoogle = document.querySelector<HTMLButtonElement>("#btn-entrar-google")!;
  const botonMicrosoft = document.querySelector<HTMLButtonElement>("#btn-entrar-microsoft")!;
  botonGoogle.hidden = !(config?.proveedores.includes("google") ?? false);
  botonMicrosoft.hidden = !(config?.proveedores.includes("azure") ?? false);

  botonGoogle.addEventListener("click", () => void entrar("google"));
  botonMicrosoft.addEventListener("click", () => void entrar("azure"));
  document
    .querySelector<HTMLButtonElement>("#btn-salir-sesion")!
    .addEventListener("click", () => void salir());

  selector.addEventListener("change", () => void cambiarDeSala(selector.value || null));

  function abrirFormulario(editando?: EjercicioAEditar): void {
    abrirEditorDeEjercicio({
      codigoActual: enlace.codigoActual,
      probarConEntrada: enlace.probarConEntrada,
      editando,

      async guardarPersonal(titulo, contenido, codigo) {
        const r = await guardarEjercicioPersonal(titulo, contenido, codigo);
        if (!r.ok) return r.mensaje;
        avisar(`Se guardó "${titulo}" en tus ejercicios.`);
        return null;
      },

      async actualizar(id, titulo, contenido, codigo) {
        const r = await actualizarEjercicio(id, titulo, contenido, codigo);
        if (!r.ok) return r.mensaje;
        avisar(`Se guardaron los cambios de "${titulo}".`);
        return null;
      },

      // Sin sala elegida el botón de publicar queda deshabilitado; pasar
      // `null` es lo que se lo indica al formulario.
      publicarEnSala:
        salaActual === null
          ? null
          : async (titulo, contenido, codigo) => {
              const r = await publicarEjercicio(salaActual!, titulo, contenido, codigo);
              if (!r.ok) return r.mensaje;
              avisar(`Se asignó "${titulo}" a la clase.`);
              return null;
            },

      alGuardar: () => void refrescarFeed(),
    });
  }

  document
    .querySelector<HTMLButtonElement>("#btn-crear-ejercicio")!
    .addEventListener("click", () => abrirFormulario());

  document.querySelector<HTMLButtonElement>("#btn-crear-sala")!.addEventListener("click", () => {
    const nombre = nombreNueva.value.trim();
    if (nombre === "") return;
    void (async () => {
      const r = await crearSala(nombre);
      if (!r.ok) {
        avisar(r.mensaje, "error");
        return;
      }
      nombreNueva.value = "";
      avisar(`Sala "${r.dato.nombre}" creada. Código: ${r.dato.codigo}`);
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
        avisar(r.mensaje, "error");
        return;
      }
      codigoUnirse.value = "";
      salaActual = r.dato;
      await recargarSalas();
      avisar("Ya estás en la sala.");
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
  /**
   * Comparte el código del editor. Siempre. Sin condiciones ocultas.
   *
   * Antes este botón decidía solo entre publicar un ejercicio o compartir un
   * programa, mirando el desplegable local de ejercicios. Ese desplegable queda
   * vacío justo cuando se trabaja sobre un ejercicio de la sala, así que hacía
   * lo contrario de lo esperado en el caso más común y dejaba dos entradas que
   * parecían la misma cosa. Publicar un ejercicio ahora es una acción sobre el
   * ejercicio, en su propia fila.
   */
  document.querySelector<HTMLButtonElement>("#btn-entregar")!.addEventListener("click", () => {
    void (async () => {
      if (salaActual === null) {
        avisar("Primero entrá a una sala.", "error");
        return;
      }
      const nombre = enlace.nombreActual();
      // Si hay un ejercicio de la sala abierto, la solución queda atada a él:
      // es lo que permite reemplazar la anterior en vez de duplicarla.
      const r = await compartirPrograma(
        salaActual,
        nombre,
        enlace.codigoActual(),
        enlace.ejercicioDeLaSala(),
      );
      avisar(r.ok ? `Entregaste tu solución de "${nombre}".` : r.mensaje, r.ok ? "ok" : "error");
      if (r.ok) await refrescarFeed();
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

  return {
    registrarResultado(idEjercicio, aprobados, total, fallados) {
      // Silencioso a propósito: registrar el progreso no puede entrometerse en
      // la corrección. Si falla la red, el alumno igual ve su resultado.
      if (salaActual === null) return;
      void registrarProgreso(salaActual, idEjercicio, aprobados, total, fallados);
    },
  };
}
