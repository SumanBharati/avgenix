// Server-only helper for the "Generate with AI" design routes
// (app/api/ai-design/*): one structured-output Claude call that returns
// parsed JSON matching a schema, or throws.
//
// Uses structured outputs (output_config.format) rather than a forced tool
// call — forced tool_choice isn't accepted by current models. The server-side
// refusal fallback is enabled so a false-positive safety decline is retried on
// another model inside the same request instead of failing the whole flow.

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export const AI_DESIGN_MODEL = "claude-opus-5-5";

export async function callStructured<T>(opts: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<T> {
  // Streamed (finalMessage) so a large room's plan can't hit an HTTP timeout.
  // `fallbacks` isn't in this SDK version's types yet, hence the cast.
  const stream = anthropic.beta.messages.stream({
    model: AI_DESIGN_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: opts.effort ?? "medium", format: { type: "json_schema", schema: opts.schema } },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  } as any);
  const response: any = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined this request — try rewording the scope.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The AI response was cut off — the scope may be too large for one pass.");
  }
  const text = (response.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Failed to parse AI response");
  }
}
