"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { supabase } from "@/lib/supabase";
import ConfirmDialog from "@/components/ConfirmDialog";

/* ── Types ─────────────────────────────────────────────────── */
interface Project { id: string; name: string; job_number: string; }

interface FieldData { [key: string]: string; }

interface Room {
  id: string;
  name: string;
  data: FieldData;
}

interface Building {
  id: string;
  name: string;
  data: FieldData;
  rooms: Room[];
}

interface SurveyState {
  buildings: Building[];
}

/* ── Field definitions ─────────────────────────────────────── */
interface Field {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "number" | "photo" | "dimensions" | "photo_extras";
  placeholder?: string;
  options?: string[];
  unit?: string;
  hint?: string;
  rows?: number;
  showIf?: { key: string; value: string };
  fullWidth?: boolean;
  integer?: boolean;
  dimensionKeys?: { label: string; ftKey: string; inKey: string }[];
  colStart?: 1 | 2;
}

interface Section {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  fields: Field[];
  maxWidth?: string;
}

/* ── Building-level fields ─────────────────────────────────── */
const BUILDING_FIELDS: Field[] = [
  { key: "building_address", label: "Address", type: "text", placeholder: "Full street address" },
  { key: "site_contact_name", label: "Site Contact Name", type: "text", placeholder: "Person on-site during survey" },
  { key: "site_contact_phone", label: "Site Contact Phone", type: "text", placeholder: "+1 (555) 000-0000" },
  { key: "site_contact_email", label: "Site Contact Email", type: "text", placeholder: "contact@company.com" },
  { key: "building_notes", label: "Notes", type: "textarea", placeholder: "Any additional notes..." },
];

/* ── Room-level sections ───────────────────────────────────── */
const ROOM_SECTIONS: Section[] = [
  {
    id: "room",
    title: "Room Assessment",
    color: "violet",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V3h18v18H3z" /><path d="M9 21V11h6v10" /></svg>,
    fields: [
      { key: "room_purpose", label: "Primary Room Purpose", type: "select", options: ["Boardroom", "Conference Room", "Huddle Room", "Training Room", "Classroom", "Lecture Hall", "Auditorium", "Courtroom", "Council Chamber", "Command Center", "Lobby", "Digital Signage", "Multipurpose", "Divisible", "Worship Space", "Performance Venue", "Other"] },
      { key: "room_dimensions", label: "Room Dimensions", type: "dimensions", fullWidth: true, dimensionKeys: [
        { label: "Length", ftKey: "room_length", inKey: "room_length_in" },
        { label: "Width", ftKey: "room_width", inKey: "room_width_in" },
        { label: "Height", ftKey: "room_height", inKey: "room_height_in" },
      ] },
      { key: "room_notes", label: "Additional Room Notes", type: "textarea", placeholder: "Any unique features, obstructions, columns, alcoves, stage/riser..." },
      { key: "photo_front_wall", label: "Front Wall", type: "photo" },
      { key: "photo_left_wall", label: "Left Wall", type: "photo" },
      { key: "photo_right_wall", label: "Right Wall", type: "photo" },
      { key: "photo_rear_wall", label: "Rear Wall", type: "photo" },
      { key: "photo_ceiling", label: "Ceiling", type: "photo" },
      { key: "photo_extras", label: "Additional Photos", type: "photo_extras", fullWidth: true },
    ],
  },
  {
    id: "electrical",
    title: "Electrical Assessment",
    color: "amber",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>,
    fields: [
      { key: "outlet_locations", label: "Existing Outlet Locations", type: "textarea", placeholder: "Describe locations: floor boxes, wall plates, ceiling drops, proximity to display/projector walls...", fullWidth: true },
      { key: "electrical_notes", label: "Additional Electrical Notes", type: "textarea", placeholder: "Power quality concerns, known issues, proximity to EMI sources (motors, elevators, transformers)...", fullWidth: true },
    ],
  },
  {
    id: "lighting",
    title: "Lighting Assessment",
    color: "yellow",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>,
    fields: [
      { key: "light_control", label: "Does Lighting Control need to be integrated with AV?", type: "select", options: ["Yes", "No"] },
      { key: "has_projection", label: "Does the room have a projection system or is there an intention to add one?", type: "select", options: ["Yes", "No"] },
      { key: "light_zones", label: "Lighting Zones", type: "textarea", rows: 1, placeholder: "Describe zones: e.g. presentation wall zone, audience zone, perimeter, whiteboard zone...", showIf: { key: "light_control", value: "Yes" }, fullWidth: true },
      { key: "ambient_light_level", label: "Measured Ambient Light (at screen)", type: "number", unit: "fc", placeholder: "0", hint: "AVIXA recommends ≤25 fc at projection screen, ≤50 fc at flat panel", showIf: { key: "has_projection", value: "Yes" }, fullWidth: true },
      { key: "lighting_notes", label: "Additional Lighting Notes", type: "textarea", placeholder: "Glare issues, reflection on screens, video conferencing lighting quality, presenter lighting needs...", fullWidth: true },
    ],
  },
  {
    id: "acoustics",
    title: "Acoustics Assessment",
    color: "emerald",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>,
    fields: [
      { key: "ambient_noise", label: "Measured Ambient Noise Level", type: "number", unit: "dBA", placeholder: "0", hint: "Measure with HVAC on. Conference rooms should target NC-25 to NC-30" },
      { key: "nc_rating", label: "Estimated NC Rating", type: "select", options: ["NC-20 or below (very quiet)", "NC-25 (quiet conference room)", "NC-30 (standard office)", "NC-35 (open office / classroom)", "NC-40 (lobby / public space)", "NC-45+ (noisy / industrial)", "Unknown — needs measurement"] },
      { key: "hvac_noise", label: "HVAC Noise Concern", type: "select", options: ["Not noticeable", "Slightly noticeable", "Moderately noticeable — may affect speech", "Significant — will require mitigation", "Severe — diffusers directly over mic zones"] },
      { key: "hvac_diffuser_locations", label: "HVAC Diffuser Locations", type: "textarea", placeholder: "Describe proximity to microphone pickup areas, display/speaker walls, presenter position..." },
      { key: "sound_isolation", label: "Sound Isolation Concern", type: "select", options: ["Not a concern", "Moderate — adjacent offices", "High — adjacent courtroom / boardroom", "Critical — SCIF / classified", "Unknown"] },
      { key: "stc_rating", label: "Estimated Wall STC Rating", type: "select", options: ["STC 30-35 (standard single drywall)", "STC 40-45 (double drywall / insulated)", "STC 50-55 (rated partition)", "STC 55+ (high isolation / masonry)", "Unknown"] },
      { key: "reflective_surfaces", label: "Hard / Reflective Surfaces", type: "textarea", placeholder: "Glass walls, polished concrete, marble, whiteboard walls, parallel hard surfaces..." },
      { key: "acoustic_treatment", label: "Existing Acoustic Treatment", type: "textarea", placeholder: "ACT ceiling, wall panels, fabric-wrapped panels, curtains/drapes, carpet, clouds/baffles..." },
      { key: "rt60_estimate", label: "Estimated RT60", type: "select", options: ["< 0.4s (very dead / treated)", "0.4–0.6s (good for conferencing)", "0.6–0.8s (acceptable)", "0.8–1.2s (reverberant — needs treatment)", "1.2s+ (very reverberant)", "Unknown"], hint: "Target 0.4–0.6s for conference, 0.6–0.8s for classrooms" },
      { key: "sound_masking", label: "Sound Masking System", type: "select", options: ["None", "Existing system — functional", "Existing system — non-functional", "Planned / specified", "Recommended"] },
      { key: "acoustics_notes", label: "Additional Acoustics Notes", type: "textarea", placeholder: "Flutter echo, standing waves, adjacent noisy spaces (kitchen, mechanical room), speech privacy needs..." },
    ],
  },
  {
    id: "network",
    title: "Network / IT Infrastructure",
    color: "cyan",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="17" y="1" width="6" height="6" rx="1" /><rect x="9" y="17" width="6" height="6" rx="1" /><path d="M4 7v3a3 3 0 003 3h10a3 3 0 003-3V7M12 13v4" /></svg>,
    fields: [
      { key: "network_drops", label: "Number of Network Drops in Room", type: "number", integer: true, placeholder: "0" },
      { key: "network_drop_locations", label: "Network Drop Locations", type: "textarea", rows: 1, placeholder: "Floor boxes, wall plates, ceiling — note which are active vs. dead" },
      { key: "client_provides_network", label: "Is the client providing AV network?", type: "select", options: ["Yes", "No"] },
      { key: "idf_mdf_location", label: "IDF / MDF / Telecom Closet Location", type: "text", placeholder: "e.g. IDF Room 305, same floor — 120ft horizontal run", showIf: { key: "client_provides_network", value: "Yes" } },

      { key: "poe_available", label: "PoE Available", type: "select", options: ["Yes — PoE+ (802.3at, 30W)", "Yes — PoE++ (802.3bt, 60W/90W)", "Standard PoE only (802.3af, 15.4W)", "No PoE — midspan injectors needed", "Unknown"], showIf: { key: "client_provides_network", value: "Yes" } },
      { key: "vlan_available", label: "Dedicated AV VLAN", type: "select", options: ["Yes — existing AV VLAN", "Yes — IT will create", "No — shared network", "Unknown — needs coordination with IT"], showIf: { key: "client_provides_network", value: "Yes" } },
      { key: "multicast", label: "Multicast / IGMP Snooping", type: "select", options: ["Supported and configured", "Supported — needs configuration", "Not supported", "Unknown"], hint: "Required for Dante, AV-over-IP, and many control systems", showIf: { key: "client_provides_network", value: "Yes" } },
      { key: "internet_bandwidth", label: "Internet Bandwidth", type: "text", placeholder: "e.g. 1Gbps symmetrical fiber", showIf: { key: "client_provides_network", value: "Yes" } },
      { key: "wifi_coverage", label: "WiFi Coverage", type: "select", options: ["Strong — enterprise AP in/near room", "Moderate", "Weak — may need AP", "No WiFi", "Unknown"], showIf: { key: "client_provides_network", value: "Yes" } },
      { key: "network_notes", label: "Additional Network / IT Notes", type: "textarea", placeholder: "IT contact info, firewall restrictions, cloud service access (Zoom/Teams/WebEx), QoS policies, DHCP reservations...", fullWidth: true },
    ],
  },
  {
    id: "pathways",
    title: "Cable Pathways & Infrastructure",
    color: "orange",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h16M4 15h16M8 3v18M16 3v18" /></svg>,
    fields: [
      { key: "conduit_existing", label: "Existing Conduit Pathways", type: "textarea", rows: 1, placeholder: "EMT, flex, innerduct — sizes, routes, fill capacity..." },
      { key: "cable_tray", label: "Cable Tray / J-Hook Above Ceiling", type: "select", options: ["Yes — cable tray with capacity", "Yes — J-hooks on existing runs", "No — will need to install", "No access above ceiling", "Unknown"] },
      { key: "ceiling_access", label: "Above-Ceiling Access", type: "select", options: ["Full access — lift tiles anywhere", "Limited — obstructed by ductwork/structure", "No access — hard lid / concrete deck", "Partial — some tiles accessible"] },
      { key: "plenum_space", label: "Plenum Depth (above ceiling tile)", type: "number", unit: "in", placeholder: "0", hint: "Needed for ceiling speakers, mics, and cable routing" },
      { key: "plenum_rated", label: "Plenum-Rated Cable Required?", type: "select", options: ["Yes — air-handling plenum space", "No — non-plenum (ducted return)", "Unknown — needs verification"] },
      { key: "floor_boxes", label: "Floor Boxes", type: "textarea", rows: 1, placeholder: "Quantity, locations, sizes, existing services in each (power, data, AV)..." },
      { key: "wall_penetrations", label: "Wall Penetrations Possible?", type: "select", options: ["Yes — standard drywall", "Limited — rated walls (need firestop)", "No — concrete / CMU", "Mixed — varies by wall"] },
      { key: "firestop", label: "Firestopping Required", type: "select", options: ["Yes — rated walls/floors", "Partial — some penetrations", "No", "Unknown"] },
      { key: "rack_location", label: "AV Rack / Equipment Location", type: "select", options: ["In-room credenza / furniture", "Dedicated AV closet (adjacent)", "Shared telecom / IDF room", "Ceiling / above-ceiling plenum", "Remote / headend room", "Not determined"] },
      { key: "rack_space", label: "Available Rack Space", type: "text", placeholder: "e.g. 12U wall-mount in closet, 14 RU available in existing rack" },
      { key: "pathway_notes", label: "Additional Pathway Notes", type: "textarea", fullWidth: true, placeholder: "Obstructions, fire-rated barriers, asbestos concerns, cable run distances, coordination with other trades..." },
    ],
  },
  {
    id: "display",
    title: "Display & Video Assessment",
    color: "rose",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
    fields: [
      { key: "display_type", label: "Planned Display Type", type: "select", options: ["Flat Panel (LED/LCD)", "Projector + Screen", "LED Video Wall (direct-view)", "Dual / Multi-display", "Interactive Display / Touch", "Projector + Flat Panel (hybrid)", "Not determined"] },
      { key: "content_type", label: "Primary Content Type", type: "select", options: ["Presentations / Spreadsheets (analytical)", "Video Conferencing", "Video Playback", "Digital Signage", "Medical Imaging", "CAD / Engineering Drawings", "Mixed / General", "Other"], hint: "Determines required image height per AVIXA DISCAS" },
      { key: "display_mounting", label: "Mounting Surface / Method", type: "select", options: ["Drywall on stud (needs backing)", "Plywood backing behind drywall", "Concrete / CMU (tapcon / anchor)", "Recessed / Niche", "Floor stand / Cart", "Ceiling mount", "Not determined"] },
      { key: "structural_support", label: "Structural Support Verified?", type: "select", options: ["Yes — engineer confirmed", "Yes — solid backing visible", "No — needs structural verification", "No — insufficient support", "Unknown"] },
      { key: "camera_locations", label: "Camera Mounting Locations", type: "textarea", rows: 1, placeholder: "Above/below display, ceiling mount, wall mount — note sightlines, lighting on faces, background..." },
      { key: "camera_requirements", label: "Camera Requirements", type: "select", options: ["Single fixed camera (huddle)", "Single PTZ camera", "Dual camera (room + whiteboard)", "Auto-tracking / AI framing", "Multiple cameras (production)", "Not required"] },
      { key: "display_notes", label: "Additional Display / Video Notes", type: "textarea", fullWidth: true, placeholder: "Sight lines, viewing angles, ADA height requirements, windows behind/beside display, cable access to display location..." },
    ],
  },
  {
    id: "audio",
    title: "Audio System Assessment",
    color: "purple",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" /></svg>,
    fields: [
      { key: "audio_use", label: "Primary Audio Use Case", type: "select", options: ["Speech reinforcement only", "Video conferencing (full-duplex)", "Background music / paging", "Presentation + conferencing", "Performance / live event", "Courtroom / council recording", "Mixed / all of the above"] },
      { key: "speaker_type", label: "Planned Speaker Type", type: "select", options: ["Ceiling speakers (distributed)", "Wall-mounted speakers", "Soundbar (display-integrated)", "Pendant speakers", "Line array", "Under-table speakers (privacy)", "Not determined"] },
      { key: "mic_type", label: "Planned Microphone Type", type: "select", options: ["Ceiling microphone array", "Table boundary mics (wired)", "Table boundary mics (wireless)", "Gooseneck / podium mic", "Handheld wireless", "Lapel / lavalier wireless", "Beamforming bar (integrated)", "USB speakerphone", "Multiple types", "Not determined"] },
      { key: "mic_pickup_zones", label: "Microphone Pickup Zones", type: "textarea", rows: 1, placeholder: "Table area, presenter zone, audience Q&A — note ceiling-to-talker distances..." },
      { key: "aec_required", label: "AEC (Acoustic Echo Cancellation) Required?", type: "select", options: ["Yes — video / audio conferencing", "No — local reinforcement only", "Yes — via DSP (Biamp, QSC, etc.)", "Yes — via USB device (built-in)"] },
      { key: "assistive_listening", label: "Assistive Listening Required (ADA)?", type: "select", options: ["Yes — hearing loop (induction)", "Yes — RF system", "Yes — IR system", "Yes — type not determined", "No — not required for this space", "Unknown"], hint: "ADA requires ALS in assembly areas with 50+ seats or audio amplification" },
      { key: "audio_notes", label: "Additional Audio Notes", type: "textarea", fullWidth: true, placeholder: "Speech privacy between rooms, paging integration, background music zones, Dante network requirements, DSP location..." },
    ],
  },
  {
    id: "control",
    title: "Control System & User Interface",
    color: "sky",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /><circle cx="8" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" /></svg>,
    fields: [
      { key: "control_platform", label: "Control System Platform", type: "select", options: ["Crestron", "Extron", "Q-SYS (QSC)", "AMX (Harman)", "Savant", "Zoom Rooms native", "Teams Rooms native", "Vendor-agnostic / no processor", "Not determined"] },
      { key: "touch_panel_location", label: "Touch Panel Location", type: "select", options: ["Table-top", "Wall-mounted (at entry)", "Wall-mounted (at presenter)", "Lectern / podium", "On display (OSD)", "iPad / mobile device", "No touch panel (scheduling only)", "Not determined"] },
      { key: "scheduling_panel", label: "Room Scheduling Panel", type: "select", options: ["Yes — at room entry", "No", "Planned", "Existing — make/model:"] },
      { key: "uc_platform", label: "UC / Video Conferencing Platform", type: "select", options: ["Microsoft Teams Rooms", "Zoom Rooms", "Cisco Webex", "Google Meet", "BYOD only (no dedicated platform)", "Dual-platform (Teams + Zoom)", "Other", "Not determined"] },
      { key: "byod_requirements", label: "BYOD Wireless Sharing", type: "select", options: ["Required — primary use case", "Required — supplemental to UC platform", "Nice to have", "Not needed", "Not determined"] },
      { key: "occupancy_sensor", label: "Occupancy / People Count Sensor", type: "select", options: ["Yes — existing", "Yes — planned", "No — not required", "Not determined"] },
      { key: "control_notes", label: "Additional Control Notes", type: "textarea", fullWidth: true, placeholder: "Auto-on/off behavior, integration with building systems (lighting, HVAC, shades), scheduling platform (Exchange, Google, etc.)..." },
    ],
  },
  {
    id: "structural",
    title: "Structural & Mounting",
    color: "stone",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20h20M6 20V10l6-6 6 6v10M10 20v-6h4v6" /></svg>,
    fields: [
      { key: "ceiling_weight", label: "Ceiling Grid Weight Rating", type: "select", options: ["Standard (not load-rated)", "Load-rated (specify lbs)", "Open — steel structure above", "Concrete deck — anchor directly", "Unknown"], hint: "Ceiling speakers, projector mounts, and mic arrays need verified support" },
      { key: "seismic_zone", label: "Seismic Requirements", type: "select", options: ["Not applicable", "Zone 1–2 (low)", "Zone 3 (moderate)", "Zone 4 (high — California, Pacific NW)", "Unknown — check local code"] },
      { key: "ceiling_support_detail", label: "Ceiling Support Details", type: "textarea", placeholder: "Describe structure above ceiling: bar joists, concrete deck, steel beams — are safety wires / Unistrut available?" },
      { key: "wall_backing", label: "Display Wall Backing", type: "textarea", placeholder: "Plywood backing, stud spacing (16\" or 24\" OC), blocking installed, toggle bolt candidates..." },
      { key: "structural_notes", label: "Additional Structural Notes", type: "textarea", fullWidth: true, placeholder: "Column locations, beam clearances, load concerns for large displays/mounts, blocking requests to GC..." },
    ],
  },
  {
    id: "compliance",
    title: "ADA, Safety & Code Compliance",
    color: "red",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" /><path d="M12 8v4M12 16h.01" /></svg>,
    fields: [
      { key: "ada_required", label: "ADA Compliance Required?", type: "select", options: ["Yes — public / assembly space", "Yes — government facility", "Partial — ALS only", "No — private space", "Unknown"] },
      { key: "fire_alarm", label: "Fire Alarm Integration", type: "select", options: ["Required — mute audio on alarm", "Required — visual strobe in room", "Not required", "Unknown"] },
      { key: "emergency_paging", label: "Emergency Paging / Mass Notification", type: "select", options: ["Required — integration with AV speakers", "Separate system (not AV)", "Not required", "Unknown"] },
      { key: "compliance_notes", label: "Additional Compliance Notes", type: "textarea", fullWidth: true, placeholder: "Fire rating of walls being penetrated, OSHA noise exposure, local low-voltage licensing requirements, union labor requirements..." },
    ],
  },
  {
    id: "scope",
    title: "Scope of Work",
    color: "blue",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg>,
    fields: [
      { key: "scope_of_work", label: "Scope of Work", type: "textarea", fullWidth: true, rows: 10, placeholder: "Describe the scope of work for this room..." },
    ],
  },
];

/* ── Color map ─────────────────────────────────────────────── */
const SECTION_COLORS: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  blue:    { border: "border-blue-500/30",    bg: "bg-blue-500/10",    text: "text-blue-400",    dot: "bg-blue-500" },
  violet:  { border: "border-violet-500/30",  bg: "bg-violet-500/10",  text: "text-violet-400",  dot: "bg-violet-500" },
  amber:   { border: "border-amber-500/30",   bg: "bg-amber-500/10",   text: "text-amber-400",   dot: "bg-amber-400" },
  yellow:  { border: "border-yellow-500/30",  bg: "bg-yellow-500/10",  text: "text-yellow-400",  dot: "bg-yellow-500" },
  emerald: { border: "border-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-500" },
  cyan:    { border: "border-cyan-500/30",    bg: "bg-cyan-500/10",    text: "text-cyan-400",    dot: "bg-cyan-500" },
  orange:  { border: "border-orange-500/30",  bg: "bg-orange-500/10",  text: "text-orange-400",  dot: "bg-orange-500" },
  rose:    { border: "border-rose-500/30",    bg: "bg-rose-500/10",    text: "text-rose-400",    dot: "bg-rose-500" },
  purple:  { border: "border-purple-500/30",  bg: "bg-purple-500/10",  text: "text-purple-400",  dot: "bg-purple-500" },
  sky:     { border: "border-sky-500/30",     bg: "bg-sky-500/10",     text: "text-sky-400",     dot: "bg-sky-500" },
  stone:   { border: "border-stone-500/30",   bg: "bg-stone-500/10",   text: "text-stone-400",   dot: "bg-stone-500" },
  red:     { border: "border-red-500/30",     bg: "bg-red-500/10",     text: "text-red-400",     dot: "bg-red-500" },
  slate:   { border: "border-border",   bg: "bg-slate-500/10",   text: "text-muted",   dot: "bg-slate-500" },
};

/* ── Active view type ──────────────────────────────────────── */
type ActiveView =
  | { type: "building"; buildingId: string }
  | { type: "room"; buildingId: string; roomId: string; sectionId: string };

/* ── Page ──────────────────────────────────────────────────── */
const STAGES = ["site-survey", "design-engineering", "proposal", "project-engineering", "completed"];

export default function SiteSurveyPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [survey, setSurvey] = useState<SurveyState>({ buildings: [] });
  const [activeView, setActiveView] = useState<ActiveView | null>(null);
  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  // Whether there are edits not yet confirmed saved — starts false (a
  // freshly loaded survey has nothing new), flips true on every edit via
  // persist(), and only clears once a save that covers the LATEST edit
  // actually completes (see saveVersionRef below) so a slow save from an
  // older edit can't race past a newer one and falsely clear this.
  const [dirty, setDirty] = useState(false);
  const saveVersionRef = useRef(0);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiMinimized, setAiMinimized] = useState(false);
  const [aiRecording, setAiRecording] = useState(false);
  const [aiSaveAndClose, setAiSaveAndClose] = useState(false);
  const [generatingScope, setGeneratingScope] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingRoomName, setEditingRoomName] = useState("");
  const [deleteRoomConfirm, setDeleteRoomConfirm] = useState<{ buildingId: string; roomId: string; name: string } | null>(null);

  useEffect(() => {
    // Load project
    supabase.from("projects").select("id, name, job_number").eq("id", params.id).single()
      .then(({ data }) => { if (data) setProject(data); });

    // Load survey
    supabase.from("site_surveys").select("data").eq("project_id", params.id).single()
      .then(async ({ data }) => {
        let s: SurveyState = data?.data as SurveyState || { buildings: [] };
        if (s.buildings.length === 0) {
          const defaultBuilding: Building = { id: crypto.randomUUID(), name: "Site", data: {}, rooms: [] };
          s = { buildings: [defaultBuilding] };
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.from("site_surveys").upsert({
              project_id: params.id, user_id: user.id, data: s,
            }, { onConflict: "project_id" });
          }
        }
        setSurvey(s);
        // ?room=<id>&section=<id> opens straight on that room's section —
        // e.g. Generate with AI's "Write a Scope of Work first".
        const qs = new URLSearchParams(window.location.search);
        const linkRoom = qs.get("room");
        const linkBuilding = linkRoom ? s.buildings.find((b) => (b.rooms || []).some((r) => r.id === linkRoom)) : undefined;
        if (linkRoom && linkBuilding) {
          const section = ROOM_SECTIONS.find((sec) => sec.id === qs.get("section")) || ROOM_SECTIONS[0];
          setActiveView({ type: "room", buildingId: linkBuilding.id, roomId: linkRoom, sectionId: section.id });
          setExpandedBuildings(new Set([linkBuilding.id]));
        } else {
          setActiveView({ type: "building", buildingId: s.buildings[0].id });
          setExpandedBuildings(new Set([s.buildings[0].id]));
        }
      });
  }, [params.id]);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const autoSave = useCallback(async (surveyData: SurveyState, version: number) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Check if a row already exists
    const { data: existing } = await supabase
      .from("site_surveys")
      .select("id")
      .eq("project_id", params.id)
      .single();

    if (existing) {
      await supabase.from("site_surveys")
        .update({ data: surveyData, updated_at: new Date().toISOString() })
        .eq("project_id", params.id);
    } else {
      await supabase.from("site_surveys")
        .insert({ project_id: params.id, user_id: user.id, data: surveyData });
    }
    // Only clear "dirty" if no newer edit has come in since this save was
    // queued — otherwise a slow save from an older edit could resolve after
    // a newer one and wrongly signal everything's saved.
    if (version === saveVersionRef.current) setDirty(false);
  }, [params.id]);

  function persist(next: SurveyState) {
    setSurvey(next);
    setSaved(false);
    setDirty(true);
    saveVersionRef.current += 1;
    const version = saveVersionRef.current;
    // Debounced auto-save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => autoSave(next, version), 1000);
  }

  /* ── Building CRUD ──────────────────────────────── */
  function addBuilding() {
    const newB: Building = { id: crypto.randomUUID(), name: `Building ${survey.buildings.length + 1}`, data: {}, rooms: [] };
    const next = { ...survey, buildings: [...survey.buildings, newB] };
    persist(next);
    setActiveView({ type: "building", buildingId: newB.id });
    setExpandedBuildings((prev) => new Set([...prev, newB.id]));
  }

  function removeBuilding(bId: string) {
    const next = { ...survey, buildings: survey.buildings.filter((b) => b.id !== bId) };
    persist(next);
    if (activeView && ("buildingId" in activeView) && activeView.buildingId === bId) {
      setActiveView(next.buildings.length > 0 ? { type: "building", buildingId: next.buildings[0].id } : null);
    }
  }

  function updateBuildingField(bId: string, key: string, value: string) {
    const next = {
      ...survey,
      buildings: survey.buildings.map((b) =>
        b.id === bId ? { ...b, data: { ...b.data, [key]: value }, name: key === "building_name" && value.trim() ? value.trim() : b.name } : b
      ),
    };
    persist(next);
  }

  /* ── Room CRUD ──────────────────────────────────── */
  function addRoom(bId: string) {
    const building = survey.buildings.find((b) => b.id === bId);
    if (!building) return;
    const newR: Room = { id: crypto.randomUUID(), name: `Room ${building.rooms.length + 1}`, data: {} };
    const next = {
      ...survey,
      buildings: survey.buildings.map((b) =>
        b.id === bId ? { ...b, rooms: [...b.rooms, newR] } : b
      ),
    };
    persist(next);
    setActiveView({ type: "room", buildingId: bId, roomId: newR.id, sectionId: ROOM_SECTIONS[0].id });
    setExpandedBuildings((prev) => new Set([...prev, bId]));
  }

  function removeRoom(bId: string, rId: string) {
    const next = {
      ...survey,
      buildings: survey.buildings.map((b) =>
        b.id === bId ? { ...b, rooms: b.rooms.filter((r) => r.id !== rId) } : b
      ),
    };
    persist(next);
    if (activeView?.type === "room" && activeView.roomId === rId) {
      setActiveView({ type: "building", buildingId: bId });
    }
  }

  function updateRoomField(bId: string, rId: string, key: string, value: string) {
    const next = {
      ...survey,
      buildings: survey.buildings.map((b) =>
        b.id === bId
          ? {
              ...b,
              rooms: b.rooms.map((r) =>
                r.id === rId ? { ...r, data: { ...r.data, [key]: value }, name: key === "room_name" && value.trim() ? value.trim() : r.name } : r
              ),
            }
          : b
      ),
    };
    persist(next);
  }

  function updateRoomFields(bId: string, rId: string, updates: Record<string, string>) {
    const next = {
      ...survey,
      buildings: survey.buildings.map((b) =>
        b.id === bId
          ? {
              ...b,
              rooms: b.rooms.map((r) =>
                r.id === rId ? { ...r, data: { ...r.data, ...updates } } : r
              ),
            }
          : b
      ),
    };
    persist(next);
  }

  async function handleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await autoSave(survey, saveVersionRef.current);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function generateScopeOfWork() {
    if (!activeView || activeView.type !== "room" || !currentRoom) return;
    setGeneratingScope(true);
    try {
      const res = await fetch("/api/generate-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomData: currentRoom.data }),
      });
      const json = await res.json();
      if (json.scope_of_work) {
        updateRoomField(activeView.buildingId, activeView.roomId, "scope_of_work", json.scope_of_work);
      }
    } catch {
      // fail silently
    } finally {
      setGeneratingScope(false);
    }
  }

  function toggleBuilding(bId: string) {
    setExpandedBuildings((prev) => {
      const next = new Set(prev);
      if (next.has(bId)) next.delete(bId);
      else next.add(bId);
      return next;
    });
  }

  /* ── Progress ───────────────────────────────────── */
  const totalBuildings = survey.buildings.length;
  const totalRooms = survey.buildings.reduce((a, b) => a + b.rooms.length, 0);

  if (!project) {
    return (
      <div className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-subtle hover:text-secondary">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Back to Projects
        </Link>
        <div className="mt-20 text-center text-sm text-subtle">Project not found</div>
      </div>
    );
  }

  /* ── Resolve current view data ──────────────────── */
  let currentBuilding: Building | undefined;
  let currentRoom: Room | undefined;
  let currentSection: Section | undefined;

  if (activeView?.type === "building") {
    currentBuilding = survey.buildings.find((b) => b.id === activeView.buildingId);
  } else if (activeView?.type === "room") {
    currentBuilding = survey.buildings.find((b) => b.id === activeView.buildingId);
    currentRoom = currentBuilding?.rooms.find((r) => r.id === activeView.roomId);
    currentSection = ROOM_SECTIONS.find((s) => s.id === activeView.sectionId);
  }

  return (
    <div className="animate-fade-in">
      {/* ── Top header ────────────────────────────────── */}
      <div className="border-b border-border bg-forge-panel/50 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <Link href={`/projects/${params.id}`} className="mb-2 inline-flex items-center gap-1.5 text-xs text-subtle hover:text-secondary">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              {project.name}
              {project.job_number && <span className="text-subtle"> · #{project.job_number}</span>}
            </Link>
            <h1 className="flex items-center gap-2.5 text-xl font-bold text-heading">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              Site Survey
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowAIModal(true)} className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-[13px] font-medium text-violet-400 transition-colors hover:bg-violet-500/20">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5L18.2 21 12 16.5 5.8 21l2.4-7.1L2 9.4h7.6z" />
              </svg>
              Create with AI
            </button>
            <button onClick={handleSave} disabled={!dirty && !saved} className="forge-btn-primary text-[13px] disabled:cursor-not-allowed disabled:opacity-40">
              {saved ? (
                <><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Saved</>
              ) : (
                <>Save</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Body: sidebar + form ──────────────────────── */}
      <div className="flex" style={{ height: "calc(100vh - 124px - 85px)" }}>
        {/* Sidebar */}
        <nav className="no-scrollbar w-[300px] shrink-0 overflow-y-auto border-r border-border bg-forge-panel/30 px-4 pb-4 pt-5">
          {/* Site Info button */}
          {survey.buildings.length > 0 && (() => {
            const building = survey.buildings[0];
            const isBuildingActive = activeView?.type === "building" && activeView.buildingId === building.id;
            return (
              <>
                <button
                  onClick={() => setActiveView({ type: "building", buildingId: building.id })}
                  className={`mb-4 flex w-full items-center gap-2.5 rounded-lg px-3 py-3 text-left text-sm transition-all ${
                    isBuildingActive ? "bg-forge-surface/60 font-semibold text-heading" : "text-muted hover:bg-forge-surface/30 hover:text-body"
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                    <path d="M2 14V5l6-3 6 3v9H2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    <path d="M6 14v-4h4v4" stroke="currentColor" strokeWidth="1" />
                  </svg>
                  Site Information
                </button>

                <div className="mb-3 flex items-center justify-between px-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-faint">Rooms</span>
                  <button onClick={() => addRoom(building.id)} className="flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/10">
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    Add Room
                  </button>
                </div>

                {building.rooms.length === 0 && (
                  <div className="px-2 py-6 text-center">
                    <p className="text-sm text-faint">No rooms added yet</p>
                  </div>
                )}

                {building.rooms.map((room) => {
                  const isRoomActive = activeView?.type === "room" && activeView.roomId === room.id;
                  return (
                    <div key={room.id}>
                      <div className="group/room flex items-center gap-1">
                        {editingRoomId === room.id ? (
                          <input
                            autoFocus
                            className="forge-input mx-1 flex-1 py-1.5 text-sm font-semibold"
                            value={editingRoomName}
                            onChange={(e) => setEditingRoomName(e.target.value)}
                            onBlur={() => {
                              if (editingRoomName.trim()) updateRoomField(building.id, room.id, "room_name", editingRoomName.trim());
                              setEditingRoomId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") { setEditingRoomId(null); }
                            }}
                          />
                        ) : (
                          <button
                            onClick={() => {
                              if (isRoomActive) {
                                setActiveView({ type: "building", buildingId: building.id });
                              } else {
                                setActiveView({ type: "room", buildingId: building.id, roomId: room.id, sectionId: ROOM_SECTIONS[0].id });
                              }
                            }}
                            className={`flex flex-1 items-center gap-2 truncate rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-all ${
                              isRoomActive ? "text-heading" : "text-secondary hover:bg-forge-surface/30 hover:text-heading"
                            }`}
                          >
                            <svg
                              width="12" height="12" viewBox="0 0 12 12" fill="none"
                              className={`shrink-0 transition-transform ${isRoomActive ? "rotate-90" : ""}`}
                            >
                              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                            <span className="truncate">{room.data.room_name || room.name}</span>
                          </button>
                        )}
                        {editingRoomId !== room.id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingRoomId(room.id); setEditingRoomName(room.data.room_name || room.name); }}
                            className="shrink-0 rounded p-1 text-faint opacity-0 transition-all group-hover/room:opacity-100 hover:text-heading"
                            title="Rename room"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteRoomConfirm({ buildingId: building.id, roomId: room.id, name: room.data.room_name || room.name })}
                          title="Delete room"
                          className="shrink-0 rounded p-1 text-faint opacity-0 transition-all group-hover/room:opacity-100 hover:text-red-400"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                        </button>
                      </div>

                      {/* Room sections (expanded when active) */}
                      {isRoomActive && (
                        <div className="mt-1 flex flex-col">
                          {ROOM_SECTIONS.map((section) => {
                            const isActive = activeView.sectionId === section.id;
                            const sc = SECTION_COLORS[section.color] ?? SECTION_COLORS.blue;
                            const filled = section.fields.filter((f) => room.data[f.key]?.trim()).length;
                            return (
                              <button
                                key={section.id}
                                onClick={() => setActiveView({ ...activeView, sectionId: section.id })}
                                className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                                  isActive ? "bg-forge-surface/60 font-semibold text-heading" : "text-subtle hover:bg-forge-surface/30 hover:text-secondary"
                                }`}
                              >
                                <span className="flex-1 truncate">{section.title}</span>
                                <span className={`text-xs ${filled === section.fields.length && section.fields.length > 0 ? "text-emerald-400" : "text-faint"}`}>
                                  {filled}/{section.fields.length}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}
        </nav>

        {/* ── Form content ────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden">
        <div className="no-scrollbar flex-1 overflow-y-auto p-6">
          {/* No view selected */}
          {!activeView && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <p className="text-sm text-subtle">Select Site Information or a room from the sidebar</p>
            </div>
          )}

          {/* Building form */}
          {activeView?.type === "building" && currentBuilding && (
            <>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21V5l7-3 7 3v16H3z" /><path d="M10 21V11h4v10" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-heading">Site Information</h2>
                  <p className="text-xs text-subtle">Location, contacts & access details</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                {BUILDING_FIELDS.map((field) => (
                  <div key={field.key} className={field.type === "textarea" ? "col-span-2" : ""}>
                    <label className="mb-1.5 block text-sm font-medium text-heading">{field.label}</label>
                    {renderField(field, currentBuilding!.data[field.key] ?? "", (val) => updateBuildingField(currentBuilding!.id, field.key, val))}
                    {field.hint && <p className="mt-1.5 text-[11px] text-faint">{field.hint}</p>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Room section form */}
          {activeView?.type === "room" && currentRoom && currentSection && (
            <>
              <div className="mb-1 text-xs text-faint">
                {currentBuilding?.data.building_name || currentBuilding?.name} &rarr; {currentRoom.data.room_name || currentRoom.name}
              </div>
              <div className="mb-6 flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${SECTION_COLORS[currentSection.color]?.border} ${SECTION_COLORS[currentSection.color]?.bg} ${SECTION_COLORS[currentSection.color]?.text}`}>
                  {currentSection.icon}
                </div>
                <div className="flex flex-1 items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-heading">{currentSection.title}</h2>
                    <p className="text-xs text-subtle">
                      {currentSection.fields.filter((f) => currentRoom!.data[f.key]?.trim()).length} of {currentSection.fields.length} fields completed
                    </p>
                  </div>
                  {currentSection.id === "scope" && (
                    <button
                      onClick={generateScopeOfWork}
                      disabled={generatingScope}
                      className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[12px] font-medium text-violet-400 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
                    >
                      {generatingScope ? (
                        <>
                          <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity=".25"/><path d="M21 12a9 9 0 00-9-9" strokeLinecap="round"/></svg>
                          Generating...
                        </>
                      ) : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
                          Generate with AI
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {currentSection.id === "acoustics" ? (() => {
                const rf = (key: string, rows?: number) => {
                  const field = currentSection.fields.find((f) => f.key === key);
                  if (!field) return null;
                  const val = currentRoom!.data[field.key] ?? "";
                  const onChange = (v: string) => updateRoomField(activeView.buildingId, activeView.roomId, field.key, v);
                  const f = rows ? { ...field, rows } : field;
                  return (
                    <div key={key}>
                      <label className="mb-1.5 block text-sm font-medium text-heading">{f.label}</label>
                      {renderField(f, val, onChange)}
                      {f.hint && <p className="mt-1.5 text-[11px] text-faint">{f.hint}</p>}
                    </div>
                  );
                };
                const divider = <div className="my-5" />;
                return (
                  <div className="rounded-2xl border border-border bg-forge-panel p-6">
                    {/* Row 1: Key Metrics */}
                    <p className="mb-0.5 text-sm font-semibold text-heading">Key Metrics</p>
                    <p className="mb-4 text-xs text-subtle">Capture baseline acoustical measurements and ratings.</p>
                    <div className="grid grid-cols-4 gap-x-5 gap-y-4">
                      {rf("ambient_noise")}
                      {rf("nc_rating")}
                      {rf("stc_rating")}
                      {rf("rt60_estimate")}
                    </div>
                    {divider}
                    {/* Row 2: Concern & Systems */}
                    <p className="mb-0.5 text-sm font-semibold text-heading">Concern &amp; Systems</p>
                    <p className="mb-4 text-xs text-subtle">Identify concerns and existing mitigation systems.</p>
                    <div className="grid grid-cols-3 gap-x-5 gap-y-4">
                      {rf("hvac_noise")}
                      {rf("sound_isolation")}
                      {rf("sound_masking")}
                    </div>
                    <div className="mt-4">
                      {rf("hvac_diffuser_locations", 2)}
                    </div>
                    {divider}
                    {/* Row 3: Room Observations */}
                    <p className="mb-0.5 text-sm font-semibold text-heading">Room Observations</p>
                    <p className="mb-4 text-xs text-subtle">Describe room surfaces and existing acoustic treatments.</p>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                      {rf("reflective_surfaces", 3)}
                      {rf("acoustic_treatment", 3)}
                    </div>
                    {divider}
                    {/* Row 4: Additional Acoustics Notes */}
                    <p className="mb-2 text-sm font-semibold text-heading">Additional Acoustics Notes</p>
                    {(() => {
                      const field = currentSection.fields.find((f) => f.key === "acoustics_notes");
                      if (!field) return null;
                      return <textarea value={currentRoom!.data["acoustics_notes"] ?? ""} onChange={(e) => updateRoomField(activeView.buildingId, activeView.roomId, "acoustics_notes", e.target.value)} placeholder={field.placeholder} rows={3} className="forge-input !bg-forge-panel resize-y" />;
                    })()}
                  </div>
                );
              })() : (
              <div className="rounded-2xl border border-border bg-forge-panel p-6" style={currentSection.maxWidth ? { maxWidth: currentSection.maxWidth } : undefined}>
              {currentSection.id === "room" ? (
                <>
                  {/* Row 1: Name (left) | Purpose (right) */}
                  <div className="mb-6 grid grid-cols-2 gap-x-8">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-heading">Room Name & Number</label>
                      <input
                        type="text"
                        value={currentRoom.data.room_name ?? ""}
                        onChange={(e) => updateRoomField(activeView.buildingId, activeView.roomId, "room_name", e.target.value)}
                        placeholder="e.g. Conference Room 301-A"
                        className="forge-input !bg-forge-panel"
                      />
                    </div>
                    {(() => {
                      const f = currentSection.fields.find((f) => f.key === "room_purpose");
                      if (!f) return null;
                      return (
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-heading">{f.label}</label>
                          <div className="relative">
                            <select
                              value={currentRoom!.data[f.key] ?? ""}
                              onChange={(e) => updateRoomField(activeView.buildingId, activeView.roomId, f.key, e.target.value)}
                              className="forge-input !bg-forge-panel w-full appearance-none pr-9"
                            >
                              <option value="">Select...</option>
                              {f.options!.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                            <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Row 2: Room Dimensions (full width) */}
                  {(() => {
                    const dimField = currentSection.fields.find((f) => f.type === "dimensions");
                    if (!dimField?.dimensionKeys) return null;
                    return (
                      <div className="mb-6">
                        <label className="mb-3 block text-sm font-medium text-heading">Room Dimensions</label>
                        <div className="rounded-xl border border-border p-4">
                          <div className="flex gap-6">
                            {dimField.dimensionKeys.map((dim) => (
                              <div key={dim.ftKey} className="min-w-0 flex-1">
                                <span className="mb-2 block text-xs font-medium text-heading">{dim.label}</span>
                                <div className="flex items-center gap-2">
                                  <div className="flex flex-1 overflow-hidden rounded-lg border border-border">
                                    <input type="number" value={currentRoom!.data[dim.ftKey] ?? ""} onChange={(e) => updateRoomField(activeView.buildingId, activeView.roomId, dim.ftKey, e.target.value)} placeholder="0" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-secondary outline-none" />
                                    <span className="flex items-center border-l border-border bg-forge-surface/50 px-2.5 text-xs text-faint">ft</span>
                                  </div>
                                  <div className="flex flex-1 overflow-hidden rounded-lg border border-border">
                                    <input type="number" value={currentRoom!.data[dim.inKey] ?? ""} onChange={(e) => updateRoomField(activeView.buildingId, activeView.roomId, dim.inKey, e.target.value)} placeholder="0" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-secondary outline-none" />
                                    <span className="flex items-center border-l border-border bg-forge-surface/50 px-2.5 text-xs text-faint">in</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Row 3: Additional Room Notes (full width) */}
                  {(() => {
                    const f = currentSection.fields.find((f) => f.key === "room_notes");
                    if (!f) return null;
                    return (
                      <div className="mb-6">
                        <label className="mb-1.5 block text-sm font-medium text-heading">{f.label}</label>
                        <textarea
                          value={currentRoom!.data[f.key] ?? ""}
                          onChange={(e) => updateRoomField(activeView.buildingId, activeView.roomId, f.key, e.target.value)}
                          placeholder={f.placeholder}
                          rows={f.rows ?? 3}
                          className="forge-input !bg-forge-panel resize-y"
                        />
                      </div>
                    );
                  })()}

                  {/* Row 4: Required Room Photos */}
                  <div>
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-heading">Required Room Photos</p>
                        </div>
                        <p className="mt-0.5 text-xs text-faint">Capture each wall to help with layout and design accuracy.</p>
                      </div>
                    </div>
                    {(() => {
                      const extraNames: string[] = (() => {
                        try { return JSON.parse(currentRoom!.data["photo_extra_names"] || "[]"); } catch { return []; }
                      })();
                      const hiddenKeys: string[] = (() => {
                        try { return JSON.parse(currentRoom!.data["photo_hidden_keys"] || "[]"); } catch { return []; }
                      })();
                      return (
                        <div className="grid grid-cols-6 gap-4">
                          {(["photo_front_wall", "photo_left_wall", "photo_right_wall", "photo_rear_wall", "photo_ceiling"] as const).map((key) => {
                            if (hiddenKeys.includes(key)) return null;
                            const f = currentSection.fields.find((f) => f.key === key);
                            if (!f) return null;
                            return (
                              <RoomPhotoCard
                                key={key}
                                label={f.label}
                                value={currentRoom!.data[key] ?? ""}
                                onChange={(val) => updateRoomField(activeView.buildingId, activeView.roomId, key, val)}
                                onRemoveCard={() => updateRoomFields(activeView.buildingId, activeView.roomId, {
                                  [key]: "",
                                  photo_hidden_keys: JSON.stringify([...hiddenKeys, key]),
                                })}
                              />
                            );
                          })}
                          {extraNames.map((name, i) => (
                            <RoomPhotoCard
                              key={`extra_${i}`}
                              label={name}
                              value={currentRoom!.data[`photo_extra_${i}_data`] ?? ""}
                              onChange={(val) => updateRoomField(activeView.buildingId, activeView.roomId, `photo_extra_${i}_data`, val)}
                              onLabelChange={(lbl) => {
                                const updated = [...extraNames];
                                updated[i] = lbl;
                                updateRoomField(activeView.buildingId, activeView.roomId, "photo_extra_names", JSON.stringify(updated));
                              }}
                              onRemoveCard={() => {
                                const updated = extraNames.filter((_, j) => j !== i);
                                const batch: Record<string, string> = { photo_extra_names: JSON.stringify(updated) };
                                for (let j = i; j < extraNames.length - 1; j++) {
                                  batch[`photo_extra_${j}_data`] = currentRoom!.data[`photo_extra_${j + 1}_data`] || "";
                                }
                                batch[`photo_extra_${extraNames.length - 1}_data`] = "";
                                updateRoomFields(activeView.buildingId, activeView.roomId, batch);
                              }}
                            />
                          ))}
                          <AddMorePhotoCard
                            nextNumber={extraNames.length + 1}
                            onAdd={(dataUrl, autoLabel) => {
                              const updated = [...extraNames, autoLabel];
                              updateRoomFields(activeView.buildingId, activeView.roomId, {
                                photo_extra_names: JSON.stringify(updated),
                                [`photo_extra_${extraNames.length}_data`]: dataUrl,
                              });
                            }}
                          />
                        </div>
                      );
                    })()}
                  </div>
                </>
              ) : currentSection.id === "lighting" ? (() => {
                const lf = (key: string) => {
                  const field = currentSection.fields.find((f) => f.key === key)!;
                  const val = currentRoom!.data[field.key] ?? "";
                  const onChange = (v: string) => updateRoomField(activeView.buildingId, activeView.roomId, field.key, v);
                  return { field, val, onChange };
                };
                const lightControlYes = currentRoom!.data["light_control"] === "Yes";
                const hasProjectionYes = currentRoom!.data["has_projection"] === "Yes";
                return (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                    {/* Row 1: Lighting Control + conditional Zones */}
                    <div className={lightControlYes ? "" : "col-span-2"}>
                      <label className="mb-1.5 block text-sm font-medium text-heading">{lf("light_control").field.label}</label>
                      {renderField(lf("light_control").field, lf("light_control").val, lf("light_control").onChange)}
                    </div>
                    {lightControlYes && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-heading">{lf("light_zones").field.label}</label>
                        {renderField(lf("light_zones").field, lf("light_zones").val, lf("light_zones").onChange)}
                      </div>
                    )}
                    {/* Row 2: Projection + conditional Ambient Light */}
                    <div className={hasProjectionYes ? "" : "col-span-2"}>
                      <label className="mb-1.5 block text-sm font-medium text-heading">{lf("has_projection").field.label}</label>
                      {renderField(lf("has_projection").field, lf("has_projection").val, lf("has_projection").onChange)}
                    </div>
                    {hasProjectionYes && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-heading">{lf("ambient_light_level").field.label}</label>
                        {renderField(lf("ambient_light_level").field, lf("ambient_light_level").val, lf("ambient_light_level").onChange)}
                        {lf("ambient_light_level").field.hint && <p className="mt-1.5 text-[11px] text-faint">{lf("ambient_light_level").field.hint}</p>}
                      </div>
                    )}
                    {/* Row 3: Notes always full width */}
                    <div className="col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-heading">{lf("lighting_notes").field.label}</label>
                      {renderField(lf("lighting_notes").field, lf("lighting_notes").val, lf("lighting_notes").onChange)}
                    </div>
                  </div>
                );
              })() : currentSection.id === "compliance" ? (
                <>
                  <div className="mb-5 grid grid-cols-3 gap-x-6 gap-y-5">
                    {currentSection.fields.slice(0, 3).map((field) => (
                      <div key={field.key}>
                        <label className="mb-1.5 block text-sm font-medium text-heading">{field.label}</label>
                        {renderField(field, currentRoom!.data[field.key] ?? "", (val) => updateRoomField(activeView.buildingId, activeView.roomId, field.key, val))}
                        {field.hint && <p className="mt-1.5 text-[11px] text-faint">{field.hint}</p>}
                      </div>
                    ))}
                  </div>
                  <div>
                    {currentSection.fields.slice(3).map((field) => (
                      <div key={field.key}>
                        <label className="mb-1.5 block text-sm font-medium text-heading">{field.label}</label>
                        {renderField(field, currentRoom!.data[field.key] ?? "", (val) => updateRoomField(activeView.buildingId, activeView.roomId, field.key, val))}
                      </div>
                    ))}
                  </div>
                </>
              ) : currentSection.id === "network" ? (
                <>
                  <div className="mb-5 grid grid-cols-3 gap-x-6 gap-y-5">
                    {currentSection.fields.slice(0, 3).map((field) => (
                      <div key={field.key}>
                        <label className="mb-1.5 block text-sm font-medium text-heading">{field.label}</label>
                        {renderField(field, currentRoom!.data[field.key] ?? "", (val) => updateRoomField(activeView.buildingId, activeView.roomId, field.key, val))}
                        {field.hint && <p className="mt-1.5 text-[11px] text-faint">{field.hint}</p>}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                    {currentSection.fields.slice(3).map((field) => {
                      if (field.showIf && currentRoom!.data[field.showIf.key] !== field.showIf.value) return null;
                      return (
                        <div key={field.key} className={`${field.fullWidth ? "col-span-2" : ""}`}>
                          <label className="mb-1.5 block text-sm font-medium text-heading">{field.label}</label>
                          {renderField(field, currentRoom!.data[field.key] ?? "", (val) => updateRoomField(activeView.buildingId, activeView.roomId, field.key, val))}
                          {field.hint && <p className="mt-1.5 text-[11px] text-faint">{field.hint}</p>}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                  {currentSection.fields.map((field) => {
                    if (field.showIf && currentRoom!.data[field.showIf.key] !== field.showIf.value) return null;
                    if (field.type === "dimensions" && field.dimensionKeys) {
                      return (
                        <div key={field.key} className="col-span-2">
                          <label className="mb-2 block text-sm font-medium text-heading">{field.label}</label>
                          <div className="flex items-end gap-12">
                            {field.dimensionKeys.map((dim) => (
                              <div key={dim.ftKey} className="flex-1">
                                <span className="mb-1.5 block text-xs text-faint">{dim.label}</span>
                                <div className="flex items-center gap-1.5">
                                  <div className="relative flex-1">
                                    <input type="number" value={currentRoom!.data[dim.ftKey] ?? ""} onChange={(e) => updateRoomField(activeView.buildingId, activeView.roomId, dim.ftKey, e.target.value)} placeholder="0" className="forge-input pr-8" />
                                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">ft</span>
                                  </div>
                                  <div className="relative flex-1">
                                    <input type="number" value={currentRoom!.data[dim.inKey] ?? ""} onChange={(e) => updateRoomField(activeView.buildingId, activeView.roomId, dim.inKey, e.target.value)} placeholder="0" className="forge-input pr-8" />
                                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">in</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    if (field.type === "photo_extras") {
                      return (
                        <PhotoExtras
                          key={field.key}
                          roomData={currentRoom!.data}
                          onUpdate={(k: string, v: string) => updateRoomField(activeView.buildingId, activeView.roomId, k, v)}
                          onBatchUpdate={(updates: Record<string, string>) => updateRoomFields(activeView.buildingId, activeView.roomId, updates)}
                        />
                      );
                    }
                    return (
                      <div key={field.key} className={`flex flex-col ${field.fullWidth ? "col-span-2" : ""} ${field.colStart === 1 ? "col-start-1" : ""}`}>
                        <label className="mb-1.5 block text-sm font-medium text-heading">{field.label}</label>
                        {renderField(field, currentRoom!.data[field.key] ?? "", (val) => updateRoomField(activeView.buildingId, activeView.roomId, field.key, val))}
                        {field.hint && <p className="mt-1.5 text-[11px] text-faint">{field.hint}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
              )}

            </>
          )}
        </div>

        {/* ── Section sticky bottom nav ────────────────── */}
        {activeView?.type === "room" && currentRoom && currentSection && (
          <div className="shrink-0 bg-forge-bg">
            <div className="mx-6 border-t border-border" />
            <div className="flex items-center justify-between py-4 pl-6 pr-20">
            {ROOM_SECTIONS.indexOf(currentSection) > 0 ? (
              <button
                onClick={() => setActiveView({ ...activeView, sectionId: ROOM_SECTIONS[ROOM_SECTIONS.indexOf(currentSection!) - 1].id })}
                className="flex items-center gap-1.5 text-sm text-subtle transition-colors hover:text-secondary"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                {ROOM_SECTIONS[ROOM_SECTIONS.indexOf(currentSection!) - 1].title}
              </button>
            ) : <div />}
            {ROOM_SECTIONS.indexOf(currentSection) < ROOM_SECTIONS.length - 1 ? (
              <button
                onClick={() => setActiveView({ ...activeView, sectionId: ROOM_SECTIONS[ROOM_SECTIONS.indexOf(currentSection!) + 1].id })}
                className="flex items-center gap-1.5 text-sm text-subtle transition-colors hover:text-secondary"
              >
                {ROOM_SECTIONS[ROOM_SECTIONS.indexOf(currentSection!) + 1].title}
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            ) : (
              <button onClick={handleSave} disabled={!dirty && !saved} className="forge-btn-primary text-[13px] disabled:cursor-not-allowed disabled:opacity-40">
                {saved ? (
                  <><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Saved</>
                ) : (
                  <>Complete Survey</>
                )}
              </button>
            )}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* ── AI Minimized Bar ────────────────────────── */}
      {showAIModal && aiMinimized && (
        <div className="fixed bottom-0 left-0 right-0 z-[1000] flex items-center justify-between border-t border-violet-500/30 bg-forge-panel pl-6 pr-24 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.2)]">
          <div className="flex items-center gap-3">
            {aiRecording && <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />}
            <span className="text-sm font-semibold text-heading">
              {aiRecording ? "AI Recording in progress" : "Create with AI"}
            </span>
            <span className="text-xs text-subtle">Minimized — click Restore to view</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAiMinimized(false)}
              className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-400 transition-colors hover:bg-violet-500/20"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Restore
            </button>
            <button
              onClick={() => { if (aiRecording) { setAiSaveAndClose(true); } else { setShowAIModal(false); setAiMinimized(false); } }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
            >
              {aiRecording ? "Stop & Close" : "Close"}
            </button>
          </div>
        </div>
      )}

      {/* ── AI Recording Modal ──────────────────────── */}
      {showAIModal && (
        <div className={aiMinimized ? "hidden" : ""}>
        <AIRecordingModal
          onClose={() => { setShowAIModal(false); setAiMinimized(false); setAiRecording(false); setAiSaveAndClose(false); }}
          onMinimize={() => setAiMinimized(true)}
          onRecordingChange={setAiRecording}
          shouldSaveAndClose={aiSaveAndClose}
          existingRooms={survey.buildings.flatMap(b => b.rooms.map(r => r.data.room_name || r.name))}
          activeRoomName={currentRoom ? (currentRoom.data.room_name || currentRoom.name) : undefined}
          savedSummaries={((survey as any).ai_summaries as any[]) || []}
          onSaveSummary={(summary: any) => {
            const next = { ...survey, ai_summaries: [...(((survey as any).ai_summaries as any[]) || []), summary] } as any;
            persist(next);
          }}
          onDeleteSummary={(index: number) => {
            // Only removes the history entry itself — whatever it already
            // applied lives in buildings/rooms data, entirely separate from
            // ai_summaries, so deleting this record never touches it.
            const current = (((survey as any).ai_summaries as any[]) || []).slice();
            if (index < 0 || index >= current.length) return;
            current.splice(index, 1);
            const next = { ...survey, ai_summaries: current } as any;
            persist(next);
          }}
          onApply={(aiData: any) => {
            const next = { ...survey };
            // Apply into whichever building is currently being viewed, not
            // always the first one — a survey with more than one building
            // (or the user simply not being on building #1) was silently
            // writing the AI's data, including any new room, into the wrong
            // building, making it look like room creation had failed.
            const building = next.buildings.find(b => b.id === activeView?.buildingId) || next.buildings[0];
            const result: ApplyResult = { updated: [], created: [] };
            if (!building) return result;

            // Apply building-level data
            if (aiData.building) {
              Object.entries(aiData.building).forEach(([k, v]) => {
                if (v && typeof v === "string" && v.trim()) building.data[k] = v;
              });
            }

            // Apply room data
            const activeRoomId = activeView?.type === "room" ? activeView.roomId : null;
            if (aiData.rooms && Array.isArray(aiData.rooms)) {
              aiData.rooms.forEach((aiRoom: any) => {
                const roomName = aiRoom.room_name || "";
                let room = roomName
                  ? building.rooms.find(r => (r.data.room_name || r.name).toLowerCase() === roomName.toLowerCase())
                  : undefined;
                // No name came back from the AI for this room (or it's the
                // only room extracted) — rather than silently discarding its
                // data, apply it to whichever room the user is actively
                // viewing, since that's almost always what they meant.
                if (!room && !roomName && aiData.rooms.length === 1 && activeRoomId) {
                  room = building.rooms.find(r => r.id === activeRoomId);
                }
                let isNew = false;
                if (!room && roomName) {
                  room = { id: crypto.randomUUID(), name: roomName, data: { room_name: roomName } };
                  building.rooms.push(room);
                  isNew = true;
                }
                if (room) {
                  Object.entries(aiRoom).forEach(([k, v]) => {
                    if (k !== "room_name" && v && typeof v === "string" && v.trim()) {
                      room!.data[k] = v;
                    }
                  });
                  const label = room.data.room_name || room.name;
                  const bucket = isNew ? result.created : result.updated;
                  if (!bucket.includes(label)) bucket.push(label);
                }
              });
            }

            persist(next);
            return result;
            // Don't close the modal — applyAndFlash already auto-saves this
            // to Past Summaries; leaving it open lets the user keep recording
            // or apply again. They close it themselves.
          }}
        />
        </div>
      )}

      {deleteRoomConfirm && (
        <ConfirmDialog
          title="Delete this room?"
          message={<>Delete <span className="font-semibold text-heading">{deleteRoomConfirm.name}</span>? This removes it — and everything recorded for it — from Site Survey and every design tool (Design Engineering, Room Designer, Signal Flow, Rack Builder, Proposal). This can&apos;t be undone.</>}
          onCancel={() => setDeleteRoomConfirm(null)}
          onConfirm={() => {
            removeRoom(deleteRoomConfirm.buildingId, deleteRoomConfirm.roomId);
            setDeleteRoomConfirm(null);
          }}
        />
      )}
    </div>
  );
}

/* ── AI Recording Modal ───────────────────────────────────── */
type ApplyResult = { updated: string[]; created: string[] };

function AIRecordingModal({ onClose, onMinimize, onRecordingChange, shouldSaveAndClose, existingRooms, activeRoomName, onApply, savedSummaries, onSaveSummary, onDeleteSummary }: {
  onClose: () => void;
  onMinimize: () => void;
  onRecordingChange: (recording: boolean) => void;
  shouldSaveAndClose: boolean;
  existingRooms: string[];
  activeRoomName?: string;
  onApply: (data: any) => ApplyResult | void;
  savedSummaries: any[];
  onSaveSummary: (summary: any) => void;
  onDeleteSummary: (index: number) => void;
}) {
  const [consented, setConsented] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [aiResult, setAiResult] = useState<any>(null);
  const [viewingSaved, setViewingSaved] = useState(false);
  const [applyFlash, setApplyFlash] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [appliedHistoryIndex, setAppliedHistoryIndex] = useState<number | null>(null);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const recognitionRef = useRef<any>(null);

  // Auto-generated save label — no manual naming step. Uses whichever
  // room(s) this extraction covered (the actual distinguishing detail
  // between saved summaries on the same project) plus a date/time stamp.
  function autoSummaryLabel(_data: any): string {
    return new Date().toLocaleString();
  }

  function applyAndFlash(data: any) {
    setApplyResult(onApply(data) ?? null);
    // Only auto-save a fresh extraction — reapplying an already-saved
    // Past Summary would otherwise create a duplicate entry of itself.
    if (!viewingSaved) {
      onSaveSummary({
        label: autoSummaryLabel(data),
        date: new Date().toISOString(),
        transcript: transcript.replace(/\[\.\.\..*?\]/g, "").trim(),
        data,
        fieldsExtracted: countFields(data),
      });
    }
    setApplyFlash(true);
    setTimeout(() => setApplyFlash(false), 6000);
  }

  function applyHistoryAndFlash(data: any, i: number) {
    onApply(data);
    setAppliedHistoryIndex(i);
    setTimeout(() => setAppliedHistoryIndex((cur) => (cur === i ? null : cur)), 2000);
  }

  // Auto-cap: if someone forgets to hit Stop, the recording (and the mic)
  // would otherwise run forever. After 2 hours of wall-clock time since
  // recording first started (not "active recording" time — a forgotten,
  // left-paused session should still get rescued), automatically stop,
  // summarize, and apply whatever was captured, so the work isn't lost.
  const MAX_RECORDING_MS = 2 * 60 * 60 * 1000;
  const autoCapTimerRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptRef = useRef(transcript);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => () => { if (autoCapTimerRef.current) clearTimeout(autoCapTimerRef.current); }, []);

  async function handleAutoCapReached() {
    autoCapTimerRef.current = null;
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setRecording(false);
    setPaused(false);
    onRecordingChange(false);
    const cleanTranscript = transcriptRef.current.replace(/\[\.\.\..*?\]/g, "").trim();
    setTranscript(cleanTranscript);
    if (cleanTranscript.length < 20) return;

    setProcessing(true);
    setError("");
    try {
      const res = await fetch("/api/summarize-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: cleanTranscript, existingRooms, activeRoom: activeRoomName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to process");
      setAiResult(json.data);
      onSaveSummary({
        label: `${autoSummaryLabel(json.data)} · Auto-applied (2hr limit)`,
        date: new Date().toISOString(),
        transcript: cleanTranscript,
        data: json.data,
        fieldsExtracted: countFields(json.data),
      });
      onApply(json.data);
    } catch (e: any) {
      setError(`Recording auto-stopped after 2 hours, but summarizing failed: ${e.message || "Failed to summarize"}. Your transcript is still here — you can retry "Summarize with AI" manually.`);
    } finally {
      setProcessing(false);
    }
  }

  useEffect(() => {
    if (!shouldSaveAndClose) return;
    if (autoCapTimerRef.current) { clearTimeout(autoCapTimerRef.current); autoCapTimerRef.current = null; }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    const cleanTranscript = transcript.replace(/\[\.\.\..*?\]/g, "").trim();
    if (cleanTranscript || aiResult) {
      const label = autoSummaryLabel(aiResult);
      onSaveSummary({
        label,
        date: new Date().toISOString(),
        transcript: cleanTranscript,
        data: aiResult,
        fieldsExtracted: countFields(aiResult),
      });
    }
    onClose();
  }, [shouldSaveAndClose]);

  function startRecording() {
    setError("");
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser. Please use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = transcript;
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(finalTranscript + (interim ? `[...${interim}]` : ""));
    };

    recognition.onerror = (event: any) => {
      const msgs: Record<string, string> = {
        "not-allowed": "Microphone access denied. Click the lock icon in your browser address bar and allow microphone access, then refresh.",
        "audio-capture": "No microphone detected. Please check that a microphone is connected.",
        "network": "Network error — Chrome needs internet access to transcribe speech. Please check your connection.",
        "service-not-allowed": "Speech recognition service is blocked. Try using Chrome on localhost.",
        "no-speech": "",
      };
      const msg = msgs[event.error] ?? `Speech recognition error: ${event.error}`;
      if (msg) setError(msg);
    };

    recognition.onend = () => {
      // Auto-restart if still recording
      if (recognitionRef.current) {
        try { recognition.start(); } catch {}
      }
    };

    try {
      recognition.start();
    } catch (e: any) {
      setError("Failed to start recording: " + (e?.message ?? e));
      return;
    }
    recognitionRef.current = recognition;
    setRecording(true);
    onRecordingChange(true);
    if (!autoCapTimerRef.current) {
      autoCapTimerRef.current = setTimeout(handleAutoCapReached, MAX_RECORDING_MS);
    }
  }

  function stopRecording() {
    if (autoCapTimerRef.current) { clearTimeout(autoCapTimerRef.current); autoCapTimerRef.current = null; }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setRecording(false);
    setPaused(false);
    onRecordingChange(false);
    // Clean up interim markers
    setTranscript(prev => prev.replace(/\[\.\.\..*?\]/g, "").trim());
  }

  function pauseRecording() {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setTranscript(prev => prev.replace(/\[\.\.\..*?\]/g, "").trim());
    setPaused(true);
  }

  function resumeRecording() {
    setPaused(false);
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let finalTranscript = transcript;
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(finalTranscript + (interim ? `[...${interim}]` : ""));
    };
    recognition.onerror = (event: any) => {
      const msgs: Record<string, string> = {
        "not-allowed": "Microphone access denied. Click the lock icon in your browser address bar and allow microphone access, then refresh.",
        "audio-capture": "No microphone detected. Please check that a microphone is connected.",
        "network": "Network error — Chrome needs internet access to transcribe speech. Please check your connection.",
        "service-not-allowed": "Speech recognition service is blocked. Try using Chrome on localhost.",
        "no-speech": "",
      };
      const msg = msgs[event.error] ?? `Speech recognition error: ${event.error}`;
      if (msg) setError(msg);
    };
    recognition.onend = () => {
      if (recognitionRef.current) {
        try { recognition.start(); } catch {}
      }
    };
    try {
      recognition.start();
    } catch (e: any) {
      setError("Failed to resume recording: " + (e?.message ?? e));
      setPaused(false);
      return;
    }
    recognitionRef.current = recognition;
  }

  async function summarize() {
    const cleanTranscript = transcript.replace(/\[\.\.\..*?\]/g, "").trim();
    if (cleanTranscript.length < 20) {
      setError("Transcript is too short. Please record more of the conversation.");
      return;
    }

    setProcessing(true);
    setError("");
    try {
      const res = await fetch("/api/summarize-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: cleanTranscript, existingRooms, activeRoom: activeRoomName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to process");
      setAiResult(json.data);
    } catch (e: any) {
      setError(e.message || "Failed to summarize");
    } finally {
      setProcessing(false);
    }
  }

  function countFields(data: any): number {
    let count = 0;
    if (data?.building) count += Object.values(data.building).filter((v: any) => v && String(v).trim()).length;
    if (data?.rooms) data.rooms.forEach((r: any) => { count += Object.values(r).filter((v: any) => v && String(v).trim()).length; });
    return count;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-[700px] flex-col overflow-hidden rounded-xl border border-border bg-forge-bg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold text-heading">Create with AI</h3>
          <div className="flex items-center gap-1">
            <button onClick={onMinimize} className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-forge-surface hover:text-secondary" title="Minimize">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-forge-surface hover:text-secondary" title="Close">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Consent Notice */}
          {!consented && !showHistory && (
            <div className="flex flex-col items-center gap-5 py-6 text-center">
              <p className="mx-auto max-w-md text-sm leading-relaxed text-muted">
                Record your walkthrough and let AI create a summary and fill the site survey details. Always ask permission before recording
              </p>
              <button
                onClick={() => setConsented(true)}
                className="flex items-center gap-2 rounded-lg bg-violet-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-600"
              >
                Start walkthrough
              </button>
            </div>
          )}

          {showHistory && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-heading">Past Summaries</div>
                <button
                  onClick={() => { setShowHistory(false); setViewingSaved(false); }}
                  className="text-xs font-medium text-subtle transition-colors hover:text-secondary"
                >
                  ← Back
                </button>
              </div>
              {savedSummaries.length === 0 ? (
                <p className="py-4 text-center text-sm text-subtle">No saved summaries yet</p>
              ) : (
                <div className="space-y-3">
                  {savedSummaries.map((s: any, i: number) => (
                    <div key={i} className="rounded-lg border border-border bg-forge-surface/40 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-heading">{s.label}</span>
                        <span className="text-xs text-faint">{new Date(s.date).toLocaleDateString()} · {s.fieldsExtracted} fields</span>
                      </div>
                      {s.transcript && (
                        <p className="mb-3 line-clamp-2 text-xs text-subtle">{s.transcript}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setAiResult(s.data); setTranscript(s.transcript || ""); setConsented(true); setViewingSaved(true); setShowHistory(false); }}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:bg-forge-surface"
                        >
                          View Details
                        </button>
                        <button
                          onClick={() => applyHistoryAndFlash(s.data, i)}
                          className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20"
                        >
                          {appliedHistoryIndex === i ? (
                            <><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Applied</>
                          ) : (
                            <>Apply to Survey</>
                          )}
                        </button>
                        <button
                          onClick={() => setPendingDeleteIndex(i)}
                          title="Delete this summary"
                          className="ml-auto rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-400"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4 4v9a1 1 0 001 1h6a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {consented && !showHistory && <>
          {viewingSaved && (
            <div className="mb-4 flex items-center justify-end">
              <button
                onClick={() => setShowHistory(true)}
                className="text-xs font-medium text-subtle transition-colors hover:text-secondary"
              >
                ← Back
              </button>
            </div>
          )}
          {/* Step 1: Record */}
          {!viewingSaved && (
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-heading">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-bold text-violet-400">1</span>
              Record Conversation
            </div>
            <div className="flex items-center gap-3">
              {!recording ? (
                <button onClick={startRecording} className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
                  </svg>
                  Start Recording
                </button>
              ) : (
                <>
                  <button onClick={paused ? resumeRecording : pauseRecording} className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/20">
                    {paused ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2l10 6-10 6V2z" /></svg>
                        Resume
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>
                        Pause
                      </>
                    )}
                  </button>
                  <button onClick={stopRecording} className="flex items-center gap-2 rounded-lg border-2 border-red-500 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20">
                    <span className={`h-3 w-3 rounded-full bg-red-500 ${paused ? "" : "animate-pulse"}`} />
                    Stop Recording
                  </button>
                </>
              )}
            </div>
          </div>
          )}

          {/* Transcript */}
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-heading">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-bold text-violet-400">2</span>
              Transcript
            </div>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Transcript will appear here as you speak... You can also type or paste a conversation."
              rows={8}
              className="forge-input w-full resize-y font-mono text-xs"
            />
          </div>

          {/* Step 3: Summarize */}
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-heading">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-bold text-violet-400">3</span>
              Extract Survey Data
            </div>
            <button
              onClick={summarize}
              disabled={recording || processing || transcript.replace(/\[\.\.\..*?\]/g, "").trim().length < 20}
              title={recording ? "Stop recording before summarizing" : undefined}
              className="flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-40"
            >
              {processing ? (
                <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />Analyzing...</>
              ) : (
                <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5L18.2 21 12 16.5 5.8 21l2.4-7.1L2 9.4h7.6z" /></svg>Summarize with AI</>
              )}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
          )}

          {/* AI Result Preview */}
          {aiResult && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-400">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                AI extracted {countFields(aiResult)} fields
              </div>
              {aiResult.building && Object.entries(aiResult.building).some(([, v]: any) => v?.trim()) && (
                <div className="mb-2">
                  <div className="text-xs font-semibold text-muted">Building Info</div>
                  <div className="mt-1 space-y-0.5">
                    {Object.entries(aiResult.building).filter(([, v]: any) => v?.trim()).map(([k, v]: any) => (
                      <div key={k} className="text-xs text-secondary"><span className="text-subtle">{k}:</span> {v}</div>
                    ))}
                  </div>
                </div>
              )}
              {aiResult.rooms?.map((room: any, i: number) => (
                <div key={i} className="mt-2">
                  <div className="text-xs font-semibold text-muted">{room.room_name || `Room ${i + 1}`}</div>
                  <div className="mt-1 space-y-0.5">
                    {Object.entries(room).filter(([, v]: any) => v?.trim()).slice(0, 10).map(([k, v]: any) => (
                      <div key={k} className="text-xs text-secondary"><span className="text-subtle">{k}:</span> {v}</div>
                    ))}
                    {Object.entries(room).filter(([, v]: any) => v?.trim()).length > 10 && (
                      <div className="text-xs text-subtle">...and {Object.entries(room).filter(([, v]: any) => v?.trim()).length - 10} more fields</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 4: Apply to Survey */}
          <div className="mt-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-heading">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-bold text-violet-400">4</span>
              Apply to Survey
            </div>
            <button
              onClick={() => aiResult && applyAndFlash(aiResult)}
              disabled={!aiResult}
              title={!aiResult ? "Run step 3 to extract survey data first" : undefined}
              className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-500"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {applyFlash ? "Applied to Survey" : "Apply to Survey"}
            </button>
            {applyFlash && (
              <p className="mt-2 text-xs text-emerald-400">
                {applyResult && (applyResult.updated.length > 0 || applyResult.created.length > 0) ? (
                  <>
                    {applyResult.updated.length > 0 && <>Filled in: {applyResult.updated.join(", ")}. </>}
                    {applyResult.created.length > 0 && <>Created new room{applyResult.created.length > 1 ? "s" : ""}: {applyResult.created.join(", ")}. </>}
                  </>
                ) : "Applied. "}
                Saved to Past Summaries with a date/time stamp.
              </p>
            )}
          </div>
          </>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 text-xs font-medium text-subtle transition-colors hover:text-secondary"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" /><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            Past Summaries {savedSummaries.length > 0 && `(${savedSummaries.length})`}
          </button>
          <button onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-body">Cancel</button>
        </div>

      </div>

      {pendingDeleteIndex !== null && (
        <ConfirmDialog
          title="Delete this summary?"
          message={<>Delete <span className="font-semibold text-heading">{savedSummaries[pendingDeleteIndex]?.label}</span> from Past Summaries? This only removes the saved record — anything already applied to the survey stays exactly as it is.</>}
          onCancel={() => setPendingDeleteIndex(null)}
          onConfirm={() => {
            onDeleteSummary(pendingDeleteIndex);
            setPendingDeleteIndex(null);
          }}
        />
      )}
    </div>
  );
}

/* ── Field renderer ────────────────────────────────────────── */
function renderField(field: Field, value: string, onChange: (val: string) => void) {
  if (field.type === "photo") return <PhotoField value={value} onChange={onChange} />;
  if (field.type === "select") {
    return (
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)} className="forge-input !bg-forge-panel w-full appearance-none pr-9">
          <option value="">Select...</option>
          {field.options!.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </div>
    );
  }
  if (field.type === "textarea") {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} rows={field.rows ?? 3} className="forge-input !bg-forge-panel resize-y" />;
  }
  return (
    <div className="relative">
      <input type={field.type} value={value} onChange={(e) => onChange(field.integer ? e.target.value.replace(/[^0-9]/g, "") : e.target.value)} onKeyDown={field.integer ? (e) => { if ([".", ",", "e", "E", "+", "-"].includes(e.key)) e.preventDefault(); } : undefined} placeholder={field.placeholder} step={field.integer ? "1" : undefined} className={`forge-input !bg-forge-panel ${field.unit ? "pr-12" : ""}`} />
      {field.unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{field.unit}</span>}
    </div>
  );
}

/* ── Compact room photo card (Room Assessment section) ─────── */
function RoomPhotoCard({ label, value, onChange, onLabelChange, onRemoveCard }: { label: string; value: string; onChange: (val: string) => void; onLabelChange?: (label: string) => void; onRemoveCard?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editLabel, setEditLabel] = useState(label);
  const hasPhoto = value && value !== "N/A" && value.startsWith("data:");

  function processFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.createElement("img");
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = (h / w) * MAX; w = MAX; } else { w = (w / h) * MAX; h = MAX; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        onChange(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    e.target.value = "";
  }

  return (
    <>
      {/* Card — thumbnail when photo exists, camera icon when empty */}
      <div
        onClick={() => !hasPhoto && fileRef.current?.click()}
        className={`group relative flex h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-border px-4 py-5 text-center transition-colors hover:border-border-light hover:bg-forge-surface/20 ${!hasPhoto ? "cursor-pointer" : ""}`}
      >
        {onRemoveCard && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemoveCard(); }}
            className="absolute right-1.5 top-1.5 rounded-md p-0.5 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-forge-surface hover:text-secondary"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
        {hasPhoto ? (
          <div className="h-10 w-10 cursor-pointer overflow-hidden rounded-lg" onClick={() => setModalOpen(true)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={label} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-violet-400/70">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
        )}
        {hasPhoto ? (
          <input
            type="text"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onBlur={() => onLabelChange?.(editLabel)}
            onKeyDown={(e) => e.key === "Enter" && onLabelChange?.(editLabel)}
            onClick={(e) => e.stopPropagation()}
            style={{ width: `${Math.max(5, editLabel.length)}ch` }}
            className="bg-transparent text-center text-sm font-medium text-heading outline-none border-b border-transparent focus:border-border-light"
          />
        ) : (
          <>
            <p className="text-sm font-medium text-heading">{label}</p>
            <p className="mt-0.5 text-xs text-faint">Not added</p>
          </>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-border bg-forge-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="text-base font-semibold text-heading bg-transparent outline-none border-b border-transparent focus:border-border-light w-full mr-4"
              />
              <button
                onClick={() => setModalOpen(false)}
                className="shrink-0 rounded-lg p-1.5 text-subtle transition-colors hover:bg-forge-surface hover:text-heading"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {/* Image */}
            <div className="px-6 py-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={value} alt={editLabel} className="max-h-[60vh] w-full rounded-xl object-contain" />
            </div>
            {/* Modal footer */}
            <div className="flex items-center justify-between border-t border-border px-6 py-4">
              <button
                onClick={() => { onChange(""); setModalOpen(false); }}
                className="flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
                Remove Photo
              </button>
              <div className="flex items-center gap-2">
              <a
                href={value}
                download={`${editLabel.replace(/\s+/g, "_")}.jpg`}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-forge-surface hover:text-secondary"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download
              </a>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-forge-surface hover:text-secondary"
              >
                Replace
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </>
  );
}

/* ── Add-more photo card (Room Assessment grid) ─────────────── */
function AddMorePhotoCard({ nextNumber, onAdd }: { nextNumber: number; onAdd: (dataUrl: string, label: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.createElement("img");
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = (h / w) * MAX; w = MAX; } else { w = (w / h) * MAX; h = MAX; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        onAdd(canvas.toDataURL("image/jpeg", 0.7), `Image ${nextNumber}`);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  return (
    <>
      <div
        onClick={() => fileRef.current?.click()}
        className="flex h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-5 text-center transition-colors hover:border-violet-400/40 hover:bg-violet-500/5"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-forge-surface/60">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-faint">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <p className="text-xs font-medium text-muted">Add more Photos</p>
          <p className="mt-0.5 text-[11px] text-faint">Optional</p>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </>
  );
}

/* ── Photo upload / capture field ──────────────────────────── */
function PhotoField({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const isNA = value === "N/A";
  const hasPhoto = value && value !== "N/A" && value.startsWith("data:");

  function processFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.createElement("img");
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = (h / w) * MAX; w = MAX; } else { w = (w / h) * MAX; h = MAX; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        onChange(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  if (hasPhoto) {
    return (
      <div className="group relative">
        <div className="relative overflow-hidden rounded-lg border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Survey photo" className="h-40 w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
            <button onClick={() => fileRef.current?.click()} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-white/20">Replace</button>
            <button onClick={() => onChange("")} className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-300 backdrop-blur-sm hover:bg-red-500/30">Remove</button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      </div>
    );
  }

  if (isNA) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex h-[100px] flex-1 items-center justify-center rounded-lg border border-border bg-forge-surface/40">
          <span className="text-sm text-subtle">Marked as N/A</span>
        </div>
        <button onClick={() => onChange("")} className="shrink-0 text-xs text-subtle hover:text-secondary">Reset</button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border bg-forge-surface/10 px-3 py-6 text-center transition-colors hover:border-border-light hover:bg-forge-surface/20"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/15">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-violet-400">
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      <div>
        <p className="text-xs text-muted">Drag & drop image here</p>
        <p className="mt-0.5 text-[11px] text-faint">or</p>
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-forge-surface hover:text-secondary"
      >
        Choose File
      </button>
      <p className="text-[10px] text-faint">JPG, PNG up to 10MB</p>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}

/* ── Dynamic extra photos ─────────────────────────────────── */
const PhotoExtras = forwardRef<{ triggerAdd: () => void }, { roomData: Record<string, string>; onUpdate: (key: string, val: string) => void; onBatchUpdate: (updates: Record<string, string>) => void }>(
  function PhotoExtras({ roomData, onUpdate, onBatchUpdate }, ref) {
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");

  useImperativeHandle(ref, () => ({ triggerAdd: () => setNaming(true) }));

  // Extra photo names stored as JSON array in a single key
  const extraNames: string[] = (() => {
    try { return JSON.parse(roomData["photo_extra_names"] || "[]"); } catch { return []; }
  })();

  function addExtra() {
    if (!newName.trim()) return;
    const updated = [...extraNames, newName.trim()];
    onUpdate("photo_extra_names", JSON.stringify(updated));
    setNewName("");
    setNaming(false);
  }

  function removeExtra(idx: number) {
    const updated = extraNames.filter((_, i) => i !== idx);
    const batch: Record<string, string> = {
      photo_extra_names: JSON.stringify(updated),
    };
    // Shift photo data keys down
    for (let i = idx; i < extraNames.length - 1; i++) {
      batch[`photo_extra_${i}_data`] = roomData[`photo_extra_${i + 1}_data`] || "";
    }
    batch[`photo_extra_${extraNames.length - 1}_data`] = "";
    onBatchUpdate(batch);
  }

  return (
    <>
      {extraNames.map((name, i) => (
        <div key={i} className="flex flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-medium text-muted">{name}</label>
            <button onClick={() => removeExtra(i)} className="text-[11px] text-red-400 hover:text-red-300">Remove</button>
          </div>
          <PhotoField
            value={roomData[`photo_extra_${i}_data`] ?? ""}
            onChange={(val) => onUpdate(`photo_extra_${i}_data`, val)}
          />
        </div>
      ))}

      <div className="flex flex-col">
        {naming ? (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-muted">Photo Name</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addExtra()}
                placeholder="e.g. Equipment Closet"
                className="forge-input flex-1"
                autoFocus
              />
              <button onClick={addExtra} disabled={!newName.trim()} className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-40">Add</button>
              <button onClick={() => { setNaming(false); setNewName(""); }} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted hover:text-body">Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
});
