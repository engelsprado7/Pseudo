#!/usr/bin/env node
/**
 * Analiza un archivo y muestra su árbol sintáctico.
 *
 *   node bin/ast.ts ejemplos/promedio.psc
 */
import { readFileSync } from "node:fs";
import { tokenizar } from "../src/lexer.ts";
import { parsear } from "../src/parser.ts";
import { verificar } from "../src/verificador.ts";
import { formatear } from "../src/diagnostico.ts";
import type { Expr, Programa, Sentencia } from "../src/ast.ts";

const ruta = process.argv[2];
if (ruta === undefined) {
  console.error("Uso: node bin/ast.ts <archivo.psc>");
  process.exit(1);
}

const fuente = readFileSync(ruta, "utf8");
const { tokens, errores: lex } = tokenizar(fuente);
const { programa, errores: sin } = parsear(tokens);
// El chequeo de tipos solo tiene sentido sobre un AST completo.
const sem = lex.length === 0 && sin.length === 0 ? verificar(programa) : [];
const errores = [...lex, ...sin, ...sem].sort(
  (a, b) => a.linea - b.linea || a.columna - b.columna,
);

function expr(e: Expr): string {
  switch (e.clase) {
    case "LiteralNumero":
      return `${e.valor}${e.esEntero ? "" : " (Real)"}`;
    case "LiteralTexto":
      return JSON.stringify(e.valor);
    case "LiteralLogico":
      return e.valor ? "Verdadero" : "Falso";
    case "Variable":
      return e.nombre;
    case "Indice":
      return `${e.base.nombre}[${e.indices.map(expr).join(", ")}]`;
    case "Unario":
      return `(${e.op} ${expr(e.operando)})`;
    case "Binario":
      return `(${expr(e.izq)} ${e.op} ${expr(e.der)})`;
    case "Llamada":
      return `${e.nombre}(${e.args.map(expr).join(", ")})`;
  }
}

function bloque(cuerpo: Sentencia[], nivel: number): void {
  for (const s of cuerpo) sentencia(s, nivel);
}

function linea(nivel: number, s: Sentencia | { linea: number }, texto: string): void {
  const marca = `\x1b[2m${String(s.linea).padStart(3)}\x1b[0m`;
  console.log(`${marca} ${"  ".repeat(nivel)}${texto}`);
}

function sentencia(s: Sentencia, nivel: number): void {
  switch (s.clase) {
    case "Definir": {
      const t =
        s.tipo.clase === "TipoSimple"
          ? s.tipo.tipo
          : `Arreglo[${s.tipo.dimensiones.map(expr).join(", ")}] De ${s.tipo.base}`;
      linea(nivel, s, `Definir ${s.nombres.map((n) => n.nombre).join(", ")} : ${t}`);
      break;
    }
    case "Asignacion":
      linea(nivel, s, `${expr(s.destino)} <- ${expr(s.valor)}`);
      break;
    case "Leer":
      linea(nivel, s, `Leer ${s.destinos.map(expr).join(", ")}`);
      break;
    case "Escribir":
      linea(
        nivel,
        s,
        `Escribir${s.sinSalto ? " (sin salto)" : ""} ${s.partes.map(expr).join(" ++ ")}`,
      );
      break;
    case "Si":
      s.ramas.forEach((r, idx) => {
        linea(nivel, { linea: r.pos.linea }, `${idx === 0 ? "Si" : "SiNo Si"} ${expr(r.condicion)}`);
        bloque(r.cuerpo, nivel + 1);
      });
      if (s.sino !== null) {
        console.log(`\x1b[2m    \x1b[0m ${"  ".repeat(nivel)}SiNo`);
        bloque(s.sino, nivel + 1);
      }
      break;
    case "Segun":
      linea(nivel, s, `Segun ${expr(s.sujeto)}`);
      for (const c of s.casos) {
        console.log(
          `\x1b[2m${String(c.pos.linea).padStart(3)}\x1b[0m ${"  ".repeat(nivel + 1)}caso ${c.valores.map(expr).join(", ")}:`,
        );
        bloque(c.cuerpo, nivel + 2);
      }
      if (s.otroModo !== null) {
        console.log(`\x1b[2m    \x1b[0m ${"  ".repeat(nivel + 1)}De Otro Modo:`);
        bloque(s.otroModo, nivel + 2);
      }
      break;
    case "Mientras":
      linea(nivel, s, `Mientras ${expr(s.condicion)}`);
      bloque(s.cuerpo, nivel + 1);
      break;
    case "Repetir":
      linea(nivel, s, "Repetir");
      bloque(s.cuerpo, nivel + 1);
      console.log(`\x1b[2m    \x1b[0m ${"  ".repeat(nivel)}Hasta Que ${expr(s.condicion)}`);
      break;
    case "Para":
      linea(
        nivel,
        s,
        `Para ${s.variable.nombre} de ${expr(s.desde)} a ${expr(s.hasta)} paso ${s.paso === null ? "1" : expr(s.paso)}`,
      );
      bloque(s.cuerpo, nivel + 1);
      break;
    case "ParaCada":
      linea(nivel, s, `Para Cada ${s.variable.nombre} en ${s.arreglo.nombre}`);
      bloque(s.cuerpo, nivel + 1);
      break;
    case "LlamarProcedimiento":
      linea(nivel, s, `llamar ${s.nombre}(${s.args.map(expr).join(", ")})`);
      break;
    case "Retornar":
      linea(nivel, s, `Retornar ${s.valor === null ? "" : expr(s.valor)}`);
      break;
  }
}

function mostrar(p: Programa): void {
  for (const sp of p.subprogramas) {
    const params = sp.parametros
      .map(
        (x) =>
          `${x.porReferencia ? "ref " : ""}${x.nombre}${
            x.tipo === null
              ? ""
              : `: ${x.tipo.clase === "TipoSimple" ? x.tipo.tipo : `Arreglo De ${x.tipo.base}`}`
          }`,
      )
      .join(", ");
    const cabecera =
      sp.clase === "Funcion"
        ? `Funcion ${sp.nombre}(${params}) -> ${sp.variableRetorno.nombre}`
        : `Procedimiento ${sp.nombre}(${params})`;
    console.log(`\n\x1b[1m${cabecera}\x1b[0m`);
    bloque(sp.cuerpo, 1);
  }

  console.log("\n\x1b[1mInicio\x1b[0m");
  bloque(p.principal, 1);
  console.log("\x1b[1mFin\x1b[0m");
}

mostrar(programa);

const graves = errores.filter((e) => e.severidad === "error");
if (errores.length > 0) {
  const etiqueta = graves.length > 0 ? "\x1b[31m" : "\x1b[33m";
  console.log(`\n${etiqueta}${errores.length} problema(s):\x1b[0m\n`);
  for (const e of errores) console.log(formatear(e) + "\n");
  if (graves.length > 0) process.exit(1);
} else {
  console.log("\n\x1b[32mSin errores.\x1b[0m");
}
