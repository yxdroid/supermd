import { describe, expect, it, vi } from "vitest";
import { renderMermaidPreviewElements } from "./diagramRender";

describe("renderMermaidPreviewElements", () => {
  it("renders each Mermaid preview from its original source", async () => {
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      '<pre class="mermaid" data-flow-engine="mermaid">flowchart LR\nA["Alpha&lt;br/>Beta"] --> B[End]</pre>',
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async (_id: string, code: string) => ({
        svg: `<svg data-code="${code.replaceAll('"', "&quot;")}"><text>Alpha</text></svg>`,
      })),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    const preview = document.querySelector<HTMLElement>(".mermaid");
    expect(renderer.render).toHaveBeenCalledWith(expect.stringMatching(/^supermd-mermaid-/), 'flowchart LR\nA["Alpha<br/>Beta"] --> B[End]', expect.any(HTMLElement));
    expect(preview?.dataset.renderedMermaid).toBe('flowchart LR\nA["Alpha<br/>Beta"] --> B[End]');
    expect(decodeURIComponent(preview?.dataset.renderedMermaidEncoded ?? "")).toBe('flowchart LR\nA["Alpha<br/>Beta"] --> B[End]');
    const image = preview?.querySelector<HTMLImageElement>("img.supermd-mermaid-image");
    expect(image).toBeNull();
    expect(preview?.querySelector(".supermd-mermaid-svg svg")).not.toBeNull();
  });

  it("uses a separate render container so Mermaid does not clear the preview source", async () => {
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      '<pre class="mermaid" data-flow-engine="mermaid">graph TD\nA-->B</pre>',
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async (_id: string, code: string, container?: Element) => {
        if (container?.classList.contains("mermaid")) {
          throw new Error("renderer received source element");
        }

        container?.replaceChildren();
        return { svg: `<svg data-code="${code}"></svg>` };
      }),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    const preview = document.querySelector<HTMLElement>(".mermaid");
    const renderContainer = renderer.render.mock.calls[0][2];
    expect(renderContainer).toBeInstanceOf(HTMLElement);
    expect(renderContainer).not.toBe(preview);
    expect(preview?.dataset.renderedMermaid).toBe("graph TD\nA-->B");
    expect(decodeURIComponent(preview?.dataset.renderedMermaidEncoded ?? "")).toBe("graph TD\nA-->B");
    expect(preview?.querySelector(".supermd-mermaid-svg svg")).not.toBeNull();
    expect(document.querySelector("[data-supermd-mermaid-render-root]")).toBeNull();
  });

  it("renders from encoded Markdown source instead of placeholder text", async () => {
    const source = "flowchart LR\nA[Start] --> B[End]";
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      `<div class="mermaid" data-flow-engine="mermaid" data-mermaid-source-encoded="${encodeURIComponent(source)}">`,
      '<div class="supermd-mermaid-placeholder">正在生成 Mermaid 预览</div>',
      "</div>",
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async (_id: string, code: string) => ({
        svg: `<svg data-code="${code.replaceAll('"', "&quot;")}"></svg>`,
      })),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    expect(renderer.render).toHaveBeenCalledWith(expect.stringMatching(/^supermd-mermaid-/), source, expect.any(HTMLElement));
    expect(document.querySelector(".supermd-mermaid-placeholder")).toBeNull();
    expect(document.querySelector(".supermd-mermaid-svg svg")).not.toBeNull();
  });

  it("falls back to Mermaid run API when render API fails", async () => {
    const source = "flowchart LR\nA-->B";
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      `<div class="mermaid" data-flow-engine="mermaid" data-mermaid-source-encoded="${encodeURIComponent(source)}">`,
      '<div class="supermd-mermaid-placeholder">正在生成 Mermaid 预览</div>',
      "</div>",
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async () => {
        throw new Error("render unavailable");
      }),
      run: vi.fn(async ({ nodes }: { nodes?: ArrayLike<HTMLElement> }) => {
        nodes?.[0]?.replaceChildren();
        nodes?.[0]?.insertAdjacentHTML("afterbegin", '<svg><path data-edge="true" d="M0 0 L10 0"></path></svg>');
      }),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    const preview = document.querySelector<HTMLElement>(".mermaid");
    expect(renderer.run).toHaveBeenCalled();
    expect(preview?.dataset.flowState).toBe("rendered");
    expect(preview?.querySelector(".supermd-mermaid-svg svg")).not.toBeNull();
    expect(preview?.textContent).not.toContain("正在生成");
  });

  it("adds visible stroke attributes to rendered Mermaid edge paths", async () => {
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      '<pre class="mermaid" data-flow-engine="mermaid">flowchart LR\nA-->B</pre>',
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async () => ({
        svg: [
          '<svg xmlns="http://www.w3.org/2000/svg">',
          '<defs><marker id="arrow"><path class="arrowMarkerPath" d="M0 0 L10 5 L0 10 z"></path></marker></defs>',
          '<g class="edgePaths"><path data-edge="true" data-et="edge" class="edge-thickness-normal edge-pattern-solid flowchart-link" d="M0 0 L100 0" marker-end="url(#arrow)"></path></g>',
          "</svg>",
        ].join(""),
      })),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    const edge = document.querySelector<SVGPathElement>(".supermd-mermaid-svg path[data-edge='true']");
    const marker = document.querySelector<SVGPathElement>(".supermd-mermaid-svg marker path");
    expect(edge?.getAttribute("stroke")).toBe("#26312f");
    expect(edge?.getAttribute("fill")).toBe("none");
    expect(edge?.getAttribute("stroke-width")).toBe("2");
    expect(edge?.getAttribute("style")).toContain("stroke:#26312f");
    expect(marker?.getAttribute("fill")).toBe("#26312f");
    expect(marker?.getAttribute("stroke")).toBe("#26312f");
  });

  it("keeps Mermaid marker-linked paths visible even without flowchart edge classes", async () => {
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      '<pre class="mermaid" data-flow-engine="mermaid">sequenceDiagram\nA->>B: Ping</pre>',
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async () => ({
        svg: [
          '<svg xmlns="http://www.w3.org/2000/svg">',
          '<defs><marker id="arrow"><path d="M0 0 L10 5 L0 10 z"></path></marker></defs>',
          '<path id="msg-line" d="M0 0 L100 0" marker-end="url(#arrow)" style="fill:none;"></path>',
          "</svg>",
        ].join(""),
      })),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    const edge = document.querySelector<SVGPathElement>("#msg-line");
    expect(edge?.getAttribute("stroke")).toBe("#26312f");
    expect(edge?.getAttribute("fill")).toBe("none");
    expect(edge?.getAttribute("style")).toContain("stroke:#26312f");
    expect(edge?.getAttribute("style")).toContain("stroke-width:2");
  });

  it("keeps Mermaid line and polyline connectors visible", async () => {
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      '<pre class="mermaid" data-flow-engine="mermaid">sequenceDiagram\nA->>B: Ping</pre>',
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async () => ({
        svg: [
          '<svg xmlns="http://www.w3.org/2000/svg">',
          '<line class="messageLine0" x1="0" y1="10" x2="120" y2="10"></line>',
          '<line class="actor-line" x1="30" y1="0" x2="30" y2="160"></line>',
          '<polyline class="transition" points="0,40 80,40 80,80"></polyline>',
          "</svg>",
        ].join(""),
      })),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    const messageLine = document.querySelector<SVGLineElement>(".messageLine0");
    const actorLine = document.querySelector<SVGLineElement>(".actor-line");
    const transition = document.querySelector<SVGPolylineElement>(".transition");
    expect(messageLine?.getAttribute("stroke")).toBe("#26312f");
    expect(actorLine?.getAttribute("stroke")).toBe("#26312f");
    expect(transition?.getAttribute("stroke")).toBe("#26312f");
    expect(messageLine?.getAttribute("style")).toContain("stroke-width:2");
  });

  it("still patches edges when Mermaid SVG contains HTML labels that are not XML-friendly", async () => {
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      '<pre class="mermaid" data-flow-engine="mermaid">flowchart TD\nA-->B</pre>',
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async () => ({
        svg: [
          '<svg xmlns="http://www.w3.org/2000/svg">',
          '<path id="L_A_B_0" class="flowchart-link" d="M0 0 L100 40" marker-end="url(#arrow)"></path>',
          '<foreignObject width="80" height="30"><div xmlns="http://www.w3.org/1999/xhtml">A&nbsp;label</div></foreignObject>',
          "</svg>",
        ].join(""),
      })),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    const edge = document.querySelector<SVGPathElement>("#L_A_B_0");
    expect(edge?.getAttribute("stroke")).toBe("#26312f");
    expect(edge?.getAttribute("style")).toContain("stroke:#26312f");
  });

  it("does not force invisible Mermaid edges to become visible", async () => {
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      '<pre class="mermaid" data-flow-engine="mermaid">flowchart LR\nA~~~B</pre>',
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async () => ({
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><path data-edge="true" class="edge-thickness-invisible" d="M0 0 L100 0"></path></svg>',
      })),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    const edge = document.querySelector<SVGPathElement>(".supermd-mermaid-svg path[data-edge='true']");
    expect(edge?.getAttribute("stroke")).toBeNull();
    expect(edge?.getAttribute("style") ?? "").not.toContain("stroke:#26312f");
  });

  it("does not rerender an already rendered Mermaid image for the same source", async () => {
    const source = "flowchart LR\nA-->B";
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      `<div class="mermaid" data-flow-engine="mermaid" data-rendered-mermaid-encoded="${encodeURIComponent(source)}">`,
      '<div class="supermd-mermaid-svg"><svg></svg></div>',
      "</div>",
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async () => ({ svg: "<svg></svg>" })),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    expect(renderer.render).not.toHaveBeenCalled();
  });

  it("shows an inline error without clearing the source needed for retry", async () => {
    document.body.innerHTML = [
      '<div class="supermd-flowchart" data-flow-engine="mermaid">',
      '<pre class="mermaid" data-flow-engine="mermaid">flowchart LR\nA --></pre>',
      "</div>",
    ].join("");

    const renderer = {
      initialize: vi.fn(),
      render: vi.fn(async () => {
        throw new Error("Parse failed");
      }),
    };

    await renderMermaidPreviewElements(document.body, renderer);

    const preview = document.querySelector<HTMLElement>(".mermaid");
    expect(preview?.dataset.flowError).toBe("true");
    expect(preview?.dataset.mermaidSource).toBe("flowchart LR\nA -->");
    expect(decodeURIComponent(preview?.dataset.mermaidSourceEncoded ?? "")).toBe("flowchart LR\nA -->");
    expect(preview?.textContent).toContain("Mermaid 预览解析失败");
  });
});
