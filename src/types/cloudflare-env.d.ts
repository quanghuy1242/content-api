import type { AppBindings } from "@/config/env";

declare global {
  namespace Cloudflare {
    interface Env extends AppBindings {}
  }
}

