import { supabase } from "./supabase";

/* ── Types ─────────────────────────────────────────────────── */
export interface Person {
  id: string;
  name: string;
  role: string;
  email: string;
  color: string;
  weeklyHours: number;
  hourlyRate: number;
  tags: string[];
  archived: boolean;
  memberUserId?: string;
  inviteId?: string;
  avatar_url?: string;
}

export interface SchedProject {
  id: string;
  name: string;
  client: string;
  color: string;
  projectRef: string | null;
  budgetHours: number;
  budgetAmount: number;
  startDate: string;
  endDate: string;
  archived: boolean;
  tags: string[];
  notes: string;
}

export interface Phase {
  id: string;
  projectId: string;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
  budgetHours: number;
}

export type AllocationStatus = "tentative" | "confirmed" | "complete";

export interface Allocation {
  id: string;
  title?: string;
  color?: string;
  personId: string;
  projectId: string;
  phaseId: string | null;
  startDate: string;
  startTime?: string;
  endDate: string;
  endTime?: string;
  hoursPerDay: number;
  notes: string;
  status: AllocationStatus;
}

export type TimeOffType = "vacation" | "sick" | "holiday" | "other";

export interface TimeOff {
  id: string;
  personId: string;
  startDate: string;
  endDate: string;
  type: TimeOffType;
  notes: string;
}

export interface TimeEntry {
  id: string;
  personId: string;
  projectId: string;
  phaseId: string | null;
  date: string;
  hours: number;
  notes: string;
  billable: boolean;
}

export interface SchedMilestone {
  id: string;
  projectId: string;
  date: string;
  name: string;
  color: string;
}

export interface SchedTask {
  id: string;
  phaseId: string;
  projectId: string;
  name: string;
  assigneeId: string | null;
  done: boolean;
  dueDate: string;
}

export interface BoardSubtask {
  id: string;
  title: string;
  done: boolean;
}

export interface BoardCard {
  id: string;
  title: string;
  color?: string;
  description?: string;
  descriptionShown?: boolean;
  dueDate?: string; // YYYY-MM-DD
  subtasks?: BoardSubtask[];
}

export interface BoardColumn {
  id: string;
  title: string;
  cards: BoardCard[];
  color?: string;
}

export interface BoardMeta {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface BoardData {
  columns: BoardColumn[];
}

/**
 * A lightweight, ad-hoc task that only exists for logging time against —
 * it's not a real project and never appears on the Projects page, Board,
 * or Scheduler. Time entries reference it via `projectId` just like a
 * real SchedProject, but with `phaseId` always null.
 */
export interface AdHocTask {
  id: string;
  name: string;
  createdAt: string;
  /** Set when the task is deleted: hidden from pickers/search, but past logged hours keep their name. */
  archivedAt?: string;
}

export interface PMStore {
  people: Person[];
  projects: SchedProject[];
  phases: Phase[];
  allocations: Allocation[];
  timeOff: TimeOff[];
  timeEntries: TimeEntry[];
  milestones: SchedMilestone[];
  tasks: SchedTask[];
  boards: BoardMeta[];
  boardData: Record<string, BoardData>;
  adHocTasks: AdHocTask[];
}

export const emptyPMStore: PMStore = {
  people: [],
  projects: [],
  phases: [],
  allocations: [],
  timeOff: [],
  timeEntries: [],
  milestones: [],
  tasks: [],
  boards: [],
  boardData: {},
  adHocTasks: [],
};

/* ── Constants ─────────────────────────────────────────────── */
export const ROLE_OPTIONS = [
  "Sales Executive",
  "Pre Sales Engineer",
  "Post Sales Engineer",
  "Field Engineer",
  "Installer",
  "Programmer",
  "Project Coordinator",
  "Project Manager",
  "Engineering Manager",
  "Sales Manager",
];

export const PERSON_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#6366f1",
];

export const PROJECT_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#6366f1",
  "#a855f7", "#d946ef", "#0ea5e9", "#10b981", "#84cc16",
];

export const TIME_OFF_COLORS: Record<TimeOffType, string> = {
  vacation: "#f59e0b",
  sick: "#ef4444",
  holiday: "#06b6d4",
  other: "#94a3b8",
};

export const uid = () => crypto.randomUUID();

/* ── Date helpers ──────────────────────────────────────────── */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d: Date, startDay = 1): Date {
  // startDay: 0=Sun, 1=Mon
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day - startDay + 7) % 7;
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function businessDaysBetween(startISO: string, endISO: string): number {
  if (!startISO || !endISO) return 0;
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  if (end < start) return 0;
  let count = 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    if (!isWeekend(d)) count++;
  }
  return count;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function dateInRange(d: string, start: string, end: string): boolean {
  return d >= start && d <= end;
}

export function fmtDateShort(s: string): string {
  if (!s) return "—";
  return parseISODate(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtDateFull(s: string): string {
  if (!s) return "—";
  return parseISODate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── Supabase I/O ──────────────────────────────────────────── */
const TABLE = "org_project_management";

export async function loadPMStore(orgId: string): Promise<PMStore> {
  const { data } = await supabase
    .from(TABLE)
    .select("data")
    .eq("org_id", orgId)
    .maybeSingle();
  if (data?.data) return { ...emptyPMStore, ...(data.data as PMStore) };
  return emptyPMStore;
}

/**
 * Import organization projects (from the main `projects` table) into the
 * scheduler's SchedProject list so they're pickable on Time Tracking,
 * Scheduler, etc. Matches by `projectRef`; backfills `projectRef` on existing
 * SchedProjects that were created with a matching name.
 * Only adds — never overwrites user edits on existing scheduler projects.
 */
export async function mergeOrgProjectsAsSchedProjects(
  orgId: string,
  store: PMStore,
): Promise<PMStore> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, client_name")
    .eq("org_id", orgId);

  if (error || !data) return store;

  const next = [...store.projects];
  let changed = false;

  // Scheduler entries whose project was deleted (or never belonged to this
  // workspace) are archived rather than removed, so logged hours survive.
  const liveIds = new Set(data.map((p) => p.id));
  for (let i = 0; i < next.length; i++) {
    const sp = next[i];
    if (sp.projectRef && !liveIds.has(sp.projectRef) && !sp.archived) {
      next[i] = { ...sp, archived: true };
      changed = true;
    }
  }

  for (const p of data) {
    if (next.some((sp) => sp.projectRef === p.id)) continue;
    const idx = next.findIndex((sp) => !sp.projectRef && sp.name === p.name);
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        projectRef: p.id,
        client: next[idx].client || p.client_name || "",
      };
      changed = true;
      continue;
    }
    next.push({
      id: uid(),
      name: p.name,
      client: p.client_name || "",
      color: PROJECT_COLORS[next.length % PROJECT_COLORS.length],
      projectRef: p.id,
      budgetHours: 0,
      budgetAmount: 0,
      startDate: "",
      endDate: "",
      archived: false,
      tags: [],
      notes: "",
    });
    changed = true;
  }

  return changed ? { ...store, projects: next } : store;
}

/**
 * Import org members and pending invites into the Resources (people) list.
 * Only adds missing rows — never mutates existing fields — so local edits stick.
 * Matches on memberUserId / inviteId first, then on email (case-insensitive).
 * Backfills the identity link on existing rows that only had an email match.
 */
export async function mergeOrgMembersAsPeople(orgId: string, store: PMStore): Promise<{ store: PMStore; currentUserId: string | null }> {
  const [{ data: { user } }, membersRes, invitesRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("organization_members")
      .select("user_id, department")
      .eq("org_id", orgId),
    supabase
      .from("organization_invites")
      .select("id, email, department, status")
      .eq("org_id", orgId)
      .eq("status", "pending"),
  ]);

  const members = membersRes.data || [];
  const invites = invitesRes.data || [];

  const lowerEmail = (s: string) => (s || "").trim().toLowerCase();
  const nameFromEmail = (e: string) =>
    e.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const buildFullName = (metadata: Record<string, string> | undefined, fallbackEmail: string, existingName: string) => {
    if (!metadata) return nameFromEmail(fallbackEmail) || existingName;
    const full = metadata.full_name?.trim();
    if (full) return full;
    const first = metadata.first_name?.trim() || "";
    const last = metadata.last_name?.trim() || "";
    if (first || last) return [first, last].filter(Boolean).join(" ");
    return nameFromEmail(fallbackEmail) || existingName;
  };

  const isUUID = (s: string | undefined) =>
    !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  // Fix corrupted entries where memberUserId was saved as a non-UUID string (e.g. the literal "memberUserId").
  const next = store.people.map((p) =>
    p.memberUserId && !isUUID(p.memberUserId) ? { ...p, memberUserId: undefined } : p
  );
  let changed = next.some((p, i) => p !== store.people[i]);

  for (const m of members) {
    // Always sync name + email for already-linked people so profile changes propagate.
    const linkedIdx = next.findIndex((p) => p.memberUserId === m.user_id);
    if (linkedIdx >= 0) {
      if (user && m.user_id === user.id) {
        const email = user.email || "";
        const fullName = buildFullName(user.user_metadata, email, next[linkedIdx].name);
        const avatar_url = user.user_metadata?.avatar_url || undefined;
        if (next[linkedIdx].name !== fullName || next[linkedIdx].email !== email || next[linkedIdx].avatar_url !== avatar_url) {
          next[linkedIdx] = { ...next[linkedIdx], name: fullName, email, avatar_url };
          changed = true;
        }
      }
      continue;
    }

    const isCurrent = user && m.user_id === user.id;
    const email = isCurrent ? (user?.email || "") : "";
    const fullName = isCurrent
      ? buildFullName(user?.user_metadata, email, "Team member")
      : `Team member ${m.user_id.slice(0, 4)}`;

    if (email) {
      const idx = next.findIndex((p) => lowerEmail(p.email) === lowerEmail(email));
      if (idx >= 0) {
        next[idx] = { ...next[idx], memberUserId: m.user_id };
        if (!next[idx].role && m.department) next[idx].role = m.department;
        changed = true;
        continue;
      }
    }

    // Claim an unlinked placeholder for the current user rather than adding a duplicate.
    // Matches default placeholder names and known corrupted values (e.g. "memberUserId").
    const PLACEHOLDER_NAMES = ["New person", "memberUserId"];
    if (isCurrent) {
      const placeholderIdx = next.findIndex(
        (p) => !p.memberUserId && !p.inviteId && PLACEHOLDER_NAMES.includes(p.name),
      );
      if (placeholderIdx >= 0) {
        next[placeholderIdx] = {
          ...next[placeholderIdx],
          name: fullName,
          email,
          memberUserId: m.user_id,
          avatar_url: isCurrent ? (user?.user_metadata?.avatar_url || undefined) : undefined,
          ...(m.department && !next[placeholderIdx].role ? { role: m.department } : {}),
        };
        changed = true;
        continue;
      }
    }

    next.push({
      id: uid(),
      name: fullName,
      role: m.department || ROLE_OPTIONS[0],
      email,
      color: PERSON_COLORS[next.length % PERSON_COLORS.length],
      weeklyHours: 40,
      hourlyRate: 0,
      tags: [],
      archived: false,
      memberUserId: m.user_id,
      avatar_url: isCurrent ? (user?.user_metadata?.avatar_url || undefined) : undefined,
    });
    changed = true;
  }

  for (const inv of invites) {
    if (next.some((p) => p.inviteId === inv.id)) continue;
    const idx = next.findIndex((p) => lowerEmail(p.email) === lowerEmail(inv.email));
    if (idx >= 0) {
      next[idx] = { ...next[idx], inviteId: inv.id };
      changed = true;
      continue;
    }
    next.push({
      id: uid(),
      name: nameFromEmail(inv.email),
      role: inv.department || ROLE_OPTIONS[0],
      email: inv.email,
      color: PERSON_COLORS[next.length % PERSON_COLORS.length],
      weeklyHours: 40,
      hourlyRate: 0,
      tags: [],
      archived: false,
      inviteId: inv.id,
    });
    changed = true;
  }

  // People who were only ever a pending invite (never became a member) whose
  // invite is gone: revoked, declined, expired, or left over from a workspace
  // that became an Individual one. Drop them, or archive them if schedule or
  // timesheet data points at them so that history survives. Skipped when
  // either query failed, since empty results would look like "everyone left".
  if (!membersRes.error && !invitesRes.error) {
    const pendingInviteIds = new Set(invites.map((inv) => inv.id));
    const referenced = new Set<string>([
      ...store.allocations.map((a) => a.personId),
      ...store.timeOff.map((t) => t.personId),
      ...store.timeEntries.map((t) => t.personId),
      ...store.tasks.map((t) => t.assigneeId).filter((id): id is string => Boolean(id)),
    ]);
    for (let i = next.length - 1; i >= 0; i--) {
      const p = next[i];
      if (!p.inviteId || p.memberUserId || pendingInviteIds.has(p.inviteId)) continue;
      if (referenced.has(p.id)) {
        if (!p.archived) { next[i] = { ...p, archived: true }; changed = true; }
      } else {
        next.splice(i, 1);
        changed = true;
      }
    }
  }

  return { store: changed ? { ...store, people: next } : store, currentUserId: user?.id ?? null };
}

export async function savePMStore(orgId: string, store: PMStore): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: existing } = await supabase
    .from(TABLE)
    .select("id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from(TABLE)
      .update({ data: store, updated_at: new Date().toISOString() })
      .eq("org_id", orgId);
  } else {
    await supabase
      .from(TABLE)
      .insert({ org_id: orgId, user_id: user.id, data: store });
  }
}

/* ── Computed helpers ──────────────────────────────────────── */
export function personWeeklyHours(p: Person): number {
  return p.weeklyHours || 40;
}

export function personDailyCapacity(p: Person): number {
  return personWeeklyHours(p) / 5;
}

export function allocationHoursOnDate(a: Allocation, isoDate: string): number {
  if (!dateInRange(isoDate, a.startDate, a.endDate)) return 0;
  return a.hoursPerDay;
}

export function personScheduledHoursOnDate(
  personId: string,
  isoDate: string,
  allocations: Allocation[],
): number {
  return allocations
    .filter((a) => a.personId === personId)
    .reduce((sum, a) => sum + allocationHoursOnDate(a, isoDate), 0);
}

export function personScheduledHoursInRange(
  personId: string,
  startISO: string,
  endISO: string,
  allocations: Allocation[],
): number {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  let total = 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    total += personScheduledHoursOnDate(personId, toISODate(d), allocations);
  }
  return total;
}

export function isPersonOnLeave(
  personId: string,
  isoDate: string,
  timeOff: TimeOff[],
): TimeOff | null {
  return (
    timeOff.find(
      (t) => t.personId === personId && dateInRange(isoDate, t.startDate, t.endDate),
    ) || null
  );
}

export function projectSpentHours(
  projectId: string,
  timeEntries: TimeEntry[],
): number {
  return timeEntries
    .filter((e) => e.projectId === projectId)
    .reduce((s, e) => s + e.hours, 0);
}

export function projectAllocatedHours(
  projectId: string,
  allocations: Allocation[],
): number {
  return allocations
    .filter((a) => a.projectId === projectId)
    .reduce((s, a) => s + a.hoursPerDay * businessDaysBetween(a.startDate, a.endDate), 0);
}

export function utilizationPercent(
  personId: string,
  startISO: string,
  endISO: string,
  allocations: Allocation[],
  person: Person,
): number {
  const scheduled = personScheduledHoursInRange(personId, startISO, endISO, allocations);
  const days = businessDaysBetween(startISO, endISO);
  const capacity = personDailyCapacity(person) * days;
  if (capacity === 0) return 0;
  return Math.round((scheduled / capacity) * 100);
}
