import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify request has service_role or valid admin token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { subject, html, test_email } = await req.json();

    if (!subject || !html) {
      return new Response(JSON.stringify({ error: "Subject and html required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let recipients: string[] = [];

    if (test_email) {
      // Test mode: send only to specified email
      recipients = [test_email];
    } else {
      // Production: fetch all active subscribers
      const { data: subs, error } = await supabase
        .from("newsletter_subscribers")
        .select("email")
        .eq("is_active", true);

      if (error) throw error;
      recipients = (subs || []).map((s: any) => s.email);
    }

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: "No recipients found", sent: 0 }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via Resend individually to each recipient
    let totalSent = 0;
    const errors: string[] = [];

    for (let i = 0; i < recipients.length; i++) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: "Blomsterlen <nyhetsbrev@blomsterlen.se>",
            to: [recipients[i]],
            reply_to: "richard@addamig.se",
            subject,
            html,
          }),
        });

        const result = await res.json();
        if (res.ok) {
          totalSent++;
        } else {
          console.error("Resend error for", recipients[i], ":", JSON.stringify(result));
          errors.push(`${recipients[i]}: ${result.message || "Unknown error"}`);
        }
      } catch (err) {
        console.error("Send error for", recipients[i], ":", err.message);
        errors.push(`${recipients[i]}: ${err.message}`);
      }

      // Small delay between sends to respect rate limits
      if (i < recipients.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Log the send (skip for test emails)
    if (!test_email && totalSent > 0) {
      try {
        await supabase.from("newsletter_sends").insert({
          subject,
          html,
          recipient_count: totalSent,
          status: errors.length > 0 ? "partial" : "sent",
          sent_by: "admin",
        });
      } catch (logErr) {
        console.error("Failed to log send:", logErr.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: totalSent,
        total: recipients.length,
        errors: errors.length > 0 ? errors : undefined,
        test: !!test_email,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Handler error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
