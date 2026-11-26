import type { ResumeTemplateProps } from './types';
import { CenteredWaveResumeLayout } from './vipWaveLayouts';

export function VipCyanArcTrapezoidTemplate({ document }: ResumeTemplateProps) {
  return (
    <CenteredWaveResumeLayout
      document={document}
      defaultColor="#0f766e"
      bannerVariant="layered-curve"
      nativeHeadingStyle="trapezoid-flag"
      waveHeight={84}
      overlapPx={42}
    />
  );
}
