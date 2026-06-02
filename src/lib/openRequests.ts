const MARKDOWN_EXTENSION_PATTERN = /\.(md|markdown|mdown|mkd)$/i;

export function latestMarkdownOpenPath(paths: string[]): string | null {
  const orderedUniquePaths = new Map<string, string>();

  for (const rawPath of paths) {
    const path = rawPath.trim();
    if (!MARKDOWN_EXTENSION_PATTERN.test(path)) {
      continue;
    }

    orderedUniquePaths.delete(path);
    orderedUniquePaths.set(path, path);
  }

  return [...orderedUniquePaths.values()].at(-1) ?? null;
}

export function isMarkdownOpenPath(path: string): boolean {
  return MARKDOWN_EXTENSION_PATTERN.test(path.trim());
}

export function createLatestOpenRequestGuard() {
  let currentRequest = 0;

  return {
    next() {
      currentRequest += 1;
      return currentRequest;
    },
    isLatest(request: number) {
      return request === currentRequest;
    },
  };
}
