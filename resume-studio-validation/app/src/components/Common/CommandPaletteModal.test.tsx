import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TEMPLATE_REGISTRY } from '../../templates/registry';
import { CommandPaletteModal } from './CommandPaletteModal';

function makeProps(overrides: Partial<React.ComponentProps<typeof CommandPaletteModal>> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    activeTab: 'edit' as const,
    activeSlug: 'synthetic-teacher',
    activeTemplateId: 'vip-sky-notch-hero' as const,
    activeLocale: 'zh-CN' as const,
    isRedacted: false,
    summaries: [
      {
        slug: 'synthetic-teacher',
        id: 'id-1',
        title: '合成教师岗位',
        templateId: 'vip-sky-notch-hero' as const,
        updatedAt: '2026-11-21T00:00:00.000Z',
        isMaster: false,
      },
    ],
    masterSummary: {
      slug: 'master',
      id: 'id-m',
      title: '母库总简历',
      templateId: 'minimal-ats' as const,
      updatedAt: '2026-11-21T00:00:00.000Z',
      isMaster: true,
    },
    onSelectTab: vi.fn(),
    onSwitchVersion: vi.fn(),
    onSelectTemplate: vi.fn(),
    onExportFormat: vi.fn(),
    onFitOnePage: vi.fn(),
    onToggleRedacted: vi.fn(),
    onToggleLocale: vi.fn(),
    ...overrides,
  };
}

describe('CommandPaletteModal', () => {
  it('filters all 51 templates by multi-token search and switches template on click/Enter', () => {
    const props = makeProps();
    render(<CommandPaletteModal {...props} />);

    const input = screen.getByLabelText('搜索命令、模板与版本');
    fireEvent.change(input, { target: { value: 'lapis 青金石' } });

    expect(screen.getByText(/LapisCV 青金石单栏/)).toBeInTheDocument();
    expect(TEMPLATE_REGISTRY.length).toBe(51);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSelectTemplate).toHaveBeenCalledWith('lapis-clean', '#2b547e');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter during IME composition and supports ArrowDown/ArrowUp + Escape', () => {
    const props = makeProps();
    render(<CommandPaletteModal {...props} />);
    const input = screen.getByLabelText('搜索命令、模板与版本');

    // Simulate IME composition Enter (isComposing: true)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(props.onSelectTab).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    // Move down to templates tab and execute
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSelectTab).toHaveBeenCalledWith('templates');
    expect(props.onClose).toHaveBeenCalledTimes(1);

    // Escape closes
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
