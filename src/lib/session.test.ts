import { beforeEach, describe, expect, it } from "vitest";
import { forgetLastDocumentPath, readLastDocumentPath, rememberLastDocumentPath } from "./session";

describe("session document path", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers the last opened document path", () => {
    rememberLastDocumentPath(" /Users/demo/note.md ");

    expect(readLastDocumentPath()).toBe("/Users/demo/note.md");
  });

  it("ignores blank paths and clears remembered paths", () => {
    rememberLastDocumentPath("   ");
    expect(readLastDocumentPath()).toBeNull();

    rememberLastDocumentPath("/Users/demo/note.md");
    forgetLastDocumentPath();

    expect(readLastDocumentPath()).toBeNull();
  });
});
