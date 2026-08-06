/**
 * Agrupación de entregas por alumno.
 *
 * Una lista plana responde "qué se entregó" pero no "cuánto entregó cada uno",
 * que es la pregunta que un docente se hace al final de la clase. Con cinco
 * ejercicios y veinte alumnos son cien filas donde el nombre se repite y hay que
 * ir contando de memoria.
 *
 * Está acá y no en la capa web porque es aritmética sobre datos: así se prueba
 * en Node, incluidas las fechas, que son la parte donde es fácil equivocarse sin
 * que se note.
 */

export interface EntregaDeAlumno {
  id: string;
  titulo: string;
  autor: string;
  autorId: string;
  /** Fecha ISO en que se entregó (o se volvió a entregar). */
  creado: string;
}

export interface GrupoDeAlumno {
  autorId: string;
  nombre: string;
  entregas: EntregaDeAlumno[];
  /** Fecha de la entrega más reciente, para saber si sigue trabajando. */
  ultima: string;
}

/**
 * Agrupa por alumno, en orden alfabético.
 *
 * Alfabético y no por cantidad porque esta lista se usa para **buscar a alguien**
 * ("¿qué entregó Miriam?"), y un orden que cambia según quién entregó último
 * obliga a releerla entera cada vez. Quién va atrasado ya lo responde la planilla.
 */
export function agruparPorAlumno(entregas: EntregaDeAlumno[]): GrupoDeAlumno[] {
  const porAlumno = new Map<string, EntregaDeAlumno[]>();
  for (const e of entregas) {
    const suyas = porAlumno.get(e.autorId) ?? [];
    suyas.push(e);
    porAlumno.set(e.autorId, suyas);
  }

  const grupos: GrupoDeAlumno[] = [];
  for (const [autorId, suyas] of porAlumno) {
    // Dentro de cada alumno, lo último primero: es lo que estaba haciendo.
    const ordenadas = [...suyas].sort((a, b) => b.creado.localeCompare(a.creado));
    grupos.push({
      autorId,
      nombre: ordenadas[0]!.autor,
      entregas: ordenadas,
      ultima: ordenadas[0]!.creado,
    });
  }

  return grupos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

/**
 * Fecha en palabras, como la diría alguien.
 *
 * Un docente no necesita el segundo exacto: necesita saber si fue en esta clase,
 * hoy o hace días. "hace 5 min" y "ayer 14:30" responden eso; una marca ISO
 * completa hay que traducirla mentalmente cada vez.
 */
export function fechaRelativa(iso: string, ahora: Date = new Date()): string {
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return "";

  const diferencia = ahora.getTime() - cuando.getTime();
  if (diferencia < MINUTO) return "recién";
  if (diferencia < HORA) return `hace ${Math.floor(diferencia / MINUTO)} min`;

  const hora = cuando.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

  // Se compara el día del calendario, no las 24 horas: a las 00:30 lo de ayer a
  // las 23:00 es "ayer", aunque hayan pasado noventa minutos.
  const dia = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diasDeDiferencia = Math.round((dia(ahora) - dia(cuando)) / 86_400_000);

  if (diasDeDiferencia === 0) return hora;
  if (diasDeDiferencia === 1) return `ayer ${hora}`;
  if (diasDeDiferencia < 7) return `hace ${diasDeDiferencia} días`;

  return cuando.toLocaleDateString("es", { day: "numeric", month: "short" });
}

/** "3 entregas" / "1 entrega": el plural mal puesto se nota y distrae. */
export function contarEntregas(cuantas: number): string {
  return `${cuantas} ${cuantas === 1 ? "entrega" : "entregas"}`;
}
