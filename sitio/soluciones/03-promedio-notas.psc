Inicio
    Definir cantidad, i Como Entero
    Definir nota, suma, prom Como Real

    Leer cantidad
    suma <- 0
    Para i <- 0 Hasta cantidad - 1 Hacer
        Leer nota
        suma <- suma + nota
    FinPara

    prom <- suma / cantidad
    Escribir "Promedio: ", Redondear(prom * 100) / 100
    Si prom >= 9 Entonces
        Escribir "Excelente"
    SiNo Si prom >= 7 Entonces
        Escribir "Aprobado"
    SiNo Si prom >= 5 Entonces
        Escribir "Recuperación"
    SiNo
        Escribir "Reprobado"
    FinSi
Fin
