// Sintaxis y tipos correctos. Falla al ejecutar.
Inicio
    Definir notas Como Arreglo[3] De Real
    Definir i Como Entero

    notas[0] <- 8.0
    notas[1] <- 9.0
    notas[2] <- 7.0

    // El arreglo va de 0 a 2, no de 1 a 3.
    Para i <- 1 Hasta 3 Hacer
        Escribir notas[i]
    FinPara
Fin
