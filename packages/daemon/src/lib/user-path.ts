import { homedir } from "node:os";
import { resolve } from "node:path";

export function expandHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

export function resolveUserPath(path: string): string {
  return resolve(expandHomePath(path));
}
