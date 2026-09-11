#import "common.typ": *
#let render(data) = {
  set page(paper:"a4",margin:(x:16mm,top:15mm,bottom:16mm),fill:paper,footer:foot("T03 · Cornell Study"))
  set text(font:sans,lang:"zh",size:9pt,fill:ink)
  text(7.5pt,weight:"bold",fill:teal)[CORNELL STUDY SHEET]
  v(5pt); text(20pt,weight:"bold",fill:navy)[#get(data,"title")]
  v(5pt); tagrow(data); v(10pt)
  grid(columns:(.29fr,.71fr),gutter:0pt,
    block(fill:cream,inset:10pt,height:158mm)[
      #label(fill:warm)[CUES / #l(data,"cues")] #v(7pt)
      #for s in get(data,"path") { text(9pt,weight:"semibold",fill:navy)[• #s]; v(8pt) }
      #v(7pt); #label(fill:berry)[#l(data,"warnings")] #v(5pt)
      #for r in get(data,"warnings") { text(7.8pt,fill:muted)[• #r]; v(6pt) }
    ],
    block(fill:white,stroke:.7pt+hair,inset:11pt,height:158mm)[
      #label[NOTES / #l(data,"notes")] #v(6pt)
      #text(8.8pt,fill:muted)[#get(data,"context")] #v(9pt)
      #bullet-list(get(data,"points"),size:8.8pt,accent:teal)
      #v(11pt); #label(fill:teal)[#l(data,"workspace")] #v(5pt)
      #for _ in range(4) { rule(); v(8pt) }
    ]
  )
  v(8pt)
  block(fill:mint,inset:9pt,radius:4pt)[#label(fill:teal)[SUMMARY / #l(data,"summary")] #v(4pt) #text(8.8pt)[#get(data,"summary_prompt",default:"请用一句自己的话总结核心内容，并写下最关键依据。")]]
  pagebreak(); text(18pt,weight:"bold",fill:navy)[主动回忆页]; v(8pt)
  for (i,q) in get(data,"next").enumerate() {
    label[ITEM #(i+1)]
    v(3pt)
    text(10pt,weight:"semibold")[#q]
    v(5pt)
    for _ in range(5){ rule(); v(7pt) }
    v(7pt)
  }
}
