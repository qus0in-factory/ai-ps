import type { ResearchClient } from '../widgets/research/types.ts';
import { ResearchWidget } from '../widgets/research/ResearchWidget.tsx';

export function ResearchPage(props: { client: ResearchClient }) {
  return <ResearchWidget client={props.client} />;
}
