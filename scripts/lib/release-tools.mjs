import { parseEnv, stripVTControlCharacters } from 'node:util';

export const APP_KEYS = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_TOOL_MODE', 'OWM_API_KEY', 'OPENAI_BASE_URL', 'LOG_LEVEL'];

export function filterAppSecrets(text) {
  const env = parseEnv(text);
  return Object.fromEntries(APP_KEYS.filter(key => env[key]?.trim()).map(key => [key, env[key]]));
}

export function parseDeployment(output) {
  const plain = stripVTControlCharacters(output);
  const url = plain.match(/(?:^|\s)(https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev)(?=\s|$)/im)?.[1];
  const versionId = plain.match(/(?:Current )?Version ID:\s*([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\b/i)?.[1];
  return url && versionId ? { url, versionId } : null;
}

export function judgeSmoke(path, status, contentType, body) {
  let contentPresent = false;
  try { contentPresent = typeof JSON.parse(body)?.content === 'string'; } catch { /* Not JSON. */ }
  const ok = status === 200 && (path !== '/api/chat' ||
    (/^application\/json(?:\s*;|$)/i.test(contentType) && contentPresent));
  return { ok, length: Array.from(body).length, contentPresent };
}

export function staleSecretNames(output, localSecrets) {
  const remote = JSON.parse(output);
  if (!Array.isArray(remote) || remote.some(item => !item || typeof item.name !== 'string')) throw new Error('invalid secret list');
  return APP_KEYS.filter(key => remote.some(item => item.name === key) && !(key in localSecrets));
}

export function classifyWorktree(porcelain) {
  const entries = porcelain.split('\0');
  const result = { dirty: [], untracked: [] };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.startsWith('?? ')) result.untracked.push(entry.slice(3));
    else {
      result.dirty.push(entry.slice(3));
      if (/[RC]/.test(entry.slice(0, 2))) i++;
    }
  }
  return result;
}
