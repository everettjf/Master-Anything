import assert from "node:assert";
import test from "node:test";
import { Calculator, average } from "./calc.ts";

test("add", () => assert.equal(new Calculator().add(2, 3), 5));
test("sub", () => assert.equal(new Calculator().sub(5, 2), 3));
test("addMany", () => assert.equal(new Calculator().addMany([1, 2, 3, 4]), 10));
test("average", () => {
  assert.equal(average([2, 4, 6]), 4);
  assert.equal(average([]), 0);
});
