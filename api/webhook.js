export default async function handler(req, res) {
  if (req.method === "GET") {
    // buat cek cepat di browser
    return res.status(200).send("Webhook aktif ✅ (GET)");
  }

  if (req.method === "POST") {
    // ini dipanggil Telegram setiap ada pesan/update
    console.log("Update dari Telegram:", JSON.stringify(req.body, null, 2));

    // WAJIB balas 200 ke Telegram
    return res.status(200).send("ok");
  }

  // selain GET/POST, yaudah
  return res.status(200).end();
}
