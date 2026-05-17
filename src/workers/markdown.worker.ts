import { indexImages, renderMarkdown } from "../lib/markdown";

export interface MarkdownWorkerRequest {
  version: number;
  content: string;
  documentPath: string;
}

export interface MarkdownWorkerResponse {
  version: number;
  html: string;
  images: ReturnType<typeof indexImages>;
  renderMs: number;
}

self.onmessage = async (event: MessageEvent<MarkdownWorkerRequest>) => {
  const started = performance.now();
  const { version, content, documentPath } = event.data;

  try {
    const [html, images] = await Promise.all([
      renderMarkdown(content),
      Promise.resolve(indexImages(content, documentPath)),
    ]);

    self.postMessage({
      version,
      html,
      images,
      renderMs: Math.round(performance.now() - started),
    } satisfies MarkdownWorkerResponse);
  } catch (error) {
    self.postMessage({
      version,
      html: `<p>Markdown 渲染失败：${error instanceof Error ? error.message : String(error)}</p>`,
      images: [],
      renderMs: Math.round(performance.now() - started),
    } satisfies MarkdownWorkerResponse);
  }
};

