import React from 'react';
import { formatCjkSpacing } from './cjkSpacing';

const ALLOWED_HTML_TAGS = new Set(['ul', 'ol', 'li', 'p', 'br', 'strong', 'b', 'em', 'i']);
const BLOCK_HTML_REGEX = /<(ul|ol|li|p|br)\b[^>]*>/i;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripDangerousBlocks(input: string): string {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: InlineToken[] }
  | { type: 'italic'; children: InlineToken[] }
  | { type: 'br' };

function parseInlineMarkdown(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    tokens.push({
      type: 'bold',
      children: [{ type: 'text', value: match[1] ?? '' }],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return tokens;
}

function parseSafeInlineHtml(rawHtml: string): InlineToken[] {
  const cleaned = stripDangerousBlocks(rawHtml);
  const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?(\/?)>/g;

  interface Frame {
    tag: string;
    children: InlineToken[];
  }

  const root: InlineToken[] = [];
  const stack: Frame[] = [];

  const pushToken = (token: InlineToken) => {
    const top = stack[stack.length - 1];
    if (top) {
      top.children.push(token);
    } else {
      root.push(token);
    }
  };

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      const segment = decodeHtmlEntities(cleaned.slice(lastIndex, match.index));
      for (const inlineTok of parseInlineMarkdown(segment)) {
        pushToken(inlineTok);
      }
    }

    const isClosing = match[1] === '/';
    const tagName = (match[2] ?? '').toLowerCase();
    const isSelfClosing = match[3] === '/' || tagName === 'br';

    if (ALLOWED_HTML_TAGS.has(tagName)) {
      if (tagName === 'br') {
        pushToken({ type: 'br' });
      } else if (tagName === 'strong' || tagName === 'b' || tagName === 'em' || tagName === 'i') {
        const mappedType = tagName === 'strong' || tagName === 'b' ? 'bold' : 'italic';
        if (!isClosing && !isSelfClosing) {
          stack.push({ tag: mappedType, children: [] });
        } else if (isClosing) {
          const idx = [...stack].reverse().findIndex((f) => f.tag === mappedType);
          if (idx !== -1) {
            const actualIndex = stack.length - 1 - idx;
            while (stack.length > actualIndex) {
              const popped = stack.pop();
              if (popped) {
                pushToken({
                  type: popped.tag === 'bold' ? 'bold' : 'italic',
                  children: popped.children,
                });
              }
            }
          }
        }
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleaned.length) {
    const tail = decodeHtmlEntities(cleaned.slice(lastIndex));
    for (const inlineTok of parseInlineMarkdown(tail)) {
      pushToken(inlineTok);
    }
  }

  while (stack.length > 0) {
    const popped = stack.pop();
    if (popped) {
      pushToken({
        type: popped.tag === 'bold' ? 'bold' : 'italic',
        children: popped.children,
      });
    }
  }

  return root;
}

function renderInlineTokens(
  tokens: InlineToken[],
  keyPrefix: string,
  autoCjkSpacing = false,
): React.ReactNode[] {
  return tokens.map((token, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (token.type === 'text') {
      return (
        <React.Fragment key={key}>
          {autoCjkSpacing ? formatCjkSpacing(token.value) : token.value}
        </React.Fragment>
      );
    }
    if (token.type === 'br') {
      return <br key={key} />;
    }
    if (token.type === 'bold') {
      return (
        <strong key={key} className="font-semibold">
          {renderInlineTokens(token.children, key, autoCjkSpacing)}
        </strong>
      );
    }
    return (
      <em key={key} className="italic">
        {renderInlineTokens(token.children, key, autoCjkSpacing)}
      </em>
    );
  });
}

type BlockNode =
  | { type: 'ul'; items: InlineToken[][] }
  | { type: 'ol'; items: InlineToken[][] }
  | { type: 'p'; content: InlineToken[] };

function parseHtmlBlocks(rawInput: string): BlockNode[] {
  const cleaned = stripDangerousBlocks(rawInput);
  const blocks: BlockNode[] = [];

  // Extract <ul>...</ul>, <ol>...</ol>, <p>...</p>, and standalone <li>...</li>
  const listOrParaRegex = /<(ul|ol|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushPlainFragment = (fragment: string) => {
    const trimmed = fragment.trim();
    if (!trimmed) return;
    // Check for orphan <li>...</li>
    const liMatches = [...trimmed.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
    if (liMatches.length > 0) {
      blocks.push({
        type: 'ul',
        items: liMatches.map((m) => parseSafeInlineHtml(m[1] ?? '')),
      });
      return;
    }
    const markdownBlocks = parseMarkdownBlocks(trimmed);
    blocks.push(...markdownBlocks);
  };

  while ((match = listOrParaRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      pushPlainFragment(cleaned.slice(lastIndex, match.index));
    }

    const tag = (match[1] ?? 'p').toLowerCase();
    const inner = match[2] ?? '';

    if (tag === 'ul' || tag === 'ol') {
      const liMatches = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
      const items =
        liMatches.length > 0
          ? liMatches.map((m) => parseSafeInlineHtml(m[1] ?? ''))
          : inner
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => parseSafeInlineHtml(line));
      if (items.length > 0) {
        blocks.push({ type: tag, items });
      }
    } else {
      const content = parseSafeInlineHtml(inner);
      if (content.length > 0) {
        blocks.push({ type: 'p', content });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleaned.length) {
    pushPlainFragment(cleaned.slice(lastIndex));
  }

  return blocks;
}

function parseMarkdownBlocks(input: string): BlockNode[] {
  const cleaned = stripDangerousBlocks(input);
  const lines = cleaned.split(/\r?\n/);
  const blocks: BlockNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: InlineToken[][] } | null = null;

  const flushList = () => {
    if (currentList && currentList.items.length > 0) {
      blocks.push(currentList);
    }
    currentList = null;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    const ulMatch = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (ulMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(parseSafeInlineHtml(ulMatch[1] ?? ''));
      continue;
    }

    const olMatch = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (olMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(parseSafeInlineHtml(olMatch[1] ?? ''));
      continue;
    }

    flushList();
    blocks.push({ type: 'p', content: parseSafeInlineHtml(trimmed) });
  }

  flushList();
  return blocks;
}

export function parseRichTextBlocks(raw: string): BlockNode[] {
  if (!raw || !raw.trim()) {
    return [];
  }
  if (BLOCK_HTML_REGEX.test(raw)) {
    return parseHtmlBlocks(raw);
  }
  return parseMarkdownBlocks(raw);
}

export interface RichTextProps {
  content: string;
  className?: string;
  paragraphSpacing?: number;
  lineHeight?: number;
  autoCjkSpacing?: boolean;
}

export function RichText({
  content,
  className,
  paragraphSpacing = 4,
  lineHeight,
  autoCjkSpacing = false,
}: RichTextProps) {
  const blocks = parseRichTextBlocks(content);
  if (blocks.length === 0) {
    return null;
  }

  const itemSpacing = Math.max(1, Math.round(paragraphSpacing * 0.35));

  return (
    <div
      className={className}
      style={lineHeight ? { lineHeight } : undefined}
    >
      {blocks.map((block, index) => {
        const marginBottom = index === blocks.length - 1 ? 0 : itemSpacing;
        if (block.type === 'ul') {
          return (
            <ul
              key={index}
              className="list-disc pl-4 space-y-0.5"
              style={{ marginBottom }}
            >
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInlineTokens(item, `ul-${index}-${itemIdx}`, autoCjkSpacing)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol
              key={index}
              className="list-decimal pl-4 space-y-0.5"
              style={{ marginBottom }}
            >
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInlineTokens(item, `ol-${index}-${itemIdx}`, autoCjkSpacing)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index} style={{ marginBottom }}>
            {renderInlineTokens(block.content, `p-${index}`, autoCjkSpacing)}
          </p>
        );
      })}
    </div>
  );
}
