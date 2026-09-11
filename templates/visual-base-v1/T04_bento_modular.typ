#import "common.typ": *
#let render(data) = {
  set page(paper:"a4",margin:(x:14mm,top:14mm,bottom:15mm),fill:rgb("#F4F6F5"),footer:foot("T04 · Bento Modular"))
  set text(font:sans,lang:"zh",size:8.8pt,fill:ink)
  grid(columns:(1.2fr,.8fr),gutter:9pt,
    block(fill:navy,radius:10pt,inset:13pt)[#text(7.2pt,weight:"bold",fill:white.transparentize(18%))[#get(data,"section")] #v(7pt) #text(19pt,weight:"bold",fill:white)[#get(data,"title")] #v(8pt) #pill(get(data,"id"),fill:white.transparentize(88%),fg:white)],
    block(fill:cream,radius:10pt,inset:12pt)[#label(fill:warm)[#l(data,"practice")] #v(7pt) #text(9pt,weight:"semibold")[#get(data,"practice_instruction",default:"先独立完成一遍，再回来看关键路径。")]
      #v(9pt) #flow-row(get(data,"path"),accent:warm,fill:white)]
  )
  v(9pt)
  grid(columns:(1fr,1fr),gutter:9pt,
    block(fill:white,radius:9pt,inset:11pt)[#label[#l(data,"context")] #v(6pt) #text(8.8pt)[#get(data,"context")]],
    block(fill:mint,radius:9pt,inset:11pt)[#label(fill:teal)[#l(data,"points")] #v(6pt) #stack(dir:ttb,spacing:5pt,..get(data,"points").enumerate().map(((i,x))=>[#text(8.4pt)[#(i+1). #x]]))]
  )
  v(9pt)
  grid(columns:(1.15fr,.85fr),gutter:9pt,
    block(fill:sky,radius:9pt,inset:11pt)[#label(fill:blue2)[#l(data,"next")] #v(6pt) #stack(dir:ttb,spacing:7pt,..get(data,"next").map(x=>[#text(8.6pt)[• #x]]))],
    block(fill:blush,radius:9pt,inset:11pt)[#label(fill:berry)[#l(data,"warnings")] #v(6pt) #stack(dir:ttb,spacing:7pt,..get(data,"warnings").map(x=>[#text(8.5pt)[• #x]]))]
  )
  pagebreak(); text(18pt,weight:"bold",fill:navy)[#l(data,"review") + "面板"]; v(8pt)
  grid(columns:(1fr,1fr),gutter:9pt,
    block(fill:white,radius:9pt,inset:12pt,height:92mm)[#label[#l(data,"response")] #v(8pt) #for _ in range(9){ rule(); v(8pt) }],
    block(fill:white,radius:9pt,inset:12pt,height:92mm)[#label[#l(data,"checks")] #v(8pt) #stack(dir:ttb,spacing:9pt,..get(data,"path").map(x=>[#text(8.6pt)[□ #x]]))]
  )
}
