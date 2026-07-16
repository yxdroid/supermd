import { FileText, FolderOpen, Image, PanelRightClose, PanelRightOpen, Save, SquarePen } from "lucide-react";
import mermaid from "mermaid";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { browserFilePath, buildBrowserFolderIndex, normalizeBrowserPath } from "./lib/browserFolder";
import type { BrowserFolderNode } from "./lib/browserFolder";
import { indexFlowcharts, indexHeadings, indexImages, renderMarkdown, renderReadableFallback } from "./lib/markdown";
import { renderMermaidPreviewElements } from "./lib/diagramRender";
import { constrainImageView, DEFAULT_IMAGE_VIEW, panImageView, resetImageView, toggleImageZoom, zoomImageView, zoomImageViewToScale } from "./lib/imageViewer";
import type { ImageView } from "./lib/imageViewer";
import { basename, isRemoteOrDataUrl, resolveAssetPath } from "./lib/paths";
import { sanitizePreviewHtml } from "./lib/sanitize";
import { scrollRatio, scrollTopForRatio } from "./lib/scrollSync";
import { forgetLastDocumentPath, readLastDocumentPath, rememberLastDocumentPath } from "./lib/session";
import { createLatestOpenRequestGuard, isMarkdownOpenPath, latestMarkdownOpenPath } from "./lib/openRequests";
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
import type { DocumentPayload, FlowchartIndexItem, HeadingIndexItem, ImageIndexItem, RecentFile, RenderState } from "./lib/types";

const SourceEditor = lazy(() => import("./components/SourceEditor").then((module) => ({ default: module.SourceEditor })));

type SidePanelTab = "outline" | "images" | "files";
type FolderDocument = {
  path: string;
  name: string;
  label: string;
  file: File | null;
};

const EMPTY_DOC: DocumentPayload = {
  path: "",
  content: [
    "# SuperMD",
    "",
    "打开一个 Markdown 文档开始阅读。",
    "",
    "- 支持 GFM、数学公式、Mermaid 和本地图片",
    "- 右下角快速预览会在文档包含目录或图片时亮起",
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
  const [headings, setHeadings] = useState<HeadingIndexItem[]>([]);
  const [renderState, setRenderState] = useState<RenderState>("loading");
  const [renderMs, setRenderMs] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitialScrollRatio, setEditorInitialScrollRatio] = useState(0);
  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const [activeSidePanelTab, setActiveSidePanelTab] = useState<SidePanelTab>("outline");
  const [dirty, setDirty] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ line: number; column: number } | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [folderName, setFolderName] = useState("");
  const [folderFiles, setFolderFiles] = useState<FolderDocument[]>([]);
  const [folderTree, setFolderTree] = useState<BrowserFolderNode[]>([]);
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<Set<string>>(new Set());
  const [browserAssetUrls, setBrowserAssetUrls] = useState<Map<string, string>>(new Map());
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [imageView, setImageView] = useState<ImageView>(DEFAULT_IMAGE_VIEW);
  const [imageDragging, setImageDragging] = useState(false);
  const [status, setStatus] = useState("就绪");
  const previewPaneRef = useRef<HTMLElement | null>(null);
  const lightboxStageRef = useRef<HTMLDivElement | null>(null);
  const lightboxImageRef = useRef<HTMLImageElement | null>(null);
  const sourceEditorRef = useRef<SourceEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const openMenuRef = useRef<HTMLDivElement | null>(null);
  const browserAssetUrlsRef = useRef(browserAssetUrls);
  const workerRef = useRef<Worker | null>(null);
  const workerFailedRef = useRef(true);
  const renderVersionRef = useRef(0);
  const contentRef = useRef(content);
  const imageViewRef = useRef(imageView);
  const openRequestGuardRef = useRef(createLatestOpenRequestGuard());
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
  const lightboxClickIntentRef = useRef<"image" | "backdrop" | null>(null);
  const lightboxPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const lightboxPinchRef = useRef<{ distance: number; startView: ImageView } | null>(null);
  const lightboxSuppressClickRef = useRef(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);

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
    imageViewRef.current = imageView;
  }, [imageView]);

  useEffect(() => {
    if (!lightbox) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setImageView((current) => clampLightboxView(current));
    });
    const stage = lightboxStageRef.current;

    function handleWheel(event: globalThis.WheelEvent) {
      if (!stage) {
        return;
      }

      const target = event.target;
      if (target instanceof Node && !stage.contains(target) && !event.ctrlKey && Math.abs(event.deltaY) >= 16) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const origin = getZoomOrigin(stage, event.clientX, event.clientY);

      setImageView((current) => clampLightboxView(
        zoomImageView(current, event.deltaY, origin, {
          precise: event.ctrlKey || Math.abs(event.deltaY) < 16,
        }),
      ));
    }

    function handleResize() {
      setImageView((current) => clampLightboxView(current));
    }

    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("wheel", handleWheel, { capture: true });
      window.removeEventListener("resize", handleResize);
    };
  }, [lightbox]);

  useEffect(() => {
    documentPathRef.current = documentPayload.path || "/supermd/untitled.md";
  }, [documentPayload.path]);

  useEffect(() => {
    if (activeSidePanelTab !== "files" || folderFiles.length > 0) {
      return;
    }

    setActiveSidePanelTab(headings.length > 0 ? "outline" : "images");
  }, [activeSidePanelTab, folderFiles.length, headings.length]);

  useEffect(() => {
    if (!openMenuOpen) {
      return;
    }

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Node && openMenuRef.current?.contains(target)) {
        return;
      }

      setOpenMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [openMenuOpen]);

  useEffect(() => {
    if (!editorOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.key.toLowerCase() !== "s" || (!event.metaKey && !event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      if (!dirty) {
        setStatus("已保存");
        return;
      }

      void handleSave();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [content, dirty, documentPayload.path, editorOpen]);

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

    async function openSystemRequestedFile(paths: string[]): Promise<boolean> {
      const path = latestMarkdownOpenPath(paths);
      if (!path) {
        return false;
      }

      try {
        await loadFromPath(path);
      } catch (error) {
        setStatus(error instanceof Error ? `打开失败：${error.message}` : "打开失败");
      }

      return true;
    }

    async function restoreLastOpenedFile() {
      const path = readLastDocumentPath();
      if (!path || !isMarkdownOpenPath(path)) {
        return;
      }

      try {
        await loadFromPath(path);
      } catch (error) {
        forgetLastDocumentPath();
        setStatus(error instanceof Error ? `恢复上次文件失败：${error.message}` : "恢复上次文件失败");
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
        const openedSystemFile = await openSystemRequestedFile(pending);
        if (!cancelled && !openedSystemFile) {
          await restoreLastOpenedFile();
        }
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
    return undefined;
    /*
    workerRef.current.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
      if (event.data.version !== renderVersionRef.current) {
        return;
      }

      if (event.data.unsupported) {
        workerFailedRef.current = true;
        workerRef.current?.terminate();
        workerRef.current = null;
        setStatus("当前环境已切换主线程渲染");
        renderEnhancedInMainThread(event.data.version, contentRef.current, documentPathRef.current).catch((error) => {
          console.error("Main-thread Markdown render failed", error);
          setRenderState("error");
          setStatus("已使用基础预览");
        });
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
    */
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
    setHeadings(indexHeadings(content));
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
    setOpenMenuOpen(false);
    const result = await pickMarkdownPath();
    if (result.kind === "unsupported") {
      fileInputRef.current?.click();
      return;
    }
    if (result.kind === "cancelled") {
      return;
    }
    await loadFromPath(result.path);
  }

  function handleOpenFolder() {
    setOpenMenuOpen(false);
    folderInputRef.current?.click();
  }

  async function loadFromPath(path: string) {
    const request = openRequestGuardRef.current.next();
    setStatus("读取中");
    let opened: DocumentPayload;
    try {
      opened = await openMarkdownFile(path);
    } catch (error) {
      if (openRequestGuardRef.current.isLatest(request)) {
        throw error;
      }
      return;
    }

    if (!openRequestGuardRef.current.isLatest(request)) {
      return;
    }

    preservePreviewOnNextRenderRef.current = false;
    rememberLastDocumentPath(opened.path || path);
    applySingleFileFolderContext(path);
    replaceBrowserAssetUrls(new Map());
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

    const path = browserFilePath(file);
    applySingleFileFolderContext(path, file);
    replaceBrowserAssetUrls(new Map([[path, URL.createObjectURL(file)]]));
    await loadBrowserDocument(file, path, "浏览器预览");
  }

  async function handleBrowserFolder(files: FileList | null) {
    const fileArray = Array.from(files ?? []);
    if (fileArray.length === 0) {
      return;
    }

    const folderIndex = buildBrowserFolderIndex(fileArray);
    if (!folderIndex || folderIndex.markdownFiles.length === 0) {
      setFolderName(folderIndex?.folderName ?? "");
      setFolderFiles([]);
      setFolderTree([]);
      setCollapsedFolderPaths(new Set());
      setStatus("文件夹中未找到 Markdown");
      return;
    }

    const fileLookup = new Map(fileArray.map((file) => [browserFilePath(file), file]));
    const urls = new Map<string, string>();
    for (const file of fileArray) {
      const path = browserFilePath(file);
      urls.set(path, URL.createObjectURL(file));
    }
    replaceBrowserAssetUrls(urls);

    const nextFolderFiles = folderIndex.markdownFiles.reduce<FolderDocument[]>((collection, entry) => {
      const file = fileLookup.get(entry.path);
      if (file) {
        collection.push({ ...entry, file });
      }
      return collection;
    }, []);

    if (nextFolderFiles.length === 0) {
      setFolderName(folderIndex.folderName);
      setFolderFiles([]);
      setFolderTree([]);
      setCollapsedFolderPaths(new Set());
      setStatus("文件夹中未找到可读取的 Markdown");
      return;
    }

    setFolderName(folderIndex.folderName);
    setFolderFiles(nextFolderFiles);
    setFolderTree(folderIndex.tree);
    setCollapsedFolderPaths(new Set());
    setImagePanelOpen(true);
    setActiveSidePanelTab("files");
    const firstFolderFile = nextFolderFiles[0];
    if (!firstFolderFile.file) {
      setStatus("文件夹中未找到可读取的 Markdown");
      return;
    }
    await loadBrowserDocument(
      firstFolderFile.file,
      firstFolderFile.path,
      `文件夹预览：${folderIndex.folderName}（${nextFolderFiles.length} 个 Markdown）`,
    );
  }

  async function loadBrowserDocument(file: File, path: string, nextStatus: string) {
    const text = await file.text();
    preservePreviewOnNextRenderRef.current = false;
    forgetLastDocumentPath();
    setDocumentPayload({
      path,
      content: text,
      size: file.size,
      mtime: file.lastModified,
      encoding: "utf-8",
    });
    setContent(text);
    setDirty(false);
    setStatus(nextStatus);
  }

  async function handleFolderFileSelect(file: FolderDocument) {
    if (file.file) {
      await loadBrowserDocument(file.file, file.path, `文件夹预览：${folderName} / ${file.label}`);
      return;
    }

    await loadFromPath(file.path);
  }

  function applySingleFileFolderContext(path: string, file: File | null = null) {
    const normalizedPath = normalizeBrowserPath(path);
    const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
    const name = segments[segments.length - 1] || path;
    const directorySegments = segments.slice(0, -1);
    const directoryName = directorySegments[directorySegments.length - 1] || "当前文件";
    const label = directorySegments.length > 0 ? segments.slice(-1)[0] : name;

    setFolderName(directoryName);
    setFolderFiles([{ path, name, label, file }]);
    setFolderTree([{
      type: "file",
      path,
      name,
      label,
    }]);
    setCollapsedFolderPaths(new Set());
    setImagePanelOpen(true);
    setActiveSidePanelTab("files");
  }

  async function handleSave() {
    if (!documentPayload.path) {
      setStatus("需要先打开本地文件");
      return;
    }

    try {
      setStatus("保存中");
      const result = await saveMarkdownFile(documentPayload.path, content);
      setDocumentPayload((current) => ({ ...current, size: result.size, mtime: result.savedAt, content }));
      setDirty(false);
      setStatus("已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    }
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

  function handleHeadingClick(heading: HeadingIndexItem, index: number) {
    scrollPreviewHeadingIntoView(index);
    setFocusTarget({ line: heading.line, column: heading.column });
  }

  function openLightbox(src: string, alt: string) {
    setImageView(resetImageView());
    setImageDragging(false);
    resetLightboxInteraction();
    setLightbox({ src, alt });
  }

  function closeLightbox() {
    setLightbox(null);
    setImageView(resetImageView());
    setImageDragging(false);
    resetLightboxInteraction();
  }

  function resetLightboxInteraction() {
    imageDragRef.current = null;
    lightboxClickIntentRef.current = null;
    lightboxPinchRef.current = null;
    lightboxPointersRef.current.clear();
    lightboxSuppressClickRef.current = false;
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

  function scrollPreviewHeadingIntoView(index: number) {
    const pane = previewPaneRef.current;
    if (!pane) {
      return;
    }

    const target = pane.querySelectorAll<HTMLElement>(".supermd-preview h1, .supermd-preview h2, .supermd-preview h3, .supermd-preview h4, .supermd-preview h5, .supermd-preview h6")[index] ?? null;
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

  function handleLightboxPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" && event.button !== 0) {
      return;
    }

    event.stopPropagation();
    if (event.pointerType === "touch") {
      event.preventDefault();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    lightboxClickIntentRef.current = event.target instanceof Element && event.target.closest("img") ? "image" : "backdrop";
    lightboxPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (lightboxPointersRef.current.size === 2) {
      imageDragRef.current = null;
      setImageDragging(false);
      lightboxPinchRef.current = {
        distance: readPointerDistance(),
        startView: imageViewRef.current,
      };
      return;
    }

    if (event.target === event.currentTarget) {
      return;
    }

    imageDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startView: imageViewRef.current,
    };
    setImageDragging(imageViewRef.current.scale > 1);
  }

  function handleLightboxPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (lightboxPointersRef.current.has(event.pointerId)) {
      lightboxPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinch = lightboxPinchRef.current;
    if (pinch && lightboxPointersRef.current.size >= 2) {
      event.preventDefault();
      event.stopPropagation();
      lightboxSuppressClickRef.current = true;
      setImageDragging(false);
      setImageView(clampLightboxView(zoomImageViewToScale(
        pinch.startView,
        pinch.startView.scale * (readPointerDistance() / Math.max(pinch.distance, 1)),
        getZoomOriginFromPoint(event.currentTarget, readPointerCenter()),
      )));
      return;
    }

    const drag = imageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4) {
      lightboxSuppressClickRef.current = true;
    }
    setImageView(clampLightboxView(
      panImageView(drag.startView, event.clientX - drag.startX, event.clientY - drag.startY),
    ));
  }

  function handleLightboxPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    lightboxPointersRef.current.delete(event.pointerId);

    const drag = imageDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      imageDragRef.current = null;
      setImageDragging(false);
    }

    if (lightboxPointersRef.current.size < 2) {
      lightboxPinchRef.current = null;
    }
  }

  function handleLightboxClick(event: MouseEvent<HTMLDivElement>) {
    const intent = lightboxClickIntentRef.current
      ?? (event.target instanceof Element && event.target.closest("img") ? "image" : "backdrop");
    lightboxClickIntentRef.current = null;
    const origin = getZoomOrigin(event.currentTarget, event.clientX, event.clientY);

    if (lightboxSuppressClickRef.current) {
      lightboxSuppressClickRef.current = false;
      event.stopPropagation();
      return;
    }

    if (intent === "backdrop") {
      event.stopPropagation();
      return;
    }

    if (intent !== "image" && event.target === event.currentTarget) {
      return;
    }

    event.stopPropagation();
    setImageView((current) => clampLightboxView(
      toggleImageZoom(current, origin),
    ));
  }

  function clampLightboxView(next: ImageView) {
    const stage = lightboxStageRef.current;
    const image = lightboxImageRef.current;
    if (!stage || !image) {
      return next;
    }

    return constrainImageView(next, {
      viewportWidth: stage.clientWidth,
      viewportHeight: stage.clientHeight,
      imageWidth: image.clientWidth,
      imageHeight: image.clientHeight,
    });
  }

  function getZoomOrigin(stage: HTMLDivElement, clientX: number, clientY: number) {
    const rect = stage.getBoundingClientRect();
    return {
      x: clientX - rect.left - (rect.width / 2),
      y: clientY - rect.top - (rect.height / 2),
    };
  }

  function getZoomOriginFromPoint(stage: HTMLDivElement, point: { x: number; y: number }) {
    return getZoomOrigin(stage, point.x, point.y);
  }

  function readPointerDistance() {
    const [first, second] = [...lightboxPointersRef.current.values()];
    if (!first || !second) {
      return 1;
    }

    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function readPointerCenter() {
    const [first, second] = [...lightboxPointersRef.current.values()];
    if (!first || !second) {
      return { x: 0, y: 0 };
    }

    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
  }

  function renderFolderNodes(nodes: BrowserFolderNode[], depth = 0) {
    return nodes.map((node) => {
      if (node.type === "directory") {
        const collapsed = collapsedFolderPaths.has(node.path);
        return (
          <div className="folder-branch" key={`dir-${node.path || node.name}`}>
            <button
              type="button"
              className="folder-branch-toggle"
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              aria-expanded={!collapsed}
              onClick={() => {
                setCollapsedFolderPaths((current) => {
                  const next = new Set(current);
                  if (next.has(node.path)) {
                    next.delete(node.path);
                  } else {
                    next.add(node.path);
                  }
                  return next;
                });
              }}
            >
              <span>{collapsed ? "▸" : "▾"}</span>
              <strong>{node.name}</strong>
            </button>
            {!collapsed && (
              <div className="folder-node-children">
                {renderFolderNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      }

      return (
        <button
          type="button"
          key={node.path}
          className={`folder-file folder-tree-file ${documentPayload.path === node.path ? "is-active" : ""}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => {
            const file = folderFiles.find((item) => item.path === node.path);
            if (file) {
              void handleFolderFileSelect(file);
            }
          }}
        >
          <strong>{node.name}</strong>
          <span>{node.label}</span>
        </button>
      );
    });
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
  const sidePanelCount = headings.length + imagePanelCount + folderFiles.length;
  const hasFolderFiles = folderFiles.length > 0;

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
          <div className="toolbar-menu" ref={openMenuRef}>
            <button
              type="button"
              className="icon-button"
              title="打开"
              aria-expanded={openMenuOpen}
              onClick={() => setOpenMenuOpen((current) => !current)}
            >
              <FolderOpen size={18} />
            </button>
            {openMenuOpen && (
              <div className="toolbar-popover" role="menu" aria-label="打开">
                <button type="button" role="menuitem" onClick={() => void handleOpen()}>
                  打开文件
                </button>
                <button type="button" role="menuitem" onClick={handleOpenFolder}>
                  打开文件夹
                </button>
              </div>
            )}
          </div>
          <button type="button" className="icon-button" title="保存" onClick={handleSave} disabled={!dirty}>
            <Save size={18} />
          </button>
          <button type="button" className="icon-button" title="源码" onClick={handleToggleEditor}>
            <SquarePen size={18} />
          </button>
          <button type="button" className="icon-button" title="快速预览" onClick={() => setImagePanelOpen((open) => !open)}>
            {imagePanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>

        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept=".md,.markdown,.mdown,.mkd,text/markdown,text/plain"
          onChange={(event) => {
            void handleBrowserFile(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          className="hidden-input"
          type="file"
          multiple
          onChange={(event) => {
            void handleBrowserFolder(event.target.files);
            event.currentTarget.value = "";
          }}
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
          <aside className="image-panel quick-preview-panel" aria-label="快速预览">
            <div className="image-panel-header">
              <strong>快速预览</strong>
              <span>{sidePanelCount}</span>
            </div>
            <div className="quick-preview-content">
              <div className={`quick-preview-tabs ${hasFolderFiles ? "has-files" : ""}`} role="tablist" aria-label="快速预览类型">
                <button
                  type="button"
                  role="tab"
                  className={`quick-preview-tab ${activeSidePanelTab === "outline" ? "is-active" : ""}`}
                  aria-selected={activeSidePanelTab === "outline"}
                  onClick={() => setActiveSidePanelTab("outline")}
                >
                  目录
                  <span>{headings.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`quick-preview-tab ${activeSidePanelTab === "images" ? "is-active" : ""}`}
                  aria-selected={activeSidePanelTab === "images"}
                  onClick={() => setActiveSidePanelTab("images")}
                >
                  图片
                  <span>{imagePanelCount}</span>
                </button>
                {hasFolderFiles && (
                  <button
                    type="button"
                    role="tab"
                    className={`quick-preview-tab ${activeSidePanelTab === "files" ? "is-active" : ""}`}
                    aria-selected={activeSidePanelTab === "files"}
                    onClick={() => setActiveSidePanelTab("files")}
                  >
                    文件
                    <span>{folderFiles.length}</span>
                  </button>
                )}
              </div>

              <div className="quick-preview-panel-body">
                {activeSidePanelTab === "outline" ? (
                  <nav className="outline-list" aria-label="文档目录">
                    {headings.map((item, index) => (
                      <button
                        type="button"
                        className="outline-item"
                        style={{ paddingLeft: `${10 + Math.min(item.level - 1, 5) * 14}px` }}
                        key={`${item.id}-${item.line}-${item.column}`}
                        onClick={() => handleHeadingClick(item, index)}
                      >
                        <span>H{item.level}</span>
                        <strong>{item.text || "未命名标题"}</strong>
                      </button>
                    ))}
                    {headings.length === 0 && <div className="empty-images">暂无目录</div>}
                  </nav>
                ) : activeSidePanelTab === "images" ? (
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
                ) : (
                  <nav className="folder-tree" aria-label={`${folderName} 文件树`}>
                    <div className="folder-tree-root">{folderName}</div>
                    <div className="folder-tree-list">
                      {folderTree.length > 0 ? renderFolderNodes(folderTree) : <div className="empty-images">暂无文件</div>}
                    </div>
                  </nav>
                )}
              </div>
            </div>
          </aside>
        )}
      </section>

      {sidePanelCount > 0 && (
        <button type="button" className="floating-images" title="快速预览" onClick={() => setImagePanelOpen((open) => !open)}>
          <Image size={20} />
          <span>{sidePanelCount}</span>
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
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.alt}
        >
          <button type="button" className="lightbox-close" aria-label="关闭" onClick={closeLightbox}>
            ×
          </button>
          <div
            className={`lightbox-stage ${imageView.scale > 1 ? "is-zoomed" : ""} ${imageDragging ? "is-dragging" : ""}`}
            ref={lightboxStageRef}
            onClick={handleLightboxClick}
            onPointerDown={handleLightboxPointerDown}
            onPointerMove={handleLightboxPointerMove}
            onPointerUp={handleLightboxPointerEnd}
            onPointerCancel={handleLightboxPointerEnd}
          >
            <img
              ref={lightboxImageRef}
              src={lightbox.src}
              alt={lightbox.alt}
              draggable={false}
              onLoad={() => setImageView((current) => clampLightboxView(current))}
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

export default App;
