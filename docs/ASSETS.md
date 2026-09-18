# Creative DNA — Brand Assets & App Directory Icon Specification

This document details the visual identity and production-ready graphical assets for the Creative DNA submission to the ChatGPT App Directory.

---

## 1. Primary App Icon

| Asset | Specification | File Path | Production URL |
|---|---|---|---|
| **App Icon (Raster)** | 512 &times; 512 px, PNG (24-bit RGB + Alpha) | `/public/icon.png` | `https://creative-dna-gateway.vercel.app/icon.png` |
| **App Icon (Vector)** | Scalable SVG (128 &times; 128 viewport) | `/public/icon.svg` | `https://creative-dna-gateway.vercel.app/icon.svg` |
| **App Logo (Horizontal)** | Scalable SVG with wordmark lockup | `/public/logo.svg` | `https://creative-dna-gateway.vercel.app/logo.svg` |

---

## 2. Icon Design & Rationale

The Creative DNA app icon is designed specifically for directory readability, mobile app grids, and miniature favicon/avatar scaling:

- **Geometric Helix Core:** Intertwined geometric arcs symbolize brand DNA, typography hierarchy, and structured layout systems.
- **Canonical Node Dots:** Precise vector nodes represent individual brand branches and modules (Hero, Onepage, UGC, Product Imagery).
- **Subtle Rounded Baseplate:** Deep slate-indigo backdrop (`#0f172a` to `#312e81`) guarantees high contrast and boundary definition across both light and dark mode ChatGPT themes.
- **No Micro-Text or Clutter:** The mark relies entirely on bold, clean iconography that maintains clarity at small sizes (down to 16&times;16 px).

---

## 3. Official Color Palette

| Token | Hex Code | Purpose |
|---|---|---|
| **Primary Indigo** | `#4f46e5` | Core brand identity & action highlights |
| **Electric Violet** | `#7c3aed` | Secondary gradient transition |
| **Vibrant Cyan** | `#06b6d4` | Tertiary accent & endpoint highlight |
| **Deep Canvas** | `#0f172a` | High-contrast background baseplate |
| **Border Accent** | `#3730a3` | Clean icon rim definition |

---

## 4. Directory & Manifest Referencing

All assets are served statically at root paths with immutable caching headers:
- In `/.well-known/ai-plugin.json`: `"logo_url": "https://creative-dna-gateway.vercel.app/icon.png"`
- In HTML entry `<head>`: `<link rel="icon" type="image/svg+xml" href="/icon.svg">`
- OpenGraph Share Preview: `https://creative-dna-gateway.vercel.app/icon.png`
