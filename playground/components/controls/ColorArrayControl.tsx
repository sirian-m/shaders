'use client';

interface ColorArrayControlProps {
  label: string;
  value: string[];
  maxColors: number;
  onChange: (value: string[]) => void;
}

export function ColorArrayControl({ label, value, maxColors, onChange }: ColorArrayControlProps) {
  const addColor = () => {
    if (value.length < maxColors) {
      onChange([...value, '#ffffff']);
    }
  };

  const removeColor = (index: number) => {
    if (value.length > 1) {
      onChange(value.filter((_, i) => i !== index));
    }
  };

  const updateColor = (index: number, color: string) => {
    const next = [...value];
    next[index] = color;
    onChange(next);
  };

  return (
    <div className="py-[3px]">
      <div className="flex items-center gap-2 mb-1">
        <label className="w-[90px] shrink-0 text-[11px] text-[var(--text-secondary)] truncate">{label}</label>
        <div className="flex gap-1 flex-wrap flex-1 min-w-0">
          {value.map((color, i) => {
            const hex6 = color.length === 9 ? color.slice(0, 7) : color.length === 5 ? color.slice(0, 4) : color;
            return (
              <div key={i} className="relative group">
                <input
                  type="color"
                  value={hex6}
                  onChange={(e) => updateColor(i, e.target.value)}
                  className="!w-[20px] !h-[20px]"
                />
                {value.length > 1 && (
                  <button
                    onClick={() => removeColor(i)}
                    className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--text-secondary)] text-white rounded-full text-[8px] leading-none hidden group-hover:flex items-center justify-center"
                  >
                    x
                  </button>
                )}
              </div>
            );
          })}
          {value.length < maxColors && (
            <button
              onClick={addColor}
              className="w-[20px] h-[20px] border border-dashed border-[var(--control-border)] rounded text-[var(--text-tertiary)] text-[11px] flex items-center justify-center hover:border-[var(--text-secondary)]"
            >
              +
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
