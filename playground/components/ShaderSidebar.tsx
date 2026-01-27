'use client';

import { useState } from 'react';
import { proceduralShaders, imageShaders, type ShaderEntry } from '@/lib/shader-registry';

interface ShaderSidebarProps {
  activeSlug: string;
  onSelect: (slug: string) => void;
}

function ShaderButton({
  entry,
  active,
  onSelect,
}: {
  entry: ShaderEntry;
  active: boolean;
  onSelect: (slug: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(entry.slug)}
      className={`
        w-full text-left px-2.5 py-[5px] text-[11px] rounded transition-colors
        ${active ? 'bg-[var(--bg-canvas)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-canvas)]/50'}
      `}
    >
      {entry.name}
    </button>
  );
}

export function ShaderSidebar({ activeSlug, onSelect }: ShaderSidebarProps) {
  const [search, setSearch] = useState('');

  const filter = (entries: ShaderEntry[]) =>
    search ? entries.filter((e) => e.name.toLowerCase().includes(search.toLowerCase())) : entries;

  const filteredProcedural = filter(proceduralShaders);
  const filteredImage = filter(imageShaders);

  return (
    <div className="w-[200px] shrink-0 bg-[var(--bg-panel)] border-r border-[var(--border)] flex flex-col h-full">
      <div className="p-2 border-b border-[var(--border)]">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[var(--bg-canvas)] border border-[var(--control-border)] rounded px-2 py-1 text-[11px] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-tertiary)]"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {filteredProcedural.length > 0 && (
          <div className="mb-2">
            <div className="px-2.5 py-1 text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
              Procedural
            </div>
            {filteredProcedural.map((entry) => (
              <ShaderButton key={entry.slug} entry={entry} active={activeSlug === entry.slug} onSelect={onSelect} />
            ))}
          </div>
        )}
        {filteredImage.length > 0 && (
          <div>
            <div className="px-2.5 py-1 text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
              Image
            </div>
            {filteredImage.map((entry) => (
              <ShaderButton key={entry.slug} entry={entry} active={activeSlug === entry.slug} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
