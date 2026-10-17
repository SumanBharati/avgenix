import { supabase } from "@/lib/supabase";

// Tables holding exactly one JSONB row per project, upserted on project_id.
const SINGLE_ROW_TABLES = ["project_management", "procurement", "site_surveys", "proposals"] as const;

// A table that doesn't exist in this deployment (PostgREST error PGRST205,
// "Could not find the table ... in the schema cache") isn't a copy failure —
// there's nothing there to lose. Surfacing it as a warning would just alarm
// the user about a gap unrelated to their actual project data.
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || /could not find the table/i.test(error.message || "");
}

// Deep-copies every table scoped to a project into a brand-new project row,
// so the duplicate is a fully independent project — editing one never
// touches the other. Internal ids inside each table's JSONB `data` blob
// (devices, rooms, connections, tasks, vendors, POs, etc.) are copied
// verbatim, never regenerated: they're only ever looked up within that same
// project's own rows (e.g. room_id correlates site_surveys ↔ tool_data ↔
// room_designs, and rack-planner's sourceDeviceId points at a signal-flow
// device in the same room) — regenerating them would silently break those
// links without gaining anything, since nothing outside the project ever
// references them.
export async function duplicateProject(sourceProjectId: string): Promise<{ id: string; warnings: string[] } | { error: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: source, error: srcErr } = await supabase.from("projects").select("*").eq("id", sourceProjectId).single();
  if (srcErr || !source) return { error: srcErr?.message || "Project not found" };

  const { id: _sourceId, created_at: _createdAt, ...rest } = source as Record<string, unknown>;
  const newProjectRow = {
    ...rest,
    name: `${source.name} (1)`,
    user_id: user.id,
    created_by: (user.user_metadata as any)?.full_name || user.email || "",
  };

  const { data: inserted, error: insErr } = await supabase.from("projects").insert(newProjectRow).select("id").single();
  if (insErr || !inserted) return { error: insErr?.message || "Failed to create the duplicate project" };
  const newId = inserted.id as string;

  const warnings: string[] = [];

  await Promise.all([
    ...SINGLE_ROW_TABLES.map(async (table) => {
      const { data, error } = await supabase.from(table).select("data").eq("project_id", sourceProjectId).maybeSingle();
      if (error) { if (!isMissingTableError(error)) warnings.push(`${table}: ${error.message}`); return; }
      if (!data) return;
      const { error: copyErr } = await supabase.from(table).insert({ project_id: newId, user_id: user.id, data: data.data });
      if (copyErr && !isMissingTableError(copyErr)) warnings.push(`${table}: ${copyErr.message}`);
    }),
    (async () => {
      const { data, error } = await supabase.from("tool_data").select("tool, room_id, data").eq("project_id", sourceProjectId);
      if (error) { if (!isMissingTableError(error)) warnings.push(`tool_data: ${error.message}`); return; }
      if (!data?.length) return;
      const rows = data.map((r) => ({ project_id: newId, user_id: user.id, tool: r.tool, room_id: r.room_id, data: r.data }));
      const { error: copyErr } = await supabase.from("tool_data").insert(rows);
      if (copyErr && !isMissingTableError(copyErr)) warnings.push(`tool_data: ${copyErr.message}`);
    })(),
    (async () => {
      const { data, error } = await supabase.from("room_designs").select("room_id, data").eq("project_id", sourceProjectId);
      if (error) { if (!isMissingTableError(error)) warnings.push(`room_designs: ${error.message}`); return; }
      if (!data?.length) return;
      const rows = data.map((r) => ({ project_id: newId, user_id: user.id, room_id: r.room_id, data: r.data }));
      const { error: copyErr } = await supabase.from("room_designs").insert(rows);
      if (copyErr && !isMissingTableError(copyErr)) warnings.push(`room_designs: ${copyErr.message}`);
    })(),
    (async () => {
      // Team assignments carry over by reference — member_id points at an
      // org-scoped roster, and person_id at an external resource in the org's
      // Schedule, both valid unchanged for the new project too. org_id must be
      // copied as well: RLS only accepts the row when has_pro_access(org_id).
      const { data, error } = await supabase.from("project_members").select("org_id, member_id, person_id, role, full_name, email").eq("project_id", sourceProjectId);
      if (error) { if (!isMissingTableError(error)) warnings.push(`project_members: ${error.message}`); return; }
      if (!data?.length) return;
      const rows = data.map((r) => ({
        project_id: newId, org_id: (source as any).org_id ?? r.org_id,
        member_id: r.member_id, person_id: r.person_id, role: r.role, full_name: r.full_name, email: r.email,
      }));
      const { error: copyErr } = await supabase.from("project_members").insert(rows);
      if (copyErr && !isMissingTableError(copyErr)) warnings.push(`project_members: ${copyErr.message}`);
    })(),
  ]);

  return { id: newId, warnings };
}
