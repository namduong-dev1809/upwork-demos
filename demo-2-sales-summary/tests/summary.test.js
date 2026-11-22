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
  const s = sales.buildSummary_([
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
  const s = sales.buildSummary_([row('toString', 1, 1), row('__proto__', 1, 1)], today);
  assert.deepEqual(s.topProducts.map(p => p.product), ['__proto__', 'toString']);
});

test('compares same weekday last week, with positive and negative percentage changes', () => {
  const rows = [row('Now', 3, 10), row('Then', 2, 10, '2026-11-13')];
  const s = sales.buildSummary_(rows, today);
  assert.equal(s.previousDay, '2026-11-13');
  assert.equal(s.previousRevenueCents, 2000);
  assert.equal(s.changeCents, 1000);
  assert.equal(s.changePercent, 50);
  const empty = sales.buildSummary_(rows.slice(1), today);
  assert.equal(empty.changeCents, -2000);
  assert.equal(empty.changePercent, -100);
  assert.match(sales.renderSummary_(s, true).body, /\+\$10\.00 \(\+50\.00%\)/);
});

test('zero last week never divides by zero, including both days empty', () => {
  for (const rows of [[], [row('New', 1, 5)]]) {
    const s = sales.buildSummary_(rows, today);
    assert.equal(s.changePercent, null);
    const message = sales.renderSummary_(s, true);
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
  const s = sales.buildSummary_([row('Valid', '2', '1.25'), ...bad], today);
  assert.equal(s.skippedRows, bad.length);
  assert.equal(s.revenueCents, 250);
  assert.equal(s.units, 2);
  assert.match(sales.renderSummary_(s, true).body, /Skipped invalid rows \(entire sheet\): 16/);
});

test('HTML escapes sheet text and currency; plain fallback preserves readable text', () => {
  const product = '<img src=x onerror="alert(1)"> & \'sale\'';
  const s = sales.buildSummary_([row(product, 1, 1)], today);
  const message = sales.renderSummary_(s, true, '<$>');
  assert.match(message.htmlBody, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;sale&#39;/);
  assert.match(message.htmlBody, /&lt;\$&gt;1\.00/);
  assert.doesNotMatch(message.htmlBody, /<img/);
  assert.ok(message.body.includes(product));
  assert.match(message.htmlBody, /<table style="border-collapse:collapse/);
});

test('empty days send a short no-sales email by default or return null when disabled', () => {
  const s = sales.buildSummary_([], today);
  assert.equal(s.orders, 0);
  assert.match(sales.renderSummary_(s, true).subject, /No sales today: 2026-11-20/);
  assert.match(sales.renderSummary_(s, true).htmlBody, /No sales today/);
  assert.equal(sales.renderSummary_(s, false), null);
  assert.ok(sales.renderSummary_(sales.buildSummary_([row('Free', 1, 0)], today), false));
});

test('salesDay_ accepts only real yyyy-MM-dd strings', () => {
  assert.equal(sales.salesDay_(today), today);
  for (const bad of ['2026-02-30', '2026-11-20T10:00:00', '2026-11-20T23:59:59+07:00', new Date(), 45000, null]) {
    assert.equal(sales.salesDay_(bad), null);
  }
});

test('last-week date crosses year boundary without local timezone arithmetic', () => {
  const s = sales.buildSummary_([row('Then', 1, 5, '2025-12-26')], '2026-01-02');
  assert.equal(s.previousDay, '2025-12-26');
  assert.equal(s.previousRevenueCents, 500);
  assert.throws(() => sales.buildSummary_([], ''), /Invalid summary date/);
});

test('unsafe line values are counted; unsafe aggregate totals fail explicitly', () => {
  assert.equal(sales.buildSummary_([row('Huge', 2, Number.MAX_SAFE_INTEGER)], today).skippedRows, 1);
  const large = row('Large', 1, 50000000000000);
  assert.throws(() => sales.buildSummary_([large, large], today), /safe integer precision/);
});

const settingsRows = (recipients = 'one@example.com, two@example.com', extra = []) => [
  ['Setting', 'Value', 'Help'], ['Recipients', recipients, ''], ...extra,
];

function fakeSheet(values) {
  return {
    values,
    getLastRow: () => values.length,
    getDataRange: () => ({ getValues: () => (values.length ? values.map(r => r.slice()) : [['']]) }),
    appendRow: row => values.push(row),
    getRange: (row, col, rows) => ({ setValues: v => { values.splice(row - 1, rows, ...v); } }),
  };
}

function glue({ settings = settingsRows(), sales, tz = 'America/New_York', now } = {}) {
  const headers = ['Date', 'Order ID', 'Customer', 'Product', 'Quantity', 'Unit Price', 'Total'];
  const sent = [];
  const deleted = [];
  const installed = [];
  const alerts = [];
  const menu = [];
  const triggers = [{ getHandlerFunction: () => 'sendSummaryNow' }, { getHandlerFunction: () => 'other' }];
  const sheets = { Sales: fakeSheet(sales || [headers]) };
  if (settings) sheets.Settings = fakeSheet(settings);
  const chain = {};
  for (const name of ['timeBased', 'atHour', 'nearMinute', 'everyDays', 'inTimezone', 'create']) {
    chain[name] = (...args) => { installed.push([name, ...args]); return chain; };
  }
  const menuChain = {
    addItem: (label, handler) => { menu.push([label, handler]); return menuChain; },
    addToUi: () => menu.push('added'),
  };
  // Stand-in for Utilities.formatDate(d, tz, 'yyyy-MM-dd'): en-CA formats as yyyy-MM-dd.
  const formatDate = (d, zone, fmt) => {
    assert.equal(fmt, 'yyyy-MM-dd');
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(d);
  };
  const context = vm.createContext({
    Date: now ? class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } } : Date,
    Utilities: { formatDate },
    SpreadsheetApp: {
      getActive: () => ({
        getSpreadsheetTimeZone: () => tz,
        getSheetByName: name => sheets[name] || null,
        insertSheet: name => (sheets[name] = fakeSheet([])),
      }),
      getUi: () => ({ createMenu: title => { menu.push(title); return menuChain; }, alert: m => alerts.push(m) }),
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
  return { context, sheets, sent, deleted, installed, alerts, menu };
}

test('first setup creates Settings, schedules the default hour and says to fill Recipients', () => {
  const g = glue({ settings: null });
  g.context.setup();
  assert.deepEqual(g.sheets.Settings.values.map(r => r[0]),
    ['Setting', 'Recipients', 'Send when no sales', 'Currency symbol', 'Language (en/vi)', 'Send hour (0-23)']);
  assert.equal(JSON.stringify(g.sheets.Settings.values[5].slice(0, 2)), '["Send hour (0-23)",19]');
  assert.equal(g.deleted.length, 1);
  assert.equal(g.deleted[0].getHandlerFunction(), 'sendSummaryNow');
  assert.deepEqual(g.installed, [
    ['handler', 'sendSummaryNow'], ['timeBased'], ['atHour', 19], ['nearMinute', 0],
    ['everyDays', 1], ['inTimezone', 'America/New_York'], ['create'],
  ]);
  assert.equal(g.alerts.length, 1);
  assert.match(g.alerts[0], /Added 5 row\(s\)/);
  assert.match(g.alerts[0], /Fill the "Recipients" row/);
});

test('re-running setup keeps buyer values, appends only missing keys and uses Send hour', () => {
  const g = glue({ settings: settingsRows('me@example.com', [['Send hour (0-23)', '7', 'my note']]) });
  g.context.setup();
  const rows = g.sheets.Settings.values;
  assert.deepEqual(rows[1], ['Recipients', 'me@example.com', '']);
  assert.deepEqual(rows[2], ['Send hour (0-23)', '7', 'my note']);
  assert.equal(rows.length, 6);
  assert.ok(g.installed.some(e => e[0] === 'atHour' && e[1] === 7));
  assert.match(g.alerts[0], /Added 3 row\(s\)/);
  assert.match(g.alerts[0], /Send summary now to send a test email/);
  g.context.setup();
  assert.equal(g.sheets.Settings.values.length, 6);
  assert.match(g.alerts[1], /already complete/);
  assert.equal(g.installed.filter(e => e[0] === 'create').length, 2);
});

test('bad headers or send hour alert before setup changes triggers', () => {
  let g = glue({ sales: [['Wrong header']] });
  g.context.setup();
  assert.match(g.alerts[0], /Sales tab: row 1 must contain/);
  assert.equal(g.installed.length + g.deleted.length, 0);
  g = glue({ settings: settingsRows(undefined, [['Send hour (0-23)', 24]]) });
  g.context.setup();
  assert.match(g.alerts[0], /"Send hour \(0-23\)": enter a whole number/);
  assert.equal(g.installed.length + g.deleted.length, 0);
});

test('menu send uses Settings, alerts the result; menu lists Setup first', () => {
  const g = glue();
  g.context.sendSummaryFromMenu();
  assert.equal(g.sent.length, 1);
  assert.equal(g.sent[0].to, 'one@example.com,two@example.com');
  assert.match(g.sent[0].body, /No sales today/);
  assert.match(g.sent[0].htmlBody, /<table style="border-collapse:collapse/);
  assert.match(g.alerts[0], /Summary sent to one@example.com,two@example.com/);
  g.sheets.Settings.values.push(['Send when no sales', 'FALSE', '']);
  g.context.sendSummaryFromMenu();
  assert.equal(g.sent.length, 1);
  assert.match(g.alerts[1], /no email was sent/);
  g.context.onOpen();
  assert.deepEqual(g.menu, ['Sales summary', ['Setup / re-run setup', 'setup'],
    ['Send summary now', 'sendSummaryFromMenu'], 'added']);
});

test('menu errors become alerts; the trigger handler throws without touching the UI', () => {
  const g = glue({ settings: settingsRows('not-an-email') });
  g.context.sendSummaryFromMenu();
  assert.match(g.alerts[0], /"not-an-email" is not a valid email address/);
  assert.throws(() => g.context.sendSummaryNow(), /Recipients/);
  assert.equal(g.alerts.length, 1);
  assert.equal(g.sent.length, 0);
  g.sheets.Settings.values[1][1] = 'a@example.com';
  g.sheets.Settings.values.push(['Language (en/vi)', 'fr', '']);
  assert.throws(() => g.context.sendSummaryNow(), /enter en or vi/);
  g.sheets.Settings.values.pop();
  g.context.sendSummaryNow();
  assert.equal(g.sent[0].to, 'a@example.com');
});

test('parseSettings_ merges known keys, trims, splits lists and coerces by default type', () => {
  const defaults = { Recipients: [], Flag: true, Hour: 19, Name: 'x' };
  const s = sales.parseSettings_([
    ['Setting', 'Value', 'Help'], ['', 'ignored'], ['Unknown', 'v'],
    [' Recipients ', ' a@x.com,\nb@y.com , ,c@z.com '], ['Flag', 'false'], ['Hour', ' 7 '], ['Name', '  hi  '],
  ], defaults);
  assert.deepEqual(s, { Recipients: ['a@x.com', 'b@y.com', 'c@z.com'], Flag: false, Hour: 7, Name: 'hi' });
  assert.deepEqual(sales.parseSettings_([['Flag', true], ['Hour', 3], ['Name', '']], defaults),
    { Recipients: [], Flag: true, Hour: 3, Name: 'x' });
  assert.throws(() => sales.parseSettings_([['Hour', 'soon']], defaults), /row "Hour": "soon" is not a number/);
  assert.throws(() => sales.parseSettings_([['Flag', 'maybe']], defaults), /row "Flag": enter TRUE or FALSE/);
  assert.equal(defaults.Recipients.length, 0);
});

test('Date cells and today use the spreadsheet timezone, so 23:30 local counts for that day', () => {
  const headers = ['Date', 'Order ID', 'Customer', 'Product', 'Quantity', 'Unit Price', 'Total'];
  const at = iso => [new Date(iso), 'A', 'Ann', 'P', 1, 0, 0];
  const g = glue({
    now: '2026-11-21T04:45:00Z', // 23:45 on Nov 20 in New York
    sales: [headers,
      [new Date('2026-11-21T04:30:00Z'), 'A', 'Ann', 'Late', 1, 5, 5], // 23:30 Nov 20 New York
      [new Date('2026-11-20T04:59:00Z'), 'B', 'Ann', 'Early', 1, 100, 100], // 23:59 Nov 19 New York
      ['2026-11-20', 'C', 'Ann', 'Text', 1, 2, 2],
      [new Date('2026-11-14T04:30:00Z'), 'D', 'Ann', 'Then', 1, 1, 1], // 23:30 Nov 13 New York
      at('invalid')],
  });
  g.context.sendSummaryNow();
  assert.equal(g.sent[0].subject, 'Sales summary: 2026-11-20');
  assert.match(g.sent[0].body, /Revenue: \$7\.00/);
  assert.match(g.sent[0].body, /Revenue on 2026-11-13: \$1\.00/);
  assert.match(g.sent[0].body, /Skipped invalid rows \(entire sheet\): 1/);
  const tokyo = glue({ tz: 'Asia/Tokyo', now: '2026-11-21T04:45:00Z' });
  tokyo.context.setup();
  assert.ok(tokyo.installed.some(e => e[0] === 'inTimezone' && e[1] === 'Asia/Tokyo'));
  tokyo.context.sendSummaryNow();
  assert.equal(tokyo.sent[0].subject, 'No sales today: 2026-11-21');
});

test('missingSettingsRows_, recipients_ and sendHour_ validate plainly', () => {
  assert.deepEqual(sales.missingSettingsRows_([['Setting'], ['A', 'mine']], { A: 1, B: ['x', 'y'], C: false }, { B: 'help' }),
    [['B', 'x, y', 'help'], ['C', false, '']]);
  assert.equal(sales.recipients_(['a@x.com', 'b@y.org']), 'a@x.com,b@y.org');
  assert.throws(() => sales.recipients_([]), /Fill the "Recipients" row/);
  assert.throws(() => sales.recipients_(['a@x.com; b@y.com']), /is not a valid email/);
  assert.equal(sales.sendHour_(0), 0);
  for (const bad of [-1, 24, 7.5, NaN]) assert.throws(() => sales.sendHour_(bad), /0 to 23/);
});

test('HTML tables carry Gmail-safe inline styles with right-aligned numbers', () => {
  const html = sales.renderSummary_(sales.buildSummary_([row('Widget', 1, 2)], today), true).htmlBody;
  assert.equal((html.match(/<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px/g) || []).length, 2);
  assert.match(html, /<th scope="col" style="border:1px solid #ddd;padding:6px 10px;background:#f3f4f6;text-align:left">Product/);
  assert.match(html, /<td style="border:1px solid #ddd;padding:6px 10px;text-align:right">\$2\.00<\/td>/);
});

test('Vietnamese email uses VND grouping, dd/mm/yyyy dates and comma percent', () => {
  const s = sales.buildSummary_([
    row('Cà phê sữa', 3, 25000), row('Bạc xỉu', 1, 30000, today, 'B'),
    row('Cà phê sữa', 2, 25000, '2026-11-13'),
  ], today);
  const m = sales.renderSummary_(s, true, '₫', 'vi');
  assert.equal(m.subject, 'Báo cáo bán hàng ngày 20/11/2026');
  assert.match(m.body, /Doanh thu: 105\.000 ₫/);
  assert.match(m.body, /Doanh thu ngày 13\/11\/2026: 50\.000 ₫/);
  assert.match(m.body, /\+55\.000 ₫ \(\+110,00%\)/);
  assert.match(m.body, /Top 3 món theo doanh thu:\nCà phê sữa: 75\.000 ₫/);
  assert.match(sales.renderSummary_(sales.buildSummary_([], today), true, undefined, 'vi').subject,
    /^Hôm nay chưa có đơn: 20\/11\/2026$/);
  const loss = sales.buildSummary_([row('A', 1, 1000), row('A', 1, 1234567, '2026-11-13')], today);
  assert.match(sales.renderSummary_(loss, true, undefined, 'vi').body, /-1\.233\.567 ₫/);
});
