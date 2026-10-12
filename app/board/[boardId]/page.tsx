"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePMStore } from "@/components/PMStoreProvider";
import { uid, type BoardCard, type BoardColumn, type BoardData, type BoardSubtask } from "@/lib/pm-store";
import BoardPageSkeleton from "@/components/skeletons/BoardPageSkeleton";

const COLUMN_COLORS: { name: string; value: string | null }[] = [
  { name: "None",   value: null },
  { name: "Gray",   value: "#64748b" },
  { name: "Red",    value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber",  value: "#f59e0b" },
  { name: "Green",  value: "#22c55e" },
  { name: "Teal",   value: "#14b8a6" },
  { name: "Cyan",   value: "#06b6d4" },
  { name: "Blue",   value: "#3b82f6" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Pink",   value: "#ec4899" },
];

const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: "todo",        title: "To Do",       cards: [], color: "#64748b" },
  { id: "in-progress", title: "In Progress", cards: [], color: "#f59e0b" },
  { id: "done",        title: "Done",        cards: [], color: "#22c55e" },
];

export default function BoardDetailPage({ params }: { params: { boardId: string } }) {
  const { boardId } = params;
  const router = useRouter();
  const { store, update, loading } = usePMStore();

  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [editingCard, setEditingCard] = useState<{ columnId: string; cardId: string } | null>(null);
  const [addingCardColumnId, setAddingCardColumnId] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [columnMenuId, setColumnMenuId] = useState<string | null>(null);
  const [customColor, setCustomColor] = useState("#6366f1");
  const [openCard, setOpenCard] = useState<{ columnId: string; card: BoardCard } | null>(null);
  const [newSubtaskId, setNewSubtaskId] = useState<string | null>(null);
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  function confirmDelete(title: string, message: string, onConfirm: () => void) {
    setPendingDelete({ title, message, onConfirm });
  }

  const dragCard = useRef<{ columnId: string; cardId: string } | null>(null);
  const dragColumn = useRef<string | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);

  if (loading) return <BoardPageSkeleton />;

  const meta = (store.boards ?? []).find((b) => b.id === boardId);
  const boardData: BoardData = store.boardData?.[boardId] ?? { columns: DEFAULT_COLUMNS };
  const columns = boardData.columns;

  function setBoardData(next: BoardData | ((prev: BoardData) => BoardData)) {
    update((prev) => {
      const current = prev.boardData?.[boardId] ?? { columns: DEFAULT_COLUMNS };
      const resolved = typeof next === "function" ? next(current) : next;
      return { ...prev, boardData: { ...(prev.boardData ?? {}), [boardId]: resolved } };
    });
  }

  function addColumn() {
    const title = newColumnTitle.trim();
    if (!title) { setAddingColumn(false); setNewColumnTitle(""); return; }
    setBoardData((b) => ({ columns: [...b.columns, { id: uid(), title, cards: [] }] }));
    setNewColumnTitle("");
    setAddingColumn(false);
  }

  function deleteColumn(columnId: string) {
    setBoardData((b) => ({ columns: b.columns.filter((c) => c.id !== columnId) }));
  }

  function renameColumn(columnId: string, title: string) {
    setBoardData((b) => ({ columns: b.columns.map((c) => c.id === columnId ? { ...c, title } : c) }));
  }

  function setColumnColor(columnId: string, color: string | null) {
    setBoardData((b) => ({ columns: b.columns.map((c) => c.id === columnId ? { ...c, color: color ?? undefined } : c) }));
  }

  function addCard(columnId: string) {
    const title = newCardTitle.trim();
    if (!title) { setAddingCardColumnId(null); setNewCardTitle(""); return; }
    setBoardData((b) => ({ columns: b.columns.map((c) => c.id === columnId ? { ...c, cards: [...c.cards, { id: uid(), title }] } : c) }));
    setNewCardTitle("");
    setAddingCardColumnId(null);
  }

  function updateCard(columnId: string, cardId: string, patch: Partial<BoardCard>) {
    setBoardData((b) => ({
      columns: b.columns.map((c) =>
        c.id === columnId ? { ...c, cards: c.cards.map((card) => card.id === cardId ? { ...card, ...patch } : card) } : c,
      ),
    }));
    setOpenCard((prev) => prev && prev.columnId === columnId && prev.card.id === cardId ? { columnId, card: { ...prev.card, ...patch } } : prev);
  }

  function deleteCard(columnId: string, cardId: string) {
    setBoardData((b) => ({ columns: b.columns.map((c) => c.id === columnId ? { ...c, cards: c.cards.filter((card) => card.id !== cardId) } : c) }));
    setOpenCard(null);
  }

  function duplicateCard(columnId: string, cardId: string) {
    setBoardData((b) => ({
      columns: b.columns.map((c) => {
        if (c.id !== columnId) return c;
        const idx = c.cards.findIndex((card) => card.id === cardId);
        if (idx < 0) return c;
        const original = c.cards[idx];
        const copy: BoardCard = { ...original, id: uid(), title: `${original.title} (copy)`, subtasks: original.subtasks?.map((s) => ({ ...s, id: uid() })) };
        const next = [...c.cards];
        next.splice(idx + 1, 0, copy);
        return { ...c, cards: next };
      }),
    }));
  }

  function moveCard(fromColumnId: string, cardId: string, toColumnId: string, toIndex: number) {
    setBoardData((b) => {
      const from = b.columns.find((c) => c.id === fromColumnId);
      if (!from) return b;
      const card = from.cards.find((c) => c.id === cardId);
      if (!card) return b;
      return {
        columns: b.columns.map((col) => {
          if (col.id === fromColumnId && col.id === toColumnId) {
            const without = col.cards.filter((c) => c.id !== cardId);
            const clamped = Math.max(0, Math.min(toIndex, without.length));
            return { ...col, cards: [...without.slice(0, clamped), card, ...without.slice(clamped)] };
          }
          if (col.id === fromColumnId) return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
          if (col.id === toColumnId) {
            const clamped = Math.max(0, Math.min(toIndex, col.cards.length));
            return { ...col, cards: [...col.cards.slice(0, clamped), card, ...col.cards.slice(clamped)] };
          }
          return col;
        }),
      };
    });
  }

  function moveColumn(fromId: string, toId: string) {
    if (fromId === toId) return;
    setBoardData((b) => {
      const fromIdx = b.columns.findIndex((c) => c.id === fromId);
      const toIdx = b.columns.findIndex((c) => c.id === toId);
      if (fromIdx < 0 || toIdx < 0) return b;
      const next = [...b.columns];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { columns: next };
    });
  }

  return (
    <div className="animate-fade-in flex h-full flex-col px-4 py-6 sm:px-6 lg:px-8" style={{ minHeight: "calc(100vh - 124px)" }}>
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={() => router.push("/board")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-forge-surface/60 text-muted transition-colors hover:bg-forge-surface hover:text-heading"
          title="Back to boards"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {meta?.color && <div className="h-3 w-3 rounded-full" style={{ backgroundColor: meta.color }} />}
        <div>
          <h1 className="text-[22px] font-bold text-heading">{meta?.name ?? "Board"}</h1>
          <p className="text-[13px] text-subtle">Track your tasks across buckets.</p>
        </div>
      </div>

      {/* Columns */}
      <div className="flex flex-1 items-start gap-4 overflow-x-auto pb-6">
        {columns.map((column) => (
          <div
            key={column.id}
            className="flex w-[300px] shrink-0 flex-col rounded-xl border border-border bg-forge-panel/60"
            draggable={editingColumnId !== column.id}
            onDragStart={(e) => { if (dragCard.current) return; dragColumn.current = column.id; e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { if (dragColumn.current && dragColumn.current !== column.id) e.preventDefault(); }}
            onDrop={(e) => { if (dragColumn.current && dragColumn.current !== column.id) { e.preventDefault(); moveColumn(dragColumn.current, column.id); dragColumn.current = null; } }}
            onDragEnd={() => { dragColumn.current = null; }}
          >
            {column.color && <div className="h-1.5 w-full rounded-t-xl" style={{ backgroundColor: column.color }} />}
            <div className="relative flex items-center gap-2 px-3 py-3" style={column.color ? { backgroundColor: `${column.color}14` } : undefined}>
              {editingColumnId === column.id ? (
                <input
                  autoFocus
                  defaultValue={column.title}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v) renameColumn(column.id, v); setEditingColumnId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) renameColumn(column.id, v); setEditingColumnId(null); }
                    else if (e.key === "Escape") setEditingColumnId(null);
                  }}
                  className="flex-1 rounded-md border border-blue-500/40 bg-forge-surface px-2 py-1 text-[13px] font-semibold text-heading outline-none focus:border-blue-500"
                />
              ) : (
                <button
                  onClick={() => setEditingColumnId(column.id)}
                  className="flex-1 cursor-text text-left text-[13px] font-semibold uppercase tracking-wide"
                  style={column.color ? { color: column.color } : undefined}
                >
                  <span className={column.color ? "" : "text-secondary hover:text-heading"}>{column.title}</span>
                </button>
              )}
              <span className="rounded bg-forge-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">{column.cards.length}</span>

              {/* Three-dots menu */}
              <div className="relative" data-column-menu ref={columnMenuId === column.id ? menuRef : undefined}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (columnMenuId === column.id) { setColumnMenuId(null); return; }
                    setColumnMenuId(column.id);
                    const close = (ev: MouseEvent) => {
                      if (!(ev.target as HTMLElement).closest("[data-column-menu]")) {
                        setColumnMenuId(null);
                        document.removeEventListener("mousedown", close);
                      }
                    };
                    setTimeout(() => document.addEventListener("mousedown", close), 0);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-forge-surface hover:text-heading"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" />
                  </svg>
                </button>

                {columnMenuId === column.id && (
                  <div className="absolute right-0 top-8 z-30 w-56 overflow-hidden rounded-xl border border-border bg-forge-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                      <span className="text-[13px] font-semibold text-heading">Bucket actions</span>
                      <button onClick={() => setColumnMenuId(null)} className="rounded p-0.5 text-muted hover:text-heading">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                      </button>
                    </div>

                    <div className="px-4 pt-2.5 pb-1.5 text-[13px] font-medium text-body">Change bucket color</div>

                    <div className="px-4 pb-3">
                      <div className="grid grid-cols-7 gap-1">
                        {COLUMN_COLORS.map((c) => {
                          const active = (column.color ?? null) === c.value;
                          return (
                            <button
                              key={c.name}
                              onClick={() => { setColumnColor(column.id, c.value); setColumnMenuId(null); }}
                              title={c.name}
                              className={`flex h-6 w-6 items-center justify-center rounded-md border transition-transform hover:scale-110 ${active ? "border-heading" : "border-border"}`}
                              style={{ backgroundColor: c.value ?? "transparent", backgroundImage: c.value ? undefined : "linear-gradient(45deg, transparent 45%, #94a3b8 45%, #94a3b8 55%, transparent 55%)" }}
                            >
                              {active && <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke={c.value ? "#ffffff" : "#0f172a"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-2.5 border-t border-border pt-2.5">
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">Custom color</div>
                        <div className="flex items-center gap-2">
                          <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md border border-border">
                            <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} className="absolute -inset-1 h-10 w-10 cursor-pointer opacity-0" />
                            <div className="h-full w-full rounded-md" style={{ backgroundColor: customColor }} />
                          </div>
                          <input type="text" value={customColor} onChange={(e) => { const v = e.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setCustomColor(v); }} maxLength={7} className="min-w-0 flex-1 rounded-md border border-border bg-forge-surface px-2 py-1 font-mono text-[11px] text-body outline-none focus:border-blue-500/60" placeholder="#rrggbb" />
                          <button onClick={() => { if (/^#[0-9a-fA-F]{6}$/.test(customColor)) { setColumnColor(column.id, customColor); setColumnMenuId(null); } }} disabled={!/^#[0-9a-fA-F]{6}$/.test(customColor)} className="rounded-md bg-blue-500/10 px-2 py-1 text-[11px] font-medium text-blue-400 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-40">Apply</button>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-border">
                      <button
                        onClick={() => { confirmDelete("Delete bucket", "Are you sure you want to proceed?", () => { deleteColumn(column.id); setColumnMenuId(null); }); }}
                        className="w-full px-4 py-2.5 text-left text-[13px] text-red-400 hover:bg-red-500/10"
                      >
                        Delete bucket
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Cards */}
            <div
              className="flex min-h-[40px] flex-1 flex-col gap-2 px-2 pt-2"
              onDragOver={(e) => { if (dragCard.current) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
              onDrop={(e) => { if (dragCard.current) { e.preventDefault(); const { columnId: fromCol, cardId } = dragCard.current; moveCard(fromCol, cardId, column.id, column.cards.length); dragCard.current = null; } }}
            >
              {column.cards.map((card, index) => (
                <div
                  key={card.id}
                  draggable
                  onDragStart={(e) => { dragCard.current = { columnId: column.id, cardId: card.id }; e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => { dragCard.current = null; }}
                  onDragOver={(e) => { if (dragCard.current) { e.preventDefault(); e.stopPropagation(); } }}
                  onDrop={(e) => { if (dragCard.current) { e.preventDefault(); e.stopPropagation(); const { columnId: fromCol, cardId } = dragCard.current; if (cardId !== card.id) moveCard(fromCol, cardId, column.id, index); dragCard.current = null; } }}
                  className="group cursor-grab rounded-lg border border-border bg-forge-surface text-[13px] text-body shadow-sm transition-colors hover:border-blue-500/40 active:cursor-grabbing"
                  style={card.color ? { borderColor: `${card.color}60` } : undefined}
                  onClick={() => { if (editingCard?.cardId !== card.id) setOpenCard({ columnId: column.id, card }); }}
                >
                  <div className="px-3 py-2.5" style={card.color ? { backgroundColor: `${card.color}18` } : undefined}>
                  {editingCard?.columnId === column.id && editingCard?.cardId === card.id ? (
                    <textarea
                      autoFocus
                      defaultValue={card.title}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v) updateCard(column.id, card.id, { title: v }); setEditingCard(null); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = (e.target as HTMLTextAreaElement).value.trim(); if (v) updateCard(column.id, card.id, { title: v }); setEditingCard(null); }
                        else if (e.key === "Escape") setEditingCard(null);
                      }}
                      rows={2}
                      className="w-full resize-none rounded bg-transparent text-[13px] text-body outline-none"
                    />
                  ) : (
                    <div className="flex items-start gap-2">
                      <span className="flex-1 whitespace-pre-wrap break-words leading-snug">{card.title}</span>
                      {/* Three-dots card menu */}
                      <div className="relative shrink-0 opacity-0 transition-opacity group-hover:opacity-100" data-card-menu onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (cardMenuId === card.id) { setCardMenuId(null); return; }
                            setCardMenuId(card.id);
                            const close = (ev: MouseEvent) => {
                              if (!(ev.target as HTMLElement).closest("[data-card-menu]")) {
                                setCardMenuId(null);
                                document.removeEventListener("mousedown", close);
                              }
                            };
                            setTimeout(() => document.addEventListener("mousedown", close), 0);
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-forge-card hover:text-secondary"
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                            <circle cx="3" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="13" cy="8" r="1.3" />
                          </svg>
                        </button>

                        {cardMenuId === card.id && (
                          <div className="absolute right-0 top-6 z-40 w-52 overflow-hidden rounded-xl border border-border bg-forge-panel shadow-2xl">
                            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                              <span className="text-[13px] font-semibold text-heading">Card actions</span>
                              <button onClick={() => setCardMenuId(null)} className="rounded p-0.5 text-muted hover:text-heading">
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                              </button>
                            </div>

                            <button onClick={() => { setEditingCard({ columnId: column.id, cardId: card.id }); setCardMenuId(null); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-body hover:bg-forge-surface/60">
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
                              Edit title
                            </button>
                            <div className="border-t border-border" />
                            <button onClick={() => { duplicateCard(column.id, card.id); setCardMenuId(null); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-body hover:bg-forge-surface/60">
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M3 11V3a1 1 0 0 1 1-1h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                              Duplicate
                            </button>

                            <div className="border-t border-border px-4 py-2.5">
                              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">Card color</div>
                              <div className="grid grid-cols-7 gap-1">
                                {[null, "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"].map((c) => {
                                  const active = (card.color ?? null) === c;
                                  return (
                                    <button
                                      key={c ?? "none"}
                                      onClick={() => { updateCard(column.id, card.id, { color: c ?? undefined }); setCardMenuId(null); }}
                                      title={c ?? "None"}
                                      className={`flex h-6 w-6 items-center justify-center rounded-md border transition-transform hover:scale-110 ${active ? "border-heading" : "border-border"}`}
                                      style={{ backgroundColor: c ?? "transparent", backgroundImage: c ? undefined : "linear-gradient(45deg, transparent 45%, #94a3b8 45%, #94a3b8 55%, transparent 55%)" }}
                                    >
                                      {active && <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke={c ? "#ffffff" : "#0f172a"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="border-t border-border">
                              <button onClick={() => { confirmDelete("Delete card", `"${card.title}" will be permanently deleted.`, () => { deleteCard(column.id, card.id); setCardMenuId(null); }); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-red-400 hover:bg-red-500/10">
                                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V4M6 7v5M10 7v5M3 4l1 9.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5L13 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {card.description && editingCard?.cardId !== card.id && (
                    <div className="mt-1.5 flex flex-col gap-1.5">
                      <button onClick={(e) => { e.stopPropagation(); updateCard(column.id, card.id, { descriptionShown: !card.descriptionShown }); }} className="flex items-center gap-1 self-start rounded px-1 py-0.5 text-[11px] text-faint transition-colors hover:bg-forge-card hover:text-secondary">
                        {card.descriptionShown
                          ? <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.3" /><circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" /><path d="M3 3l10 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                          : <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                        }
                        <span>{card.descriptionShown ? "Hide" : "Show"} description</span>
                      </button>
                      {card.descriptionShown && <div className="whitespace-pre-wrap break-words rounded border border-border/60 bg-forge-bg/40 px-2 py-1.5 text-[12px] leading-snug text-muted">{card.description}</div>}
                    </div>
                  )}
                  {card.dueDate && editingCard?.cardId !== card.id && (() => {
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const due = new Date(`${card.dueDate}T00:00:00`);
                    const days = Math.round((due.getTime() - today.getTime()) / 86400000);
                    const tone = days < 0 ? "bg-red-500/15 text-red-400" : days <= 2 ? "bg-amber-500/15 text-amber-400" : "bg-forge-card text-muted";
                    return (
                      <div className={`mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${tone}`}>
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M2 7h12M5 1.5V4M11 1.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                        {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </div>
                    );
                  })()}
                  {(card.subtasks?.length ?? 0) > 0 && editingCard?.cardId !== card.id && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-forge-card">
                        <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${(card.subtasks!.filter(s => s.done).length / card.subtasks!.length) * 100}%` }} />
                      </div>
                      <span className="shrink-0 text-[10px] text-muted">{card.subtasks!.filter(s => s.done).length}/{card.subtasks!.length}</span>
                    </div>
                  )}
                  </div>
                </div>
              ))}

              {/* Add card */}
              {addingCardColumnId === column.id ? (
                <div className="rounded-lg border border-blue-500/40 bg-forge-surface p-2">
                  <textarea
                    autoFocus
                    value={newCardTitle}
                    onChange={(e) => setNewCardTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addCard(column.id); }
                      else if (e.key === "Escape") { setAddingCardColumnId(null); setNewCardTitle(""); }
                    }}
                    placeholder="Enter a task..."
                    rows={2}
                    className="w-full resize-none rounded bg-transparent text-[13px] text-body outline-none placeholder:text-faint"
                  />
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => addCard(column.id)} className="rounded-md bg-blue-500 px-3 py-1 text-[12px] font-semibold text-white hover:bg-blue-600">Add card</button>
                    <button onClick={() => { setAddingCardColumnId(null); setNewCardTitle(""); }} className="rounded-md px-2 py-1 text-[12px] text-muted hover:text-body">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setAddingCardColumnId(column.id); setNewCardTitle(""); }} className="mb-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-muted transition-colors hover:bg-forge-surface/60 hover:text-body">
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  Add a card
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Add bucket */}
        <div className="w-[300px] shrink-0">
          {addingColumn ? (
            <div className="rounded-xl border border-blue-500/40 bg-forge-panel/60 p-3">
              <input
                autoFocus
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addColumn();
                  else if (e.key === "Escape") { setAddingColumn(false); setNewColumnTitle(""); }
                }}
                placeholder="Bucket title…"
                className="w-full rounded-md border border-border bg-forge-surface px-3 py-2 text-[13px] text-body outline-none focus:border-blue-500"
              />
              <div className="mt-2 flex gap-2">
                <button onClick={addColumn} className="rounded-md bg-blue-500 px-3 py-1 text-[12px] font-semibold text-white hover:bg-blue-600">Add bucket</button>
                <button onClick={() => { setAddingColumn(false); setNewColumnTitle(""); }} className="rounded-md px-2 py-1 text-[12px] text-muted hover:text-body">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingColumn(true)} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-[13px] text-muted transition-colors hover:border-blue-500/40 hover:text-blue-400">
              <svg width="14" height="14" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Add another bucket
            </button>
          )}
        </div>
      </div>

      {/* Card detail modal */}
      {openCard && (() => {
        const { columnId, card } = openCard;
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-16 backdrop-blur-sm" onClick={() => setOpenCard(null)}>
            <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-forge-panel shadow-2xl" style={card.color ? { borderColor: `${card.color}60` } : undefined} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4" style={card.color ? { backgroundColor: `${card.color}18` } : undefined}>
                <textarea
                  defaultValue={card.title}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== card.title) updateCard(columnId, card.id, { title: v }); }}
                  rows={2}
                  className="flex-1 resize-none bg-transparent text-[16px] font-semibold text-heading outline-none"
                />
                <button onClick={() => setOpenCard(null)} className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-forge-surface hover:text-heading">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
              </div>
              <div className="space-y-4 px-6 py-4">
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Description</div>
                  <textarea
                    defaultValue={card.description ?? ""}
                    onBlur={(e) => updateCard(columnId, card.id, { description: e.target.value || undefined })}
                    rows={4}
                    placeholder="Add a description…"
                    className="w-full resize-none rounded-lg border border-border bg-forge-surface px-3 py-2 text-[13px] text-body outline-none focus:border-blue-500/60 placeholder:text-faint"
                  />
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Due date</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={card.dueDate ?? ""}
                      onChange={(e) => updateCard(columnId, card.id, { dueDate: e.target.value || undefined })}
                      className="rounded-lg border border-border bg-forge-surface px-3 py-1.5 text-[13px] text-body outline-none focus:border-blue-500/60"
                    />
                    {card.dueDate && (
                      <button onClick={() => updateCard(columnId, card.id, { dueDate: undefined })} className="text-[12px] text-faint hover:text-secondary">Clear</button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Subtasks</div>
                  {(card.subtasks ?? []).map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-forge-surface/60">
                      <input type="checkbox" checked={s.done} onChange={(e) => updateCard(columnId, card.id, { subtasks: card.subtasks?.map((st) => st.id === s.id ? { ...st, done: e.target.checked } : st) })} className="accent-blue-500" />
                      <input
                        key={s.id}
                        autoFocus={s.id === newSubtaskId}
                        defaultValue={s.id === newSubtaskId ? "" : s.title}
                        placeholder={s.id === newSubtaskId ? "New subtask…" : undefined}
                        onFocus={() => { if (s.id === newSubtaskId) setNewSubtaskId(null); }}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          updateCard(columnId, card.id, { subtasks: card.subtasks?.map((st) => st.id === s.id ? { ...st, title: v || st.title } : st) });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        className={`flex-1 rounded border border-transparent bg-transparent px-1 text-[13px] outline-none focus:border-border focus:bg-forge-surface placeholder:text-faint ${s.done ? "text-muted line-through" : "text-body"}`}
                      />
                      <button onClick={() => updateCard(columnId, card.id, { subtasks: card.subtasks?.filter((st) => st.id !== s.id) })} className="text-faint hover:text-red-400">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  ))}
                  <button onClick={() => {
                    const newId = uid();
                    updateCard(columnId, card.id, { subtasks: [...(card.subtasks ?? []), { id: newId, title: "New subtask", done: false }] });
                    setNewSubtaskId(newId);
                  }} className="mt-1 text-[12px] text-blue-400 hover:text-blue-300">+ Add subtask</button>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
                <button onClick={() => setOpenCard(null)} className="rounded-lg bg-blue-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-600">Save</button>
                <button onClick={() => { confirmDelete("Delete card", `"${card.title}" will be permanently deleted.`, () => deleteCard(columnId, card.id)); }} className="rounded-lg border border-red-500/30 px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-500/10">Delete</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm" onClick={() => setPendingDelete(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-forge-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <h3 className="text-[16px] font-bold text-heading">{pendingDelete.title}</h3>
              <p className="mt-1.5 text-[13px] text-body">{pendingDelete.message} This cannot be undone.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
              <button onClick={() => setPendingDelete(null)} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-subtle hover:text-body">Cancel</button>
              <button onClick={() => { pendingDelete.onConfirm(); setPendingDelete(null); }} className="rounded-lg bg-red-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
