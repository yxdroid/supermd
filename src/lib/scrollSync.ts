export interface ScrollMetrics {
  scrollTop?: number;
  scrollHeight: number;
  clientHeight: number;
}

export function scrollRatio(metrics: ScrollMetrics): number {
  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (maxScroll === 0) {
    return 0;
  }

  return clamp((metrics.scrollTop ?? 0) / maxScroll);
}

export function scrollTopForRatio(metrics: ScrollMetrics, ratio: number): number {
  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  return Math.round(maxScroll * clamp(ratio));
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
