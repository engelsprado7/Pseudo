/**
 * Panel de la clase: la planilla de alumnos por ejercicio.
 *
 * Solo lo ve el docente de la sala. Se abre sin bloquear el editor —`show()` y
 * no `showModal()`— porque durante una clase hay que poder explicar, ejecutar y
 * corregir con la planilla a la vista. Si obligara a cerrarla para trabajar,
 * nadie la miraría.
 *
 * Muestra quién está trabado y en qué, nunca el código de nadie: ver dónde se
 * traba alguien alcanza para enseñarle, y leerle el programa por encima del
 * hombro es otra cosa.
 */
import { armarPlanilla, resumenDeEjercicio, type Planilla } from "../src/planilla.ts";
import { icono } from "./iconos.ts";
import {
  listarMiembros,
  listarProgreso,
  type Publicacion,
} from "./salas.ts";

export interface PanelDeClase {
  /** Vuelve a pedir los datos y redibuja, si el panel está en uso. */
  refrescar(): Promise<void>;
  /** Cambia de sala. `null` cuando no hay ninguna o no sos docente. */
  cambiarSala(sala: string | null, soyDocente: boolean, ejercicios: Publicacion[]): void;
  abrir(): void;
}

const SIMBOLO: Record<string, string> = {
  aprobado: "✓",
  parcial: "◐",
  fallado: "✗",
  "sin-empezar": "○",
};

export function crearPanelDeClase(): PanelDeClase {
  const btn = document.querySelector<HTMLButtonElement>("#btn-clase")!;
  const dialogo = document.querySelector<HTMLDialogElement>("#dialogo-clase")!;
  const cuerpo = document.querySelector<HTMLElement>("#clase-cuerpo")!;
  const resumen = document.querySelector<HTMLElement>("#clase-resumen")!;

  btn.prepend(icono("salas", 13));
  document.querySelector<HTMLButtonElement>("#btn-cerrar-clase")!.append(icono("cerrar", 14));

  let sala: string | null = null;
  let ejercicios: Publicacion[] = [];
  let insignia: HTMLElement | null = null;

  /** El número en el botón: enterarse sin abrir nada. */
  function marcarInsignia(cuantos: number): void {
    if (cuantos === 0) {
      insignia?.remove();
      insignia = null;
      return;
    }
    insignia ??= (() => {
      const s = document.createElement("span");
      s.className = "insignia";
      btn.appendChild(s);
      return s;
    })();
    insignia.textContent = String(cuantos);
    btn.title = `${cuantos} ${cuantos === 1 ? "alumno necesita" : "alumnos necesitan"} ayuda`;
  }

  function pintar(planilla: Planilla): void {
    cuerpo.textContent = "";

    if (planilla.filas.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "vacio";
      vacio.textContent = "Todavía no hay alumnos en esta sala. Pasales el código para que entren.";
      cuerpo.appendChild(vacio);
      resumen.textContent = "";
      return;
    }
    if (planilla.ejercicios.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "vacio";
      vacio.textContent = "Todavía no asignaste ningún ejercicio a la clase.";
      cuerpo.appendChild(vacio);
      resumen.textContent = `${planilla.filas.length} en la sala`;
      return;
    }

    const partes: string[] = [];
    if (planilla.necesitanAyuda > 0) partes.push(`${planilla.necesitanAyuda} necesitan ayuda`);
    if (planilla.sinEmpezar > 0) partes.push(`${planilla.sinEmpezar} sin empezar`);
    resumen.textContent = partes.join(" · ") || "toda la clase al día";

    const tabla = document.createElement("table");

    const thead = document.createElement("thead");
    const filaCabecera = document.createElement("tr");
    const esquina = document.createElement("th");
    esquina.textContent = `Alumno (${planilla.filas.length})`;
    filaCabecera.appendChild(esquina);
    for (const [i, e] of planilla.ejercicios.entries()) {
      const th = document.createElement("th");
      const r = resumenDeEjercicio(planilla, i);
      th.textContent = e.titulo;
      th.title = `${r.aprobaron} de ${r.total} aprobaron`;
      const cuenta = document.createElement("div");
      cuenta.style.cssText = "font-weight:400;text-transform:none;letter-spacing:0";
      cuenta.textContent = `${r.aprobaron}/${r.total}`;
      th.appendChild(cuenta);
      filaCabecera.appendChild(th);
    }
    thead.appendChild(filaCabecera);
    tabla.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const fila of planilla.filas) {
      const tr = document.createElement("tr");
      // Se marca a quien pide atención de verdad, no a quien simplemente no
      // arrancó: si se marcara todo, no se destacaría nada.
      if (fila.celdas.some((c) => c.estado === "fallado" || c.estado === "parcial")) {
        tr.className = "pl-atencion";
      }

      const tdNombre = document.createElement("td");
      tdNombre.className = "pl-nombre";
      tdNombre.textContent = fila.nombre;
      tr.appendChild(tdNombre);

      for (const celda of fila.celdas) {
        const td = document.createElement("td");
        td.className = "pl-celda";
        const marca = document.createElement("span");
        marca.className = `pl-marca ${celda.estado}`;
        marca.append(document.createTextNode(SIMBOLO[celda.estado] ?? "○"));

        if (celda.estado === "parcial" || celda.estado === "fallado") {
          marca.append(document.createTextNode(` ${celda.aprobados}/${celda.total}`));
          // Los intentos separan al frustrado del distraído: nueve fallidos y
          // uno solo son la misma cifra de aprobados y piden cosas distintas.
          if (celda.intentos > 1) {
            const n = document.createElement("span");
            n.className = "pl-intentos";
            n.textContent = `·${celda.intentos}`;
            marca.appendChild(n);
          }
          td.title = `${celda.aprobados} de ${celda.total} casos · ${celda.intentos} ${celda.intentos === 1 ? "intento" : "intentos"}`;
        } else if (celda.estado === "sin-empezar") {
          td.title = "Todavía no verificó";
        } else {
          td.title = "Aprobado";
        }

        td.appendChild(marca);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    tabla.appendChild(tbody);
    cuerpo.appendChild(tabla);
  }

  async function refrescar(): Promise<void> {
    if (sala === null) return;
    const [miembros, progreso] = await Promise.all([listarMiembros(sala), listarProgreso(sala)]);
    if (!miembros.ok || !progreso.ok) return;

    const planilla = armarPlanilla(
      miembros.dato,
      progreso.dato,
      ejercicios.map((e) => ({ id: e.id, titulo: e.titulo })),
    );
    marcarInsignia(planilla.necesitanAyuda);
    if (dialogo.open) pintar(planilla);
  }

  document
    .querySelector<HTMLButtonElement>("#btn-cerrar-clase")!
    .addEventListener("click", () => dialogo.close());

  btn.addEventListener("click", () => {
    if (dialogo.open) {
      dialogo.close();
      return;
    }
    // Sin modal: la planilla acompaña la clase, no la interrumpe.
    dialogo.show();
    void refrescar();
  });

  return {
    refrescar,
    abrir: () => {
      if (!dialogo.open) dialogo.show();
      void refrescar();
    },
    cambiarSala(nueva, soyDocente, listaEjercicios) {
      sala = soyDocente ? nueva : null;
      ejercicios = listaEjercicios;
      btn.hidden = sala === null;
      if (sala === null) {
        dialogo.close();
        marcarInsignia(0);
        return;
      }
      void refrescar();
    },
  };
}
