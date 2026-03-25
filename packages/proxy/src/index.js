/**
 * Page Agent Proxy Server
 * Security: Target domain whitelist + Built-in API Key fallback
 * Config: Load from .env file
 */
import http from 'http'
import https from 'https'

// Load environment variables from .env
const port = process.env.PROXY_PORT || 5175
const DEFAULT_API_KEY = process.env.DEFAULT_API_KEY || ''

if (!DEFAULT_API_KEY) {
	console.warn('[WARN] DEFAULT_API_KEY not set in .env file')
}

const ALLOWED_TARGETS = new Set(['jiutian.10086.cn'])

const BLOCKED_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-connection',
	'transfer-encoding',
	'upgrade',
	'origin',
	'referer',
	'sec-fetch-dest',
	'sec-fetch-mode',
	'sec-fetch-site',
	'sec-ch-ua',
	'sec-ch-ua-mobile',
	'sec-ch-ua-platform',
	'cookie',
	'set-cookie',
	'x-forwarded-for',
	'x-forwarded-host',
	'x-forwarded-proto',
])

const server = http.createServer((req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*')
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')

	if (req.method === 'OPTIONS') {
		res.writeHead(204)
		res.end()
		return
	}

	const proxyPath = req.url.replace('/proxy/', '')
	let targetUrl
	try {
		targetUrl = new URL(proxyPath)
	} catch {
		res.writeHead(400, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Invalid URL' }))
		return
	}

	if (!ALLOWED_TARGETS.has(targetUrl.hostname)) {
		console.warn('[BLOCKED]', targetUrl.hostname)
		res.writeHead(403, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Forbidden', hostname: targetUrl.hostname }))
		return
	}

	console.log('[PROXY]', req.method, targetUrl.href)

	const safeHeaders = {}
	for (const [key, value] of Object.entries(req.headers)) {
		if (BLOCKED_HEADERS.has(key) || value === undefined || value === null) continue
		if (key === 'content-length') continue
		if (key === 'host') {
			safeHeaders.host = targetUrl.hostname
		} else {
			safeHeaders[key] = value
		}
	}
	safeHeaders.host = targetUrl.hostname

	const options = {
		hostname: targetUrl.hostname,
		port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
		path: targetUrl.pathname + targetUrl.search,
		method: req.method,
		headers: safeHeaders,
	}

	// Inject default API key if missing/empty/NA
	const auth = options.headers.authorization
	if (!auth || auth === 'Bearer NA' || auth === 'Bearer ') {
		if (DEFAULT_API_KEY) {
			console.log('[AUTH] Using default API key')
			options.headers.authorization = 'Bearer ' + DEFAULT_API_KEY
		} else {
			console.warn('[AUTH] No default API key configured')
		}
	}

	const lib = targetUrl.protocol === 'https:' ? https : http
	const proxyReq = lib.request(options, (proxyRes) => {
		const headers = { ...proxyRes.headers }
		delete headers['content-encoding']
		res.writeHead(proxyRes.statusCode || 200, headers)
		proxyRes.pipe(res)
	})

	proxyReq.on('error', (e) => {
		console.error('[ERROR]', e.message)
		res.writeHead(502, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: e.message }))
	})

	req.pipe(proxyReq)
})

server.listen(port, () => {
	console.log('')
	console.log('Page Agent Proxy')
	console.log('URL:', 'http://localhost:' + port)
	console.log('Whitelist:', Array.from(ALLOWED_TARGETS).join(', '))
	console.log('Default API Key:', DEFAULT_API_KEY ? 'Configured ✓' : 'Not set ✗')
	console.log('')
})
