/**
 * Iconos SVG, dibujados a mano.
 *
 * Son inline y no una fuente ni una librería por tres motivos: no agregan una
 * petición de red (importa en un laboratorio con internet lento o sin él), usan
 * `currentColor` así que siguen el tema claro/oscuro sin trabajo extra, y pesan
 * unos cientos de bytes en total contra las decenas de kB de cualquier paquete.
 *
 * Todos comparten la misma caja de 24 y el mismo grosor de trazo, que es lo que
 * hace que se vean de la misma familia.
 */

const TRAZOS: Record<string, string> = {
  publicar: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  borrar: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  copiar:
    '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  bajar: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  mas: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  compartir:
    '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/>',
  cerrar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  salas: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>',
  verificar: '<path d="M20 6 9 17l-5-5"/>',
};

export type NombreIcono = keyof typeof TRAZOS | string;

/** Devuelve el SVG de un icono, listo para insertar. Tamaño en píxeles. */
export function icono(nombre: NombreIcono, tamano = 14): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(tamano));
  svg.setAttribute("height", String(tamano));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  // Decorativo: el texto del botón ya dice lo que hace.
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = TRAZOS[nombre] ?? "";
  return svg;
}
