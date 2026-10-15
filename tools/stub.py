#!/usr/bin/env python3
"""Dev stub: the SPEC API in memory, serving web/ at the real paths. python3 tools/stub.py [port] (default 9095); any password logs in.
Dev switches: POST /__stub/fail {"on":true} makes /api/state answer 500, /__stub/delay {"ms":1500} slows it, /__stub/reset reseeds."""
import html, json, os, re, secrets, sys, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler; from urllib.parse import urlsplit, parse_qs, quote

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web'); DAY = 86400; LOCK = threading.Lock()

FOLDERS = [('Home lab', None), ('System', 1), ('Personal', 1), ('Files', 1), ('Work', None), ('Reading', None), ('Shopping', None), ('Docs', None), ('Travel', None)]
# title, url, folder id (None = Inbox), saved days ago, opened days ago or None
LINKS = [('Router', 'http://10.0.0.1', 2, 13, 3), ('Dashboard', 'http://10.0.0.5', 2, 13, 0), ('Containers', 'http://10.0.0.5:8097', 2, 13, 1), ('Status page', 'http://10.0.0.5:8098', 2, 12, 5),
    ('Sync', 'http://10.0.0.5:8099', 2, 12, None), ('Speed test', 'http://10.0.0.5:3011', 2, 12, None), ('Podcasts', 'http://10.0.0.5:8090', 3, 0, 0), ('Recipes', 'http://10.0.0.5:8093', 3, 6, None),
    ('Radio', 'http://10.0.0.5:8094', 3, 6, None), ('Notes', 'http://10.0.0.5:8091', 3, 1, 1), ('Documents', 'http://10.0.0.5:8092', 3, 1, None), ('Cloud files', 'https://files.home.example.net', 4, 11, 0),
    ('Documents', 'http://10.0.0.5:8010', 4, 11, 7), ('Notes', 'http://10.0.0.5:3010', 4, 10, None), ('Passwords', 'http://10.0.0.5:8089', 4, 10, 2), ('Calendar', 'http://10.0.0.5:8095', 4, 9, None),
    ('Git server', 'http://10.0.0.5:8100', 4, 9, None), ('Photos', 'http://10.0.0.5:8101', 4, 8, 0), ('Photos (home)', 'http://10.0.0.6:8101', 4, 8, 3), ('GitHub', 'https://github.com', 5, 9, 1),
    ('Go docs', 'https://go.dev/doc/', 5, 7, None), ('MDN Web Docs', 'https://developer.mozilla.org', 5, 7, 4), ('SQLite', 'https://sqlite.org', 5, 5, None), ('Team docs', 'https://docs.example.com', 5, 5, None),
    ('Issue tracker', 'https://issues.example.com', 5, 4, 2), ('Web.dev', 'https://web.dev', 5, 4, None), ('Wikipedia', 'https://en.wikipedia.org', 6, 3, 1), ('Mozilla', 'https://www.mozilla.org', 6, 3, None),
    ('Project Gutenberg', 'https://www.gutenberg.org', 6, 2, None), ('Internet Archive', 'https://archive.org', 6, 2, 6), ('W3C', 'https://www.w3.org', 6, 10, None), ('Shop', 'https://shop.example.com', 7, 2, None),
    ('Hardware store', 'https://store.example.org', 7, 2, None), ('Orders', 'https://shop.example.com/orders', 7, 2, 9), ('Python docs', 'https://docs.python.org/3/', 8, 6, None),
    ('Rust book', 'https://doc.rust-lang.org/book/', 8, 6, None), ('Home lab notes', 'https://wiki.example.net', 8, 12, 4), ('OpenStreetMap', 'https://www.openstreetmap.org', 9, 8, None),
    ('Train times', 'https://trains.example.com', 9, 8, None), ('Weather', 'https://weather.example.com', 9, 1, 1), ('Example', 'https://example.com', None, 0, None)]
PINS = ['Dashboard', 'Cloud files', 'Photos', 'Podcasts', 'Containers', 'GitHub']
# neutral drawn marks: file -> (tile colour, svg body on a 64 grid)
ICONS = {
    'dashboard.svg': ('#3b4cca', '<rect x="14" y="14" width="16" height="16" rx="4" fill="#fff"/><rect x="34" y="14" width="16" height="16" rx="4" fill="#fff" opacity=".6"/><rect x="14" y="34" width="36" height="16" rx="4" fill="#fff" opacity=".85"/>'),
    'cloud-files.svg': ('#1f4a55', '<path d="M20 44h26a10 10 0 0 0 0-20 14 14 0 0 0-27 3 9 9 0 0 0 1 17Z" fill="#9fe3f0"/>'),
    'photos.svg': ('#e9e6df', '<circle cx="26" cy="27" r="11" fill="#f2994a"/><circle cx="38" cy="27" r="11" fill="#56ccf2" opacity=".85"/><circle cx="32" cy="38" r="11" fill="#6fcf97" opacity=".85"/>'),
    'podcasts.svg': ('#141414', '<path d="M24 18v28l22-14Z" fill="#b48cff"/>'),
    'containers.svg': ('#2a2a2e', '<rect x="16" y="16" width="14" height="14" rx="2" fill="#7fcfe8"/><rect x="34" y="16" width="14" height="14" rx="2" fill="#7fcfe8"/><rect x="16" y="34" width="14" height="14" rx="2" fill="#7fcfe8"/><rect x="34" y="34" width="14" height="14" rx="2" fill="#7fcfe8" opacity=".5"/>'),
}
ICON_OF = {'Dashboard': 'dashboard.svg', 'Cloud files': 'cloud-files.svg', 'Photos': 'photos.svg', 'Podcasts': 'podcasts.svg', 'Containers': 'containers.svg'}
def url_key(u):  # scheme and host lowercased, default port dropped, fragment dropped, the rest kept
    p = urlsplit(u.strip()); scheme, host, port = p.scheme.lower(), (p.hostname or '').lower(), p.port
    port = None if (scheme, port) in (('http', 80), ('https', 443)) else port
    return f'{scheme}://{host}{":" + str(port) if port else ""}{p.path}{"?" + p.query if p.query else ""}'
def host_of(u):
    p = urlsplit(u); return (p.hostname or '') + (f':{p.port}' if p.port else '')
def valid(u):
    try: p = urlsplit(u.strip()); return p.scheme in ('http', 'https') and bool(p.hostname)
    except ValueError: return False
class DB:
    def __init__(self):
        now = int(time.time()); self.seq = 0; self.folders = {}; self.bms = {}; self.shares = {}
        self.settings = {'last_folder': 3, 'recent_folders': [3, 4, 5]}
        for i, (name, parent) in enumerate(FOLDERS, 1):
            self.folders[i] = {'id': i, 'parent_id': parent, 'name': name,
                               'position': sum(1 for f in FOLDERS[:i - 1] if f[1] == parent)}
        for t, u, f, saved, opened in LINKS:
            b = self.add(t, u, f, now - saved * DAY - 3600)
            b['opened_at'] = now - opened * DAY - 600 if opened is not None else None
            if t in ICON_OF: b['icon'], b['tile'] = '/icons/' + ICON_OF[t], ICONS[ICON_OF[t]][0]
            if t in PINS: b['pinned'], b['pinned_position'] = 1, PINS.index(t)
        old = self.add('Old dashboard', 'http://10.0.0.5:8080', 2, now - 12 * DAY)
        old['deleted_at'] = now - 2 * DAY
    def add(self, title, url, folder, at=None):
        self.seq += 1; at = at or int(time.time())
        pos = sum(1 for b in self.bms.values() if b['folder_id'] == folder and not b['deleted_at'])
        b = {'id': self.seq, 'folder_id': folder, 'title': title, 'url': url, 'url_key': url_key(url),
             'position': pos, 'pinned': 0, 'pinned_position': 0, 'icon': None, 'tile': None,
             'created_at': at, 'updated_at': at, 'opened_at': None, 'deleted_at': None}
        self.bms[b['id']] = b; return b
    def out(self, b):
        o = {k: v for k, v in b.items() if k != 'url_key'}
        o['host'] = host_of(b['url']); o['letter'] = (b['title'][:1] or '?').upper()
        o['pinned'] = bool(b['pinned']); return o
    def live_key(self, key, skip=None):
        return next((b for b in self.bms.values() if b['url_key'] == key and not b['deleted_at'] and b['id'] != skip), None)
    def descendants(self, fid):
        out, todo = [], [fid]
        while todo: x = todo.pop(); out.append(x); todo += [f['id'] for f in self.folders.values() if f['parent_id'] == x]
        return out
    def share_of(self, fid, base):
        t, sh = next(((t, x) for t, x in self.shares.items() if x['folder_id'] == fid), (None, None))
        return t and {'token': t, 'url': f'{base}/s/{t}', 'has_password': bool(sh['password']), 'expires_at': sh['expires_at'], 'opens': sh['opens'], 'last_opened_at': sh['last']}
    def chain(self, fid):  # the folder and its parents
        out = []
        while fid in self.folders: out.append(fid); fid = self.folders[fid]['parent_id']
        return out
    def hidden(self, public=False):  # folders whose contents are hidden: a lock on them or above that is not open (a visitor of a share never has one open)
        shut = [f['id'] for f in self.folders.values() if f.get('lock') and (public or UNL.get(f['id'], 0) < time.time())]; return {x for i in shut for x in self.descendants(i)}
    def state(self, base=''):  # locking is inherited; a hidden folder's subfolders and bookmarks are left out, the locked folder itself stays listed by name
        hid = self.hidden(); locked = lambda fid: any(self.folders[x].get('lock') for x in self.chain(fid))
        return {'folders': [dict({k: v for k, v in f.items() if k != 'lock'}, share=self.share_of(f['id'], base), locked=locked(f['id']), unlocked=locked(f['id']) and f['id'] not in hid)
                            for f in self.folders.values() if f['parent_id'] not in hid], 'bookmarks': [self.out(b) for b in self.bms.values() if b['folder_id'] not in hid], 'settings': self.settings, 'version': 'stub'}
    def touch_recent(self, fid):
        if fid is not None: self.settings['last_folder'] = fid; self.settings['recent_folders'] = ([fid] + [x for x in self.settings['recent_folders'] if x != fid])[:3]
db = DB(); SESSIONS = set(); FLAGS = {'fail': False, 'delay': 0}; UNL = {}; WRONG = []; PW = ['']  # folder unlocks until, wrong tries, the login password
def export_html():
    def walk(parent, ind):
        return ''.join(f'{ind}<DT><H3>{html.escape(f["name"])}</H3>\n{ind}<DL><p>\n' + walk(f['id'], ind + '    ') + f'{ind}</DL><p>\n'
                       for f in sorted((f for f in db.folders.values() if f['parent_id'] == parent), key=lambda f: f['position'])) + ''.join(
            f'{ind}<DT><A HREF="{html.escape(b["url"])}" ADD_DATE="{b["created_at"]}">{html.escape(b["title"])}</A>\n'
            for b in sorted((b for b in db.bms.values() if b['folder_id'] == parent and not b['deleted_at']), key=lambda b: b['position']))
    return '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n' + walk(None, '    ') + '</DL><p>\n'
def import_html(text):
    added = skipped = made = 0; stack = [None]; pending = None
    for m in re.finditer(r'<H3[^>]*>(.*?)</H3>|<A\s+([^>]*)>(.*?)</A>|<DL>|</DL>', text, re.I | re.S):
        tok = m.group(0)[:3].upper()
        if m.group(1) is not None:
            name = html.unescape(m.group(1)).strip(); par = stack[-1]
            f = next((f for f in db.folders.values() if f['name'] == name and f['parent_id'] == par), None)
            if not f:
                nid = max(db.folders, default=0) + 1; made += 1
                f = db.folders[nid] = {'id': nid, 'parent_id': par, 'name': name, 'position': sum(1 for x in db.folders.values() if x['parent_id'] == par)}
            pending = f['id']
        elif m.group(2) is not None:
            href = re.search(r'HREF="([^"]*)"', m.group(2), re.I); date = re.search(r'ADD_DATE="(\d+)"', m.group(2), re.I)
            u = html.unescape(href.group(1)) if href else ''
            if not valid(u) or db.live_key(url_key(u)): skipped += 1; continue
            db.add(html.unescape(re.sub('<[^>]+>', '', m.group(3))).strip() or host_of(u), u, stack[-1], int(date.group(1)) if date else None); added += 1
        elif tok == '<DL':
            stack.append(pending if pending is not None else stack[-1]); pending = None
        elif len(stack) > 1: stack.pop()
    return {'added': added, 'skipped': max(skipped, 0), 'folders': made}
MANIFEST = {'name': 'Pinned', 'short_name': 'Pinned', 'start_url': '/', 'display': 'standalone', 'background_color': '#0b0d10', 'theme_color': '#0b0d10',
            'icons': [{'src': f'/icon-{n}.png', 'sizes': f'{n}x{n}', 'type': 'image/png'} for n in (192, 512)],
            'share_target': {'action': '/save', 'method': 'GET', 'params': {'title': 'title', 'text': 'text', 'url': 'url'}}}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body=b'', ctype='application/json', headers=()):
        if isinstance(body, (dict, list)): body = json.dumps(body).encode()
        elif isinstance(body, str): body = body.encode()
        self.send_response(code); self.send_header('Content-Length', str(len(body)))
        if body or code not in (204, 302, 303): self.send_header('Content-Type', ctype)
        for k, v in headers: self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def authed(self):
        m = re.search(r'pinned_session=([0-9a-f]+)', self.headers.get('Cookie', ''))
        return bool(m and m.group(1) in SESSIONS)
    def file(self, rel, ctype):
        with open(os.path.join(WEB, rel), 'rb') as fh: body = fh.read()
        if ctype == 'text/html': body = body.replace(b'{{BASE_URL}}', ('http://' + self.headers.get('Host', '')).encode())
        self.send(200, body, ctype, [('Cache-Control', 'no-store')])
    def body(self):
        n = int(self.headers.get('Content-Length') or 0); return self.rfile.read(n) if n else b''
    def login_cookie(self):
        tok = secrets.token_hex(16); SESSIONS.add(tok)
        return ('Set-Cookie', f'pinned_session={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000')
    def route(self, method):
        u = urlsplit(self.path); path, q = u.path, {k: v[0] for k, v in parse_qs(u.query).items()}
        statics = {'/static/app.css': ('app.css', 'text/css'), '/static/app.js': ('app.js', 'text/javascript'),
                   '/favicon.svg': ('icons/favicon.svg', 'image/svg+xml'), '/icon-192.png': ('icons/icon-192.png', 'image/png'),
                   '/icon-512.png': ('icons/icon-512.png', 'image/png'), '/apple-touch-icon.png': ('icons/apple-touch-icon.png', 'image/png'),
                   '/login': ('login.html', 'text/html')}
        if method == 'GET' and path in statics: return self.file(*statics[path])
        if method == 'GET' and re.fullmatch(r'/static/fonts/[\w.-]+\.woff2', path): return self.file(path[8:], 'font/woff2')
        if method == 'GET' and re.fullmatch(r'/static/js/[\w.-]+\.js', path): return self.file(path[8:], 'text/javascript')
        if method == 'GET' and path == '/manifest.webmanifest':
            return self.send(200, MANIFEST, 'application/manifest+json')
        if method == 'GET' and path.startswith('/icons/') and path[7:] in ICONS:
            tile, body = ICONS[path[7:]]
            return self.send(200, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="{tile}"/>{body}</svg>', 'image/svg+xml')
        if method == 'POST' and path == '/login':
            form = parse_qs(self.body().decode()); nxt = form.get('next', ['/'])[0]; PW[0] = form.get('password', [''])[0]
            return self.send(303, headers=[('Location', nxt if nxt.startswith('/') else '/'), self.login_cookie()])
        if method == 'POST' and path == '/logout':
            return self.send(303, headers=[('Location', '/login'), ('Set-Cookie', 'pinned_session=; Path=/; Max-Age=0')])
        if path.startswith('/__stub/'):
            d = json.loads(self.body() or b'{}'); global db; FLAGS.update({'fail': bool(d.get('on'))} if path.endswith('fail') else {'delay': int(d.get('ms', 0))} if path.endswith('delay') else {})
            if path.endswith('reset'): db = DB(); WRONG.clear()
            if path.endswith(('reset', 'expire')): UNL.clear()
            return self.send(204)
        if path == '/api/login' and method == 'POST': return self.send(204, headers=[self.login_cookie()])
        pages = {'/': 'index.html', '/save': 'save.html', '/bookmarklet': 'bookmarklet.html', '/styleguide': '../tools/styleguide.html'}
        if method == 'GET' and (path in pages or path == '/search'):
            if not self.authed():
                return self.send(302, headers=[('Location', '/login?next=' + quote(self.path, safe=''))])
            if path == '/search': return self.send(302, headers=[('Location', '/#q=' + quote(q.get('q', '')))])
            return self.file(pages[path], 'text/html')
        if path.startswith('/s/'): return self.public_share(method, path)
        if method == 'GET' and path == '/static/share.js': return self.file('share.js', 'text/javascript')
        if not path.startswith('/api/'): return self.send(404, {'error': 'not found'})
        if not self.authed(): return self.send(401, {'error': 'login required'})
        if method != 'GET' and self.headers.get('X-Requested-With') != 'fetch': return self.send(403, {'error': 'missing header'})
        with LOCK:
            try: return self.api(method, path, q)
            except (KeyError, ValueError) as e: return self.send(400, {'error': str(e)})
    def api(self, method, path, q):
        if method == 'GET' and path == '/api/export':
            return self.send(200, export_html(), 'text/html', [('Content-Disposition', 'attachment; filename="bookmarks.html"')])
        if method == 'POST' and path == '/api/import':
            return self.send(200, import_html(self.body().decode('utf-8', 'replace')))
        d = json.loads(self.body() or b'{}') if method in ('POST', 'PATCH', 'PUT', 'DELETE') else {}
        m = re.fullmatch(r'/api/folders/(\d+)/(lock|unlock|relock)', path); f = m and db.folders.get(int(m.group(1)))
        if m and method in ('POST', 'DELETE'):  # locked folders: lock, unlock for 10 minutes, relock, remove with the app password
            if not f or f['parent_id'] in db.hidden(): return self.send(404, {'error': 'not found'})
            if m.group(2) == 'relock': UNL.pop(f['id'], None); return self.send(204)
            if m.group(2) == 'lock' and method == 'POST' and f['id'] in db.hidden(): return self.send(404, {'error': 'not found'})  # a new password needs the folder unlocked
            if m.group(2) == 'unlock' and not f.get('lock'): return self.send(400, {'error': 'folder is not locked'})
            if m.group(2) == 'lock' and method == 'POST':  # locking also ends any share of the folder
                return self.send(400, {'error': 'use at least 4 characters'}) if len(d.get('password') or '') < 4 else [f.update(lock=d['password']), UNL.pop(f['id'], None)] + [db.shares.pop(t) for t, x in list(db.shares.items()) if x['folder_id'] in db.descendants(f['id'])] and self.send(204)
            key = f['id'] if m.group(2) == 'unlock' else 'login'  # 5 wrong tries then 30 s, per folder; removing a lock counts against the login
            if sum(k == key and t > time.time() - 30 for k, t in WRONG) >= 5: return self.send(429, {'error': 'too many tries'})
            if (d.get('password') != f.get('lock')) if m.group(2) == 'unlock' else (d.get('app_password') != PW[0]):
                WRONG.append((key, time.time())); return self.send(429 if sum(k == key and t > time.time() - 30 for k, t in WRONG) >= 5 else 403, {'error': 'wrong password'})
            (UNL.__setitem__(f['id'], time.time() + 600) if m.group(2) == 'unlock' else (f.pop('lock', None), UNL.pop(f['id'], None))); return self.send(204)
        hid = db.hidden(); nf = lambda: self.send(404, {'error': 'not found'})  # anything inside a hidden folder answers as if it did not exist
        m = re.fullmatch(r'/api/bookmarks/(\d+)(/.*)?', path)
        if m and m.group(1) and (b := db.bms.get(int(m.group(1)))) and b['folder_id'] in hid: return nf()
        if path == '/api/bookmarks/bulk' and (any(db.bms[i]['folder_id'] in hid for i in d.get('ids', []) if i in db.bms) or (d.get('action') == 'move' and d.get('folder_id') in hid)): return nf()
        if method in ('POST', 'PATCH', 'PUT') and re.fullmatch(r'/api/bookmarks(/\d+|/order)?', path) and d.get('folder_id') in hid: return nf()
        if method in ('POST', 'PUT') and path in ('/api/folders', '/api/folders/order') and d.get('parent_id') in hid: return nf()
        m = re.fullmatch(r'/api/folders/(\d+)', path)
        if m and (int(m.group(1)) in hid or d.get('parent_id') in hid): return nf()  # a locked folder is renamed, moved or deleted only while unlocked
        if m and method == 'DELETE' and set(db.descendants(int(m.group(1)))) & hid: return self.send(409, {'error': 'this folder holds a locked folder; unlock it first'})
        if path == '/api/bookmarks' and method == 'POST' and (dup := valid(d.get('url', '')) and db.live_key(url_key(d['url']))) and dup['folder_id'] in hid:
            return self.send(409, {'error': 'Already saved', 'duplicate': None, 'locked': True})  # never moves a bookmark out of a locked folder, never says where it is
        if path == '/api/check' and (u := q.get('url', '')) and valid(u) and (dup := db.live_key(url_key(u))) and dup['folder_id'] in hid:
            return self.send(200, {'duplicate': None, 'icon': None, 'locked': True})
        if path == '/api/logout': return self.send(204)
        if path == '/api/state':
            if FLAGS['delay']: time.sleep(FLAGS['delay'] / 1000)
            return self.send(500, {'error': 'database unavailable'}) if FLAGS['fail'] else self.send(200, db.state('http://' + self.headers.get('Host', '')))
        if path == '/api/check':
            u = q.get('url', ''); dup = db.live_key(url_key(u)) if valid(u) else None
            same = next((b for b in db.bms.values() if b['icon'] and valid(u) and host_of(b['url']) == host_of(u)), None)
            return self.send(200, {'duplicate': db.out(dup) if dup else None, 'icon': {'icon': same['icon'], 'tile': same['tile']} if same else None})
        if path == '/api/bookmarks' and method == 'POST':
            if not valid(d.get('url', '')): return self.send(400, {'error': 'url must be http or https'})
            dup = db.live_key(url_key(d['url']))
            if dup and not d.get('force'): return self.send(409, {'duplicate': db.out(dup)})
            if dup:
                dup.update(title=d.get('title') or dup['title'], folder_id=d.get('folder_id'), updated_at=int(time.time()))
                db.touch_recent(d.get('folder_id')); return self.send(200, db.out(dup))
            b = db.add(d.get('title') or host_of(d['url']), d['url'].strip(), d.get('folder_id'))
            same = next((x for x in db.bms.values() if x['icon'] and host_of(x['url']) == host_of(b['url'])), None)
            if same: b['icon'], b['tile'] = same['icon'], same['tile']
            db.touch_recent(d.get('folder_id')); return self.send(201, db.out(b))
        if path == '/api/bookmarks/bulk':
            now = int(time.time()); a = d['action']
            change = {'move': {'folder_id': d.get('folder_id'), 'deleted_at': None}, 'trash': {'deleted_at': now}, 'restore': {'deleted_at': None}, 'pin': {'pinned': 1}, 'unpin': {'pinned': 0}}
            for i in d['ids']:
                if a == 'delete': db.bms.pop(i, None)
                elif i in db.bms: db.bms[i].update(change[a])
            if a == 'move': db.touch_recent(d.get('folder_id'))
            return self.send(204)
        if path in ('/api/bookmarks/order', '/api/pinned/order', '/api/folders/order'):
            for n, i in enumerate(d['ids']): (db.folders if 'folders' in path else db.bms)[i]['pinned_position' if 'pinned' in path else 'position'] = n
            return self.send(204)
        if path == '/api/trash' and method == 'DELETE':
            for i in [i for i, b in db.bms.items() if b['deleted_at'] and b['folder_id'] not in hid]: del db.bms[i]  # trash of a locked folder waits for the unlock
            return self.send(204)
        m = re.fullmatch(r'/api/bookmarks/(\d+)(/open|/restore|/refetch-icon)?', path)
        if m:
            if not (b := db.bms.get(int(m.group(1)))): return self.send(404, {'error': 'not found'})
            if m.group(2) == '/open': b['opened_at'] = int(time.time()); return self.send(204)
            if m.group(2) == '/restore':
                if b['folder_id'] not in db.folders: b['folder_id'] = None
                b['deleted_at'] = None; return self.send(204)
            if m.group(2): return self.send(204)
            if method == 'DELETE':
                db.bms.pop(b['id']) if q.get('permanent') == '1' else b.update(deleted_at=int(time.time())); return self.send(204)
            if 'url' in d:
                if not valid(d['url']): return self.send(400, {'error': 'url must be http or https'})
                dup = db.live_key(url_key(d['url']), skip=b['id'])
                if dup: return self.send(409, {'duplicate': db.out(dup)})
                b['url'], b['url_key'] = d['url'].strip(), url_key(d['url'])
            if 'title' in d: b['title'] = d['title'].strip() or b['title']
            if 'folder_id' in d: b['folder_id'] = d['folder_id']; db.touch_recent(d['folder_id'])
            if 'pinned' in d:
                if d['pinned'] and not b['pinned']: b['pinned_position'] = 1 + max((x['pinned_position'] for x in db.bms.values() if x['pinned']), default=-1)
                b['pinned'] = int(bool(d['pinned']))
            b['updated_at'] = int(time.time()); return self.send(200, db.out(b))
        if path == '/api/folders' and method == 'POST':
            name = (d.get('name') or '').strip()
            if not name: return self.send(400, {'error': 'name required'})
            nid = max(db.folders, default=0) + 1; par = d.get('parent_id')
            f = db.folders[nid] = {'id': nid, 'parent_id': par, 'name': name, 'position': sum(1 for x in db.folders.values() if x['parent_id'] == par)}
            return self.send(201, f)
        m = re.fullmatch(r'/api/folders/(\d+)/share|/api/shares/([\w-]+)', path)
        if m:  # folder sharing: one link per folder, optional password and expiry
            base = 'http://' + self.headers.get('Host', '')
            if m.group(1):
                f = int(m.group(1)); t = secrets.token_urlsafe(12)
                if f not in db.folders or db.folders[f]['parent_id'] in hid: return nf()
                if any(db.folders[x].get('lock') for x in db.chain(f)): return self.send(409, {'error': 'a locked folder cannot be shared'})
                db.shares[t] = {'folder_id': f, 'password': d.get('password') or '', 'expires_at': None, 'opens': 0, 'last': None}
                if d.get('expires_days'): db.shares[t]['expires_at'] = int(time.time()) + d['expires_days'] * DAY
                return self.send(201, db.share_of(f, base))
            sh = db.shares.get(m.group(2))
            if not sh: return self.send(404, {'error': 'not found'})
            if method == 'DELETE': del db.shares[m.group(2)]; return self.send(204)
            if 'password' in d: sh['password'] = d['password'] or ''
            if 'expires_days' in d: sh['expires_at'] = int(time.time()) + d['expires_days'] * DAY if d['expires_days'] else None
            return self.send(200, db.share_of(sh['folder_id'], base))
        m = re.fullmatch(r'/api/folders/(\d+)', path)
        if m:
            f = db.folders.get(int(m.group(1)))
            if not f: return self.send(404, {'error': 'not found'})
            if method == 'DELETE':
                ids = db.descendants(f['id']); now = int(time.time())
                for b in db.bms.values():
                    if b['folder_id'] in ids: b['folder_id'] = None; b['deleted_at'] = b['deleted_at'] or now
                for i in ids: db.folders.pop(i, None)
                db.settings['recent_folders'] = [x for x in db.settings['recent_folders'] if x not in ids]
                return self.send(204)
            if 'parent_id' in d:
                if d['parent_id'] is not None and d['parent_id'] in db.descendants(f['id']):
                    return self.send(400, {'error': 'a folder cannot move into itself'})
                f['parent_id'] = d['parent_id']
                f['position'] = sum(1 for x in db.folders.values() if x['parent_id'] == d['parent_id'] and x is not f)
            if d.get('name', '').strip(): f['name'] = d['name'].strip()
            return self.send(200, f)
        return self.send(404, {'error': 'not found'})
def _public_share(self, method, path):
    m = re.fullmatch(r'/s/([\w-]+)(/data|/unlock|/icons/[\w.-]+)?', path); sh = m and db.shares.get(m.group(1))
    if not sh or (sh['expires_at'] and sh['expires_at'] < time.time()): return self.send(404, '<!doctype html><title>Not found</title><p>This link does not work.', 'text/html')
    t, part = m.group(1), m.group(2) or ''; ok = not sh['password'] or f'share_{t}=ok' in self.headers.get('Cookie', '')
    if part.startswith('/icons/') and part[7:] in ICONS: return self.send(200, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="{ICONS[part[7:]][0]}"/>{ICONS[part[7:]][1]}</svg>', 'image/svg+xml')
    if part == '/unlock':
        good = json.loads(self.body() or b'{}').get('password') == sh['password']
        return self.send(204, headers=[('Set-Cookie', f'share_{t}=ok; Path=/s/{t}; HttpOnly; SameSite=Lax')]) if good else self.send(401, {'error': 'wrong password'})
    if part != '/data': return self.file('share.html', 'text/html')
    if not ok: return self.send(401, {'locked': True, 'folder': {'name': db.folders[sh['folder_id']]['name']}})
    ids = [x for x in db.descendants(sh['folder_id']) if x not in db.hidden(public=True)]; sh['opens'] += 1; sh['last'] = int(time.time())
    bms = [dict({k: b[k] for k in ('id', 'folder_id', 'title', 'url', 'tile', 'created_at')}, host=host_of(b['url']), letter=b['title'][:1].upper(),
                icon=b['icon'] and f'/s/{t}/icons/' + b['icon'].split('/')[-1]) for b in db.bms.values() if b['folder_id'] in ids and not b['deleted_at']]
    return self.send(200, {'folder': {'name': db.folders[sh['folder_id']]['name']}, 'folders': [f for f in db.folders.values() if f['id'] in ids[1:]], 'bookmarks': bms})
H.public_share = _public_share
for _m in ('GET', 'POST', 'PATCH', 'PUT', 'DELETE'): setattr(H, 'do_' + _m, lambda self, m=_m: self.route(m))

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9095; print(f'stub on http://127.0.0.1:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
