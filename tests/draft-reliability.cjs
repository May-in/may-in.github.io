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
      if (await page.locator('#draft-choice').isVisible()) {
        assert.equal(await page.locator('#draft-choice-description').isVisible(), true, 'A stored draft was loaded without an explicit choice');
        await page.locator('#resume-stored-draft').click();
      }
      await page.frameLocator('#preview').locator('[data-edit-path="site.name"]').first().waitFor();
      await page.locator('[data-panel="settings"]').click();
      await page.locator('[data-path="site.name"]').waitFor();
    };
    const field = page.locator('#inspector [data-path="site.name"]');
    const stored = () => page.evaluate(async key => {
      const legacy = JSON.parse(localStorage.getItem(key) || 'null');
      const indexed = await new Promise(resolve => {
        try {
          const opening = indexedDB.open('mayin-studio', 1);
          opening.onerror = () => resolve(null);
          opening.onupgradeneeded = () => opening.result.createObjectStore('drafts');
          opening.onsuccess = () => {
            const db = opening.result;
            const request = db.transaction('drafts', 'readonly').objectStore('drafts').get(key);
            request.onsuccess = () => { db.close(); resolve(request.result || null); };
            request.onerror = () => { db.close(); resolve(null); };
          };
        } catch { resolve(null); }
      });
      return Number(indexed?._savedAt || 0) >= Number(legacy?._savedAt || 0) ? (indexed || legacy) : legacy;
    }, key);
    const save = async () => {
      await page.keyboard.press('Control+s');
      await page.waitForFunction(() => document.querySelector('#save-state').textContent.includes('non publié'));
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
    await page.locator('[data-panel="dashboard"]').first().click();
    await page.waitForFunction(() => [...document.querySelectorAll('.dashboard-card')].some(card => card.querySelector('span')?.textContent === 'Brouillon' && ['À publier','Modifications en cours'].includes(card.querySelector('strong')?.textContent)));
    await page.locator('.project-row').first().click();
    await page.locator('[data-project-media-index="0"]').first().click();
    assert.match(await page.locator('#inspector').innerText(), /Description pour lecteur d’écran/);
    assert.match(await page.locator('#inspector').innerText(), /n’est pas affiché comme une légende/);
    await page.locator('[data-panel="settings"]').click();
    // The shortcut also works while focus is INSIDE the preview frame.
    const previewName = page.frameLocator('#preview').locator('.wordmark [data-edit-path="site.name"]');
    await previewName.click(); await page.keyboard.press('End'); await page.keyboard.type(' X');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => document.querySelector('#save-state').textContent.includes('non publié'));
    assert.ok((await stored()).site.name.endsWith(' X'));

    await page.locator('[data-panel="settings"]').click();
    await field.fill('Hidden tab saved');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {configurable:true, value:'hidden'});
      document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState;
    });
    assert.equal((await stored()).site.name, 'Hidden tab saved');

    // Large image drafts exceed localStorage; IndexedDB must keep saving them.
    await page.evaluate(() => {
      window.restoreStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k,v) { if(k === 'mayin-studio-draft') throw new DOMException('Full','QuotaExceededError'); return window.restoreStorage.call(this,k,v); };
    });
    await field.fill('Saved despite localStorage quota'); await save();
    assert.equal((await stored()).site.name, 'Saved despite localStorage quota');
    assert.equal(await page.locator('#draft-warning').isVisible(), false);
    // If both stores fail, keep the prior copy and require an exported backup.
    const beforeQuota = await stored();
    await page.evaluate(() => {
      Object.defineProperty(indexedDB, 'open', { configurable:true, value:() => { throw new DOMException('Blocked','UnknownError'); } });
    });
    await field.fill('Recoverable unsaved edit');
    await page.locator('#draft-warning:visible').waitFor();
    assert.equal(beforeQuota.site.name, 'Saved despite localStorage quota');
    assert.equal(await field.inputValue(), 'Recoverable unsaved edit');
    await page.setViewportSize({width:390,height:844});
    const warning = await page.locator('#draft-warning').boundingBox();
    assert.ok(warning.x >= 0 && warning.x + warning.width <= 390, 'Warning overflows phone');
    pending = null; await page.locator('#publish').click();
    assert.equal(pending, null, 'An unsaved draft was published before a backup was downloaded');
    const downloading = page.waitForEvent('download');
    await page.locator('#export-unsaved').click();
    const download = await downloading;
    const stream = await download.createReadStream(); const chunks=[];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).site.name, 'Recoverable unsaved edit');
    await download.delete();
    await startPublish(); await completePublish(500);
    assert.equal(await field.inputValue(), 'Recoverable unsaved edit', 'Failed publication lost the backed-up in-memory draft');
    await page.evaluate(() => { Storage.prototype.setItem = window.restoreStorage; delete indexedDB.open; });
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
    // A publication made in another tab/device must not be overwritten by this older draft.
    published = { site:{ ...published.site, name:'External publication' }, projects:published.projects };
    pending = null;
    await page.locator('#publish').click();
    await page.locator('#publish-conflict:visible').waitFor();
    assert.equal(pending, null, 'A stale draft reached the publish endpoint');
    assert.equal((await stored()).site.name, 'Newer edit B', 'Conflict removed the local draft');
    await page.reload(); await ready();
    pending = null;
    await page.locator('#publish').click();
    await page.locator('#publish-conflict:visible').waitFor();
    assert.equal(pending, null, 'Reloading an older draft hid the publication conflict');
    await page.setViewportSize({width:390,height:844});
    const conflictBox = await page.locator('#publish-conflict').boundingBox();
    assert.ok(conflictBox.x >= 0 && conflictBox.x + conflictBox.width <= 390, 'Conflict warning overflows phone');
    const conflictDownload = page.waitForEvent('download');
    await page.locator('#export-conflict').click();
    const conflictFile = await conflictDownload;
    const conflictChunks=[];
    for await (const chunk of await conflictFile.createReadStream()) conflictChunks.push(chunk);
    const conflictBackup = JSON.parse(Buffer.concat(conflictChunks).toString());
    assert.equal(conflictBackup.site.name, 'Newer edit B');
    assert.match(conflictBackup._publishedFingerprint, /^[a-f0-9]{64}$/);
    await conflictFile.delete();
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#discard-draft').click();
    await page.waitForFunction(() => document.querySelector('#publish-conflict').hidden);
    assert.equal(await page.locator('#publish-conflict').isVisible(), false, 'Discard kept the conflict warning');
    await page.locator('[data-panel="settings"]').click();
    await field.fill('Newer edit B');
    await startPublish(); await completePublish();
    await page.waitForTimeout(650); assert.equal(await stored(), null, 'Successful publication left a stale draft');
    await page.reload(); await ready(); assert.equal(await field.inputValue(), 'Newer edit B');
    // Technical Studio releases must not make a recent editorial draft unpublishable.
    await field.fill('Draft across a Studio release'); await save();
    const inlineBase = (await stored())._publishedFingerprint;
    assert.match(inlineBase, /^[a-f0-9]{64}$/, 'Draft and its source revision were not saved together');
    published = { site:{ ...published.site, studioVersion:'1.9.1' }, projects:published.projects };
    await page.reload(); await ready(); await startPublish(); await completePublish();
    assert.equal(published.site.name, 'Draft across a Studio release');
    // A draft from the old editing contract is never opened or migrated silently.
    await page.evaluate(({key, published}) => {
      localStorage.setItem(key, JSON.stringify({ ...published, site:{ ...published.site, schemaVersion:3, name:'Old format draft' }, _publishedFingerprint:'a'.repeat(64), _savedAt:Date.now() }));
    }, {key, published});
    pending = null;
    await page.reload();
    await page.locator('#draft-choice:visible').waitFor();
    assert.equal(await page.locator('#resume-stored-draft').isDisabled(), true, 'Incompatible draft can still be opened');
    assert.match(await page.locator('#draft-choice-description').innerText(), /version 3.*Studio actuel : 4/);
    assert.equal((await stored()).site.name, 'Old format draft', 'Incompatible draft was deleted');
    const oldDownload = page.waitForEvent('download');
    await page.locator('#download-stored-draft').click();
    const oldFile = await oldDownload;
    const oldChunks=[];
    for await (const chunk of await oldFile.createReadStream()) oldChunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(oldChunks).toString()).site.name, 'Old format draft');
    await oldFile.delete();
    assert.equal(await page.locator('#start-from-published').isEnabled(), true);
    await page.locator('#start-from-published').click();
    await page.locator('#draft-choice').waitFor({state:'hidden'});
    await page.locator('[data-panel="settings"]').click();
    assert.equal(await field.inputValue(), published.site.name, 'Starting from published content loaded an incompatible draft');
    assert.equal(pending, null, 'Incompatible draft reached the publish endpoint');
    assert.deepEqual(errors, []);
    console.log('Draft reliability OK: save/recovery, stale publication conflict, incompatible schema export, and no live writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
