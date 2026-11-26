import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText } from './richText';

describe('RichText safe renderer', () => {
  it('renders markdown bullet lists and bold text cleanly', () => {
    const content = '- **可视化仿真课件开发**：支持参数实时调节\n- 自动化备课工作流\n补充说明 **重点**';
    const { container } = render(<RichText content={content} />);

    const listItems = container.querySelectorAll('li');
    expect(listItems).toHaveLength(2);
    expect(screen.getByText('可视化仿真课件开发').tagName).toBe('STRONG');
    expect(screen.getByText('重点').tagName).toBe('STRONG');
    expect(container.textContent).toContain('支持参数实时调节');
  });

  it('renders legacy <ul><li> HTML from Magic Resume without dangerouslySetInnerHTML', () => {
    const legacyHtml =
      '<ul><li>联合培养：<strong>示例科研机构</strong>联合培养（2年）。</li><li>专业课程：量子场论。</li></ul>';
    const { container } = render(<RichText content={legacyHtml} />);

    const listItems = container.querySelectorAll('li');
    expect(listItems).toHaveLength(2);
    expect(screen.getByText('示例科研机构').tagName).toBe('STRONG');
    expect(container.textContent).toContain('专业课程：量子场论。');
  });

  it('neutralizes XSS payloads and keeps literal physics inequalities safe', () => {
    const xssContent =
      '<script>window.__pwned=true</script><img src="x" onerror="alert(1)" />- 能量 E < 10 MeV 且 **p > 2**';
    const { container } = render(<RichText content={xssContent} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).not.toContain('__pwned');
    expect(container.textContent).toContain('能量 E < 10 MeV');
    expect(screen.getByText('p > 2').tagName).toBe('STRONG');
  });
});
