export interface QuotaContext {
  quotaKey: string;
  dailyLimit: number;
  usedTodayAtDispatch: number;
}

export type QuotaDecision = 
  | { allowed: true; reason: string; quotaContext?: QuotaContext }
  | { allowed: false; code: 'quota_blocked'; reason: string };

export async function evaluateRunnerQuota(
  userId: string,
  provider: 'local' | 'github_actions',
  getUsageCount: (userId: string, provider: string, sinceUTC: Date) => Promise<number>
): Promise<QuotaDecision> {
  if (provider === 'local') {
    return { allowed: true, reason: 'Local runner execution is zero-cost and unlimited.' };
  }

  if (provider === 'github_actions') {
    const limitEnv = process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA;
    const dailyLimit = limitEnv ? parseInt(limitEnv, 10) : 0;

    if (dailyLimit <= 0) {
      return { allowed: false, code: 'quota_blocked', reason: 'GitHub Actions daily quota is unconfigured or set to 0.' };
    }

    const now = new Date();
    const startOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const usedTodayAtDispatch = await getUsageCount(userId, provider, startOfDayUTC);

    if (usedTodayAtDispatch >= dailyLimit) {
      return { allowed: false, code: 'quota_blocked', reason: `Exhausted daily quota: ${usedTodayAtDispatch}/${dailyLimit} hosted runs used today.` };
    }

    return {
      allowed: true,
      reason: 'Quota available.',
      quotaContext: { quotaKey: 'github_actions_daily_utc', dailyLimit, usedTodayAtDispatch }
    };
  }

  return { allowed: false, code: 'quota_blocked', reason: `Unknown provider: ${provider}` };
}
