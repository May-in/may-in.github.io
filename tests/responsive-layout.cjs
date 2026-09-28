// Isolated browser only: no access to the real Studio session or its local draft.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname,'..');
const mime = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'};
const server = http.createServer(async(req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.resolve(root,'.'+(pathname.endsWith('/') ? pathname+'index.html' : pathname));
  if (!file.startsWith(root+path.sep)) return res.writeHead(403).end();
  try { res.writeHead(200,{'content-type':mime[path.extname(file)] || 'application/octet-stream'}).end(await fs.readFile(file)); }
  catch { res.writeHead(404).end(); }
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const base = 'http://localhost:'+server.address().port;
  const errors=[];
  try {
    const context = await browser.newContext();
    await context.route('**/*',route=> {
      if (route.request().url().startsWith(base) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(route.request().url())) return route.continue();
      return route.fulfill({status:200,contentType:'application/json',body:'{}'});
    });
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    const projects=JSON.parse(await fs.readFile(path.join(root,'content/projects.json'),'utf8')).projects;
    const paths=['index.html','projets.html','galerie.html','a-propos.html','contact.html','404.html',...projects.map(p=>'project.html?slug='+encodeURIComponent(p.slug))];
    let checks=0;
    for (const url of paths) {
      await page.setViewportSize({width:1440,height:900});
      await page.goto(base+'/'+url);
      await page.waitForFunction(()=>runtime.site && document.querySelector('[data-layout-item]'));
      await page.evaluate(()=>document.fonts.ready);
      for (const width of [1440,1024,980,844,768,390,320,1440]) {
        await page.setViewportSize({width,height:width<600?844:900});
        await page.evaluate(()=>{applyElementStyles(runtime.site);fitLayout();});
        await page.waitForTimeout(25);
        const result=await page.evaluate(()=>{
          const vw=document.documentElement.clientWidth;
          const bad=[...document.querySelectorAll('main img:not(.home-hero__background),[data-edit-inline],.project-category,.project-arrow')].filter(el=>el.getClientRects().length).map(el=>({path:el.dataset.editPath || el.className,x:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})).filter(el=>el.x < -1 || el.right > vw+1);
          return {width:vw,scroll:document.documentElement.scrollWidth,bad:bad.slice(0,5)};
        });
        assert.ok(result.scroll<=width+1 && !result.bad.length,JSON.stringify({url,width,...result}));
        checks++;
      }
    }
    // Extreme settings remain editable on desktop and collapse safely on compact screens.
    await page.goto(base+'/projets.html');
    await page.waitForFunction(()=>runtime.projects.length && document.querySelector('.project-cover-group'));
    await page.evaluate(()=>{updatePreviewValue('projects.0.width',200);updatePreviewValue('projects.0.offsetX',1200);updatePreviewValue('projects.0.offsetY',150);fitLayout();});
    const category=page.locator('.project-card').first().locator('.project-category');
    const categoryDelta=await category.evaluate(el=>el.getBoundingClientRect().top-el.previousElementSibling.getBoundingClientRect().bottom);
    await page.evaluate(()=>{updatePreviewValue('projects.0.offsetX',-1200);updatePreviewValue('projects.0.offsetY',-150);fitLayout();});
    assert.equal(await category.evaluate(el=>el.getBoundingClientRect().top-el.previousElementSibling.getBoundingClientRect().bottom),categoryDelta,'Category detached from image');
    await page.evaluate(()=>{
      const title=document.querySelector('.project-title-row h2');
      updatePreviewValue('site.elementStyles.'+title.dataset.editStyleId+'.offsetY',90);
      fitLayout();
    });
    assert.ok(await page.locator('.project-title-row').first().evaluate(el=>el.contains(el.querySelector('.project-arrow'))),'Arrow detached from title');
    // Stable styling survives reordering of media.
    await page.goto(base+'/project.html?slug='+projects[0].slug);
    await page.waitForFunction(()=>document.querySelector('figcaption[data-edit-style-id]'));
    const preserved=await page.evaluate(()=>{
      const caption=document.querySelector('figcaption[data-edit-style-id]');
      const id=caption.dataset.editStyleId,src=runtime.projects[0].media[0].src;
      updatePreviewValue('site.elementStyles.'+id+'.fontSize',33);
      updatePreviewValue('site.elementStyles.'+id+'.offsetX',1200);
      const media=runtime.projects[0].media;
      [media[0],media[1]]=[media[1],media[0]];
      renderAll(runtime.site,runtime.projects);
      return {id,src};
    });
    assert.equal(await page.locator('[data-edit-style-id="'+preserved.id+'"]').evaluate(el=>getComputedStyle(el).fontSize),'33px','Caption style lost on reorder');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{applyElementStyles(runtime.site);fitLayout();});
    const rows=await page.locator('.project-media').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})));
    rows.forEach((r,i)=>{assert.ok(r.left>=0 && r.right<=390,'Media off-screen');if(i)assert.ok(r.top>=rows[i-1].bottom-1,'Images or captions overlap on mobile');});
    // Same caption position in a different project must have a different identity.
    await page.goto(base+'/project.html?slug='+projects[1].slug);
    await page.waitForFunction(()=>document.querySelector('figcaption[data-edit-style-id]'));
    assert.notEqual(await page.locator('figcaption').first().getAttribute('data-edit-style-id'),preserved.id,'Shared caption identity across projects');
    // Hidden blocks must retain their actual path, and three chosen columns must share a row.
    await page.setViewportSize({width:1440,height:900});
    await page.goto(base+'/a-propos.html');
    await page.waitForFunction(()=>runtime.site);
    await page.evaluate(()=>{
      runtime.site.customBlocks.about=[{type:'text',text:'Hidden',hidden:true},{type:'text',text:'Visible',columnSpan:4},{type:'text',text:'Second',columnSpan:4},{type:'text',text:'Third',columnSpan:4}];
      renderAll(runtime.site,runtime.projects);fitLayout();
    });
    assert.equal(await page.locator('[data-edit-path="site.customBlocks.about.1.text"]').textContent(),'Visible','Hidden block shifted edit paths');
    const tops=await page.locator('[data-custom-blocks="about"] .custom-block').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().top));
    assert.ok(Math.max(...tops)-Math.min(...tops)<1,'Three columns did not share a row');
    // Device previews use real logical dimensions even when editor panels consume space.
    await page.goto(base+'/admin/');
    await page.locator('#studio:visible').waitFor();
    const preview=()=>page.frames().find(frame=>frame.parentFrame());
    await page.waitForFunction(()=>document.querySelector('#preview').contentWindow.innerWidth===1440);
    for(const [mode,width] of [['tablet',820],['mobile',390],['desktop',1440]]){
      await page.locator('[data-viewport="'+mode+'"]').click();
      await page.waitForFunction(w=>document.querySelector('#preview').contentWindow.innerWidth===w,width);
    }
    await page.locator('[data-viewport="mobile"]').click();
    await page.locator('#rotate-preview').click();
    await page.waitForFunction(()=>document.querySelector('#preview').contentWindow.innerWidth===844);
    await page.locator('[data-viewport="desktop"]').click();
    await page.locator('#project-list [data-project-index="0"]').first().click();
    await preview().waitForSelector('figcaption[data-edit-inline]');
    await preview().locator('figcaption[data-edit-inline]').first().click();
    const font=page.locator('#inspector [data-path$=".fontFamily"]');
    await font.selectOption('mono');
    const captionSize=page.locator('#inspector [data-path$=".fontSize"]');
    await captionSize.fill('31');
    await preview().waitForFunction(()=>getComputedStyle(document.querySelector('figcaption[data-edit-inline]')).fontSize==='31px');
    await page.waitForFunction(()=>localStorage.getItem('mayin-studio-draft'));
    const savedDraft=await page.evaluate(()=>JSON.parse(localStorage.getItem('mayin-studio-draft')));
    await page.reload();
    await page.locator('#studio:visible').waitFor();
    const restoredDraft=await page.evaluate(()=>JSON.parse(localStorage.getItem('mayin-studio-draft')));
    assert.deepEqual(restoredDraft.projects,savedDraft.projects,'Reload changed draft projects');
    assert.deepEqual(restoredDraft.site.elementStyles,savedDraft.site.elementStyles,'Reload changed draft styles');
    assert.ok(!errors.length,errors.join('\n'));
    console.log('Responsive OK: '+checks+' page/viewport checks, oversized images, linked categories, arrows, caption reordering and mobile stacking.');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
