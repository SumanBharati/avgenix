-- One row per completed "Generate with AI" design (Room Designer / Signal
-- Flow). Records what the team answered and which products they kept or
-- turned down, so later sessions for the same org can lean toward the same
-- brands and products (lib/ai-design.ts loadDesignExperience). Org-scoped
-- like equipment_library; rows are written once and never edited.

CREATE TABLE IF NOT EXISTS ai_design_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  room_id     TEXT,
  -- "scope" (designed from an existing Scope of Work) or "interview"
  mode        TEXT NOT NULL,
  -- { type, lengthFt, widthFt, heightFt, seats } as far as known
  room        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ topic, question, answer }]
  answers     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ label, category, location, quantity, product, rejected }] — product is
  -- { source, id, manufacturer, model } or null; rejected is the product the
  -- AI suggested that the user switched back to generic, if any.
  selections  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_design_history_org_created ON ai_design_history(org_id, created_at DESC);

ALTER TABLE ai_design_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_design_history_select ON ai_design_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM organization_members WHERE org_id = ai_design_history.org_id AND user_id = auth.uid())
);
CREATE POLICY ai_design_history_insert ON ai_design_history FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM organization_members WHERE org_id = ai_design_history.org_id AND user_id = auth.uid())
);
