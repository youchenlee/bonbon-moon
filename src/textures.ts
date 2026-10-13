import * as THREE from 'three';

// 所有貼圖都用程式產生，網站不依賴外部圖檔。

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ x, 0x27d4eb2d);
  h = Math.imul(h ^ y, 0x165667b1);
  h = Math.imul(h ^ z, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const lerp = THREE.MathUtils.lerp;
  const x00 = lerp(hash3(xi, yi, zi, seed), hash3(xi + 1, yi, zi, seed), u);
  const x10 = lerp(hash3(xi, yi + 1, zi, seed), hash3(xi + 1, yi + 1, zi, seed), u);
  const x01 = lerp(hash3(xi, yi, zi + 1, seed), hash3(xi + 1, yi, zi + 1, seed), u);
  const x11 = lerp(hash3(xi, yi + 1, zi + 1, seed), hash3(xi + 1, yi + 1, zi + 1, seed), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

function fbm(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, z * frequency, seed + i * 101);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rgb = [number, number, number];

/**
 * 逐像素填滿等距長方投影（equirectangular）貼圖。
 * 像素位置換算成球面上的點，座標和 THREE.SphereGeometry 的 UV 一致，接縫不會有斷層。
 */
function paintSphere(width: number, height: number, shade: (x: number, y: number, z: number) => Rgb) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  for (let j = 0; j < height; j++) {
    const theta = ((j + 0.5) / height) * Math.PI;
    const sinTheta = Math.sin(theta);
    const y = Math.cos(theta);
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * Math.PI * 2;
      const [r, g, b] = shade(-Math.cos(lon) * sinTheta, y, Math.sin(lon) * sinTheta);
      const k = (j * width + i) * 4;
      image.data[k] = r;
      image.data[k + 1] = g;
      image.data[k + 2] = b;
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const smoothstep = THREE.MathUtils.smoothstep;

export function makeMoonTexture(): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const { canvas, ctx } = paintSphere(width, height, (x, y, z) => {
    const detail = fbm(x * 7, y * 7, z * 7, 11, 5);
    // 月海（較暗的平原）多半在面向地球的那一面，也就是貼圖中央（局部座標 +x）
    const mare = smoothstep(fbm(x * 1.7 + 5, y * 1.7, z * 1.7, 23, 4) + 0.1 * x, 0.5, 0.58);
    const tone = (0.66 + (detail - 0.5) * 0.4) * (1 - 0.45 * mare);
    return [tone * 236, tone * 232, tone * 224];
  });

  const random = mulberry32(7);
  for (let k = 0; k < 650; k++) {
    const radius = 1.5 + 34 * random() ** 4;
    const cx = random() * width;
    const theta = Math.acos(2 * random() - 1);
    const cy = (theta / Math.PI) * height;
    const stretch = 1 / Math.max(0.12, Math.sin(theta));
    for (const offset of [-width, 0, width]) {
      ctx.save();
      ctx.translate(cx + offset, cy);
      ctx.scale(stretch, 1);
      const gradient = ctx.createRadialGradient(-radius * 0.15, -radius * 0.15, 0, 0, 0, radius);
      gradient.addColorStop(0, 'rgba(30,28,25,0.22)');
      gradient.addColorStop(0.7, 'rgba(30,28,25,0.12)');
      gradient.addColorStop(0.86, 'rgba(255,252,240,0.12)');
      gradient.addColorStop(1, 'rgba(255,252,240,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  return toTexture(canvas);
}

export function makeEarthTexture(): THREE.CanvasTexture {
  const deepOcean: Rgb = [8, 34, 92];
  const shallowOcean: Rgb = [22, 82, 150];
  const forest: Rgb = [46, 98, 44];
  const desert: Rgb = [176, 150, 96];
  const ice: Rgb = [236, 241, 246];
  const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];

  const { canvas } = paintSphere(1024, 512, (x, y, z) => {
    const height = fbm(x * 1.8, y * 1.8, z * 1.8, 3, 6);
    const latitude = Math.abs(y);
    let color: Rgb;
    if (height < 0.53) {
      color = mix(deepOcean, shallowOcean, smoothstep(height, 0.42, 0.53));
    } else {
      const dryness = fbm(x * 3, y * 3, z * 3, 5, 4) + 0.25 * (1 - smoothstep(latitude, 0.15, 0.45));
      color = mix(forest, desert, smoothstep(dryness, 0.5, 0.68));
      color = mix(color, ice, smoothstep(latitude, 0.72, 0.82));
    }
    color = mix(color, ice, smoothstep(latitude, 0.9, 0.95));
    const cloud = smoothstep(fbm(x * 4 + 10, y * 4, z * 4, 9, 5), 0.54, 0.7);
    return mix(color, [250, 250, 252], cloud * 0.85);
  });
  return toTexture(canvas);
}

export function makeGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,248,220,1)');
  gradient.addColorStop(0.12, 'rgba(255,220,150,0.6)');
  gradient.addColorStop(0.35, 'rgba(255,180,90,0.15)');
  gradient.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas);
}

/** 日冕：sprite 邊長是太陽半徑的 6 倍，所以太陽邊緣在貼圖半徑 1/3 處 */
export function makeCoronaTexture(): THREE.CanvasTexture {
  const size = 512;
  const center = size / 2;
  const sunRadius = center / 3;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(center, center, sunRadius * 0.95, center, center, center);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.08, 'rgba(230,240,255,0.55)');
  gradient.addColorStop(0.3, 'rgba(200,220,255,0.15)');
  gradient.addColorStop(1, 'rgba(200,220,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const random = mulberry32(42);
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 160; k++) {
    const angle = random() * Math.PI * 2;
    const length = sunRadius * (0.4 + 1.6 * random() ** 2);
    const streak = ctx.createLinearGradient(
      center + Math.cos(angle) * sunRadius,
      center + Math.sin(angle) * sunRadius,
      center + Math.cos(angle) * (sunRadius + length),
      center + Math.sin(angle) * (sunRadius + length),
    );
    streak.addColorStop(0, `rgba(235,242,255,${0.06 + 0.12 * random()})`);
    streak.addColorStop(1, 'rgba(235,242,255,0)');
    ctx.strokeStyle = streak;
    ctx.lineWidth = 1 + 3 * random();
    ctx.beginPath();
    ctx.moveTo(center + Math.cos(angle) * sunRadius, center + Math.sin(angle) * sunRadius);
    ctx.lineTo(center + Math.cos(angle) * (sunRadius + length), center + Math.sin(angle) * (sunRadius + length));
    ctx.stroke();
  }
  return toTexture(canvas);
}
