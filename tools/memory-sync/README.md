# memory-sync

Delta-pushes Code's memory `.md` files to the **Code Memory Store** in Notion via the REST
API, instead of round-tripping large bodies through the MCP tool layer (the VIP marts entry
is ~19K chars — well past comfortable).

```bash
node push-memory.mjs <file.md> [more.md ...]          # dry run
node push-memory.mjs <file.md> --write                # apply
```

Reads `NOTION_TOKEN` from `stb-exec-console/.env` (the STB Executive Console integration,
which is shared into the memory store).

## Two traps this encodes

1. **The Notion REST API needs DATABASE ids, not the `collection://` data-source ids** that
   the MCP tools hand out. Code Memory Store database id is
   `77fca85d-f6ef-426d-8451-5d2e05b37b80`; its data source is
   `3252204e-561d-47d5-82b8-6521ed678d43`. Passing the latter to `/databases/{id}/query`
   returns a 404 that reads like a permissions error and isn't.
2. **`rich_text` caps at 2000 chars per object.** Long bodies must be chunked or the write
   is silently truncated. This chunks at 1900.

Refuses to push an empty body over a non-empty row — the failure mode that emptied a memory
file on 2026-07-22.

Does not manage the `.last-push` sentinel; `/pause` owns that.
