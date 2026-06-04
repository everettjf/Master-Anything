// A tiny calculator in TypeScript, for the TS verifiable-mastery demo.

export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  sub(a: number, b: number): number {
    return a - b;
  }

  addMany(nums: number[]): number {
    let total = 0;
    for (const n of nums) {
      total = this.add(total, n);
    }
    return total;
  }
}

export function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return new Calculator().addMany(nums) / nums.length;
}
