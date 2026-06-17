"""Driver for the captured-run I/O case study — exercises toolz.dicttoolz using
examples taken straight from the library's own docstrings.

Master-Anything runs this with dicttoolz instrumented and records the real
arguments→return at each function boundary. None of these calls can be produced
by the synthetic fuzz battery: every interesting argument is a (nested) dict or
list, which the primitive/collection battery never constructs.

Source of the examples: the docstrings of toolz/dicttoolz.py (pytoolz/toolz).
"""
from dicttoolz import (
    assoc,
    assoc_in,
    dissoc,
    get_in,
    keyfilter,
    merge,
    update_in,
    valmap,
)

# --- assoc / dissoc (docstring examples) ------------------------------------
assoc({"x": 1}, "x", 2)
assoc({"x": 1}, "y", 3)
dissoc({"x": 1, "y": 2}, "y")
dissoc({"x": 1, "y": 2}, "y", "x")
dissoc({"x": 1}, "y")

# --- get_in / assoc_in (docstring examples) ---------------------------------
purchase = {
    "name": "Alice",
    "order": {"items": ["Apple", "Orange"], "costs": [0.50, 1.25]},
    "credit card": "5555-1234-1234-1234",
}
get_in(["order", "items"], purchase)
get_in(["name"], purchase)
get_in(["credit card"], purchase)
get_in(["order", "total"], purchase)  # missing key -> default None
assoc_in({"name": "Alice"}, ["order", "items"], ["Apple", "Orange"])

# --- merge (docstring example) ----------------------------------------------
merge({1: "one"}, {2: "two"})
merge({"a": 1}, {"a": 2, "b": 3})

# --- functions taking a callable: shown for contrast -------------------------
# These are exercised too, but their first argument is a function — not a
# literal — so captured-run honestly records nothing for them.
update_in({"a": 0}, ["a"], lambda x: x + 1)
valmap(lambda x: x + 1, {"a": 1, "b": 2})
keyfilter(lambda k: k == "a", {"a": 1, "b": 2})
