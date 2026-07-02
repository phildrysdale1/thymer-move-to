# Changelog

## v1.0.0 — 2026-07-02

- Move the caret line, a whole block (parent + children), or a multi-line selection to another destination with a floating picker anchored at the selection.
- Destinations: today's Journal (default), any page (bottom or under a chosen heading), or any individual line — found with a fast search where `+` requires every word to match.
- Indent toggle: nest the moved content under the chosen heading/line, or place it directly after as a sibling. The choice persists.
- Scope toggle when the caret line has children: move the whole block, or only the line itself (its children stay, promoted one level).
- Content is moved, not copied as text — references, dates, tags and the whole subtree structure survive intact.
- Configurable shortcut (default `Cmd+Shift+M` / `Ctrl+Shift+M`) via the "Move To: Set Shortcut" command.
- Toast with an **Open** button that jumps to the moved content.
- Guards: refuses to move a block into itself, and refuses selections spanning multiple pages.
