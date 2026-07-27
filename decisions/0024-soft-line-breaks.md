# 0024: A soft line break is a Markdown hard break, spelled with a backslash

Date: 2026-07-27
Status: accepted — extends [0021](0021-markdown-writes.md)

## Context

`renderDocument` copies a paragraph's text through unchanged, so the `U+000B`
that Docs uses for a line break *within* a paragraph — what Shift+Enter makes in
the UI — lands in the middle of a Markdown line ([issue #9]):

```console
$ gdrive docs read <doc> | cat -A
\u{30fb}T·line·a␋\u{30fb}T·line·b␋\u{30fb}T·line·c␊
```

Nothing downstream can act on that. It is not a Markdown construct, and a
consumer that splits on `\n` sees one line where the document shows three. The
parser has no reading for it either, so [0021](0021-markdown-writes.md) §2's
round-trip does not hold for any document containing one.

These breaks are ordinary. Measured against Drive's native `text/markdown`
import — 0021 §4's reference — both CommonMark hard-break spellings produce one:

| Markdown source | Native import produces |
|---|---|
| trailing double space | one paragraph, `U+000B` between the lines |
| trailing backslash | one paragraph, `U+000B` between the lines |
| blank line | two paragraphs |
| `<br>` | two paragraphs, plus a stray leading space on the next line |
| nothing | one paragraph, lines joined by a single space |

## Decision

### 1. `read` renders `U+000B` as a hard break, spelled `\`

A line break inside a paragraph becomes a backslash at the end of the line and a
newline, which is CommonMark's hard break. The paragraph stays one paragraph;
only its internal breaks become visible.

Google's own Markdown *export* spells it with a trailing double space instead,
and 0021 §4 usually settles a question like this by deferring to the native
path. It does not here, for two reasons. Trailing whitespace is invisible and is
removed by ordinary handling — editors, formatters, and anything that trims a
line — so a break spelled that way is one an agent can destroy without seeing
it. And Google's exporter appends two trailing spaces to *every* line whether or
not it holds a break, so the spelling carries no signal in the output we would
be copying; there is nothing there to be faithful to.

A backslash survives trimming, is visible in a diff, and is what CommonMark
defines. The deviation is deliberate and is recorded here rather than left to be
rediscovered.

### 2. The parser accepts both spellings and writes `U+000B`

A line ending in `\` or in two or more spaces continues the current block, with
`U+000B` joining the two lines' text. Both are accepted because both are
CommonMark, because the native import honours both, and because input we did not
write is exactly what a permissive parser is for ([0021](0021-markdown-writes.md) §3).

`insertText` takes `U+000B` and produces a real line break — measured: the text
`line a<VT>line b\n` came back as a single paragraph holding
`"line aline b\n"`, and Google's export of it renders as two lines. So the
write side needs no new request type.

### 3. This is the one exception to "one source line is one block"

`markdown-doc.ts` holds one source line to one block, deliberately: `read`
separates blocks with a single newline, so merging soft-wrapped lines the way
CommonMark does would fuse paragraphs that came back apart. That premise stands.
A hard break is the single, explicitly-marked exception to it — the author asked
for a join, in the one syntax that says so — and the header comment says as much
so the next reader does not take the rule as unconditional.

The premise is what makes §1's choice safe: because a bare newline never joins
anything here, the only way to produce a `U+000B` is to ask for one.

### 4. What does not change

A blank line still separates paragraphs, and that stays the only way to get two
paragraphs out of two lines. `<br>` stays what 0021 §3 makes it — raw HTML kept
as its literal source text and reported as unsupported — even though the native
import splits a paragraph on it. Following the import here would mean parsing
HTML to decide which tags are structural, and the stray leading space it leaves
behind is not a result worth reproducing.

## Out of scope (deferred)

- Any other HTML that the native import maps to structure.
- Line breaks inside table cells, which `read` does not emit and Docs models
  differently.
- Normalizing the trailing double spaces Google's exporter adds to every line of
  an exported document; that is `download --export-as md`, not `docs read`.

## Consequences

- `renderDocument` replaces `U+000B` with `` \ `` + newline in a paragraph's
  text, before the block joiner runs, so a break never reaches the output as a
  control character.
- `parseMarkdown` gains a continuation rule ahead of its block dispatch: a
  pending line ending in a hard break defers the block until the run ends.
  Blocks whose text is a run of spans — paragraph, heading, quote, list item —
  all inherit it.
- The 0021 §2 round-trip test covers a paragraph with an internal break, which
  is what keeps §1 and §2 in step.
- `docs/commands.md` says how a line break inside a paragraph is written and
  read, next to the note that a blank line is what makes a new paragraph.

[issue #9]: https://github.com/ncukondo/gdrive-cli/issues/9
