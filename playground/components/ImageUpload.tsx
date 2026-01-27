'use client';

import { useCallback, useRef, useState } from 'react';

interface ImageUploadProps {
  value: string | undefined;
  onChange: (url: string | undefined) => void;
}

export function ImageUpload({ value, onChange }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      onChange(url);
    },
    [onChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  if (value) {
    return (
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-[var(--text-secondary)]">Image</label>
          <button
            onClick={() => onChange(undefined)}
            className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline"
          >
            remove
          </button>
        </div>
        <img
          src={value}
          alt="Uploaded"
          className="mt-1 w-full h-[60px] object-contain rounded border border-[var(--control-border)] bg-[var(--bg-canvas)]"
        />
      </div>
    );
  }

  return (
    <div className="mb-2">
      <label className="text-[11px] text-[var(--text-secondary)] block mb-1">Image</label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          flex items-center justify-center h-[48px] rounded border border-dashed cursor-pointer
          text-[11px] text-[var(--text-tertiary)] transition-colors
          ${dragging ? 'border-[var(--accent)] bg-blue-50' : 'border-[var(--control-border)] hover:border-[var(--text-secondary)]'}
        `}
      >
        Drop image or click to browse
      </div>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} className="hidden" />
    </div>
  );
}
