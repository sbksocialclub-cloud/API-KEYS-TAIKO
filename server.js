require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('./database');
const { hashPassword, comparePassword, generateToken, generateAdminToken, authMiddleware, apiKeyMiddleware, adminMiddleware } = require('./auth');

const app = express();

// ============== CORS RESTRINGIDO ==============
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(o => o.trim());
app.use(cors({
  origin: allowedOrigins[0] === '*' ? true : allowedOrigins,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Admin-Token']
}));

// ============== BODY LIMITADO ==============
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 8080;

// ============== SERVICIOS DE CHAT ==============
const CHAT_SERVICES = [
  { id: 'groq',        name: 'Groq',         env: 'GROQ_API_KEY',        url: 'https://api.groq.com/openai/v1/chat/completions' },
  { id: 'cerebras',    name: 'Cerebras',     env: 'CEREBRAS_API_KEY',    url: 'https://api.cerebras.ai/v1/chat/completions' },
  { id: 'mistral',     name: 'Mistral',      env: 'MISTRAL_API_KEY',     url: 'https://api.mistral.ai/v1/chat/completions' },
  { id: 'gemini',      name: 'Gemini',       env: 'GEMINI_API_KEY',      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent' },
  { id: 'siliconflow', name: 'SiliconFlow',  env: 'SILICONFLOW_API_KEY', url: 'https://api.siliconflow.cn/v1/chat/completions' },
  { id: 'together',    name: 'Together',     env: 'TOGETHER_API_KEY',    url: 'https://api.together.xyz/v1/chat/completions' },
  { id: 'xai',         name: 'xAI Grok',     env: 'XAI_API_KEY',         url: 'https://api.x.ai/v1/chat/completions' },
  { id: 'openrouter',  name: 'OpenRouter',   env: 'OPENROUTER_API_KEY',  url: 'https://openrouter.ai/api/v1/chat/completions' },
  { id: 'sarvam',      name: 'Sarvam AI',    env: 'SARVAM_API_KEY',      url: 'https://api.sarvam.ai/v1/chat/completions' },
  { id: 'huggingface', name: 'Hugging Face', env: 'HUGGINGFACE_API_KEY', url: 'https://api-inference.huggingface.co/v1/chat/completions' },
  { id: 'cloudflare',  name: 'Cloudflare',   env: 'CLOUDFLARE_API_KEY',  url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions', accountEnv: 'CLOUDFLARE_ACCOUNT_ID' },
  { id: 'aimlapi',     name: 'AI/ML API',    env: 'AIML_API_KEY',        url: 'https://api.aimlapi.com/v1/chat/completions' },
];

// ============== MAPEO DE MODELOS POR PROVEEDOR ==============
const PROVIDER_MODELS = {
  groq: {
    default: 'llama-3.1-8b-instant',
    valid: ['llama-3.1-8b-instant', 'llama3-8b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'llama-3.3-70b-versatile']
  },
  cerebras: {
    default: 'llama3.1-8b',
    valid: ['llama3.1-8b', 'llama3.3-70b']
  },
  mistral: {
    default: 'mistral-small-latest',
    valid: ['mistral-small-latest', 'mistral-medium-latest', 'open-mistral-7b', 'open-mistral-nemo', 'codestral-latest']
  },
  siliconflow: {
    default: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    valid: ['meta-llama/Meta-Llama-3.1-8B-Instruct', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct']
  },
  together: {
    default: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    valid: ['meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', 'meta-llama/Llama-3.3-70B-Instruct-Turbo']
  },
  xai: {
    default: 'grok-2',
    valid: ['grok-2', 'grok-2-mini', 'grok-beta']
  },
  openrouter: {
    default: 'meta-llama/llama-3.1-8b-instruct',
    valid: ['meta-llama/llama-3.1-8b-instruct', 'meta-llama/llama-3.3-70b-instruct', 'mistralai/mistral-7b-instruct', 'google/gemini-1.5-flash']
  },
  gemini: {
    default: 'gemini-1.5-flash',
    valid: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash-8b']
  },
  sarvam: {
    default: 'sarvam-105b',
    valid: ['sarvam-105b', 'sarvam-105b-conversations', 'glm5.2', 'gemma4']
  },
  huggingface: {
    default: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    valid: ['meta-llama/Meta-Llama-3.1-8B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3', 'google/gemma-2-9b-it']
  },
  cloudflare: {
    default: '@cf/meta/llama-3.1-8b-instruct',
    valid: ['@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.1', '@cf/google/gemma-2b-it-lora']
  },
  aimlapi: {
    default: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    valid: [
      'meta-llama/Meta-Llama-3.1-8B-Instruct',
      'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
      'deepseek-chat',
      'deepseek-r1',
      'o3-mini',
      'gpt-5.6-sol',
      'claude-3-5-sonnet-20241022',
      'gemini-1.5-flash'
    ]
  }
};

function resolveModel(providerId, requestedModel) {
  const cfg = PROVIDER_MODELS[providerId];
  if (!cfg) return requestedModel || 'unknown';
  if (!requestedModel) return cfg.default;
  if (cfg.valid.includes(requestedModel)) return requestedModel;
  console.log(`⚠️  Modelo "${requestedModel}" no válido para ${providerId}. Usando fallback: ${cfg.default}`);
  return cfg.default;
}

// ============== CARGAR CLAVES DEL DUEÑO ==============
function loadOwnerKeys() {
  return new Promise((resolve) => {
    const servicesWithKeys = CHAT_SERVICES.filter(s => process.env[s.env]);
    let done = 0;

    if (servicesWithKeys.length === 0) {
      console.log('⚠️  Ninguna API key configurada. Añade claves en el .env');
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
          db.run('INSERT INTO owner_keys (service_id, service_name, api_key, api_url) VALUES (?,?,?,?)',
            [s.id, s.name, key, url], (err) => {
              if (err) console.error('Error insert key:', err.message);
              else console.log('✅', s.name, 'configurado');
              done++; if (done >= servicesWithKeys.length) resolve();
            });
        } else {
          db.run('UPDATE owner_keys SET api_key = ?, api_url = ?, active = 1 WHERE service_id = ?', [key, url, s.id], (err) => {
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

// ============== ORQUESTADOR CON FALLBACK ==============
let rrIndex = 0;

function pickService(callback) {
  getActiveServices((err, active) => {
    if (err || !active || active.length === 0) return callback(null);
    const service = active[rrIndex % active.length];
    rrIndex = (rrIndex + 1) % active.length;
    callback(service);
  });
}

function tryProviders(reqBody, userId, attempts, callback) {
  if (attempts <= 0) {
    return callback(new Error('Todos los proveedores fallaron'), null);
  }

  pickService((service) => {
    if (!service) {
      return callback(new Error('No hay servicios activos'), null);
    }

    proxyToProvider(service, reqBody, userId, (err, result) => {
      if (!err) return callback(null, result);
      console.log('⚠️ ', service.service_name, 'falló, reintentando...');
      tryProviders(reqBody, userId, attempts - 1, callback);
    });
  });
}

function proxyToProvider(service, reqBody, userId, callback) {
  const startTime = Date.now();
  let body = JSON.parse(JSON.stringify(reqBody));

  // ========== RESOLVER MODELO CORRECTO ==========
  const resolvedModel = resolveModel(service.service_id, body.model);
  body.model = resolvedModel;

  // Adaptar formato Gemini
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
        return callback(new Error(`HTTP ${response.status}`), null);
      }

      const data = await response.json();

      let tokensIn = 0, tokensOut = 0;
      if (data.usage) {
        tokensIn = data.usage.prompt_tokens || 0;
        tokensOut = data.usage.completion_tokens || 0;
      }

      db.run('INSERT INTO usage_logs (user_id, api_name, model, tokens_input, tokens_output, success, latency_ms) VALUES (?,?,?,?,?,?,?)',
        [userId, service.service_name, resolvedModel, tokensIn, tokensOut, 1, latency]);

      if (service.service_id === 'gemini') {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return callback(null, {
          id: 'chatcmpl-' + uuidv4(),
          object: 'chat.completion',
          created: Math.floor(Date.now()/1000),
          model: resolvedModel,
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut, total_tokens: tokensIn + tokensOut }
        });
      }

      callback(null, data);
    })
    .catch(err => {
      db.run('INSERT INTO usage_logs (user_id, api_name, model, success, error_msg) VALUES (?,?,?,?,?)',
        [userId, service.service_name, resolvedModel, 0, err.message]);
      callback(err, null);
    });
}

// ============== RATE LIMITING ==============
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.api_key || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'Demasiadas peticiones. Espera un minuto.' })
});

// ============== AUTH ROUTES ==============
app.post('/api/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    if (row) return res.status(409).json({ error: 'Email ya registrado' });

    const apiKey = 'sk-' + uuidv4().replace(/-/g, '');
    const hashed = hashPassword(password);

    db.run('INSERT INTO users (email, password, api_key, name) VALUES (?,?,?,?)',
      [email, hashed, apiKey, name || email.split('@')[0]], function(err) {
        if (err) return res.status(500).json({ error: 'Error al registrar' });
        db.get('SELECT id, email, api_key, name FROM users WHERE id = ?', [this.lastID], (err, user) => {
          if (err || !user) return res.status(500).json({ error: 'Error al obtener usuario' });
          res.json({ token: generateToken(user), user });
        });
      });
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    if (!user || !comparePassword(password, user.password)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    res.json({ token: generateToken(user), user: { id: user.id, email: user.email, api_key: user.api_key, name: user.name } });
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, api_key: req.user.api_key, name: req.user.name });
});

// ============== ADMIN LOGIN ==============
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminPass || adminPass.length < 6) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD no configurada' });
  }

  if (!comparePassword(password, hashPassword(adminPass))) {
    if (password !== adminPass) {
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }
  }

  res.json({ token: generateAdminToken() });
});

// ============== CHAT / PROXY CON FALLBACK ==============
app.post('/v1/chat/completions', apiKeyMiddleware, limiter, (req, res) => {
  const maxAttempts = 3;

  tryProviders(req.body, req.user.id, maxAttempts, (err, result) => {
    if (err) {
      console.error('❌ Todos los proveedores fallaron:', err.message);
      return res.status(503).json({ error: 'Servicio temporalmente no disponible. Inténtalo más tarde.' });
    }
    res.json(result);
  });
});

// ============== ADMIN ROUTES ==============
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  db.all(`
    SELECT u.id, u.email, u.name, u.api_key, u.active, u.created_at,
           COUNT(l.id) as total_requests,
           SUM(CASE WHEN l.success = 1 THEN 1 ELSE 0 END) as successful
    FROM users u
    LEFT JOIN usage_logs l ON u.id = l.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    res.json(rows || []);
  });
});

app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  db.get('SELECT COUNT(*) as c FROM users', [], (err, u) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    db.get('SELECT COUNT(*) as c FROM usage_logs', [], (err, r) => {
      if (err) return res.status(500).json({ error: 'Error de base de datos' });
      db.get("SELECT COUNT(*) as c FROM usage_logs WHERE date(created_at) = date('now')", [], (err, t) => {
        if (err) return res.status(500).json({ error: 'Error de base de datos' });
        getActiveServices((err, services) => {
          if (err) return res.status(500).json({ error: 'Error de base de datos' });
          db.all(`SELECT api_name, COUNT(*) as count, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as ok FROM usage_logs GROUP BY api_name`, [], (err, byService) => {
            if (err) return res.status(500).json({ error: 'Error de base de datos' });
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
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    res.json({ ok: true });
  });
});

app.get('/api/admin/services', adminMiddleware, (req, res) => {
  getActiveServices((err, rows) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    res.json((rows || []).map(s => ({ id: s.service_id, name: s.service_name, url: s.api_url })));
  });
});

// ============== INICIAR ==============
loadOwnerKeys().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ CHATTAIKO en http://0.0.0.0:${PORT}`);
  });
});
