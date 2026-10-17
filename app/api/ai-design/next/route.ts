import { NextRequest, NextResponse } from "next/server";
import { callStructured } from "@/lib/ai-design-server";
import { LOGITECH_DESIGN_NOTES } from "@/lib/wiring/logitech";

// "Generate with AI" interview: given everything known so far (the Scope of
// Work if there is one, Site Survey facts, and the answers already given),
// return the next few questions — each round built on the previous answers —
// or say the design brief is complete.

const MAX_ROUNDS = 8;

const QUESTION = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "Short snake_case id, unique across the whole interview." },
    topic: { type: "string", enum: ["room", "outcome", "platform", "display", "conferencing", "camera", "switching", "audio", "control", "other"] },
    question: { type: "string" },
    why: { type: "string", description: "One short sentence on why this matters; empty string if obvious." },
    inputType: { type: "string", enum: ["choice", "text"] },
    placeholder: { type: "string", description: "Hint for a text answer (e.g. \"e.g. 20 x 15 x 9 ft\"); empty string for choice questions." },
    options: {
      type: "array",
      description: "3–6 options for a choice question; empty for a text question.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { label: { type: "string" }, detail: { type: "string" } },
        required: ["label", "detail"],
      },
    },
  },
  required: ["id", "topic", "question", "why", "inputType", "placeholder", "options"],
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    done: { type: "boolean" },
    summary: { type: "string", description: "One sentence: what's being designed, as understood so far." },
    questions: { type: "array", items: QUESTION },
    brief: { type: "string", description: "When done and there is no Scope of Work: a complete Scope of Work for this room written from the answers. Otherwise empty." },
    room: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: ["string", "null"] },
        lengthFt: { type: ["number", "null"] },
        widthFt: { type: ["number", "null"] },
        heightFt: { type: ["number", "null"] },
        seats: { type: ["integer", "null"] },
      },
      required: ["type", "lengthFt", "widthFt", "heightFt", "seats"],
    },
  },
  required: ["done", "summary", "questions", "brief", "room"],
};

const SYSTEM = `You are a senior AV system designer (CTS-D level) interviewing an AV integrator so you can design one room's system. You ask in short rounds; each round's questions build on the answers already given.

How to interview:
- Ask 1–4 questions per round, the most decision-shaping first. Never re-ask something already answered, stated in the Scope of Work, or given in the Site Survey facts.
- Questions in the same round must be independent of each other. If a question's options would depend on the answer to another unanswered question, hold it for a later round. In particular, never ask a conferencing/video-bar/codec brand in the same round as the bar-based vs modular decision — the brand list differs between MTR-certified bars and modular codec kits, so ask it only after that choice is made.
- If there is NO Scope of Work, start from the basics: room type / primary use, size (dimensions and/or seating capacity — a text question), and the desired outcome of the system (e.g. Microsoft Teams Room, Zoom Room, BYOD conferencing, presentation only, hybrid teaching, divisible room). Then go deeper based on the answers.
- If there IS a Scope of Work, skip the basics it covers and go straight to the open design decisions.
- Follow-ups must depend on earlier answers. Examples: "Microsoft Teams Room" → ask bar-based vs codec/modular (camera + DSP); "bar-based Teams Room" → ask the preferred brand among MTR-certified video bars (Logitech, Neat, Poly, Yealink, Jabra, Lenovo, Cisco…) — and don't ask that if the scope already names the bar; "modular/codec" → ask camera and audio approach separately; a switcher is needed → ask brand (Crestron, Extron, QSC, Kramer, AMX…), then AVoIP vs fixed presentation/matrix switching; ceiling mics → ask the mic/DSP ecosystem; large room → ask about voice lift / program audio.
- Ask about displays (size class and brand) whenever the system has displays and they're undecided; about control (brand, touch panel) only if the room calls for control.
- Don't ask about things that wouldn't change the equipment list. Typical interviews take 2–5 rounds; stop as soon as you could confidently design the system.
- Options: concrete and short, most likely first. Prefer brands from the user's library when they make that kind of product. Do NOT add "generic / no preference / decide later" options — the app adds that. Use a text question only for free-form facts like dimensions.
- "Team preferences" (when given) describe what this team usually chooses. Put those choices first in the options and lean on them when a decision is close. Never mention or allude to past projects, history, or learning in any question, detail or summary.

When you have enough (or the round limit is reached): set done=true and questions=[]. If there is no Scope of Work, write "brief": a clear Scope of Work for the room in plain prose an integrator would write (room, size, use, every system and the chosen brands/approaches; unanswered decisions stay open/generic). If there is a Scope of Work, leave brief empty. Fill "room" with whatever is known (type, dimensions in feet, seats), null otherwise.`;

export async function POST(req: NextRequest) {
  try {
    const { scopeText, roomFacts, history, libraryBrands, experience, round } = await req.json();
    const hasScope = typeof scopeText === "string" && scopeText.trim().length > 0;
    const qa = (Array.isArray(history) ? history : [])
      .map((h: any) => `- [${h.id}] ${h.question}\n  Answer: ${h.answer}`)
      .join("\n");
    const brands: string[] = Array.isArray(libraryBrands) ? libraryBrands.filter((b: any) => typeof b === "string").slice(0, 200) : [];
    const roundNo = Number.isFinite(round) ? Number(round) : 1;
    const mustFinish = roundNo > MAX_ROUNDS;

    const user = [
      hasScope ? `Scope of Work:\n${scopeText}` : "Scope of Work: (none — this room has no scope written yet)",
      `Site Survey facts: ${roomFacts || "(none)"}`,
      `Answers so far:\n${qa || "(none yet)"}`,
      `Brands in the user's library: ${brands.length ? brands.join(", ") : "(none)"}`,
      experience ? `Team preferences:\n${experience}` : "",
      `Manufacturer knowledge (use it to ask the right follow-ups when these products are chosen):\n${LOGITECH_DESIGN_NOTES}`,
      mustFinish
        ? "The interview is over — return done=true with no questions."
        : `This is round ${roundNo}. Ask the next questions, or finish if you have enough.`,
    ].filter(Boolean).join("\n\n");

    const data = await callStructured<any>({ system: SYSTEM, user, schema: SCHEMA, effort: "low", maxTokens: 8000 });

    const asked = new Set((Array.isArray(history) ? history : []).map((h: any) => String(h.id)));
    const questions = mustFinish ? [] : (Array.isArray(data?.questions) ? data.questions : [])
      .filter((q: any) => q && q.question && !asked.has(String(q.id)))
      .slice(0, 4)
      .map((q: any, i: number) => {
        const text = q.inputType === "text";
        return {
          id: asked.has(String(q.id)) ? `${q.id}_${roundNo}_${i}` : String(q.id || `r${roundNo}q${i}`),
          topic: q.topic || "other",
          question: String(q.question),
          why: String(q.why || ""),
          inputType: text ? "text" : "choice",
          placeholder: String(q.placeholder || ""),
          options: text ? [] : (Array.isArray(q.options) ? q.options : [])
            .filter((o: any) => o && o.label && !/generic|no preference|decide later/i.test(String(o.label)))
            .map((o: any) => ({ label: String(o.label), detail: String(o.detail || "") })),
        };
      })
      .filter((q: any) => q.inputType === "text" || q.options.length > 0);

    const done = mustFinish || !!data?.done || questions.length === 0;
    return NextResponse.json({
      done,
      summary: String(data?.summary || ""),
      questions: done ? [] : questions,
      brief: done && !hasScope ? String(data?.brief || "") : "",
      room: data?.room || null,
    });
  } catch (error: any) {
    console.error("AI design next-questions error:", error);
    return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
  }
}
