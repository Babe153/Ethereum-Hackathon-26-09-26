# ProofPay visual identity

The mark combines a P-shaped proof/document outline with a contrasting verification check. Its rounded enclosure evokes a protected record rather than a currency logo. It is an original SVG, not a raster image; the icon stays sharp at browser-tab and presentation sizes.

- Pine: `#193F35` — identity, primary actions, text emphasis.
- Paper: `#F7F7F2` — page background.
- Lime: `#D7E7B7` — verification accents, never a blanket guarantee.
- White: `#FFFFFF` — task cards, form and document surfaces.
- Text: `#1B3830`; secondary text: `#738078`.

Assets: `web/public/brand/proofpay-mark.svg` (standalone symbol), `web/public/brand/proofpay-logo.svg` (horizontal wordmark). The icon is also used as the favicon. Keep clear space of at least one quarter of the icon width around standalone marks. Do not stretch or recolor the verification check independently.

Implementation uses React/Next.js components, native SVG, CSS Grid/Flexbox, and a themed RainbowKit wallet control. No external image generation or font download is required. The market illustration is explicitly a diagram, not a fabricated payment record.

The global stylesheet is consolidated around design variables and responsive layouts. Marketplace, posting and detail routes share navigation, form controls, status colors and spacing. Both English and Chinese routes are supported, with keyboard focus outlines and reduced-motion behavior.

The existing wallet authorization, contract transactions, task filters, service health and independent countdown timer are preserved. Unconfigured data is shown as unavailable, not as fictional live activity.
