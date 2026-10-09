// Run with: node tests/studio-regression.cjs <absolute path to playwright module>
// Uses an isolated headless browser and a read-only local web server.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon' };
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
  if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await fs.readFile(target);
    response.writeHead(200, { 'content-type': `${mime[path.extname(target)] || 'application/octet-stream'}; charset=utf-8` }).end(bytes);
  } catch { response.writeHead(404).end(); }
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:900} });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://localhost:${server.address().port}/admin/`);
    await page.locator('#studio:visible').waitFor();
    const frame = page.frameLocator('#preview');
    const text = frame.locator('[data-edit-path="site.homeAboutText"]');
    await text.waitFor();
    await page.waitForTimeout(350);
    const initial = await text.textContent();
    assert.ok(initial.startsWith('Chaque projet'));
    await text.evaluate((element) => { element.dataset.testIdentity = 'same-node'; });
    // Put the pointer near a character in the middle, not at the start.
    await text.evaluate((element) => element.scrollIntoView({ block:'center', behavior:'instant' }));
    await page.waitForTimeout(250);
    const point = await text.evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild, 24); range.setEnd(element.firstChild, 25);
      const rect = range.getBoundingClientRect();
      const host = element.getBoundingClientRect();
      return { x:rect.left - host.left + 1, y:rect.top - host.top + rect.height / 2 };
    });
    await text.click({ position:point, force:true });
    await page.waitForTimeout(150);
    const caret = await text.evaluate(() => window.getSelection()?.anchorOffset);
    assert.ok(caret > 5, `Cursor jumped to beginning: offset ${caret}`);
    await page.keyboard.type('TEST', { delay:35 });
    await page.waitForTimeout(750);
    const edited = await text.textContent();
    assert.ok(edited.startsWith('Chaque projet'), `Unexpected beginning: ${edited}`);
    assert.ok(edited.indexOf('TEST') > 5 && edited.indexOf('TEST') < initial.length - 5, `Typing did not stay at the clicked position: ${edited}`);
    assert.equal(await text.getAttribute('data-test-identity'), 'same-node', 'Typing rebuilt the preview node');
    const size = page.locator('#inspector [data-path$=".fontSize"]');
    await size.fill('44');
    await page.waitForTimeout(120);
    assert.equal(await text.evaluate((element) => getComputedStyle(element).fontSize), '44px', 'Text size was not previewed live');
    assert.equal(await text.getAttribute('data-test-identity'), 'same-node', 'Style input rebuilt the preview node');
    await page.locator('#undo').click();
    await page.waitForTimeout(150);
    assert.notEqual(await text.evaluate((element) => getComputedStyle(element).fontSize), '44px', 'Undo failed');
    await page.locator('#undo').click();
    await page.waitForTimeout(150);
    assert.equal(await text.textContent(), initial, 'Undo did not restore the edited text');

    // Editorial blocks must obey the same typography control as ordinary text.
    const headline = frame.locator('[data-edit-path="site.customBlocks.home.0.text"]');
    await headline.click({ force:true });
    const headlineSize = page.locator('#inspector [data-path="site.customBlocks.home.0.fontSize"]');
    await headlineSize.waitFor();
    const headlineBefore = await headline.evaluate(element => getComputedStyle(element).fontSize);
    await headlineSize.fill('72');
    await page.waitForTimeout(120);
    assert.equal(await headline.evaluate(element => getComputedStyle(element).fontSize), '72px', 'Editorial block size is masked by a broader paragraph rule');
    assert.notEqual(headlineBefore, '72px');
    await page.locator('#undo').click();

    const wordmark = frame.locator('.wordmark [data-edit-path="site.name"]');
    await wordmark.click();
    await page.locator('#inspector [data-path="site.name"]').waitFor();
    await page.locator('#inspector [data-path="site.name"]').fill('May’in TEST');
    await page.waitForTimeout(100);
    assert.equal(await wordmark.textContent(), 'May’in TEST', 'Site name was not previewed live');
    await frame.locator('.navigation [data-edit-path="site.navigation.0.label"]').click();
    await page.locator('#inspector [data-path="site.navigation.0.label"]').waitFor();
    assert.equal(await page.locator('#inspector [data-path$=".width"]').count(), 0, 'Navigation still offers a width control that splits short labels');

    await page.locator('#project-list [data-project-index="0"]').first().click();
    const projectTitle = frame.locator('[data-edit-path="projects.0.title"]');
    await projectTitle.click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#inspector [data-path="projects.0.title"]').count(), 1, 'Project title editor missing');
    assert.ok(await page.locator('#inspector [data-path$=".fontFamily"]').count(), 'Project title typography missing');
    const media = frame.locator('[data-edit-path="projects.0.media.0"]');
    await media.waitFor();
    await media.click();
    const before = await media.locator('img').evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
    await page.locator('#inspector [data-choice-path="projects.0.media.0.radius"][data-choice-value="all"]').click();
    await page.waitForTimeout(150);
    const after = await media.locator('img').evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
    assert.notEqual(after, before, 'Rounded corners were not previewed live');
    const cover = frame.locator('[data-edit-path="projects.0.cover"]');
    await cover.click();
    const coverBefore = await cover.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
    await page.locator('#inspector [data-choice-path="projects.0.coverRadius"][data-choice-value="all"]').click();
    await page.waitForTimeout(100);
    const coverAfter = await cover.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
    assert.equal(coverAfter, coverBefore, 'Changing thumbnail corners also changed the project cover');
    await page.locator('#inspector [data-choice-path="projects.0.heroPresentation.radius"][data-choice-value="all"]').click();
    await page.waitForTimeout(100);
    assert.notEqual(await cover.evaluate(element => getComputedStyle(element).borderTopLeftRadius), coverBefore, 'Project cover corners were not previewed live');
    const heroFrame = frame.locator('.project-hero__visual');
    await page.locator('#inspector [data-path="projects.0.width"]').fill('150');
    assert.equal(await heroFrame.evaluate(element => element.style.getPropertyValue('--layout-width')), '100%', 'Thumbnail width changed the project page cover');
    await page.locator('#inspector [data-path="projects.0.heroPresentation.width"]').fill('85');
    await page.waitForFunction(() => document.querySelector('#preview').contentDocument.querySelector('.project-hero__visual')?.style.getPropertyValue('--layout-width') === '85%');
    assert.equal(await heroFrame.evaluate(element => element.style.getPropertyValue('--layout-width')), '85%', 'Project cover width did not update independently');
    assert.equal(await frame.locator('body').evaluate(() => runtime.projects[0].width), 150, 'Changing project cover width changed the thumbnail');
    await page.locator('#page-list [data-page="gallery"]').click();
    await frame.locator('[data-custom-blocks="gallery"] .custom-block').first().waitFor();
    const arrangement = page.locator('#inspector [data-arrange-images="site.customBlocks.gallery"][data-columns="4"]');
    await arrangement.waitFor();
    assert.match(await page.locator('#inspector').innerText(), /Le curseur vertical ajuste une image/, 'Gallery page does not explain the difference between placement and line composition');
    const previousGallery = await frame.locator('body').evaluate(() => JSON.stringify(runtime.site.customBlocks.gallery));
    await arrangement.click();
    await page.waitForFunction(() => {
      const images=[...document.querySelector('#preview').contentDocument.querySelectorAll('[data-custom-blocks="gallery"] .custom-block')];
      return images.length === 4 && images.every(image => image.style.getPropertyValue('--block-span') === '3');
    });
    await frame.locator('[data-custom-blocks="gallery"] .custom-block').first().waitFor();
    const imageRows = await frame.locator('[data-custom-blocks="gallery"] .custom-block').evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().top)));
    assert.equal(new Set(imageRows).size, 1, 'Four editorial gallery images did not share one grid row');
    await page.locator('#page-list [data-page="gallery"]').click();
    await page.locator('#inspector [data-add-block="image"][data-block-base="site.customBlocks.gallery"]').click();
    await page.locator('#image-input').setInputFiles(path.join(root, 'favicon.png'));
    await page.waitForFunction(() => document.querySelector('#preview').contentDocument.querySelectorAll('[data-custom-blocks="gallery"] .custom-block--image').length === 5);
    assert.equal(await frame.locator('[data-custom-blocks="gallery"] .custom-block--image').last().evaluate(item => item.style.getPropertyValue('--block-span')), '3', 'A new image did not inherit the section’s four-column layout');
    await page.locator('#undo').click();
    await page.locator('#undo').click();
    await page.waitForTimeout(200);
    assert.equal(await frame.locator('body').evaluate(() => JSON.stringify(runtime.site.customBlocks.gallery)), previousGallery, 'Arranging images could not be undone');
    assert.ok(!errors.length, `Browser errors: ${errors.join('; ')}`);
    const publicPage = await browser.newPage();
    const visits = [];
    await publicPage.route('https://mayin-admin.maycelia29.workers.dev/public/visit', (route) => {
      visits.push(route.request().postDataJSON());
      return route.fulfill({ status:200, contentType:'application/json', body:'{}' });
    });
    await publicPage.goto(`http://localhost:${server.address().port}/`);
    await publicPage.evaluate(() => localStorage.setItem('mayin-anonymous-visit', JSON.stringify({ id:'old-browser-id', lastSeen:Date.now() })));
    const nextVisit = publicPage.waitForRequest((request) => request.url().endsWith('/public/visit'));
    await publicPage.reload();
    await nextVisit;
    assert.equal(await publicPage.evaluate(() => localStorage.getItem('mayin-anonymous-visit')), null, 'Obsolete visitor ID remained in browser storage');
    assert.ok(visits.length >= 2 && !('sessionId' in visits.at(-1)), 'Analytics still transmitted a browser visitor ID');
    await publicPage.goto(`http://localhost:${server.address().port}/projets.html`);
    await publicPage.locator('.project-card').first().waitFor();
    await publicPage.locator('[data-filter="public"]').click();
    assert.equal(await publicPage.locator('[data-filter="public"]').getAttribute('aria-pressed'), 'true');
    await publicPage.evaluate(() => { for (let index = 0; index < 5; index++) renderAll(runtime.site, runtime.projects); });
    assert.equal(await publicPage.locator('.filter.is-active').getAttribute('data-filter'), 'public', 'Rerender lost the chosen filter');
    assert.equal(await publicPage.locator('.project-card:not(.is-hidden)').count(), await publicPage.locator('.project-card[data-category="public"]').count(), 'Rerender displayed projects outside the chosen category');
    await publicPage.locator('[data-filter="prive"]').click();
    assert.equal(await publicPage.locator('[data-filter="prive"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await publicPage.locator('[data-filter="public"]').getAttribute('aria-pressed'), 'false');
    assert.equal(await publicPage.locator('.project-card:not(.is-hidden)').count(), await publicPage.locator('.project-card[data-category="prive"]').count());
    console.log('Regression OK: Studio editing, live preview and undo; anonymous analytics without browser identifier.');
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
