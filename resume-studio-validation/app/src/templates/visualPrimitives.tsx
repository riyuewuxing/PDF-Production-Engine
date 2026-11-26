import React, { useId } from 'react';
import { resolveAssetUrl } from '../lib/apiClient';
import type { GlobalSettings, ResumeDocument } from '../schema/resumeSchema';
import { darkenHex, getContrastTextColor, hasVisiblePhoto, mixWithWhite } from './shared';

export type SvgBannerVariant =
  | 'single-arc'
  | 'double-wave'
  | 'layered-curve'
  | 'slant-polygon'
  | 'corner-wedge'
  | 'cyber-glow';

interface SvgWaveBannerProps {
  variant: SvgBannerVariant;
  themeColor: string;
  surfaceStyle?: GlobalSettings['surfaceStyle'];
  minHeight?: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export function SvgWaveBanner({
  variant,
  themeColor,
  surfaceStyle = 'solid',
  minHeight = 132,
  className = '',
  style,
  children,
}: SvgWaveBannerProps) {
  const gradId = useId().replace(/:/g, '');
  const isTint = surfaceStyle === 'tint';
  const isOutline = surfaceStyle === 'outline';
  const isGradient = surfaceStyle === 'gradient' || variant === 'cyber-glow';

  const primaryFill = isOutline
    ? '#ffffff'
    : isTint
      ? mixWithWhite(themeColor, 0.85)
      : themeColor;
  const secondaryFill = isOutline
    ? mixWithWhite(themeColor, 0.88)
    : isTint
      ? mixWithWhite(themeColor, 0.7)
      : darkenHex(themeColor, 0.25);
  const textColor =
    variant === 'cyber-glow'
      ? '#f8fafc'
      : isTint || isOutline
        ? '#0f172a'
        : getContrastTextColor(themeColor);

  const svgFill = isGradient ? `url(#${gradId})` : primaryFill;

  if (variant === 'corner-wedge') {
    return (
      <div
        className={`relative overflow-hidden ${className}`}
        style={{ minHeight: `${minHeight}px`, ...style }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 1000 220"
          preserveAspectRatio="none"
          className="pointer-events-none absolute top-0 right-0 z-0 h-full w-[58%]"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={primaryFill} />
              <stop offset="100%" stopColor={secondaryFill} />
            </linearGradient>
          </defs>
          <polygon points="360,0 1000,0 1000,200" fill={secondaryFill} opacity={0.28} />
          <polygon
            points="460,0 1000,0 1000,170"
            fill={svgFill}
            stroke={isOutline ? themeColor : 'none'}
            strokeWidth={isOutline ? 2 : 0}
          />
        </svg>
        <div className="relative z-10">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        minHeight: `${minHeight}px`,
        color: textColor,
        ...style,
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 1000 180"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={variant === 'cyber-glow' ? '#0f172a' : primaryFill} />
            <stop offset="55%" stopColor={themeColor} />
            <stop offset="100%" stopColor={variant === 'cyber-glow' ? '#06b6d4' : secondaryFill} />
          </linearGradient>
        </defs>

        {variant === 'single-arc' && (
          <>
            <path d="M0,0 L1000,0 L1000,136 Q500,192 0,136 Z" fill={secondaryFill} opacity={0.24} />
            <path
              d="M0,0 L1000,0 L1000,126 Q500,180 0,126 Z"
              fill={svgFill}
              stroke={isOutline ? themeColor : 'none'}
              strokeWidth={isOutline ? 2 : 0}
            />
          </>
        )}

        {variant === 'double-wave' && (
          <>
            <path
              d="M0,0 L1000,0 L1000,148 Q740,178 490,138 T0,158 Z"
              fill={secondaryFill}
              opacity={0.35}
            />
            <path
              d="M0,0 L1000,0 L1000,120 Q720,172 470,122 T0,142 Z"
              fill={svgFill}
              stroke={isOutline ? themeColor : 'none'}
              strokeWidth={isOutline ? 2 : 0}
            />
          </>
        )}

        {variant === 'layered-curve' && (
          <>
            <path
              d="M0,0 L1000,0 L1000,146 Q680,104 360,152 Q160,178 0,138 Z"
              fill={secondaryFill}
              opacity={0.32}
            />
            <path
              d="M0,0 L1000,0 L1000,118 Q640,182 290,120 Q120,90 0,134 Z"
              fill={svgFill}
              stroke={isOutline ? themeColor : 'none'}
              strokeWidth={isOutline ? 2 : 0}
            />
          </>
        )}

        {variant === 'slant-polygon' && (
          <>
            <polygon points="0,0 1000,0 1000,150 0,178" fill={secondaryFill} opacity={0.28} />
            <polygon
              points="0,0 1000,0 1000,126 0,168"
              fill={svgFill}
              stroke={isOutline ? themeColor : 'none'}
              strokeWidth={isOutline ? 2 : 0}
            />
          </>
        )}

        {variant === 'cyber-glow' && (
          <>
            <rect width="1000" height="180" fill={`url(#${gradId})`} />
            <circle cx="880" cy="36" r="145" fill="#22d3ee" opacity={0.16} />
            <circle cx="140" cy="140" r="110" fill={themeColor} opacity={0.28} />
            <polygon points="0,164 1000,132 1000,180 0,180" fill="#0b1220" opacity={0.96} />
            <line x1="0" y1="164" x2="1000" y2="132" stroke="#38bdf8" strokeWidth="1.5" opacity={0.65} />
          </>
        )}
      </svg>

      <div className="relative z-10">{children}</div>
    </div>
  );
}

interface FloatingAvatarProps {
  doc: ResumeDocument;
  shape?: 'circle' | 'rect';
  size?: number;
  width?: number;
  height?: number;
  overlapTopPx?: number;
  frame?: 'none' | 'white-ring' | 'card-border';
  className?: string;
}

export function FloatingAvatar({
  doc,
  shape = 'rect',
  size = 92,
  width,
  height,
  overlapTopPx = 0,
  frame = 'white-ring',
  className = '',
}: FloatingAvatarProps) {
  if (!hasVisiblePhoto(doc)) return null;

  const photoCfg = doc.basic.photoConfig;
  const resolvedFrame = photoCfg.frameStyle !== 'none' ? photoCfg.frameStyle : frame;
  const resolvedWidth = shape === 'circle' ? size : (width ?? photoCfg.width);
  const resolvedHeight = shape === 'circle' ? size : (height ?? photoCfg.height);
  const radius = shape === 'circle' ? '9999px' : resolvedFrame === 'card-border' ? '4px' : '2px';

  const frameClass =
    resolvedFrame === 'white-ring'
      ? 'ring-4 ring-white shadow-md'
      : resolvedFrame === 'card-border'
        ? 'border-2 border-white bg-white p-0.5 shadow-sm'
        : 'border border-slate-200';

  return (
    <div
      className={`relative z-20 inline-flex shrink-0 items-center justify-center overflow-hidden ${frameClass} ${className}`}
      style={{
        width: `${resolvedWidth}px`,
        height: `${resolvedHeight}px`,
        borderRadius: radius,
        backgroundColor: photoCfg.bgBackdrop || '#ffffff',
        marginTop: overlapTopPx > 0 ? `-${overlapTopPx}px` : undefined,
      }}
    >
      <img
        src={resolveAssetUrl(doc.basic.photo)}
        alt={doc.basic.name || '证件照'}
        className="h-full w-full object-cover"
        style={{
          borderRadius: resolvedFrame === 'card-border' ? '2px' : radius,
        }}
      />
    </div>
  );
}

export function DarkSheetWrapper({
  bgColor = '#0b1220',
  fontStyle,
  className = '',
  children,
}: {
  bgColor?: string;
  fontStyle?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative min-h-[296mm] text-slate-100 ${className}`}
      style={{
        ...fontStyle,
        backgroundColor: bgColor,
      }}
    >
      {/* Print-only full-page dark backdrop across Page 1..N */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 hidden print:block"
        style={{ backgroundColor: bgColor }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
