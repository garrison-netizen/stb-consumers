# STB Design System

The Spindletap navy + brass + cream house style, in one place.

**The one rule: a color, font or radius changes HERE and nowhere else.** A value
edited inside an app's own stylesheet is a fork, not a fix. Everything in this
folder exists so that "make it consistent" is a mechanism rather than a habit.

Established 2026-07-31, from the treatment approved on the Email Channel Working
Review (Johnnyo Design sync).

---

## What's in here

| File | What it is |
|---|---|
| `stb-tokens.css` | **The source of truth.** Colors, type stacks, radii, shadows. |
| `stb-document.css` | The **document** treatment — reports and notices. Needs the tokens. |
| `stb-tokens.json` | Machine-readable mirror, for feeding a Tailwind theme config. |
| `assets/stb-logo-on-dark.png` | Wordmark for navy/dark grounds (brass script). 620px, cropped. |
| `assets/stb-logo-on-light.png` | Wordmark for cream/white grounds (navy script). |
| `assets/stb-logo-mark.png` | The mark on its own. |
| `assets/stb-logo-on-dark.datauri.txt` | The same wordmark as an inline data URI, for artifacts. |

The source logos in `stb-private-event-calculator/public/` are 1500×1500 with the
artwork floating in a band of transparent padding. Dropped in raw they throw off
every layout they touch. The copies here are cropped tight and downscaled to
620px — roughly 3× the size they're ever displayed at, so they stay sharp without
carrying a needless 50 KB.

---

## Two treatments, one set of tokens

This is the part that makes the standard usable. A report and an application are
not the same surface, and forcing one to look like the other produces either an
unreadable document or a console that is tiring to work in.

**Document** — reports, notices, reviews, anything read top to bottom, often
printed, sometimes handed to an outside party. Single column, generous measure,
tight 3px radii, committed to one cream identity with **no dark variant** so it
looks the same on every screen in a meeting room and the same again on paper.
Use `stb-document.css`.

**Application** — the Console, the Master Calendar, the Private Event Calculator.
Dense, sticky chrome, soft 12px radii, interactive states. These already share
the tokens; they do not use `stb-document.css`.

What they share: navy masthead with a brass rule under it, cream page ground,
white cards, Montserrat display over Inter body, the same brass and the same
navy. A report and the Console read as the same organization without pretending
to be the same kind of thing.

### Dark mode

There isn't one, anywhere, on purpose. The Console and the Calendar have always
set `body { background: var(--cream) }` with no dark variant, and the document
treatment now matches. One identity, one set of screenshots, one thing to check.

---

## Using it

**In an app.** Each app is its own GitHub repo, built independently by Vercel
from its own checkout — so a relative `@import` reaching across into
`stb-consumers` **will not work**. That folder does not exist on the build
machine, and the build fails or silently drops the import.

So the apps carry a **vendored copy** of the token block, and the job is keeping
the copies in step. Today that is done by hand, deliberately: the token names
here are identical to the ones the apps already use (`--navy-900`,
`--brass-500`, `--cream`, `--ink`, `--muted`, `--line`, `--ok`/`--warn`/`--bad`),
so syncing one is replacing a block, never a rename.

The durable fix is a sync step, matching the mechanism `/refresh` already uses to
self-heal the command files out of `stb-consumers/claude-commands` — copy the
canonical block into each app repo on refresh, so drift is corrected on every
machine automatically. Not built yet; it is the next piece of this.

Until it exists, treat a change here as a change that needs pushing outward by
hand, and say so in the commit that makes it.

**In a report or notice** — paste both files inline in a `<style>` block, and
embed the logo from `stb-logo-on-dark.datauri.txt`.

Published artifacts and emailed HTML run under a strict policy that blocks every
external host: no CDN stylesheets, no Google Fonts, no remote images. That is why
the font stacks in `stb-tokens.css` name Montserrat and Inter *first* but fall
through to system faces — the apps load the webfonts and get them, documents
don't and degrade cleanly without a layout shift.

---

## The brass rule

**Brass is a color you draw with, not a color you write in.**

Correct: the 3px rule under a navy header, chart bars, dots, borders, display
numerals at 24px and up.

Wrong: captions, labels, body copy, small print. Measured against the cream
ground, `--brass-500` sits at 2.1:1 and `--brass-600` at 3.11:1, both under the
4.5:1 floor for normal text. Brass text is a defect no matter how good it looks
on your monitor.

Full measured contrast table is in the comments at the bottom of
`stb-tokens.css`.

---

## Evidence grades

`stb-document.css` carries a small system worth using deliberately:
`.grade-confirmed` (brass stripe), `.grade-refined` (navy stripe) and
`.grade-open` (dashed grey) mark how well a claim is actually known.

Every grade is **also labelled in words** inside `.grade-tag`. That label is not
decorative and not optional. It is what keeps the distinction alive when the page
is printed in black and white, and what stops somebody's unverified impression
from hardening into a finding on its way into a meeting. If you use the stripes,
use the labels.

---

## State of adoption, 2026-07-31

Audited when this folder was created, so the starting point is on the record.

| Surface | State |
|---|---|
| STB Console | On-brand. `--muted` contrast fix applied 2026-07-31 (`6ad3ebf`). Still a vendored copy. |
| Master Calendar | On-brand. `--muted` contrast fix applied 2026-07-31 (`a6168b8`). Still a vendored copy. |
| Private Event Calculator | On-brand via an inline Tailwind config. No `--muted` token, so unaffected by that fix. |
| Email Channel Review | Built on this treatment. First adopter. |
| `close-automation.html` | **Was off-brand** — fixed 2026-07-31. |
| `eula.html` | **Was off-brand** — fixed 2026-07-31. |
| `privacy.html` | **Was off-brand** — fixed 2026-07-31. |

**Two things the audit turned up:**

**1. The notice pages had drifted badly.** The three static pages served out of
the calculator's `public/` folder were using `--navy: #0f2a4a`, `--brass:
#b0893f`, and a cool `#f7f9fc` background — a different navy, a different brass,
and not the house cream. They were not slightly off, they were a separate
palette. Now corrected to the canonical tokens.

**2. `--muted` failed the contrast floor.** The shared secondary-text grey was
`#6d7788`, which measures **4.01:1 against the cream page ground** — under the
4.5:1 minimum for normal text. Since the Console and the Calendar both set the
page ground to cream, every caption and secondary label in those apps has been
sitting below the line. Canonical `--muted` is now `#5f6a71`, which clears it at
4.92:1 while reading as the same grey.

That second one is a live accessibility defect in two production apps. It is
fixed in the tokens but **not yet pulled into the apps** — see below.

---

## Adoption sequence

Deliberately ordered so nothing live changes without being looked at.

1. ~~Notice pages onto canonical tokens~~ — **done 2026-07-31.** They were the
   genuinely broken ones.
2. ~~`--muted` contrast fix into the Calendar and Console~~ — **done
   2026-07-31.** Both built and deployed. This was the only live defect the
   apps were actually carrying.
3. ~~Adopt the coffee palette as canonical~~ — **done 2026-07-31**, see below.
4. **Every new report and notice** starts from `stb-document.css`. In effect
   immediately; nothing to migrate.
5. **Build the sync step** so the vendored copies stop being hand-maintained.
   This is now the largest remaining gap in the mechanism.
6. **Fix brass-as-text** — five known spots, listed below.
7. **Calculator Tailwind config** fed from `stb-tokens.json` rather than
   hand-typed hexes. Lowest urgency; it has no `--muted` and is on-brand.

### Known remaining defects — brass used as text

Measured 2026-07-31, not yet fixed. All five are `--brass-600` at 3.51:1 on
white (or 2.94:1 on `--brass-100`), against a 4.5:1 floor. Each is a one-token
swap to `--brass-700`, which lands at 5.88:1 / 4.92:1.

| App | Selector | Now | Fixed |
|---|---|---|---|
| Calendar | `.chip-reset` | 3.51 | 5.88 |
| Calendar | `.ce-time` | 3.51 | 5.88 |
| Calendar | `.ei-time` | 3.51 | 5.88 |
| Console | `.section-count.gold` | 2.94 | 4.92 |
| Console | `.item-title-link:hover` | 3.51 | 5.88 |

Deliberately **not** on that list: `.hero-strip h2 .n` in the Console is
`--brass-600` at 3.51 but sits at 19px/800, which qualifies as large text where
the floor is 3:1 — it passes and should be left alone. The brass on the navy top
bars (`--brass-400` at 7.60, `--brass-300` at 9.79) passes comfortably; light
brass on dark navy is the one place brass is unambiguously safe for text.

### A note on how the coffee palette arrived

It was not designed here. It came in from the Master Calendar's Brewery/Coffee
classification on 2026-07-31 and was found during a rebase — the canonical file
did not know a second brand palette existed. It was adopted rather than
reinvented because it was already right: 500 and 700 clear the text floor on
every ground in use, 300 is correctly marks-only, and it sits far enough from
brass (ΔE 16.1–26.0) that the two businesses never read as one.

That is the failure mode this folder exists to prevent, and it still happened on
day one — because the sync in step 5 does not exist yet. Palette work done in an
app repo will keep arriving here late until it does.
