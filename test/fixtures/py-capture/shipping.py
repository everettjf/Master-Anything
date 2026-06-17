"""A function whose argument is a nested dict — the synthetic fuzz battery
(primitives/lists) can't construct it, so characterization finds nothing.
Running the example driver captures real boundary I/O and makes it verifiable."""


def total_price(order):
    subtotal = 0
    for item in order["items"]:
        subtotal += item["price"] * item["qty"]
    return round(subtotal * (1 - order["discount"]), 2)


class Cart:
    def line_count(self, order):
        return len(order["items"])
