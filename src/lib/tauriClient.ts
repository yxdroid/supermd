import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AssetResult, DocumentPayload, RecentFile, SaveResult } from "./types";

export const OPENED_MARKDOWN_FILES_EVENT = "supermd://opened-files";

export async function pickMarkdownPath(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] }],
  });

  return typeof selected === "string" ? selected : null;
}

export async function openMarkdownFile(path?: string): Promise<DocumentPayload> {
  return invoke<DocumentPayload>("open_markdown_file", { path: path ?? null });
}

export async function saveMarkdownFile(path: string, content: string): Promise<SaveResult> {
  return invoke<SaveResult>("save_markdown_file", { path, content });
}

export async function resolveAsset(documentPath: string, assetSrc: string): Promise<AssetResult> {
  return invoke<AssetResult>("resolve_asset_path", { documentPath, assetSrc });
}

export async function getRecentFiles(): Promise<RecentFile[]> {
  return invoke<RecentFile[]>("get_recent_files");
}

export async function takePendingOpenFiles(): Promise<string[]> {
  return invoke<string[]>("take_pending_open_files");
}

export async function listenForOpenedMarkdownFiles(handler: (paths: string[]) => void): Promise<() => void> {
  return listen<string[]>(OPENED_MARKDOWN_FILES_EVENT, (event) => handler(event.payload));
}

export function toDisplayableAsset(pathOrUrl: string, isRemote: boolean): string {
  if (isRemote || !isTauri()) {
    return pathOrUrl;
  }

  return convertFileSrc(pathOrUrl);
}

export function runningInTauri(): boolean {
  return isTauri();
}
