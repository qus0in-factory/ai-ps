import type { AdventureClient } from '../../domain/adventure/types.ts';
import type { AdventureStore } from '../state/adventure-store.ts';
import { AdventureWidget } from '../widgets/adventure/AdventureWidget.tsx';

export function AdventurePage(props: { client: AdventureClient; store: AdventureStore }) {
  return <AdventureWidget client={props.client} store={props.store} />;
}
