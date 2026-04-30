export interface Candidate {
  changedFragmentId: string;
  baseFragmentId: string;
  hitCounts: {
    token: number;
    statement: number;
    call: number;
  };
}

export interface ScoreBreakdown {
  tokenOverlap: number;
  statementKindSimilarity: number;
  callOverlap: number;
  sizeCompatibility: number;
  lengthScore: number;
}

export interface CandidateScore {
  changedFragmentId: string;
  baseFragmentId: string;
  combined: number;
  breakdown: ScoreBreakdown;
}
