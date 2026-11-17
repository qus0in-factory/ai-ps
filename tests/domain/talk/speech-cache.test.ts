import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSpeechCacheKey, MAX_TTS_TEXT_LENGTH, TALK_FIXED_PHRASES } from '../../../src/domain/talk/speech-cache.ts';

const identity = { model: 'test-tts', voice: 'coral', promptVersion: 'ja-v1' };

describe('Given canonical speech cache keys', () => {
  it('When Japanese whitespace and decomposed characters vary Then produces the same SHA256 key and canonical speech text', async () => {
    const first = await createSpeechCacheKey('　カ\u3099\t\n  こんにちは　　世界　', identity);
    const second = await createSpeechCacheKey('ガ こんにちは 世界', identity);
    assert.deepEqual(first, second);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.text, 'ガ こんにちは 世界');
    const hash = createHash('sha256').update('test-tts|coral|ja-v1|ガ こんにちは 世界').digest('hex');
    assert.equal(first.value.key, `tts/v1/${hash}.wav`);
    assert.match(first.value.key, /^tts\/v1\/[a-f0-9]{64}\.wav$/);
  });
  it('When identity, case, punctuation or non-whitespace width changes Then keeps the keys separate', async () => {
    const values = await Promise.all([
      createSpeechCacheKey('Hello!', identity), createSpeechCacheKey('hello!', identity),
      createSpeechCacheKey('Hello?', identity), createSpeechCacheKey('Ｈello!', identity),
      createSpeechCacheKey('Hello!', { ...identity, model: 'other' }),
      createSpeechCacheKey('Hello!', { ...identity, voice: 'other' }),
      createSpeechCacheKey('Hello!', { ...identity, promptVersion: 'ja-v2' }),
    ]);
    assert.ok(values.every(value => value.ok));
    assert.equal(new Set(values.map(value => value.ok ? value.value.key : '')).size, values.length);
  });
  it('When text is empty or over the normalized 400-character limit Then refuses it', async () => {
    assert.equal(MAX_TTS_TEXT_LENGTH, 400);
    for (const text of ['', ' \t　', 'あ'.repeat(401)]) assert.equal((await createSpeechCacheKey(text, identity)).ok, false);
    assert.equal((await createSpeechCacheKey('　' + 'あ'.repeat(400) + '　', identity)).ok, true);
  });
  it('When identity fields contain a delimiter Then refuses ambiguous hash inputs', async () => {
    assert.equal((await createSpeechCacheKey('こんにちは', { ...identity, model: 'model|voice' })).ok, false);
  });
});

describe('Given reusable Japanese tutor expressions', () => {
  it('When selecting a fixed phrase Then exports exact Japanese strings ready for cache reuse', () => {
    assert.equal(TALK_FIXED_PHRASES.repeat, 'もう一度言ってもらえますか？');
    assert.ok(Object.keys(TALK_FIXED_PHRASES).length >= 4);
    assert.ok(Object.values(TALK_FIXED_PHRASES).every(text => text === text.normalize('NFC') && text.length <= MAX_TTS_TEXT_LENGTH));
    assert.equal(Object.isFrozen(TALK_FIXED_PHRASES), true);
  });
});
