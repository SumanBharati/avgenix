import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { VoyageAIClient } from "voyageai";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

function sanitize(value: unknown, maxLen = 300): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s.replace(/[\r\n]/g, ' ').slice(0, maxLen);
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! });

const SYSTEM_PROMPT = `You are AVGenix AI, an expert Audio/Visual systems design assistant built into the AVGenix project management platform.

Your capabilities:
- Deep knowledge of AV system design, engineering, and installation
- AVIXA/CTS-D standards and best practices
- Equipment selection and compatibility guidance
- Room design, acoustics, display sizing, signal flow, and cabling
- Proposal and cost estimation guidance
- Troubleshooting AV systems

Guidelines:
- Be concise and practical. AV professionals need actionable answers, not essays.
- When reference material is provided below, use it to inform your answer. Do NOT mention that you are reading from reference documents or any source files — just answer naturally as an expert.
- If reference material doesn't cover the topic, use your general knowledge but mention it's a general recommendation when appropriate.
- Use industry-standard terminology.
- Format responses with markdown for readability.

Context-Aware Behavior:
- You may receive project context including the current page, project details, site survey data, proposal data, procurement data, equipment library, and labor rates.
- When project context is present, tailor your answers specifically to that project.
- When survey data is present and the user asks about equipment or design, use the actual room dimensions, ceiling type, room purpose, and other survey fields to give specific recommendations (not generic advice).
- When proposal data is present, you can review it for completeness, suggest missing items, validate quantities, and estimate costs.
- When the equipment library is present, prefer recommending items from it. Only suggest outside equipment when the library doesn't have a suitable option.
- When labor rates are present, use them to estimate costs accurately.
- When procurement data is present, you can flag mismatches between proposal quantities and ordered quantities.
- If on a site survey page, proactively suggest what fields might be missing or what to look out for.
- If on a proposal page, help with scope of work drafting, equipment selection, and cost estimation.
- Never expose internal field names or JSON structure in your responses — speak naturally about rooms, equipment, and project details.`;

async function getRelevantChunks(query: string): Promise<string> {
  try {
    const embeddingResponse = await voyage.embed({
      input: [query],
      model: "voyage-3-lite",
      inputType: "query",
    });

    const queryEmbedding = embeddingResponse.data![0].embedding;

    const { data: chunks, error } = await supabase.rpc("match_document_chunks", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.3,
      match_count: 8,
    });

    if (error || !chunks || chunks.length === 0) return "";

    return chunks.map((c: any) => c.content).join("\n\n---\n\n");
  } catch (err) {
    console.error("Retrieval error:", err);
    return "";
  }
}

export async function POST(request: NextRequest) {
  try {
    const { messages, projectContext } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messages required" }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    // Get latest user message for retrieval
    const lastUserMessage = [...messages].reverse().find((m: any) => m.role === "user");
    const query = lastUserMessage?.content || "";

    // Retrieve relevant document chunks
    const referenceContent = await getRelevantChunks(query);

    // Build system prompt with context layers
    let fullSystemPrompt = SYSTEM_PROMPT;

    if (referenceContent) {
      fullSystemPrompt += `\n\n## Reference Knowledge\nUse the following reference material to inform your answer:\n\n${referenceContent}`;
    }

    if (projectContext) {
      const ctx = projectContext;
      let contextBlock = `\n\n## Current Context\nThe user is on page: ${sanitize(ctx.page)}`;

      if (ctx.project) {
        contextBlock += `\n\n### Project: ${sanitize(ctx.project.name)}`;
        if (ctx.project.client_name) contextBlock += `\nClient: ${sanitize(ctx.project.client_name)}`;
        if (ctx.project.job_number) contextBlock += `\nJob Number: ${sanitize(ctx.project.job_number)}`;
        if (ctx.project.phase) contextBlock += `\nCurrent Phase: ${sanitize(ctx.project.phase)}`;
      }

      if (ctx.survey) {
        contextBlock += `\n\n### Site Survey Data`;
        for (const building of ctx.survey.buildings || []) {
          contextBlock += `\nBuilding: ${sanitize(building.name)}`;
          if (building.data) {
            for (const [k, v] of Object.entries(building.data)) {
              if (v) contextBlock += `\n  ${sanitize(k)}: ${sanitize(v)}`;
            }
          }
          for (const room of building.rooms || []) {
            contextBlock += `\n  Room: ${sanitize(room.name)}`;
            if (room.data) {
              for (const [k, v] of Object.entries(room.data)) {
                if (v) contextBlock += `\n    ${sanitize(k)}: ${sanitize(v)}`;
              }
            }
          }
        }
      }

      if (ctx.proposal) {
        contextBlock += `\n\n### Proposal Data`;
        if (ctx.proposal.taxRate) contextBlock += `\nTax Rate: ${sanitize(ctx.proposal.taxRate)}%`;
        if (ctx.proposal.marginPercent) contextBlock += `\nMargin: ${sanitize(ctx.proposal.marginPercent)}%`;
        for (const section of ctx.proposal.sections || []) {
          contextBlock += `\nSection: ${sanitize(section.name)}`;
          if (section.scopeOfWork) contextBlock += `\n  Scope: ${sanitize(section.scopeOfWork, 1000)}`;
          for (const item of section.items || []) {
            contextBlock += `\n  - ${sanitize(item.qty)}x ${sanitize(item.manufacturer)} ${sanitize(item.model)} (${sanitize(item.category)}) @ $${sanitize(item.unitCost)}`;
          }
        }
      }

      if (ctx.procurement) {
        contextBlock += `\n\n### Procurement Summary`;
        contextBlock += `\nLine items: ${sanitize(ctx.procurement.lineCount)}, POs: ${sanitize(ctx.procurement.poCount)}`;
        contextBlock += `\nPending: ${sanitize(ctx.procurement.pendingItems)}, Ordered: ${sanitize(ctx.procurement.orderedItems)}, Received: ${sanitize(ctx.procurement.receivedItems)}`;
      }

      if (ctx.equipmentLibrary && ctx.equipmentLibrary.length > 0) {
        contextBlock += `\n\n### Equipment Library (prefer these when recommending)`;
        for (const e of ctx.equipmentLibrary) {
          contextBlock += `\n  - ${sanitize(e.manufacturer)} ${sanitize(e.model)} (${sanitize(e.category)}) — $${sanitize(e.unitCost)}`;
        }
      }

      if (ctx.laborRates) {
        contextBlock += `\n\n### Organization Labor Rates`;
        for (const [k, v] of Object.entries(ctx.laborRates)) {
          if (v) contextBlock += `\n  ${sanitize(k).replace(/_/g, " ")}: $${sanitize(v)}/hr`;
        }
      }

      fullSystemPrompt += contextBlock;
    }

    // Call Claude
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: fullSystemPrompt,
      messages: messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
    });

    // Stream plain text to the client as it is generated
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          console.error("Chat stream error:", err);
          controller.error(err);
        }
      },
      cancel() {
        stream.abort();
      },
    });

    return new Response(body, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
    });
  } catch (err: any) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
