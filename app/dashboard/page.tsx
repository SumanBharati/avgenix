"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/components/OrgProvider";
import PMStoreProvider from "@/components/PMStoreProvider";
import { Scheduler } from "@/components/Scheduler";
import { getRecentTools } from "@/lib/recentTools";
import DashboardPageSkeleton from "@/components/DashboardPageSkeleton";
import AnimatedIcon from "@/components/AnimatedIcon";
import AvNewsList from "@/components/AvNewsList";
import ConduitIcon from "@/components/ConduitIcon";
import Rj45Icon from "@/components/Rj45Icon";
import TwoWayArrowsIcon from "@/components/TwoWayArrowsIcon";
import FormulaSheetIcon from "@/components/FormulaSheetIcon";

/* ── Pinned tools (calculators only) ───────────────────────── */
const VideoWallIconSmall = () => (
  <svg width="16" height="16" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <rect x="0"    y="0"    width="9" height="9" rx="1" fill="#8b5cf6" />
    <rect x="10.5" y="0"    width="9" height="9" rx="1" fill="#8b5cf6" />
    <rect x="21"   y="0"    width="9" height="9" rx="1" fill="#8b5cf6" />
    <rect x="0"    y="10.5" width="9" height="9" rx="1" fill="#8b5cf6" />
    <rect x="10.5" y="10.5" width="9" height="9" rx="1" fill="#8b5cf6" />
    <rect x="21"   y="10.5" width="9" height="9" rx="1" fill="#8b5cf6" />
    <rect x="0"    y="21"   width="9" height="9" rx="1" fill="#8b5cf6" />
    <rect x="10.5" y="21"   width="9" height="9" rx="1" fill="#8b5cf6" />
    <rect x="21"   y="21"   width="9" height="9" rx="1" fill="#8b5cf6" />
  </svg>
);

const allTools: { name: string; icon: React.ReactNode; href: string }[] = [
  { name: "Display Sizing",   icon: "📺", href: "/calculators/display-sizing" },
  { name: "Aspect Ratio to Display Size Converter", icon: "📐", href: "/calculators/screen-size" },
  { name: "Camera FOV",       icon: "📷", href: "/calculators/camera-fov" },
  { name: "Throw & Lumens",   icon: "📽️", href: "/calculators/throw-ratio" },
  { name: "LED Pixel Pitch",  icon: <VideoWallIconSmall />, href: "/calculators/led-pitch" },
  { name: "Speaker Coverage", icon: "🔊", href: "/calculators/speaker-coverage" },
  { name: "PAG / NAG",        icon: "🎤", href: "/calculators/pag-nag" },
  { name: "70V Tap",          icon: "⚡", href: "/calculators/70v-tap" },
  { name: "Conduit Fill",     icon: <ConduitIcon size={16} />, href: "/calculators/conduit-fill" },
  { name: "PoE Budget",       icon: <Rj45Icon size={16} />, href: "/calculators/poe-budget" },
  { name: "Dante Bandwidth",  icon: <TwoWayArrowsIcon size={16} />, href: "/calculators/dante-bandwidth" },
  { name: "Rack Heat Load",   icon: "🌡️", href: "/calculators/rack-heat" },
  { name: "Unit Converter",   icon: "🔄", href: "/calculators/unit-converter" },
  { name: "Formula Sheet",    icon: <FormulaSheetIcon size={16} />, href: "/calculators/standards" },
  { name: "PoE Device Database", icon: "📦", href: "/calculators/poe-database" },
];

export default function DashboardPage() {
  const router = useRouter();
  const { activeOrg, loading: orgLoading, accessStatus } = useOrg();
  const [showNewProject, setShowNewProject] = useState(false);
  const [search, setSearch] = useState("");
  const [projectCount, setProjectCount] = useState(0);
  const [recentProjects, setRecentProjects] = useState<{ id: string; name: string; phase: string; created_at: string; job_number: string | null }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [stageCounts, setStageCounts] = useState<{ label: string; count: number; color: string }[]>([]);
  const [activities, setActivities] = useState<{ action: string; project: string; user: string; time: string }[]>([]);
  const [pipelineValues, setPipelineValues] = useState<{ total: number; inProposal: number; inExecution: number }>({ total: 0, inProposal: 0, inExecution: 0 });
  const [recentToolHrefs, setRecentToolHrefs] = useState<string[]>([]);

  useEffect(() => {
    setRecentToolHrefs(getRecentTools());
  }, []);

  // A signed-in user with no org yet (fresh signup) lands here straight from
  // the auth modal; without this they'd be stuck on the skeleton forever,
  // since the project-loading effect below never runs without an activeOrg.
  useEffect(() => {
    if (accessStatus === "no_org") router.replace("/welcome");
  }, [accessStatus, router]);

  useEffect(() => {
    if (orgLoading || !activeOrg) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      // Load project count and most recent project
      supabase.from("projects").select("id, name, phase, created_at, job_number")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .then(({ data }) => {
          if (!data) { setLoaded(true); return; }
          setProjectCount(data.length);
          setRecentProjects(data.slice(0, 5));

          // Build stage counts
          const phaseMap: Record<string, { label: string; color: string }> = {
            "opportunity":    { label: "Opportunity",   color: "#3b82f6" },
            "proposal":       { label: "Proposal",      color: "#10b981" },
            "contract":       { label: "Contract",      color: "#f59e0b" },
            "installation":   { label: "Execution",     color: "#8b5cf6" },
            "completed":      { label: "Completed",     color: "#14b8a6" },
          };
          const counts: Record<string, number> = {};
          data.forEach((p) => { counts[p.phase || "opportunity"] = (counts[p.phase || "opportunity"] || 0) + 1; });
          setStageCounts(
            Object.entries(phaseMap).map(([key, val]) => ({ label: val.label, count: counts[key] || 0, color: val.color }))
          );

          // Load proposal values for pipeline
          supabase.from("proposals").select("project_id, data")
            .then(({ data: proposals }) => {
              let totalPipe = 0, propPipe = 0, execPipe = 0;
              data.forEach((p) => {
                if (p.phase === "lost" || p.phase === "completed") return;
                const propRow = (proposals || []).find(pr => pr.project_id === p.id);
                if (!propRow) return;
                const pData = propRow.data as { sections?: { items?: { qty: number; unitCost: number }[] }[] } | null;
                const val = pData?.sections?.reduce((s, sec) =>
                  s + (sec.items?.reduce((si, item) => si + (item.qty || 0) * (item.unitCost || 0), 0) || 0), 0) || 0;
                totalPipe += val;
                if (p.phase === "proposal") propPipe += val;
                if (p.phase === "contract" || p.phase === "installation") execPipe += val;
              });
              setPipelineValues({ total: totalPipe, inProposal: propPipe, inExecution: execPipe });
            });

          // Build activity feed from projects
          const activityList = data.map((p) => ({
            action: p.phase && p.phase !== "opportunity"
              ? `moved to ${phaseMap[p.phase]?.label || p.phase}`
              : "created project",
            project: p.name,
            user: user.user_metadata?.full_name || user.email || "Someone",
            time: p.created_at,
          }));
          setActivities(activityList.slice(0, 8));
          setLoaded(true);
        });
    });
  }, [activeOrg?.id, orgLoading]);

  async function handleCreateProject(data: { name: string; jobNumber: string; clientName: string; sales: string; engineer: string }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (!activeOrg) return;
    const { data: inserted, error } = await supabase
      .from("projects")
      .insert({
        org_id: activeOrg.id,
        user_id: user.id,
        name: data.name,
        job_number: data.jobNumber,
        client_name: data.clientName,
        sales: data.sales,
        engineer: data.engineer,
        created_by: user.user_metadata?.full_name || user.email || "",
        phase: "opportunity",
      })
      .select()
      .single();

    if (!error && inserted) {
      setShowNewProject(false);
      router.push(`/projects/${inserted.id}`);
    }
  }

  if (orgLoading || !loaded) return <DashboardPageSkeleton />;

  return (
    <div className="animate-fade-in flex flex-col px-4 pt-6 pb-16 sm:px-6 lg:px-8" style={{ minHeight: "calc(100vh - 124px)" }}>

      {/* ── Info cards (full width) ────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">

          {/* Projects Card */}
          <div className="relative flex min-h-[200px] flex-col overflow-hidden rounded-2xl p-5"
            style={{
              background: "var(--infocard-bg)",
              borderTop:    "1.5px solid var(--infocard-border-a)",
              borderRight:  "1.5px solid var(--infocard-border-a)",
              borderBottom: "1.5px solid var(--infocard-border-b)",
              borderLeft:   "1.5px solid var(--infocard-border-b)",
              boxShadow: "var(--infocard-shadow)",
            }}
          >
            {/* Text content — above wave */}
            <div className="relative z-10 flex flex-col">
              <Link href="/projects" className="group mb-3 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "var(--infocard-icon-mint-bg)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3L21 19.5H3Z" stroke="#67DBB8" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="text-[15px] font-bold" style={{ color: "var(--infocard-heading)" }}>Projects</span>
                {projectCount > 0 && (
                  <span className="rounded-lg px-2 py-0.5 text-[12px] font-semibold" style={{ background: "var(--infocard-badge-bg)", color: "var(--infocard-badge-text)" }}>
                    {projectCount}
                  </span>
                )}
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="ml-auto transition-opacity opacity-50 group-hover:opacity-100">
                  <path d="M6 3L11 8L6 13" stroke="var(--infocard-chevron)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              {recentProjects.length > 0 ? (
                <>
                  <p className="mb-2.5 text-[12px] font-medium" style={{ color: "var(--infocard-label)" }}>Most Recent Projects</p>
                  <div className="flex flex-col gap-1.5">
                    {recentProjects.map((p, i) => (
                      <Link key={i} href={`/projects/${p.id}`} className="flex w-fit items-center gap-2.5 rounded-lg px-1 py-0.5 transition-colors hover:bg-[var(--infocard-hover-bg)]">
                        <span className="text-[14px] font-semibold" style={{ color: "var(--infocard-heading)" }}>{p.name}</span>
                        {p.job_number && (
                          <span className="text-[12px] font-medium" style={{ color: "var(--infocard-subtle)" }}>#{p.job_number}</span>
                        )}
                        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: "var(--infocard-pill-bg)", color: "var(--infocard-pill-text)", border: "1px solid var(--infocard-pill-border)" }}>
                          {p.phase?.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Opportunity"}
                        </span>
                      </Link>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-[13px]" style={{ color: "var(--infocard-subtle)" }}>No projects yet</p>
              )}
            </div>

            {/* Bottom wave — gentle hill rising left→right then tapering */}
            <svg
              className="pointer-events-none absolute bottom-0 left-0 w-full"
              style={{ zIndex: 0 }}
              viewBox="0 0 400 90" preserveAspectRatio="none" height="90"
            >
              <path d="M0 78 C120 76 200 12 400 4 L400 90 L0 90 Z" fill="var(--infocard-wave)" />
            </svg>

            {/* Animated Projects folder illustration */}
            <img
              src="/animated-icons/avgenix-purple-folder-subtle-shine-transparent.webp"
              alt=""
              className="pointer-events-none absolute right-0 w-[112px]"
              style={{ bottom: "12px" }}
              draggable={false}
            />
          </div>

          {/* Calculators Card */}
          <div className="relative flex min-h-[200px] flex-col overflow-hidden rounded-2xl p-5"
            style={{
              background: "var(--infocard-bg)",
              borderTop:    "1.5px solid var(--infocard-border-a)",
              borderRight:  "1.5px solid var(--infocard-border-a)",
              borderBottom: "1.5px solid var(--infocard-border-b)",
              borderLeft:   "1.5px solid var(--infocard-border-b)",
              boxShadow: "var(--infocard-shadow)",
            }}
          >
            {/* Text content — above wave */}
            <div className="relative z-10 flex flex-col">
              <Link href="/calculators" className="group mb-3 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "var(--infocard-icon-purple-bg)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="4" y="4" width="16" height="16" rx="3" stroke="#8b5cf6" strokeWidth="1.8" />
                    <line x1="8" y1="9" x2="16" y2="9" stroke="#8b5cf6" strokeWidth="1.2" opacity="0.7" />
                    <circle cx="9"  cy="13" r="1" fill="#8b5cf6" opacity="0.8" />
                    <circle cx="12" cy="13" r="1" fill="#8b5cf6" opacity="0.5" />
                    <circle cx="15" cy="13" r="1" fill="#8b5cf6" opacity="0.8" />
                  </svg>
                </div>
                <span className="text-[15px] font-bold" style={{ color: "var(--infocard-heading)" }}>Calculators</span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="ml-auto opacity-50 transition-opacity group-hover:opacity-100">
                  <path d="M6 3L11 8L6 13" stroke="var(--infocard-chevron)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              {(() => {
                const recent = recentToolHrefs
                  .map((h) => allTools.find((t) => t.href === h))
                  .filter((t): t is typeof allTools[number] => Boolean(t))
                  .slice(0, 5);
                if (recent.length === 0) {
                  return <p className="text-[13px]" style={{ color: "var(--infocard-label)" }}>{allTools.length} calculators available</p>;
                }
                return (
                  <>
                    <p className="mb-2.5 text-[12px] font-medium" style={{ color: "var(--infocard-label)" }}>Recently Used</p>
                    <div className="flex flex-col gap-1.5">
                      {recent.map((tool) => (
                        <Link key={tool.name} href={tool.href} className="flex w-fit items-center gap-2.5 rounded-lg px-1 py-0.5 transition-colors hover:bg-[var(--infocard-hover-bg)]">
                          <span className="text-sm">{tool.icon}</span>
                          <span className="text-[13px] font-medium" style={{ color: "var(--infocard-item)" }}>{tool.name}</span>
                        </Link>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Bottom wave */}
            <svg
              className="pointer-events-none absolute bottom-0 left-0 w-full"
              style={{ zIndex: 0 }}
              viewBox="0 0 400 90" preserveAspectRatio="none" height="90"
            >
              <path d="M0 78 C120 76 200 12 400 4 L400 90 L0 90 Z" fill="var(--infocard-wave)" />
            </svg>

            {/* Calculator illustration — animated once
                public/animated-icons/calculator.json exists */}
            <AnimatedIcon
              src="/animated-icons/calculator.json"
              fallbackSrc="/3DCalculator.png"
              className="pointer-events-none absolute right-4 w-[118px]"
              style={{ bottom: "12px" }}
            />
          </div>

          {/* AV News Card */}
          <div className="relative flex min-h-[200px] flex-col overflow-hidden rounded-2xl p-5"
            style={{
              background: "var(--infocard-bg)",
              borderTop:    "1.5px solid var(--infocard-border-a)",
              borderRight:  "1.5px solid var(--infocard-border-a)",
              borderBottom: "1.5px solid var(--infocard-border-b)",
              borderLeft:   "1.5px solid var(--infocard-border-b)",
              boxShadow: "var(--infocard-shadow)",
            }}
          >
            {/* Text content — above wave */}
            <div className="relative z-10 flex flex-col">
              <Link href="/av-news" className="group mb-3 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "var(--infocard-icon-mint-bg)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="5" width="18" height="14" rx="2" stroke="#67DBB8" strokeWidth="1.8" />
                    <line x1="7" y1="9"  x2="17" y2="9"  stroke="#67DBB8" strokeWidth="1.1" opacity="0.7" />
                    <line x1="7" y1="12" x2="14" y2="12" stroke="#67DBB8" strokeWidth="1.1" opacity="0.6" />
                    <line x1="7" y1="15" x2="16" y2="15" stroke="#67DBB8" strokeWidth="1.1" opacity="0.7" />
                  </svg>
                </div>
                <span className="text-[15px] font-bold" style={{ color: "var(--infocard-heading)" }}>AV News & Podcasts</span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="ml-auto transition-opacity opacity-50 group-hover:opacity-100">
                  <path d="M6 3L11 8L6 13" stroke="var(--infocard-chevron)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <p className="mb-2.5 text-[12px] font-medium" style={{ color: "var(--infocard-label)" }}>Latest from the AV industry</p>
              <AvNewsList />
            </div>

            {/* Bottom wave */}
            <svg
              className="pointer-events-none absolute bottom-0 left-0 w-full"
              style={{ zIndex: 0 }}
              viewBox="0 0 400 90" preserveAspectRatio="none" height="90"
            >
              <path d="M0 78 C120 76 200 12 400 4 L400 90 L0 90 Z" fill="var(--infocard-wave)" />
            </svg>

            {/* AV News/Podcast illustration — animated once
                public/animated-icons/news-podcast.json exists */}
            <AnimatedIcon
              src="/animated-icons/news-podcast.json"
              fallbackSrc="/3DNews.png"
              className="pointer-events-none absolute right-0 w-[128px]"
              style={{ bottom: "12px" }}
            />
          </div>
        </div>

      {/* ── Dashboard (wraps Project Dashboard + Schedule Dashboard) ── */}
      <div className="forge-gradient-card mb-6 flex flex-1 min-h-0 flex-col rounded-xl border-2 border-blue-500/40 p-6 shadow-lg shadow-blue-500/5">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="8" height="10" rx="1.5" stroke="#8b5cf6" strokeWidth="1.8" />
              <rect x="3" y="15" width="8" height="6" rx="1.5" stroke="#8b5cf6" strokeWidth="1.8" />
              <rect x="13" y="3" width="8" height="6" rx="1.5" stroke="#8b5cf6" strokeWidth="1.8" />
              <rect x="13" y="11" width="8" height="10" rx="1.5" stroke="#8b5cf6" strokeWidth="1.8" />
            </svg>
          </div>
          <span className="text-[20px] font-bold tracking-tight text-heading">Dashboard</span>
        </div>

        <div className="flex flex-1 min-h-0 flex-col gap-5 xl:flex-row">

        {/* ── Project Dashboard ──────────────────────── */}
        <div className="flex flex-[3] min-w-0 flex-col p-4">
          <div className="flex flex-1 flex-col gap-4 overflow-x-auto 2xl:flex-row">
            {/* Left: Pie Chart */}
            <div className="flex flex-1 min-w-0 flex-col">
              <div className="mb-3 flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="#8b5cf6" strokeWidth="1.2" />
                  <path d="M8 2a6 6 0 015.2 3L8 8V2z" fill="#8b5cf6" opacity="0.35" />
                </svg>
                <span className="text-[13px] font-semibold text-secondary">Projects by Stages</span>
              </div>
              {(() => {
                const total = stageCounts.reduce((s, d) => s + d.count, 0);
                return (
                  <div className="flex w-full flex-1 flex-col items-center justify-center gap-4">
                    <div className="flex w-full flex-col items-center justify-center gap-4 sm:flex-row">
                      <svg viewBox="0 0 220 220" className="h-[220px] w-[220px] sm:h-[280px] sm:w-[280px]">
                        {total > 0 ? (() => {
                          const cx = 110, cy = 110, r = 90;
                          const nonZero = stageCounts.filter(s => s.count > 0);
                          if (nonZero.length === 1) {
                            return <circle cx={cx} cy={cy} r={r} fill={nonZero[0].color} opacity={0.85} stroke="var(--chart-stroke)" strokeWidth={2} />;
                          }
                          let cumAngle = -Math.PI / 2;
                          return nonZero.map((stage) => {
                            const angle = (stage.count / total) * 2 * Math.PI;
                            const x1 = cx + r * Math.cos(cumAngle);
                            const y1 = cy + r * Math.sin(cumAngle);
                            cumAngle += angle;
                            const x2 = cx + r * Math.cos(cumAngle);
                            const y2 = cy + r * Math.sin(cumAngle);
                            const largeArc = angle > Math.PI ? 1 : 0;
                            return (
                              <path
                                key={stage.label}
                                d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`}
                                fill={stage.color}
                                opacity={0.85}
                                stroke="var(--chart-stroke)"
                                strokeWidth={2}
                              />
                            );
                          });
                        })() : (
                          <circle cx="110" cy="110" r="90" fill="var(--chart-empty)" opacity={0.3} />
                        )}
                        <circle cx="110" cy="110" r="50" fill="var(--chart-center)" />
                        <text x="110" y="105" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--chart-text)">{total}</text>
                        <text x="110" y="124" textAnchor="middle" fontSize="12" fill="var(--chart-text-dim)">Total</text>
                      </svg>
                      <div className="flex flex-col gap-3">
                        {stageCounts.map((stage) => (
                          <div key={stage.label} className="flex items-center gap-3">
                            <div className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: stage.color }} />
                            <span className="w-[110px] text-[13px] text-muted">{stage.label}</span>
                            <span className="font-mono text-[13px] font-semibold text-body">{stage.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Divider */}
            <div className="h-px w-full bg-border lg:h-auto lg:w-px" />

            {/* Pipeline Overview */}
            <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[230px]">
              <div className="mb-1 flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path d="M2 3h12L9 8.5V13l-2-1V8.5L2 3z" stroke="#8b5cf6" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                <span className="text-[13px] font-semibold text-secondary">Pipeline Overview</span>
              </div>
              {[
                { label: "Total Pipeline", value: pipelineValues.total, color: "#8b5cf6" },
                { label: "In Proposal", value: pipelineValues.inProposal, color: "#10b981" },
                { label: "In Execution", value: pipelineValues.inExecution, color: "#f59e0b" },
              ].map((card) => {
                const formatted = card.value >= 1000000
                  ? `$${(card.value / 1000000).toFixed(1)}M`
                  : card.value >= 1000
                  ? `$${(card.value / 1000).toFixed(0)}K`
                  : `$${card.value.toLocaleString()}`;
                return (
                  <div key={card.label} className="rounded border-l-[3px] px-3 py-2" style={{ borderLeftColor: card.color }}>
                    <div className="text-[10px] text-subtle">{card.label}</div>
                    <div className="text-lg font-bold text-heading">{formatted}</div>
                  </div>
                );
              })}
            </div>

            {/* Divider */}
            <div className="h-px w-full bg-border lg:h-auto lg:w-px" />

            {/* Right: Team Activity */}
            <div className="flex w-full shrink-0 flex-col lg:w-[280px]">
              <div className="mb-3 flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <circle cx="6" cy="5" r="3" stroke="#8b5cf6" strokeWidth="1.2" />
                  <path d="M1 14c0-2.8 2.2-4 5-4" stroke="#8b5cf6" strokeWidth="1.2" strokeLinecap="round" />
                  <circle cx="11" cy="5" r="2.5" stroke="#8b5cf6" strokeWidth="1.2" />
                  <path d="M15 13c0-2.2-1.8-3.5-4-3.5" stroke="#8b5cf6" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span className="text-[13px] font-semibold text-secondary">Team Activity</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {activities.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[13px] text-faint">No activity yet</div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {activities.map((a, i) => {
                      const timeAgo = (() => {
                        const diff = Date.now() - new Date(a.time).getTime();
                        const mins = Math.floor(diff / 60000);
                        if (mins < 1) return "just now";
                        if (mins < 60) return `${mins}m ago`;
                        const hrs = Math.floor(mins / 60);
                        if (hrs < 24) return `${hrs}h ago`;
                        const days = Math.floor(hrs / 24);
                        return `${days}d ago`;
                      })();
                      return (
                        <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-forge-surface/30">
                          <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-[10px] font-bold text-blue-400">
                            {a.user.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] leading-snug text-secondary">
                              <span className="font-medium text-body">{a.user}</span>{" "}
                              <span className="text-subtle">{a.action}</span>{" "}
                              <span className="font-medium text-secondary">{a.project}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-faint">{timeAgo}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Divider between Project Dashboard and Schedule Dashboard */}
        <div className="h-px w-full bg-border xl:h-auto xl:w-px" />

        {/* ── Schedule Dashboard ─────────────────────── */}
        <div className="flex flex-[2] min-w-0 flex-col overflow-hidden p-4">
          <div className="mb-3 flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="#8b5cf6" strokeWidth="1.3" />
              <path d="M2 6h12" stroke="#8b5cf6" strokeWidth="1.3" />
              <path d="M6 2v2M10 2v2" stroke="#8b5cf6" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span className="text-[13px] font-semibold text-secondary">Schedule</span>
          </div>
          <div className="min-h-[320px] flex-1 overflow-hidden rounded-lg border border-border">
            <PMStoreProvider>
              <Scheduler hideToolbar compact />
            </PMStoreProvider>
          </div>
        </div>

        </div>
      </div>

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={handleCreateProject}
        />
      )}
    </div>
  );
}

/* ── New Project Modal ─────────────────────────────────────── */
function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: { name: string; jobNumber: string; clientName: string; sales: string; engineer: string }) => void;
}) {
  const [name, setName] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [sales, setSales] = useState("");
  const [engineer, setEngineer] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      jobNumber: jobNumber.trim(),
      clientName: clientName.trim(),
      sales: sales.trim(),
      engineer: engineer.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[440px] animate-fade-in rounded-xl border border-border bg-forge-surface p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-heading">New Project</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-forge-card hover:text-secondary">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">
              Project Name <span className="text-red-400">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. School AV Upgrade"
              className="forge-input"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Job Number</label>
            <input
              type="text"
              value={jobNumber}
              onChange={(e) => setJobNumber(e.target.value)}
              placeholder="e.g. 343243"
              className="forge-input"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Client Name</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Corporation"
              className="forge-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Sales</label>
              <input
                type="text"
                value={sales}
                onChange={(e) => setSales(e.target.value)}
                placeholder="e.g. John Smith"
                className="forge-input"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Engineer</label>
              <input
                type="text"
                value={engineer}
                onChange={(e) => setEngineer(e.target.value)}
                placeholder="e.g. Jane Doe"
                className="forge-input"
              />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-body">
              Cancel
            </button>
            <button type="submit" disabled={!name.trim()} className="forge-btn-primary text-[13px]">
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
