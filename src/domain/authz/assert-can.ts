import { ForbiddenError } from "@/shared/errors";

export async function assertAllowed(allowed: Promise<boolean>, message = "Forbidden") {
  if (!(await allowed)) {
    throw new ForbiddenError(message);
  }
}
