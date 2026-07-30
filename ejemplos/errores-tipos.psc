// Sintaxis impecable, semántica llena de agujeros.
Inicio
    Definir cantidad Como Entero
    Definir nombre Como Texto
    Definir notas Como Arreglo[10] De Real
    Definir sobra Como Logico

    cantidad <- 7 / 2
    nombre <- "Alumnos: " + cantidad

    Si cantidad Entonces
        Escribir notas
    FinSi

    Para nombre <- 0 Hasta 9 Hacer
        Escribir notas[cantidad, 2]
    FinPara

    Escribir Raiz("hola"), Longitd(notas)
    Clasificar(cantidad)
Fin
