import type { ResumeTemplateProps } from './types';
import { SolidCenterHeroResumeLayout } from './vipWaveLayouts';

export function VipBurgundyCenterHeroTemplate({ document }: ResumeTemplateProps) {
  return (
    <SolidCenterHeroResumeLayout
      document={document}
      defaultColor="#9f1239"
      nativeHeadingStyle="left-bar"
    />
  );
}
