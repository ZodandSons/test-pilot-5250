export const CUSTOMERS = {
  10001: { name: 'ACME Manufacturing', city: 'Chicago', limit: 50000, bal: 12500.75, stat: 'A' },
  10002: { name: 'Globex Corporation', city: 'Springfield', limit: 20000, bal: 21500.0, stat: 'A' },
  10003: { name: 'Initech LLC', city: 'Austin', limit: 10000, bal: 9800.0, stat: 'H' },
  10004: { name: 'Northwind Traders', city: 'Seattle', limit: 15000, bal: 0, stat: 'A' },
};

const STAT = ['OPEN', 'SHIPPED', 'INVOICED', 'OPEN', 'SHIPPED'];
function makeOrders() {
  const orders = [];
  for (let i = 0; i < 15; i++) {
    orders.push({
      ordno: 5000101 + i, cust: 10001,
      date: `2026-${String(1 + (i % 10)).padStart(2, '0')}-${String(3 + i).padStart(2, '0')}`,
      amt: Math.round((1250.5 + i * 377.25) * 100) / 100, stat: STAT[i % STAT.length],
    });
  }
  orders.push({ ordno: 5000201, cust: 10002, date: '2026-09-14', amt: 4200.0, stat: 'SHIPPED' });
  orders.push({ ordno: 5000202, cust: 10002, date: '2026-10-02', amt: 980.4, stat: 'OPEN' });
  orders.push({ ordno: 5000203, cust: 10002, date: '2026-10-21', amt: 15000.0, stat: 'INVOICED' });
  orders.push({ ordno: 5000301, cust: 10003, date: '2026-08-30', amt: 760.0, stat: 'OPEN' });
  return orders;
}

/** Fresh, session-scoped copy so tests are repeatable. */
export function freshData() {
  return { customers: structuredClone(CUSTOMERS), orders: makeOrders() };
}

export function editAmount(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
