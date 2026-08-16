const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./base de datos');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('❌ FATAL: JWT_SECRET debe tener al menos 32 caracteres');
  process.exit(1);
}

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || JWT_SECRET + '_admin';

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, api_key: user.api_key },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function generateAdminToken() {
  return jwt.sign(
    { role: 'admin', iat: Date.now() },
    ADMIN_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.get('SELECT * FROM users WHERE id = ? AND active = 1', [decoded.id], (err, user) => {
      if (err) return res.status(500).json({ error: 'Error de base de datos' });
      if (!user) return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
      req.user = user;
      next();
    });
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function apiKeyMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'X-API-Key requerida' });

  db.get('SELECT * FROM users WHERE api_key = ? AND active = 1', [apiKey], (err, user) => {
    if (err) return res.status(500).json({ error: 'Error de base de datos' });
    if (!user) return res.status(401).json({ error: 'API key inválida' });
    req.user = user;
    next();
  });
}

function adminMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(403).json({ error: 'Token admin requerido' });

  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error();
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
}

module.exports = {
  hashPassword, comparePassword, generateToken, generateAdminToken,
  authMiddleware, apiKeyMiddleware, adminMiddleware
};
