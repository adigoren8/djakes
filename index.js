const express = require("express");
const { startAutomationSession } = require("./automation-session");

const app = express();
const port = process.env.PORT || 3092;
app.listen(port, () => {
  console.log(`App listening on port ${port}`);
  startAutomationSession();
});

app.get("/", (req, res) => {
  console.log("Received a '/' request");
  res.send("Hello World!");
});
