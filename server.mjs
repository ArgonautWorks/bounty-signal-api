import app from "./app.mjs";

const port = Number.parseInt(process.env.PORT ?? "8791", 10);

app.listen(port, "127.0.0.1", () => {
  console.log(`Bounty Signal API listening on http://127.0.0.1:${port}`);
});
