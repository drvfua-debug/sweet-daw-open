export type TimelineViewport = {
  scrollLeftPx: number;
  pixelsPerSecond: number;
  leftPaddingPx: number;
  devicePixelRatio?: number;
};

export function xToTime(clientX: number, containerLeftPx: number, viewport: TimelineViewport) {
  return Math.max(0, (clientX - containerLeftPx + viewport.scrollLeftPx - viewport.leftPaddingPx) / viewport.pixelsPerSecond);
}

export function timeToX(timeSec: number, viewport: TimelineViewport) {
  return viewport.leftPaddingPx + timeSec * viewport.pixelsPerSecond - viewport.scrollLeftPx;
}
