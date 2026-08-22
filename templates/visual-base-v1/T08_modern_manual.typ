#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4",margin:(left:18mm,right:18mm,top:16mm,bottom:16mm),fill:rgb("#FAFBFC"),footer:foot("T08 · Modern Manual"))
#set text(font:sans,lang:"zh",size:8.9pt,fill:ink)
#grid(columns:(5pt,1fr),gutter:11pt,
 block(fill:teal,radius:3pt,height:245mm),
 [
 #label(fill:teal)[MANUAL / #sample-section]
 #v(5pt)
 #text(22pt,weight:"bold",fill:navy)[#sample-question]
 #v(5pt)#text(7.6pt,fill:muted)[#sample-id · #sample-seconds 秒]
 #v(11pt)
 #block(fill:white,stroke:.7pt+hair,radius:5pt,inset:10pt)[#label[CONTEXT] #v(5pt) #text(8.8pt)[#sample-intent]]
 #v(10pt)
 #label(fill:teal)[KEY PATH]
 #v(6pt)#flow-row(accent:teal,fill:mint)
 #v(12pt)
 #label[MAIN NOTES]
 #v(6pt)
 #bullet-list(sample-points,size:8.7pt,accent:teal)
 #v(11pt)
 #grid(columns:(1fr,1fr),gutter:8pt,
  block(fill:sky,radius:5pt,inset:9pt)[#label(fill:blue2)[NEXT] #v(5pt) #stack(dir:ttb,spacing:6pt,..sample-followups.map(x=>[#text(8.2pt)[• #x]]))],
  block(fill:blush,radius:5pt,inset:9pt)[#label(fill:berry)[WATCH OUT] #v(5pt) #stack(dir:ttb,spacing:6pt,..sample-redflags.map(x=>[#text(8.2pt)[• #x]]))]
 )
 ]
)
#pagebreak()
#label(fill:teal)[WORKSPACE]
#v(5pt)#text(18pt,weight:"bold",fill:navy)[把原则变成自己的回答]
#v(10pt)
#table(columns:(34mm,1fr),stroke:.6pt+hair,inset:8pt,
 [#label[节点]],[#label[我的内容]],
 ..sample-skeleton.map(s=>([#text(8.4pt,weight:"semibold")[#s]],[#v(10mm)] )).flatten()
)
