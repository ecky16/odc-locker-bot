import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// tes GET
app.get("/", (req, res) => {
  res.status(200).send("Webhook aktif ✅");
});

// tangani POST dari Telegram
app.post("/", (req, res) => {
  console.log("Update dari Telegram:", JSON.stringify(req.body, null, 2));

  // penting! Telegram butuh respon 200 OK secepatnya
  res.status(200).send("ok");
});

export default app;
