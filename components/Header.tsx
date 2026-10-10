"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import OrgSwitcher from "./OrgSwitcher";
import BrandLogo from "./BrandLogo";
import ProAuthModal from "./ProAuthModal";
import { useTheme } from "./ThemeProvider";

function SunIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>;
}

function MoonIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>;
}

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "reset" | null>(null);
  // Where to go after signing in, handed over by /login (invite emails, old links).
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [pendingNext, setPendingNext] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  // /login forwards here as /?auth=signin|signup|reset[&invite=…][&next=…].
  // Read once from window rather than useSearchParams, which would force a
  // Suspense boundary around the header on every page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    if (auth !== "signin" && auth !== "signup" && auth !== "reset") return;
    const next = params.get("next");
    setPendingInvite(params.get("invite"));
    setPendingNext(next?.startsWith("/") && !next.startsWith("//") ? next : null);
    setAuthMode(auth);
    params.delete("auth"); params.delete("invite"); params.delete("next");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }, []);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const fullName = user?.user_metadata?.full_name || user?.email || "";
  const avatarUrl = user?.user_metadata?.avatar_url;
  const initials = fullName.split(" ").map((name: string) => name[0]).join("").toUpperCase().slice(0, 2);

  function handleSignedIn() {
    setAuthMode(null);
    if (pendingInvite) {
      router.push(`/org/invite?token=${encodeURIComponent(pendingInvite)}`);
      return;
    }
    // Whether this user has an org yet is OrgProvider's job (it's already
    // re-fetching off the same sign-in event) — /dashboard sends no-org users
    // on to /welcome itself rather than this needing its own lookup.
    router.push(pendingNext ?? "/dashboard");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setDropdownOpen(false);
    router.push("/");
  }

  return (
    <>
    <header className="sticky top-0 z-40 flex h-[72px] shrink-0 items-center justify-between border-b border-border bg-forge-panel px-4 sm:px-6 xl:px-8">
      <div className="flex min-w-0 items-center gap-3 xl:gap-5">
        <Link href="/" className="flex shrink-0 items-center transition-opacity hover:opacity-80" aria-label="AVGenix home"><BrandLogo /></Link>
        {user && <><div className="h-8 w-px bg-border" /><div className="min-w-0"><OrgSwitcher /></div></>}
      </div>

      <div className="flex items-center gap-2">
        {user && (
          <nav className="mr-1 flex items-center gap-1" aria-label="Primary">
            <Link href="/" className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${pathname === "/" ? "bg-forge-surface text-heading" : "text-muted hover:bg-forge-surface hover:text-heading"}`}>Home</Link>
            <Link href="/dashboard" className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${pathname === "/dashboard" || pathname.startsWith("/dashboard/") ? "bg-forge-surface text-heading" : "text-muted hover:bg-forge-surface hover:text-heading"}`}>Dashboard</Link>
          </nav>
        )}
        <button onClick={toggle} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-forge-surface hover:text-heading" title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        {!user ? (
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setAuthMode("signup")} className="text-sm font-semibold text-blue-600 transition-colors hover:text-blue-500">Sign Up</button>
            <button type="button" onClick={() => setAuthMode("signin")} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700">Log In</button>
          </div>
        ) : (
          <div className="relative" ref={dropdownRef}>
          <button onClick={() => setDropdownOpen((open) => !open)} className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-border-light bg-forge-surface transition-all hover:border-blue-500/50" aria-label="Open profile menu" aria-expanded={dropdownOpen}>
            {avatarUrl ? <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" /> : <span className="text-xs font-bold text-secondary">{initials || "U"}</span>}
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-xl border border-border bg-forge-bg shadow-2xl">
              <div className="border-b border-border px-4 py-3"><div className="text-sm font-semibold text-body">{fullName}</div><div className="mt-0.5 truncate text-xs text-subtle">{user.email}</div></div>
              <Link href="/profile/settings" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-muted transition-colors hover:bg-forge-surface/40 hover:text-body">My Settings</Link>
              <Link href="/org/settings" onClick={() => setDropdownOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-muted transition-colors hover:bg-forge-surface/40 hover:text-body">Account Settings</Link>
              <button onClick={handleLogout} className="flex w-full items-center gap-2.5 border-t border-border px-4 py-2.5 text-[13px] text-red-400 transition-colors hover:bg-red-500/10">Logout</button>
            </div>
          )}
          </div>
        )}
      </div>
    </header>
    {authMode && createPortal(
      <ProAuthModal
        key={authMode}
        initialMode={authMode}
        onClose={() => setAuthMode(null)}
        onSignedIn={handleSignedIn}
        // The confirmation email returns through /login, which forwards a
        // confirmed session with ?invite= straight to accepting the invite.
        confirmRedirectPath={pendingInvite ? `/login?invite=${encodeURIComponent(pendingInvite)}` : "/login?next=%2Fwelcome"}
        notice={pendingInvite ? "You've been invited to join a team. Sign in, or create an account with the email address the invite was sent to." : undefined}
      />,
      document.body,
    )}
    </>
  );
}
