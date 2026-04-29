export function riskFlagA(score: number): boolean {
  if (score < 0) return true;
  if (score > 100) return true;
  return score % 2 === 0;
}
