/** Geometry and connector spacing share one definition; one unit is one stud pitch. */
export interface BrickSpec {
  id: string;
  cols: number;
  rows: number;
  height: number;
  label: string;
}
export const catalog: BrickSpec[] = [
  { id: "1x2", cols: 2, rows: 1, height: 1.2, label: "1 × 2" },
  { id: "2x2", cols: 2, rows: 2, height: 1.2, label: "2 × 2" },
  { id: "2x4", cols: 4, rows: 2, height: 1.2, label: "2 × 4" },
];
export const colors = [
  "#df553e",
  "#e9b938",
  "#3e7b9b",
  "#66846b",
  "#eee6d3",
  "#383c43",
];
export function connectors(s: BrickSpec) {
  return Array.from({ length: s.cols * s.rows }, (_, i) => ({
    x: (i % s.cols) - (s.cols - 1) / 2,
    z: Math.floor(i / s.cols) - (s.rows - 1) / 2,
  }));
}
