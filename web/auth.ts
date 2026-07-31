/**
 * Inicio de sesión con Google y Microsoft.
 *
 * Nada de esto es obligatorio para usar el editor: si no hay nube configurada
 * las funciones devuelven `null` y la interfaz de sesión no se muestra.
 *
 * El proveedor de Microsoft se llama `azure` en Supabase; el nombre que ve el
 * alumno sí dice "Microsoft", que es lo que tiene escrito en su cuenta escolar.
 */
import type { Session, User } from "@supabase/supabase-js";
import { cliente, type Proveedor } from "./nube.ts";

export type { Proveedor };

export interface Usuario {
  id: string;
  nombre: string;
  avatar: string | null;
}

function desdeSesion(u: User): Usuario {
  const meta = u.user_metadata as Record<string, unknown>;
  const nombre =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    u.email ||
    "Sin nombre";
  return {
    id: u.id,
    nombre,
    avatar: typeof meta.avatar_url === "string" ? meta.avatar_url : null,
  };
}

/** Usuario actual, o `null` si no hay sesión (o no hay nube). */
export async function usuarioActual(): Promise<Usuario | null> {
  const c = await cliente();
  if (c === null) return null;
  const { data } = await c.auth.getSession();
  return data.session === null ? null : desdeSesion(data.session.user);
}

/**
 * Avisa cada vez que la sesión cambia (entrar, salir, refrescar el token).
 *
 * Es la forma correcta de enterarse de que volvió el OAuth: la redirección
 * recarga la página, así que no alcanza con reaccionar al clic del botón.
 */
export async function alCambiarSesion(
  callback: (usuario: Usuario | null) => void,
): Promise<void> {
  const c = await cliente();
  if (c === null) return;
  c.auth.onAuthStateChange((_evento, sesion: Session | null) => {
    callback(sesion === null ? null : desdeSesion(sesion.user));
  });
}

/** Manda al proveedor. La página se recarga al volver, con la sesión puesta. */
export async function entrar(proveedor: Proveedor): Promise<string | null> {
  const c = await cliente();
  if (c === null) return "No hay nube configurada.";
  const { error } = await c.auth.signInWithOAuth({
    provider: proveedor,
    // Sin el hash: si el alumno abrió un enlace para compartir, no queremos
    // arrastrarlo por la redirección del proveedor.
    options: { redirectTo: location.origin + location.pathname },
  });
  return error === null ? null : error.message;
}

export async function salir(): Promise<void> {
  const c = await cliente();
  await c?.auth.signOut();
}
