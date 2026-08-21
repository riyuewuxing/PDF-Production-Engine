#!/usr/bin/env python3
from pathlib import Path
import subprocess
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, CondPageBreak, Frame, KeepTogether, PageTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.platypus.tableofcontents import TableOfContents

OUT = Path(__file__).with_name('reportlab-question-bank-preview.pdf')


def first_existing(paths: list[str]) -> str:
    for raw in paths:
        p = Path(raw)
        if p.is_file():
            return str(p)
    raise SystemExit(f'No ReportLab-compatible CJK TTF found in {paths}')


# Noto CJK on Ubuntu is normally a TTC with CFF/PostScript outlines, which ReportLab
# TTFont cannot embed. Use the same standalone AR PL TrueType family already proven by
# production consumer jobs. Typst may continue to use Noto independently.
BODY_FONT = first_existing([
    '/usr/share/fonts/truetype/arphic-gbsn00lp/gbsn00lp.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
])
HEAD_FONT = first_existing([
    '/usr/share/fonts/truetype/arphic-gkai00mp/gkai00mp.ttf',
    BODY_FONT,
])
pdfmetrics.registerFont(TTFont('CN', BODY_FONT))
pdfmetrics.registerFont(TTFont('CNBold', HEAD_FONT))

PALETTE = {
    'ink': colors.HexColor('#172033'),
    'muted': colors.HexColor('#667085'),
    'line': colors.HexColor('#D8DEE9'),
    'paper': colors.HexColor('#F7F8FA'),
    'd1': colors.HexColor('#315E8A'),
    'd4': colors.HexColor('#7A5C2E'),
    'd7': colors.HexColor('#6B4F7E'),
    'warn': colors.HexColor('#8A3E3E'),
}

base = getSampleStyleSheet()
S = {
    'title': ParagraphStyle('title', parent=base['Title'], fontName='CNBold', fontSize=22, leading=29, alignment=TA_CENTER, textColor=PALETTE['ink'], spaceAfter=7*mm),
    'sub': ParagraphStyle('sub', parent=base['BodyText'], fontName='CN', fontSize=9.5, leading=15, alignment=TA_CENTER, textColor=PALETTE['muted'], spaceAfter=10*mm),
    'h1': ParagraphStyle('h1', parent=base['Heading1'], fontName='CNBold', fontSize=16, leading=22, textColor=PALETTE['ink'], spaceBefore=6*mm, spaceAfter=3*mm),
    'body': ParagraphStyle('body', parent=base['BodyText'], fontName='CN', fontSize=9.2, leading=15.2, textColor=PALETTE['ink'], wordWrap='CJK'),
    'small': ParagraphStyle('small', parent=base['BodyText'], fontName='CN', fontSize=7.8, leading=11.5, textColor=PALETTE['muted'], wordWrap='CJK'),
    'q': ParagraphStyle('q', parent=base['BodyText'], fontName='CNBold', fontSize=11.3, leading=17.2, textColor=PALETTE['ink'], wordWrap='CJK'),
    'label': ParagraphStyle('label', parent=base['BodyText'], fontName='CNBold', fontSize=7.6, leading=10.5, textColor=PALETTE['muted']),
}

CARDS = [
    ('Q018', 'D1 教材定位', '核心', '为什么这节课要放在这个知识位置，而不是更早或更晚？', '课题位置 → 前置基础 → 本节作用 → 后续迁移', '先说明本节在知识结构中的位置，再用前置知识和后续任务解释教材安排。不要只复述目录，要指出学生在这里需要完成的认知跨越。', ['如果课时被压缩，你保留什么？', '这一定位如何影响你的教学重点？'], ['只说“承上启下”但没有具体承什么、启什么。']),
    ('Q041', 'D4 学情生成', '核心', '学生连续两次答不出你的核心问题，你会怎么调整？', '判断卡点 → 降低台阶 → 给证据/表征 → 再验证', '先判断是概念、表征还是任务负荷造成卡顿，再缩小问题跨度或增加可观察证据。调整后必须再次让学生输出，确认不是教师替学生完成思考。', ['如果仍然答不出呢？', '怎样避免把课堂变成教师自问自答？'], ['“我会耐心引导”没有具体动作。']),
    ('Q067', 'D7 学科专业', '高频', '为什么动能定理写的是合外力总功，而不是某一个力做的功？', '系统边界 → 功与动能变化 → 各力功求和 → 典型误区', '动能变化对应研究对象所受各力做功的代数和。单个力的功只能描述该力对能量变化的贡献，除非其他力不做功或其功可以忽略，不能直接等同于总动能变化。', ['重力做功与重力势能变化是什么关系？', '学生把“合力的功”理解成“合力大小乘位移”怎么办？'], ['忽略夹角、路径或研究对象边界。']),
    ('Q074', 'D7 学科专业', '核心', '速度—时间图像的斜率为什么表示加速度？', '定义 → 图像量 → 区间/瞬时 → 教学转化', '图像斜率本质是速度变化量与时间变化量之比，与平均加速度定义一致；当时间间隔趋近于零时对应瞬时加速度。教学中还要强调坐标轴单位和斜率正负。', ['曲线某点的斜率怎么解释？', '斜率为零是否意味着物体静止？'], ['把“斜率为零”和“速度为零”混为一谈。']),
    ('Q086', 'D4 学情生成', '高频', '学生给出一个你没有预设但正确的方法，你怎么办？', '先验证 → 让学生表达 → 比较方法 → 回扣目标', '先确认方法在条件和逻辑上成立，再让学生说明关键步骤；随后与预设方法比较适用范围和认知价值，最后回扣本课目标，而不是为了走教案把正确生成压掉。', ['如果这个方法太超纲呢？', '如果其他学生听不懂呢？'], ['表面表扬后立刻忽略学生方法。']),
    ('Q101', 'D1 教材定位', '训练', '如果只能保留本课一个核心学习结果，你会保留什么？为什么？', '目标筛选 → 核心概念/方法 → 证据 → 舍弃边界', '选择能够支撑后续学习且可以在课堂内观察到的核心结果，并说明判断依据。答案要体现课程结构，而不是简单说“保留重点”。', ['你删掉的内容以后在哪里补？'], ['用“因为它最重要”循环论证。']),
]


class Doc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(filename, pagesize=A4, leftMargin=17*mm, rightMargin=17*mm, topMargin=16*mm, bottomMargin=16*mm, title='教师答辩题库版式原型')
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id='normal')
        self.addPageTemplates(PageTemplate(id='main', frames=[frame], onPage=self.footer))
    def footer(self, canvas, doc):
        canvas.saveState(); canvas.setFont('CN', 7.2); canvas.setFillColor(PALETTE['muted'])
        canvas.drawString(self.leftMargin, 8*mm, '教师答辩题库 · Layout Prototype')
        canvas.drawRightString(A4[0]-self.rightMargin, 8*mm, str(doc.page)); canvas.restoreState()
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == 'h1':
            text = flowable.getPlainText(); key = 'h1-%s' % abs(hash(text)); self.canv.bookmarkPage(key); self.canv.addOutlineEntry(text, key, level=0, closed=False)
            self.notify('TOCEntry', (0, text, self.page, key))


def card(code, cat, tier, question, skeleton, answer, followups, warnings):
    accent = PALETTE['d7'] if 'D7' in cat else PALETTE['d4'] if 'D4' in cat else PALETTE['d1']
    meta = Table([[Paragraph(code, S['label']), Paragraph(cat, S['label']), Paragraph(tier, S['label'])]], colWidths=[22*mm, 48*mm, 22*mm], hAlign='LEFT')
    meta.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALETTE['paper']),('BOX',(0,0),(-1,-1),0.6,accent),('INNERGRID',(0,0),(-1,-1),0.3,PALETTE['line']),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
    rows = [
        [Paragraph('考官问', S['label']), Paragraph(question, S['q'])],
        [Paragraph('30秒骨架', S['label']), Paragraph(skeleton, S['body'])],
        [Paragraph('参考口语', S['label']), Paragraph(answer, S['body'])],
        [Paragraph('继续追问', S['label']), Paragraph('；'.join(followups), S['small'])],
        [Paragraph('失分警报', S['label']), Paragraph('；'.join(warnings), S['small'])],
    ]
    table = Table(rows, colWidths=[25*mm, 139*mm], hAlign='LEFT')
    table.setStyle(TableStyle([('BOX',(0,0),(-1,-1),0.7,accent),('INNERGRID',(0,0),(-1,-1),0.35,PALETTE['line']),('BACKGROUND',(0,0),(0,-1),PALETTE['paper']),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    return KeepTogether([meta, Spacer(1,1.2*mm), table, Spacer(1,4*mm)])


story = [Paragraph('教师答辩题库版式原型', S['title']), Paragraph('目标：题目是视觉中心；同源支持详解 / 训练 / 速记；分类色只做导航；长文档保持目录、书签和稳定分页。', S['sub'])]
toc = TableOfContents(); toc.levelStyles=[ParagraphStyle('toc0', fontName='CN', fontSize=9.2, leading=14, leftIndent=0, firstLineIndent=0, textColor=PALETTE['ink'])]
story += [Paragraph('目录', S['h1']), toc, Spacer(1,6*mm)]
for idx, section in enumerate([('教学设计与学情', CARDS[:2]+CARDS[4:]), ('高中物理专业答辩', CARDS[2:4])]):
    story.append(CondPageBreak(55*mm)); story.append(Paragraph(section[0], S['h1']))
    story.append(Paragraph('翻页原则：不强制每题一页；完整题卡尽量不拆；章节标题与首卡保持可见连续。', S['small'])); story.append(Spacer(1,3*mm))
    for c in section[1]: story.append(card(*c))

Doc(str(OUT)).multiBuild(story)
print(OUT)
