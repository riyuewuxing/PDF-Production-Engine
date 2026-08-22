#import "common.typ": *
#let render(data) = {
  set page(paper:"a4",margin:(left:14mm,right:14mm,top:12mm,bottom:14mm),fill:white,footer:foot("T07 · Atlas Navigation"))
  set text(font:sans,lang:"zh",size:8.8pt,fill:ink)
  grid(columns:(34mm,1fr),gutter:12pt,
    block(fill:navy,radius:7pt,inset:10pt,height:250mm)[
      #text(28pt,weight:"bold",fill:white)[#get(data,"code")]
      #v(7pt)#text(8pt,weight:"bold",fill:white.transparentize(15%))[#get(data,"section")]
      #v(18pt)#label(fill:white.transparentize(20%))[ROUTE]
      #v(6pt)
      #for (i,s) in get(data,"path").enumerate(){ text(8.2pt,weight:"semibold",fill:white)[#(i+1) · #s]; v(8pt) }
      #v(1fr); #text(7pt,fill:white.transparentize(30%))[#get(data,"id")]
    ],
    [
      #label(fill:teal)[ATLAS / CONTENT NAVIGATION]
      #v(5pt); #text(20pt,weight:"bold",fill:navy)[#get(data,"title")]
      #v(6pt)#tagrow(data); #v(10pt)
      #text(8.6pt,fill:muted)[#get(data,"context")]
      #v(12pt)#rule(color:teal,thick:1.2pt)#v(10pt)
      #label[#l(data,"points")]; #v(7pt); #bullet-list(get(data,"points"),size:8.65pt,accent:teal)
      #v(11pt)
      #grid(columns:(1fr,1fr),gutter:10pt,
        block(fill:sky,radius:6pt,inset:9pt)[#label(fill:blue2)[#l(data,"next")] #v(5pt) #stack(dir:ttb,spacing:6pt,..get(data,"next").map(x=>[#text(8.2pt)[• #x]]))],
        block(fill:blush,radius:6pt,inset:9pt)[#label(fill:berry)[#l(data,"warnings")] #v(5pt) #stack(dir:ttb,spacing:6pt,..get(data,"warnings").map(x=>[#text(8.2pt)[• #x]]))]
      )
    ]
  )
  pagebreak(); text(18pt,weight:"bold",fill:navy)[Atlas Review]; v(8pt)
  text(8.5pt,fill:muted)[按关键路径逐格写下自己的内容。]; v(10pt)
  grid(columns:(1fr,1fr),gutter:9pt,
    ..get(data,"path").map(s=>block(height:58mm,stroke:.7pt+hair,radius:6pt,inset:10pt)[#label(fill:teal)[#s] #v(7pt) #for _ in range(5){ rule(); v(8pt) }])
  )
}
