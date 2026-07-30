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
 * El chequeo de tipos solo corre si la sintaxis está bien. Verificar un AST
 * lleno de agujeros produce errores fantasma: si al alumno le falta un
 * 'Entonces', no tiene sentido decirle además que una variable no está
 * declarada porque su 'Definir' quedó en una rama que no se pudo analizar.
 */
export function analizar(fuente: string): Diagnostico[] {
  const { tokens, errores: lexicos } = tokenizar(fuente);
  const { programa, errores: sintacticos } = parsear(tokens);

  const semanticos =
    lexicos.length === 0 && sintacticos.length === 0 ? verificar(programa) : [];

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
