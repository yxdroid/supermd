import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_VIEW, panImageView, resetImageView, zoomImageView } from "./imageViewer";

describe("image viewer interactions", () => {
  it("zooms in around the cursor position", () => {
    const next = zoomImageView(DEFAULT_IMAGE_VIEW, -100, { x: 120, y: 40 });

    expect(next.scale).toBeGreaterThan(1);
    expect(next.offsetX).toBeLessThan(0);
    expect(next.offsetY).toBeLessThan(0);
  });

  it("clamps zoom and resets offset at the minimum scale", () => {
    const zoomed = zoomImageView({ scale: 7.9, offsetX: 20, offsetY: -30 }, -100, { x: 0, y: 0 });

    expect(zoomed.scale).toBe(8);

    const reset = zoomImageView({ scale: 1.05, offsetX: 80, offsetY: -60 }, 100, { x: 80, y: -60 });

    expect(reset).toEqual(DEFAULT_IMAGE_VIEW);
  });

  it("pans only when the image is zoomed", () => {
    expect(panImageView(DEFAULT_IMAGE_VIEW, 30, -20)).toEqual(DEFAULT_IMAGE_VIEW);

    expect(panImageView({ scale: 2, offsetX: 10, offsetY: 5 }, 30, -20)).toEqual({
      scale: 2,
      offsetX: 40,
      offsetY: -15,
    });
  });

  it("returns a fresh default view when reset", () => {
    expect(resetImageView()).toEqual(DEFAULT_IMAGE_VIEW);
    expect(resetImageView()).not.toBe(DEFAULT_IMAGE_VIEW);
  });
});
