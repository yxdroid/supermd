import { describe, expect, it } from "vitest";
import { browserFilePath, buildBrowserFolderIndex, normalizeBrowserPath } from "./browserFolder";

describe("browser folder helpers", () => {
  it("normalizes browser file paths", () => {
    expect(normalizeBrowserPath(".\\notes\\\\day1\\draft.md")).toBe("notes/day1/draft.md");
  });

  it("prefers the relative folder path when provided by the browser", () => {
    expect(browserFilePath({
      name: "draft.md",
      webkitRelativePath: "notes\\day1\\draft.md",
    })).toBe("notes/day1/draft.md");
  });

  it("builds a sorted markdown file list for a selected folder", () => {
    const folder = buildBrowserFolderIndex([
      { name: "cover.png", webkitRelativePath: "notes/assets/cover.png" },
      { name: "b.md", webkitRelativePath: "notes/chapter/b.md" },
      { name: "a.md", webkitRelativePath: "notes/a.md" },
    ]);

    expect(folder).toEqual({
      folderName: "notes",
      markdownFiles: [
        { path: "notes/a.md", name: "a.md", label: "a.md" },
        { path: "notes/chapter/b.md", name: "b.md", label: "chapter/b.md" },
      ],
      tree: [
        { type: "directory", name: "chapter", path: "chapter", children: [
          { type: "file", path: "notes/chapter/b.md", name: "b.md", label: "chapter/b.md" },
        ] },
        { type: "file", path: "notes/a.md", name: "a.md", label: "a.md" },
      ],
    });
  });
});
