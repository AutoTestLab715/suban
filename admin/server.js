const path = require("path");
const express = require("express");
require("dotenv").config();

const app = express();
const port = Number.parseInt(process.env.PORT || "3001", 10);
const staticRoot = path.resolve(__dirname, "..", "cloudhosting");

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.static(staticRoot, { index: "index.html" }));
app.get("*", (req, res) => {
  res.sendFile(path.join(staticRoot, "index.html"));
});

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Admin preview: http://127.0.0.1:${port}`);
});

server.on("error", (error) => {
  console.error("Failed to start admin preview:", error.message);
  process.exitCode = 1;
});