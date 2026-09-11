#import "common.typ": *
#let render(data) = {
  set page(paper:"a4", margin:(left:20mm,right:54mm,top:17mm,bottom:17mm), fill:white, footer:foot("T02 · Margin Fieldnotes"))
  set text(font:serif,lang:"zh",size:9.3pt,fill:ink)
  set par(leading:.74em)
  text(8pt,font:sans,weight:"bold",fill:teal)[#get(data,"section")]
  v(5pt); text(23pt,weight:"bold",fill:ink)[#get(data,"title")]
  v(4pt); tagrow(data)
  v(10pt); block(stroke:(left:2pt+teal), inset:(left:10pt,y:4pt))[#text(9.6pt)[#get(data,"context")]]
  place(right + top, dx:39mm, dy:47mm, box(width:38mm)[
    #label(fill:teal)[MARGIN · #l(data,"path")] #v(5pt)
    #stack(dir:ttb,spacing:5pt,..get(data,"path").enumerate().map(((i,x))=>[#text(8pt,font:sans,weight:"semibold",fill:navy)[#(i+1). #x]]))
    #v(11pt); #label(fill:berry)[MARGIN · #l(data,"warnings")] #v(5pt)
    #stack(dir:ttb,spacing:5pt,..get(data,"warnings").map(x=>[#text(7.7pt,font:sans,fill:muted)[• #x]]))
  ])
  v(13pt); label[#l(data,"points")]; v(6pt)
  for (i,p) in get(data,"points").enumerate() {
    text(8pt,font:sans,weight:"bold",fill:teal)[#(i+1)]
    h(8pt)
    text(9.2pt)[#p]
    v(9pt)
  }
  pagebreak(); text(18pt,weight:"bold")[#l(data,"next") + " / SECOND PASS"]; v(8pt)
  for (i,q) in get(data,"next").enumerate() {
    text(7.6pt,font:sans,weight:"bold",fill:teal)[ITEM #(i+1)]
    v(3pt); text(10pt,weight:"semibold")[#q]; v(8pt); rule(); v(7pt)
    for _ in range(3) { rule(color: hair, thick: .5pt); v(7pt) }
    v(10pt)
  }
  place(right + top, dx:39mm, dy:25mm, box(width:38mm)[
    #label[#l(data,"review")] #v(5pt)
    #text(8pt,font:sans,fill:muted)[#get(data,"review_prompt",default:"先独立复述，再对照关键路径检查遗漏。")]
  ])
}
