// @vitest-environment node
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ResumeDocumentSchema } from '../schema/resumeSchema';
import { resumeToMarkdown } from './markdownExporter';
import { buildStandaloneResumeHtml } from './htmlExporter';
import { exportResumeToDocxBuffer } from './docxExporter';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const markers = ['SYNTH_NAME_19', 'SYNTH_ROLE_19', 'sample19@example.invalid', 'SYNTH_CUSTOM_19'] as const;
const photoBuffer = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
function fixture() {
  return ResumeDocumentSchema.parse({
    id: 'synthetic-export-19', title: 'INTERNAL_DOCUMENT_TITLE_19',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    basic: {
      name: markers[0], title: markers[1], email: markers[2], photo: image,
      customFields: [{id: 'custom-field', label: 'Demo', value: markers[3]}],
    },
    menuSections: [
      {id: 'basic', title: 'Basic', order: 0},
      {id: 'experience', title: 'Experience', order: 1},
      {id: 'skills', title: 'Skills', enabled: false, order: 2},
    ],
    experience: [
      {id: 'visible-entry', company: 'VISIBLE_ENTRY_19', description: '- **Synthetic** work'},
      {id: 'hidden-entry', company: 'HIDDEN_ENTRY_19', visible: false},
    ],
    skillContent: 'DISABLED_SKILLS_19',
    globalSettings: {locale: 'en-US', fontFamily: 'kaiti'},
  });
}

function inspectDocx(zip: Buffer) {
  const entries: string[] = [];
  let xml = '';
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const start = nameStart + nameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries.push(name);
    if (name === 'word/document.xml') {
      const payload = zip.subarray(start, start + size);
      xml = (method === 8 ? inflateRawSync(payload) : payload).toString('utf8');
    }
    offset = start + size;
  }
  expect(xml).toContain('<w:document');
  return {xml, media: entries.filter(name => /^word\/media\/.+/.test(name))};
}
async function exportsFor(doc: ReturnType<typeof fixture>) {
  const md = resumeToMarkdown(doc);
  const html = buildStandaloneResumeHtml(doc, {embeddedPhotoDataUrl: image});
  const word = inspectDocx(await exportResumeToDocxBuffer(doc, {photoBuffer, photoType: 'png'}));
  return {md, html, word};
}
describe('portable export visibility with synthetic data', () => {
  it('preserves visible name, role, contact, custom fields and content; includes real DOCX media and selected font', async () => {
    const doc = fixture();
    const before = JSON.stringify(doc);
    const {md, html, word} = await exportsFor(doc);
    for (const rendered of [md, html, word.xml]) {
      for (const marker of [...markers, 'VISIBLE_ENTRY_19']) expect(rendered).toContain(marker);
      for (const marker of ['HIDDEN_ENTRY_19', 'DISABLED_SKILLS_19', 'INTERNAL_DOCUMENT_TITLE_19']) expect(rendered).not.toContain(marker);
    }
    expect(html).toContain(image);
    expect(word.media.length).toBeGreaterThan(0);
    expect(word.xml).toContain('KaiTi');
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('omits hidden name and role from body, HTML title and metadata without dropping other visible fields', async () => {
    const doc = fixture();
    doc.basic.fieldOrder = doc.basic.fieldOrder.map(f => ['name', 'title'].includes(f.key) ? {...f, visible: false} : f);
    const {md, html, word} = await exportsFor(doc);
    for (const rendered of [md, html, word.xml]) {
      expect(rendered).not.toContain(markers[0]);
      expect(rendered).not.toContain(markers[1]);
      expect(rendered).not.toContain('INTERNAL_DOCUMENT_TITLE_19');
      expect(rendered).toContain(markers[2]);
      expect(rendered).toContain('VISIBLE_ENTRY_19');
    }
    expect(word.media.length).toBeGreaterThan(0);
  });
  it('omits all basic fields and portrait when the basic section is disabled, including explicit image options', async () => {
    const doc = fixture();
    doc.menuSections = doc.menuSections.map(s => s.id === 'basic' ? {...s, enabled: false} : s);
    const {md, html, word} = await exportsFor(doc);
    for (const rendered of [md, html, word.xml]) {
      for (const marker of [...markers, 'INTERNAL_DOCUMENT_TITLE_19']) expect(rendered).not.toContain(marker);
      expect(rendered).toContain('VISIBLE_ENTRY_19');
    }
    expect(html).not.toContain(image);
    expect(word.media).toHaveLength(0);
  });
  it('never embeds an explicitly supplied portrait when the photo is hidden', async () => {
    const doc = fixture();
    doc.basic.photoConfig.visible = false;
    const {html, word} = await exportsFor(doc);
    expect(html).not.toContain(image);
    expect(word.media).toHaveLength(0);
    expect(word.xml).toContain(markers[0]);
  });
});
