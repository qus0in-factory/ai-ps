import type { Ending } from '../../../domain/adventure/types.ts';
import { AdventureAsset } from '../../components/adventure/AdventureAsset.tsx';

const copy: Record<Ending, { title: string; text: string; asset: string }> = {
  cleared: {
    title: '등대가 켜졌다',
    text: '불빛이 암초 해역을 가른다. 보급선이 안전하게 지나간다.',
    asset: 'lighthouse-lit',
  },
  dead: {
    title: '쓰러졌다',
    text: '체력이 바닥났다. 등대는 꺼진 채로 남았다.',
    asset: 'lighthouse-dark',
  },
  missed: {
    title: '닷새가 지났다',
    text: '등대는 끝내 켜지지 않았고, 보급선은 암초를 피하지 못했다.',
    asset: 'lighthouse-dark',
  },
};

export function EndingPanel(props: { ending: Ending; day: number; onRestart: () => void }) {
  const ending = () => copy[props.ending];
  return (
    <section class="adv-ending" role="status" aria-label="엔딩">
      <AdventureAsset name={ending().asset} alt="" size={96} fallback="등대" class="adv-ending__art" />
      <div>
        <h2>{ending().title}</h2>
        <p>{ending().text}</p>
        <p class="adv-ending__day">{props.day}일차에 끝났습니다.</p>
      </div>
      <button type="button" onClick={props.onRestart}>새 게임</button>
    </section>
  );
}
