// @ts-nocheck
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const styles = readFileSync(resolve(__dirname, "styles.css"), "utf-8");

describe("styles.css", () => {
  it("adds Mermaid edge fallback styles for inline SVG previews", () => {
    expect(styles).toContain(".supermd-mermaid-svg .edgePaths path:not(.edge-thickness-invisible)");
    expect(styles).toContain("stroke: #26312f !important;");
    expect(styles).toContain(".supermd-mermaid-svg marker .arrowMarkerPath");
  });
});
