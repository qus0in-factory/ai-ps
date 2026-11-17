import type { QueensGenerationController } from '../../app/queens/generation-store.ts';
import { QueensGeneratorWidget } from '../widgets/queens/QueensGeneratorWidget.tsx';

export function QueensPage(props: { queens: QueensGenerationController }) {
  return <QueensGeneratorWidget controller={props.queens} />;
}
