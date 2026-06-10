// Functions with NO accompanying test — proves characterization makes the
// verifiable-Apply loop work for TypeScript without a hand-written test.

export function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

export function runningSum(nums: number[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (const n of nums) {
    total += n;
    out.push(total);
  }
  return out;
}

export class Stats {
  total(nums: number[]): number {
    let s = 0;
    for (const n of nums) s += n;
    return s;
  }
}
