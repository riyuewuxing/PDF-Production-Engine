#import "common.typ": *
#let render(data) = {
  set page(paper:"a4",margin:(left:18mm,right:18mm,top:16mm,bottom:16mm),fill:rgb("#FAFBFC"),footer:foot("T08 · Modern Manual"))
  set text(font:sans,lang:"zh",size:8.9pt,fill:ink)
  grid(columns:(5pt,1fr),gutter:11pt,
    block(fill:teal,radius:3pt,height:245mm),
    [
      #label(fill:teal)[MANUAL / #get(data,"section")]
      #v(5pt); #text(22pt,weight:"bold",fill:navy)[#get(data,"title")]
      #v(5pt)#text(7.6pt,fill:muted)[#get(data,"id") · #get(data,"duration")]
      #v(11pt)
      #block(fill:white,stroke:.7pt+hair,radius:5pt,inset:10pt)[#label[#l(data,"context")] #v(5pt) #text(8.8pt)[#get(data,"context")]]
      #v(10pt); #label(fill:teal)[#l(data,"path")]; #v(6pt)#flow-row(get(data,"path"),accent:teal,fill:mint)
      #v(12pt); #label[#l(data,"points")]; #v(6pt); #bullet-list(get(data,"points"),size:8.7pt,accent:teal)
      #v(11pt)
      #grid(columns:(1fr,1fr),gutter:8pt,
        block(fill:sky,radius:5pt,inset:9pt)[#label(fill:blue2)[#l(data,"next")] #v(5pt) #stack(dir:ttb,spacing:6pt,..get(data,"next").map(x=>[#text(8.2pt)[• #x]]))],
        block(fill:blush,radius:5pt,inset:9pt)[#label(fill:berry)[#l(data,"warnings")] #v(5pt) #stack(dir:ttb,spacing:6pt,..get(data,"warnings").map(x=>[#text(8.2pt)[• #x]]))]
      )
    ]
  )
  pagebreak(); label(fill:teal)[WORKSPACE]; v(5pt); text(18pt,weight:"bold",fill:navy)[把内容变成自己的版本]; v(10pt)
  table(columns:(34mm,1fr),stroke:.6pt+hair,inset:8pt,
    [#label[节点]],[#label[#l(data,"workspace")]],
    ..get(data,"path").map(s=>([#text(8.4pt,weight:"semibold")[#s]],[#v(10mm)] )).flatten()
  )
}
