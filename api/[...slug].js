import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SESSION_TTL = 60 * 60 * 12;

const DEFAULT_CONFIG = {
  site: {
    title: 'Seleksi Kekkai Family',
    subtitle: 'Verification Portal · Community',
    status: 'Live',
    footer: '✦ Seleksi Kekkai Family'
  },
  selection: {
    require_cn: true,
    require_vt: true,
    required_hashtag: '#kekkaifamily',
    tiktok_nickname_must_contain: 'kekkai',
    main_group_invite: 'https://chat.whatsapp.com/REPLACE_WITH_REAL_INVITE',
    pending_code_ttl_minutes: 15,
    resurrect_on_success: false
  },
  notifications: {
    enabled: true,
    type: 'info',
    message: 'Selamat datang di portal seleksi Kekkai Family. Pastikan CN dan VT sudah siap sebelum memulai.'
  }
};

const K = {
  config: 'kf:config',
  owner: 'kf:owner',
  admins: 'kf:admins',
  codes: 'kf:codes',
  submissions: 'kf:subs',
  session: (sid) => `kf:sess:${sid}`
};

async function getConfig() {
  const c = await redis.get(K.config);
  if (!c) { await redis.set(K.config, JSON.stringify(DEFAULT_CONFIG)); return DEFAULT_CONFIG; }
  return typeof c === 'string' ? JSON.parse(c) : c;
}
async function setConfig(d) { await redis.set(K.config, JSON.stringify(d)); return d; }

async function ensureOwner() {
  const o = await redis.get(K.owner);
  if (!o) {
    const hash = bcrypt.hashSync('Ryuu123', 10);
    const data = { username: 'RyuuSensei', password_hash: hash, created_at: Date.now() };
    await redis.set(K.owner, JSON.stringify(data));
    return data;
  }
  return typeof o === 'string' ? JSON.parse(o) : o;
}

async function getAdmins() {
  const all = await redis.hgetall(K.admins);
  if (!all) return [];
  return Object.entries(all).map(([username, raw]) => {
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { username, ...d };
  });
}
async function setAdmin(username, data) { await redis.hset(K.admins, { [username]: JSON.stringify(data) }); }
async function delAdmin(username) { await redis.hdel(K.admins, username); }

async function getCodes() {
  const all = await redis.hgetall(K.codes);
  if (!all) return [];
  return Object.entries(all).map(([code, raw]) => {
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { code, ...d };
  });
}
async function setCode(code, data) { await redis.hset(K.codes, { [code]: JSON.stringify(data) }); }
async function delCode(code) { await redis.hdel(K.codes, code); }

async function ensureCodes() {
  const all = await redis.hgetall(K.codes);
  if (all && Object.keys(all).length > 0) return;
  const codes = {};
  const set = new Set();
  while (set.size < 40) {
    set.add('KEKKAI-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5));
  }
  for (const c of set) {
    codes[c] = JSON.stringify({ status: 'fresh', session: null, bound_at: null, used_at: null, cn_verified: false, vt_verified: false });
  }
  await redis.hset(K.codes, codes);
}

async function sweepExpired() {
  const cfg = await getConfig();
  const ttl = (cfg.selection?.pending_code_ttl_minutes ?? 15) * 60 * 1000;
  const codes = await getCodes();
  const now = Date.now();
  const updates = {};
  for (const c of codes) {
    if (c.status === 'pending' && c.bound_at && (now - c.bound_at) > ttl) {
      updates[c.code] = JSON.stringify({ ...c, status: 'expired', session: null, bound_at: null });
    }
  }
  if (Object.keys(updates).length) await redis.hset(K.codes, updates);
}

async function getSubmissions() {
  const list = await redis.lrange(K.submissions, 0, 499);
  return (list || []).map(x => typeof x === 'string' ? JSON.parse(x) : x);
}
async function addSubmission(s) {
  await redis.lpush(K.submissions, JSON.stringify(s));
  await redis.ltrim(K.submissions, 0, 499);
}

async function createSession(role, username, ip) {
  const sid = crypto.randomBytes(24).toString('hex');
  await redis.set(K.session(sid), JSON.stringify({ role, username, created: Date.now(), ip }), { ex: SESSION_TTL });
  return sid;
}
async function getSessionData(sid) {
  if (!sid) return null;
  const s = await redis.get(K.session(sid));
  if (!s) return null;
  return typeof s === 'string' ? JSON.parse(s) : s;
}
async function deleteSession(sid) { if (sid) await redis.del(K.session(sid)); }

async function fetchTikTokNickname(username) {
  const r = await fetch(`https://www.tiktok.com/@${username}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' }
  });
  if (!r.ok) return null;
  const html = await r.text();
  const m = html.match(/"nickname":"([^"]+)"/) || html.match(/<title[^>]*>([^<]+)<\/title>/);
  return m ? m[1].replace(/\\u002F/g, '/').replace(/&#39;/g, "'") : null;
}
async function fetchTikTokCaption(videoUrl) {
  const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`);
  if (!r.ok) throw new Error('oEmbed gagal');
  const j = await r.json();
  return j.title || '';
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(process.env.SESSION_SECRET || 'kf-secret'));

function requireAuth(roles = ['owner', 'admin']) {
  return async (req, res, next) => {
    const sid = req.cookies?.sid;
    const s = await getSessionData(sid);
    if (!s || !roles.includes(s.role)) return res.status(401).json({ ok: false, msg: 'Tidak terautentikasi.' });
    req.user = s;
    next();
  };
}

app.use(async (req, res, next) => {
  try {
    await ensureOwner();
    await ensureCodes();
    next();
  } catch (e) {
    console.error('bootstrap err:', e);
    next();
  }
});

app.get('/api/public/config', async (req, res) => {
  const cfg = await getConfig();
  res.json({
    ok: true,
    site: cfg.site,
    selection: {
      require_cn: cfg.selection.require_cn,
      require_vt: cfg.selection.require_vt,
      required_hashtag: cfg.selection.required_hashtag,
      tiktok_nickname_must_contain: cfg.selection.tiktok_nickname_must_contain
    },
    notifications: cfg.notifications
  });
});

app.post('/api/public/redeem', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ ok: false, msg: 'Kode tidak valid.' });
  const c = String(code).trim().toUpperCase();

  const codes = await getCodes();
  const entry = codes.find(x => x.code === c);
  if (!entry) return res.status(404).json({ ok: false, msg: 'Kode seleksi tidak ditemukan.' });

  const sid = req.cookies?.session || crypto.randomBytes(16).toString('hex');

  if (entry.status === 'used') return res.status(409).json({ ok: false, msg: 'Kode sudah digunakan.' });
  if (entry.status === 'expired') return res.status(410).json({ ok: false, msg: 'Kode sudah basi / expired.' });
  if (entry.status === 'pending' && entry.session !== sid) {
    return res.status(409).json({ ok: false, msg: 'Kode sedang dipakai orang lain.' });
  }

  await setCode(entry.code, { ...entry, status: 'pending', session: sid, bound_at: Date.now() });

  res.cookie('session', sid, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 3 });
  res.json({ ok: true, session: sid });
});

app.post('/api/public/verify-cn', async (req, res) => {
  const cfg = await getConfig();
  const sid = req.cookies?.session;
  if (!sid) return res.status(401).json({ ok: false, msg: 'Sesi tidak valid.' });
  if (!cfg.selection.require_cn) return res.json({ ok: true, skipped: true });

  const { username } = req.body || {};
  const uname = String(username || '').replace(/^@/, '').trim();
  if (!/^[a-zA-Z0-9._]{2,32}$/.test(uname)) return res.status(400).json({ ok: false, msg: 'Username TikTok tidak valid.' });

  const codes = await getCodes();
  const entry = codes.find(x => x.session === sid && x.status === 'pending');
  if (!entry) return res.status(403).json({ ok: false, msg: 'Tidak ada kode aktif untuk sesi ini.' });

  try {
    const nickname = await fetchTikTokNickname(uname);
    if (!nickname) return res.status(404).json({ ok: false, msg: 'Akun TikTok tidak ditemukan.' });
    const ok = nickname.toLowerCase().includes(cfg.selection.tiktok_nickname_must_contain.toLowerCase());
    if (!ok) return res.status(400).json({ ok: false, msg: `Nickname "${nickname}" belum mengandung "${cfg.selection.tiktok_nickname_must_contain}".` });

    await setCode(entry.code, { ...entry, cn_verified: true, cn_nickname: nickname, cn_username: uname });
    res.json({ ok: true, nickname });
  } catch (e) {
    res.status(500).json({ ok: false, msg: 'Gagal cek TikTok: ' + e.message });
  }
});

app.post('/api/public/verify-vt', async (req, res) => {
  const cfg = await getConfig();
  const sid = req.cookies?.session;
  if (!sid) return res.status(401).json({ ok: false, msg: 'Sesi tidak valid.' });

  const { url } = req.body || {};
  if (!/tiktok\.com\/.+\/video\/\d+/.test(url || '')) return res.status(400).json({ ok: false, msg: 'Link video TikTok tidak valid.' });

  const codes = await getCodes();
  const entry = codes.find(x => x.session === sid && x.status === 'pending');
  if (!entry) return res.status(403).json({ ok: false, msg: 'Tidak ada kode aktif untuk sesi ini.' });
  if (cfg.selection.require_cn && !entry.cn_verified) return res.status(403).json({ ok: false, msg: 'Verifikasi CN dulu.' });

  try {
    const caption = await fetchTikTokCaption(url);
    const ok = (caption || '').toLowerCase().includes(cfg.selection.required_hashtag.toLowerCase());
    if (!ok) return res.status(400).json({ ok: false, msg: `Caption belum mengandung ${cfg.selection.required_hashtag}.` });

    const finalEntry = { ...entry, vt_verified: true, vt_url: url, vt_caption: caption };

    if (cfg.selection.resurrect_on_success) {
      Object.assign(finalEntry, { status: 'fresh', session: null, bound_at: null, used_at: Date.now(), cn_verified: false, vt_verified: false });
    } else {
      finalEntry.status = 'used';
      finalEntry.used_at = Date.now();
    }
    await setCode(entry.code, finalEntry);

    await addSubmission({
      id: crypto.randomBytes(8).toString('hex'),
      code: entry.code,
      cn_username: entry.cn_username,
      cn_nickname: entry.cn_nickname,
      vt_url: url,
      vt_caption: caption,
      finished_at: Date.now(),
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
    });

    res.json({ ok: true, caption, invite: cfg.selection.main_group_invite });
  } catch (e) {
    res.status(500).json({ ok: false, msg: 'Gagal cek video: ' + e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, msg: 'Username & password wajib.' });

  const uname = String(username).trim();
  const roleWanted = role === 'owner' ? 'owner' : 'admin';

  if (roleWanted === 'owner') {
    const owner = await ensureOwner();
    if (owner.username !== uname) return res.status(401).json({ ok: false, msg: 'Kredensial salah.' });
    if (!bcrypt.compareSync(password, owner.password_hash)) return res.status(401).json({ ok: false, msg: 'Kredensial salah.' });
    const sid = await createSession('owner', uname, req.headers['x-forwarded-for']);
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL * 1000 });
    return res.json({ ok: true, role: 'owner', username: uname });
  }

  const admins = await getAdmins();
  const a = admins.find(x => x.username === uname);
  if (!a) return res.status(401).json({ ok: false, msg: 'Kredensial salah.' });
  if (!a.enabled) return res.status(403).json({ ok: false, msg: 'Akun dinonaktifkan.' });
  if (!bcrypt.compareSync(password, a.password_hash)) return res.status(401).json({ ok: false, msg: 'Kredensial salah.' });

  const sid = await createSession('admin', uname, req.headers['x-forwarded-for']);
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL * 1000 });
  res.json({ ok: true, role: 'admin', username: uname });
});

app.post('/api/auth/logout', async (req, res) => {
  await deleteSession(req.cookies?.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const s = await getSessionData(req.cookies?.sid);
  if (!s) return res.status(401).json({ ok: false });
  res.json({ ok: true, role: s.role, username: s.username });
});

app.get('/api/admin/stats', requireAuth(), async (req, res) => {
  await sweepExpired();
  const codes = await getCodes();
  const subs = await getSubmissions();
  const admins = await getAdmins();
  const counts = codes.reduce((a, c) => (a[c.status] = (a[c.status] || 0) + 1, a), {});
  res.json({
    ok: true,
    totals: { codes: codes.length, admins: admins.length, submissions: subs.length },
    by_status: counts
  });
});

app.get('/api/admin/codes', requireAuth(), async (req, res) => {
  await sweepExpired();
  const codes = await getCodes();
  res.json({ ok: true, codes });
});

app.post('/api/admin/codes', requireAuth(['owner']), async (req, res) => {
  const { codes: newCodes } = req.body || {};
  if (!Array.isArray(newCodes) || !newCodes.length) return res.status(400).json({ ok: false, msg: 'Kirim array codes.' });
  const existing = await getCodes();
  const set = new Set(existing.map(c => c.code));
  let added = 0;
  const updates = {};
  for (const raw of newCodes) {
    const c = String(raw).trim().toUpperCase();
    if (!c || set.has(c)) continue;
    updates[c] = JSON.stringify({ status: 'fresh', session: null, bound_at: null, used_at: null });
    set.add(c);
    added++;
  }
  if (added) await redis.hset(K.codes, updates);
  res.json({ ok: true, added });
});

app.delete('/api/admin/codes/:code', requireAuth(['owner']), async (req, res) => {
  await delCode(req.params.code);
  res.json({ ok: true });
});

app.post('/api/admin/codes/reset', requireAuth(['owner']), async (req, res) => {
  const codes = await getCodes();
  const updates = {};
  for (const c of codes) {
    updates[c.code] = JSON.stringify({ code: c.code, status: 'fresh', session: null, bound_at: null, used_at: null, cn_verified: false, vt_verified: false });
  }
  if (Object.keys(updates).length) await redis.hset(K.codes, updates);
  res.json({ ok: true, msg: 'Semua kode direset ke fresh.' });
});

app.post('/api/admin/codes/regenerate', requireAuth(['owner']), async (req, res) => {
  const { count = 40 } = req.body || {};
  const n = Math.max(1, Math.min(500, Number(count)));
  await redis.del(K.codes);
  const codes = {};
  const set = new Set();
  while (set.size < n) set.add('KEKKAI-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5));
  for (const c of set) codes[c] = JSON.stringify({ status: 'fresh', session: null, bound_at: null, used_at: null });
  await redis.hset(K.codes, codes);
  res.json({ ok: true, count: codes.length });
});

app.get('/api/admin/config', requireAuth(), async (req, res) => {
  res.json({ ok: true, config: await getConfig() });
});

app.put('/api/admin/config', requireAuth(['owner']), async (req, res) => {
  const incoming = req.body || {};
  const current = await getConfig();
  const merged = {
    site: { ...current.site, ...(incoming.site || {}) },
    selection: { ...current.selection, ...(incoming.selection || {}) },
    notifications: { ...current.notifications, ...(incoming.notifications || {}) }
  };
  await setConfig(merged);
  res.json({ ok: true, config: merged });
});

app.get('/api/admin/admins', requireAuth(['owner']), async (req, res) => {
  const admins = await getAdmins();
  res.json({ ok: true, admins: admins.map(a => ({ username: a.username, enabled: a.enabled, created_at: a.created_at })) });
});

app.post('/api/admin/admins', requireAuth(['owner']), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, msg: 'Username & password wajib.' });
  if (String(password).length < 6) return res.status(400).json({ ok: false, msg: 'Password minimal 6 karakter.' });
  const admins = await getAdmins();
  if (admins.find(a => a.username === username)) return res.status(409).json({ ok: false, msg: 'Username sudah dipakai.' });
  await setAdmin(username, {
    password_hash: bcrypt.hashSync(String(password), 10),
    enabled: true,
    created_at: Date.now()
  });
  res.json({ ok: true });
});

app.patch('/api/admin/admins/:username', requireAuth(['owner']), async (req, res) => {
  const admins = await getAdmins();
  const a = admins.find(x => x.username === req.params.username);
  if (!a) return res.status(404).json({ ok: false, msg: 'Admin tidak ditemukan.' });
  const { enabled, password } = req.body || {};
  let newHash = a.password_hash;
  if (typeof enabled === 'boolean') a.enabled = enabled;
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ ok: false, msg: 'Password minimal 6 karakter.' });
    newHash = bcrypt.hashSync(String(password), 10);
  }
  await setAdmin(a.username, { password_hash: newHash, enabled: a.enabled, created_at: a.created_at });
  res.json({ ok: true });
});

app.delete('/api/admin/admins/:username', requireAuth(['owner']), async (req, res) => {
  await delAdmin(req.params.username);
  res.json({ ok: true });
});

app.get('/api/admin/submissions', requireAuth(), async (req, res) => {
  res.json({ ok: true, submissions: await getSubmissions() });
});

app.delete('/api/admin/submissions', requireAuth(['owner']), async (req, res) => {
  await redis.del(K.submissions);
  res.json({ ok: true });
});

export default app;
