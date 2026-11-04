#!/usr/bin/env python3
"""Builds the clickable wireframes of Pinned as it is built (0.1.12, the release-0.1.12 branch from
a1fe24b; the screens the flow test fixes and 0.1.12 changed are drawn as they are now).

    python3 build.py

Writes next to this file: screens/*.html, flows.js, index.html, walk.html, flows/flows.md and
flows/NN-*.mmd. flow-test.md, the record of the flow test of 31.10.2026, is left as it is. The screens share one set of parts (sidebar, search,
toolbar, cards, sheets, phone frame), so a change to a part changes every screen.
Flow steps, their screens and the verdicts of the flow test live in flows_data.py.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SC = {}  # id -> dict(title, area, body, keys)


def reg(sid, title, area, body, keys=None):
    assert sid not in SC, sid
    SC[sid] = dict(title=title, area=area, body=body, keys=keys or {})


# ---------- small parts ----------

def b(w, h=8, s=False):
    return f'<i class="b{" s" if s else ""}" style="width:{w}px;height:{h}px"></i>'


def A(href, inner, cls='', style=''):
    st = f' style="{style}"' if style else ''
    if href:
        return f'<a class="{cls}" href="{href}.html"{st}>{inner}</a>'
    return f'<span class="{cls}"{st}>{inner}</span>'


def pill(label, href=None, pri=False, warn=False, ico=False):
    cls = 'pill' + (' pri' if pri else '') + (' warn' if warn else '') + (' ico' if ico else '')
    return A(href, label, cls)


def big(label, href=None, dis=False):
    return A(href, label, 'bigbtn' + (' dis' if dis else ''))


def tb(label, href=None, warn=False, c=False):
    return A(href, label, 'txtbtn' + (' warn' if warn else '') + (' c' if c else ''))


def inp(text='', href=None, focus=False, mono=False, err=False, ph=False, caret=False, w=None):
    cls = 'inp' + (' focus' if focus else '') + (' mono' if mono else '') + (' err' if err else '')
    inner = (f'<span class="mute">{text}</span>' if ph else text) + ('<i class="caret"></i>' if caret else '')
    return A(href, inner, cls, f'width:{w}px' if w else '')


def fld(label, *a, **k):
    return f'<label class="fl2"><span>{label}</span>{inp(*a, **k)}</label>'


def chip(label, href=None, on=False, dash=False):
    return A(href, label, 'chip' + (' on' if on else '') + (' dash' if dash else ''))


def toast(text, undo=False):
    return f'<div class="toast"><span>{text}</span>{"<span class=u>Undo</span>" if undo else ""}</div>'


def menu(items, left, top, w=210):
    h = []
    for it in items:
        if it == '-':
            h.append('<hr>')
            continue
        label, href = it[0], it[1]
        warn = len(it) > 2 and it[2]
        h.append(A(href, f'<i class="ic2"></i>{label}', 'warn' if warn else ''))
    return f'<div class="mnu" style="left:{left}px;top:{top}px;width:{w}px">{"".join(h)}</div>'


def gesture(label, href, left, top, w, h):
    return f'<a class="gesture" href="{href}.html" style="left:{left}px;top:{top}px;width:{w}px;height:{h}px"><span>{label}</span></a>'


def dlg(inner, w=392, top=130, left=None):
    left = 290 + (990 - w) // 2 if left is None else left
    return f'<div class="blur"></div><div class="dlg" style="left:{left}px;top:{top}px;width:{w}px">{inner}</div>'


def dhead(title, x=None, fav=False, folder=False):
    lead = '<span class="fav">' + '</span>' if fav else ''
    if folder:
        lead = '<i class="lock" style="border-color:var(--glyph)"></i>' if folder == 'lock' else '<span class="chip" style="border:0;padding:0;height:auto"></span>'
    xx = A(x, '&#10005;', 'x') if x else ''
    return f'<div class="dhead">{lead}<h3>{title}</h3>{xx}</div>'


ESC = {'Escape': None}


def keys(**k):
    name = lambda kk: {'Slash': '/'}.get(kk, kk.replace('_', '+'))
    return {name(kk): (v + '.html') for kk, v in k.items() if v}


# ---------- sample data: titles and hosts are bars, folders and counts are text ----------

FOLD = [('Homelab', '8', 0, 'folder'), ('Network', '3', 1, 'folder'), ('Reading', '3', 0, 'reading'),
        ('Finance', 'lock', 0, 'unlock'), ('Work', '2', 0, 'folder')]
W = [(64, 58), (82, 70), (54, 92), (88, 64), (70, 80), (60, 74), (92, 60), (58, 86), (76, 66), (66, 72),
     (84, 62), (62, 88), (72, 76), (90, 58), (56, 84)]
PATH = {'Homelab': 52, 'Network': 88, 'Reading': 50, 'Work': 34, 'Inbox': 36, 'Media': 40}


def card(i, path='Homelab', hov=False, href=None, date=True, pk=None, menu_href='tile-menu'):
    t, h = W[i % len(W)]
    acts = ''
    if hov:
        acts = (f'<span class="acts">{A("folder", "Sh")}{A("open-tab", "Op")}{A("trash-toast", "Tr")}'
                f'{A(menu_href, "...")}</span>')
    tick = '' if pk is None else '<i class="tick"></i>'
    inner = (f'<div class="tm"><span class="fav"></span>{b(t * 1.6, 9)}{b(h * 1.3, 7, True)}</div>'
             f'<div class="st"><i class="dot"></i><span>{path}</span><span class="sp"></span>'
             f'{"<span>Today</span>" if date else ""}</div>{acts}{tick}')
    cls = 'bc' + (' hov' if hov else '') + (' pk' if pk else '')
    return A(href, inner, cls)


def cards(n, path='Homelab', start=0, hov=None, href='open-tab', g5=False, add_tile=False, pk=None):
    items = [card(start + i, path, hov=(hov == i), href=None if hov == i else href,
                  pk=None if pk is None else (i in pk)) for i in range(n)]
    if add_tile:
        items.append(A('add-sheet', '+ Add bookmark', 'addt'))
    return f'<div class="grid{" g5" if g5 else ""}">{"".join(items)}</div>'


# ---------- desktop frame ----------

def side(on='dash', more=False, folders=None, counts=None, extra=None):
    c = dict(all='15', inbox='2', trash='0')
    c.update(counts or {})
    fl = list(folders if folders is not None else FOLD) + list(extra or [])
    item = lambda key, label, href, n='', sub=False, lk=False: A(
        href, f'<i class="ic"></i>{label}' + (f'<span class="n">{n}</span>' if n and n != 'lock' else '')
        + ('<i class="lock" style="margin-left:auto"></i>' if n == 'lock' else ''),
        'si' + (' on' if on == key else '') + (' sub' if sub else '') + (' lk' if lk else ''))
    h = ['<aside class="pside"><div class="brand">Pinned</div>',
         item('dash', 'Dashboard', 'dash'), item('all', 'All bookmarks', 'all', c['all']),
         item('inbox', 'Inbox', 'inbox', c['inbox']),
         f'<div class="slbl"><span>Folders</span>{A("new-folder", "+", "plus")}</div>',
         f'<div class="tree{" clip" if more and len(fl) > 4 else ""}">']
    shown = fl[:4] if more else fl
    for name, n, depth, href in shown:
        h.append(item(name, name, href, n, sub=depth > 0, lk=n == 'lock'))
    h.append('</div><div class="sfoot2">')
    h.append(item('trash', 'Trash', 'trash', c['trash']))
    h.append(A('dash' if more else 'dash-more', f'<i class="ic"></i>More<span class="sp"></span><span class="mute">{"&#709;" if more else "&#8250;"}</span>', 'si'))
    if more:
        for label, href in [('Import', 'import-running'), ('Export', 'export'), ('API tokens', 'tokens-empty'),
                            ('Signed in', 'sessions'), ('How to save', 'howto-computer'), ('Log out', 'login'),
                            ('Source', None)]:
            h.append(A(href, f'<i class="ic"></i>{label}', 'si'))
        h.append(f'<div class="ver"><span>Pinned 0.1.11</span>{A("whats-new", "What&#39;s new", "ink")}</div>')
    h.append('</div></aside>')
    return ''.join(h)


def search(href='palette'):
    return A(href, '<i class="mag"></i>Search bookmarks or press &#8984;K<span class="kc">/</span>', 'psearch')


def tb_dash(sel=True):
    return (f'<div class="ptb"><h2 class="serif">Dashboard</h2><span class="sp"></span>{pill("+ Add", "add-sheet", pri=True)}'
            f'<span class="seg2" style="width:76px"><span class="on">G</span><span>L</span></span>'
            f'{pill("Select", "dash") if sel else ""}</div>')


def tb_folder(name, count, shared=False, menu_href='folder-menu', back='Dashboard', share_href='share-off', add=True, sort=True):
    glyph = A(share_href, '', 'glyph link' + (' on' if shared else ''))
    return (f'{A("dash", "&#8249; " + back, "back")}<div class="ptb" style="margin-top:10px"><h2>{name}</h2><span class="cnt">{count}</span>{glyph}'
            f'<span class="sp"></span>{pill("+ Add", "add-sheet", pri=True) if add else ""}'
            f'<span class="seg2" style="width:76px"><span class="on">G</span><span>L</span></span>'
            f'{pill("Newest", None) if sort else ""}{pill("Select", None)}{A(menu_href, "", "pill ico dots")}</div>')


def dk(sidehtml, tbhtml, body, over='', srch='palette'):
    return (f'<div class="vp">{sidehtml}<div class="pmain">{search(srch)}{tbhtml}'
            f'<div style="flex:1;min-height:0;overflow:hidden;position:relative">{body}</div></div>{over}</div>')


def dash_body(recent='Recently saved', n=10, g5=True, href='open-tab'):
    return (f'<div class="h3serif">{recent}</div><div class="glbl">Today<span>{n}</span></div>'
            + cards(n, 'Homelab', g5=g5, href=href))


def folder_body(n=5, path='Homelab', subs=True, hov=None, add_tile=True, pk=None):
    sub = ('<div class="glbl">Folders</div><div class="grid">'
           + A('folder', f'Network<span class="row gap4">{b(16, 16, True)}{b(16, 16, True)}{b(16, 16, True)}</span>', 'ft')
           + '</div>') if subs else ''
    return sub + '<div class="glbl">Today</div>' + cards(n, path, hov=hov, add_tile=add_tile, pk=pk)


DASH = lambda **k: dk(side(**k.pop('side', {})), tb_dash(), dash_body(), **k)
FOLDER = lambda over='', **k: dk(side('Homelab'), tb_folder('Homelab', '8'), folder_body(), over=over)
READING = lambda over='', shared=False: dk(side('Reading'), tb_folder('Reading', '3', shared=shared), folder_body(3, 'Reading', subs=False), over=over)


# ---------- lone pages, phone, terminal, browser ----------

def lone(inner, top=210, mark='app', foot=''):
    m = '<span class="appmark"></span>' if mark == 'app' else ('<span class="lockmark"><i class="lock"></i></span>' if mark == 'lock' else '')
    f = f'<div class="pagefoot">{foot}</div>' if foot else ''
    return f'<div class="vp" style="background:var(--page)"><div class="lone" style="top:{top}px">{m}{inner}</div>{f}</div>'


def phone(inner, label='Phone, 390 wide', note=''):
    n = f'<span>{note}</span>' if note else ''
    return f'<div class="phwrap"><div class="phlbl"><b>{label}</b>{n}</div><div class="phone">{inner}</div></div>'


def ph_home(tab='dash', body='', over='', folders='5'):
    tabs = ''.join(A(h, l + (f'&#160;<span class="mute" style="font-weight:400;margin-left:4px">{folders}</span>' if k == 'folders' and folders else ''), 'on' if tab == k else '')
                   for k, l, h in [('dash', 'Dashboard', 'p-dash'), ('inbox', 'Inbox', 'p-dash'), ('folders', 'Folders', 'p-folders')])
    return (f'<div class="phtop"><span class="brand">Pinned</span><span class="sp"></span><i class="bulb"></i>{A("p-settings", "", "gear")}</div>'
            f'<div class="ptabs">{tabs}</div><div class="pbody">{body}</div>{ph_bot()}{over}')


def ph_bot():
    return f'<div class="pbot">{A("p-search", "<i class=mag></i>Search bookmarks", "ps")}{A("p-add", "+", "pp")}</div>'


def pcards(n, path='Homelab', href='open-tab'):
    return '<div class="pgrid">' + ''.join(card(i, path, href=href) for i in range(n)) + '</div>'


def term(title, lines, w=980, h=520, left=150, top=120):
    body = ''.join(f'<span class="{c}">{t}</span>' if c else f'<span>{t}</span>' for c, t in lines)
    return (f'<div class="desk"><div class="term" style="left:{left}px;top:{top}px;width:{w}px;height:{h}px">'
            f'<div class="tt"><i></i><i></i><i></i><span>{title}</span></div><div class="tb2">{body}</div></div></div>')


def browser(url, page='', over='', ext_on=False, badge=''):
    bd = f'<span class="bdg">{badge}</span>' if badge else ''
    return (f'<div class="desk"><div class="brw"><div class="bar"><span class="row gap4">{b(10, 10, True)}{b(10, 10, True)}{b(10, 10, True)}</span>'
            f'<span class="url">{url}</span>{A("ext-popup", bd, "ext" + (" on" if ext_on else ""))}</div>'
            f'<div class="pg">{page or (b(420, 18) + b(640, 9, True) + b(600, 9, True) + b(620, 9, True) + b(380, 9, True))}</div></div>{over}</div>')


# ======================= screens =======================

# ---- 01 first start and login ----
reg('term-start', 'Terminal, first start with docker compose', 'Server', term('Terminal, ~/pinned', [
    ('dim2', '$ mkdir data &amp;&amp; sudo chown 1000:1000 data'),
    ('', "$ APP_PASSWORD='choose a long one' docker compose up -d"),
    ('ok', 'Container pinned  Started'),
    ('', '$ docker compose logs pinned'),
    ('', 'pinned 0.1.11 listening on :8080, data in /data'),
    ('dim2', 'Open http://&lt;your server&gt;:9095 and log in with that password.')]) +
    '<a class="gesture" href="login.html" style="left:150px;top:660px;width:300px;height:40px"><span>Open the address in the browser</span></a>')
reg('term-start-error', 'Terminal, start refused: no password, a short one, a data folder it cannot write', 'Server', term('Terminal, ~/pinned', [
    ('', '$ docker compose up -d'),
    ('bad', 'pinned: APP_PASSWORD is not set. Set it, or APP_PASSWORD_FILE, to the password you want to log in with, then start again'),
    ('', "$ APP_PASSWORD='short' docker compose up -d"),
    ('bad', 'pinned: APP_PASSWORD is shorter than 8 characters. Choose a longer password, then start again'),
    ('', '$ docker compose up -d   (./data made by Docker as root)'),
    ('bad', 'pinned: cannot write to /data/icons as user 1000, the user Pinned runs as. On the host, give the folder you mount at /data to that user, for example: sudo chown -R 1000:1000 ./data. Then start again')]) +
    '<a class="gesture" href="term-start.html" style="left:150px;top:660px;width:300px;height:40px"><span>Set a password of 8 or more</span></a>')


def login_page(err='', code=False, filled=False):
    e = f'<span class="errt">{err}</span>' if err else ''
    c = fld('Code', '', None) if code else ''
    return lone('<b class="h2">Pinned</b>' + fld('Password', '&#8226;' * 12 if filled else '', None, focus=True) + c + e
                + big('Log in', 'dash-empty'))


reg('login', 'Login', 'Login', login_page(), {'Enter': 'dash-empty.html'})
reg('login-error', 'Login, wrong password', 'Login', login_page('Wrong password.'))
reg('login-wait', 'Login, wait after wrong tries, with the time the server sent', 'Login', login_page('Too many tries. Wait 30 seconds, then try again.'))
reg('login-code', 'Login with the second factor', 'Login', login_page(code=True))
reg('login-code-error', 'Login, wrong code, both fields emptied', 'Login', login_page('Wrong password or code. A code works once: wait for the next one.', code=True))
reg('p-login', 'Phone, login', 'Phone', phone(
    '<div style="padding:200px 24px 0;display:flex;flex-direction:column;gap:14px"><span class="appmark"></span><b class="h2">Pinned</b>'
    + fld('Password', '', None, focus=True) + big('Log in', 'p-dash-empty') + '</div>'))

EMPTY = ('<div class="empty2"><b>Nothing here yet</b><span class="row gap14">' + A('add-sheet', '+ Add bookmark', 'lnk')
         + A('import-running', 'Import', 'lnk') + '</span><span class="sm">To save from your browser or phone, see '
         + A('howto-computer', 'How to save', 'lnk') + '.</span></div>')
reg('dash-empty', 'Dashboard, first visit, nothing saved', 'Dashboard', dk(
    side(folders=[], counts=dict(all='0', inbox='0')), '<div class="ptb"><h2 class="serif">Dashboard</h2><span class="sp"></span>'
    + pill('+ Add', 'add-sheet', pri=True) + '</div>', EMPTY))
reg('p-dash-empty', 'Phone, Dashboard, nothing saved', 'Phone', phone(ph_home('dash', '<div style="margin-top:220px" class="col gap10"><b class="ink" style="font-size:16px">Nothing here yet</b>'
    + '<span class="row gap14">' + A('p-add', '+ Add bookmark', 'lnk') + A('p-settings', 'Import', 'lnk') + '</span><span class="sm">To save from your browser or phone, see '
    + A('howto-computer', 'How to save', 'lnk') + '.</span></div>', folders='')))

# ---- dashboard and views ----
reg('dash', 'Dashboard', 'Dashboard', DASH(), keys(Slash='palette', n='new-folder'))
reg('dash-more', 'Dashboard, sidebar More open, four folders in view, the actions scroll', 'Dashboard', dk(side(more=True), tb_dash(), dash_body()))
reg('all', 'All bookmarks', 'Dashboard', dk(side('all'), tb_folder('All bookmarks', '15', menu_href=None, share_href=None).replace('glyph link', 'glyph'), '<div class="glbl">Today</div>' + cards(8, 'Homelab')))
reg('inbox', 'Inbox', 'Dashboard', dk(side('inbox'), tb_folder('Inbox', '2', menu_href=None, share_href=None).replace('glyph link', 'glyph'), '<div class="glbl">Today</div>' + cards(2, 'Inbox', add_tile=True)))
reg('open-tab', 'The link opened in a new tab', 'Dashboard', browser('http://10.0.0.5:8080', over=''))
reg('p-dash', 'Phone, Dashboard', 'Phone', phone(ph_home('dash', '<div class="row"><span class="h3serif" style="margin:0">Recently saved</span><span class="sp"></span><span class="seg2" style="width:90px"><span class="on">G</span><span>L</span></span></div><div class="glbl" style="margin:4px 0">Today<span>15</span></div>' + pcards(6))))

# ---- 03 find and open ----


def pal(q='', groups=None, none=False, sel=0):
    h = [f'<div class="pal"><div class="pq"><i class="mag"></i>{q or "<span class=mute>Search bookmarks</span>"}<i class="caret"></i><span class="kc">esc</span></div>']
    if none:
        h.append('<div class="none">No matches.</div>')
    for label, n, items in (groups or []):
        h.append(f'<div class="gl"><span>{label}</span><span>{n}</span></div>')
        for i, (tw, hw, href) in enumerate(items):
            h.append(A(href, f'<span class="fav sm"></span>{b(tw, 9)}{b(hw, 7, True)}<span class="r">{label}</span>', 'it' + (' on' if (label, i) == sel else '')))
    if not groups and not none:
        h.append('<div class="gl"><span>Recently opened</span><span></span></div>')
        h.append(f'<div style="display:flex;gap:10px;padding:6px 20px 18px">{"".join(A("open-tab", "<span class=fav></span>", "") for _ in range(4))}</div>')
    h.append('</div>')
    return '<div class="blur"></div>' + ''.join(h)


HITS = [('Homelab', '2', [(110, 70, 'open-tab'), (60, 70, 'open-tab')])]
reg('palette', 'Search, empty, recent opens', 'Search', DASH(over=pal()), keys(Escape='dash'))
reg('palette-results', 'Search, matches grouped by folder', 'Search', DASH(over=pal('jelly', HITS, sel=('Homelab', 0))), keys(Escape='palette', Enter='open-tab'))
reg('palette-none', 'Search, no matches', 'Search', DASH(over=pal('zzz', none=True)), keys(Escape='palette'))
reg('palette-bar', 'Search opened from the browser address bar', 'Search', dk(side(), tb_dash(), dash_body(), over=pal('portainer', [('Homelab', '1', [(80, 70, 'open-tab')])], sel=('Homelab', 0))
    + '<div class="tip" style="left:340px;top:100px">/search?q=portainer, then /#q=portainer</div>'))
reg('palette-locked', 'Search, a locked folder stays hidden', 'Search', dk(side(folders=FOLD), tb_dash(), dash_body(), over=pal('bank', none=True)), keys(Escape='dash'))
reg('p-search', 'Phone, search', 'Phone', phone(ph_home('dash', pcards(4)) + '<div class="blur"></div><div class="psh" style="top:60px"><div class="grab"></div>'
    + inp('git', None, focus=True, caret=True) + '<div class="plbl">Work</div>' + ''.join(A('open-tab', f'<span class="fav sm"></span>{b(90, 9)}', 'row', 'height:44px') for _ in range(2)) + '</div>'))
reg('all-big', 'All bookmarks after a 100000 link import: the first 240 cards and Show all', 'Search', dk(side('all', counts=dict(all='100000')), tb_folder('All bookmarks', '100000', menu_href=None, share_href=None).replace('glyph link', 'glyph'),
    '<div class="glbl">Today</div>' + cards(12, 'Big 0') + '<div class="row mt14"><span class="sm">Showing 240 of 100000 bookmarks</span><span class="sp"></span>' + pill('Show all 100000', 'all-big') + '</div>'))

# ---- 02 save a link, web ----


def save_form(title='', url='', dupe=None, err='', folders=(('Homelab', True),), picker=False, primary='Save', inbox=True, logout=False, focus='url'):
    d = ''
    if dupe == 'dupe':
        d = '<span class="sm"><b class="red">!</b> <span class="ink">Already saved in Homelab.</span><br><span class="mute">Save anyway moves it here.</span></span>'
    e = f'<span class="errt">{err}</span>' if err else ''
    ch = ''.join(chip(n, None, on=o) for n, o in folders)
    pk = ''
    if picker:
        pk = '<div class="chips">' + ''.join(chip(n, 'add-sheet', on=(n == 'Homelab')) for n in ['Inbox', 'Homelab', 'Homelab / Network', 'Reading', 'Work', 'Media']) + chip('+ New folder', 'new-folder', dash=True) + '</div>'
    lo = A('login', 'Log out', 'sm ink') if logout else ''
    return (f'<div class="dhead"><span class="fav"></span><span class="sp"></span>{lo}{A("dash", "&#10005;", "x")}</div>'
            + fld('Title', title, None, focus=focus == 'title')
            + fld('URL', url, None, mono=True, focus=focus == 'url', caret=focus == 'url')
            + d + e + '<div class="fl2"><span>Folder</span><div class="chips">' + ch + '</div></div>'
            + tb('Choose another folder &#8250;', 'add-picker') + pk
            + (tb('Save to Inbox', 'folder-saved', c=True) if inbox else '') + big(primary, 'folder-saved'))


reg('add-sheet', 'Add, the save sheet', 'Save', DASH(over=dlg(save_form())), keys(Escape='dash'))
reg('add-noscheme', 'Add, address without http refused', 'Save', DASH(over=dlg(save_form(url='example.com', err='Enter a full address starting with http or https.')).replace('URL</span><a', 'URL</span><a')))
reg('add-stale', 'Add, address fixed, the old error is gone', 'Save', DASH(over=dlg(save_form(url='http://10.0.0.5:8080', dupe='dupe', primary='Save anyway'))))
reg('add-dupe', 'Add, already saved', 'Save', DASH(over=dlg(save_form(url='http://10.0.0.5:8080', dupe='dupe', primary='Save anyway'))))
reg('add-newport', 'Add, same host on another port is new', 'Save', DASH(over=dlg(save_form(title='Jellyfin new port', url='http://10.0.0.5:8096/', focus='title'))))
reg('add-picker', 'Add, every folder', 'Save', DASH(over=dlg(save_form(url='http://10.0.0.5:8096/', picker=True), w=420, top=90)))
reg('folder-saved', 'Saved, the card is in the folder', 'Save', dk(side('Homelab'), tb_folder('Homelab', '9'), folder_body(6)))
reg('p-add', 'Phone, Add sheet', 'Phone', phone(ph_home('dash', pcards(4)) + '<div class="blur"></div><div class="psh"><div class="grab"></div>'
    + save_form(folders=(('Homelab / Network', True), ('Homelab', False))).replace('href="dash.html"', 'href="p-dash.html"').replace('folder-saved.html', 'p-dash.html') + '</div>'))

# ---- bookmarklet, save page, how to save ----


def howto(tab, steps):
    tabs = ''.join(A(h, t, 'on' if t == tab else '') for t, h in [('iPhone', 'howto-iphone'), ('Computer', 'howto-computer'), ('Android', 'howto-iphone'), ('Extension', 'howto-extension')])
    st = ''.join(f'<div class="hstep"><span>{i + 1}</span><div class="hc">{s}</div></div>' for i, s in enumerate(steps))
    return (f'<div class="vp" style="background:var(--page)"><div class="howto">{A("dash", "&#8249; Pinned", "back")}<b class="h2">How to save</b>'
            f'<span class="mute">Keep the page you are on, from any browser.</span><div class="htabs">{tabs}</div>{st}'
            f'<span class="sm mute">&#9656; Show the Save code</span>{A("login", "Log out", "sm ink")}</div></div>')


reg('howto-computer', 'How to save, Computer', 'Save', howto('Computer', [
    'Show the bookmarks bar.<div class="row sm mute mt8">Brave, Chrome <span class="kcap">Cmd</span><span class="kcap">Shift</span><span class="kcap">B</span>&#160;&#160; Safari: View, Show Favorites Bar</div>',
    'Drag this button into the bar.<div class="box w mt8 row">' + b(30, 8, True) + '<span class="ink sm">Save to Pinned</span>' + b(30, 8, True) + '</div>'
    + '<a class="gesture" href="save-page.html" style="position:relative;width:150px;height:36px;margin-top:8px"><span>Drag to the bar</span></a>',
    'On a page you want to keep, click <b>Save to Pinned</b>.']))
reg('howto-extension', 'How to save, Extension', 'Save', howto('Extension', [
    'Download it, unzip it, and keep the folder where it can stay. If it moves, the browser drops the extension.<div class="mt8">' + pill('Download the extension') + '</div>',
    'Load the folder.<div class="sm mute mt8">Brave, Chrome, Edge: Extensions, Developer mode, Load unpacked</div><div class="sm mute">Firefox: about:debugging, This Firefox, Load temporary add-on, manifest.json</div><div class="sm mute">Firefox removes it when it quits. After a restart, load it again and give it a new token.</div>',
    'In its options, enter your address and ' + A('tokens-empty', 'a token', 'lnk') + '. Allow access to your server when asked.' + '<div class="mt8">' + A('ext-options', 'Open the options (extension)', 'sm ink') + '</div>',
    'Open it <span class="kcap">Option</span><span class="kcap">Shift</span><span class="kcap">S</span>']))
reg('howto-iphone', 'How to save, iPhone and Android', 'Save', howto('iPhone', [
    'Copy the Save code.<div class="mt8">' + pill('Copy the Save code') + '</div>',
    'Tap Share, then Add Bookmark. Name it Save, put it in Favorites.',
    'Open bookmarks, hold Save, tap Edit. Paste the code as its address.',
    'On a page you want to keep: bookmarks, Save.<div class="sm mute mt8">Android: add Pinned to the home screen, then Share, Pinned.</div>']))
SAVEPAGE = ('<div class="vp" style="background:var(--page)"><div class="dlg" style="left:420px;top:120px;width:440px">'
            + save_form('&lt;page title&gt;', 'https://&lt;page&gt;/', folders=(('Homelab / Network', True), ('Homelab', False)), logout=True, focus='title').replace('folder-saved.html', 'save-done.html').replace('href="dash.html"', 'href="browser-page.html"') + '</div></div>')
reg('save-page', 'Save page from the bookmarklet (/save)', 'Save', SAVEPAGE)
reg('save-done', 'Save page, saved, window closes or shows Done', 'Save', '<div class="vp" style="background:var(--page)"><div class="dlg" style="left:420px;top:220px;width:440px">'
    '<span class="fav" style="background:var(--accent);border-color:var(--accent)"></span><b class="h2">Saved</b><span class="ink">' + b(140, 9) + ' in Homelab / Network</span>' + big('Done', 'dash') + '</div></div>')
reg('browser-page', 'Any web page with the Save to Pinned button', 'Save', browser('https://&lt;page&gt;/', over='<a class="gesture" href="save-page.html" style="left:240px;top:48px;width:130px;height:24px"><span>Save to Pinned in the bar</span></a>'))

# ---- extension ----


def xpop(inner):
    return f'<div class="xpop">{inner}</div>'


reg('ext-options', 'Extension options, empty', 'Extension', browser('chrome-extension://.../options.html', page=(
    '<div class="opt"><b class="h2">Pinned</b><span class="sm">Connect the extension to your Pinned server. Create a token in the app and paste it here.</span>'
    + fld('Address', '10.0.0.5:9095 or https://bookmarks.example.com', None, ph=True, focus=True) + fld('Token', 'tk_', None, ph=True)
    + '<span class="note2">Kept in this browser only. The extension talks to this address and nowhere else.</span>'
    + f'<div class="row">{pill("Test", "ext-options-fail")}{pill("Save", "ext-options-ok", pri=True)}</div>'
    + '<b class="ink mt14">Shortcut</b><span class="sm"><span class="kcap">Alt</span> <span class="kcap">Shift</span> <span class="kcap">S</span> opens the save popup.</span></div>')))
reg('ext-options-fail', 'Extension options, nothing answers, Test names both addresses it tried', 'Extension', browser('chrome-extension://.../options.html', page=(
    '<div class="opt"><b class="h2">Pinned</b>' + fld('Address', '10.0.0.5:9059', None) + fld('Token', '&#8226;' * 30, None)
    + f'<div class="row">{pill("Test", "ext-options-ok")}{pill("Save", "ext-options-ok", pri=True)}</div>'
    + '<span class="errt">! Could not reach https://10.0.0.5:9059 or http://10.0.0.5:9059. Check the address and that Pinned is running.</span><span class="note2">Without a scheme it tries https, then http. Save stores nothing when neither answers.</span></div>')))
reg('ext-options-ok', 'Extension options, the address as typed, Test found it on http', 'Extension', browser('chrome-extension://.../options.html', page=(
    '<div class="opt"><b class="h2">Pinned</b>' + fld('Address', '10.0.0.5:9095', None) + fld('Token', '&#8226;' * 30, None)
    + f'<div class="row">{pill("Test")}{pill("Save", "ext-popup", pri=True)}</div>'
    + '<span class="okt">&#10003; Connected to http://10.0.0.5:9095, 5 folders.</span><span class="note2">Save asks the browser for access to 10.0.0.5, keeps http://10.0.0.5:9095 and says Saved http://10.0.0.5:9095.</span></div>')))
reg('ext-options-plain', 'Extension options, an http:// address outside the own network: Test warns first, a second click connects', 'Extension', browser('chrome-extension://.../options.html', page=(
    '<div class="opt"><b class="h2">Pinned</b>' + fld('Address', 'http://bookmarks.example.com', None) + fld('Token', '&#8226;' * 30, None)
    + f'<div class="row">{pill("Test", "ext-options-ok")}{pill("Save", "ext-popup", pri=True)}</div>'
    + '<span class="errt">! On plain http your token may cross the internet unencrypted. Use https, or click Test again to connect anyway.</span><span class="note2">A second click of the same button goes ahead; Save says it the same way, "click Save again to save anyway", unless Test already went ahead for this address.</span></div>')))
reg('ext-popup-nosetup', 'Extension popup before setup', 'Extension', browser('https://www.example.com/article', ext_on=True, over=xpop(
    '<div class="dhead"><h3>Set your address and token first</h3><span class="x">&#10005;</span></div>' + big('Open settings', 'ext-options'))))
EXTFORM = ('<div class="dhead"><span class="fav"></span>' + A(None, '&#10005;', 'x') + '</div>' + fld('Title', '<span style="background:var(--sel)">' + b(150, 9) + '</span>', None, focus=True)
           + '<div class="fl2"><span>URL</span><span class="inp mono" style="background:var(--page)">https://www.example.com/article</span></div>')
reg('ext-popup', 'Extension popup', 'Extension', browser('https://www.example.com/article', ext_on=True, over=xpop(
    EXTFORM + '<div class="fl2"><span>Folder</span><div class="chips">' + chip('Homelab') + chip('Reading') + chip('Work') + '</div></div>'
    + tb('Choose a folder &#8250;', 'ext-popup-picker') + big('Save to Inbox', 'ext-saved'))), keys(Escape='browser-page', Enter='ext-saved'))
reg('ext-popup-picker', 'Extension popup, every folder', 'Extension', browser('https://www.example.com/article', ext_on=True, over=xpop(
    EXTFORM + '<div class="fl2"><span>Folder</span></div><div class="col gap4">' + ''.join(A('ext-popup', f'<i class="ic"></i>{n}', 'si' + (' on' if n == 'Network' else ''), 'padding-left:' + str(10 + 16 * d) + 'px') for n, d in [('Inbox', 0), ('Homelab', 0), ('Network', 1), ('Reading', 0), ('Work', 0)]) + '</div>'
    + tb('Save to Inbox', 'ext-saved', c=True) + big('Save', 'ext-saved'))))
reg('ext-saved', 'Extension popup, saved, tick, popup closes', 'Extension', browser('https://www.example.com/article', ext_on=True, over=xpop(
    EXTFORM + '<div class="bigbtn">&#10003;</div>')))
reg('ext-popup-dupe', 'Extension popup, already saved', 'Extension', browser('https://www.example.com/article', ext_on=True, over=xpop(
    EXTFORM + '<span class="sm"><b class="red">!</b> <span class="ink">Already saved in Homelab / Network.</span><br><span class="mute">Save anyway moves it here.</span></span>'
    + '<div class="fl2"><span>Folder</span><div class="chips">' + chip('Homelab / Network', on=True) + '</div></div>' + tb('Save to Inbox', 'ext-saved', c=True) + big('Save anyway', 'ext-saved'))))
reg('ext-popup-cannot', 'Extension popup on a browser page', 'Extension', browser('chrome://settings', ext_on=True, over=xpop(
    '<div class="dhead"><h3>This page cannot be saved</h3><span class="x">&#10005;</span></div><span class="sm">Only pages with an http or https address can be saved.</span>')))
reg('ext-context', 'Extension, right click Save to Pinned, badge', 'Extension', browser('https://www.example.com/article', badge='&#10003;', over=menu(
    [('Back', None), ('Reload', None), '-', ('Save to Pinned', 'ext-popup-dupe'), ('Inspect', None)], 520, 300)
    + '<div class="tip" style="left:1030px;top:52px">Badge: &#10003; saved, = already saved, ! failed</div>'))

# ---- 04 organise ----
reg('folder', 'Folder, Homelab', 'Folders', FOLDER(), keys(Slash='palette'))
reg('folder-hover', 'Folder, card actions on hover', 'Folders', dk(side('Homelab'), tb_folder('Homelab', '8'), folder_body(hov=0)))
reg('tile-menu', 'Card, More menu', 'Folders', dk(side('Homelab'), tb_folder('Homelab', '8'), folder_body(hov=0), over=menu(
    [('Move', 'move-sheet'), ('Copy', 'folder'), ('Share', 'folder'), ('Trash', 'trash-toast', True), '-', ('Open', 'open-tab'), ('Rename', 'rename'), ('Pin', 'folder')], 420, 470)), keys(Escape='folder'))
reg('move-sheet', 'Move, folder picker', 'Folders', FOLDER(over=dlg('<div class="dhead"><span class="fav"></span><span class="col gap4">' + b(120, 9) + b(90, 7, True) + '</span></div><div class="fl2"><span>Folder</span><div class="chips">'
    + ''.join(chip(n, 'folder-moved', on=(n == 'Homelab')) for n in ['Inbox', 'Homelab', 'Homelab / Network', 'Reading', 'Work']) + chip('+ New folder', None, dash=True) + '</div></div>', top=240)), keys(Escape='folder'))
reg('folder-moved', 'Moved from the sheet: toast with Undo', 'Folders', dk(side('Homelab'), tb_folder('Homelab', '7'), folder_body(4), over=toast('Moved to Reading', undo=True)))
reg('folder-drag', 'Drag a card onto a sidebar folder', 'Folders', dk(side('Homelab'), tb_folder('Homelab', '8'), folder_body(), over=gesture('Drag the first card onto Reading', 'folder-dragged', 30, 368, 240, 40)))
reg('folder-dragged', 'Dropped on a folder: toast with Undo', 'Folders', dk(side('Homelab'), tb_folder('Homelab', '7'), folder_body(4), over=toast('Moved to Reading', undo=True)))
reg('rename', 'Rename in place', 'Folders', dk(side('Homelab'), tb_folder('Homelab', '8'), folder_body().replace(b(102.4, 9), '<span class="inp focus" style="height:26px;width:150px">' + b(80, 9) + '<i class="caret"></i></span>', 1)), keys(Enter='folder', Escape='folder'))
reg('trash-toast', 'Moved to Trash, toast with Undo', 'Folders', dk(side('Homelab', counts=dict(trash='1')), tb_folder('Homelab', '7'), folder_body(4), over=toast('Moved to Trash', undo=True)))
TRASH_TB = (A('dash', '&#8249; Dashboard', 'back') + '<div class="ptb" style="margin-top:10px"><h2>Trash</h2><span class="cnt">1</span><span class="sp"></span>'
            '<span class="seg2" style="width:76px"><span class="on">G</span><span>L</span></span>' + pill('Select') + pill('Empty trash', 'empty-confirm', warn=True) + '</div>')
reg('trash', 'Trash', 'Folders', dk(side('trash', counts=dict(trash='1')), TRASH_TB, '<div class="glbl"><span>Kept for 30 days</span></div><div class="grid">' + card(3, 'Homelab / Network', href='trash-menu') + '</div>'))
reg('trash-menu', 'Trash, card menu', 'Folders', dk(side('trash', counts=dict(trash='1')), TRASH_TB, '<div class="glbl"><span>Kept for 30 days</span></div><div class="grid">' + card(3, 'Homelab / Network') + '</div>', over=menu([('Restore', 'folder'), '-', ('Delete now', 'purge-confirm', True)], 420, 330)))
reg('purge-confirm', 'Delete now, asks first', 'Folders', dk(side('trash', counts=dict(trash='1')), TRASH_TB, '', over=dlg('<div class="dhead"><h3>Delete now?</h3></div><span class="ink">' + b(120, 9) + ' will be deleted for good.</span><div class="btns">' + tb('Cancel', 'trash') + pill('Delete now', 'trash', warn=True) + '</div>', top=280)))
reg('empty-confirm', 'Empty trash, asks first', 'Folders', dk(side('trash', counts=dict(trash='1')), TRASH_TB, '', over=dlg('<div class="dhead"><h3>Empty trash?</h3></div><span class="ink">1 bookmark will be deleted for good.</span><div class="btns">' + tb('Cancel', 'trash') + pill('Empty trash', 'dash', warn=True) + '</div>', top=280)))
reg('new-folder', 'New folder sheet', 'Folders', DASH(over=dlg('<div class="dhead"><h3>New folder</h3></div>' + fld('Name', 'Media', None, focus=True, caret=True) + big('Create', 'folder-empty'), top=240)), keys(Enter='folder-empty', Escape='dash'))
MEDIA = [('Homelab', '8', 0, 'folder'), ('Network', '3', 1, 'folder'), ('Reading', '3', 0, 'reading'), ('Finance', 'lock', 0, 'unlock'), ('Work', '2', 0, 'folder'), ('Media', '0', 0, 'folder-empty')]
reg('folder-empty', 'New folder, empty', 'Folders', dk(side('Media', folders=MEDIA), tb_folder('Media', '0', sort=False, menu_href='folder-menu-media'),
    '<div class="glbl">&#160;</div><div class="box w col gap10" style="width:420px"><b class="ink">Nothing here yet</b><span class="row gap14">' + A('add-to', '+ Add bookmarks', 'lnk') + A('add-sheet', 'New bookmark', 'lnk') + '</span></div>'))
reg('add-to', 'Add bookmarks to Media, pick existing ones', 'Folders', dk(side('Media', folders=MEDIA), tb_folder('Media', '0'), '', over=dlg(
    '<div class="dhead"><h3>Add to Media</h3><span class="x">&#10005;</span></div>' + inp('Search bookmarks', None, ph=True)
    + '<div class="plbl">Inbox</div>' + ''.join(f'<div class="row2"><i class="tick" style="position:static;width:16px;height:16px;border-radius:4px;border:1.5px solid var(--rule);{"background:var(--accent);border-color:var(--accent)" if i < 2 else ""}"></i><span class="fav sm"></span>{b(110 - i * 10, 9)}</div>' for i in range(2))
    + '<div class="plbl">Homelab</div>' + ''.join(f'<div class="row2"><i style="width:16px;height:16px;border-radius:4px;border:1.5px solid var(--rule)"></i><span class="fav sm"></span>{b(90 + i * 12, 9)}</div>' for i in range(3))
    + big('Move 2 to Media', 'folder-filled'), w=440, top=70)))
reg('folder-filled', 'Media with the two links, toast with Undo', 'Folders', dk(side('Media', folders=MEDIA[:-1] + [('Media', '2', 0, 'folder-filled')]), tb_folder('Media', '2', menu_href='folder-menu-media'), folder_body(2, 'Media', subs=False), over=toast('Moved 2 to Media', undo=True)))
FMENU = [('Share', 'share-off'), ('Add bookmarks', 'add-to'), ('New folder inside', 'new-folder'), ('Rename', 'new-folder'), ('Move to', 'fmove'), ('Hide from Recent', 'folder'), ('Lock with a password', 'lock-sheet'), '-', ('Delete', 'delete-folder', True)]
reg('folder-menu', 'Folder actions, Share first', 'Folders', dk(side('Homelab'), tb_folder('Homelab', '8'), folder_body(), over=menu(FMENU, 1028, 150)), keys(Escape='folder'))
reg('folder-menu-media', 'Folder actions for Media', 'Folders', dk(side('Media', folders=MEDIA[:-1] + [('Media', '2', 0, 'folder-filled')]), tb_folder('Media', '2'), folder_body(2, 'Media', subs=False), over=menu(FMENU, 1028, 150)), keys(Escape='folder-filled'))
reg('fmove', 'Move a folder', 'Folders', FOLDER(over=dlg('<div class="dhead"><h3>Homelab</h3></div><div class="fl2"><span>Move to</span><div class="chips">' + ''.join(chip(n, 'folder', on=(n == 'Top level')) for n in ['Top level', 'Reading', 'Work', 'Media']) + '</div></div>', top=260)), keys(Escape='folder'))
reg('delete-folder', 'Delete a folder, asks first', 'Folders', dk(side('Media', folders=MEDIA[:-1] + [('Media', '2', 0, 'folder-filled')]), tb_folder('Media', '2'), folder_body(2, 'Media', subs=False), over=dlg(
    '<div class="dhead"><h3>Delete Media?</h3></div><span class="ink">2 bookmarks go to Trash.</span><div class="btns">' + tb('Cancel', 'folder-filled') + pill('Delete folder', 'dash', warn=True) + '</div>', top=280)))
reg('p-folders', 'Phone, Folders', 'Phone', phone(ph_home('folders', '<div class="pgrid">' + A('all', 'All bookmarks', 'ft') + ''.join(A('p-folder' if n != 'Finance' else 'p-lock', n + (' <i class="lock"></i>' if n == 'Finance' else ''), 'ft') for n in ['Homelab', 'Reading', 'Finance', 'Work']) + '</div>'
    + '<div class="row2">Trash<span class="sp"></span><span class="mute">0</span></div>')))
PFOLDER_HEAD = ('<div class="phd">' + A('p-folders', '&#8249; Folders', 'sm mute') + '</div><div class="phd" style="padding-top:6px"><span class="t">Homelab</span><span class="mute" style="font-size:20px">8</span>'
                + A('p-share', '', 'glyph link') + '<span class="sp"></span>' + A('p-folder-sheet', '', 'dots ink') + '</div>')
reg('p-folder', 'Phone, a folder', 'Phone', phone(PFOLDER_HEAD + '<div class="pbody"><div class="row"><span class="ink" style="font-size:16px;font-weight:600">Newest</span><span class="sp"></span><span class="seg2" style="width:90px"><span class="on">G</span><span>L</span></span></div>'
    + pcards(4) + '<a class="gesture" href="p-select.html" style="left:18px;top:56px;width:160px;height:118px"><span>Hold a card to select it</span></a></div>' + ph_bot()))
reg('p-folder-sheet', 'Phone, folder actions sheet', 'Phone', phone(PFOLDER_HEAD + '<div class="pbody">' + pcards(4) + '</div>' + ph_bot() + '<div class="blur"></div><div class="psh"><div class="grab"></div><b class="ink">Homelab</b>'
    + ''.join(A(h, f'<i class="ic"></i>{l}', 'prow' + (' warn' if l == 'Delete' else '')) for l, h in [('Share', 'p-share'), ('Add bookmarks', 'p-folder'), ('New folder inside', 'p-folder'), ('Rename', 'p-folder'), ('Move to', 'p-folder'), ('Hide from Recent', 'p-folder'), ('Lock with a password', 'p-lock'), ('Delete', 'p-folder')]) + '</div>'))
reg('p-select', 'Phone, selecting after a long press', 'Phone', phone(PFOLDER_HEAD + '<div class="pbody"><div class="row"><b class="ink">1 selected</b><span class="sp"></span>' + tb('Done', 'p-folder') + '</div>'
    + '<div class="pgrid">' + ''.join(card(i, 'Homelab', pk=(i == 0)) for i in range(4)) + '</div></div>'
    + '<div class="selbar">' + ''.join(A(h, f'<i></i>{l}', 'warn' if l == 'Trash' else '') for l, h in [('Move', 'p-folder'), ('Copy', 'p-folder'), ('Share', 'p-folder'), ('Trash', 'p-folder'), ('More', 'p-folder')]) + '</div>'))

# ---- 05 locked folders ----
LOCKF = lambda on='dash', more=False: side(on, more=more)
reg('lock-sheet', 'Lock with a password', 'Locks', dk(side('Work'), tb_folder('Work', '2'), folder_body(2, 'Work', subs=False), over=dlg(
    '<div class="dhead"><h3>Work</h3>' + A('folder', '&#10005;', 'x') + '</div>' + fld('Password', '', None, focus=True) + fld('Repeat password', '', None)
    + '<span class="sm">Use at least 8 characters. Links in this folder stay out of sight everywhere until you unlock it. The password cannot be recovered.</span>' + big('Lock', 'locked'), w=360, top=180)), keys(Escape='folder'))
reg('lock-error', 'Lock, passwords too short or not matching', 'Locks', dk(side('Work'), tb_folder('Work', '2'), folder_body(2, 'Work', subs=False), over=dlg(
    '<div class="dhead"><h3>Work</h3>' + A('folder', '&#10005;', 'x') + '</div>' + fld('Password', '&#8226;&#8226;&#8226;', None, focus=True) + fld('Repeat password', '&#8226;&#8226;&#8226;', None)
    + '<span class="sm">Use at least 8 characters. Links in this folder stay out of sight everywhere until you unlock it. The password cannot be recovered.</span><span class="errt">Use at least 8 characters.</span>' + big('Lock', 'locked'), w=360, top=180)))
LOCKED = [('Homelab', '8', 0, 'folder'), ('Network', '3', 1, 'folder'), ('Reading', '3', 0, 'reading'), ('Finance', 'lock', 0, 'unlock'), ('Work', 'lock', 0, 'unlock')]
reg('locked', 'Locked, back on the Dashboard', 'Locks', dk(side(folders=LOCKED, counts=dict(all='13')), tb_dash(), dash_body(n=8), over=toast('Folder locked')))
reg('unlock', 'Unlock dialog, with a close button', 'Locks', dk(side(folders=LOCKED, counts=dict(all='13')), tb_dash(), dash_body(n=8), over=dlg(
    '<div class="dhead"><h3>Finance</h3>' + A('locked', '&#10005;', 'x') + '</div>' + fld('Password', '', None, focus=True) + big('Unlock', 'unlocked'), w=360, top=250)), keys(Escape='locked', Enter='unlocked'))
reg('unlock-wrong', 'Unlock, wrong password', 'Locks', dk(side(folders=LOCKED, counts=dict(all='13')), tb_dash(), dash_body(n=8), over=dlg(
    '<div class="dhead"><h3>Finance</h3>' + A('locked', '&#10005;', 'x') + '</div>' + fld('Password', '', None, focus=True) + '<span class="errt">Wrong password</span>' + big('Unlock', 'unlocked'), w=360, top=250)))
UNL = [('Homelab', '8', 0, 'folder'), ('Network', '3', 1, 'folder'), ('Reading', '3', 0, 'reading'), ('Finance', '2', 0, 'unlocked'), ('Work', 'lock', 0, 'unlock')]
reg('unlocked', 'Finance unlocked for 10 minutes', 'Locks', dk(side('Finance', folders=UNL), tb_folder('Finance', '2', menu_href='unlocked-menu').replace('<h2>', '<i class="lock"></i><h2>'), folder_body(2, 'Finance', subs=False)))
reg('unlocked-menu', 'Unlocked folder actions: Relock now, Remove lock', 'Locks', dk(side('Finance', folders=UNL), tb_folder('Finance', '2'), folder_body(2, 'Finance', subs=False), over=menu(
    [('Add bookmarks', 'unlocked'), ('New folder inside', 'unlocked'), ('Rename', 'unlocked'), ('Move to', 'unlocked'), ('Hide from Recent', 'unlocked'), ('Relock now', 'locked'), ('Remove lock', 'remove-lock'), '-', ('Delete', 'unlocked', True)], 1028, 150)))
reg('remove-lock', 'Remove lock, asks the app password', 'Locks', dk(side('Finance', folders=UNL), tb_folder('Finance', '2'), folder_body(2, 'Finance', subs=False), over=dlg(
    '<div class="dhead"><h3>Finance</h3>' + A('unlocked', '&#10005;', 'x') + '</div><span class="sm">Enter the app password to take the lock off Finance.</span>' + fld('App password', '', None, focus=True) + big('Remove lock', 'folder'), w=360, top=230)))
reg('p-lock', 'Phone, lock dialog, the note below the field', 'Phone', phone(PFOLDER_HEAD.replace('Homelab', 'Work') + '<div class="pbody faded">' + pcards(2, 'Work') + '</div>' + ph_bot()
    + '<div class="blur"></div><div class="pdlg"><div class="dhead"><b class="ink" style="font-size:17px">Work</b>' + A('p-folder', '&#10005;', 'x') + '</div>' + fld('Password', '', None, focus=True) + fld('Repeat password', '', None)
    + '<span class="sm">Use at least 8 characters. Links in this folder stay out of sight everywhere until you unlock it. The password cannot be recovered.</span>' + big('Lock', 'p-folders') + '</div>'))

# ---- 06 share ----


def share_sheet(on=False, locked=False, pw_err=False, pw_form=False, exp=None):
    h = ['<div class="dhead"><h3>Share Reading</h3>' + A('reading', '&#10005;', 'x') + '</div>',
         A('stop-share' if on else 'share-on', 'Share with a link<span class="sw' + (' on' if on else '') + '"></span>', 'row2')]
    if on:
        h.append('<div class="fl2"><span>Link</span><div class="row">' + inp('http://10.0.0.5:9095/s/#cLsg...', None, mono=True, w=250) + tb('Copy', 'share-copied') + '</div></div>')
        h.append(A('share-pw' if not locked else 'share-set', 'Lock with a password<span class="sw' + (' on' if (locked or pw_form) else '') + '"></span>', 'row2'))
        if pw_form:
            h.append('<div class="row">' + inp('&#8226;&#8226;&#8226;&#8226;&#8226;' if pw_err else 'Password', None, ph=not pw_err, focus=True, w=250) + tb('Set', 'share-set') + '</div>')
            if pw_err:
                h.append('<span class="errt">A share password needs at least 8 characters.</span>')
        if locked:
            h.append('<div class="row"><i class="lock"></i><span class="ink">Locked</span><span class="sp"></span>' + tb('Change', 'share-pw') + tb('Remove', 'share-on', warn=True) + '</div>')
        h.append('<div class="fl2"><span>Expires</span><div class="seg2">' + ''.join(f'<span class="{"on" if l == (exp or "Never") else ""}">{l}</span>' for l in ['Never', '1 day', '7 days', '30 days']) + '</div></div>')
        if exp:
            h.append('<span class="note2">Until 7 Nov</span>')
        h.append('<span class="note2">Not opened yet</span>')
    return ''.join(h)


reg('reading', 'Folder, Reading', 'Share', READING())
reg('share-off', 'Share, off', 'Share', READING(dlg(share_sheet(), w=392, top=200)), keys(Escape='reading'))
reg('share-on', 'Share, link on', 'Share', READING(dlg(share_sheet(on=True), w=392, top=130), shared=True), keys(Escape='reading'))
reg('share-copied', 'Share, link copied', 'Share', READING(dlg(share_sheet(on=True), w=392, top=130) + toast('Copied'), shared=True))
reg('share-pw', 'Share, password field', 'Share', READING(dlg(share_sheet(on=True, pw_form=True), w=392, top=110), shared=True))
reg('share-pw-error', 'Share, password too short', 'Share', READING(dlg(share_sheet(on=True, pw_form=True, pw_err=True), w=392, top=100), shared=True))
reg('share-set', 'Share, locked, expires in 7 days', 'Share', READING(dlg(share_sheet(on=True, locked=True, exp='7 days'), w=392, top=110), shared=True))
reg('stop-share', 'Stop sharing, asks first', 'Share', READING(dlg('<div class="dhead"><h3>Stop sharing?</h3></div><span class="ink">People with the link lose access.</span><div class="btns">' + tb('Cancel', 'share-set') + pill('Stop sharing', 'visitor-revoked', warn=True) + '</div>', top=280), shared=True))
VFOOT = 'Shared from Pinned'
reg('visitor-pw', 'Share link, visitor, password', 'Share', lone('<b class="h2">Reading</b>' + fld('Password', '', None, focus=True) + big('Open', 'visitor-open'), mark='lock', foot=VFOOT), keys(Enter='visitor-wrong'))
reg('visitor-wrong', 'Share link, visitor, wrong password', 'Share', lone('<b class="h2">Reading</b>' + fld('Password', '', None, focus=True) + '<span class="errt">Wrong password.</span>' + big('Open', 'visitor-open'), mark='lock', foot=VFOOT))
reg('visitor-open', 'Share link, visitor, the folder', 'Share', '<div class="vp" style="background:var(--page)"><div style="position:absolute;left:176px;top:40px;width:928px;display:flex;flex-direction:column;gap:30px">'
    '<div class="row"><h2 class="h2" style="font-size:22px">Reading</h2><span class="mute" style="font-size:20px">3</span><span class="sp"></span>' + A(None, '<i class="mag"></i>Search Reading', 'psearch', 'width:360px') + '</div>'
    + cards(3, 'Reading') + f'</div><div class="pagefoot">{VFOOT}</div></div>')
reg('visitor-revoked', 'Share link, revoked or expired', 'Share', lone('<b class="h2">Shared folder</b><span class="ink">This link does not work.</span>', mark='', foot=VFOOT))
reg('p-visitor', 'Phone, share link, visitor', 'Phone', phone('<div style="padding:220px 24px 0;display:flex;flex-direction:column;gap:14px"><span class="lockmark"><i class="lock"></i></span><b class="h2">Reading</b>'
    + fld('Password', '', None, focus=True) + big('Open', 'visitor-open') + '</div><div style="margin-top:auto;padding:0 0 26px 130px" class="note2">Shared from Pinned</div>'))
reg('p-share', 'Phone, share sheet', 'Phone', phone(PFOLDER_HEAD.replace('Homelab', 'Reading') + '<div class="pbody">' + pcards(2, 'Reading') + '</div>' + ph_bot() + '<div class="blur"></div><div class="psh"><div class="grab"></div>'
    + share_sheet(on=True).replace('href="reading.html"', 'href="p-folder.html"') + '</div>'))

# ---- 07 import, export ----
reg('import-running', 'Import running: a toast says so, Import is disabled', 'Data', dk(side(folders=[], counts=dict(all='0', inbox='0'), more=True), '<div class="ptb"><h2 class="serif">Dashboard</h2><span class="sp"></span>' + pill('+ Add', 'add-sheet', pri=True) + '</div>',
    EMPTY.replace('margin: 150px', 'margin: 150px') + '<a class="gesture" href="imported.html" style="left:0;top:0;width:640px;height:40px"><span>File picked; Import stays disabled until it ends. Click when it ends.</span></a>' + toast('Importing. This can take a moment for a big file.')))
reg('imported', 'Imported, toast with the counts', 'Data', dk(side(more=True), tb_dash(), dash_body(), over=toast('Imported 15, skipped 0')))
reg('import-bad', 'Import refused, not a bookmarks file', 'Data', dk(side(more=True), tb_dash(), dash_body(), over=toast('Not a bookmark file.') + '<div class="tip" style="left:520px;top:700px">Too deep: The folders in this file nest more than 256 deep. Pinned cannot import it.</div>'))
reg('export', 'Export, bookmarks.html downloaded, locked folders left out', 'Data', dk(side(folders=LOCKED, more=True), tb_dash(), dash_body(), over=
    '<div class="dlg" style="right:16px;top:12px;width:300px;left:auto"><span class="sm ink">Downloads</span><div class="row2"><span class="fav sm"></span><span class="meta">bookmarks.html<small>1.8 KB</small></span></div></div>' + toast('Exported without 2 locked folders. Unlock them first to include them.')))
reg('whats-new', "What's new", 'Data', DASH(over=dlg("<div class='dhead'><h3>What&#39;s new</h3>" + A('dash', '&#10005;', 'x') + "</div><b class='ink'>0.1.12 <span class='mute sm'>This version</span></b><span class='plbl'>New</span>" + ''.join(f'<span class="row gap4">&#8226; {b(260 - i * 20, 7, True)}</span>' for i in range(5)) + "<span class='plbl'>Fixes</span>" + ''.join(f'<span class="row gap4">&#8226; {b(240 - i * 18, 7, True)}</span>' for i in range(4)), w=460, top=80)))

# ---- 08 second factor, signed in ----
reg('term-totp', 'Terminal, turning on the second factor', 'Server', term('Terminal, ~/pinned', [
    ('', "$ python3 -c 'import base64, os; print(base64.b32encode(os.urandom(20)).decode())'"),
    ('dim2', 'JBSWY3DPEHPK3PXP... (20 random bytes in base32)'),
    ('', '$ echo TOTP_SECRET=... &gt;&gt; .env &amp;&amp; docker compose up -d'),
    ('dim2', 'Authenticator app: add an account by hand, time based, 6 digits, 30 seconds.'),
    ('', '$ TOTP_SECRET=ABC docker compose up -d'),
    ('bad', 'pinned: TOTP_SECRET: it holds 0 bytes, it needs at least 16 (26 base32 characters).'),
    ('dim2', 'Lost the authenticator: remove TOTP_SECRET and run docker compose up -d again.')]) +
    '<a class="gesture" href="login-code.html" style="left:150px;top:660px;width:300px;height:40px"><span>Open the login</span></a>')


def sessions_sheet(confirm=False, err=False, done=False):
    rows = [] if done else ['<div class="row2"><span class="meta">Chrome on macOS<small>Signed in on 31 Oct, last used just now</small></span>' + tb('Sign out', 'sessions-confirm', warn=True) + '</div>']
    rows.append('<div class="row2"><span class="meta">Chrome on macOS<small>This browser, signed in on 31 Oct</small></span></div>')
    h = '<div class="dhead"><h3>Signed in</h3>' + A('dash', '&#10005;', 'x') + '</div><div class="plbl">Browsers</div>' + ''.join(rows)
    if confirm:
        h += '<div class="plbl">Sign out all others</div><div class="row">' + inp('App password', None, ph=True, focus=True, w=180) + tb('Cancel', 'sessions') + tb('Sign out', 'sessions-done', warn=True) + '</div>'
        if err:
            h += '<span class="errt">Wrong password</span>'
    elif not done:
        h += '<div class="btns">' + pill('Sign out all others', 'sessions-confirm', warn=True) + '</div>'
    return h


reg('sessions', 'Signed in, two browsers', 'Sessions', DASH(over=dlg(sessions_sheet(), top=200)), keys(Escape='dash'))
reg('sessions-confirm', 'Signed in, sign out others asks the password', 'Sessions', DASH(over=dlg(sessions_sheet(confirm=True), top=200)))
reg('sessions-wrong', 'Signed in, wrong password', 'Sessions', DASH(over=dlg(sessions_sheet(confirm=True, err=True), top=200)))
reg('sessions-done', 'Signed in, others signed out', 'Sessions', DASH(over=dlg(sessions_sheet(done=True), top=220) + toast('Other browsers signed out')))
reg('signed-out-other', 'The other browser after sign out, still showing bookmarks', 'Sessions', dk(side('all'), tb_folder('All bookmarks', '15', menu_href=None, share_href=None).replace('glyph link', 'glyph'), '<div class="glbl">Today</div>' + cards(8)
    + '<div class="tip" style="left:300px;top:300px">Signed out, yet every card still shows until the next request to the server</div>'))

# ---- 09 tokens ----


def tokens_sheet(state='empty', err=False):
    h = '<div class="dhead"><h3>API tokens</h3>' + A('dash', '&#10005;', 'x') + '</div>'
    if state == 'created':
        h += '<div class="plbl">Extension on my laptop</div><div class="row">' + inp('tk_OTJVyb-k1bky7QIOEA8_yhTgp...', None, mono=True, w=260) + tb('Copy', 'token-created') + '</div><span class="note2">Copy it now. It is not shown again.</span><span class="note2">Next, paste it into the extension&#39;s options with the address <b class="ink">http://10.0.0.5:9095</b>, or into your script.</span>'
    else:
        h += '<div class="plbl">New token</div>' + inp('Extension on my laptop', None, ph=state != 'wrong', focus=state == 'empty') + '<div class="row">' + inp('App password', None, ph=True, focus=err, w=280) + tb('Create', 'token-created') + '</div>'
        if err:
            h += '<span class="errt">Wrong password</span>'
    if state in ('empty', 'wrong'):
        h += '<span class="note2">A token lets the extension or a script read your folders and save links. It cannot export, share, lock or delete anything.</span>'
    if state in ('created', 'list', 'revoke'):
        h += '<div class="plbl">Tokens</div>'
        if state == 'revoke':
            h += '<div class="row2"><span class="meta">Revoke Extension on my laptop?<small>Anything using it stops working.</small></span>' + tb('Cancel', 'tokens-list') + tb('Revoke', 'tokens-empty', warn=True) + '</div>'
        else:
            h += '<div class="row2"><span class="meta">Extension on my laptop<small>Created 31 Oct, ' + ('never used' if state == 'created' else 'last used 2 minutes ago') + '</small></span>' + tb('Revoke', 'token-revoke', warn=True) + '</div>'
    return h


reg('tokens-empty', 'API tokens, none yet', 'Tokens', DASH(over=dlg(tokens_sheet(), top=200)), keys(Escape='dash'))
reg('tokens-wrong', 'API tokens, wrong app password', 'Tokens', DASH(over=dlg(tokens_sheet('wrong', err=True), top=200)))
reg('token-created', 'API token shown once', 'Tokens', DASH(over=dlg(tokens_sheet('created'), top=220)), keys(Escape='dash'))
reg('tokens-list', 'API tokens, list', 'Tokens', DASH(over=dlg(tokens_sheet('list'), top=180)))
reg('token-revoke', 'API token, revoke asks first', 'Tokens', DASH(over=dlg(tokens_sheet('revoke'), top=220)))
reg('term-curl', 'Terminal, a script with the token', 'Server', term('Terminal', [
    ('', "$ curl -H 'Authorization: Bearer tk_...' http://10.0.0.5:9095/api/folders"),
    ('ok', '200  [{"id":1,"name":"Homelab"}, ...]'),
    ('', "$ curl -H 'Authorization: Bearer tk_...' http://10.0.0.5:9095/api/export"),
    ('bad', '403  a token cannot export'),
    ('', '$ (after Revoke) curl ... /api/folders'),
    ('bad', '401')]))

# ---- 10 settings ----
reg('term-env', 'Compose file, the settings', 'Server', term('docker-compose.yml', [
    ('', 'environment:'),
    ('', '  APP_PASSWORD: ${APP_PASSWORD:?set APP_PASSWORD}'),
    ('', '  TZ: Europe/Zurich        # nightly export at 03:00'),
    ('', '  BASE_URL: https://bookmarks.example.com'),
    ('', '  TRUSTED_PROXIES: 172.16.0.0/12'),
    ('dim2', '  # also: APP_PASSWORD_FILE, HSTS, SESSION_DAYS, SESSION_MAX_DAYS, TOTP_SECRET, ICONS, ICON_HOSTS, DATA_DIR, PORT'),
    ('dim2', 'A new APP_PASSWORD ends every login, token and device cookie after docker compose up -d.')]))
reg('p-settings', 'Phone, Settings', 'Phone', phone('<div class="phd">' + A('p-dash', '&#8249;', 'ink') + '<span class="t">Settings</span></div><div class="pbody" style="gap:0">'
    + '<div class="row gap10"><span class="appmark"></span><span class="col gap4"><b class="ink" style="font-size:17px">Pinned <span class="mute sm">0.1.11</span></b><span class="sm">15 bookmarks in 6 folders</span></span></div>'
    + '<div class="plbl" style="margin-top:18px">Save</div>' + ''.join(A(h, f'<i class="ic"></i><span>{l}<small>{s}</small></span><span class="ch">&#8250;</span>', 'prow') for l, s, h in [('How to save', 'Bookmarklet and extension', 'howto-iphone'), ('API tokens', 'No tokens yet', 'tokens-empty')])
    + '<div class="plbl" style="margin-top:14px">Data</div>' + ''.join(A(h, f'<i class="ic"></i><span>{l}<small>{s}</small></span><span class="ch">&#8250;</span>', 'prow') for l, s, h in [('Import', 'A bookmarks file from any browser', 'import-running'), ('Export', 'bookmarks.html, written nightly too', 'export')])
    + '<div class="plbl" style="margin-top:14px">About</div>' + ''.join(A(h, f'<i class="ic"></i><span>{l}<small>{s}</small></span><span class="ch">&#8250;</span>', 'prow') for l, s, h in [("What's new", 'Pinned 0.1.11', 'whats-new'), ('Source', 'Open source, AGPL-3.0', None)])
    + '<div style="height:18px"></div>' + A('sessions', '<i class="ic"></i><span>Signed in<small>Your browsers, sign out others</small></span><span class="ch">&#8250;</span>', 'prow') + A('p-login', '<i class="ic"></i>Log out', 'prow warn') + '</div>'))

# ---- 11 backup, versions ----
reg('term-backup', 'Terminal, backing up', 'Server', term('Terminal, ~/pinned', [
    ('', '$ sqlite3 data/bookmarks.db ".backup backup.db"'),
    ('dim2', 'or'),
    ('', '$ docker compose stop &amp;&amp; cp -a data data-backup &amp;&amp; docker compose start'),
    ('dim2', 'Keep secret.key and icons/ with the database. export/bookmarks.html is written every night at 03:00.')]))
reg('term-upgrade', 'Terminal, upgrade names the saved copy', 'Server', term('Terminal, ~/pinned', [
    ('', '$ docker compose pull &amp;&amp; docker compose up -d'),
    ('', '$ docker compose logs pinned'),
    ('ok', 'database: upgrading from schema 6 to 12; the database as it was is saved at /data/bookmarks-schema6-2026-10-31-104549.db'),
    ('', 'pinned 0.1.11 listening on :8080, data in /data')]))
reg('term-downgrade', 'Terminal, the older version refuses', 'Server', term('Terminal, ~/pinned', [
    ('', '$ (image set back to 0.1.10) docker compose up -d'),
    ('', '$ docker compose logs pinned'),
    ('bad', 'pinned: open database: database was written by a newer Pinned (schema 12); this version knows 6. Update the image or restore a backup.'),
    ('dim2', 'No file name, no pointer to Going back to an older version in the README. restart: unless-stopped repeats it.')]))
reg('term-restore', 'Terminal, restoring the saved copy', 'Server', term('Terminal, ~/pinned/data', [
    ('', '$ docker compose stop'),
    ('', '$ mv bookmarks.db bookmarks-new.db &amp;&amp; rm -f bookmarks.db-wal bookmarks.db-shm'),
    ('', '$ cp bookmarks-schema6-2026-10-31-104549.db bookmarks.db &amp;&amp; sudo chown 1000:1000 bookmarks.db'),
    ('', '$ docker compose up -d'),
    ('ok', 'pinned 0.1.10 listening on :8080, data in /data'),
    ('dim2', '15 bookmarks and 5 folders back. Links saved after the upgrade are only in bookmarks-new.db.')]))

# ---- 12 errors ----
reg('save-down', 'Server down, Save fails', 'Errors', DASH(over=dlg(save_form(url='https://down.example/', err='Cannot reach your Pinned server. Check your connection, then try again.'))))
reg('notice-down', 'Server down, could not load, Retry', 'Errors', dk(side('Homelab'), tb_folder('Homelab', '8'), '<div class="notice2"><b>!</b> Cannot reach your Pinned server.<span class="sp"></span>' + pill('Retry', 'notice-down') + '</div><div class="faded">' + folder_body() + '</div>'))
reg('p-notice-down', 'Phone, server down at the first load: the head with the gear, the tabs, the notice', 'Errors', phone(ph_home('dash', '<div class="notice2"><b>!</b> Cannot reach your Pinned server.<span class="sp"></span>' + pill('Retry', 'p-dash') + '</div>')))
reg('browser-down', 'Server down, reload shows the browser error', 'Errors', browser('http://10.0.0.5:9095', page='<b class="h2">This site cannot be reached</b><span class="sm">10.0.0.5 refused to connect. ERR_CONNECTION_REFUSED</span>'))


# ---------- outcomes and the next place a flow goes: dashed targets, shown with h or in walk mode ----------
ALT = {
    'term-start': [('Start without a password', 'term-start-error')],
    'term-start-error': [('Open the address', 'login')],
    'login': [('Wrong password', 'login-error'), ('A revoked share link', 'visitor-revoked')],
    'login-error': [('Five wrong tries', 'login-wait')],
    'login-wait': [('After the wait', 'dash'), ('Later the server stops', 'save-down')],
    'dash-empty': [('On the phone', 'p-login')],
    'p-dash-empty': [('Back on the desktop, filled', 'dash')],
    'dash': [('Log out', 'login'), ('On the phone, search', 'p-search'), ('Signed in, under More', 'sessions')],
    'add-sheet': [('Type example.com, Save', 'add-noscheme')],
    'add-noscheme': [('Fix the address', 'add-stale')],
    'add-stale': [('As it should read', 'add-dupe')],
    'add-dupe': [('Another port', 'add-newport')],
    'folder-saved': [('How to save', 'howto-computer')],
    'howto-computer': [('On a web page', 'browser-page')],
    'save-done': [('How to save, Extension', 'howto-extension')],
    'ext-saved': [('The same page again', 'ext-popup-dupe')],
    'ext-popup-dupe': [('On a browser page', 'ext-popup-cannot')],
    'ext-popup': [('Right click instead', 'ext-context')],
    'ext-context': [('On the phone, How to save', 'howto-iphone')],
    'palette': [('Type jelly', 'palette-results'), ('From the address bar', 'palette-bar')],
    'palette-results': [('Type zzz', 'palette-none')],
    'p-search': [('Search a locked link', 'palette-locked')],
    'palette-locked': [('After a 100000 link import', 'all-big')],
    'folder-filled': [('Folder actions', 'folder-menu')],
    'fmove': [('Hover a card', 'folder-hover')],
    'folder-moved': [('Drag instead', 'folder-drag')],
    'folder-dragged': [('Rename a card', 'rename')],
    'rename': [('Trash a card', 'trash-toast')],
    'empty-confirm': [('Delete a folder', 'delete-folder')],
    'dash-more': [('On the phone', 'p-folders')],
    'lock-sheet': [('Too short', 'lock-error')],
    'locked': [('Search a locked link', 'palette-locked')],
    'unlock': [('Unlocked, folder actions', 'unlocked-menu')],
    'remove-lock': [('On the phone', 'p-lock')],
    'share-set': [('The visitor opens the link', 'visitor-pw')],
    'visitor-open': [('On a phone', 'p-visitor')],
    'p-visitor': [('The owner stops sharing', 'stop-share')],
    'visitor-revoked': [('Lock a shared folder', 'lock-sheet')],
    'imported': [('A file that is not bookmarks', 'import-bad')],
    'export': [('The nightly export', 'term-backup')],
    'login-code': [('Wrong code', 'login-code-error')],
    'login-code-error': [('Five wrong codes', 'login-wait')],
    'sessions-done': [('The other browser', 'signed-out-other')],
    'signed-out-other': [('Lost the authenticator', 'term-totp')],
    'tokens-empty': [('Wrong app password', 'tokens-wrong')],
    'token-created': [('Use it in a script', 'term-curl')],
    'term-curl': [('Back to the list', 'tokens-list')],
    'term-env': [('On the phone, Settings', 'p-settings'), ('Log out', 'login')],
    'p-settings': [('On the desktop, More', 'dash-more')],
    'whats-new': [('The compose file', 'term-env')],
    'term-backup': [('Upgrade', 'term-upgrade')],
    'term-upgrade': [('Go back to 0.1.10', 'term-downgrade')],
    'term-downgrade': [('Restore the copy', 'term-restore')],
    'save-down': [('Close, change view', 'notice-down')],
    'notice-down': [('Reload the page', 'browser-down'), ('On the phone, at the first load', 'p-notice-down')],
    'ext-options-ok': [('An http:// address outside the own network', 'ext-options-plain')],
    'browser-down': [('A bad import file', 'import-bad')],
}
for sid, items in ALT.items():
    SC[sid]['body'] += '<div class="alts">' + ''.join(f'<a class="altg" href="{h}.html">{l}</a>' for l, h in items) + '</div>'


# ---------- write ----------

def page(sid, s):
    k = json.dumps(s['keys']).replace("'", '&#39;')
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1280">'
            f'<title>{s["title"]}</title><link rel="stylesheet" href="../wire.css"></head>'
            f"<body data-keys='{k}'>{s['body']}<script src=\"../wire.js\"></script></body></html>\n")


def main():
    from flows_data import FLOWS, write_all
    out = HERE / 'screens'
    out.mkdir(exist_ok=True)
    for old in out.glob('*.html'):
        if old.stem not in SC:
            old.unlink()
    for sid, s in SC.items():
        (out / f'{sid}.html').write_text(page(sid, s))
    missing = sorted({sc for f in FLOWS for st in f['steps'] for sc in st['screens'] if sc not in SC})
    if missing:
        raise SystemExit(f'flow steps name screens that do not exist: {missing}')
    import re
    bad = sorted({m for s in SC.values() for m in re.findall(r'href="([\w-]+)\.html"', s['body']) if m not in SC})
    if bad:
        raise SystemExit(f'links to screens that do not exist: {bad}')
    write_all(HERE, SC, FLOWS)
    print(f'{len(SC)} screens, {sum(len(f["steps"]) for f in FLOWS)} steps')


if __name__ == '__main__':
    main()
