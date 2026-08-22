#import "common.typ": *
#import "samples/sample-data.typ": *
#set page(paper:"a4",margin:(x:16mm,top:15mm,bottom:16mm),fill:paper,footer:foot("T03 · Cornell Study"))
#set text(font:sans,lang:"zh",size:9pt,fill:ink)
#text(7.5pt,weight:"bold",fill:teal)[CORNELL STUDY SHEET]
#v(5pt)
#text(20pt,weight:"bold",fill:navy)[#sample-question]
#v(5pt)
#tagrow()
#v(10pt)
#grid(columns:(.29fr,.71fr),gutter:0pt,
  block(fill:cream,inset:10pt,height:158mm)[
    #label(fill:warm)[CUES / 线索]
    #v(7pt)
    #for s in sample-skeleton { text(9pt,weight:"semibold",fill:navy)[• #s]; v(8pt) }
    #v(7pt)
    #label(fill:berry)[#label-warnings]
    #v(5pt)
    #for r in sample-redflags { text(7.8pt,fill:muted)[• #r]; v(6pt) }
  ],
  block(fill:white,stroke:.7pt+hair,inset:11pt,height:158mm)[
    #label[NOTES / 主要内容]
    #v(6pt)
    #text(8.8pt,fill:muted)[#sample-intent]
    #v(9pt)
    #bullet-list(sample-points,size:8.8pt,accent:teal)
    #v(11pt)
    #label(fill:teal)[我的补充]
    #v(5pt)
    #for _ in range(4) { rule(); v(8pt) }
  ]
)
#v(8pt)
#block(fill:mint,inset:9pt,radius:4pt)[#label(fill:teal)[SUMMARY / #label-summary] #v(4pt) #text(8.8pt)[请用一句自己的话重述本题的核心判断，并写出最关键的一个证据。]]
#pagebreak()
#text(18pt,weight:"bold",fill:navy)[主动回忆页]
#v(8pt)
#for (i,q) in sample-followups.enumerate() {
 label[#practice-followup-prefix #(i+1)]
 v(3pt)
 text(10pt,weight:"semibold")[#q]
 v(5pt)
 for _ in range(5){ rule(); v(7pt) }
 v(7pt)
}
