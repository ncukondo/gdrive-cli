# 0059: The browser flow needs somebody who can read the URL

Date: 2026-09-02
Status: accepted — extends [0005](0005-auth-and-scopes.md) step 3, [0007](0007-output-and-errors.md)

## Context

`gdrive auth` has two waits in it, and only the first one can be refused.

[0005](0005-auth-and-scopes.md) makes the client credentials promptable and
step 3 makes the login a loopback OAuth flow. `canPrompt` guards the prompt: no
tty on stdin, or a caller who named `-f json`, gets `AUTH_REQUIRED` and exit 2
instead of a process reading input nobody will type. The flow underneath it
passes through no gate at all — it opens an HTTP server on a free port and
blocks on it until Google redirects a browser back.

So a machine with `client_secret.json` already in place sails past the wait that
would have refused it and stops on the one that cannot. `gdrive auth </dev/null`
never returns. The comment above the call already said so, which is the part
worth noticing: the gap was described in the code and left there, because the
review round that produced `canPrompt` was answering "the prompt hangs" rather
than "this command waits for a person twice".

That is [0040](0040-a-review-finding-names-a-class.md) §3's shape, and it is why
the question here is not "what makes the hang stop" but **what the flow needs**.

Measuring that turned up two things the code and the documentation had wrong.

**Nothing here opens a browser.** `startOAuthFlow` returns a URL and the caller
prints it. `docs/authentication.md` §3 has claimed since v0.1.0 that `gdrive`
"opens your browser to Google's consent page". It does not, and never did.

**The two waits are not on the same stream.** The prompt needs stdin, because
somebody has to type into it. The flow needs the URL to be *seen*, and the URL
goes to stdout. Guarding the flow on stdin — the obvious reading of "is anyone
there" — refuses `gdrive auth </dev/null` typed at an interactive shell, where
the URL lands on the terminal and a person finishes it in ten seconds, and
permits `gdrive auth > log` at that same terminal, where the URL lands in a file
and the process blocks for ever. One false refusal and one surviving hang, from
asking the right question about the wrong stream.

## Decision

### 1. The URL is a notice, so it goes to stderr

[0007](0007-output-and-errors.md) puts what a caller *consumes* on stdout and
what a person *reads* on stderr. A consent URL is the second: it is never the
answer to `gdrive auth`, it is the instruction for getting one. It moves, along
with the "no OAuth client configured" notice beside it, and stdout is left
holding the envelope alone.

Two things fall out of that and neither is incidental. `gdrive auth -f json`
used to print prose ahead of its envelope, so its stdout parsed as nothing;
it now parses. And `gdrive auth > token.json` at a terminal used to hang with
the URL in the file — it now works, because the URL is on the terminal.

### 2. The flow's gate is the stream the URL goes to

`gdrive auth` refuses with `AUTH_REQUIRED` and exit 2, **before** the loopback
server is opened, when stderr is not a terminal. That is the closest thing this
process can observe to "somebody will see this URL".

The prompt keeps its own gate, on stdin, because typing is a different question
from reading. Two gates, because two streams — and the failure this record
answers was never *two predicates*, it was one wait with none.

### 3. Nothing probes for a browser

There is no reliable test. `DISPLAY` is unset on a Mac that has Safari;
`BROWSER` is unset almost everywhere; a platform opener that fails silently
answers nothing. And a false refusal here has no escape hatch, because there is
no second way to log in — so the cost of guessing wrong is a machine that cannot
authenticate at all. The terminal stands for "a person is here", which is the
part that is decidable.

### 4. A named `-f json` refuses the flow

A caller that asked for a machine answer cannot consent, and this is the only
signal that separates a person at a terminal from an agent holding a pty — which
is the caller this CLI is designed for and the one most likely to hit the hang.

**This removes an invocation that worked.** `gdrive auth -f json` at a terminal
completed the flow and stored a token; it now exits 2. What it produced was a
consent URL and a JSON envelope interleaved on one stream, so nothing could
parse it, but a person watching it did get logged in.
[0014](0014-pre-1.0-compatibility.md) §2 permits the removal and requires the
release notes to carry it.

### 5. The refusal names which of the two applies

Not "cannot authenticate". Either "`gdrive auth` needs a terminal", with what to
run on a machine that has one and what to carry back, or "`-f json` cannot
complete the consent flow; re-run without it". Only one of the two is fixed by
dropping a flag, and a message that does not say which leaves the caller to
guess. The terminal is named first when both apply, because "drop `-f json`" is
advice that does not work on a machine with no terminal.

## Consequences

- `gdrive auth` in CI, in a cron entry, or under an agent with no pty fails in a
  second instead of hanging until something kills it.
- One working invocation is removed, named in §4, and one broken one is fixed:
  `gdrive auth > file` at a terminal.
- A machine with neither a terminal nor credentials now hears about the terminal
  rather than about the missing OAuth client. Both were true; the terminal is
  the one that cannot be worked around, and the code and exit are unchanged.
- The working path stays unreachable by the live suite, which runs with no tty
  and no browser ([0043](0043-e2e-runs-before-push.md) §4). Verifying a change
  here means a real terminal and a real consent screen, by hand.
- `docs/authentication.md` §3 loses the sentence about opening a browser. Saying
  what the mechanism actually is — a printed URL — is also what makes §3 above
  read as a design choice rather than an omission.
