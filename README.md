# Move To

Move To is a [Thymer](https://thymer.com) plugin that moves the line you're on, a whole block (a parent line with all its children), or your entire selection to somewhere else — another page, a new note in a collection, a specific heading on a page, or even a specific line — without cut & paste.

Press the shortcut (default `Cmd+Shift+M` / `Ctrl+Shift+M`) or run **Move to…** from the Command Palette, and a small picker opens right at your selection. Search for the destination, hit Enter, done. The content is *moved*, not re-typed: references, dates, tags and the whole subtree structure survive intact, because it's the same move operation as dragging lines around in the editor.

![Moving a block and a multi-line selection to another page with the Move To picker](assets/move-to-demo.gif)

## Features

- **Three scopes, picked automatically:**
  - a **multi-line selection** moves every selected line (blocks keep their children)
  - a caret on a **parent line** moves the whole block by default — a toggle in the picker header switches to *Line only*, which leaves the children behind (promoted one level)
  - a caret on a plain line just moves that line
- **Destinations:**
  - **Today's Journal** (default, just hit Enter), or type a date (`tomorrow`, `next friday`, `2026-07-20`) to move it into that day's Journal
  - **a new note in any collection** — enter its title, then choose the collection
  - **any page**, at the top, at the bottom, or under a heading you pick from a list
  - **any individual line**, anywhere in the workspace
- **Fast search** over pages and lines, styled like Thymer's own command palette: each result carries its collection's icon, matched words are highlighted, `+` requires several words (`project+monday` matches lines with both), and hovering a line previews its full text.
- **Indent toggle** (bottom left): nest the moved content *under* the chosen heading/line, or place it directly *after* it as a sibling. Your choice is remembered.
- **Keyboard-first:** type to search, `↑↓` to navigate, `↵` to move. A toast with an **Open** button jumps to where the content landed.
- **Safe:** it refuses to move a block into itself, and never touches your content until you pick a destination. Closing the picker (click outside, `×`, or the shortcut again) changes nothing.

## How to use

1. Put the caret on the line you want to move — or select several lines.
2. Press `Cmd+Shift+M` (`Ctrl+Shift+M` on Windows/Linux), or run **Move to…** from the Command Palette.
3. Hit Enter to move it to today's Journal, choose **New note in a collection…** to enter a title and pick its collection, type to search pages and lines, or type a date (like `tomorrow` or `2026-07-20`) to move it into another day's Journal.
   - Picking a page with content shows one more step: *Top of page*, *Bottom of page* (the default on Enter), or a specific heading. Empty pages skip this.
4. The picker header shows what's being moved. If the line has children you can switch between **Whole block** and **Line only** there.
5. Use the indent button (bottom left) to choose between nesting under the target and placing after it.

## Installation

1. In Thymer, open the Command Palette (`Cmd+P` / `Ctrl+P`), run **Plugins**, and click **Create Plugin** under Global Plugins.
2. In the plugin's dialog, go to the code editor (click **Edit as Code** if you see the settings view).
3. In the **Custom Code** tab, replace the contents with [`plugin.js`](plugin.js).
4. In the **Configuration** tab, replace the contents with [`plugin.json`](plugin.json).
5. Click **Save**.

Don't enable Hot Reload — it's a development feature and can leave the plugin in a state where saved data stops persisting.

## Settings

- **Move To: Set Shortcut** (Command Palette) records a new shortcut. Include at least one of `Cmd` / `Ctrl` / `Alt`. Stored locally per device.
- The indent toggle state persists across sessions.

## Notes & limitations

- A selection that spans multiple pages (e.g. across days in the Journal) is refused — select within one page.
- Escape can't close the picker (Thymer captures it before plugins see it); click outside, press the shortcut again, or use the `×`.
- The plugin is fully event-driven: nothing runs while the picker is closed except one keydown check for the shortcut.

## License

MIT
