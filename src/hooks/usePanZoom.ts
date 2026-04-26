/**
 * Pan + pinch + wheel zoom for an SVG element.
 *
 * State is `{ tx, ty, scale }` in viewBox units; spread the returned
 * `transform` string on a `<g>` wrapping the zoomable content. Labels that
 * should stay constant CSS px (i.e. NOT zoom) live OUTSIDE that group and
 * compute their own position via `applyAffine(x, y)`.
 *
 *   - Wheel: zooms around the cursor.
 *   - Pinch: zooms around the two-finger midpoint.
 *   - One-finger drag: pans.
 *   - Tap on inner content: passes through (no preventDefault) so existing
 *     onClick handlers (station / train) still fire. Multi-pointer gestures
 *     suppress the synthetic click via a movement threshold.
 *
 *   - Scale clamped to [minScale, maxScale]; pan clamped so the content
 *     can't escape the viewport entirely.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

interface UsePanZoomOptions {
  /** SVG viewBox dimensions and origin, e.g. {x:-90, y:40, w:880, h:1390}. */
  viewBox: { x: number; y: number; width: number; height: number };
  minScale?: number;
  maxScale?: number;
  /** Movement (CSS px) below which a pointerup still counts as a tap. */
  tapThresholdPx?: number;
}

export interface PanZoomState {
  tx: number;
  ty: number;
  scale: number;
  isPanning: boolean;
}

export interface PanZoom extends PanZoomState {
  /** ` translate(tx ty) scale(scale)` ready for `<g transform=...>`. */
  transform: string;
  /** Reset to fit (tx=0, ty=0, scale=1). */
  reset: () => void;
  /** Apply current pan+zoom to an inner-coord point — useful for rendering
   *  labels in a sibling group that shouldn't scale. */
  applyAffine: (x: number, y: number) => { x: number; y: number };
}

const DEFAULTS = {
  minScale: 1,
  maxScale: 5,
  tapThresholdPx: 6,
};

/** Distance between two pointers in screen px. */
function pointerDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint of two pointers in screen px. */
function pointerMidpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function usePanZoom(
  svgRef: RefObject<SVGSVGElement>,
  options: UsePanZoomOptions,
): PanZoom {
  const minScale = options.minScale ?? DEFAULTS.minScale;
  const maxScale = options.maxScale ?? DEFAULTS.maxScale;
  const tapThresholdPx = options.tapThresholdPx ?? DEFAULTS.tapThresholdPx;
  const { viewBox } = options;

  const [state, setState] = useState<PanZoomState>({
    tx: 0,
    ty: 0,
    scale: 1,
    isPanning: false,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  // Coalesce per-frame updates so a flood of pointermove events doesn't
  // cause N React renders per second.
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<PanZoomState | null>(null);
  const flush = useCallback(() => {
    rafRef.current = null;
    if (pendingRef.current) {
      setState(pendingRef.current);
      pendingRef.current = null;
    }
  }, []);
  const queue = useCallback(
    (next: PanZoomState) => {
      pendingRef.current = next;
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Tracked pointers and drag state.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStartRef = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);
  const pinchStartRef = useRef<{
    distance: number;
    scale: number;
    midViewBox: { x: number; y: number };
    tx: number;
    ty: number;
  } | null>(null);
  /** Pointer position (CSS px) at pointerdown, for tap-vs-drag distance. */
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  /** Straight-line distance (CSS px) from the pointerdown position to the
   *  current pointer position. Used for tap-vs-drag — straight-line beats
   *  accumulated path length so mouse jitter / trackpad quantization can't
   *  push a stationary click over the threshold. */
  const totalMoveRef = useRef(0);

  /** Convert client (screen) coords to viewBox coords. The SVG fits via
   *  `xMidYMid meet`, so the rendered content is letterboxed on whichever
   *  axis isn't the constraint — must back out the offset before mapping. */
  const clientToViewBox = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
      const scale = Math.min(
        rect.width / viewBox.width,
        rect.height / viewBox.height,
      );
      const offsetX = (rect.width - viewBox.width * scale) / 2;
      const offsetY = (rect.height - viewBox.height * scale) / 2;
      return {
        x: (clientX - rect.left - offsetX) / scale + viewBox.x,
        y: (clientY - rect.top - offsetY) / scale + viewBox.y,
      };
    },
    [svgRef, viewBox],
  );

  /** Live CSS-px-per-viewBox-unit ratio for the **rendered** content. With
   *  `meet`, this is the smaller of (width/vbW, height/vbH) — the same
   *  scale the SVG actually draws at. Pan-delta and tap-threshold math both
   *  use this so the cursor tracks at 1:1 on any viewport. */
  const screenScale = useCallback(() => {
    const el = svgRef.current;
    if (!el) return 1;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 1;
    return Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  }, [svgRef, viewBox.width, viewBox.height]);

  /** Clamp pan so at least 25% of the content stays in view. */
  const clampPan = useCallback(
    (tx: number, ty: number, scale: number) => {
      // Inner content occupies viewBox; transformed = viewBox*scale + (tx,ty).
      // We want the visible viewport (still viewBox space) to overlap content
      // by at least this fraction.
      const overlap = 0.25;
      const minVisibleW = viewBox.width * overlap;
      const minVisibleH = viewBox.height * overlap;
      const contentW = viewBox.width * scale;
      const contentH = viewBox.height * scale;
      // Content x-range in viewBox space: [viewBox.x*scale + tx, ...+ contentW].
      // Visible x-range: [viewBox.x, viewBox.x + viewBox.width].
      const minTx = viewBox.x + minVisibleW - viewBox.x * scale - contentW;
      const maxTx = viewBox.x + viewBox.width - minVisibleW - viewBox.x * scale;
      const minTy = viewBox.y + minVisibleH - viewBox.y * scale - contentH;
      const maxTy = viewBox.y + viewBox.height - minVisibleH - viewBox.y * scale;
      return {
        tx: Math.min(maxTx, Math.max(minTx, tx)),
        ty: Math.min(maxTy, Math.max(minTy, ty)),
      };
    },
    [viewBox],
  );

  /** Zoom around a pivot in viewBox space. */
  const zoomAroundPivot = useCallback(
    (
      pivotVbX: number,
      pivotVbY: number,
      newScale: number,
      basis: { tx: number; ty: number; scale: number },
    ) => {
      const clamped = Math.min(maxScale, Math.max(minScale, newScale));
      const ratio = clamped / basis.scale;
      const tx = pivotVbX - (pivotVbX - basis.tx) * ratio;
      const ty = pivotVbY - (pivotVbY - basis.ty) * ratio;
      const c = clampPan(tx, ty, clamped);
      return { tx: c.tx, ty: c.ty, scale: clamped };
    },
    [clampPan, maxScale, minScale],
  );

  // Wheel zoom. Attached via useEffect so we can pass `passive: false`
  // (iOS WebView refuses preventDefault on passive listeners).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const cur = stateRef.current;
      const pivot = clientToViewBox(e.clientX, e.clientY);
      const next = zoomAroundPivot(pivot.x, pivot.y, cur.scale * factor, cur);
      queue({ ...next, isPanning: false });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, clientToViewBox, zoomAroundPivot, queue]);

  // Pointer-based pan + pinch. We attach to the SVG; React's onPointer*
  // would add prop drilling and inhibit `setPointerCapture` cleanly.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    const recordPointer = (e: PointerEvent) => {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };

    const onPointerDown = (e: PointerEvent) => {
      // Ignore non-primary mouse buttons.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      el.setPointerCapture?.(e.pointerId);
      recordPointer(e);
      totalMoveRef.current = 0;
      downPosRef.current = { x: e.clientX, y: e.clientY };
      const points = [...pointersRef.current.values()];

      if (points.length === 1) {
        // Begin a pan.
        const cur = stateRef.current;
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          tx: cur.tx,
          ty: cur.ty,
        };
        pinchStartRef.current = null;
      } else if (points.length === 2) {
        // Promote to pinch — capture both anchor distances.
        dragStartRef.current = null;
        const [a, b] = points;
        const distance = pointerDistance(a, b);
        const midClient = pointerMidpoint(a, b);
        const midViewBox = clientToViewBox(midClient.x, midClient.y);
        const cur = stateRef.current;
        pinchStartRef.current = {
          distance,
          scale: cur.scale,
          midViewBox,
          tx: cur.tx,
          ty: cur.ty,
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Track straight-line distance from pointerdown — robust to mouse
      // jitter / trackpad pixel-snap that would balloon an accumulated
      // path-length and falsely flag a stationary click as a drag.
      if (downPosRef.current) {
        const d = Math.hypot(
          e.clientX - downPosRef.current.x,
          e.clientY - downPosRef.current.y,
        );
        if (d > totalMoveRef.current) totalMoveRef.current = d;
      }

      const points = [...pointersRef.current.values()];

      if (points.length === 1 && dragStartRef.current) {
        const start = dragStartRef.current;
        const dx = (e.clientX - start.x) / screenScale();
        const dy = (e.clientY - start.y) / screenScale();
        const cur = stateRef.current;
        const c = clampPan(start.tx + dx, start.ty + dy, cur.scale);
        // Below tap threshold? Don't show the panning state yet so taps
        // don't temporarily de-render the click target.
        const moved = totalMoveRef.current > tapThresholdPx;
        queue({
          tx: c.tx,
          ty: c.ty,
          scale: cur.scale,
          isPanning: moved,
        });
      } else if (points.length === 2 && pinchStartRef.current) {
        const start = pinchStartRef.current;
        const [a, b] = points;
        const distance = pointerDistance(a, b);
        if (distance <= 0) return;
        const ratio = distance / start.distance;
        const next = zoomAroundPivot(
          start.midViewBox.x,
          start.midViewBox.y,
          start.scale * ratio,
          { tx: start.tx, ty: start.ty, scale: start.scale },
        );
        queue({ ...next, isPanning: true });
      }
    };

    const endPointer = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size === 0) {
        dragStartRef.current = null;
        pinchStartRef.current = null;
        if (stateRef.current.isPanning) {
          queue({ ...stateRef.current, isPanning: false });
        }
      } else if (pointersRef.current.size === 1) {
        // Drop back into pan mode from pinch.
        pinchStartRef.current = null;
        const [only] = pointersRef.current.values();
        const cur = stateRef.current;
        dragStartRef.current = {
          x: only.x,
          y: only.y,
          tx: cur.tx,
          ty: cur.ty,
        };
        totalMoveRef.current = tapThresholdPx + 1; // suppress tap after pinch
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endPointer);
    el.addEventListener("pointercancel", endPointer);
    el.addEventListener("pointerleave", endPointer);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPointer);
      el.removeEventListener("pointercancel", endPointer);
      el.removeEventListener("pointerleave", endPointer);
    };
  }, [
    svgRef,
    clientToViewBox,
    clampPan,
    queue,
    screenScale,
    tapThresholdPx,
    zoomAroundPivot,
  ]);

  // Suppress synthetic click after a drag (panning) so taps don't fire on
  // station/train markers when the user lifts off after a drag. We attach
  // the suppressor at `document` in capture phase so it preempts React's
  // delegated synthetic-event listener (which is at the React root).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) return;
      if (totalMoveRef.current > tapThresholdPx) {
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        e.preventDefault();
        totalMoveRef.current = 0;
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [svgRef, tapThresholdPx]);

  const reset = useCallback(() => {
    queue({ tx: 0, ty: 0, scale: 1, isPanning: false });
  }, [queue]);

  const applyAffine = useCallback(
    (x: number, y: number) => ({
      x: x * state.scale + state.tx,
      y: y * state.scale + state.ty,
    }),
    [state.scale, state.tx, state.ty],
  );

  return {
    ...state,
    transform: `translate(${state.tx} ${state.ty}) scale(${state.scale})`,
    reset,
    applyAffine,
  };
}
