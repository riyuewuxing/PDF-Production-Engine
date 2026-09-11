#let navy = rgb("#173D5B")
#let ink = rgb("#172027")
#let muted = rgb("#64707A")
#let teal = rgb("#2B7A78")
#let warm = rgb("#A26B45")
#let berry = rgb("#7C4B63")
#let olive = rgb("#647354")
#let blue2 = rgb("#3E6F8E")
#let hair = rgb("#D7DEE2")
#let soft = rgb("#F5F7F7")
#let paper = rgb("#FCFCF8")
#let cream = rgb("#F5F1E8")
#let blush = rgb("#F7EFED")
#let mint = rgb("#EDF5F1")
#let sky = rgb("#EDF3F7")

#let sans = "Noto Sans CJK SC"
#let serif = "Noto Serif CJK SC"

#let get(data, key, default: none) = data.at(key, default: default)
#let default-labels = (
  "context": "背景 / Context",
  "path": "关键路径",
  "points": "核心内容",
  "next": "延伸问题",
  "warnings": "注意事项",
  "workspace": "我的记录",
  "summary": "一句总结",
  "review": "复盘",
  "cues": "线索",
  "notes": "主要内容",
  "practice": "练习",
  "response": "我的回答",
  "checks": "快速自检",
)
#let l(data, key) = get(get(data, "labels", default: default-labels), key, default: get(default-labels, key, default: key))
#let foot(label) = context {
  let p = counter(page).get().first()
  grid(columns: (1fr, auto), text(7.3pt, fill: muted)[#label], text(7.3pt, fill: muted)[#p])
}
#let pill(body, fill: sky, fg: navy) = box(fill: fill, radius: 999pt, inset: (x: 6.5pt, y: 2.8pt), text(7.4pt, weight: "semibold", fill: fg)[#body])
#let rule(color: hair, thick: .7pt) = line(length: 100%, stroke: thick + color)
#let label(body, fill: muted) = text(7.2pt, weight: "bold", tracking: .035em, fill: fill)[#body]
#let num(n, body, accent: navy) = grid(columns: (18pt, 1fr), gutter: 7pt, align: top,
  box(width: 18pt, height: 18pt, radius: 50%, fill: accent, inset: 0pt)[#align(center+horizon)[#text(7.3pt, weight: "bold", fill: white)[#n]]], body)
#let bullet-list(items, size: 9pt, accent: navy) = stack(dir: ttb, spacing: 5pt, ..items.enumerate().map(((i,x)) => num(i+1, text(size)[#x], accent: accent)))
#let tagrow(data) = {
  let code = get(data, "code", default: "")
  let level = get(data, "level", default: "")
  let duration = get(data, "duration", default: "")
  grid(columns: (auto, auto, auto, 1fr), gutter: 5pt,
    pill(code), pill(level, fill: cream, fg: warm), pill(duration, fill: mint, fg: teal), [])
}
#let flow-row(items, accent: navy, fill: sky) = {
  let cells = ()
  for (i, s) in items.enumerate() {
    cells.push(box(fill: fill, radius: 4pt, inset: (x: 6pt,y: 4pt), text(8pt, weight: "semibold", fill: accent)[#s]))
    if i < items.len()-1 { cells.push(text(9pt, weight: "bold", fill: accent)[→]) }
  }
  grid(columns: (auto,)*cells.len(), gutter: 4pt, align: horizon, ..cells)
}
#let generic-checks(data) = get(data, "checks", default: ("结构清楚", "信息具体", "有依据", "有边界"))
