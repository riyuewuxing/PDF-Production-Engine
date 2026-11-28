import { iconSkin, buttonSkin } from '../../studio-theme/componentSkins';
import { Check, RotateCcw, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {useStudioThemeId, useStudioComponentSkins} from '../../studio-theme/StudioThemeProvider';
import {surfaceStyle} from '../../studio-theme/surfaces';
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
  const themeId=useStudioThemeId();
  const skins=useStudioComponentSkins();
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
  const [loaded,setLoaded]=useState<{src:string;image:HTMLImageElement}|null>(null);
  const [reading,setReading]=useState(false);
  const ready=!!srcUrl&&!reading&&loaded?.src===srcUrl;
  const readerRef=useRef<FileReader|null>(null);
  const savingRef=useRef(false);
  const panelRef=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onCancel);closeRef.current=onCancel;
  const cancel=()=>{if(!savingRef.current)closeRef.current();};
  const draggingRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });
  const filePickRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(()=>{
    if(!isOpen)return;
    setSrcUrl(initialSrc);setLoaded(null);setReading(false);
    setPreset(initialPhotoConfig.borderRadius==='full'?'circle':initialPhotoConfig.aspectRatio==='1:1'?'1:1':'3:4');
    setZoom(1);setOffset({x:0,y:0});setBgBackdrop(initialPhotoConfig.bgBackdrop||'');
    setFrameStyle(initialPhotoConfig.frameStyle||'none');setError(null);
    return ()=>{const r=readerRef.current;readerRef.current=null;if(r?.readyState===FileReader.LOADING)r.abort();draggingRef.current.active=false;};
  },[initialPhotoConfig.bgBackdrop,initialPhotoConfig.frameStyle,initialPhotoConfig.aspectRatio,initialPhotoConfig.borderRadius,initialSrc,isOpen]);

  const targetCanvasSize=preset==='3:4'?{width:240,height:320}:{width:260,height:260};

  // Decode only when the source changes. A stale or invalid source is never exportable.
  useEffect(()=>{
    if(!isOpen||!srcUrl)return;
    let cancelled=false;const img=new Image();img.crossOrigin='anonymous';
    img.onload=()=>{if(!cancelled)setLoaded({src:srcUrl,image:img});};
    img.onerror=()=>{if(!cancelled){setLoaded(null);setError('无法读取图片内容，请更换 PNG/JPG/WebP 文件');}};
    img.src=srcUrl;
    return ()=>{cancelled=true;};
  },[isOpen,srcUrl]);

  // The backing pixels depend only on the selected image and crop controls, not the theme.
  useLayoutEffect(()=>{
    const canvas=canvasRef.current,ctx=canvas?.getContext('2d');
    if(!isOpen||!canvas||!ctx)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(bgBackdrop){ctx.fillStyle=bgBackdrop;ctx.fillRect(0,0,canvas.width,canvas.height);}
    if(!ready||!loaded)return;
    const img=loaded.image;
    const rect=computeCropDrawRect({naturalWidth:img.naturalWidth||300,naturalHeight:img.naturalHeight||400,canvasWidth:canvas.width,canvasHeight:canvas.height,zoom,offsetX:offset.x,offsetY:offset.y});
    ctx.drawImage(img,rect.dx,rect.dy,rect.dw,rect.dh);
  },[bgBackdrop,isOpen,loaded,ready,offset.x,offset.y,preset,zoom]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!isOpen||!canvas)return;
    const wheel=(e:WheelEvent)=>{if(!ready||savingRef.current)return;e.preventDefault();setZoom(z=>Math.min(3,Math.max(0.6,Number((z-e.deltaY*0.001).toFixed(2)))));};
    canvas.addEventListener('wheel',wheel,{passive:false});
    return ()=>canvas.removeEventListener('wheel',wheel);
  },[isOpen,ready]);

  useLayoutEffect(()=>{
    const panel=panelRef.current;if(!isOpen||!panel)return;
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const items=()=>Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')).filter(el=>el.tabIndex>=0&&el.getClientRects().length>0);
    const first=()=> (items()[0]??panel).focus({preventScroll:true});first();
    const key=(e:KeyboardEvent)=>{
      if(e.isComposing||e.keyCode===229)return;
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&['s','k','z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();return;}
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!savingRef.current)closeRef.current();return;}
      if(e.key!=='Tab')return;
      const xs=items(),index=xs.indexOf(document.activeElement as HTMLElement);
      if(!xs.length||index<0||(e.shiftKey?index===0:index===xs.length-1)){e.preventDefault();e.stopPropagation();((e.shiftKey?xs.at(-1):xs[0])??panel).focus();}
    };
    const focus=(e:FocusEvent)=>{if(e.target instanceof Node&&!panel.contains(e.target))first();};
    document.addEventListener('keydown',key,true);document.addEventListener('focusin',focus);
    return ()=>{document.removeEventListener('keydown',key,true);document.removeEventListener('focusin',focus);const active=document.activeElement;if(opener?.isConnected&&!opener.closest('[inert]')&&(!active||active===document.body||panel.contains(active)))opener.focus({preventScroll:true});};
  },[isOpen]);
  useLayoutEffect(()=>{const panel=panelRef.current;if(isOpen&&panel&&!panel.contains(document.activeElement))panel.focus({preventScroll:true});},[isOpen,saving,ready]);

  if (!isOpen) return null;

  const handlePickFile=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];if(!file||savingRef.current)return;e.target.value='';
    const prior=readerRef.current;readerRef.current=null;if(prior?.readyState===FileReader.LOADING)prior.abort();
    setLoaded(null);setSrcUrl('');setReading(true);setError(null);
    const reader=new FileReader();readerRef.current=reader;
    reader.onload=()=>{if(readerRef.current!==reader)return;readerRef.current=null;setReading(false);if(typeof reader.result!=='string'){setError('读取图片失败');return;}setSrcUrl(reader.result);setZoom(1);setOffset({x:0,y:0});};
    reader.onerror=()=>{if(readerRef.current===reader){readerRef.current=null;setReading(false);setError('读取图片失败');}};
    reader.readAsDataURL(file);
  };

  const handleConfirm = async () => {
    if(savingRef.current||!ready||!loaded)return;
    savingRef.current=true;setSaving(true);
    setError(null);
    try {
      const outW = preset === '3:4' ? 360 : 360;
      const outH = preset === '3:4' ? 480 : 360;
      let exportedUrl:string;

      const img = loaded.image;
      const offscreen = document.createElement('canvas');
      offscreen.width = outW;
      offscreen.height = outH;
      const ctx = offscreen.getContext('2d');
      if(!ctx||!img.complete||img.naturalWidth<=0)throw Error('图片尚未成功读取，请更换原图后重试');
      {
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
      savingRef.current=false;setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="证件照裁剪与底色工作台"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
      onClick={cancel}
    >
      <div
        ref={panelRef} tabIndex={-1} data-studio-region="photo-crop-dialog" data-studio-surface="panel" data-studio-theme={themeId} style={surfaceStyle(themeId,'panel')}
        className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-white text-slate-900 shadow-2xl studio-ui-border studio-ui-surface studio-ui-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 studio-ui-border">
          <div>
            <h2 className="text-sm font-bold text-slate-900 studio-ui-primary">证件照裁剪与底色工作台</h2>
            <p className="text-[11px] text-slate-500 studio-ui-muted">画布内可按住拖动位置，滚轮或滑块缩放</p>
          </div>
          <button {...iconSkin(skins)} data-studio-control="true"
            type="button"
            onClick={cancel}
            disabled={saving} aria-label="关闭证件照裁剪弹窗"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 studio-ui-muted studio-ui-hover studio-ui-hover-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4 text-xs">
          {error && (
            <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700 studio-ui-error-border studio-ui-error-surface studio-ui-error">
              {error}
            </div>
          )}

          {!ready&&!error&&<p role="status" className="text-slate-500 studio-ui-muted">正在读取证件照…</p>}
          {/* Neutral calibration backing: no theme applied to bitmap or swatches. */}
          <div data-studio-crop-stage="neutral" className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-slate-100 p-4 studio-ui-border">
            <canvas
              ref={canvasRef} tabIndex={0} data-studio-control="true" aria-label="证件照裁剪画布（方向键移动，Shift 加速）"
              width={targetCanvasSize.width}
              height={targetCanvasSize.height}
              onPointerDown={(e) => {
                if(!ready||savingRef.current)return;
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
                if (!draggingRef.current.active||!ready||savingRef.current) return;
                setOffset({
                  x: draggingRef.current.baseX + (e.clientX - draggingRef.current.startX)*e.currentTarget.width/Math.max(1,e.currentTarget.clientWidth),
                  y: draggingRef.current.baseY + (e.clientY - draggingRef.current.startY)*e.currentTarget.height/Math.max(1,e.currentTarget.clientHeight),
                });
              }}
              onPointerUp={() => {
                draggingRef.current.active = false;
              }}
              onPointerCancel={()=>{draggingRef.current.active=false;}}
              onLostPointerCapture={()=>{draggingRef.current.active=false;}}
              onKeyDown={e=>{if(!ready||savingRef.current||e.ctrlKey||e.metaKey||e.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const step=e.shiftKey?10:1;setOffset(o=>({x:o.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),y:o.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)}));}}
              className={`max-w-full h-auto touch-none cursor-grab active:cursor-grabbing border-2 border-white shadow-md ${
                preset === 'circle' ? 'rounded-full' : 'rounded-md'
              }`}
              style={{ backgroundColor: bgBackdrop || 'transparent' }}
            />

            <div className="flex w-full max-w-xs items-center gap-2">
              <ZoomOut size={14} className="text-slate-500" />
              <input
                data-studio-control="true" type="range" disabled={saving||!ready}
                aria-label="缩放证件照"
                min={0.6}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-teal-600 studio-ui-accent"
              />
              <ZoomIn size={14} className="text-slate-500" />
              <button {...iconSkin(skins)} data-studio-control="true"
                type="button"
                onClick={() => {
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
                title="重置位置" aria-label="重置证件照位置" disabled={saving||!ready}
                className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 font-semibold text-slate-700 studio-ui-primary">裁剪比例 / 形状</div>
              <div className="flex gap-1.5">
                {(
                  [
                    ['3:4', '一寸 3:4'],
                    ['1:1', '方照 1:1'],
                    ['circle', '圆形头像'],
                  ] as const
                ).map(([id, label]) => (
                  <button data-studio-control="true"
                    key={id}
                    type="button"
                    onClick={() => setPreset(id)} disabled={saving} aria-pressed={preset===id}
                    className={`flex-1 rounded border py-1.5 font-medium ${
                      preset === id
                        ? 'border-slate-900 bg-slate-900 text-white studio-ui-fill studio-ui-on-fill'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 studio-ui-border studio-ui-surface studio-ui-primary studio-ui-hover'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 font-semibold text-slate-700 studio-ui-primary">相框修饰</div>
              <div className="flex gap-1.5">
                {FRAME_STYLES.map((item) => (
                  <button data-studio-control="true"
                    key={item.id}
                    type="button"
                    onClick={() => setFrameStyle(item.id)} disabled={saving} aria-pressed={frameStyle===item.id}
                    className={`flex-1 rounded border py-1.5 font-medium ${
                      frameStyle === item.id
                        ? 'border-slate-900 bg-slate-900 text-white studio-ui-fill studio-ui-on-fill'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 studio-ui-border studio-ui-surface studio-ui-primary studio-ui-hover'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 font-semibold text-slate-700 studio-ui-primary">底衬色块（适合透明底或微调背景）</div>
            <div className="flex flex-wrap items-center gap-2">
              {BACKDROP_SWATCHES.map((sw) => {
                const active = bgBackdrop === sw.hex;
                return (
                  <button data-studio-control="true"
                    key={sw.label}
                    type="button"
                    onClick={() => setBgBackdrop(sw.hex)} disabled={saving} aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 ${
                      active
                        ? 'border-slate-900 bg-slate-100 font-semibold text-slate-900 studio-ui-selected-border studio-ui-selected studio-ui-selected-text'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 studio-ui-border studio-ui-surface studio-ui-primary studio-ui-hover'
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

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs studio-ui-border studio-ui-raised">
          <div>
            <input
              ref={filePickRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handlePickFile}
              className="hidden"
            />
            <button {...buttonSkin(skins)} data-studio-control="true"
              type="button"
              onClick={() => filePickRef.current?.click()} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-100 studio-ui-border studio-ui-surface studio-ui-primary studio-ui-hover"
            >
              <Upload size={12} /> 更换原图
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button {...buttonSkin(skins)} data-studio-control="true"
              type="button"
              onClick={cancel} disabled={saving}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 studio-ui-border studio-ui-surface studio-ui-primary studio-ui-hover"
            >
              取消
            </button>
            <button {...buttonSkin(skins,'primary')} data-studio-control="true"
              type="button"
              disabled={saving||!ready}
              onClick={() => void handleConfirm()}
              className="inline-flex items-center gap-1.5 rounded bg-teal-600 px-3.5 py-1.5 font-semibold text-white hover:bg-teal-500 disabled:opacity-50 studio-ui-fill studio-ui-on-fill studio-ui-fill-hover"
            >
              <Check size={13} /> {saving ? '保存中...' : '保存并应用证件照'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
