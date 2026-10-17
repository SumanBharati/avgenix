// Connection-aware placement for generated Signal Flow diagrams.
//
// A signal-flow drawing reads left → right: sources, then processing, then
// destinations. Blocks have inputs on the left and outputs on the right, so
// putting every block in a column after everything that feeds it makes each
// cable run forward through an open gap instead of doubling back behind the
// blocks. Location groups (Front Wall, Table, Equipment Rack, ...) stay as
// horizontal bands stacked top to bottom; a block's column is shared across
// bands, so cables between locations drop straight down the column gaps.
//
// Within a column, blocks are ordered to reduce crossings (barycenter sweeps)
// and placed level with what feeds them where possible, so many cables come
// out straight. Blocks with no cables at all (mounts, accessories) are packed
// in a row at the bottom of their band, out of the way.

export interface LayoutBlock { id: any; w: number; h: number }
export interface LayoutGroup { key: string; blocks: LayoutBlock[] }
export interface LayoutEdge { from: any; to: any }

export interface LayoutResult {
  positions: Map<any, { x: number; y: number }>;
  boxes: Map<string, { x: number; y: number; w: number; h: number }>;
  bottom: number;
}

export const LAYOUT = {
  COL_GAP: 150,     // room between columns for cables and their labels
  ROW_GAP: 36,      // between blocks stacked in one column
  BAND_GAP: 48,     // between location bands
  PAD: 24,          // inside a location box
  LABEL: 36,        // top clearance for the location's label tab
  ISOLATED_GAP: 24, // between unconnected blocks in their row
};

export function layoutSignalFlow(groups: LayoutGroup[], edgesIn: LayoutEdge[], origin: { x: number; y: number }): LayoutResult {
  const blocks = groups.flatMap((g) => g.blocks);
  const ids = new Set(blocks.map((b) => b.id));
  const groupOf = new Map<any, string>();
  groups.forEach((g) => g.blocks.forEach((b) => groupOf.set(b.id, g.key)));
  const edges = edgesIn.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

  const outs = new Map<any, any[]>(), ins = new Map<any, any[]>();
  blocks.forEach((b) => { outs.set(b.id, []); ins.set(b.id, []); });
  edges.forEach((e) => { outs.get(e.from)!.push(e.to); ins.get(e.to)!.push(e.from); });
  const connected = new Set<any>();
  edges.forEach((e) => { connected.add(e.from); connected.add(e.to); });

  // --- Layers: longest path from the sources, ignoring cycle back-edges ---
  const state = new Map<any, 0 | 1 | 2>();
  const back = new Set<string>();
  const visit = (n: any) => {
    state.set(n, 1);
    for (const m of outs.get(n)!) {
      if (state.get(m) === 1) back.add(`${n}>${m}`);
      else if (!state.get(m)) visit(m);
    }
    state.set(n, 2);
  };
  blocks.forEach((b) => { if (connected.has(b.id) && !state.get(b.id)) visit(b.id); });
  const fwd = edges.filter((e) => !back.has(`${e.from}>${e.to}`));
  const layer = new Map<any, number>();
  const indeg = new Map<any, number>();
  blocks.forEach((b) => indeg.set(b.id, 0));
  fwd.forEach((e) => indeg.set(e.to, indeg.get(e.to)! + 1));
  const queue = blocks.filter((b) => connected.has(b.id) && indeg.get(b.id) === 0).map((b) => b.id);
  queue.forEach((n) => layer.set(n, 0));
  while (queue.length) {
    const n = queue.shift();
    for (const e of fwd) {
      if (e.from !== n) continue;
      layer.set(e.to, Math.max(layer.get(e.to) ?? 0, layer.get(n)! + 1));
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  // Pull pure sources right next to what they feed, so e.g. a laptop input
  // doesn't sit three columns away from the switcher it plugs into.
  blocks.forEach((b) => {
    if (!connected.has(b.id) || ins.get(b.id)!.length) return;
    const targets = outs.get(b.id)!.filter((m) => !back.has(`${b.id}>${m}`));
    if (targets.length) layer.set(b.id, Math.max(0, Math.min(...targets.map((m) => layer.get(m)!)) - 1));
  });

  const layerIds = Array.from(new Set(Array.from(layer.values()))).sort((a, b) => a - b);
  const colOf = new Map<any, number>();
  layer.forEach((l, n) => colOf.set(n, layerIds.indexOf(l)));
  const colCount = layerIds.length;

  // --- Order within columns: barycenter sweeps (global, then per band) ---
  const columns: any[][] = Array.from({ length: colCount }, () => []);
  blocks.forEach((b) => { if (colOf.has(b.id)) columns[colOf.get(b.id)!].push(b.id); });
  const rank = new Map<any, number>();
  const rerank = () => columns.forEach((col) => col.forEach((n, i) => rank.set(n, i)));
  rerank();
  const bary = (n: any, dir: "in" | "out") => {
    const nb = (dir === "in" ? ins : outs).get(n)!.filter((m) => rank.has(m));
    return nb.length ? nb.reduce((s, m) => s + rank.get(m)!, 0) / nb.length : rank.get(n)!;
  };
  for (let sweep = 0; sweep < 6; sweep++) {
    const order = sweep % 2 === 0 ? columns.map((_, i) => i) : columns.map((_, i) => colCount - 1 - i);
    for (const c of order) {
      const dir = sweep % 2 === 0 ? "in" : "out";
      const scored = columns[c].map((n) => ({ n, s: bary(n, dir) }));
      scored.sort((a, b) => a.s - b.s);
      columns[c] = scored.map((x) => x.n);
      rerank();
    }
  }

  // --- Column x positions ---
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const colW = columns.map((col) => Math.max(120, ...col.map((n) => byId.get(n)!.w)));
  const colX: number[] = [];
  let x = origin.x + LAYOUT.PAD;
  colW.forEach((w, i) => { colX[i] = x; x += w + LAYOUT.COL_GAP; });

  // --- Bands ---
  const positions = new Map<any, { x: number; y: number }>();
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  let bandTop = origin.y;
  for (const g of groups) {
    const top = bandTop + LAYOUT.LABEL;
    const colBottom = new Array(colCount).fill(top);
    let bottom = top;
    for (let c = 0; c < colCount; c++) {
      const inBand = columns[c].filter((n) => groupOf.get(n) === g.key);
      for (const n of inBand) {
        const b = byId.get(n)!;
        // Level with what feeds it (same band), when there's room.
        const feeders = ins.get(n)!.filter((m) => groupOf.get(m) === g.key && positions.has(m)).map((m) => positions.get(m)!);
        const want = feeders.length ? feeders.reduce((s, p) => s + p.y, 0) / feeders.length : top;
        const y = Math.max(want, colBottom[c]);
        positions.set(n, { x: colX[c], y });
        colBottom[c] = y + b.h + LAYOUT.ROW_GAP;
        bottom = Math.max(bottom, y + b.h);
      }
    }
    // Unconnected blocks: a row under the connected part of the band.
    const isolated = g.blocks.filter((b) => !colOf.has(b.id));
    if (isolated.length) {
      const hasConnected = g.blocks.some((b) => colOf.has(b.id));
      let ix = origin.x + LAYOUT.PAD;
      const iy = hasConnected ? bottom + LAYOUT.ROW_GAP : top;
      let rowH = 0;
      for (const b of isolated) {
        positions.set(b.id, { x: ix, y: iy });
        ix += b.w + LAYOUT.ISOLATED_GAP;
        rowH = Math.max(rowH, b.h);
      }
      bottom = Math.max(bottom, iy + rowH);
    }
    const inBand = g.blocks.map((b) => ({ b, p: positions.get(b.id)! }));
    const minX = Math.min(...inBand.map(({ p }) => p.x)) - LAYOUT.PAD;
    const maxX = Math.max(...inBand.map(({ b, p }) => p.x + b.w)) + LAYOUT.PAD;
    boxes.set(g.key, { x: minX, y: bandTop, w: maxX - minX, h: bottom + LAYOUT.PAD - bandTop });
    bandTop = bottom + LAYOUT.PAD + LAYOUT.BAND_GAP;
  }

  return { positions, boxes, bottom: bandTop - LAYOUT.BAND_GAP };
}
