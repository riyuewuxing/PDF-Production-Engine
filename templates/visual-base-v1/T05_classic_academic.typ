#import "common.typ": *
#let render(data) = {
  set page(paper:"a4",margin:(x:24mm,top:20mm,bottom:20mm),fill:white,footer:foot("T05 · Classic Academic"))
  set text(font:serif,lang:"zh",size:9.6pt,fill:ink)
  set par(justify:true,leading:.75em)
  align(center)[#text(8pt,font:sans,fill:muted)[#get(data,"section")]]
  v(5pt); align(center)[#text(21pt,weight:"bold")[#get(data,"title")]]
  v(6pt); align(center)[#text(7.5pt,font:sans,fill:muted)[#get(data,"id") · #get(data,"level") · #get(data,"duration")]]
  v(9pt); rule(color:ink,thick:.9pt); v(10pt)
  text(11pt,weight:"bold")[一、#l(data,"context")]; v(4pt); text(9.5pt)[#get(data,"context")]
  v(9pt); text(11pt,weight:"bold")[二、#l(data,"path")]; v(5pt); align(center)[#flow-row(get(data,"path"),accent:ink,fill:soft)]
  v(10pt); text(11pt,weight:"bold")[三、#l(data,"points")]; v(5pt)
  for (i,p) in get(data,"points").enumerate(){ text(9.4pt)[#(i+1). #p]; v(7pt) }
  pagebreak(); text(11pt,weight:"bold")[四、#l(data,"next")]; v(5pt)
  for (i,q) in get(data,"next").enumerate(){ text(9.4pt)[（#(i+1)）#q]; v(8pt) }
  text(11pt,weight:"bold")[五、#l(data,"warnings")]; v(5pt)
  for r in get(data,"warnings") { text(9.4pt)[• #r]; v(7pt) }
  v(13pt); rule(color:ink); v(8pt)
  text(8.6pt,font:sans,fill:muted)[#get(data,"review_prompt",default:"不看原文，用自己的话复述关键路径，再补充遗漏。")]
  v(8pt); for _ in range(5){ rule(); v(8pt) }
}
