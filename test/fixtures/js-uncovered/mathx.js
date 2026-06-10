// Functions with NO accompanying test — proves characterization makes the
// verifiable-Apply loop work for JavaScript without a hand-written test.

function clamp(x, lo, hi) {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function runningSum(nums) {
  const out = [];
  let total = 0;
  for (const n of nums) {
    total += n;
    out.push(total);
  }
  return out;
}

class Stats {
  total(nums) {
    let s = 0;
    for (const n of nums) s += n;
    return s;
  }
}

module.exports = { clamp, runningSum, Stats };
