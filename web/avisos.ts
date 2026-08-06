/**
 * Avisos flotantes.
 *
 * Una acción sin respuesta visible se siente rota: el usuario vuelve a apretar,
 * y termina publicando dos veces o creyendo que la aplicación se colgó. Las
 * acciones de la sala escribían en la consola del editor, que queda **detrás**
 * del diálogo desde el cual se disparan, así que nadie las leía.
 *
 * Va como *popover* y no como `div` con `z-index` alto ni como `<dialog>`: un
 * diálogo modal vive en la *top layer* del navegador, donde ningún z-index
 * llega —comprobado: el modal de la sala tapaba el aviso—, y `dialog.show()`
 * **no** promueve a esa capa; solo `showModal()` lo hace, y eso bloquearía todo.
 * Un popover sí entra en la top layer y no bloquea nada, que es exactamente lo
 * que hace falta.
 *
 * No son modales a propósito. Casi todos los avisos son confirmaciones que no
 * piden ninguna decisión; obligar a cerrarlas convertiría en castigo cada
 * acción exitosa.
 */

export type TipoAviso = "ok" | "error" | "info";

/** Cuánto queda en pantalla. Un error da más tiempo: hay que poder leerlo. */
const DURACION: Record<TipoAviso, number> = { ok: 3500, info: 3500, error: 7000 };

function contenedor(): HTMLElement {
  const existente = document.querySelector<HTMLElement>("#avisos");
  if (existente !== null) return existente;

  const d = document.createElement("div");
  d.id = "avisos";
  // 'manual' y no 'auto': un popover automático se cierra al tocar cualquier
  // otra cosa, y estos tienen que poder leerse mientras se sigue trabajando.
  d.popover = "manual";
  document.body.appendChild(d);
  return d;
}

/**
 * Muestra un aviso. Se va solo; también se puede cerrar haciendo clic.
 *
 * Con un modal abierto el aviso **se ve** por encima, pero no se puede clickear:
 * el navegador vuelve inerte todo lo que está fuera de un diálogo modal. Por eso
 * cerrarse solo no es una comodidad sino el mecanismo principal, y el clic es el
 * atajo para cuando no hay ningún modal.
 *
 * Devuelve una función para quitarlo antes de tiempo, útil cuando una operación
 * larga termina y su "guardando…" ya no viene al caso.
 */
export function notificar(mensaje: string, tipo: TipoAviso = "ok"): () => void {
  const caja = contenedor();
  // `showPopover` lanza si ya está abierto, así que se pregunta antes. Y si el
  // navegador no soporta popover, el aviso igual se muestra: pierde la garantía
  // de quedar por encima de un modal, no la de verse.
  try {
    if (!caja.matches(":popover-open")) caja.showPopover();
  } catch {
    caja.style.zIndex = "9999";
  }

  const aviso = document.createElement("div");
  aviso.className = `aviso ${tipo}`;
  aviso.setAttribute("role", tipo === "error" ? "alert" : "status");
  aviso.textContent = mensaje.trim();

  const quitar = (): void => {
    if (!aviso.isConnected) return;
    aviso.classList.add("yendose");
    // Se espera a que termine la transición para no cortar el desvanecido.
    setTimeout(() => {
      aviso.remove();
      if (caja.childElementCount === 0) {
        try {
          caja.hidePopover();
        } catch {
          /* nunca llegó a abrirse como popover */
        }
      }
    }, 180);
  };

  aviso.addEventListener("click", quitar);
  caja.appendChild(aviso);

  const reloj = setTimeout(quitar, DURACION[tipo]);
  return () => {
    clearTimeout(reloj);
    quitar();
  };
}
