/**
 * Cómo se abre en el editor algo que viene de la sala.
 *
 * "Abrir" significa cuatro cosas distintas según de quién sea la cosa y para
 * qué se abra, y las diferencias no son de matiz: deciden si se recupera lo que
 * uno tenía escrito, dónde se guarda el avance, y si el resultado de verificar
 * cuenta como progreso de alguien.
 *
 * Todas juntas produjeron cuatro errores seguidos, cada uno arreglado por
 * separado hasta que el siguiente aparecía en otro lado. Estaban en cuatro
 * condicionales repartidos por la interfaz; acá quedan en una tabla que se lee
 * de una vez y se prueba sin navegador.
 */

export type ClaseDeApertura =
  /** Un ejercicio asignado a la clase, para resolverlo. */
  | "ejercicio-asignado"
  /** Un ejercicio propio sin publicar. */
  | "borrador-propio"
  /** La solución que uno mismo entregó. */
  | "entrega-propia"
  /** La solución que entregó otra persona. */
  | "entrega-ajena";

export interface ItemAbierto {
  tipo: "personal" | "ejercicio" | "programa";
  autorId: string;
}

export function claseDeApertura(item: ItemAbierto, usuarioId: string | null): ClaseDeApertura {
  if (item.tipo === "personal") return "borrador-propio";
  if (item.tipo === "ejercicio") return "ejercicio-asignado";
  return usuarioId !== null && item.autorId === usuarioId ? "entrega-propia" : "entrega-ajena";
}

export interface Pedido {
  clase: ClaseDeApertura;
  /** Id de lo que se abre. */
  id: string;
  /** Ejercicio al que responde una entrega; `null` si es código suelto. */
  ejercicio?: string | null;
}

export interface Apertura {
  /**
   * Dónde recordar lo que se escriba, y de dónde recuperarlo al volver.
   *
   * `null` significa que lo abierto no es trabajo propio: no se restaura nada
   * encima —hay que ver lo que la otra persona mandó— ni se guarda lo que se
   * toque, que iría a parar a una ranura ajena.
   */
  ranura: string | null;
  /**
   * Con qué ejercicio registrar el resultado de verificar.
   *
   * `null` significa no registrar: corregir lo de otro no es progreso propio, y
   * practicar en un borrador privado no tiene por qué llegarle al docente.
   */
  progreso: string | null;
}

/**
 * La tabla de decisiones. Cada fila responde a un error concreto que ocurrió.
 */
export function comoAbrir(p: Pedido): Apertura {
  switch (p.clase) {
    case "ejercicio-asignado":
      // Lo que uno está resolviendo: se recuerda el avance y cuenta para la
      // planilla del docente.
      return { ranura: p.id, progreso: p.id };

    case "borrador-propio":
      // Es del taller privado: se recuerda el avance, pero no se informa a
      // nadie. Un borrador es privado por definición.
      return { ranura: p.id, progreso: null };

    case "entrega-propia":
      // La ranura y el progreso van por el ejercicio, no por la entrega: es el
      // mismo trabajo, y perder ese vínculo hacía que volver a entregar
      // insertara una segunda fila en vez de reemplazar la anterior.
      return { ranura: p.ejercicio ?? p.id, progreso: p.ejercicio ?? null };

    case "entrega-ajena":
      // Un envío cerrado de otra persona: se muestra tal cual llegó. Restaurar
      // una copia local acá hacía que quien corregía viera su propia versión
      // anterior y los cambios del alumno parecieran no llegar nunca.
      return { ranura: null, progreso: null };
  }
}
