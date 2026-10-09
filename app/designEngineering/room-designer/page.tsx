"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Video, Monitor, Presentation } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/components/ThemeProvider";
import { searchProducts, addEquipmentToLibraryConfirmed, getProductsByIds } from "@/lib/av-products";
import { useLibraryAdmin } from "@/lib/use-library-admin";
import { searchOrgLibrary } from "@/lib/equipment-library";
import { loadUnitSpecs, diffSpec, identityAfterEdit, isLibraryProduct, specFromRoomDevice, applySpecToRoomDevice } from "@/lib/unit-specs";
import { useBOM, useRetireRemovedUnits, useHiddenUnitsRegistry, roomDeviceToBOM, BOM_UNIT_DRAG_TYPE, type BOMDeviceEntry, type BOMDragUnit } from "@/lib/bom-context";
import { useOrg } from "@/components/OrgProvider";
import BOMPanel from "@/components/BOMPanel";
import { useCanvasAnnotations } from "@/components/CanvasAnnotations";
import { DxfWriter, downloadDxf } from "@/lib/dxf-export";
import { dxfToBackgroundImage } from "@/lib/dxf-import";
import { pdfToBackgroundImage } from "@/lib/pdf-import";
import EquipmentFormModal, { type EquipmentFormValue } from "@/components/EquipmentFormModal";
import { ensureRoomDeviceItemIds, newItemId, productKeyOf } from "@/lib/design-identity";
import { loadToolData, saveToolData } from "@/lib/tool-data";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  fetchScopeUnits, loadScopeManifest, saveScopeManifest,
  wipeRoomDesignerEquipment, wipeSignalFlowEquipment, isRoomFurniture, SCOPE_REIMPORT_WARNING,
} from "@/lib/scope-manifest";

/* Theme-aware canvas colors */
const canvasColors = {
  dark: {
    floorA: "#2a3040", floorB: "#1e2836", device: "#111827", deviceDeep: "#0a0f1a",
    deviceBorder: "#2d3748", deviceBorderLight: "#334155", grid: "rgba(100,116,139,0.12)",
    panel: "#080d17", card: "#0a0f1a",
  },
  light: {
    floorA: "#dde3ec", floorB: "#cdd4df", device: "#e2e8f0", deviceDeep: "#f1f5f9",
    deviceBorder: "#cbd5e1", deviceBorderLight: "#94a3b8", grid: "rgba(100,116,139,0.15)",
    panel: "#ffffff", card: "#ffffff",
  },
};
const LedWallIcon = ({size,color}:{size:number,color:string}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="9" height="7" rx="1"/>
    <rect x="13" y="4" width="9" height="7" rx="1"/>
    <rect x="2" y="13" width="9" height="7" rx="1"/>
    <rect x="13" y="13" width="9" height="7" rx="1"/>
  </svg>
);
const SoundbarIcon = ({size,color}:{size:number,color:string}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="6" width="22" height="12" rx="2"/>
    <circle cx="12" cy="12" r="2" fill={color} stroke="none"/>
  </svg>
);

const WallTypeIcon = ({type,size=30}:{type:"drywall"|"glass"|"solid";size?:number}) => {
  const stroke = "#64748b";
  if (type === "glass") return (
    <svg width={size} height={size*0.8} viewBox="0 0 32 24" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="29" height="2.4" rx="1.2" stroke={stroke} strokeWidth="1.2"/>
      <rect x="1.5" y="19.6" width="29" height="2.4" rx="1.2" stroke={stroke} strokeWidth="1.2"/>
      <path d="M3.5 4.4V19.6M16 4.4V19.6M28.5 4.4V19.6" stroke={stroke} strokeWidth="1.2"/>
      <path d="M7.5 14L11 10.5M8.8 16L12.3 12.5M20 14L23.5 10.5M21.3 16L24.8 12.5" stroke={stroke} strokeWidth="0.8" strokeLinecap="round" opacity="0.8"/>
    </svg>
  );
  if (type === "solid") return (
    <svg width={size} height={size*0.8} viewBox="0 0 32 24" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="29" height="20" rx="0.6" stroke={stroke} strokeWidth="1.2"/>
      <path d="M1.5 7H30.5M1.5 12H30.5M1.5 17H30.5" stroke={stroke} strokeWidth="1"/>
      <path d="M12 2V7M23 2V7M7 7V12M18 7V12M27 7V12M12 12V17M23 12V17M7 17V22M18 17V22M27 17V22" stroke={stroke} strokeWidth="1"/>
    </svg>
  );
  return (
    <svg width={size} height={size*0.8} viewBox="0 0 32 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="24" height="20" rx="0.6" stroke={stroke} strokeWidth="1.2"/>
      <path d="M26 2L30 5V22H26M26 6L30 10M26 11L30 15M26 16L30 20" stroke={stroke} strokeWidth="0.9" strokeLinejoin="round"/>
      <circle cx="5.5" cy="5.5" r="0.9" stroke={stroke} strokeWidth="0.9"/>
      <circle cx="22.5" cy="5.5" r="0.9" stroke={stroke} strokeWidth="0.9"/>
      <circle cx="5.5" cy="18.5" r="0.9" stroke={stroke} strokeWidth="0.9"/>
      <circle cx="22.5" cy="18.5" r="0.9" stroke={stroke} strokeWidth="0.9"/>
    </svg>
  );
};

interface RoomType {
  id: string; name: string; people: string; maxSeats: number;
  w: number; l: number; h: number; desc: string;
}
interface DeviceCatalogItem {
  id: string; name: string; icon: string; w: number; h: number;
  wall: string; type: string; color: string;
  // Cross-tool unit identity — see lib/design-identity.ts. Optional here
  // because the built-in sidebar catalog entries are templates, not units;
  // addDeviceToRoom mints the id at the moment a template becomes a placement.
  itemId?: string; productKey?: string; productId?: string | null;
  // Real equipment from the database (search modal) carries its own FOV/
  // coverage spec through here; built-in catalog items leave these unset and
  // addDeviceToRoom falls back to its hardcoded per-type/id defaults.
  hfovDeg?: number | null;
  coveragePattern?: "circular" | "rectangular" | null;
  coverageDiameterFt?: number | null;
  coverageAngleDeg?: number | null;
  coverageWidthFt?: number | null;
  coverageDepthFt?: number | null;
}
interface PlacedDevice extends DeviceCatalogItem {
  uid: number; x: number; y: number; z: number; mountWall: string; hfov?: number; vfov?: number; covShape?: "round"|"square"; covDiameter?: number; covW?: number; covL?: number; dispersion?: number; wallAngle?: number; wallType?: "drywall"|"glass"|"solid"; rotation?: number; wallUid?: number;
  // Manual rotation nudge for a camera's facing direction, in degrees, added
  // on top of whatever wall-facing angle auto-snapping computed — set via the
  // inline rotate button next to the delete "×" on a selected camera. Kept
  // separate from `rotation` (the wall's own run angle, used for icon
  // orientation) since a camera's true facing has an inside/outside
  // ambiguity `rotation` alone can't resolve, and this is purely a user
  // override on top of it.
  facingOverrideDeg?: number;
  // User-adjusted position of this device's automatic call-out label,
  // stored as a feet offset from the device (so the callout translates
  // along with it if the device moves later) — set by dragging the
  // callout's text/handle. Undefined until the user actually drags one,
  // at which point it defaults to fanning outward from the room's center
  // (see defaultCalloutOffset).
  calloutDx?: number; calloutDy?: number;
  // Same idea, but for the Elevations pane's own call-out — kept separate
  // from calloutDx/calloutDy above since that's a Plan/Ceiling-view offset
  // (measured from the device's plan position, fanning out radially) while
  // this one is measured from the device's on-screen elevation box (up and
  // to the side by default); the two views have no reason to share one
  // dragged position.
  calloutElevDx?: number; calloutElevDy?: number;
  // Equipment spec fields, editable via the same "Edit Equipment" form used
  // by Signal Flow Builder/Rack Planner — mostly informational for a floor
  // plan (this tool has no cabling/rack concept of its own), kept here only
  // so nothing the user fills in through that shared form gets silently
  // dropped. Only mfr/model/price/part_number, and hfov/vfov/coverage above,
  // are actually populated automatically from a library search.
  mfr?: string; model?: string; price?: number; part_number?: string | null;
  cat?: string; msrp?: number | null; cost?: number | null; margin?: number | null; markup?: number | null;
  ports?: Array<{ side: string; signal: string; dir: string; label: string; connector?: string }>;
  amp_draw?: number | null; voltage?: number | null; power_watts?: number | null; btu_hr?: number | null;
  rackMounted?: boolean; rack_units?: number | null; rack_ear_included?: boolean;
  width_in?: number | null; height_in?: number | null; depth_in?: number | null; weight_lb?: number | null;
  diameter_in?: number | null;
}

// Revit-style "Elevation Marker" — a placeable, rotatable tag dropped
// anywhere in the plan. It doesn't carry equipment of its own; it just
// records a position + facing direction, and the Elevations pane derives
// a wall-facing view from whatever equipment sits along that direction at
// render time (see computeElevation below) — so moving/adding devices in
// the plan always keeps every marker's elevation current with no manual
// re-sync step.
// Standard architectural "interior elevation" tag — a diamond with 4
// direction flags (N/E/S/W) around a circle. Each flag is independently
// toggleable (see toggleElevationDirection) so one marker can drive up to 4
// elevation views from a single position; a flag renders solid black when
// its direction is active, matching the drafting convention, and empty
// (outline only) otherwise. North is the only one on by default.
//
// `directions` is an ORDERED list of the active flags, in the order they
// were turned on — not a fixed N/E/S/W order. Its index+1 is that flag's
// view number (first one enabled = 1, next = 2, ...), which is what's shown
// next to the flag on the diamond and appended to the marker's own letter
// to name that elevation view (e.g. "A1", "A2") — so removing then re-adding
// a flag gives it a new number rather than reclaiming its old one, and the
// remaining flags renumber contiguously when one is removed.
interface ElevationMarker { id: number; x: number; y: number; label: string; directions: ElevationDirKey[]; }
type ElevationDirKey = "n" | "e" | "s" | "w";
const ELEVATION_DIR_ANGLES: Record<ElevationDirKey, number> = { n: 0, e: 90, s: 180, w: 270 };
const ELEVATION_DIR_LABELS: Record<ElevationDirKey, string> = { n: "North", e: "East", s: "South", w: "West" };
const ELEVATION_DIR_KEYS: ElevationDirKey[] = ["n", "e", "s", "w"];
const elevationDirNumber = (m: ElevationMarker, dir: ElevationDirKey) => m.directions.indexOf(dir) + 1;

// Room Designer's own placed-device model has no separate manufacturer/model
// breakdown or ports/rack/power spec — "name" (e.g. '43" Display') is the one
// user-facing label, and "type" (display/camera/mic/...) drives which SVG
// branch renders it, so it must never be overwritten by a freeform edit.
// These two functions bridge that model to/from the same EquipmentFormValue
// shape Signal Flow Builder and Rack Planner already use, so the Edit
// Equipment context-menu option behaves identically everywhere in the app.
// "W (in)"/"H (in)" are deliberately wired to the device's actual on-canvas
// footprint (feet, ×12) rather than left as inert spec fields — that's the
// only sense "size" has for a floor-plan device, and it's exactly what
// resizing a device here should mean.
function deviceToFormValue(d: PlacedDevice): EquipmentFormValue {
  return {
    manufacturer: d.mfr || "",
    model: d.model || "",
    category: d.cat || "",
    notes: d.name || "",
    unitCost: d.price ?? 0,
    partNumber: d.part_number ?? null,
    msrp: d.msrp ?? null,
    cost: d.cost ?? null,
    margin: d.margin ?? null,
    markup: d.markup ?? null,
    ports: d.ports || [],
    ampDraw: d.amp_draw ?? null,
    voltage: d.voltage ?? null,
    powerWatts: d.power_watts ?? null,
    btuHr: d.btu_hr ?? null,
    rackMounted: d.rackMounted ?? false,
    rackUnits: d.rack_units ?? null,
    rackEarsIncluded: d.rack_ear_included ?? false,
    widthIn: Math.round((d.w || 0) * 12 * 100) / 100,
    heightIn: Math.round((d.h || 0) * 12 * 100) / 100,
    depthIn: d.depth_in ?? null,
    diameterIn: d.diameter_in ?? null,
    weightLb: d.weight_lb ?? null,
    hfovDeg: d.hfov ?? null,
    vfovDeg: d.vfov ?? null,
    coveragePattern: d.covShape === "round" ? "circular" : d.covShape === "square" ? "rectangular" : null,
    coverageDiameterFt: d.covDiameter ?? null,
    coverageAngleDeg: d.dispersion ?? null,
    coverageWidthFt: d.covW ?? null,
    coverageDepthFt: d.covL ?? null,
  };
}

function applyFormValueToDevice(d: PlacedDevice, v: EquipmentFormValue): PlacedDevice {
  return {
    ...d,
    mfr: v.manufacturer,
    model: v.model,
    cat: v.category,
    name: v.notes || d.name,
    price: v.unitCost,
    part_number: v.partNumber,
    msrp: v.msrp,
    cost: v.cost,
    margin: v.margin,
    markup: v.markup,
    ports: v.ports,
    amp_draw: v.ampDraw,
    voltage: v.voltage,
    power_watts: v.powerWatts,
    btu_hr: v.btuHr,
    rackMounted: v.rackMounted,
    rack_units: v.rackUnits,
    rack_ear_included: v.rackEarsIncluded,
    width_in: v.widthIn,
    height_in: v.heightIn,
    depth_in: v.depthIn,
    diameter_in: v.diameterIn ?? null,
    weight_lb: v.weightLb,
    w: v.widthIn != null && v.widthIn > 0 ? v.widthIn / 12 : d.w,
    h: v.heightIn != null && v.heightIn > 0 ? v.heightIn / 12 : d.h,
    hfov: v.hfovDeg ?? undefined,
    vfov: v.vfovDeg ?? undefined,
    covShape: v.coveragePattern === "circular" ? "round" : v.coveragePattern === "rectangular" ? "square" : undefined,
    covDiameter: v.coverageDiameterFt ?? undefined,
    dispersion: v.coverageAngleDeg ?? undefined,
    covW: v.coverageWidthFt ?? undefined,
    covL: v.coverageDepthFt ?? undefined,
  };
}

// Shapes a raw av_products row into the "modalResults" pick shape addFromModal
// / replaceDeviceFromModal / libraryPickFields expect (mfr/model/cat aliases
// alongside the raw manufacturer/model_name/category fields, plus Room
// Designer's rd_* placement metadata). Used both for the library search
// dropdown and — because a Kit's own component products need the exact same
// shape — for expanding a Kit pick into its individual parts.
function productToModalResult(p: any) {
  return {
    ...p,
    type: p.type, mfr: p.manufacturer, model: p.model_name, price: p.price,
    color: p.color || "#64748b", cat: p.category,
    rd_type: p.rd_type, rd_wall: p.rd_wall,
    rd_width_ft: p.rd_width_ft, rd_height_ft: p.rd_height_ft,
    rd_icon: p.rd_icon,
    hfov_deg: p.hfov_deg, coverage_pattern: p.coverage_pattern,
    coverage_diameter_ft: p.coverage_diameter_ft, coverage_angle_deg: p.coverage_angle_deg,
    coverage_width_ft: p.coverage_width_ft, coverage_depth_ft: p.coverage_depth_ft,
  };
}

const roomTypes: RoomType[] = [
  { id:"huddle",  name:"Huddle Room",          people:"2-4",  maxSeats:4,  w:8.2,  l:8.2,  h:7.87,  desc:"Quick meetings, BYOD" },
  { id:"small",   name:"Small Room",            people:"4-6",  maxSeats:6,  w:11.5, l:13.1, h:7.87,  desc:"Team standups, video calls" },
  { id:"medium",  name:"Medium Room",           people:"6-10", maxSeats:10, w:16.4, l:19.7, h:8.86,  desc:"Conference room, hybrid meetings" },
  { id:"large",   name:"Large Room",            people:"11-16",maxSeats:16, w:22.97,l:29.53,h:9.84,  desc:"Boardroom, all-hands" },
  { id:"boardroom",name:"Executive Boardroom",  people:"12-20",maxSeats:20, w:26.25,l:39.37,h:9.84,  desc:"Executive meetings, dual display" },
  { id:"training",name:"Training Room",         people:"20-40",maxSeats:24, w:26.25,l:32.81,h:9.84,  desc:"Classroom style, presenter station" },
  { id:"auditorium",name:"Auditorium",          people:"50+",  maxSeats:24, w:49.2, l:65.6, h:13.12, desc:"Large venue, multi-display, PA" },
];

const deviceCatalog = [
  { cat:"Displays", items:[
    { id:"display-43",     name:'43" Display',        icon:"monitor", w:3.12, h:1.77, wall:"front",   type:"display",   color:"#8b5cf6" },
    { id:"display-55",     name:'55" Display',        icon:"monitor", w:4.00, h:2.26, wall:"front",   type:"display",   color:"#8b5cf6" },
    { id:"display-65",     name:'65" Display',        icon:"monitor", w:4.76, h:2.69, wall:"front",   type:"display",   color:"#8b5cf6" },
    { id:"display-75",     name:'75" Display',        icon:"monitor", w:5.45, h:3.08, wall:"front",   type:"display",   color:"#8b5cf6" },
    { id:"display-86",     name:'86" Display',        icon:"monitor", w:6.27, h:3.54, wall:"front",   type:"display",   color:"#8b5cf6" },
    { id:"display-98",     name:'98" Display',        icon:"monitor", w:7.12, h:4.00, wall:"front",   type:"display",   color:"#8b5cf6" },
    { id:"display-110",    name:'110" Display',       icon:"monitor", w:7.97, h:4.49, wall:"front",   type:"display",   color:"#8b5cf6" },
    { id:"projector-screen",name:"Projection Screen", icon:"presentation", w:7.87, h:4.92, wall:"front",   type:"display",   color:"#8b5cf6" },
    { id:"led-wall",       name:"LED Video Wall",     icon:"tv", w:9.84, h:5.58, wall:"front",   type:"display",   color:"#06b6d4" },
    // A projector UNIT (not the screen it projects onto) — physically a
    // compact ~20"x20" ceiling-mounted box, so it deliberately does NOT use
    // type:"display" (that renders every device as a flat wall-mounted
    // bezel/screen bar, wrong for a ceiling box). type:"projector" has no
    // dedicated render branch, so it falls through to the generic small-box
    // rendering already used for any other unrecognized ceiling device.
    { id:"projector",      name:"Projector",          icon:"projector", w:1.67, h:1.67, wall:"ceiling", type:"projector", color:"#8b5cf6" },
  ]},
  { cat:"Cameras", items:[
    { id:"ptz-cam",      name:"PTZ Camera",         icon:"confbar", w:0.49, h:0.39, wall:"front",   type:"camera",    color:"#22c55e" },
    { id:"soundbar-cam", name:"Conference Bar",     icon:"soundbar", w:2.30, h:0.39, wall:"front",   type:"camera",    color:"#22c55e" },
    { id:"ceiling-cam",  name:"Ceiling Camera",     icon:"confbar", w:0.66, h:0.66, wall:"ceiling", type:"camera",    color:"#22c55e" },
  ]},
  { cat:"Audio", items:[
    { id:"ceiling-mic",  name:"Ceiling Mic Array",  icon:"🎙", w:2.00, h:2.00, wall:"ceiling", type:"mic",       color:"#f59e0b" },  // Shure MXA920 2'×2' tile
    { id:"table-mic",    name:"Table Mic",          icon:"🎙", w:0.44, h:0.44, wall:"table",   type:"mic",       color:"#f59e0b" },  // Shure MXA310 5.3" dia
    { id:"ceiling-spk",  name:"Ceiling Speaker",    icon:"🔊", w:0.67, h:0.67, wall:"ceiling", type:"speaker",   color:"#ef4444" },
    { id:"soundbar",     name:"Wall Speaker",           icon:"🔊", w:1.04, h:1.67, wall:"front",   type:"speaker",   color:"#ef4444" },  // JBL Control 29AV-1
  ]},
  { cat:"Control", items:[
    { id:"touch-panel",  name:"Touch Panel (Wall)", icon:"📱", w:0.92, h:0.59, wall:"side",    type:"control",   color:"#a855f7" },  // Crestron TSW-1070
    { id:"table-touch",  name:"Touch Panel (Table)",icon:"📱", w:0.86, h:0.43, wall:"table",   type:"control",   color:"#a855f7" },  // Logitech Tap
    { id:"byod-hub",     name:"Cable Cubby",        icon:"🔌", w:0.98, h:0.49, wall:"table",   type:"control",   color:"#a855f7" },
  ]},
];

const roomElementItems: DeviceCatalogItem[] = [
  { id:"wall-partition", name:"Wall / Partition",    icon:"🧱", w:9.84, h:0.333, wall:"floor",   type:"furniture", color:"rgb(var(--text-subtle))" },
  { id:"conf-table",    name:"Conference Table",    icon:"🪑", w:7.87, h:3.94,  wall:"floor",   type:"furniture", color:"rgb(var(--text-subtle))" },
  { id:"round-table",   name:"Round Table",         icon:"⭕", w:4.92, h:4.92,  wall:"floor",   type:"furniture", color:"rgb(var(--text-subtle))" },
  { id:"exec-chair",    name:"Executive Chair",     icon:"💺", w:1.97, h:1.97,  wall:"floor",   type:"furniture", color:"rgb(var(--text-subtle))" },
  { id:"side-chair",    name:"Side Chair",          icon:"🪑", w:1.48, h:1.48,  wall:"floor",   type:"furniture", color:"rgb(var(--text-subtle))" },
  { id:"credenza",      name:"Credenza / Cabinet",  icon:"🗄️", w:5.91, h:1.64,  wall:"floor",   type:"furniture", color:"rgb(var(--text-subtle))" },
  { id:"podium",        name:"Podium / Lectern",    icon:"📦", w:1.97, h:1.64,  wall:"floor",   type:"furniture", color:"rgb(var(--text-subtle))" },
  { id:"whiteboard",    name:"Whiteboard",          icon:"📋", w:5.91, h:0.16,  wall:"front",   type:"furniture", color:"rgb(var(--text-subtle))" },
  { id:"door-marker",   name:"Door",                icon:"🚪", w:3.0,  h:0.33,  wall:"floor",   type:"furniture", color:"#475569" },
  { id:"window-marker", name:"Window",              icon:"🪟", w:2.0,  h:0.16,  wall:"front",   type:"furniture", color:"#475569" },
];

export default function RoomDesignerPage() {
  // The sidebar's room links are plain Next.js <Link>s to this same route with
  // only ?room= changed — Next does not remount this page for that, so without
  // reacting to these explicitly, switching rooms left this component's state
  // (and currentProjectId/currentRoomId below) pointed at whichever room
  // loaded first, and autosave would silently overwrite the newly-selected
  // room's saved design with the old one's.
  const searchParams = useSearchParams();
  const roomParam = searchParams.get("room") || "default";
  const projectParam = searchParams.get("project") || "";
  // Chrome-free view for embedding this room's drawing elsewhere (the
  // per-room "Drawings" page). Reuses exportAsPDF's proven technique for
  // isolating #rd-canvas-export — walk up to <body>, hiding every sibling
  // along the way — just applied permanently instead of only for print.
  const embedMode = searchParams.get("embed") === "1";
  useEffect(() => {
    if (!embedMode) return;
    let node: HTMLElement | null = document.getElementById('rd-canvas-export');
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (parent) {
        Array.from(parent.children).forEach(sib => {
          if (sib !== node && sib instanceof HTMLElement) sib.style.display = 'none';
        });
      }
      node.style.overflow = 'visible';
      node.style.height = 'auto';
      node.style.maxHeight = 'none';
      node.style.position = 'static';
      node = parent;
    }
  }, [embedMode]);
  const { theme } = useTheme();
  const cc = canvasColors[theme];

  // Per-canvas lock toggle (zoom is via ctrl+wheel; +/− buttons removed)
  const zoomCluster = (k: string) => {
    const locked = !!lockedViews[k];
    return (
      <button onClick={()=>setLockedViews(prev=>({...prev,[k]:!prev[k]}))}
        title={locked ? "Unlock canvas — enable panning and zooming" : "Lock canvas — disable panning and zooming"}
        style={{position:"absolute",bottom:12,right:12,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",background:locked?"rgba(239,68,68,0.12)":cc.panel,border:`1px solid ${locked?"rgba(239,68,68,0.4)":"rgb(var(--border))"}`,borderRadius:6,cursor:"pointer",boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}}>
        {locked ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--text-subtle))" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
        )}
      </button>
    );
  };
  const [roomSizeMode,  setRoomSizeMode]  = useState<"survey" | "custom" | null>("custom");
  const [showCustomRoom, setShowCustomRoom] = useState(false);
  const [showCustomConfirm, setShowCustomConfirm] = useState(false);
  const [showSurveyConfirm, setShowSurveyConfirm] = useState(false);
  const [surveyRooms,   setSurveyRooms]   = useState<{ id: string; name: string; width: number; length: number; height: number }[]>([]);
  const [selectedSurveyRoom, setSelectedSurveyRoom] = useState<string>("");
  const [roomType,      setRoomType]      = useState("medium");
  const [roomW,         setRoomW]         = useState(16.4);
  const [roomL,         setRoomL]         = useState(19.7);
  const [roomH,         setRoomH]         = useState(8.86);
  const [placedDevices, setPlacedDevices] = useState<PlacedDevice[]>([]);
  const [step,          setStep]          = useState(2);
  const [selectedWall,  setSelectedWall]  = useState("north");
  const [tableShape,    setTableShape]    = useState("rectangular");
  const [tableSeats,    setTableSeats]    = useState(2);
  const [tableWidth,    setTableWidth]    = useState(2.0);
  const [tableLengthOverride, setTableLengthOverride] = useState<number|null>(2.0);
  const [tableWallDist, setTableWallDist] = useState(3.28);
  const [bomCollapsed,  setBomCollapsed]  = useState(true);
  const [rdLoaded,      setRdLoaded]      = useState(false);
  const [showAddModal,  setShowAddModal]  = useState(false);
  const [modalSearch,   setModalSearch]   = useState("");
  const [modalResults,  setModalResults]  = useState<any[]>([]);
  const [modalLoading,  setModalLoading]  = useState(false);
  const [modalSelected, setModalSelected] = useState<any>(null);
  const [modalGlobalSearch, setModalGlobalSearch] = useState(false);
  // When set, the Add Equipment modal is in "Replace" mode — confirming
  // swaps the selected library item's specs onto this existing device
  // (keeping its position/uid) instead of adding a new one to the room.
  const [replacingDeviceUid, setReplacingDeviceUid] = useState<number | null>(null);
  const [modalDeviceName, setModalDeviceName] = useState("");
  const [modalMake,     setModalMake]     = useState("");
  const [modalModel,    setModalModel]    = useState("");
  const [deviceContextMenu, setDeviceContextMenu] = useState<{x:number;y:number;uid:number}|null>(null);
  const [rotatePopup, setRotatePopup] = useState<{x:number;y:number;uid:number;value:string}|null>(null);
  const [editingDevice, setEditingDevice] = useState<PlacedDevice|null>(null);
  const [showTable,     setShowTable]     = useState(false);
  const [showTableSizeEditor, setShowTableSizeEditor] = useState(false);
  const [tableEditW,    setTableEditW]    = useState("");
  const [tableEditL,    setTableEditL]    = useState("");
  const [showFurnitureEditor, setShowFurnitureEditor] = useState(false);
  const [furnitureEditUid, setFurnitureEditUid] = useState<number|null>(null);
  const [furnitureEditW, setFurnitureEditW] = useState("");
  const [furnitureEditL, setFurnitureEditL] = useState("");
  const [dragUid,       setDragUid]       = useState<number|null>(null);
  const [dragStart,     setDragStart]     = useState<{x:number;y:number}|null>(null);
  const [wallDragEdge,  setWallDragEdge]  = useState<"north"|"south"|"east"|"west"|null>(null);
  const [wallDragStart, setWallDragStart] = useState<{svgX:number;svgY:number;origW:number;origL:number}|null>(null);
  const [selectedEdge,  setSelectedEdge]  = useState<"north"|"south"|"east"|"west"|null>(null);
  const [deletedWalls,  setDeletedWalls]  = useState<Set<string>>(new Set());
  // Unified multi-select: items like "chair:0", "table", "door"
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isItemSelected = (id: string) => selected.has(id);
  const toggleSelect = (id: string, ctrlKey: boolean) => {
    setSelected(prev => {
      if (ctrlKey) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      return prev.has(id) && prev.size === 1 ? new Set() : new Set([id]);
    });
    setSelectedEdge(null);
  };
  // Multi-select for placed AV devices
  const [selectedUids, setSelectedUids] = useState<Set<number>>(new Set());
  const clearSelection = () => { setSelected(new Set()); setSelectedUids(new Set()); };
  const dragStartedRef = useRef(false);
  // Set when a ctrl+click toggle or group drag just happened, so the click that
  // follows on mouseup doesn't wipe the multi-selection via the canvas handler
  const suppressClickClear = useRef(false);
  // Latest "built-in table/chairs -> placed furniture" converter, for the
  // window-level Ctrl+C handler (its effect doesn't re-subscribe on table
  // edits, so it would otherwise copy from a stale table position).
  const copyBuiltInRef = useRef<() => PlacedDevice[]>(() => []);

  const [deletedChairs, setDeletedChairs] = useState<Set<number>>(new Set());
  const [tableDeleted,  setTableDeleted]  = useState(false);
  const [doorDeleted,   setDoorDeleted]   = useState(false);
  // Doors placed on walls: wall, position along wall (0-1), width in meters
  type PlacedDoor = { id: number; wall: "north"|"south"|"east"|"west"|"drawn"; pos: number; width: number; type: "door"|"window"; wallUid?: number; flipped?: boolean; swingFlipped?: boolean };
  const [placedDoors, setPlacedDoors] = useState<PlacedDoor[]>([]);
  const [dragNewDoor, setDragNewDoor] = useState<{type:"door"|"window";active:boolean;wall:"north"|"south"|"east"|"west"|"drawn"|null;pos:number;wallUid?:number}|null>(null);
  const [doorDragId, setDoorDragId] = useState<number|null>(null);
  const [doorDragStart, setDoorDragStart] = useState<{svgX:number;svgY:number;origWall:string;origPos:number}|null>(null);
  const [tableCenterX,  setTableCenterX]  = useState<number|null>(null);
  const [dragNewTable,  setDragNewTable]  = useState<{active:boolean;worldX:number;worldY:number;alignRef?:{x:number;y:number}|null}|null>(null);
  const [dragNewChair,  setDragNewChair]  = useState<{active:boolean;worldX:number;worldY:number;alignRef?:{x:number;y:number}|null}|null>(null);
  const [dragNewDevice, setDragNewDevice] = useState<{active:boolean;item:DeviceCatalogItem;worldX:number;worldY:number;wall:"north"|"south"|"east"|"west"|null}|null>(null);
  // Free-angle rotation drag
  const [rotDragUid, setRotDragUid] = useState<number|null>(null);
  const [rotDragCenter, setRotDragCenter] = useState<{x:number;y:number}|null>(null);
  const [tableRotation, setTableRotation] = useState(0);
  const [rotatingTable, setRotatingTable] = useState(false);
  const [tableRotCenter, setTableRotCenter] = useState<{x:number;y:number}|null>(null);
  const [chairOffsets,  setChairOffsets]  = useState<Record<number,{dx:number;dy:number}>>({});
  // Table edge resize drag
  const [tableResizeDrag, setTableResizeDrag] = useState<{edge:"left"|"right"|"top"|"bottom";startSvgX:number;startSvgY:number;origWidth:number;origLength:number;origSeats:number}|null>(null);
  // Multi-item drag
  const [multiDrag,     setMultiDrag]     = useState<{startSvgX:number;startSvgY:number;origTableCX:number;origWallDist:number;origChairOffsets:Record<number,{dx:number;dy:number}>;items:Set<string>;origDevs:{uid:number;x:number;y:number}[]}|null>(null);

  // Undo history
  type UndoSnapshot = {
    roomW: number; roomL: number; roomH: number;
    deletedWalls: Set<string>; deletedChairs: Set<number>; tableDeleted: boolean;
    doorDeleted: boolean; placedDevices: PlacedDevice[]; showTable: boolean; placedDoors: PlacedDoor[]; tableLengthOverride: number|null; tableRotation: number;
    tableCenterX: number|null; tableWallDist: number; chairOffsets: Record<number,{dx:number;dy:number}>;
    hiddenDevices: PlacedDevice[];
  };
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const pushUndo = () => {
    setUndoStack(prev => [...prev.slice(-30), {
      roomW, roomL, roomH,
      deletedWalls: new Set(deletedWalls),
      deletedChairs: new Set(deletedChairs),
      tableDeleted, doorDeleted,
      placedDevices: [...placedDevices],
      showTable, tableCenterX, tableWallDist, placedDoors: [...placedDoors], tableLengthOverride, tableRotation,
      chairOffsets: {...chairOffsets},
      hiddenDevices: [...hiddenDevices],
    }]);
  };
  const popUndo = () => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const snap = prev[prev.length - 1];
      setRoomW(snap.roomW); setRoomL(snap.roomL); setRoomH(snap.roomH);
      setDeletedWalls(new Set(snap.deletedWalls));
      setDeletedChairs(new Set(snap.deletedChairs));
      setTableDeleted(snap.tableDeleted);
      setDoorDeleted(snap.doorDeleted);
      setPlacedDevices([...snap.placedDevices]);
      setPlacedDoors([...snap.placedDoors]);
      setTableLengthOverride(snap.tableLengthOverride);
      setTableRotation(snap.tableRotation);
      setShowTable(snap.showTable);
      setTableCenterX(snap.tableCenterX);
      setTableWallDist(snap.tableWallDist);
      setChairOffsets({...snap.chairOffsets});
      setHiddenDevices([...snap.hiddenDevices]);
      return prev.slice(0, -1);
    });
  };
  const [selectedUid,   setSelectedUid]   = useState<number|null>(null);
  // Equipment hidden from THIS view only. Kept in the saved design (so it isn't
  // re-imported from Signal Flow) but not drawn, listed or exported here; every
  // other tool and the BOM still have it. Not part of `placedDevices` so the
  // rest of this file never has to know to skip it.
  const [hiddenDevices, setHiddenDevices] = useState<PlacedDevice[]>([]);
  // Equipment awaiting the "delete from every tool?" confirmation.
  const [deleteConfirm, setDeleteConfirm] = useState<{ uids: number[]; names: string[] } | null>(null);
  const [clipboard,     setClipboard]     = useState<PlacedDevice[]>([]);
  const [generatingFromScope, setGeneratingFromScope] = useState(false);
  const [scopeReimportConfirm, setScopeReimportConfirm] = useState(false);
  const [generateNotice, setGenerateNotice] = useState<{kind:"ok"|"error";message:string}|null>(null);
  const { isLibraryAdmin } = useLibraryAdmin();
  const [showHfov,      setShowHfov]      = useState(false);
  const [viewMode,      setViewMode]      = useState("plan");
  const [zoom,          setZoom]          = useState(1.5);
  const [pan,           setPan]           = useState({x:0,y:0});
  const [isPanning,     setIsPanning]     = useState(false);
  const [panMode,       setPanMode]       = useState(false);
  // Per-canvas lock: keys are "plan" | "ceil" | "mic" | "wallSpk" | "wallMic".
  // A locked canvas ignores panning and zooming until unlocked.
  const [lockedViews,   setLockedViews]   = useState<Record<string, boolean>>({});
  // Per-canvas collapse: same keys — a collapsed canvas hides its body, leaving just the title bar
  const [collapsedCanvases, setCollapsedCanvases] = useState<Set<string>>(new Set());
  const toggleCanvasCollapsed = (key: string) => setCollapsedCanvases(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const collapseToggle = (key: string) => (
    <button
      onClick={() => toggleCanvasCollapsed(key)}
      title={collapsedCanvases.has(key) ? "Expand canvas" : "Collapse canvas"}
      style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",display:"flex",alignItems:"center",justifyContent:"center",width:24,height:24,borderRadius:5,border:"1px solid rgb(var(--border))",background:"rgb(var(--forge-surface) / 0.4)",color:"rgb(var(--text-muted))",cursor:"pointer",padding:0}}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{transform:collapsedCanvases.has(key)?"rotate(-90deg)":"none",transition:"transform 0.15s"}}>
        <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
  const [moveMode,      setMoveMode]      = useState(false);
  const [moveDragStart, setMoveDragStart] = useState<{x:number;y:number}|null>(null);
  const [marquee, setMarquee] = useState<{startSvgX:number;startSvgY:number;curSvgX:number;curSvgY:number}|null>(null);
  const didMarqueeDrag = useRef(false);
  const [panStart,      setPanStart]      = useState({x:0,y:0,px:0,py:0});
  const [ceilZoom,      setCeilZoom]      = useState(1.5);
  const [ceilPan,       setCeilPan]       = useState({x:0,y:0});
  const [isCeilPanning, setIsCeilPanning] = useState(false);
  const [ceilPanStart,  setCeilPanStart]  = useState({x:0,y:0,px:0,py:0});
  const [ceilDragUid,   setCeilDragUid]   = useState<number|null>(null);
  const [ceilDragStart, setCeilDragStart] = useState<{x:number,y:number}|null>(null);
  const ceilSvgRef = useRef<SVGSVGElement>(null);
  // Elevations pane pan/zoom — same wheel/lock conventions as Floor Plan
  // and Ceiling Plan (no draggable devices in here, so no dragUid needed).
  const [elevZoom,      setElevZoom]      = useState(1.5);
  const [elevPan,       setElevPan]       = useState({x:0,y:0});
  const [isElevPanning, setIsElevPanning] = useState(false);
  const [elevPanStart,  setElevPanStart]  = useState({x:0,y:0,px:0,py:0});
  const elevSvgRef = useRef<SVGSVGElement>(null);
  // Floor Plan / Ceiling Plan side-by-side split — fraction (0-1) of the
  // shared row's width given to Floor Plan; drag the divider to resize.
  const [floorCeilSplit, setFloorCeilSplit] = useState(0.5);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const floorCeilRowRef = useRef<HTMLDivElement>(null);
  // Floor+Ceiling row / Elevations row vertical split — height given to the
  // top row, as a percent of viewport height (vh), matching the vh units
  // both rows already used before this was resizable; Elevations always
  // gets the rest. Tracked as an incremental drag (mouse Y delta -> vh
  // delta) rather than measuring a container rect, since — unlike the
  // side-by-side split — there's no single shared-height container these
  // two stacked, independently-scrollable rows both live inside.
  const [topRowHeightVh, setTopRowHeightVh] = useState(50);
  const [isDraggingRowSplit, setIsDraggingRowSplit] = useState(false);

  // Elevation markers — see the ElevationMarker type above. `placingElevationMarker`
  // arms a single click-to-drop on the plan canvas (mirrors how door/chair/table
  // placement already works); `elevMarkerDrag` tracks an in-progress reposition
  // drag; `elevMarkerContextMenu` is the right-click menu used to toggle which
  // of the 4 direction flags (N/E/S/W) are active on a marker. A marker can
  // drive up to 4 simultaneous elevation views, so the pane below is keyed by
  // `${markerId}-${dirKey}`, not just marker id — `activeElevationKey` tracks
  // which one is currently shown.
  const [elevationMarkers,       setElevationMarkers]       = useState<ElevationMarker[]>([]);
  const [placingElevationMarker, setPlacingElevationMarker] = useState(false);
  const [selectedElevationId,    setSelectedElevationId]    = useState<number | null>(null);
  const [activeElevationKey,     setActiveElevationKey]     = useState<string | null>(null);
  const [elevMarkerDrag,         setElevMarkerDrag]         = useState<{id: number} | null>(null);
  const [elevMarkerContextMenu,  setElevMarkerContextMenu]  = useState<{x: number; y: number; id: number} | null>(null);
  // Dragging equipment directly in the Elevations pane — horizontal motion
  // slides the device along the wall it's facing (`perp`, the view's own
  // left-right axis, so the drag stays flush to whichever wall/angle is
  // being viewed); vertical motion changes its mount height (z, feet AFF).
  // `perp` is captured at drag start since it depends on which elevation
  // view is active and doesn't change mid-drag.
  const [elevItemDrag, setElevItemDrag] = useState<{
    uid: number; startSvgX: number; startSvgY: number;
    origX: number; origY: number; origZ: number;
    perpX: number; perpY: number; isCeiling: boolean; hFt: number;
  } | null>(null);
  // Dragging an equipment call-out label in the Elevations pane, separate
  // from dragging the equipment box itself — stores the offset (feet, scaled
  // by whichever elevation view's own eScale at render time) in
  // calloutElevDx/Dy rather than moving the device.
  const [elevCalloutDrag, setElevCalloutDrag] = useState<{
    uid: number; startSvgX: number; startSvgY: number; origDxFt: number; origDyFt: number;
  } | null>(null);
  // Double-click the bottom-of-equipment dimension label to type an exact
  // mount height instead of dragging for it — same inline-edit convention as
  // the wall-length editor below.
  const [editingElevDimUid, setEditingElevDimUid] = useState<number | null>(null);
  const [elevDimInput, setElevDimInput] = useState("");
  const elevDimInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingElevDimUid === null) return;
    requestAnimationFrame(() => { elevDimInputRef.current?.focus(); elevDimInputRef.current?.select(); });
  }, [editingElevDimUid]);

  const svgRef = useRef<SVGSVGElement>(null);
  // The Elevations pane's own px/ft scale (`eScale`, computed per-render from
  // whichever elevation view is active — it depends on that view's wall width
  // and room height, not room width/length, so it's unrelated to the Floor/
  // Ceiling Plan's scale and changes when the user switches elevation tabs).
  // Kept in a ref — refreshed every render by the Elevations pane itself,
  // just below — so the Dimension tool's formatDistance (declared here,
  // before that pane computes it) always reads the current value.
  const elevScaleRef = useRef(1);

  // Annotations (Text / Shape / Pencil / Highlight / Eraser) on the floor plan
  // canvas — stored in the plan SVG's user space so they pan/zoom with the view
  const annotate = useCanvasAnnotations({
    // Uses e.currentTarget rather than a single fixed ref so the exact same
    // handlers, wired into all three canvases (Floor Plan/Ceiling Plan/
    // Elevations), each compute points against whichever <svg> they actually
    // fired on — every one of them shares the same 600x420 viewBox
    // convention, just with its own independent zoom/pan. e.currentTarget
    // isn't always the <svg> root itself, though — dragging an *existing*
    // annotation (CanvasAnnotations' own startDrag) attaches its mousedown
    // listener directly to that annotation's rendered element (a <path>,
    // <rect>, <g>, <text>…), none of which implement createSVGPoint. Walk up
    // to the owning root via ownerSVGElement in that case.
    getPoint: (e) => {
      const el = e.currentTarget as unknown as SVGSVGElement | SVGGraphicsElement;
      if (!el) return null;
      const svg = typeof (el as SVGSVGElement).createSVGPoint === "function"
        ? (el as SVGSVGElement)
        : (el as SVGGraphicsElement).ownerSVGElement;
      if (!svg) return null;
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
      return { x: p.x, y: p.y };
    },
    getZoom: () => zoom,
    // The Dimension tool measures in each canvas's own user-space units,
    // which only share one px/ft scale on the Floor/Ceiling Plan (px/ft =
    // min(380/roomW, 270/roomL), same formula as the later `planScale`
    // const). The Elevations pane runs its own independent scale per view
    // (see `elevScaleRef` above) — using the plan scale there was giving
    // dimensions wildly different from the pane's own auto-calculated
    // bottom-of-equipment height. Computed inline (not via the shared
    // `planScale`/`toDisplay` consts declared further down the component)
    // because `useCanvasAnnotations` renders any already-loaded annotation
    // immediately when called here — before this component's own later
    // `const`s have run in this render pass, so a dimension annotation
    // loaded from a save would hit them mid-TDZ.
    formatDistance: (px, canvasKey) => {
      const ftScale = canvasKey === "elev" ? elevScaleRef.current : Math.min(380 / roomW, 270 / roomL);
      const totalQ = Math.round((px / ftScale) * 12 * 4);
      const f = Math.floor(totalQ / 48), remQ = totalQ % 48;
      const wholeIn = Math.floor(remQ / 4), q = remQ % 4;
      const frac = q === 0 ? "" : q === 1 ? "¼" : q === 2 ? "½" : "¾";
      return `${f}′ ${wholeIn}${frac}″`;
    },
  });

  // Wheel pan/zoom for both canvases (same gestures as Signal Flow): wheel
  // pans, shift+wheel pans horizontally, ctrl/cmd+wheel zooms. Latest zoom
  // values and locks are mirrored into a ref so the single document-level
  // listener never sees stale state.
  const rdWheelState = useRef({ zoom: 1.5, ceilZoom: 1.5, elevZoom: 1.5, lockedViews: {} as Record<string, boolean> });
  rdWheelState.current = { zoom, ceilZoom, elevZoom, lockedViews };
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = (e.target as Element).closest?.("[data-rd-canvas]");
      if (!el) return;
      // A plain wheel (no modifiers) is left alone entirely — it scrolls the
      // whole page (Floor Plan, Ceiling Plan, and Elevations together)
      // normally, instead of being hijacked to pan whichever individual
      // canvas happens to be under the cursor. Only the deliberate
      // ctrl/cmd-zoom and shift-horizontal-pan gestures still take over the
      // wheel, since those aren't something a user would trigger by accident
      // while just trying to scroll past a canvas.
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;
      e.preventDefault();
      const key = el.getAttribute("data-rd-canvas")!;
      const s = rdWheelState.current;
      if (s.lockedViews[key]) return;
      const z = key==="plan" ? s.zoom : key==="ceil" ? s.ceilZoom : s.elevZoom;
      const setZ = key==="plan" ? setZoom : key==="ceil" ? setCeilZoom : setElevZoom;
      const setP = key==="plan" ? setPan : key==="ceil" ? setCeilPan : setElevPan;
      if (e.ctrlKey || e.metaKey) {
        setZ(zv => Math.min(3, Math.max(0.25, zv * Math.exp(-e.deltaY * 0.0015))));
      } else {
        setP(p => ({ x: p.x - (e.deltaY || e.deltaX) / z, y: p.y }));
      }
    };
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", onWheel, { capture: true } as any);
  }, []);

  // Floor Plan / Ceiling Plan divider drag — recomputes the split fraction
  // from the shared row's own bounding box so it stays correct regardless of
  // window width, clamped so neither half can be dragged away to nothing.
  useEffect(() => {
    if (!isDraggingSplit) return;
    const onMove = (e: MouseEvent) => {
      const rect = floorCeilRowRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const frac = (e.clientX - rect.left) / rect.width;
      setFloorCeilSplit(Math.min(0.8, Math.max(0.2, frac)));
    };
    const onUp = () => setIsDraggingSplit(false);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = prevCursor;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDraggingSplit]);

  // Floor+Ceiling row / Elevations row divider drag — same idea as the
  // side-by-side split above, but vertical: accumulates the mouse's
  // per-event Y movement as a vh delta, clamped so neither row can be
  // dragged down to nothing.
  useEffect(() => {
    if (!isDraggingRowSplit) return;
    const onMove = (e: MouseEvent) => {
      const deltaVh = (e.movementY / window.innerHeight) * 100;
      setTopRowHeightVh(prev => Math.min(80, Math.max(20, prev + deltaVh)));
    };
    const onUp = () => setIsDraggingRowSplit(false);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "row-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = prevCursor;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDraggingRowSplit]);

  // AutoCAD-style zoom extents: double-click the middle mouse button on a
  // canvas to re-fit the room in the view. The listener is mounted once and
  // reads the latest fit logic through a ref (same pattern as rdWheelState).
  const zoomExtentsRef = useRef<(key: string) => void>(() => {});
  useEffect(() => {
    let last = { key: "", t: 0 };
    const onMidDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const el = (e.target as Element).closest?.("[data-rd-canvas]");
      if (!el) return;
      // Always suppress the browser's middle-click autoscroll over a canvas.
      // Child elements (devices) stop propagation before the svg's own
      // preventDefault runs, and once autoscroll engages Chrome swallows the
      // second click — the double-click would never be seen.
      e.preventDefault();
      const key = el.getAttribute("data-rd-canvas")!;
      const now = Date.now();
      if (last.key === key && now - last.t < 600) {
        // second middle click within the window — zoom extents instead of pan
        e.stopPropagation();
        zoomExtentsRef.current(key);
        last = { key: "", t: 0 };
      } else {
        last = { key, t: now };
      }
    };
    document.addEventListener("mousedown", onMidDown, { capture: true });
    return () => document.removeEventListener("mousedown", onMidDown, { capture: true } as any);
  }, []);

  // Wall drawing mode (polygonal — continuous click-to-draw)
  const [isDrawingWall,   setIsDrawingWall]   = useState(false);
  const [drawingWallType, setDrawingWallType] = useState<"drywall"|"glass"|"solid">("drywall");
  const [wallPoints,      setWallPoints]      = useState<{x:number;y:number}[]>([]);
  const [wallMousePos,    setWallMousePos]    = useState<{x:number;y:number}|null>(null);
  const [wallSnapPoint,   setWallSnapPoint]   = useState<{x:number;y:number}|null>(null);
  const [wallLengthInput, setWallLengthInput] = useState("");
  const [cursorScreenPos, setCursorScreenPos] = useState<{x:number;y:number}|null>(null);
  const [orthoMode,       setOrthoMode]       = useState(false);
  const wallInputRef = useRef<HTMLInputElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const WALL_SNAP_DIST = 1; // feet — snap to first point to close polygon
  const TRACK_SNAP_DIST = 0.4; // feet — object-snap-tracking alignment tolerance
  const ENDPOINT_SNAP_DIST = 0.8; // feet — snap cursor onto existing wall endpoints / room corners
  const [trackGuides, setTrackGuides] = useState<{from:{x:number;y:number};to:{x:number;y:number}}[]>([]);
  // Dragging one endpoint of a drawn wall to stretch/shorten it (end 0 = start, 1 = end)
  const [wallStretchDrag, setWallStretchDrag] = useState<{uid:number; end:0|1}|null>(null);
  const [editingWallUid, setEditingWallUid] = useState<number|null>(null);
  const [editWallLength, setEditWallLength] = useState("");
  const editWallInputRef = useRef<HTMLInputElement>(null);
  // Legacy compat
  const wallStart = wallPoints.length > 0 ? wallPoints[wallPoints.length - 1] : null;

  // Floor plan image import — floorPlanWidthFt is the image's real-world
  // width (calibrated via Set Scale below); floorPlanNativeSize is its raw
  // pixel dimensions (captured once on load, purely to preserve aspect
  // ratio when rendering). Height in feet is always derived from these two,
  // never stored separately, so the two can't drift out of proportion.
  const [floorPlanImg,       setFloorPlanImg]       = useState<string | null>(null);
  const [floorPlanWidthFt,   setFloorPlanWidthFt]   = useState(16);
  const [floorPlanNativeSize, setFloorPlanNativeSize] = useState<{w:number;h:number}|null>(null);
  const [floorPlanOffset,    setFloorPlanOffset]    = useState({x: 0, y: 0});
  const [isScalingFloorPlan, setIsScalingFloorPlan] = useState(false);
  const [scaleRefPoints,     setScaleRefPoints]     = useState<{x:number;y:number}[]>([]);
  // Bluebeam-style calibration: pick two points of a known real-world
  // dimension, then enter that dimension in whichever unit is easiest to
  // read off the drawing (feet, architectural feet+inches, or millimeters)
  // — scaleRefLength holds the feet value in "ft-in" mode, the sole value
  // otherwise. Always converted to inches internally (see
  // scaleRefToInches/applyScaleReference) to match the equipment library's
  // own dimension unit, regardless of which unit was actually typed.
  const [scaleRefUnit,       setScaleRefUnit]       = useState<"ft"|"ft-in"|"in"|"mm">("ft-in");
  const [scaleRefLength,     setScaleRefLength]     = useState("");
  const [scaleRefInches,     setScaleRefInches]     = useState("");
  const floorPlanInputRef = useRef<HTMLInputElement>(null);

  // Capture the background image's own pixel dimensions whenever it
  // changes — needed to render it at its correct aspect ratio once
  // floorPlanWidthFt gives it a real-world size. Runs for every path that
  // can set floorPlanImg (fresh upload, DXF/PDF import, or loading a saved
  // design), rather than duplicating this in each of those call sites.
  useEffect(() => {
    if (!floorPlanImg) { setFloorPlanNativeSize(null); return; }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => { if (!cancelled) setFloorPlanNativeSize({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 }); };
    img.src = floorPlanImg;
    return () => { cancelled = true; };
  }, [floorPlanImg]);

  // Track current project/room IDs for save
  const currentProjectId = useRef<string | null>(null);
  const currentRoomId = useRef<string | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const saveDesign = useCallback(async (devices: PlacedDevice[], config: Record<string, unknown>) => {
    const pid = currentProjectId.current;
    const rid = currentRoomId.current || "default";
    if (!pid) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const designData = { devices, config };
    const { data: existing } = await supabase
      .from("room_designs").select("id").eq("project_id", pid).eq("room_id", rid).single();

    if (existing) {
      await supabase.from("room_designs")
        .update({ data: designData, updated_at: new Date().toISOString() })
        .eq("project_id", pid).eq("room_id", rid);
    } else {
      await supabase.from("room_designs")
        .insert({ project_id: pid, room_id: rid, user_id: user.id, data: designData });
    }
  }, []);

  // The room's built-in table and chairs are drawn from `showTable` plus a set
  // of edits layered on top (table deleted, individual chairs deleted, table
  // moved/rotated, chairs nudged, edges removed). All of it has to be saved
  // together: persisting only `showTable` meant a deleted table and chairs
  // came straight back on refresh with their default layout.
  const tableEditsConfig = () => ({
    tableDeleted, tableCenterX, tableRotation, chairOffsets,
    deletedChairs: Array.from(deletedChairs),
    deletedWalls: Array.from(deletedWalls),
    hiddenDevices,
  });

  const triggerAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDesign(placedDevices, {
        roomType, roomW, roomL, roomH, tableShape, tableSeats, tableWidth, tableLengthOverride, tableWallDist, showTable, selectedWall, placedDoors,
        ...tableEditsConfig(),
        annotations: annotate.annotations,
        floorPlanImg, floorPlanWidthFt, floorPlanOffset,
        elevationMarkers,
      });
    }, 1500);
  }, [placedDevices, placedDoors, roomType, roomW, roomL, roomH, tableShape, tableSeats, tableWidth, tableLengthOverride, tableWallDist, showTable, tableDeleted, tableCenterX, tableRotation, chairOffsets, deletedChairs, deletedWalls, hiddenDevices, selectedWall, annotate.annotations, floorPlanImg, floorPlanWidthFt, floorPlanOffset, elevationMarkers, saveDesign]);

  // Auto-save on changes (after step 2 is active, and only once this room's
  // own saved design has actually finished loading — otherwise the reset
  // below, or the load itself still being in flight, would get saved as if
  // it were a real edit).
  React.useEffect(() => {
    if (step === 2 && rdLoaded) triggerAutoSave();
  }, [placedDevices, placedDoors, tableShape, tableSeats, tableWidth, tableWallDist, showTable, selectedWall, annotate.annotations, step, rdLoaded, triggerAutoSave]);

  // Sync placed AV devices to shared BOM
  const { updateSlice, reloadBaseline, updateUnitSpec, updateUnitSpecs } = useBOM();
  const { activeOrg } = useOrg();
  React.useEffect(() => {
    updateSlice('room-designer', [
      ...(placedDevices.map(roomDeviceToBOM).filter(Boolean) as BOMDeviceEntry[]),
      // Hidden here, still bought: counted by the BOM but without the ROOM tag.
      ...(hiddenDevices.map(roomDeviceToBOM).filter(Boolean) as BOMDeviceEntry[]).map(e => ({ ...e, hidden: true })),
    ]);
  }, [placedDevices, hiddenDevices, updateSlice]);

  // One unit, one existence across Room Designer / Signal Flow / the rack:
  // deleting equipment here removes it from the other two and from the BOM
  // (a scope re-import rebuilds everything itself, so it is left out). Hidden
  // equipment is still this tool's, so hiding never reads as a deletion.
  useRetireRemovedUnits(
    "room-designer",
    [...placedDevices, ...hiddenDevices].filter(d => !isRoomFurniture(d)).map(d => d.itemId),
    rdLoaded,
    generatingFromScope,
  );

  // A unit edited or replaced in another tool carries that change here: lay the
  // room's recorded unit specs over this tool's copies once its own data is in.
  React.useEffect(() => {
    if (!rdLoaded || !projectParam) return;
    let cancelled = false;
    loadUnitSpecs(roomParam, projectParam).then(specs => {
      if (cancelled) return;
      // A real product this tool holds that nobody has shared yet (swapped in
      // before changes were shared between tools): share it now, so Signal Flow
      // and the rack show it instead of their still-generic copy.
      const unshared = [...placedDevices, ...hiddenDevices]
        .filter(d => d.itemId && !isRoomFurniture(d) && isLibraryProduct(d)
          && (!specs[d.itemId] || (!("ports" in specs[d.itemId]) && (d.ports?.length ?? 0) > 0)))
        .map(d => [d.itemId as string, specFromRoomDevice(d)] as [string, ReturnType<typeof specFromRoomDevice>]);
      if (unshared.length) updateUnitSpecs(unshared);
      if (Object.keys(specs).length === 0) return;
      const overlay = (list: PlacedDevice[]) => {
        let changed = false;
        const next = list.map(d => {
          const sp = d.itemId ? specs[d.itemId] : undefined;
          if (!sp) return d;
          changed = true;
          return applySpecToRoomDevice(d, sp);
        });
        return changed ? next : list;
      };
      setPlacedDevices(overlay);
      setHiddenDevices(overlay);
    });
    return () => { cancelled = true; };
  }, [rdLoaded, roomParam, projectParam]);

  // Delete vs Hide. Delete removes the unit from every tool and the BOM, so
  // equipment always asks first; walls, tables and chairs are just drawing
  // geometry and are deleted straight away.
  const deleteDevicesNow = (uids: number[]) => {
    const gone = new Set(uids);
    pushUndo();
    setPlacedDoors(prev => prev.filter(d => !gone.has(d.wallUid ?? -1)));
    setPlacedDevices(prev => prev.filter(d => !gone.has(d.uid)));
    setSelectedUid(null);
    setSelectedUids(new Set());
  };
  const requestDeleteDevices = (uids: number[]) => {
    const targets = placedDevices.filter(d => uids.includes(d.uid));
    if (!targets.length) return;
    const equipment = targets.filter(d => !isRoomFurniture(d));
    if (equipment.length) setDeleteConfirm({ uids: targets.map(d => d.uid), names: equipment.map(d => d.name) });
    else deleteDevicesNow(targets.map(d => d.uid));
  };
  // The keyboard shortcut lives in a window-level effect that doesn't
  // re-subscribe on every change, so it calls through a ref to stay current.
  const requestDeleteRef = React.useRef(requestDeleteDevices);
  requestDeleteRef.current = requestDeleteDevices;

  // Hide: take the equipment out of this view only. It stays in Signal Flow,
  // the rack and the BOM (which just drops the ROOM tag for it).
  const hideDevices = (uids: number[]) => {
    const targets = placedDevices.filter(d => uids.includes(d.uid) && !isRoomFurniture(d));
    if (!targets.length) return;
    pushUndo();
    const gone = new Set(targets.map(d => d.uid));
    setHiddenDevices(prev => [...prev, ...targets.map(d => ({ ...d, itemId: d.itemId || newItemId() }))]);
    setPlacedDevices(prev => prev.filter(d => !gone.has(d.uid)));
    setSelectedUid(null);
    setSelectedUids(new Set());
  };
  const showHiddenDevice = (itemId: string) => {
    const dev = hiddenDevices.find(d => d.itemId === itemId);
    if (!dev) return;
    pushUndo();
    setHiddenDevices(prev => prev.filter(d => d.itemId !== itemId));
    setPlacedDevices(prev => [...prev, dev]);
  };
  // Drag a BOM row onto the Floor Plan or Ceiling Plan to put one of its units
  // on the plan where it is dropped. That unit is either one hidden in this
  // view (brought straight back) or one that only exists in Signal Flow / the
  // rack (a new device is created for it, carrying the SAME itemId so it stays
  // one unit across the tools). Wall-mounted equipment snaps to a wall when
  // dropped near one (same rule as dragging it); from the Ceiling Plan only
  // ceiling-mounted equipment is repositioned, anything else lands where it
  // would on a fresh placement.
  const acceptBomUnit = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes(BOM_UNIT_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };
  // A device for a unit that has never been on this plan: the same icon/size/
  // mount its category or name maps to in a scope import, or — for something
  // with no floor-plan symbol (a compute unit, a switch) — a plain box, like
  // "Add Equipment" gives an unrecognised item.
  const deviceFromBomUnit = (u: BOMDragUnit): PlacedDevice => {
    const template = resolveScopeDeviceTemplate(u.cat || "", u.name, "");
    const base: any = template ?? { id: "custom", name: u.name, icon: "📦", w: 0.5, h: 0.5, wall: "floor", type: "custom", color: "#64748b" };
    const isCeilingMic = base.type === "mic" && base.wall === "ceiling";
    return {
      ...base, itemId: u.itemId, productKey: u.productKey, name: u.name,
      ...(u.mfr && u.mfr !== "Generic" ? { mfr: u.mfr, ...(u.model ? { model: u.model } : {}) } : {}),
      uid: Date.now() + Math.random(), x: 0, y: 0, z: 0, mountWall: "floor",
      hfov: base.hfovDeg ?? (base.type === "camera" ? (base.id === "soundbar-cam" ? 120 : base.id === "ceiling-cam" ? 90 : 70) : undefined),
      covShape: base.coveragePattern === "circular" ? "round" : base.coveragePattern === "rectangular" ? "square" : isCeilingMic ? "round" : undefined,
      covDiameter: base.coverageDiameterFt ?? (isCeilingMic ? 6 : base.id === "table-mic" ? 2 : undefined),
      covW: base.coverageWidthFt ?? (isCeilingMic ? 6 : undefined),
      covL: base.coverageDepthFt ?? (isCeilingMic ? 6 : undefined),
      dispersion: base.coverageAngleDeg ?? (base.type === "speaker" && base.wall === "ceiling" ? 90 : undefined),
    } as PlacedDevice;
  };
  const dropBomUnit = (e: React.DragEvent, view: "plan" | "ceil") => {
    const raw = e.dataTransfer.getData(BOM_UNIT_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    let unit: BOMDragUnit;
    try { unit = JSON.parse(raw) as BOMDragUnit; } catch { return; }
    if (!unit?.itemId) return;
    // Already on the plan (dropped twice, or added another way meanwhile): nothing to do.
    if (placedDevices.some(d => d.itemId === unit.itemId)) return;
    const hidden = hiddenDevices.find(d => d.itemId === unit.itemId);
    const dev = hidden ?? deviceFromBomUnit(unit);
    let { x, y } = dev;
    let { z, mountWall } = dev;
    let extra: Partial<PlacedDevice> = {};
    const svg = view === "plan" ? svgRef.current : ceilSvgRef.current;
    const ctm = svg?.getScreenCTM();
    if (svg && ctm) {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      let wx: number, wy: number;
      if (view === "plan") {
        wx = (p.x - planOffX) / planScale; wy = (p.y - planOffY) / planScale;
      } else {
        const cScale = Math.min(380 / roomW, 270 / roomL);
        wx = (p.x - (600 - roomW * cScale) / 2) / cScale; wy = (p.y - (420 - roomL * cScale) / 2) / cScale;
      }
      wx = Math.max(cMinX, Math.min(cMaxX, wx)); wy = Math.max(cMinY, Math.min(cMaxY, wy));
      const onCeiling = dev.wall === "ceiling" || dev.mountWall === "ceiling";
      const wallType = dev.wall === "front" || dev.wall === "side";
      const wasWallMounted = dev.mountWall === "north" || dev.mountWall === "south" || dev.mountWall === "west" || dev.mountWall === "east" || dev.mountWall === "drawn";
      if (hidden && view === "ceil" && !onCeiling) {
        // a hidden wall/floor unit dropped on the Ceiling Plan: keep its original position
      } else if (wallType || wasWallMounted) {
        const snap = snapDeviceToNearestWall(wx, wy);
        if (snap && (hidden ? snap.dist < 1.5 : true)) {
          x = snap.x; y = snap.y; z = roomH * 0.55;
          extra = { mountWall: snap.mountWall as PlacedDevice["mountWall"], wallUid: snap.wallUid, rotation: snap.angleDeg };
        } else { x = wx; y = wy; }
      } else {
        x = wx; y = wy;
        if (!hidden) {
          if (dev.wall === "ceiling") { z = roomH - 0.05; mountWall = "ceiling"; }
          else if (dev.wall === "table") { z = 0.76; mountWall = "floor"; }
        }
      }
    }
    pushUndo();
    if (hidden) setHiddenDevices(prev => prev.filter(d => d.itemId !== unit.itemId));
    setPlacedDevices(prev => [...prev, { ...dev, z, mountWall, ...extra, x, y }]);
    setSelectedUid(dev.uid);
  };
  useHiddenUnitsRegistry(
    "room-designer",
    hiddenDevices.map(d => ({ itemId: d.itemId as string, name: d.name })),
    showHiddenDevice,
  );

  // Auto-expand BOM when a device is added (not on initial load)
  const bomBaseline = React.useRef(-1);
  const avDeviceCount = placedDevices.filter(d => d.type !== 'furniture').length;
  React.useEffect(() => {
    if (!rdLoaded) return;
    if (bomBaseline.current === -1) {
      bomBaseline.current = avDeviceCount;
      return;
    }
    if (avDeviceCount > bomBaseline.current) {
      setBomCollapsed(false);
      bomBaseline.current = avDeviceCount;
    }
  }, [avDeviceCount, rdLoaded]);

  // Modal: search the org's own Equipment Library first (same convention as
  // Signal Flow Builder), with the global AVGenix Library as an explicit
  // fallback — org library items never carry Room Designer's rd_type/rd_wall/
  // rd_icon placement metadata (only av_products has been enriched with
  // those), so addFromModal's category/name-based inference below is what
  // places them; it already exists for exactly this "not yet enriched" case.
  useEffect(() => {
    if (!modalSearch.trim()) { setModalResults([]); return; }
    if (modalGlobalSearch) {
      setModalLoading(true);
      const timer = setTimeout(async () => {
        try {
          const dbData = await searchProducts(modalSearch).catch(() => []);
          setModalResults(dbData.map(productToModalResult));
        } finally { setModalLoading(false); }
      }, 300);
      return () => clearTimeout(timer);
    }
    if (!activeOrg) { setModalResults([]); return; }
    setModalLoading(true);
    const timer = setTimeout(async () => {
      try {
        const orgData = await searchOrgLibrary(modalSearch, activeOrg.id).catch(() => []);
        setModalResults(orgData.map((p: any) => ({
          ...p,
          type: p.description || p.model, mfr: p.manufacturer, model: p.model, model_name: p.model, price: p.unit_cost,
          color: p.color || "#64748b", cat: p.category,
          hfov_deg: p.hfov_deg, coverage_pattern: p.coverage_pattern,
          coverage_diameter_ft: p.coverage_diameter_ft, coverage_angle_deg: p.coverage_angle_deg,
          coverage_width_ft: p.coverage_width_ft, coverage_depth_ft: p.coverage_depth_ft,
        })));
      } finally { setModalLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [modalSearch, modalGlobalSearch, activeOrg?.id]);

  const closeModal = () => {
    setShowAddModal(false); setModalSearch(""); setModalSelected(null);
    setModalDeviceName(""); setModalMake(""); setModalModel(""); setModalGlobalSearch(false);
    setReplacingDeviceUid(null);
  };

  // Swap a different piece of equipment onto an EXISTING device — same
  // field-resolution as addFromModal (rd_type-enriched product vs a
  // category-name-inferred fallback), but applied as an update that keeps
  // the device's uid/x/y/z/mountWall/rotation instead of creating a new one.
  const replaceSingleDevice = (uid: number, sel: any) => {
    const name = sel ? sel.type : modalDeviceName.trim();
    let devType: string, wall: string, icon: string, color: string, w: number, h: number;

    if (sel?.rd_type) {
      devType = sel.rd_type;
      wall    = sel.rd_wall    || "floor";
      icon    = sel.rd_icon    || "📦";
      w       = sel.rd_width_ft  || 0.5;
      h       = sel.rd_height_ft || 0.5;
      color   = sel.color      || "#64748b";
    } else {
      const cat      = (sel?.cat || "").toLowerCase();
      const typeName = name.toLowerCase();
      devType = "custom"; wall = "floor"; icon = "📦"; color = sel?.color || "#64748b"; w = 0.5; h = 0.5;
      if (cat.includes("display") || typeName.includes("display") || typeName.includes("monitor") || typeName.includes(" tv") || typeName.includes("screen")) {
        devType = "display"; wall = "front"; icon = "monitor"; color = "#8b5cf6"; w = 4.0; h = 2.26;
      } else if (cat.includes("projector") || typeName.includes("projector")) {
        devType = "display"; wall = "ceiling"; icon = "📽️"; color = "#8b5cf6"; w = 0.8; h = 0.5;
      } else if (cat.includes("camera") || typeName.includes("camera") || typeName.includes(" cam")) {
        devType = "camera"; wall = "front"; icon = "confbar"; color = "#22c55e"; w = 0.5; h = 0.3;
      } else if (cat.includes("microphone") || cat.includes(" mic") || typeName.includes("mic") || typeName.includes("microphone")) {
        devType = "mic"; wall = "ceiling"; icon = "🎙"; color = "#f59e0b"; w = 0.25; h = 0.25;
      } else if (cat.includes("speaker") || typeName.includes("speaker")) {
        devType = "speaker"; wall = "ceiling"; icon = "🔊"; color = "#ef4444"; w = 0.3; h = 0.3;
      }
    }
    pushUndo();
    setPlacedDevices(prev => prev.map(d => d.uid === uid ? {
      ...d,
      name, icon, w, h, wall, type: devType, color,
      hfov: sel?.hfov_deg ?? undefined,
      covShape: sel?.coverage_pattern === "circular" ? "round" : sel?.coverage_pattern === "rectangular" ? "square" : undefined,
      covDiameter: sel?.coverage_diameter_ft ?? undefined,
      dispersion: sel?.coverage_angle_deg ?? undefined,
      covW: sel?.coverage_width_ft ?? undefined,
      covL: sel?.coverage_depth_ft ?? undefined,
      // The unit keeps its own itemId (it's still the same slot in the design and
      // in the other tools); it takes on the new product's make, model and spec.
      ...libraryPickFields(sel),
    } : d));
    // Same for a swap: the other tools' copy of this unit becomes the new product too.
    const swapped = placedDevices.find(d => d.uid === uid);
    if (swapped?.itemId) {
      const updated: any = { ...swapped, name, ...libraryPickFields(sel) };
      const changes = diffSpec(specFromRoomDevice(swapped), specFromRoomDevice(updated));
      if (Object.keys(changes).length) updateUnitSpec(swapped.itemId, changes);
    }
  };

  const replaceDeviceFromModal = async () => {
    if (replacingDeviceUid == null) return;
    const sel = modalSelected;
    if (sel?.kit_items && sel.kit_items.length > 0) {
      const placeable = await resolvePlaceableKitComponents(sel);
      if (placeable.length === 0) {
        setGenerateNotice({ kind: "error", message: "This kit has no room-placeable part — nothing was replaced." });
        window.setTimeout(() => setGenerateNotice(null), 5000);
      } else {
        replaceSingleDevice(replacingDeviceUid, placeable[0]);
        placeable.slice(1).forEach(placeDeviceFromPick);
      }
      closeModal();
      return;
    }
    replaceSingleDevice(replacingDeviceUid, sel);
    closeModal();
  };

  const exportAsPDF = () => {
    const pageKeys = ["plan", "ceil"];
    // Expand every section (so it actually appears in the PDF) and zoom-extend
    // each canvas to fill its page, remembering what was collapsed so we can
    // restore the user's on-screen layout once the print dialog closes.
    const wasCollapsed = new Set(collapsedCanvases);
    if (pageKeys.some(k => wasCollapsed.has(k))) setCollapsedCanvases(new Set());
    // Extra margin (vs. the 1.08 used for the interactive double-middle-click
    // fit) so labels drawn outside the room rect — "Front Wall", the width/
    // length dimension text — have room to breathe instead of being clipped
    // against the fixed-height print page.
    pageKeys.forEach(k => zoomExtents(k, 1.35));

    // Collapse the on-screen flex chrome (left sidebar, toolbar, BOM panel,
    // etc.) out of the layout and free every ancestor's height/overflow so
    // the full, un-scrolled canvas content lays out in normal flow and can
    // paginate correctly. `position:fixed` was tried here before, but a
    // fixed box taller than one page prints duplicated/clipped content in
    // Chrome — plain flow + explicit page breaks is what actually works.
    const exportEl = document.getElementById('rd-canvas-export');
    const restores: { el: HTMLElement; prop: string; value: string }[] = [];
    const setStyle = (el: HTMLElement, prop: string, value: string) => {
      restores.push({ el, prop, value: (el.style as any)[prop] });
      (el.style as any)[prop] = value;
    };
    let node: HTMLElement | null = exportEl;
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (parent) {
        Array.from(parent.children).forEach(sib => {
          if (sib !== node && sib instanceof HTMLElement) setStyle(sib, 'display', 'none');
        });
      }
      setStyle(node, 'overflow', 'visible');
      setStyle(node, 'overflowY', 'visible');
      setStyle(node, 'height', 'auto');
      setStyle(node, 'maxHeight', 'none');
      setStyle(node, 'position', 'static');
      node = parent;
    }

    const style = document.createElement('style');
    style.id = '__rd_print_style__';
    style.textContent = `
      @media print {
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        #rd-canvas-export { background: #fff !important; padding: 8mm !important; box-sizing: border-box !important; }
        #rd-canvas-export button, #rd-canvas-export .rd-print-hide { display: none !important; }
        #rd-print-title-elev { break-before: page !important; }
        #rd-print-page-plan, #rd-print-page-elev {
          height: 178mm !important; min-height: 0 !important; max-height: 178mm !important; break-inside: avoid !important;
        }
        /* Chrome only reserves (and prints) the date/URL/page-number header+footer
           band when the print job has a margin; a zero @page margin removes it —
           the 8mm breathing room is recreated above as padding on the container. */
        @page { size: 11in 8.5in; margin: 0; }
      }
    `;
    document.head.appendChild(style);
    const prev = document.title;
    document.title = 'Room Design';
    // Wait for React to flush the expand/zoom-extend state and for layout to
    // settle before invoking print, then restore the prior DOM/collapse state.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          window.print();
          document.head.removeChild(style);
          document.title = prev;
          restores.forEach(({ el, prop, value }) => { (el.style as any)[prop] = value; });
          if (wasCollapsed.size) setCollapsedCanvases(wasCollapsed);
        }, 150);
      });
    });
  };

  // DXF export — a real CAD floor plan (room outline, device footprints,
  // coverage circles/rectangles, camera FOV cones), in feet, so it opens at
  // true scale in AutoCAD. Ceiling-mounted devices are placed at their plan
  // (x,y) but their coverage circle/FOV cone geometry is plan-view-only, same
  // as the on-screen floor plan — this does not attempt to export the
  // separate ceiling/wall-speaker/wall-mic elevation views.
  const exportDXF = () => {
    const dxf = new DxfWriter();
    // This floor plan's y increases going south (screen/SVG-down
    // convention — confirmed by pY()'s plain, uninverted y*planScale), but
    // DXF/AutoCAD's y increases upward, so writing raw y values renders the
    // plan upside down (north wall would end up at the bottom, labels above
    // devices instead of below — the exact bug reported for Signal Flow's
    // DXF). This thin wrapper flips y at the point of writing, so all the
    // geometry math above stays in its natural, easier-to-verify space.
    const flip = {
      rect: (x: number, y: number, w: number, h: number, layer?: string) => dxf.rect(x, -(y + h), w, h, layer),
      circle: (cx: number, cy: number, r: number, layer?: string) => dxf.circle(cx, -cy, r, layer),
      line: (x1: number, y1: number, x2: number, y2: number, layer?: string) => dxf.line(x1, -y1, x2, -y2, layer),
      text: (x: number, y: number, h: number, value: string, layer?: string, align?: "left" | "center" | "right") => dxf.text(x, -y, h, value, layer, align),
    };

    const drawnWallItems = placedDevices.filter(d => d.id === "wall-partition" && d.wallAngle !== undefined);
    if (isCustomBlank && drawnWallItems.length > 0) {
      drawnWallItems.forEach(w => {
        const halfX = Math.cos(w.wallAngle!) * w.w / 2;
        const halfY = Math.sin(w.wallAngle!) * w.w / 2;
        flip.line(w.x - halfX, w.y - halfY, w.x + halfX, w.y + halfY, "ROOM");
      });
    } else {
      flip.rect(0, 0, roomW, roomL, "ROOM");
    }

    // Clip a ray from (ox,oy) toward (ex,ey) to the room rectangle — same
    // logic as the on-screen FOV cone rendering, just in feet instead of
    // screen pixels (no pX/pY conversion, no arbitrary reach cap needed).
    const clipToRoom = (ox: number, oy: number, ex: number, ey: number) => {
      let t = 1;
      const dx = ex - ox, dy = ey - oy;
      if (dx !== 0) t = Math.min(t, dx > 0 ? (roomW - ox) / dx : (0 - ox) / dx);
      if (dy !== 0) t = Math.min(t, dy > 0 ? (roomL - oy) / dy : (0 - oy) / dy);
      t = Math.max(0, t);
      return { x: ox + dx * t, y: oy + dy * t };
    };

    placedDevices.filter(d => !(d.id === "wall-partition" && d.wallAngle !== undefined)).forEach(dev => {
      const layer = (dev.type || "device").toUpperCase();
      flip.rect(dev.x - dev.w / 2, dev.y - dev.h / 2, dev.w, dev.h, layer);

      // Call-out leader (matches the on-screen plan view: a short straight
      // stub off the text, then an angled run back to the equipment) rather
      // than the old plain name glued just above the box — this is the same
      // user-adjustable position (calloutDx/calloutDy), so a manually
      // decluttered arrangement on screen exports looking the same way.
      {
        const def = defaultCalloutOffset(dev);
        const dxFt = dev.calloutDx ?? def.dx, dyFt = dev.calloutDy ?? def.dy;
        const labelPt = { x: dev.x + dxFt, y: dev.y + dyFt };
        const side = dxFt >= 0 ? 1 : -1;
        const stubFt = 0.6;
        const elbow = { x: labelPt.x - side * stubFt, y: labelPt.y };
        flip.line(dev.x, dev.y, elbow.x, elbow.y, layer);
        flip.line(elbow.x, elbow.y, labelPt.x, labelPt.y, layer);
        flip.text(labelPt.x + side * 0.05, labelPt.y - 0.15, 0.35, calloutLabel(dev), layer, side > 0 ? "left" : "right");
      }

      if (dev.covShape === "round" && dev.covDiameter) {
        flip.circle(dev.x, dev.y, dev.covDiameter / 2, "COVERAGE");
      } else if (dev.covShape === "square" && dev.covW && dev.covL) {
        flip.rect(dev.x - dev.covW / 2, dev.y - dev.covL / 2, dev.covW, dev.covL, "COVERAGE");
      }

      if (dev.type === "camera" && dev.wall !== "ceiling" && dev.mountWall !== "ceiling") {
        const mw = dev.mountWall || "north";
        const hfovDeg = dev.hfov || 70;
        const halfAngle = (hfovDeg / 2) * Math.PI / 180;
        let cx = dev.x, cy = dev.y, reach = 0, spread = 0;
        if (mw === "north") { cx = dev.x; cy = 0; reach = roomL; spread = reach * Math.tan(halfAngle); }
        else if (mw === "south") { cx = dev.x; cy = roomL; reach = roomL; spread = reach * Math.tan(halfAngle); }
        else if (mw === "west") { cx = 0; cy = dev.y; reach = roomW; spread = reach * Math.tan(halfAngle); }
        else { cx = roomW; cy = dev.y; reach = roomW; spread = reach * Math.tan(halfAngle); }
        let p1: { x: number; y: number }, p2: { x: number; y: number };
        if (mw === "north") { p1 = clipToRoom(cx, cy, cx - spread, cy + reach); p2 = clipToRoom(cx, cy, cx + spread, cy + reach); }
        else if (mw === "south") { p1 = clipToRoom(cx, cy, cx - spread, cy - reach); p2 = clipToRoom(cx, cy, cx + spread, cy - reach); }
        else if (mw === "west") { p1 = clipToRoom(cx, cy, cx + reach, cy - spread); p2 = clipToRoom(cx, cy, cx + reach, cy + spread); }
        else { p1 = clipToRoom(cx, cy, cx - reach, cy - spread); p2 = clipToRoom(cx, cy, cx - reach, cy + spread); }
        flip.line(cx, cy, p1.x, p1.y, "FOV");
        flip.line(cx, cy, p2.x, p2.y, "FOV");
      }
    });

    // Elevation Marker views — each drawn as its own sheet offset to the
    // right of the plan (real-world feet scale, same as everything else in
    // this export) so it doesn't collide with the plan geometry above.
    // DXF is already y-up/floor-at-0 like this projection, so these use
    // dxf.rect/text directly instead of the plan's y-flipping `flip` wrapper.
    let elevSheetX = roomW + 15;
    elevationMarkers.forEach(marker => {
      marker.directions.forEach(dirKey => {
        const data = computeElevation(marker, ELEVATION_DIR_ANGLES[dirKey]);
        const ox = elevSheetX;
        dxf.rect(ox, 0, data.wallWidthFt, data.roomHFt, "ELEVATION");
        dxf.text(ox + data.wallWidthFt / 2, data.roomHFt + 1, 0.6, `Elevation ${marker.label}${elevationDirNumber(marker, dirKey)} - ${ELEVATION_DIR_LABELS[dirKey]}`, "ELEVATION", "center");
        data.items.forEach(it => {
          const layer = (it.dev.type || "device").toUpperCase();
          const x0 = ox + it.u - it.wFt / 2;
          dxf.rect(x0, it.boxBot, it.wFt, Math.max(0.05, it.boxTop - it.boxBot), layer);
          dxf.text(x0 + it.wFt / 2, it.boxTop + 0.15, 0.3, calloutLabel(it.dev), layer, "center");
          // Bottom-of-equipment-to-FFL dimension, mirroring the on-screen Elevations pane.
          if (it.boxBot > 0.05) {
            const dimX = x0 + 0.3;
            dxf.line(dimX, 0, dimX, it.boxBot, "DIMENSIONS");
            dxf.text(dimX + 0.15, it.boxBot / 2, 0.25, toFtIn(it.boxBot), "DIMENSIONS", "left");
          }
        });
        elevSheetX += data.wallWidthFt + 10;
      });
    });

    downloadDxf(dxf, `Room Designer${roomParam && roomParam !== "default" ? " - " + roomParam : ""}`);
  };

  // Identity and spec for the unit being added / swapped in: a library pick
  // carries the product's own maker, model, price, ports and specs (this used
  // to stop at the geometry fields, so a unit reached the BOM with no
  // manufacturer, price or part number, and — because rack_units never came
  // across — could never be recognised as rack equipment at all). "Create
  // new" carries whatever Make / Model were typed instead.
  const libraryPickFields = (sel: any) => sel ? {
    productId: sel.id ?? null,
    productKey: sel.id ? `p:${sel.id}` : undefined,
    mfr: sel.manufacturer ?? undefined,
    model: sel.model_name ?? undefined,
    price: sel.price ?? undefined,
    part_number: sel.part_number ?? null,
    cat: sel.category ?? sel.type ?? undefined,
    msrp: sel.msrp ?? null, cost: sel.cost ?? null,
    margin: sel.margin ?? null, markup: sel.markup ?? null,
    ports: sel.ports ?? undefined,
    amp_draw: sel.amp_draw ?? null, voltage: sel.voltage ?? null,
    power_watts: sel.power_watts ?? null, btu_hr: sel.btu_hr ?? null,
    rackMounted: sel.rack_mounted ?? undefined,
    rack_units: sel.rack_units ?? null,
    rack_ear_included: sel.rack_ear_included ?? undefined,
    width_in: sel.width_in ?? null, height_in: sel.height_in ?? null,
    depth_in: sel.depth_in ?? null, diameter_in: sel.diameter_in ?? null, weight_lb: sel.weight_lb ?? null,
  } : {
    productId: null, productKey: undefined,
    mfr: modalMake.trim() || undefined, model: modalModel.trim() || undefined,
  };

  const placeDeviceFromPick = (sel: any) => {
    const name = sel ? sel.type : modalDeviceName.trim();
    let devType: string, wall: string, icon: string, color: string, w: number, h: number;

    if (sel?.rd_type) {
      // Product has been enriched with Room Designer properties in the database — use them directly
      devType = sel.rd_type;
      wall    = sel.rd_wall    || "floor";
      icon    = sel.rd_icon    || "📦";
      w       = sel.rd_width_ft  || 0.5;
      h       = sel.rd_height_ft || 0.5;
      color   = sel.color      || "#64748b";
    } else {
      // Fallback: infer placement from category / type name for products without RD fields
      const cat      = (sel?.cat || "").toLowerCase();
      const typeName = name.toLowerCase();
      devType = "custom"; wall = "floor"; icon = "📦"; color = sel?.color || "#64748b"; w = 0.5; h = 0.5;
      if (cat.includes("display") || typeName.includes("display") || typeName.includes("monitor") || typeName.includes(" tv") || typeName.includes("screen")) {
        devType = "display"; wall = "front"; icon = "monitor"; color = "#8b5cf6"; w = 4.0; h = 2.26;
      } else if (cat.includes("projector") || typeName.includes("projector")) {
        devType = "display"; wall = "ceiling"; icon = "📽️"; color = "#8b5cf6"; w = 0.8; h = 0.5;
      } else if (cat.includes("camera") || typeName.includes("camera") || typeName.includes(" cam")) {
        devType = "camera"; wall = "front"; icon = "confbar"; color = "#22c55e"; w = 0.5; h = 0.3;
      } else if (cat.includes("microphone") || cat.includes(" mic") || typeName.includes("mic") || typeName.includes("microphone")) {
        devType = "mic"; wall = "ceiling"; icon = "🎙"; color = "#f59e0b"; w = 0.25; h = 0.25;
      } else if (cat.includes("speaker") || typeName.includes("speaker")) {
        devType = "speaker"; wall = "ceiling"; icon = "🔊"; color = "#ef4444"; w = 0.3; h = 0.3;
      }
    }
    addDeviceToRoom({
      id: `modal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, icon, w, h, wall, type: devType, color,
      hfovDeg: sel?.hfov_deg ?? null,
      coveragePattern: sel?.coverage_pattern ?? null,
      coverageDiameterFt: sel?.coverage_diameter_ft ?? null,
      coverageAngleDeg: sel?.coverage_angle_deg ?? null,
      coverageWidthFt: sel?.coverage_width_ft ?? null,
      coverageDepthFt: sel?.coverage_depth_ft ?? null,
      ...libraryPickFields(sel),
    });
  };

  // A "Kit" library pick (see AVProduct.kit_items) is a bundle SKU standing
  // in for several separate physical parts — but unlike Signal Flow Builder,
  // not every part of a kit has a sensible spot on a floor plan (a Cat5e
  // cable kit or a USB adapter isn't a "room object"). Only components that
  // carry real room-placement metadata (rd_type) get placed here; resolves
  // by id via getProductsByIds and repeats each by its quantity.
  const resolvePlaceableKitComponents = async (sel: any): Promise<any[]> => {
    if (!sel?.kit_items || sel.kit_items.length === 0) return [sel];
    const componentProducts = await getProductsByIds(sel.kit_items.map((i: any) => i.product_id)).catch(() => []);
    const byId = new Map(componentProducts.map((cp: any) => [cp.id, cp]));
    const placeable: any[] = [];
    for (const item of sel.kit_items) {
      const p = byId.get(item.product_id);
      if (!p || !p.rd_type) continue;
      const mapped = productToModalResult(p);
      for (let n = 0; n < Math.max(1, item.quantity || 1); n++) placeable.push(mapped);
    }
    return placeable;
  };

  const addFromModal = async () => {
    const sel = modalSelected;
    if (sel?.kit_items && sel.kit_items.length > 0) {
      const placeable = await resolvePlaceableKitComponents(sel);
      if (placeable.length === 0) {
        setGenerateNotice({ kind: "error", message: "This kit has no room-placeable part — nothing was added." });
        window.setTimeout(() => setGenerateNotice(null), 5000);
      } else {
        placeable.forEach(placeDeviceFromPick);
      }
      closeModal();
      return;
    }
    placeDeviceFromPick(sel);
    closeModal();
  };

  // Listen for manual save from layout
  React.useEffect(() => {
    const handler = () => {
      saveDesign(placedDevices, {
        roomType, roomW, roomL, roomH, tableShape, tableSeats, tableWidth, tableLengthOverride, tableWallDist, showTable, selectedWall, placedDoors,
        ...tableEditsConfig(),
        annotations: annotate.annotations,
        floorPlanImg, floorPlanWidthFt, floorPlanOffset,
        elevationMarkers,
      });
    };
    window.addEventListener("avgenix-save", handler);
    return () => window.removeEventListener("avgenix-save", handler);
  }, [placedDevices, placedDoors, roomType, roomW, roomL, roomH, tableShape, tableSeats, tableWidth, tableLengthOverride, tableWallDist, showTable, tableDeleted, tableCenterX, tableRotation, chairOffsets, deletedChairs, deletedWalls, hiddenDevices, selectedWall, annotate.annotations, floorPlanImg, floorPlanWidthFt, floorPlanOffset, elevationMarkers, saveDesign]);

  // Load room dimensions from site survey + saved design — re-runs whenever
  // the room or project actually changes (not just on mount), since switching
  // rooms via the sidebar reuses this same component.
  React.useEffect(() => {
    let cancelled = false;
    const roomId = roomParam;
    const projectId = projectParam;
    if (!projectId) return;

    // Gate autosave closed and clear the canvas *before* re-pointing the save
    // refs, so nothing here is ever mistaken for an edit and written over the
    // room we're navigating away from, or over the new room before its real
    // data has loaded.
    setRdLoaded(false);
    setPlacedDevices([]);
    setRoomType("medium"); setRoomW(16.4); setRoomL(19.7); setRoomH(8.86);
    setTableShape("rectangular"); setTableSeats(2); setTableWidth(2.0); setTableWallDist(3.28);
    setShowTable(false); setSelectedWall("north"); setPlacedDoors([]);
    annotate.setAnnotations([]);
    setSelected(new Set()); setSelectedUids(new Set()); setSelectedUid(null); setSelectedEdge(null);
    setUndoStack([]);
    setDeletedWalls(new Set()); setDeletedChairs(new Set()); setTableDeleted(false); setDoorDeleted(false);
    setChairOffsets({}); setTableCenterX(null); setTableRotation(0); setTableLengthOverride(2.0);
    setHiddenDevices([]); setDeleteConfirm(null);
    setFloorPlanImg(null); setFloorPlanWidthFt(16); setFloorPlanOffset({x:0,y:0}); setIsScalingFloorPlan(false); setScaleRefPoints([]); setScaleRefLength(""); setScaleRefInches("");
    setElevationMarkers([]); setSelectedElevationId(null); setActiveElevationKey(null);

    currentProjectId.current = projectId;
    currentRoomId.current = roomId || "default";

    supabase.from("site_surveys").select("data").eq("project_id", projectId).single()
          .then(({ data: surveyRow }) => {
            if (cancelled) return;
            try {
              const survey = surveyRow?.data as { buildings?: { name?: string; rooms?: { id: string; name?: string; data?: Record<string, string> }[] }[] } | null;
              const building = survey?.buildings?.[0];
              if (!building || !building.rooms?.length) return;

              // Build survey rooms list for picker
              const parsed = building.rooms.map(r => ({
                id: r.id,
                name: r.name || r.id,
                width: parseFloat(r.data?.room_width || "0"),
                length: parseFloat(r.data?.room_length || "0"),
                height: parseFloat(r.data?.room_height || "0"),
              })).filter(r => r.width > 0 || r.length > 0);
              setSurveyRooms(parsed);

              const room = roomId
                ? building.rooms.find((r) => r.id === roomId) || building.rooms[0]
                : building.rooms[0];
              const widthFt = parseFloat(room.data?.room_width || "0");
              const lengthFt = parseFloat(room.data?.room_length || "0");
              const heightFt = parseFloat(room.data?.room_height || "0");
              const hasData = widthFt > 0 || lengthFt > 0 || heightFt > 0;
              if (widthFt > 0) setRoomW(widthFt);
              if (lengthFt > 0) setRoomL(lengthFt);
              if (heightFt > 0) setRoomH(heightFt);
              if (hasData) {
                // Don't auto-select mode — let user choose
              }
            } catch {}
          });

    // Load saved room design
    supabase.from("room_designs").select("data")
      .eq("project_id", projectId).eq("room_id", roomId || "default").single()
      .then(({ data: designRow }) => {
        if (cancelled) return;
        setRdLoaded(true);
        if (!designRow?.data) return;
        const saved = designRow.data as { devices?: PlacedDevice[]; config?: Record<string, unknown> };
        if (saved.devices?.length) setPlacedDevices(ensureRoomDeviceItemIds(saved.devices).items);
        if (saved.config) {
          if (saved.config.roomType) setRoomType(saved.config.roomType as string);
          if (saved.config.roomW) setRoomW(saved.config.roomW as number);
          if (saved.config.roomL) setRoomL(saved.config.roomL as number);
          if (saved.config.roomH) setRoomH(saved.config.roomH as number);
          if (saved.config.tableShape) setTableShape(saved.config.tableShape as string);
          if (saved.config.tableSeats) setTableSeats(saved.config.tableSeats as number);
          if (saved.config.tableWidth) setTableWidth(saved.config.tableWidth as number);
          if (saved.config.tableLengthOverride !== undefined) setTableLengthOverride(saved.config.tableLengthOverride as number | null);
          if (saved.config.tableWallDist) setTableWallDist(saved.config.tableWallDist as number);
          if (saved.config.showTable !== undefined) setShowTable(saved.config.showTable as boolean);
          if (saved.config.tableDeleted !== undefined) setTableDeleted(saved.config.tableDeleted as boolean);
          if (saved.config.tableCenterX !== undefined) setTableCenterX(saved.config.tableCenterX as number | null);
          if (saved.config.tableRotation) setTableRotation(saved.config.tableRotation as number);
          if (saved.config.chairOffsets) setChairOffsets(saved.config.chairOffsets as Record<number, { dx: number; dy: number }>);
          if (Array.isArray(saved.config.deletedChairs)) setDeletedChairs(new Set(saved.config.deletedChairs as number[]));
          if (Array.isArray(saved.config.deletedWalls)) setDeletedWalls(new Set(saved.config.deletedWalls as string[]));
          if (Array.isArray(saved.config.hiddenDevices)) setHiddenDevices(ensureRoomDeviceItemIds(saved.config.hiddenDevices as PlacedDevice[]).items);
          if (saved.config.selectedWall) setSelectedWall(saved.config.selectedWall as string);
          if (saved.config.placedDoors) setPlacedDoors(saved.config.placedDoors as PlacedDoor[]);
          if (saved.config.annotations) annotate.setAnnotations(saved.config.annotations as any[]);
          if (saved.config.floorPlanImg) setFloorPlanImg(saved.config.floorPlanImg as string);
          if (saved.config.floorPlanWidthFt) setFloorPlanWidthFt(saved.config.floorPlanWidthFt as number);
          if (saved.config.floorPlanOffset) setFloorPlanOffset(saved.config.floorPlanOffset as {x:number;y:number});
          if (saved.config.elevationMarkers) {
            // Backward-compat across two earlier shapes of this field: the
            // original design used a single continuous `angle`; a later
            // revision used an unordered {n,e,s,w} boolean map before this
            // one switched to an ORDERED array (so a flag's position in the
            // array — not a fixed compass slot — gives it its view number).
            type LegacyMarker = { id: number; x: number; y: number; label: string; angle?: number; directions?: ElevationDirKey[] | Record<ElevationDirKey, boolean> };
            const rawMarkers = saved.config.elevationMarkers as LegacyMarker[];
            setElevationMarkers(rawMarkers.map(m => {
              let directions: ElevationDirKey[];
              if (Array.isArray(m.directions)) {
                directions = m.directions;
              } else if (m.directions) {
                directions = ELEVATION_DIR_KEYS.filter(k => (m.directions as Record<ElevationDirKey, boolean>)[k]);
              } else {
                const nearest = ELEVATION_DIR_KEYS.reduce((best, k) =>
                  Math.abs(((m.angle||0) - ELEVATION_DIR_ANGLES[k] + 540) % 360 - 180) < Math.abs(((m.angle||0) - ELEVATION_DIR_ANGLES[best] + 540) % 360 - 180) ? k : best, "n" as ElevationDirKey);
                directions = [nearest];
              }
              return { id: m.id, x: m.x, y: m.y, label: m.label, directions };
            }));
          }
          setStep(2);
        }
      });
    return () => { cancelled = true; };
  }, [roomParam, projectParam]);

  const toFtIn = (feet: number) => {
    const totalQ = Math.round(feet * 12 * 4); // quarters of an inch
    const f = Math.floor(totalQ / 48);
    const remQ = totalQ % 48;
    const wholeIn = Math.floor(remQ / 4);
    const q = remQ % 4;
    const frac = q === 0 ? "" : q === 1 ? "¼" : q === 2 ? "½" : "¾";
    return `${f}′ ${wholeIn}${frac}″`;
  };
  const toDisplay = (feet: number) => toFtIn(feet);
  const toEditableLength = (feet: number) => {
    const totalQ = Math.round(feet * 12 * 4);
    const wholeFeet = Math.floor(totalQ / 48);
    const remainingQ = totalQ % 48;
    const wholeInches = Math.floor(remainingQ / 4);
    const quarter = remainingQ % 4;
    const fraction = quarter === 0 ? "" : quarter === 1 ? " 1/4" : quarter === 2 ? " 1/2" : " 3/4";
    return `${wholeFeet}' ${wholeInches}${fraction}"`;
  };

  const parseFtIn = (str: string): number | null => {
    const s = str.trim().replace(/'\s*-\s*/g, "' ");
    if (!s) return null;
    const inToFt = 1/12;
    let m;
    // 15' 1 1/2"  or  15'-1 1/2"
    m = s.match(/^(\d+)'\s*(\d+)\s+(\d+)\/(\d+)"?$/);
    if (m) return +m[1] + (+m[2] + +m[3] / +m[4])*inToFt;
    // 15' 1/2"
    m = s.match(/^(\d+)'\s*(\d+)\/(\d+)"?$/);
    if (m) return +m[1] + (+m[2] / +m[3])*inToFt;
    // 12'6"  or  12' 6
    m = s.match(/^(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)"?$/);
    if (m) return +m[1] + +m[2]*inToFt;
    // 10'  or plain number (treated as feet)
    m = s.match(/^(\d+(?:\.\d+)?)'?$/);
    if (m) return +m[1];
    // 6"
    m = s.match(/^(\d+(?:\.\d+)?)"$/);
    if (m) return +m[1]*inToFt;
    return null;
  };
  const QUARTER_IN_FT = 1/48;
  const snapToGrid = (pos: {x:number;y:number}) => ({
    x: Math.round(pos.x / QUARTER_IN_FT) * QUARTER_IN_FT,
    y: Math.round(pos.y / QUARTER_IN_FT) * QUARTER_IN_FT,
  });

  const isCustomBlank = roomSizeMode === "custom";

  // Compute oriented dimensions of drawn walls for custom rooms
  const drawnWalls = placedDevices.filter(d => d.id === "wall-partition" && d.wallAngle !== undefined);
  const drawnBounds = (() => {
    if (drawnWalls.length === 0) return null;
    // Collect all wall endpoints
    const pts: {x:number;y:number}[] = [];
    drawnWalls.forEach(dev => {
      const angle = dev.wallAngle!;
      const len = dev.w;
      pts.push(
        { x: dev.x - Math.cos(angle) * len / 2, y: dev.y - Math.sin(angle) * len / 2 },
        { x: dev.x + Math.cos(angle) * len / 2, y: dev.y + Math.sin(angle) * len / 2 },
      );
    });
    // Find the longest wall to determine primary direction
    let longestLen = 0, primaryAngle = 0;
    drawnWalls.forEach(dev => {
      if (dev.w > longestLen) { longestLen = dev.w; primaryAngle = dev.wallAngle!; }
    });
    // Primary axis unit vector and perpendicular
    const ax = Math.cos(primaryAngle), ay = Math.sin(primaryAngle);
    const px = -ay, py = ax; // perpendicular
    // Project all points onto primary and perpendicular axes
    let minA = Infinity, maxA = -Infinity, minP = Infinity, maxP = -Infinity;
    pts.forEach(pt => {
      const projA = pt.x * ax + pt.y * ay;
      const projP = pt.x * px + pt.y * py;
      minA = Math.min(minA, projA); maxA = Math.max(maxA, projA);
      minP = Math.min(minP, projP); maxP = Math.max(maxP, projP);
    });
    const width = maxA - minA;  // along primary wall direction
    const depth = maxP - minP;  // perpendicular to primary wall
    // Center of the bounding region in world coords
    const centerA = (minA + maxA) / 2, centerP = (minP + maxP) / 2;
    const centerX = centerA * ax + centerP * px;
    const centerY = centerA * ay + centerP * py;
    // Corner points of the oriented bounding box (for rendering)
    const corners = [
      { x: minA * ax + minP * px, y: minA * ay + minP * py },
      { x: maxA * ax + minP * px, y: maxA * ay + minP * py },
      { x: maxA * ax + maxP * px, y: maxA * ay + maxP * py },
      { x: minA * ax + maxP * px, y: minA * ay + maxP * py },
    ];
    // Axis-aligned bbox too (for fallback)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(pt => { minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y); maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y); });
    return { width, depth, primaryAngle, ax, ay, px, py, minA, maxA, minP, maxP, corners, centerX, centerY, minX, minY, maxX, maxY };
  })();
  // Effective room dimensions (use drawn bounds in custom mode if available)
  const effectiveRoomW = isCustomBlank && drawnBounds ? drawnBounds.width : roomW;
  const effectiveRoomL = isCustomBlank && drawnBounds ? drawnBounds.depth : roomL;

  // Drag clamp bounds — in custom wall mode use the drawn walls' axis-aligned
  // extents (+ padding). CANVAS_PAD gives real working room beyond the walls
  // themselves (a 1ft pad used to leave devices with nowhere to go once
  // dragged away from every wall — stuck against this exact clamp, which
  // read as an invisible boundary — and a standard room had *zero* pad at
  // all, so nothing could be moved even slightly outside its four walls).
  const CANVAS_PAD = 20;
  const cMinX = isCustomBlank ? (drawnBounds ? drawnBounds.minX - CANVAS_PAD : -50) : -CANVAS_PAD;
  const cMaxX = isCustomBlank ? (drawnBounds ? drawnBounds.maxX + CANVAS_PAD : 50)  : roomW + CANVAS_PAD;
  const cMinY = isCustomBlank ? (drawnBounds ? drawnBounds.minY - CANVAS_PAD : -50) : -CANVAS_PAD;
  const cMaxY = isCustomBlank ? (drawnBounds ? drawnBounds.maxY + CANVAS_PAD : 50)  : roomL + CANVAS_PAD;

  const scale = Math.min(1, 20 / Math.max(roomW, roomL));
  const sX = (x: number, y: number, _z?: number) => 300 + (x - y) * 32 * scale;
  const sY = (x: number, y: number, z: number) =>
    (140 + Math.max(0, 20 - Math.max(roomW, roomL)) * 2.44) + (x + y) * 18 * scale - z * 38 * scale;

  const planScale = Math.min(380 / roomW, 270 / roomL);
  const planOffX = (600 - roomW * planScale) / 2;
  const planOffY = (420 - roomL * planScale) / 2;
  const pX = (x: number) => planOffX + x * planScale;
  const pY = (y: number) => planOffY + y * planScale;

  // Automatic equipment call-outs (plan view only) — a professional-drawing
  // style label (make/model) connected to its device by a leader line,
  // instead of the plain caption that used to sit glued to each icon.
  // Position is stored as a feet offset from the device (so it translates
  // along with the device if it's later moved) and only gets written once
  // the user actually drags a callout — until then, this computes a
  // reasonable default direction so callouts on a full room don't all pile
  // up in the middle pointing the same way.
  //
  // For wall-mounted equipment (a display/camera/mic/etc. on north/south/
  // east/west), the default points *into* the room — away from the wall,
  // not out through it — since that's where the open floor space actually
  // is; pointing outward instead would send a north-wall device's call-out
  // up past the top of the canvas, e.g. right under the floating toolbar
  // row above it. Anything else (ceiling/floor/table-mounted) falls back to
  // fanning outward from the room's center, which has no such wall to key
  // off but still spreads callouts apart reasonably.
  const CALLOUT_DEFAULT_DIST = 2.5;
  const defaultCalloutOffset = (dev: PlacedDevice) => {
    const wallDir: Record<string, {dx:number;dy:number}> = {
      north: { dx: 0, dy: 1 }, south: { dx: 0, dy: -1 }, west: { dx: 1, dy: 0 }, east: { dx: -1, dy: 0 },
    };
    const dir = wallDir[dev.mountWall];
    if (dir) return { dx: dir.dx * CALLOUT_DEFAULT_DIST, dy: dir.dy * CALLOUT_DEFAULT_DIST };
    const cx = roomW / 2, cy = roomL / 2;
    let vx = dev.x - cx, vy = dev.y - cy;
    const len = Math.hypot(vx, vy);
    if (len < 0.01) { vx = 1; vy = -1; }
    const norm = Math.hypot(vx, vy) || 1;
    return { dx: (vx / norm) * CALLOUT_DEFAULT_DIST, dy: (vy / norm) * CALLOUT_DEFAULT_DIST };
  };
  // Same "Generic"/"—" placeholder-skipping convention Signal Flow Builder
  // uses for its own device labels — falls back to the device's own name
  // (e.g. '43" Display') when it isn't linked to a real catalog mfr/model.
  const calloutLabel = (dev: PlacedDevice) => {
    const mfr = dev.mfr && dev.mfr !== "Generic" ? dev.mfr : null;
    const model = dev.model && dev.model !== "—" ? dev.model : null;
    return [mfr, model].filter(Boolean).join(" ") || dev.name || "Device";
  };

  // Elevation Marker projection math — shared by the on-screen Elevations
  // pane and the DXF export so both draw exactly the same view. Angle 0°
  // faces the north wall (plan y=0), 90° east, 180° south, 270° west,
  // matching this file's plan-view wall labels; `perp` is the marker's
  // "right hand" while facing that direction, used as the elevation's
  // horizontal (u) axis. Vertical position reuses each device's own `z`
  // (feet AFF) — already computed at placement time for the 3D view — so
  // there's no separate mount-height field to keep in sync.
  const elevationDir = (angleDeg: number) => {
    const a = angleDeg * Math.PI / 180;
    return { x: Math.sin(a), y: -Math.cos(a) };
  };
  const elevationPerp = (angleDeg: number) => {
    const a = angleDeg * Math.PI / 180;
    return { x: Math.cos(a), y: Math.sin(a) };
  };
  const ELEV_EQUIPMENT_TYPES = new Set(["display", "camera", "mic", "speaker", "control"]);
  const computeElevation = (marker: ElevationMarker, angleDeg: number) => {
    const dir = elevationDir(angleDeg);
    const perp = elevationPerp(angleDeg);
    const minX = isCustomBlank && drawnBounds ? drawnBounds.minX : 0;
    const maxX = isCustomBlank && drawnBounds ? drawnBounds.maxX : roomW;
    const minY = isCustomBlank && drawnBounds ? drawnBounds.minY : 0;
    const maxY = isCustomBlank && drawnBounds ? drawnBounds.maxY : roomL;
    const corners = [{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}];
    let uMin = Infinity, uMax = -Infinity;
    corners.forEach(c => {
      const u = (c.x - marker.x) * perp.x + (c.y - marker.y) * perp.y;
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
    });
    const wallWidthFt = Math.max(1, uMax - uMin);
    const items = placedDevices
      .filter(d => ELEV_EQUIPMENT_TYPES.has(d.type))
      .map(d => {
        const rx = d.x - marker.x, ry = d.y - marker.y;
        const depthAlong = rx * dir.x + ry * dir.y;
        const u = rx * perp.x + ry * perp.y - uMin;
        const isCeiling = d.wall === "ceiling" || d.mountWall === "ceiling";
        const hFt = d.h || 0.5;
        // Apparent width along this view's own horizontal axis. A wall-mounted
        // item's real footprint is `w` across the wall by a thin physical
        // depth into the room (a flat-panel display is only a few inches
        // deep) — `d.rotation` (set whenever a device snaps to a wall) is
        // that wall's run direction, so standard oriented-box-onto-axis
        // projection (apparent = w·|cos θ| + depth·|sin θ|, θ = angle between
        // the wall and this view) gives the full width head-on and just the
        // thin depth from a side elevation, instead of always drawing the
        // mounted width as if every view were looking straight at it.
        let wFt = d.w || 0.5;
        if (!isCeiling && typeof d.rotation === "number") {
          const rot = d.rotation * Math.PI / 180;
          const wallPerp = { x: Math.cos(rot), y: Math.sin(rot) };
          const wallNormal = { x: -Math.sin(rot), y: Math.cos(rot) };
          const depthFt = (d.depth_in ?? 4) / 12;
          wFt = Math.max(0.05,
            Math.abs(wFt * (wallPerp.x * perp.x + wallPerp.y * perp.y)) +
            Math.abs(depthFt * (wallNormal.x * perp.x + wallNormal.y * perp.y))
          );
        }
        const centerZ = d.z ?? roomH * 0.55;
        const boxTop = isCeiling ? roomH : centerZ + hFt / 2;
        const boxBot = isCeiling ? roomH - Math.min(hFt, 0.35) : centerZ - hFt / 2;
        return { dev: d, depthAlong, u, wFt, boxTop, boxBot };
      })
      .filter(it => it.depthAlong > -0.75 && it.u > -it.wFt && it.u < wallWidthFt + it.wFt)
      .sort((a, b) => b.depthAlong - a.depthAlong);
    return { wallWidthFt, roomHFt: roomH, items };
  };
  const nextElevationLabel = () => {
    let n = elevationMarkers.length;
    let s = "";
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  };
  const placeElevationMarker = (pos: {x:number;y:number}) => {
    const id = Date.now();
    setElevationMarkers(prev => [...prev, { id, x: pos.x, y: pos.y, label: nextElevationLabel(), directions: ["n"] }]);
    setSelectedElevationId(id);
    setActiveElevationKey(`${id}-n`);
    setPlacingElevationMarker(false);
  };
  const handleElevMarkerMouseMove = (e: React.MouseEvent) => {
    if (!elevMarkerDrag) return;
    const pos = screenToWorld(e);
    if (!pos) return;
    setElevationMarkers(prev => prev.map(m => m.id === elevMarkerDrag.id ? { ...m, x: pos.x, y: pos.y } : m));
  };
  const handleElevMarkerMouseUp = () => setElevMarkerDrag(null);
  const toggleElevationDirection = (id: number, dir: ElevationDirKey) => {
    setElevationMarkers(prev => prev.map(m => {
      if (m.id !== id) return m;
      const has = m.directions.includes(dir);
      return { ...m, directions: has ? m.directions.filter(d => d !== dir) : [...m.directions, dir] };
    }));
  };
  const beginElevItemDrag = (uid: number, perpX: number, perpY: number, e: React.MouseEvent) => {
    if (e.button !== 0 || annotate.activeTool) return;
    const dev = placedDevices.find(d => d.uid === uid);
    const svg = elevSvgRef.current;
    if (!dev || !svg) return;
    e.stopPropagation();
    pushUndo();
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    setElevItemDrag({
      uid, startSvgX: svgP.x, startSvgY: svgP.y,
      origX: dev.x, origY: dev.y, origZ: dev.z ?? roomH * 0.55,
      perpX, perpY,
      isCeiling: dev.wall === "ceiling" || dev.mountWall === "ceiling",
      hFt: dev.h || 0.5,
    });
  };
  const beginElevCalloutDrag = (uid: number, dxFt: number, dyFt: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const svg = elevSvgRef.current;
    if (!svg) return;
    e.stopPropagation();
    pushUndo();
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    setElevCalloutDrag({ uid, startSvgX: svgP.x, startSvgY: svgP.y, origDxFt: dxFt, origDyFt: dyFt });
  };
  const commitElevDimEdit = (closeOnInvalid = false) => {
    if (editingElevDimUid === null) return;
    const value = parseFtIn(elevDimInput);
    if (value === null || value < 0) {
      if (closeOnInvalid) { setEditingElevDimUid(null); setElevDimInput(""); }
      return;
    }
    const uid = editingElevDimUid;
    pushUndo();
    setPlacedDevices(prev => prev.map(d => {
      if (d.uid !== uid) return d;
      const half = (d.h || 0.5) / 2;
      // `value` is the bottom-of-equipment height typed in; z is stored as
      // the device's vertical center, so add back the half-height offset.
      const newZ = Math.max(half, Math.min(roomH - half, value + half));
      return { ...d, z: newZ };
    }));
    setEditingElevDimUid(null);
    setElevDimInput("");
  };

  // Zoom extents: fit the room (or the drawn walls' extents in custom-blank
  // mode) into the 600×420 view of the given canvas. All five canvases fit
  // their content into a ≤380×270 box centered at (300,210), so the room
  // dimensions describe the extents on every canvas.
  const zoomExtents = (key: string, marginFactor = 1.08) => {
    if (lockedViews[key]) return;
    // Elevations already fits its own content (a wall's width × the room's
    // ceiling height) into the 600×420 space on every render via its own
    // eScale — there's no separate "room extents" to compute here the way
    // plan/ceil need, so "zoom extents" for it just means "back to 1:1".
    if (key === "elev") { setElevZoom(1); setElevPan({ x: 0, y: 0 }); return; }
    const margin = marginFactor; // breathing room around the extents (labels like "Front Wall" and the width/length dimensions sit outside the room rect, so PDF export asks for extra margin)
    let w = roomW * planScale, h = roomL * planScale, cx = 300, cy = 210;
    // Custom-drawn rooms live wherever the walls were drawn, not in the
    // nominal room box — every canvas shares the same pX/pY mapping, so fit
    // the drawn extents on all of them.
    if (isCustomBlank && drawnBounds) {
      w = Math.max(1, (drawnBounds.maxX - drawnBounds.minX) * planScale);
      h = Math.max(1, (drawnBounds.maxY - drawnBounds.minY) * planScale);
      cx = pX((drawnBounds.minX + drawnBounds.maxX) / 2);
      cy = pY((drawnBounds.minY + drawnBounds.maxY) / 2);
    }
    const z = Math.min(3, Math.max(0.25, Math.min(600 / (w * margin), 420 / (h * margin))));
    const setZ = key === "plan" ? setZoom : setCeilZoom;
    const setP = key === "plan" ? setPan : setCeilPan;
    setZ(z);
    setP({ x: 300 - cx, y: 210 - cy });
  };
  zoomExtentsRef.current = zoomExtents;

  const handleMarqueeMove = (e: React.MouseEvent) => {
    if (!marquee) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    setMarquee(prev => prev ? { ...prev, curSvgX: svgP.x, curSvgY: svgP.y } : null);
  };

  const handleMarqueeUp = () => {
    if (!marquee) return;
    const dx = Math.abs(marquee.curSvgX - marquee.startSvgX);
    const dy = Math.abs(marquee.curSvgY - marquee.startSvgY);
    if (dx > 4 || dy > 4) {
      // left-to-right = window (fully inside), right-to-left = crossing (intersects)
      const isWindow = marquee.curSvgX >= marquee.startSvgX;
      const mX1 = Math.min(marquee.startSvgX, marquee.curSvgX);
      const mX2 = Math.max(marquee.startSvgX, marquee.curSvgX);
      const mY1 = Math.min(marquee.startSvgY, marquee.curSvgY);
      const mY2 = Math.max(marquee.startSvgY, marquee.curSvgY);
      const hits = new Set<number>();
      placedDevices.forEach(dev => {
        let dX1: number, dY1: number, dX2: number, dY2: number;
        if (dev.id === "wall-partition" && dev.wallAngle !== undefined) {
          const angle = dev.wallAngle;
          const half = dev.w / 2;
          const ex1 = pX(dev.x - Math.cos(angle) * half);
          const ey1 = pY(dev.y - Math.sin(angle) * half);
          const ex2 = pX(dev.x + Math.cos(angle) * half);
          const ey2 = pY(dev.y + Math.sin(angle) * half);
          dX1 = Math.min(ex1, ex2); dY1 = Math.min(ey1, ey2);
          dX2 = Math.max(ex1, ex2); dY2 = Math.max(ey1, ey2);
        } else {
          dX1 = pX(dev.x) - (dev.w * planScale) / 2;
          dY1 = pY(dev.y) - (dev.h * planScale) / 2;
          dX2 = pX(dev.x) + (dev.w * planScale) / 2;
          dY2 = pY(dev.y) + (dev.h * planScale) / 2;
        }
        if (isWindow) {
          if (dX1 >= mX1 && dX2 <= mX2 && dY1 >= mY1 && dY2 <= mY2) hits.add(dev.uid);
        } else {
          if (!(dX2 < mX1 || dX1 > mX2 || dY2 < mY1 || dY1 > mY2)) hits.add(dev.uid);
        }
      });
      annotate.selectInRect(mX1,mY1,mX2,mY2,isWindow);
      // The room's built-in table and chairs aren't placed devices — they carry
      // a data-sel-id and are matched by their on-screen bounds (which already
      // include any rotation / per-chair offset), same window vs crossing rule.
      const builtInHits = new Set<string>();
      const svgEl = svgRef.current;
      const ctm = svgEl?.getScreenCTM();
      if (svgEl && ctm) {
        const a = svgEl.createSVGPoint(); a.x = mX1; a.y = mY1;
        const b = svgEl.createSVGPoint(); b.x = mX2; b.y = mY2;
        const s1 = a.matrixTransform(ctm), s2 = b.matrixTransform(ctm);
        const sx1 = Math.min(s1.x, s2.x), sx2 = Math.max(s1.x, s2.x);
        const sy1 = Math.min(s1.y, s2.y), sy2 = Math.max(s1.y, s2.y);
        svgEl.querySelectorAll("[data-sel-id]").forEach(el => {
          const r = el.getBoundingClientRect();
          const hit = isWindow
            ? r.left >= sx1 && r.right <= sx2 && r.top >= sy1 && r.bottom <= sy2
            : !(r.right < sx1 || r.left > sx2 || r.bottom < sy1 || r.top > sy2);
          if (hit) builtInHits.add(el.getAttribute("data-sel-id")!);
        });
      }
      setSelected(builtInHits);
      setSelectedUids(hits);
      setSelectedUid(null);
      didMarqueeDrag.current = true;
    }
    setMarquee(null);
  };

  const floorPts   = `${sX(0,0,0)},${sY(0,0,0)} ${sX(roomW,0,0)},${sY(roomW,0,0)} ${sX(roomW,roomL,0)},${sY(roomW,roomL,0)} ${sX(0,roomL,0)},${sY(0,roomL,0)}`;
  const backWallPts= `${sX(0,0,0)},${sY(0,0,0)} ${sX(roomW,0,0)},${sY(roomW,0,0)} ${sX(roomW,0,roomH)},${sY(roomW,0,roomH)} ${sX(0,0,roomH)},${sY(0,0,roomH)}`;
  const leftWallPts= `${sX(0,0,0)},${sY(0,0,0)} ${sX(0,roomL,0)},${sY(0,roomL,0)} ${sX(0,roomL,roomH)},${sY(0,roomL,roomH)} ${sX(0,0,roomH)},${sY(0,0,roomH)}`;

  const rt = roomTypes.find(r => r.id === roomType);



  // Unsnapped cursor-following position during a display drag — lets the user
  // pull the display back out of the wall's snap zone
  const freeDragPos = useRef<{x:number;y:number}|null>(null);

  const handleDeviceMouseDown = (e: React.MouseEvent, uid: number) => {
    // Right/middle-click must fall through to the browser's contextmenu
    // event untouched — this handler used to run unconditionally on ANY
    // mousedown, so a right-click also kicked off drag-start bookkeeping
    // (setDragUid/setSelectedUid, etc.) a split second before the
    // contextmenu event fired. That state change was enough to make the
    // subsequent contextmenu event resolve to a different element than the
    // device (no preventDefault there), so the browser's native menu won
    // instead of this app's Edit/Replace/Delete menu.
    if (e.button !== 0) return;
    if (isDrawingWall) return; // Don't drag devices while drawing walls
    if (annotate.activeTool) { annotate.handleDown(e); return; } // Annotation tools draw over devices
    if (dragNewChair?.active || dragNewTable?.active || dragNewDoor?.active) return; // Don't drag while placement tool is active
    e.stopPropagation();
    suppressClickClear.current = false;
    // Ctrl/Cmd+click: toggle this device in the multi-selection instead of starting a drag
    if (e.ctrlKey || e.metaKey) {
      suppressClickClear.current = true;
      setSelectedUids(prev => {
        const next = new Set(prev);
        if (selectedUid !== null) next.add(selectedUid);
        if (next.has(uid)) next.delete(uid); else next.add(uid);
        return next;
      });
      setSelectedUid(null);
      return;
    }
    const dev0 = placedDevices.find(d => d.uid === uid);
    freeDragPos.current = dev0 ? { x: dev0.x, y: dev0.y } : null;
    if (selectedUids.has(uid)) pushUndo(); // grabbing a multi-selected device drags the whole group
    setDragUid(uid); setSelectedUid(uid); setShowHfov(false);
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    setDragStart({ x: svgP.x, y: svgP.y });
  };

  const handleSvgMouseMove = (e: React.MouseEvent) => {
    if (!dragUid || !dragStart) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const dxPx = svgP.x - dragStart.x;
    const dyPx = svgP.y - dragStart.y;
    const dev = placedDevices.find(d => d.uid === dragUid);
    if (!dev) return;
    // Dragging a device that's part of a multi-selection — translate the whole
    // selection together (other devices, plus any selected chairs/table)
    if (viewMode === "plan" && selectedUids.has(dragUid)) {
      suppressClickClear.current = true;
      const dxW = dxPx / planScale, dyW = dyPx / planScale;
      setPlacedDevices(prev => prev.map(d => selectedUids.has(d.uid)
        ? { ...d, x: Math.max(cMinX, Math.min(cMaxX, d.x + dxW)), y: Math.max(cMinY, Math.min(cMaxY, d.y + dyW)) }
        : d));
      if (selected.has("table")) {
        setTableCenterX(prev => (prev ?? roomW / 2) + dxW);
        setTableWallDist(prev => prev + dyW);
      }
      selected.forEach(id => {
        if (id.startsWith("chair:")) {
          const idx = parseInt(id.split(":")[1]);
          setChairOffsets(prev => ({ ...prev, [idx]: { dx: (prev[idx]?.dx ?? 0) + dxW, dy: (prev[idx]?.dy ?? 0) + dyW } }));
        }
      });
      setDragStart({ x: svgP.x, y: svgP.y });
      return;
    }
    if (viewMode === "plan") {
      const dxW = dxPx / planScale, dyW = dyPx / planScale;
      if (dev.id === "wall-partition" && dev.wallAngle !== undefined) {
        // Move the complete wall while allowing either of its endpoints to
        // snap onto any other wall endpoint. Keep a separate unsnapped cursor
        // position so dragging away can break the snap instead of sticking.
        const freePosition = freeDragPos.current ?? { x: dev.x, y: dev.y };
        let newX = freePosition.x + dxW;
        let newY = freePosition.y + dyW;
        freeDragPos.current = { x:newX, y:newY };
        const halfX = Math.cos(dev.wallAngle) * dev.w / 2;
        const halfY = Math.sin(dev.wallAngle) * dev.w / 2;
        const movingEndpoints = [
          { x: newX - halfX, y: newY - halfY },
          { x: newX + halfX, y: newY + halfY },
        ];
        const targets = getWallEndpointRefs(dev.uid);
        let best: { target:{x:number;y:number}; moving:{x:number;y:number}; distance:number } | null = null;
        movingEndpoints.forEach(moving => targets.forEach(target => {
          const distance = Math.hypot(target.x - moving.x, target.y - moving.y);
          if (distance <= ENDPOINT_SNAP_DIST && (!best || distance < best.distance)) {
            best = { target, moving, distance };
          }
        }));
        if (best) {
          const snap = best as { target:{x:number;y:number}; moving:{x:number;y:number}; distance:number };
          newX += snap.target.x - snap.moving.x;
          newY += snap.target.y - snap.moving.y;
          setWallSnapPoint(snap.target);
        } else {
          setWallSnapPoint(null);
        }
        setPlacedDevices(prev => prev.map(d => d.uid === dragUid ? { ...d, x:newX, y:newY } : d));
      } else if (
        (dev.type === "display" || dev.type === "camera" || dev.type === "mic" || dev.type === "speaker" || dev.type === "control")
        && (dev.mountWall === "north" || dev.mountWall === "south" || dev.mountWall === "west" || dev.mountWall === "east" || dev.mountWall === "drawn")
      ) {
        // Wall-mounted AV equipment moves completely freely with the cursor
        // — including off the wall it started on, or away from any wall
        // entirely — and only snaps flush to a wall when dragged within a
        // close distance of one. Each type used to have its own more
        // restrictive rule here: cameras always snapped to the nearest wall
        // with no way to rest anywhere else, and mic/speaker/control could
        // only slide along whichever wall they were already on or flip to
        // the exact opposite one, never reaching another wall or open floor
        // space at all — the actual cause of "equipment does not move
        // freely around the canvas".
        const fp = freeDragPos.current ?? { x: dev.x, y: dev.y };
        const nx = fp.x + dxW, ny = fp.y + dyW;
        freeDragPos.current = { x: nx, y: ny };
        const snap = snapDeviceToNearestWall(nx, ny);
        if (snap && snap.dist < 1.5) {
          setPlacedDevices(prev => prev.map(d => d.uid===dragUid ? {...d, x:snap.x, y:snap.y, mountWall:snap.mountWall, wallUid:snap.wallUid, rotation:snap.angleDeg} : d));
        } else {
          const fx = Math.max(cMinX, Math.min(cMaxX, nx)), fy = Math.max(cMinY, Math.min(cMaxY, ny));
          setPlacedDevices(prev => prev.map(d => d.uid===dragUid ? {...d, x:fx, y:fy} : d));
        }
      } else {
        const newX = Math.max(cMinX, Math.min(cMaxX, dev.x + dxW));
        const newY = Math.max(cMinY, Math.min(cMaxY, dev.y + dyW));
        setPlacedDevices(prev => prev.map(d => d.uid===dragUid ? {...d,x:newX,y:newY} : d));
      }
    } else {
      const s32=32*scale, s18=18*scale, s38=38*scale;
      if (dev.mountWall==="north"||dev.mountWall==="south"||dev.mountWall==="west"||dev.mountWall==="east") {
        if (dev.mountWall==="north"||dev.mountWall==="south") {
          const dxW=dxPx/s32, dzW=-(dyPx-dxW*s18)/s38;
          const newX=Math.max(cMinX,Math.min(cMaxX,dev.x+dxW)), newZ=Math.max(0,Math.min(roomH,dev.z+dzW));
          setPlacedDevices(prev=>prev.map(d=>d.uid===dragUid?{...d,x:newX,z:newZ}:d));
        } else {
          const dyW=-dxPx/s32, dzW=-(dyPx+dyW*s18)/s38;
          const newY=Math.max(cMinY,Math.min(cMaxY,dev.y+dyW)), newZ=Math.max(0,Math.min(roomH,dev.z+dzW));
          setPlacedDevices(prev=>prev.map(d=>d.uid===dragUid?{...d,y:newY,z:newZ}:d));
        }
      } else {
        const dxW=dxPx/(2*s32)+dyPx/(2*s18), dyW=-dxPx/(2*s32)+dyPx/(2*s18);
        const newX=Math.max(cMinX,Math.min(cMaxX,dev.x+dxW)), newY=Math.max(cMinY,Math.min(cMaxY,dev.y+dyW));
        setPlacedDevices(prev=>prev.map(d=>d.uid===dragUid?{...d,x:newX,y:newY}:d));
      }
    }
    setDragStart({ x: svgP.x, y: svgP.y });
  };

  const [wallDragged, setWallDragged] = useState(false);
  const wallEdgeClicked = useRef(false);
  const handleSvgMouseUp = () => {
    // If wall edge was clicked without dragging, select it
    if (wallDragEdge && !wallDragged) {
      setSelectedEdge(wallDragEdge);
      wallEdgeClicked.current = true;
    }
    if (dragNewDevice?.active) handleNewDeviceDrop();
    if (wallStretchDrag) setWallStretchDrag(null);
    setTrackGuides([]); setWallSnapPoint(null);
    freeDragPos.current = null;
    setDragUid(null); setDragStart(null); setWallDragEdge(null); setWallDragStart(null); setWallDragged(false); setMultiDrag(null); setTableResizeDrag(null); setDoorDragId(null); setDoorDragStart(null); setRotDragUid(null); setRotDragCenter(null); setRotatingTable(false); setTableRotCenter(null);
  };

  // Dragging a callout label — kept fully independent of dragUid/dragStart
  // (the device-drag mechanism above) since several of its branches key off
  // dev.type/mountWall to do wall-snapping that must never apply to a
  // callout's own offset, and a callout can be mid-drag while its owning
  // device isn't selected or being dragged at all.
  const [calloutDragUid, setCalloutDragUid] = useState<number | null>(null);
  const [calloutDragStart, setCalloutDragStart] = useState<{ x: number; y: number } | null>(null);
  const calloutDragOrigin = useRef<{ dx: number; dy: number } | null>(null);
  // Call-outs are drawn on both the Floor Plan and the Ceiling Plan; each has
  // its own SVG and scale (feet -> px), so a drag has to know which it is on.
  type CalloutView = "plan" | "ceil";
  const calloutDragView = useRef<CalloutView>("plan");
  const ceilScale = () => Math.min(380 / roomW, 270 / roomL);

  const handleCalloutMouseDown = (e: React.MouseEvent, dev: PlacedDevice, view: CalloutView = "plan") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pushUndo();
    setSelectedUid(dev.uid); clearSelection();
    const def = defaultCalloutOffset(dev);
    calloutDragOrigin.current = { dx: dev.calloutDx ?? def.dx, dy: dev.calloutDy ?? def.dy };
    setCalloutDragUid(dev.uid);
    calloutDragView.current = view;
    const svg = (view === "ceil" ? ceilSvgRef : svgRef).current; if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    setCalloutDragStart({ x: svgP.x, y: svgP.y });
  };

  const handleCalloutMouseMove = (e: React.MouseEvent) => {
    if (!calloutDragUid || !calloutDragStart || !calloutDragOrigin.current) return;
    const view = calloutDragView.current;
    const svg = (view === "ceil" ? ceilSvgRef : svgRef).current; if (!svg) return;
    const scale = view === "ceil" ? ceilScale() : planScale;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const dxW = (svgP.x - calloutDragStart.x) / scale;
    const dyW = (svgP.y - calloutDragStart.y) / scale;
    const newDx = calloutDragOrigin.current.dx + dxW;
    const newDy = calloutDragOrigin.current.dy + dyW;
    setPlacedDevices(prev => prev.map(d => d.uid === calloutDragUid ? { ...d, calloutDx: newDx, calloutDy: newDy } : d));
  };

  const handleCalloutMouseUp = () => {
    setCalloutDragUid(null); setCalloutDragStart(null); calloutDragOrigin.current = null;
  };

  // Renders one device's call-out: the make/model label, a short straight
  // stub off the text, then an angled leader running the rest of the way
  // back to the equipment. Drawn as its own pass over the plan-view devices
  // (rather than inline inside each device's own type branch) so the label
  // always stays upright — several device types (e.g. a wall display) wrap
  // their own icon in an SVG rotate() transform to match wall orientation,
  // and a label inside that group would rotate sideways along with it.
  const CALLOUT_STUB_PX = 20;
  const renderCallout = (dev: PlacedDevice, view: CalloutView = "plan") => {
    // Feet -> px for the canvas this call-out is on.
    const scale = view === "ceil" ? ceilScale() : planScale;
    const offX = view === "ceil" ? (600 - roomW * scale) / 2 : planOffX;
    const offY = view === "ceil" ? (420 - roomL * scale) / 2 : planOffY;
    const anchorPx = offX + dev.x * scale, anchorPy = offY + (dev.y || 0.1) * scale;
    const def = defaultCalloutOffset(dev);
    const dxFt = dev.calloutDx ?? def.dx, dyFt = dev.calloutDy ?? def.dy;
    const labelX = anchorPx + dxFt * scale, labelY = anchorPy + dyFt * scale;
    const side = labelX >= anchorPx ? 1 : -1;
    const elbowX = labelX - side * CALLOUT_STUB_PX, elbowY = labelY;
    const label = calloutLabel(dev);
    const isSelected = selectedUid === dev.uid || selectedUids.has(dev.uid);
    return (
      // pointerEvents="none" on the whole leader-line group (the label/handle
      // below opt back in explicitly): the anchor dot sits at the device's
      // own on-screen center, exactly where its icon is — undoing that would
      // let a purely decorative line/dot silently steal clicks meant for the
      // device underneath, since this callout's <g> is a sibling drawn in a
      // later pass, not a descendant of the device's own <g>, so the device's
      // click/drag handlers would never fire at all for a click that lands on
      // callout graphics instead.
      <g key={`callout-${dev.uid}`} pointerEvents="none">
        <line x1={anchorPx} y1={anchorPy} x2={elbowX} y2={elbowY} stroke="rgb(var(--text-muted))" strokeWidth={0.6} />
        <line x1={elbowX} y1={elbowY} x2={labelX} y2={labelY} stroke="rgb(var(--text-muted))" strokeWidth={0.6} />
        <circle cx={anchorPx} cy={anchorPy} r={1.2} fill="rgb(var(--text-muted))" />
        {/* A bare <text> only hit-tests its actual glyph ink, not its logical
            bounding box, so a click landing in the gap between characters
            (or in the box's padding) falls through instead of starting a
            drag — this invisible padded rect behind it widens the
            draggable area to the label's full apparent extent. */}
        <rect x={side > 0 ? labelX : labelX - Math.max(30, label.length * 4.6)} y={labelY - 5}
          width={Math.max(30, label.length * 4.6)} height={9} fill="transparent" pointerEvents="auto"
          style={{ cursor: "move" }} onMouseDown={e => handleCalloutMouseDown(e, dev, view)}
          onContextMenu={e => handleDeviceContextMenu(e, dev.uid)} />
        {/* Deliberately NOT className="dev-label" — that class (globals.css)
            is hover-only opacity:0 by default, built for the old glued-on
            caption in a busy room. A call-out is meant to read like a
            permanent drawing annotation, always visible, not a tooltip. */}
        <text
          x={labelX + side * 4} y={labelY + 2.5}
          textAnchor={side > 0 ? "start" : "end"}
          fontSize={7} fontWeight={600} fill="rgb(var(--text-body))" fontFamily="Inter, sans-serif"
          pointerEvents="auto"
          style={{ cursor: "move" }}
          onMouseDown={e => handleCalloutMouseDown(e, dev, view)}
          onContextMenu={e => handleDeviceContextMenu(e, dev.uid)}
        >{label}</text>
        {isSelected && (
          <circle cx={labelX} cy={labelY} r={2.5} fill="#8b5cf6" stroke="#fff" strokeWidth={0.5} pointerEvents="auto"
            style={{ cursor: "move" }} onMouseDown={e => handleCalloutMouseDown(e, dev, view)}
            onContextMenu={e => handleDeviceContextMenu(e, dev.uid)} />
        )}
      </g>
    );
  };

  const handleMoveDrag = (e: React.MouseEvent) => {
    if (!moveDragStart) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const dxW = (svgP.x - moveDragStart.x) / planScale;
    const dyW = (svgP.y - moveDragStart.y) / planScale;
    const dxSvg = svgP.x - moveDragStart.x;
    const dySvg = svgP.y - moveDragStart.y;
    if (selectedUid !== null || selectedUids.size > 0) {
      setPlacedDevices(prev => prev.map(d => {
        const hit = selectedUid !== null ? d.uid === selectedUid : selectedUids.has(d.uid);
        if (!hit) return d;
        return { ...d, x: d.x + dxW, y: d.y + dyW };
      }));
    }
    if (selected.has("table")) {
      setTableCenterX(prev => (prev ?? roomW / 2) + dxW);
      setTableWallDist(prev => prev + dyW);
    }
    selected.forEach(id => {
      if (id.startsWith("chair:")) {
        const idx = parseInt(id.split(":")[1]);
        setChairOffsets(prev => ({ ...prev, [idx]: { dx: (prev[idx]?.dx ?? 0) + dxW, dy: (prev[idx]?.dy ?? 0) + dyW } }));
      }
    });
    if (annotate.hasSelection) annotate.translateSelected(dxSvg,dySvg);
    setMoveDragStart({ x: svgP.x, y: svgP.y });
  };

  const handleWallEdgeDown = (edge: "north"|"south"|"east"|"west", e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pushUndo();
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    setWallDragEdge(edge);
    setWallDragStart({ svgX: svgP.x, svgY: svgP.y, origW: roomW, origL: roomL });
  };

  const handleWallEdgeDrag = (e: React.MouseEvent) => {
    if (!wallDragEdge || !wallDragStart) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const dx = (svgP.x - wallDragStart.svgX) / planScale;
    const dy = (svgP.y - wallDragStart.svgY) / planScale;
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) setWallDragged(true);
    const minSize = 2; // min 2 meters
    if (wallDragEdge === "east") {
      setRoomW(Math.max(minSize, wallDragStart.origW + dx));
    } else if (wallDragEdge === "west") {
      setRoomW(Math.max(minSize, wallDragStart.origW - dx));
    } else if (wallDragEdge === "south") {
      setRoomL(Math.max(minSize, wallDragStart.origL + dy));
    } else if (wallDragEdge === "north") {
      setRoomL(Math.max(minSize, wallDragStart.origL - dy));
    }
  };

  const selectRoom = (r: RoomType) => {
    setRoomType(r.id); setRoomW(r.w); setRoomL(r.l); setRoomH(r.h);
    setTableSeats(r.maxSeats);
    setTableWidth(r.maxSeats<=6?3.5:r.maxSeats<=12?4.0:5.0);
    setTableWallDist(r.l*0.2);
    setPlacedDevices([]); setStep(2);
  };

  const addDeviceToRoom = (dev: DeviceCatalogItem & Partial<PlacedDevice>) => {
    // Date.now() alone collides when this is called several times back to
    // back synchronously (a Kit expanding into multiple placed devices at
    // once) — same fix already used elsewhere in this file for the same reason.
    const id = Date.now() + Math.random();
    let x=0.5, y=0.5, z=0, mountWall="north";
    let rotation: number|undefined, wallUid: number|undefined;
    if (dev.wall==="front"||dev.wall==="side") {
      if (isCustomBlank) {
        // Custom drawn room: default to the "north" wall — the topmost
        // roughly-horizontal drawn wall; fall back to nearest-to-center
        const walls = placedDevices.filter(d => d.id === "wall-partition" && d.wallAngle !== undefined);
        let north: PlacedDevice | null = null;
        walls.forEach(w => {
          const horizontal = Math.abs(Math.sin(w.wallAngle!)) < 0.5;
          if (horizontal && (!north || w.y < north.y)) north = w;
        });
        const ccx = north ? (north as PlacedDevice).x : drawnBounds ? drawnBounds.centerX : roomW/2;
        const ccy = north ? (north as PlacedDevice).y : drawnBounds ? drawnBounds.centerY : roomL/2;
        const snap = snapDeviceToNearestWall(ccx, ccy);
        if (snap) { x=snap.x; y=snap.y; z=roomH*0.55; mountWall=snap.mountWall; rotation=snap.angleDeg; wallUid=snap.wallUid; }
        else { x=ccx; y=ccy; z=roomH*0.55; }
      } else {
        mountWall=selectedWall;
        if (selectedWall==="north")  { x=roomW/2;       y=0.02;       z=roomH*0.55; }
        else if(selectedWall==="south") { x=roomW/2;    y=roomL-0.02; z=roomH*0.55; }
        else if(selectedWall==="west")  { x=0.02;       y=roomL/2;    z=roomH*0.55; rotation=90; }
        else if(selectedWall==="east")  { x=roomW-0.02; y=roomL/2;    z=roomH*0.55; rotation=90; }
      }
    } else if(dev.wall==="ceiling") { x=roomW/2; y=roomL/2; z=roomH-0.05; mountWall="ceiling"; }
    else if(dev.wall==="table")     { x=roomW/2; y=roomL/2; z=0.76;       mountWall="floor"; }
    else if(dev.wall==="floor")     { x=roomW/2; y=roomL/2; z=0;          mountWall="floor"; }
    const hfov = dev.hfovDeg ?? (dev.type==="camera" ? (dev.id==="soundbar-cam"?120:dev.id==="ceiling-cam"?90:70) : undefined);
    const covShape = dev.coveragePattern==="circular" ? "round" as const : dev.coveragePattern==="rectangular" ? "square" as const
      : (dev.type==="mic"&&dev.wall==="ceiling") ? "round" as const : undefined;
    const covDiameter = dev.coverageDiameterFt ?? ((dev.type==="mic"&&dev.wall==="ceiling") ? 6 : dev.id==="table-mic" ? 2 : undefined);
    const covW = dev.coverageWidthFt ?? ((dev.type==="mic"&&dev.wall==="ceiling") ? 6 : undefined);
    const covL = dev.coverageDepthFt ?? ((dev.type==="mic"&&dev.wall==="ceiling") ? 6 : undefined);
    const dispersion = dev.coverageAngleDeg ?? ((dev.type==="speaker"&&dev.wall==="ceiling") ? 90 : undefined);
    setPlacedDevices(prev=>[...prev,{...dev,itemId:dev.itemId||newItemId(),uid:id,x,y,z,mountWall,rotation,wallUid,hfov,covShape,covDiameter,covW,covL,dispersion}]);
  };

  const removeDevice = (uid: number) => { pushUndo(); setPlacedDevices(prev=>prev.filter(d=>d.uid!==uid)); };

  // AI: Generate devices from this room's Site Survey Scope of Work — the
  // same feature as Signal Flow Builder's "Generate from Scope", rebuilt for
  // real floor-plan geometry (walls/ceiling/table) instead of an abstract
  // canvas. Only categories with a real deviceCatalog icon get placed; a
  // scope item the AI identifies with no matching icon (a DSP, amplifier,
  // etc.) is skipped and called out in the summary rather than force-placed.
  const resolveScopeDeviceTemplate = (category: string, label: string, location: string): DeviceCatalogItem | null => {
    const l = label.toLowerCase();
    const loc = location.toLowerCase();
    const isCeiling = loc.includes("ceiling");
    const isTable = loc.includes("table");
    const find = (id: string) => deviceCatalog.flatMap(g => g.items).find((i: any) => i.id === id) || null;
    // Keyword matches checked first, independent of the AI's own category —
    // the model doesn't consistently classify a "video bar" as "camera" or
    // a "projection screen" as "display" (often lands in "other" instead),
    // but these still have real, unambiguous icons and shouldn't be skipped
    // just because the category guess was off.
    if (l.includes("soundbar") || l.includes("video bar") || l.includes("conference bar")) return find("soundbar-cam");
    if (l.includes("led") && (l.includes("wall") || l.includes("video wall"))) return find("led-wall");
    if (l.includes("projection screen") || l.includes("projector screen") || (l.includes("screen") && !l.includes("touch"))) return find("projector-screen");
    // A bare "projector" (no "screen" in the label — that case is already
    // handled above) is the physical ceiling-mounted unit, not the screen.
    if (l.includes("projector")) return find("projector");
    switch (category) {
      case "display":
        return find("display-55");
      case "camera":
        if (isCeiling) return find("ceiling-cam");
        return find("ptz-cam");
      case "speaker":
        return isCeiling ? find("ceiling-spk") : find("soundbar");
      case "microphone":
        return isTable ? find("table-mic") : find("ceiling-mic");
      case "touch_panel":
        return l.includes("table") ? find("table-touch") : find("touch-panel");
      default:
        return null; // "other" (DSP, amplifier, network switch, ...) — no matching icon, skipped
    }
  };

  const resolveScopeMountWall = (location: string): "north"|"south"|"west"|"east"|"ceiling"|"table" => {
    const loc = location.toLowerCase();
    if (loc.includes("ceiling")) return "ceiling";
    if (loc.includes("table")) return "table";
    if (loc.includes("front")) return "north";
    if (loc.includes("rear") || loc.includes("back")) return "south";
    if (loc.includes("left")) return "west";
    if (loc.includes("right")) return "east";
    if (loc.includes("side")) return "east";
    return "north";
  };

  // Lays out a group of devices sharing the same wall/ceiling/table mount so
  // they don't all stack on the exact same point — addDeviceToRoom (above)
  // has no such spacing since it only ever places one device at a time.
  const spreadDevicesOnMount = (devices: PlacedDevice[], mount: "north"|"south"|"west"|"east"|"ceiling"|"table", rw: number = roomW, rl: number = roomL, rh: number = roomH): PlacedDevice[] => {
    const GAP = 0.5;
    const totalW = devices.reduce((s, d) => s + d.w, 0) + GAP * Math.max(0, devices.length - 1);
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    if (mount === "north" || mount === "south") {
      let cursor = rw / 2 - totalW / 2;
      const y = mount === "north" ? 0.02 : rl - 0.02;
      return devices.map(d => {
        const x = clamp(cursor + d.w / 2, d.w / 2, rw - d.w / 2);
        cursor += d.w + GAP;
        return { ...d, x, y, z: rh * 0.55, mountWall: mount };
      });
    }
    if (mount === "west" || mount === "east") {
      let cursor = rl / 2 - totalW / 2;
      const x = mount === "west" ? 0.02 : rw - 0.02;
      return devices.map(d => {
        const y = clamp(cursor + d.w / 2, d.w / 2, rl - d.w / 2);
        cursor += d.w + GAP;
        return { ...d, x, y, z: rh * 0.55, mountWall: mount, rotation: 90 };
      });
    }
    if (mount === "ceiling") {
      let cursor = rw / 2 - totalW / 2;
      return devices.map(d => {
        const x = clamp(cursor + d.w / 2, d.w / 2, rw - d.w / 2);
        cursor += d.w + GAP;
        return { ...d, x, y: rl / 2, z: rh - 0.05, mountWall: "ceiling" };
      });
    }
    // table
    let cursor = rw / 2 - totalW / 2;
    return devices.map(d => {
      const x = clamp(cursor + d.w / 2, d.w / 2, rw - d.w / 2);
      cursor += d.w + GAP;
      return { ...d, x, y: rl / 2, z: 0.76, mountWall: "floor" };
    });
  };

  // Re-importing replaces the equipment in all three tools, so it asks first.
  // The room itself (dimensions, walls, table, chairs) and all annotations are
  // kept — only things that bill are cleared and regenerated.
  const requestScopeImport = async () => {
    if (!projectParam || !roomParam || roomParam === "default" || generatingFromScope || !rdLoaded) return;
    const existing = await loadScopeManifest(roomParam, projectParam);
    // Equipment already on the plan counts too, not just a saved manifest —
    // otherwise generating on top of an earlier set (placed before the
    // manifest existed, or whose manifest is gone) stacked a second full set
    // of projectors and speakers on the first instead of replacing it.
    const hasEquipment = placedDevices.some(d => !isRoomFurniture(d)) || hiddenDevices.length > 0;
    if (existing || hasEquipment) { setScopeReimportConfirm(true); return; }
    generateDevicesFromScopeRD(false);
  };

  const wipeAllToolsForReimport = async () => {
    setPlacedDevices(prev => wipeRoomDesignerEquipment(prev));
    // Hidden equipment is equipment too — a re-import replaces it as well.
    setHiddenDevices([]);
    const [sf, rack] = await Promise.all([
      loadToolData("signal-flow", roomParam, projectParam),
      loadToolData("rack-planner", roomParam, projectParam),
    ]);
    await Promise.all([
      saveToolData("signal-flow", { ...(sf || {}), ...wipeSignalFlowEquipment() }, roomParam, projectParam),
      saveToolData("rack-planner", { ...(rack || {}), items: [], hiddenItems: [] }, roomParam, projectParam),
    ]);
  };

  const generateDevicesFromScopeRD = async (isReimport = false) => {
    // rdLoaded gates this room's own saved config (roomType/roomW/roomL/
    // roomH/placedDevices) having finished loading — without it, the
    // "is this room still untouched" check below could read this component's
    // initial-state defaults instead of what's actually saved, and wrongly
    // resize a room that was already configured.
    if (!projectParam || !roomParam || roomParam === "default" || generatingFromScope || !rdLoaded) return;
    setGeneratingFromScope(true);
    try {
      const { data: survey, error: surveyError } = await supabase
        .from("site_surveys")
        .select("data")
        .eq("project_id", projectParam)
        .maybeSingle();
      if (surveyError) throw new Error(surveyError.message);

      const buildings: any[] = survey?.data?.buildings || [];
      let scopeText = "";
      let surveyRoomData: Record<string, string> | null = null;
      for (const b of buildings) {
        const room = (b.rooms || []).find((r: any) => r.id === roomParam);
        if (room) { scopeText = room.data?.scope_of_work || ""; surveyRoomData = room.data || {}; break; }
      }
      if (!scopeText.trim()) {
        setGenerateNotice({ kind: "error", message: "No Scope of Work found for this room — add one in Site Survey first." });
        window.setTimeout(() => setGenerateNotice(null), 5000);
        return;
      }

      // Everything that can fail — the AI call, the manifest save — runs BEFORE
      // the plan is touched at all. The room shell (table, chairs, walls) used
      // to be applied first and the AI call made afterwards, so a failed or
      // empty AI response left just the table and chairs on screen with no
      // walls or devices, and a re-import had already wiped the old equipment.
      const items = await fetchScopeUnits(scopeText);
      if (!items.length) {
        setGenerateNotice({ kind: "error", message: "No AV devices were recognized in this room's Scope of Work — nothing was changed." });
        window.setTimeout(() => setGenerateNotice(null), 10000);
        return;
      }
      // Recorded before placement: units this tool has no icon for (a DSP, an
      // amplifier) still belong to the import, and Signal Flow and the rack
      // materialise them from here even though no floor-plan symbol exists.
      if (isReimport) await wipeAllToolsForReimport();
      await saveScopeManifest(
        { importedAt: Date.now(), importedBy: "room-designer", units: items, materialisedBy: ["room-designer"] },
        roomParam, projectParam,
      );
      // The import just rewrote Signal Flow's and the rack's saved data and the
      // scope manifest — have the BOM re-read them so it shows the new units
      // under Signal Flow too (and none of the old ones) without waiting for a
      // visit to that tool.
      await reloadBaseline("room-designer");

      // Captured once, up front, so a resize below and the device placement
      // further down both undo together in a single Ctrl+Z — pushUndo()
      // snapshots the CURRENT roomW/roomL/roomH, so it must run before
      // either is changed.
      pushUndo();

      // Auto-size the room from Site Survey's real recorded dimensions —
      // but only when the room has no structure of its own (no walls, no
      // furniture, no doors), so this can never silently overwrite a room a
      // user already built by hand. Judged by what is actually on the plan,
      // not by the room preset: a previous generate (or a manual preset
      // pick) leaves roomType on something other than "medium", which used
      // to make an emptied room look "configured" so no walls/table came
      // back. Equipment doesn't count as structure, and on a re-import it is
      // being wiped anyway — `placedDevices` here is still the pre-wipe
      // snapshot, hence checking the structure rather than its length.
      let effectiveRoomW = roomW, effectiveRoomL = roomL, effectiveRoomH = roomH;
      const wallDevicesToAdd: PlacedDevice[] = [];
      let roomShellNote = "";
      const hasStructure = wipeRoomDesignerEquipment(placedDevices).length > 0 || placedDoors.length > 0;
      const isUntouchedRoom = !hasStructure && (isReimport || placedDevices.length === 0);
      if (isUntouchedRoom && surveyRoomData) {
        const feet = (ftKey: string, inKey: string) => {
          const ft = parseFloat(surveyRoomData![ftKey] || "");
          const inch = parseFloat(surveyRoomData![inKey] || "");
          const total = (Number.isFinite(ft) ? ft : 0) + (Number.isFinite(inch) ? inch : 0) / 12;
          return total > 0 ? total : null;
        };
        const surveyW = feet("room_width", "room_width_in");
        const surveyL = feet("room_length", "room_length_in");
        const surveyH = feet("room_height", "room_height_in");
        if (surveyW && surveyL) {
          effectiveRoomW = surveyW;
          effectiveRoomL = surveyL;
          if (surveyH) effectiveRoomH = surveyH;
          setRoomW(effectiveRoomW);
          setRoomL(effectiveRoomL);
          if (surveyH) setRoomH(effectiveRoomH);

          const purpose = (surveyRoomData.room_purpose || "").toLowerCase();
          const byName = roomTypes.find(rt => purpose.includes(rt.name.toLowerCase()) || rt.name.toLowerCase().includes(purpose));
          const surveyArea = effectiveRoomW * effectiveRoomL;
          const byArea = roomTypes.reduce((best, rt) => Math.abs(rt.w * rt.l - surveyArea) < Math.abs(best.w * best.l - surveyArea) ? rt : best, roomTypes[0]);
          const matchedRoomType = byName || byArea;
          setRoomType(matchedRoomType.id);

          // A table + chairs by default, sized off the matched room preset —
          // selectRoom (picking a preset manually) sets these same seat/width
          // values but never actually turns showTable on, so even that path
          // doesn't show a table without this; a fresh room otherwise shows
          // walls and devices floating with nothing to sit at.
          setShowTable(true);
          setTableShape("rectangular");
          setTableSeats(matchedRoomType.maxSeats);
          // Width and length both scale with the actual room, not just a
          // seat-count bucket — a 4-seat table in a 30ft room should be
          // bigger than the same 4-seat table in an 8ft huddle room.
          const seatBasedWidth = matchedRoomType.maxSeats <= 6 ? 3.5 : matchedRoomType.maxSeats <= 12 ? 4.0 : 5.0;
          setTableWidth(Math.max(2.5, Math.min(seatBasedWidth, effectiveRoomW * 0.35)));
          // Exactly 4ft of clearance front and back: tableWallDist is the
          // gap from the front wall to the table's near edge, and the
          // renderer places the table's center at tableWallDist + length/2
          // (~line 5960's tcy), so its far edge lands at
          // tableWallDist + length — set length to roomL - 8 to land that
          // far edge exactly 4ft short of the rear wall too.
          const FRONT_REAR_CLEARANCE = 4;
          setTableWallDist(FRONT_REAR_CLEARANCE);
          // tableLengthOverride defaults to a fixed 2ft and always wins over
          // the built-in seat-count length formula (see its use ~line 3408)
          // — left alone, every auto-generated table would render at a tiny
          // fixed 2ft regardless of room size. Floored at 2ft so a room too
          // short for 4+4ft clearance still gets a usable (if cramped)
          // table instead of a negative/zero length.
          setTableLengthOverride(Math.max(2, effectiveRoomL - FRONT_REAR_CLEARANCE * 2));
          setTableDeleted(false);
          setDeletedChairs(new Set());
          // A table someone moved, rotated or re-arranged before removing it
          // shouldn't come back where they left it — start from the default.
          setTableCenterX(null);
          setTableRotation(0);
          setChairOffsets({});

          // This app has no "just type in dimensions and get a rectangle"
          // mode — every room's visible boundary comes from explicit wall
          // segments (see createWallSegment, the same thing a user creates
          // by hand with the Drywall tool). Draw the 4 walls of the new
          // rectangle in the same shape it produces, so the resize above
          // actually becomes a visible room, not just numbers nothing reads.
          const makeWall = (x1: number, y1: number, x2: number, y2: number): PlacedDevice => {
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            return {
              id: "wall-partition", name: "Drywall", icon: "🧱",
              w: len, h: 0.15, wall: "floor", type: "furniture", color: "rgb(var(--text-subtle))",
              uid: Date.now() + Math.random(), x: (x1 + x2) / 2, y: (y1 + y2) / 2, z: 0, mountWall: "floor",
              wallAngle: Math.atan2(dy, dx), wallType: "drywall",
            } as PlacedDevice;
          };
          wallDevicesToAdd.push(
            makeWall(0, 0, effectiveRoomW, 0),                       // north
            makeWall(effectiveRoomW, 0, effectiveRoomW, effectiveRoomL), // east
            makeWall(effectiveRoomW, effectiveRoomL, 0, effectiveRoomL), // south
            makeWall(0, effectiveRoomL, 0, 0),                       // west
          );
        } else {
          roomShellNote = " Walls, table and chairs weren't created because this room has no length/width in Site Survey — add them there and generate again.";
        }
      }

      const skipped: string[] = [];
      const byMount = new Map<"north"|"south"|"west"|"east"|"ceiling"|"table", PlacedDevice[]>();
      let seq = 0;
      items.forEach((item) => {
        const location = item.location || "";
        const template = resolveScopeDeviceTemplate(item.category, item.label, location);
        if (!template) { if (!skipped.includes(item.label)) skipped.push(item.label); return; }
        // A device whose catalog template is inherently ceiling- or
        // table-mounted (ceiling mic/speaker/camera/projector, table
        // mic/touch panel) stays there regardless of what wall the AI's
        // location text described — "front" in the scope usually describes
        // where the room/screen faces, not where a ceiling unit is bolted.
        const mount = template.wall === "ceiling" ? "ceiling" : template.wall === "table" ? "table" : resolveScopeMountWall(location);
        const hfov = template.hfovDeg ?? (template.type === "camera" ? (template.id === "soundbar-cam" ? 120 : template.id === "ceiling-cam" ? 90 : 70) : undefined);
        const covShape = template.coveragePattern === "circular" ? "round" as const : template.coveragePattern === "rectangular" ? "square" as const
          : (template.type === "mic" && template.wall === "ceiling") ? "round" as const : undefined;
        const covDiameter = template.coverageDiameterFt ?? ((template.type === "mic" && template.wall === "ceiling") ? 6 : template.id === "table-mic" ? 2 : undefined);
        const covW = template.coverageWidthFt ?? ((template.type === "mic" && template.wall === "ceiling") ? 6 : undefined);
        const covL = template.coverageDepthFt ?? ((template.type === "mic" && template.wall === "ceiling") ? 6 : undefined);
        const dispersion = template.coverageAngleDeg ?? ((template.type === "speaker" && template.wall === "ceiling") ? 90 : undefined);
        // Each unit is already one physical item — fetchScopeUnits expanded
        // quantities and stamped the shared identity, so the same unit can be
        // recognised here, in Signal Flow and in the rack.
        const uid = Date.now() + (seq++) + Math.random();
        const placed: PlacedDevice = {
          ...template, itemId: item.itemId, productKey: item.productKey,
          // Only when the scope text actually named a real manufacturer/model
          // for this unit (see generate-devices-from-scope's prompt) — same
          // conditional pattern as deviceFromBomUnit above, so a placeholder
          // template's own mfr/model isn't clobbered with nothing.
          ...(item.mfr ? { mfr: item.mfr, ...(item.model ? { model: item.model } : {}) } : {}),
          rack_units: item.rackUnits, uid, name: item.name,
          x: 0, y: 0, z: 0, mountWall: mount, hfov, covShape, covDiameter, covW, covL, dispersion,
        };
        if (!byMount.has(mount)) byMount.set(mount, []);
        byMount.get(mount)!.push(placed);
      });

      const allNewDevices: PlacedDevice[] = [];
      byMount.forEach((devs, mount) => allNewDevices.push(...spreadDevicesOnMount(devs, mount, effectiveRoomW, effectiveRoomL, effectiveRoomH)));

      if (!allNewDevices.length && !wallDevicesToAdd.length) {
        setGenerateNotice({ kind: "error", message: skipped.length ? `No devices could be placed — no matching icon for: ${skipped.join(", ")}.` : "No AV devices were recognized in this room's Scope of Work." });
        window.setTimeout(() => setGenerateNotice(null), 5000);
        return;
      }

      setPlacedDevices(prev => [...prev, ...wallDevicesToAdd, ...allNewDevices]);

      const roomMsg = wallDevicesToAdd.length ? `Sized the room to Site Survey's dimensions, added walls, table and chairs; ` : "";
      const addedMsg = allNewDevices.length ? `added ${allNewDevices.length} device${allNewDevices.length===1?"":"s"} from Scope of Work` : "no devices placed";
      const skippedMsg = skipped.length ? `; ${skipped.length} item${skipped.length===1?"":"s"} skipped (no matching icon): ${skipped.join(", ")}` : "";
      setGenerateNotice({ kind: "ok", message: `${roomMsg}${addedMsg}${skippedMsg}.${roomShellNote}` });
      window.setTimeout(() => setGenerateNotice(null), roomShellNote ? 12000 : 7000);
    } catch (error: any) {
      setGenerateNotice({ kind: "error", message: `Generate from Scope failed: ${error?.message || "unable to generate devices from scope"}.` });
      window.setTimeout(() => setGenerateNotice(null), 10000);
    } finally {
      setGeneratingFromScope(false);
    }
  };

  const handleDeviceContextMenu = (e: React.MouseEvent, uid: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedUid(uid);
    setDeviceContextMenu({x:e.clientX, y:e.clientY, uid});
  };

  const duplicateDevice = (uid: number) => {
    const dev = placedDevices.find(d=>d.uid===uid);
    if (!dev) return;
    pushUndo();
    const newUid = Date.now();
    const offset = Math.min(1, Math.max(roomW, roomL) * 0.05);
    // A duplicate is a second physical unit, so it gets its own identity —
    // spreading `dev` would otherwise copy itemId and make the BOM count the
    // two as one, while the sync steps treated one as a stale copy to prune.
    setPlacedDevices(prev=>[...prev, {...dev, itemId:newItemId(), uid:newUid, x:dev.x+offset, y:dev.y+offset}]);
    setSelectedUid(newUid);
  };

  // Manual rotate, from the rotate popup: cameras get an exact value set as
  // facingOverrideDeg — an additive nudge on top of whatever the auto
  // wall-snap computed (see PlacedDevice; the FOV-cone renderer adds this to
  // its own resolved facing), since a camera's true facing can't be set to
  // an absolute angle without redoing the same inside/outside wall-normal
  // resolution its renderer already does. Displays render their icon
  // directly from `rotation`, so theirs is set as that absolute angle.
  const setDeviceRotation = (uid: number, deg: number) => {
    const dev = placedDevices.find(d=>d.uid===uid);
    if (!dev) return;
    pushUndo();
    if (dev.type === "camera") {
      setPlacedDevices(prev=>prev.map(d=>d.uid===uid?{...d, facingOverrideDeg:deg}:d));
    } else {
      setPlacedDevices(prev=>prev.map(d=>d.uid===uid?{...d, rotation:deg}:d));
    }
  };

  // Snap world coords to nearest wall, return wall name and position (0-1) along that wall
  const snapToWall = (wx: number, wy: number): { wall: "north"|"south"|"east"|"west"|"drawn"; pos: number; wallUid?: number } => {
    const dists: { wall: "north"|"south"|"east"|"west"|"drawn"; d: number; pos: number; wallUid?: number }[] = [];
    // Boundary walls (only in non-custom mode)
    if (!isCustomBlank) {
      dists.push(
        { wall: "north", d: Math.abs(wy), pos: Math.max(0, Math.min(1, wx / roomW)) },
        { wall: "south", d: Math.abs(wy - roomL), pos: Math.max(0, Math.min(1, wx / roomW)) },
        { wall: "west", d: Math.abs(wx), pos: Math.max(0, Math.min(1, wy / roomL)) },
        { wall: "east", d: Math.abs(wx - roomW), pos: Math.max(0, Math.min(1, wy / roomL)) },
      );
    }
    // Drawn wall segments
    placedDevices.filter(d => d.id === "wall-partition" && d.wallAngle !== undefined).forEach(dev => {
      const angle = dev.wallAngle!;
      const len = dev.w;
      const x1 = dev.x - Math.cos(angle) * len / 2;
      const y1 = dev.y - Math.sin(angle) * len / 2;
      const x2 = dev.x + Math.cos(angle) * len / 2;
      const y2 = dev.y + Math.sin(angle) * len / 2;
      const dx = x2 - x1, dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 0.001) return;
      const t = Math.max(0, Math.min(1, ((wx - x1) * dx + (wy - y1) * dy) / lenSq));
      const closestX = x1 + t * dx, closestY = y1 + t * dy;
      const dist = Math.sqrt((wx - closestX) ** 2 + (wy - closestY) ** 2);
      dists.push({ wall: "drawn", d: dist, pos: t, wallUid: dev.uid });
    });
    if (dists.length === 0) {
      return { wall: "north", pos: 0.5 };
    }
    dists.sort((a, b) => a.d - b.d);
    return { wall: dists[0].wall, pos: dists[0].pos, wallUid: dists[0].wallUid };
  };

  // Nearest wall (boundary or drawn) to a world point, with the snapped position
  // and wall angle — used so wall devices like displays can stick to any wall
  const snapDeviceToNearestWall = (wx: number, wy: number): { x:number; y:number; angleDeg:number; mountWall:string; wallUid?:number; dist:number } | null => {
    const cands: { x:number; y:number; angleDeg:number; mountWall:string; wallUid?:number; dist:number }[] = [];
    if (!isCustomBlank) {
      const bx = Math.max(0, Math.min(roomW, wx)), by = Math.max(0, Math.min(roomL, wy));
      // Sit on whichever face of the wall the cursor is actually on — inside
      // (the default, toward the room interior) or outside (the exterior
      // face) — rather than always forcing the inside face. Since dragging a
      // device beyond the room's boundary is now possible (see CANVAS_PAD),
      // this is what lets it actually snap to the outside of a wall instead
      // of always snapping back in.
      cands.push(
        { x: bx, y: wy < 0 ? -0.02 : 0.02,             angleDeg: 0,  mountWall: "north", dist: Math.abs(wy) },
        { x: bx, y: wy > roomL ? roomL+0.02 : roomL-0.02, angleDeg: 0,  mountWall: "south", dist: Math.abs(wy-roomL) },
        { x: wx < 0 ? -0.02 : 0.02, y: by,             angleDeg: 90, mountWall: "west",  dist: Math.abs(wx) },
        { x: wx > roomW ? roomW+0.02 : roomW-0.02, y: by, angleDeg: 90, mountWall: "east",  dist: Math.abs(wx-roomW) },
      );
    }
    placedDevices.filter(d => d.id === "wall-partition" && d.wallAngle !== undefined).forEach(w => {
      const angle = w.wallAngle!, len = w.w;
      const x1 = w.x - Math.cos(angle)*len/2, y1 = w.y - Math.sin(angle)*len/2;
      const x2 = w.x + Math.cos(angle)*len/2, y2 = w.y + Math.sin(angle)*len/2;
      const dx = x2-x1, dy = y2-y1, lenSq = dx*dx + dy*dy;
      if (lenSq < 0.001) return;
      const t = Math.max(0, Math.min(1, ((wx-x1)*dx + (wy-y1)*dy)/lenSq));
      const cx = x1 + t*dx, cy = y1 + t*dy;
      // Sit on whichever face of the wall the cursor is actually on, not
      // its centerline: offset by half wall thickness + display depth.
      // Comparing against the cursor's own position (rather than always
      // biasing toward the room's interior/center) is what lets a device
      // snap to the *outside* of a hand-drawn wall too.
      const inset = (w.h ?? 0.333)/2 + 0.15;
      let nx0 = -Math.sin(angle), ny0 = Math.cos(angle);
      if (nx0*(wx-cx) + ny0*(wy-cy) < 0) { nx0 = -nx0; ny0 = -ny0; }
      cands.push({ x: cx + nx0*inset, y: cy + ny0*inset, angleDeg: angle*180/Math.PI, mountWall: "drawn", wallUid: w.uid, dist: Math.hypot(wx-cx, wy-cy) });
    });
    if (!cands.length) return null;
    cands.sort((a,b)=>a.dist-b.dist);
    return cands[0];
  };

  // Get door rendering coords from wall + position
  const getDoorCoords = (door: PlacedDoor) => {
    if (door.wall === "drawn" && door.wallUid) {
      const wallDev = placedDevices.find(d => d.uid === door.wallUid);
      if (wallDev && wallDev.wallAngle !== undefined) {
        const angle = wallDev.wallAngle;
        const len = wallDev.w;
        const wx1 = wallDev.x - Math.cos(angle) * len / 2;
        const wy1 = wallDev.y - Math.sin(angle) * len / 2;
        const wx2 = wallDev.x + Math.cos(angle) * len / 2;
        const wy2 = wallDev.y + Math.sin(angle) * len / 2;
        const halfW = door.width / 2;
        const cx = wx1 + (wx2 - wx1) * door.pos;
        const cy = wy1 + (wy2 - wy1) * door.pos;
        const dx = Math.cos(angle) * halfW;
        const dy = Math.sin(angle) * halfW;
        const perpX = -Math.sin(angle) * 0.2;
        const perpY = Math.cos(angle) * 0.2;
        return { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, labelX: cx + perpX, labelY: cy + perpY, angle: angle * 180 / Math.PI };
      }
    }
    const wallLen = (door.wall === "north" || door.wall === "south") ? roomW : roomL;
    const along = door.pos * wallLen;
    const halfW = door.width / 2;
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0, labelX = 0, labelY = 0;
    if (door.wall === "north") { x1 = along - halfW; y1 = 0; x2 = along + halfW; y2 = 0; labelX = along; labelY = -0.15; }
    else if (door.wall === "south") { x1 = along - halfW; y1 = roomL; x2 = along + halfW; y2 = roomL; labelX = along; labelY = roomL + 0.3; }
    else if (door.wall === "west") { x1 = 0; y1 = along - halfW; x2 = 0; y2 = along + halfW; labelX = -0.3; labelY = along; }
    else if (door.wall === "east") { x1 = roomW; y1 = along - halfW; x2 = roomW; y2 = along + halfW; labelX = roomW + 0.3; labelY = along; }
    return { x1, y1, x2, y2, labelX, labelY, angle: undefined };
  };

  // Handle dragging new door from sidebar
  const handleNewDoorDrag = (e: React.MouseEvent) => {
    if (!dragNewDoor?.active) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const wx = (svgP.x - planOffX) / planScale;
    const wy = (svgP.y - planOffY) / planScale;
    const snapped = snapToWall(wx, wy);
    setDragNewDoor(prev => prev ? { ...prev, wall: snapped.wall, pos: snapped.pos, wallUid: snapped.wallUid } : null);
  };

  const handleNewDoorDrop = () => {
    if (!dragNewDoor?.active || !dragNewDoor.wall) return;
    pushUndo();
    const newId = Date.now();
    const width = dragNewDoor.type === "window" ? 2.0 : 3.0;
    setPlacedDoors(prev => [...prev, { id: newId, wall: dragNewDoor.wall!, pos: dragNewDoor.pos, width, type: dragNewDoor.type, wallUid: dragNewDoor.wallUid }]);
  };

  // Handle dragging existing placed door
  const handleDoorDragMove = (e: React.MouseEvent) => {
    if (!doorDragId || !doorDragStart) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const wx = (svgP.x - planOffX) / planScale;
    const wy = (svgP.y - planOffY) / planScale;
    const snapped = snapToWall(wx, wy);
    setPlacedDoors(prev => prev.map(d => d.id === doorDragId ? { ...d, wall: snapped.wall, pos: snapped.pos, wallUid: snapped.wallUid } : d));
  };

  // Table edge resize handlers
  const handleTableResizeStart = (edge: "left"|"right"|"top"|"bottom", e: React.MouseEvent) => {
    e.stopPropagation();
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    pushUndo();
    setTableResizeDrag({ edge, startSvgX: svgP.x, startSvgY: svgP.y, origWidth: tableWidth, origLength: tL, origSeats: tableSeats });
  };
  const handleTableResizeMove = (e: React.MouseEvent) => {
    if (!tableResizeDrag) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const dx = (svgP.x - tableResizeDrag.startSvgX) / planScale;
    const dy = (svgP.y - tableResizeDrag.startSvgY) / planScale;
    if (tableResizeDrag.edge === "right") {
      setTableWidth(Math.max(1, Math.min(16, tableResizeDrag.origWidth + dx * 2)));
    } else if (tableResizeDrag.edge === "left") {
      setTableWidth(Math.max(1, Math.min(16, tableResizeDrag.origWidth - dx * 2)));
    } else if (tableResizeDrag.edge === "bottom") {
      setTableLengthOverride(Math.max(1, Math.min(30, tableResizeDrag.origLength + dy * 2)));
    } else if (tableResizeDrag.edge === "top") {
      setTableLengthOverride(Math.max(1, Math.min(30, tableResizeDrag.origLength - dy * 2)));
    }
  };

  // Shift-aligned placement: lock the ghost onto a horizontal or vertical line through
  // the most recently placed item of the same kind (whichever axis the cursor is closer to),
  // so repeated drops line up in straight rows or columns.
  const alignToLastPlaced = (wx: number, wy: number, itemId: string, shift: boolean): {x:number;y:number;ref:{x:number;y:number}|null} => {
    if (!shift) return { x: wx, y: wy, ref: null };
    let ref: PlacedDevice|undefined;
    for (let i = placedDevices.length - 1; i >= 0; i--) {
      if (placedDevices[i].id === itemId) { ref = placedDevices[i]; break; }
    }
    if (!ref) return { x: wx, y: wy, ref: null };
    return Math.abs(wx - ref.x) >= Math.abs(wy - ref.y)
      ? { x: wx, y: ref.y, ref: { x: ref.x, y: ref.y } }
      : { x: ref.x, y: wy, ref: { x: ref.x, y: ref.y } };
  };

  // New table drag from sidebar
  const handleNewTableDrag = (e: React.MouseEvent) => {
    if (!dragNewTable?.active) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const wx = Math.max(cMinX, Math.min(cMaxX, (svgP.x - planOffX) / planScale));
    const wy = Math.max(cMinY, Math.min(cMaxY, (svgP.y - planOffY) / planScale));
    const aligned = alignToLastPlaced(wx, wy, "conf-table", e.shiftKey);
    setDragNewTable({ active: true, worldX: aligned.x, worldY: aligned.y, alignRef: aligned.ref });
  };
  const handleNewTableDrop = () => {
    if (!dragNewTable?.active) return;
    pushUndo();
    const tableItem = roomElementItems.find(i => i.id === "conf-table")!;
    const id = Date.now();
    setPlacedDevices(prev => [...prev, { ...tableItem, w: 4, h: 8, uid: id, x: dragNewTable.worldX, y: dragNewTable.worldY, z: 0, mountWall: "floor" }]);
  };

  // New chair drag from sidebar
  const handleNewChairDrag = (e: React.MouseEvent) => {
    if (!dragNewChair?.active) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const wx = Math.max(cMinX, Math.min(cMaxX, (svgP.x - planOffX) / planScale));
    const wy = Math.max(cMinY, Math.min(cMaxY, (svgP.y - planOffY) / planScale));
    const aligned = alignToLastPlaced(wx, wy, "side-chair", e.shiftKey);
    setDragNewChair({ active: true, worldX: aligned.x, worldY: aligned.y, alignRef: aligned.ref });
  };
  const handleNewChairDrop = () => {
    if (!dragNewChair?.active) return;
    pushUndo();
    const chairItem = roomElementItems.find(i => i.id === "side-chair")!;
    const id = Date.now();
    setPlacedDevices(prev => [...prev, { ...chairItem, uid: id, x: dragNewChair.worldX, y: dragNewChair.worldY, z: 0, mountWall: "floor" }]);
  };

  // New device drag from sidebar
  const handleNewDeviceDrag = (e: React.MouseEvent) => {
    if (!dragNewDevice?.active) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const wx = (svgP.x - planOffX) / planScale;
    const wy = (svgP.y - planOffY) / planScale;
    const item = dragNewDevice.item;
    // Wall-mounted devices snap to nearest wall
    if (item.wall === "front" || item.wall === "side") {
      const snapped = snapToWall(wx, wy);
      const wall = snapped.wall === "drawn" ? null : snapped.wall;
      setDragNewDevice(prev => prev ? { ...prev, worldX: wx, worldY: wy, wall } : null);
    } else {
      // Floor/ceiling devices follow cursor freely
      const cx = Math.max(0.1, Math.min(roomW - 0.1, wx));
      const cy = Math.max(0.1, Math.min(roomL - 0.1, wy));
      setDragNewDevice(prev => prev ? { ...prev, worldX: cx, worldY: cy } : null);
    }
  };
  const handleNewDeviceDrop = () => {
    if (!dragNewDevice?.active) return;
    pushUndo();
    const item = dragNewDevice.item;
    const id = Date.now();
    let x = dragNewDevice.worldX, y = dragNewDevice.worldY, z = 0;
    let mountWall = "floor";
    let rotation: number|undefined, wallUid: number|undefined;
    if (item.wall === "front" || item.wall === "side") {
      const snap = snapDeviceToNearestWall(x, y);
      if (snap) { x = snap.x; y = snap.y; z = roomH * 0.55; mountWall = snap.mountWall; rotation = snap.angleDeg; wallUid = snap.wallUid; }
      else {
        const wall = dragNewDevice.wall || "north";
        mountWall = wall;
        if (wall === "north") { y = 0.02; z = roomH * 0.55; }
        else if (wall === "south") { y = roomL - 0.02; z = roomH * 0.55; }
        else if (wall === "west") { x = 0.02; z = roomH * 0.55; rotation = 90; }
        else if (wall === "east") { x = roomW - 0.02; z = roomH * 0.55; rotation = 90; }
      }
    } else if (item.wall === "ceiling") {
      z = roomH - 0.05; mountWall = "ceiling";
    } else if (item.wall === "table") {
      z = 0.76; mountWall = "floor";
    }
    const hfov = item.type === "camera" ? (item.id === "soundbar-cam" ? 120 : item.id === "ceiling-cam" ? 90 : 70) : undefined;
    const covShape = (item.type === "mic" && item.wall === "ceiling") ? "round" as const : undefined;
    const covDiameter = (item.type === "mic" && item.wall === "ceiling") ? 6 : item.id === "table-mic" ? 2 : undefined;
    const covW = (item.type === "mic" && item.wall === "ceiling") ? 6 : undefined;
    const covL = (item.type === "mic" && item.wall === "ceiling") ? 6 : undefined;
    const dispersion = (item.type === "speaker" && item.wall === "ceiling") ? 90 : undefined;
    setPlacedDevices(prev => [...prev, { ...item, itemId: item.itemId || newItemId(), uid: id, x, y, z, mountWall, rotation, wallUid, hfov, covShape, covDiameter, covW, covL, dispersion }]);
    setDragNewDevice(null);
  };

  // Free-angle rotation drag handlers
  const handleRotDragStart = (uid: number, centerSvgX: number, centerSvgY: number, e: React.MouseEvent) => {
    e.stopPropagation();
    pushUndo();
    setRotDragUid(uid);
    setRotDragCenter({ x: centerSvgX, y: centerSvgY });
  };
  const handleRotDragMove = (e: React.MouseEvent) => {
    if (!rotDragUid || !rotDragCenter) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const angle = Math.atan2(svgP.y - rotDragCenter.y, svgP.x - rotDragCenter.x) * (180 / Math.PI) + 90;
    setPlacedDevices(prev => prev.map(d => d.uid === rotDragUid ? { ...d, rotation: ((angle % 360) + 360) % 360 } : d));
  };
  const handleTableRotDragStart = (centerSvgX: number, centerSvgY: number, e: React.MouseEvent) => {
    e.stopPropagation();
    pushUndo();
    setRotatingTable(true);
    setTableRotCenter({ x: centerSvgX, y: centerSvgY });
  };
  const handleTableRotDragMove = (e: React.MouseEvent) => {
    if (!rotatingTable || !tableRotCenter) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const angle = Math.atan2(svgP.y - tableRotCenter.y, svgP.x - tableRotCenter.x) * (180 / Math.PI) + 90;
    setTableRotation(((angle % 360) + 360) % 360);
  };

  // Multi-item drag handler — moves all selected items together
  const handleMultiDragStart = (triggerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (annotate.activeTool) { annotate.handleDown(e); return; } // Annotation tools draw over table/chairs
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    // Ctrl+click on something already selected takes it back out of the
    // selection (mousedown starts a drag, so the click handler can't do this).
    if ((e.ctrlKey || e.metaKey) && selected.has(triggerId)) {
      const next = new Set(selected);
      next.delete(triggerId);
      setSelected(next);
      dragStartedRef.current = true; // swallow the click that follows this mousedown
      return;
    }
    pushUndo();
    // Build the set of items to drag
    let items: Set<string>;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+mouseDown: add to selection, drag all selected
      items = new Set(selected);
      items.add(triggerId);
    } else if (selected.has(triggerId)) {
      // Already selected, drag all selected together
      items = new Set(selected);
    } else {
      // Not selected, no Ctrl: select only this item
      items = new Set([triggerId]);
    }
    setSelected(items);
    dragStartedRef.current = true;
    setMultiDrag({
      startSvgX: svgP.x, startSvgY: svgP.y,
      origTableCX: tableCenterX ?? roomW/2,
      origWallDist: tableWallDist,
      origChairOffsets: {...chairOffsets},
      items,
      // Placed devices that are part of the same selection travel with it
      origDevs: placedDevices.filter(d => selectedUids.has(d.uid)).map(d => ({ uid: d.uid, x: d.x, y: d.y })),
    });
  };
  const handleMultiDragMove = (e: React.MouseEvent) => {
    if (!multiDrag) return;
    const svg = svgRef.current; if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const dx = (svgP.x - multiDrag.startSvgX) / planScale;
    const dy = (svgP.y - multiDrag.startSvgY) / planScale;
    const { items } = multiDrag;
    const hasTable = items.has("table");

    // Move table if selected
    if (hasTable) {
      const newCX = Math.max(tW/2 + 0.1, Math.min(roomW - tW/2 - 0.1, multiDrag.origTableCX + dx));
      const newWD = Math.max(0.1, Math.min(roomL - tL - 0.1, multiDrag.origWallDist + dy));
      setTableCenterX(newCX);
      setTableWallDist(newWD);
      // Compensate unselected chairs so they don't move with table
      const actualDx = newCX - multiDrag.origTableCX;
      const actualDy = newWD - multiDrag.origWallDist;
      const newOffsets = {...multiDrag.origChairOffsets};
      const totalChairs = tableSeats + 2;
      for (let i = 0; i < totalChairs; i++) {
        const orig = multiDrag.origChairOffsets[i] || { dx: 0, dy: 0 };
        if (items.has(`chair:${i}`)) {
          // Selected chair moves with table + its own delta
          newOffsets[i] = { dx: orig.dx + dx - actualDx, dy: orig.dy + dy - actualDy };
        } else {
          // Unselected chair compensates for table movement
          newOffsets[i] = { dx: orig.dx - actualDx, dy: orig.dy - actualDy };
        }
      }
      setChairOffsets(newOffsets);
    } else {
      // Only chairs selected (no table)
      const newOffsets = {...multiDrag.origChairOffsets};
      items.forEach(id => {
        if (id.startsWith("chair:")) {
          const idx = parseInt(id.split(":")[1]);
          const orig = multiDrag.origChairOffsets[idx] || { dx: 0, dy: 0 };
          newOffsets[idx] = { dx: orig.dx + dx, dy: orig.dy + dy };
        }
      });
      setChairOffsets(newOffsets);
    }
    if (multiDrag.origDevs.length > 0) {
      const orig = new Map(multiDrag.origDevs.map(d => [d.uid, d]));
      setPlacedDevices(prev => prev.map(d => {
        const o = orig.get(d.uid);
        return o ? { ...d, x: Math.max(cMinX, Math.min(cMaxX, o.x + dx)), y: Math.max(cMinY, Math.min(cMaxY, o.y + dy)) } : d;
      }));
    }
  };

  // Convert screen mouse event to world coords on the floor plan
  const screenToWorld = (e: React.MouseEvent): {x:number;y:number}|null => {
    const svg = svgRef.current; if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const wx = (svgP.x - planOffX) / planScale;
    const wy = (svgP.y - planOffY) / planScale;
    return {x: wx, y: wy};
  };

  const handleWallClick = (e: React.MouseEvent) => {
    if (!isDrawingWall) return;

    // If scaling floor plan, handle scale reference clicks (no tracking)
    if (isScalingFloorPlan) {
      let refPos = screenToWorld(e);
      if (!refPos) return;
      refPos = snapToGrid(refPos);
      const p = refPos;
      setScaleRefPoints(prev => {
        const next = [...prev, p];
        return next.length > 2 ? [p] : next;
      });
      return;
    }

    const resolved = computeWallCursorPos(e);
    if (!resolved) return;
    const pos = resolved.pos;

    // Check snap to first point to close polygon
    if (wallPoints.length >= 2) {
      const first = wallPoints[0];
      const dx = pos.x - first.x;
      const dy = pos.y - first.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < WALL_SNAP_DIST) {
        // Close polygon — create wall segments for all points
        const closed = [...wallPoints, first];
        createWallSegments(closed);
        setWallPoints([]);
        setWallMousePos(null);
        setWallSnapPoint(null);
        setTrackGuides([]);
        setIsDrawingWall(false);
        return;
      }
    }

    // Add point — also create a wall segment from last point to this one
    if (wallPoints.length > 0) {
      const last = wallPoints[wallPoints.length - 1];
      createWallSegment(last, pos);
    }
    setWallPoints(prev => [...prev, pos]);
  };

  const createWallSegment = (from: {x:number;y:number}, to: {x:number;y:number}) => {
    pushUndo();
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 0.05) return;
    const cx = (from.x + to.x) / 2;
    const cy = (from.y + to.y) / 2;
    const angle = Math.atan2(dy, dx);
    const id = Date.now() + Math.random();
    setPlacedDevices(prev => [...prev, {
      id: "wall-partition", name: drawingWallType === "glass" ? "Glass Wall" : drawingWallType === "solid" ? "Solid Wall" : "Drywall", icon: "🧱",
      w: len, h: drawingWallType === "solid" ? 0.3 : 0.15, wall: "floor", type: "furniture", color: drawingWallType === "solid" ? "#475569" : "rgb(var(--text-subtle))",
      uid: id, x: cx, y: cy, z: 0, mountWall: "floor",
      wallAngle: angle, wallType: drawingWallType,
    } as PlacedDevice]);
  };

  const createWallSegments = (points: {x:number;y:number}[]) => {
    for (let i = 0; i < points.length - 1; i++) {
      // Skip if segment was already created incrementally — only close the last one
      if (i === points.length - 2) {
        createWallSegment(points[i], points[i + 1]);
      }
    }
  };

  const cancelWallDrawing = () => {
    setIsDrawingWall(false);
    setWallPoints([]);
    setWallMousePos(null);
    setWallSnapPoint(null);
    setWallLengthInput("");
    setTrackGuides([]);
  };

  const startWallDrawing = (wallType: "drywall"|"glass"|"solid") => {
    setDragNewDoor(null);
    setDragNewTable(null);
    setDragNewChair(null);
    setDrawingWallType(wallType);
    setIsDrawingWall(true);
    setWallPoints([]);
    setWallMousePos(null);
  };

  const handleWallInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.nativeEvent.stopPropagation();
      const meters = parseFtIn(wallLengthInput);
      if (meters !== null && meters > 0.05 && wallPoints.length > 0) {
        const last = wallPoints[wallPoints.length - 1];
        let angle = wallMousePos ? Math.atan2(wallMousePos.y - last.y, wallMousePos.x - last.x) : 0;
        if (orthoMode) {
          angle = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
        } else {
          const snap45 = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          if (Math.abs(angle - snap45) < 0.05) angle = snap45;
        }
        const to = snapToGrid({ x: last.x + Math.cos(angle) * meters, y: last.y + Math.sin(angle) * meters });
        createWallSegment(last, to);
        setWallPoints(prev => [...prev, to]);
        setWallMousePos(to);
        setWallLengthInput("");
      }
    } else if (e.key === "Escape") {
      if (wallLengthInput) {
        setWallLengthInput("");
        e.nativeEvent.stopPropagation();
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.nativeEvent.stopPropagation();
    }
  };

  const snapToAxis = (from: {x:number;y:number}, to: {x:number;y:number}): {x:number;y:number} => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const dist = Math.sqrt(dx*dx + dy*dy);
    return { x: from.x + Math.cos(snapped) * dist, y: from.y + Math.sin(snapped) * dist };
  };

  // Endpoints of every drawn wall segment plus the room's perimeter corners —
  // the points the cursor can snap onto or track against.
  const getWallEndpointRefs = (excludeUid?: number): {x:number;y:number}[] => {
    const refs: {x:number;y:number}[] = [];
    placedDevices.forEach(d => {
      if (d.uid !== excludeUid && d.id === "wall-partition" && d.wallAngle !== undefined) {
        const hx = Math.cos(d.wallAngle) * d.w / 2;
        const hy = Math.sin(d.wallAngle) * d.w / 2;
        refs.push({ x: d.x - hx, y: d.y - hy }, { x: d.x + hx, y: d.y + hy });
      }
    });
    if (!isCustomBlank) {
      refs.push({ x: 0, y: 0 }, { x: roomW, y: 0 }, { x: 0, y: roomL }, { x: roomW, y: roomL });
    }
    return refs;
  };

  // Endpoint snap (AutoCAD-style osnap): lock the cursor onto the nearest wall
  // endpoint / room corner within tolerance. Overrides grid snap, ortho and tracking.
  const findEndpointSnap = (pos: {x:number;y:number}, excludeUid?: number): {x:number;y:number}|null => {
    const last = wallPoints.length > 0 ? wallPoints[wallPoints.length - 1] : null;
    let best: {x:number;y:number}|null = null;
    let bestDist = ENDPOINT_SNAP_DIST;
    for (const r of [...getWallEndpointRefs(excludeUid), ...wallPoints.slice(0, -1)]) {
      // Never snap back onto the segment's own start point — it would make a zero-length wall
      if (last && Math.abs(r.x - last.x) < 1e-9 && Math.abs(r.y - last.y) < 1e-9) continue;
      const d = Math.hypot(pos.x - r.x, pos.y - r.y);
      if (d < bestDist) { bestDist = d; best = r; }
    }
    return best;
  };

  // Object snap tracking (AutoCAD-style): reference points the cursor can align with —
  // vertices of the polyline being drawn plus endpoints of already-drawn wall segments
  const getTrackingRefs = (): {x:number;y:number}[] => [...wallPoints, ...getWallEndpointRefs()];

  // Snap pos onto the X and/or Y of the nearest aligned reference point.
  // lockX/lockY exclude an axis already fixed by ortho mode.
  const applySnapTracking = (
    pos: {x:number;y:number},
    opts: { lockX?: boolean; lockY?: boolean; refs?: {x:number;y:number}[] } = {},
  ): { pos: {x:number;y:number}; guides: {from:{x:number;y:number};to:{x:number;y:number}}[] } => {
    const refs = opts.refs ?? getTrackingRefs();
    let bestX: {x:number;y:number}|null = null;
    let bestY: {x:number;y:number}|null = null;
    for (const r of refs) {
      if (!opts.lockX && Math.abs(pos.x - r.x) < TRACK_SNAP_DIST && (!bestX || Math.abs(pos.x - r.x) < Math.abs(pos.x - bestX.x))) bestX = r;
      if (!opts.lockY && Math.abs(pos.y - r.y) < TRACK_SNAP_DIST && (!bestY || Math.abs(pos.y - r.y) < Math.abs(pos.y - bestY.y))) bestY = r;
    }
    const out = { x: bestX ? bestX.x : pos.x, y: bestY ? bestY.y : pos.y };
    const guides: {from:{x:number;y:number};to:{x:number;y:number}}[] = [];
    if (bestX) guides.push({ from: bestX, to: out });
    if (bestY && bestY !== bestX) guides.push({ from: bestY, to: out });
    return { pos: out, guides };
  };

  // Resolve the effective wall-drawing cursor position: grid snap → ortho constraint →
  // object snap tracking. Shared by mouse-move (preview) and click (commit) so they agree.
  const computeWallCursorPos = (e: React.MouseEvent): { pos: {x:number;y:number}; guides: {from:{x:number;y:number};to:{x:number;y:number}}[]; endpointSnap?: boolean } | null => {
    let pos = screenToWorld(e);
    if (!pos) return null;
    const endpoint = findEndpointSnap(pos);
    if (endpoint) return { pos: endpoint, guides: [], endpointSnap: true };
    pos = snapToGrid(pos);
    let lockX = false, lockY = false, skipTracking = false;
    if (wallPoints.length > 0 && (orthoMode || e.shiftKey)) {
      const last = wallPoints[wallPoints.length - 1];
      const dx = pos.x - last.x, dy = pos.y - last.y;
      const angle = Math.atan2(dy, dx);
      const snapped = orthoMode
        ? Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)
        : Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const dist = Math.sqrt(dx*dx + dy*dy);
      pos = { x: last.x + Math.cos(snapped) * dist, y: last.y + Math.sin(snapped) * dist };
      const horizontal = Math.abs(Math.sin(snapped)) < 1e-9;
      const vertical = Math.abs(Math.cos(snapped)) < 1e-9;
      if (horizontal) { pos.y = last.y; lockY = true; }
      else if (vertical) { pos.x = last.x; lockX = true; }
      else skipTracking = true; // 45° segment — tracking would break the constraint
    }
    if (skipTracking) return { pos, guides: [] };
    const tracked = applySnapTracking(pos, { lockX, lockY });
    // Don't draw a guide back to the segment's own start point — the rubber line already shows it
    const last = wallPoints.length > 0 ? wallPoints[wallPoints.length - 1] : null;
    const guides = last
      ? tracked.guides.filter(g => Math.abs(g.from.x - last.x) > 1e-9 || Math.abs(g.from.y - last.y) > 1e-9)
      : tracked.guides;
    return { pos: tracked.pos, guides };
  };

  // Stretch a drawn wall by dragging one of its endpoints; the other endpoint stays fixed.
  // Grid snap + object snap tracking apply; Shift constrains to 90°/45° from the fixed end.
  const handleWallStretchMove = (e: React.MouseEvent) => {
    if (!wallStretchDrag) return;
    const dev = placedDevices.find(d => d.uid === wallStretchDrag.uid);
    if (!dev || dev.wallAngle === undefined) return;
    let pos = screenToWorld(e);
    if (!pos) return;
    const half = dev.w / 2;
    const e0 = { x: dev.x - Math.cos(dev.wallAngle) * half, y: dev.y - Math.sin(dev.wallAngle) * half };
    const e1 = { x: dev.x + Math.cos(dev.wallAngle) * half, y: dev.y + Math.sin(dev.wallAngle) * half };
    const fixed = wallStretchDrag.end === 0 ? e1 : e0;
    const endpoint = findEndpointSnap(pos, dev.uid);
    if (endpoint) {
      setWallSnapPoint(endpoint);
      setTrackGuides([]);
      const sdx = endpoint.x - fixed.x, sdy = endpoint.y - fixed.y;
      const slen = Math.sqrt(sdx*sdx + sdy*sdy);
      if (slen < 0.1) return;
      const sAngle = wallStretchDrag.end === 0
        ? Math.atan2(fixed.y - endpoint.y, fixed.x - endpoint.x)
        : Math.atan2(endpoint.y - fixed.y, endpoint.x - fixed.x);
      setPlacedDevices(prev => prev.map(d => d.uid === dev.uid ? { ...d, x: (endpoint.x + fixed.x) / 2, y: (endpoint.y + fixed.y) / 2, w: slen, wallAngle: sAngle } : d));
      return;
    }
    setWallSnapPoint(null);
    pos = snapToGrid(pos);
    let lockX = false, lockY = false, skipTracking = false;
    if (e.shiftKey) {
      pos = snapToGrid(snapToAxis(fixed, pos));
      const a = Math.atan2(pos.y - fixed.y, pos.x - fixed.x);
      const horizontal = Math.abs(Math.sin(a)) < 1e-9;
      const vertical = Math.abs(Math.cos(a)) < 1e-9;
      if (horizontal) { pos.y = fixed.y; lockY = true; }
      else if (vertical) { pos.x = fixed.x; lockX = true; }
      else skipTracking = true;
    }
    if (!skipTracking) {
      // Track against the fixed endpoint and every other wall's endpoints — not the moving end itself
      const refs: {x:number;y:number}[] = [fixed];
      placedDevices.forEach(d => {
        if (d.uid !== dev.uid && d.id === "wall-partition" && d.wallAngle !== undefined) {
          const hx = Math.cos(d.wallAngle) * d.w / 2;
          const hy = Math.sin(d.wallAngle) * d.w / 2;
          refs.push({ x: d.x - hx, y: d.y - hy }, { x: d.x + hx, y: d.y + hy });
        }
      });
      const tracked = applySnapTracking(pos, { lockX, lockY, refs });
      pos = tracked.pos;
      setTrackGuides(tracked.guides);
    } else {
      setTrackGuides([]);
    }
    const dx = pos.x - fixed.x, dy = pos.y - fixed.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 0.1) return; // don't let the wall collapse to nothing
    const angle = wallStretchDrag.end === 0
      ? Math.atan2(fixed.y - pos.y, fixed.x - pos.x)
      : Math.atan2(pos.y - fixed.y, pos.x - fixed.x);
    const cx = (pos.x + fixed.x) / 2, cy = (pos.y + fixed.y) / 2;
    setPlacedDevices(prev => prev.map(d => d.uid === dev.uid ? { ...d, x: cx, y: cy, w: len, wallAngle: angle } : d));
  };

  // Set an exact wall length while keeping the wall's original start point fixed.
  // The end point therefore moves in the direction the wall was originally drawn.
  const commitWallLengthEdit = (closeOnInvalid = false) => {
    if (editingWallUid === null) return;
    const newLength = parseFtIn(editWallLength);
    const dev = placedDevices.find(d => d.uid === editingWallUid);
    if (!dev || dev.wallAngle === undefined || newLength === null || newLength < 0.1) {
      if (closeOnInvalid) {
        setEditingWallUid(null);
        setEditWallLength("");
      }
      return;
    }
    const startX = dev.x - Math.cos(dev.wallAngle) * dev.w / 2;
    const startY = dev.y - Math.sin(dev.wallAngle) * dev.w / 2;
    const endX = startX + Math.cos(dev.wallAngle) * newLength;
    const endY = startY + Math.sin(dev.wallAngle) * newLength;
    pushUndo();
    setPlacedDevices(prev => prev.map(d => d.uid === editingWallUid
      ? { ...d, x: (startX + endX) / 2, y: (startY + endY) / 2, w: newLength }
      : d));
    setEditingWallUid(null);
    setEditWallLength("");
  };

  useEffect(() => {
    if (editingWallUid === null) return;
    requestAnimationFrame(() => {
      editWallInputRef.current?.focus();
      editWallInputRef.current?.select();
    });
  }, [editingWallUid]);

  const handleWallMouseMove = (e: React.MouseEvent) => {
    if (isDrawingWall && canvasContainerRef.current) {
      const rect = canvasContainerRef.current.getBoundingClientRect();
      setCursorScreenPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (!isDrawingWall || isScalingFloorPlan) return;
    const resolved = computeWallCursorPos(e);
    if (!resolved) return;
    setWallSnapPoint(resolved.endpointSnap ? resolved.pos : null);
    if (wallPoints.length === 0) return;
    setWallMousePos(resolved.pos);
    setTrackGuides(resolved.guides);
  };

  // Keyboard handler for wall drawing escape + wall edge delete
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Any focused text input should suppress the app-level Delete/Backspace
      // shortcut below — not just the one wall-length input this used to
      // check for. Without this, typing into e.g. the camera rotate popup
      // (backspacing the default "0" before typing a real angle) fell
      // through to "no input is focused" and deleted the selected device
      // instead of editing the text field.
      const activeEl = document.activeElement as HTMLElement | null;
      const isInputFocused = activeEl === wallInputRef.current
        || activeEl?.tagName === "INPUT" || activeEl?.tagName === "TEXTAREA" || !!activeEl?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        popUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        const fromDevices = selectedUids.size > 0
          ? placedDevices.filter(d => selectedUids.has(d.uid))
          : selectedUid !== null ? placedDevices.filter(d => d.uid === selectedUid) : [];
        // The room's built-in table and chairs are copied as ordinary placed
        // furniture, so a copy of them is independent of the original.
        const clip = [...fromDevices, ...copyBuiltInRef.current()];
        if (clip.length > 0) setClipboard(clip);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        if (clipboard.length > 0) {
          pushUndo();
          const base = Date.now();
          const pasted = clipboard.map((d, i) => ({
            ...d,
            // A pasted device is a new physical unit — reusing the original's
            // itemId made the pair indistinguishable in the BOM and manifest.
            ...(d.itemId ? { itemId: newItemId() } : {}),
            uid: base + i,
            x: d.x + 0.3,
            y: d.y + 0.3,
          }));
          setPlacedDevices(prev => [...prev, ...pasted]);
          // Drop any table/chair selection, or dragging the pasted group would
          // drag the original built-in table along with it.
          setSelected(new Set());
          if (pasted.length === 1) {
            setSelectedUid(pasted[0].uid);
            setSelectedUids(new Set());
          } else {
            setSelectedUids(new Set(pasted.map(d => d.uid)));
            setSelectedUid(null);
          }
        }
        return;
      }
      if (e.key === "F8" && isDrawingWall) {
        e.preventDefault();
        setOrthoMode(v => !v);
        return;
      }
      if (e.key === "Escape" && moveMode) {
        setMoveMode(false);
        setMoveDragStart(null);
        return;
      }
      if (e.key === "Escape" && panMode) {
        setPanMode(false);
        return;
      }
      if (e.key === "Escape" && isDrawingWall) {
        cancelWallDrawing();
      }
      if (e.key === "Escape" && (dragNewChair?.active || dragNewTable?.active || dragNewDoor?.active)) {
        setDragNewChair(null);
        setDragNewTable(null);
        setDragNewDoor(null);
      }
      if (e.key === "Escape" && (selectedEdge || selected.size > 0)) {
        setSelectedEdge(null);
        clearSelection();
      }
      if (isInputFocused) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size > 0) {
        pushUndo();
        selected.forEach(id => {
          if (id.startsWith("chair:")) {
            const idx = parseInt(id.split(":")[1]);
            setDeletedChairs(prev => { const next = new Set(prev); next.add(idx); return next; });
          } else if (id === "table") {
            setTableDeleted(true);
          } else if (id.startsWith("door:")) {
            const doorId = parseInt(id.split(":")[1]);
            setPlacedDoors(prev => prev.filter(d => d.id !== doorId));
          }
        });
        clearSelection();
      }
      // Delete the selected device(s) — one selected, or a marquee / Ctrl+click
      // group. Equipment asks first (it is removed from every tool); walls and
      // furniture go straight away. Doors attached to a deleted wall go too.
      if ((e.key === "Delete" || e.key === "Backspace") && (selectedUid || selectedUids.size > 0)) {
        const uids = new Set<number>(selectedUids);
        if (selectedUid) uids.add(selectedUid);
        requestDeleteRef.current(Array.from(uids));
      }
      // Rotate selected furniture by 90 degrees
      if (e.key === "r" && selectedUid && !e.ctrlKey && !e.metaKey) {
        pushUndo();
        setPlacedDevices(prev => prev.map(d => d.uid === selectedUid ? { ...d, rotation: ((d.rotation || 0) + 90) % 360 } : d));
      }
      // Arrow key nudge — single or multi selected devices, table, chairs
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && (selectedUid !== null || selectedUids.size > 0 || selected.size > 0) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 0.05;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
        pushUndo();
        if (selectedUid !== null || selectedUids.size > 0) {
          setPlacedDevices(prev => prev.map(d => {
            const hit = selectedUid !== null ? d.uid === selectedUid : selectedUids.has(d.uid);
            if (!hit) return d;
            return { ...d, x: d.x + dx, y: d.y + dy };
          }));
        }
        if (selected.has("table")) {
          setTableCenterX(prev => (prev ?? roomW / 2) + dx);
          setTableWallDist(prev => prev + dy);
        }
        selected.forEach(id => {
          if (id.startsWith("chair:")) {
            const idx = parseInt(id.split(":")[1]);
            setChairOffsets(prev => ({
              ...prev,
              [idx]: { dx: (prev[idx]?.dx ?? 0) + dx, dy: (prev[idx]?.dy ?? 0) + dy },
            }));
          }
        });
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge) {
        pushUndo();
        setDeletedWalls(prev => {
          const next = new Set(prev);
          if (next.has(selectedEdge)) {
            next.delete(selectedEdge);
          } else {
            next.add(selectedEdge);
          }
          return next;
        });
        setSelectedEdge(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawingWall, selectedEdge, selected, selectedUid, selectedUids, dragNewChair, dragNewTable, dragNewDoor, clipboard, placedDevices, roomW, roomL, panMode, moveMode]);

  React.useEffect(() => {
    if (isDrawingWall && wallPoints.length > 0) {
      setTimeout(() => wallInputRef.current?.focus(), 0);
    }
  }, [isDrawingWall, wallPoints.length]);

  // Floor plan import handler — accepts a photo/scan (jpg/png, used as-is),
  // a PDF (rendered to a flat image via pdfjs-dist, first page only), or a
  // DXF/AutoCAD export (its LINE/LWPOLYLINE/CIRCLE/ARC geometry rasterized
  // to a flat image — see lib/dxf-import.ts for why this doesn't try to stay
  // vector, or trust the file's own units). All three end up as the exact
  // same floorPlanImg background, calibrated the same way afterward via
  // "Set Scale" — a DXF/PDF's nominal scale is never assumed correct.
  const [floorPlanImportError, setFloorPlanImportError] = useState<string | null>(null);
  const handleFloorPlanUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFloorPlanImportError(null);
    const applyBackground = (dataUrl: string) => {
      setFloorPlanImg(dataUrl);
      setFloorPlanWidthFt(roomW); // default: fill the room's current width, until calibrated
      setFloorPlanOffset({x: 0, y: 0});
      setIsScalingFloorPlan(false);
      setScaleRefPoints([]); setScaleRefLength(""); setScaleRefInches("");
    };
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "dxf") {
      file.text()
        .then(text => {
          const dataUrl = dxfToBackgroundImage(text);
          if (!dataUrl) { setFloorPlanImportError("No supported geometry (lines, polylines, circles, or arcs) found in this DXF file."); return; }
          applyBackground(dataUrl);
        })
        .catch(() => setFloorPlanImportError("Couldn't read this DXF file."));
    } else if (ext === "pdf") {
      pdfToBackgroundImage(file)
        .then(applyBackground)
        .catch(() => setFloorPlanImportError("Couldn't render this PDF file."));
    } else {
      const reader = new FileReader();
      reader.onload = () => applyBackground(reader.result as string);
      reader.onerror = () => setFloorPlanImportError("Couldn't read this image file.");
      reader.readAsDataURL(file);
    }
    e.target.value = ""; // allow re-selecting the same file after an error
  };

  // Converts whatever unit the user picked (feet, architectural feet+inches,
  // plain inches, or millimeters) to inches — the one unit everything below
  // actually computes in, since that's what the equipment library's own
  // dimensions use. Returns null for an incomplete/invalid entry rather than
  // silently treating it as zero.
  const scaleRefToInches = (): number | null => {
    if (scaleRefUnit === "ft-in") {
      const ft = parseFloat(scaleRefLength), inch = parseFloat(scaleRefInches) || 0;
      if (!Number.isFinite(ft) && !(inch > 0)) return null;
      return (Number.isFinite(ft) ? ft : 0) * 12 + inch;
    }
    const v = parseFloat(scaleRefLength);
    if (!Number.isFinite(v)) return null;
    if (scaleRefUnit === "ft") return v * 12;
    if (scaleRefUnit === "mm") return v / 25.4;
    return v; // "in"
  };

  // Bluebeam-style calibration: the two clicked points already mark a known
  // real-world distance on the (possibly currently-mis-sized) drawing —
  // screenToWorld already resolved them to feet using the room's own
  // coordinate mapping, which is exactly how far apart they currently
  // render, so the fix is just "how far off was that guess": rescale the
  // image's whole real-world width by the ratio of true-to-measured
  // distance, which stays correct regardless of what the width happened to
  // be guessed at before (an arbitrary default, or an earlier calibration).
  const applyScaleReference = () => {
    if (scaleRefPoints.length !== 2) return;
    const realDistIn = scaleRefToInches();
    if (realDistIn === null || realDistIn <= 0) return;
    const dx = scaleRefPoints[1].x - scaleRefPoints[0].x;
    const dy = scaleRefPoints[1].y - scaleRefPoints[0].y;
    const currentDistFt = Math.hypot(dx, dy);
    const realDistFt = realDistIn / 12;
    if (currentDistFt > 0) {
      setFloorPlanWidthFt(prev => Math.max(0.1, prev * (realDistFt / currentDistFt)));
    }
    setIsScalingFloorPlan(false);
    setScaleRefPoints([]);
    setScaleRefLength("");
    setScaleRefInches("");
  };

  // Isometric chair renderer (needs sX/sY closure)
  const renderChair = (cx: number, cy: number, backDir: string) => {
    const legW=0.43, seatZ=1.48, backZ=2.69;
    const corners: [number,number][] = [[cx-legW,cy-legW],[cx+legW,cy-legW],[cx+legW,cy+legW],[cx-legW,cy+legW]];
    const backCorners = backDir==="up"?[0,1]:backDir==="down"?[2,3]:backDir==="left"?[0,3]:[1,2];
    const seatPts = corners.map(c=>`${sX(c[0],c[1],seatZ)},${sY(c[0],c[1],seatZ)}`).join(" ");
    const seatEdgePts = [
      `${sX(corners[2][0],corners[2][1],seatZ-0.02)},${sY(corners[2][0],corners[2][1],seatZ-0.02)}`,
      `${sX(corners[3][0],corners[3][1],seatZ-0.02)},${sY(corners[3][0],corners[3][1],seatZ-0.02)}`,
      `${sX(corners[3][0],corners[3][1],seatZ)},${sY(corners[3][0],corners[3][1],seatZ)}`,
      `${sX(corners[2][0],corners[2][1],seatZ)},${sY(corners[2][0],corners[2][1],seatZ)}`,
    ].join(" ");
    const bc0=corners[backCorners[0]], bc1=corners[backCorners[1]];
    const backPts = [
      `${sX(bc0[0],bc0[1],backZ)},${sY(bc0[0],bc0[1],backZ)}`,
      `${sX(bc1[0],bc1[1],backZ)},${sY(bc1[0],bc1[1],backZ)}`,
      `${sX(bc1[0],bc1[1],seatZ+0.04)},${sY(bc1[0],bc1[1],seatZ+0.04)}`,
      `${sX(bc0[0],bc0[1],seatZ+0.04)},${sY(bc0[0],bc0[1],seatZ+0.04)}`,
    ].join(" ");
    return (
      <g>
        <ellipse cx={sX(cx,cy,0)} cy={sY(cx,cy,0)+2} rx={6} ry={3.5} fill="#000" opacity={0.07}/>
        {corners.map((c,i)=>(
          <line key={i} x1={sX(c[0],c[1],0)} y1={sY(c[0],c[1],0)} x2={sX(c[0],c[1],seatZ)} y2={sY(c[0],c[1],seatZ)} stroke="#d1d5db" strokeWidth={1.8} strokeLinecap="round"/>
        ))}
        <line x1={sX(bc0[0],bc0[1],seatZ)} y1={sY(bc0[0],bc0[1],seatZ)} x2={sX(bc0[0],bc0[1],backZ)} y2={sY(bc0[0],bc0[1],backZ)} stroke="#d1d5db" strokeWidth={1.8} strokeLinecap="round"/>
        <line x1={sX(bc1[0],bc1[1],seatZ)} y1={sY(bc1[0],bc1[1],seatZ)} x2={sX(bc1[0],bc1[1],backZ)} y2={sY(bc1[0],bc1[1],backZ)} stroke="#d1d5db" strokeWidth={1.8} strokeLinecap="round"/>
        <polygon points={seatEdgePts} fill="#b0b8c4" stroke="#cbd5e1" strokeWidth={0.3}/>
        <polygon points={seatPts} fill="#e5e7eb" stroke="#d1d5db" strokeWidth={0.8}/>
        <polygon points={backPts} fill="#dde1e7" stroke="#cbd5e1" strokeWidth={0.6}/>
      </g>
    );
  };

  // ── Step 1: Room Setup Landing ────────────────────────────────────────────────
  if (step === 1) {
    const applySurveyRoom = (roomId: string) => {
      const r = surveyRooms.find(s => s.id === roomId);
      if (!r) return;
      if (r.width > 0) setRoomW(r.width);
      if (r.length > 0) setRoomL(r.length);
      if (r.height > 0) setRoomH(r.height);
      const w = r.width > 0 ? r.width : 16;
      const l = r.length > 0 ? r.length : 20;
      const area = w * l;
      const seats = Math.min(24, Math.max(4, Math.round(area / 27)));
      setTableSeats(seats);
      setTableWidth(seats <= 6 ? 3.5 : seats <= 12 ? 4.0 : 5.0);
      setTableWallDist(l * 0.2);
      setRoomType("custom");
      setStep(2);
    };

    const selectRoomTemplate = (r: RoomType) => {
      selectRoom(r);
    };

    const renderRoomCard = (r: RoomType) => {
      const s=Math.min(1.4,6.5/Math.max(r.w,r.l));
      const mx=(x:number,y:number,_z?: number)=>100+(x-y)*10*s;
      const my=(x:number,y:number,z:number)=>65+(x+y)*6*s-z*16*s;
      return (
        <div key={r.id} onClick={()=>selectRoomTemplate(r)}
          style={{padding:16,background:"rgb(var(--forge-surface) / 0.4)",borderRadius:12,border:"1px solid rgb(var(--border))",cursor:"pointer",transition:"all 0.25s",display:"flex",flexDirection:"column"}}
          onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.borderColor="#8b5cf6";(e.currentTarget as HTMLDivElement).style.transform="translateY(-2px)";}}
          onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.borderColor="rgb(var(--border))";(e.currentTarget as HTMLDivElement).style.transform="translateY(0)";}}
        >
          <svg viewBox="0 0 200 130" style={{width:"100%",height:100,marginBottom:8}}>
            <g>
              <polygon points={`${mx(0,0,0)},${my(0,0,0)} ${mx(r.w,0,0)},${my(r.w,0,0)} ${mx(r.w,r.l,0)},${my(r.w,r.l,0)} ${mx(0,r.l,0)},${my(0,r.l,0)}`} fill={cc.floorA} stroke="#8b5cf6" strokeWidth={0.8} opacity={0.6}/>
              <polygon points={`${mx(0,0,0)},${my(0,0,0)} ${mx(r.w,0,0)},${my(r.w,0,0)} ${mx(r.w,0,r.h)},${my(r.w,0,r.h)} ${mx(0,0,r.h)},${my(0,0,r.h)}`} fill={cc.floorB} stroke="#8b5cf6" strokeWidth={0.8} opacity={0.5}/>
              <polygon points={`${mx(0,0,0)},${my(0,0,0)} ${mx(0,r.l,0)},${my(0,r.l,0)} ${mx(0,r.l,r.h)},${my(0,r.l,r.h)} ${mx(0,0,r.h)},${my(0,0,r.h)}`} fill={cc.device} stroke="#8b5cf6" strokeWidth={0.8} opacity={0.4}/>
            </g>
          </svg>
          <div style={{fontSize:14,fontWeight:700,color:"rgb(var(--text-body))"}}>{ r.name}</div>
          <div style={{fontSize:11,color:"rgb(var(--text-subtle))",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{r.people} people · {toDisplay(r.w)} × {toDisplay(r.l)}</div>
        </div>
      );
    };

    return (
      <div style={{height:"calc(100vh - 124px)",overflowY:"auto",display:"flex",justifyContent:"center"}}>
        <div style={{maxWidth:700,width:"100%",padding:"24px",margin:"auto 0"}}>
          <div style={{textAlign:"center",marginBottom:32}}>
            <h2 style={{fontSize:22,fontWeight:700,color:"rgb(var(--text-heading))",marginBottom:6}}>Room Designer</h2>
            <p style={{fontSize:14,color:"rgb(var(--text-muted))"}}>How would you like to set up your room?</p>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {/* Option 1: Pick from Site Survey */}
            <div style={{borderRadius:12,border:"1px solid rgb(var(--border))",overflow:"hidden"}}>
              <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:40,height:40,borderRadius:10,background:"rgba(139,92,246,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,fontWeight:600,color:"rgb(var(--text-heading))"}}>Pick from Site Survey</div>
                  <div style={{fontSize:12,color:"rgb(var(--text-muted))"}}>Use room dimensions from your site survey</div>
                </div>
              </div>
              {surveyRooms.length > 0 ? (
                <div style={{padding:"0 20px 16px",display:"flex",flexWrap:"wrap",gap:8}}>
                  {surveyRooms.map(r => (
                    <button key={r.id} onClick={()=>applySurveyRoom(r.id)}
                      style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgb(var(--border))",background:"rgb(var(--forge-surface) / 0.4)",cursor:"pointer",textAlign:"left",transition:"all 0.2s"}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor="#8b5cf6";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="rgb(var(--border))";}}
                    >
                      <div style={{fontSize:13,fontWeight:600,color:"rgb(var(--text-body))"}}>{ r.name}</div>
                      <div style={{fontSize:11,color:"rgb(var(--text-subtle))",fontFamily:"'JetBrains Mono',monospace"}}>{r.width}&apos; × {r.length}&apos; × {r.height}&apos;</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{padding:"0 20px 16px",fontSize:12,color:"rgb(var(--text-faint))"}}>No rooms found in site survey. Complete the site survey first.</div>
              )}
            </div>

            {/* Option 2: Create your own room */}
            <button
              onClick={()=>setShowCustomRoom(true)}
              style={{width:"100%",borderRadius:12,border:"1px solid rgb(var(--border))",overflow:"hidden",cursor:"pointer",background:"transparent",textAlign:"left",padding:0,transition:"all 0.2s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="#22c55e";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="rgb(var(--border))";}}
            >
              <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:40,height:40,borderRadius:10,background:"rgba(34,197,94,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,fontWeight:600,color:"rgb(var(--text-heading))"}}>Create your own Room</div>
                  <div style={{fontSize:12,color:"rgb(var(--text-muted))"}}>Pick a template or enter custom dimensions</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{marginLeft:"auto"}}>
                  <path d="M6 3L11 8L6 13" stroke="rgb(var(--text-faint))" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
            </button>

            {/* Room templates (shown after confirmation) */}
            {showCustomRoom && (
              <div style={{borderRadius:12,border:"1px solid rgb(var(--border))",overflow:"hidden",marginTop:-8}}>
                {/* Room templates grid */}
                <div style={{padding:"0 20px 16px"}}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                    {roomTypes.map(renderRoomCard)}
                  </div>
                  {/* Custom dimensions button */}
                  <button onClick={()=>{setRoomType("custom");setPlacedDevices([]);setStep(2);}}
                    style={{width:"100%",marginTop:10,padding:"10px",borderRadius:8,border:"2px dashed rgb(var(--border))",background:"transparent",cursor:"pointer",textAlign:"center",transition:"all 0.2s"}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor="#8b5cf6";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="rgb(var(--border))";}}
                  >
                    <div style={{fontSize:13,fontWeight:600,color:"rgb(var(--text-body))"}}>Custom Dimensions</div>
                    <div style={{fontSize:11,color:"rgb(var(--text-subtle))"}}>Enter your own width, length, and height</div>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: Design view ──────────────────────────────────────────────────
  // Table geometry
  const tH=0.76, tW=tableWidth;
  const tL=tableLengthOverride !== null ? tableLengthOverride : (tableShape==="round"?Math.max(tW,tableSeats*0.3+0.6):Math.max(0.5,tableSeats*0.35));
  const tcx=roomW/2, tcy=tableWallDist+tL/2;
  const thw=tW/2, thl=tL/2;
  const seatDist=tableShape==="round"?-0.28:0.35;

  // ── Multiple-room detection — suppress guide values when walls form >1 disconnected shape ──
  const multipleRooms = (() => {
    if (drawnWalls.length < 2) return false;
    const SNAP = 0.2;
    const wallEps = drawnWalls.map(dev => {
      const a = dev.wallAngle!, l = dev.w;
      return [
        { x: dev.x - Math.cos(a) * l / 2, y: dev.y - Math.sin(a) * l / 2 },
        { x: dev.x + Math.cos(a) * l / 2, y: dev.y + Math.sin(a) * l / 2 },
      ];
    });
    const adj: Set<number>[] = drawnWalls.map(() => new Set());
    for (let i = 0; i < drawnWalls.length; i++) {
      for (let j = i + 1; j < drawnWalls.length; j++) {
        outer: for (const pi of wallEps[i]) {
          for (const pj of wallEps[j]) {
            if (Math.sqrt((pi.x-pj.x)**2 + (pi.y-pj.y)**2) < SNAP) {
              adj[i].add(j); adj[j].add(i); break outer;
            }
          }
        }
      }
    }
    const visited = new Set<number>();
    const queue = [0];
    while (queue.length) { const c = queue.shift()!; if (visited.has(c)) continue; visited.add(c); adj[c].forEach(n => queue.push(n)); }
    return visited.size < drawnWalls.length;
  })();

  // ── Display Size Guide (DISCAS 3% element height) ──────────────────────
  // In custom blank mode, use drawn room dimensions; nil if nothing drawn
  const hasRoomContent = !isCustomBlank || (showTable && !tableDeleted) || drawnBounds !== null;
  const validRoom = hasRoomContent && !multipleRooms;
  // Depth is the north→south extent (y axis), width the east→west extent
  // (x axis) — independent of which wall the guide below is evaluating.
  const effectiveDepth = isCustomBlank ? (drawnBounds ? drawnBounds.maxY - drawnBounds.minY : 0) : roomL;
  const effectiveWidth = isCustomBlank ? (drawnBounds ? drawnBounds.maxX - drawnBounds.minX : 0) : roomW;

  // Which wall the Display Size Guide / Camera Guide evaluate as the
  // display wall — the table itself doesn't move, this just recomputes
  // "what if the display were on this wall instead" using the room/table
  // geometry that's already there. The table is placed at `tableWallDist`
  // from the north wall (north/south share that depth axis) and is assumed
  // centered left-right (so it's symmetric for east/west).
  const [guideWall, setGuideWall] = useState<"north" | "south" | "east" | "west">("north");
  // Seating width defaults to the room/table geometry below, but a user can
  // override it with a measured value (e.g. from a site survey) — the
  // override is per-wall and resets when the evaluated wall changes, since a
  // width typed in for one wall doesn't apply to another.
  const [seatingWidthOverride, setSeatingWidthOverride] = useState<number | null>(null);
  // Bottom of Image Height (BIH) — height of the bottom edge of the display
  // above the floor. AVIXA DISCAS uses this (plus a standard seated eye
  // level) to derive the closest comfortable viewing distance below. Default
  // of 42" is a typical conference-room mounting height; per-wall override
  // since mounting height can differ by room/display.
  const DEFAULT_BIH_FT = 42 / 12;
  const [bihOverride, setBihOverride] = useState<number | null>(null);
  // DISCAS closest viewer is auto-calculated from BIH + image height, but a
  // user can override it directly too — e.g. the room's actual front-row
  // seating is closer/farther than the calculated minimum. This single value
  // is shared between the Display Size Guide and Camera Guide cards so the
  // two stay in sync rather than tracking independent "closest viewer" numbers.
  const [discasClosestViewerOverride, setDiscasClosestViewerOverride] = useState<number | null>(null);
  const [editingGuideField, setEditingGuideField] = useState<"seatingWidth" | "bottomImageHeight" | "discasClosestViewer" | null>(null);
  const [guideFieldInput, setGuideFieldInput] = useState("");
  const guideFieldInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSeatingWidthOverride(null); setBihOverride(null); setDiscasClosestViewerOverride(null); }, [guideWall]);
  useEffect(() => {
    if (!editingGuideField) return;
    requestAnimationFrame(() => { guideFieldInputRef.current?.focus(); guideFieldInputRef.current?.select(); });
  }, [editingGuideField]);
  // Which aspect ratio the recommended diagonal is computed for — displays
  // aren't all 16:9 (videowalls/LED often run 21:9 or wider, older systems
  // 4:3), so the diagonal a user actually needs to shop for depends on this,
  // not a fixed assumption. Not persisted, same as guideWall — this is a
  // "what if" exploration control, not part of the saved room design.
  const [guideAspectRatio, setGuideAspectRatio] = useState(16 / 9);
  const guideAspectPresets = [
    { label: "16:9", val: 16 / 9 },
    { label: "16:10", val: 16 / 10 },
    { label: "4:3", val: 4 / 3 },
    { label: "21:9", val: 21 / 9 },
  ];
  const guideAspectLabel = guideAspectPresets.find(p => Math.abs(p.val - guideAspectRatio) < 0.005)?.label ?? `${guideAspectRatio.toFixed(2)}:1`;
  const guideIsNS = guideWall === "north" || guideWall === "south";
  const guideDepth = guideIsNS ? effectiveDepth : effectiveWidth;
  const seatMargin = Math.max(seatDist, 0.35);

  let farthestViewer = 0;
  if (validRoom) {
    if (showTable && !tableDeleted) {
      if (guideWall === "north") {
        farthestViewer = tableWallDist + tL + seatMargin;
      } else if (guideWall === "south") {
        farthestViewer = effectiveDepth - tableWallDist + seatMargin;
      } else {
        // East/west: table assumed centered across the room's width.
        const nearSide = (effectiveWidth - tW) / 2;
        farthestViewer = effectiveWidth - nearSide + seatMargin;
      }
    } else {
      farthestViewer = Math.max(0, guideDepth - 4);
    }
  }
  const imageHeightIn = farthestViewer / 6 * 12;  // VR 6:1 = 3% element height, converted to inches
  const reqDiagIn = imageHeightIn * Math.sqrt(guideAspectRatio * guideAspectRatio + 1);
  const standardSizes = [43, 50, 55, 65, 75, 86, 98, 110];
  const recommendedSize = standardSizes.find(s => s >= reqDiagIn) || standardSizes[standardSizes.length - 1];
  const showDisplayGuide = farthestViewer > 0;

  // AVIXA DISCAS closest viewer — same formula as /calculators/display-sizing:
  // top of screen = BIH + image height; if that's above standard seated eye
  // level (48"), the 30° max vertical viewing angle sets the closest comfortable
  // distance, floored by the 0.87x image-height rule for digital content.
  const bihFt = bihOverride ?? DEFAULT_BIH_FT;
  const STANDARD_EYE_LEVEL_IN = 48;
  const topOfScreenIn = bihFt * 12 + imageHeightIn;
  const aboveEyeIn = topOfScreenIn - STANDARD_EYE_LEVEL_IN;
  const closestByAngleIn = aboveEyeIn > 0 ? aboveEyeIn / Math.tan(30 * Math.PI / 180) : imageHeightIn * 0.87;
  const discasClosestViewerFt = Math.max(imageHeightIn * 0.87, closestByAngleIn) / 12;
  const effectiveDiscasClosestViewer = discasClosestViewerOverride ?? discasClosestViewerFt;

  // ── Camera Guide ───────────────────────────────────────────────────────
  const chairMargin = 1;  // 1 foot chair margin
  const seatingWidth = !validRoom ? 0
    : showTable && !tableDeleted
      ? (guideIsNS ? tW : tL) + 2 * (seatMargin + chairMargin)
      : (guideIsNS ? effectiveWidth : effectiveDepth);
  const effectiveSeatingWidth = seatingWidthOverride ?? seatingWidth;
  const reqHFOV = effectiveDiscasClosestViewer > 0
    ? 2 * Math.atan((effectiveSeatingWidth / 2) / effectiveDiscasClosestViewer) * (180 / Math.PI)
    : 0;
  const showCameraGuide = effectiveDiscasClosestViewer > 0 && farthestViewer > 0;

  const beginEditGuideField = (field: "seatingWidth" | "bottomImageHeight" | "discasClosestViewer") => {
    if (!validRoom) return;
    setEditingGuideField(field);
    const current = field === "seatingWidth" ? effectiveSeatingWidth
      : field === "bottomImageHeight" ? bihFt
      : effectiveDiscasClosestViewer;
    setGuideFieldInput(toEditableLength(current));
  };
  const commitGuideFieldEdit = (closeOnInvalid = false) => {
    if (!editingGuideField) return;
    const value = parseFtIn(guideFieldInput);
    if (value === null || value <= 0) {
      if (closeOnInvalid) { setEditingGuideField(null); setGuideFieldInput(""); }
      return;
    }
    if (editingGuideField === "seatingWidth") setSeatingWidthOverride(value);
    else if (editingGuideField === "bottomImageHeight") setBihOverride(value);
    else setDiscasClosestViewerOverride(value);
    setEditingGuideField(null);
    setGuideFieldInput("");
  };
  const resetGuideField = (field: "seatingWidth" | "bottomImageHeight" | "discasClosestViewer") => {
    if (field === "seatingWidth") setSeatingWidthOverride(null);
    else if (field === "bottomImageHeight") setBihOverride(null);
    else setDiscasClosestViewerOverride(null);
  };

  const render3DTable = () => {
    if (tableShape==="round") {
      const r=Math.max(tW,tL)/2;
      const legOff=r*0.4;
      const legPts:[number,number][]=[[-legOff,-legOff],[legOff,-legOff],[legOff,legOff],[-legOff,legOff]];
      return (
        <g>
          <ellipse cx={sX(tcx,tcy,0)} cy={sY(tcx,tcy,0)+4} rx={r*32*scale} ry={r*19*scale} fill="#000" opacity={0.1}/>
          {Array.from({length:tableSeats},(_,i)=>{
            const angle=(i/tableSeats)*Math.PI*2-Math.PI/2;
            const chX=tcx+(r+seatDist)*Math.cos(angle), chY=tcy+(r+seatDist)*Math.sin(angle);
            if(chY<tcy){const ddx=chX-tcx,ddy=chY-tcy;const dir=Math.abs(ddx)>Math.abs(ddy)?(ddx>0?"right":"left"):"up";return <React.Fragment key={"cb"+i}>{renderChair(chX,chY,dir)}</React.Fragment>;}
            return null;
          })}
          {legPts.map((lp,i)=>(
            <line key={"rl"+i} x1={sX(tcx+lp[0],tcy+lp[1],0.05)} y1={sY(tcx+lp[0],tcy+lp[1],0.05)} x2={sX(tcx+lp[0]*0.6,tcy+lp[1]*0.6,tH)} y2={sY(tcx+lp[0]*0.6,tcy+lp[1]*0.6,tH)} stroke="rgb(var(--text-muted))" strokeWidth={2.5} strokeLinecap="round" opacity={0.5}/>
          ))}
          <ellipse cx={sX(tcx,tcy,tH-0.02)} cy={sY(tcx,tcy,tH-0.02)} rx={r*31*scale} ry={r*18*scale} fill="rgb(var(--text-muted))" opacity={0.15} stroke="#cbd5e1" strokeWidth={0.5}/>
          <ellipse cx={sX(tcx,tcy,tH)} cy={sY(tcx,tcy,tH)} rx={r*30*scale} ry={r*17*scale} fill="url(#tableTopGrad)" stroke="#e2e8f0" strokeWidth={1}/>
          <ellipse cx={sX(tcx-r*0.15,tcy-r*0.15,tH+0.01)} cy={sY(tcx-r*0.15,tcy-r*0.15,tH+0.01)} rx={r*15*scale} ry={r*9*scale} fill="#f1f5f9" opacity={0.15}/>
          {Array.from({length:tableSeats},(_,i)=>{
            const angle=(i/tableSeats)*Math.PI*2-Math.PI/2;
            const chX=tcx+(r+seatDist)*Math.cos(angle), chY=tcy+(r+seatDist)*Math.sin(angle);
            if(chY>=tcy){const ddx=chX-tcx,ddy=chY-tcy;const dir=Math.abs(ddx)>Math.abs(ddy)?(ddx>0?"right":"left"):"down";return <React.Fragment key={"cf"+i}>{renderChair(chX,chY,dir)}</React.Fragment>;}
            return null;
          })}
        </g>
      );
    }
    const taperIn=tableShape==="tapered"?tW*0.15:0;
    const fhw=thw-taperIn, bhw=thw;
    const topPts=[`${sX(tcx-fhw,tcy-thl,tH)},${sY(tcx-fhw,tcy-thl,tH)}`,`${sX(tcx+fhw,tcy-thl,tH)},${sY(tcx+fhw,tcy-thl,tH)}`,`${sX(tcx+bhw,tcy+thl,tH)},${sY(tcx+bhw,tcy+thl,tH)}`,`${sX(tcx-bhw,tcy+thl,tH)},${sY(tcx-bhw,tcy+thl,tH)}`].join(" ");
    const frontPts=[`${sX(tcx-bhw,tcy+thl,tH-0.04)},${sY(tcx-bhw,tcy+thl,tH-0.04)}`,`${sX(tcx+bhw,tcy+thl,tH-0.04)},${sY(tcx+bhw,tcy+thl,tH-0.04)}`,`${sX(tcx+bhw,tcy+thl,tH)},${sY(tcx+bhw,tcy+thl,tH)}`,`${sX(tcx-bhw,tcy+thl,tH)},${sY(tcx-bhw,tcy+thl,tH)}`].join(" ");
    const rightPts=[`${sX(tcx+fhw,tcy-thl,tH-0.04)},${sY(tcx+fhw,tcy-thl,tH-0.04)}`,`${sX(tcx+bhw,tcy+thl,tH-0.04)},${sY(tcx+bhw,tcy+thl,tH-0.04)}`,`${sX(tcx+bhw,tcy+thl,tH)},${sY(tcx+bhw,tcy+thl,tH)}`,`${sX(tcx+fhw,tcy-thl,tH)},${sY(tcx+fhw,tcy-thl,tH)}`].join(" ");
    const legs:[[number,number]][]=[[[tcx-fhw+0.06,tcy-thl+0.06]],[[tcx+fhw-0.06,tcy-thl+0.06]],[[tcx-bhw+0.06,tcy+thl-0.06]],[[tcx+bhw-0.06,tcy+thl-0.06]]];
    const seatsArr: {x:number;y:number;side:string}[] = [];
    const sps=Math.floor(tableSeats/2), lo=tableSeats-sps*2;
    for(let i=0;i<sps;i++){const t=(i+0.5)/sps;const lw=fhw+(bhw-fhw)*t;seatsArr.push({x:tcx-lw-seatDist,y:tcy-thl+tL*t,side:"left"});}
    for(let i=0;i<sps;i++){const t=(i+0.5)/sps;const rw=fhw+(bhw-fhw)*t;seatsArr.push({x:tcx+rw+seatDist,y:tcy-thl+tL*t,side:"right"});}
    if(lo>=1) seatsArr.push({x:tcx,y:tcy+thl+seatDist,side:"end"});
    if(lo>=2) seatsArr.push({x:tcx,y:tcy-thl-seatDist,side:"front"});
    return (
      <g>
        <polygon points={[`${sX(tcx-bhw-0.1,tcy-thl-0.1,0)},${sY(tcx-bhw-0.1,tcy-thl-0.1,0)+5}`,`${sX(tcx+bhw+0.1,tcy-thl-0.1,0)},${sY(tcx+bhw+0.1,tcy-thl-0.1,0)+5}`,`${sX(tcx+bhw+0.1,tcy+thl+0.1,0)},${sY(tcx+bhw+0.1,tcy+thl+0.1,0)+5}`,`${sX(tcx-bhw-0.1,tcy+thl+0.1,0)},${sY(tcx-bhw-0.1,tcy+thl+0.1,0)+5}`].join(" ")} fill="#000" opacity={0.08}/>
        {seatsArr.filter(s=>s.y<tcy).map((s,i)=>{
          const dir=s.side==="left"?"left":s.side==="right"?"right":"up";
          return <React.Fragment key={"cb"+i}>{renderChair(s.x,s.y,dir)}</React.Fragment>;
        })}
        {legs.map((lp,i)=>(
          <g key={"leg"+i}>
            <line x1={sX(lp[0][0],lp[0][1],0.02)} y1={sY(lp[0][0],lp[0][1],0.02)} x2={sX(lp[0][0],lp[0][1],tH-0.02)} y2={sY(lp[0][0],lp[0][1],tH-0.02)} stroke="#cbd5e1" strokeWidth={3} strokeLinecap="round" opacity={0.6}/>
            <line x1={sX(lp[0][0],lp[0][1],0.02)} y1={sY(lp[0][0],lp[0][1],0.02)} x2={sX(lp[0][0],lp[0][1],tH-0.02)} y2={sY(lp[0][0],lp[0][1],tH-0.02)} stroke="#e2e8f0" strokeWidth={1.5} strokeLinecap="round" opacity={0.3}/>
          </g>
        ))}
        <polygon points={frontPts} fill="url(#tableFrontGrad)" stroke="#cbd5e1" strokeWidth={0.5}/>
        <polygon points={rightPts} fill="url(#tableSideGrad)" stroke="#cbd5e1" strokeWidth={0.5}/>
        <polygon points={topPts} fill="url(#tableTopGrad)" stroke="#e2e8f0" strokeWidth={1}/>
        <polygon points={[`${sX(tcx-fhw*0.6,tcy-thl*0.7,tH+0.008)},${sY(tcx-fhw*0.6,tcy-thl*0.7,tH+0.008)}`,`${sX(tcx+fhw*0.3,tcy-thl*0.5,tH+0.008)},${sY(tcx+fhw*0.3,tcy-thl*0.5,tH+0.008)}`,`${sX(tcx+bhw*0.1,tcy+thl*0.2,tH+0.008)},${sY(tcx+bhw*0.1,tcy+thl*0.2,tH+0.008)}`,`${sX(tcx-bhw*0.5,tcy+thl*0.1,tH+0.008)},${sY(tcx-bhw*0.5,tcy+thl*0.1,tH+0.008)}`].join(" ")} fill="#f8fafc" opacity={0.12}/>
        {seatsArr.filter(s=>s.y>=tcy).map((s,i)=>{
          const dir=s.side==="left"?"left":s.side==="right"?"right":"down";
          return <React.Fragment key={"cf"+i}>{renderChair(s.x,s.y,dir)}</React.Fragment>;
        })}
      </g>
    );
  };

  // Turns the selected built-in table / chairs into placed furniture
  // (Conference or Round Table + Side Chairs) at their current on-screen
  // positions, for copy & paste. Chair positions are read back off the drawn
  // chairs, so table rotation and hand-nudged chairs come out exactly as shown.
  const builtInSelectionToDevices = (): PlacedDevice[] => {
    if (selected.size === 0) return [];
    const out: PlacedDevice[] = [];
    const base = Date.now();
    if (selected.has("table") && showTable && !tableDeleted) {
      const round = tableShape === "round";
      const tpl = roomElementItems.find(i => i.id === (round ? "round-table" : "conf-table"))!;
      const dia = Math.max(tW, tL);
      out.push({
        ...tpl, w: round ? dia : tW, h: round ? dia : tL,
        uid: base, x: tableCenterX ?? roomW / 2, y: tableWallDist + tL / 2, z: 0, mountWall: "floor", rotation: tableRotation,
      } as PlacedDevice);
    }
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (svg && ctm) {
      const inv = ctm.inverse();
      const chairTpl = roomElementItems.find(i => i.id === "side-chair")!;
      selected.forEach(id => {
        if (!id.startsWith("chair:")) return;
        const el = svg.querySelector(`[data-sel-id="${id}"]`) as SVGGraphicsElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const pt = svg.createSVGPoint(); pt.x = r.left + r.width / 2; pt.y = r.top + r.height / 2;
        const p = pt.matrixTransform(inv);
        const sizeFt = el.getBBox().width / planScale;
        out.push({
          ...chairTpl, w: sizeFt, h: sizeFt,
          uid: base + out.length, x: (p.x - planOffX) / planScale, y: (p.y - planOffY) / planScale, z: 0, mountWall: "floor",
        } as PlacedDevice);
      });
    }
    return out;
  };
  copyBuiltInRef.current = builtInSelectionToDevices;

  const renderPlanTable = () => {
    const cx=tableCenterX ?? roomW/2, cy2=tableWallDist+tL/2;
    const hw=tW/2, hl=tL/2;
    // Table chairs are the same chair as the "Side Chair" in the Chairs list —
    // same size and look — shrunk only when a crowded table leaves less room
    // than one chair per seat (so neighbouring chairs never overlap).
    const sideChairFt = roomElementItems.find(i => i.id === "side-chair")?.w ?? 1.48;
    const sps0 = Math.floor(tableSeats/2), lo0 = tableSeats - sps0*2;
    const seatPitchFt = tableShape === "round"
      ? (Math.PI * Math.max(tW, tL)) / Math.max(1, tableSeats)
      : Math.min(sps0 > 0 ? tL / sps0 : Infinity, lo0 > 0 ? tW : Infinity);
    const chairFt = Math.max(0.6, Math.min(sideChairFt, seatPitchFt - 0.2));
    const cS = Math.max(6, chairFt * planScale);
    const rx = Math.max(1, cS * 0.18);
    const chairSquare = (px: number, py: number) => (
      <rect x={px - cS/2} y={py - cS/2} width={cS} height={cS} rx={rx} fill="#d1d5db" stroke="#b0b5be" strokeWidth={0.8}/>
    );

    const chairClick = (idx: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (dragStartedRef.current) { dragStartedRef.current = false; return; }
      toggleSelect(`chair:${idx}`, e.ctrlKey || e.metaKey);
      setSelectedUid(null);
    };
    const tableClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (dragStartedRef.current) { dragStartedRef.current = false; return; }
      toggleSelect("table", e.ctrlKey || e.metaKey);
      setSelectedUid(null);
    };

    const renderSelectableChair = (idx: number, chairEl: React.ReactNode, cx2: number, cy2r: number) => {
      if (deletedChairs.has(idx)) return null;
      const isSel = isItemSelected(`chair:${idx}`);
      const off = chairOffsets[idx];
      const offPx = off ? off.dx * planScale : 0;
      const offPy = off ? off.dy * planScale : 0;
      return (
        <g key={"sc"+idx} transform={`translate(${offPx},${offPy})`}
          style={{cursor: "grab"}}
          onClick={e => chairClick(idx, e)}
          onMouseDown={e => handleMultiDragStart(`chair:${idx}`, e)}
        >
          {isSel && <circle cx={cx2} cy={cy2r} r={cS*0.8} fill="rgba(139,92,246,0.15)" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" />}
          <g data-sel-id={`chair:${idx}`}>{chairEl}</g>
          {isSel && (
            <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); pushUndo(); setDeletedChairs(prev => { const next = new Set(prev); next.add(idx); return next; }); clearSelection(); }}>
              <circle cx={cx2+cS*0.6} cy={cy2r-cS*0.6} r={7} fill="#ef4444" />
              <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${cx2+cS*0.6},${cy2r-cS*0.6})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round" />
            </g>
          )}
        </g>
      );
    };

    // Table edge resize handles (rendered on top of table body)
    const renderTableResizeHandles = (x1: number, y1: number, w: number, h: number) => (
      <g>
        {/* Left edge */}
        <line x1={pX(x1)} y1={pY(y1)} x2={pX(x1)} y2={pY(y1+h)} stroke="transparent" strokeWidth={8} cursor="ew-resize"
          onMouseDown={e => handleTableResizeStart("left", e)}
          onMouseEnter={e=>{(e.target as SVGLineElement).setAttribute("stroke","rgba(139,92,246,0.4)")}}
          onMouseLeave={e=>{(e.target as SVGLineElement).setAttribute("stroke","transparent")}} />
        {/* Right edge */}
        <line x1={pX(x1+w)} y1={pY(y1)} x2={pX(x1+w)} y2={pY(y1+h)} stroke="transparent" strokeWidth={8} cursor="ew-resize"
          onMouseDown={e => handleTableResizeStart("right", e)}
          onMouseEnter={e=>{(e.target as SVGLineElement).setAttribute("stroke","rgba(139,92,246,0.4)")}}
          onMouseLeave={e=>{(e.target as SVGLineElement).setAttribute("stroke","transparent")}} />
        {/* Top edge */}
        <line x1={pX(x1)} y1={pY(y1)} x2={pX(x1+w)} y2={pY(y1)} stroke="transparent" strokeWidth={8} cursor="ns-resize"
          onMouseDown={e => handleTableResizeStart("top", e)}
          onMouseEnter={e=>{(e.target as SVGLineElement).setAttribute("stroke","rgba(139,92,246,0.4)")}}
          onMouseLeave={e=>{(e.target as SVGLineElement).setAttribute("stroke","transparent")}} />
        {/* Bottom edge */}
        <line x1={pX(x1)} y1={pY(y1+h)} x2={pX(x1+w)} y2={pY(y1+h)} stroke="transparent" strokeWidth={8} cursor="ns-resize"
          onMouseDown={e => handleTableResizeStart("bottom", e)}
          onMouseEnter={e=>{(e.target as SVGLineElement).setAttribute("stroke","rgba(139,92,246,0.4)")}}
          onMouseLeave={e=>{(e.target as SVGLineElement).setAttribute("stroke","transparent")}} />
        {/* Highlight active edge */}
        {tableResizeDrag?.edge === "left" && <line x1={pX(x1)} y1={pY(y1)} x2={pX(x1)} y2={pY(y1+h)} stroke="#8b5cf6" strokeWidth={3} pointerEvents="none" />}
        {tableResizeDrag?.edge === "right" && <line x1={pX(x1+w)} y1={pY(y1)} x2={pX(x1+w)} y2={pY(y1+h)} stroke="#8b5cf6" strokeWidth={3} pointerEvents="none" />}
        {tableResizeDrag?.edge === "top" && <line x1={pX(x1)} y1={pY(y1)} x2={pX(x1+w)} y2={pY(y1)} stroke="#8b5cf6" strokeWidth={3} pointerEvents="none" />}
        {tableResizeDrag?.edge === "bottom" && <line x1={pX(x1)} y1={pY(y1+h)} x2={pX(x1+w)} y2={pY(y1+h)} stroke="#8b5cf6" strokeWidth={3} pointerEvents="none" />}
      </g>
    );

    if(tableShape==="round"){
      const r=Math.max(tW,tL)/2;
      const seatDistR=chairFt/2+0.15; // chairs sit just outside the table edge
      return (
        <g>
          {!tableDeleted && (() => {
            const tSel = isItemSelected("table");
            return (
            <g style={{cursor:"grab"}} onClick={tableClick} onMouseDown={e => handleMultiDragStart("table", e)}>
              {tSel && <circle cx={pX(cx)} cy={pY(cy2)} r={r*planScale+4} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 3" />}
              <circle data-sel-id="table" cx={pX(cx)} cy={pY(cy2)} r={r*planScale} fill="#cbd5e1" fillOpacity={0.3} stroke={tSel?"#8b5cf6":"rgb(var(--text-muted))"} strokeWidth={tSel?2:1.5}/>
              {/* Diameter label below round table */}
              <text x={pX(cx)} y={pY(cy2)+r*planScale+14} textAnchor="middle" fontSize={10} fill="#94a3b8" fontFamily="'JetBrains Mono',monospace">⌀ {toDisplay(r*2)}</text>
              {tSel && (
                <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); pushUndo(); setTableDeleted(true); clearSelection(); }}>
                  <circle cx={pX(cx)+r*planScale+8} cy={pY(cy2)-r*planScale} r={10} fill="#ef4444" />
                  <path d="M-4,-4 L4,4 M4,-4 L-4,4" transform={`translate(${pX(cx)+r*planScale+8},${pY(cy2)-r*planScale})`} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
                </g>
              )}
            </g>
            );
          })()}
          {Array.from({length:tableSeats},(_,i)=>{
            const a=(i/tableSeats)*Math.PI*2-Math.PI/2;
            const chairX=pX(cx+(r+seatDistR)*Math.cos(a)), chairY=pY(cy2+(r+seatDistR)*Math.sin(a));
            const deg=a*180/Math.PI+90;
            const chairEl = (
              <g transform={`rotate(${deg},${chairX},${chairY})`}>{chairSquare(chairX, chairY)}</g>
            );
            return renderSelectableChair(i, chairEl, chairX, chairY);
          })}
          {!tableDeleted && renderTableResizeHandles(cx - r, cy2 - r, r * 2, r * 2)}
        </g>
      );
    }
    const taperIn=tableShape==="tapered"?tW*0.15:0;
    const sps=Math.floor(tableSeats/2), lo=tableSeats-sps*2;
    const sd=chairFt/2+0.15; // chair centre distance from the table edge
    let chairIdx = 0;
    return (
      <g>
        {!tableDeleted && (() => {
          const tSel = isItemSelected("table");
          return (
          <g style={{cursor:"grab"}} onClick={tableClick} onMouseDown={e => handleMultiDragStart("table", e)}>
            {tSel && <rect x={pX(cx-hw)-4} y={pY(cy2-hl)-4} width={tW*planScale+8} height={tL*planScale+8} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 3" rx={4} />}
            <polygon data-sel-id="table" points={`${pX(cx-hw+taperIn)},${pY(cy2-hl)} ${pX(cx+hw-taperIn)},${pY(cy2-hl)} ${pX(cx+hw)},${pY(cy2+hl)} ${pX(cx-hw)},${pY(cy2+hl)}`} fill="#cbd5e1" fillOpacity={0.3} stroke={tSel?"#8b5cf6":"rgb(var(--text-muted))"} strokeWidth={tSel?2:1.5}/>
            {/* Width dimension — above table */}
            <text x={pX(cx)} y={pY(cy2-hl)-6} textAnchor="middle" fontSize={10} fill="#94a3b8" fontFamily="'JetBrains Mono',monospace">{toDisplay(tW)}</text>
            {/* Length dimension — right of table, rotated */}
            <text x={pX(cx+hw)+16} y={pY(cy2)} textAnchor="middle" fontSize={10} fill="#94a3b8" fontFamily="'JetBrains Mono',monospace" transform={`rotate(-90,${pX(cx+hw)+16},${pY(cy2)})`}>{toDisplay(tL)}</text>
            {tSel && (
              <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); pushUndo(); setTableDeleted(true); clearSelection(); }}>
                <circle cx={pX(cx+hw)+12} cy={pY(cy2-hl)} r={10} fill="#ef4444" />
                <path d="M-4,-4 L4,4 M4,-4 L-4,4" transform={`translate(${pX(cx+hw)+12},${pY(cy2-hl)})`} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
              </g>
            )}
          </g>
          );
        })()}
        {Array.from({length:sps},(_,i)=>{
          const idx = chairIdx++;
          const t=(i+0.5)/sps, lw=hw-taperIn+(taperIn)*t;
          const cx2=pX(cx-lw-sd), cy3=pY(cy2-hl+tL*t);
          const chairEl = chairSquare(cx2, cy3);
          return renderSelectableChair(idx, chairEl, cx2, cy3);
        })}
        {Array.from({length:sps},(_,i)=>{
          const idx = chairIdx++;
          const t=(i+0.5)/sps, rw=hw-taperIn+(taperIn)*t;
          const cx2=pX(cx+rw+sd), cy3=pY(cy2-hl+tL*t);
          const chairEl = chairSquare(cx2, cy3);
          return renderSelectableChair(idx, chairEl, cx2, cy3);
        })}
        {lo>=1&&(()=>{const idx=chairIdx++;const cx2=pX(cx),cy3=pY(cy2+hl+sd);const chairEl=chairSquare(cx2,cy3);return renderSelectableChair(idx,chairEl,cx2,cy3);})()}
        {lo>=2&&(()=>{const idx=chairIdx++;const cx2=pX(cx),cy3=pY(cy2-hl-sd);const chairEl=chairSquare(cx2,cy3);return renderSelectableChair(idx,chairEl,cx2,cy3);})()}
        {!tableDeleted && renderTableResizeHandles(cx - hw, cy2 - hl, tW, tL)}
      </g>
    );
  };

  return (
    <div className="animate-fade-in" style={{display:"flex",flexDirection:"column",height:"calc(100vh - 124px - 85px)",overflow:"hidden"}}>

    <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
      {/* ── Left Sidebar ─────────────────────────────────── */}
      <div className="w-full max-h-[45vh] shrink-0 lg:w-[420px] lg:max-h-none border-b lg:border-b-0 lg:border-r border-border" style={{background:cc.panel,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
        <div style={{flex:1,overflowY:"auto",overflowX:"hidden",minHeight:0}}>
          {/* Room Configuration */}
          <div style={{padding:"12px 20px",borderBottom:"1px solid rgb(var(--border))"}}>
            <div style={{fontSize:14,fontWeight:600,color:"rgb(var(--text-subtle))",textTransform:"uppercase",marginBottom:10}}>Create Room</div>
            {/* Wall types */}
            <div style={{marginTop:12,opacity:1}}>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {([
                  {type:"drywall" as const,label:"Drywall",description:"Standard framed partition"},
                  {type:"glass" as const,label:"Glass Wall",description:"Glazed partition"},
                  {type:"solid" as const,label:"Solid Wall",description:"Concrete or masonry wall"},
                ]).map(option => {
                  const active = isDrawingWall && !isScalingFloorPlan && drawingWallType === option.type;
                  return (
                    <button key={option.type} onClick={()=>startWallDrawing(option.type)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",background:active?"rgba(139,92,246,0.15)":"rgb(var(--forge-surface) / 0.4)",border:"1px solid "+(active?"rgba(139,92,246,0.4)":"rgb(var(--border))"),borderRadius:5,cursor:"pointer",textAlign:"left"}}>
                      <WallTypeIcon type={option.type}/>
                      <div>
                        <div style={{fontSize:13,color:"rgb(var(--text-body))",fontWeight:500}}>{option.label}</div>
                        <div style={{fontSize:11,color:"#475569"}}>{option.description}</div>
                      </div>
                    </button>
                  );
                })}
                {isDrawingWall && (
                  <button
                    onClick={() => setOrthoMode(v => !v)}
                    title="Ortho mode — constrain to horizontal/vertical (F8)"
                    style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:32,height:32,padding:0,background:orthoMode?"#8b5cf6":"rgb(var(--forge-surface) / 0.4)",border:"1px solid "+(orthoMode?"#8b5cf6":"rgb(var(--border))"),borderRadius:6,cursor:"pointer",transition:"all 0.15s"}}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <rect x="2" y="2" width="16" height="16" rx="2" fill={orthoMode?"#8b5cf6":"transparent"}/>
                      <path d="M5 15V6" stroke={orthoMode?"#fff":"#64748b"} strokeWidth="2" strokeLinecap="round"/>
                      <path d="M5 15h9" stroke={orthoMode?"#fff":"#64748b"} strokeWidth="2" strokeLinecap="round"/>
                      <rect x="4" y="11" width="4" height="4" rx="0.5" fill={orthoMode?"#fff":"#64748b"} opacity="0.9"/>
                    </svg>
                  </button>
                )}
                <button
                  onMouseDown={()=>{setIsDrawingWall(false);setWallPoints([]);setWallMousePos(null);setDragNewTable(null);setDragNewChair(null);setDragNewDoor({type:"door",active:true,wall:null,pos:0.5});}}
                  style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",background:dragNewDoor?.type==="door"?"rgba(139,92,246,0.15)":"rgb(var(--forge-surface) / 0.4)",border:"1px solid "+(dragNewDoor?.type==="door"?"rgba(139,92,246,0.4)":"rgb(var(--border))"),borderRadius:5,cursor:"grab",textAlign:"left"}}
                  onMouseEnter={e=>{if(!dragNewDoor)e.currentTarget.style.borderColor="#334155"}} onMouseLeave={e=>{if(!dragNewDoor)e.currentTarget.style.borderColor="rgb(var(--border))"}}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"/><path d="M2 20h20"/><circle cx="15" cy="12" r="0.5" fill="#64748b"/></svg>
                  <div>
                    <div style={{fontSize:13,color:"rgb(var(--text-body))",fontWeight:500}}>Door</div>
                    <div style={{fontSize:11,color:"#475569"}}>Drag onto a wall</div>
                  </div>
                </button>
                <button
                  onMouseDown={()=>{setIsDrawingWall(false);setWallPoints([]);setWallMousePos(null);setDragNewTable(null);setDragNewChair(null);setDragNewDoor({type:"window",active:true,wall:null,pos:0.5});}}
                  style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",background:dragNewDoor?.type==="window"?"rgba(139,92,246,0.15)":"rgb(var(--forge-surface) / 0.4)",border:"1px solid "+(dragNewDoor?.type==="window"?"rgba(139,92,246,0.4)":"rgb(var(--border))"),borderRadius:5,cursor:"grab",textAlign:"left"}}
                  onMouseEnter={e=>{if(!dragNewDoor)e.currentTarget.style.borderColor="#334155"}} onMouseLeave={e=>{if(!dragNewDoor)e.currentTarget.style.borderColor="rgb(var(--border))"}}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/></svg>
                  <div>
                    <div style={{fontSize:13,color:"rgb(var(--text-body))",fontWeight:500}}>Window</div>
                    <div style={{fontSize:11,color:"#475569"}}>Drag onto a wall</div>
                  </div>
                </button>
                <button
                  onMouseDown={()=>{setIsDrawingWall(false);setWallPoints([]);setWallMousePos(null);setDragNewDoor(null);setDragNewChair(null);setDragNewTable({active:true,worldX:roomW/2,worldY:roomL*0.2});}}
                  style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",background:dragNewTable?.active?"rgba(139,92,246,0.15)":"rgb(var(--forge-surface) / 0.4)",border:"1px solid "+(dragNewTable?.active?"rgba(139,92,246,0.4)":"rgb(var(--border))"),borderRadius:5,cursor:"grab",textAlign:"left"}}
                  onMouseEnter={e=>{if(!dragNewTable)e.currentTarget.style.borderColor="#334155"}} onMouseLeave={e=>{if(!dragNewTable)e.currentTarget.style.borderColor="rgb(var(--border))"}}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="4" rx="1"/><path d="M6 11v6M18 11v6"/></svg>
                  <div>
                    <div style={{fontSize:13,color:"rgb(var(--text-body))",fontWeight:500}}>Table</div>
                    <div style={{fontSize:11,color:"#475569"}}>Drag onto the floor</div>
                  </div>
                </button>
                <button
                  onMouseDown={()=>{setIsDrawingWall(false);setWallPoints([]);setWallMousePos(null);setDragNewDoor(null);setDragNewTable(null);setDragNewChair({active:true,worldX:roomW/2,worldY:roomL/2});}}
                  style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",background:dragNewChair?.active?"rgba(139,92,246,0.15)":"rgb(var(--forge-surface) / 0.4)",border:"1px solid "+(dragNewChair?.active?"rgba(139,92,246,0.4)":"rgb(var(--border))"),borderRadius:5,cursor:"grab",textAlign:"left"}}
                  onMouseEnter={e=>{if(!dragNewChair)e.currentTarget.style.borderColor="#334155"}} onMouseLeave={e=>{if(!dragNewChair)e.currentTarget.style.borderColor="rgb(var(--border))"}}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M6 20v-6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>
                  <div>
                    <div style={{fontSize:13,color:"rgb(var(--text-body))",fontWeight:500}}>Chair</div>
                    <div style={{fontSize:11,color:"#475569"}}>Drag onto the floor</div>
                  </div>
                </button>
              </div>
            </div>
            {/* Import Floor Plan */}
            <div style={{marginTop:12,opacity:1}}>
              {!floorPlanImg ? (
                <div style={{border:"2px dashed rgb(var(--border))",borderRadius:8,padding:"16px 12px",textAlign:"center"}}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--text-faint))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{margin:"0 auto 8px"}}>
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <div style={{fontSize:12,color:"rgb(var(--text-muted))",marginBottom:8}}>Drop or upload a floor plan</div>
                  <div style={{fontSize:10,color:"rgb(var(--text-faint))",marginBottom:10}}>JPG, PNG, PDF, or DXF (AutoCAD)</div>
                  <button onClick={()=>floorPlanInputRef.current?.click()} style={{padding:"6px 16px",borderRadius:6,fontSize:12,fontWeight:600,background:"rgb(var(--forge-surface) / 0.6)",border:"1px solid rgb(var(--border))",color:"rgb(var(--text-body))",cursor:"pointer"}}>Upload</button>
                  <input ref={floorPlanInputRef} type="file" accept=".jpg,.jpeg,.png,.pdf,.dxf" onChange={handleFloorPlanUpload} style={{display:"none"}} />
                  {floorPlanImportError && <div style={{marginTop:8,fontSize:11,color:"#f87171"}}>{floorPlanImportError}</div>}
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <div style={{fontSize:12,color:"rgb(var(--text-muted))"}}>Floor plan loaded</div>
                  {!isScalingFloorPlan ? (
                    <div style={{display:"flex",gap:4}}>
                      <button onClick={()=>{setIsScalingFloorPlan(true);setScaleRefPoints([]);setScaleRefLength("");setScaleRefInches("");setIsDrawingWall(true);}} style={{flex:1,padding:"6px 8px",borderRadius:5,fontSize:11,fontWeight:600,background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.3)",color:"#a78bfa",cursor:"pointer"}}>Set Scale</button>
                      <button onClick={()=>{setFloorPlanImg(null);setIsScalingFloorPlan(false);setScaleRefPoints([]);}} style={{padding:"6px 8px",borderRadius:5,fontSize:11,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",color:"#f87171",cursor:"pointer"}}>Remove</button>
                    </div>
                  ) : (
                    <div style={{padding:"8px 10px",background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.3)",borderRadius:5,fontSize:12,color:"#a78bfa"}}>
                      {scaleRefPoints.length === 0 && "Click two points on the plan for a known distance"}
                      {scaleRefPoints.length === 1 && "Click the second point"}
                      {scaleRefPoints.length === 2 && (
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          <div>Enter the real distance between the two points:</div>
                          {/* Unit picker first (Bluebeam-calibrate style) — which
                              input(s) show below depends on this, since ft-in
                              needs two fields (feet, inches) and the rest need
                              just one. Always converted to inches internally
                              (scaleRefToInches) to match the equipment
                              library's own dimension unit, whichever of these
                              was actually easiest to read off the drawing. */}
                          <div style={{display:"flex",gap:3}}>
                            {(["ft-in","ft","in","mm"] as const).map(u => (
                              <button key={u} onClick={()=>setScaleRefUnit(u)}
                                style={{flex:1,padding:"3px 0",borderRadius:4,fontSize:10,fontWeight:600,cursor:"pointer",
                                  background: scaleRefUnit===u ? "rgba(139,92,246,0.25)" : "rgb(var(--forge-surface) / 0.6)",
                                  border:"1px solid "+(scaleRefUnit===u ? "#8b5cf6" : "rgba(139,92,246,0.3)"),
                                  color: scaleRefUnit===u ? "#c4b5fd" : "rgb(var(--text-subtle))"}}>
                                {u==="ft-in" ? "ft/in" : u}
                              </button>
                            ))}
                          </div>
                          {scaleRefUnit === "ft-in" ? (
                            <div style={{display:"flex",gap:4,alignItems:"center"}}>
                              <input type="number" step="1" value={scaleRefLength} onChange={e=>setScaleRefLength(e.target.value)} placeholder="10" className="no-spin" style={{flex:1,padding:"4px 8px",borderRadius:4,border:"1px solid rgba(139,92,246,0.3)",background:"rgb(var(--forge-surface) / 0.6)",color:"rgb(var(--text-body))",fontSize:12,outline:"none"}} />
                              <span style={{fontSize:11,color:"rgb(var(--text-subtle))"}}>ft</span>
                              <input type="number" step="0.5" value={scaleRefInches} onChange={e=>setScaleRefInches(e.target.value)} placeholder="6" className="no-spin" style={{flex:1,padding:"4px 8px",borderRadius:4,border:"1px solid rgba(139,92,246,0.3)",background:"rgb(var(--forge-surface) / 0.6)",color:"rgb(var(--text-body))",fontSize:12,outline:"none"}} />
                              <span style={{fontSize:11,color:"rgb(var(--text-subtle))"}}>in</span>
                            </div>
                          ) : (
                            <div style={{display:"flex",gap:4,alignItems:"center"}}>
                              <input type="number" step={scaleRefUnit==="mm"?"1":"0.5"} value={scaleRefLength} onChange={e=>setScaleRefLength(e.target.value)} placeholder={scaleRefUnit==="ft"?"e.g. 10":scaleRefUnit==="mm"?"e.g. 3000":"e.g. 120"} className="no-spin" style={{flex:1,padding:"4px 8px",borderRadius:4,border:"1px solid rgba(139,92,246,0.3)",background:"rgb(var(--forge-surface) / 0.6)",color:"rgb(var(--text-body))",fontSize:12,outline:"none"}} />
                              <span style={{fontSize:11,color:"rgb(var(--text-subtle))"}}>{scaleRefUnit}</span>
                            </div>
                          )}
                          <div style={{display:"flex",gap:4}}>
                            <button onClick={applyScaleReference} style={{flex:1,padding:"5px",borderRadius:4,fontSize:11,fontWeight:600,background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",color:"#22c55e",cursor:"pointer"}}>Apply Scale</button>
                            <button onClick={()=>{setIsScalingFloorPlan(false);setScaleRefPoints([]);setScaleRefLength("");setScaleRefInches("");setIsDrawingWall(false);}} style={{padding:"5px 8px",borderRadius:4,fontSize:11,background:"none",border:"1px solid rgba(239,68,68,0.3)",color:"#f87171",cursor:"pointer"}}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Display Size Guide */}
          <div style={{padding:"12px 20px",borderBottom:"1px solid rgb(var(--border))",opacity:1}}>
            <div style={{fontSize:14,fontWeight:600,color:"rgb(var(--text-subtle))",textTransform:"uppercase",marginBottom:3}}>Display Size Guide</div>
            <div style={{fontSize:12,fontStyle:"italic",color:"rgb(var(--text-faint))",marginBottom:8}}>Select the display wall to see its DISCAS calculation</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:10}}>
              {(["north","south","east","west"] as const).map(w => (
                <button
                  key={w}
                  onClick={() => setGuideWall(w)}
                  style={{
                    padding:"5px 0",borderRadius:6,fontSize:12,fontWeight:600,textTransform:"capitalize",cursor:"pointer",
                    border:"1px solid " + (guideWall===w ? "#8b5cf6" : "rgb(var(--border))"),
                    background: guideWall===w ? "rgba(139,92,246,0.15)" : "rgb(var(--forge-surface))",
                    color: guideWall===w ? "#a78bfa" : "rgb(var(--text-subtle))",
                  }}
                >
                  {w}
                </button>
              ))}
            </div>
            {/* Display aspect ratio — drives Calc. diagonal below. Displays
                aren't all 16:9 (LED walls/ultra-wide often aren't), so the
                diagonal a user actually shops for needs to match whatever's
                actually being planned, not an assumed default. */}
            <div style={{fontSize:11,color:"rgb(var(--text-faint))",marginBottom:4}}>Display aspect ratio</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:10}}>
              {guideAspectPresets.map(p => (
                <button
                  key={p.label}
                  onClick={() => setGuideAspectRatio(p.val)}
                  style={{
                    padding:"5px 0",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",
                    border:"1px solid " + (Math.abs(guideAspectRatio-p.val)<0.005 ? "#8b5cf6" : "rgb(var(--border))"),
                    background: Math.abs(guideAspectRatio-p.val)<0.005 ? "rgba(139,92,246,0.15)" : "rgb(var(--forge-surface))",
                    color: Math.abs(guideAspectRatio-p.val)<0.005 ? "#a78bfa" : "rgb(var(--text-subtle))",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{padding:10,background:"rgba(139,92,246,0.06)",border:"1px solid rgba(139,92,246,0.15)",borderRadius:8}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:15,color:"rgb(var(--text-muted))",marginBottom:6}}>
                <span>Room width</span><span style={{fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))"}}>{validRoom ? toDisplay(effectiveWidth) : "—"}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:15,color:"rgb(var(--text-muted))",marginBottom:6}}>
                <span>Room depth</span><span style={{fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))"}}>{validRoom ? toDisplay(effectiveDepth) : "—"}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:15,color:"rgb(var(--text-muted))",marginBottom:6}}>
                <span>Farthest viewer</span><span style={{fontFamily:"'JetBrains Mono',monospace",color:"#a78bfa"}}>{validRoom ? toDisplay(farthestViewer) : "—"}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:15,color:"rgb(var(--text-muted))",marginBottom:6,gap:8}}>
                <span style={{display:"flex",alignItems:"center",gap:5}}>
                  Bottom of image height
                  {validRoom && editingGuideField !== "bottomImageHeight" && (
                    <button onClick={() => beginEditGuideField("bottomImageHeight")} title="Edit bottom of image height"
                      style={{display:"flex",padding:2,background:"none",border:"none",cursor:"pointer",color:"rgb(var(--text-faint))"}}
                      onMouseEnter={e=>e.currentTarget.style.color="#a78bfa"} onMouseLeave={e=>e.currentTarget.style.color="rgb(var(--text-faint))"}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  )}
                  {bihOverride !== null && editingGuideField !== "bottomImageHeight" && (
                    <button onClick={() => resetGuideField("bottomImageHeight")} title="Reset to default (42&quot;)"
                      style={{fontSize:10,color:"rgb(var(--text-faint))",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>
                      reset
                    </button>
                  )}
                </span>
                {editingGuideField === "bottomImageHeight" ? (
                  <input
                    ref={guideFieldInputRef}
                    value={guideFieldInput}
                    onChange={e => setGuideFieldInput(e.target.value)}
                    onBlur={() => commitGuideFieldEdit(true)}
                    onKeyDown={e => { if (e.key === "Enter") commitGuideFieldEdit(); else if (e.key === "Escape") { setEditingGuideField(null); setGuideFieldInput(""); } }}
                    style={{width:80,fontFamily:"'JetBrains Mono',monospace",fontSize:14,textAlign:"right",background:"rgb(var(--forge-bg))",border:"1px solid #8b5cf6",borderRadius:4,color:"rgb(var(--text-body))",padding:"2px 4px"}}
                  />
                ) : (
                  <span style={{fontFamily:"'JetBrains Mono',monospace",color: bihOverride !== null ? "#a78bfa" : "rgb(var(--text-body))"}}>{validRoom ? toDisplay(bihFt) : "—"}</span>
                )}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:15,color:"rgb(var(--text-muted))",marginBottom:6,gap:8}}>
                <span style={{display:"flex",alignItems:"center",gap:5}}>
                  Closest viewer
                  {validRoom && editingGuideField !== "discasClosestViewer" && (
                    <button onClick={() => beginEditGuideField("discasClosestViewer")} title="Edit closest viewer"
                      style={{display:"flex",padding:2,background:"none",border:"none",cursor:"pointer",color:"rgb(var(--text-faint))"}}
                      onMouseEnter={e=>e.currentTarget.style.color="#a78bfa"} onMouseLeave={e=>e.currentTarget.style.color="rgb(var(--text-faint))"}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  )}
                  {discasClosestViewerOverride !== null && editingGuideField !== "discasClosestViewer" && (
                    <button onClick={() => resetGuideField("discasClosestViewer")} title="Reset to calculated default"
                      style={{fontSize:10,color:"rgb(var(--text-faint))",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>
                      reset
                    </button>
                  )}
                </span>
                {editingGuideField === "discasClosestViewer" ? (
                  <input
                    ref={guideFieldInputRef}
                    value={guideFieldInput}
                    onChange={e => setGuideFieldInput(e.target.value)}
                    onBlur={() => commitGuideFieldEdit(true)}
                    onKeyDown={e => { if (e.key === "Enter") commitGuideFieldEdit(); else if (e.key === "Escape") { setEditingGuideField(null); setGuideFieldInput(""); } }}
                    style={{width:80,fontFamily:"'JetBrains Mono',monospace",fontSize:14,textAlign:"right",background:"rgb(var(--forge-bg))",border:"1px solid #8b5cf6",borderRadius:4,color:"rgb(var(--text-body))",padding:"2px 4px"}}
                  />
                ) : (
                  <span style={{fontFamily:"'JetBrains Mono',monospace",color: discasClosestViewerOverride !== null ? "#a78bfa" : "rgb(var(--text-body))"}}>{validRoom ? toDisplay(effectiveDiscasClosestViewer) : "—"}</span>
                )}
              </div>
              <div style={{borderTop:"1px solid rgba(139,92,246,0.1)",margin:"6px 0",paddingTop:6,display:"flex",justifyContent:"space-between",fontSize:15,color:"rgb(var(--text-muted))"}}>
                <span>Req. image height</span><span style={{fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))"}}>{validRoom ? `${imageHeightIn.toFixed(1)}"` : "—"}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:15,color:"rgb(var(--text-muted))",marginBottom:6}}>
                <span>Calc. diagonal</span><span style={{fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))"}}>{validRoom ? `${reqDiagIn.toFixed(1)}"` : "—"}</span>
              </div>
              <div style={{borderTop:"1px solid rgba(139,92,246,0.15)",margin:"6px 0",paddingTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:15,fontWeight:600,color:"rgb(var(--text-body))"}}>Recommended</span>
                <span style={{fontSize:18,fontWeight:700,color:"#a78bfa",fontFamily:"'JetBrains Mono',monospace"}}>{validRoom ? `${recommendedSize}"` : "—"}</span>
              </div>
              <div style={{fontSize:13,color:"#475569",marginTop:4}}>AVIXA DISCAS · 3% element height · {guideAspectLabel}</div>
            </div>
          </div>

          {/* Camera Guide */}
          <div style={{padding:"12px 20px",borderBottom:"1px solid rgb(var(--border))",opacity:1}}>
            <div style={{fontSize:14,fontWeight:600,color:"rgb(var(--text-subtle))",textTransform:"uppercase",marginBottom:3}}>Camera Guide</div>
            <div style={{fontSize:12,fontStyle:"italic",color:"rgb(var(--text-faint))",marginBottom:8}}>Select the display wall to see its calculation</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:10}}>
              {(["north","south","east","west"] as const).map(w => (
                <button
                  key={w}
                  onClick={() => setGuideWall(w)}
                  style={{
                    padding:"5px 0",borderRadius:6,fontSize:12,fontWeight:600,textTransform:"capitalize",cursor:"pointer",
                    border:"1px solid " + (guideWall===w ? "#22c55e" : "rgb(var(--border))"),
                    background: guideWall===w ? "rgba(34,197,94,0.15)" : "rgb(var(--forge-surface))",
                    color: guideWall===w ? "#4ade80" : "rgb(var(--text-subtle))",
                  }}
                >
                  {w}
                </button>
              ))}
            </div>
            <div style={{padding:10,background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:8}}>
              {(["seatingWidth", "discasClosestViewer"] as const).map(field => {
                const label = field === "seatingWidth" ? "Seating width" : "Closest viewer";
                const value = field === "seatingWidth" ? effectiveSeatingWidth : effectiveDiscasClosestViewer;
                const overridden = (field === "seatingWidth" ? seatingWidthOverride : discasClosestViewerOverride) !== null;
                const isEditing = editingGuideField === field;
                return (
                  <div key={field} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:15,color:"rgb(var(--text-muted))",marginBottom:6,gap:8}}>
                    <span style={{display:"flex",alignItems:"center",gap:5}}>
                      {label}
                      {validRoom && !isEditing && (
                        <button onClick={() => beginEditGuideField(field)} title={`Edit ${label.toLowerCase()}`}
                          style={{display:"flex",padding:2,background:"none",border:"none",cursor:"pointer",color:"rgb(var(--text-faint))"}}
                          onMouseEnter={e=>e.currentTarget.style.color="#22c55e"} onMouseLeave={e=>e.currentTarget.style.color="rgb(var(--text-faint))"}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      )}
                      {overridden && !isEditing && (
                        <button onClick={() => resetGuideField(field)} title="Reset to calculated default"
                          style={{fontSize:10,color:"rgb(var(--text-faint))",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>
                          reset
                        </button>
                      )}
                    </span>
                    {isEditing ? (
                      <input
                        ref={guideFieldInputRef}
                        value={guideFieldInput}
                        onChange={e => setGuideFieldInput(e.target.value)}
                        onBlur={() => commitGuideFieldEdit(true)}
                        onKeyDown={e => { if (e.key === "Enter") commitGuideFieldEdit(); else if (e.key === "Escape") { setEditingGuideField(null); setGuideFieldInput(""); } }}
                        style={{width:80,fontFamily:"'JetBrains Mono',monospace",fontSize:14,textAlign:"right",background:"rgb(var(--forge-bg))",border:"1px solid #22c55e",borderRadius:4,color:"rgb(var(--text-body))",padding:"2px 4px"}}
                      />
                    ) : (
                      <span style={{fontFamily:"'JetBrains Mono',monospace",color: overridden ? "#22c55e" : "rgb(var(--text-body))"}}>{validRoom ? toDisplay(value) : "—"}</span>
                    )}
                  </div>
                );
              })}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:15,color:"rgb(var(--text-muted))",marginBottom:6}}>
                <span>Farthest viewer</span><span style={{fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))"}}>{validRoom ? toDisplay(farthestViewer) : "—"}</span>
              </div>
              <div style={{borderTop:"1px solid rgba(34,197,94,0.15)",margin:"6px 0",paddingTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:15,fontWeight:600,color:"rgb(var(--text-body))"}}>Req. HFOV</span>
                <span style={{fontSize:18,fontWeight:700,color:"#22c55e",fontFamily:"'JetBrains Mono',monospace"}}>{validRoom ? `${reqHFOV.toFixed(1)}°` : "—"}</span>
              </div>
              <div style={{fontSize:13,color:"#475569",marginTop:4}}>Horizontal FOV to cover closest viewers</div>
            </div>
          </div>




        </div>
      </div>

      {/* ── Right column: toolbar + canvas + BOM ── */}
      <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
        {/* Toolbar — only above canvas+BOM, not sidebar */}
        <div style={{background:"rgb(var(--forge-panel))",borderBottom:"2px solid rgb(var(--border))",flexShrink:0,userSelect:"none"}}>
          <div className="overflow-x-auto" style={{display:"flex",alignItems:"stretch",height:82,paddingLeft:4,paddingRight:12}}>
            {/* Create group */}
            <div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"5px 6px 0"}}>
              <div style={{display:"flex",gap:2,flex:1,alignItems:"stretch"}}>
                <button onClick={()=>{setShowAddModal(true);setModalSearch("");setModalSelected(null);setModalGlobalSearch(false);}} title="Add equipment to canvas"
                  style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"4px 12px",background:"transparent",border:"1px solid transparent",borderRadius:4,cursor:"pointer",transition:"all 0.15s",minWidth:56}}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgb(var(--forge-surface))";e.currentTarget.style.borderColor="rgb(var(--border))"}}
                  onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.borderColor="transparent"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--text-subtle))" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="8" width="7" height="13" rx="1"/><line x1="10" y1="9" x2="14" y2="9"/><line x1="10" y1="13" x2="14" y2="13"/>
                  </svg>
                  <span style={{fontSize:9,color:"rgb(var(--text-subtle))",lineHeight:1.3,whiteSpace:"nowrap",textAlign:"center"}}>Add<br/>Equipment</span>
                </button>
                <button onClick={requestScopeImport} disabled={generatingFromScope || !rdLoaded} title="Generate devices from this room's Site Survey Scope of Work"
                  style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"4px 12px",background:"transparent",border:"1px solid transparent",borderRadius:4,cursor:generatingFromScope?"default":"pointer",opacity:generatingFromScope?0.5:1,transition:"all 0.15s",minWidth:56}}
                  onMouseEnter={e=>{if(!generatingFromScope){e.currentTarget.style.background="rgb(var(--forge-surface))";e.currentTarget.style.borderColor="rgb(var(--border))"}}}
                  onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.borderColor="transparent"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#8b5cf6">
                    <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z"/>
                  </svg>
                  <span style={{fontSize:9,color:"rgb(var(--text-subtle))",lineHeight:1.3,whiteSpace:"nowrap",textAlign:"center"}}>{generatingFromScope?<>Generating…</>:<>Generate from<br/>Scope</>}</span>
                </button>
              </div>
              <span style={{fontSize:8,color:"rgb(var(--text-subtle))",textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"center",paddingBottom:2,paddingTop:2}}>Create</span>
            </div>

            {/* Divider */}
            <div style={{width:1,background:"rgb(var(--border))",margin:"6px 4px"}} />

            {/* Navigate group */}
            <div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"5px 6px 0"}}>
              <div style={{display:"flex",gap:2,flex:1,alignItems:"stretch"}}>
                <button onClick={()=>{setMoveMode(v=>!v);setPanMode(false);}} title="Move selected objects"
                  style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"4px 12px",background:moveMode?"rgba(139,92,246,0.12)":"transparent",border:`1px solid ${moveMode?"#8b5cf6":"transparent"}`,borderRadius:4,cursor:"pointer",transition:"all 0.15s",minWidth:48}}
                  onMouseEnter={e=>{if(!moveMode){e.currentTarget.style.background="rgb(var(--forge-surface))";e.currentTarget.style.borderColor="rgb(var(--border))"}}}
                  onMouseLeave={e=>{if(!moveMode){e.currentTarget.style.background="transparent";e.currentTarget.style.borderColor="transparent"}}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={moveMode?"#8b5cf6":"rgb(var(--text-subtle))"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
                  </svg>
                  <span style={{fontSize:9,color:moveMode?"#8b5cf6":"rgb(var(--text-subtle))",lineHeight:1.2,whiteSpace:"nowrap"}}>Move</span>
                </button>
                <button onClick={()=>{setPanMode(v=>!v);setMoveMode(false);}} title="Pan canvas"
                  style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"4px 12px",background:panMode?"rgba(139,92,246,0.12)":"transparent",border:`1px solid ${panMode?"#8b5cf6":"transparent"}`,borderRadius:4,cursor:"pointer",transition:"all 0.15s",minWidth:48}}
                  onMouseEnter={e=>{if(!panMode){e.currentTarget.style.background="rgb(var(--forge-surface))";e.currentTarget.style.borderColor="rgb(var(--border))"}}}
                  onMouseLeave={e=>{if(!panMode){e.currentTarget.style.background="transparent";e.currentTarget.style.borderColor="transparent"}}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={panMode?"#8b5cf6":"rgb(var(--text-subtle))"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8.5"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
                  </svg>
                  <span style={{fontSize:9,color:panMode?"#8b5cf6":"rgb(var(--text-subtle))",lineHeight:1.2,whiteSpace:"nowrap"}}>Pan</span>
                </button>
              </div>
              <span style={{fontSize:8,color:"rgb(var(--text-subtle))",textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"center",paddingBottom:2,paddingTop:2}}>Navigate</span>
            </div>

            {/* Divider */}
            <div style={{width:1,background:"rgb(var(--border))",margin:"6px 4px"}} />

            {/* Annotate group */}
            <div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"5px 6px 0"}}>
              <div style={{display:"flex",gap:2,flex:1,alignItems:"stretch"}}>
                {annotate.toolbarButtons}
              </div>
              <span style={{fontSize:8,color:"rgb(var(--text-subtle))",textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"center",paddingBottom:2,paddingTop:2}}>Annotate</span>
            </div>

            {/* Divider */}
            <div style={{width:1,background:"rgb(var(--border))",margin:"6px 4px"}} />

            {/* Elevation group */}
            <div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"5px 6px 0"}}>
              <div style={{display:"flex",gap:2,flex:1,alignItems:"stretch"}}>
                <button onClick={()=>{setPlacingElevationMarker(v=>!v);setPanMode(false);setMoveMode(false);}} title="Drop an elevation marker — right-click it to choose which walls (N/E/S/W) to view"
                  style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"4px 12px",background:placingElevationMarker?"rgba(139,92,246,0.12)":"transparent",border:`1px solid ${placingElevationMarker?"#8b5cf6":"transparent"}`,borderRadius:4,cursor:"pointer",transition:"all 0.15s",minWidth:48}}
                  onMouseEnter={e=>{if(!placingElevationMarker){e.currentTarget.style.background="rgb(var(--forge-surface))";e.currentTarget.style.borderColor="rgb(var(--border))"}}}
                  onMouseLeave={e=>{if(!placingElevationMarker){e.currentTarget.style.background="transparent";e.currentTarget.style.borderColor="transparent"}}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={placingElevationMarker?"#8b5cf6":"rgb(var(--text-subtle))"} strokeWidth={1.2} strokeLinejoin="round">
                    <polygon points="12,4.93 8.46,8.46 15.54,8.46" fill={placingElevationMarker?"#8b5cf6":"rgb(var(--text-subtle))"}/>
                    <polygon points="19.07,12 15.54,8.46 15.54,15.54" fill="none"/>
                    <polygon points="12,19.07 15.54,15.54 8.46,15.54" fill="none"/>
                    <polygon points="4.93,12 8.46,15.54 8.46,8.46" fill="none"/>
                    <circle cx="12" cy="12" r="5" fill="rgb(var(--forge-panel))"/>
                  </svg>
                  <span style={{fontSize:9,color:placingElevationMarker?"#8b5cf6":"rgb(var(--text-subtle))",lineHeight:1.2,whiteSpace:"nowrap"}}>Elevation</span>
                </button>
              </div>
              <span style={{fontSize:8,color:"rgb(var(--text-subtle))",textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"center",paddingBottom:2,paddingTop:2}}>Views</span>
            </div>

            {/* Spacer pushes export button to far right */}
            <div style={{flex:1}}/>
            <div style={{display:"flex",alignItems:"center",paddingRight:4}}>
              <button onClick={exportAsPDF} title="Export canvas as PDF"
                style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",background:"rgb(var(--forge-surface))",border:"1px solid rgb(var(--border))",borderRadius:6,cursor:"pointer",color:"rgb(var(--text-body))",fontSize:12,fontWeight:500,transition:"all 0.15s",whiteSpace:"nowrap"}}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(139,92,246,0.1)";e.currentTarget.style.borderColor="#8b5cf6";e.currentTarget.style.color="#8b5cf6";}}
                onMouseLeave={e=>{e.currentTarget.style.background="rgb(var(--forge-surface))";e.currentTarget.style.borderColor="rgb(var(--border))";e.currentTarget.style.color="rgb(var(--text-body))"}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/>
                </svg>
                Export PDF
              </button>
              <button onClick={exportDXF} title="Export floor plan as DXF (for AutoCAD)"
                style={{display:"flex",alignItems:"center",gap:6,marginLeft:6,padding:"7px 14px",background:"rgb(var(--forge-surface))",border:"1px solid rgb(var(--border))",borderRadius:6,cursor:"pointer",color:"rgb(var(--text-body))",fontSize:12,fontWeight:500,transition:"all 0.15s",whiteSpace:"nowrap"}}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(139,92,246,0.1)";e.currentTarget.style.borderColor="#8b5cf6";e.currentTarget.style.color="#8b5cf6";}}
                onMouseLeave={e=>{e.currentTarget.style.background="rgb(var(--forge-surface))";e.currentTarget.style.borderColor="rgb(var(--border))";e.currentTarget.style.color="rgb(var(--text-body))"}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                Export DXF
              </button>
            </div>
          </div>
        </div>
        {generateNotice && (
          <div style={{padding:"7px 16px",background:generateNotice.kind==="ok"?"rgba(34,197,94,0.14)":"rgba(239,68,68,0.14)",borderBottom:`1px solid ${generateNotice.kind==="ok"?"rgba(34,197,94,0.4)":"rgba(239,68,68,0.4)"}`,color:generateNotice.kind==="ok"?"#22c55e":"#ef4444",fontSize:11,textAlign:"center",flexShrink:0}}>
            {generateNotice.message}
          </div>
        )}
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* ── Canvas sections (scrollable) ───────────────── */}
      <div id="rd-canvas-export" style={{flex:1,overflowY:"auto"}}>
        <>
        {/* Row 1: Floor Plan / Ceiling Plan — side by side, drag the divider
            between them to resize. Only two plan views now (down from five):
            Ceiling Speakers + Ceiling Microphones merged into one Ceiling
            Plan showing every ceiling-mounted device, and Wall Speakers /
            Wall Microphones were dropped (already visible in Floor Plan). */}
        <div id="rd-print-title-plan" style={{flexShrink:0}}>
          <div style={{position:"relative",padding:"8px 16px",fontSize:12,fontWeight:700,color:"rgb(var(--text-muted))",textTransform:"uppercase",letterSpacing:"0.05em",textAlign:"center",textDecoration:"underline",textUnderlineOffset:"4px"}}>Floor Plan &amp; Ceiling Plan{collapseToggle("plan")}</div>
        </div>
        {/* Per-half labels — their own row above the resizable content row so
            the divider (a flex sibling of the two canvases below) only spans
            the canvas area instead of stretching up through the labels too. */}
        {!collapsedCanvases.has("plan") && (
          <div style={{display:"flex",flexShrink:0}}>
            <div style={{width:`${floorCeilSplit*100}%`,padding:"4px 10px",fontSize:10,fontWeight:700,color:"rgb(var(--text-subtle))",textTransform:"uppercase",letterSpacing:"0.05em",textAlign:"center",borderBottom:"1px solid rgb(var(--border))"}}>Floor Plan</div>
            <div style={{width:8,flexShrink:0,borderBottom:"1px solid rgb(var(--border))"}}/>
            <div style={{width:`${(1-floorCeilSplit)*100}%`,padding:"4px 10px",fontSize:10,fontWeight:700,color:"rgb(var(--text-subtle))",textTransform:"uppercase",letterSpacing:"0.05em",textAlign:"center",borderBottom:"1px solid rgb(var(--border))"}}>Ceiling Plan</div>
          </div>
        )}
        <div id="rd-print-page-plan" ref={floorCeilRowRef} style={{display:collapsedCanvases.has("plan")?"none":"flex",height:`${topRowHeightVh}vh`,minHeight:400,position:"relative"}}>
        {/* Floor Plan half */}
        <div style={{width:`${floorCeilSplit*100}%`,position:"relative",overflow:"hidden"}}>
        <div ref={canvasContainerRef} data-rd-canvas="plan" style={{position:"absolute",inset:0,background:cc.card,overflow:"hidden"}}>
        <svg ref={svgRef} width="100%" height="100%" viewBox={`${300-300/zoom-pan.x} ${210-210/zoom-pan.y} ${600/zoom} ${420/zoom}`}
          style={{background:cc.card,userSelect:"none",cursor:placingElevationMarker?"crosshair":(annotate.activeTool&&!isDrawingWall?annotate.cursor:null)||(isDrawingWall?"crosshair":isPanning?"grabbing":moveDragStart?"grabbing":wallStretchDrag?"move":dragUid?"grabbing":multiDrag?"grabbing":tableResizeDrag?(tableResizeDrag.edge==="left"||tableResizeDrag.edge==="right"?"ew-resize":"ns-resize"):wallDragEdge?(wallDragEdge==="east"||wallDragEdge==="west"?"ew-resize":"ns-resize"):moveMode?"move":panMode?"grab":"default")}}
          onMouseMove={e=>{if(elevMarkerDrag){handleElevMarkerMouseMove(e);return;}if((annotate.activeTool&&!isDrawingWall)||annotate.isDragging()){annotate.handleMove(e);return;}if(moveDragStart){handleMoveDrag(e);return;}handleRotDragMove(e);handleTableRotDragMove(e);handleNewDeviceDrag(e);handleNewChairDrag(e);handleNewTableDrag(e);handleNewDoorDrag(e);handleDoorDragMove(e);handleTableResizeMove(e);handleMultiDragMove(e);handleWallEdgeDrag(e);handleWallStretchMove(e);handleWallMouseMove(e);if(isPanning){const dx=(e.clientX-panStart.x)/zoom;const dy=(e.clientY-panStart.y)/zoom;setPan({x:panStart.px+dx,y:panStart.py+dy});return;}handleSvgMouseMove(e);handleCalloutMouseMove(e);handleMarqueeMove(e);}}
          onMouseUp={()=>{if(elevMarkerDrag){handleElevMarkerMouseUp();return;}if((annotate.activeTool&&!isDrawingWall)||annotate.isDragging()){annotate.handleUp();return;}if(moveDragStart){setMoveDragStart(null);return;}if(isPanning){setIsPanning(false);return;}handleMarqueeUp();handleSvgMouseUp();handleCalloutMouseUp();}}
          onMouseLeave={()=>{if(elevMarkerDrag){handleElevMarkerMouseUp();return;}if(annotate.isDragging()){annotate.handleLeave();return;}annotate.handleLeave();if(moveDragStart){setMoveDragStart(null);return;}if(isPanning){setIsPanning(false);return;}handleMarqueeUp();handleSvgMouseUp();handleCalloutMouseUp();}}
          onDoubleClick={e=>{if(annotate.activeTool&&!isDrawingWall){annotate.handleDoubleClick(e);}}}
          onDragOver={acceptBomUnit} onDrop={e=>dropBomUnit(e,"plan")}
          onMouseDown={e=>{if(placingElevationMarker)return;if(annotate.activeTool&&!isDrawingWall&&e.button===0){annotate.handleDown(e);return;}suppressClickClear.current=false;if(e.button===0&&moveMode&&(selectedUid!==null||selectedUids.size>0||selected.size>0||annotate.hasSelection)){e.preventDefault();pushUndo();if(annotate.hasSelection)annotate.beginChange();const svg=svgRef.current;if(!svg)return;const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const svgP=pt.matrixTransform(svg.getScreenCTM()!.inverse());setMoveDragStart({x:svgP.x,y:svgP.y});}else if((e.button===1||(e.button===0&&panMode))&&!lockedViews.plan){e.preventDefault();setIsPanning(true);setPanStart({x:e.clientX,y:e.clientY,px:pan.x,py:pan.y});}else if(e.button===0&&!isDrawingWall&&!dragNewChair?.active&&!dragNewTable?.active&&!dragNewDoor?.active){const svg=svgRef.current;if(!svg)return;const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const svgP=pt.matrixTransform(svg.getScreenCTM()!.inverse());setMarquee({startSvgX:svgP.x,startSvgY:svgP.y,curSvgX:svgP.x,curSvgY:svgP.y});}}}
          onClick={e=>{if(placingElevationMarker){const pos=screenToWorld(e);if(pos)placeElevationMarker(pos);return;}if(annotate.activeTool&&!isDrawingWall){return;}if(isDrawingWall){handleWallClick(e);return;}if(dragNewChair?.active){handleNewChairDrop();return;}if(dragNewTable?.active){handleNewTableDrop();return;}if(dragNewDoor?.active){handleNewDoorDrop();return;}if(didMarqueeDrag.current){didMarqueeDrag.current=false;return;}if(suppressClickClear.current){suppressClickClear.current=false;return;}if(!isPanning){if(wallEdgeClicked.current){wallEdgeClicked.current=false;return;}setSelectedUid(null);setSelectedEdge(null);clearSelection();annotate.clearSelection();setSelectedElevationId(null);}}}>

          {viewMode==="plan" ? (
            <g>
              <defs>
                <clipPath id="roomClip">
                  <rect x={pX(0)} y={pY(0)} width={roomW*planScale} height={roomL*planScale}/>
                </clipPath>
              </defs>
              {!isCustomBlank && (
                <>
                  <rect x={pX(0)} y={pY(0)} width={roomW*planScale} height={roomL*planScale} fill="none" stroke="none" />
                  {/* Individual wall lines — skip deleted walls */}
                  {!deletedWalls.has("north") && <line x1={pX(0)} y1={pY(0)} x2={pX(roomW)} y2={pY(0)} stroke={selectedEdge==="north"?"#8b5cf6":"#b0b5be"} strokeWidth={selectedEdge==="north"?3:2} />}
                  {!deletedWalls.has("south") && <line x1={pX(0)} y1={pY(roomL)} x2={pX(roomW)} y2={pY(roomL)} stroke={selectedEdge==="south"?"#8b5cf6":"#b0b5be"} strokeWidth={selectedEdge==="south"?3:2} />}
                  {!deletedWalls.has("west") && <line x1={pX(0)} y1={pY(0)} x2={pX(0)} y2={pY(roomL)} stroke={selectedEdge==="west"?"#8b5cf6":"#b0b5be"} strokeWidth={selectedEdge==="west"?3:2} />}
                  {!deletedWalls.has("east") && <line x1={pX(roomW)} y1={pY(0)} x2={pX(roomW)} y2={pY(roomL)} stroke={selectedEdge==="east"?"#8b5cf6":"#b0b5be"} strokeWidth={selectedEdge==="east"?3:2} />}
                  {/* Dashed lines for deleted walls */}
                  {deletedWalls.has("north") && <line x1={pX(0)} y1={pY(0)} x2={pX(roomW)} y2={pY(0)} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />}
                  {deletedWalls.has("south") && <line x1={pX(0)} y1={pY(roomL)} x2={pX(roomW)} y2={pY(roomL)} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />}
                  {deletedWalls.has("west") && <line x1={pX(0)} y1={pY(0)} x2={pX(0)} y2={pY(roomL)} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />}
                  {deletedWalls.has("east") && <line x1={pX(roomW)} y1={pY(0)} x2={pX(roomW)} y2={pY(roomL)} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />}
                </>
              )}
              {/* Floor plan image overlay — sized from its own calibrated
                  real-world width (floorPlanWidthFt), not stretched to fill
                  the room rectangle, so Set Scale actually has a visible
                  effect. Height follows from the image's native aspect
                  ratio, so it can never look stretched/squashed. Deliberately
                  NOT clipped to the room rectangle (roomClip): a real floor
                  plan is almost always bigger than just this one room —
                  clipping to roomClip here used to be harmless only because
                  the image was always force-sized to exactly match the room;
                  now that Set Scale can legitimately make it larger, that
                  same clip would silently crop away everything past the
                  room's own walls (reported as "hid half the floor plan"
                  after calibrating a bigger scale) instead of leaving the
                  rest visible to pan/zoom around. */}
              {floorPlanImg && floorPlanNativeSize && (() => {
                const imgHFt = floorPlanWidthFt * (floorPlanNativeSize.h / floorPlanNativeSize.w);
                return (
                  <image
                    href={floorPlanImg}
                    x={pX(floorPlanOffset.x)}
                    y={pY(floorPlanOffset.y)}
                    width={floorPlanWidthFt * planScale}
                    height={imgHFt * planScale}
                    preserveAspectRatio="xMidYMid meet"
                    opacity={0.5}
                  />
                );
              })()}
              {!isCustomBlank ? (
                <g clipPath="url(#roomClip)">
                </g>
              ) : (
                <g>
                  {/* Faint reference grid for custom blank mode */}
                  {Array.from({length:Math.ceil(roomW)+1},(_,i)=>(<line key={"cgw"+i} x1={pX(i)} y1={pY(0)} x2={pX(i)} y2={pY(roomL)} stroke="rgb(var(--border))" strokeWidth={0.2} opacity={0.3}/>))}
                  {Array.from({length:Math.ceil(roomL)+1},(_,i)=>(<line key={"cgl"+i} x1={pX(0)} y1={pY(i)} x2={pX(roomW)} y2={pY(i)} stroke="rgb(var(--border))" strokeWidth={0.2} opacity={0.3}/>))}
                  {/* Origin crosshair */}
                  <line x1={pX(roomW/2)-8} y1={pY(roomL/2)} x2={pX(roomW/2)+8} y2={pY(roomL/2)} stroke="rgb(var(--text-faint))" strokeWidth={0.5} opacity={0.5}/>
                  <line x1={pX(roomW/2)} y1={pY(roomL/2)-8} x2={pX(roomW/2)} y2={pY(roomL/2)+8} stroke="rgb(var(--text-faint))" strokeWidth={0.5} opacity={0.5}/>
                  {/* Drawn room dimensions — oriented along wall direction */}
                  {drawnWalls.length > 0 && (() => {
                    // Compute centroid of all wall endpoints to determine "inside"
                    const allPts: {x:number;y:number}[] = [];
                    drawnWalls.forEach(dev => {
                      const a = dev.wallAngle!;
                      const l = dev.w;
                      allPts.push(
                        { x: dev.x - Math.cos(a) * l / 2, y: dev.y - Math.sin(a) * l / 2 },
                        { x: dev.x + Math.cos(a) * l / 2, y: dev.y + Math.sin(a) * l / 2 },
                      );
                    });
                    const cx = allPts.reduce((s, p) => s + p.x, 0) / allPts.length;
                    const cy = allPts.reduce((s, p) => s + p.y, 0) / allPts.length;
                    return (
                      <g>
                        {drawnWalls.map(dev => {
                          const angle = dev.wallAngle!;
                          const len = dev.w;
                          const mx = dev.x, my = dev.y;
                          // Perpendicular to wall (two possible directions)
                          const nx = -Math.sin(angle), ny = Math.cos(angle);
                          // Pick the outward direction (away from centroid)
                          const toCenterX = cx - mx, toCenterY = cy - my;
                          const dot = toCenterX * nx + toCenterY * ny;
                          const outX = dot > 0 ? -nx : nx;
                          const outY = dot > 0 ? -ny : ny;
                          // Label position: offset outward from wall midpoint
                          const labelOff = 0.55;
                          const lx = mx + outX * labelOff;
                          const ly = my + outY * labelOff;
                          // Rotation angle for text to align with wall direction
                          let textAngleDeg = angle * (180 / Math.PI);
                          // Keep text readable (not upside down)
                          if (textAngleDeg > 90) textAngleDeg -= 180;
                          if (textAngleDeg < -90) textAngleDeg += 180;
                          return (
                            <text
                              key={"wdim"+dev.uid}
                              x={pX(lx)}
                              y={pY(ly)}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize={9}
                              fill="rgb(var(--text-subtle))"
                              fontFamily="'JetBrains Mono',monospace"
                              transform={`rotate(${textAngleDeg},${pX(lx)},${pY(ly)})`}
                            >{toDisplay(len)}</text>
                          );
                        })}
                      </g>
                    );
                  })()}
                </g>
              )}
              {/* Scale reference line */}
              {isScalingFloorPlan && scaleRefPoints.length > 0 && (
                <g>
                  {scaleRefPoints.map((pt, i) => (
                    <circle key={i} cx={pX(pt.x)} cy={pY(pt.y)} r={4} fill="#22c55e" stroke="#fff" strokeWidth={1} />
                  ))}
                  {scaleRefPoints.length === 2 && (
                    <line x1={pX(scaleRefPoints[0].x)} y1={pY(scaleRefPoints[0].y)} x2={pX(scaleRefPoints[1].x)} y2={pY(scaleRefPoints[1].y)} stroke="#22c55e" strokeWidth={2} strokeDasharray="4 3" />
                  )}
                </g>
              )}
              {/* Wall drawing preview — show placed points and line to cursor */}
              {isDrawingWall && !isScalingFloorPlan && wallPoints.length > 0 && (
                <g>
                  {/* Object snap tracking guides — dashed line from reference point to cursor */}
                  {wallMousePos && trackGuides.map((g, i) => (
                    <g key={"tg"+i}>
                      <line x1={pX(g.from.x)} y1={pY(g.from.y)} x2={pX(g.to.x)} y2={pY(g.to.y)} stroke="#22c55e" strokeWidth={1} strokeDasharray="2 4" opacity={0.9} />
                      <rect x={pX(g.from.x)-3.5} y={pY(g.from.y)-3.5} width={7} height={7} fill="none" stroke="#22c55e" strokeWidth={1.5} />
                    </g>
                  ))}
                  {/* Cross marker at the tracked cursor position */}
                  {wallMousePos && trackGuides.length > 0 && (
                    <g stroke="#22c55e" strokeWidth={1.5}>
                      <line x1={pX(wallMousePos.x)-5} y1={pY(wallMousePos.y)} x2={pX(wallMousePos.x)+5} y2={pY(wallMousePos.y)} />
                      <line x1={pX(wallMousePos.x)} y1={pY(wallMousePos.y)-5} x2={pX(wallMousePos.x)} y2={pY(wallMousePos.y)+5} />
                    </g>
                  )}
                  {/* Lines between placed points */}
                  {wallPoints.map((pt, i) => i > 0 ? (
                    <line key={"wp"+i} x1={pX(wallPoints[i-1].x)} y1={pY(wallPoints[i-1].y)} x2={pX(pt.x)} y2={pY(pt.y)} stroke={drawingWallType==="solid"?"#475569":"#8b5cf6"} strokeWidth={drawingWallType==="solid"?4:2} opacity={0.55} />
                  ) : null)}
                  {/* Line from last point to cursor + live dimension label */}
                  {wallMousePos && (() => {
                    const last = wallPoints[wallPoints.length - 1];
                    const x1 = pX(last.x), y1 = pY(last.y);
                    const x2 = pX(wallMousePos.x), y2 = pY(wallMousePos.y);
                    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                    const dx = wallMousePos.x - last.x, dy = wallMousePos.y - last.y;
                    const len = Math.sqrt(dx*dx + dy*dy);
                    const label = toDisplay(len);
                    return (
                      <g>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={drawingWallType==="solid"?"#475569":"#8b5cf6"} strokeWidth={drawingWallType==="solid"?4:2} strokeDasharray={drawingWallType==="solid"?undefined:"4 3"} opacity={0.7} />
                        <rect x={mx - 26} y={my - 9} width={52} height={16} rx={4} fill="rgb(var(--forge-bg))" stroke="#8b5cf6" strokeWidth={1} opacity={0.92} />
                        <text x={mx} y={my + 3} textAnchor="middle" fontSize={9} fontWeight={600} fill="#a78bfa" fontFamily="'JetBrains Mono',monospace">{label}</text>
                      </g>
                    );
                  })()}
                  {/* Point markers */}
                  {wallPoints.map((pt, i) => (
                    <circle key={"wpc"+i} cx={pX(pt.x)} cy={pY(pt.y)} r={i === 0 ? 5 : 3} fill={i === 0 ? "#8b5cf6" : "#a78bfa"} stroke="#fff" strokeWidth={1} />
                  ))}
                  {/* Snap indicator on first point */}
                  {wallPoints.length >= 2 && wallMousePos && (() => {
                    const first = wallPoints[0];
                    const dx = wallMousePos.x - first.x;
                    const dy = wallMousePos.y - first.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    return dist < WALL_SNAP_DIST ? (
                      <circle cx={pX(first.x)} cy={pY(first.y)} r={8} fill="none" stroke="#22c55e" strokeWidth={2} opacity={0.8} />
                    ) : null;
                  })()}
                </g>
              )}
              {/* Wall stretch overlay — tracking guides + live length while dragging an endpoint */}
              {wallStretchDrag && (() => {
                const dev = placedDevices.find(d => d.uid === wallStretchDrag.uid);
                if (!dev || dev.wallAngle === undefined) return null;
                const half = dev.w / 2;
                const gx = wallStretchDrag.end === 0 ? dev.x - Math.cos(dev.wallAngle)*half : dev.x + Math.cos(dev.wallAngle)*half;
                const gy = wallStretchDrag.end === 0 ? dev.y - Math.sin(dev.wallAngle)*half : dev.y + Math.sin(dev.wallAngle)*half;
                const mx = pX(dev.x), my = pY(dev.y);
                return (
                  <g pointerEvents="none">
                    {trackGuides.map((g, i) => (
                      <g key={"sg"+i}>
                        <line x1={pX(g.from.x)} y1={pY(g.from.y)} x2={pX(g.to.x)} y2={pY(g.to.y)} stroke="#22c55e" strokeWidth={1} strokeDasharray="2 4" opacity={0.9} />
                        <rect x={pX(g.from.x)-3.5} y={pY(g.from.y)-3.5} width={7} height={7} fill="none" stroke="#22c55e" strokeWidth={1.5} />
                      </g>
                    ))}
                    {trackGuides.length > 0 && (
                      <g stroke="#22c55e" strokeWidth={1.5}>
                        <line x1={pX(gx)-5} y1={pY(gy)} x2={pX(gx)+5} y2={pY(gy)} />
                        <line x1={pX(gx)} y1={pY(gy)-5} x2={pX(gx)} y2={pY(gy)+5} />
                      </g>
                    )}
                    <rect x={mx - 26} y={my - 24} width={52} height={16} rx={4} fill="rgb(var(--forge-bg))" stroke="#8b5cf6" strokeWidth={1} opacity={0.92} />
                    <text x={mx} y={my - 12} textAnchor="middle" fontSize={9} fontWeight={600} fill="#a78bfa" fontFamily="'JetBrains Mono',monospace">{toDisplay(dev.w)}</text>
                  </g>
                );
              })()}
              {/* Endpoint snap marker — square over the endpoint the cursor is locked onto */}
              {(isDrawingWall || wallStretchDrag || (dragUid !== null && placedDevices.some(d => d.uid === dragUid && d.id === "wall-partition"))) && !isScalingFloorPlan && wallSnapPoint && (
                <g pointerEvents="none">
                  <rect x={pX(wallSnapPoint.x)-5} y={pY(wallSnapPoint.y)-5} width={10} height={10} fill="none" stroke="#22c55e" strokeWidth={2} />
                  <circle cx={pX(wallSnapPoint.x)} cy={pY(wallSnapPoint.y)} r={1.5} fill="#22c55e" />
                </g>
              )}
              {!isCustomBlank && (
                <>
                  <text x={pX(roomW/2)} y={Math.max(10, pY(0)-20)} textAnchor="middle" fontSize={9} fill="rgb(var(--text-subtle))" fontFamily="'JetBrains Mono',monospace">Front Wall</text>
                  <text x={pX(roomW/2)} y={pY(roomL)+22} textAnchor="middle" fontSize={9} fill="rgb(var(--text-subtle))" fontFamily="'JetBrains Mono',monospace">{toDisplay(roomW)}</text>
                  <text x={pX(0)-18} y={pY(roomL/2)} textAnchor="end" fontSize={9} fill="rgb(var(--text-subtle))" fontFamily="'JetBrains Mono',monospace" transform={`rotate(-90,${pX(0)-18},${pY(roomL/2)})`}>{toDisplay(roomL)}</text>
                </>
              )}

              {/* Draggable wall edge handles */}
              {!isDrawingWall && !isCustomBlank && (
                <g>
                  {/* North wall (top) */}
                  <line x1={pX(0)} y1={pY(0)} x2={pX(roomW)} y2={pY(0)} stroke="transparent" strokeWidth={8} cursor="ns-resize"
                    onMouseDown={e=>handleWallEdgeDown("north",e)}
                    onMouseEnter={e=>{(e.target as SVGLineElement).setAttribute("stroke","rgba(139,92,246,0.4)")}}
                    onMouseLeave={e=>{(e.target as SVGLineElement).setAttribute("stroke","transparent")}} />
                  {/* South wall (bottom) */}
                  <line x1={pX(0)} y1={pY(roomL)} x2={pX(roomW)} y2={pY(roomL)} stroke="transparent" strokeWidth={8} cursor="ns-resize"
                    onMouseDown={e=>handleWallEdgeDown("south",e)}
                    onMouseEnter={e=>{(e.target as SVGLineElement).setAttribute("stroke","rgba(139,92,246,0.4)")}}
                    onMouseLeave={e=>{(e.target as SVGLineElement).setAttribute("stroke","transparent")}} />
                  {/* West wall (left) */}
                  <line x1={pX(0)} y1={pY(0)} x2={pX(0)} y2={pY(roomL)} stroke="transparent" strokeWidth={8} cursor="ew-resize"
                    onMouseDown={e=>handleWallEdgeDown("west",e)}
                    onMouseEnter={e=>{(e.target as SVGLineElement).setAttribute("stroke","rgba(139,92,246,0.4)")}}
                    onMouseLeave={e=>{(e.target as SVGLineElement).setAttribute("stroke","transparent")}} />
                  {/* East wall (right) */}
                  <line x1={pX(roomW)} y1={pY(0)} x2={pX(roomW)} y2={pY(roomL)} stroke="transparent" strokeWidth={8} cursor="ew-resize"
                    onMouseDown={e=>handleWallEdgeDown("east",e)}
                    onMouseEnter={e=>{(e.target as SVGLineElement).setAttribute("stroke","rgba(139,92,246,0.4)")}}
                    onMouseLeave={e=>{(e.target as SVGLineElement).setAttribute("stroke","transparent")}} />
                  {/* Highlight active drag edge */}
                  {wallDragEdge === "north" && <line x1={pX(0)} y1={pY(0)} x2={pX(roomW)} y2={pY(0)} stroke="#8b5cf6" strokeWidth={3} pointerEvents="none" />}
                  {wallDragEdge === "south" && <line x1={pX(0)} y1={pY(roomL)} x2={pX(roomW)} y2={pY(roomL)} stroke="#8b5cf6" strokeWidth={3} pointerEvents="none" />}
                  {wallDragEdge === "west" && <line x1={pX(0)} y1={pY(0)} x2={pX(0)} y2={pY(roomL)} stroke="#8b5cf6" strokeWidth={3} pointerEvents="none" />}
                  {wallDragEdge === "east" && <line x1={pX(roomW)} y1={pY(0)} x2={pX(roomW)} y2={pY(roomL)} stroke="#8b5cf6" strokeWidth={3} pointerEvents="none" />}
                  {/* Delete button on selected wall */}
                  {selectedEdge && !deletedWalls.has(selectedEdge) && (() => {
                    let bx = 0, by = 0;
                    if (selectedEdge === "north") { bx = pX(roomW/2); by = pY(0) - 16; }
                    else if (selectedEdge === "south") { bx = pX(roomW/2); by = pY(roomL) + 16; }
                    else if (selectedEdge === "west") { bx = pX(0) - 16; by = pY(roomL/2); }
                    else if (selectedEdge === "east") { bx = pX(roomW) + 16; by = pY(roomL/2); }
                    return (
                      <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); pushUndo(); setDeletedWalls(prev => { const next = new Set(prev); next.add(selectedEdge!); return next; }); setSelectedEdge(null); }}>
                        <circle cx={bx} cy={by} r={10} fill="#ef4444" />
                        <path d="M-4,-4 L4,4 M4,-4 L-4,4" transform={`translate(${bx},${by})`} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
                      </g>
                    );
                  })()}
                  {/* Restore button on deleted wall */}
                  {selectedEdge && deletedWalls.has(selectedEdge) && (() => {
                    let bx = 0, by = 0;
                    if (selectedEdge === "north") { bx = pX(roomW/2); by = pY(0) - 16; }
                    else if (selectedEdge === "south") { bx = pX(roomW/2); by = pY(roomL) + 16; }
                    else if (selectedEdge === "west") { bx = pX(0) - 16; by = pY(roomL/2); }
                    else if (selectedEdge === "east") { bx = pX(roomW) + 16; by = pY(roomL/2); }
                    return (
                      <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); pushUndo(); setDeletedWalls(prev => { const next = new Set(prev); next.delete(selectedEdge!); return next; }); setSelectedEdge(null); }}>
                        <circle cx={bx} cy={by} r={10} fill="#22c55e" />
                        <path d="M-4,0 L0,4 L4,-3" transform={`translate(${bx},${by})`} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </g>
                    );
                  })()}
                </g>
              )}

              {showTable && (() => {
                const tcx2 = pX(tableCenterX ?? roomW/2);
                const tcy2 = pY(tableWallDist + tL/2);
                const tRotHandleR = Math.max(tW, tL) * planScale / 2 + 20;
                const tRotRad = (tableRotation - 90) * Math.PI / 180;
                const trhx = tcx2 + tRotHandleR * Math.cos(tRotRad);
                const trhy = tcy2 + tRotHandleR * Math.sin(tRotRad);
                const tSel = isItemSelected("table");
                return (
                  <>
                    <g transform={`rotate(${tableRotation},${tcx2},${tcy2})`}>
                      {renderPlanTable()}
                    </g>
                    {/* Table edit-size handle — pencil/resize button */}
                    {tSel && (
                      <>
                        <line x1={tcx2} y1={tcy2} x2={trhx} y2={trhy} stroke="#16a34a" strokeWidth={1} strokeDasharray="2 2" opacity={0.6}/>
                        <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); setTableEditW(String(Math.round(tW * 10) / 10)); setTableEditL(String(Math.round(tL * 10) / 10)); setShowTableSizeEditor(true); }}>
                          <circle cx={trhx} cy={trhy} r={13} fill="#16a34a" stroke="#fff" strokeWidth={1.5}/>
                          <text x={trhx} y={trhy} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight="700" fill="#fff" style={{pointerEvents:"none",userSelect:"none"}}>W/L</text>
                        </g>
                      </>
                    )}
                  </>
                );
              })()}

              {/* Table drag preview from sidebar */}
              {dragNewTable?.active && (() => {
                const pw = 4 * planScale;
                const ph = 8 * planScale;
                return (
                  <g opacity={0.5}>
                    {dragNewTable.alignRef && (
                      <line x1={pX(dragNewTable.alignRef.x)} y1={pY(dragNewTable.alignRef.y)} x2={pX(dragNewTable.worldX)} y2={pY(dragNewTable.worldY)} stroke="#22c55e" strokeWidth={1} strokeDasharray="2 4" />
                    )}
                    <rect x={pX(dragNewTable.worldX) - pw/2} y={pY(dragNewTable.worldY) - ph/2} width={pw} height={ph} rx={3} fill="#cbd5e1" fillOpacity={0.3} stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 3" />
                    <text x={pX(dragNewTable.worldX)} y={pY(dragNewTable.worldY)} textAnchor="middle" dominantBaseline="central" fontSize={9} fill="#8b5cf6">Table</text>
                  </g>
                );
              })()}

              {/* Device drag preview from sidebar */}
              {dragNewDevice?.active && (() => {
                const item = dragNewDevice.item;
                const isWallMount = item.wall === "front" || item.wall === "side";
                const isCeiling = item.wall === "ceiling";
                if (isWallMount && dragNewDevice.wall) {
                  const wall = dragNewDevice.wall;
                  const dw = item.w * planScale;
                  let rx2: number, ry2: number, rw2: number, rh2: number;
                  const wx = Math.max(0, Math.min(roomW, dragNewDevice.worldX));
                  const wy = Math.max(0, Math.min(roomL, dragNewDevice.worldY));
                  if (wall === "north") { rx2 = pX(wx) - dw / 2; ry2 = pY(0) + 2; rw2 = dw; rh2 = 6; }
                  else if (wall === "south") { rx2 = pX(wx) - dw / 2; ry2 = pY(roomL) - 8; rw2 = dw; rh2 = 6; }
                  else if (wall === "west") { rx2 = pX(0) + 2; ry2 = pY(wy) - dw / 2; rw2 = 6; rh2 = dw; }
                  else { rx2 = pX(roomW) - 8; ry2 = pY(wy) - dw / 2; rw2 = 6; rh2 = dw; }
                  return (
                    <g opacity={0.6}>
                      <rect x={rx2!} y={ry2!} width={rw2!} height={rh2!} rx={2} fill="#8b5cf6" fillOpacity={0.3} stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" />
                      <text x={rx2! + rw2! / 2} y={ry2! - 6} textAnchor="middle" fontSize={7} fill="#8b5cf6">{item.name}</text>
                    </g>
                  );
                }
                if (isCeiling) {
                  return (
                    <g opacity={0.6}>
                      <circle cx={pX(dragNewDevice.worldX)} cy={pY(dragNewDevice.worldY)} r={8} fill="#8b5cf6" fillOpacity={0.2} stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" />
                      <text x={pX(dragNewDevice.worldX)} y={pY(dragNewDevice.worldY) - 12} textAnchor="middle" fontSize={7} fill="#8b5cf6">{item.name}</text>
                    </g>
                  );
                }
                // Floor device
                const fw = item.w * planScale;
                const fh = item.h * planScale;
                return (
                  <g opacity={0.6}>
                    <rect x={pX(dragNewDevice.worldX) - fw / 2} y={pY(dragNewDevice.worldY) - fh / 2} width={fw} height={fh} rx={3} fill="#8b5cf6" fillOpacity={0.2} stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" />
                    <text x={pX(dragNewDevice.worldX)} y={pY(dragNewDevice.worldY) - fh / 2 - 6} textAnchor="middle" fontSize={7} fill="#8b5cf6">{item.name}</text>
                  </g>
                );
              })()}

              {/* Chair drag preview from sidebar */}
              {dragNewChair?.active && (() => {
                const cW2 = Math.max(6, 1.48 * planScale);
                const rx2 = Math.max(1, cW2 * 0.18);
                const cx2 = pX(dragNewChair.worldX);
                const cy2 = pY(dragNewChair.worldY);
                return (
                  <g opacity={0.5}>
                    {dragNewChair.alignRef && (
                      <line x1={pX(dragNewChair.alignRef.x)} y1={pY(dragNewChair.alignRef.y)} x2={cx2} y2={cy2} stroke="#22c55e" strokeWidth={1} strokeDasharray="2 4" />
                    )}
                    <rect x={cx2-cW2/2} y={cy2-cW2/2} width={cW2} height={cW2} rx={rx2} fill="#d1d5db" stroke="#8b5cf6" strokeWidth={1} />
                  </g>
                );
              })()}

              {/* Drawn walls */}
              {placedDevices.filter(d => d.id === "wall-partition" && d.wallAngle !== undefined).map(dev => {
                const angle = dev.wallAngle!;
                const len = dev.w;
                const x1 = dev.x - Math.cos(angle) * len / 2;
                const y1 = dev.y - Math.sin(angle) * len / 2;
                const x2 = dev.x + Math.cos(angle) * len / 2;
                const y2 = dev.y + Math.sin(angle) * len / 2;
                const isSelected = selectedUid === dev.uid || selectedUids.has(dev.uid);
                const midX = pX(dev.x);
                const midY = pY(dev.y);
                const isVerticalWall = Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle));
                // Keep wall actions away from the dimension label: vertical-wall
                // dimensions sit to the left, horizontal-wall dimensions sit above.
                const pencilX = isVerticalWall ? midX + 14 : midX - 9;
                const pencilY = isVerticalWall ? midY : midY + 14;
                const deleteX = isVerticalWall ? midX + 32 : midX + 9;
                const deleteY = pencilY;
                const lengthInputX = isVerticalWall ? midX + 10 : midX - 46;
                const lengthInputY = isVerticalWall ? midY - 13 : midY + 10;
                return (
                  <g key={dev.uid}
                    style={{cursor:isDrawingWall?"crosshair":"grab",pointerEvents:isDrawingWall?"none":"auto"}}
                    onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)}
                    onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setEditingWallUid(null);setEditWallLength("");setSelectedUid(dev.uid);clearSelection();}}
                  >
                    {(() => {
                      const wallThickPx = (dev.h ?? 0.15) * planScale;
                      const halfOff = wallThickPx / 2;
                      const px1 = pX(x1), py1 = pY(y1), px2 = pX(x2), py2 = pY(y2);
                      const perpX = -Math.sin(angle) * halfOff;
                      const perpY = Math.cos(angle) * halfOff;
                      const extX = Math.cos(angle) * halfOff;
                      const extY = Math.sin(angle) * halfOff;
                      const ex1 = px1 - extX, ey1 = py1 - extY;
                      const ex2 = px2 + extX, ey2 = py2 + extY;
                      const wallType = dev.wallType ?? "drywall";
                      const wallColor = isSelected ? "#8b5cf6" : wallType === "solid" ? "#475569" : "rgb(var(--text-muted))";
                      const rectD = `M${ex1+perpX},${ey1+perpY} L${ex2+perpX},${ey2+perpY} L${ex2-perpX},${ey2-perpY} L${ex1-perpX},${ey1-perpY} Z`;
                      return (
                        <>
                          {isSelected && <path d={rectD} fill="#8b5cf6" fillOpacity={0.12} stroke="#8b5cf6" strokeWidth={2} strokeLinejoin="miter"/>}
                          <path d={rectD} fill={wallType === "solid" ? wallColor : wallType === "glass" ? "rgb(var(--text-muted))" : cc.card} fillOpacity={wallType === "glass" ? 0.14 : 1} stroke="none"/>
                          <line x1={ex1+perpX} y1={ey1+perpY} x2={ex2+perpX} y2={ey2+perpY} stroke={wallColor} strokeWidth={wallType === "solid" ? 1.5 : 1} strokeLinecap="butt"/>
                          {wallType === "glass" && <line x1={ex1} y1={ey1} x2={ex2} y2={ey2} stroke={wallColor} strokeWidth={0.65} strokeLinecap="butt" opacity={0.7}/>}
                          <line x1={ex1-perpX} y1={ey1-perpY} x2={ex2-perpX} y2={ey2-perpY} stroke={wallColor} strokeWidth={wallType === "solid" ? 1.5 : 1} strokeLinecap="butt"/>
                        </>
                      );
                    })()}
                    {isSelected && editingWallUid !== dev.uid && (
                      <>
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();setEditingWallUid(dev.uid);setEditWallLength(toEditableLength(dev.w));}}>
                          <title>Edit exact wall length</title>
                          <circle cx={pencilX} cy={pencilY} r={7} fill="#8b5cf6"/>
                          <path d="M-2.8,2.8 L-2.1,-0.2 L1.7,-4 L4,-1.7 L0.2,2.1 Z M1.7,-4 L4,-1.7" transform={`translate(${pencilX},${pencilY})`} fill="none" stroke="#fff" strokeWidth={1.1} strokeLinejoin="round"/>
                        </g>
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();pushUndo();setPlacedDevices(prev=>prev.filter(d=>d.uid!==dev.uid));setPlacedDoors(prev=>prev.filter(d=>d.wallUid!==dev.uid));setSelectedUid(null);setEditingWallUid(null);}}>
                          <title>Delete wall</title>
                          <circle cx={deleteX} cy={deleteY} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${deleteX},${deleteY})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      </>
                    )}
                    {isSelected && editingWallUid === dev.uid && (
                      <foreignObject x={lengthInputX} y={lengthInputY} width={92} height={30}
                        onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
                        <input
                          ref={editWallInputRef}
                          value={editWallLength}
                          onChange={e=>setEditWallLength(e.target.value)}
                          onBlur={()=>commitWallLengthEdit(true)}
                          onKeyDown={e=>{
                            e.stopPropagation();
                            if(e.key==="Enter"){e.preventDefault();commitWallLengthEdit();}
                            if(e.key==="Escape"){e.preventDefault();setEditingWallUid(null);setEditWallLength("");}
                          }}
                          aria-label="Exact wall length"
                          title={'Enter a length, for example 13\' 4"'}
                          style={{width:"100%",height:26,boxSizing:"border-box",border:"1px solid #8b5cf6",borderRadius:4,background:"rgb(var(--forge-bg))",color:"rgb(var(--text-heading))",fontFamily:"'JetBrains Mono',monospace",fontSize:10,fontWeight:600,textAlign:"center",outline:"none",padding:"2px 4px"}}
                        />
                      </foreignObject>
                    )}
                    {/* Endpoint grips — drag to stretch the wall; other end stays anchored */}
                    {isSelected && ([{px:x1,py:y1,end:0},{px:x2,py:y2,end:1}] as {px:number;py:number;end:0|1}[]).map(h => (
                      <g key={"grip"+h.end} style={{cursor:"move"}}
                        onMouseDown={e=>{e.stopPropagation();pushUndo();setWallStretchDrag({uid:dev.uid,end:h.end});}}
                        onClick={e=>e.stopPropagation()}
                      >
                        <circle cx={pX(h.px)} cy={pY(h.py)} r={9} fill="transparent"/>
                        <rect x={pX(h.px)-4} y={pY(h.py)-4} width={8} height={8} fill="#fff" stroke="#8b5cf6" strokeWidth={1.5}/>
                      </g>
                    ))}
                  </g>
                );
              })}

              {/* Placed doors and windows — rendered after drawn walls so glass line is not covered by wall fill */}
              {placedDoors.filter(d => d.wall !== "drawn" || placedDevices.some(dev => dev.uid === d.wallUid)).map(door => {
                const c = getDoorCoords(door);
                const dSel = isItemSelected(`door:${door.id}`);
                const color = door.type === "window" ? "#64748b" : "#64748b";
                const selColor = "#8b5cf6";
                const px1 = pX(c.x1), py1 = pY(c.y1), px2 = pX(c.x2), py2 = pY(c.y2);
                const segLen = Math.sqrt((px2-px1)**2 + (py2-py1)**2);

                if (door.type === "window") {
                  const npx = -(py2-py1)/segLen, npy = (px2-px1)/segLen;
                  // Match jamb marks exactly to the drawn wall's face lines, or use a sensible default for room walls
                  let halfThick = 4;
                  if (door.wall === "drawn" && door.wallUid) {
                    const wDev = placedDevices.find(d => d.uid === door.wallUid);
                    if (wDev) halfThick = (wDev.h ?? 0.333) * planScale / 2;
                  }
                  const wColor = dSel ? selColor : "#94a3b8";
                  const midX = (px1+px2)/2, midY = (py1+py2)/2;
                  return (
                    <g key={`door-${door.id}`} style={{cursor:"grab"}}
                      onClick={e => { e.stopPropagation(); if (dragStartedRef.current) { dragStartedRef.current = false; return; } toggleSelect(`door:${door.id}`, e.ctrlKey || e.metaKey); setSelectedUid(null); }}
                      onMouseDown={e => { e.stopPropagation(); pushUndo(); setDoorDragId(door.id); setDoorDragStart({svgX:0,svgY:0,origWall:door.wall,origPos:door.pos}); }}
                    >
                      {dSel && <line x1={px1} y1={py1} x2={px2} y2={py2} stroke={selColor} strokeWidth={halfThick*2+4} strokeLinecap="butt" opacity={0.1}/>}
                      {/* Glass line along wall centerline */}
                      <line x1={px1} y1={py1} x2={px2} y2={py2} stroke={wColor} strokeWidth={1.5} strokeLinecap="butt"/>
                      {/* End jamb lines spanning exactly from one wall face to the other */}
                      <line x1={px1-npx*halfThick} y1={py1-npy*halfThick} x2={px1+npx*halfThick} y2={py1+npy*halfThick} stroke={wColor} strokeWidth={1.5} strokeLinecap="square"/>
                      <line x1={px2-npx*halfThick} y1={py2-npy*halfThick} x2={px2+npx*halfThick} y2={py2+npy*halfThick} stroke={wColor} strokeWidth={1.5} strokeLinecap="square"/>
                      {dSel && (
                        <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); pushUndo(); setPlacedDoors(prev => prev.filter(d => d.id !== door.id)); clearSelection(); }}>
                          <circle cx={midX} cy={midY-14} r={7} fill="#ef4444" />
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${midX},${midY-14})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round" />
                        </g>
                      )}
                    </g>
                  );
                }

                // Architectural door symbol: jambs + panel + quarter-circle arc
                const wdx = (px2-px1)/segLen, wdy = (py2-py1)/segLen;
                const wallScreenAngle = Math.atan2(wdy, wdx) * 180 / Math.PI;
                // Hinge end: flipped swaps which endpoint is the hinge
                const hx = door.flipped ? px2 : px1, hy = door.flipped ? py2 : py1;
                const ox = door.flipped ? px1 : px2, oy = door.flipped ? py1 : py2;
                // Inward perpendicular towards room centre
                const rcx = pX(isCustomBlank && drawnBounds ? drawnBounds.centerX : roomW/2);
                const rcy = pY(isCustomBlank && drawnBounds ? drawnBounds.centerY : roomL/2);
                const midX = (px1+px2)/2, midY = (py1+py2)/2;
                const p1x = -wdy, p1y = wdx;
                const dot = p1x*(rcx-midX) + p1y*(rcy-midY);
                // Default swing opens toward room centre; swingFlipped opens to the other side of the wall
                const perp0 = dot >= 0 ? {x:p1x,y:p1y} : {x:wdy,y:-wdx};
                const perp = door.swingFlipped ? {x:-perp0.x,y:-perp0.y} : perp0;
                const panX = hx + perp.x * segLen;
                const panY = hy + perp.y * segLen;
                const cross = (panX-hx)*(oy-hy) - (panY-hy)*(ox-hx);
                const sweep = cross > 0 ? 1 : 0;
                const stroke = dSel ? selColor : color;

                return (
                  <g key={`door-${door.id}`}
                    style={{cursor: doorDragId === door.id ? "grabbing" : "grab"}}
                    onClick={e => { e.stopPropagation(); if (dragStartedRef.current) { dragStartedRef.current = false; return; } toggleSelect(`door:${door.id}`, e.ctrlKey || e.metaKey); setSelectedUid(null); }}
                    onMouseDown={e => { e.stopPropagation(); pushUndo(); setDoorDragId(door.id); setDoorDragStart({svgX:0,svgY:0,origWall:door.wall,origPos:door.pos}); }}
                  >
                    {dSel && <path d={`M ${hx} ${hy} L ${panX} ${panY} A ${segLen} ${segLen} 0 0 ${sweep} ${ox} ${oy}`} fill="none" stroke={selColor} strokeWidth={10} strokeLinecap="round" opacity={0.12}/>}
                    {/* Door panel + swing arc */}
                    <path d={`M ${hx} ${hy} L ${panX} ${panY} A ${segLen} ${segLen} 0 0 ${sweep} ${ox} ${oy}`} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round"/>
                    {/* Controls when selected */}
                    {dSel && (
                      <>
                        {/* Flip hinge side (left/right along the wall) */}
                        <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); pushUndo(); setPlacedDoors(prev => prev.map(d => d.id === door.id ? {...d, flipped: !d.flipped} : d)); }}>
                          <title>Flip hinge side</title>
                          <circle cx={midX - 10} cy={midY - 14} r={7} fill="#8b5cf6"/>
                          <path d="M-3,0 L0,-2.5 L0,-1 L3,-1 L3,1 L0,1 L0,2.5 Z" transform={`translate(${midX-10},${midY-14}) rotate(${wallScreenAngle})`} fill="#fff"/>
                        </g>
                        {/* Flip swing direction (to the other side of the wall) */}
                        <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); pushUndo(); setPlacedDoors(prev => prev.map(d => d.id === door.id ? {...d, swingFlipped: !d.swingFlipped} : d)); }}>
                          <title>Flip swing direction</title>
                          <circle cx={midX + 10} cy={midY - 14} r={7} fill="#8b5cf6"/>
                          <path d="M-3,0 L0,-2.5 L0,-1 L3,-1 L3,1 L0,1 L0,2.5 Z" transform={`translate(${midX+10},${midY-14}) rotate(${wallScreenAngle+90})`} fill="#fff"/>
                        </g>
                        {/* Delete button */}
                        <g style={{cursor:"pointer"}} onClick={e => { e.stopPropagation(); pushUndo(); setPlacedDoors(prev => prev.filter(d => d.id !== door.id)); clearSelection(); }}>
                          <circle cx={midX} cy={midY + 14} r={7} fill="#ef4444" />
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${midX},${midY+14})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round" />
                        </g>
                      </>
                    )}
                  </g>
                );
              })}
              {/* Preview of door being dragged from sidebar */}
              {dragNewDoor?.active && dragNewDoor.wall && (() => {
                const preview: PlacedDoor = { id: 0, wall: dragNewDoor.wall, pos: dragNewDoor.pos, width: dragNewDoor.type === "window" ? 2.0 : 3.0, type: dragNewDoor.type, wallUid: dragNewDoor.wallUid };
                const c = getDoorCoords(preview);
                const ppx1 = pX(c.x1), ppy1 = pY(c.y1), ppx2 = pX(c.x2), ppy2 = pY(c.y2);
                const pSegLen = Math.sqrt((ppx2-ppx1)**2 + (ppy2-ppy1)**2);
                if (dragNewDoor.type === "window") {
                  const pnpx = -(ppy2-ppy1)/pSegLen, pnpy = (ppx2-ppx1)/pSegLen;
                  let pHalfThick = 4;
                  if (dragNewDoor.wallUid) {
                    const wDev = placedDevices.find(d => d.uid === dragNewDoor.wallUid);
                    if (wDev) pHalfThick = (wDev.h ?? 0.333) * planScale / 2;
                  }
                  return (
                    <g opacity={0.7}>
                      <line x1={ppx1} y1={ppy1} x2={ppx2} y2={ppy2} stroke="#8b5cf6" strokeWidth={1.5} strokeLinecap="butt"/>
                      <line x1={ppx1-pnpx*pHalfThick} y1={ppy1-pnpy*pHalfThick} x2={ppx1+pnpx*pHalfThick} y2={ppy1+pnpy*pHalfThick} stroke="#8b5cf6" strokeWidth={1.5} strokeLinecap="square"/>
                      <line x1={ppx2-pnpx*pHalfThick} y1={ppy2-pnpy*pHalfThick} x2={ppx2+pnpx*pHalfThick} y2={ppy2+pnpy*pHalfThick} stroke="#8b5cf6" strokeWidth={1.5} strokeLinecap="square"/>
                    </g>
                  );
                }
                const pwdx = (ppx2-ppx1)/pSegLen, pwdy = (ppy2-ppy1)/pSegLen;
                const prcx = pX(isCustomBlank && drawnBounds ? drawnBounds.centerX : roomW/2);
                const prcy = pY(isCustomBlank && drawnBounds ? drawnBounds.centerY : roomL/2);
                const pmidX = (ppx1+ppx2)/2, pmidY = (ppy1+ppy2)/2;
                const pp1x = -pwdy, pp1y = pwdx;
                const pdot = pp1x*(prcx-pmidX) + pp1y*(prcy-pmidY);
                const pperp = pdot >= 0 ? {x:pp1x,y:pp1y} : {x:pwdy,y:-pwdx};
                const ppanX = ppx1 + pperp.x * pSegLen, ppanY = ppy1 + pperp.y * pSegLen;
                const pcross = (ppanX-ppx1)*(ppy2-ppy1) - (ppanY-ppy1)*(ppx2-ppx1);
                const psweep = pcross > 0 ? 1 : 0;
                return (
                  <g opacity={0.6}>
                    <line x1={ppx1 - pperp.x*5} y1={ppy1 - pperp.y*5} x2={ppx1 + pperp.x*5} y2={ppy1 + pperp.y*5} stroke="#8b5cf6" strokeWidth={2} strokeLinecap="round"/>
                    <line x1={ppx2 - pperp.x*5} y1={ppy2 - pperp.y*5} x2={ppx2 + pperp.x*5} y2={ppy2 + pperp.y*5} stroke="#8b5cf6" strokeWidth={2} strokeLinecap="round"/>
                    <path d={`M ${ppx1} ${ppy1} L ${ppanX} ${ppanY} A ${pSegLen} ${pSegLen} 0 0 ${psweep} ${ppx2} ${ppy2}`} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeLinecap="round"/>
                  </g>
                );
              })()}

              {/* (Wall drawing preview is now rendered above with the grid) */}

              {placedDevices.filter(d => d.wall !== "ceiling" && d.mountWall !== "ceiling" && !(d.id === "wall-partition" && d.wallAngle !== undefined)).map(dev=>{
                const isSelected=selectedUid===dev.uid||selectedUids.has(dev.uid), isDragging=dragUid===dev.uid;
                const devPx=pX(dev.x), devPy=pY(dev.y||0.1);
                if(dev.type==="display"){
                  const dw=dev.w*planScale;
                  // Draw centered at the device's own position, rotated to its wall angle
                  const angle = dev.rotation ?? ((dev.mountWall==="west"||dev.mountWall==="east") ? 90 : 0);
                  const rx2=devPx-dw/2, ry2=devPy-3, rw2=dw, rh2=6;
                  return (<g key={dev.uid} transform={`rotate(${angle} ${devPx} ${devPy})`} style={{cursor:isDragging?"grabbing":"move"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                    {/* Invisible hit-area padding so thin wall bars are easy to click */}
                    <rect x={rx2-4} y={ry2-10} width={rw2+8} height={rh2+20} fill="transparent" pointerEvents="all"/>
                    {isSelected&&<rect x={rx2-4} y={ry2-4} width={rw2+8} height={rh2+8} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" rx={3}/>}
                    {/* Blue boundary */}
                    <rect x={rx2-1} y={ry2-1} width={rw2+2} height={rh2+2} rx={2} fill="none" stroke={dev.color+"88"} strokeWidth={0.8}/>
                    {/* Bezel */}
                    <rect x={rx2} y={ry2} width={rw2} height={rh2} rx={0.5} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={1}/>
                    {/* Screen inset */}
                    <rect x={rx2+1} y={ry2+0.5} width={rw2-2} height={rh2-1} rx={0.3} fill="#070b14" stroke="#111827" strokeWidth={0.3}/>
                    <text x={rx2+rw2/2} y={ry2+rh2+12} textAnchor="middle" fontSize={7} fill={dev.color} fontWeight={600} className="dev-label">{dev.name}</text>
                    {isSelected && (
                      <>
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={rx2+rw2+8} cy={ry2-4} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${rx2+rw2+8},${ry2-4})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();setRotatePopup({x:e.clientX,y:e.clientY,uid:dev.uid,value:String(dev.rotation??angle)});}}>
                          <circle cx={rx2+rw2-10} cy={ry2-4} r={7} fill="#8b5cf6"/>
                          <g transform={`translate(${rx2+rw2-14},${ry2-8}) scale(0.333)`}>
                            <path d="M21 12a9 9 0 1 1-3-6.7" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                            <polyline points="21 3 21 6.7 17.3 6.7" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                          </g>
                        </g>
                      </>
                    )}
                  </g>);
                }
                if(dev.type==="camera"){
                  const mw=dev.mountWall||"north", isCeiling=dev.wall==="ceiling";
                  const isDrawnWall = mw==="drawn";
                  const isSoundbarCam = dev.id==="soundbar-cam";
                  const hfovDeg = dev.hfov || 70;
                  const halfAngle = (hfovDeg / 2) * Math.PI / 180;
                  // FOV reach = distance from wall to opposite wall along that axis
                  const fovReachN = roomL * planScale;
                  const fovReachW = roomW * planScale;
                  let cpx:number,cpy:number;
                  // Room boundary in plan-view pixels — a custom-drawn room can
                  // sit anywhere in world space (its walls aren't necessarily at
                  // x/y 0..roomW/roomL, which are stale leftover numbers once
                  // walls are hand-drawn), so clip against the actual drawn
                  // extent there instead of a phantom rectangle anchored at the
                  // origin — otherwise the FOV cone gets clipped against a
                  // boundary that doesn't correspond to anything actually drawn.
                  const rxMin = isCustomBlank && drawnBounds ? pX(drawnBounds.minX) : pX(0);
                  const rxMax = isCustomBlank && drawnBounds ? pX(drawnBounds.maxX) : pX(roomW);
                  const ryMin = isCustomBlank && drawnBounds ? pY(drawnBounds.minY) : pY(0);
                  const ryMax = isCustomBlank && drawnBounds ? pY(drawnBounds.maxY) : pY(roomL);
                  // Clip a line from (ox,oy)->(ex,ey) to the room rect, return clamped endpoint
                  const clipToRoom=(ox:number,oy:number,ex:number,ey:number)=>{
                    let t=1;const dx=ex-ox,dy=ey-oy;
                    if(dx!==0){if(dx>0){t=Math.min(t,(rxMax-ox)/dx);}else{t=Math.min(t,(rxMin-ox)/dx);}}
                    if(dy!==0){if(dy>0){t=Math.min(t,(ryMax-oy)/dy);}else{t=Math.min(t,(ryMin-oy)/dy);}}
                    t=Math.max(0,t);
                    return {x:ox+dx*t,y:oy+dy*t};
                  };
                  let fovL1:{x:number,y:number}|null=null, fovL2:{x:number,y:number}|null=null;
                  // Direction the camera faces into the room, and how far its
                  // cone reaches before hitting the far side — computed once
                  // per mount case here, then shared by a single generic
                  // direction/perpendicular calculation below (rather than
                  // each cardinal case hand-rolling its own cpx±spread,cpy±reach
                  // formula). That unification is what makes a manual rotation
                  // nudge (facingOverrideDeg, from the "Rotate" context-menu
                  // actions) apply uniformly to every mount case instead of
                  // only the custom-wall one.
                  let facingA=0, reach=0;
                  if(isCeiling){cpx=devPx;cpy=pY(dev.y);}
                  else if(isDrawnWall){
                    // A wall drawn freeform (not one of the room's four boundary
                    // sides) has no fixed position to hang the camera on the way
                    // the cardinal cases below do — it can be anywhere, at any
                    // angle. Using the device's own tracked x/y (already kept
                    // correct by dragging/snapping) instead of re-deriving a
                    // phantom cardinal-wall position is what makes dragging a
                    // camera onto a custom-drawn wall actually work, instead of
                    // it silently rendering pinned near a hardcoded east wall
                    // regardless of where it was really placed.
                    cpx=devPx;cpy=pY(dev.y);
                    const wallDev = placedDevices.find(d=>d.uid===dev.wallUid && d.wallAngle!==undefined);
                    if(wallDev){
                      const angle=wallDev.wallAngle!;
                      let nx0=-Math.sin(angle), ny0=Math.cos(angle);
                      // Face away from the wall on whichever side the camera
                      // actually sits on (compared against the wall's own
                      // center point) — not always toward the room's
                      // interior. A camera mounted on the *outside* face of
                      // a wall should face outward, not get force-flipped to
                      // point back through the wall into the room.
                      if(nx0*(dev.x-wallDev.x)+ny0*(dev.y-wallDev.y) < 0){ nx0=-nx0; ny0=-ny0; }
                      facingA = Math.atan2(ny0,nx0);
                    }
                    reach=Math.min(Math.max(effectiveRoomW,effectiveRoomL)*planScale,200);
                  }
                  // Cardinal mounts use the device's own tracked x/y for
                  // position too (not a hardcoded point on the wall line) —
                  // a camera dragged off its wall into open floor space still
                  // has mountWall:"north" etc. (free-floating doesn't change
                  // that, only snapping does), so hardcoding the position
                  // here rendered it glued to the wall regardless of how far
                  // it had actually been dragged, even though the drag
                  // itself moved dev.x/dev.y correctly.
                  else if(mw==="north"){ facingA=Math.PI/2; cpx=devPx;cpy=devPy; reach=Math.min(fovReachN,200); }
                  else if(mw==="south"){ facingA=-Math.PI/2; cpx=devPx;cpy=devPy; reach=Math.min(fovReachN,200); }
                  else if(mw==="west"){ facingA=0; cpx=devPx;cpy=devPy; reach=Math.min(fovReachW,200); }
                  else { facingA=Math.PI; cpx=devPx;cpy=devPy; reach=Math.min(fovReachW,200); }
                  if(!isCeiling){
                    // Manual fine-rotation on top of the auto-computed wall
                    // facing — lets the user correct a placement the auto-snap
                    // logic can't get exactly right (e.g. a camera wedged into
                    // a room corner) without fighting the snap system.
                    facingA += (dev.facingOverrideDeg??0)*Math.PI/180;
                    const spread=reach*Math.tan(halfAngle);
                    const dirX=Math.cos(facingA), dirY=Math.sin(facingA), perpX=-dirY, perpY=dirX;
                    fovL1=clipToRoom(cpx,cpy,cpx+dirX*reach+perpX*spread,cpy+dirY*reach+perpY*spread);
                    fovL2=clipToRoom(cpx,cpy,cpx+dirX*reach-perpX*spread,cpy+dirY*reach-perpY*spread);
                  }
                  const fovLines = fovL1&&fovL2 ? (()=>{
                    const arcR=20;
                    // The cone's edges are exactly facingA ± halfAngle by
                    // definition — computing them directly (rather than via
                    // atan2 on the clipped fovL1/fovL2 points) avoids a
                    // degenerate, direction-less arc when a wall clips one
                    // edge down to (near) zero length, e.g. a camera placed
                    // right at a room corner.
                    const a1=facingA+halfAngle, a2=facingA-halfAngle;
                    const ax1=cpx+arcR*Math.cos(a1), ay1=cpy+arcR*Math.sin(a1);
                    const ax2=cpx+arcR*Math.cos(a2), ay2=cpy+arcR*Math.sin(a2);
                    const largeArc=hfovDeg>180?1:0;
                    // Sweep should go from a1 to a2 through the facing direction
                    // Use cross product to determine if sweep=1 gives the correct arc
                    let sweep=1;
                    // Check if midpoint of sweep=1 arc is on the facing side
                    const midSweep1=(a1+a2)/2+((a2-a1+Math.PI*3)%(Math.PI*2)-Math.PI>0?0:Math.PI);
                    // Simpler: just check if going a1->a2 clockwise (sweep=1) passes through facing
                    let diff=(a2-a1+Math.PI*2)%(Math.PI*2);
                    const midA1=a1+diff/2;
                    const midA1Alt=a1+diff/2+Math.PI;
                    // Which mid-angle is closer to facing direction?
                    const distMid=Math.abs(((midA1-facingA+Math.PI*3)%(Math.PI*2))-Math.PI);
                    const distAlt=Math.abs(((midA1Alt-facingA+Math.PI*3)%(Math.PI*2))-Math.PI);
                    if(distMid>distAlt) sweep=0;
                    const arcPath=`M${ax1} ${ay1} A${arcR} ${arcR} 0 ${largeArc} ${sweep} ${ax2} ${ay2}`;
                    // Label at midpoint of arc on the facing side
                    const labelA=sweep===1?midA1:midA1Alt;
                    const lx=cpx+(arcR+10)*Math.cos(labelA), ly=cpy+(arcR+10)*Math.sin(labelA);
                    return <>
                      <line x1={cpx} y1={cpy} x2={fovL1.x} y2={fovL1.y} stroke={dev.color} strokeWidth={1} strokeDasharray="6 4" opacity={0.5}/>
                      <line x1={cpx} y1={cpy} x2={fovL2.x} y2={fovL2.y} stroke={dev.color} strokeWidth={1} strokeDasharray="6 4" opacity={0.5}/>
                      <path d={arcPath} fill="none" stroke={dev.color} strokeWidth={1} opacity={0.6}/>
                      <text x={lx} y={ly+4} textAnchor="middle" fontSize={8} fill={dev.color} fontFamily="'JetBrains Mono',monospace" opacity={0.8}>{hfovDeg}°</text>
                    </>;
                  })() : null;
                  if(isSoundbarCam){
                    // Top-down view: slim rectangle (width × depth) like Rally Bar from above
                    const barW=dev.w*planScale, barD=Math.max(dev.h*planScale, 6);
                    const isHoriz=mw==="north"||mw==="south"||(isDrawnWall&&Math.abs(Math.sin(facingA))>0.5);
                    const bw=isHoriz?barW:barD, bh=isHoriz?barD:barW;
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {isSelected&&<rect x={cpx-bw/2-3} y={cpy-bh/2-3} width={bw+6} height={bh+6} rx={4} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      {fovLines}
                      {/* Green boundary outline */}
                      <rect x={cpx-bw/2-1} y={cpy-bh/2-1} width={bw+2} height={bh+2} rx={3} fill="none" stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* Main body */}
                      <rect x={cpx-bw/2} y={cpy-bh/2} width={bw} height={bh} rx={2} fill={cc.device} stroke={cc.deviceBorderLight} strokeWidth={0.8}/>
                      {/* Fabric mesh area */}
                      <rect x={cpx-bw*0.44} y={cpy-bh*0.35} width={bw*0.88} height={bh*0.7} rx={1.5} fill={cc.device} stroke="rgb(var(--border))" strokeWidth={0.3}/>
                      <text x={cpx} y={cpy-(isHoriz?bh:bw)/2-6} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                      {isSelected && (
                        <>
                          <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                            <circle cx={cpx+bw/2+8} cy={cpy-bh/2-4} r={7} fill="#ef4444"/>
                            <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${cpx+bw/2+8},${cpy-bh/2-4})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                          </g>
                          <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();setRotatePopup({x:e.clientX,y:e.clientY,uid:dev.uid,value:String(dev.facingOverrideDeg??0)});}}>
                            <circle cx={cpx+bw/2-10} cy={cpy-bh/2-4} r={7} fill="#8b5cf6"/>
                            <g transform={`translate(${cpx+bw/2-14},${cpy-bh/2-8}) scale(0.333)`}>
                              <path d="M21 12a9 9 0 1 1-3-6.7" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                              <polyline points="21 3 21 6.7 17.3 6.7" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                            </g>
                          </g>
                        </>
                      )}
                    </g>);
                  }
                  if(isCeiling){
                    const purpleColor="#a855f7";
                    const cw=16, ch=10;
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {isSelected&&<rect x={cpx-cw/2-3} y={cpy-ch/2-3} width={cw+6} height={ch+6} rx={5} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      {/* Purple boundary */}
                      <rect x={cpx-cw/2-1} y={cpy-ch/2-1} width={cw+2} height={ch+2} rx={4} fill="none" stroke={purpleColor+"88"} strokeWidth={0.8}/>
                      {/* Body */}
                      <rect x={cpx-cw/2} y={cpy-ch/2} width={cw} height={ch} rx={3} fill={cc.device} stroke={cc.deviceBorderLight} strokeWidth={0.8}/>
                      <text x={cpx} y={cpy-ch/2-6} textAnchor="middle" fontSize={7} fill={purpleColor} className="dev-label">{dev.name}</text>
                      {isSelected && (
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={cpx+cw/2+8} cy={cpy-ch/2-4} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${cpx+cw/2+8},${cpy-ch/2-4})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      )}
                    </g>);
                  }
                  {
                  // The body rect's long edge starts horizontal (screen angle
                  // 0°), which needs to be perpendicular to the direction the
                  // camera faces — i.e. at facingA±90°. `facingA-90` happens to
                  // equal `90-facingA` (mod 180°, so visually identical on this
                  // point-symmetric rect) at exactly the four cardinal angles,
                  // which is why a `90-facingA` version of this line looked
                  // right for wall-mounted cameras but silently rotated the
                  // body 90° off from the actual cone direction at any other
                  // angle — exactly what a manual rotation produces.
                  const camRot=facingA*180/Math.PI-90;
                  return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                    {isSelected&&<rect x={cpx-14} y={cpy-10} width={28} height={20} rx={4} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" transform={`rotate(${camRot},${cpx},${cpy})`}/>}
                    {fovLines}
                    <g transform={`rotate(${camRot},${cpx},${cpy})`}>
                      <rect x={cpx-8} y={cpy-5} width={16} height={10} rx={2.5} fill={cc.device} stroke={dev.color+"88"} strokeWidth={0.8}/>
                    </g>
                    <text x={cpx} y={cpy-(mw==="west"||mw==="east"||(isDrawnWall&&Math.abs(Math.sin(facingA))<0.5)?12:14)} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                    {isSelected && (
                      <>
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={cpx+14} cy={cpy-10} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${cpx+14},${cpy-10})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();setRotatePopup({x:e.clientX,y:e.clientY,uid:dev.uid,value:String(dev.facingOverrideDeg??0)});}}>
                          <circle cx={cpx-4} cy={cpy-10} r={7} fill="#8b5cf6"/>
                          <g transform={`translate(${cpx-8},${cpy-14}) scale(0.333)`}>
                            <path d="M21 12a9 9 0 1 1-3-6.7" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                            <polyline points="21 3 21 6.7 17.3 6.7" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                          </g>
                        </g>
                      </>
                    )}
                  </g>);}
                }
                // Floor furniture (chairs, tables, etc.)
                if (dev.type === "furniture" && (dev.mountWall === "floor" || !dev.mountWall)) {
                  const fw = dev.w * planScale;
                  const fh = dev.h * planScale;
                  const isChair = dev.id === "side-chair" || dev.id === "exec-chair";
                  const cW2 = Math.max(6, fw);
                  const cD2 = Math.max(5, fh);
                  const cB2 = Math.max(2, cD2 * 0.2);
                  const rx2 = Math.max(1, cW2 * 0.18);
                  const fpx = devPx, fpy = pY(dev.y);
                  const rot = dev.rotation || 0;
                  if (isChair) {
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} opacity={isDragging?0.7:1}>
                      {isSelected && <rect x={fpx-cW2/2-3} y={fpy-cW2/2-3} width={cW2+6} height={cW2+6} rx={3} fill="rgba(139,92,246,0.08)" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      <rect x={fpx-cW2/2} y={fpy-cW2/2} width={cW2} height={cW2} rx={rx2} fill="#d1d5db" stroke={isSelected?"#8b5cf6":"#b0b5be"} strokeWidth={isSelected?1.2:0.8}/>
                      {isSelected && (
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={fpx+cW2*0.8} cy={fpy-cW2*0.8} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${fpx+cW2*0.8},${fpy-cW2*0.8})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      )}
                    </g>);
                  }
                  return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} opacity={isDragging?0.7:1}>
                    {isSelected && <rect x={fpx-fw/2-3} y={fpy-fh/2-3} width={fw+6} height={fh+6} rx={3} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                    <g transform={`rotate(${rot},${fpx},${fpy})`}>
                      {dev.id === "round-table"
                        ? <ellipse cx={fpx} cy={fpy} rx={fw/2} ry={fh/2} fill="#cbd5e1" fillOpacity={0.3} stroke={isSelected?"#8b5cf6":"rgb(var(--text-muted))"} strokeWidth={1}/>
                        : <rect x={fpx-fw/2} y={fpy-fh/2} width={fw} height={fh} rx={2} fill="#cbd5e1" fillOpacity={0.3} stroke={isSelected?"#8b5cf6":"rgb(var(--text-muted))"} strokeWidth={1}/>}
                    </g>
                    {dev.id !== "conf-table" && dev.id !== "round-table" && <text x={fpx} y={fpy+3} textAnchor="middle" fontSize={7} fill="rgb(var(--text-muted))">{dev.name}</text>}
                    {isSelected && (
                      <>
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={fpx+fw/2+8} cy={fpy-fh/2-4} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${fpx+fw/2+8},${fpy-fh/2-4})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();setFurnitureEditUid(dev.uid);setFurnitureEditW(String(Math.round(dev.w*100)/100));setFurnitureEditL(String(Math.round(dev.h*100)/100));setShowFurnitureEditor(true);}}>
                          <circle cx={fpx-fw/2-8} cy={fpy-fh/2-4} r={7} fill="#8b5cf6"/>
                          <path d="M-2.5,2 L2,-2.5 L3,-1.5 L-1.5,3 Z M-3,3 L-2.5,2 L-1.5,3 Z" transform={`translate(${fpx-fw/2-8},${fpy-fh/2-4})`} fill="#fff" stroke="none"/>
                        </g>
                      </>
                    )}
                  </g>);
                }
                if(dev.type==="mic"||dev.type==="speaker"){
                  const mpx=devPx, mpy=pY(dev.y);
                  const covR=dev.wall==="ceiling"?roomH*0.5*planScale:8;
                  const isCeilingSpeaker=dev.type==="speaker"&&dev.wall==="ceiling";
                  if(isCeilingSpeaker){
                    const r=8;
                    // EPR = 2 × H × tan(θ/2), H = ceiling height - ear height (4 ft)
                    const dispDeg=dev.dispersion||90;
                    const hAboveEar=roomH-4;
                    const eprFt=2*hAboveEar*Math.tan((dispDeg/2)*Math.PI/180);
                    const eprPx=(eprFt/2)*planScale;
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {isSelected&&<circle cx={mpx} cy={mpy} r={r+5} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      {/* Coverage area - EPR based */}
                      <circle cx={mpx} cy={mpy} r={eprPx} fill={dev.color} opacity={0.04} stroke={dev.color} strokeWidth={0.5} strokeDasharray="3 2"/>
                      {/* Speaker body - outer rim */}
                      <circle cx={mpx} cy={mpy} r={r} fill={cc.device} stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* Grille rings */}
                      <circle cx={mpx} cy={mpy} r={r*0.75} fill="none" stroke={cc.deviceBorderLight} strokeWidth={0.4}/>
                      <circle cx={mpx} cy={mpy} r={r*0.5} fill="none" stroke={cc.deviceBorderLight} strokeWidth={0.4}/>
                      {/* Center cone */}
                      <circle cx={mpx} cy={mpy} r={r*0.25} fill="#334155" stroke="#475569" strokeWidth={0.3}/>
                      <text x={mpx} y={mpy-r-4} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                      {isSelected && (
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={mpx+r+5} cy={mpy-r-5} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${mpx+r+5},${mpy-r-5})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      )}
                    </g>);
                  }
                  // Ceiling mic array - Shure MXA920 style square tile
                  const isCeilingMic=dev.type==="mic"&&dev.wall==="ceiling";
                  if(isCeilingMic){
                    const tileS=Math.max(dev.w*planScale, 12);
                    const cShape=dev.covShape||"round";
                    const cRadius=(dev.covDiameter||6)/2*planScale;
                    const cHalfW=(dev.covW||6)/2*planScale;
                    const cHalfL=(dev.covL||6)/2*planScale;
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {isSelected&&<rect x={mpx-tileS/2-4} y={mpy-tileS/2-4} width={tileS+8} height={tileS+8} rx={3} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      {/* Coverage area - round or square */}
                      {cShape==="round"
                        ? <circle cx={mpx} cy={mpy} r={cRadius} fill={dev.color} opacity={0.04} stroke={dev.color} strokeWidth={0.5} strokeDasharray="3 2"/>
                        : <rect x={mpx-cHalfW} y={mpy-cHalfL} width={cHalfW*2} height={cHalfL*2} fill={dev.color} opacity={0.04} stroke={dev.color} strokeWidth={0.5} strokeDasharray="3 2"/>
                      }
                      {/* Tile body */}
                      <rect x={mpx-tileS/2} y={mpy-tileS/2} width={tileS} height={tileS} rx={1.5} fill={cc.device} stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* Mic hole grid - 3x3 */}
                      {[-1,0,1].map(r=>[-1,0,1].map(c=><circle key={`${r}${c}`} cx={mpx+c*tileS*0.25} cy={mpy+r*tileS*0.25} r={1} fill="#334155"/>))}
                      <text x={mpx} y={mpy-tileS/2-5} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                      {isSelected && (
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={mpx+tileS/2+5} cy={mpy-tileS/2-5} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${mpx+tileS/2+5},${mpy-tileS/2-5})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      )}
                    </g>);
                  }
                  // Table mic - Shure MXA310 style
                  const isTableMic=dev.id==="table-mic";
                  if(isTableMic){
                    const mr=7;
                    const tmCovR=(dev.covDiameter||2)/2*planScale;
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {isSelected&&<circle cx={mpx} cy={mpy} r={mr+4} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      {/* Coverage area */}
                      <circle cx={mpx} cy={mpy} r={tmCovR} fill={dev.color} opacity={0.04} stroke={dev.color} strokeWidth={0.5} strokeDasharray="3 2"/>
                      {/* Outer body */}
                      <circle cx={mpx} cy={mpy} r={mr} fill={cc.device} stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* LED ring */}
                      <circle cx={mpx} cy={mpy} r={mr*0.7} fill="none" stroke={dev.color} strokeWidth={0.6} opacity={0.5}/>
                      {/* Inner ring */}
                      <circle cx={mpx} cy={mpy} r={mr*0.45} fill={cc.device} stroke={cc.deviceBorderLight} strokeWidth={0.4}/>
                      {/* Center dot */}
                      <circle cx={mpx} cy={mpy} r={mr*0.15} fill="#334155"/>
                      <text x={mpx} y={mpy-mr-4} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                      {isSelected && (
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={mpx+mr+4} cy={mpy-mr-4} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${mpx+mr+4},${mpy-mr-4})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      )}
                    </g>);
                  }
                  // Wall speaker - JBL Control 25-1 style box
                  const isWallSpk=dev.id==="soundbar"&&dev.wall==="front";
                  if(isWallSpk){
                    const mw2=dev.mountWall||"north";
                    const spkW=dev.w*planScale, spkD=Math.max(dev.w*0.9*planScale, 5);
                    const isHoriz=mw2==="north"||mw2==="south";
                    const bw=isHoriz?spkW:spkD, bh=isHoriz?spkD:spkW;
                    // Use the device's own tracked position as-is — no longer
                    // re-pinned to the exact wall line, so a speaker dragged
                    // off its wall renders where it actually was moved to.
                    const sx=mpx, sy=mpy;
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {isSelected&&<rect x={sx-bw/2-3} y={sy-bh/2-3} width={bw+6} height={bh+6} rx={3} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      {/* Speaker body */}
                      <rect x={sx-bw/2} y={sy-bh/2} width={bw} height={bh} rx={1.5} fill={cc.device} stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* Grille */}
                      <rect x={sx-bw*0.35} y={sy-bh*0.35} width={bw*0.7} height={bh*0.7} rx={1} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={0.3}/>
                      <text x={sx} y={sy-bh/2-4} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                      {isSelected && (
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={sx+bw/2+8} cy={sy-bh/2-4} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${sx+bw/2+8},${sy-bh/2-4})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      )}
                    </g>);
                  }
                  return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                    {isSelected&&<circle cx={mpx} cy={mpy} r={covR+6} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                    {dev.wall==="ceiling"&&<circle cx={mpx} cy={mpy} r={covR} fill={dev.color} opacity={0.05} stroke={dev.color} strokeWidth={0.5} strokeDasharray="3 2"/>}
                    <circle cx={mpx} cy={mpy} r={5} fill={dev.color+"33"} stroke={dev.color} strokeWidth={1.5}/>
                    <circle cx={mpx} cy={mpy} r={2} fill={dev.color}/>
                    <text x={mpx} y={mpy-10} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                    {isSelected && (
                      <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                        <circle cx={mpx+covR+6} cy={mpy-covR-6} r={7} fill="#ef4444"/>
                        <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${mpx+covR+6},${mpy-covR-6})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                      </g>
                    )}
                  </g>);
                }
                if(dev.type==="control"){
                  const mw=dev.mountWall||"floor";
                  // Always render at the device's own tracked position rather
                  // than a hardcoded point on the wall line — a panel dragged
                  // off its wall into open floor space still has
                  // mountWall:"north" etc. (free-floating doesn't change
                  // that, only snapping does), so hardcoding the position
                  // rendered it glued to the wall regardless of how far it
                  // had actually been dragged.
                  const cpx2=devPx, cpy2=devPy;
                  // TSW-1070 style wall touch panel
                  const isWallPanel=dev.id==="touch-panel";
                  if(isWallPanel){
                    const pw=dev.w*planScale, pd=Math.max(4, dev.h*planScale*0.3);
                    const isHoriz=mw==="north"||mw==="south";
                    const bw=isHoriz?pw:pd, bh=isHoriz?pd:pw;
                    // Use the device's own tracked position (cpx2/cpy2) as-is
                    // — no longer re-pinned to the exact wall line here, for
                    // the same reason as cpx2/cpy2 above.
                    const sx=cpx2, sy=cpy2;
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {/* Invisible hit-area padding — extends up over the
                          label (rendered above the panel body) so a
                          right-click on the text itself still hits this
                          group instead of falling through to the canvas. */}
                      <rect x={sx-bw/2-4} y={sy-bh/2-14} width={bw+8} height={bh+18} fill="transparent" pointerEvents="all"/>
                      {isSelected&&<rect x={sx-bw/2-3} y={sy-bh/2-3} width={bw+6} height={bh+6} rx={3} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      {/* Purple boundary */}
                      <rect x={sx-bw/2-1} y={sy-bh/2-1} width={bw+2} height={bh+2} rx={2} fill="none" stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* Panel body - dark glass */}
                      <rect x={sx-bw/2} y={sy-bh/2} width={bw} height={bh} rx={1} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={0.8}/>
                      {/* Screen */}
                      <rect x={sx-bw/2+1} y={sy-bh/2+0.5} width={bw-2} height={bh-1} rx={0.5} fill={cc.device} stroke="rgb(var(--border))" strokeWidth={0.3}/>
                      <text x={sx} y={sy-bh/2-4} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                      {isSelected && (
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={sx+bw/2+8} cy={sy-bh/2-4} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${sx+bw/2+8},${sy-bh/2-4})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      )}
                    </g>);
                  }
                  // Logitech Tap style table touch panel
                  const isTableTouch=dev.id==="table-touch";
                  if(isTableTouch){
                    const tw=dev.w*planScale, th=dev.h*planScale;
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {/* Invisible hit-area padding — extends up over the
                          label (rendered above the panel body) so a
                          right-click on the text itself still hits this
                          group instead of falling through to the canvas. */}
                      <rect x={cpx2-tw/2-4} y={cpy2-th/2-14} width={tw+8} height={th+18} fill="transparent" pointerEvents="all"/>
                      {isSelected&&<rect x={cpx2-tw/2-3} y={cpy2-th/2-3} width={tw+6} height={th+6} rx={4} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      {/* Purple boundary */}
                      <rect x={cpx2-tw/2-1} y={cpy2-th/2-1} width={tw+2} height={th+2} rx={3} fill="none" stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* Body - dark rounded rectangle */}
                      <rect x={cpx2-tw/2} y={cpy2-th/2} width={tw} height={th} rx={2} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={0.8}/>
                      {/* Screen area */}
                      <rect x={cpx2-tw/2+1.5} y={cpy2-th/2+1} width={tw-3} height={th-2} rx={1} fill="#070b14" stroke="#111827" strokeWidth={0.3}/>
                      <text x={cpx2} y={cpy2-th/2-4} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                      {isSelected && (
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={cpx2+tw/2+8} cy={cpy2-th/2-4} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${cpx2+tw/2+8},${cpy2-th/2-4})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      )}
                    </g>);
                  }
                  // Cable Cubby - Extron Cable Cubby 1202 style
                  const isCableCubby=dev.id==="byod-hub";
                  if(isCableCubby){
                    const cw=dev.w*planScale, ch=dev.h*planScale;
                    return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {/* Invisible hit-area padding — extends up over the
                          label (rendered above the body) so a right-click
                          on the text itself still hits this group instead
                          of falling through to the canvas. */}
                      <rect x={cpx2-cw/2-4} y={cpy2-ch/2-14} width={cw+8} height={ch+18} fill="transparent" pointerEvents="all"/>
                      {isSelected&&<rect x={cpx2-cw/2-3} y={cpy2-ch/2-3} width={cw+6} height={ch+6} rx={3} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                      {/* Purple boundary */}
                      <rect x={cpx2-cw/2-1} y={cpy2-ch/2-1} width={cw+2} height={ch+2} rx={2} fill="none" stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* Outer frame - brushed metal look */}
                      <rect x={cpx2-cw/2} y={cpy2-ch/2} width={cw} height={ch} rx={1.5} fill="#374151" stroke="#4b5563" strokeWidth={0.8}/>
                      {/* Inner cavity - dark recess */}
                      <rect x={cpx2-cw/2+2} y={cpy2-ch/2+1.5} width={cw-4} height={ch-3} rx={1} fill={cc.deviceDeep} stroke="rgb(var(--border))" strokeWidth={0.4}/>
                      {/* Cable port slots */}
                      {[-1,0,1].map(i=><rect key={i} x={cpx2+i*cw*0.25-2} y={cpy2-ch/2+3} width={4} height={ch-6} rx={1} fill={cc.device} stroke="rgb(var(--border))" strokeWidth={0.2}/>)}
                      <text x={cpx2} y={cpy2-ch/2-4} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                      {isSelected && (
                        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                          <circle cx={cpx2+cw/2+8} cy={cpy2-ch/2-4} r={7} fill="#ef4444"/>
                          <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${cpx2+cw/2+8},${cpy2-ch/2-4})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                        </g>
                      )}
                    </g>);
                  }
                  return (<g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} onClick={e=>{e.stopPropagation();if(e.ctrlKey||e.metaKey||suppressClickClear.current){suppressClickClear.current=false;return;}setSelectedUid(dev.uid);clearSelection();}} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                    {/* Invisible hit-area padding — extends down over the
                        label (rendered below the icon) so a right-click on
                        the text itself still hits this group instead of
                        falling through to the canvas. */}
                    <rect x={cpx2-10} y={cpy2-8} width={20} height={26} fill="transparent" pointerEvents="all"/>
                    {isSelected&&<rect x={cpx2-8} y={cpy2-6} width={16} height={12} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" rx={3}/>}
                    <rect x={cpx2-5} y={cpy2-3.5} width={10} height={7} rx={2} fill={dev.color+"33"} stroke={dev.color} strokeWidth={1}/>
                    <text x={cpx2} y={cpy2+14} textAnchor="middle" fontSize={7} fill={dev.color} className="dev-label">{dev.name}</text>
                    {isSelected && (
                      <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();requestDeleteDevices([dev.uid]);}}>
                        <circle cx={cpx2+8} cy={cpy2-6} r={7} fill="#ef4444"/>
                        <path d="M-3,-3 L3,3 M3,-3 L-3,3" transform={`translate(${cpx2+8},${cpy2-6})`} stroke="#fff" strokeWidth={1.2} strokeLinecap="round"/>
                      </g>
                    )}
                  </g>);
                }
                return null;
              })}

              {/* Automatic equipment call-outs — a separate pass over the
                  same plan-view devices (not inline inside the loop above),
                  see renderCallout for why. */}
              {placedDevices.filter(d => d.wall !== "ceiling" && d.mountWall !== "ceiling" && d.type !== "furniture").map(dev => renderCallout(dev))}

              {/* Marquee selection rectangle */}
              {marquee && (() => {
                const isWindow = marquee.curSvgX >= marquee.startSvgX;
                const x = Math.min(marquee.startSvgX, marquee.curSvgX);
                const y = Math.min(marquee.startSvgY, marquee.curSvgY);
                const w = Math.abs(marquee.curSvgX - marquee.startSvgX);
                const h = Math.abs(marquee.curSvgY - marquee.startSvgY);
                return (
                  <rect x={x} y={y} width={w} height={h}
                    fill={isWindow ? "rgba(139,92,246,0.07)" : "rgba(34,197,94,0.07)"}
                    stroke={isWindow ? "#8b5cf6" : "#22c55e"}
                    strokeWidth={0.8}
                    strokeDasharray={isWindow ? undefined : "3 2"}
                    pointerEvents="none"
                  />
                );
              })()}

              {/* Elevation markers — standard architectural interior-elevation
                  tags (diamond + circle, one flag per compass direction).
                  Drag the body to reposition; right-click to choose which
                  direction flags are active (North is on by default) — the
                  Elevations pane below renders one tab per active flag. */}
              {elevationMarkers.map(m => {
                const mx = pX(m.x), my = pY(m.y);
                const isSelected = selectedElevationId === m.id;
                const R = 13, D = R * Math.SQRT2;
                return (
                  <g key={"elevm" + m.id} style={{cursor:"grab"}}
                    onMouseDown={e=>{e.stopPropagation();setElevMarkerDrag({id:m.id});setSelectedElevationId(m.id);setActiveElevationKey(prev=>prev && prev.startsWith(m.id+"-") ? prev : (m.directions[0] ? `${m.id}-${m.directions[0]}` : prev));}}
                    onClick={e=>{e.stopPropagation();setSelectedElevationId(m.id);}}
                    onContextMenu={e=>{e.preventDefault();e.stopPropagation();setSelectedElevationId(m.id);setElevMarkerContextMenu({x:e.clientX,y:e.clientY,id:m.id});}}
                  >
                    {isSelected && <circle cx={mx} cy={my} r={D+5} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>}
                    {ELEVATION_DIR_KEYS.map(dirKey => {
                      const theta = ELEVATION_DIR_ANGLES[dirKey];
                      const tip = elevationDir(theta);
                      const t1 = elevationDir(theta - 45);
                      const t2 = elevationDir(theta + 45);
                      const active = m.directions.includes(dirKey);
                      const pts = `${mx+tip.x*D},${my+tip.y*D} ${mx+t1.x*R},${my+t1.y*R} ${mx+t2.x*R},${my+t2.y*R}`;
                      return <polygon key={dirKey} points={pts} fill={active ? "#000" : "#fff"} stroke="#000" strokeWidth={1.2}/>;
                    })}
                    <circle cx={mx} cy={my} r={R} fill="#fff" stroke="#000" strokeWidth={1.4}/>
                    <text x={mx} y={my+4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#000" pointerEvents="none">{m.label}</text>
                    {/* View numbers — one per active flag, in the order it was
                        turned on (see the ElevationMarker/directions comment),
                        printed just outside that flag's tip. */}
                    {m.directions.map(dirKey => {
                      const theta = ELEVATION_DIR_ANGLES[dirKey];
                      const tip = elevationDir(theta);
                      const lx = mx + tip.x * (D + 9), ly = my + tip.y * (D + 9);
                      return (
                        <text key={"n"+dirKey} x={lx} y={ly+4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#000" pointerEvents="none"
                          stroke="#fff" strokeWidth={3} paintOrder="stroke">
                          {elevationDirNumber(m, dirKey)}
                        </text>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          ) : (
            <g>
              <defs>
                <linearGradient id="floorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={cc.floorA} stopOpacity="1"/><stop offset="100%" stopColor={cc.floorB} stopOpacity="1"/>
                </linearGradient>
                <pattern id="carpetPattern" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill={cc.floorA}/>
                  <line x1="0" y1="0" x2="0" y2="6" stroke={cc.grid} strokeWidth="0.8"/>
                  <line x1="3" y1="0" x2="3" y2="6" stroke={cc.grid} strokeWidth="0.5"/>
                  <line x1="0" y1="0" x2="6" y2="0" stroke={cc.grid} strokeWidth="0.8"/>
                  <line x1="0" y1="3" x2="6" y2="3" stroke={cc.grid} strokeWidth="0.5"/>
                </pattern>
                <linearGradient id="backWallGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#d1d5db" stopOpacity="0.5"/><stop offset="100%" stopColor="#e5e7eb" stopOpacity="0.4"/>
                </linearGradient>
                <linearGradient id="leftWallGrad" x1="100%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#c4c8cf" stopOpacity="0.45"/><stop offset="100%" stopColor="#d1d5db" stopOpacity="0.35"/>
                </linearGradient>
                <linearGradient id="screenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3"/><stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.05"/><stop offset="100%" stopColor="#000000" stopOpacity="0"/>
                </linearGradient>
                <linearGradient id="tableTopGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.85"/><stop offset="50%" stopColor="#cbd5e1" stopOpacity="0.75"/><stop offset="100%" stopColor="rgb(var(--text-muted))" stopOpacity="0.65"/>
                </linearGradient>
                <linearGradient id="tableFrontGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgb(var(--text-muted))" stopOpacity="0.5"/><stop offset="100%" stopColor="rgb(var(--text-subtle))" stopOpacity="0.4"/>
                </linearGradient>
                <linearGradient id="tableSideGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="rgb(var(--text-muted))" stopOpacity="0.4"/><stop offset="100%" stopColor="#475569" stopOpacity="0.3"/>
                </linearGradient>
              </defs>

              <polygon points={floorPts} fill="url(#floorGrad)" stroke="#b0b5be" strokeWidth={1}/>
              <polygon points={floorPts} fill="url(#floorGrad)" stroke="none"/>
              {Array.from({length:Math.ceil(roomW)+1},(_,i)=>(<line key={"gw"+i} x1={sX(i,0,0)} y1={sY(i,0,0)} x2={sX(i,roomL,0)} y2={sY(i,roomL,0)} stroke="rgb(var(--border))" strokeWidth={0.5} opacity={0.5}/>))}
              {Array.from({length:Math.ceil(roomL)+1},(_,i)=>(<line key={"gl"+i} x1={sX(0,i,0)} y1={sY(0,i,0)} x2={sX(roomW,i,0)} y2={sY(roomW,i,0)} stroke="rgb(var(--border))" strokeWidth={0.5} opacity={0.5}/>))}
              <polygon points={backWallPts} fill="url(#backWallGrad)" stroke="#b0b5be" strokeWidth={1}/>
              <polygon points={leftWallPts} fill="url(#leftWallGrad)" stroke="#b0b5be" strokeWidth={1}/>
              <line x1={sX(0,0,roomH)} y1={sY(0,0,roomH)} x2={sX(roomW,0,roomH)} y2={sY(roomW,0,roomH)} stroke="#b0b5be" strokeWidth={0.8} opacity={0.5}/>
              <line x1={sX(0,0,roomH)} y1={sY(0,0,roomH)} x2={sX(0,roomL,roomH)} y2={sY(0,roomL,roomH)} stroke="#b0b5be" strokeWidth={0.8} opacity={0.5}/>
              <text x={sX(roomW/2,roomL+0.3,0)} y={sY(roomW/2,roomL+0.3,0)+4} textAnchor="middle" fontSize={9} fill="rgb(var(--text-subtle))" fontFamily="'JetBrains Mono',monospace">{toDisplay(roomW)}</text>
              <text x={sX(roomW+0.4,roomL/2,0)} y={sY(roomW+0.4,roomL/2,0)+4} textAnchor="middle" fontSize={9} fill="rgb(var(--text-subtle))" fontFamily="'JetBrains Mono',monospace">{toDisplay(roomL)}</text>
              <text x={sX(-0.5,0,roomH/2)} y={sY(-0.5,0,roomH/2)} textAnchor="middle" fontSize={9} fill="rgb(var(--text-subtle))" fontFamily="'JetBrains Mono',monospace">{toDisplay(roomH)}</text>


              {showTable && render3DTable()}

              {placedDevices.map(dev=>{
                const isSelected=selectedUid===dev.uid||selectedUids.has(dev.uid), isDragging=dragUid===dev.uid;
                const wrapDevice=(inner:React.ReactNode)=>(
                  <g key={dev.uid} style={{cursor:isDragging?"grabbing":"move"}} onMouseDown={e=>handleDeviceMouseDown(e,dev.uid)} opacity={isDragging?0.8:1}>
                    {isSelected&&<circle cx={sX(dev.x,dev.y,dev.z)} cy={sY(dev.x,dev.y,dev.z)} r={16} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" opacity={0.6}/>}
                    {inner}
                  </g>
                );
                if(dev.type==="display"){
                  const hw2=dev.w/2, hh2=dev.h/2, mw=dev.mountWall||"north";
                  let pts:string, innerPts:string, labelX:number, labelY:number;
                  if(mw==="north"){
                    pts=[`${sX(dev.x-hw2,0.02,dev.z+hh2)},${sY(dev.x-hw2,0.02,dev.z+hh2)}`,`${sX(dev.x+hw2,0.02,dev.z+hh2)},${sY(dev.x+hw2,0.02,dev.z+hh2)}`,`${sX(dev.x+hw2,0.02,dev.z-hh2)},${sY(dev.x+hw2,0.02,dev.z-hh2)}`,`${sX(dev.x-hw2,0.02,dev.z-hh2)},${sY(dev.x-hw2,0.02,dev.z-hh2)}`].join(" ");
                    innerPts=[`${sX(dev.x-hw2+0.04,0.02,dev.z+hh2-0.03)},${sY(dev.x-hw2+0.04,0.02,dev.z+hh2-0.03)}`,`${sX(dev.x+hw2-0.04,0.02,dev.z+hh2-0.03)},${sY(dev.x+hw2-0.04,0.02,dev.z+hh2-0.03)}`,`${sX(dev.x+hw2-0.04,0.02,dev.z-hh2+0.03)},${sY(dev.x+hw2-0.04,0.02,dev.z-hh2+0.03)}`,`${sX(dev.x-hw2+0.04,0.02,dev.z-hh2+0.03)},${sY(dev.x-hw2+0.04,0.02,dev.z-hh2+0.03)}`].join(" ");
                    labelX=sX(dev.x,0.02,dev.z); labelY=sY(dev.x,0.02,dev.z);
                  } else if(mw==="south"){
                    pts=[`${sX(dev.x-hw2,roomL-0.02,dev.z+hh2)},${sY(dev.x-hw2,roomL-0.02,dev.z+hh2)}`,`${sX(dev.x+hw2,roomL-0.02,dev.z+hh2)},${sY(dev.x+hw2,roomL-0.02,dev.z+hh2)}`,`${sX(dev.x+hw2,roomL-0.02,dev.z-hh2)},${sY(dev.x+hw2,roomL-0.02,dev.z-hh2)}`,`${sX(dev.x-hw2,roomL-0.02,dev.z-hh2)},${sY(dev.x-hw2,roomL-0.02,dev.z-hh2)}`].join(" ");
                    innerPts=[`${sX(dev.x-hw2+0.04,roomL-0.02,dev.z+hh2-0.03)},${sY(dev.x-hw2+0.04,roomL-0.02,dev.z+hh2-0.03)}`,`${sX(dev.x+hw2-0.04,roomL-0.02,dev.z+hh2-0.03)},${sY(dev.x+hw2-0.04,roomL-0.02,dev.z+hh2-0.03)}`,`${sX(dev.x+hw2-0.04,roomL-0.02,dev.z-hh2+0.03)},${sY(dev.x+hw2-0.04,roomL-0.02,dev.z-hh2+0.03)}`,`${sX(dev.x-hw2+0.04,roomL-0.02,dev.z-hh2+0.03)},${sY(dev.x-hw2+0.04,roomL-0.02,dev.z-hh2+0.03)}`].join(" ");
                    labelX=sX(dev.x,roomL-0.02,dev.z); labelY=sY(dev.x,roomL-0.02,dev.z);
                  } else if(mw==="west"){
                    pts=[`${sX(0.02,dev.y-hw2,dev.z+hh2)},${sY(0.02,dev.y-hw2,dev.z+hh2)}`,`${sX(0.02,dev.y+hw2,dev.z+hh2)},${sY(0.02,dev.y+hw2,dev.z+hh2)}`,`${sX(0.02,dev.y+hw2,dev.z-hh2)},${sY(0.02,dev.y+hw2,dev.z-hh2)}`,`${sX(0.02,dev.y-hw2,dev.z-hh2)},${sY(0.02,dev.y-hw2,dev.z-hh2)}`].join(" ");
                    innerPts=[`${sX(0.02,dev.y-hw2+0.04,dev.z+hh2-0.03)},${sY(0.02,dev.y-hw2+0.04,dev.z+hh2-0.03)}`,`${sX(0.02,dev.y+hw2-0.04,dev.z+hh2-0.03)},${sY(0.02,dev.y+hw2-0.04,dev.z+hh2-0.03)}`,`${sX(0.02,dev.y+hw2-0.04,dev.z-hh2+0.03)},${sY(0.02,dev.y+hw2-0.04,dev.z-hh2+0.03)}`,`${sX(0.02,dev.y-hw2+0.04,dev.z-hh2+0.03)},${sY(0.02,dev.y-hw2+0.04,dev.z-hh2+0.03)}`].join(" ");
                    labelX=sX(0.02,dev.y,dev.z); labelY=sY(0.02,dev.y,dev.z);
                  } else {
                    pts=[`${sX(roomW-0.02,dev.y-hw2,dev.z+hh2)},${sY(roomW-0.02,dev.y-hw2,dev.z+hh2)}`,`${sX(roomW-0.02,dev.y+hw2,dev.z+hh2)},${sY(roomW-0.02,dev.y+hw2,dev.z+hh2)}`,`${sX(roomW-0.02,dev.y+hw2,dev.z-hh2)},${sY(roomW-0.02,dev.y+hw2,dev.z-hh2)}`,`${sX(roomW-0.02,dev.y-hw2,dev.z-hh2)},${sY(roomW-0.02,dev.y-hw2,dev.z-hh2)}`].join(" ");
                    innerPts=[`${sX(roomW-0.02,dev.y-hw2+0.04,dev.z+hh2-0.03)},${sY(roomW-0.02,dev.y-hw2+0.04,dev.z+hh2-0.03)}`,`${sX(roomW-0.02,dev.y+hw2-0.04,dev.z+hh2-0.03)},${sY(roomW-0.02,dev.y+hw2-0.04,dev.z+hh2-0.03)}`,`${sX(roomW-0.02,dev.y+hw2-0.04,dev.z-hh2+0.03)},${sY(roomW-0.02,dev.y+hw2-0.04,dev.z-hh2+0.03)}`,`${sX(roomW-0.02,dev.y-hw2+0.04,dev.z-hh2+0.03)},${sY(roomW-0.02,dev.y-hw2+0.04,dev.z-hh2+0.03)}`].join(" ");
                    labelX=sX(roomW-0.02,dev.y,dev.z); labelY=sY(roomW-0.02,dev.y,dev.z);
                  }
                  const bdr=0.03;
                  let borderPts:string;
                  if(mw==="north"){
                    borderPts=[`${sX(dev.x-hw2-bdr,0.02,dev.z+hh2+bdr)},${sY(dev.x-hw2-bdr,0.02,dev.z+hh2+bdr)}`,`${sX(dev.x+hw2+bdr,0.02,dev.z+hh2+bdr)},${sY(dev.x+hw2+bdr,0.02,dev.z+hh2+bdr)}`,`${sX(dev.x+hw2+bdr,0.02,dev.z-hh2-bdr)},${sY(dev.x+hw2+bdr,0.02,dev.z-hh2-bdr)}`,`${sX(dev.x-hw2-bdr,0.02,dev.z-hh2-bdr)},${sY(dev.x-hw2-bdr,0.02,dev.z-hh2-bdr)}`].join(" ");
                  } else if(mw==="south"){
                    borderPts=[`${sX(dev.x-hw2-bdr,roomL-0.02,dev.z+hh2+bdr)},${sY(dev.x-hw2-bdr,roomL-0.02,dev.z+hh2+bdr)}`,`${sX(dev.x+hw2+bdr,roomL-0.02,dev.z+hh2+bdr)},${sY(dev.x+hw2+bdr,roomL-0.02,dev.z+hh2+bdr)}`,`${sX(dev.x+hw2+bdr,roomL-0.02,dev.z-hh2-bdr)},${sY(dev.x+hw2+bdr,roomL-0.02,dev.z-hh2-bdr)}`,`${sX(dev.x-hw2-bdr,roomL-0.02,dev.z-hh2-bdr)},${sY(dev.x-hw2-bdr,roomL-0.02,dev.z-hh2-bdr)}`].join(" ");
                  } else if(mw==="west"){
                    borderPts=[`${sX(0.02,dev.y-hw2-bdr,dev.z+hh2+bdr)},${sY(0.02,dev.y-hw2-bdr,dev.z+hh2+bdr)}`,`${sX(0.02,dev.y+hw2+bdr,dev.z+hh2+bdr)},${sY(0.02,dev.y+hw2+bdr,dev.z+hh2+bdr)}`,`${sX(0.02,dev.y+hw2+bdr,dev.z-hh2-bdr)},${sY(0.02,dev.y+hw2+bdr,dev.z-hh2-bdr)}`,`${sX(0.02,dev.y-hw2-bdr,dev.z-hh2-bdr)},${sY(0.02,dev.y-hw2-bdr,dev.z-hh2-bdr)}`].join(" ");
                  } else {
                    borderPts=[`${sX(roomW-0.02,dev.y-hw2-bdr,dev.z+hh2+bdr)},${sY(roomW-0.02,dev.y-hw2-bdr,dev.z+hh2+bdr)}`,`${sX(roomW-0.02,dev.y+hw2+bdr,dev.z+hh2+bdr)},${sY(roomW-0.02,dev.y+hw2+bdr,dev.z+hh2+bdr)}`,`${sX(roomW-0.02,dev.y+hw2+bdr,dev.z-hh2-bdr)},${sY(roomW-0.02,dev.y+hw2+bdr,dev.z-hh2-bdr)}`,`${sX(roomW-0.02,dev.y-hw2-bdr,dev.z-hh2-bdr)},${sY(roomW-0.02,dev.y-hw2-bdr,dev.z-hh2-bdr)}`].join(" ");
                  }
                  // LG UH5J style - thin bezel, slim profile, screen with subtle gradient
                  const bezel=0.012; // ~12mm thin bezel
                  let screenPts:string;
                  if(mw==="north"){
                    screenPts=[`${sX(dev.x-hw2+bezel,0.02,dev.z+hh2-bezel)},${sY(dev.x-hw2+bezel,0.02,dev.z+hh2-bezel)}`,`${sX(dev.x+hw2-bezel,0.02,dev.z+hh2-bezel)},${sY(dev.x+hw2-bezel,0.02,dev.z+hh2-bezel)}`,`${sX(dev.x+hw2-bezel,0.02,dev.z-hh2+bezel)},${sY(dev.x+hw2-bezel,0.02,dev.z-hh2+bezel)}`,`${sX(dev.x-hw2+bezel,0.02,dev.z-hh2+bezel)},${sY(dev.x-hw2+bezel,0.02,dev.z-hh2+bezel)}`].join(" ");
                  } else if(mw==="south"){
                    screenPts=[`${sX(dev.x-hw2+bezel,roomL-0.02,dev.z+hh2-bezel)},${sY(dev.x-hw2+bezel,roomL-0.02,dev.z+hh2-bezel)}`,`${sX(dev.x+hw2-bezel,roomL-0.02,dev.z+hh2-bezel)},${sY(dev.x+hw2-bezel,roomL-0.02,dev.z+hh2-bezel)}`,`${sX(dev.x+hw2-bezel,roomL-0.02,dev.z-hh2+bezel)},${sY(dev.x+hw2-bezel,roomL-0.02,dev.z-hh2+bezel)}`,`${sX(dev.x-hw2+bezel,roomL-0.02,dev.z-hh2+bezel)},${sY(dev.x-hw2+bezel,roomL-0.02,dev.z-hh2+bezel)}`].join(" ");
                  } else if(mw==="west"){
                    screenPts=[`${sX(0.02,dev.y-hw2+bezel,dev.z+hh2-bezel)},${sY(0.02,dev.y-hw2+bezel,dev.z+hh2-bezel)}`,`${sX(0.02,dev.y+hw2-bezel,dev.z+hh2-bezel)},${sY(0.02,dev.y+hw2-bezel,dev.z+hh2-bezel)}`,`${sX(0.02,dev.y+hw2-bezel,dev.z-hh2+bezel)},${sY(0.02,dev.y+hw2-bezel,dev.z-hh2+bezel)}`,`${sX(0.02,dev.y-hw2+bezel,dev.z-hh2+bezel)},${sY(0.02,dev.y-hw2+bezel,dev.z-hh2+bezel)}`].join(" ");
                  } else {
                    screenPts=[`${sX(roomW-0.02,dev.y-hw2+bezel,dev.z+hh2-bezel)},${sY(roomW-0.02,dev.y-hw2+bezel,dev.z+hh2-bezel)}`,`${sX(roomW-0.02,dev.y+hw2-bezel,dev.z+hh2-bezel)},${sY(roomW-0.02,dev.y+hw2-bezel,dev.z+hh2-bezel)}`,`${sX(roomW-0.02,dev.y+hw2-bezel,dev.z-hh2+bezel)},${sY(roomW-0.02,dev.y+hw2-bezel,dev.z-hh2+bezel)}`,`${sX(roomW-0.02,dev.y-hw2+bezel,dev.z-hh2+bezel)},${sY(roomW-0.02,dev.y-hw2+bezel,dev.z-hh2+bezel)}`].join(" ");
                  }
                  // Power LED position (bottom center of bezel)
                  let ledPx:number, ledPy:number;
                  if(mw==="north"){ledPx=sX(dev.x,0.02,dev.z-hh2+bezel*0.5);ledPy=sY(dev.x,0.02,dev.z-hh2+bezel*0.5);}
                  else if(mw==="south"){ledPx=sX(dev.x,roomL-0.02,dev.z-hh2+bezel*0.5);ledPy=sY(dev.x,roomL-0.02,dev.z-hh2+bezel*0.5);}
                  else if(mw==="west"){ledPx=sX(0.02,dev.y,dev.z-hh2+bezel*0.5);ledPy=sY(0.02,dev.y,dev.z-hh2+bezel*0.5);}
                  else{ledPx=sX(roomW-0.02,dev.y,dev.z-hh2+bezel*0.5);ledPy=sY(roomW-0.02,dev.y,dev.z-hh2+bezel*0.5);}
                  return wrapDevice(<g>
                    {/* Blue boundary */}
                    <polygon points={borderPts} fill="none" stroke={dev.color+"88"} strokeWidth={0.8}/>
                    {/* Bezel - thin black frame */}
                    <polygon points={pts} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={1.5}/>
                    {/* Screen - dark with subtle blue tint */}
                    <polygon points={screenPts} fill="#070b14" stroke="#111827" strokeWidth={0.3}/>
                    {/* Screen reflection highlight */}
                    <polygon points={screenPts} fill="url(#screenGrad)" opacity={0.08}/>
                    <text x={labelX} y={labelY+3} textAnchor="middle" fontSize={8} fill={dev.color} fontFamily="'JetBrains Mono',monospace" fontWeight={600} className="dev-label">{dev.name}</text>
                  </g>);
                }
                if(dev.type==="camera"){
                  if(dev.wall==="ceiling"){
                    const cpx=sX(dev.x,dev.y,roomH), cpy=sY(dev.x,dev.y,roomH);
                    return wrapDevice(<g><circle cx={cpx} cy={cpy} r={6} fill={dev.color+"33"} stroke={dev.color} strokeWidth={1.5}/><circle cx={cpx} cy={cpy} r={2.5} fill={dev.color}/><text x={cpx} y={cpy+14} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text></g>);
                  }
                  const mw=dev.mountWall||"north";
                  const isSoundbarCam = dev.id==="soundbar-cam";

                  if(isSoundbarCam){
                    // Rally Bar style: wide slim bar mounted flush to wall
                    const barW=dev.w/2, barH=0.044, barD=0.06;
                    let bx=dev.x, by=dev.y;
                    if(mw==="north") by=barD*0.5; else if(mw==="south") by=roomL-barD*0.5;
                    else if(mw==="west") bx=barD*0.5; else bx=roomW-barD*0.5;
                    const bpx=sX(bx,by,dev.z), bpy=sY(bx,by,dev.z);
                    const lx=bpx, ly=bpy+16;
                    if(mw==="north"||mw==="south"){
                      const fDir=mw==="north"?barD/2:-barD/2;
                      // Top face
                      const topP=[`${sX(bx-barW,by-barD/2,dev.z+barH)},${sY(bx-barW,by-barD/2,dev.z+barH)}`,`${sX(bx+barW,by-barD/2,dev.z+barH)},${sY(bx+barW,by-barD/2,dev.z+barH)}`,`${sX(bx+barW,by+barD/2,dev.z+barH)},${sY(bx+barW,by+barD/2,dev.z+barH)}`,`${sX(bx-barW,by+barD/2,dev.z+barH)},${sY(bx-barW,by+barD/2,dev.z+barH)}`].join(" ");
                      // Front face
                      const frP=[`${sX(bx-barW,by+fDir,dev.z+barH)},${sY(bx-barW,by+fDir,dev.z+barH)}`,`${sX(bx+barW,by+fDir,dev.z+barH)},${sY(bx+barW,by+fDir,dev.z+barH)}`,`${sX(bx+barW,by+fDir,dev.z-barH)},${sY(bx+barW,by+fDir,dev.z-barH)}`,`${sX(bx-barW,by+fDir,dev.z-barH)},${sY(bx-barW,by+fDir,dev.z-barH)}`].join(" ");
                      // Right side
                      const rtP=[`${sX(bx+barW,by-barD/2,dev.z+barH)},${sY(bx+barW,by-barD/2,dev.z+barH)}`,`${sX(bx+barW,by+barD/2,dev.z+barH)},${sY(bx+barW,by+barD/2,dev.z+barH)}`,`${sX(bx+barW,by+barD/2,dev.z-barH)},${sY(bx+barW,by+barD/2,dev.z-barH)}`,`${sX(bx+barW,by-barD/2,dev.z-barH)},${sY(bx+barW,by-barD/2,dev.z-barH)}`].join(" ");
                      // Camera lens position (center front)
                      const lensPx=sX(bx,by+fDir+0.005,dev.z), lensPy=sY(bx,by+fDir+0.005,dev.z);
                      // Speaker grille dots
                      const grilleDots=[];
                      for(let gi=-3;gi<=3;gi++){if(gi===0)continue; const gx=bx+gi*barW*0.22; grilleDots.push({x:sX(gx,by+fDir+0.003,dev.z),y:sY(gx,by+fDir+0.003,dev.z)});}
                      return wrapDevice(<g>
                        <polygon points={frP} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={0.6}/>
                        <polygon points={rtP} fill="#0f1724" stroke={cc.deviceBorder} strokeWidth={0.5}/>
                        <polygon points={topP} fill="rgb(var(--border))" stroke={cc.deviceBorderLight} strokeWidth={0.5}/>
                        {grilleDots.map((dot,gi)=><circle key={gi} cx={dot.x} cy={dot.y} r={0.8} fill="#334155"/>)}
                        <circle cx={lensPx} cy={lensPy} r={3.5} fill={cc.deviceDeep} stroke="#475569" strokeWidth={0.7}/>
                        <circle cx={lensPx} cy={lensPy} r={2} fill={cc.device} stroke={cc.deviceBorderLight} strokeWidth={0.5}/>
                        <circle cx={lensPx} cy={lensPy} r={0.8} fill="#1e3a5f"/>
                        <text x={lx} y={ly} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                      </g>);
                    } else {
                      const fDir=mw==="west"?barD/2:-barD/2;
                      const topP=[`${sX(bx-barD/2,by-barW,dev.z+barH)},${sY(bx-barD/2,by-barW,dev.z+barH)}`,`${sX(bx+barD/2,by-barW,dev.z+barH)},${sY(bx+barD/2,by-barW,dev.z+barH)}`,`${sX(bx+barD/2,by+barW,dev.z+barH)},${sY(bx+barD/2,by+barW,dev.z+barH)}`,`${sX(bx-barD/2,by+barW,dev.z+barH)},${sY(bx-barD/2,by+barW,dev.z+barH)}`].join(" ");
                      const frP=[`${sX(bx+fDir,by-barW,dev.z+barH)},${sY(bx+fDir,by-barW,dev.z+barH)}`,`${sX(bx+fDir,by+barW,dev.z+barH)},${sY(bx+fDir,by+barW,dev.z+barH)}`,`${sX(bx+fDir,by+barW,dev.z-barH)},${sY(bx+fDir,by+barW,dev.z-barH)}`,`${sX(bx+fDir,by-barW,dev.z-barH)},${sY(bx+fDir,by-barW,dev.z-barH)}`].join(" ");
                      const rtP=[`${sX(bx-barD/2,by+barW,dev.z+barH)},${sY(bx-barD/2,by+barW,dev.z+barH)}`,`${sX(bx+barD/2,by+barW,dev.z+barH)},${sY(bx+barD/2,by+barW,dev.z+barH)}`,`${sX(bx+barD/2,by+barW,dev.z-barH)},${sY(bx+barD/2,by+barW,dev.z-barH)}`,`${sX(bx-barD/2,by+barW,dev.z-barH)},${sY(bx-barD/2,by+barW,dev.z-barH)}`].join(" ");
                      const lensPx=sX(bx+fDir+0.005,by,dev.z), lensPy=sY(bx+fDir+0.005,by,dev.z);
                      const grilleDots=[];
                      for(let gi=-3;gi<=3;gi++){if(gi===0)continue; const gy=by+gi*barW*0.22; grilleDots.push({x:sX(bx+fDir+0.003,gy,dev.z),y:sY(bx+fDir+0.003,gy,dev.z)});}
                      return wrapDevice(<g>
                        <polygon points={frP} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={0.6}/>
                        <polygon points={rtP} fill="#0f1724" stroke={cc.deviceBorder} strokeWidth={0.5}/>
                        <polygon points={topP} fill="rgb(var(--border))" stroke={cc.deviceBorderLight} strokeWidth={0.5}/>
                        {grilleDots.map((dot,gi)=><circle key={gi} cx={dot.x} cy={dot.y} r={0.8} fill="#334155"/>)}
                        <circle cx={lensPx} cy={lensPy} r={3.5} fill={cc.deviceDeep} stroke="#475569" strokeWidth={0.7}/>
                        <circle cx={lensPx} cy={lensPy} r={2} fill={cc.device} stroke={cc.deviceBorderLight} strokeWidth={0.5}/>
                        <circle cx={lensPx} cy={lensPy} r={0.8} fill="#1e3a5f"/>
                        <text x={lx} y={ly} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                      </g>);
                    }
                  }

                  const camW=0.12, camH2=0.06, camD=0.12;
                  let bx=dev.x, by=dev.y;
                  if(mw==="north") by=camD*0.5; else if(mw==="south") by=roomL-camD*0.5;
                  else if(mw==="west") bx=camD*0.5; else bx=roomW-camD*0.5;
                  const wallPx=sX(dev.x,dev.y,dev.z), wallPy=sY(dev.x,dev.y,dev.z);
                  const bpx=sX(bx,by,dev.z), bpy=sY(bx,by,dev.z);
                  let topP:string, frP:string, rtP:string, lensPx:number, lensPy:number;
                  if(mw==="north"||mw==="south"){
                    topP=[`${sX(bx-camW,by-0.04,dev.z+camH2)},${sY(bx-camW,by-0.04,dev.z+camH2)}`,`${sX(bx+camW,by-0.04,dev.z+camH2)},${sY(bx+camW,by-0.04,dev.z+camH2)}`,`${sX(bx+camW,by+0.04,dev.z+camH2)},${sY(bx+camW,by+0.04,dev.z+camH2)}`,`${sX(bx-camW,by+0.04,dev.z+camH2)},${sY(bx-camW,by+0.04,dev.z+camH2)}`].join(" ");
                    const fDir=mw==="north"?0.04:-0.04;
                    frP=[`${sX(bx-camW,by+fDir,dev.z+camH2)},${sY(bx-camW,by+fDir,dev.z+camH2)}`,`${sX(bx+camW,by+fDir,dev.z+camH2)},${sY(bx+camW,by+fDir,dev.z+camH2)}`,`${sX(bx+camW,by+fDir,dev.z-camH2)},${sY(bx+camW,by+fDir,dev.z-camH2)}`,`${sX(bx-camW,by+fDir,dev.z-camH2)},${sY(bx-camW,by+fDir,dev.z-camH2)}`].join(" ");
                    rtP=[`${sX(bx+camW,by-0.04,dev.z+camH2)},${sY(bx+camW,by-0.04,dev.z+camH2)}`,`${sX(bx+camW,by+0.04,dev.z+camH2)},${sY(bx+camW,by+0.04,dev.z+camH2)}`,`${sX(bx+camW,by+0.04,dev.z-camH2)},${sY(bx+camW,by+0.04,dev.z-camH2)}`,`${sX(bx+camW,by-0.04,dev.z-camH2)},${sY(bx+camW,by-0.04,dev.z-camH2)}`].join(" ");
                    lensPx=sX(bx,by+fDir+0.005,dev.z); lensPy=sY(bx,by+fDir+0.005,dev.z);
                  } else {
                    topP=[`${sX(bx-0.04,by-camW,dev.z+camH2)},${sY(bx-0.04,by-camW,dev.z+camH2)}`,`${sX(bx+0.04,by-camW,dev.z+camH2)},${sY(bx+0.04,by-camW,dev.z+camH2)}`,`${sX(bx+0.04,by+camW,dev.z+camH2)},${sY(bx+0.04,by+camW,dev.z+camH2)}`,`${sX(bx-0.04,by+camW,dev.z+camH2)},${sY(bx-0.04,by+camW,dev.z+camH2)}`].join(" ");
                    const fDir=mw==="west"?0.04:-0.04;
                    frP=[`${sX(bx+fDir,by-camW,dev.z+camH2)},${sY(bx+fDir,by-camW,dev.z+camH2)}`,`${sX(bx+fDir,by+camW,dev.z+camH2)},${sY(bx+fDir,by+camW,dev.z+camH2)}`,`${sX(bx+fDir,by+camW,dev.z-camH2)},${sY(bx+fDir,by+camW,dev.z-camH2)}`,`${sX(bx+fDir,by-camW,dev.z-camH2)},${sY(bx+fDir,by-camW,dev.z-camH2)}`].join(" ");
                    rtP=[`${sX(bx-0.04,by+camW,dev.z+camH2)},${sY(bx-0.04,by+camW,dev.z+camH2)}`,`${sX(bx+0.04,by+camW,dev.z+camH2)},${sY(bx+0.04,by+camW,dev.z+camH2)}`,`${sX(bx+0.04,by+camW,dev.z-camH2)},${sY(bx+0.04,by+camW,dev.z-camH2)}`,`${sX(bx-0.04,by+camW,dev.z-camH2)},${sY(bx-0.04,by+camW,dev.z-camH2)}`].join(" ");
                    lensPx=sX(bx+fDir+0.005,by,dev.z); lensPy=sY(bx+fDir+0.005,by,dev.z);
                  }
                  return wrapDevice(<g>
                    <line x1={wallPx} y1={wallPy} x2={bpx} y2={bpy} stroke="#4b5563" strokeWidth={2.5} strokeLinecap="round"/>
                    <polygon points={frP} fill={cc.device} stroke={cc.deviceBorderLight} strokeWidth={0.6}/>
                    <polygon points={rtP} fill="#1a2332" stroke={cc.deviceBorderLight} strokeWidth={0.5}/>
                    <polygon points={topP} fill="#2d3748" stroke="#475569" strokeWidth={0.5}/>
                    <circle cx={lensPx} cy={lensPy} r={4} fill={cc.deviceDeep} stroke="#475569" strokeWidth={0.8}/>
                    <circle cx={lensPx} cy={lensPy} r={2.5} fill={cc.device} stroke={cc.deviceBorderLight} strokeWidth={0.5}/>
                    <circle cx={lensPx} cy={lensPy} r={1.2} fill="rgb(var(--border))"/>
                    <text x={bpx} y={bpy+18} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                  </g>);
                }
                if(dev.type==="mic"){
                  if(dev.wall==="ceiling"){
                    const cpx=sX(dev.x,dev.y,roomH), cpy=sY(dev.x,dev.y,roomH);
                    const fpx=sX(dev.x,dev.y,0), fpy=sY(dev.x,dev.y,0);
                    // MXA920 square tile in isometric
                    const ts=dev.w/2; // half tile size in meters
                    const tilePts=[
                      `${sX(dev.x-ts,dev.y-ts,roomH)},${sY(dev.x-ts,dev.y-ts,roomH)}`,
                      `${sX(dev.x+ts,dev.y-ts,roomH)},${sY(dev.x+ts,dev.y-ts,roomH)}`,
                      `${sX(dev.x+ts,dev.y+ts,roomH)},${sY(dev.x+ts,dev.y+ts,roomH)}`,
                      `${sX(dev.x-ts,dev.y+ts,roomH)},${sY(dev.x-ts,dev.y+ts,roomH)}`
                    ].join(" ");
                    // Mic hole positions (3x3 grid)
                    const micDots=[];
                    for(let r=-1;r<=1;r++)for(let c=-1;c<=1;c++){
                      const dx=c*ts*0.5, dy=r*ts*0.5;
                      micDots.push({x:sX(dev.x+dx,dev.y+dy,roomH+0.002),y:sY(dev.x+dx,dev.y+dy,roomH+0.002)});
                    }
                    // LED strip
                    const ledL={x:sX(dev.x-ts*0.4,dev.y+ts*0.85,roomH+0.002),y:sY(dev.x-ts*0.4,dev.y+ts*0.85,roomH+0.002)};
                    const ledR={x:sX(dev.x+ts*0.4,dev.y+ts*0.85,roomH+0.002),y:sY(dev.x+ts*0.4,dev.y+ts*0.85,roomH+0.002)};
                    const cShape3d=dev.covShape||"round";
                    const covDia=dev.covDiameter||6;
                    const covW3d=dev.covW||6;
                    const covL3d=dev.covL||6;
                    return wrapDevice(<g>
                      {/* Coverage projection on floor */}
                      <line x1={cpx} y1={cpy} x2={fpx} y2={fpy} stroke={dev.color} strokeWidth={0.5} strokeDasharray="3 2" opacity={0.2}/>
                      {cShape3d==="round" ? (
                        <polygon points={Array.from({length:24},(_,i)=>{const a=(i/24)*Math.PI*2;const r=covDia/2;return `${sX(dev.x+r*Math.cos(a),dev.y+r*Math.sin(a),0)},${sY(dev.x+r*Math.cos(a),dev.y+r*Math.sin(a),0)}`;}).join(" ")} fill={dev.color} opacity={0.04} stroke={dev.color} strokeWidth={0.5} strokeDasharray="2 2"/>
                      ) : (
                        <polygon points={[
                          `${sX(dev.x-covW3d/2,dev.y-covL3d/2,0)},${sY(dev.x-covW3d/2,dev.y-covL3d/2,0)}`,
                          `${sX(dev.x+covW3d/2,dev.y-covL3d/2,0)},${sY(dev.x+covW3d/2,dev.y-covL3d/2,0)}`,
                          `${sX(dev.x+covW3d/2,dev.y+covL3d/2,0)},${sY(dev.x+covW3d/2,dev.y+covL3d/2,0)}`,
                          `${sX(dev.x-covW3d/2,dev.y+covL3d/2,0)},${sY(dev.x-covW3d/2,dev.y+covL3d/2,0)}`
                        ].join(" ")} fill={dev.color} opacity={0.04} stroke={dev.color} strokeWidth={0.5} strokeDasharray="2 2"/>
                      )}
                      {/* Square tile */}
                      <polygon points={tilePts} fill={cc.device} stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* Mic hole dots */}
                      {micDots.map((d,i)=><circle key={i} cx={d.x} cy={d.y} r={1} fill="#334155"/>)}
                      <text x={cpx} y={cpy-14} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                    </g>);
                  }
                  const cpx=sX(dev.x,dev.y,dev.z), cpy=sY(dev.x,dev.y,dev.z);
                  // Table mic - Shure MXA310 isometric disc on table
                  if(dev.id==="table-mic"){
                    const discR=dev.w/2; // radius in meters
                    const discH=0.015; // very low profile
                    const isoDisc=(r:number,z:number,n:number)=>Array.from({length:n},(_,i)=>{const a=(i/n)*Math.PI*2;return `${sX(dev.x+r*Math.cos(a),dev.y+r*Math.sin(a),z)},${sY(dev.x+r*Math.cos(a),dev.y+r*Math.sin(a),z)}`;}).join(" ");
                    const tmCovR3d=(dev.covDiameter||2)/2;
                    return wrapDevice(<g>
                      {/* Coverage circle on table surface */}
                      <polygon points={isoDisc(tmCovR3d,dev.z,24)} fill={dev.color} opacity={0.04} stroke={dev.color} strokeWidth={0.5} strokeDasharray="2 2"/>
                      {/* Disc side/rim */}
                      <polygon points={isoDisc(discR,dev.z,20)} fill="#2d3748" stroke="#475569" strokeWidth={0.5}/>
                      {/* Top surface */}
                      <polygon points={isoDisc(discR,dev.z+discH,24)} fill={cc.device} stroke={dev.color+"88"} strokeWidth={0.8}/>
                      {/* LED ring */}
                      <polygon points={isoDisc(discR*0.7,dev.z+discH+0.001,20)} fill="none" stroke={dev.color} strokeWidth={0.6} opacity={0.5}/>
                      {/* Inner circle */}
                      <polygon points={isoDisc(discR*0.45,dev.z+discH+0.002,16)} fill={cc.device} stroke={cc.deviceBorderLight} strokeWidth={0.4}/>
                      {/* Center dot */}
                      <polygon points={isoDisc(discR*0.15,dev.z+discH+0.003,8)} fill="#334155"/>
                      <text x={cpx} y={cpy-10} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                    </g>);
                  }
                  return wrapDevice(<g><circle cx={cpx} cy={cpy} r={4} fill={dev.color+"33"} stroke={dev.color} strokeWidth={1}/><circle cx={cpx} cy={cpy} r={1.5} fill={dev.color}/><text x={cpx} y={cpy+12} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text></g>);
                }
                if(dev.type==="speaker"){
                  const cpx=sX(dev.x,dev.y,dev.z), cpy=sY(dev.x,dev.y,dev.z);
                  if(dev.wall==="front"){
                    const hw=dev.w/2, hh=dev.h/2, depth=0.12, mw=dev.mountWall||"north";
                    // Wall offset, front face, top face, side face
                    let frontPts:string, topPts:string, sidePts:string, grillePts:string, lx2:number, ly2:number;
                    if(mw==="north"){
                      const wy=0.02, fy=wy+depth;
                      frontPts=[`${sX(dev.x-hw,fy,dev.z+hh)},${sY(dev.x-hw,fy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z+hh)},${sY(dev.x+hw,fy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z-hh)},${sY(dev.x+hw,fy,dev.z-hh)}`,`${sX(dev.x-hw,fy,dev.z-hh)},${sY(dev.x-hw,fy,dev.z-hh)}`].join(" ");
                      topPts=[`${sX(dev.x-hw,wy,dev.z+hh)},${sY(dev.x-hw,wy,dev.z+hh)}`,`${sX(dev.x+hw,wy,dev.z+hh)},${sY(dev.x+hw,wy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z+hh)},${sY(dev.x+hw,fy,dev.z+hh)}`,`${sX(dev.x-hw,fy,dev.z+hh)},${sY(dev.x-hw,fy,dev.z+hh)}`].join(" ");
                      sidePts=[`${sX(dev.x+hw,wy,dev.z+hh)},${sY(dev.x+hw,wy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z+hh)},${sY(dev.x+hw,fy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z-hh)},${sY(dev.x+hw,fy,dev.z-hh)}`,`${sX(dev.x+hw,wy,dev.z-hh)},${sY(dev.x+hw,wy,dev.z-hh)}`].join(" ");
                      const gm=0.02; grillePts=[`${sX(dev.x-hw+gm,fy+0.001,dev.z+hh-gm)},${sY(dev.x-hw+gm,fy+0.001,dev.z+hh-gm)}`,`${sX(dev.x+hw-gm,fy+0.001,dev.z+hh-gm)},${sY(dev.x+hw-gm,fy+0.001,dev.z+hh-gm)}`,`${sX(dev.x+hw-gm,fy+0.001,dev.z-hh+gm)},${sY(dev.x+hw-gm,fy+0.001,dev.z-hh+gm)}`,`${sX(dev.x-hw+gm,fy+0.001,dev.z-hh+gm)},${sY(dev.x-hw+gm,fy+0.001,dev.z-hh+gm)}`].join(" ");
                      lx2=sX(dev.x,fy,dev.z); ly2=sY(dev.x,fy,dev.z);
                    } else if(mw==="south"){
                      const wy=roomL-0.02, fy=wy-depth;
                      frontPts=[`${sX(dev.x-hw,fy,dev.z+hh)},${sY(dev.x-hw,fy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z+hh)},${sY(dev.x+hw,fy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z-hh)},${sY(dev.x+hw,fy,dev.z-hh)}`,`${sX(dev.x-hw,fy,dev.z-hh)},${sY(dev.x-hw,fy,dev.z-hh)}`].join(" ");
                      topPts=[`${sX(dev.x-hw,wy,dev.z+hh)},${sY(dev.x-hw,wy,dev.z+hh)}`,`${sX(dev.x+hw,wy,dev.z+hh)},${sY(dev.x+hw,wy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z+hh)},${sY(dev.x+hw,fy,dev.z+hh)}`,`${sX(dev.x-hw,fy,dev.z+hh)},${sY(dev.x-hw,fy,dev.z+hh)}`].join(" ");
                      sidePts=[`${sX(dev.x+hw,wy,dev.z+hh)},${sY(dev.x+hw,wy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z+hh)},${sY(dev.x+hw,fy,dev.z+hh)}`,`${sX(dev.x+hw,fy,dev.z-hh)},${sY(dev.x+hw,fy,dev.z-hh)}`,`${sX(dev.x+hw,wy,dev.z-hh)},${sY(dev.x+hw,wy,dev.z-hh)}`].join(" ");
                      const gm=0.02; grillePts=[`${sX(dev.x-hw+gm,fy-0.001,dev.z+hh-gm)},${sY(dev.x-hw+gm,fy-0.001,dev.z+hh-gm)}`,`${sX(dev.x+hw-gm,fy-0.001,dev.z+hh-gm)},${sY(dev.x+hw-gm,fy-0.001,dev.z+hh-gm)}`,`${sX(dev.x+hw-gm,fy-0.001,dev.z-hh+gm)},${sY(dev.x+hw-gm,fy-0.001,dev.z-hh+gm)}`,`${sX(dev.x-hw+gm,fy-0.001,dev.z-hh+gm)},${sY(dev.x-hw+gm,fy-0.001,dev.z-hh+gm)}`].join(" ");
                      lx2=sX(dev.x,fy,dev.z); ly2=sY(dev.x,fy,dev.z);
                    } else if(mw==="west"){
                      const wx=0.02, fx=wx+depth;
                      frontPts=[`${sX(fx,dev.y-hw,dev.z+hh)},${sY(fx,dev.y-hw,dev.z+hh)}`,`${sX(fx,dev.y+hw,dev.z+hh)},${sY(fx,dev.y+hw,dev.z+hh)}`,`${sX(fx,dev.y+hw,dev.z-hh)},${sY(fx,dev.y+hw,dev.z-hh)}`,`${sX(fx,dev.y-hw,dev.z-hh)},${sY(fx,dev.y-hw,dev.z-hh)}`].join(" ");
                      topPts=[`${sX(wx,dev.y-hw,dev.z+hh)},${sY(wx,dev.y-hw,dev.z+hh)}`,`${sX(fx,dev.y-hw,dev.z+hh)},${sY(fx,dev.y-hw,dev.z+hh)}`,`${sX(fx,dev.y+hw,dev.z+hh)},${sY(fx,dev.y+hw,dev.z+hh)}`,`${sX(wx,dev.y+hw,dev.z+hh)},${sY(wx,dev.y+hw,dev.z+hh)}`].join(" ");
                      sidePts=[`${sX(wx,dev.y+hw,dev.z+hh)},${sY(wx,dev.y+hw,dev.z+hh)}`,`${sX(fx,dev.y+hw,dev.z+hh)},${sY(fx,dev.y+hw,dev.z+hh)}`,`${sX(fx,dev.y+hw,dev.z-hh)},${sY(fx,dev.y+hw,dev.z-hh)}`,`${sX(wx,dev.y+hw,dev.z-hh)},${sY(wx,dev.y+hw,dev.z-hh)}`].join(" ");
                      const gm=0.02; grillePts=[`${sX(fx+0.001,dev.y-hw+gm,dev.z+hh-gm)},${sY(fx+0.001,dev.y-hw+gm,dev.z+hh-gm)}`,`${sX(fx+0.001,dev.y+hw-gm,dev.z+hh-gm)},${sY(fx+0.001,dev.y+hw-gm,dev.z+hh-gm)}`,`${sX(fx+0.001,dev.y+hw-gm,dev.z-hh+gm)},${sY(fx+0.001,dev.y+hw-gm,dev.z-hh+gm)}`,`${sX(fx+0.001,dev.y-hw+gm,dev.z-hh+gm)},${sY(fx+0.001,dev.y-hw+gm,dev.z-hh+gm)}`].join(" ");
                      lx2=sX(fx,dev.y,dev.z); ly2=sY(fx,dev.y,dev.z);
                    } else {
                      const wx=roomW-0.02, fx=wx-depth;
                      frontPts=[`${sX(fx,dev.y-hw,dev.z+hh)},${sY(fx,dev.y-hw,dev.z+hh)}`,`${sX(fx,dev.y+hw,dev.z+hh)},${sY(fx,dev.y+hw,dev.z+hh)}`,`${sX(fx,dev.y+hw,dev.z-hh)},${sY(fx,dev.y+hw,dev.z-hh)}`,`${sX(fx,dev.y-hw,dev.z-hh)},${sY(fx,dev.y-hw,dev.z-hh)}`].join(" ");
                      topPts=[`${sX(wx,dev.y-hw,dev.z+hh)},${sY(wx,dev.y-hw,dev.z+hh)}`,`${sX(fx,dev.y-hw,dev.z+hh)},${sY(fx,dev.y-hw,dev.z+hh)}`,`${sX(fx,dev.y+hw,dev.z+hh)},${sY(fx,dev.y+hw,dev.z+hh)}`,`${sX(wx,dev.y+hw,dev.z+hh)},${sY(wx,dev.y+hw,dev.z+hh)}`].join(" ");
                      sidePts=[`${sX(wx,dev.y-hw,dev.z+hh)},${sY(wx,dev.y-hw,dev.z+hh)}`,`${sX(fx,dev.y-hw,dev.z+hh)},${sY(fx,dev.y-hw,dev.z+hh)}`,`${sX(fx,dev.y-hw,dev.z-hh)},${sY(fx,dev.y-hw,dev.z-hh)}`,`${sX(wx,dev.y-hw,dev.z-hh)},${sY(wx,dev.y-hw,dev.z-hh)}`].join(" ");
                      const gm=0.02; grillePts=[`${sX(fx-0.001,dev.y-hw+gm,dev.z+hh-gm)},${sY(fx-0.001,dev.y-hw+gm,dev.z+hh-gm)}`,`${sX(fx-0.001,dev.y+hw-gm,dev.z+hh-gm)},${sY(fx-0.001,dev.y+hw-gm,dev.z+hh-gm)}`,`${sX(fx-0.001,dev.y+hw-gm,dev.z-hh+gm)},${sY(fx-0.001,dev.y+hw-gm,dev.z-hh+gm)}`,`${sX(fx-0.001,dev.y-hw+gm,dev.z-hh+gm)},${sY(fx-0.001,dev.y-hw+gm,dev.z-hh+gm)}`].join(" ");
                      lx2=sX(fx,dev.y,dev.z); ly2=sY(fx,dev.y,dev.z);
                    }
                    return wrapDevice(<g>
                      {/* Front face - dark with grille */}
                      <polygon points={frontPts} fill={cc.device} stroke={cc.deviceBorderLight} strokeWidth={0.6}/>
                      {/* Grille inset */}
                      <polygon points={grillePts} fill={cc.deviceDeep} stroke="rgb(var(--border))" strokeWidth={0.3}/>
                      {/* Top face */}
                      <polygon points={topPts} fill="rgb(var(--border))" stroke={cc.deviceBorderLight} strokeWidth={0.5}/>
                      {/* Side face */}
                      <polygon points={sidePts} fill="#151d2b" stroke={cc.deviceBorderLight} strokeWidth={0.5}/>
                      <text x={lx2} y={ly2+18} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                    </g>);
                  }
                  const isoCircS=(r:number,z:number,n:number)=>Array.from({length:n},(_,i)=>{const a=(i/n)*Math.PI*2;return `${sX(dev.x+r*Math.cos(a),dev.y+r*Math.sin(a),z)},${sY(dev.x+r*Math.cos(a),dev.y+r*Math.sin(a),z)}`;}).join(" ");
                  const spx=sX(dev.x,dev.y,roomH), spy=sY(dev.x,dev.y,roomH);
                  const sfpx=sX(dev.x,dev.y,0), sfpy=sY(dev.x,dev.y,0);
                  const spkDispDeg=dev.dispersion||90;
                  const spkH=roomH-4;
                  const spkEpr=2*spkH*Math.tan((spkDispDeg/2)*Math.PI/180);
                  const spkEprR=spkEpr/2;
                  return wrapDevice(<g>
                    {/* Coverage cone */}
                    <line x1={spx} y1={spy} x2={sfpx} y2={sfpy} stroke={dev.color} strokeWidth={0.5} strokeDasharray="3 2" opacity={0.15}/>
                    <polygon points={Array.from({length:24},(_,i)=>{const a=(i/24)*Math.PI*2;return `${sX(dev.x+spkEprR*Math.cos(a),dev.y+spkEprR*Math.sin(a),0)},${sY(dev.x+spkEprR*Math.cos(a),dev.y+spkEprR*Math.sin(a),0)}`;}).join(" ")} fill={dev.color} opacity={0.04} stroke={dev.color} strokeWidth={0.5} strokeDasharray="2 2"/>
                    {/* Outer rim - flush mount ring */}
                    <polygon points={isoCircS(0.18,roomH,24)} fill={cc.device} stroke={dev.color+"88"} strokeWidth={0.8}/>
                    {/* Grille rings */}
                    <polygon points={isoCircS(0.14,roomH+0.001,20)} fill="none" stroke={cc.deviceBorderLight} strokeWidth={0.4}/>
                    <polygon points={isoCircS(0.10,roomH+0.001,16)} fill="none" stroke={cc.deviceBorderLight} strokeWidth={0.4}/>
                    {/* Center cone */}
                    <polygon points={isoCircS(0.05,roomH+0.002,12)} fill="#334155" stroke="#475569" strokeWidth={0.3}/>
                    <text x={cpx} y={cpy-12} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                  </g>);
                }
                if(dev.type==="furniture"){
                  const hw2=dev.w/2, hh2=dev.h/2;
                  const ftopPts=[`${sX(dev.x-hw2,dev.y-hh2,tH)},${sY(dev.x-hw2,dev.y-hh2,tH)}`,`${sX(dev.x+hw2,dev.y-hh2,tH)},${sY(dev.x+hw2,dev.y-hh2,tH)}`,`${sX(dev.x+hw2,dev.y+hh2,tH)},${sY(dev.x+hw2,dev.y+hh2,tH)}`,`${sX(dev.x-hw2,dev.y+hh2,tH)},${sY(dev.x-hw2,dev.y+hh2,tH)}`].join(" ");
                  const ffrontPts=[`${sX(dev.x-hw2,dev.y+hh2,0)},${sY(dev.x-hw2,dev.y+hh2,0)}`,`${sX(dev.x+hw2,dev.y+hh2,0)},${sY(dev.x+hw2,dev.y+hh2,0)}`,`${sX(dev.x+hw2,dev.y+hh2,tH)},${sY(dev.x+hw2,dev.y+hh2,tH)}`,`${sX(dev.x-hw2,dev.y+hh2,tH)},${sY(dev.x-hw2,dev.y+hh2,tH)}`].join(" ");
                  const frightPts=[`${sX(dev.x+hw2,dev.y-hh2,0)},${sY(dev.x+hw2,dev.y-hh2,0)}`,`${sX(dev.x+hw2,dev.y+hh2,0)},${sY(dev.x+hw2,dev.y+hh2,0)}`,`${sX(dev.x+hw2,dev.y+hh2,tH)},${sY(dev.x+hw2,dev.y+hh2,tH)}`,`${sX(dev.x+hw2,dev.y-hh2,tH)},${sY(dev.x+hw2,dev.y-hh2,tH)}`].join(" ");
                  const lx=sX(dev.x,dev.y,tH), ly=sY(dev.x,dev.y,tH);
                  return wrapDevice(<g><polygon points={ffrontPts} fill="#475569" opacity={0.2} stroke="rgb(var(--text-subtle))" strokeWidth={0.5}/><polygon points={frightPts} fill="#334155" opacity={0.2} stroke="rgb(var(--text-subtle))" strokeWidth={0.5}/><polygon points={ftopPts} fill="#334155" opacity={0.35} stroke="rgb(var(--text-muted))" strokeWidth={0.8}/><text x={lx} y={ly+3} textAnchor="middle" fontSize={7} fill="rgb(var(--text-muted))" fontWeight={500} className="dev-label">{dev.name}</text></g>);
                }
                if(dev.type==="control"){
                  const mw=dev.mountWall||"floor";
                  if(mw==="north"||mw==="south"||mw==="west"||mw==="east"){
                    const hw2=dev.w/2, hh2=dev.h/2;
                    const isPanel=dev.id==="touch-panel";
                    const bezelW=isPanel?0.008:0; // thin bezel for TSW-1070
                    let outerPts:string, screenPts:string, lx2:number, ly2:number;
                    if(mw==="north"){
                      outerPts=[`${sX(dev.x-hw2,0.02,dev.z+hh2)},${sY(dev.x-hw2,0.02,dev.z+hh2)}`,`${sX(dev.x+hw2,0.02,dev.z+hh2)},${sY(dev.x+hw2,0.02,dev.z+hh2)}`,`${sX(dev.x+hw2,0.02,dev.z-hh2)},${sY(dev.x+hw2,0.02,dev.z-hh2)}`,`${sX(dev.x-hw2,0.02,dev.z-hh2)},${sY(dev.x-hw2,0.02,dev.z-hh2)}`].join(" ");
                      screenPts=[`${sX(dev.x-hw2+bezelW,0.02,dev.z+hh2-bezelW)},${sY(dev.x-hw2+bezelW,0.02,dev.z+hh2-bezelW)}`,`${sX(dev.x+hw2-bezelW,0.02,dev.z+hh2-bezelW)},${sY(dev.x+hw2-bezelW,0.02,dev.z+hh2-bezelW)}`,`${sX(dev.x+hw2-bezelW,0.02,dev.z-hh2+bezelW)},${sY(dev.x+hw2-bezelW,0.02,dev.z-hh2+bezelW)}`,`${sX(dev.x-hw2+bezelW,0.02,dev.z-hh2+bezelW)},${sY(dev.x-hw2+bezelW,0.02,dev.z-hh2+bezelW)}`].join(" ");
                      lx2=sX(dev.x,0.02,dev.z);ly2=sY(dev.x,0.02,dev.z);
                    } else if(mw==="south"){
                      outerPts=[`${sX(dev.x-hw2,roomL-0.02,dev.z+hh2)},${sY(dev.x-hw2,roomL-0.02,dev.z+hh2)}`,`${sX(dev.x+hw2,roomL-0.02,dev.z+hh2)},${sY(dev.x+hw2,roomL-0.02,dev.z+hh2)}`,`${sX(dev.x+hw2,roomL-0.02,dev.z-hh2)},${sY(dev.x+hw2,roomL-0.02,dev.z-hh2)}`,`${sX(dev.x-hw2,roomL-0.02,dev.z-hh2)},${sY(dev.x-hw2,roomL-0.02,dev.z-hh2)}`].join(" ");
                      screenPts=[`${sX(dev.x-hw2+bezelW,roomL-0.02,dev.z+hh2-bezelW)},${sY(dev.x-hw2+bezelW,roomL-0.02,dev.z+hh2-bezelW)}`,`${sX(dev.x+hw2-bezelW,roomL-0.02,dev.z+hh2-bezelW)},${sY(dev.x+hw2-bezelW,roomL-0.02,dev.z+hh2-bezelW)}`,`${sX(dev.x+hw2-bezelW,roomL-0.02,dev.z-hh2+bezelW)},${sY(dev.x+hw2-bezelW,roomL-0.02,dev.z-hh2+bezelW)}`,`${sX(dev.x-hw2+bezelW,roomL-0.02,dev.z-hh2+bezelW)},${sY(dev.x-hw2+bezelW,roomL-0.02,dev.z-hh2+bezelW)}`].join(" ");
                      lx2=sX(dev.x,roomL-0.02,dev.z);ly2=sY(dev.x,roomL-0.02,dev.z);
                    } else if(mw==="west"){
                      outerPts=[`${sX(0.02,dev.y-hw2,dev.z+hh2)},${sY(0.02,dev.y-hw2,dev.z+hh2)}`,`${sX(0.02,dev.y+hw2,dev.z+hh2)},${sY(0.02,dev.y+hw2,dev.z+hh2)}`,`${sX(0.02,dev.y+hw2,dev.z-hh2)},${sY(0.02,dev.y+hw2,dev.z-hh2)}`,`${sX(0.02,dev.y-hw2,dev.z-hh2)},${sY(0.02,dev.y-hw2,dev.z-hh2)}`].join(" ");
                      screenPts=[`${sX(0.02,dev.y-hw2+bezelW,dev.z+hh2-bezelW)},${sY(0.02,dev.y-hw2+bezelW,dev.z+hh2-bezelW)}`,`${sX(0.02,dev.y+hw2-bezelW,dev.z+hh2-bezelW)},${sY(0.02,dev.y+hw2-bezelW,dev.z+hh2-bezelW)}`,`${sX(0.02,dev.y+hw2-bezelW,dev.z-hh2+bezelW)},${sY(0.02,dev.y+hw2-bezelW,dev.z-hh2+bezelW)}`,`${sX(0.02,dev.y-hw2+bezelW,dev.z-hh2+bezelW)},${sY(0.02,dev.y-hw2+bezelW,dev.z-hh2+bezelW)}`].join(" ");
                      lx2=sX(0.02,dev.y,dev.z);ly2=sY(0.02,dev.y,dev.z);
                    } else {
                      outerPts=[`${sX(roomW-0.02,dev.y-hw2,dev.z+hh2)},${sY(roomW-0.02,dev.y-hw2,dev.z+hh2)}`,`${sX(roomW-0.02,dev.y+hw2,dev.z+hh2)},${sY(roomW-0.02,dev.y+hw2,dev.z+hh2)}`,`${sX(roomW-0.02,dev.y+hw2,dev.z-hh2)},${sY(roomW-0.02,dev.y+hw2,dev.z-hh2)}`,`${sX(roomW-0.02,dev.y-hw2,dev.z-hh2)},${sY(roomW-0.02,dev.y-hw2,dev.z-hh2)}`].join(" ");
                      screenPts=[`${sX(roomW-0.02,dev.y-hw2+bezelW,dev.z+hh2-bezelW)},${sY(roomW-0.02,dev.y-hw2+bezelW,dev.z+hh2-bezelW)}`,`${sX(roomW-0.02,dev.y+hw2-bezelW,dev.z+hh2-bezelW)},${sY(roomW-0.02,dev.y+hw2-bezelW,dev.z+hh2-bezelW)}`,`${sX(roomW-0.02,dev.y+hw2-bezelW,dev.z-hh2+bezelW)},${sY(roomW-0.02,dev.y+hw2-bezelW,dev.z-hh2+bezelW)}`,`${sX(roomW-0.02,dev.y-hw2+bezelW,dev.z-hh2+bezelW)},${sY(roomW-0.02,dev.y-hw2+bezelW,dev.z-hh2+bezelW)}`].join(" ");
                      lx2=sX(roomW-0.02,dev.y,dev.z);ly2=sY(roomW-0.02,dev.y,dev.z);
                    }
                    if(isPanel){
                      return wrapDevice(<g>
                        {/* Bezel - black glass frame */}
                        <polygon points={outerPts} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={1}/>
                        {/* Screen - dark with subtle tint */}
                        <polygon points={screenPts} fill="#070b14" stroke="#111827" strokeWidth={0.3}/>
                        {/* Screen reflection */}
                        <polygon points={screenPts} fill="url(#screenGrad)" opacity={0.06}/>
                        <text x={lx2} y={ly2+16} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                      </g>);
                    }
                    return wrapDevice(<g><polygon points={outerPts} fill={dev.color+"22"} stroke={dev.color} strokeWidth={1.2}/><text x={lx2} y={ly2+16} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text></g>);
                  }
                  const cpx=sX(dev.x,dev.y,dev.z), cpy=sY(dev.x,dev.y,dev.z);
                  // Logitech Tap style - wedge base with angled screen
                  if(dev.id==="table-touch"){
                    const tw=dev.w/2, td=dev.h/2, baseH=0.02, screenH=0.06;
                    // Base footprint on table
                    const basePts=[
                      `${sX(dev.x-tw,dev.y-td,dev.z)},${sY(dev.x-tw,dev.y-td,dev.z)}`,
                      `${sX(dev.x+tw,dev.y-td,dev.z)},${sY(dev.x+tw,dev.y-td,dev.z)}`,
                      `${sX(dev.x+tw,dev.y+td,dev.z)},${sY(dev.x+tw,dev.y+td,dev.z)}`,
                      `${sX(dev.x-tw,dev.y+td,dev.z)},${sY(dev.x-tw,dev.y+td,dev.z)}`
                    ].join(" ");
                    // Top surface (angled - front higher than back)
                    const topPts=[
                      `${sX(dev.x-tw,dev.y-td,dev.z+screenH)},${sY(dev.x-tw,dev.y-td,dev.z+screenH)}`,
                      `${sX(dev.x+tw,dev.y-td,dev.z+screenH)},${sY(dev.x+tw,dev.y-td,dev.z+screenH)}`,
                      `${sX(dev.x+tw,dev.y+td,dev.z+baseH)},${sY(dev.x+tw,dev.y+td,dev.z+baseH)}`,
                      `${sX(dev.x-tw,dev.y+td,dev.z+baseH)},${sY(dev.x-tw,dev.y+td,dev.z+baseH)}`
                    ].join(" ");
                    // Screen inset
                    const si=0.01;
                    const scrPts=[
                      `${sX(dev.x-tw+si,dev.y-td+si,dev.z+screenH-0.002)},${sY(dev.x-tw+si,dev.y-td+si,dev.z+screenH-0.002)}`,
                      `${sX(dev.x+tw-si,dev.y-td+si,dev.z+screenH-0.002)},${sY(dev.x+tw-si,dev.y-td+si,dev.z+screenH-0.002)}`,
                      `${sX(dev.x+tw-si,dev.y+td-si,dev.z+baseH+0.002)},${sY(dev.x+tw-si,dev.y+td-si,dev.z+baseH+0.002)}`,
                      `${sX(dev.x-tw+si,dev.y+td-si,dev.z+baseH+0.002)},${sY(dev.x-tw+si,dev.y+td-si,dev.z+baseH+0.002)}`
                    ].join(" ");
                    // Front face (the taller edge)
                    const frontPts=[
                      `${sX(dev.x-tw,dev.y-td,dev.z)},${sY(dev.x-tw,dev.y-td,dev.z)}`,
                      `${sX(dev.x+tw,dev.y-td,dev.z)},${sY(dev.x+tw,dev.y-td,dev.z)}`,
                      `${sX(dev.x+tw,dev.y-td,dev.z+screenH)},${sY(dev.x+tw,dev.y-td,dev.z+screenH)}`,
                      `${sX(dev.x-tw,dev.y-td,dev.z+screenH)},${sY(dev.x-tw,dev.y-td,dev.z+screenH)}`
                    ].join(" ");
                    // Right side
                    const rightPts=[
                      `${sX(dev.x+tw,dev.y-td,dev.z)},${sY(dev.x+tw,dev.y-td,dev.z)}`,
                      `${sX(dev.x+tw,dev.y+td,dev.z)},${sY(dev.x+tw,dev.y+td,dev.z)}`,
                      `${sX(dev.x+tw,dev.y+td,dev.z+baseH)},${sY(dev.x+tw,dev.y+td,dev.z+baseH)}`,
                      `${sX(dev.x+tw,dev.y-td,dev.z+screenH)},${sY(dev.x+tw,dev.y-td,dev.z+screenH)}`
                    ].join(" ");
                    const lx=sX(dev.x,dev.y,dev.z+screenH), ly=sY(dev.x,dev.y,dev.z+screenH);
                    return wrapDevice(<g>
                      {/* Front face */}
                      <polygon points={frontPts} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={0.5}/>
                      {/* Right side */}
                      <polygon points={rightPts} fill="#0f1724" stroke={cc.deviceBorder} strokeWidth={0.5}/>
                      {/* Top/screen surface */}
                      <polygon points={topPts} fill={cc.device} stroke={cc.deviceBorder} strokeWidth={0.6}/>
                      {/* Screen */}
                      <polygon points={scrPts} fill="#070b14" stroke="#111827" strokeWidth={0.3}/>
                      <polygon points={scrPts} fill="url(#screenGrad)" opacity={0.05}/>
                      <text x={lx} y={ly-8} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                    </g>);
                  }
                  // Cable Cubby - Extron 1202 flush-mount in table
                  if(dev.id==="byod-hub"){
                    const cw=dev.w/2, cd=dev.h/2, cDepth=0.06;
                    // Frame sits flush with table, cavity is recessed
                    const framePts=[
                      `${sX(dev.x-cw,dev.y-cd,dev.z)},${sY(dev.x-cw,dev.y-cd,dev.z)}`,
                      `${sX(dev.x+cw,dev.y-cd,dev.z)},${sY(dev.x+cw,dev.y-cd,dev.z)}`,
                      `${sX(dev.x+cw,dev.y+cd,dev.z)},${sY(dev.x+cw,dev.y+cd,dev.z)}`,
                      `${sX(dev.x-cw,dev.y+cd,dev.z)},${sY(dev.x-cw,dev.y+cd,dev.z)}`
                    ].join(" ");
                    // Inner cavity (recessed)
                    const ci=0.015;
                    const cavityPts=[
                      `${sX(dev.x-cw+ci,dev.y-cd+ci,dev.z-cDepth)},${sY(dev.x-cw+ci,dev.y-cd+ci,dev.z-cDepth)}`,
                      `${sX(dev.x+cw-ci,dev.y-cd+ci,dev.z-cDepth)},${sY(dev.x+cw-ci,dev.y-cd+ci,dev.z-cDepth)}`,
                      `${sX(dev.x+cw-ci,dev.y+cd-ci,dev.z-cDepth)},${sY(dev.x+cw-ci,dev.y+cd-ci,dev.z-cDepth)}`,
                      `${sX(dev.x-cw+ci,dev.y+cd-ci,dev.z-cDepth)},${sY(dev.x-cw+ci,dev.y+cd-ci,dev.z-cDepth)}`
                    ].join(" ");
                    // Inner wall (front)
                    const innerFrontPts=[
                      `${sX(dev.x-cw+ci,dev.y+cd-ci,dev.z)},${sY(dev.x-cw+ci,dev.y+cd-ci,dev.z)}`,
                      `${sX(dev.x+cw-ci,dev.y+cd-ci,dev.z)},${sY(dev.x+cw-ci,dev.y+cd-ci,dev.z)}`,
                      `${sX(dev.x+cw-ci,dev.y+cd-ci,dev.z-cDepth)},${sY(dev.x+cw-ci,dev.y+cd-ci,dev.z-cDepth)}`,
                      `${sX(dev.x-cw+ci,dev.y+cd-ci,dev.z-cDepth)},${sY(dev.x-cw+ci,dev.y+cd-ci,dev.z-cDepth)}`
                    ].join(" ");
                    // Inner wall (right)
                    const innerRightPts=[
                      `${sX(dev.x+cw-ci,dev.y-cd+ci,dev.z)},${sY(dev.x+cw-ci,dev.y-cd+ci,dev.z)}`,
                      `${sX(dev.x+cw-ci,dev.y+cd-ci,dev.z)},${sY(dev.x+cw-ci,dev.y+cd-ci,dev.z)}`,
                      `${sX(dev.x+cw-ci,dev.y+cd-ci,dev.z-cDepth)},${sY(dev.x+cw-ci,dev.y+cd-ci,dev.z-cDepth)}`,
                      `${sX(dev.x+cw-ci,dev.y-cd+ci,dev.z-cDepth)},${sY(dev.x+cw-ci,dev.y-cd+ci,dev.z-cDepth)}`
                    ].join(" ");
                    const lx=sX(dev.x,dev.y,dev.z), ly=sY(dev.x,dev.y,dev.z);
                    return wrapDevice(<g>
                      {/* Metal frame - flush with table */}
                      <polygon points={framePts} fill="#4b5563" stroke="#6b7280" strokeWidth={0.6}/>
                      {/* Inner walls */}
                      <polygon points={innerFrontPts} fill="rgb(var(--border))" stroke={cc.deviceBorderLight} strokeWidth={0.3}/>
                      <polygon points={innerRightPts} fill="#151d2b" stroke={cc.deviceBorderLight} strokeWidth={0.3}/>
                      {/* Cavity bottom */}
                      <polygon points={cavityPts} fill={cc.deviceDeep} stroke="rgb(var(--border))" strokeWidth={0.3}/>
                      <text x={lx} y={ly-12} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text>
                    </g>);
                  }
                  return wrapDevice(<g><rect x={cpx-8} y={cpy-5} width={16} height={10} rx={2} fill={dev.color+"33"} stroke={dev.color} strokeWidth={1} transform={`skewX(-15) translate(${cpx*0.04},0)`}/><text x={cpx} y={cpy+16} textAnchor="middle" fontSize={6} fill={dev.color} className="dev-label">{dev.name}</text></g>);
                }
                return null;
              })}

              {placedDevices.length===0&&(
                <text x="300" y="410" textAnchor="middle" fontSize={10} fill="#334155" fontFamily="Inter,sans-serif">Click devices from the catalog to place them in the room</text>
              )}
            </g>
          )}
          {/* Annotations layer — drawn above the plan content */}
          {viewMode==="plan" && annotate.layer}
        </svg>
        {/* Annotation tool options (shape/stroke/color/eraser size) */}
        {annotate.optionsBar && (
          <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:30}}>{annotate.optionsBar}</div>
        )}

        {/* AutoCAD-style length input — appears at cursor when drawing walls */}
        {isDrawingWall && wallPoints.length > 0 && cursorScreenPos && (
          <div style={{position:"absolute",left:cursorScreenPos.x+18,top:cursorScreenPos.y+14,zIndex:50,pointerEvents:"none"}}>
            <div style={{pointerEvents:"auto",background:cc.panel,border:"1.5px solid #8b5cf6",borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:6,boxShadow:"0 2px 12px rgba(0,0,0,0.3)"}}>
              <span style={{fontSize:10,color:"#8b5cf6",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>L</span>
              <input
                ref={wallInputRef}
                value={wallLengthInput}
                onChange={e => setWallLengthInput(e.target.value)}
                onKeyDown={handleWallInputKeyDown}
                placeholder="10' or 12'6&quot;"
                style={{background:"transparent",border:"none",outline:"none",fontSize:13,fontFamily:"'JetBrains Mono',monospace",width:110,color:"rgb(var(--text-body))"}}
              />
            </div>
            <div style={{marginTop:3,fontSize:9,color:"rgb(var(--text-subtle))",paddingLeft:2}}>Enter to place · Esc to cancel</div>
          </div>
        )}

        {/* 3D/Plan toggle — hidden for now, keeping code for later use */}
        {false && <div style={{position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",display:"flex",background:"rgba(10,15,26,0.9)",borderRadius:6,border:"1px solid rgb(var(--border))",overflow:"hidden"}}>
          <button onClick={()=>setViewMode("3d")} style={{padding:"8px 20px",fontSize:14,fontWeight:viewMode==="3d"?700:400,background:viewMode==="3d"?"rgba(139,92,246,0.2)":"transparent",border:"none",color:viewMode==="3d"?"#a78bfa":"rgb(var(--text-subtle))",cursor:"pointer",borderRight:"1px solid rgb(var(--border))"}}>3D View</button>
          <button onClick={()=>setViewMode("plan")} style={{padding:"8px 20px",fontSize:14,fontWeight:viewMode==="plan"?700:400,background:viewMode==="plan"?"rgba(139,92,246,0.2)":"transparent",border:"none",color:viewMode==="plan"?"#a78bfa":"rgb(var(--text-subtle))",cursor:"pointer"}}>Plan View</button>
        </div>}
        <div className="rd-print-hide" style={{position:"absolute",bottom:10,left:10,display:"flex",gap:12,fontSize:10,color:"#475569"}}>
          <span>Click catalog items to add</span>
          <span>Drag devices to reposition</span>
          <span>Click to select, × to remove</span>
        </div>
        {/* Zoom controls */}
        {zoomCluster("plan")}

        {/* Furniture item size editor */}
        {showFurnitureEditor && (
          <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:cc.panel,border:"1px solid rgb(var(--border))",borderRadius:10,padding:"18px 20px",zIndex:50,minWidth:220,boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}>
            <div style={{fontSize:13,fontWeight:600,color:"rgb(var(--text-body))",marginBottom:14}}>Edit Size</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,fontSize:12,color:"rgb(var(--text-subtle))"}}>
                Width (ft)
                <input
                  type="number" step="0.1" min="0.5" max="30"
                  value={furnitureEditW}
                  onChange={e => setFurnitureEditW(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { const w=parseFloat(furnitureEditW),l=parseFloat(furnitureEditL); pushUndo(); setPlacedDevices(prev=>prev.map(d=>d.uid===furnitureEditUid?{...d,w:!isNaN(w)&&w>0?Math.max(0.5,Math.min(30,w)):d.w,h:!isNaN(l)&&l>0?Math.max(0.5,Math.min(30,l)):d.h}:d)); setShowFurnitureEditor(false); } if (e.key === "Escape") setShowFurnitureEditor(false); }}
                  autoFocus
                  style={{width:80,background:"rgb(var(--forge-surface) / 0.6)",border:"1px solid rgb(var(--border))",borderRadius:5,padding:"5px 8px",fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))",fontSize:12,outline:"none",textAlign:"right"}}
                  onFocus={e=>e.target.style.borderColor="#8b5cf6"}
                  onBlur={e=>e.target.style.borderColor="rgb(var(--border))"}
                />
              </label>
              <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,fontSize:12,color:"rgb(var(--text-subtle))"}}>
                Length (ft)
                <input
                  type="number" step="0.1" min="0.5" max="30"
                  value={furnitureEditL}
                  onChange={e => setFurnitureEditL(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { const w=parseFloat(furnitureEditW),l=parseFloat(furnitureEditL); pushUndo(); setPlacedDevices(prev=>prev.map(d=>d.uid===furnitureEditUid?{...d,w:!isNaN(w)&&w>0?Math.max(0.5,Math.min(30,w)):d.w,h:!isNaN(l)&&l>0?Math.max(0.5,Math.min(30,l)):d.h}:d)); setShowFurnitureEditor(false); } if (e.key === "Escape") setShowFurnitureEditor(false); }}
                  style={{width:80,background:"rgb(var(--forge-surface) / 0.6)",border:"1px solid rgb(var(--border))",borderRadius:5,padding:"5px 8px",fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))",fontSize:12,outline:"none",textAlign:"right"}}
                  onFocus={e=>e.target.style.borderColor="#8b5cf6"}
                  onBlur={e=>e.target.style.borderColor="rgb(var(--border))"}
                />
              </label>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button onClick={() => setShowFurnitureEditor(false)} style={{padding:"6px 14px",borderRadius:5,fontSize:12,background:"none",border:"1px solid rgb(var(--border))",color:"rgb(var(--text-subtle))",cursor:"pointer"}}>Cancel</button>
              <button onClick={() => { const w=parseFloat(furnitureEditW),l=parseFloat(furnitureEditL); pushUndo(); setPlacedDevices(prev=>prev.map(d=>d.uid===furnitureEditUid?{...d,w:!isNaN(w)&&w>0?Math.max(0.5,Math.min(30,w)):d.w,h:!isNaN(l)&&l>0?Math.max(0.5,Math.min(30,l)):d.h}:d)); setShowFurnitureEditor(false); }} style={{padding:"6px 14px",borderRadius:5,fontSize:12,fontWeight:600,background:"#8b5cf6",border:"none",color:"#fff",cursor:"pointer"}}>Apply</button>
            </div>
          </div>
        )}

        {/* Table size editor popover */}
        {showTableSizeEditor && (
          <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:cc.panel,border:"1px solid rgb(var(--border))",borderRadius:10,padding:"18px 20px",zIndex:50,minWidth:220,boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}>
            <div style={{fontSize:13,fontWeight:600,color:"rgb(var(--text-body))",marginBottom:14}}>Table Dimensions</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,fontSize:12,color:"rgb(var(--text-subtle))"}}>
                Width (ft)
                <input
                  type="number" step="0.1" min="0.5" max="20"
                  value={tableEditW}
                  onChange={e => setTableEditW(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { const w=parseFloat(tableEditW),l=parseFloat(tableEditL); pushUndo(); if(!isNaN(w)&&w>0) setTableWidth(Math.max(0.5,Math.min(20,w))); if(!isNaN(l)&&l>0) setTableLengthOverride(Math.max(0.5,Math.min(30,l))); setShowTableSizeEditor(false); } if (e.key === "Escape") setShowTableSizeEditor(false); }}
                  autoFocus
                  style={{width:80,background:"rgb(var(--forge-surface) / 0.6)",border:"1px solid rgb(var(--border))",borderRadius:5,padding:"5px 8px",fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))",fontSize:12,outline:"none",textAlign:"right"}}
                  onFocus={e=>e.target.style.borderColor="#8b5cf6"}
                  onBlur={e=>e.target.style.borderColor="rgb(var(--border))"}
                />
              </label>
              <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,fontSize:12,color:"rgb(var(--text-subtle))"}}>
                Length (ft)
                <input
                  type="number" step="0.1" min="0.5" max="30"
                  value={tableEditL}
                  onChange={e => setTableEditL(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { const w=parseFloat(tableEditW),l=parseFloat(tableEditL); pushUndo(); if(!isNaN(w)&&w>0) setTableWidth(Math.max(0.5,Math.min(20,w))); if(!isNaN(l)&&l>0) setTableLengthOverride(Math.max(0.5,Math.min(30,l))); setShowTableSizeEditor(false); } if (e.key === "Escape") setShowTableSizeEditor(false); }}
                  style={{width:80,background:"rgb(var(--forge-surface) / 0.6)",border:"1px solid rgb(var(--border))",borderRadius:5,padding:"5px 8px",fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))",fontSize:12,outline:"none",textAlign:"right"}}
                  onFocus={e=>e.target.style.borderColor="#8b5cf6"}
                  onBlur={e=>e.target.style.borderColor="rgb(var(--border))"}
                />
              </label>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button onClick={() => setShowTableSizeEditor(false)} style={{padding:"6px 14px",borderRadius:5,fontSize:12,background:"none",border:"1px solid rgb(var(--border))",color:"rgb(var(--text-subtle))",cursor:"pointer"}}>Cancel</button>
              <button onClick={() => { const w=parseFloat(tableEditW),l=parseFloat(tableEditL); pushUndo(); if(!isNaN(w)&&w>0) setTableWidth(Math.max(0.5,Math.min(20,w))); if(!isNaN(l)&&l>0) setTableLengthOverride(Math.max(0.5,Math.min(30,l))); setShowTableSizeEditor(false); }} style={{padding:"6px 14px",borderRadius:5,fontSize:12,fontWeight:600,background:"#8b5cf6",border:"none",color:"#fff",cursor:"pointer"}}>Apply</button>
            </div>
          </div>
        )}
      </div>
      </div>{/* end Floor Plan half */}

      {/* Divider — drag to resize Floor Plan vs Ceiling Plan */}
      <div
        onMouseDown={e=>{e.preventDefault();setIsDraggingSplit(true);}}
        onDoubleClick={()=>setFloorCeilSplit(0.5)}
        title="Drag to resize — double-click to reset to 50/50"
        style={{width:8,flexShrink:0,cursor:"col-resize",background:isDraggingSplit?"#8b5cf6":"rgb(var(--border))",display:"flex",alignItems:"center",justifyContent:"center",transition:isDraggingSplit?"none":"background 0.15s"}}
      >
        <div style={{width:3,height:32,borderRadius:2,background:isDraggingSplit?"#fff":"rgb(var(--text-subtle))"}}/>
      </div>

      {/* Ceiling Plan half */}
      <div style={{width:`${(1-floorCeilSplit)*100}%`,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,background:cc.card,overflow:"hidden"}}>
        <svg ref={ceilSvgRef} data-rd-canvas="ceil" onDragOver={acceptBomUnit} onDrop={e=>dropBomUnit(e,"ceil")} width="100%" height="100%" viewBox={`${300-300/ceilZoom-ceilPan.x} ${210-210/ceilZoom-ceilPan.y} ${600/ceilZoom} ${420/ceilZoom}`}
          style={{background:cc.card,cursor:annotate.activeTool?(annotate.cursor||"crosshair"):isCeilPanning?"grabbing":ceilDragUid?"grabbing":panMode?"grab":"default"}}
          onMouseMove={e=>{
            if(annotate.activeTool||annotate.isDragging()){annotate.handleMove(e);return;}
            if(calloutDragUid){handleCalloutMouseMove(e);return;}
            if(isCeilPanning){const dx=(e.clientX-ceilPanStart.x)/ceilZoom;const dy=(e.clientY-ceilPanStart.y)/ceilZoom;setCeilPan({x:ceilPanStart.px+dx,y:ceilPanStart.py+dy});return;}
            if(ceilDragUid && ceilDragStart && ceilSvgRef.current){
              const svg=ceilSvgRef.current;const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;
              const svgP=pt.matrixTransform(svg.getScreenCTM()!.inverse());
              const cScale=Math.min(380/roomW,270/roomL);
              const cOffX=(600-roomW*cScale)/2;const cOffY=(420-roomL*cScale)/2;
              const worldX=Math.max(0,Math.min(roomW,(svgP.x-cOffX)/cScale));
              const worldY=Math.max(0,Math.min(roomL,(svgP.y-cOffY)/cScale));
              setPlacedDevices(prev=>prev.map(d=>d.uid===ceilDragUid?{...d,x:worldX,y:worldY}:d));
            }
          }}
          onMouseUp={()=>{if(annotate.activeTool||annotate.isDragging()){annotate.handleUp();return;}if(isCeilPanning)setIsCeilPanning(false);setCeilDragUid(null);setCeilDragStart(null);handleCalloutMouseUp();}}
          onMouseLeave={()=>{annotate.handleLeave();if(isCeilPanning)setIsCeilPanning(false);setCeilDragUid(null);setCeilDragStart(null);handleCalloutMouseUp();}}
          onMouseDown={e=>{if(annotate.activeTool&&e.button===0){annotate.handleDown(e);return;}if((e.button===1||(e.button===0&&panMode))&&!lockedViews.ceil){e.preventDefault();setIsCeilPanning(true);setCeilPanStart({x:e.clientX,y:e.clientY,px:ceilPan.x,py:ceilPan.y});}}}
          onDoubleClick={e=>{if(annotate.activeTool)annotate.handleDoubleClick(e);}}
>
          {(() => {
            const cScale = Math.min(380/roomW, 270/roomL);
            const cOffX = (600 - roomW*cScale)/2;
            const cOffY = (420 - roomL*cScale)/2;
            const cpX = (x: number) => cOffX + x*cScale;
            const cpY = (y: number) => cOffY + y*cScale;
            // Every ceiling-mounted device, not just speakers — Ceiling Plan
            // consolidates what used to be two separate panes (Ceiling
            // Speakers, Ceiling Microphones); the per-type branches below
            // already handled mic/camera/fallback rendering.
            const ceilingDevices = placedDevices.filter(d => d.wall === "ceiling" || d.mountWall === "ceiling");
            return (
              <g>
                {!isCustomBlank && (<>
                  {/* Room outline */}
                  <rect x={cpX(0)} y={cpY(0)} width={roomW*cScale} height={roomL*cScale} fill="none" stroke="#b0b5be" strokeWidth={2}/>
                  {/* Door */}
                  <rect x={cpX(roomW)-1} y={cpY(roomL*0.7)} width={3} height={roomL*0.15*cScale} fill="#475569"/>
                  <text x={cpX(roomW)+10} y={cpY(roomL*0.77)} fontSize={7} fill="#475569">Door</text>
                  <text x={cpX(roomW/2)} y={Math.max(12,cpY(0)-8)} textAnchor="middle" fontSize={9} fill="rgb(var(--text-subtle))" fontFamily="'JetBrains Mono',monospace">Front Wall</text>
                  <text x={cpX(roomW/2)} y={cpY(roomL)+10} textAnchor="middle" fontSize={9} fill="rgb(var(--text-subtle))" fontFamily="'JetBrains Mono',monospace">{toDisplay(roomW)}</text>
                  <text x={cpX(-0.05)} y={cpY(roomL/2)} textAnchor="end" fontSize={9} fill="rgb(var(--text-subtle))" fontFamily="'JetBrains Mono',monospace" transform={`rotate(-90,${cpX(-0.05)},${cpY(roomL/2)})`}>{toDisplay(roomL)}</text>
                </>)}
                {/* Drawn walls from floor plan */}
                {placedDevices.filter(d => d.id === "wall-partition" && d.wallAngle !== undefined).map(dev => {
                  const angle = dev.wallAngle!;
                  const len = dev.w;
                  const wx1 = dev.x - Math.cos(angle) * len / 2;
                  const wy1 = dev.y - Math.sin(angle) * len / 2;
                  const wx2 = dev.x + Math.cos(angle) * len / 2;
                  const wy2 = dev.y + Math.sin(angle) * len / 2;
                  return <line key={"cw"+dev.uid} x1={cpX(wx1)} y1={cpY(wy1)} x2={cpX(wx2)} y2={cpY(wy2)} stroke={dev.wallType==="solid"?"#475569":"rgb(var(--text-muted))"} strokeWidth={dev.wallType==="solid"?5:2} strokeLinecap="round" opacity={0.7}/>;
                })}
                {/* Doors/windows from floor plan */}
                {placedDoors.filter(d => d.wall !== "drawn" || placedDevices.some(dev => dev.uid === d.wallUid)).map(door => {
                  const c = getDoorCoords(door);
                  const color = door.type === "window" ? "#a78bfa" : "#475569";
                  return <g key={"cd"+door.id}><line x1={cpX(c.x1)} y1={cpY(c.y1)} x2={cpX(c.x2)} y2={cpY(c.y2)} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.5}/><text x={cpX(c.labelX)} y={cpY(c.labelY)} textAnchor="middle" fontSize={6} fill={color} opacity={0.6}>{door.type === "window" ? "W" : "D"}</text></g>;
                })}
                {/* Table from floor plan */}
                {showTable && !tableDeleted && (() => {
                  const tcx = tableCenterX ?? roomW/2;
                  const tcy = tableWallDist + tL/2;
                  const tw2 = tW/2 * cScale;
                  const tl2 = tL/2 * cScale;
                  return <rect x={cpX(tcx)-tw2} y={cpY(tcy)-tl2} width={tw2*2} height={tl2*2} rx={2} fill="#cbd5e1" fillOpacity={0.15} stroke="rgb(var(--text-muted))" strokeWidth={0.8} strokeDasharray="3 3" transform={`rotate(${tableRotation},${cpX(tcx)},${cpY(tcy)})`}/>;
                })()}
                {/* Placed tables from the floor plan — the Ceiling Plan only shows
                    tables, as the same dotted reference outline as the built-in
                    table above. Chairs and other floor furniture aren't ceiling
                    information, so they're left off. */}
                {placedDevices.filter(d => (d.id === "conf-table" || d.id === "round-table") && (d.mountWall === "floor" || !d.mountWall)).map(dev => {
                  const fw = dev.w * cScale, fl = dev.h * cScale;
                  const outline = { fill: "#cbd5e1", fillOpacity: 0.15, stroke: "rgb(var(--text-muted))", strokeWidth: 0.8, strokeDasharray: "3 3" };
                  if (dev.id === "round-table") return <ellipse key={"csf"+dev.uid} cx={cpX(dev.x)} cy={cpY(dev.y)} rx={fw/2} ry={fl/2} {...outline}/>;
                  return <rect key={"csf"+dev.uid} x={cpX(dev.x)-fw/2} y={cpY(dev.y)-fl/2} width={fw} height={fl} rx={2} {...outline} transform={`rotate(${dev.rotation||0},${cpX(dev.x)},${cpY(dev.y)})`}/>;
                })}
                {/* Ceiling-mounted devices */}
                {ceilingDevices.map(dev => {
                  const dx = cpX(dev.x);
                  const dy = cpY(dev.y);
                  const isDragging = ceilDragUid === dev.uid;
                  const isSelected = selectedUid === dev.uid;
                  // Left button only: a right-click must fall through to the
                  // context menu (below) instead of starting a drag.
                  const grab = (e: React.MouseEvent) => { if(e.button!==0)return; if(annotate.activeTool)return; e.stopPropagation(); setCeilDragUid(dev.uid); setCeilDragStart({x:e.clientX,y:e.clientY}); setSelectedUid(dev.uid); };
                  // A coverage size typed into Edit Equipment (Coverage Pattern /
                  // Diameter / Width / Depth) wins over the height-based estimate
                  // below. A freshly placed ceiling mic carries a 6 / 6 / 6
                  // placeholder (the floor plan's own fallback), and that exact
                  // set counts as "not set" — otherwise every untouched mic would
                  // shrink to a 6 ft circle here.
                  const isPlaceholderCov = dev.covDiameter === 6 && dev.covW === 6 && dev.covL === 6 && dev.covShape !== "square";
                  const specSquare = !isPlaceholderCov && dev.covShape === "square" && !!dev.covW && !!dev.covL;
                  const specDia = !isPlaceholderCov && !specSquare && dev.covDiameter ? dev.covDiameter : undefined;
                  // The equipment itself, drawn at its REAL size and shape rather than
                  // as a fixed dot: a diameter (Dia) makes it a circle of that
                  // diameter, a speaker is round by nature (its width is the
                  // diameter), and anything else — a 24" x 24" mic array tile — is
                  // a rectangle of its width x height. A floor keeps it big enough
                  // to see and grab. Only this body is interactive (drag / right-click).
                  const hasDia = (dev.diameter_in ?? 0) > 0;
                  const bodyRound = hasDia || dev.type === "speaker";
                  const bodyWFt = hasDia ? dev.diameter_in! / 12 : dev.w;
                  const bodyHFt = bodyRound ? bodyWFt : dev.h;
                  const bodyW = Math.max(8, bodyWFt * cScale), bodyH = Math.max(8, bodyHFt * cScale);
                  const renderBody = (color: string) => {
                    const common = { fill: color, fillOpacity: 0.6, stroke: color, strokeWidth: 1.2, pointerEvents: "all" as const, style: { cursor: isDragging ? "grabbing" : "grab" }, onMouseDown: grab, onContextMenu: (e: React.MouseEvent) => handleDeviceContextMenu(e, dev.uid) };
                    return bodyRound
                      ? <circle cx={dx} cy={dy} r={bodyW / 2} {...common}/>
                      : <rect x={dx - bodyW / 2} y={dy - bodyH / 2} width={bodyW} height={bodyH} rx={2} {...common}/>;
                  };
                  const renderSelection = () => !isSelected ? null : (bodyRound
                    ? <circle cx={dx} cy={dy} r={bodyW / 2 + 4} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>
                    : <rect x={dx - bodyW / 2 - 4} y={dy - bodyH / 2 - 4} width={bodyW + 8} height={bodyH + 8} rx={4} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2"/>);
                  if (dev.type === "speaker") {
                    const earHeight = 4;  // 4 ft ear height
                    const effectiveH = Math.max(0.5, roomH - earHeight);
                    const dispRad = ((dev.dispersion || 90) / 2) * Math.PI / 180;
                    const covDia = specDia ?? 2 * effectiveH * Math.tan(dispRad);
                    const r = covDia / 2 * cScale;
                    return (
                      // Only the solid dot is interactive (drag / right-click): the
                      // coverage area and labels are pointer-transparent, so they
                      // never grab a click meant for something underneath them.
                      <g key={dev.uid} pointerEvents="none" opacity={isDragging?0.7:1}>
                        {renderSelection()}
                        {specSquare
                          ? <rect x={dx-dev.covW!*cScale/2} y={dy-dev.covL!*cScale/2} width={dev.covW!*cScale} height={dev.covL!*cScale} fill="rgba(168,85,247,0.08)" stroke="#a855f7" strokeWidth={0.8} strokeDasharray="3 2"/>
                          : <circle cx={dx} cy={dy} r={r} fill="rgba(168,85,247,0.08)" stroke="#a855f7" strokeWidth={0.8} strokeDasharray="3 2"/>}
                        {renderBody("#a855f7")}
                        <text x={dx} y={dy+bodyH/2+9} textAnchor="middle" fontSize={6} fill="#a855f780">{specSquare ? `${toDisplay(dev.covW!)} × ${toDisplay(dev.covL!)}` : `${toDisplay(covDia)} dia`}</text>
                      </g>
                    );
                  }
                  if (dev.type === "mic") {
                    const mouthHeight = 4;  // 4 ft mouth/ear height
                    const effectiveH = Math.max(0.5, roomH - mouthHeight);
                    const pickupAngle = 120;
                    const pickupRad = (pickupAngle / 2) * Math.PI / 180;
                    const covDia = specDia ?? 2 * effectiveH * Math.tan(pickupRad);
                    // The estimate is capped so it can't swamp the plan; a size the
                    // user typed is drawn exactly as entered.
                    const r = specDia ? covDia / 2 * cScale : Math.min(covDia / 2 * cScale, Math.max(roomW, roomL) * cScale * 0.6);
                    return (
                      // Only the solid dot is interactive (see the speaker above).
                      <g key={dev.uid} pointerEvents="none" opacity={isDragging?0.7:1}>
                        {renderSelection()}
                        {specSquare
                          ? <rect x={dx-dev.covW!*cScale/2} y={dy-dev.covL!*cScale/2} width={dev.covW!*cScale} height={dev.covL!*cScale} fill="rgba(34,197,94,0.06)" stroke="#22c55e" strokeWidth={0.8} strokeDasharray="3 2"/>
                          : <circle cx={dx} cy={dy} r={r} fill="rgba(34,197,94,0.06)" stroke="#22c55e" strokeWidth={0.8} strokeDasharray="3 2"/>}
                        {renderBody("#22c55e")}
                        <text x={dx} y={dy+bodyH/2+9} textAnchor="middle" fontSize={6} fill="#22c55e80">{specSquare ? `${toDisplay(dev.covW!)} × ${toDisplay(dev.covL!)}` : `${toDisplay(covDia)} dia`}</text>
                      </g>
                    );
                  }
                  if (dev.type === "camera") {
                    return (
                      <g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={grab} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                        {isSelected && <rect x={dx-12} y={dy-9} width={24} height={18} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" rx={4}/>}
                        <rect x={dx-8} y={dy-5} width={16} height={10} rx={3} fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth={1}/>
                        <circle cx={dx} cy={dy} r={3} fill="#f59e0b" opacity={0.8}/>
                      </g>
                    );
                  }
                  return (
                    <g key={dev.uid} style={{cursor:isDragging?"grabbing":"grab"}} onMouseDown={grab} onContextMenu={e=>handleDeviceContextMenu(e,dev.uid)} opacity={isDragging?0.7:1}>
                      {isSelected && <rect x={dx-10} y={dy-10} width={20} height={20} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="3 2" rx={3}/>}
                      <rect x={dx-6} y={dy-6} width={12} height={12} rx={2} fill={dev.color+"22"} stroke={dev.color} strokeWidth={0.8}/>
                    </g>
                  );
                })}
                {/* Same make/model call-outs as the Floor Plan, on top of the equipment */}
                {ceilingDevices.map(dev => renderCallout(dev, "ceil"))}
              </g>
            );
          })()}
          {annotate.layerFor("ceil")}
        </svg>
        {/* Ceiling height control — lives here rather than on Floor Plan
            since it's specifically the Ceiling Plan's own dimension. */}
        <div className="rd-print-hide" style={{position:"absolute",bottom:12,right:60,display:"flex",alignItems:"center",gap:4,background:cc.panel,borderRadius:6,border:"1px solid rgb(var(--border))",padding:"5px 8px"}}>
          <span style={{fontSize:10,color:"rgb(var(--text-subtle))",whiteSpace:"nowrap"}}>Ceiling</span>
          <input type="number" className="no-spin" step={1} value={Math.floor(roomH)}
            onChange={e=>{const v=parseInt(e.target.value); if(!isNaN(v)) setRoomH(v + (roomH - Math.floor(roomH)))}}
            onBlur={()=>setRoomH(Math.min(16,Math.max(7,roomH)))}
            style={{width:30,background:"rgb(var(--forge-surface) / 0.6)",border:"1px solid rgb(var(--border))",borderRadius:3,padding:"2px 4px",fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))",fontSize:11,textAlign:"right",outline:"none"}}
            onFocus={e=>e.target.style.borderColor="#8b5cf6"}
          />
          <span style={{fontSize:10,color:"rgb(var(--text-subtle))"}}>ft</span>
          <input type="number" className="no-spin" step={1} value={Math.round((roomH - Math.floor(roomH)) * 12)}
            onChange={e=>{const v=parseInt(e.target.value); if(!isNaN(v)) setRoomH(Math.floor(roomH) + v/12)}}
            onBlur={()=>setRoomH(Math.min(16,Math.max(7,roomH)))}
            style={{width:26,background:"rgb(var(--forge-surface) / 0.6)",border:"1px solid rgb(var(--border))",borderRadius:3,padding:"2px 4px",fontFamily:"'JetBrains Mono',monospace",color:"rgb(var(--text-body))",fontSize:11,textAlign:"right",outline:"none"}}
            onFocus={e=>e.target.style.borderColor="#8b5cf6"}
          />
          <span style={{fontSize:10,color:"rgb(var(--text-subtle))"}}>in</span>
        </div>
        {/* Ceiling zoom controls */}
        {zoomCluster("ceil")}
      </div>
      </div>{/* end Ceiling Plan half */}
      </div>{/* end Row 1 (Floor Plan / Ceiling Plan) */}

      {/* Divider — drag to resize the Floor+Ceiling row vs Elevations */}
      <div
        onMouseDown={e=>{e.preventDefault();setIsDraggingRowSplit(true);}}
        onDoubleClick={()=>setTopRowHeightVh(50)}
        title="Drag to resize — double-click to reset to 50/50"
        style={{height:8,flexShrink:0,cursor:"row-resize",background:isDraggingRowSplit?"#8b5cf6":"rgb(var(--border))",display:"flex",alignItems:"center",justifyContent:"center",transition:isDraggingRowSplit?"none":"background 0.15s"}}
      >
        <div style={{height:3,width:32,borderRadius:2,background:isDraggingRowSplit?"#fff":"rgb(var(--text-subtle))"}}/>
      </div>

      {/* Row 5: Elevations — one tab per active direction flag on every
          Elevation Marker (dropped in the Plan View; right-click a marker to
          turn on more than the default North flag). */}
      <div id="rd-print-title-elev" style={{borderTop:"1px solid rgb(var(--border))"}}>
        <div style={{position:"relative",padding:"8px 16px",fontSize:12,fontWeight:700,color:"rgb(var(--text-muted))",textTransform:"uppercase",letterSpacing:"0.05em",textAlign:"center",textDecoration:"underline",textUnderlineOffset:"4px"}}>Elevations{collapseToggle("elev")}</div>
      </div>
      <div id="rd-print-page-elev" style={{display:collapsedCanvases.has("elev")?"none":"block",height:`${100-topRowHeightVh}vh`,minHeight:400,position:"relative",background:cc.card,overflow:"hidden"}}>
        {(() => {
          const activeViews = elevationMarkers.flatMap(m =>
            m.directions.map(k => ({ marker: m, dir: k, key: `${m.id}-${k}` }))
          );
          if (activeViews.length === 0) return (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",flexDirection:"column",gap:6,color:"rgb(var(--text-subtle))",fontSize:13,textAlign:"center",padding:24}}>
              <div>No elevation views yet.</div>
              <div style={{fontSize:11}}>Use the <strong>Elevation</strong> tool in the toolbar above, then click inside the Plan View to drop a marker — right-click it to choose which walls (North/East/South/West) to view.</div>
            </div>
          );
          const activeView = activeViews.find(v => v.key === activeElevationKey) || activeViews[0];
          const elevData = computeElevation(activeView.marker, ELEVATION_DIR_ANGLES[activeView.dir]);
          const eScale = Math.min(500 / elevData.wallWidthFt, 260 / Math.max(1, elevData.roomHFt));
          elevScaleRef.current = eScale; // keeps the Dimension tool's formatDistance in sync with this view
          const eOffX = (600 - elevData.wallWidthFt * eScale) / 2;
          const eFloorY = 370;
          const ePX = (xFt: number) => eOffX + xFt * eScale;
          const ePY = (zFt: number) => eFloorY - zFt * eScale;
          // This view's own left-right axis in plan coordinates — dragging an
          // item horizontally in the elevation moves it along this vector, so
          // the move stays flush to the wall/angle currently being viewed.
          const elevPerp = elevationPerp(ELEVATION_DIR_ANGLES[activeView.dir]);
          const updateElevItemDrag = (e: React.MouseEvent) => {
            if (!elevItemDrag) return false;
            const svg = elevSvgRef.current; if (!svg) return true;
            const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
            const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
            const deltaU = (svgP.x - elevItemDrag.startSvgX) / eScale;
            const deltaZ = -(svgP.y - elevItemDrag.startSvgY) / eScale;
            const newX = Math.max(cMinX, Math.min(cMaxX, elevItemDrag.origX + deltaU * elevItemDrag.perpX));
            const newY = Math.max(cMinY, Math.min(cMaxY, elevItemDrag.origY + deltaU * elevItemDrag.perpY));
            setPlacedDevices(prev => prev.map(d => {
              if (d.uid !== elevItemDrag.uid) return d;
              if (elevItemDrag.isCeiling) return { ...d, x: newX, y: newY };
              const half = elevItemDrag.hFt / 2;
              const newZ = Math.max(half, Math.min(roomH - half, elevItemDrag.origZ + deltaZ));
              return { ...d, x: newX, y: newY, z: newZ };
            }));
            return true;
          };
          const updateElevCalloutDrag = (e: React.MouseEvent) => {
            if (!elevCalloutDrag) return false;
            const svg = elevSvgRef.current; if (!svg) return true;
            const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
            const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
            const newDxFt = elevCalloutDrag.origDxFt + (svgP.x - elevCalloutDrag.startSvgX) / eScale;
            const newDyFt = elevCalloutDrag.origDyFt + (svgP.y - elevCalloutDrag.startSvgY) / eScale;
            setPlacedDevices(prev => prev.map(d => d.uid === elevCalloutDrag.uid
              ? { ...d, calloutElevDx: newDxFt, calloutElevDy: newDyFt } : d));
            return true;
          };
          return (
            <>
              <div style={{position:"absolute",top:8,left:8,zIndex:5,display:"flex",gap:4,flexWrap:"wrap",maxWidth:"70%"}}>
                {activeViews.map(v => (
                  <button key={v.key} onClick={()=>setActiveElevationKey(v.key)}
                    style={{padding:"4px 10px",fontSize:11,fontWeight:activeView.key===v.key?700:400,background:activeView.key===v.key?"rgba(0,0,0,0.08)":"rgb(var(--forge-surface))",border:`1px solid ${activeView.key===v.key?"#000":"rgb(var(--border))"}`,borderRadius:5,cursor:"pointer",color:activeView.key===v.key?"#000":"rgb(var(--text-muted))"}}>
                    {v.marker.label}{elevationDirNumber(v.marker, v.dir)}
                  </button>
                ))}
              </div>
              <svg ref={elevSvgRef} data-rd-canvas="elev" width="100%" height="100%" viewBox={`${300-300/elevZoom-elevPan.x} ${210-210/elevZoom-elevPan.y} ${600/elevZoom} ${420/elevZoom}`}
                style={{background:cc.card,cursor:annotate.activeTool?(annotate.cursor||"crosshair"):isElevPanning?"grabbing":panMode?"grab":"default"}}
                onMouseMove={e=>{
                  if(updateElevCalloutDrag(e))return;
                  if(updateElevItemDrag(e))return;
                  if(annotate.activeTool||annotate.isDragging()){annotate.handleMove(e);return;}
                  if(isElevPanning){const dx=(e.clientX-elevPanStart.x)/elevZoom;const dy=(e.clientY-elevPanStart.y)/elevZoom;setElevPan({x:elevPanStart.px+dx,y:elevPanStart.py+dy});}
                }}
                onMouseUp={()=>{if(elevCalloutDrag){setElevCalloutDrag(null);return;}if(elevItemDrag){setElevItemDrag(null);return;}if(annotate.activeTool||annotate.isDragging()){annotate.handleUp();return;}if(isElevPanning)setIsElevPanning(false);}}
                onMouseLeave={()=>{if(elevCalloutDrag)setElevCalloutDrag(null);if(elevItemDrag)setElevItemDrag(null);annotate.handleLeave();if(isElevPanning)setIsElevPanning(false);}}
                onMouseDown={e=>{if(annotate.activeTool&&e.button===0){annotate.handleDown(e);return;}if((e.button===1||(e.button===0&&panMode))&&!lockedViews.elev){e.preventDefault();setIsElevPanning(true);setElevPanStart({x:e.clientX,y:e.clientY,px:elevPan.x,py:elevPan.y});}}}
                onDoubleClick={e=>{if(annotate.activeTool)annotate.handleDoubleClick(e);}}
              >
                <text x={300} y={22} textAnchor="middle" fontSize={11} fontWeight={700} fill="rgb(var(--text-body))">Elevation {activeView.marker.label}{elevationDirNumber(activeView.marker, activeView.dir)} — {ELEVATION_DIR_LABELS[activeView.dir]}</text>
                <line x1={ePX(0)} y1={eFloorY} x2={ePX(elevData.wallWidthFt)} y2={eFloorY} stroke="#475569" strokeWidth={2}/>
                <rect x={ePX(0)} y={ePY(elevData.roomHFt)} width={elevData.wallWidthFt*eScale} height={elevData.roomHFt*eScale} fill="none" stroke="#b0b5be" strokeWidth={1.5}/>
                <text x={ePX(elevData.wallWidthFt/2)} y={eFloorY+16} textAnchor="middle" fontSize={9} fill="rgb(var(--text-muted))" fontFamily="'JetBrains Mono',monospace">{toDisplay(elevData.wallWidthFt)}</text>
                <text x={ePX(-0.15)} y={ePY(elevData.roomHFt/2)} textAnchor="end" fontSize={9} fill="rgb(var(--text-muted))" fontFamily="'JetBrains Mono',monospace" transform={`rotate(-90,${ePX(-0.15)},${ePY(elevData.roomHFt/2)})`}>{toDisplay(elevData.roomHFt)}</text>
                {elevData.items.length === 0 && (
                  <text x={300} y={210} textAnchor="middle" fontSize={10} fill="rgb(var(--text-subtle))">No equipment along this line of sight</text>
                )}
                {elevData.items.map(it => {
                  const x0 = ePX(it.u - it.wFt/2), x1 = ePX(it.u + it.wFt/2);
                  const y0 = ePY(it.boxTop), y1 = ePY(it.boxBot);
                  // One neutral ink color, same as the Plan view's own equipment
                  // call-outs — a professional drawing reads in one color, not a
                  // rainbow of each device's own accent color. It's the theme's
                  // body-text color (not a fixed dark grey) so it stays readable
                  // on both the light and the dark canvas.
                  const dimX = Math.min(x0, x1) + 10;
                  const isDraggingThis = elevItemDrag?.uid === it.dev.uid;
                  const isCeiling = it.dev.wall === "ceiling" || it.dev.mountWall === "ceiling";
                  const dimMidY = (eFloorY + y1) / 2;
                  const isEditingDim = editingElevDimUid === it.dev.uid;
                  // Call-out styled to match the Plan/Ceiling view's own
                  // renderCallout — leader line (diagonal stub + elbow) out to
                  // an offset label, not a bare caption glued to the box, so
                  // it reads as the same drawing convention everywhere. The
                  // label itself is draggable too (calloutElevDx/Dy, feet so
                  // it stays stable if the view's own scale changes), same as
                  // Plan — its own mousedown stops propagation so grabbing the
                  // label repositions just the callout, not the whole device.
                  const calloutAnchorX = (x0 + x1) / 2, calloutAnchorY = y0;
                  const calloutDxFt = it.dev.calloutElevDx ?? -16 / eScale;
                  const calloutDyFt = it.dev.calloutElevDy ?? -20 / eScale;
                  const calloutLabelX = calloutAnchorX + calloutDxFt * eScale, calloutLabelY = calloutAnchorY + calloutDyFt * eScale;
                  const calloutSide = calloutLabelX >= calloutAnchorX ? 1 : -1;
                  const calloutElbowX = calloutLabelX - calloutSide * CALLOUT_STUB_PX, calloutElbowY = calloutLabelY;
                  const calloutText = calloutLabel(it.dev);
                  const onCalloutMouseDown = (e: React.MouseEvent) => beginElevCalloutDrag(it.dev.uid, calloutDxFt, calloutDyFt, e);
                  return (
                    <g key={it.dev.uid}
                      style={{cursor: annotate.activeTool ? undefined : "move"}}
                      onMouseDown={e => beginElevItemDrag(it.dev.uid, elevPerp.x, elevPerp.y, e)}>
                      <rect x={Math.min(x0,x1)} y={y0} width={Math.abs(x1-x0)} height={Math.max(2,y1-y0)} fill="rgb(var(--text-body))" fillOpacity={isDraggingThis?0.18:0.08} stroke={isDraggingThis?"#8b5cf6":"rgb(var(--text-body))"} strokeWidth={isDraggingThis?1.8:1.2}/>
                      <line x1={calloutAnchorX} y1={calloutAnchorY} x2={calloutElbowX} y2={calloutElbowY} stroke="rgb(var(--text-muted))" strokeWidth={0.6}/>
                      <line x1={calloutElbowX} y1={calloutElbowY} x2={calloutLabelX} y2={calloutLabelY} stroke="rgb(var(--text-muted))" strokeWidth={0.6}/>
                      <circle cx={calloutAnchorX} cy={calloutAnchorY} r={1.2} fill="rgb(var(--text-muted))"/>
                      {/* Invisible padded rect widens the draggable area to the
                          label's full apparent extent, same as Plan's own
                          callout hit-box — a bare <text> only hit-tests ink. */}
                      <rect x={calloutSide > 0 ? calloutLabelX : calloutLabelX - Math.max(30, calloutText.length * 4.6)} y={calloutLabelY - 5}
                        width={Math.max(30, calloutText.length * 4.6)} height={9} fill="transparent"
                        style={{cursor: "move"}} onMouseDown={onCalloutMouseDown}/>
                      <text x={calloutLabelX + calloutSide * 4} y={calloutLabelY + 2.5} textAnchor={calloutSide > 0 ? "start" : "end"} fontSize={7} fontWeight={600} fill="rgb(var(--text-body))" fontFamily="Inter, sans-serif"
                        style={{cursor: "move"}} onMouseDown={onCalloutMouseDown}>{calloutText}</text>
                      {/* Default bottom-of-equipment-to-FFL dimension — mount
                          height off the floor is the first thing a BOD/elevation
                          needs to call out, so show it automatically instead of
                          requiring a manual dimension annotation every time.
                          Double-click the label to type an exact height instead
                          of dragging for it (skipped for ceiling-mounted items,
                          which don't have an independently settable height). */}
                      {it.boxBot > 0.05 && (
                        <g onMouseDown={e=>e.stopPropagation()}>
                          <line x1={dimX} y1={eFloorY} x2={dimX} y2={y1} stroke="rgb(var(--text-muted))" strokeWidth={1}/>
                          <path d={`M${dimX-3},${eFloorY-6} L${dimX},${eFloorY} L${dimX+3},${eFloorY-6}`} fill="none" stroke="rgb(var(--text-muted))" strokeWidth={1}/>
                          <path d={`M${dimX-3},${y1+6} L${dimX},${y1} L${dimX+3},${y1+6}`} fill="none" stroke="rgb(var(--text-muted))" strokeWidth={1}/>
                          {isEditingDim ? (
                            <foreignObject x={dimX+5} y={dimMidY-11} width={68} height={22} onMouseDown={e=>e.stopPropagation()}>
                              <input
                                ref={elevDimInputRef}
                                value={elevDimInput}
                                onChange={e=>setElevDimInput(e.target.value)}
                                onBlur={()=>commitElevDimEdit(true)}
                                onKeyDown={e=>{
                                  e.stopPropagation();
                                  if(e.key==="Enter"){e.preventDefault();commitElevDimEdit();}
                                  if(e.key==="Escape"){e.preventDefault();setEditingElevDimUid(null);setElevDimInput("");}
                                }}
                                aria-label="Bottom of equipment height"
                                title={'Enter a height, for example 3\' 6"'}
                                style={{width:"100%",height:20,boxSizing:"border-box",border:"1px solid #8b5cf6",borderRadius:3,background:"rgb(var(--forge-bg))",color:"rgb(var(--text-heading))",fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:600,textAlign:"left",outline:"none",padding:"1px 3px"}}
                              />
                            </foreignObject>
                          ) : (
                            <text x={dimX+5} y={dimMidY} fontSize={8} fill="rgb(var(--text-muted))" fontFamily="'JetBrains Mono',monospace" dominantBaseline="middle"
                              style={{cursor: isCeiling ? "default" : "pointer"}}
                              onDoubleClick={e=>{
                                e.stopPropagation();
                                if (isCeiling) return;
                                setEditingElevDimUid(it.dev.uid);
                                setElevDimInput(toEditableLength(it.boxBot));
                              }}>
                              {toDisplay(it.boxBot)}
                            </text>
                          )}
                        </g>
                      )}
                    </g>
                  );
                })}
                {annotate.layerFor("elev")}
              </svg>
              {/* Elevations zoom controls */}
              {zoomCluster("elev")}
            </>
          );
        })()}
      </div>
      </>
      </div>{/* end scrollable canvas */}

      {/* Annotation text editor overlay */}
      {annotate.overlay}

      {scopeReimportConfirm && (
        <ConfirmDialog
          title="Re-import from Scope"
          message={SCOPE_REIMPORT_WARNING}
          confirmLabel="Confirm"
          busy={generatingFromScope}
          onCancel={() => setScopeReimportConfirm(false)}
          onConfirm={() => { setScopeReimportConfirm(false); generateDevicesFromScopeRD(true); }}
        />
      )}

      {/* ── Right Panel: Shared BOM + Device Properties ──────── */}
      <BOMPanel
        collapsed={bomCollapsed}
        onToggle={() => setBomCollapsed(!bomCollapsed)}
        propertiesSlot={null}
      />
        </div>{/* end canvas+BOM row */}
      </div>{/* end right column */}

    </div>

    {/* Device Context Menu — mirrors Signal Flow Builder's right-click menu */}
    {deviceContextMenu && (
      <>
        <div style={{position:"fixed",inset:0,zIndex:100}} onClick={()=>setDeviceContextMenu(null)} onContextMenu={e=>{e.preventDefault();setDeviceContextMenu(null);}} />
        <div style={{position:"fixed",left:deviceContextMenu.x,top:deviceContextMenu.y,zIndex:101,background:"rgb(var(--forge-panel))",border:"1px solid rgb(var(--border))",borderRadius:6,boxShadow:"0 4px 20px rgba(0,0,0,0.35)",width:190,overflow:"hidden",padding:"4px 0"}}>
          <button onClick={()=>{
            const dev = placedDevices.find(d=>d.uid===deviceContextMenu.uid);
            if(dev) setEditingDevice({...dev, ports: dev.ports ? dev.ports.map(p=>({...p})) : []});
            setDeviceContextMenu(null);
          }}
            style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"7px 14px",background:"none",border:"none",color:"rgb(var(--text-body))",fontSize:12,cursor:"pointer",textAlign:"left"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgb(var(--forge-surface))"} onMouseLeave={e=>e.currentTarget.style.background="none"}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit equipment
          </button>
          <button onClick={()=>{
            setReplacingDeviceUid(deviceContextMenu.uid);
            setShowAddModal(true);
            setModalSearch("");setModalSelected(null);setModalDeviceName("");setModalMake("");setModalModel("");setModalGlobalSearch(false);
            setDeviceContextMenu(null);
          }}
            style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"7px 14px",background:"none",border:"none",color:"rgb(var(--text-body))",fontSize:12,cursor:"pointer",textAlign:"left"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgb(var(--forge-surface))"} onMouseLeave={e=>e.currentTarget.style.background="none"}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            Replace
          </button>
          <button onClick={()=>{
            duplicateDevice(deviceContextMenu.uid);
            setDeviceContextMenu(null);
          }}
            style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"7px 14px",background:"none",border:"none",color:"rgb(var(--text-body))",fontSize:12,cursor:"pointer",textAlign:"left"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgb(var(--forge-surface))"} onMouseLeave={e=>e.currentTarget.style.background="none"}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Duplicate
          </button>
          {(() => {
            const menuDev = placedDevices.find(d=>d.uid===deviceContextMenu.uid);
            if (!menuDev || isRoomFurniture(menuDev) || !isLibraryAdmin) return null;
            return (
              <button onClick={async ()=>{
                const dev = placedDevices.find(d=>d.uid===deviceContextMenu.uid);
                setDeviceContextMenu(null);
                if(!dev) return;
                const label = [(dev as any).mfr, (dev as any).model].filter(Boolean).join(" ") || (dev as any).type || "Device";
                const result = await addEquipmentToLibraryConfirmed(deviceToFormValue(dev), (matches)=>
                  window.confirm(`"${label}" looks similar to what's already in the AVGenix Library:\n\n${matches.map(m=>`• ${m.manufacturer} ${m.model_name}${m.part_number?` (${m.part_number})`:""}`).join("\n")}\n\nAdd it anyway as a different product?`)
                );
                if(result.status==="added") setGenerateNotice({kind:"ok",message:`Added ${label} to the AVGenix Library.`});
                else if(result.status==="exists") setGenerateNotice({kind:"ok",message:`${label} is already in the AVGenix Library.`});
                else if(result.status==="cancelled") { /* user chose not to add a possible duplicate */ }
                else setGenerateNotice({kind:"error",message:result.error||`Unable to add ${label} to the AVGenix Library.`});
                window.setTimeout(()=>setGenerateNotice(null),5000);
              }}
                style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"7px 14px",background:"none",border:"none",color:"rgb(var(--text-body))",fontSize:12,cursor:"pointer",textAlign:"left"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgb(var(--forge-surface))"} onMouseLeave={e=>e.currentTarget.style.background="none"}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="12" y1="4" x2="12" y2="10"/></svg>
                Add to AVGenix Library
              </button>
            );
          })()}
          <div style={{height:1,background:"rgb(var(--border))",margin:"4px 0"}} />
          {/* Hide: out of THIS view only — Signal Flow, the rack and the BOM keep it. */}
          {(() => {
            const menuDev = placedDevices.find(d=>d.uid===deviceContextMenu.uid);
            if (!menuDev || isRoomFurniture(menuDev)) return null;
            return (
              <button onClick={()=>{
                hideDevices([deviceContextMenu.uid]);
                setDeviceContextMenu(null);
              }}
                title="Remove it from this view only. It stays in Signal Flow, the Rack Builder and the BOM."
                style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"7px 14px",background:"none",border:"none",color:"rgb(var(--text-body))",fontSize:12,cursor:"pointer",textAlign:"left"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgb(var(--forge-surface))"} onMouseLeave={e=>e.currentTarget.style.background="none"}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                Hide
              </button>
            );
          })()}
          <button onClick={()=>{
            requestDeleteDevices([deviceContextMenu.uid]);
            setDeviceContextMenu(null);
          }}
            style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"7px 14px",background:"none",border:"none",color:"#f87171",fontSize:12,cursor:"pointer",textAlign:"left"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.08)"} onMouseLeave={e=>e.currentTarget.style.background="none"}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete equipment
          </button>
        </div>
      </>
    )}

    {/* Elevation marker context menu — right-click a marker to choose which
        of its 4 direction flags (N/E/S/W) are active. North starts on by
        default; toggling more on lets one marker drive several elevation
        views at once, one tab per active flag in the Elevations pane below. */}
    {elevMarkerContextMenu && (() => {
      const marker = elevationMarkers.find(m => m.id === elevMarkerContextMenu.id);
      if (!marker) return null;
      return (
        <>
          <div style={{position:"fixed",inset:0,zIndex:100}} onClick={()=>setElevMarkerContextMenu(null)} onContextMenu={e=>{e.preventDefault();setElevMarkerContextMenu(null);}} />
          <div style={{position:"fixed",left:elevMarkerContextMenu.x,top:elevMarkerContextMenu.y,zIndex:101,background:"rgb(var(--forge-panel))",border:"1px solid rgb(var(--border))",borderRadius:6,boxShadow:"0 4px 20px rgba(0,0,0,0.35)",width:190,overflow:"hidden",padding:"4px 0"}}>
            <div style={{padding:"6px 14px 4px",fontSize:10,fontWeight:700,color:"rgb(var(--text-subtle))",textTransform:"uppercase",letterSpacing:"0.05em"}}>Elevation {marker.label} — Views</div>
            {ELEVATION_DIR_KEYS.map(dirKey => {
              const active = marker.directions.includes(dirKey);
              const num = elevationDirNumber(marker, dirKey);
              return (
                <button key={dirKey} onClick={()=>toggleElevationDirection(marker.id, dirKey)}
                  style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"7px 14px",background:"none",border:"none",color:"rgb(var(--text-body))",fontSize:12,cursor:"pointer",textAlign:"left"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgb(var(--forge-surface))"} onMouseLeave={e=>e.currentTarget.style.background="none"}>
                  <span style={{width:16,height:16,borderRadius:3,border:"1.5px solid rgb(var(--text-subtle))",background:active?"#000":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff",fontFamily:"'JetBrains Mono',monospace"}}>
                    {active ? num : ""}
                  </span>
                  {ELEVATION_DIR_LABELS[dirKey]}
                  <span style={{marginLeft:"auto",fontSize:10,color:"rgb(var(--text-subtle))",fontFamily:"'JetBrains Mono',monospace"}}>{active ? `${marker.label}${num}` : ""}</span>
                </button>
              );
            })}
            <div style={{height:1,background:"rgb(var(--border))",margin:"4px 0"}} />
            <button onClick={()=>{
              setElevationMarkers(prev=>prev.filter(x=>x.id!==marker.id));
              setSelectedElevationId(prev=>prev===marker.id?null:prev);
              setActiveElevationKey(prev=>prev && prev.startsWith(marker.id+"-") ? null : prev);
              setElevMarkerContextMenu(null);
            }}
              style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"7px 14px",background:"none",border:"none",color:"#f87171",fontSize:12,cursor:"pointer",textAlign:"left"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.08)"} onMouseLeave={e=>e.currentTarget.style.background="none"}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              Delete marker
            </button>
          </div>
        </>
      );
    })()}

    {deleteConfirm && (
      <ConfirmDialog
        title={deleteConfirm.names.length === 1 ? "Delete equipment?" : `Delete ${deleteConfirm.names.length} pieces of equipment?`}
        message={<>
          <span className="font-semibold text-heading">{deleteConfirm.names.length === 1 ? deleteConfirm.names[0] : deleteConfirm.names.join(", ")}</span>{" "}
          will be deleted from all other instances too — Room Designer, Signal Flow, Rack Builder and the BOM.
          To remove it from this view only, cancel and use <span className="font-semibold text-heading">Hide</span> (right-click the equipment → Hide).
        </>}
        confirmLabel="Delete everywhere"
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => { deleteDevicesNow(deleteConfirm.uids); setDeleteConfirm(null); }}
      />
    )}

    {/* Rotate popup — opened from the small purple button next to a selected
        camera or display's delete "×"; typing a value and pressing
        Enter/Apply sets its rotation directly. */}
    {rotatePopup && (
      <>
        <div style={{position:"fixed",inset:0,zIndex:100}} onClick={()=>setRotatePopup(null)} />
        <div style={{position:"fixed",left:rotatePopup.x,top:rotatePopup.y,zIndex:101,background:"rgb(var(--forge-panel))",border:"1px solid rgb(var(--border))",borderRadius:6,boxShadow:"0 4px 20px rgba(0,0,0,0.35)",padding:10,display:"flex",alignItems:"center",gap:8}}
          onClick={e=>e.stopPropagation()}>
          <label style={{fontSize:11,color:"rgb(var(--text-subtle))",whiteSpace:"nowrap"}}>Rotation (°)</label>
          <input autoFocus type="number" value={rotatePopup.value}
            onChange={e=>setRotatePopup({...rotatePopup, value:e.target.value})}
            onKeyDown={e=>{
              if(e.key==="Enter"){
                const deg=Number(rotatePopup.value);
                if(!Number.isNaN(deg)) setDeviceRotation(rotatePopup.uid, deg);
                setRotatePopup(null);
              } else if(e.key==="Escape"){
                setRotatePopup(null);
              }
            }}
            style={{width:70,padding:"5px 8px",background:"rgb(var(--forge-surface))",border:"1px solid rgb(var(--border))",borderRadius:4,color:"rgb(var(--text-body))",fontSize:12,outline:"none"}} />
          <button onClick={()=>{
            const deg=Number(rotatePopup.value);
            if(!Number.isNaN(deg)) setDeviceRotation(rotatePopup.uid, deg);
            setRotatePopup(null);
          }} style={{padding:"5px 10px",background:"#8b5cf6",border:"1px solid #8b5cf6",borderRadius:4,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>
            Apply
          </button>
        </div>
      </>
    )}

    {/* Edit Equipment modal — same shared form Signal Flow Builder/Rack Planner use */}
    {editingDevice && (
      <EquipmentFormModal
        title="Edit Equipment"
        value={deviceToFormValue(editingDevice)}
        onChange={(v)=>setEditingDevice(applyFormValueToDevice(editingDevice, v))}
        onCancel={()=>setEditingDevice(null)}
        onSave={()=>{
          pushUndo();
          const before = placedDevices.find(d => d.uid === editingDevice.uid);
          // Retyping the maker / model of a library product makes it a different product.
          const edited = identityAfterEdit(before, editingDevice);
          setPlacedDevices(prev=>prev.map(d=>d.uid===edited.uid?edited:d));
          // Signal Flow, the rack and the BOM show the same make / model / price / specs
          // (only what this edit changed is passed on).
          const changes = diffSpec(before ? specFromRoomDevice(before) : {}, specFromRoomDevice(edited));
          if (edited.itemId && Object.keys(changes).length) updateUnitSpec(edited.itemId, changes);
          setEditingDevice(null);
        }}
        saving={false}
        saveDisabled={!(editingDevice.name||"").trim()}
        notesLabel="Description"
        categories={deviceCatalog.map(g=>g.cat)}
        showAIImport
        aiMode="update"

      />
    )}

    {/* Add Equipment Modal */}
    {showAddModal && (
      <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.55)"}}
        onClick={closeModal}>
        <div style={{width:560,background:"rgb(var(--forge-panel))",borderRadius:10,border:"1px solid rgb(var(--border))",boxShadow:"0 16px 48px rgba(0,0,0,0.5)",display:"flex",flexDirection:"column",maxHeight:"72vh",overflow:"hidden"}}
          onClick={e=>e.stopPropagation()}>

          {/* Header */}
          <div style={{padding:"16px 20px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:9}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--text-body))" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
              <span style={{fontSize:15,fontWeight:700,color:"rgb(var(--text-body))"}}>{replacingDeviceUid!=null?"Replace Equipment":"Add Equipment"}</span>
            </div>
            <button onClick={closeModal}
              style={{background:"none",border:"none",color:"rgb(var(--text-subtle))",cursor:"pointer",fontSize:20,lineHeight:1,padding:"2px 4px"}}>×</button>
          </div>

          {/* Search bar */}
          <div style={{padding:"0 20px 14px",flexShrink:0}}>
            <div style={{display:"flex",gap:0}}>
              <input autoFocus value={modalSearch} onChange={e=>{setModalSearch(e.target.value);setModalSelected(null);}}
                placeholder="Search displays, cameras, speakers, microphones, or control panels"
                style={{flex:1,padding:"9px 14px",background:"rgb(var(--forge-surface))",border:"1px solid rgb(var(--border))",borderRight:"none",borderRadius:"6px 0 0 6px",color:"rgb(var(--text-body))",fontSize:12,outline:"none"}}
              />
              <button style={{padding:"9px 14px",background:"rgb(var(--forge-surface))",border:"1px solid rgb(var(--border))",borderRadius:"0 6px 6px 0",cursor:"pointer",color:"rgb(var(--text-subtle))"}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Search results */}
          {modalSearch.trim() && (
            <div style={{margin:"0 20px",marginBottom:8}}>
              <div style={{display:"flex",gap:6,marginBottom:6}}>
                {([[false,"My Organization's Library"],[true,"AVGenix Library"]] as const).map(([global,label])=>(
                  <button key={label} onClick={()=>{setModalGlobalSearch(global);setModalSelected(null);}}
                    style={{padding:"4px 10px",fontSize:11,fontWeight:600,borderRadius:5,cursor:"pointer",
                      background:modalGlobalSearch===global?"rgba(139,92,246,0.15)":"transparent",
                      border:"1px solid "+(modalGlobalSearch===global?"#8b5cf6":"rgb(var(--border))"),
                      color:modalGlobalSearch===global?"#8b5cf6":"rgb(var(--text-subtle))"}}>
                    {label}
                  </button>
                ))}
              </div>
              <div style={{maxHeight:220,overflowY:"auto",border:"1px solid rgb(var(--border))",borderRadius:6,background:"rgb(var(--forge-surface) / 0.4)"}}>
                {modalLoading ? (
                  <div style={{padding:"14px",textAlign:"center",color:"rgb(var(--text-subtle))",fontSize:12}}>Searching…</div>
                ) : modalResults.length === 0 ? (
                  <div style={{padding:"14px",textAlign:"center",color:"rgb(var(--text-subtle))",fontSize:12}}>No results for &ldquo;{modalSearch}&rdquo;</div>
                ) : modalResults.map((item:any,i:number)=>{
                  const isSel = modalSelected===item;
                  return (
                    <div key={i} onClick={()=>setModalSelected(isSel?null:item)}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",cursor:"pointer",borderBottom:i<modalResults.length-1?"1px solid rgb(var(--border))":"none",background:isSel?"rgba(139,92,246,0.1)":"transparent",transition:"background 0.1s"}}
                      onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background="rgb(var(--forge-surface))"}} onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background="transparent"}}>
                      <div style={{width:8,height:8,borderRadius:2,background:item.color,flexShrink:0}} />
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,color:"rgb(var(--text-body))",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.model && item.mfr && item.mfr !== "Generic" ? `${item.mfr} ${item.model}` : item.type}</div>
                        <div style={{fontSize:10,color:"rgb(var(--text-subtle))"}}>{item.model && item.mfr && item.mfr !== "Generic" ? [item.type, item.cat].filter(Boolean).join(" · ") : (item.mfr||"Generic")+(item.cat?" · "+item.cat:"")}</div>
                      </div>
                      {isSel && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                  );
                })}
              </div>
              {!modalGlobalSearch && !modalLoading && modalResults.length === 0 && (
                <button onClick={()=>setModalGlobalSearch(true)}
                  style={{marginTop:8,width:"100%",padding:"9px 12px",background:"rgb(var(--forge-surface))",border:"1px solid rgb(var(--border))",borderRadius:6,color:"#8b5cf6",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  Search in Global Library
                </button>
              )}
            </div>
          )}

          {/* Or Create New divider */}
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"4px 20px 14px",flexShrink:0}}>
            <div style={{flex:1,height:1,background:"rgb(var(--border))"}} />
            <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",color:"rgb(var(--text-subtle))",textTransform:"uppercase",whiteSpace:"nowrap"}}>Or Create New</span>
            <div style={{flex:1,height:1,background:"rgb(var(--border))"}} />
          </div>

          {/* Manual fields */}
          <div style={{display:"flex",gap:10,padding:"0 20px 18px",flexShrink:0,minWidth:0}}>
            <input value={modalDeviceName} onChange={e=>setModalDeviceName(e.target.value)}
              placeholder="Description"
              style={{flex:2,minWidth:0,padding:"9px 12px",background:"rgb(var(--forge-surface))",border:"1px solid rgb(var(--border))",borderRadius:6,color:"rgb(var(--text-body))",fontSize:12,outline:"none",boxSizing:"border-box"}}
            />
            <input value={modalMake} onChange={e=>setModalMake(e.target.value)}
              placeholder="Make"
              style={{flex:1,minWidth:0,padding:"9px 12px",background:"rgb(var(--forge-surface))",border:"1px solid rgb(var(--border))",borderRadius:6,color:"rgb(var(--text-body))",fontSize:12,outline:"none",boxSizing:"border-box"}}
            />
            <input value={modalModel} onChange={e=>setModalModel(e.target.value)}
              placeholder="Model"
              style={{flex:1,minWidth:0,padding:"9px 12px",background:"rgb(var(--forge-surface))",border:"1px solid rgb(var(--border))",borderRadius:6,color:"rgb(var(--text-body))",fontSize:12,outline:"none",boxSizing:"border-box"}}
            />
          </div>

          {/* Footer */}
          <div style={{padding:"12px 20px",borderTop:"1px solid rgb(var(--border))",display:"flex",justifyContent:"flex-end",gap:10,flexShrink:0}}>
            <button onClick={closeModal}
              style={{padding:"8px 18px",background:"transparent",border:"1px solid rgb(var(--border))",borderRadius:6,color:"rgb(var(--text-body))",fontSize:12,cursor:"pointer"}}>
              Cancel
            </button>
            <button
              disabled={!modalSelected && !modalDeviceName.trim()}
              onClick={replacingDeviceUid!=null ? replaceDeviceFromModal : addFromModal}
              style={{padding:"8px 18px",background:(!modalSelected&&!modalDeviceName.trim())?"rgb(var(--forge-surface))":"#8b5cf6",border:"1px solid "+((!modalSelected&&!modalDeviceName.trim())?"rgb(var(--border))":"#8b5cf6"),borderRadius:6,color:(!modalSelected&&!modalDeviceName.trim())?"rgb(var(--text-subtle))":"#fff",fontSize:12,cursor:(!modalSelected&&!modalDeviceName.trim())?"not-allowed":"pointer",fontWeight:600,transition:"all 0.15s"}}>
              {replacingDeviceUid!=null?"Replace":"+ Add"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Custom Room Confirmation Modal */}
    {showCustomConfirm && (
      <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)"}} onClick={()=>setShowCustomConfirm(false)} />
        <div style={{position:"relative",width:"100%",maxWidth:420,borderRadius:12,border:"1px solid rgb(var(--border))",background:"rgb(var(--forge-bg))",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <div style={{width:36,height:36,borderRadius:8,background:"rgba(245,158,11,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div style={{fontSize:16,fontWeight:600,color:"rgb(var(--text-heading))"}}>Create your own Room?</div>
          </div>
          <p style={{fontSize:13,color:"rgb(var(--text-muted))",lineHeight:1.6,marginBottom:20}}>
            Selecting this option will remove the automatically created plan using site survey information. Do you want to continue?
          </p>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
            <button
              onClick={()=>setShowCustomConfirm(false)}
              style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:500,background:"transparent",border:"1px solid rgb(var(--border))",color:"rgb(var(--text-muted))",cursor:"pointer"}}
            >Cancel</button>
            <button
              onClick={()=>{setShowCustomConfirm(false);setPlacedDevices([]);setPlacedDoors([]);setShowTable(false);setTableDeleted(true);setDeletedChairs(new Set());setRoomSizeMode("custom");setStep(2);}}
              style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:600,background:"#8b5cf6",border:"none",color:"#fff",cursor:"pointer"}}
            >Yes, continue</button>
          </div>
        </div>
      </div>
    )}
    {showSurveyConfirm && (
      <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)"}} onClick={()=>setShowSurveyConfirm(false)} />
        <div style={{position:"relative",width:"100%",maxWidth:420,borderRadius:12,border:"1px solid rgb(var(--border))",background:"rgb(var(--forge-bg))",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <div style={{width:36,height:36,borderRadius:8,background:"rgba(245,158,11,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div style={{fontSize:16,fontWeight:600,color:"rgb(var(--text-heading))"}}>Switch to Site Survey?</div>
          </div>
          <p style={{fontSize:13,color:"rgb(var(--text-muted))",lineHeight:1.6,marginBottom:20}}>
            Switching to Site Survey will remove your custom-drawn room layout. Do you want to continue?
          </p>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
            <button
              onClick={()=>setShowSurveyConfirm(false)}
              style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:500,background:"transparent",border:"1px solid rgb(var(--border))",color:"rgb(var(--text-muted))",cursor:"pointer"}}
            >Cancel</button>
            <button
              onClick={()=>{setShowSurveyConfirm(false);setPlacedDevices(prev => prev.filter(d => d.id !== "wall-partition"));setPlacedDoors([]);setShowTable(false);setTableDeleted(true);setDeletedChairs(new Set());setDeletedWalls(new Set());setRoomSizeMode("survey");setStep(2);}}
              style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:600,background:"#8b5cf6",border:"none",color:"#fff",cursor:"pointer"}}
            >Yes, continue</button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
