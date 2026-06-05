# shared/ — canonical shared source (copied, not imported)

Apps Script has no npm and no module imports at runtime. Per the Architect's
decision (2026-05-19): each pipeline ships as a **self-contained `.gs` project**
with its own trigger, Script Properties, and execution quota. Shared logic is
**copied** into each pipeline, not bundled.

`notion.gs` is the **canonical master**. The copy in each pipeline
(`pipelines/<name>/src/Shared.gs`) must be byte-identical to this file.

## Propagation checklist (when `notion.gs` changes)

1. Edit `shared/notion.gs` (the master) only.
2. Copy its full contents over each `pipelines/*/src/Shared.gs`.
3. Note the change + affected pipelines in the commit message.
4. Re-run each pipeline's dry-run (`DRY_RUN` Script Property = anything but `0`)
   and confirm no behavior change before clearing `DRY_RUN`.

Revisit the copy model (vs. a build-time bundle) only if the shared surface
grows past ~500 lines. It is currently ~120.
