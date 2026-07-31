/**
 * Análisis puro: texto -> diagnósticos.
 *
 * Sin DOM, sin CodeMirror, sin nada de Node. Es la frontera del proyecto hacia
 * el navegador, y está separada de `editor.ts` a propósito:
 *
 *   - se puede probar sin montar un editor ni simular un navegador;
 *   - más adelante puede moverse a un web worker sin tocar la interfaz, que es
 *     lo que hará falta cuando el intérprete tenga que correr sin congelar la
 *     página.
 */
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { verificar } from "../src/verificador.ts";
import type { Diagnostico } from "../src/diagnostico.ts";
import type { Programa } from "../src/ast.ts";
import { diagnosticosDeSangria } from "./formato.ts";

export { formatear, calcularNiveles, ANCHO_SANGRIA } from "./formato.ts";
export type { Diagnostico } from "../src/diagnostico.ts";
export type { Programa } from "../src/ast.ts";

/**
 * Todos los diagnósticos del programa, ordenados por posición.
 *
 * El chequeo semántico corre **siempre**, incluso con la sintaxis rota. Antes se
 * apagaba del todo, y el resultado era peor de lo que parece: un solo 'Salto'
 * mal escrito en la línea 4 escondía tres variables mal tipeadas más abajo. El
 * alumno corregía una cosa, aparecían tres nuevas, corregía otra, aparecían
 * más. Aprendía que el editor le miente sobre cuánto le falta.
 *
 * Lo que sí se descarta con la sintaxis rota son las *advertencias* semánticas.
 * La de 'declaraste X pero nunca la usas' necesita ver el programa entero para
 * ser cierta, y con sentencias que el parser no pudo leer da falsos positivos:
 * la variable sí se usaba, justo en la línea que no se entendió. Los errores, en
 * cambio, se sostienen solos: un nombre que no está declarado no lo está.
 */
export function analizar(fuente: string): Diagnostico[] {
  const { tokens, errores: lexicos } = tokenizar(fuente);
  const { programa, errores: sintacticos } = parsear(tokens);

  const arbolCompleto = lexicos.length === 0 && sintacticos.length === 0;

  // Un error de sintaxis dentro de un 'Definir' se lleva puesta la declaración
  // entera, y entonces el verificador cree que ninguna de esas variables existe:
  // 'Definir x, y Como Real' con 'y' reservada haría aparecer "'x' no está
  // declarada" en cada línea que la use. Cuando pasa eso, las quejas por nombres
  // no declarados dejan de valer; el resto de los errores sigue en pie.
  const lineas = fuente.split("\n");
  const declaracionRota = [...lexicos, ...sintacticos].some((d) =>
    /^\s*Definir\b/i.test(lineas[d.linea - 1] ?? ""),
  );

  const semanticos = verificar(programa).filter((d) => {
    if (arbolCompleto) return true;
    // Las advertencias ('declaraste X y nunca la usás') necesitan ver el
    // programa entero para ser ciertas; con sentencias perdidas, mienten.
    if (d.severidad !== "error") return false;
    return !(declaracionRota && /no está declarada/.test(d.mensaje));
  });

  return [
    ...lexicos,
    ...sintacticos,
    ...semanticos,
    ...diagnosticosDeSangria(fuente),
  ].sort((a, b) => a.linea - b.linea || a.columna - b.columna);
}

/**
 * Compila para ejecutar: devuelve el AST solo si el programa está impecable.
 *
 * Las advertencias no bloquean (sangría, variables sin usar): son avisos, no
 * errores, y frenar por ellas contradiría la sección 15.3.
 */
export function compilar(
  fuente: string,
): { ok: true; programa: Programa } | { ok: false; diagnosticos: Diagnostico[] } {
  const diagnosticos = analizar(fuente);
  const graves = diagnosticos.filter((d) => d.severidad === "error");
  if (graves.length > 0) return { ok: false, diagnosticos: graves };

  const { tokens } = tokenizar(fuente);
  const { programa } = parsear(tokens);
  return { ok: true, programa };
}

export interface Resumen {
  errores: number;
  advertencias: number;
  /** `true` cuando el programa está sintácticamente bien formado. */
  valido: boolean;
}

export function resumir(diagnosticos: Diagnostico[]): Resumen {
  const errores = diagnosticos.filter((d) => d.severidad === "error").length;
  return {
    errores,
    advertencias: diagnosticos.length - errores,
    valido: errores === 0,
  };
}
