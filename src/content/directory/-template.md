---
# ── Core details (required or near-required) ──────────────────────────────
title: "Celebrant Name"
description: "Short description of this celebrant and their services (aim for under 160 chars for SEO)."
website: "https://example.com"
email: "hello@example.com"
phone: "0400 000 000"
location:
  - Sydney
  - Blue Mountains
category:
  - Celebrant
  # - MC
  # - Elopement Planner
tier: registered # registered | endorsed | luminary
draft: true      # set false to publish

# ── Optional SEO / presentation ───────────────────────────────────────────
# meta_title: "Custom SEO Title — Australian Wedding Celebrants"
# image: "../../assets/directory/slug.webp"   # prefer local asset for optimisation
# logo: "../../assets/directory/slug-logo.webp"
# address: "123 Example St<br>Sydney NSW 2000" # <br> allowed for multi-line

# ── Flags ─────────────────────────────────────────────────────────────────
# featured: true        # pin to featured grouping where supported
# australia_wide: true  # surfaces on /australia-wide/
# international: true   # surfaces on /destination-wedding-celebrants/

# ── Custom routing ────────────────────────────────────────────────────────
# slug: custom-slug-if-needed   # overrides filename-derived slug

# ── Social links ──────────────────────────────────────────────────────────
# social:
#   facebook: "https://facebook.com/example"
#   instagram: "https://instagram.com/example"
#   pinterest: "https://pinterest.com/example"

# ── Premium profile fields ────────────────────────────────────────────────
# Luminary tier only: feature video, 3-image gallery, custom page background.
# background_color: "#faf7f5"
# youtube: "https://www.youtube.com/watch?v=VIDEO_ID"
# gallery:
#   - "../../assets/directory/example-gallery-1.jpg"
#   - "../../assets/directory/example-gallery-2.jpg"
#   - "../../assets/directory/example-gallery-3.jpg"

# Luminary + Endorsed tiers: up to 3 testimonials. Emits schema.org/Review JSON-LD.
# These are short showcase quotes — separate from the tier-qualifying review
# counts (6+ couple / 3+ vendor for Endorsed, 18+ / 9+ for Luminary), which are
# evidenced via links submitted through the worker.
# testimonials:
#   - quote: "Short, specific praise from the couple."
#     author: "Couple's names"
#     role: "Married in Location, Year"
#   - quote: "Another testimonial."
#     author: "Couple's names"
#     role: "Married in Location, Year"

# ── Awards ────────────────────────────────────────────────────────────────
# `year_started` is the year the celebrant began working — it auto-generates
# a "Class of {year}" 🎓 award so every celebrant has something on their
# Trophy Shelf even before any other awards are given.
# year_started: 2015
#
# Free-text recognitions — regional ("Celebrant of the Year"), fun, or
# industry. `title` and `year` are required; `emoji`, `region`, and `note`
# are optional. The most recent award surfaces as a corner marker on the
# directory card; the full list renders as a trophy shelf on the profile.
# awards:
#   - title: "Celebrant of the Year"
#     emoji: "🏆"
#     region: "Hobart"
#     year: 2026
#   - title: "Most Likely to Make the Groom Cry"
#     emoji: "😭"
#     year: 2025
#     note: "Three Kleenex boxes at one ceremony."
---

Write the celebrant's bio and any additional content here. Target 600+ words for SEO.
