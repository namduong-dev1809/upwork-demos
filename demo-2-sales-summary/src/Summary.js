/** Pure sales-summary logic. Apps Script loads these functions into one global scope. */

/** Accepts only yyyy-MM-dd strings; Main.js formats Date cells in the spreadsheet's timezone first. */
function salesDay_(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  var parsed = new Date(date + 'T00:00:00Z');
  return isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

/** Converts a sheet price to integer cents, matching demo 1's rounding convention. */
function toCents_(price) {
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
function buildSummary_(rows, today) {
  var day = salesDay_(today);
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
    var rowDay = salesDay_(row[0]);
    var orderId = row[1] == null ? '' : String(row[1]).trim();
    var product = row[3] == null ? '' : String(row[3]).trim();
    var quantity;
    var lineCents;
    try {
      quantity = numericCell_(row[4]);
      lineCents = quantity * toCents_(row[5]);
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

// Gmail strips <style> blocks, so every table cell carries inline styles.
var CELL_ = 'border:1px solid #ddd;padding:6px 10px';
var TH_ = CELL_ + ';background:#f3f4f6;text-align:left';
var NUM_ = CELL_ + ';text-align:right';

function table_(caption) {
  return '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;margin:0 0 16px">' +
    '<caption style="text-align:left;font-weight:bold;padding:6px 0">' + escapeHtml_(caption) + '</caption>';
}

/** Returns both email bodies, or null when the caller disables empty-day emails. lang: 'en' (default) or 'vi'. */
function renderSummary_(summary, sendWhenEmpty, currency, lang) {
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
  var html = '<h2 style="font-family:Arial,sans-serif">' + escapeHtml_(title) + '</h2>' +
    table_(L.daily) + '<tbody>' +
    metrics.map(function (r) {
      return '<tr><th scope="row" style="' + TH_ + '">' + escapeHtml_(r[0]) + '</th><td style="' + NUM_ + '">' +
        escapeHtml_(r[1]) + '</td></tr>';
    }).join('') + '</tbody></table>';
  if (summary.topProducts.length) {
    body += '\n\n' + L.top + ':\n' + summary.topProducts.map(function (p) {
      return p.product + ': ' + money(p.revenueCents);
    }).join('\n');
    html += table_(L.top) + '<thead><tr><th scope="col" style="' + TH_ + '">' +
      escapeHtml_(L.product) + '</th><th scope="col" style="' + TH_ + ';text-align:right">' +
      escapeHtml_(L.revenue) + '</th></tr></thead><tbody>' +
      summary.topProducts.map(function (p) {
        return '<tr><td style="' + CELL_ + '">' + escapeHtml_(p.product) + '</td><td style="' + NUM_ + '">' +
          escapeHtml_(money(p.revenueCents)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  return { subject: title, body: body, htmlBody: html };
}

/**
 * Merges Settings tab rows ([key, value, help]) over defaults. The header row and unknown keys are
 * ignored because only default keys are read. Blank values keep the default. The default's type
 * decides coercion: array = list split on commas/newlines, number, boolean, otherwise trimmed string.
 */
function parseSettings_(rows, defaults) {
  var out = {};
  Object.keys(defaults).forEach(function (key) { out[key] = defaults[key]; });
  (rows || []).forEach(function (row) {
    var key = row[0] == null ? '' : String(row[0]).trim();
    if (!key || !Object.prototype.hasOwnProperty.call(defaults, key)) return;
    var value = typeof row[1] === 'string' ? row[1].trim() : row[1];
    if (value === '' || value == null) return;
    var fallback = defaults[key];
    var where = 'Settings tab, row "' + key + '": ';
    if (Array.isArray(fallback)) {
      out[key] = String(value).split(/[,\n]/).map(function (item) { return item.trim(); }).filter(Boolean);
    } else if (typeof fallback === 'number') {
      var n = Number(value);
      if (typeof value === 'boolean' || !isFinite(n)) throw new Error(where + '"' + value + '" is not a number.');
      out[key] = n;
    } else if (typeof fallback === 'boolean') {
      var text = String(value).toUpperCase();
      if (text !== 'TRUE' && text !== 'FALSE') throw new Error(where + 'enter TRUE or FALSE.');
      out[key] = text === 'TRUE';
    } else {
      out[key] = String(value).trim();
    }
  });
  return out;
}

/** Rows to append so every default key exists once; keys the buyer already has are never rewritten. */
function missingSettingsRows_(rows, defaults, help) {
  var have = {};
  (rows || []).forEach(function (row) { have[String(row[0] == null ? '' : row[0]).trim()] = true; });
  return Object.keys(defaults).filter(function (key) { return !have[key]; }).map(function (key) {
    var value = defaults[key];
    return [key, Array.isArray(value) ? value.join(', ') : value, help[key] || ''];
  });
}

/** Validates a recipient list and returns MailApp's comma-separated form. */
function recipients_(list) {
  if (!list || !list.length) {
    throw new Error('Fill the "Recipients" row in the Settings tab with at least one email address.');
  }
  var bad = list.filter(function (email) { return !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email); });
  if (bad.length) {
    throw new Error('Settings tab, row "Recipients": "' + bad[0] + '" is not a valid email address. ' +
      'Separate addresses with commas.');
  }
  return list.join(',');
}

function sendHour_(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('Settings tab, row "Send hour (0-23)": enter a whole number from 0 to 23.');
  }
  return hour;
}

if (typeof module !== 'undefined') {
  module.exports = {
    salesDay_, toCents_, buildSummary_, renderSummary_, parseSettings_, missingSettingsRows_, recipients_, sendHour_,
  };
}
