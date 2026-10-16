const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
let ME = null;

async function api(url, opts = {}) {
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || ('HTTP ' + r.status));
  return j;
}

// ---- Login ----
let loginRole = 'owner';
$$('.role-tab').forEach(t => t.addEventListener('click', () => {
  $$('.role-tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  loginRole = t.dataset.role;
}));

$('#btnLogin').addEventListener('click', async () => {
  const username = $('#lUser').value.trim();
  const password = $('#lPass').value;
  const m = $('#loginMsg');
  if (!username || !password) return (m.className = 'msg err', m.textContent = 'Isi username & password.');
  $('#btnLogin').disabled = true;
  m.className = 'msg'; m.textContent = 'Masuk...';
  try {
    await api('/api/auth/login', { method: 'POST', body: { username, password, role: loginRole } });
    await bootApp();
  } catch (e) { m.className = 'msg err'; m.textContent = e.message; }
  finally { $('#btnLogin').disabled = false; }
});

// ---- App boot ----
async function bootApp() {
  const me = await api('/api/auth/me').catch(() => null);
  if (!me || !me.ok) { $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); return; }
  ME = me;
  $('#whoami').textContent = `${me.role === 'owner' ? 'Owner' : 'Admin'} · ${me.username}`;
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');

  // Hide owner-only tabs for admins
  if (me.role !== 'owner') $$('.owner-only').forEach(el => el.classList.add('hidden'));
  else $$('.owner-only').forEach(el => el.classList.remove('hidden'));

  switchView('dashboard');
  loadDashboard();
}

// ---- Nav ----
function switchView(view) {
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'codes') loadCodes();
  if (view === 'submissions') loadSubs();
  if (view === 'admins') loadAdmins();
  if (view === 'flow' || view === 'site' || view === 'notif') loadConfig();
}
$$('.nav-item').forEach(n => n.addEventListener('click', () => switchView(n.dataset.view)));

$('#btnLogout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

// ---- Dashboard ----
async function loadDashboard() {
  try {
    const j = await api('/api/admin/stats');
    $('#sCodes').textContent = j.totals.codes;
    $('#sFresh').textContent = j.by_status.fresh || 0;
    $('#sPending').textContent = j.by_status.pending || 0;
    $('#sExpired').textContent = j.by_status.expired || 0;
    $('#sUsed').textContent = j.by_status.used || 0;
    $('#sAdmins').textContent = j.totals.admins;
    $('#sSubs').textContent = j.totals.submissions;
  } catch {}
}

// ---- Codes ----
async function loadCodes() {
  try {
    const j = await api('/api/admin/codes');
    const tbody = $('#tblCodes tbody');
    tbody.innerHTML = '';
    for (const c of j.codes) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${c.code}</code></td>
        <td><span class="pill ${c.status}">${c.status}</span></td>
        <td>${c.cn_username || '—'}</td>
        <td>${c.bound_at ? new Date(c.bound_at).toLocaleString('id-ID') : '—'}</td>
        <td>${c.used_at ? new Date(c.used_at).toLocaleString('id-ID') : '—'}</td>
        <td>${ME?.role === 'owner' ? `<button class="link-mini" data-del="${c.code}">hapus</button>` : ''}</td>
      `;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Hapus kode ' + b.dataset.del + '?')) return;
      await api('/api/admin/codes/' + b.dataset.del, { method: 'DELETE' });
      loadCodes();
    }));
  } catch (e) { alert(e.message); }
}
$('#btnRefreshCodes').addEventListener('click', loadCodes);

$('#btnAddCodes')?.addEventListener('click', async () => {
  const raw = prompt('Masukkan kode, pisahkan dengan koma atau baris baru:');
  if (!raw) return;
  const codes = raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  if (!codes.length) return;
  try { const r = await api('/api/admin/codes', { method: 'POST', body: { codes } }); alert('Ditambahkan: ' + r.added); loadCodes(); }
  catch (e) { alert(e.message); }
});

$('#btnResetCodes')?.addEventListener('click', async () => {
  if (!confirm('Reset semua kode ke status fresh?')) return;
  try { await api('/api/admin/codes/reset', { method: 'POST' }); loadCodes(); }
  catch (e) { alert(e.message); }
});

$('#btnRegenCodes')?.addEventListener('click', async () => {
  if (!confirm('Buang semua kode lama dan generate 40 kode baru?')) return;
  try { await api('/api/admin/codes/regenerate', { method: 'POST', body: { count: 40 } }); loadCodes(); }
  catch (e) { alert(e.message); }
});

// ---- Submissions ----
async function loadSubs() {
  try {
    const j = await api('/api/admin/submissions');
    const tbody = $('#tblSubs tbody');
    tbody.innerHTML = '';
    for (const s of j.submissions) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(s.finished_at).toLocaleString('id-ID')}</td>
        <td><code>${s.code}</code></td>
        <td>@${s.cn_username || '—'}</td>
        <td>${s.cn_nickname || '—'}</td>
        <td><a class="link-mini" href="${s.vt_url}" target="_blank" rel="noopener">buka</a></td>
      `;
      tbody.appendChild(tr);
    }
  } catch (e) { alert(e.message); }
}
$('#btnRefreshSubs').addEventListener('click', loadSubs);
$('#btnClearSubs')?.addEventListener('click', async () => {
  if (!confirm('Bersihkan semua log verifikasi?')) return;
  try { await api('/api/admin/submissions', { method: 'DELETE' }); loadSubs(); }
  catch (e) { alert(e.message); }
});

// ---- Config ----
async function loadConfig() {
  try {
    const { config } = await api('/api/admin/config');
    // flow
    $('#cfgRequireCn').checked = !!config.selection.require_cn;
    $('#cfgRequireVt').checked = !!config.selection.require_vt;
    $('#cfgResurrect').checked = !!config.selection.resurrect_on_success;
    $('#cfgHashtag').value = config.selection.required_hashtag || '';
    $('#cfgNickname').value = config.selection.tiktok_nickname_must_contain || '';
    $('#cfgInvite').value = config.selection.main_group_invite || '';
    $('#cfgPendingTtl').value = config.selection.pending_code_ttl_minutes || 15;
    // site
    $('#cfgTitle').value = config.site.title || '';
    $('#cfgSubtitle').value = config.site.subtitle || '';
    $('#cfgStatus').value = config.site.status || '';
    $('#cfgFooter').value = config.site.footer || '';
    // notif
    $('#cfgNotifEnabled').checked = !!config.notifications.enabled;
    $('#cfgNotifType').value = config.notifications.type || 'info';
    $('#cfgNotifMsg').value = config.notifications.message || '';
  } catch (e) { /* admin can't read? shouldn't happen */ }
}

async function savePartial(partial, msgEl) {
  try {
    await api('/api/admin/config', { method: 'PUT', body: partial });
    msgEl.className = 'msg ok'; msgEl.textContent = 'Disimpan.';
    setTimeout(() => { msgEl.textContent = ''; }, 1800);
  } catch (e) { msgEl.className = 'msg err'; msgEl.textContent = e.message; }
}

$('#btnSaveFlow').addEventListener('click', () => savePartial({
  selection: {
    require_cn: $('#cfgRequireCn').checked,
    require_vt: $('#cfgRequireVt').checked,
    resurrect_on_success: $('#cfgResurrect').checked,
    required_hashtag: $('#cfgHashtag').value.trim(),
    tiktok_nickname_must_contain: $('#cfgNickname').value.trim(),
    main_group_invite: $('#cfgInvite').value.trim(),
    pending_code_ttl_minutes: Number($('#cfgPendingTtl').value) || 15
  }
}, $('#msgFlow')));

$('#btnSaveSite').addEventListener('click', () => savePartial({
  site: {
    title: $('#cfgTitle').value.trim(),
    subtitle: $('#cfgSubtitle').value.trim(),
    status: $('#cfgStatus').value.trim(),
    footer: $('#cfgFooter').value.trim()
  }
}, $('#msgSite')));

$('#btnSaveNotif').addEventListener('click', () => savePartial({
  notifications: {
    enabled: $('#cfgNotifEnabled').checked,
    type: $('#cfgNotifType').value,
    message: $('#cfgNotifMsg').value
  }
}, $('#msgNotif')));

// ---- Admins ----
async function loadAdmins() {
  try {
    const j = await api('/api/admin/admins');
    const tbody = $('#tblAdmins tbody');
    tbody.innerHTML = '';
    for (const a of j.admins) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${a.username}</code></td>
        <td>${a.enabled ? '<span class="pill fresh">aktif</span>' : '<span class="pill expired">nonaktif</span>'}</td>
        <td>${new Date(a.created_at).toLocaleString('id-ID')}</td>
        <td>
          <button class="link-mini" data-toggle="${a.username}" data-enabled="${a.enabled}">${a.enabled ? 'nonaktifkan' : 'aktifkan'}</button>
          · <button class="link-mini" data-pass="${a.username}">ganti password</button>
          · <button class="link-mini" data-del="${a.username}">hapus</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
      await api('/api/admin/admins/' + b.dataset.toggle, { method: 'PATCH', body: { enabled: b.dataset.enabled !== 'true' } });
      loadAdmins();
    }));
    tbody.querySelectorAll('[data-pass]').forEach(b => b.addEventListener('click', async () => {
      const np = prompt('Password baru untuk ' + b.dataset.pass + ':');
      if (!np) return;
      try { await api('/api/admin/admins/' + b.dataset.pass, { method: 'PATCH', body: { password: np } }); alert('Password diperbarui.'); }
      catch (e) { alert(e.message); }
    }));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Hapus admin ' + b.dataset.del + '?')) return;
      await api('/api/admin/admins/' + b.dataset.del, { method: 'DELETE' });
      loadAdmins();
    }));
  } catch (e) { alert(e.message); }
}

$('#btnCreateAdmin').addEventListener('click', async () => {
  const username = $('#newAdminUser').value.trim();
  const password = $('#newAdminPass').value;
  const m = $('#msgAdmin');
  if (!username || !password) return (m.className = 'msg err', m.textContent = 'Isi username & password.');
  try {
    await api('/api/admin/admins', { method: 'POST', body: { username, password } });
    m.className = 'msg ok'; m.textContent = 'Admin dibuat.';
    $('#newAdminUser').value = ''; $('#newAdminPass').value = '';
    loadAdmins();
  } catch (e) { m.className = 'msg err'; m.textContent = e.message; }
});

// ---- Start ----
bootApp();