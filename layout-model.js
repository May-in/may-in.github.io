/* Shared, additive identities: existing content and legacy styles are retained. */
(function (root) {
  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
    return (result >>> 0).toString(36);
  }
  function identify(items, prefix) {
    const used = new Set();
    (items || []).forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      let id = item.id || prefix + '-' + hash(item.slug || item.src || item.text || String(index));
      if (used.has(id)) id += '-' + index;
      item.id = id; used.add(id);
    });
  }
  function moveTo(items, from, to) {
    if (!Array.isArray(items) || from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return null;
    const next = items.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }
  function orderPeers(items, getOrder) {
    if (!Array.isArray(items) || items.length < 2) return items || [];
    const decorated = items.map((item, index) => {
      const order = Number(getOrder(item));
      return { item, index, order: Number.isFinite(order) ? order : index };
    });
    return decorated.sort((a, b) => a.order - b.order || a.index - b.index).map(entry => entry.item);
  }
  function axisOffsetRange(start, size, canvasStart, canvasEnd) {
    const available = Math.max(0, canvasEnd - canvasStart);
    const alignStart = canvasStart - start;
    const alignEnd = canvasEnd - (start + size);
    return size > available ? [alignEnd, alignStart] : [alignStart, alignEnd];
  }
  function ensureIds(data) {
    identify(data.projects, 'project');
    (data.projects || []).forEach(project => {
      identify(project.media, 'media');
      identify(project.blocks, 'block');
      identify(project.heroBlocks, 'hero');
    });
    const site = data.site || {};
    Object.values(site.customBlocks || {}).forEach(items => identify(items, 'block'));
    identify(site.gallery?.items, 'gallery');
    identify(site.navigation, 'nav');
    identify(site.socialLinks, 'social');
    site.elementStyles ||= {};
    return data;
  }
  function styleKey(data, path, page, occurrence = 0) {
    let value = data;
    const identity = path.split('.').map(part => {
      value = value?.[part];
      return /^\d+$/.test(part) && value?.id ? value.id : part;
    }).join('/');
    return 'text-' + hash(page + '/' + identity + '/' + occurrence);
  }
  const api = { ensureIds, styleKey, moveTo, orderPeers, axisOffsetRange };
  root.MayinModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
