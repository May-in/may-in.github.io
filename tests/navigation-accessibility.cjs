// No real browser profile, drafts or API calls. All site responses are local.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if(url.origin !== 'https://mayin.test') return route.fulfill({status:200,contentType:'application/json',body:'{}'});
      const file = path.resolve(root,'.'+(url.pathname.endsWith('/') ? url.pathname+'index.html' : url.pathname));
      assert.ok(file.startsWith(root+path.sep));
      try { return route.fulfill({status:200,contentType:mime[path.extname(file)] || 'application/octet-stream',body:await fs.readFile(file)}); }
      catch { return route.fulfill({status:404,body:''}); }
    });
    const toggle=page.locator('.menu-toggle'), nav=page.locator('#navigation');
    const expanded=()=>toggle.getAttribute('aria-expanded');
    const active=()=>page.evaluate(()=>document.activeElement.className);
    const open=async()=>{await toggle.focus();await page.keyboard.press('Enter');assert.equal(await expanded(),'true');};
    const pages=['index.html','projets.html','galerie.html','a-propos.html','contact.html','project.html?slug=moooi-stand-commercial'];
    for(const url of pages) {
      await page.goto('https://mayin.test/'+url);await page.waitForFunction(()=>runtime.site !== null);
      assert.equal(await toggle.getAttribute('aria-controls'),'navigation');
      assert.equal(await nav.getAttribute('aria-label'),'Navigation principale');
      assert.equal(await nav.isVisible(),false);
      await page.keyboard.press('Tab');
      assert.equal(await active(),'skip-link','Skip link must be the first keyboard stop');
      const skipRect=await page.locator('.skip-link').boundingBox();
      assert.ok(skipRect.y >= 0 && skipRect.x >= 0,'Focused skip link is not visible');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>document.activeElement.tagName),'MAIN','Skip link did not move focus beyond navigation');
      await open(); await page.keyboard.press('Tab');
      assert.ok((await nav.locator('a').first().boundingBox()).height >= 44,'Navigation link is too small to tap');
      assert.equal(await page.evaluate(()=>document.activeElement.parentElement.id),'navigation');
      await page.keyboard.press('Escape');
      assert.equal(await expanded(),'false');assert.equal(await active(),'menu-toggle');
      assert.equal(await nav.isVisible(),false);
      await open();
      await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');
      assert.equal(await expanded(),'false','Menu remained open after keyboard focus left it');
      await open();
      await page.mouse.click(5,30); // Empty header margin, outside both menu and toggle.
      assert.equal(await expanded(),'false','Outside tap did not close menu');
      assert.ok((await toggle.boundingBox()).height >= 44,'Mobile menu target is too small');
      // Selection in the Studio prevents navigation; it must not hide the selected link.
      await open();
      await nav.evaluate(el=>{
        el.addEventListener('click',e=>e.preventDefault(),{capture:true,once:true});
        el.querySelector('a').click();
      });
      assert.equal(await expanded(),'true','Cancelled edit click closed menu');
      await page.keyboard.press('Escape');
    }
    await open();await page.keyboard.press('Tab');
    await page.setViewportSize({width:1200,height:900});await page.waitForTimeout(100);
    assert.equal(await nav.isVisible(),true);assert.equal(await expanded(),'false');
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
    assert.equal(await nav.isVisible(),false);assert.equal(await active(),'menu-toggle');
    await page.setViewportSize({width:1200,height:900});await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>document.activeElement.parentElement.id),'navigation','Focus stayed on hidden menu button');
    await page.setViewportSize({width:600,height:240});await page.waitForTimeout(100);await open();
    const rect=await nav.boundingBox();assert.ok(rect.y+rect.height <= 240,'Menu exceeds short landscape viewport');
    const menuSize=await nav.evaluate(el=>({scroll:el.scrollHeight,height:el.clientHeight,links:el.querySelectorAll('a').length,css:getComputedStyle(el).maxHeight}));
    assert.ok(menuSize.scroll > menuSize.height,'Expected short viewport to scroll: '+JSON.stringify(menuSize));
    await nav.locator('a').last().focus();
    assert.ok(await nav.evaluate(el=>el.scrollTop > 0),'Last link cannot be reached in landscape');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
    assert.deepEqual(errors,[]);
    console.log('Navigation OK: 6 templates, skip-to-content, keyboard/Escape, outside tap, Studio cancelled selection, responsive focus, short-screen scrolling and reduced motion.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
