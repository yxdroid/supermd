export interface BrowserFolderFileLike {
  name: string;
  webkitRelativePath?: string;
}

export interface BrowserFolderEntry {
  path: string;
  name: string;
  label: string;
}

export interface BrowserFolderFileNode extends BrowserFolderEntry {
  type: "file";
}

export interface BrowserFolderDirectoryNode {
  type: "directory";
  name: string;
  path: string;
  children: BrowserFolderNode[];
}

export type BrowserFolderNode = BrowserFolderDirectoryNode | BrowserFolderFileNode;

export interface BrowserFolderIndex {
  folderName: string;
  markdownFiles: BrowserFolderEntry[];
  tree: BrowserFolderNode[];
}

const MARKDOWN_FILE_RE = /\.(md|markdown|mdown|mkd)$/i;

export function normalizeBrowserPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

export function browserFilePath(file: BrowserFolderFileLike): string {
  return normalizeBrowserPath(file.webkitRelativePath?.trim() || file.name);
}

export function isMarkdownBrowserPath(path: string): boolean {
  return MARKDOWN_FILE_RE.test(path);
}

export function buildBrowserFolderIndex(files: readonly BrowserFolderFileLike[]): BrowserFolderIndex | null {
  const normalizedPaths = files
    .map((file) => browserFilePath(file))
    .filter((path) => path.length > 0);

  if (normalizedPaths.length === 0) {
    return null;
  }

  const folderName = normalizedPaths[0].split("/")[0] || normalizedPaths[0];
  const markdownFiles = normalizedPaths
    .filter((path) => isMarkdownBrowserPath(path))
    .map((path) => ({
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      label: toRelativeFolderPath(path, folderName),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }));

  return {
    folderName,
    markdownFiles,
    tree: buildFolderTree(markdownFiles),
  };
}

function toRelativeFolderPath(path: string, folderName: string): string {
  const prefix = `${folderName}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function buildFolderTree(markdownFiles: readonly BrowserFolderEntry[]): BrowserFolderNode[] {
  const root: BrowserFolderDirectoryNode = {
    type: "directory",
    name: "",
    path: "",
    children: [],
  };

  for (const file of markdownFiles) {
    const segments = file.label.split("/").filter((segment) => segment.length > 0);
    let directory = root;
    let currentPath = "";

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let nextDirectory = directory.children.find((child) => child.type === "directory" && child.name === segment);
      if (!nextDirectory || nextDirectory.type !== "directory") {
        nextDirectory = {
          type: "directory",
          name: segment,
          path: currentPath,
          children: [],
        };
        directory.children.push(nextDirectory);
      }
      directory = nextDirectory;
    }

    directory.children.push({
      type: "file",
      path: file.path,
      name: file.name,
      label: file.label,
    });
  }

  return sortFolderTree(root.children);
}

function sortFolderTree(nodes: BrowserFolderNode[]): BrowserFolderNode[] {
  return [...nodes]
    .map((node) => (
      node.type === "directory"
        ? { ...node, children: sortFolderTree(node.children) }
        : node
    ))
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }

      const leftName = left.type === "directory" ? left.name : left.label;
      const rightName = right.type === "directory" ? right.name : right.label;
      return leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: "base" });
    });
}
