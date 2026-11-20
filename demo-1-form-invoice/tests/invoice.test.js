// Run: node --test demo-1-form-invoice/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const inv = require('../src/Invoice.js');

const form = (o) => ({
  'Full name': [o.name ?? 'Ann Lee'],
  Email: [o.email ?? 'ann@example.com'],
  Product: [o.product ?? 'Widget'],
  Quantity: [o.quantity ?? '3'],
});
const prices = { Widget: 19.99, Gadget: '0.10' };

test('valid order produces correct totals in cents', () => {
  const i = inv.computeInvoice(inv.parseOrder(form({})), prices, 0.1);
  assert.equal(i.unitCents, 1999);
  assert.equal(i.subtotalCents, 5997);
  assert.equal(i.taxCents, 600);
  assert.equal(i.totalCents, 6597);
});

test('string prices and small amounts do not drift', () => {
  const i = inv.computeInvoice(inv.parseOrder(form({ product: 'Gadget', quantity: '3' })), prices, 0);
  assert.equal(i.totalCents, 30);
});

test('price comes from the price map, not the form', () => {
  const values = { ...form({}), Price: ['0.01'] };
  assert.equal(inv.computeInvoice(inv.parseOrder(values), prices, 0).unitCents, 1999);
});

test('rejects bad input', () => {
  assert.throws(() => inv.parseOrder(form({ email: 'not-an-email' })), /Invalid email/);
  assert.throws(() => inv.parseOrder(form({ quantity: '0' })), /Invalid quantity/);
  assert.throws(() => inv.parseOrder(form({ quantity: '2.5' })), /Invalid quantity/);
  assert.throws(() => inv.parseOrder(form({ name: '  ' })), /Missing name/);
  assert.throws(() => inv.computeInvoice(inv.parseOrder(form({ product: 'Nope' })), prices, 0), /Unknown product/);
  assert.throws(() => inv.computeInvoice(inv.parseOrder(form({ product: 'toString' })), prices, 0), /Unknown product/);
});

test('invoice number and replacements', () => {
  const d = new Date('2026-11-20T10:00:00Z');
  assert.equal(inv.formatInvoiceNumber(7, d), 'INV-2026-0007');
  const r = inv.buildReplacements(inv.computeInvoice(inv.parseOrder(form({})), prices, 0.1), 'INV-2026-0007', d, '$');
  assert.equal(r['{{total}}'], '$65.97');
  assert.equal(r['{{date}}'], '2026-11-20');
});
