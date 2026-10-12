"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePMStore } from "@/components/PMStoreProvider";
import {
  addDays,
  fmtDateShort,
  isPersonOnLeave,
  isWeekend,
  personDailyCapacity,
  personScheduledHoursOnDate,
  personWeeklyHours,
  ROLE_OPTIONS,
  startOfWeek,
  TIME_OFF_COLORS,
  toISODate,
  uid,
  type Allocation,
  type AllocationStatus,
} from "@/lib/pm-store";

const ROW_HEIGHT = 60;
const SEPARATOR_HEIGHT = 30;

function addHoursToTime(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const totalMin = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + Math.round(hours * 60)));
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function MultiSelect({
  placeholder,
  options,
  selected,
  onChange,
}: {
  placeholder: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  const label = selected.size === 0 ? placeholder : `${placeholder} (${selected.size})`;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="forge-input flex h-8 items-center gap-1.5 text-sm"
      >
        <span className={selected.size > 0 ? "text-body" : "text-muted"}>{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-auto shrink-0 text-muted">
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[190px] overflow-hidden rounded-lg border border-border bg-forge-panel shadow-lg">
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-subtle">No options</div>
          )}
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] text-body hover:bg-forge-surface/40">
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={() => {
                  const next = new Set(selected);
                  next.has(o.value) ? next.delete(o.value) : next.add(o.value);
                  onChange(next);
                }}
                className="accent-blue-500"
              />
              {o.label}
            </label>
          ))}
          {selected.size > 0 && (
            <button
              onClick={() => onChange(new Set())}
              className="w-full border-t border-border px-3 py-1.5 text-left text-[11px] text-subtle hover:text-body"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Scheduler({
  hideToolbar = false,
  compact = false,
}: { hideToolbar?: boolean; compact?: boolean } = {}) {
  const NAME_COL_WIDTH = compact ? 160 : 220;
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [cursor, setCursor] = useState<Date>(() => startOfWeek(new Date()));
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setGridWidth(el.clientWidth);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const DAY_WIDTH = gridWidth > 0 ? Math.floor(gridWidth / 7) : (compact ? 60 : 120);
  const { store, update, currentUserId, loading } = usePMStore();
  const [search, setSearch] = useState("");
  const [filterRoles, setFilterRoles] = useState<Set<string>>(new Set());
  const [filterProjects, setFilterProjects] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Allocation | null>(null);
  const [creating, setCreating] = useState<{
    personId: string;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    hoursPerDay: number;
    x: number;
    y: number;
  } | null>(null);
  const [drag, setDrag] = useState<{ personId: string; rowLeft: number; downX: number; endX: number } | null>(null);

  const effectiveDays = 7;
  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < effectiveDays; i++) arr.push(addDays(cursor, i));
    return arr;
  }, [cursor, effectiveDays]);

  const rangeStart = toISODate(days[0]);
  const rangeEnd = toISODate(days[days.length - 1]);

  const visiblePeople = useMemo(() => {
    return store.people
      .filter((p) => !p.archived)
      .filter((p) => search === "" || p.name.toLowerCase().includes(search.toLowerCase()))
      .filter((p) => filterRoles.size === 0 || filterRoles.has(p.role))
      .filter((p) => {
        if (filterProjects.size === 0) return true;
        return store.allocations.some(
          (a) => a.personId === p.id && filterProjects.has(a.projectId),
        );
      })
      .sort((a, b) => (a.role || "").localeCompare(b.role || "") || a.name.localeCompare(b.name));
  }, [store.people, store.allocations, search, filterRoles, filterProjects]);

  const groupedPeople = useMemo(() => {
    const groups: { role: string; people: typeof visiblePeople }[] = [];
    for (const p of visiblePeople) {
      const role = p.role || "No Role";
      const g = groups.find((g) => g.role === role);
      if (g) g.people.push(p);
      else groups.push({ role, people: [p] });
    }
    return groups;
  }, [visiblePeople]);

  const projectsById = useMemo(
    () => Object.fromEntries(store.projects.map((p) => [p.id, p])),
    [store.projects],
  );

  // Widen a day's column when any visible person is scheduled past their daily capacity that day
  const dayWidths = useMemo(() => {
    return days.map((d) => {
      const iso = toISODate(d);
      let maxRatio = 1;
      for (const p of visiblePeople) {
        const cap = personDailyCapacity(p);
        if (cap <= 0) continue;
        const scheduled = personScheduledHoursOnDate(p.id, iso, store.allocations);
        maxRatio = Math.max(maxRatio, scheduled / cap);
      }
      return Math.round(DAY_WIDTH * maxRatio);
    });
  }, [days, visiblePeople, store.allocations, DAY_WIDTH]);

  const dayOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const w of dayWidths) {
      offsets.push(acc);
      acc += w;
    }
    return offsets;
  }, [dayWidths]);

  const timelineTotalWidth = dayOffsets.length > 0 ? dayOffsets[dayOffsets.length - 1] + dayWidths[dayWidths.length - 1] : 0;

  function dayIndexAtX(x: number) {
    for (let i = 0; i < dayOffsets.length; i++) {
      if (x < dayOffsets[i] + dayWidths[i]) return i;
    }
    return Math.max(0, dayOffsets.length - 1);
  }

  // Follow the mouse continuously while dragging, so the ghost bar grows smoothly
  // instead of snapping straight to a full day's width.
  useEffect(() => {
    if (!drag) return;
    function onMove(e: MouseEvent) {
      setDrag((d) => (d ? { ...d, endX: Math.max(0, Math.min(e.clientX - d.rowLeft, timelineTotalWidth)) } : d));
    }
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  // Commit drag on global mouseup
  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      if (!drag) return;
      const leftX = Math.min(drag.downX, drag.endX);
      const rightX = Math.max(drag.downX, drag.endX);
      const s = dayIndexAtX(leftX);
      const end = Math.max(s, dayIndexAtX(Math.max(leftX, rightX - 1)));

      // Estimate a duration from the dragged width, snapped to the nearest 15 minutes.
      // A plain click (no real drag) or a multi-day span defaults to a full day's capacity;
      // a partial drag within a single day scales proportionally.
      const person = store.people.find((p) => p.id === drag.personId);
      const cap = person ? personDailyCapacity(person) : 8;
      const draggedWidth = rightX - leftX;
      const isPartialSingleDayDrag = s === end && draggedWidth >= 8;
      const rawHours = isPartialSingleDayDrag ? (draggedWidth / DAY_WIDTH) * cap : cap;
      const estimatedHours = Math.max(0.25, Math.min(24, Math.round(rawHours * 4) / 4));
      const startTime = "09:00";
      const endTime = addHoursToTime(startTime, estimatedHours);

      setCreating({
        personId: drag.personId,
        startDate: toISODate(days[s]),
        endDate: toISODate(days[end]),
        startTime,
        endTime,
        hoursPerDay: estimatedHours,
        x: e.clientX,
        y: e.clientY,
      });
      setDrag(null);
    }
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [drag, days, dayOffsets, dayWidths, store.people, DAY_WIDTH]);

  function handleCellMouseDown(personId: string, rowLeft: number, x: number) {
    setDrag({ personId, rowLeft, downX: x, endX: x });
  }

  function goToday() {
    setCursor(startOfWeek(new Date()));
  }
  function shift(delta: number) {
    setCursor((c) => addDays(c, delta));
  }

  function openEdit(a: Allocation) {
    setEditing(a);
  }

  function saveAllocation(a: Allocation) {
    if (store.allocations.some((x) => x.id === a.id)) {
      update({ ...store, allocations: store.allocations.map((x) => (x.id === a.id ? a : x)) });
    } else {
      update({ ...store, allocations: [...store.allocations, a] });
    }
    setEditing(null);
    setCreating(null);
  }

  function deleteAllocation(id: string) {
    update({ ...store, allocations: store.allocations.filter((a) => a.id !== id) });
    setEditing(null);
  }

  const timelineWidth = dayWidths.reduce((sum, w) => sum + w, 0);
  const monthLabels = useMemo(() => {
    const out: { label: string; offset: number; width: number }[] = [];
    let curMonth = -1;
    let curYear = -1;
    let start = 0;
    days.forEach((d, i) => {
      if (d.getMonth() !== curMonth || d.getFullYear() !== curYear) {
        if (curMonth >= 0) {
          out.push({
            label: days[start].toLocaleDateString("en-US", { month: "short", year: "numeric" }),
            offset: dayOffsets[start],
            width: dayOffsets[i] - dayOffsets[start],
          });
        }
        curMonth = d.getMonth();
        curYear = d.getFullYear();
        start = i;
      }
    });
    if (curMonth >= 0) {
      out.push({
        label: days[start].toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        offset: dayOffsets[start],
        width: timelineWidth - dayOffsets[start],
      });
    }
    return out;
  }, [days, dayOffsets, timelineWidth]);

  const todayISO = toISODate(new Date());
  const todayOffset = days.findIndex((d) => toISODate(d) === todayISO);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      {!hideToolbar && (
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
        <div className="flex items-center gap-2">
          <button onClick={goToday} className="flex h-8 items-center rounded-lg border border-border bg-forge-surface/60 px-3 text-xs font-semibold text-body transition-colors hover:bg-forge-surface hover:text-heading">
            This Week
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-7)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-forge-surface/60 text-sm text-muted transition-colors hover:bg-forge-surface hover:text-heading">
              ‹
            </button>
            <div className="text-sm font-semibold text-heading">
              {days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
              {days[days.length - 1].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <button onClick={() => shift(7)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-forge-surface/60 text-sm text-muted transition-colors hover:bg-forge-surface hover:text-heading">
              ›
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people..."
            className="forge-input h-8 w-40 text-sm"
          />
          <MultiSelect
            placeholder="All roles"
            options={[...new Set(store.people.filter((p) => !p.archived && p.role).map((p) => p.role))].sort().map((r) => ({ value: r, label: r }))}
            selected={filterRoles}
            onChange={setFilterRoles}
          />
          <MultiSelect
            placeholder="All projects"
            options={store.projects.filter((p) => !p.archived).map((p) => ({ value: p.id, label: p.name }))}
            selected={filterProjects}
            onChange={setFilterProjects}
          />
        </div>
      </div>
      )}

      {/* Timeline */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: people */}
        <div className="shrink-0 border-r border-border bg-forge-panel" style={{ width: NAME_COL_WIDTH }}>
          <div className="sticky top-0 z-10 h-[58px] border-b border-border bg-forge-panel">
            <div className="flex h-full items-center justify-between px-4 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <span>{compact ? "Resources" : "People"}</span>
              {!compact && <span>This week</span>}
            </div>
          </div>
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-subtle">
              Loading…
            </div>
          ) : visiblePeople.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-subtle">
              No people match filters
            </div>
          ) : (
            groupedPeople.map(({ role, people }) => {
              const groupScheduled = people.reduce(
                (s, p) => s + days.reduce((ds, d) => ds + personScheduledHoursOnDate(p.id, toISODate(d), store.allocations), 0),
                0,
              );
              return (
                <div key={role}>
                  {/* Role separator */}
                  <div
                    className="flex items-center justify-between border-b border-border bg-forge-bg/60 px-4 text-[11px] font-bold uppercase tracking-wider text-subtle"
                    style={{ height: SEPARATOR_HEIGHT }}
                  >
                    <span>{role}</span>
                    <span className="font-mono text-faint">{groupScheduled}h</span>
                  </div>
                  {/* People in this group */}
                  {people.map((p) => {
                    const scheduled = days.reduce(
                      (s, d) => s + personScheduledHoursOnDate(p.id, toISODate(d), store.allocations),
                      0,
                    );
                    const weeks = days.length / 7;
                    const capacity = personWeeklyHours(p) * weeks;
                    const pct = capacity > 0 ? (scheduled / capacity) * 100 : 0;
                    const over = pct > 100;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 border-b border-border px-4"
                        style={{ height: ROW_HEIGHT }}
                      >
                        {p.avatar_url ? (
                          <img src={p.avatar_url} alt={p.name} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                        ) : (
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                            style={{ backgroundColor: p.color }}
                          >
                            {p.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "·"}
                          </div>
                        )}
                        <div className="flex-1 overflow-hidden">
                          <div className="truncate text-sm font-semibold text-body">{p.name}</div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-forge-bg">
                              <div
                                className="h-full transition-all"
                                style={{
                                  width: `${Math.min(pct, 100)}%`,
                                  backgroundColor: over ? "#ef4444" : pct > 80 ? "#f59e0b" : "#22c55e",
                                }}
                              />
                            </div>
                            <span className={`font-mono text-[10px] ${over ? "text-red-400" : "text-faint"}`}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Right column: grid */}
        <div ref={gridRef} className={`flex-1 ${compact ? "overflow-y-auto overflow-x-hidden" : "overflow-auto"}`}>
          <div style={{ width: compact ? "100%" : timelineWidth, position: "relative" }}>
            {/* Date headers */}
            <div className="sticky top-0 z-10 bg-forge-panel">
              <div className="relative flex h-7 border-b border-border">
                {monthLabels.map((m, i) => (
                  <div
                    key={i}
                    className="absolute top-0 flex h-full items-center border-r border-border px-2 text-[11px] font-semibold uppercase tracking-wider text-faint"
                    style={{ left: m.offset, width: m.width }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              <div className="flex h-[30px] border-b border-border">
                {days.map((d, i) => {
                  const weekend = isWeekend(d);
                  const isToday = toISODate(d) === todayISO;
                  return (
                    <div
                      key={i}
                      className={`flex shrink-0 flex-col items-center justify-center border-r border-border/50 text-[10px] ${
                        weekend ? "bg-forge-bg/40 text-faint" : "text-muted"
                      } ${isToday ? "bg-blue-500/10" : ""}`}
                      style={{ width: dayWidths[i] }}
                    >
                      <span className={isToday ? "font-bold text-blue-400" : "font-semibold"}>
                        {d.getDate()}
                      </span>
                      <span className="text-[9px] uppercase">
                        {d.toLocaleDateString("en-US", { weekday: "narrow" })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Today line */}
            {todayOffset >= 0 && (
              <div
                className="pointer-events-none absolute top-[58px] bottom-0 z-[5] w-px bg-blue-500/60"
                style={{ left: dayOffsets[todayOffset] + dayWidths[todayOffset] / 2 }}
              />
            )}

            {/* Rows grouped by role */}
            {groupedPeople.map(({ role, people }) => (
              <div key={role}>
                {/* Separator spacer — matches left column header height */}
                <div
                  className="border-b border-border bg-forge-bg/60"
                  style={{ height: SEPARATOR_HEIGHT }}
                />
                {people.map((p) => (
                  <PersonRow
                    key={p.id}
                    personId={p.id}
                    days={days}
                    dayWidths={dayWidths}
                    dayOffsets={dayOffsets}
                    rangeStart={rangeStart}
                    rangeEnd={rangeEnd}
                    drag={drag}
                    onCellMouseDown={handleCellMouseDown}
                    onAllocationClick={openEdit}
                  />
                ))}
              </div>
            ))}

          </div>
        </div>
      </div>

      {/* Edit / Create Modal */}
      {(editing || creating) && (
        <AllocationModal
          initial={
            editing || {
              id: uid(),
              title: "",
              personId: creating!.personId,
              projectId: "",
              phaseId: null,
              startDate: creating!.startDate,
              endDate: creating!.endDate,
              hoursPerDay: creating!.hoursPerDay,
              startTime: creating!.startTime,
              endTime: creating!.endTime,
              notes: "",
              status: "confirmed" as AllocationStatus,
            }
          }
          isNew={!editing}
          anchorX={creating?.x}
          anchorY={creating?.y}
          onClose={() => {
            setEditing(null);
            setCreating(null);
          }}
          onSave={saveAllocation}
          onDelete={editing ? () => deleteAllocation(editing.id) : undefined}
        />
      )}
    </div>
  );

  function PersonRow({
    personId,
    days,
    dayWidths,
    dayOffsets,
    rangeStart,
    rangeEnd,
    drag,
    onCellMouseDown,
    onAllocationClick,
  }: {
    personId: string;
    days: Date[];
    dayWidths: number[];
    dayOffsets: number[];
    rangeStart: string;
    rangeEnd: string;
    drag: { personId: string; rowLeft: number; downX: number; endX: number } | null;
    onCellMouseDown: (personId: string, rowLeft: number, x: number) => void;
    onAllocationClick: (a: Allocation) => void;
  }) {
    const rowRef = useRef<HTMLDivElement>(null);
    const person = store.people.find((p) => p.id === personId)!;
    const cap = personDailyCapacity(person);

    const personAllocs = store.allocations.filter(
      (a) =>
        a.personId === personId &&
        a.startDate <= rangeEnd &&
        a.endDate >= rangeStart,
    );
    const personTimeOff = store.timeOff.filter(
      (t) =>
        t.personId === personId &&
        t.startDate <= rangeEnd &&
        t.endDate >= rangeStart,
    );
    const personMilestones = store.milestones.filter(
      (m) => {
        const allocForProj = store.allocations.some(
          (a) => a.personId === personId && a.projectId === m.projectId,
        );
        return (
          allocForProj && m.date >= rangeStart && m.date <= rangeEnd
        );
      },
    );

    const isDraggingRow = drag?.personId === personId;

    // Compute cumulative hour offsets so overlapping allocations sit side-by-side horizontally
    const sortedAllocs = [...personAllocs].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
    const hoursOffsetForId = new Map<string, number>();
    for (const a of sortedAllocs) {
      const aEffStart = a.startDate < rangeStart ? rangeStart : a.startDate;
      let cum = 0;
      for (const b of sortedAllocs) {
        if (b.id === a.id) break;
        if (b.startDate <= aEffStart && b.endDate >= aEffStart) cum += b.hoursPerDay;
      }
      hoursOffsetForId.set(a.id, cum);
    }

    return (
      <div ref={rowRef} className="relative flex border-b border-border" style={{ height: ROW_HEIGHT }} onMouseLeave={() => {}}>
        {/* Grid cells */}
        {days.map((d, i) => {
          const iso = toISODate(d);
          const weekend = isWeekend(d);
          const onLeave = isPersonOnLeave(personId, iso, store.timeOff);
          const scheduled = personScheduledHoursOnDate(personId, iso, store.allocations);
          const over = scheduled > cap;
          return (
            <div
              key={i}
              onMouseDown={(e) => {
                if (onLeave || !rowRef.current) return;
                const rect = rowRef.current.getBoundingClientRect();
                onCellMouseDown(personId, rect.left, e.clientX - rect.left);
              }}
              className={`shrink-0 select-none border-r border-border/40 cursor-default hover:bg-blue-500/5 ${
                weekend ? "bg-forge-bg/40" : ""
              } ${onLeave ? "cursor-not-allowed" : ""}`}
              style={{ width: dayWidths[i], height: ROW_HEIGHT }}
              title={
                onLeave
                  ? `On leave (${onLeave.type})`
                  : `${scheduled}h scheduled · ${cap}h capacity${weekend ? " · Weekend" : ""}`
              }
            >
              {over && !onLeave && (
                <div className="pointer-events-none absolute inset-0 bg-red-500/10" />
              )}
            </div>
          );
        })}

        {/* Drag ghost bar — follows the mouse continuously, grows smoothly as you drag */}
        {isDraggingRow && (
          <div
            className="pointer-events-none absolute z-20 rounded-md border border-blue-600 bg-blue-500/80 shadow-sm"
            style={{
              top: 6,
              height: ROW_HEIGHT - 12,
              left: Math.min(drag!.downX, drag!.endX),
              width: Math.max(2, Math.abs(drag!.endX - drag!.downX)),
            }}
          />
        )}

        {/* Time off overlays */}
        {personTimeOff.map((t) => {
          const start = t.startDate < rangeStart ? rangeStart : t.startDate;
          const end = t.endDate > rangeEnd ? rangeEnd : t.endDate;
          const offset = days.findIndex((d) => toISODate(d) === start);
          const endIdx = days.findIndex((d) => toISODate(d) === end);
          if (offset < 0 || endIdx < 0) return null;
          return (
            <div
              key={t.id}
              className="pointer-events-none absolute top-1 bottom-1 rounded-md border"
              style={{
                left: dayOffsets[offset] + 2,
                width: dayOffsets[endIdx] + dayWidths[endIdx] - dayOffsets[offset] - 4,
                backgroundColor: TIME_OFF_COLORS[t.type] + "22",
                borderColor: TIME_OFF_COLORS[t.type] + "66",
                backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 6px, ${TIME_OFF_COLORS[t.type]}33 6px, ${TIME_OFF_COLORS[t.type]}33 12px)`,
              }}
              title={`${t.type}: ${fmtDateShort(t.startDate)} – ${fmtDateShort(t.endDate)}`}
            >
              <div className="px-2 pt-0.5 text-[10px] font-semibold uppercase" style={{ color: TIME_OFF_COLORS[t.type] }}>
                {t.type}
              </div>
            </div>
          );
        })}

        {/* Allocations */}
        {personAllocs.map((a) => {
          const start = a.startDate < rangeStart ? rangeStart : a.startDate;
          const end = a.endDate > rangeEnd ? rangeEnd : a.endDate;
          const offset = days.findIndex((d) => toISODate(d) === start);
          const endIdx = days.findIndex((d) => toISODate(d) === end);
          if (offset < 0 || endIdx < 0) return null;
          const proj = projectsById[a.projectId];
          const phase = a.phaseId ? store.phases.find((ph) => ph.id === a.phaseId) : null;
          const color = a.color || phase?.color || proj?.color || "#94a3b8";
          const tentative = a.status === "tentative";
          const cumHours = hoursOffsetForId.get(a.id) ?? 0;
          const pct = cap > 0 ? Math.min(a.hoursPerDay / cap, 1) : 1;
          const barTop = 4;
          const barH = ROW_HEIGHT - 8;
          const barWidth = Math.max(20, Math.round((endIdx - offset + 1) * DAY_WIDTH * pct - 4));
          const hourShift = cap > 0 ? (cumHours / cap) * DAY_WIDTH : 0;
          return (
            <button
              key={a.id}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onAllocationClick(a);
              }}
              className="absolute flex items-center overflow-hidden rounded-md px-2 text-left text-[10px] font-semibold text-white shadow-sm transition-all hover:z-10 hover:shadow-md"
              style={{
                top: barTop,
                height: barH,
                left: dayOffsets[offset] + 2 + hourShift,
                width: barWidth,
                backgroundColor: tentative ? "transparent" : color,
                border: tentative ? `2px dashed ${color}` : `1px solid ${color}`,
                color: tentative ? color : "#fff",
              }}
              title={`${[proj?.name, a.title?.trim()].filter(Boolean).join(" — ") || "Task"}${phase ? " · " + phase.name : ""}\n${a.hoursPerDay}h · ${fmtDateShort(a.startDate)} – ${fmtDateShort(a.endDate)}`}
            >
              <div className="flex w-full flex-col overflow-hidden">
                {proj?.name && <span className="truncate leading-tight">{proj.name}</span>}
                {(a.title?.trim() || !proj?.name) && (
                  <span className={`truncate leading-tight ${proj?.name ? "text-[9px] opacity-90" : ""}`}>{a.title?.trim() || "Task"}</span>
                )}
                {phase && <span className="truncate text-[9px] opacity-80">{phase.name}</span>}
                <span className="truncate text-[9px] opacity-80">{a.hoursPerDay}h</span>
              </div>
            </button>
          );
        })}

        {/* Milestones */}
        {personMilestones.map((m) => {
          const offset = days.findIndex((d) => toISODate(d) === m.date);
          if (offset < 0) return null;
          return (
            <div
              key={m.id}
              className="pointer-events-none absolute z-[4] flex flex-col items-center"
              style={{ left: dayOffsets[offset] + dayWidths[offset] / 2 - 6, top: 0 }}
              title={`${m.name} — ${fmtDateShort(m.date)}`}
            >
              <svg width="12" height="16" viewBox="0 0 16 20">
                <path d="M4 1v14l4-2 4 2V1z" fill={m.color} stroke="#fff" strokeWidth="1" />
              </svg>
            </div>
          );
        })}
      </div>
    );
  }
}

const PALETTE = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#06b6d4", "#64748b", "#1e293b",
];

/* ── Allocation modal ──────────────────────────────────────── */
function AllocationModal({
  initial,
  isNew,
  anchorX,
  anchorY,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Allocation;
  isNew: boolean;
  anchorX?: number;
  anchorY?: number;
  onClose: () => void;
  onSave: (a: Allocation) => void;
  onDelete?: () => void;
}) {
  const { store } = usePMStore();
  const [form, setForm] = useState<Allocation>({ title: "", ...initial });
  const [showPalette, setShowPalette] = useState(false);

  const phasesForProject = store.phases.filter((ph) => ph.projectId === form.projectId);
  const proj = store.projects.find((p) => p.id === form.projectId);
  const person = store.people.find((p) => p.id === form.personId);

  // Duration in calendar days
  const start = new Date(form.startDate);
  const end = new Date(form.endDate);
  const durationDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const totalHours = durationDays * form.hoursPerDay;

  function patch<K extends keyof Allocation>(k: K, v: Allocation[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function patchTime(field: "startTime" | "endTime", value: string) {
    setForm((f) => {
      const updated = { ...f, [field]: value };
      const s = updated.startTime ?? "09:00";
      const e = updated.endTime ?? "17:00";
      const [sh, sm] = s.split(":").map(Number);
      const [eh, em] = e.split(":").map(Number);
      const hours = (eh * 60 + em - (sh * 60 + sm)) / 60;
      return hours > 0 ? { ...updated, hoursPerDay: Math.round(hours * 10) / 10 } : updated;
    });
  }

  function toggleAMPM(field: "startTime" | "endTime") {
    const val = field === "startTime" ? (form.startTime ?? "09:00") : (form.endTime ?? "17:00");
    const [h, m] = val.split(":").map(Number);
    const newH = h >= 12 ? h - 12 : h + 12;
    patchTime(field, `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  function ampm(t: string) { return Number(t.split(":")[0]) >= 12 ? "PM" : "AM"; }

  const PANEL_W = 680;
  const PANEL_H = 280;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const rawLeft = (anchorX ?? vw / 2) - PANEL_W / 2;
  const rawTop  = (anchorY ?? vh / 2) + 16;
  const left = Math.max(12, Math.min(rawLeft, vw - PANEL_W - 12));
  const top  = rawTop + PANEL_H > vh - 12 ? (anchorY ?? vh / 2) - PANEL_H - 16 : rawTop;

  return (
    <div className="fixed z-50 w-[680px] rounded-xl border border-border bg-forge-bg shadow-2xl" style={{ left, top }}>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 rounded-t-xl border-b border-border bg-forge-panel px-4 py-2.5">
        <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-forge-surface hover:text-heading transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="text-[13px] font-bold text-heading">
          {isNew ? "New Allocation" : (form.title || "Allocation")}
        </span>
        <div className="ml-1 h-px flex-1 bg-border" />
        {!isNew && (
          <button onClick={onDelete} className="flex h-7 w-7 items-center justify-center rounded text-muted transition-colors hover:bg-red-500/10 hover:text-red-400" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        )}
        <button
          onClick={() => {
            const s = form.startTime ?? "09:00";
            const e = form.endTime ?? "17:00";
            const [sh, sm] = s.split(":").map(Number);
            const [eh, em] = e.split(":").map(Number);
            const hours = (eh * 60 + em - (sh * 60 + sm)) / 60;
            onSave(hours > 0 ? { ...form, hoursPerDay: Math.round(hours * 10) / 10 } : form);
          }}
          disabled={!form.personId || !form.startDate || !form.endDate || (!form.projectId && !form.title?.trim())}
          className="flex h-7 items-center gap-1.5 rounded-md bg-emerald-500 px-3 text-[12px] font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-40"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Save
        </button>
        <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-forge-surface hover:text-heading transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* ── Body ── */}
      <div className="p-4 space-y-3">

        {/* Row 1: Project + color + Task */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-faint">Project <span className="normal-case text-faint/70">(optional)</span></label>
            <select
              value={form.projectId}
              onChange={(e) => { patch("projectId", e.target.value); patch("phaseId", null); }}
              className="forge-input w-full text-sm"
              autoFocus
            >
              <option value="">— select project —</option>
              {store.projects.filter((p) => !p.archived).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Color picker */}
          <div className="relative shrink-0 self-end">
            <button
              type="button"
              onClick={() => setShowPalette((v) => !v)}
              className="h-9 w-9 rounded-md border-2 border-border transition-transform hover:scale-110"
              style={{ backgroundColor: form.color ?? proj?.color ?? person?.color ?? "#8b5cf6" }}
              title="Pick colour"
            />
            {showPalette && (
              <div className="absolute bottom-11 left-0 z-30 w-[150px] rounded-xl border border-border bg-forge-bg p-2 shadow-xl">
                <div className="grid grid-cols-4 gap-1.5">
                  {PALETTE.map((c) => {
                    const active = (form.color ?? proj?.color ?? person?.color ?? "#8b5cf6") === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => { patch("color", c); setShowPalette(false); }}
                        className="h-7 w-7 shrink-0 rounded-md transition-transform hover:scale-110"
                        style={{ backgroundColor: c, outline: active ? `3px solid ${c}` : "none", outlineOffset: "2px" }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-faint">Task</label>
            <input
              type="text"
              value={form.title ?? ""}
              onChange={(e) => patch("title", e.target.value)}
              placeholder="Task description…"
              className="forge-input w-full text-sm"
            />
          </div>
        </div>

        {/* Row 2: Start + End */}
        <div className="flex items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-faint">Start</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={form.startDate} onChange={(e) => patch("startDate", e.target.value)} className="forge-input text-sm" />
              <input type="time" value={form.startTime ?? "09:00"} onChange={(e) => patchTime("startTime", e.target.value)} className="forge-input w-[100px] text-sm [&::-webkit-calendar-picker-indicator]:hidden" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-faint">End</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={form.endDate} onChange={(e) => { if (e.target.value >= form.startDate) patch("endDate", e.target.value); }} className="forge-input text-sm" />
              <input type="time" value={form.endTime ?? "17:00"} onChange={(e) => patchTime("endTime", e.target.value)} className="forge-input w-[100px] text-sm [&::-webkit-calendar-picker-indicator]:hidden" />
            </div>
          </div>
        </div>

        {/* Row 3: Notes */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-faint">Notes</label>
          <textarea value={form.notes} onChange={(e) => patch("notes", e.target.value)} rows={2} className="forge-input w-full resize-none text-sm" placeholder="Optional notes…" />
        </div>

      </div>
    </div>
  );
}
