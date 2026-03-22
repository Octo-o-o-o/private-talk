#!/usr/bin/env node

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log("\n  Private Talk - OpenClaw Pairing Tool\n");

  // 1. Try to read local OpenClaw config
  let gatewayUrl = "";
  let token = "";
  const configPath = join(homedir(), ".openclaw", "config.json");

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    gatewayUrl = config.gateway_url || "";
    token = config.token || "";
    if (gatewayUrl) {
      console.log(`  Found local config: ${configPath}`);
      console.log(`  Gateway URL: ${gatewayUrl}`);
      console.log(`  Token: ${token ? "***" : "(empty)"}\n`);
    }
  } catch {
    // no config file
  }

  // Also check env var
  if (!token && process.env.OPENCLAW_GATEWAY_TOKEN) {
    token = process.env.OPENCLAW_GATEWAY_TOKEN;
  }

  // 2. If gateway_url is localhost, ask for public address
  if (!gatewayUrl || /127\.0\.0\.1|localhost/i.test(gatewayUrl)) {
    const defaultUrl = gatewayUrl || "ws://127.0.0.1:18789";
    const port = defaultUrl.match(/:(\d+)/)?.[1] || "18789";

    console.log(
      "  Your gateway is running on localhost.\n" +
        "  To connect from another device, enter the public IP/domain.\n"
    );
    const publicHost = await ask(
      `  Public address (IP or domain, port ${port}): `
    );

    if (publicHost.trim()) {
      const host = publicHost.trim();
      if (host.startsWith("ws://") || host.startsWith("wss://")) {
        gatewayUrl = host;
      } else {
        gatewayUrl = `ws://${host}:${port}`;
      }
    } else {
      gatewayUrl = defaultUrl;
    }
  }

  // 3. Confirm / edit
  if (!gatewayUrl) {
    gatewayUrl = await ask("  Gateway URL: ");
  }
  if (!token) {
    token = await ask("  Token (press Enter to skip): ");
  }

  const name =
    (await ask("  Instance name (default: Remote OpenClaw): ")) ||
    "Remote OpenClaw";

  // 4. Fetch agent list from local openclaw CLI
  let agents = [];
  try {
    console.log("\n  Fetching agent list...");
    const raw = execSync("openclaw agents list --json", {
      encoding: "utf-8",
      timeout: 15000,
    });
    // Strip ANSI codes and find JSON array
    const cleaned = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const jsonStart = cleaned.indexOf("\n[");
    const jsonStr =
      jsonStart >= 0
        ? cleaned.slice(jsonStart + 1)
        : cleaned.startsWith("[")
          ? cleaned
          : null;
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      agents = parsed.map((a) => ({
        id: a.id,
        name: a.name,
        model: a.model || "",
        isDefault: a.isDefault || false,
      }));
      console.log(`  Found ${agents.length} agent(s): ${agents.map((a) => a.name).join(", ")}`);
    }
  } catch {
    console.log("  Warning: could not fetch agent list (openclaw CLI not found or failed)");
  }

  // 5. Generate connection string
  const payload = { v: 1, url: gatewayUrl.trim(), token: token.trim() };
  if (name.trim() && name.trim() !== "Remote OpenClaw") {
    payload.name = name.trim();
  }
  if (agents.length > 0) {
    payload.agents = agents;
  }

  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString("base64url");
  const connectionString = `ptalk:${b64}`;

  console.log("\n" + "─".repeat(60));
  console.log("\n  Connection string (copy and paste into Private Talk):\n");
  console.log(`  ${connectionString}`);
  console.log("\n" + "─".repeat(60));

  // 6. Try to display QR code (for mobile scanning in the future)
  try {
    const { default: qr } = await import("qrcode-terminal");
    console.log("\n  QR Code (scan from Private Talk mobile):\n");
    qr.generate(connectionString, { small: true }, (code) => {
      console.log(
        code
          .split("\n")
          .map((l) => "  " + l)
          .join("\n")
      );
      console.log();
    });
  } catch {
    console.log(
      "\n  (Install qrcode-terminal for QR display: npm i -g qrcode-terminal)\n"
    );
  }

  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
