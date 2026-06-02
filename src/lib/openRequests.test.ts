import { describe, expect, it } from "vitest";
import { createLatestOpenRequestGuard, latestMarkdownOpenPath } from "./openRequests";

describe("system open requests", () => {
  it("chooses the latest markdown path when open requests are coalesced", () => {
    expect(latestMarkdownOpenPath([
      "/Users/demo/old.md",
      "/Users/demo/notes.png",
      "/Users/demo/new.markdown",
    ])).toBe("/Users/demo/new.markdown");
  });

  it("deduplicates paths while keeping the latest occurrence", () => {
    expect(latestMarkdownOpenPath([
      "/Users/demo/new.md",
      "/Users/demo/old.md",
      "/Users/demo/new.md",
    ])).toBe("/Users/demo/new.md");
  });

  it("ignores non-markdown and blank paths", () => {
    expect(latestMarkdownOpenPath(["", "   ", "/Users/demo/image.jpg"])).toBeNull();
  });

  it("marks older open requests as stale after a newer request starts", () => {
    const guard = createLatestOpenRequestGuard();
    const firstRequest = guard.next();
    const secondRequest = guard.next();

    expect(guard.isLatest(firstRequest)).toBe(false);
    expect(guard.isLatest(secondRequest)).toBe(true);
  });
});
