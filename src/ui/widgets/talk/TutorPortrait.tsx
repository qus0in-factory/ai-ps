import type { TutorGender, TutorMood } from '../../../domain/talk/types.ts';
const labels: Record<TutorMood, string> = { neutral: '편안한 표정', smile: '웃는 표정', think: '생각하는 중', surprised: '놀란 표정', encourage: '응원하는 표정', confused: '궁금한 표정' };
export function TutorPortrait(props: { tutor: TutorGender; mood: TutorMood; decorative?: boolean }) {
  return <img class="talk-portrait" src={`/talk/tutor-${props.tutor}-${props.mood}.png`}
    width={128} height={128} alt={props.decorative ? '' : `${props.tutor === 'f' ? '여성' : '남성'} 튜터 · ${labels[props.mood]}`} />;
}
