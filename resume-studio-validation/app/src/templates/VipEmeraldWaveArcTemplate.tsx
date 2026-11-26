import type { ResumeTemplateProps } from './types';
import { CenteredWaveResumeLayout } from './vipWaveLayouts';

export function VipEmeraldWaveArcTemplate({ document }: ResumeTemplateProps) {
  return (
    <CenteredWaveResumeLayout
      document={document}
      defaultColor="#115e59"
      bannerVariant="single-arc"
      nativeHeadingStyle="clean"
      waveHeight={84}
      overlapPx={44}
    />
  );
}
