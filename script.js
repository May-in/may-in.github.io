const topbar = document.querySelector('.topbar');
const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.navigation');
const page = document.body.dataset.page;
const BUILD_VERSION = '1.6.0';
const previewParams = new URLSearchParams(location.search);
const isAdminPreview = previewParams.get('admin-preview') === '1' && window.parent !== window;
let previewEditMode = true;
let previewReadySent = false;
let runtime = { site: null, projects: [] };

document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="dynamic.css?v=15"><link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="manifest" href="site.webmanifest">');

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
const getJson = async (path) => { const response = await fetch(path, { cache: 'no-store' }); if (!response.ok) throw new Error('Contenu indisponible'); return response.json(); };
const assetSrc = (value = '') => String(value).startsWith('data:') || String(value).startsWith('blob:') ? value : encodeURI(value);
const safeToken = (value, fallback) => /^[a-z0-9-]+$/i.test(String(value || '')) ? String(value) : fallback;
function upsertMeta(attribute, key, content) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) { element = document.createElement('meta'); element.setAttribute(attribute, key); document.head.append(element); }
  element.setAttribute('content', content || '');
}

function setCanonical(url) {
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.append(link); }
  link.href = url;
}

addEventListener('scroll', () => topbar?.classList.toggle('is-scrolled', scrollY > 30), { passive: true });
const mobileNavigation = matchMedia('(max-width:760px)');
let lastNavigationFocus = null;
function setMenuOpen(open, restoreFocus = false) {
  if (!navigation || !menuToggle) return;
  navigation.classList.toggle('is-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.lastChild.textContent = open ? ' −' : ' +';
  if (restoreFocus) menuToggle.focus({ preventScroll:true });
}
menuToggle?.addEventListener('click', () => setMenuOpen(!navigation.classList.contains('is-open')));
navigation?.addEventListener('click', (event) => {
  // Selecting editable navigation text in the Studio must not close the panel.
  if (event.defaultPrevented || !event.target.closest('a')) return;
  setMenuOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && mobileNavigation.matches && navigation?.classList.contains('is-open')) {
    event.preventDefault(); setMenuOpen(false, true);
  }
});
document.addEventListener('pointerdown', (event) => {
  if (mobileNavigation.matches && navigation?.classList.contains('is-open') &&
      !navigation.contains(event.target) && !menuToggle.contains(event.target)) {
    setMenuOpen(false, navigation.contains(document.activeElement));
  }
});
document.addEventListener('focusin', (event) => {
  lastNavigationFocus = navigation?.contains(event.target) || event.target === menuToggle ? event.target : null;
  if (mobileNavigation.matches && navigation?.classList.contains('is-open') &&
      !navigation.contains(event.target) && !menuToggle.contains(event.target)) setMenuOpen(false);
});
mobileNavigation.addEventListener('change', () => {
  if (!navigation || !menuToggle) return;
  // CSS may hide the focused link before the media-query change event runs.
  const focus = document.activeElement === document.body ? lastNavigationFocus : document.activeElement;
  setMenuOpen(false, mobileNavigation.matches && navigation.contains(focus));
  if (!mobileNavigation.matches && focus === menuToggle) navigation.querySelector('a')?.focus({ preventScroll:true });
});

function normaliseSite(site) {
  const defaults = {
    creatorName: 'Célia May',
    menuLabel: 'Menu', filterAllLabel: 'Tous', filterPrivateLabel: 'Privé', filterPublicLabel: 'Public',
    privateLabel: 'Privé', publicLabel: 'Public', projectBackLabel: 'Tous les projets', projectTypeLabel: 'Projet',
    projectSummaryLabel: 'En bref', projectAllLabel: 'Tous les projets', aboutContactEyebrow: 'Échanger autour du portfolio',
    aboutContactLabel: 'Prendre contact', copyright: `© ${new Date().getFullYear()}`, notFoundEyebrow: '404 · May’in',
    notFoundTitle: 'Cette page n’existe pas.', notFoundLinkLabel: 'Retour à l’accueil'
  };
  Object.entries(defaults).forEach(([key, value]) => { if (site[key] === undefined) site[key] = value; });
  site.navigation ||= [
    { label: 'Accueil', href: 'index.html', visible: true },
    { label: 'Projets', href: 'projets.html', visible: true },
    { label: 'Galerie', href: 'galerie.html', visible: true },
    { label: 'À propos', href: 'a-propos.html', visible: true },
    { label: 'Contact', href: 'contact.html', visible: true }
  ];
  site.socialLinks ||= [];
  site.gallery ||= { categories: [], items: [] };
  site.gallery.categories ||= [];
  site.gallery.items ||= [];
  site.customBlocks ||= {};
  site.elementStyles ||= {};
  ['home', 'projects', 'gallery', 'about', 'contact', 'notFound', 'homeHero', 'projectsHero', 'galleryHero', 'aboutHero', 'contactHero', 'notFoundHero'].forEach((key) => { site.customBlocks[key] ||= []; });
  return site;
}

function applyDesign(site) {
  const design = site.design || {};
  const palette = (design.palettes || []).find((item) => item.id === design.activePalette) || design.palettes?.[0];
  const typography = (design.typographies || []).find((item) => item.id === design.activeTypography) || design.typographies?.[0];
  const root = document.documentElement.style;
  if (palette) {
    root.setProperty('--ink', palette.ink);
    root.setProperty('--wine', palette.accent);
    root.setProperty('--paper', palette.paper);
    root.setProperty('--muted', palette.muted);
    root.setProperty('--soft', palette.soft || palette.paper);
    root.setProperty('--line', `${palette.ink}2e`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.accent);
  }
  if (typography) {
    root.setProperty('--serif', `"${typography.serif}", Georgia, serif`);
    root.setProperty('--sans', `"${typography.sans}", Arial, sans-serif`);
    root.setProperty('--mono', `"${typography.mono}", monospace`);
  }
}

function renderNavigation(site) {
  if (!navigation) return;
  const current = location.pathname.split('/').pop() || 'index.html';
  navigation.innerHTML = site.navigation.map((item, index) => ({ item, index })).filter(({ item }) => item.visible !== false).map(({ item, index }) => {
    const active = item.href.split('?')[0] === current || (current === '' && item.href === 'index.html');
    return `<a ${active ? 'aria-current="page"' : ''} href="${escapeHtml(item.href)}" data-edit-path="site.navigation.${index}.label" data-edit-label="Lien de navigation" data-edit-inline="true">${escapeHtml(item.label)}</a>`;
  }).join('');
}

function applySiteFields(site) {
  if (site.name) document.title = document.title.replace(/Célia|Celiarchi|May’in/g, site.name);
  if (site.seoTitle && page === 'home') document.title = site.seoTitle;
  if (site.seoDescription && page === 'home') upsertMeta('name', 'description', site.seoDescription);
  // Projects get a canonical only after their slug has resolved. The generic
  // template must never describe every project as a duplicate of the listing.
  if (site.domain && page !== 'project' && page !== 'notFound') {
    const pagePath = page === 'home' ? '' : location.pathname.split('/').pop();
    const canonicalUrl = `${site.domain.replace(/\/$/, '')}/${pagePath}`;
    setCanonical(canonicalUrl);
    upsertMeta('property', 'og:url', canonicalUrl);
  }
  upsertMeta('name', 'author', site.creatorName || 'Célia May');
  upsertMeta('property', 'og:site_name', site.name);
  upsertMeta('property', 'og:title', document.title);
  upsertMeta('name', 'twitter:title', document.title);
  const description = document.querySelector('meta[name="description"]')?.content;
  if (description) {
    upsertMeta('property', 'og:description', description);
    upsertMeta('name', 'twitter:description', description);
  }
  if (site.socialImage) {
    const socialUrl = new URL(site.socialImage, (site.domain || location.origin).replace(/\/$/, '') + '/').href;
    upsertMeta('property', 'og:image', socialUrl);
    upsertMeta('name', 'twitter:image', socialUrl);
  }
  document.querySelectorAll('[data-site]').forEach((element) => {
    const key = element.dataset.site;
    const value = page === 'notFound' && key === 'studioVersion' ? BUILD_VERSION : site[key];
    if (value === undefined) return;
    element.textContent = value;
    element.hidden = value === '' && key !== 'email';
    element.dataset.editPath = `site.${key}`;
    element.dataset.editLabel = key;
    element.dataset.editInline = 'true';
  });
  document.querySelectorAll('[data-site-image]').forEach((element) => {
    const key = element.dataset.siteImage;
    const value = site[key];
    if (value) element.src = assetSrc(value);
    element.dataset.editPath = `site.${key}`;
    element.dataset.editLabel = 'Image';
  });
  document.querySelectorAll('[data-site-href]').forEach((element) => {
    const key = element.dataset.siteHref;
    const value = site[key];
    if (key === 'email') {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '')) { element.href = `mailto:${value}`; element.hidden = false; }
      else { element.removeAttribute('href'); element.hidden = !isAdminPreview; }
    }
  });
}

function applyStructuredData(site) {
  if (page !== 'home') return;
  const base = (site.domain || 'https://may-in.be').replace(/\/$/, '');
  const creator = site.creatorName || 'Célia May';
  const structured = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${base}/#website`, url: `${base}/`, name: site.name, alternateName: ['May-in', 'May In', 'Mayin'], inLanguage: 'fr-BE' },
      { '@type': 'Organization', '@id': `${base}/#studio`, name: site.name, alternateName: ['May-in', 'May In', 'Mayin'], url: `${base}/`, logo: `${base}/favicon.png`, image: `${base}/${String(site.socialImage || 'assets/social-preview.png').replace(/^\//, '')}`, description: site.seoDescription, areaServed: ['Mons', 'Thuin', 'Charleroi', 'Hainaut', 'Wallonie'], founder: { '@id': `${base}/#celia-may` } },
      { '@type': 'Person', '@id': `${base}/#celia-may`, name: creator, jobTitle: 'Étudiante en architecture intérieure', memberOf: { '@id': `${base}/#studio` } }
    ]
  };
  let node = document.querySelector('#structured-data');
  if (!node) { node = document.createElement('script'); node.id = 'structured-data'; node.type = 'application/ld+json'; document.head.append(node); }
  node.textContent = JSON.stringify(structured);
}

function renderSocialLinks(site) {
  const links = (site.socialLinks || []).map((item, index) => ({ item, index })).filter(({ item }) => item.visible !== false && item.label);
  document.querySelectorAll('[data-social-links]').forEach((container) => {
    container.innerHTML = links.map(({ item, index }) => `<a href="${escapeHtml(item.url || '#')}" ${item.url?.startsWith('http') ? 'target="_blank" rel="noreferrer"' : ''} data-edit-path="site.socialLinks.${index}.label" data-edit-label="Lien social" data-edit-inline="true">${escapeHtml(item.label)}</a>`).join('<span aria-hidden="true"> · </span>');
    container.hidden = links.length === 0;
  });
}

function radiusClass(value) { return `radius-${safeToken(value, 'soft')}`; }
function imageStyle(item = {}) {
  const width = Math.max(25, Math.min(200, Number(item.width) || 100));
  const position = safeToken(item.objectPosition, 'center');
  const offsetX = boundedSetting(item.offsetX, -1200, 1200, 0);
  const offsetY = boundedSetting(item.offsetY, -1200, 1200, 0);
  const span = [4,6,8,12].includes(Number(item.columnSpan)) ? Number(item.columnSpan) : item.kind === 'detail' || item.size === 'small' ? 4 : item.kind === 'process' || item.size === 'medium' ? 6 : 8;
  return `--media-width:${width}%;--media-position:${position.replace('-', ' ')};--media-offset-x:${offsetX}px;--media-offset-y:${offsetY}px;--media-span:${span}`;
}
function mediaGridClass(item = {}) { return [4, 6, 8, 12].includes(Number(item.columnSpan)) ? ' media-grid--custom' : ''; }
function projectCardStyle(project = {}) {
  const span = [4, 6, 8, 10, 12].includes(Number(project.cardSpan)) ? Number(project.cardSpan) : 12;
  const align = ['start', 'center', 'end'].includes(project.cardAlign) ? project.cardAlign : 'start';
  return `--card-span:${span};--card-align:${align}`;
}
function projectCardSizeClass(project = {}) { return [4, 6, 8, 10, 12].includes(Number(project.cardSpan)) ? ' project-card--custom-size' : ''; }
function blockSurface(block = {}) {
  const surfaces = { paper: 'var(--paper)', soft: 'var(--soft)', ink: 'var(--ink)', accent: 'var(--wine)' };
  return block.surface === 'custom' ? (block.background || 'transparent') : (surfaces[block.surface] || 'transparent');
}
function blockTextColor(block = {}) {
  const colors = { ink: 'var(--ink)', paper: 'var(--paper)', accent: 'var(--wine)' };
  return block.textColor === 'custom' ? (block.color || 'var(--ink)') : (colors[block.textColor] || 'inherit');
}
function boundedSetting(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}
function blockStyle(block = {}) {
  const width = boundedSetting(block.width, 25, 200, 100);
  const minHeight = boundedSetting(block.minHeight, 0, 520, 0);
  const padding = boundedSetting(block.padding, 0, 120, 0);
  const gap = boundedSetting(block.spacing, 0, 240, 36);
  const fontSize = boundedSetting(block.fontSize, 14, 96, 18);
  const align = safeToken(block.align, 'left');
  const textAlign = safeToken(block.textAlign, 'left');
  const font = safeToken(block.fontFamily, 'sans');
  const offsetX = boundedSetting(block.offsetX, -1200, 1200, 0);
  const offsetY = boundedSetting(block.offsetY, -1200, 1200, 0);
  const span = [4, 6, 8, 12].includes(Number(block.columnSpan)) ? Number(block.columnSpan) : 12;
  return `--block-width:${width}%;--block-min-height:${minHeight}px;--block-padding:${padding}px;--block-gap:${gap}px;--block-font-size:${fontSize}px;--block-align:${align};--block-text-align:${textAlign};--block-font:var(--${font});--block-color:${blockTextColor(block)};--block-background:${blockSurface(block)};--block-offset-x:${offsetX}px;--block-offset-y:${offsetY}px;--block-span:${span}`;
}
function paletteValue(style, key, site, customKey = 'customColor') {
  const palette = (site.design?.palettes || []).find((item) => item.id === site.design?.activePalette) || site.design?.palettes?.[0] || {};
  if (key === 'custom') return style[customKey] || '#2a1718';
  return { ink: palette.ink, accent: palette.accent, paper: palette.paper, soft: palette.soft || palette.paper }[key] || '';
}

const compactLayout = matchMedia('(max-width: 980px)');
const layoutSettings = new WeakMap();
let layoutFrame = 0;
function queueLayout() {
  if (!layoutFrame) layoutFrame = requestAnimationFrame(fitLayout);
}
function bindLayout(element, settings = {}, kind = 'media') {
  if (!element) return;
  if (!layoutSettings.has(element)) {
    const base = getComputedStyle(element);
    element.style.setProperty('--layout-top', base.marginTop);
    element.style.setProperty('--layout-bottom', base.marginBottom);
  }
  element.dataset.layoutItem = '';
  element.dataset.layoutKind = kind;
  layoutSettings.set(element, settings);
  if (settings.width != null) element.style.setProperty('--layout-width', boundedSetting(settings.width, 20, 200, 100) + '%');
  else element.style.removeProperty('--layout-width');
  element.style.setProperty('--layout-flow-y', boundedSetting(settings.offsetY, -1200, 1200, 0) + 'px');
  queueLayout();
}
function layoutBounds(element) {
  const canvas = element.parentElement.closest('.projects-grid,.project-gallery,.gallery-grid,.custom-blocks,.project-hero,.home-hero__content,.home-intro,.about-page__content,.gallery-empty,.page-heading,.project-copy,.contact-main,.home-close,.footer,.topbar,main');
  const viewport = document.documentElement.clientWidth;
  if (!canvas) return { left:16, right:viewport-16, top:0 };
  const rect = canvas.getBoundingClientRect();
  const style = getComputedStyle(canvas);
  return { left:Math.max(16,rect.left+parseFloat(style.paddingLeft)), right:Math.min(viewport-16,rect.right-parseFloat(style.paddingRight)), top:rect.top+parseFloat(style.paddingTop) };
}
function fitLayout() {
  layoutFrame = 0;
  const elements = [...document.querySelectorAll('[data-layout-item]')];
  const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  elements.forEach(element => {
    element.style.setProperty('--layout-x','0px');
    element.style.setProperty('--layout-y','0px');
    const bounds = layoutBounds(element);
    element.style.setProperty('--layout-max',Math.max(0,bounds.right-bounds.left)+'px');
  });
  // Parents first so that nested text is constrained at its final position.
  elements.forEach(element => {
    if (!element.getClientRects().length || compactLayout.matches) return;
    const settings = layoutSettings.get(element) || {};
    const bounds = layoutBounds(element);
    const rect = element.getBoundingClientRect();
    const [minX,maxX] = MayinModel.axisOffsetRange(rect.left,rect.width,bounds.left,bounds.right);
    const x = Math.max(minX,Math.min(maxX,boundedSetting(settings.offsetX,-1200,1200,0)));
    const pageTop = rect.top + scrollY;
    const minY = 16 - pageTop;
    const maxY = pageHeight - 16 - (pageTop + rect.height);
    const y = Math.max(minY, Math.min(maxY, boundedSetting(settings.positionY,-1200,1200,0)));
    element.style.setProperty('--layout-x',x+'px');
    element.style.setProperty('--layout-y',y+'px');
  });
}
addEventListener('resize', queueLayout);
compactLayout.addEventListener('change', () => { applyElementStyles(runtime.site || {}); queueLayout(); });
document.addEventListener('load', event => { if (event.target.tagName === 'IMG' || event.target.tagName === 'LINK') queueLayout(); }, true);
document.fonts?.ready.then(queueLayout);
function bindContentLayout() {
  document.querySelectorAll('.project-cover-group,.project-hero__visual,.project-media,.gallery-item,.custom-block').forEach(element => {
    const path = element.dataset.layoutPath || element.dataset.editPath;
    const item = path?.split('.').reduce((value,part) => value?.[part],runtime);
    if (item && typeof item === 'object') bindLayout(element,item);
  });
}

function layoutTarget(element) {
  return element.closest('.large-link,.contact-link,.project-title-row,.project-meta') || element;
}

function applyElementOrder(site) {
  const parents = new Set([...document.querySelectorAll('[data-layout-style-id]')].map(element => element.parentElement).filter(Boolean));
  parents.forEach(parent => {
    const peers = [...parent.children].filter(element => element.dataset.layoutStyleId);
    if (peers.length < 2) return;
    const ordered = MayinModel.orderPeers(peers, element => site.elementStyles?.[element.dataset.layoutStyleId]?.order);
    if (ordered.every((element, index) => element === peers[index])) return;
    const peerSet = new Set(peers);
    let index = 0;
    const children = [...parent.childNodes].map(node => peerSet.has(node) ? ordered[index++] : node);
    parent.replaceChildren(...children);
  });
}

function applyElementStyles(site, captureBase = false) {
  const occurrences = new Map(), migrated = {};
  document.querySelectorAll('[data-layout-style-id]').forEach(element => delete element.dataset.layoutStyleId);
  const projectIndex = page === 'project' ? runtime.projects.findIndex(project => project.slug === new URLSearchParams(location.search).get('slug')) : -1;
  const scope = projectIndex >= 0 ? 'page-' + MayinModel.styleKey(runtime, `projects.${projectIndex}`, page) : 'page-' + (page || 'home');
  const useLegacy = !site.styleMigrations?.[scope];
  document.querySelectorAll('[data-edit-inline]').forEach((element,index) => {
    const path = element.dataset.editPath;
    const occurrence = occurrences.get(path) || 0;
    occurrences.set(path,occurrence+1);
    const styleId = element.dataset.editStyleId || MayinModel.styleKey(runtime,path,page || 'home',occurrence);
    element.dataset.editStyleId = styleId;
    const legacyId = `${page || 'home'}-text-${index}`;
    const style = site.elementStyles?.[styleId] || (useLegacy ? site.elementStyles?.[legacyId] : undefined);
    if (style && !site.elementStyles?.[styleId]) {
      site.elementStyles ||= {};
      site.elementStyles[styleId] = structuredClone(style);
      migrated[styleId] = structuredClone(style);
    }
    const layoutElement = layoutTarget(element);
    if (captureBase || element.dataset.baseHidden === undefined) element.dataset.baseHidden = String(element.hidden);
    const properties = ['font-family','font-size','text-align','color','background','display','width','max-width','margin-left','margin-right','margin-inline','min-height','padding','border-radius','transform'];
    properties.forEach(property => element.style.removeProperty(property));
    if (layoutElement !== element) properties.slice(4).forEach(property => layoutElement.style.removeProperty(property));
    element.hidden = element.dataset.baseHidden === 'true';
    layoutElement.dataset.layoutStyleId = styleId;
    bindLayout(layoutElement,style || {},'text');
    if (layoutElement !== element) layoutElement.hidden = element.hidden;
    if (!style) return;
    const number = (value,min,max) => value != null && value !== '' && Number.isFinite(Number(value)) ? Math.max(min,Math.min(max,Number(value))) : null;
    const fontSize = number(style.fontSize,10,160);
    if (Object.hasOwn(style,'hidden')) element.hidden = Boolean(style.hidden);
    if (layoutElement !== element) layoutElement.hidden = element.hidden;
    if (style.fontFamily) element.style.fontFamily = `var(--${safeToken(style.fontFamily,'sans')})`;
    if (fontSize !== null) element.style.fontSize = compactLayout.matches ? `min(${fontSize}px,${element.matches('h1,h2,h3') ? '12vw' : '8vw'})` : `${fontSize}px`;
    if (style.textAlign) element.style.textAlign = safeToken(style.textAlign,'left');
    if (style.textColor && style.textColor !== 'inherit') element.style.color = paletteValue(style,style.textColor,site);
    if (style.background && style.background !== 'none') layoutElement.style.background = paletteValue(style,style.background,site,'backgroundColor');
    if (style.width != null || style.offsetX || style.offsetY || style.padding || style.background) layoutElement.style.display = layoutElement.matches('.large-link,.contact-link,.project-title-row') ? 'inline-flex' : 'block';
    if (style.align === 'center') layoutElement.style.marginInline = 'auto';
    if (style.align === 'right') layoutElement.style.marginLeft = 'auto';
    if (style.padding != null) layoutElement.style.padding = `${number(style.padding,0,compactLayout.matches ? 24 : 160) || 0}px`;
    if (style.minHeight != null && !compactLayout.matches) layoutElement.style.minHeight = `${number(style.minHeight,0,720) || 0}px`;
    if (style.radius) layoutElement.style.borderRadius = `${number(style.radius,0,100) || 0}px`;
  });
  applyElementOrder(site);
  site.styleMigrations ||= {};
  site.styleMigrations[scope] = true;
  if (isAdminPreview && useLegacy) window.parent.postMessage({type:'mayin:style-map',styles:migrated,scope},location.origin);
}

function categoryLabel(category) { return category === 'public' ? runtime.site.publicLabel : runtime.site.privateLabel; }

function projectCard(project, index) {
  const image = project.cover ? `<img src="${assetSrc(project.cover)}" alt="${escapeHtml(project.title)}" loading="lazy" decoding="async" />` : '<span class="project-image__empty">Image à ajouter</span>';
  const cutout = project.coverKind === 'cutout' ? ' project-card--cutout' : '';
  const radius = radiusClass(project.coverRadius || 'soft');
  return `<a class="project-card project-card--${safeToken(project.layout, 'wide')}${cutout}${projectCardSizeClass(project)} ${radius}" style="${projectCardStyle(project)}" data-category="${escapeHtml(project.category)}" data-edit-path="projects.${index}" data-edit-label="Projet" href="project.html?slug=${encodeURIComponent(project.slug)}"><div class="project-cover-group" data-layout-path="projects.${index}" style="${imageStyle(project)}"><div class="project-image" data-edit-path="projects.${index}.cover" data-edit-label="Cadre et image du projet">${image}</div><span class="project-category" data-edit-path="projects.${index}.cover" data-edit-label="Image et catégorie">${categoryLabel(project.category)}</span></div><div class="project-card__text"><div class="project-title-row"><h2 data-edit-path="projects.${index}.title" data-edit-label="Titre du projet" data-edit-inline="true">${escapeHtml(project.title)}</h2><span class="project-arrow" aria-hidden="true">↗</span></div><div class="project-meta"><span data-edit-path="projects.${index}.description" data-edit-label="Description du projet" data-edit-inline="true">${escapeHtml(project.description)}</span></div></div></a>`;
}

function renderProjects(projects) {
  const grid = document.querySelector('#projects-grid'); if (!grid) return;
  grid.innerHTML = projects.filter((project) => project.hidden !== true).map((project) => projectCard(project, projects.indexOf(project))).join('');
  document.querySelectorAll('.filter').forEach((filter) => filter.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((button) => button.classList.toggle('is-active', button === filter));
    document.querySelectorAll('.project-card').forEach((card) => card.classList.toggle('is-hidden', filter.dataset.filter !== 'all' && card.dataset.category !== filter.dataset.filter));
  }));
}

function renderProjectPage(projects) {
  const content = document.querySelector('#project-page-content'); if (!content) return;
  const slug = new URLSearchParams(location.search).get('slug');
  const projectIndex = projects.findIndex((item) => item.slug === slug);
  const project = projects[projectIndex];
  if (!project) {
    document.title = `Projet introuvable — ${runtime.site.name}`;
    // A static host returns 200 for this template even for an unknown slug.
    // Only add noindex once the content has loaded and absence is confirmed.
    upsertMeta('name', 'robots', 'noindex,follow');
    document.querySelector('link[rel="canonical"]')?.remove();
    document.querySelector('#project-structured-data')?.remove();
    content.innerHTML = '<section class="project-copy"><p class="eyebrow">Projet introuvable</p><div><p class="lead">Ce projet n’existe pas encore.</p><p><a href="projets.html">Retour aux projets</a></p></div></section>';
    return;
  }
  upsertMeta('name', 'robots', 'index,follow,max-image-preview:large');
  content.className = `project-layout project-layout--${safeToken(project.layout, 'wide')}`;
  document.title = `${project.title} — ${runtime.site.name}`;
  const projectUrl = `${runtime.site.domain.replace(/\/$/, '')}/project.html?slug=${encodeURIComponent(project.slug)}`;
  setCanonical(projectUrl);
  upsertMeta('name', 'description', `${project.title} — ${project.description}`);
  upsertMeta('property', 'og:type', 'article');
  upsertMeta('property', 'og:title', `${project.title} — ${runtime.site.name}`);
  upsertMeta('property', 'og:description', project.description);
  upsertMeta('property', 'og:url', projectUrl);
  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:title', document.title);
  upsertMeta('name', 'twitter:description', project.description);
  if (project.cover) {
    const coverUrl = new URL(project.cover, runtime.site.domain.replace(/\/$/, '') + '/').href;
    upsertMeta('property', 'og:image', coverUrl);
    upsertMeta('name', 'twitter:image', coverUrl);
  }
  let projectSchema = document.querySelector('#project-structured-data');
  if (!projectSchema) { projectSchema = document.createElement('script'); projectSchema.id = 'project-structured-data'; projectSchema.type = 'application/ld+json'; document.head.append(projectSchema); }
  projectSchema.textContent = JSON.stringify({ '@context':'https://schema.org', '@type':'CreativeWork', name:project.title, description:project.description, url:projectUrl, image:project.cover ? `${runtime.site.domain.replace(/\/$/, '')}/${project.cover.replace(/^\//, '')}` : undefined, creator:{ '@type':'Person', name:runtime.site.creatorName || 'Célia May' }, about:['Architecture intérieure','Design','Scénographie'] });
  const heroRadius = radiusClass(project.coverRadius || 'soft');
  const hero = project.cover ? `<img class="project-hero__image${project.coverKind === 'cutout' ? ' project-hero__image--cutout' : ''} ${heroRadius}" src="${assetSrc(project.cover)}" alt="${escapeHtml(project.title)}" fetchpriority="high" data-edit-path="projects.${projectIndex}.cover" data-edit-label="Image de couverture" />` : '<div class="project-hero__empty">Image à ajouter</div>';
  const media = (project.media || []).map((item, mediaIndex) => {
    const placement = item.align || ['left', 'right', 'center'][mediaIndex % 3];
    const radius = radiusClass(item.radius || (item.kind === 'cutout' || item.kind === 'plan' ? 'none' : 'soft'));
    return `<figure class="project-media project-media--${safeToken(item.kind, 'wide')} project-media--${safeToken(placement, 'center')} project-media--${safeToken(item.format, 'landscape')}${mediaGridClass(item)} ${radius}" style="${imageStyle(item)}" data-edit-path="projects.${projectIndex}.media.${mediaIndex}" data-edit-label="Image du projet"><img src="${assetSrc(item.src)}" alt="${escapeHtml(item.alt || `Vue du projet ${project.title}`)}" loading="lazy" decoding="async" /><figcaption data-edit-path="projects.${projectIndex}.media.${mediaIndex}.caption" data-edit-label="Légende" data-edit-inline="true">${escapeHtml(item.caption || '')}</figcaption></figure>`;
  }).join('');
  const blocks = renderBlocks(project.blocks || [], `projects.${projectIndex}.blocks`);
  const heroBlocks = renderBlocks(project.heroBlocks || [], `projects.${projectIndex}.heroBlocks`, 'custom-blocks--hero custom-blocks--cover');
  content.innerHTML = `<section class="project-hero"><a class="project-back" href="projets.html">← <span data-edit-path="site.projectBackLabel" data-edit-label="Retour aux projets" data-edit-inline="true">${escapeHtml(runtime.site.projectBackLabel)}</span></a><p class="eyebrow"><span data-edit-path="site.projectTypeLabel" data-edit-label="Libellé du projet" data-edit-inline="true">${escapeHtml(runtime.site.projectTypeLabel)}</span> <span data-edit-path="site.${project.category === 'public' ? 'publicLabel' : 'privateLabel'}" data-edit-label="Catégorie" data-edit-inline="true">${escapeHtml(categoryLabel(project.category))}</span></p><h1 data-edit-path="projects.${projectIndex}.title" data-edit-label="Titre du projet" data-edit-inline="true">${escapeHtml(project.title)}</h1><div class="project-hero__visual" data-layout-path="projects.${projectIndex}" style="${imageStyle(project)}">${hero}<div class="hero-block-zone hero-block-zone--cover">${heroBlocks}</div></div></section><section class="project-copy"><p class="eyebrow" data-edit-path="site.projectSummaryLabel" data-edit-label="Titre du résumé" data-edit-inline="true">${escapeHtml(runtime.site.projectSummaryLabel)}</p><div><p class="lead" data-edit-path="projects.${projectIndex}.description" data-edit-label="Description" data-edit-inline="true">${escapeHtml(project.description)}</p></div></section>${blocks}<section class="project-gallery">${media}<a href="projets.html" class="large-link"><span data-edit-path="site.projectAllLabel" data-edit-label="Lien vers les projets" data-edit-inline="true">${escapeHtml(runtime.site.projectAllLabel)}</span> <span>↗</span></a></section>`;
}

function renderGallery(site) {
  const grid = document.querySelector('#gallery-grid'); if (!grid) return;
  const items = site.gallery?.items || [];
  document.querySelector('.gallery-empty')?.classList.toggle('gallery-empty--with-items', items.length > 0);
  grid.innerHTML = items.map((item, index) => `<figure class="gallery-item gallery-item--${safeToken(item.size, 'medium')} gallery-item--${safeToken(item.format, 'original')}${mediaGridClass(item)} ${radiusClass(item.radius || 'soft')}" data-edit-path="site.gallery.items.${index}" data-edit-label="Image de galerie" style="${imageStyle(item)}"><img src="${assetSrc(item.src)}" alt="${escapeHtml(item.alt || item.caption || '')}" loading="lazy" /><figcaption><span>${escapeHtml(item.category || '')}</span><span data-edit-path="site.gallery.items.${index}.caption" data-edit-label="Légende" data-edit-inline="true">${escapeHtml(item.caption || '')}</span>${item.credit ? `<small>${escapeHtml(item.credit)}</small>` : ''}</figcaption></figure>`).join('');
}

function renderBlocks(blocks, basePath, extraClass = '') {
  if (!blocks?.length) return '';
  return `<section class="custom-blocks${extraClass ? ` ${extraClass}` : ''}">${blocks.filter((block) => block.hidden !== true).map((block, index) => {
    const path = `${basePath}.${blocks.indexOf(block)}`;
    const classes = `custom-block--align-${safeToken(block.align, 'left')} custom-block--${safeToken(block.format, 'original')}`;
    const style = `${imageStyle(block)};${blockStyle(block)}`;
    if (block.type === 'image') return `<figure class="custom-block custom-block--image ${classes} ${radiusClass(block.radius || 'soft')}" style="${style}" data-edit-path="${path}" data-edit-label="Bloc image"><img src="${assetSrc(block.src)}" alt="${escapeHtml(block.alt || block.caption || '')}" /><figcaption data-edit-path="${path}.caption" data-edit-label="Légende" data-edit-inline="true">${escapeHtml(block.caption || '')}</figcaption></figure>`;
    if (block.type === 'quote') return `<blockquote class="custom-block custom-block--quote ${classes}" style="${style}" data-edit-path="${path}" data-edit-label="Citation"><p data-edit-path="${path}.text" data-edit-inline="true">${escapeHtml(block.text || 'Citation')}</p></blockquote>`;
    if (block.type === 'divider') return `<hr class="custom-block custom-block--divider" data-edit-path="${path}" data-edit-label="Séparateur" />`;
    if (block.type === 'spacer') return `<div class="custom-block custom-block--spacer" style="--space:${Math.max(20, Math.min(240, Number(block.height) || 80))}px" data-edit-path="${path}" data-edit-label="Espacement"></div>`;
    return `<div class="custom-block custom-block--text custom-block--${safeToken(block.style, 'body')} ${classes} ${radiusClass(block.radius || 'soft')}" style="${style}" data-edit-path="${path}" data-edit-label="Bloc texte"><p data-edit-path="${path}.text" data-edit-inline="true">${escapeHtml(block.text || 'Nouveau texte')}</p></div>`;
  }).join('')}</section>`;
}

function renderCustomBlocks(site) {
  document.querySelectorAll('[data-custom-blocks]').forEach((container) => {
    const key = container.dataset.customBlocks;
    container.innerHTML = renderBlocks(site.customBlocks?.[key] || [], `site.customBlocks.${key}`, key.endsWith('Hero') ? 'custom-blocks--hero' : '');
  });
}

function ensureHeroBlockZone() {
  if (!page || page === 'project') return;
  const key = `${page}Hero`;
  if (document.querySelector(`[data-custom-blocks="${key}"]`)) return;
  let host = null;
  let before = null;
  if (page === 'home') { host = document.querySelector('.home-hero__content'); before = host?.querySelector('.home-hero__bottom'); }
  else if (page === 'contact') { host = document.querySelector('.contact-main'); before = host?.querySelector('.contact-details'); }
  else if (page === 'notFound') { host = document.querySelector('.not-found'); before = host?.querySelector('a'); }
  else host = document.querySelector('.page-heading');
  if (!host) return;
  const zone = document.createElement('div');
  zone.className = 'hero-block-zone';
  zone.dataset.customBlocks = key;
  before ? host.insertBefore(zone, before) : host.append(zone);
}

let telemetryStarted = false;
function studioApi(site, path) { return `${String(site.admin?.apiBase || '').replace(/\/$/, '')}${path}`; }
function startAnonymousAnalytics(site) {
  if (isAdminPreview || telemetryStarted || !site.admin?.analyticsEnabled || !site.admin?.apiBase) return;
  telemetryStarted = true;
  // The Worker already groups visits by an ephemeral, secret-salted IP hash.
  // A persistent browser identifier adds no value and is removed for returning visitors.
  try { localStorage.removeItem('mayin-anonymous-visit'); } catch {}
  const payload = JSON.stringify({ path: `${location.pathname}${location.search}`, referer: document.referrer || 'Direct' });
  const endpoint = studioApi(site, '/public/visit');
  if (navigator.sendBeacon) navigator.sendBeacon(endpoint, new Blob([payload], { type: 'text/plain' }));
  else fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload, keepalive: true }).catch(() => {});
}
function renderContactForm(site) {
  if (page !== 'contact' || isAdminPreview || document.querySelector('#mayin-contact-form') || !site.admin?.contactFormEnabled || !site.admin?.apiBase) return;
  const target = document.querySelector('.contact-main'); if (!target) return;
  target.insertAdjacentHTML('beforeend', `<section class="contact-form"><p class="eyebrow">Message rapide</p><p>Pour une question, un stage, une collaboration ou un retour sur le portfolio, laisse un court message et ton e-mail.</p><form id="mayin-contact-form"><label>Prénom ou nom<input name="name" maxlength="80" autocomplete="name" /></label><label>E-mail<input name="email" type="email" maxlength="150" autocomplete="email" required /></label><label>Votre message<textarea name="message" minlength="8" maxlength="600" required></textarea></label><input class="contact-form__trap" name="website" tabindex="-1" autocomplete="off" /><button type="submit">Envoyer le message <span>↗</span></button><p class="contact-form__status" role="status"></p></form></section>`);
  const form = document.querySelector('#mayin-contact-form'); const status = form.querySelector('.contact-form__status');
  form.addEventListener('submit', async (event) => { event.preventDefault(); const fields = new FormData(form); const button = form.querySelector('button'); button.disabled = true; status.textContent = 'Envoi…';
    try { const response = await fetch(studioApi(site, '/public/message'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(fields)) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); form.reset(); status.textContent = 'Message envoyé. Merci.'; }
    catch (error) { status.textContent = error.message || 'Envoi impossible pour le moment.'; } finally { button.disabled = false; }
  });
}

function renderAll(site, projects) {
  runtime = MayinModel.ensureIds({ site: normaliseSite(structuredClone(site)), projects: structuredClone(projects || []) });
  applyDesign(runtime.site);
  renderNavigation(runtime.site);
  applySiteFields(runtime.site);
  applyStructuredData(runtime.site);
  renderSocialLinks(runtime.site);
  if (page === 'projects') renderProjects(runtime.projects);
  if (page === 'project') renderProjectPage(runtime.projects);
  if (page === 'gallery') renderGallery(runtime.site);
  ensureHeroBlockZone();
  renderCustomBlocks(runtime.site);
  renderContactForm(runtime.site);
  bindContentLayout();
  applyElementStyles(runtime.site, true);
  startAnonymousAnalytics(runtime.site);
  prepareAdminPreview();
}

function updatePreviewValue(path, value) {
  queueLayout();
  const parts = path.split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part);
  let owner = runtime;
  for (const part of parts.slice(0, -1)) {
    if (owner[part] == null) owner[part] = {};
    owner = owner[part];
  }
  owner[parts.at(-1)] = value;
  if (path.startsWith('site.elementStyles.')) { applyElementStyles(runtime.site); return; }
  if (path.startsWith('site.design.')) { applyDesign(runtime.site); applyElementStyles(runtime.site); return; }
  const matchingText = [...document.querySelectorAll('[data-edit-inline]')].filter((element) => element.dataset.editPath === path);
  if (matchingText.length && typeof value === 'string') {
    matchingText.forEach((element) => { if (element !== document.activeElement) element.textContent = value; });
    return;
  }
  if (path === 'site.heroImage') {
    const hero = document.querySelector('[data-site-image="heroImage"]');
    if (hero) hero.src = assetSrc(value);
    return;
  }
  const coverMatch = path.match(/^projects\.(\d+)\.(cover|coverKind|coverRadius|width|cardSpan|cardAlign|objectPosition|offsetX|offsetY)$/);
  if (coverMatch) {
    const project = runtime.projects[Number(coverMatch[1])];
    const hero = document.querySelector(`.project-hero__image[data-edit-path="projects.${coverMatch[1]}.cover"]`);
    const card = document.querySelector(`[data-edit-path="projects.${coverMatch[1]}"]`);
    if (hero) {
      if (coverMatch[2] === 'cover') hero.src = assetSrc(project.cover);
      hero.parentElement.style.cssText = imageStyle(project);
      bindLayout(hero.parentElement, project);
      hero.classList.toggle('project-hero__image--cutout', project.coverKind === 'cutout');
      hero.classList.remove('radius-none', 'radius-soft', 'radius-top-right', 'radius-diagonal', 'radius-all', 'radius-pill');
      hero.classList.add(radiusClass(project.coverRadius || 'soft'));
    }
    if (card) {
      const image = card.querySelector('.project-image');
      const group = card.querySelector('.project-cover-group');
      if (group) { group.style.cssText = imageStyle(project); bindLayout(group, project); }
      if (coverMatch[2] === 'cover' && image?.querySelector('img')) image.querySelector('img').src = assetSrc(project.cover);
      if (image) image.style.removeProperty("width");
      card.style.cssText = projectCardStyle(project);
      card.classList.toggle('project-card--custom-size', [4, 6, 8, 10, 12].includes(Number(project.cardSpan)));
      card.classList.toggle('project-card--cutout', project.coverKind === 'cutout');
      card.classList.remove('radius-none', 'radius-soft', 'radius-top-right', 'radius-diagonal', 'radius-all', 'radius-pill');
      card.classList.add(radiusClass(project.coverRadius || 'soft'));
    }
    return;
  }
  const mediaMatch = path.match(/^projects\.(\d+)\.media\.(\d+)\.(src|radius|kind|format|align|width|columnSpan|objectPosition|offsetX|offsetY)$/);
  const galleryMatch = path.match(/^site\.gallery\.items\.(\d+)\.(src|radius|size|format|width|columnSpan|objectPosition|offsetX|offsetY)$/);
  const blockMatch = path.match(/^(site\.customBlocks\.[^.]+\.\d+|projects\.\d+\.(?:blocks|heroBlocks)\.\d+)\.(src|radius|format|width|columnSpan|align|spacing|fontFamily|fontSize|textAlign|textColor|color|surface|background|padding|minHeight|offsetX|offsetY)$/);
  if (mediaMatch || galleryMatch || blockMatch) {
    const base = mediaMatch ? `projects.${mediaMatch[1]}.media.${mediaMatch[2]}` : galleryMatch ? `site.gallery.items.${galleryMatch[1]}` : blockMatch[1];
    const element = [...document.querySelectorAll('[data-edit-path]')].find((item) => item.dataset.editPath === base);
    if (!element) return;
    const item = base.split('.').reduce((current, part) => current?.[part], runtime);
    const selected = element.classList.contains('admin-selected') ? ' admin-selected' : '';
    if (path.endsWith('.src')) { const image = element.querySelector('img'); if (image) image.src = assetSrc(value); }
    if (mediaMatch) {
      element.style.cssText = imageStyle(item);
      const placement = item.align || ['left', 'right', 'center'][Number(mediaMatch[2]) % 3];
      element.className = `project-media project-media--${safeToken(item.kind, 'wide')} project-media--${safeToken(placement, 'center')} project-media--${safeToken(item.format, 'landscape')}${mediaGridClass(item)} ${radiusClass(item.radius || (item.kind === 'cutout' || item.kind === 'plan' ? 'none' : 'soft'))}${selected}`;
    } else if (galleryMatch) {
      element.style.cssText = imageStyle(item);
      element.className = `gallery-item gallery-item--${safeToken(item.size, 'medium')} gallery-item--${safeToken(item.format, 'original')}${mediaGridClass(item)} ${radiusClass(item.radius || 'soft')}${selected}`;
    } else {
      element.style.cssText = `${imageStyle(item)};${blockStyle(item)}`;
      const classes = `custom-block--align-${safeToken(item.align, 'left')} custom-block--${safeToken(item.format, 'original')}`;
      const type = item.type === 'image' ? 'image' : item.type === 'quote' ? 'quote' : `text custom-block--${safeToken(item.style, 'body')}`;
      element.className = `custom-block custom-block--${type} ${classes} ${radiusClass(item.radius || 'soft')}${selected}`;
    }
    bindLayout(element, item);
    return;
  }
  renderAll(runtime.site, runtime.projects);
}

function prepareAdminPreview() {
  if (!isAdminPreview) return;
  document.body.classList.add('admin-preview');
  document.body.classList.toggle('admin-preview--edit', previewEditMode);
  const coarsePointer = matchMedia('(pointer:coarse)').matches;
  document.querySelectorAll('[data-edit-inline]').forEach((element) => { element.contentEditable = previewEditMode && !coarsePointer ? 'plaintext-only' : 'false'; element.spellcheck = true; });
  const hero = document.querySelector('.home-hero');
  if (hero && !hero.querySelector('.admin-image-handle')) {
    hero.insertAdjacentHTML('beforeend', '<button class="admin-image-handle" type="button" data-edit-path="site.heroImage" data-edit-label="Image de fond">✎ Image de fond</button>');
  }
  if (!previewReadySent) {
    previewReadySent = true;
    window.parent.postMessage({ type: 'mayin:preview-ready', page, href: location.href }, location.origin);
  }
}

if (isAdminPreview) {
  let touchStart = null;
  let touchSelectionUntil = 0;
  let selectedPreviewElement = null;
  const editableAtPoint = (event) => {
    const direct = event.target.closest?.('[data-edit-path]');
    if (direct?.dataset.editInline === 'true') return direct;
    const seen = new Set();
    const stacked = document.elementsFromPoint(event.clientX, event.clientY).map((node) => node.closest?.('[data-edit-path]')).filter((node) => node && !seen.has(node) && seen.add(node));
    return stacked.find((node) => node.dataset.editInline === 'true') || direct || stacked[0] || null;
  };
  const placeCaretAtPoint = (element, event) => {
    if (element.dataset.editInline !== 'true' || element.contentEditable === 'false') return;
    element.focus({ preventScroll: true });
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!range || !element.contains(range.startContainer)) return;
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  };
  const selectPreviewElement = (event) => {
    if (!previewEditMode) return;
    const editable = editableAtPoint(event);
    if (!editable) return;
    const inline = editable.dataset.editInline === 'true';
    if (!inline || editable.closest('a, button')) { event.preventDefault(); event.stopPropagation(); }
    if (selectedPreviewElement && selectedPreviewElement !== editable) selectedPreviewElement.classList.remove('admin-selected');
    editable.classList.add('admin-selected');
    selectedPreviewElement = editable;
    const target = layoutTarget(editable);
    const layoutPeers = [...(target.parentElement?.children || [])].filter(element => element.dataset.layoutStyleId).map(element => ({ styleId:element.dataset.layoutStyleId }));
    window.parent.postMessage({ type: 'mayin:select', path: editable.dataset.editPath, styleId: editable.dataset.editStyleId || '', label: editable.dataset.editLabel || 'Élément', layoutPeers }, location.origin);
    if (inline) requestAnimationFrame(() => placeCaretAtPoint(editable, event));
  };
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') touchStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }, true);
  document.addEventListener('pointerup', (event) => {
    if (!touchStart || touchStart.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y);
    touchStart = null;
    if (moved > 12) return;
    touchSelectionUntil = performance.now() + 700;
    selectPreviewElement(event);
  }, true);
  document.addEventListener('pointercancel', () => { touchStart = null; }, true);
  document.addEventListener('click', (event) => {
    if (performance.now() < touchSelectionUntil) { if (previewEditMode && event.target.closest('[data-edit-path]')) { event.preventDefault(); event.stopPropagation(); } return; }
    selectPreviewElement(event);
  }, true);
  document.addEventListener('input', (event) => {
    const editable = event.target.closest('[data-edit-inline]');
    if (!editable || !previewEditMode) return;
    queueLayout();
    window.parent.postMessage({ type: 'mayin:inline', path: editable.dataset.editPath, value: editable.textContent }, location.origin);
  });
  document.addEventListener('focusout', (event) => {
    const editable = event.target.closest('[data-edit-inline]');
    if (!editable || !previewEditMode) return;
    window.parent.postMessage({ type: 'mayin:inline-commit', path: editable.dataset.editPath }, location.origin);
  });
  addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data) return;
    if (event.data.type === 'mayin:data') renderAll(event.data.site, event.data.projects);
    if (event.data.type === 'mayin:patch') updatePreviewValue(event.data.path, event.data.value);
    if (event.data.type === 'mayin:mode') { previewEditMode = event.data.mode === 'edit'; prepareAdminPreview(); }
  });
}

Promise.all([getJson('content/site.json'), getJson('content/projects.json')])
  .then(([site, projectData]) => renderAll(site, projectData.projects))
  .catch(() => { const target = document.querySelector('#projects-grid, #project-page-content'); if (target) target.innerHTML = '<p class="content-error">Le contenu est temporairement indisponible.</p>'; });
