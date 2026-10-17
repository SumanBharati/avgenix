import { NextRequest, NextResponse } from "next/server";
import { callStructured } from "@/lib/ai-design-server";
import { LOGITECH_DESIGN_NOTES } from "@/lib/wiring/logitech";

// Step 2 of "Generate with AI": turn the Scope of Work plus the integrator's
// answers into a complete equipment list for the room, picking a real product
// from the supplied library catalog only where one genuinely fits — anything
// else stays generic for the user to choose later.

const CATEGORIES = ["display", "camera", "speaker", "touch_panel", "microphone", "other"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    devices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: CATEGORIES },
          label: { type: "string" },
          quantity: { type: "integer" },
          location: { type: ["string", "null"] },
          productRef: { type: ["string", "null"], description: "A ref from the catalog, or null for generic." },
          preferredBrand: { type: ["string", "null"], description: "Brand the user asked for for this device, when no catalog product matched; else null." },
          reason: { type: "string" },
        },
        required: ["category", "label", "quantity", "location", "productRef", "preferredBrand", "reason"],
      },
    },
  },
  required: ["devices"],
};

const SYSTEM = `You are a senior AV system designer (CTS-D level). Design the complete equipment list for one room from its Scope of Work and the integrator's answers to your design questions.

Equipment list:
- Include everything the scope asks for, and the supporting equipment a working system needs even if the scope doesn't spell it out — e.g. a DSP when there are ceiling/networked microphones and no all-in-one bar handles audio; an amplifier for passive speakers; a network/PoE switch for AVoIP or Dante; transmitters/receivers or encoders/decoders that match the chosen switching approach; a control processor when a touch panel is used. Don't add anything the design doesn't need.
- Follow the answers: brand preferences decide which manufacturer to use; "AVoIP" vs "fixed switcher" decides the switching architecture; an answer of "Generic — I'll decide later" means stay generic for that part of the system.
- category: one of display, camera, speaker, touch_panel, microphone, other ("other" for codecs, bars, DSPs, amplifiers, switchers, switches, control processors, etc.).
- label: short generic title-case name by placement/type ("Front Wall Display", "Ceiling Microphone", "AV Switcher", "Audio DSP"). The same label for every identical unit.
- quantity: from the scope (explicit counts win); otherwise what the room needs.
- location: short installation location, 1–3 words, title case ("Front Wall", "Ceiling", "Table", "Equipment Rack", "Credenza"); identical strings for things in the same place; null only if truly unknowable.
- reason: one short sentence on why this device is in the design.

Library products:
- productRef must be a ref copied exactly from the catalog, or null. Never invent one.
- Pick a catalog product only when it really is that kind of device AND matches the brand the user chose for it (or the brand the scope names). Read the model and description — a display mount is not a display, a switcher is not a DSP.
- When the user chose a brand but no catalog product of that brand fits, set productRef null and preferredBrand to that brand.
- When the answer for that part was generic / decide later, set productRef null and preferredBrand null.
- "Team preferences" (when given) say which products this team usually keeps and which it turns down. When several catalog products fit an answer equally, pick the one the team usually keeps; avoid ones it turned down unless nothing else fits. Explicit answers always win over preferences. Never mention past projects or preferences in "reason".`;

export async function POST(req: NextRequest) {
  try {
    const { scopeText, answers, catalog, experience } = await req.json();
    if ((typeof scopeText !== "string" || !scopeText.trim()) && !(Array.isArray(answers) && answers.length)) {
      return NextResponse.json({ error: "scopeText or answers are required" }, { status: 400 });
    }
    const answerLines = (Array.isArray(answers) ? answers : [])
      .filter((a: any) => a && a.question)
      .map((a: any) => `- ${a.question}\n  Answer: ${a.answer || "Generic — I'll decide later"}`)
      .join("\n");
    const items: any[] = Array.isArray(catalog) ? catalog.slice(0, 800) : [];
    const refs = new Set(items.map((c) => String(c.ref)));
    const catalogLines = items
      .map((c) => `${c.ref} | ${c.manufacturer} | ${c.model} | ${c.category || ""} | ${String(c.description || "").slice(0, 80)}`)
      .join("\n");

    const data = await callStructured<any>({
      system: SYSTEM,
      user: `Scope of Work:\n\n${scopeText || "(none — design from the answers below)"}\n\nDesign questions and the integrator's answers:\n${answerLines || "(none asked)"}\n\n${experience ? `Team preferences:\n${experience}\n\n` : ""}Manufacturer knowledge — follow it when these products are in the design (e.g. include the host a Logitech kit needs, respect Mic Pod limits, add a PoE+ switch for Sight):\n${LOGITECH_DESIGN_NOTES}\n\nLibrary catalog (ref | manufacturer | model | category | description):\n${catalogLines || "(empty)"}\n\nDesign the equipment list.`,
      schema: SCHEMA,
      effort: "medium",
    });

    const devices = (Array.isArray(data?.devices) ? data.devices : [])
      .filter((d: any) => d && String(d.label || "").trim())
      .map((d: any) => ({
        category: CATEGORIES.includes(d.category) ? d.category : "other",
        label: String(d.label).trim(),
        quantity: Number.isFinite(d.quantity) && d.quantity > 0 ? Math.min(99, Math.floor(d.quantity)) : 1,
        location: d.location ? String(d.location).trim() || null : null,
        // A ref the catalog never offered is dropped rather than trusted.
        productRef: d.productRef && refs.has(String(d.productRef)) ? String(d.productRef) : null,
        preferredBrand: d.preferredBrand ? String(d.preferredBrand) : null,
        reason: String(d.reason || ""),
      }));

    return NextResponse.json({ devices });
  } catch (error: any) {
    console.error("AI design plan error:", error);
    return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
  }
}
