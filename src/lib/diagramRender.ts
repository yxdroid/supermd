import { MERMAID_RENDER_CONFIG } from "./diagramConfig";

type MermaidRenderResult = {
  svg: string;
  bindFunctions?: (element: Element) => void;
};

type MermaidRenderer = {
  initialize?: (config: typeof MERMAID_RENDER_CONFIG) => void;
  render?: (id: string, code: string, container?: Element) => Promise<MermaidRenderResult>;
  run?: (options: { nodes?: ArrayLike<HTMLElement>; suppressErrors?: boolean }) => Promise<void>;
};

let mermaidRenderSequence = 0;
const MERMAID_RENDER_TIMEOUT_MS = 3000;

export async function renderMermaidPreviewElements(root: ParentNode, renderer: MermaidRenderer): Promise<void> {
  const previews = root.querySelectorAll<HTMLElement>(".supermd-flowchart[data-flow-engine='mermaid'] .mermaid");
  if (previews.length === 0) {
    return;
  }

  renderer.initialize?.(MERMAID_RENDER_CONFIG);

  await Promise.all([...previews].map((preview) => renderMermaidPreviewElement(preview, renderer)));
}

async function renderMermaidPreviewElement(preview: HTMLElement, renderer: MermaidRenderer): Promise<void> {
  const code = readMermaidSource(preview);
  if (!code) {
    return;
  }

  if (readEncodedDataset(preview.dataset.renderedMermaidEncoded) === code && preview.querySelector(".supermd-mermaid-svg svg")) {
    return;
  }

  preview.dataset.mermaidSource = code;
  preview.dataset.mermaidSourceEncoded = encodeURIComponent(code);
  preview.dataset.flowState = "rendering";

  try {
    await renderWithPrimaryApi(preview, renderer, code);
  } catch (error) {
    try {
      await renderWithRunApiFallback(preview, renderer, code);
    } catch (fallbackError) {
      preview.dataset.flowState = "error";
      preview.dataset.flowError = "true";
      preview.textContent = "Mermaid 预览解析失败";
      console.warn("Mermaid render failed", error, fallbackError);
    }
  }
}

async function renderWithPrimaryApi(preview: HTMLElement, renderer: MermaidRenderer, code: string): Promise<void> {
  if (!renderer.render) {
    throw new Error("Mermaid render API is unavailable");
  }

  const id = `supermd-mermaid-${mermaidRenderSequence += 1}-${hashCode(code)}`;
  const renderRoot = createRenderRoot();
  const renderPromise = renderer.render(id, code, renderRoot).finally(() => {
    renderRoot?.remove();
  });
  const { svg, bindFunctions } = await withTimeout(renderPromise, MERMAID_RENDER_TIMEOUT_MS, "Mermaid render timed out");

  commitRenderedMermaid(preview, code, svg);
  bindFunctions?.(preview);
}

async function renderWithRunApiFallback(preview: HTMLElement, renderer: MermaidRenderer, code: string): Promise<void> {
  if (!renderer.run || typeof XMLSerializer === "undefined") {
    throw new Error("Mermaid run API is unavailable");
  }

  preview.textContent = code;
  await withTimeout(renderer.run({ nodes: [preview], suppressErrors: false }), MERMAID_RENDER_TIMEOUT_MS, "Mermaid run timed out");

  const svgElement = preview.querySelector<SVGElement>("svg");
  if (!svgElement) {
    throw new Error("Mermaid run did not produce SVG");
  }

  commitRenderedMermaid(preview, code, new XMLSerializer().serializeToString(svgElement));
}

function commitRenderedMermaid(preview: HTMLElement, code: string, svg: string): void {
  preview.innerHTML = renderMermaidSvg(svg);
  preview.dataset.renderedMermaid = code;
  preview.dataset.renderedMermaidEncoded = encodeURIComponent(code);
  preview.dataset.flowState = "rendered";
  preview.removeAttribute("data-flow-error");
}

function renderMermaidSvg(svg: string): string {
  return `<div class="supermd-mermaid-svg">${ensureVisibleMermaidEdges(svg)}</div>`;
}

function ensureVisibleMermaidEdges(svg: string): string {
  if (typeof document === "undefined" || typeof XMLSerializer === "undefined") {
    return svg;
  }

  const template = document.createElement("template");
  template.innerHTML = svg.trim();
  const svgElement = template.content.querySelector<SVGSVGElement>("svg");
  if (!svgElement) {
    return svg;
  }

  svgElement.querySelectorAll<SVGElement>(
    [
      "path[data-edge='true']",
      "path[data-et='edge']",
      ".edgePaths path",
      ".edgePath path",
      "path.flowchart-link",
      "path[class*='edge-thickness-']",
      "path[marker-start]",
      "path[marker-mid]",
      "path[marker-end]",
      "path[id^='L_']",
      "path[id*='-L_']",
      "path[class*='messageLine']",
      "path[class*='relation']",
      "path[class*='transition']",
      "line[class*='messageLine']",
      "line[class*='actor-line']",
      "line[class*='relation']",
      "line[class*='transition']",
      "line[marker-start]",
      "line[marker-mid]",
      "line[marker-end]",
      "polyline[class*='messageLine']",
      "polyline[class*='relation']",
      "polyline[class*='transition']",
      "polyline[marker-start]",
      "polyline[marker-mid]",
      "polyline[marker-end]",
    ].join(","),
  ).forEach((edge) => {
    if (edge.classList.contains("edge-thickness-invisible")) {
      return;
    }

    const strokeWidth = edge.classList.contains("edge-thickness-thick") ? "3.5" : "2";
    edge.setAttribute("fill", "none");
    edge.setAttribute("stroke", "#26312f");
    if (!edge.getAttribute("stroke-width")) {
      edge.setAttribute("stroke-width", strokeWidth);
    }
    edge.setAttribute("style", mergeSvgStyle(edge.getAttribute("style"), `fill:none;stroke:#26312f;stroke-width:${strokeWidth};opacity:1;`));
  });

  svgElement.querySelectorAll<SVGElement>("marker .arrowMarkerPath, marker path, marker polygon").forEach((marker) => {
    marker.setAttribute("fill", "#26312f");
    marker.setAttribute("stroke", "#26312f");
  });

  return new XMLSerializer().serializeToString(svgElement);
}

function mergeSvgStyle(current: string | null, fallback: string): string {
  const trimmed = current?.trim();
  if (!trimmed) {
    return fallback;
  }

  return `${trimmed.replace(/;?$/, ";")}${fallback}`;
}

function createRenderRoot(): HTMLElement | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const renderRoot = document.createElement("div");
  renderRoot.setAttribute("data-supermd-mermaid-render-root", "true");
  renderRoot.style.position = "absolute";
  renderRoot.style.left = "-10000px";
  renderRoot.style.top = "0";
  renderRoot.style.overflow = "hidden";
  renderRoot.style.pointerEvents = "none";
  document.body.appendChild(renderRoot);
  return renderRoot;
}

function readMermaidSource(preview: HTMLElement): string {
  return (readEncodedDataset(preview.dataset.mermaidSourceEncoded) ?? preview.dataset.mermaidSource ?? preview.textContent ?? "")
    .trim()
    .replace(/<br\s*\/?>/gi, "<br/>");
}

function readEncodedDataset(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function hashCode(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}
