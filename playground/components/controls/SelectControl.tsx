'use client';

interface SelectControlProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

export function SelectControl({ label, value, options, onChange }: SelectControlProps) {
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <label className="w-[90px] shrink-0 text-[11px] text-[var(--text-secondary)] truncate">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 min-w-0">
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}
