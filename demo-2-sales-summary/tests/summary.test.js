// Run: node --test demo-2-sales-summary/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sales = require('../src/Summary.js');

const today = '2026-11-20';
const row = (product, quantity, price, date = today, id = 'A') =>
  [date, id, 'Ann Lee', product, quantity, price, 999999];

test('totals use integer cents, unique orders, and top three products sorted by revenue', () => {
  const s = sales.buildSummary([
    row('Widget', 3, '0.10'), row('Gadget', 2, 19.99),
    row('Widget', 1, 10, today, 'B'), row('Third', 1, 5, today, 'C'),
    row('Fourth', 1, 1, today, 'D'), row('Old', 20, 100, '2026-11-18'),
  ], today);
  assert.equal(s.revenueCents, 5628);
  assert.equal(s.orders, 4);
  assert.equal(s.units, 8);
  assert.deepEqual(s.topProducts, [
    { product: 'Gadget', revenueCents: 3998 },
    { product: 'Widget', revenueCents: 1030 },
    { product: 'Third', revenueCents: 500 },
  ]);
});

test('equal product revenue sorts by name, including object-like product names', () => {
  const s = sales.buildSummary([row('toString', 1, 1), row('__proto__', 1, 1)], today);
  assert.deepEqual(s.topProducts.map(p => p.product), ['__proto__', 'toString']);
});

test('compares same weekday last week, with positive and negative percentage changes', () => {
  const rows = [row('Now', 3, 10), row('Then', 2, 10, '2026-11-13')];
  const s = sales.buildSummary(rows, today);
  assert.equal(s.previousDay, '2026-11-13');
  assert.equal(s.previousRevenueCents, 2000);
  assert.equal(s.changeCents, 1000);
  assert.equal(s.changePercent, 50);
  const empty = sales.buildSummary(rows.slice(1), today);
  assert.equal(empty.changeCents, -2000);
  assert.equal(empty.changePercent, -100);
  assert.match(sales.renderSummary(s, true).body, /\+\$10\.00 \(\+50\.00%\)/);
});

test('zero last week never divides by zero, including both days empty', () => {
  for (const rows of [[], [row('New', 1, 5)]]) {
    const s = sales.buildSummary(rows, today);
    assert.equal(s.changePercent, null);
    const message = sales.renderSummary(s, true);
    assert.match(message.body, /N\/A: last week was zero/);
    assert.doesNotMatch(message.body, /Infinity|NaN/);
  }
});

test('invalid rows are skipped and counted across the whole sheet', () => {
  const bad = [
    row('X', 'junk', 1), row('X', 1, 'junk'), row('X', 1, 1, ''),
    row('X', '', 1), row('X', 1, ''), row('X', true, 1), row('X', 1, null),
    row('X', -1, 1), row('X', 0.5, 1), row('X', 1, -1),
    row('X', 1, Infinity), row('X', 1, 1, '2026-02-30'),
    row('', 1, 1), row('X', 1, 1, today, ''),
    row('X', 'bad', 1, '2026-01-01'), [],
  ];
  const s = sales.buildSummary([row('Valid', '2', '1.25'), ...bad], today);
  assert.equal(s.skippedRows, bad.length);
  assert.equal(s.revenueCents, 250);
  assert.equal(s.units, 2);
  assert.match(sales.renderSummary(s, true).body, /Skipped invalid rows \(entire sheet\): 16/);
});

test('HTML escapes sheet text and currency; plain fallback preserves readable text', () => {
  const product = '<img src=x onerror="alert(1)"> & \'sale\'';
  const s = sales.buildSummary([row(product, 1, 1)], today);
  const message = sales.renderSummary(s, true, '<$>');
  assert.match(message.htmlBody, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;sale&#39;/);
  assert.match(message.htmlBody, /&lt;\$&gt;1\.00/);
  assert.doesNotMatch(message.htmlBody, /<img/);
  assert.ok(message.body.includes(product));
  assert.match(message.htmlBody, /<table>/);
});

test('empty days send a short no-sales email by default or return null when disabled', () => {
  const s = sales.buildSummary([], today);
  assert.equal(s.orders, 0);
  assert.match(sales.renderSummary(s, true).subject, /No sales today: 2026-11-20/);
  assert.match(sales.renderSummary(s, true).htmlBody, /No sales today/);
  assert.equal(sales.renderSummary(s, false), null);
  assert.ok(sales.renderSummary(sales.buildSummary([row('Free', 1, 0)], today), false));
});

test('Vietnam date buckets handle midnight, explicit offsets, and date-only cells', () => {
  assert.equal(sales.salesDay(new Date('2026-11-19T16:59:59Z')), '2026-11-19');
  assert.equal(sales.salesDay(new Date('2026-11-19T17:00:00Z')), today);
  assert.equal(sales.salesDay('2026-11-20T23:59:59+07:00'), today);
  assert.equal(sales.salesDay('2026-11-20T17:00:00Z'), '2026-11-21');
  assert.equal(sales.salesDay(today), today);
  assert.equal(sales.salesDay('2026-11-20T10:00:00'), null);
  assert.equal(sales.salesDay(new Date(NaN)), null);
  const s = sales.buildSummary([
    row('Before', 1, 100, new Date('2026-11-19T16:59:59Z')),
    row('Start', 1, 1, new Date('2026-11-19T17:00:00Z')),
    row('End', 1, 2, '2026-11-20T23:59:59+07:00'),
    row('After', 1, 100, '2026-11-20T17:00:00Z'),
    row('Last week', 1, 1, '2026-11-12T17:00:00Z'),
  ], new Date('2026-11-19T17:00:00Z'));
  assert.equal(s.revenueCents, 300);
  assert.equal(s.previousRevenueCents, 100);
});

test('last-week date crosses year boundary without local timezone arithmetic', () => {
  const s = sales.buildSummary([row('Then', 1, 5, '2025-12-26')], '2026-01-02');
  assert.equal(s.previousDay, '2025-12-26');
  assert.equal(s.previousRevenueCents, 500);
  assert.throws(() => sales.buildSummary([], ''), /Invalid summary date/);
});

test('unsafe line values are counted; unsafe aggregate totals fail explicitly', () => {
  assert.equal(sales.buildSummary([row('Huge', 2, Number.MAX_SAFE_INTEGER)], today).skippedRows, 1);
  const large = row('Large', 1, 50000000000000);
  assert.throws(() => sales.buildSummary([large, large], today), /safe integer precision/);
});

function glue() {
  const headers = ['Date', 'Order ID', 'Customer', 'Product', 'Quantity', 'Unit Price', 'Total'];
  const sent = [];
  const deleted = [];
  const installed = [];
  const triggers = [{ getHandlerFunction: () => 'sendSummaryNow' }, { getHandlerFunction: () => 'other' }];
  let data = [headers];
  const menu = [];
  const chain = {};
  for (const name of ['timeBased', 'atHour', 'nearMinute', 'everyDays', 'inTimezone', 'create']) {
    chain[name] = (...args) => { installed.push([name, ...args]); return chain; };
  }
  const context = vm.createContext({
    Date,
    SpreadsheetApp: {
      getActive: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => data }) }) }),
      getUi: () => ({ createMenu: title => ({ addItem: (label, handler) => ({
        addToUi: () => menu.push([title, label, handler]),
      }) }) }),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: t => deleted.push(t),
      newTrigger: handler => { installed.push(['handler', handler]); return chain; },
    },
    MailApp: { sendEmail: message => sent.push(message) },
  });
  for (const file of ['Summary.js', 'Main.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  }
  return { context, sent, deleted, installed, menu, setData: value => { data = value; } };
}

test('setup replaces only its handler and schedules one Vietnam evening trigger per call', () => {
  const g = glue();
  g.context.setup();
  assert.equal(g.deleted.length, 1);
  assert.equal(g.deleted[0].getHandlerFunction(), 'sendSummaryNow');
  assert.deepEqual(g.installed, [
    ['handler', 'sendSummaryNow'], ['timeBased'], ['atHour', 19], ['nearMinute', 0],
    ['everyDays', 1], ['inTimezone', 'Asia/Ho_Chi_Minh'], ['create'],
  ]);
  g.context.setup();
  assert.equal(g.deleted.length, 2);
  assert.equal(g.installed.filter(entry => entry[0] === 'create').length, 2);
});

test('manual run sends both bodies to configured recipients; menu points to manual handler', () => {
  const g = glue();
  g.context.CONFIG.RECIPIENTS = ['one@example.com', 'two@example.com'];
  g.context.sendSummaryNow();
  assert.equal(g.sent.length, 1);
  assert.equal(g.sent[0].to, 'one@example.com,two@example.com');
  assert.match(g.sent[0].body, /No sales today/);
  assert.match(g.sent[0].htmlBody, /<table>/);
  g.context.CONFIG.SEND_WHEN_EMPTY = false;
  g.context.sendSummaryNow();
  assert.equal(g.sent.length, 1);
  g.context.onOpen();
  assert.deepEqual(g.menu, [['Sales summary', 'Send summary now', 'sendSummaryNow']]);
});

test('bad headers or recipients fail before setup changes triggers', () => {
  const g = glue();
  g.context.CONFIG.RECIPIENTS = [];
  assert.throws(() => g.context.setup(), /RECIPIENTS/);
  assert.equal(g.installed.length, 0);
  g.setData([['Wrong header']]);
  assert.throws(() => g.context.setup(), /Sales headers/);
  assert.equal(g.deleted.length, 0);
});
