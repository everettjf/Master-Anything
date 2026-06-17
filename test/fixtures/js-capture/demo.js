// Example entrypoint exercising shipping.js with realistic orders.
const { totalPrice, Cart } = require("./shipping");

const orders = [
  {
    items: [
      { price: 10, qty: 2 },
      { price: 5, qty: 1 },
    ],
    discount: 0.1,
  },
  { items: [{ price: 3, qty: 4 }], discount: 0 },
];
const cart = new Cart();
for (const o of orders) console.log(totalPrice(o), cart.lineCount(o));
