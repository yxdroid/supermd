const LAST_DOCUMENT_PATH_KEY = "supermd:last-document-path";

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLastDocumentPath(): string | null {
  const value = getStorage()?.getItem(LAST_DOCUMENT_PATH_KEY)?.trim() ?? "";
  return value || null;
}

export function rememberLastDocumentPath(path: string) {
  const normalized = path.trim();
  if (!normalized) {
    return;
  }

  getStorage()?.setItem(LAST_DOCUMENT_PATH_KEY, normalized);
}

export function forgetLastDocumentPath() {
  getStorage()?.removeItem(LAST_DOCUMENT_PATH_KEY);
}
