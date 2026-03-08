// Tailwind v4 uses automatic content detection — no `content` field needed.
// This config exists solely to load plugins via JS API because
// Turbopack (Next.js 16) does not process @plugin CSS directives.
import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  plugins: [typography],
};

export default config;
