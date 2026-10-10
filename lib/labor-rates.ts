// An org's standard Labor Rates, configured in Account Settings → Labor
// Rates and Costs (organizations.labor_line_items, jsonb). Shared between
// that settings form and the "Add Labor" picker in My Organization's
// Library, which snapshots a type's label/rate/cost into a labor_library
// row rather than referencing it live — so a later rate change in Settings
// doesn't retroactively change items already added to the Library (same
// pricing-snapshot approach Procurement uses when releasing an order).
export type LaborRateType = { key: string; label: string; rate: number; cost: number };

export const DEFAULT_LABOR_RATE_TYPES: LaborRateType[] = [
  { key: "engineering", label: "Engineering", rate: 0, cost: 0 },
  { key: "installation", label: "Installation", rate: 0, cost: 0 },
  { key: "project_mgmt", label: "Project Mgmt", rate: 0, cost: 0 },
  { key: "project_coord", label: "Project Coord", rate: 0, cost: 0 },
  { key: "programming", label: "Programming", rate: 0, cost: 0 },
  { key: "field_engineering", label: "Field Engineering", rate: 0, cost: 0 },
];

export function newLaborRateTypeKey() {
  return `labor_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
