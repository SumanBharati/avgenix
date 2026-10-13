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

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
      {title}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className={labelCls}>
        {label}
        {hint && <span className="ml-1.5 font-normal normal-case tracking-normal text-faint opacity-80">{hint}</span>}
      </label>
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

export default function ThrowRatioPage() {
  const [mode, setMode] = useState<'dist' | 'ratio'>('dist');
  const [throwDist, setThrowDist] = useState(15);
  const [manualTR, setManualTR] = useState(1.5);
  const [imgWidth, setImgWidth] = useState(10);
  const [ambientFl, setAmbientFl] = useState(80);
  const [screenGain, setScreenGain] = useState(1.0);
  const [aspectRatio, setAspectRatio] = useState('16:9');

  const ar = ASPECT_RATIOS[aspectRatio] ?? 16 / 9;

  const tr = mode === 'dist' ? throwDist / imgWidth : manualTR;
  const computedDist = mode === 'ratio' ? manualTR * imgWidth : throwDist;
  const screenArea = imgWidth * (imgWidth / ar);
  const lumens = (ambientFl * screenArea) / screenGain;
  const lensType = tr < 0.5 ? 'UST' : tr < 1.0 ? 'Short Throw' : tr < 2.0 ? 'Standard' : 'Long Throw';

  return (
    <CalcPageWrapper title="Throw and Lumens Calculator" desc="Projector throw distance and required brightness calculator">
      <div className="flex flex-col items-stretch gap-6 lg:flex-row">

        {/* ── Left: Inputs ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
            <SectionHeader title="Inputs" />

            {/* Mode toggle */}
            <div className="mb-5 grid grid-cols-2 gap-2">
              {[
                { key: 'dist', label: 'Known value – Throw distance' },
                { key: 'ratio', label: 'Known value – Throw ratio' },
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

            <div className="grid grid-cols-2 gap-3">
              {mode === 'dist' ? (
                <Field label="Throw Distance">
                  <UnitInput value={throwDist} onChange={setThrowDist} unit="ft" min={1} max={200} step={0.5} />
                </Field>
              ) : (
                <Field label="Throw Ratio">
                  <UnitInput value={manualTR} onChange={setManualTR} unit=":1" min={0.1} max={10} step={0.05} />
                </Field>
              )}
              <Field label="Image Width">
                <UnitInput value={imgWidth} onChange={setImgWidth} unit="ft" min={2} max={60} step={0.5} />
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Target Brightness" hint="≥80 for bright rooms">
                <UnitInput value={ambientFl} onChange={setAmbientFl} unit="fL" min={10} max={100} />
              </Field>
              <Field label="Screen Gain">
                <UnitInput value={screenGain} onChange={setScreenGain} unit="×" min={0.5} max={3} step={0.1} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{mode === 'dist' ? 'Throw Ratio' : 'Throw Distance'}</label>
                <div className={readonlyCls}>
                  {mode === 'dist' ? `${tr.toFixed(2)} :1` : `${computedDist.toFixed(1)} ft`}
                </div>
              </div>
              <div>
                <label className={labelCls}>Lens Type</label>
                <div className={readonlyCls}>{lensType}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Results ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 rounded-xl border border-border bg-forge-surface/50 p-5">
            <SectionHeader title="Results" />

            {/* Stat cards */}
            <div className="mb-4 grid grid-cols-2 gap-3">
              {/* Required Lumens */}
              <div className="flex items-center rounded-xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-4">
                <div>
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">Required Lumens</div>
                  <div className="font-mono">
                    <span className="text-2xl font-bold text-blue-400">{Math.ceil(lumens).toLocaleString()}</span>
                    <span className="ml-1.5 text-sm text-subtle">Lm</span>
                  </div>
                </div>
              </div>
              {/* Screen Area */}
              <div className="flex items-center rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-4">
                <div>
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">Screen Area</div>
                  <div className="font-mono">
                    <span className="text-2xl font-bold text-emerald-400">{screenArea.toFixed(1)}</span>
                    <span className="ml-1.5 text-sm text-subtle">ft²</span>
                  </div>
                </div>
              </div>
            </div>

            {/* References */}
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
              <div className="mb-3 text-[13px] font-semibold text-muted">
                References
              </div>
              <div className="space-y-2 font-mono text-[12px]">
                <div>
                  <span className="font-semibold text-blue-400">Throw Ratio</span>
                  <span className="text-subtle"> = Throw Distance ÷ Image Width = </span>
                  <span className="text-body">{throwDist} ÷ {imgWidth} = {tr.toFixed(2)}:1</span>
                </div>
                <div>
                  <span className="font-semibold text-blue-400">Screen Area</span>
                  <span className="text-subtle"> = Width × (Width ÷ Aspect) = </span>
                  <span className="text-body">{imgWidth} × {(imgWidth / ar).toFixed(2)} = {screenArea.toFixed(1)} ft²</span>
                </div>
                <div>
                  <span className="font-semibold text-blue-400">Required Lumens</span>
                  <span className="text-subtle"> = (Brightness × Area) ÷ Gain = </span>
                  <span className="text-body">({ambientFl} × {screenArea.toFixed(1)}) ÷ {screenGain} = {Math.ceil(lumens).toLocaleString()} Lm</span>
                </div>
              </div>

              <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-[12px] text-subtle">
                <div><span className="font-semibold text-muted">Lens Classification:</span> UST &lt; 0.5 | Short Throw 0.5–1.0 | Standard 1.0–2.0 | Long Throw &gt; 2.0</div>
                <div><span className="font-semibold text-muted">Brightness Guide:</span> 20–30 fL dark rooms | 40–60 fL ambient light | 80+ fL bright rooms</div>
                <div><span className="font-semibold text-muted">Screen Gain:</span> 1.0 = matte white | 1.3+ = high gain | 0.8 = ALR</div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
