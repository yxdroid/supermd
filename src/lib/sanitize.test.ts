import { describe, expect, it } from "vitest";
import { sanitizePreviewHtml } from "./sanitize";

describe("sanitizePreviewHtml", () => {
  it("keeps local preview image urls used by browser and Tauri modes", () => {
    const html = [
      '<img src="blob:http://localhost:5173/abc" alt="browser">',
      '<img src="http://asset.localhost/Users/demo/a.png" alt="tauri">',
      '<img src="asset://localhost/Users/demo/a.png" alt="asset">',
      '<img src="data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%20100%2040%22%3E%3Cpath%20d%3D%22M0%200L100%2040%22%2F%3E%3C%2Fsvg%3E" alt="mermaid">',
    ].join("");

    const sanitized = sanitizePreviewHtml(html);

    expect(sanitized).toContain('src="blob:http://localhost:5173/abc"');
    expect(sanitized).toContain('src="http://asset.localhost/Users/demo/a.png"');
    expect(sanitized).toContain('src="asset://localhost/Users/demo/a.png"');
    expect(sanitized).toContain('src="data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%20100%2040%22%3E%3Cpath%20d%3D%22M0%200L100%2040%22%2F%3E%3C%2Fsvg%3E"');
  });

  it("keeps flowchart tab data attributes", () => {
    const sanitized = sanitizePreviewHtml('<button type="button" data-flow-tab="preview" aria-pressed="true">图片预览</button><div data-flow-panel="preview"></div>');

    expect(sanitized).toContain('data-flow-tab="preview"');
    expect(sanitized).toContain('data-flow-panel="preview"');
  });

  it("keeps rendered Mermaid SVG and source metadata", () => {
    const sanitized = sanitizePreviewHtml([
      '<div class="mermaid" data-flow-engine="mermaid" data-mermaid-source-encoded="graph%20TD%0AA--%3EB" data-rendered-mermaid-encoded="graph%20TD%0AA--%3EB">',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" style="width: 100%; height: auto;">',
      "<style>#graph .flowchart-link{stroke:#333;stroke-width:2px;fill:none;}</style>",
      '<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><path d="M 0 0 L 10 3.5 L 0 7 z"></path></marker></defs>',
      '<g id="graph"><path id="L_A_B_0" class="edge-thickness-normal edge-pattern-solid flowchart-link LS-A LE-B" d="M0 0 L100 40" marker-end="url(#arrowhead)" style="fill:none;" stroke="red" stroke-width="2" stroke-dasharray="5,5"></path><text dominant-baseline="middle">A</text>',
      '<foreignObject width="80" height="30"><div xmlns="http://www.w3.org/1999/xhtml">HTML Label</div></foreignObject>',
      "</g></svg>",
      "</div>",
    ].join(""));

    expect(sanitized).toContain("<svg");
    expect(sanitized).toContain("viewBox");
    expect(sanitized).toContain("<style>");
    expect(sanitized).toContain("flowchart-link");
    expect(sanitized).toContain("stroke:#333");
    expect(sanitized).toContain('class="edge-thickness-normal edge-pattern-solid flowchart-link LS-A LE-B"');
    expect(sanitized).toContain('style="fill:none;"');
    expect(sanitized).toContain('stroke="red"');
    expect(sanitized).toContain('stroke-width="2"');
    expect(sanitized).toContain('stroke-dasharray="5,5"');
    expect(sanitized).toContain("<marker");
    expect(sanitized).toContain("marker-end");
    expect(sanitized).toContain('d="M0 0 L100 40"');
    expect(sanitized).toContain("dominant-baseline");
    expect(sanitized).toContain("<foreignObject");
    expect(sanitized).toContain("HTML Label");
    expect(sanitized).toContain("data-mermaid-source-encoded");
    expect(sanitized).toContain("data-rendered-mermaid-encoded");
  });

  it("keeps inline Mermaid edge visibility styles after DOMPurify", () => {
    const sanitized = sanitizePreviewHtml([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">',
      '<defs><marker id="flowchart-pointEnd"><path class="arrowMarkerPath" d="M0 0 L10 5 L0 10 z" fill="#26312f" stroke="#26312f"></path></marker></defs>',
      '<path id="L_A_B_0" class="edge-thickness-normal edge-pattern-solid flowchart-link" d="M0 0 L100 40" marker-end="url(#flowchart-pointEnd)" fill="none" stroke="#26312f" stroke-width="2" style="fill:none;stroke:#26312f;stroke-width:2;opacity:1;"></path>',
      '<path id="state-transition" class="transition transition-path" d="M0 20 L100 20" fill="none" stroke="#26312f" stroke-width="2" style="fill:none;stroke:#26312f;stroke-width:2;opacity:1;"></path>',
      "</svg>",
    ].join(""));

    expect(sanitized).toContain('marker-end="url(#flowchart-pointEnd)"');
    expect(sanitized).toContain('d="M0 0 L100 40"');
    expect(sanitized).toContain('d="M0 20 L100 20"');
    expect(sanitized).toContain('stroke="#26312f"');
    expect(sanitized).toContain('stroke-width="2"');
    expect(sanitized).toContain("stroke:#26312f");
    expect(sanitized).toContain("transition-path");
  });
});
