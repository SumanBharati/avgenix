'use client';

import { useEffect, useState } from 'react';
import { CalcSection, ResultCard, StatusBanner, CalcPageWrapper } from '@/components/calc';
import { getPoeProducts } from '@/lib/av-products';
import { getOrgPoeItems } from '@/lib/equipment-library';
import { useOrg } from '@/components/OrgProvider';

interface CustomDevice { name: string; volts: number; mah: number; qty: number; }
interface PresetEntry  { name: string; qty: number; }
interface SwitchEntry  { model: string; capacity: number; }
interface PoeOption    { name: string; draw: number; standard: string; source: 'AVGenix' | 'Org'; }

const cellInput: React.CSSProperties = { padding: '5px 6px', background: 'rgb(var(--forge-surface))', border: '1px solid rgb(var(--border))', borderRadius: 4, color: 'rgb(var(--text-body))', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", outline: 'none', textAlign: 'center', width: '100%', boxSizing: 'border-box' };
const nameInput: React.CSSProperties = { ...cellInput, textAlign: 'left' };
const thSt: React.CSSProperties = { padding: '6px 6px', fontSize: 9, fontWeight: 700, color: 'rgb(var(--text-muted))', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid rgb(var(--border))', textAlign: 'center' };
const addBtn = 'mt-2 w-full rounded-md border border-dashed border-blue-500/40 bg-blue-500/10 py-1.5 text-[11px] text-blue-400 transition-colors hover:bg-blue-500/20';

// power_supply_type is free text (e.g. "PoE+ (IEEE 802.3at)"), not a dedicated
// PoE-class field yet — that's a future database improvement. This pulls out
// an explicit 802.3xx mention where present, falls back to a PoE/PoE+/PoE++
// wording match, and as a last resort (org library items have no supply-type
// text at all) guesses from the device's own wattage against the standard
// device-side power classes.
function classifyPoeStandard(watts: number, supplyType?: string | null): string {
  const text = supplyType || '';
  const explicit = text.match(/802\.3(af|at|bt)/i);
  if (explicit) return `802.3${explicit[1].toLowerCase()}`;
  if (/poe\+\+/i.test(text)) return '802.3bt';
  if (/poe\+/i.test(text)) return '802.3at';
  if (/\bpoe\b/i.test(text)) return '802.3af';
  if (watts <= 12.95) return '802.3af';
  if (watts <= 25.5) return '802.3at';
  if (watts <= 51) return '802.3bt';
  return '802.3bt (Type 4)';
}

export default function PoEBudgetPage() {
  const { activeOrg } = useOrg();
  const [libraryDevices, setLibraryDevices] = useState<PoeOption[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingLibrary(true);
    Promise.all([
      getPoeProducts().catch(() => []),
      activeOrg ? getOrgPoeItems(activeOrg.id).catch(() => []) : Promise.resolve([]),
    ]).then(([forgeItems, orgItems]) => {
      if (cancelled) return;
      const forgeOptions: PoeOption[] = forgeItems
        .filter((p) => (p.power_watts ?? 0) > 0)
        .map((p) => ({
          name: `${p.manufacturer} ${p.model_name}`,
          draw: p.power_watts as number,
          standard: classifyPoeStandard(p.power_watts as number, p.power_supply_type),
          source: 'AVGenix',
        }));
      const orgOptions: PoeOption[] = orgItems
        .filter((p) => (p.power_watts ?? 0) > 0)
        .map((p) => ({
          name: `${p.manufacturer} ${p.model}`,
          draw: p.power_watts as number,
          standard: classifyPoeStandard(p.power_watts as number, null),
          source: 'Org',
        }));
      setLibraryDevices([...forgeOptions, ...orgOptions]);
      setLoadingLibrary(false);
    });
    return () => { cancelled = true; };
  }, [activeOrg]);

  const [devices, setDevices] = useState<CustomDevice[]>([
    { name: 'Decoder A', volts: 48, mah: 140, qty: 12 },
    { name: 'Encoder B', volts: 48, mah: 185, qty: 4 },
  ]);
  const [switches, setSwitches] = useState<SwitchEntry[]>([
    { model: 'NETGEAR M4350-48G4X', capacity: 1440 },
  ]);
  const [presetDevices, setPresetDevices] = useState<PresetEntry[]>([]);

  // Seed one example row once the library finishes loading, same as the old
  // static-list default — but only if the user hasn't already added/removed rows.
  const [presetSeeded, setPresetSeeded] = useState(false);
  useEffect(() => {
    if (!presetSeeded && !loadingLibrary && libraryDevices.length > 0) {
      setPresetDevices([{ name: libraryDevices[0].name, qty: 1 }]);
      setPresetSeeded(true);
    }
  }, [loadingLibrary, libraryDevices, presetSeeded]);

  const updateDev = (i: number, f: keyof CustomDevice, v: string) => {
    const n = [...devices]; n[i] = { ...n[i], [f]: f === 'name' ? v : parseFloat(v) || 0 }; setDevices(n);
  };
  const updateSw = (i: number, f: keyof SwitchEntry, v: string) => {
    const n = [...switches]; n[i] = { ...n[i], [f]: f === 'model' ? v : parseFloat(v) || 0 }; setSwitches(n);
  };
  const updatePreset = (i: number, f: keyof PresetEntry, v: string) => {
    const n = [...presetDevices]; n[i] = { ...n[i], [f]: f === 'name' ? v : parseInt(v) || 0 }; setPresetDevices(n);
  };

  const devicesWithWatts = devices.map(d => ({ ...d, watts: (d.mah * d.volts) / 1000 }));
  const customTotal = devicesWithWatts.reduce((s, d) => s + d.watts * d.qty, 0);
  const presetItems = presetDevices.map(d => { const db = libraryDevices.find(p => p.name === d.name); return { ...d, draw: db ? db.draw : 0 }; });
  const presetTotal = presetItems.reduce((s, d) => s + d.draw * d.qty, 0);
  const totalDraw = customTotal + presetTotal;
  const totalPorts = devices.reduce((s, d) => s + d.qty, 0) + presetDevices.reduce((s, d) => s + d.qty, 0);
  const totalSwitchCapacity = switches.reduce((s, sw) => s + sw.capacity, 0);
  const maxBudget = totalSwitchCapacity * 0.8;
  const ok = totalDraw <= maxBudget;
  const recommended = totalDraw * 1.2;

  return (
    <CalcPageWrapper title="PoE Budget" desc="IEEE af/at/bt power budgeting for PoE devices">
      <div className="flex flex-col items-stretch gap-6 lg:flex-row">

        {/* ── Left half: Inputs ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
          <CalcSection title="PoE Process">
            <div className="mb-2 text-xs leading-relaxed text-muted">
              <div>1. Find the power requirements for each device (from spec sheet)</div>
              <div>2. Add all power requirements to determine your PoE budget</div>
              <div>3. Specify a switch capable of providing <strong className="text-amber-400">120%</strong> of the required budget</div>
            </div>
            <div className="rounded-md border border-blue-500/15 bg-blue-500/[0.06] p-2.5 text-center font-mono text-xs text-blue-400">
              Formula: <strong>(mAh) × (V) / 1000 = Watts</strong>
            </div>
          </CalcSection>

          {/* Custom Devices */}
          <CalcSection title="Devices (Custom mAh Entry)">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th style={{ ...thSt, textAlign: 'left', minWidth: 120 }}>Device</th>
                    <th style={{ ...thSt, width: 55 }}>Volts</th>
                    <th style={{ ...thSt, width: 60 }}>mAh</th>
                    <th style={{ ...thSt, width: 55 }}>Qty</th>
                    <th style={{ ...thSt, width: 70 }}>Watts</th>
                    <th style={{ ...thSt, width: 80 }}>Ext Watts</th>
                    <th style={{ width: 26 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {devicesWithWatts.map((d, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgb(var(--forge-surface) / 0.3)' }}>
                      <td style={{ padding: 3 }}><input value={d.name} onChange={e => updateDev(i, 'name', e.target.value)} style={nameInput} /></td>
                      <td style={{ padding: 3 }}><input type="number" value={d.volts} onChange={e => updateDev(i, 'volts', e.target.value)} style={cellInput} /></td>
                      <td style={{ padding: 3 }}><input type="number" value={d.mah} onChange={e => updateDev(i, 'mah', e.target.value)} style={cellInput} /></td>
                      <td style={{ padding: 3 }}><input type="number" value={d.qty} onChange={e => updateDev(i, 'qty', e.target.value)} min={0} style={cellInput} /></td>
                      <td className="px-1.5 text-center font-mono text-[12px] font-medium text-blue-400">{d.watts.toFixed(2)}</td>
                      <td className="px-1.5 text-center font-mono text-[12px] font-semibold text-body">{(d.watts * d.qty).toFixed(2)}</td>
                      <td style={{ padding: 3 }}><button onClick={() => setDevices(devices.filter((_, j) => j !== i))} className="text-sm text-red-400 opacity-60 hover:opacity-100">×</button></td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border">
                    <td colSpan={4} className="p-1.5 text-right text-[11px] font-bold text-body">Custom Total:</td>
                    <td></td>
                    <td className="p-1.5 text-center font-mono text-[13px] font-bold text-blue-400">{customTotal.toFixed(2)} W</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button onClick={() => setDevices([...devices, { name: 'Device', volts: 48, mah: 100, qty: 1 }])} className={addBtn}>
              + Add Custom Device
            </button>
          </CalcSection>

          {/* Preset Library */}
          <CalcSection title="Devices (From Library)">
            <div className="mb-1.5 text-[10px] leading-relaxed text-faint">
              Pulled from the AVGenix Equipment Library and your organization&apos;s library — any device with a known wattage and a PoE power supply. PoE standard (af/at/bt) is inferred from the power supply notes where available; a future update will store it as its own field.
            </div>
            {loadingLibrary ? (
              <div className="py-3 text-center text-[11px] text-subtle">Loading library devices…</div>
            ) : libraryDevices.length === 0 ? (
              <div className="py-3 text-center text-[11px] text-subtle">No PoE-powered devices found in your libraries yet.</div>
            ) : (
              <>
                <div className="mb-1.5 grid grid-cols-[1fr_50px_30px] gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  <span>Device</span><span className="text-center">Qty</span><span></span>
                </div>
                {presetItems.map((d, i) => (
                  <div key={i} className="mb-2 grid grid-cols-[1fr_50px_30px] items-center gap-1.5">
                    <select value={d.name} onChange={e => updatePreset(i, 'name', e.target.value)}
                      style={{ padding: '6px 8px', background: 'rgb(var(--forge-surface))', border: '1px solid rgb(var(--border))', borderRadius: 5, color: 'rgb(var(--text-body))', fontSize: 11, width: '100%' }}>
                      {libraryDevices.map(p => <option key={`${p.source}:${p.name}`} value={p.name}>{p.name} ({p.draw}W, {p.standard})</option>)}
                    </select>
                    <input type="number" value={d.qty} min={0} onChange={e => updatePreset(i, 'qty', e.target.value)}
                      style={{ padding: '6px 8px', background: 'rgb(var(--forge-surface))', border: '1px solid rgb(var(--border))', borderRadius: 5, color: 'rgb(var(--text-body))', fontSize: 12, textAlign: 'center', width: '100%' }} />
                    <button onClick={() => setPresetDevices(presetDevices.filter((_, j) => j !== i))} className="text-base text-red-400 hover:text-red-300">×</button>
                  </div>
                ))}
                <button onClick={() => setPresetDevices([...presetDevices, { name: libraryDevices[0].name, qty: 1 }])} className={addBtn}>
                  + Add Library Device
                </button>
              </>
            )}
          </CalcSection>

          {/* Switches */}
          <CalcSection title="Switches">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th style={{ ...thSt, textAlign: 'left', minWidth: 160 }}>Switch Model</th>
                    <th style={{ ...thSt, width: 90 }}>Capacity (W)</th>
                    <th style={{ ...thSt, width: 110 }}>Max PoE Budget (W)</th>
                    <th style={{ width: 26 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {switches.map((sw, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgb(var(--forge-surface) / 0.3)' }}>
                      <td style={{ padding: 3 }}><input value={sw.model} onChange={e => updateSw(i, 'model', e.target.value)} style={nameInput} placeholder="e.g., NETGEAR M4250" /></td>
                      <td style={{ padding: 3 }}><input type="number" value={sw.capacity} onChange={e => updateSw(i, 'capacity', e.target.value)} style={cellInput} /></td>
                      <td className="px-1.5 text-center font-mono text-[13px] font-semibold text-amber-400">{(sw.capacity * 0.8).toFixed(0)}</td>
                      <td style={{ padding: 3 }}><button onClick={() => setSwitches(switches.filter((_, j) => j !== i))} className="text-sm text-red-400 opacity-60 hover:opacity-100">×</button></td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border">
                    <td className="p-1.5 text-right text-[11px] font-bold text-body">Total:</td>
                    <td className="p-1.5 text-center font-mono font-semibold text-body">{totalSwitchCapacity} W</td>
                    <td className="p-1.5 text-center font-mono text-[13px] font-bold text-amber-400">{maxBudget.toFixed(0)} W</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button onClick={() => setSwitches([...switches, { model: '', capacity: 0 }])} className={addBtn}>
              + Add Switch
            </button>
          </CalcSection>
          </div>
        </div>

        {/* ── Right half: Results ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
          {/* Results */}
          <CalcSection title="Results">
            <div className="mb-2.5 grid grid-cols-2 gap-2.5">
              <ResultCard label="Total PoE Draw" value={totalDraw.toFixed(1)} unit="W" accent />
              <ResultCard label="Switch Budget (80%)" value={maxBudget.toFixed(0)} unit="W" />
              <ResultCard label="Recommended Switch" value={recommended.toFixed(0)} unit="W (120%)" />
              <ResultCard label="Utilization" value={totalSwitchCapacity > 0 ? ((totalDraw / totalSwitchCapacity) * 100).toFixed(0) : '—'} unit="%" />
              <ResultCard label="Ports Needed" value={totalPorts} unit="ports" />
              <ResultCard label="Remaining" value={(maxBudget - totalDraw).toFixed(1)} unit="W" />
            </div>
            <StatusBanner
              ok={ok}
              okText={`✓ Draw (${totalDraw.toFixed(1)}W) within 80% budget (${maxBudget.toFixed(0)}W)`}
              failText={`✗ Draw (${totalDraw.toFixed(1)}W) exceeds 80% budget (${maxBudget.toFixed(0)}W) — upgrade switch or reduce devices`}
            />
          </CalcSection>

          {/* Warnings */}
          <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs leading-relaxed text-red-400">
            <strong>Large Deployment Warning:</strong> Large deployments have considerations related to cable bundle heating and cable quality. Refer to cable manufacturer recommendations and NEC ampacity tables if required.
          </div>

          <div className="rounded-lg border border-border bg-forge-surface/40 p-3 text-[11px] leading-relaxed text-subtle">
            <div className="mb-1 font-semibold text-muted">IEEE PoE Standards</div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
              <div><strong className="text-body">802.3af</strong><br />15.4W / 12.95W<br />Class 0–3</div>
              <div><strong className="text-amber-400">802.3at (PoE+)</strong><br />30W / 25.5W<br />Class 4</div>
              <div><strong className="text-red-400">802.3bt (PoE++)</strong><br />60W / 51W<br />Class 5–6</div>
              <div><strong className="text-purple-400">802.3bt Type 4</strong><br />100W / 71.3W<br />Class 7–8</div>
            </div>
          </div>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
