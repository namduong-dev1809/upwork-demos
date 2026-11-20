/** Pure inventory logic. Apps Script loads these functions into its global scope. */
var STOCK_HEADERS = ['SKU', 'Product', 'On Hand', 'Reorder Point', 'Reorder Qty', 'Supplier Email'];

/** Only a valid recovery clears an alert; bad or absent rows retain their state. */
function evaluateStock(rows, previousState, date) {
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

function isStockEmail(value) {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value);
}

/** Invalid addresses never become recipients; the caller can report skipped SKUs. */
function groupSuppliers(items) {
  var groups = Object.create(null);
  var invalid = [];
  items.forEach(function (item) {
    if (!isStockEmail(item.supplierEmail)) {
      invalid.push(item.sku);
      return;
    }
    var email = item.supplierEmail.toLowerCase();
    if (!groups[email]) groups[email] = [];
    groups[email].push(item);
  });
  return { groups: groups, invalid: invalid };
}

function escapeStockHtml(value) {
  var entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, function (character) { return entities[character]; });
}

function buildStockEmail(items, supplier) {
  var intro = supplier ? 'Draft reorder request — please confirm availability and pricing before any order is placed.' :
    'Newly low inventory — suggested reorder quantities:';
  var headers = ['SKU', 'Product', 'On Hand', 'Reorder Point', 'Reorder Qty'];
  var values = items.map(function (item) {
    return [item.sku, item.product, item.onHand, item.reorderPoint, item.reorderQty];
  });
  return {
    subject: supplier ? 'DRAFT: Inventory reorder request' : 'Low-stock alert: ' + items.length + ' SKU(s)',
    body: intro + '\n\n' + headers.join(' | ') + '\n' + values.map(function (row) { return row.join(' | '); }).join('\n'),
    htmlBody: '<p>' + escapeStockHtml(intro) + '</p><table><tr>' + headers.map(function (header) {
      return '<th>' + escapeStockHtml(header) + '</th>';
    }).join('') + '</tr>' + values.map(function (row) {
      return '<tr>' + row.map(function (value) { return '<td>' + escapeStockHtml(value) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</table>',
  };
}

if (typeof module !== 'undefined') {
  module.exports = { STOCK_HEADERS, evaluateStock, isStockEmail, groupSuppliers, escapeStockHtml, buildStockEmail };
}
