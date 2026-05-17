const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

export function isRemoteOrDataUrl(value: string): boolean {
  if (WINDOWS_DRIVE_RE.test(value)) {
    return false;
  }

  return SCHEME_RE.test(value) || value.startsWith("//");
}

export function resolveAssetPath(documentPath: string, assetSrc: string): string {
  if (!assetSrc || isRemoteOrDataUrl(assetSrc)) {
    return assetSrc;
  }

  const separator = documentPath.includes("\\") ? "\\" : "/";
  const normalizedSrc = normalizeSlashes(assetSrc, separator);

  if (isAbsolutePath(normalizedSrc)) {
    return normalizePath(normalizedSrc, separator);
  }

  return normalizePath(`${dirname(documentPath)}${separator}${normalizedSrc}`, separator);
}

export function basename(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || filePath;
}

function dirname(filePath: string): string {
  const lastForward = filePath.lastIndexOf("/");
  const lastBackward = filePath.lastIndexOf("\\");
  const index = Math.max(lastForward, lastBackward);
  return index <= 0 ? filePath : filePath.slice(0, index);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_DRIVE_RE.test(value);
}

function normalizeSlashes(value: string, separator: "\\" | "/"): string {
  return value.replace(/[\\/]+/g, separator);
}

function normalizePath(value: string, separator: "\\" | "/"): string {
  const raw = normalizeSlashes(value, separator);
  const isUnixAbsolute = raw.startsWith(separator);
  const drive = raw.match(/^[a-zA-Z]:/)?.[0] ?? "";
  const withoutDrive = drive ? raw.slice(drive.length) : raw;
  const parts = withoutDrive.split(separator).filter((part) => part.length > 0);
  const stack: string[] = [];

  for (const part of parts) {
    if (part === ".") {
      continue;
    }
    if (part === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!isUnixAbsolute && !drive) {
        stack.push(part);
      }
      continue;
    }
    stack.push(part);
  }

  const body = stack.join(separator);
  if (drive) {
    return `${drive}${separator}${body}`;
  }
  if (isUnixAbsolute) {
    return `${separator}${body}`;
  }
  return body || ".";
}

