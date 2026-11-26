import type { ResumeTemplateProps } from './types';
import { CenteredWaveResumeLayout } from './vipWaveLayouts';

export function VipRoyalDoubleWaveTemplate({ document }: ResumeTemplateProps) {
  return (
    <CenteredWaveResumeLayout
      document={document}
      defaultColor="#1d4ed8"
      bannerVariant="double-wave"
      nativeHeadingStyle="pill"
      waveHeight={88}
      overlapPx={44}
    />
  );
}
