import { describe, expect, it } from "vitest";
import { indexFlowcharts, indexHeadings, indexImages, renderMarkdown, renderReadableFallback } from "./markdown";
import { resolveAssetPath } from "./paths";

describe("indexImages", () => {
  it("indexes markdown images with source position", () => {
    const content = [
      "# Gallery",
      "",
      "Text before ![Inline alt](./inline.png \"Inline title\") and after.",
      "",
      "![Block image](../assets/block.jpg)",
    ].join("\n");

    expect(indexImages(content, "/Users/demo/docs/readme.md")).toEqual([
      {
        id: "img-0",
        src: "./inline.png",
        alt: "Inline alt",
        title: "Inline title",
        line: 3,
        column: 13,
        absolutePath: "/Users/demo/docs/inline.png",
        status: "pending",
      },
      {
        id: "img-1",
        src: "../assets/block.jpg",
        alt: "Block image",
        title: null,
        line: 5,
        column: 1,
        absolutePath: "/Users/demo/assets/block.jpg",
        status: "pending",
      },
    ]);
  });

  it("also indexes raw html image tags", () => {
    const content = '<p><img src="media/photo.webp" alt="HTML alt" title="HTML title"></p>';

    expect(indexImages(content, "C:\\notes\\doc.md")).toEqual([
      {
        id: "img-0",
        src: "media/photo.webp",
        alt: "HTML alt",
        title: "HTML title",
        line: 1,
        column: 4,
        absolutePath: "C:\\notes\\media\\photo.webp",
        status: "pending",
      },
    ]);
  });
});

describe("indexFlowcharts", () => {
  it("indexes mermaid, flowchart, and plantuml fences with source position", () => {
    const content = [
      "# Charts",
      "",
      "```mermaid",
      "graph TD",
      "A-->B",
      "```",
      "",
      "```flowchart",
      "graph LR",
      "C-->D",
      "```",
      "",
      "```plantuml",
      "@startuml",
      "Alice -> Bob: Hi",
      "@enduml",
      "```",
    ].join("\n");

    expect(indexFlowcharts(content)).toEqual([
      {
        id: "flow-0",
        language: "mermaid",
        code: "graph TD\nA-->B",
        line: 3,
        column: 1,
        previewSrc: null,
      },
      {
        id: "flow-1",
        language: "flowchart",
        code: "graph LR\nC-->D",
        line: 8,
        column: 1,
        previewSrc: null,
      },
      {
        id: "flow-2",
        language: "plantuml",
        code: "@startuml\nAlice -> Bob: Hi\n@enduml",
        line: 13,
        column: 1,
        previewSrc: "https://www.plantuml.com/plantuml/svg/~h407374617274756d6c0a416c696365202d3e20426f623a2048690a40656e64756d6c",
      },
    ]);
  });
});

describe("indexHeadings", () => {
  it("indexes markdown headings with level, text, and source position", () => {
    const content = [
      "# Guide",
      "",
      "Intro",
      "",
      "## Images",
      "",
      "```markdown",
      "# Not a heading",
      "```",
      "",
      "### Nested **Topic**",
    ].join("\n");

    expect(indexHeadings(content)).toEqual([
      {
        id: "heading-0",
        level: 1,
        text: "Guide",
        line: 1,
        column: 1,
      },
      {
        id: "heading-1",
        level: 2,
        text: "Images",
        line: 5,
        column: 1,
      },
      {
        id: "heading-2",
        level: 3,
        text: "Nested Topic",
        line: 11,
        column: 1,
      },
    ]);
  });
});

describe("resolveAssetPath", () => {
  it("keeps remote and data urls unchanged", () => {
    expect(resolveAssetPath("/docs/a.md", "https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(resolveAssetPath("/docs/a.md", "data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("normalizes relative macOS and Windows paths against the document directory", () => {
    expect(resolveAssetPath("/Users/demo/docs/readme.md", "./img/a.png")).toBe("/Users/demo/docs/img/a.png");
    expect(resolveAssetPath("C:\\notes\\deep\\doc.md", "..\\img\\a.png")).toBe("C:\\notes\\img\\a.png");
  });
});

describe("renderMarkdown", () => {
  it("renders extended markdown features used by SuperMD", async () => {
    const html = await renderMarkdown([
      "---",
      "title: Demo",
      "---",
      "",
      "# Heading",
      "",
      "- [x] task",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "$$a^2 + b^2 = c^2$$",
      "",
      "```mermaid",
      "graph TD",
      "A-->B",
      "```",
    ].join("\n"));

    expect(html).toContain("<h1");
    expect(html).toContain("task-list-item");
    expect(html).toContain("<table>");
    expect(html).toContain("katex");
    expect(html).toContain("supermd-flowchart");
    expect(html).toContain("data-flow-tab=\"preview\"");
    expect(html).toContain("data-flow-tab=\"code\"");
    expect(html).toContain("data-flow-panel=\"preview\"");
    expect(html).toContain("data-flow-panel=\"code\"");
    expect(html).not.toContain("title: Demo");
  });

  it("renders flowchart code fences as tabbed preview/code widgets", async () => {
    const html = await renderMarkdown(["```flowchart", "st=>start: Start", "e=>end: End", "st->e", "```"].join("\n"));

    expect(html).toContain("supermd-flowchart");
    expect(html).toContain('data-flow-engine="flowchart"');
    expect(html).toContain("flowchart-render-target");
    expect(html).toContain("flowchart-source");
    expect(html).toContain("<button");
    expect(html).toContain("图片预览");
    expect(html).toContain("代码");
    expect(html).toContain("<pre");
    expect(html).toContain("st=>start: Start");
    expect(html).not.toContain('class="mermaid"');
  });

  it("treats flowchart fences containing Mermaid flowchart syntax as Mermaid diagrams", async () => {
    const html = await renderMarkdown(["```flowchart", "flowchart TD", "A[Start] --> B[End]", "```"].join("\n"));

    expect(html).toContain("supermd-flowchart");
    expect(html).toContain('data-flow-engine="mermaid"');
    expect(html).toContain('class="mermaid"');
    expect(html).not.toContain("flowchart-render-target");
  });

  it("keeps Mermaid html line breaks as diagram source for runtime rendering", async () => {
    const source = [
      "flowchart LR",
      '  FE["前端应用<br/>基于 epaas 前端组件"] --> GW["epaas gateway<br/>统一网关"]',
    ].join("\n");
    const html = await renderMarkdown([
      "```mermaid",
      ...source.split("\n"),
      "```",
    ].join("\n"));

    expect(html).toContain('data-flow-engine="mermaid"');
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('<div class="mermaid"');
    expect(html).toContain(`data-mermaid-source-encoded="${encodeURIComponent(source)}"`);
    expect(html).toContain("supermd-mermaid-placeholder");
    expect(html).not.toContain('<pre class="mermaid"');
    expect(html).not.toContain("flowchart-render-target");
  });

  it("renders PlantUML fences as image-backed tabbed preview widgets", async () => {
    const source = "@startuml\nAlice -> Bob: Hi\n@enduml";
    const html = await renderMarkdown(["```plantuml", ...source.split("\n"), "```"].join("\n"));

    expect(html).toContain("supermd-flowchart");
    expect(html).toContain('data-flow-engine="plantuml"');
    expect(html).toContain('class="supermd-plantuml-image"');
    expect(html).toContain('src="https://www.plantuml.com/plantuml/svg/~h407374617274756d6c0a416c696365202d3e20426f623a2048690a40656e64756d6c"');
    expect(html).toContain('data-plantuml-source-encoded="%40startuml%0AAlice%20-%3E%20Bob%3A%20Hi%0A%40enduml"');
    expect(html).toContain("图片预览");
    expect(html).toContain("代码");
    expect(html).toContain("@startuml");
    expect(html).not.toContain("flowchart-render-target");
    expect(html).not.toContain('class="mermaid"');
  });
});

describe("renderReadableFallback", () => {
  it("returns immediate readable html without waiting for the full renderer", () => {
    const html = renderReadableFallback("# Fast\n\nHello **SuperMD**.\n\n- first\n- second");

    expect(html).toContain("<h1>Fast</h1>");
    expect(html).toContain("<p>Hello <strong>SuperMD</strong>.</p>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
  });

  it("renders tables and fenced code in the immediate fallback", () => {
    const html = renderReadableFallback([
      "| Name | Value |",
      "| --- | ---: |",
      "| Speed | Fast |",
      "",
      "```ts",
      "const ok = true;",
      "```",
    ].join("\n"));

    expect(html).toContain("<table>");
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<td>Fast</td>");
    expect(html).toContain("<pre><code");
    expect(html).toContain("const ok = true;");
  });

  it("renders image syntax in the immediate fallback", () => {
    const html = renderReadableFallback('Logo: ![SuperMD](./assets/logo.png "Brand")');

    expect(html).toContain('<img src="./assets/logo.png" alt="SuperMD" title="Brand" loading="lazy">');
  });

  it("renders ordered lists as separate list items in the immediate fallback", () => {
    const html = renderReadableFallback(["1. First", "2. Second", "3. Third"].join("\n"));

    expect(html).toContain("<ol>");
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<li>Second</li>");
    expect(html).toContain("<li>Third</li>");
    expect(html).not.toContain("<p>1. First 2. Second 3. Third</p>");
  });

  it("renders mermaid fences as tabbed widgets in the immediate fallback", () => {
    const source = "graph TD\nA-->B";
    const html = renderReadableFallback(["```mermaid", ...source.split("\n"), "```"].join("\n"));

    expect(html).toContain("supermd-flowchart");
    expect(html).toContain('data-flow-engine="mermaid"');
    expect(html).toContain(`data-mermaid-source-encoded="${encodeURIComponent(source)}"`);
    expect(html).toContain("supermd-mermaid-placeholder");
    expect(html).toContain("data-flow-tab=\"preview\"");
    expect(html).toContain("data-flow-tab=\"code\"");
  });

  it("renders flowchart.js fences with a dedicated preview target in the immediate fallback", () => {
    const html = renderReadableFallback(["```flowchart", "st=>start: Start", "e=>end: End", "st->e", "```"].join("\n"));

    expect(html).toContain("supermd-flowchart");
    expect(html).toContain('data-flow-engine="flowchart"');
    expect(html).toContain("flowchart-render-target");
    expect(html).toContain("flowchart-source");
    expect(html).not.toContain('class="mermaid"');
  });

  it("renders Mermaid flowchart syntax in flowchart fences with Mermaid in the immediate fallback", () => {
    const html = renderReadableFallback(["```flowchart", "flowchart TD", "A[Start] --> B[End]", "```"].join("\n"));

    expect(html).toContain("supermd-flowchart");
    expect(html).toContain('data-flow-engine="mermaid"');
    expect(html).toContain('class="mermaid"');
    expect(html).not.toContain("flowchart-render-target");
  });

  it("renders PlantUML fences as image previews in the immediate fallback", () => {
    const source = "@startuml\nAlice -> Bob: Hi\n@enduml";
    const html = renderReadableFallback(["```plantuml", ...source.split("\n"), "```"].join("\n"));

    expect(html).toContain("supermd-flowchart");
    expect(html).toContain('data-flow-engine="plantuml"');
    expect(html).toContain("supermd-plantuml-image");
    expect(html).toContain("https://www.plantuml.com/plantuml/svg/~h407374617274756d6c0a416c696365202d3e20426f623a2048690a40656e64756d6c");
    expect(html).toContain("data-flow-tab=\"preview\"");
    expect(html).toContain("data-flow-tab=\"code\"");
  });
});
