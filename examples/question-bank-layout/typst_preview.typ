#set document(title: "教师答辩题库版式原型", author: "PDF Production Engine")
#set page(paper: "a4", margin: (x: 17mm, top: 16mm, bottom: 16mm), footer: context [#text(size: 7pt, fill: rgb("667085"))[教师答辩题库 · Layout Prototype] #h(1fr) #counter(page).display()])
#set text(font: "Noto Sans CJK SC", lang: "zh", size: 9.2pt, fill: rgb("172033"))
#set par(leading: 0.6em, justify: false)
#set heading(numbering: none)
#show heading.where(level: 1): it => block(above: 1.4em, below: 0.8em, breakable: false)[#text(size: 16pt, weight: "bold")[#it.body]]

#let ink = rgb("172033")
#let muted = rgb("667085")
#let paper = rgb("F7F8FA")
#let line = rgb("D8DEE9")
#let d1 = rgb("315E8A")
#let d4 = rgb("7A5C2E")
#let d7 = rgb("6B4F7E")

#let badge(body, stroke: line) = box(inset: (x: 5pt, y: 3pt), radius: 2pt, fill: paper, stroke: 0.6pt + stroke)[#text(size: 7.4pt, weight: "bold", fill: muted)[#body]]
#let row(label, body, fill: white) = grid(columns: (25mm, 1fr), gutter: 0pt,
  rect(fill: paper, inset: 6pt, stroke: (bottom: 0.35pt + line))[#text(size: 7.5pt, weight: "bold", fill: muted)[#label]],
  rect(fill: fill, inset: 6pt, stroke: (bottom: 0.35pt + line))[#body],
)
#let card(code, cat, tier, question, skeleton, answer, followups, warnings, accent: d1) = block(breakable: false, below: 4mm)[
  #grid(columns: (auto, auto, auto), gutter: 3pt, badge(code, stroke: accent), badge(cat, stroke: accent), badge(tier, stroke: accent))
  #v(1.2mm)
  #rect(stroke: 0.7pt + accent, radius: 2pt, inset: 0pt)[
    #row([考官问], text(size: 11.2pt, weight: "bold")[#question])
    #row([30秒骨架], skeleton)
    #row([参考口语], answer)
    #row([继续追问], text(size: 8pt, fill: muted)[#followups])
    #row([失分警报], text(size: 8pt, fill: muted)[#warnings])
  ]
]

#align(center)[
  #text(size: 22pt, weight: "bold")[教师答辩题库版式原型]
  #v(4mm)
  #text(size: 9.5pt, fill: muted)[目标：题目是视觉中心；同源支持详解 / 训练 / 速记；分类色只做导航；长文档保持目录、书签和稳定分页。]
]
#v(8mm)
= 目录
#outline(title: none, depth: 1)

= 教学设计与学情
#text(size: 8pt, fill: muted)[翻页原则：不强制每题一页；完整题卡尽量不拆；章节标题与首卡保持可见连续。]
#v(3mm)
#card("Q018", "D1 教材定位", "核心", [为什么这节课要放在这个知识位置，而不是更早或更晚？], [课题位置 → 前置基础 → 本节作用 → 后续迁移], [先说明本节在知识结构中的位置，再用前置知识和后续任务解释教材安排。不要只复述目录，要指出学生在这里需要完成的认知跨越。], [如果课时被压缩，你保留什么？；这一定位如何影响你的教学重点？], [只说“承上启下”但没有具体承什么、启什么。], accent: d1)
#card("Q041", "D4 学情生成", "核心", [学生连续两次答不出你的核心问题，你会怎么调整？], [判断卡点 → 降低台阶 → 给证据/表征 → 再验证], [先判断是概念、表征还是任务负荷造成卡顿，再缩小问题跨度或增加可观察证据。调整后必须再次让学生输出，确认不是教师替学生完成思考。], [如果仍然答不出呢？；怎样避免把课堂变成教师自问自答？], [“我会耐心引导”没有具体动作。], accent: d4)
#card("Q086", "D4 学情生成", "高频", [学生给出一个你没有预设但正确的方法，你怎么办？], [先验证 → 让学生表达 → 比较方法 → 回扣目标], [先确认方法在条件和逻辑上成立，再让学生说明关键步骤；随后与预设方法比较适用范围和认知价值，最后回扣本课目标，而不是为了走教案把正确生成压掉。], [如果这个方法太超纲呢？；如果其他学生听不懂呢？], [表面表扬后立刻忽略学生方法。], accent: d4)
#card("Q101", "D1 教材定位", "训练", [如果只能保留本课一个核心学习结果，你会保留什么？为什么？], [目标筛选 → 核心概念/方法 → 证据 → 舍弃边界], [选择能够支撑后续学习且可以在课堂内观察到的核心结果，并说明判断依据。答案要体现课程结构，而不是简单说“保留重点”。], [你删掉的内容以后在哪里补？], [用“因为它最重要”循环论证。], accent: d1)

= 高中物理专业答辩
#text(size: 8pt, fill: muted)[D7 不做物理教材复述，只做“准确概念/结论 → 条件/边界 → 典型误区 → 教学转化”。]
#v(3mm)
#card("Q067", "D7 学科专业", "高频", [为什么动能定理写的是合外力总功，而不是某一个力做的功？], [系统边界 → 功与动能变化 → 各力功求和 → 典型误区], [动能变化对应研究对象所受各力做功的代数和。单个力的功只能描述该力对能量变化的贡献，除非其他力不做功或其功可以忽略，不能直接等同于总动能变化。], [重力做功与重力势能变化是什么关系？；学生把“合力的功”理解成“合力大小乘位移”怎么办？], [忽略夹角、路径或研究对象边界。], accent: d7)
#card("Q074", "D7 学科专业", "核心", [速度—时间图像的斜率为什么表示加速度？], [定义 → 图像量 → 区间/瞬时 → 教学转化], [图像斜率本质是速度变化量与时间变化量之比，与平均加速度定义一致；当时间间隔趋近于零时对应瞬时加速度。教学中还要强调坐标轴单位和斜率正负。], [曲线某点的斜率怎么解释？；斜率为零是否意味着物体静止？], [把“斜率为零”和“速度为零”混为一谈。], accent: d7)
