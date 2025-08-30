# Perfect Unified — Vanilla HTML/CSS/JS Prototype

This is a single‑page, framework‑free prototype of **Perfect Unified** that implements the global app shell and the core module layouts and interactions described in the blueprint. It focuses on IA, role‑aware navigation, keyboardability, a11y affordances, and a clean token‑driven design system.

**How to run**

1. Download the ZIP and extract it.
2. Open `index.html` in a modern browser (no server needed).

**What’s included**

- Top app shell: logo, Command‑K palette, global search, New (+) menu, presence, notifications, profile/role/org.
- Role‑aware primary navigation (Admin/Manager/Member/Client).
- Hash‑based router (`#/path`) showing each module route.
- Design tokens (CSS variables): colors, density, radius, shadows; compact mode; high‑contrast mode; wallpapers.
- Keyboard shortcuts: `/` (focus search), `⌘/Ctrl+K` (Command palette), `E` (reply focus), `N` (new task), `G` then `I/T`.
- Unified Inbox: filters, list, thread view, composer with attachments & voice note recording; per‑thread triage actions; right context panel.
- Chat: channel list, messages, file attach, voice note.
- Workspace: Projects grid; My Tasks (Today/Next/Later) with drag‑drop; global Kanban board; Time Tracking with CSV export.
- Automations: JSON conditions & actions, simple dry‑run tester; rule list.
- Calendar: Month/Week/Day views; quick add events.
- Notes: plain block editor, tags, extract lines to tasks.
- Clients: CRM pipeline board with drag‑drop; Onboarding brief generator (template‑based); Sequences editor & simulator; Brand DNA guardrails; Billing tables.
- Add‑Ons: Digital Twin desk booking grid; Reports (CSS bar charts).
- Admin: theme color picker, wallpaper, density, high‑contrast; notification sounds (WebAudio).

**Persistence**: minimal app/user/settings/data saved in `localStorage` under `pu.*` keys.

**Scope Notes**

- This is a UI/UX and interaction scaffold. It does **not** connect to external services (Gmail, Calendar, Stripe, etc.).
- “AI” references use deterministic UI logic (no model calls). Where the blueprint says “AI”, this prototype provides non‑AI placeholders so you can later wire actual services.
- Screenshots capture is not supported by browsers; the time tracker supports manual/CSV export.

**Customization**

- Change theme color and density in **Admin → Organization & Theme**.
- Presence status affects sounds (DND mutes them).

---

This prototype maps directly to the provided blueprint (“Global IA”, modules, routes, patterns), so you can translate it into your production stack later.
