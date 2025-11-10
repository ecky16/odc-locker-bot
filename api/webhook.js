import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// tes endpoint
app.get("/", (req, res) => {
  res.status(200).send("Webhook aktif ✅");
});

app.post("/", async (req, res) => {
  console.log("update:", JSON.stringify(req.body));
  res.status(200).send("ok"); // wajib balas ke Telegram
});

export default app;
