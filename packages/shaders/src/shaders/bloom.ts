import type { vec4 } from '../types.js';
import type { ShaderMotionParams } from '../shader-mount.js';
import type { ShaderSizingParams, ShaderSizingUniforms } from '../shader-sizing.js';
import { declarePI, simplexNoise, colorBandingFix } from '../shader-utils.js';

export const bloomMeta = {
  maxColorCount: 10,
} as const;

/**
 * A blooming radial animation combining multi-color gradient glow with metallic
 * surface effects, applied to an input image. The animation emanates from the
 * center of the shape outward, following petal contours of the input image.
 *
 * Fragment shader uniforms:
 * - u_time (float): Animation time
 * - u_image (sampler2D): Pre-processed source image texture (R = poisson distance, G = alpha, B = blur)
 * - u_imageAspectRatio (float): Aspect ratio of the source image
 * - u_colorBack (vec4): Background color in RGBA
 * - u_colors (vec4[]): Up to 10 bloom colors in RGBA
 * - u_colorsCount (float): Number of active colors
 * - u_bloomSpread (float): Width of the bloom wavefront (0 to 1)
 * - u_metallic (float): Blend between color glow and metallic surface (0 to 1)
 * - u_contour (float): Edge emphasis strength (0 to 1)
 * - u_noise (float): Organic noise intensity (0 to 1)
 * - u_softness (float): Color transition sharpness (0 to 1)
 * - u_innerGlow (float): Glow intensity inside the shape (0 to 1)
 * - u_outerGlow (float): Glow intensity outside the shape (0 to 1)
 * - u_petalEmphasis (float): Contour-following vs uniform radial (0 to 1)
 *
 * Vertex shader outputs (used in fragment shader):
 * - v_imageUV (vec2): UV coordinates for sampling the source image, with fit, scale, rotation, and offset applied
 * - v_objectUV (vec2): Object box UV coordinates with global sizing (scale, rotation, offsets, etc) applied
 *
 * Vertex shader uniforms:
 * - u_resolution (vec2): Canvas resolution in pixels
 * - u_pixelRatio (float): Device pixel ratio
 * - u_originX (float): Reference point for positioning world width in the canvas (0 to 1)
 * - u_originY (float): Reference point for positioning world height in the canvas (0 to 1)
 * - u_worldWidth (float): Virtual width of the graphic before it's scaled to fit the canvas
 * - u_worldHeight (float): Virtual height of the graphic before it's scaled to fit the canvas
 * - u_fit (float): How to fit the rendered shader into the canvas dimensions (0 = none, 1 = contain, 2 = cover)
 * - u_scale (float): Overall zoom level of the graphics (0.01 to 4)
 * - u_rotation (float): Overall rotation angle of the graphics in degrees (0 to 360)
 * - u_offsetX (float): Horizontal offset of the graphics center (-1 to 1)
 * - u_offsetY (float): Vertical offset of the graphics center (-1 to 1)
 * - u_imageAspectRatio (float): Aspect ratio of the source image
 *
 */

// language=GLSL
export const bloomFragmentShader: string = `#version 300 es
precision highp float;

in mediump vec2 v_imageUV;
in mediump vec2 v_objectUV;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_time;
uniform mediump float u_imageAspectRatio;

uniform vec4 u_colorBack;
uniform vec4 u_colors[${ bloomMeta.maxColorCount }];
uniform float u_colorsCount;

uniform float u_bloomSpread;
uniform float u_metallic;
uniform float u_contour;
uniform float u_noise;
uniform float u_softness;
uniform float u_innerGlow;
uniform float u_outerGlow;
uniform float u_petalEmphasis;

${ declarePI }
${ simplexNoise }

float getImgFrame(vec2 uv, float th) {
  float frame = 1.;
  frame *= smoothstep(0., th, uv.y);
  frame *= 1. - smoothstep(1. - th, 1., uv.y);
  frame *= smoothstep(0., th, uv.x);
  frame *= 1. - smoothstep(1. - th, 1., uv.x);
  return frame;
}

float blurEdge3x3(sampler2D tex, vec2 uv, vec2 dudx, vec2 dudy, float radius, float centerSample) {
  vec2 texel = 1.0 / vec2(textureSize(tex, 0));
  vec2 r = radius * texel;

  float w1 = 1.0, w2 = 2.0, w4 = 4.0;
  float norm = 16.0;
  float sum = w4 * centerSample;

  sum += w2 * textureGrad(tex, uv + vec2(0.0, -r.y), dudx, dudy).b;
  sum += w2 * textureGrad(tex, uv + vec2(0.0, r.y), dudx, dudy).b;
  sum += w2 * textureGrad(tex, uv + vec2(-r.x, 0.0), dudx, dudy).b;
  sum += w2 * textureGrad(tex, uv + vec2(r.x, 0.0), dudx, dudy).b;

  sum += w1 * textureGrad(tex, uv + vec2(-r.x, -r.y), dudx, dudy).b;
  sum += w1 * textureGrad(tex, uv + vec2(r.x, -r.y), dudx, dudy).b;
  sum += w1 * textureGrad(tex, uv + vec2(-r.x, r.y), dudx, dudy).b;
  sum += w1 * textureGrad(tex, uv + vec2(r.x, r.y), dudx, dudy).b;

  return sum / norm;
}

float bloomWave(float animCoord, float wavePos, float spread) {
  // Create a smooth band centered at wavePos
  float lower = smoothstep(wavePos - spread, wavePos - spread * .3, animCoord);
  float upper = 1. - smoothstep(wavePos + spread * .3, wavePos + spread, animCoord);
  return lower * upper;
}

void main() {
  vec2 uv = v_objectUV + .5;
  uv.y = 1. - uv.y;

  vec2 imgUV = v_imageUV;
  imgUV -= .5;
  imgUV *= 0.5714285714285714;
  imgUV += .5;
  float imgSoftFrame = getImgFrame(imgUV, .03);

  vec4 img = texture(u_image, imgUV);
  vec2 dudx = dFdx(imgUV);
  vec2 dudy = dFdy(imgUV);

  if (img.a == 0.) {
    fragColor = u_colorBack;
    return;
  }

  float t = .1 * u_time;

  // --- Distance fields ---
  // R channel: Poisson distance (0 at edges, 1 at deepest interior)
  float poissonDist = img.r;

  // G channel: original alpha / opacity
  float shapeAlpha = img.g;

  // B channel: blur data for glow
  float blurData = img.b;
  blurData = blurEdge3x3(u_image, imgUV, dudx, dudy, 8., blurData);

  // Euclidean radial distance from center (0 at center, 1 at edge)
  float radial = length(imgUV - vec2(.5)) * 2.;
  radial = clamp(radial, 0., 1.);

  // Radial from center: 1 at center, 0 at edge
  float radialFromCenter = 1. - radial;

  // Blend contour-following distance with radial distance
  // petalEmphasis=0: uniform radial, petalEmphasis=1: follows petal contours
  float animCoord = mix(radialFromCenter, poissonDist, u_petalEmphasis);

  // --- Bloom wave animation ---
  // 3 overlapping waves at 1/3 period offset for continuous animation
  float spread = mix(.08, .5, u_bloomSpread);

  float wave1Pos = fract(t);
  float wave2Pos = fract(t + .333);
  float wave3Pos = fract(t + .667);

  // Waves sweep from high animCoord (center/interior) to low (edges)
  // Invert wave position so wave starts from center
  float w1 = bloomWave(animCoord, 1. - wave1Pos, spread);
  float w2 = bloomWave(animCoord, 1. - wave2Pos, spread);
  float w3 = bloomWave(animCoord, 1. - wave3Pos, spread);

  float waveIntensity = clamp(w1 + w2 + w3, 0., 1.);

  // --- Organic noise distortion ---
  float noise = snoise(imgUV * 6. + t * .3);
  waveIntensity += u_noise * .2 * noise * waveIntensity;
  waveIntensity = clamp(waveIntensity, 0., 1.);

  // --- Glow effects ---
  // Determine inside/outside shape
  float isInside = 1. - smoothstep(.01, .05, poissonDist);

  float outerBlur = 1. - mix(1., blurData, isInside);
  outerBlur *= imgSoftFrame;
  float innerBlur = mix(blurData, 0., isInside);

  float innerGlow = (1. - isInside) * innerBlur * mix(0., 2., u_innerGlow);
  float outerGlow = isInside * outerBlur * mix(0., 5., pow(u_outerGlow, 2.));

  // --- Edge contour ---
  float edgeDist = poissonDist;
  float edge = smoothstep(.0, .04, edgeDist) * (1. - smoothstep(.04, .12, edgeDist));
  float contourBoost = u_contour * 2. * edge;

  // --- Combine heat value ---
  float heat = waveIntensity * (1. - isInside);
  heat += innerGlow;
  heat += outerGlow;
  heat += contourBoost * (1. - isInside);
  heat = clamp(heat, 0., 1.);

  // --- Apply softness to heat distribution ---
  heat = pow(heat, mix(1.5, .7, u_softness));

  // Add grain noise
  heat += (.005 + .35 * u_noise) * (fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453123) - .5);
  heat = clamp(heat, 0., 1.);

  // --- Multi-color gradient mapping (identical to heatmap pattern) ---
  float mixer = heat * u_colorsCount;
  vec4 gradient = u_colors[0];
  gradient.rgb *= gradient.a;
  float outerShape = 0.;
  for (int i = 1; i < ${ bloomMeta.maxColorCount + 1 }; i++) {
    if (i > int(u_colorsCount)) break;
    float m = clamp(mixer - float(i - 1), 0., 1.);
    if (i == 1) {
      outerShape = m;
    }
    vec4 c = u_colors[i - 1];
    c.rgb *= c.a;
    gradient = mix(gradient, c, m);
  }

  // --- Metallic layer ---
  // Compute gradient direction from distance field for metallic reflections
  float dDistDx = dFdx(poissonDist);
  float dDistDy = dFdy(poissonDist);
  float gradMag = length(vec2(dDistDx, dDistDy));

  // Create reflective bands along isocontour lines
  vec2 gradDir = normalize(vec2(dDistDx, dDistDy) + .001);
  float stripe = dot(gradDir, imgUV * 8.) - t * .5;
  stripe += u_noise * .5 * snoise(imgUV * 4. - t * .2);

  float metallicBand = .5 + .45 * sin(stripe * TWO_PI);

  // Bump from distance field
  float bump = pow(clamp(poissonDist, 0., 1.), .8);
  metallicBand = mix(metallicBand, .8 + .2 * metallicBand, .3 * bump);

  // Add specular highlight
  float specular = pow(max(0., sin(stripe * TWO_PI * 2.)), 8.) * .3;
  metallicBand += specular;

  metallicBand = clamp(metallicBand, 0., 1.);

  // --- Blend glow and metallic ---
  vec3 glowColor = gradient.rgb * outerShape;
  float glowOpacity = gradient.a * outerShape;

  // Metallic modulates the gradient colors
  vec3 metalColor = glowColor * metallicBand;
  float metalOpacity = glowOpacity;

  vec3 color = mix(glowColor, metalColor, u_metallic);
  float opacity = mix(glowOpacity, metalOpacity, u_metallic);

  // --- Composite over background ---
  vec3 bgColor = u_colorBack.rgb * u_colorBack.a;
  color = color + bgColor * (1.0 - opacity);
  opacity = opacity + u_colorBack.a * (1.0 - opacity);

  // --- Color banding fix ---
  ${ colorBandingFix }

  fragColor = vec4(color, opacity);
}
`;

// ----- Image processing ----- //

const BLOOM_POISSON_CONFIG = {
  workingSize: 512,
  iterations: 40,
};

interface SparsePixelData {
  interiorPixels: Uint32Array;
  boundaryPixels: Uint32Array;
  pixelCount: number;
  neighborIndices: Int32Array;
}

export function toProcessedBloom(file: File | string): Promise<{ blob: Blob }> {
  const canvasSize = 1000;
  const canvas = document.createElement('canvas');

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';

    const isBlob = typeof file === 'string' && file.startsWith('blob:');
    const blobContentTypePromise = isBlob && fetch(file).then((res) => res.headers.get('Content-Type'));

    image.addEventListener('load', async () => {
      // Detect SVG
      let isSVG: boolean;
      const blobContentType = await blobContentTypePromise;

      if (blobContentType) {
        isSVG = blobContentType === 'image/svg+xml';
      } else if (typeof file === 'string') {
        isSVG = file.endsWith('.svg') || file.startsWith('data:image/svg+xml');
      } else {
        isSVG = file.type === 'image/svg+xml';
      }

      let originalWidth = image.width || image.naturalWidth;
      let originalHeight = image.height || image.naturalHeight;

      if (isSVG) {
        const svgMaxSize = 4096;
        const aspectRatio = originalWidth / originalHeight;
        if (originalWidth > originalHeight) {
          originalWidth = svgMaxSize;
          originalHeight = svgMaxSize / aspectRatio;
        } else {
          originalHeight = svgMaxSize;
          originalWidth = svgMaxSize * aspectRatio;
        }
        image.width = originalWidth;
        image.height = originalHeight;
      }

      const ratio = originalWidth / originalHeight;

      // --- Padded canvas for glow (like heatmap) ---
      const maxBlur = Math.floor(canvasSize * 0.15);
      const padding = Math.ceil(maxBlur * 2.5);
      let imgWidth = canvasSize;
      let imgHeight = canvasSize;
      if (ratio > 1) {
        imgHeight = Math.floor(canvasSize / ratio);
      } else {
        imgWidth = Math.floor(canvasSize * ratio);
      }

      canvas.width = imgWidth + 2 * padding;
      canvas.height = imgHeight + 2 * padding;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Failed to get canvas 2d context'));
        return;
      }

      // --- Step 1: Draw image for blur data ---
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, padding, padding, imgWidth, imgHeight);

      const { width, height } = canvas;
      const blurImageData = ctx.getImageData(0, 0, width, height);
      const blurSrc = blurImageData.data;

      // Build grayscale for blur
      const totalPixels = width * height;
      const gray = new Uint8ClampedArray(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        const px = i * 4;
        const r = blurSrc[px] ?? 0;
        const g = blurSrc[px + 1] ?? 0;
        const b = blurSrc[px + 2] ?? 0;
        gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      }

      // Large blur for glow
      const bigBlurGray = multiPassBlurGray(gray, width, height, maxBlur, 3);

      // --- Step 2: Poisson distance field (like liquid metal) ---
      const minDimension = Math.min(originalWidth, originalHeight);
      const targetSize = BLOOM_POISSON_CONFIG.workingSize;
      const scaleFactor = targetSize / minDimension;
      const poissonWidth = Math.round(originalWidth * scaleFactor);
      const poissonHeight = Math.round(originalHeight * scaleFactor);

      const shapeCanvas = document.createElement('canvas');
      shapeCanvas.width = poissonWidth;
      shapeCanvas.height = poissonHeight;
      const shapeCtx = shapeCanvas.getContext('2d')!;
      shapeCtx.drawImage(image, 0, 0, poissonWidth, poissonHeight);

      const shapeImageData = shapeCtx.getImageData(0, 0, poissonWidth, poissonHeight);
      const shapeData = shapeImageData.data;

      // Build shape mask from alpha
      const shapeMask = new Uint8Array(poissonWidth * poissonHeight);
      const boundaryMask = new Uint8Array(poissonWidth * poissonHeight);

      for (let i = 0, idx = 0; i < shapeData.length; i += 4, idx++) {
        const a = shapeData[i + 3];
        shapeMask[idx] = a === 0 ? 0 : 1;
      }

      // Boundary detection
      const boundaryIndices: number[] = [];
      const interiorIndices: number[] = [];

      for (let y = 0; y < poissonHeight; y++) {
        for (let x = 0; x < poissonWidth; x++) {
          const idx = y * poissonWidth + x;
          if (!shapeMask[idx]) continue;

          let isBoundary = false;
          if (x === 0 || x === poissonWidth - 1 || y === 0 || y === poissonHeight - 1) {
            isBoundary = true;
          } else {
            isBoundary =
              !shapeMask[idx - 1] ||
              !shapeMask[idx + 1] ||
              !shapeMask[idx - poissonWidth] ||
              !shapeMask[idx + poissonWidth] ||
              !shapeMask[idx - poissonWidth - 1] ||
              !shapeMask[idx - poissonWidth + 1] ||
              !shapeMask[idx + poissonWidth - 1] ||
              !shapeMask[idx + poissonWidth + 1];
          }

          if (isBoundary) {
            boundaryMask[idx] = 1;
            boundaryIndices.push(idx);
          } else {
            interiorIndices.push(idx);
          }
        }
      }

      // Build sparse data and solve Poisson
      const sparseData = buildSparseData(
        shapeMask,
        new Uint32Array(interiorIndices),
        new Uint32Array(boundaryIndices),
        poissonWidth,
        poissonHeight
      );

      const u = solvePoissonSparse(sparseData, shapeMask, poissonWidth, poissonHeight);

      // Find max value
      let maxVal = 0;
      for (let i = 0; i < interiorIndices.length; i++) {
        const idx = interiorIndices[i]!;
        if (u[idx]! > maxVal) maxVal = u[idx]!;
      }

      // Create Poisson distance at working resolution
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = poissonWidth;
      tempCanvas.height = poissonHeight;
      const tempCtx = tempCanvas.getContext('2d')!;
      const tempImg = tempCtx.createImageData(poissonWidth, poissonHeight);

      for (let y = 0; y < poissonHeight; y++) {
        for (let x = 0; x < poissonWidth; x++) {
          const idx = y * poissonWidth + x;
          const px = idx * 4;

          if (!shapeMask[idx]) {
            tempImg.data[px] = 0;
            tempImg.data[px + 1] = 0;
            tempImg.data[px + 2] = 0;
            tempImg.data[px + 3] = 255;
          } else {
            const poissonRatio = maxVal > 0 ? u[idx]! / maxVal : 0;
            const dist = Math.round(255 * poissonRatio);
            tempImg.data[px] = dist; // R: Poisson distance (0=edge, 255=deep interior)
            tempImg.data[px + 1] = shapeData[idx * 4 + 3] ?? 0; // G: original alpha
            tempImg.data[px + 2] = 0; // placeholder, blur added later
            tempImg.data[px + 3] = 255;
          }
        }
      }
      tempCtx.putImageData(tempImg, 0, 0);

      // --- Step 3: Upscale Poisson to padded canvas size ---
      // Draw Poisson result into the padded region
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = width;
      outputCanvas.height = height;
      const outputCtx = outputCanvas.getContext('2d')!;

      // First fill with zeros (background)
      outputCtx.fillStyle = 'black';
      outputCtx.fillRect(0, 0, width, height);

      // Upscale Poisson data into the padded region
      outputCtx.imageSmoothingEnabled = true;
      outputCtx.imageSmoothingQuality = 'high';
      outputCtx.drawImage(tempCanvas, 0, 0, poissonWidth, poissonHeight, padding, padding, imgWidth, imgHeight);

      const outputData = outputCtx.getImageData(0, 0, width, height);

      // Re-read original at padded size for alpha
      const alphaCanvas = document.createElement('canvas');
      alphaCanvas.width = width;
      alphaCanvas.height = height;
      const alphaCtx = alphaCanvas.getContext('2d')!;
      alphaCtx.drawImage(image, padding, padding, imgWidth, imgHeight);
      const alphaData = alphaCtx.getImageData(0, 0, width, height);

      // --- Step 4: Combine channels ---
      const finalImageData = ctx.createImageData(width, height);
      const dst = finalImageData.data;

      for (let i = 0; i < totalPixels; i++) {
        const px = i * 4;
        dst[px] = outputData.data[px] ?? 0;             // R: Poisson distance
        dst[px + 1] = alphaData.data[px + 3] ?? 0;      // G: original alpha as opacity indicator
        dst[px + 2] = bigBlurGray[i] ?? 0;               // B: blur data for glow
        dst[px + 3] = 255;
      }

      ctx.putImageData(finalImageData, 0, 0);

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create PNG blob'));
          return;
        }
        resolve({ blob });
      }, 'image/png');
    });

    image.addEventListener('error', () => {
      reject(new Error('Failed to load image'));
    });

    image.src = typeof file === 'string' ? file : URL.createObjectURL(file);
  });
}

// ----- Poisson solver (from liquid-metal pattern) ----- //

function buildSparseData(
  shapeMask: Uint8Array,
  interiorPixels: Uint32Array,
  boundaryPixels: Uint32Array,
  width: number,
  height: number
): SparsePixelData {
  const pixelCount = interiorPixels.length;
  const neighborIndices = new Int32Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const idx = interiorPixels[i]!;
    const x = idx % width;
    const y = Math.floor(idx / width);

    neighborIndices[i * 4 + 0] = x < width - 1 && shapeMask[idx + 1] ? idx + 1 : -1;
    neighborIndices[i * 4 + 1] = x > 0 && shapeMask[idx - 1] ? idx - 1 : -1;
    neighborIndices[i * 4 + 2] = y > 0 && shapeMask[idx - width] ? idx - width : -1;
    neighborIndices[i * 4 + 3] = y < height - 1 && shapeMask[idx + width] ? idx + width : -1;
  }

  return {
    interiorPixels,
    boundaryPixels,
    pixelCount,
    neighborIndices,
  };
}

function solvePoissonSparse(
  sparseData: SparsePixelData,
  shapeMask: Uint8Array,
  width: number,
  height: number
): Float32Array {
  const ITERATIONS = BLOOM_POISSON_CONFIG.iterations;
  const C = 0.01;
  const omega = 1.9;

  const u = new Float32Array(width * height);
  const { interiorPixels, neighborIndices, pixelCount } = sparseData;

  const redPixels: number[] = [];
  const blackPixels: number[] = [];

  for (let i = 0; i < pixelCount; i++) {
    const idx = interiorPixels[i]!;
    const x = idx % width;
    const y = Math.floor(idx / width);

    if ((x + y) % 2 === 0) {
      redPixels.push(i);
    } else {
      blackPixels.push(i);
    }
  }

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const i of redPixels) {
      const idx = interiorPixels[i]!;
      const eastIdx = neighborIndices[i * 4 + 0]!;
      const westIdx = neighborIndices[i * 4 + 1]!;
      const northIdx = neighborIndices[i * 4 + 2]!;
      const southIdx = neighborIndices[i * 4 + 3]!;

      let sumN = 0;
      if (eastIdx >= 0) sumN += u[eastIdx]!;
      if (westIdx >= 0) sumN += u[westIdx]!;
      if (northIdx >= 0) sumN += u[northIdx]!;
      if (southIdx >= 0) sumN += u[southIdx]!;

      const newValue = (C + sumN) / 4;
      u[idx] = omega * newValue + (1 - omega) * u[idx]!;
    }

    for (const i of blackPixels) {
      const idx = interiorPixels[i]!;
      const eastIdx = neighborIndices[i * 4 + 0]!;
      const westIdx = neighborIndices[i * 4 + 1]!;
      const northIdx = neighborIndices[i * 4 + 2]!;
      const southIdx = neighborIndices[i * 4 + 3]!;

      let sumN = 0;
      if (eastIdx >= 0) sumN += u[eastIdx]!;
      if (westIdx >= 0) sumN += u[westIdx]!;
      if (northIdx >= 0) sumN += u[northIdx]!;
      if (southIdx >= 0) sumN += u[southIdx]!;

      const newValue = (C + sumN) / 4;
      u[idx] = omega * newValue + (1 - omega) * u[idx]!;
    }
  }

  return u;
}

// ----- Blur utilities (from heatmap pattern) ----- //

function blurGray(gray: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (radius <= 0) {
    return gray.slice();
  }

  const out = new Uint8ClampedArray(width * height);
  const integral = new Uint32Array(width * height);

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const v = gray[idx] ?? 0;
      rowSum += v;
      integral[idx] = rowSum + (y > 0 ? (integral[idx - width] ?? 0) : 0);
    }
  }

  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width - 1, x + radius);

      const idxA = y2 * width + x2;
      const idxB = y2 * width + (x1 - 1);
      const idxC = (y1 - 1) * width + x2;
      const idxD = (y1 - 1) * width + (x1 - 1);

      const A = integral[idxA] ?? 0;
      const B = x1 > 0 ? (integral[idxB] ?? 0) : 0;
      const C = y1 > 0 ? (integral[idxC] ?? 0) : 0;
      const D = x1 > 0 && y1 > 0 ? (integral[idxD] ?? 0) : 0;

      const sum = A - B - C + D;
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      out[y * width + x] = Math.round(sum / area);
    }
  }

  return out;
}

function multiPassBlurGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  passes: number
): Uint8ClampedArray {
  if (radius <= 0 || passes <= 1) {
    return blurGray(gray, width, height, radius);
  }

  let input = gray;
  let tmp: Uint8ClampedArray = gray;

  for (let p = 0; p < passes; p++) {
    tmp = blurGray(input, width, height, radius);
    input = tmp;
  }

  return tmp;
}

// ----- TypeScript interfaces ----- //

export interface BloomUniforms extends ShaderSizingUniforms {
  u_image: HTMLImageElement | string;
  u_colorBack: [number, number, number, number];
  u_colors: vec4[];
  u_colorsCount: number;
  u_bloomSpread: number;
  u_metallic: number;
  u_contour: number;
  u_noise: number;
  u_softness: number;
  u_innerGlow: number;
  u_outerGlow: number;
  u_petalEmphasis: number;
}

export interface BloomParams extends ShaderSizingParams, ShaderMotionParams {
  image: HTMLImageElement | string;
  colorBack?: string;
  colors?: string[];
  bloomSpread?: number;
  metallic?: number;
  contour?: number;
  noise?: number;
  softness?: number;
  innerGlow?: number;
  outerGlow?: number;
  petalEmphasis?: number;
}
