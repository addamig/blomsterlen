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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

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

      // Fetch line items with product images
      let lineItems: any[] = [];
      try {
        const li = await stripe.checkout.sessions.listLineItems(session.id, {
          expand: ["data.price.product"],
        });
        lineItems = li.data;
      } catch (err) {
        console.error("Failed to fetch line items:", err.message);
      }

      // Insert order
      const orderData = {
        status: "paid",
        shipping_name: meta.customer_name || "",
        shipping_address: meta.shipping_address || "",
        shipping_postal_code: meta.shipping_zip || "",
        shipping_city: meta.shipping_city || "",
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

      const { data, error } = await supabase.from("orders").insert(orderData).select();

      if (error) {
        console.error("Insert failed:", JSON.stringify(error));
      } else {
        console.log("Order created:", data?.[0]?.id);

        // Send confirmation email
        const orderNumber = data?.[0]?.order_number || data?.[0]?.id?.slice(0, 8);
        await sendConfirmationEmail({
          to: session.customer_email,
          customerName: meta.customer_name || "",
          orderNumber: String(orderNumber),
          lineItems,
          shippingAddress: {
            name: meta.customer_name || "",
            address: meta.shipping_address || "",
            zip: meta.shipping_zip || "",
            city: meta.shipping_city || "",
          },
          shippingType: meta.shipping_type || "standard",
          total: (session.amount_total || 0) / 100,
        });
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

// ── Email ──
interface EmailData {
  to: string;
  customerName: string;
  orderNumber: string;
  lineItems: any[];
  shippingAddress: { name: string; address: string; zip: string; city: string };
  shippingType: string;
  total: number;
}

async function sendConfirmationEmail(data: EmailData) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set — skipping email");
    return;
  }

  const shipNames: Record<string, string> = {
    standard: "Standardfrakt (2–4 arbetsdagar)",
    express: "Expressfrakt (nästa arbetsdag)",
    pickup: "Hämta hos ombud (2–3 arbetsdagar)",
  };

  const firstName = data.customerName.split(" ")[0] || "du";

  // Build product rows
  const productItems = data.lineItems.filter(
    (item: any) => !item.description?.includes("frakt") && !item.description?.includes("ombud") && !item.description?.includes("Expressfr")
  );

  const itemRows = productItems
    .map((item: any) => {
      const product = item.price?.product;
      const imageUrl = product?.images?.[0] || "";
      const name = item.description || "Produkt";
      const qty = item.quantity || 1;
      const unitPrice = (item.price?.unit_amount || 0) / 100;
      const totalPrice = (item.amount_total || 0) / 100;

      return `
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #f0ebe4;vertical-align:top;width:72px">
            ${imageUrl
              ? `<img src="${imageUrl}" alt="${name}" width="64" height="80" style="border-radius:10px;object-fit:cover;display:block" />`
              : `<div style="width:64px;height:80px;border-radius:10px;background:#e8e0d4;display:flex;align-items:center;justify-content:center;font-size:24px">🌿</div>`
            }
          </td>
          <td style="padding:16px 12px;border-bottom:1px solid #f0ebe4;vertical-align:top">
            <div style="font-weight:600;color:#3D3229;font-size:15px;margin-bottom:4px">${name}</div>
            <div style="color:#8B9E7E;font-size:13px">${qty} st × ${unitPrice} kr</div>
          </td>
          <td style="padding:16px 0;border-bottom:1px solid #f0ebe4;vertical-align:top;text-align:right">
            <div style="font-weight:600;color:#3D3229;font-size:15px">${totalPrice} kr</div>
          </td>
        </tr>`;
    })
    .join("");

  // Find shipping line item
  const shippingItem = data.lineItems.find(
    (item: any) => item.description?.includes("frakt") || item.description?.includes("ombud") || item.description?.includes("Expressfr")
  );
  const shippingCost = shippingItem ? (shippingItem.amount_total || 0) / 100 : 0;
  const subtotal = data.total - shippingCost;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-text-size-adjust:100%">
  <div style="max-width:600px;margin:0 auto;padding:20px">

    <!-- Header -->
    <div style="text-align:center;padding:40px 0 32px">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;color:#3D3229;letter-spacing:1px;margin-bottom:8px">blomsterlen</div>
      <div style="width:40px;height:2px;background:#8B9E7E;margin:0 auto 24px"></div>
      <div style="font-size:14px;color:#8B9E7E;letter-spacing:3px;text-transform:uppercase;font-weight:600">Orderbekräftelse</div>
    </div>

    <!-- Main card -->
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(61,50,41,.06)">

      <!-- Green banner -->
      <div style="background:#8B9E7E;padding:32px;text-align:center">
        <div style="font-size:40px;margin-bottom:12px">✓</div>
        <div style="color:#ffffff;font-size:22px;font-family:Georgia,'Times New Roman',serif;margin-bottom:8px">Tack för din beställning, ${firstName}!</div>
        <div style="color:rgba(255,255,255,.8);font-size:14px">Order #${data.orderNumber}</div>
      </div>

      <!-- Products -->
      <div style="padding:28px 32px 8px">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8B9E7E;font-weight:600;margin-bottom:16px">Dina växter</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          ${itemRows}
        </table>
      </div>

      <!-- Totals -->
      <div style="padding:20px 32px 28px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr>
            <td style="padding:6px 0;color:#7a7067;font-size:14px">Delsumma</td>
            <td style="padding:6px 0;text-align:right;color:#3D3229;font-size:14px">${subtotal} kr</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#7a7067;font-size:14px">Frakt</td>
            <td style="padding:6px 0;text-align:right;color:#3D3229;font-size:14px">${shippingCost > 0 ? shippingCost + " kr" : "Fri frakt ✓"}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:12px 0 0"><div style="border-top:2px solid #f0ebe4"></div></td>
          </tr>
          <tr>
            <td style="padding:12px 0 0;font-weight:700;color:#3D3229;font-size:18px">Totalt</td>
            <td style="padding:12px 0 0;text-align:right;font-weight:700;color:#3D3229;font-size:18px">${data.total} kr</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:4px 0 0;color:#8B9E7E;font-size:12px">varav moms 25%: ${Math.round(data.total * 0.2)} kr</td>
          </tr>
        </table>
      </div>

      <!-- Divider -->
      <div style="height:1px;background:#f0ebe4;margin:0 32px"></div>

      <!-- Shipping & Address -->
      <div style="padding:28px 32px;display:flex">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:top;width:50%;padding-right:16px">
              <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8B9E7E;font-weight:600;margin-bottom:10px">Leveransadress</div>
              <div style="color:#3D3229;font-size:14px;line-height:1.6">
                ${data.shippingAddress.name}<br>
                ${data.shippingAddress.address}<br>
                ${data.shippingAddress.zip} ${data.shippingAddress.city}
              </div>
            </td>
            <td style="vertical-align:top;width:50%;padding-left:16px">
              <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8B9E7E;font-weight:600;margin-bottom:10px">Leveranssätt</div>
              <div style="color:#3D3229;font-size:14px;line-height:1.6">
                ${shipNames[data.shippingType] || "Standardfrakt"}
              </div>
            </td>
          </tr>
        </table>
      </div>

      <!-- Care tips banner -->
      <div style="background:#f8f5f0;padding:24px 32px;border-top:1px solid #f0ebe4">
        <div style="font-size:15px;color:#3D3229;font-weight:600;margin-bottom:8px">🌱 Tips inför leveransen</div>
        <div style="color:#7a7067;font-size:13px;line-height:1.7">
          Dina växter skickas i specialemballage för att hålla sig fräscha. Plantera dem gärna inom ett par dagar efter leverans och vattna ordentligt vid plantering.
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:32px 0">
      <div style="margin-bottom:16px">
        <a href="https://blomsterlen.se" style="color:#8B9E7E;text-decoration:none;font-size:13px;font-weight:500">blomsterlen.se</a>
        <span style="color:#d4cdc4;margin:0 12px">·</span>
        <a href="https://blomsterlen.se/kundservice.html" style="color:#8B9E7E;text-decoration:none;font-size:13px;font-weight:500">Kundservice</a>
      </div>
      <div style="color:#b5ada4;font-size:12px;line-height:1.6">
        Blomsterlen — Perenner från Lackalänga Trädgård<br>
        Frågor? Svara på detta mail så hjälper vi dig.
      </div>
    </div>
  </div>
</body>
</html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Blomsterlen <order@blomsterlen.se>",
        to: [data.to],
        subject: `Orderbekräftelse #${data.orderNumber} — Blomsterlen`,
        html,
      }),
    });

    const result = await res.json();
    if (res.ok) {
      console.log("Email sent:", result.id);
    } else {
      console.error("Email failed:", JSON.stringify(result));
    }
  } catch (err) {
    console.error("Email send error:", err.message);
  }
}
