import { afterAll } from "vitest";
import { env } from "./helpers.js";
afterAll(() => env.DB.close());
