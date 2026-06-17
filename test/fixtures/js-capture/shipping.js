// A function whose argument is a nested object — the synthetic fuzz battery
// can't construct it, so characterization finds nothing. The example driver
// captures real boundary I/O and makes it verifiable.

function totalPrice(order) {
  let subtotal = 0;
  for (const item of order.items) subtotal += item.price * item.qty;
  return Math.round(subtotal * (1 - order.discount) * 100) / 100;
}

class Cart {
  lineCount(order) {
    return order.items.length;
  }
}

module.exports = { totalPrice, Cart };
