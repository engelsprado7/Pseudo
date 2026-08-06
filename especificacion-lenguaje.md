# Especificación del lenguaje

Versión 0.2 — decisiones cerradas

Este documento define la sintaxis y la semántica del lenguaje de seudocódigo. Está escrito para ser la fuente de verdad del lexer, el parser y el intérprete: si algo no está aquí, no está decidido.

Las nueve decisiones abiertas de la versión 0.1 quedaron resueltas. Donde la elección tiene consecuencias que se propagan al resto del lenguaje, se dejó anotada con **[RESUELTO]** para que el motivo no se pierda.

---

## 1. Principios de diseño

1. **Los errores enseñan.** Cada mensaje de error dice qué pasó, en qué línea, y cuando es posible, qué se esperaba. Nunca "syntax error".
2. **La indentación no significa nada para el parser, pero el editor la mantiene.** Los bloques se cierran con palabras clave explícitas (`FinSi`, `FinMientras`), así que un alumno no puede romper su programa por un espacio de más. A cambio, el editor es responsable de que la sangría siempre sea correcta — ver sección 15.
3. **Una sentencia por línea.** El salto de línea termina la sentencia. No hay punto y coma.
4. **Nada de trampas heredadas.** `/` siempre da división real. No hay conversión implícita entre texto y número. No se puede escribir `a < b < c`.
5. **Todo en español, sin tildes obligatorias.** Las palabras clave se aceptan con o sin acento, en cualquier combinación de mayúsculas.

---

## 2. Reglas léxicas

### 2.1 Palabras clave

Insensibles a mayúsculas y a acentos. `Según`, `SEGUN`, `segun` y `Segun` son la misma palabra clave.

```
Inicio        Fin           Definir       Como
Entero        Real          Texto         Caracter      Logico
Arreglo       De
Leer          Escribir      Sin           Salto
Si            Entonces      SiNo          FinSi
Segun         Hacer         Otro          Modo          FinSegun
Mientras      FinMientras
Repetir       Hasta         Que
Para          Con           Paso          FinPara
Funcion       FinFuncion    Procedimiento FinProcedimiento
Retornar      Por           Referencia    Valor
Verdadero     Falso
Y             O             No
DIV           MOD
```

**[DECISIÓN]** `DIV` y `MOD` son palabras clave, no símbolos. La alternativa (`%` y `//`) es más corta pero menos legible para quien recién empieza, y `//` chocaría con los comentarios.

### 2.2 Identificadores

```ebnf
identificador = letra , { letra | digito | "_" } ;
letra         = "a".."z" | "A".."Z" | "á" | "é" | "í" | "ó" | "ú"
              | "Á" | "É" | "Í" | "Ó" | "Ú" | "ñ" | "Ñ" | "ü" | "Ü" ;
digito        = "0".."9" ;
```

Los identificadores son **insensibles a mayúsculas**: `base`, `Base` y `BASE` son la misma variable.

**[DECISIÓN]** Insensible a mayúsculas evita que un alumno pierda veinte minutos porque escribió `Base` en un lugar y `base` en otro. El costo es que cuando pase a Java o Python, esa protección desaparece. Recomiendo mantenerla insensible, pero que el intérprete emita una **advertencia** (no error) cuando detecte que la misma variable se escribió con distinta capitalización, para que el alumno vaya adquiriendo el hábito.

Los acentos y la `ñ` **sí** se permiten en identificadores (`área`, `año`, `número`). Son válidos y distintos entre sí: `area` y `área` son dos variables diferentes. Esto es un riesgo real de confusión, así que el intérprete debe advertir si existen ambas en el mismo programa.

### 2.3 Literales

```ebnf
numero  = digito+ , [ "." , digito+ ] , [ ( "e" | "E" ) , [ "+" | "-" ] , digito+ ] ;
texto   = '"' , { caracter - '"' } , '"' ;
logico  = "Verdadero" | "Falso" ;
```

No hay literales de carácter separados; un `Caracter` es un `Texto` de longitud 1.

Dentro de un texto se reconocen las secuencias de escape `\"`, `\\` y `\n`.

### 2.4 Comentarios

```ebnf
comentario       = comentario_linea | comentario_bloque ;
comentario_linea = "//" , { caracter - fin_de_linea } ;
comentario_bloque = "/*" , { caracter } , "*/" ;
```

Los de bloque no anidan: el primer `*/` cierra. Si anidaran, comentar un fragmento que ya tuviera un comentario adentro funcionaría a veces sí y a veces no según dónde cayera el cierre, que es peor que no poder anidar. Un bloque sin cerrar es error, y se señala dónde **empezó**: es el dato que sirve para encontrarlo.

### 2.5 Espacios y saltos de línea

Los espacios y tabulaciones entre tokens se descartan. El **salto de línea es un token significativo**: termina la sentencia actual.

Una línea vacía o que solo contiene un comentario no produce token de fin de sentencia; se ignora por completo.

Para partir una expresión larga en varias líneas, se permite que la línea termine con un operador binario o con una coma; en ese caso el salto de línea se descarta y la expresión continúa.

```
total <- precio * cantidad +
         impuesto
```

---

## 3. Estructura del programa

```ebnf
programa     = { subprograma } , "Inicio" , bloque , "Fin" , { subprograma } ;
bloque       = { sentencia } ;
```

Los subprogramas pueden ir antes o después del bloque principal, o repartidos entre ambos lados. Todos son visibles desde todas partes.

```ebnf
sentencia    = declaracion
             | asignacion
             | leer
             | escribir
             | si
             | segun
             | mientras
             | repetir
             | para
             | llamada_procedimiento
             | retornar ;
```

---

## 4. Declaraciones y tipos

```ebnf
declaracion  = "Definir" , identificador , { "," , identificador } , "Como" , tipo ;
tipo         = tipo_simple
             | "Arreglo" , "[" , expresion , { "," , expresion } , "]" , "De" , tipo_simple ;
tipo_simple  = "Entero" | "Real" | "Texto" | "Caracter" | "Logico" ;
```

Ejemplos:

```
Definir base, altura Como Real
Definir nombre Como Texto
Definir notas Como Arreglo[30] De Real
Definir tablero Como Arreglo[3, 3] De Entero
```

### 4.1 La declaración es obligatoria

Toda variable debe declararse con `Definir` antes de usarse. No hay inferencia de tipos ni variables implícitas.

```
Definir base Como Real
base <- 5          // correcto
base <- "hola"     // ERROR línea 3: 'base' es Real y no puede recibir un Texto

altura <- 10       // ERROR línea 4: 'altura' no está declarada. Agrega
                   //   'Definir altura Como Real' antes de usarla.
```

Una variable solo puede declararse una vez por ámbito. Redeclararla es error:

```
Definir x Como Entero
Definir x Como Real   // ERROR línea 2: 'x' ya fue declarada como Entero en la línea 1
```

**[RESUELTO]** Toda variable declarada tiene tipo conocido desde antes de ejecutar. Esto se propaga a tres lugares del intérprete y conviene tenerlo presente al implementarlo:

1. **`Leer` nunca adivina.** Sabe exactamente cómo convertir la entrada porque conoce el tipo de destino. Sin declaraciones obligatorias, el tipo de una variable acabaría dependiendo de lo que teclee el usuario en tiempo de ejecución.
2. **Los errores de tipo se detectan antes de ejecutar.** `base * nombre` es error de compilación, no de ejecución: el alumno lo ve subrayado en el editor mientras escribe, sin necesidad de correr el programa ni de llegar a esa línea. Esto es la mitad del valor de haber elegido declaración obligatoria.
3. **El autocompletado funciona de verdad.** El editor puede ofrecer solo las variables en ámbito, con su tipo.

El costo es ceremonia: todo ejercicio, incluso el de tres líneas, arranca con un bloque de `Definir`. Es un costo real y visible el primer día de clase, y el pago llega en el punto 2.

### 4.2 Tipos y conversiones

**Cómo se escribe un `Caracter`.** No hay literal de carácter aparte, así que se
usa un literal de texto de exactamente una letra:

```
Definir inicial Como Caracter
inicial <- "A"        // correcto
inicial <- "AB"       // ERROR: un Caracter guarda una sola letra, y "AB" tiene 2
inicial <- nombre     // ERROR: la longitud de una variable no se sabe hasta
                      //   ejecutar. Usa Subcadena(nombre, 0, 0).
```

**[RESUELTO]** Es una excepción deliberada y *estática* a la tabla de abajo: el
literal se mide al compilar. Sin ella, un `Caracter` no se podría inicializar
nunca, porque toda forma de escribir una letra es un `Texto`.

| De → A | Automático |
|---|---|
| Entero → Real | Sí |
| Real → Entero | No. Usar `Trunc` o `Redondear` |
| Número → Texto | No. Usar `ConvertirATexto` |
| Texto → Número | No. Usar `ConvertirANumero` |
| Logico ↔ cualquiera | No |

`Entero` y `Real` son compatibles en cualquier operación aritmética; el resultado es `Real` si algún operando lo es.

No hay valor nulo. Una variable declarada pero nunca asignada **no** tiene valor por defecto: leerla es un error.

```
Definir x Como Entero
Escribir x        // ERROR línea 2: 'x' fue declarada pero todavía no tiene valor
```

**[RESUELTO]** Inicializar en 0 silenciosamente esconde el bug más común del principiante. El intérprete lo señala.

Consecuencia de implementación: cada variable necesita, además de su tipo, una bandera de *asignada*. No alcanza con guardar un valor centinela, porque `0` y `""` son valores legítimos que el alumno puede haber asignado a propósito.

### 4.3 Arreglos

Los índices empiezan en **0**. Un arreglo declarado con tamaño `n` tiene índices válidos de `0` a `n - 1`.

```
Definir notas Como Arreglo[5] De Real
notas[0] <- 8.5      // primer elemento
notas[4] <- 9.0      // último elemento
notas[5] <- 7.0      // ERROR: el índice 5 está fuera del rango 0..4 de 'notas'
notas[-1] <- 7.0     // ERROR: el índice -1 está fuera del rango 0..4 de 'notas'
```

**[RESUELTO]** Base 0 evita que el alumno tenga que reaprender el indexado al pasar a C, Java, Python o JavaScript. El costo aparece en los recorridos, porque `Hasta` es **inclusivo**: todo bucle sobre un arreglo termina en `- 1`.

```
Para i <- 0 Hasta cantidad - 1 Hacer
    Escribir notas[i]
FinPara
```

Ese `- 1` es la fuente principal de errores por desfase de uno en este lenguaje, y es exactamente el patrón que el alumno va a copiar sin entender. Ver sección 8.3 para la construcción que lo evita en el caso común.

El tamaño en `Definir` debe ser una expresión constante, evaluable antes de ejecutar. Arreglos de tamaño dinámico no están soportados en esta versión.

`Longitud(arreglo)` devuelve el tamaño declarado, así que `Para i <- 0 Hasta Longitud(notas) - 1 Hacer` es el recorrido canónico cuando el tamaño no está en una variable aparte.

---

## 5. Asignación

```ebnf
asignacion   = designador , "<-" , expresion ;
designador   = identificador , [ "[" , expresion , { "," , expresion } , "]" ] ;
```

El operador de asignación es `<-`. No existe `=` como asignación, y `=` no existe como comparación de asignación: **la confusión clásica entre `=` y `==` es imposible en este lenguaje.** Esa es la razón principal para usar la flecha.

---

## 6. Entrada y salida

```ebnf
leer     = "Leer" , designador , { "," , designador } ;
escribir = "Escribir" , [ "Sin" , "Salto" ] , expresion , { "," , expresion } ;
```

### 6.1 `Escribir`

Los valores se concatenan **sin separador**. El salto de línea va al final, salvo con `Sin Salto`.

```
Escribir "El área es: ", area        // El área es: 15
Escribir Sin Salto "Ingrese base: "
```

Formato de los valores al imprimirse:

- `Entero`: sin decimales.
- `Real`: con el mínimo de decimales necesarios (`3.5` imprime `3.5`, no `3.50000`). Un real con parte decimal cero imprime al menos un decimal: `4.0`.
- `Logico`: `Verdadero` o `Falso`.
- `Texto`: tal cual, sin comillas.

### 6.2 `Leer`

Lee un valor por variable. Cada valor viene de una línea de entrada distinta.

La conversión depende del tipo de la variable:

- Si la variable es `Entero` o `Real` y la entrada no es un número válido → error en tiempo de ejecución con mensaje claro, no un valor basura.
- Si la variable es `Texto` → se toma la línea completa.
- Si la variable es `Logico` → se acepta `Verdadero`/`Falso`, `V`/`F`, `si`/`no`.

Como la declaración es obligatoria (sección 4.1), `Leer` **siempre** conoce el tipo de destino antes de ejecutar. No hay adivinanza ni inferencia. El mensaje cuando la entrada no coincide es específico:

```
Definir edad Como Entero
Leer edad
// Si el usuario teclea "veinte":
// ERROR línea 2: 'edad' es Entero, pero se ingresó "veinte", que no es
//   un número entero. Intenta de nuevo.
```

**[RESUELTO]** Este error es *recuperable*: el intérprete vuelve a pedir el valor en lugar de abortar el programa. Es entrada del usuario, no un bug del alumno, y abortar sería castigar al programador por el error de otro. Es el único error del lenguaje que se comporta así — todos los demás detienen la ejecución.

### 6.3 La entrada en el navegador

Nota de implementación, no de lenguaje. `Leer` bloquea la ejecución, lo que no se puede hacer directamente en JavaScript de un solo hilo. Tres salidas:

1. **Intérprete como generador** (`function*`): en `Leer`, hace `yield` pidiendo un valor y el bucle exterior lo reanuda cuando el usuario responde. Es la opción limpia y además te regala la ejecución paso a paso gratis.
2. **Web Worker** con `Atomics.wait`: bloqueo real, pero mucho más complejo.
3. **Entrada precargada**: el alumno escribe todos los valores en un panel antes de ejecutar. Útil para ejercicios automatizados, malo para explorar.

Recomiendo la opción 1.

---

## 7. Condicionales

```ebnf
si = "Si" , expresion , "Entonces" , bloque ,
     { "SiNo" , "Si" , expresion , "Entonces" , bloque } ,
     [ "SiNo" , bloque ] ,
     "FinSi" ;
```

```
Si nota >= 7 Entonces
    Escribir "Aprobado"
SiNo Si nota >= 5 Entonces
    Escribir "Recuperación"
SiNo
    Escribir "Reprobado"
FinSi
```

La condición debe ser de tipo `Logico`. Un número no cuenta como condición.

```
Si contador Entonces      // ERROR línea 1: la condición debe ser Verdadero o Falso,
                          //   pero 'contador' es Entero. ¿Quisiste escribir
                          //   'contador <> 0'?
```

**[DECISIÓN]** Exigir `Logico` estricto elimina la confusión entre "tener un valor" y "ser verdadero", y el mensaje de error puede sugerir la corrección. Ningún lenguaje pedagógico debería aceptar `Si contador Entonces`.

### 7.1 `Segun`

```ebnf
segun = "Segun" , expresion , "Hacer" ,
        { caso } ,
        [ "De" , "Otro" , "Modo" , ":" , bloque ] ,
        "FinSegun" ;
caso  = literal , { "," , literal } , ":" , bloque ;
```

```
Segun dia Hacer
    1, 2, 3, 4, 5:
        Escribir "Día laboral"
    6, 7:
        Escribir "Fin de semana"
    De Otro Modo:
        Escribir "Día inválido"
FinSegun
```

La expresión debe ser `Entero`, `Caracter` o `Texto`. **No hay caída entre casos**: al terminar un caso, el control salta a `FinSegun`. Los literales repetidos entre casos son error detectado antes de ejecutar.

---

## 8. Bucles

```ebnf
mientras = "Mientras" , expresion , "Hacer" , bloque , "FinMientras" ;
repetir  = "Repetir" , bloque , "Hasta" , "Que" , expresion ;
para     = "Para" , identificador , "<-" , expresion , "Hasta" , expresion ,
           [ "Con" , "Paso" , expresion ] , "Hacer" , bloque , "FinPara" ;
para_cada = "Para" , "Cada" , identificador , "En" , identificador ,
            "Hacer" , bloque , "FinPara" ;
```

`Mientras` evalúa la condición antes de cada iteración; cero iteraciones es posible.

`Repetir` evalúa después; siempre ejecuta al menos una vez, y termina cuando la condición se vuelve verdadera.

### 8.1 Semántica de `Para`

Hay que ser explícito porque es donde los lenguajes difieren:

1. El valor inicial y el límite se evalúan **una sola vez**, antes de la primera iteración. Modificar después una variable que aparecía en el límite no cambia cuántas veces itera el bucle.
2. `Con Paso` es opcional y vale 1 por omisión. Puede ser negativo, y entonces el bucle cuenta hacia abajo y termina cuando la variable es *menor* que el límite.
3. Paso 0 es error antes de ejecutar si es literal, y error en tiempo de ejecución si es una expresión.
4. La variable de control es una variable normal, visible después del bucle, con el último valor que tomó.
5. Asignar a la variable de control **dentro** del cuerpo está permitido y afecta al bucle, pero produce una advertencia.

```
Para i <- 1 Hasta 10 Con Paso 2 Hacer
    Escribir i               // 1 3 5 7 9
FinPara

Para i <- 10 Hasta 1 Con Paso -1 Hacer
    Escribir i               // 10 9 8 ... 1
FinPara

Para i <- 0 Hasta Longitud(notas) - 1 Hacer
    Escribir notas[i]        // recorrido canónico de un arreglo
FinPara
```

### 8.2 Sin salida anticipada

**[RESUELTO]** El lenguaje no incluye `Interrumpir` ni `Continuar`. Obligar al alumno a expresar la condición de salida completa en el encabezado del bucle es justo la habilidad que se quiere entrenar.

La consecuencia práctica es que la búsqueda lineal necesita una bandera:

```
Definir encontrado Como Logico
Definir i Como Entero
encontrado <- Falso
i <- 0
Mientras i <= Longitud(notas) - 1 Y No encontrado Hacer
    Si notas[i] = buscado Entonces
        encontrado <- Verdadero
    SiNo
        i <- i + 1
    FinSi
FinMientras
```

Nótese que esto **depende del corto circuito de `Y`** (sección 10.2) solo cuando la condición se escribe con el acceso al arreglo dentro de la misma expresión. Aquí no hace falta, pero la variante compacta sí lo requiere:

```
Mientras i <= Longitud(notas) - 1 Y notas[i] <> buscado Hacer
    i <- i + 1
FinMientras
```

Si el elemento no está, `i` llega a `Longitud(notas)` y el segundo operando accedería fuera de rango. El corto circuito lo impide. Vale la pena mostrar este ejemplo en clase: es el caso donde el corto circuito deja de ser trivia y se vuelve necesario.

Si más adelante decides incluir salida anticipada, la gramática crece así, y ambas deben ser error de compilación fuera de un bucle:

```ebnf
sentencia = ... | "Interrumpir" | "Continuar" ;
```

### 8.3 `Para Cada`

Recorre todos los elementos de un arreglo sin exponer el índice. Existe para que el recorrido más común no obligue al alumno a escribir `- 1`:

```
Definir nota Como Real
Para Cada nota En notas Hacer
    Escribir nota
FinPara
```

Reglas:

1. La variable de recorrido debe estar declarada, y su tipo debe coincidir con el tipo base del arreglo.
2. Recorre de índice `0` a `n - 1`, en ese orden.
3. La variable recibe una **copia** de cada elemento. Asignarle un valor dentro del cuerpo no modifica el arreglo, y produce una advertencia.
4. Solo funciona sobre arreglos de una dimensión. Para un arreglo de dos dimensiones hay que usar `Para` anidados con índices.

Cuando el algoritmo necesita el índice — buscar una posición, comparar con el elemento vecino, escribir en el arreglo — hay que usar `Para` con índice. `Para Cada` es solo para leer todos los elementos en orden.

### 8.4 Protección contra bucles infinitos

Nota de implementación, imprescindible en un entorno de enseñanza. El intérprete lleva un contador de pasos ejecutados; al superar un umbral (digamos 5 millones), se detiene con:

```
El programa lleva 5,000,000 de pasos sin terminar. Probablemente hay un
bucle infinito. El 'Mientras' de la línea 12 se ha repetido 4,998,331 veces.
```

Reportar *qué* bucle es lo que convierte el mensaje en útil.

---

## 9. Subprogramas

```ebnf
subprograma   = funcion | procedimiento ;

funcion       = "Funcion" , identificador , "<-" , identificador ,
                "(" , [ parametros ] , ")" ,
                bloque ,
                "FinFuncion" ;

procedimiento = "Procedimiento" , identificador , "(" , [ parametros ] , ")" ,
                bloque ,
                "FinProcedimiento" ;

parametros    = parametro , { "," , parametro } ;
parametro     = [ "Por" , ( "Referencia" | "Valor" ) ] , identificador , "Como" , tipo ;
```

En `funcion`, el primer identificador es la variable de retorno y el segundo es el nombre.

**Los parámetros llevan tipo obligatorio**, igual que las variables (sección 4.1),
y **la variable de retorno hay que declararla** dentro de la función. Sin eso no
se puede verificar una llamada antes de ejecutarla, que es la mitad del valor de
haber elegido declaración obligatoria.

```
Funcion resultado <- Area(base Como Real, altura Como Real)
    resultado <- base * altura
FinFuncion

Procedimiento Saludar(nombre Como Texto)
    Escribir "Hola, ", nombre
FinProcedimiento
```

**El valor de retorno se asigna a la variable de retorno**, no con `Retornar`. Al llegar a `FinFuncion`, se devuelve lo que tenga esa variable; si nunca se le asignó nada, es error en tiempo de ejecución.

`Retornar` existe como salida anticipada opcional: sin argumento en procedimientos, y con argumento en funciones (equivale a asignar a la variable de retorno y salir).

### 9.1 Paso de parámetros

Por **valor** por omisión. `Por Referencia` hace que las asignaciones al parámetro se reflejen en el argumento del llamador, que debe ser entonces un designador y no una expresión.

```
Procedimiento Intercambiar(Por Referencia a, Por Referencia b)
    Definir temporal Como Entero
    temporal <- a
    a <- b
    b <- temporal
FinProcedimiento
```

Los arreglos también se pasan por valor por omisión: se copian. Esto es más lento pero mucho más predecible, y el alumno que quiera modificar un arreglo debe pedirlo explícitamente con `Por Referencia`.

### 9.2 Alcance

Cada subprograma tiene su propio ámbito. **No hay variables globales**: un subprograma solo ve sus parámetros, sus locales, y los demás subprogramas. Toda comunicación pasa por parámetros y valor de retorno.

La recursión está permitida. El intérprete limita la profundidad de la pila (500 niveles) y reporta:

```
Línea 4: demasiadas llamadas anidadas (500). Probablemente 'Factorial' se
llama a sí misma sin un caso base que la detenga.
```

---

## 10. Expresiones

```ebnf
expresion   = expr_o ;
expr_o      = expr_y , { "O" , expr_y } ;
expr_y      = expr_no , { "Y" , expr_no } ;
expr_no     = "No" , expr_no | expr_rel ;
expr_rel    = expr_suma , [ op_rel , expr_suma ] ;
expr_suma   = expr_mul , { ( "+" | "-" ) , expr_mul } ;
expr_mul    = expr_unaria , { ( "*" | "/" | "DIV" | "MOD" ) , expr_unaria } ;
expr_unaria = "-" , expr_unaria | expr_pot ;
expr_pot    = primaria , [ "^" , expr_unaria ] ;
primaria    = numero | texto | logico
            | designador
            | llamada_funcion
            | "(" , expresion , ")" ;

op_rel      = "=" | "<>" | "<" | ">" | "<=" | ">=" ;
llamada_funcion = identificador , "(" , [ expresion , { "," , expresion } ] , ")" ;
```

### 10.1 Tabla de precedencia

De menor a mayor. Todos asocian a la izquierda excepto `^`.

| Nivel | Operadores | Asociatividad |
|---|---|---|
| 1 | `O` | izquierda |
| 2 | `Y` | izquierda |
| 3 | `No` | unario, derecha |
| 4 | `=` `<>` `<` `>` `<=` `>=` | **no asociativo** |
| 5 | `+` `-` | izquierda |
| 6 | `*` `/` `DIV` `MOD` | izquierda |
| 7 | `-` unario | derecha |
| 8 | `^` | derecha |

Dos consecuencias deliberadas:

**Los comparadores no se encadenan.** La regla `expr_rel` admite *como máximo una* comparación. `a < b < c` no compila.

```
Si 1 < x < 10 Entonces
// ERROR línea 1: no se pueden encadenar comparaciones. Escribe
//   'Si 1 < x Y x < 10 Entonces'
```

**`No` liga más flojo que las comparaciones.** `No a = b` significa `No (a = b)`, que es lo que un principiante espera al leerlo en voz alta.

### 10.2 Semántica de los operadores

| Operador | Tipos | Resultado |
|---|---|---|
| `+` | número, número | número |
| `+` | texto, texto | texto (concatenación) |
| `-` `*` | número, número | número |
| `/` | número, número | **siempre Real** |
| `DIV` | entero, entero | entero (división truncada) |
| `MOD` | entero, entero | entero (resto, signo del dividendo) |
| `^` | número, número | Real |
| `=` `<>` | dos valores del mismo tipo | Logico |
| `<` `>` `<=` `>=` | número/número, o texto/texto | Logico |
| `Y` `O` | logico, logico | Logico |
| `No` | logico | Logico |

`7 / 2` es `3.5`. Para división entera hay que escribir `7 DIV 2`. **[DECISIÓN]** Esto elimina el clásico "por qué me da 3" de C y Java. El precio es que el alumno tiene que conocer `DIV`.

`Y` y `O` **evalúan en corto circuito**: si el primer operando decide el resultado, el segundo no se evalúa. Esto permite `Si i <= n Y notas[i] > 5 Entonces` sin salir del arreglo.

Sumar texto con número es error, no concatenación implícita:

```
Escribir "Total: " + 5
// ERROR línea 1: no se puede sumar un Texto y un Entero. Para pegarlos,
//   usa una coma: Escribir "Total: ", 5
```

División por cero: error en tiempo de ejecución, siempre. No hay infinito ni NaN en este lenguaje.

---

## 11. Funciones integradas

Numéricas:

| Función | Firma | Notas |
|---|---|---|
| `Raiz(x)` | Real → Real | error si `x < 0` |
| `Abs(x)` | número → número | |
| `Trunc(x)` | Real → Entero | trunca hacia cero |
| `Redondear(x)` | Real → Entero | mitades hacia arriba |
| `Techo(x)` | Real → Entero | |
| `Piso(x)` | Real → Entero | |
| `Potencia(b, e)` | número, número → Real | igual que `b ^ e` |
| `Aleatorio(a, b)` | Entero, Entero → Entero | inclusivo en ambos extremos |
| `sen(x)` `cos(x)` `tan(x)` | Real → Real | radianes |
| `ln(x)` `exp(x)` | Real → Real | |
| `PI` | constante Real | |

De texto:

| Función | Firma | Notas |
|---|---|---|
| `Longitud(x)` | Texto → Entero, o Arreglo → Entero | cantidad de caracteres, o tamaño declarado del arreglo |
| `Subcadena(t, i, j)` | Texto, Entero, Entero → Texto | de la posición `i` a la `j`, **base 0**, inclusive |
| `Mayusculas(t)` | Texto → Texto | respeta acentos y ñ |
| `Minusculas(t)` | Texto → Texto | |
| `ConvertirANumero(t)` | Texto → Real | error si no es número |
| `ConvertirATexto(x)` | número → Texto | |
| `Concatenar(a, b)` | Texto, Texto → Texto | igual que `a + b` |

`Subcadena` usa base 0 para ser coherente con los arreglos: `Subcadena("hola", 0, 1)` devuelve `"ho"`. Un texto se indexa igual que un arreglo de caracteres, lo cual es la coherencia que se buscaba al elegir base 0.

`Longitud` está sobrecargada a propósito para texto y arreglos. Es la única función integrada polimórfica del lenguaje; la alternativa (`Tamaño` para arreglos) agrega vocabulario sin agregar claridad.

---

## 12. Errores: catálogo mínimo

La calidad del lenguaje se decide aquí. Cada error necesita: **línea, qué pasó, y cuando se pueda, la corrección.**

Errores léxicos y sintácticos:

```
Línea 5: no reconozco el símbolo '@'.

Línea 8: falta 'FinSi'. El 'Si' de la línea 4 quedó sin cerrar.

Línea 12: encontré 'FinMientras' pero el bloque abierto es un 'Para'
  (línea 9). ¿Querías escribir 'FinPara'?

Línea 3: 'Si' necesita 'Entonces' al final de la línea.

Línea 7: se esperaba un nombre de variable después de 'Leer'.

Línea 2: escribiste 'base = 5'. Para asignar un valor usa la flecha:
  'base <- 5'.
```

El tercer mensaje requiere que el parser mantenga una **pila de bloques abiertos con su línea de apertura**. Vale cada línea de código que cuesta: es el error más frecuente y el más desconcertante sin esa información.

Errores de declaración y de tipo. Como declarar es obligatorio, **todos estos se detectan antes de ejecutar** y el editor los puede subrayar mientras el alumno escribe:

```
Línea 4: 'altura' no está declarada. Agrega 'Definir altura Como Real'
  antes de usarla.

Línea 2: 'x' ya fue declarada como Entero en la línea 1.

Línea 6: no se puede multiplicar un Texto por un Entero.

Línea 4: 'edad' es Entero y no puede recibir un Texto.

Línea 9: la condición debe ser Verdadero o Falso, pero es Entero.
  ¿Quisiste escribir 'contador <> 0'?

Línea 22: 'Area' espera 2 argumentos, recibió 3.

Línea 14: 'nota' es Entero pero 'notas' es un Arreglo De Real.
  La variable de 'Para Cada' debe ser del mismo tipo.
```

Errores de ejecución:

```
Línea 11: 'total' se usa antes de recibir un valor.

Línea 7: división por cero.

Línea 15: el índice 12 está fuera del rango 0..9 de 'notas'.

Línea 4: demasiadas llamadas anidadas (500). Probablemente 'Factorial'
  se llama a sí misma sin un caso base que la detenga.
```

Advertencias — no detienen nada, pero se muestran:

```
Línea 8: 'i' es la variable del 'Para' de la línea 6. Modificarla dentro
  del bucle cambia cuántas veces se repite.

Línea 12: 'Base' se escribió antes como 'base' (línea 3). Son la misma
  variable, pero conviene escribirla siempre igual.

Línea 5: el programa usa 'area' y 'área'. Son dos variables distintas.
```

---

## 13. Programa de ejemplo completo

Ejercita casi toda la gramática. Sirve como primer caso de prueba del intérprete.

```
// Calcula el promedio de las notas de un grupo y clasifica el resultado.

Funcion promedio <- CalcularPromedio(Por Referencia notas Como Arreglo[30] De Real, cantidad Como Entero)
    Definir suma Como Real
    Definir i Como Entero
    Definir promedio Como Real
    suma <- 0
    Para i <- 0 Hasta cantidad - 1 Hacer
        suma <- suma + notas[i]
    FinPara
    promedio <- suma / cantidad
FinFuncion

Funcion mayor <- NotaMaxima(Por Referencia notas Como Arreglo[30] De Real, cantidad Como Entero)
    Definir i Como Entero
    Definir mayor Como Real
    mayor <- notas[0]
    Para i <- 1 Hasta cantidad - 1 Hacer
        Si notas[i] > mayor Entonces
            mayor <- notas[i]
        FinSi
    FinPara
FinFuncion

Procedimiento Clasificar(nota Como Real)
    Si nota >= 9 Entonces
        Escribir "Excelente"
    SiNo Si nota >= 7 Entonces
        Escribir "Aprobado"
    SiNo Si nota >= 5 Entonces
        Escribir "Recuperación"
    SiNo
        Escribir "Reprobado"
    FinSi
FinProcedimiento

Inicio
    Definir notas Como Arreglo[30] De Real
    Definir cantidad, i Como Entero
    Definir prom Como Real

    Escribir Sin Salto "¿Cuántos alumnos? "
    Leer cantidad

    Mientras cantidad < 1 O cantidad > 30 Hacer
        Escribir "Debe estar entre 1 y 30."
        Escribir Sin Salto "¿Cuántos alumnos? "
        Leer cantidad
    FinMientras

    // El arreglo va de 0 a cantidad - 1, pero al alumno le mostramos
    // los alumnos numerados desde 1.
    Para i <- 0 Hasta cantidad - 1 Hacer
        Escribir Sin Salto "Nota del alumno ", i + 1, ": "
        Leer notas[i]
    FinPara

    prom <- CalcularPromedio(notas, cantidad)
    Escribir "Promedio del grupo: ", Redondear(prom * 100) / 100
    Escribir "Nota más alta: ", NotaMaxima(notas, cantidad)
    Clasificar(prom)
Fin
```

Ese comentario sobre `i + 1` no es decorativo: es el primer lugar donde el alumno tropieza con la distinción entre *índice interno* y *número que ve el usuario*. Conviene tenerlo previsto como tema de clase en lugar de que aparezca por accidente.

Nótese también que `NotaMaxima` arranca en `notas[0]` e itera desde `1`. Ese patrón — inicializar con el primer elemento y recorrer desde el segundo — es el que evita tener que inventar un valor centinela imposible, y funciona porque la sección 4.2 prohíbe valores por defecto.

---

## 14. Pendientes para versiones futuras

Deliberadamente fuera de la versión 0.2:

- Registros o estructuras (`Definir p Como Registro`)
- Arreglos de tamaño dinámico
- Archivos
- Manejo de excepciones
- Interrupción de bucles (`Interrumpir`, `Continuar`) — ver 8.2
- Cadenas con interpolación
- Matrices en `Para Cada` — ver 8.3

Cada uno agrega superficie que hay que enseñar. Conviene que el lenguaje se sienta pequeño y completo antes de crecer.

---

## 15. Contrato de indentación del editor

El parser ignora la sangría por completo (principio 2). Eso no significa que la sangría dé igual: significa que **el editor es el responsable de que siempre esté bien**, y que nunca puede fallar de forma que rompa el programa.

Es el mejor de los dos mundos, y solo es posible porque los bloques se cierran con palabras clave explícitas. En Python no se puede hacer nada de esto, porque la sangría es la que define la estructura y el editor no puede corregirla sin cambiar el significado del programa.

### 15.1 Comportamiento requerido

**Al presionar Enter**, la nueva línea hereda la sangría de la anterior. Si la línea anterior abre un bloque (`Inicio`, `Si ... Entonces`, `SiNo`, `Mientras ... Hacer`, `Para ... Hacer`, `Repetir`, `Segun ... Hacer`, un caso de `Segun`, `Funcion`, `Procedimiento`), suma un nivel.

**Al escribir una palabra de cierre** (`Fin`, `FinSi`, `SiNo`, `FinMientras`, `FinPara`, `FinSegun`, `Hasta Que`, `FinFuncion`, `FinProcedimiento`), la línea se desangra un nivel automáticamente en cuanto la palabra queda completa. `SiNo` es a la vez cierre y apertura: se desangra a sí misma y vuelve a sangrar lo que sigue.

**Al pegar código**, se reindenta todo el bloque pegado según la estructura real, no según la sangría que traía.

**Un nivel = cuatro espacios**, nunca tabulaciones. El lexer nunca ve tabulaciones y el código se ve igual en cualquier parte donde se copie.

### 15.2 Comando de formateo

Como el parser conoce la estructura exacta del programa, `Formatear` puede reescribir la sangría de todo el archivo de forma perfecta y sin ambigüedad. Debe estar en el menú y con atajo de teclado.

Esto tiene un uso pedagógico directo: cuando un alumno llega con un programa ilegible, formatearlo delante de él y ver cómo aparece la estructura enseña más sobre anidamiento que una explicación.

### 15.3 Sangría incorrecta como advertencia

Si la sangría de una línea no coincide con la profundidad de bloque que calculó el parser, el editor lo marca — subrayado suave o marca en el margen, nunca un error rojo.

```
Línea 7: la sangría no coincide con la estructura. Esta línea está dentro
  del 'Si' de la línea 5. Presiona Formatear para corregir.
```

**El programa funciona igual.** La advertencia enseña el hábito sin castigar; el alumno aprende a indentar porque el editor le muestra la discrepancia, no porque su programa se rompa.

### 15.4 Lo que el editor no debe hacer

No debe reindentar mientras el alumno está escribiendo en el medio de una línea, ni mover el cursor de forma inesperada. La regla es: la sangría se ajusta al presionar Enter, al completar una palabra de cierre, al pegar, y al pedir `Formatear`. En ningún otro momento.
