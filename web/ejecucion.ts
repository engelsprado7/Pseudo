/**
 * Motor de ejecución para el navegador.
 *
 * En el README había anotado que esto tendría que ir en un web worker para que
 * el bucle infinito de un alumno no congelara la página. **No hace falta**, y el
 * motivo es que el intérprete es un generador: se puede avanzar N pasos, ceder
 * el control al navegador con un `setTimeout`, y seguir. La página queda viva y
 * el botón Detener responde.
 *
 * Un worker además complicaría justo lo que más importa acá: `Leer` necesita
 * interacción con la interfaz, y con un worker cada valor tendría que ir y venir
 * por mensajes. Si algún día el intérprete deja de ceder por sentencia, habrá
 * que revisar esta decisión.
 */
import type { Programa } from "../src/ast.ts";
import { ejecutar, type Evento, type Resultado } from "../src/interprete.ts";

/** Pasos entre una cesión y la siguiente. Suficiente para que se sienta instantáneo. */
const PASOS_POR_TANDA = 3000;

export interface Consola {
  escribir(texto: string, sinSalto: boolean): void;
  /** Devuelve `undefined` si el usuario cancela. */
  pedir(peticion: Extract<Evento, { clase: "entrada" }>): Promise<string | undefined>;
  paso?(evento: Extract<Evento, { clase: "paso" }>): void;
}

export interface Controlador {
  detener(): void;
  readonly terminada: Promise<Resultado | null>;
}

/** Arranca la ejecución. `null` en la promesa significa que se detuvo a mano. */
export function iniciar(
  programa: Programa,
  consola: Consola,
  opciones: { pasoAPaso?: boolean } = {},
): Controlador {
  const generador = ejecutar(programa, { pasoAPaso: opciones.pasoAPaso ?? false });
  let detenido = false;

  const ceder = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  const terminada = (async (): Promise<Resultado | null> => {
    let respuesta: string | undefined;
    let paso = generador.next();
    let desdeLaUltimaCesion = 0;

    while (!paso.done) {
      if (detenido) {
        generador.return({ clase: "terminado", pasos: 0 });
        return null;
      }

      const evento = paso.value;

      if (evento.clase === "salida") {
        consola.escribir(evento.texto, evento.sinSalto);
        respuesta = undefined;
      } else if (evento.clase === "entrada") {
        // Esperar al usuario ya devuelve el control al navegador.
        respuesta = await consola.pedir(evento);
        desdeLaUltimaCesion = 0;
        if (respuesta === undefined) {
          generador.return({ clase: "terminado", pasos: 0 });
          return null;
        }
      } else {
        consola.paso?.(evento);
        respuesta = undefined;
      }

      paso = generador.next(respuesta);

      if (++desdeLaUltimaCesion >= PASOS_POR_TANDA) {
        desdeLaUltimaCesion = 0;
        await ceder();
      }
    }

    return paso.value;
  })();

  return {
    detener() {
      detenido = true;
    },
    terminada,
  };
}
