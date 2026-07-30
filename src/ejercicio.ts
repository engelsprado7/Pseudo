/**
 * Ejercicios con verificación automática.
 *
 * El formato es Markdown a propósito. Un docente tiene que poder escribir un
 * ejercicio a mano sin pelear con comillas, comas finales ni sangría
 * significativa, y el archivo se lee bien tal cual, sin herramientas. JSON
 * habría sido más fácil de parsear y bastante peor de escribir.
 *
 * ```markdown
 * # Área de un rectángulo
 *
 * Leé la base y la altura y escribí el área.
 *
 * Comparación: contiene
 *
 * ## Caso: enteros
 *
 * ~~~entrada
 * 5
 * 3
 * ~~~
 *
 * ~~~salida
 * El área es: 15.0
 * ~~~
 * ```
 *
 * (con ``` en lugar de ~~~ en el archivo real).
 */
import type { Programa } from "./ast.ts";
import { ejecutar, type Resultado } from "./interprete.ts";
import type { Diagnostico } from "./diagnostico.ts";

// ------------------------------------------------------------------
// Modelo
// ------------------------------------------------------------------

/**
 * Cómo se compara la salida del alumno con la esperada.
 *
 * Elegir esto es una decisión pedagógica, no técnica, y por eso está en el
 * archivo del ejercicio y no clavada en el código.
 */
export type ModoComparacion =
  /** Carácter por carácter. Para cuando el formato exacto es parte del ejercicio. */
  | "exacta"
  /** Ignora espacios al final de cada línea y líneas vacías al final. El predeterminado. */
  | "normalizada"
  /** Además ignora mayúsculas y colapsa los espacios internos. */
  | "flexible"
  /**
   * Las líneas esperadas tienen que aparecer, en orden, entre las obtenidas.
   *
   * Es el modo para ejercicios donde el alumno escribe mensajes propios
   * ("Ingrese la base: "). Sin esto, cada alumno inventa un texto distinto para
   * los prompts y todos fallan por algo que no era el ejercicio.
   */
  | "contiene";

export interface CasoDePrueba {
  nombre: string;
  entrada: string[];
  salidaEsperada: string;
}

export interface Ejercicio {
  titulo: string;
  enunciado: string;
  comparacion: ModoComparacion;
  /** Si está definido, los números se redondean a N decimales antes de comparar. */
  decimales: number | null;
  casos: CasoDePrueba[];
}

export interface ErrorDeFormato {
  linea: number;
  mensaje: string;
}

// ------------------------------------------------------------------
// Lectura del formato
// ------------------------------------------------------------------

const MODOS: ModoComparacion[] = ["exacta", "normalizada", "flexible", "contiene"];

export function leerEjercicio(
  texto: string,
): { ok: true; ejercicio: Ejercicio } | { ok: false; errores: ErrorDeFormato[] } {
  const lineas = texto.split("\n");
  const errores: ErrorDeFormato[] = [];

  let titulo = "";
  const enunciado: string[] = [];
  let comparacion: ModoComparacion = "normalizada";
  let decimales: number | null = null;
  const casos: CasoDePrueba[] = [];

  let casoActual: { nombre: string; linea: number; entrada?: string[]; salida?: string } | null =
    null;

  const cerrarCaso = (): void => {
    if (casoActual === null) return;
    if (casoActual.entrada === undefined) {
      errores.push({
        linea: casoActual.linea,
        mensaje: `al caso "${casoActual.nombre}" le falta el bloque de entrada.`,
      });
    }
    if (casoActual.salida === undefined) {
      errores.push({
        linea: casoActual.linea,
        mensaje: `al caso "${casoActual.nombre}" le falta el bloque de salida.`,
      });
    }
    if (casoActual.entrada !== undefined && casoActual.salida !== undefined) {
      casos.push({
        nombre: casoActual.nombre,
        entrada: casoActual.entrada,
        salidaEsperada: casoActual.salida,
      });
    }
    casoActual = null;
  };

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]!;
    const numero = i + 1;

    // --- Título ---
    const encabezado1 = /^#\s+(.*)$/.exec(linea);
    if (encabezado1 !== null) {
      cerrarCaso();
      if (titulo !== "") {
        errores.push({ linea: numero, mensaje: "hay más de un título (# ...) en el archivo." });
      }
      titulo = encabezado1[1]!.trim();
      continue;
    }

    // --- Caso ---
    const encabezado2 = /^##\s+(?:Caso\s*:?\s*)?(.*)$/i.exec(linea);
    if (encabezado2 !== null) {
      cerrarCaso();
      const nombre = encabezado2[1]!.trim();
      casoActual = { nombre: nombre === "" ? `caso ${casos.length + 1}` : nombre, linea: numero };
      continue;
    }

    // --- Bloque cercado ---
    const apertura = /^\s*```(\w*)\s*$/.exec(linea);
    if (apertura !== null) {
      const etiqueta = (apertura[1] ?? "").toLowerCase();
      const cuerpo: string[] = [];
      let cerrado = false;
      i++;
      for (; i < lineas.length; i++) {
        if (/^\s*```\s*$/.test(lineas[i]!)) {
          cerrado = true;
          break;
        }
        cuerpo.push(lineas[i]!);
      }
      if (!cerrado) {
        errores.push({ linea: numero, mensaje: "este bloque ``` nunca se cierra." });
      }

      if (etiqueta === "entrada" || etiqueta === "salida") {
        if (casoActual === null) {
          errores.push({
            linea: numero,
            mensaje: `hay un bloque de ${etiqueta} fuera de todo caso. Agregá un '## Caso: ...' antes.`,
          });
          continue;
        }
        if (etiqueta === "entrada") {
          if (casoActual.entrada !== undefined) {
            errores.push({
              linea: numero,
              mensaje: `el caso "${casoActual.nombre}" tiene dos bloques de entrada.`,
            });
          }
          // Una línea vacía al final del bloque no es un valor a ingresar.
          const valores = [...cuerpo];
          while (valores.length > 0 && valores[valores.length - 1]!.trim() === "") valores.pop();
          casoActual.entrada = valores;
        } else {
          if (casoActual.salida !== undefined) {
            errores.push({
              linea: numero,
              mensaje: `el caso "${casoActual.nombre}" tiene dos bloques de salida.`,
            });
          }
          casoActual.salida = cuerpo.join("\n");
        }
        continue;
      }

      // Un bloque sin etiqueta dentro del enunciado es ejemplo, se conserva.
      if (casoActual === null) {
        enunciado.push("```" + etiqueta, ...cuerpo, "```");
      }
      continue;
    }

    // --- Opciones ---
    const opcion = /^\s*Comparaci[óo]n\s*:\s*(.+)$/i.exec(linea);
    if (opcion !== null) {
      const valor = opcion[1]!.trim().toLowerCase();
      if ((MODOS as string[]).includes(valor)) {
        comparacion = valor as ModoComparacion;
      } else {
        errores.push({
          linea: numero,
          mensaje: `"${valor}" no es un modo de comparación. Los modos son: ${MODOS.join(", ")}.`,
        });
      }
      continue;
    }

    const opcionDecimales = /^\s*Decimales\s*:\s*(.+)$/i.exec(linea);
    if (opcionDecimales !== null) {
      const crudo = opcionDecimales[1]!.trim();
      const n = Number(crudo);
      if (!Number.isInteger(n) || n < 0 || n > 15) {
        errores.push({
          linea: numero,
          mensaje: `"${crudo}" no sirve para 'Decimales'. Tiene que ser un entero entre 0 y 15.`,
        });
      } else {
        decimales = n;
      }
      continue;
    }

    if (casoActual === null) enunciado.push(linea);
  }

  cerrarCaso();

  if (titulo === "") {
    errores.push({ linea: 1, mensaje: "falta el título. La primera línea tiene que ser '# Título'." });
  }
  if (casos.length === 0) {
    errores.push({ linea: 1, mensaje: "el ejercicio no tiene ningún caso de prueba." });
  }

  if (errores.length > 0) return { ok: false, errores };

  return {
    ok: true,
    ejercicio: {
      titulo,
      enunciado: enunciado.join("\n").trim(),
      comparacion,
      decimales,
      casos,
    },
  };
}

// ------------------------------------------------------------------
// Comparación
// ------------------------------------------------------------------

/** Redondea todos los números del texto, para tolerar diferencias de decimales. */
function redondearNumeros(texto: string, decimales: number): string {
  return texto.replace(/-?\d+\.\d+/g, (m) => Number(m).toFixed(decimales));
}

function aLineas(texto: string, modo: ModoComparacion): string[] {
  // El salto de línea final es el *terminador* de la última línea, no una línea
  // vacía más. Todo 'Escribir' agrega uno, así que sin esto ni el modo exacto
  // podría coincidir nunca: la salida siempre tendría una línea de más.
  const sinTerminador = texto.endsWith("\n") ? texto.slice(0, -1) : texto;
  // Sin salida son cero líneas, no una línea vacía: "".split("\n") da [""].
  if (sinTerminador === "") return [];
  const lineas = sinTerminador.split("\n");

  if (modo === "exacta") return lineas;

  const recortadas = lineas.map((l) => l.trimEnd());
  while (recortadas.length > 0 && recortadas[recortadas.length - 1] === "") recortadas.pop();

  if (modo === "flexible") {
    return recortadas.map((l) => l.trim().toLowerCase().replace(/\s+/g, " "));
  }
  return recortadas;
}

export interface Comparacion {
  modo: ModoComparacion;
  coincide: boolean;
  /** Índice base 0 de la primera línea distinta, o `null` si coinciden. */
  primeraDiferencia: number | null;
  esperadoNormalizado: string[];
  obtenidoNormalizado: string[];
}

export function comparar(
  esperado: string,
  obtenido: string,
  modo: ModoComparacion,
  decimales: number | null,
): Comparacion {
  const preparar = (t: string): string =>
    decimales === null ? t : redondearNumeros(t, decimales);

  const e = aLineas(preparar(esperado), modo);
  const o = aLineas(preparar(obtenido), modo);

  if (modo === "contiene") {
    // Las líneas esperadas tienen que aparecer en orden, no necesariamente juntas.
    let k = 0;
    for (const linea of o) {
      if (k < e.length && linea.includes(e[k]!)) k++;
    }
    return {
      modo,
      coincide: k === e.length,
      primeraDiferencia: k === e.length ? null : k,
      esperadoNormalizado: e,
      obtenidoNormalizado: o,
    };
  }

  const largo = Math.max(e.length, o.length);
  for (let i = 0; i < largo; i++) {
    if (e[i] !== o[i]) {
      return {
        modo,
        coincide: false,
        primeraDiferencia: i,
        esperadoNormalizado: e,
        obtenidoNormalizado: o,
      };
    }
  }

  return {
    modo,
    coincide: true,
    primeraDiferencia: null,
    esperadoNormalizado: e,
    obtenidoNormalizado: o,
  };
}

// ------------------------------------------------------------------
// Ejecución de los casos
// ------------------------------------------------------------------

export type EstadoCaso =
  | "bien"
  /** Corrió pero la salida no es la esperada. */
  | "salida-distinta"
  /** Abortó: división por cero, índice fuera de rango, bucle infinito... */
  | "error"
  /** Pidió más valores de los que el caso provee. */
  | "sin-entrada"
  /**
   * El intérprete rechazó un valor del caso por no encajar en el tipo leído.
   *
   * Esto es un error del *ejercicio*, no de la solución: el docente puso "abc"
   * donde el programa lee un Entero. Se distingue del resto porque el mensaje
   * tiene que apuntar a quien escribió el ejercicio.
   */
  | "entrada-rechazada";

export interface ResultadoCaso {
  nombre: string;
  estado: EstadoCaso;
  esperado: string;
  obtenido: string;
  comparacion: Comparacion;
  diagnostico?: Diagnostico;
  /** Presente solo con estado "entrada-rechazada". */
  motivoRechazo?: string;
  pasos: number;
  entradasPedidas: number;
  entradasDisponibles: number;
}

export interface ResultadoEjercicio {
  titulo: string;
  casos: ResultadoCaso[];
  aprobados: number;
  total: number;
  /** `true` cuando todos los casos pasaron. */
  aprobado: boolean;
}

export interface OpcionesVerificacion {
  /** Tope de pasos por caso. Más bajo que el del intérprete: acá hay muchos casos. */
  limitePasos?: number;
}

const LIMITE_POR_CASO = 1_000_000;

/**
 * Corre un caso aislado.
 *
 * Cada caso arranca de cero: un programa no puede filtrar estado al siguiente.
 */
export function correrCaso(
  programa: Programa,
  caso: CasoDePrueba,
  ejercicio: Pick<Ejercicio, "comparacion" | "decimales">,
  opciones: OpcionesVerificacion = {},
): ResultadoCaso {
  const generador = ejecutar(programa, {
    limitePasos: opciones.limitePasos ?? LIMITE_POR_CASO,
  });

  let obtenido = "";
  let pedidas = 0;
  let rechazo: string | null = null;
  let respuesta: string | undefined;
  let paso = generador.next();

  while (!paso.done) {
    const evento = paso.value;
    if (evento.clase === "salida") {
      obtenido += evento.texto + (evento.sinSalto ? "" : "\n");
      respuesta = undefined;
    } else if (evento.clase === "entrada") {
      if (evento.reintento !== undefined) {
        // El intérprete rechazó el valor anterior. Seguir alimentando la lista
        // desalinearía todo, así que se corta acá y se reporta.
        rechazo = evento.reintento;
        break;
      }
      respuesta = caso.entrada[pedidas];
      pedidas++;
    } else {
      respuesta = undefined;
    }
    paso = generador.next(respuesta);
  }

  if (rechazo !== null) {
    generador.return({ clase: "terminado", pasos: 0 });
  }

  const resultado: Resultado = paso.done
    ? paso.value
    : { clase: "terminado", pasos: 0 };
  const comparacion = comparar(
    caso.salidaEsperada,
    obtenido,
    ejercicio.comparacion,
    ejercicio.decimales,
  );

  const base = {
    nombre: caso.nombre,
    esperado: caso.salidaEsperada,
    obtenido,
    comparacion,
    pasos: resultado.pasos,
    entradasPedidas: pedidas,
    entradasDisponibles: caso.entrada.length,
  };

  if (rechazo !== null) {
    return { ...base, estado: "entrada-rechazada", motivoRechazo: rechazo };
  }

  if (resultado.clase === "error") {
    const seAgotoLaEntrada = pedidas > caso.entrada.length;
    return {
      ...base,
      estado: seAgotoLaEntrada ? "sin-entrada" : "error",
      diagnostico: resultado.diagnostico,
    };
  }

  return { ...base, estado: comparacion.coincide ? "bien" : "salida-distinta" };
}

export function verificarSolucion(
  programa: Programa,
  ejercicio: Ejercicio,
  opciones: OpcionesVerificacion = {},
): ResultadoEjercicio {
  const casos = ejercicio.casos.map((c) => correrCaso(programa, c, ejercicio, opciones));
  const aprobados = casos.filter((c) => c.estado === "bien").length;
  return {
    titulo: ejercicio.titulo,
    casos,
    aprobados,
    total: casos.length,
    aprobado: aprobados === casos.length,
  };
}

// ------------------------------------------------------------------
// Explicación de un caso fallado
// ------------------------------------------------------------------

/**
 * Texto que se le muestra al alumno cuando un caso no pasa.
 *
 * El objetivo es que entienda *qué* difiere, no solo que falló. Un "incorrecto"
 * a secas no enseña nada.
 */
export function explicar(caso: ResultadoCaso): string {
  switch (caso.estado) {
    case "bien":
      return "Bien.";

    case "entrada-rechazada":
      return (
        `El ejercicio está mal armado: ${caso.motivoRechazo ?? "el caso da un valor que no sirve para el tipo que se lee."} ` +
        "Revisá el bloque de entrada de este caso."
      );

    case "sin-entrada":
      return (
        `Tu programa pidió ${caso.entradasPedidas} ${caso.entradasPedidas === 1 ? "valor" : "valores"} ` +
        `y este caso trae ${caso.entradasDisponibles}. ` +
        "Puede que tengas un 'Leer' de más, o que un 'Leer' esté dentro de un bucle que da más vueltas de las debidas."
      );

    case "error": {
      const d = caso.diagnostico;
      if (d === undefined) return "El programa se detuvo con un error.";
      return `El programa se detuvo en la línea ${d.linea}: ${d.mensaje}${
        d.sugerencia === undefined ? "" : ` ${d.sugerencia}`
      }`;
    }

    case "salida-distinta": {
      const { modo, primeraDiferencia, esperadoNormalizado, obtenidoNormalizado } =
        caso.comparacion;

      if (primeraDiferencia === null) return "La salida no coincide.";

      if (modo === "contiene") {
        const faltante = esperadoNormalizado[primeraDiferencia];
        const encontradas = primeraDiferencia;
        const prefijo =
          encontradas === 0
            ? "No encontré"
            : `Encontré las primeras ${encontradas} líneas esperadas, pero no`;
        return (
          `${prefijo} una línea que contenga «${faltante}» en la salida de tu programa. ` +
          "Fijate el texto y los decimales."
        );
      }

      const esperada = esperadoNormalizado[primeraDiferencia];
      const obtenida = obtenidoNormalizado[primeraDiferencia];

      if (esperada !== undefined && obtenida === undefined) {
        if (obtenidoNormalizado.length === 0) {
          return `Tu programa no escribió nada. Se esperaba «${esperada}».`;
        }
        return (
          `Falta salida. En la línea ${primeraDiferencia + 1} se esperaba «${esperada}» ` +
          "y tu programa no escribió nada más."
        );
      }
      if (esperada === undefined && obtenida !== undefined) {
        return (
          `Sobra salida. Tu programa escribió «${obtenida}» en la línea ${primeraDiferencia + 1}, ` +
          "y ahí ya no debería escribir nada."
        );
      }
      return (
        `En la línea ${primeraDiferencia + 1} se esperaba «${esperada}» ` +
        `y tu programa escribió «${obtenida}».`
      );
    }
  }
}
