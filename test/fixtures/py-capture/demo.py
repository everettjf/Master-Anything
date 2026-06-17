"""Example entrypoint exercising shipping.py with realistic orders."""
from shipping import total_price, Cart

orders = [
    {"items": [{"price": 10, "qty": 2}, {"price": 5, "qty": 1}], "discount": 0.1},
    {"items": [{"price": 3, "qty": 4}], "discount": 0.0},
]
cart = Cart()
for o in orders:
    print(total_price(o), cart.line_count(o))
