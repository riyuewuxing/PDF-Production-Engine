import { createElement } from 'react';
import { projectVisibleResume } from '../lib/resumeVisibility';
import type { TemplateId } from '../schema/resumeSchema';
import { AwesomeCvModernTemplate } from './AwesomeCvModernTemplate';
import { ChicvMinimalTemplate } from './ChicvMinimalTemplate';
import { ClassicSerifTemplate } from './ClassicSerifTemplate';
import { CompactBadgeTemplate } from './CompactBadgeTemplate';
import { DoubleLineScholarTemplate } from './DoubleLineScholarTemplate';
import { EditorialAccentTemplate } from './EditorialAccentTemplate';
import { EduNavyRibbonTemplate } from './EduNavyRibbonTemplate';
import { GridCardTemplate } from './GridCardTemplate';
import { HarvardAcademicTemplate } from './HarvardAcademicTemplate';
import { JakesResumeCnTemplate } from './JakesResumeCnTemplate';
import { JsonMacchiatoTemplate } from './JsonMacchiatoTemplate';
import { JsonPaperCleanTemplate } from './JsonPaperCleanTemplate';
import { LapisCleanTemplate } from './LapisCleanTemplate';
import { LeftRightTemplate } from './LeftRightTemplate';
import { MinimalAtsTemplate } from './MinimalAtsTemplate';
import { ModernDeedyTemplate } from './ModernDeedyTemplate';
import { RedHeaderFormalTemplate } from './RedHeaderFormalTemplate';
import { RendercvClassicTemplate } from './RendercvClassicTemplate';
import { RendercvSb2novTemplate } from './RendercvSb2novTemplate';
import { RxAzurillTemplate } from './RxAzurillTemplate';
import { RxChikoritaTemplate } from './RxChikoritaTemplate';
import { RxDittoCardTemplate } from './RxDittoCardTemplate';
import { SidebarLeftTemplate } from './SidebarLeftTemplate';
import { SidebarRightTemplate } from './SidebarRightTemplate';
import { TeacherTableClassicTemplate } from './TeacherTableClassicTemplate';
import { TimelineFocusTemplate } from './TimelineFocusTemplate';
import { VipAmberLeftSidebarTemplate } from './VipAmberLeftSidebarTemplate';
import { VipBurgundyCenterHeroTemplate } from './VipBurgundyCenterHeroTemplate';
import { VipBurgundyLeftSidebarTemplate } from './VipBurgundyLeftSidebarTemplate';
import { VipClassicTopPhotoProTemplate } from './VipClassicTopPhotoProTemplate';
import { VipCornerNavySplitTemplate } from './VipCornerNavySplitTemplate';
import { VipCrimsonCardTemplate } from './VipCrimsonCardTemplate';
import { VipCrimsonDotMinimalTemplate } from './VipCrimsonDotMinimalTemplate';
import { VipCrimsonDoubleArcTemplate } from './VipCrimsonDoubleArcTemplate';
import { VipCrimsonRibbonBannerTemplate } from './VipCrimsonRibbonBannerTemplate';
import { VipCyanArcTrapezoidTemplate } from './VipCyanArcTrapezoidTemplate';
import { VipCyberDarkTemplate } from './VipCyberDarkTemplate';
import { VipEmeraldWaveArcTemplate } from './VipEmeraldWaveArcTemplate';
import { VipLavenderSlantTagTemplate } from './VipLavenderSlantTagTemplate';
import { VipObsidianGoldHeroTemplate } from './VipObsidianGoldHeroTemplate';
import { VipRoseBannerSplitTemplate } from './VipRoseBannerSplitTemplate';
import { VipRoyalDoubleWaveTemplate } from './VipRoyalDoubleWaveTemplate';
import { VipSkyNotchHeroTemplate } from './VipSkyNotchHeroTemplate';
import { VipTealRightFlagTemplate } from './VipTealRightFlagTemplate';
import { VipTealTopPillTemplate } from './VipTealTopPillTemplate';
import { WondercvCleanProTemplate } from './WondercvCleanProTemplate';
import { WondercvDiagonalHeroTemplate } from './WondercvDiagonalHeroTemplate';
import { WondercvMintCardTemplate } from './WondercvMintCardTemplate';
import { WondercvRoyalBannerTemplate } from './WondercvRoyalBannerTemplate';
import { WondercvSoftRightTemplate } from './WondercvSoftRightTemplate';
import { WondercvTealSidebarTemplate } from './WondercvTealSidebarTemplate';
import type { TemplateMetadata, ResumeTemplateProps } from './types';

const RAW_TEMPLATE_REGISTRY: TemplateMetadata[] = [
  // =========================================================================
  // 首屏置顶：19 套 VIP 商业旗舰（V4 晴蓝突出页眉 + V3 18 套 1:1 复刻）+ 2 套 WonderCV 经典旗舰
  // =========================================================================
  {
    id: 'vip-sky-notch-hero',
    name: 'VIP · 晴蓝突出页眉',
    subtitle: '1:1 复刻突出参考图：左侧大圆角晴空蓝渐变突出块 + 右侧纯白一寸照凹槽 + 浅蓝细线正文章节',
    category: 'vip-banner',
    recommendedColor: '#3b82f6',
    tags: ['VIP 1:1', '突出页眉', '晴空蓝'],
    accentPreview: '#3b82f6',
    layoutKind: 'banner',
    component: VipSkyNotchHeroTemplate,
  },
  {
    id: 'vip-emerald-wave-arc',
    name: 'VIP · 墨绿大弧破框照',
    subtitle: '1:1 复刻 R2C4：墨绿单弧 SVG 波浪页眉 + 居中白环圆头像破框压线',
    category: 'vip-wave',
    recommendedColor: '#115e59',
    tags: ['VIP 1:1', 'SVG波浪', '破框圆照'],
    accentPreview: '#115e59',
    layoutKind: 'banner',
    component: VipEmeraldWaveArcTemplate,
  },
  {
    id: 'vip-royal-double-wave',
    name: 'VIP · 皇室蓝双层波浪',
    subtitle: '1:1 复刻 R3C2：皇室蓝双层叠影波浪横幅 + 居中破框圆形头像 + 蓝标单栏',
    category: 'vip-wave',
    recommendedColor: '#1d4ed8',
    tags: ['VIP 1:1', '双层波浪', '皇室蓝'],
    accentPreview: '#1d4ed8',
    layoutKind: 'banner',
    component: VipRoyalDoubleWaveTemplate,
  },
  {
    id: 'vip-cyber-dark',
    name: 'VIP · 极光暗黑赛博',
    subtitle: '1:1 复刻 R3C3：全页深蓝黑底 + 极光蓝发光横幅 + 跨页深色打印保障',
    category: 'vip-banner',
    recommendedColor: '#2563eb',
    tags: ['VIP 1:1', '暗黑极光', '科技风'],
    accentPreview: '#0b1220',
    layoutKind: 'banner',
    component: VipCyberDarkTemplate,
  },
  {
    id: 'vip-teal-right-flag',
    name: 'VIP · 深青右全高斜旗',
    subtitle: '1:1 复刻 R2C2：右 26% 深青全高侧栏 + 左 74% 斜切青色梯形旗帜节头',
    category: 'vip-sidebar',
    recommendedColor: '#167883',
    tags: ['VIP 1:1', '梯形斜旗', '右深侧栏'],
    accentPreview: '#167883',
    layoutKind: 'sidebar-right',
    component: VipTealRightFlagTemplate,
  },
  {
    id: 'vip-burgundy-center-hero',
    name: 'VIP · 酒红满幅居中尊享',
    subtitle: '1:1 复刻 R4C1：酒红宽横幅 + 居中白环圆头像 + 稳重竖线节头',
    category: 'vip-banner',
    recommendedColor: '#9f1239',
    tags: ['VIP 1:1', '居中尊享', '酒红横幅'],
    accentPreview: '#9f1239',
    layoutKind: 'banner',
    component: VipBurgundyCenterHeroTemplate,
  },
  {
    id: 'vip-crimson-double-arc',
    name: 'VIP · 酒红双弧优雅波浪',
    subtitle: '1:1 复刻 R4C2：双层交错酒红柔和波浪 + 居中破框圆形头像',
    category: 'vip-wave',
    recommendedColor: '#a11639',
    tags: ['VIP 1:1', '双弧波浪', '破框圆照'],
    accentPreview: '#a11639',
    layoutKind: 'banner',
    component: VipCrimsonDoubleArcTemplate,
  },
  {
    id: 'vip-burgundy-left-sidebar',
    name: 'VIP · 酒红全高左精英栏',
    subtitle: '1:1 复刻 R4C3：左 27% 饱和酒红全高侧栏 + 右 73% 细线主区',
    category: 'vip-sidebar',
    recommendedColor: '#9f1239',
    tags: ['VIP 1:1', '左全高栏', '酒红'],
    accentPreview: '#9f1239',
    layoutKind: 'sidebar-left',
    component: VipBurgundyLeftSidebarTemplate,
  },
  {
    id: 'vip-obsidian-gold-hero',
    name: 'VIP · 曜石黑金高管横幅',
    subtitle: '1:1 复刻 R5C1：深炭黑满幅宽横幅配暖金底边 + 居中圆头像 + 色块节头',
    category: 'vip-banner',
    recommendedColor: '#1f2937',
    tags: ['VIP 1:1', '黑金高管', '居中横幅'],
    accentPreview: '#1f2937',
    layoutKind: 'banner',
    component: VipObsidianGoldHeroTemplate,
  },
  {
    id: 'vip-cyan-arc-trapezoid',
    name: 'VIP · 青碧双弧斜切旗帜',
    subtitle: '1:1 复刻 R5C2：青碧交错双弧顶饰 + 居中圆照 + 实心斜切梯形旗帜节头',
    category: 'vip-wave',
    recommendedColor: '#0f766e',
    tags: ['VIP 1:1', '双弧+斜旗', '青碧'],
    accentPreview: '#0f766e',
    layoutKind: 'banner',
    component: VipCyanArcTrapezoidTemplate,
  },
  {
    id: 'vip-corner-navy-split',
    name: 'VIP · 右上折角蓝灰双栏',
    subtitle: '1:1 复刻 R5C4：右上深海蓝斜角折饰 + 左 30% 浅蓝灰全高辅栏',
    category: 'vip-sidebar',
    recommendedColor: '#1e3a8a',
    tags: ['VIP 1:1', '角饰双栏', '省墨雅致'],
    accentPreview: '#1e3a8a',
    layoutKind: 'sidebar-left',
    component: VipCornerNavySplitTemplate,
  },
  {
    id: 'vip-amber-left-sidebar',
    name: 'VIP · 琥珀橙全高活力栏',
    subtitle: '1:1 复刻 图2 R2C4：左 27% 活力琥珀橙全高侧栏 + 右 73% 高对比主区',
    category: 'vip-sidebar',
    recommendedColor: '#ea580c',
    tags: ['VIP 1:1', '琥珀橙', '左全高栏'],
    accentPreview: '#ea580c',
    layoutKind: 'sidebar-left',
    component: VipAmberLeftSidebarTemplate,
  },
  {
    id: 'vip-crimson-ribbon-banner',
    name: 'VIP · 酒红横幅斜旗旗舰',
    subtitle: '1:1 复刻 图2 R3C4：酒红满幅横幅配圆照 + 实心斜切梯形旗帜节头',
    category: 'vip-banner',
    recommendedColor: '#991b1b',
    tags: ['VIP 1:1', '横幅+斜旗', '酒红'],
    accentPreview: '#991b1b',
    layoutKind: 'banner',
    component: VipCrimsonRibbonBannerTemplate,
  },
  {
    id: 'vip-classic-top-photo-pro',
    name: 'VIP · 名企考编右上照王者',
    subtitle: '1:1 复刻 图2 R4C1：极细顶色条 + 紧凑三栏摘要 + 右上角精致一寸照',
    category: 'teacher',
    recommendedColor: '#1e40af',
    tags: ['VIP 1:1', '名企考编', '右上照'],
    accentPreview: '#1e40af',
    layoutKind: 'single',
    component: VipClassicTopPhotoProTemplate,
  },
  {
    id: 'vip-lavender-slant-tag',
    name: 'VIP · 淡紫斜切左胶囊',
    subtitle: '1:1 复刻 R3C4：淡紫斜切几何横幅 + 左 20% 紫色圆角胶囊节头列',
    category: 'vip-wave',
    recommendedColor: '#7c3aed',
    tags: ['VIP 1:1', '斜切页眉', '左胶囊'],
    accentPreview: '#7c3aed',
    layoutKind: 'editorial',
    component: VipLavenderSlantTagTemplate,
  },
  {
    id: 'vip-crimson-card',
    name: 'VIP · 酒红顶条左标卡',
    subtitle: '1:1 复刻 R1C1：酒红实心顶条 + 左上白框证件照 + 左侧短横标分组列',
    category: 'vip-banner',
    recommendedColor: '#9f1239',
    tags: ['VIP 1:1', '左标卡', '酒红'],
    accentPreview: '#9f1239',
    layoutKind: 'editorial',
    component: VipCrimsonCardTemplate,
  },
  {
    id: 'vip-rose-banner-split',
    name: 'VIP · 玫红横幅灰侧栏',
    subtitle: '1:1 复刻 R1C2：玫红全宽横幅 + 下方左 28% 浅灰全高辅栏与右 72% 主区',
    category: 'vip-sidebar',
    recommendedColor: '#be123c',
    tags: ['VIP 1:1', '横幅+侧栏', '商务'],
    accentPreview: '#be123c',
    layoutKind: 'sidebar-left',
    component: VipRoseBannerSplitTemplate,
  },
  {
    id: 'vip-crimson-dot-minimal',
    name: 'VIP · 绯红微点精致白',
    subtitle: '1:1 复刻 R1C3：左上精致一寸照 + 双行摘要 + 绯红棱点分隔节头',
    category: 'minimal',
    recommendedColor: '#991b1b',
    tags: ['VIP 1:1', '精致白底', '微点节头'],
    accentPreview: '#991b1b',
    layoutKind: 'single',
    component: VipCrimsonDotMinimalTemplate,
  },
  {
    id: 'vip-teal-top-pill',
    name: 'VIP · 青蓝顶饰浅囊风',
    subtitle: '1:1 复刻 R1C4：青蓝顶饰条 + 清爽信息卡片 + 浅青圆角色块节头',
    category: 'vip-banner',
    recommendedColor: '#0e7490',
    tags: ['VIP 1:1', '浅囊节头', '青蓝'],
    accentPreview: '#0e7490',
    layoutKind: 'single',
    component: VipTealTopPillTemplate,
  },
  {
    id: 'wondercv-teal-sidebar',
    name: '超级简历 · 青绿全高侧栏',
    subtitle: '1:1 复刻 WonderCV 青绿双栏：左 26% 联系方式与求职意向分组 + 右 74% 圆底图标章节头',
    category: 'commercial',
    recommendedColor: '#167883',
    tags: ['WonderCV 1:1', '双栏', '圆底图标'],
    accentPreview: '#167883',
    layoutKind: 'sidebar-left',
    component: WondercvTealSidebarTemplate,
  },
  {
    id: 'wondercv-royal-banner',
    name: '超级简历 · 皇室蓝通栏',
    subtitle: '1:1 复刻 WonderCV 皇室蓝顶部全宽横幅 + 三行紧凑竖线分隔 + 圆底图标正文',
    category: 'commercial',
    recommendedColor: '#2859b6',
    tags: ['WonderCV 1:1', '横幅头', '商务'],
    accentPreview: '#2859b6',
    layoutKind: 'banner',
    component: WondercvRoyalBannerTemplate,
  },

  // =========================================================================
  // 商业延展 / 教师考编 / 大厂极简 / 现代双栏 / 科研学术 (28 套)
  // =========================================================================
  {
    id: 'wondercv-clean-pro',
    name: '超级简历 · 极简白底旗舰',
    subtitle: '纯白高级纸面配居中大姓名、双行紧凑信息条与圆底图标章节头',
    category: 'commercial',
    recommendedColor: '#1e3a5f',
    tags: ['白底爆款', '高通用', '圆底图标'],
    accentPreview: '#1e3a5f',
    layoutKind: 'single',
    component: WondercvCleanProTemplate,
  },
  {
    id: 'wondercv-diagonal-hero',
    name: '超级简历 · 斜切几何页眉',
    subtitle: '斜切主题色页眉配悬浮圆角信息卡片，兼顾视觉冲击力与正文阅读效率',
    category: 'commercial',
    recommendedColor: '#0f4c81',
    tags: ['斜切页眉', '现代', '吸睛'],
    accentPreview: '#0f4c81',
    layoutKind: 'banner',
    component: WondercvDiagonalHeroTemplate,
  },
  {
    id: 'wondercv-soft-right',
    name: '超级简历 · 柔雅右辅栏',
    subtitle: '左 68% 主履历 + 右 32% 柔浅青底个人资料栏，打印省墨且高级耐看',
    category: 'commercial',
    recommendedColor: '#167883',
    tags: ['省墨双栏', '右辅栏', '圆底图标'],
    accentPreview: '#167883',
    layoutKind: 'sidebar-right',
    component: WondercvSoftRightTemplate,
  },
  {
    id: 'wondercv-mint-card',
    name: '超级简历 · 浅青名片卡',
    subtitle: '顶部柔浅圆角名片盒 + 胶囊标签基础信息 + 醒目胶囊章节标题',
    category: 'commercial',
    recommendedColor: '#0d9488',
    tags: ['名片头', '胶囊标签', '清爽'],
    accentPreview: '#0d9488',
    layoutKind: 'single',
    component: WondercvMintCardTemplate,
  },
  {
    id: 'left-right',
    name: '经典左竖线',
    subtitle: '条理清晰，适合教师、教研与常规岗位投递',
    category: 'teacher',
    recommendedColor: '#1e293b',
    tags: ['单栏', '经典', '高通用'],
    accentPreview: '#1e293b',
    layoutKind: 'single',
    component: LeftRightTemplate,
  },
  {
    id: 'teacher-table-classic',
    name: '传统档案表格简历',
    subtitle: '国内公办教师/编内常规细线框个人信息表格 + 一寸照表头 + 居中个人简历大字',
    category: 'teacher',
    recommendedColor: '#1e3a5f',
    tags: ['表格式', '考编教师', '稳重'],
    accentPreview: '#1e3a5f',
    layoutKind: 'single',
    component: TeacherTableClassicTemplate,
  },
  {
    id: 'edu-navy-ribbon',
    name: '学院折角丝带风',
    subtitle: '折角主题色丝带章节标题配稳重页眉，公办重点中学面试优选',
    category: 'teacher',
    recommendedColor: '#1e3a5f',
    tags: ['折角丝带', '师范教育', '端庄'],
    accentPreview: '#1e3a5f',
    layoutKind: 'single',
    component: EduNavyRibbonTemplate,
  },
  {
    id: 'red-header-formal',
    name: '端庄双线公办抬头',
    subtitle: '顶部粗细双实线公办档案风抬头，适合国企、事业单位与教师编',
    category: 'teacher',
    recommendedColor: '#881337',
    tags: ['双线抬头', '公办风', '酒红'],
    accentPreview: '#881337',
    layoutKind: 'single',
    component: RedHeaderFormalTemplate,
  },
  {
    id: 'double-line-scholar',
    name: 'Typst 双实线学者',
    subtitle: '复刻 Chinese-Resume-in-Typst 上下双实线包夹章节头 + 精细右对齐',
    category: 'teacher',
    recommendedColor: '#111827',
    tags: ['Typst 复刻', '双实线', '清晰'],
    accentPreview: '#111827',
    layoutKind: 'single',
    component: DoubleLineScholarTemplate,
  },
  {
    id: 'compact-badge',
    name: '紧凑徽章双修风',
    subtitle: '基础标签徽章化呈现，适合教研与 AI 技术复合型岗位',
    category: 'teacher',
    recommendedColor: '#1e293b',
    tags: ['徽章', '紧凑', '复合岗'],
    accentPreview: '#1e293b',
    layoutKind: 'single',
    component: CompactBadgeTemplate,
  },
  {
    id: 'minimal-ats',
    name: '极简高密度 ATS',
    subtitle: '零冗余装饰的单色紧凑排版，单页内容承载量最高',
    category: 'minimal',
    recommendedColor: '#111827',
    tags: ['高密度', '极简', '机读友好'],
    accentPreview: '#111827',
    layoutKind: 'single',
    component: MinimalAtsTemplate,
  },
  {
    id: 'lapis-clean',
    name: 'LapisCV 青金石单栏',
    subtitle: '高 ATS 友好青金石排印：左侧青金石小色块章节头 + 贯穿细线 + 等宽右对齐日期',
    category: 'minimal',
    recommendedColor: '#2b547e',
    tags: ['LapisCV', '单栏 ATS', '青金石'],
    accentPreview: '#2b547e',
    layoutKind: 'single',
    component: LapisCleanTemplate,
  },
  {
    id: 'jakes-resume-cn',
    name: "Jake's Resume 中文版",
    subtitle: '1:1 复刻大厂神板 Jake’s Resume：超大居中姓名 + 竖线隔断 + 全宽细底线',
    category: 'minimal',
    recommendedColor: '#111827',
    tags: ['开源神板', '大厂 ATS', '高密度'],
    accentPreview: '#111827',
    layoutKind: 'single',
    component: JakesResumeCnTemplate,
  },
  {
    id: 'rendercv-classic',
    name: 'RenderCV Classic',
    subtitle: '1:1 复刻 RenderCV Classic：蓝灰精致标题 + 斜体岗位/学位副标',
    category: 'minimal',
    recommendedColor: '#0f4c81',
    tags: ['RenderCV', '蓝灰精致', '单栏'],
    accentPreview: '#0f4c81',
    layoutKind: 'single',
    component: RendercvClassicTemplate,
  },
  {
    id: 'rendercv-sb2nov',
    name: 'RenderCV sb2nov',
    subtitle: '1:1 复刻 RenderCV sb2nov：浅灰底块左粗竖线标题，单页承载量极高',
    category: 'minimal',
    recommendedColor: '#1e293b',
    tags: ['sb2nov', '极紧凑', '块状标题'],
    accentPreview: '#1e293b',
    layoutKind: 'single',
    component: RendercvSb2novTemplate,
  },
  {
    id: 'chicv-minimal',
    name: 'ChiCV 短横线极简',
    subtitle: '1:1 复刻 skyzh/chicv：短横线前缀章节头 + 斜杠分隔现代页眉',
    category: 'minimal',
    recommendedColor: '#334155',
    tags: ['ChiCV', '短横线', '极简'],
    accentPreview: '#334155',
    layoutKind: 'single',
    component: ChicvMinimalTemplate,
  },
  {
    id: 'json-paper-clean',
    name: 'JSON Paper 报刊风',
    subtitle: '1:1 复刻 jsonresume-theme-paper：上下实线页眉 + 细左边框正文缩进',
    category: 'minimal',
    recommendedColor: '#334155',
    tags: ['Paper', '纸媒双线', '干练'],
    accentPreview: '#334155',
    layoutKind: 'single',
    component: JsonPaperCleanTemplate,
  },
  {
    id: 'sidebar-left',
    name: '左栏深色侧边栏',
    subtitle: '左 32% 深色基础信息与技能栏，右 68% 核心履历主栏',
    category: 'sidebar',
    recommendedColor: '#1e293b',
    tags: ['双栏', '侧边栏', '高对比'],
    accentPreview: '#1e293b',
    layoutKind: 'sidebar-left',
    component: SidebarLeftTemplate,
  },
  {
    id: 'sidebar-right',
    name: '右栏清爽双栏',
    subtitle: '主经历居中左侧展开，右侧浅灰栏展示资质与荣誉',
    category: 'sidebar',
    recommendedColor: '#334155',
    tags: ['双栏', '右辅栏', '清爽'],
    accentPreview: '#334155',
    layoutKind: 'sidebar-right',
    component: SidebarRightTemplate,
  },
  {
    id: 'rx-azurill',
    name: 'Reactive Azurill 蔚蓝时间栏',
    subtitle: '1:1 复刻 Azurill：左上圆形头像 + 左侧浅色框技能 + 右侧时间轴经历',
    category: 'sidebar',
    recommendedColor: '#0f4c81',
    tags: ['Reactive 1:1', '圆头像', '时间轴'],
    accentPreview: '#0f4c81',
    layoutKind: 'sidebar-left',
    component: RxAzurillTemplate,
  },
  {
    id: 'rx-chikorita',
    name: 'Reactive Chikorita 右深栏',
    subtitle: '1:1 复刻 Chikorita：右侧主题深色窄栏 + 左侧大字粗体主履历',
    category: 'sidebar',
    recommendedColor: '#166534',
    tags: ['Reactive 1:1', '右深栏', '墨绿'],
    accentPreview: '#166534',
    layoutKind: 'sidebar-right',
    component: RxChikoritaTemplate,
  },
  {
    id: 'rx-ditto-card',
    name: 'Reactive Ditto 悬浮名片',
    subtitle: '1:1 复刻 Ditto：顶部主题色悬浮圆角名片 + 左侧胶囊标签章节头',
    category: 'sidebar',
    recommendedColor: '#4c1d95',
    tags: ['Reactive 1:1', '悬浮名片', '胶囊标签'],
    accentPreview: '#4c1d95',
    layoutKind: 'editorial',
    component: RxDittoCardTemplate,
  },
  {
    id: 'json-macchiato',
    name: 'Macchiato 暖象牙目录风',
    subtitle: '1:1 复刻 jsonresume-macchiato：象牙暖白纸感 + 左侧目录导航列',
    category: 'sidebar',
    recommendedColor: '#7c2d12',
    tags: ['Macchiato', '象牙白', '目录列'],
    accentPreview: '#7c2d12',
    layoutKind: 'editorial',
    component: JsonMacchiatoTemplate,
  },
  {
    id: 'classic-serif',
    name: '学院典雅衬线',
    subtitle: '居中庄重排头与衬线标题，契合重点中学与高校风格',
    category: 'academic',
    recommendedColor: '#0f4c81',
    tags: ['单栏', '学术风', '衬线'],
    accentPreview: '#0f4c81',
    layoutKind: 'single',
    component: ClassicSerifTemplate,
  },
  {
    id: 'timeline-focus',
    name: '时间轴叙事',
    subtitle: '教育与项目履历带垂直时间轴圆点，发展脉络一目了然',
    category: 'academic',
    recommendedColor: '#14532d',
    tags: ['时间轴', '叙事', '条理'],
    accentPreview: '#14532d',
    layoutKind: 'timeline',
    component: TimelineFocusTemplate,
  },
  {
    id: 'editorial-accent',
    name: '杂志左侧标签列',
    subtitle: '22% 左栏固定展示模块大标题，右栏垂直对齐细节内容',
    category: 'academic',
    recommendedColor: '#7c2d12',
    tags: ['杂志风', '双列标签', '易扫读'],
    accentPreview: '#7c2d12',
    layoutKind: 'editorial',
    component: EditorialAccentTemplate,
  },
  {
    id: 'grid-card',
    name: '模块化双列网格',
    subtitle: '主要经历独立卡片化，技能、荣誉与兴趣双列紧凑排布',
    category: 'academic',
    recommendedColor: '#0f4c81',
    tags: ['网格', '卡片', '双列'],
    accentPreview: '#0f4c81',
    layoutKind: 'grid',
    component: GridCardTemplate,
  },
  {
    id: 'awesome-cv-modern',
    name: 'Awesome-CV 双色经典',
    subtitle: '1:1 复刻 Awesome-CV：灰黑双色拼接大姓名 + 章节前 3 字主题色高亮',
    category: 'academic',
    recommendedColor: '#881337',
    tags: ['Awesome-CV', '双色姓名', '科研'],
    accentPreview: '#881337',
    layoutKind: 'single',
    component: AwesomeCvModernTemplate,
  },
  {
    id: 'harvard-academic',
    name: 'Harvard 学术规范',
    subtitle: '1:1 复刻 RenderCV Harvard：纯正学术 CV 排印规范，高校/重点中学首选',
    category: 'academic',
    recommendedColor: '#111827',
    tags: ['Harvard', '学术规范', '衬线'],
    accentPreview: '#111827',
    layoutKind: 'single',
    component: HarvardAcademicTemplate,
  },
  {
    id: 'modern-deedy',
    name: 'Deedy 非对称双栏',
    subtitle: '1:1 复刻 Deedy-Resume：白底极细竖线非对称 33/67 双栏，大厂校招与高密经历优选',
    category: 'academic',
    recommendedColor: '#1e3a5f',
    tags: ['Deedy', '非对称双栏', '工程校招'],
    accentPreview: '#1e3a5f',
    layoutKind: 'editorial',
    component: ModernDeedyTemplate,
  },
];

// All registry consumers (preview, gallery and native PDF/PNG) get the same
// non-mutating visibility boundary, including documents imported from JSON.
export const TEMPLATE_REGISTRY: TemplateMetadata[] = RAW_TEMPLATE_REGISTRY.map(meta => {
  const Template = meta.component;
  return {...meta, component: function VisibleTemplate({document}: ResumeTemplateProps) {
    return createElement(Template, {document: projectVisibleResume(document)});
  }};
});

export function getTemplateMetadata(id: TemplateId): TemplateMetadata {
  return TEMPLATE_REGISTRY.find((t) => t.id === id) ?? TEMPLATE_REGISTRY[0]!;
}
