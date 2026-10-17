// Which devices need the client's network (internet) to work, and how to
// mark them on a Signal Flow: a "Client LAN" flag on the device's network
// port — the same off-sheet label integrators place by hand — instead of
// drawing every network cable to a switch the drawing doesn't show.
//
// Covers: Teams Rooms / Zoom Rooms compute; conference bars and boards that
// run Teams/Zoom themselves (appliance / Android mode); and the network room
// controllers and scheduling panels that run the meeting app (PoE-powered,
// so they get "Client LAN PoE", matching existing hand-drawn designs).
// A USB-only peripheral (a Logitech Tap, a MeetUp, a webcam) is not on the
// network itself and gets nothing.

import type { Mode } from "@/lib/wiring/logitech";

export const CLIENT_LAN = "Client LAN";
export const CLIENT_LAN_POE = "Client LAN PoE";

export interface InternetUnit {
  mfr?: string | null;
  model?: string | null;
  label: string;
  name?: string;
}

const COMPUTE = /\bcompute\b|\b(mtr|teams rooms?|zoom rooms?)\b[^,]*\b(pc|compute|computer)\b|room(s)? pc|mini ?pc|\bnuc\b|thinksmart core|lenovo core/i;
const ROOMMATE = /roommate/i;
// Bars/boards that are always appliances (they run the meeting app).
const ALWAYS_APPLIANCE = /\bneat\b.*\b(bar|board)\b|\bstudio x\d*|\bg7500\b|cisco.*\b(room bar|room kit|board|desk)\b|\broom bar( pro)?\b|meetingbar|meetingboard|\bbar pro\b|\bboard pro\b/i;
// Logitech bars/boards run in Android (appliance), PC or BYOD mode.
const LOGITECH_MODAL = /rally bar|rally board/i;
// Generic bars — only an appliance when the design says so.
const GENERIC_BAR = /(video|conference|conferencing|collaboration|meeting|room) bar|all-in-one (video )?bar|video ?conferenc\w* (system|board)/i;
const APPLIANCE_TEXT = /android|appliance|collabos|all-in-one|\bnative (teams|zoom)\b/i;
// Network controllers / scheduling panels (PoE).
const POE_PANEL = /tap ip|tap scheduler|neat pad|scheduling panel|room (booking|scheduling) panel|\bnavigator\b|\btc(8|10)\b|roompanel|\bctp18\b|\bmtouch\b|(room|meeting|table) (touch )?controller.*(poe|ip)\b/i;
const NOT_NETWORK = /\btap\b(?! (ip|scheduler))|meetup|webcam|usb camera/i;

/**
 * The flag text for a unit that needs the client network, or null.
 * `mode` is the Logitech operating mode when known (lib/wiring), and
 * `contextText` the design's scope/answers.
 */
export function clientLanLabel(u: InternetUnit, mode: Mode | null, contextText: string): string | null {
  const text = `${u.mfr || ""} ${u.model || ""} ${u.label} ${u.name || ""}`;
  if (/\b(mount|bracket|cable|kit for|cover|stand)\b/i.test(`${u.model || ""} ${u.label}`)) return null;
  if (POE_PANEL.test(text)) return CLIENT_LAN_POE;
  if (NOT_NETWORK.test(text)) return null;
  if (COMPUTE.test(text) || ROOMMATE.test(text)) return CLIENT_LAN;
  if (ALWAYS_APPLIANCE.test(text)) return CLIENT_LAN;
  if (LOGITECH_MODAL.test(text)) {
    if (mode) return mode === "android" ? CLIENT_LAN : null;
    return /\bpc mode\b|\bbyod\b/i.test(contextText) ? null : CLIENT_LAN;
  }
  if (GENERIC_BAR.test(text)) {
    const pcOrByod = /\bpc mode\b|dedicated (teams |zoom )?(rooms? )?(pc|computer)|\bbyod only\b/i.test(contextText);
    return APPLIANCE_TEXT.test(contextText) && !pcOrByod ? CLIENT_LAN : null;
  }
  return null;
}

const NETWORK_PORT = /ethernet|\blan\b|rj-?45|network|\bpoe\b|\bip\b/i;

/** Ids of a block's network (Ethernet / LAN / PoE) ports. */
export function networkPortIds(block: { ports?: Array<{ id: any; label?: string }> }): any[] {
  return (block.ports || []).filter((p) => NETWORK_PORT.test(p.label || "")).map((p) => p.id);
}

/**
 * The port a Client LAN flag goes on: an unconnected network port if the
 * block has one, otherwise null (the caller adds one). A network port that
 * is already cabled (e.g. to a PoE switch in the drawing) means the
 * connection is shown, so no flag.
 */
export function pickNetworkPort(
  block: { id: any; ports?: Array<{ id: any; label?: string; signal?: string }> },
  connections: Array<{ from: { deviceId: any; portId: any }; to: { deviceId: any; portId: any } }>,
): { portId: any } | { cabled: true } | null {
  const net = (block.ports || []).filter((p) => NETWORK_PORT.test(p.label || "") || (p.signal === "cat6" && /(lan|ethernet|rj45|poe)/i.test(p.label || "")));
  if (!net.length) return null;
  const used = (p: any) => connections.some((c) =>
    (c.from.deviceId === block.id && c.from.portId === p.id) || (c.to.deviceId === block.id && c.to.portId === p.id));
  if (net.some(used)) return { cabled: true };
  return { portId: net[0].id };
}
