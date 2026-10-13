'use client';

import { useState } from 'react';
import { CalcSection, ResultCard, StatusBanner, CalcPageWrapper } from '@/components/calc';
import { CONDUIT_SIZES, CABLE_TYPES } from '@/lib/calc-data';

interface CableEntry { type: string; qty: number; }

const selectSt: React.CSSProperties = { padding: '6px 8px', background: 'rgb(var(--forge-surface))', border: '1px solid rgb(var(--border))', borderRadius: 5, color: 'rgb(var(--text-body))', fontSize: 12, width: '100%' };
const numSt: React.CSSProperties = { ...selectSt, textAlign: 'center', width: '100%' };

export default function ConduitFillPage() {
  const [conduit, setConduit] = useState('1"');
  const [cables, setCables] = useState<CableEntry[]>([
    { type: 'Cat6A (Plenum)', qty: 4 },
    { type: '14/2 Speaker', qty: 2 },
  ]);

  const cond = CONDUIT_SIZES.find(c => c.size === conduit);
  const totalCableArea = cables.reduce((s, c) => {
    const ct = CABLE_TYPES.find(t => t.name === c.type);
    return s + (ct ? ct.area * c.qty : 0);
  }, 0);
  const totalCount = cables.reduce((s, c) => s + c.qty, 0);
  const fillPct = totalCount === 1 ? 53 : totalCount === 2 ? 31 : 40;
  const allowable = cond ? cond.area * (fillPct / 100) : 0;
  const actualFill = cond ? (totalCableArea / cond.area) * 100 : 0;
  const maxOD = cables.reduce((max, c) => {
    const ct = CABLE_TYPES.find(t => t.name === c.type);
    return ct ? Math.max(max, ct.od) : max;
  }, 0);
  const jamRatio = cond && maxOD > 0 ? cond.id / maxOD : 0;

  return (
    <CalcPageWrapper title="Conduit Fill" desc="NEC conduit fill percentage with jam ratio check">
      <div className="flex flex-col items-stretch gap-6 lg:flex-row">

        {/* ── Left half: Inputs ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
          <CalcSection title="Conduit">
            <div className="mb-3.5">
              <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Conduit Size (EMT)</label>
              <select value={conduit} onChange={e => setConduit(e.target.value)} style={selectSt}>
                {CONDUIT_SIZES.map(c => (
                  <option key={c.size} value={c.size}>{c.size} EMT — ID {c.id}" — {c.area.toFixed(3)} in²</option>
                ))}
              </select>
            </div>
          </CalcSection>

          <CalcSection title="Cables">
            <div className="mb-1.5 grid grid-cols-[1fr_60px_30px] gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-faint">
              <span>Cable Type</span><span className="text-center">Qty</span><span></span>
            </div>
            {cables.map((c, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_60px_30px] items-center gap-1.5">
                <select value={c.type} onChange={e => { const n = [...cables]; n[i] = { ...n[i], type: e.target.value }; setCables(n); }} style={selectSt}>
                  {CABLE_TYPES.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
                <input type="number" value={c.qty} onChange={e => { const n = [...cables]; n[i] = { ...n[i], qty: parseInt(e.target.value) || 0 }; setCables(n); }} min={0} style={numSt} />
                <button onClick={() => setCables(cables.filter((_, j) => j !== i))} className="text-base text-red-400 hover:text-red-300">×</button>
              </div>
            ))}
            <button onClick={() => setCables([...cables, { type: 'Cat6 (Plenum)', qty: 1 }])}
              className="w-full rounded-md border border-dashed border-blue-500/40 bg-blue-500/10 py-1.5 text-[13px] text-blue-400 transition-colors hover:bg-blue-500/20">
              + Add Cable
            </button>
          </CalcSection>
          </div>
        </div>

        {/* ── Right half: Results ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
          <CalcSection title="Results">
            <div className="mb-2.5 grid grid-cols-2 gap-2.5">
              <ResultCard label="Actual Fill" value={actualFill.toFixed(1)} unit="%" accent />
              <ResultCard label={`NEC Max Fill (${totalCount} cable${totalCount !== 1 ? 's' : ''})`} value={fillPct} unit="%" />
              <ResultCard label="Cable Area Used" value={totalCableArea.toFixed(3)} unit='in²' />
              <ResultCard label="Allowable Area" value={allowable.toFixed(3)} unit='in²' />
              <ResultCard label="Jam Ratio" value={jamRatio.toFixed(1)} unit=":1" />
              <ResultCard label="Total Cables" value={totalCount} unit="" />
            </div>
            <StatusBanner
              ok={actualFill <= fillPct}
              okText={`✓ Fill ${actualFill.toFixed(1)}% within NEC ${fillPct}% max`}
              failText={`✗ Fill ${actualFill.toFixed(1)}% exceeds NEC ${fillPct}% max — upsize conduit`}
            />
          </CalcSection>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
