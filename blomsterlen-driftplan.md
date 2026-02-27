# Blomsterlen — Projektstatus 2026-02-27

## Översikt
E-handelsplattform för Blomsterlen (blomsterlen.se) — en växtbutik som säljer perenner från Lackalänga Trädgård i Skåne. 575 produkter, AI-genererade produktbilder, Stripe-betalning, orderbekräftelsemail.

## Live-miljö
- **Webbplats:** https://blomsterlen.se
- **Hosting:** Vercel (auto-deploy från GitHub)
- **GitHub:** https://github.com/addamig/blomsterlen
- **Databas:** Supabase (projekt: jymaudfvcfhmjnfxucbk)
- **Betalning:** Stripe (testläge)
- **E-post:** Resend

## Filer i repot

### Frontend (5 HTML-sidor)
| Fil | Beskrivning |
|-----|-------------|
| `index.html` | Startsida med hero, kategorier, produktgrid, sök, varukorg, önskelista |
| `produkt.html` | Produktsida med bild, pris, specifikationer, relaterade produkter |
| `kassa.html` | 3-stegs kassa (Uppgifter → Frakt → Granska & Betala → Stripe Checkout) |
| `om-oss.html` | Om oss-sida |
| `kundservice.html` | Kundservice med FAQ |

### Supabase Edge Functions (3 st)
| Funktion | Sökväg | Beskrivning |
|----------|--------|-------------|
| `create-checkout` | `supabase/functions/create-checkout/index.ts` | Skapar Stripe Checkout-session. Validerar priser mot databas, kollar lager, beräknar frakt. |
| `stripe-webhook` | `supabase/functions/stripe-webhook/index.ts` | Tar emot checkout.session.completed. Sparar order i DB, skickar orderbekräftelsemail via Resend med produktbilder. BCC till richard@addamig.se. |
| `get-order` | `supabase/functions/get-order/index.ts` | Hämtar orderdetaljer från Stripe session för kvittosidan. |

## Supabase-konfiguration

### Anslutning
- **URL:** https://jymaudfvcfhmjnfxucbk.supabase.co
- **Anon key:** sb_publishable_tU8OQHV4z23BnM17a_QHtg_is4UE_jr
- **Projekt-ref:** jymaudfvcfhmjnfxucbk

### Databastabeller
- **products** — 575 aktiva produkter med stock_quantity = 25
  - Kolumner: id, swedish_name, latin_name, category, slug, retail_price_incl_vat, image_url, stock_quantity, is_active, m.fl.
- **orders** — Ordrar från Stripe
  - Kolumner: id, order_number, customer_id, status, shipping_name, shipping_address, shipping_postal_code, shipping_city, shipping_country, email, phone, subtotal_incl_vat, shipping_cost, total_incl_vat, payment_method, payment_intent_id, notes, created_at, updated_at

### Storage
- **Bucket:** product-images (public)
- **Sökväg:** product-images/plants/{slug}-product.webp

### Edge Function Secrets
- STRIPE_SECRET_KEY — Stripe test secret key
- STRIPE_WEBHOOK_SECRET — Stripe webhook signing secret
- RESEND_API_KEY — Resend e-post API-nyckel
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_DB_URL — auto-satta

### RLS (Row Level Security)
- **products:** SELECT tillåtet via anon key, UPDATE/INSERT blockerat
- **orders:** SELECT returnerar tom array via anon key (RLS blockerar), INSERT via service_role fungerar

## Stripe-konfiguration
- **Läge:** Test (sandbox)
- **Publishable key:** pk_test_51RZcJmQlbH0rol1o...
- **Secret key:** sk_test_51RZcJmQlbH0rol1o...
- **Webhook endpoint:** https://jymaudfvcfhmjnfxucbk.supabase.co/functions/v1/stripe-webhook
- **Webhook event:** checkout.session.completed
- **Betalmetoder:** card, klarna

## Kassaflöde
1. Kund fyller i uppgifter (namn, adress, e-post, telefon)
2. Väljer fraktsätt (standard 49kr, express 99kr, ombud 39kr; fri frakt över 599kr)
3. Granskar order, godkänner villkor
4. Klickar "Gå till betalning" → create-checkout Edge Function skapar Stripe session
5. Omdirigeras till Stripe Checkout (Klarna eller kort)
6. Efter betalning → tillbaka till kassa.html med ?success=true&session_id=...
7. get-order hämtar orderdetaljer → visar kvitto med produktbilder och priser
8. Webhook (checkout.session.completed) → sparar order i DB + skickar orderbekräftelsemail

## Orderbekräftelsemail
- Skickas via Resend från "Blomsterlen <order@blomsterlen.se>"
- HTML-mail med produktbilder, priser, leveransinfo, planteringstips
- BCC till richard@addamig.se

## Funktioner i frontend

### Varukorg
- localStorage-baserad (blomsterlen_cart)
- Slide-in drawer med produktbilder
- +/- utan blinkning (selektiv DOM-uppdatering)
- Automatisk frakt-beräkning

### Önskelista
- localStorage-baserad (blomsterlen_wl)
- Hjärta-toggle med pulsanimering
- Drawer med produkter, köp-knapp, ta bort
- Synkad mellan index och produktsida
- Räknare i navbar

### Sök
- Realtidssökning mot Supabase
- Fuzzy match på svenska namn, latinska namn
- Sökresultat med bilder

### Sidövergångar
- Fade in/out med opacity-transition
- pageshow-event hanterar bfcache (bakåtknapp)
- Scroll to top vid produktnavigation

## Git-historik (senaste commits)
```
e9b3b41 Fix product grid flicker on wishlist toggle, add heart pulse animation
97a9e6a Remove underline from checkout button in cart drawer
e38aa83 Fix mobile hero: remove vh units entirely, use auto height with padding
62e4838 Fix hero section jumping on mobile scroll: use svh instead of vh
e6b8919 Fix cart image flicker: only update quantity text on +/- instead of full re-render
cbf8ed5 Fix blank page on browser back: handle bfcache with pageshow event
fd7a4ea Fix wishlist: empty heart when no favorites, instant re-render on remove
06a9aa1 Add wishlist drawer with localStorage persistence
cf355d7 Add full receipt with product images, prices and delivery details
c380589 Add BCC to order confirmation emails
a06df1f Add order confirmation email with product images via Resend
c57fc4c Scroll to top when navigating between products
2e14f13 Fix white page when clicking related products on mobile
23af339 Fix white page on mobile: add fallback timeout for page transition
78ab32a Fix address parsing: send zip/city as separate metadata fields
7ac9407 Fix webhook: match actual orders table schema
8ba7c12 Improve webhook: better error handling and logging
313872f Fix checkout: remove duplicate panel, add product images to cart/review
03fe59f Trigger redeploy
3c29a25 Add Stripe Checkout integration
36d1473 Initial commit: Blomsterlen e-commerce site
```

## Deploy-kommandon (referens)
```bash
# Klona
git clone https://github.com/addamig/blomsterlen.git
cd blomsterlen

# Supabase CLI
supabase login
supabase link --project-ref jymaudfvcfhmjnfxucbk

# Deploya Edge Functions
supabase functions deploy create-checkout --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy get-order --no-verify-jwt

# Secrets
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set RESEND_API_KEY=re_...
```

## Nästa steg (potentiella)
- Byta från Stripe testläge till live-nycklar
- Lagerhantering (decrement_stock vid order)
- Order-admin/dashboard
- SEO-optimering (meta-taggar, sitemap)
- Cookie-banner / GDPR
- Fler betalmetoder (Swish)
