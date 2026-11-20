/**
 * Pure invoice logic — no Apps Script services here, so it runs in Node tests too.
 * Apps Script loads every file into one global scope, so these are plain functions.
 */

/** Form field titles. Change these if the client's Google Form uses other wording. */
var FORM_FIELDS = {
  name: 'Full name',
  email: 'Email',
  product: 'Product',
  quantity: 'Quantity',
};

/** Reads one form response (e.namedValues) into a validated order. Throws on bad input. */
function parseOrder(namedValues) {
  function field(title) {
    var v = namedValues[title];
    var s = Array.isArray(v) ? v[0] : v;
    return s == null ? '' : String(s).trim();
  }
  var order = {
    name: field(FORM_FIELDS.name),
    email: field(FORM_FIELDS.email),
    product: field(FORM_FIELDS.product),
    quantity: Number(field(FORM_FIELDS.quantity)),
  };
  if (!order.name) throw new Error('Missing name');
  // Form input is untrusted: a loose check stops obvious junk before we email it.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email)) throw new Error('Invalid email: ' + order.email);
  if (!order.product) throw new Error('Missing product');
  if (!Number.isInteger(order.quantity) || order.quantity < 1 || order.quantity > 10000) {
    throw new Error('Invalid quantity: ' + field(FORM_FIELDS.quantity));
  }
  return order;
}

/**
 * Builds the invoice. Prices come only from the Products sheet (priceMap),
 * never from the form, so a customer cannot set their own price.
 */
function computeInvoice(order, priceMap, taxRate) {
  if (!Object.prototype.hasOwnProperty.call(priceMap, order.product)) {
    throw new Error('Unknown product: ' + order.product);
  }
  var unitCents = toCents(priceMap[order.product]);
  var subtotalCents = unitCents * order.quantity;
  var taxCents = Math.round(subtotalCents * (taxRate || 0));
  return {
    name: order.name,
    email: order.email,
    product: order.product,
    quantity: order.quantity,
    unitCents: unitCents,
    subtotalCents: subtotalCents,
    taxCents: taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

/** Converts a sheet price like 19.99 or "19.99" to integer cents (avoids float drift). */
function toCents(price) {
  var n = Number(price);
  if (!isFinite(n) || n < 0) throw new Error('Invalid price: ' + price);
  return Math.round(n * 100);
}

function formatMoney(cents, currency) {
  return (currency || '$') + (cents / 100).toFixed(2);
}

/** INV-2026-0007 style numbers; sequence is a per-year counter kept by the caller. */
function formatInvoiceNumber(sequence, date) {
  return 'INV-' + date.getFullYear() + '-' + String(sequence).padStart(4, '0');
}

/** Placeholder → text map for the Google Doc template ({{name}}, {{total}}, ...). */
function buildReplacements(invoice, invoiceNumber, date, currency) {
  return {
    '{{invoice_number}}': invoiceNumber,
    '{{date}}': date.toISOString().slice(0, 10),
    '{{name}}': invoice.name,
    '{{email}}': invoice.email,
    '{{product}}': invoice.product,
    '{{quantity}}': String(invoice.quantity),
    '{{unit_price}}': formatMoney(invoice.unitCents, currency),
    '{{subtotal}}': formatMoney(invoice.subtotalCents, currency),
    '{{tax}}': formatMoney(invoice.taxCents, currency),
    '{{total}}': formatMoney(invoice.totalCents, currency),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { parseOrder, computeInvoice, toCents, formatMoney, formatInvoiceNumber, buildReplacements, FORM_FIELDS };
}
