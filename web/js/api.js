/* The JSON API: same origin cookie, the CSRF header on every write, a 401 sends you to the login. */

/* errors carry status and the parsed body (e.data.error, e.data.duplicate, e.data.locked);
   e.auth is set when the session is gone and the page is already on its way to /login */
export async function api(method, path, body) {
  const opt = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') opt.headers['X-Requested-With'] = 'fetch';
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  if (r.status === 401 && !path.startsWith('/api/login')) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
    const e = new Error('auth'); e.auth = true; throw e;
  }
  let data = null;
  if ((r.headers.get('content-type') || '').includes('json')) data = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error((data && data.error) || 'HTTP ' + r.status); e.status = r.status; e.data = data; throw e; }
  return data;
}

/* opening a link records it; keepalive, so it survives the page going away */
export function markOpened(id) {
  fetch(`/api/bookmarks/${id}/open`, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'X-Requested-With': 'fetch' } }).catch(() => {});
}
