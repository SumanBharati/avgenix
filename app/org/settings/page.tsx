"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/components/OrgProvider";
import { ROLE_OPTIONS } from "@/lib/pm-store";
import { type LaborRateType, DEFAULT_LABOR_RATE_TYPES, newLaborRateTypeKey } from "@/lib/labor-rates";
import ConfirmDialog from "@/components/ConfirmDialog";

type RoleItem = { key: string; value: string };

function newRoleKey() {
  return `role_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function toRoleItems(roles: string[]): RoleItem[] {
  return roles.map((value) => ({ key: newRoleKey(), value }));
}

const PHONE_COUNTRY_CODES: [string, string][] = [
  ["United States", "+1"], ["Canada", "+1"], ["United Kingdom", "+44"],
  ["Australia", "+61"], ["Germany", "+49"], ["France", "+33"],
  ["India", "+91"], ["Japan", "+81"], ["Singapore", "+65"],
  ["UAE", "+971"], ["Brazil", "+55"], ["Mexico", "+52"],
];

function PhoneCodeSelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="forge-input flex w-[68px] items-center justify-between gap-1 text-[13px]"
      >
        {value}
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 max-h-56 w-48 overflow-y-auto rounded-lg border border-border bg-forge-surface shadow-lg">
          {PHONE_COUNTRY_CODES.map(([name, code]) => (
            <button
              key={name}
              type="button"
              onClick={() => { onChange(code); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-body transition-colors hover:bg-forge-surface/80"
            >
              <span className="w-10 shrink-0 text-muted">{code}</span>
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrgSettingsPage() {
  const router = useRouter();
  const { activeOrg, refreshOrgs, isPro, openUpgradeModal } = useOrg();
  const initialOrgDetails = {
    name: "", website: "", phone: "", phone_country_code: "+1", country: "United States", timezone: "(GMT-05:00) Eastern Time (US & Canada)",
    street_address: "", city: "", state: "", zip: "",
    shipping_address: "", shipping_city: "", shipping_state: "", shipping_zip: "",
    shipping_same_as_primary: false,
  };
  const [orgDetails, setOrgDetails] = useState(initialOrgDetails);
  const [savedOrgDetails, setSavedOrgDetails] = useState(initialOrgDetails);
  const isOrgDetailsDirty = JSON.stringify(orgDetails) !== JSON.stringify(savedOrgDetails);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (!activeOrg || activeOrg.is_individual) { setMemberCount(null); return; }
    supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("org_id", activeOrg.id)
      .then(({ count }) => setMemberCount(count ?? null));
  }, [activeOrg?.id, activeOrg?.is_individual]);

  async function handleManageBilling() {
    if (!activeOrg) return;
    setBillingLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/stripe/portal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ orgId: activeOrg.id }),
    });
    const data = await res.json();
    if (data.url) { window.location.href = data.url; return; }
    setBillingLoading(false);
    alert(data.error || "Something went wrong. Please try again.");
  }

  const [roleItems, setRoleItems] = useState<RoleItem[]>(() => toRoleItems(ROLE_OPTIONS));
  const [savedRoleItems, setSavedRoleItems] = useState<RoleItem[]>(roleItems);
  const isRolesDirty = JSON.stringify(roleItems.map((r) => r.value)) !== JSON.stringify(savedRoleItems.map((r) => r.value));
  const [savingRoles, setSavingRoles] = useState(false);
  const [savedRoles, setSavedRoles] = useState(false);

  useEffect(() => {
    if (activeOrg) {
      const items = toRoleItems(activeOrg.member_roles?.length ? activeOrg.member_roles : ROLE_OPTIONS);
      setRoleItems(items);
      setSavedRoleItems(items);
    }
  }, [activeOrg?.id]);

  function updateRoleItem(key: string, value: string) {
    setRoleItems((prev) => prev.map((item) => (item.key === key ? { ...item, value } : item)));
  }

  function addRoleItem() {
    setRoleItems((prev) => [...prev, { key: newRoleKey(), value: "New Role" }]);
  }

  function removeRoleItem(key: string) {
    setRoleItems((prev) => (prev.length > 1 ? prev.filter((item) => item.key !== key) : prev));
  }

  async function handleRolesSave(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setSavingRoles(true);

    const roles = roleItems.map((r) => r.value.trim()).filter(Boolean);
    const { error } = await supabase
      .from("organizations")
      .update({ member_roles: roles })
      .eq("id", activeOrg.id);

    if (!error) {
      setSavedRoleItems(roleItems);
      await refreshOrgs();
      setSavedRoles(true);
      setTimeout(() => setSavedRoles(false), 2000);
    }
    setSavingRoles(false);
  }

  const [laborItems, setLaborItems] = useState<LaborRateType[]>(DEFAULT_LABOR_RATE_TYPES);
  const [savedLaborItems, setSavedLaborItems] = useState<LaborRateType[]>(DEFAULT_LABOR_RATE_TYPES);
  const isLaborRatesDirty = JSON.stringify(laborItems) !== JSON.stringify(savedLaborItems);
  const [savingLabor, setSavingLabor] = useState(false);
  const [savedLabor, setSavedLabor] = useState(false);

  function updateLaborItem(key: string, patch: Partial<LaborRateType>) {
    setLaborItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function addLaborItem() {
    setLaborItems((prev) => [...prev, { key: newLaborRateTypeKey(), label: "New Type", rate: 0, cost: 0 }]);
  }

  function removeLaborItem(key: string) {
    setLaborItems((prev) => prev.filter((item) => item.key !== key));
  }

  const [currency, setCurrency] = useState("USD");
  const [currencySnapshot, setCurrencySnapshot] = useState("USD");
  const isCurrencyDirty = currency !== currencySnapshot;
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [savedCurrency, setSavedCurrency] = useState(false);

  const initialTaxPrefs = {
    tax_equipment: true,
    tax_shipping: false,
    tax_set_default_rates: false,
    tax_independent_rates: false,
    tax_name: "Tax",
  };
  const [taxPrefs, setTaxPrefs] = useState(initialTaxPrefs);
  const [savedTaxPrefs, setSavedTaxPrefs] = useState(initialTaxPrefs);
  const isTaxPrefsDirty = JSON.stringify(taxPrefs) !== JSON.stringify(savedTaxPrefs);
  const [savingTax, setSavingTax] = useState(false);
  const [savedTax, setSavedTax] = useState(false);

  const [qbConnected, setQbConnected] = useState(false);
  const [qbCompany, setQbCompany] = useState<string | null>(null);
  const [disconnectingQb, setDisconnectingQb] = useState(false);

  useEffect(() => {
    if (activeOrg) {
      supabase
        .from("organizations")
        .select("name, website, phone, phone_country_code, country, timezone, street_address, city, state, zip, shipping_address, shipping_city, shipping_state, shipping_zip, shipping_same_as_primary, labor_line_items, currency, tax_equipment, tax_shipping, tax_set_default_rates, tax_independent_rates, tax_name, qb_connected, qb_company_name")
        .eq("id", activeOrg.id)
        .single()
        .then(({ data }) => {
          if (data) {
            const loadedOrgDetails = {
              name: data.name ?? "",
              website: data.website ?? "",
              phone: data.phone ?? "",
              phone_country_code: data.phone_country_code ?? "+1",
              country: data.country ?? "United States",
              timezone: data.timezone ?? "(GMT-05:00) Eastern Time (US & Canada)",
              street_address: data.street_address ?? "",
              city: data.city ?? "",
              state: data.state ?? "",
              zip: data.zip ?? "",
              shipping_address: data.shipping_address ?? "",
              shipping_city: data.shipping_city ?? "",
              shipping_state: data.shipping_state ?? "",
              shipping_zip: data.shipping_zip ?? "",
              shipping_same_as_primary: data.shipping_same_as_primary ?? false,
            };
            setOrgDetails(loadedOrgDetails);
            setSavedOrgDetails(loadedOrgDetails);
            const loadedLaborItems: LaborRateType[] =
              Array.isArray(data.labor_line_items) && data.labor_line_items.length > 0
                ? data.labor_line_items
                : DEFAULT_LABOR_RATE_TYPES;
            setLaborItems(loadedLaborItems);
            setSavedLaborItems(loadedLaborItems);
            const loadedCurrency = data.currency ?? "USD";
            setCurrency(loadedCurrency);
            setCurrencySnapshot(loadedCurrency);
            setQbConnected(data.qb_connected ?? false);
            setQbCompany(data.qb_company_name ?? null);
            const loadedTaxPrefs = {
              tax_equipment: data.tax_equipment ?? true,
              tax_shipping: data.tax_shipping ?? false,
              tax_set_default_rates: data.tax_set_default_rates ?? false,
              tax_independent_rates: data.tax_independent_rates ?? false,
              tax_name: data.tax_name ?? "Tax",
            };
            setTaxPrefs(loadedTaxPrefs);
            setSavedTaxPrefs(loadedTaxPrefs);
          }
        });
    }
  }, [activeOrg]);

  if (!activeOrg) return <div className="px-8 py-20 text-center text-sm text-subtle">Loading...</div>;

  const isOwnerOrAdmin = activeOrg.role === "superadmin" || activeOrg.role === "admin";

  if (!isOwnerOrAdmin) {
    return (
      <div className="px-8 py-20 text-center">
        <p className="text-sm text-subtle">You don&apos;t have permission to manage this account.</p>
      </div>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!orgDetails.name.trim() || !activeOrg) return;
    setSaving(true);

    const { error } = await supabase
      .from("organizations")
      .update({
        name: orgDetails.name.trim(),
        website: orgDetails.website, phone: orgDetails.phone, phone_country_code: orgDetails.phone_country_code,
        country: orgDetails.country, timezone: orgDetails.timezone,
        street_address: orgDetails.street_address, city: orgDetails.city,
        state: orgDetails.state, zip: orgDetails.zip,
        shipping_address: orgDetails.shipping_address, shipping_city: orgDetails.shipping_city,
        shipping_state: orgDetails.shipping_state, shipping_zip: orgDetails.shipping_zip,
        shipping_same_as_primary: orgDetails.shipping_same_as_primary,
      })
      .eq("id", activeOrg.id);

    if (!error) {
      const trimmedOrgDetails = { ...orgDetails, name: orgDetails.name.trim() };
      setOrgDetails(trimmedOrgDetails);
      setSavedOrgDetails(trimmedOrgDetails);
      await refreshOrgs();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  async function handleLaborSave(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setSavingLabor(true);

    const { error } = await supabase
      .from("organizations")
      .update({ labor_line_items: laborItems })
      .eq("id", activeOrg.id);

    if (!error) {
      setSavedLaborItems(laborItems);
      setSavedLabor(true);
      setTimeout(() => setSavedLabor(false), 2000);
    }
    setSavingLabor(false);
  }

  async function handleCurrencySave(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setSavingCurrency(true);
    const { error } = await supabase.from("organizations").update({ currency }).eq("id", activeOrg.id);
    if (!error) {
      setCurrencySnapshot(currency);
      setSavedCurrency(true);
      setTimeout(() => setSavedCurrency(false), 2000);
    }
    setSavingCurrency(false);
  }

  async function handleTaxSave(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setSavingTax(true);
    const { error } = await supabase.from("organizations").update(taxPrefs).eq("id", activeOrg.id);
    if (!error) {
      setSavedTaxPrefs(taxPrefs);
      setSavedTax(true);
      setTimeout(() => setSavedTax(false), 2000);
    }
    setSavingTax(false);
  }

  async function handleQbDisconnect() {
    if (!activeOrg) return;
    setDisconnectingQb(true);
    await supabase.from("organizations").update({ qb_connected: false, qb_company_name: null, qb_access_token: null, qb_refresh_token: null, qb_realm_id: null }).eq("id", activeOrg.id);
    setQbConnected(false); setQbCompany(null);
    setDisconnectingQb(false);
  }

  const canDeleteOrg = Boolean(
    activeOrg && activeOrg.role === "superadmin" && !activeOrg.is_individual
    && memberCount === 1 && activeOrg.subscription_status !== "active"
  );

  async function confirmDelete() {
    if (!activeOrg || !canDeleteOrg) return;
    setDeleting(true);
    setDeleteError("");
    const { error } = await supabase.from("organizations").delete().eq("id", activeOrg.id);
    if (error) {
      setDeleteError(error.message);
      setDeleting(false);
      return;
    }
    await refreshOrgs();
    router.push("/dashboard");
  }

  return (
    <div className="animate-fade-in px-4 py-4 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-heading">Account Settings</h2>
        <p className="mt-0.5 text-sm text-muted">Manage your account&apos;s details and members.</p>
      </div>

      {/* Nav tabs */}
      <div className="mb-4 flex gap-1 border-b border-border">
        <Link href="/org/settings" className="border-b-2 border-blue-500 px-4 py-2 text-sm font-medium text-blue-400">
          General
        </Link>
        {!activeOrg.is_individual && (
          <Link href="/org/members" className="border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-body">
            Members
          </Link>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-[2fr_3fr] gap-4 items-start">

        {/* ── Left column: Org Details + Danger Zone ── */}
        <div className="flex flex-col gap-4">

          <form onSubmit={handleSave}>
            <div className="rounded-xl border border-border bg-forge-surface/40 p-3">
              <h3 className="mb-2 text-sm font-semibold text-heading">Account Details</h3>

              {/* Name / Website */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">Name</label>
                  <input
                    type="text"
                    value={activeOrg.is_individual ? "Individual" : orgDetails.name}
                    onChange={(e) => setOrgDetails(p => ({ ...p, name: e.target.value }))}
                    className="forge-input disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={activeOrg.is_individual}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">Website</label>
                  <input type="url" value={orgDetails.website} onChange={(e) => setOrgDetails(p => ({ ...p, website: e.target.value }))} className="forge-input" placeholder="https://" />
                </div>
              </div>

              {/* Phone */}
              <div className="mb-2">
                <label className="mb-1 block text-[11px] font-medium text-muted">Phone</label>
                <div className="flex gap-1.5">
                  <PhoneCodeSelect value={orgDetails.phone_country_code} onChange={(code) => setOrgDetails(p => ({ ...p, phone_country_code: code }))} />
                  <input type="tel" value={orgDetails.phone} onChange={(e) => setOrgDetails(p => ({ ...p, phone: e.target.value }))} className="forge-input" placeholder="555 000 0000" />
                </div>
              </div>

              {/* Country / Timezone */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">Country</label>
                  <select value={orgDetails.country} onChange={(e) => setOrgDetails(p => ({ ...p, country: e.target.value }))} className="forge-input">
                    {["United States","Canada","United Kingdom","Australia","Germany","France","India","Japan","Singapore","UAE","Brazil","Mexico"].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">Time Zone</label>
                  <select value={orgDetails.timezone} onChange={(e) => setOrgDetails(p => ({ ...p, timezone: e.target.value }))} className="forge-input">
                    {["(GMT-08:00) Pacific Time (US & Canada)","(GMT-07:00) Mountain Time (US & Canada)","(GMT-06:00) Central Time (US & Canada)","(GMT-05:00) Eastern Time (US & Canada)","(GMT-04:00) Atlantic Time (Canada)","(GMT+00:00) UTC","(GMT+01:00) Central European Time","(GMT+05:30) India Standard Time","(GMT+08:00) Singapore Time","(GMT+09:00) Japan Standard Time","(GMT+10:00) Australian Eastern Time"].map(tz => <option key={tz}>{tz}</option>)}
                  </select>
                </div>
              </div>

              {/* Address */}
              <div className="mb-2">
                <label className="mb-1 block text-[11px] font-medium text-muted">Address</label>
                <input type="text" value={orgDetails.street_address} onChange={(e) => setOrgDetails(p => ({ ...p, street_address: e.target.value }))} className="forge-input" />
              </div>

              {/* City / State / Zip */}
              <div className="grid grid-cols-[1fr_80px_80px] gap-1.5">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">City</label>
                  <input type="text" value={orgDetails.city} onChange={(e) => setOrgDetails(p => ({ ...p, city: e.target.value }))} className="forge-input" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">State</label>
                  <input type="text" value={orgDetails.state} onChange={(e) => setOrgDetails(p => ({ ...p, state: e.target.value }))} className="forge-input" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">Zip</label>
                  <input type="text" value={orgDetails.zip} onChange={(e) => setOrgDetails(p => ({ ...p, zip: e.target.value }))} className="forge-input" />
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                <button type="submit" disabled={saving || !orgDetails.name.trim() || !isOrgDetailsDirty} className="forge-btn-primary text-[13px]">
                  {saving ? "Saving..." : "Save Account Details"}
                </button>
                {saved && <span className="text-sm text-emerald-400">Saved</span>}
              </div>
            </div>
          </form>

          {/* Organization Member Roles */}
          {!activeOrg.is_individual && (
          <form onSubmit={handleRolesSave}>
            <div className="rounded-xl border border-border bg-forge-surface/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-heading">Member Roles</h3>
                  <p className="mt-0.5 text-[12px] text-muted">Roles offered when inviting members and assigning project team slots.</p>
                </div>
                <button type="button" onClick={addRoleItem} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-body transition-colors hover:bg-forge-surface/80">
                  + Add Role
                </button>
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                {roleItems.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 border-b border-border/50 px-2.5 py-1.5 last:border-b-0">
                    <input type="text" value={item.value}
                      onChange={(e) => updateRoleItem(item.key, e.target.value)}
                      className="min-w-0 flex-1 border-0 bg-transparent px-0 py-0.5 text-[13px] text-body focus:outline-none" />
                    <button type="button" onClick={() => removeRoleItem(item.key)} disabled={roleItems.length <= 1}
                      title={roleItems.length <= 1 ? "At least one role is required" : "Remove role"}
                      className="shrink-0 text-muted transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                <button type="submit" disabled={savingRoles || !isRolesDirty} className="forge-btn-primary text-[13px]">
                  {savingRoles ? "Saving..." : "Save Roles"}
                </button>
                {savedRoles && <span className="text-sm text-emerald-400">Saved</span>}
              </div>
            </div>
          </form>
          )}

          {activeOrg.role === "superadmin" && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <h3 className="mb-1.5 text-sm font-semibold text-red-400">Danger Zone</h3>
              {activeOrg.is_individual ? (
                <p className="text-[12px] text-muted">This is your personal workspace and can&apos;t be deleted.</p>
              ) : (
                <>
                  <p className="mb-3 text-[12px] text-muted">Permanently remove all projects, proposals, and data in this team.</p>
                  {activeOrg.subscription_status === "active" ? (
                    <p className="text-[12px] text-amber-400">Cancel the active Pro subscription (use Manage Billing above) before this team can be deleted.</p>
                  ) : memberCount !== null && memberCount > 1 ? (
                    <p className="text-[12px] text-amber-400">
                      Remove every other member, or transfer ownership to one of them, before this team can be deleted.{" "}
                      <Link href="/org/members" className="underline underline-offset-2 hover:text-amber-300">Manage members</Link>
                    </p>
                  ) : (
                    <button onClick={() => setConfirmingDelete(true)} className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[13px] font-medium text-red-400 transition-colors hover:bg-red-500/20">
                      Delete Team
                    </button>
                  )}
                  {deleteError && <p className="mt-2 text-[12px] text-red-400">{deleteError}</p>}
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="flex flex-col gap-4">

          {/* Billing */}
          {isOwnerOrAdmin && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-heading">Billing</h3>
                    <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-300">
                      AVGenix Pro
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {isPro
                      ? memberCount && memberCount > 1
                        ? `Active Pro subscription — $20/seat/month × ${memberCount} members = $${memberCount * 20}/month.`
                        : "Your account has an active Pro subscription — $20/month."
                      : "Free plan — upgrade to unlock projects, design tools, and BOM generation."}
                  </p>
                </div>
                <button
                  onClick={isPro ? handleManageBilling : openUpgradeModal}
                  disabled={billingLoading}
                  className={isPro
                    ? "shrink-0 rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-body transition-colors hover:bg-forge-surface/80 disabled:opacity-50"
                    : "forge-btn-primary shrink-0 text-[13px]"}
                >
                  {isPro ? (billingLoading ? "Loading…" : "Manage Billing") : "Upgrade to Pro"}
                </button>
              </div>
            </div>
          )}

          {/* Labor rates, currency/tax and integrations only feed Pro features
              (estimates, proposals, QuickBooks sync), so free plans see them
              locked: visible, but disabled, with a way to upgrade. */}
          {!isPro && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/[0.06] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-violet-400" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                <p className="text-[12px] text-body">
                  <span className="font-semibold text-heading">Pro feature:</span> labor rates, currency &amp; tax, and integrations are part of AVGenix Pro.
                  {!isOwnerOrAdmin && " Ask your team's owner or an admin to upgrade."}
                </p>
              </div>
              {isOwnerOrAdmin && (
                <button type="button" onClick={openUpgradeModal} className="forge-btn-primary shrink-0 text-[12px]">Upgrade</button>
              )}
            </div>
          )}
          <fieldset
            disabled={!isPro}
            aria-disabled={!isPro}
            // inert also blocks links (QuickBooks Connect) that disabled doesn't
            // cover. Set on the element: React 18 doesn't render an inert prop.
            ref={(el) => { el?.toggleAttribute("inert", !isPro); }}
            className={`m-0 flex min-w-0 flex-col gap-4 border-0 p-0 ${!isPro ? "pointer-events-none select-none opacity-50" : ""}`}
          >
          {/* Labor Rates & Costs */}
          <form onSubmit={handleLaborSave}>
            <div className="rounded-xl border border-border bg-forge-surface/40 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-heading">Labor Rates and Costs</h3>
                  <p className="mt-0.5 text-[12px] text-muted">Hourly labor prices and average costs (including employment costs) used in your estimates.</p>
                </div>
                <button type="button" onClick={addLaborItem} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-body transition-colors hover:bg-forge-surface/80">
                  + Add Labor Type
                </button>
              </div>

              {laborItems.length > 0 && (
                <div className="mt-4" style={{ display: "grid", gridTemplateColumns: `repeat(${laborItems.length}, minmax(0, 1fr))`, gap: "0.75rem" }}>
                  {laborItems.map((item) => (
                    <div key={item.key} className="flex items-center gap-1">
                      <input type="text" value={item.label}
                        onChange={(e) => updateLaborItem(item.key, { label: e.target.value })}
                        className="min-w-0 flex-1 border-0 border-b border-border bg-transparent px-0 pb-1 text-[11px] font-medium text-muted focus:border-blue-500 focus:outline-none" />
                      <button type="button" onClick={() => removeLaborItem(item.key)} title="Remove labor type"
                        className="shrink-0 text-muted transition-colors hover:text-red-400">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {laborItems.length > 0 && (
                <>
                  <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-faint">Rates</div>
                  <div className="mt-1" style={{ display: "grid", gridTemplateColumns: `repeat(${laborItems.length}, minmax(0, 1fr))`, gap: "0.75rem" }}>
                    {laborItems.map((item) => (
                      <div key={item.key} className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">$</span>
                        <input type="number" min="0" step="0.01" value={item.rate}
                          onChange={(e) => updateLaborItem(item.key, { rate: parseFloat(e.target.value) || 0 })}
                          className="forge-input pl-6 text-[13px]" />
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-faint">Costs</div>
                  <div className="mt-1" style={{ display: "grid", gridTemplateColumns: `repeat(${laborItems.length}, minmax(0, 1fr))`, gap: "0.75rem" }}>
                    {laborItems.map((item) => (
                      <div key={item.key} className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">$</span>
                        <input type="number" min="0" step="0.01" value={item.cost}
                          onChange={(e) => updateLaborItem(item.key, { cost: parseFloat(e.target.value) || 0 })}
                          className="forge-input pl-6 text-[13px]" />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
                <button type="submit" disabled={savingLabor || !isLaborRatesDirty} className="forge-btn-primary text-[13px]">
                  {savingLabor ? "Saving..." : "Save Labor Settings"}
                </button>
                {savedLabor && <span className="text-sm text-emerald-400">Saved</span>}
              </div>
            </div>
          </form>

          {/* Bottom row: Currency & Tax + Integrations */}
          <div className="grid grid-cols-2 gap-4">

            {/* Currency & Tax */}
            <div className="rounded-xl border border-border bg-forge-surface/40 p-4">
              <h3 className="mb-0.5 text-sm font-semibold text-heading">Currency &amp; Tax</h3>
              <p className="mb-4 text-[12px] text-muted">Default currency and tax settings for your projects.</p>

              <form onSubmit={handleCurrencySave} className="mb-4 border-b border-border pb-4">
                <label className="mb-1.5 block text-[12px] font-medium text-muted">Currency <span className="text-faint">default: USD</span></label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="forge-input mb-3">
                  {[
                    ["USD","US Dollar (USD)"],["EUR","Euro (EUR)"],["GBP","British Pound (GBP)"],
                    ["CAD","Canadian Dollar (CAD)"],["AUD","Australian Dollar (AUD)"],["JPY","Japanese Yen (JPY)"],
                    ["CHF","Swiss Franc (CHF)"],["INR","Indian Rupee (INR)"],["MXN","Mexican Peso (MXN)"],
                    ["BRL","Brazilian Real (BRL)"],["SGD","Singapore Dollar (SGD)"],["AED","UAE Dirham (AED)"],
                  ].map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                </select>
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={savingCurrency || !isCurrencyDirty} className="forge-btn-primary text-[13px]">
                    {savingCurrency ? "Saving..." : "Update Currency"}
                  </button>
                  {savedCurrency && <span className="text-sm text-emerald-400">Saved</span>}
                </div>
              </form>

              <form onSubmit={handleTaxSave}>
                <h4 className="mb-3 text-[13px] font-semibold text-heading">Tax Preferences</h4>
                <div className="space-y-2 mb-3">
                  {([
                    ["tax_equipment", "Tax All Equipment By Default"],
                    ["tax_shipping", "Tax All Shipping By Default"],
                    ["tax_set_default_rates", "Set Default Tax Rates When Projects Created"],
                    ["tax_independent_rates", "Use Independent Equipment And Labor Tax Rates"],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={taxPrefs[key]}
                        onChange={(e) => setTaxPrefs((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="h-3.5 w-3.5 rounded border-border accent-blue-500" />
                      <span className="text-[12px] text-body">{label}</span>
                    </label>
                  ))}
                </div>
                <label className="mb-1 block text-[12px] font-medium text-muted">Tax Name <span className="text-faint">e.g. Sales Tax, VAT</span></label>
                <input type="text" value={taxPrefs.tax_name}
                  onChange={(e) => setTaxPrefs((prev) => ({ ...prev, tax_name: e.target.value }))}
                  className="forge-input mb-3" placeholder="Tax" />
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={savingTax || !isTaxPrefsDirty} className="forge-btn-primary text-[13px]">
                    {savingTax ? "Saving..." : "Update Tax Preferences"}
                  </button>
                  {savedTax && <span className="text-sm text-emerald-400">Saved</span>}
                </div>
              </form>
            </div>

            {/* Integrations */}
            <div className="rounded-xl border border-border bg-forge-surface/40 p-4">
              <h3 className="mb-0.5 text-sm font-semibold text-heading">Integrations</h3>
              <p className="mb-4 text-[12px] text-muted">Connect third-party apps to sync data with your account.</p>

              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[1fr_130px_110px] bg-forge-surface px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Application</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Status</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Actions</span>
                </div>
                <div className="grid grid-cols-[1fr_130px_110px] items-center border-t border-border px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <svg width="26" height="26" viewBox="0 0 40 40" fill="none">
                      <rect width="40" height="40" rx="8" fill="#2CA01C"/>
                      <path d="M20 8C13.37 8 8 13.37 8 20s5.37 12 12 12 12-5.37 12-12S26.63 8 20 8zm-2 17.5v-11l9.5 5.5-9.5 5.5z" fill="white"/>
                    </svg>
                    <div>
                      <div className="text-[13px] font-medium text-heading">QuickBooks Online</div>
                      <div className="text-[11px] text-muted">Sync invoices, customers &amp; payments</div>
                    </div>
                  </div>
                  <div>
                    {qbConnected ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {qbCompany ?? "Connected"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-border/60 px-2 py-0.5 text-[11px] font-medium text-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                        Not connected
                      </span>
                    )}
                  </div>
                  <div>
                    {qbConnected ? (
                      <button onClick={handleQbDisconnect} disabled={disconnectingQb}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors">
                        {disconnectingQb ? "..." : "Disconnect"}
                      </button>
                    ) : (
                      <a href={`/api/integrations/quickbooks/connect?org=${activeOrg.id}`}
                        className="inline-block rounded-lg bg-[#2CA01C] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#238a16] transition-colors">
                        Connect
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>{/* end bottom row */}
          </fieldset>
        </div>{/* end right column */}
      </div>{/* end grid */}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete team"
          message={<>Delete <span className="font-semibold text-heading">{activeOrg.name}</span>? This will permanently remove all projects, proposals, and data in this team. This cannot be undone.</>}
          confirmLabel="Delete Team"
          busy={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
