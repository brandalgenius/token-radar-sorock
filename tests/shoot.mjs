import { chromium } from 'playwright';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '/home/ubuntu/work/token-radar-sorock/screenshots';
const PAGE = 'file:///home/ubuntu/work/token-radar-sorock/out/dashboard/index.html';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const external = [];
page.on('request', (r) => { if (!r.url().startsWith('file:')) external.push(r.url()); });
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await page.goto(PAGE);
await page.waitForSelector('#results table tbody tr');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, '01-opportunity-board.png') });

// A protocol detail view: top-ranked row, opened from the table itself.
await page.click('#results table tbody tr:first-child [data-open]');
await page.waitForSelector('#detail-title');
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, '02-protocol-dossier.png') });

// A filtered view: real select interaction, not a re-render from code.
await page.click('.backrow .back');
await page.waitForSelector('#filter-category');
const category = await page.selectOption('#filter-category', { index: 1 });
await page.click('[data-view="early"]');
await page.waitForTimeout(300);
const shown = await page.$$eval('#results table tbody tr', (rows) => rows.length);
console.log('filtered category', category, 'rows visible', shown);
await page.screenshot({ path: join(OUT, '03-filtered-early-radar.png') });

console.log('external requests', external.length, external.slice(0, 5));
await browser.close();
for (const f of readdirSync(OUT)) console.log(f, statSync(join(OUT, f)).size);