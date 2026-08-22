#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4", margin:(x:22mm, top:19mm, bottom:18mm), fill:paper, footer:foot("T01 · Editorial Serif"))
#set text(font:serif, lang:"zh", size:9.5pt, fill:ink)
#set par(leading:.72em, spacing:.35em)
#align(center)[#text(7.5pt, font:sans, weight:"bold", fill:warm, tracking:.12em)[FIELD NOTE / SAMPLE]]
#v(7mm)
#text(26pt, weight:"bold", fill:navy)[#sample-question]
#v(4pt)
#text(9pt, font:sans, fill:muted)[#sample-section · #sample-id]
#v(8pt)
#rule(color:warm, thick:1.4pt)
#v(12pt)
#grid(columns:(0.30fr,0.70fr), gutter:14pt,
  [#label[#label-context] #v(5pt) #text(8.2pt,font:sans,fill:muted)[先明确本题要验证的能力，再用证据、动作与边界组织答案。]],
  [#text(10.4pt)[#sample-intent]]
)
#v(13pt)
#label(fill:warm)[#label-path]
#v(6pt)
#flow-row(accent:warm,fill:cream)
#v(14pt)
#label[#label-points]
#v(7pt)
#bullet-list(sample-points,size:9.2pt,accent:navy)
#pagebreak()
#align(center)[#text(8pt,font:sans,weight:"bold",fill:warm)[REVIEW / SECOND PASS]]
#v(7mm)
#grid(columns:(1.15fr,.85fr),gutter:16pt,
  [#text(18pt,weight:"bold",fill:navy)[#label-next] #v(7pt)
   #stack(dir:ttb,spacing:8pt,..sample-followups.map(x=>block(fill:soft,inset:10pt,radius:4pt)[#text(9.2pt)[#x]]))],
  [#text(14pt,weight:"bold",fill:berry)[#label-warnings] #v(7pt)
   #stack(dir:ttb,spacing:7pt,..sample-redflags.map(x=>[#text(8.8pt)[• #x]]))]
)
#v(14mm)
#label[#label-workspace]
#v(5pt)
#for _ in range(5) { rule(); v(7pt) }
#v(11pt)
#grid(columns:(auto,auto,auto,auto,1fr),gutter:12pt, text(8pt,font:sans,fill:muted)[□ 结构清楚], text(8pt,font:sans,fill:muted)[□ 有证据], text(8pt,font:sans,fill:muted)[□ 有动作], text(8pt,font:sans,fill:muted)[□ 有边界], [])
