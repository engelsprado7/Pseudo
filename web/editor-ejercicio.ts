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
import { escribirEjercicio, leerEjercicio, type CasoDePrueba } from "../src/ejercicio.ts";

export interface OpcionesEditor {
  /** Seudocódigo del editor, para ofrecer adjuntarlo. */
  codigoActual: () => string;
  /** Guarda sin publicar. Devuelve el mensaje de error, o `null` si salió bien. */
  guardarPersonal: (titulo: string, contenido: string, codigo: string | null) => Promise<string | null>;
  /** Publica en la sala actual. `null` si no hay sala elegida. */
  publicarEnSala:
    | ((titulo: string, contenido: string, codigo: string | null) => Promise<string | null>)
    | null;
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
    const quitar = document.createElement("button");
    quitar.textContent = "Quitar";
    cabecera.append(nombre, quitar);

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
      comparacion: "normalizada",
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

    return {
      titulo,
      contenido,
      codigo: elIncluirCodigo.checked ? opciones.codigoActual() : null,
    };
  }

  async function enviar(publicar: boolean): Promise<void> {
    const datos = construir();
    if (datos === null) return;

    btnGuardar.disabled = true;
    btnPublicar.disabled = true;
    avisar("Guardando…");

    const error = publicar
      ? await opciones.publicarEnSala!(datos.titulo, datos.contenido, datos.codigo)
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
  elTitulo.value = "";
  elEnunciado.value = "";
  elIncluirCodigo.checked = true;
  contenedorCasos.textContent = "";
  filas.length = 0;
  avisar("");
  agregarCaso();

  btnPublicar.disabled = opciones.publicarEnSala === null;
  btnPublicar.title =
    opciones.publicarEnSala === null ? "Primero entrá a una sala" : "Publicar en la sala actual";

  // Los oyentes se reemplazan en cada apertura para no acumularlos.
  btnAgregar.onclick = () => agregarCaso();
  btnGuardar.onclick = () => void enviar(false);
  btnPublicar.onclick = () => void enviar(true);
  document.querySelector<HTMLButtonElement>("#btn-cerrar-ejercicio")!.onclick = () =>
    dialogo.close();

  dialogo.showModal();
  elTitulo.focus();
}
