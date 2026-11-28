import { useLayoutEffect,useRef,useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useStudioTheme } from './StudioThemeProvider';
import { surfaceStyle } from './surfaces';
import { BUTTON_VARIANTS, ICON_VARIANTS, BUTTON_LABELS, ICON_LABELS, buttonSkin, iconSkin, equalSkins, type ComponentSkins } from './componentSkins';

/** First slice of the workshop. Native modal, local draft, explicit apply.
 * Sample controls are real native buttons; all handlers are local demonstrations. */
export function ComponentSkinWorkshop() {
  const {themeId,skins,skinNotice,selectSkins}=useStudioTheme();
  const dialog=useRef<HTMLDialogElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const [opened,setOpened]=useState(false);
  const [draft,setDraft]=useState<ComponentSkins>(()=>({...skins}));
  const [basis,setBasis]=useState<ComponentSkins>(()=>({...skins}));
  const [count,setCount]=useState(0);
  const [pending,setPending]=useState(false);
  const open=()=>{
    setDraft({...skins});setBasis({...skins});setCount(0);setPending(false);
    setOpened(true);
  };
  useLayoutEffect(()=>{if(opened&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[opened]);
  const close=()=>dialog.current?.close();
  const conflict=!equalSkins(basis,skins);
  const sampleClass='inline-flex items-center justify-center gap-1 rounded border px-3 py-2 text-sm font-medium studio-ui-border studio-ui-primary studio-ui-surface';
  const disabledClass='inline-flex items-center justify-center gap-1 rounded border px-3 py-2 text-sm font-medium studio-ui-border studio-ui-muted studio-ui-raised disabled:opacity-50';
  return <>
    <button ref={trigger} type="button" onClick={open} aria-haspopup="dialog"
      className="rounded border border-slate-700 studio-chrome-border bg-slate-900 studio-chrome-field px-2 py-1 text-[11px] studio-chrome-primary text-slate-100 hover:bg-slate-800 studio-chrome-hover">组件外观</button>
    {skinNotice&&<span role="status" className="studio-theme-notice max-w-[180px] whitespace-normal text-[11px]">{skinNotice}</span>}
    {opened&&<dialog ref={dialog} role="dialog" aria-label="组件外观工坊" data-studio-region="component-skin-workshop"
      data-studio-surface="panel" data-studio-theme={themeId} style={surfaceStyle(themeId,'panel')}
      className="studio-component-dialog no-print"
      onClose={()=>{setOpened(false);trigger.current?.focus();setPending(false);}}
      onKeyDown={e=>{if(e.ctrlKey||e.metaKey)e.stopPropagation();}}>
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">组件外观工坊 · 首批试点</h2><p className="text-xs mt-1 studio-ui-muted">仅改变已接入的工作台按钮。预览中的操作使用合成样例，不会写入简历。</p></div>
        <button type="button" className="studio-skin-neutral shrink-0" onClick={close} aria-label="关闭组件外观工坊">关闭</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">普通按钮
          <select aria-label="普通按钮皮肤" value={draft.button} onChange={e=>setDraft(prev=>({...prev,button:e.target.value as ComponentSkins['button']}))}>
            <option value="inherit">保留当前主题原样</option>
            {BUTTON_VARIANTS.map(v=><option key={v} value={v}>{BUTTON_LABELS[v]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">图标按钮
          <select aria-label="图标按钮皮肤" value={draft.icon} onChange={e=>setDraft(prev=>({...prev,icon:e.target.value as ComponentSkins['icon']}))}>
            <option value="inherit">保留当前主题原样</option>
            {ICON_VARIANTS.map(v=><option key={v} value={v}>{ICON_LABELS[v]}</option>)}
          </select>
        </label>
      </div>
      <section aria-label="普通按钮真实样例" className="mt-4 rounded-lg border p-3 studio-ui-border">
        <h3 className="font-semibold text-sm">普通按钮 · 真实原生控件</h3>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <button type="button" {...buttonSkin(draft,'normal')} className={sampleClass} onClick={()=>setCount(c=>c+1)}>普通操作</button>
          <button type="button" {...buttonSkin(draft,'primary')} className="inline-flex items-center rounded px-3 py-2 text-sm font-semibold bg-teal-700 text-white studio-ui-fill studio-ui-on-fill" onClick={()=>setCount(c=>c+1)}>主要操作</button>
          <button type="button" {...buttonSkin(draft,'danger')} className="inline-flex items-center rounded border px-3 py-2 text-sm font-medium bg-red-50 text-red-800 border-red-300 studio-ui-error-surface studio-ui-error studio-ui-error-border" onClick={()=>setPending(true)}>危险操作演示</button>
          <button type="button" {...buttonSkin(draft,'normal')} disabled className={disabledClass}>不可用</button>
        </div>
      </section>
      <section aria-label="图标按钮真实样例" className="mt-3 rounded-lg border p-3 studio-ui-border">
        <h3 className="font-semibold text-sm">图标按钮 · 真实原生控件</h3>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <button type="button" {...iconSkin(draft)} aria-label="增加样例计数" className="inline-flex items-center rounded border p-2 studio-ui-border studio-ui-primary" onClick={()=>setCount(c=>c+1)}><Plus size={16}/></button>
          <button type="button" {...iconSkin(draft,'danger')} aria-label="危险图标操作演示" className="inline-flex items-center rounded border p-2 text-red-800 studio-ui-error studio-ui-error-border" onClick={()=>setPending(true)}><Trash2 size={16}/></button>
          <button type="button" {...iconSkin(draft)} aria-label="不可用图标按钮" disabled className="inline-flex items-center rounded border p-2 opacity-50 studio-ui-border studio-ui-muted"><Plus size={16}/></button>
          <span role="status" className="text-sm">样例操作次数：{count}</span>
        </div>
      </section>
      {pending&&<section aria-label="样例危险操作确认" className="mt-3 rounded border p-3 text-sm studio-ui-error-border studio-ui-error-surface">
        <p>仅样例确认，绝不删除真实数据。</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" {...buttonSkin(draft,'danger')} className="studio-skin-neutral" onClick={()=>{setCount(c=>c+1);setPending(false);}}>确认样例操作</button>
          <button type="button" className="studio-skin-neutral" onClick={()=>setPending(false)}>取消样例操作</button>
        </div>
      </section>}
      <p className="text-xs mt-3 studio-ui-muted">切换全局色板时保留本族覆盖。选择“保留当前主题原样”即可恢复本族原外观；取消或 Esc 不会保存草稿。</p>
      {conflict&&<p role="alert" className="mt-2 studio-skin-notice">当前组件配置已变化，请关闭后重新打开。</p>}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="studio-skin-neutral" onClick={()=>setDraft({button:'inherit',icon:'inherit'})}>恢复两族原样（草稿）</button>
        <button type="button" className="studio-skin-neutral" onClick={close}>取消</button>
        <button type="button" className="studio-skin-apply disabled:opacity-50" disabled={conflict||equalSkins(draft,basis)} onClick={()=>{selectSkins(draft);close();}}>应用组件外观</button>
      </div>
    </dialog>}
  </>;
}
