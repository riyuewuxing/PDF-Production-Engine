#import "common.typ": *
#let render(data) = {
  set page(paper:"a4", margin:(x:22mm, top:19mm, bottom:18mm), fill:paper, footer:foot("T01 · Editorial Serif"))
  set text(font:serif, lang:"zh", size:9.5pt, fill:ink)
  set par(leading:.72em, spacing:.35em)
  align(center)[#text(7.5pt, font:sans, weight:"bold", fill:warm, tracking:.12em)[EDITORIAL NOTE]]
  v(7mm)
  text(26pt, weight:"bold", fill:navy)[#get(data,"title")]
  v(4pt)
  text(9pt, font:sans, fill:muted)[#get(data,"section") · #get(data,"id")]
  v(8pt); rule(color:warm, thick:1.4pt); v(12pt)
  grid(columns:(0.30fr,0.70fr), gutter:14pt,
    [#label[#l(data,"context")] #v(5pt) #text(8.2pt,font:sans,fill:muted)[先识别这部分内容承担的作用，再用关键路径组织阅读。]],
    [#text(10.4pt)[#get(data,"context")]]
  )
  v(13pt); label(fill:warm)[#l(data,"path")]; v(6pt); flow-row(get(data,"path"),accent:warm,fill:cream)
  v(14pt); label[#l(data,"points")]; v(7pt); bullet-list(get(data,"points"),size:9.2pt,accent:navy)
  pagebreak()
  align(center)[#text(8pt,font:sans,weight:"bold",fill:warm)[REVIEW / SECOND PASS]]
  v(7mm)
  grid(columns:(1.15fr,.85fr),gutter:16pt,
    [#text(18pt,weight:"bold",fill:navy)[#l(data,"next")] #v(7pt)
     #stack(dir:ttb,spacing:8pt,..get(data,"next").map(x=>block(fill:soft,inset:10pt,radius:4pt)[#text(9.2pt)[#x]]))],
    [#text(14pt,weight:"bold",fill:berry)[#l(data,"warnings")] #v(7pt)
     #stack(dir:ttb,spacing:7pt,..get(data,"warnings").map(x=>[#text(8.8pt)[• #x]]))]
  )
  v(14mm); label[#l(data,"workspace")]; v(5pt)
  for _ in range(5) { rule(); v(7pt) }
  v(11pt)
  grid(columns:(auto,auto,auto,auto,1fr),gutter:12pt,
    ..generic-checks(data).map(x=>text(8pt,font:sans,fill:muted)[□ #x]), [])
}
