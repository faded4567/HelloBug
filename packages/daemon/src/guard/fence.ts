import { resolve, relative } from "node:path";

export class WorkspaceFence {
  private readonly allowedRoots: string[];

  constructor(allowedPaths: string[]) {
    this.allowedRoots = allowedPaths.map((path) => resolve(path));
  }

  isAllowed(targetPath: string): boolean {
    const resolvedTarget = resolve(targetPath);

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
