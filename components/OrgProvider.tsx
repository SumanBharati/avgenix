"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { ROLE_OPTIONS } from "@/lib/pm-store";
import UpgradeModal from "./UpgradeModal";

export type ProAccessStatus = "loading" | "anonymous" | "no_org" | "org_error" | "trial" | "active" | "override" | "expired";

export interface Org {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  role: "superadmin" | "admin" | "member";
  member_roles: string[];
  subscription_status: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  is_individual: boolean;
}

interface OrgContextValue {
  activeOrg: Org | null;
  orgs: Org[];
  switchOrg: (orgId: string) => Promise<void>;
  refreshOrgs: () => Promise<void>;
  loading: boolean;
  isPro: boolean;
  hasAccessOverride: boolean;
  user: User | null;
  accessStatus: ProAccessStatus;
  trialEndsAt: string | null;
  orgLoadError: string | null;
  upgradeModalOpen: boolean;
  openUpgradeModal: () => void;
  closeUpgradeModal: () => void;
}

const OrgContext = createContext<OrgContextValue>({
  activeOrg: null,
  orgs: [],
  switchOrg: async () => {},
  refreshOrgs: async () => {},
  loading: true,
  isPro: false,
  hasAccessOverride: false,
  user: null,
  accessStatus: "loading",
  trialEndsAt: null,
  orgLoadError: null,
  upgradeModalOpen: false,
  openUpgradeModal: () => {},
  closeUpgradeModal: () => {},
});

export function useOrg() {
  return useContext(OrgContext);
}

export default function OrgProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessNow, setAccessNow] = useState(() => Date.now());
  const [hasAccessOverride, setHasAccessOverride] = useState(false);
  const [orgLoadError, setOrgLoadError] = useState<string | null>(null);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const openUpgradeModal = useCallback(() => setUpgradeModalOpen(true), []);
  const closeUpgradeModal = useCallback(() => setUpgradeModalOpen(false), []);

  // Who the loaded state belongs to — lets the auth listener below tell a real
  // sign-in / sign-out from the library merely re-announcing the same session.
  const userIdRef = useRef<string | null>(null);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    setOrgLoadError(null);

    // getSession() reads the local session with no network call. When there
    // isn't one, skip getUser()'s network round-trip to the auth server —
    // otherwise an anonymous visitor who clicks a Pro-gated link right after
    // page load hits "loading" (just a blurred skeleton, no auth modal) for
    // as long as that request takes, and clicking again does nothing until
    // it resolves. When a session does exist, still verify it with getUser()
    // rather than trusting the locally stored session user.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      userIdRef.current = null;
      setUser(null);
      setOrgs([]);
      setActiveOrgId(null);
      setHasAccessOverride(false);
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    userIdRef.current = user?.id ?? null;
    setUser(user);
    if (!user) {
      setOrgs([]);
      setActiveOrgId(null);
      setHasAccessOverride(false);
      setLoading(false);
      return;
    }

    // The database evaluates expiration using its own clock. During a staged
    // deployment this RPC may not exist yet, in which case access remains false.
    const { data: overrideActive } = await supabase.rpc("has_active_pro_override");
    setHasAccessOverride(overrideActive === true);

    const { data: rpcOrganizations, error: rpcOrganizationsError } = await supabase.rpc("get_my_organizations");
    let orgList: Org[] = [];

    if (!rpcOrganizationsError && Array.isArray(rpcOrganizations)) {
      orgList = rpcOrganizations.map((org: any) => ({
        id: org.id,
        name: org.name || "Unknown",
        slug: org.slug || "",
        logo_url: org.logo_url || null,
        role: org.role,
        member_roles: Array.isArray(org.member_roles) && org.member_roles.length > 0 ? org.member_roles : ROLE_OPTIONS,
        subscription_status: org.subscription_status ?? null,
        trial_started_at: org.trial_started_at ?? null,
        trial_ends_at: org.trial_ends_at ?? null,
        is_individual: org.is_individual ?? false,
      }));
    } else {
      // Compatibility path for deployments where migration 024 is not live yet.
      const { data: memberships, error: membershipsError } = await supabase
      .from("organization_members")
      .select("org_id, role")
      .eq("user_id", user.id);

      if (membershipsError) {
        console.error("Failed to load organization memberships:", membershipsError.message);
        setOrgLoadError(membershipsError.message);
        setOrgs([]);
        setActiveOrgId(null);
        setLoading(false);
        return;
      }

      if (!memberships || memberships.length === 0) {
        setOrgs([]);
        setActiveOrgId(null);
        setLoading(false);
        return;
      }

      const orgIds = memberships.map((m) => m.org_id);
      let { data: orgsData, error: orgsError } = await supabase
      .from("organizations")
      .select("id, name, slug, logo_url, member_roles, subscription_status, trial_started_at, trial_ends_at, is_individual")
      .in("id", orgIds);

    // Keep organization pages usable during a staged deployment where the
    // frontend reaches production before migration 022 has been applied.
    if (orgsError && /trial_(started|ends)_at/i.test(orgsError.message)) {
      const legacyResult = await supabase
        .from("organizations")
        .select("id, name, slug, logo_url, member_roles, subscription_status")
        .in("id", orgIds);
      orgsData = legacyResult.data as typeof orgsData;
      orgsError = legacyResult.error;
    }

      if (orgsError) {
        console.error("Failed to load organizations:", orgsError.message);
        setOrgLoadError(orgsError.message);
      }

      if (!orgsData || orgsData.length === 0) {
        setOrgs([]);
        setActiveOrgId(null);
        setLoading(false);
        return;
      }

      orgList = memberships.map((m: any) => {
        const org = orgsData.find((o) => o.id === m.org_id);
        return {
          id: m.org_id,
          name: org?.name || "Unknown",
          slug: org?.slug || "",
          logo_url: org?.logo_url || null,
          role: m.role,
          member_roles: Array.isArray(org?.member_roles) && org.member_roles.length > 0 ? org.member_roles : ROLE_OPTIONS,
          subscription_status: org?.subscription_status ?? null,
          trial_started_at: org?.trial_started_at ?? null,
          trial_ends_at: org?.trial_ends_at ?? null,
          is_individual: (org as any)?.is_individual ?? false,
        };
      });
    }

    setOrgs(orgList);

    // Get active org from preferences
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("active_org_id")
      .eq("user_id", user.id)
      .single();

    const storedOrgId = prefs?.active_org_id;
    const validOrg = orgList.find((o) => o.id === storedOrgId);

    if (validOrg) {
      setActiveOrgId(validOrg.id);
    } else {
      // Default to first org
      setActiveOrgId(orgList[0].id);
      await supabase
        .from("user_preferences")
        .upsert({ user_id: user.id, active_org_id: orgList[0].id }, { onConflict: "user_id" });
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOrgs();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Reloading flips `loading` on, and ProGate answers "loading" by swapping
      // the whole page for a skeleton — unmounting every component under it, so
      // an open right-click menu, an Edit Equipment window, an unsaved draft all
      // vanish. Supabase re-announces the session (SIGNED_IN) every time the
      // browser tab becomes visible again, and refreshes the token in the
      // background (TOKEN_REFRESHED); neither changes who is signed in, so
      // neither needs a reload. Only a real change of user does.
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      if (event === "SIGNED_IN" && session?.user?.id && session.user.id === userIdRef.current) return;
      fetchOrgs();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchOrgs]);

  async function switchOrg(orgId: string) {
    const target = orgs.find((o) => o.id === orgId);
    if (!target) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from("user_preferences")
        .upsert({ user_id: user.id, active_org_id: orgId }, { onConflict: "user_id" });
      if (error) console.error("Failed to persist active org:", error);
    }
    setActiveOrgId(orgId);
  }

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;
  const paidAccess = activeOrg?.subscription_status === "active" || activeOrg?.subscription_status === "trialing";
  const trialAccess = Boolean(activeOrg?.trial_ends_at && new Date(activeOrg.trial_ends_at).getTime() > accessNow);
  const accessStatus: ProAccessStatus = loading
    ? "loading"
    : !user
    ? "anonymous"
    : !activeOrg
    ? orgLoadError ? "org_error" : "no_org"
    : paidAccess
    ? "active"
    : hasAccessOverride
    ? "override"
    : trialAccess
    ? "trial"
    : "expired";
  const isPro = accessStatus === "active" || accessStatus === "trial" || accessStatus === "override";

  useEffect(() => {
    if (!activeOrg?.trial_ends_at || paidAccess) return;
    const remaining = new Date(activeOrg.trial_ends_at).getTime() - Date.now();
    if (remaining <= 0) {
      setAccessNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setAccessNow(Date.now()), Math.min(remaining + 250, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [activeOrg?.trial_ends_at, paidAccess]);

  return (
    <OrgContext.Provider value={{ activeOrg, orgs, switchOrg, refreshOrgs: fetchOrgs, loading, isPro, hasAccessOverride, user, accessStatus, trialEndsAt: activeOrg?.trial_ends_at ?? null, orgLoadError, upgradeModalOpen, openUpgradeModal, closeUpgradeModal }}>
      {children}
      {upgradeModalOpen && <UpgradeModal onClose={closeUpgradeModal} />}
    </OrgContext.Provider>
  );
}
