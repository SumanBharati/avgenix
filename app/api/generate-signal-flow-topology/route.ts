import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { SIGNAL_TYPES, type GeneratedDevice, type ProposedConnection, type SignalTypeId } from "@/lib/signal-flow-types";
import { validateProposedConnections } from "@/lib/signal-flow-topology";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const ROLES = [
  "video_source", "av_source", "audio_source",
  "conferencing_processor", "audio_processor", "audio_amplifier",
  "control_processor", "signal_transport",
  "video_destination", "audio_destination", "other",
] as const;

const SIGNAL_IDS = SIGNAL_TYPES.map((s) => s.id);

const TOOL_NAME = "propose_signal_flow_topology";

const PORT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Unique within this device only, e.g. \"p1\", \"p2\"." },
    name: { type: "string", description: "Short human-readable port label, e.g. \"HDMI Output\", \"Dante In\"." },
    signalType: { type: "string", enum: SIGNAL_IDS },
    direction: { type: "string", enum: ["input", "output"] },
  },
  required: ["id", "name", "signalType", "direction"],
};

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    devices: {
      type: "array",
      description: "One entry per input unit, in the same itemId set given.",
      items: {
        type: "object",
        properties: {
          itemId: { type: "string" },
          role: { type: "string", enum: ROLES },
          ports: { type: "array", items: PORT_SCHEMA },
        },
        required: ["itemId", "role", "ports"],
      },
    },
    connections: {
      type: "array",
      description: "Proposed cables, ordered most-confident first.",
      items: {
        type: "object",
        properties: {
          sourceItemId: { type: "string" },
          sourcePortId: { type: "string" },
          targetItemId: { type: "string" },
          targetPortId: { type: "string" },
          signalType: { type: "string", enum: SIGNAL_IDS },
          confidence: { type: "number", description: "0 to 1." },
          reason: { type: "string", description: "One short sentence — why this cable makes sense in this system." },
        },
        required: ["sourceItemId", "sourcePortId", "targetItemId", "targetPortId", "signalType"],
      },
    },
  },
  required: ["devices", "connections"],
};

const SYSTEM_PROMPT = `You are an AV system designer's assistant. You are given a list of generic AV equipment units that were identified from a room's Scope of Work — none of them are real products yet, just placeholders like "PTZ Camera" or "Audio DSP" that the integrator will pick real equipment for later.

Your job has two parts:

1. For each unit, decide its role in the system (one of the enumerated roles) and the logical ports it needs to do that job. These are DESIGN-INTENT ports — what the finished system requires this unit to connect through (e.g. a generic Audio DSP needs a Dante network port, a USB audio port, and an analog input) — NOT a claim about any specific real product's physical ports. Keep the port list minimal and realistic: only what the signal chain actually needs.

2. Propose the wiring topology connecting these units into one coherent AV signal chain — video, audio, and control paths — the way an experienced AV integrator would lay out a room: sources (cameras, laptops, wireless presentation) feed a conferencing codec or switcher; a codec's/switcher's video outputs feed displays; microphones feed an audio DSP; a DSP feeds an amplifier; an amplifier feeds speakers; a codec's USB audio connects to the DSP for echo cancellation; control processors/touch panels connect to whatever they control. Not every unit necessarily connects to every other unit — only propose a cable where there's a real reason for one.

Rules:
- Every port you invent must be either "input" or "output" (no bidirectional ports).
- A connection's signalType must be a type both of its ports would speak, and must set the SAME signal on both ends: an output port only ever drives an input port, never another output.
- Prefer the most common real-world signal type for each link (e.g. HDMI between a source and a display or codec, Dante/"dante" for professional networked audio, "analog" for simple mic/line-level runs, "cat6" for HDBaseT/network video extension or IP control, "control" for RS-232/IR).
- Give each connection a one-sentence "reason" explaining why it belongs in the system, and a "confidence" from 0 to 1. List connections most-confident first.
- If a unit has no sensible place in the signal chain (e.g. it's genuinely standalone), give it whatever ports make sense for its role but propose no connection for it — don't invent a connection just to use every unit.
- Some units are real, already-selected products and list "fixed ports". For those, return exactly the listed ports (same ids, names, signal types and directions) — don't add, drop or rename any — and wire them only through those ports. Only units without fixed ports get invented design-intent ports.

Return your answer only via the ${TOOL_NAME} tool call — no other text.`;

export async function POST(req: NextRequest) {
  try {
    const { units, references } = await req.json();
    const referenceLines: string[] = Array.isArray(references) ? references.filter((r: any) => typeof r === "string").slice(0, 120) : [];
    if (!Array.isArray(units) || units.length === 0) {
      return NextResponse.json({ error: "units is required" }, { status: 400 });
    }

    const signalIdSet = new Set<SignalTypeId>(SIGNAL_IDS);
    // Units that are real library products arrive with their actual ports
    // ("Generate with AI"); those are authoritative and override whatever the
    // AI echoes back for them below.
    const fixedPortsByItem = new Map<string, GeneratedDevice["ports"]>();
    for (const u of units) {
      if (!Array.isArray(u.ports) || u.ports.length === 0) continue;
      fixedPortsByItem.set(u.itemId, u.ports
        .filter((p: any) => p && typeof p.id === "string")
        .map((p: any) => ({
          id: p.id,
          name: String(p.name || p.id),
          signalType: signalIdSet.has(p.signalType) ? p.signalType : "proprietary",
          direction: p.direction === "output" ? "output" : "input",
        })));
    }

    const unitLines = units
      .map((u: any) => {
        const base = `- itemId: ${u.itemId} | label: ${u.label} | category: ${u.category} | location: ${u.location || "unspecified"}`;
        const fixed = fixedPortsByItem.get(u.itemId);
        if (!fixed) return base;
        return `${base} | product: ${u.product || "selected product"} | fixed ports: ${fixed.map((p) => `${p.id} "${p.name}" (${p.signalType}, ${p.direction})`).join("; ")}`;
      })
      .join("\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      // Same fix as generate-devices-from-scope: without this, Sonnet 5 burns
      // an uncontrolled chunk of max_tokens on extended thinking before
      // emitting the tool call, which can truncate the tool_use input on a
      // large room (many devices/ports/connections) — this task needs no
      // visible reasoning, just structured extraction.
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      tools: [{ name: TOOL_NAME, description: "Report the role, logical ports, and proposed wiring for the given generic AV equipment units.", input_schema: INPUT_SCHEMA as any }],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content: `Here are the generic AV equipment units for this room:\n\n${unitLines}\n\n${referenceLines.length
            ? `Manufacturer reference wiring — REQUIRED. These cables come from the manufacturer's official wiring guide. Include every one of them exactly (same units, using the port with that name, or the closest port of that type), and don't propose any other cable on those ports:\n${referenceLines.map((l) => `- ${l}`).join("\n")}\n\nWire everything else as you normally would, around these.\n\n`
            : ""}Propose each unit's role, logical ports, and the wiring topology connecting them.`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    const raw = toolUse && toolUse.type === "tool_use" ? (toolUse.input as any) : null;
    if (!raw) {
      return NextResponse.json({ error: "AI did not return structured topology data" }, { status: 500 });
    }

    const validItemIds = new Set(units.map((u: any) => u.itemId));

    const devices: GeneratedDevice[] = (Array.isArray(raw.devices) ? raw.devices : [])
      .filter((d: any) => d && typeof d.itemId === "string" && validItemIds.has(d.itemId))
      .map((d: any) => ({
        itemId: d.itemId,
        role: ROLES.includes(d.role) ? d.role : "other",
        ports: fixedPortsByItem.get(d.itemId) ?? (Array.isArray(d.ports) ? d.ports : [])
          .filter((p: any) => p && typeof p.id === "string" && typeof p.name === "string")
          .map((p: any) => ({
            id: p.id,
            name: p.name,
            signalType: signalIdSet.has(p.signalType) ? p.signalType : "proprietary",
            direction: p.direction === "output" ? "output" : "input",
          })),
      }));

    // A real product the AI left out still keeps its ports.
    fixedPortsByItem.forEach((ports, itemId) => {
      if (!devices.some((d) => d.itemId === itemId)) devices.push({ itemId, role: "other", ports });
    });

    const proposedConnections: ProposedConnection[] = (Array.isArray(raw.connections) ? raw.connections : [])
      .filter((c: any) => c && c.sourceItemId && c.sourcePortId && c.targetItemId && c.targetPortId)
      .map((c: any) => ({
        sourceItemId: String(c.sourceItemId),
        sourcePortId: String(c.sourcePortId),
        targetItemId: String(c.targetItemId),
        targetPortId: String(c.targetPortId),
        signalType: signalIdSet.has(c.signalType) ? c.signalType : "proprietary",
        confidence: typeof c.confidence === "number" ? c.confidence : undefined,
        reason: typeof c.reason === "string" ? c.reason : undefined,
      }));

    const connections = validateProposedConnections(devices, proposedConnections);

    return NextResponse.json({ devices, connections });
  } catch (error: any) {
    console.error("Generate signal flow topology error:", error);
    return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
  }
}
