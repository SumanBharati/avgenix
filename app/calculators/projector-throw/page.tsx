'use client';

import { useState } from 'react';
import { CalcPageWrapper } from '@/components/calc';

const inputCls = "w-full rounded-lg border border-border bg-forge-surface px-3 py-2.5 font-mono text-[15px] text-body outline-none transition-colors focus:border-blue-500/40";
const readonlyCls = "w-full rounded-lg border border-border bg-forge-surface/30 px-3 py-2.5 font-mono text-[15px] text-body";
const labelCls = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted";

const ASPECT_RATIOS: Record<string, number> = {
  '16:9': 16 / 9,
  '16:10': 16 / 10,
  '4:3': 4 / 3,
  '2.35:1': 2.35,
  '2.39:1': 2.39,
  '1:1': 1,
};

function lensLabel(tr: number) {
  return tr < 0.5 ? 'UST' : tr < 1.0 ? 'Short Throw' : tr < 2.0 ? 'Standard' : 'Long Throw';
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{title}</div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function UnitInput({ value, onChange, unit, min, max, step }: {
  value: number; onChange: (v: number) => void; unit: string; min?: number; max?: number; step?: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className={inputCls} />
      <span className="min-w-[28px] text-sm text-subtle">{unit}</span>
    </div>
  );
}

function MiniToggle({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { key: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {options.map(({ key, label }) => {
        const active = value === key;
        return (
          <button key={key} onClick={() => onChange(key)}
            className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors"
            style={{
              background: active ? 'rgba(139,92,246,0.15)' : 'transparent',
              color: active ? '#a78bfa' : 'rgb(var(--text-subtle))',
              borderRight: key !== options[options.length - 1].key ? '1px solid rgb(var(--border))' : undefined,
            }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

type LengthUnit = 'ft' | 'in' | 'm';
// How many feet are in one of this unit. All length state below (throwDist,
// imgWidth, and everything derived from them) stays canonically in feet —
// this only converts what's displayed/entered, same approach as the
// Projector Lumens calculator.
const FT_PER_UNIT: Record<LengthUnit, number> = { ft: 1, in: 1 / 12, m: 3.28084 };
const UNIT_STEP: Record<LengthUnit, number> = { ft: 0.5, in: 1, m: 0.1 };

export default function ProjectorThrowPage() {
  const [mode, setMode] = useState<'dist' | 'ratio'>('dist');
  const [throwType, setThrowType] = useState<'fixed' | 'variable'>('fixed');
  const [throwDist, setThrowDist] = useState(15);
  const [manualTR, setManualTR] = useState(1.5);
  const [minTR, setMinTR] = useState(1.2);
  const [maxTR, setMaxTR] = useState(2.0);
  const [imgWidth, setImgWidth] = useState(10);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>('ft');

  const ar = ASPECT_RATIOS[aspectRatio] ?? 16 / 9;
  const imgHeight = imgWidth / ar;
  const imgDiag = Math.sqrt(imgWidth ** 2 + imgHeight ** 2);

  const toSelectedUnit = (valueFt: number) => valueFt / FT_PER_UNIT[lengthUnit];
  const fromSelectedUnit = (valueInUnit: number) => valueInUnit * FT_PER_UNIT[lengthUnit];

  // Fixed mode derived values
  const tr = mode === 'dist' ? throwDist / imgWidth : manualTR;
  const computedDist = mode === 'ratio' ? manualTR * imgWidth : throwDist;
  const lensType = lensLabel(tr);

  // Variable mode derived values
  const minDist = minTR * imgWidth;
  const maxDist = maxTR * imgWidth;
  const minLens = lensLabel(minTR);
  const maxLens = lensLabel(maxTR);
  const lensRange = minLens === maxLens ? minLens : `${minLens} – ${maxLens}`;

  const isVariable = mode === 'ratio' && throwType === 'variable';

  return (
    <CalcPageWrapper title="Projector Throw Calculator" desc="Compute throw ratio, lens type, and image dimensions">
      <div className="flex flex-col items-stretch gap-6 lg:flex-row">

        {/* ── Left: Inputs ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
            <SectionHeader title="Select Known Parameter to Calculate the Other" />

            {/* Mode radio buttons */}
            <div className="mb-5 grid grid-cols-2 gap-2">
              {[
                { key: 'dist', label: 'Throw Distance' },
                { key: 'ratio', label: 'Throw Ratio' },
              ].map(({ key, label }) => {
                const active = mode === key;
                return (
                  <button key={key} onClick={() => setMode(key as 'dist' | 'ratio')}
                    className="rounded-lg px-3 py-2.5 text-left text-[12px] font-semibold transition-colors"
                    style={{
                      border: `1px solid ${active ? 'rgba(139,92,246,0.5)' : 'rgb(var(--border))'}`,
                      background: active ? 'rgba(139,92,246,0.08)' : 'rgb(var(--forge-surface) / 0.5)',
                      color: active ? '#a78bfa' : 'rgb(var(--text-subtle))',
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="mb-4">
              <label className={labelCls}>Select Unit</label>
              <div className="inline-flex overflow-hidden rounded-lg border border-border">
                {(['ft', 'in', 'm'] as LengthUnit[]).map(u => (
                  <button key={u} onClick={() => setLengthUnit(u)}
                    className="px-5 py-2.5 text-[12px] font-semibold transition-colors"
                    style={{
                      background: lengthUnit === u ? 'rgba(139,92,246,0.12)' : 'rgb(var(--forge-surface) / 0.5)',
                      color: lengthUnit === u ? '#a78bfa' : 'rgb(var(--text-subtle))',
                    }}>
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-0">
              {mode === 'dist' ? (
                <Field label={<span className={labelCls}>Throw Distance</span>}>
                  <UnitInput value={Number(toSelectedUnit(throwDist).toFixed(2))} onChange={v => setThrowDist(fromSelectedUnit(v))} unit={lengthUnit} min={toSelectedUnit(1)} max={toSelectedUnit(200)} step={UNIT_STEP[lengthUnit]} />
                </Field>
              ) : (
                <Field
                  label={
                    <div className="flex items-center justify-between">
                      <span className={labelCls} style={{ marginBottom: 0 }}>Throw Ratio</span>
                      <MiniToggle
                        value={throwType}
                        onChange={v => setThrowType(v as 'fixed' | 'variable')}
                        options={[{ key: 'fixed', label: 'Fixed' }, { key: 'variable', label: 'Variable' }]}
                      />
                    </div>
                  }
                >
                  {throwType === 'fixed' ? (
                    <UnitInput value={manualTR} onChange={setManualTR} unit=":1" min={0.1} max={10} step={0.05} />
                  ) : (
                    <div className="space-y-2">
                      <div>
                        <div className="mb-1 text-[10px] text-subtle uppercase tracking-wide">Min. Throw Ratio</div>
                        <UnitInput value={minTR} onChange={setMinTR} unit=":1" min={0.1} max={10} step={0.05} />
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] text-subtle uppercase tracking-wide">Max. Throw Ratio</div>
                        <UnitInput value={maxTR} onChange={setMaxTR} unit=":1" min={0.1} max={10} step={0.05} />
                      </div>
                    </div>
                  )}
                </Field>
              )}
              <Field label={<span className={labelCls}>Image Width</span>}>
                <UnitInput value={Number(toSelectedUnit(imgWidth).toFixed(2))} onChange={v => setImgWidth(fromSelectedUnit(v))} unit={lengthUnit} min={toSelectedUnit(2)} max={toSelectedUnit(60)} step={UNIT_STEP[lengthUnit]} />
              </Field>
            </div>

            <div className="mb-4">
              <label className={labelCls}>Aspect Ratio</label>
              <div className="grid grid-cols-3 gap-2">
                {Object.keys(ASPECT_RATIOS).map(key => (
                  <button key={key} onClick={() => setAspectRatio(key)}
                    className="rounded-lg px-2 py-2 text-center text-[12px] font-semibold transition-colors"
                    style={{
                      border: `1px solid ${aspectRatio === key ? 'rgba(139,92,246,0.5)' : 'rgb(var(--border))'}`,
                      background: aspectRatio === key ? 'rgba(139,92,246,0.08)' : 'rgb(var(--forge-surface) / 0.5)',
                      color: aspectRatio === key ? '#a78bfa' : 'rgb(var(--text-subtle))',
                    }}>
                    {key}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Results ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="rounded-xl border border-border bg-forge-surface/50 p-5">
            <SectionHeader title="Results" />

            <div className="mb-4 grid grid-cols-2 gap-3">
              {/* Throw Ratio / Distance / Range */}
              <div className="flex items-center rounded-xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-4">
                <div className="min-w-0">
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">
                    {isVariable ? 'Throw Range' : mode === 'dist' ? 'Throw Ratio' : 'Throw Distance'}
                  </div>
                  {isVariable ? (
                    <div className="font-mono">
                      <span className="text-2xl font-bold text-blue-400">{toSelectedUnit(minDist).toFixed(2)} – {toSelectedUnit(maxDist).toFixed(2)}</span>
                      <span className="ml-1.5 text-sm text-subtle">{lengthUnit}</span>
                    </div>
                  ) : (
                    <div className="font-mono">
                      <span className="text-2xl font-bold text-blue-400">
                        {mode === 'dist' ? tr.toFixed(2) : toSelectedUnit(computedDist).toFixed(2)}
                      </span>
                      <span className="ml-1.5 text-sm text-subtle">{mode === 'dist' ? ':1' : lengthUnit}</span>
                    </div>
                  )}
                </div>
              </div>
              {/* Lens Type */}
              <div className="flex items-center rounded-xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-4">
                <div className="min-w-0">
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">Lens Type</div>
                  <div className="font-mono text-[15px] font-bold text-blue-400 leading-tight">
                    {isVariable ? lensRange : lensType}
                  </div>
                </div>
              </div>
            </div>

            {/* Variable: throw ratio range summary */}
            {isVariable && (
              <div className="mb-4 grid grid-cols-2 gap-2">
                {[
                  { label: 'Min Throw Ratio', value: `${minTR.toFixed(2)} :1`, sub: `→ ${toSelectedUnit(minDist).toFixed(2)} ${lengthUnit}` },
                  { label: 'Max Throw Ratio', value: `${maxTR.toFixed(2)} :1`, sub: `→ ${toSelectedUnit(maxDist).toFixed(2)} ${lengthUnit}` },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="rounded-lg border border-border bg-forge-surface/30 px-3 py-3">
                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">{label}</div>
                    <div className="font-mono text-[14px] font-semibold text-body">{value}</div>
                    <div className="font-mono text-[12px] text-blue-400">{sub}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Image dimensions */}
            <div className="mb-4 grid grid-cols-3 gap-2">
              {[
                { label: 'Image Width', value: `${toSelectedUnit(imgWidth).toFixed(2)} ${lengthUnit}` },
                { label: 'Image Height', value: `${toSelectedUnit(imgHeight).toFixed(2)} ${lengthUnit}` },
                { label: 'Image Diagonal', value: `${toSelectedUnit(imgDiag).toFixed(2)} ${lengthUnit}` },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border bg-forge-surface/30 px-3 py-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-subtle">{label}</div>
                  <div className="font-mono text-[14px] font-semibold text-body">{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* References */}
          <div className="flex-1 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-5">
            <SectionHeader title="References" />
            <div className="space-y-2 font-mono text-[12px]">
              {isVariable ? (
                <>
                  <div>
                    <span className="font-semibold text-blue-400">Min Throw Distance</span>
                    <span className="text-subtle"> = Min TR × Width = </span>
                    <span className="text-body">{minTR} × {toSelectedUnit(imgWidth).toFixed(2)} = {toSelectedUnit(minDist).toFixed(2)} {lengthUnit}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-blue-400">Max Throw Distance</span>
                    <span className="text-subtle"> = Max TR × Width = </span>
                    <span className="text-body">{maxTR} × {toSelectedUnit(imgWidth).toFixed(2)} = {toSelectedUnit(maxDist).toFixed(2)} {lengthUnit}</span>
                  </div>
                </>
              ) : (
                <div>
                  <span className="font-semibold text-blue-400">Throw Ratio</span>
                  <span className="text-subtle"> = Throw Distance ÷ Image Width = </span>
                  <span className="text-body">{toSelectedUnit(mode === 'dist' ? throwDist : computedDist).toFixed(2)} ÷ {toSelectedUnit(imgWidth).toFixed(2)} = {tr.toFixed(2)}:1</span>
                </div>
              )}
              <div>
                <span className="font-semibold text-blue-400">Image Height</span>
                <span className="text-subtle"> = Width ÷ Aspect ({aspectRatio}) = </span>
                <span className="text-body">{toSelectedUnit(imgWidth).toFixed(2)} ÷ {ar.toFixed(4)} = {toSelectedUnit(imgHeight).toFixed(2)} {lengthUnit}</span>
              </div>
              <div>
                <span className="font-semibold text-blue-400">Image Diagonal</span>
                <span className="text-subtle"> = √(W² + H²) = </span>
                <span className="text-body">√({toSelectedUnit(imgWidth).toFixed(2)}² + {toSelectedUnit(imgHeight).toFixed(2)}²) = {toSelectedUnit(imgDiag).toFixed(2)} {lengthUnit}</span>
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-3 text-[12px] text-subtle">
              <span className="font-semibold text-muted">Lens Classification:</span> UST &lt; 0.5 | Short Throw 0.5–1.0 | Standard 1.0–2.0 | Long Throw &gt; 2.0
            </div>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
