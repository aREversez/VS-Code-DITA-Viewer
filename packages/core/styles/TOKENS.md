# Host tokens

`dita-content.css` does not know which application shows the rendered DITA. It
reads the custom properties below; the host defines them on the element that
carries the content (`:host` for a Shadow DOM, `:root` for a document).

| Token | Meaning |
| --- | --- |
| `--dita-fg` | Body text colour |
| `--dita-fg-muted` | Secondary text (shortdesc, captions, hints) |
| `--dita-bg` | Page background |
| `--dita-bg-elevated` | Background of floating chrome (menus, toasts) |
| `--dita-border` | Rules, table borders, dividers |
| `--dita-focus` | Focus ring and progress accent |
| `--dita-hover-bg` | Hover / highlighted row background |
| `--dita-selected-fg` | Text on a selected row |
| `--dita-link` | Link colour |
| `--dita-code-bg` | Code block background |
| `--dita-code-inline-bg` | Inline code and language-label background |
| `--dita-font` | Body font family |

Every use inside the stylesheet carries a fallback, so a host that defines only
some tokens still renders legibly.

## Optional tokens for floating chrome

The image button, the right-click menu and the copy toast can be coloured
separately from the rest. A host that has no separate colours defines none of
these: each one falls back to the token in the last column, which is what the
stylesheet used before they existed.

| Token | Meaning | Falls back to |
| --- | --- | --- |
| `--dita-btn-border` | Border of the image toolbar buttons | `--dita-border` |
| `--dita-btn-fg` | Text of the image toolbar buttons | `--dita-fg` |
| `--dita-menu-bg` | Context menu background | `--dita-bg-elevated`, then `--dita-bg` |
| `--dita-menu-border` | Context menu border | `--dita-border` |
| `--dita-menu-fg` | Context menu item text | `--dita-fg` |
| `--dita-menu-hover-bg` | Hovered or focused menu item background | `--dita-hover-bg` |
| `--dita-menu-hover-fg` | Hovered or focused menu item text | `--dita-selected-fg`, then `--dita-fg` |
| `--dita-menu-sep` | Divider between menu groups | `--dita-border` |
| `--dita-toast-bg` | Copy toast background | `--dita-bg-elevated`, then `--dita-bg` |
| `--dita-toast-border` | Copy toast border | `--dita-border` |
| `--dita-toast-fg` | Copy toast text | `--dita-fg` |

## The palette

Callouts, profiling highlights, index chips and conref tints use `--color-*`
variables (`--color-note-bg`, `--color-warning-border`, `--color-profiling-bg`,
…). The stylesheet ships light and dark defaults for them. A host may redefine
any of them; deriving them from its own palette (for example with `color-mix`
against `--dita-bg`) is what makes them follow the active theme, in both light
and dark, without a per-theme list.

## Dark mode

Hosts that cannot express a colour as a function of their own variables may use
the scheme switch: `.vscode-dark` on the document root, or
`data-scheme="dark"` on a Shadow DOM host.
