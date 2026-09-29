// Isolated browser + intercepted local assets. No live API calls or real drafts.
// node tests/draft-reliability.cjs <absolute path to playwright>
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const key = 'mayin-studio-draft';
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.ico':'image/x-icon' };

(async () => {
  const site = JSON.parse(await fs.readFile(path.join(root, 'content/site.json'), 'utf8'));
  const projects = JSON.parse(await fs.readFile(path.join(root, 'content/projects.json'), 'utf8')).projects;
  let published = { site, projects }, pending = null;
  const errors = [];
  const browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:900} });
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const json = body => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) });
      if (url.origin !== 'https://mayin.test') {
        if (url.pathname === '/auth/me') return json({ user:{login:'test'}, csrf:'test-only' });
        if (url.pathname === '/api/content') return json(published);
        if (url.pathname === '/api/publish') {
          pending = { route, payload:route.request().postDataJSON() };
          return;
        }
        return json({});
      }
      const target = path.resolve(root, '.' + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
      assert.ok(target.startsWith(root + path.sep));
      try { return route.fulfill({ status:200, contentType:mime[path.extname(target)] || 'application/octet-stream', body:await fs.readFile(target) }); }
      catch { return route.fulfill({status:404, body:''}); }
    });
    const ready = async () => {
      await page.locator('#studio:visible').waitFor();
      await page.frameLocator('#preview').locator('[data-edit-path="site.name"]').first().waitFor();
      await page.locator('[data-panel="settings"]').click();
      await page.locator('[data-path="site.name"]').waitFor();
    };
    const field = page.locator('#inspector [data-path="site.name"]');
    const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    const save = async () => {
      await page.keyboard.press('Control+s');
      await page.waitForFunction(key => !!localStorage.getItem(key) && document.querySelector('#save-state').textContent.includes('non publié'), key);
    };
    const startPublish = async () => {
      pending = null; await page.locator('#publish').click();
      for (let n=0; !pending && n<100; n++) await page.waitForTimeout(20);
      assert.ok(pending, 'Publication request missing');
    };
    const completePublish = async (status=200) => {
      if (status === 200) published = {site:pending.payload.site, projects:pending.payload.projects.projects};
      await pending.route.fulfill({status, contentType:'application/json', body:JSON.stringify(status === 200 ? {ok:true} : {error:'Test: publication refused'})});
      await page.waitForFunction(() => !document.querySelector('#publish').disabled);
    };
    await page.goto('https://mayin.test/admin/'); await ready();
    // Edit and reload in the SAME task, well before the debounce has elapsed.
    await field.evaluate(el => { el.value='Rapid reload'; el.dispatchEvent(new Event('input',{bubbles:true})); location.reload(); });
    await page.waitForLoadState('load'); await ready();
    assert.equal((await stored()).site.name, 'Rapid reload');
    assert.equal(await field.inputValue(), 'Rapid reload');

    await field.fill('Saved with keyboard'); await save();
    assert.equal((await stored()).site.name, 'Saved with keyboard');
    // The shortcut also works while focus is INSIDE the preview frame.
    const previewName = page.frameLocator('#preview').locator('.wordmark [data-edit-path="site.name"]');
    await previewName.click(); await page.keyboard.press('End'); await page.keyboard.type(' X');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).site.name.endsWith(' X'), key);

    await page.locator('[data-panel="settings"]').click();
    await field.fill('Hidden tab saved');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {configurable:true, value:'hidden'});
      document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState;
    });
    assert.equal((await stored()).site.name, 'Hidden tab saved');

    // A failed write preserves both the previous stored draft and in-memory edits.
    const beforeQuota = await page.evaluate(key => localStorage.getItem(key), key);
    await page.evaluate(() => {
      window.restoreStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k,v) { if(k === 'mayin-studio-draft') throw new DOMException('Full','QuotaExceededError'); return window.restoreStorage.call(this,k,v); };
    });
    await field.fill('Recoverable unsaved edit');
    await page.locator('#draft-warning:visible').waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), beforeQuota);
    assert.equal(await field.inputValue(), 'Recoverable unsaved edit');
    await page.setViewportSize({width:390,height:844});
    const warning = await page.locator('#draft-warning').boundingBox();
    assert.ok(warning.x >= 0 && warning.x + warning.width <= 390, 'Warning overflows phone');
    const downloading = page.waitForEvent('download');
    await page.locator('#export-unsaved').click();
    const download = await downloading;
    const stream = await download.createReadStream(); const chunks=[];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).site.name, 'Recoverable unsaved edit');
    await download.delete();
    await page.evaluate(() => { Storage.prototype.setItem = window.restoreStorage; });
    await page.locator('#retry-save').click();
    assert.equal((await stored()).site.name, 'Recoverable unsaved edit');
    assert.equal(await page.locator('#draft-warning').isVisible(), false);
    await page.setViewportSize({width:1440,height:900});

    // Discard must cancel the old 500ms timer, not recreate a draft afterwards.
    await page.evaluate(() => {
      const el=document.querySelector('#inspector [data-path="site.name"]');
      el.value='Discard me'; el.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#discard-draft').click();
    });
    await page.waitForTimeout(650); assert.equal(await stored(), null);
    await page.locator('[data-panel="settings"]').click();
    await field.fill('Snapshot A'); await startPublish();
    assert.equal(pending.payload.site.name, 'Snapshot A');
    await field.fill('Newer edit B'); await completePublish();
    assert.equal(await field.inputValue(), 'Newer edit B', 'Publication overwrote newer edits');
    assert.equal((await stored()).site.name, 'Newer edit B');
    assert.equal(await page.locator('#undo').isDisabled(), false, 'Publication erased newer history');
    await page.reload(); await ready();
    assert.equal(await field.inputValue(), 'Newer edit B', 'Newer edit lost on reload');
    await startPublish(); await completePublish(500);
    assert.equal((await stored()).site.name, 'Newer edit B', 'Failed publication deleted draft');
    await startPublish(); await completePublish(401);
    assert.equal(await page.locator('#studio').isVisible(), true, 'Expired session hid recovery controls');
    assert.equal((await stored()).site.name, 'Newer edit B');
    await startPublish(); await completePublish();
    await page.waitForTimeout(650); assert.equal(await stored(), null, 'Successful publication left a stale draft');
    await page.reload(); await ready(); assert.equal(await field.inputValue(), 'Newer edit B');
    // A patch release must not reapply the older, one-off image orientation migration.
    await page.evaluate(({key, published}) => {
      published.site.studioVersion = '1.5.0';
      published.projects.find(p=>p.slug === 'moooi-stand-commercial').media.find(m=>m.src.endsWith('12-maquette-dessus-alpha.webp')).format = 'portrait';
      localStorage.setItem(key, JSON.stringify(published));
    }, {key, published});
    await page.reload(); await ready();
    assert.equal((await stored()).projects.find(p=>p.slug === 'moooi-stand-commercial').media.find(m=>m.src.endsWith('12-maquette-dessus-alpha.webp')).format, 'portrait');
    assert.deepEqual(errors, []);
    console.log('Draft reliability OK: rapid reload, keyboard/preview save, background save, quota recovery/export on phone, discard timer, concurrent edits, failed/expired/successful publication. No live writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
