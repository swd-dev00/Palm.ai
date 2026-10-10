import { afterEach, describe, it, expect, vi } from 'vitest';
import { evaluateRunnerQuota } from './costQuota';

describe('10.4 Cost/Quota Gate Module', () => {
  afterEach(() => {
    delete process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA;
  });

  it('treats Local Runner execution as zero-cost/unlimited', async () => {
    const mockDbCount = vi.fn();
    const result = await evaluateRunnerQuota(123, 'local', mockDbCount);
    
    expect(result.allowed).toBe(true);
    expect(mockDbCount).not.toHaveBeenCalled();
  });

  it('blocks GitHub Actions if PALM_GITHUB_ACTIONS_DAILY_QUOTA is 0 or unconfigured', async () => {
    process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA = '0';
    const mockDbCount = vi.fn();
    const result = await evaluateRunnerQuota(123, 'github_actions', mockDbCount);
    
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe('quota_blocked');
    }
  });

  it('blocks GitHub Actions if usage meets or exceeds the UTC daily limit', async () => {
    process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA = '5';
    // Mock DB returning 5 (quota exhausted)
    const mockDbCount = vi.fn().mockResolvedValue(5); 
    const result = await evaluateRunnerQuota(123, 'github_actions', mockDbCount);
    
    expect(result.allowed).toBe(false);
  });

  it('blocks GitHub Actions when the quota value is not a number', async () => {
    process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA = 'unlimited';
    const mockDbCount = vi.fn();
    const result = await evaluateRunnerQuota(123, 'github_actions', mockDbCount);
    expect(result.allowed).toBe(false);
    expect(mockDbCount).not.toHaveBeenCalled();
  });

  it('counts usage from the start of the current UTC day', async () => {
    process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA = '5';
    const mockDbCount = vi.fn().mockResolvedValue(0);
    await evaluateRunnerQuota(123, 'github_actions', mockDbCount);
    const since = mockDbCount.mock.calls[0][2] as Date;
    expect(since.getUTCHours()).toBe(0);
    expect(since.getUTCMinutes()).toBe(0);
    expect(Date.now() - since.getTime()).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('allows GitHub Actions and returns quotaContext if under limit', async () => {
    process.env.PALM_GITHUB_ACTIONS_DAILY_QUOTA = '5';
    // Mock DB returning 2 (quota available)
    const mockDbCount = vi.fn().mockResolvedValue(2); 
    const result = await evaluateRunnerQuota(123, 'github_actions', mockDbCount);
    
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.quotaContext?.dailyLimit).toBe(5);
      expect(result.quotaContext?.usedTodayAtDispatch).toBe(2);
    }
  });
});
