'use client';
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadToolData, saveToolData } from '@/lib/tool-data';
import { supabase } from '@/lib/supabase';
import {
  displayNameOf, productKeyOf, meaningfulMfr, meaningfulModel,
  ensureRoomDeviceItemIds, ensureSignalFlowItemIds, ensureRackItemIds,
} from '@/lib/design-identity';
import { loadUnitSpecs, saveUnitSpecs, applySpecToBOMEntry, type UnitSpec } from '@/lib/unit-specs';
import { loadScopeManifest, needsMaterialising, missingUnits, type ScopeUnit } from '@/lib/scope-manifest';
import { retireUnitsInStores } from '@/lib/unit-sync';

export type BOMSource = 'signal-flow' | 'room-designer' | 'rack-builder';

/** tool_data keys differ from the BOM's own source ids — never derive one from the other. */
const STORE_KEY: Record<Exclude<BOMSource, 'room-designer'>, string> = {
  'signal-flow': 'signal-flow',
  'rack-builder': 'rack-planner',
};

export interface BOMDeviceEntry {
  /** Cross-tool unit identity. One itemId === one physical unit. */
  itemId?: string;
  /** What the BOM groups rows by. Stamped at creation, never parsed from the name. */
  productKey?: string;
  name: string;
  mfr?: string;
  /** The model as recorded on the unit ("" / "—" placeholders included). */
  model?: string;
  /** The free-text description (a generic unit's descriptive name). */
  description?: string;
  cat?: string;
  listPrice?: number;
  partNumber?: string;
  /**
   * The unit exists in this tool but is hidden from its view. It still counts
   * toward the BOM (it is still bought) but carries no tag for this tool.
   */
  hidden?: boolean;
}

/** Drag payload type: a BOM row dragged onto a tool's canvas carries one unit (JSON, see BOMDragUnit). */
export const BOM_UNIT_DRAG_TYPE = 'application/x-avgenix-bom-unit';

/** One unit of a BOM row, as carried by a drag from the BOM panel onto a tool's canvas. */
export interface BOMDragUnit {
  itemId: string;
  productKey: string;
  name: string;
  mfr?: string;
  model?: string;
  cat?: string;
}

/** What a tool currently has hidden, for the "Hidden here" list in the BOM panel. */
export interface HiddenUnitsRegistration {
  source: BOMSource;
  items: Array<{ itemId: string; name: string }>;
  show: (itemId: string) => void;
}

export interface BOMLineItem {
  /** Stable row identity — the product key, also the price-override key. */
  key: string;
  name: string;
  /** Manufacturer as shown: the real one, or "Generic". */
  make: string;
  /** Model as shown: the real one, or — for generic equipment — its device type ("Ceiling Speaker"). */
  model: string;
  mfr: string;
  cat: string;
  listPrice: number;
  /** Distinct physical units, NOT the number of places they show up. */
  qty: number;
  sources: BOMSource[];
  partNumber?: string;
  /** The units making up this row. */
  itemIds: string[];
  /** Each unit's own display name (a scope import numbers them: "Ceiling Speaker 1", "… 2"). */
  unitNames: Record<string, string>;
  /** Which of those units each tool currently shows — drives drag-from-BOM gating. */
  placement: Record<BOMSource, string[]>;
}

interface BOMContextType {
  prices: Record<string, number>;
  collapsed: boolean;
  bomItems: BOMLineItem[];
  totalQty: number;
  totalCost: number;
  updateSlice: (source: BOMSource, devices: BOMDeviceEntry[]) => void;
  /**
   * Re-read the saved state of every tool (and the scope import) from the DB.
   * For a tool that just rewrote ANOTHER tool's saved data — a scope import
   * wipes Signal Flow and the rack — so this BOM stops showing what they held
   * before. The calling tool's own live slice (`caller`) is left alone.
   */
  reloadBaseline: (caller: BOMSource) => Promise<void>;
  /**
   * A tool deleted these units: drop them from every tool's saved data, the
   * scope import record and this BOM. `caller` is the tool that deleted them —
   * it is open, owns its own store, and is left alone.
   */
  retireUnits: (itemIds: string[], caller: BOMSource) => void;
  /**
   * A tool edited or replaced a unit: record its new make / model / price / specs
   * so the other tools show the same when they open, and patch this BOM now.
   */
  updateUnitSpec: (itemId: string, spec: UnitSpec) => void;
  /** Several at once (one save): a tool sharing real products it already holds. */
  updateUnitSpecs: (entries: Array<[string, UnitSpec]>) => void;
  /** What the open tool currently has hidden (null when nothing is registered). */
  hiddenUnits: HiddenUnitsRegistration | null;
  registerHidden: (reg: HiddenUnitsRegistration | null) => void;
  setPrice: (key: string, price: number) => void;
  setCollapsed: (v: boolean) => void;
  unitPriceOf: (item: BOMLineItem) => number;
}

const BOMContext = createContext<BOMContextType | null>(null);

const SOURCES: BOMSource[] = ['signal-flow', 'room-designer', 'rack-builder'];

// --- Store → BOM entry mappers ---------------------------------------------
// Shared by the pages (for their live slices) and by the provider (for the
// baseline it loads itself), so a unit is described identically either way.

/** Walls and furniture are room geometry, not equipment — they never bill. */
export function roomDeviceToBOM(d: any): BOMDeviceEntry | null {
  if (!d || d.type === 'furniture' || d.id === 'wall-partition') return null;
  return {
    itemId: d.itemId,
    productKey: productKeyOf(d),
    name: displayNameOf(d),
    mfr: d.mfr || undefined,
    model: d.model || undefined,
    description: d.name || undefined,
    cat: d.cat || d.type || undefined,
    listPrice: d.price || 0,
    partNumber: d.part_number || undefined,
  };
}

export function signalFlowDeviceToBOM(d: any): BOMDeviceEntry {
  return {
    itemId: d.itemId,
    productKey: productKeyOf(d),
    name: displayNameOf(d),
    mfr: d.mfr || undefined,
    model: d.model || undefined,
    description: d.type || undefined,
    cat: d.cat || d.category || '',
    listPrice: d.price || 0,
    partNumber: d.part_number || undefined,
  };
}

export function rackItemToBOM(i: any): BOMDeviceEntry {
  return {
    itemId: i.itemId,
    productKey: productKeyOf(i),
    name: i.name || displayNameOf(i),
    mfr: i.mfr || undefined,
    model: i.model || undefined,
    description: i.notes || undefined,
    cat: i.cat || 'Rack Equipment',
    listPrice: i.price || 0,
    partNumber: i.partNumber || undefined,
  };
}

/**
 * A unit from a scope import that Signal Flow hasn't turned into a block yet.
 * Described exactly the way that block will be (same generic maker + model
 * naming Signal Flow uses when it materialises it), so the BOM row doesn't
 * change when the block does appear.
 */
function pendingScopeUnitToBOM(u: ScopeUnit): BOMDeviceEntry {
  return signalFlowDeviceToBOM({
    itemId: u.itemId, productKey: u.productKey, mfr: u.mfr || 'Generic', model: u.model || u.name,
    type: '', cat: u.category, price: 0,
  });
}

export function BOMProvider({ children }: { children: React.ReactNode }) {
  // null means "this tool has not reported in this session" — its DB baseline
  // is used instead. An empty array is a real answer (the room was emptied)
  // and must win over the baseline, which is why this is not `[]`-initialised.
  const [slices, setSlices] = useState<Record<BOMSource, BOMDeviceEntry[] | null>>({
    'signal-flow': null, 'room-designer': null, 'rack-builder': null,
  });
  const [baseline, setBaseline] = useState<Record<BOMSource, BOMDeviceEntry[]>>({
    'signal-flow': [], 'room-designer': [], 'rack-builder': [],
  });
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [pricesLoadedFor, setPricesLoadedFor] = useState<string | null>(null);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  const searchParams = useSearchParams();
  const projectId = searchParams.get('project');
  const roomId = searchParams.get('room') || 'default';
  const scope = projectId ? `${projectId}:${roomId}` : null;

  // Price overrides are per room, so they must reload when the room changes —
  // loading once on mount let one room's prices follow the user into the next
  // and then overwrite that room's saved row.
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    setPricesLoadedFor(null);
    loadToolData('shared-bom', roomId, projectId).then(data => {
      if (cancelled) return;
      setPrices((data?.prices as Record<string, number>) || {});
      setPricesLoadedFor(scope);
    });
    return () => { cancelled = true; };
  }, [scope, projectId, roomId]);

  useEffect(() => {
    if (!scope || pricesLoadedFor !== scope) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveToolData('shared-bom', { prices }, roomId, projectId);
    }, 1000);
  }, [prices, scope, pricesLoadedFor, projectId, roomId]);

  // Read all three stores directly, so every tool page shows the same BOM even
  // on a hard refresh. Without this the panel only ever knew about whichever
  // tools the user had visited in this session.
  const loadBaseline = useCallback(async (): Promise<Record<BOMSource, BOMDeviceEntry[]> | null> => {
    if (!projectId) return null;
    const [sf, rack, roomRow, manifest, specs] = await Promise.all([
      loadToolData(STORE_KEY['signal-flow'], roomId, projectId),
      loadToolData(STORE_KEY['rack-builder'], roomId, projectId),
      supabase.from('room_designs').select('data')
        .eq('project_id', projectId).eq('room_id', roomId).maybeSingle(),
      loadScopeManifest(roomId, projectId),
      loadUnitSpecs(roomId, projectId),
    ]);
    // A unit edited or replaced in any tool carries that change into every copy.
    const withSpec = (e: BOMDeviceEntry): BOMDeviceEntry => (e.itemId && specs[e.itemId] ? applySpecToBOMEntry(e, specs[e.itemId]) : e);
    const sfDevices = ensureSignalFlowItemIds((sf?.devices as any[]) || []).items;
    const rackItems = ensureRackItemIds((rack?.items as any[]) || [], sfDevices).items;
    const roomDesign = (roomRow as any)?.data?.data;
    const roomDevices = ensureRoomDeviceItemIds((roomDesign?.devices as any[]) || []).items;
    // Units a tool has hidden stay in that tool's saved data (so nothing
    // re-adds them) but not in its view: they count toward the BOM, without
    // that tool's tag.
    const sfHidden = ensureSignalFlowItemIds((sf?.hiddenDevices as any[]) || []).items;
    const roomHidden = ensureRoomDeviceItemIds((roomDesign?.config?.hiddenDevices as any[]) || []).items;
    const rackHidden = ensureRackItemIds((rack?.hiddenItems as any[]) || [], sfDevices).items;
    // Signal Flow only turns a scope import into blocks of its own when its
    // page is opened. Until then those units exist in the BOM's eyes only
    // under Room Designer — so a fresh import showed a "ROOM"-only tag, and
    // "SIG" only appeared after a visit to Signal Flow. They are Signal Flow's
    // units too from the moment of the import, so count them there up front.
    const pendingInSignalFlow = needsMaterialising(manifest, 'signal-flow')
      ? missingUnits(manifest!.units, [...sfDevices, ...sfHidden].map((d: any) => d.itemId))
      : [];
    return {
      'signal-flow': [
        ...sfDevices.map(signalFlowDeviceToBOM),
        ...sfHidden.map(d => ({ ...signalFlowDeviceToBOM(d), hidden: true })),
        ...pendingInSignalFlow.map(pendingScopeUnitToBOM),
      ].map(withSpec),
      'room-designer': [
        ...(roomDevices.map(roomDeviceToBOM).filter(Boolean) as BOMDeviceEntry[]),
        ...(roomHidden.map(roomDeviceToBOM).filter(Boolean) as BOMDeviceEntry[]).map(e => ({ ...e, hidden: true })),
      ].map(withSpec),
      'rack-builder': [
        ...rackItems.map(rackItemToBOM),
        ...rackHidden.map(i => ({ ...rackItemToBOM(i), hidden: true })),
      ].map(withSpec),
    };
  }, [projectId, roomId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setSlices({ 'signal-flow': null, 'room-designer': null, 'rack-builder': null });
    loadBaseline().then(b => { if (!cancelled && b) setBaseline(b); });
    return () => { cancelled = true; };
  }, [projectId, roomId, loadBaseline]);

  // The tool that is open says what it has hidden; the BOM panel lists it so
  // the user can bring a hidden unit back.
  const [hiddenUnits, setHiddenUnits] = useState<HiddenUnitsRegistration | null>(null);
  const registerHidden = useCallback((reg: HiddenUnitsRegistration | null) => setHiddenUnits(reg), []);

  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const reloadBaseline = useCallback(async (caller: BOMSource) => {
    const startedFor = scopeRef.current;
    const b = await loadBaseline();
    if (!b || scopeRef.current !== startedFor) return; // user moved to another room meanwhile
    setBaseline(b);
    // The other tools' slices held their pre-import contents; the saved copy
    // is now the truth until those tools report in again. The calling tool's
    // own live slice is kept — its save may not have landed yet.
    setSlices(prev => {
      const next = { ...prev };
      SOURCES.forEach(s => { if (s !== caller) next[s] = null; });
      return next;
    });
  }, [loadBaseline]);

  const updateSlice = useCallback((source: BOMSource, devices: BOMDeviceEntry[]) => {
    setSlices(prev => ({ ...prev, [source]: devices }));
  }, []);

  const retireUnits = useCallback((itemIds: string[], caller: BOMSource) => {
    const ids = new Set(itemIds.filter(Boolean));
    if (!ids.size) return;
    const drop = (list: BOMDeviceEntry[]) => list.filter(d => !(d.itemId && ids.has(d.itemId)));
    setBaseline(prev => ({
      'signal-flow': drop(prev['signal-flow']),
      'room-designer': drop(prev['room-designer']),
      'rack-builder': drop(prev['rack-builder']),
    }));
    setSlices(prev => {
      const next = { ...prev };
      SOURCES.forEach(s => { const list = prev[s]; if (list) next[s] = drop(list); });
      return next;
    });
    if (projectId) {
      retireUnitsInStores(itemIds, caller, roomId, projectId)
        .catch(err => console.error('Failed to remove deleted units from the other tools:', err));
    }
  }, [projectId, roomId]);

  const updateUnitSpecs = useCallback((entries: Array<[string, UnitSpec]>) => {
    const byId = new Map(entries.filter(([id]) => !!id));
    if (byId.size === 0) return;
    // Every tool's copy of these units, in this BOM, right now; the tools that aren't
    // open pick the change up from the shared record when they load.
    const patch = (list: BOMDeviceEntry[]) => list.map(e => {
      const spec = e.itemId ? byId.get(e.itemId) : undefined;
      return spec ? applySpecToBOMEntry(e, spec) : e;
    });
    setBaseline(prev => ({
      'signal-flow': patch(prev['signal-flow']),
      'room-designer': patch(prev['room-designer']),
      'rack-builder': patch(prev['rack-builder']),
    }));
    setSlices(prev => {
      const next = { ...prev };
      SOURCES.forEach(s => { const list = prev[s]; if (list) next[s] = patch(list); });
      return next;
    });
    if (projectId) {
      saveUnitSpecs(Array.from(byId.entries()), roomId, projectId)
        .catch(err => console.error('Failed to record the unit change for the other tools:', err));
    }
  }, [projectId, roomId]);
  const updateUnitSpec = useCallback((itemId: string, spec: UnitSpec) => updateUnitSpecs([[itemId, spec]]), [updateUnitSpecs]);

  const setPrice = useCallback((key: string, price: number) => {
    setPrices(prev => ({ ...prev, [key]: price }));
  }, []);

  // --- Aggregate -----------------------------------------------------------
  // Count units, not appearances: the same display shown in Room Designer,
  // Signal Flow and the rack is one thing the customer buys, carrying three
  // location chips — not three line items.
  const units = new Map<string, { entry: BOMDeviceEntry; sources: Set<BOMSource> }>();
  SOURCES.forEach(source => {
    const list = slices[source] ?? baseline[source] ?? [];
    list.forEach((d, i) => {
      // Pre-identity saves may still lack an itemId; key those per occurrence
      // so they behave as they did before rather than silently collapsing.
      const id = d.itemId || `anon:${source}:${i}:${d.name}`;
      const existing = units.get(id);
      if (existing) {
        // The tools can hold different versions of one unit (a swap made in one
        // before the others were told). The BOM shows the real product, not
        // whichever tool it happened to read first.
        const isReal = (e: BOMDeviceEntry) => !!(meaningfulMfr(e.mfr) || String(e.productKey ?? '').startsWith('p:'));
        if (!isReal(existing.entry) && isReal(d)) existing.entry = { ...d };
        // A hidden copy still proves the unit exists, but earns no tag.
        if (!d.hidden) existing.sources.add(source);
        // First writer wins on the detail fields (SOURCES order puts the
        // richest, Signal Flow, first), but let a later source fill a gap.
        if (!existing.entry.mfr && d.mfr) existing.entry.mfr = d.mfr;
        if (!existing.entry.model && d.model) existing.entry.model = d.model;
        if (!existing.entry.description && d.description) existing.entry.description = d.description;
        if (!existing.entry.partNumber && d.partNumber) existing.entry.partNumber = d.partNumber;
        if (!existing.entry.listPrice && d.listPrice) existing.entry.listPrice = d.listPrice;
        if (!existing.entry.cat && d.cat) existing.entry.cat = d.cat;
      } else {
        units.set(id, { entry: { ...d }, sources: new Set(d.hidden ? [] : [source]) });
      }
    });
  });

  const rows = new Map<string, BOMLineItem>();
  // The product key (first one to use it) that each row's price override hangs on.
  const keyOwner = new Map<string, string>();
  units.forEach(({ entry, sources }, id) => {
    const key = entry.productKey || productKeyOf({ name: entry.name, mfr: entry.mfr });
    // Make / Model as a BOM reads them. A real product shows its own. Generic
    // equipment (a scope import, a catalog placeholder) is "Generic" + its
    // device type: rows of that kind are grouped by name, so the numbering the
    // tools add per unit ("Ceiling Speaker 1", "... 2") is dropped - the row IS
    // "Ceiling Speaker".
    const make = meaningfulMfr(entry.mfr) || 'Generic';
    const rawModel = meaningfulModel(entry.model) || entry.description || entry.name;
    const model = key.startsWith('n:') ? rawModel.replace(/\s+\d+$/, '') : rawModel;
    // Units share a row when they are the same product AND read the same. The
    // product key alone isn't enough: a unit whose Model was retyped by hand
    // keeps the key of the library product it started from, and would be
    // swallowed by a genuine unit of that product (a 110" display and a 98"
    // display both keyed as the 98", shown as "110" Display x2").
    const groupId = key + '' + make.toLowerCase() + '' + model.toLowerCase();
    let row = rows.get(groupId);
    if (!row) {
      const owner = keyOwner.get(key);
      const rowKey = owner === undefined || owner === groupId ? key : key + '#' + model;
      if (owner === undefined) keyOwner.set(key, groupId);
      row = {
        key: rowKey, name: entry.name, make, model, mfr: entry.mfr || '', cat: entry.cat || '',
        listPrice: entry.listPrice || 0, qty: 0, sources: [],
        partNumber: entry.partNumber || undefined,
        itemIds: [], unitNames: {},
        placement: { 'signal-flow': [], 'room-designer': [], 'rack-builder': [] },
      };
      rows.set(groupId, row);
    }
    row.qty++;
    row.itemIds.push(id);
    row.unitNames[id] = entry.name;
    if (!row.partNumber && entry.partNumber) row.partNumber = entry.partNumber;
    if (!row.mfr && entry.mfr) row.mfr = entry.mfr;
    if (!row.listPrice && entry.listPrice) row.listPrice = entry.listPrice;
    sources.forEach(s => {
      if (!row!.sources.includes(s)) row!.sources.push(s);
      row!.placement[s].push(id);
    });
  });

  const bomItems = Array.from(rows.values()).sort(
    (a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name)
  );
  bomItems.forEach(r => r.sources.sort((a, b) => SOURCES.indexOf(a) - SOURCES.indexOf(b)));

  // Overrides used to be keyed by display name; fall back to that so existing
  // saved prices survive the move to productKey.
  const unitPriceOf = useCallback((item: BOMLineItem) => {
    if (prices[item.key] !== undefined) return prices[item.key];
    if (prices[item.name] !== undefined) return prices[item.name];
    return item.listPrice;
  }, [prices]);

  const totalQty = bomItems.reduce((s, i) => s + i.qty, 0);
  const totalCost = bomItems.reduce((s, i) => s + unitPriceOf(i) * i.qty, 0);

  return (
    <BOMContext.Provider value={{ prices, collapsed, bomItems, totalQty, totalCost, updateSlice, reloadBaseline, retireUnits, updateUnitSpec, updateUnitSpecs, hiddenUnits, registerHidden, setPrice, setCollapsed, unitPriceOf }}>
      {children}
    </BOMContext.Provider>
  );
}

export function useBOM() {
  const ctx = useContext(BOMContext);
  if (!ctx) throw new Error('useBOM must be used within BOMProvider');
  return ctx;
}

/**
 * A tool tells the BOM panel which of its units are hidden (and how to bring
 * one back). Clears itself when the tool closes.
 */
export function useHiddenUnitsRegistry(
  source: BOMSource,
  items: Array<{ itemId: string; name: string }>,
  show: (itemId: string) => void,
) {
  const { registerHidden } = useBOM();
  const showRef = useRef(show);
  showRef.current = show;
  const signature = items.map(i => `${i.itemId}:${i.name}`).join('|');
  useEffect(() => {
    registerHidden({ source, items, show: id => showRef.current(id) });
    return () => registerHidden(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, signature, registerHidden]);
}

/**
 * Keeps units in step across the three tools: when an itemId that this tool had
 * a moment ago is gone from `itemIds`, the user deleted that unit, so it is
 * retired everywhere (the other tools, the scope record, the BOM).
 *
 * Only changes seen while `ready` count. While a room is loading (or being
 * switched) the list is empty or belongs to another room — that must never
 * read as "everything was deleted". `suppress` is for a bulk rewrite the tool
 * does on purpose (a scope re-import wipes and rebuilds the equipment), which
 * handles the other tools itself.
 */
export function useRetireRemovedUnits(
  source: BOMSource, itemIds: Array<string | undefined>, ready: boolean, suppress = false,
) {
  const { retireUnits } = useBOM();
  const previous = useRef<Set<string> | null>(null);
  const suppressRef = useRef(suppress);
  suppressRef.current = suppress;
  const signature = itemIds.filter(Boolean).join('|');

  useEffect(() => {
    if (!ready) { previous.current = null; return; }
    const current = new Set(itemIds.filter(Boolean) as string[]);
    const before = previous.current;
    previous.current = current;
    if (!before || suppressRef.current) return;
    const removed = Array.from(before).filter(id => !current.has(id));
    if (removed.length) retireUnits(removed, source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, signature]);
}
