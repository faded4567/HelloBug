import { relative } from "node:path";

import { resolveUserPath } from "../lib/user-path.js";

export class WorkspaceFence {
  private readonly allowedRoots: string[];

  constructor(allowedPaths: string[]) {
    this.allowedRoots = allowedPaths.map((path) => resolveUserPath(path));
  }

  isAllowed(targetPath: string): boolean {
    const resolvedTarget = resolveUserPath(targetPath);

    return this.allowedRoots.some((root) => {
      const diff = relative(root, resolvedTarget);
      return diff === "" || (!diff.startsWith("..") && !diff.startsWith("/"));
    });
  }

  assertAllowed(targetPath: string): void {
    if (!this.isAllowed(targetPath)) {
      throw new Error(`Workspace is outside allowed paths: ${targetPath}`);
    }
  }
}
