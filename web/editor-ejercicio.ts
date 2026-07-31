/**
 * Formulario para escribir un ejercicio.
 *
 * Sirve para que un docente —o un alumno— pueda armar un ejercicio completo sin
 * tocar archivos ni desplegar nada: título, enunciado, casos de prueba y el
 * seudocódigo que tenga en el editor.
 *
 * Lo que produce es el mismo `.md` de `ejercicios/*.md`, generado con
 * `escribirEjercicio`. No hay un formato paralelo para lo que se crea desde la
 * web: lo que se guarda se puede abrir, versionar o corregir a mano.
 *
 * Los casos son opcionales a propósito. Con casos el ejercicio se corrige solo;
 * sin casos es un problema abierto, que era justamente lo que faltaba poder
 * plantear.
 */
import {
  escribirEjercicio,
  leerEjercicio,
  type CasoDePrueba,
  type ModoComparacion,
} from "../src/ejercicio.ts";

/** Ejercicio que ya existe y se viene a modificar. */
export interface EjercicioAEditar {
  id: string;
  /** El `.md` guardado; de acá se repuebla el formulario. */
  contenido: string;
  codigo: string | null;
}

export interface OpcionesEditor {
  /** Seudocódigo del editor, para ofrecer adjuntarlo. */
  codigoActual: () => string;
  /** Guarda sin publicar. Devuelve el mensaje de error, o `null` si salió bien. */
  guardarPersonal: (titulo: string, contenido: string, codigo: string | null) => Promise<string | null>;
  /** Publica en la sala actual. `null` si no hay sala elegida. */
  publicarEnSala:
    | ((titulo: string, contenido: string, codigo: string | null) => Promise<string | null>)
    | null;
  /** Guarda los cambios de un ejercicio existente. Solo en modo edición. */
  actualizar?: (
    id: string,
    titulo: string,
    contenido: string,
    codigo: string | null,
  ) => Promise<string | null>;
  /** Si viene, el formulario abre con estos datos y guarda encima. */
  editando?: EjercicioAEditar;
  /**
   * Ejecuta el código del editor con una entrada y devuelve lo que escribió.
   *
   * Es lo que evita que el docente tenga que adivinar la salida esperada: la
   * consola muestra además el eco de lo que uno tipea, y copiar eso da un caso
   * que no puede aprobar nunca.
   */
  probarConEntrada: (entrada: string[]) => { ok: true; salida: string } | { ok: false; mensaje: string };
  /** Se llama después de guardar o publicar, para refrescar listas. */
  alGuardar: () => void;
}

interface FilaCaso {
  nodo: HTMLElement;
  nombre: HTMLInputElement;
  entrada: HTMLTextAreaElement;
  salida: HTMLTextAreaElement;
}

export function abrirEditorDeEjercicio(opciones: OpcionesEditor): void {
  const dialogo = document.querySelector<HTMLDialogElement>("#dialogo-ejercicio")!;
  const elTitulo = document.querySelector<HTMLInputElement>("#ej-titulo")!;
  const elEnunciado = document.querySelector<HTMLTextAreaElement>("#ej-enunciado")!;
  const elIncluirCodigo = document.querySelector<HTMLInputElement>("#ej-incluir-codigo")!;
  const contenedorCasos = document.querySelector<HTMLElement>("#ej-casos")!;
  const btnAgregar = document.querySelector<HTMLButtonElement>("#ej-agregar-caso")!;
  const btnGuardar = document.querySelector<HTMLButtonElement>("#ej-guardar")!;
  const btnPublicar = document.querySelector<HTMLButtonElement>("#ej-publicar")!;
  const elComparacion = document.querySelector<HTMLSelectElement>("#ej-comparacion")!;
  const elAviso = document.querySelector<HTMLElement>("#ej-aviso")!;

  const filas: FilaCaso[] = [];

  const avisar = (mensaje: string, clase: "roto" | "bien" | "" = ""): void => {
    elAviso.textContent = mensaje;
    elAviso.className = clase === "" ? "vacio" : clase;
  };

  function agregarCaso(): void {
    const nodo = document.createElement("div");
    nodo.className = "ej-caso";

    const cabecera = document.createElement("div");
    cabecera.className = "ej-caso-cabecera";
    const nombre = document.createElement("input");
    nombre.placeholder = `Nombre del caso (por ejemplo: valores enteros)`;
    nombre.autocomplete = "off";
    const probar = document.createElement("button");
    probar.type = "button";
    probar.textContent = "Calcular salida";
    probar.title = "Ejecuta tu código con esta entrada y completa la salida esperada";

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.textContent = "Quitar";
    cabecera.append(nombre, probar, quitar);

    const par = document.createElement("div");
    par.className = "ej-caso-par";

    const armarCampo = (etiqueta: string, ayuda: string): HTMLTextAreaElement => {
      const caja = document.createElement("div");
      const lbl = document.createElement("label");
      lbl.textContent = etiqueta;
      const area = document.createElement("textarea");
      area.className = "caso-campo";
      area.rows = 4;
      area.placeholder = ayuda;
      caja.append(lbl, area);
      par.appendChild(caja);
      return area;
    };

    const entrada = armarCampo("Entrada (un valor por línea)", "5\n3");
    const salida = armarCampo("Salida esperada", "El área es: 15.0");

    nodo.append(cabecera, par);
    contenedorCasos.appendChild(nodo);

    const fila: FilaCaso = { nodo, nombre, entrada, salida };
    filas.push(fila);

    probar.addEventListener("click", () => {
      const valores = entrada.value.replace(/\n+$/, "");
      const r = opciones.probarConEntrada(valores === "" ? [] : valores.split("\n"));
      if (!r.ok) {
        avisar(r.mensaje, "roto");
        return;
      }
      salida.value = r.salida.replace(/\n+$/, "");
      avisar("Salida calculada con tu código. Revisá que sea la correcta.", "bien");
    });

    quitar.addEventListener("click", () => {
      const i = filas.indexOf(fila);
      if (i >= 0) filas.splice(i, 1);
      nodo.remove();
    });
  }

  /** Arma el `.md` y lo valida. Devuelve `null` si algo falta. */
  function construir(): { titulo: string; contenido: string; codigo: string | null } | null {
    const titulo = elTitulo.value.trim();
    if (titulo === "") {
      avisar("Falta el título.", "roto");
      elTitulo.focus();
      return null;
    }
    if (elEnunciado.value.trim() === "") {
      avisar("Falta el enunciado: es lo que el alumno va a leer.", "roto");
      elEnunciado.focus();
      return null;
    }

    const casos: CasoDePrueba[] = [];
    for (const [i, fila] of filas.entries()) {
      const entrada = fila.entrada.value.replace(/\n+$/, "");
      const salida = fila.salida.value.replace(/\n+$/, "");
      // Un caso a medio llenar es un error del docente que se paga después, con
      // un alumno que no entiende por qué no aprueba. Mejor decirlo ahora.
      if (salida.trim() === "") {
        avisar(`Al caso ${i + 1} le falta la salida esperada.`, "roto");
        fila.salida.focus();
        return null;
      }
      casos.push({
        nombre: fila.nombre.value.trim() || `caso ${i + 1}`,
        entrada: entrada === "" ? [] : entrada.split("\n"),
        salidaEsperada: salida,
      });
    }

    const contenido = escribirEjercicio({
      titulo,
      enunciado: elEnunciado.value,
      comparacion: elComparacion.value as ModoComparacion,
      casos,
    });

    // Cinturón y tirantes: se relee lo que se acaba de escribir. Si por algún
    // texto raro el .md quedara inválido, es mejor enterarse acá que cuando el
    // alumno lo abre.
    const leido = leerEjercicio(contenido);
    if (!leido.ok) {
      avisar(
        "El ejercicio quedó mal armado:\n" +
          leido.errores.map((e) => `· ${e.mensaje}`).join("\n"),
        "roto",
      );
      return null;
    }

    // Al editar, la casilla significa "reemplazar": sin marcarla se conserva el
    // código guardado. Si significara "incluir", venir a corregir una coma del
    // enunciado pisaría la solución con lo que hubiera en el editor.
    const editandoAhora = opciones.editando;
    const codigo = elIncluirCodigo.checked
      ? opciones.codigoActual()
      : (editandoAhora?.codigo ?? null);

    return { titulo, contenido, codigo };
  }

  async function enviar(publicar: boolean): Promise<void> {
    const datos = construir();
    if (datos === null) return;

    btnGuardar.disabled = true;
    btnPublicar.disabled = true;
    avisar("Guardando…");

    const editando = opciones.editando;
    const error = publicar
      ? await opciones.publicarEnSala!(datos.titulo, datos.contenido, datos.codigo)
      : editando !== undefined && opciones.actualizar !== undefined
        ? await opciones.actualizar(editando.id, datos.titulo, datos.contenido, datos.codigo)
        : await opciones.guardarPersonal(datos.titulo, datos.contenido, datos.codigo);

    btnGuardar.disabled = false;
    btnPublicar.disabled = opciones.publicarEnSala === null;

    if (error !== null) {
      avisar(error, "roto");
      return;
    }
    opciones.alGuardar();
    dialogo.close();
  }

  // --- Estado inicial ---
  const editando = opciones.editando;
  contenedorCasos.textContent = "";
  filas.length = 0;
  avisar("");

  document.querySelector<HTMLElement>("#dialogo-ejercicio h2")!.textContent =
    editando === undefined ? "Crear ejercicio" : "Editar ejercicio";
  btnGuardar.textContent =
    editando === undefined ? "Guardar en mis ejercicios" : "Guardar cambios";

  if (editando === undefined) {
    elTitulo.value = "";
    elEnunciado.value = "";
    elComparacion.value = "contiene";
    elIncluirCodigo.checked = true;
    agregarCaso();
  } else {
    // Se repuebla desde el `.md` guardado, no desde una copia aparte de los
    // datos: si se pudo leer, es exactamente lo que va a ver el alumno.
    const leido = leerEjercicio(editando.contenido);
    if (leido.ok) {
      elTitulo.value = leido.ejercicio.titulo;
      elEnunciado.value = leido.ejercicio.enunciado;
      elComparacion.value = leido.ejercicio.comparacion;
      for (const caso of leido.ejercicio.casos) {
        agregarCaso();
        const fila = filas[filas.length - 1]!;
        fila.nombre.value = caso.nombre;
        fila.entrada.value = caso.entrada.join("\n");
        fila.salida.value = caso.salidaEsperada;
      }
    } else {
      avisar("El ejercicio guardado no se pudo leer; revisá los campos.", "roto");
    }
    elIncluirCodigo.checked = false;
    if (filas.length === 0) agregarCaso();
  }

  document.querySelector<HTMLElement>("#ej-etiqueta-codigo")!.textContent =
    editando === undefined
      ? "Incluir el seudocódigo que tengo en el editor"
      : editando.codigo === null
        ? "Adjuntar el seudocódigo que tengo en el editor"
        : "Reemplazar el seudocódigo guardado por el del editor";

  // Editando, "Publicar" crearía un duplicado en vez de mover el que se está
  // tocando. Se ofrece solo al crear.
  btnPublicar.hidden = editando !== undefined;
  btnPublicar.disabled = opciones.publicarEnSala === null;
  btnPublicar.title =
    opciones.publicarEnSala === null ? "Primero entrá a una sala" : "Darlo a la clase para que lo resuelvan";

  // Los oyentes se reemplazan en cada apertura para no acumularlos.
  btnAgregar.onclick = () => agregarCaso();
  btnGuardar.onclick = () => void enviar(false);
  btnPublicar.onclick = () => void enviar(true);
  document.querySelector<HTMLButtonElement>("#btn-cerrar-ejercicio")!.onclick = () =>
    dialogo.close();

  dialogo.showModal();
  elTitulo.focus();
}
