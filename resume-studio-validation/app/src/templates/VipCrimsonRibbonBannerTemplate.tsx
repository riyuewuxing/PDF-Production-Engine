import type { ResumeTemplateProps } from './types';
import { SolidCenterHeroResumeLayout } from './vipWaveLayouts';

export function VipCrimsonRibbonBannerTemplate({ document }: ResumeTemplateProps) {
  return (
    <SolidCenterHeroResumeLayout
      document={document}
      defaultColor="#991b1b"
      nativeHeadingStyle="trapezoid-flag"
    />
  );
}
