import { useStudioComponentSkins } from '../../studio-theme/StudioThemeProvider';
import { buttonSkin, iconSkin, fieldSkin } from '../../studio-theme/componentSkins';
import { Crop, Eye, EyeOff, Plus, Trash2, Upload } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { apiClient, resolveAssetUrl } from '../../lib/apiClient';
import type { BasicInfo, CustomField } from '../../schema/resumeSchema';
import { type CropOutputPayload, PhotoCropModal } from './PhotoCropModal';

interface BasicInfoEditorProps {
  basic: BasicInfo;
  onChange: (next: BasicInfo) => void;
  onImmediateChange?: (next: BasicInfo) => void;
}

const CORE_FIELD_KEYS = new Set([
  'name',
  'title',
  'employmentStatus',
  'birthDate',
  'email',
  'phone',
  'location',
]);

export function BasicInfoEditor({ basic, onChange, onImmediateChange }: BasicInfoEditorProps) {
  const skins=useStudioComponentSkins();
  const emitDiscrete = onImmediateChange ?? onChange;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const updateCoreValue = (key: string, value: string) => {
    if (!CORE_FIELD_KEYS.has(key)) return;
    onChange({
      ...basic,
      [key]: value,
    });
  };

  const getCoreValue = (key: string): string => {
    switch (key) {
      case 'name':
        return basic.name;
      case 'title':
        return basic.title;
      case 'employmentStatus':
        return basic.employmentStatus;
      case 'birthDate':
        return basic.birthDate;
      case 'email':
        return basic.email;
      case 'phone':
        return basic.phone;
      case 'location':
        return basic.location;
      default:
        return '';
    }
  };

  const toggleFieldVisible = (fieldId: string) => {
    emitDiscrete({
      ...basic,
      fieldOrder: basic.fieldOrder.map((f) =>
        f.id === fieldId ? { ...f, visible: !f.visible } : f,
      ),
    });
  };

  const addCustomField = () => {
    const nextField: CustomField = {
      id: crypto.randomUUID(),
      label: '新标签',
      value: '',
      visible: true,
    };
    emitDiscrete({
      ...basic,
      customFields: [...basic.customFields, nextField],
    });
  };

  const updateCustomField = (id: string, patch: Partial<CustomField>) => {
    const emit = typeof patch.visible === 'boolean' ? emitDiscrete : onChange;
    emit({
      ...basic,
      customFields: basic.customFields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  };

  const removeCustomField = (id: string) => {
    emitDiscrete({
      ...basic,
      customFields: basic.customFields.filter((f) => f.id !== id),
    });
  };

  const handlePhotoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
          } else {
            reject(new Error('读取图片失败'));
          }
        };
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      setCropSrc(dataUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '读取图片失败');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCropConfirm = async (result: CropOutputPayload) => {
    const uploaded = await apiClient.uploadAsset(result.fileName, result.dataUrl);
    emitDiscrete({
      ...basic,
      photo: uploaded.url,
      photoConfig: {
        ...basic.photoConfig,
        width: result.width,
        height: result.height,
        aspectRatio: result.aspectRatio,
        borderRadius: result.borderRadius,
        bgBackdrop: result.bgBackdrop,
        frameStyle: result.frameStyle,
        visible: true,
      },
    });
    setCropSrc(null);
  };

  return (
    <div className="space-y-4">
      {/* Core fields */}
      <div className="space-y-2.5">
        {basic.fieldOrder.map((field) => (
          <div key={field.id} className="flex items-center gap-2">
            <label
              htmlFor={`basic-field-${field.key}`}
              className="w-16 shrink-0 text-xs font-medium text-slate-600 studio-ui-muted"
            >
              {field.label}
            </label>
            <input {...(field.key==='birthDate'?{}:fieldSkin(skins,'text'))} data-studio-control="true"
              id={`basic-field-${field.key}`}
              type="text"
              value={getCoreValue(field.key)}
              onChange={(e) => updateCoreValue(field.key, e.target.value)}
              placeholder={`输入${field.label}`}
              className={`min-w-0 flex-1 rounded border border-slate-200 studio-ui-border px-2.5 py-1.5 text-sm text-slate-900 studio-ui-primary focus:border-slate-500 studio-ui-focus-border focus:outline-none ${
                field.visible ? 'bg-white studio-ui-surface' : 'bg-slate-50 studio-ui-raised text-slate-400 studio-ui-muted'
              }`}
            />
            <button data-studio-control="true"
              type="button"
              {...iconSkin(skins)}
                onClick={() => toggleFieldVisible(field.id)}
              aria-label={field.visible ? `隐藏${field.label}` : `显示${field.label}`}
              title={field.visible ? '当前显示' : '当前已隐藏'}
              className="rounded p-1.5 text-slate-500 studio-ui-muted hover:bg-slate-100 studio-ui-hover hover:text-slate-800 studio-ui-hover-primary"
            >
              {field.visible ? <Eye size={15} /> : <EyeOff size={15} className="text-slate-400 studio-ui-muted" />}
            </button>
          </div>
        ))}
      </div>

      {/* Custom fields / tags */}
      <div className="border-t border-slate-100 studio-ui-divider pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700 studio-ui-primary">自定义标签字段</span>
          <button data-studio-control="true"
            type="button"
            {...buttonSkin(skins)}
                onClick={addCustomField}
            className="inline-flex items-center gap-1 rounded border border-slate-200 studio-ui-border px-2 py-1 text-xs font-medium text-slate-700 studio-ui-primary hover:bg-slate-50 studio-ui-hover"
          >
            <Plus size={12} /> 添加标签
          </button>
        </div>
        <div className="space-y-2">
          {basic.customFields.map((cf) => (
            <div key={cf.id} className="flex items-center gap-1.5">
              <input {...fieldSkin(skins,'text')} data-studio-control="true"
                type="text"
                aria-label="标签名"
                value={cf.label}
                onChange={(e) => updateCustomField(cf.id, { label: e.target.value })}
                placeholder="标签"
                className="w-20 shrink-0 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1 text-xs text-slate-800 studio-ui-primary focus:border-slate-500 studio-ui-focus-border focus:outline-none"
              />
              <input {...fieldSkin(skins,'text')} data-studio-control="true"
                type="text"
                aria-label={`${cf.label || '自定义'}内容`}
                value={cf.value}
                onChange={(e) => updateCustomField(cf.id, { value: e.target.value })}
                placeholder="值"
                className="min-w-0 flex-1 rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-2 py-1 text-xs text-slate-900 studio-ui-primary focus:border-slate-500 studio-ui-focus-border focus:outline-none"
              />
              <button data-studio-control="true"
                type="button"
                {...iconSkin(skins)}
                onClick={() => updateCustomField(cf.id, { visible: !cf.visible })}
                aria-label={cf.visible ? `隐藏${cf.label}` : `显示${cf.label}`}
                className="rounded p-1 text-slate-500 studio-ui-muted hover:bg-slate-100 studio-ui-hover"
              >
                {cf.visible ? <Eye size={14} /> : <EyeOff size={14} className="text-slate-400 studio-ui-muted" />}
              </button>
              <button data-studio-control="true"
                type="button"
                {...iconSkin(skins,'danger')}
                onClick={() => removeCustomField(cf.id)}
                aria-label={`删除${cf.label}`}
                className="rounded p-1 text-slate-400 studio-ui-muted hover:bg-red-50 studio-ui-error-hover hover:text-red-600 studio-ui-error-hover-text"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Photo Upload & Config */}
      <div className="border-t border-slate-100 studio-ui-divider pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700 studio-ui-primary">证件照设置</span>
          <button data-studio-control="true"
            type="button"
            onClick={() =>
              emitDiscrete({
                ...basic,
                photoConfig: { ...basic.photoConfig, visible: !basic.photoConfig.visible },
              })
            }
            className="inline-flex items-center gap-1 rounded border border-slate-200 studio-ui-border px-2 py-1 text-xs text-slate-600 studio-ui-muted hover:bg-slate-50 studio-ui-hover"
          >
            {basic.photoConfig.visible ? <Eye size={12} /> : <EyeOff size={12} />}
            {basic.photoConfig.visible ? '显示头像' : '已隐藏头像'}
          </button>
        </div>

        <div className="flex items-start gap-3">
          {basic.photo ? (
            <img
              src={resolveAssetUrl(basic.photo)}
              alt="证件照预览"
              className="h-20 w-16 shrink-0 rounded border border-slate-200 studio-ui-border object-cover"
            />
          ) : (
            <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 studio-ui-border bg-slate-50 studio-ui-raised text-[11px] text-slate-400 studio-ui-muted">
              无头像
            </div>
          )}

          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input data-studio-control="true"
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handlePhotoFileChange}
                className="hidden"
              />
              <button data-studio-control="true"
                type="button"
                {...buttonSkin(skins,'primary')}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded bg-slate-900 studio-ui-fill px-2.5 py-1.5 text-xs font-medium text-white studio-ui-on-fill hover:bg-slate-800 studio-ui-fill-hover"
              >
                <Upload size={12} />
                {basic.photo ? '更换照片' : '上传并裁剪证件照'}
              </button>
              {basic.photo && (
                <button data-studio-control="true"
                  type="button"
                  {...buttonSkin(skins)}
                onClick={() => setCropSrc(resolveAssetUrl(basic.photo))}
                  className="inline-flex items-center gap-1 rounded border border-teal-300 studio-ui-selected-border bg-teal-50 studio-ui-selected px-2 py-1.5 text-xs font-medium text-teal-800 studio-ui-selected-text hover:bg-teal-100 studio-ui-selected-hover"
                >
                  <Crop size={12} /> 裁剪/换底
                </button>
              )}
              {basic.photo && (
                <button data-studio-control="true"
                  type="button"
                  {...buttonSkin(skins,'danger')}
                onClick={() => emitDiscrete({ ...basic, photo: '' })}
                  className="rounded border border-slate-200 studio-ui-border px-2 py-1.5 text-xs text-slate-600 studio-ui-muted hover:bg-red-50 studio-ui-error-hover hover:text-red-600 studio-ui-error-hover-text"
                >
                  清除
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <label className="flex flex-col gap-0.5 text-slate-500 studio-ui-muted">
                <span>宽 (px)</span>
                <input {...fieldSkin(skins,'number')} data-studio-control="true"
                  type="number"
                  min={50}
                  max={180}
                  value={basic.photoConfig.width}
                  onChange={(e) =>
                    onChange({
                      ...basic,
                      photoConfig: {
                        ...basic.photoConfig,
                        width: Math.min(180, Math.max(50, Number(e.target.value) || 90)),
                      },
                    })
                  }
                  className="rounded border border-slate-200 studio-ui-border px-1.5 py-1 text-slate-800 studio-ui-primary"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-slate-500 studio-ui-muted">
                <span>高 (px)</span>
                <input {...fieldSkin(skins,'number')} data-studio-control="true"
                  type="number"
                  min={50}
                  max={220}
                  value={basic.photoConfig.height}
                  onChange={(e) =>
                    onChange({
                      ...basic,
                      photoConfig: {
                        ...basic.photoConfig,
                        height: Math.min(220, Math.max(50, Number(e.target.value) || 120)),
                      },
                    })
                  }
                  className="rounded border border-slate-200 studio-ui-border px-1.5 py-1 text-slate-800 studio-ui-primary"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-slate-500 studio-ui-muted">
                <span>圆角</span>
                <select data-studio-control="true"
                  value={basic.photoConfig.borderRadius}
                  onChange={(e) =>
                    emitDiscrete({
                      ...basic,
                      photoConfig: {
                        ...basic.photoConfig,
                        borderRadius: e.target.value as BasicInfo['photoConfig']['borderRadius'],
                      },
                    })
                  }
                  className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-1 py-1 text-slate-800 studio-ui-primary"
                >
                  <option value="none">直角</option>
                  <option value="sm">微圆</option>
                  <option value="md">圆角</option>
                  <option value="full">圆形</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
              <label className="flex flex-col gap-0.5 text-slate-500 studio-ui-muted">
                <span>相框样式</span>
                <select data-studio-control="true"
                  aria-label="头像相框样式"
                  value={basic.photoConfig.frameStyle ?? 'none'}
                  onChange={(e) =>
                    emitDiscrete({
                      ...basic,
                      photoConfig: {
                        ...basic.photoConfig,
                        frameStyle: e.target.value as BasicInfo['photoConfig']['frameStyle'],
                      },
                    })
                  }
                  className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-1.5 py-1 text-slate-800 studio-ui-primary"
                >
                  <option value="none">默认无框</option>
                  <option value="white-ring">白环投影</option>
                  <option value="card-border">精装相框</option>
                </select>
              </label>

              <label className="flex flex-col gap-0.5 text-slate-500 studio-ui-muted">
                <span>照片底衬色</span>
                <select data-studio-control="true"
                  aria-label="照片底衬色"
                  value={basic.photoConfig.bgBackdrop ?? ''}
                  onChange={(e) =>
                    emitDiscrete({
                      ...basic,
                      photoConfig: {
                        ...basic.photoConfig,
                        bgBackdrop: e.target.value,
                      },
                    })
                  }
                  className="rounded border border-slate-200 studio-ui-border bg-white studio-ui-surface px-1.5 py-1 text-slate-800 studio-ui-primary"
                >
                  <option value="">默认透明</option>
                  <option value="#2563eb">证件蓝</option>
                  <option value="#ffffff">纯白</option>
                  <option value="#dc2626">证件红</option>
                  <option value="#e2e8f0">浅商务灰</option>
                </select>
              </label>
            </div>
            {uploadError && <p className="text-xs text-red-600 studio-ui-error">{uploadError}</p>}
          </div>
        </div>
      </div>

      <PhotoCropModal
        isOpen={Boolean(cropSrc)}
        initialSrc={cropSrc ?? ''}
        initialPhotoConfig={basic.photoConfig}
        onCancel={() => setCropSrc(null)}
        onConfirm={handleCropConfirm}
      />
    </div>
  );
}
