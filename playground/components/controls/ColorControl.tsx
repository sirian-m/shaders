'use client';

interface ColorControlProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function ColorControl({ label, value, onChange }: ColorControlProps) {
  // Normalize to 6-char hex for the color input
  const hex6 = value.length === 9 ? value.slice(0, 7) : value.length === 5 ? value.slice(0, 4) : value;

  return (
    <div className="flex items-center gap-2 py-[3px]">
      <label className="w-[90px] shrink-0 text-[11px] text-[var(--text-secondary)] truncate">{label}</label>
      <input type="color" value={hex6} onChange={(e) => onChange(e.target.value)} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-[70px] border border-[var(--control-border)] rounded px-1.5 py-0.5 text-[11px] bg-[var(--control-bg)] outline-none focus:border-[var(--accent)]"
      />
    </div>
  );
}
