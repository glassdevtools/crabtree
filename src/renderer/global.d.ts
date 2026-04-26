import type { MoltTreeApi } from "../shared/types";

declare module "*.css";

declare global {
  interface Window {
    molttree: MoltTreeApi;
  }
}
