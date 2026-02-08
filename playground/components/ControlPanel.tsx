'use client';

import { useState, useCallback } from 'react';
import type { ShaderEntry, ParamConfig } from '@/lib/shader-registry';
import { SliderControl } from './controls/SliderControl';
import { ColorControl } from './controls/ColorControl';
import { ColorArrayControl } from './controls/ColorArrayControl';
import { SelectControl } from './controls/SelectControl';
import { BooleanControl } from './controls/BooleanControl';
import { ImageUpload } from './ImageUpload';

interface ControlPanelProps {
  shaderEntry: ShaderEntry;
  params: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
  imageUrl: string | undefined;
  onImageChange: (url: string | undefined) => void;
  onPresetSelect: (params: Record<string, any>) => void;
  activePresetIndex: number;
}

function renderControl(
  config: ParamConfig,
  value: any,
  onChange: (key: string, value: any) => void
) {
  switch (config.type) {
    case 'number':
      return (
        <SliderControl
          key={config.key}
          label={config.label}
          value={value ?? config.min}
          min={config.min}
          max={config.max}
          step={config.step}
          onChange={(v) => onChange(config.key, v)}
        />
      );
    case 'color':
      return (
        <ColorControl
          key={config.key}
          label={config.label}
          value={value ?? '#000000'}
          onChange={(v) => onChange(config.key, v)}
        />
      );
    case 'colorArray':
      return (
        <ColorArrayControl
          key={config.key}
          label={config.label}
          value={value ?? ['#ffffff']}
          maxColors={config.maxColors}
          onChange={(v) => onChange(config.key, v)}
        />
      );
    case 'select':
      return (
        <SelectControl
          key={config.key}
          label={config.label}
          value={value ?? config.options[0]}
          options={config.options}
          onChange={(v) => onChange(config.key, v)}
        />
      );
    case 'boolean':
      return (
        <BooleanControl
          key={config.key}
          label={config.label}
          value={value ?? false}
          onChange={(v) => onChange(config.key, v)}
        />
      );
  }
}

export function ControlPanel({
  shaderEntry,
  params,
  onChange,
  imageUrl,
  onImageChange,
  onPresetSelect,
  activePresetIndex,
}: ControlPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleChange = (key: string, value: any) => {
    onChange({ [key]: value });
  };

  const handleCopySettings = useCallback(() => {
    const json = JSON.stringify(params, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [params]);

  // Split params into shader-specific and sizing
  const sizingKeys = new Set(['fit', 'scale', 'rotation', 'offsetX', 'offsetY']);
  const shaderParams = shaderEntry.params.filter((p) => !sizingKeys.has(p.key));
  const sizingParamConfigs = shaderEntry.params.filter((p) => sizingKeys.has(p.key));

  return (
    <div className="w-[280px] shrink-0 bg-[var(--bg-panel)] border-l border-[var(--border)] flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-[var(--text-primary)]">{shaderEntry.name}</div>
          <button
            onClick={handleCopySettings}
            className="px-2 py-0.5 rounded text-[10px] border transition-colors bg-[var(--bg-canvas)] text-[var(--text-secondary)] border-[var(--control-border)] hover:border-[var(--text-secondary)]"
          >
            {copied ? 'Copied!' : 'Copy JSON'}
          </button>
        </div>

        {/* Presets */}
        {shaderEntry.presets.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {shaderEntry.presets.map((preset, i) => (
              <button
                key={preset.name}
                onClick={() => onPresetSelect(preset.params)}
                className={`
                  px-2 py-0.5 rounded text-[10px] border transition-colors
                  ${
                    activePresetIndex === i
                      ? 'bg-[var(--text-primary)] text-white border-[var(--text-primary)]'
                      : 'bg-[var(--bg-canvas)] text-[var(--text-secondary)] border-[var(--control-border)] hover:border-[var(--text-secondary)]'
                  }
                `}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Image upload (only for image shaders) */}
      {shaderEntry.requiresImage && (
        <div className="px-3 pt-2 pb-1 border-b border-[var(--border)]">
          <ImageUpload value={imageUrl} onChange={onImageChange} />
        </div>
      )}

      {/* Shader params */}
      <div className="px-3 py-2 flex-1">
        {shaderParams
          .filter((config) => {
            if (!config.visibleWhen) return true;
            return params[config.visibleWhen.key] === config.visibleWhen.is;
          })
          .map((config) => renderControl(config, params[config.key], handleChange))}

        {/* Sizing section (collapsible) */}
        {sizingParamConfigs.length > 0 && (
          <details className="mt-2 pt-2 border-t border-[var(--border)]">
            <summary className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider cursor-pointer select-none py-1">
              Sizing
            </summary>
            <div className="mt-1">
              {sizingParamConfigs.map((config) => renderControl(config, params[config.key], handleChange))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
