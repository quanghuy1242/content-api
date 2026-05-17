import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/infrastructure/db/schema.ts",
  dialect: "sqlite",
});
