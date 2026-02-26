import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "Missing session_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch session
    const session = await stripe.checkout.sessions.retrieve(session_id);

    // Fetch line items with product details
    const lineItems = await stripe.checkout.sessions.listLineItems(session_id, {
      expand: ["data.price.product"],
    });

    const meta = session.metadata || {};

    const items = lineItems.data.map((item: any) => {
      const product = item.price?.product;
      return {
        name: item.description || "Produkt",
        quantity: item.quantity || 1,
        unit_price: (item.price?.unit_amount || 0) / 100,
        total: (item.amount_total || 0) / 100,
        image: product?.images?.[0] || null,
        is_shipping: (item.description || "").includes("frakt") ||
          (item.description || "").includes("ombud") ||
          (item.description || "").includes("Expressfr") ||
          (item.description || "").includes("Hemleverans"),
      };
    });

    const result = {
      order_id: session.payment_intent || session.id,
      email: session.customer_email || "",
      customer_name: meta.customer_name || "",
      phone: meta.customer_phone || "",
      address: meta.shipping_address || "",
      zip: meta.shipping_zip || "",
      city: meta.shipping_city || "",
      shipping_type: meta.shipping_type || "standard",
      items,
      total: (session.amount_total || 0) / 100,
      currency: session.currency || "sek",
      payment_status: session.payment_status,
      created: session.created,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Get order error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
