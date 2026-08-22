#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4",margin:(x:14mm,top:14mm,bottom:15mm),fill:rgb("#F4F6F5"),footer:foot("T04 · Bento Modular"))
#set text(font:sans,lang:"zh",size:8.8pt,fill:ink)
#grid(columns:(1.2fr,.8fr),gutter:9pt,
 block(fill:navy,radius:10pt,inset:13pt)[#text(7.2pt,weight:"bold",fill:white.transparentize(18%))[#sample-section] #v(7pt) #text(19pt,weight:"bold",fill:white)[#sample-question] #v(8pt) #pill(sample-id,fill:white.transparentize(88%),fg:white)],
 block(fill:cream,radius:10pt,inset:12pt)[#label(fill:warm)[#practice-title] #v(7pt) #text(9pt,weight:"semibold")[#practice-instruction] #v(9pt) #flow-row(accent:warm,fill:white)]
)
#v(9pt)
#grid(columns:(1fr,1fr),gutter:9pt,
 block(fill:white,radius:9pt,inset:11pt)[#label[#label-context] #v(6pt) #text(8.8pt)[#sample-intent]],
 block(fill:mint,radius:9pt,inset:11pt)[#label(fill:teal)[#label-points] #v(6pt) #stack(dir:ttb,spacing:5pt,..sample-points.enumerate().map(((i,x))=>[#text(8.4pt)[#(i+1). #x]]))]
)
#v(9pt)
#grid(columns:(1.15fr,.85fr),gutter:9pt,
 block(fill:sky,radius:9pt,inset:11pt)[#label(fill:blue2)[#label-next] #v(6pt) #stack(dir:ttb,spacing:7pt,..sample-followups.map(x=>[#text(8.6pt)[• #x]]))],
 block(fill:blush,radius:9pt,inset:11pt)[#label(fill:berry)[#label-warnings] #v(6pt) #stack(dir:ttb,spacing:7pt,..sample-redflags.map(x=>[#text(8.5pt)[• #x]]))]
)
#pagebreak()
#text(18pt,weight:"bold",fill:navy)[#label-review + "面板"]
#v(8pt)
#grid(columns:(1fr,1fr),gutter:9pt,
 block(fill:white,radius:9pt,inset:12pt,height:92mm)[#label[#practice-response-title] #v(8pt) #for _ in range(9){ rule(); v(8pt) }],
 block(fill:white,radius:9pt,inset:12pt,height:92mm)[#label[漏点检查] #v(8pt) #stack(dir:ttb,spacing:9pt,..sample-skeleton.map(x=>[#text(8.6pt)[□ 是否讲清“#x”？]]))]
)
