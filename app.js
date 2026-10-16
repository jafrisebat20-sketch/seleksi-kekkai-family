const $ = (s) => document.querySelector(s);
const state = { session: null, config: null };

function setStep(n) {
  [1,2,3,4].forEach(i => $('#step' + i)?.classList.add('hidden'));
  $('#success').classList.add('hidden');
  if (n <= 4) $('#step' + n).classList.remove('hidden');
  document.querySelectorAll('.dot').forEach((el) => {
    const s = Number(el.dataset.step);
    el.classList.toggle('active', s === n);
    el.classList.toggle('done', s < n);
  });
}
function msg(el, text, kind = '') { el.className = 'msg ' + kind; el.textContent = text || ''; }
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || ('HTTP ' + r.status));
  return j;
}

(async function init() {
  try {
    const r = await fetch('/api/public/config');
    const j = await r.json();
    if (j.ok) {
      state.config = j;
      $('#brandTitle').textContent = j.site.title;
      $('#brandSub').textContent = j.site.subtitle;
      $('#statusText').textContent = j.site.status;
      $('#footerText').textContent = j.site.footer;
      $('#hashtagHint').textContent = j.selection.required_hashtag;
      if (j.notifications?.enabled && j.notifications.message) {
        const n = $('#notice');
        n.className = 'notice ' + (j.notifications.type || 'info');
        n.textContent = j.notifications.message;
      }
    }
  } catch {}
})();

$('#btnCode').addEventListener('click', async () => {
  const code = $('#codeInput').value.trim();
  const m = $('#msg1');
  if (!code) return msg(m, 'Masukkan kode terlebih dahulu.', 'err');
  const btn = $('#btnCode'); btn.disabled = true;
  msg(m, 'Memeriksa kode...');
  try {
    const j = await post('/api/public/redeem', { code });
    state.session = j.session;
    msg(m, 'Kode valid. Lanjut ke verifikasi CN.', 'ok');
    setTimeout(() => setStep(2), 500);
  } catch (e) { msg(m, e.message, 'err'); }
  finally { btn.disabled = false; }
});

$('#btnCn').addEventListener('click', async () => {
  const username = $('#cnInput').value.trim();
  const m = $('#msg2');
  if (!username) return msg(m, 'Masukkan username TikTok.', 'err');
  const btn = $('#btnCn'); btn.disabled = true;
  msg(m, 'Mengecek nickname...');
  try {
    const j = await post('/api/public/verify-cn', { username });
    if (j.skipped) { msg(m, 'Dilewati.', 'ok'); return setTimeout(() => setStep(3), 400); }
    msg(m, `Berhasil. Nickname: ${j.nickname}`, 'ok');
    setTimeout(() => setStep(3), 600);
  } catch (e) { msg(m, e.message, 'err'); }
  finally { btn.disabled = false; }
});

$('#btnVt').addEventListener('click', async () => {
  const url = $('#vtInput').value.trim();
  const m = $('#msg3');
  if (!url) return msg(m, 'Masukkan link video TikTok.', 'err');
  const btn = $('#btnVt'); btn.disabled = true;
  msg(m, 'Mengecek caption...');
  try {
    const j = await post('/api/public/verify-vt', { url });
    msg(m, 'Hashtag terdeteksi. Verifikasi selesai.', 'ok');
    $('#joinBtn').href = j.invite || '#';
    setTimeout(() => setStep(4), 600);
  } catch (e) { msg(m, e.message, 'err'); }
  finally { btn.disabled = false; }
});

$('#joinBtn').addEventListener('click', () => {
  setTimeout(() => {
    [1,2,3,4].forEach(i => $('#step' + i)?.classList.add('hidden'));
    $('#success').classList.remove('hidden');
    document.querySelectorAll('.dot').forEach(el => { el.classList.remove('active'); el.classList.add('done'); });
  }, 400);
});

const params = new URLSearchParams(location.search);
if (params.get('code')) $('#codeInput').value = params.get('code');

setStep(1);

// Warn user if they leave mid-flow
window.addEventListener('beforeunload', (e) => {
  const inFlow = state.session && (document.querySelector('.dot.active')?.dataset.step !== '4');
  if (inFlow) { e.preventDefault(); e.returnValue = 'Kode seleksi bisa basi jika kamu keluar. Yakin?'; }
});