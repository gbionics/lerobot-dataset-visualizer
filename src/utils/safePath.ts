import { realpath } from "fs/promises";
import { join, resolve, sep } from "path";

/**
 * Resolves URL path segments inside `base`, or returns null when they would leave it
 * (`..`, absolute segments, or a symlink pointing outside). Null also for a missing file.
 */
export async function resolveInside(
  base: string,
  segments: string[],
): Promise<string | null> {
  if (segments.some((s) => s === ".." || s.startsWith("/") || s.includes("\0")))
    return null;
  try {
    const root = await realpath(resolve(base));
    const target = await realpath(resolve(join(root, ...segments)));
    return target === root || target.startsWith(root + sep) ? target : null;
  } catch {
    return null;
  }
}
