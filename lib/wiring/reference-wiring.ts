// Manufacturer reference wiring: turns the recipes in lib/wiring/logitech.ts
// into concrete cables between the units of a design, checks the guide's
// limits, and enforces those cables on a finished Signal Flow (reference
// wiring always wins over AI-proposed wiring for the same ports).

import type { SignalTypeId } from "@/lib/signal-flow-types";
import {
  GUIDE, HOSTS, LOGITECH_DESIGN_NOTES, MIC_LIMITS, RALLY_PLUS_COMMON, ROLES,
  type Link, type Mode, type RolePort,
} from "@/lib/wiring/logitech";

export { LOGITECH_DESIGN_NOTES };

export interface WiringUnit {
  itemId: string;
  label: string;
  name?: string;
  category?: string;
  mfr?: string | null;
  model?: string | null;
}

export interface ResolvedLink {
  fromItemId: string;
  fromPort: string;
  toItemId: string;
  toPort: string;
  signal: SignalTypeId;
  reason: string;
}

export interface WiringPlan {
  host: string | null;
  mode: Mode | null;
  links: ResolvedLink[];
  /** The guide's real ports for each recognised Logitech unit, by itemId. */
  portsByItemId: Map<string, RolePort[]>;
  warnings: string[];
}

// Mounts, cables and other accessories never take part in the wiring.
const ACCESSORY = /\b(mount|mounting|bracket|cart|cover|stand|plate|adapter|cable|latch|polarizer|earpads?|strap|charger|receiver|kit for)\b/i;

const isLogitech = (u: WiringUnit) => /\blogi(tech)?\b/i.test(`${u.mfr || ""} ${u.model || ""}`);

export function classifyUnit(u: WiringUnit): string | null {
  if (ACCESSORY.test(`${u.model || ""} ${u.label}`)) return null;
  const text = `${u.mfr || ""} ${u.model || ""} ${u.label} ${u.name || ""}`;
  const logi = isLogitech(u);
  for (const [role, def] of Object.entries(ROLES)) {
    if (def.logitech && !logi) continue;
    if (def.match.test(text)) return role;
  }
  return null;
}

/** Whether any unit of the design is a Logitech product the guide covers. */
export function hasLogitechSystem(units: WiringUnit[]): boolean {
  return units.some((u) => { const r = classifyUnit(u); return !!r && ROLES[r].logitech; });
}

export function detectMode(roles: Set<string>, contextText: string): Mode {
  const t = contextText.toLowerCase();
  if (/\bpc mode\b|dedicated (teams |zoom )?(rooms? )?(pc|computer)|rooms on windows|\bwindows\b|thinksmart core/.test(t) || roles.has("compute")) return "pc";
  if (/\bandroid\b|collabos|appliance mode/.test(t) || roles.has("roomMate")) return "android";
  if (/\bbyod\b|bring your own/.test(t)) return "byod";
  if (roles.has("tap") || roles.has("tapIp")) return "android";
  return "android";
}

const reasonOf = (l: Link) => `${GUIDE}, p.${l.page}${l.via ? ` — via ${l.via}` : ""}`;

export function planReferenceWiring(units: WiringUnit[], contextText: string): WiringPlan {
  const byRole = new Map<string, WiringUnit[]>();
  const portsByItemId = new Map<string, RolePort[]>();
  for (const u of units) {
    const role = classifyUnit(u);
    if (!role) continue;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push(u);
    const ports = ROLES[role].ports;
    if (ports) portsByItemId.set(u.itemId, ports);
  }
  const empty: WiringPlan = { host: null, mode: null, links: [], portsByItemId, warnings: [] };
  const host = HOSTS.find((h) => byRole.has(h.role)) || (byRole.has("tableHub") ? HOSTS.find((h) => h.role === "displayHub") : undefined);
  if (!host) return empty;

  const roles = new Set(byRole.keys());
  let mode = detectMode(roles, contextText);
  if (!host.modes[mode]) {
    mode = (["pc", "android", "byod"] as Mode[]).find((m) => host.modes[m] && (m !== "pc" || roles.has("compute")))
      || (Object.keys(host.modes)[0] as Mode);
  }

  // Displays include touch displays; "display#2" is the second of them.
  const displays = units.filter((u) => { const r = classifyUnit(u); return r === "display" || r === "touchDisplay"; });
  const resolve = (ref: string): WiringUnit | undefined => {
    const [role, n] = ref.split("#");
    const idx = n ? parseInt(n, 10) - 1 : 0;
    const list = role === "display" ? displays : byRole.get(role) || [];
    return list[idx];
  };

  const links: ResolvedLink[] = [];
  const add = (l: Link) => {
    if (l.unless?.some((r) => roles.has(r))) return;
    if (l.when && !l.when.test(contextText)) return;
    if (l.unlessText && l.unlessText.test(contextText)) return;
    const from = resolve(l.from[0]), to = resolve(l.to[0]);
    if (!from || !to || from.itemId === to.itemId) return;
    links.push({ fromItemId: from.itemId, fromPort: l.from[1], toItemId: to.itemId, toPort: l.to[1], signal: l.signal, reason: reasonOf(l) });
  };
  (host.modes[mode] || []).forEach(add);
  if (roles.has("displayHub") || roles.has("tableHub")) RALLY_PLUS_COMMON.forEach(add);

  // Mic Pods: into the Sight's Mic Pod dongle when a Sight is used with a
  // bar (p.71/75), otherwise the host's mic input; Mic Pod Hubs first, then
  // pods fanned into hub inputs, the rest daisy-chained (p.13–14).
  const micTargetRef: [string, string] | undefined =
    roles.has("sight") && host.role === "rallyBar" ? ["sight", "Mic Pod (dongle)"] : host.micTarget;
  const target = micTargetRef ? resolve(micTargetRef[0]) : undefined;
  if (target && micTargetRef) {
    const hubs = byRole.get("micPodHub") || [];
    const pods = byRole.get("micPod") || [];
    const micLink = (fromU: WiringUnit, fromPort: string, toU: WiringUnit, toPort: string, page: number) =>
      links.push({ fromItemId: fromU.itemId, fromPort, toItemId: toU.itemId, toPort, signal: "proprietary", reason: `${GUIDE}, p.${page}` });
    hubs.forEach((hub, i) => {
      if (i === 0) micLink(hub, "Out", target, micTargetRef[1], 14);
      else micLink(hub, "Out", hubs[i - 1], "In 3", 14);
    });
    const hubInputs: Array<[WiringUnit, string]> = [];
    hubs.forEach((hub, i) => {
      hubInputs.push([hub, "In 1"], [hub, "In 2"]);
      if (i === hubs.length - 1) hubInputs.push([hub, "In 3"]);
    });
    let prev: WiringUnit | null = null;
    pods.forEach((pod) => {
      const slot = hubInputs.shift();
      if (slot) { micLink(pod, "Mic Pod out", slot[0], slot[1], 14); return; }
      if (prev) micLink(pod, "Mic Pod out", prev, "Daisy-chain in", 13);
      else micLink(pod, "Mic Pod out", target, micTargetRef[1], 13);
      prev = pod;
    });
  }

  return { host: host.role, mode, links, portsByItemId, warnings: checkRules(units, byRole, host.role, mode) };
}

function checkRules(units: WiringUnit[], byRole: Map<string, WiringUnit[]>, host: string, mode: Mode): string[] {
  const w: string[] = [];
  const count = (r: string) => (byRole.get(r) || []).length;
  const pods = count("micPod"), hubs = count("micPodHub"), sights = count("sight");
  const network = count("network") > 0;

  if (host === "rallyBar") {
    const bar = byRole.get("rallyBar")![0];
    const isMini = /mini/i.test(`${bar.model || ""} ${bar.label}`);
    const lim = MIC_LIMITS[isMini ? "rallyBarMini" : "rallyBar"];
    const maxPods = sights >= 2 ? lim.withTwoSights! : sights === 1 ? lim.withSight! : lim.pods;
    const name = isMini ? "Rally Bar Mini" : "Rally Bar";
    if (pods > maxPods) w.push(`${name} supports at most ${maxPods} Mic Pod${maxPods === 1 ? "" : "s"}${sights ? ` with ${sights === 1 ? "a Sight" : "two Sights"}` : ""} — the design has ${pods}.`);
    if (hubs > lim.hubs) w.push(`${name} supports at most ${lim.hubs} Mic Pod Hubs — the design has ${hubs}.`);
  }
  if ((host === "displayHub" || host === "rallyPlus") && pods + hubs > 0) {
    if (pods > MIC_LIMITS.rallyPlus.pods) w.push(`Rally / Rally Plus supports at most ${MIC_LIMITS.rallyPlus.pods} Mic Pods — the design has ${pods}.`);
    if (sights) w.push("Sight with Rally Plus is listed as \"coming soon\" in the Logitech guide.");
  }
  if (sights && !network) w.push("Sight requires PoE+ (802.3at Type 2) — add a PoE+ switch port or an active PoE+ injector.");
  if (count("tapIp")) w.push("Tap IP connects to the client LAN and needs PoE there — a PoE network port or a PoE injector (sold separately).");
  const displays = units.filter((u) => { const r = classifyUnit(u); return r === "display" || r === "touchDisplay"; }).length;
  if ((host === "rallyBarHuddle" || host === "meetup2") && displays > 1 && mode !== "pc") {
    w.push(`${host === "rallyBarHuddle" ? "Rally Bar Huddle" : "MeetUp 2"} has a single display output — a second display needs PC mode or a RoomMate.`);
  }
  if (host === "rallyBarHuddle" && count("swytch")) w.push("Swytch with Rally Bar Huddle is listed as \"coming soon\" in the Logitech guide.");
  if (count("rallyCamera") && count("swytch") && (host === "displayHub" || host === "rallyPlus")) {
    w.push("Extending the Rally Camera USB cable (10 m Strong USB) does not work with Swytch.");
  }
  if ((host === "meetup" || host === "meetup2" || host === "displayHub" || host === "rallyPlus") && mode === "pc" && !count("compute")) {
    w.push("PC mode needs a dedicated room PC (e.g. Lenovo ThinkSmart Core) — none is in the design.");
  }
  if (count("meetup") && !count("roomMate") && !count("compute")) {
    w.push("MeetUp is a USB device — it needs a RoomMate (Android) or a room PC to run Teams/Zoom Rooms.");
  }
  if (count("scribe") && displays > 1) w.push("With Scribe on a dual-display Teams Room, HDMI-TV 1 goes to the right display and HDMI-TV 2 to the left.");
  if (count("touchDisplay") && mode === "android") w.push("Touch screens on Teams Rooms on Android require CollabOS 1.12 or later.");
  return w;
}

// --- Enforcing reference wiring on a Signal Flow --------------------------

export interface CanvasPort { id: string; label?: string; signal?: string; dir?: string; side?: string; [k: string]: any }
export interface CanvasDevice { id: any; itemId?: string; ports: CanvasPort[]; [k: string]: any }
export interface CanvasConnection { id: any; from: { deviceId: any; portId: any }; to: { deviceId: any; portId: any }; signal?: string; reason?: string; reference?: boolean; [k: string]: any }

const norm = (s: string | undefined) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Makes every reference cable exist on the canvas: finds (or adds) the named
 * port on each end, removes any AI-proposed cable already occupying either
 * port, and connects them. Returns new arrays; inputs are not mutated.
 */
export function applyReferenceWiring(
  devicesIn: CanvasDevice[],
  connectionsIn: CanvasConnection[],
  links: ResolvedLink[],
): { devices: CanvasDevice[]; connections: CanvasConnection[]; applied: number } {
  const devices = devicesIn.map((d) => ({ ...d, ports: [...(d.ports || [])] }));
  const byItem = new Map(devices.filter((d) => d.itemId).map((d) => [d.itemId as string, d]));
  let connections = [...connectionsIn];
  const portKey = (deviceId: any, portId: any) => `${deviceId}::${portId}`;
  const refUsed = new Set<string>();
  let added = 0, seq = 0;

  const findPort = (d: CanvasDevice, label: string, signal: SignalTypeId, dir: "in" | "out"): CanvasPort => {
    const want = norm(label);
    const sameDir = d.ports.filter((p) => (p.dir || "in") === dir && !refUsed.has(portKey(d.id, p.id)));
    const hit = sameDir.find((p) => norm(p.label) === want)
      || sameDir.find((p) => norm(p.label) && (norm(p.label).includes(want) || want.includes(norm(p.label))))
      || sameDir.find((p) => p.signal === signal && !connections.some((c) =>
        (c.from.deviceId === d.id && c.from.portId === p.id) || (c.to.deviceId === d.id && c.to.portId === p.id)));
    if (hit) return hit;
    const port: CanvasPort = { id: `${d.id}-wr${Date.now()}-${seq++}`, label, signal, dir, side: dir === "out" ? "right" : "left" };
    d.ports.push(port);
    return port;
  };

  links.forEach((l) => {
    const src = byItem.get(l.fromItemId), dst = byItem.get(l.toItemId);
    if (!src || !dst) return;
    const sp = findPort(src, l.fromPort, l.signal, "out");
    const dp = findPort(dst, l.toPort, l.signal, "in");
    const sk = portKey(src.id, sp.id), dk = portKey(dst.id, dp.id);
    if (refUsed.has(sk) || refUsed.has(dk)) return;
    connections = connections.filter((c) => {
      const a = portKey(c.from.deviceId, c.from.portId), b = portKey(c.to.deviceId, c.to.portId);
      return !(a === sk || b === sk || a === dk || b === dk);
    });
    refUsed.add(sk); refUsed.add(dk);
    connections.push({
      id: `ref-${Date.now()}-${added}`,
      from: { deviceId: src.id, portId: sp.id },
      to: { deviceId: dst.id, portId: dp.id },
      signal: l.signal,
      reason: l.reason,
      confidence: 1,
      reference: true,
    });
    added++;
  });

  return { devices, connections, applied: added };
}

/** Reference cables as plain-text instructions for the topology AI. */
export function linksForPrompt(links: ResolvedLink[]): string[] {
  return links.map((l) => `${l.fromItemId} "${l.fromPort}" → ${l.toItemId} "${l.toPort}" (${l.signal}) — ${l.reason}`);
}
