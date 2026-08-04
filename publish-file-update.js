// UTF-8-safe base64 helpers and GitHub publish/fetch logic
(() => {
  // --- helpers ---
  function base64ToUtf8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function defaultHeaders(token) {
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (token) headers.Authorization = `token ${token}`;
    return headers;
  }

  function setStatus(text, type = '') {
    const el = document.getElementById('publish-status');
    el.textContent = text;
    el.className = 'status' + (type ? ' ' + type : '');
  }

  // --- config persistence (only owner/repo to localStorage) ---
  function loadSavedConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem('ghConfig') || 'null');
      if (saved) {
        document.getElementById('gh-owner').value = saved.owner || '';
        document.getElementById('gh-repo').value = saved.repo || '';
      }
      // Token: optionally in session storage
      const token = sessionStorage.getItem('ghToken') || '';
      if (token) {
        document.getElementById('gh-token').value = token;
        document.getElementById('remember-token').checked = true;
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  function saveSimpleConfig() {
    const owner = document.getElementById('gh-owner').value.trim();
    const repo = document.getElementById('gh-repo').value.trim();
    localStorage.setItem('ghConfig', JSON.stringify({ owner, repo }));
  }

  function maybeSaveToken() {
    const remember = document.getElementById('remember-token').checked;
    const token = document.getElementById('gh-token').value.trim();
    if (remember && token) {
      sessionStorage.setItem('ghToken', token);
    } else {
      sessionStorage.removeItem('ghToken');
    }
  }

  // --- UI helpers ---
  function updateOnlineStatus() {
    const el = document.getElementById('offline-banner');
    const online = navigator.onLine;
    el.style.display = online ? 'none' : 'flex';
    el.setAttribute('aria-hidden', online ? 'true' : 'false');
  }

  // --- GitHub interactions ---
  async function fetchFileFromGitHub(apiUrl, token) {
    const res = await fetch(apiUrl, { headers: defaultHeaders(token) });
    if (!res.ok) {
      if (res.status === 401) throw new Error('Unauthorized — token invalid or expired.');
      if (res.status === 403) throw new Error('Forbidden — check token permissions or rate limits.');
      if (res.status === 404) throw new Error('Not found — check owner/repo/file path (case sensitive).');
      const text = await res.text().catch(() => '');
      throw new Error(`Fetch failed (${res.status}) ${text}`);
    }
    return res.json();
  }

  async function fetchFile() {
    const owner = document.getElementById('gh-owner').value.trim();
    const repo  = document.getElementById('gh-repo').value.trim();
    const token = document.getElementById('gh-token').value.trim();
    const path  = document.getElementById('file-path').value.trim().replace(/^\//, '');
    if (!owner || !repo || !token || !path) {
      setStatus('Fill in GitHub username, repo, token, and file path first.', 'error');
      return;
    }
    setStatus('Fetching…');
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
      const data = await fetchFileFromGitHub(apiUrl, token);
      window.currentSha = data.sha;
      document.getElementById('file-content').value = base64ToUtf8(data.content);
      setStatus('✓ Loaded — edit below, then Publish when ready.', 'success');
      // save non-sensitive config
      saveSimpleConfig();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  async function publishFileConfirmed() {
    const owner = document.getElementById('gh-owner').value.trim();
    const repo  = document.getElementById('gh-repo').value.trim();
    const token = document.getElementById('gh-token').value.trim();
    const path  = document.getElementById('file-path').value.trim().replace(/^\//, '');
    const newContent = document.getElementById('file-content').value;
    if (!owner || !repo || !token || !path) {
      setStatus('Fill in GitHub username, repo, token, and file path first.', 'error');
      return;
    }
    if (!newContent.trim()) {
      setStatus("The content box is empty — fetching first or paste content in.", 'error');
      return;
    }

    setStatus('Publishing…');
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

      // Ensure we have the latest sha
      let sha = window.currentSha;
      if (!sha) {
        try {
          const current = await fetchFileFromGitHub(apiUrl, token);
          sha = current.sha;
        } catch (e) {
          // if not found, sha remains undefined (creating new file)
          if (e.message && e.message.includes('Not found')) {
            sha = undefined;
          } else {
            throw e;
          }
        }
      }

      const loggedInName = localStorage.getItem('staffUserName') || 'unknown user';
      const body = {
        message: `Update ${path} — by ${loggedInName}`,
        content: utf8ToBase64(newContent)
      };
      if (sha) body.sha = sha;

      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...defaultHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (putRes.status === 409) {
        // Conflict — file changed since we fetched it
        const latest = await fetchFileFromGitHub(apiUrl, token);
        // show conflict message and load latest content for manual merge
        document.getElementById('file-content').value = base64ToUtf8(latest.content);
        window.currentSha = latest.sha;
        setStatus('Conflict: file changed since you fetched it. Latest content loaded for manual merge.', 'error');
        return;
      }

      if (!putRes.ok) {
        if (putRes.status === 401) throw new Error('Unauthorized — token invalid.');
        if (putRes.status === 403) throw new Error('Forbidden — token lacks repo write access.');
        const errText = await putRes.text().catch(() => '');
        throw new Error(`Publish failed (${putRes.status}). ${errText}`);
      }

      const result = await putRes.json();
      window.currentSha = result.content.sha;
      setStatus('✓ Published — live on the site within a couple of minutes.', 'success');
      // optionally save token to sessionStorage if asked
      maybeSaveToken();
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  }

  // --- dialog confirm handling ---
  function showConfirmDialog(onConfirm) {
    const dialog = document.getElementById('confirm-dialog');
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
      const ok = document.getElementById('confirm-ok');
      const cancel = document.getElementById('confirm-cancel');
      function cleanup() {
        ok.removeEventListener('click', okHandler);
        cancel.removeEventListener('click', cancelHandler);
        dialog.close();
      }
      function okHandler() { cleanup(); onConfirm(); }
      function cancelHandler() { cleanup(); }
      ok.addEventListener('click', okHandler);
      cancel.addEventListener('click', cancelHandler);
    } else {
      // fallback to confirm
      if (confirm('Publish changes? This will overwrite the file on the default branch.')) onConfirm();
    }
  }

  // --- theme toggle ---
  function applyTheme(theme) {
    const icon = document.getElementById('theme-icon');
    const toggle = document.getElementById('theme-toggle');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      icon.textContent = '🌙';
      toggle.setAttribute('aria-pressed', 'true');
    } else {
      document.documentElement.removeAttribute('data-theme');
      icon.textContent = '☀️';
      toggle.setAttribute('aria-pressed', 'false');
    }
  }

  // --- init and event wiring ---
  function init() {
    loadSavedConfig();
    updateOnlineStatus();

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    document.getElementById('fetch-btn').addEventListener('click', fetchFile);
    document.getElementById('publish-btn').addEventListener('click', () => {
      showConfirmDialog(publishFileConfirmed);
    });

    // confirm dialog already wired with buttons in publishFileConfirmed showConfirmDialog

    document.getElementById('gh-owner').addEventListener('change', saveSimpleConfig);
    document.getElementById('gh-repo').addEventListener('change', saveSimpleConfig);

    document.getElementById('remember-token').addEventListener('change', maybeSaveToken);
    document.getElementById('gh-token').addEventListener('input', () => {
      if (!document.getElementById('remember-token').checked) sessionStorage.removeItem('ghToken');
    });

    // Theme init
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    applyTheme(initialTheme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const newTheme = isDark ? 'light' : 'dark';
      applyTheme(newTheme);
      localStorage.setItem('theme', newTheme);
    });

    // Expose currentSha globally for debugging/back-compat if needed
    window.currentSha = window.currentSha || null;
  }

  // Run init after DOM ready (script is loaded with defer)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
