# DESIGN.md — Aegis DeFAI Terminal Style Reference

> Midnight precision terminal with a DeFi liquidity accent.
> Dark theme only.

Aegis is a data-dense DeFi + AI-agent terminal: dashboards, tables, charts,
risk alerts and a live agent console. The UI is a **hybrid** of two Refero
design systems:

- **Base: Linear** (`styles.refero.design/style/90ce5883…`) — midnight command
  center: near-black surfaces, hairline borders instead of shadows, tight
  Inter typography in the 400–510 weight band, compact density.
- **Accent: DeFi teal** (Auros bioluminescent family,
  `styles.refero.design/style/21cfe0c1…`) — one luminous teal for primary
  actions and active states, with the signature gradient reserved for the
  single primary CTA per view.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Void | `#08090a` | `--color-void` | Page canvas |
| Carbon | `#0f1011` | `--color-carbon` | Card surfaces, nav bars |
| Obsidian | `#161718` | `--color-obsidian` | Elevated/nested panels |
| Graphite | `#23252a` | `--color-graphite` | Hairline borders, dividers |
| Smoke | `#383b3f` | `--color-smoke` | Higher-contrast hairlines, scrollbar |
| Ash | `#62666d` | `--color-ash` | Muted metadata |
| Fog | `#8a8f98` | `--color-fog` | Tertiary text, placeholders |
| Mist | `#d0d6e0` | `--color-mist` | Body text, secondary headings |
| Paper | `#ffffff` | `--color-paper` | Headings, emphasis |
| **Accent Teal** | `#17c3b2` | `--color-accent` | Primary actions, active nav, series |
| Accent Contrast | `#062622` | `--color-accent-contrast` | Text on teal fills |
| Pulse Green | `#27a644` | `--color-success` | Profit, low risk, connected |
| Amber | `#f5a623` | `--color-warning` | Warnings, mid risk |
| Coral Red | `#eb5757` | `--color-error` | Loss, high risk, stopped |
| Iris Violet | `#6366f1` | `--color-iris-violet` | Info tags (SIM mode) |
| Lavender | `#8b5cf6` | `--color-secondary` | Secondary tags |
| Signal Teal | `#02b8cc` | `--color-tertiary` | Informational accents |

**Signature gradient (single primary CTA only):**
`linear-gradient(90deg, #0f8a7e 0%, #17c3b2 55%, #7ff0e3 100%)`

## Tokens — Typography

- **Primary:** Inter (variable) with `font-feature-settings: "cv01","ss03","zero"`.
- **Mono (code/terminal/data):** JetBrains Mono — log lines, IDs, numeric cells,
  timestamps, uppercase status pills.
- Headings: weight **510**, `letter-spacing: -0.022em`, color paper.
- Body: weight 400, 16px, line-height 1.5, color mist.
- Muted/secondary: fog. Uppercase labels: 10–13px mono, `tracking 0.08–0.12em`.

## Spacing & Shape

- Base unit 4px; compact density — card padding 20–24px, element gap 8px.
- Radii: buttons/inputs **6px**, cards **12px**, badges **4px**, pills **9999px**. No radius above 12px.
- Elevation: hairline borders (`0 0 0 1px #23252a inset`), **no outer shadows**
  on cards; floating surfaces (modals, dropdowns) may use the dark
  `rgba(8,9,10,.6) 0 4px 32px` shadow.

## Components

- **Primary button:** accent teal fill, `--color-accent-contrast` text, 6px
  radius, weight 510. One per view. The **Start Simulation** CTA uses the
  signature gradient.
- **Ghost button:** 1px graphite border, mist text, 6px radius.
- **Status pill:** 4px radius, `/10` tinted fill + `/30` border of the
  semantic token (success/warning/error/iris), mono 10–12px uppercase.
- **Input:** `rgba(255,255,255,0.02)` fill, 1px `rgba(255,255,255,0.08)`
  border, 6px radius; focus = teal border (70%), no ring.
- **Card:** carbon/obsidian surface, graphite hairline, 12px radius, no shadow.
- **Sidebar nav:** active = teal text + `accent/10` tint; labels 14px.
- **Charts (recharts):** grid/axis hairlines graphite/smoke, series teal,
  profit pulse-green, loss coral, tooltip on obsidian.

## Do's and Don'ts

- **Do** use hairline borders for separation — never drop shadows.
- **Do** keep body text in the mist/fog grey scale; paper only for headings
  and the biggest numbers.
- **Do** use semantic tokens for status — green profit, amber warning, coral
  loss — never decorative color in data views.
- **Do** keep the teal accent singular: one primary action per view, one
  active nav item.
- **Don't** use weights above 600 in UI; the system caps at 590/510.
- **Don't** apply the signature gradient to text, borders, or more than one
  button per screen.
- **Don't** introduce new hues outside the palette; volume comes from the
  surface stack, not more colors.

## Implementation Notes

- Material token **names** are kept as aliases in `frontend/src/index.css`
  (`--color-surface`, `--color-primary`, …) so legacy components map onto the
  system without JSX changes; new components may use the Linear names
  (`bg-carbon`, `border-graphite`, `text-mist`, `text-paper`).
- Theme is dark-only; no light-mode toggle is planned.
