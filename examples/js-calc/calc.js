// A tiny calculator in JS, for the JavaScript verifiable-mastery demo.

class Calculator {
  add(a, b) {
    return a + b;
  }

  sub(a, b) {
    return a - b;
  }

  addMany(nums) {
    let total = 0;
    for (const n of nums) {
      total = this.add(total, n);
    }
    return total;
  }
}

function average(nums) {
  if (nums.length === 0) return 0;
  return new Calculator().addMany(nums) / nums.length;
}

module.exports = { Calculator, average };
