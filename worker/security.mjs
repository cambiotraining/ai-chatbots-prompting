const enc = new TextEncoder();
function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(s) { return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
async function hmacKey(secret) { return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function issueToken(payload, secret, workshopId) {
  const data = base64url(enc.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), tokenSigningInput(workshopId, data));
  return `${data}.${base64url(new Uint8Array(signature))}`;
}

function tokenSigningInput(workshopId, data) {
  // Bind the token to the workshop without putting its ID in the readable payload.
  return enc.encode(JSON.stringify([workshopId, data]));
}

export async function verifyToken(token, secret, workshopId, now = Date.now()) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || parts[0].length > 2000) return null;
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), decode(parts[1]), tokenSigningInput(workshopId, parts[0]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
    return payload;
  } catch { return null; }
}
export async function equalSecret(a, b) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return new Uint8Array(x).every((v, i) => v === new Uint8Array(y)[i]);
}
const secretMinimumLengths = {
  OPENAI_API_KEY: 8,
  WORKSHOP_CODE: 8,
  ADMIN_TOKEN: 8,
  SESSION_SECRET: 32,
  WORKSHOP_ID: 1
};

export function secretConfigurationIssues(env) {
  const issues = [];
  for (const [name, minimumLength] of Object.entries(secretMinimumLengths)) {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('replace-')) {
      issues.push(`${name} is missing or still a placeholder.`);
    } else if (value.length < minimumLength) {
      issues.push(`${name} must be at least ${minimumLength} characters.`);
    }
  }
  return issues;
}

export function isConfigured(env) {
  return secretConfigurationIssues(env).length === 0;
}
export async function readJson(request, maxBytes = 20000) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) throw Object.assign(new Error('This request is too long.'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0, text = '';
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw Object.assign(new Error('This request is too long.'), { status: 413 }); }
    text += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); }
  catch { throw Object.assign(new Error('The request must contain valid JSON.'), { status: 400 }); }
}
