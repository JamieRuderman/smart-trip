import { useEffect, useState, type RefObject } from "react";

/**
 * Live scale factor mapping viewBox units to rendered CSS pixels for an
 * SVG using `preserveAspectRatio="xMidYMid meet"`. With "meet", the
 * smaller of (containerW/viewBoxW) and (containerH/viewBoxH) wins; the
 * other axis gets letterboxed.
 *
 * The line diagram uses this to express label font sizes as **target CSS
 * pixels** rather than viewBox units. On a 390x720 phone fitting a
 * 880x1390 viewBox, the ratio is ~0.44 — so a 14-CSS-px label needs
 * `fontSize = 14 / 0.44 ≈ 32` in viewBox units.
 *
 * Returns `1` until the ResizeObserver fires for the first time, so the
 * initial render before measurement has reasonable defaults.
 */
export function useSvgScreenScale(
  svgRef: RefObject<SVGSVGElement>,
  viewBoxWidth: number,
  viewBoxHeight: number,
): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || viewBoxWidth <= 0 || viewBoxHeight <= 0) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = Math.min(
        rect.width / viewBoxWidth,
        rect.height / viewBoxHeight,
      );
      if (next > 0) setScale(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgRef, viewBoxWidth, viewBoxHeight]);

  return scale;
}
