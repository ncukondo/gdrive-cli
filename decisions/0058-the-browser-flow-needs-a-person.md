# 0058: The browser flow is refused where nobody can finish it

Date: 2026-09-02
Status: accepted — extends [0005](0005-auth-and-scopes.md) step 3

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

Measuring that turned up something the documentation got wrong. Nothing in this
CLI opens a browser: `startOAuthFlow` returns a URL and the caller prints it.
`docs/authentication.md` §3 has claimed since v0.1.0 that `gdrive` "opens your
browser to Google's consent page". It does not, and never did.

## Decision

### 1. The flow needs a person reading stdout, and that is a tty

What the flow actually requires is someone who can read a URL, open it
somewhere, consent, and let the redirect come back. The only part of that this
process can observe is whether it is attached to a terminal, so that is the
test: `gdrive auth` refuses with `AUTH_REQUIRED` and exit 2, **before** the
loopback server is opened, when stdin is not a tty.

### 2. Nothing probes for a browser

A printed URL is finishable from a browser on another machine, which is the
ordinary way this command is used over SSH. `DISPLAY`, `BROWSER` or a
platform opener would refuse that working case to catch a failing one, and a
false refusal here has no escape hatch — there is no other way to log in. The
tty stands for "a person is here", not "a browser is here", and the refusal
message says which of the two it checked.

### 3. A named `-f json` refuses too, for a second reason

A caller that asked for a machine answer cannot consent, so the same refusal
applies — and the flow was never correct for it anyway. The URL is printed as
prose on stdout ahead of the envelope, so a JSON caller who *did* wait would get
output no JSON parser accepts. Refusing removes both.

The two gates in this command therefore ask the same question and the code says
so once, rather than growing a second predicate that happens to agree today.

### 4. The refusal names what was missing and what to do

Not "cannot authenticate". Either "`gdrive auth` needs a terminal" — with what
to run on a machine that has one, and that the token can then be copied — or
"`-f json` cannot complete the consent flow; re-run without it". The distinction
matters because one of the two is fixed by dropping a flag.

## Consequences

- `gdrive auth` in CI, in a cron entry, or under an agent with no pty now fails
  in a second instead of hanging until something kills it. This is a behaviour
  change to a command that previously never returned, so nothing that worked
  stops working ([0014](0014-pre-1.0-compatibility.md)).
- The working path stays unreachable by the live suite, which runs with no tty
  and no browser ([0043](0043-e2e-runs-before-push.md) §4). Verifying a change
  here means a real terminal and a real consent screen, by hand.
- `docs/authentication.md` §3 loses the sentence about opening a browser. The
  URL it prints is the whole mechanism, and saying so is also what makes §2
  above read as a design choice rather than a limitation.
