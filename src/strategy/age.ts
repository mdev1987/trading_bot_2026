export function getAgeHours(createdAt: string, nowMs = Date.now()): number {
  const createdMs = Date.parse(createdAt);

  if (!Number.isFinite(createdMs)) {
    return Number.NaN;
  }

  return Math.max(0, (nowMs - createdMs) / 3_600_000);
}
