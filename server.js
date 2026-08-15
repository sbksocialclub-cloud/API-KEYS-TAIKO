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

// ============== SERVICIOS DE CHAT (solo chat completions) ==============
const CHAT_SERVICES = [
  { id: 'groq',       name: 'Groq',        env: 'GROQ_API_KEY',       url: 'https://api.groq.com/openai/v1/chat/completions' },
  { id: 'cerebras',   name: 'Cerebras',    env: 'CEREBRAS_API_KEY',   url: 'https://api.cerebras.ai/v1/chat/completions' },
  { id: 'mistral',    name: 'Mistral',     env: 'MISTRAL_API_KEY',    url: 'https://api.mistral.ai/v1/chat/completions' },
  { id: 'gemini',     name: 'Gemini',      env: 'GEMINI_API_KEY',     url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent' },
  { id: 'siliconflow',name: 'SiliconFlow', env: 'SILICONFLOW_API_KEY',url: 'https://api.siliconflow.cn/v1/chat/completions' },
  { id: 'together',   name: 'Together',    env: 'TOGETHER_API_KEY',   url: 'https://api.together.xyz/v1/chat/completions' },
  { id: 'xai',        name: 'xAI Grok',    env: 'XAI_API_KEY',        url: 'https://api.x.ai/v1/chat/completions' },
  { id: 'openrouter', name: 'OpenRouter',  env: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/chat/completions' },
];

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
      db.get('SELECT id FROM owner_keys WHERE service_id = ?', [s.id], (err, row) => {
        if (err) console.error('Error check key:', err.message);
        if (!row) {
          db.run('INSERT INTO owner_keys (service_id, service_name, api_key, api_url) VALUES (?,?,?,?)',
            [s.id, s.name, key, s.url], (err) => {
              if (err) console.error('Error insert key:', err.message);
              else console.log('✅', s.name, 'configurado');
              done++; if (done >= servicesWithKeys.length) resolve();
            });
        } else {
          db.run('UPDATE owner_keys SET api_key = ?, active = 1 WHERE service_id = ?', [key, s.id], (err) => {
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

// ============== ORQUESTADOR CON FALLBACK REAL ==============
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
          [userId, service.service_name, reqBody.model || 'unknown', 0, `HTTP ${response.status}: ${text.substring(0,200)}`, latency]);
        return callback(new Error(`HTTP ${response.status}`), null);
      }

      const data = await response.json();

      // Extraer tokens si están disponibles
      let tokensIn = 0, tokensOut = 0;
      if (data.usage) {
        tokensIn = data.usage.prompt_tokens || 0;
        tokensOut = data.usage.completion_tokens || 0;
      }

      db.run('INSERT INTO usage_logs (user_id, api_name, model, tokens_input, tokens_output, success, latency_ms) VALUES (?,?,?,?,?,?,?)',
        [userId, service.service_name, reqBody.model || 'unknown', tokensIn, tokensOut, 1, latency]);

      // Normalizar respuesta Gemini
      if (service.service_id === 'gemini') {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return callback(null, {
          id: 'chatcmpl-' + uuidv4(),
          object: 'chat.completion',
          created: Math.floor(Date.now()/1000),
          model: reqBody.model || 'gemini-1.5-flash',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut, total_tokens: tokensIn + tokensOut }
        });
      }

      callback(null, data);
    })
    .catch(err => {
      db.run('INSERT INTO usage_logs (user_id, api_name, model, success, error_msg) VALUES (?,?,?,?,?)',
        [userId, service.service_name, reqBody.model || 'unknown', 0, err.message]);
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

// ============== ADMIN LOGIN (JWT, no texto plano) ==============
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminPass || adminPass.length < 6) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD no configurada' });
  }

  if (!comparePassword(password, hashPassword(adminPass))) {
    // Nota: en producción, el admin pass debería estar hasheado en .env
    // Para simplificar, comparamos directamente aquí
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
