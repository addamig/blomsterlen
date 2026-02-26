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

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

Deno.serve(async (req) => {
  try {
    const body = await req.text();
    let event: any;

    const signature = req.headers.get("stripe-signature");
    if (endpointSecret && signature) {
      try {
        event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret);
      } catch (err) {
        console.error("Signature verification failed:", err.message);
        return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400 });
      }
    } else {
      event = JSON.parse(body);
    }

    console.log("Event received:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log("Checkout completed:", session.id, session.customer_email);

      const meta = session.metadata || {};

      // Parse name into parts
      const nameParts = (meta.customer_name || "").split(" ");
      const shippingName = meta.customer_name || "";

      // Parse address
      const addressParts = (meta.shipping_address || "").split(", ");
      const shippingAddress = addressParts[0] || "";
      const postalCity = addressParts[1] || "";
      const postalParts = postalCity.split(" ");
      const postalCode = postalParts[0] || "";
      const city = postalParts.slice(1).join(" ") || "";

      const orderData = {
        status: "paid",
        shipping_name: shippingName,
        shipping_address: shippingAddress,
        shipping_postal_code: postalCode,
        shipping_city: city,
        shipping_country: "SE",
        email: session.customer_email || "",
        phone: meta.customer_phone || "",
        subtotal_incl_vat: (session.amount_total || 0) / 100,
        shipping_cost: 0,
        total_incl_vat: (session.amount_total || 0) / 100,
        payment_method: "stripe",
        payment_intent_id: session.payment_intent || session.id,
        notes: meta.shipping_note || "",
      };

      console.log("Inserting order:", JSON.stringify(orderData));

      const { data, error } = await supabase.from("orders").insert(orderData).select();

      if (error) {
        console.error("Insert failed:", JSON.stringify(error));
      } else {
        console.log("Order created:", data?.[0]?.id);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Handler error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
