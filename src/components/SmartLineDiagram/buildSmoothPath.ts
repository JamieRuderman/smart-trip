/** Quarter-circle rounded-corner path through a short waypoint list. */
export function buildSmoothPath(
  pts: { x: number; y: number }[],
  radius: number,
): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const dx1 = cur.x - prev.x, dy1 = cur.y - prev.y;
    const len1 = Math.hypot(dx1, dy1);
    const dx2 = next.x - cur.x, dy2 = next.y - cur.y;
    const len2 = Math.hypot(dx2, dy2);
    const r = Math.min(radius, len1 / 2, len2 / 2);
    const n1x = dx1 / len1, n1y = dy1 / len1;
    const n2x = dx2 / len2, n2y = dy2 / len2;
    const p1 = { x: cur.x - n1x * r, y: cur.y - n1y * r };
    const p2 = { x: cur.x + n2x * r, y: cur.y + n2y * r };
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}
