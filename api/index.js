// api/index.js — Vercel serverless entrypoint for Express
import app from "../app.js";

// Vercel invokes the default export like a handler.
// Express apps are just (req,res) handlers, so this works.
export default app;
