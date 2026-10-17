// Shared "Generate from Scope" import, used by both Room Designer and Signal
// Flow so one press populates all three tools with the same units.
//
// The generated units are deliberately GENERIC — no library lookup, no ports.
// A scope line says "a DSP for audio processing", not which DSP, and dressing
// that up as a specific product (or inventing its connectivity) would read as
// a decision that hasn't been made yet. The user picks real equipment later
// via Edit equipment / Replace.
//
// Because there is no product record to read rack_units from, rack
// applicability is inferred from the item itself instead — see
// inferRackUnits below.

import { loadToolData, saveToolData } from "@/lib/tool-data";
import { newItemId, productKeyOf } from "@/lib/design-identity";

export const SCOPE_MANIFEST_TOOL = "shared-scope";

/** Exact wording requested for the re-import confirmation. */
export const SCOPE_REIMPORT_WARNING =
  "objects have been imported from the scope once, doing it again will override the current design, and remove the objects created manually";

export interface ScopeUnit {
  itemId: string;
  productKey: string;
  /** The un-suffixed label — what every unit of this product shares. */
  label: string;
  /** Display name; numbered per unit when the scope asked for several. */
  name: string;
  category: string;
  location: string | null;
  rackUnits: number | null;
  /**
   * Real manufacturer/model, ONLY when the scope text actually named them for
   * this device (see the generate-devices-from-scope prompt) — null when it
   * didn't, so callers can fall back to their own "Generic" placeholder
   * instead of a guessed brand.
   */
  mfr: string | null;
  model: string | null;
  /**
   * Set only by "Generate with AI" (lib/ai-design.ts) when the unit was
   * matched to a real library product — which library and which row, so a
   * tool materialising the unit later can place that product, not a generic.
   */
  productId?: string | null;
  productSource?: "org" | "global" | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  display: "Display",
  camera: "Camera",
  speaker: "Speaker",
  touch_panel: "Touch Panel",
  microphone: "Microphone",
};

/** Human-readable category label for a scope-generated block's header — "other" has no single good label on its own (see lib/signal-flow-types.ts ROLE_LABELS for a more specific one once AI topology has run). */
export function scopeCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || "Equipment";
}

export type ScopeTool = "room-designer" | "signal-flow" | "rack-builder";

export interface ScopeManifest {
  importedAt: number;
  importedBy: ScopeTool;
  units: ScopeUnit[];
  /**
   * Tools that have already turned these units into objects of their own.
   * Materialising is once-per-tool, not "whatever is missing": without this, a
   * unit the user deliberately deleted would be resurrected on the next load.
   */
  materialisedBy: ScopeTool[];
}

/** True when this tool still owes the manifest a first materialisation pass. */
export function needsMaterialising(manifest: ScopeManifest | null, tool: ScopeTool): boolean {
  return !!manifest && !(manifest.materialisedBy || []).includes(tool);
}

export async function markMaterialised(
  manifest: ScopeManifest, tool: ScopeTool,
  roomId?: string | null, projectId?: string | null,
): Promise<void> {
  if ((manifest.materialisedBy || []).includes(tool)) return;
  await saveScopeManifest(
    { ...manifest, materialisedBy: [...(manifest.materialisedBy || []), tool] },
    roomId, projectId,
  );
}

// Back-of-house equipment that belongs in a rack. Matched on the label because
// the AI puts most of it in the catch-all "other" category.
const RACK_PATTERNS: Array<{ re: RegExp; ru: number }> = [
  { re: /\bamplifier|\bamp\b|power amp/i, ru: 2 },
  { re: /\bups\b|uninterruptible/i, ru: 2 },
  { re: /\bdsp\b|audio processor|signal processor/i, ru: 1 },
  { re: /\bcodec\b|video conferenc\w* codec/i, ru: 1 },
  { re: /network switch|\bswitcher\b|\bswitch\b/i, ru: 1 },
  { re: /matrix|scaler|encoder|decoder|streamer|recorder/i, ru: 1 },
  { re: /control processor|controller/i, ru: 1 },
  { re: /power (distribution|conditioner|sequencer)/i, ru: 1 },
  { re: /\breceiver\b|\btuner\b|media player/i, ru: 1 },
];

export function inferRackUnits(label: string, category: string): number | null {
  // Anything with a real place in the room (a display on a wall, a ceiling
  // speaker) is not rack equipment no matter what its name contains — e.g. a
  // "ceiling speaker" must not match the amplifier pattern via "speaker amp".
  if (["display", "camera", "speaker", "touch_panel", "microphone"].includes(category)) return null;
  const hit = RACK_PATTERNS.find(p => p.re.test(label));
  return hit ? hit.ru : null;
}

/**
 * Ask the AI what equipment the scope text describes and expand it into one
 * unit per physical item, each with its own identity.
 */
export async function fetchScopeUnits(scopeText: string): Promise<ScopeUnit[]> {
  const res = await fetch("/api/generate-devices-from-scope", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scopeText }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to generate devices from scope");
  }
  const data = await res.json();
  const items: any[] = Array.isArray(data?.devices) ? data.devices : [];

  const units: ScopeUnit[] = [];
  items.forEach(item => {
    const label = String(item.label || "").trim();
    if (!label) return;
    const category = String(item.category || "other");
    const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? Math.floor(item.quantity) : 1;
    const location = item.location ? String(item.location).trim() || null : null;
    const mfr = item.manufacturer ? String(item.manufacturer).trim() || null : null;
    const model = item.model ? String(item.model).trim() || null : null;
    // One key for the whole run of identical units, derived from the label
    // BEFORE it gets numbered — otherwise four identical displays become four
    // BOM rows of one instead of one row of four.
    const productKey = productKeyOf({ name: label });
    const rackUnits = inferRackUnits(label, category);
    for (let i = 0; i < qty; i++) {
      units.push({
        itemId: newItemId(),
        productKey,
        label,
        name: qty > 1 ? `${label} ${i + 1}` : label,
        category,
        location,
        rackUnits,
        mfr,
        model,
      });
    }
  });
  return units;
}

export async function loadScopeManifest(roomId?: string | null, projectId?: string | null): Promise<ScopeManifest | null> {
  const data = await loadToolData(SCOPE_MANIFEST_TOOL, roomId, projectId);
  if (!data || !Array.isArray((data as any).units)) return null;
  return data as unknown as ScopeManifest;
}

export async function saveScopeManifest(manifest: ScopeManifest, roomId?: string | null, projectId?: string | null): Promise<void> {
  await saveToolData(SCOPE_MANIFEST_TOOL, manifest, roomId, projectId);
}

/** Manifest units that a tool has no object for yet, matched on itemId. */
export function missingUnits(units: ScopeUnit[], existingItemIds: Iterable<string | undefined | null>): ScopeUnit[] {
  const have = new Set<string>();
  for (const id of existingItemIds) if (id) have.add(id);
  return units.filter(u => !have.has(u.itemId));
}

// --- Equipment-only wipe ----------------------------------------------------
// A re-import replaces the equipment but keeps the drawing: room dimensions,
// walls, the table and chairs, annotations, and any wiring between blocks that
// survive. Only things that bill are cleared.

/** Room geometry the wipe must preserve — these are not equipment. */
export function isRoomFurniture(d: any): boolean {
  return d?.type === "furniture" || d?.id === "wall-partition";
}

export function wipeRoomDesignerEquipment(devices: any[]): any[] {
  return (devices || []).filter(isRoomFurniture);
}

/**
 * Flags and power markers are pinned to a block's port by device id — they
 * are part of the equipment's wiring, not free drawing. Device ids restart
 * when equipment is regenerated, so one left behind would silently re-attach
 * to whatever new block reuses that id (a "1" flag that marked a network
 * switch port turning up on a video bar's HDMI-IN).
 */
export function isPortAnchoredAnnotation(a: any): boolean {
  return a?.type === "flag" || a?.type === "power";
}

/**
 * Clears Signal Flow's equipment. Every block goes, so every cable is left
 * dangling and every Location box is left empty — both are cleared with them
 * rather than rendering as lines into empty space and stray labelled frames.
 * Free annotations (text, shapes, highlights) are kept; port-anchored ones go
 * with the equipment they point at (see isPortAnchoredAnnotation).
 */
export function wipeSignalFlowEquipment(annotations: any[] = []): { devices: any[]; connections: any[]; rooms: any[]; hiddenDevices: any[]; annotations: any[] } {
  // Hidden blocks are equipment too — a re-import replaces them as well.
  return { devices: [], connections: [], rooms: [], hiddenDevices: [], annotations: (annotations || []).filter((a) => !isPortAnchoredAnnotation(a)) };
}
