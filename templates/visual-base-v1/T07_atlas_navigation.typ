#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4",margin:(left:14mm,right:14mm,top:12mm,bottom:14mm),fill:white,footer:foot("T07 · Atlas Navigation"))
#set text(font:sans,lang:"zh",size:8.8pt,fill:ink)
#grid(columns:(34mm,1fr),gutter:12pt,
 block(fill:navy,radius:7pt,inset:10pt,height:250mm)[
   #text(28pt,weight:"bold",fill:white)[#sample-code]
   #v(7pt)#text(8pt,weight:"bold",fill:white.transparentize(15%))[#sample-section]
   #v(18pt)#label(fill:white.transparentize(20%))[ROUTE]
   #v(6pt)
   #for (i,s) in sample-skeleton.enumerate(){ text(8.2pt,weight:"semibold",fill:white)[#(i+1) · #s]; v(8pt) }
   #v(1fr)
   #text(7pt,fill:white.transparentize(30%))[#sample-id]
 ],
 [
  #label(fill:teal)[ATLAS / 单题导航]
  #v(5pt)
  #text(20pt,weight:"bold",fill:navy)[#sample-question]
  #v(6pt)#tagrow()
  #v(10pt)
  #text(8.6pt,fill:muted)[#sample-intent]
  #v(12pt)#rule(color:teal,thick:1.2pt)#v(10pt)
  #label[#label-points]
  #v(7pt)
  #bullet-list(sample-points,size:8.65pt,accent:teal)
  #v(11pt)
  #grid(columns:(1fr,1fr),gutter:10pt,
    block(fill:sky,radius:6pt,inset:9pt)[#label(fill:blue2)[#label-next] #v(5pt) #stack(dir:ttb,spacing:6pt,..sample-followups.map(x=>[#text(8.2pt)[• #x]]))],
    block(fill:blush,radius:6pt,inset:9pt)[#label(fill:berry)[#label-warnings] #v(5pt) #stack(dir:ttb,spacing:6pt,..sample-redflags.map(x=>[#text(8.2pt)[• #x]]))]
  )
 ]
)
#pagebreak()
#text(18pt,weight:"bold",fill:navy)[Atlas Review]
#v(8pt)
#text(8.5pt,fill:muted)[把下面四格填满，就算真正掌握本题。]
#v(10pt)
#grid(columns:(1fr,1fr),gutter:9pt,
 ..sample-skeleton.map(s=>block(height:58mm,stroke:.7pt+hair,radius:6pt,inset:10pt)[#label(fill:teal)[#s] #v(7pt) #for _ in range(5){ rule(); v(8pt) }])
)
