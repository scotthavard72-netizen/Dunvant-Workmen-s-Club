require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!GITHUB_TOKEN) {
  console.warn('GITHUB_TOKEN is not set. The proxy will not work without it.');
}
if (!ADMIN_TOKEN) {
  console.warn('ADMIN_TOKEN is not set. Requests will be rejected without it.');
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function requireAdmin(req, res, next) {
  const header = req.get('x-admin-token');
  if (!ADMIN_TOKEN || header !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/github/contents', requireAdmin, async (req, res) => {
  const { owner, repo, path } = req.query;
  if (!owner || !repo || !path) return res.status(400).json({ error: 'owner, repo and path are required' });
  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const r = await fetch(apiUrl, { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } });
    const body = await r.text();
    res.status(r.status).send(body);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put('/api/github/contents', requireAdmin, async (req, res) => {
  const { owner, repo, path, message, content, sha, branch } = req.body;
  if (!owner || !repo || !path || !message || !content) return res.status(400).json({ error: 'owner, repo, path, message and content are required' });
  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}` + (branch ? `?branch=${encodeURIComponent(branch)}` : '');
    const body = { message, content };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;
    const r = await fetch(apiUrl, {
      method: 'PUT',
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const responseBody = await r.text();
    res.status(r.status).send(responseBody);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`GitHub proxy server listening on ${PORT}`);
});
