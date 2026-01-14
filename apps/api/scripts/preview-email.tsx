import * as React from "react";
import { render } from "@react-email/render";
import fs from "node:fs";
import path from "node:path";

// ✅ adjust the import to your file name / path
import Welcome1Email from "../src/templates/emails/welcome-3";

async function main() {
  const html = await render(
    <Welcome1Email recipientFirstName="Ryan" />,
    { pretty: true }
  );

  const outPath = path.join(process.cwd(), "email-preview.html");
  fs.writeFileSync(outPath, html, "utf8");
  console.log("Wrote:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
