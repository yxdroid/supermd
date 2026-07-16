export type ImageView = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type ZoomOrigin = {
  x: number;
  y: number;
};

export type ImageViewportBounds = {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
};

export type WheelZoomOptions = {
  precise?: boolean;
};

export const MIN_IMAGE_SCALE = 1;
export const MAX_IMAGE_SCALE = 8;
export const DEFAULT_IMAGE_VIEW: ImageView = {
  scale: MIN_IMAGE_SCALE,
  offsetX: 0,
  offsetY: 0,
};

const WHEEL_ZOOM_STEP = 1.18;
const CLICK_ZOOM_SCALE = 2.2;
const PRECISE_WHEEL_ZOOM_SENSITIVITY = 0.014;

export function resetImageView(): ImageView {
  return { ...DEFAULT_IMAGE_VIEW };
}

export function zoomImageView(current: ImageView, deltaY: number, origin: ZoomOrigin, options: WheelZoomOptions = {}): ImageView {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return current;
  }

  if (options.precise) {
    const nextScale = current.scale * Math.exp(-deltaY * PRECISE_WHEEL_ZOOM_SENSITIVITY);
    return zoomImageViewToScale(current, nextScale, origin);
  }

  const direction = deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
  return zoomImageViewToScale(current, current.scale * direction, origin);
}

export function zoomImageViewToScale(current: ImageView, nextScale: number, origin: ZoomOrigin): ImageView {
  const clampedScale = clamp(nextScale, MIN_IMAGE_SCALE, MAX_IMAGE_SCALE);

  if (clampedScale === MIN_IMAGE_SCALE) {
    return resetImageView();
  }

  const ratio = clampedScale / current.scale;

  return {
    scale: clampedScale,
    offsetX: (current.offsetX * ratio) - (origin.x * (ratio - 1)),
    offsetY: (current.offsetY * ratio) - (origin.y * (ratio - 1)),
  };
}

export function toggleImageZoom(current: ImageView, origin: ZoomOrigin): ImageView {
  if (current.scale > MIN_IMAGE_SCALE) {
    return resetImageView();
  }

  return zoomImageViewToScale(current, CLICK_ZOOM_SCALE, origin);
}

export function panImageView(current: ImageView, deltaX: number, deltaY: number): ImageView {
  if (current.scale <= MIN_IMAGE_SCALE) {
    return current;
  }

  return {
    ...current,
    offsetX: current.offsetX + deltaX,
    offsetY: current.offsetY + deltaY,
  };
}

export function constrainImageView(current: ImageView, bounds: ImageViewportBounds): ImageView {
  if (current.scale <= MIN_IMAGE_SCALE) {
    return resetImageView();
  }

  const maxOffsetX = Math.max(0, ((bounds.imageWidth * current.scale) - bounds.viewportWidth) / 2);
  const maxOffsetY = Math.max(0, ((bounds.imageHeight * current.scale) - bounds.viewportHeight) / 2);

  return {
    ...current,
    offsetX: clamp(current.offsetX, -maxOffsetX, maxOffsetX),
    offsetY: clamp(current.offsetY, -maxOffsetY, maxOffsetY),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
