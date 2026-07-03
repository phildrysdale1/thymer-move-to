# Changelog

## v1.1.0 — 2026-07-03

- New **Top of page** placement: picking a destination page with content now offers *Top of page*, *Bottom of page* (still the default on Enter), and its headings. Empty pages skip the extra step.
- Fixed: moving several lines to an *empty* destination (an empty page, an empty heading section) placed them in reverse order. Single-line moves and destinations with content were unaffected.

## v1.0.1 — 2026-07-02

- Fixed page search: results are now ranked by how well the title matches (exact > starts-with > word boundary > contains), so a page named exactly what you typed comes first.
- Just-created pages are found immediately (pages are now also scanned directly by name; the workspace search index lags behind).
- Page results raised from 6 to 8.

## v1.0.0 — 2026-07-02

- Move the caret line, a whole block (parent + children), or a multi-line selection to another destination with a floating picker anchored at the selection.
- Destinations: today's Journal (default), any page (bottom or under a chosen heading), or any individual line — found with a fast search where `+` requires every word to match.
- Indent toggle: nest the moved content under the chosen heading/line, or place it directly after as a sibling. The choice persists.
- Scope toggle when the caret line has children: move the whole block, or only the line itself (its children stay, promoted one level).
- Content is moved, not copied as text — references, dates, tags and the whole subtree structure survive intact.
- Configurable shortcut (default `Cmd+Shift+M` / `Ctrl+Shift+M`) via the "Move To: Set Shortcut" command.
- Toast with an **Open** button that jumps to the moved content.
- Guards: refuses to move a block into itself, and refuses selections spanning multiple pages.
