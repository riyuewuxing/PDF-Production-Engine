#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4",margin:(x:12mm,top:12mm,bottom:13mm),fill:white,footer:foot("T09 · Dense Reference"))
#set text(font:sans,lang:"zh",size:7.9pt,fill:ink)
#grid(columns:(1fr,auto),align:top,
 [#text(16pt,weight:"bold",fill:navy)[#sample-question] #v(3pt) #text(7pt,fill:muted)[#sample-section]],
 pill("速查版",fill:cream,fg:warm)
)
#v(7pt)#rule(color:navy,thick:1.2pt)#v(8pt)
#grid(columns:(1fr,1fr),gutter:10mm,
 [
  #label(fill:teal)[#label-context]
  #v(4pt)#text(8.1pt)[#sample-intent]
  #v(8pt)#label(fill:teal)[#label-path]
  #v(4pt)#stack(dir:ttb,spacing:4pt,..sample-skeleton.enumerate().map(((i,x))=>[#text(7.9pt,weight:"semibold")[#(i+1) → #x]]))
  #v(8pt)#label[#label-points]
  #v(4pt)#stack(dir:ttb,spacing:5pt,..sample-points.enumerate().map(((i,x))=>[#text(8pt)[#(i+1). #x]]))
 ],
 [
  #label(fill:blue2)[#label-next]
  #v(4pt)#stack(dir:ttb,spacing:7pt,..sample-followups.map(x=>block(fill:sky,radius:4pt,inset:7pt)[#text(7.9pt)[#x]]))
  #v(9pt)#label(fill:berry)[#label-warnings]
  #v(4pt)#stack(dir:ttb,spacing:7pt,..sample-redflags.map(x=>block(fill:blush,radius:4pt,inset:7pt)[#text(7.9pt)[#x]]))
  #v(10pt)#label[快速自检]
  #v(5pt)#stack(dir:ttb,spacing:6pt,..sample-skeleton.map(x=>[#text(7.8pt,fill:muted)[□ #x]]))
 ]
)
#pagebreak()
#text(15pt,weight:"bold",fill:navy)[一页训练卡]
#v(8pt)
#grid(columns:(1fr,1fr),gutter:8pt,
 block(stroke:.7pt+hair,radius:5pt,inset:9pt,height:92mm)[#label[#practice-sheet-title]#v(6pt)#for _ in range(9){ rule(); v(8pt) }],
 block(stroke:.7pt+hair,radius:5pt,inset:9pt,height:92mm)[#label[关键词复盘]#v(6pt)#for s in sample-skeleton { text(8.2pt,weight:"semibold",fill:teal)[□ #s]; v(8pt) }]
)
