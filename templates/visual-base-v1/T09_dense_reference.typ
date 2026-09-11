#import "common.typ": *
#let render(data) = {
  set page(paper:"a4",margin:(x:12mm,top:12mm,bottom:13mm),fill:white,footer:foot("T09 · Dense Reference"))
  set text(font:sans,lang:"zh",size:7.9pt,fill:ink)
  grid(columns:(1fr,auto),align:top,
    [#text(16pt,weight:"bold",fill:navy)[#get(data,"title")] #v(3pt) #text(7pt,fill:muted)[#get(data,"section")]],
    pill("REFERENCE",fill:cream,fg:warm)
  )
  v(7pt); rule(color:navy,thick:1.2pt); v(8pt)
  grid(columns:(1fr,1fr),gutter:10mm,
    [
      #label(fill:teal)[#l(data,"context")] #v(4pt)#text(8.1pt)[#get(data,"context")]
      #v(8pt)#label(fill:teal)[#l(data,"path")] #v(4pt)#stack(dir:ttb,spacing:4pt,..get(data,"path").enumerate().map(((i,x))=>[#text(7.9pt,weight:"semibold")[#(i+1) → #x]]))
      #v(8pt)#label[#l(data,"points")] #v(4pt)#stack(dir:ttb,spacing:5pt,..get(data,"points").enumerate().map(((i,x))=>[#text(8pt)[#(i+1). #x]]))
    ],
    [
      #label(fill:blue2)[#l(data,"next")] #v(4pt)#stack(dir:ttb,spacing:7pt,..get(data,"next").map(x=>block(fill:sky,radius:4pt,inset:7pt)[#text(7.9pt)[#x]]))
      #v(9pt)#label(fill:berry)[#l(data,"warnings")] #v(4pt)#stack(dir:ttb,spacing:7pt,..get(data,"warnings").map(x=>block(fill:blush,radius:4pt,inset:7pt)[#text(7.9pt)[#x]]))
      #v(10pt)#label[#l(data,"checks")] #v(5pt)#stack(dir:ttb,spacing:6pt,..get(data,"path").map(x=>[#text(7.8pt,fill:muted)[□ #x]]))
    ]
  )
  pagebreak(); text(15pt,weight:"bold",fill:navy)[Reference Practice]; v(8pt)
  grid(columns:(1fr,1fr),gutter:8pt,
    block(stroke:.7pt+hair,radius:5pt,inset:9pt,height:92mm)[#label[#l(data,"response")]#v(6pt)#for _ in range(9){ rule(); v(8pt) }],
    block(stroke:.7pt+hair,radius:5pt,inset:9pt,height:92mm)[#label[#l(data,"review")]#v(6pt)#for s in get(data,"path") { text(8.2pt,weight:"semibold",fill:teal)[□ #s]; v(8pt) }]
  )
}
