import React, { memo, useLayoutEffect, useMemo, useState } from 'react';
import { ShaderMount, type ShaderComponentProps } from '../shader-mount.js';
import {
  getShaderColorFromString,
  bloomFragmentShader,
  ShaderFitOptions,
  type BloomUniforms,
  type BloomParams,
  defaultObjectSizing,
  toProcessedBloom,
  type ImageShaderPreset,
} from '@paper-design/shaders';

import { transparentPixel } from '../transparent-pixel.js';
import { suspend } from '../suspend.js';
import { colorPropsAreEqual } from '../color-props-are-equal.js';

export interface BloomProps extends ShaderComponentProps, BloomParams {
  /**
   * Suspends the component when the image is being processed.
   */
  suspendWhenProcessingImage?: boolean;
}

export type BloomPreset = ImageShaderPreset<BloomParams>;

export const defaultPreset: BloomPreset = {
  name: 'Default',
  params: {
    ...defaultObjectSizing,
    scale: 0.75,
    speed: 8.1,
    frame: 0,
    bloomSpread: 0.33,
    contour: 1,
    noise: 0.1,
    softness: 1,
    innerGlow: 0.35,
    outerGlow: 0.15,
    petalEmphasis: 0.92,
    waveCurvature: 0.5,
    waveClarity: 0.5,
    highlightIntensity: 0,
    highlightAngle: 0.15,
    highlightSharpness: 0.5,
    highlightRimWidth: 0.3,
    highlightRimStrength: 0.5,
    highlightBodyCurve: 0.5,
    debugNormals: false,
    colorBack: '#ffffff',
    colors: ['#FF5C95', '#FFA3C7', '#FFCEE3', '#FFEEF5'],
  },
} as const satisfies BloomPreset;

export const chromePreset: BloomPreset = {
  name: 'Chrome',
  params: {
    ...defaultObjectSizing,
    scale: 0.75,
    speed: 3.7,
    frame: 0,
    bloomSpread: 0.56,
    contour: 1,
    noise: 0.36,
    softness: 0.26,
    innerGlow: 0.4,
    outerGlow: 0.13,
    petalEmphasis: 0.4,
    waveCurvature: 0.36,
    waveClarity: 0.5,
    highlightIntensity: 0,
    highlightAngle: 0.15,
    highlightSharpness: 0.5,
    highlightRimWidth: 0.3,
    highlightRimStrength: 0.5,
    highlightBodyCurve: 0.5,
    debugNormals: false,
    colorBack: '#1a1a1a',
    colors: ['#f7f7f7', '#000000', '#ffffff'],
  },
} as const satisfies BloomPreset;

export const neonPreset: BloomPreset = {
  name: 'Neon',
  params: {
    ...defaultObjectSizing,
    scale: 0.75,
    speed: 1.2,
    frame: 0,
    bloomSpread: 0.7,
    contour: 0.3,
    noise: 0.15,
    softness: 0.8,
    innerGlow: 0.8,
    outerGlow: 0.7,
    petalEmphasis: 0.5,
    waveCurvature: 0.5,
    waveClarity: 0.5,
    highlightIntensity: 0,
    highlightAngle: 0.15,
    highlightSharpness: 0.5,
    highlightRimWidth: 0.3,
    highlightRimStrength: 0.5,
    highlightBodyCurve: 0.5,
    debugNormals: false,
    colorBack: '#000000',
    colors: ['#00ff88', '#00ccff', '#8844ff', '#ff00aa', '#ff6600'],
  },
} as const satisfies BloomPreset;

export const bloomPresets: BloomPreset[] = [defaultPreset, chromePreset, neonPreset];

export const Bloom: React.FC<BloomProps> = memo(function BloomImpl({
  // Own props
  speed = defaultPreset.params.speed,
  frame = defaultPreset.params.frame,
  image = '',
  bloomSpread = defaultPreset.params.bloomSpread,
  contour = defaultPreset.params.contour,
  noise = defaultPreset.params.noise,
  softness = defaultPreset.params.softness,
  innerGlow = defaultPreset.params.innerGlow,
  outerGlow = defaultPreset.params.outerGlow,
  petalEmphasis = defaultPreset.params.petalEmphasis,
  waveCurvature = defaultPreset.params.waveCurvature,
  waveClarity = defaultPreset.params.waveClarity,
  highlightIntensity = defaultPreset.params.highlightIntensity,
  highlightAngle = defaultPreset.params.highlightAngle,
  highlightSharpness = defaultPreset.params.highlightSharpness,
  highlightRimWidth = defaultPreset.params.highlightRimWidth,
  highlightRimStrength = defaultPreset.params.highlightRimStrength,
  highlightBodyCurve = defaultPreset.params.highlightBodyCurve,
  debugNormals = false,
  colorBack = defaultPreset.params.colorBack,
  colors = defaultPreset.params.colors,
  suspendWhenProcessingImage = false,

  // Sizing props
  fit = defaultPreset.params.fit,
  offsetX = defaultPreset.params.offsetX,
  offsetY = defaultPreset.params.offsetY,
  originX = defaultPreset.params.originX,
  originY = defaultPreset.params.originY,
  rotation = defaultPreset.params.rotation,
  scale = defaultPreset.params.scale,
  worldHeight = defaultPreset.params.worldHeight,
  worldWidth = defaultPreset.params.worldWidth,
  ...props
}: BloomProps) {
  const imageUrl = typeof image === 'string' ? image : image.src;
  const [processedStateImage, setProcessedStateImage] = useState<string>(transparentPixel);

  let processedImage: string;

  // toProcessedBloom expects the document object to exist. This prevents SSR issues during builds.
  if (suspendWhenProcessingImage && typeof window !== 'undefined') {
    processedImage = suspend(
      (): Promise<string> => toProcessedBloom(imageUrl).then((result) => URL.createObjectURL(result.blob)),
      [imageUrl, 'bloom']
    );
  } else {
    processedImage = processedStateImage;
  }

  useLayoutEffect(() => {
    if (suspendWhenProcessingImage) {
      // Skip doing work in the effect as it's been handled by suspense.
      return;
    }

    if (!imageUrl) {
      setProcessedStateImage(transparentPixel);
      return;
    }

    let url: string;
    let current = true;

    toProcessedBloom(imageUrl).then((result) => {
      if (current) {
        url = URL.createObjectURL(result.blob);
        setProcessedStateImage(url);
      }
    });

    return () => {
      current = false;
    };
  }, [imageUrl, suspendWhenProcessingImage]);

  const uniforms = useMemo(
    () => ({
      // Own uniforms
      u_image: processedImage,
      u_bloomSpread: bloomSpread,
      u_contour: contour,
      u_noise: noise,
      u_softness: softness,
      u_innerGlow: innerGlow,
      u_outerGlow: outerGlow,
      u_petalEmphasis: petalEmphasis,
      u_waveCurvature: waveCurvature,
      u_waveClarity: waveClarity,
      u_highlightIntensity: highlightIntensity,
      u_highlightAngle: highlightAngle,
      u_highlightSharpness: highlightSharpness,
      u_highlightRimWidth: highlightRimWidth,
      u_highlightRimStrength: highlightRimStrength,
      u_highlightBodyCurve: highlightBodyCurve,
      u_debugNormals: debugNormals ? 1.0 : 0.0,
      u_colorBack: getShaderColorFromString(colorBack),
      u_colors: colors.map(getShaderColorFromString),
      u_colorsCount: colors.length,

      // Sizing uniforms
      u_fit: ShaderFitOptions[fit],
      u_offsetX: offsetX,
      u_offsetY: offsetY,
      u_originX: originX,
      u_originY: originY,
      u_rotation: rotation,
      u_scale: scale,
      u_worldHeight: worldHeight,
      u_worldWidth: worldWidth,
    }),
    [
      speed,
      frame,
      bloomSpread,
      contour,
      noise,
      softness,
      innerGlow,
      outerGlow,
      petalEmphasis,
      waveCurvature,
      waveClarity,
      highlightIntensity,
      highlightAngle,
      highlightSharpness,
      highlightRimWidth,
      highlightRimStrength,
      highlightBodyCurve,
      debugNormals,
      colors,
      colorBack,
      processedImage,
      fit,
      offsetX,
      offsetY,
      originX,
      originY,
      rotation,
      scale,
      worldHeight,
      worldWidth,
    ]
  ) satisfies BloomUniforms;

  return (
    <ShaderMount
      {...props}
      speed={speed}
      frame={frame}
      fragmentShader={bloomFragmentShader}
      mipmaps={['u_image']}
      uniforms={uniforms}
    />
  );
}, colorPropsAreEqual);
