#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4",margin:(x:15mm,top:14mm,bottom:15mm),fill:paper,footer:foot("T06 · Studio Workbook"))
#set text(font:sans,lang:"zh",size:8.9pt,fill:ink)
#grid(columns:(1fr,auto),align:top,
 [#label(fill:teal)[PRACTICE STUDIO] #v(5pt) #text(20pt,weight:"bold",fill:navy)[#sample-question]],
 pill(str(sample-seconds)+" 秒",fill:mint,fg:teal)
)
#v(8pt)
#block(fill:white,stroke:1pt+navy,radius:6pt,inset:10pt)[
 #label[第一遍 · 不看答案]
 #v(6pt)
 #text(8pt,fill:muted)[#practice-first-pass]
 #v(6pt)
 #grid(columns:(1fr,1fr,1fr,1fr),gutter:6pt,..range(4).map(i=>box(height:15mm,stroke:.7pt+hair,radius:4pt)))
]
#v(10pt)
#grid(columns:(.42fr,.58fr),gutter:10pt,
 block(fill:cream,radius:6pt,inset:10pt)[#label(fill:warm)[提示卡] #v(6pt) #stack(dir:ttb,spacing:7pt,..sample-skeleton.map(x=>pill(x,fill:white,fg:warm)))],
 block(fill:white,stroke:.7pt+hair,radius:6pt,inset:10pt)[#label[#label-points] #v(6pt) #stack(dir:ttb,spacing:6pt,..sample-points.enumerate().map(((i,x))=>[#text(8.5pt)[#(i+1). #x]]))]
)
#v(10pt)
#block(fill:blush,radius:6pt,inset:10pt)[#label(fill:berry)[#label-warnings + " · 自查"] #v(6pt) #grid(columns:(1fr,1fr),gutter:10pt,..sample-redflags.map(x=>[#text(8.3pt)[□ #x]]))]
#pagebreak()
#label(fill:teal)[SECOND PASS]
#v(5pt)
#text(18pt,weight:"bold",fill:navy)[#label-next + " · 训练"]
#v(8pt)
#for (i,q) in sample-followups.enumerate(){
 block(fill:white,stroke:.7pt+hair,radius:6pt,inset:10pt)[#text(8pt,weight:"bold",fill:teal)[#practice-followup-prefix #(i+1)] #v(4pt) #text(9.5pt,weight:"semibold")[#q] #v(7pt) #for _ in range(4){ rule(); v(7pt) }]
 v(10pt)
}
