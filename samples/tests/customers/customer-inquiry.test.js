// JS test scripts get a `t` API; every call is recorded as a step with a screen snapshot.
export default {
  name: 'Customer inquiry shows credit status and available credit',
  suite: 'customers',
  tags: ['smoke', 'customers', 'js'],
  coverage: { programs: ['CUSTINQ'] },
  data: [
    { CUST: '10001', STATUS: 'ACTIVE', AVAIL: '37,499.25' },
    { CUST: '10002', STATUS: 'ACTIVE', AVAIL: '0.00' },
    { CUST: '10003', STATUS: 'CREDIT HOLD', AVAIL: '200.00' },
  ],
  async run(t) {
    await t.signon();
    await t.command('2');
    await t.assertText('Customer Inquiry', { row: 1 });
    await t.fill('Customer number', t.data.CUST);
    await t.press('Enter');
    await t.assertText(t.data.STATUS, { row: 10 });
    await t.step(`Available credit is ${t.data.AVAIL}`, () => {
      t.expect(t.read(9, 31, 14).trim()).toBe(t.data.AVAIL);
    });
    await t.press('Enter');
    await t.fill('Customer number', '99999');
    await t.press('Enter');
    await t.assertText('Customer 99999 not found.', { row: 23 });
    await t.press('F3');
    await t.assertText('Order Management System', { row: 1 });
  },
};
