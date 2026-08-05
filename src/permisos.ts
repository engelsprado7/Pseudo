/**
 * Qué puede hacer cada persona con cada cosa de la sala.
 *
 * Esto decide **qué se le ofrece** a alguien, no qué se le permite: lo que
 * manda son las políticas RLS de la base, que se cumplen aunque el navegador
 * mienta. Ofrecer de más no abre un agujero, pero sí produce un botón que
 * falla al apretarlo, y un botón que falla es peor que uno que no está.
 *
 * Vive acá y no en la capa web para poder probarlo sin navegador ni sesiones.
 * Estas reglas son justamente las que no se pueden verificar sin varias cuentas
 * abiertas a la vez, así que tenerlas como función pura es la única forma de
 * tener confianza en ellas.
 */

export type TipoDeItem =
  /** Ejercicio propio sin publicar. */
  | "personal"
  /** Ejercicio asignado a la clase. */
  | "ejercicio"
  /** Entrega: la solución de alguien. */
  | "programa";

export type AccionDeItem = "asignar" | "editar" | "retirar" | "copiar" | "borrar";

export interface ItemDeSala {
  tipo: TipoDeItem;
  autorId: string;
}

export interface ContextoDeSala {
  /** `null` si no hay sesión. */
  usuarioId: string | null;
  /** Si hay una sala elegida ahora. */
  haySala: boolean;
  /** Si soy docente de esa sala. */
  soyDocente: boolean;
}

/**
 * Acciones que corresponden sobre un ítem del feed.
 *
 * El orden importa: es el que se dibuja, y lo más frecuente va primero.
 */
export function accionesDeItem(item: ItemDeSala, ctx: ContextoDeSala): AccionDeItem[] {
  const esMio = ctx.usuarioId !== null && item.autorId === ctx.usuarioId;

  if (item.tipo === "personal") {
    // Un borrador solo lo ve su autor, así que llegar acá ya implica que es
    // propio. Asignar necesita una sala a la cual asignarlo.
    return ctx.haySala ? ["asignar", "editar", "borrar"] : ["editar", "borrar"];
  }

  if (item.tipo === "ejercicio") {
    // Retirar devuelve el ejercicio a borradores; no lo copia ni lo borra.
    if (esMio) return ["editar", "retirar"];
    // De un ejercicio ajeno se puede hacer una copia propia para practicar.
    return ["copiar"];
  }

  // Entregas: cada quien retira la suya. El docente además modera su sala.
  if (esMio) return ["borrar"];
  return ctx.soyDocente ? ["borrar"] : [];
}

export type AccionDeMiembro = "hacer-docente" | "hacer-alumno" | "quitar";

export interface MiembroDeSala {
  id: string;
  rol: "docente" | "alumno";
}

/**
 * Acciones sobre un miembro de la sala.
 *
 * Solo el docente administra. Nadie se quita a sí mismo desde acá —para irse
 * está salir de la sala—, y sobre todo: quitarse uno mismo siendo el único
 * docente dejaría la sala sin nadie a cargo, que es lo que el trigger de la
 * base impide de todos modos.
 */
export function accionesDeMiembro(
  miembro: MiembroDeSala,
  ctx: ContextoDeSala,
): AccionDeMiembro[] {
  if (!ctx.soyDocente) return [];

  const acciones: AccionDeMiembro[] = [
    miembro.rol === "docente" ? "hacer-alumno" : "hacer-docente",
  ];
  if (miembro.id !== ctx.usuarioId) acciones.push("quitar");
  return acciones;
}

/**
 * Qué secciones del feed tienen sentido mostrar.
 *
 * Sin sala, las secciones de la sala no vienen al caso: se ocultan en vez de
 * mostrar un "todavía no hay nada" que se lee como un error cuando en realidad
 * falta entrar a una clase.
 */
export function seccionesVisibles(ctx: ContextoDeSala): TipoDeItem[] {
  return ctx.haySala ? ["personal", "ejercicio", "programa"] : ["personal"];
}
