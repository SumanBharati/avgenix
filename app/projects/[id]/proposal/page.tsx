"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/components/OrgProvider";
import { loadToolData } from "@/lib/tool-data";
import { getProductById } from "@/lib/av-products";
import { createSurveyRoom, renameSurveyRoom, deleteSurveyRoom } from "@/lib/site-survey";
import { marginFromPrice } from "@/lib/pricing";
import { itemMargin as sharedItemMargin, itemMarkup as sharedItemMarkup, itemPrice as sharedItemPrice, itemLineTotal as sharedItemLineTotal, sectionSubtotalPrice as sharedSectionSubtotalPrice, computeProposalTotals, changeOrderCostImpact, type RemovedChangeOrderItem } from "@/lib/proposal-pricing";
import ConfirmDialog from "@/components/ConfirmDialog";



interface LineItem {
  id: string;
  category: string;
  manufacturer: string;
  model: string;
  partNumber?: string;
  description: string;
  qty: number;
  unitCost: number;
  // Only one of these is ever stored as an explicit override — whichever the
  // user last edited. When both are null, the item falls back to the
  // proposal's default Margin % (see itemMargin below) rather than showing a
  // blank/zero price.
  margin: number | null;
  markup: number | null;
  laborHours: number;
  laborRate: number;
  // Set when this line was added while editing under a Change Order (see the
  // "Change Order" bar below the header) — lets that CO's cost impact be
  // computed live from the current price of whatever it added.
  changeOrderId?: string | null;
}

interface ChangeOrderSummary {
  id: string;
  title: string;
  status: string;
}

interface Section {
  id: string;
  name: string;
  items: LineItem[];
  scopeOfWork: string;
  // Present only for a section auto-created from a Site Survey room — ties it
  // back to that room so its Design Engineering tools can populate/re-sync it.
  roomId?: string;
  // Whether an auto-populate attempt has already run for this section (even if
  // it found nothing) — prevents re-populating a section the user emptied out.
  bomSynced?: boolean;
}

interface ProposalData {
  clientName: string;
  projectName: string;
  sections: Section[];
  taxRate: number;
  marginPercent: number;
}

const CATEGORIES = [
  "Display", "Audio", "Video Processing", "Control System", "Cabling",
  "Mounting Hardware", "Networking", "Labor", "Miscellaneous",
];

interface EquipmentEntry {
  id: string;
  category: string;
  manufacturer: string;
  model: string;
  partNumber?: string;
  description: string;
  unitCost: number;
  margin?: number | null;
  markup?: number | null;
}

// A labor_library catalog entry (My Organization's Library → Labor tab).
// Billed flat as laborHours * laborRate, never marked up like equipment —
// see the "Labor Breakdown" comment further down.
interface LaborLibraryEntry {
  id: string;
  label: string;
  rate: number;
  cost: number;
}



const DEFAULT_LIBRARY: EquipmentEntry[] = [
  { id: "eq-1",  category: "Display",           manufacturer: "Samsung",     model: "QM85R",           description: "85\" 4K UHD Commercial Display",               unitCost: 3200 },
  { id: "eq-2",  category: "Display",           manufacturer: "LG",          model: "LAEC015",         description: "LED All-in-One 136\" Display",                  unitCost: 18500 },
  { id: "eq-3",  category: "Display",           manufacturer: "Epson",       model: "EB-PU2220B",      description: "20,000 Lumen WUXGA 3LCD Laser Projector",      unitCost: 14500 },
  { id: "eq-4",  category: "Audio",             manufacturer: "Shure",       model: "MXA920",          description: "Ceiling Array Microphone",                     unitCost: 2800 },
  { id: "eq-5",  category: "Audio",             manufacturer: "QSC",         model: "Core 110f",       description: "Q-SYS Network Audio DSP",                      unitCost: 4200 },
  { id: "eq-6",  category: "Audio",             manufacturer: "JBL",         model: "CBT 70J-1",       description: "Constant Beamwidth Column Speaker",            unitCost: 1100 },
  { id: "eq-7",  category: "Audio",             manufacturer: "Biamp",       model: "TesiraFORTE AI",  description: "AVB DSP with 12 analog inputs",                unitCost: 3600 },
  { id: "eq-8",  category: "Video Processing",  manufacturer: "Crestron",    model: "DM-NVX-363",      description: "4K60 HDR Network AV Encoder/Decoder",          unitCost: 2100 },
  { id: "eq-9",  category: "Video Processing",  manufacturer: "Extron",      model: "DTP2 T 212",      description: "4K/60 HDMI Twisted Pair Transmitter",          unitCost: 680 },
  { id: "eq-10", category: "Video Processing",  manufacturer: "Barco",       model: "E2",              description: "Event Master Presentation Processor",          unitCost: 32000 },
  { id: "eq-11", category: "Control System",    manufacturer: "Crestron",    model: "CP4N",            description: "4-Series Control Processor",                   unitCost: 3500 },
  { id: "eq-12", category: "Control System",    manufacturer: "Crestron",    model: "TSW-1070",        description: "10.1\" Touch Screen",                          unitCost: 2200 },
  { id: "eq-13", category: "Control System",    manufacturer: "Extron",      model: "IPCP Pro 550",    description: "IP Link Pro Control Processor",                unitCost: 2800 },
  { id: "eq-14", category: "Cabling",           manufacturer: "Crestron",    model: "CBL-HD-30",       description: "HDMI Cable, 30ft, Plenum Rated",               unitCost: 85 },
  { id: "eq-15", category: "Cabling",           manufacturer: "Liberty",     model: "?"  ,             description: "Cat6A Plenum Cable, 1000ft Box",               unitCost: 320 },
  { id: "eq-16", category: "Mounting Hardware",  manufacturer: "Chief",       model: "XTM1U",           description: "X-Large Flat Panel Tilt Wall Mount",           unitCost: 350 },
  { id: "eq-17", category: "Mounting Hardware",  manufacturer: "Peerless-AV", model: "DS-VW765-LQR",   description: "Full-Service Video Wall Mount",                unitCost: 280 },
  { id: "eq-18", category: "Networking",        manufacturer: "Cisco",       model: "C9300-48P",       description: "Catalyst 9300 48-Port PoE+ Switch",            unitCost: 8500 },
  { id: "eq-19", category: "Networking",        manufacturer: "Netgear",     model: "M4300-96X",       description: "96-Port Managed AV-over-IP Switch",            unitCost: 12000 },
  { id: "eq-20", category: "Audio",             manufacturer: "Sennheiser",  model: "TeamConnect Bar M", description: "All-in-One Video Bar for Medium Rooms",       unitCost: 3200 },
];


// margin/markup default to null (no per-item override) — itemMargin() below
// falls back to the proposal's default Margin % live, so a fresh item always
// prices correctly and stays in sync if that default changes later.
function newItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    category: CATEGORIES[0],
    manufacturer: "",
    model: "",
    partNumber: "",
    description: "",
    qty: 1,
    unitCost: 0,
    margin: null,
    markup: null,
    laborHours: 0,
    laborRate: 85,
  };
}

function newSection(name = "New Section"): Section {
  return { id: crypto.randomUUID(), name, items: [], scopeOfWork: "" };
}

const defaultProposal: ProposalData = {
  clientName: "",
  projectName: "",
  sections: [],
  taxRate: 8.25,
  marginPercent: 30,
};

// Reads a proposal saved before sections carried their own scope/room-sync
// fields, so old data still loads exactly as it was left. Pre-existing
// sections are marked as already synced — auto-population only ever applies
// to a brand-new section for a room that never had one.
function migrateProposal(raw: any): ProposalData {
  const legacyScope = typeof raw?.scopeOfWork === "string" ? raw.scopeOfWork : "";
  const rawSections = Array.isArray(raw?.sections) ? raw.sections : [];
  const sections: Section[] = rawSections.map((s: any, i: number) => ({
    id: s.id || crypto.randomUUID(),
    name: s.name || "Section",
    roomId: s.roomId,
    bomSynced: s.bomSynced ?? true,
    scopeOfWork: typeof s.scopeOfWork === "string" ? s.scopeOfWork : (i === 0 ? legacyScope : ""),
    items: Array.isArray(s.items) ? s.items : [],
  }));
  return {
    clientName: raw?.clientName || "",
    projectName: raw?.projectName || "",
    sections,
    taxRate: typeof raw?.taxRate === "number" ? raw.taxRate : 8.25,
    marginPercent: typeof raw?.marginPercent === "number" ? raw.marginPercent : 30,
  };
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Room {
  id: string;
  name: string;
  data: Record<string, string>;
}

// Pulls together whatever's already been designed for a room — Signal Flow
// devices (richest: manufacturer/model/category/price), Room Designer
// placements (generic category + name only, no pricing yet), and Rack Builder
// items (enriched from the AVGenix Library when added from there) — into a
// single grouped, editable line-item list. Identical items are combined so
// e.g. ten ceiling speakers show as one row with qty 10, not ten rows.
async function fetchRoomBomItems(projectId: string, roomId: string): Promise<LineItem[]> {
  type Bucket = { category: string; manufacturer: string; model: string; partNumber?: string; description: string; unitCost: number; qty: number };
  const buckets = new Map<string, Bucket>();
  const add = (b: Omit<Bucket, "qty">, qty = 1) => {
    const key = `${b.category}|${b.manufacturer}|${b.model}|${b.description}`;
    const existing = buckets.get(key);
    if (existing) existing.qty += qty;
    else buckets.set(key, { ...b, qty });
  };

  try {
    const sf = await loadToolData("signal-flow", roomId, projectId);
    const devices = (sf?.devices as any[]) || [];
    for (const d of devices) {
      const mfr = d.mfr && d.mfr !== "Generic" ? d.mfr : "";
      const model = d.model && d.model !== "—" ? d.model : "";
      add({
        category: d.cat || d.category || "Miscellaneous",
        manufacturer: mfr,
        model,
        partNumber: d.part_number || undefined,
        description: d.type || [mfr, model].filter(Boolean).join(" ") || "Device",
        unitCost: Number(d.price) || 0,
      });
    }
  } catch {
    // No Signal Flow diagram saved for this room yet
  }

  try {
    const { data: rd } = await supabase
      .from("room_designs")
      .select("data")
      .eq("project_id", projectId)
      .eq("room_id", roomId)
      .maybeSingle();
    const devices = ((rd?.data as any)?.devices as any[]) || [];
    for (const d of devices) {
      if (d.type === "furniture") continue;
      add({ category: d.type || "Miscellaneous", manufacturer: "", model: "", description: d.name || "Device", unitCost: 0 });
    }
  } catch {
    // No Room Designer layout saved for this room yet
  }

  try {
    const rp = await loadToolData("rack-planner", roomId, projectId);
    // Rack Planner auto-mirrors any Signal Flow device marked "rack mounted"
    // into its own rack view (linked back via sourceDeviceId) purely so it
    // can be positioned in a U-slot — it's the same physical unit, already
    // counted by the Signal Flow pass above. Only items placed directly in
    // the rack with no Signal Flow counterpart are genuinely new equipment.
    const items = ((rp?.items as any[]) || []).filter((item) => !item.sourceDeviceId);
    const enriched = await Promise.all(items.map(async (item) => {
      if (item.productId) {
        try {
          const product = await getProductById(item.productId);
          if (product) {
            return {
              category: product.category || "Rack Equipment",
              manufacturer: product.manufacturer || "",
              model: product.model_name || "",
              partNumber: product.part_number || undefined,
              description: product.type || "",
              unitCost: product.price || 0,
            };
          }
        } catch {
          // Fall through to the manual-entry shape below
        }
      }
      return { category: "Rack Equipment", manufacturer: "", model: "", description: item.name || "Rack item", unitCost: 0 };
    }));
    enriched.forEach((e) => add(e));
  } catch {
    // No Rack Builder plan saved for this room yet
  }

  return Array.from(buckets.values()).map((b) => ({
    id: crypto.randomUUID(),
    category: b.category,
    manufacturer: b.manufacturer,
    model: b.model,
    partNumber: b.partNumber,
    description: b.description,
    qty: b.qty,
    unitCost: b.unitCost,
    margin: null,
    markup: null,
    laborHours: 0,
    laborRate: 85,
  }));
}

export default function ProposalPage({ params }: { params: { id: string } }) {
  const { activeOrg } = useOrg();
  const searchParams = useSearchParams();
  const [proposal, setProposal] = useState<ProposalData>(defaultProposal);
  const [changeOrders, setChangeOrders] = useState<ChangeOrderSummary[]>([]);
  const [removedItemsByCO, setRemovedItemsByCO] = useState<Record<string, RemovedChangeOrderItem[]>>({});
  const [activeChangeOrderId, setActiveChangeOrderId] = useState<string | null>(null);
  const [showCOMenu, setShowCOMenu] = useState(false);
  const [newCOTitle, setNewCOTitle] = useState("");
  const [creatingCO, setCreatingCO] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectJobNumber, setProjectJobNumber] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalSearch, setModalSearch] = useState("");
  const [modalTab, setModalTab] = useState<"library" | "create">("library");
  const [library, setLibrary] = useState<EquipmentEntry[]>([]);
  const [laborLibrary, setLaborLibrary] = useState<LaborLibraryEntry[]>([]);
  const [newEquip, setNewEquip] = useState<Omit<EquipmentEntry, "id">>({
    category: CATEGORIES[0], manufacturer: "", model: "", partNumber: "", description: "", unitCost: 0,
  });
  const [pendingResync, setPendingResync] = useState<{ sectionId: string; roomId: string; name: string } | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingRoomName, setEditingRoomName] = useState("");
  const [savingRoomEdit, setSavingRoomEdit] = useState(false);
  const [deleteRoomConfirm, setDeleteRoomConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deletingRoom, setDeletingRoom] = useState(false);
  const [generatingScope, setGeneratingScope] = useState(false);
  const [pendingDeleteSection, setPendingDeleteSection] = useState<{ id: string; name: string } | null>(null);

  // Loads the org-scoped equipment library. Kept in its own effect, separate
  // from the rooms/proposal reconciliation below, because activeOrg resolves
  // asynchronously (starts null, then loads) — if this lived in the same
  // effect as the reconciliation, activeOrg changing would re-run the whole
  // load, including the reconciliation's newSection() calls, minting a
  // second batch of sections with brand-new random ids and orphaning
  // whichever section was already selected as activeSection.
  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || cancelled) return;
      const { data } = await supabase.from("equipment_library").select("*").eq("org_id", activeOrg.id);
      if (cancelled) return;
      if (data && data.length > 0) {
        setLibrary(data.map(d => ({ id: d.id, category: d.category, manufacturer: d.manufacturer, model: d.model, partNumber: d.part_number || undefined, description: d.description || "", unitCost: Number(d.unit_cost), margin: d.margin ?? null, markup: d.markup ?? null })));
      } else {
        // Seed default library for this org
        const rows = DEFAULT_LIBRARY.map(e => ({ org_id: activeOrg.id, user_id: user.id, category: e.category, manufacturer: e.manufacturer, model: e.model, description: e.description, unit_cost: e.unitCost }));
        await supabase.from("equipment_library").insert(rows);
        if (!cancelled) setLibrary(DEFAULT_LIBRARY);
      }
    });
    return () => { cancelled = true; };
  }, [activeOrg]);

  // Org-scoped Labor catalog (My Organization's Library → Labor tab) — no
  // seeding on empty, unlike equipment_library above, since an org with no
  // labor rates configured yet is a normal, expected state.
  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    supabase.from("labor_library").select("*").eq("org_id", activeOrg.id).then(({ data }) => {
      if (cancelled || !data) return;
      setLaborLibrary(data.map((d) => ({ id: d.id, label: d.label, rate: Number(d.rate), cost: Number(d.cost) })));
    });
    return () => { cancelled = true; };
  }, [activeOrg]);

  // Load
  useEffect(() => {
    let cancelled = false;

    // Load project name
    supabase.from("projects").select("name, job_number").eq("id", params.id).single()
      .then(({ data }) => { if (!cancelled && data) { setProjectName(data.name || ""); setProjectJobNumber(data.job_number || ""); } });

    // Rooms and the existing proposal must both resolve before deciding which
    // rooms are missing a section — reconciling too early risks duplicates.
    Promise.all([
      supabase.from("site_surveys").select("data").eq("project_id", params.id).single(),
      supabase.from("proposals").select("data").eq("project_id", params.id).single(),
    ]).then(([{ data: surveyRow }, { data: proposalRow }]) => {
      if (cancelled) return;
      const survey = surveyRow?.data as { buildings?: { rooms?: Room[] }[] } | null;
      const surveyRooms = (survey?.buildings?.[0]?.rooms || []) as Room[];
      setRooms(surveyRooms);

      let data: ProposalData = proposalRow?.data
        ? migrateProposal(proposalRow.data)
        : { ...defaultProposal, sections: [] };

      if (surveyRooms.length === 0 && data.sections.length === 0) {
        data = { ...data, sections: [newSection("Bill of Materials")] };
      }

      // A section for every survey room that doesn't have one yet — named
      // after the room, scope copied from its Site Survey entry, ready to be
      // auto-populated from that room's design tools below.
      const missingRooms = surveyRooms.filter((r) => !data.sections.some((s) => s.roomId === r.id));
      if (missingRooms.length > 0) {
        const added = missingRooms.map((r) => ({
          ...newSection(r.data?.room_name || r.name),
          roomId: r.id,
          scopeOfWork: r.data?.scope_of_work || "",
        }));
        data = { ...data, sections: [...data.sections, ...added] };
      }

      setProposal(data);
      setActiveSection((prev) => prev || data.sections[0]?.id || "");

      // Populate line items for any room-tied section that hasn't been synced
      // yet — in the background, so the page doesn't block on N tool queries.
      data.sections
        .filter((s) => s.roomId && !s.bomSynced)
        .forEach((section) => {
          fetchRoomBomItems(params.id, section.roomId!).then((items) => {
            if (cancelled) return;
            setProposal((p) => ({
              ...p,
              sections: p.sections.map((s) =>
                s.id === section.id ? { ...s, items: [...s.items, ...items], bomSynced: true } : s
              ),
            }));
          });
        });
    });

    return () => { cancelled = true; };
  }, [params.id]);

  const saveProposalData = useCallback(async (data: ProposalData) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("proposals").upsert({
      project_id: params.id, user_id: user.id, data,
    }, { onConflict: "project_id" });
  }, [params.id]);

  const handleSave = useCallback(async () => {
    await saveProposalData(proposal);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [proposal, saveProposalData]);

  // Change Orders — loaded from the Project Management tool's data (the
  // Change Orders tab there is the tracker; this page is where you actually
  // add/remove equipment against one). A ?co=<id> link from that tab jumps
  // straight into editing under that Change Order.
  const loadChangeOrders = useCallback(async () => {
    const { data: row } = await supabase.from("project_management").select("data").eq("project_id", params.id).single();
    const list = (row?.data?.changeOrders || []) as Array<{ id: string; title: string; status: string; removedItems?: RemovedChangeOrderItem[] }>;
    setChangeOrders(list.map((c) => ({ id: c.id, title: c.title, status: c.status })));
    const removedMap: Record<string, RemovedChangeOrderItem[]> = {};
    list.forEach((c) => { removedMap[c.id] = c.removedItems || []; });
    setRemovedItemsByCO(removedMap);
  }, [params.id]);

  useEffect(() => {
    loadChangeOrders();
    const coParam = searchParams.get("co");
    if (coParam) setActiveChangeOrderId(coParam);
  }, [loadChangeOrders, searchParams]);

  async function createChangeOrder(title: string): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: row } = await supabase.from("project_management").select("id, data").eq("project_id", params.id).single();
    const pmData = row?.data || {};
    const co = {
      id: crypto.randomUUID(), title: title.trim() || "Untitled Change Order", description: "",
      requestedBy: "", status: "draft", costImpact: 0, scheduleImpact: "",
      date: new Date().toISOString().slice(0, 10), notes: "", removedItems: [],
    };
    const nextData = { ...pmData, changeOrders: [...(pmData.changeOrders || []), co] };
    if (row) {
      await supabase.from("project_management").update({ data: nextData, updated_at: new Date().toISOString() }).eq("project_id", params.id);
    } else {
      await supabase.from("project_management").insert({ project_id: params.id, user_id: user.id, data: nextData });
    }
    setChangeOrders((prev) => [...prev, { id: co.id, title: co.title, status: co.status }]);
    setRemovedItemsByCO((prev) => ({ ...prev, [co.id]: [] }));
    return co.id;
  }

  async function recordRemovedItem(changeOrderId: string, snapshot: RemovedChangeOrderItem) {
    const { data: row } = await supabase.from("project_management").select("data").eq("project_id", params.id).single();
    if (!row?.data) return;
    const nextChangeOrders = (row.data.changeOrders || []).map((c: any) =>
      c.id === changeOrderId ? { ...c, removedItems: [...(c.removedItems || []), snapshot] } : c
    );
    await supabase.from("project_management").update({ data: { ...row.data, changeOrders: nextChangeOrders }, updated_at: new Date().toISOString() }).eq("project_id", params.id);
    setRemovedItemsByCO((prev) => ({ ...prev, [changeOrderId]: [...(prev[changeOrderId] || []), snapshot] }));
  }

  async function handleStartNewChangeOrder() {
    if (!newCOTitle.trim() || creatingCO) return;
    setCreatingCO(true);
    const id = await createChangeOrder(newCOTitle);
    setCreatingCO(false);
    setNewCOTitle("");
    setShowCOMenu(false);
    if (id) setActiveChangeOrderId(id);
  }

  // Section helpers
  function addSection() {
    const s = newSection();
    setProposal((p) => ({ ...p, sections: [...p.sections, s] }));
    setActiveSection(s.id);
  }

  function removeSection(sectionId: string) {
    setProposal((p) => {
      const sections = p.sections.filter((s) => s.id !== sectionId);
      if (activeSection === sectionId && sections.length > 0) {
        setActiveSection(sections[0].id);
      }
      return { ...p, sections };
    });
  }

  function confirmDeleteSection() {
    if (!pendingDeleteSection) return;
    removeSection(pendingDeleteSection.id);
    setPendingDeleteSection(null);
  }

  function renameSection(sectionId: string, name: string) {
    setProposal((p) => ({
      ...p,
      sections: p.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)),
    }));
  }

  function updateSectionScope(sectionId: string, scopeOfWork: string) {
    setProposal((p) => ({
      ...p,
      sections: p.sections.map((s) => (s.id === sectionId ? { ...s, scopeOfWork } : s)),
    }));
  }

  // Drafts a Scope of Work paragraph from whatever's already on hand for this
  // section — its equipment line items (which came from Signal Flow, Room
  // Designer, or Rack Builder via "Re-sync from Design Tools") plus the
  // linked room's Site Survey notes — instead of writing it from scratch.
  async function generateScopeOfWork() {
    if (!currentSection || generatingScope) return;
    setGeneratingScope(true);
    try {
      const surveyRoom = currentSection.roomId ? rooms.find((r) => r.id === currentSection.roomId) : null;
      const res = await fetch("/api/generate-proposal-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: surveyRoom?.data?.room_name || surveyRoom?.name || currentSection.name,
          items: currentSection.items.map((i) => ({ category: i.category, manufacturer: i.manufacturer, model: i.model, description: i.description, qty: i.qty })),
          surveyData: surveyRoom?.data || null,
          existingScope: currentSection.scopeOfWork,
        }),
      });
      const json = await res.json();
      if (json.scope_of_work) {
        updateSectionScope(currentSection.id, json.scope_of_work);
      } else if (json.error) {
        alert(json.error);
      }
    } catch {
      alert("Couldn't generate a scope of work — please try again.");
    } finally {
      setGeneratingScope(false);
    }
  }

  async function confirmResync() {
    if (!pendingResync) return;
    setResyncing(true);
    const items = await fetchRoomBomItems(params.id, pendingResync.roomId);
    setProposal((p) => ({
      ...p,
      sections: p.sections.map((s) => (s.id === pendingResync.sectionId ? { ...s, items, bomSynced: true } : s)),
    }));
    setResyncing(false);
    setPendingResync(null);
  }

  // Room helpers — mirror Design Engineering's sidebar (same createSurveyRoom/
  // renameSurveyRoom/deleteSurveyRoom writing into the shared site_surveys
  // JSONB), so a room added, renamed, or deleted here shows up identically
  // everywhere else that reads it.
  async function handleAddRoom() {
    if (creatingRoom) return;
    setCreatingRoom(true);
    const result = await createSurveyRoom(params.id);
    setCreatingRoom(false);
    if ("error" in result) {
      alert(`Couldn't create the room: ${result.error}`);
      return;
    }
    setRooms((prev) => [...prev, result.room]);
    const section: Section = { ...newSection(result.room.name), roomId: result.room.id, bomSynced: true };
    setProposal((p) => ({ ...p, sections: [...p.sections, section] }));
    setActiveSection(section.id);
  }

  function startRenameRoom(room: Room) {
    setEditingRoomId(room.id);
    setEditingRoomName(room.data?.room_name || room.name);
  }

  async function commitRenameRoom() {
    if (!editingRoomId) return;
    const name = editingRoomName.trim();
    const roomId = editingRoomId;
    if (!name) { setEditingRoomId(null); return; }
    setSavingRoomEdit(true);
    const result = await renameSurveyRoom(params.id, roomId, name);
    setSavingRoomEdit(false);
    if ("error" in result) {
      alert(`Couldn't rename the room: ${result.error}`);
      return;
    }
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, name, data: { ...r.data, room_name: name } } : r)));
    setEditingRoomId(null);
  }

  async function confirmDeleteRoom() {
    if (!deleteRoomConfirm) return;
    setDeletingRoom(true);
    const result = await deleteSurveyRoom(params.id, deleteRoomConfirm.id);
    setDeletingRoom(false);
    if ("error" in result) {
      alert(`Couldn't delete the room: ${result.error}`);
      return;
    }
    setRooms((prev) => prev.filter((r) => r.id !== deleteRoomConfirm.id));
    // Detach rather than delete the room's section, so its line items and
    // pricing aren't lost — it reappears under "Other Sections".
    setProposal((p) => ({
      ...p,
      sections: p.sections.map((s) => (s.roomId === deleteRoomConfirm.id ? { ...s, roomId: undefined } : s)),
    }));
    setDeleteRoomConfirm(null);
  }

  // Item helpers
  function addItem(sectionId: string) {
    const next: ProposalData = {
      ...proposal,
      sections: proposal.sections.map((s) =>
        s.id === sectionId ? { ...s, items: [...s.items, { ...newItem(), changeOrderId: activeChangeOrderId }] } : s
      ),
    };
    setProposal(next);
    if (activeChangeOrderId) saveProposalData(next);
  }

  async function removeItem(sectionId: string, itemId: string) {
    const section = proposal.sections.find((s) => s.id === sectionId);
    const item = section?.items.find((i) => i.id === itemId);
    // Removing a pre-existing item (not one added under this same Change
    // Order) while editing under one: snapshot its price before it's gone,
    // since that CO's cost impact needs it after the item no longer exists.
    const isUnderActiveCO = item && activeChangeOrderId && item.changeOrderId !== activeChangeOrderId;
    if (isUnderActiveCO) {
      await recordRemovedItem(activeChangeOrderId!, {
        id: item.id, category: item.category, manufacturer: item.manufacturer, model: item.model, description: item.description,
        qty: item.qty, priceAtRemoval: itemPrice(item), lineTotalAtRemoval: itemLineTotal(item),
      });
    }
    const next: ProposalData = {
      ...proposal,
      sections: proposal.sections.map((s) =>
        s.id === sectionId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s
      ),
    };
    setProposal(next);
    // Keep the live proposal in sync with the CO's removal snapshot right
    // away — otherwise the item would still show as live in the BOM (until
    // Save is clicked) while already recorded as removed on the CO.
    if (isUnderActiveCO) saveProposalData(next);
  }

  function updateItem(sectionId: string, itemId: string, field: keyof LineItem, value: string | number) {
    setProposal((p) => ({
      ...p,
      sections: p.sections.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, [field]: value } : i)) }
          : s
      ),
    }));
  }

  // Margin/Markup are mutually exclusive explicit overrides — editing one
  // clears the other so there's only ever one anchor besides Cost. Editing
  // Price back-calculates Margin (matching the same convention used on the
  // Equipment Library form), and clearing any of the three drops the item
  // back to the proposal's default Margin %.
  function updateItemMargin(sectionId: string, itemId: string, value: string) {
    const margin = value === "" ? null : parseFloat(value);
    setProposal((p) => ({
      ...p,
      sections: p.sections.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, margin: Number.isNaN(margin) ? null : margin, markup: null } : i)) }
          : s
      ),
    }));
  }

  function updateItemMarkup(sectionId: string, itemId: string, value: string) {
    const markup = value === "" ? null : parseFloat(value);
    setProposal((p) => ({
      ...p,
      sections: p.sections.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, markup: Number.isNaN(markup) ? null : markup, margin: null } : i)) }
          : s
      ),
    }));
  }

  function updateItemPrice(sectionId: string, itemId: string, value: string) {
    const parsed = value === "" ? null : parseFloat(value);
    const price = parsed != null && Number.isNaN(parsed) ? null : parsed;
    setProposal((p) => ({
      ...p,
      sections: p.sections.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, margin: price == null ? null : marginFromPrice(i.unitCost, price), markup: null } : i)) }
          : s
      ),
    }));
  }

  function addItemFromEquipment(entry: EquipmentEntry) {
    if (!currentSection) return;
    const item: LineItem = {
      id: crypto.randomUUID(),
      category: entry.category,
      manufacturer: entry.manufacturer,
      model: entry.model,
      partNumber: entry.partNumber,
      description: entry.description,
      qty: 1,
      unitCost: entry.unitCost,
      margin: entry.margin ?? null,
      markup: entry.margin == null ? (entry.markup ?? null) : null,
      laborHours: 0,
      laborRate: 85,
      changeOrderId: activeChangeOrderId,
    };
    const next: ProposalData = {
      ...proposal,
      sections: proposal.sections.map((s) =>
        s.id === currentSection.id ? { ...s, items: [...s.items, item] } : s
      ),
    };
    setProposal(next);
    // Additions under a Change Order are saved immediately, same as
    // removals (recordRemovedItem) — otherwise a CO's tracked change only
    // exists in this tab's local state until the page's own Save button is
    // clicked, and navigating to view/manage the CO elsewhere loses it.
    if (activeChangeOrderId) saveProposalData(next);
    setShowAddModal(false);
    setModalSearch("");
  }

  function addItemFromLabor(entry: LaborLibraryEntry) {
    if (!currentSection) return;
    const item: LineItem = {
      id: crypto.randomUUID(),
      category: "Labor",
      manufacturer: "",
      model: entry.label,
      partNumber: undefined,
      description: entry.label,
      qty: 1,
      unitCost: 0,
      margin: null,
      markup: null,
      // 1 hour is just a starting point — adjust in the Labor Hrs column.
      laborHours: 1,
      laborRate: entry.rate,
      changeOrderId: activeChangeOrderId,
    };
    const next: ProposalData = {
      ...proposal,
      sections: proposal.sections.map((s) =>
        s.id === currentSection.id ? { ...s, items: [...s.items, item] } : s
      ),
    };
    setProposal(next);
    if (activeChangeOrderId) saveProposalData(next);
    setShowAddModal(false);
    setModalSearch("");
  }

  async function handleCreateAndAdd() {
    const entry: EquipmentEntry = { id: crypto.randomUUID(), ...newEquip };
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("equipment_library").insert({
        org_id: activeOrg?.id, user_id: user.id, category: entry.category, manufacturer: entry.manufacturer,
        model: entry.model, part_number: entry.partNumber || null, description: entry.description, unit_cost: entry.unitCost,
      });
    }
    setLibrary((prev) => [...prev, entry]);
    addItemFromEquipment(entry);
    setNewEquip({ category: CATEGORIES[0], manufacturer: "", model: "", partNumber: "", description: "", unitCost: 0 });
    setModalTab("library");
  }

  const filteredLibrary = library.filter((e) => {
    if (!modalSearch) return true;
    const q = modalSearch.toLowerCase();
    return (
      e.manufacturer.toLowerCase().includes(q) ||
      e.model.toLowerCase().includes(q) ||
      (e.partNumber || "").toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q)
    );
  });

  const filteredLaborLibrary = laborLibrary.filter((e) =>
    !modalSearch || e.label.toLowerCase().includes(modalSearch.toLowerCase())
  );

  // Calculations
  const currentSection = proposal.sections.find((s) => s.id === activeSection);
  const extraSections = proposal.sections.filter((s) => !s.roomId);

  const allItems = proposal.sections.flatMap((s) => s.items);

  // Per-item Margin %/Markup %/Price — an item's own margin or markup wins if
  // set; otherwise it falls back live to the proposal's default Margin %
  // (Pricing panel in the sidebar), so every item always has a real price
  // instead of showing blank/zero, and un-overridden items stay in sync if
  // that default is changed later. Margin is true margin (% of price, so
  // Price = Cost / (1 - Margin/100)) — the same definition used on the
  // Equipment Library form — not a flat cost markup. Delegates to
  // lib/proposal-pricing.ts so the Project Dashboard and Procurement's
  // release snapshot compute the exact same sell price for the same line.
  function itemMargin(i: LineItem): number { return sharedItemMargin(i, proposal.marginPercent); }
  function itemMarkup(i: LineItem): number { return sharedItemMarkup(i, proposal.marginPercent); }
  function itemPrice(i: LineItem): number { return sharedItemPrice(i, proposal.marginPercent); }
  function itemLineTotal(i: LineItem): number { return sharedItemLineTotal(i, proposal.marginPercent); }
  function sectionSubtotalPrice(s: { items: LineItem[] }) { return sharedSectionSubtotalPrice(s, proposal.marginPercent); }

  const { totalEquipmentPrice, totalLabor, tax, grandTotal } = computeProposalTotals(proposal.sections, proposal.marginPercent, proposal.taxRate);

  const activeChangeOrder = changeOrders.find((c) => c.id === activeChangeOrderId) || null;
  const activeCOAddedItems = activeChangeOrderId ? allItems.filter((i) => i.changeOrderId === activeChangeOrderId) : [];
  const activeCORemovedItems = activeChangeOrderId ? (removedItemsByCO[activeChangeOrderId] || []) : [];
  const activeCOImpact = activeChangeOrderId
    ? changeOrderCostImpact(activeCOAddedItems, activeCORemovedItems, proposal.marginPercent)
    : 0;

  // Escapes a value for a CSV cell — quotes it when it contains a comma, quote,
  // or newline, and neutralizes leading =/+/-/@ so opening the file in Excel
  // can't be tricked into evaluating a formula (CSV injection).
  function csvCell(value: string | number) {
    let s = String(value ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV() {
    const rows: string[][] = [];
    rows.push([projectName || "Proposal", projectJobNumber ? `#${projectJobNumber}` : ""]);
    if (proposal.clientName) rows.push([`Client: ${proposal.clientName}`]);
    rows.push([]);

    proposal.sections.forEach((s) => {
      rows.push([s.name]);
      rows.push(["Category", "Manufacturer", "Model", "Part #", "Description", "Qty", "Price", "Line Total"]);
      s.items.forEach((i) => {
        rows.push([i.category, i.manufacturer, i.model, i.partNumber || "", i.description, String(i.qty), itemPrice(i).toFixed(2), itemLineTotal(i).toFixed(2)]);
      });
      rows.push(["", "", "", "", "", "", "Section Subtotal", sectionSubtotalPrice(s).toFixed(2)]);
      rows.push([]);
    });

    rows.push(["", "", "", "", "", "", "Equipment Total", totalEquipmentPrice.toFixed(2)]);
    rows.push(["", "", "", "", "", "", "Labor Total", totalLabor.toFixed(2)]);
    rows.push(["", "", "", "", "", "", `Tax (${proposal.taxRate}%)`, tax.toFixed(2)]);
    rows.push(["", "", "", "", "", "", "Grand Total", grandTotal.toFixed(2)]);

    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${projectName || "Proposal"}${projectJobNumber ? "_" + projectJobNumber : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function escapeHtml(value: string) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  }

  function generateProposalHTML() {
    const preparedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const sectionsHtml = proposal.sections.map((s) => {
      const groups = new Map<string, LineItem[]>();
      s.items.forEach((i) => {
        const key = i.category || "Miscellaneous";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(i);
      });
      const rows = Array.from(groups.entries()).map(([category, items]) => {
        const itemRows = items.map((i) => {
          return `<tr><td>${escapeHtml(i.manufacturer) || "—"}</td><td>${escapeHtml(i.model) || "—"}</td><td style="font-family:monospace">${escapeHtml(i.partNumber || "") || "—"}</td><td>${escapeHtml(i.description) || "—"}</td><td style="text-align:right">${i.qty}</td><td style="text-align:right">$${fmt(itemPrice(i))}</td><td style="text-align:right">$${fmt(itemLineTotal(i))}</td></tr>`;
        }).join("");
        return `<tr class="cat-row"><td colspan="7">${escapeHtml(category)}</td></tr>${itemRows}`;
      }).join("");
      const scope = s.scopeOfWork ? `<p class="scope"><strong>Scope of Work:</strong> ${escapeHtml(s.scopeOfWork).replace(/\n/g, "<br>")}</p>` : "";
      return `<h3>${escapeHtml(s.name)}</h3>${scope}
        <table>
          <tr><th>Manufacturer</th><th>Model</th><th>Part #</th><th>Description</th><th>Qty</th><th>Price</th><th>Line Total</th></tr>
          ${rows || `<tr><td colspan="7" style="text-align:center;color:#94a3b8">No items</td></tr>`}
        </table>
        <p class="section-subtotal">Section Subtotal: $${fmt(sectionSubtotalPrice(s))}</p>`;
    }).join("");

    return `<html><head><meta charset="utf-8"><title>Proposal — ${escapeHtml(projectName)}</title>
      <style>
        body{font-family:Arial,sans-serif;margin:0;padding:40px;color:#0f172a}
        .cover{background:#0f2942;color:#fff;padding:36px 40px;margin:-40px -40px 28px -40px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .cover .eyebrow{font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.75;margin-bottom:10px}
        .cover h1{font-size:28px;margin:0;color:#fff}
        .info-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:14px}
        .info-box{padding:12px 16px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}
        .info-box:nth-child(2n){border-right:none}
        .info-box:nth-last-child(-n+2){border-bottom:none}
        .info-label{font-size:10px;font-weight:700;letter-spacing:0.05em;color:#0d9488;text-transform:uppercase;margin-bottom:4px}
        .info-value{font-size:13px;color:#0f172a;white-space:pre-line}
        h3{font-size:16px;margin:28px 0 6px;padding-top:16px;border-top:2px solid #e2e8f0}
        table{width:100%;border-collapse:collapse;margin:8px 0 4px}
        th,td{border:1px solid #cbd5e1;padding:6px 10px;text-align:left;font-size:12px}
        th{background:#f1f5f9;font-weight:600;font-size:10px;text-transform:uppercase}
        .cat-row td{background:#eef2f7;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.03em;color:#334155}
        .scope{font-size:12px;color:#334155;margin:6px 0}
        .section-subtotal{text-align:right;font-size:13px;font-weight:600;margin:0 0 8px}
        .totals{margin-top:24px;margin-left:auto;width:320px;border-top:3px solid #f59e0b;padding-top:12px}
        .totals div{display:flex;justify-content:space-between;font-size:13px;padding:4px 0}
        .totals .grand{border-top:2px solid #0f172a;margin-top:6px;padding-top:8px;font-size:17px;font-weight:700}
        .acceptance{margin-top:40px;padding-top:20px;border-top:2px solid #e2e8f0}
        .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:20px}
        .sig-label{font-size:10px;font-weight:700;letter-spacing:0.05em;color:#64748b;text-transform:uppercase;margin-bottom:28px}
        .sig-line{border-top:1px solid #94a3b8}
        @media print { h3 { break-inside: avoid } table { break-inside: auto } tr { break-inside: avoid } }
      </style></head><body>
      <div class="cover">
        <div class="eyebrow">Proposal</div>
        <h1>${escapeHtml(projectName) || "Proposal"}</h1>
      </div>
      <div class="info-grid">
        <div class="info-box"><div class="info-label">Prepared For</div><div class="info-value">${escapeHtml(proposal.clientName) || "—"}</div></div>
        <div class="info-box"><div class="info-label">Prepared By</div><div class="info-value">${escapeHtml(activeOrg?.name || "") || "—"}</div></div>
        <div class="info-box"><div class="info-label">Project</div><div class="info-value">${escapeHtml(projectName)}${projectJobNumber ? ` · #${escapeHtml(projectJobNumber)}` : ""}</div></div>
        <div class="info-box"><div class="info-label">Proposal Date</div><div class="info-value">${preparedDate}</div></div>
      </div>
      ${sectionsHtml}
      <div class="totals">
        <div><span>Equipment Total</span><span>$${fmt(totalEquipmentPrice)}</span></div>
        <div><span>Labor Total</span><span>$${fmt(totalLabor)}</span></div>
        <div><span>Estimated Sales Tax (${proposal.taxRate}%)</span><span>$${fmt(tax)}</span></div>
        <div class="grand"><span>Proposal Total</span><span>$${fmt(grandTotal)}</span></div>
      </div>
      <div class="acceptance">
        <h3 style="border-top:none;padding-top:0;margin-top:0">Acceptance</h3>
        <p class="scope">By signing below, the client acknowledges and accepts the scope and pricing outlined above.</p>
        <div class="sig-grid">
          <div><div class="sig-label">Authorized Name</div><div class="sig-line"></div></div>
          <div><div class="sig-label">Title</div><div class="sig-line"></div></div>
          <div><div class="sig-label">Signature</div><div class="sig-line"></div></div>
          <div><div class="sig-label">Date</div><div class="sig-line"></div></div>
        </div>
      </div>
      </body></html>`;
  }

  function exportPDF() {
    const html = generateProposalHTML();
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  }

  return (
    <div className="animate-fade-in">
      {/* Top header */}
      <div className="border-b border-border bg-forge-panel/50 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <Link href={`/projects/${params.id}`} className="mb-2 inline-flex items-center gap-1.5 text-xs text-subtle hover:text-secondary">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              {projectName}
              {projectJobNumber && <span className="text-subtle"> · #{projectJobNumber}</span>}
            </Link>
            <h1 className="flex items-center gap-2.5 text-xl font-bold text-heading">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Proposal
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setShowExportMenu((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-forge-surface/50 px-3 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-forge-surface"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M8 10l-3-3M8 10l3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Export
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-48 rounded-lg border border-border bg-forge-bg p-1 shadow-2xl shadow-black/50">
                    <button
                      onClick={() => { exportCSV(); setShowExportMenu(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-secondary transition-colors hover:bg-forge-surface/60"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="2" stroke="#22c55e" strokeWidth="1.2" /><text x="8" y="11" textAnchor="middle" fontSize="5.5" fill="#22c55e" fontWeight="700">CSV</text></svg>
                      Export as CSV
                    </button>
                    <button
                      onClick={() => { exportPDF(); setShowExportMenu(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-secondary transition-colors hover:bg-forge-surface/60"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="2" stroke="#ef4444" strokeWidth="1.2" /><text x="8" y="11" textAnchor="middle" fontSize="6" fill="#ef4444" fontWeight="700">PDF</text></svg>
                      Export as PDF
                    </button>
                  </div>
                </>
              )}
            </div>
            <button onClick={handleSave} className="forge-btn-primary text-[13px]">
              {saved ? (
                <><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Saved</>
              ) : (
                <><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13 11v3H3v-3M8 2v9M5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>Save</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Change Order mode bar — edits made while active are tagged so the
          Change Orders tab (Project Management tool) can show what changed
          and its cost impact, without altering how the live BOM works
          otherwise. */}
      <div className={`border-b border-border px-4 py-2.5 sm:px-6 lg:px-8 ${activeChangeOrderId ? "bg-orange-500/10" : "bg-forge-panel/30"}`}>
        {activeChangeOrderId ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-orange-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
              Editing under Change Order: {activeChangeOrder?.title || "Loading…"}
            </span>
            <span className="text-[12px] text-subtle">
              {activeCOAddedItems.length} added · {activeCORemovedItems.length} removed · impact{" "}
              <span className={activeCOImpact >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>
                {activeCOImpact >= 0 ? "+" : "-"}${fmt(Math.abs(activeCOImpact))}
              </span>
            </span>
            <button
              onClick={() => setActiveChangeOrderId(null)}
              className="ml-auto rounded-lg border border-border bg-forge-surface/50 px-3 py-1 text-[12px] font-medium text-secondary transition-colors hover:bg-forge-surface"
            >
              Done editing
            </button>
          </div>
        ) : (
          <div className="relative flex items-center" data-co-menu>
            <button
              onClick={() => setShowCOMenu((v) => !v)}
              className="flex items-center gap-1.5 text-[12px] font-medium text-muted transition-colors hover:text-orange-400"
            >
              Change Orders
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {showCOMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowCOMenu(false)} />
                <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-72 rounded-lg border border-border bg-forge-bg p-2 shadow-2xl shadow-black/50">
                  {changeOrders.filter((c) => c.status !== "rejected").length > 0 && (
                    <div className="mb-1 max-h-40 overflow-y-auto">
                      {changeOrders.filter((c) => c.status !== "rejected").map((c) => (
                        <Link
                          key={c.id}
                          href={`/projects/${params.id}/proposal/change-order/${c.id}`}
                          onClick={() => setShowCOMenu(false)}
                          className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] text-secondary transition-colors hover:bg-forge-surface/60"
                        >
                          <span className="truncate">{c.title || "Untitled Change Order"}</span>
                          <span className="ml-2 shrink-0 text-[11px] text-faint">{c.status}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                  <div className="border-t border-border pt-2">
                    <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">New Change Order</div>
                    <div className="flex items-center gap-1.5 px-1">
                      <input
                        value={newCOTitle}
                        onChange={(e) => setNewCOTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleStartNewChangeOrder(); }}
                        placeholder="Title, e.g. Add third display"
                        className="forge-input flex-1 text-[12px]"
                        autoFocus
                      />
                      <button
                        onClick={handleStartNewChangeOrder}
                        disabled={creatingCO || !newCOTitle.trim()}
                        className="shrink-0 rounded-lg bg-orange-500 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
                      >
                        {creatingCO ? "Starting…" : "Start"}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Body: sidebar + content */}
      <div className="flex" style={{ minHeight: "calc(100vh - 124px - 85px)" }}>
        {/* Sidebar */}
        <aside className="flex w-[260px] shrink-0 flex-col overflow-y-auto border-r border-border bg-forge-panel/30 px-3 py-5">
          <div className="mb-3 flex items-center justify-between px-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-faint">Rooms</span>
            <button
              onClick={handleAddRoom}
              disabled={creatingRoom}
              title="Add a room — no site survey needed"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-blue-400 transition-colors hover:bg-forge-surface/60 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              {creatingRoom ? "Adding…" : "Add Room"}
            </button>
          </div>

          {rooms.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-faint">No rooms found</p>
              <p className="mt-1 text-xs text-faint">Add one above, or in Site Survey</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {rooms.map((room) => {
                const roomName = room.data?.room_name || room.name;
                const section = proposal.sections.find((s) => s.roomId === room.id);
                const isActive = !!section && activeSection === section.id;
                return (
                  <div key={room.id} className={`group flex w-full items-center gap-1 rounded-lg pr-1.5 transition-all hover:bg-forge-surface/30 ${isActive ? "bg-forge-surface/60" : ""}`}>
                    {editingRoomId === room.id ? (
                      <div className="flex flex-1 items-center gap-1 px-3 py-1.5">
                        <input
                          autoFocus
                          value={editingRoomName}
                          onChange={(e) => setEditingRoomName(e.target.value)}
                          onBlur={commitRenameRoom}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitRenameRoom(); }
                            if (e.key === "Escape") { e.preventDefault(); setEditingRoomId(null); }
                          }}
                          disabled={savingRoomEdit}
                          className="w-full rounded-md border border-blue-400/50 bg-forge-surface px-2 py-1 text-sm font-semibold text-heading outline-none"
                        />
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => section && setActiveSection(section.id)}
                          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                            isActive ? "font-semibold text-heading" : "text-muted hover:text-secondary"
                          }`}
                        >
                          <svg
                            width="12" height="12" viewBox="0 0 12 12" fill="none"
                            className={`shrink-0 transition-transform ${isActive ? "rotate-90" : ""}`}
                          >
                            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                          <span className="truncate">{roomName}</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); startRenameRoom(room); }}
                          title="Rename room"
                          className="shrink-0 rounded-md p-1 text-faint opacity-0 transition-opacity hover:text-heading group-hover:opacity-100"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteRoomConfirm({ id: room.id, name: roomName }); }}
                          title="Delete room"
                          className="shrink-0 rounded-md p-1 text-faint opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {extraSections.length > 0 && (
            <>
              <div className="mb-2 mt-5 px-3">
                <h2 className="text-sm font-bold text-heading">Other Sections</h2>
              </div>
              <div className="flex flex-col gap-0.5">
                {extraSections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                      activeSection === s.id
                        ? "bg-forge-surface/60 font-semibold text-heading"
                        : "text-muted hover:bg-forge-surface/30 hover:text-secondary"
                    }`}
                  >
                    <span className="truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <button
            onClick={addSection}
            className="mt-4 flex items-center gap-1.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-blue-400 transition-colors hover:bg-blue-500/10"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            Add Section
          </button>

          {/* Default Margin % — used by any line item that doesn't have its
              own Margin/Markup override (see the item table's own columns),
              so a fresh item always prices correctly instead of showing a
              blank/zero price. Tax is separate and applies to the whole
              proposal's equipment sell price. */}
          <div className="mt-6 rounded-lg border border-border bg-forge-surface/30 p-3">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-subtle">Pricing</h2>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] text-subtle">Default Margin %</label>
                <input
                  type="number"
                  value={proposal.marginPercent}
                  onChange={(e) => setProposal((p) => ({ ...p, marginPercent: parseFloat(e.target.value) || 0 }))}
                  className="forge-input w-full text-[12px]"
                  step="0.5"
                  min="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-subtle">Tax %</label>
                <input
                  type="number"
                  value={proposal.taxRate}
                  onChange={(e) => setProposal((p) => ({ ...p, taxRate: parseFloat(e.target.value) || 0 }))}
                  className="forge-input w-full text-[12px]"
                  step="0.25"
                  min="0"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1 border-t border-border pt-2 text-[12px]">
              <div className="flex justify-between text-subtle"><span>Equipment</span><span>${fmt(totalEquipmentPrice)}</span></div>
              <div className="flex justify-between text-subtle"><span>Labor</span><span>${fmt(totalLabor)}</span></div>
              <div className="flex justify-between text-subtle"><span>Tax</span><span>${fmt(tax)}</span></div>
              <div className="flex justify-between border-t border-border pt-1.5 font-bold text-heading"><span>Total</span><span>${fmt(grandTotal)}</span></div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentSection ? (
            <div>
              {/* Section header */}
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <input
                    value={currentSection.name}
                    onChange={(e) => renameSection(currentSection.id, e.target.value)}
                    className="border-none bg-transparent text-lg font-bold text-heading outline-none focus:ring-0"
                  />
                  <span className="rounded-md bg-forge-surface/60 px-2 py-0.5 text-[11px] text-subtle">
                    {currentSection.items.length} item{currentSection.items.length !== 1 ? "s" : ""}
                  </span>
                  {currentSection.roomId && (
                    <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-400">
                      From Design Engineering
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {currentSection.roomId && (
                    <button
                      onClick={() => setPendingResync({ sectionId: currentSection.id, roomId: currentSection.roomId!, name: currentSection.name })}
                      className="rounded-lg px-3 py-1.5 text-[12px] text-blue-400 transition-colors hover:bg-blue-500/10"
                    >
                      Re-sync from Design Tools
                    </button>
                  )}
                  {proposal.sections.length > 1 && (
                    <button
                      onClick={() => setPendingDeleteSection({ id: currentSection.id, name: currentSection.name })}
                      className="rounded-lg px-3 py-1.5 text-[12px] text-red-400 transition-colors hover:bg-red-500/10"
                    >
                      Delete Section
                    </button>
                  )}
                </div>
              </div>

              {/* Line items table */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-forge-panel/60 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Manufacturer</th>
                      <th className="px-3 py-3">Model</th>
                      <th className="px-3 py-3">Part #</th>
                      <th className="px-3 py-3 min-w-[200px]">Description</th>
                      <th className="px-3 py-3 text-right">Qty</th>
                      <th className="px-3 py-3 text-right">Unit Cost</th>
                      <th className="px-3 py-3 text-right">Margin %</th>
                      <th className="px-3 py-3 text-right">Markup %</th>
                      <th className="px-3 py-3 text-right">Unit Price</th>
                      <th className="px-3 py-3 text-right">Labor Hrs</th>
                      <th className="px-3 py-3 text-right">Labor Rate</th>
                      <th className="px-3 py-3 text-right">Line Total</th>
                      <th className="w-10 px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {currentSection.items.map((item) => {
                      const isOverridden = item.margin != null || item.markup != null;
                      const itemCO = item.changeOrderId ? changeOrders.find((c) => c.id === item.changeOrderId) : null;
                      return (
                        <tr
                          key={item.id}
                          className={`border-b border-border/50 transition-colors hover:bg-forge-surface/20 ${item.changeOrderId ? "bg-orange-500/[0.04]" : ""}`}
                          title={itemCO ? `Added by Change Order: ${itemCO.title}` : undefined}
                        >
                          <td className="px-1 py-1">
                            <select
                              value={item.category}
                              onChange={(e) => updateItem(currentSection.id, item.id, "category", e.target.value)}
                              className="w-full rounded border-none bg-transparent px-2 py-2 text-[13px] text-secondary outline-none focus:ring-1 focus:ring-blue-500/40"
                            >
                              {CATEGORIES.map((c) => (
                                <option key={c} value={c} className="bg-forge-bg">{c}</option>
                              ))}
                              {!CATEGORIES.includes(item.category) && (
                                <option value={item.category} className="bg-forge-bg">{item.category}</option>
                              )}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={item.manufacturer}
                              onChange={(e) => updateItem(currentSection.id, item.id, "manufacturer", e.target.value)}
                              placeholder="e.g. Crestron"
                              className="w-full rounded border-none bg-transparent px-2 py-2 text-[13px] text-secondary outline-none placeholder:text-faint focus:ring-1 focus:ring-blue-500/40"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={item.model}
                              onChange={(e) => updateItem(currentSection.id, item.id, "model", e.target.value)}
                              placeholder="Model #"
                              className="w-full rounded border-none bg-transparent px-2 py-2 text-[13px] text-secondary outline-none placeholder:text-faint focus:ring-1 focus:ring-blue-500/40"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={item.partNumber || ""}
                              onChange={(e) => updateItem(currentSection.id, item.id, "partNumber", e.target.value)}
                              placeholder="Part #"
                              className="w-full rounded border-none bg-transparent px-2 py-2 font-mono text-[12.5px] text-secondary outline-none placeholder:text-faint placeholder:font-sans focus:ring-1 focus:ring-blue-500/40"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={item.description}
                              onChange={(e) => updateItem(currentSection.id, item.id, "description", e.target.value)}
                              placeholder="Item description"
                              className="w-full rounded border-none bg-transparent px-2 py-2 text-[13px] text-secondary outline-none placeholder:text-faint focus:ring-1 focus:ring-blue-500/40"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={item.qty}
                              onChange={(e) => updateItem(currentSection.id, item.id, "qty", parseInt(e.target.value) || 0)}
                              className="w-full rounded border-none bg-transparent px-2 py-2 text-right text-[13px] text-secondary outline-none focus:ring-1 focus:ring-blue-500/40"
                              min="0"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={item.unitCost}
                              onChange={(e) => updateItem(currentSection.id, item.id, "unitCost", parseFloat(e.target.value) || 0)}
                              className="w-full rounded border-none bg-transparent px-2 py-2 text-right text-[13px] text-secondary outline-none focus:ring-1 focus:ring-blue-500/40"
                              min="0"
                              step="0.01"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={itemMargin(item)}
                              onChange={(e) => updateItemMargin(currentSection.id, item.id, e.target.value)}
                              title={isOverridden ? undefined : "Using the proposal's default Margin %"}
                              className={`w-full rounded border-none bg-transparent px-2 py-2 text-right text-[13px] outline-none focus:ring-1 focus:ring-blue-500/40 ${isOverridden ? "text-secondary" : "italic text-faint"}`}
                              step="0.1"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={itemMarkup(item)}
                              onChange={(e) => updateItemMarkup(currentSection.id, item.id, e.target.value)}
                              title={isOverridden ? undefined : "Using the proposal's default Margin %"}
                              className={`w-full rounded border-none bg-transparent px-2 py-2 text-right text-[13px] outline-none focus:ring-1 focus:ring-blue-500/40 ${isOverridden ? "text-secondary" : "italic text-faint"}`}
                              step="0.1"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={itemPrice(item)}
                              onChange={(e) => updateItemPrice(currentSection.id, item.id, e.target.value)}
                              title={isOverridden ? undefined : "Using the proposal's default Margin %"}
                              className={`w-full rounded border-none bg-transparent px-2 py-2 text-right text-[13px] outline-none focus:ring-1 focus:ring-blue-500/40 ${isOverridden ? "text-secondary" : "italic text-faint"}`}
                              min="0"
                              step="0.01"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={item.laborHours}
                              onChange={(e) => updateItem(currentSection.id, item.id, "laborHours", parseFloat(e.target.value) || 0)}
                              title="Hours billed independently of Qty/Unit Price — see Labor Total"
                              className="w-full rounded border-none bg-transparent px-2 py-2 text-right text-[13px] text-secondary outline-none focus:ring-1 focus:ring-blue-500/40"
                              min="0"
                              step="0.25"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={item.laborRate}
                              onChange={(e) => updateItem(currentSection.id, item.id, "laborRate", parseFloat(e.target.value) || 0)}
                              className="w-full rounded border-none bg-transparent px-2 py-2 text-right text-[13px] text-secondary outline-none focus:ring-1 focus:ring-blue-500/40"
                              min="0"
                              step="0.01"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-body">
                            ${fmt(itemLineTotal(item))}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              onClick={() => removeItem(currentSection.id, item.id)}
                              className="rounded p-1 text-faint transition-colors hover:bg-red-500/10 hover:text-red-400"
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-forge-panel/30">
                      <td colSpan={9} className="px-3 py-3">
                        <button
                          onClick={() => { setShowAddModal(true); setModalSearch(""); setModalTab("library"); }}
                          className="flex items-center gap-1.5 text-[12px] font-medium text-blue-400 transition-colors hover:text-blue-300"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                          Add Line Item
                        </button>
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-bold text-body">
                        ${fmt(sectionSubtotalPrice(currentSection))}
                      </td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Scope of Work */}
              <div className="mt-8">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-heading">Scope of Work</h3>
                  <button
                    onClick={generateScopeOfWork}
                    disabled={generatingScope}
                    className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[12px] font-medium text-violet-400 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
                  >
                    {generatingScope ? (
                      <>
                        <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity=".25" /><path d="M21 12a9 9 0 00-9-9" strokeLinecap="round" /></svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" /></svg>
                        Generate with AI
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={currentSection.scopeOfWork}
                  onChange={(e) => updateSectionScope(currentSection.id, e.target.value)}
                  placeholder="Describe the scope of work, deliverables, exclusions, and assumptions..."
                  rows={6}
                  className="forge-input w-full resize-y text-[13px]"
                />
                {currentSection.roomId && (
                  <p className="mt-1.5 text-[11px] text-faint">
                    Copied from this room&apos;s Site Survey entry by default — edit freely here without affecting the survey.
                  </p>
                )}
                <p className="mt-1.5 text-[11px] text-faint">
                  &quot;Generate with AI&quot; drafts from this section&apos;s equipment list{currentSection.roomId ? " and the room's Site Survey notes" : ""} — review before sending to a client.
                </p>
              </div>

            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-faint">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-sm text-subtle">Add a section to start building your proposal</p>
            </div>
          )}
        </div>
      </div>
      {/* Add Equipment Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowAddModal(false)} />
          <div className="relative w-full max-w-[680px] rounded-2xl border border-border bg-forge-bg shadow-2xl shadow-black/50">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-bold text-heading">Add Equipment</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-subtle transition-colors hover:text-secondary"
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
              <button
                onClick={() => setModalTab("library")}
                className={`px-6 py-3 text-[13px] font-medium transition-colors ${
                  modalTab === "library"
                    ? "border-b-2 border-blue-500 text-blue-400"
                    : "text-subtle hover:text-secondary"
                }`}
              >
                Search Library
              </button>
              <button
                onClick={() => setModalTab("create")}
                className={`px-6 py-3 text-[13px] font-medium transition-colors ${
                  modalTab === "create"
                    ? "border-b-2 border-blue-500 text-blue-400"
                    : "text-subtle hover:text-secondary"
                }`}
              >
                Create New
              </button>
            </div>

            {/* Modal body */}
            <div className="p-6" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              {modalTab === "library" ? (
                <div>
                  {/* Search */}
                  <div className="relative mb-4">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
                      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    <input
                      value={modalSearch}
                      onChange={(e) => setModalSearch(e.target.value)}
                      placeholder="Search by manufacturer, model, or description..."
                      className="forge-input w-full pl-10 text-[13px]"
                      autoFocus
                    />
                  </div>

                  {/* Results */}
                  {filteredLibrary.length === 0 && filteredLaborLibrary.length === 0 ? (
                    <div className="py-10 text-center text-sm text-subtle">
                      No equipment or labor found. Try a different search or create a new item.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {filteredLaborLibrary.map((entry) => (
                        <button
                          key={entry.id}
                          onClick={() => addItemFromLabor(entry)}
                          className="flex items-center justify-between rounded-lg px-4 py-3 text-left transition-all hover:bg-forge-surface/40"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-semibold text-body">{entry.label}</span>
                              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">Labor</span>
                            </div>
                          </div>
                          <span className="ml-4 shrink-0 text-[13px] font-medium text-secondary">
                            ${fmt(entry.rate)}/hr
                          </span>
                        </button>
                      ))}
                      {filteredLibrary.map((entry) => (
                        <button
                          key={entry.id}
                          onClick={() => addItemFromEquipment(entry)}
                          className="flex items-center justify-between rounded-lg px-4 py-3 text-left transition-all hover:bg-forge-surface/40"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-semibold text-body">
                                {entry.manufacturer}
                              </span>
                              <span className="text-[13px] text-muted">{entry.model}</span>
                              <span className="rounded bg-forge-surface/60 px-1.5 py-0.5 text-[10px] text-subtle">
                                {entry.category}
                              </span>
                              {entry.partNumber && (
                                <span className="font-mono text-[11px] text-faint">PN: {entry.partNumber}</span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-[12px] text-subtle">{entry.description}</p>
                          </div>
                          <span className="ml-4 shrink-0 text-[13px] font-medium text-secondary">
                            ${fmt(entry.unitCost)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-subtle">Category</label>
                      <select
                        value={newEquip.category}
                        onChange={(e) => setNewEquip((p) => ({ ...p, category: e.target.value }))}
                        className="forge-input w-full text-[13px]"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-subtle">Manufacturer</label>
                      <input
                        value={newEquip.manufacturer}
                        onChange={(e) => setNewEquip((p) => ({ ...p, manufacturer: e.target.value }))}
                        placeholder="e.g. Crestron"
                        className="forge-input w-full text-[13px]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-subtle">Model</label>
                      <input
                        value={newEquip.model}
                        onChange={(e) => setNewEquip((p) => ({ ...p, model: e.target.value }))}
                        placeholder="Model number"
                        className="forge-input w-full text-[13px]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-subtle">Part Number</label>
                      <input
                        value={newEquip.partNumber || ""}
                        onChange={(e) => setNewEquip((p) => ({ ...p, partNumber: e.target.value }))}
                        placeholder="e.g. 60-1234-01"
                        className="forge-input w-full text-[13px]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-subtle">Unit Cost ($)</label>
                      <input
                        type="number"
                        value={newEquip.unitCost}
                        onChange={(e) => setNewEquip((p) => ({ ...p, unitCost: parseFloat(e.target.value) || 0 }))}
                        className="forge-input w-full text-[13px]"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-subtle">Description</label>
                    <input
                      value={newEquip.description}
                      onChange={(e) => setNewEquip((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Brief description of the equipment"
                      className="forge-input w-full text-[13px]"
                    />
                  </div>
                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleCreateAndAdd}
                      disabled={!newEquip.manufacturer || !newEquip.model}
                      className="forge-btn-primary text-[13px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Add to Library & Insert
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingResync && (
        <ConfirmDialog
          title="Re-sync from Design Tools"
          message={<>Replace every line item in <span className="font-semibold text-heading">{pendingResync.name}</span> with a fresh pull from Room Designer, Signal Flow, and Rack Builder for this room? Any manual edits to this section&apos;s items will be lost.</>}
          confirmLabel="Re-sync"
          busy={resyncing}
          onCancel={() => setPendingResync(null)}
          onConfirm={confirmResync}
        />
      )}

      {pendingDeleteSection && (
        <ConfirmDialog
          title="Delete Section"
          message={<>Delete <span className="font-semibold text-heading">{pendingDeleteSection.name}</span>? This removes all of its line items and scope of work. This can&apos;t be undone once saved.</>}
          confirmLabel="Delete"
          onCancel={() => setPendingDeleteSection(null)}
          onConfirm={confirmDeleteSection}
        />
      )}

      {deleteRoomConfirm && (
        <ConfirmDialog
          title="Delete room"
          message={<>Delete <span className="font-semibold text-heading">{deleteRoomConfirm.name}</span>? This removes it from Site Survey and every design tool. Its proposal section stays here, just unlinked from the room, so nothing you&apos;ve priced is lost.</>}
          busy={deletingRoom}
          onCancel={() => setDeleteRoomConfirm(null)}
          onConfirm={confirmDeleteRoom}
        />
      )}
    </div>
  );
}
