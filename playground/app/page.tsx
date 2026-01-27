'use client';

import { useState, useCallback } from 'react';
import { shaderRegistry } from '@/lib/shader-registry';
import { ShaderSidebar } from '@/components/ShaderSidebar';
import { ShaderPreview } from '@/components/ShaderPreview';
import { ControlPanel } from '@/components/ControlPanel';

export default function PlaygroundPage() {
  const [activeSlug, setActiveSlug] = useState('mesh-gradient');
  const [params, setParams] = useState<Record<string, any>>(() => {
    const entry = shaderRegistry.find((s) => s.slug === 'mesh-gradient')!;
    return { ...entry.presets[0].params };
  });
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [activePresetIndex, setActivePresetIndex] = useState(0);

  const shaderEntry = shaderRegistry.find((s) => s.slug === activeSlug)!;

  const handleShaderChange = useCallback((slug: string) => {
    const entry = shaderRegistry.find((s) => s.slug === slug)!;
    setActiveSlug(slug);
    setParams({ ...entry.presets[0].params });
    setActivePresetIndex(0);
  }, []);

  const handleParamChange = useCallback((updates: Record<string, any>) => {
    setParams((prev) => ({ ...prev, ...updates }));
    setActivePresetIndex(-1);
  }, []);

  const handlePresetSelect = useCallback((presetParams: Record<string, any>) => {
    setParams({ ...presetParams });
    const entry = shaderRegistry.find((s) => s.slug === activeSlug);
    if (entry) {
      const idx = entry.presets.findIndex((p) => p.params === presetParams);
      setActivePresetIndex(idx);
    }
  }, [activeSlug]);

  return (
    <div className="flex h-screen overflow-hidden">
      <ShaderSidebar activeSlug={activeSlug} onSelect={handleShaderChange} />
      <ShaderPreview shaderEntry={shaderEntry} params={params} imageUrl={imageUrl} />
      <ControlPanel
        shaderEntry={shaderEntry}
        params={params}
        onChange={handleParamChange}
        imageUrl={imageUrl}
        onImageChange={setImageUrl}
        onPresetSelect={handlePresetSelect}
        activePresetIndex={activePresetIndex}
      />
    </div>
  );
}
