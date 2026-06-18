// A top-level exported function whose argument is a nested object — the synthetic
// battery can't construct it, and (unlike a class method) it's a read-only ESM
// export, so it can only be captured via the loader+shim. A class method is
// included to confirm both paths work under TypeScript.
interface Item {
  price: number;
  qty: number;
}
interface Order {
  items: Item[];
  discount: number;
}

export function totalPrice(order: Order): number {
  let subtotal = 0;
  for (const item of order.items) subtotal += item.price * item.qty;
  return Math.round(subtotal * (1 - order.discount) * 100) / 100;
}

export class Cart {
  lineCount(order: Order): number {
    return order.items.length;
  }
}
