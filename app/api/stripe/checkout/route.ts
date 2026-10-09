import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRO_PRICE_ID) {
    return NextResponse.json({ error: "Billing isn't set up yet — check back soon." }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization");
  const { orgId } = await req.json();
  if (!authHeader || !orgId) {
    return NextResponse.json({ error: "Missing auth or orgId" }, { status: 400 });
  }

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: membership } = await userClient
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single();
  if (!membership) return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
  if (!(["superadmin", "admin"] as string[]).includes(membership.role)) {
    return NextResponse.json({ error: "Only organization owners and admins can manage billing" }, { status: 403 });
  }

  const { data: org } = await userClient
    .from("organizations")
    .select("id, name, stripe_customer_id")
    .eq("id", orgId)
    .single();
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  try {
    let customerId = org.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email!,
        name: org.name,
        metadata: { org_id: org.id },
      });
      customerId = customer.id;
      await admin.from("organizations").update({ stripe_customer_id: customerId }).eq("id", org.id);
    }

    // Billed per seat — a team that already has members before its first
    // checkout starts at that headcount, not 1.
    const { count } = await admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);
    const seats = Math.max(1, count ?? 1);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: seats }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/projects?upgraded=1`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/projects`,
      client_reference_id: org.id,
      subscription_data: { metadata: { org_id: org.id } },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Without this, an uncaught Stripe error (e.g. a restricted API key
    // missing a required permission) crashes the function with an empty
    // body, which the client sees as "Unexpected end of JSON input"
    // instead of the actual reason.
    console.error("Stripe checkout failed:", err instanceof Error ? err.message : err);
    const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
