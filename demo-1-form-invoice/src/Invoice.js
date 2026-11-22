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
function parseOrder_(namedValues) {
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
function computeInvoice_(order, priceMap, taxRate) {
  if (!Object.prototype.hasOwnProperty.call(priceMap, order.product)) {
    throw new Error('Unknown product: ' + order.product);
  }
  var unitCents = toCents_(priceMap[order.product]);
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
function toCents_(price) {
  var n = Number(price);
  if (!isFinite(n) || n < 0) throw new Error('Invalid price: ' + price);
  return Math.round(n * 100);
}

function formatMoney_(cents, currency) {
  return (currency || '$') + (cents / 100).toFixed(2);
}

/**
 * INV-2026-0007 style numbers; sequence is a per-year counter kept by the caller.
 * The caller passes the year in the spreadsheet's timezone, not the server's.
 */
function formatInvoiceNumber_(sequence, year) {
  return 'INV-' + year + '-' + String(sequence).padStart(4, '0');
}

/** Placeholder → text map for the Google Doc template ({{name}}, {{total}}, ...). dateText is already formatted. */
function buildReplacements_(invoice, invoiceNumber, dateText, currency, sellerName) {
  return {
    '{{seller_name}}': sellerName || '',
    '{{invoice_number}}': invoiceNumber,
    '{{date}}': dateText,
    '{{name}}': invoice.name,
    '{{email}}': invoice.email,
    '{{product}}': invoice.product,
    '{{quantity}}': String(invoice.quantity),
    '{{unit_price}}': formatMoney_(invoice.unitCents, currency),
    '{{subtotal}}': formatMoney_(invoice.subtotalCents, currency),
    '{{tax}}': formatMoney_(invoice.taxCents, currency),
    '{{total}}': formatMoney_(invoice.totalCents, currency),
  };
}

/** Starter Doc that setup creates. It uses every placeholder from buildReplacements_. */
var INVOICE_TEMPLATE = {
  title: 'Invoice {{invoice_number}}',
  lines: ['{{seller_name}}', 'Date: {{date}}', 'Bill to: {{name}} ({{email}})'],
  table: [
    ['Product', 'Quantity', 'Unit price', 'Subtotal'],
    ['{{product}}', '{{quantity}}', '{{unit_price}}', '{{subtotal}}'],
  ],
  totals: ['Tax: {{tax}}', 'Total: {{total}}'],
};

/**
 * Merges the Settings tab (rows of [Setting, Value, Help], header first) over the defaults.
 * Each default's type decides how its cell is read: list, number, boolean or text.
 */
function parseSettings_(rows, defaults) {
  var settings = {};
  Object.keys(defaults).forEach(function (key) {
    settings[key] = Array.isArray(defaults[key]) ? defaults[key].slice() : defaults[key];
  });
  (rows || []).slice(1).forEach(function (row) {
    var key = cellText_(row[0]);
    if (!key || !Object.prototype.hasOwnProperty.call(defaults, key)) return;
    settings[key] = coerceSetting_(key, row[1], defaults[key]);
  });
  return settings;
}

function coerceSetting_(key, value, defaultValue) {
  var text = cellText_(value);
  if (Array.isArray(defaultValue)) {
    return text.split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  if (typeof defaultValue === 'number') {
    if (text === '') return defaultValue;
    var n = Number(text);
    if (!isFinite(n)) throw new Error('Settings tab: "' + key + '" must be a number (now "' + text + '").');
    return n;
  }
  if (typeof defaultValue === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (text === '') return defaultValue;
    if (/^(true|yes|1)$/i.test(text)) return true;
    if (/^(false|no|0)$/i.test(text)) return false;
    throw new Error('Settings tab: "' + key + '" must be TRUE or FALSE (now "' + text + '").');
  }
  return text;
}

function cellText_(value) {
  return value == null ? '' : String(value).trim();
}

/** Rows to append to the Settings tab: only keys it does not have yet, so buyer values stay. */
function missingSettingsRows_(rows, defaults, help) {
  var present = {};
  (rows || []).forEach(function (row) { present[cellText_(row[0])] = true; });
  return Object.keys(defaults).filter(function (key) { return !present[key]; }).map(function (key) {
    var value = defaults[key];
    return [key, Array.isArray(value) ? value.join(', ') : value, (help && help[key]) || ''];
  });
}

/** Throws a message naming the Settings row to fix before any invoice is made. */
function checkSettings_(settings) {
  ['Seller name', 'Template Doc ID', 'Output folder ID'].forEach(function (key) {
    if (!settings[key]) {
      throw new Error('Settings tab: "' + key + '" is empty. Fill it in, or run Invoices > Setup / re-run setup.');
    }
  });
  var tax = settings['Tax rate'];
  if (typeof tax !== 'number' || tax < 0 || tax > 1) {
    throw new Error('Settings tab: "Tax rate" must be between 0 and 1 (0.1 means 10%).');
  }
  return settings;
}

/**
 * The tab the form writes to. Found by its form link because Google names it in the
 * account's language ("Form Responses 1", "Câu trả lời biểu mẫu 1", ...).
 * Takes Sheet objects (or anything with getName/getFormUrl). Returns null if none is linked.
 */
function findResponsesSheet_(sheets, name) {
  if (name) {
    var named = sheets.filter(function (sh) { return sh.getName() === name; })[0];
    if (!named) {
      throw new Error('Settings tab: "Responses sheet" says "' + name + '" but no tab has that name. Fix it or clear the cell.');
    }
    return named;
  }
  return sheets.filter(function (sh) { return sh.getFormUrl(); })[0] || null;
}

if (typeof module !== 'undefined') {
  module.exports = {
    parseOrder_, computeInvoice_, toCents_, formatMoney_, formatInvoiceNumber_, buildReplacements_,
    parseSettings_, missingSettingsRows_, checkSettings_, findResponsesSheet_, FORM_FIELDS, INVOICE_TEMPLATE,
  };
}
