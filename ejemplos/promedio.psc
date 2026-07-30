// Promedio de notas de un grupo, con clasificación.

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

Procedimiento Clasificar(nota Como Real)
    Si nota >= 9 Entonces
        Escribir "Excelente"
    SiNo Si nota >= 7 Entonces
        Escribir "Aprobado"
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
        Leer cantidad
    FinMientras

    Para i <- 0 Hasta cantidad - 1 Hacer
        Escribir Sin Salto "Nota del alumno ", i + 1, ": "
        Leer notas[i]
    FinPara

    prom <- CalcularPromedio(notas, cantidad)
    Escribir "Promedio: ", prom
    Clasificar(prom)
Fin
