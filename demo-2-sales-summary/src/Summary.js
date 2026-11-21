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

var LABELS_ = {
  en: {
    revenue: 'Revenue', orders: 'Orders', units: 'Units sold', revenueOn: 'Revenue on ',
    change: 'Change vs same weekday last week', skipped: 'Skipped invalid rows (entire sheet)',
    na: 'N/A: last week was zero', title: 'Sales summary: ', empty: 'No sales today: ',
    daily: 'Daily sales', top: 'Top 3 products by revenue', product: 'Product',
  },
  vi: {
    revenue: 'Doanh thu', orders: 'Số đơn', units: 'Số món bán ra', revenueOn: 'Doanh thu ngày ',
    change: 'So với cùng thứ tuần trước', skipped: 'Dòng lỗi bị bỏ qua (toàn sheet)',
    na: 'không so được: tuần trước bằng 0', title: 'Báo cáo bán hàng ngày ', empty: 'Hôm nay chưa có đơn: ',
    daily: 'Bán hàng trong ngày', top: 'Top 3 món theo doanh thu', product: 'Món',
  },
};

/** en: $1234.50. vi: 1.234.500 ₫ (VND has no minor unit, so whole dong). */
function money_(cents, currency, lang) {
  if (lang !== 'vi') return currency + (cents / 100).toFixed(2);
  var sign = cents < 0 ? '-' : '';
  var whole = String(Math.round(Math.abs(cents) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return sign + whole + ' ' + currency;
}

function day_(isoDay, lang) {
  return lang === 'vi' ? isoDay.split('-').reverse().join('/') : isoDay;
}

/** Returns both email bodies, or null when the caller disables empty-day emails. lang: 'en' (default) or 'vi'. */
function renderSummary(summary, sendWhenEmpty, currency, lang) {
  if (!summary.orders && !sendWhenEmpty) return null;
  lang = lang === 'vi' ? 'vi' : 'en';
  var L = LABELS_[lang];
  currency = currency || (lang === 'vi' ? '₫' : '$');
  var money = function (cents) { return money_(cents, currency, lang); };
  var change = (summary.changeCents > 0 ? '+' : '') + money(summary.changeCents);
  var percent = summary.changePercent === null ? L.na :
    (summary.changePercent > 0 ? '+' : '') + summary.changePercent.toFixed(2) + '%';
  if (lang === 'vi') percent = percent.replace('.', ',');
  var metrics = [
    [L.revenue, money(summary.revenueCents)],
    [L.orders, summary.orders],
    [L.units, summary.units],
    [L.revenueOn + day_(summary.previousDay, lang), money(summary.previousRevenueCents)],
    [L.change, change + ' (' + percent + ')'],
    [L.skipped, summary.skippedRows],
  ];
  var title = (summary.orders ? L.title : L.empty) + day_(summary.day, lang);
  var body = title + '\n\n' + metrics.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n');
  var html = '<h2>' + escapeHtml_(title) + '</h2><table><caption>' + escapeHtml_(L.daily) + '</caption><tbody>' +
    metrics.map(function (r) {
      return '<tr><th scope="row">' + escapeHtml_(r[0]) + '</th><td>' + escapeHtml_(r[1]) + '</td></tr>';
    }).join('') + '</tbody></table>';
  if (summary.topProducts.length) {
    body += '\n\n' + L.top + ':\n' + summary.topProducts.map(function (p) {
      return p.product + ': ' + money(p.revenueCents);
    }).join('\n');
    html += '<table><caption>' + escapeHtml_(L.top) + '</caption><thead><tr><th scope="col">' +
      escapeHtml_(L.product) + '</th><th scope="col">' + escapeHtml_(L.revenue) + '</th></tr></thead><tbody>' +
      summary.topProducts.map(function (p) {
        return '<tr><td>' + escapeHtml_(p.product) + '</td><td>' +
          escapeHtml_(money(p.revenueCents)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  return { subject: title, body: body, htmlBody: html };
}

if (typeof module !== 'undefined') {
  module.exports = { salesDay, toCents, buildSummary, renderSummary };
}
