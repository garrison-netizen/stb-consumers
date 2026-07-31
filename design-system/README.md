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

**In an app** — import the tokens and delete the local `:root` block:

```css
@import "../../stb-consumers/design-system/stb-tokens.css";
```

The variable names here are deliberately identical to the ones the apps already
use (`--navy-900`, `--brass-500`, `--cream`, `--ink`, `--muted`, `--line`,
`--ok`/`--warn`/`--bad`), so adoption is a deletion, not a rename. No
find-and-replace, no churn.

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
| STB Console | On-brand. Token block matches the calendar exactly, plus `--ok`/`--warn`/`--bad`. Still a private copy. |
| Master Calendar | On-brand. Still a private copy. |
| Private Event Calculator | On-brand via an inline Tailwind config. Still a private copy. |
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

1. ~~Notice pages onto canonical tokens~~ — **done 2026-07-31.** Static, no
   functional risk, and they were the genuinely broken ones.
2. **Master Calendar** — delete its `:root`, import the tokens. Picks up the
   `--muted` contrast fix. Verify the top bar, the grid and the denial screens,
   then deploy.
3. **STB Console** — same, keeping its `--ok`/`--warn`/`--bad` (now in the
   canonical file). Widest surface, so it goes after the calendar has proven the
   import path.
4. **Private Event Calculator** — feed its Tailwind config from
   `stb-tokens.json` instead of the hand-typed hexes in `calculator.html`.
5. **Every new report and notice** — starts from `stb-document.css`. In effect
   immediately; nothing to migrate.

Steps 2–4 are each a small change to a live, gated app, so each one wants its own
verification pass and its own deploy. They are not urgent — those apps are
already on-brand. The only thing genuinely waiting on them is the `--muted`
contrast fix.
