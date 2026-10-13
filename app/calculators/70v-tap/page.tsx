'use client';

import { useState } from 'react';
import { CalcSection, CalcPageWrapper } from '@/components/calc';

interface SpeakerZone {
  name: string;
  qty: number;
  tap: number;
}

const inputSt: React.CSSProperties = { padding: '6px 8px', background: 'rgb(var(--forge-surface))', border: '1px solid rgb(var(--border))', borderRadius: 5, color: 'rgb(var(--text-body))', fontSize: 12 };

export default function TapLoadPage() {
  const [speakers, setSpeakers] = useState<SpeakerZone[]>([
    { name: 'Zone 1 — Ceiling',   qty: 8, tap: 8  },
    { name: 'Zone 2 — Corridor',  qty: 6, tap: 4  },
    { name: 'Zone 3 — Lobby',     qty: 4, tap: 16 },
  ]);

  const updateSpeaker = (i: number, field: keyof SpeakerZone, val: string) => {
    const n = [...speakers];
    n[i] = { ...n[i], [field]: field === 'name' ? val : parseFloat(val) || 0 };
    setSpeakers(n);
  };

  return (
    <CalcPageWrapper title="70V Tap Load" desc="Transformer tap and wattage calculator for 70V distribution">
      <div className="flex flex-col items-stretch gap-6 lg:flex-row">

        {/* ── Left: Zones ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
          <CalcSection title="Speaker Zones">
            <div className="mb-1.5 grid grid-cols-[1fr_60px_70px_30px] gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-faint">
              <span>Zone Name</span>
              <span className="text-center">Qty</span>
              <span className="text-center">Tap (W)</span>
              <span />
            </div>
            {speakers.map((sp, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_60px_70px_30px] items-center gap-1.5">
                <input
                  value={sp.name}
                  onChange={e => updateSpeaker(i, 'name', e.target.value)}
                  style={{ ...inputSt, width: '100%' }}
                />
                <input
                  type="number"
                  value={sp.qty}
                  onChange={e => updateSpeaker(i, 'qty', e.target.value)}
                  min={0}
                  style={{ ...inputSt, textAlign: 'center', width: '100%' }}
                />
                <input
                  type="number"
                  value={sp.tap}
                  onChange={e => updateSpeaker(i, 'tap', e.target.value)}
                  min={0}
                  style={{ ...inputSt, textAlign: 'center', width: '100%' }}
                />
                <button
                  onClick={() => setSpeakers(speakers.filter((_, j) => j !== i))}
                  className="text-base text-red-400 hover:text-red-300"
                >×</button>
              </div>
            ))}
            <button
              onClick={() => setSpeakers([...speakers, { name: `Zone ${speakers.length + 1}`, qty: 4, tap: 8 }])}
              className="w-full rounded-md border border-dashed border-blue-500/40 bg-blue-500/10 py-1.5 text-[13px] text-blue-400 transition-colors hover:bg-blue-500/20"
            >
              + Add Zone
            </button>
          </CalcSection>
          </div>
        </div>

        {/* ── Right: Results ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
          <CalcSection title="Results">

            {/* Per-zone breakdown */}
            {speakers.length > 0 && (
              <>
                <div className="mb-1.5 grid grid-cols-[1fr_80px_110px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
                  <span>Amplifier Requirements</span>
                  <span className="text-right">Load (W)</span>
                  <span className="text-right">Min. W / Channel</span>
                </div>
                <div className="flex flex-col gap-1">
                  {speakers.map((sp, i) => {
                    const zoneLoad = sp.qty * sp.tap;
                    const minWatts = Math.ceil(zoneLoad * 1.2);
                    return (
                      <div
                        key={i}
                        className="grid grid-cols-[1fr_80px_110px] items-center gap-2 rounded-md border border-border bg-forge-surface/40 px-3 py-2"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-blue-500/10 text-blue-400">Ch {i + 1}</span>
                          <span className="truncate text-[13px] text-body">{sp.name || `Zone ${i + 1}`}</span>
                        </span>
                        <span className="text-right font-mono text-[13px] text-blue-400">{zoneLoad} W</span>
                        <span className="text-right font-mono text-[13px] text-body">{minWatts} W</span>
                      </div>
                    );
                  })}

                </div>
              </>
            )}

          </CalcSection>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
