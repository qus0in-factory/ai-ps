export type ResearchTool = 'search_web' | 'read_webpage';

export interface ResearchStep {
  tool: ResearchTool;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface ResearchEvaluation {
  passed: boolean;
  problems: string[];
}

export interface ResearchResult {
  report: string;
  steps: ResearchStep[];
  sources: string[];
  iterations: number;
  capped: boolean;
  evaluation?: ResearchEvaluation;
}
