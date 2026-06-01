import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { resolveAssetPath, isRemoteOrDataUrl } from "./paths";
import type { FlowchartIndexItem, HeadingIndexItem, ImageIndexItem } from "./types";

type MarkdownNode = {
  type: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
  depth?: number;
  value?: string;
  children?: MarkdownNode[];
  position?: {
    start: {
      line: number;
      column: number;
    };
  };
};

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
};

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "details",
    "summary",
    "input",
    "span",
    "button",
    "math",
    "semantics",
    "mrow",
    "mi",
    "mo",
    "mn",
    "annotation",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "className",
      "id",
      "aria-hidden",
      "aria-label",
      "role",
      "title",
      "hidden",
      "data-flow-tab",
      "data-flow-panel",
      "data-flow-engine",
      "data-mermaid-source-encoded",
    ],
    a: [...(defaultSchema.attributes?.a ?? []), "href", "name", "target", "rel"],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "title", "width", "height", "loading"],
    input: ["type", "checked", "disabled"],
    code: ["className"],
    pre: ["className"],
    span: ["className", "style"],
    div: ["className", "data-flow-engine", "data-mermaid-source-encoded"],
    button: ["className", "type", "data-flow-tab", "aria-pressed"],
    table: ["className"],
    th: ["align"],
    td: ["align"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https", "data", "asset", "file"],
  },
};

export function indexImages(content: string, documentPath: string): ImageIndexItem[] {
  const markdownImages: ImageIndexItem[] = [];
  const tree = unified().use(remarkParse).use(remarkGfm).parse(content);

  visit(tree, "image", (node: MarkdownNode) => {
    if (!node.url || !node.position) {
      return;
    }

    markdownImages.push(toImageItem(markdownImages.length, node.url, node.alt ?? "", node.title ?? null, node.position.start.line, node.position.start.column, documentPath));
  });

  const htmlImages = indexHtmlImages(content, documentPath, markdownImages.length);
  return [...markdownImages, ...htmlImages].sort((a, b) => a.line - b.line || a.column - b.column).map((item, index) => ({
    ...item,
    id: `img-${index}`,
  }));
}

export function indexFlowcharts(content: string): FlowchartIndexItem[] {
  const matches = content.matchAll(/^```(mermaid|flowchart)\s*\n([\s\S]*?)\n```/gim);
  return [...matches].map((match, index) => {
    const prefix = content.slice(0, match.index ?? 0);
    const lines = prefix.split("\n");

    return {
      id: `flow-${index}`,
      language: match[1].toLowerCase() as "mermaid" | "flowchart",
      code: match[2],
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
      previewSrc: null,
    };
  });
}

export function indexHeadings(content: string): HeadingIndexItem[] {
  const headings: HeadingIndexItem[] = [];
  const tree = unified().use(remarkParse).use(remarkGfm).parse(content);

  visit(tree, "heading", (node: MarkdownNode) => {
    if (!node.position || !node.depth) {
      return;
    }

    headings.push({
      id: `heading-${headings.length}`,
      level: node.depth,
      text: extractMarkdownText(node).trim(),
      line: node.position.start.line,
      column: node.position.start.column,
    });
  });

  return headings;
}

export async function renderMarkdown(content: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: "wrap" })
    .use(rehypeKatex)
    .use(rehypeHighlight, { detect: false })
    .use(rehypeMermaidBlocks)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(content);

  return String(file);
}

export function renderReadableFallback(content: string): string {
  const lines = content.split(/\r?\n/);
  const html: string[] = [];
  let activeList: "ul" | "ol" | null = null;
  let paragraph: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  const closeParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    html.push(`<p>${escapeInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!activeList) {
      return;
    }
    html.push(`</${activeList}>`);
    activeList = null;
  };

  const openList = (kind: "ul" | "ol") => {
    if (activeList === kind) {
      return;
    }
    closeList();
    html.push(`<${kind}>`);
    activeList = kind;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    const fence = trimmed.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fence) {
      if (inCode) {
        html.push(renderCodeBlock(codeLines.join("\n"), codeLang));
        inCode = false;
        codeLang = "";
        codeLines = [];
      } else {
        closeParagraph();
        closeList();
        inCode = true;
        codeLang = fence[1] ?? "";
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      closeParagraph();
      closeList();
      continue;
    }

    if (isTableStart(lines, index)) {
      closeParagraph();
      closeList();
      const table = readTable(lines, index);
      html.push(table.html);
      index += table.consumed - 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      closeParagraph();
      closeList();
      html.push(`<blockquote><p>${escapeInline(quote[1])}</p></blockquote>`);
      continue;
    }

    const listItem = trimmed.match(/^[-*+]\s+(\[[ xX]\]\s+)?(.+)$/);
    if (listItem) {
      closeParagraph();
      openList("ul");
      const checked = listItem[1]?.toLowerCase().includes("x") ?? false;
      const checkbox = listItem[1] ? `<input type="checkbox" disabled${checked ? " checked" : ""}> ` : "";
      html.push(`<li>${checkbox}${escapeInline(listItem[2])}</li>`);
      continue;
    }

    const orderedItem = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (orderedItem) {
      closeParagraph();
      openList("ol");
      html.push(`<li>${escapeInline(orderedItem[1])}</li>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  closeParagraph();
  closeList();
  if (inCode) {
    html.push(renderCodeBlock(codeLines.join("\n"), codeLang));
  }

  return html.join("");
}

function rehypeMermaidBlocks() {
  return (tree: HastNode) => {
    visit(tree, "element", (node: HastNode) => {
      if (node.tagName !== "pre") {
        return;
      }

      const code = node.children?.[0];
      const className = code?.properties?.className;
      const preClassName = node.properties?.className;
      const classes = [
        ...(Array.isArray(className) ? className : typeof className === "string" ? [className] : []),
        ...(Array.isArray(preClassName) ? preClassName : typeof preClassName === "string" ? [preClassName] : []),
      ];

      if (code?.tagName !== "code") {
        return;
      }

      const codeText = textContent(code);
      const language = diagramLanguageFromClasses(classes, codeText);
      if (language) {
        node.tagName = "div";
        node.properties = { className: ["supermd-flowchart"], "data-flow-engine": language };
        node.children = flowchartChildren(codeText, language);
      }
    });
  };
}

function renderCodeBlock(code: string, lang: string): string {
  const language = toDiagramLanguage(lang, code);
  if (language) {
    return [
      `<div class="supermd-flowchart" data-flow-engine="${language}">`,
      '<div class="supermd-flow-tabs">',
      '<button type="button" class="active" data-flow-tab="preview" aria-pressed="true">图片预览</button>',
      '<button type="button" data-flow-tab="code" aria-pressed="false">代码</button>',
      "</div>",
      '<div class="supermd-flow-panel" data-flow-panel="preview">',
      renderDiagramPreview(code, language),
      "</div>",
      '<div class="supermd-flow-panel" data-flow-panel="code" hidden>',
      `<pre><code class="language-text">${escapeHtml(code)}</code></pre>`,
      "</div>",
      "</div>",
    ].join("");
  }

  return `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(code)}</code></pre>`;
}

function flowchartChildren(code: string, language: "mermaid" | "flowchart"): HastNode[] {
  return [
    {
      type: "element",
      tagName: "div",
      properties: { className: ["supermd-flow-tabs"] },
      children: [
        {
          type: "element",
          tagName: "button",
          properties: { type: "button", className: ["active"], "data-flow-tab": "preview", "aria-pressed": "true" },
          children: [{ type: "text", value: "图片预览" }],
        },
        {
          type: "element",
          tagName: "button",
          properties: { type: "button", "data-flow-tab": "code", "aria-pressed": "false" },
          children: [{ type: "text", value: "代码" }],
        },
      ],
    },
    {
      type: "element",
      tagName: "div",
      properties: { className: ["supermd-flow-panel"], "data-flow-panel": "preview" },
      children: diagramPreviewChildren(code, language),
    },
    {
      type: "element",
      tagName: "div",
      properties: { className: ["supermd-flow-panel"], "data-flow-panel": "code", hidden: true },
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: { className: ["language-text"] },
              children: [{ type: "text", value: code }],
            },
          ],
        },
      ],
    },
  ];
}

function renderDiagramPreview(code: string, language: "mermaid" | "flowchart"): string {
  if (language === "mermaid") {
    return [
      `<div class="mermaid" data-flow-engine="mermaid" data-mermaid-source-encoded="${escapeHtml(encodeURIComponent(normalizeMermaidSource(code)))}">`,
      '<div class="supermd-mermaid-placeholder">正在生成 Mermaid 预览</div>',
      "</div>",
    ].join("");
  }

  return [
    '<div class="flowchart-render-target" data-flow-engine="flowchart"></div>',
    `<pre class="flowchart-source" hidden>${escapeHtml(code)}</pre>`,
  ].join("");
}

function diagramPreviewChildren(code: string, language: "mermaid" | "flowchart"): HastNode[] {
  if (language === "mermaid") {
    return [
      {
        type: "element",
        tagName: "div",
        properties: {
          className: ["mermaid"],
          "data-flow-engine": "mermaid",
          "data-mermaid-source-encoded": encodeURIComponent(normalizeMermaidSource(code)),
        },
        children: [
          {
            type: "element",
            tagName: "div",
            properties: { className: ["supermd-mermaid-placeholder"] },
            children: [{ type: "text", value: "正在生成 Mermaid 预览" }],
          },
        ],
      },
    ];
  }

  return [
    {
      type: "element",
      tagName: "div",
      properties: { className: ["flowchart-render-target"], "data-flow-engine": "flowchart" },
      children: [],
    },
    {
      type: "element",
      tagName: "pre",
      properties: { className: ["flowchart-source"], hidden: true },
      children: [{ type: "text", value: code }],
    },
  ];
}

function diagramLanguageFromClasses(classes: string[], code: string): "mermaid" | "flowchart" | null {
  if (classes.some((name) => name === "language-flowchart")) {
    return isMermaidDiagramCode(code) ? "mermaid" : "flowchart";
  }

  if (classes.some((name) => name === "language-mermaid" || name === "mermaid")) {
    return "mermaid";
  }

  return null;
}

function toDiagramLanguage(lang: string, code: string): "mermaid" | "flowchart" | null {
  const normalized = lang.toLowerCase();
  if (normalized === "mermaid") {
    return "mermaid";
  }

  if (normalized === "flowchart") {
    return isMermaidDiagramCode(code) ? "mermaid" : "flowchart";
  }

  return null;
}

function isMermaidDiagramCode(code: string): boolean {
  const firstMeaningfulLine = code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("%%"));

  if (!firstMeaningfulLine) {
    return false;
  }

  return /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|block-beta|packet-beta|architecture-beta)\b/i.test(firstMeaningfulLine);
}

function textContent(node: HastNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }

  return node.children?.map((child) => textContent(child)).join("") ?? "";
}

function extractMarkdownText(node: MarkdownNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }

  return node.children?.map((child) => extractMarkdownText(child)).join("") ?? "";
}

function normalizeMermaidSource(code: string): string {
  return code.trim().replace(/<br\s*\/?>/gi, "<br/>");
}

function indexHtmlImages(content: string, documentPath: string, offset: number): ImageIndexItem[] {
  const matches = content.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi);
  const items: ImageIndexItem[] = [];

  for (const match of matches) {
    const rawTag = match[0];
    const src = match[1];
    const absoluteIndex = match.index ?? 0;
    const position = positionFromIndex(content, absoluteIndex);

    items.push(toImageItem(offset + items.length, src, readHtmlAttribute(rawTag, "alt") ?? "", readHtmlAttribute(rawTag, "title"), position.line, position.column, documentPath));
  }

  return items;
}

function readHtmlAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ?? null;
}

function positionFromIndex(content: string, index: number): { line: number; column: number } {
  const prefix = content.slice(0, index);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function toImageItem(index: number, src: string, alt: string, title: string | null, line: number, column: number, documentPath: string): ImageIndexItem {
  return {
    id: `img-${index}`,
    src,
    alt,
    title,
    line,
    column,
    absolutePath: resolveAssetPath(documentPath, src),
    status: isRemoteOrDataUrl(src) ? "remote" : "pending",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeInline(value: string): string {
  const imageTokens: string[] = [];
  const withImageTokens = value.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, (_match, alt: string, src: string, title: string | undefined) => {
    const token = `@@SUPERMD_IMAGE_${imageTokens.length}@@`;
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    imageTokens.push(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy">`);
    return token;
  });

  let escaped = escapeHtml(withImageTokens)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  imageTokens.forEach((image, index) => {
    escaped = escaped.replace(`@@SUPERMD_IMAGE_${index}@@`, image);
  });

  return escaped;
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index]?.trim() ?? "";
  const separator = lines[index + 1]?.trim() ?? "";
  return header.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator);
}

function readTable(lines: string[], start: number): { html: string; consumed: number } {
  const header = splitTableRow(lines[start]);
  let cursor = start + 2;
  const rows: string[][] = [];

  while (cursor < lines.length && lines[cursor].trim().includes("|") && lines[cursor].trim() !== "") {
    rows.push(splitTableRow(lines[cursor]));
    cursor += 1;
  }

  const head = `<thead><tr>${header.map((cell) => `<th>${escapeInline(cell)}</th>`).join("")}</tr></thead>`;
  const body = rows.length > 0
    ? `<tbody>${rows.map((row) => `<tr>${header.map((_, index) => `<td>${escapeInline(row[index] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`
    : "";

  return {
    html: `<table>${head}${body}</table>`,
    consumed: cursor - start,
  };
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
