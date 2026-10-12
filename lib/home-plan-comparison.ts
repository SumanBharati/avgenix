export interface PlanComparisonFeature {
  name: string;
  pro: boolean;
  free: boolean;
  badge?: string;
  detail?: string;
}

export const PLAN_COMPARISON_FEATURES: PlanComparisonFeature[] = [
  { name: "AV engineering calculators", pro: true, free: true, badge: "POPULAR" },
  { name: "AV News & Podcasts", pro: true, free: true, badge: "POPULAR" },
  { name: "References", pro: true, free: true },
  { name: "AI assistant", pro: true, free: false },
  { name: "Project workspaces", pro: true, free: false, badge: "POPULAR" },
  { name: "Site surveys", pro: true, free: false },
  { name: "Room Designer", pro: true, free: false },
  { name: "Signal Flow Builder", pro: true, free: false, badge: "POPULAR" },
  { name: "Rack Builder", pro: true, free: false },
  { name: "Proposals and change orders", pro: true, free: false },
  { name: "Project scheduling", pro: true, free: false },
  { name: "Resource management", pro: true, free: false },
  { name: "Project boards", pro: true, free: false },
  { name: "Time tracking", pro: true, free: false },
  { name: "Equipment library", pro: true, free: false },
  { name: "Order Management", pro: true, free: false },
];
