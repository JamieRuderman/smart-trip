import { useEffect, useState, type RefObject } from "react";

/**
 * Live ratio of SVG element's CSS-pixel width to its viewBox width.
 *
 * The line diagram uses this to express label font sizes as **target CSS
 * pixels** rather than viewBox units. On a 390px-wide phone fitting a
 * 780-unit-wide viewBox, the ratio is ~0.5 — so a 14-CSS-px label needs
 * `fontSize = 14 / 0.5 = 28` in viewBox units.
 *
 * Returns `1` until the ResizeObserver fires for the first time, so the
 * initial render before measurement has reasonable defaults.
 */
export function useSvgScreenScale(
  svgRef: RefObject<SVGSVGElement>,
  viewBoxWidth: number,
): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || viewBoxWidth <= 0) return;

    const measure = () => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) setScale(width / viewBoxWidth);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgRef, viewBoxWidth]);

  return scale;
}
