export type AdventureLogEvent = { event: 'model_request' | 'model_error' | 'dice' | 'invalid' | 'turn_complete' | 'summary' | 'summary_error'; turn: number; narrativeLength?: number; round?: number };
export type AdventureLogListener = (event: AdventureLogEvent) => void;
