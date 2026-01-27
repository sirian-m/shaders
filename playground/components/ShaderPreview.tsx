'use client';

import type { ShaderEntry } from '@/lib/shader-registry';

interface ShaderPreviewProps {
  shaderEntry: ShaderEntry;
  params: Record<string, any>;
  imageUrl: string | undefined;
}

export function ShaderPreview({ shaderEntry, params, imageUrl }: ShaderPreviewProps) {
  const { Component, requiresImage } = shaderEntry;

  const shaderProps: Record<string, any> = { ...params };

  if (requiresImage) {
    shaderProps.image = imageUrl || '';
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 relative bg-[var(--bg-canvas)]">
      <Component {...shaderProps} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
