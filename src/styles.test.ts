// @ts-nocheck
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const styles = readFileSync(resolve(__dirname, "styles.css"), "utf-8");

describe("styles.css", () => {
  it("makes bold markdown visually distinct in the preview pane", () => {
    expect(styles).toContain("font-synthesis-weight: auto;");
    expect(styles).toContain(".supermd-preview strong");
    expect(styles).toContain("font-weight: 850;");
    expect(styles).toContain("color: #151912;");
  });

  it("renders quick preview sections as switchable tabs", () => {
    expect(styles).toContain(".quick-preview-tabs");
    expect(styles).toContain(".quick-preview-tab.is-active");
    expect(styles).toContain(".quick-preview-panel-body");
  });

  it("adds Mermaid edge fallback styles for inline SVG previews", () => {
    expect(styles).toContain(".supermd-mermaid-svg .edgePaths path:not(.edge-thickness-invisible)");
    expect(styles).toContain("stroke: #26312f !important;");
    expect(styles).toContain(".supermd-mermaid-svg marker .arrowMarkerPath");
  });
});
