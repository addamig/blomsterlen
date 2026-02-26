import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const SHIP_PRICES: Record<string, number> = {
  standard: 49,
  express: 99,
  pickup: 39,
};
const FREE_SHIP_THRESHOLD = 599;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { items, shipping, customer, discount_code } = await req.json();

    // Validate input
    if (!items?.length || !shipping || !customer?.email) {
      return new Response(
        JSON.stringify({ error: "Saknade fält: items, shipping, customer" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch real prices from database (never trust client prices)
    const productIds = items.map((i: { id: string }) => i.id);
    const { data: products, error: dbError } = await supabase
      .from("products")
      .select("id, swedish_name, retail_price_incl_vat, image_url, stock_quantity")
      .in("id", productIds);

    if (dbError || !products?.length) {
      return new Response(
        JSON.stringify({ error: "Kunde inte hämta produkter" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate stock
    for (const item of items) {
      const product = products.find((p: any) => p.id === item.id);
      if (!product) {
        return new Response(
          JSON.stringify({ error: `Produkten "${item.name}" hittades inte` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (product.stock_quantity < item.quantity) {
        return new Response(
          JSON.stringify({ error: `"${product.swedish_name}" har bara ${product.stock_quantity} i lager` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Build line items with verified prices
    const line_items = items.map((item: { id: string; quantity: number; name: string }) => {
      const product = products.find((p: any) => p.id === item.id)!;
      return {
        price_data: {
          currency: "sek",
          product_data: {
            name: product.swedish_name,
            ...(product.image_url ? { images: [product.image_url] } : {}),
          },
          unit_amount: Math.round(product.retail_price_incl_vat * 100), // öre
        },
        quantity: item.quantity,
      };
    });

    // Calculate subtotal from verified prices
    const subtotal = items.reduce((sum: number, item: { id: string; quantity: number }) => {
      const product = products.find((p: any) => p.id === item.id)!;
      return sum + product.retail_price_incl_vat * item.quantity;
    }, 0);

    // Shipping cost
    const shipType = shipping.type || "standard";
    const shipCost = subtotal >= FREE_SHIP_THRESHOLD ? 0 : (SHIP_PRICES[shipType] || 49);

    if (shipCost > 0) {
      const shipNames: Record<string, string> = {
        standard: "Standardfrakt (PostNord 2–4 dagar)",
        express: "Expressfrakt (nästa arbetsdag)",
        pickup: "Hämta hos ombud (2–3 dagar)",
      };
      line_items.push({
        price_data: {
          currency: "sek",
          product_data: { name: shipNames[shipType] || "Frakt" },
          unit_amount: shipCost * 100,
        },
        quantity: 1,
      });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "klarna"],
      line_items,
      mode: "payment",
      customer_email: customer.email,
      locale: "sv",
      metadata: {
        customer_name: `${customer.firstName} ${customer.lastName}`,
        customer_phone: customer.phone || "",
        shipping_address: `${customer.address}, ${customer.zip} ${customer.city}`,
        shipping_type: shipType,
        shipping_note: shipping.note || "",
        discount_code: discount_code || "",
      },
      success_url: `${req.headers.get("origin") || "https://blomsterlen.se"}/kassa.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin") || "https://blomsterlen.se"}/kassa.html?cancelled=true`,
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Stripe checkout error:", err);
    return new Response(
      JSON.stringify({ error: "Något gick fel vid betalningen. Försök igen." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
