#!/usr/bin/env node
import { readFile, writeFile, access, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const manifestPath = path.join(here, 'og.json');
const indexPath = path.join(root, 'index.html');
const imageOutputPath = path.join(root, 'public', 'og-image.png');
const pythonScript = path.join(here, 'og-image.py');

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ogBlock(config) {
  const site = config.site ?? {};
  const image = config.image ?? {};
  const lines = [
    '    <!-- og:start -->',
    `    <meta name="description" content="${escapeAttr(site.metaDescription ?? '')}" />`,
    `    <meta property="og:title" content="${escapeAttr(site.ogTitle ?? '')}" />`,
    `    <meta property="og:description" content="${escapeAttr(site.ogDescription ?? '')}" />`,
    `    <meta property="og:image:width" content="${image.width}" />`,
    `    <meta property="og:image:height" content="${image.height}" />`,
    `    <meta property="og:image:type" content="${escapeAttr(image.type ?? 'image/png')}" />`,
    `    <meta property="og:image:alt" content="${escapeAttr(site.imageAlt ?? '')}" />`,
    '    <!-- og:end -->',
  ];
  return lines.join('\n');
}

export function replaceOgBlock(html, block) {
  const start = html.indexOf('<!-- og:start -->');
  const end = html.indexOf('<!-- og:end -->');
  if (start === -1 || end === -1 || end < start) throw new Error('OG markers not found');
  const lineStart = html.lastIndexOf('\n', start) + 1;
  const endMarkerEnd = end + '<!-- og:end -->'.length;
  return html.slice(0, lineStart) + block + html.slice(endMarkerEnd);
}

export async function loadConfig() {
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

export async function checkFeatureImages(config) {
  for (const feature of config.features ?? []) {
    if (feature.image) {
      const full = path.join(root, 'public', String(feature.image).replace(/^\/+/, ''));
      try { await access(full); } catch { throw new Error(`Missing OG source image: ${feature.image}`); }
    }
  }
}

export async function generateImage(output) {
  execFileSync('python3', ['-I', pythonScript, manifestPath, output], { stdio: 'inherit' });
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const config = await loadConfig();
  await checkFeatureImages(config);
  const expectedHtml = replaceOgBlock(await readFile(indexPath, 'utf8'), ogBlock(config));

  if (check) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'og-'));
    const tempImage = path.join(tempDir, 'og-check.png');
    try {
      await generateImage(tempImage);
      const committedHtml = await readFile(indexPath, 'utf8');
      const committedImage = await readFile(imageOutputPath);
      const generatedImage = await readFile(tempImage);
      let failed = false;
      if (committedHtml !== expectedHtml) {
        console.error('STALE index.html (OG block)');
        failed = true;
      }
      if (!committedImage.equals(generatedImage)) {
        console.error('STALE public/og-image.png');
        failed = true;
      }
      if (failed) {
        console.error('Run "pnpm og" and commit the result.');
        process.exitCode = 1;
        return;
      }
      console.log('OG check passed');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    return;
  }

  await generateImage(imageOutputPath);
  await writeFile(indexPath, expectedHtml);
  console.log('OG generated');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
