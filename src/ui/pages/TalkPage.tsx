import type { AudioPlayer } from '../../domain/talk/listening.ts';
import type { Recorder } from '../../domain/talk/recording.ts';
import type { TalkClient } from '../../domain/talk/types.ts';
import type { TalkStore } from '../state/talk-store.ts';
import { TalkWidget } from '../widgets/talk/TalkWidget.tsx';
export function TalkPage(props: { audioPlayer: AudioPlayer; recorder: Recorder; client: TalkClient; store: TalkStore }) {
  return <TalkWidget audioPlayer={props.audioPlayer} recorder={props.recorder} client={props.client} store={props.store} />;
}
