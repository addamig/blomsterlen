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
      console.warn("No signature verification — missing secret or header");
    }

    console.log("Event received:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log("Checkout completed:", session.id, session.customer_email);

      let orderItems: any[] = [];
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        orderItems = lineItems.data.map((item: any) => ({
          name: item.description,
          quantity: item.quantity,
          price_cents: item.amount_total,
        }));
      } catch (err) {
        console.error("Line items fetch failed:", err.message);
      }

      const orderData = {
        customer_email: session.customer_email || "",
        customer_name: session.metadata?.customer_name || "",
        shipping_address: {
          address: session.metadata?.shipping_address || "",
          type: session.metadata?.shipping_type || "",
          note: session.metadata?.shipping_note || "",
          phone: session.metadata?.customer_phone || "",
        },
        items: orderItems,
        total_amount: session.amount_total || 0,
        status: "paid",
        stripe_session_id: session.id,
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
