import crypto from "crypto";

const partnerId = process.env.SHOPEE_PARTNER_ID!;
const partnerKey = process.env.SHOPEE_PARTNER_KEY!;
const apiHost = process.env.SHOPEE_API_URL || "https://partner.shopeemobile.com";

export async function exchangeCodeForToken(code: string, shopId: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/v2/auth/token/get";

  // Public API Signature: partner_id + path + timestamp
  const signBase = `${partnerId}${path}${timestamp}`;
  const sign = crypto
    .createHmac("sha256", partnerKey)
    .update(signBase)
    .digest("hex");

  // shop_id is passed in query/body but NOT in signature base for Public APIs
  const url = `${apiHost}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      shop_id: Number(shopId),
      partner_id: Number(partnerId),
    }),
  });

  return res.json();
}
