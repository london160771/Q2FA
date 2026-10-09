import { createReadinessServer, parseAllowedOrigins } from "./server.js";

const portText = process.env.PORT ?? "10000";
if (!/^\d+$/.test(portText)) throw new Error("PORT must be a valid TCP port number.");
const port = Number(portText);
if (port < 1 || port > 65_535) throw new Error("PORT must be between 1 and 65535.");

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
const server = createReadinessServer(allowedOrigins);
server.on("error", () => {
  process.stderr.write("Q2FA health service failed to start.\n");
  process.exitCode = 1;
});
server.listen(port, "0.0.0.0");

process.once("SIGTERM", () => server.close());
process.once("SIGINT", () => server.close());
