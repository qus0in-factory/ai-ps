#!/usr/bin/env node
// /adventure 에셋 생성기. flare 로 통일. 키는 OPENAI_API_KEY 로만 읽고 값을 출력하지 않는다.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
// manifest path is resolved after parsing args (see main)

function fail(message) { throw new Error(message); }

function parseArgs(args) {
  const options = { only: undefined, model: undefined, label: undefined, reuse: undefined, reference: undefined,
    manifest: 'adventure-assets.json', rawOut: '/tmp/adventure-assets/raw', finalOut: 'public/adventure', attempts: 2, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--dry-run') { options.dryRun = true; continue; }
    const name = { '--only': 'only', '--model': 'model', '--label': 'label', '--reuse': 'reuse',
      '--reference': 'reference', '--manifest': 'manifest', '--raw-out': 'rawOut', '--final-out': 'finalOut', '--attempts': 'attempts' }[flag];
    if (!name) fail(`unknown option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) fail(`missing value for ${flag}`);
    options[name] = value;
  }
  if (!options.only) fail('--only <name> is required');
  if (![1, 2].includes(Number(options.attempts))) fail('--attempts must be 1 or 2');
  options.attempts = Number(options.attempts);
  return options;
}

function redact(text) {
  return String(text).replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 300);
}

async function requestImage({ baseUrl, apiKey, model, prompt, reference, size }) {
  if (reference) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('n', '1');
    form.append('image', new Blob([await readFile(path.resolve(root, reference))], { type: 'image/png' }), 'reference.png');
    const response = await fetch(`${baseUrl}/images/edits`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
    });
    const text = await response.text();
    console.log(`EDITS_HTTP ${response.status}`);
    if (response.ok) return text;
    console.log(`EDITS_FALLBACK ${redact(JSON.parse(text)?.error?.message ?? 'edits unavailable')}`);
  }
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, size, n: 1 }),
  });
  const text = await response.text();
  console.log(`HTTP ${response.status}`);
  console.log(`RESPONSE_BYTES ${Buffer.byteLength(text)}`);
  if (!response.ok) fail(`images API ${response.status}: ${redact(JSON.parse(text)?.error?.message ?? 'request failed')}`);
  return text;
}

async function imageBytes(text, baseUrl, apiKey) {
  const data = JSON.parse(text)?.data?.[0];
  if (!data) fail('images API returned no image data');
  if (typeof data.b64_json === 'string') return Buffer.from(data.b64_json, 'base64');
  if (typeof data.url === 'string') {
    const response = await fetch(data.url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) fail(`image download ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  fail('images API returned neither b64_json nor url');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.isAbsolute(options.manifest) ? options.manifest : path.join(here, options.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const asset = manifest.assets.find(entry => entry.name === options.only);
  if (!asset) fail(`unknown asset: ${options.only}`);
  const model = options.model ?? manifest.api.model;
  const label = options.label ?? asset.name;
  const rawPath = path.resolve(root, options.rawOut, `${label}.png`);
  const finalPath = path.resolve(root, options.finalOut, `${asset.name}.png`);
  const palettePath = path.resolve(root, options.finalOut, 'palette.png');
  const prompt = asset.prompt ?? `${manifest.promptPrefix} ${asset.subject}`;
  const baseUrl = (process.env[manifest.api.baseUrlEnv] || manifest.api.defaultBaseUrl).replace(/\/+$/, '');
  const apiKey = process.env[manifest.api.keyEnv];

  console.log(`MODEL ${model}`);
  console.log(`ASSET ${asset.name} -> ${finalPath} (${asset.final}px)`);
  if (options.dryRun) { console.log('DRY-RUN: API call and post-processing skipped'); return; }

  await mkdir(path.dirname(rawPath), { recursive: true });
  if (options.reuse) {
    await copyFile(path.resolve(root, options.reuse), rawPath);
    console.log(`REUSE ${options.reuse}`);
  } else {
    if (!apiKey?.trim()) fail(`${manifest.api.keyEnv} is not set`);
    let lastError;
    for (let attempt = 0; attempt < options.attempts; attempt++) {
      try {
        const text = await requestImage({ baseUrl, apiKey: apiKey.trim(), model, prompt,
          reference: options.reference, size: manifest.api.size });
        const bytes = await imageBytes(text, baseUrl, apiKey.trim());
        await writeFile(rawPath, bytes);
        console.log(`RAW ${rawPath} (${bytes.length} bytes)`);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) console.log('RETRY once after API failure');
      }
    }
    if (lastError) throw lastError;
  }

  const started = Date.now();
  const paletteArgs = manifest.paletteColors ? ['--palette-colors', manifest.paletteColors] : [];
  if (asset.sheet) {
    const grid = asset.grid ?? '3x2';
    const slices = asset.slices ?? [];
    for (const slice of slices) {
      const sliceFinalPath = path.resolve(root, options.finalOut, `${slice.name}.png`);
      const out = execFileSync('python3', ['-I', path.join(here, 'adventure-postprocess.py'),
        rawPath, sliceFinalPath, String(slice.final ?? asset.final), '--palette', palettePath,
        '--grid', grid, '--cell', String(slice.cell ?? 0), ...paletteArgs,
        ...(slice.opaque ? ['--opaque'] : [])], { encoding: 'utf8' });
      console.log(out.trim());
      console.log(`FINAL ${sliceFinalPath} (${(await readFile(sliceFinalPath)).length} bytes)`);
    }
  } else {
    const output = execFileSync('python3', ['-I', path.join(here, 'adventure-postprocess.py'),
      rawPath, finalPath, String(asset.final), '--palette', palettePath, ...paletteArgs,
      ...(asset.opaque ? ['--opaque'] : [])], { encoding: 'utf8' });
    console.log(output.trim());
    console.log(`FINAL ${finalPath} (${(await readFile(finalPath)).length} bytes)`);
  }
  console.log(`ELAPSED_MS ${Date.now() - started}`);
}

main().catch(error => {
  console.error(`FAIL ${error instanceof Error ? error.message : 'internal error'}`);
  process.exitCode = 1;
});
