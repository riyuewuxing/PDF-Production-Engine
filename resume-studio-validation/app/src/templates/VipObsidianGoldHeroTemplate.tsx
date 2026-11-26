import type { ResumeTemplateProps } from './types';
import { SolidCenterHeroResumeLayout } from './vipWaveLayouts';

export function VipObsidianGoldHeroTemplate({ document }: ResumeTemplateProps) {
  return (
    <SolidCenterHeroResumeLayout
      document={document}
      defaultColor="#1f2937"
      nativeHeadingStyle="block-tag"
      bottomTrimColor="#d4af37"
    />
  );
}
