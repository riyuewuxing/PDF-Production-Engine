# Generic Visual Base Library v1

Ten reusable Typst visual base templates for arbitrary normalized content.

## Contract

Every template exports:

`render(data)`

The input is a neutral dictionary described by `content-contract.yaml`. Templates do not know about a business repository, job-search domain, interview type, school subject, candidate identity, or any private source.

Required slots: `id`, `section`, `code`, `level`, `duration`, `title`, `context`, `path`, `points`, `next`, and `warnings`.

Optional slots include `checks`, `labels`, `practice_instruction`, `summary_prompt`, and `review_prompt`.

## Acceptance and random selection

All ten initial templates are retained. They begin as `PENDING_USER_ACCEPTANCE` and are not eligible for random selection.

The first random pool activates only after T01-T10 are all user accepted. After that, selection is uniform across accepted templates. Future T11+ templates are additive and join only after their own user acceptance.

Machine build/preflight is not visual acceptance. A template can compile successfully and still remain outside the pool.

## Privacy / repository boundary

This public library stores only generic template code and a neutral synthetic example. Private project content is supplied by the ChatGPT/session staging layer and is never committed here.
