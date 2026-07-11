/**
 * Move To — move the current line, a whole block (parent + children), or the
 * entire selection (multiple lines/blocks) to another destination.
 *
 * Trigger "Move to…" from the command palette (or the configurable hotkey,
 * default ⌘⇧M / Ctrl+Shift+M) and a floating picker opens at the caret line.
 * Search any page or line as the destination (same picker as Quick Capture:
 * "+" ANDs words, pages offer their headings, the indent toggle nests vs
 * places after). Content is MOVED via the real line-item move — references,
 * dates, tags and the whole subtree survive perfectly.
 *
 * Scope rules:
 *  - a multi-line selection moves every selected top-level line (each with
 *    its subtree)
 *  - a caret on a line with children moves the whole block by default; the
 *    scope toggle switches to "line only" (children are promoted in place)
 *
 * Performance: fully event-driven — one keydown check at idle, everything
 * else runs only while the picker is open and is torn down on close.
 */

const CSS = `
.mv-pop {
	position: fixed; z-index: 99999;
	width: min(640px, 92vw);
	/* the native command palette's elevated surface + typography, so the picker
	 * reads as a first-party popover, theme-following (falls back to the
	 * JS-computed surface when the cmdpal vars aren't present) */
	background: var(--cmdpal-bg-color, var(--mv-surface, var(--app-bg, #26262b)));
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
	font-family: var(--font-mono, inherit);
	border: 1px solid var(--mv-border, rgba(127,127,127,.4));
	border-radius: var(--radius-larger, 10px);
	box-shadow: var(--mv-shadow, 0 16px 48px rgba(0,0,0,.5)); overflow: hidden;
	font-size: 13px;
}
.mv-head {
	display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px;
	border-bottom: 1px solid rgba(127,127,127,.18); user-select: none;
}
.mv-head .ti { opacity: .7; }
.mv-title { font-weight: 600; opacity: .75; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-x { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; cursor: pointer; opacity: .55; flex: 0 0 auto; }
.mv-x:hover { background: rgba(127,127,127,.18); opacity: 1; }
.mv-scope {
	display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px;
	border-radius: 6px; cursor: pointer; flex: 0 0 auto;
	border: 1px solid rgba(127,127,127,.28); font-size: 11.5px; white-space: nowrap;
	background: var(--ed-button-bg, transparent); color: var(--ed-button-color, var(--text-color, #ddd));
}
.mv-scope:hover { filter: brightness(1.18); }
/* mid accent (500 on dark / 700 on light, set from surface luminance) — matches
   the line-preview highlight; --ed-button-primary-bg (700) was too dark on dark */
.mv-scope.mv-on { color: var(--mv-accent, #3aa37f); border-color: var(--mv-accent, #3aa37f); }
.mv-input {
	width: 100%; box-sizing: border-box; border: none; outline: none;
	padding: 10px 12px; font-size: var(--text-size-small, .875rem); font-family: inherit;
	background: transparent; color: var(--cmdpal-fg-color, var(--text-color, #eee));
	border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2));
}
.mv-list { max-height: 300px; overflow-y: auto; padding-bottom: 8px; }
.mv-opt {
	padding: 5px 10px; cursor: pointer;
	font-size: var(--text-size-small, .875rem); line-height: 16px; font-weight: var(--font-weight-normal, 400);
	display: flex; align-items: center; gap: 8px;
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
}
.mv-opt:hover:not(.mv-active) { background: rgba(127,127,127,.12); }
/* selection = native command-palette selection colours (accent bar); accent is
   reserved for the active row, NOT matched letters (those are just bold) */
.mv-opt.mv-active { background: var(--cmdpal-selected-bg-color, var(--ed-button-primary-bg, #3aa37f)); color: var(--cmdpal-selected-fg-color, #fff); }
.mv-opt.mv-active .ti, .mv-opt.mv-active .mv-opt-sub { color: var(--cmdpal-selected-fg-color, #fff); opacity: .85; }
.mv-opt .ti { opacity: .7; font-size: 14px; flex: 0 0 auto; }
.mv-opt-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* exactly native's match highlight (.autocomplete--hilite): brightest contrast
   colour + bold, so matched letters read crisp against the muted base text */
.mv-opt-text b { color: var(--cmdpal-hilite-color, var(--color-blackwhite-0, #fff)); font-weight: var(--font-weight-bold, 700); }
.mv-opt-sub { opacity: .55; font-size: 11.5px; flex: 0 0 auto; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-sec { padding: 6px 12px 2px; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; opacity: .45; }
.mv-indent-1 { padding-left: 26px; }
.mv-indent-2 { padding-left: 40px; }
.mv-linepreview {
	/* above the picker (99999); appended to <body>, so it needs its own high z */
	position: fixed; z-index: 100002; max-width: 440px; box-sizing: border-box;
	padding: 10px 12px; border-radius: 8px; pointer-events: none;
	background: var(--cmdpal-bg-color, var(--mv-surface, #26262b));
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
	border: 1px solid var(--mv-border, rgba(127,127,127,.4));
	box-shadow: 0 12px 40px rgba(0,0,0,.5);
	font-family: var(--font-mono, inherit); font-size: var(--text-size-small, .875rem); line-height: 1.5;
	max-height: 60vh; overflow-y: auto;
}
.mv-lp-text { white-space: pre-wrap; overflow-wrap: anywhere; }
/* mid accent so the match pops without being harsh: 500 on a dark surface,
   the darker 700 on a light one (set from surface luminance in JS) */
.mv-lp-text b { font-weight: var(--font-weight-bold, 700); color: var(--mv-accent, var(--color-primary-500, #4caea1)); }
.mv-lp-ctx { margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(127,127,127,.2); opacity: .6; font-size: 11.5px; }
.mv-foot {
	display: flex; align-items: center; gap: 8px; padding: 6px 10px;
	border-top: 1px solid rgba(127,127,127,.18); background: rgba(127,127,127,.07);
}
.mv-ibtn {
	display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px;
	border-radius: 6px; cursor: pointer; font-size: 11.5px; white-space: nowrap;
	border: 1px solid rgba(127,127,127,.28);
	background: var(--ed-button-bg, transparent); color: var(--ed-button-color, var(--text-color, #ddd));
}
.mv-ibtn:hover { filter: brightness(1.18); }
/* same accent as the scope toggle + preview highlight: 500 on dark, 700 on light */
.mv-ibtn.mv-on { color: var(--mv-accent, #3aa37f); border-color: var(--mv-accent, #3aa37f); }
.mv-hint { opacity: .5; font-size: 11px; margin-left: auto; }

.mv-settings-backdrop {
	position: fixed; inset: 0; z-index: 100000;
	background: rgba(0,0,0,.45); backdrop-filter: blur(2px);
	display: flex; align-items: center; justify-content: center;
}
.mv-settings {
	width: 380px; max-width: 92vw; box-sizing: border-box; padding: 20px;
	background: var(--mv-surface, #26262b); border: 1px solid var(--mv-border, rgba(127,127,127,.4));
	border-radius: 12px; box-shadow: 0 20px 70px rgba(0,0,0,.55);
	color: var(--ed-button-color, var(--text-color, #ddd)); font-size: 13px;
}
.mv-settings h3 { margin: 0 0 4px; font-size: 15px; }
.mv-settings p { margin: 0 0 14px; font-size: 12px; opacity: .6; line-height: 1.4; }
.mv-keycap {
	display: flex; align-items: center; justify-content: center; gap: 6px;
	min-height: 46px; margin-bottom: 16px; border-radius: 8px;
	border: 1px dashed var(--mv-border, rgba(127,127,127,.5));
	font-size: 17px; font-weight: 700; letter-spacing: 1px;
}
.mv-keycap.mv-armed { border-style: solid; border-color: var(--ed-button-primary-bg, #3aa37f); }
.mv-settings-row { display: flex; gap: 8px; justify-content: flex-end; }
.mv-btn {
	display: inline-flex; align-items: center; gap: 6px;
	height: 30px; padding: 0 12px; border-radius: 7px; cursor: pointer;
	border: 1px solid rgba(127,127,127,.28);
	background: var(--ed-button-bg, transparent);
	color: var(--ed-button-color, var(--text-color, #ddd)); font-size: 13px;
}
.mv-btn:hover { filter: brightness(1.18); }
.mv-primary {
	background: var(--ed-button-primary-bg, #3aa37f) !important; border-color: transparent !important;
	color: #fff; font-weight: 600;
}
`;

function defaultHotkey() {
	const mac = (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || ''))
		|| !!document.querySelector('.is-desktop-mac');
	return { key: 'm', meta: mac, ctrl: !mac, shift: true, alt: false };
}

class Plugin extends AppPlugin {

	/* class fields so a stray onUnload() before onLoad() can't crash */
	cmd = null;
	cmd2 = null;
	popEl = null;
	scope = null;          // { rguid, roots, movedSet, hasChildren, multi, totalLines, anchorNode }
	blockScope = true;     // caret-on-parent: move whole block (true) or line only (false)
	indentUnder = true;    // nest under the chosen heading/line vs place after it (persisted)
	hotkey = null;
	hotkeyHandler = null;
	outsideHandler = null;
	settingsEl = null;
	settingsRec = null;
	searchTimer = null;
	searchToken = 0;
	destOpts = [];
	destSel = 0;
	moving = false;
	collMap = {};           // collection guid -> {name, icon} (built on picker open)
	recordsCache = [];      // all workspace records, snapshotted on picker open
	linePreviewEl = null;   // floating full-text preview shown on line hover

	onLoad() {
		this.loadSettings();
		this.ui.injectCSS(CSS);
		this.cmd = this.ui.addCommandPaletteCommand({
			label: 'Move to…',
			icon: 'ti-send',
			onSelected: () => this.open(),
		});
		this.cmd2 = this.ui.addCommandPaletteCommand({
			label: 'Move To: Set Shortcut',
			icon: 'ti-keyboard',
			onSelected: () => this.openSettings(),
		});
		this.hotkeyHandler = (e) => {
			if (!this.matchesHotkey(e)) return;
			// Yield the shortcut to the Quick Capture plugin while its capture box
			// is open: there, ⌘⇧M targets that box's destination picker instead of
			// moving the scratch line. Deterministic regardless of plugin load order.
			if (document.querySelector('.panel[data-qc-modal]')) return;
			e.preventDefault(); e.stopPropagation();
			if (this.popEl) this.close();
			else this.open();
		};
		window.addEventListener('keydown', this.hotkeyHandler, true);
	}

	onUnload() {
		this.close(true);
		this.closeSettings();
		if (this.hotkeyHandler) { window.removeEventListener('keydown', this.hotkeyHandler, true); this.hotkeyHandler = null; }
		try { if (this.cmd) this.cmd.remove(); } catch (e) {}
		try { if (this.cmd2) this.cmd2.remove(); } catch (e) {}
		this.cmd = this.cmd2 = null;
	}

	matchesHotkey(e) {
		const hk = this.hotkey || defaultHotkey();
		return !!e.key && e.key.toLowerCase() === hk.key
			&& !!e.metaKey === !!hk.meta && !!e.shiftKey === !!hk.shift
			&& !!e.ctrlKey === !!hk.ctrl && !!e.altKey === !!hk.alt;
	}

	// ---- settings (hotkey + indent toggle persisted in localStorage — never
	// saveConfiguration, that reloads the plugin) ------------------------------

	settingsKey() { return 'mv_settings_v1_' + (this.getGuid ? this.getGuid() : 'default'); }

	loadSettings() {
		try {
			const s = JSON.parse(localStorage.getItem(this.settingsKey()) || '{}');
			this.hotkey = s.hotkey || defaultHotkey();
			this.indentUnder = s.indentUnder === undefined ? true : !!s.indentUnder;
		} catch (e) { this.hotkey = defaultHotkey(); }
	}

	persistSettings() {
		try {
			localStorage.setItem(this.settingsKey(), JSON.stringify({
				hotkey: this.hotkey,
				indentUnder: this.indentUnder,
			}));
		} catch (e) {}
	}

	hotkeyLabel(hk) {
		hk = hk || this.hotkey || defaultHotkey();
		let s = '';
		if (hk.ctrl) s += '⌃';
		if (hk.alt) s += '⌥';
		if (hk.shift) s += '⇧';
		if (hk.meta) s += '⌘';
		s += (hk.key || '').toUpperCase();
		return s || '—';
	}

	openSettings() {
		if (this.settingsEl) return;
		const bd = document.createElement('div');
		bd.className = 'mv-settings-backdrop';
		bd.innerHTML = `
			<div class="mv-settings">
				<h3>Move To shortcut</h3>
				<p>Press a key combination to open the move picker. Include at least one of ⌘ / ⌃ / ⌥.</p>
				<div class="mv-keycap mv-armed">${this.hotkeyLabel()}</div>
				<div class="mv-settings-row">
					<button class="mv-btn mv-set-cancel">Cancel</button>
					<button class="mv-btn mv-primary mv-set-save">Save</button>
				</div>
			</div>`;
		const dlg = bd.querySelector('.mv-settings');
		dlg.style.setProperty('--mv-surface', this.themeSurfaceColor());
		dlg.style.setProperty('--mv-border', this.themeBorderColor());
		document.body.appendChild(bd);
		this.settingsEl = bd;

		let captured = null;
		const cap = bd.querySelector('.mv-keycap');
		this.settingsRec = (e) => {
			if (['Meta', 'Control', 'Shift', 'Alt', 'OS'].includes(e.key)) return;
			if (!(e.metaKey || e.ctrlKey || e.altKey)) return;
			e.preventDefault(); e.stopPropagation();
			captured = { key: e.key.toLowerCase(), meta: !!e.metaKey, ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey };
			cap.textContent = this.hotkeyLabel(captured);
		};
		document.addEventListener('keydown', this.settingsRec, true);
		bd.querySelector('.mv-set-cancel').addEventListener('click', () => this.closeSettings());
		bd.addEventListener('pointerdown', (e) => { if (e.target === bd) this.closeSettings(); });
		bd.querySelector('.mv-set-save').addEventListener('click', () => {
			if (captured) { this.hotkey = captured; this.persistSettings(); this.toast('Move To shortcut: ' + this.hotkeyLabel(captured)); }
			this.closeSettings();
		});
	}

	closeSettings() {
		if (this.settingsRec) { document.removeEventListener('keydown', this.settingsRec, true); this.settingsRec = null; }
		if (this.settingsEl) { this.settingsEl.remove(); this.settingsEl = null; }
	}

	// ---- theme ---------------------------------------------------------------

	isDarkTheme() {
		return !!(document.documentElement.classList.contains('is-dark') || document.querySelector('.is-dark'));
	}

	themeSurfaceColor() {
		const probe = document.querySelector('.panels-grid-sidebar');
		let c = probe ? getComputedStyle(probe).backgroundColor : '';
		if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') {
			c = this.isDarkTheme() ? '#1e1e22' : '#ffffff';
		}
		return c;
	}

	themeBorderColor() {
		return this.isDarkTheme() ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)';
	}

	themeShadow() {
		return this.isDarkTheme()
			? '0 16px 48px rgba(0,0,0,.5), 0 3px 10px rgba(0,0,0,.4)'
			: '0 10px 34px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.08)';
	}

	// Accent for the toggle buttons + line-preview match highlight: the mid step
	// (--color-primary-500) on a dark surface, the darker step (700) on a light
	// one. Decided by the actual surface luminance rather than an html.is-light
	// class, so it's correct even for custom themes that don't set those classes.
	accentColor() {
		return this.isLightSurface()
			? 'var(--color-primary-700, #2f8873)'
			: 'var(--color-primary-500, #4caea1)';
	}

	isLightSurface() {
		const m = /(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(this.themeSurfaceColor() || '');
		if (!m) return !this.isDarkTheme();
		return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) > 140;
	}

	// ---- scope: what is being moved -------------------------------------------
	//
	// Read the live editor selection (there is no SDK selection API):
	// g_universe.listviews → the focused listview → .selection with _caret
	// (pos.list_item.state.guid) and _range (first_pos/last_pos). Document
	// order comes from a DFS over the live model's state.children arrays —
	// record.getLineItems() is NOT in document order (children come after all
	// top-level lines), so it can't be used to slice the selection.

	resolveScope() {
		const u = window.g_universe;
		const lvs = (u && u.listviews) || [];
		let lv = null;
		for (const v of lvs) { try { if (v.hasFocus && v.hasFocus()) { lv = v; break; } } catch (e) {} }
		if (!lv) lv = lvs[0] || null;
		const sel = lv && lv.selection;
		if (!sel || !sel._caret || !sel._caret.pos) return null;

		const posGuid = (pos) => {
			try { return (pos && pos.list_item && pos.list_item.state && pos.list_item.state.guid) || null; } catch (e) { return null; }
		};
		const caretGuid = posGuid(sel._caret.pos);
		if (!caretGuid) return null;

		let firstGuid = caretGuid, lastGuid = caretGuid;
		let collapsed = true;
		try { collapsed = sel.isCollapsed(); } catch (e) {}
		// block-select mode stores its own range; fall back to the text range
		const br = sel._blockrange;
		if (br && (posGuid(br.first_pos) || posGuid(br.last_pos))) {
			firstGuid = posGuid(br.first_pos) || caretGuid;
			lastGuid = posGuid(br.last_pos) || firstGuid;
			collapsed = firstGuid === lastGuid ? collapsed : false;
		} else if (!collapsed && sel._range) {
			firstGuid = posGuid(sel._range.first_pos) || caretGuid;
			lastGuid = posGuid(sel._range.last_pos) || caretGuid;
		}

		const st = u.itemsByGuid[firstGuid];
		const rguid = st && st.rguid;
		if (!rguid) return null;

		const order = this.docOrderGuids(rguid);
		let roots;
		const multi = firstGuid !== lastGuid;
		if (multi) {
			let i1 = order.indexOf(firstGuid), i2 = order.indexOf(lastGuid);
			if (i1 < 0 || i2 < 0) return { err: 'span' };   // selection spans pages (journal) — unsupported
			if (i1 > i2) { const t = i1; i1 = i2; i2 = t; }
			const slice = order.slice(i1, i2 + 1);
			const set = new Set(slice);
			roots = slice.filter((g) => !set.has(this.parentGuidOf(g)));
		} else {
			roots = [caretGuid];
		}
		if (!roots.length) return null;

		// everything that will physically move = the roots' full subtrees
		const movedSet = new Set();
		for (const g of roots) this.collectSubtree(g, movedSet);

		const hasChildren = !multi && this.childGuidsOf(roots[0]).length > 0;
		// DOM nodes of the selection's first/last lines — the picker anchors below
		// the last line or above the first, so it never covers the selection
		let anchorNode = null, anchorTopNode = null, anchorBottomNode = null;
		try { anchorNode = sel._caret.pos.list_item.$node || null; } catch (e) {}
		const posNode = (pos) => { try { return (pos && pos.list_item && pos.list_item.$node) || null; } catch (e) { return null; } };
		if (br && (posGuid(br.first_pos) || posGuid(br.last_pos))) {
			anchorTopNode = posNode(br.first_pos); anchorBottomNode = posNode(br.last_pos);
		} else if (multi && sel._range) {
			anchorTopNode = posNode(sel._range.first_pos); anchorBottomNode = posNode(sel._range.last_pos);
		}
		anchorTopNode = anchorTopNode || anchorNode;
		anchorBottomNode = anchorBottomNode || anchorNode;
		return { rguid, roots, movedSet, hasChildren, multi, totalLines: movedSet.size, anchorNode, anchorTopNode, anchorBottomNode };
	}

	docOrderGuids(rguid) {
		const u = window.g_universe;
		const acc = [];
		const walk = (st) => {
			const ch = st && st.children;
			if (!Array.isArray(ch)) return;
			for (const c of ch) {
				if (!c || !c.guid || c.is_deleted || c.is_trashed) continue;
				acc.push(c.guid);
				walk(c);
			}
		};
		walk(u.itemsByGuid[rguid]);
		return acc;
	}

	parentGuidOf(guid) {
		try { const p = window.g_universe.itemsByGuid[guid].parent; return (p && p.guid) || null; } catch (e) { return null; }
	}

	childGuidsOf(guid) {
		try {
			const ch = window.g_universe.itemsByGuid[guid].children || [];
			return ch.filter((c) => c && c.guid && !c.is_deleted && !c.is_trashed).map((c) => c.guid);
		} catch (e) { return []; }
	}

	collectSubtree(guid, set) {
		if (set.has(guid)) return;
		set.add(guid);
		for (const c of this.childGuidsOf(guid)) this.collectSubtree(c, set);
	}

	// scope size respecting the block/line-only toggle
	effectiveCount() {
		if (!this.scope) return 0;
		if (this.scope.multi || this.blockScope) return this.scope.totalLines;
		return 1;
	}

	scopeLabel() {
		const s = this.scope;
		if (!s) return 'Move';
		if (s.multi) return `Move ${s.totalLines} selected line${s.totalLines > 1 ? 's' : ''} to…`;
		if (s.hasChildren && this.blockScope) return `Move block (${s.totalLines} lines) to…`;
		if (s.hasChildren) return 'Move line (keep children) to…';
		return 'Move line to…';
	}

	// ---- picker ----------------------------------------------------------------

	open() {
		if (this.popEl) return;
		const scope = this.resolveScope();
		if (!scope) { this.toast('Place the caret on a line first.'); return; }
		if (scope.err === 'span') { this.toast('The selection spans multiple pages — select within one page.'); return; }
		this.scope = scope;
		this.blockScope = true;

		// snapshot the full record set (names are searched directly, like the
		// native @ picker) and load collection names/icons for the result labels
		try { this.recordsCache = this.data.getAllRecords() || []; } catch (e) { this.recordsCache = []; }
		this.loadCollMap();

		const pop = document.createElement('div');
		pop.className = 'mv-pop';
		pop.style.setProperty('--mv-surface', this.themeSurfaceColor());
		pop.style.setProperty('--mv-border', this.themeBorderColor());
		pop.style.setProperty('--mv-shadow', this.themeShadow());
		pop.style.setProperty('--mv-accent', this.accentColor());
		pop.innerHTML = `
			<div class="mv-head">
				<span class="ti ti-send"></span>
				<span class="mv-title"></span>
				<button class="mv-scope" style="display:none"></button>
				<span class="mv-x" title="Close"><span class="ti ti-x"></span></span>
			</div>
			<input class="mv-input" type="text" placeholder='Search pages, lines, or a date for the Journal (e.g. "tomorrow")…' />
			<div class="mv-list"></div>
			<div class="mv-foot">
				<button class="mv-ibtn mv-indent"><span class="ti ti-indent-increase"></span><span class="mv-indent-lbl"></span></button>
				<span class="mv-hint">↑↓ navigate · ↵ move · click outside to close</span>
			</div>`;
		document.body.appendChild(pop);
		this.popEl = pop;

		pop.querySelector('.mv-x').addEventListener('click', () => this.close());
		const scopeBtn = pop.querySelector('.mv-scope');
		if (scope.hasChildren) {
			scopeBtn.style.display = '';
			scopeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.blockScope = !this.blockScope;
				this.updateScopeUI();
			});
		}
		const indentBtn = pop.querySelector('.mv-indent');
		indentBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.indentUnder = !this.indentUnder;
			this.persistSettings();
			this.updateIndentBtn();
		});
		this.updateScopeUI();
		this.updateIndentBtn();

		const input = pop.querySelector('.mv-input');
		const list = pop.querySelector('.mv-list');
		this.renderDefaultDestOptions(list);
		input.addEventListener('input', () => {
			clearTimeout(this.searchTimer);
			const q = input.value.trim();
			this.searchTimer = setTimeout(() => this.runDestSearch(q, list), 180);
		});
		input.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); this.setDestSel(this.destSel + 1); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this.setDestSel(this.destSel - 1); }
			else if (e.key === 'Enter') {
				e.preventDefault(); e.stopPropagation();
				const o = this.destOpts[this.destSel];
				if (o) o.pick();
			}
		});

		// click outside closes (pointerdown — Thymer swallows mousedown/Escape)
		this.outsideHandler = (e) => {
			if (this.popEl && !this.popEl.contains(e.target)) this.close();
		};
		document.addEventListener('pointerdown', this.outsideHandler, true);

		this.positionPopover(pop);
		setTimeout(() => input.focus(), 0);
	}

	// Anchor the picker to the selection itself: below the LAST selected line
	// when there's room, otherwise bottom-anchored just above the FIRST selected
	// line (so it grows upward and never drifts away from — or covers — the
	// selection). The result list shrinks to whatever space the chosen side has.
	positionPopover(pop) {
		const margin = 8, gap = 6;
		const W = window.innerWidth, H = window.innerHeight;
		const r = pop.getBoundingClientRect();
		const list = pop.querySelector('.mv-list');
		const s = this.scope || {};
		const topNode = (s.anchorTopNode && s.anchorTopNode.isConnected) ? s.anchorTopNode
			: (s.anchorNode && s.anchorNode.isConnected ? s.anchorNode : null);
		const bottomNode = (s.anchorBottomNode && s.anchorBottomNode.isConnected) ? s.anchorBottomNode
			: topNode;
		if (!topNode) {   // caret line not rendered — centered fallback
			pop.style.left = Math.round((W - r.width) / 2) + 'px';
			pop.style.top = Math.round(H * 0.2) + 'px';
			pop.style.bottom = 'auto';
			return;
		}
		const rTop = topNode.getBoundingClientRect();
		const rBottom = bottomNode.getBoundingClientRect();
		const panel = topNode.closest('.panel');
		const pr = panel ? panel.getBoundingClientRect() : { left: 0, right: W };
		let left = Math.round(Math.min(Math.max(rTop.left, pr.left + margin), pr.right - r.width - margin));
		left = Math.min(Math.max(margin, left), W - r.width - margin);
		pop.style.left = left + 'px';

		const CHROME = 130;   // header + input + footer around the list
		const spaceBelow = H - rBottom.bottom - gap - margin;
		const spaceAbove = rTop.top - gap - margin;
		const below = spaceBelow >= 260 || spaceBelow >= spaceAbove;
		const space = below ? spaceBelow : spaceAbove;
		if (list) list.style.maxHeight = Math.max(120, Math.min(300, space - CHROME)) + 'px';
		if (below) {
			pop.style.top = Math.round(rBottom.bottom + gap) + 'px';
			pop.style.bottom = 'auto';
		} else {
			pop.style.top = 'auto';
			pop.style.bottom = Math.round(H - rTop.top + gap) + 'px';
		}
	}

	updateScopeUI() {
		if (!this.popEl) return;
		this.popEl.querySelector('.mv-title').textContent = this.scopeLabel();
		const btn = this.popEl.querySelector('.mv-scope');
		if (!btn || btn.style.display === 'none') return;
		btn.classList.toggle('mv-on', this.blockScope);
		btn.innerHTML = this.blockScope
			? '<span class="ti ti-binary-tree"></span>Whole block'
			: '<span class="ti ti-minus"></span>Line only';
		btn.title = this.blockScope
			? 'Moving the line with all its children (click to move only the line — children stay, promoted one level)'
			: 'Moving only this line — its children stay, promoted one level (click to move the whole block)';
	}

	updateIndentBtn() {
		const btn = this.popEl && this.popEl.querySelector('.mv-indent');
		if (!btn) return;
		btn.classList.toggle('mv-on', !!this.indentUnder);
		btn.querySelector('.mv-indent-lbl').textContent = this.indentUnder ? 'Nest under target' : 'Place after target';
		btn.title = this.indentUnder
			? 'Content is placed indented under the chosen heading/line (click to place after it instead)'
			: 'Content is placed directly after the chosen heading/line (click to indent under it instead)';
	}

	close(silent) {
		clearTimeout(this.searchTimer);
		this.searchToken++;
		this.destOpts = []; this.destSel = 0;
		this.hideLinePreview();
		if (this.outsideHandler) { document.removeEventListener('pointerdown', this.outsideHandler, true); this.outsideHandler = null; }
		if (this.popEl) { this.popEl.remove(); this.popEl = null; }
		this.scope = null;
		// hand keyboard control back to the editor at the current caret
		if (!silent) { try { window.g_virtual_input && window.g_virtual_input.$textarea && window.g_virtual_input.$textarea.focus(); } catch (e) {} }
	}

	// ---- destination list (ported from Quick Capture) ---------------------------

	addDestOpt(list, el, pick) {
		const idx = this.destOpts.length;
		el.addEventListener('click', (e) => { e.stopPropagation(); pick(); });
		el.addEventListener('pointermove', () => { if (this.destSel !== idx) this.setDestSel(idx); });
		this.destOpts.push({ el, pick });
		if (idx === this.destSel) el.classList.add('mv-active');
		list.appendChild(el);
	}

	setDestSel(i) {
		const n = this.destOpts.length;
		if (!n) return;
		const next = ((i % n) + n) % n;
		const prev = this.destOpts[this.destSel];
		if (prev) prev.el.classList.remove('mv-active');
		this.destSel = next;
		const cur = this.destOpts[next];
		cur.el.classList.add('mv-active');
		try { cur.el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
	}

	resetDestList(list) {
		this.destOpts = []; this.destSel = 0;
		this.hideLinePreview();
		list.innerHTML = '';
	}

	sec(list, text) {
		const h = document.createElement('div'); h.className = 'mv-sec'; h.textContent = text;
		list.appendChild(h);
	}

	// collection guid -> {name, icon}, for the "which collection" result labels
	async loadCollMap() {
		try {
			const cols = await this.data.getAllCollections();
			const m = {};
			for (const c of (cols || [])) {
				let g = null; try { g = c._getRow ? c._getRow().guid : (c.guid || null); } catch (e) {}
				let n = ''; try { n = c.getName ? c.getName() : ''; } catch (e) {}
				let ic = ''; try { ic = (c.getIcon && c.getIcon()) || ''; } catch (e) {}
				if (g) m[g] = { name: n, icon: ic };
			}
			this.collMap = m;
		} catch (e) {}
	}
	collName(guid) { const e = guid && this.collMap[guid]; return (e && e.name) || ''; }
	collIcon(guid) { const e = guid && this.collMap[guid]; return (e && e.icon) || ''; }
	collGuidOf(rec) { try { return rec && rec._getRow ? rec._getRow().pguid : null; } catch (e) { return null; } }
	// Icon shown before a result, native-style: the record's own icon, else its
	// collection's icon, else a generic page glyph.
	iconOf(rec, collGuid) {
		let ic = null;
		try { ic = rec && rec.getIcon ? (rec.getIcon(true) || rec.getIcon()) : null; } catch (e) {}
		return ic || this.collIcon(collGuid) || 'ti-file';
	}
	iconForPage(pageGuid, collGuid) {
		let rec = null; try { rec = pageGuid ? this.data.getRecord(pageGuid) : null; } catch (e) {}
		return this.iconOf(rec, collGuid);
	}

	// Floating preview of a line's FULL text on hover (rows only show a snippet).
	showLinePreview(rowEl, text, ctx, parts) {
		this.hideLinePreview();
		if (!text) return;
		const box = document.createElement('div');
		box.className = 'mv-linepreview';
		box.style.setProperty('--mv-accent', this.accentColor());   // box lives on <body>, outside .mv-pop
		const t = document.createElement('div'); t.className = 'mv-lp-text';
		t.innerHTML = mvHighlightAll(text, parts);   // bold every match, like the row
		box.appendChild(t);
		if (ctx) { const c = document.createElement('div'); c.className = 'mv-lp-ctx'; c.textContent = ctx; box.appendChild(c); }
		document.body.appendChild(box);
		this.linePreviewEl = box;
		// Sit right next to the hovered row: below it, or above it when the row is
		// near the viewport bottom. Cap the height to the space on the chosen side
		// so it always fits AND stays attached to the row (never pinned to an edge).
		const r = rowEl.getBoundingClientRect();
		const vw = window.innerWidth, vh = window.innerHeight;
		const belowSpace = vh - r.bottom - 12, aboveSpace = r.top - 12;
		const placeBelow = belowSpace >= aboveSpace;
		box.style.maxHeight = Math.max(80, Math.min(placeBelow ? belowSpace : aboveSpace, Math.round(vh * 0.6))) + 'px';
		const bw = box.offsetWidth, bh = box.offsetHeight;
		const left = Math.max(8, Math.min(r.left, vw - bw - 8));
		let top = placeBelow ? r.bottom + 4 : r.top - bh - 4;
		top = Math.max(8, Math.min(top, vh - bh - 8));
		box.style.left = left + 'px';
		box.style.top = top + 'px';
	}
	hideLinePreview() {
		if (this.linePreviewEl) { this.linePreviewEl.remove(); this.linePreviewEl = null; }
	}

	// Parse a typed query as a journal date ("tomorrow", "next friday",
	// "2026-07-20", "yesterday", ...). Returns { dt, label } or null, where dt is
	// a `{toDate()}` shim (getJournalRecord only calls .toDate()), so this works
	// whether or not Thymer's rich DateTime parser is reachable from a plugin.
	parseJournalDate(q) {
		const s = String(q || '').trim();
		if (!s) return null;
		let d = null;
		try {
			const DT = (typeof DateTime !== 'undefined') ? DateTime : (typeof globalThis !== 'undefined' ? globalThis.DateTime : null);
			if (DT && DT.parseDateTimeString) {
				const dt = DT.parseDateTimeString(s);
				if (dt && typeof dt.toDate === 'function') { const jd = dt.toDate(); if (jd && !isNaN(jd.getTime())) d = jd; }
			}
		} catch (e) {}
		if (!d) d = fallbackJournalDate(s);
		if (!d) return null;
		const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
		const jd = d;
		return { dt: { toDate: () => jd }, label };
	}

	renderDefaultDestOptions(list) {
		this.resetDestList(list);
		this.sec(list, 'Default');
		const journal = document.createElement('div');
		journal.className = 'mv-opt';
		journal.innerHTML = `<span class="ti ti-calendar-event"></span><span class="mv-opt-text">Today's Journal</span><span class="mv-opt-sub">bottom</span>`;
		this.addDestOpt(list, journal, () => this.moveNow({ kind: 'journal' }));
		this.sec(list, 'Type to search pages, lines, or a date');
	}

	// Search pages by NAME (over the snapshotted record set, like the native @
	// picker — a title match is what makes a page a good destination) and lines by
	// their text. "+" is an AND: every part must appear. Pages are ranked by match
	// quality (exact > prefix > word-start > substring) so the strongest titles
	// surface first, and each result shows the collection it lives in.
	async runDestSearch(q, list) {
		if (!q) { this.renderDefaultDestOptions(list); return; }
		const my = ++this.searchToken;
		const moved = (this.scope && this.scope.movedSet) || new Set();
		const parts = q.split('+').map((p) => mvNorm(p)).filter(Boolean);
		if (!parts.length) { this.renderDefaultDestOptions(list); return; }
		const jdate = this.parseJournalDate(q);   // a "Journal · <date>" row when the query reads as a date
		const terms = new Set();
		for (const p of parts) {
			terms.add(p);
			const w = p.split(/\s+/).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0];
			if (w) terms.add(w);
		}
		const pageSeen = new Set(), lineSeen = new Set();
		const pages = [], lines = [];
		const addPage = (rec, guid, name) => {
			if (!guid || pageSeen.has(guid)) return;
			pageSeen.add(guid);
			pages.push({ rec, guid, name: name || 'Untitled', collGuid: this.collGuidOf(rec), score: mvNameScore(mvNorm(name), parts) });
		};
		const sortPages = () => pages.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
		const considerLine = (guid, segments, pageFn) => {
			if (!guid || lineSeen.has(guid) || lines.length >= 40) return;
			lineSeen.add(guid);
			if (moved.has(guid)) return;   // can't move content into itself
			// text match FIRST — pageFn (getRecord + getName) only runs for hits
			const text = this.displayText(segments).trim();
			if (!text) return;
			const lt = mvNorm(text);
			if (!parts.every((p) => lt.includes(p))) return;
			let info = null;
			try { info = pageFn(); } catch (e) {}
			if (!info || !info.guid) return;
			lines.push({ lineGuid: guid, pageGuid: info.guid, text, page: info.name || '', collGuid: info.collGuid || null });
		};
		// 1) PAGES — scan every record's title (snapshotted on open). Comprehensive
		//    and instant: the record set is the whole workspace map (not the
		//    virtualised lines), so title matches can't be missed the way a
		//    line-ranked search misses thin pages.
		for (const rec of this.recordsCache) {
			const guid = rowGuid(rec);
			if (!guid || pageSeen.has(guid)) continue;
			const name = (rec.getName && rec.getName()) || '';
			if (!name || !parts.every((p) => mvNorm(name).includes(p))) continue;
			addPage(rec, guid, name);
		}
		sortPages();
		// loaded lines directly (sees fresh content — searchByQuery's index lags);
		// cheap raw-text prefilter + time budget keep this fast
		const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
		const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
		const t0 = nowMs();
		for (const guid in byGuid) {
			if (lines.length >= 40 || nowMs() - t0 > 150) break;
			const it = byGuid[guid];
			if (!it || it.is_deleted || it.is_trashed || it.type === 'document') continue;
			if (!it.rguid) continue;
			const ts = it.text_segments;
			if (!ts || !ts.length) continue;
			let raw = '';
			for (let i = 0; i + 1 < ts.length; i += 2) { if (typeof ts[i + 1] === 'string') raw += ts[i + 1] + ' '; }
			const rawNorm = mvNorm(raw);
			if (!parts.some((p) => rawNorm.includes(p))) continue;
			considerLine(it.guid || guid, segmentsFromState(it), () => {
				const r = this.data.getRecord(it.rguid);
				return r ? { guid: it.rguid, name: r.getName && r.getName(), collGuid: this.collGuidOf(r) } : null;
			});
		}
		this.renderDestResults(list, pages, lines, parts, true, jdate);
		// 2) workspace-wide search: extra LINE matches beyond what's loaded, plus a
		//    safety net for any title match the record snapshot might have missed.
		//    Merged in when it arrives (token-guarded).
		for (const t of terms) {
			let res;
			try { res = await this.data.searchByQuery(t, 60); } catch (e) { res = {}; }
			if (my !== this.searchToken) return;
			for (const r of res.records || []) {
				const g = rowGuid(r);
				if (!g || pageSeen.has(g)) continue;
				const name = (r.getName && r.getName()) || '';
				if (!parts.every((p) => mvNorm(name).includes(p))) continue;   // NAME match only
				addPage(r, g, name);
			}
			for (const li of res.lines || []) {
				considerLine(li.guid, li.segments, () => {
					const r = li.getRecord && li.getRecord();
					return r ? { guid: rowGuid(r), name: r.getName && r.getName(), collGuid: this.collGuidOf(r) } : null;
				});
			}
		}
		if (my !== this.searchToken) return;
		sortPages();
		this.renderDestResults(list, pages, lines, parts, false, jdate);
	}

	renderDestResults(list, pages, lines, parts, searching, jdate) {
		this.resetDestList(list);
		if (jdate) {
			this.sec(list, 'Journal');
			const j = document.createElement('div');
			j.className = 'mv-opt';
			j.innerHTML = `<span class="ti ti-calendar-event"></span><span class="mv-opt-text">Journal · ${esc(jdate.label)}</span>`;
			this.addDestOpt(list, j, () => this.moveNow({ kind: 'journal', date: jdate.dt, dateLabel: jdate.label }));
		}
		if (!pages.length && !lines.length) {
			if (!jdate) {
				const e = document.createElement('div'); e.className = 'mv-opt';
				e.textContent = searching ? 'Searching…' : 'No pages or lines found';
				list.appendChild(e);
			}
			return;
		}
		if (pages.length) {
			this.sec(list, 'Pages');
			for (const p of pages.slice(0, 12)) {
				const coll = this.collName(p.collGuid);
				const opt = document.createElement('div');
				opt.className = 'mv-opt';
				opt.innerHTML = `<span class="ti ${esc(this.iconOf(p.rec, p.collGuid))}"></span><span class="mv-opt-text">${mvSnippetHTML(p.name, parts)}</span>`;
				opt.title = p.name + (coll ? ' · ' + coll : '');
				this.addDestOpt(list, opt, () => this.pickPage(p.rec, list));
			}
		}
		if (lines.length) {
			this.sec(list, 'Lines');
			for (const l of lines.slice(0, 10)) {
				const coll = this.collName(l.collGuid);
				const opt = document.createElement('div');
				opt.className = 'mv-opt';
				opt.innerHTML = `<span class="ti ${esc(this.iconForPage(l.pageGuid, l.collGuid))}"></span><span class="mv-opt-text">${mvSnippetHTML(l.text, parts)}</span>` + (l.page ? `<span class="mv-opt-sub">${esc(l.page)}</span>` : '');
				// full-text hover preview (a line can be a whole paragraph the row
				// snippet truncates); replaces the raw browser title tooltip
				const ctx = [l.page, coll].filter(Boolean).join(' · ');
				opt.addEventListener('mouseenter', () => this.showLinePreview(opt, l.text, ctx, parts));
				opt.addEventListener('mouseleave', () => this.hideLinePreview());
				this.addDestOpt(list, opt, () => this.moveNow({ kind: 'line', guid: l.lineGuid, pageGuid: l.pageGuid, name: truncate(l.text, 34), pageName: l.page }));
			}
		}
	}

	async pickPage(rec, list) {
		const guid = rowGuid(rec);
		const name = rec.getName ? rec.getName() : 'Page';
		const moved = (this.scope && this.scope.movedSet) || new Set();
		let headings = [], hasContent = false;
		try {
			const items = await rec.getLineItems();
			headings = items
				.filter((li) => isHeading(li) && !moved.has(liGuid(li)))
				.map((li) => ({ guid: liGuid(li), text: lineText(li), size: headingSize(li) }));
			// real content (non-empty lines that aren't the ones being moved) makes
			// Top vs Bottom a meaningful choice; an empty page makes them identical
			hasContent = topLevelItems(items, guid).some((li) => !moved.has(liGuid(li)) && !isEmptyLine(li));
		} catch (e) {}
		// empty page (or nothing but the lines being moved): top == bottom, so
		// move straight there without a chooser
		if (!hasContent) { this.moveNow({ kind: 'page', guid, name }); return; }
		this.resetDestList(list);
		this.sec(list, name + ' · where?');
		// Top is listed first but Bottom stays the default (see setDestSel below).
		const top = document.createElement('div');
		top.className = 'mv-opt';
		top.innerHTML = `<span class="ti ti-arrow-bar-to-up"></span><span class="mv-opt-text">Top of page</span>`;
		this.addDestOpt(list, top, () => this.moveNow({ kind: 'page', guid, name, atTop: true }));
		const bottomIdx = this.destOpts.length;
		const bottom = document.createElement('div');
		bottom.className = 'mv-opt';
		bottom.innerHTML = `<span class="ti ti-arrow-bar-to-down"></span><span class="mv-opt-text">Bottom of page</span><span class="mv-opt-sub">default</span>`;
		this.addDestOpt(list, bottom, () => this.moveNow({ kind: 'page', guid, name }));
		for (const h of headings) {
			if (!h.guid) continue;
			const opt = document.createElement('div');
			opt.className = 'mv-opt mv-indent-' + Math.min(2, Math.max(0, (h.size || 1) - 1));
			opt.innerHTML = `<span class="ti ti-heading"></span><span class="mv-opt-text">${esc(h.text || 'Heading')}</span>`;
			this.addDestOpt(list, opt, () => this.moveNow({ kind: 'page', guid, name, afterHeadingGuid: h.guid, headingText: h.text }));
		}
		// keep Bottom highlighted as the default (Enter picks it) even though Top is first
		this.setDestSel(bottomIdx);
	}

	displayText(segments) {
		return (segments || [])
			.map((s) => {
				if (typeof s.text === 'string') return s.text;
				const t = s.text || {};
				if (s.type === 'ref') {
					if (t.title) return t.title;
					try { const r = t.guid && this.data.getRecord(t.guid); if (r && r.getName) return r.getName(); } catch (e) {}
					return '↗';
				}
				return t.title || t.text || t.name || '';
			})
			.join('');
	}

	// ---- journal --------------------------------------------------------------

	async resolveJournalRecord(dt) {
		const cols = await this.data.getAllCollections();
		const wsGuid = this.ui.getActivePanel()?.getNavigation()?.workspaceGuid
			|| (typeof window !== 'undefined' && window.g_universe && window.g_universe.workspaceGuid) || null;
		const userGuid = await this.currentUserGuid();
		if (!userGuid) return null;
		for (const c of cols) {
			try {
				if (c.isJournalPlugin && c.isJournalPlugin()) {
					// ref.guid MUST be the USER guid — the collection guid silently
					// creates a parallel duplicate journal page. dt (a DateTime shim)
					// omitted = today; otherwise that date's journal page.
					return await c.getJournalRecord({ workspaceGuid: wsGuid, guid: userGuid }, dt);
				}
			} catch (e) {}
		}
		return null;
	}

	async currentUserGuid() {
		try {
			if (typeof window !== 'undefined' && window.g_universe && window.g_universe.userId) return window.g_universe.userId;
		} catch (e) {}
		try {
			const us = await this.data.getActiveUsers();
			if (us && us.length) {
				const self = us.find((u) => u && (u.is_self || (u._getRow && u._getRow().is_self))) || us[0];
				const g = self && (self.guid || (self._getRow && self._getRow().guid));
				if (g) return g;
			}
		} catch (e) {}
		return null;
	}

	// ---- the move ---------------------------------------------------------------

	async moveNow(dest) {
		if (this.moving || !this.scope) return;
		this.moving = true;
		try {
			await this._moveNow(dest);
		} finally {
			this.moving = false;
		}
	}

	async _moveNow(dest) {
		const scope = this.scope;
		const lineOnly = scope.hasChildren && !this.blockScope;
		const srcRec = this.data.getRecord(scope.rguid);
		if (!srcRec) { this.toast('Source page not found.'); this.close(); return; }
		const srcItems = await srcRec.getLineItems();
		const byGuid = new Map(srcItems.map((li) => [liGuid(li), li]));
		const roots = scope.roots.map((g) => byGuid.get(g)).filter(Boolean);
		if (!roots.length) { this.toast('The line is gone — nothing to move.'); this.close(); return; }

		// what actually moves (for guards + anchor filtering): the full subtrees,
		// or just the single line in line-only mode
		const movedSet = lineOnly ? new Set([scope.roots[0]]) : scope.movedSet;

		// Resolve destination → parentTarget (record for top-level, or a line to
		// nest under) + anchor (sibling to insert after; null = start). Anchors
		// must never be a line that is itself moving.
		let destRec = null, parentTarget = null, anchor = null, destLabel = '';
		const indent = !!this.indentUnder;
		const notMoved = (li) => !movedSet.has(liGuid(li));
		try {
			if (dest.kind === 'journal') {
				destRec = await this.resolveJournalRecord(dest.date);
				if (!destRec) { this.toast('No Journal found in this workspace — pick a page instead.'); return; }
				destLabel = dest.dateLabel ? ('the Journal, ' + dest.dateLabel) : "today's Journal";
				parentTarget = destRec;
				anchor = lastOf(topLevelItems(await destRec.getLineItems(), rowGuid(destRec)).filter(notMoved));
			} else if (dest.kind === 'line') {
				destRec = this.data.getRecord(dest.pageGuid);
				if (!destRec) { this.toast('Destination page not found.'); return; }
				destLabel = dest.name;
				if (this.destInsideMove(dest.guid, dest.pageGuid, movedSet)) { this.toast("Can't move a block into itself."); return; }
				const ditems = await destRec.getLineItems();
				const target = ditems.find((li) => liGuid(li) === dest.guid);
				if (!target) {
					parentTarget = destRec; anchor = lastOf(topLevelItems(ditems, rowGuid(destRec)).filter(notMoved));
					destLabel = dest.pageName || destLabel;
				} else if (indent) {
					parentTarget = target; anchor = lastOf(ditems.filter((li) => liRaw(li).pguid === dest.guid).filter(notMoved));
				} else {
					parentTarget = siblingParent(ditems, target, destRec); anchor = target;
				}
			} else {
				destRec = this.data.getRecord(dest.guid);
				if (!destRec) { this.toast('Destination page not found.'); return; }
				destLabel = dest.name;
				if (dest.afterHeadingGuid) {
					if (this.destInsideMove(dest.afterHeadingGuid, dest.guid, movedSet)) { this.toast("Can't move a block into itself."); return; }
					const ditems = await destRec.getLineItems();
					const heading = ditems.find((li) => liGuid(li) === dest.afterHeadingGuid);
					destLabel += ' › ' + (dest.headingText || 'heading');
					if (!heading) {
						parentTarget = destRec; anchor = lastOf(topLevelItems(ditems, rowGuid(destRec)).filter(notMoved));
					} else if (indent) {
						parentTarget = heading; anchor = lastOf(ditems.filter((li) => liRaw(li).pguid === dest.afterHeadingGuid).filter(notMoved));
					} else {
						parentTarget = siblingParent(ditems, heading, destRec); anchor = heading;
					}
				} else if (dest.atTop) {
					// prepend above existing content: a null anchor makes each root
					// the FIRST top-level line, and the reverse iteration below
					// restores their source order at the top of the page
					parentTarget = destRec; anchor = null;
					destLabel += ' › Top';
				} else {
					parentTarget = destRec;
					anchor = lastOf(topLevelItems(await destRec.getLineItems(), rowGuid(destRec)).filter(notMoved));
				}
			}
		} catch (e) { this.toast('Could not resolve destination.'); return; }

		// line-only: promote the children in place FIRST (they become siblings
		// right after the line, keeping their order), then move the bare line
		if (lineOnly) {
			const line = roots[0];
			const promoteParent = siblingParent(srcItems, line, srcRec);
			const kids = srcItems.filter((li) => liRaw(li).pguid === scope.roots[0]);
			for (const kid of [...kids].reverse()) {
				try { await kid.move(promoteParent, line); await wait(40); } catch (e) {}
			}
		}

		// Move the roots (subtrees ride along), preserving order. Verified
		// semantics: a null anchor PREPENDS (item becomes the FIRST child) at both
		// the record and line level; a real anchor inserts right AFTER it. Either
		// way each moved item lands ahead of the previously moved one, so iterate
		// the roots in reverse in ALL cases to keep the final order matching source.
		let moved = 0;
		const movedGuids = new Set();
		const order = [...roots].reverse();
		for (const li of order) {
			try { await li.move(parentTarget, anchor); moved++; movedGuids.add(liGuid(li)); await wait(40); } catch (e) {}
		}

		this.close();
		if (!moved) { this.toast('Nothing was moved.'); return; }
		const firstGuid = scope.roots.find((g) => movedGuids.has(g)) || null;
		const destGuid = rowGuid(destRec);
		const n = lineOnly ? 1 : scope.totalLines;
		this.toast(`Moved ${n} line${n > 1 ? 's' : ''} to ${destLabel}.`, {
			primaryLabel: 'Open',
			onPrimary: () => this.openDestination(firstGuid, destGuid),
			autoDestroyTime: 6000,
		});
	}

	// True when the chosen target line sits inside (or is) one of the subtrees
	// being moved — moving there would corrupt the tree.
	destInsideMove(targetLineGuid, targetPageGuid, movedSet) {
		if (targetPageGuid !== this.scope.rguid) return false;
		let g = targetLineGuid;
		let hops = 0;
		while (g && g !== this.scope.rguid && hops++ < 200) {
			if (movedSet.has(g)) return true;
			g = this.parentGuidOf(g);
		}
		return false;
	}

	async openDestination(lineGuid, pageGuid) {
		try {
			const panel = this.ui.getActivePanel();
			if (!panel) return;
			if (lineGuid) {
				const ok = await panel.navigateTo({ itemGuid: lineGuid, highlight: true });
				if (ok) return;
			}
			if (!pageGuid) return;
			const wsGuid = panel.getNavigation()?.workspaceGuid || null;
			panel.navigateTo({ type: 'edit_panel', rootId: pageGuid, subId: null, workspaceGuid: wsGuid });
		} catch (e) {}
	}

	toast(message, opts) {
		try { this.ui.addToaster({ title: 'Move To', message, dismissible: true, autoDestroyTime: 2600, ...(opts || {}) }); } catch (e) {}
	}
}

// ---- helpers ----------------------------------------------------------------

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function rowGuid(o) { try { return o && o._getRow ? o._getRow().guid : null; } catch (e) { return null; } }
// Line items: the runtime accessors (getType/getParent/getHeadingSize) are
// unreliable — read the raw row. Top-level when pguid === record guid.
function liRaw(li) { try { return (li && li._getItem) ? (li._getItem() || {}) : {}; } catch (e) { return {}; } }
function liGuid(li) { return liRaw(li).guid || null; }
function liType(li) { return liRaw(li).type || 'text'; }
function isHeading(li) { return liType(li) === 'heading'; }
function isEmptyLine(li) { return liType(li) === 'text' && lineText(li) === ''; }
function headingSize(li) { const mp = liRaw(li).mp; return (mp && mp.hsize) || 1; }
function lineText(li) {
	const ts = liRaw(li).ts; if (!Array.isArray(ts)) return '';
	let s = ''; for (let i = 0; i < ts.length; i += 2) s += String(ts[i + 1] || ''); return s.trim();
}
function topLevelItems(items, recGuid) { return (items || []).filter((li) => liRaw(li).pguid === recGuid); }
function lastOf(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
// The move target for "place directly after `target` at the same level":
// the record when the target is top-level, else the target's parent line.
function siblingParent(items, target, rec) {
	const pg = liRaw(target).pguid;
	if (pg === rowGuid(rec)) return rec;
	return (items || []).find((li) => liGuid(li) === pg) || rec;
}
function truncate(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function mvNorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
// Rank a page-name match: exact > prefix > word-start > plain substring, summed
// across the "+" parts, so the strongest titles float to the top of the Pages list.
function mvNameScore(nn, parts) {
	let s = 0;
	for (const p of parts) {
		if (nn === p) s += 100;
		else if (nn.startsWith(p)) s += 45;
		else if (nn.includes(' ' + p)) s += 25;
		else s += 8;
	}
	return s;
}
// Minimal date fallback (used only if Thymer's DateTime parser is unreachable):
// ISO YYYY-MM-DD, plus today / tomorrow / yesterday. Returns a JS Date or null.
function fallbackJournalDate(s) {
	const t = s.toLowerCase().trim();
	const today = new Date(); today.setHours(0, 0, 0, 0);
	if (t === 'today') return today;
	if (t === 'tomorrow') { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }
	if (t === 'yesterday') { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }
	const m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
	if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); d.setHours(0, 0, 0, 0); return isNaN(d.getTime()) ? null : d; }
	return null;
}
// Escape + bold EVERY occurrence of the matched words in the full text (no
// windowing — used by the line hover preview so the search terms stand out).
function mvHighlightAll(text, parts) {
	const full = String(text == null ? '' : text);
	const words = [...new Set((parts || []).concat((parts || []).flatMap((p) => p.split(/\s+/))))].filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
	if (!words.length) return esc(full);
	const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp('(' + words.map(escRe).join('|') + ')', 'ig');
	let html = '', last = 0, m;
	while ((m = re.exec(full)) !== null) {
		html += esc(full.slice(last, m.index)) + '<b>' + esc(m[0]) + '</b>';
		last = m.index + m[0].length;
		if (m.index === re.lastIndex) re.lastIndex++;
	}
	return html + esc(full.slice(last));
}
// A short one-line snippet centred on the first matched part, with matched
// words highlighted (<b>, accent-coloured via CSS).
function mvSnippetHTML(text, parts) {
	const full = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
	const words = [...new Set((parts || []).concat((parts || []).flatMap((p) => p.split(/\s+/))))].filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
	const tail = (s, n) => s.slice(0, n) + (s.length > n ? '…' : '');
	if (!words.length) return esc(tail(full, 160));
	const lower = full.toLowerCase();
	let first = -1;
	for (const w of words) { const i = lower.indexOf(w); if (i >= 0 && (first < 0 || i < first)) first = i; }
	if (first < 0) return esc(tail(full, 160));
	const start = Math.max(0, first - 50);
	const end = Math.min(full.length, first + 115);
	const win = full.slice(start, end);
	const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp('(' + words.map(escRe).join('|') + ')', 'ig');
	let html = '', last = 0, m;
	while ((m = re.exec(win)) !== null) {
		html += esc(win.slice(last, m.index)) + '<b>' + esc(m[0]) + '</b>';
		last = m.index + m[0].length;
		if (m.index === re.lastIndex) re.lastIndex++;
	}
	html += esc(win.slice(last));
	return (start > 0 ? '…' : '') + html + (end < full.length ? '…' : '');
}
// Reconstruct {type, text} segments from the pair-encoded live model.
function segmentsFromState(state) {
	const ts = (state && state.text_segments) || [];
	const segs = [];
	for (let i = 0; i + 1 < ts.length; i += 2) segs.push({ type: String(ts[i]), text: ts[i + 1] });
	return segs;
}
