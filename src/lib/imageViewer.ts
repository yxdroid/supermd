export type ImageView = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type ZoomOrigin = {
  x: number;
  y: number;
};

export const MIN_IMAGE_SCALE = 1;
export const MAX_IMAGE_SCALE = 8;
export const DEFAULT_IMAGE_VIEW: ImageView = {
  scale: MIN_IMAGE_SCALE,
  offsetX: 0,
  offsetY: 0,
};

const WHEEL_ZOOM_STEP = 1.18;

export function resetImageView(): ImageView {
  return { ...DEFAULT_IMAGE_VIEW };
}

export function zoomImageView(current: ImageView, deltaY: number, origin: ZoomOrigin): ImageView {
  const direction = deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
  const nextScale = clamp(current.scale * direction, MIN_IMAGE_SCALE, MAX_IMAGE_SCALE);

  if (nextScale === MIN_IMAGE_SCALE) {
    return resetImageView();
  }

  const ratio = nextScale / current.scale;

  return {
    scale: nextScale,
    offsetX: current.offsetX - origin.x * (ratio - 1),
    offsetY: current.offsetY - origin.y * (ratio - 1),
  };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
