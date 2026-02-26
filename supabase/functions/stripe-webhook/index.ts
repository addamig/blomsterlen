import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    try {
      // Fetch line items from Stripe
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

      const orderItems = lineItems.data
        .filter((item) => !item.description?.includes("frakt"))
        .map((item) => ({
          name: item.description,
          quantity: item.quantity,
          price: (item.amount_total || 0) / 100,
        }));

      // Create order in database
      const { error: orderError } = await supabase.from("orders").insert({
        customer_email: session.customer_email || session.metadata?.customer_name,
        customer_name: session.metadata?.customer_name || "Okänd",
        shipping_address: {
          address: session.metadata?.shipping_address,
          type: session.metadata?.shipping_type,
          note: session.metadata?.shipping_note,
        },
        items: orderItems,
        total_amount: session.amount_total || 0, // in öre
        shipping_cost: 0,
        status: "paid",
        stripe_session_id: session.id,
      });

      if (orderError) {
        console.error("Failed to create order:", orderError);
      } else {
        console.log(`Order created for ${session.customer_email}`);
      }

      // Decrement stock (optional - best effort)
      for (const item of orderItems) {
        await supabase.rpc("decrement_stock", {
          product_name: item.name,
          qty: item.quantity,
        });
      }

    } catch (err) {
      console.error("Error processing checkout.session.completed:", err);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
