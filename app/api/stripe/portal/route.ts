import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
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
    .select("stripe_customer_id")
    .eq("id", orgId)
    .single();
  if (!org?.stripe_customer_id) return NextResponse.json({ error: "No billing account yet" }, { status: 400 });

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/org/settings`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("Stripe portal session failed:", err instanceof Error ? err.message : err);
    const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
