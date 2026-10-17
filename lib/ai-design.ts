// "Generate with AI" — the guided alternative to "Generate from Scope".
//
// Generate from Scope turns the scope text straight into generic units. This
// flow interviews the integrator first, in rounds where each round builds on
// the previous answers (brand preferences, AVoIP vs fixed switching, audio
// approach — only what the scope leaves open; or, with no scope at all, the
// room, its size and the desired outcome first). It then designs the full
// equipment list and picks real products from the org's Equipment Library or
// the AVGenix Library where they genuinely match. Anything without a match,
// or answered "decide later", stays generic.
//
// The resulting units are ordinary ScopeUnits (same identity scheme as the
// scope import, so the BOM and the other tools recognise them) with the
// chosen library product attached.
//
// Each completed design is recorded per org (ai_design_history) and folded
// into later sessions as "team preferences" — which brands get chosen, which
// products get kept or turned down. That's deliberately invisible in the UI.

import { supabase } from "@/lib/supabase";
import { getFilterOptions } from "@/lib/av-products";
import { newItemId, productKeyOf } from "@/lib/design-identity";
import { inferRackUnits, type ScopeUnit } from "@/lib/scope-manifest";

export const GENERIC_ANSWER = "Generic — I'll decide later";

export interface DesignQuestion {
  id: string;
  topic: string;
  question: string;
  why: string;
  inputType: "choice" | "text";
  placeholder: string;
  options: { label: string; detail: string }[];
}

export interface DesignRoom {
  type: string | null;
  lengthFt: number | null;
  widthFt: number | null;
  heightFt: number | null;
  seats: number | null;
}

export interface DesignRound {
  done: boolean;
  summary: string;
  questions: DesignQuestion[];
  /** A Scope of Work written from the interview — only when there was none. */
  brief: string;
  room: DesignRoom | null;
}

export interface DesignAnswer {
  id: string;
  topic: string;
  question: string;
  answer: string;
  inputType: "choice" | "text";
}

/**
 * A library product in the AVGenix Library (av_products) field shape —
 * Equipment Library rows are mapped onto it so both tools can treat a pick
 * the same way their own library pickers already do.
 */
export interface LibraryProduct {
  source: "org" | "global";
  id: string;
  manufacturer: string;
  model_name: string;
  type: string;
  category: string;
  price: number;
  part_number: string | null;
  color: string | null;
  ports: Array<{ side: string; signal: string; dir: string; label: string; connector?: string }>;
  [key: string]: any;
}

export interface AIDesignUnit extends ScopeUnit {
  product: LibraryProduct | null;
  /** Brand the user asked for when no library product of it matched. */
  preferredBrand: string | null;
  reason: string;
}

interface CatalogEntry {
  ref: string;
  manufacturer: string;
  model: string;
  category: string;
  description: string;
}

/** This room's Scope of Work (and the rest of its Site Survey record). */
export async function loadRoomScope(projectId: string, roomId: string): Promise<{ scopeText: string; surveyRoomData: Record<string, string> | null; roomName: string }> {
  const { data: survey, error } = await supabase
    .from("site_surveys")
    .select("data")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  for (const b of (survey?.data?.buildings || []) as any[]) {
    const room = (b.rooms || []).find((r: any) => r.id === roomId);
    if (room) return { scopeText: room.data?.scope_of_work || "", surveyRoomData: room.data || {}, roomName: room.name || "" };
  }
  return { scopeText: "", surveyRoomData: null, roomName: "" };
}

const feetOf = (data: Record<string, string>, ftKey: string, inKey: string): number | null => {
  const ft = parseFloat(data[ftKey] || ""), inch = parseFloat(data[inKey] || "");
  const total = (Number.isFinite(ft) ? ft : 0) + (Number.isFinite(inch) ? inch : 0) / 12;
  return total > 0 ? Math.round(total * 10) / 10 : null;
};

/** What Site Survey already knows about the room, for the interviewer not to re-ask. */
export function describeRoomFacts(roomName: string, data: Record<string, string> | null): string {
  const facts: string[] = [];
  if (roomName) facts.push(`room name "${roomName}"`);
  if (data?.room_purpose) facts.push(`purpose: ${data.room_purpose}`);
  if (data) {
    const l = feetOf(data, "room_length", "room_length_in"), w = feetOf(data, "room_width", "room_width_in"), h = feetOf(data, "room_height", "room_height_in");
    if (l && w) facts.push(`size: ${l} ft long x ${w} ft wide${h ? ` x ${h} ft high` : ""}`);
    if (data.room_notes) facts.push(`notes: ${String(data.room_notes).slice(0, 300)}`);
  }
  return facts.join("; ");
}

/** Every manufacturer in the org's Equipment Library and the AVGenix Library. */
export async function loadLibraryBrands(orgId: string | null | undefined): Promise<string[]> {
  const [org, global] = await Promise.all([
    orgId
      ? supabase.from("equipment_library").select("manufacturer").eq("org_id", orgId).then(({ data }) => (data || []).map((r: any) => r.manufacturer))
      : Promise.resolve([] as string[]),
    getFilterOptions().then((o) => o.manufacturers).catch(() => [] as string[]),
  ]);
  const byKey = new Map<string, string>();
  for (const m of [...org, ...global]) {
    const name = String(m || "").trim();
    if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}

/** The next interview round, given everything answered so far. */
export async function fetchNextRound(opts: {
  scopeText: string;
  roomFacts: string;
  history: DesignAnswer[];
  libraryBrands: string[];
  experience: string;
  round: number;
}): Promise<DesignRound> {
  const res = await fetch("/api/ai-design/next", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to prepare the next questions");
  return {
    done: !!data.done,
    summary: data.summary || "",
    questions: Array.isArray(data.questions) ? data.questions : [],
    brief: data.brief || "",
    room: data.room || null,
  };
}

/** Plain-text requirements from the answers, when no written brief exists. */
export function answersAsBrief(answers: DesignAnswer[]): string {
  return "Requirements gathered with Generate with AI:\n" + answers.map((a) => `- ${a.question} ${a.answer}`).join("\n");
}

/**
 * Write an interview's outcome back to Site Survey: the brief becomes the
 * room's Scope of Work (only if it has none), and room purpose / dimensions
 * fill fields that are still empty. Never overwrites what's there.
 */
export async function saveBriefToSurvey(projectId: string, roomId: string, brief: string, room: DesignRoom | null): Promise<void> {
  const { data: row, error } = await supabase.from("site_surveys").select("data").eq("project_id", projectId).maybeSingle();
  if (error || !row?.data) return;
  const split = (ft: number | null) => (ft && ft > 0 ? { ft: String(Math.floor(ft)), in: String(Math.round((ft - Math.floor(ft)) * 12)) } : null);
  let changed = false;
  const buildings = (row.data.buildings || []).map((b: any) => ({
    ...b,
    rooms: (b.rooms || []).map((r: any) => {
      if (r.id !== roomId) return r;
      const d = { ...(r.data || {}) };
      const setIfEmpty = (key: string, value: string | null | undefined) => {
        if (value && !String(d[key] || "").trim()) { d[key] = value; changed = true; }
      };
      setIfEmpty("scope_of_work", brief);
      const dims: Array<[string, string, number | null]> = [
        ["room_length", "room_length_in", room?.lengthFt ?? null],
        ["room_width", "room_width_in", room?.widthFt ?? null],
        ["room_height", "room_height_in", room?.heightFt ?? null],
      ];
      for (const [ftKey, inKey, value] of dims) {
        const s = split(value);
        if (s && !String(d[ftKey] || "").trim()) { d[ftKey] = s.ft; d[inKey] = s.in; changed = true; }
      }
      return { ...r, data: d };
    }),
  }));
  if (changed) await supabase.from("site_surveys").update({ data: { ...row.data, buildings } }).eq("project_id", projectId);
}

// --- Learning from past designs ---------------------------------------------

const productName = (p: { manufacturer?: string; model?: string } | null | undefined) =>
  p ? `${p.manufacturer || ""} ${p.model || ""}`.trim() : "";

const tally = (map: Map<string, Map<string, number>>, key: string, value: string) => {
  if (!key || !value) return;
  const inner = map.get(key) || new Map<string, number>();
  inner.set(value, (inner.get(value) || 0) + 1);
  map.set(key, inner);
};

const topOf = (inner: Map<string, number>, n = 3) =>
  Array.from(inner.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([v, c]) => `${v} ×${c}`).join(", ");

/**
 * A short summary of what this org has chosen in past AI designs — which
 * answers it gives per topic, which products it keeps for each kind of
 * device, and which suggestions it turns down. Empty when there's no history
 * (or the table isn't there yet); never throws.
 */
export async function loadDesignExperience(orgId: string | null | undefined): Promise<string> {
  if (!orgId) return "";
  try {
    const { data, error } = await supabase
      .from("ai_design_history")
      .select("room, answers, selections")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error || !data?.length) return "";

    const roomTypes = new Map<string, number>();
    const answers = new Map<string, Map<string, number>>();
    const kept = new Map<string, Map<string, number>>();
    const rejected = new Map<string, number>();
    for (const row of data as any[]) {
      const type = row.room?.type ? String(row.room.type) : "";
      if (type) roomTypes.set(type, (roomTypes.get(type) || 0) + 1);
      for (const a of (row.answers || []) as any[]) {
        if (a.inputType === "text" || !a.answer || a.answer === GENERIC_ANSWER) continue;
        tally(answers, String(a.topic || "other"), String(a.answer));
      }
      for (const s of (row.selections || []) as any[]) {
        if (s.product) tally(kept, String(s.label || s.category || ""), productName(s.product));
        const r = productName(s.rejected);
        if (r) rejected.set(r, (rejected.get(r) || 0) + 1);
      }
    }

    const lines: string[] = [];
    if (roomTypes.size) lines.push(`Room types designed: ${topOf(roomTypes, 5)}`);
    answers.forEach((inner, topic) => lines.push(`Usually chooses for ${topic}: ${topOf(inner)}`));
    Array.from(kept.entries()).slice(0, 20).forEach(([label, inner]) => lines.push(`Usually keeps for "${label}": ${topOf(inner)}`));
    if (rejected.size) lines.push(`Usually turns down: ${topOf(rejected, 8)}`);
    return lines.join("\n");
  } catch {
    return "";
  }
}

/** Record a completed design for future sessions. Best-effort; never throws. */
export async function recordDesignSession(opts: {
  orgId: string | null | undefined;
  projectId: string;
  roomId: string;
  mode: "scope" | "interview";
  room: DesignRoom | null;
  answers: DesignAnswer[];
  suggested: AIDesignUnit[];
  final: AIDesignUnit[];
}): Promise<void> {
  if (!opts.orgId) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const suggestedById = new Map(opts.suggested.map((u) => [u.itemId, u]));
    const groups = new Map<string, any>();
    for (const u of opts.final) {
      const key = `${u.location || ""}|${u.label}|${u.productKey}`;
      if (groups.has(key)) { groups.get(key).quantity++; continue; }
      const before = suggestedById.get(u.itemId);
      const asRef = (p: LibraryProduct | null | undefined) => (p ? { source: p.source, id: p.id, manufacturer: p.manufacturer, model: p.model_name } : null);
      groups.set(key, {
        label: u.label, category: u.category, location: u.location, quantity: 1,
        product: asRef(u.product),
        rejected: !u.product && before?.product ? asRef(before.product) : null,
      });
    }
    await supabase.from("ai_design_history").insert({
      org_id: opts.orgId,
      user_id: user.id,
      project_id: opts.projectId,
      room_id: opts.roomId,
      mode: opts.mode,
      room: opts.room || {},
      answers: opts.answers.map(({ topic, question, answer, inputType }) => ({ topic, question, answer, inputType })),
      selections: Array.from(groups.values()),
    });
  } catch {
    // Learning is a nice-to-have; a failed write must never block the design.
  }
}

const orgRowToProduct = (p: any): LibraryProduct => ({
  ...p,
  source: "org",
  id: p.id,
  manufacturer: p.manufacturer,
  model_name: p.model,
  type: p.description || p.model,
  category: p.category,
  price: p.unit_cost ?? 0,
  part_number: p.part_number ?? null,
  color: p.color ?? null,
  ports: p.ports || [],
});

const globalRowToProduct = (p: any): LibraryProduct => ({ ...p, source: "global", ports: p.ports || [] });

/**
 * The products the planner may choose from: the org's own library (all of it
 * when small, otherwise just the chosen brands), plus the chosen brands from
 * the AVGenix Library. A brand counts as chosen when an answer or the scope
 * names it.
 */
async function buildCatalog(orgId: string | null | undefined, chosenText: string[], libraryBrands: string[]) {
  const haystack = chosenText.join(" \n ").toLowerCase();
  // Whole-word match, so a short brand ("LG") isn't found inside another word.
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chosenBrands = libraryBrands.filter((b) => b.length >= 2 && new RegExp(`(^|[^a-z0-9])${escape(b.toLowerCase())}($|[^a-z0-9])`).test(haystack));

  const products: LibraryProduct[] = [];
  if (orgId) {
    const { data } = await supabase.from("equipment_library").select("*").eq("org_id", orgId).limit(1000);
    let rows = data || [];
    if (rows.length > 400) {
      const keep = new Set(chosenBrands.map((b) => b.toLowerCase()));
      rows = rows.filter((r: any) => keep.has(String(r.manufacturer || "").toLowerCase()));
    }
    products.push(...rows.map(orgRowToProduct));
  }
  if (chosenBrands.length) {
    const { data } = await supabase.from("av_products").select("*").in("manufacturer", chosenBrands).limit(500);
    products.push(...(data || []).filter((p: any) => !(p.kit_items && p.kit_items.length)).map(globalRowToProduct));
  }

  const byRef = new Map<string, LibraryProduct>();
  const catalog: CatalogEntry[] = products.map((p) => {
    const ref = `${p.source === "org" ? "o" : "g"}:${p.id}`;
    byRef.set(ref, p);
    return { ref, manufacturer: p.manufacturer, model: p.model_name, category: p.category || "", description: p.type || "" };
  });
  return { catalog, byRef };
}

/** Design the room from the scope + answers, and expand it into units. */
export async function generateDesignUnits(opts: {
  scopeText: string;
  answers: DesignAnswer[];
  libraryBrands: string[];
  orgId: string | null | undefined;
  experience: string;
}): Promise<AIDesignUnit[]> {
  // Brands named anywhere — answers, the scope, or the team's usual picks —
  // decide which AVGenix Library products are offered to the planner.
  const chosenText = [
    ...opts.answers.filter((a) => a.answer !== GENERIC_ANSWER).map((a) => a.answer),
    opts.scopeText,
    opts.experience,
  ];
  const { catalog, byRef } = await buildCatalog(opts.orgId, chosenText, opts.libraryBrands);

  const res = await fetch("/api/ai-design/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scopeText: opts.scopeText,
      answers: opts.answers.map((a) => ({ question: a.question, answer: a.answer })),
      catalog,
      experience: opts.experience,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to generate the design");

  const units: AIDesignUnit[] = [];
  for (const d of (Array.isArray(data.devices) ? data.devices : []) as any[]) {
    const product = d.productRef ? byRef.get(d.productRef) || null : null;
    const label = String(d.label || "").trim();
    if (!label) continue;
    const qty = Number.isFinite(d.quantity) && d.quantity > 0 ? Math.floor(d.quantity) : 1;
    // Same keying as the scope import: one key per run of identical units
    // (a library product's own id when there is one), so four identical
    // displays stay one BOM row of four.
    const productKey = product ? `p:${product.id}` : productKeyOf({ name: label });
    const rackUnits = product?.rack_units ?? inferRackUnits(label, d.category);
    for (let i = 0; i < qty; i++) {
      units.push({
        itemId: newItemId(),
        productKey,
        label,
        name: qty > 1 ? `${label} ${i + 1}` : label,
        category: d.category,
        location: d.location || null,
        rackUnits: rackUnits ?? null,
        mfr: product?.manufacturer ?? null,
        model: product?.model_name ?? null,
        productId: product?.id ?? null,
        productSource: product?.source ?? null,
        product,
        preferredBrand: product ? null : d.preferredBrand || null,
        reason: d.reason || "",
      });
    }
  }
  return units;
}

/**
 * The library products behind manifest units matched by Generate with AI,
 * keyed by product id — for a tool materialising those units later.
 */
export async function loadUnitProducts(units: ScopeUnit[]): Promise<Map<string, LibraryProduct>> {
  const orgIds = units.filter((u) => u.productId && u.productSource === "org").map((u) => u.productId!);
  const globalIds = units.filter((u) => u.productId && u.productSource === "global").map((u) => u.productId!);
  const [org, global] = await Promise.all([
    orgIds.length ? supabase.from("equipment_library").select("*").in("id", Array.from(new Set(orgIds))).then(({ data }) => data || []) : Promise.resolve([]),
    globalIds.length ? supabase.from("av_products").select("*").in("id", Array.from(new Set(globalIds))).then(({ data }) => data || []) : Promise.resolve([]),
  ]);
  const map = new Map<string, LibraryProduct>();
  org.forEach((p: any) => map.set(p.id, orgRowToProduct(p)));
  global.forEach((p: any) => map.set(p.id, globalRowToProduct(p)));
  return map;
}

/** Drop the library pick from a unit (the review step's "use generic"). */
export function makeGeneric(unit: AIDesignUnit): AIDesignUnit {
  return { ...unit, product: null, mfr: null, model: null, productId: null, productSource: null, productKey: productKeyOf({ name: unit.label }), rackUnits: inferRackUnits(unit.label, unit.category) };
}
