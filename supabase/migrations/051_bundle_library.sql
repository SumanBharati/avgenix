-- Org-level Bundles — a named set of items from the org's own library
-- (equipment_library + labor_library rows) with a quantity each, so a
-- common package can be added to any future proposal in one click.
-- Same org-scoping/RLS shape as labor_library (050).
--
-- items is a JSON array of { "kind": "equipment" | "labor", "id": "<uuid>", "qty": <number> }
-- where id points at equipment_library.id / labor_library.id. For labor, qty is
-- hours; for equipment it's units. References are resolved when the bundle is
-- used, so an item deleted from the library is simply skipped.

CREATE TABLE IF NOT EXISTS bundle_library (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bundle_library_org ON bundle_library(org_id);

ALTER TABLE bundle_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY bundle_library_select ON bundle_library FOR SELECT USING (
  EXISTS (SELECT 1 FROM organization_members WHERE org_id = bundle_library.org_id AND user_id = auth.uid())
);
CREATE POLICY bundle_library_insert ON bundle_library FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM organization_members WHERE org_id = bundle_library.org_id AND user_id = auth.uid())
);
CREATE POLICY bundle_library_update ON bundle_library FOR UPDATE USING (
  EXISTS (SELECT 1 FROM organization_members WHERE org_id = bundle_library.org_id AND user_id = auth.uid())
);
CREATE POLICY bundle_library_delete ON bundle_library FOR DELETE USING (
  EXISTS (SELECT 1 FROM organization_members WHERE org_id = bundle_library.org_id AND user_id = auth.uid())
);
