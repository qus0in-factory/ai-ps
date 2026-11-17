import type { TalkClient } from '../../domain/talk/types.ts';
import type { TalkStore } from '../state/talk-store.ts';
import { TalkWidget } from '../widgets/talk/TalkWidget.tsx';
export function TalkPage(props: { client: TalkClient; store: TalkStore }) {
  return <TalkWidget client={props.client} store={props.store} />;
}
