'use client';

import { useMemo, useState } from 'react';
import { CalcSection, ResultCard, CalcPageWrapper } from '@/components/calc';

type WiringMode = 'series' | 'parallel' | 'series-parallel';

export default function SpeakerImpedancePage() {
  const [mode, setMode] = useState<WiringMode>('parallel');
  const [impedance, setImpedance] = useState(8);
  const [speakers, setSpeakers] = useState(2);

  const total = useMemo(() => {
    if (mode === 'series') return impedance * speakers;
    if (mode === 'parallel') return impedance / speakers;
    const branchSize = Math.sqrt(speakers);
    return Number.isInteger(branchSize) ? (impedance * branchSize) / branchSize : null;
  }, [impedance, mode, speakers]);

  return (
    <CalcPageWrapper title="Speaker Impedance" desc="Series, parallel, and series/parallel speaker load calculator">
      <div className="flex flex-col items-stretch gap-6 lg:flex-row">

        {/* ── Left: Inputs ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
            <CalcSection title="Wiring Mode">
              <div className="flex flex-wrap gap-2">
                {(['parallel', 'series', 'series-parallel'] as WiringMode[]).map(value => (
                  <button
                    key={value}
                    onClick={() => setMode(value)}
                    className={`rounded-lg border px-3 py-1.5 text-[12px] capitalize ${mode === value ? 'border-blue-400 bg-blue-500/10 text-blue-400' : 'border-border text-subtle'}`}
                  >
                    {value.replace('-', ' / ')}
                  </button>
                ))}
              </div>
            </CalcSection>

            <CalcSection title="Speaker Configuration">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[12px] text-secondary">
                  Each speaker (Ω)
                  <input
                    className="forge-input mt-1"
                    type="number"
                    min="1"
                    step="0.5"
                    value={impedance}
                    onChange={e => setImpedance(Math.max(0.5, Number(e.target.value) || 0.5))}
                  />
                </label>
                <label className="text-[12px] text-secondary">
                  Speaker count
                  <input
                    className="forge-input mt-1"
                    type="number"
                    min="2"
                    step="1"
                    value={speakers}
                    onChange={e => setSpeakers(Math.max(2, Math.floor(Number(e.target.value) || 2)))}
                  />
                </label>
              </div>
            </CalcSection>
          </div>
        </div>

        {/* ── Right: Results ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
            <CalcSection title="Results">
              <ResultCard
                label="Computed Load"
                value={total === null ? 'Requires a square speaker count' : Number(total.toFixed(3))}
                unit={total === null ? '' : 'Ω'}
                accent
              />
              <p className="mt-3 text-[11px] leading-relaxed text-faint">
                Series adds impedances. Equal parallel loads divide impedance by speaker count. The series/parallel result assumes an equal square grid (4, 9, 16…). Confirm the amplifier&rsquo;s permitted load before connecting.
              </p>
            </CalcSection>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
