// Optional browser QA. No browser dependency is needed by the submitted program.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
// Install Playwright locally for this optional QA; production has no dependencies.
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors = [], network = [];
page.on('pageerror', e=>errors.push(e.message));
page.on('request', r=>{if(!r.url().startsWith('file:'))network.push(r.url());});
const url=pathToFileURL(resolve(process.env.RADAR_OUTPUT || 'out','dashboard/index.html')).href;
try {
 await page.goto(url);
 await page.waitForSelector('tbody tr');
 const count=await page.evaluate(()=>window.RADAR.rows.length);
 const hero=await page.evaluate(()=>{
   const stats=[...document.querySelectorAll('.stat')].map(s=>s.textContent);
   const launch=window.RADAR.rows.filter(r=>!r.product_of_another).length;
   return {stats,launch,board:window.RADAR.rows.length};
 });
 assert(hero.stats.some(t=>/Launch candidates/i.test(t)&&t.includes(String(hero.launch))),'launch candidate stat must exclude coverage-only products: '+JSON.stringify(hero));
 assert.equal(hero.board-hero.launch,3,'three board rows are products of another asset');
 assert.equal(await page.locator('#results tbody tr').count(),12);
 const first=await page.locator('tbody tr').first().getAttribute('data-slug');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 assert.notEqual(await page.locator('tbody tr').first().getAttribute('data-slug'),first);
 await page.getByRole('button',{name:'Previous',exact:true}).click();
 assert.equal(await page.locator('tbody tr').first().getAttribute('data-slug'),first);
 await page.locator('#search').fill('zzzz-no-protocol');
 assert.equal(await page.locator('#results tbody tr').count(),0);
 assert.match(await page.locator('.empty').innerText(),/No candidates/);
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await page.locator('#filter-category').selectOption('Basis Trading');
 await page.getByRole('button',{name:'Early radar',exact:true}).click();
 assert(await page.locator('#results tbody tr').count()>0);
 const slugs=await page.locator('#results tbody tr').evaluateAll(rs=>rs.map(r=>r.dataset.slug));
 assert(await page.evaluate(slugs=>slugs.every(s=>window.RADAR.rows.some(r=>r.slug===s&&r.category==='Basis Trading'&&!r.watchlist&&r.tvl_usd<window.RADAR.floor_usd)),slugs));
 const early=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#results tbody tr')].map(r=>window.RADAR.rows.find(x=>x.slug===r.dataset.slug));
   return {n:rows.length,violations:rows.filter(r=>r.watchlist||r.tvl_usd>=window.RADAR.floor_usd).map(r=>r.slug)};
 });
 assert.equal(early.violations.length,0,'early radar must hold only below-floor, non-watchlist rows: '+JSON.stringify(early));
 await page.locator('#results tbody tr .protocol').first().click();
 await page.waitForSelector('#detail-title');
 assert.match(await page.locator('.calc .out').innerText(),/Your scenario/);
 await page.locator('#calc-odds').fill('101');
 assert.match(await page.locator('.calc .out').innerText(),/valid, bounded/);
 await page.locator('#calc-odds').fill('0');
 assert.match(await page.locator('.calc .out .big').innerText(),/−/);
 await page.locator('#calc-farmers').fill('0');
 assert.match(await page.locator('.calc .out').innerText(),/valid, bounded/);
 await page.reload();
 await page.waitForSelector('#detail-title');
 assert((await page.locator('#detail-title').innerText()).length>0);
 await page.goto(url+'#p=b14g');
 await page.waitForSelector('#detail-title');
 assert.match(await page.locator('.detail-value small').innerText(),/coverage-only/i);
 await page.setViewportSize({width:390,height:844});
 const mobileDetail=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
 assert(mobileDetail.scroll<=mobileDetail.client+1,JSON.stringify(mobileDetail));
 await page.getByRole('button',{name:'Opportunity board'}).click();
 const mobileBoard=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
 assert(mobileBoard.scroll<=mobileBoard.client+1,JSON.stringify(mobileBoard));
 assert.deepEqual(errors,[]);
 assert.deepEqual(network,[]);
 console.log(JSON.stringify({status:'PASS',candidates:count,checks:['pagination','search-empty','reset','category+early','detail','scenario-validation','deep-link-reload','mobile-detail','mobile-board','no-page-errors','no-network'],mobileDetail,mobileBoard}));
} finally {await browser.close();}
