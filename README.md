# pseudo

Lenguaje de seudocódigo en español para enseñar programación. La sintaxis y la
semántica están definidas en `especificacion-lenguaje.md`.

Estado: **completo y funcionando.** 419 pruebas. El editor web ejecuta programas,
resalta sintaxis, subraya en vivo los errores de sintaxis y de tipos, formatea, y
**verifica soluciones contra ejercicios automáticamente**.

## Cómo correrlo

Hace falta **Node 22.18 o superior** y nada más. Se descarga de
[nodejs.org](https://nodejs.org) (la versión LTS sirve).

```bash
node --version    # tiene que decir v22.18 o mayor
npm install       # instala 18 paquetes, tarda unos segundos
npm run dev       # construye y abre el servidor
```

Después de `npm run dev`, abrí **http://localhost:8000** en el navegador. Con
`Ctrl+C` en la terminal se detiene.

**Hace falta el servidor:** abrir `sitio/index.html` con doble clic no funciona,
porque el editor es un módulo ES y los navegadores los bloquean sobre `file://`.

Si el puerto 8000 está ocupado: `node bin/servir.ts 3000`.

Todo funciona igual en Windows, macOS y Linux; no se usa ningún comando del
sistema, solo Node.

### Por qué el núcleo no necesita compilarse

`src/` no tiene dependencias: Node ejecuta los `.ts` directamente descartando los
tipos, y el runner de pruebas viene incluido. Por eso `node bin/correr.ts` anda
sin instalar nada. `npm install` es solo para el editor web, porque el navegador
no puede ejecutar TypeScript y hay que empaquetarlo con esbuild.

Una advertencia sobre el modo de Node: al no generar código, **no admite
propiedades declaradas en los parámetros del constructor**
(`constructor(private x: T) {}`). Hay que declarar el campo aparte. `tsc` no lo
detecta, porque es sintaxis válida de TypeScript; lo vigila
`test/compatibilidad-node.test.ts`.

## Uso

```bash
npm test                                    # 419 pruebas
npm run tipos                               # chequeo de tipos (tsc)
npm run build                               # genera sitio/
npm run dev                                 # build + servidor en :8000

npm run verificar ejercicios/ soluciones/   # verifica todo un lote
npm run verificar ejercicios/02-mayor-de-tres.md soluciones/02-mayor-de-tres.psc
npm run correr ejemplos/promedio.psc        # ejecuta un programa
npm run correr ejemplos/promedio.psc -- --paso   # traza paso a paso
npm run tokens ejemplos/area.psc            # flujo de tokens
npm run ast ejemplos/promedio.psc           # árbol sintáctico
npm run ast ejemplos/errores-sintaxis.psc   # mensajes de error
```

`npm test` construye el sitio antes de correr (gancho `pretest` de npm), porque
las pruebas de humo verifican el bundle que se despliega y no tendría sentido
comprobarlo contra uno viejo.

`npm run tipos` no es opcional: es lo que valida cada llamada a la API de
CodeMirror, que las pruebas no pueden comprobar sin un navegador. También detecta
errores reales que las pruebas no ven — encontró uno durante el desarrollo.

`tsc --noEmit` valida los tipos si tenés TypeScript instalado, pero no hace
falta para correr nada.

## Estructura

```
src/
  token.ts        Tipos de token, tabla de palabras clave
  diagnostico.ts  Errores y advertencias, compartidos por todas las etapas
  lexer.ts        Código fuente -> lista de tokens
  ast.ts          Tipos del árbol sintáctico
  parser.ts       Tokens -> AST
  tipos.ts        Representación de tipos y compatibilidad
  integradas.ts   Firmas de las funciones y constantes integradas
  verificador.ts  AST -> diagnósticos semánticos
  valores.ts      Valores en ejecución y su formato de salida
  interprete.ts   Recorre el AST y ejecuta. Generador.
  ejercicio.ts    Formato de ejercicios y verificación automática
bin/
  tokens.ts       CLI: flujo de tokens
  ast.ts          CLI: árbol sintáctico
  correr.ts       CLI: ejecuta un programa
  verificar.ts    CLI: verifica soluciones contra ejercicios
  indice.ts       Regenera ejercicios/indice.json
  limpiar.ts      Borra sitio/ antes de reconstruirlo
  sitio.ts        Copia index.html y los ejercicios a sitio/
  servir.ts       Servidor estático, sin dependencias
test/
  lexer.test.ts   43 pruebas
  parser.test.ts  67 pruebas
web/
  analisis.ts     Análisis puro (texto -> diagnósticos). Sin DOM.
  ejecucion.ts    Corre el intérprete en tandas, sin congelar la página
  ejercicios.ts   Carga los ejercicios por fetch
  archivos.ts     Abrir y guardar .psc
  formato.ts      Motor de sangría, sección 15 de la especificación
  lenguaje.ts     Resaltado y sangría para CodeMirror
  editor.ts       Interfaz del editor
  nube.ts         Cliente de Supabase, opcional y de carga diferida
  auth.ts         Sesión con Google y Microsoft
  salas.ts        Salas de clase: publicar, listar, tiempo real
  nube-ui.ts      Diálogo de la sala
  nube.json       URL y clave publishable (pública; sin ella no hay nube)
  index.html      Página
supabase/
  esquema.sql     Tablas, RLS y funciones. Se pega en el SQL Editor.
sitio/            Generado por `npm run build`. Esto es lo que se despliega.
                  No se versiona: lo reconstruye el workflow.
ejemplos/
  area.psc              Programa válido corto
  promedio.psc          Programa válido completo
  con-errores.psc       Seis errores léxicos
  errores-sintaxis.psc  Cinco errores sintácticos, cinco mensajes, sin cascada
  errores-tipos.psc     Sintaxis impecable, nueve errores de tipos
  errores-ejecucion.psc Sintaxis y tipos correctos, falla al ejecutar
ejercicios/       Cuatro ejercicios + indice.json (generado)
soluciones/       Solución de referencia de cada ejercicio
```

## Decisiones del lexer que conviene conocer

**No lanza excepciones.** `tokenizar()` devuelve `{ tokens, errores }` y sigue
avanzando tras cada problema. El editor necesita ver todos los errores de una
pasada, no solo el primero.

**Las palabras clave son insensibles a mayúsculas y acentos; los
identificadores solo a mayúsculas.** `Según` y `SEGUN` son la misma palabra
clave, pero `area` y `área` son dos variables distintas. Son dos
normalizaciones diferentes a propósito (`token.ts`, `sinAcentos`).

**El token conserva siempre el lexema original.** Se necesita para los mensajes
de error y para la advertencia de capitalización inconsistente.

**El salto de línea es un token.** Se descarta cuando la línea está vacía, solo
tiene comentario, o termina en operador binario o coma.

## Decisiones del parser que conviene conocer

**Pila de bloques abiertos.** Cada construcción que abre bloque registra su
token de apertura. Eso permite decir *qué* quedó abierto y *en qué línea*:

```
ERROR línea 6: encontré 'FinMientras' pero el bloque abierto es un 'Si' (línea 4).
  ¿Querías escribir 'FinSi'?
```

**Un cierre ajeno no se consume.** Si aparece un cierre que corresponde a un
bloque de más afuera, el parser reporta que falta el cierre del bloque interno
y deja el token intacto. Consumirlo dejaría al bloque externo sin cerrar y
duplicaría el error.

**Los encabezados de bloque se recuperan sin abortar** (`exigirBlando`). Si
falta un `Entonces` o un `Hacer`, se reporta y se sigue: así el bloque no queda
huérfano, su cierre no genera una cascada, y el cuerpo se analiza igual.

**La pila se restaura al recuperarse de un error.** Si una sentencia abre un
bloque y falla antes de cerrarlo, se descarta de la pila. Sin esto, su cierre
se le atribuiría al bloque de afuera.

**Las comparaciones no son asociativas.** `1 < x < 10` se rechaza en la
gramática, no con un chequeo aparte, y el mensaje trae la corrección concreta.

**Las palabras reservadas usadas como nombre** se detectan en `exigirNombre`,
que es el único lugar donde el parser pide un identificador. `y` y `o` son los
operadores lógicos y a la vez nombres naturalísimos para coordenadas, así que
el mensaje sugiere `coordY` / `coordX` directamente.

## Decisiones del chequeo de tipos

**Es una pasada independiente del intérprete.** El editor la usa para subrayar
errores sin ejecutar nada y sin llegar a la línea que falla. Gracias a que
declarar es obligatorio, casi todo se detecta acá.

**Solo corre si la sintaxis está bien.** Verificar un AST con agujeros produce
errores fantasma: si al alumno le falta un `Entonces`, no tiene sentido decirle
además que una variable no está declarada porque su `Definir` quedó en una rama
que no se pudo analizar.

**Hay un tipo veneno, `Indefinido`.** Es compatible con todo y nunca genera
mensajes. Por eso `a * 2 + 3 - 4` con `a` sin declarar da **un** error y no
cuatro.

**Se sugieren nombres parecidos.** Con distancia de edición: `cantidda` sugiere
`cantidad`, `Longitd` sugiere `Longitud`.

**Un literal de texto de una letra encaja en un `Caracter`.** La especificación
dice que un `Caracter` es un `Texto` de longitud 1 pero no define un literal
aparte, así que sin esta regla un `Caracter` no se podría inicializar nunca.
`c <- "a"` funciona; `c <- "ab"` falla y dice cuánto mide; `c <- unTexto` falla y
sugiere `Subcadena`, porque la longitud de una variable no se sabe hasta
ejecutar.

**La variable de un `Para` tiene que ser `Entero`.** Contar con decimales
acumula error de redondeo y el bucle puede no terminar. El mensaje lo explica y
propone un `Mientras` si de verdad hacen falta pasos decimales.

**Las advertencias no bloquean nada**: variable declarada y nunca usada, `area`
y `área` en el mismo programa, modificar la variable de control dentro de su
bucle.

## Decisiones del intérprete

**Es un generador de arriba abajo.** Hace `yield` para pedir un valor en `Leer` y,
si se le pide, en cada sentencia. Una sola decisión resuelve tres problemas:

1. **`Leer` sin bloquear.** JavaScript no puede detenerse a esperar al usuario.
   Como `Leer` puede aparecer dentro de una función llamada dentro de una
   expresión, *todo* el evaluador tiene que ser generador, no solo las
   sentencias. Hay una prueba justamente de eso: `Escribir Pedir() + Pedir()`.
2. **Ejecución paso a paso**, con instantánea de las variables, sin maquinaria
   aparte.
3. **La página no se congela**, y por lo tanto **no hace falta un web worker**.
   `web/ejecucion.ts` avanza 3000 pasos, cede el control al navegador y sigue.
   Un worker además complicaría lo que más importa: cada valor de `Leer` tendría
   que ir y venir por mensajes. Si algún día el intérprete deja de ceder por
   sentencia, hay que revisar esto.

**No hay valores por defecto, y eso incluye las celdas de un arreglo.** Leer una
celda que nunca se asignó es un error, no un 0 silencioso.

**El ruido del punto flotante no se muestra.** `0.1 + 0.2` imprime `0.3`, no
`0.30000000000000004`. Se redondea la *presentación* a 10 decimales; el valor
interno no se toca, así que las comparaciones siguen siendo las reales. Mostrar
el número completo enseña sobre IEEE 754, que es otra clase.

**Los textos se ordenan con `localeCompare` en castellano.** `"álamo" < "banco"`
da Verdadero. Comparar por código de carácter pondría todas las palabras
acentuadas al final del alfabeto.

**`Leer` acepta la coma decimal.** `3,5` y `3.5` funcionan los dos: así se
escriben los números en castellano.

**Una entrada inválida se vuelve a pedir, no aborta.** Es el único error
recuperable del lenguaje (§6.2): es culpa de quien tipea, no del programa.

**El error de bucle infinito nombra el bucle culpable**, con su línea y cuántas
veces se repitió. Con bucles anidados, señala el que más iteró.

## Ejercicios con verificación automática

Un ejercicio es un archivo Markdown. **Está en Markdown a propósito**: hay que
poder escribirlo a mano sin pelear con comillas, comas finales ni sangría
significativa, y el archivo se lee bien tal cual, sin herramientas. JSON habría
sido más fácil de parsear y bastante peor de escribir.

````markdown
# Área de un rectángulo

Leé la base y la altura y escribí el área.

Comparación: contiene

## Caso: valores enteros

```entrada
5
3
```

```salida
El área es: 15.0
```
````

Cada caso corre **aislado**: un programa no puede filtrar estado al siguiente.

### Los cuatro modos de comparación

Elegir el modo es una decisión pedagógica, no técnica, y por eso vive en el
archivo del ejercicio y no en el código.

| Modo | Qué perdona | Cuándo usarlo |
|---|---|---|
| `exacta` | Nada | El formato exacto es parte del ejercicio |
| `normalizada` | Espacios al final de línea, líneas vacías sobrantes | El predeterminado |
| `flexible` | Además mayúsculas y espacios internos | Cuando el texto importa pero no su forma |
| `contiene` | Todo lo que el alumno agregue de más | **Cuando el alumno escribe sus propios mensajes** |

El modo `contiene` resuelve un problema real: si el ejercicio espera
`El área es: 15.0` y el alumno escribe `Escribir Sin Salto "Base: "` como buena
práctica, con cualquier otro modo falla por algo que no era el ejercicio. Con
`contiene`, las líneas esperadas tienen que aparecer en orden entre las
obtenidas, y los prompts no molestan.

`Decimales: N` redondea todos los números de ambos lados antes de comparar, para
que `8.666666` y `8.67` cuenten como iguales.

### Los mensajes distinguen qué falló

No alcanza con "incorrecto". Cada caso fallado dice qué pasó:

```
✗ tres notas altas
    Tu programa pidió 5 valores y este caso trae 4. Puede que tengas un
    'Leer' de más, o que un 'Leer' esté dentro de un bucle que da más
    vueltas de las debidas.

✗ tabla del 3
    En la línea 1 se esperaba «3 x 1 = 3» y tu programa escribió «3 x 0 = 0».
```

Y hay un estado aparte, `entrada-rechazada`, para cuando **el ejercicio está mal
armado**: si un caso da `"dos"` donde el programa lee un `Entero`, el mensaje
apunta a quien escribió el ejercicio, no al alumno.

### Agregar un ejercicio

Copiar un `.md` en `ejercicios/` y correr `npm run indice` (o `npm run build`,
que lo llama). El índice se genera solo para que no se desincronice; existe
porque el navegador no puede listar un directorio.

Los ejercicios **no van dentro del bundle**: el editor los carga por `fetch`
desde `sitio/ejercicios/`. Así un docente agrega ejercicios sin instalar Node ni
recompilar. Hay una prueba que verifica que la solución de referencia de cada
ejercicio del repositorio aprueba todos sus casos.

## Lo que sigue

Nada indispensable. Ideas, en orden de valor para una clase:

1. **Tabla de seguimiento (prueba de escritorio)**: acumular cada instantánea del
   modo paso a paso en una tabla —una fila por sentencia, una columna por
   variable— para ver la historia completa de la ejecución, no solo el estado
   actual. Con un modo donde el alumno predice cada fila y la herramienta la
   corrige contra la ejecución real. Reusa las mismas instantáneas que ya
   alimentan el panel de variables.
2. **Enlaces para compartir**: codificar el programa en el hash de la URL
   (`#p=...`) para pasar una solución o un andamiaje sin servidor ni archivos —el
   enlace mismo es el contenido, no se guarda nada en ningún lado. Para
   ejercicios, o se referencia por nombre uno ya publicado, o se incrusta el
   `.md` completo (enunciado y casos) para mandar uno nuevo en un solo enlace. El
   código cargado no se ejecuta solo: espera a que el alumno le dé a Ejecutar.
3. **Varias sesiones con nombre** en el navegador, para máquinas compartidas.
4. **Comparación por caso**, no solo global. Hoy un ejercicio usa un solo modo
   para todos sus casos; si necesitás mezclar, hay que partirlo en dos archivos.
5. **Registros** (`Definir p Como Registro`) y **archivos**, de la sección 14 de
   la especificación.

## El editor web

Qué funciona hoy:

- Resaltado de sintaxis con paleta propia, tema claro y oscuro automáticos.
- **Subrayado de errores en vivo**, sin ejecutar nada: sintaxis, tipos, ámbitos,
  aridad de llamadas. Cada error trae su sugerencia; el panel lateral es
  clicable y salta a la línea.
- Sangría automática y comando **Formatear** (`Shift+Alt+F`), con el contrato
  completo de la sección 15.
- Advertencias de sangría que no rompen nada.
- El borrador se guarda en `localStorage`, así que el alumno no pierde el trabajo
  al recargar.

- **Ejecuta programas** (`Ctrl+Enter`), con panel de salida, campo de entrada
  para `Leer` y botón Detener.
- **Ejecución paso a paso** (botón «Paso a paso»): resalta la línea en curso y
  muestra un panel de variables en vivo —las simples con su valor, los arreglos
  celda por celda—, con avance manual, reproducción automática y control de
  velocidad. Reusa la instantánea que ya emite el intérprete.
- **Abre y guarda archivos** `.psc` (`Ctrl+O`, `Ctrl+S`), con arrastrar y soltar,
  marca de cambios sin guardar y aviso antes de cerrar la pestaña.
- **Verifica ejercicios** (`Ctrl+Shift+Enter`): se elige uno del desplegable, se
  lee el enunciado en el panel, y cada caso se reporta con su diferencia
  concreta.

### Abrir y guardar

Hay dos mecanismos, y cuál se usa depende del navegador:

| | Chrome / Edge en https o localhost | Firefox, Safari, o http:// en red |
|---|---|---|
| Guardar | Sobrescribe el mismo archivo, sin preguntar | Descarga una copia nueva |
| Abrir | Diálogo de archivo nativo | Diálogo de archivo nativo |

El primero usa la File System Access API, que **no existe en Firefox ni Safari**,
y **tampoco si el sitio se sirve por http:// desde otra máquina de la red**. En un
laboratorio eso último es perfectamente posible, así que el respaldo por descarga
no es un caso raro: puede ser el camino habitual. El editor dice cuál está usando
en la barra de abajo.

Además de los archivos, la sesión se guarda en `localStorage` en cada tecla. **No
reemplaza al archivo**: es una red de seguridad para que recargar la página, o un
corte de luz, no borren el trabajo. Se guarda también el contenido del último
guardado, así al volver la marca de cambios sin guardar sigue siendo correcta.

Dos limitaciones que conviene conocer antes de una clase:

- **La sesión es una sola por navegador.** Dos alumnos en la misma máquina del
  laboratorio comparten esa red de seguridad. Los archivos en disco son la
  solución real, y por eso están primero.
- **`Guardar` sobre una descarga no es lo mismo que sobrescribir.** Con el
  respaldo, cada guardado deja un archivo más en la carpeta de descargas
  (`programa.psc`, `programa (1).psc`...). Vale avisárselo a los alumnos.

### Separación entre análisis e interfaz

`web/analisis.ts` no importa nada del editor ni toca el DOM. Es deliberado:

- se puede probar de verdad, sin simular un navegador (las pruebas de humo
  importan el bundle real y lo ejercitan);
- cuando llegue el intérprete va a tener que correr en un web worker para no
  congelar la página con un bucle infinito de un alumno, y ese movimiento no va
  a requerir tocar la interfaz.

### El formateador se maneja con el lexer

`web/formato.ts` calcula la sangría a partir del flujo de tokens, no con
expresiones regulares. Eso hace que esto funcione bien:

```
Escribir "FinSi"   // es un texto, no cierra ningún bloque
// Fin             // es un comentario, tampoco
```

## Desplegar

`sitio/` es estático: HTML y JavaScript, sin servidor, sin backend, sin base de
datos. Se puede subir a cualquier hosting gratuito.

```bash
npm run build     # genera sitio/
```

**GitHub Pages.** Subí el repo, entrá en Settings → Pages, y apuntá a la rama y
carpeta donde esté `sitio/`. Alternativa más limpia, con un workflow que
construya solo:

```yaml
# .github/workflows/deploy.yml
name: deploy
on: { push: { branches: [main] } }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm test && npm run tipos && npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: sitio }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/deploy-pages@v4
```

**Netlify o Cloudflare Pages.** Comando de build `npm run build`, directorio de
publicación `sitio`. Ambos detectan Node solos.

**Sin internet, en un laboratorio.** `sitio/` son tres archivos y no pide nada
de fuera: se puede copiar a una carpeta compartida o a un pendrive y abrir el
`index.html` desde un servidor local (`python3 -m http.server`). No funciona con
`file://` porque el bundle es un módulo ES.

Peso total: unos 365 KB, la mayor parte CodeMirror. Se descarga una vez y queda
en caché.
