// Isolated Studio: every visible inline field must be selectable from the preview.
// No real account, browser profile, draft, or network API is used.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg' };
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const target = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (!target.startsWith(root + path.sep)) return response.writeHead(403).end();
  try { response.writeHead(200, { 'content-type':mime[path.extname(target)] || 'application/octet-stream' }).end(await fs.readFile(target)); }
  catch { response.writeHead(404).end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:900} });
    await page.goto('http://localhost:' + server.address().port + '/admin/');
    await page.locator('#studio:visible').waitFor();
    const frame = page.frameLocator('#preview');
    const projects = JSON.parse(await fs.readFile(path.join(root, 'content/projects.json'), 'utf8')).projects;
    const urls = ['index.html','projets.html','galerie.html','a-propos.html','contact.html',...projects.filter(item => !item.hidden).map(item => 'project.html?slug=' + encodeURIComponent(item.slug))].filter(url => !process.argv[3] || url.startsWith(process.argv[3]));
    const failures = [];
    let checked = 0;
    for (const url of urls) {
      await page.locator('#preview').evaluate((iframe, next) => { iframe.src = '../' + next + (next.includes('?') ? '&' : '?') + 'admin-preview=1'; }, url);
      await frame.locator('[data-edit-inline]').first().waitFor();
      await frame.locator('body').evaluate(async () => { await document.fonts.ready; fitLayout(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.waitForTimeout(250); // Let the Studio's initial draft sync settle before hit-testing.
      await frame.locator('body').evaluate(body => body.addEventListener('click', event => {
        window.__lastClick = { path:event.target.closest('[data-edit-path]')?.dataset.editPath || '', x:event.clientX, y:event.clientY, scrollY };
      }, true));
      const fields = frame.locator('[data-edit-inline]');
      const count = await fields.count();
      for (let index = 0; index < count; index++) {
        const field = fields.nth(index);
        if (!await field.isVisible()) continue;
        const name = await field.getAttribute('data-edit-path');
        let before;
        try {
          await field.scrollIntoViewIfNeeded();
          const point = await field.evaluate(element => {
            const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
            if (!text?.textContent?.length) return undefined;
            const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1);
            const glyph = range.getBoundingClientRect(), box = element.getBoundingClientRect();
            return glyph.width && glyph.height ? { x:glyph.left - box.left + glyph.width / 2, y:glyph.top - box.top + glyph.height / 2 } : undefined;
          });
          before = await field.evaluate((element, point) => {
            const rect = element.getBoundingClientRect(), x = rect.x + (point?.x ?? rect.width / 2), y = rect.y + (point?.y ?? rect.height / 2);
            return { x, y, stack:document.elementsFromPoint(x,y).slice(0,3).map(node => node.closest('[data-edit-path]')?.dataset.editPath || '') };
          }, point);
          let selected = false;
          for (let attempt = 0; attempt < 4 && !selected; attempt++) {
            await field.click({ position:point, timeout:1500, force:true });
            selected = await page.waitForFunction(expected => [...document.querySelectorAll('#inspector [data-path]')].some(input => input.dataset.path === expected), name, { timeout:180 }).then(() => true, () => false);
          }
          assert.ok(selected, 'Field remained inaccessible after cycling overlapping elements');
          checked++;
        } catch (error) {
          const hit = await field.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { scrollY, rect:{ x:rect.x, y:rect.y, width:rect.width, height:rect.height }, stack:document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).slice(0, 6).map(node => ({ tag:node.tagName, path:node.closest('[data-edit-path]')?.dataset.editPath || '' })) };
          });
          const inspector = await page.locator('#inspector [data-path]').first().getAttribute('data-path').catch(() => 'none');
          const click = await frame.locator('body').evaluate(() => window.__lastClick);
          failures.push(`${url} ${name}: ${error.message.split('\n')[0]} before=${JSON.stringify(before)} hit=${JSON.stringify(hit)} click=${JSON.stringify(click)} selected=${inspector}`);
        }
      }
    }
    assert.deepEqual(failures, [], `${checked} selected, ${failures.length} failed`);
    console.log(`Editor selection OK: ${checked} visible text fields across ${urls.length} pages.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
