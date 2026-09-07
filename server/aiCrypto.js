import crypto from 'node:crypto';

const AI_KEY_CONTEXT = Buffer.from('caddyui:ai-provider-key:v1');

function deriveKey(secret, salt) {
  if (!String(secret || '').trim()) throw new Error('CADDY_UI_SECRET is required for AI key encryption.');
  return crypto.hkdfSync('sha256', Buffer.from(String(secret)), salt, AI_KEY_CONTEXT, 32);
}

export function encryptAiApiKey(apiKey, secret) {
  const value = String(apiKey || '').trim();
  if (!value) return null;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(secret, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AI_KEY_CONTEXT);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptAiApiKey(encrypted, secret) {
  if (!encrypted || encrypted.version !== 1) return '';
  try {
    const salt = Buffer.from(String(encrypted.salt || ''), 'base64');
    const iv = Buffer.from(String(encrypted.iv || ''), 'base64');
    const ciphertext = Buffer.from(String(encrypted.ciphertext || ''), 'base64');
    const tag = Buffer.from(String(encrypted.tag || ''), 'base64');
    const key = deriveKey(secret, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AI_KEY_CONTEXT);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
