import type { ResumeTemplateProps } from './types';
import { CenteredWaveResumeLayout } from './vipWaveLayouts';

export function VipCrimsonDoubleArcTemplate({ document }: ResumeTemplateProps) {
  return (
    <CenteredWaveResumeLayout
      document={document}
      defaultColor="#a11639"
      bannerVariant="layered-curve"
      nativeHeadingStyle="dot-accent"
      waveHeight={86}
      overlapPx={42}
    />
  );
}
