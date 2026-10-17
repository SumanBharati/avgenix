"use client";

// "Generate with AI" — interviews the integrator in short rounds (each round
// built on the previous answers), designs the system, and shows which devices
// were matched to real library products before anything is placed. With no
// Scope of Work, it offers to either go write one or run a fuller interview
// (room type, size, desired outcome first) and write the scope from that.
// Shared by Room Designer and Signal Flow Builder; each passes its own onApply.

import { useEffect, useMemo, useState } from "react";
import {
  GENERIC_ANSWER, answersAsBrief, describeRoomFacts, fetchNextRound, generateDesignUnits, loadDesignExperience,
  loadLibraryBrands, loadRoomScope, makeGeneric, recordDesignSession, saveBriefToSurvey,
  type AIDesignUnit, type DesignAnswer, type DesignQuestion, type DesignRoom,
} from "@/lib/ai-design";
import { planReferenceWiring } from "@/lib/wiring/reference-wiring";

type Step = "loading" | "choose" | "waitingForScope" | "thinking" | "questions" | "planning" | "review" | "applying";

interface Props {
  projectId: string;
  roomId: string;
  orgId: string | null | undefined;
  /** True when the room already has equipment — generating replaces it. */
  hasExistingEquipment: boolean;
  onClose: () => void;
  /**
   * Places the units in the calling tool. Throws to show an error. `context`
   * is the design's text (scope/brief + answers), used to pick a
   * manufacturer's operating mode for reference wiring.
   */
  onApply: (units: AIDesignUnit[], replace: boolean, context: string) => Promise<void>;
}

interface Round {
  questions: DesignQuestion[];
  picks: Record<string, string>;
  text: Record<string, string>;
}

interface Context {
  scopeText: string;
  roomFacts: string;
  brands: string[];
  exp: string;
}

const OTHER = "__other__";

// Every answer given across the rounds; anything left blank counts as generic.
const collect = (list: Round[]): DesignAnswer[] =>
  list.flatMap((r) => r.questions.map((q) => {
    const pick = r.picks[q.id];
    const typed = r.text[q.id]?.trim();
    const answer = q.inputType === "text" ? (typed || GENERIC_ANSWER)
      : pick === OTHER ? (typed || GENERIC_ANSWER)
      : (pick || GENERIC_ANSWER);
    return { id: q.id, topic: q.topic, question: q.question, answer, inputType: q.inputType };
  }));

export default function GenerateWithAIModal({ projectId, roomId, orgId, hasExistingEquipment, onClose, onApply }: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"scope" | "interview">("scope");
  const [ctx, setCtx] = useState<Context>({ scopeText: "", roomFacts: "", brands: [], exp: "" });
  const [summary, setSummary] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [brief, setBrief] = useState("");
  const [room, setRoom] = useState<DesignRoom | null>(null);
  const [saveScope, setSaveScope] = useState(true);
  const [suggested, setSuggested] = useState<AIDesignUnit[]>([]);
  const [units, setUnits] = useState<AIDesignUnit[]>([]);

  const current = rounds[rounds.length - 1];

  const loadContext = async (): Promise<Context> => {
    const [scope, brands, exp] = await Promise.all([
      loadRoomScope(projectId, roomId),
      loadLibraryBrands(orgId),
      loadDesignExperience(orgId),
    ]);
    const next = { scopeText: scope.scopeText, roomFacts: describeRoomFacts(scope.roomName, scope.surveyRoomData), brands, exp };
    setCtx(next);
    return next;
  };

  const design = async (doneRounds: Round[], m: "scope" | "interview", c: Context, writtenBrief: string) => {
    setError(null);
    setStep("planning");
    try {
      const answers = collect(doneRounds);
      const designScope = m === "scope" ? c.scopeText : (writtenBrief || answersAsBrief(answers));
      const result = await generateDesignUnits({ scopeText: designScope, answers, libraryBrands: c.brands, orgId, experience: c.exp });
      if (!result.length) throw new Error("The AI didn't identify any equipment for this room.");
      setSuggested(result);
      setUnits(result);
      setStep("review");
    } catch (e: any) {
      setError(e?.message || "Unable to generate the design.");
      setStep(doneRounds.length ? "questions" : "choose");
    }
  };

  const nextRound = async (doneRounds: Round[], m: "scope" | "interview", c: Context) => {
    setError(null);
    setStep("thinking");
    try {
      const result = await fetchNextRound({
        scopeText: m === "scope" ? c.scopeText : "",
        roomFacts: c.roomFacts,
        history: collect(doneRounds),
        libraryBrands: c.brands,
        experience: c.exp,
        round: doneRounds.length + 1,
      });
      if (result.summary) setSummary(result.summary);
      if (result.room) setRoom(result.room);
      if (result.done) {
        setRounds(doneRounds);
        setBrief(result.brief);
        await design(doneRounds, m, c, result.brief);
        return;
      }
      setRounds([...doneRounds, { questions: result.questions, picks: {}, text: {} }]);
      setStep("questions");
    } catch (e: any) {
      setError(e?.message || "Unable to prepare the next questions.");
      setRounds(doneRounds);
      setStep(doneRounds.length ? "questions" : m === "interview" ? "choose" : "loading");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await loadContext();
        if (cancelled) return;
        if (!c.scopeText.trim()) { setStep("choose"); return; }
        setMode("scope");
        await nextRound([], "scope", c);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Unable to start Generate with AI.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, roomId, orgId]);

  const startInterview = () => {
    setMode("interview");
    setRounds([]);
    nextRound([], "interview", ctx);
  };

  // A new tab, so nothing unsaved on this canvas is lost; the user comes
  // back here and continues once the scope is written.
  const openScopeEditor = () => {
    window.open(`/projects/${projectId}/site-survey?room=${encodeURIComponent(roomId)}&section=scope`, "_blank");
    setStep("waitingForScope");
  };

  const checkScopeAgain = async () => {
    setError(null);
    setStep("loading");
    try {
      const c = await loadContext();
      if (!c.scopeText.trim()) {
        setError("This room still has no Scope of Work. Save it in Site Survey, then check again.");
        setStep("waitingForScope");
        return;
      }
      setMode("scope");
      await nextRound([], "scope", c);
    } catch (e: any) {
      setError(e?.message || "Unable to load the scope.");
      setStep("waitingForScope");
    }
  };

  const apply = async () => {
    setError(null);
    setStep("applying");
    try {
      const answers = collect(rounds);
      // Before placement, so Room Designer can size the room from it.
      if (mode === "interview" && saveScope) {
        await saveBriefToSurvey(projectId, roomId, brief || answersAsBrief(answers), room);
      }
      await onApply(units, hasExistingEquipment, designContext);
      void recordDesignSession({ orgId, projectId, roomId, mode, room, answers, suggested, final: units });
      onClose();
    } catch (e: any) {
      setError(e?.message || "Unable to place the design.");
      setStep("review");
    }
  };

  const updateCurrent = (patch: (r: Round) => Round) =>
    setRounds((prev) => prev.map((r, i) => (i === prev.length - 1 ? patch(r) : r)));
  const setPick = (qid: string, value: string) => updateCurrent((r) => ({ ...r, picks: { ...r.picks, [qid]: value } }));
  const setText = (qid: string, value: string) => updateCurrent((r) => ({ ...r, text: { ...r.text, [qid]: value } }));

  // One review row per run of identical units in the same place.
  const keyOf = (u: AIDesignUnit) => `${u.location || ""}|${u.label}|${u.productKey}`;
  const rows = useMemo(() => {
    const map = new Map<string, { key: string; units: AIDesignUnit[] }>();
    for (const u of units) {
      const key = keyOf(u);
      if (!map.has(key)) map.set(key, { key, units: [] });
      map.get(key)!.units.push(u);
    }
    return Array.from(map.values());
  }, [units]);
  const matchedCount = rows.filter((r) => r.units[0].product).length;

  // The design as text — what the manufacturer wiring rules read to tell,
  // e.g., a Logitech Android-mode room from a PC-mode one.
  const designContext = useMemo(() => [
    mode === "scope" ? ctx.scopeText : brief,
    ...collect(rounds).map((a) => `${a.question} ${a.answer}`),
  ].filter(Boolean).join("\n"), [mode, ctx.scopeText, brief, rounds]);
  // Manufacturer wiring-guide checks (Mic Pod limits, PoE+ for Sight, ...).
  const wiringWarnings = useMemo(() => (units.length
    ? planReferenceWiring(units.map((u) => ({ itemId: u.itemId, label: u.label, name: u.name, category: u.category, mfr: u.mfr, model: u.model })), designContext).warnings
    : []), [units, designContext]);
  const switchToGeneric = (key: string) => setUnits((prev) => prev.map((u) => (keyOf(u) === key ? makeGeneric(u) : u)));

  const busy = step === "loading" || step === "thinking" || step === "planning" || step === "applying";
  const askedBefore = rounds.slice(0, -1).reduce((n, r) => n + r.questions.length, 0);

  const subtitle =
    step === "review" ? `${units.length} device${units.length === 1 ? "" : "s"} designed — ${matchedCount} of ${rows.length} line${rows.length === 1 ? "" : "s"} matched to your library.`
    : step === "choose" || step === "waitingForScope" ? "This room doesn't have a Scope of Work yet."
    : summary || (mode === "interview" ? "Tell AI about the room and it will design the system." : "Answer a few design questions and AI will build this room's system from the Scope of Work.");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-forge-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[16px] font-bold text-heading">Generate with AI</h3>
            {(step === "questions" || step === "thinking") && rounds.length > 0 && (
              <span className="text-[11px] text-subtle">Step {rounds.length}</span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-subtle">{subtitle}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{error}</div>}

          {step === "loading" && !error && <Spinner text="Reading the room…" />}
          {step === "thinking" && <Spinner text={rounds.length ? "Thinking about what to ask next…" : "Preparing questions…"} />}
          {step === "planning" && <Spinner text="Designing the system and searching your library…" />}
          {step === "applying" && <Spinner text="Placing equipment…" />}

          {step === "choose" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                title="Write a Scope of Work first"
                body="Describe the room and what the system needs to do in Site Survey. A good scope gives AI the clearest picture of the project's requirements."
                action="Open Scope of Work"
                onClick={openScopeEditor}
              />
              <ChoiceCard
                title="Let AI ask the questions"
                body="Answer a few quick questions — room type, size, what the system should achieve — and AI designs the system and writes the scope for you."
                action="Start"
                primary
                onClick={startInterview}
              />
            </div>
          )}

          {step === "waitingForScope" && (
            <div className="space-y-3 text-[13px] text-body">
              <p>Site Survey opened in a new tab. Write the room&apos;s Scope of Work there and save it, then come back here.</p>
              <div className="flex gap-2">
                <button onClick={checkScopeAgain} className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-500">I&apos;ve added the scope</button>
                <button onClick={startInterview} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-subtle hover:text-body">Let AI ask instead</button>
              </div>
            </div>
          )}

          {step === "questions" && current && (
            <div className="space-y-4">
              {current.questions.map((q, i) => (
                <div key={q.id} data-question>
                  <div className="text-[13px] font-semibold text-heading">{askedBefore + i + 1}. {q.question}</div>
                  {q.why && <div className="mt-0.5 text-[11px] text-subtle">{q.why}</div>}
                  {q.inputType === "text" ? (
                    <input value={current.text[q.id] || ""} onChange={(e) => setText(q.id, e.target.value)}
                      placeholder={q.placeholder || "Type your answer"}
                      className="mt-2 w-full rounded-lg border border-border bg-transparent px-3 py-1.5 text-[12px] text-body outline-none focus:border-violet-500" />
                  ) : (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {[...q.options.map((o) => o.label), GENERIC_ANSWER, OTHER].map((label) => {
                          const opt = q.options.find((o) => o.label === label);
                          const active = current.picks[q.id] === label;
                          return (
                            <button key={label} type="button" title={opt?.detail || undefined} onClick={() => setPick(q.id, label)}
                              className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${active ? "border-violet-500 bg-violet-600 text-white" : "border-border text-body hover:border-violet-500/60"}`}>
                              {label === OTHER ? "Other…" : label}
                            </button>
                          );
                        })}
                      </div>
                      {current.picks[q.id] === OTHER && (
                        <input autoFocus value={current.text[q.id] || ""} onChange={(e) => setText(q.id, e.target.value)}
                          placeholder="Type your preference"
                          className="mt-2 w-full rounded-lg border border-border bg-transparent px-3 py-1.5 text-[12px] text-body outline-none focus:border-violet-500" />
                      )}
                    </>
                  )}
                </div>
              ))}
              <p className="text-[11px] text-subtle">Unanswered questions stay generic.</p>
            </div>
          )}

          {step === "review" && (
            <>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-subtle">
                    <th className="border-b border-border py-1.5 pr-2">Qty</th>
                    <th className="border-b border-border py-1.5 pr-2">Device</th>
                    <th className="border-b border-border py-1.5 pr-2">Location</th>
                    <th className="border-b border-border py-1.5">Product</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ key, units: group }) => {
                    const u = group[0];
                    return (
                      <tr key={key} className="align-top">
                        <td className="border-b border-border py-2 pr-2 text-body">{group.length}</td>
                        <td className="border-b border-border py-2 pr-2 text-heading" title={u.reason}>{u.label}</td>
                        <td className="border-b border-border py-2 pr-2 text-subtle">{u.location || "TBD"}</td>
                        <td className="border-b border-border py-2">
                          {u.product ? (
                            <div>
                              <div className="text-heading">{u.product.manufacturer} {u.product.model_name}</div>
                              <div className="mt-0.5 flex items-center gap-2">
                                <span className="rounded bg-violet-600/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-400">
                                  {u.product.source === "org" ? "Org Library" : "AVGenix Library"}
                                </span>
                                <button type="button" onClick={() => switchToGeneric(key)} className="text-[11px] text-subtle underline hover:text-body">Use generic</button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="text-body">Generic</div>
                              {u.preferredBrand && <div className="mt-0.5 text-[11px] text-amber-400">No {u.preferredBrand} match in your library</div>}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {wiringWarnings.length > 0 && (
                <div data-wiring-warnings className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
                  <div className="font-semibold">From the manufacturer&apos;s wiring guide</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {wiringWarnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </div>
              )}
              {mode === "interview" && (
                <label className="mt-3 flex items-center gap-2 text-[12px] text-body">
                  <input type="checkbox" checked={saveScope} onChange={(e) => setSaveScope(e.target.checked)} className="accent-violet-600" />
                  Save the answers as this room&apos;s Scope of Work (and room size, if Site Survey doesn&apos;t have it)
                </label>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
          {step === "review" && hasExistingEquipment && (
            <span className="mr-auto text-[11px] text-amber-400">Replaces the room&apos;s current equipment in all tools.</span>
          )}
          <button onClick={onClose} disabled={step === "applying"} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-subtle hover:text-body disabled:opacity-50">Cancel</button>
          {step === "questions" && (
            <>
              {rounds.length > 1 && (
                <button onClick={() => setRounds((prev) => prev.slice(0, -1))} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-subtle hover:text-body">Back</button>
              )}
              <button onClick={() => design(rounds, mode, ctx, brief)} title="Skip the remaining questions — anything not asked stays generic"
                className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-subtle hover:text-body">Design now</button>
              <button onClick={() => nextRound(rounds, mode, ctx)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-500">Next</button>
            </>
          )}
          {step === "review" && (
            <>
              <button onClick={() => setStep("questions")} disabled={!rounds.length} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-subtle hover:text-body disabled:opacity-40">Back</button>
              <button onClick={apply} className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-500">
                {hasExistingEquipment ? "Replace & generate" : "Generate"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChoiceCard({ title, body, action, primary, onClick }: { title: string; body: string; action: string; primary?: boolean; onClick: () => void }) {
  return (
    <div className="flex flex-col rounded-xl border border-border p-4">
      <div className="text-[13px] font-semibold text-heading">{title}</div>
      <p className="mt-1 flex-1 text-[12px] text-subtle">{body}</p>
      <button onClick={onClick}
        className={`mt-3 self-start rounded-lg px-3 py-1.5 text-[12px] font-semibold ${primary ? "bg-violet-600 text-white hover:bg-violet-500" : "border border-border text-body hover:border-violet-500/60"}`}>
        {action}
      </button>
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-[13px] text-body">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      {text}
    </div>
  );
}
