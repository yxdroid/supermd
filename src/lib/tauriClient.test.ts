import { beforeEach, describe, expect, it, vi } from "vitest";

const openMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((value: string) => value),
  invoke: vi.fn(),
  isTauri: isTauriMock,
}));

describe("pickMarkdownPath", () => {
  beforeEach(() => {
    openMock.mockReset();
    isTauriMock.mockReset();
    vi.resetModules();
  });

  it("returns unsupported outside Tauri without opening a dialog", async () => {
    isTauriMock.mockReturnValue(false);
    const { pickMarkdownPath } = await import("./tauriClient");

    await expect(pickMarkdownPath()).resolves.toEqual({ kind: "unsupported" });
    expect(openMock).not.toHaveBeenCalled();
  });

  it("returns cancelled when the Tauri dialog is dismissed", async () => {
    isTauriMock.mockReturnValue(true);
    openMock.mockResolvedValue(null);
    const { pickMarkdownPath } = await import("./tauriClient");

    await expect(pickMarkdownPath()).resolves.toEqual({ kind: "cancelled" });
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it("returns the selected path when the Tauri dialog succeeds", async () => {
    isTauriMock.mockReturnValue(true);
    openMock.mockResolvedValue("/Users/demo/readme.md");
    const { pickMarkdownPath } = await import("./tauriClient");

    await expect(pickMarkdownPath()).resolves.toEqual({ kind: "selected", path: "/Users/demo/readme.md" });
  });
});
