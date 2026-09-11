#import "common.typ": *
#let render(data) = {
  set page(paper:"a4",margin:(x:15mm,top:14mm,bottom:15mm),fill:paper,footer:foot("T06 · Studio Workbook"))
  set text(font:sans,lang:"zh",size:8.9pt,fill:ink)
  grid(columns:(1fr,auto),align:top,
    [#label(fill:teal)[PRACTICE STUDIO] #v(5pt) #text(20pt,weight:"bold",fill:navy)[#get(data,"title")]],
    pill(get(data,"duration"),fill:mint,fg:teal)
  )
  v(8pt)
  block(fill:white,stroke:1pt+navy,radius:6pt,inset:10pt)[
    #label[第一遍 · 独立完成] #v(6pt)
    #text(8pt,fill:muted)[#get(data,"practice_instruction",default:"先独立完成，再对照提示卡检查遗漏。")]
    #v(6pt); #grid(columns:(1fr,1fr,1fr,1fr),gutter:6pt,..range(4).map(i=>box(height:15mm,stroke:.7pt+hair,radius:4pt)))
  ]
  v(10pt)
  grid(columns:(.42fr,.58fr),gutter:10pt,
    block(fill:cream,radius:6pt,inset:10pt)[#label(fill:warm)[#l(data,"cues")] #v(6pt) #stack(dir:ttb,spacing:7pt,..get(data,"path").map(x=>pill(x,fill:white,fg:warm)))],
    block(fill:white,stroke:.7pt+hair,radius:6pt,inset:10pt)[#label[#l(data,"points")] #v(6pt) #stack(dir:ttb,spacing:6pt,..get(data,"points").enumerate().map(((i,x))=>[#text(8.5pt)[#(i+1). #x]]))]
  )
  v(10pt)
  block(fill:blush,radius:6pt,inset:10pt)[#label(fill:berry)[#l(data,"warnings") + " · 自查"] #v(6pt) #grid(columns:(1fr,1fr),gutter:10pt,..get(data,"warnings").map(x=>[#text(8.3pt)[□ #x]]))]
  pagebreak(); label(fill:teal)[SECOND PASS]; v(5pt); text(18pt,weight:"bold",fill:navy)[#l(data,"next") + " · " + #l(data,"practice")]; v(8pt)
  for (i,q) in get(data,"next").enumerate(){
    block(fill:white,stroke:.7pt+hair,radius:6pt,inset:10pt)[#text(8pt,weight:"bold",fill:teal)[ITEM #(i+1)] #v(4pt) #text(9.5pt,weight:"semibold")[#q] #v(7pt) #for _ in range(4){ rule(); v(7pt) }]
    v(10pt)
  }
}
