/**
 * Diagramas de flujo a partir del AST.
 *
 * Es una función pura de `Programa` a texto SVG: sin DOM, sin navegador y sin
 * librerías. Eso permite probarla de verdad —el SVG se puede leer y comprobar
 * en Node— y además que el mismo código sirva para la interfaz web, para
 * exportar a un archivo o para generar diagramas desde la línea de comandos.
 *
 * El diagrama se arma en dos tiempos: primero se **mide** cada figura (cuánto
 * ocupa y por dónde entra y sale el flujo) y después se **dibuja** en una
 * posición concreta. Medir antes de dibujar es lo que permite centrar un `Si`
 * sobre sus dos ramas sin saber de antemano cuál va a ser más ancha.
 *
 * Las formas siguen la convención de siempre, que es la que el alumno va a
 * encontrar en cualquier libro: óvalo para inicio y fin, rectángulo para un
 * proceso, romboide para entrada y salida, rombo para una decisión.
 */
import type {
  Designador,
  Expr,
  Programa,
  Sentencia,
  Subprograma,
} from "./ast.ts";

// ------------------------------------------------------------------
// Expresiones a texto
// ------------------------------------------------------------------

const PRECEDENCIA: Record<string, number> = {
  O: 1,
  Y: 2,
  "=": 3, "<>": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
  "+": 4, "-": 4,
  "*": 5, "/": 5, DIV: 5, MOD: 5,
  "^": 6,
};

/**
 * Devuelve la expresión como la escribiría una persona.
 *
 * Solo pone paréntesis donde hacen falta: `a + b * c` se lee mejor que
 * `(a + (b * c))`, y en un diagrama el espacio es escaso.
 */
export function expresionATexto(e: Expr, precedenciaPadre = 0): string {
  switch (e.clase) {
    case "LiteralNumero":
      return String(e.valor);
    case "LiteralTexto":
      return `"${e.valor}"`;
    case "LiteralLogico":
      return e.valor ? "Verdadero" : "Falso";
    case "Variable":
      return e.lexema;
    case "Indice":
      return `${e.base.lexema}[${e.indices.map((i) => expresionATexto(i)).join(", ")}]`;
    case "Unario":
      return e.op === "No"
        ? `No ${expresionATexto(e.operando, 7)}`
        : `${e.op}${expresionATexto(e.operando, 7)}`;
    case "Llamada":
      return `${e.lexema}(${e.args.map((a) => expresionATexto(a)).join(", ")})`;
    case "Binario": {
      const propia = PRECEDENCIA[e.op] ?? 0;
      const texto = `${expresionATexto(e.izq, propia)} ${e.op} ${expresionATexto(e.der, propia + 1)}`;
      return propia < precedenciaPadre ? `(${texto})` : texto;
    }
  }
}

function designadorATexto(d: Designador): string {
  return d.clase === "Variable"
    ? d.lexema
    : `${d.base.lexema}[${d.indices.map((i) => expresionATexto(i)).join(", ")}]`;
}

// ------------------------------------------------------------------
// Medidas
// ------------------------------------------------------------------

const ALTO_NODO = 46;
const ALTO_ROMBO = 62;
const ANCHO_MINIMO = 130;
const ANCHO_CARACTER = 7.1;
const RELLENO_H = 30;
const SALTO = 30;
/** Separación entre las dos ramas de un `Si`. */
const SEPARACION_RAMAS = 34;
/** Cuánto sobresale el retorno de un bucle por el costado. */
const MARGEN_BUCLE = 34;
const MAXIMO_CARACTERES = 42;

function recortar(t: string): string {
  const limpio = t.replace(/\s+/g, " ").trim();
  return limpio.length <= MAXIMO_CARACTERES
    ? limpio
    : limpio.slice(0, MAXIMO_CARACTERES - 1) + "…";
}

function anchoDe(texto: string): number {
  return Math.max(ANCHO_MINIMO, Math.round(texto.length * ANCHO_CARACTER + RELLENO_H * 2));
}

type Forma = "ovalo" | "proceso" | "es" | "decision" | "subproceso";

/**
 * Una figura ya medida.
 *
 * `entrada` y `salida` son las coordenadas X —relativas a la caja— por donde
 * el flujo entra desde arriba y sale hacia abajo. No siempre coinciden con el
 * centro: un bucle, por ejemplo, sale corrido para dejarle lugar a la flecha
 * de retorno.
 */
interface Figura {
  ancho: number;
  alto: number;
  entrada: number;
  salida: number;
  dibujar(x: number, y: number): string;
}

// ------------------------------------------------------------------
// Dibujo de las formas
// ------------------------------------------------------------------

function escapar(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function etiqueta(x: number, y: number, texto: string, clase = "txt"): string {
  return `<text class="${clase}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${escapar(texto)}</text>`;
}

function figuraSimple(texto: string, forma: Forma): Figura {
  const t = recortar(texto);
  const ancho = anchoDe(t);
  const alto = forma === "decision" ? ALTO_ROMBO : ALTO_NODO;

  return {
    ancho,
    alto,
    entrada: ancho / 2,
    salida: ancho / 2,
    dibujar(x, y) {
      const cx = x + ancho / 2;
      const cy = y + alto / 2;
      let cuerpo: string;

      switch (forma) {
        case "ovalo":
          cuerpo = `<rect class="f-ovalo" x="${x}" y="${y}" width="${ancho}" height="${alto}" rx="${alto / 2}"/>`;
          break;
        case "es": {
          // Romboide: la inclinación es lo que distingue entrada/salida de un
          // proceso a simple vista.
          const s = 14;
          cuerpo = `<polygon class="f-es" points="${x + s},${y} ${x + ancho},${y} ${x + ancho - s},${y + alto} ${x},${y + alto}"/>`;
          break;
        }
        case "decision":
          cuerpo = `<polygon class="f-decision" points="${cx},${y} ${x + ancho},${cy} ${cx},${y + alto} ${x},${cy}"/>`;
          break;
        case "subproceso":
          cuerpo =
            `<rect class="f-proceso" x="${x}" y="${y}" width="${ancho}" height="${alto}"/>` +
            `<line class="f-borde" x1="${x + 9}" y1="${y}" x2="${x + 9}" y2="${y + alto}"/>` +
            `<line class="f-borde" x1="${x + ancho - 9}" y1="${y}" x2="${x + ancho - 9}" y2="${y + alto}"/>`;
          break;
        default:
          cuerpo = `<rect class="f-proceso" x="${x}" y="${y}" width="${ancho}" height="${alto}" rx="3"/>`;
      }

      return cuerpo + etiqueta(cx, cy, t);
    },
  };
}

/** Línea vertical con punta de flecha al final. */
function flechaAbajo(x: number, desde: number, hasta: number): string {
  return hasta <= desde ? "" : `<line class="fl" x1="${x}" y1="${desde}" x2="${x}" y2="${hasta}" marker-end="url(#punta)"/>`;
}

function linea(x1: number, y1: number, x2: number, y2: number, conPunta = false): string {
  return `<line class="fl" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${conPunta ? ' marker-end="url(#punta)"' : ""}/>`;
}

// ------------------------------------------------------------------
// Composición
// ------------------------------------------------------------------

/** Apila figuras en vertical, alineadas por sus puntos de entrada y salida. */
function enSecuencia(figuras: Figura[]): Figura {
  if (figuras.length === 0) {
    // Un bloque vacío sigue teniendo que conducir el flujo de arriba abajo.
    return { ancho: 0, alto: SALTO, entrada: 0, salida: 0, dibujar: () => "" };
  }
  if (figuras.length === 1) return figuras[0]!;

  // Todas se alinean sobre un mismo eje: el de la que más lugar necesita a la
  // izquierda de su punto de entrada.
  const ejeIzq = Math.max(...figuras.map((f) => f.entrada));
  const ejeDer = Math.max(...figuras.map((f) => f.ancho - f.entrada));
  const ancho = ejeIzq + ejeDer;
  const alto = figuras.reduce((s, f) => s + f.alto, 0) + SALTO * (figuras.length - 1);

  return {
    ancho,
    alto,
    entrada: ejeIzq,
    salida: ejeIzq,
    dibujar(x, y) {
      let partes = "";
      let cursor = y;
      for (const [i, f] of figuras.entries()) {
        const fx = x + ejeIzq - f.entrada;
        partes += f.dibujar(fx, cursor);
        const salidaX = fx + f.salida;
        cursor += f.alto;
        if (i < figuras.length - 1) {
          const siguiente = figuras[i + 1]!;
          const entradaX = x + ejeIzq - siguiente.entrada + siguiente.entrada;
          partes +=
            salidaX === entradaX
              ? flechaAbajo(salidaX, cursor, cursor + SALTO)
              : // Codo cuando la salida no cae sobre la entrada siguiente.
                linea(salidaX, cursor, salidaX, cursor + SALTO / 2) +
                linea(salidaX, cursor + SALTO / 2, entradaX, cursor + SALTO / 2) +
                flechaAbajo(entradaX, cursor + SALTO / 2, cursor + SALTO);
          cursor += SALTO;
        }
      }
      return partes;
    },
  };
}

function figuraSi(s: Extract<Sentencia, { clase: "Si" }>): Figura {
  // 'SiNo Si' se dibuja como un Si anidado dentro del SiNo: es exactamente lo
  // que significa, y evita inventar una forma nueva para la cadena.
  const [primera, ...resto] = s.ramas;
  const rombo = figuraSimple(`¿${expresionATexto(primera!.condicion)}?`, "decision");

  const siRama = enSecuencia(primera!.cuerpo.map(figuraDeSentencia));
  const noRama =
    resto.length > 0
      ? figuraSi({ ...s, ramas: resto })
      : enSecuencia((s.sino ?? []).map(figuraDeSentencia));

  const altoRamas = Math.max(siRama.alto, noRama.alto);
  const anchoRamas = siRama.ancho + SEPARACION_RAMAS + noRama.ancho;

  // El rombo se centra sobre el punto medio entre las salidas de las ramas.
  const ejeSi = siRama.entrada;
  const ejeNo = siRama.ancho + SEPARACION_RAMAS + noRama.entrada;
  const centro = (ejeSi + ejeNo) / 2;

  const izquierdaNecesaria = Math.max(0, rombo.ancho / 2 - centro);
  const ancho = Math.max(anchoRamas + izquierdaNecesaria, centro + rombo.ancho / 2);
  const alto = rombo.alto + SALTO + altoRamas + SALTO;

  return {
    ancho,
    alto,
    entrada: centro + izquierdaNecesaria,
    salida: centro + izquierdaNecesaria,
    dibujar(x, y) {
      const base = x + izquierdaNecesaria;
      const cx = base + centro;
      let partes = rombo.dibujar(cx - rombo.ancho / 2, y);

      const yRamas = y + rombo.alto + SALTO;
      const yMerge = yRamas + altoRamas + SALTO;

      // Del rombo salen dos brazos horizontales, uno por rama.
      const yLado = y + rombo.alto / 2;
      partes += linea(cx - rombo.ancho / 2, yLado, base + ejeSi, yLado);
      partes += flechaAbajo(base + ejeSi, yLado, yRamas);
      partes += etiqueta(base + ejeSi + 12, yLado - 10, "Sí", "txt-rama");

      partes += linea(cx + rombo.ancho / 2, yLado, base + ejeNo, yLado);
      partes += flechaAbajo(base + ejeNo, yLado, yRamas);
      partes += etiqueta(base + ejeNo - 12, yLado - 10, "No", "txt-rama");

      partes += siRama.dibujar(base + ejeSi - siRama.entrada, yRamas);
      partes += noRama.dibujar(base + ejeNo - noRama.entrada, yRamas);

      // Y vuelven a juntarse abajo.
      const salidaSi = base + ejeSi - siRama.entrada + siRama.salida;
      const salidaNo = base + ejeNo - noRama.entrada + noRama.salida;
      partes += linea(salidaSi, yRamas + siRama.alto, salidaSi, yMerge);
      partes += linea(salidaNo, yRamas + noRama.alto, salidaNo, yMerge);
      partes += linea(salidaSi, yMerge, salidaNo, yMerge);

      return partes;
    },
  };
}

function figuraBucle(condicion: string, cuerpo: Sentencia[], alFinal: boolean): Figura {
  const rombo = figuraSimple(`¿${condicion}?`, "decision");
  const interior = enSecuencia(cuerpo.map(figuraDeSentencia));

  const eje = Math.max(rombo.ancho / 2, interior.entrada);
  const ancho = MARGEN_BUCLE + Math.max(eje + rombo.ancho / 2, eje + (interior.ancho - interior.entrada));
  const alto = rombo.alto + SALTO + interior.alto + SALTO;

  return {
    ancho,
    alto,
    entrada: MARGEN_BUCLE + eje,
    salida: MARGEN_BUCLE + eje,
    dibujar(x, y) {
      const cx = x + MARGEN_BUCLE + eje;
      // 'Repetir' evalúa al final: el cuerpo va arriba y el rombo abajo.
      const yRombo = alFinal ? y + interior.alto + SALTO : y;
      const yCuerpo = alFinal ? y : y + rombo.alto + SALTO;

      let partes = rombo.dibujar(cx - rombo.ancho / 2, yRombo);
      partes += interior.dibujar(cx - interior.entrada, yCuerpo);

      if (alFinal) {
        partes += flechaAbajo(cx, yCuerpo + interior.alto, yRombo);
        // El retorno sube por el costado hasta la entrada del cuerpo.
        const xLado = x + MARGEN_BUCLE / 2;
        partes += linea(cx - rombo.ancho / 2, yRombo + rombo.alto / 2, xLado, yRombo + rombo.alto / 2);
        partes += linea(xLado, yRombo + rombo.alto / 2, xLado, yCuerpo - SALTO / 2);
        partes += linea(xLado, yCuerpo - SALTO / 2, cx, yCuerpo - SALTO / 2);
        partes += flechaAbajo(cx, yCuerpo - SALTO / 2, yCuerpo);
        partes += etiqueta(xLado + 14, yRombo + rombo.alto / 2 - 10, "No", "txt-rama");
      } else {
        partes += flechaAbajo(cx, yRombo + rombo.alto, yCuerpo);
        partes += etiqueta(cx + 14, yCuerpo - SALTO / 2, "Sí", "txt-rama");
        // El cuerpo vuelve al rombo por la izquierda.
        const xLado = x + MARGEN_BUCLE / 2;
        const yAbajo = yCuerpo + interior.alto + SALTO / 2;
        partes += linea(cx, yCuerpo + interior.alto, cx, yAbajo);
        partes += linea(cx, yAbajo, xLado, yAbajo);
        partes += linea(xLado, yAbajo, xLado, yRombo + rombo.alto / 2);
        partes += linea(xLado, yRombo + rombo.alto / 2, cx - rombo.ancho / 2, yRombo + rombo.alto / 2, true);
      }
      return partes;
    },
  };
}

function figuraDeSentencia(s: Sentencia): Figura {
  switch (s.clase) {
    case "Definir":
      return figuraSimple(
        `${s.nombres.map((n) => n.lexema).join(", ")}: ${s.tipo.clase === "TipoSimple" ? s.tipo.tipo : `Arreglo de ${s.tipo.base}`}`,
        "proceso",
      );
    case "Asignacion":
      return figuraSimple(`${designadorATexto(s.destino)} ← ${expresionATexto(s.valor)}`, "proceso");
    case "Leer":
      return figuraSimple(`Leer ${s.destinos.map(designadorATexto).join(", ")}`, "es");
    case "Escribir":
      return figuraSimple(`Escribir ${s.partes.map((p) => expresionATexto(p)).join(", ")}`, "es");
    case "Si":
      return figuraSi(s);
    case "Mientras":
      return figuraBucle(expresionATexto(s.condicion), s.cuerpo, false);
    case "Repetir":
      return figuraBucle(expresionATexto(s.condicion), s.cuerpo, true);
    case "Para": {
      const paso = s.paso === null ? "" : ` paso ${expresionATexto(s.paso)}`;
      return figuraBucle(
        `${s.variable.lexema} de ${expresionATexto(s.desde)} a ${expresionATexto(s.hasta)}${paso}`,
        s.cuerpo,
        false,
      );
    }
    case "ParaCada":
      return figuraBucle(`${s.variable.lexema} en ${s.arreglo.lexema}`, s.cuerpo, false);
    case "Segun": {
      // Un 'Segun' es una cadena de decisiones sobre el mismo sujeto: se dibuja
      // como tal para no inventar una forma que el alumno no vio en clase.
      const sujeto = expresionATexto(s.sujeto);
      const armar = (i: number): Figura => {
        const caso = s.casos[i];
        if (caso === undefined) return enSecuencia((s.otroModo ?? []).map(figuraDeSentencia));
        const valores = caso.valores.map((v) => expresionATexto(v)).join(" o ");
        return figuraSi({
          clase: "Si",
          linea: s.linea,
          columna: s.columna,
          ramas: [
            {
              condicion: { clase: "LiteralTexto", valor: `${sujeto} = ${valores}`, linea: s.linea, columna: s.columna },
              cuerpo: caso.cuerpo,
            },
          ],
          sino: null,
        } as Extract<Sentencia, { clase: "Si" }>) as Figura;
      };
      // Encadenar a mano para que cada caso caiga en el 'SiNo' del anterior.
      const cadena: Figura[] = [];
      for (let i = 0; i < s.casos.length; i++) cadena.push(armar(i));
      const resto = enSecuencia((s.otroModo ?? []).map(figuraDeSentencia));
      return enSecuencia(s.casos.length === 0 ? [resto] : [...cadena, resto]);
    }
    case "LlamarProcedimiento":
      return figuraSimple(`${s.lexema}(${s.args.map((a) => expresionATexto(a)).join(", ")})`, "subproceso");
    case "Retornar":
      return figuraSimple(s.valor === null ? "Retornar" : `Retornar ${expresionATexto(s.valor)}`, "ovalo");
  }
}

// ------------------------------------------------------------------
// Documento
// ------------------------------------------------------------------

const ESTILOS = `
  .f-proceso, .f-ovalo { fill: var(--dg-relleno); stroke: var(--dg-borde); stroke-width: 1.5; }
  .f-es { fill: var(--dg-es); stroke: var(--dg-borde); stroke-width: 1.5; }
  .f-decision { fill: var(--dg-decision); stroke: var(--dg-borde); stroke-width: 1.5; }
  .f-borde { stroke: var(--dg-borde); stroke-width: 1.5; }
  .fl { stroke: var(--dg-linea); stroke-width: 1.5; fill: none; }
  .txt { font-family: var(--dg-fuente); font-size: 12.5px; fill: var(--dg-texto); }
  .txt-rama { font-family: var(--dg-fuente); font-size: 11px; fill: var(--dg-tenue); }
  .titulo { font-family: var(--dg-fuente); font-size: 13px; font-weight: 600; fill: var(--dg-texto); }
`;

/** Un diagrama y su título, para poder mostrarlos por separado. */
export interface Diagrama {
  titulo: string;
  svg: string;
}

const MARGEN = 22;

function documento(figura: Figura, titulo: string): string {
  const ancho = Math.ceil(figura.ancho + MARGEN * 2);
  const alto = Math.ceil(figura.alto + MARGEN * 2 + 26);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}">` +
    `<defs><marker id="punta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--dg-linea)"/></marker></defs>` +
    `<style>${ESTILOS}</style>` +
    etiqueta(ancho / 2, MARGEN, titulo, "titulo") +
    `<g transform="translate(0 ${MARGEN + 26})">${figura.dibujar(MARGEN, 0)}</g>` +
    `</svg>`
  );
}

function diagramaDeBloque(cuerpo: Sentencia[], titulo: string, inicio: string, fin: string): Diagrama {
  const figura = enSecuencia([
    figuraSimple(inicio, "ovalo"),
    ...cuerpo.map(figuraDeSentencia),
    figuraSimple(fin, "ovalo"),
  ]);
  return { titulo, svg: documento(figura, titulo) };
}

function tituloDeSubprograma(s: Subprograma): string {
  const params = s.parametros.map((p) => (p.porReferencia ? `ref ${p.lexema}` : p.lexema)).join(", ");
  return `${s.lexema}(${params})`;
}

/**
 * Un diagrama por bloque: el programa principal y cada subprograma.
 *
 * Van separados porque así se enseña y así se lee: meter una función dentro
 * del diagrama que la llama haría un dibujo enorme e ilegible. En el principal,
 * la llamada aparece como un solo rectángulo de subproceso.
 */
export function diagramasDe(programa: Programa): Diagrama[] {
  const diagramas: Diagrama[] = [
    diagramaDeBloque(programa.principal, "Programa principal", "Inicio", "Fin"),
  ];
  for (const sub of programa.subprogramas) {
    diagramas.push(
      diagramaDeBloque(
        sub.cuerpo,
        tituloDeSubprograma(sub),
        sub.lexema,
        sub.clase === "Funcion" ? `Retornar ${sub.variableRetorno.lexema}` : "Fin",
      ),
    );
  }
  return diagramas;
}
