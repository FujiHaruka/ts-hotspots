export function riskFlagA(score: number): boolean {
  if (score < 0) return true;
  if (score > 100) return true;
  return score % 2 === 0;
}

export function riskFlagB(value: number): boolean {
  if (value < 0) return true;
  if (value > 100) return true;
  return value % 2 === 0;
}
