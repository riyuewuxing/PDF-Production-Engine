import type { ComponentType } from 'react';
import type { ResumeDocument, TemplateId } from '../schema/resumeSchema';

export interface ResumeTemplateProps {
  document: ResumeDocument;
}

export type TemplateCategory =
  | 'commercial'
  | 'vip-wave'
  | 'vip-sidebar'
  | 'vip-banner'
  | 'teacher'
  | 'minimal'
  | 'sidebar'
  | 'academic';

export interface TemplateMetadata {
  id: TemplateId;
  name: string;
  subtitle: string;
  category: TemplateCategory;
  recommendedColor: string;
  tags: string[];
  accentPreview: string;
  layoutKind: 'single' | 'sidebar-left' | 'sidebar-right' | 'banner' | 'timeline' | 'editorial' | 'grid';
  component: ComponentType<ResumeTemplateProps>;
}
