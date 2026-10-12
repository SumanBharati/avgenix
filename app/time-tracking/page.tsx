"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePMStore } from "@/components/PMStoreProvider";
import PMPageSkeleton from "@/components/skeletons/PMPageSkeleton";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  addDays,
  fmtDateShort,
  startOfWeek,
  toISODate,
  uid,
  type AdHocTask,
  type TimeEntry,
} from "@/lib/pm-store";

type PickerSelection = { kind: "project" | "task"; id: string };

export default function TimeTrackingPage() {
  const { store, update, loading } = usePMStore();
  const [cursor, setCursor] = useState<Date>(() => startOfWeek(new Date()));
  const [activePerson, setActivePerson] = useState<string>("");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState<string>("");
  const [pickerSelected, setPickerSelected] = useState<PickerSelection | null>(null);
  const [pickedPhase, setPickedPhase] = useState<string>("");
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState<string>("");
  const [notesOpenKey, setNotesOpenKey] = useState<string | null>(null);
  const [notesAnchor, setNotesAnchor] = useState<HTMLElement | null>(null);
  const [pendingDeleteRow, setPendingDeleteRow] = useState<{ projectId: string; phaseId: string | null; label: string } | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskName, setEditingTaskName] = useState("");
  const [showManageTasks, setShowManageTasks] = useState(false);
  const [manageNewTaskName, setManageNewTaskName] = useState("");
  const [pendingDeleteTask, setPendingDeleteTask] = useState<AdHocTask | null>(null);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(cursor, i));
  }, [cursor]);

  const weekStart = toISODate(weekDays[0]);
  const weekEnd = toISODate(weekDays[6]);

  const people = store.people.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name));

  const selectedPerson = activePerson || people[0]?.id || "";
  const person = store.people.find((p) => p.id === selectedPerson);

  const allocationsForPerson = store.allocations.filter(
    (a) =>
      a.personId === selectedPerson &&
      a.startDate <= weekEnd &&
      a.endDate >= weekStart,
  );

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: { projectId: string; phaseId: string | null }[] = [];
    const push = (projectId: string, phaseId: string | null) => {
      const key = `${projectId}|${phaseId || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ projectId, phaseId });
    };
    allocationsForPerson.forEach((a) => push(a.projectId, a.phaseId));
    store.timeEntries
      .filter(
        (e) =>
          e.personId === selectedPerson && e.date >= weekStart && e.date <= weekEnd,
      )
      .forEach((e) => push(e.projectId, e.phaseId));
    return out;
  }, [allocationsForPerson, store.timeEntries, selectedPerson, weekStart, weekEnd]);

  const availableProjects = useMemo(
    () =>
      store.projects
        .filter((p) => !p.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [store.projects],
  );
  const phaseOptions = useMemo(
    () =>
      pickerSelected?.kind === "project"
        ? store.phases.filter((ph) => ph.projectId === pickerSelected.id)
        : [],
    [store.phases, pickerSelected],
  );

  // Archived (deleted) tasks stay in the store so past logged hours keep their name,
  // but are hidden from the picker and the Manage Tasks list.
  const allAdHocTasks = store.adHocTasks ?? [];
  const adHocTasks = useMemo(() => allAdHocTasks.filter((t) => !t.archivedAt), [allAdHocTasks]);

  const pickerItems = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return [];
    const projectItems = availableProjects.map((p) => ({
      kind: "project" as const,
      id: p.id,
      name: p.name,
      sub: p.client || "",
    }));
    const taskItems = adHocTasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      name: t.name,
      sub: "",
    }));
    const all = [...projectItems, ...taskItems];
    return all.filter(
      (item) => item.name.toLowerCase().includes(q) || item.sub.toLowerCase().includes(q),
    );
  }, [availableProjects, adHocTasks, pickerSearch]);

  if (loading) return <PMPageSkeleton />;

  function entriesFor(projectId: string, phaseId: string | null, date: string): TimeEntry[] {
    return store.timeEntries.filter(
      (e) =>
        e.personId === selectedPerson &&
        e.projectId === projectId &&
        (e.phaseId || null) === phaseId &&
        e.date === date,
    );
  }

  function hoursFor(projectId: string, phaseId: string | null, date: string): number {
    return entriesFor(projectId, phaseId, date).reduce((s, e) => s + e.hours, 0);
  }

  function setHours(projectId: string, phaseId: string | null, date: string, hours: number) {
    const existing = entriesFor(projectId, phaseId, date);
    if (existing.length > 0) {
      const keep = existing[0];
      const toRemove = existing.slice(1).map((e) => e.id);
      const newEntries = store.timeEntries
        .filter((e) => !toRemove.includes(e.id))
        .map((e) => (e.id === keep.id ? { ...e, hours } : e));
      update({
        ...store,
        timeEntries: hours > 0 ? newEntries : newEntries.filter((e) => e.id !== keep.id),
      });
    } else if (hours > 0) {
      const e: TimeEntry = {
        id: uid(),
        personId: selectedPerson,
        projectId,
        phaseId,
        date,
        hours,
        notes: "",
        billable: true,
      };
      update({ ...store, timeEntries: [...store.timeEntries, e] });
    }
  }

  function notesFor(projectId: string, phaseId: string | null, date: string): string {
    return entriesFor(projectId, phaseId, date)[0]?.notes || "";
  }

  function setNotes(projectId: string, phaseId: string | null, date: string, notes: string) {
    const existing = entriesFor(projectId, phaseId, date);
    if (existing.length > 0) {
      const keep = existing[0];
      const toRemove = existing.slice(1).map((e) => e.id);
      const newEntries = store.timeEntries
        .filter((e) => !toRemove.includes(e.id))
        .map((e) => (e.id === keep.id ? { ...e, notes } : e));
      update({ ...store, timeEntries: newEntries });
    } else if (notes.trim()) {
      const e: TimeEntry = {
        id: uid(),
        personId: selectedPerson,
        projectId,
        phaseId,
        date,
        hours: 0,
        notes,
        billable: true,
      };
      update({ ...store, timeEntries: [...store.timeEntries, e] });
    }
  }

  function openAddRow() {
    if (!selectedPerson) return;
    setPickerSearch("");
    setPickerSelected(null);
    setPickedPhase("");
    setShowNewTaskForm(false);
    setNewTaskName("");
    setShowPicker(true);
  }

  function createNewTask() {
    const name = newTaskName.trim();
    if (!name || !selectedPerson) return;
    // Reuse an existing ad-hoc task with the same name instead of creating a
    // second one — otherwise the picker ends up listing duplicate "Admin" tasks.
    const existingTask = adHocTasks.find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
    if (existingTask && rows.some((r) => r.projectId === existingTask.id && !r.phaseId)) {
      setShowPicker(false);
      setPickerSearch("");
      setPickerSelected(null);
      setPickedPhase("");
      setShowNewTaskForm(false);
      setNewTaskName("");
      return;
    }
    const task: AdHocTask = existingTask ?? { id: uid(), name, createdAt: new Date().toISOString() };
    const today = toISODate(new Date());
    const entry: TimeEntry = {
      id: uid(),
      personId: selectedPerson,
      projectId: task.id,
      phaseId: null,
      date: today >= weekStart && today <= weekEnd ? today : weekStart,
      hours: 0,
      notes: "",
      billable: true,
    };
    update((prev) => ({
      ...prev,
      adHocTasks: existingTask ? (prev.adHocTasks ?? []) : [...(prev.adHocTasks ?? []), task],
      timeEntries: [...prev.timeEntries, entry],
    }));
    setShowPicker(false);
    setPickerSearch("");
    setPickerSelected(null);
    setPickedPhase("");
    setShowNewTaskForm(false);
    setNewTaskName("");
  }

  function confirmAddRow() {
    if (!selectedPerson || !pickerSelected) return;
    const phaseId = pickerSelected.kind === "project" ? (pickedPhase || null) : null;
    const already = rows.some(
      (r) => r.projectId === pickerSelected.id && (r.phaseId || null) === phaseId,
    );
    if (already) {
      setShowPicker(false);
      return;
    }
    const today = toISODate(new Date());
    const e: TimeEntry = {
      id: uid(),
      personId: selectedPerson,
      projectId: pickerSelected.id,
      phaseId,
      date: today >= weekStart && today <= weekEnd ? today : weekStart,
      hours: 0,
      notes: "",
      billable: true,
    };
    update({ ...store, timeEntries: [...store.timeEntries, e] });
    setShowPicker(false);
  }

  function renameTask(taskId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    update({
      ...store,
      adHocTasks: (store.adHocTasks ?? []).map((t) => (t.id === taskId ? { ...t, name: trimmed } : t)),
    });
  }

  function deleteRow(projectId: string, phaseId: string | null) {
    const remainingEntries = store.timeEntries.filter(
      (e) => !(e.personId === selectedPerson && e.projectId === projectId && (e.phaseId || null) === phaseId),
    );
    const stillReferenced = remainingEntries.some((e) => e.projectId === projectId);
    const nextAdHocTasks = stillReferenced
      ? (store.adHocTasks ?? [])
      : (store.adHocTasks ?? []).filter((t) => t.id !== projectId);
    update({ ...store, timeEntries: remainingEntries, adHocTasks: nextAdHocTasks });
  }

  // "Manage Tasks" operates on the ad-hoc task list itself (not the org-level
  // projects, which come from the projects database and are managed there).
  function addManagedTask() {
    const name = manageNewTaskName.trim();
    if (!name) return;
    const exists = adHocTasks.some((t) => t.name.trim().toLowerCase() === name.toLowerCase());
    if (exists) { setManageNewTaskName(""); return; }
    const task: AdHocTask = { id: uid(), name, createdAt: new Date().toISOString() };
    update((prev) => ({ ...prev, adHocTasks: [...(prev.adHocTasks ?? []), task] }));
    setManageNewTaskName("");
  }

  // Unlike deleteRow (which only clears the current person's row), this retires
  // the task for everyone. Hours already logged (today or earlier) are kept as-is
  // and the task is only archived, so those entries still show its name; only
  // future-dated entries are removed and the task disappears from search/picker.
  function deleteManagedTask(taskId: string) {
    const today = toISODate(new Date());
    const archivedAt = new Date().toISOString();
    update((prev) => ({
      ...prev,
      adHocTasks: (prev.adHocTasks ?? []).map((t) => (t.id === taskId ? { ...t, archivedAt } : t)),
      timeEntries: prev.timeEntries.filter((e) => !(e.projectId === taskId && e.date > today)),
    }));
  }

  const weekTotal = weekDays.reduce(
    (sum, d) => sum + rows.reduce((s, r) => s + hoursFor(r.projectId, r.phaseId, toISODate(d)), 0),
    0,
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center flex-wrap gap-3 justify-between border-b border-border px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-heading">Time Tracking</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedPerson}
            onChange={(e) => setActivePerson(e.target.value)}
            className="forge-input text-sm"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-forge-surface/60 p-0.5">
            <button
              onClick={() => setCursor((c) => addDays(c, -7))}
              className="rounded px-2 py-1 text-sm text-muted hover:bg-forge-surface hover:text-body"
              title="Previous week"
            >
              ‹
            </button>
            <span className="whitespace-nowrap px-3 py-1 text-sm font-semibold text-heading">
              {fmtDateShort(weekStart)} – {fmtDateShort(weekEnd)}
            </span>
            <button
              onClick={() => setCursor((c) => addDays(c, 7))}
              className="rounded px-2 py-1 text-sm text-muted hover:bg-forge-surface hover:text-body"
              title="Next week"
            >
              ›
            </button>
          </div>
          <button
            onClick={() => setCursor(startOfWeek(new Date()))}
            className="shrink-0 whitespace-nowrap rounded-lg border border-border bg-forge-surface/60 px-3 py-1.5 text-xs font-semibold text-body hover:bg-forge-surface"
          >
            This week
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-6 sm:px-6 lg:px-8">
        {!person ? (
          <div className="py-20 text-center text-sm text-subtle">Add a person first</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "18%" }} />
                {weekDays.map((_, i) => (
                  <col key={i} style={{ width: "9.5%" }} />
                ))}
                <col style={{ width: "8%" }} />
                <col style={{ width: "7.5%" }} />
              </colgroup>
              <thead className="bg-forge-panel text-[11px] font-semibold uppercase tracking-wider text-faint">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left">Projects or Tasks</th>
                  {weekDays.map((d, i) => (
                    <th key={i} className="px-2 py-3 text-center">
                      <div>{d.toLocaleDateString("en-US", { weekday: "short" })}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-subtle">{d.getDate()}</div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-subtle">
                      <div className="mb-3 text-sm">No allocations or entries this week</div>
                      <button
                        onClick={openAddRow}
                        className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600"
                      >
                        Add a row manually
                      </button>
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => {
                    const proj = store.projects.find((p) => p.id === r.projectId);
                    const task = !proj ? allAdHocTasks.find((t) => t.id === r.projectId) : undefined;
                    const phase = r.phaseId ? store.phases.find((ph) => ph.id === r.phaseId) : null;
                    const rowTotal = weekDays.reduce(
                      (s, d) => s + hoursFor(r.projectId, r.phaseId, toISODate(d)),
                      0,
                    );
                    const hasAllocation = allocationsForPerson.some(
                      (a) => a.projectId === r.projectId && (a.phaseId || null) === r.phaseId,
                    );
                    const rowLabel = [proj?.name || task?.name || "this row", phase?.name].filter(Boolean).join(" — ");
                    const isEditingTask = !!task && editingTaskId === task.id;
                    return (
                      <tr key={i} className="group border-b border-border hover:bg-forge-surface/30">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{ backgroundColor: phase?.color || proj?.color || "#94a3b8" }}
                            />
                            {isEditingTask ? (
                              <input
                                value={editingTaskName}
                                onChange={(e) => setEditingTaskName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { renameTask(task!.id, editingTaskName); setEditingTaskId(null); }
                                  if (e.key === "Escape") setEditingTaskId(null);
                                }}
                                autoFocus
                                className="forge-input h-7 w-full text-sm"
                              />
                            ) : (
                              <div>
                                <div className="font-semibold text-body">{proj?.name || task?.name || "—"}</div>
                                {phase && <div className="text-[11px] text-subtle">{phase.name}</div>}
                                {!proj && task && <div className="text-[11px] text-subtle">Task</div>}
                              </div>
                            )}
                          </div>
                        </td>
                        {weekDays.map((d, j) => {
                          const iso = toISODate(d);
                          const scheduled = allocationsForPerson
                            .filter(
                              (a) =>
                                a.projectId === r.projectId &&
                                (a.phaseId || null) === r.phaseId &&
                                iso >= a.startDate &&
                                iso <= a.endDate,
                            )
                            .reduce((s, a) => s + a.hoursPerDay, 0);
                          const scheduledRounded = Math.round(scheduled * 100) / 100;
                          const actual = hoursFor(r.projectId, r.phaseId, iso);
                          const cellKey = `${r.projectId}|${r.phaseId || ""}|${iso}`;
                          const note = notesFor(r.projectId, r.phaseId, iso);
                          return (
                            <td key={j} className="relative px-2 py-2 text-center">
                              <input
                                type="number"
                                step="0.25"
                                value={actual || ""}
                                onChange={(e) => setHours(r.projectId, r.phaseId, iso, Number(e.target.value) || 0)}
                                onFocus={(e) => { setNotesOpenKey(cellKey); setNotesAnchor(e.currentTarget); }}
                                placeholder={scheduledRounded > 0 ? String(scheduledRounded) : "—"}
                                className="w-14 rounded border border-border bg-forge-surface/40 px-2 py-1 text-center text-xs text-body outline-none focus:border-blue-500 focus:bg-forge-bg"
                              />
                              {scheduledRounded > 0 && (
                                <div className="mt-0.5 text-[9px] text-faint">plan: {scheduledRounded}h</div>
                              )}
                              {note && notesOpenKey !== cellKey && (
                                <div className="mt-0.5 truncate text-[9px] text-blue-400" title={note}>
                                  📝 {note}
                                </div>
                              )}
                              {notesOpenKey === cellKey && notesAnchor && (
                                <NotesPopover
                                  anchorEl={notesAnchor}
                                  value={note}
                                  onChange={(v) => setNotes(r.projectId, r.phaseId, iso, v)}
                                  onClose={() => { setNotesOpenKey(null); setNotesAnchor(null); }}
                                />
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-right font-mono font-semibold text-body">{rowTotal.toFixed(1)}h</td>
                        <td className="px-3 py-2">
                          <div className={`flex items-center justify-end gap-1 transition-opacity group-hover:opacity-100 ${isEditingTask ? "opacity-100" : "opacity-0"}`}>
                            {task && (
                              <button
                                onClick={() => {
                                  if (isEditingTask) { renameTask(task.id, editingTaskName); setEditingTaskId(null); }
                                  else { setEditingTaskId(task.id); setEditingTaskName(task.name); }
                                }}
                                className={`rounded p-1 transition-colors ${isEditingTask ? "text-blue-400 hover:bg-blue-500/10" : "text-subtle hover:bg-forge-surface hover:text-body"}`}
                                title={isEditingTask ? "Done" : "Rename"}
                              >
                                {isEditingTask ? (
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                                    <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                ) : (
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                                    <path d="M11 2.5a1.5 1.5 0 012.121 2.121L5.5 12.243 2 13.5l1.257-3.5L11 2.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </button>
                            )}
                            {!hasAllocation && (
                              <button
                                onClick={() => setPendingDeleteRow({ projectId: r.projectId, phaseId: r.phaseId, label: rowLabel })}
                                className="rounded p-1 text-subtle transition-colors hover:bg-red-500/10 hover:text-red-400"
                                title="Delete row"
                              >
                                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                                  <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4 4v9a1 1 0 001 1h6a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-forge-panel text-[11px] font-semibold uppercase tracking-wider text-faint">
                    <td className="px-4 py-3 text-right">Day total</td>
                    {weekDays.map((d, i) => {
                      const dayTotal = rows.reduce(
                        (s, r) => s + hoursFor(r.projectId, r.phaseId, toISODate(d)),
                        0,
                      );
                      return (
                        <td key={i} className="px-2 py-3 text-center font-mono text-body">
                          {dayTotal.toFixed(1)}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-mono text-heading">{weekTotal.toFixed(1)}h</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {rows.length > 0 && (
            <button
              onClick={openAddRow}
              className="rounded-lg border border-border bg-forge-surface/40 px-3 py-1.5 text-xs font-semibold text-muted hover:text-body"
            >
              + Add row
            </button>
          )}
          <button
            onClick={() => { setEditingTaskId(null); setManageNewTaskName(""); setShowManageTasks(true); }}
            className="rounded-lg border border-border bg-forge-surface/40 px-3 py-1.5 text-xs font-semibold text-muted hover:text-body"
          >
            Manage Tasks
          </button>
        </div>
      </div>

      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowPicker(false)} />
          <div className="relative w-full max-w-[440px] animate-fade-in rounded-xl border border-border bg-forge-surface p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-heading">Search Project or Task</h3>
              <button
                onClick={() => setShowPicker(false)}
                className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-forge-card hover:text-secondary"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {/* Search input */}
              <div className="relative">
                <svg
                  width="15" height="15" viewBox="0 0 16 16" fill="none"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                >
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
                  <line x1="11.2" y1="11.2" x2="15" y2="15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <input
                  autoFocus
                  value={pickerSearch}
                  onChange={(e) => { setPickerSearch(e.target.value); setPickerSelected(null); }}
                  placeholder="Search Project or Task"
                  className="forge-input pl-9"
                />
              </div>

              {/* Results */}
              {pickerSearch.trim() && (
                <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
                  {pickerItems.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-faint">No matches</div>
                  ) : (
                    pickerItems.map((item) => {
                      const active = pickerSelected?.kind === item.kind && pickerSelected.id === item.id;
                      return (
                        <button
                          key={`${item.kind}-${item.id}`}
                          onClick={() => { setPickerSelected({ kind: item.kind, id: item.id }); setPickedPhase(""); }}
                          className={`flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0 transition-colors ${
                            active ? "bg-blue-500/10 text-blue-400" : "text-body hover:bg-forge-card"
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{item.name}</span>
                            {item.sub && <span className="shrink-0 truncate text-xs text-subtle">— {item.sub}</span>}
                          </span>
                          {item.kind === "task" && (
                            <span
                              className="shrink-0 rounded bg-forge-card px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle"
                            >
                              Task
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {/* Create new task */}
              {showNewTaskForm ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={newTaskName}
                    onChange={(e) => setNewTaskName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createNewTask();
                      if (e.key === "Escape") { setShowNewTaskForm(false); setNewTaskName(""); }
                    }}
                    placeholder="Task name…"
                    className="forge-input flex-1"
                  />
                  <button
                    onClick={createNewTask}
                    disabled={!newTaskName.trim()}
                    className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setShowNewTaskForm(false); setNewTaskName(""); }}
                    className="rounded-lg border border-border px-2.5 py-2 text-xs text-subtle hover:text-body"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setShowNewTaskForm(true); setNewTaskName(pickerSearch); }}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-blue-500/40 bg-blue-500/5 px-3 py-2.5 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/10"
                >
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                    <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  Create New Task
                </button>
              )}

              {/* Phase selector — only for real projects that have phases */}
              {pickerSelected?.kind === "project" && phaseOptions.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted">
                    Phase <span className="text-faint">(optional)</span>
                  </label>
                  <select
                    value={pickedPhase}
                    onChange={(e) => setPickedPhase(e.target.value)}
                    className="forge-input"
                  >
                    <option value="">— No phase —</option>
                    {phaseOptions.map((ph) => (
                      <option key={ph.id} value={ph.id}>
                        {ph.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowPicker(false)}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-body"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddRow}
                disabled={!pickerSelected}
                className="forge-btn-primary text-[13px]"
              >
                Add row
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteRow && (
        <ConfirmDialog
          title="Delete row"
          message={<>Delete the <span className="font-semibold text-heading">{pendingDeleteRow.label}</span> row? This removes all logged hours and notes for it.</>}
          onCancel={() => setPendingDeleteRow(null)}
          onConfirm={() => {
            deleteRow(pendingDeleteRow.projectId, pendingDeleteRow.phaseId);
            setPendingDeleteRow(null);
          }}
        />
      )}

      {showManageTasks && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowManageTasks(false)} />
          <div className="relative w-full max-w-[440px] animate-fade-in rounded-xl border border-border bg-forge-surface p-6 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-heading">Manage Tasks</h3>
              <button
                onClick={() => setShowManageTasks(false)}
                className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-forge-card hover:text-secondary"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <p className="mb-4 text-xs text-subtle">
              Ad-hoc tasks created here for time tracking, separate from projects — those come from your organization&apos;s project list.
            </p>
            <div className="mb-4 flex gap-2">
              <input
                value={manageNewTaskName}
                onChange={(e) => setManageNewTaskName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addManagedTask(); }}
                placeholder="New task name..."
                className="forge-input h-9 flex-1 text-sm"
              />
              <button
                onClick={addManagedTask}
                disabled={!manageNewTaskName.trim()}
                className="forge-btn-primary px-3 text-[13px] disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border">
              {adHocTasks.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-subtle">No ad-hoc tasks yet</div>
              ) : (
                adHocTasks.map((t) => {
                  const isEditing = editingTaskId === t.id;
                  return (
                    <div key={t.id} className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editingTaskName}
                          onChange={(e) => setEditingTaskName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { renameTask(t.id, editingTaskName); setEditingTaskId(null); }
                            if (e.key === "Escape") setEditingTaskId(null);
                          }}
                          onBlur={() => { renameTask(t.id, editingTaskName); setEditingTaskId(null); }}
                          className="forge-input h-8 flex-1 text-sm"
                        />
                      ) : (
                        <span className="flex-1 truncate text-sm text-body">{t.name}</span>
                      )}
                      <button
                        onClick={() => { setEditingTaskId(t.id); setEditingTaskName(t.name); }}
                        className="rounded p-1.5 text-subtle hover:bg-forge-card hover:text-body"
                        title="Rename"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M11 2l3 3-8 8-3.5 1 1-3.5 8-8Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setPendingDeleteTask(t)}
                        className="rounded p-1.5 text-subtle hover:bg-red-500/10 hover:text-red-500"
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.5 9.5h6l.5-9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowManageTasks(false)}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-body"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteTask && (
        <ConfirmDialog
          title="Delete task"
          message={<>Delete <span className="font-semibold text-heading">{pendingDeleteTask.name}</span>? It will no longer be available to add going forward. Hours already logged against it are kept.</>}
          onCancel={() => setPendingDeleteTask(null)}
          onConfirm={() => {
            deleteManagedTask(pendingDeleteTask.id);
            setPendingDeleteTask(null);
          }}
        />
      )}
    </div>
  );
}

function NotesPopover({
  anchorEl,
  value,
  onChange,
  onClose,
}: {
  anchorEl: HTMLElement;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
  }, [anchorEl]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleScroll() {
      onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
      className="z-50 w-48 rounded-lg border border-border bg-forge-panel p-2 text-left shadow-lg"
    >
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-faint">
          Description <span className="normal-case text-faint/70">(optional)</span>
        </label>
        <button
          type="button"
          onClick={onClose}
          className="text-muted transition-colors hover:text-body"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What did you work on?"
        className="w-full resize-none rounded border border-border bg-forge-surface/60 px-2 py-1 text-xs text-body outline-none focus:border-blue-500"
      />
    </div>,
    document.body,
  );
}
