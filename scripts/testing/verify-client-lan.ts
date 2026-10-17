// Unit checks for lib/wiring/internet.ts — which devices get a "Client LAN" flag.
// Usage: npx tsx scripts/testing/verify-client-lan.ts

import { clientLanLabel, pickNetworkPort, CLIENT_LAN, CLIENT_LAN_POE } from "../../lib/wiring/internet";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
};
const is = (label: string, unit: { mfr?: string; model?: string; label: string }, mode: any, ctx: string, want: string | null) => {
  const got = clientLanLabel(unit, mode, ctx);
  check(label, got === want, `got ${JSON.stringify(got)}`);
};

// Room compute
is("MTR compute", { label: "MTR Compute" }, null, "", CLIENT_LAN);
is("Zoom Rooms compute", { label: "Zoom Rooms Compute" }, null, "", CLIENT_LAN);
is("Teams Room PC", { label: "Teams Room PC" }, null, "", CLIENT_LAN);
is("Lenovo ThinkSmart Core", { mfr: "Lenovo", model: "ThinkSmart Core", label: "Room PC" }, null, "", CLIENT_LAN);
is("Logitech RoomMate", { mfr: "Logitech", model: "RoomMate", label: "Room Compute" }, null, "", CLIENT_LAN);

// Appliance bars
is("Rally Bar, Android mode", { mfr: "Logitech", model: "Rally Bar", label: "Video Bar" }, "android", "", CLIENT_LAN);
is("Rally Bar, PC mode → no flag (compute gets it)", { mfr: "Logitech", model: "Rally Bar", label: "Video Bar" }, "pc", "", null);
is("Rally Bar, BYOD mode → no flag", { mfr: "Logitech", model: "Rally Bar", label: "Video Bar" }, "byod", "", null);
is("Rally Bar Huddle, mode unknown, no PC/BYOD text → appliance", { mfr: "Logitech", model: "Rally Bar Huddle", label: "Video Bar" }, null, "", CLIENT_LAN);
is("Neat Bar Pro", { mfr: "Neat", model: "Bar Pro", label: "Video Bar" }, null, "", CLIENT_LAN);
is("Neat Board", { mfr: "Neat", model: "Board 50", label: "Video Board" }, null, "", CLIENT_LAN);
is("Poly Studio X50", { mfr: "Poly", model: "Studio X50", label: "Video Bar" }, null, "", CLIENT_LAN);
is("Cisco Room Bar", { mfr: "Cisco", model: "Room Bar", label: "Video Bar" }, null, "", CLIENT_LAN);
is("Yealink MeetingBar A30", { mfr: "Yealink", model: "MeetingBar A30", label: "Video Bar" }, null, "", CLIENT_LAN);
is("Generic video bar + appliance scope", { label: "Video Conferencing Bar" }, null, "Teams Rooms on Android, all-in-one bar", CLIENT_LAN);
is("Generic video bar + PC mode scope", { label: "Video Conferencing Bar" }, null, "Teams Rooms with a dedicated Teams Rooms PC", null);
is("Generic video bar, nothing said", { label: "Video Bar" }, null, "Conference room", null);

// Panels / controllers
is("Tap IP → PoE", { mfr: "Logitech", model: "Tap IP", label: "Touch Controller" }, null, "", CLIENT_LAN_POE);
is("Tap Scheduler → PoE", { mfr: "Logitech", model: "Tap Scheduler", label: "Scheduling Panel" }, null, "", CLIENT_LAN_POE);
is("Neat Pad → PoE", { mfr: "Neat", model: "Pad", label: "Room Controller" }, null, "", CLIENT_LAN_POE);
is("Generic scheduling panel → PoE", { label: "Wall Mounted Scheduling Panel" }, null, "", CLIENT_LAN_POE);

// Not on the client network
is("Logitech Tap (USB)", { mfr: "Logitech", model: "Tap", label: "Touch Controller" }, "android", "", null);
is("MeetUp (USB)", { mfr: "Logitech", model: "MeetUp", label: "Video Bar" }, null, "", null);
is("Display", { mfr: "Samsung", model: "QM85R", label: "Front Wall Display" }, null, "", null);
is("Wall mount for video bars", { mfr: "Logitech", model: "Wall Mount for Video Bars", label: "Video Bar Mount" }, null, "", null);
is("Crestron presentation switcher", { mfr: "Crestron", model: "HD-PS622", label: "Presentation Switcher" }, null, "", null);

// Port choice
const block = { id: 7, ports: [{ id: "7-p0", label: "HDMI 1", signal: "hdmi" }, { id: "7-p1", label: "Ethernet", signal: "cat6" }] };
const free = pickNetworkPort(block, []);
check("free Ethernet port picked", !!free && "portId" in free && free.portId === "7-p1");
const cabled = pickNetworkPort(block, [{ from: { deviceId: 7, portId: "7-p1" }, to: { deviceId: 9, portId: "9-p0" } }]);
check("cabled Ethernet → no flag", !!cabled && "cabled" in cabled);
check("no network port → null (caller adds one)", pickNetworkPort({ id: 8, ports: [{ id: "8-p0", label: "HDMI", signal: "hdmi" }] }, []) === null);
check("'USB (CAT5e extender)' is not a network port", pickNetworkPort({ id: 9, ports: [{ id: "9-p0", label: "USB (CAT5e extender)", signal: "usb" }] }, []) === null);

console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
