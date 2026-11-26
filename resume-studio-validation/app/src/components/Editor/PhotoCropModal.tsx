import { Check, RotateCcw, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { PhotoConfig } from '../../schema/resumeSchema';

export type CropPresetId = '3:4' | '1:1' | 'circle';

export interface CropOutputPayload {
  dataUrl: string;
  fileName: string;
  aspectRatio: string;
  borderRadius: PhotoConfig['borderRadius'];
  width: number;
  height: number;
  bgBackdrop: string;
  frameStyle: PhotoConfig['frameStyle'];
}

export function computeCropDrawRect(params: {
  naturalWidth: number;
  naturalHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}): { dx: number; dy: number; dw: number; dh: number } {
  const { naturalWidth, naturalHeight, canvasWidth, canvasHeight, zoom, offsetX, offsetY } = params;
  const safeNatW = Math.max(1, naturalWidth);
  const safeNatH = Math.max(1, naturalHeight);
  const baseScale = Math.max(canvasWidth / safeNatW, canvasHeight / safeNatH);
  const dw = safeNatW * baseScale * zoom;
  const dh = safeNatH * baseScale * zoom;
  const dx = (canvasWidth - dw) / 2 + offsetX;
  const dy = (canvasHeight - dh) / 2 + offsetY;
  return { dx, dy, dw, dh };
}

const BACKDROP_SWATCHES = [
  { hex: '', label: '透明' },
  { hex: '#2563eb', label: '证件蓝' },
  { hex: '#ffffff', label: '纯白' },
  { hex: '#dc2626', label: '证件红' },
  { hex: '#e2e8f0', label: '商务灰' },
];

const FRAME_STYLES: Array<{ id: PhotoConfig['frameStyle']; label: string }> = [
  { id: 'none', label: '无额外边框' },
  { id: 'white-ring', label: '白环投影' },
  { id: 'card-border', label: '精装相框' },
];

export function PhotoCropModal({
  isOpen,
  initialSrc,
  initialPhotoConfig,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  initialSrc: string;
  initialPhotoConfig: PhotoConfig;
  onCancel: () => void;
  onConfirm: (result: CropOutputPayload) => Promise<void>;
}) {
  const [srcUrl, setSrcUrl] = useState(initialSrc);
  const [preset, setPreset] = useState<CropPresetId>(() => {
    if (initialPhotoConfig.borderRadius === 'full') return 'circle';
    if (initialPhotoConfig.aspectRatio === '1:1') return '1:1';
    return '3:4';
  });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [bgBackdrop, setBgBackdrop] = useState(initialPhotoConfig.bgBackdrop || '#2563eb');
  const [frameStyle, setFrameStyle] = useState<PhotoConfig['frameStyle']>(
    initialPhotoConfig.frameStyle || 'none',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const draggingRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });
  const filePickRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSrcUrl(initialSrc);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setBgBackdrop(initialPhotoConfig.bgBackdrop || '');
    setFrameStyle(initialPhotoConfig.frameStyle || 'none');
    setError(null);
  }, [initialPhotoConfig.bgBackdrop, initialPhotoConfig.frameStyle, initialSrc, isOpen]);

  const targetCanvasSize =
    preset === '3:4' ? { width: 240, height: 320 } : { width: 260, height: 260 };

  useEffect(() => {
    if (!isOpen || !srcUrl) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (bgBackdrop) {
        ctx.fillStyle = bgBackdrop;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const rect = computeCropDrawRect({
        naturalWidth: img.naturalWidth || 300,
        naturalHeight: img.naturalHeight || 400,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        zoom,
        offsetX: offset.x,
        offsetY: offset.y,
      });
      ctx.drawImage(img, rect.dx, rect.dy, rect.dw, rect.dh);
    };
    img.onerror = () => {
      if (!cancelled) setError('无法读取图片内容，请更换 PNG/JPG/WebP 文件');
    };
    img.src = srcUrl;
    return () => {
      cancelled = true;
    };
  }, [bgBackdrop, isOpen, offset.x, offset.y, preset, srcUrl, zoom]);

  // Redraw synchronously when sliders move and image is cached
  useEffect(() => {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!isOpen || !img || !canvas || !img.complete) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgBackdrop) {
      ctx.fillStyle = bgBackdrop;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const rect = computeCropDrawRect({
      naturalWidth: img.naturalWidth || 300,
      naturalHeight: img.naturalHeight || 400,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      zoom,
      offsetX: offset.x,
      offsetY: offset.y,
    });
    ctx.drawImage(img, rect.dx, rect.dy, rect.dw, rect.dh);
  }, [bgBackdrop, isOpen, offset.x, offset.y, preset, zoom]);

  if (!isOpen) return null;

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSrcUrl(reader.result);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const outW = preset === '3:4' ? 360 : 360;
      const outH = preset === '3:4' ? 480 : 360;
      let exportedUrl = srcUrl;

      const img = imageRef.current;
      const offscreen = document.createElement('canvas');
      offscreen.width = outW;
      offscreen.height = outH;
      const ctx = offscreen.getContext('2d');
      if (ctx && img && img.complete && img.naturalWidth > 0) {
        if (bgBackdrop) {
          ctx.fillStyle = bgBackdrop;
          ctx.fillRect(0, 0, outW, outH);
        }
        const scaleFactorX = outW / targetCanvasSize.width;
        const scaleFactorY = outH / targetCanvasSize.height;
        const rect = computeCropDrawRect({
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          canvasWidth: outW,
          canvasHeight: outH,
          zoom,
          offsetX: offset.x * scaleFactorX,
          offsetY: offset.y * scaleFactorY,
        });
        ctx.drawImage(img, rect.dx, rect.dy, rect.dw, rect.dh);
        exportedUrl = offscreen.toDataURL('image/png');
      }

      await onConfirm({
        dataUrl: exportedUrl,
        fileName: `portrait-${Date.now()}.png`,
        aspectRatio: preset === '3:4' ? '3:4' : '1:1',
        borderRadius: preset === 'circle' ? 'full' : preset === '1:1' ? 'md' : 'sm',
        width: preset === '3:4' ? 88 : 96,
        height: preset === '3:4' ? 116 : 96,
        bgBackdrop,
        frameStyle,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '裁剪导出失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="证件照裁剪与底色工作台"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-700 bg-white text-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">证件照裁剪与底色工作台</h2>
            <p className="text-[11px] text-slate-500">画布内可按住拖动位置，滚轮或滑块缩放</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭证件照裁剪弹窗"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4 text-xs">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              {error}
            </div>
          )}

          {/* Interactive Canvas Stage */}
          <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-slate-100 p-4">
            <canvas
              ref={canvasRef}
              width={targetCanvasSize.width}
              height={targetCanvasSize.height}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                draggingRef.current = {
                  active: true,
                  startX: e.clientX,
                  startY: e.clientY,
                  baseX: offset.x,
                  baseY: offset.y,
                };
              }}
              onPointerMove={(e) => {
                if (!draggingRef.current.active) return;
                setOffset({
                  x: draggingRef.current.baseX + (e.clientX - draggingRef.current.startX),
                  y: draggingRef.current.baseY + (e.clientY - draggingRef.current.startY),
                });
              }}
              onPointerUp={() => {
                draggingRef.current.active = false;
              }}
              onWheel={(e) => {
                e.preventDefault();
                setZoom((z) => Math.min(3, Math.max(0.6, Number((z - e.deltaY * 0.001).toFixed(2)))));
              }}
              className={`cursor-grab active:cursor-grabbing border-2 border-white shadow-md ${
                preset === 'circle' ? 'rounded-full' : 'rounded-md'
              }`}
              style={{ backgroundColor: bgBackdrop || 'transparent' }}
            />

            <div className="flex w-full max-w-xs items-center gap-2">
              <ZoomOut size={14} className="text-slate-500" />
              <input
                type="range"
                aria-label="缩放证件照"
                min={0.6}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-teal-600"
              />
              <ZoomIn size={14} className="text-slate-500" />
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
                title="重置位置"
                className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 font-semibold text-slate-700">裁剪比例 / 形状</div>
              <div className="flex gap-1.5">
                {(
                  [
                    ['3:4', '一寸 3:4'],
                    ['1:1', '方照 1:1'],
                    ['circle', '圆形头像'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreset(id)}
                    className={`flex-1 rounded border py-1.5 font-medium ${
                      preset === id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 font-semibold text-slate-700">相框修饰</div>
              <div className="flex gap-1.5">
                {FRAME_STYLES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFrameStyle(item.id)}
                    className={`flex-1 rounded border py-1.5 font-medium ${
                      frameStyle === item.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 font-semibold text-slate-700">底衬色块（适合透明底或微调背景）</div>
            <div className="flex flex-wrap items-center gap-2">
              {BACKDROP_SWATCHES.map((sw) => {
                const active = bgBackdrop === sw.hex;
                return (
                  <button
                    key={sw.label}
                    type="button"
                    onClick={() => setBgBackdrop(sw.hex)}
                    className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 ${
                      active
                        ? 'border-slate-900 bg-slate-100 font-semibold text-slate-900'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-slate-300"
                      style={{
                        backgroundColor: sw.hex || 'transparent',
                        backgroundImage: sw.hex
                          ? undefined
                          : 'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%)',
                        backgroundSize: '8px 8px',
                      }}
                    />
                    {sw.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs">
          <div>
            <input
              ref={filePickRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handlePickFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => filePickRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
            >
              <Upload size={12} /> 更换原图
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleConfirm()}
              className="inline-flex items-center gap-1.5 rounded bg-teal-600 px-3.5 py-1.5 font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
            >
              <Check size={13} /> {saving ? '保存中...' : '保存并应用证件照'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
