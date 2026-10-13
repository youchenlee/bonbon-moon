/**
 * 北半球看到的月相小圖示。angle 為月亮公轉角度（0 = 新月，π = 滿月）。
 * 亮面由半圓邊緣加上一段橢圓（明暗分界線）組成，橢圓寬度是 |cos(angle)|。
 */
export function phaseIcon(angle: number): string {
  const r = 18;
  const c = Math.cos(angle);
  const rx = (Math.abs(c) * r).toFixed(2);
  const waxing = angle <= Math.PI;
  const limbSweep = waxing ? 1 : 0;
  const terminatorSweep = waxing === c > 0 ? 0 : 1;
  const d = `M 0 ${-r} A ${r} ${r} 0 0 ${limbSweep} 0 ${r} A ${rx} ${r} 0 0 ${terminatorSweep} 0 ${-r} Z`;
  return `<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="${r}" fill="#20263a"/><path d="${d}" fill="#f1e8d0"/></svg>`;
}
