const encoder = new TextEncoder();
const decoder = new TextDecoder();
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return responseJson({ error: 'Le service d’administration a rencontré une erreur.' }, 500, request, env);
    }
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return corsPreflight(request, env);
  if (url.pathname === '/health') return responseJson({ ok: true, service: 'May’in Studio' }, 200, request, env);
  if (url.pathname === '/auth/login' && request.method === 'GET') return beginLogin(request, env);
  if (url.pathname === '/auth/callback' && request.method === 'GET') return finishLogin(request, env);
  if (url.pathname === '/public/visit' && request.method === 'POST') return recordVisit(request, env);
  if (url.pathname === '/public/message' && request.method === 'POST') return receiveMessage(request, env);
  const session = await requireSession(request, env);
  if (!session) return responseJson({ error: 'Connexion requise.' }, 401, request, env);
  if (url.pathname === '/auth/me' && request.method === 'GET') return responseJson({ user: { login: session.login, avatar: session.avatar }, csrf: session.csrf }, 200, request, env);
  if (url.pathname === '/api/content' && request.method === 'GET') return readContent(request, env, session);
  if (url.pathname === '/api/dashboard' && request.method === 'GET') return readDashboard(request, env);
  if (url.pathname === '/api/messages' && request.method === 'GET') return readMessages(request, env);
  if (url.pathname === '/api/publish' && request.method === 'POST') {
    if (request.headers.get('X-Mayin-CSRF') !== session.csrf) return responseJson({ error: 'Session invalide.' }, 403, request, env);
    return publishContent(request, env, session);
  }
  return responseJson({ error: 'Route inconnue.' }, 404, request, env);
}

async function beginLogin(request, env) {
  assertConfig(env);
  const url = new URL(request.url);
  const state = randomToken(24);
  const requestedReturn = url.searchParams.get('returnTo') || `${env.SITE_ORIGIN}/admin/`;
  const returnTo = safeAdminReturn(requestedReturn, env) || `${env.SITE_ORIGIN}/admin/`;
  const statePayload = await seal({ state, returnTo, exp: Date.now() + 10 * 60_000 }, env.COOKIE_SECRET);
  const redirect = new URL('https://github.com/login/oauth/authorize');
  redirect.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  redirect.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  redirect.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: redirect.toString(), 'Set-Cookie': cookie('mayin_oauth', statePayload, 600, 'Lax'), ...securityHeaders() } });
}

async function finishLogin(request, env) {
  assertConfig(env);
  const url = new URL(request.url);
  const saved = await unseal(readCookie(request, 'mayin_oauth'), env.COOKIE_SECRET);
  if (!saved || saved.exp < Date.now() || saved.state !== url.searchParams.get('state')) return responseJson({ error: 'La connexion a expiré.' }, 400, request, env);
  const code = url.searchParams.get('code');
  if (!code) return responseJson({ error: 'Autorisation manquante.' }, 400, request, env);
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mayin-Studio' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/auth/callback` })
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) return responseJson({ error: 'La connexion a été refusée.' }, 401, request, env);
  const userResponse = await github('/user', tokenData.access_token);
  const user = await userResponse.json();
  if (!userResponse.ok || String(user.login).toLowerCase() !== String(env.ALLOWED_GITHUB_LOGIN).toLowerCase()) return responseJson({ error: 'Ce compte n’est pas autorisé.' }, 403, request, env);
  const session = await seal({ token: tokenData.access_token, login: user.login, avatar: user.avatar_url, csrf: randomToken(18), exp: Date.now() + 7.5 * 60 * 60_000 }, env.COOKIE_SECRET);
  const target = new URL(saved.returnTo);
  target.hash = `session=${encodeURIComponent(session)}`;
  return new Response(null, { status: 302, headers: { Location: target.toString(), 'Set-Cookie': cookie('mayin_oauth', '', 0, 'Lax'), ...securityHeaders() } });
}

async function requireSession(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const sealed = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const session = await unseal(sealed, env.COOKIE_SECRET);
  if (!session || session.exp < Date.now() || String(session.login).toLowerCase() !== String(env.ALLOWED_GITHUB_LOGIN).toLowerCase()) return null;
  return session;
}

function publicRequestAllowed(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || allowedSiteOrigins(env).includes(origin);
}
function allowedSiteOrigins(env) { return [env.SITE_ORIGIN, env.LEGACY_SITE_ORIGIN].filter(Boolean); }
function safeAdminReturn(value, env) {
  try {
    const target = new URL(value);
    return allowedSiteOrigins(env).includes(target.origin) && (target.pathname === '/admin' || target.pathname.startsWith('/admin/')) ? target.toString() : '';
  } catch { return ''; }
}
function monthKey(date = new Date()) { return date.toISOString().slice(0, 7); }
function topEntries(entries, limit = 6) { return Object.entries(entries || {}).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, value]) => ({ label, value })); }
function deviceType(ua = '') { return /tablet|ipad/i.test(ua) ? 'Tablette' : /mobi|android|iphone/i.test(ua) ? 'Mobile' : 'Ordinateur'; }
function botName(ua = '') { if (/googlebot/i.test(ua)) return 'Googlebot'; if (/bingbot/i.test(ua)) return 'Bingbot'; if (/facebookexternalhit/i.test(ua)) return 'Facebook'; if (/linkedinbot/i.test(ua)) return 'LinkedIn'; return /bot|crawler|spider|slurp|preview/i.test(ua) ? 'Autre robot' : ''; }
function increment(target, key) { if (!key) return; target[key] = (target[key] || 0) + 1; }
function analyticsKey(date = new Date()) { return `analytics:v2:${monthKey(date)}`; }
async function anonymize(value, secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret}:${value}`));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function visitIdentity(request, payload, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || '';
  const sessionId = String(payload.sessionId || '');
  if (ip) return `ip-${await anonymize(ip, env.COOKIE_SECRET)}`;
  if (/^v-[a-z0-9-]{12,100}$/i.test(sessionId)) return `session-${await anonymize(sessionId, env.COOKIE_SECRET)}`;
  return `unknown-${await anonymize(request.headers.get('User-Agent') || 'unknown', env.COOKIE_SECRET)}`;
}
async function claimAnalyticsWindow(env, identity, path = '') {
  const ttl = 2 * 60 * 60; const visitKey = `analytics:window:${identity}`;
  const active = await env.STUDIO_DATA.get(visitKey); await env.STUDIO_DATA.put(visitKey, '1', { expirationTtl: ttl });
  if (!path) return { newVisit: !active, newPath: false };
  const pageKey = `analytics:page:${await anonymize(`${identity}:${path}`, env.COOKIE_SECRET)}`;
  const pageSeen = await env.STUDIO_DATA.get(pageKey); await env.STUDIO_DATA.put(pageKey, '1', { expirationTtl: ttl });
  return { newVisit: !active, newPath: !pageSeen };
}

async function recordVisit(request, env) {
  if (!env.STUDIO_DATA || !publicRequestAllowed(request, env)) return responseJson({ ok: true }, 204, request, env);
  const payload = await request.json().catch(() => ({}));
  const path = String(payload.path || '/').slice(0, 160);
  const referer = String(payload.referer || 'Direct').replace(/^https?:\/\//, '').split('/')[0].slice(0, 100) || 'Direct';
  const ua = request.headers.get('User-Agent') || ''; const bot = botName(ua); const country = request.cf?.country || 'Inconnu';
  const city = request.cf?.city || ''; const key = analyticsKey(); const identity = await visitIdentity(request, payload, env);
  const stats = JSON.parse(await env.STUDIO_DATA.get(key) || '{"totals":{"human":0,"bots":0},"paths":{},"referers":{},"countries":{},"cities":{},"devices":{},"bots":{}}');
  const claim = await claimAnalyticsWindow(env, `${bot ? `bot-${bot}` : 'human'}:${identity}`, bot ? '' : path);
  if (bot) { if (claim.newVisit) { stats.totals.bots++; increment(stats.bots, bot); } }
  else if (claim.newVisit) { stats.totals.human++; increment(stats.referers, referer); increment(stats.countries, country); increment(stats.cities, city); increment(stats.devices, deviceType(ua)); }
  if (!bot && claim.newPath) increment(stats.paths, path);
  stats.updatedAt = new Date().toISOString();
  await env.STUDIO_DATA.put(key, JSON.stringify(stats), { expirationTtl: 400 * 24 * 60 * 60 });
  return responseJson({ ok: true }, 200, request, env);
}

async function receiveMessage(request, env) {
  if (!env.STUDIO_DATA || !publicRequestAllowed(request, env)) return responseJson({ error: 'Service indisponible.' }, 503, request, env);
  const body = await request.json().catch(() => ({}));
  if (body.website) return responseJson({ ok: true }, 200, request, env);
  const name = String(body.name || '').trim().slice(0, 80); const email = String(body.email || '').trim().slice(0, 150); const message = String(body.message || '').trim().slice(0, 600);
  if (message.length < 8) return responseJson({ error: 'Écris un message un peu plus détaillé.' }, 400, request, env);
  const id = `${Date.now()}-${randomToken(6)}`;
  await env.STUDIO_DATA.put(`message:${id}`, JSON.stringify({ id, name, email, message, createdAt: new Date().toISOString(), country: request.cf?.country || '' }), { expirationTtl: 180 * 24 * 60 * 60 });
  return responseJson({ ok: true }, 201, request, env);
}

async function readDashboard(request, env) {
  const stats = env.STUDIO_DATA ? JSON.parse(await env.STUDIO_DATA.get(analyticsKey()) || '{"totals":{"human":0,"bots":0},"paths":{},"referers":{},"countries":{},"cities":{},"devices":{},"bots":{}}') : { totals: { human: 0, bots: 0 } };
  return responseJson({ month: monthKey(), human: stats.totals?.human || 0, bots: stats.totals?.bots || 0, paths: topEntries(stats.paths), referers: topEntries(stats.referers), countries: topEntries(stats.countries), cities: topEntries(stats.cities), devices: topEntries(stats.devices), botTypes: topEntries(stats.bots), sessionWindowHours: 2, updatedAt: stats.updatedAt || null }, 200, request, env);
}

async function readMessages(request, env) {
  if (!env.STUDIO_DATA) return responseJson({ messages: [] }, 200, request, env);
  const listed = await env.STUDIO_DATA.list({ prefix: 'message:', limit: 50 });
  const messages = (await Promise.all(listed.keys.map(async ({ name }) => JSON.parse(await env.STUDIO_DATA.get(name) || 'null')))).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return responseJson({ messages }, 200, request, env);
}

async function readContent(request, env, session) {
  const [site, projects] = await Promise.all([
    readJsonFile('content/site.json', env, session.token),
    readJsonFile('content/projects.json', env, session.token)
  ]);
  return responseJson({ site, projects: projects.projects || [] }, 200, request, env);
}

async function publishContent(request, env, session) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 18 * 1024 * 1024) return responseJson({ error: 'La publication dépasse 18 Mo. Ajoute les images en plusieurs fois.' }, 413, request, env);
  const payload = await request.json();
  if (!payload.site || !Array.isArray(payload.projects?.projects)) return responseJson({ error: 'Le contenu envoyé est incomplet.' }, 400, request, env);
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (files.length > 30) return responseJson({ error: 'Publie au maximum 30 nouvelles images à la fois.' }, 400, request, env);
  for (const file of files) {
    if (!/^assets\/uploads\/[a-zA-Z0-9._-]+$/.test(file.path || '') || file.encoding !== 'base64' || typeof file.content !== 'string') return responseJson({ error: 'Une image envoyée est invalide.' }, 400, request, env);
    if (file.content.length > 9_000_000) return responseJson({ error: `L’image ${file.path} est trop lourde.` }, 400, request, env);
  }
  const owner = env.GITHUB_OWNER; const repo = env.GITHUB_REPO; const branch = env.GITHUB_BRANCH || 'main';
  const ref = await githubJson(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, session.token);
  const headSha = ref.object.sha;
  const commit = await githubJson(`/repos/${owner}/${repo}/git/commits/${headSha}`, session.token);
  const entries = /** @type {any[]} */ ([
    { path: 'content/site.json', mode: '100644', type: 'blob', content: `${JSON.stringify(payload.site, null, 2)}\n` },
    { path: 'content/projects.json', mode: '100644', type: 'blob', content: `${JSON.stringify(payload.projects, null, 2)}\n` }
  ]);
  for (const file of files) {
    const blob = await githubJson(`/repos/${owner}/${repo}/git/blobs`, session.token, { method: 'POST', body: JSON.stringify({ content: file.content, encoding: 'base64' }) });
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await githubJson(`/repos/${owner}/${repo}/git/trees`, session.token, { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }) });
  const newCommit = await githubJson(`/repos/${owner}/${repo}/git/commits`, session.token, { method: 'POST', body: JSON.stringify({ message: String(payload.message || 'Mise à jour depuis le Studio May’in').slice(0, 120), tree: tree.sha, parents: [headSha] }) });
  await githubJson(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, session.token, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha, force: false }) });
  return responseJson({ ok: true, sha: newCommit.sha, url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}` }, 200, request, env);
}

async function readJsonFile(path, env, token) {
  const response = await github(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`, token);
  const data = await response.json();
  if (!response.ok || !data.content) throw new Error(`Impossible de lire ${path}`);
  const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, '')), (character) => character.charCodeAt(0));
  return JSON.parse(decoder.decode(bytes));
}

async function githubJson(path, token, options = {}) {
  const response = await github(path, token, options); const data = await response.json();
  if (!response.ok) throw new Error(data.message || `GitHub ${response.status}`);
  return data;
}
function github(path, token, options = {}) {
  return fetch(`https://api.github.com${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Mayin-Studio', ...(options.headers || {}) } });
}

function responseJson(value, status, request, env) {
  return new Response(JSON.stringify(value), { status, headers: { ...jsonHeaders, ...corsHeaders(request, env), ...securityHeaders() } });
}
function corsPreflight(request, env) {
  const origin = request.headers.get('Origin');
  if (!allowedSiteOrigins(env).includes(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
  return new Response(null, { status: 204, headers: { ...corsHeaders(request, env), 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Mayin-CSRF', 'Access-Control-Max-Age': '86400', ...securityHeaders() } });
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  return allowedSiteOrigins(env).includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}
function securityHeaders() { return { 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }; }
function cookie(name, value, maxAge, sameSite) { return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`; }
function readCookie(request, name) { const match = request.headers.get('Cookie')?.match(new RegExp(`(?:^|; )${name}=([^;]*)`)); return match ? match[1] : ''; }
function randomToken(bytes) { const array = crypto.getRandomValues(new Uint8Array(bytes)); return base64Url(array); }
function base64Url(bytes) { let binary = ''; bytes.forEach((byte) => binary += String.fromCharCode(byte)); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function fromBase64Url(value) { const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='); return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)); }
async function cryptoKey(secret) { const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret)); return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(value, secret) { const iv = crypto.getRandomValues(new Uint8Array(12)); const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(secret), encoder.encode(JSON.stringify(value))); return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`; }
async function unseal(value, secret) { try { if (!value || !secret) return null; const [iv, encrypted] = value.split('.'); const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, await cryptoKey(secret), fromBase64Url(encrypted)); return JSON.parse(decoder.decode(decrypted)); } catch { return null; } }
function assertConfig(env) { for (const name of ['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','COOKIE_SECRET','SITE_ORIGIN','GITHUB_OWNER','GITHUB_REPO','ALLOWED_GITHUB_LOGIN']) if (!env[name]) throw new Error(`Configuration manquante: ${name}`); }
