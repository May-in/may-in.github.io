// Isolated browser with local files and mocked external requests; no live writes.
// node tests/seo-metadata.cjs <absolute path to playwright>
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};

(async () => {
  const site = JSON.parse(await fs.readFile(path.join(root, 'content/site.json'), 'utf8'));
  const projects = JSON.parse(await fs.readFile(path.join(root, 'content/projects.json'), 'utf8')).projects;
  const base = site.domain.replace(/\/$/, '');
  const template = await fs.readFile(path.join(root, 'project.html'), 'utf8');
  assert.ok(!/<link[^>]+rel="canonical"/.test(template), 'Generic project template contains a misleading canonical');
  assert.ok(!/content="noindex/.test(template), 'Initial noindex would prevent Google rendering valid projects');
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const page = await browser.newPage(); const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    let failContent = false;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://mayin.test') return route.fulfill({status:200, contentType:'application/json', body:'{}'});
      if (failContent && url.pathname === '/content/projects.json') return route.fulfill({status:503,body:''});
      const target = path.resolve(root, '.' + (url.pathname.endsWith('/') ? url.pathname+'index.html' : url.pathname));
      assert.ok(target.startsWith(root+path.sep));
      try { return route.fulfill({status:200,contentType:mime[path.extname(target)] || 'application/octet-stream',body:await fs.readFile(target)}); }
      catch { return route.fulfill({status:404,body:''}); }
    });
    const go = async url => {
      await page.goto('https://mayin.test/'+url);
      await page.waitForFunction(() => runtime.site !== null);
    };
    const metadata = () => page.evaluate(() => {
      const meta = (a,k) => document.querySelector(`meta[${a}="${k}"]`)?.content;
      return {title:document.title, canonical:[...document.querySelectorAll('link[rel="canonical"]')].map(el=>el.href),
        description:meta('name','description'),robots:meta('name','robots'),ogUrl:meta('property','og:url'),
        ogTitle:meta('property','og:title'),twitterTitle:meta('name','twitter:title'),
        ogDescription:meta('property','og:description'),twitterDescription:meta('name','twitter:description'),
        ogImage:meta('property','og:image'),twitterImage:meta('name','twitter:image')};
    });
    for (const url of ['', 'index.html', 'index.html?utm_source=test']) {
      await go(url); const m=await metadata();
      assert.deepEqual(m.canonical, [base+'/'], 'Home canonical changed from source HTML');
      assert.equal(m.ogUrl, base+'/'); assert.equal(m.title, site.seoTitle);
      assert.equal(m.description, site.seoDescription);
      assert.equal(m.ogTitle,m.title); assert.equal(m.twitterTitle,m.title);
      assert.equal(m.ogDescription,m.description); assert.equal(m.twitterDescription,m.description);
    }
    for (const file of ['projets.html','galerie.html','a-propos.html','contact.html']) {
      const source = await fs.readFile(path.join(root,file),'utf8');
      const description = source.match(/<meta name="description" content="([^"]*)"/)[1];
      await go(file+'?utm_source=test'); const m=await metadata();
      assert.deepEqual(m.canonical,[base+'/'+file]); assert.equal(m.ogUrl,base+'/'+file);
      assert.equal(m.description,description, file+' lost its page-specific description');
      assert.equal(m.ogDescription,description); assert.equal(m.twitterDescription,description);
      assert.equal(m.ogTitle,m.title); assert.equal(m.twitterTitle,m.title);
    }
    for (const project of projects) {
      const url='project.html?slug='+encodeURIComponent(project.slug);
      await go(url+'&utm_source=test'); const m=await metadata();
      assert.deepEqual(m.canonical,[base+'/'+url]); assert.equal(m.ogUrl,base+'/'+url);
      assert.equal(m.title,project.title+' — '+site.name);
      assert.equal(m.description,project.title+' — '+project.description);
      assert.equal(m.ogTitle,m.title); assert.equal(m.twitterTitle,m.title);
      assert.equal(m.ogDescription,project.description); assert.equal(m.twitterDescription,project.description);
      assert.ok(!m.robots.includes('noindex'));
      if(project.cover) assert.equal(m.twitterImage,new URL(project.cover,base+'/').href);
      assert.equal(m.ogImage,m.twitterImage);
      const schema=await page.locator('#project-structured-data').textContent();
      assert.equal(JSON.parse(schema).url,m.canonical[0]);
    }
    for (const url of ['project.html','project.html?slug=not-a-real-project']) {
      await go(url); const m=await metadata();
      assert.deepEqual(m.canonical,[]); assert.equal(m.robots,'noindex,follow');
      assert.equal(m.title,'Projet introuvable — '+site.name);
      assert.equal(await page.locator('#project-structured-data').count(),0);
    }
    // A restored project in the Studio must not keep the previous missing-state noindex.
    await page.evaluate(projects => { history.replaceState(null,'','?slug='+encodeURIComponent(projects[0].slug)); renderAll(runtime.site,projects); }, projects);
    assert.ok(!(await metadata()).robots.includes('noindex'));
    assert.equal((await metadata()).canonical.length,1);
    // Temporary network failures are NOT evidence that a project was deleted.
    failContent = true;
    await page.goto('https://mayin.test/project.html?slug='+encodeURIComponent(projects[0].slug));
    await page.locator('.content-error').waitFor();
    assert.ok(!(await metadata()).robots?.includes('noindex'));
    assert.deepEqual(errors,[]);
    console.log(`SEO OK: home aliases, 4 page descriptions, ${projects.length} distinct project canonicals/social metadata, missing projects and transient failure.`);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
