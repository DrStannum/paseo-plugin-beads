# Design notes

**English** · [Русский](ru/design-notes.md)

Where the colours come from, and why each of them is allowed to carry only part of the message.

**Two sources.** Surfaces, ink, the accent and the success / warning / danger
colours come from the Paseo theme the panel is drawn in, so the panel looks like
the rest of the app in any theme. What Paseo has no word for (issue type hues, the
eight tag slots, priority colours) is taken from the CloudCLI plugin this one is a
port of, in its light or dark variant, chosen by the luminance of the theme's
background. The panel and the charts read one set of these tokens, so a colour
cannot mean one thing in the tree and another on a chart.

- **Issue type**: three categorical hues, epic blue, bug orange and feature teal.
  Three is the ceiling for a set that stays distinct for every reader; the other
  types (`task`, `chore`, `decision` and the rest) wear muted ink and are told
  apart by the letter on their badge. The colour never travels alone: a letter
  glyph is always beside it, and the type name is spelled out in the filters and
  on the card.
- **Status**: the theme's own status colours. In progress is the success green,
  blocked the danger red, deferred the warning yellow, open a hollow ring, closed
  a solid ink dot. Red and green are hard to tell apart under deuteranopia, which
  is handled the standard way: a textual status caption always sits next to the
  dot.
- **Priority**: a chevron whose shape carries the level (double up for P0, single
  up for P1, an equals bar for P2, single down for P3, double down for P4) and
  whose colour repeats it: danger red, accent, warning, success, muted ink. The
  shape differs at every level, the card spells the level out beside the icon
  ("P1 high"), and on the web the tooltip says "P1 — high" where only the icon
  fits.
- **Tags**: eight categorical slots in a fixed order, assigned from the project's
  own sorted tag list, so a tag does not change colour when filters change. The
  ninth and beyond fall back to muted ink rather than an invented hue. The chip's
  text is plain ink: the hue carries recognition, the wording carries meaning.
- **The progress bar over a card's children**: open is a light fill, the working
  statuses wear their status colour, closed is a muted grey. The legend under the
  bar draws a swatch in each segment's own colour, so every colour in the bar can
  be found in the legend, and the legend carries the counts in words and numbers:
  the bar alone is never the message.
- **Charts**: the same palette. Waiting is muted, in progress the accent, done the
  success green, in the cumulative flow and in the opened / closed bars alike.

**Monospace where it is code.** IDs, keys and the edit form's text blocks are drawn
in a monospace face. Paseo's web app may force its interface font on every node;
the panel opts those nodes out the same way Paseo's own code views do.

---

[← Documentation index](README.md) · [Project README](../README.md)
