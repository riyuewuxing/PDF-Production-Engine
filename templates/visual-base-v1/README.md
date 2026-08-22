# Generic Visual Base Template Library v1

Status: **CANDIDATE / PENDING USER ACCEPTANCE**.

This library contains 10 generic Typst base styles. They are visual systems, not business-content templates. Content enters through a replaceable data contract (`samples/sample-data.typ` in the neutral example). Labels are data-driven, so the same base style can be used for interview notes, lesson plans, structured-interview material, self-introduction workbooks, manuals, reference sheets, or other text-heavy learning PDFs.

## Selection rule

- All 10 templates remain in the library.
- None enters the random production pool until the user accepts it.
- After all 10 are accepted, default selection is uniform random among accepted base templates unless the content contract excludes a layout family.
- Future templates are append-only candidates and require the same visual review before joining the random pool.

## Content slots

The current generic adapter exposes: section/code/id/meta, title/prompt, context, key path, main points, next questions, warnings, workspace/review labels, and practice instructions. Different products may remap these labels without editing template code.

## External inspiration

Visual principles were studied from Typst Universe and note/handout traditions including: appunti, non-boring-notes, simple-handout, justwhitee-notes, min-manual, marge/marginalia, exm, knowledge-key, ori, and Cornell/Tufte-style note layouts. No third-party template source is vendored here; these files are original implementations using those layout ideas as references.
