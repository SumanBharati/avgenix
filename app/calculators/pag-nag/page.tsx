'use client';

import { useState } from 'react';
import { CalcSection, InputField, ResultCard, StatusBanner, CalcPageWrapper } from '@/components/calc';

export default function PAGNAGPage() {
  const [d1, setD1] = useState(20);
  const [d0, setD0] = useState(2);
  const [d2, setD2] = useState(15);
  const [ds, setDs] = useState(10);

  const pag = 20 * Math.log10(d1) - 20 * Math.log10(d0) - 20 * Math.log10(d2) + 20 * Math.log10(ds) - 6.5;
  const nag = 20 * Math.log10(d1) - 20 * Math.log10(d0);
  const margin = pag - nag;

  return (
    <CalcPageWrapper title="PAG / NAG" desc="Potential and needed acoustic gain for microphone systems">
      <div className="flex flex-col items-stretch gap-6 lg:flex-row">

        {/* ── Left half: Inputs ── */}
        <div className="min-w-0 flex-1">
          <div className="rounded-xl border border-border bg-forge-surface/50 p-5">
            <CalcSection title="Distances">
              <InputField label="D1 — Source to Farthest Listener" value={d1} onChange={setD1} unit="ft" min={1} max={200} />
              <InputField label="D0 — Mic to Source" value={d0} onChange={setD0} unit="ft" min={0.5} max={50} step={0.5} />
              <InputField label="D2 — Speaker to Mic (nearest)" value={d2} onChange={setD2} unit="ft" min={1} max={100} />
              <InputField label="DS — Speaker to Farthest Listener" value={ds} onChange={setDs} unit="ft" min={1} max={200} />
            </CalcSection>
          </div>
        </div>

        {/* ── Right half: Results ── */}
        <div className="min-w-0 flex-1">
          <div className="rounded-xl border border-border bg-forge-surface/50 p-5">
            <CalcSection title="Results">
              <div className="mb-2.5 grid grid-cols-2 gap-2.5">
                <ResultCard label="PAG" value={pag.toFixed(1)} unit="dB" accent />
                <ResultCard label="NAG" value={nag.toFixed(1)} unit="dB" accent />
                <ResultCard label="Margin (PAG − NAG)" value={margin.toFixed(1)} unit="dB" />
              </div>
              <StatusBanner
                ok={margin >= 6}
                okText={`✓ System STABLE — ${margin.toFixed(1)} dB margin exceeds 6 dB minimum`}
                failText={`✗ System UNSTABLE — ${margin.toFixed(1)} dB margin below 6 dB minimum. Move mic closer to source or speaker farther from mic.`}
              />
            </CalcSection>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
