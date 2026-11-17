import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const components = readFileSync(new URL('../../../../src/ui/components/adventure/adventure-components.css', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../../../../src/ui/widgets/adventure/Adventure.css', import.meta.url), 'utf8');

function color(pattern: RegExp, source = components): string | undefined {
  return pattern.exec(source)?.[1]?.toLowerCase();
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

const off = color(/\.pixel-bar__cell\s*\{[^}]*background:\s*(#[0-9a-fA-F]{6})/);
const panel = color(/\.adv-status\s*\{[^}]*background:\s*(#[0-9a-fA-F]{6})/, widget);
const tones = ['health', 'warmth', 'focus'].map((tone) => ({
  tone,
  color: color(new RegExp(`\\.pixel-bar--${tone} \\.pixel-bar__cell--on\\s*\\{[^}]*background:\\s*(#[0-9a-fA-F]{6})`)),
}));

describe('Given the stat bar CSS used on the dark status panel', () => {
  it('When the rules are read Then off and on colors are both defined', () => {
    assert.ok(off, 'off 칸 배경색 규칙이 필요하다');
    assert.ok(panel, '패널 배경색 규칙이 필요하다');
    for (const { tone, color: fill } of tones) assert.ok(fill, `${tone} 채움 색 규칙이 필요하다`);
  });

  it('When a cell is filled Then its background differs from the empty cell', () => {
    for (const { tone, color: fill } of tones) {
      assert.notEqual(fill, off, `${tone} 채움 색이 빈 칸과 같으면 안 된다`);
    }
  });

  it('When a cell is filled Then it stands out from the dark panel and the empty cell', () => {
    for (const { tone, color: fill } of tones) {
      assert.ok(contrast(fill!, panel!) >= 3, `${tone} 채움 대비 패널이 3:1 이상이어야 한다`);
      assert.ok(contrast(fill!, off!) >= 3, `${tone} 채움 대비 빈 칸이 3:1 이상이어야 한다`);
    }
  });

  it('When the widget stylesheet is loaded after the component stylesheet Then it does not override cell colors', () => {
    assert.doesNotMatch(widget, /\.pixel-bar__cell[^{]*\{[^}]*background/, '위젯 CSS가 칸 배경을 덮으면 on 색이 죽는다');
  });
});
