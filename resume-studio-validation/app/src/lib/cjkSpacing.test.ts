import { describe, expect, it } from 'vitest';
import { formatCjkSpacing } from './cjkSpacing';

describe('cjkSpacing', () => {
  it('inserts spaces between CJK characters and English letters or numbers', () => {
    expect(formatCjkSpacing('熟练掌握Python与React19开发')).toBe('熟练掌握 Python 与 React19 开发');
    expect(formatCjkSpacing('开发了AI赋能高中物理可视化课件')).toBe('开发了 AI 赋能高中物理可视化课件');
    expect(formatCjkSpacing('指导20名学生获3项奖学金')).toBe('指导 20 名学生获 3 项奖学金');
  });

  it('preserves emails, URLs, Chinese dates like 2025年09月, and physics inequalities', () => {
    expect(formatCjkSpacing('联系邮箱demo@example.invalid与官网https://github.com/test/repo')).toBe(
      '联系邮箱 demo@example.invalid 与官网 https://github.com/test/repo',
    );
    expect(formatCjkSpacing('2025年09月进入示例大学攻读E<10MeV能区课题')).toBe(
      '2025年09月进入示例大学攻读 E<10MeV 能区课题',
    );
    expect(formatCjkSpacing('研究E < 10 MeV截面及2022年06月毕业')).toBe(
      '研究 E < 10 MeV 截面及2022年06月毕业',
    );
  });
});
