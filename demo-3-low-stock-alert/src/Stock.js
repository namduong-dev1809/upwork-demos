/** Pure inventory logic. Apps Script loads these functions into its global scope. */
var STOCK_HEADERS = ['SKU', 'Product', 'On Hand', 'Reorder Point', 'Reorder Qty', 'Supplier Email'];
// Gmail strips <style> blocks, so every email style must be inline.
var EMAIL_FONT = 'font-family:Arial,sans-serif;font-size:14px';

/** Only a valid recovery clears an alert; bad or absent rows retain their state. */
function evaluateStock_(rows, previousState, date) {
  if (!previousState || typeof previousState !== 'object' || Array.isArray(previousState) ||
      Object.keys(previousState).some(function (sku) { return typeof previousState[sku] !== 'string' || !previousState[sku]; })) {
    throw new Error('Invalid saved alert state');
  }
  var state = Object.assign(Object.create(null), previousState);
  var counts = Object.create(null);
  rows.forEach(function (row) {
    var sku = String(row[0] == null ? '' : row[0]).trim();
    if (sku) counts[sku] = (counts[sku] || 0) + 1;
  });
  var newlyLow = [];
  var statuses = rows.map(function (row) {
    var sku = String(row[0] == null ? '' : row[0]).trim();
    if (!sku) return 'ERROR: Missing SKU';
    if (counts[sku] > 1) return 'ERROR: Duplicate SKU: ' + sku;
    var numbers = [];
    for (var i = 2; i <= 4; i++) {
      var value = row[i];
      if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' ||
          !Number.isFinite(Number(value)) || Number(value) < 0 || (i === 4 && Number(value) === 0)) {
        return 'ERROR: Invalid ' + STOCK_HEADERS[i];
      }
      numbers.push(Number(value));
    }
    if (numbers[0] > numbers[1]) {
      delete state[sku];
      return 'OK';
    }
    if (!Object.prototype.hasOwnProperty.call(state, sku)) {
      state[sku] = date;
      newlyLow.push({
        sku: sku,
        product: String(row[1] == null ? '' : row[1]),
        onHand: numbers[0],
        reorderPoint: numbers[1],
        reorderQty: numbers[2],
        supplierEmail: String(row[5] == null ? '' : row[5]).trim(),
      });
    }
    return 'LOW (alerted ' + state[sku] + ')';
  });
  return { state: state, statuses: statuses, newlyLow: newlyLow };
}

function isStockEmail_(value) {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value);
}

/** Invalid addresses never become recipients; the caller can report skipped SKUs. */
function groupSuppliers_(items) {
  var groups = Object.create(null);
  var invalid = [];
  items.forEach(function (item) {
    if (!isStockEmail_(item.supplierEmail)) {
      invalid.push(item.sku);
      return;
    }
    var email = item.supplierEmail.toLowerCase();
    if (!groups[email]) groups[email] = [];
    groups[email].push(item);
  });
  return { groups: groups, invalid: invalid };
}

function escapeStockHtml_(value) {
  var entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, function (character) { return entities[character]; });
}

function buildStockEmail_(items, supplier) {
  var intro = supplier ? 'Draft reorder request — please confirm availability and pricing before any order is placed.' :
    'Newly low inventory — suggested reorder quantities:';
  var headers = ['SKU', 'Product', 'On Hand', 'Reorder Point', 'Reorder Qty'];
  var values = items.map(function (item) {
    return [item.sku, item.product, item.onHand, item.reorderPoint, item.reorderQty];
  });
  return {
    subject: supplier ? 'DRAFT: Inventory reorder request' : 'Low-stock alert: ' + items.length + ' SKU(s)',
    body: intro + '\n\n' + headers.join(' | ') + '\n' + values.map(function (row) { return row.join(' | '); }).join('\n'),
    htmlBody: '<p style="' + EMAIL_FONT + '">' + escapeStockHtml_(intro) + '</p>' +
      '<table style="border-collapse:collapse;' + EMAIL_FONT + '"><tr>' + headers.map(function (header, i) {
        return '<th style="' + emailCellStyle_(i) + ';background:#f3f4f6">' + escapeStockHtml_(header) + '</th>';
      }).join('') + '</tr>' + values.map(function (row) {
        return '<tr>' + row.map(function (value, i) {
          return '<td style="' + emailCellStyle_(i) + '">' + escapeStockHtml_(value) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</table>',
  };
}

/** Columns 2+ (On Hand, Reorder Point, Reorder Qty) are numbers. */
function emailCellStyle_(column) {
  return 'border:1px solid #ddd;padding:6px 10px;text-align:' + (column >= 2 ? 'right' : 'left');
}

/**
 * Merges Settings tab rows ([Setting, Value, Help], header first) over defaults.
 * The default's type decides parsing: array = comma/newline list, number, boolean.
 * A blank number/boolean keeps its default; a blank list stays empty so it can be reported as missing.
 */
function parseSettings_(rows, defaults) {
  var settings = Object.assign({}, defaults);
  (rows || []).slice(1).forEach(function (row) {
    var key = String(row[0] == null ? '' : row[0]).trim();
    if (!key || !Object.prototype.hasOwnProperty.call(defaults, key)) return;
    var fallback = defaults[key];
    var value = typeof row[1] === 'string' ? row[1].trim() : row[1];
    var blank = value === '' || value == null;
    if (Array.isArray(fallback)) {
      settings[key] = blank ? [] : String(value).split(/[,\n]/).map(function (item) { return item.trim(); })
        .filter(Boolean);
    } else if (blank) {
      return;
    } else if (typeof fallback === 'number') {
      if (typeof value === 'boolean' || !Number.isFinite(Number(value))) {
        throw new Error('Settings tab, row "' + key + '": enter a number.');
      }
      settings[key] = Number(value);
    } else if (typeof fallback === 'boolean') {
      var text = String(value).toLowerCase();
      if (text !== 'true' && text !== 'false') throw new Error('Settings tab, row "' + key + '": enter TRUE or FALSE.');
      settings[key] = text === 'true';
    } else {
      settings[key] = String(value);
    }
  });
  return settings;
}

if (typeof module !== 'undefined') {
  module.exports = {
    STOCK_HEADERS, evaluateStock_, isStockEmail_, groupSuppliers_, escapeStockHtml_, buildStockEmail_, parseSettings_,
  };
}
