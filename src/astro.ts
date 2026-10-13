import { Vector3 } from 'three';

/** 朔望月：從新月到下一次新月的平均天數 */
export const SYNODIC_MONTH = 29.530588;

export type Phase = {
  name: string;
  english: string;
  note: string;
};

export const PHASES: readonly Phase[] = [
  {
    name: '新月',
    english: 'New Moon',
    note: '月亮跑到地球和太陽中間，被照亮的那一面背對我們，所以幾乎看不到。它和太陽一起升起、一起落下。',
  },
  {
    name: '眉月',
    english: 'Waxing Crescent',
    note: '傍晚的西邊天空可以看到細細彎彎的月亮，亮的那邊朝右（朝向剛下山的太陽）。',
  },
  {
    name: '上弦月',
    english: 'First Quarter',
    note: '右半邊亮。大約中午升起，傍晚時高掛在南方天空，上半夜就會落下。',
  },
  {
    name: '盈凸月',
    english: 'Waxing Gibbous',
    note: '亮的部分超過一半，而且一天比一天胖，快要滿月了。',
  },
  {
    name: '滿月',
    english: 'Full Moon',
    note: '地球在太陽和月亮中間，我們看到整個被照亮的那一面。太陽下山時月亮剛好升起，整夜都看得到。',
  },
  {
    name: '虧凸月',
    english: 'Waning Gibbous',
    note: '亮的部分開始一天天變小，變成左邊比較亮。',
  },
  {
    name: '下弦月',
    english: 'Last Quarter',
    note: '左半邊亮。大約半夜才升起，清晨時高掛天空，白天也常看得到。',
  },
  {
    name: '殘月',
    english: 'Waning Crescent',
    note: '只有天快亮時，在東邊天空看得到細細的月亮，亮的那邊朝左（朝向還沒升起的太陽）。',
  },
];

export type PhaseInfo = {
  /** 0–7，對應 PHASES */
  index: number;
  /** 月亮繞地球轉過的角度（新月為 0），弧度 */
  angle: number;
  /** 從地球看到被照亮的比例，0–1 */
  illumination: number;
  /** 農曆第幾天，1–30 */
  lunarDay: number;
};

export function wrapDay(day: number): number {
  return ((day % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
}

export function phaseInfo(day: number): PhaseInfo {
  const d = wrapDay(day);
  const angle = (2 * Math.PI * d) / SYNODIC_MONTH;
  return {
    index: Math.round((d / SYNODIC_MONTH) * 8) % 8,
    angle,
    illumination: (1 - Math.cos(angle)) / 2,
    lunarDay: Math.min(30, Math.floor(d) + 1),
  };
}

const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function lunarDayLabel(n: number): string {
  if (n <= 10) return `初${DIGITS[n]}`;
  if (n < 20) return `十${DIGITS[n - 10]}`;
  if (n === 20) return '二十';
  if (n < 30) return `廿${DIGITS[n - 20]}`;
  return '三十';
}

function clock(hours: number): string {
  const minutes = Math.round((((hours % 24) + 24) % 24) * 6) * 10;
  const m = minutes % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 粗略估計：新月約 06:00 升起，之後每天晚大約 49 分鐘 */
export function moonTimes(day: number): { rise: string; transit: string; set: string } {
  const rise = 6 + (wrapDay(day) / SYNODIC_MONTH) * 24;
  return { rise: clock(rise), transit: clock(rise + 6), set: clock(rise + 12) };
}

export type EclipseKind = 'none' | 'partial' | 'annular' | 'total';

export type SunView = {
  /** 太陽圓面被遮住的面積比例，0–1 */
  coverage: number;
  kind: EclipseKind;
};

/** 兩個半徑 r1、r2，圓心距離 d 的圓重疊面積 */
export function circleOverlap(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos(Math.min(1, Math.max(-1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const b = r2 * r2 * Math.acos(Math.min(1, Math.max(-1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  const c = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return a + b - c;
}

/**
 * 站在 observer 看太陽時，月亮遮住多少。
 * 用視角半徑與兩圓心的角距離計算，和地球表面的著色器用的是同一套算法。
 */
export function sunView(
  observer: Vector3,
  sun: Vector3,
  sunRadius: number,
  moon: Vector3,
  moonRadius: number,
): SunView {
  const toSun = sun.clone().sub(observer);
  const toMoon = moon.clone().sub(observer);
  if (toMoon.length() > toSun.length() || toSun.dot(toMoon) <= 0) return { coverage: 0, kind: 'none' };

  const rs = Math.asin(Math.min(1, sunRadius / toSun.length()));
  const rm = Math.asin(Math.min(1, moonRadius / toMoon.length()));
  const sep = Math.atan2(toSun.clone().cross(toMoon).length(), toSun.dot(toMoon));
  if (sep >= rs + rm) return { coverage: 0, kind: 'none' };

  const coverage = Math.min(1, circleOverlap(rs, rm, sep) / (Math.PI * rs * rs));
  if (sep <= rm - rs) return { coverage: 1, kind: 'total' };
  if (sep <= rs - rm) return { coverage, kind: 'annular' };
  return { coverage, kind: 'partial' };
}
