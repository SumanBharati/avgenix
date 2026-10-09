'use client';

import { useState } from 'react';
import { CalcPageWrapper } from '@/components/calc';

const inputCls = "w-full rounded-lg border border-border bg-forge-surface px-3 py-2.5 font-mono text-[15px] text-body outline-none transition-colors focus:border-blue-500/40";
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
    <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{title}</div>
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

type Dimension = 'width' | 'height' | 'diagonal';
const DIMENSION_LABELS: Record<Dimension, string> = { width: 'Image Width', height: 'Image Height', diagonal: 'Diagonal' };

type LengthUnit = 'ft' | 'in' | 'm';
// How many feet are in one of this unit — used to convert the single
// dimension input to/from the canonical feet value everything else (area,
// lumens, the other two dimensions) is computed in.
const FT_PER_UNIT: Record<LengthUnit, number> = { ft: 1, in: 1 / 12, m: 3.28084 };
const UNIT_STEP: Record<LengthUnit, number> = { ft: 0.5, in: 1, m: 0.1 };

export default function ProjectorLumensPage() {
  // Image width in feet is the one canonical value everything else derives
  // from — height/diagonal/area/lumens all stay computed from it + the
  // aspect ratio, same as before. `dimension` controls which of the three
  // the single input field reads/writes, and `lengthUnit` controls what
  // unit that field is displayed/entered in — both convert through width.
  const [imgWidth, setImgWidth] = useState(10);
  const [dimension, setDimension] = useState<Dimension>('width');
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>('ft');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [ambientFl, setAmbientFl] = useState(80);
  const [screenGain, setScreenGain] = useState(1.0);

  const ar = ASPECT_RATIOS[aspectRatio] ?? 16 / 9;
  const imgHeight = imgWidth / ar;
  const diagonal = Math.sqrt(imgWidth * imgWidth + imgHeight * imgHeight);
  const screenArea = imgWidth * imgHeight;
  const lumens = (ambientFl * screenArea) / screenGain;

  const dimensionValueFt = dimension === 'width' ? imgWidth : dimension === 'height' ? imgHeight : diagonal;
  const dimensionValue = dimensionValueFt / FT_PER_UNIT[lengthUnit];

  // Converts a canonical feet value to whichever unit is selected, for
  // display only — the underlying ft/ft² values keep driving the actual
  // lumens calculation (foot-lamberts are defined per square foot), these
  // are purely presentational conversions of the same numbers.
  const toSelectedUnit = (valueFt: number) => valueFt / FT_PER_UNIT[lengthUnit];
  const toSelectedAreaUnit = (valueFtSq: number) => valueFtSq / (FT_PER_UNIT[lengthUnit] * FT_PER_UNIT[lengthUnit]);
  const areaUnitLabel = `${lengthUnit}²`;

  function setDimensionValue(vInUnit: number) {
    const v = vInUnit * FT_PER_UNIT[lengthUnit];
    if (dimension === 'width') setImgWidth(v);
    else if (dimension === 'height') setImgWidth(v * ar);
    else setImgWidth(v * (ar / Math.sqrt(1 + ar * ar)));
  }

  // Changing aspect ratio recomputes width from whichever dimension is
  // currently being entered, so that value stays fixed and the other two
  // adjust — switching ratios shouldn't silently change the number someone
  // just typed.
  function changeAspectRatio(key: string) {
    const newAr = ASPECT_RATIOS[key] ?? 16 / 9;
    if (dimension === 'height') setImgWidth(imgHeight * newAr);
    else if (dimension === 'diagonal') setImgWidth(diagonal * (newAr / Math.sqrt(1 + newAr * newAr)));
    setAspectRatio(key);
  }

  return (
    <CalcPageWrapper title="Projector Lumens Calculator" desc="Required brightness based on screen size and room conditions">
      <div className="flex flex-col items-stretch gap-6 lg:flex-row">

        {/* ── Left: Inputs ── */}
        <div className="min-w-0 flex-1">
          <div className="h-full rounded-xl border border-border bg-forge-surface/50 p-5">
            <SectionHeader title="Inputs" />

            <div className="mb-4">
              <label className={labelCls}>Select the Known Image Parameter and Enter its Value</label>
              <div className="grid grid-cols-3 gap-2">
                {(['width', 'height', 'diagonal'] as Dimension[]).map(key => (
                  <button key={key} onClick={() => setDimension(key)}
                    className="rounded-lg px-2 py-2 text-center text-[12px] font-semibold capitalize transition-colors"
                    style={{
                      border: `1px solid ${dimension === key ? 'rgba(139,92,246,0.5)' : 'rgb(var(--border))'}`,
                      background: dimension === key ? 'rgba(139,92,246,0.08)' : 'rgb(var(--forge-surface) / 0.5)',
                      color: dimension === key ? '#a78bfa' : 'rgb(var(--text-subtle))',
                    }}>
                    {key}
                  </button>
                ))}
              </div>
            </div>

            <Field label={DIMENSION_LABELS[dimension]}>
              <div className="flex items-end gap-2">
                <input type="number" value={Number(dimensionValue.toFixed(2))} step={UNIT_STEP[lengthUnit]}
                  onChange={e => setDimensionValue(parseFloat(e.target.value) || 0)}
                  className={inputCls} />
                <div className="shrink-0">
                  <div className={labelCls}>Select Unit</div>
                  <div className="flex overflow-hidden rounded-lg border border-border">
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
              </div>
            </Field>

            <div className="mb-4">
              <label className={labelCls}>Aspect Ratio</label>
              <div className="grid grid-cols-3 gap-2">
                {Object.keys(ASPECT_RATIOS).map(key => (
                  <button key={key} onClick={() => changeAspectRatio(key)}
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
                <UnitInput value={ambientFl} onChange={setAmbientFl} unit="fL" min={10} max={200} />
              </Field>
              <Field label="Screen Gain">
                <UnitInput value={screenGain} onChange={setScreenGain} unit="×" min={0.5} max={3} step={0.1} />
              </Field>
            </div>
          </div>
        </div>

        {/* ── Right: Results ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="rounded-xl border border-border bg-forge-surface/50 p-5">
            <SectionHeader title="Results" />

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
              <div className="flex items-center rounded-xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-4">
                <div>
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">Screen Area</div>
                  <div className="font-mono">
                    <span className="text-2xl font-bold text-blue-400">{toSelectedAreaUnit(screenArea).toFixed(2)}</span>
                    <span className="ml-1.5 text-sm text-subtle">{areaUnitLabel}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Image dimensions */}
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Image Width', value: `${toSelectedUnit(imgWidth).toFixed(2)} ${lengthUnit}` },
                { label: 'Image Height', value: `${toSelectedUnit(imgHeight).toFixed(2)} ${lengthUnit}` },
                { label: 'Diagonal', value: `${toSelectedUnit(diagonal).toFixed(2)} ${lengthUnit}` },
                { label: 'Screen Gain', value: `${screenGain.toFixed(1)}×` },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border bg-forge-surface/30 px-3 py-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-subtle">{label}</div>
                  <div className="font-mono text-[14px] font-semibold text-body">{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* References */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-5">
            <SectionHeader title="References" />
            <div className="space-y-2 font-mono text-[12px]">
              <div>
                <span className="font-semibold text-blue-400">Image Height</span>
                <span className="text-subtle"> = Width ÷ Aspect ({aspectRatio}) = </span>
                <span className="text-body">{toSelectedUnit(imgWidth).toFixed(2)} ÷ {ar.toFixed(4)} = {toSelectedUnit(imgHeight).toFixed(2)} {lengthUnit}</span>
              </div>
              <div>
                <span className="font-semibold text-blue-400">Diagonal</span>
                <span className="text-subtle"> = √(Width² + Height²) = </span>
                <span className="text-body">√({toSelectedUnit(imgWidth).toFixed(2)}² + {toSelectedUnit(imgHeight).toFixed(2)}²) = {toSelectedUnit(diagonal).toFixed(2)} {lengthUnit}</span>
              </div>
              <div>
                <span className="font-semibold text-blue-400">Screen Area</span>
                <span className="text-subtle"> = Width × Height = </span>
                <span className="text-body">{toSelectedUnit(imgWidth).toFixed(2)} × {toSelectedUnit(imgHeight).toFixed(2)} = {toSelectedAreaUnit(screenArea).toFixed(2)} {areaUnitLabel}</span>
              </div>
              <div>
                <span className="font-semibold text-blue-400">Required Lumens</span>
                <span className="text-subtle"> = (Brightness × Area) ÷ Gain = </span>
                <span className="text-body">({ambientFl} × {screenArea.toFixed(1)} ft²) ÷ {screenGain} = {Math.ceil(lumens).toLocaleString()} Lm</span>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-faint">Required Lumens is always computed from the area in ft² — the foot-lambert brightness formula is defined per square foot, regardless of the unit selected for display above.</p>
            <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-[12px] text-subtle">
              <div><span className="font-semibold text-muted">Brightness Guide:</span> 20–30 fL dark rooms | 40–60 fL ambient light | 80+ fL bright rooms</div>
              <div><span className="font-semibold text-muted">Screen Gain:</span> 1.0 = matte white | 1.3+ = high gain | 0.8 = ALR</div>
            </div>
          </div>
        </div>

      </div>
    </CalcPageWrapper>
  );
}
