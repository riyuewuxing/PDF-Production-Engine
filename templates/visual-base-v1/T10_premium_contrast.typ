#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4",margin:(x:16mm,top:14mm,bottom:15mm),fill:rgb("#F8F7F3"),footer:foot("T10 · Premium Contrast"))
#set text(font:sans,lang:"zh",size:8.9pt,fill:ink)
#block(fill:navy,radius:10pt,inset:14pt)[
 #grid(columns:(1fr,auto),align:top,
  [#text(7.3pt,weight:"bold",fill:white.transparentize(22%))[PREMIUM NOTES · #sample-section] #v(9pt) #text(22pt,weight:"bold",fill:white)[#sample-question]],
  [#text(24pt,weight:"bold",fill:white.transparentize(78%))[#sample-code]]
 )
 #v(10pt)
 #grid(columns:(auto,auto,auto,1fr),gutter:5pt,
   pill(sample-id,fill:white.transparentize(88%),fg:white), pill(sample-tier,fill:white.transparentize(88%),fg:white), pill(str(sample-seconds)+" 秒",fill:white.transparentize(88%),fg:white),[])
]
#v(10pt)
#grid(columns:(.36fr,.64fr),gutter:11pt,
 [#label(fill:warm)[KEY PATH] #v(6pt) #stack(dir:ttb,spacing:6pt,..sample-skeleton.enumerate().map(((i,x))=>block(fill:cream,radius:5pt,inset:8pt)[#text(8.3pt,weight:"semibold",fill:warm)[0#(i+1)] #v(2pt)#text(8.6pt,weight:"bold",fill:ink)[#x]]))],
 [#label[CONTEXT]#v(6pt)#text(9pt)[#sample-intent]#v(10pt)#rule(color:warm,thick:1pt)#v(9pt)#label[MAIN NOTES]#v(6pt)#bullet-list(sample-points,size:8.65pt,accent:navy)]
)
#v(10pt)
#grid(columns:(1fr,1fr),gutter:9pt,
 block(fill:rgb("#EEF3F5"),radius:7pt,inset:10pt)[#label(fill:blue2)[NEXT]#v(5pt)#stack(dir:ttb,spacing:6pt,..sample-followups.map(x=>[#text(8.3pt)[• #x]]))],
 block(fill:rgb("#F5ECE8"),radius:7pt,inset:10pt)[#label(fill:berry)[WATCH OUT]#v(5pt)#stack(dir:ttb,spacing:6pt,..sample-redflags.map(x=>[#text(8.3pt)[• #x]]))]
)
#pagebreak()
#grid(columns:(.65fr,.35fr),gutter:11pt,
 [#label(fill:warm)[WORKSPACE]#v(5pt)#text(18pt,weight:"bold",fill:navy)[把答案变成自己的话]#v(8pt)#for _ in range(10){ rule(); v(8pt) }],
 [#block(fill:navy,radius:8pt,inset:11pt)[#label(fill:white.transparentize(20%))[FINAL CHECK]#v(7pt)#text(8.6pt,fill:white)[□ 有判断#v(7pt)□ 有证据#v(7pt)□ 有动作#v(7pt)□ 有边界#v(7pt)□ 有再验证]]]
)
