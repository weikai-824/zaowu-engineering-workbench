export const MAX_DESIGN_REGION_POINTS = 128;

export type NormalizedRegionPoint = [number, number];

/**
 * Keep a freehand region within the durable feedback contract while
 * preserving the point order around the closed outline.
 */
export function boundDesignRegionPath(
  points: readonly NormalizedRegionPoint[],
  maximum = MAX_DESIGN_REGION_POINTS,
): NormalizedRegionPoint[] {
  if (!Number.isInteger(maximum) || maximum < 3) throw new Error("Region point limit must be an integer of at least 3.");
  if (points.length <= maximum) return points.map(([x, y]) => [x, y]);
  return Array.from({ length: maximum }, (_value, index) => {
    const source = points[Math.floor((index * points.length) / maximum)]!;
    return [source[0], source[1]];
  });
}
