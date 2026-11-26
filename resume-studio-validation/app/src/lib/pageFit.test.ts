import { describe, expect, it } from 'vitest';
import { GlobalSettingsSchema } from '../schema/resumeSchema';
import { DENSITY_LIMITS, computeNextCompressionStep, fitResumeToSinglePage } from './pageFit';

describe('pageFit single-page convergence engine', () => {
  it('returns immediately when content already fits within one A4 page', async () => {
    const settings = GlobalSettingsSchema.parse({});
    const result = await fitResumeToSinglePage(settings, () => -24);

    expect(result.fitted).toBe(true);
    expect(result.alreadyFitted).toBe(true);
    expect(result.stepsTaken).toBe(0);
    expect(result.settings).toEqual(settings);
  });

  it('converges to single page by gradually trimming spacing before shrinking font', async () => {
    const settings = GlobalSettingsSchema.parse({
      baseFontSize: 15,
      lineHeight: 1.4,
      sectionSpacing: 24,
      paragraphSpacing: 16,
      pagePadding: 32,
    });

    const result = await fitResumeToSinglePage(settings, (candidate) => {
      // Synthetic overflow model proportional to spacing + font size
      const score =
        candidate.baseFontSize * 45 +
        candidate.lineHeight * 140 +
        candidate.sectionSpacing * 5 +
        candidate.pagePadding * 3;
      return score - 940;
    });

    expect(result.fitted).toBe(true);
    expect(result.alreadyFitted).toBe(false);
    expect(result.stepsTaken).toBeGreaterThan(0);
    expect(result.remainingOverflowPx).toBe(0);
    expect(result.settings.baseFontSize).toBeGreaterThanOrEqual(DENSITY_LIMITS.baseFontSize.min);
  });

  it('stops at readable floor and returns helpful alert when content still overflows', async () => {
    const settings = GlobalSettingsSchema.parse({
      baseFontSize: 12,
      lineHeight: 1.15,
      sectionSpacing: 12,
      paragraphSpacing: 8,
      pagePadding: 20,
    });

    const result = await fitResumeToSinglePage(settings, () => 120);

    expect(result.fitted).toBe(false);
    expect(result.remainingOverflowPx).toBe(120);
    expect(result.settings.baseFontSize).toBe(DENSITY_LIMITS.baseFontSize.min);
    expect(result.settings.lineHeight).toBe(DENSITY_LIMITS.lineHeight.min);
    expect(result.settings.sectionSpacing).toBe(DENSITY_LIMITS.sectionSpacing.min);
    expect(result.settings.pagePadding).toBe(DENSITY_LIMITS.pagePadding.min);
    expect(result.message).toContain('已降至可读下限');
    expect(computeNextCompressionStep(result.settings)).toBeNull();
  });
});
