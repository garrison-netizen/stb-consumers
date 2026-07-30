---
description: One Cross-Agent Channel pass (read inbound for Code, draft-hold outbound). Wrap in /loop to watch continuously.
---

Do ONE Cross-Agent Channel walk now, per `stb-consumers/CHANNEL-PROTOCOL.md`.

The channel is Notion data source `ecc8ead5-0855-424e-8f2c-33399f28c601`.

## Read BOTH directions — this is not optional

**Query A — inbound.** Rows where `To = Code` AND `Status ∈ {Unread, Acknowledged}`.

**Query B — replies on Code's OWN outbound rows.** Rows where `From = Code`, created in
roughly the last 14 days, where the **`Reply` property is non-empty** OR
`Status ∈ {Acknowledged, Acted on}`. **Read the `Reply` property, not just the Body.**

> ⚠️ **Query B is where the Architect's rulings actually arrive.** He answers by writing
> into the `Reply` property of the row Code sent him and flipping that row's status — he
> often does *not* create a new inbound row. A `To = Code` query structurally cannot see
> those answers. Skipping Query B produced two false "blocked on Architect" reports in one
> session on 2026-07-29, cost Garrison two relay trips he didn't need to make, and forced
> the Architect to send a row titled *"UNBLOCK — you are not blocked on me."*
> **Never report a block without having run Query B in the same turn.**

## Handling

1. If nothing is waiting in either query, say so in one line and stop.
2. Inbound rows (A): acknowledge, do any in-scope work (Code repo / artifacts only — never
   any Brain surface but channel rows), and prepare any reply as a **DRAFT**.
3. Replies (B): report the ruling and treat it as **received** — do not re-ask, and do not
   describe yourself as waiting on it.
4. Present every draft for release (release / edit / decline). Never post to the channel
   without explicit release. Stay within the Doctrine 8 scope ceiling.

## Report format

Always close with explicit ownership lines, never narrative Garrison has to decode:

```
Waiting on Architect: <items, or "nothing">
Waiting on Code:      <items, or "nothing">
Waiting on Garrison:  <items, or "nothing">
```

If nothing is waiting on Garrison, say that outright.

---

This is a single pass. To watch continuously while working, run `/loop /watch`
(model-paced) or `/loop 2m /watch` (every ~2 min); stop it by interrupting or saying "stop".
