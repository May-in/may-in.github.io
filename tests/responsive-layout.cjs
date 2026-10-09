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
      assert.match(await fs.readFile(path.join(root,url.split('?')[0]),'utf8'), /<link rel="stylesheet" href="dynamic\.css\?v=20"/, 'Composition stylesheet must load from HTML before JavaScript: '+url);
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
    // The home headline keeps its intended order on compact screens; navigation colors follow their background.
    await page.goto(base+'/index.html');
    await page.waitForFunction(()=>runtime.site && document.querySelector('.home-intro [data-custom-blocks="home"] .custom-block'));
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>fitLayout());
    const homeOrder=await page.evaluate(()=>{
      const intro=document.querySelector('.home-intro');
      return {
        eyebrow:intro.querySelector(':scope > .eyebrow').getBoundingClientRect().top,
        headline:intro.querySelector('.custom-block--mobile-before').getBoundingClientRect().top,
        copy:intro.querySelector(':scope > div:not([data-custom-blocks])').getBoundingClientRect().top
      };
    });
    assert.ok(homeOrder.eyebrow<homeOrder.headline && homeOrder.headline<homeOrder.copy,'Home custom headline is not before the intro text on mobile');
    await page.evaluate(()=>{updatePreviewValue('site.customBlocks.home.0.offsetY',100);fitLayout();});
    assert.equal(await page.locator('.home-intro .custom-block--mobile-before').count(),1,'Changing visual position changed mobile reading order');
    const navColors=await page.evaluate(()=>{
      const bar=document.querySelector('.topbar'),nav=document.querySelector('.navigation');
      const link=nav.querySelector('a:not([aria-current])');
      bar.classList.remove('is-scrolled');const hero=getComputedStyle(link).color;
      bar.classList.add('is-scrolled');const scrolled=getComputedStyle(link).color;
      bar.classList.remove('is-scrolled');nav.classList.add('is-open');const open=getComputedStyle(link).color;
      return {hero,scrolled,open,ink:getComputedStyle(document.body).color};
    });
    assert.notEqual(navColors.hero,navColors.scrolled,'Home navigation color does not adapt after scrolling');
    assert.equal(navColors.open,navColors.ink,'Mobile menu text is not dark on its light panel');
    await page.setViewportSize({width:844,height:900});
    const navWord = await page.evaluate(() => {
      const link=document.querySelector('.navigation a');
      link.style.setProperty('--layout-width','20%'); fitLayout();
      const style=getComputedStyle(link), rect=link.getBoundingClientRect(), range=document.createRange();
      range.selectNodeContents(link);
      return {whiteSpace:style.whiteSpace, lines:range.getClientRects().length, right:rect.right};
    });
    assert.equal(navWord.whiteSpace,'nowrap','Navigation label can split inside a word');
    assert.ok(navWord.lines === 1 && navWord.right <= 844,'Navigation label wraps or overflows after narrowing its control');

    // The gallery can use narrower desktop spans while remaining a one-column mobile layout.
    await page.goto(base+'/galerie.html');
    await page.waitForFunction(()=>runtime.site && document.querySelector('#gallery-grid'));
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>{
      runtime.site.gallery.items=Array.from({length:4},(_,index)=>({src:'assets/social-preview.png',alt:'',caption:'Test '+index,category:'Test',size:'small',columnSpan:3,radius:'none'}));
      renderGallery(runtime.site);bindContentLayout();fitLayout();
    });
    const desktopRows=await page.locator('.gallery-grid .gallery-item').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().top));
    assert.equal(new Set(desktopRows.map(top=>Math.round(top))).size,1,'Four narrow gallery images do not fit on one desktop row');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>fitLayout());
    const mobileRows=await page.locator('.gallery-grid .gallery-item').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right}}));
    mobileRows.forEach((row,index)=>{assert.ok(row.left>=0&&row.right<=390,'Gallery image overflows mobile');if(index)assert.ok(row.top>mobileRows[index-1].top,'Gallery images did not stack on mobile');});

    // The same grid contract applies to editorial image blocks, which hold the published gallery images.
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>{
      runtime.site.customBlocks.gallery.filter(item=>item.type==='image').forEach(item=>{item.columnSpan=3;item.width=100;item.offsetX=0;item.offsetY=0;item.positionY=0;});
      renderAll(runtime.site,runtime.projects);fitLayout();
    });
    const editorialDesktop=await page.locator('[data-custom-blocks="gallery"] .custom-block--image').evaluateAll(items=>items.map(item=>Math.round(item.getBoundingClientRect().top)));
    assert.equal(new Set(editorialDesktop).size,1,'Four editorial gallery images do not share one desktop row');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>fitLayout());
    const editorialMobile=await page.locator('[data-custom-blocks="gallery"] .custom-block--image').evaluateAll(items=>items.map(item=>{const rect=item.getBoundingClientRect();return {top:rect.top,left:rect.left,right:rect.right}}));
    editorialMobile.forEach((item,index)=>{assert.ok(item.left>=0&&item.right<=390,'Editorial image overflows mobile');if(index)assert.ok(item.top>editorialMobile[index-1].top,'Editorial images did not stack on mobile');});

    // Project galleries use the same narrow-column grid and remain stacked on mobile.
    await page.goto(base+'/project.html?slug='+encodeURIComponent(projects[0].slug));
    await page.waitForFunction(()=>runtime.projects.length && document.querySelector('.project-gallery'));
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>{
      runtime.projects[0].width=180;runtime.projects[0].offsetX=220;runtime.projects[0].objectPosition='left';
      renderAll(runtime.site,runtime.projects);fitLayout();
    });
    const independentHero=await page.locator('.project-hero__visual').evaluate(el=>({width:el.style.getPropertyValue('--layout-width'),position:getComputedStyle(el.querySelector('img')).objectPosition,left:el.getBoundingClientRect().left}));
    assert.equal(independentHero.width,'100%','Thumbnail width leaked into the project cover');
    assert.equal(independentHero.position,'50% 50%','Thumbnail crop leaked into the project cover');
    await page.evaluate(()=>{
      runtime.projects[0].media=Array.from({length:4},(_,index)=>({src:'assets/social-preview.png',alt:'',caption:'Projet '+index,kind:'detail',format:'landscape',columnSpan:3,width:100}));
      renderAll(runtime.site,runtime.projects);fitLayout();
    });
    const projectDesktopRows=await page.locator('.project-gallery .project-media').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().top));
    assert.equal(new Set(projectDesktopRows.map(top=>Math.round(top))).size,1,'Four narrow project images do not fit on one desktop row');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>fitLayout());
    const projectMobileRows=await page.locator('.project-gallery .project-media').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right}}));
    projectMobileRows.forEach((row,index)=>{assert.ok(row.left>=0&&row.right<=390,'Project image overflows mobile');if(index)assert.ok(row.top>=projectMobileRows[index-1].bottom-1,'Project images or captions overlap on mobile');});

    // Horizontal movement can use the About section's visible side padding without leaving the viewport.
    await page.goto(base+'/a-propos.html');
    await page.waitForFunction(()=>document.querySelector('.about-page__content .lead'));
    await page.setViewportSize({width:1440,height:900});
    const aboutBounds=await page.locator('.about-page__content .lead').evaluate(el=>{
      const canvas=el.parentElement.closest('.about-page__content'),style=getComputedStyle(canvas),rect=canvas.getBoundingClientRect();
      return {available:layoutBounds(el).left,contentStart:rect.left+parseFloat(style.paddingLeft)};
    });
    assert.ok(aboutBounds.available<aboutBounds.contentStart,'About movement bounds still exclude the visible section padding');

    // Extreme settings remain editable on desktop and collapse safely on compact screens.
    await page.goto(base+'/projets.html');
    await page.waitForFunction(()=>runtime.projects.length && document.querySelector('.project-cover-group'));
    await page.evaluate(()=>{updatePreviewValue('projects.0.width',200);updatePreviewValue('projects.0.offsetX',1200);updatePreviewValue('projects.0.offsetY',150);updatePreviewValue('projects.0.objectPosition','left');fitLayout();});
    assert.equal(await page.locator('.project-card .project-image img').first().evaluate(el=>getComputedStyle(el).objectPosition),'0% 50%','Thumbnail crop control has no visible effect');
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
    await page.locator('#project-list [data-project-media-index="0"]').first().click();
    const projectSpans=await page.locator('#inspector select[data-path$=".columnSpan"] option').evaluateAll(options=>options.map(option=>option.value));
    assert.ok(projectSpans.includes('3')&&projectSpans.includes('2')&&projectSpans.includes('1'),'Project media is still limited to three images per row');
    await page.locator('#inspector [data-choice-path$=".radius"][data-choice-value="all"]').click();
    await preview().waitForFunction(()=>getComputedStyle(document.querySelector('.project-media img')).borderTopLeftRadius==='36px');
    await page.locator('#inspector textarea[data-path$=".caption"]').fill('0123456789');
    await page.locator('#project-list [data-project-index="0"]').first().click();
    await preview().waitForSelector('figcaption[data-edit-inline]');
    const editableCaption=preview().locator('figcaption[data-edit-inline]').first();
    await preview().waitForFunction(()=>document.querySelector('figcaption[data-edit-inline]')?.contentEditable==='plaintext-only');
    await editableCaption.click({position:{x:16,y:7}});
    const caretState=()=>preview().evaluate(()=>{
      const el=document.querySelector('figcaption[data-edit-inline]'),selection=getSelection();
      if(!el||!selection?.rangeCount||!el.contains(selection.anchorNode))return{offset:-1,text:el?.textContent||'',node:''};
      const range=document.createRange();range.selectNodeContents(el);range.setEnd(selection.anchorNode,selection.anchorOffset);
      return{offset:range.toString().length,text:el.textContent,node:selection.anchorNode.nodeName,localOffset:selection.anchorOffset};
    });
    const caretBeforeState=await caretState(),caretBefore=caretBeforeState.offset;
    assert.ok(caretBefore>0&&caretBefore<10,'Inline text click did not place the caret at the clicked position: '+JSON.stringify(caretBeforeState));
    await page.keyboard.type('XY');
    await preview().waitForFunction(()=>document.querySelector('figcaption[data-edit-inline]')?.textContent.length===12);
    await preview().evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const caretAfterState=await caretState(),caretAfter=caretAfterState.offset;
    assert.equal(caretAfter,caretBefore+2,'Typing moved the caret away from the insertion point: '+JSON.stringify({before:caretBeforeState,after:caretAfterState}));
    assert.equal(caretAfterState.text,'0123XY456789','Consecutive letters were not inserted in order at the clicked position');
    await page.locator('#undo').click();
    await preview().waitForFunction(()=>document.querySelector('figcaption[data-edit-inline]')?.textContent==='0123456789');
    await page.locator('#redo').click();
    await preview().waitForFunction(()=>document.querySelector('figcaption[data-edit-inline]')?.textContent.length===12);
    await page.waitForFunction(()=>{try{return JSON.parse(localStorage.getItem('mayin-studio-draft'))?.projects?.[0]?.media?.[0]?.caption==='0123XY456789'}catch{return false}});
    await editableCaption.click();
    const font=page.locator('#inspector [data-path$=".fontFamily"]');
    await font.selectOption('mono');
    const captionSize=page.locator('#inspector [data-path$=".fontSize"]');
    await captionSize.fill('31');
    await preview().waitForFunction(()=>getComputedStyle(document.querySelector('figcaption[data-edit-inline]')).fontSize==='31px');
    await page.waitForFunction(()=>{try{return Object.values(JSON.parse(localStorage.getItem('mayin-studio-draft'))?.site?.elementStyles||{}).some(style=>style.fontFamily==='mono'&&Number(style.fontSize)===31)}catch{return false}});
    const savedDraft=await page.evaluate(()=>JSON.parse(localStorage.getItem('mayin-studio-draft')));
    await page.reload();
    await page.locator('#studio:visible').waitFor();
    const restoredDraft=await page.evaluate(()=>JSON.parse(localStorage.getItem('mayin-studio-draft')));
    assert.deepEqual(restoredDraft.projects,savedDraft.projects,'Reload changed draft projects');
    for(const [id,style] of Object.entries(savedDraft.site.elementStyles)){const restored=restoredDraft.site.elementStyles[id]||{};assert.deepEqual(Object.fromEntries(Object.keys(style).map(key=>[key,restored[key]])),style,'Reload changed existing draft style '+id);}
    assert.ok(!errors.length,errors.join('\n'));
    console.log('Responsive OK: '+checks+' page/viewport checks, oversized images, linked categories, arrows, caption reordering and mobile stacking.');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
