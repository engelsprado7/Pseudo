/**
 * Planilla de la clase: alumnos en filas, ejercicios en columnas.
 *
 * Es la vista que un docente ya sabe leer, y responde de un vistazo las tres
 * preguntas que importan mientras se da clase: cómo va el grupo (se miran las
 * columnas), a quién ir a ayudar (se miran las filas) y qué ejercicio está
 * costando (una columna entera en rojo).
 *
 * Está acá y no en la capa web porque es aritmética pura sobre datos: así se
 * puede probar en Node, que es la única forma de tener confianza en el orden
 * —lo que decide a quién ve primero el docente— sin dos sesiones abiertas.
 */

export interface MiembroDeClase {
  id: string;
  nombre: string;
  rol: "docente" | "alumno";
}

export interface ProgresoDeAlumno {
  ejercicio: string;
  alumno: string;
  aprobados: number;
  total: number;
  intentos: number;
  actualizado?: string;
}

export interface EjercicioDeClase {
  id: string;
  titulo: string;
}

/**
 * Estado de un alumno en un ejercicio.
 *
 * `sin-empezar` existe porque no es lo mismo que fallar: quien no arrancó puede
 * estar ausente, perdido o esperando indicaciones, y eso pide otra cosa que
 * quien lleva nueve intentos. Sin este estado, ambos aparecían igual —como una
 * ausencia en la cuenta— y el docente no podía distinguirlos.
 */
export type EstadoCelda = "aprobado" | "parcial" | "fallado" | "sin-empezar";

export interface Celda {
  estado: EstadoCelda;
  aprobados: number;
  total: number;
  intentos: number;
}

export interface FilaDeAlumno {
  id: string;
  nombre: string;
  celdas: Celda[];
  /** Ejercicios aprobados, para el resumen de la fila. */
  aprobados: number;
  /** Cuánto conviene mirarlo: más alto, más arriba aparece. */
  prioridad: number;
}

export interface Planilla {
  ejercicios: EjercicioDeClase[];
  filas: FilaDeAlumno[];
  /** Cuántos alumnos están peleándola sin lograrlo. */
  necesitanAyuda: number;
  /** Cuántos no verificaron ni una vez. */
  sinEmpezar: number;
}

const VACIA: Celda = { estado: "sin-empezar", aprobados: 0, total: 0, intentos: 0 };

function celdaDe(p: ProgresoDeAlumno | undefined): Celda {
  if (p === undefined) return VACIA;
  const estado: EstadoCelda =
    p.total > 0 && p.aprobados === p.total
      ? "aprobado"
      : p.aprobados > 0
        ? "parcial"
        : "fallado";
  return { estado, aprobados: p.aprobados, total: p.total, intentos: p.intentos };
}

/**
 * Cuánta atención pide un alumno.
 *
 * El criterio es el del aula, no el de la nota: arriba va quien está trabado
 * *intentando*, porque es a quien más rinde acercarse. Los intentos pesan
 * porque nueve fallidos son una frustración y uno solo puede ser una distracción.
 * Quien no empezó pesa menos que quien pelea, pero más que quien ya aprobó: hay
 * que mirarlo, aunque quizás solo falte darle la consigna.
 */
function prioridadDe(celdas: Celda[]): number {
  let puntos = 0;
  for (const c of celdas) {
    if (c.estado === "fallado") puntos += 10 + Math.min(c.intentos, 10);
    else if (c.estado === "parcial") puntos += 6 + Math.min(c.intentos, 10);
    else if (c.estado === "sin-empezar") puntos += 1;
  }
  return puntos;
}

/**
 * Arma la planilla.
 *
 * La lista de alumnos sale de los miembros de la sala, no de quienes tienen
 * progreso: si saliera del progreso, quien nunca verificó no existiría, que es
 * justamente el que más conviene ver.
 *
 * Los docentes se excluyen: la planilla es de la clase, y el propio docente
 * probando su ejercicio no es un alumno trabado.
 */
export function armarPlanilla(
  miembros: MiembroDeClase[],
  progreso: ProgresoDeAlumno[],
  ejercicios: EjercicioDeClase[],
): Planilla {
  const porAlumno = new Map<string, Map<string, ProgresoDeAlumno>>();
  for (const p of progreso) {
    const suyo = porAlumno.get(p.alumno) ?? new Map<string, ProgresoDeAlumno>();
    suyo.set(p.ejercicio, p);
    porAlumno.set(p.alumno, suyo);
  }

  const filas: FilaDeAlumno[] = miembros
    .filter((m) => m.rol === "alumno")
    .map((m) => {
      const suyo = porAlumno.get(m.id);
      const celdas = ejercicios.map((e) => celdaDe(suyo?.get(e.id)));
      return {
        id: m.id,
        nombre: m.nombre,
        celdas,
        aprobados: celdas.filter((c) => c.estado === "aprobado").length,
        prioridad: prioridadDe(celdas),
      };
    });

  // Primero quien más atención pide; a igual prioridad, por nombre, para que
  // la lista no baile entre actualizaciones.
  filas.sort((a, b) =>
    b.prioridad === a.prioridad
      ? a.nombre.localeCompare(b.nombre)
      : b.prioridad - a.prioridad,
  );

  return {
    ejercicios,
    filas,
    necesitanAyuda: filas.filter((f) =>
      f.celdas.some((c) => c.estado === "fallado" || c.estado === "parcial"),
    ).length,
    sinEmpezar: filas.filter((f) => f.celdas.every((c) => c.estado === "sin-empezar")).length,
  };
}

/** Resumen de una columna, para la fila de totales. */
export function resumenDeEjercicio(
  planilla: Planilla,
  indice: number,
): { aprobaron: number; total: number } {
  return {
    aprobaron: planilla.filas.filter((f) => f.celdas[indice]?.estado === "aprobado").length,
    total: planilla.filas.length,
  };
}
