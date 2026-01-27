'use client';

interface BooleanControlProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function BooleanControl({ label, value, onChange }: BooleanControlProps) {
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <label className="w-[90px] shrink-0 text-[11px] text-[var(--text-secondary)] truncate">{label}</label>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}
