"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { SendIcon } from "./Icons";
import { useAIChatContext, AIChatContext } from "@/lib/useAIChatContext";

interface Message {
  role: "user" | "assistant";
  content: string;
  isAction?: boolean; // true for smart action results (styled differently)
}

interface SmartAction {
  label: string;
  icon: string;
  prompt: string;
  color: string;
}

function getSmartActions(ctx: AIChatContext): SmartAction[] {
  const actions: SmartAction[] = [];
  const page = ctx.page;

  // Site Survey actions
  if (page.includes("site-survey") && ctx.survey) {
    const roomCount = ctx.survey.buildings.reduce((sum, b) => sum + b.rooms.length, 0);
    actions.push({
      label: "Validate Survey",
      icon: "✓",
      prompt: "Review the current site survey data for completeness. Check each room for missing critical fields (dimensions, ceiling type, room purpose, electrical, network). List what's missing or needs attention, organized by room.",
      color: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    });
    if (roomCount > 0) {
      actions.push({
        label: "Recommend Equipment",
        icon: "📋",
        prompt: "Based on the site survey data for each room, recommend a complete AV equipment list. Consider the room purpose, dimensions, ceiling type, and seating capacity. Use equipment from our library when possible. Format as a room-by-room recommendation.",
        color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      });
    }
  }

  // Proposal actions
  if (page.includes("proposal")) {
    if (ctx.proposal && ctx.proposal.sections && ctx.proposal.sections.length > 0) {
      actions.push({
        label: "Review Proposal",
        icon: "🔍",
        prompt: "Review this proposal for completeness and accuracy. Check: are there missing equipment categories (display, audio, video processing, control, cabling, mounting)? Are quantities reasonable for the room sizes? Are there compatibility issues between selected products? Suggest any missing items.",
        color: "bg-violet-500/15 text-violet-400 border-violet-500/30",
      });
      actions.push({
        label: "Estimate Labor",
        icon: "⏱",
        prompt: "Based on the equipment in this proposal, estimate the labor hours needed for each section. Break down by: engineering/design hours, installation hours, programming hours, and project management hours. Use our organization's labor rates to calculate costs.",
        color: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      });
    }
    if (ctx.survey) {
      actions.push({
        label: "Generate BOM from Survey",
        icon: "⚡",
        prompt: "Based on the site survey data, generate a complete Bill of Materials for this project. For each room, recommend specific equipment from our equipment library (or suggest alternatives if the library doesn't have a match). Include quantities, categories, and estimated unit costs. Format this as a ready-to-use equipment list organized by room.",
        color: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
      });
    }
  }

  // Procurement actions
  if (page.includes("procurement") && ctx.procurement) {
    actions.push({
      label: "Check Mismatches",
      icon: "⚠",
      prompt: "Compare the procurement data against the proposal. Check for: quantity mismatches (proposal qty vs ordered qty), missing items that are in the proposal but not in procurement, and items ordered but not in the proposal. Flag any discrepancies.",
      color: "bg-red-500/15 text-red-400 border-red-500/30",
    });
  }

  // Project overview actions
  if (ctx.project && !page.includes("site-survey") && !page.includes("proposal") && !page.includes("procurement")) {
    actions.push({
      label: "Project Health Check",
      icon: "📊",
      prompt: "Perform a health check on this project. Review the current phase, what data exists (survey, proposal, procurement), and identify: what's been completed, what's missing or incomplete, and what should be the next steps. Give a clear status summary with actionable recommendations.",
      color: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    });
    if (ctx.survey && !ctx.proposal) {
      actions.push({
        label: "Draft Scope of Work",
        icon: "📝",
        prompt: "Based on the site survey data, draft a professional scope of work for this project. Include: project overview, rooms covered, systems to be provided (AV, control, audio, video), general approach, and key assumptions/exclusions. Write it in a tone suitable for a client-facing proposal.",
        color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      });
    }
  }

  return actions;
}

function getProactiveAlerts(ctx: AIChatContext): string[] {
  const alerts: string[] = [];

  if (ctx.survey) {
    const allRooms = ctx.survey.buildings.flatMap((b) => b.rooms);
    for (const room of allRooms) {
      const d = room.data;
      if (!d.room_purpose) alerts.push(`${room.name}: missing room purpose`);
      if (!d.room_length || !d.room_width) alerts.push(`${room.name}: missing dimensions`);
      if (!d.ceiling_type) alerts.push(`${room.name}: missing ceiling type`);
    }
  }

  if (ctx.proposal && ctx.survey) {
    const proposalCategories = new Set(
      ctx.proposal.sections?.flatMap((s) => s.items.map((i) => i.category)) || []
    );
    const hasRooms = ctx.survey.buildings.some((b) => b.rooms.length > 0);
    if (hasRooms) {
      if (!proposalCategories.has("Display") && !proposalCategories.has("display"))
        alerts.push("Proposal may be missing displays");
      if (!proposalCategories.has("Audio") && !proposalCategories.has("audio"))
        alerts.push("Proposal may be missing audio equipment");
      if (!proposalCategories.has("Control System") && !proposalCategories.has("control"))
        alerts.push("Proposal may be missing a control system");
    }
  }

  if (ctx.procurement && ctx.proposal) {
    const proposalItemCount = ctx.proposal.sections?.reduce((sum, s) => sum + s.items.length, 0) || 0;
    if (proposalItemCount > 0 && ctx.procurement.lineCount === 0) {
      alerts.push("Proposal has items but procurement is empty");
    }
    if (ctx.procurement.pendingItems > 5) {
      alerts.push(`${ctx.procurement.pendingItems} procurement items still pending`);
    }
  }

  return alerts;
}

export default function AIAssistant({ onAlertCount }: { onAlertCount?: (count: number) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastAssistantRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContext = useAIChatContext();

  const smartActions = useMemo(() => getSmartActions(chatContext), [chatContext]);
  const alerts = useMemo(() => getProactiveAlerts(chatContext), [chatContext]);

  // Notify parent of alert count for badge
  useEffect(() => {
    onAlertCount?.(alerts.length);
  }, [alerts.length, onAlertCount]);

  // Generate context-aware suggestions based on current page
  const suggestions = useMemo(() => {
    if (chatContext.project && chatContext.survey) {
      const roomCount = chatContext.survey.buildings.reduce((sum, b) => sum + b.rooms.length, 0);
      return [
        "What's missing in this site survey?",
        roomCount > 0 ? `Recommend equipment for ${chatContext.survey.buildings[0]?.rooms[0]?.name || "this room"}` : "What should I check during a site survey?",
        "Suggest improvements for this project",
      ];
    }
    if (chatContext.proposal) {
      return [
        "Am I missing any equipment?",
        "Review this proposal for completeness",
        "Suggest labor hours for this scope",
      ];
    }
    if (chatContext.project) {
      return [
        `What should I do next for this ${chatContext.project.phase || ""} phase?`,
        "Generate a scope of work",
        "What equipment fits this project?",
      ];
    }
    return [
      "Display sizing for a boardroom",
      "Speaker coverage for 20x30 room",
      "HDMI vs HDBaseT for long runs",
    ];
  }, [chatContext.project?.id, chatContext.survey, chatContext.proposal]);

  // Scroll once per new message: the user's own message goes to the bottom,
  // a new assistant answer is aligned to its top so reading starts at the beginning.
  // No scrolling while the answer streams in.
  useEffect(() => {
    if (messages.length === 0) return;
    if (messages[messages.length - 1].role === "assistant") {
      lastAssistantRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  const sendMessage = useCallback(async (text: string, isAction = false) => {
    if (!text || loading) return;

    const userMessage: Message = { role: "user", content: text, isAction };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let answer = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          projectContext: chatContext,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setMessages([...updatedMessages, { role: "assistant", content: `Error: ${data.error ?? "Request failed"}` }]);
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          answer += decoder.decode(value, { stream: true });
          setMessages([...updatedMessages, { role: "assistant", content: answer, isAction }]);
        }
      }
    } catch (err) {
      // A user-initiated stop keeps whatever text has arrived
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setMessages([...updatedMessages, { role: "assistant", content: answer ? `${answer}\n\n_(response interrupted)_` : "Sorry, something went wrong. Please try again." }]);
      }
    }

    abortRef.current = null;
    setLoading(false);
    inputRef.current?.focus();
  }, [messages, loading, chatContext]);

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    sendMessage(input.trim());
  }

  function handleAction(action: SmartAction) {
    setShowActions(false);
    sendMessage(action.prompt, true);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10">
              <span className="text-2xl">🤖</span>
            </div>
            <h3 className="mb-1.5 text-sm font-semibold text-body">AVGenix AI</h3>
            <p className="max-w-[260px] text-xs leading-relaxed text-subtle">
              AV design help, troubleshooting, equipment selection, standards, and calculations.
            </p>
            {chatContext.project && (
              <p className="mt-2 rounded-lg bg-blue-500/10 px-3 py-1.5 text-[11px] text-blue-400">
                Context: {chatContext.project.name}{chatContext.project.phase ? ` (${chatContext.project.phase})` : ""}
              </p>
            )}

            {/* Proactive Alerts */}
            {alerts.length > 0 && (
              <div className="mt-3 w-full max-w-[300px] rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-400">
                  <span>⚠</span> {alerts.length} issue{alerts.length > 1 ? "s" : ""} detected
                </div>
                {alerts.slice(0, 3).map((a, i) => (
                  <div key={i} className="text-[11px] text-amber-300/80">• {a}</div>
                ))}
                {alerts.length > 3 && (
                  <div className="mt-1 text-[10px] text-amber-400/60">+{alerts.length - 3} more</div>
                )}
              </div>
            )}

            {/* Smart Actions */}
            {smartActions.length > 0 && (
              <div className="mt-3 flex w-full max-w-[300px] flex-wrap justify-center gap-1.5">
                {smartActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => handleAction(action)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:brightness-125 ${action.color}`}
                  >
                    <span>{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            {/* Quick suggestions */}
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {suggestions.map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="rounded-lg border border-border bg-forge-surface/60 px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:bg-forge-surface hover:text-body"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                ref={i === messages.length - 1 && msg.role === "assistant" ? lastAssistantRef : undefined}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    msg.role === "user"
                      ? msg.isAction
                        ? "bg-violet-600 text-white"
                        : "bg-blue-600 text-white"
                      : "bg-forge-surface text-body"
                  }`}
                >
                  {msg.role === "user" && msg.isAction && (
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-violet-200/70">Smart Action</div>
                  )}
                  {msg.role === "assistant" ? (
                    <div className="prose-sm prose-invert" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />
                  ) : msg.isAction ? (
                    <div className="text-[12px]">{msg.content.slice(0, 80)}...</div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading && messages[messages.length - 1]?.role === "user" && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-forge-surface px-3.5 py-2.5">
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Smart Actions toggle (when in conversation) */}
      {messages.length > 0 && smartActions.length > 0 && (
        <div className="border-t border-border">
          <button
            onClick={() => setShowActions(!showActions)}
            className="flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted transition-colors hover:text-body"
          >
            <span>⚡</span>
            Smart Actions ({smartActions.length})
            <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${showActions ? "rotate-180" : ""}`}>
              <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          {showActions && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {smartActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleAction(action)}
                  disabled={loading}
                  className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors hover:brightness-125 disabled:opacity-50 ${action.color}`}
                >
                  <span>{action.icon}</span>
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-2 border-t border-border px-4 pt-3 pb-4">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about AV design..."
          disabled={loading}
          className="forge-input flex-1"
        />
        {loading ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="forge-btn-primary" title="Stop generating">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="10" height="10" rx="2" /></svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="forge-btn-primary disabled:opacity-50"
          >
            <SendIcon />
          </button>
        )}
      </form>
    </div>
  );
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
}

// Converts GitHub-style markdown tables (header row, |---| separator, body rows)
// into one-line HTML so the later newline→<br /> pass doesn't touch them.
// Input is already HTML-escaped. Wrapped for horizontal scroll in the narrow chat panel.
function renderTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!(TABLE_ROW.test(lines[i]) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-"))) {
      out.push(lines[i]);
      continue;
    }
    const aligns = splitTableRow(lines[i + 1]).map(c =>
      c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left");
    const cell = (tag: "th" | "td", content: string, idx: number) =>
      `<${tag} class="border-b border-border px-2 py-1 align-top ${tag === "th" ? "font-semibold text-heading" : ""}" style="text-align:${aligns[idx] ?? "left"}">${content}</${tag}>`;
    const head = splitTableRow(lines[i]).map((c, idx) => cell("th", c, idx)).join("");
    let j = i + 2;
    const body: string[] = [];
    while (j < lines.length && TABLE_ROW.test(lines[j])) {
      body.push(`<tr>${splitTableRow(lines[j]).map((c, idx) => cell("td", c, idx)).join("")}</tr>`);
      j++;
    }
    out.push(
      `<div class="my-2 overflow-x-auto"><table class="w-full border-collapse text-[12px]"><thead><tr>${head}</tr></thead><tbody>${body.join("")}</tbody></table></div>`
    );
    i = j - 1;
  }
  return out.join("\n");
}

// Simple markdown to HTML (bold, italic, code, lists, tables, line breaks)
function formatMarkdown(text: string): string {
  return renderTables(
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
  )
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="rounded bg-forge-panel px-1 py-0.5 text-[12px]">$1</code>')
    .replace(/^#### (.+)$/gm, '<h5 class="mt-2 mb-0.5 text-[13px] font-semibold text-heading">$1</h5>')
    .replace(/^### (.+)$/gm, '<h4 class="mt-2 mb-1 text-[13px] font-semibold text-heading">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="mt-2 mb-1 text-[14px] font-semibold text-heading">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="mt-1 mb-1.5 text-[15px] font-bold text-heading">$1</h2>')
    .replace(/^- (.+)$/gm, '<li class="ml-3 list-disc text-[13px]">$1</li>')
    // value="$1" pins each item to the number the model wrote; without an <ol>
    // the browser would otherwise count every preceding <li> (bullets included).
    .replace(/^(\d+)\. (.+)$/gm, '<li value="$1" class="ml-3 list-decimal text-[13px]">$2</li>')
    // block elements already break the line; don't add an extra <br /> after them
    .replace(/(<\/(?:h[2-5]|li|div)>)\n/g, "$1")
    .replace(/\n/g, "<br />");
}
