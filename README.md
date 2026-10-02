# eor-2026

Static files for two Borderless AI landing pages (rest of world and Canada): styles, scripts, images and the animated illustrations. They're served with GitHub Pages and loaded by the pages on hireborderless.com.

Keep the folder structure as it is (`css/ js/ img/ logos/ flags/ dioramas/`). The scripts find the illustrations by these paths.

## Stills, for phones

`stills/` holds a still image of each diorama, for showing in place of the animation. Each comes at two sharpnesses: the plain file, and `@2x` for high-density screens. They have transparent backgrounds, so they sit on any page colour.

| File | What it shows |
|---|---|
| `hero-diamond.webp` | The four-room diamond at the top of both pages, at the moment the animation starts from |
| `office-building.webp` | The office building beside the pricing, as it first appears: top floor open, the rest closed |
| `step-1/2/3-rest-of-world.webp` | The three "how it works" close-ups on the rest-of-world page (already stills on the page) |
| `step-1/2/3-canada.webp` | The same, on the Canada page |

Example: `<img src="…/stills/office-building.webp" srcset="…/stills/office-building.webp 1x, …/stills/office-building@2x.webp 2x" alt="…">`
