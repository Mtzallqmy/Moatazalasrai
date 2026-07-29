const baseUrl = process.env.APP_URL;
if (!baseUrl) throw new Error("APP_URL is required");
for (const path of ["/api/health", "/api/ready"]) {
  const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
}
console.log("Deployment verification passed");
