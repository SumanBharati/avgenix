// Unit checks for lib/wiring/layout.ts (connection-aware Signal Flow layout).
// Usage: npx tsx scripts/testing/verify-signal-flow-layout.ts

import { layoutSignalFlow } from "../../lib/wiring/layout";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
};

const B = (id: string, w = 180, h = 90) => ({ id, w, h });
const groups = [
  { key: "Front Wall", blocks: [B("display1"), B("display2"), B("mount", 160, 60), B("bar", 200, 160), B("barMount", 160, 60)] },
  { key: "Table", blocks: [B("cubby"), B("tap"), B("pod1", 140, 70), B("pod2", 140, 70)] },
  { key: "Equipment Rack", blocks: [B("switch", 180, 120), B("dsp", 200, 140)] },
];
const edges = [
  { from: "cubby", to: "tap" }, { from: "tap", to: "bar" },
  { from: "bar", to: "display1" }, { from: "bar", to: "display2" },
  { from: "pod2", to: "pod1" }, { from: "pod1", to: "bar" },
  { from: "dsp", to: "switch" },
];
const r = layoutSignalFlow(groups, edges, { x: 60, y: 100 });
const all = groups.flatMap((g) => g.blocks);
const pos = (id: string) => r.positions.get(id)!;
const size = new Map(all.map((b) => [b.id, b]));

check("every block placed", all.every((b) => r.positions.has(b.id)));
const backwards = edges.filter((e) => pos(e.from).x + size.get(e.from)!.w >= pos(e.to).x);
check("every cable runs left → right with a gap", backwards.length === 0, JSON.stringify(backwards));

const overlaps: string[] = [];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
  const a = all[i], b = all[j], pa = pos(a.id), pb = pos(b.id);
  if (pa.x < pb.x + b.w && pb.x < pa.x + a.w && pa.y < pb.y + b.h && pb.y < pa.y + a.h) overlaps.push(`${a.id}/${b.id}`);
}
check("no two blocks overlap", overlaps.length === 0, overlaps.join(", "));

const boxes = Array.from(r.boxes.entries());
const boxOverlap = boxes.some(([ka, a], i) => boxes.slice(i + 1).some(([kb, b]) => a.y < b.y + b.h && b.y < a.y + a.h && a.x < b.x + b.w && b.x < a.x + a.w));
check("location boxes don't overlap", !boxOverlap, JSON.stringify(boxes));
check("each block sits inside its location box", groups.every((g) => {
  const box = r.boxes.get(g.key)!;
  return g.blocks.every((b) => { const p = pos(b.id); return p.x >= box.x && p.y >= box.y && p.x + b.w <= box.x + box.w && p.y + b.h <= box.y + box.h; });
}));
check("bands stacked in location order", r.boxes.get("Front Wall")!.y < r.boxes.get("Table")!.y && r.boxes.get("Table")!.y < r.boxes.get("Equipment Rack")!.y);
check("a display is level with the bar feeding it", pos("display1").y === pos("bar").y || pos("display2").y === pos("bar").y);
check("unconnected mounts sit below the connected blocks", pos("mount").y > pos("bar").y && pos("barMount").y > pos("bar").y);
check("source column precedes processing", pos("cubby").x < pos("tap").x && pos("tap").x < pos("bar").x && pos("bar").x < pos("display1").x);

// A cycle (feedback loop) must not hang or throw.
const loop = layoutSignalFlow([{ key: "Rack", blocks: [B("a"), B("b"), B("c")] }], [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }], { x: 0, y: 0 });
check("cycle handled", loop.positions.size === 3);

// No cables at all: blocks wrap in a row, not one tall column.
const none = layoutSignalFlow([{ key: "Rack", blocks: [B("a"), B("b"), B("c")] }], [], { x: 0, y: 0 });
check("no cables: one row", new Set(["a", "b", "c"].map((id) => none.positions.get(id)!.y)).size === 1);

console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
