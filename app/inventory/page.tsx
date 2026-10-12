"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createProduct, deleteProduct, findLibraryDuplicateClusters, findSimilarProducts, getFilterOptions, getKitsReferencingProduct, getProductCount, getProductsByIds, listProducts, updateProduct, type AVProduct, type DuplicateCluster, type KitComponent, type ReferencingKit, type SimilarProductMatch } from "@/lib/av-products";
import { type OrgEquipmentItem } from "@/lib/equipment-library";
import { type LaborRateType, DEFAULT_LABOR_RATE_TYPES } from "@/lib/labor-rates";
import { supabase } from "@/lib/supabase";
import { useLibraryAdmin } from "@/lib/use-library-admin";
import { useOrg } from "@/components/OrgProvider";
import EquipmentFormModal, { type EquipmentFormValue, type KitItemDisplay } from "@/components/EquipmentFormModal";
import ConfirmDialog from "@/components/ConfirmDialog";

type Section = "org" | "avgenix" | "inventory";

type Category = "Display" | "Audio" | "Control" | "Networking" | "Cable" | "Mount" | "Other";

type InventoryItem = {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: Category;
  quantity: number;
  location: string;
  condition: "New" | "Good" | "Fair" | "Poor";
  serialNumber: string;
  notes: string;
  createdAt?: string;
};

const CATEGORIES: Category[] = ["Display", "Audio", "Control", "Networking", "Cable", "Mount", "Other"];
const CONDITIONS = ["New", "Good", "Fair", "Poor"] as const;

const CATEGORY_COLORS: Record<Category, string> = {
  Display:    "bg-blue-500/15 text-blue-400",
  Audio:      "bg-violet-500/15 text-violet-400",
  Control:    "bg-amber-500/15 text-amber-400",
  Networking: "bg-cyan-500/15 text-cyan-400",
  Cable:      "bg-slate-500/15 text-slate-400",
  Mount:      "bg-orange-500/15 text-orange-400",
  Other:      "bg-gray-500/15 text-gray-400",
};

const CONDITION_COLORS: Record<string, string> = {
  New:  "bg-emerald-500/15 text-emerald-400",
  Good: "bg-blue-500/15 text-blue-400",
  Fair: "bg-amber-500/15 text-amber-400",
  Poor: "bg-red-500/15 text-red-400",
};

// Maps a Supabase `inventory_items` row (snake_case) to the InventoryItem
// shape this page's UI already works with (camelCase).
function inventoryRowToItem(row: any): InventoryItem {
  return {
    id: row.id,
    name: row.name || "",
    brand: row.brand || "",
    model: row.model || "",
    category: (row.category || "Other") as Category,
    quantity: row.quantity ?? 0,
    location: row.location || "",
    condition: (row.condition || "Good") as InventoryItem["condition"],
    serialNumber: row.serial_number || "",
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

// ── Icons ────────────────────────────────────────────────────────────────────

function BuildingIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function SparkleIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}

function BoxIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

// ── Landing data ─────────────────────────────────────────────────────────────

const NEWS_ITEMS: { type: string; name: string; date: string; description: string; tags: string[] }[] = [];

// "Old Inventory Review" only has one honest signal available — how long an
// item has sat in inventory since it was added — so status/action stay
// purely time- and category-based instead of asserting facts we can't know
// about a specific unit (real EOL/support status would need a manufacturer
// data feed this app doesn't have).
const AGING_REVIEW_YEARS = 2;
const AGING_LONG_HELD_YEARS = 5;

function inventoryAgeYears(createdAt?: string): number | null {
  if (!createdAt) return null;
  const ms = Date.now() - new Date(createdAt).getTime();
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

function formatAgeYears(years: number): string {
  return `${years.toFixed(1)} yrs`;
}

function agingStatus(years: number): { label: string; style: string } {
  return years >= AGING_LONG_HELD_YEARS
    ? { label: "Long-Held", style: "bg-orange-500/15 text-orange-600" }
    : { label: "Review", style: "bg-amber-500/15 text-amber-600" };
}

// Generic, category-level maintenance guidance — not a claim about any
// specific unit's real support/EOL status, just a sensible check for
// anything of that type once it's been sitting a while.
const CATEGORY_AGING_ACTION: Record<string, string> = {
  Display: "Verify condition and continued need",
  Audio: "Check condition and calibration",
  Control: "Confirm firmware and continued support",
  Networking: "Confirm firmware and continued support",
  Cable: "Inspect condition and connectors",
  Mount: "Inspect hardware and continued fit",
  Other: "Verify condition and continued need",
};

const NEWS_TYPE_STYLE: Record<string, string> = {
  "NEW PRODUCT":    "text-emerald-500",
  "SOFTWARE UPDATE":"text-blue-400",
};

// ── Landing — 3 cards ────────────────────────────────────────────────────────

const CARDS: { key: Section; label: string; description: string; icon: React.ReactNode; iconBg: string; iconColor: string; stat?: string }[] = [
  {
    key: "org",
    label: "My Library",
    description: "Curated catalog of approved equipment and labor for you.",
    icon: <BuildingIcon size={28} />,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
  },
  {
    key: "avgenix",
    label: "AVGenix Library",
    description: "Vetted AV products and full specifications maintained by AVGenix.",
    icon: <SparkleIcon size={28} />,
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-400",
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Track equipment your organization currently has in stock.",
    icon: <BoxIcon size={28} />,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
  },
];

function LandingView({ onSelect }: { onSelect: (s: Section) => void }) {
  const { activeOrg } = useOrg();
  const [avGenixCount, setAvGenixCount] = useState<number | null>(null);
  const [orgCount, setOrgCount] = useState<number | null>(null);
  const [inventoryCount, setInventoryCount] = useState<number | null>(null);
  const [agingItems, setAgingItems] = useState<InventoryItem[] | null>(null);

  useEffect(() => {
    getProductCount().then(setAvGenixCount).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeOrg) { setOrgCount(null); setInventoryCount(null); setAgingItems(null); return; }
    supabase
      .from("equipment_library")
      .select("*", { count: "exact", head: true })
      .eq("org_id", activeOrg.id)
      .then(({ count }) => setOrgCount(count ?? 0));
    supabase
      .from("inventory_items")
      .select("*", { count: "exact", head: true })
      .eq("org_id", activeOrg.id)
      .then(({ count }) => setInventoryCount(count ?? 0));
    // Oldest-first — "Old Inventory Review" only ever looks at items that
    // have actually been sitting in inventory a while, per inventoryAgeYears.
    supabase
      .from("inventory_items")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: true })
      .limit(5)
      .then(({ data }) => setAgingItems((data ?? []).map(inventoryRowToItem)));
  }, [activeOrg?.id]);

  const cards = CARDS.map((c) => {
    if (c.key === "avgenix" && avGenixCount !== null) return { ...c, stat: `${avGenixCount} products` };
    if (c.key === "org" && orgCount !== null) return { ...c, stat: `${orgCount} items` };
    if (c.key === "inventory" && inventoryCount !== null) return { ...c, stat: `${inventoryCount} SKUs` };
    return c;
  });

  const oldInventoryItems = (agingItems ?? [])
    .map((item) => ({ item, years: inventoryAgeYears(item.createdAt) }))
    .filter((x): x is { item: InventoryItem; years: number } => x.years !== null && x.years >= AGING_REVIEW_YEARS);

  return (
    <div className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h2 className="text-xl font-bold text-heading">Library</h2>
        <p className="mt-1 text-[13px] text-muted">Browse equipment & labor catalogs and manage your organization's stock.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ key, label, description, icon, stat }) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className="group flex h-[190px] w-full flex-col items-center justify-start gap-2 rounded-xl border border-border bg-forge-surface/40 px-3 pb-3 pt-4 text-center transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-lg"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-forge-panel text-muted">
              {icon}
            </div>
            <h3 className="text-[13px] font-bold leading-tight text-body group-hover:text-heading">{label}</h3>
            <p className="text-[11px] leading-relaxed text-subtle">{description}</p>
            <span className="mt-auto flex min-h-[2.25rem] w-full items-center justify-center rounded-xl border border-border bg-border/30 px-2 py-1 text-[10px] font-semibold leading-tight text-muted">
              {stat ?? "Coming soon"}
            </span>
          </button>
        ))}
      </div>

      {/* ── News + Old Inventory ─────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">

        {/* New Products on AVGenix */}
        <div className="overflow-hidden rounded-xl border border-border bg-forge-surface/20">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h3 className="text-[13px] font-bold text-heading">New Products on AVGenix</h3>
            <button className="text-[12px] font-medium text-blue-400 transition-colors hover:text-blue-300">View all</button>
          </div>
          {NEWS_ITEMS.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="mb-3 text-faint" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <p className="text-[13px] font-medium text-subtle">No products yet</p>
              <p className="mt-1 text-[12px] text-faint">Equipment added to the AVGenix Equipment Library will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {NEWS_ITEMS.map((item, i) => (
                <div key={i} className="flex gap-4 px-5 py-4 transition-colors hover:bg-forge-surface/30">
                  <div className="h-[72px] w-[72px] shrink-0 rounded-lg bg-slate-700/60" />
                  <div className="min-w-0 flex-1">
                    <div className={`mb-0.5 text-[10px] font-bold tracking-widest ${NEWS_TYPE_STYLE[item.type] ?? "text-muted"}`}>
                      {item.type}
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-heading">{item.name}</span>
                      <span className="shrink-0 text-[11px] text-subtle">{item.date}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">{item.description}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex gap-1.5">
                        {item.tags.map((tag) => (
                          <span key={tag} className="rounded-full border border-border bg-forge-surface/60 px-2 py-0.5 text-[10px] font-medium text-subtle">{tag}</span>
                        ))}
                      </div>
                      <button className="whitespace-nowrap text-[11px] font-medium text-blue-400 transition-colors hover:text-blue-300">View details →</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Old Inventory Review */}
        <div className="overflow-hidden rounded-xl border border-border bg-forge-surface/20">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h3 className="text-[13px] font-bold text-heading">Old Inventory Review</h3>
            <button onClick={() => onSelect("inventory")} className="text-[12px] font-medium text-blue-400 transition-colors hover:text-blue-300">View all</button>
          </div>
          {oldInventoryItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="mb-3 text-faint" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.91 8.84L8.56 2.23a1.93 1.93 0 00-1.81 0L3.1 4.13a2.12 2.12 0 00-.05 3.69l12.22 6.93a2 2 0 001.94 0L21 12.51a2.12 2.12 0 00-.09-3.67z" />
                <path d="M3.09 8.84l12.35-6.61a1.93 1.93 0 011.81 0l3.65 1.9a2.12 2.12 0 01.1 3.69L8.73 14.75a2 2 0 01-1.94 0L3.1 12.51a2.12 2.12 0 01-.01-3.67z" />
              </svg>
              <p className="text-[13px] font-medium text-subtle">Nothing to review yet</p>
              <p className="mt-1 text-[12px] text-faint">
                {agingItems === null ? "Loading…" : `Items sitting in Inventory ${AGING_REVIEW_YEARS}+ years will show up here.`}
              </p>
            </div>
          ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-border bg-forge-surface/40">
                <th className="px-5 py-2.5 text-left text-[11px] font-semibold text-muted">Item</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted">In Inventory</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted">Status</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted">Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {oldInventoryItems.map(({ item, years }) => {
                const status = agingStatus(years);
                return (
                  <tr key={item.id} className="border-b border-border/50 transition-colors hover:bg-forge-surface/30">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 shrink-0 rounded-md bg-slate-700/60" />
                        <div>
                          <div className="text-[12px] font-semibold text-heading">{item.name || `${item.brand} ${item.model}`.trim() || "Untitled item"}</div>
                          <div className="text-[11px] text-subtle">{item.category}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-body">{formatAgeYears(years)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${status.style}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[11px] text-subtle">{CATEGORY_AGING_ACTION[item.category] ?? CATEGORY_AGING_ACTION.Other}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Inventory section ────────────────────────────────────────────────────────

function InventoryView({ onBack }: { onBack: () => void }) {
  const { activeOrg } = useOrg();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCondition, setFilterCondition] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!activeOrg) { setLoading(false); return; }
    setLoading(true);
    supabase
      .from("inventory_items")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setItems((data ?? []).map(inventoryRowToItem));
        setLoading(false);
      });
  }, [activeOrg?.id]);

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    const matchSearch = !q || item.name.toLowerCase().includes(q) || item.brand.toLowerCase().includes(q) || item.model.toLowerCase().includes(q);
    const matchCat = !filterCategory || item.category === filterCategory;
    const matchCond = !filterCondition || item.condition === filterCondition;
    return matchSearch && matchCat && matchCond;
  });

  function openNew() {
    setEditing({ id: "", name: "", brand: "", model: "", category: "Display", quantity: 1, location: "", condition: "New", serialNumber: "", notes: "" });
    setShowModal(true);
  }

  function openEdit(item: InventoryItem) {
    setEditing({ ...item });
    setShowModal(true);
  }

  async function handleSave() {
    if (!editing || !editing.name.trim() || !activeOrg) return;
    setSaving(true);
    const payload = {
      org_id: activeOrg.id,
      name: editing.name.trim(),
      brand: editing.brand,
      model: editing.model,
      category: editing.category,
      quantity: editing.quantity,
      location: editing.location,
      condition: editing.condition,
      serial_number: editing.serialNumber,
      notes: editing.notes,
    };
    if (!editing.id) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }
      const { data, error } = await supabase.from("inventory_items").insert({ ...payload, user_id: user.id }).select("*").single();
      if (!error && data) setItems((prev) => [inventoryRowToItem(data), ...prev]);
    } else {
      const { error } = await supabase.from("inventory_items").update(payload).eq("id", editing.id);
      if (!error) setItems((prev) => prev.map((i) => (i.id === editing.id ? editing : i)));
    }
    setSaving(false);
    setShowModal(false);
    setEditing(null);
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);
    const { error } = await supabase.from("inventory_items").delete().eq("id", deleteConfirm.id);
    setDeleting(false);
    if (!error) setItems((prev) => prev.filter((i) => i.id !== deleteConfirm.id));
    setDeleteConfirm(null);
  }

  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  const categoryBreakdown = CATEGORIES.map((c) => ({
    cat: c,
    count: items.filter((i) => i.category === c).reduce((s, i) => s + i.quantity, 0),
  })).filter((c) => c.count > 0);

  const inputCls = "w-full rounded-lg border border-border bg-forge-surface/60 px-3 py-2 text-[13px] text-heading placeholder:text-faint focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30";
  const labelCls = "mb-1 block text-[11px] font-medium text-muted";

  return (
    <div className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-[13px] text-muted hover:text-heading transition-colors"
          >
            <ArrowLeftIcon />
            Library
          </button>
          <span className="text-border">/</span>
          <h2 className="text-xl font-bold text-heading">Inventory</h2>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-blue-500"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Item
        </button>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-forge-surface/40 p-4">
          <div className="text-[11px] font-medium text-muted">Total Items</div>
          <div className="mt-1 text-2xl font-bold text-heading">{totalItems}</div>
          <div className="mt-0.5 text-[11px] text-subtle">{items.length} SKUs</div>
        </div>
        {categoryBreakdown.slice(0, 3).map(({ cat, count }) => (
          <div key={cat} className="rounded-xl border border-border bg-forge-surface/40 p-4">
            <div className="text-[11px] font-medium text-muted">{cat}</div>
            <div className="mt-1 text-2xl font-bold text-heading">{count}</div>
            <div className="mt-0.5 text-[11px] text-subtle">units</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, brand, model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="forge-input w-full pl-8 text-[13px]"
          />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="forge-input w-auto min-w-[140px] text-[13px]">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={filterCondition} onChange={(e) => setFilterCondition(e.target.value)} className="forge-input w-auto min-w-[130px] text-[13px]">
          <option value="">All conditions</option>
          {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
        </select>
        {(search || filterCategory || filterCondition) && (
          <button onClick={() => { setSearch(""); setFilterCategory(""); setFilterCondition(""); }} className="text-[12px] font-medium text-blue-400 hover:text-blue-300 transition-colors">
            Clear
          </button>
        )}
        <span className="ml-auto text-[12px] text-subtle">{filtered.length} of {items.length} items</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-forge-surface/20 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="border-b border-border bg-forge-surface/60">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Item</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Brand / Model</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Category</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted">Qty</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Location</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Condition</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Serial #</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center text-[13px] text-subtle">Loading…</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center text-[13px] text-subtle">
                  No items found.{" "}
                  <button onClick={openNew} className="text-blue-400 hover:text-blue-300 transition-colors">Add the first item.</button>
                </td>
              </tr>
            )}
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-border/50 transition-colors hover:bg-forge-surface/40">
                <td className="px-4 py-3">
                  <div className="text-[13px] font-semibold text-heading">{item.name}</div>
                  {item.notes && <div className="mt-0.5 text-[11px] text-subtle truncate max-w-[200px]">{item.notes}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="text-[13px] text-body">{item.brand}</div>
                  <div className="text-[11px] text-subtle">{item.model}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[item.category]}`}>
                    {item.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-[14px] font-bold text-heading">{item.quantity}</span>
                </td>
                <td className="px-4 py-3 text-[13px] text-body">{item.location || <span className="text-faint">—</span>}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${CONDITION_COLORS[item.condition]}`}>
                    {item.condition}
                  </span>
                </td>
                <td className="px-4 py-3 text-[12px] font-mono text-subtle">{item.serialNumber || <span className="text-faint">—</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(item)} className="rounded-md p-1.5 text-muted transition-colors hover:bg-forge-surface hover:text-heading">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button onClick={() => setDeleteConfirm(item)} className="rounded-md p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-400">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showModal && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-forge-bg shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-[15px] font-bold text-heading">
                {items.find((i) => i.id === editing.id) ? "Edit Item" : "Add Item"}
              </h3>
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="text-muted hover:text-heading transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Item Name *</label>
                <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} placeholder='e.g. 85" 4K Display' />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Brand</label>
                  <input type="text" value={editing.brand} onChange={(e) => setEditing({ ...editing, brand: e.target.value })} className={inputCls} placeholder="e.g. Samsung" />
                </div>
                <div>
                  <label className={labelCls}>Model</label>
                  <input type="text" value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })} className={inputCls} placeholder="e.g. QM85B" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Category</label>
                  <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as Category })} className={inputCls}>
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Condition</label>
                  <select value={editing.condition} onChange={(e) => setEditing({ ...editing, condition: e.target.value as InventoryItem["condition"] })} className={inputCls}>
                    {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Quantity</label>
                  <input type="number" min={0} value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: Math.max(0, Number(e.target.value)) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Location</label>
                  <input type="text" value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} className={inputCls} placeholder="e.g. Warehouse A" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Serial Number</label>
                <input type="text" value={editing.serialNumber} onChange={(e) => setEditing({ ...editing, serialNumber: e.target.value })} className={inputCls} placeholder="Optional" />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} className={inputCls + " resize-none"} rows={2} placeholder="Optional notes…" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-body">
                Cancel
              </button>
              <button onClick={handleSave} disabled={!editing.name.trim() || saving} className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50">
                {saving ? "Saving…" : "Save Item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <ConfirmDialog
          title="Delete Item"
          message={<>Delete <span className="font-semibold text-heading">{deleteConfirm.name}</span> from inventory? This can&apos;t be undone.</>}
          busy={deleting}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

// ── AVGenix Equipment Library section ───────────────────────────────────────

const LIBRARY_PAGE_SIZE = 40;

function avProductToFormValue(p: AVProduct): EquipmentFormValue {
  return {
    manufacturer: p.manufacturer,
    model: p.model_name,
    category: p.category,
    notes: p.type,
    unitCost: p.price,
    partNumber: p.part_number,
    msrp: p.msrp,
    cost: p.cost,
    margin: p.margin,
    markup: p.markup,
    ports: p.ports,
    ampDraw: p.amp_draw,
    voltage: p.voltage,
    powerWatts: p.power_watts,
    btuHr: p.btu_hr,
    rackMounted: p.rack_mounted,
    rackUnits: p.rack_units,
    rackEarsIncluded: p.rack_ear_included ?? false,
    widthIn: p.width_in,
    heightIn: p.height_in,
    depthIn: p.depth_in,
    diameterIn: p.diameter_in,
    weightLb: p.weight_lb,
    hfovDeg: p.hfov_deg,
    vfovDeg: p.vfov_deg,
    coveragePattern: p.coverage_pattern,
    coverageDiameterFt: p.coverage_diameter_ft,
    coverageAngleDeg: p.coverage_angle_deg,
    coverageWidthFt: p.coverage_width_ft,
    coverageDepthFt: p.coverage_depth_ft,
  };
}

function applyFormValueToAVProduct(base: AVProduct, v: EquipmentFormValue): AVProduct {
  return {
    ...base,
    manufacturer: v.manufacturer,
    model_name: v.model,
    category: v.category,
    type: v.notes,
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
    rack_mounted: v.rackMounted,
    rack_units: v.rackUnits,
    rack_ear_included: v.rackEarsIncluded,
    width_in: v.widthIn,
    height_in: v.heightIn,
    depth_in: v.depthIn,
    diameter_in: v.diameterIn ?? null,
    weight_lb: v.weightLb,
    hfov_deg: v.hfovDeg,
    vfov_deg: v.vfovDeg,
    coverage_pattern: v.coveragePattern,
    coverage_diameter_ft: v.coverageDiameterFt,
    coverage_angle_deg: v.coverageAngleDeg,
    coverage_width_ft: v.coverageWidthFt,
    coverage_depth_ft: v.coverageDepthFt,
  };
}

const emptyAVProduct = (): AVProduct => ({
  id: "",
  manufacturer: "",
  model_name: "",
  category: "",
  type: "",
  price: 0,
  part_number: null,
  updated_at: "",
  msrp: null,
  cost: null,
  margin: null,
  markup: null,
  color: "",
  ports: [],
  amp_draw: null,
  voltage: null,
  power_watts: null,
  btu_hr: null,
  rack_mounted: false,
  rack_units: null,
  width_in: null,
  height_in: null,
  depth_in: null,
  diameter_in: null,
  weight_lb: null,
  rack_mountable_detail: null,
  rack_ear_included: null,
  rack_ear_detail: null,
  shelf_required: null,
  shelf_requirement: null,
  voltage_detail: null,
  current_detail: null,
  power_supply_type: null,
  notes: null,
  rd_type: null,
  rd_wall: null,
  rd_width_ft: null,
  rd_height_ft: null,
  rd_icon: null,
  hfov_deg: null,
  vfov_deg: null,
  coverage_pattern: null,
  coverage_diameter_ft: null,
  coverage_angle_deg: null,
  coverage_width_ft: null,
  coverage_depth_ft: null,
  kit_items: [],
});

function AVGenixLibraryView({ onBack }: { onBack: () => void }) {
  const { activeOrg } = useOrg();
  // The shared catalog is read-only for everyone but library admins; the
  // database enforces it, this just hides the controls that would fail.
  const { isLibraryAdmin } = useLibraryAdmin();
  const [libView, setLibView] = useState<"equipment" | "labor">("equipment");
  const [products, setProducts] = useState<AVProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterManufacturer, setFilterManufacturer] = useState("");
  const [updatedSort, setUpdatedSort] = useState<"asc" | "desc" | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [selected, setSelected] = useState<AVProduct | null>(null);
  const [editingProduct, setEditingProduct] = useState<AVProduct | null>(null);
  const [editingKitItems, setEditingKitItems] = useState<KitItemDisplay[]>([]);
  const [savingProduct, setSavingProduct] = useState(false);
  const [productSaveError, setProductSaveError] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState<AVProduct | null>(null);
  const [newKitItems, setNewKitItems] = useState<KitItemDisplay[]>([]);
  const [savingNewProduct, setSavingNewProduct] = useState(false);
  const [newProductSaveError, setNewProductSaveError] = useState<string | null>(null);
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<AVProduct | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);
  const [checkingDeleteProduct, setCheckingDeleteProduct] = useState<string | null>(null);
  const [blockedDeleteProduct, setBlockedDeleteProduct] = useState<{ product: AVProduct; kits: ReferencingKit[] } | null>(null);
  const [similarProductPrompt, setSimilarProductPrompt] = useState<{ kind: "new" | "edit"; matches: SimilarProductMatch[] } | null>(null);
  const [checkingSimilarProducts, setCheckingSimilarProducts] = useState(false);
  const [duplicateClusters, setDuplicateClusters] = useState<DuplicateCluster[] | null>(null);
  const [scanningDuplicates, setScanningDuplicates] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [addingToOrg, setAddingToOrg] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: number } | null>(null);
  // Duplicates found during a bulk "Add to My Organization's Equipment
  // Library" — held here instead of silently skipping them, so the user
  // gets the same override choice the single-item Add flow already gives.
  const [bulkOverrideConfirm, setBulkOverrideConfirm] = useState<{ items: { product: AVProduct; existingId: string }[]; addedSoFar: number } | null>(null);

  async function overrideOrgItem(product: AVProduct, existingId: string) {
    return supabase
      .from("equipment_library")
      .update({
        category: product.category,
        manufacturer: product.manufacturer,
        model: product.model_name,
        description: product.type || "",
        unit_cost: product.price ?? 0,
        part_number: product.part_number,
        msrp: product.msrp,
        cost: product.cost,
        margin: product.margin,
        markup: product.markup,
        color: product.color,
        ports: product.ports ?? [],
        amp_draw: product.amp_draw,
        voltage: product.voltage,
        power_watts: product.power_watts,
        btu_hr: product.btu_hr,
        rack_mounted: product.rack_mounted ?? false,
        rack_units: product.rack_units,
        rack_ear_included: product.rack_ear_included,
        width_in: product.width_in,
        height_in: product.height_in,
        depth_in: product.depth_in,
        ...(product.diameter_in != null ? { diameter_in: product.diameter_in } : {}),
        weight_lb: product.weight_lb,
      })
      .eq("id", existingId);
  }

  async function addSelectedToOrgLibrary() {
    if (!activeOrg || selectedIds.size === 0) return;
    setBulkAdding(true);
    setBulkResult(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const toAdd = products.filter((p) => selectedIds.has(p.id));
      let added = 0;
      const duplicates: { product: AVProduct; existingId: string }[] = [];
      for (const product of toAdd) {
        const { data: existing } = await supabase
          .from("equipment_library")
          .select("id")
          .eq("org_id", activeOrg.id)
          .eq("manufacturer", product.manufacturer)
          .eq("model", product.model_name)
          .maybeSingle();
        if (existing) {
          duplicates.push({ product, existingId: existing.id });
        } else {
          const { error } = await supabase.from("equipment_library").insert({
            user_id: user.id,
            org_id: activeOrg.id,
            category: product.category,
            manufacturer: product.manufacturer,
            model: product.model_name,
            description: product.type || "",
            unit_cost: product.price ?? 0,
            part_number: product.part_number,
            msrp: product.msrp,
            cost: product.cost,
            margin: product.margin,
            markup: product.markup,
            color: product.color,
            ports: product.ports ?? [],
            amp_draw: product.amp_draw,
            voltage: product.voltage,
            power_watts: product.power_watts,
            btu_hr: product.btu_hr,
            rack_mounted: product.rack_mounted ?? false,
            rack_units: product.rack_units,
            rack_ear_included: product.rack_ear_included,
            width_in: product.width_in,
            height_in: product.height_in,
            depth_in: product.depth_in,
            ...(product.diameter_in != null ? { diameter_in: product.diameter_in } : {}),
            weight_lb: product.weight_lb,
          });
          if (!error) { added++; setAddedIds((prev) => new Set(prev).add(product.id)); }
        }
      }
      setSelectedIds(new Set());
      setAnchorIndex(null);
      if (duplicates.length > 0) {
        setBulkOverrideConfirm({ items: duplicates, addedSoFar: added });
      } else {
        setBulkResult({ added, skipped: 0 });
        setTimeout(() => setBulkResult(null), 4000);
      }
    }
    setBulkAdding(false);
  }

  async function confirmBulkOverride() {
    if (!bulkOverrideConfirm) return;
    setBulkAdding(true);
    let overridden = 0;
    for (const { product, existingId } of bulkOverrideConfirm.items) {
      const { error } = await overrideOrgItem(product, existingId);
      if (!error) { overridden++; setAddedIds((prev) => new Set(prev).add(product.id)); }
    }
    setBulkResult({ added: bulkOverrideConfirm.addedSoFar + overridden, skipped: bulkOverrideConfirm.items.length - overridden });
    setTimeout(() => setBulkResult(null), 4000);
    setBulkOverrideConfirm(null);
    setBulkAdding(false);
  }

  function cancelBulkOverride() {
    if (!bulkOverrideConfirm) return;
    setBulkResult({ added: bulkOverrideConfirm.addedSoFar, skipped: bulkOverrideConfirm.items.length });
    setTimeout(() => setBulkResult(null), 4000);
    setBulkOverrideConfirm(null);
  }

  function handleRowClick(e: React.MouseEvent, index: number) {
    const product = products[index];
    if (e.shiftKey && anchorIndex !== null) {
      const [start, end] = [Math.min(anchorIndex, index), Math.max(anchorIndex, index)];
      setSelectedIds(new Set(products.slice(start, end + 1).map((p) => p.id)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(product.id)) next.delete(product.id);
        else next.add(product.id);
        return next;
      });
      setAnchorIndex(index);
    } else {
      setSelectedIds(new Set([product.id]));
      setAnchorIndex(index);
    }
  }

  function handleRowContextMenu(e: React.MouseEvent, index: number) {
    e.preventDefault();
    const product = products[index];
    if (!selectedIds.has(product.id)) {
      setSelectedIds(new Set([product.id]));
      setAnchorIndex(index);
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  const [overrideConfirm, setOverrideConfirm] = useState<{ product: AVProduct; existingId: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  async function addToOrgLibrary(product: AVProduct) {
    if (!activeOrg) return;
    setAddingToOrg(true);
    const { data: existing } = await supabase
      .from("equipment_library")
      .select("id")
      .eq("org_id", activeOrg.id)
      .eq("manufacturer", product.manufacturer)
      .eq("model", product.model_name)
      .maybeSingle();
    if (existing) {
      setAddingToOrg(false);
      setOverrideConfirm({ product, existingId: existing.id });
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase.from("equipment_library").insert({
        user_id: user.id,
        org_id: activeOrg.id,
        category: product.category,
        manufacturer: product.manufacturer,
        model: product.model_name,
        description: product.type || "",
        unit_cost: product.price ?? 0,
        part_number: product.part_number,
        msrp: product.msrp,
        cost: product.cost,
        margin: product.margin,
        markup: product.markup,
        color: product.color,
        ports: product.ports ?? [],
        amp_draw: product.amp_draw,
        voltage: product.voltage,
        power_watts: product.power_watts,
        btu_hr: product.btu_hr,
        rack_mounted: product.rack_mounted ?? false,
        rack_units: product.rack_units,
        rack_ear_included: product.rack_ear_included,
        width_in: product.width_in,
        height_in: product.height_in,
        depth_in: product.depth_in,
        ...(product.diameter_in != null ? { diameter_in: product.diameter_in } : {}),
        weight_lb: product.weight_lb,
      });
      if (!error) setAddedIds((prev) => new Set(prev).add(product.id));
    }
    setAddingToOrg(false);
  }

  async function confirmOverride() {
    if (!overrideConfirm) return;
    const { product, existingId } = overrideConfirm;
    setAddingToOrg(true);
    const { error } = await overrideOrgItem(product, existingId);
    if (!error) setAddedIds((prev) => new Set(prev).add(product.id));
    setAddingToOrg(false);
    setOverrideConfirm(null);
  }

  useEffect(() => {
    getFilterOptions()
      .then(({ categories, manufacturers }) => {
        setCategories(categories);
        setManufacturers(manufacturers);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    listProducts({
      search: debouncedSearch,
      category: filterCategory,
      manufacturer: filterManufacturer,
      offset: 0,
      limit: LIBRARY_PAGE_SIZE,
      ...(updatedSort ? { sortBy: "updated_at" as const, sortDir: updatedSort } : {}),
    })
      .then(({ data, count }) => {
        setProducts(data);
        setTotal(count);
      })
      .finally(() => setLoading(false));
  }, [debouncedSearch, filterCategory, filterManufacturer, updatedSort]);

  function loadMore() {
    setLoadingMore(true);
    listProducts({
      search: debouncedSearch,
      category: filterCategory,
      manufacturer: filterManufacturer,
      offset: products.length,
      limit: LIBRARY_PAGE_SIZE,
      ...(updatedSort ? { sortBy: "updated_at" as const, sortDir: updatedSort } : {}),
    })
      .then(({ data }) => setProducts((prev) => [...prev, ...data]))
      .finally(() => setLoadingMore(false));
  }

  function toggleUpdatedSort() {
    setUpdatedSort((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function friendlyProductSaveError(message: string): string {
    if (/duplicate key value/i.test(message)) return "A product with this manufacturer, model, and part number already exists in the AVGenix Library.";
    return message;
  }

  function kitItemsToComponents(items: KitItemDisplay[]): KitComponent[] {
    return items.map((i) => ({ product_id: i.productId, quantity: i.quantity }));
  }

  async function scanForDuplicates() {
    setScanningDuplicates(true);
    const clusters = await findLibraryDuplicateClusters().catch(() => []);
    setScanningDuplicates(false);
    setDuplicateClusters(clusters);
  }

  async function openClusterProduct(id: string) {
    const [full] = await getProductsByIds([id]).catch(() => []);
    if (!full) return;
    setDuplicateClusters(null);
    openEditProduct(full);
  }

  async function openEditProduct(p: AVProduct) {
    setProductSaveError(null);
    setEditingProduct({ ...p });
    setEditingKitItems([]);
    if (!p.kit_items || p.kit_items.length === 0) return;
    const componentProducts = await getProductsByIds(p.kit_items.map((i) => i.product_id)).catch(() => []);
    const byId = new Map(componentProducts.map((cp) => [cp.id, cp]));
    setEditingKitItems(
      p.kit_items
        .map((i) => {
          const cp = byId.get(i.product_id);
          if (!cp) return null;
          return { productId: cp.id, manufacturer: cp.manufacturer, model: cp.model_name, partNumber: cp.part_number, quantity: i.quantity };
        })
        .filter((i): i is KitItemDisplay => i !== null)
    );
  }

  async function handleSaveProduct(force = false) {
    if (!editingProduct || !editingProduct.manufacturer.trim() || !editingProduct.model_name.trim()) return;
    if (!force) {
      setCheckingSimilarProducts(true);
      const matches = await findSimilarProducts(editingProduct.manufacturer, editingProduct.model_name, editingProduct.part_number, editingProduct.id).catch(() => []);
      setCheckingSimilarProducts(false);
      if (matches.length > 0) {
        setSimilarProductPrompt({ kind: "edit", matches });
        return;
      }
    }
    setSavingProduct(true);
    setProductSaveError(null);
    const { id, updated_at, ...patch } = editingProduct;
    patch.kit_items = kitItemsToComponents(editingKitItems);
    const { error } = await updateProduct(id, patch);
    if (error) {
      setProductSaveError(friendlyProductSaveError(error));
      setSavingProduct(false);
      return;
    }
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...editingProduct, kit_items: patch.kit_items! } : p)));
    setSavingProduct(false);
    setEditingProduct(null);
    setEditingKitItems([]);
  }

  async function handleSaveNewProduct(force = false) {
    if (!newProduct || !newProduct.manufacturer.trim() || !newProduct.model_name.trim()) return;
    if (!force) {
      setCheckingSimilarProducts(true);
      const matches = await findSimilarProducts(newProduct.manufacturer, newProduct.model_name, newProduct.part_number).catch(() => []);
      setCheckingSimilarProducts(false);
      if (matches.length > 0) {
        setSimilarProductPrompt({ kind: "new", matches });
        return;
      }
    }
    setSavingNewProduct(true);
    setNewProductSaveError(null);
    const { id, updated_at, ...rest } = newProduct;
    rest.kit_items = kitItemsToComponents(newKitItems);
    const { id: insertedId, error } = await createProduct(rest);
    if (error || !insertedId) {
      setNewProductSaveError(friendlyProductSaveError(error || "Save failed."));
      setSavingNewProduct(false);
      return;
    }
    setProducts((prev) => [{ ...newProduct, id: insertedId, kit_items: rest.kit_items }, ...prev]);
    setTotal((prev) => prev + 1);
    setNewProduct(null);
    setNewKitItems([]);
    setSavingNewProduct(false);
  }

  // Hard-blocks deleting a product that's a component of any Kit — see
  // lib/av-products.ts getKitsReferencingProduct for why (deleting it would
  // silently break every kit that references it). The normal delete-confirm
  // dialog only ever appears once this check comes back clean.
  async function requestDeleteProduct(p: AVProduct) {
    setCheckingDeleteProduct(p.id);
    const kits = await getKitsReferencingProduct(p.id).catch(() => []);
    setCheckingDeleteProduct(null);
    if (kits.length > 0) {
      setBlockedDeleteProduct({ product: p, kits });
      return;
    }
    setPendingDeleteProduct(p);
  }

  async function handleDeleteProduct() {
    if (!pendingDeleteProduct) return;
    setDeletingProduct(true);
    await deleteProduct(pendingDeleteProduct.id);
    setProducts((prev) => prev.filter((p) => p.id !== pendingDeleteProduct.id));
    setTotal((prev) => Math.max(0, prev - 1));
    setDeletingProduct(false);
    setPendingDeleteProduct(null);
  }

  return (
    <div className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-heading transition-colors">
            <ArrowLeftIcon />
            Library
          </button>
          <span className="text-border">/</span>
          <h2 className="text-xl font-bold text-heading">AVGenix Library</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-subtle">{total} products</span>
          {isLibraryAdmin && (<>
          <button
            onClick={scanForDuplicates}
            disabled={scanningDuplicates}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-[13px] font-semibold text-body transition-colors hover:bg-forge-surface disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {scanningDuplicates ? "Scanning…" : "Review Duplicates"}
          </button>
          <button
            onClick={() => { setNewProductSaveError(null); setNewProduct(emptyAVProduct()); setNewKitItems([]); }}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-blue-500"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Product
          </button>
          </>)}
        </div>
      </div>

      {/* Equipment / Labor tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-forge-surface/40 p-1">
        <button
          onClick={() => setLibView("equipment")}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${libView === "equipment" ? "bg-forge-panel text-heading shadow-sm" : "text-muted hover:text-body"}`}
        >
          Equipment · {total}
        </button>
        <button
          onClick={() => setLibView("labor")}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${libView === "labor" ? "bg-forge-panel text-heading shadow-sm" : "text-muted hover:text-body"}`}
        >
          Labor · {DEFAULT_LABOR_RATE_TYPES.length}
        </button>
      </div>

      {libView === "labor" ? (
        <StandardLaborView />
      ) : (
      <>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by manufacturer, model, type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="forge-input w-full pl-8 text-[13px]"
          />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="forge-input w-auto min-w-[140px] text-[13px]">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={filterManufacturer} onChange={(e) => setFilterManufacturer(e.target.value)} className="forge-input w-auto min-w-[160px] text-[13px]">
          <option value="">All manufacturers</option>
          {manufacturers.map((m) => <option key={m}>{m}</option>)}
        </select>
        {(search || filterCategory || filterManufacturer) && (
          <button
            onClick={() => { setSearch(""); setFilterCategory(""); setFilterManufacturer(""); }}
            className="text-[12px] font-medium text-blue-400 hover:text-blue-300 transition-colors"
          >
            Clear
          </button>
        )}
        {selectedIds.size > 0 && (
          <span className="text-[12px] font-medium text-blue-400">
            {selectedIds.size} selected ·{" "}
            <button onClick={() => { setSelectedIds(new Set()); setAnchorIndex(null); }} className="font-medium text-blue-400 underline hover:text-blue-300">
              Clear
            </button>
          </span>
        )}
        <span className="ml-auto text-[12px] text-subtle">{products.length} of {total} loaded</span>
      </div>

      {bulkResult && (
        <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-2 text-[12px] text-emerald-400">
          Added {bulkResult.added} item{bulkResult.added === 1 ? "" : "s"} to your organization&apos;s library.
          {bulkResult.skipped > 0 && ` ${bulkResult.skipped} already existed and ${bulkResult.skipped === 1 ? "was" : "were"} skipped.`}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-forge-surface/20 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[13%]" />
              <col className="w-[23%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col className="w-[72px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-forge-surface/60">
                <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold text-muted">Manufacturer / Model</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold text-muted">Category</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold text-muted">Type</th>
                <th className="whitespace-nowrap px-4 py-3 text-right text-[11px] font-semibold text-muted">Price</th>
                <th className="whitespace-nowrap px-4 py-3 text-center text-[11px] font-semibold text-muted">Rack</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold text-muted">Part #</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold text-muted">
                  <button
                    onClick={toggleUpdatedSort}
                    className="flex items-center gap-1 whitespace-nowrap transition-colors hover:text-heading"
                    title={updatedSort === "asc" ? "Oldest to Newest" : "Newest to Oldest"}
                  >
                    Last Updated on
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${updatedSort === "asc" ? "rotate-180" : ""} ${updatedSort ? "opacity-100" : "opacity-40"}`}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-[13px] text-subtle">Loading…</td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-[13px] text-subtle">No products found.</td>
                </tr>
              ) : (
                products.map((p, index) => (
                  <tr
                    key={p.id}
                    onClick={(e) => handleRowClick(e, index)}
                    onDoubleClick={() => setSelected(p)}
                    onContextMenu={(e) => handleRowContextMenu(e, index)}
                    className={`cursor-pointer select-none border-b border-border/50 transition-colors ${
                      selectedIds.has(p.id) ? "bg-blue-500/10 hover:bg-blue-500/15" : "hover:bg-forge-surface/40"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color || "#64748b" }} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold text-heading">{p.manufacturer}</span>
                            {p.kit_items && p.kit_items.length > 0 && (
                              <span className="shrink-0 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-300" title={`Kit of ${p.kit_items.length} part${p.kit_items.length === 1 ? "" : "s"}`}>Kit</span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-subtle">{p.model_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="truncate px-4 py-3 text-[12px] text-body">{p.category}</td>
                    <td className="truncate px-4 py-3 text-[12px] text-subtle">{p.type}</td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-body">
                      {p.price ? `$${p.price.toLocaleString()}` : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-[12px] text-subtle">
                      {p.rack_mounted ? `${p.rack_units ?? "—"}U` : <span className="text-faint">—</span>}
                    </td>
                    <td className="truncate px-4 py-3 font-mono text-[11px] text-subtle">{p.part_number || <span className="text-faint">—</span>}</td>
                    <td className="whitespace-nowrap truncate px-4 py-3 text-[12px] text-subtle">
                      {p.updated_at ? new Date(p.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {isLibraryAdmin && <div className="flex items-center justify-end gap-1">
                        <button onClick={(e) => { e.stopPropagation(); openEditProduct(p); }} className="rounded-md p-1.5 text-muted transition-colors hover:bg-forge-surface hover:text-heading" title="Edit">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); requestDeleteProduct(p); }} disabled={checkingDeleteProduct === p.id} className="rounded-md p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40" title="Delete">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                          </svg>
                        </button>
                      </div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && products.length < total && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-border bg-forge-surface/40 px-4 py-2 text-[12px] font-semibold text-muted transition-colors hover:text-body disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : `Load ${Math.min(LIBRARY_PAGE_SIZE, total - products.length)} more`}
          </button>
        </div>
      )}
      </>
      )}

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="flex w-full max-w-lg max-h-[85vh] flex-col rounded-2xl border border-border bg-forge-bg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-[15px] font-bold text-heading">{selected.manufacturer} {selected.model_name}</h3>
              <button onClick={() => setSelected(null)} className="text-muted hover:text-heading transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 p-6 text-[13px]">
              <div className="grid grid-cols-2 gap-3">
                <DetailField label="Manufacturer" value={selected.manufacturer} />
                <DetailField label="Model" value={selected.model_name} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DetailField label="Category" value={selected.category} />
                <DetailField label="Part Number" value={selected.part_number} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <DetailField label="Unit Cost" value={selected.price ? `$${selected.price.toLocaleString()}` : null} />
                <DetailField label="MSRP" value={selected.msrp ? `$${selected.msrp.toLocaleString()}` : null} />
                <DetailField label="Cost" value={selected.cost ? `$${selected.cost.toLocaleString()}` : null} />
              </div>
              <DetailField label="Type" value={selected.type} />

              <div className="border-t border-border pt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Power &amp; Electrical</div>
                <div className="grid grid-cols-2 gap-3">
                  <DetailField label="Voltage" value={selected.voltage ? `${selected.voltage}V` : null} />
                  <DetailField label="Amp Draw" value={selected.amp_draw ? `${selected.amp_draw}A` : null} />
                  <DetailField label="Power" value={selected.power_watts ? `${selected.power_watts}W` : null} />
                  <DetailField label="BTU/hr" value={selected.btu_hr ? `${selected.btu_hr}` : null} />
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Physical</div>
                <DetailField label="Rack Mounted" value={selected.rack_mounted ? `Yes (${selected.rack_units ?? "?"}U)` : "No"} />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <DetailField label="Weight (lb)" value={selected.weight_lb} />
                  <div className="grid grid-cols-3 gap-2">
                    <DetailField label="W (in)" value={selected.width_in} />
                    <DetailField label="H (in)" value={selected.height_in} />
                    <DetailField label="D (in)" value={selected.depth_in} />
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Ports</div>
                {selected.ports && selected.ports.length > 0 ? (
                  <div className="space-y-2">
                    {selected.ports.map((port, i) => (
                      <div key={i} className="grid grid-cols-5 gap-2 rounded-md border border-border bg-forge-surface/40 px-2.5 py-1.5 text-[12px]">
                        <span className="text-body capitalize">{port.side}</span>
                        <span className="text-body uppercase">{port.dir}</span>
                        <span className="text-body">{port.signal || <span className="text-faint">—</span>}</span>
                        <span className="text-body">{port.label || <span className="text-faint">—</span>}</span>
                        <span className="text-body">{port.connector || <span className="text-faint">—</span>}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-faint">No ports defined.</p>
                )}
              </div>

              {selected.notes && (
                <div className="border-t border-border pt-4">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Notes</div>
                  <p className="text-[12px] text-body">{selected.notes}</p>
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-border px-6 py-4">
              <button
                onClick={() => addToOrgLibrary(selected)}
                disabled={!activeOrg || addingToOrg}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addedIds.has(selected.id) ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Added to My Organization&apos;s Equipment Library
                  </>
                ) : addingToOrg ? (
                  "Adding…"
                ) : (
                  "+ Add to My Organization's Equipment Library"
                )}
              </button>
              {!activeOrg && (
                <p className="mt-2 text-center text-[11px] text-faint">Select an organization first to add products to its library.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Override confirmation */}
      {overrideConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-forge-bg p-6 shadow-2xl">
            <h3 className="text-[15px] font-bold text-heading">Already in your library</h3>
            <p className="mt-2 text-[13px] text-muted">
              {overrideConfirm.product.manufacturer} {overrideConfirm.product.model_name} is already in your Organization&apos;s Equipment Library. Do you want to override it with the current AVGenix Equipment Library details?
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setOverrideConfirm(null)}
                className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-body"
              >
                Cancel
              </button>
              <button
                onClick={confirmOverride}
                disabled={addingToOrg}
                className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                {addingToOrg ? "Updating…" : "Yes, Override"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk override confirmation — same choice as the single-item Add
          flow above, for right-click "Add to My Organization's Equipment
          Library" on one or more rows that already exist in the org library
          (previously this silently skipped them with no way to update). */}
      {bulkOverrideConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-forge-bg p-6 shadow-2xl">
            <h3 className="text-[15px] font-bold text-heading">
              Already in your library
            </h3>
            <p className="mt-2 text-[13px] text-muted">
              {bulkOverrideConfirm.items.length === 1
                ? <>{bulkOverrideConfirm.items[0].product.manufacturer} {bulkOverrideConfirm.items[0].product.model_name} is already in your Organization&apos;s Equipment Library.</>
                : <>{bulkOverrideConfirm.items.length} of the selected items are already in your Organization&apos;s Equipment Library.</>}
              {" "}Do you want to override {bulkOverrideConfirm.items.length === 1 ? "it" : "them"} with the current AVGenix Equipment Library details?
            </p>
            {bulkOverrideConfirm.items.length > 1 && (
              <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-border bg-forge-surface/40 p-2 text-[12px] text-body">
                {bulkOverrideConfirm.items.map(({ product }) => (
                  <li key={product.id}>{product.manufacturer} {product.model_name}</li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={cancelBulkOverride}
                className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-body"
              >
                Cancel
              </button>
              <button
                onClick={confirmBulkOverride}
                disabled={bulkAdding}
                className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                {bulkAdding ? "Updating…" : bulkOverrideConfirm.items.length === 1 ? "Yes, Override" : "Yes, Override All"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            className="fixed z-50 w-64 overflow-hidden rounded-lg border border-border bg-forge-panel py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => { setContextMenu(null); addSelectedToOrgLibrary(); }}
              disabled={!activeOrg || bulkAdding}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-body transition-colors hover:bg-forge-surface/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
              Add to My Organization&apos;s Equipment Library{selectedIds.size > 1 ? ` (${selectedIds.size})` : ""}
            </button>
          </div>
        </>
      )}

      {/* Edit Modal */}
      {editingProduct && (
        <EquipmentFormModal
          title="Edit Product"
          value={avProductToFormValue(editingProduct)}
          onChange={(v) => setEditingProduct(applyFormValueToAVProduct(editingProduct, v))}
          onCancel={() => { setEditingProduct(null); setEditingKitItems([]); }}
          onSave={() => handleSaveProduct()}
          saving={savingProduct || checkingSimilarProducts}
          saveError={productSaveError}
          saveDisabled={!editingProduct.manufacturer.trim() || !editingProduct.model_name.trim()}
          categories={categories}
          notesLabel="Type"
          showAIImport
          aiMode="update"
          kitEnabled
          kitItems={editingKitItems}
          onKitItemsChange={setEditingKitItems}
          kitExcludeProductId={editingProduct.id}
        />
      )}

      {/* Add Modal */}
      {newProduct && (
        <EquipmentFormModal
          title="Add Product"
          value={avProductToFormValue(newProduct)}
          onChange={(v) => setNewProduct(applyFormValueToAVProduct(newProduct, v))}
          onCancel={() => { setNewProduct(null); setNewKitItems([]); }}
          onSave={() => handleSaveNewProduct()}
          saving={savingNewProduct || checkingSimilarProducts}
          saveError={newProductSaveError}
          saveDisabled={!newProduct.manufacturer.trim() || !newProduct.model_name.trim()}
          categories={categories}
          notesLabel="Type"
          showAIImport
          kitEnabled
          kitItems={newKitItems}
          onKitItemsChange={setNewKitItems}
        />
      )}

      {/* Delete confirmation */}
      {pendingDeleteProduct && (
        <ConfirmDialog
          title="Delete product"
          message={<>Delete <span className="font-semibold text-heading">{pendingDeleteProduct.manufacturer} {pendingDeleteProduct.model_name}</span> from the AVGenix Equipment Library? This removes it for every organization and cannot be undone.</>}
          busy={deletingProduct}
          onCancel={() => setPendingDeleteProduct(null)}
          onConfirm={handleDeleteProduct}
        />
      )}

      {/* Delete blocked — product is a component of one or more Kits */}
      {blockedDeleteProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm" onClick={() => setBlockedDeleteProduct(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-forge-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <h3 className="text-[16px] font-bold text-heading">Can&apos;t delete this part</h3>
              <p className="mt-1.5 text-[13px] text-body">
                <span className="font-semibold text-heading">{blockedDeleteProduct.product.manufacturer} {blockedDeleteProduct.product.model_name}</span>{" "}
                is a component of {blockedDeleteProduct.kits.length === 1 ? "this kit" : `${blockedDeleteProduct.kits.length} kits`} in the AVGenix Library. Remove it from{" "}
                {blockedDeleteProduct.kits.length === 1 ? "that kit" : "those kits"} first, then delete it.
              </p>
              <ul className="mt-3 space-y-1">
                {blockedDeleteProduct.kits.map((k) => (
                  <li key={k.id} className="rounded-lg border border-border bg-forge-surface/60 px-3 py-1.5 text-[12px] text-body">
                    {k.manufacturer} {k.model_name}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
              <button onClick={() => setBlockedDeleteProduct(null)} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-subtle hover:text-body">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Possible duplicate — hard-block until reviewed. This is a text-similarity
          match (see findSimilarProducts), not an exact one — the DB constraint
          already blocks exact duplicates silently and correctly; this catches the
          same product described slightly differently (e.g. "MIC POD CAT COUPLER"
          vs. "Mic Pod CAT Coupler Tx"), which no exact-match rule can. */}
      {similarProductPrompt && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm" onClick={() => setSimilarProductPrompt(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-forge-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <h3 className="text-[16px] font-bold text-heading">This might already be in the library</h3>
              <p className="mt-1.5 text-[13px] text-body">Found {similarProductPrompt.matches.length === 1 ? "a close match" : `${similarProductPrompt.matches.length} close matches`}:</p>
              <ul className="mt-3 space-y-1">
                {similarProductPrompt.matches.map((m) => (
                  <li key={m.id} className="rounded-lg border border-border bg-forge-surface/60 px-3 py-1.5 text-[12px] text-body">
                    <span className="font-semibold text-heading">{m.manufacturer} {m.model_name}</span>
                    {m.part_number && <span className="text-subtle"> · {m.part_number}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-subtle">If this is genuinely a different product, save it anyway. If it's the same thing, cancel and edit the existing entry instead.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
              <button onClick={() => setSimilarProductPrompt(null)} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-subtle hover:text-body">Cancel — let me check</button>
              <button
                onClick={() => {
                  const kind = similarProductPrompt.kind;
                  setSimilarProductPrompt(null);
                  if (kind === "new") handleSaveNewProduct(true);
                  else handleSaveProduct(true);
                }}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-500"
              >
                It&apos;s different — save anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Duplicates panel — an on-demand sweep of the whole library
          for near-duplicate clusters (see findLibraryDuplicateClusters),
          separate from the save-time hard block above: this surfaces
          duplicates that already made it into the data before that check
          existed, or that were bulk-imported. Purely a review list — merging
          or deleting is still done by hand via each entry's own Edit/Delete. */}
      {duplicateClusters && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm" onClick={() => setDuplicateClusters(null)}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-forge-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-[15px] font-bold text-heading">
                Possible Duplicates {duplicateClusters.length > 0 && <span className="text-subtle font-normal">({duplicateClusters.length})</span>}
              </h3>
              <button onClick={() => setDuplicateClusters(null)} className="text-muted hover:text-heading transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {duplicateClusters.length === 0 ? (
                <p className="text-center text-[13px] text-subtle py-8">No likely duplicates found.</p>
              ) : (
                duplicateClusters.map((cluster, i) => (
                  <div key={i} className="rounded-xl border border-border bg-forge-surface/30 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{cluster.products[0].manufacturer}</div>
                    <div className="space-y-1.5">
                      {cluster.products.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => openClusterProduct(p.id)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-forge-bg/60 px-3 py-2 text-left transition-colors hover:bg-forge-surface"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-heading">{p.model_name}</div>
                            <div className="text-[10px] text-subtle">{p.category}{p.part_number ? ` · ${p.part_number}` : ""}</div>
                          </div>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-[13px] text-body">{value ?? <span className="text-faint">—</span>}</div>
    </div>
  );
}

// ── My Organization's Equipment Library ──────────────────────────────────────

const emptyOrgItem = (orgId: string): Omit<OrgEquipmentItem, "id" | "user_id"> => ({
  org_id: orgId,
  category: "",
  manufacturer: "",
  model: "",
  description: "",
  unit_cost: 0,
  part_number: null,
  msrp: null,
  cost: null,
  margin: null,
  markup: null,
  color: null,
  ports: [],
  amp_draw: null,
  voltage: null,
  power_watts: null,
  btu_hr: null,
  rack_mounted: false,
  rack_units: null,
  rack_ear_included: null,
  width_in: null,
  height_in: null,
  depth_in: null,
  weight_lb: null,
  hfov_deg: null,
  vfov_deg: null,
  coverage_pattern: null,
  coverage_diameter_ft: null,
  coverage_angle_deg: null,
  coverage_width_ft: null,
  coverage_depth_ft: null,
});

function orgItemToFormValue(item: OrgEquipmentItem | Omit<OrgEquipmentItem, "id" | "user_id">): EquipmentFormValue {
  return {
    manufacturer: item.manufacturer,
    model: item.model,
    category: item.category,
    notes: item.description,
    unitCost: item.unit_cost,
    partNumber: item.part_number,
    msrp: item.msrp,
    cost: item.cost,
    margin: item.margin,
    markup: item.markup,
    ports: item.ports,
    ampDraw: item.amp_draw,
    voltage: item.voltage,
    powerWatts: item.power_watts,
    btuHr: item.btu_hr,
    rackMounted: item.rack_mounted,
    rackUnits: item.rack_units,
    rackEarsIncluded: item.rack_ear_included ?? false,
    widthIn: item.width_in,
    heightIn: item.height_in,
    depthIn: item.depth_in,
    diameterIn: item.diameter_in ?? null,
    weightLb: item.weight_lb,
    hfovDeg: item.hfov_deg,
    vfovDeg: item.vfov_deg,
    coveragePattern: item.coverage_pattern,
    coverageDiameterFt: item.coverage_diameter_ft,
    coverageAngleDeg: item.coverage_angle_deg,
    coverageWidthFt: item.coverage_width_ft,
    coverageDepthFt: item.coverage_depth_ft,
  };
}

function applyFormValueToOrgItem<T extends OrgEquipmentItem | Omit<OrgEquipmentItem, "id" | "user_id">>(base: T, v: EquipmentFormValue): T {
  return {
    ...base,
    manufacturer: v.manufacturer,
    model: v.model,
    category: v.category,
    description: v.notes,
    unit_cost: v.unitCost,
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
    rack_mounted: v.rackMounted,
    rack_units: v.rackUnits,
    rack_ear_included: v.rackEarsIncluded,
    width_in: v.widthIn,
    height_in: v.heightIn,
    depth_in: v.depthIn,
    // Only carried when there's something to say (a value, or an existing
    // column being cleared): the column comes from migration 025, and sending
    // the key at all to a database without it would fail the whole save.
    ...(v.diameterIn != null || "diameter_in" in base ? { diameter_in: v.diameterIn ?? null } : {}),
    weight_lb: v.weightLb,
    hfov_deg: v.hfovDeg,
    vfov_deg: v.vfovDeg,
    coverage_pattern: v.coveragePattern,
    coverage_diameter_ft: v.coverageDiameterFt,
    coverage_angle_deg: v.coverageAngleDeg,
    coverage_width_ft: v.coverageWidthFt,
    coverage_depth_ft: v.coverageDepthFt,
  };
}

// A Labor catalog entry — deliberately much lighter than OrgEquipmentItem
// (no manufacturer/ports/rack specs, none of which apply to labor). Rate is
// what you bill; Cost is your own loaded cost, so margin can be shown the
// same way equipment margin is.
type LaborItem = {
  id: string;
  org_id: string;
  user_id: string;
  label: string;
  rate: number;
  cost: number;
};

// A Bundle — a named set of this org's own library items (equipment or labor)
// with a quantity each (units, or hours for labor), saved once and addable to
// any future proposal. See migration 051_bundle_library.sql.
type BundleItemRef = { kind: "equipment" | "labor"; id: string; qty: number };
type BundleRow = { id: string; org_id: string; user_id: string; name: string; description: string; items: BundleItemRef[] };
type BundleDraft = { id?: string; name: string; description: string; items: BundleItemRef[] };

function friendlyBundleError(message: string): string {
  if (/bundle_library|schema cache|does not exist/i.test(message)) {
    return "Bundles aren't set up in the database yet — run migration 051_bundle_library.sql in Supabase, then reload.";
  }
  return message;
}

function OrgLibraryView({ onBack }: { onBack: () => void }) {
  const { activeOrg } = useOrg();
  const [items, setItems] = useState<OrgEquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<OrgEquipmentItem | Omit<OrgEquipmentItem, "id" | "user_id"> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<OrgEquipmentItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  // Equipment vs. Labor — same page, structurally different tables (see
  // LaborItem above), so they get their own tab rather than sharing columns
  // that mostly wouldn't apply to one or the other.
  const [libView, setLibView] = useState<"equipment" | "labor" | "bundles">("equipment");
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [bundlesLoading, setBundlesLoading] = useState(true);
  const [bundlesError, setBundlesError] = useState<string | null>(null);
  const [bundleDraft, setBundleDraft] = useState<BundleDraft | null>(null);
  const [savingBundle, setSavingBundle] = useState(false);
  const [bundleSaveError, setBundleSaveError] = useState<string | null>(null);
  const [deleteBundleConfirm, setDeleteBundleConfirm] = useState<BundleRow | null>(null);
  const [deletingBundle, setDeletingBundle] = useState(false);
  const [laborItems, setLaborItems] = useState<LaborItem[]>([]);
  const [laborLoading, setLaborLoading] = useState(true);
  const [laborSearch, setLaborSearch] = useState("");
  const [showLaborModal, setShowLaborModal] = useState(false);
  const [editingLabor, setEditingLabor] = useState<LaborItem | Omit<LaborItem, "id" | "user_id"> | null>(null);
  const [savingLabor, setSavingLabor] = useState(false);
  const [laborSaveError, setLaborSaveError] = useState<string | null>(null);
  const [deleteLaborConfirm, setDeleteLaborConfirm] = useState<LaborItem | null>(null);
  const [deletingLabor, setDeletingLabor] = useState(false);
  // The org's standard Labor Rates from Account Settings — what "Add Labor"
  // picks from, instead of typing a rate/cost by hand.
  const [laborRateTypes, setLaborRateTypes] = useState<LaborRateType[]>(DEFAULT_LABOR_RATE_TYPES);
  const [selectedRateKey, setSelectedRateKey] = useState("");

  useEffect(() => {
    if (!activeOrg) { setLoading(false); return; }
    setLoading(true);
    supabase
      .from("equipment_library")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("manufacturer")
      .order("model")
      .then(({ data }) => {
        setItems((data as OrgEquipmentItem[]) ?? []);
        setLoading(false);
      });
  }, [activeOrg?.id]);

  useEffect(() => {
    if (!activeOrg) { setLaborLoading(false); return; }
    setLaborLoading(true);
    supabase
      .from("labor_library")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("label")
      .then(({ data }) => {
        setLaborItems((data as LaborItem[]) ?? []);
        setLaborLoading(false);
      });
  }, [activeOrg?.id]);

  useEffect(() => {
    if (!activeOrg) { setBundlesLoading(false); return; }
    setBundlesLoading(true);
    supabase
      .from("bundle_library")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("name")
      .then(({ data, error }) => {
        if (error) { setBundlesError(friendlyBundleError(error.message)); setBundles([]); }
        else { setBundlesError(null); setBundles((data as BundleRow[]) ?? []); }
        setBundlesLoading(false);
      });
  }, [activeOrg?.id]);

  function openNewBundle() {
    setLibView("bundles");
    setBundleSaveError(null);
    setBundleDraft({ name: "", description: "", items: [] });
  }

  function openEditBundle(b: BundleRow) {
    setBundleSaveError(null);
    setBundleDraft({ id: b.id, name: b.name, description: b.description || "", items: b.items.map((i) => ({ ...i })) });
  }

  async function saveBundle() {
    if (!bundleDraft || !activeOrg) return;
    const name = bundleDraft.name.trim();
    if (!name || bundleDraft.items.length === 0) return;
    setSavingBundle(true);
    setBundleSaveError(null);
    const payload = { name, description: bundleDraft.description.trim(), items: bundleDraft.items, updated_at: new Date().toISOString() };
    if (bundleDraft.id) {
      const { error } = await supabase.from("bundle_library").update(payload).eq("id", bundleDraft.id);
      if (error) { setBundleSaveError(friendlyBundleError(error.message)); setSavingBundle(false); return; }
      setBundles((prev) => prev.map((b) => (b.id === bundleDraft.id ? { ...b, ...payload } : b)).sort((a, b) => a.name.localeCompare(b.name)));
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setBundleSaveError("Not signed in."); setSavingBundle(false); return; }
      const { data, error } = await supabase
        .from("bundle_library")
        .insert({ org_id: activeOrg.id, user_id: user.id, ...payload })
        .select("*")
        .single();
      if (error) { setBundleSaveError(friendlyBundleError(error.message)); setSavingBundle(false); return; }
      setBundlesError(null);
      setBundles((prev) => [...prev, data as BundleRow].sort((a, b) => a.name.localeCompare(b.name)));
    }
    setSavingBundle(false);
    setBundleDraft(null);
  }

  async function confirmDeleteBundle() {
    if (!deleteBundleConfirm) return;
    setDeletingBundle(true);
    await supabase.from("bundle_library").delete().eq("id", deleteBundleConfirm.id);
    setBundles((prev) => prev.filter((b) => b.id !== deleteBundleConfirm.id));
    setDeletingBundle(false);
    setDeleteBundleConfirm(null);
  }

  // Fetches the org's current standard Labor Rates fresh from the DB and
  // returns them (also updating state for the dropdown to render from).
  // Called both on mount AND every time the Add/Edit Labor modal opens —
  // Settings is a separate page, so an org-id-keyed effect alone would only
  // ever see whatever rates existed when this component first mounted, and
  // Next.js's client-side route cache can keep this component alive across a
  // visit to Settings and back, so even remounting isn't guaranteed. Fetching
  // again right before the modal opens is what actually guarantees freshness.
  const fetchLaborRateTypes = useCallback(async (): Promise<LaborRateType[]> => {
    if (!activeOrg) return DEFAULT_LABOR_RATE_TYPES;
    const { data } = await supabase.from("organizations").select("labor_line_items").eq("id", activeOrg.id).single();
    const types: LaborRateType[] =
      Array.isArray(data?.labor_line_items) && data.labor_line_items.length > 0
        ? data.labor_line_items
        : DEFAULT_LABOR_RATE_TYPES;
    setLaborRateTypes(types);
    return types;
  }, [activeOrg]);

  useEffect(() => {
    fetchLaborRateTypes().then((types) => {
      setSelectedRateKey((prev) => prev || types[0]?.key || "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id]);

  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort();

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    const matchSearch = !q || item.manufacturer.toLowerCase().includes(q) || item.model.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    const matchCat = !filterCategory || item.category === filterCategory;
    return matchSearch && matchCat;
  });

  const laborFiltered = laborItems.filter((item) => !laborSearch || item.label.toLowerCase().includes(laborSearch.toLowerCase()));

  function handleRowClick(e: React.MouseEvent, index: number) {
    const item = filtered[index];
    if (e.shiftKey && anchorIndex !== null) {
      const [start, end] = [Math.min(anchorIndex, index), Math.max(anchorIndex, index)];
      setSelectedIds(new Set(filtered.slice(start, end + 1).map((i) => i.id)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setAnchorIndex(index);
    } else {
      setSelectedIds(new Set([item.id]));
      setAnchorIndex(index);
    }
  }

  function handleRowContextMenu(e: React.MouseEvent, index: number) {
    e.preventDefault();
    const item = filtered[index];
    if (!selectedIds.has(item.id)) {
      setSelectedIds(new Set([item.id]));
      setAnchorIndex(index);
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  async function confirmBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = [...selectedIds];
    await supabase.from("equipment_library").delete().in("id", ids);
    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    setSelectedIds(new Set());
    setAnchorIndex(null);
    setDeleting(false);
    setBulkDeleteConfirm(false);
  }

  async function confirmBulkEdit() {
    if (selectedIds.size === 0 || !bulkCategory.trim()) return;
    setBulkSaving(true);
    const ids = [...selectedIds];
    const category = bulkCategory.trim();
    const { error } = await supabase.from("equipment_library").update({ category }).in("id", ids);
    if (!error) {
      setItems((prev) => prev.map((i) => (selectedIds.has(i.id) ? { ...i, category } : i)));
      setSelectedIds(new Set());
      setAnchorIndex(null);
    }
    setBulkSaving(false);
    setBulkEditOpen(false);
  }

  function openNew() {
    if (!activeOrg) return;
    setEditing(emptyOrgItem(activeOrg.id));
    setSaveError(null);
    setShowModal(true);
  }

  function openEdit(item: OrgEquipmentItem) {
    setEditing({ ...item });
    setSaveError(null);
    setShowModal(true);
  }

  function friendlySaveError(message: string): string {
    if (/duplicate key value/i.test(message)) return "An item with this manufacturer and model already exists in your library.";
    return message;
  }

  async function handleSave() {
    if (!editing || !activeOrg || !editing.manufacturer.trim() || !editing.model.trim()) return;
    setSaving(true);
    setSaveError(null);
    if ("id" in editing) {
      const { error } = await supabase
        .from("equipment_library")
        .update({
          category: editing.category,
          manufacturer: editing.manufacturer,
          model: editing.model,
          description: editing.description,
          unit_cost: editing.unit_cost,
          part_number: editing.part_number,
          msrp: editing.msrp,
          cost: editing.cost,
          margin: editing.margin,
          markup: editing.markup,
          color: editing.color,
          ports: editing.ports,
          amp_draw: editing.amp_draw,
          voltage: editing.voltage,
          power_watts: editing.power_watts,
          btu_hr: editing.btu_hr,
          rack_mounted: editing.rack_mounted,
          rack_units: editing.rack_units,
          rack_ear_included: editing.rack_ear_included,
          width_in: editing.width_in,
          height_in: editing.height_in,
          depth_in: editing.depth_in,
          ...("diameter_in" in editing ? { diameter_in: editing.diameter_in ?? null } : {}),
          weight_lb: editing.weight_lb,
        })
        .eq("id", editing.id);
      if (error) {
        setSaveError(friendlySaveError(error.message));
        setSaving(false);
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === editing.id ? (editing as OrgEquipmentItem) : i)));
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSaveError("Not signed in.");
        setSaving(false);
        return;
      }
      const { data, error } = await supabase
        .from("equipment_library")
        .insert({ ...editing, user_id: user.id })
        .select("*")
        .single();
      if (error) {
        setSaveError(friendlySaveError(error.message));
        setSaving(false);
        return;
      }
      setItems((prev) => [...prev, data as OrgEquipmentItem]);
    }
    setSaving(false);
    setShowModal(false);
    setEditing(null);
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);
    await supabase.from("equipment_library").delete().eq("id", deleteConfirm.id);
    setItems((prev) => prev.filter((i) => i.id !== deleteConfirm.id));
    setDeleting(false);
    setDeleteConfirm(null);
  }

  async function openNewLabor() {
    if (!activeOrg) return;
    setLibView("labor");
    const types = await fetchLaborRateTypes();
    setSelectedRateKey(types[0]?.key || "");
    setEditingLabor({ org_id: activeOrg.id, label: "", rate: 0, cost: 0 });
    setLaborSaveError(null);
    setShowLaborModal(true);
  }

  async function openEditLabor(item: LaborItem) {
    setLibView("labor");
    const types = await fetchLaborRateTypes();
    // Labor types aren't referenced by a stable id (Settings stores them as
    // a plain jsonb list), so matching by label is the best available link
    // back to "which standard rate is this" when re-opening an existing item.
    const match = types.find((t) => t.label === item.label);
    setSelectedRateKey(match?.key || "");
    setEditingLabor({ ...item });
    setLaborSaveError(null);
    setShowLaborModal(true);
  }

  async function handleSaveLabor() {
    const selectedType = laborRateTypes.find((t) => t.key === selectedRateKey);
    if (!editingLabor || !activeOrg || !selectedType) return;
    setSavingLabor(true);
    setLaborSaveError(null);
    // Snapshots the type's current label/rate/cost into the row, rather than
    // referencing it live — so a later rate change in Settings doesn't
    // retroactively change items already added to the Library (same
    // pricing-snapshot approach Procurement uses when releasing an order).
    const payload = { label: selectedType.label, rate: selectedType.rate, cost: selectedType.cost };
    if ("id" in editingLabor) {
      const { error } = await supabase.from("labor_library").update(payload).eq("id", editingLabor.id);
      if (error) {
        setLaborSaveError(error.message);
        setSavingLabor(false);
        return;
      }
      setLaborItems((prev) => prev.map((i) => (i.id === editingLabor.id ? { ...(editingLabor as LaborItem), ...payload } : i)));
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLaborSaveError("Not signed in.");
        setSavingLabor(false);
        return;
      }
      const { data, error } = await supabase
        .from("labor_library")
        .insert({ org_id: activeOrg.id, user_id: user.id, ...payload })
        .select("*")
        .single();
      if (error) {
        setLaborSaveError(error.message);
        setSavingLabor(false);
        return;
      }
      setLaborItems((prev) => [...prev, data as LaborItem]);
    }
    setSavingLabor(false);
    setShowLaborModal(false);
    setEditingLabor(null);
  }

  async function confirmDeleteLabor() {
    if (!deleteLaborConfirm) return;
    setDeletingLabor(true);
    await supabase.from("labor_library").delete().eq("id", deleteLaborConfirm.id);
    setLaborItems((prev) => prev.filter((i) => i.id !== deleteLaborConfirm.id));
    setDeletingLabor(false);
    setDeleteLaborConfirm(null);
  }

  const inputCls = "w-full rounded-lg border border-border bg-forge-surface/60 px-3 py-2 text-[13px] text-heading placeholder:text-faint focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30";
  const labelCls = "mb-1 block text-[11px] font-medium text-muted";

  if (!activeOrg) {
    return (
      <div className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-heading transition-colors">
            <ArrowLeftIcon />
            Library
          </button>
        </div>
        <div className="py-20 text-center text-sm text-subtle">Select an organization first.</div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-heading transition-colors">
            <ArrowLeftIcon />
            Library
          </button>
          <span className="text-border">/</span>
          <h2 className="text-xl font-bold text-heading">My Library</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openNew}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-blue-500"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Equipment
          </button>
          <button
            onClick={openNewLabor}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-violet-500"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Labor
          </button>
          <button
            type="button"
            onClick={openNewBundle}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-violet-500"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Bundle
          </button>
        </div>
      </div>

      {/* Equipment / Labor tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-forge-surface/40 p-1">
        <button
          onClick={() => setLibView("equipment")}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${libView === "equipment" ? "bg-forge-panel text-heading shadow-sm" : "text-muted hover:text-body"}`}
        >
          Equipment · {items.length}
        </button>
        <button
          onClick={() => setLibView("labor")}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${libView === "labor" ? "bg-forge-panel text-heading shadow-sm" : "text-muted hover:text-body"}`}
        >
          Labor · {laborItems.length}
        </button>
        <button
          onClick={() => setLibView("bundles")}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${libView === "bundles" ? "bg-forge-panel text-heading shadow-sm" : "text-muted hover:text-body"}`}
        >
          Bundles · {bundles.length}
        </button>
      </div>

      {libView === "bundles" ? (
      <BundlesTable
        bundles={bundles}
        loading={bundlesLoading}
        error={bundlesError}
        equipment={items}
        labor={laborItems}
        onAddFirst={openNewBundle}
        onEdit={openEditBundle}
        onDelete={setDeleteBundleConfirm}
      />
      ) : libView === "labor" ? (
      <LaborTable
        items={laborFiltered}
        totalCount={laborItems.length}
        loading={laborLoading}
        search={laborSearch}
        onSearchChange={setLaborSearch}
        onAddFirst={openNewLabor}
        onEdit={openEditLabor}
        onDelete={setDeleteLaborConfirm}
      />
      ) : (
      <>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by manufacturer, model, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="forge-input w-full pl-8 text-[13px]"
          />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="forge-input w-auto min-w-[140px] text-[13px]">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        {(search || filterCategory) && (
          <button onClick={() => { setSearch(""); setFilterCategory(""); }} className="text-[12px] font-medium text-blue-400 hover:text-blue-300 transition-colors">
            Clear
          </button>
        )}
        {selectedIds.size > 0 && (
          <span className="text-[12px] font-medium text-blue-400">
            {selectedIds.size} selected ·{" "}
            <button onClick={() => { setSelectedIds(new Set()); setAnchorIndex(null); }} className="font-medium text-blue-400 underline hover:text-blue-300">
              Clear
            </button>
          </span>
        )}
        <span className="ml-auto text-[12px] text-subtle">{filtered.length} of {items.length} items</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-forge-surface/20 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-forge-surface/60">
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Manufacturer / Model</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Category</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Description</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted">Unit Cost</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-[13px] text-subtle">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-[13px] text-subtle">
                    {items.length === 0 ? (
                      <>
                        No equipment yet.{" "}
                        <button onClick={openNew} className="text-blue-400 hover:text-blue-300 transition-colors">Add your first equipment</button>
                        {" "}or add equipment from the AVGenix Equipment Library.
                      </>
                    ) : (
                      "No items found."
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((item, index) => (
                  <tr
                    key={item.id}
                    onClick={(e) => handleRowClick(e, index)}
                    onDoubleClick={() => openEdit(item)}
                    onContextMenu={(e) => handleRowContextMenu(e, index)}
                    className={`cursor-pointer select-none border-b border-border/50 transition-colors ${
                      selectedIds.has(item.id) ? "bg-blue-500/10 hover:bg-blue-500/15" : "hover:bg-forge-surface/40"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-semibold text-heading">{item.manufacturer}</div>
                      <div className="text-[11px] text-subtle">{item.model}</div>
                    </td>
                    <td className="px-4 py-3">
                      {item.category ? (
                        <span className="inline-flex items-center rounded-full bg-forge-surface px-2.5 py-0.5 text-[11px] font-medium text-muted">{item.category}</span>
                      ) : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-body">{item.description || <span className="text-faint">—</span>}</td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-body">
                      {item.unit_cost ? `$${item.unit_cost.toLocaleString()}` : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(item); }} className="rounded-md p-1.5 text-muted transition-colors hover:bg-forge-surface hover:text-heading">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(item); }} className="rounded-md p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-400">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* Add / Edit Modal */}
      {showModal && editing && (
        <EquipmentFormModal
          title={"id" in editing ? "Edit Item" : "Add Item"}
          value={orgItemToFormValue(editing)}
          onChange={(v) => setEditing(applyFormValueToOrgItem(editing, v))}
          onCancel={() => { setShowModal(false); setEditing(null); }}
          onSave={handleSave}
          saving={saving}
          saveError={saveError}
          saveDisabled={!editing.manufacturer.trim() || !editing.model.trim()}
          categories={categories}
          showAIImport
          aiMode={"id" in editing ? "update" : "create"}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-forge-bg p-6 shadow-2xl">
            <h3 className="text-[15px] font-bold text-heading">Delete item?</h3>
            <p className="mt-2 text-[13px] text-muted">
              Delete <span className="font-medium text-body">{deleteConfirm.manufacturer} {deleteConfirm.model}</span> from your organization&apos;s equipment library? This cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-body"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            className="fixed z-50 w-44 overflow-hidden rounded-lg border border-border bg-forge-panel py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => { setContextMenu(null); setBulkCategory(""); setBulkEditOpen(true); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-body transition-colors hover:bg-forge-surface/60"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit{selectedIds.size > 1 ? ` (${selectedIds.size})` : ""}
            </button>
            <button
              onClick={() => { setContextMenu(null); setBulkDeleteConfirm(true); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-red-400 transition-colors hover:bg-red-500/10"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
              Delete{selectedIds.size > 1 ? ` (${selectedIds.size})` : ""}
            </button>
          </div>
        </>
      )}

      {/* Bulk delete confirmation */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-forge-bg p-6 shadow-2xl">
            <h3 className="text-[15px] font-bold text-heading">Delete {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}?</h3>
            <p className="mt-2 text-[13px] text-muted">
              This will permanently remove the selected equipment from your organization&apos;s library. This cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setBulkDeleteConfirm(false)}
                className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-body"
              >
                Cancel
              </button>
              <button
                onClick={confirmBulkDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk edit — category only, for now */}
      {bulkEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-forge-bg shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-[15px] font-bold text-heading">Edit {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}</h3>
              <button onClick={() => setBulkEditOpen(false)} className="text-muted hover:text-heading transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-[12px] text-subtle">Only Category can be bulk-updated for now.</p>
              <div>
                <label className={labelCls}>Category</label>
                <input
                  type="text"
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Display"
                  list="org-lib-bulk-categories"
                  autoFocus
                />
                <datalist id="org-lib-bulk-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              <button onClick={() => setBulkEditOpen(false)} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-body">
                Cancel
              </button>
              <button onClick={confirmBulkEdit} disabled={bulkSaving || !bulkCategory.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50">
                {bulkSaving ? "Saving…" : "Update Category"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Labor Modal */}
      {showLaborModal && editingLabor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-forge-bg shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-[15px] font-bold text-heading">{"id" in editingLabor ? "Edit Labor Item" : "Add Labor Item"}</h3>
              <button onClick={() => { setShowLaborModal(false); setEditingLabor(null); }} className="text-muted hover:text-heading transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {laborRateTypes.length === 0 ? (
              <div className="p-6 text-[13px] text-muted">
                No labor rates configured yet. Add them in{" "}
                <Link href="/org/settings" className="text-violet-400 hover:text-violet-300 transition-colors">Account Settings → Labor Rates and Costs</Link>
                {" "}first, then come back here to add them to your Library.
              </div>
            ) : (
              <div className="p-6 space-y-3">
                <div>
                  <label className={labelCls}>Labor Type</label>
                  <select
                    value={selectedRateKey}
                    onChange={(e) => setSelectedRateKey(e.target.value)}
                    className={inputCls}
                    autoFocus
                  >
                    {laborRateTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] text-subtle">
                    From your org&apos;s standard rates — manage these in{" "}
                    <Link href="/org/settings" className="text-violet-400 hover:text-violet-300 transition-colors">Account Settings</Link>.
                  </p>
                </div>
                {(() => {
                  const selectedType = laborRateTypes.find((t) => t.key === selectedRateKey);
                  if (!selectedType) return null;
                  return (
                    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-forge-surface/40 p-3">
                      <div>
                        <div className="text-[11px] text-muted">Billing Rate</div>
                        <div className="font-mono text-[13px] text-heading">${selectedType.rate.toLocaleString()}/hr</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">Your Cost</div>
                        <div className="font-mono text-[13px] text-heading">${selectedType.cost.toLocaleString()}/hr</div>
                      </div>
                    </div>
                  );
                })()}
                {laborSaveError && <p className="text-[12px] text-red-400">{laborSaveError}</p>}
              </div>
            )}
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              <button onClick={() => { setShowLaborModal(false); setEditingLabor(null); }} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-body">
                Cancel
              </button>
              <button onClick={handleSaveLabor} disabled={savingLabor || laborRateTypes.length === 0 || !selectedRateKey} className="rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50">
                {savingLabor ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Bundle */}
      {bundleDraft && (
        <BundleModal
          draft={bundleDraft}
          equipment={items}
          labor={laborItems}
          saving={savingBundle}
          error={bundleSaveError}
          onChange={setBundleDraft}
          onSave={saveBundle}
          onClose={() => { setBundleDraft(null); setBundleSaveError(null); }}
        />
      )}

      {/* Delete Bundle confirmation */}
      {deleteBundleConfirm && (
        <ConfirmDialog
          title="Delete bundle?"
          message={<>Delete <span className="font-semibold text-heading">{deleteBundleConfirm.name}</span>? Proposals that already used it keep their lines; it just won&apos;t be available to add anymore.</>}
          confirmLabel={deletingBundle ? "Deleting…" : "Delete"}
          onCancel={() => setDeleteBundleConfirm(null)}
          onConfirm={confirmDeleteBundle}
        />
      )}

      {/* Delete Labor confirmation */}
      {deleteLaborConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-forge-bg p-6 shadow-2xl">
            <h3 className="text-[15px] font-bold text-heading">Delete labor item?</h3>
            <p className="mt-2 text-[13px] text-muted">
              Delete <span className="font-medium text-body">{deleteLaborConfirm.label}</span> from your organization&apos;s labor rates? This cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteLaborConfirm(null)}
                className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-body"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteLabor}
                disabled={deletingLabor}
                className="rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {deletingLabor ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Quantity box that keeps what you type (no stuck leading 0 when clearing it);
// an empty/zero entry snaps back to the minimum when you leave the field.
function QtyInput({ value, min, step, onChange }: { value: number; min: number; step: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if ((parseFloat(text) || 0) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number" min={min} step={step}
      value={text}
      onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); if (n > 0) onChange(n); }}
      onBlur={() => { if (!(parseFloat(text) > 0)) { setText(String(min)); onChange(min); } }}
      className="forge-input w-20 text-right text-[12px]"
    />
  );
}

function BundlesTable({ bundles, loading, error, equipment, labor, onAddFirst, onEdit, onDelete }: {
  bundles: BundleRow[];
  loading: boolean;
  error: string | null;
  equipment: OrgEquipmentItem[];
  labor: LaborItem[];
  onAddFirst: () => void;
  onEdit: (b: BundleRow) => void;
  onDelete: (b: BundleRow) => void;
}) {
  const label = (r: BundleItemRef) => {
    if (r.kind === "labor") return labor.find((l) => l.id === r.id)?.label;
    const e = equipment.find((x) => x.id === r.id);
    return e ? `${e.manufacturer} ${e.model}`.trim() : undefined;
  };
  return (
    <div className="rounded-xl border border-border bg-forge-surface/20 overflow-hidden">
      {error && <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2.5 text-[12px] text-red-400">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-border bg-forge-surface/60">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Bundle</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Contents</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted">Items</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-16 text-center text-[13px] text-subtle">Loading…</td></tr>
            ) : bundles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-16 text-center text-[13px] text-subtle">
                  No bundles yet.{" "}
                  <button onClick={onAddFirst} className="text-violet-400 hover:text-violet-300 transition-colors">Create your first bundle</button>
                  {" "}— a saved set of equipment and labor you can add to any proposal in one click.
                </td>
              </tr>
            ) : (
              bundles.map((b) => {
                const names = b.items.map(label).filter(Boolean) as string[];
                return (
                  <tr key={b.id} onDoubleClick={() => onEdit(b)} className="border-b border-border/50 transition-colors hover:bg-forge-surface/40">
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-semibold text-heading">{b.name}</div>
                      {b.description && <div className="text-[11px] text-subtle">{b.description}</div>}
                    </td>
                    <td className="max-w-[420px] truncate px-4 py-3 text-[12px] text-body" title={names.join(", ")}>
                      {names.length ? names.join(", ") : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-body">{b.items.length}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => onEdit(b)} title="Edit" className="rounded-md p-1.5 text-muted transition-colors hover:bg-forge-surface hover:text-heading">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button onClick={() => onDelete(b)} title="Delete" className="rounded-md p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-400">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BundleModal({ draft, equipment, labor, saving, error, onChange, onSave, onClose }: {
  draft: BundleDraft;
  equipment: OrgEquipmentItem[];
  labor: LaborItem[];
  saving: boolean;
  error: string | null;
  onChange: (d: BundleDraft) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const eqMatches = equipment.filter((e) => !q || e.manufacturer.toLowerCase().includes(q) || e.model.toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q));
  const laborMatches = labor.filter((l) => !q || l.label.toLowerCase().includes(q));

  function addItem(kind: BundleItemRef["kind"], id: string) {
    const existing = draft.items.find((i) => i.kind === kind && i.id === id);
    onChange({
      ...draft,
      items: existing
        ? draft.items.map((i) => (i === existing ? { ...i, qty: i.qty + 1 } : i))
        : [...draft.items, { kind, id, qty: 1 }],
    });
  }
  function setQty(index: number, qty: number) {
    onChange({ ...draft, items: draft.items.map((i, n) => (n === index ? { ...i, qty } : i)) });
  }
  function removeAt(index: number) {
    onChange({ ...draft, items: draft.items.filter((_, n) => n !== index) });
  }
  const describe = (r: BundleItemRef) => {
    if (r.kind === "labor") return labor.find((l) => l.id === r.id)?.label ?? "Removed labor item";
    const e = equipment.find((x) => x.id === r.id);
    return e ? `${e.manufacturer} ${e.model}`.trim() : "Removed equipment item";
  };
  const canSave = draft.name.trim() !== "" && draft.items.length > 0 && !saving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-forge-bg shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-[15px] font-bold text-heading">{draft.id ? "Edit Bundle" : "Add Bundle"}</h3>
          <button onClick={onClose} className="text-muted transition-colors hover:text-heading">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="shrink-0 space-y-3 border-b border-border px-6 py-4">
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="Bundle name, e.g. Huddle Room Package"
            className="forge-input w-full text-[13px]"
            autoFocus
          />
          <input
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            placeholder="Description (optional)"
            className="forge-input w-full text-[13px]"
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-2">
          {/* Pick items */}
          <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
            <div className="shrink-0 px-6 pt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Add from My Library</div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search equipment and labor…"
                className="forge-input mb-3 w-full text-[13px]"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" style={{ maxHeight: "44vh" }}>
              {laborMatches.length === 0 && eqMatches.length === 0 ? (
                <div className="px-3 py-8 text-center text-[13px] text-subtle">
                  {equipment.length === 0 && labor.length === 0 ? "Your library is empty — add equipment or labor first." : "Nothing matches."}
                </div>
              ) : (
                <>
                  {laborMatches.map((l) => (
                    <button key={l.id} onClick={() => addItem("labor", l.id)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-forge-surface/50">
                      <span className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-body">{l.label}</span>
                        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">Labor</span>
                      </span>
                      <span className="text-[12px] text-blue-400">+ Add</span>
                    </button>
                  ))}
                  {eqMatches.map((e) => (
                    <button key={e.id} onClick={() => addItem("equipment", e.id)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-forge-surface/50">
                      <span className="min-w-0">
                        <span className="text-[13px] font-semibold text-body">{e.manufacturer}</span>{" "}
                        <span className="text-[13px] text-muted">{e.model}</span>
                        {e.description && <span className="block truncate text-[11px] text-subtle">{e.description}</span>}
                      </span>
                      <span className="ml-3 shrink-0 text-[12px] text-blue-400">+ Add</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* What's in the bundle */}
          <div className="flex min-h-0 flex-col">
            <div className="shrink-0 px-6 pt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">In this bundle · {draft.items.length}</div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-2" style={{ maxHeight: "44vh" }}>
              {draft.items.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-subtle">Click + Add on the left to put items in this bundle.</div>
              ) : (
                draft.items.map((r, n) => (
                  <div key={`${r.kind}-${r.id}`} className="flex items-center gap-2 border-b border-border/50 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-body">{describe(r)}</div>
                      {r.kind === "labor" && <div className="text-[10px] uppercase tracking-wider text-violet-300">Labor · hours</div>}
                    </div>
                    <QtyInput value={r.qty} min={r.kind === "labor" ? 0.25 : 1} step={r.kind === "labor" ? 0.25 : 1} onChange={(v) => setQty(n, v)} />
                    <button onClick={() => removeAt(n)} title="Remove" className="rounded-md p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-400">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-4">
          <p className="min-w-0 flex-1 text-[12px] text-red-400">{error}</p>
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-body">Cancel</button>
          <button onClick={onSave} disabled={!canSave} className="rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50">
            {saving ? "Saving…" : "Save Bundle"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LaborTable({ items, totalCount, loading, search, onSearchChange, onAddFirst, onEdit, onDelete }: {
  items: LaborItem[];
  totalCount: number;
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  onAddFirst: () => void;
  onEdit: (item: LaborItem) => void;
  onDelete: (item: LaborItem) => void;
}) {
  return (
    <>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by label…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="forge-input w-full pl-8 text-[13px]"
          />
        </div>
        <span className="ml-auto text-[12px] text-subtle">{items.length} of {totalCount} items</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-forge-surface/20 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-border bg-forge-surface/60">
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Label</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted">Billing Rate</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted">Your Cost</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted">Margin</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-[13px] text-subtle">Loading…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-[13px] text-subtle">
                    {totalCount === 0 ? (
                      <>
                        No labor items yet.{" "}
                        <button onClick={onAddFirst} className="text-violet-400 hover:text-violet-300 transition-colors">Add your first labor item</button>
                      </>
                    ) : (
                      "No items found."
                    )}
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const margin = item.rate > 0 ? ((item.rate - item.cost) / item.rate) * 100 : null;
                  return (
                    <tr key={item.id} className="border-b border-border/50 transition-colors hover:bg-forge-surface/40">
                      <td className="px-4 py-3 text-[13px] font-semibold text-heading">{item.label}</td>
                      <td className="px-4 py-3 text-right font-mono text-[12px] text-body">${item.rate.toLocaleString()}/hr</td>
                      <td className="px-4 py-3 text-right font-mono text-[12px] text-body">${item.cost.toLocaleString()}/hr</td>
                      <td className="px-4 py-3 text-right font-mono text-[12px] text-body">{margin === null ? <span className="text-faint">—</span> : `${margin.toFixed(0)}%`}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => onEdit(item)} className="rounded-md p-1.5 text-muted transition-colors hover:bg-forge-surface hover:text-heading">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button onClick={() => onDelete(item)} className="rounded-md p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-400">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── AVGenix Library → Labor ──────────────────────────────────────────────────
// Labor rates are per organization, so there's no shared labor catalog to
// browse. This lists the standard labor types as templates: "Add to My
// Library" copies one into the org's labor_library with the rate/cost entered
// here — prefilled from Account Settings → Labor Rates and Costs when a type
// with the same label is configured there.
function StandardLaborView() {
  const { activeOrg } = useOrg();
  const [search, setSearch] = useState("");
  const [inputs, setInputs] = useState<Record<string, { rate: string; cost: string }>>({});
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    Promise.all([
      supabase.from("organizations").select("labor_line_items").eq("id", activeOrg.id).single(),
      supabase.from("labor_library").select("label").eq("org_id", activeOrg.id),
    ]).then(([{ data: org }, { data: lib }]) => {
      if (cancelled) return;
      const configured: LaborRateType[] = Array.isArray(org?.labor_line_items) ? org.labor_line_items : [];
      const next: Record<string, { rate: string; cost: string }> = {};
      DEFAULT_LABOR_RATE_TYPES.forEach((t) => {
        const match = configured.find((c) => c.label.trim().toLowerCase() === t.label.toLowerCase());
        next[t.key] = { rate: match?.rate ? String(match.rate) : "", cost: match?.cost ? String(match.cost) : "" };
      });
      setInputs(next);
      setInLibrary(new Set((lib ?? []).map((l: { label: string }) => l.label.trim().toLowerCase())));
    });
    return () => { cancelled = true; };
  }, [activeOrg?.id]);

  async function addToLibrary(type: LaborRateType) {
    if (!activeOrg) return;
    const rate = parseFloat(inputs[type.key]?.rate ?? "");
    const cost = parseFloat(inputs[type.key]?.cost ?? "") || 0;
    if (!(rate > 0)) { setError(`Enter a billing rate for ${type.label} before adding it.`); return; }
    setError(null);
    setBusyKey(type.key);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in."); setBusyKey(null); return; }
    const { error: insertError } = await supabase
      .from("labor_library")
      .insert({ org_id: activeOrg.id, user_id: user.id, label: type.label, rate, cost });
    if (insertError) setError(insertError.message);
    else setInLibrary((prev) => new Set(prev).add(type.label.trim().toLowerCase()));
    setBusyKey(null);
  }

  const q = search.trim().toLowerCase();
  const types = DEFAULT_LABOR_RATE_TYPES.filter((t) => !q || t.label.toLowerCase().includes(q));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search labor types…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="forge-input w-full pl-8 text-[13px]"
          />
        </div>
        <span className="text-[12px] text-subtle">Standard labor types — set your rate, then add to My Library.</span>
        <span className="ml-auto text-[12px] text-subtle">{types.length} of {DEFAULT_LABOR_RATE_TYPES.length} types</span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-2 text-[12px] text-red-400">{error}</div>
      )}

      <div className="rounded-xl border border-border bg-forge-surface/20 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-border bg-forge-surface/60">
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted">Labor Type</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted">Billing Rate ($/hr)</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted">Your Cost ($/hr)</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {types.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-16 text-center text-[13px] text-subtle">No labor types found.</td>
                </tr>
              ) : (
                types.map((t) => {
                  const added = inLibrary.has(t.label.trim().toLowerCase());
                  return (
                    <tr key={t.key} className="border-b border-border/50 transition-colors hover:bg-forge-surface/40">
                      <td className="px-4 py-3 text-[13px] font-semibold text-heading">{t.label}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number" min="0" step="0.01"
                          value={inputs[t.key]?.rate ?? ""}
                          onChange={(e) => setInputs((p) => ({ ...p, [t.key]: { rate: e.target.value, cost: p[t.key]?.cost ?? "" } }))}
                          disabled={added}
                          placeholder="0.00"
                          className="forge-input w-28 text-right text-[12px] disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number" min="0" step="0.01"
                          value={inputs[t.key]?.cost ?? ""}
                          onChange={(e) => setInputs((p) => ({ ...p, [t.key]: { rate: p[t.key]?.rate ?? "", cost: e.target.value } }))}
                          disabled={added}
                          placeholder="0.00"
                          className="forge-input w-28 text-right text-[12px] disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {added ? (
                          <span className="text-[12px] font-medium text-emerald-400">In My Library</span>
                        ) : (
                          <button
                            onClick={() => addToLibrary(t)}
                            disabled={busyKey === t.key}
                            className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
                          >
                            {busyKey === t.key ? "Adding…" : "Add to My Library"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Placeholder sections ─────────────────────────────────────────────────────

function PlaceholderView({ label, description, icon, iconBg, iconColor, onBack }: {
  label: string; description: string; icon: React.ReactNode;
  iconBg: string; iconColor: string; onBack: () => void;
}) {
  return (
    <div className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-heading transition-colors">
          <ArrowLeftIcon />
          Library
        </button>
        <span className="text-border">/</span>
        <h2 className="text-xl font-bold text-heading">{label}</h2>
      </div>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${iconBg} ${iconColor}`}>
          {icon}
        </div>
        <div className="text-[16px] font-semibold text-heading">{label}</div>
        <div className="mt-2 text-[13px] text-muted max-w-sm">{description}</div>
        <div className="mt-4 rounded-full border border-border px-4 py-1.5 text-[12px] text-subtle">Coming soon</div>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryPageInner />
    </Suspense>
  );
}

function LibraryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSection = searchParams.get("section") as Section | null;

  function goToSection(section: Section | null) {
    router.push(section ? `/inventory?section=${section}` : "/inventory");
  }

  if (activeSection === "inventory") {
    return <InventoryView onBack={() => goToSection(null)} />;
  }

  if (activeSection === "org") {
    return <OrgLibraryView onBack={() => goToSection(null)} />;
  }

  if (activeSection === "avgenix") {
    return <AVGenixLibraryView onBack={() => goToSection(null)} />;
  }

  return <LandingView onSelect={goToSection} />;
}
