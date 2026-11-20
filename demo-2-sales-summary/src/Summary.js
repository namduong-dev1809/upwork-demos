/** Pure sales-summary logic. Apps Script loads these functions into one global scope. */

/** Vietnam uses UTC+07:00 year-round. Date-only strings represent local sheet dates. */
function salesDay(date) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    var parsed = new Date(date + 'T00:00:00Z');
    return isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
  }
  if (!(date instanceof Date)) {
    if (typeof date !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(date)) return null;
    date = new Date(date);
  }
  var shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : null;
}

/** Converts a sheet price to integer cents, matching demo 1's rounding convention. */
function toCents(price) {
  var n = numericCell_(price);
  var cents = Math.round(n * 100);
  if (n < 0 || !Number.isSafeInteger(cents)) throw new Error('Invalid price: ' + price);
  return cents;
}

function numericCell_(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new Error('Missing numeric value');
  }
  var n = Number(value);
  if (!isFinite(n)) throw new Error('Invalid numeric value');
  return n;
}

/** Rows exclude headers. Total is derived from quantity and price, not the Total column. */
function buildSummary(rows, today) {
  var day = salesDay(today);
  if (!day) throw new Error('Invalid summary date');
  var lastWeek = new Date(day + 'T00:00:00Z');
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  var previousDay = lastWeek.toISOString().slice(0, 10);
  var revenueCents = 0;
  var previousRevenueCents = 0;
  var units = 0;
  var skippedRows = 0;
  var orders = new Set();
  var products = new Map();

  rows.forEach(function (row) {
    var rowDay = salesDay(row[0]);
    var orderId = row[1] == null ? '' : String(row[1]).trim();
    var product = row[3] == null ? '' : String(row[3]).trim();
    var quantity;
    var lineCents;
    try {
      quantity = numericCell_(row[4]);
      lineCents = quantity * toCents(row[5]);
      if (!rowDay || !orderId || !product || !Number.isSafeInteger(quantity) || quantity < 1 ||
          !Number.isSafeInteger(lineCents)) throw new Error('Invalid sales row');
    } catch (err) {
      skippedRows++;
      return;
    }
    if (rowDay === previousDay) previousRevenueCents = safeAdd_(previousRevenueCents, lineCents);
    if (rowDay !== day) return;
    revenueCents = safeAdd_(revenueCents, lineCents);
    units = safeAdd_(units, quantity);
    orders.add(orderId);
    products.set(product, safeAdd_(products.get(product) || 0, lineCents));
  });

  var topProducts = Array.from(products, function (entry) {
    return { product: entry[0], revenueCents: entry[1] };
  }).sort(function (a, b) {
    return b.revenueCents - a.revenueCents || (a.product < b.product ? -1 : a.product > b.product ? 1 : 0);
  }).slice(0, 3);
  var changeCents = revenueCents - previousRevenueCents;
  return {
    day: day, previousDay: previousDay, revenueCents: revenueCents,
    orders: orders.size, units: units, topProducts: topProducts, skippedRows: skippedRows,
    previousRevenueCents: previousRevenueCents, changeCents: changeCents,
    changePercent: previousRevenueCents === 0 ? null : changeCents / previousRevenueCents * 100,
  };
}

function safeAdd_(a, b) {
  var total = a + b;
  if (!Number.isSafeInteger(total)) throw new Error('Sales total exceeds safe integer precision');
  return total;
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function money_(cents, currency) {
  return currency + (cents / 100).toFixed(2);
}

/** Returns both email bodies, or null when the caller disables empty-day emails. */
function renderSummary(summary, sendWhenEmpty, currency) {
  if (!summary.orders && !sendWhenEmpty) return null;
  currency = currency || '$';
  var change = (summary.changeCents > 0 ? '+' : '') + money_(summary.changeCents, currency);
  var percent = summary.changePercent === null ? 'N/A: last week was zero' :
    (summary.changePercent > 0 ? '+' : '') + summary.changePercent.toFixed(2) + '%';
  var metrics = [
    ['Revenue', money_(summary.revenueCents, currency)],
    ['Orders', summary.orders],
    ['Units sold', summary.units],
    ['Revenue on ' + summary.previousDay, money_(summary.previousRevenueCents, currency)],
    ['Change vs same weekday last week', change + ' (' + percent + ')'],
    ['Skipped invalid rows (entire sheet)', summary.skippedRows],
  ];
  var title = summary.orders ? 'Sales summary: ' + summary.day : 'No sales today: ' + summary.day;
  var body = title + '\n\n' + metrics.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n');
  var html = '<h2>' + escapeHtml_(title) + '</h2><table><caption>Daily sales</caption><tbody>' +
    metrics.map(function (r) {
      return '<tr><th scope="row">' + escapeHtml_(r[0]) + '</th><td>' + escapeHtml_(r[1]) + '</td></tr>';
    }).join('') + '</tbody></table>';
  if (summary.topProducts.length) {
    body += '\n\nTop 3 products by revenue:\n' + summary.topProducts.map(function (p) {
      return p.product + ': ' + money_(p.revenueCents, currency);
    }).join('\n');
    html += '<table><caption>Top 3 products by revenue</caption><thead><tr><th scope="col">Product</th>' +
      '<th scope="col">Revenue</th></tr></thead><tbody>' + summary.topProducts.map(function (p) {
        return '<tr><td>' + escapeHtml_(p.product) + '</td><td>' +
          escapeHtml_(money_(p.revenueCents, currency)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  return { subject: title, body: body, htmlBody: html };
}

if (typeof module !== 'undefined') {
  module.exports = { salesDay, toCents, buildSummary, renderSummary };
}
