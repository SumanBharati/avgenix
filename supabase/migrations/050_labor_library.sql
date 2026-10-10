-- Org-level Labor catalog — mirrors equipment_library's org-scoping/RLS
-- shape, but deliberately much lighter: no manufacturer/ports/rack specs,
-- none of which apply to labor. Rate is what you bill; cost is your own
-- loaded cost, so margin can be shown the same way equipment margin is.
-- Lets "My Organization's Library" hold Labor line items alongside
-- Equipment, picked from the "Add Labor" button.

CREATE TABLE IF NOT EXISTS labor_library (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  label       TEXT NOT NULL,
  rate        NUMERIC NOT NULL DEFAULT 0,
  cost        NUMERIC NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_labor_library_org ON labor_library(org_id);

ALTER TABLE labor_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY labor_library_select ON labor_library FOR SELECT USING (
  EXISTS (SELECT 1 FROM organization_members WHERE org_id = labor_library.org_id AND user_id = auth.uid())
);
CREATE POLICY labor_library_insert ON labor_library FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM organization_members WHERE org_id = labor_library.org_id AND user_id = auth.uid())
);
CREATE POLICY labor_library_update ON labor_library FOR UPDATE USING (
  EXISTS (SELECT 1 FROM organization_members WHERE org_id = labor_library.org_id AND user_id = auth.uid())
);
CREATE POLICY labor_library_delete ON labor_library FOR DELETE USING (
  EXISTS (SELECT 1 FROM organization_members WHERE org_id = labor_library.org_id AND user_id = auth.uid())
);
