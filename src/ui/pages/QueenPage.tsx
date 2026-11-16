import type { QueensGenerationController } from '../../app/queens/generation-store.ts';
import { QueensGeneratorWidget } from '../widgets/queens/QueensGeneratorWidget.tsx';

export function QueenPage(props: { queen: QueensGenerationController }) {
  return <QueensGeneratorWidget controller={props.queen} />;
}
