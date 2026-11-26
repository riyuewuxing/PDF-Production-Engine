/**
 * PDF 文本布局纯函数引擎。
 *
 * 设计约束：本文件**不得**引入 `pdfjs-dist` 或任何浏览器/Electron 运行时依赖，
 * 以保证 `atsInspector` 单测可在 Node/jsdom 下秒级运行。
 * 所有输入均为已抽取好的纯数据 token。
 */

export interface PdfTextToken {
  str: string;
  x: number;
  y: number;
  width: number;
  /** 可选：pdfjs 提供的字形高度，用于姓名候选加权 */
  height?: number;
  /** 可选：pdfjs 提供的字体名，用于排查自定义字体乱码 */
  fontName?: string;
  /** 可选：所属页序号（0 起） */
  pageIndex?: number;
}

export interface ExtractedPdfPageTokens {
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  tokens: PdfTextToken[];
}

export interface RowBucket {
  /** 该行首个 token 的基线 y */
  y: number;
  tokens: PdfTextToken[];
}

/** 同一行的 y 容差（pt） */
export const ROW_Y_TOLERANCE = 3.5;
/** 双栏空白沟的最小宽度（pt） */
export const MIN_COLUMN_GUTTER_WIDTH = 14;
/** 判定双栏时每一栏所需的最少 token 数 */
export const MIN_COLUMN_TOKENS_PER_SIDE = 6;
/** 判定双栏时跨沟行所需的最少行数 */
export const MIN_COLUMN_SHARED_ROWS = 4;
/** 双栏沟扫描区间（占页宽比例）。右侧栏模板的沟常落在 60%–72%，故下限放宽到 15% */
export const COLUMN_SCAN_MIN_RATIO = 0.15;
export const COLUMN_SCAN_MAX_RATIO = 0.75;
/** 判定双栏时，跨沟行必须覆盖的最小页高比例（排除页眉/页脚几行孤立对齐） */
export const MIN_COLUMN_Y_SPREAD_RATIO = 0.15;
/**
 * 判定双栏时，右栏首个 token 左端允许的最大横向离散度（占页宽比例）。
 * 真正的栏内容左端严格对齐；单栏右对齐日期则是「右端」对齐、左端浮动。
 */
export const MAX_COLUMN_START_SPREAD_RATIO = 0.06;
/** ATS 交错拼接判定所需的横向空白沟宽度（pt） */
export const INTERLEAVE_GAP_THRESHOLD = 42;

function tokenSpanEnd(token: PdfTextToken): number {
  return token.x + Math.max(0, token.width);
}

function tokenCenter(token: PdfTextToken): number {
  return token.x + Math.max(0, token.width) / 2;
}

function hasVisibleText(token: PdfTextToken): boolean {
  return token.str.replace(/\s+/g, '').length > 0;
}

/**
 * 按 y 容差聚类成行：整体自上而下（y 降序），行内自左而右（x 升序）。
 */
export function groupTokensIntoRows(
  tokens: readonly PdfTextToken[],
  yTolerance: number = ROW_Y_TOLERANCE,
): RowBucket[] {
  const nonEmpty = tokens.filter(hasVisibleText);
  if (nonEmpty.length === 0) return [];

  const sorted = [...nonEmpty].sort((a, b) => {
    if (Math.abs(a.y - b.y) > yTolerance) return b.y - a.y;
    return a.x - b.x;
  });

  const rows: RowBucket[] = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (!last || Math.abs(last.y - item.y) > yTolerance) {
      rows.push({ y: item.y, tokens: [item] });
    } else {
      last.tokens.push(item);
    }
  }
  for (const row of rows) {
    row.tokens.sort((a, b) => a.x - b.x);
  }
  return rows;
}

/** 将一行 token 拼成可读文本（间隔超过 2.5pt 补一个空格）。 */
export function rowToLine(tokens: readonly PdfTextToken[]): string {
  let lineText = '';
  let prevEndX = -Infinity;
  for (const seg of tokens) {
    const cleanStr = seg.str.trim();
    if (!cleanStr) continue;
    if (lineText && seg.x - prevEndX > 2.5) {
      lineText += ' ';
    }
    lineText += cleanStr;
    prevEndX = Math.max(prevEndX, tokenSpanEnd(seg));
  }
  return lineText.trim();
}

/**
 * 朴素重建：不感知栏结构，按行聚类直接自上而下拼接。
 * 这等价于大多数 ATS 解析器看到的原始文本流。
 */
export function reconstructLinesFromTextItems(tokens: readonly PdfTextToken[]): string[] {
  return groupTokensIntoRows(tokens)
    .map((row) => rowToLine(row.tokens))
    .filter(Boolean);
}

export interface DetectedColumnLayout {
  gutterCenter: number;
  gutterStart: number;
  gutterEnd: number;
  sharedRowCount: number;
  headerCut: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * 判定单页是否为双栏版式，并给出空白沟位置。
 *
 * 算法：X 轴候选沟位扫描（15%–75% 页宽），兼容稀疏左栏（如 GPA/标题短行导致行内最大空白左偏）
 * 以及左右栏行高/字号不同步导致的错行双栏（如 `wondercv-teal-sidebar`）。
 *
 * 判据：
 * 1. 对候选沟中心 `gx`，除可选顶部跨栏页眉之外，正文区 `[gx - 7, gx + 7]` 内不得被任何文字跨越；
 * 2. 沟两侧在垂直重叠区域 `[overlapMinY, overlapMaxY]` 内各自至少 6 个 token，且纵向重叠跨度 ≥ 页高 15%；
 * 3. 右侧栏在垂直重叠区内至少有 4 个视觉行，且呈现左对齐栏特征（行首离散度可控、行尾横向错落 ≥ 24pt），
 *    从而可靠排除单栏「正文 + 右对齐日期」与纯右侧日期列误判；
 * 4. 在连续通过校验的候选 `gx` 中取最宽空白平台中心作为最终 `gutterCenter`。
 */
export function detectColumnLayout(page: ExtractedPdfPageTokens): DetectedColumnLayout | null {
  const { tokens, pageWidth, pageHeight } = page;
  const visibleTokens = tokens.filter(hasVisibleText);
  if (visibleTokens.length < MIN_COLUMN_TOKENS_PER_SIDE * 2 || pageWidth <= 0 || pageHeight <= 0) {
    return null;
  }

  const scanMin = pageWidth * COLUMN_SCAN_MIN_RATIO;
  const scanMax = pageWidth * COLUMN_SCAN_MAX_RATIO;
  const halfGutter = MIN_COLUMN_GUTTER_WIDTH / 2;
  const minOverlapSpan = pageHeight * MIN_COLUMN_Y_SPREAD_RATIO;
  const validGx: number[] = [];

  for (let gx = scanMin; gx <= scanMax; gx += 2) {
    const gutterLeft = gx - halfGutter;
    const gutterRight = gx + halfGutter;
    const crossing: PdfTextToken[] = [];
    const leftAll: PdfTextToken[] = [];
    const rightAll: PdfTextToken[] = [];

    for (const token of visibleTokens) {
      const x1 = tokenSpanEnd(token);
      if (token.x < gutterRight && x1 > gutterLeft) {
        crossing.push(token);
      } else if (x1 <= gutterLeft) {
        leftAll.push(token);
      } else {
        rightAll.push(token);
      }
    }

    const headerCut =
      crossing.length > 0
        ? Math.min(...crossing.map((token) => token.y)) - ROW_Y_TOLERANCE
        : Infinity;

    const leftBelow = leftAll.filter((token) => token.y <= headerCut);
    const rightBelow = rightAll.filter((token) => token.y <= headerCut);
    if (
      leftBelow.length < MIN_COLUMN_TOKENS_PER_SIDE ||
      rightBelow.length < MIN_COLUMN_TOKENS_PER_SIDE
    ) {
      continue;
    }

    const leftMinY = Math.min(...leftBelow.map((t) => t.y));
    const leftMaxY = Math.max(...leftBelow.map((t) => t.y));
    const rightMinY = Math.min(...rightBelow.map((t) => t.y));
    const rightMaxY = Math.max(...rightBelow.map((t) => t.y));
    const overlapMinY = Math.max(leftMinY, rightMinY);
    const overlapMaxY = Math.min(leftMaxY, rightMaxY);
    if (!Number.isFinite(overlapMaxY - overlapMinY) || overlapMaxY - overlapMinY < minOverlapSpan) {
      continue;
    }

    const bandMinY = overlapMinY - ROW_Y_TOLERANCE;
    const bandMaxY = overlapMaxY + ROW_Y_TOLERANCE;
    const leftInBand = leftBelow.filter((t) => t.y >= bandMinY && t.y <= bandMaxY);
    const rightInBand = rightBelow.filter((t) => t.y >= bandMinY && t.y <= bandMaxY);
    if (leftInBand.length < 3 || rightInBand.length < 3) {
      continue;
    }

    const rightRows = groupTokensIntoRows(rightBelow);
    if (rightRows.length < MIN_COLUMN_SHARED_ROWS) continue;

    // 排除单栏右对齐日期：真实栏左对齐起笔紧凑（允许图标/居中姓名少量离散），且行尾不呈现统一靠右日期特征
    const starts = rightRows.map((row) => row.tokens[0]?.x ?? 0);
    const ends = rightRows.map((row) => {
      const last = row.tokens[row.tokens.length - 1];
      return last ? tokenSpanEnd(last) : 0;
    });
    const medStart = median(starts);
    const alignedStartCount = starts.filter(
      (s) => s >= medStart - 16 && s <= medStart + 32,
    ).length;
    const startAlignRatio = alignedStartCount / rightRows.length;
    const endSpread = Math.max(...ends) - Math.min(...ends);
    const sortedStarts = [...starts].sort((a, b) => a - b);
    const p10 = sortedStarts[Math.floor(sortedStarts.length * 0.1)] ?? 0;
    const p90 = sortedStarts[Math.min(sortedStarts.length - 1, Math.ceil(sortedStarts.length * 0.9) - 1)] ?? 0;
    const trimmedStartSpread = p90 - p10;

    if (trimmedStartSpread > pageWidth * MAX_COLUMN_START_SPREAD_RATIO) continue;
    if (startAlignRatio < 0.65 || trimmedStartSpread > endSpread) continue;
    if (
      endSpread < 16 &&
      rightRows.every((row) => /(\d{4}[./年-]\d{1,2}|至今)/.test(rowToLine(row.tokens)))
    ) {
      continue;
    }

    validGx.push(gx);
  }

  if (validGx.length === 0) return null;

  const plateaus: number[][] = [];
  for (const gx of validGx) {
    const last = plateaus[plateaus.length - 1];
    const prev = last?.[last.length - 1];
    if (!last || prev === undefined || gx - prev > 4) {
      plateaus.push([gx]);
    } else {
      last.push(gx);
    }
  }

  let bestPlateau: number[] = [];
  for (const plateau of plateaus) {
    if (plateau.length > bestPlateau.length) bestPlateau = plateau;
  }
  const gutterCenter = median(bestPlateau);
  const finalLeftEdge = gutterCenter - halfGutter;
  const finalRightEdge = gutterCenter + halfGutter;
  const finalCrossing = visibleTokens.filter(
    (token) => token.x < finalRightEdge && tokenSpanEnd(token) > finalLeftEdge,
  );
  const headerCut =
    finalCrossing.length > 0
      ? Math.min(...finalCrossing.map((token) => token.y)) - ROW_Y_TOLERANCE
      : Infinity;

  const sharedRowCount = groupTokensIntoRows(visibleTokens).filter(
    (row) =>
      row.tokens.some((t) => tokenSpanEnd(t) <= gutterCenter) &&
      row.tokens.some((t) => t.x >= gutterCenter),
  ).length;

  return {
    gutterCenter,
    gutterStart: finalLeftEdge,
    gutterEnd: finalRightEdge,
    sharedRowCount,
    headerCut,
  };
}

function collectColumnAwareRows(page: ExtractedPdfPageTokens): RowBucket[] {
  const layout = detectColumnLayout(page);
  if (!layout) return groupTokensIntoRows(page.tokens);

  const headerTokens: PdfTextToken[] = [];
  const inLeft: PdfTextToken[] = [];
  const inRight: PdfTextToken[] = [];

  for (const token of page.tokens) {
    if (!hasVisibleText(token)) continue;
    if (Number.isFinite(layout.headerCut) && token.y > layout.headerCut) {
      headerTokens.push(token);
    } else if (tokenCenter(token) < layout.gutterCenter) {
      inLeft.push(token);
    } else {
      inRight.push(token);
    }
  }

  return [
    ...groupTokensIntoRows(headerTokens),
    ...groupTokensIntoRows(inLeft),
    ...groupTokensIntoRows(inRight),
  ];
}

/**
 * 单页双栏感知重建：顶部跨栏页眉先输出，随后完整输出左栏（Y 降序），再完整输出右栏。
 * 非双栏页退化为朴素重建。
 */
export function reconstructPageLinesColumnAware(page: ExtractedPdfPageTokens): string[] {
  return collectColumnAwareRows(page)
    .map((row) => rowToLine(row.tokens))
    .filter(Boolean);
}

/** 逐页双栏感知重建并携带每行最大字高（pt），供 PDF 导入姓名字号加权复用。 */
export function reconstructLinesWithHeights(
  pages: readonly ExtractedPdfPageTokens[],
): { lines: string[]; lineHeights: Record<string, number> } {
  const lines: string[] = [];
  const lineHeights: Record<string, number> = {};

  for (const page of pages) {
    for (const row of collectColumnAwareRows(page)) {
      const line = rowToLine(row.tokens);
      if (!line) continue;
      lines.push(line);
      const rowHeight = Math.max(...row.tokens.map((t) => t.height ?? 0));
      if (rowHeight > 0) {
        const key = line.replace(/\s+/g, '');
        lineHeights[key] = Math.max(lineHeights[key] ?? 0, rowHeight);
      }
    }
  }

  return { lines, lineHeights };
}

/** 逐页双栏感知重建，页间顺序保留。 */
export function reconstructLinesWithColumnAwareness(
  pages: readonly ExtractedPdfPageTokens[],
): string[] {
  const lines: string[] = [];
  for (const page of pages) {
    lines.push(...reconstructPageLinesColumnAware(page));
  }
  return lines;
}

export interface ColumnLayoutSummary {
  hasColumns: boolean;
  columnPageCount: number;
  pageCount: number;
}

/** 汇总多页版式判定结果。 */
export function summarizeColumnLayout(
  pages: readonly ExtractedPdfPageTokens[],
): ColumnLayoutSummary {
  let columnPageCount = 0;
  for (const page of pages) {
    if (detectColumnLayout(page)) columnPageCount += 1;
  }
  return {
    hasColumns: columnPageCount > 0,
    columnPageCount,
    pageCount: pages.length,
  };
}

/**
 * 统计「原始顺序下跨栏首尾拼接」的行数。
 *
 * 这是双栏简历被 ATS 机读时最典型的串行症状：左右两栏文字在同一行被首尾相连。
 * **只有页面被判定为双栏时才计数** —— 单栏的「标题 + 右对齐日期」只是对齐留白，
 * 不构成跨栏串行，不能误报。
 */
export function countInterleavedLines(
  pages: readonly ExtractedPdfPageTokens[],
  minGap: number = INTERLEAVE_GAP_THRESHOLD,
): number {
  let count = 0;
  for (const page of pages) {
    const layout = detectColumnLayout(page);
    if (!layout) continue;
    const gutterMin = layout.gutterStart - 8;
    const gutterMax = layout.gutterEnd + 8;

    for (const row of groupTokensIntoRows(page.tokens)) {
      for (let i = 1; i < row.tokens.length; i += 1) {
        const prev = row.tokens[i - 1];
        const curr = row.tokens[i];
        if (!prev || !curr) continue;
        const gapStart = tokenSpanEnd(prev);
        const gapEnd = curr.x;
        if (gapEnd - gapStart < minGap) continue;
        const mid = (gapStart + gapEnd) / 2;
        if (mid >= gutterMin && mid <= gutterMax) {
          count += 1;
          break;
        }
      }
    }
  }
  return count;
}
