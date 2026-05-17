import { FileText, FolderOpen, Image, PanelRightClose, PanelRightOpen, Save, SquarePen } from "lucide-react";
import mermaid from "mermaid";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent, WheelEvent } from "react";
import { indexFlowcharts, indexImages, renderMarkdown, renderReadableFallback } from "./lib/markdown";
import { renderMermaidPreviewElements } from "./lib/diagramRender";
import { DEFAULT_IMAGE_VIEW, panImageView, resetImageView, zoomImageView } from "./lib/imageViewer";
import type { ImageView } from "./lib/imageViewer";
import { basename, isRemoteOrDataUrl, resolveAssetPath } from "./lib/paths";
import { sanitizePreviewHtml } from "./lib/sanitize";
import { scrollRatio, scrollTopForRatio } from "./lib/scrollSync";
import {
  getRecentFiles,
  listenForOpenedMarkdownFiles,
  openMarkdownFile,
  pickMarkdownPath,
  runningInTauri,
  saveMarkdownFile,
  takePendingOpenFiles,
  toDisplayableAsset,
} from "./lib/tauriClient";
import type { SourceEditorHandle } from "./components/SourceEditor";
import type { DocumentPayload, FlowchartIndexItem, ImageIndexItem, RecentFile, RenderState } from "./lib/types";
import type { MarkdownWorkerResponse } from "./workers/markdown.worker";
import MarkdownWorker from "./workers/markdown.worker?worker&inline";

const SourceEditor = lazy(() => import("./components/SourceEditor").then((module) => ({ default: module.SourceEditor })));

const EMPTY_DOC: DocumentPayload = {
  path: "",
  content: [
    "# SuperMD",
    "",
    "打开一个 Markdown 文档开始阅读。",
    "",
    "- 支持 GFM、数学公式、Mermaid 和本地图片",
    "- 右下角图片按钮会在文档包含图片时亮起",
  ].join("\n"),
  size: 0,
  mtime: Date.now(),
  encoding: "utf-8",
};

function App() {
  const [documentPayload, setDocumentPayload] = useState<DocumentPayload>(EMPTY_DOC);
  const [content, setContent] = useState(EMPTY_DOC.content);
  const [html, setHtml] = useState("");
  const [images, setImages] = useState<ImageIndexItem[]>([]);
  const [flowcharts, setFlowcharts] = useState<FlowchartIndexItem[]>([]);
  const [renderState, setRenderState] = useState<RenderState>("loading");
  const [renderMs, setRenderMs] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitialScrollRatio, setEditorInitialScrollRatio] = useState(0);
  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ line: number; column: number } | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [browserAssetUrls, setBrowserAssetUrls] = useState<Map<string, string>>(new Map());
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [imageView, setImageView] = useState<ImageView>(DEFAULT_IMAGE_VIEW);
  const [imageDragging, setImageDragging] = useState(false);
  const [status, setStatus] = useState("就绪");
  const previewPaneRef = useRef<HTMLElement | null>(null);
  const sourceEditorRef = useRef<SourceEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const browserAssetUrlsRef = useRef(browserAssetUrls);
  const workerRef = useRef<Worker | null>(null);
  const workerFailedRef = useRef(false);
  const renderVersionRef = useRef(0);
  const contentRef = useRef(content);
  const documentPathRef = useRef(documentPayload.path || "/supermd/untitled.md");
  const scrollOriginRef = useRef<"preview" | "editor" | null>(null);
  const scrollResetTimerRef = useRef<number | null>(null);
  const previewSyncFrameRef = useRef<number | null>(null);
  const previewRenderTimerRef = useRef<number | null>(null);
  const previewFallbackTimerRef = useRef<number | null>(null);
  const lastPreviewRatioRef = useRef(-1);
  const editorRenderAnchorRef = useRef<{ ratio: number; timer: number | null } | null>(null);
  const preservePreviewOnNextRenderRef = useRef(false);
  const imageDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startView: ImageView;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (previewSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(previewSyncFrameRef.current);
      }
      if (previewRenderTimerRef.current !== null) {
        window.clearTimeout(previewRenderTimerRef.current);
      }
      if (previewFallbackTimerRef.current !== null) {
        window.clearTimeout(previewFallbackTimerRef.current);
      }
      if (scrollResetTimerRef.current !== null) {
        window.clearTimeout(scrollResetTimerRef.current);
      }
      if (editorRenderAnchorRef.current?.timer != null) {
        window.clearTimeout(editorRenderAnchorRef.current.timer);
      }
    };
  }, []);

  useEffect(() => {
    browserAssetUrlsRef.current = browserAssetUrls;
  }, [browserAssetUrls]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    documentPathRef.current = documentPayload.path || "/supermd/untitled.md";
  }, [documentPayload.path]);

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) {
      return;
    }
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    return () => {
      browserAssetUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [browserAssetUrls]);

  useEffect(() => {
    getRecentFiles().then(setRecentFiles).catch(() => setRecentFiles([]));
  }, []);

  useEffect(() => {
    if (!runningInTauri()) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function openSystemRequestedFile(paths: string[]) {
      const uniquePaths = Array.from(new Set(paths)).filter(isMarkdownPath);
      const path = uniquePaths[0];
      if (!path) {
        return;
      }

      try {
        await loadFromPath(path);
      } catch (error) {
        setStatus(error instanceof Error ? `打开失败：${error.message}` : "打开失败");
      }
    }

    async function subscribeToSystemOpenEvents() {
      unlisten = await listenForOpenedMarkdownFiles(async (paths) => {
        const pending = await takePendingOpenFiles().catch(() => []);
        if (!cancelled) {
          await openSystemRequestedFile([...paths, ...pending]);
        }
      });

      const pending = await takePendingOpenFiles().catch(() => []);
      if (!cancelled) {
        await openSystemRequestedFile(pending);
      }
    }

    subscribeToSystemOpenEvents().catch((error) => {
      if (!cancelled) {
        setStatus(error instanceof Error ? `监听打开事件失败：${error.message}` : "监听打开事件失败");
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    workerRef.current = new MarkdownWorker();
    workerRef.current.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
      if (event.data.version !== renderVersionRef.current) {
        return;
      }

      if (previewFallbackTimerRef.current !== null) {
        window.clearTimeout(previewFallbackTimerRef.current);
        previewFallbackTimerRef.current = null;
      }
      setImages(event.data.images);
      const nextHtml = rewriteImageSources(event.data.html, event.data.images);
      setHtml((current) => (current === nextHtml ? current : nextHtml));
      setRenderMs(event.data.renderMs);
      setRenderState("enhanced");
    };
    workerRef.current.onerror = (event) => {
      console.error("Markdown worker failed", event);
      workerFailedRef.current = true;
      setStatus("已切换主线程渲染");
      renderEnhancedInMainThread(renderVersionRef.current, contentRef.current, documentPathRef.current).catch((error) => {
        console.error("Main-thread Markdown render failed", error);
        setRenderState("error");
        setStatus("已使用基础预览");
      });
    };

    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    const version = renderVersionRef.current + 1;
    renderVersionRef.current = version;
    const documentPath = documentPayload.path || "/supermd/untitled.md";
    const quickImages = indexImagesQuick(content, documentPath);
    const shouldPreservePreview = preservePreviewOnNextRenderRef.current && Boolean(html) && Boolean(workerRef.current);
    preservePreviewOnNextRenderRef.current = false;

    if (previewRenderTimerRef.current !== null) {
      window.clearTimeout(previewRenderTimerRef.current);
      previewRenderTimerRef.current = null;
    }
    if (previewFallbackTimerRef.current !== null) {
      window.clearTimeout(previewFallbackTimerRef.current);
      previewFallbackTimerRef.current = null;
    }

    setFlowcharts(indexFlowcharts(content));
    setImages(quickImages);

    const renderRequest = {
      version,
      content,
      documentPath,
    };

    if (shouldPreservePreview) {
      previewRenderTimerRef.current = window.setTimeout(() => {
        previewRenderTimerRef.current = null;
        if (workerFailedRef.current) {
          renderEnhancedInMainThread(version, content, documentPath).catch(() => undefined);
        } else {
          workerRef.current?.postMessage(renderRequest);
        }
        previewFallbackTimerRef.current = window.setTimeout(() => {
          if (version !== renderVersionRef.current) {
            return;
          }

          setRenderState("readable");
          const fallbackHtml = rewriteImageSources(renderReadableFallback(content), quickImages);
          setHtml((current) => (current === fallbackHtml ? current : fallbackHtml));
          previewFallbackTimerRef.current = null;
        }, 650);
      }, 180);
      return;
    }

    setRenderState("readable");
    const fallbackHtml = rewriteImageSources(renderReadableFallback(content), quickImages);
    setHtml((current) => (current === fallbackHtml ? current : fallbackHtml));
    if (workerFailedRef.current) {
      renderEnhancedInMainThread(version, content, documentPath).catch(() => undefined);
      return;
    }

    workerRef.current?.postMessage(renderRequest);
  }, [content, documentPayload.path]);

  useEffect(() => {
    if (!html) {
      return;
    }

    scheduleDiagramRender();
  }, [html, editorOpen, imagePanelOpen]);

  const title = useMemo(() => documentPayload.path ? basename(documentPayload.path) : "未打开文档", [documentPayload.path]);
  const renderedHtml = useMemo(() => sanitizePreviewHtml(html), [html]);

  useLayoutEffect(() => {
    const anchor = editorRenderAnchorRef.current;
    const pane = previewPaneRef.current;
    if (!editorOpen || !anchor || !pane) {
      return;
    }

    markScrollOrigin("editor");
    pane.scrollTop = scrollTopForRatio(pane, anchor.ratio);
    lastPreviewRatioRef.current = scrollRatio(pane);
    if (anchor.timer != null) {
      window.clearTimeout(anchor.timer);
    }
    anchor.timer = window.setTimeout(() => {
      editorRenderAnchorRef.current = null;
    }, 120);
  }, [renderedHtml, editorOpen]);

  async function handleOpen() {
    const path = await pickMarkdownPath();
    if (!path) {
      folderInputRef.current?.click();
      return;
    }
    await loadFromPath(path);
  }

  async function loadFromPath(path: string) {
    setStatus("读取中");
    const opened = await openMarkdownFile(path);
    preservePreviewOnNextRenderRef.current = false;
    setDocumentPayload(opened);
    setContent(opened.content);
    setDirty(false);
    setEditorOpen(false);
    setImagePanelOpen(false);
    setStatus("已打开");
    getRecentFiles().then(setRecentFiles).catch(() => undefined);
  }

  async function renderEnhancedInMainThread(version: number, rawContent: string, documentPath: string) {
    const started = performance.now();
    const [nextHtml, nextImages] = await Promise.all([
      renderMarkdown(rawContent),
      Promise.resolve(indexImages(rawContent, documentPath)),
    ]);

    if (version !== renderVersionRef.current) {
      return;
    }

    if (previewFallbackTimerRef.current !== null) {
      window.clearTimeout(previewFallbackTimerRef.current);
      previewFallbackTimerRef.current = null;
    }
    setImages(nextImages);
    const displayHtml = rewriteImageSources(nextHtml, nextImages);
    setHtml((current) => (current === displayHtml ? current : displayHtml));
    setRenderMs(Math.round(performance.now() - started));
    setRenderState("enhanced");
  }

  async function handleBrowserFile(file: File | null) {
    if (!file) {
      return;
    }

    const text = await file.text();
    const path = readWebkitRelativePath(file) || file.name;
    replaceBrowserAssetUrls(new Map([[normalizeBrowserPath(path), URL.createObjectURL(file)]]));
    preservePreviewOnNextRenderRef.current = false;
    setDocumentPayload({
      path,
      content: text,
      size: file.size,
      mtime: file.lastModified,
      encoding: "utf-8",
    });
    setContent(text);
    setDirty(false);
    setStatus("浏览器预览");
  }

  async function handleBrowserFolder(files: FileList | null) {
    const fileArray = Array.from(files ?? []);
    if (fileArray.length === 0) {
      return;
    }

    const markdownFile = fileArray.find((file) => /\.(md|markdown|mdown|mkd)$/i.test(file.name));
    if (!markdownFile) {
      setStatus("文件夹中未找到 Markdown");
      return;
    }

    const urls = new Map<string, string>();
    for (const file of fileArray) {
      const path = readWebkitRelativePath(file) || file.name;
      urls.set(normalizeBrowserPath(path), URL.createObjectURL(file));
    }
    replaceBrowserAssetUrls(urls);

    const text = await markdownFile.text();
    preservePreviewOnNextRenderRef.current = false;
    setDocumentPayload({
      path: readWebkitRelativePath(markdownFile) || markdownFile.name,
      content: text,
      size: markdownFile.size,
      mtime: markdownFile.lastModified,
      encoding: "utf-8",
    });
    setContent(text);
    setDirty(false);
    setStatus(`浏览器文件夹预览：${fileArray.length} 个文件`);
  }

  async function handleSave() {
    if (!documentPayload.path) {
      setStatus("需要先打开本地文件");
      return;
    }

    setStatus("保存中");
    const result = await saveMarkdownFile(documentPayload.path, content);
    setDocumentPayload((current) => ({ ...current, size: result.size, mtime: result.savedAt, content }));
    setDirty(false);
    setStatus("已保存");
  }

  function handleImageClick(image: ImageIndexItem, index: number) {
    scrollPreviewImageIntoView(image, index);
    openLightbox(displayAssetUrl(image), image.alt || image.src || "图片预览");
  }

  function handleFlowchartClick(flowchart: FlowchartIndexItem, index: number) {
    scrollPreviewFlowchartIntoView(index);
    if (flowchart.previewSrc) {
      openLightbox(flowchart.previewSrc, `${flowchart.language} 预览`);
    }
  }

  function openLightbox(src: string, alt: string) {
    setImageView(resetImageView());
    setImageDragging(false);
    imageDragRef.current = null;
    setLightbox({ src, alt });
  }

  function closeLightbox() {
    setLightbox(null);
    setImageView(resetImageView());
    setImageDragging(false);
    imageDragRef.current = null;
  }

  function scrollPreviewImageIntoView(image: ImageIndexItem, index: number) {
    const pane = previewPaneRef.current;
    if (!pane) {
      return;
    }

    const expectedSrc = displayAssetUrl(image);
    const previewImages = [...pane.querySelectorAll<HTMLImageElement>(".supermd-preview img")];
    const target = previewImages.find((previewImage) => (
      previewImage.getAttribute("src") === expectedSrc
      || previewImage.currentSrc === expectedSrc
      || previewImage.src === expectedSrc
    )) ?? previewImages[index];

    scrollPreviewElementIntoView(target);
  }

  function scrollPreviewFlowchartIntoView(index: number) {
    const pane = previewPaneRef.current;
    if (!pane) {
      return;
    }

    const target = pane.querySelectorAll<HTMLElement>(".supermd-preview .supermd-flowchart")[index] ?? null;
    scrollPreviewElementIntoView(target);
  }

  function scrollPreviewElementIntoView(target: Element | null) {
    const pane = previewPaneRef.current;
    if (!pane || !target) {
      return;
    }

    const paneRect = pane.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const centeredTop = pane.scrollTop + targetRect.top - paneRect.top - ((pane.clientHeight - targetRect.height) / 2);

    pane.scrollTo({
      top: Math.max(0, centeredTop),
      behavior: "smooth",
    });
  }

  function rewriteImageSources(rawHtml: string, indexedImages: ImageIndexItem[]): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");
    const candidates = [...indexedImages];

    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      const match = candidates.find((item) => item.src === src);
      if (!match) {
        return;
      }

      img.setAttribute("src", displayAssetUrl(match));
      img.setAttribute("loading", "lazy");
    });

    return doc.body.innerHTML;
  }

  function indexImagesQuick(rawContent: string, documentPath: string): ImageIndexItem[] {
    const matches = rawContent.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g);
    return [...matches].map((match, index) => {
      const prefix = rawContent.slice(0, match.index ?? 0);
      const lines = prefix.split("\n");
      const src = match[2];
      return {
        id: `img-${index}`,
        src,
        alt: match[1],
        title: null,
        line: lines.length,
        column: lines[lines.length - 1].length + 1,
        absolutePath: resolveAssetPath(documentPath, src),
        status: isRemoteOrDataUrl(src) ? "remote" : "pending",
      };
    });
  }

  function displayAssetUrl(image: ImageIndexItem): string {
    if (image.status === "remote") {
      return image.absolutePath;
    }

    if (!runningInTauri()) {
      const urls = browserAssetUrlsRef.current;
      return urls.get(normalizeBrowserPath(image.absolutePath))
        ?? urls.get(normalizeBrowserPath(image.src))
        ?? image.src;
    }

    return toDisplayableAsset(image.absolutePath, false);
  }

  function replaceBrowserAssetUrls(next: Map<string, string>) {
    setBrowserAssetUrls((current) => {
      current.forEach((url) => URL.revokeObjectURL(url));
      return next;
    });
  }

  function markScrollOrigin(origin: "preview" | "editor") {
    scrollOriginRef.current = origin;
    if (scrollResetTimerRef.current !== null) {
      window.clearTimeout(scrollResetTimerRef.current);
    }
    scrollResetTimerRef.current = window.setTimeout(() => {
      if (scrollOriginRef.current === origin) {
        scrollOriginRef.current = null;
      }
    }, 90);
  }

  function anchorPreviewToEditorRender() {
    if (!editorOpen) {
      return;
    }

    const ratio = sourceEditorRef.current?.getScrollRatio() ?? 0;
    if (editorRenderAnchorRef.current?.timer != null) {
      window.clearTimeout(editorRenderAnchorRef.current.timer);
    }

    editorRenderAnchorRef.current = {
      ratio,
      timer: window.setTimeout(() => {
        editorRenderAnchorRef.current = null;
      }, 800),
    };
    markScrollOrigin("editor");
  }

  function handlePreviewScroll() {
    if (!editorOpen || scrollOriginRef.current === "editor" || editorRenderAnchorRef.current) {
      return;
    }

    const pane = previewPaneRef.current;
    if (!pane) {
      return;
    }

    markScrollOrigin("preview");

    if (previewSyncFrameRef.current !== null) {
      return;
    }

    previewSyncFrameRef.current = window.requestAnimationFrame(() => {
      previewSyncFrameRef.current = null;
      const nextRatio = scrollRatio(pane);
      if (Math.abs(nextRatio - lastPreviewRatioRef.current) < 0.002) {
        return;
      }

      lastPreviewRatioRef.current = nextRatio;
      sourceEditorRef.current?.scrollToRatio(nextRatio);
    });
  }

  function handleEditorScroll(ratio: number) {
    if (scrollOriginRef.current === "preview") {
      return;
    }

    const pane = previewPaneRef.current;
    if (!pane) {
      return;
    }

    markScrollOrigin("editor");
    pane.scrollTop = scrollTopForRatio(pane, ratio);
  }

  function handleToggleEditor() {
    if (editorOpen) {
      setEditorOpen(false);
      return;
    }

    const ratio = previewPaneRef.current ? scrollRatio(previewPaneRef.current) : 0;
    setEditorInitialScrollRatio(ratio);
    lastPreviewRatioRef.current = ratio;
    setEditorOpen(true);
  }

  function handleEditorChange(next: string) {
    anchorPreviewToEditorRender();
    preservePreviewOnNextRenderRef.current = true;
    setContent(next);
    setDirty(next !== documentPayload.content);
  }

  function handlePreviewClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const tab = target.closest<HTMLButtonElement>("[data-flow-tab]");
    if (tab) {
      const flowchart = tab.closest<HTMLElement>(".supermd-flowchart");
      const mode = tab.dataset.flowTab;
      if (!flowchart || !mode) {
        return;
      }

      flowchart.querySelectorAll<HTMLButtonElement>("[data-flow-tab]").forEach((button) => {
        const active = button.dataset.flowTab === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });

      flowchart.querySelectorAll<HTMLElement>("[data-flow-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.flowPanel !== mode;
      });

      if (mode === "preview") {
        scheduleDiagramRender();
      }
      return;
    }

    const image = target.closest<HTMLImageElement>(".supermd-preview img");
    if (image?.src) {
      openLightbox(image.src, image.alt || "图片预览");
      return;
    }

    const flowSvg = target.closest<SVGElement>(".supermd-flow-panel[data-flow-panel='preview'] svg");
    if (flowSvg) {
      const svg = new XMLSerializer().serializeToString(flowSvg);
      openLightbox(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, "Flowchart 预览");
    }
  }

  function handleLightboxWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    setImageView((current) => zoomImageView(current, event.deltaY, {
      x: event.clientX - rect.left - (rect.width / 2),
      y: event.clientY - rect.top - (rect.height / 2),
    }));
  }

  function handleLightboxPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target === event.currentTarget) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startView: imageView,
    };
    setImageDragging(imageView.scale > 1);
  }

  function handleLightboxPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = imageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setImageView(panImageView(drag.startView, event.clientX - drag.startX, event.clientY - drag.startY));
  }

  function handleLightboxPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = imageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    imageDragRef.current = null;
    setImageDragging(false);
  }

  function scheduleDiagramRender() {
    window.requestAnimationFrame(() => {
      Promise.allSettled([
        renderMermaidDiagrams(),
        renderFlowchartJsDiagrams(),
      ]).then((results) => {
        results.forEach((result) => {
          if (result.status === "rejected") {
            console.warn("Diagram render failed", result.reason);
          }
        });
        normalizeFlowchartSvgs();
      });
    });
  }

  async function renderMermaidDiagrams() {
    const previewPane = previewPaneRef.current;
    if (!previewPane?.querySelector(".supermd-flowchart[data-flow-engine='mermaid'] .mermaid")) {
      return;
    }

    await renderMermaidPreviewElements(previewPane, mermaid);
  }

  async function renderFlowchartJsDiagrams() {
    const widgets = previewPaneRef.current?.querySelectorAll<HTMLElement>(".supermd-flowchart[data-flow-engine='flowchart']");
    if (!widgets?.length) {
      return;
    }

    const flowchartModule = await import("flowchart.js");
    const flowchart = ("default" in flowchartModule ? flowchartModule.default : flowchartModule) as typeof import("flowchart.js");

    widgets.forEach((widget) => {
      const target = widget.querySelector<HTMLElement>(".flowchart-render-target");
      const source = widget.querySelector<HTMLElement>(".flowchart-source");
      const code = source?.textContent?.trim() ?? "";

      if (!target || !code) {
        return;
      }

      if (target.dataset.renderedFlowchart === code && target.querySelector("svg")) {
        return;
      }

      try {
        target.textContent = "";
        flowchart.parse(code).drawSVG(target, {
          "line-width": 2,
          "line-length": 52,
          "text-margin": 10,
          "font-size": 14,
          "font-color": "#26312f",
          "line-color": "#1b6b64",
          "element-color": "#1b6b64",
          fill: "#fffdf7",
          "arrow-end": "block",
          scale: 1,
        });
        target.dataset.renderedFlowchart = code;
        target.removeAttribute("data-flow-error");
      } catch (error) {
        target.dataset.flowError = "true";
        target.textContent = "Flowchart 预览解析失败";
        console.warn("Flowchart render failed", error);
      }
    });
  }

  function normalizeFlowchartSvgs() {
    const nextPreviewSrc = new Map<string, string>();
    const previewRoot = previewPaneRef.current?.querySelector<HTMLElement>(".supermd-preview");
    previewPaneRef.current?.querySelectorAll<HTMLElement>(".supermd-flowchart").forEach((flowchart, index) => {
      const svg = flowchart.querySelector<SVGElement>("svg");
      if (!svg) {
        return;
      }

      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.maxWidth = "100%";
      svg.style.width = "100%";
      svg.style.height = "auto";
      svg.style.display = "block";

      const serialized = new XMLSerializer().serializeToString(svg);
      nextPreviewSrc.set(`flow-${index}`, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`);
    });

    if (nextPreviewSrc.size > 0) {
      const renderedPreviewHtml = previewRoot?.innerHTML;
      if (renderedPreviewHtml?.includes("supermd-mermaid-svg")) {
        setHtml((current) => (current === renderedPreviewHtml ? current : renderedPreviewHtml));
      }

      setFlowcharts((current) => {
        let changed = false;
        const next = current.map((item) => {
          const previewSrc = nextPreviewSrc.get(item.id);
          if (!previewSrc || previewSrc === item.previewSrc) {
            return item;
          }

          changed = true;
          return {
            ...item,
            previewSrc,
          };
        });

        return changed ? next : current;
      });
    }
  }

  const imagePanelCount = images.length + flowcharts.length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="document-title">
          <FileText size={18} aria-hidden />
          <div>
            <strong>{title}</strong>
            <span>{documentPayload.path || "SuperMD"}</span>
          </div>
        </div>

        <div className="toolbar" aria-label="文档操作">
          <button type="button" className="icon-button" title="打开" onClick={handleOpen}>
            <FolderOpen size={18} />
          </button>
          <button type="button" className="icon-button" title="保存" onClick={handleSave} disabled={!dirty}>
            <Save size={18} />
          </button>
          <button type="button" className="icon-button" title="源码" onClick={handleToggleEditor}>
            <SquarePen size={18} />
          </button>
          <button type="button" className="icon-button" title="图片" onClick={() => setImagePanelOpen((open) => !open)}>
            {imagePanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>

        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept=".md,.markdown,.mdown,.mkd,text/markdown,text/plain"
          onChange={(event) => handleBrowserFile(event.target.files?.[0] ?? null)}
        />
        <input
          ref={folderInputRef}
          className="hidden-input"
          type="file"
          multiple
          onChange={(event) => handleBrowserFolder(event.target.files)}
        />
      </header>

      <section className={`workspace ${editorOpen ? "with-editor" : ""} ${imagePanelOpen ? "with-images" : ""}`}>
        <article className="preview-pane" ref={previewPaneRef} onScroll={handlePreviewScroll} onClick={handlePreviewClick}>
          <div className="preview-meta">
            <span>{renderState === "enhanced" ? `渲染 ${renderMs}ms` : "渲染中"}</span>
            <span>{dirty ? "未保存" : status}</span>
          </div>
          <div className="markdown-body supermd-preview" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        </article>

        {editorOpen && (
          <aside className="editor-pane" aria-label="Markdown 源码">
            <Suspense fallback={<div className="editor-loading">载入源码视图</div>}>
              <SourceEditor
                ref={sourceEditorRef}
                content={content}
                initialScrollRatio={editorInitialScrollRatio}
                onChange={handleEditorChange}
                focusTarget={focusTarget}
                onScrollRatio={handleEditorScroll}
              />
            </Suspense>
          </aside>
        )}

        {imagePanelOpen && (
          <aside className="image-panel" aria-label="文档图片">
            <div className="image-panel-header">
              <strong>图片</strong>
              <span>{imagePanelCount}</span>
            </div>
            <div className="image-grid">
              {images.map((item, index) => (
                <button type="button" className="image-card" key={`${item.src}-${item.line}-${item.column}`} onClick={() => handleImageClick(item, index)}>
                  <img src={displayAssetUrl(item)} alt={item.alt || item.src} loading="lazy" />
                  <span><b>图片</b>{String(index + 1).padStart(2, "0")}</span>
                  <small>{item.alt || item.src}</small>
                </button>
              ))}
              {flowcharts.map((item, index) => (
                <button type="button" className="image-card flowchart-card" key={`${item.id}-${item.line}-${item.column}`} onClick={() => handleFlowchartClick(item, index)}>
                  {item.previewSrc ? (
                    <img src={item.previewSrc} alt={`${item.language} 预览`} loading="lazy" />
                  ) : (
                    <div className="flowchart-thumb">{item.language}</div>
                  )}
                  <span><b>流程图</b>{String(images.length + index + 1).padStart(2, "0")}</span>
                  <small>{item.language} · 第 {item.line} 行</small>
                </button>
              ))}
              {imagePanelCount === 0 && <div className="empty-images">无图片</div>}
            </div>
          </aside>
        )}
      </section>

      {imagePanelCount > 0 && (
        <button type="button" className="floating-images" title="图片" onClick={() => setImagePanelOpen((open) => !open)}>
          <Image size={20} />
          <span>{imagePanelCount}</span>
        </button>
      )}

      {recentFiles.length > 0 && !documentPayload.path && (
        <nav className="recent-files" aria-label="最近文件">
          {recentFiles.map((file) => (
            <button type="button" key={file.path} onClick={() => loadFromPath(file.path)}>
              {file.name}
            </button>
          ))}
        </nav>
      )}

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={lightbox.alt} onClick={closeLightbox}>
          <button type="button" className="lightbox-close" aria-label="关闭" onClick={closeLightbox}>
            ×
          </button>
          <div
            className={`lightbox-stage ${imageView.scale > 1 ? "is-zoomed" : ""} ${imageDragging ? "is-dragging" : ""}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeLightbox();
                return;
              }
              event.stopPropagation();
            }}
            onWheel={handleLightboxWheel}
            onPointerDown={handleLightboxPointerDown}
            onPointerMove={handleLightboxPointerMove}
            onPointerUp={handleLightboxPointerEnd}
            onPointerCancel={handleLightboxPointerEnd}
          >
            <img
              src={lightbox.src}
              alt={lightbox.alt}
              draggable={false}
              style={{
                transform: `translate3d(${imageView.offsetX}px, ${imageView.offsetY}px, 0) scale(${imageView.scale})`,
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function normalizeBrowserPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

function readWebkitRelativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

export default App;
