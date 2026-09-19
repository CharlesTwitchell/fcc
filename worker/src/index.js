// Cloudflare Worker: proxies fighter-generation requests to the Anthropic API.
// The Anthropic API key lives only in this Worker's secret store (set via
// `wrangler secret put ANTHROPIC_API_KEY`) — it never reaches the browser.

const ALLOWED_ORIGIN = 'https://charlestwitchell.github.io';
// Up to 3 reference photos (client-compressed to ~768px JPEGs) plus JSON overhead.
const MAX_BODY_BYTES = 3_000_000; // guards against blatantly abusive payloads
const RATE_LIMIT_PER_MINUTE = 15;

// Best-effort per-isolate rate limiting. Not durable across cold starts or
// multiple edge locations, but stops casual abuse against a shared hobby-project
// key without needing a KV namespace. Add a Cloudflare dashboard Rate Limiting
// Rule on this route for stronger protection if abuse becomes a real problem.
const rateLimitMap = new Map();

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonError(status, message, headers) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return jsonError(405, 'Method not allowed', headers);
    }
    if (origin !== ALLOWED_ORIGIN) {
      return jsonError(403, 'Forbidden origin', headers);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const bucket = rateLimitMap.get(ip);
    if (bucket && now - bucket.start < 60_000) {
      if (bucket.count >= RATE_LIMIT_PER_MINUTE) {
        return jsonError(429, 'Rate limit exceeded. Try again in a minute.', headers);
      }
      bucket.count++;
    } else {
      rateLimitMap.set(ip, { start: now, count: 1 });
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonError(413, 'Request too large', headers);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonError(400, 'Invalid JSON body', headers);
    }
    if (!Array.isArray(body.messages)) {
      return jsonError(400, '"messages" must be an array', headers);
    }

    // Never trust the client for cost-relevant fields — force safe server-side values
    // instead of forwarding whatever the caller sent.
    const upstreamBody = {
      model: 'claude-sonnet-4-6',
      max_tokens: Math.min(Number(body.max_tokens) || 1000, 1200),
      system: typeof body.system === 'string' ? body.system.slice(0, 4000) : undefined,
      messages: body.messages,
    };

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': env.ANTHROPIC_API_KEY,
      },
      body: JSON.stringify(upstreamBody),
    });

    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  },
};
