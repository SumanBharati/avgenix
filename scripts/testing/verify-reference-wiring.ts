// Unit checks for lib/wiring (Logitech reference wiring) — no browser, no AI.
// Usage: npx tsx scripts/testing/verify-reference-wiring.ts

import { planReferenceWiring, applyReferenceWiring, classifyUnit, type WiringUnit } from "../../lib/wiring/reference-wiring";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
};
const U = (itemId: string, label: string, mfr: string | null = null, model: string | null = null, category = "other"): WiringUnit =>
  ({ itemId, label, name: label, mfr, model, category });
const has = (plan: ReturnType<typeof planReferenceWiring>, from: string, fromPort: string, to: string, toPort: string) =>
  plan.links.some((l) => l.fromItemId === from && l.fromPort === fromPort && l.toItemId === to && l.toPort === toPort);

// --- Classification ---------------------------------------------------------
check("Rally Bar → rallyBar", classifyUnit(U("x", "Video Bar", "Logitech", "Rally Bar")) === "rallyBar");
check("Rally Bar Mini → rallyBar", classifyUnit(U("x", "Video Bar", "Logitech", "Rally Bar Mini")) === "rallyBar");
check("Rally Bar Huddle → rallyBarHuddle", classifyUnit(U("x", "Video Bar", "Logitech", "Rally Bar Huddle")) === "rallyBarHuddle");
check("Tap IP → tapIp", classifyUnit(U("x", "Touch Controller", "Logitech", "Tap IP")) === "tapIp");
check("Tap with CAT5e Extender → tap", classifyUnit(U("x", "Touch Controller", "Logitech", "Tap With CAT5e Extender")) === "tap");
check("Tap labelled 'Table Touch Controller' → tap", classifyUnit(U("x", "Table Touch Controller", "Logitech", "Tap")) === "tap");
check("Tap Table Mount → nothing", classifyUnit(U("x", "Tap Mount", "Logitech", "Table Mount for Logitech Tap")) === null);
check("Wall Mount for Video Bars → nothing", classifyUnit(U("x", "Video Bar Mount", "Logitech", "Wall Mount for Video Bars")) === null);
check("Mic Pod Extension Cable → nothing", classifyUnit(U("x", "Mic Extension", "Logitech", "Mic Pod Extension Cable")) === null);
check("Mic Pod Hub → micPodHub", classifyUnit(U("x", "Mic Hub", "Logitech", "Mic Pod Hub")) === "micPodHub");
check("Rally Mic Pod → micPod", classifyUnit(U("x", "Table Mic", "Logitech", "Rally Mic Pod")) === "micPod");
check("Rally Plus - Display Hub → displayHub", classifyUnit(U("x", "Display Hub", "Logitech", "Rally Plus - Display Hub")) === "displayHub");
check("Generic display → display", classifyUnit(U("x", "Front Wall Display", null, null, "display")) === "display");
check("Display Wall Mount → nothing", classifyUnit(U("x", "Display Wall Mount", "Chief", "XTM1U")) === null);
check("Non-Logitech 'Tap' doesn't match", classifyUnit(U("x", "Tap", "Acme", "Tap")) === null);
check("PoE Network Switch → network", classifyUnit(U("x", "PoE Network Switch")) === "network");
check("Presentation Switcher isn't network", classifyUnit(U("x", "Presentation Switcher", "Crestron", "HD-PS622")) !== "network");

// --- Android Rally Bar: 2 displays, Tap, Sight, 6 Mic Pods -----------------
{
  const units = [
    U("bar", "Video Bar", "Logitech", "Rally Bar"),
    U("d1", "Front Wall Display 1", "Samsung", "QM75", "display"),
    U("d2", "Front Wall Display 2", "Samsung", "QM75", "display"),
    U("tap", "Touch Controller", "Logitech", "Tap With CAT5e Extender"),
    U("sight", "Table Camera", "Logitech", "Sight"),
    ...[1, 2, 3, 4, 5, 6].map((i) => U(`pod${i}`, "Table Microphone", "Logitech", "Rally Mic Pod")),
    U("sw", "PoE Network Switch"),
  ];
  const plan = planReferenceWiring(units, "Microsoft Teams Room. Mode: Android (Teams Rooms on Android)");
  check("android: host rallyBar, mode android", plan.host === "rallyBar" && plan.mode === "android", `${plan.host}/${plan.mode}`);
  check("android: HDMI-OUT 1 → display 1", has(plan, "bar", "HDMI-OUT 1", "d1", "HDMI In"));
  check("android: HDMI-OUT 2 → display 2", has(plan, "bar", "HDMI-OUT 2", "d2", "HDMI In"));
  check("android: Tap → bar USB-A1 via CAT5e kit", plan.links.some((l) => l.fromItemId === "tap" && l.toItemId === "bar" && /CAT5e/.test(l.reason)));
  check("android: Sight → bar USB-A2 (p.75)", has(plan, "sight", "CAT6a (to Sight dongle)", "bar", "USB-A2"));
  check("android: Mic Pods go to Sight, not the bar", has(plan, "pod1", "Mic Pod out", "sight", "Mic Pod (dongle)") && !plan.links.some((l) => l.toItemId === "bar" && l.toPort === "MIC POD"));
  check("android: Mic Pods daisy-chain", has(plan, "pod2", "Mic Pod out", "pod1", "Daisy-chain in"));
  check("android: bar ETHERNET not cabled to the AV switch (it's Client LAN)", !plan.links.some((l) => l.fromItemId === "bar" && l.fromPort === "ETHERNET"));
  check("android: Sight PoE+ still goes to the switch", has(plan, "sight", "PoE+ LAN", "sw", "LAN"));
  check("android: warns 6 pods > 3 with Sight", plan.warnings.some((w) => /at most 3 Mic Pods with a Sight/.test(w)), plan.warnings.join(" | "));
  check("android: no PoE+ warning when a switch exists", !plan.warnings.some((w) => /PoE\+/.test(w)));
  check("android: guide ports for the bar", (plan.portsByItemId.get("bar") || []).some((p) => p.label === "MIC POD"));

  // Enforcement on a canvas where the AI wired things differently.
  const devices = [
    { id: 1, itemId: "bar", ports: [{ id: "1-p0", label: "HDMI-OUT 1", signal: "hdmi", dir: "out" }, { id: "1-p1", label: "HDMI-OUT 2", signal: "hdmi", dir: "out" }] },
    { id: 2, itemId: "d1", ports: [{ id: "2-p0", label: "HDMI Input", signal: "hdmi", dir: "in" }] },
    { id: 3, itemId: "d2", ports: [{ id: "3-p0", label: "HDMI Input", signal: "hdmi", dir: "in" }] },
  ];
  // AI crossed the displays: HDMI-OUT 1 → display 2.
  const ai = [{ id: "ai1", from: { deviceId: 1, portId: "1-p0" }, to: { deviceId: 3, portId: "3-p0" }, signal: "hdmi" }];
  const res = applyReferenceWiring(devices, ai, plan.links.filter((l) => ["d1", "d2"].includes(l.toItemId)));
  check("enforce: AI's crossed cable replaced", !res.connections.some((c) => c.id === "ai1"));
  check("enforce: HDMI-OUT 1 → display 1", res.connections.some((c) => c.from.portId === "1-p0" && c.to.portId === "2-p0"));
  check("enforce: HDMI-OUT 2 → display 2", res.connections.some((c) => c.from.portId === "1-p1" && c.to.portId === "3-p0"));
  check("enforce: 2 applied", res.applied === 2, String(res.applied));
  check("enforce: inputs not mutated", devices[0].ports.length === 2 && ai.length === 1);
}

// --- Laptop sharing: bar HDMI-IN by default, Tap HDMI ingest when asked ---
{
  const units = [U("bar", "Video Bar", "Logitech", "Rally Bar"), U("tap", "Touch Controller", "Logitech", "Tap"), U("lap", "Table Connectivity Cubby")];
  const byDefault = planReferenceWiring(units, "Teams Rooms on Android");
  check("share: laptop → bar HDMI-IN by default (p.9)", has(byDefault, "lap", "HDMI Out", "bar", "HDMI-IN") && !has(byDefault, "lap", "HDMI Out", "tap", "HDMI In"));
  const viaTap = planReferenceWiring(units, "Teams Rooms on Android\nHow should the table HDMI connection reach the system? HDMI into the Tap");
  check("share: 'HDMI into the Tap' → Tap HDMI ingest (p.10)", has(viaTap, "lap", "HDMI Out", "tap", "HDMI In") && !has(viaTap, "lap", "HDMI Out", "bar", "HDMI-IN"));
}

// --- PC mode Rally Bar with Swytch ----------------------------------------
{
  const units = [
    U("bar", "Video Bar", "Logitech", "Rally Bar"),
    U("pc", "Teams Room PC", "Lenovo", "ThinkSmart Core"),
    U("d1", "Display", "LG", "86UR", "display"),
    U("tap", "Touch Controller", "Logitech", "Tap"),
    U("sw", "BYOD Switch", "Logitech", "Swytch"),
    U("lap", "Laptop Connection"),
  ];
  const plan = planReferenceWiring(units, "PC mode with a dedicated Teams Rooms PC");
  check("pc: mode pc", plan.mode === "pc", String(plan.mode));
  check("pc: compute HDMI 1 → Swytch HDMI PC", has(plan, "pc", "HDMI 1", "sw", "HDMI PC"));
  check("pc: Swytch HDMI TV → display", has(plan, "sw", "HDMI TV", "d1", "HDMI In"));
  check("pc: no direct compute → display 1 when Swytch present", !has(plan, "pc", "HDMI 1", "d1", "HDMI In"));
  check("pc: bar USB-C → Swytch USB-A A/V", has(plan, "bar", "USB-C", "sw", "USB-A A/V"));
  check("pc: Tap → compute", plan.links.some((l) => l.fromItemId === "tap" && l.toItemId === "pc"));
}

// --- BYOD MeetUp 2 ---------------------------------------------------------
{
  const units = [U("mu", "Video Bar", "Logitech", "MeetUp 2"), U("d1", "Display", null, null, "display"), U("lap", "Table HDMI Input")];
  const plan = planReferenceWiring(units, "BYOD only, laptops bring their own Zoom/Teams");
  check("byod: host meetup2 mode byod", plan.host === "meetup2" && plan.mode === "byod", `${plan.host}/${plan.mode}`);
  check("byod: laptop HDMI → MeetUp 2 HDMI IN", has(plan, "lap", "HDMI Out", "mu", "HDMI IN"));
  check("byod: MeetUp 2 USB-C → laptop", has(plan, "mu", "USB-C", "lap", "USB In"));
}

// --- Rally Plus parts with RoomMate (Android) -----------------------------
{
  const units = [
    U("rm", "Room Compute", "Logitech", "RoomMate"),
    U("dh", "Display Hub", "Logitech", "Rally Plus - Display Hub"),
    U("th", "Table Hub", "Logitech", "Rally Plus - Table Hub"),
    U("cam", "PTZ Camera", "Logitech", "Rally Camera"),
    U("spk1", "Speaker", "Logitech", "Rally Speaker"),
    U("spk2", "Speaker", "Logitech", "Rally Speaker"),
    U("d1", "Display", null, null, "display"),
    U("pod1", "Mic", "Logitech", "Rally Mic Pod"),
  ];
  const plan = planReferenceWiring(units, "Zoom Rooms appliance");
  check("rally plus: host displayHub, android", plan.host === "displayHub" && plan.mode === "android", `${plan.host}/${plan.mode}`);
  check("rally plus: RoomMate HDMI-OUT 1 → display", has(plan, "rm", "HDMI-OUT 1", "d1", "HDMI In"));
  check("rally plus: Display Hub USB → RoomMate", has(plan, "dh", "USB (to host)", "rm", "USB-A 1"));
  check("rally plus: camera → Display Hub", has(plan, "cam", "USB-C", "dh", "Camera USB-C"));
  check("rally plus: speakers L/R", has(plan, "dh", "Speaker L", "spk1", "Speaker In") && has(plan, "dh", "Speaker R", "spk2", "Speaker In"));
  check("rally plus: Table Hub ↔ Display Hub", has(plan, "th", "Display Hub link", "dh", "Table Hub link"));
  check("rally plus: Mic Pod → Table Hub", has(plan, "pod1", "Mic Pod out", "th", "Mic Pod"));
}

// --- No Logitech → no plan -------------------------------------------------
{
  const plan = planReferenceWiring([U("a", "Display", "Samsung", "QM75", "display"), U("b", "Codec", "Cisco", "Room Kit Pro")], "");
  check("non-Logitech design: no reference wiring", plan.host === null && plan.links.length === 0);
}

console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
