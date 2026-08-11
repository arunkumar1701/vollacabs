const http = require('http');
const https = require('https');

const proxy = http.createServer((req, res) => {
  let targetHost = '';
  let targetPath = req.url;

  if (req.url.startsWith('/v1/auth')) {
    targetHost = 'local.auth.nhost.run';
    targetPath = req.url.replace('/v1/auth', '/v1'); // Rewrite /v1/auth to /v1
  } else if (req.url.startsWith('/v1/graphql') || req.url.startsWith('/v1')) {
    if (req.url.startsWith('/v1/storage')) {
      targetHost = 'local.storage.nhost.run';
      targetPath = req.url.replace('/v1/storage', '/v1');
    } else if (req.url.startsWith('/v1/functions')) {
      targetHost = 'local.functions.nhost.run';
      targetPath = req.url.replace('/v1/functions', '/v1');
    } else {
      targetHost = 'local.graphql.nhost.run';
      targetPath = req.url.replace('/v1/graphql', '/v1');
    }
  } else {
    console.log(`[404] ${req.method} ${req.url}`);
    res.writeHead(404);
    res.end('Not found in proxy');
    return;
  }

  console.log(`[PROXY] ${req.method} ${req.url} -> https://${targetHost}${targetPath}`);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-hasura-admin-secret, x-hasura-role');
    res.writeHead(200);
    res.end();
    return;
  }

  const options = {
    hostname: '127.0.0.1',
    port: 443,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetHost,
    },
    rejectUnauthorized: false
  };

  const proxyReq = https.request(options, (proxyRes) => {
    // Inject CORS headers in response if missing
    const headers = { ...proxyRes.headers };
    headers['access-control-allow-origin'] = '*';
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (e) => {
    console.error('Proxy error:', e.message);
    res.writeHead(500);
    res.end(e.message);
  });

  req.pipe(proxyReq, { end: true });
});

proxy.listen(1337, () => {
  console.log('Nhost DNS Proxy listening on http://localhost:1337');
});
