// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { arcFromNorthAtProgress, positionOnPath } from "./pathSnap";

/** Minimal SVGPathElement stub: a straight horizontal line of length `len`. */
function stubPath(len: number) {
  return {
    getTotalLength: vi.fn(() => len),
    getPointAtLength: vi.fn((s: number) => ({ x: s, y: 0 })),
  } as unknown as SVGPathElement & {
    getTotalLength: ReturnType<typeof vi.fn>;
  };
}

const ARCS = [0, 50, 100]; // 3 stations, arc-from-north

describe("positionOnPath", () => {
  it("interpolates fractional station progress into north-relative arc length", () => {
    expect(arcFromNorthAtProgress(1.5, ARCS)).toBe(75);
  });
  it("uses the cached pathLength instead of getTotalLength when provided", () => {
    const path = stubPath(100);
    positionOnPath(1, path, ARCS, "S", 100);
    expect(path.getTotalLength).not.toHaveBeenCalled();
  });

  it("falls back to getTotalLength when no length is passed", () => {
    const path = stubPath(100);
    positionOnPath(1, path, ARCS, "S");
    expect(path.getTotalLength).toHaveBeenCalled();
  });

  it("produces the same position with cached vs read length", () => {
    const a = positionOnPath(1.5, stubPath(100), ARCS, "S");
    const b = positionOnPath(1.5, stubPath(100), ARCS, "S", 100);
    expect({ x: b.x, y: b.y }).toEqual({ x: a.x, y: a.y });
  });

  it("clamps progress to the station range", () => {
    const within = positionOnPath(99, stubPath(100), ARCS, "S", 100);
    const clamped = positionOnPath(2, stubPath(100), ARCS, "S", 100);
    expect(within).toEqual(clamped); // both clamp to the last station
  });
});
