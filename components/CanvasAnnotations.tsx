'use client';
// Shared canvas annotation system (Text / Shape / Pencil / Highlight / Eraser),
// extracted from the Signal Flow builder so the Room Designer and Rack Builder
// canvases get the same annotate commands. The host page supplies a screen→canvas
// coordinate mapping; annotations are stored in that canvas space.
import React, { useState, useRef, useEffect } from 'react';

export type AnnTool = "text" | "shape" | "pencil" | "highlight" | "eraser" | "dimension";

const TOOL_COLORS = ["#1e293b", "#8b5cf6", "#ef4444", "#10b981", "#f59e0b", "#3b82f6"];
const HL_COLORS = ["#fbbf24", "#a3e635", "#f472b6", "#67e8f9"];
const STROKE_WIDTHS = [2, 3.5, 5];
const ERASER_SIZES = [
  { r: 8, d: 10, label: "Small eraser" },
  { r: 15, d: 16, label: "Medium eraser" },
  { r: 26, d: 24, label: "Large eraser" },
];

export function useCanvasAnnotations(opts: {
  getPoint: (e: React.MouseEvent) => { x: number; y: number } | null;
  getZoom?: () => number;
  // Converts a distance in the host's own canvas-space units (whatever
  // getPoint returns) into a display string for the Dimension tool — e.g.
  // Room Designer passes pixels/planScale through its feet-inches formatter.
  // Hosts that don't pass one (no real-world scale to convert against) just
  // get the raw distance labeled "px". The canvas key (e.g. "plan"/"ceil"/
  // "elev" for Room Designer's multi-canvas hosts) is passed through too —
  // different canvases can run at entirely different px-per-foot scales
  // (Room Designer's Elevations pane recomputes its own scale per view,
  // independent of the Floor Plan's), so a host with more than one scale
  // needs to know which canvas a given dimension was measured on.
  formatDistance?: (dist: number, canvasKey?: string) => string;
}) {
  const { getPoint } = opts;
  const getZoom = opts.getZoom ?? (() => 1);
  const formatDistance = opts.formatDistance ?? ((d: number) => `${d.toFixed(1)} px`);

  // Multi-canvas support: a host with several independent canvases (e.g. Room
  // Designer's Floor Plan / Ceiling Plan / Elevations) can tag each one with
  // a `data-rd-canvas="<key>"` attribute and wire this same hook's handlers
  // into all of them — annotations are tagged with whichever canvas they were
  // drawn on and `layerFor(key)` renders only that canvas's own set. A host
  // with a single canvas (Rack Planner) never gets this attribute, so every
  // annotation defaults to "plan" and the plain `layer` (= layerFor("plan"))
  // covers it exactly as before.
  const currentCanvasRef = useRef<string>("plan");
  const canvasKeyOf = (e: React.MouseEvent): string => {
    const el = (e.target as Element)?.closest?.("[data-rd-canvas]") as Element | null;
    return el?.getAttribute("data-rd-canvas") || "plan";
  };

  const [annotations, setAnnotations] = useState<any[]>([]);
  const annotationsRef = useRef<any[]>([]);
  annotationsRef.current = annotations;
  const [liveAnnot, setLiveAnnot] = useState<any>(null);
  const [activeTool, setActiveTool] = useState<AnnTool | null>(null);
  const [shapeSubtype, setShapeSubtype] = useState("rect");
  const [strokeW, setStrokeW] = useState(2);
  const [toolColor, setToolColor] = useState("#8b5cf6");
  const [hlSubtype, setHlSubtype] = useState<"rect" | "freehand">("rect");
  const [hlColor, setHlColor] = useState("#fbbf24");
  const [eraserSize, setEraserSize] = useState(15);
  const [eraserCursor, setEraserCursor] = useState<{ x: number; y: number } | null>(null);
  const [selectedAnnotId, setSelectedAnnotId] = useState<string | null>(null);
  const [selectedAnnotIds, setSelectedAnnotIds] = useState<Set<string>>(new Set());
  const annotationUndo = useRef<any[][]>([]);
  const annotationRedo = useRef<any[][]>([]);

  const annotationBounds = (a: any) => {
    if (a.type === "text") {
      const size = a.size || 14, w = String(a.text || "").length * size * 0.55;
      const x1 = a.align === "center" ? a.x-w/2 : a.align === "right" ? a.x-w : a.x;
      return {x1,y1:a.y-size,x2:x1+w,y2:a.y};
    }
    if (a.type === "highlight" && a.sub !== "freehand") return {x1:a.x,y1:a.y,x2:a.x+(a.w||0),y2:a.y+(a.h||0)};
    const pts = a.pts || (a.d ? [...String(a.d).matchAll(/[ML](-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m:any)=>({x:+m[1],y:+m[2]})) : null);
    if (pts?.length) return {x1:Math.min(...pts.map((p:any)=>p.x)),y1:Math.min(...pts.map((p:any)=>p.y)),x2:Math.max(...pts.map((p:any)=>p.x)),y2:Math.max(...pts.map((p:any)=>p.y))};
    return {x1:Math.min(a.x1,a.x2),y1:Math.min(a.y1,a.y2),x2:Math.max(a.x1,a.x2),y2:Math.max(a.y1,a.y2)};
  };
  const beginAnnotationChange = () => { annotationUndo.current.push(annotationsRef.current.map(a=>({...a,pts:a.pts?.map((p:any)=>({...p}))}))); annotationUndo.current=annotationUndo.current.slice(-30); annotationRedo.current=[]; };
  const undoAnnotations = () => { const snap=annotationUndo.current.pop(); if(!snap)return false; annotationRedo.current.push(annotationsRef.current); setAnnotations(snap); return true; };
  const redoAnnotations = () => { const snap=annotationRedo.current.pop(); if(!snap)return false; annotationUndo.current.push(annotationsRef.current); setAnnotations(snap); return true; };
  const selectInRect = (x1:number,y1:number,x2:number,y2:number,isWindow:boolean) => {
    const ids = new Set<string>();
    annotations.forEach(a=>{const b=annotationBounds(a);const hit=isWindow?(b.x1>=x1&&b.x2<=x2&&b.y1>=y1&&b.y2<=y2):!(b.x2<x1||b.x1>x2||b.y2<y1||b.y1>y2);if(hit)ids.add(a.id);});
    setSelectedAnnotIds(ids); setSelectedAnnotId(ids.size===1?[...ids][0]:null);
  };
  const translateSelected = (dx:number,dy:number) => setAnnotations(prev=>prev.map(a=>{
    if(!selectedAnnotIds.has(a.id))return a;
    if(a.type==="text")return {...a,x:a.x+dx,y:a.y+dy};
    if(a.type==="highlight"&&a.sub!=="freehand")return {...a,x:a.x+dx,y:a.y+dy};
    if(a.pts)return {...a,pts:a.pts.map((p:any)=>({x:p.x+dx,y:p.y+dy}))};
    if(a.d)return {...a,d:String(a.d).replace(/([ML])(-?\d+\.?\d*),(-?\d+\.?\d*)/g,(_:string,c:string,x:string,y:string)=>`${c}${(+x+dx).toFixed(1)},${(+y+dy).toFixed(1)}`)};
    return {...a,x1:a.x1+dx,y1:a.y1+dy,x2:a.x2+dx,y2:a.y2+dy};
  }));
  const clearAnnotationSelection = () => { setSelectedAnnotIds(new Set()); setSelectedAnnotId(null); };

  // Text editor state
  const [textInput, setTextInput] = useState<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const [textValue, setTextValue] = useState("");
  const [textFontSize, setTextFontSize] = useState(10);
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textAlign, setTextAlign] = useState<"left" | "center" | "right">("left");
  const [editingAnnotId, setEditingAnnotId] = useState<string | null>(null);

  const drawRef = useRef<{ sx: number; sy: number; pts?: { x: number; y: number }[] } | null>(null);
  // Dimension tool draft — a 3-click flow (AutoCAD DIMLINEAR-style): click 1
  // sets the first extension line's origin, click 2 the second, click 3 sets
  // how far the dimension line sits off that segment (its perpendicular
  // offset). Only x1/y1 present = awaiting click 2; all four = awaiting the
  // offset-placement click.
  const dimRef = useRef<{ x1: number; y1: number; x2?: number; y2?: number } | null>(null);
  const perpOffset = (x1: number, y1: number, x2: number, y2: number, px: number, py: number) => {
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    return (px - x1) * nx + (py - y1) * ny;
  };
  const dimGeometry = (x1: number, y1: number, x2: number, y2: number, offset: number) => {
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const d1 = { x: x1 + nx * offset, y: y1 + ny * offset };
    const d2 = { x: x2 + nx * offset, y: y2 + ny * offset };
    const gap = 3, overshoot = 4, sign = offset >= 0 ? 1 : -1;
    const e1a = { x: x1 + nx * gap * sign, y: y1 + ny * gap * sign };
    const e1b = { x: x1 + nx * (Math.abs(offset) + overshoot) * sign, y: y1 + ny * (Math.abs(offset) + overshoot) * sign };
    const e2a = { x: x2 + nx * gap * sign, y: y2 + ny * gap * sign };
    const e2b = { x: x2 + nx * (Math.abs(offset) + overshoot) * sign, y: y2 + ny * (Math.abs(offset) + overshoot) * sign };
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    const textAngle = angleDeg > 90 || angleDeg < -90 ? angleDeg + 180 : angleDeg;
    return { d1, d2, e1a, e1b, e2a, e2b, midX: (d1.x + d2.x) / 2, midY: (d1.y + d2.y) / 2, angleDeg, textAngle, length: L };
  };
  const annotDragRef = useRef<{x:number;y:number;ids:Set<string>}|null>(null);
  const annotDragMoved = useRef(false);
  const annotIdRef = useRef(1);
  const textValueRef = useRef("");
  const textInputRef = useRef<{ x: number; y: number } | null>(null);
  const editingAnnotIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the id counter ahead of any loaded annotations
  useEffect(() => {
    let max = 0;
    annotations.forEach((a: any) => {
      const m = /^a(\d+)$/.exec(String(a.id));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    if (max >= annotIdRef.current) annotIdRef.current = max + 1;
  }, [annotations]);

  // ── Text commit ──────────────────────────────────────────────
  const commitText = () => {
    const editId = editingAnnotIdRef.current;
    const val = textValueRef.current;
    const ti = textInputRef.current;
    if (ti && val.trim()) {
      beginAnnotationChange();
      if (editId) {
        setAnnotations(prev => prev.map((a: any) => a.id === editId
          ? { ...a, text: val, color: toolColor, size: textFontSize, bold: textBold, italic: textItalic, align: textAlign }
          : a));
      } else {
        setAnnotations(prev => [...prev, { id: `a${annotIdRef.current++}`, type: "text", x: ti.x, y: ti.y + textFontSize, text: val, color: toolColor, size: textFontSize, bold: textBold, italic: textItalic, align: textAlign, canvas: currentCanvasRef.current }]);
      }
    }
    textInputRef.current = null;
    setTextInput(null); setTextValue(""); setEditingAnnotId(null); editingAnnotIdRef.current = null;
  };
  const commitTextRef = useRef(commitText);
  commitTextRef.current = commitText;

  // Focus + autosize when the editor opens
  useEffect(() => {
    if (!textInput || !textareaRef.current) return;
    const el = textareaRef.current;
    el.focus(); el.select();
    el.style.height = "auto"; el.style.height = el.scrollHeight + "px";
  }, [textInput?.clientX, textInput?.clientY]);

  // Save on click outside the editor
  useEffect(() => {
    if (!textInput) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-anntexteditor]')) commitTextRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [textInput?.clientX, textInput?.clientY]);

  // ── Eraser: partial cuts ─────────────────────────────────────
  const cutChain = (ptsIn: { x: number; y: number }[], x: number, y: number, R: number, closed = false): { touched: boolean; runs: { x: number; y: number }[][] } => {
    const pts = closed && ptsIn.length > 1 ? [...ptsIn, ptsIn[0]] : ptsIn;
    const step = Math.max(2, R / 4);
    const dense: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) { dense.push(pts[0]); continue; }
      const q = pts[i - 1], p = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / step));
      for (let k = 1; k <= n; k++) dense.push({ x: q.x + (p.x - q.x) * k / n, y: q.y + (p.y - q.y) * k / n });
    }
    const runs: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    let touched = false;
    for (const p of dense) {
      if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) <= R * R) { touched = true; if (cur.length >= 2) runs.push(cur); cur = []; }
      else cur.push(p);
    }
    if (cur.length >= 2) runs.push(cur);
    if (closed && touched && runs.length > 1 && cur.length >= 2 && runs[0][0] === dense[0]) {
      const tail = runs.pop()!;
      runs[0] = [...tail, ...runs[0]];
    }
    return { touched, runs };
  };

  const eraseAtPoint = (x: number, y: number) => {
    const R = eraserSize;
    const pathPts = (d: any) => [...String(d || "").matchAll(/[ML](-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m: any) => ({ x: +m[1], y: +m[2] }));
    const toD = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    setAnnotations(prev => {
      const out: any[] = [];
      let changed = false;
      for (const a of prev) {
        if ((a.canvas || "plan") !== currentCanvasRef.current) { out.push(a); continue; }
        if (a.type === "pencil" || (a.type === "highlight" && a.sub === "freehand")) {
          const { touched, runs } = cutChain(pathPts(a.d), x, y, R + (a.type === "highlight" ? 8 : (a.sw || 2) / 2));
          if (!touched) { out.push(a); continue; }
          changed = true;
          runs.forEach(r => out.push({ ...a, id: `a${annotIdRef.current++}`, d: toD(r) }));
          continue;
        }
        if (a.type === "highlight") {
          if (x >= a.x - R && x <= a.x + (a.w || 0) + R && y >= a.y - R && y <= a.y + (a.h || 0) + R) { changed = true; continue; }
          out.push(a); continue;
        }
        if (a.type === "text") {
          const size = a.size || 14;
          const wTxt = String(a.text || "").length * size * 0.55;
          const x0 = a.align === "center" ? a.x - wTxt / 2 : a.align === "right" ? a.x - wTxt : a.x;
          if (x >= x0 - R && x <= x0 + wTxt + R && y >= a.y - size - R && y <= a.y + R) { changed = true; continue; }
          out.push(a); continue;
        }
        if (a.type === "dimension") {
          // A dimension is one semantic unit (extension lines + dimension
          // line + label) rather than a cuttable path — the eraser just
          // removes the whole thing if it touches any of its segments.
          const distToSeg = (px:number,py:number,ax:number,ay:number,bx:number,by:number) => {
            const dx=bx-ax, dy=by-ay; const L2=dx*dx+dy*dy;
            const t = L2 ? Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/L2)) : 0;
            return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
          };
          const g = dimGeometry(a.x1, a.y1, a.x2, a.y2, a.offset || 0);
          const segs: [number,number,number,number][] = [
            [g.e1a.x,g.e1a.y,g.e1b.x,g.e1b.y], [g.e2a.x,g.e2a.y,g.e2b.x,g.e2b.y], [g.d1.x,g.d1.y,g.d2.x,g.d2.y],
          ];
          if (segs.some(([ax,ay,bx,by]) => distToSeg(x,y,ax,ay,bx,by) <= R)) { changed = true; continue; }
          out.push(a); continue;
        }
        if (a.type === "shape") {
          let chain: { x: number; y: number }[]; let closed = false;
          if (a.sub === "polyline") chain = a.pts || [];
          else if (a.sub === "rect") {
            const x1 = Math.min(a.x1, a.x2), x2 = Math.max(a.x1, a.x2), y1 = Math.min(a.y1, a.y2), y2 = Math.max(a.y1, a.y2);
            chain = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }]; closed = true;
          } else if (a.sub === "circle") {
            const cx = (a.x1 + a.x2) / 2, cy = (a.y1 + a.y2) / 2, rx = Math.abs(a.x2 - a.x1) / 2, ry = Math.abs(a.y2 - a.y1) / 2;
            chain = Array.from({ length: 49 }, (_, i) => { const t = i / 48 * 2 * Math.PI; return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }; });
          } else if (a.sub === "triangle") {
            const minX = Math.min(a.x1, a.x2), maxX = Math.max(a.x1, a.x2), minY = Math.min(a.y1, a.y2), maxY = Math.max(a.y1, a.y2);
            chain = [{ x: (minX + maxX) / 2, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }]; closed = true;
          } else chain = [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }]; // line / arrow
          const { touched, runs } = cutChain(chain, x, y, R + (a.sw || 2) / 2, closed);
          if (!touched) { out.push(a); continue; }
          changed = true;
          if (a.sub === "line" || a.sub === "arrow") {
            runs.forEach(r => {
              const p1 = r[0], p2 = r[r.length - 1];
              const keepsHead = a.sub === "arrow" && Math.hypot(p2.x - a.x2, p2.y - a.y2) < 0.5;
              out.push({ ...a, id: `a${annotIdRef.current++}`, sub: keepsHead ? "arrow" : "line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
            });
          } else {
            runs.forEach(r => out.push({ type: "shape", sub: "polyline", pts: r, color: a.color, sw: a.sw, id: `a${annotIdRef.current++}` }));
          }
          continue;
        }
        out.push(a);
      }
      return changed ? out : prev;
    });
  };

  // ── Drawing handlers (host wires these into its canvas) ──────
  const snapTo45 = (ax: number, ay: number, x: number, y: number) => {
    const dx = x - ax, dy = y - ay;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return { x, y };
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: ax + dist * Math.cos(ang), y: ay + dist * Math.sin(ang) };
  };

  const finishPolyline = () => {
    const pts = drawRef.current?.pts ?? [];
    const clean: { x: number; y: number }[] = [];
    for (const p of pts) {
      const prev = clean[clean.length - 1];
      if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 3) clean.push(p);
    }
    if (clean.length >= 2) {
      beginAnnotationChange();
      setAnnotations(prev => [...prev, { type: "shape", sub: "polyline", pts: clean, color: toolColor, sw: strokeW, canvas: currentCanvasRef.current, id: `a${annotIdRef.current++}` }]);
    }
    setLiveAnnot(null);
    drawRef.current = null;
  };

  const handleDown = (e: React.MouseEvent) => {
    if (!activeTool || e.button !== 0) return;
    e.stopPropagation();
    currentCanvasRef.current = canvasKeyOf(e);
    const p = getPoint(e); if (!p) return;
    const { x, y } = p;
    if (activeTool === "eraser") {
      beginAnnotationChange();
      drawRef.current = { sx: x, sy: y };
      return;
    }
    if (activeTool === "dimension") {
      if (!dimRef.current) {
        dimRef.current = { x1: x, y1: y };
      } else if (dimRef.current.x2 === undefined) {
        // Shift constrains the measured segment itself to a straight
        // horizontal/vertical/45° line (same snap the line/arrow shapes
        // use), not the offset placement that follows.
        const end = e.shiftKey ? snapTo45(dimRef.current.x1, dimRef.current.y1, x, y) : { x, y };
        dimRef.current.x2 = end.x; dimRef.current.y2 = end.y;
      } else {
        const { x1, y1, x2, y2 } = dimRef.current as { x1: number; y1: number; x2: number; y2: number };
        const offset = perpOffset(x1, y1, x2, y2, x, y);
        beginAnnotationChange();
        setAnnotations(prev => [...prev, { type: "dimension", x1, y1, x2, y2, offset, color: toolColor, sw: strokeW, canvas: currentCanvasRef.current, id: `a${annotIdRef.current++}` }]);
        setLiveAnnot(null);
        dimRef.current = null;
      }
      return;
    }
    if (activeTool === "text") {
      if (textInputRef.current) commitTextRef.current();
      textInputRef.current = { x, y };
      textValueRef.current = "";
      setTextInput({ x, y, clientX: e.clientX, clientY: e.clientY });
      setTextValue("");
      return;
    }
    if (activeTool === "shape" && shapeSubtype === "polyline") {
      if (drawRef.current?.pts) {
        const prev = drawRef.current.pts[drawRef.current.pts.length - 1];
        drawRef.current.pts.push(e.shiftKey ? snapTo45(prev.x, prev.y, x, y) : { x, y });
      } else {
        drawRef.current = { sx: x, sy: y, pts: [{ x, y }] };
      }
      setLiveAnnot({ type: "shape", sub: "polyline", pts: [...drawRef.current.pts!], color: toolColor, sw: strokeW });
      return;
    }
    drawRef.current = { sx: x, sy: y, pts: (activeTool === "pencil" || (activeTool === "highlight" && hlSubtype === "freehand")) ? [{ x, y }] : undefined };
  };

  const handleMove = (e: React.MouseEvent) => {
    if (annotDragRef.current && !activeTool) {
      const p=getPoint(e); if(!p)return;
      const dx=p.x-annotDragRef.current.x, dy=p.y-annotDragRef.current.y;
      if(Math.hypot(dx,dy)>0.1) annotDragMoved.current=true;
      const ids=annotDragRef.current.ids;
      setAnnotations(prev=>prev.map(a=>{
        if(!ids.has(a.id))return a;
        if(a.type==="text")return {...a,x:a.x+dx,y:a.y+dy};
        if(a.type==="highlight"&&a.sub!=="freehand")return {...a,x:a.x+dx,y:a.y+dy};
        if(a.pts)return {...a,pts:a.pts.map((q:any)=>({x:q.x+dx,y:q.y+dy}))};
        if(a.d)return {...a,d:String(a.d).replace(/([ML])(-?\d+\.?\d*),(-?\d+\.?\d*)/g,(_:string,c:string,x:string,y:string)=>`${c}${(+x+dx).toFixed(1)},${(+y+dy).toFixed(1)}`)};
        return {...a,x1:a.x1+dx,y1:a.y1+dy,x2:a.x2+dx,y2:a.y2+dy};
      }));
      annotDragRef.current={...annotDragRef.current,x:p.x,y:p.y};
      return;
    }
    if (!activeTool) return;
    currentCanvasRef.current = canvasKeyOf(e);
    if (activeTool === "eraser") {
      const p = getPoint(e); if (!p) return;
      setEraserCursor(p);
      // A click only positions the eraser. Require a real drag before cutting,
      // which prevents an entire small annotation disappearing on pointer-down.
      if (drawRef.current && Math.hypot(p.x-drawRef.current.sx,p.y-drawRef.current.sy) > 1) eraseAtPoint(p.x, p.y);
      return;
    }
    if (activeTool === "dimension" && dimRef.current) {
      const p = getPoint(e); if (!p) return;
      const { x1: dx1, y1: dy1, x2: dx2, y2: dy2 } = dimRef.current;
      if (dx2 === undefined || dy2 === undefined) {
        const end = e.shiftKey ? snapTo45(dx1, dy1, p.x, p.y) : { x: p.x, y: p.y };
        setLiveAnnot({ type: "dimension", x1: dx1, y1: dy1, x2: end.x, y2: end.y, offset: 0, color: toolColor, sw: strokeW });
      } else {
        const offset = perpOffset(dx1, dy1, dx2, dy2, p.x, p.y);
        setLiveAnnot({ type: "dimension", x1: dx1, y1: dy1, x2: dx2, y2: dy2, offset, color: toolColor, sw: strokeW });
      }
      return;
    }
    if (!drawRef.current) return;
    const p = getPoint(e); if (!p) return;
    const { x, y } = p;
    const { sx, sy } = drawRef.current;
    if (activeTool === "pencil") {
      drawRef.current.pts!.push({ x, y });
      const d = drawRef.current.pts!.map((q, i) => `${i === 0 ? "M" : "L"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
      setLiveAnnot({ type: "pencil", d, color: toolColor, sw: strokeW });
    } else if (activeTool === "highlight") {
      if (hlSubtype === "freehand") {
        drawRef.current.pts!.push({ x, y });
        const d = drawRef.current.pts!.map((q, i) => `${i === 0 ? "M" : "L"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
        setLiveAnnot({ type: "highlight", sub: "freehand", d, color: hlColor });
      } else {
        setLiveAnnot({ type: "highlight", sub: "rect", x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy), color: hlColor });
      }
    } else if (activeTool === "shape") {
      if (shapeSubtype === "polyline") {
        if (drawRef.current.pts) {
          const prev = drawRef.current.pts[drawRef.current.pts.length - 1];
          const end = e.shiftKey ? snapTo45(prev.x, prev.y, x, y) : { x, y };
          setLiveAnnot({ type: "shape", sub: "polyline", pts: [...drawRef.current.pts, end], color: toolColor, sw: strokeW });
        }
      } else {
        const end = e.shiftKey && (shapeSubtype === "line" || shapeSubtype === "arrow") ? snapTo45(sx, sy, x, y) : { x, y };
        setLiveAnnot({ type: "shape", sub: shapeSubtype, x1: sx, y1: sy, x2: end.x, y2: end.y, color: toolColor, sw: strokeW });
      }
    }
  };

  const handleUp = () => {
    if(annotDragRef.current){annotDragRef.current=null;return;}
    if (!activeTool || !drawRef.current) return;
    if (activeTool === "shape" && shapeSubtype === "polyline") return;
    if (liveAnnot) {
      beginAnnotationChange();
      setAnnotations(prev => [...prev, { ...liveAnnot, canvas: currentCanvasRef.current, id: `a${annotIdRef.current++}` }]);
      setLiveAnnot(null);
    }
    drawRef.current = null;
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (activeTool === "shape" && shapeSubtype === "polyline" && drawRef.current?.pts) {
      e.stopPropagation();
      finishPolyline();
    }
  };

  const handleLeave = () => { if (activeTool === "eraser") setEraserCursor(null); annotDragRef.current=null; };

  // ── Keyboard: Escape / Delete / Enter (capture phase so the host page's own
  // handlers don't double-act on the same key) ──────────────────
  const keyRef = useRef<any>({});
  keyRef.current = { activeTool, selectedAnnotId, selectedAnnotIds, textInput, finishPolyline, shapeSubtype };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keyRef.current;
      const tag = (e.target as HTMLElement).tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;
      if (!isTyping && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { if ((e.shiftKey ? redoAnnotations() : undoAnnotations())) { e.preventDefault(); e.stopPropagation(); } return; }
      if (!isTyping && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { if (redoAnnotations()) { e.preventDefault(); e.stopPropagation(); } return; }
      if (e.key === "Escape") {
        if (k.textInput) { commitTextRef.current(); e.stopPropagation(); return; }
        if (k.activeTool) {
          if (k.activeTool === "shape" && k.shapeSubtype === "polyline" && drawRef.current?.pts) k.finishPolyline();
          setActiveTool(null); setLiveAnnot(null); setEraserCursor(null); drawRef.current = null; dimRef.current = null;
          e.stopPropagation(); return;
        }
        if (k.selectedAnnotId) { setSelectedAnnotId(null); e.stopPropagation(); return; }
        return;
      }
      if (e.key === "Enter" && !isTyping && k.activeTool === "shape" && k.shapeSubtype === "polyline" && drawRef.current?.pts) {
        e.preventDefault(); e.stopPropagation();
        k.finishPolyline(); setActiveTool(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !isTyping && (k.selectedAnnotId || k.selectedAnnotIds.size)) {
        e.preventDefault(); e.stopPropagation();
        beginAnnotationChange();
        setAnnotations(prev => prev.filter((a: any) => !k.selectedAnnotIds.has(a.id) && a.id !== k.selectedAnnotId));
        clearAnnotationSelection();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, []);

  // ── Rendering ────────────────────────────────────────────────
  const annCursorStyle = activeTool === "eraser" ? "none" : activeTool === "text" ? "text" : activeTool ? "crosshair" : null;

  const renderAnnotation = (a: any, isLive = false) => {
    const key = isLive ? "live" : a.id;
    const isSel = !isLive && (selectedAnnotId === a.id || selectedAnnotIds.has(a.id));
    const selRing: any = isSel ? { filter: "drop-shadow(0 0 3px #8b5cf6)" } : {};
    // visiblePainted keeps annotations clickable even inside a pointer-events:none overlay
    selRing.pointerEvents = "visiblePainted";
    const cursor = activeTool ? (activeTool === "eraser" ? "none" : "crosshair") : "move";
    const startDrag = (e:React.MouseEvent) => { if(activeTool||isLive||e.button!==0)return;e.stopPropagation();const p=getPoint(e);if(!p)return;const ids=selectedAnnotIds.has(a.id)?new Set(selectedAnnotIds):new Set([a.id]);setSelectedAnnotIds(ids);setSelectedAnnotId(ids.size===1?a.id:null);beginAnnotationChange();annotDragMoved.current=false;annotDragRef.current={x:p.x,y:p.y,ids}; };
    const sel = (e: React.MouseEvent) => { e.stopPropagation(); if(annotDragMoved.current){annotDragMoved.current=false;return;} if (!activeTool) { setSelectedAnnotId(a.id); setSelectedAnnotIds(new Set([a.id])); } };
    if (a.type === "pencil") return (
      <path key={key} d={a.d} fill="none" stroke={a.color || "#374151"} strokeWidth={a.sw || 2} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} style={{ cursor, ...selRing }} onMouseDown={startDrag} onClick={sel} />
    );
    if (a.type === "highlight") {
      if (a.sub === "freehand") return (
        <path key={key} d={a.d} fill="none" stroke={a.color || "#fbbf24"} strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" opacity={0.4} style={{ cursor, ...selRing }} onMouseDown={startDrag} onClick={sel} />
      );
      return (
        <rect key={key} x={a.x} y={a.y} width={a.w || 0} height={a.h || 0} fill={a.color || "#fbbf24"} opacity={0.35} rx={3} style={{ cursor, ...selRing }} onMouseDown={startDrag} onClick={sel} />
      );
    }
    if (a.type === "shape") {
      const { sub, x1, y1, x2, y2, color, sw } = a;
      const stroke = color || "#374151"; const sw2 = sw || 2;
      const props = { stroke, strokeWidth: sw2, fill: "none", style: { cursor, ...selRing }, onMouseDown:startDrag, onClick: sel };
      if (sub === "rect") return <rect key={key} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} rx={3} {...props} />;
      if (sub === "circle") { const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx2 = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2; return <ellipse key={key} cx={cx} cy={cy} rx={rx2} ry={ry} {...props} />; }
      if (sub === "triangle") {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        return <polygon key={key} points={`${(minX + maxX) / 2},${minY} ${maxX},${maxY} ${minX},${maxY}`} strokeLinejoin="round" {...props} />;
      }
      if (sub === "polyline") return <polyline key={key} points={(a.pts || []).map((p: any) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} strokeLinecap="round" strokeLinejoin="round" {...props} />;
      if (sub === "line") return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} strokeLinecap="round" {...props} />;
      if (sub === "arrow") {
        const ang = Math.atan2(y2 - y1, x2 - x1), hl = 14, ha = Math.PI / 6;
        const ax1 = x2 - hl * Math.cos(ang - ha), ay1 = y2 - hl * Math.sin(ang - ha), ax2 = x2 - hl * Math.cos(ang + ha), ay2 = y2 - hl * Math.sin(ang + ha);
        return <g key={key} style={{ cursor, ...selRing }} onMouseDown={startDrag} onClick={sel}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw2} strokeLinecap="round" />
          <polygon points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`} fill={stroke} />
        </g>;
      }
    }
    if (a.type === "dimension") {
      const g = dimGeometry(a.x1, a.y1, a.x2, a.y2, a.offset || 0);
      const stroke = a.color || "#374151"; const sw2 = a.sw || 1.5;
      const headAt = (tipX: number, tipY: number, fromX: number, fromY: number) => {
        const ang = Math.atan2(tipY - fromY, tipX - fromX), hl = 8, ha = Math.PI / 7;
        return `${tipX},${tipY} ${tipX - hl * Math.cos(ang - ha)},${tipY - hl * Math.sin(ang - ha)} ${tipX - hl * Math.cos(ang + ha)},${tipY - hl * Math.sin(ang + ha)}`;
      };
      return (
        <g key={key} style={{ cursor, ...selRing }} onMouseDown={startDrag} onClick={sel}>
          <line x1={g.e1a.x} y1={g.e1a.y} x2={g.e1b.x} y2={g.e1b.y} stroke={stroke} strokeWidth={1} />
          <line x1={g.e2a.x} y1={g.e2a.y} x2={g.e2b.x} y2={g.e2b.y} stroke={stroke} strokeWidth={1} />
          <line x1={g.d1.x} y1={g.d1.y} x2={g.d2.x} y2={g.d2.y} stroke={stroke} strokeWidth={sw2} />
          <polygon points={headAt(g.d1.x, g.d1.y, g.d2.x, g.d2.y)} fill={stroke} />
          <polygon points={headAt(g.d2.x, g.d2.y, g.d1.x, g.d1.y)} fill={stroke} />
          <text x={g.midX} y={g.midY} dy={-4} textAnchor="middle" fontSize={11} fill={stroke} fontFamily="'JetBrains Mono',monospace"
            transform={`rotate(${g.textAngle}, ${g.midX}, ${g.midY})`}>
            {formatDistance(g.length, a.canvas || currentCanvasRef.current)}
          </text>
        </g>
      );
    }
    if (a.type === "text") return (
      <text key={key} x={a.x} y={a.y} fontSize={a.size || 10} fill={a.color || "#374151"} fontFamily="Inter, sans-serif" fontWeight={a.bold ? "700" : "400"} fontStyle={a.italic ? "italic" : "normal"} textAnchor={a.align === "center" ? "middle" : a.align === "right" ? "end" : "start"} style={{ cursor, ...selRing }} onMouseDown={startDrag}
        onClick={sel}
        onDoubleClick={e => {
          e.stopPropagation();
          if (activeTool) return;
          textValueRef.current = a.text;
          setTextValue(a.text);
          setTextFontSize(a.size || 14);
          setTextBold(a.bold || false);
          setTextItalic(a.italic || false);
          setTextAlign(a.align || "left");
          setToolColor(a.color || "#374151");
          editingAnnotIdRef.current = a.id;
          setEditingAnnotId(a.id);
          textInputRef.current = { x: a.x, y: a.y - (a.size || 14) };
          setTextInput({ x: a.x, y: a.y - (a.size || 14), clientX: e.clientX, clientY: e.clientY });
        }}
      >{a.text}</text>
    );
    return null;
  };

  // Renders only the annotations tagged for one canvas — see the
  // multi-canvas note above `currentCanvasRef`. `layer` (below) is just
  // `layerFor("plan")`, kept as the default single-canvas export.
  const layerFor = (canvasKey: string) => (
    <g>
      {annotations.filter((a: any) => (a.canvas || "plan") === canvasKey && a.id !== editingAnnotId).map(a => renderAnnotation(a))}
      {liveAnnot && currentCanvasRef.current === canvasKey && renderAnnotation(liveAnnot, true)}
      {activeTool === "eraser" && eraserCursor && currentCanvasRef.current === canvasKey && (
        <circle cx={eraserCursor.x} cy={eraserCursor.y} r={eraserSize} fill="rgba(59,130,246,0.05)" stroke="#2563eb" strokeWidth={2 / getZoom()} pointerEvents="none" />
      )}
    </g>
  );
  const layer = layerFor("plan");

  // ── Toolbar (ANNOTATE group) ─────────────────────────────────
  const toolBtn = (id: AnnTool, title: string, icon: React.ReactNode, label: string) => {
    const isActive = activeTool === id;
    return (
      <button key={id} onClick={() => { if (textInput) commitTextRef.current(); const activating = !isActive; setActiveTool(activating ? id : null); if (activating && id === "dimension") setToolColor("#1e293b"); setLiveAnnot(null); drawRef.current = null; dimRef.current = null; setEraserCursor(null); }} title={title}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "4px 10px", background: isActive ? "rgba(139,92,246,0.12)" : "transparent", border: `1px solid ${isActive ? "#8b5cf6" : "transparent"}`, borderRadius: 4, cursor: "pointer", transition: "all 0.15s", minWidth: 46 }}
        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "rgb(var(--forge-surface))"; e.currentTarget.style.borderColor = "rgb(var(--border))"; } }}
        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; } }}>
        {icon}
        <span style={{ fontSize: 9, color: isActive ? "#8b5cf6" : "rgb(var(--text-subtle))", lineHeight: 1.2, whiteSpace: "nowrap" }}>{label}</span>
      </button>
    );
  };
  const ic = (tool: AnnTool) => activeTool === tool ? "#8b5cf6" : "rgb(var(--text-subtle))";
  const toolbarButtons = (
    <>
      {toolBtn("text", "Add Text",
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ic("text")} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>,
        "Text")}
      {toolBtn("shape", "Draw shapes",
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ic("shape")} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 3.5 2.5 9h6z"/><path d="M15 4h6m0 0-2.3-2.3M21 4l-2.3 2.3"/><circle cx="6" cy="17.5" r="3.5"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
        "Shape")}
      {toolBtn("dimension", "Dimension — click two points (hold Shift for straight/45°), then click again to place the dimension line",
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ic("dimension")} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="5" x2="4" y2="19"/><line x1="20" y1="5" x2="20" y2="19"/><line x1="4" y1="12" x2="20" y2="12"/>
          <polygon points="4,12 9,9 9,15" fill={ic("dimension")} stroke="none"/><polygon points="20,12 15,9 15,15" fill={ic("dimension")} stroke="none"/>
        </svg>,
        "Dimension")}
      {toolBtn("pencil", "Freehand pencil",
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ic("pencil")} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" /></svg>,
        "Pencil")}
      {toolBtn("highlight", "Highlighter",
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ic("highlight")} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><rect x="9" y="9" width="13" height="13" rx="2" fill={activeTool === "highlight" ? "#fbbf2440" : "none"} /></svg>,
        "Highlight")}
      {toolBtn("eraser", "Eraser",
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ic("eraser")} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 20H7L3 16l10-10 7 7-1.5 1.5" /><path d="M6.5 17.5l5-5" /></svg>,
        "Eraser")}
    </>
  );

  // ── Options bar (sub-tool settings, shown while a tool is active) ──
  const swatch = (c: string, active: boolean, onClick: () => void) => (
    <button key={c} onClick={onClick} style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: active ? "2px solid #8b5cf6" : "2px solid rgb(var(--border))", cursor: "pointer", padding: 0, outline: "none", flexShrink: 0 }} />
  );
  const divider = (k: string) => <div key={k} style={{ width: 1, height: 18, background: "rgb(var(--border))", margin: "0 3px" }} />;
  const shapeBtn = (id: string, label: string, icon: React.ReactNode) => (
    <button key={id} onClick={() => setShapeSubtype(id)} title={label}
      style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: shapeSubtype === id ? "rgba(139,92,246,0.15)" : "transparent", border: `1px solid ${shapeSubtype === id ? "#8b5cf6" : "transparent"}`, borderRadius: 6, cursor: "pointer", padding: 0 }}>
      {icon}
    </button>
  );
  const sc = (id: string) => shapeSubtype === id ? "#8b5cf6" : "rgb(var(--text-muted))";
  const optionsBar = activeTool && activeTool !== "text" ? (
    <div data-anntexteditor="true" style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "rgb(var(--forge-panel))", border: "1px solid rgb(var(--border))", borderRadius: 8, boxShadow: "0 2px 10px rgba(0,0,0,0.12)", whiteSpace: "nowrap" }}>
      {activeTool === "dimension" && (
        <span style={{ fontSize: 11, color: "rgb(var(--text-subtle))", padding: "0 6px" }}>
          {!dimRef.current ? "Click the first point" : dimRef.current.x2 === undefined ? "Click the second point (hold Shift for straight/45°)" : "Move to set the offset, click to place"}
        </span>
      )}
      {activeTool === "dimension" && divider("dd")}
      {activeTool === "shape" && <>
        {shapeBtn("rect", "Rectangle", <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><rect x="3" y="5" width="16" height="12" rx="1.5" stroke={sc("rect")} strokeWidth="1.7" /></svg>)}
        {shapeBtn("circle", "Circle", <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="7.5" stroke={sc("circle")} strokeWidth="1.7" /></svg>)}
        {shapeBtn("triangle", "Triangle", <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M11 4l8 14H3z" stroke={sc("triangle")} strokeWidth="1.7" strokeLinejoin="round" /></svg>)}
        {shapeBtn("line", "Line", <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><line x1="4" y1="18" x2="18" y2="4" stroke={sc("line")} strokeWidth="1.7" strokeLinecap="round" /></svg>)}
        {shapeBtn("arrow", "Arrow", <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><line x1="4" y1="18" x2="17" y2="5" stroke={sc("arrow")} strokeWidth="1.7" strokeLinecap="round" /><path d="M10 4h8v8" stroke={sc("arrow")} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>)}
        {shapeBtn("polyline", "Polyline (click points, double-click or Enter to finish)", <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M3 17l5-8 5 4 6-9" stroke={sc("polyline")} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>)}
        {divider("d1")}
      </>}
      {(activeTool === "shape" || activeTool === "pencil" || activeTool === "dimension") && <>
        {STROKE_WIDTHS.map(w => (
          <button key={w} onClick={() => setStrokeW(w)} title={`${w}px stroke`} style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: strokeW === w ? "rgba(139,92,246,0.15)" : "transparent", border: `1px solid ${strokeW === w ? "#8b5cf6" : "transparent"}`, borderRadius: 6, cursor: "pointer", padding: 0 }}>
            <div style={{ width: 16, height: w, background: strokeW === w ? "#8b5cf6" : "rgb(var(--text-muted))", borderRadius: w }} />
          </button>
        ))}
        {divider("d2")}
        {TOOL_COLORS.map(c => swatch(c, toolColor === c, () => setToolColor(c)))}
      </>}
      {activeTool === "highlight" && <>
        <button onClick={() => setHlSubtype("rect")} title="Highlight area (rectangle)" style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: hlSubtype === "rect" ? "rgba(139,92,246,0.15)" : "transparent", border: `1px solid ${hlSubtype === "rect" ? "#8b5cf6" : "transparent"}`, borderRadius: 6, cursor: "pointer", padding: 0 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="5" width="16" height="10" rx="2" fill={hlSubtype === "rect" ? hlColor : "none"} stroke={hlSubtype === "rect" ? hlColor : "rgb(var(--text-muted))"} strokeWidth="1.7" opacity={hlSubtype === "rect" ? 0.75 : 1} /></svg>
        </button>
        <button onClick={() => setHlSubtype("freehand")} title="Highlight freehand (pen)" style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: hlSubtype === "freehand" ? "rgba(139,92,246,0.15)" : "transparent", border: `1px solid ${hlSubtype === "freehand" ? "#8b5cf6" : "transparent"}`, borderRadius: 6, cursor: "pointer", padding: 0 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2.5 14 Q6 6 10 9.5 Q14 13 17.5 5.5" stroke={hlSubtype === "freehand" ? hlColor : "rgb(var(--text-muted))"} strokeWidth={hlSubtype === "freehand" ? 4.5 : 2} strokeLinecap="round" fill="none" opacity={hlSubtype === "freehand" ? 0.85 : 1} /></svg>
        </button>
        {divider("d3")}
        {HL_COLORS.map(c => swatch(c, hlColor === c, () => setHlColor(c)))}
      </>}
      {activeTool === "eraser" && ERASER_SIZES.map(({ r, d, label }) => (
        <button key={r} onClick={() => setEraserSize(r)} title={label}
          style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: eraserSize === r ? "rgba(139,92,246,0.15)" : "transparent", border: `1px solid ${eraserSize === r ? "#8b5cf6" : "transparent"}`, borderRadius: 8, cursor: "pointer", flexShrink: 0 }}>
          <div style={{ width: d, height: d, borderRadius: "50%", border: `2px solid ${eraserSize === r ? "#8b5cf6" : "rgb(var(--text-muted))"}`, flexShrink: 0 }} />
        </button>
      ))}
    </div>
  ) : null;

  // ── Text editor overlay (fixed position, render at page root) ──
  const overlay = textInput ? (
    <>
      <div data-anntexteditor="true" style={{ position: "fixed", left: textInput.clientX, top: textInput.clientY - 54, zIndex: 10000, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 2, background: "rgb(var(--forge-panel))", border: "1px solid rgb(var(--border))", borderRadius: 10, padding: "5px 8px", boxShadow: "0 2px 12px rgba(0,0,0,0.12)", whiteSpace: "nowrap" }}>
        <button onClick={() => setTextFontSize(s => Math.max(8, s - 2))} style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "rgb(var(--text-subtle))", fontSize: 16, cursor: "pointer", borderRadius: 4 }}>−</button>
        <span style={{ fontSize: 12, fontFamily: "monospace", color: "rgb(var(--text-body))", minWidth: 24, textAlign: "center", userSelect: "none" }}>{textFontSize}</span>
        <button onClick={() => setTextFontSize(s => Math.min(72, s + 2))} style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "rgb(var(--text-subtle))", fontSize: 14, cursor: "pointer", borderRadius: 4 }}>+</button>
        <div style={{ width: 1, height: 18, background: "rgb(var(--border))", margin: "0 3px" }} />
        <button onClick={() => setTextBold(b => !b)} style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: textBold ? "rgba(139,92,246,0.12)" : "none", border: `1px solid ${textBold ? "#8b5cf6" : "transparent"}`, borderRadius: 5, cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "Georgia,serif", color: textBold ? "#8b5cf6" : "rgb(var(--text-body))" }}>B</button>
        <button onClick={() => setTextItalic(i => !i)} style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: textItalic ? "rgba(139,92,246,0.12)" : "none", border: `1px solid ${textItalic ? "#8b5cf6" : "transparent"}`, borderRadius: 5, cursor: "pointer", fontStyle: "italic", fontSize: 13, fontFamily: "Georgia,serif", color: textItalic ? "#8b5cf6" : "rgb(var(--text-body))" }}>I</button>
        <div style={{ width: 1, height: 18, background: "rgb(var(--border))", margin: "0 3px" }} />
        {(["left", "center", "right"] as const).map(al => (
          <button key={al} onClick={() => setTextAlign(al)} title={`Align ${al}`} style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: textAlign === al ? "rgba(139,92,246,0.12)" : "none", border: `1px solid ${textAlign === al ? "#8b5cf6" : "transparent"}`, borderRadius: 5, cursor: "pointer", padding: 0 }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <line x1={al === "right" ? 1 : 1} y1="2" x2="13" y2="2" stroke={textAlign === al ? "#8b5cf6" : "rgb(var(--text-subtle))"} strokeWidth="1.4" strokeLinecap="round" />
              <line x1={al === "left" ? 1 : al === "center" ? 3 : 5} y1="6" x2={al === "left" ? 9 : al === "center" ? 11 : 13} y2="6" stroke={textAlign === al ? "#8b5cf6" : "rgb(var(--text-subtle))"} strokeWidth="1.4" strokeLinecap="round" />
              <line x1={al === "left" ? 1 : al === "center" ? 2 : 3} y1="10" x2={al === "left" ? 11 : al === "center" ? 12 : 13} y2="10" stroke={textAlign === al ? "#8b5cf6" : "rgb(var(--text-subtle))"} strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: "rgb(var(--border))", margin: "0 3px" }} />
        {TOOL_COLORS.map(c => swatch(c, toolColor === c, () => setToolColor(c)))}
      </div>
      <div data-anntexteditor="true" style={{ position: "fixed", left: textInput.clientX, top: textInput.clientY, zIndex: 10000 }}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={textValue}
          onChange={e => { textValueRef.current = e.target.value; setTextValue(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
          onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); } if (e.key === "Escape") { commitText(); } }}
          style={{ background: "rgb(var(--forge-panel))", border: "2px solid #8b5cf6", borderRadius: 6, outline: "none", fontSize: textFontSize, fontWeight: textBold ? "700" : "400", fontStyle: textItalic ? "italic" : "normal", textAlign, color: "rgb(var(--text-body))", fontFamily: "Inter,sans-serif", padding: "6px 10px", minWidth: 140, resize: "none", overflow: "hidden", caretColor: "#8b5cf6", boxShadow: "0 2px 12px rgba(139,92,246,0.2)", lineHeight: 1.4 }}
          placeholder="Type here…"
        />
      </div>
    </>
  ) : null;

  return {
    annotations, setAnnotations,
    activeTool, setActiveTool,
    cursor: annCursorStyle,
    toolbarButtons, optionsBar, layer, layerFor, overlay,
    handleDown, handleMove, handleUp, handleDoubleClick, handleLeave,
    selectedAnnotIds, hasSelection:selectedAnnotIds.size>0, selectInRect, translateSelected,
    clearSelection:clearAnnotationSelection, beginChange:beginAnnotationChange,
    isDragging:()=>annotDragRef.current!==null,
  };
}
