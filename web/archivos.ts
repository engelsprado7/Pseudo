/**
 * Abrir y guardar archivos.
 *
 * Hay dos mecanismos, y cuál se usa depende del navegador:
 *
 *   1. **File System Access API** (`showSaveFilePicker`). Es la buena: Guardar
 *      sobrescribe *el mismo archivo* sin volver a preguntar, como en cualquier
 *      editor. Solo existe en Chromium (Chrome, Edge) y solo en contexto seguro
 *      (https o localhost).
 *   2. **Descarga + input de archivo.** Funciona en todos lados, pero cada
 *      Guardar deja una copia nueva en la carpeta de descargas y Abrir obliga a
 *      buscar el archivo. Es el respaldo.
 *
 * El punto 1 no está disponible en Firefox ni Safari, y tampoco si el sitio se
 * sirve por http:// desde otra máquina de la red. Como en un laboratorio eso es
 * perfectamente posible, el respaldo no es opcional: es el camino probable.
 */

export const EXTENSION = ".psc";

interface EscritorArchivo {
  write(datos: string): Promise<void>;
  close(): Promise<void>;
}

/** Referencia persistente a un archivo del disco (File System Access API). */
export interface ManejadorArchivo {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<EscritorArchivo>;
}

interface VentanaConArchivos {
  showOpenFilePicker?: (opciones?: unknown) => Promise<ManejadorArchivo[]>;
  showSaveFilePicker?: (opciones?: unknown) => Promise<ManejadorArchivo>;
}

/**
 * Se resuelve al llamarla, no al importar el módulo.
 *
 * Tocar `window` en el nivel superior haría que el módulo no se pueda importar
 * fuera de un navegador — ni para probar la parte pura, ni desde un worker.
 */
function ventana(): VentanaConArchivos {
  return typeof window === "undefined"
    ? {}
    : (window as unknown as VentanaConArchivos);
}

/** ¿El navegador puede sobrescribir el mismo archivo? */
export function soportaGuardadoDirecto(): boolean {
  return typeof ventana().showSaveFilePicker === "function";
}

const OPCIONES_TIPO = [
  {
    description: "Seudocódigo",
    accept: { "text/plain": [EXTENSION, ".txt"] },
  },
];

export interface ArchivoAbierto {
  nombre: string;
  contenido: string;
  /** Presente solo con File System Access: permite Guardar sin preguntar. */
  manejador?: ManejadorArchivo;
}

/** Normaliza los finales de línea: un `.psc` hecho en Windows trae `\r\n`. */
function normalizar(texto: string): string {
  return texto.replace(/\r\n?/g, "\n");
}

export async function abrirArchivo(): Promise<ArchivoAbierto | null> {
  const api = ventana();
  if (typeof api.showOpenFilePicker === "function") {
    try {
      const [manejador] = await api.showOpenFilePicker({
        types: OPCIONES_TIPO,
        multiple: false,
      });
      if (manejador === undefined) return null;
      const archivo = await manejador.getFile();
      return {
        nombre: manejador.name,
        contenido: normalizar(await archivo.text()),
        manejador,
      };
    } catch {
      // El usuario canceló el diálogo.
      return null;
    }
  }

  // Respaldo: input de archivo oculto.
  return new Promise<ArchivoAbierto | null>((resolver) => {
    const entrada = document.createElement("input");
    entrada.type = "file";
    entrada.accept = `${EXTENSION},.txt,text/plain`;
    entrada.style.display = "none";

    // Si el usuario cancela, 'change' nunca se dispara. 'cancel' sí, donde
    // exista; el temporizador de respaldo evita quedar colgado para siempre.
    let resuelto = false;
    const terminar = (valor: ArchivoAbierto | null): void => {
      if (resuelto) return;
      resuelto = true;
      entrada.remove();
      resolver(valor);
    };

    entrada.addEventListener("change", () => {
      const archivo = entrada.files?.[0];
      if (archivo === undefined) {
        terminar(null);
        return;
      }
      void archivo.text().then((texto) => {
        terminar({ nombre: archivo.name, contenido: normalizar(texto) });
      });
    });
    entrada.addEventListener("cancel", () => terminar(null));

    document.body.appendChild(entrada);
    entrada.click();
  });
}

/** Lee un archivo soltado sobre el editor. */
export async function leerArchivoSoltado(archivo: File): Promise<ArchivoAbierto> {
  return { nombre: archivo.name, contenido: normalizar(await archivo.text()) };
}

export type ResultadoGuardado =
  | { estado: "guardado"; nombre: string; manejador?: ManejadorArchivo }
  | { estado: "descargado"; nombre: string }
  | { estado: "cancelado" };

/** Descarga el contenido como archivo. Es el respaldo universal. */
function descargar(nombre: string, contenido: string): void {
  const blob = new Blob([contenido], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Se libera después de que el navegador tomó el blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function conExtension(nombre: string): string {
  const limpio = nombre.trim();
  if (limpio === "") return `programa${EXTENSION}`;
  return /\.(psc|txt)$/i.test(limpio) ? limpio : limpio + EXTENSION;
}

/**
 * Guarda. Si hay manejador, sobrescribe ese archivo sin preguntar nada.
 * Si no, pide destino (o descarga, según el navegador).
 */
export async function guardar(
  contenido: string,
  nombreSugerido: string,
  manejador?: ManejadorArchivo,
): Promise<ResultadoGuardado> {
  if (manejador !== undefined) {
    try {
      const escritor = await manejador.createWritable();
      await escritor.write(contenido);
      await escritor.close();
      return { estado: "guardado", nombre: manejador.name, manejador };
    } catch {
      // El permiso pudo haberse revocado (por ejemplo al recargar). Se
      // reintenta como si fuera un Guardar como.
      return guardarComo(contenido, nombreSugerido);
    }
  }
  return guardarComo(contenido, nombreSugerido);
}

export async function guardarComo(
  contenido: string,
  nombreSugerido: string,
): Promise<ResultadoGuardado> {
  const nombre = conExtension(nombreSugerido);

  const api = ventana();
  if (typeof api.showSaveFilePicker === "function") {
    try {
      const manejador = await api.showSaveFilePicker({
        suggestedName: nombre,
        types: OPCIONES_TIPO,
      });
      const escritor = await manejador.createWritable();
      await escritor.write(contenido);
      await escritor.close();
      return { estado: "guardado", nombre: manejador.name, manejador };
    } catch {
      return { estado: "cancelado" };
    }
  }

  descargar(nombre, contenido);
  return { estado: "descargado", nombre };
}
