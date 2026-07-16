import { describe, expect, it } from "vitest";
import { constrainImageView, DEFAULT_IMAGE_VIEW, panImageView, resetImageView, toggleImageZoom, zoomImageView, zoomImageViewToScale } from "./imageViewer";

describe("image viewer interactions", () => {
  it("zooms in around the cursor position", () => {
    const next = zoomImageView(DEFAULT_IMAGE_VIEW, -100, { x: 120, y: 40 });

    expect(next.scale).toBeGreaterThan(1);
    expect(next.offsetX).toBeLessThan(0);
    expect(next.offsetY).toBeLessThan(0);
  });

  it("supports precise touchpad pinch zoom with small wheel deltas", () => {
    const next = zoomImageView(DEFAULT_IMAGE_VIEW, -3, { x: 60, y: -20 }, { precise: true });

    expect(next.scale).toBeGreaterThan(1);
    expect(next.scale).toBeLessThan(1.1);
    expect(next.offsetX).toBeLessThan(0);
    expect(next.offsetY).toBeGreaterThan(0);
  });

  it("clamps zoom and resets offset at the minimum scale", () => {
    const zoomed = zoomImageView({ scale: 7.9, offsetX: 20, offsetY: -30 }, -100, { x: 0, y: 0 });

    expect(zoomed.scale).toBe(8);

    const reset = zoomImageView({ scale: 1.05, offsetX: 80, offsetY: -60 }, 100, { x: 80, y: -60 });

    expect(reset).toEqual(DEFAULT_IMAGE_VIEW);
  });

  it("zooms to an explicit scale around a touch center", () => {
    const next = zoomImageViewToScale(DEFAULT_IMAGE_VIEW, 2.5, { x: 90, y: -30 });

    expect(next).toEqual({
      scale: 2.5,
      offsetX: -135,
      offsetY: 45,
    });
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

  it("toggles between the default and clicked zoom state", () => {
    const zoomed = toggleImageZoom(DEFAULT_IMAGE_VIEW, { x: 40, y: 20 });

    expect(zoomed.scale).toBeGreaterThan(1);
    expect(toggleImageZoom(zoomed, { x: 40, y: 20 })).toEqual(DEFAULT_IMAGE_VIEW);
  });

  it("keeps a zoomed image inside the visible stage bounds", () => {
    const next = constrainImageView(
      { scale: 2.2, offsetX: -800, offsetY: 500 },
      { viewportWidth: 1000, viewportHeight: 700, imageWidth: 900, imageHeight: 600 },
    );

    expect(next.scale).toBe(2.2);
    expect(next.offsetX).toBeCloseTo(-490, 6);
    expect(next.offsetY).toBeCloseTo(310, 6);
  });

  it("recenters the image when the scaled size is smaller than the viewport", () => {
    const next = constrainImageView(
      { scale: 1.4, offsetX: 120, offsetY: -80 },
      { viewportWidth: 1800, viewportHeight: 1200, imageWidth: 900, imageHeight: 600 },
    );

    expect(next.scale).toBe(1.4);
    expect(next.offsetX).toBeCloseTo(0, 6);
    expect(next.offsetY).toBeCloseTo(0, 6);
  });

  it("preserves the existing pan position during follow-up zoom steps", () => {
    const next = zoomImageViewToScale(
      { scale: 2.2, offsetX: -120, offsetY: 80 },
      3.1,
      { x: 260, y: -140 },
    );

    expect(next.scale).toBe(3.1);
    expect(next.offsetX).toBeCloseTo(-275.454545, 6);
    expect(next.offsetY).toBeCloseTo(170, 6);
  });
});
