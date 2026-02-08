import type { vec4 } from '../types.js';
import type { ShaderMotionParams } from '../shader-mount.js';
import type { ShaderSizingParams, ShaderSizingUniforms } from '../shader-sizing.js';
import { declarePI, simplexNoise, colorBandingFix } from '../shader-utils.js';

export const bloomMeta = {
  maxColorCount: 10,
} as const;

/**
 * A blooming radial animation combining multi-color gradient glow,
 * applied to an input image. The animation emanates from the
 * center of the shape outward, following petal contours of the input image.
 *
 * Fragment shader uniforms:
 * - u_time (float): Animation time
 * - u_image (sampler2D): Pre-processed source image texture (R = poisson distance, G = scale ratio for wave shape, B = blur)
 * - u_imageAspectRatio (float): Aspect ratio of the source image
 * - u_colorBack (vec4): Background color in RGBA
 * - u_colors (vec4[]): Up to 10 bloom colors in RGBA
 * - u_colorsCount (float): Number of active colors
 * - u_bloomSpread (float): Width of the bloom wavefront (0 to 1)
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
uniform float u_contour;
uniform float u_noise;
uniform float u_softness;
uniform float u_innerGlow;
uniform float u_outerGlow;
uniform float u_petalEmphasis;
uniform float u_waveCurvature;
uniform float u_waveClarity;
uniform float u_highlightIntensity;
uniform float u_highlightAngle;
uniform float u_highlightAngleSpeed;
uniform float u_highlightSharpness;
uniform float u_highlightRimWidth;
uniform float u_highlightRimStrength;
uniform float u_highlightBodyCurve;
uniform float u_debugNormals;

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

// Body dome height from scaleRatio (G channel), masked by Poisson (R channel).
// Smooth, slowly-varying field — computed at coarse scale for noise-free normals.
// The poissonR mask prevents a false rim at the shape boundary: outside the shape
// G=0 which would give max dome height; the R=0 mask forces it to zero instead.
float bodyDome(float scaleR, float poissonR, float bodyExp) {
  float bodyD = 1.0 - clamp(scaleR, 0.0, 1.0);
  float dome = pow(max(bodyD, 0.001), bodyExp);
  float mask = smoothstep(0.0, 0.05, poissonR);
  return dome * mask;
}

// Rim edge height from Poisson distance (R channel).
// Sharp feature near shape boundary — computed at fine scale for crisp normals.
// Raised ridge: outer slope faces outward (catches highlights),
// inner slope faces inward (convex-to-concave transition).
float rimEdge(float poissonD, float rimW, float rimStr) {
  float ed = sqrt(max(poissonD, 0.0));
  float rimRise = smoothstep(0.0, rimW * 0.7, ed);
  float rimFall = 1.0 - smoothstep(rimW * 0.7, rimW * 2.0, ed);
  return rimRise * rimFall * rimStr;
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

  float t = .1 * u_time;

  // --- Extract texture channels ---
  float poissonDist = img.r;
  float scaleRatio = img.g; // Pre-computed: 0 at center, 1 at outer boundary (petal-shaped contours)
  float blurData = img.b;
  blurData = blurEdge3x3(u_image, imgUV, dudx, dudy, 8., blurData);

  // Shape mask: derived from Poisson field (0 outside shape, 1 inside)
  float isShape = smoothstep(0.0, 0.03, poissonDist);

  // Early exit for pixels far from shape
  if (isShape < 0.01 && blurData < 0.01) {
    fragColor = u_colorBack;
    return;
  }

  // --- Shape value from Poisson distance ---
  // poissonDist: 0 at edges, 1 at deep interior
  // Apply falloff curve controlled by bloomSpread
  float falloff = mix(0.4, 2.5, u_bloomSpread);
  float baseShape = pow(poissonDist, falloff);

  // Radial distance: 1 at center, 0 at edge
  float radialFromCenter = 1. - clamp(length(imgUV - vec2(.5)) * 2., 0., 1.);
  float radialShape = pow(radialFromCenter, falloff);

  // petalEmphasis: 0=uniform radial, 1=follows petal contours
  float shape = mix(radialShape, baseShape, u_petalEmphasis);

  // --- Subtle edge darkening (contour) ---
  float edgeDark = smoothstep(0.0, mix(0.3, 0.02, u_contour), poissonDist);
  shape *= mix(1.0, edgeDark, isShape);

  // --- Inner glow: brightens interior ---
  float innerBrightness = poissonDist * mix(0.0, 0.3, u_innerGlow);
  shape = clamp(shape + innerBrightness * isShape, 0.0, 1.0);

  // --- Continuous outward wave from inner cutout ---
  // distFromCenter: 0 at image center (inner cutout), 1 at image edge (outer petals)
  float distFromCenter = 1.0 - radialFromCenter;
  // waveCurvature: 0 = circular wavefronts (radial), 1 = petal-shaped wavefronts
  // scaleRatio has iso-contours that are scaled versions of the outer boundary shape
  float waveCoord = mix(distFromCenter, scaleRatio, u_waveCurvature);

  // Two staggered wavefronts continuously traveling outward
  float cycle = t * 0.3;
  float wavePos1 = fract(cycle);
  float wavePos2 = fract(cycle + 0.5);

  // How long ago each wavefront passed this pixel (mod wraps around seamlessly)
  float age1 = mod(wavePos1 - waveCoord, 1.0);
  float age2 = mod(wavePos2 - waveCoord, 1.0);

  // Wave clarity ramp: waves start blurry near center, sharpen toward outer edge
  float clarityFactor = mix(1.0, pow(waveCoord, mix(1.0, 3.0, u_waveClarity)), u_waveClarity);

  // Trailing decay: exponential brightness falloff after wavefront passes
  float decayRate = mix(6.0, 2.0, u_bloomSpread) * max(clarityFactor, 0.1);
  float trail1 = exp(-age1 * decayRate);
  float trail2 = exp(-age2 * decayRate);

  // Soft leading edge: gradual ramp-up ahead of the wavefront
  float baseLeadWidth = mix(0.05, 0.2, u_softness);
  float leadWidth = baseLeadWidth / max(clarityFactor, 0.1);
  float ahead1 = 1.0 - age1;
  float ahead2 = 1.0 - age2;
  float lead1 = exp(-ahead1 * ahead1 / (2.0 * leadWidth * leadWidth));
  float lead2 = exp(-ahead2 * ahead2 / (2.0 * leadWidth * leadWidth));

  // Each wave: trailing decay behind + soft leading glow ahead
  float wave1 = max(trail1, lead1);
  float wave2 = max(trail2, lead2);
  float wave = max(wave1, wave2);

  // Wave modulates shape — creates visible traveling color gradient
  shape = shape * (0.3 + 0.7 * wave);

  // --- Organic noise distortion ---
  float noise = snoise(imgUV * 6. + t * .3);
  shape += u_noise * 0.1 * noise;
  shape = clamp(shape, 0.0, 1.0);

  // Mask shape to actual shape region
  shape *= isShape;

  // --- Outer glow (heatmap approach, kept as-is) ---
  float outerBlur = 1.0 - mix(1.0, blurData, 1.0 - isShape);
  outerBlur *= imgSoftFrame;
  float outerGlowBase = .9 * pow(max(outerBlur, 0.0), .8) * mix(0., 5., pow(u_outerGlow, 2.));
  float glowPulse = .5 + .5 * sin(TWO_PI * t + outerBlur * 6.);
  float outerGlowVal = outerGlowBase * (.4 + .6 * glowPulse);

  // Combine: shape fill inside + outer glow outside
  float combinedShape = shape + outerGlowVal;
  combinedShape = clamp(combinedShape, 0.0, 1.0);

  // Add grain noise
  combinedShape += (.005 + .35 * u_noise) * (fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453123) - .5);
  combinedShape = clamp(combinedShape, 0.0, 1.0);

  // --- Smooth multi-color gradient mapping (from static-radial-gradient) ---
  float mixer = combinedShape * u_colorsCount;
  vec4 gradient = u_colors[0];
  gradient.rgb *= gradient.a;
  float outerShape = 0.;

  for (int i = 1; i < ${ bloomMeta.maxColorCount + 1 }; i++) {
    if (i > int(u_colorsCount)) break;

    float mLinear = clamp(mixer - float(i - 1), 0.0, 1.0);
    float aa = fwidth(mLinear);
    float w = min(mix(0.1, 0.5, u_softness), 0.5);
    float easeT = clamp((mLinear - (0.5 - w - aa)) / (2.0 * w + 2.0 * aa), 0.0, 1.0);
    float p = mix(2.0, 1.0, clamp((mix(0.1, 0.5, u_softness) - 0.5) * 2.0, 0.0, 1.0));
    float m = easeT < 0.5
      ? 0.5 * pow(2.0 * easeT, p)
      : 1.0 - 0.5 * pow(2.0 * (1.0 - easeT), p);

    float quadBlend = clamp((mix(0.1, 0.5, u_softness) - 0.5) * 2.0, 0.0, 1.0);
    m = mix(m, m * m, 0.5 * quadBlend);

    if (i == 1) {
      outerShape = m;
    }

    vec4 c = u_colors[i - 1];
    c.rgb *= c.a;
    gradient = mix(gradient, c, m);
  }

  // --- Final color ---
  vec3 color = gradient.rgb * outerShape;
  float opacity = gradient.a * outerShape;

  // --- 3D Highlight from shaped height profile ---
  // Split-scale normal computation: body and rim use independent kernels
  // optimized for their spatial frequency. Body dome is smooth (coarse scale
  // with high mipmap LOD eliminates 8-bit quantization). Rim is sharp
  // (fine scale at LOD 0 preserves thin edge detail).
  if (u_highlightIntensity > 0.0 || u_debugNormals > 0.5) {
    float rimW = mix(0.1, 0.5, u_highlightRimWidth);
    float rimStr = mix(0.5, 3.0, u_highlightRimStrength);
    float bodyExp = mix(0.3, 1.5, u_highlightBodyCurve);

    vec2 texel = 1.0 / vec2(textureSize(u_image, 0));

    // --- Body dome: coarse scale for smooth interior normals ---
    // Uses scaleRatio (G channel) masked by Poisson (R channel).
    // LOD 2.5 + radius 16 = each sample pre-averages ~36 source texels
    // over a 32-texel span, eliminating 8-bit quantization artifacts.
    // The R channel mask prevents the boundary discontinuity (G=0 outside
    // shape would read as max dome height without it).
    vec2 offC = texel * 16.0;
    vec4 sL = textureLod(u_image, imgUV + vec2(-offC.x, 0.0), 2.5);
    vec4 sR = textureLod(u_image, imgUV + vec2( offC.x, 0.0), 2.5);
    vec4 sU = textureLod(u_image, imgUV + vec2(0.0, -offC.y), 2.5);
    vec4 sD = textureLod(u_image, imgUV + vec2(0.0,  offC.y), 2.5);
    float bL = bodyDome(sL.g, sL.r, bodyExp);
    float bR = bodyDome(sR.g, sR.r, bodyExp);
    float bU = bodyDome(sU.g, sU.r, bodyExp);
    float bD = bodyDome(sD.g, sD.r, bodyExp);

    float bodyGradX = (bR - bL) / 32.0;
    float bodyGradY = (bD - bU) / 32.0;

    // --- Rim edge: fine scale for sharp edge normals ---
    // Uses Poisson distance (R channel). LOD 0 at small radius preserves
    // the thin rim ridge (5-10 texels wide). Poisson has strong gradients
    // near edges so quantization noise is negligible here.
    float rimRadius = mix(2.0, 5.0, u_highlightSharpness);
    vec2 offR = texel * rimRadius;
    float rL = rimEdge(textureLod(u_image, imgUV + vec2(-offR.x, 0.0), 0.0).r, rimW, rimStr);
    float rR = rimEdge(textureLod(u_image, imgUV + vec2( offR.x, 0.0), 0.0).r, rimW, rimStr);
    float rU = rimEdge(textureLod(u_image, imgUV + vec2(0.0, -offR.y), 0.0).r, rimW, rimStr);
    float rD = rimEdge(textureLod(u_image, imgUV + vec2(0.0,  offR.y), 0.0).r, rimW, rimStr);

    float rimGradX = (rR - rL) / (2.0 * rimRadius);
    float rimGradY = (rD - rU) / (2.0 * rimRadius);

    // Combine body and rim gradients, convert to visual normal tilt
    float heightScale = mix(30.0, 120.0, u_highlightSharpness);
    float dhdx = (bodyGradX + rimGradX) * heightScale;
    float dhdy = (bodyGradY + rimGradY) * heightScale;

    vec3 normal = normalize(vec3(-dhdx, -dhdy, 0.25));

    // Debug: visualize normal map
    if (u_debugNormals > 0.5) {
      vec3 normalVis = normal * 0.5 + 0.5;
      fragColor = vec4(normalVis * isShape, isShape);
      return;
    }

    // Light direction from angle (0-1 maps to 0-2pi), optionally animated
    float hlAngle = u_highlightAngle * TWO_PI + u_time * u_highlightAngleSpeed;
    vec3 lightDir = normalize(vec3(cos(hlAngle), sin(hlAngle), 0.7));

    // Specular highlight (Blinn-Phong style)
    float NdotL = max(dot(normal, lightDir), 0.0);
    float specular = pow(NdotL, 4.0);
    float highlight = specular * u_highlightIntensity;

    // Brighten toward white at highlight spots
    color = mix(color, vec3(opacity), highlight * isShape);
  }

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

      // --- Compute outer boundary distance per angle for petal-shaped wave coordinate ---
      const NUM_ANGLES = 360;
      const cx = poissonWidth / 2;
      const cy = poissonHeight / 2;
      const rOuterRaw = new Float32Array(NUM_ANGLES);

      for (let y = 0; y < poissonHeight; y++) {
        for (let x = 0; x < poissonWidth; x++) {
          if (!shapeMask[y * poissonWidth + x]) continue;
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
          const bin = Math.floor(angleDeg) % NUM_ANGLES;
          if (dist > rOuterRaw[bin]!) rOuterRaw[bin] = dist;
        }
      }

      // Smooth the outer boundary to fill gaps and reduce noise
      const rOuterSmooth = new Float32Array(NUM_ANGLES);
      const SMOOTH_HALF = 3;
      for (let i = 0; i < NUM_ANGLES; i++) {
        let sum = 0, count = 0;
        for (let j = -SMOOTH_HALF; j <= SMOOTH_HALF; j++) {
          const idx = ((i + j) % NUM_ANGLES + NUM_ANGLES) % NUM_ANGLES;
          if (rOuterRaw[idx]! > 0) { sum += rOuterRaw[idx]!; count++; }
        }
        rOuterSmooth[i] = count > 0 ? sum / count : 1;
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
            // Dither: ±0.5 LSB random noise before quantizing to 8-bit.
            // Breaks up flat quantization bands so the Sobel kernel in the shader
            // sees smooth gradients instead of staircase plateaus.
            tempImg.data[px] = Math.round(255 * poissonRatio + (Math.random() - 0.5)); // R: Poisson distance

            // G: scale ratio (0=center, 1=outer boundary) — petal-shaped contours
            const dx = x - cx;
            const dy = y - cy;
            const pixDist = Math.sqrt(dx * dx + dy * dy);
            const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
            const binLow = Math.floor(angleDeg) % NUM_ANGLES;
            const binHigh = (binLow + 1) % NUM_ANGLES;
            const frac = angleDeg - Math.floor(angleDeg);
            const rMax = rOuterSmooth[binLow]! * (1 - frac) + rOuterSmooth[binHigh]! * frac;
            const scaleRatio = rMax > 0 ? Math.min(pixDist / rMax, 1.0) : 0;
            tempImg.data[px + 1] = Math.round(255 * scaleRatio + (Math.random() - 0.5));

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

      // --- Step 4: Combine channels ---
      const finalImageData = ctx.createImageData(width, height);
      const dst = finalImageData.data;

      for (let i = 0; i < totalPixels; i++) {
        const px = i * 4;
        dst[px] = outputData.data[px] ?? 0;             // R: Poisson distance
        dst[px + 1] = outputData.data[px + 1] ?? 0;     // G: scale ratio (petal-shaped wave coordinate)
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
  u_contour: number;
  u_noise: number;
  u_softness: number;
  u_innerGlow: number;
  u_outerGlow: number;
  u_petalEmphasis: number;
  u_waveCurvature: number;
  u_waveClarity: number;
  u_highlightIntensity: number;
  u_highlightAngle: number;
  u_highlightAngleSpeed: number;
  u_highlightSharpness: number;
  u_highlightRimWidth: number;
  u_highlightRimStrength: number;
  u_highlightBodyCurve: number;
  u_debugNormals: number;
}

export interface BloomParams extends ShaderSizingParams, ShaderMotionParams {
  image: HTMLImageElement | string;
  colorBack?: string;
  colors?: string[];
  bloomSpread?: number;
  contour?: number;
  noise?: number;
  softness?: number;
  innerGlow?: number;
  outerGlow?: number;
  petalEmphasis?: number;
  waveCurvature?: number;
  waveClarity?: number;
  highlightIntensity?: number;
  highlightAngle?: number;
  highlightAngleAnim?: boolean;
  highlightAngleSpeed?: number;
  highlightSharpness?: number;
  highlightRimWidth?: number;
  highlightRimStrength?: number;
  highlightBodyCurve?: number;
  debugNormals?: boolean;
}
