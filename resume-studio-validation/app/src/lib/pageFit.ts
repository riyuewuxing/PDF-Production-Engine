import type { GlobalSettings } from '../schema/resumeSchema';

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const PX_PER_MM = 96 / 25.4;
export const A4_WIDTH_PX = A4_WIDTH_MM * PX_PER_MM; // ~793.7px
export const A4_HEIGHT_PX = A4_HEIGHT_MM * PX_PER_MM; // ~1122.52px

export const DENSITY_LIMITS = {
  baseFontSize: { min: 11, max: 18, step: 0.5 },
  lineHeight: { min: 1.08, max: 1.8, step: 0.04 },
  sectionSpacing: { min: 8, max: 36, step: 2 },
  paragraphSpacing: { min: 4, max: 28, step: 2 },
  pagePadding: { min: 16, max: 48, step: 2 },
} as const;

function roundTwo(val: number): number {
  return Math.round(val * 100) / 100;
}

function syncHeadingSizes(settings: GlobalSettings): GlobalSettings {
  const nextHeader = Math.max(14, Math.min(settings.headerSize, Math.round(settings.baseFontSize + 3)));
  const nextSubheader = Math.max(12, Math.min(settings.subheaderSize, Math.round(settings.baseFontSize + 1)));
  return {
    ...settings,
    headerSize: nextHeader,
    subheaderSize: nextSubheader,
  };
}

/**
 * Computes the next gentler-to-stronger compression step toward fitting inside 1 A4 page.
 * Returns null once all density controls have reached their readable minimum floor.
 */
export function computeNextCompressionStep(current: GlobalSettings): GlobalSettings | null {
  const next = { ...current };

  // Stage 1: trim generous whitespace before touching body font size
  if (next.sectionSpacing > 14) {
    next.sectionSpacing = Math.max(14, next.sectionSpacing - DENSITY_LIMITS.sectionSpacing.step);
    return next;
  }
  if (next.paragraphSpacing > 8) {
    next.paragraphSpacing = Math.max(8, next.paragraphSpacing - DENSITY_LIMITS.paragraphSpacing.step);
    return next;
  }
  if (next.pagePadding > 24) {
    next.pagePadding = Math.max(24, next.pagePadding - DENSITY_LIMITS.pagePadding.step);
    return next;
  }

  // Stage 2: tighten line-height and font size moderately
  if (next.lineHeight > 1.15) {
    next.lineHeight = roundTwo(Math.max(1.15, next.lineHeight - DENSITY_LIMITS.lineHeight.step));
    return next;
  }
  if (next.baseFontSize > 12) {
    next.baseFontSize = roundTwo(Math.max(12, next.baseFontSize - DENSITY_LIMITS.baseFontSize.step));
    return syncHeadingSizes(next);
  }

  // Stage 3: push remaining spacing & typography to readable floor
  if (next.sectionSpacing > DENSITY_LIMITS.sectionSpacing.min) {
    next.sectionSpacing = Math.max(
      DENSITY_LIMITS.sectionSpacing.min,
      next.sectionSpacing - DENSITY_LIMITS.sectionSpacing.step,
    );
    return next;
  }
  if (next.pagePadding > DENSITY_LIMITS.pagePadding.min) {
    next.pagePadding = Math.max(
      DENSITY_LIMITS.pagePadding.min,
      next.pagePadding - DENSITY_LIMITS.pagePadding.step,
    );
    return next;
  }
  if (next.paragraphSpacing > DENSITY_LIMITS.paragraphSpacing.min) {
    next.paragraphSpacing = Math.max(
      DENSITY_LIMITS.paragraphSpacing.min,
      next.paragraphSpacing - DENSITY_LIMITS.paragraphSpacing.step,
    );
    return next;
  }
  if (next.lineHeight > DENSITY_LIMITS.lineHeight.min) {
    next.lineHeight = roundTwo(
      Math.max(DENSITY_LIMITS.lineHeight.min, next.lineHeight - DENSITY_LIMITS.lineHeight.step),
    );
    return next;
  }
  if (next.baseFontSize > DENSITY_LIMITS.baseFontSize.min) {
    next.baseFontSize = roundTwo(
      Math.max(DENSITY_LIMITS.baseFontSize.min, next.baseFontSize - DENSITY_LIMITS.baseFontSize.step),
    );
    return syncHeadingSizes(next);
  }

  return null;
}

export interface PageFitResult {
  fitted: boolean;
  alreadyFitted: boolean;
  settings: GlobalSettings;
  stepsTaken: number;
  remainingOverflowPx: number;
  message: string;
}

/**
 * Iteratively tightens resume typography & spacing using a real overflow measurement callback
 * until content fits within a single 297mm A4 sheet or reaches readable floor limits.
 */
export async function fitResumeToSinglePage(
  initialSettings: GlobalSettings,
  applyAndMeasureOverflowPx: (candidate: GlobalSettings) => Promise<number> | number,
  maxIterations = 60,
): Promise<PageFitResult> {
  let current = { ...initialSettings };
  let overflowPx = await applyAndMeasureOverflowPx(current);

  if (overflowPx <= 0) {
    return {
      fitted: true,
      alreadyFitted: true,
      settings: current,
      stepsTaken: 0,
      remainingOverflowPx: 0,
      message: '当前内容已在一页 A4 内，无需压缩。',
    };
  }

  let stepsTaken = 0;
  for (let i = 0; i < maxIterations; i += 1) {
    const candidate = computeNextCompressionStep(current);
    if (!candidate) {
      break;
    }
    current = candidate;
    stepsTaken += 1;
    overflowPx = await applyAndMeasureOverflowPx(current);
    if (overflowPx <= 0) {
      return {
        fitted: true,
        alreadyFitted: false,
        settings: current,
        stepsTaken,
        remainingOverflowPx: 0,
        message: `已通过 ${stepsTaken} 步微调自动压回一页（当前字号 ${current.baseFontSize}px，行高 ${current.lineHeight}）。`,
      };
    }
  }

  return {
    fitted: false,
    alreadyFitted: false,
    settings: current,
    stepsTaken,
    remainingOverflowPx: Math.ceil(overflowPx),
    message: `已降至可读下限（字号 ${current.baseFontSize}px、行高 ${current.lineHeight}），仍超出约 ${Math.ceil(overflowPx)}px，建议隐藏部分条目或精简文案。`,
  };
}
