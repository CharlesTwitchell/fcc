# Fighter generation proxy

Holds the Anthropic API key server-side and proxies `POST /v1/messages`
requests from the game (`../index.html`) so the key never reaches the browser.

## Deploy

```
cd worker
npx wrangler login                          # one-time browser auth
npx wrangler secret put ANTHROPIC_API_KEY    # paste your key when prompted
npx wrangler deploy
```

The deploy output prints your Worker's URL, e.g.
`https://fcc-fighter-proxy.<your-subdomain>.workers.dev`.

Copy that URL into `FIGHTER_API_URL` near the top of `../index.html`'s
`<script>` block, then commit and push.

## Notes

- `ALLOWED_ORIGIN` in `src/index.js` is locked to
  `https://charlestwitchell.github.io`. If the game ever moves to a different
  domain, update it there.
- The Worker forces `model` and clamps `max_tokens` server-side rather than
  trusting the client, and applies a best-effort per-IP rate limit — see the
  comments in `src/index.js`. For stronger abuse protection, add a Cloudflare
  dashboard Rate Limiting Rule on this Worker's route.
