# 🌿 Blomsterlen

E-handel för perenner, prydnadsgräs, ormbunkar och kryddväxter från Lackalänga Trädgård.

## Sidor

| Fil | Beskrivning |
|-----|-------------|
| `index.html` | Startsida med produktkatalog, sök, filtrering & varukorg |
| `produkt.html` | Produktsida (slug-baserad routing via #hash) |
| `kassa.html` | 4-stegs checkout (uppgifter → frakt → betalning → översikt) |
| `om-oss.html` | Om Blomsterlen & Lackalänga Trädgård |
| `kundservice.html` | Frakt, returer, FAQ & kontakt |

## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS (inga ramverk)
- **Databas:** Supabase (PostgreSQL) — 575 produkter
- **Bilder:** Supabase Storage (AI-genererade produktbilder)
- **Design:** Sage green / terracotta / cream, Cormorant Garamond + DM Sans

## Deploy

Statisk site — deploy direkt till Vercel, Netlify eller Cloudflare Pages.

```bash
# Vercel
npx vercel

# Eller koppla GitHub-repot till Vercel Dashboard
```

## Miljövariabler

Supabase-konfiguration finns inbäddad i HTML-filerna (anon key med RLS — säker att exponera).

## TODO

- [ ] Stripe-integration (betalning)
- [ ] Domän: blomsterlen.se
- [ ] Order-webhook & bekräftelsemail
