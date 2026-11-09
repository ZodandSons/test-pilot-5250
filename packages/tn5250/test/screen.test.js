import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Screen, StreamBuilder, parseInbound, strToEbcdic, ebcdicToStr, AID, CMD } from '../src/index.js';

test('EBCDIC round trip', () => {
  const s = 'Order Inquiry 10001 ACME, Inc. (A-Z) $#@!';
  assert.equal(ebcdicToStr(strToEbcdic(s)), s);
});

test('WTD builds text, fields, cursor and pending read', () => {
  const data = new StreamBuilder().clearUnit().wtd()
    .sba(1, 30).text('Order Inquiry')
    .sba(5, 4).text('Customer number . . . . .')
    .inputField(5, 31, { length: 5, ffw1: 0x43, ffw2: 0x25 })
    .ic(5, 31).readMdt().build();
  const scr = new Screen();
  const cmds = scr.apply(data);
  assert.ok(cmds.includes(CMD.WRITE_TO_DISPLAY));
  assert.equal(scr.pendingRead.cmd, CMD.READ_MDT_FIELDS);
  assert.match(scr.textRows()[0], /^ {29}Order Inquiry/);
  const j = scr.toJSON();
  assert.equal(j.fields.length, 1);
  assert.deepEqual([j.fields[0].row, j.fields[0].col, j.fields[0].length, j.fields[0].numeric], [5, 31, 5, true]);
  assert.equal(j.fields[0].label, 'Customer number');
  assert.deepEqual(j.cursor, { row: 5, col: 31 });
});

test('Read MDT response contains only modified fields, right-adjusted', () => {
  const scr = new Screen();
  scr.apply(new StreamBuilder().clearUnit().wtd()
    .inputField(5, 31, { length: 5, ffw1: 0x43, ffw2: 0x25 })
    .inputField(6, 31, { length: 10 })
    .readMdt().build());
  scr.setFieldValue(scr.fields[0], '42');
  const inb = parseInbound(scr.buildReadResponse(AID.Enter));
  assert.equal(inb.aid, AID.Enter);
  assert.deepEqual(inb.fields, [{ row: 5, col: 31, value: '00042' }]);
});

test('non-display fields are blanked in text and JSON', () => {
  const scr = new Screen();
  scr.apply(new StreamBuilder().clearUnit().wtd().inputField(7, 54, { length: 10, attr: 0x27, value: 'SECRET' }).readMdt().build());
  assert.ok(!scr.text().includes('SECRET'));
  assert.equal(scr.toJSON().fields[0].hidden, true);
  assert.equal(scr.toJSON().fields[0].value, '');
});

test('Write Error Code shows message on the last row', () => {
  const scr = new Screen();
  scr.apply(new StreamBuilder().clearUnit().wtd().errorCode('CPF1107 - Password not correct').readMdt().build());
  assert.equal(scr.errorLine, 'CPF1107 - Password not correct');
  assert.match(scr.textRows()[23], /^CPF1107/);
});

test('protected fields reject input; monocase uppercases', () => {
  const scr = new Screen();
  scr.apply(new StreamBuilder().clearUnit().wtd().inputField(3, 10, { length: 4, ffw1: 0x60 }).inputField(4, 10, { length: 6, ffw2: 0x20 }).readMdt().build());
  assert.throws(() => scr.setFieldValue(scr.fields[0], 'x'), /protected/);
  scr.setFieldValue(scr.fields[1], 'abc');
  assert.equal(scr.fieldValue(scr.fields[1]).trim(), 'ABC');
  assert.throws(() => scr.setFieldValue(scr.fields[1], 'toolong'), /exceeds/);
});
