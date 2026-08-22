#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4", margin:(left:20mm,right:54mm,top:17mm,bottom:17mm), fill:white, footer:foot("T02 · Margin Fieldnotes"))
#set text(font:serif,lang:"zh",size:9.3pt,fill:ink)
#set par(leading:.74em)
#text(8pt,font:sans,weight:"bold",fill:teal)[#sample-section]
#v(5pt)
#text(23pt,weight:"bold",fill:ink)[#sample-question]
#v(4pt)
#tagrow()
#v(10pt)
#block(stroke:(left:2pt+teal), inset:(left:10pt,y:4pt))[#text(9.6pt)[#sample-intent]]
#place(right + top, dx:39mm, dy:47mm, box(width:38mm)[
  #label(fill:teal)[MARGIN · #label-path]
  #v(5pt)
  #stack(dir:ttb,spacing:5pt,..sample-skeleton.enumerate().map(((i,x))=>[#text(8pt,font:sans,weight:"semibold",fill:navy)[#(i+1). #x]]))
  #v(11pt)
  #label(fill:berry)[MARGIN · #label-warnings]
  #v(5pt)
  #stack(dir:ttb,spacing:5pt,..sample-redflags.map(x=>[#text(7.7pt,font:sans,fill:muted)[• #x]]))
])
#v(13pt)
#label[#label-points]
#v(6pt)
#for (i,p) in sample-points.enumerate() {
  text(8pt,font:sans,weight:"bold",fill:teal)[#(i+1)]
  h(8pt)
  text(9.2pt)[#p]
  v(9pt)
}
#pagebreak()
#text(18pt,weight:"bold")[#label-next + " / SECOND PASS"]
#v(8pt)
#for (i,q) in sample-followups.enumerate() {
  text(7.6pt,font:sans,weight:"bold",fill:teal)[FOLLOW-UP #(i+1)]
  v(3pt)
  text(10pt,weight:"semibold")[#q]
  v(8pt)
  rule()
  v(7pt)
  for _ in range(3) { rule(color: hair, thick: .5pt); v(7pt) }
  v(10pt)
}
#place(right + top, dx:39mm, dy:25mm, box(width:38mm)[
  #label[复盘提示]
  #v(5pt)
  #text(8pt,font:sans,fill:muted)[先不看参考答案；只用“判断—证据—动作—边界/验证”复述一遍。]
])
