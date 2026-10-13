'use client';

import { useState } from 'react';
import { CalcSection, ResultCard, CalcPageWrapper } from '@/components/calc';

interface EquipmentItem { name: string; watts: number; }

const inputSt: React.CSSProperties = { padding: '6px 8px', background: 'rgb(var(--forge-surface))', border: '1px solid rgb(var(--border))', borderRadius: 5, color: 'rgb(var(--text-body))', fontSize: 12, width: '100%' };

export default function RackHeatPage() {
  const [equipment, setEquipment] = useState<EquipmentItem[]>([
    { name: 'Q-SYS Core 110f', watts: 150 },
    { name: 'Crestron DM-NVX-DIR-160', watts: 180 },
    { name: 'Network Switch (PoE)', watts: 370 },
    { name: 'UPS (Online)', watts: 400 },
    { name: 'Amplifier', watts: 350 },
  ]);

  const totalWatts = equipment.reduce((s, e) => s + e.watts, 0);
  const btu = totalWatts * 3.412;

  const update = (i: number, field: keyof EquipmentItem, val: string) => {
    const n = [...equipment];
    n[i] = { ...n[i], [field]: field === 'name' ? val : parseFloat(val) || 0 };
    setEquipment(n);
  };

  return (
    <CalcPageWrapper title="Rack Heat Load" desc="BTU/hr thermal calculation for rack equipment">
      <div className="flex flex-col items-stretch gap-6 lg:flex-row">

        {/* ── Left half: Inputs ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
          <CalcSection title="Equipment">
            <div className="mb-1.5 grid grid-cols-[1fr_80px_30px] gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-faint">
              <span>Device Name</span><span className="text-center">Watts</span><span></span>
            </div>
            {equipment.map((e, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_80px_30px] items-center gap-1.5">
                <input value={e.name} onChange={ev => update(i, 'name', ev.target.value)} style={inputSt} />
                <input type="number" value={e.watts} onChange={ev => update(i, 'watts', ev.target.value)} style={{ ...inputSt, textAlign: 'center' }} />
                <button onClick={() => setEquipment(equipment.filter((_, j) => j !== i))} className="text-base text-red-400 hover:text-red-300">×</button>
              </div>
            ))}
            <button onClick={() => setEquipment([...equipment, { name: 'New Device', watts: 100 }])}
              className="w-full rounded-md border border-dashed border-blue-500/40 bg-blue-500/10 py-1.5 text-[13px] text-blue-400 transition-colors hover:bg-blue-500/20">
              + Add Equipment
            </button>
          </CalcSection>
          </div>
        </div>

        {/* ── Right half: Results ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
          <CalcSection title="Results">
            <div className="grid grid-cols-2 gap-2.5">
              <ResultCard label="Total Power" value={totalWatts.toLocaleString()} unit="W" accent />
              <ResultCard label="Heat Output" value={Math.round(btu).toLocaleString()} unit="BTU/hr" accent />
              <ResultCard label="Cooling Needed" value={(btu / 12000).toFixed(2)} unit="tons" />
              <ResultCard label="20A Circuits (80%)" value={Math.ceil(totalWatts / (120 * 16))} unit="" />
            </div>
          </CalcSection>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
