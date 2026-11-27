import argparse
from docx import Document
from docx.shared import Pt

p=argparse.ArgumentParser()
p.add_argument('--output',required=True)
a=p.parse_args()
doc=Document()
section=doc.sections[0]
section.header.paragraphs[0].text='HEADER_PRIVATE_37'
section.footer.paragraphs[0].text='FOOTER_PRIVATE_37'
doc.add_paragraph('基本信息',style='Heading 1')
doc.add_paragraph('姓名：合成甲')
doc.add_paragraph('邮箱：pack@example.invalid')
doc.add_paragraph('求职意向：高中物理教师')
doc.add_heading('教育经历',level=1)
doc.add_heading('甲示例学院',level=2)
doc.add_paragraph('合成实验课程甲')
doc.add_heading('乙示例学院',level=2)
doc.add_paragraph('合成实验课程乙')
doc.add_heading('论文成果',level=1)
doc.add_paragraph('PACKAGED_UNCLASSIFIED_MARKER_37')
doc.add_heading('专业技能',level=1)
table=doc.add_table(rows=1,cols=2)
table.cell(0,0).text='表格单元甲'
table.cell(0,1).text='表格单元乙'
para=doc.add_paragraph()
run=para.add_run('合成分析能力');run.bold=True;run.font.size=Pt(11)
doc.save(a.output)
