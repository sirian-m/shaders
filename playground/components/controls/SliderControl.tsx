'use client';

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

export function SliderControl({ label, value, min, max, step, onChange }: SliderControlProps) {
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <label className="w-[90px] shrink-0 text-[11px] text-[var(--text-secondary)] truncate">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 min-w-0"
      />
      <span className="w-[38px] shrink-0 text-right text-[11px] text-[var(--text-secondary)] tabular-nums">
        {value % 1 === 0 ? value : value.toFixed(2)}
      </span>
    </div>
  );
}
