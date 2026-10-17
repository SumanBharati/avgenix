// Logitech reference wiring, transcribed from Logitech's "Wiring Diagrams"
// guide (19 August 2026). Page numbers below refer to that PDF.
//
// Two kinds of knowledge live here:
//   ROLES  — how to recognise each Logitech device in a design, and its real
//            port set as drawn in the guide (the library's own port data for
//            most Logitech products is a single placeholder port).
//   HOSTS  — per system "host" (the unit everything plugs into) and operating
//            mode, the cables the guide draws between roles.
// lib/wiring/reference-wiring.ts turns these into concrete cables for a
// design. Edit here when Logitech publishes a new guide.

import type { SignalTypeId } from "@/lib/signal-flow-types";

export const GUIDE = "Logitech Wiring Diagrams (19 Aug 2026)";

export type Mode = "android" | "pc" | "byod";

export interface RolePort {
  label: string;
  signal: SignalTypeId;
  dir: "in" | "out";
}

export interface RoleDef {
  /** Matched against "manufacturer model label name" of a designed unit. */
  match: RegExp;
  /** Only Logitech-made roles require a Logitech manufacturer to match. */
  logitech: boolean;
  /** The device's real ports per the guide; omitted for generic roles. */
  ports?: RolePort[];
}

const P = (label: string, signal: SignalTypeId, dir: "in" | "out"): RolePort => ({ label, signal, dir });

// Order matters: the first matching role wins, so specific names come first.
export const ROLES: Record<string, RoleDef> = {
  rallyBarHuddle: {
    match: /rally bar huddle/i, logitech: true,
    ports: [P("HDMI-TV", "hdmi", "out"), P("HDMI-IN", "hdmi", "in"), P("USB-C", "usb", "out"), P("USB-A", "usb", "in"), P("ETHERNET", "cat6", "out")],
  },
  rallyBar: {
    // Rally Bar and Rally Bar Mini share the same rear panel (p.4, p.8).
    match: /rally bar(?! huddle)/i, logitech: true,
    ports: [
      P("HDMI-OUT 1", "hdmi", "out"), P("HDMI-OUT 2", "hdmi", "out"), P("HDMI-IN", "hdmi", "in"),
      P("USB-C", "usb", "out"), P("USB-A1", "usb", "in"), P("USB-A2", "usb", "in"), P("USB-A3", "usb", "in"),
      P("MIC POD", "proprietary", "in"), P("ETHERNET", "cat6", "out"),
    ],
  },
  rallyBoard: {
    match: /rally board/i, logitech: true,
    ports: [
      P("HDMI-TV", "hdmi", "out"), P("HDMI-IN", "hdmi", "in"), P("USB-C", "usb", "out"),
      P("USB-A 1", "usb", "in"), P("USB-A 2", "usb", "in"), P("USB-A 3", "usb", "in"),
      P("ETHERNET", "cat6", "out"), P("LINE OUT", "analog", "out"),
    ],
  },
  meetup2: {
    match: /meetup 2/i, logitech: true,
    ports: [P("HDMI TV", "hdmi", "out"), P("HDMI IN", "hdmi", "in"), P("USB-C", "usb", "out"), P("Ethernet", "cat6", "out")],
  },
  meetup: { match: /meetup(?! 2)(?! mic)(?!.*mount)/i, logitech: true, ports: [P("USB-C", "usb", "out")] },
  roomMate: {
    match: /roommate/i, logitech: true,
    ports: [
      P("HDMI-OUT 1", "hdmi", "out"), P("HDMI-OUT 2", "hdmi", "out"), P("HDMI-IN", "hdmi", "in"),
      P("USB-A 1", "usb", "in"), P("USB-A 2", "usb", "in"), P("USB-A 3", "usb", "in"), P("ETHERNET", "cat6", "out"),
    ],
  },
  displayHub: {
    match: /display hub/i, logitech: true,
    ports: [
      P("HDMI OUT1", "hdmi", "out"), P("HDMI OUT2", "hdmi", "out"), P("Speaker L", "speaker", "out"), P("Speaker R", "speaker", "out"),
      P("Camera USB-C", "usb", "in"), P("USB (to host)", "usb", "out"), P("Table Hub link", "cat6", "in"),
    ],
  },
  tableHub: {
    match: /table hub/i, logitech: true,
    ports: [
      P("Display Hub link", "cat6", "out"), P("Mic Pod", "proprietary", "in"),
      P("HDMI IN 1", "hdmi", "in"), P("HDMI IN 2", "hdmi", "in"), P("USB (laptop)", "usb", "out"),
    ],
  },
  rallyPlus: {
    // The Rally / Rally Plus kit as a single line item rather than its parts:
    // the Display Hub and Table Hub connections, folded onto one block.
    match: /\brally( plus)?\b(?! (bar|board|camera|mic|speaker|ai|mounting))/i, logitech: true,
    ports: [
      P("Display Hub HDMI OUT1", "hdmi", "out"), P("Display Hub HDMI OUT2", "hdmi", "out"), P("Display Hub USB (to host)", "usb", "out"),
      P("Table Hub HDMI IN", "hdmi", "in"), P("Table Hub USB (laptop)", "usb", "out"), P("Table Hub Mic Pod", "proprietary", "in"),
    ],
  },
  rallyCamera: { match: /rally (ai )?camera(?!.*(mount|kit))/i, logitech: true, ports: [P("USB-C", "usb", "out")] },
  rallySpeaker: { match: /rally speaker/i, logitech: true, ports: [P("Speaker In", "speaker", "in")] },
  tapIp: { match: /tap ip/i, logitech: true, ports: [P("Ethernet (PoE)", "cat6", "out")] },
  tapScheduler: { match: /tap scheduler(?!.*mount)/i, logitech: true, ports: [P("Ethernet (PoE)", "cat6", "out")] },
  tap: {
    // Mounts ("Tap Table Mount", ...) are filtered out as accessories before
    // matching, so only Tap IP / Tap Scheduler need excluding here.
    match: /\btap\b(?! (ip|scheduler))/i, logitech: true,
    ports: [P("USB (CAT5e extender)", "usb", "out"), P("HDMI In", "hdmi", "in")],
  },
  micPodHub: {
    match: /mic pod hub/i, logitech: true,
    ports: [P("Out", "proprietary", "out"), P("In 1", "proprietary", "in"), P("In 2", "proprietary", "in"), P("In 3", "proprietary", "in")],
  },
  micPod: {
    match: /mic pod(?! (hub|mount|extension|cat|pendant))(?!.*mount)/i, logitech: true,
    ports: [P("Mic Pod out", "proprietary", "out"), P("Daisy-chain in", "proprietary", "in")],
  },
  sight: {
    match: /\bsight\b/i, logitech: true,
    ports: [P("CAT6a (to Sight dongle)", "usb", "out"), P("PoE+ LAN", "cat6", "out"), P("Mic Pod (dongle)", "proprietary", "in")],
  },
  scribe: { match: /\bscribe\b(?!.*(mount|latch|polarizer|button))/i, logitech: true, ports: [P("CAT (USB extender)", "usb", "out")] },
  swytch: {
    match: /swytch/i, logitech: true,
    ports: [
      P("HDMI TV", "hdmi", "out"), P("HDMI PC", "hdmi", "in"), P("USB-C PC", "usb", "out"),
      P("USB-A A/V", "usb", "in"), P("Laptop (Swytch Extender)", "usb", "in"),
    ],
  },
  extend: {
    match: /\bextend\b/i, logitech: true,
    ports: [P("Laptop USB-C (TX)", "usb", "in"), P("HDMI (RX)", "hdmi", "out"), P("USB-A (RX)", "usb", "in")],
  },

  // Generic roles — anything in the design that plays this part, any brand.
  touchDisplay: { match: /touch ?(screen|display)|interactive (display|flat panel)/i, logitech: false },
  display: { match: /display|\btv\b|monitor|flat panel/i, logitech: false },
  compute: { match: /\bcompute\b|room(s)? pc|mini pc|\bnuc\b|thinksmart core|lenovo core|teams rooms? (on windows|pc)|\bmtr pc\b/i, logitech: false },
  laptop: { match: /laptop|byod|table (hdmi|connectivity|input|box)|hdmi input|wired (share|input)|usb-c input/i, logitech: false },
  network: { match: /(network|poe\+?|ethernet|lan)[^,]*switch/i, logitech: false },
  dsp: { match: /\bdsp\b|audio processor/i, logitech: false },
};

/** A cable the guide draws. Role refs: "display#2" = second display. */
export interface Link {
  from: [string, string];
  to: [string, string];
  signal: SignalTypeId;
  page: number;
  via?: string;
  /** Skip this cable when any of these roles is in the design. */
  unless?: string[];
  /** Only when the design's text (scope / answers) matches. */
  when?: RegExp;
  /** Skip when the design's text matches. */
  unlessText?: RegExp;
}

// "HDMI into the Tap" — laptop content shared through Tap's HDMI ingest
// (p.10, p.25, p.106) rather than the bar's own HDMI-IN.
const TAP_INGEST = /hdmi[^.\n]*\b(in(to)?|via|through|at)\b[^.\n]*\btap\b|\btap\b[^.\n]*hdmi (ingest|input|in)\b|hdmi ingest/i;

const L = (from: string, fromPort: string, to: string, toPort: string, signal: SignalTypeId, page: number, extra: Partial<Link> = {}): Link =>
  ({ from: [from, fromPort], to: [to, toPort], signal, page, ...extra });

const TAP_KIT = "Tap CAT5e kit (USB-to-CAT extender + power)";

// Cables shared by every Rally Bar mode.
const RALLY_BAR_COMMON: Link[] = [
  L("sight", "CAT6a (to Sight dongle)", "rallyBar", "USB-A2", "usb", 75, { via: "Sight dongle (USB-A + MIC POD leads), CAT6a" }),
  L("sight", "PoE+ LAN", "network", "LAN", "cat6", 70, { via: "PoE+ (802.3at) switch port or active injector" }),
  L("scribe", "CAT (USB extender)", "rallyBar", "USB-A3", "usb", 66, { via: "USB-to-CAT extender + PoE injector" }),
  L("touchDisplay", "USB Touch", "rallyBar", "USB-A1", "usb", 28, { unless: ["tap"] }),
];

// Network: the guide runs each bar's / compute's / RoomMate's ETHERNET and
// Tap IP to the building's network jack — the client LAN they need for
// Teams/Zoom — never to an AV switch. Those connections are therefore not
// cables here: lib/wiring/internet.ts marks them with "Client LAN" flags.
// Only AV peripherals that merely need power/PoE (Sight) go to a switch.

export interface HostDef {
  /** Role key of the host device. */
  role: string;
  modes: Partial<Record<Mode, Link[]>>;
  /** Where Mic Pods / Mic Pod Hubs plug in, per mode (Sight takes over when present). */
  micTarget?: [string, string];
}

export const HOSTS: HostDef[] = [
  {
    role: "rallyBar",
    micTarget: ["rallyBar", "MIC POD"],
    modes: {
      android: [
        L("rallyBar", "HDMI-OUT 1", "display#1", "HDMI In", "hdmi", 8),
        L("rallyBar", "HDMI-OUT 2", "display#2", "HDMI In", "hdmi", 8),
        L("tap", "USB (CAT5e extender)", "rallyBar", "USB-A1", "usb", 8, { via: TAP_KIT }),
        L("swytch", "HDMI TV", "rallyBar", "HDMI-IN", "hdmi", 53),
        L("rallyBar", "USB-C", "swytch", "USB-A A/V", "usb", 53),
        L("laptop", "USB-C Out", "swytch", "Laptop (Swytch Extender)", "usb", 53, { via: "Swytch Extender (USB 3.x)" }),
        L("extend", "HDMI (RX)", "rallyBar", "HDMI-IN", "hdmi", 97, { unless: ["swytch"] }),
        L("rallyBar", "USB-C", "extend", "USB-A (RX)", "usb", 97, { unless: ["swytch"] }),
        L("laptop", "USB-C Out", "extend", "Laptop USB-C (TX)", "usb", 97, { via: "Extend TX → CAT → RX", unless: ["swytch"] }),
        L("laptop", "HDMI Out", "tap", "HDMI In", "hdmi", 10, { unless: ["swytch", "extend"], when: TAP_INGEST }),
        L("laptop", "HDMI Out", "rallyBar", "HDMI-IN", "hdmi", 9, { unless: ["swytch", "extend"], unlessText: TAP_INGEST }),
        ...RALLY_BAR_COMMON,
      ],
      pc: [
        L("compute", "HDMI 1", "swytch", "HDMI PC", "hdmi", 46),
        L("swytch", "HDMI TV", "display#1", "HDMI In", "hdmi", 46),
        L("swytch", "USB-C PC", "compute", "USB 1", "usb", 46),
        L("rallyBar", "USB-C", "swytch", "USB-A A/V", "usb", 46),
        L("laptop", "USB-C Out", "swytch", "Laptop (Swytch Extender)", "usb", 46, { via: "Swytch Extender (USB 3.x)" }),
        L("compute", "HDMI 1", "display#1", "HDMI In", "hdmi", 22, { unless: ["swytch"] }),
        L("compute", "HDMI 2", "display#2", "HDMI In", "hdmi", 22),
        L("rallyBar", "USB-C", "compute", "USB 1", "usb", 22, { unless: ["swytch"] }),
        L("tap", "USB (CAT5e extender)", "compute", "USB 2", "usb", 22, { via: TAP_KIT }),
        L("laptop", "HDMI Out", "tap", "HDMI In", "hdmi", 25, { unless: ["swytch"] }),
        ...RALLY_BAR_COMMON,
      ],
      byod: [
        L("rallyBar", "HDMI-OUT 1", "display#1", "HDMI In", "hdmi", 17),
        L("rallyBar", "HDMI-OUT 2", "display#2", "HDMI In", "hdmi", 19),
        L("swytch", "HDMI TV", "rallyBar", "HDMI-IN", "hdmi", 54),
        L("rallyBar", "USB-C", "swytch", "USB-A A/V", "usb", 54),
        L("laptop", "USB-C Out", "swytch", "Laptop (Swytch Extender)", "usb", 54, { via: "Swytch Extender (USB 3.x)" }),
        L("laptop", "HDMI Out", "rallyBar", "HDMI-IN", "hdmi", 17, { unless: ["swytch"] }),
        L("rallyBar", "USB-C", "laptop", "USB In", "usb", 17, { unless: ["swytch"] }),
        ...RALLY_BAR_COMMON,
      ],
    },
  },
  {
    role: "rallyBarHuddle",
    modes: {
      android: [
        L("rallyBarHuddle", "HDMI-TV", "display#1", "HDMI In", "hdmi", 85),
        L("tap", "USB (CAT5e extender)", "rallyBarHuddle", "USB-A", "usb", 85, { via: TAP_KIT }),
        L("touchDisplay", "USB Touch", "rallyBarHuddle", "USB-A", "usb", 35, { unless: ["tap"] }),
        L("extend", "HDMI (RX)", "rallyBarHuddle", "HDMI-IN", "hdmi", 97),
        L("rallyBarHuddle", "USB-C", "extend", "USB-A (RX)", "usb", 97),
        L("laptop", "USB-C Out", "extend", "Laptop USB-C (TX)", "usb", 97, { via: "Extend TX → CAT → RX" }),
        L("laptop", "HDMI Out", "rallyBarHuddle", "HDMI-IN", "hdmi", 86, { unless: ["extend"] }),
      ],
      pc: [
        L("compute", "HDMI 1", "display#1", "HDMI In", "hdmi", 90),
        L("rallyBarHuddle", "USB-C", "compute", "USB 1", "usb", 90),
        L("tap", "USB (CAT5e extender)", "compute", "USB 2", "usb", 90, { via: TAP_KIT }),
      ],
      byod: [
        L("rallyBarHuddle", "HDMI-TV", "display#1", "HDMI In", "hdmi", 88),
        L("laptop", "HDMI Out", "rallyBarHuddle", "HDMI-IN", "hdmi", 88),
        L("rallyBarHuddle", "USB-C", "laptop", "USB In", "usb", 88),
      ],
    },
  },
  {
    // Rally / Rally Plus as separate Display Hub + Table Hub units.
    role: "displayHub",
    micTarget: ["tableHub", "Mic Pod"],
    modes: {
      pc: [
        L("compute", "HDMI 1", "display#1", "HDMI In", "hdmi", 38),
        L("compute", "HDMI 2", "display#2", "HDMI In", "hdmi", 38),
        L("displayHub", "USB (to host)", "compute", "USB 1", "usb", 38),
        L("tap", "USB (CAT5e extender)", "compute", "USB 2", "usb", 38, { via: TAP_KIT }),
        L("laptop", "HDMI Out", "tap", "HDMI In", "hdmi", 38),
      ],
      android: [
        L("roomMate", "HDMI-OUT 1", "display#1", "HDMI In", "hdmi", 58),
        L("roomMate", "HDMI-OUT 2", "display#2", "HDMI In", "hdmi", 58),
        L("displayHub", "USB (to host)", "roomMate", "USB-A 1", "usb", 58),
        L("tap", "USB (CAT5e extender)", "roomMate", "USB-A 2", "usb", 58, { via: TAP_KIT }),
        L("laptop", "HDMI Out", "roomMate", "HDMI-IN", "hdmi", 59),
      ],
      byod: [
        L("displayHub", "HDMI OUT1", "display#1", "HDMI In", "hdmi", 41),
        L("laptop", "HDMI Out", "tableHub", "HDMI IN 1", "hdmi", 41),
        L("tableHub", "USB (laptop)", "laptop", "USB In", "usb", 41),
      ],
    },
  },
  {
    // Rally / Rally Plus entered as one kit line item.
    role: "rallyPlus",
    micTarget: ["rallyPlus", "Table Hub Mic Pod"],
    modes: {
      pc: [
        L("compute", "HDMI 1", "display#1", "HDMI In", "hdmi", 38),
        L("compute", "HDMI 2", "display#2", "HDMI In", "hdmi", 38),
        L("rallyPlus", "Display Hub USB (to host)", "compute", "USB 1", "usb", 38),
        L("tap", "USB (CAT5e extender)", "compute", "USB 2", "usb", 38, { via: TAP_KIT }),
        L("laptop", "HDMI Out", "tap", "HDMI In", "hdmi", 38),
      ],
      android: [
        L("roomMate", "HDMI-OUT 1", "display#1", "HDMI In", "hdmi", 58),
        L("roomMate", "HDMI-OUT 2", "display#2", "HDMI In", "hdmi", 58),
        L("rallyPlus", "Display Hub USB (to host)", "roomMate", "USB-A 1", "usb", 58),
        L("tap", "USB (CAT5e extender)", "roomMate", "USB-A 2", "usb", 58, { via: TAP_KIT }),
        L("laptop", "HDMI Out", "roomMate", "HDMI-IN", "hdmi", 59),
      ],
      byod: [
        L("rallyPlus", "Display Hub HDMI OUT1", "display#1", "HDMI In", "hdmi", 41),
        L("laptop", "HDMI Out", "rallyPlus", "Table Hub HDMI IN", "hdmi", 41),
        L("rallyPlus", "Table Hub USB (laptop)", "laptop", "USB In", "usb", 41),
      ],
    },
  },
  {
    role: "roomMate",
    modes: {
      android: [
        L("roomMate", "HDMI-OUT 1", "display#1", "HDMI In", "hdmi", 56),
        L("roomMate", "HDMI-OUT 2", "display#2", "HDMI In", "hdmi", 56),
        L("meetup", "USB-C", "roomMate", "USB-A 1", "usb", 56),
        L("meetup2", "USB-C", "roomMate", "USB-A 1", "usb", 56),
        L("rallyCamera", "USB-C", "roomMate", "USB-A 1", "usb", 60, { via: "Rally Camera power splitter", unless: ["meetup", "meetup2"] }),
        L("tap", "USB (CAT5e extender)", "roomMate", "USB-A 2", "usb", 56, { via: TAP_KIT }),
        L("dsp", "USB", "roomMate", "USB-A 3", "usb", 60),
        L("laptop", "HDMI Out", "roomMate", "HDMI-IN", "hdmi", 57),
      ],
    },
  },
  {
    role: "meetup2",
    modes: {
      pc: [
        L("compute", "HDMI 1", "display#1", "HDMI In", "hdmi", 92),
        L("compute", "HDMI 2", "display#2", "HDMI In", "hdmi", 92),
        L("meetup2", "USB-C", "compute", "USB 1", "usb", 92),
        L("tap", "USB (CAT5e extender)", "compute", "USB 2", "usb", 92, { via: TAP_KIT }),
      ],
      byod: [
        L("meetup2", "HDMI TV", "display#1", "HDMI In", "hdmi", 93),
        L("laptop", "HDMI Out", "meetup2", "HDMI IN", "hdmi", 93, { unless: ["extend"] }),
        L("meetup2", "USB-C", "laptop", "USB In", "usb", 93, { unless: ["extend"] }),
        L("extend", "HDMI (RX)", "display#1", "HDMI In", "hdmi", 98),
        L("meetup2", "USB-C", "extend", "USB-A (RX)", "usb", 98),
        L("laptop", "USB-C Out", "extend", "Laptop USB-C (TX)", "usb", 98, { via: "Extend TX → CAT → RX" }),
      ],
    },
  },
  {
    role: "rallyBoard",
    modes: {
      android: [
        L("tap", "USB (CAT5e extender)", "rallyBoard", "USB-A 1", "usb", 105, { via: TAP_KIT }),
        L("laptop", "HDMI Out", "tap", "HDMI In", "hdmi", 106),
        L("rallyCamera", "USB-C", "rallyBoard", "USB-A 2", "usb", 107, { via: "Rally Camera power splitter" }),
      ],
      byod: [
        L("extend", "HDMI (RX)", "rallyBoard", "HDMI-IN", "hdmi", 109),
        L("rallyBoard", "USB-C", "extend", "USB-A (RX)", "usb", 109),
        L("laptop", "USB-C Out", "extend", "Laptop USB-C (TX)", "usb", 109, { via: "Extend TX → CAT → RX" }),
        L("rallyBoard", "USB-C", "laptop", "USB In", "usb", 108, { via: "Logi Active USB cable (DisplayPort Alt Mode)", unless: ["extend"] }),
      ],
    },
  },
];

// Cables every Rally Plus design has, whichever mode (p.38–41).
export const RALLY_PLUS_COMMON: Link[] = [
  L("rallyCamera", "USB-C", "displayHub", "Camera USB-C", "usb", 38),
  L("displayHub", "Speaker L", "rallySpeaker#1", "Speaker In", "speaker", 38),
  L("displayHub", "Speaker R", "rallySpeaker#2", "Speaker In", "speaker", 38),
  L("tableHub", "Display Hub link", "displayHub", "Table Hub link", "cat6", 38, { via: "CAT6a" }),
];

/** Mic Pod limits per host (p.13–14, p.38, p.71). */
export const MIC_LIMITS: Record<string, { pods: number; hubs: number; withSight?: number; withTwoSights?: number }> = {
  rallyBar: { pods: 4, hubs: 2, withSight: 3, withTwoSights: 2 },
  rallyBarMini: { pods: 3, hubs: 2, withSight: 2, withTwoSights: 1 },
  rallyPlus: { pods: 7, hubs: 7 },
};

/**
 * What the interviewer and the planner should know about Logitech systems —
 * plain text injected into those prompts when Logitech is in play.
 */
export const LOGITECH_DESIGN_NOTES = `Logitech reference (from ${GUIDE}):
- Rally Bar, Rally Bar Mini, Rally Bar Huddle and Rally Board 65 run in one of three modes, and the wiring differs completely: Android/appliance mode (CollabOS running Teams Rooms on Android, Zoom Rooms, etc. — control from a Tap / Tap IP), PC mode (a dedicated Teams/Zoom Rooms PC, e.g. Lenovo ThinkSmart Core, drives the displays and uses the bar over USB), or BYOD (a laptop connects to the bar over USB-C; no room compute). If a Logitech bar/board is chosen and the mode isn't decided, ask it (Android / PC / BYOD). In PC mode, ask which compute.
- Rally / Rally Plus is a modular kit (Rally Camera, Display Hub, Table Hub, Rally Speakers, Mic Pods) that needs a host: a Teams/Zoom Rooms PC (PC mode), a Logitech RoomMate (Android mode), or a laptop (BYOD).
- MeetUp / MeetUp 2 are USB devices: they need a RoomMate (Android), a room PC (PC mode), or a laptop (BYOD).
- Tap connects to the bar/compute by USB over the included CAT5e extender; Tap IP needs a PoE network port or a PoE injector (sold separately). A Tap can also ingest a laptop over HDMI for content sharing.
- Wired laptop sharing options: HDMI into the bar's HDMI-IN, HDMI into Tap, Logitech Swytch (one cable BYOD switching between room system and laptop), or Logitech Extend (laptop USB-C extended over CAT).
- Mic Pod limits: Rally Bar max 4 Mic Pods + 2 Mic Pod Hubs; Rally Bar Mini max 3 + 2; Rally / Rally Plus up to 7 Mic Pods + 7 Hubs. With one Sight: Rally Bar 3 Mic Pods, Mini 2. Mic Pods more than ~3 m away use a Mic Pod Extension Cable or the Mic Pod CAT Coupler (CAT run ≤ 20 m).
- Sight (center-of-table camera) requires PoE+ (802.3at) from a PoE+ switch or an active injector, and connects to the bar through the Sight dongle. Scribe (whiteboard camera) connects to the bar's USB-A through a USB-to-CAT extender with PoE.
- Rally Bar Huddle and MeetUp 2 have a single display output (dual displays need PC mode or a RoomMate). With Scribe on dual-display Teams Rooms, HDMI-TV 1 goes to the right display.
- Not yet supported ("coming soon" in the guide): Swytch with Rally Bar Huddle, Sight with Rally Plus, the Rally Camera Streamline Kit with Rally Bar / RoomMate.`;
