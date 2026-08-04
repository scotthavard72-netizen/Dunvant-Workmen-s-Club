# Server proxy example for GitHub contents API

This minimal Node/Express example shows a secure server endpoint you can run to keep a GitHub PAT on the server instead of asking staff to paste tokens in the browser.

Security notes (important):
- Set GITHUB_TOKEN to a token with only the permissions you need (recommended: repository contents only).
- Set ADMIN_TOKEN to a secret used by the client to authenticate requests to this proxy. The client should send this token in the header `x-admin-token`.
- Run behind HTTPS in production and restrict access to trusted origins.

Prerequisites
- Node 18+ (uses built-in fetch). If you must use older Node, add node-fetch.

Install

npm init -y
npm install express cors dotenv

Usage

Create a .env file in the server directory:

GITHUB_TOKEN=ghp_...
ADMIN_TOKEN=some-secret-value
PORT=4000

Then start the server:

node server.js

Endpoints
- GET /api/github/contents?owner=OWNER&repo=REPO&path=PATH
  - Returns the GitHub contents API response (requires x-admin-token header)
- PUT /api/github/contents
  - JSON body: { owner, repo, path, message, content, sha?, branch? }
  - Requires x-admin-token header

This is an example — adapt auth and harden before using in production.
