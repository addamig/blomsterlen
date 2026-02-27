import { next } from '@vercel/edge';

const SUPABASE_URL = 'https://jymaudfvcfhmjnfxucbk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tU8OQHV4z23BnM17a_QHtg_is4UE_jr';

export const config = {
  matcher: '/vaxter/:slug*',
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const slug = url.pathname.replace('/vaxter/', '');

  if (!slug) {
    return Response.redirect(new URL('/#products', request.url), 302);
  }

  // Fetch product data from Supabase
  let product = null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&select=swedish_name,latin_name,category,slug,catch_phrase,bloom_color,height_cm,bloom_time,light,retail_price_incl_vat,stock_quantity,image_url&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const data = await res.json();
    if (data.length) product = data[0];
  } catch (e) {
    // Fall through to default meta
  }

  // Fetch the original produkt.html
  const originUrl = new URL('/produkt.html', request.url);
  const originRes = await fetch(originUrl);
  let html = await originRes.text();

  if (product) {
    const p = product;
    const price = Math.round(p.retail_price_incl_vat);
    const img = p.image_url || 'https://blomsterlen.se/og-image.jpg';
    const productUrl = `https://blomsterlen.se/vaxter/${p.slug}`;
    const title = `${p.swedish_name} (${p.latin_name}) — Köp online | Blomsterlen`;
    const desc = `${p.swedish_name} (${p.latin_name}) — ${p.category}. ${p.bloom_color && p.bloom_color !== '-' ? 'Blomfärg: ' + p.bloom_color + '. ' : ''}${p.height_cm ? 'Höjd: ' + p.height_cm + ' cm. ' : ''}${price} kr inkl. moms. Köp online från Blomsterlen.`;

    // Build JSON-LD
    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [{
        "@type": "Product",
        "name": p.swedish_name,
        "alternateName": p.latin_name,
        "description": p.catch_phrase || `Köp ${p.swedish_name} online från Blomsterlen.`,
        "image": img,
        "url": productUrl,
        "sku": p.slug,
        "category": p.category,
        "brand": { "@type": "Brand", "name": "Blomsterlen" },
        "offers": {
          "@type": "Offer",
          "url": productUrl,
          "priceCurrency": "SEK",
          "price": price,
          "priceValidUntil": new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
          "availability": p.stock_quantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          "seller": { "@id": "https://blomsterlen.se/#organization" },
          "shippingDetails": {
            "@type": "OfferShippingDetails",
            "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "SE" },
            "shippingRate": { "@type": "MonetaryAmount", "value": price >= 599 ? "0" : "39", "currency": "SEK" }
          }
        },
        "additionalProperty": [
          p.bloom_color && p.bloom_color !== '-' ? { "@type": "PropertyValue", "name": "Blomfärg", "value": p.bloom_color } : null,
          p.height_cm ? { "@type": "PropertyValue", "name": "Höjd", "value": p.height_cm + " cm" } : null,
          p.bloom_time && p.bloom_time !== '-' ? { "@type": "PropertyValue", "name": "Blomtid", "value": p.bloom_time } : null,
          p.light ? { "@type": "PropertyValue", "name": "Ljusbehov", "value": p.light } : null
        ].filter(Boolean)
      }, {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Blomsterlen", "item": "https://blomsterlen.se/" },
          { "@type": "ListItem", "position": 2, "name": p.category, "item": "https://blomsterlen.se/#products" },
          { "@type": "ListItem", "position": 3, "name": p.swedish_name, "item": productUrl }
        ]
      }]
    });

    // Escape for HTML attribute injection
    const esc = (s) => s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Inject SEO meta into <head> — replace the placeholder tags
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
    html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`);
    html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${productUrl}">`);

    // OG tags
    html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(p.swedish_name + ' — ' + p.category + ' | Blomsterlen')}">`);
    html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`);
    html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${productUrl}">`);
    html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${img}">`);
    html = html.replace(/<meta property="product:price:amount" content="[^"]*">/, `<meta property="product:price:amount" content="${price}">`);

    // Twitter tags
    html = html.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(p.swedish_name + ' — ' + p.category + ' | Blomsterlen')}">`);
    html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(desc)}">`);
    html = html.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${img}">`);

    // JSON-LD — replace the placeholder
    html = html.replace(/<script type="application\/ld\+json" id="productSchema">[^<]*<\/script>/, `<script type="application/ld+json" id="productSchema">${jsonLd}</script>`);

    // Inject slug into a data attribute so JS can read it from the path
    html = html.replace('</head>', `<meta name="product-slug" content="${esc(p.slug)}">\n</head>`);
  }

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
