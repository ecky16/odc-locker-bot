// api/webhook.js
export default async function handler(req, res) {
  console.log("Webhook hit:", req.method, new Date().toISOString());

  if (req.method === "GET") {
    return res.status(200).send("Webhook minimal OK ✅");
  }

  if (req.method === "POST") {
    console.log("Body:", JSON.stringify(req.body));
    return res.status(200).send("ok");
  }

  return res.status(200).end();
}
