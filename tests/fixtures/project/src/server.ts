// TypeScript: process.env dot, bracket and optional-chaining access.
const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env["API_KEY"];
const port = Number(process.env['PORT'] ?? 3000);
const logLevel = process.env?.LOG_LEVEL ?? 'info';
const region = process.env[`AWS_REGION`];
const nodeEnv = process.env.NODE_ENV;

export const config = { databaseUrl, apiKey, port, logLevel, region, nodeEnv };
