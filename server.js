require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('./database');
const { hashPassword, comparePassword, generateToken, generateAdminToken, authMiddleware, apiKeyMiddleware, adminMiddleware } = require('./auth');

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(o => o.trim());
app.use(cors({
  origin: allowedOrigins[0] === '*' ? true : allowedOrigins,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Admin-Token', 'X-Strategy']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public')); // ✅ busca en public/


const PORT = process.env.PORT || 8080;

const CHAT_SERVICES = [
  { id: 'groq',        name: 'Groq',         env: 'GROQ_API_KEY',        url: 'https://api.groq.com/openai/v1/chat/completions', isFree: true },
  { id: 'cerebras',    name: 'Cerebras',     env: 'CEREBRAS_API_KEY',    url: 'https://api.cerebras.ai/v1/chat/completions', isFree: true },
  { id: 'mistral',     name: 'Mistral',      env: 'MISTRAL_API_KEY',     url: 'https://api.mistral.ai/v1/chat/completions', isFree: false },
  { id: 'gemini',      name: 'Gemini',       env: 'GEMINI_API_KEY',      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', isFree: true },
  { id: 'siliconflow', name: 'SiliconFlow',  env: 'SILICONFLOW_API_KEY', url: 'https://api.siliconflow.cn/v1/chat/completions', isFree: false },
  { id: 'together',    name: 'Together',     env: 'TOGETHER_API_KEY',    url: 'https://api.together.xyz/v1/chat/completions', isFree: false },
  { id: 'xai',         name: 'xAI Grok',     env: 'XAI_API_KEY',         url: 'https://api.x.ai/v1/chat/completions', isFree: false },
  { id: 'openrouter',  name: 'OpenRouter',   env: 'OPENROUTER_API_KEY',  url: 'https://openrouter.ai/api/v1/chat/completions', isFree: true },
  { id: 'sarvam',      name: 'Sarvam AI',    env: 'SARVAM_API_KEY',      url: 'https://api.sarvam.ai/v1/chat/completions', isFree: false },
  { id: 'huggingface', name: 'Hugging Face', env: 'HUGGINGFACE_API_KEY', url: 'https://api-inference.huggingface.co/v1/chat/completions', isFree: true },
  { id: 'cloudflare',  name: 'Cloudflare',   env: 'CLOUDFLARE_API_KEY',  url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions', accountEnv: 'CLOUDFLARE_ACCOUNT_ID', isFree: true },
  { id: 'aimlapi',     name: 'AI/ML API',    env: 'AIML_API_KEY',        url: 'https://api.aimlapi.com/v1/chat/completions', isFree: false },
];

const PROVIDER_MODELS = {
  groq:        { default: 'llama-3.1-8b-instant', valid: ['llama-3.1-8b-instant','llama3-8b-8192','mixtral-8x7b-32768','gemma2-9b-it','llama-3.3-70b-versatile'] },
  cerebras:    { default: 'llama3.1-8b', valid: ['llama3.1-8b','llama3.3-70b'] },
  mistral:     { default: 'mistral-small-latest', valid: ['mistral-small-latest','mistral-medium-latest','open-mistral-7b','open-mistral-nemo','codestral-latest'] },
  siliconflow: { default: 'meta-llama/Meta-Llama-3.1-8B-Instruct', valid: ['meta-llama/Meta-Llama-3.1-8B-Instruct','deepseek-ai/DeepSeek-V3','Qwen/Qwen2.5-7B-Instruct'] },
  together:    { default: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', valid: ['meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo','meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
  xai:         { default: 'grok-2', valid: ['grok-2','grok-2-mini','grok-beta'] },
  openrouter:  { default: 'meta-llama/llama-3.1-8b-instruct', valid: ['meta-llama/llama-3.1-8b-instruct','meta-llama/llama-3.3-70b-instruct','mistralai/mistral-7b-instruct','google/gemini-1.5-flash'] },
  gemini:      { default: 'gemini-1.5-flash', valid: ['gemini-1.5-flash','gemini-1.5-pro','gemini-1.5-flash-8b'] },
  sarvam:      { default: 'sarvam-105b', valid: ['sarvam-105b','sarvam-105b-conversations','glm5.2','gemma4'] },
  huggingface: { default: 'meta-llama/Meta-Llama-3.1-8B-Instruct', valid: ['meta-llama/Meta-Llama-3.1-8B-Instruct','mistralai/Mistral-7B-Instruct-v0.3','google/gemma-2-9b-it'] },
  cloudflare:  { default: '@cf/meta/llama-3.1-8b-instruct', valid: ['@cf/meta/llama-3.1-8b-instruct','@cf/mistral/mistral-7b-instruct-v0.1','@cf/google/gemma-2b-it-lora'] },
  aimlapi:     { default: 'meta-llama/Meta-Llama-3.1-8B-Instruct', valid: ['meta-llama/Meta-Llama-3.1-8B-Instruct','meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo','deepseek-chat','deepseek-r1','o3-mini','claude-3-5-sonnet-20241022','gemini-1.5-flash'] }
};

function resolveModel(providerId, requestedModel) {
  const cfg = PROVIDER_MODELS[providerId];
  if (!cfg) return requestedModel || 'unknown';
  if (!requestedModel) return cfg.default;
  if (cfg.valid.includes(requestedModel)) return requestedModel;
  console.log(`⚠️  Modelo "${requestedModel}" no válido para ${providerId}. Fallback: ${cfg.default}`);
  return cfg.default;
}

function loadOwnerKeys() {
  return new Promise((resolve) => {
    const servicesWithKeys = CHAT_SERVICES.filter(s => process.env[s.env]);
    let done = 0;
    if (servicesWithKeys.length === 0) {
      console.log('⚠️  Ninguna API key configurada.');
      return resolve();
    }
    servicesWithKeys.forEach(s => {
      const key = process.env[s.env];
      let url = s.url;
      if (s.id === 'cloudflare' && process.env[s.accountEnv]) {
        url = url.replace('{account_id}', process.env[s.accountEnv]);
      }
      db.get('SELECT id FROM owner_keys WHERE service_id = ?', [s.id], (err, row) => {
        if (err) console.error('Error check key:', err.message);
        if (!row) {
          db.run('INSERT INTO owner_keys (service_id, service_name, api_key, api_url, is_free) VALUES (?,?,?,?,?)',
            [s.id, s.name, key, url, s.isFree ? 1 : 0], (err) => {
              if (err) console.error('Error insert key:', err.message);
              else console.log('✅', s.name, 'configurado');
              done++; if (done >= servicesWithKeys.length) resolve();
            });
        } else {
          db.run('UPDATE owner_keys SET api_key = ?, api_url = ?, is_free = ?, active = 1 WHERE service_id = ?',
            [key, url, s.isFree ? 1 : 0, s.id], (err) => {
              if (err) console.error('Error update key:', err.message);
              done++; if (done >= servicesWithKeys.length) resolve();
            });
        }
      });
    });
  });
}

function getActiveServices(callback) {
  db.all('SELECT * FROM owner_keys WHERE active = 1', [], (err, rows) => {
    if (err) return callback(err, []);
    callback(null, rows || []);
  });
}

let rrIndex = 0;

function pickServiceRoundRobin(services, callback) {
  if (!services || services.length === 0) return callback(null);
  const service = services[rrIndex % services.length];
  rrIndex = (rrIndex + 1) % services.length;
  callback(service);
}

function pickServiceFastest(callback) {
  db.all(`
    SELECT api_name, AVG(latency_ms) as avg_latency
    FROM usage_logs
    WHERE success = 1 AND latency_ms IS NOT NULL AND latency_ms > 0
    GROUP BY api_name
    ORDER BY avg_latency ASC
    LIMIT 1
  `, [], (err, rows) => {
    if (err || !rows || rows.length === 0) {
      return getActiveServices((err, active) => pickServiceRoundRobin(active, callback));
    }
    db.get('SELECT * FROM owner_keys WHERE service_name = ? AND active = 1', [rows[0].api_name], (err, row) => {
      if (err || !row) {
        return getActiveServices((err, active) => pickServiceRoundRobin(active, callback));
      }
      console.log('🚀 Fastest provider:', row.service_name, '~' + Math.round(rows[0].avg_latency) + 'ms');
      callback(row);
    });
  });
}

function pickServiceCheapest(userCredits, callback) {
  getActiveServices((err, active) => {
    if (err || !active || active.length === 0) return callback(null);
    if (userCredits > 0) return pickServiceRoundRobin(active, callback);
    const free = active.filter(s => s.is_free === 1);
    if (free.length > 0) {
      console.log('💰 Modo gratis: usando proveedor gratuito');
      return pickServiceRoundRobin(free, callback);
    }
    console.log('⚠️ Sin créditos ni proveedores gratuitos disponibles');
    callback(null);
  });
}

function pickService(strategy, userCredits, callback) {
  if (strategy === 'fastest') return pickServiceFastest(callback);
  if (strategy === 'cheapest') return pickServiceCheapest(userCredits, callback);
  getActiveServices((err, active) => pickServiceRoundRobin(active, callback));
}

function proxyToProvider(service, reqBody, userId, callback) {
  const startTime = Date.now();
  let body = JSON.parse(JSON.stringify(reqBody));
  const resolvedModel = resolveModel(service.service_id, body.model);
  body.model = resolvedModel;

  if (service.service_id === 'gemini') {
    const messages = (body.messages || []).map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: content }] };
    });
    body = { contents: messages };
  }

  const url = service.service_id === 'gemini'
    ? `${service.api_url}?key=${service.api_key}`
    : service.api_url;

  const headers = {
    'Content-Type': 'application/json',
    ...(service.service_id !== 'gemini' ? { 'Authorization': `Bearer ${service.api_key}` } : {})
  };

  fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    .then(async (response) => {
      const latency = Date.now() - startTime;
      if (!response.ok) {
        const text = await response.text();
        db.run('INSERT INTO usage_logs (user_id, api_name, model, success, error_msg, latency_ms) VALUES (?,?,?,?,?,?)',
          [userId, service.service_name, resolvedModel, 0, `HTTP ${response.status}: ${text.substring(0,200)}`, latency]);
        return callback(new Error(`HTTP ${response.status}`), null, latency);
      }
      const data = await response.json();
      let tokensIn = 0, tokensOut = 0;
      if (data.usage) {
        tokensIn = data.usage.prompt_tokens || 0;
        tokensOut = data.usage.completion_tokens || 0;
      }
      db.run('INSERT INTO usage_logs (user_id, api_name, model, tokens_input, tokens_output, success, latency_ms) VALUES (?,?,?,?,?,?,?)',
        [userId, service.service_name, resolvedModel, tokensIn, tokensOut, 1, latency]);
      db.run('UPDATE users SET total_input = total_input + ?, total_output = total_output + ? WHERE id = ?',
        [tokensIn, tokensOut, userId]);
      const cost = tokensIn / 1000;
      db.run('UPDATE users SET credits = MAX(0, credits - ?) WHERE id = ?', [cost, userId]);

      if (service.service_id === 'gemini') {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return callback(null, {
          id: 'chatcmpl-' + uuidv4(),
          object: 'chat.completion',
          created: Math.floor(Date.now()/1000),
          model: resolvedModel,
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut, total_tokens: tokensIn + tokensOut }
        }, latency, service.service_name);
      }
      callback(null, data, latency, service.service_name);
    })
    .catch(err => {
      db.run('INSERT INTO usage_logs (user_id, api_name, model, success, error_msg) VALUES (?,?,?,?,?)',
        [userId, service.service_name, resolvedModel, 0, err.message]);
      callback(err, null, 0, service.service_name);
    });
}

function tryProviders(reqBody, userId, userCredits, strategy, attempts, callback) {
  if (attempts <= 0) return callback(new Error('Todos los proveedores fallaron'), null);

  pickService(strategy, userCredits, (service) => {
    if (!service) {
      return callback(new Error('No hay servicios activos disponibles'), null);
    }
    proxyToProvider(service, reqBody, userId, (err, result, latency, providerName) => {
      if (!err) {
        result._meta = { provider: providerName, latency_ms: latency };
        return callback(null, result);
      }
      console.log('⚠️ ', providerName, 'falló, reintentando...');
      tryProviders(reqBody, userId, userCredits, strategy, attempts - 1, callback);
    });
  });
}

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.api_key || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Demasiadas peticiones. Espera un minuto.' })
});

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_BASE = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const CREDIT_PACKAGES = {
  small:  { price: '5.00',  credits: 500 },
  medium: { price: '20.00', credits: 2500 },
  large:  { price: '75.00', credits: 10000 }
};

async function getPayPalToken() {
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ':' + PAYPAL_SECRET).toString('base64');
  const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || 'PayPal auth error');
  return d.access_token;
}

// AUTH
app.post('/api/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ error: 'Error de database' });
    if (row) return res.status(409).json({ error: 'Email ya registrado' });

    const apiKey = 'sk-' + uuidv4().replace(/-/g, '');
    const hashed = hashPassword(password);

    db.run('INSERT INTO users (email, password, api_key, name, credits) VALUES (?,?,?,?,?)',
      [email, hashed, apiKey, name || email.split('@')[0], 10], function(err) {
        if (err) return res.status(500).json({ error: 'Error al registrar' });
        db.get('SELECT id, email, api_key, name, credits FROM users WHERE id = ?', [this.lastID], (err, user) => {
          if (err || !user) return res.status(500).json({ error: 'Error al obtener usuario' });
          res.json({ token: generateToken(user), api_key: user.api_key, user });
        });
      });
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) return res.status(500).json({ error: 'Error de database' });
    if (!user || !comparePassword(password, user.password)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    res.json({
      token: generateToken(user),
      api_key: user.api_key,
      user: { id: user.id, email: user.email, api_key: user.api_key, name: user.name, credits: user.credits }
    });
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  db.get('SELECT id, email, api_key, name, credits, total_input, total_output FROM users WHERE id = ?',
    [req.user.id], (err, user) => {
      if (err || !user) return res.status(500).json({ error: 'Error' });
      res.json(user);
    });
});

// PROVIDERS
app.get('/api/providers', apiKeyMiddleware, (req, res) => {
  getActiveServices((err, rows) => {
    if (err) return res.status(500).json({ error: 'Error' });
    res.json((rows || []).map(s => ({
      id: s.service_id,
      name: s.service_name,
      is_active: s.active === 1,
      is_free: s.is_free === 1
    })));
  });
});

// CHAT
app.post('/v1/chat/completions', apiKeyMiddleware, limiter, (req, res) => {
  const strategy = req.headers['x-strategy'] || 'roundrobin';
  const maxAttempts = 3;

  db.get('SELECT credits FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Error de database' });
    const credits = row?.credits || 0;

    tryProviders(req.body, req.user.id, credits, strategy, maxAttempts, (err, result) => {
      if (err) {
        console.error('❌ Todos los proveedores fallaron:', err.message);
        return res.status(503).json({ error: err.message || 'Servicio no disponible' });
      }
      res.setHeader('X-Provider', result._meta.provider);
      res.setHeader('X-Latency-Ms', result._meta.latency_ms);
      delete result._meta;
      res.json(result);
    });
  });
});

// ADMIN
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass || adminPass.length < 6) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD no configurada' });
  }
  if (password !== adminPass) {
    return res.status(403).json({ error: 'Contraseña incorrecta' });
  }
  res.json({ token: generateAdminToken() });
});

app.post('/api/admin/chat', adminMiddleware, (req, res) => {
  const strategy = req.headers['x-strategy'] || 'roundrobin';
  tryProviders(req.body, 0, 999999, strategy, 3, (err, result) => {
    if (err) return res.status(503).json({ error: err.message });
    res.setHeader('X-Provider', result._meta.provider);
    res.setHeader('X-Latency-Ms', result._meta.latency_ms);
    delete result._meta;
    res.json(result);
  });
});

app.get('/api/admin/users', adminMiddleware, (req, res) => {
  db.all(`
    SELECT u.id, u.email, u.name, u.api_key, u.active, u.credits, u.created_at,
           COUNT(l.id) as total_requests,
           SUM(CASE WHEN l.success = 1 THEN 1 ELSE 0 END) as successful
    FROM users u
    LEFT JOIN usage_logs l ON u.id = l.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error de database' });
    res.json(rows || []);
  });
});

app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  db.get('SELECT COUNT(*) as c FROM users', [], (err, u) => {
    if (err) return res.status(500).json({ error: 'Error de database' });
    db.get('SELECT COUNT(*) as c FROM usage_logs', [], (err, r) => {
      if (err) return res.status(500).json({ error: 'Error de database' });
      db.get("SELECT COUNT(*) as c FROM usage_logs WHERE date(created_at) = date('now')", [], (err, t) => {
        if (err) return res.status(500).json({ error: 'Error de database' });
        getActiveServices((err, services) => {
          if (err) return res.status(500).json({ error: 'Error de database' });
          db.all(`SELECT api_name, COUNT(*) as count, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as ok FROM usage_logs GROUP BY api_name`, [], (err, byService) => {
            if (err) return res.status(500).json({ error: 'Error de database' });
            res.json({
              totalUsers: u?.c || 0,
              totalRequests: r?.c || 0,
              todayRequests: t?.c || 0,
              activeServices: services?.length || 0,
              byService: byService || []
            });
          });
        });
      });
    });
  });
});

app.post('/api/admin/toggle-user', adminMiddleware, (req, res) => {
  const { userId, active } = req.body;
  db.run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, userId], (err) => {
    if (err) return res.status(500).json({ error: 'Error de database' });
    res.json({ ok: true });
  });
});

app.get('/api/admin/services', adminMiddleware, (req, res) => {
  getActiveServices((err, rows) => {
    if (err) return res.status(500).json({ error: 'Error de database' });
    res.json((rows || []).map(s => ({ id: s.service_id, name: s.service_name, url: s.api_url, is_free: s.is_free })));
  });
});

// PAYPAL
app.post('/api/paypal/create-order', apiKeyMiddleware, async (req, res) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    return res.status(500).json({ error: 'PayPal no configurado' });
  }
  const pkg = CREDIT_PACKAGES[req.body.package_type];
  if (!pkg) return res.status(400).json({ error: 'Paquete inválido' });

  try {
    const token = await getPayPalToken();
    const order = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: pkg.price },
          description: `${pkg.credits} créditos CHATTAIKO`
        }],
        application_context: {
          return_url: `${req.headers.origin || ''}/?payment=success&credits=${pkg.credits}`,
          cancel_url: `${req.headers.origin || ''}/?payment=cancelled`
        }
      })
    });
    const orderData = await order.json();
    if (!order.ok) throw new Error(orderData.message || 'Error creando orden');

    db.run('INSERT INTO transactions (user_id, amount, credits_purchased, status, provider, paypal_order_id) VALUES (?,?,?,?,?,?)',
      [req.user.id, parseFloat(pkg.price), pkg.credits, 'pending', 'paypal', orderData.id]);

    const approveLink = orderData.links.find(l => l.rel === 'approve');
    res.json({ approval_url: approveLink?.href || orderData.links[0].href });
  } catch (e) {
    console.error('PayPal create error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/paypal/capture', apiKeyMiddleware, async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Token requerido' });

  try {
    const accessToken = await getPayPalToken();
    const capture = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${token}/capture`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    const captureData = await capture.json();

    if (captureData.status === 'COMPLETED') {
      db.get('SELECT credits_purchased FROM transactions WHERE paypal_order_id = ? AND user_id = ?',
        [token, req.user.id], (err, tx) => {
          if (err || !tx) return res.status(500).json({ error: 'Transacción no encontrada' });
          db.run('UPDATE transactions SET status = ? WHERE paypal_order_id = ?', ['completed', token]);
          db.run('UPDATE users SET credits = credits + ? WHERE id = ?', [tx.credits_purchased, req.user.id]);
          res.json({ success: true, credits_added: tx.credits_purchased });
        });
    } else {
      db.run('UPDATE transactions SET status = ? WHERE paypal_order_id = ?', ['failed', token]);
      res.status(400).json({ error: 'Pago no completado', status: captureData.status });
    }
  } catch (e) {
    console.error('PayPal capture error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/paypal/history', apiKeyMiddleware, (req, res) => {
  db.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Error' });
      res.json(rows || []);
    });
});

// INICIAR
loadOwnerKeys().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ CHATTAIKO en http://0.0.0.0:${PORT}`);
  });
});
