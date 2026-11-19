export type ResearchTool = 'search_web' | 'read_webpage';

export interface ResearchStep {
  tool: ResearchTool;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface ResearchResult {
  report: string;
  steps: ResearchStep[];
  sources: string[];
  iterations: number;
  capped: boolean;
}
