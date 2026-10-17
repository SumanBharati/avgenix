// AI-driven scope→topology proposal for Signal Flow: given the generic
// equipment units a scope description already resolved to (ScopeUnit, from
// lib/scope-manifest.ts), ask AI for each unit's likely role + logical ports
// and a proposed wiring topology, then keep only the connections that are
// physically valid (matching signal types, output→input direction, no
// self-loops, one driver per input).
//
// Deliberately NOT part of lib/scope-manifest.ts: ScopeUnit/ScopeManifest are
// shared with Room Designer and Rack Builder, which have no use for ports or
// wiring — this stays Signal-Flow-only.

import type { GeneratedDevice, ProposedConnection } from "@/lib/signal-flow-types";

export interface TopologyUnitInput {
  itemId: string;
  label: string;
  category: string;
  location: string | null;
  /** A real library product's name, when this unit already is one. */
  product?: string;
  /** That product's actual ports — the AI must wire through exactly these. */
  ports?: GeneratedDevice["ports"];
}

/**
 * Deterministic validation pass over the AI's proposed connections. Only
 * physical/electrical validity is checked here (direction + signal type) —
 * this is the "AV rules" layer the AI proposal must survive before it's
 * ever drawn.
 */
export function validateProposedConnections(
  devices: GeneratedDevice[],
  proposed: ProposedConnection[],
): ProposedConnection[] {
  const portsByItem = new Map<string, Map<string, GeneratedDevice["ports"][number]>>();
  for (const d of devices) {
    portsByItem.set(d.itemId, new Map(d.ports.map((p) => [p.id, p])));
  }

  const valid: ProposedConnection[] = [];
  const seenPairs = new Set<string>();
  const claimedInputs = new Set<string>(); // `${itemId}:${portId}` of targets already driven

  for (const conn of proposed) {
    if (conn.sourceItemId === conn.targetItemId) continue; // no self-loops

    const sourcePort = portsByItem.get(conn.sourceItemId)?.get(conn.sourcePortId);
    const targetPort = portsByItem.get(conn.targetItemId)?.get(conn.targetPortId);
    if (!sourcePort || !targetPort) continue; // unknown device/port reference

    if (sourcePort.direction !== "output" || targetPort.direction !== "input") continue;
    if (sourcePort.signalType !== targetPort.signalType) continue;
    if (conn.signalType !== sourcePort.signalType) continue;

    const pairKey = `${conn.sourceItemId}:${conn.sourcePortId}>${conn.targetItemId}:${conn.targetPortId}`;
    if (seenPairs.has(pairKey)) continue; // exact duplicate

    const targetKey = `${conn.targetItemId}:${conn.targetPortId}`;
    if (claimedInputs.has(targetKey)) continue; // one driver per input port

    seenPairs.add(pairKey);
    claimedInputs.add(targetKey);
    valid.push(conn);
  }

  return valid;
}

/** Asks AI to propose roles/ports/topology for a set of scope-generated units. */
export async function fetchProposedTopology(
  units: TopologyUnitInput[],
  /** Manufacturer reference cables the AI must include (lib/wiring). */
  references: string[] = [],
): Promise<{ devices: GeneratedDevice[]; connections: ProposedConnection[] }> {
  const res = await fetch("/api/generate-signal-flow-topology", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ units, references }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to generate signal flow topology");
  }
  const data = await res.json();
  return {
    devices: Array.isArray(data?.devices) ? data.devices : [],
    connections: Array.isArray(data?.connections) ? data.connections : [],
  };
}
