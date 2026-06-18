// Driver for the captured-run I/O case study — exercises object-path using
// examples adapted from the library's own README.
//
// object-path reads/writes deep properties by path: get(obj, "a.b.c"). The
// interesting argument is always a (nested) object — which the synthetic fuzz
// battery never constructs. Worse, object-path tolerates primitive arguments
// (get(2, 2) just echoes the default), so the battery pins lots of *degenerate*
// behaviors that don't exercise path traversal at all. Running this driver
// captures the real, meaningful I/O.
//
// Source of the examples: the README of mariocasciaro/object-path.
const op = require("./index");

const obj = {
  a: {
    b: {
      c: 42,
      d: ["x", "y", "z"],
    },
  },
  users: [{ name: "Alice" }, { name: "Bob" }],
};

// get — by string path, by array path, and with a default for a missing key
op.get(obj, "a.b.c");
op.get(obj, ["a", "b", "d", 1]);
op.get(obj, "users.0.name");
op.get(obj, "a.b.missing", "fallback");
op.get(obj, "nope.not.here");

// has — present and absent paths
op.has(obj, "a.b.c");
op.has(obj, "users.1.name");
op.has(obj, "a.b.nope");

// coalesce — first existing of several paths
op.coalesce(obj, ["a.x", "a.y", "a.b.c"], "default");

// del — remove a deep key (mutates; captured input is the pre-call state)
op.del({ a: { b: { c: 1, d: 2 } } }, "a.b.c");

// set — write a deep key (mutates)
op.set({ a: { b: 1 } }, "a.c", 9);
