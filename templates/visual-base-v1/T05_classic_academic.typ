#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4",margin:(x:24mm,top:20mm,bottom:20mm),fill:white,footer:foot("T05 · Classic Academic"))
#set text(font:serif,lang:"zh",size:9.6pt,fill:ink)
#set par(justify:true,leading:.75em)
#align(center)[#text(8pt,font:sans,fill:muted)[#sample-section]]
#v(5pt)
#align(center)[#text(21pt,weight:"bold")[#sample-question]]
#v(6pt)
#align(center)[#text(7.5pt,font:sans,fill:muted)[#sample-id · #sample-tier · #sample-seconds 秒]]
#v(9pt)
#rule(color:ink,thick:.9pt)
#v(10pt)
#text(11pt,weight:"bold")[一、#label-context]
#v(4pt)
#text(9.5pt)[#sample-intent]
#v(9pt)
#text(11pt,weight:"bold")[二、#label-path]
#v(5pt)
#align(center)[#flow-row(accent:ink,fill:soft)]
#v(10pt)
#text(11pt,weight:"bold")[三、#label-points]
#v(5pt)
#for (i,p) in sample-points.enumerate(){ text(9.4pt)[#(i+1). #p]; v(7pt) }
#pagebreak()
#text(11pt,weight:"bold")[四、#label-next]
#v(5pt)
#for (i,q) in sample-followups.enumerate(){ text(9.4pt)[（#(i+1)）#q]; v(8pt) }
#text(11pt,weight:"bold")[五、#label-warnings]
#v(5pt)
#for r in sample-redflags { text(9.4pt)[• #r]; v(7pt) }
#v(13pt)
#rule(color:ink)
#v(8pt)
#text(8.6pt,font:sans,fill:muted)[#practice-rehearse-note]
#v(8pt)
#for _ in range(5){ rule(); v(8pt) }
