/**
 * Capa opcional en la nube.
 *
 * La regla de esta capa: **el editor tiene que funcionar igual sin ella**. Un
 * laboratorio sin internet, un navegador viejo o un `nube.json` ausente no son
 * errores, son el caso normal en una escuela. Por eso todo acá devuelve `null`
 * en vez de lanzar: sin nube, el núcleo sigue andando y los botones de la nube
 * simplemente no aparecen. Es el mismo criterio de `cargarIndice`.
 *
 * La configuración se lee en tiempo de ejecución y no se hornea en el bundle,
 * así se puede cambiar de proyecto Supabase sin recompilar. La clave
 * *publishable* es pública por diseño (va en el JavaScript del navegador); lo
 * que protege los datos son las políticas RLS, no esconderla. La clave secreta
 * no aparece nunca en este repositorio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConfigNube {
  url: string;
  publishableKey: string;
}

/** `undefined` = todavía no se intentó; `null` = no hay nube configurada. */
let config: ConfigNube | null | undefined;
let clientePendiente: Promise<SupabaseClient | null> | null = null;

function configValida(datos: unknown): datos is ConfigNube {
  if (typeof datos !== "object" || datos === null) return false;
  const c = datos as Partial<ConfigNube>;
  return (
    typeof c.url === "string" &&
    c.url.startsWith("https://") &&
    typeof c.publishableKey === "string" &&
    c.publishableKey !== ""
  );
}

/** Lee `nube.json`. Ausente, incompleto o ilegible: no hay nube, y está bien. */
export async function leerConfig(): Promise<ConfigNube | null> {
  if (config !== undefined) return config;
  try {
    const respuesta = await fetch("./nube.json", { cache: "no-cache" });
    if (!respuesta.ok) {
      config = null;
      return null;
    }
    const datos: unknown = await respuesta.json();
    // La URL base, no la de REST: el cliente le agrega '/rest/v1' por su cuenta.
    config = configValida(datos)
      ? { url: datos.url.replace(/\/+(rest\/v1\/?)?$/, ""), publishableKey: datos.publishableKey }
      : null;
    return config;
  } catch {
    config = null;
    return null;
  }
}

/**
 * Cliente de Supabase, o `null` si no hay nube.
 *
 * El `import()` es dinámico para que quien nunca inicia sesión no pague el peso
 * de la librería. Se memoriza la promesa, no el cliente: dos llamadas seguidas
 * no pueden crear dos clientes ni pedir el módulo dos veces.
 */
export function cliente(): Promise<SupabaseClient | null> {
  clientePendiente ??= (async () => {
    const cfg = await leerConfig();
    if (cfg === null) return null;
    try {
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(cfg.url, cfg.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // El OAuth vuelve con '#access_token=...' en el hash, justo donde
          // viven los enlaces para compartir. Que lo consuma el cliente y deje
          // el hash limpio antes de que nadie más lo lea.
          detectSessionInUrl: true,
        },
      });
    } catch {
      // Sin internet el import falla: no es motivo para romper el editor.
      return null;
    }
  })();
  return clientePendiente;
}

/** `true` si hay nube configurada y alcanzable. Para decidir si mostrar la interfaz. */
export async function hayNube(): Promise<boolean> {
  return (await cliente()) !== null;
}
